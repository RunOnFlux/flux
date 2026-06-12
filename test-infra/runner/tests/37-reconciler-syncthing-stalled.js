import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  setStalled, setActiveFlat, setSynced, setNoPeerData, setPeerHasData, setPeerDisconnected,
  getNudges, resetSyncState,
} from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitForAppRemoved, assertNoEvent, waitFor } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// MUST-PASS data-safety gate for the stall ladder. Flat bytes alone are NOT a
// stall - the responses depend on WHY no blocks arrive:
//   - ACTIVE folder state (sync-preparing) with flat bytes: syncthing is working
//     (e.g. computing what to pull on a large folder) - no action, ever.
//   - idle + flat + a CONNECTED synced peer: the puller is dormant - NUDGE the
//     folder's devices (pause/resume forces an index re-exchange). No syncthing
//     process restart, no container stop. Nudges escalate; only after
//     stallRemoveMinNudges failed nudges over stallRemoveMinWindowMs with zero
//     progress is the app removed (data provably lives on the connected peer).
//   - idle + flat + peer DISCONNECTED (completion=100 is its stale last-known
//     index): no evidence - no nudge, no removal; syncthing resumes by itself
//     when the source returns.
//   - idle + flat + NO peer holding the data: wait indefinitely, never start.
// Windows are compressed via config.syncthing.stallNudge*/stallRemove* keys.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

const subnet = getSubnetConfig();

describe('reconciler stall ladder: nudge with evidence, remove only with proof, never restart syncthing', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const activeApp = `e2eactive${Date.now()}`;
  const ladderApp = `e2eladder${Date.now()}`;
  const offlineApp = `e2eoffline${Date.now()}`;
  const stuckApp = `e2estuck${Date.now()}`;
  let active; let ladder; let offline; let stuck;

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    // Gate every follower's sync shape BEFORE its first evaluation - otherwise it
    // sees the stub's default-synced state and starts. Each app sits on its own
    // subject node so the per-node nudge logs stay independent.
    active = await seedSyncthingApp(env, { name: activeApp, mode: 'r', forceNonLeader: true, index: 0 });
    await setActiveFlat({ ip: subnet.nodeIp(1), folder: active.folder, percent: 60 });
    await setPeerHasData({ ip: subnet.nodeIp(1), folder: active.folder });

    ladder = await seedSyncthingApp(env, { name: ladderApp, mode: 'r', forceNonLeader: true, index: 1 });
    await setStalled({ ip: subnet.nodeIp(2), folder: ladder.folder, percent: 60 });
    await setPeerHasData({ ip: subnet.nodeIp(2), folder: ladder.folder });

    offline = await seedSyncthingApp(env, { name: offlineApp, mode: 'r', forceNonLeader: true, index: 2 });
    await setStalled({ ip: subnet.nodeIp(3), folder: offline.folder, percent: 60 });
    await setPeerDisconnected({ ip: subnet.nodeIp(3), folder: offline.folder });

    stuck = await seedSyncthingApp(env, { name: stuckApp, mode: 'r', forceNonLeader: true, index: 3 });
    await setStalled({ ip: subnet.nodeIp(4), folder: stuck.folder, percent: 60 });
    await setNoPeerData({ ip: subnet.nodeIp(4), folder: stuck.folder });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('takes no action while the folder state is ACTIVE, however flat the bytes', async function () {
    this.timeout(90000);
    const client = env.clients[active.index];
    // well past every compressed ladder window: no start, no nudge, no removal
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === active.identifier && (d.action === 'started' || d.action === 'stopped'), 45000);
    const { nudges } = await getNudges(subnet.nodeIp(1));
    expect(nudges.filter((n) => n.action === 'pause')).to.have.lengthOf(0);
    expect(await isUp(client, activeApp)).to.equal(false);
  });

  it('nudges the folder devices when idle+flat with a connected synced peer, then removes only after the evidence window', async function () {
    this.timeout(180000);
    const client = env.clients[ladder.index];
    const afterId = client.getLastEventId();

    // the nudge: device pause/resume observed at the stub, well before any removal
    await waitFor(async () => {
      const { nudges } = await getNudges(subnet.nodeIp(2));
      return nudges.filter((n) => n.action === 'pause').length >= 1;
    }, { timeout: 60000, interval: 2000, label: 'first device nudge (pause) observed' });

    // never a syncthing process restart, never a container start on unsynced data
    const { nudges: midLadder } = await getNudges(subnet.nodeIp(2));
    expect(midLadder.filter((n) => n.action === 'restart')).to.have.lengthOf(0);
    expect(await isUp(client, ladderApp)).to.equal(false);

    // removal only lands once the nudges are exhausted over the minimum window
    await waitForAppRemoved(client, ladderApp, 120000, { afterId });
    const { nudges: final } = await getNudges(subnet.nodeIp(2));
    expect(final.filter((n) => n.action === 'pause').length).to.be.at.least(2);
    expect(final.filter((n) => n.action === 'restart')).to.have.lengthOf(0);
  });

  it('neither nudges nor removes when the only "synced" peer is disconnected; resumes when the source returns', async function () {
    this.timeout(180000);
    const client = env.clients[offline.index];

    // far beyond the removal window for a CONNECTED peer: nothing may happen on
    // a stale disconnected-peer completion (source-offline shape)
    await assertNoEvent(client, 'app:removed', (d) => d.name === offlineApp, 60000);
    const { nudges } = await getNudges(subnet.nodeIp(3));
    expect(nudges.filter((n) => n.action === 'pause')).to.have.lengthOf(0);
    expect(nudges.filter((n) => n.action === 'restart')).to.have.lengthOf(0);
    expect(await isUp(client, offlineApp)).to.equal(false);

    // the source comes back and the data syncs through: the follower starts
    const afterId = client.getLastEventId();
    await setSynced({ ip: subnet.nodeIp(3), folder: offline.folder });
    await client.waitForEvent('reconciler:actuated', (d) => d.identifier === offline.identifier && d.action === 'started', 90000, { afterId });
  });

  it('waits forever (never starts, never removes) when no peer holds the data', async function () {
    this.timeout(90000);
    const client = env.clients[stuck.index];
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === stuck.identifier && d.action === 'started', 45000);
    await assertNoEvent(client, 'app:removed', (d) => d.name === stuckApp, 1000);
    expect(await isUp(client, stuckApp)).to.equal(false);
  });
});
