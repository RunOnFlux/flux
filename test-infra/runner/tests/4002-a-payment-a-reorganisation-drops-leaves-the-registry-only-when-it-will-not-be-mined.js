/*
 * A registration whose paying block a reorganisation replaces stays listed for as long as
 * fluxd can still mine its payment, a restart included, and leaves the registry once the
 * scan is past the replaced branch and the mempool no longer holds it. A block paying it
 * again restores it.
 *
 * The daemon stub is not fluxd: which transactions the mempool holds is set by the suite.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  stopTicker, queueAppTx, advanceBlock, advanceBlocks, forkChain, getState, setMempool,
} from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { nodeKey } from '../framework/keys.js';
import { waitFor, assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODE = 1;

describe('a payment a reorganisation drops leaves the registry only when it will not be mined', function () {
  let env;
  let client;
  let db;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
    await stopTicker();
    client = env.clients[NODE];
    db = dbClient(NODE + 1);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  async function tipProcessed(afterId) {
    const { currentHeight } = await getState();
    await client.waitForEvent('block:processed', (d) => d.height === currentHeight, 120000, { afterId });
  }

  async function paidApp(tag) {
    const spec = buildAppSpec({ name: `e2ereorg${tag}${Date.now()}` });
    const result = await registerApp(client.url, nodeKey(NODE + 1), spec);
    expect(result.status, JSON.stringify(result).slice(0, 300)).to.equal('success');
    const hash = result.data;
    await waitFor(async () => (await client.getTempMessages(hash)).data?.length > 0,
      { timeout: 30000, interval: 500, label: 'the temp message' });
    await queueAppTx(hash);
    await advanceBlock();
    const { currentHeight: paidAt } = await getState();
    await advanceBlock();
    await waitFor(async () => Boolean(await db.globalAppSpec(spec.name)),
      { timeout: 120000, interval: 1000, label: 'the registry row' });
    const { txid } = await db.appHashRecord(hash);
    return { name: spec.name, hash, paidAt, txid };
  }

  async function replaceItsBlock(paidAt, txid) {
    const mark = client.getLastEventId();
    await setMempool([txid]);
    await forkChain(paidAt);
    await advanceBlock();
    await client.waitForEvent('explorer:reorganised', (d) => d.forkFound === true, 120000, { afterId: mark });
    await tipProcessed(mark);
    return mark;
  }

  it('restores an app whose payment a later block pays again', async function () {
    this.timeout(240000);
    const { name, hash, paidAt, txid } = await paidApp('b');
    await replaceItsBlock(paidAt, txid);
    expect((await db.appHashRecord(hash))?.replaced, 'the payment was not kept as replaced').to.equal(paidAt + 1);

    await setMempool([]);
    await queueAppTx(hash);
    await advanceBlock();
    const { currentHeight: minedAt } = await getState();
    await advanceBlocks(2);

    await waitFor(async () => (await db.globalAppSpec(name))?.height === minedAt,
      { timeout: 120000, interval: 1000, label: 'the registry follows the payment' });
    expect((await db.appHashRecord(hash)).replaced).to.equal(undefined);
  });

  it('keeps listing an app while its payment is in the mempool, past the branch and across a restart', async function () {
    this.timeout(300000);
    const { name, hash, paidAt, txid } = await paidApp('a');
    const mark = await replaceItsBlock(paidAt, txid);

    await advanceBlocks(3);
    await tipProcessed(mark);
    await assertNoEvent(client, 'explorer:paymentsDropped', () => true, 1000, { afterId: mark });
    expect(await db.globalAppSpec(name), 'unlisted while it could still be mined').to.not.equal(null);

    await env.restartNode(NODE);
    await waitFor(async () => (await client.getTempMessages(hash)).status === 'success',
      { timeout: 120000, interval: 1000, label: 'the node back' });
    expect((await db.appHashRecord(hash))?.replaced, 'a boot restore lost the record').to.equal(paidAt + 1);
    expect(await db.globalAppSpec(name), 'unlisted by a restart').to.not.equal(null);

    const dropped = client.getLastEventId();
    await setMempool([]);
    await advanceBlock();
    await client.waitForEvent('explorer:paymentsDropped', (d) => d.hashes.includes(hash), 120000, { afterId: dropped });

    expect(await db.globalAppSpec(name), 'an unpaid app stayed listed').to.equal(null);
    expect((await db.appHashRecord(hash)).notOnChain).to.equal(true);
  });
});
