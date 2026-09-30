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
  getPendingFolderWrites, setFolderPatchDelay, setScanDuration, injectSyncthingEvent,
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
const AFTER_FOLDER_READ = 'syncthing:afterFolderRead';
const BEFORE_FOLDER_WRITE = 'syncthing:beforeFolderWrite';

// Longer than FluxOS's 5 s timeout on a syncthing call.
const SLOW_MS = 8000;

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

  it('makes the primary\'s folder receive at once, unscanned, when a restore leaves partial data', async function () {
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
    const scansBefore = (await scansOf(a.primary, a.folder)).length;
    try {
      const auth = await authenticate(client.url, appOwnerKey());
      const body = await client.appendRestoreTask(a.appName, [{ component: a.appName, restore: true }], 'local', auth.zelidauth);
      expect(body, 'fixture: the restore did not fail at the clear').to.match(/could not clear/i);
      await waitForReconcilerDesiredChanged(client, a.identifier, 'stopped', 120000, { afterId: from });
    } finally {
      await execInContainer(client.container, `chattr -i ${dir}/appdata 2>/dev/null || true`);
    }

    const demote = await writeSince(a.primary, a.folder, writesBefore, (w) => w.body?.type === 'receiveonly',
      'a FluxOS write stops the folder holding partial data sending');
    const scanned = (await scansOf(a.primary, a.folder)).slice(scansBefore).filter((s) => s.arrivedSeq < demote.arrivedSeq);
    expect(scanned, 'the partial data was scanned, so it went out as this node\'s version').to.deep.equal([]);
  });

  it('writes a folder only once the write before it has taken effect', async function () {
    this.timeout(900000);
    // The monitor holds a device change for the standby's folder, read before
    // the standby is promoted. Syncthing takes longer than FluxOS waits to apply
    // the promotion's type change; the monitor's write must not reach syncthing
    // until it has, or syncthing writes the folder back as the monitor read it.
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
    expect((await monitorWrite()).arrivedSeq, 'the monitor wrote while the promotion was still being applied')
      .to.be.above(promotion.seq);
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

    const scan = (await scansOf(a.primary, a.folder)).slice(scansBefore)[0];
    expect(scan, 'the folder was not scanned before it stopped sending').to.not.equal(undefined);
    expect(scan.at - scan.arrivedAt, 'fixture: the scan took less than FluxOS waits for a syncthing call').to.be.at.least(SLOW_MS);
    const demote = (await writesTo(a.primary, a.folder)).slice(writesBefore).find((w) => w.body?.type === 'receiveonly');
    expect(demote, 'the folder never stopped sending').to.not.equal(undefined);
    expect(demote.arrivedSeq, 'the folder stopped sending before its scan finished').to.be.above(scan.seq);
  });
});
