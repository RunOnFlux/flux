/*
 * A node that verifies the messages it fetched in bulk for longer than a peer connection may sit
 * idle still keeps every one of them.
 *
 * The peers serve a log the size of mainnet's - 74,600 messages that compress as mainnet's do -
 * far more than a connection's buffers hold. The joiner is missing the first 600 of them. Its
 * verification is held at hashSync:beforeVerify for 150 s - longer than the 120 s a bulk fetch
 * lets a peer connection go without data in production - and then released. Fetching is over
 * before verifying starts, so no connection is open while it waits: the first peer asked delivers
 * everything, and the joiner keeps every message at its own record's txid, height and payment.
 */
import { gzipSync } from 'node:zlib';
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForOrchestratorState } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { buildMessageLog, startJoiner, messagesNotKept } from '../framework/message-log.js';

const PEERS = [0, 1, 2, 3];
const JOINER = 4;
// Production's hashSyncBulkIdleMs, which the hold must outlast.
const PRODUCTION_IDLE_MS = 120000;
const HOLD_MS = 150000;
// Mainnet's whole log compresses to some 33 MB.
const MAINNET_LIKE_BYTES = 30e6;

describe('a node that verifies for longer than a peer connection may sit idle loses nothing', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let missing;
  let servedBytes;
  let held;
  let heldFor;
  let stagedWhileHeld;
  let bulkFetched;

  before(async function () {
    this.timeout(2400000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, deferredNodes: 1 });
    await bootAndPeer(env);

    const stamp = Date.now();
    missing = await buildMessageLog({
      env, name: `e2eSlowVerify${stamp}x`, apps: 10, updates: 59, height: env.initialHeight - 90000,
    });
    const rest = await buildMessageLog({
      env, name: `e2eSlowVerifyRest${stamp}x`, apps: 74, updates: 999, height: env.initialHeight - 85000, incompressible: true,
    });
    const served = [...missing, ...rest].map((m) => m.permanentMessage);
    servedBytes = gzipSync(JSON.stringify({ status: 'success', data: served })).length;
    await Promise.all(PEERS.map((i) => dbClient(i + 1).seedPermanentMessages(served)));
    await dbClient(JOINER + 1).seedAppHashes(missing.map((m) => ({ ...m.hashEntry, message: false })));

    const client = await startJoiner(env, JOINER);
    await client.holdCheckpoint('hashSync:beforeVerify');
    await env.startDiscovery([JOINER]);

    held = await client.waitForEvent('checkpoint:held', (d) => d.name === 'hashSync:beforeVerify', 900000);
    stagedWhileHeld = (await dbClient(JOINER + 1).collectionNames('appsGlobal')).includes('zelappsmessagesstaging');
    const heldAt = Date.now();
    await new Promise((resolve) => { setTimeout(resolve, HOLD_MS); });
    await client.releaseCheckpoint('hashSync:beforeVerify');
    heldFor = Date.now() - heldAt;

    // A fetch that never finishes is the failure this suite is about, so it is an outcome to
    // assert on rather than a setup that did not complete.
    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 300000).catch(() => null);
    if (bulkFetched) await waitForOrchestratorState(client, 'READY', 600000);
  });

  after(async function () {
    this.timeout(120000);
    await env?.teardown();
  });

  it('serves a log as large as mainnet\'s, which no connection buffers whole', function () {
    expect(servedBytes).to.be.above(MAINNET_LIKE_BYTES);
  });

  it('held verification for longer than a peer connection may sit idle', function () {
    expect(held, 'verification reached its checkpoint').to.exist;
    expect(heldFor).to.be.above(PRODUCTION_IDLE_MS);
  });

  it('finished the fetch, taking every missing message from the first peer it asked', function () {
    expect(bulkFetched, 'a bulk fetch finished within 300 s of verification resuming').to.exist;
    const { peers, processed } = bulkFetched.data;
    expect(peers, JSON.stringify(bulkFetched.data)).to.have.lengthOf(1);
    expect(peers[0].error, JSON.stringify(peers[0])).to.equal(undefined);
    expect(peers[0].staged).to.equal(missing.length);
    expect(processed).to.equal(missing.length);
  });

  it('keeps every message, each at its own record\'s txid, height and payment', async function () {
    expect(await messagesNotKept(JOINER, missing)).to.deep.equal([]);
  });

  it('leaves no staged messages behind', async function () {
    expect(stagedWhileHeld, 'a stage while verification was held').to.equal(true);
    expect(await dbClient(JOINER + 1).collectionNames('appsGlobal')).to.not.include('zelappsmessagesstaging');
  });
});
