import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForOrchestratorState, waitForPeerThreshold, waitForPeersBelowThreshold,
  waitForSpawnerResumed, waitForSpawnerPaused, waitFor,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
  clearAllNodeStatus, setNodeStatus, disableAllRpcFailure,
} from '../framework/daemon-control.js';

async function bootNodes(env, { discover = false } = {}) {
  await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
  await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
  await advanceBlock();
  await Promise.all(env.clients.map((c) => waitForBlockProcessed(c, () => true, 30000)));
  if (discover) {
    await env.startDiscovery();
    await waitForPeerThreshold(env.clients[0], 120000);
  }
}

// Suite 1: INITIALIZING → SYNCING

describe('Orchestrator: INITIALIZING to SYNCING', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 3, deferredNodes: 1, tickerAutostart: false });
    await Promise.all(env.clients.filter(Boolean).map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.filter(Boolean).map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should transition to SYNCING on first block received', async function () {
    this.timeout(30000);
    await advanceBlock();
    await waitForBlockProcessed(env.clients[0], () => true, 20000);
    await waitForOrchestratorState(env.clients[0], 'SYNCING', 20000);
  });

  it('should stay INITIALIZING without blocks on deferred node', async function () {
    this.timeout(30000);
    await env.startNode(env.lastNodeIndex);
    await waitForDaemonReady(env.clients[env.lastNodeIndex]);
    await new Promise((r) => setTimeout(r, 5000));
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

    before(async function () {
      this.timeout(300000);
      // 2 nodes: node 0 can never reach peer threshold of 2 by itself
      // (it has at most 1 peer), so ephemeral sync won't complete via peers.
      // Block timer at 250 blocks (125 * 2) should kick in.
      env = await createTestEnv({ nodes: 2, tickerAutostart: false });
      await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
      await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
      await advanceBlock();
      await Promise.all(env.clients.map((c) => waitForBlockProcessed(c, () => true, 30000)));
      await waitForOrchestratorState(env.clients[0], 'SYNCING', 30000);
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
  });
});

// Suite 3: READY → DEGRADED

describe('Orchestrator: READY to DEGRADED', function () {
  let env;

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

describe('Orchestrator: BUG #2 — peer drop during SYNCING', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await advanceBlock();
    await Promise.all(env.clients.map((c) => waitForBlockProcessed(c, () => true, 30000)));
    await env.startDiscovery();
    await waitForPeerThreshold(env.clients[0], 120000);
    // Now in SYNCING with peers above threshold
    await waitForOrchestratorState(env.clients[0], 'SYNCING', 10000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should stay SYNCING when peers drop (no DEGRADED transition)', async function () {
    this.timeout(60000);
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    await waitForPeersBelowThreshold(env.clients[0], 30000);
    // Wait a bit to see if any state change fires
    await new Promise((r) => setTimeout(r, 5000));
    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged');
    const degraded = stateEvents.find((e) => e.data.to === 'DEGRADED');
    expect(degraded, 'BUG #2: orchestrator should transition to DEGRADED from SYNCING but does not').to.be.undefined;
  });
});

// Suite 4: DEGRADED → RESYNCING → READY

describe('Orchestrator: DEGRADED recovery cycle', function () {
  let env;

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

describe('Orchestrator: BUG #1 — blocks not counted during RESYNCING', function () {
  let env;

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

  it('should not count blocks toward block timer during RESYNCING', async function () {
    this.timeout(120000);
    // Advance many blocks — if they were counted, block timer (250) would fire
    await advanceBlocks(300);
    // Give the orchestrator time to process
    await new Promise((r) => setTimeout(r, 10000));
    // Check if we're still in RESYNCING (blocks weren't counted)
    // or if we jumped to READY (blocks were counted — bug would be fixed)
    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged');
    const lastState = stateEvents[stateEvents.length - 1];
    // BUG #1: blocks during RESYNCING are NOT counted at line 277,
    // so the block timer cannot fire as a fallback during RESYNCING.
    // If hash sync also fails, the orchestrator is stuck.
    expect(lastState.data.to).to.equal('RESYNCING',
      'BUG #1: blocks during RESYNCING are not counted toward block timer — orchestrator stuck if hash sync fails');
  });
});

// Suite 5: Message capability loss

describe('Orchestrator: message capability loss', function () {
  describe('loss during READY', function () {
    let env;

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

  describe('BUG #4: loss during SYNCING is silent', function () {
    let env;

    before(async function () {
      this.timeout(120000);
      env = await createTestEnv({ nodes: 5, tickerAutostart: false });
      await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
      await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
      await advanceBlock();
      await Promise.all(env.clients.map((c) => waitForBlockProcessed(c, () => true, 30000)));
      await waitForOrchestratorState(env.clients[0], 'SYNCING', 10000);
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
      expect(toDegraded, 'BUG #4: message capability loss during SYNCING does not trigger DEGRADED').to.be.undefined;
      expect(pauseEvents.length, 'BUG #4: no spawner:paused event emitted during SYNCING').to.equal(0);
    });
  });
});
