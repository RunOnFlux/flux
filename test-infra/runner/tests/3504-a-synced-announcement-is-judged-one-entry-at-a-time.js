// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { apprunningEvent, socketAddr } from '../framework/state-events.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForDaemonReady, waitForNodeStatus, waitForOrchestratorState } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node joining the network learns where apps run from its peers' event logs,
// and judges each announcement there one entry at a time, as it judges one that
// arrives by gossip: an entry without a name and a hash is refused
// (network:apprunningRefused, path sync) and the rest are stored.
//
// A peer that has not upgraded serves whatever it last recorded for a node,
// which may be an announcement whose every entry the joiner refuses. The joiner
// here is a node coming back: it already holds a row for that node and the
// readable announcement behind it. It prunes a node's rows only against an
// announcement it can store, so the refused one deletes neither the row nor the
// readable announcement in the log it serves its own peers.

const RUNNING = [0, 1, 2, 3];
const JOINER = 4;
// The nodes the announcements are about, by node number: real nodes holding no
// apps, so the seeded announcements are the only ones there are about them.
const MIXED_NODE = 3;
const REFUSED_NODE = 4;

describe('a synced announcement is judged one entry at a time', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let joiner;
  let refused;
  const stamp = Date.now();
  const kept = `e2esynckept${stamp}`;
  const dropped = `e2esyncdropped${stamp}`;
  const held = `e2esyncheld${stamp}`;
  const probe = `e2esyncprobe${stamp}`;
  const rowNames = async (nodeNum) => (await dbClient(JOINER + 1).getAppLocationsByIp(socketAddr(nodeNum))).map((row) => row.name);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: RUNNING.length + 1,
      deferredNodes: 1,
      tickerAutostart: false,
      // The joiner learns from these, and a node answers a state sync only once
      // its own has finished.
      syncedNodes: RUNNING,
    });
    await bootAndPeer(env);

    // Booted cut off, so the seeded announcements' acceptance window spans the
    // sync and not the boot.
    await env.holdOutPendingNode(JOINER, RUNNING);
    joiner = await env.startNode(JOINER);
    await waitForDaemonReady(joiner);
    await waitForNodeStatus(joiner, (d) => d.confirmed === true, 30000);

    const at = Date.now();
    // What the joiner already holds about REFUSED_NODE from before it went away:
    // the readable announcement and the row it wrote.
    await dbClient(JOINER + 1).seedAppStateEvent(await apprunningEvent({ nodeNum: REFUSED_NODE, broadcastedAt: at - 5000, apps: [held] }));
    await dbClient(JOINER + 1).seedAppLocation({
      name: held, ip: socketAddr(REFUSED_NODE), hash: `hash-${held}`, broadcastedAt: at - 5000, runningSince: at - 5000,
    });
    // What every peer serves: for MIXED_NODE one readable entry and one without a
    // hash; for REFUSED_NODE a newer announcement whose only entry has no hash,
    // the one a peer that has not upgraded holds for a node it last heard that from.
    const events = [
      await apprunningEvent({
        nodeNum: MIXED_NODE,
        broadcastedAt: at,
        apps: [kept, { name: dropped, runningSince: new Date(at).toISOString() }],
      }),
      await apprunningEvent({
        nodeNum: REFUSED_NODE, broadcastedAt: at, apps: [{ name: probe, runningSince: new Date(at).toISOString() }],
      }),
    ];
    await Promise.all(RUNNING.map((i) => dbClient(i + 1).seedAppStateEvents(events.map((event) => ({ ...event })))));

    const mark = joiner.getLastEventId();
    await env.releasePendingNode(JOINER, RUNNING);
    await env.startDiscovery([JOINER]);
    await waitForOrchestratorState(joiner, 'READY', 180000);
    // Every peer's response stored and pruned.
    await joiner.waitForEvent('ephemeralSync:allComplete', () => true, 180000, { afterId: mark });
    refused = joiner.getEventBuffer()
      .filter((e) => e.id > mark && e.event === 'network:apprunningRefused' && e.data.path === 'sync')
      .flatMap((e) => e.data.refusals);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('stores the entries with a name and hash, and refuses the one without', async function () {
    const names = await rowNames(MIXED_NODE);
    expect(names).to.include(kept);
    expect(names, 'the joiner stored an entry without a hash').to.not.include(dropped);
    expect(refused.some((r) => r.ip === socketAddr(MIXED_NODE) && r.names.includes(dropped)), 'the joiner did not report the entry it refused').to.equal(true);
  });

  it('keeps the row it holds for a node past a newer announcement whose every entry it refuses', async function () {
    const names = await rowNames(REFUSED_NODE);
    expect(names, 'the refused announcement pruned the rows the readable one stood behind').to.include(held);
    expect(names, 'the joiner stored an entry without a hash').to.not.include(probe);
    expect(refused.some((r) => r.ip === socketAddr(REFUSED_NODE) && r.names.includes(probe)), 'the joiner did not report the announcement it refused').to.equal(true);
  });

  it('keeps the readable announcement in the log it serves its own peers', async function () {
    const logged = await dbClient(JOINER + 1).getAppStateEvents({ ip: socketAddr(REFUSED_NODE), type: 'apprunning' });
    expect(logged.map((event) => event.data.apps.map((a) => a.name)), 'the refused announcement took the readable one\'s place').to.deep.equal([[held]]);
  });
});
