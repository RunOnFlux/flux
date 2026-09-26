import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';
import {
  apprunningEvent, sigtermEvent, appRemovedEvent, evictedEvent, socketAddr,
} from '../framework/state-events.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import {
  waitFor, waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed, waitForOrchestratorState,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A sync response is carried through in slices, so a response has to be longer
// than one slice for these to mean anything.
const SLICE = 250;
const FILLER_EVENTS = 320;

async function bootAndPeer(env, nodeIndices) {
  const clients = nodeIndices.map((i) => env.clients[i]).filter(Boolean);
  for (const client of clients) await waitForDaemonReady(client);
  await Promise.all(clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of clients) {
    await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
  }
  await env.startDiscovery(nodeIndices);
  await clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
  await startTicker();
}

describe('Sync response: eviction, pruning and forged events', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const EVICTED_NODE = 9;
  const PRUNE_NODE = 8;
  const FORGERY_NODE = 7;
  // A sync replays every unexpired event, so an event about a node routinely
  // arrives after that node's newer running report. Each of these nodes reports
  // itself running an app, and the response also carries an OLDER event about
  // it: a shutdown, a removal of that app, an eviction. Each event speaks only
  // for what the node broadcast before it.
  const SIGTERM_NODE = 6;
  const REMOVED_NODE = 5;
  const RETURNED_NODE = 4;
  const RUNNING_AT = FILLER_EVENTS + 400;
  const EARLIER_AT = FILLER_EVENTS + 350;
  // Stamped when the events are INJECTED, not when mocha loads this file.
  //
  // These are broadcasts, and a broadcast has an acceptance window:
  // messageStore computes validTill = broadcastedAt + RUNNING_EXPIRY_MS
  // (config.fluxapps.locationTtlS) and writes the location row with that same
  // expireAt. At describe-body scope this was evaluated before the hook ran,
  // before a twelve-node fleet booted, and under the parallel gate before the
  // run had even claimed its subnet - minutes of it. Every event then arrived
  // stamped in the past and its row was born expired, which reads as an empty
  // location list rather than as a rejected message.
  //
  // It passed for as long as it did because locationTtlS was wired to nothing:
  // the window was the production 125 minutes, wide enough to swallow any boot.
  // Live at 63s it is 2.1 announce intervals, matching production's 2.08, and a
  // broadcast stamped before the fleet existed is one production would refuse
  // too.
  let stamp;

  before(async function () {
    this.timeout(600000);
    const RUNNING = Array.from({ length: 10 }, (_, i) => i);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 12,
      deferredNodes: 2,
      tickerAutostart: false,
      // AN ESTABLISHED FLEET, which is what the joiner below is joining. These
      // ten hold the seeded events and are the only thing that can hand them
      // over, so they have to be able to answer a state sync: a node whose own
      // sync has not finished declines one, and a fleet that boots together has
      // no node whose sync has finished. Without this the joiner is declined by
      // all ten and reaches READY on the block timer instead - with an empty
      // store, so the three assertions below would read a database that never
      // received the response they are about.
      syncedNodes: RUNNING,
    });
    await bootAndPeer(env, RUNNING);

    // THE READER BOOTS BEFORE THE WINDOW OPENS, AND CANNOT SYNC WHILE IT DOES.
    //
    // Everything below is a broadcast, and messageStore refuses one older than
    // locationTtlS - 63s here. Booting the reader after seeding put a node boot
    // inside that window: 24.6s of it on an idle box, ~83s under a six-way gate,
    // so the events expired during their own setup, were skipped in silence, and
    // the suite read an empty location list rather than a rejected message.
    //
    // No number fixes that, because the boot's cost is whatever the box is doing.
    // So the boot moves OUT of the window instead. The reader is refused by the
    // running nodes before it starts, boots deaf for as long as it needs, and the
    // window opens only once it is up - spanning a sync, which is seconds, rather
    // than a boot, which is unbounded. A sync is only seconds against peers that
    // can answer one, which is what syncedNodes above is for.
    await env.holdOutPendingNode(10, RUNNING);
    const joiner = await env.startNode(10);
    await waitForDaemonReady(joiner);
    await waitForNodeStatus(joiner, (d) => d.confirmed === true, 30000);

    stamp = Date.now();

    const events = [];

    // Filler, so the response spans several slices. These sit between the
    // eviction at the front and the events that matter at the back.
    for (let i = 0; i < FILLER_EVENTS; i++) {
      // eslint-disable-next-line no-await-in-loop
      events.push(await apprunningEvent({
        nodeNum: 1,
        apps: [`filler${i}`],
        broadcastedAt: stamp + i,
        dedupKey: `filler:${i}`,
      }));
    }

    // The node reports itself running an app, and is evicted after that report.
    // The eviction sits in the first slice and the report in a later one; the
    // eviction must still be the outcome.
    events.push(evictedEvent({ nodeNum: EVICTED_NODE, createdAt: stamp + FILLER_EVENTS + 150 }));
    events.push(await apprunningEvent({
      nodeNum: EVICTED_NODE,
      apps: ['evictedapp'],
      broadcastedAt: stamp + FILLER_EVENTS + 100,
    }));

    // Two broadcasts from one node: the newer drops an app, which must be
    // pruned even though the older broadcast is in an earlier slice.
    events.push(await apprunningEvent({
      nodeNum: PRUNE_NODE,
      apps: ['keptapp', 'droppedapp'],
      broadcastedAt: stamp + 1,
      dedupKey: 'v2-older',
    }));
    events.push(await apprunningEvent({
      nodeNum: PRUNE_NODE,
      apps: ['keptapp'],
      broadcastedAt: stamp + FILLER_EVENTS + 200,
    }));

    // A genuine broadcast, then a forged one carrying a newer timestamp and a
    // shorter app list. Pruning must ignore it entirely.
    events.push(await apprunningEvent({
      nodeNum: FORGERY_NODE,
      apps: ['realapp', 'targetapp'],
      broadcastedAt: stamp + 2,
      dedupKey: 'v2-real',
    }));
    events.push(await apprunningEvent({
      nodeNum: FORGERY_NODE,
      apps: ['realapp'],
      broadcastedAt: stamp + FILLER_EVENTS + 300,
      dedupKey: 'v2-forged',
      signedBy: FORGERY_NODE === 1 ? 2 : 1,
    }));

    // A report of each node running, and an older event about it, placed in
    // the response the way a replay places them.
    events.push(await sigtermEvent({ nodeNum: SIGTERM_NODE, broadcastedAt: stamp + EARLIER_AT }));
    events.push(await apprunningEvent({
      nodeNum: SIGTERM_NODE, apps: ['stillrunningapp'], broadcastedAt: stamp + RUNNING_AT,
    }));
    events.push(await appRemovedEvent({
      nodeNum: REMOVED_NODE, appName: 'reinstalledapp', broadcastedAt: stamp + EARLIER_AT,
    }));
    events.push(await apprunningEvent({
      nodeNum: REMOVED_NODE, apps: ['reinstalledapp'], broadcastedAt: stamp + RUNNING_AT,
    }));
    events.push(evictedEvent({ nodeNum: RETURNED_NODE, createdAt: stamp + EARLIER_AT }));
    events.push(await apprunningEvent({
      nodeNum: RETURNED_NODE, apps: ['returnedapp'], broadcastedAt: stamp + RUNNING_AT,
    }));

    // Seeded in ONE round trip per node, not one per event.
    //
    // These are broadcasts and their acceptance window is live: messageStore
    // refuses one older than locationTtlS, 63s here. Ten nodes times 326 events
    // is 3,260 sequential insertOne round trips, which on a gate box outlives
    // that window - every event then arrives already expired, is skipped without
    // a word, and the suite reads an empty location list rather than a rejected
    // message. The `stamp` comment above moved the clock's start into the hook;
    // this keeps the hook short enough for that start to still mean something.
    await Promise.all(Array.from({ length: 10 }, (_unused, n) => dbClient(n + 1).seedAppStateEvents(
      // A copy per node: insertMany stamps _id onto the objects it is given, so
      // one shared array would carry node 1's ids into every other node's insert.
      events.map((event) => ({ ...event })),
    )));

    // Seeded, so let it in. It has never spoken to a peer, so its first sync is
    // its only one, and it reads records written seconds ago rather than records
    // written before it started booting.
    await env.healPartition([10], RUNNING);
    await env.startDiscovery([10]);
    await waitForOrchestratorState(joiner, 'READY', 180000);

    // THE PREMISE, asserted on what arrived rather than on how long it took.
    //
    // messageStore refuses a broadcast older than locationTtlS and skips it
    // without a word, so seeded events that expire before the joiner reads them
    // leave an empty location list rather than a rejected message - and the
    // eviction assertion below passes on an empty store either way.
    //
    // Judged by whether the joiner holds them, so an idle box and a loaded one
    // are held to the same standard: elapsed time is a property of the box, and
    // the premise is a property of the data. The elapsed figure names WHICH
    // fault this is when nothing arrived - past the window, setup outran it;
    // inside the window, the response never carried them.
    const windowMs = loadSharedConfig().fluxapps.locationTtlS * 1000;
    const spent = Date.now() - stamp;
    const seeded = await dbClient(11).getAppLocationsByIp(socketAddr(PRUNE_NODE));
    expect(seeded.map((row) => row.name), spent > windowMs
      ? `setup spent ${spent}ms of the ${windowMs}ms acceptance window, so the seeded `
        + 'broadcasts expired before the joiner read them'
      : `the joiner reached READY ${spent}ms after seeding, inside the ${windowMs}ms `
        + 'window, and holds none of the seeded broadcasts')
      .to.include('keptapp');
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should keep an evicted node evicted, even when a later slice reports it running', async function () {
    this.timeout(60000);
    const rows = await dbClient(11).getAppLocationsByIp(socketAddr(EVICTED_NODE));

    expect(rows, 'evicted node has location rows again').to.be.an('array').with.length(0);
  });

  it('should prune an app the newest broadcast no longer reports', async function () {
    this.timeout(60000);
    // CONVERGED, NOT INSTANTANEOUS. READY is raised once the required number of peers
    // has completed - one - while the rest are still streaming, and every peer serves
    // the same history: the older broadcast sorts into an earlier slice than the newer
    // one, so each replay re-adds this app and then prunes it again. A single read can
    // land between those two chunks and see a row the response it came from goes on to
    // remove.
    //
    // Still fails if the prune never happens: the window only tolerates a replay in
    // flight, it does not wait for one that is not coming.
    let names = [];
    await waitFor(async () => {
      names = (await dbClient(11).getAppLocationsByIp(socketAddr(PRUNE_NODE))).map((r) => r.name);
      return names.includes('keptapp') && !names.includes('droppedapp');
    }, {
      timeout: 45000,
      interval: 1000,
      label: 'the newest broadcast from the pruned node to be the one in effect',
    });

    expect(names).to.include('keptapp');
    expect(names, 'app missing from the newest broadcast was not pruned').to.not.include('droppedapp');
  });

  it('should never let a forged broadcast delete a location row', async function () {
    this.timeout(60000);
    const rows = await dbClient(11).getAppLocationsByIp(socketAddr(FORGERY_NODE));
    const names = rows.map((r) => r.name);

    // The forged event names only realapp and carries the newest timestamp, so
    // anything that prunes from unverified data drops targetapp.
    expect(names).to.include('realapp');
    expect(names, 'a forged broadcast pruned a location row').to.include('targetapp');
  });

  it('should leave a running report in force when an older shutdown of that node arrives with it', async function () {
    this.timeout(60000);
    // The shutdown speaks for what the node broadcast before it. Applied to the
    // newer report, it would shorten that row to the shutdown's grace - already
    // in the past for a replayed shutdown - and the row would be reaped while
    // the node runs.
    const ttlMs = loadSharedConfig().fluxapps.locationTtlS * 1000;
    const rows = await dbClient(11).getAppLocationsByIp(socketAddr(SIGTERM_NODE));
    const row = rows.find((r) => r.name === 'stillrunningapp');

    expect(row, 'the running node lost its location row').to.not.equal(undefined);
    expect(row.expireAt.getTime(), 'the older shutdown shortened the newer row')
      .to.equal(stamp + RUNNING_AT + ttlMs);
  });

  it('should keep an app a node reinstalled after an older removal of it', async function () {
    this.timeout(60000);
    const rows = await dbClient(11).getAppLocationsByIp(socketAddr(REMOVED_NODE));

    expect(rows.map((r) => r.name), 'an older removal deleted the newer report')
      .to.include('reinstalledapp');
  });

  it('should keep a node that came back after an eviction, and keep the eviction\'s own time', async function () {
    this.timeout(60000);
    const rows = await dbClient(11).getAppLocationsByIp(socketAddr(RETURNED_NODE));
    expect(rows.map((r) => r.name), 'an older eviction deleted the node\'s newer report')
      .to.include('returnedapp');

    // Stored under the time the evicting node made it, not the time it arrived
    // here: a node that re-dated it would hand it on as fresh, and every node
    // syncing from it afterwards would evict the returned node again.
    const [eviction] = await dbClient(11).getAppStateEvents({ ip: socketAddr(RETURNED_NODE), type: 'evicted' });
    expect(eviction, 'the eviction reached the joiner').to.not.equal(undefined);
    expect(eviction.createdAt.getTime(), 'the eviction was re-dated on receipt')
      .to.equal(stamp + EARLIER_AT);
  });
});
