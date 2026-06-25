import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, restartFluxos } from '../framework/container.js';
import {
  setSyncState, setLocalChangesEmptyGlobal, setLocalChanges,
  setPeerDisconnected, setPeerHasData, getNudges, resetSyncState,
} from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// MUST-PASS data-safety gate (B1). The promotion FSM's isSynced is percentage-
// based, so an EMPTY global index (globalBytes 0) reads as a vacuous 100% even
// when a node holds the only copy of real appdata with no connected source
// (a reboot/partition before peers reconnect). The unguarded db/revert in that
// state DELETES the only copy (reproduced live on real syncthing v2.0.15 +
// v2.0.16).
//
// This asserts the FSM's DECISION, not the on-disk bytes: FluxOS stores g:/r:
// appdata inside a per-component loop-mounted ext4 image (FLUXFSVOL) that is
// namespace-local to the node, so the syncthing stub (a separate container)
// cannot reach or delete it. The decision IS the contract the fix changes, and
// the state is reached the way production reaches it: restartFluxos clears the
// in-memory cache, handleFirstRun preserves the on-disk folder into receiveonly,
// and handleReceiveOnlyTransition then evaluates against the (injected) empty
// global. Issuing db/revert there is the bug; the fix must wait instead.
//
//  Leg 1 (empty global, no source): the gate must NOT revert or promote.
//  Leg 2 (populated global + local changes, connected peer): the gate SHOULD
//    revert (the legitimate pollution path) and then promote+start - guards the
//    fix against over-correcting.

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

    // Seed each app and IMMEDIATELY pin its settle state (BEFORE seeding the
    // next), so the monitor's first promote-eligible cycle sees not-synced + no
    // source (waits) rather than the stub default (0/0 -> vacuous synced ->
    // premature promote). handleNewApp cleans the fresh folder once; thereafter
    // every cycle is handleReceiveOnlyTransition, which here only waits. The
    // folder config now exists and survives a FluxOS process restart - which is
    // how the legs reach handleFirstRun's preserve branch.
    aEmpty = await seedSyncthingApp(env, {
      name: appEmpty, mode: 'r', forceNonLeader: true, index: 0,
    });
    await setSyncState({ ip: subnet.nodeIp(aEmpty.index + 1), folder: aEmpty.folder, state: 'idle', globalBytes: 100000, inSyncBytes: 40000, receiveOnlyChangedFiles: 0 });
    await setPeerDisconnected({ ip: subnet.nodeIp(aEmpty.index + 1), folder: aEmpty.folder });

    aPart = await seedSyncthingApp(env, {
      name: appPart, mode: 'r', forceNonLeader: true, index: 1,
    });
    await setSyncState({ ip: subnet.nodeIp(aPart.index + 1), folder: aPart.folder, state: 'idle', globalBytes: 100000, inSyncBytes: 40000, receiveOnlyChangedFiles: 0 });
    await setPeerDisconnected({ ip: subnet.nodeIp(aPart.index + 1), folder: aPart.folder });

    // let handleNewApp clean + the FSM reach the receiveonly waiting state
    await new Promise((r) => setTimeout(r, 18000)); // eslint-disable-line no-promise-executor-return
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('Leg 1: empty global — gate must not revert or promote', async function () {
    this.timeout(180000);
    const idx = aEmpty.index;
    const ip = subnet.nodeIp(idx + 1);

    // Reboot the process holding the only copy: handleFirstRun preserves the
    // folder into receiveonly; with peers not reconnected the global is empty
    // and there is no source - the exact B1 trap.
    await restartFluxos(env.clients[idx].container);
    await setLocalChangesEmptyGlobal({ ip, folder: aEmpty.folder, files: 2 });
    const client = env.clients[idx];

    // a start would be the promote-on-empty-global regression; flag it if it fires
    let startedSeen = false;
    client.waitForEvent('reconciler:actuated', (d) => d.identifier === aEmpty.identifier && d.action === 'started', 45000)
      .then(() => { startedSeen = true; }).catch(() => {});

    // watch ~45s (≈15 monitor cycles). On the bug the gate issues db/revert
    // (which against an empty global would delete the only copy); the correct
    // behaviour is to WAIT.
    const windowMs = 45000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < windowMs) {
      const { nudges } = await getNudges(ip);
      expect(
        nudges.some((n) => n.action === 'revert' && n.device === aEmpty.folder),
        'the gate must NOT issue db/revert against an empty global (it would delete the only copy)',
      ).to.equal(false);
      expect(
        startedSeen,
        'the gate must NOT promote/start on an empty global (unverified data)',
      ).to.equal(false);
      // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
      await new Promise((r) => setTimeout(r, 3000));
    }

    const status = await getAppContainerStatus(client.container, appEmpty, { all: true });
    expect(status == null || !status.status.startsWith('Up'), 'container must stay down (still receiveonly, waiting)').to.equal(true);
  });

  it('Leg 2: populated global — gate reverts the local changes, then promotes', async function () {
    this.timeout(210000);
    const idx = aPart.index;
    const ip = subnet.nodeIp(idx + 1);

    // Same preserve path, but a populated global with a connected synced peer:
    // the gate SHOULD revert the local changes and then promote+start.
    await restartFluxos(env.clients[idx].container);
    await setLocalChanges({ ip, folder: aPart.folder, files: 1 });
    await setPeerHasData({ ip, folder: aPart.folder });
    const client = env.clients[idx];

    await waitFor(async () => {
      const { nudges } = await getNudges(ip);
      return nudges.some((n) => n.action === 'revert' && n.device === aPart.folder);
    }, { timeout: 90000, interval: 2000, label: 'db/revert of the locally-changed folder' });

    // once clean (the stub clears receiveOnlyChangedFiles on revert), the
    // follower promotes and the reconciler starts it
    const started = await client.waitForEvent('reconciler:actuated', (d) => d.identifier === aPart.identifier && d.action === 'started', 90000);
    expect(started).to.exist;
    expect(await isUp(client, appPart)).to.equal(true);
  });
});
