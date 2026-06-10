import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold, waitForPeersBelowThreshold,
  waitForSpawnerPaused, waitForSpawnerResumed,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
  enableRpcFailure, disableAllRpcFailure, clearAllNodeStatus,
} from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

async function bootToReady(env) {
  await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
  await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
  await waitForExplorerReady(env.clients[0]);
  await waitForOrchestratorStarted(env.clients[0]);
  await advanceBlock();
  await waitForBlockProcessed(env.clients[0], () => true, 20000);
  await env.startDiscovery();
  await waitForPeerThreshold(env.clients[0], 120000);
  await startTicker();
  await waitForOrchestratorState(env.clients[0], 'READY', 120000);
  await stopTicker();
}

describe('Compound failures: peer loss + daemon failure during READY', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
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
    await enableRpcFailure(env.clients[0].ip);
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 30000);
    await waitForSpawnerPaused(env.clients[0], 10000);

    const pauseEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'spawner:paused');
    expect(pauseEvents.length).to.equal(1, 'READINESS_LOST should fire exactly once');
  });

  it('should enter RESYNCING but NOT READY when peers recover with RPC still failing', async function () {
    this.timeout(120000);
    for (let i = 1; i < env.clients.length; i++) {
      await env.reconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'RESYNCING', 60000);
    // Advance blocks past block timer — READY should still be blocked by canSendMessages
    await advanceBlocks(260);
    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged');
    const reachedReady = stateEvents.find((e) => e.data.from === 'RESYNCING' && e.data.to === 'READY');
    expect(reachedReady, 'should not reach READY while canSendMessages is false').to.be.undefined;
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
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootToReady(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should not be stuck in DEGRADED after reconnecting all peers', async function () {
    this.timeout(60000);
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    for (let i = 1; i < env.clients.length; i++) {
      await env.reconnectNode(i);
    }
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    for (let i = 1; i < env.clients.length; i++) {
      await env.reconnectNode(i);
    }

    // Wait for READY or RESYNCING — either means not stuck in DEGRADED
    await waitForOrchestratorState(env.clients[0], 'READY', 30000).catch(() => {});
    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged');
    const lastState = stateEvents[stateEvents.length - 1];
    expect(['READY', 'RESYNCING']).to.include(lastState.data.to,
      'should not be stuck in DEGRADED with peers connected');
  });
});
