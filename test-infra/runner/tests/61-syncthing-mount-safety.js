import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import {
  setSyncState, setSynced, setSyncing, getSyncthingState, resetSyncState,
} from '../framework/syncthing-control.js';
import {
  waitFor, waitForReconcilerDesiredChanged, waitForReconcileActuated, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The syncthing mount-safety guard gates on the MOUNTPOINT, not on content
// (the deletion-propagation incident regressions):
//  - a sendreceive folder whose app dir is unmounted with leaked content must
//    be demoted to receiveonly and its container held - content used to buy a
//    pass, which let a stale sendreceive folder broadcast deletions to the
//    healthy master
//  - a sendreceive folder whose index claims data over an empty (mounted)
//    volume - the stale "phantom" index - must be demoted before it can
//    broadcast every missing file as a deletion
//  - a legitimately empty folder (index empty too - the cold-start seed) must
//    NOT be demoted
//  - the .stfolder marker must never (re)appear on the bare unmounted dir -
//    recreating it there re-arms syncthing onto the host filesystem and
//    defeats syncthing's own missing-marker guard

const subnet = getSubnetConfig();

const appId = (name) => `flux${name}_${name}`;
const appDir = (name) => `/mnt/appdata/flux-apps/${appId(name)}`;
const volFile = (name) => `/mnt/appdata/${appId(name)}FLUXFSVOL`;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

// the folder type as the (stub) syncthing daemon has it configured for a node
async function folderType(nodeIp, folderId) {
  const state = await getSyncthingState();
  const node = state.nodes.find((n) => n.ip === nodeIp);
  return node?.folders?.find((f) => f.id === folderId)?.type ?? null;
}

describe('syncthing mount-safety guard demotes unsafe sendreceive folders', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const leakName = `e2eleak${ts}`; // node 0: unmounted dir with leaked content
  const phantomName = `e2ephantom${ts}`; // node 1: phantom index over empty volume
  const leakFolder = appId(leakName);
  const phantomFolder = appId(phantomName);
  const leakIdentifier = `${leakName}_${leakName}`;
  const phantomIdentifier = `${phantomName}_${phantomName}`;
  const ip0 = subnet.nodeIp(1);
  const ip1 = subnet.nodeIp(2);

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();

    // both apps are r: leaders on their own nodes: they seed, promote to
    // sendreceive and start - the state every test here begins from.
    // Order matters: the sync layer's first-run reset clears local appdata, so
    // wait for it, put real data on disk, and only THEN pin the index synced -
    // if the index ever claims bytes over an empty disk, the phantom guard
    // (correctly) demotes and holds, and the app never reaches the premise.
    const leakInstallAfter = env.clients[0].getLastEventId();
    await seedSyncthingApp(env, { name: leakName, mode: 'r', index: 0, spawnable: false });
    await waitForReconcileActuated(env.clients[0], leakIdentifier, 'dataCleared', 60000, { afterId: leakInstallAfter });
    await seedSyncScopedData(env, leakName, 0);
    await setSynced({ ip: ip0, folder: leakFolder });

    const phantomInstallAfter = env.clients[1].getLastEventId();
    await seedSyncthingApp(env, { name: phantomName, mode: 'r', index: 1, spawnable: false });
    await waitForReconcileActuated(env.clients[1], phantomIdentifier, 'dataCleared', 60000, { afterId: phantomInstallAfter });
    await seedSyncScopedData(env, phantomName, 1);
    await setSynced({ ip: ip1, folder: phantomFolder });

    await waitFor(async () => (await folderType(ip0, leakFolder)) === 'sendreceive', { timeout: 90000, interval: 3000, label: `${leakFolder} sendreceive` });
    await waitFor(async () => (await folderType(ip1, phantomFolder)) === 'sendreceive', { timeout: 90000, interval: 3000, label: `${phantomFolder} sendreceive` });
    await waitFor(() => isUp(env.clients[0], leakName), { timeout: 90000, interval: 2000, label: 'leak app running' });
    await waitFor(() => isUp(env.clients[1], phantomName), { timeout: 90000, interval: 2000, label: 'phantom app running' });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('does NOT demote a legitimately empty folder whose index is empty too (cold-start seed)', async function () {
    this.timeout(60000);
    const client = env.clients[1];
    // wipe the app's data inside the MOUNTED volume and report an empty index:
    // disk and index agree, so there is nothing a sendreceive folder could
    // wrongly delete - the guard must leave it alone
    await execInContainer(client.container, `sh -c 'rm -rf ${appDir(phantomName)}/appdata/* 2>/dev/null; true'`);
    await setSyncState({ ip: ip1, folder: phantomFolder, state: 'idle', globalBytes: 0, inSyncBytes: 0 });

    // several 3s monitor cycles must pass without a demotion
    await assertNoEvent(client, 'reconciler:desiredChanged', (d) => d.identifier === phantomIdentifier && d.state === 'stopped', 15000);
    expect(await folderType(ip1, phantomFolder)).to.equal('sendreceive');
  });

  it('demotes a sendreceive folder whose index claims data over an empty volume (phantom index)', async function () {
    this.timeout(120000);
    const client = env.clients[1];
    const afterId = client.getLastEventId();

    // the stale-index state: the index claims fully-synced data while the
    // mounted volume holds none - in sendreceive, syncthing would broadcast
    // every "missing" file as a deletion
    await setSyncState({ ip: ip1, folder: phantomFolder, state: 'idle', globalBytes: 100000, inSyncBytes: 100000 });

    await waitFor(async () => (await folderType(ip1, phantomFolder)) === 'receiveonly', { timeout: 60000, interval: 3000, label: 'phantom folder demoted to receiveonly' });
    await waitForReconcilerDesiredChanged(client, phantomIdentifier, 'stopped', 60000, { afterId });

    // park the folder mid-sync BEFORE asserting the stop: the stub's static
    // "fully synced" index would otherwise let the receiveonly machinery
    // re-promote (in production the demotion's folder restart rescans and
    // corrects the index; the stub has no disk to rescan)
    await setSyncing({ ip: ip1, folder: phantomFolder, percent: 40 });
    await waitFor(async () => !(await isUp(client, phantomName)), { timeout: 60000, interval: 2000, label: 'phantom app container held (stopped)' });
  });

  it('demotes a sendreceive folder over an unmounted dir even when it HAS content (leak regression)', async function () {
    this.timeout(120000);
    const client = env.clients[0];
    const dir = appDir(leakName);

    // premise, asserted so drift fails fast instead of timing out downstream: a
    // genuinely running sendreceive leader (an idle seeded leader with an empty
    // disk would already have been phantom-demoted - see seedSyncScopedData)
    expect(await folderType(ip0, leakFolder), 'leak folder must start sendreceive').to.equal('sendreceive');
    expect(await isUp(client, leakName), 'leak app must start running').to.equal(true);
    const afterId = client.getLastEventId();

    // recreate the incident state: volume unmounted and unrepairable (image
    // gone), with data leaked onto the bare host dir. chattr -i first - the
    // leak predates the immutable-mountpoint fix on real incident nodes.
    const r = await execInContainer(client.container,
      `docker stop ${appId(leakName)} >/dev/null 2>&1; umount ${dir} && chattr -i ${dir} && touch ${dir}/leaked.db && rm -f ${volFile(leakName)}`);
    expect(r.exitCode, `leak-state setup failed: ${r.output}`).to.equal(0);

    // content must NOT buy a pass: the folder is demoted and the container held
    await waitFor(async () => (await folderType(ip0, leakFolder)) === 'receiveonly', { timeout: 60000, interval: 3000, label: 'leaked folder demoted to receiveonly' });
    await waitForReconcilerDesiredChanged(client, leakIdentifier, 'stopped', 60000, { afterId });
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === leakIdentifier && d.action === 'started', 15000);
    expect(await isUp(client, leakName)).to.equal(false);
  });

  it('never recreates the .stfolder marker on the bare unmounted dir', async function () {
    this.timeout(60000);
    const client = env.clients[0];
    const dir = appDir(leakName);

    // give the monitor several cycles; the marker must not reappear on the
    // bare dir (old code recreated it every cycle, re-arming sync onto the
    // host filesystem), and FluxOS must not add anything else there either
    await new Promise((resolve) => { setTimeout(resolve, 12000); });
    const marker = await execInContainer(client.container, `test -d ${dir}/.stfolder`);
    expect(marker.exitCode).to.not.equal(0);
    const entries = await execInContainer(client.container, `find ${dir} -mindepth 1 2>/dev/null`);
    expect(entries.stdout.trim()).to.equal(`${dir}/leaked.db`);
  });
});
