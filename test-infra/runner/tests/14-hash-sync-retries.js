import { describe, it, before, after } from 'mocha';
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

async function bootToSyncing(env) {
  await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
  await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
  await waitForExplorerReady(env.clients[0]);
  await waitForOrchestratorStarted(env.clients[0]);
  await env.startDiscovery();
  await waitForPeerThreshold(env.clients[0], 120000);
}

describe('Hash sync: retry on failure', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToSyncing(env);

    // Inject failpoint before first block triggers hash sync.
    // times: 1 — first syncMissingHashes query fails, retry succeeds.
    const db = dbClient(1);
    await db.failpointFind('zelappshashes', { times: 1 });

    await advanceBlock();
    await waitForBlockProcessed(env.clients[0], () => true, 20000);
  });

  after(async function () {
    this.timeout(30000);
    const db = dbClient(1);
    await db.failpointClear();
    await env?.teardown();
  });

  it('should fail initial hash sync and schedule a retry', async function () {
    this.timeout(30000);
    const event = await env.clients[0].waitForEvent(
      'hashSync:failed',
      (d) => d.attempt === 1 && d.willRetry === true,
      20000,
    );
    expect(event.data.willRetry).to.equal(true);
  });

  it('should succeed on retry', async function () {
    this.timeout(30000);
    const event = await env.clients[0].waitForEvent('hashSync:complete', () => true, 20000);
    expect(event.data.attempt).to.equal(2);
  });
});

describe('Hash sync: retry exhaustion', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToSyncing(env);

    // times: 2 — both attempts fail (hashSyncMaxRetries: 2 in test config)
    const db = dbClient(1);
    await db.failpointFind('zelappshashes', { times: 2 });

    await advanceBlock();
    await waitForBlockProcessed(env.clients[0], () => true, 20000);
  });

  after(async function () {
    this.timeout(30000);
    const db = dbClient(1);
    await db.failpointClear();
    await env?.teardown();
  });

  it('should exhaust retries', async function () {
    this.timeout(60000);
    const event = await env.clients[0].waitForEvent(
      'hashSync:failed',
      (d) => d.willRetry === false,
      50000,
    );
    expect(event.data.attempt).to.equal(2);
  });

  it('should still reach READY via block fallback', async function () {
    this.timeout(300000);
    // Block threshold is 250 (125 min * 2 blocks/min). Advance past it.
    await advanceBlocks(260);
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
  });
});

describe('Hash sync: retry timer cancelled during DEGRADED', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToReady(env);
  });

  after(async function () {
    this.timeout(30000);
    const db = dbClient(1);
    await db.failpointClear();
    await env?.teardown();
  });

  it('should not fire hash sync retry during DEGRADED', async function () {
    this.timeout(120000);

    const db = dbClient(1);
    const heightBefore = await db.explorerHeight();
    const fakeHash = 'deadbeef'.repeat(8);
    await advanceBlock(fakeHash);
    await waitForBlockProcessed(env.clients[0], (d) => d.height > heightBefore, 20000);

    // Disconnect all peers → DEGRADED (resetSyncState cancels any pending retry timer)
    for (let i = 1; i < env.clients.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 30000);

    const countAtDegraded = env.nodeLogCount(0, 'syncMissingHashes');

    // Wait longer than hashSyncRetryMs (10s in test config)
    await new Promise((r) => { setTimeout(r, 15000); });

    const countAfterWait = env.nodeLogCount(0, 'syncMissingHashes');
    expect(countAfterWait).to.equal(countAtDegraded,
      'hash sync retry should not fire during DEGRADED');
  });
});

describe('Hash sync: attempts reset after degrade/recover', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await bootToSyncing(env);

    // Exhaust retries on initial sync (times: 2, maxRetries: 2)
    const db = dbClient(1);
    await db.failpointFind('zelappshashes', { times: 2 });

    await advanceBlock();
    await waitForBlockProcessed(env.clients[0], () => true, 20000);

    // Wait for retries to exhaust
    await env.clients[0].waitForEvent(
      'hashSync:failed',
      (d) => d.willRetry === false,
      50000,
    );

    // Clear failpoint so recovery sync succeeds
    await db.failpointClear();

    // Block threshold is 250 (125 min * 2 blocks/min). Advance past it.
    await advanceBlocks(260);
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
  });

  after(async function () {
    this.timeout(30000);
    const db = dbClient(1);
    await db.failpointClear();
    await env?.teardown();
  });

  it('should run hash sync successfully after degrade/recover cycle', async function () {
    this.timeout(120000);
    const mark = env.clients[0].getLastEventId();

    // Degrade: disconnect all peers
    for (let i = 1; i < env.clients.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 30000);

    // Reconnect peers → RESYNCING → hash sync runs with reset counter
    for (let i = 1; i < env.clients.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await env.reconnectNode(i);
    }

    const event = await env.clients[0].waitForEvent('hashSync:complete', () => true, 60000, { afterId: mark });
    expect(event.data.attempt).to.equal(1);
  });

  it('should retry if hash sync fails after recovery', async function () {
    this.timeout(120000);
    const mark = env.clients[0].getLastEventId();

    // Inject failpoint — first attempt fails, retry succeeds
    const db = dbClient(1);
    await db.failpointFind('zelappshashes', { times: 1 });

    // Degrade again
    for (let i = 1; i < env.clients.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await env.disconnectNode(i);
    }
    await waitForOrchestratorState(env.clients[0], 'DEGRADED', 30000);

    // Reconnect
    for (let i = 1; i < env.clients.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await env.reconnectNode(i);
    }

    // Without the fix: attempts still at 2 from before, +1 = 3 >= 2, no retry.
    // With the fix: attempts reset to 0, +1 = 1 < 2, retry IS scheduled.
    const failEvent = await env.clients[0].waitForEvent(
      'hashSync:failed',
      (d) => d.willRetry === true,
      50000,
      { afterId: mark },
    );
    expect(failEvent.data.attempt).to.equal(1);

    await db.failpointClear();

    const completeEvent = await env.clients[0].waitForEvent('hashSync:complete', () => true, 30000, { afterId: failEvent.id });
    expect(completeEvent.data.attempt).to.equal(2);
  });
});

describe('Hash sync: block-timer retry with unresolvable hash', function () {
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
