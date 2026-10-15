// weight: heavy
// A node the published location table places outside an app's geolocation gives
// the app up, and a correctly placed node takes it.
//
// Install is the only place a geolocation pin used to be checked. A node that
// passed it on one table and was then moved by a corrected one kept the app for
// as long as the owner left the spec alone - so a table correction reached new
// placements and never the instances already running in the wrong country.
//
// One fleet, five nodes, all in DE on the table the fleet boots with, and two
// apps pinned to DE:
//
//   MOVES   four instances, so one DE node is free to take a departure's place
//   STALLS  five instances, held by every node, so a departure leaves a gap that
//           nothing correctly placed can fill
//
// Mid-run the table is republished with ONE holder of both apps in FR. What
// must follow, each asserted on the event the decision emits rather than on
// placement, which is a lottery:
//
//   - the moved node decides MISPLACED for MOVES and gives it up, and the free
//     DE node takes the gap;
//   - the moved node gives STALLS up too, and the other four keep it: with
//     nowhere correctly placed to go the gap stays open, and the app keeps
//     serving and keeps its data where it is;
//   - a node whose own ip-api report says FR while the table says DE keeps both
//     apps: only the table moves an installed app.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import {
  bootAndPeer, seedSpawnerApp, waitForInstanceCount, installedInstanceIndices,
} from '../framework/reconciler-suite.js';
import { waitFor, waitForGiveUpConsidered } from '../framework/wait.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import {
  derivedQueueStepMs, derivedEvacuationIntervalMs, departureCycleMs, loadSharedConfig,
} from '../framework/coupled-knobs.js';

const subnet = getSubnetConfig();

const NODES = 5;
const MOVES = 'misplacedmoves';
const STALLS = 'misplacedstalls';
const PIN = ['acEU_DE'];

// Node 5 reports itself in FR from boot while the table places it in DE. The
// table outranks the self-report for placement, so it installs both apps, and
// it is the node the "own report moves nothing" claim is about.
const SELF_REPORTED_FR = 5;
const FR_GEO = {
  country: 'France', countryCode: 'FR', region: 'IDF', regionName: 'Ile-de-France',
};

// The node that reaches the published source. A node checks it once a day, so
// across a real network some node is always about to; across five, none is for
// hours. Compressed on this one node only - the others learn of a new table
// from it, the way the network spreads one.
const TICKING_NODE = 0;

// The give-up pass runs every removeFluxAppsPeriod x 4 blocks and a block costs
// one explorer poll. Two is the floor suite 55 measured: a departure has to be
// visible to the other holders before their next pass.
const PASS_PERIOD_BLOCKS = 2;
const SHARED_POLL_MS = loadSharedConfig().fluxapps.explorerPollIntervalMs;
const PACING = (() => {
  const fleet = { removeFluxAppsPeriod: PASS_PERIOD_BLOCKS, explorerPollIntervalMs: SHARED_POLL_MS };
  const residentialQueueStepMs = derivedQueueStepMs(fleet);
  const residentialEvacuationIntervalMs = derivedEvacuationIntervalMs({ ...fleet, residentialQueueStepMs });
  return { residentialQueueStepMs, residentialEvacuationIntervalMs };
})();
const QUEUE_BASE_MS = 1000;
// A misplaced departure waits out the queue only - no evacuation interval - but
// the derived cycle is the bound every other departure wait in the harness uses,
// and the worst position is one short of the larger app's count.
const DEPARTURE_WAIT_MS = 2 * departureCycleMs({
  ...PACING,
  removeFluxAppsPeriod: PASS_PERIOD_BLOCKS,
  explorerPollIntervalMs: SHARED_POLL_MS,
  residentialQueueBaseMs: QUEUE_BASE_MS,
}, NODES);

describe('1505: a node the table places outside an app\'s geolocation gives the app up', function () {
  let env;
  // zero-based client indices
  let moved;
  let free;
  // each node's last event id once it held the moved table, so a wait can ask
  // for what happened after the move rather than at any time since boot
  let afterMove;

  const isMisplaced = (d) => d.reason === 'MISPLACED';

  const publishTable = async (body) => {
    const response = await fetch(`${env.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.ok, 'the stub accepted the publication').to.equal(true);
    return response.json();
  };

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      tickerAutostart: false,
      geolocation: { [SELF_REPORTED_FR]: FR_GEO },
      // One organisation, every address DE.
      locationTable: { domains: 1 },
      nodeConfigOverrides: { [TICKING_NODE]: { policy: { refreshIntervalMs: 15000 } } },
      configOverrides: {
        fluxapps: {
          minOutgoing: 2,
          minIncoming: 1,
          // The cached chain height is refreshed on this interval and only the
          // last block of a burst runs the maintenance the give-up pass hangs
          // off; at 1:1 with the block a steady burst can keep the pass from
          // ever landing (see suite 55).
          daemonInfoIntervalMs: 1000,
          removeFluxAppsPeriod: PASS_PERIOD_BLOCKS,
          residentialQueueBaseMs: QUEUE_BASE_MS,
          residentialQueueStepMs: PACING.residentialQueueStepMs,
          residentialEvacuationIntervalMs: PACING.residentialEvacuationIntervalMs,
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 2, minInbound: 2 });

    // An installer resolves its own location through the table, so a node still
    // without it refuses a pinned app and placement would race the ingest.
    await waitFor(async () => {
      const trees = await Promise.all(env.clients.map(
        (client) => client.get('/apps/placementlocations').catch(() => null),
      ));
      return trees.every((tree) => tree?.status === 'success'
        && tree.data.tableAvailable === true
        && tree.data.total.nodes === env.nodeCount
        && tree.data.unresolved === 0);
    }, { timeout: 120000, interval: 3000, label: 'every node holds the location table with every fleet address resolved' });

    const moves = await buildSeedableApp({
      env, name: MOVES, instances: NODES - 1, geolocation: PIN,
    });
    const stalls = await buildSeedableApp({
      env, name: STALLS, instances: NODES, geolocation: PIN,
    });
    await seedSpawnerApp(env, moves);
    await seedSpawnerApp(env, stalls);
    await waitForInstanceCount(env, MOVES, NODES - 1, { timeout: 300000 });
    await waitForInstanceCount(env, STALLS, NODES, { timeout: 300000 });

    // The holder to move: any holder of MOVES except the self-reported-FR node,
    // whose claim is that it is NOT moved. Every node holds STALLS.
    const holders = await installedInstanceIndices(env, MOVES);
    const selfReported = SELF_REPORTED_FR - 1;
    moved = holders.find((i) => i !== selfReported);
    free = [...Array(NODES).keys()].find((i) => !holders.includes(i));
    expect(moved, 'a holder of MOVES other than the self-reported-FR node').to.be.a('number');
    expect(free, 'one node does not hold MOVES').to.be.a('number');

    const beforeMove = env.clients.map((client) => client.getLastEventId());
    await publishTable({ domains: 1, countryByIp: { [subnet.nodeIp(moved + 1)]: 'FR' } });
    // The ticking node fetches the new bundle within its refresh interval, every
    // other node adopts it from a peer, and each installs the table it names.
    await Promise.all(env.clients.map((client, i) => client.waitForEvent(
      'ipLocation:tableInstalled',
      () => true,
      240000,
      { afterId: beforeMove[i] },
    )));
    afterMove = env.clients.map((client) => client.getLastEventId());
  });

  after(async function () {
    this.timeout(30000);
    // leave the stub on its single-domain default for whatever runs next
    await fetch(`${env?.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: 1 }),
    }).catch(() => {});
    await env?.teardown();
  });

  it('the moved node gives MOVES up and the free DE node takes it', async function () {
    this.timeout(DEPARTURE_WAIT_MS + 300000);
    await waitForGiveUpConsidered(env.clients[moved], MOVES, (d) => isMisplaced(d) && d.giveUp === true, DEPARTURE_WAIT_MS);

    await waitFor(async () => {
      const holders = await installedInstanceIndices(env, MOVES);
      return holders.length === NODES - 1 && !holders.includes(moved) && holders.includes(free);
    }, { timeout: 300000, interval: 3000, label: `${MOVES} on every DE node but the moved one` });
  });

  it('the moved node gives STALLS up and the rest keep it, with nowhere correctly placed to go', async function () {
    this.timeout(DEPARTURE_WAIT_MS * 3 + 120000);
    await waitForGiveUpConsidered(env.clients[moved], STALLS, (d) => isMisplaced(d) && d.giveUp === true, DEPARTURE_WAIT_MS * 2);
    await waitFor(async () => !(await installedInstanceIndices(env, STALLS)).includes(moved), {
      timeout: 120000, interval: 3000, label: `the moved node no longer holds ${STALLS}`,
    });

    // The gap stays open: four DE holders, and every one of them still has it
    // after a whole departure cycle - long enough for any of them to have left
    // if anything were telling it to.
    await sleepUnlessInfraDead(DEPARTURE_WAIT_MS);
    const holders = await installedInstanceIndices(env, STALLS);
    expect(holders, `${STALLS} stays on the four DE nodes`)
      .to.deep.equal([...Array(NODES).keys()].filter((i) => i !== moved));
  });

  it('a node whose own report says FR keeps both apps while the table places it in DE', async function () {
    this.timeout(DEPARTURE_WAIT_MS + 60000);
    const selfReported = env.clients[SELF_REPORTED_FR - 1];
    // It is judging STALLS on every pass - a non-MISPLACED verdict proves the
    // pass ran on this node after the table moved, so the negative below is
    // measured against a node that was looking.
    await waitForGiveUpConsidered(selfReported, STALLS, (d) => !isMisplaced(d), DEPARTURE_WAIT_MS, {
      afterId: afterMove[SELF_REPORTED_FR - 1],
    });

    const misplaced = await waitForGiveUpConsidered(selfReported, STALLS, isMisplaced, DEPARTURE_WAIT_MS)
      .then(() => true, () => false);
    expect(misplaced, 'the self-reported-FR node never judged STALLS misplaced').to.equal(false);
    expect(await installedInstanceIndices(env, STALLS)).to.include(SELF_REPORTED_FR - 1);
  });
});
