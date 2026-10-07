/*
 * A message paid more than once in one block is recorded with its first payment, on every node.
 *
 * One block pays a registration twice: its price first, then the minimum the scan records. Every
 * node records the first payment and registers the app. In the same block a second app is paid
 * only that minimum: every node records the payment and stores the message, and refuses the app
 * as underpaid - so a record of the second payment would have refused the first app too.
 *
 * The chain moves only when this suite mines a block: the ticker is stopped after boot.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { getState, mineBlock, stopTicker } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Five dialers, 2 peers each way, the floor a submission needs.
const SUBMITTER = 2;
// The app payment address in force at the harness chain's height (addressMultisigB).
const APP_PAYMENT_ADDRESS = 't3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX';
const PRICE_SAT = 200000000;
// The scan's minPrice (0.01 FLUX) at the harness chain's height.
const MIN_PRICE_SAT = 1000000;

const payment = (txid, hash, valueSat) => ({
  txid,
  version: 1,
  vin: [{ txid: 'prev-tx-stub', vout: 0, address: 'stub-sender-address' }],
  vout: [
    { valueSat, scriptPubKey: { addresses: [APP_PAYMENT_ADDRESS], asm: '' } },
    { valueSat: 0, scriptPubKey: { addresses: [], asm: `OP_RETURN ${Buffer.from(hash, 'utf-8').toString('hex')}` } },
  ],
});

describe('a message paid twice in one block keeps its first payment, on every node', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const stamp = Date.now();
  // Sized so its price (0.05 FLUX) is above the minimum: the default app costs exactly that.
  const sized = (name) => {
    const spec = buildAppSpec({ name, instances: 1 });
    spec.compose = spec.compose.map((component) => ({
      ...component, cpu: 1, ram: 2000, hdd: 20,
    }));
    return spec;
  };
  const paidSpec = sized(`e2ePaidTwice${stamp}`);
  const cheapSpec = sized(`e2ePaidMinimum${stamp}`);
  const txids = {
    price: `pay-price-${stamp}`,
    minimum: `pay-minimum-${stamp}`,
    cheapOnly: `pay-cheap-only-${stamp}`,
  };
  let live;
  let liveIndices;
  let paidHash;
  let cheapHash;

  const allAtTip = async () => {
    const { currentHeight } = await getState();
    const heights = await Promise.all(liveIndices.map((i) => dbClient(i + 1).explorerHeight()));
    return heights.every((h) => h >= currentHeight);
  };
  const onEveryNode = (read) => Promise.all(liveIndices.map((i) => read(dbClient(i + 1))));
  const relayedEverywhere = async (hash) => {
    const held = await Promise.all(live.map(async (node) => (await node.getTempMessages(hash)).data?.length > 0));
    return held.every(Boolean);
  };
  const submit = async (spec) => {
    const result = await registerApp(env.clients[SUBMITTER].url, nodeKey(1), spec);
    expect(result.status, `registration of ${spec.name}: ${JSON.stringify(result.data)}`).to.equal('success');
    await waitFor(() => relayedEverywhere(result.data), { timeout: 30000, interval: 2000, label: `${spec.name} relayed to every node` });
    return result.data;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootAndPeer(env);
    await stopTicker();
    live = env.clients.filter(Boolean);
    liveIndices = env.clients.map((c, i) => (c ? i : null)).filter((i) => i !== null);

    paidHash = await submit(paidSpec);
    cheapHash = await submit(cheapSpec);
    await waitFor(allAtTip, { timeout: 150000, interval: 1000, label: 'every node at the tip before the payments' });
    await mineBlock([
      payment(txids.price, paidHash, PRICE_SAT),
      payment(txids.minimum, paidHash, MIN_PRICE_SAT),
      payment(txids.cheapOnly, cheapHash, MIN_PRICE_SAT),
    ]);
    await waitFor(allAtTip, { timeout: 150000, interval: 1000, label: 'every node processes the payment block' });
    await waitFor(
      async () => (await onEveryNode((db) => db.permanentMessages({ hash: { $in: [paidHash, cheapHash] } }))).every((held) => held.length === 2),
      { timeout: 120000, interval: 2000, label: 'both messages stored on every node' },
    );
  });

  after(async function () {
    this.timeout(120000);
    if (env) await env.teardown();
  });

  it('records the twice-paid message with its first payment', async () => {
    const records = await onEveryNode((db) => db.appHashRecords({ hash: paidHash }));
    records.forEach((held, i) => {
      expect(held.map((r) => [r.txid, r.value]), `node ${liveIndices[i]}`).to.deep.equal([[txids.price, PRICE_SAT]]);
    });
  });

  it('records the minimum payment, and refuses the app paid only that', async () => {
    const records = await onEveryNode((db) => db.appHashRecords({ hash: cheapHash }));
    records.forEach((held, i) => {
      expect(held.map((r) => [r.txid, r.value]), `node ${liveIndices[i]}`).to.deep.equal([[txids.cheapOnly, MIN_PRICE_SAT]]);
    });
    const specs = await onEveryNode((db) => db.globalAppSpec(cheapSpec.name));
    specs.forEach((spec, i) => expect(spec, `node ${liveIndices[i]}`).to.equal(null));
  });

  it('registers the twice-paid app on every node', async () => {
    await waitFor(
      async () => (await onEveryNode((db) => db.globalAppSpec(paidSpec.name))).every((spec) => spec?.hash === paidHash),
      { timeout: 60000, interval: 2000, label: `${paidSpec.name} registered on every node` },
    );
  });
});
