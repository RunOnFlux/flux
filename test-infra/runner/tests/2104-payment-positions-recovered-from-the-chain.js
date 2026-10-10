import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { restartFluxos } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { confirmTwoUpdatesInOneBlock } from '../framework/same-block-updates.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node's payment records carry each transaction's position in its block, as
// the explorer meets them. A node whose records carry none - records made
// before positions were recorded - gets them back from the daemon's address
// index when FluxOS starts, and holds the same spec as before. A record at a
// height its transaction is not at takes the chain's, and its stored message
// and the registry follow.

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
});
