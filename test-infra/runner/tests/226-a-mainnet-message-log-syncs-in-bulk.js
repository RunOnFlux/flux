/*
 * A node that joins takes a slice of the mainnet app message log in bulk, and ends where its
 * own record of the chain puts it.
 *
 * The fixture (test-infra/fixtures/mainnet-message-slice) is every permanent message of 198
 * mainnet apps, 1,050 messages, and a mainnet node's payment record of each. Its manifest names
 * the apps chosen for each case: every message type and spec version, enterprise apps, owner
 * transfers either side of block 2,000,000, same-block messages, renewals after expiry, names
 * re-registered by their owner and by another, hashes paid twice in one block, expiries that
 * cross the PON fork, and apps in force and expired at the scanned height.
 *
 * The peers serve the messages; the joiner holds the payment records, as its own scan of the
 * chain would have left them, and one message, stored at a block its payment is not in. It must
 * keep every message, each at its own record's txid, height and payment, and hold every app whose
 * newest message is still in its term, at that message's height.
 *
 * The joiner is not an Arcane node. An Arcane node checks a subscription extension signed by a
 * usersToExtend address on an enterprise app by decrypting the spec, which needs keys no harness
 * node holds; a node that is not Arcane accepts it without the comparison, as the slice's
 * buckyorbit renewal shows.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForDaemonReady, waitForOrchestratorState, waitFor } from '../framework/wait.js';
import { setSystemSecure, stopTicker } from '../framework/daemon-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'mainnet-message-slice');
const JOINER = 3;
// The chain's speed-up at the PON fork, as appMessageChain.appExpirationHeight counts it.
const PON_FORK = 2020000;
const BLOCKS_LASTING = 22000;

const readLines = (file) => gunzipSync(readFileSync(join(FIXTURE, file))).toString().trim().split('\n').map((line) => JSON.parse(line));

function expirationHeight(height, expire) {
  const end = height + (expire || (height >= PON_FORK ? BLOCKS_LASTING * 4 : BLOCKS_LASTING));
  if (height < PON_FORK && end > PON_FORK) return PON_FORK + ((end - PON_FORK) * 4);
  return end;
}

describe('a node that joins takes a slice of the mainnet message log in bulk', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const manifest = JSON.parse(readFileSync(join(FIXTURE, 'manifest.json'), 'utf-8'));
  const messages = readLines('messages.json.gz');
  const records = readLines('hashes.json.gz');
  const recordOf = new Map(records.map((record) => [record.hash, record]));
  // The newest message of each app, at its record's height.
  const newest = new Map();
  for (const message of messages) {
    const placed = {
      hash: message.hash,
      height: recordOf.get(message.hash).height,
      timestamp: message.timestamp,
      expire: message.appSpecifications.expire,
    };
    const { name } = message.appSpecifications;
    const held = newest.get(name);
    if (!held || placed.height > held.height || (placed.height === held.height && placed.timestamp > held.timestamp)) {
      newest.set(name, placed);
    }
  }
  // The message the joiner holds before it joins: the newest of an app in its term, stored a block
  // above its payment, as a record written from a block that later left the chain placed it.
  const [strayName, strayPlaced] = [...newest]
    .find(([, m]) => expirationHeight(m.height, m.expire) > manifest.scannedHeight + 1000);
  const strayMessage = messages.find((m) => m.hash === strayPlaced.hash);
  let fetched;

  before(async function () {
    this.timeout(1200000);
    // The chain starts above every message in the slice, so the joiner's scan has passed them all.
    env = await createTestEnv({
      hookCtx: this, nodes: 4, deferredNodes: 1, initialHeight: manifest.scannedHeight + 1,
    });
    await bootAndPeer(env);
    await stopTicker();

    await Promise.all(env.clients.map(async (client, i) => {
      if (!client) return;
      await dbClient(i + 1).seedPermanentMessages(messages);
      await dbClient(i + 1).seedAppHashes(records.map((record) => ({ ...record, message: true, messageNotFound: false })));
    }));
    await dbClient(JOINER + 1).seedAppHashes(records.map((record) => ({ ...record, message: false, messageNotFound: false })));
    await dbClient(JOINER + 1).seedPermanentMessage({ ...strayMessage, height: strayPlaced.height + 1 });
    await setSystemSecure(getSubnetConfig().nodeIp(JOINER + 1), false);

    const joiner = await env.startNode(JOINER);
    await waitForDaemonReady(joiner);
    await env.startDiscovery([JOINER]);
    fetched = await joiner.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000);
    await waitForOrchestratorState(joiner, 'READY', 600000);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('covers every message type and spec version', function () {
    expect(new Set(messages.map((m) => m.type))).to.have.all.keys('zelappregister', 'zelappupdate', 'fluxappregister', 'fluxappupdate');
    expect([...new Set(messages.map((m) => m.appSpecifications.version))].sort()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(messages.length, 'enough messages for the bulk path').to.be.above(500);
  });

  it('takes the slice in bulk from a peer, but for the message it held', function () {
    expect(fetched.data.processed, JSON.stringify(fetched.data)).to.equal(messages.length - 1);
  });

  it('keeps every message, each at its own record\'s txid, height and payment', async function () {
    const kept = new Map((await dbClient(JOINER + 1).permanentMessages()).map((m) => [m.hash, m]));
    const missing = messages.filter((m) => !kept.has(m.hash)).map((m) => `${m.hash} ${m.type} v${m.appSpecifications.version} ${m.appSpecifications.name}`);
    expect(missing, `${missing.length} of ${messages.length} messages not kept`).to.deep.equal([]);
    const misplaced = messages.filter((message) => {
      const stored = kept.get(message.hash);
      const record = recordOf.get(message.hash);
      return stored.txid !== record.txid || stored.height !== record.height || stored.valueSat !== record.value
        || stored.signature !== message.signature || stored.timestamp !== message.timestamp;
    }).map((m) => m.hash);
    expect(misplaced, `${misplaced.length} messages not at their own record`).to.deep.equal([]);
  });

  it('holds every app whose newest message is in its term at its scanned height', async function () {
    this.timeout(300000);
    const db = dbClient(JOINER + 1);
    const scanned = await db.explorerHeight();
    const expected = new Map([...newest].filter(([, m]) => expirationHeight(m.height, m.expire) > scanned));
    // the app of the message the joiner held is one of them
    expect(expected.has(strayName)).to.equal(true);

    let held = new Map();
    await waitFor(async () => {
      held = new Map((await db.globalAppSpecs()).map((row) => [row.name, row]));
      return held.size === expected.size;
    }, { timeout: 180000, interval: 5000, label: `the joiner holds ${expected.size} apps` });
    const wrong = [...expected]
      .filter(([name, m]) => held.get(name)?.hash !== m.hash || held.get(name)?.height !== m.height)
      .map(([name, m]) => `${name}: ${held.get(name)?.hash}@${held.get(name)?.height} not ${m.hash}@${m.height}`);
    expect(wrong.length, `${wrong.length} apps at another message or height: ${wrong.join('; ')}`).to.equal(0);
  });
});
