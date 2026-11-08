/*
 * A copy leaving an r: or s: app takes what it wrote last with it: a file written just before
 * the pass, which no index shows yet, and the save the app makes on SIGTERM. A copy that
 * cannot show a peer holds it serves again.
 *
 * Three holders of an app wanting two, so the newest leaves on the surplus trim. Each
 * holder's give-up pass is held while a unique file goes onto each volume, and released
 * at once: the leaver's file is younger than syncthing's ten second watcher batch. The
 * staying copies' files reaching each other show sync works in the same window.
 *
 * A copy that cannot show a peer holds it is cut off from its peers while its attempt
 * is held before the scan; it serves again, in each mode, once the attempt gives up.
 *
 * Real syncthing, because the property is what a daemon's index shows; run it on both of
 * test-infra/syncthing-versions.
 *
 * Not here: a copy that runs again after its scan, which needs a start and an exit
 * inside the attempt. That is unit-tested.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { listAppContainers, execInContainer } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { isDaemonUp, getFolderConfig, readPath } from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const GIVEUP_BEFORE_PASS = 'giveUp:beforePass';
const BEFORE_SCAN = 'leavingCopy:beforeScan';

describe('a copy leaving an r: or s: app takes its last writes with it', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const stamp = Date.now();
  const leavingApp = `e2eleaving${stamp}`;
  const stayingApp = `e2estaying${stamp}`;
  const stayingSharedApp = `e2estayshared${stamp}`;
  const sharedApp = `e2eshared${stamp}`;
  const HOLDERS = [0, 1, 2];
  const FINAL_SAVE = 'final-save.txt';
  const folderOf = (name) => `flux${name}_${name}`;

  const running = async (i, name) => (await listAppContainers(env.clients[i].container))
    .some((c) => c.name.includes(name) && c.status?.startsWith('Up'));
  const locationCount = async (name) => (await env.clients[3].getAppLocations(name)).data?.length;
  const parkedEverywhere = async (name) => (await Promise.all(HOLDERS.map(
    async (i) => (await env.clients[i].holdCheckpoint(name)).parked,
  ))).every((parked) => parked.some((entry) => entry.name === name));
  const attemptOn = (i, name, afterId) => env.clients[i].getEventBuffer()
    .find((entry) => entry.event === 'giveUp:attempt' && entry.id > afterId && entry.data.appName === name);

  const placeOnEveryHolder = async (name, mode = 'r') => {
    await Promise.all(HOLDERS.map((i) => env.clients[i].holdCheckpoint(GIVEUP_BEFORE_PASS)));
    await installOnNodes(env, await buildSeedableApp({
      env,
      name,
      instances: 2,
      compose: [{
        name,
        description: 'a component that can write',
        repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: ['WRITE_FILE=/appdata/placed.txt', 'WRITE_CONTENT=placed', `WRITE_ON_SIGNAL=/appdata/${FINAL_SAVE}`],
        commands: [],
        containerPorts: [80],
        containerData: `${mode}:/appdata`,
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    }), HOLDERS);
    await waitFor(async () => (await Promise.all(HOLDERS.map((i) => running(i, name)))).every(Boolean), {
      timeout: 240000, interval: 3000, label: `three copies of ${name} up`,
    });
    await waitFor(async () => (await Promise.all(HOLDERS.map((i) => getFolderConfig(env.clients[i], folderOf(name)))))
      .every((folder) => folder?.type === 'sendreceive'), {
      timeout: 120000, interval: 3000, label: `every folder of ${name} sends`,
    });
    await waitFor(async () => (await locationCount(name)) === 3, {
      timeout: 120000, interval: 3000, label: `three locations of ${name}`,
    });
    await waitFor(() => parkedEverywhere(GIVEUP_BEFORE_PASS), {
      timeout: 180000, interval: 2000, label: 'a pass parked on every holder',
    });
    const { path } = await getFolderConfig(env.clients[0], folderOf(name));
    return `${path}/appdata`;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 }, syncthing: { leavingCopyWaitMs: 30000 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));
    await Promise.all([leavingApp, stayingApp, sharedApp, stayingSharedApp].map((name) => pushTestApp(name, 'v1', name, { user: 1000 })));
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  const leavesWithItsWrites = async (name, mode) => {
    const path = await placeOnEveryHolder(name, mode);
    const marks = HOLDERS.map((i) => env.clients[i].getLastEventId());
    await Promise.all(HOLDERS.map(async (i) => {
      const write = await execInContainer(env.clients[i].container,
        `echo last > "${path}/last-${i}.txt" && chown 1000:1000 "${path}/last-${i}.txt"`);
      expect(write.exitCode, `the last file on node ${i}`).to.equal(0);
    }));
    await Promise.all(HOLDERS.map((i) => env.clients[i].releaseAllCheckpoints()));

    await waitFor(async () => (await locationCount(name)) === 2, {
      timeout: 300000, interval: 1000, label: 'the surplus copy gone',
    });
    const states = await Promise.all(HOLDERS.map((i) => running(i, name)));
    const leaver = HOLDERS.find((i) => !states[i]);
    const staying = HOLDERS.filter((i) => i !== leaver);
    expect(leaver, 'a holder gave the app up').to.not.equal(undefined);

    await waitFor(async () => (await readPath(env.clients[staying[0]], `${path}/last-${staying[1]}.txt`)) !== null
      && (await readPath(env.clients[staying[1]], `${path}/last-${staying[0]}.txt`)) !== null, {
      timeout: 120000, interval: 1000, label: 'the staying copies hold each other\'s last file',
    });
    const reads = await Promise.all(staying.map(async (i) => ({
      last: await readPath(env.clients[i], `${path}/last-${leaver}.txt`),
      save: await readPath(env.clients[i], `${path}/${FINAL_SAVE}`),
    })));
    expect(reads.some(({ last }) => last !== null), 'the leaver\'s last file on a staying copy').to.equal(true);
    expect(reads.some(({ save }) => save !== null), 'the leaver\'s final save on a staying copy').to.equal(true);
    expect(attemptOn(leaver, name, marks[leaver])?.data).to.include({ proven: true, reason: 'SURPLUS' });
  };

  it('a surplus r: copy\'s last file and final save reach a copy that stays', async function () {
    this.timeout(600000);
    await leavesWithItsWrites(leavingApp, 'r');
  });

  it('a surplus s: copy\'s last file and final save reach a copy that stays', async function () {
    this.timeout(600000);
    await leavesWithItsWrites(sharedApp, 's');
  });

  const servesAgain = async (name, mode) => {
    const path = await placeOnEveryHolder(name, mode);
    const folder = folderOf(name);
    await Promise.all(HOLDERS.map((i) => env.clients[i].holdCheckpoint(BEFORE_SCAN, folder)));
    const marks = HOLDERS.map((i) => env.clients[i].getLastEventId());
    await Promise.all(HOLDERS.map((i) => env.clients[i].releaseCheckpoint(GIVEUP_BEFORE_PASS)));

    const parkedHere = async (i) => (await env.clients[i].holdCheckpoint(BEFORE_SCAN, folder)).parked
      .some((entry) => entry.name === BEFORE_SCAN && entry.key === folder);
    await waitFor(async () => (await Promise.all(HOLDERS.map(parkedHere))).some(Boolean), {
      timeout: 180000, interval: 1000, label: `an attempt on ${name} parked before its scan`,
    });
    const parked = await Promise.all(HOLDERS.map(parkedHere));
    const leaver = HOLDERS[parked.indexOf(true)];
    const peers = HOLDERS.filter((i) => i !== leaver);
    expect(await running(leaver, name), 'the attempt stopped the copy').to.equal(false);

    await env.partitionGroups([leaver], peers, { awaitSever: false });
    await env.clients[leaver].releaseAllCheckpoints();

    await waitFor(() => attemptOn(leaver, name, marks[leaver]), {
      timeout: 120000, interval: 1000, label: 'the attempt ended',
    });
    expect(attemptOn(leaver, name, marks[leaver]).data).to.include({ proven: false, code: 'COPY_NOT_HELD' });
    await waitFor(() => running(leaver, name), {
      timeout: 120000, interval: 2000, label: 'the copy serving again',
    });
    expect(await readPath(env.clients[leaver], `${path}/${FINAL_SAVE}`), 'the save the stop made, which no peer holds').to.not.equal(null);
    await env.healPartition([leaver], peers);
  };

  it('an r: copy no peer can be shown to hold serves again and deletes nothing', async function () {
    this.timeout(600000);
    await servesAgain(stayingApp, 'r');
  });

  it('an s: copy no peer can be shown to hold serves again and deletes nothing', async function () {
    this.timeout(600000);
    await servesAgain(stayingSharedApp, 's');
  });
});
