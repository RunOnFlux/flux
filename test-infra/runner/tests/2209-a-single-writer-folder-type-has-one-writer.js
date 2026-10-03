import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import {
  setSynced, resetSyncState, getFolderWrites, getFolderScans, getFolderConfig, setFolderConfig,
  getPendingFolderWrites, setFolderPatchDelay, setScanDuration, injectSyncthingEvent, getPendingFolderScans,
} from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  waitFor, electionDecisionCount, waitForReconcilerDesiredChanged,
} from '../framework/wait.js';
import { bootAndPeer, placeGAppInOrder } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A single-writer (g:) folder's syncthing type has one writer, the primary role
// on each node, and every FluxOS write to a folder's config goes out one at a
// time. Each scenario runs on its own app, placed on the same three holders, and
// starts from one running primary and two standbys ready to take over.
//
// The syncthing stub applies config changes as syncthing does: one at a time,
// each answered once it has taken effect, a PATCH written back whole from the
// folder as it was when the request arrived.

const subnet = getSubnetConfig();

// Passes each node is counted deciding, after the change it is deciding on.
const HELD_PASSES = 3;

// Checkpoints, declared in fluxEventBus.Checkpoint.
const BEFORE_START = 'masterSlave:beforeStart';
const BEFORE_RUN = 'masterSlave:beforeRun';
const AFTER_FOLDER_READ = 'syncthing:afterFolderRead';
const BEFORE_FOLDER_WRITE = 'syncthing:beforeFolderWrite';

// FluxOS's timeout on a syncthing call, and a time well past it.
const FLUXOS_CALL_TIMEOUT_MS = 5000;
const SLOW_MS = 8000;
// A scan of a large folder: longer than any wait below allows a demotion.
const COVER_SCAN_MS = 90000;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('a single-writer folder type has one writer', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const holders = [0, 1, 2];
  const stamp = Date.now();

  const ipOf = (i) => subnet.nodeIp(i + 1);
  const identifierOf = (appName) => `${appName}_${appName}`;
  const folderOf = (appName) => `flux${appName}_${appName}`;
  const writesTo = async (i, folder) => (await getFolderWrites(ipOf(i))).filter((w) => w.id === folder);
  const scansOf = async (i, folder) => (await getFolderScans(ipOf(i))).filter((s) => s.id === folder);
  const electionCount = (i, appName, decision) => electionDecisionCount(env.clients[i], identifierOf(appName), decision);
  const folderPasses = (i, appName) => env.clients[i].getDecisionCount('syncthing:folderPass', folderOf(appName), 'evaluated');
  // The first write to a node's folder after the `from`th that matches, once
  // made: the stub records a write once it has taken effect.
  const writeSince = async (i, folder, from, match, label) => {
    let found;
    await waitFor(async () => {
      found = (await writesTo(i, folder)).slice(from).find(match);
      return !!found;
    }, { timeout: 120000, interval: 1000, label });
    return found;
  };
  const eventsSince = (i, from, event, match) => env.clients[i].getEventBuffer()
    .filter((e) => e.id > from && e.event === event && match(e.data ?? {}));

  // Resolves once each node has run HELD_PASSES more passes, as `passes` counts
  // them, than when this was called.
  const passesFromNow = async (nodes, passes, label) => {
    const from = await Promise.all(nodes.map(passes));
    await Promise.all(nodes.map((i, k) => waitFor(async () => (await passes(i)) >= from[k] + HELD_PASSES, {
      timeout: 180000, interval: 1000, label: `node ${i} ran ${HELD_PASSES} ${label} passes`,
    })));
  };

  // Places a g: app on the holders and waits for one running primary and two
  // standbys the election reads as ready to take over.
  const settle = async (appName) => {
    const folder = folderOf(appName);
    const identifier = identifierOf(appName);
    const from = holders.map((i) => env.clients[i].getLastEventId());
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
    await placeGAppInOrder(env, app, { placementOrder: holders, folder, identifier });
    await waitFor(async () => (await Promise.all(holders.map((i) => isUp(env.clients[i], appName)))).filter(Boolean).length === 1, {
      timeout: 300000, interval: 3000, label: `${appName} runs on one holder`,
    });
    const primary = holders[(await Promise.all(holders.map((i) => isUp(env.clients[i], appName)))).indexOf(true)];
    const standbys = holders.filter((i) => i !== primary);
    await Promise.all(standbys.map((i) => setSynced({ ip: ipOf(i), folder })));
    await Promise.all(standbys.map((i) => env.clients[i].waitForEvent('syncthing:folderReady',
      (d) => d.folder === folder, 180000, { afterId: from[holders.indexOf(i)] })));
    expect((await getFolderConfig(ipOf(primary), folder))?.type, 'fixture: the primary\'s folder sends').to.equal('sendreceive');
    await Promise.all(standbys.map(async (i) => expect((await getFolderConfig(ipOf(i), folder))?.type,
      `fixture: standby ${i}'s folder receives`).to.equal('receiveonly')));
    return {
      appName, folder, identifier, primary, standbys,
    };
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('puts a standby\'s folder found sending back to receiving, scanned first', async function () {
    this.timeout(900000);
    // No primary named, so only the syncthing monitor acts on a standby.
    const a = await settle(`e2eheldstby${stamp}`);
    const standby = a.standbys[0];
    const writesBefore = (await writesTo(standby, a.folder)).length;
    const scansBefore = (await scansOf(standby, a.folder)).length;
    const startedBefore = await electionCount(standby, a.appName, 'started');

    await setFolderConfig({ ip: ipOf(standby), folder: a.folder, fields: { type: 'sendreceive' } });

    const write = await writeSince(standby, a.folder, writesBefore, (w) => w.body?.type === 'receiveonly',
      'a FluxOS write makes the standby\'s folder receive');
    expect((await getFolderConfig(ipOf(standby), a.folder))?.type).to.equal('receiveonly');
    const scan = (await scansOf(standby, a.folder)).slice(scansBefore)[0];
    expect(scan, 'the folder was not scanned before it stopped sending').to.not.equal(undefined);
    expect(scan.seq, 'the folder stopped sending before its scan finished').to.be.below(write.arrivedSeq);
    await passesFromNow([standby], (i) => electionCount(i, a.appName, 'evaluated'), 'election');
    expect(await electionCount(standby, a.appName, 'started'), 'the standby started the component').to.equal(startedBefore);
  });

  it('makes the running primary\'s folder found receiving send again', async function () {
    this.timeout(900000);
    // Only the election makes a running primary's folder send: FDM names it.
    const a = await settle(`e2eheldprim${stamp}`);
    const client = env.clients[a.primary];
    const observedBefore = await electionCount(a.primary, a.appName, 'evaluated');
    await electMaster(a.appName, client.ip);
    await waitFor(async () => (await electionCount(a.primary, a.appName, 'evaluated')) >= observedBefore + HELD_PASSES, {
      timeout: 120000, interval: 1000, label: 'the primary ran election passes with FDM naming it',
    });
    const writesBefore = (await writesTo(a.primary, a.folder)).length;

    await setFolderConfig({ ip: ipOf(a.primary), folder: a.folder, fields: { type: 'receiveonly' } });

    await writeSince(a.primary, a.folder, writesBefore, (w) => w.body?.type === 'sendreceive',
      'a FluxOS write makes the primary\'s folder send');
    expect((await getFolderConfig(ipOf(a.primary), a.folder))?.type).to.equal('sendreceive');
    expect(await isUp(client, a.appName), 'the primary stopped running the component').to.equal(true);
  });

  it('abandons a promotion whose volume goes unsafe before its folder sends', async function () {
    this.timeout(900000);
    const a = await settle(`e2eunsafe${stamp}`);
    const target = a.standbys[0];
    const client = env.clients[target];
    const dir = `/mnt/appdata/flux-apps/${a.folder}`;
    const from = client.getLastEventId();
    const writesBefore = (await writesTo(target, a.folder)).length;

    await client.holdCheckpoint(BEFORE_START, a.identifier);
    try {
      await electMaster(a.appName, client.ip);
      await client.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_START && d.key === a.identifier, 300000, { afterId: from });
      // The volume leaves the directory under the node and cannot be mounted
      // again, as suite 61 does it; syncthing reports the folder's marker gone.
      const unmount = await execInContainer(client.container,
        `umount -l ${dir} && chattr -i ${dir} && rm -f /mnt/appdata/${a.folder}FLUXFSVOL`);
      expect(unmount.exitCode, `fixture: the volume could not be taken away: ${unmount.output}`).to.equal(0);
      await injectSyncthingEvent({ ip: ipOf(target), type: 'FolderErrors', data: { folder: a.folder, errors: [{ error: 'folder marker missing' }] } });
      await waitForReconcilerDesiredChanged(client, a.identifier, 'stopped', 120000, { afterId: from });
    } finally {
      await client.releaseCheckpoint(BEFORE_START, a.identifier)
        .catch((err) => console.warn(`cleanup: checkpoint release failed: ${err.message}`));
    }

    const ended = await client.waitForEvent('primaryRole:changed',
      (d) => d.identifier === a.identifier && d.from === 'promoting', 120000, { afterId: from });
    expect(ended.data.to, 'the promotion was not abandoned').to.equal('standby');
    await passesFromNow([target], (i) => electionCount(i, a.appName, 'evaluated'), 'election');
    expect((await writesTo(target, a.folder)).slice(writesBefore).map((w) => w.body?.type),
      'the folder over the unsafe volume was made to send').to.not.include('sendreceive');
    expect(eventsSince(target, from, 'reconciler:actuated', (d) => d.identifier === a.identifier && d.action === 'started'),
      'the component started over the unsafe volume').to.deep.equal([]);
    expect(await isUp(client, a.appName)).to.equal(false);
  });

  // Two nodes can race for one app; FDM naming the other while this one is
  // promoting is what stands this one down, and it must hold at any point of
  // the promotion - here, its folder sending and covered, the container not yet
  // asked for.
  it('runs no container on a node stood down once its folder sends and before it asks to run it', async function () {
    this.timeout(900000);
    const a = await settle(`e2eraced${stamp}`);
    const [target, other] = a.standbys;
    const client = env.clients[target];
    const from = client.getLastEventId();

    await client.holdCheckpoint(BEFORE_RUN, a.identifier);
    try {
      await electMaster(a.appName, client.ip);
      await client.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RUN && d.key === a.identifier, 300000, { afterId: from });
      expect((await getFolderConfig(ipOf(target), a.folder))?.type, 'fixture: the promoting folder sends').to.equal('sendreceive');

      const observed = await electionCount(target, a.appName, 'primaryObserved');
      await electMaster(a.appName, env.clients[other].ip);
      // A pass that reads the other node off FDM stands this one down in it.
      await waitFor(async () => (await electionCount(target, a.appName, 'primaryObserved')) > observed, {
        timeout: 180000, interval: 1000, label: 'the promoting node read the other node off FDM',
      });
    } finally {
      await client.releaseCheckpoint(BEFORE_RUN, a.identifier)
        .catch((err) => console.warn(`cleanup: checkpoint release failed: ${err.message}`));
    }

    const ended = await client.waitForEvent('primaryRole:changed',
      (d) => d.identifier === a.identifier && d.from === 'promoting', 120000, { afterId: from });
    expect(ended.data.to, 'the promotion was not stood down').to.equal('standby');
    expect(ended.data.reason).to.equal('stood down before it ran');
    await passesFromNow([target], (i) => electionCount(i, a.appName, 'evaluated'), 'election');
    expect(eventsSince(target, from, 'reconciler:actuated', (d) => d.identifier === a.identifier && d.action === 'started'),
      'the stood-down node started the component').to.deep.equal([]);
    expect(await isUp(client, a.appName)).to.equal(false);
    expect((await getFolderConfig(ipOf(target), a.folder))?.type, 'the stood-down node\'s folder').to.equal('receiveonly');
  });

  // The scans that cover a promoted folder's restart write no config, and the
  // demotion of a folder whose volume goes unsafe does not wait for them. A scan
  // over the unmounted directory is what would tell every peer its files are
  // gone, so none is asked for once the volume has gone.
  it('stops a promotion\'s folder sending at once when its volume goes unsafe during the scans that cover its restart, and scans it no more', async function () {
    this.timeout(900000);
    const a = await settle(`e2ecover${stamp}`);
    const target = a.standbys[0];
    const client = env.clients[target];
    const dir = `/mnt/appdata/flux-apps/${a.folder}`;
    const from = client.getLastEventId();
    const writesBefore = (await writesTo(target, a.folder)).length;
    const scansBefore = (await scansOf(target, a.folder)).length;
    await setScanDuration({ ip: ipOf(target), folder: a.folder, ms: COVER_SCAN_MS });
    let unmountedAt;
    let afterUnmount;
    try {
      await electMaster(a.appName, client.ip);
      const sends = await writeSince(target, a.folder, writesBefore, (w) => w.body?.type === 'sendreceive',
        'the promotion makes the folder send');
      await waitFor(async () => (await getPendingFolderScans(ipOf(target)))
        .some((scan) => scan.id === a.folder && scan.arrivedSeq > sends.seq), {
        timeout: 60000, interval: 500, label: 'a scan covering the folder\'s restart is under way',
      });
      const unmount = await execInContainer(client.container,
        `umount -l ${dir} && chattr -i ${dir} && rm -f /mnt/appdata/${a.folder}FLUXFSVOL`);
      expect(unmount.exitCode, `fixture: the volume could not be taken away: ${unmount.output}`).to.equal(0);
      unmountedAt = Date.now();
      afterUnmount = client.getLastEventId();
      await injectSyncthingEvent({ ip: ipOf(target), type: 'FolderErrors', data: { folder: a.folder, errors: [{ error: 'folder marker missing' }] } });

      const demote = await writeSince(target, a.folder, writesBefore, (w) => w.body?.type === 'receiveonly',
        'the folder over the unsafe volume stops sending');
      await waitForReconcilerDesiredChanged(client, a.identifier, 'stopped', 120000, { afterId: from });

      // Read while the slow scan still runs: the stub records a scan once it ends.
      const ended = (await scansOf(target, a.folder)).slice(scansBefore);
      expect(ended, 'fixture: the cover scan ended before the demotion was asked for').to.deep.equal([]);
      expect(demote.arrivedAt - unmountedAt, 'the demotion waited on the cover scan').to.be.below(COVER_SCAN_MS);
    } finally {
      await setScanDuration({ ip: ipOf(target), folder: a.folder, ms: 0 });
    }

    // The scan already under way ends; nothing after it is asked of the folder.
    await waitFor(async () => (await scansOf(target, a.folder)).length > scansBefore, {
      timeout: COVER_SCAN_MS + 60000, interval: 2000, label: 'the cover scan under way ends',
    });
    await passesFromNow([target], (i) => folderPasses(i, a.appName), 'folder');
    const scans = (await scansOf(target, a.folder)).slice(scansBefore);
    expect(scans.filter((scan) => scan.arrivedAt >= unmountedAt), 'a scan asked of the folder once its volume had gone').to.deep.equal([]);
    await waitFor(async () => !(await isUp(client, a.appName)), {
      timeout: 120000, interval: 2000, label: 'the component over the unsafe volume is stopped',
    });
    expect(eventsSince(target, afterUnmount, 'reconciler:actuated', (d) => d.identifier === a.identifier && d.action === 'started'),
      'the component started over the unsafe volume').to.deep.equal([]);
  });

  // A file written before the second cover scan starts is found by it, and one
  // written after is the watcher's, whatever the app does meanwhile: nothing
  // waits for the scans.
  it('runs a promoted component while the scans covering its folder\'s restart are still under way', async function () {
    this.timeout(900000);
    const a = await settle(`e2ecoverrun${stamp}`);
    const target = a.standbys[0];
    const client = env.clients[target];
    const writesBefore = (await writesTo(target, a.folder)).length;
    await setScanDuration({ ip: ipOf(target), folder: a.folder, ms: COVER_SCAN_MS });
    try {
      await electMaster(a.appName, client.ip);
      const sends = await writeSince(target, a.folder, writesBefore, (w) => w.body?.type === 'sendreceive',
        'the promotion makes the folder send');
      await waitFor(async () => isUp(client, a.appName), {
        timeout: COVER_SCAN_MS / 2, interval: 1000, label: 'the promoted component runs within half a cover scan',
      });
      const covering = (await getPendingFolderScans(ipOf(target))).filter((scan) => scan.id === a.folder && scan.arrivedSeq > sends.seq);
      expect(covering, 'the component ran only once the scans covering its folder\'s restart had ended').to.have.lengthOf(1);
    } finally {
      await setScanDuration({ ip: ipOf(target), folder: a.folder, ms: 0 });
    }
  });

  it('runs a component again after its backup while the scans covering its folder\'s restart are still under way', async function () {
    this.timeout(900000);
    const a = await settle(`e2ecoverbackup${stamp}`);
    const client = env.clients[a.primary];
    await electMaster(a.appName, client.ip);
    const writesBefore = (await writesTo(a.primary, a.folder)).length;
    await setScanDuration({ ip: ipOf(a.primary), folder: a.folder, ms: COVER_SCAN_MS });
    try {
      const auth = await authenticate(client.url, appOwnerKey());
      const started = Date.now();
      const body = await client.appendBackupTask(a.appName, [a.appName], auth.zelidauth);
      expect(body, 'fixture: the backup failed').to.not.match(/Unauthorized|error/i);
      expect(Date.now() - started, 'the backup waited on the scans covering its folder\'s restart').to.be.below(COVER_SCAN_MS);

      const resumed = await writeSince(a.primary, a.folder, writesBefore, (w) => w.body?.paused === false,
        'the backup resumes the folder');
      const covering = (await getPendingFolderScans(ipOf(a.primary))).filter((scan) => scan.id === a.folder && scan.arrivedSeq > resumed.seq);
      expect(covering, 'fixture: no scan covers the resumed folder\'s restart').to.have.lengthOf(1);
      await waitFor(async () => isUp(client, a.appName), {
        timeout: 120000, interval: 2000, label: 'the component runs again after its backup',
      });
    } finally {
      await setScanDuration({ ip: ipOf(a.primary), folder: a.folder, ms: 0 });
    }
  });

  it('stops the primary\'s folder sending when a restore leaves partial data', async function () {
    this.timeout(900000);
    const a = await settle(`e2erestore${stamp}`);
    const client = env.clients[a.primary];
    const dir = `/mnt/appdata/flux-apps/${a.folder}`;
    // A restore of a g: component runs on the node FDM names.
    await electMaster(a.appName, client.ip);
    const archive = `${dir}/backup/local/backup_${a.appName.toLowerCase()}.tar.gz`;
    const staged = await execInContainer(client.container,
      `rm -rf /tmp/s-${a.appName} && mkdir -p /tmp/s-${a.appName} && printf 'restored\\n' > /tmp/s-${a.appName}/restored.txt `
      + `&& mkdir -p ${dir}/backup/local && tar -czf ${archive} -C /tmp/s-${a.appName} .`);
    expect(staged.exitCode, `fixture: staging the archive failed: ${staged.output}`).to.equal(0);
    // The clear fails the way a volume gone read-only under an ext4 error does.
    const lock = await execInContainer(client.container, `chattr +i ${dir}/appdata`);
    expect(lock.exitCode, `fixture: could not make appdata immutable: ${lock.output}`).to.equal(0);
    const from = client.getLastEventId();
    const writesBefore = (await writesTo(a.primary, a.folder)).length;
    try {
      const auth = await authenticate(client.url, appOwnerKey());
      const body = await client.appendRestoreTask(a.appName, [{ component: a.appName, restore: true }], 'local', auth.zelidauth);
      expect(body, 'fixture: the restore did not fail at the clear').to.match(/could not clear/i);
      await waitForReconcilerDesiredChanged(client, a.identifier, 'stopped', 120000, { afterId: from });
    } finally {
      await execInContainer(client.container, `chattr -i ${dir}/appdata 2>/dev/null || true`);
    }

    await writeSince(a.primary, a.folder, writesBefore, (w) => w.body?.type === 'receiveonly',
      'a FluxOS write stops the folder holding partial data sending');
    expect((await getFolderConfig(ipOf(a.primary), a.folder))?.type).to.equal('receiveonly');
  });

  it('writes a folder only once the write before it is applied', async function () {
    this.timeout(900000);
    // The monitor holds a device change for the standby's folder, read before
    // the standby is promoted. Syncthing takes longer than FluxOS waits to apply
    // the promotion's type change; the monitor's write must not reach syncthing
    // until it is applied, or syncthing writes the folder back as the monitor
    // read it.
    const a = await settle(`e2equeue${stamp}`);
    const target = a.standbys[0];
    const client = env.clients[target];
    const ip = ipOf(target);
    const from = client.getLastEventId();
    const writesBefore = (await writesTo(target, a.folder)).length;
    await client.holdCheckpoint(BEFORE_FOLDER_WRITE, a.folder);
    try {
      await setFolderConfig({ ip, folder: a.folder, fields: { devices: [] } });
      await client.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_FOLDER_WRITE && d.key === a.folder, 120000, { afterId: from });
      await setFolderPatchDelay({ ip, ms: SLOW_MS });
      await electMaster(a.appName, client.ip);
      await waitFor(async () => (await getPendingFolderWrites(ip)).some((w) => w.id === a.folder && w.body?.type === 'sendreceive'), {
        timeout: 300000, interval: 500, label: 'the promotion\'s type change reached syncthing',
      });
    } finally {
      await client.releaseCheckpoint(BEFORE_FOLDER_WRITE, a.folder)
        .catch((err) => console.warn(`cleanup: checkpoint release failed: ${err.message}`));
    }

    const monitorWrite = async () => (await writesTo(target, a.folder)).slice(writesBefore)
      .find((w) => (w.body?.devices?.length ?? 0) > 1);
    try {
      await waitFor(async () => !!(await monitorWrite()), {
        timeout: 120000, interval: 1000, label: 'the monitor writes the folder\'s devices',
      });
    } finally {
      await setFolderPatchDelay({ ip, ms: 0 });
    }
    const promotion = (await writesTo(target, a.folder)).slice(writesBefore).find((w) => w.body?.type === 'sendreceive');
    expect(promotion, 'fixture: the promotion\'s type change was not applied').to.not.equal(undefined);
    expect((await monitorWrite()).arrivedSeq, 'the monitor wrote before the promotion was applied')
      .to.be.above(promotion.appliedSeq);
    const settled = await getFolderConfig(ip, a.folder);
    expect(settled?.type, 'the promotion was undone').to.equal('sendreceive');
    expect(settled?.devices?.length, 'the monitor\'s device change was lost').to.be.above(1);
  });

  it('tells peers a folder made writable after the monitor read the folder list is writable', async function () {
    this.timeout(900000);
    const a = await settle(`e2epublish${stamp}`);
    const target = a.standbys[0];
    const client = env.clients[target];
    // A device change gives the held pass a write to reach, so it stops at the
    // second checkpoint once it has published the writable folders.
    await setFolderConfig({ ip: ipOf(target), folder: a.folder, fields: { devices: [] } });
    const from = client.getLastEventId();
    await client.holdCheckpoint(AFTER_FOLDER_READ);
    await client.holdCheckpoint(BEFORE_FOLDER_WRITE, a.folder);
    try {
      await client.waitForEvent('checkpoint:held', (d) => d.name === AFTER_FOLDER_READ, 120000, { afterId: from });
      await electMaster(a.appName, client.ip);
      const promoted = await client.waitForEvent('primaryRole:changed',
        (d) => d.identifier === a.identifier && d.from === 'promoting', 300000, { afterId: from });
      expect(promoted.data.to, `fixture: the promotion did not finish: ${promoted.data.reason ?? ''}`).to.equal('primary');
      expect((await getFolderConfig(ipOf(target), a.folder))?.type, 'fixture: the folder sends').to.equal('sendreceive');

      const released = client.getLastEventId();
      await client.releaseCheckpoint(AFTER_FOLDER_READ);
      await client.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_FOLDER_WRITE && d.key === a.folder, 120000, { afterId: released });
      const published = await client.getPromotedFolders();
      expect(published.data?.ready, 'fixture: the node answered as not ready').to.equal(true);
      expect(published.data.folders, 'peers are told the folder is not writable').to.include(a.folder);
    } finally {
      await client.releaseAllCheckpoints().catch((err) => console.warn(`cleanup: checkpoint release failed: ${err.message}`));
    }
  });

  it('writes nothing to a folder whose config syncthing already holds', async function () {
    this.timeout(900000);
    const a = await settle(`e2esteady${stamp}`);
    const passes = (i) => folderPasses(i, a.appName);
    await passesFromNow(holders, passes, 'folder-election');
    const writesAtStart = await Promise.all(holders.map(async (i) => (await writesTo(i, a.folder)).length));

    await passesFromNow(holders, passes, 'folder-election');

    const writesAtEnd = await Promise.all(holders.map(async (i) => (await writesTo(i, a.folder)).length));
    expect(writesAtEnd, 'a pass rewrote a folder syncthing already held as the monitor would write it').to.deep.equal(writesAtStart);
  });

  it('stops a folder sending only once the scan before it has finished', async function () {
    this.timeout(900000);
    const a = await settle(`e2escan${stamp}`);
    const client = env.clients[a.primary];
    const from = client.getLastEventId();
    const writesBefore = (await writesTo(a.primary, a.folder)).length;
    const scansBefore = (await scansOf(a.primary, a.folder)).length;
    await setScanDuration({ ip: ipOf(a.primary), folder: a.folder, ms: SLOW_MS });
    try {
      await electMaster(a.appName, env.clients[a.standbys[0]].ip);
      const ended = await client.waitForEvent('primaryRole:changed',
        (d) => d.identifier === a.identifier && d.from === 'demoting', 300000, { afterId: from });
      expect(ended.data.to, `the stand-down did not finish: ${ended.data.reason ?? ''}`).to.equal('standby');
      expect(ended.data.reason, 'the stand-down left the folder sending').to.equal(undefined);
    } finally {
      await setScanDuration({ ip: ipOf(a.primary), folder: a.folder, ms: 0 });
    }

    // The stub records a scan once it has finished.
    let scan;
    await waitFor(async () => {
      [scan] = (await scansOf(a.primary, a.folder)).slice(scansBefore);
      return !!scan;
    }, { timeout: 120000, interval: 1000, label: 'the folder is scanned' });
    expect(scan.at - scan.arrivedAt, 'fixture: the scan took less than FluxOS waits for a syncthing call').to.be.above(FLUXOS_CALL_TIMEOUT_MS);
    const demote = await writeSince(a.primary, a.folder, writesBefore, (w) => w.body?.type === 'receiveonly',
      'a FluxOS write stops the folder sending');
    expect(demote.arrivedSeq, 'the folder stopped sending before its scan finished').to.be.above(scan.seq);
  });
});
