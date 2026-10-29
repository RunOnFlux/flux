// The residential evacuation fleet: node 1 residential and attested, the rest
// in a data centre, and a published location table that decides all of them -
// with the pacing and helpers the suites that drain it share.
import { createTestEnv } from './test-env.js';
import { dbClient } from './db-client.js';
import { pushTestApp } from './registry-helper.js';
import { buildSeedableApp } from './seed-helper.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from './subnet-config.js';
import { advanceBlock, startTicker, setSystemSecure } from './daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold, waitFor,
} from './wait.js';
import { retireApp, waitForLocationTable } from './reconciler-suite.js';
import {
  derivedTurnMs, giveUpPassMs, harnessBlockCostMs, loadSharedConfig, PRODUCTION_LOCATION_EXPIRIES,
} from './coupled-knobs.js';
import { keysOf, nextOwnedTurn, untilOwnedTurnEndsMs } from './handback-turns.js';

export const subnet = getSubnetConfig();

// A residential node is one whose network classification reaches RESIDENTIAL on
// positive evidence with nothing contradicting it. In the harness the only
// signal available is what the ip-api stub serves - the fleet has no reverse
// DNS and the stub tiers are not asymmetric enough to count - so `mobile` is the
// positive signal and every contradiction is turned off.
// THE PASS PERIOD, and everything about the evacuating suites' cost hangs off
// it. The give-up pass runs every `removeFluxAppsPeriod x 4` blocks, a block
// costs one explorer poll, and the handback turn is derived from that pass - so
// this number multiplies through every departure a suite makes.
//
// The lower bound is PROPAGATION, not comfort: the removal broadcast has to
// reach the other holders within one pass, and at a 1-block pass (~1s) it
// measurably did not - the other node evaluated twice more before
// network:appremoved arrived and both holders left.
export const PASS_PERIOD_BLOCKS = 2;
const SHARED_POLL_MS = loadSharedConfig().fluxapps.explorerPollIntervalMs;
const PACING_FLEET = { removeFluxAppsPeriod: PASS_PERIOD_BLOCKS, explorerPollIntervalMs: SHARED_POLL_MS };
export const PASS_MS = giveUpPassMs(PACING_FLEET, harnessBlockCostMs(PACING_FLEET));
// The pacing these fleets run on. test-env asserts it on every node of every
// fleet before boot. The departure interval only paces one node's own
// departures: at one pass, a node that owns two turns in a row departs in both.
export const RESIDENTIAL_PACING = (() => {
  const residentialTurnMs = derivedTurnMs(PACING_FLEET);
  return { residentialTurnMs, residentialEvacuationIntervalMs: Math.ceil(PASS_MS / 1000) * 1000 };
})();

/** The fleet's nodes, 1-based: every app these fleets seed is held by all of them. */
export function fleetNodes(env) {
  return Array.from({ length: env.nodeCount }, (_, i) => i + 1);
}

/**
 * How long until one of `nodes` can have handed back an app every fleet node
 * holds: to the end of the second turn one of them owns once a departure
 * interval from now has passed, by the product's own turn rule, plus two passes
 * for a pass that lands late. The second, because the first can go to a pass
 * the safety gate refuses or to another app the node holds.
 *
 * A node owns about one turn in as many as the app has holders, with no bound on
 * the gap, so a wait on a departure takes this as its only budget.
 * @param {number[]} nodes 1-based nodes that are evacuating.
 * @param {number} nodeCount The fleet's size; every node holds the app.
 * @returns {number} Milliseconds.
 */
export function departureWaitMs(nodes, nodeCount) {
  const all = Array.from({ length: nodeCount }, (_, i) => i + 1);
  const { residentialTurnMs, residentialEvacuationIntervalMs } = RESIDENTIAL_PACING;
  const first = nextOwnedTurn({
    holders: keysOf(all),
    owners: keysOf(nodes),
    turnMs: residentialTurnMs,
    fromMs: Date.now() + residentialEvacuationIntervalMs,
  });
  return untilOwnedTurnEndsMs({
    holders: keysOf(all),
    owners: keysOf(nodes),
    turnMs: residentialTurnMs,
    fromMs: first.startMs + residentialTurnMs,
  }) + (2 * PASS_MS);
}

export const RESIDENTIAL_GEO = {
  hosting: false,
  proxy: false,
  mobile: true,
  org: 'Some Reseller Ltd',
  isp: 'Consumer Access Networks',
  as: 'AS64500 Consumer Access Networks',
};

// Nothing either way: no hosting flags, no operator that sells hosting, and
// the fleet has no reverse DNS. The node's own rule reaches UNKNOWN on this,
// so whatever verdict it ends up with came from the published table.
export const NEUTRAL_GEO = {
  hosting: false, proxy: false, mobile: false, org: 'Neutral Holdings', isp: 'Metro Fibre', as: 'AS64501 Metro Fibre',
};

// Hosting evidence the node can see about its OWN address, which is what lets
// it decline a published residential verdict meant for its neighbours.
export const HOSTING_GEO = {
  hosting: true, proxy: false, mobile: false, org: 'Reseller', isp: 'Hetzner Online GmbH', as: 'AS24940 Hetzner Online GmbH',
};

export async function bootToReady(env) {
  await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
  await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
  await waitForExplorerReady(env.clients[0]);
  await waitForOrchestratorStarted(env.clients[0]);
  await advanceBlock();
  await waitForBlockProcessed(env.clients[0], () => true, 20000);
  await env.startDiscovery();
  await waitForPeerThreshold(env.clients[0], 120000);
  await startTicker();
  await waitForOrchestratorState(env.clients[0], 'READY', 120000);
}

/**
 * Seed a global app the spawner can place. The port is allocated, so seeding a
 * second app on the same fleet cannot collide with the first - see
 * buildSeedableApp, which assigns one where the spec is built.
 */
export async function seedApp(env, appName, { instances = 3, containerData = '/tmp' } = {}) {
  // A CONTAINER THAT HONOURS docker stop. This suite times one holder's
  // departure against another holder's next give-up pass, so what the app does
  // with SIGTERM is part of the arithmetic: /bin/pause installs no handler and
  // is PID 1, where Linux discards unhandled signals, so docker waits its full
  // ten-second grace and then kills it. That put the announcement of a
  // departure a whole grace period after the commitment to it, and the second
  // holder decided in between. test-app exits on the signal, which is the
  // behaviour the pacing in coupled-knobs is sized against.
  await pushTestApp(appName, 'v1');
  const app = await buildSeedableApp({
    name: appName,
    instances,
    compose: [{
      name: appName,
      description: 'test container',
      repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
      ports: [],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData,
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    }],
  });
  for (let i = 1; i <= env.nodeCount; i++) {
    const dc = dbClient(i);
    await dc.seedGlobalAppSpec(app.spec);
    await dc.seedPermanentMessage(app.permanentMessage);
    await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
  }
  if (!seededApps.has(env)) seededApps.set(env, []);
  seededApps.get(env).push(app);
  return app;
}

// The apps seedApp has seeded on each fleet and not yet retired.
const seededApps = new WeakMap();

/**
 * Retire every app seedApp has seeded on this fleet. A pass hands back one app,
 * and returning a node to service lets the spawner refill any app a departure
 * left short, so an app left on the fleet can be judged ahead of the next one.
 */
export async function retireSeededApps(env) {
  const apps = seededApps.get(env) ?? [];
  while (apps.length) await retireApp(env, apps.pop());
}

/** Refuse a fixture whose node holds anything besides `appName`. */
export async function expectHoldsOnly(env, node, appName) {
  const installed = await env.clients[node - 1].get(`/apps/installedapps?_=${Date.now()}`);
  const names = installed.data.map((a) => a.name);
  if (names.length !== 1 || names[0] !== appName) {
    throw new Error(`fixture: node ${node} holds ${JSON.stringify(names)}, not ${appName} alone`);
  }
}


/**
 * When this node stopped holding an app, by its own account. Returns the epoch
 * ms at which it was first observed gone, so a caller can measure the gap
 * between two departures.
 */
export async function whenGone(env, nodeIndex, appName, timeout) {
  await waitFor(async () => {
    const installed = await env.clients[nodeIndex - 1].get('/apps/installedapps');
    return !installed.data.map((a) => a.name).includes(appName);
  }, { timeout, label: `node ${nodeIndex} hands ${appName} back` });
  return Date.now();
}

/**
 * Put a node back in service: attested, hold cleared, settling marker torn down.
 *
 * Every test that seeds an app has to do this first, because a held node takes
 * no new apps and an EMPTY node goes straight to DOS without ever starting a
 * settling window. Both are correct, and both silently invalidate a test that
 * assumes otherwise.
 */
export async function returnToService(env, node) {
  await setSystemSecure(subnet.nodeIp(node), true);
  await waitFor(async () => (await dbClient(node).residentialMarker()) === null,
    { timeout: 120000, label: `node ${node} is back in service` });
}

/** Put the settling window in the past, so evacuation may begin this run. */
export async function elapseSettleWindow(nodeIndex) {
  await dbClient(nodeIndex).serveSettleWindow();
}

/**
 * The component names a node is running, read through a path that THROWS on an
 * unreadable answer rather than returning an empty list.
 *
 * The client returns the PARSED BODY, so the list is at res.data. An "X is
 * absent" assertion over a list that comes back empty whenever the read fails
 * cannot fail at all - which is exactly how the stand-down assertion passed
 * while the node was still writing.
 */
export async function runningComponents(env, nodeIndex) {
  const res = await env.clients[nodeIndex - 1].get('/apps/listrunningapps');
  const list = res?.status === 'success' ? res.data : null;
  if (!Array.isArray(list)) throw new Error(`listrunningapps unreadable: ${JSON.stringify(res)?.slice(0, 200)}`);
  return list.flatMap((a) => a.Names || []).map((n) => n.replace(/^\//, ''));
}

// Node 1 is the node under test: on a residential connection from the moment
// it boots, but ATTESTED, so nothing enforces against it and it takes its
// share of the work. Attestation is then withdrawn, which is the whole point
// of the staging - a node that already holds customer data and stops being
// fit to serve.
//
// It has to be done in that order. The placement hold lands within seconds of
// boot, so a node that is residential AND unattested from the start never
// takes an app at all: it is empty, and an empty target goes straight to DOS
// because there is no data at stake. Nothing would ever be evacuated.
// Attestation is also the only input re-read on every tick - geolocation is
// looked up once and then not again for three days - so it is the only lever
// that can flip a running node.
//
// Every other node is attested and in a data centre.
export const TARGET = 1;
// .12 - same published organisation as the target, but with nothing of its own
// to go on, so the table is the only thing that can decide it.
export const TABLE_DECIDED = 3;
// .14 - same published organisation again, but its own address carries hosting
// evidence, so it declines the verdict.
export const VETOING = 5;
// A second residential node, so the serialisation claim has two holders to
// serialise. Published residential like node 1, and attested until a test
// withdraws it.
export const SECOND_TARGET = 3;

/**
 * A fleet with node 1 residential and attested, the rest in a data centre, and a
 * published table that decides all of them.
 *
 * Sized by the suite: every app is seeded on every node, so the fleet's size is
 * each app's holder count, and a node owns about one handback turn in that many.
 * Five is the smallest fleet holding the three published-residential nodes the
 * classification cases read (1, 3 and 5); three holds node 1, SECOND_TARGET and a
 * data-centre node.
 * @param {object} hookCtx The before() hook's context.
 * @param {object} [opts]
 * @param {number} [opts.nodes] Fleet size.
 */
export async function bootResidentialFleet(hookCtx, { nodes = 5 } = {}) {
  const geolocation = { [TARGET]: RESIDENTIAL_GEO, [TABLE_DECIDED]: NEUTRAL_GEO, [VETOING]: HOSTING_GEO };
  const env = await createTestEnv({
    hookCtx,
    nodes,
    tickerAutostart: false,
    // Seeded through createTestEnv, not POSTed afterwards: a node looks its
    // address up once during boot, so an override applied after the fleet is
    // up is never read and the node classifies itself from the stub default.
    geolocation: Object.fromEntries(Object.entries(geolocation).filter(([node]) => Number(node) <= nodes)),
    // Two organisations across the fleet's /24, assigned round-robin by last
    // octet, and the one holding .10/.12/.14 is published residential. This is
    // the authority the fleet runs on in production - 2,303 of 2,513 hosts are
    // decided by the table rather than by their own reading - so a suite that
    // only ever exercised the fallback would be testing the path that decides
    // almost nothing.
    locationTable: {
      domains: 2,
      subnet: subnet.base,
      classes: { 0: 'residential', 1: 'hosting' },
    },
    configOverrides: {
      fluxapps: {
        // Compressed the same way every other suite compresses the interval it
        // is exercising. The production values are hours; the behaviour under
        // test is the ordering, not the wall-clock.
        // A HARNESS WORKAROUND, and deliberately not a fix.
        //
        // The node learns the chain height from a cache refreshed on this
        // interval, and processBlock then chains through every block that
        // arrived since. Only the LAST of such a burst is still the tip, so
        // only that one satisfies explorerService's `confirmations < 2` gate
        // and runs the app maintenance hung off it - including the give-up
        // pass this suite exercises.
        //
        // The harness default is 5000 against a 5000ms block, which is 1:1 -
        // and so is production, 30s blocks against a 30s poll, post-PON. The
        // race is real on a live node: blocks periodically arrive two to a
        // window and the earlier one skips maintenance silently. What the
        // harness adds is PERMANENCE - a steady two-block burst pins the
        // surviving block to one parity, and `height % 4 === 0` then never
        // lands for an entire run, so evacuation could never be observed.
        //
        // It is not fixed on this lineage because it cannot be fixed cheaply:
        // the only chain height a node holds is that same cached value, so
        // comparing against it is the identical race with an extra step, and
        // knowing the true tip needs a fresh RPC per block on every node. v9
        // solves it properly - fluxd's `hashblockheight` is pushed to
        // chainTipSource, which drives both the cached tip and the explorer
        // scan, leaving the 30s poll as a fallback only.
        //
        // So: shorten the poll here so the suite can see the path at all.
        daemonInfoIntervalMs: 1000,
        // A holder restarted inside a case keeps its app: the harness does not
        // compress a restart. Turns read signed holders, departures are signed
        // removals, and a node announces as it starts, so nothing here waits on a
        // location row expiring.
        ...PRODUCTION_LOCATION_EXPIRIES,
        residentialCheckIntervalMs: 3000,
        // The give-up pass runs every removeFluxAppsPeriod * 4 blocks, and a
        // block costs one explorerPollIntervalMs. A departure has to be VISIBLE
        // to the other holders within one pass, because one pass is what
        // separates two holders acting. Set from PASS_PERIOD_BLOCKS above.
        removeFluxAppsPeriod: PASS_PERIOD_BLOCKS,
        // Left LONG on purpose, and opened by the test when it is ready. A
        // short window would let evacuation start while the hold is still
        // being asserted, and the ordering - hold first, deletes nothing, and
        // only later gives an app up - is the property under test.
        residentialSettleMs: 600000,
        // DERIVED, never written as a literal: the turn has to hold two passes
        // and the pass is a function of explorerPollIntervalMs. coupled-knobs
        // carries the derivation and test-env asserts it on every fleet boot.
        residentialTurnMs: RESIDENTIAL_PACING.residentialTurnMs,
        residentialEvacuationIntervalMs: RESIDENTIAL_PACING.residentialEvacuationIntervalMs,
      },
    },
  });
  await bootToReady(env);
  // The verdict this suite rests on needs the PUBLISHED table, not only the
  // node's own evidence: getNetworkClassification returns null while
  // publishedClassification reports consulted:false, and the two arrive at
  // different times. The veto test waited for networkEvidence alone and then
  // asked for a classification, so on the bc5d86154 gate node 5 spent all 24 of
  // its ticks logging "no network verdict to act on yet" and the test timed out
  // against classification:null, source:null - a decision that could not be
  // reached rather than one that went the wrong way. Waited for on every node,
  // because the table is the authority the whole suite runs on.
  await Promise.all(env.clients.map((c) => waitForLocationTable(c, { domains: 2 })));
  return env;
}
