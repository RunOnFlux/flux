/*
 * A node that is running finds more than 500 app messages missing behind payments its scan
 * recorded, and its hash retry fetches them in bulk. It writes the registry row of each app
 * those messages belong to, and touches no other: the registry is built in full only on the
 * way to ready.
 *
 * The node boots holding two apps. The late log then reaches the peers, and the node's
 * payment records for it are written as its scan of the chain would have written them:
 * ten new apps with long update chains, and late updates to one of the two it already holds.
 * The other is untouched by the late log, so its row is only rewritten by a full rebuild,
 * which replaces every row of the registry.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForDaemonReady, waitForOrchestratorState, waitFor } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 4;
// the running node: held back until the apps it boots holding are in place
const SUBJECT = NODES - 1;
const LATE_APPS = 10;
const UPDATES = 54;
const LATE_UPDATES_TO_HELD = 5;

const unresolved = (entry) => ({ ...entry, message: false });

function step(what) {
  console.log(`# 3305 ${new Date().toISOString()} ${what}`);
}

describe('a running node applies late messages app by app', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();
  // the newest message of each app the late log brings, by name
  const governing = new Map();
  let untouched;
  let updated;
  let rowsBefore;
  let lateCount;
  let bulkFetched;
  const db = () => dbClient(SUBJECT + 1);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      deferredNodes: 1,
      // the retry that finds the late log comes within a few blocks
      configOverrides: { fluxapps: { hashSyncFallbackRecheckBlocks: 2 } },
    });
    await bootAndPeer(env);
    const base = env.initialHeight - 2000;

    // the two apps the node boots holding, its rows for them written by its own rebuild
    untouched = await buildSeedableApp({ env, name: `e2eHeld${stamp}`, height: base });
    updated = await buildSeedableApp({ env, name: `e2eHeldUp${stamp}`, height: base + 1 });
    const held = [untouched, updated];
    await Promise.all(Array.from({ length: NODES }, (_, i) => i).map(async (i) => {
      await dbClient(i + 1).seedPermanentMessages(held.map((m) => m.permanentMessage));
      await dbClient(i + 1).seedAppHashes(held.map((m) => m.hashEntry));
    }));
    const subject = await env.startNode(SUBJECT);
    await waitForDaemonReady(subject);
    await env.startDiscovery([SUBJECT]);
    await waitForOrchestratorState(subject, 'READY', 600000);
    await waitFor(async () => (await db().globalAppSpec(updated.permanentMessage.appSpecifications.name))?.hash === updated.hash
      && (await db().globalAppSpec(untouched.permanentMessage.appSpecifications.name))?.hash === untouched.hash, {
      timeout: 120000, interval: 2000, label: 'the node holds the two apps it booted with',
    });
    rowsBefore = {
      untouched: await db().globalAppSpec(untouched.permanentMessage.appSpecifications.name),
      updated: await db().globalAppSpec(updated.permanentMessage.appSpecifications.name),
    };

    // the late log
    const late = [];
    let current = updated;
    for (let j = 1; j <= LATE_UPDATES_TO_HELD; j += 1) {
      // eslint-disable-next-line no-await-in-loop
      current = await buildSeedableUpdate(current, (spec) => { spec.description = `held app revision ${j}`; }, { height: base + 2 + j });
      late.push(current);
    }
    governing.set(updated.permanentMessage.appSpecifications.name, current.hash);
    for (let k = 0; k < LATE_APPS; k += 1) {
      const name = `e2eLate${k}x${stamp}`;
      // eslint-disable-next-line no-await-in-loop
      current = await buildSeedableApp({ env, name, height: base + 100 + (k * 60) });
      late.push(current);
      for (let j = 1; j <= UPDATES; j += 1) {
        // eslint-disable-next-line no-await-in-loop
        current = await buildSeedableUpdate(current, (spec) => { spec.description = `${name} revision ${j}`; }, { height: base + 100 + (k * 60) + j });
        late.push(current);
      }
      governing.set(name, current.hash);
    }
    lateCount = late.length;
    expect(lateCount, 'enough messages late to take the bulk path').to.be.above(500);

    const anchor = subject.getLastEventId();
    step(`seeding ${lateCount} late messages`);
    await Promise.all(env.clients.map(async (client, i) => {
      if (!client || i === SUBJECT) return;
      await dbClient(i + 1).seedPermanentMessages(late.map((m) => m.permanentMessage));
      await dbClient(i + 1).seedAppHashes(late.map((m) => m.hashEntry));
    }));
    await db().seedAppHashes(late.map((m) => unresolved(m.hashEntry)));
    bulkFetched = await subject.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000, { afterId: anchor });
    step('fetched in bulk');
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('took the late messages in bulk while running', function () {
    expect(bulkFetched.data.processed, JSON.stringify(bulkFetched.data)).to.equal(lateCount);
  });

  it('holds every app the late log brings at its newest message', async function () {
    this.timeout(180000);
    const names = [...governing.keys()];
    await waitFor(async () => {
      const held = await Promise.all(names.map(async (name) => (await db().globalAppSpec(name))?.hash));
      return held.every((hash, i) => hash === governing.get(names[i]));
    }, { timeout: 150000, interval: 3000, label: 'every late app held at its newest message' });
  });

  it('brings an app it already held up to its late update, in the same row', async function () {
    const row = await db().globalAppSpec(updated.permanentMessage.appSpecifications.name);
    expect(row.hash).to.equal(governing.get(updated.permanentMessage.appSpecifications.name));
    expect(String(row._id), 'the row was replaced, so the registry was rebuilt').to.equal(String(rowsBefore.updated._id));
  });

  it('rewrites no row the late log does not touch', async function () {
    const row = await db().globalAppSpec(untouched.permanentMessage.appSpecifications.name);
    expect(row, 'the app the late log does not touch is gone').to.not.equal(null);
    expect(String(row._id), 'the row was replaced, so the registry was rebuilt').to.equal(String(rowsBefore.untouched._id));
  });
});
