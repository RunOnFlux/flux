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
import { waitFor } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { PASS_PERIOD_BLOCKS, PASS_MS, RESIDENTIAL_PACING } from '../framework/residential-fleet.js';
import { keysOf, nextOwnedTurn, untilOwnedTurnEndsMs } from '../framework/handback-turns.js';

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

// The give-up pass and the handback turn the residential fleets run on: a
// misplaced holder leaves by the same turn rule as an evacuating one.
const TURN_MS = RESIDENTIAL_PACING.residentialTurnMs;

/**
 * How long until `node` can have handed back an app held by `holders`: to the
 * end of the second turn it owns from now, by the product's own turn rule, plus
 * two passes for a pass that lands late. The second, because the first can go
 * to the other app the node holds.
 * @param {number} node 1-based.
 * @param {number[]} holders 1-based nodes holding the app.
 * @returns {number} Milliseconds.
 */
function handBackWaitMs(node, holders) {
  const turns = { holders: keysOf(holders), owners: keysOf([node]), turnMs: TURN_MS };
  const first = nextOwnedTurn({ ...turns, fromMs: Date.now() });
  return untilOwnedTurnEndsMs({ ...turns, fromMs: first.startMs + TURN_MS }) + (2 * PASS_MS);
}

describe('1505: a node the table places outside an app\'s geolocation gives the app up', function () {
  let env;
  // zero-based client indices
  let moved;
  let free;
  // each node's last event id once it held the moved table, so a wait can ask
  // for what happened after the move rather than at any time since boot
  let afterMove;

  const isMisplaced = (d) => d.reason === 'MISPLACED';
  const gaveUp = (d) => isMisplaced(d) && d.giveUp === true;

  // What one node decided about one app, read from its event stream: every
  // give-up pass publishes a decision for every app the node holds.
  const decided = (index, appName, predicate, afterId = 0) => env.clients[index].getEventBuffer()
    .some((e) => e.event === 'giveUp:considered' && e.id > afterId
      && e.data.appName === appName && predicate(e.data));

  // Blocks are driven at the explorer poll the turn is derived from. The
  // free-running ticker is slower, and a turn would then hold fewer passes than
  // the rule needs.
  const drive = (index, condition, timeoutMs, label) => driveUntil(env.clients[index], condition, { timeoutMs, label });

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
          residentialTurnMs: TURN_MS,
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
    await stopTicker();
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
    const waitMs = handBackWaitMs(moved + 1, (await installedInstanceIndices(env, MOVES)).map((i) => i + 1));
    this.timeout(waitMs + 360000);
    await drive(moved, async () => decided(moved, MOVES, gaveUp), waitMs, `node ${moved} gives ${MOVES} up as misplaced`);

    await drive(free, async () => {
      const holders = await installedInstanceIndices(env, MOVES);
      return holders.length === NODES - 1 && !holders.includes(moved) && holders.includes(free);
    }, 300000, `${MOVES} on every DE node but the moved one`);
  });

  it('the moved node gives STALLS up and the rest keep it, with nowhere correctly placed to go', async function () {
    const all = [...Array(NODES).keys()].map((i) => i + 1);
    const remaining = all.filter((node) => node !== moved + 1);
    const waitMs = handBackWaitMs(moved + 1, all);
    this.timeout(waitMs + 180000);
    await drive(moved, async () => decided(moved, STALLS, gaveUp), waitMs, `node ${moved} gives ${STALLS} up as misplaced`);
    await drive(free, async () => !(await installedInstanceIndices(env, STALLS)).includes(moved), 120000, `the moved node no longer holds ${STALLS}`);

    // The gap stays open: four DE holders, and every one of them still has it
    // after each has owned a turn among them - so any of them being told to
    // leave would have.
    const holdMs = Math.max(...remaining.map((node) => handBackWaitMs(node, remaining)));
    // Set again, which restarts the test's timer, now the hold is known.
    this.timeout(holdMs + 120000);
    const holdUntil = Date.now() + holdMs;
    await drive(free, async () => Date.now() >= holdUntil, holdMs + 60000, 'a turn owned by every remaining holder');
    const holders = await installedInstanceIndices(env, STALLS);
    expect(holders, `${STALLS} stays on the four DE nodes`)
      .to.deep.equal([...Array(NODES).keys()].filter((i) => i !== moved));
    [...Array(NODES).keys()].filter((i) => i !== moved).forEach((i) => {
      expect(decided(i, STALLS, isMisplaced), `node ${i} never judged ${STALLS} misplaced`).to.equal(false);
    });
  });

  it('a node whose own report says FR keeps both apps while the table places it in DE', async function () {
    this.timeout((4 * PASS_MS) + 60000);
    const selfReported = SELF_REPORTED_FR - 1;
    // A decision about STALLS since the table moved proves the pass ran on this
    // node after it, so the negatives below are about a node that was looking,
    // over the same passes in which the moved node judged both apps misplaced.
    await drive(selfReported, async () => decided(selfReported, STALLS, () => true, afterMove[selfReported]), 4 * PASS_MS, `node ${selfReported} judges ${STALLS} after the move`);

    expect(decided(moved, STALLS, isMisplaced), 'the moved node judged STALLS misplaced over the same passes').to.equal(true);
    expect(decided(selfReported, STALLS, isMisplaced), 'the self-reported-FR node never judged STALLS misplaced').to.equal(false);
    expect(decided(selfReported, MOVES, isMisplaced), 'the self-reported-FR node never judged MOVES misplaced').to.equal(false);
    expect(await installedInstanceIndices(env, STALLS)).to.include(selfReported);
  });
});
