/*
 * A node that joins with more than 500 app messages to fetch takes them in bulk from a peer,
 * and keeps exactly the valid ones, each where its own scan of the chain placed it.
 *
 * The message log is written straight into the peers' databases, and the joiner's payment
 * records into its own: they are what its scan of the chain would have found. Eleven apps carry
 * 556 messages between them - registrations, long update chains and an owner transfer - and the
 * peers serve some of them wrong:
 * - an older update claims a block above its app's newest, with another txid and payment;
 * - an update's contents no longer hash to its hash;
 * - an update carries a signature that is not its owner's;
 * - after the transfer, the former owner signs an update.
 * Every peer serves the same log, so whichever the joiner streams from, it is lied to.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, userKey } from '../framework/keys.js';
import { signBtcMessage } from '../auth.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForDaemonReady, waitForOrchestratorState, waitFor } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const APPS = 10;
const UPDATES = 54;
// The joiner: the last index, held back until the log is in place.
const JOINER = 4;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const unresolved = (entry) => ({ ...entry, message: false });

describe('a node that joins takes the gap in bulk and keeps only valid messages', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const stamp = Date.now();
  // every message on chain, as the joiner's payment records place it
  const onChain = [];
  // what the peers serve, by hash
  const served = new Map();
  // the hashes the joiner must refuse
  const refused = new Set();
  // the newest valid message of each app
  const governing = new Map();
  let lie;
  let bulkFetched;

  const record = (message) => {
    onChain.push(message);
    served.set(message.hash, message.permanentMessage);
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, deferredNodes: 1 });
    await bootAndPeer(env);

    const base = env.initialHeight - 2000;
    const owner = appOwnerKey();
    const newOwner = userKey();

    for (let k = 0; k < APPS; k += 1) {
      const name = `e2eBulk${k}x${stamp}`;
      // eslint-disable-next-line no-await-in-loop
      let current = await buildSeedableApp({ env, name, height: base + (k * 60) });
      record(current);
      const chain = [current];
      for (let j = 1; j <= UPDATES; j += 1) {
        // eslint-disable-next-line no-await-in-loop
        current = await buildSeedableUpdate(current, (spec) => { spec.description = `${name} revision ${j}`; }, { height: base + (k * 60) + j });
        record(current);
        chain.push(current);
      }
      governing.set(name, current.hash);

      if (k === 0) {
        // Signed by nobody who owns it: newest on chain, so it would govern the app if kept.
        const forged = await buildSeedableUpdate(current, (spec) => { spec.description = `${name} forged`; }, { height: base + (k * 60) + UPDATES + 1 });
        const { type, version, timestamp } = forged.permanentMessage;
        const spec = forged.permanentMessage.appSpecifications;
        const signature = await signBtcMessage(`not this message ${timestamp}`, owner.privkey);
        const hash = sha256(type + version + JSON.stringify(spec) + timestamp + signature);
        const badSignature = {
          ...forged,
          hash,
          permanentMessage: { ...forged.permanentMessage, signature, hash },
          hashEntry: { ...forged.hashEntry, hash },
        };
        record(badSignature);
        refused.add(hash);
      }
      if (k === 1) {
        // Mid-chain, and its contents changed in transit: they no longer hash to its hash.
        const victim = chain[20];
        const tampered = JSON.parse(JSON.stringify(victim.permanentMessage));
        tampered.appSpecifications.description = `${name} altered in transit`;
        served.set(victim.hash, tampered);
        refused.add(victim.hash);
      }
      if (k === 2) {
        // An old update the peers place above the app's newest, with another txid and payment.
        lie = { name, honest: chain[10], newest: current };
        served.set(lie.honest.hash, {
          ...lie.honest.permanentMessage,
          height: current.hashEntry.height + 1,
          txid: 'f'.repeat(64),
          valueSat: 1,
        });
      }
    }

    // Transferred to a new owner; then the former owner signs an update, then the new owner does.
    const transferName = `e2eBulkT${stamp}`;
    const transferBase = base + (APPS * 60);
    const registration = await buildSeedableApp({ env, name: transferName, height: transferBase });
    record(registration);
    const transfer = await buildSeedableUpdate(registration, (spec) => { spec.owner = newOwner.zelid; }, { height: transferBase + 1 });
    record(transfer);
    const formerOwners = await buildSeedableUpdate(transfer, (spec) => { spec.description = `${transferName} by its former owner`; }, { height: transferBase + 2, signer: owner });
    record(formerOwners);
    refused.add(formerOwners.hash);
    const newOwners = await buildSeedableUpdate(transfer, (spec) => { spec.description = `${transferName} by its new owner`; }, { height: transferBase + 3, signer: newOwner });
    record(newOwners);
    governing.set(transferName, newOwners.hash);

    expect(onChain.length, 'enough messages missing to take the bulk path').to.be.above(500);

    // The peers hold the log as they serve it; the joiner holds only the chain's payments.
    const servedLog = [...served.values()];
    const peerEntries = onChain.map((m) => m.hashEntry);
    await Promise.all(env.clients.map(async (client, i) => {
      if (!client) return;
      await dbClient(i + 1).seedPermanentMessages(servedLog);
      await dbClient(i + 1).seedAppHashes(peerEntries);
    }));
    await dbClient(JOINER + 1).seedAppHashes(onChain.map((m) => unresolved(m.hashEntry)));

    const joiner = await env.startNode(JOINER);
    await waitForDaemonReady(joiner);
    await env.startDiscovery([JOINER]);
    bulkFetched = await joiner.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000);
    await waitForOrchestratorState(joiner, 'READY', 600000);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('takes the gap in bulk from a peer', function () {
    const valid = onChain.length - refused.size;
    expect(bulkFetched.data.processed, JSON.stringify(bulkFetched.data)).to.equal(valid);
  });

  it('keeps every valid message, each at the txid, height and payment its own scan recorded', async function () {
    const kept = new Map((await dbClient(JOINER + 1).permanentMessages()).map((m) => [m.hash, m]));
    const expected = onChain.filter((m) => !refused.has(m.hash));
    expect(kept.size, 'messages kept').to.equal(expected.length);
    for (const message of expected) {
      const stored = kept.get(message.hash);
      expect(stored, `${message.hash} kept`).to.exist;
      expect(stored.txid, `${message.hash} txid`).to.equal(message.hashEntry.txid);
      expect(stored.height, `${message.hash} height`).to.equal(message.hashEntry.height);
      expect(stored.valueSat, `${message.hash} payment`).to.equal(message.hashEntry.value);
      expect(stored.signature, `${message.hash} signature`).to.equal(message.permanentMessage.signature);
      expect(stored.appSpecifications.description, `${message.hash} contents`).to.equal(message.permanentMessage.appSpecifications.description);
    }
  });

  it('refuses a message that does not hash to itself, a forged signature and a former owner\'s update', async function () {
    const kept = new Set((await dbClient(JOINER + 1).permanentMessages()).map((m) => m.hash));
    for (const hash of refused) expect(kept.has(hash), `${hash} refused`).to.equal(false);
    const records = await dbClient(JOINER + 1).appHashRecords({ hash: { $in: [...refused] } });
    expect(records.filter((r) => r.message === true), 'no refused hash marked resolved').to.deep.equal([]);
  });

  it('holds the newest valid message of every app, by its own record of the chain', async function () {
    this.timeout(120000);
    const db = dbClient(JOINER + 1);
    await waitFor(async () => {
      const held = await Promise.all([...governing.keys()].map(async (name) => (await db.globalAppSpec(name))?.hash));
      return held.every((hash, i) => hash === [...governing.values()][i]);
    }, { timeout: 90000, interval: 3000, label: 'every app held at its newest valid message' });
    expect((await db.globalAppSpec(lie.name)).hash, 'the app the peers misplaced').to.equal(lie.newest.hash);
  });
});
