// weight: medium
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { apprunningEvent, socketAddr, specHashOf } from '../framework/state-events.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForDaemonReady, waitForNodeStatus, waitForOrchestratorState } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// A node joining the network learns where apps run from its peers' event logs,
// and takes a report there only when it is exactly a report, as it takes one that
// arrives by gossip: a report naming an app that is not exactly a name, a hash
// and a running time is refused whole, and nothing of it is stored.
//
// The peers serve such reports from their logs, seeded there directly. The joiner
// here is a node coming back: it already holds a row for one node and the
// well-formed report behind it, and a newer refused report about that node
// deletes neither. A well-formed report served beside them is stored: the canary
// that the joiner read what its peers served.

const RUNNING = [0, 1, 2, 3];
const JOINER = 4;
// The nodes the reports are about, by node number: real nodes holding no apps,
// so the seeded reports are the only ones there are about them.
const GOOD_NODE = 2;
const MIXED_NODE = 3;
const REFUSED_NODE = 4;

describe('a synced announcement not exactly its format is refused whole', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let joiner;
  const stamp = Date.now();
  const good = `e2esyncgood${stamp}`;
  const named = `e2esyncnamed${stamp}`;
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

    // Booted cut off, so the seeded reports' acceptance window spans the sync
    // and not the boot.
    await env.holdOutPendingNode(JOINER, RUNNING);
    joiner = await env.startNode(JOINER);
    await waitForDaemonReady(joiner);
    await waitForNodeStatus(joiner, (d) => d.confirmed === true, 30000);

    const at = Date.now();
    // What the joiner already holds about REFUSED_NODE from before it went away:
    // the well-formed report and the row it wrote.
    await dbClient(JOINER + 1).seedAppStateEvent(await apprunningEvent({ nodeNum: REFUSED_NODE, broadcastedAt: at - 5000, apps: [held] }));
    await dbClient(JOINER + 1).seedAppLocation({
      name: held, ip: socketAddr(REFUSED_NODE), hash: specHashOf(held), broadcastedAt: at - 5000, runningSince: at - 5000,
    });
    // What every peer serves: a well-formed report for GOOD_NODE; for MIXED_NODE
    // one well-formed app and one without a hash; for REFUSED_NODE a newer report
    // whose only app has no hash.
    const events = [
      await apprunningEvent({ nodeNum: GOOD_NODE, broadcastedAt: at, apps: [good] }),
      await apprunningEvent({
        nodeNum: MIXED_NODE,
        broadcastedAt: at,
        apps: [named, { name: `e2esyncunhashed${stamp}`, runningSince: new Date(at).toISOString() }],
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
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('stores a well-formed report its peers served', async function () {
    expect(await rowNames(GOOD_NODE), 'canary: the joiner stored nothing its peers served').to.include(good);
  });

  it('stores none of a report naming one app that is not exactly an app', async function () {
    expect(await rowNames(MIXED_NODE), 'the joiner stored an app of a refused report').to.deep.equal([]);
  });

  it('keeps the row it holds for a node past a newer refused report', async function () {
    const names = await rowNames(REFUSED_NODE);
    expect(names, 'the refused report pruned the rows the well-formed one stood behind').to.include(held);
    expect(names, 'the joiner stored an app of a refused report').to.not.include(probe);
  });

  it('keeps the well-formed report in the log it serves its own peers', async function () {
    const logged = await dbClient(JOINER + 1).getAppStateEvents({ ip: socketAddr(REFUSED_NODE), type: 'apprunning' });
    expect(logged.map((event) => event.data.apps.map((a) => a.name)), 'the refused report took the well-formed one\'s place').to.deep.equal([[held]]);
  });
});
