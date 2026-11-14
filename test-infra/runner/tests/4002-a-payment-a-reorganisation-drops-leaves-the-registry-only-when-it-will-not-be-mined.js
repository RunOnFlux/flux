/*
 * A registration whose paying block a reorganisation replaces stays listed for as long as
 * fluxd can still mine its payment, a restart included, and leaves the registry once the
 * scan is past the replaced branch and the mempool no longer holds it. A block paying it
 * again restores it. A payment found behind the tip follows the same rules, and its message
 * is requested once the explorer reaches the tip.
 *
 * The daemon stub is not fluxd: which transactions the mempool holds is set by the suite.
 */
import {
  describe, it, before, afterEach,
} from 'mocha';
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
import { afterTeardown } from '../framework/teardown-hook.js';

const NODE = 1;
const BEFORE_BLOCK = 'explorer:beforeBlock';

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

  afterTeardown(async function () {
    await env?.teardown();
  });

  afterEach(async function () {
    await client?.releaseAllCheckpoints();
  });

  async function tipProcessed(afterId) {
    const { currentHeight } = await getState();
    await client.waitForEvent('block:processed', (d) => d.height === currentHeight, 120000, { afterId });
  }

  async function heldAt(height, afterId) {
    await client.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_BLOCK && d.key === height, 120000, { afterId });
  }

  async function submittedApp(tag) {
    const spec = buildAppSpec({ name: `e2ereorg${tag}${Date.now()}` });
    const result = await registerApp(client.url, nodeKey(NODE + 1), spec);
    expect(result.status, JSON.stringify(result).slice(0, 300)).to.equal('success');
    const hash = result.data;
    await waitFor(async () => (await client.getTempMessages(hash)).data?.length > 0,
      { timeout: 30000, interval: 500, label: 'the temp message' });
    return { name: spec.name, hash };
  }

  // Mines a block paying the hash and the block after it, has the node process the first
  // behind the tip, and leaves the explorer stopped before the second.
  async function paidBehindTheTip(hash) {
    const paidAt = (await getState()).currentHeight + 1;
    const mark = client.getLastEventId();
    await client.holdCheckpoint(BEFORE_BLOCK, paidAt);
    await client.holdCheckpoint(BEFORE_BLOCK, paidAt + 1);
    await queueAppTx(hash);
    await advanceBlock();
    await advanceBlock();
    await heldAt(paidAt, mark);
    await client.releaseCheckpoint(BEFORE_BLOCK, paidAt);
    await heldAt(paidAt + 1, mark);
    return paidAt;
  }

  async function paidApp(tag) {
    const { name, hash } = await submittedApp(tag);
    await queueAppTx(hash);
    await advanceBlock();
    const { currentHeight: paidAt } = await getState();
    await advanceBlock();
    await waitFor(async () => Boolean(await db.globalAppSpec(name)),
      { timeout: 120000, interval: 1000, label: 'the registry row' });
    const { txid } = await db.appHashRecord(hash);
    return { name, hash, paidAt, txid };
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

  it('requests a message paid behind the tip when the explorer reaches the tip, with no further block', async function () {
    this.timeout(240000);
    const { name, hash } = await submittedApp('c');
    const paidAt = await paidBehindTheTip(hash);
    await client.releaseCheckpoint(BEFORE_BLOCK, paidAt + 1);

    await waitFor(async () => (await db.globalAppSpec(name))?.height === paidAt,
      { timeout: 60000, interval: 1000, label: 'the registry row' });
  });

  it('takes a payment behind the tip back out when a reorganisation replaces its block', async function () {
    this.timeout(240000);
    const { name, hash } = await submittedApp('d');
    const paidAt = await paidBehindTheTip(hash);
    const paid = await db.appHashRecord(hash);
    expect(paid?.height, 'the payment was not written by the block that found it').to.equal(paidAt);
    expect(paid.message, 'its block was processed at the tip').to.equal(false);

    const mark = client.getLastEventId();
    await setMempool([]);
    await forkChain(paidAt);
    await client.releaseCheckpoint(BEFORE_BLOCK, paidAt + 1);
    await client.waitForEvent('explorer:reorganised', (d) => d.forkFound === true, 120000, { afterId: mark });
    await client.waitForEvent('explorer:paymentsDropped', (d) => d.hashes.includes(hash), 120000, { afterId: mark });

    expect((await db.appHashRecord(hash)).notOnChain).to.equal(true);
    expect(await db.globalAppSpec(name), 'a replaced payment listed its app').to.equal(null);
  });

  it('unlists an app when a second reorganisation replaces the block that paid it again', async function () {
    this.timeout(300000);
    const { name, hash, paidAt, txid } = await paidApp('e');
    await replaceItsBlock(paidAt, txid);

    await setMempool([]);
    const minedAt = await paidBehindTheTip(hash);
    const mined = await db.appHashRecord(hash);
    expect(mined.height, 'the new payment did not overwrite the replaced record').to.equal(minedAt);
    expect(mined.replaced).to.equal(undefined);
    expect(mined.message, 'its block was processed at the tip').to.equal(false);

    const mark = client.getLastEventId();
    await forkChain(minedAt);
    await client.releaseCheckpoint(BEFORE_BLOCK, minedAt + 1);
    await client.waitForEvent('explorer:paymentsDropped', (d) => d.hashes.includes(hash), 120000, { afterId: mark });

    expect((await db.appHashRecord(hash)).notOnChain).to.equal(true);
    expect(await db.globalAppSpec(name), 'an unpaid app stayed listed').to.equal(null);
  });
});
