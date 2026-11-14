import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold,
  waitFor,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
} from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

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

describe('Hash sync: block-timer retry with unresolvable hash', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootToReady(env);
  });

  afterTeardown(async function () {
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
    // Advance past hashSyncFallbackRecheckBlocks (10 in test config)
    // so checkHashRetry fires
    await advanceBlocks(12);
    await waitFor(
      () => env.nodeHasLog(0, 'Hash retry'),
      { timeout: 30000, interval: 2000, label: 'hash retry log' },
    );
    expect(env.nodeHasLog(0, 'Hash retry')).to.equal(true);
  });
});
