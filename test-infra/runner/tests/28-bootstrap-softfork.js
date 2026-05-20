import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
  seedAddressDeltas, seedTransaction, clearSeededData,
} from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const MULTISIG_A = 't3aGJvdtd8NR6GrnqnRuVEzH6MbrXuJFLUX';

const PRICE_FORK_MSG = 'p1_100000_200000_0.5_300_20_0.01_1_0';
const PRICE_FORK_HEX = Buffer.from(PRICE_FORK_MSG).toString('hex');
const FORK_TXID = 'softfork-price-tx-000000000000000000000001';
const FORK_HEIGHT = 1594832;

describe('Bootstrap: soft fork pre-pass', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);

    // Seed daemon stub with foundation self-send deltas and the transaction
    await seedAddressDeltas([
      { txid: FORK_TXID, address: MULTISIG_A, satoshis: -500000, index: 0, height: FORK_HEIGHT },
      { txid: FORK_TXID, address: MULTISIG_A, satoshis: 500000, index: 1, height: FORK_HEIGHT },
    ]);
    await seedTransaction(FORK_TXID, {
      txid: FORK_TXID,
      version: 1,
      height: FORK_HEIGHT,
      vin: [{ address: MULTISIG_A }],
      vout: [
        { valueSat: 500000, scriptPubKey: { addresses: [MULTISIG_A], asm: '' } },
        { valueSat: 0, scriptPubKey: { addresses: [], asm: `OP_RETURN ${PRICE_FORK_HEX}` } },
      ],
    });

    env = await createTestEnv({ nodes: 3, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await waitForExplorerReady(env.clients[0]);
    await advanceBlock();
    await waitForBlockProcessed(env.clients[0], () => true, 20000);
    await startTicker();
    await advanceBlocks(10);
    await waitForBlockProcessed(env.clients[0], (d) => d.height > 2100005, 30000);
  });

  after(async function () {
    this.timeout(30000);
    await stopTicker().catch(() => {});
    await clearSeededData().catch(() => {});
    await env?.teardown();
  });

  it('should store the soft fork price message in chainparams', async function () {
    this.timeout(30000);
    const dc = dbClient(1);
    const count = await dc.chainMessageCount();
    expect(count).to.be.greaterThan(0);
  });

  it('should have the correct soft fork data', async function () {
    this.timeout(10000);
    const dc = dbClient(1);
    const messages = await dc.chainMessages();
    const priceFork = messages.find((m) => m.txid === FORK_TXID);
    expect(priceFork).to.not.be.undefined;
    expect(priceFork.height).to.equal(FORK_HEIGHT);
    expect(priceFork.message).to.equal(PRICE_FORK_MSG);
    expect(priceFork.version).to.equal('p1');
  });
});
