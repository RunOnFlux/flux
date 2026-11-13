/*
 * A node's explorer keeps records only for blocks on fluxd's active chain. When the
 * next block does not name the last block the explorer processed as its parent, the
 * explorer restores its records to the highest processed block still on the active
 * chain and processes the new branch from there; a chain that only grows never
 * restores anything.
 *
 * The fixture records an app payment at height H, then replaces H with a block that
 * carries no transaction, so the payment's record exists only on the branch fluxd has
 * left. The next block mined is the first the explorer can see the fork from: it names
 * the replacement for H as its parent. Restored to H - 1, the record is no payment; a
 * node that never compared parents keeps it as one, which is the outcome this suite
 * tells apart.
 *
 * The daemon stub is not fluxd: the fork is a control call, and fluxd's choice of
 * branch (most work) is not exercised.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  stopTicker, queueAppTx, advanceBlock, advanceBlocks, forkChain, getState,
} from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor, assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const NODES = 3;
// The middle of the ring: every backward arc wraps onto index 0.
const NODE = 1;

describe('the explorer restores its records to the fork a new block names, and only then', function () {
  let env;
  let client;
  let db;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    await stopTicker();
    client = env.clients[NODE];
    db = dbClient(NODE + 1);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  async function tipProcessed(afterId) {
    const { currentHeight } = await getState();
    await client.waitForEvent('block:processed', (d) => d.height === currentHeight, 120000, { afterId });
    return currentHeight;
  }

  it('processes a chain that only grows without restoring its records', async function () {
    this.timeout(180000);
    const mark = client.getLastEventId();

    await advanceBlocks(3);

    // The canary: the explorer reached the tip of the grown chain.
    await tipProcessed(mark);
    await assertNoEvent(client, 'explorer:reorganised', () => true, 1000, { afterId: mark });
  });

  it('restores its records to the fork when the next block follows a block it never processed', async function () {
    this.timeout(240000);
    const hash = randomBytes(32).toString('hex');
    await queueAppTx(hash);
    await advanceBlock();
    const { currentHeight: paidAt } = await getState();
    await waitFor(async () => (await db.appHashRecord(hash))?.height === paidAt,
      { timeout: 120000, interval: 1000, label: `the payment recorded at ${paidAt}` });
    const mark = client.getLastEventId();

    await forkChain(paidAt);
    await advanceBlock();

    await tipProcessed(mark);
    expect((await db.appHashRecord(hash))?.notOnChain, 'the payment on the branch fluxd left').to.equal(true);
    const reorganised = client.getEventBuffer()
      .filter((e) => e.id > mark && e.event === 'explorer:reorganised')
      .map((e) => e.data);
    expect(reorganised).to.deep.equal([{ parentHeight: paidAt, restoredTo: paidAt - 1, forkFound: true }]);
  });
});
