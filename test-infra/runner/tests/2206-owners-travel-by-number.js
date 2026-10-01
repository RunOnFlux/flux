import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  execInContainer, isAppContainerRunning, crashFluxos, releaseFluxos,
} from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, getFolderStatus, scanFolder, statPath,
  getFileInfo, syncthingIdTables, startDaemon, stopDaemon, getConnections, getListenAddresses, getDaemonVersion, installedSyncthingVersion,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { followPrimary } from '../framework/fdm-control.js';
import numericIdTables from '../../../ZelBack/src/services/utils/numericIdTables.js';

const { TABLES_SHA256 } = numericIdTables;

// fleet: 4
//
// A single-writer (g:) app's files keep their numeric owners on every copy,
// whatever names the hosts give those ids.
//
// syncthing gives a received file the owner NAMED by the sender when the
// receiving host has that name, and the sender's number otherwise, and it counts
// an owner as unchanged when either the numbers or the names match. App files
// carry container ids, and hosts name them differently. Every syncthing here
// resolves owners against the numeric id tables, which name each id by its own
// number - on a legacy node because FluxOS starts it that way, on an Arcane node
// because the OS does - so every owner travels as its number and a change of
// owner alone is a change.
//
// Each node is given the same user and group names at different ids, rotated so
// that no two nodes agree: name j is id BASE + (j + node) % 3. The last test
// turns the fix off on a sender and a receiver and shows the file then arriving
// with the id its name has on the receiver, so this fixture is one that would
// catch the defect.

const USERS = ['stown0', 'stown1', 'stown2'];
const GROUPS = ['stgrp0', 'stgrp1', 'stgrp2'];
const UID_BASE = 4101;
const GID_BASE = 4001;
const nodeUid = (node, j) => UID_BASE + ((j + node) % 3);
const nodeGid = (node, j) => GID_BASE + ((j + node) % 3);

// The app runs as this user and group. It writes one file readable and writable
// by its owner alone when it starts, and rewrites it on every start - so a copy
// whose owner came out wrong cannot start the app.
const APP_UID = 4101;
const APP_GID = 4001;
const OWNED_FILE = 'owned.bin';
// No host names this id.
const UNNAMED_ID = 54321;

describe('owners travel by number on real syncthing', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eownnum${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const data = `${root}/appdata`;
  const image = `${REGISTRY_REPO_HOST}/${appName}:v1`;
  // Placed in this order, so the election ranks them in it: a legacy primary, an
  // Arcane standby, and a legacy standby whose FluxOS runs as an unprivileged
  // user. The fourth node holds nothing and keeps the ring whole while the
  // primary is down.
  const PRIMARY = 0;
  const ARCANE = 1;
  const UNPRIVILEGED = 2;
  const HOLDERS = [PRIMARY, ARCANE, UNPRIVILEGED];
  const LEGACY = [PRIMARY, UNPRIVILEGED];

  const client = (i) => env.clients[i];
  const sh = async (i, command) => execInContainer(client(i).container, command);
  const runners = async () => {
    const running = await Promise.all(HOLDERS.map((i) => isAppContainerRunning(client(i).container, appName)));
    return HOLDERS.filter((_, k) => running[k]);
  };

  // Writes a tree on a node's copy as root, with the owners and modes given, and
  // has that node's syncthing notice it now rather than at its watcher's delay.
  async function writeTree(i, entries) {
    const script = entries.map(({ path, dir, uid, gid, mode }) => (dir
      ? `mkdir -p ${data}/${path} && chown ${uid}:${gid} ${data}/${path} && chmod ${mode} ${data}/${path}`
      : `printf '${path}' > ${data}/${path} && chown ${uid}:${gid} ${data}/${path} && chmod ${mode} ${data}/${path}`)).join(' && ');
    const r = await sh(i, script);
    expect(r.exitCode, `fixture: writing on node ${i}: ${r.output}`).to.equal(0);
    await scanFolder(client(i), folder);
  }

  // Waits until a path on a node's copy holds what the writer's copy holds.
  async function arrived(i, path, expected) {
    await waitFor(async () => {
      const got = await statPath(client(i), `${data}/${path}`);
      return got !== null && got.uid === expected.uid && got.gid === expected.gid;
    }, { timeout: 240000, interval: 3000, label: `${path} reached node ${i} as ${expected.uid}:${expected.gid}` });
  }

  // The same image, as the given user, run against a node's copy: exit 0 when it
  // can write every directory named, 73 when one refuses it.
  async function probeAs(i, user, dirs) {
    const r = await sh(i, `docker run --rm --user ${user} -v ${data}:/appdata `
      + `-e WRITE_PROBE=${dirs.map((d) => `/appdata/${d}`).join(',')} -e EXIT_AFTER_MS=1 -e EXIT_CODE=0 ${image}; echo "rc=$?"`);
    return Number(/rc=(\d+)/.exec(r.stdout)?.[1]);
  }

  // A syncthing on the node that resolves names: started plainly, in the home
  // FluxOS or the OS gives it.
  async function startNameResolvingSyncthing(i) {
    await stopDaemon(client(i));
    const r = await sh(i, 'H="${SYNCTHING_PATH:-$(getent passwd "${FLUX_FLUXOS_USER:-root}" | cut -d: -f6)/.config/syncthing}"; '
      + 'nohup syncthing --no-browser --allow-newer-config --home "$H" >/dev/null 2>&1 </dev/null & true');
    expect(r.exitCode, `fixture: ${r.output}`).to.equal(0);
    await waitFor(() => isDaemonUp(client(i)), { timeout: 60000, interval: 1000, label: `node ${i}'s name-resolving syncthing answers` });
    const views = await syncthingIdTables(client(i));
    expect(views.length && views.every((v) => v.tables !== TABLES_SHA256), `fixture: node ${i}'s syncthing resolves the host's names: ${JSON.stringify(views)}`).to.equal(true);
  }

  before(async function () {
    this.timeout(1200000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      legacyNodes: LEGACY,
      unprivilegedNodes: [UNPRIVILEGED],
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    // Before any file carries these ids, so no syncthing has looked one up.
    await Promise.all(env.clients.map(async (c, node) => {
      const passwd = USERS.map((name, j) => `${name}:x:${nodeUid(node, j)}:${nodeGid(node, j)}::/nonexistent:/usr/sbin/nologin`).join('\\n');
      const group = GROUPS.map((name, j) => `${name}:x:${nodeGid(node, j)}:`).join('\\n');
      const r = await execInContainer(c.container, `printf '${passwd}\\n' >> /etc/passwd && printf '${group}\\n' >> /etc/group`);
      expect(r.exitCode, `fixture: names on node ${node}: ${r.output}`).to.equal(0);
    }));

    // FDM names whichever holder runs the app, as it does in production, so the
    // takeover below follows the primary FDM stopped naming.
    await followPrimary(appName, { nodes: HOLDERS.map((i) => new URL(client(i).url).host), gNames: [folder] });

    await pushTestApp(appName, 'v1', 'ownnum', { user: `${APP_UID}:${APP_GID}` });
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: [{
        name: appName,
        description: 'owners by number',
        repotag: image,
        ports: [],
        domains: [''],
        environmentParameters: [`WRITE_FILE=/appdata/${OWNED_FILE}`, 'WRITE_MODE=0600', 'WRITE_CONTENT=owned'],
        commands: [],
        containerPorts: [80],
        containerData: 'g:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    await installOnNodes(env, app, [PRIMARY]);
    await waitForUp(client(PRIMARY), appName, 'the legacy primary runs the app', { timeout: 300000, interval: 3000 });
    for (const i of [ARCANE, UNPRIVILEGED]) {
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, app, [i]);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => isFolderSynced(client(i), folder), {
        timeout: 300000, interval: 3000, label: `node ${i} has the primary's data`,
      });
    }
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('runs every syncthing with the numeric id tables, where FluxOS starts it and where the OS does', async function () {
    this.timeout(120000);
    for (const i of HOLDERS) {
      // eslint-disable-next-line no-await-in-loop
      const views = await syncthingIdTables(client(i));
      expect(views.length, `a syncthing runs on node ${i}`).to.be.greaterThan(0);
      for (const view of views) {
        expect(view.tables, `what syncthing ${view.pid} on node ${i} resolves owners against`).to.equal(TABLES_SHA256);
      }
      // eslint-disable-next-line no-await-in-loop
      const host = await sh(i, `getent passwd ${USERS[0]} | cut -d: -f3`);
      expect(Number(host.stdout.trim()), `the host of node ${i} still has its names`).to.equal(nodeUid(i, 0));
    }
    for (const i of LEGACY) {
      // eslint-disable-next-line no-await-in-loop
      const opened = await client(i).waitForEvent('syncthing:ownersByNumber', () => true, 60000);
      expect(opened, `FluxOS on legacy node ${i} announced a syncthing that resolves owners by number`).to.not.equal(null);
    }
  });

  it('delivers files and directories with the numbers the writer gave them, though every host names those numbers differently', async function () {
    this.timeout(420000);
    const tree = [
      { path: 'u', dir: true, uid: 4101, gid: 4002, mode: '700' },
      { path: 'u/data', uid: 4101, gid: 4002, mode: '600' },
      { path: 'g', dir: true, uid: 0, gid: APP_GID, mode: '770' },
      { path: 'g/data', uid: 4103, gid: APP_GID, mode: '660' },
      { path: 'mixed', uid: 4102, gid: 4003, mode: '644' },
    ];
    await writeTree(PRIMARY, tree);

    for (const i of [ARCANE, UNPRIVILEGED]) {
      for (const entry of tree) {
        // eslint-disable-next-line no-await-in-loop
        await arrived(i, entry.path, entry);
        // eslint-disable-next-line no-await-in-loop
        expect(await statPath(client(i), `${data}/${entry.path}`), `${entry.path} on node ${i}`)
          .to.deep.equal({ uid: entry.uid, gid: entry.gid, mode: entry.mode });
      }
    }

    // The fixture is one where names would have moved them: the writer names
    // 4101 and 4002, and each receiver gives those names other numbers.
    const writerUser = (await sh(PRIMARY, 'getent passwd 4101 | cut -d: -f1')).stdout.trim();
    const writerGroup = (await sh(PRIMARY, 'getent group 4002 | cut -d: -f1')).stdout.trim();
    expect([writerUser, writerGroup], 'fixture: the writer\'s host names the ids').to.deep.equal([USERS[0], GROUPS[1]]);
    for (const i of [ARCANE, UNPRIVILEGED]) {
      // eslint-disable-next-line no-await-in-loop
      const elsewhere = Number((await sh(i, `getent passwd ${writerUser} | cut -d: -f3`)).stdout.trim());
      expect(elsewhere, `fixture: node ${i} gives ${writerUser} another number`).to.not.equal(4101);
    }

    // And the cluster's record of the file names each id by its number.
    const record = await getFileInfo(client(ARCANE), folder, 'appdata/u/data');
    expect(record.global.platform.Unix, 'the owner the cluster agreed on').to.include({
      UID: 4101, GID: 4002, OwnerName: '4101', GroupName: '4002',
    });
  });

  it('runs the syncthing release its image installed, and connects every holder to the others over TCP alone', async function () {
    this.timeout(120000);
    for (const i of HOLDERS) {
      // eslint-disable-next-line no-await-in-loop
      const connections = await getConnections(client(i));
      expect(connections.length, `fixture: node ${i} is connected to another holder`).to.be.greaterThan(0);
      expect(connections.filter((c) => !c.type?.startsWith('tcp-')), `node ${i}'s connections not over TCP`).to.deep.equal([]);
      // eslint-disable-next-line no-await-in-loop
      const listening = await getListenAddresses(client(i));
      // eslint-disable-next-line no-await-in-loop
      expect(await getDaemonVersion(client(i)), `the syncthing node ${i} runs`).to.equal(await installedSyncthingVersion(client(i)));
      expect(listening.filter((address) => !address.startsWith('tcp://')), `what node ${i}'s syncthing listens on besides TCP`).to.deep.equal([]);
    }
  });

  it('carries a change of owner alone from the primary to every standby', async function () {
    this.timeout(420000);
    const path = 'mixed';
    const unchanged = await getFileInfo(client(PRIMARY), folder, `appdata/${path}`);
    const changed = await sh(PRIMARY, `chown 4103:4001 ${data}/${path}`);
    expect(changed.exitCode, `fixture: ${changed.output}`).to.equal(0);
    await scanFolder(client(PRIMARY), folder);

    const owned = await getFileInfo(client(PRIMARY), folder, `appdata/${path}`);
    expect(owned.global.version, 'the primary gave the change a version').to.not.deep.equal(unchanged.global.version);
    for (const i of [ARCANE, UNPRIVILEGED]) {
      // eslint-disable-next-line no-await-in-loop
      await arrived(i, path, { uid: 4103, gid: 4001 });
    }
  });

  it('delivers root\'s files as root\'s and an id no host names as that id', async function () {
    this.timeout(300000);
    const tree = [
      { path: 'root-owned', uid: 0, gid: 0, mode: '644' },
      { path: 'unnamed', uid: UNNAMED_ID, gid: UNNAMED_ID, mode: '640' },
    ];
    await writeTree(PRIMARY, tree);
    for (const i of [ARCANE, UNPRIVILEGED]) {
      for (const entry of tree) {
        // eslint-disable-next-line no-await-in-loop
        await arrived(i, entry.path, entry);
      }
    }
  });

  it('lets the app\'s own user and group write every standby\'s copy, and no other', async function () {
    this.timeout(300000);
    await writeTree(PRIMARY, [
      { path: 'appuser', dir: true, uid: APP_UID, gid: APP_GID, mode: '700' },
      { path: 'appgroup', dir: true, uid: 0, gid: APP_GID, mode: '770' },
    ]);
    for (const i of [ARCANE, UNPRIVILEGED]) {
      // eslint-disable-next-line no-await-in-loop
      await arrived(i, 'appuser', { uid: APP_UID, gid: APP_GID });
      // eslint-disable-next-line no-await-in-loop
      await arrived(i, 'appgroup', { uid: 0, gid: APP_GID });
      // eslint-disable-next-line no-await-in-loop
      expect(await probeAs(i, `${APP_UID}:${APP_GID}`, ['appuser']), `the app's user writes node ${i}'s copy`).to.equal(0);
      // eslint-disable-next-line no-await-in-loop
      expect(await probeAs(i, `1234:${APP_GID}`, ['appgroup']), `the app's group writes node ${i}'s copy`).to.equal(0);
      // eslint-disable-next-line no-await-in-loop
      expect(await probeAs(i, '4102:4002', ['appuser', 'appgroup']), `another id writes node ${i}'s copy`).to.equal(73);
    }
  });

  it('gives a standby whose owners were changed the primary\'s numbers back', async function () {
    this.timeout(300000);
    const mark = client(ARCANE).getLastEventId();
    const changed = await sh(ARCANE, `chown -R 4102:4003 ${data}/u`);
    expect(changed.exitCode, `fixture: ${changed.output}`).to.equal(0);
    await scanFolder(client(ARCANE), folder);
    // Waited on as the revert itself: the folder's count of changed items lasts
    // only until that revert, which can come before a poll of the count.
    try {
      await client(ARCANE).waitForEvent('syncthing:localChangesReverted', (d) => d.folder === folder, 120000, { afterId: mark });
    } catch (error) {
      const status = await getFolderStatus(client(ARCANE), folder);
      const record = await getFileInfo(client(ARCANE), folder, 'appdata/u/data');
      throw new Error(`${error.message}; standby folder ${JSON.stringify({
        state: status.state, needFiles: status.needFiles, receiveOnlyChangedFiles: status.receiveOnlyChangedFiles, receiveOnlyChangedDirectories: status.receiveOnlyChangedDirectories,
      })}; u/data local ${JSON.stringify({ unix: record.local?.platform?.Unix, flags: record.local?.localFlags })} global ${JSON.stringify(record.global?.platform?.Unix)}`);
    }

    await arrived(ARCANE, 'u/data', { uid: 4101, gid: 4002 });
    expect(await statPath(client(ARCANE), `${data}/u`), 'the directory').to.deep.equal({ uid: 4101, gid: 4002, mode: '700' });
    expect((await getFolderStatus(client(ARCANE), folder)).receiveOnlyChangedFiles, 'files still changed').to.equal(0);
  });

  it('starts the app on the standby that takes over, which rewrites a file only its own user can', async function () {
    this.timeout(600000);
    expect(await statPath(client(ARCANE), `${data}/${OWNED_FILE}`), 'fixture: the file the app rewrites on start')
      .to.deep.equal({ uid: APP_UID, gid: APP_GID, mode: '600' });

    await crashFluxos(client(PRIMARY).container, { hold: true });
    await sh(PRIMARY, `docker kill ${folder}`);
    await stopDaemon(client(PRIMARY));

    await waitFor(async () => {
      const running = await runners();
      expect(running.length, `more than one node runs the component: ${running.join(', ')}`).to.be.at.most(1);
      return running.includes(ARCANE);
    }, { timeout: 420000, interval: 3000, label: 'the Arcane standby takes over and runs the app' });
    const logs = (await sh(ARCANE, `docker logs ${folder} 2>&1; true`)).stdout;
    expect(logs, 'the app rewrote its own file on the new primary').to.include(`write file ok: /appdata/${OWNED_FILE} (uid ${APP_UID})`);
  });

  it('carries the new primary\'s writes to a legacy standby by number', async function () {
    this.timeout(300000);
    await waitFor(async () => (await getFolderConfig(client(ARCANE), folder))?.type === 'sendreceive', {
      timeout: 120000, interval: 2000, label: 'the new primary\'s folder sends',
    });
    const tree = [{ path: 'from-arcane', uid: 4103, gid: 4001, mode: '640' }];
    await writeTree(ARCANE, tree);
    await arrived(UNPRIVILEGED, 'from-arcane', tree[0]);
  });

  it('brings the old primary back as a standby that receives by number', async function () {
    this.timeout(420000);
    const mark = client(PRIMARY).getLastEventId();
    await releaseFluxos(client(PRIMARY).container);
    await client(PRIMARY).waitForEvent('syncthing:ownersByNumber', () => true, 180000, { afterId: mark });
    const views = await syncthingIdTables(client(PRIMARY));
    expect(views.length && views.every((v) => v.tables === TABLES_SHA256), `the restarted syncthing: ${JSON.stringify(views)}`).to.equal(true);

    await waitFor(async () => (await getFolderConfig(client(PRIMARY), folder))?.type === 'receiveonly', {
      timeout: 300000, interval: 2000, label: 'the old primary stops sending',
    });
    await arrived(PRIMARY, 'from-arcane', { uid: 4103, gid: 4001 });
    expect(await runners(), 'the writer').to.deep.equal([ARCANE]);
  });

  // The control. With names hidden on either side a file keeps its number, and
  // with them visible on both it takes the number its name has on the receiver -
  // which is what every other test here would have seen without the fix.
  it('control: moves a file to the receiver\'s id for its name only when sender and receiver both resolve names', async function () {
    this.timeout(600000);
    await crashFluxos(client(UNPRIVILEGED).container, { hold: true });

    // Sender resolves names, receiver does not: the receiver keeps the number.
    await startNameResolvingSyncthing(ARCANE);
    await writeTree(ARCANE, [{ path: 'sender-names', uid: 4101, gid: 4001, mode: '644' }]);
    await arrived(UNPRIVILEGED, 'sender-names', { uid: 4101, gid: 4001 });
    const record = await getFileInfo(client(UNPRIVILEGED), folder, 'appdata/sender-names');
    expect(record.global.platform.Unix.OwnerName, 'fixture: the sender sent a name').to.equal(USERS[2]);

    // Both resolve names: the file takes the receiver's number for the sender's name.
    await startNameResolvingSyncthing(UNPRIVILEGED);
    await writeTree(ARCANE, [{ path: 'both-names', uid: 4101, gid: 4001, mode: '644' }]);
    const moved = { uid: nodeUid(UNPRIVILEGED, 2), gid: nodeGid(UNPRIVILEGED, 2) };
    expect(moved, 'fixture: the receiver names differ').to.not.deep.equal({ uid: 4101, gid: 4001 });
    await arrived(UNPRIVILEGED, 'both-names', moved);

    // Put back the way each node's supervisor starts syncthing.
    await stopDaemon(client(ARCANE));
    await startDaemon(client(ARCANE));
    const mark = client(UNPRIVILEGED).getLastEventId();
    await releaseFluxos(client(UNPRIVILEGED).container);
    await client(UNPRIVILEGED).waitForEvent('syncthing:ownersByNumber', () => true, 180000, { afterId: mark });
  });
});
