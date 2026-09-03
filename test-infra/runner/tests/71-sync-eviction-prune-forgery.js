import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';
import { nodeKey } from '../framework/keys.js';
import { signBtcMessage } from '../auth.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed, waitForOrchestratorState,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';

const subnet = getSubnetConfig();

// A sync response is carried through in slices, so a response has to be longer
// than one slice for these to mean anything.
const SLICE = 250;
const FILLER_EVENTS = 320;

const socketAddr = (nodeNum) => `${subnet.nodeIp(nodeNum)}:16127`;

/**
 * Build an appstateevents document the way a node would have stored one, so the
 * serving nodes stream it verbatim to the late joiner.
 *
 * `signedBy` lets a document carry a signature made with the wrong node's key -
 * the shape a forged event has on the wire.
 */
async function apprunningEvent({
  nodeNum, apps, broadcastedAt, dedupKey = 'v2', signedBy = nodeNum,
}) {
  const identity = nodeKey(nodeNum);
  const ip = socketAddr(nodeNum);
  const version = 1;
  const data = {
    type: 'fluxapprunning',
    version: 2,
    apps: apps.map((name) => ({
      name,
      hash: `hash-${name}`,
      runningSince: new Date(broadcastedAt).toISOString(),
    })),
    ip,
    broadcastedAt,
    osUptime: 10000,
    staticIp: false,
  };
  const payload = String(version) + JSON.stringify(data) + String(broadcastedAt);
  const signature = await signBtcMessage(payload, nodeKey(signedBy).privkey);

  return {
    type: 'apprunning',
    dedupKey,
    ip,
    broadcastedAt: new Date(broadcastedAt),
    envelope: {
      version, timestamp: broadcastedAt, pubKey: identity.pubkey, signature,
    },
    data,
  };
}

// Evictions carry no broadcastedAt, so the sender's timestamp sort always places
// them at the very front of the response - in the first slice.
const evictedEvent = (nodeNum) => ({
  type: 'evicted',
  ip: socketAddr(nodeNum),
  dedupKey: `evicted:${socketAddr(nodeNum)}`,
  createdAt: new Date(),
});

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
    env = await createTestEnv({
      hookCtx: this, nodes: 12, deferredNodes: 2, tickerAutostart: false,
    });
    const RUNNING = Array.from({ length: 10 }, (_, i) => i);
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
    // than a boot, which is unbounded.
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

    // The node is evicted, and reports itself running an app later in the same
    // response. The eviction must still be the outcome.
    events.push(evictedEvent(EVICTED_NODE));
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

    // THE GUARD, not decoration. Every assertion below rests on the seeded
    // broadcasts still being inside their acceptance window when the joiner
    // reads them, and this suite has twice failed by spending that window on
    // setup instead - the second time with the boot inside it, measured at 24.6s
    // of 63s idle and ~83s under a six-way gate.
    //
    // Without this, moving the boot back inside the window reads as green on any
    // idle box and red only on a loaded one, which is how it got here. Asserted
    // against the live knob rather than a literal, so compressing locationTtlS
    // further tightens this too, and a third of it is the margin: the gate must
    // be able to treble what an idle box costs and still fit.
    const windowMs = loadSharedConfig().fluxapps.locationTtlS * 1000;
    const spent = Date.now() - stamp;
    expect(spent, `setup spent ${spent}ms of the ${windowMs}ms acceptance window - `
      + 'the seeded broadcasts expire before the joiner reads them under any load')
      .to.be.lessThan(windowMs / 3);
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
    const rows = await dbClient(11).getAppLocationsByIp(socketAddr(PRUNE_NODE));
    const names = rows.map((r) => r.name);

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
});
