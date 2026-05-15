import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold,
  waitForSpawnerPaused, waitForSpawnerResumed, waitForSpawnerBlocked,
} from '../framework/wait.js';
import {
  advanceBlock, startTicker, stopTicker,
  setNodeStatus, clearAllNodeStatus,
} from '../framework/daemon-control.js';
import { fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';

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

describe('Spawner gate conditions', function () {
  let env;
  let fluxTeamAuth;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToReady(env);
    fluxTeamAuth = await authenticate(env.clients[0].url, fluxTeamKey());
  });

  afterEach(async function () {
    this.timeout(30000);
    await clearAllNodeStatus();
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should pause spawner when orchestrator signals READINESS_LOST', async function () {
    this.timeout(60000);
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    await waitForSpawnerPaused(env.clients[0], 30000);
  });

  it('should resume spawner when orchestrator signals SPAWNER_READY', async function () {
    this.timeout(120000);
    for (let i = 1; i < env.clients.length; i++) {
      await env.reconnectNode(i);
    }
    await startTicker();
    await waitForSpawnerResumed(env.clients[0], 90000);
    await stopTicker();
  });

  it('should block spawner when node loses confirmation', async function () {
    this.timeout(30000);
    await setNodeStatus(env.clients[0].ip, 'EXPIRED');
    await waitForSpawnerBlocked(env.clients[0], 'not_confirmed', 20000);
  });

  it('should block spawner when node is in DOS state', async function () {
    this.timeout(30000);
    const res = await env.clients[0].setDOSState(100, 'test dos', fluxTeamAuth.zelidauth);
    expect(res.status).to.equal('success');
    await waitForSpawnerBlocked(env.clients[0], 'dos', 20000);
  });
});
