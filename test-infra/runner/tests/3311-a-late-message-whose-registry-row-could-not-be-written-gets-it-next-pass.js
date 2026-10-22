/*
 * A running node fetches in bulk the app messages missing behind its payment records,
 * stores them, and then writes the registry row of each app they belong to before it
 * marks their hashes found. Here the database refuses the first of those row writes:
 * the messages are stored, the rows are not, and the hashes stay unmarked.
 *
 * A hash whose message the node already stores waits on no peer, so the retry ladder
 * that spaces out asking peers does not apply to it: the next pass writes the rows from
 * the stored copies. The node must hold every app at its newest message within a few
 * passes, and must never have backed off one of those hashes.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForDaemonReady, waitForOrchestratorState, waitFor } from '../framework/wait.js';
import { failCommands } from '../framework/mongo-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 4;
// the running node: held back until the fleet is up
const SUBJECT = NODES - 1;
const LATE_APPS = 10;
const UPDATES = 54;

const unresolved = (entry) => ({ ...entry, message: false });

function step(what) {
  console.log(`# 3311 ${new Date().toISOString()} ${what}`);
}

describe('a late message whose registry row could not be written gets it on the next pass', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();
  // the newest message of each app the late log brings, by name
  const governing = new Map();
  let lateHashes;
  let release;
  let failedWrites;
  let bulkFetched;
  const db = () => dbClient(SUBJECT + 1);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      deferredNodes: 1,
      // a pass comes every few blocks
      configOverrides: { fluxapps: { hashSyncFallbackRecheckBlocks: 2 } },
    });
    await bootAndPeer(env);
    const base = env.initialHeight - 2000;

    const subject = await env.startNode(SUBJECT);
    await waitForDaemonReady(subject);
    await env.startDiscovery([SUBJECT]);
    await waitForOrchestratorState(subject, 'READY', 600000);

    // the late log: enough messages to take the bulk path
    const late = [];
    for (let k = 0; k < LATE_APPS; k += 1) {
      const name = `e2eRowLate${k}x${stamp}`;
      // eslint-disable-next-line no-await-in-loop
      let current = await buildSeedableApp({ env, name, height: base + 100 + (k * 60) });
      late.push(current);
      for (let j = 1; j <= UPDATES; j += 1) {
        // eslint-disable-next-line no-await-in-loop
        current = await buildSeedableUpdate(current, (spec) => { spec.description = `${name} revision ${j}`; }, { height: base + 100 + (k * 60) + j });
        late.push(current);
      }
      governing.set(name, current.hash);
    }
    expect(late.length, 'enough messages late to take the bulk path').to.be.above(500);
    lateHashes = late.map((m) => m.hashEntry.hash);

    const anchor = subject.getLastEventId();
    step(`seeding ${late.length} late messages, the subject's first registry row write refused`);
    release = await failCommands(SUBJECT + 1, 'globalzelapps', 'zelappsinformation', { commands: ['update'], times: 1 });
    await Promise.all(env.clients.map(async (client, i) => {
      if (!client || i === SUBJECT) return;
      await dbClient(i + 1).seedPermanentMessages(late.map((m) => m.permanentMessage));
      await dbClient(i + 1).seedAppHashes(late.map((m) => m.hashEntry));
    }));
    await db().seedAppHashes(late.map((m) => unresolved(m.hashEntry)));
    bulkFetched = await subject.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000, { afterId: anchor })
      .catch(() => null);
    step('fetched in bulk');
  });

  after(async function () {
    this.timeout(60000);
    await release?.().catch(() => {});
    await env?.teardown();
  });

  it('took the late messages in bulk', function () {
    expect(bulkFetched, 'the node never fetched the late messages in bulk, so nothing below was tested').to.not.equal(null);
  });

  it('had a registry row write refused by the database', async function () {
    failedWrites = await release();
    release = null;
    expect(failedWrites, 'the database refused none of the node\'s registry writes, so nothing below was tested').to.equal(1);
  });

  it('holds every late app at its newest message within a few passes', async function () {
    this.timeout(180000);
    const names = [...governing.keys()];
    await waitFor(async () => {
      const held = await Promise.all(names.map(async (name) => (await db().globalAppSpec(name))?.hash));
      return held.every((hash, i) => hash === governing.get(names[i]));
    }, { timeout: 150000, interval: 3000, label: 'every late app held at its newest message' });
  });

  it('never backed off a hash whose message it already stored', async function () {
    const records = await db().appHashRecords({ hash: { $in: lateHashes } });
    const backedOff = records.filter((r) => (r.syncAttempts ?? 0) > 0).map((r) => r.hash);
    expect(records.length, 'the node holds no record of the late hashes').to.equal(lateHashes.length);
    expect(backedOff, 'a hash whose message the node stored was backed off as if no peer had it').to.deep.equal([]);
  });
});
