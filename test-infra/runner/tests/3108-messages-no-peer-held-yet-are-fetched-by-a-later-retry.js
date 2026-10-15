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
import { waitFor, waitForOrchestratorState } from '../framework/wait.js';
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

    // The first sync asked its peers for each hash, and a peer answers those one at a time. Every
    // ask is answered before the peers are given the log, so the retry is the only way the
    // messages reach the joiner.
    const asks = (i, event) => env.clients[i].getEventBuffer().filter((e) => e.event === event).length;
    await waitFor(
      () => PEERS.some((i) => asks(i, 'hashRequest:received') > 0)
        && PEERS.every((i) => asks(i, 'hashRequest:responded') === asks(i, 'hashRequest:received')),
      { timeout: 600000, interval: 2000, label: 'every peer done answering the first sync\'s asks' },
    );

    await Promise.all(PEERS.map(async (i) => {
      await dbClient(i + 1).seedPermanentMessages(log.map((m) => m.permanentMessage));
      await dbClient(i + 1).seedAppHashes(log.map((m) => m.hashEntry));
    }));

    await stopTicker();
    const lastEventId = client.getLastEventId();
    await advanceBlocks(FIRST_RETRY_BLOCKS + 5);
    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000, { afterId: lastEventId });
    await waitFor(async () => (await messagesNotKept(JOINER, log)).length === 0, {
      timeout: 300000, interval: 3000, label: 'every message kept after the retry',
    }).catch(() => {});
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('ended its first sync with every message still missing', function () {
    expect(firstSync.data.missing, JSON.stringify(firstSync.data)).to.equal(log.length);
    expect(missingAfterFirstSync).to.equal(log.length);
  });

  it('took every message in bulk on the retry', function () {
    const { staged, processed } = bulkFetched.data;
    expect(staged, JSON.stringify(bulkFetched.data)).to.equal(log.length);
    expect(processed).to.equal(log.length);
  });

  it('keeps every message, each at its own record\'s txid, height and payment', async function () {
    const notKept = await messagesNotKept(JOINER, log);
    expect(notKept, JSON.stringify(notKept)).to.deep.equal([]);
  });
});
