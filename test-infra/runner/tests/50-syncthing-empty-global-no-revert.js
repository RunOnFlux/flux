import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  getAppContainerStatus, plantAppdata, countAppdataFiles, appdataFileExists, restartFluxos,
} from '../framework/container.js';
import {
  setSyncState, setLocalChangesEmptyGlobal, setLocalChanges, setLocalOnlyFiles,
  setPeerDisconnected, setPeerHasData, getNudges, resetSyncState,
} from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// MUST-PASS data-safety gate (B1). The promotion FSM's isSynced is percentage-
// based, so an EMPTY global index (globalBytes 0) reads as a vacuous 100% even
// when the node holds the only copy of real appdata with no connected source
// (reboot/redeploy/partition before peers reconnect — verified reachable). The
// unguarded db/revert in that state DELETES the only copy (reproduced live on
// real syncthing v2.0.15 + v2.0.16; the stub models the same destruction here).
//
// Contract:
//  Leg 1 (empty global, no source): the gate must NEVER revert or promote — it
//    must wait. Asserted at the PROPERTY level: the planted bytes survive.
//  Leg 2 (populated global + local pollution, connected synced peer): the gate
//    SHOULD revert — but only the local-only pollution, preserving the synced
//    data — then promote and start. Guards the fix against over-correcting.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

const subnet = getSubnetConfig();

describe('syncthing promotion gate never reverts/promotes against an empty global', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appEmpty = `e2eemptyglobal${Date.now()}`;
  const appPart = `e2epartrevert${Date.now()}`;
  let aEmpty;
  let aPart;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();

    aEmpty = await seedSyncthingApp(env, {
      name: appEmpty, mode: 'r', forceNonLeader: true, index: 0,
    });
    aPart = await seedSyncthingApp(env, {
      name: appPart, mode: 'r', forceNonLeader: true, index: 1,
    });

    // Settle each subject into the in-cache, receive-only WAITING state first:
    // not synced (needBytes>0) with NO connected source. A fresh app's first
    // monitor pass runs handleNewApp, which CLEANS the folder to sync from
    // scratch — so planting before that would just be wiped. Once in cache,
    // every cycle is handleReceiveOnlyTransition, which here only waits (no
    // promote: not synced; no revert: revert is on the isSynced branch). The
    // legs plant data AFTER this, so it is present at revert time — the
    // handleFirstRun preserve-state B1 hits in production (reboot holding the
    // only copy), reproduced without a full node restart.
    for (const a of [aEmpty, aPart]) {
      const ip = subnet.nodeIp(a.index + 1);
      // eslint-disable-next-line no-await-in-loop
      await setSyncState({ ip, folder: a.folder, state: 'idle', globalBytes: 100000, inSyncBytes: 40000, receiveOnlyChangedFiles: 0 });
      // eslint-disable-next-line no-await-in-loop
      await setPeerDisconnected({ ip, folder: a.folder });
    }
    // let handleNewApp clean + the FSM reach the waiting state (≈6 monitor cycles)
    await new Promise((r) => setTimeout(r, 18000)); // eslint-disable-line no-promise-executor-return
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('Leg 1: empty global — never reverts/promotes; the only copy survives', async function () {
    this.timeout(180000);
    const idx = aEmpty.index;
    const ip = subnet.nodeIp(idx + 1);

    // Pre-existing appdata on disk (the only copy this node holds), THEN a machine
    // reboot: handleFirstRun must PRESERVE it into receiveonly — the only
    // production path to "real data in a receiveonly folder facing an empty
    // global" (a fresh app is cleaned by handleNewApp; synced data implies
    // globalBytes>0). After the reboot, peers have not reconnected, so the global
    // is empty with no source — the exact B1 data-loss trap.
    await plantAppdata(env.clients[idx].container, appEmpty, [
      { name: 'keep.txt', content: 'precious-only-copy' },
      { name: 'blob.bin', sizeMB: 3 },
    ]);
    await restartFluxos(env.clients[idx].container);
    await setLocalChangesEmptyGlobal({ ip, folder: aEmpty.folder, files: 2 });
    // peer stays disconnected (from before): no valid source
    const client = env.clients[idx];

    // a start would be the promote-on-empty-global regression; flag it if it fires
    let startedSeen = false;
    client.waitForEvent('reconciler:actuated', (d) => d.identifier === aEmpty.identifier && d.action === 'started', 45000)
      .then(() => { startedSeen = true; }).catch(() => {});

    // watch ~45s (≈15 monitor cycles). On the data-loss bug the stub really
    // deletes the planted files within a cycle or two; correct behaviour is WAIT.
    const windowMs = 45000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < windowMs) {
      // PROPERTY: the only copy must still be on disk
      expect(
        await appdataFileExists(client.container, appEmpty, 'keep.txt'),
        'precious appdata must survive — no db/revert against an empty global',
      ).to.equal(true);
      const { nudges } = await getNudges(ip);
      expect(
        nudges.some((n) => n.action === 'revert' && n.device === aEmpty.folder),
        'the gate must NOT issue db/revert against an empty global',
      ).to.equal(false);
      expect(
        startedSeen,
        'the gate must NOT promote/start on an empty global (unverified data)',
      ).to.equal(false);
      // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
      await new Promise((r) => setTimeout(r, 3000));
    }

    expect(await countAppdataFiles(client.container, appEmpty)).to.be.greaterThan(0);
    const status = await getAppContainerStatus(client.container, appEmpty, { all: true });
    expect(status == null || !status.status.startsWith('Up'), 'container must stay down (still receiveonly, waiting)').to.equal(true);
  });

  it('Leg 2: populated global — reverts only the pollution, keeps synced data, then promotes', async function () {
    this.timeout(210000);
    const idx = aPart.index;
    const ip = subnet.nodeIp(idx + 1);

    // Pre-existing data (synced + one local-only pollution file), THEN reboot:
    // handleFirstRun preserves it into receiveonly (same production path as Leg 1).
    // With a populated global and a connected synced peer, the gate must revert
    // ONLY the pollution, keep the synced data, then promote and start.
    await plantAppdata(env.clients[idx].container, appPart, [
      { name: 'synced.bin', sizeMB: 2 },
      { name: 'pollution.txt', content: 'local-only-must-be-reverted' },
    ]);
    await restartFluxos(env.clients[idx].container);
    await setLocalOnlyFiles({ ip, folder: aPart.folder, paths: ['appdata/pollution.txt'] });
    await setLocalChanges({ ip, folder: aPart.folder, files: 1 });
    await setPeerHasData({ ip, folder: aPart.folder });
    const client = env.clients[idx];

    await waitFor(async () => {
      const { nudges } = await getNudges(ip);
      return nudges.some((n) => n.action === 'revert' && n.device === aPart.folder);
    }, { timeout: 60000, interval: 2000, label: 'db/revert of the polluted folder' });

    // PROPERTY: the local-only pollution is gone, the synced data is preserved
    expect(
      await appdataFileExists(client.container, appPart, 'pollution.txt'),
      'revert must delete the local-only pollution',
    ).to.equal(false);
    expect(
      await appdataFileExists(client.container, appPart, 'synced.bin'),
      'revert must PRESERVE the synced data',
    ).to.equal(true);

    // once clean, the follower promotes and the reconciler starts it
    const started = await client.waitForEvent('reconciler:actuated', (d) => d.identifier === aPart.identifier && d.action === 'started', 90000);
    expect(started).to.exist;
    expect(await isUp(client, appPart)).to.equal(true);
  });
});
