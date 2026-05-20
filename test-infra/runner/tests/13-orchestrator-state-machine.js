import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold, waitForPeersBelowThreshold,
  waitForSpawnerResumed, waitForSpawnerPaused, waitFor,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
  clearAllNodeStatus, setNodeStatus, disableAllRpcFailure,
} from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

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
    env = await createTestEnv({ nodes: 3, deferredNodes: 1, tickerAutostart: false });
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
      env = await createTestEnv({ nodes: 5, tickerAutostart: false });
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

  describe('block timer fallback (insufficient peers)', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(300000);
      // 2 nodes: node 0 can never reach peer threshold of 2 by itself
      // (it has at most 1 peer), so ephemeral sync won't complete via peers.
      // Block timer at 250 blocks (125 * 2) should kick in.
      env = await createTestEnv({ nodes: 2, tickerAutostart: false });
      await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
      await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
      await waitForExplorerReady(env.clients[0]);
      await waitForOrchestratorStarted(env.clients[0]);
      await advanceBlock();
      await waitForOrchestratorState(env.clients[0], 'SYNCING', 20000);
    });

    after(async function () {
      this.timeout(30000);
      await env?.teardown();
    });

    it('should reach READY via block timer without peer sync completions', async function () {
      this.timeout(300000);
      await advanceBlocks(260);
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
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
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
    this.timeout(60000);
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 30000);
  });

  it('should emit READINESS_LOST (spawner paused)', async function () {
    this.timeout(10000);
    await waitForSpawnerPaused(env.clients[0], 5000);
  });
});

describe('Orchestrator: peer drop during SYNCING', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await waitForExplorerReady(env.clients[0]);
    await waitForOrchestratorStarted(env.clients[0]);
    await advanceBlock();
    await waitForBlockProcessed(env.clients[0], () => true, 20000);
    await env.startDiscovery();
    await waitForPeerThreshold(env.clients[0], 120000);
    await waitForOrchestratorState(env.clients[0], 'SYNCING', 20000);
    // Revoke message capability so the orchestrator stays in SYNCING
    await setNodeStatus(env.clients[0].ip, 'EXPIRED');
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 20000);
  });

  after(async function () {
    this.timeout(30000);
    await clearAllNodeStatus();
    await env?.teardown();
  });

  it('should transition to DEGRADED when peers drop during SYNCING', async function () {
    this.timeout(30000);
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 10000);
  });
});

// Suite 4: DEGRADED → RESYNCING → READY

describe('Orchestrator: DEGRADED recovery cycle', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootNodes(env, { discover: true });
    await startTicker();
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
    await stopTicker();
    // Disconnect all peers to trigger DEGRADED
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 30000);
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
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootNodes(env, { discover: true });
    await startTicker();
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
    await stopTicker();
    // Enter DEGRADED
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 30000);
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

// Suite 5: Message capability loss

describe('Orchestrator: message capability loss', function () {
  describe('loss during READY', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(300000);
      env = await createTestEnv({ nodes: 5, tickerAutostart: false });
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
      env = await createTestEnv({ nodes: 5, tickerAutostart: false });
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
