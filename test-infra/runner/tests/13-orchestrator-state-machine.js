import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold, waitForPeersBelowThreshold,
  waitForSpawnerResumed, waitForSpawnerPaused, waitFor, assertNoEvent,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
  clearAllNodeStatus, setNodeStatus, disableAllRpcFailure,
} from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { loadSharedConfig, peerDeathMs, PARTITION_PEERS } from '../framework/coupled-knobs.js';

// How long a node takes to notice a peer that has been unplugged rather than
// disconnected - the thing every DEGRADED wait below is really waiting for.
// Derived once in coupled-knobs, because a block that overrides the peers config
// must budget from ITS config and not from the shared fleet's.
const PEER_DEATH_MS = peerDeathMs(loadSharedConfig().peers);

/**
 * Take every peer away from node 0, WAIT FOR IT TO NOTICE, and only then ask
 * what it did about it.
 *
 * `disconnectNode` removes the container from the docker network and returns as
 * soon as dockerd has done so - which says nothing about when this node finds
 * out. An unplugged container sends no close frame: node 0 discovers each peer
 * through its own ping/pong liveness, one socket at a time, and the orchestrator
 * has nothing to react to until the survivors fall below the threshold.
 *
 * SPLITTING THE TWO WAITS IS THE POINT. As one deadline they covered "liveness
 * detection AND the reaction", and a gate run spent it all on the first: three
 * of four peers had gone, node 0 still counted one against a threshold of one,
 * so it was never below it and DEGRADED was correct not to fire. What the report
 * said was "Timeout waiting for event: orchestrator:stateChanged" - which is
 * also exactly what a genuinely broken orchestrator says. Apart, the two
 * failures read differently, and only the second is a product bug.
 *
 * The four budgets this replaced were 30s, 10s, 30s and 30s for the same
 * operation. None was derived from anything; the 10s was the one that failed.
 * @param {object} env Test environment.
 * @param {object} [opts]
 * @param {number} [opts.detectMs] Budget for node 0 to observe the peers leave.
 * @param {number} [opts.reactMs] Budget for the orchestrator to then act.
 */
async function dropEveryPeerAndAwaitDegraded(env, { detectMs, reactMs = 15000 } = {}) {
  // Detection is concurrent across the sockets, so the bound is one peer death
  // and not four; the multiplier is headroom for scheduling, not for a fourth
  // serial timeout. Registered BEFORE the first disconnect, or the event can
  // land while nothing is listening for it.
  const observed = waitForPeersBelowThreshold(env.clients[0], detectMs ?? 3 * PEER_DEATH_MS);
  for (let i = 1; i < env.clients.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await env.disconnectNode(i);
  }
  await observed;
  // Returned, not swallowed: a caller that cares WHICH state was left - suite 2
  // asserts SYNCING so its block cannot quietly become a copy of the READY one -
  // needs the transition itself.
  return waitForOrchestratorState(env.clients[0], 'DEGRADED', reactMs);
}

async function bootNodes(env, { discover = false } = {}) {
  await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
  await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
  await waitForExplorerReady(env.clients[0]);
  await waitForOrchestratorStarted(env.clients[0]);
  await advanceBlock();
  await waitForBlockProcessed(env.clients[0], () => true, 20000);
  if (discover) {
    await env.startDiscovery();
    await waitForPeerThreshold(env.clients[0], 120000);
  }
}

// Suite 1: INITIALIZING → SYNCING

describe('Orchestrator: INITIALIZING to SYNCING', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, deferredNodes: 1, tickerAutostart: false });
    await Promise.all(env.clients.filter(Boolean).map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.filter(Boolean).map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await waitForExplorerReady(env.clients[0]);
    await waitForOrchestratorStarted(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should transition to SYNCING on first block received', async function () {
    this.timeout(30000);
    await advanceBlock();
    await waitForOrchestratorState(env.clients[0], 'SYNCING', 20000);
  });

  it('should stay INITIALIZING without blocks on deferred node', async function () {
    this.timeout(30000);
    await env.startNode(env.lastNodeIndex);
    await waitForExplorerReady(env.clients[env.lastNodeIndex]);
    await waitForOrchestratorStarted(env.clients[env.lastNodeIndex]);
    const events = env.clients[env.lastNodeIndex].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged');
    expect(events.length, 'no state transitions without blocks').to.equal(0);
  });

  it('should confirm first transition was INITIALIZING → SYNCING', async function () {
    this.timeout(10000);
    const events = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged');
    const toSyncing = events.find((e) => e.data.to === 'SYNCING');
    expect(toSyncing).to.not.be.undefined;
    expect(toSyncing.data.from).to.equal('INITIALIZING');
  });
});

// Suite 2: SYNCING → READY (normal + fallback)

describe('Orchestrator: SYNCING to READY', function () {
  describe('normal path (all conditions met)', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(300000);
      env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
      await bootNodes(env, { discover: true });
    });

    after(async function () {
      this.timeout(30000);
      await env?.teardown();
    });

    it('should reach READY when all conditions met', async function () {
      this.timeout(120000);
      await startTicker();
      await waitForOrchestratorState(env.clients[0], 'READY', 90000);
    });

    it('should signal spawner to start', async function () {
      this.timeout(30000);
      await waitForSpawnerResumed(env.clients[0], 20000);
    });
  });

  // THE BLOCK FALLBACK IS TIME SPENT WITH PEERS, NOT UPTIME.
  //
  // This block used to assert the opposite, in those words: a 2-node fleet
  // where "node 0 can never reach peer threshold of 2 by itself (it has at most
  // 1 peer)" reaching READY on 260 blocks. That is the defect written down as a
  // requirement - a node with one peer spawning apps for the whole network -
  // and it is what #blocksSinceSyncStarted being gated on the peer level now
  // stops. The two halves below are the same fleet shape and the opposite
  // claim, plus the case that proves the timer still does its actual job.
  describe('a node short of the peer threshold never reaches READY', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(300000);
      // Declared rather than inherited: createTestEnv gives a fleet that cannot
      // reach the threshold appSyncFallbackMinutes 0, because in such a fleet
      // the budget is unreachable rather than slow. This suite is ABOUT the
      // budget, so it asks for one and keeps it.
      env = await createTestEnv({
        hookCtx: this,
        nodes: 2,
        tickerAutostart: false,
        configOverrides: { fluxapps: { appSyncFallbackMinutes: 5 } },
      });
      await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
      await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
      await waitForExplorerReady(env.clients[0]);
      await waitForOrchestratorStarted(env.clients[0]);
      // Discovery ON, so node 0 genuinely holds a peer. Without it the fleet
      // proves only that a node with nobody at all stays put, which is a weaker
      // claim than the one this makes: a peer is not enough, the THRESHOLD is
      // the condition.
      await env.startDiscovery();
      await advanceBlock();
      await waitForOrchestratorState(env.clients[0], 'SYNCING', 20000);
    });

    after(async function () {
      this.timeout(30000);
      await env?.teardown();
    });

    it('stays SYNCING through twenty-six times the block budget', async function () {
      this.timeout(300000);
      await advanceBlocks(260);
      // A settling window first, so the claim is not "it had not got there
      // YET": the blocks are delivered before the orchestrator has acted on the
      // last of them.
      await assertNoEvent(
        env.clients[0],
        'orchestrator:stateChanged',
        // The PAYLOAD, not the envelope: assertNoEvent calls predicate(e.data)
        // while waitForEvent RESOLVES with the envelope. Reaching for .data here
        // is a TypeError inside a find(), which reads as a broken assertion.
        (d) => d.to === 'READY',
        30000,
      );
      // Then the WHOLE run, not just that window. 10 blocks is the budget here,
      // so 260 is not a margin, it is a different answer - and a node that
      // reached READY and left it again must not read as a pass.
      const everReady = env.clients[0].getEventBuffer()
        .filter((e) => e.event === 'orchestrator:stateChanged' && e.data.to === 'READY');
      expect(everReady, 'a node below the peer threshold reached spawning readiness').to.have.lengthOf(0);
    });

    it('never starts the spawner', async function () {
      this.timeout(30000);
      const resumed = env.clients[0].getEventBuffer().filter((e) => e.event === 'spawner:resumed');
      expect(resumed, 'a node below the peer threshold started spawning').to.have.lengthOf(0);
    });

    // The premise, asserted last so a failure above reads as the product and a
    // failure here reads as the fleet. A node with NO peers would also stay
    // SYNCING, and would prove something much weaker.
    it('held a peer the whole time, short of the threshold', async function () {
      this.timeout(30000);
      const out = await env.clients[0].getPeers();
      const inb = await env.clients[0].getIncomingPeers();
      const total = (out?.data?.length ?? 0) + (inb?.data?.length ?? 0);
      expect(total, 'the fleet never peered, so the test proved nothing').to.be.greaterThan(0);
      expect(total, 'the fleet reached the threshold, so the block above was not the case it names')
        .to.be.lessThan(2);
    });
  });

  // THE TIMER STILL DOES ITS ACTUAL JOB. It bounds a sync attempt that is not
  // finishing; what it must no longer bound is having nobody to attempt with.
  // Three nodes reach the threshold of 2, and syncedNodes: [] means nobody is
  // authoritative, so no state sync can complete and the budget is the only
  // road left.
  describe('block timer fallback with the peer set up', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(300000);
      env = await createTestEnv({
        hookCtx: this,
        nodes: 3,
        tickerAutostart: false,
        syncedNodes: [],
        configOverrides: { fluxapps: { appSyncFallbackMinutes: 5 } },
      });
      await bootNodes(env, { discover: true });
    });

    after(async function () {
      this.timeout(30000);
      await env?.teardown();
    });

    it('should reach READY via block timer without peer sync completions', async function () {
      this.timeout(300000);
      await advanceBlocks(20);
      await waitForOrchestratorState(env.clients[0], 'READY', 120000);
    });

    it('should signal spawner to start after block timer fallback', async function () {
      this.timeout(30000);
      await waitForSpawnerResumed(env.clients[0], 20000);
    });

    it('should have dbReady set (spawner not blocked on db_not_ready)', async function () {
      this.timeout(30000);
      const resumeEvent = env.clients[0].getEventBuffer()
        .find((e) => e.event === 'spawner:resumed');
      const dbBlockedAfterResume = env.clients[0].getEventBuffer()
        .filter((e) => e.event === 'spawner:blocked'
          && e.data.reason === 'db_not_ready'
          && e.id > resumeEvent.id);
      expect(dbBlockedAfterResume).to.have.lengthOf(0);
    });
  });
});

// Suite 3: READY → DEGRADED

describe('Orchestrator: READY to DEGRADED', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootNodes(env, { discover: true });
    await startTicker();
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
    await stopTicker();
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should transition to DEGRADED when all peers disconnected', async function () {
    // A ceiling, not a wait: the bounds that mean anything are derived inside
    // dropEveryPeerAndAwaitDegraded and this only has to clear their sum.
    this.timeout(120000);
    await dropEveryPeerAndAwaitDegraded(env);
  });

  it('should emit READINESS_LOST (spawner paused)', async function () {
    this.timeout(10000);
    await waitForSpawnerPaused(env.clients[0], 5000);
  });
});

// #onPeersDegraded accepts READY or SYNCING; the block above covers the READY entry and
// this one covers SYNCING. Node 0 is held in SYNCING by asking it for more ephemeral sync
// completions than it has peers to supply, so it sits there with its peers connected and
// its confirmation intact, and the peers can then be dropped on their own account.
//
// Confirmation loss is not the lever here. It evicts every peer inside the same handler,
// so the count reaches zero while the node is still READY and it degrades from there -
// which is the block above, not this one.
describe('Orchestrator: peer drop during SYNCING', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      // Five completions per type against four peers: state sync cannot complete, so
      // #checkReadiness never lets node 0 out of SYNCING. The ticker stays stopped, so
      // the block timer that would otherwise release it never expires either.
      nodeConfigOverrides: { 0: { fluxapps: { appSyncMinCompletions: 5 } } },
    });
    // discover: true also waits for the peer threshold, which is what arms the manager to
    // report dropping below it later.
    await bootNodes(env, { discover: true });
    await waitForOrchestratorState(env.clients[0], 'SYNCING', 60000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should transition to DEGRADED when peers drop during SYNCING', async function () {
    this.timeout(120000);
    const degraded = await dropEveryPeerAndAwaitDegraded(env);
    // Names the entry state, so this block cannot quietly become a second copy of the
    // READY one if the order these two facts arrive in ever changes.
    expect(degraded.data.from).to.equal('SYNCING');
  });
});

// Suite 4: DEGRADED → RESYNCING → READY

describe('Orchestrator: DEGRADED recovery cycle', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootNodes(env, { discover: true });
    await startTicker();
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
    await stopTicker();
    // Disconnect all peers to trigger DEGRADED
    await dropEveryPeerAndAwaitDegraded(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should transition to RESYNCING when peers recover', async function () {
    this.timeout(120000);
    for (let i = 1; i < env.clients.length; i++) {
      await env.reconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'RESYNCING', 60000);
  });

  it('should reach READY after resync completes', async function () {
    this.timeout(120000);
    await startTicker();
    await waitForOrchestratorState(env.clients[0], 'READY', 90000);
  });

  it('should re-signal spawner ready', async function () {
    this.timeout(10000);
    await waitForSpawnerResumed(env.clients[0], 5000);
  });
});

describe('Orchestrator: block timer during RESYNCING', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootNodes(env, { discover: true });
    await startTicker();
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
    await stopTicker();
    // Enter DEGRADED
    await dropEveryPeerAndAwaitDegraded(env);
    // Recover peers → RESYNCING
    for (let i = 1; i < env.clients.length; i++) {
      await env.reconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'RESYNCING', 60000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should reach READY via block timer during RESYNCING', async function () {
    this.timeout(120000);
    await advanceBlocks(300);
    await waitForOrchestratorState(env.clients[0], 'READY', 30000);
  });
});

// THE RESET, WHICH NOTHING ON A FLEET DISTINGUISHED. The two blocks above lose
// every peer and get them back, and both then wait for READY - which arrives
// whether or not the budget restarted, just sooner if it did not. So the fleet
// has never separated "the counter went back to zero" from "the counter kept its
// credit", and that credit is what a node with no peers would be spending.
//
// Held on the budget alone: appSyncMinCompletions is above the number of peers
// this fleet can supply, so node 0's state sync can never complete and the block
// timer is the only road to READY. createTestEnv makes nobody authoritative for
// the same reason, without being asked.
describe('Orchestrator: the block budget starts again after the peer set goes', function () {
  let env;
  dumpLogsOnFailure(() => env);

  // appSyncFallbackMinutes 5 at BLOCKS_PER_MINUTE 2.
  const BUDGET_BLOCKS = 10;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      configOverrides: {
        // dropEveryPeerAndAwaitDegraded waits out peer liveness here, so this
        // block states BOTH halves of it - the interval alone would inherit the
        // shared fleet's compressed miss count.
        peers: PARTITION_PEERS,
        fluxapps: { appSyncFallbackMinutes: 5, appSyncMinCompletions: 6 },
      },
    });
    await bootNodes(env, { discover: true });
    await stopTicker();
    await advanceBlocks(BUDGET_BLOCKS);
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('needs a whole fresh budget after a recovery, not one more block', async function () {
    this.timeout(300000);
    await dropEveryPeerAndAwaitDegraded(env, { detectMs: 3 * peerDeathMs(PARTITION_PEERS) });
    for (let i = 1; i < env.clients.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await env.reconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'RESYNCING', 60000);

    const anchor = env.clients[0].getLastEventId();
    await advanceBlocks(BUDGET_BLOCKS - 1);

    // THE ASSERTION. This node spent a full budget before the peer set went. If
    // that credit survived the gap it is already past the bar, so the first
    // block back would take it to READY and nine certainly would.
    await assertNoEvent(
      env.clients[0],
      'orchestrator:stateChanged',
      (d) => d.to === 'READY',
      20000,
      { afterId: anchor },
    );

    // And the discriminator: one more block, which is the budget met from zero.
    // Without it the assertion above would also pass on a node that had stopped
    // counting blocks altogether.
    await advanceBlocks(1);
    await waitForOrchestratorState(env.clients[0], 'READY', 60000);
  });
});

// Suite 5: Message capability loss

describe('Orchestrator: message capability loss', function () {
  describe('loss during READY', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(300000);
      env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
      await bootNodes(env, { discover: true });
      await startTicker();
      await waitForOrchestratorState(env.clients[0], 'READY', 120000);
      await stopTicker();
    });

    after(async function () {
      this.timeout(30000);
      await clearAllNodeStatus();
      await env?.teardown();
    });

    it('should transition READY → SYNCING on message capability loss', async function () {
      this.timeout(30000);
      await setNodeStatus(env.clients[0].ip, 'EXPIRED');
      await waitForOrchestratorState(env.clients[0], 'SYNCING', 20000);
    });

    it('should emit READINESS_LOST (spawner paused)', async function () {
      this.timeout(10000);
      await waitForSpawnerPaused(env.clients[0], 5000);
    });

    it('should recover to READY when capability restored', async function () {
      this.timeout(120000);
      await clearAllNodeStatus();
      await startTicker();
      await waitForOrchestratorState(env.clients[0], 'READY', 90000);
    });
  });

  describe('loss during SYNCING', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(120000);
      env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
      await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
      await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
      await waitForExplorerReady(env.clients[0]);
      await waitForOrchestratorStarted(env.clients[0]);
      await advanceBlock();
      await waitForOrchestratorState(env.clients[0], 'SYNCING', 20000);
    });

    after(async function () {
      this.timeout(30000);
      await clearAllNodeStatus();
      await env?.teardown();
    });

    it('should stay SYNCING with no READINESS_LOST when message capability lost', async function () {
      this.timeout(30000);
      await setNodeStatus(env.clients[0].ip, 'EXPIRED');
      // Wait for the confirmation poll to detect the change
      await new Promise((r) => setTimeout(r, 10000));
      const stateEvents = env.clients[0].getEventBuffer()
        .filter((e) => e.event === 'orchestrator:stateChanged');
      const toDegraded = stateEvents.find((e) => e.data.to === 'DEGRADED');
      const pauseEvents = env.clients[0].getEventBuffer()
        .filter((e) => e.event === 'spawner:paused');
      expect(toDegraded, 'message capability loss during SYNCING should not trigger DEGRADED').to.be.undefined;
      expect(pauseEvents.length, 'no spawner:paused event should be emitted during SYNCING').to.equal(0);
    });
  });
});
