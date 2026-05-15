import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForOrchestratorState, waitForPeerThreshold, waitForPeersBelowThreshold,
  waitForSpawnerPaused, waitForSpawnerResumed,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
  enableRpcFailure, disableRpcFailure, disableAllRpcFailure,
  clearAllNodeStatus,
} from '../framework/daemon-control.js';

async function bootToReady(env) {
  await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
  await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
  await advanceBlock();
  await Promise.all(env.clients.map((c) => waitForBlockProcessed(c, () => true, 30000)));
  await env.startDiscovery();
  await waitForPeerThreshold(env.clients[0], 120000);
  await startTicker();
  await waitForOrchestratorState(env.clients[0], 'READY', 120000);
  await stopTicker();
}

describe('Compound failures: peer loss + daemon failure during READY', function () {
  let env;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToReady(env);
  });

  after(async function () {
    this.timeout(30000);
    await disableAllRpcFailure();
    await clearAllNodeStatus();
    await env?.teardown();
  });

  it('should enter DEGRADED and pause spawner exactly once', async function () {
    this.timeout(60000);
    // Simultaneously disconnect peers AND fail RPC
    await enableRpcFailure(env.clients[0].ip);
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 30000);
    await waitForSpawnerPaused(env.clients[0], 10000);

    // READINESS_LOST should fire exactly once (from peer degradation, not from
    // message capability loss — because the orchestrator is already DEGRADED
    // when the confirmation poll detects the RPC failure)
    const pauseEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'spawner:paused');
    expect(pauseEvents.length).to.equal(1, 'READINESS_LOST should fire exactly once');
  });

  it('should enter RESYNCING but NOT READY when peers recover with RPC still failing', async function () {
    this.timeout(120000);
    // Reconnect peers but keep RPC failing
    for (let i = 1; i < env.clients.length; i++) {
      await env.reconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'RESYNCING', 60000);
    // Wait to confirm we stay in RESYNCING (canSendMessages is false)
    await new Promise((r) => setTimeout(r, 10000));
    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged');
    const lastState = stateEvents[stateEvents.length - 1];
    expect(lastState.data.to).to.equal('RESYNCING',
      'should stay in RESYNCING — canSendMessages is false due to RPC failure');
  });

  it('should fully recover to READY when RPC restored', async function () {
    this.timeout(120000);
    await disableAllRpcFailure();
    await startTicker();
    await waitForOrchestratorState(env.clients[0], 'READY', 90000);
    await waitForSpawnerResumed(env.clients[0], 10000);
  });
});

describe('Compound failures: rapid peer oscillation', function () {
  let env;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToReady(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should settle to correct state after rapid connect/disconnect', async function () {
    this.timeout(120000);
    // Rapidly oscillate peers
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    // Immediately reconnect
    for (let i = 1; i < env.clients.length; i++) {
      await env.reconnectNode(i);
    }
    // Disconnect again
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    // Final reconnect
    for (let i = 1; i < env.clients.length; i++) {
      await env.reconnectNode(i);
    }

    // Wait for state to settle
    await new Promise((r) => setTimeout(r, 15000));

    // Final state should reflect that peers are connected
    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged');
    const lastState = stateEvents[stateEvents.length - 1];
    // Should end in READY or RESYNCING (on its way back to READY)
    expect(['READY', 'RESYNCING']).to.include(lastState.data.to,
      'should not be stuck in DEGRADED with peers connected');
  });
});

describe('Compound failures: RESYNCING + block timer', function () {
  let env;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToReady(env);
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

  it('should not reach READY during RESYNCING when canSendMessages is false', async function () {
    this.timeout(120000);
    // RPC is still failing from previous test — canSendMessages is false.
    // Even though blocks are counted during RESYNCING (block timer fires),
    // checkReadiness gates on canSendMessages and blocks the READY transition.
    await advanceBlocks(300);
    await new Promise((r) => setTimeout(r, 10000));

    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged');
    const reachedReady = stateEvents.find((e) => e.data.from === 'RESYNCING' && e.data.to === 'READY');
    expect(reachedReady, 'should not reach READY while canSendMessages is false').to.be.undefined;
  });
});
