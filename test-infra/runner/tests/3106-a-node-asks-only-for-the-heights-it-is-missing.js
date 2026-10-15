/*
 * A node fetching messages in bulk asks a peer only for the block heights it is missing, joining
 * two runs into one request only when few payments it already holds lie between them.
 *
 * The log on chain, in height order:
 *   A    300 messages the joiner is missing
 *        50 it holds
 *   B    200 it is missing
 *        50 it holds, then 2020 more it holds
 *   C    50 it is missing
 * Fewer than 2000 held payments lie between A and B, so they are asked for in one range, and the
 * peer sends the 50 held messages between them with it. More than 2000 lie between B and C, so C
 * is asked for on its own and nothing between them is sent: one peer answers two ranges, sending
 * 600 messages of which 550 are missing.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForOrchestratorState } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import {
  buildMessageLog, seedMessageLog, startJoiner, messagesNotKept,
} from '../framework/message-log.js';

const PEERS = [0, 1, 2, 3];
const JOINER = 4;

describe('a node asks a peer only for the heights it is missing', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let log;
  let missing;
  let bulkFetched;

  before(async function () {
    this.timeout(1800000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, deferredNodes: 1 });
    await bootAndPeer(env);

    const stamp = Date.now();
    const base = env.initialHeight - 6000;
    const first = await buildMessageLog({
      env, name: `e2eRangeA${stamp}x`, apps: 10, updates: 59, height: base,
    });
    const between = await buildMessageLog({
      env, name: `e2eRangeGap${stamp}x`, apps: 20, updates: 100, height: base + 1000,
    });
    const last = await buildMessageLog({
      env, name: `e2eRangeC${stamp}x`, apps: 1, updates: 49, height: base + 4000,
    });
    log = [...first, ...between, ...last];
    missing = [...first.slice(0, 300), ...first.slice(350, 550), ...last];
    const missingHashes = new Set(missing.map((m) => m.hash));
    const held = new Set(log.filter((m) => !missingHashes.has(m.hash)).map((m) => m.hash));
    expect(held.size, 'held messages').to.equal(50 + 50 + 2020);

    await seedMessageLog({
      log, servers: PEERS, joiner: JOINER, held,
    });

    const client = await startJoiner(env, JOINER);
    await env.startDiscovery([JOINER]);
    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000);
    await waitForOrchestratorState(client, 'READY', 600000);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asked the first peer for two ranges, and was sent only what they cover', function () {
    const { peers } = bulkFetched.data;
    expect(peers, JSON.stringify(peers)).to.have.lengthOf(1);
    expect(peers[0]).to.include({
      route: 'byHeight', ranges: 2, received: 600, staged: missing.length,
    });
    expect(peers[0].error).to.equal(undefined);
  });

  it('keeps every message, each at its own record\'s txid, height and payment', async function () {
    expect(await messagesNotKept(JOINER, log)).to.deep.equal([]);
  });
});
