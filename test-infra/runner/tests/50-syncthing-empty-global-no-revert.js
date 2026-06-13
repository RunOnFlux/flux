import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  getAppContainerStatus, plantAppdata, countAppdataFiles, appdataFileExists,
} from '../framework/container.js';
import {
  setLocalChangesEmptyGlobal, setLocalChanges, setLocalOnlyFiles,
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

    // Leg 1 subject: a non-leader follower holding the only copy, empty global.
    aEmpty = await seedSyncthingApp(env, {
      name: appEmpty, mode: 'r', forceNonLeader: true, index: 0,
    });
    await plantAppdata(env.clients[aEmpty.index].container, appEmpty, [
      { name: 'keep.txt', content: 'precious-only-copy' },
      { name: 'blob.bin', sizeMB: 3 },
    ]);
    // empty global (globalBytes 0) + local-only data, and NO connected source
    await setLocalChangesEmptyGlobal({ ip: subnet.nodeIp(aEmpty.index + 1), folder: aEmpty.folder, files: 2 });
    await setPeerDisconnected({ ip: subnet.nodeIp(aEmpty.index + 1), folder: aEmpty.folder });

    // Leg 2 subject: populated global, one local-only pollution file, synced peer.
    aPart = await seedSyncthingApp(env, {
      name: appPart, mode: 'r', forceNonLeader: true, index: 1,
    });
    await plantAppdata(env.clients[aPart.index].container, appPart, [
      { name: 'synced.bin', sizeMB: 2 },
      { name: 'pollution.txt', content: 'local-only-must-be-reverted' },
    ]);
    await setLocalOnlyFiles({ ip: subnet.nodeIp(aPart.index + 1), folder: aPart.folder, paths: ['appdata/pollution.txt'] });
    await setLocalChanges({ ip: subnet.nodeIp(aPart.index + 1), folder: aPart.folder, files: 1 });
    await setPeerHasData({ ip: subnet.nodeIp(aPart.index + 1), folder: aPart.folder });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('Leg 1: empty global — never reverts/promotes; the only copy survives', async function () {
    this.timeout(90000);
    const client = env.clients[aEmpty.index];
    const ip = subnet.nodeIp(aEmpty.index + 1);

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
    this.timeout(120000);
    const client = env.clients[aPart.index];
    const ip = subnet.nodeIp(aPart.index + 1);

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
