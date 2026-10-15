/*
 * A node whose peers do not hold its missing messages yet fetches them in bulk on a later retry,
 * once they do.
 *
 * The joiner holds the payment records of 600 messages and no peer holds any of them, so its first
 * hash sync ends with all 600 still missing, each held back for the first retry interval of blocks.
 * The peers are then given the log, and once the chain is past that interval the block-driven
 * retry asks for the 600 again, in bulk, and keeps every one.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForOrchestratorState } from '../framework/wait.js';
import { advanceBlocks, stopTicker } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { buildMessageLog, startJoiner, messagesNotKept } from '../framework/message-log.js';

const PEERS = [0, 1, 2, 3];
const JOINER = 4;
// The first retry of an unresolved hash: HASH_RETRY_BACKOFF[1] in appConstants.js.
const FIRST_RETRY_BLOCKS = 100;

describe('messages no peer held yet are fetched in bulk by a later retry', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let log;
  let firstSync;
  let missingAfterFirstSync;
  let bulkFetched;

  before(async function () {
    this.timeout(1800000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, deferredNodes: 1 });
    await bootAndPeer(env);

    log = await buildMessageLog({
      env, name: `e2eLaterRetry${Date.now()}x`, apps: 10, updates: 59, height: env.initialHeight - 2000,
    });
    await dbClient(JOINER + 1).seedAppHashes(log.map((m) => ({ ...m.hashEntry, message: false })));

    const client = await startJoiner(env, JOINER);
    await env.startDiscovery([JOINER]);
    firstSync = await client.waitForEvent('hashSync:complete', () => true, 900000);
    await waitForOrchestratorState(client, 'READY', 600000);
    missingAfterFirstSync = log.length - (await dbClient(JOINER + 1).appHashRecords({ hash: { $in: log.map((m) => m.hash) }, message: true })).length;

    await Promise.all(PEERS.map(async (i) => {
      await dbClient(i + 1).seedPermanentMessages(log.map((m) => m.permanentMessage));
      await dbClient(i + 1).seedAppHashes(log.map((m) => m.hashEntry));
    }));

    await stopTicker();
    const lastEventId = client.getLastEventId();
    await advanceBlocks(FIRST_RETRY_BLOCKS + 5);
    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000, { afterId: lastEventId });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('ended its first sync with every message still missing', function () {
    expect(firstSync.data.missing, JSON.stringify(firstSync.data)).to.equal(log.length);
    expect(missingAfterFirstSync).to.equal(log.length);
  });

  // The per-hash requests of the first sync are still being answered when the peers are given the
  // log, so a message they answer can be stored between the bulk fetch staging it and verifying it.
  it('took every message in bulk on the retry', function () {
    const { staged, processed, skipped } = bulkFetched.data;
    expect(staged, JSON.stringify(bulkFetched.data)).to.equal(log.length);
    expect(processed + skipped).to.equal(log.length);
  });

  it('keeps every message, each at its own record\'s txid, height and payment', async function () {
    expect(await messagesNotKept(JOINER, log)).to.deep.equal([]);
  });
});
