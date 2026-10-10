import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { restartFluxos } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { queueAppTx } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { confirmTwoUpdatesInOneBlock } from '../framework/same-block-updates.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node's payment records carry each transaction's position in its block, as
// the explorer meets them. A node whose records carry none - records made
// before positions were recorded - gets them back from the daemon's address
// index when FluxOS starts, and holds the same spec as before. A record at a
// height its transaction is not at takes the chain's, and its stored message
// and the registry follow. A record the chain does not hold is no payment, and a
// block paying its hash records the payment in its place.

const NODES = 4;
const NODE = 0;

describe('payment positions a node never recorded are recovered from the chain at start', function () {
  let env;
  let outcome;
  let db;
  const name = `e2epaypos${Date.now()}`;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    outcome = await confirmTwoUpdatesInOneBlock(env, name);
    db = dbClient(NODE + 1);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('records each payment\'s position in its block as the explorer meets it', async () => {
    expect((await db.appHashRecord(outcome.standing.hash)).txIndex).to.equal(0);
    expect((await db.appHashRecord(outcome.superseded.hash)).txIndex).to.equal(1);
  });

  it('after losing those positions and restarting, has the positions back and holds the same spec', async function () {
    this.timeout(420000);
    await db.unsetTxIndex(outcome.standing.hash);
    await db.unsetTxIndex(outcome.superseded.hash);
    // The canary: the records really are without a position before the restart.
    expect((await db.appHashRecord(outcome.standing.hash)).txIndex).to.equal(undefined);
    expect((await db.appHashRecord(outcome.superseded.hash)).txIndex).to.equal(undefined);

    await restartFluxos(env.clients[NODE].container);
    await waitFor(async () => {
      const r = await env.clients[NODE].getAppSpecs(name).catch(() => null);
      return r?.status === 'success';
    }, { timeout: 360000, interval: 3000, label: 'the node answering the app again' });

    expect((await db.appHashRecord(outcome.standing.hash)).txIndex).to.equal(0);
    expect((await db.appHashRecord(outcome.superseded.hash)).txIndex).to.equal(1);
    expect((await db.appHashRecord(outcome.standing.hash)).notOnChain).to.equal(undefined);
    const r = await env.clients[NODE].getAppSpecs(name);
    expect(r.data.description).to.equal(outcome.standing.description);
  });

  it('after a record and its stored message move off the chain\'s height, restarting puts both back, and the registry follows', async function () {
    this.timeout(420000);
    const { hash } = outcome.standing;
    const chainHeight = (await db.appHashRecord(hash)).height;
    // a block the explorer left: above the transaction, below the tip, so the backfill places it
    const strayHeight = chainHeight + 1;
    await db.unsetTxIndex(hash);
    await db.setAppHashHeight(hash, strayHeight);
    await db.setPermanentMessageHeight(hash, strayHeight);
    // The canary: the record and the message really are at the stray height before the restart.
    expect((await db.appHashRecord(hash)).height).to.equal(strayHeight);
    expect((await db.permanentMessages({ hash }))[0].height).to.equal(strayHeight);

    await restartFluxos(env.clients[NODE].container);
    await waitFor(async () => {
      const spec = await env.clients[NODE].getAppSpecs(name).catch(() => null);
      return spec?.status === 'success';
    }, { timeout: 360000, interval: 3000, label: 'the node answering the app again' });

    expect((await db.appHashRecord(hash)).height).to.equal(chainHeight);
    expect((await db.permanentMessages({ hash }))[0].height).to.equal(chainHeight);
    const rows = await db.appSpecRows(name);
    expect(rows.map((row) => [row.hash, row.height])).to.deep.equal([[hash, chainHeight]]);
  });

  it('records a block\'s payment of a hash in place of a record the chain does not hold, and the message and registry follow it', async function () {
    this.timeout(300000);
    const { hash } = outcome.standing;
    const before = await db.appHashRecord(hash);
    await db.markNotOnChain(hash);
    // The canary: the record is marked before the block pays the hash.
    expect((await db.appHashRecord(hash)).notOnChain).to.equal(true);

    const { nextBlockHeight } = await queueAppTx(hash);
    await waitFor(async () => {
      const record = await db.appHashRecord(hash);
      return record.notOnChain === undefined && record.height >= nextBlockHeight;
    }, { timeout: 180000, interval: 2000, label: 'the block\'s payment recorded in place of the marked record' });

    const record = await db.appHashRecord(hash);
    expect(record.txid).to.not.equal(before.txid);
    await waitFor(async () => (await db.permanentMessages({ hash }))[0].height === record.height,
      { timeout: 120000, interval: 2000, label: 'the stored message at the new payment\'s height' });
    await waitFor(async () => {
      const rows = await db.appSpecRows(name);
      return rows.length === 1 && rows[0].hash === hash && rows[0].height === record.height;
    }, { timeout: 120000, interval: 2000, label: 'the registry at the new payment\'s height' });
  });
});
