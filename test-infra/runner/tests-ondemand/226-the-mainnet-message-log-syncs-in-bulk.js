/*
 * A node that joins mainnet takes its whole app message log in bulk, and ends where its own
 * record of the chain puts it.
 *
 * The fixture is a mainnet node's export (E2E_MAINNET_FIXTURE, a directory holding
 * messages.json.gz, hashes.json.gz and registry.json.gz from mongoexport, and manifest.json):
 * every permanent app message it held, its payment record of every app message hash, and its
 * global app list. The peers serve the messages; the joiner holds only the payment records, as
 * its own scan of the chain would have left them, and fetches every message in bulk.
 *
 * The joiner must keep every message, each at its own record's txid, height and payment, and
 * hold every app whose newest message is still in its term at its scanned height.
 *
 * On demand, not in the gate: the fixture is ~45 MB compressed and lives outside the repo, and
 * a run streams about 72,000 messages through signature verification. Run with
 *   E2E_MAINNET_FIXTURE=<dir> E2E_SUITE_WALL_SEC=7200 \
 *     SUITE_GLOB='tests-ondemand/226-*.js' ./test-infra/runner/run-all.sh
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { BSON } from 'mongodb';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForDaemonReady, waitForOrchestratorState, waitFor } from '../framework/wait.js';
import { stopTicker } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const JOINER = 3;
const SEED_CHUNK = 5000;
// The chain's speed-up at the PON fork, as appMessageChain.appExpirationHeight counts it.
const PON_FORK = 2020000;
const BLOCKS_LASTING = 22000;

function readExport(dir, file) {
  return gunzipSync(readFileSync(join(dir, file))).toString().trim().split('\n').map((line) => {
    const doc = BSON.EJSON.parse(line, { relaxed: true });
    delete doc._id;
    return doc;
  });
}

function expirationHeight(height, expire) {
  const end = height + (expire || (height >= PON_FORK ? BLOCKS_LASTING * 4 : BLOCKS_LASTING));
  if (height < PON_FORK && end > PON_FORK) return PON_FORK + ((end - PON_FORK) * 4);
  return end;
}

async function seedInChunks(docs, seed) {
  for (let i = 0; i < docs.length; i += SEED_CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    await seed(docs.slice(i, i + SEED_CHUNK));
  }
}

describe('a node that joins mainnet takes its whole message log in bulk', function () {
  let env;
  dumpLogsOnFailure(() => env);

  let messages;
  let records;
  let sourceRegistry;
  const recordOf = new Map();
  let fetched;

  before(async function () {
    this.timeout(6600000);
    const dir = process.env.E2E_MAINNET_FIXTURE;
    if (!dir) throw new Error('E2E_MAINNET_FIXTURE names no fixture directory');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
    messages = readExport(dir, 'messages.json.gz');
    records = readExport(dir, 'hashes.json.gz');
    sourceRegistry = readExport(dir, 'registry.json.gz');
    expect(messages.length, 'messages in the fixture').to.equal(manifest.messages);
    expect(records.length, 'payment records in the fixture').to.equal(manifest.paymentRecords);
    for (const record of records) recordOf.set(record.hash, record);

    // The chain starts above every message in the log, so the joiner's scan has passed them all.
    env = await createTestEnv({
      hookCtx: this, nodes: 4, deferredNodes: 1, initialHeight: manifest.scannedHeight + 1,
    });
    await bootAndPeer(env);
    await stopTicker();

    const peerRecords = records.map((record) => ({ ...record, message: true, messageNotFound: false }));
    await Promise.all(env.clients.map(async (client, i) => {
      if (!client) return;
      const db = dbClient(i + 1);
      await seedInChunks(messages, (chunk) => db.seedPermanentMessages(chunk));
      await seedInChunks(peerRecords, (chunk) => db.seedAppHashes(chunk));
    }));
    const joinerRecords = records.map((record) => ({ ...record, message: false, messageNotFound: false }));
    await seedInChunks(joinerRecords, (chunk) => dbClient(JOINER + 1).seedAppHashes(chunk));

    const joiner = await env.startNode(JOINER);
    await waitForDaemonReady(joiner, 300000);
    await env.startDiscovery([JOINER]);
    fetched = await joiner.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 3600000);
    await waitForOrchestratorState(joiner, 'READY', 3600000);
  });

  after(async function () {
    this.timeout(120000);
    await env?.teardown();
  });

  it('takes the log in bulk from a peer', function () {
    expect(fetched.data.processed, JSON.stringify(fetched.data)).to.be.above(0);
  });

  it('keeps every message, each at its own record\'s txid, height and payment', async function () {
    this.timeout(600000);
    const kept = new Map((await dbClient(JOINER + 1).permanentMessages()).map((m) => [m.hash, m]));
    const missing = messages.filter((m) => !kept.has(m.hash));
    expect(missing.map((m) => `${m.hash} ${m.appSpecifications?.name} h${m.height}`).slice(0, 25),
      `${missing.length} of ${messages.length} messages not kept`).to.deep.equal([]);
    const misplaced = [];
    for (const message of messages) {
      const stored = kept.get(message.hash);
      const record = recordOf.get(message.hash);
      if (stored.txid !== record.txid || stored.height !== record.height || stored.valueSat !== record.value
        || stored.signature !== message.signature || stored.timestamp !== message.timestamp) {
        misplaced.push(`${message.hash} txid ${stored.txid} height ${stored.height} valueSat ${stored.valueSat}`);
      }
    }
    expect(misplaced.slice(0, 25), `${misplaced.length} messages not at their own record`).to.deep.equal([]);
  });

  it('holds every app whose newest message is in its term at its scanned height', async function () {
    this.timeout(900000);
    const db = dbClient(JOINER + 1);
    const scanned = await db.explorerHeight();
    const newest = new Map();
    for (const message of messages) {
      const record = recordOf.get(message.hash);
      const placed = { hash: message.hash, height: record.height, timestamp: message.timestamp, expire: message.appSpecifications.expire };
      const name = message.appSpecifications.name;
      const held = newest.get(name);
      if (!held || placed.height > held.height || (placed.height === held.height && placed.timestamp > held.timestamp)) {
        newest.set(name, placed);
      }
    }
    const expected = new Map([...newest].filter(([, m]) => expirationHeight(m.height, m.expire) > scanned).map(([name, m]) => [name, m.hash]));

    let held = new Map();
    await waitFor(async () => {
      const rows = await db.globalAppSpecs();
      held = new Map(rows.map((row) => [row.name, row.hash]));
      return held.size === expected.size;
    }, { timeout: 600000, interval: 10000, label: `the joiner's app list reaches ${expected.size} apps` });
    const wrong = [...expected].filter(([name, hash]) => held.get(name) !== hash).map(([name, hash]) => `${name}: ${held.get(name)} not ${hash}`);
    const extra = [...held.keys()].filter((name) => !expected.has(name));
    expect(wrong.slice(0, 25), `${wrong.length} apps at another message`).to.deep.equal([]);
    expect(extra.slice(0, 25), `${extra.length} apps held that are not in force`).to.deep.equal([]);

    const differsFromSource = sourceRegistry.filter((row) => expected.get(row.name) !== row.hash).map((row) => row.name);
    // eslint-disable-next-line no-console
    console.log(`# ${expected.size} apps in force at ${scanned}; the source node held ${sourceRegistry.length}, ${differsFromSource.length} of them at another message or none: ${differsFromSource.slice(0, 20).join(', ')}`);
  });
});
