import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, getFolderStatus, scanFolder, statPath,
  getFileInfo, syncthingIdTables, stopDaemon,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import numericIdTables from '../../../ZelBack/src/services/utils/numericIdTables.js';

const { TABLES_SHA256 } = numericIdTables;

// fleet: 3
//
// On a legacy node FluxOS starts syncthing, and starts it resolving owners
// against the numeric id tables, so the owners of an app's files travel as
// numbers. Two moments decide whether that holds for every file:
//
//   - A node updated from a FluxOS that started syncthing plainly still has that
//     syncthing running. It resolves the host's names, so it would send them;
//     FluxOS replaces it, and turns folder ownership on only after it has.
//   - A host that cannot give syncthing a private mount namespace gets no
//     syncthing at all rather than one that resolves the host's names, and gets
//     one as soon as it can.
//   - The mount that holds the app volumes has to be shared for a volume mounted
//     later to reach syncthing's namespace. Where it is not, FluxOS makes it so.
//   - Only FluxOS writes the tables, so it checks them on the sentinel's first
//     pass and before each launch of syncthing, and on no pass between.
//
// The two holders give the same names different ids, as hosts do, so a name
// that travelled would land on the wrong id. A third node holds nothing: a node
// obtains the network policy only once it has as many peers as the harness's
// appSyncPeerThreshold.

const USERS = ['stown0', 'stown1'];
const GROUPS = ['stgrp0', 'stgrp1'];
const nodeUid = (node, j) => 4101 + ((j + node) % 2);
const nodeGid = (node, j) => 4001 + ((j + node) % 2);

describe('a legacy node\'s syncthing takes the numeric id tables before any owner is written', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eownlegacy${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const data = `/mnt/appdata/flux-apps/${folder}/appdata`;
  const LEGACY = 0;
  const ARCANE = 1;

  const client = (i) => env.clients[i];
  const sh = async (i, command) => execInContainer(client(i).container, command);
  const counter = async (i, name) => (await client(i).getTestCounters())?.[name] ?? 0;

  // syncthing's REST API on a node, for a write the read-only helpers do not make.
  async function syncthingPatch(i, path, body) {
    const r = await sh(i, 'H="${SYNCTHING_PATH:-$(getent passwd "${FLUX_FLUXOS_USER:-root}" | cut -d: -f6)/.config/syncthing}"; '
      + 'K=$(sed -n "s|.*<apikey>\\(.*\\)</apikey>.*|\\1|p" "$H/config.xml" | head -1); '
      + `curl -sS -f -X PATCH -H "X-API-Key: $K" -H 'Content-Type: application/json' -d '${JSON.stringify(body)}' "http://127.0.0.1:8384${path}"`);
    expect(r.exitCode, `fixture: PATCH ${path}: ${r.output}`).to.equal(0);
  }

  async function writeFile(i, name, uid, gid) {
    const r = await sh(i, `printf '${name}' > ${data}/${name} && chown ${uid}:${gid} ${data}/${name}`);
    expect(r.exitCode, `fixture: ${r.output}`).to.equal(0);
    await scanFolder(client(i), folder);
  }

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      legacyNodes: [LEGACY],
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1, masterSlaveStaggerMs: 10000 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await Promise.all(env.clients.map(async (c, node) => {
      const passwd = USERS.map((name, j) => `${name}:x:${nodeUid(node, j)}:${nodeGid(node, j)}::/nonexistent:/usr/sbin/nologin`).join('\\n');
      const group = GROUPS.map((name, j) => `${name}:x:${nodeGid(node, j)}:`).join('\\n');
      const r = await execInContainer(c.container, `printf '${passwd}\\n' >> /etc/passwd && printf '${group}\\n' >> /etc/group`);
      expect(r.exitCode, `fixture: names on node ${node}: ${r.output}`).to.equal(0);
    }));

    await pushTestApp(appName, 'v1', 'ownlegacy', { user: '4101:4001' });
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: 2,
      compose: [{
        name: appName,
        description: 'legacy syncthing names',
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
    });
    await installOnNodes(env, app, [LEGACY]);
    await waitForUp(client(LEGACY), appName, 'the legacy node runs the app', { timeout: 300000, interval: 3000 });
    await installOnNodes(env, app, [ARCANE]);
    await waitFor(() => isFolderSynced(client(ARCANE), folder), {
      timeout: 300000, interval: 3000, label: 'the Arcane node has the legacy node\'s data',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('replaces a syncthing that resolves the host\'s names, and turns ownership on only once it has', async function () {
    this.timeout(900000);
    // The node as an update leaves it: FluxOS stops, a syncthing started plainly
    // runs on, and the app's folder does not carry ownership yet.
    await crashFluxos(client(LEGACY).container, { hold: true });
    await stopDaemon(client(LEGACY));
    const started = await sh(LEGACY, 'H="$(getent passwd root | cut -d: -f6)/.config/syncthing"; '
      + 'nohup syncthing --no-browser --allow-newer-config --home "$H" >/dev/null 2>&1 </dev/null & true');
    expect(started.exitCode, `fixture: ${started.output}`).to.equal(0);
    await waitFor(() => isDaemonUp(client(LEGACY)), { timeout: 60000, interval: 1000, label: 'fixture: the plain syncthing answers' });
    expect((await syncthingIdTables(client(LEGACY))).every((v) => v.tables !== TABLES_SHA256), 'fixture: the plain syncthing resolves the host\'s names').to.equal(true);
    await syncthingPatch(LEGACY, `/rest/config/folders/${folder}`, { syncOwnership: false });
    await syncthingPatch(ARCANE, `/rest/config/folders/${folder}`, { syncOwnership: false });

    const mark = client(LEGACY).getLastEventId();
    await releaseFluxos(client(LEGACY).container);

    // Held on every poll until ownership is on: a syncthing that resolves the
    // host's names never has a folder that carries ownership.
    const violations = [];
    await waitFor(async () => {
      const views = await syncthingIdTables(client(LEGACY));
      const folderConfig = await getFolderConfig(client(LEGACY), folder).catch(() => null);
      if (views.some((v) => v.tables !== TABLES_SHA256) && folderConfig?.syncOwnership) {
        violations.push({ views, syncOwnership: folderConfig.syncOwnership });
      }
      return folderConfig?.syncOwnership === true && views.length > 0 && views.every((v) => v.tables === TABLES_SHA256);
    }, { timeout: 600000, interval: 500, label: 'ownership on, under a syncthing with the numeric id tables' });
    expect(violations, 'ownership on a folder of a syncthing that resolves the host\'s names').to.deep.equal([]);

    const replaced = await client(LEGACY).waitForEvent('syncthing:namesVisible', () => true, 10000, { afterId: mark });
    const opened = await client(LEGACY).waitForEvent('syncthing:ownersByNumber', () => true, 10000, { afterId: mark });
    expect(replaced.id, 'the plain syncthing was replaced before ownership was opened').to.be.lessThan(opened.id);

    // What leaves the node from here carries the number and no name.
    await writeFile(LEGACY, 'after-replacement', 4101, 4002);
    await waitFor(async () => {
      const got = await statPath(client(ARCANE), `${data}/after-replacement`);
      return got?.uid === 4101 && got?.gid === 4002;
    }, { timeout: 300000, interval: 3000, label: 'the file reached the Arcane node as 4101:4002' });
    const record = await getFileInfo(client(ARCANE), folder, 'appdata/after-replacement');
    expect(record.global.platform.Unix, 'the owner the cluster agreed on').to.include({
      UID: 4101, GID: 4002, OwnerName: '4101', GroupName: '4002',
    });
  });

  it('starts no syncthing where the namespace cannot be made, and one as soon as it can', async function () {
    this.timeout(900000);
    const unshare = (await sh(LEGACY, 'command -v unshare')).stdout.trim();
    expect(unshare, 'fixture: unshare on the node').to.not.equal('');
    const shimmed = await sh(LEGACY, `mv ${unshare} ${unshare}.real && `
      + `printf '#!/bin/sh\\necho "unshare: unshare failed: Operation not permitted" >&2\\nexit 1\\n' > ${unshare} && chmod 755 ${unshare}`);
    expect(shimmed.exitCode, `fixture: ${shimmed.output}`).to.equal(0);

    // Taken before syncthing stops: the announcement after it is of the syncthing
    // started once the namespace can be made again.
    const mark = client(LEGACY).getLastEventId();
    try {
      const failedBefore = await counter(LEGACY, 'syncthing:launchFailed');
      await stopDaemon(client(LEGACY));
      await waitFor(async () => (await counter(LEGACY, 'syncthing:launchFailed')) >= failedBefore + 2, {
        timeout: 400000, interval: 3000, label: 'two sentinel passes could not start syncthing with the numeric id tables',
      });
      // Checked again over a while, not once: nothing started it plainly.
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        expect(await syncthingIdTables(client(LEGACY)), 'a syncthing runs').to.deep.equal([]);
        // eslint-disable-next-line no-await-in-loop
        await sleepUnlessInfraDead(2000);
      }
    } finally {
      await sh(LEGACY, `mv ${unshare}.real ${unshare}`);
    }

    await client(LEGACY).waitForEvent('syncthing:ownersByNumber', () => true, 240000, { afterId: mark });
    const views = await syncthingIdTables(client(LEGACY));
    expect(views.length && views.every((v) => v.tables === TABLES_SHA256), `the syncthing it started: ${JSON.stringify(views)}`).to.equal(true);
    await waitFor(async () => (await getFolderStatus(client(LEGACY), folder))?.state === 'idle', {
      timeout: 120000, interval: 2000, label: 'the folder is back',
    });
  });

  it('makes the mount that holds the app volumes shared where it is not, and starts syncthing with the tables', async function () {
    this.timeout(600000);
    const target = (await sh(LEGACY, `findmnt -no TARGET -T ${data}/..`)).stdout.trim();
    expect(target, 'fixture: the mount that holds the app volumes').to.not.equal('');
    const made = await sh(LEGACY, `mount --make-rprivate ${target} && findmnt -no PROPAGATION ${target}`);
    expect(made.stdout.trim(), `fixture: ${made.output}`).to.equal('private');

    const mark = client(LEGACY).getLastEventId();
    await stopDaemon(client(LEGACY));
    await client(LEGACY).waitForEvent('syncthing:ownersByNumber', () => true, 400000, { afterId: mark });

    expect((await sh(LEGACY, `findmnt -no PROPAGATION ${target}`)).stdout.trim(), 'the mount that holds the app volumes')
      .to.include('shared');
    const views = await syncthingIdTables(client(LEGACY));
    expect(views.length && views.every((v) => v.tables === TABLES_SHA256), `the syncthing it started: ${JSON.stringify(views)}`).to.equal(true);
    await waitFor(async () => (await getFolderStatus(client(LEGACY), folder))?.state === 'idle', {
      timeout: 120000, interval: 2000, label: 'the folder is back',
    });
  });

  it('checks the tables on its first pass and before a launch, and on no pass between', async function () {
    this.timeout(900000);
    const TABLES_DIR = 'D="$(getent passwd root | cut -d: -f6)/.config/syncthing/numeric-ids"; ';
    const tablesOnDisk = async () => (await sh(LEGACY, `${TABLES_DIR}cat "$D/passwd" "$D/group" 2>/dev/null | sha256sum | cut -c1-64`)).stdout.trim();
    const counters = async () => (await client(LEGACY).getTestCounters()) ?? {};
    const checked = async (moment) => (await counters())['syncthing:idTablesChecked']?.[moment] ?? 0;
    const passes = async () => (await counters())['syncthing:supervisionPass'] ?? 0;
    const numeric = async () => {
      const views = await syncthingIdTables(client(LEGACY));
      return views.length > 0 && views.every((v) => v.tables === TABLES_SHA256);
    };
    expect(await numeric(), 'fixture: syncthing runs with the tables').to.equal(true);

    // A FluxOS starting over a deleted table: its first pass writes it back, and
    // the syncthing still holding the deleted file is replaced by one bound to it.
    await crashFluxos(client(LEGACY).container, { hold: true });
    const removed = await sh(LEGACY, `${TABLES_DIR}rm "$D/group" && test ! -e "$D/group"`);
    expect(removed.exitCode, `fixture: ${removed.output}`).to.equal(0);
    const restarted = client(LEGACY).getLastEventId();
    await releaseFluxos(client(LEGACY).container);

    await waitFor(async () => (await checked('start')) === 1, {
      timeout: 300000, interval: 2000, label: 'the first pass checked the tables',
    });
    expect(await tablesOnDisk(), 'the tables the first pass left on disk').to.equal(TABLES_SHA256);
    const replaced = await client(LEGACY).waitForEvent('syncthing:namesVisible', () => true, 240000, { afterId: restarted });
    const reopened = await client(LEGACY).waitForEvent('syncthing:ownersByNumber', () => true, 240000, { afterId: replaced.id });
    expect(reopened.id).to.be.greaterThan(replaced.id);
    expect(await numeric(), 'the syncthing it started').to.equal(true);

    // Ordinary passes leave the tables alone.
    const passed = await passes();
    await waitFor(async () => (await passes()) >= passed + 3, {
      timeout: 400000, interval: 3000, label: 'three more sentinel passes',
    });
    expect(await checked('start'), 'checks on the first pass').to.equal(1);
    expect(await checked('launch'), 'checks before a launch').to.equal(0);

    // A launch checks them, and writes back what is missing.
    const removedAgain = await sh(LEGACY, `${TABLES_DIR}rm "$D/passwd" && test ! -e "$D/passwd"`);
    expect(removedAgain.exitCode, `fixture: ${removedAgain.output}`).to.equal(0);
    const mark = client(LEGACY).getLastEventId();
    await stopDaemon(client(LEGACY));
    await client(LEGACY).waitForEvent('syncthing:ownersByNumber', () => true, 400000, { afterId: mark });
    expect(await checked('launch'), 'checks before a launch').to.equal(1);
    expect(await checked('start'), 'checks on the first pass').to.equal(1);
    expect(await tablesOnDisk(), 'the tables the launch left on disk').to.equal(TABLES_SHA256);
    expect(await numeric(), 'the syncthing it started').to.equal(true);
    await waitFor(async () => (await getFolderStatus(client(LEGACY), folder))?.state === 'idle', {
      timeout: 120000, interval: 2000, label: 'the folder is back',
    });
  });
});
