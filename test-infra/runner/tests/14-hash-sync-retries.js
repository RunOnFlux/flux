import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold, waitForPeersBelowThreshold,
  waitFor,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
} from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
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

describe('Hash sync: retry timer during DEGRADED', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToReady(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should cancel hash sync retry timer when entering DEGRADED', async function () {
    this.timeout(120000);
    const db = dbClient(1);
    const heightBefore = await db.explorerHeight();
    const fakeHash = 'deadbeef'.repeat(8);
    await advanceBlock(fakeHash);
    await waitForBlockProcessed(env.clients[0], (d) => d.height > heightBefore, 20000);

    // Disconnect all peers to enter DEGRADED — resetSyncState should cancel the retry timer
    for (let i = 1; i < env.clients.length; i++) {
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 30000);

    // Count hash sync log entries at the point of DEGRADED
    const countAtDegraded = env.nodeLogCount(0, 'syncMissingHashes');

    // Wait longer than hashSyncRetryMs (10s in test config)
    await new Promise((r) => setTimeout(r, 15000));

    // No new hash sync should have fired during DEGRADED
    const countAfterWait = env.nodeLogCount(0, 'syncMissingHashes');
    expect(countAfterWait).to.equal(countAtDegraded,
      'hash sync retry should not fire during DEGRADED');
  });
});

describe('Hash sync: retry exhaustion', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await advanceBlock();
    await Promise.all(env.clients.map((c) => waitForBlockProcessed(c, () => true, 30000)));
    await env.startDiscovery();
    await waitForPeerThreshold(env.clients[0], 120000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should fall back to block timer after exhausting retries', async function () {
    this.timeout(300000);
    // The orchestrator enters SYNCING on first block and starts hash sync.
    // With hashSyncMaxRetries: 2 and hashSyncRetryMs: 10000, after 2 failures
    // it should log "retries exhausted" and rely on block timer.
    // Advance blocks past the 250-block threshold to trigger fallback READY.
    await advanceBlocks(260);
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
    expect(env.nodeHasLog(0, 'All readiness conditions met')).to.equal(true);
  });
});

describe('Hash sync: retry triggers', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToReady(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should create unresolved hash from block with fake app tx', async function () {
    this.timeout(30000);
    const db = dbClient(1);
    const heightBefore = await db.explorerHeight();
    const fakeHash = 'abcdabcd'.repeat(8);
    await advanceBlock(fakeHash);
    await waitForBlockProcessed(env.clients[0], (d) => d.height > heightBefore, 20000);
    const counts = await db.hashCounts();
    expect(counts.missing).to.equal(1);
  });

  it('should trigger hash retry after enough blocks pass', async function () {
    this.timeout(60000);
    // nextHashRetryHeight is currentHeight + hashSyncFallbackRecheckBlocks (10 in test config)
    // Advance past it so checkHashRetry fires
    await advanceBlocks(12);
    await waitFor(
      () => env.nodeHasLog(0, 'Hash retry'),
      { timeout: 30000, interval: 2000, label: 'hash retry log' },
    );
    expect(env.nodeHasLog(0, 'Hash retry')).to.equal(true);
  });
});
