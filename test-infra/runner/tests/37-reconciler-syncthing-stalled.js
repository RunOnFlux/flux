import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  setStalled, setNoPeerData, setPeerHasData, resetSyncState,
} from '../framework/syncthing-control.js';
import { waitForAppRemoved, assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// MUST-PASS data-safety gate. When an r: folder is stalled (no byte progress):
//  - and NO peer holds the full data: there is no safe action, so the reconciler
//    must NEVER force-start the container (starting on dirty/un-synced data would
//    propagate corruption). It waits indefinitely.
//  - and a peer DOES hold the full data: a one-shot recovery (stop + syncthing
//    restart) is attempted, then the app is removed locally — the data is safe on
//    the synced peer. This is the safe give-up, not a force-start.
//
// Both nodes are forced non-leader (seeded remote running peer) so they take the
// sync-readiness path. Stall is declared after config.syncthing.stalledSyncCheckCount
// unchanged samples (compressed in the test config), so the window is ~tens of s.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('reconciler never force-starts a stalled, un-synced r: app', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stuckApp = `e2estuck${Date.now()}`;
  const recoverApp = `e2erecover${Date.now()}`;
  let stuck; let recover;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    stuck = await seedSyncthingApp(env, { name: stuckApp, mode: 'r', forceNonLeader: true });
    recover = await seedSyncthingApp(env, { name: recoverApp, mode: 'r', forceNonLeader: true });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('waits forever (never starts) when stalled and no peer has the data', async function () {
    this.timeout(90000);
    const client = env.clients[stuck.index];
    // stalled (frozen bytes) and no peer holds the full data
    await setStalled({ folder: stuck.folder, percent: 60 });
    await setNoPeerData({ folder: stuck.folder });

    // across stall detection + several post-stall cycles, it must never start
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === stuck.identifier && d.action === 'started', 45000);
    expect(await isUp(client, stuckApp)).to.equal(false);
  });

  it('recovers then safely removes when stalled but a peer holds the data', async function () {
    this.timeout(180000);
    const client = env.clients[recover.index];
    // stalled, but a peer is fully synced -> one-shot recovery, then safe remove
    await setStalled({ folder: recover.folder, percent: 60 });
    await setPeerHasData({ folder: recover.folder });

    // it must never force-start on the dirty data...
    const afterId = client.getLastEventId();
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === recover.identifier && d.action === 'started', 5000);
    // ...and must end in a safe local removal (data preserved on the synced peer)
    await waitForAppRemoved(client, recoverApp, 150000, { afterId });
  });
});
