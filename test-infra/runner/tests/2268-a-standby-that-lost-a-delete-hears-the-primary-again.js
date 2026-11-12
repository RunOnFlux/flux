/*
 * A standby whose store of the primary's index lacks a delete keeps what was deleted,
 * and no reconnect tells it otherwise. From syncthing v2.1.2 a copy in that state, leaving,
 * hears the primary's index again, drops what was deleted and leaves. Before v2.1.2 a
 * device's sequence survives its records being dropped, so the repair would empty the
 * store for good, and nothing is touched.
 *
 * Three holders of a g: app wanting two, so a standby leaves on the surplus trim. The
 * state is written into the standby's stopped database: the mechanism that loses a record
 * in production is not known, and this is what it leaves, as read off a live node. The
 * suite asserts that shape before it relies on it. A later file reaching the standby shows
 * the connection and the deltas are healthy.
 *
 * Real syncthing; run it on both of test-infra/syncthing-versions.
 *
 * Not here: what a primary that is not a delete answers, and a list that moves between
 * passes. Those are unit-tested, and modelled in the shapes a repair must leave alone.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, listAppContainers } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import {
  getDeviceId, getFolderConfig, getFolderStatus, getRemoteState, getVersion, isDaemonUp, loseDeviceRecords,
  readPath, scanFolder, startDaemon, stopDaemon,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const GIVEUP_BEFORE_PASS = 'giveUp:beforePass';

describe('a standby that lost a delete hears the primary again', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2elost${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const HOLDERS = [0, 1, 2];
  const STALE = 'appdata/old';
  const staleItems = [STALE, `${STALE}/world.sav`, `${STALE}/meta.sav`];
  let primary;
  let leaver;
  let path;
  let releaseAtLeast21;

  const running = async (i) => (await listAppContainers(env.clients[i].container))
    .some((c) => c.name.includes(appName) && c.status?.startsWith('Up'));
  const locations = async () => (await env.clients[3].getAppLocations(appName)).data ?? [];
  const codesOn = (i, afterId) => env.clients[i].getEventBuffer()
    .filter((entry) => entry.event === 'giveUp:strandedIndex' && entry.id > afterId && entry.data.appName === appName)
    .map((entry) => entry.data.code);
  const onLeaver = (name) => readPath(env.clients[leaver], `${path}/${name}`);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));
    await pushTestApp(appName, 'v1', appName, { user: 1000 });
    await Promise.all(HOLDERS.map((i) => env.clients[i].holdCheckpoint(GIVEUP_BEFORE_PASS)));
    await installOnNodes(env, await buildSeedableApp({
      env,
      name: appName,
      instances: 2,
      compose: [{
        name: appName,
        description: 'g: component',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: ['WRITE_FILE=/appdata/placed.txt', 'WRITE_CONTENT=placed'],
        commands: [],
        containerPorts: [80],
        containerData: 'g:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    }), HOLDERS);
    await waitFor(async () => (await Promise.all(HOLDERS.map(running))).filter(Boolean).length === 1, {
      timeout: 300000, interval: 3000, label: 'one holder is the primary',
    });
    primary = (await Promise.all(HOLDERS.map(running))).indexOf(true);
    await waitFor(async () => (await locations()).length === 3, {
      timeout: 120000, interval: 3000, label: 'three locations',
    });
    const newestFirst = [...await locations()].sort((a, b) => new Date(b.runningSince) - new Date(a.runningSince));
    const subnet = getSubnetConfig();
    const indexOf = (location) => HOLDERS.find((i) => subnet.nodeIp(i + 1) === location.ip.split(':')[0]);
    leaver = newestFirst.map(indexOf).find((i) => i !== primary);
    path = (await getFolderConfig(env.clients[leaver], folder)).path;
    const [, major, minor, patch] = /v?(\d+)\.(\d+)\.(\d+)/.exec(await getVersion(env.clients[leaver])).map(Number);
    releaseAtLeast21 = major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 2)));

    const primaryRoot = (await getFolderConfig(env.clients[primary], folder)).path;
    const made = await execInContainer(env.clients[primary].container,
      `mkdir -p ${primaryRoot}/${STALE} && head -c 70000 /dev/urandom > ${primaryRoot}/${STALE}/world.sav && echo meta > ${primaryRoot}/${STALE}/meta.sav && chown -R 1000:1000 ${primaryRoot}/${STALE}`);
    expect(made.exitCode).to.equal(0);
    await scanFolder(env.clients[primary], folder);
    await waitFor(async () => (await onLeaver(`${STALE}/meta.sav`)) !== null, {
      timeout: 120000, interval: 2000, label: 'the standby holds the backup',
    });
    // The delete is lost from every device that holds it, which needs a record of
    // each in the standby's index: every holder's index has reached it.
    const others = HOLDERS.filter((i) => i !== leaver);
    await waitFor(async () => (await Promise.all(others.map(async (i) => getRemoteState(env.clients[leaver], folder, await getDeviceId(env.clients[i])))))
      .every((state) => state === 'valid'), {
      timeout: 120000, interval: 2000, label: 'the standby holds an index from every other holder',
    });

    await stopDaemon(env.clients[leaver]);
    await execInContainer(env.clients[primary].container, `rm -rf ${primaryRoot}/${STALE}`);
    await scanFolder(env.clients[primary], folder);
    const other = HOLDERS.find((i) => i !== primary && i !== leaver);
    await waitFor(async () => (await readPath(env.clients[other], `${path}/${STALE}/meta.sav`)) === null, {
      timeout: 120000, interval: 2000, label: 'the other standby took the delete',
    });
    // Every device that holds the delete would otherwise repeat it.
    // eslint-disable-next-line no-restricted-syntax
    for (const i of [primary, other]) {
      // eslint-disable-next-line no-await-in-loop
      const { sequence } = await getFolderStatus(env.clients[i], folder);
      // eslint-disable-next-line no-await-in-loop
      const dropped = await loseDeviceRecords(env.clients[leaver], folder, { deviceId: await getDeviceId(env.clients[i]), names: staleItems, sequence });
      if (i === primary) expect(dropped, 'the primary\'s records').to.equal(staleItems.length);
    }
    await startDaemon(env.clients[leaver]);
    await waitFor(async () => (await getRemoteState(env.clients[leaver], folder, await getDeviceId(env.clients[primary]))) === 'valid', {
      timeout: 120000, interval: 2000, label: 'the standby connected again',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('the standby holds what the primary deleted, with a later file still reaching it', async function () {
    this.timeout(180000);
    const primaryRoot = (await getFolderConfig(env.clients[primary], folder)).path;
    await execInContainer(env.clients[primary].container, `echo later > ${primaryRoot}/appdata/later.sav && chown 1000:1000 ${primaryRoot}/appdata/later.sav`);
    await scanFolder(env.clients[primary], folder);
    await waitFor(async () => (await onLeaver('appdata/later.sav')) !== null, {
      timeout: 120000, interval: 2000, label: 'a later file reached the standby',
    });
    expect(await onLeaver(`${STALE}/meta.sav`), 'the deleted file').to.not.equal(null);
    expect(await readPath(env.clients[primary], `${primaryRoot}/${STALE}/meta.sav`), 'on the primary').to.equal(null);
  });

  it('from v2.1.2 the copy hears the primary again and leaves; before it nothing is touched', async function () {
    this.timeout(600000);
    const mark = env.clients[leaver].getLastEventId();
    await Promise.all(HOLDERS.map((i) => env.clients[i].releaseAllCheckpoints()));

    if (releaseAtLeast21) {
      await waitFor(async () => (await locations()).length === 2, {
        timeout: 480000, interval: 3000, label: 'the stranded copy gone',
      });
      const codes = codesOn(leaver, mark);
      expect(codes.at(-1), 'the repair').to.equal('REFETCHED');
      expect(codes, 'two sightings before it').to.include('FIRST_SIGHTING');
    } else {
      await waitFor(() => codesOn(leaver, mark).length >= 3, {
        timeout: 480000, interval: 3000, label: 'three passes refused the release',
      });
      expect([...new Set(codesOn(leaver, mark))]).to.deep.equal(['UNSUPPORTED_RELEASE']);
      expect((await getFolderConfig(env.clients[leaver], folder)).devices).to.have.length(3);
      expect(await onLeaver(`${STALE}/meta.sav`), 'the copy is untouched').to.not.equal(null);
      expect(await onLeaver('appdata/later.sav'), 'its index is whole').to.not.equal(null);
      expect(await locations()).to.have.length(3);
    }
  });
});
