import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, allocateAppPort } from '../framework/seed-helper.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import {
  advanceBlock, advanceBlocks, driveUntil, startTicker, stopTicker, setSystemSecure, clearSystemSecure,
} from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold, waitForAppInstalled,
  waitForSpawnerBlocked, waitFor, waitForGiveUpConsidered, waitForGiveUpSafety,
  waitForResidentialDecision,
} from '../framework/wait.js';
import { setNoPeerData, setPeerHasData, setSynced } from '../framework/syncthing-control.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { electMaster, startFdmOutage, endFdmOutage } from '../framework/fdm-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import {
  derivedQueueStepMs, derivedEvacuationIntervalMs, departureCycleMs, loadSharedConfig,
} from '../framework/coupled-knobs.js';

const subnet = getSubnetConfig();

// A residential node is one whose network classification reaches RESIDENTIAL on
// positive evidence with nothing contradicting it. In the harness the only
// signal available is what the ip-api stub serves - 198.18.x.x has no reverse
// DNS and the stub tiers are not asymmetric enough to count - so `mobile` is the
// positive signal and every contradiction is turned off.
// The pacing this fleet runs on, derived once so the two knobs cannot drift
// apart - the departure interval is a function OF the queue step, and writing
// either as a literal is what broke this suite before. test-env asserts both
// relationships on every node of every fleet before boot.
const SHARED_POLL_MS = loadSharedConfig().fluxapps.explorerPollIntervalMs;
// THE PASS PERIOD, and everything about this suite's cost hangs off it. The
// give-up pass runs every `removeFluxAppsPeriod x 4` blocks, a block costs one
// explorer poll, and the queue step, the ticket tolerance and the departure
// interval are each derived from that pass in turn - so this number multiplies
// through every departure the suite makes, about six of them.
//
// At 4 it put the pass at ~13s and a departure at ~197s, and the suite spent
// twenty minutes on departures alone, blew the runner's 1800s wall clock, and
// starved two unrelated suites off the same box. At 2 the pass is ~7s and a
// departure ~99s. The lower bound is PROPAGATION, not comfort: the removal
// broadcast has to reach the other holder before its next pass, and at a
// 1-block pass (~1s) it measurably did not - the other node evaluated twice
// more before network:appremoved arrived and both holders left.
const PASS_PERIOD_BLOCKS = 2;
const RESIDENTIAL_PACING = (() => {
  const fleet = {
    removeFluxAppsPeriod: PASS_PERIOD_BLOCKS,
    explorerPollIntervalMs: SHARED_POLL_MS,
  };
  const residentialQueueStepMs = derivedQueueStepMs(fleet);
  const residentialEvacuationIntervalMs = derivedEvacuationIntervalMs({ ...fleet, residentialQueueStepMs });
  return { residentialQueueStepMs, residentialEvacuationIntervalMs };
})();

// EVERY WAIT THAT HAS TO CONTAIN A DEPARTURE IS DERIVED, not typed. A departure
// is the departure interval plus a full queue ticket served again from scratch,
// and this suite's apps run at five instances - so it is far longer than the
// four minutes driveUntil defaults to, which was written when the interval was
// four seconds. Two cycles' worth: several of these waits contain a departure
// AND the pass on which another holder reacts to it.
const DEPARTURE_WAIT_MS = 2 * departureCycleMs(
  {
    ...RESIDENTIAL_PACING,
    removeFluxAppsPeriod: PASS_PERIOD_BLOCKS,
    explorerPollIntervalMs: SHARED_POLL_MS,
    residentialQueueBaseMs: 1000,
  },
  5,
);

const RESIDENTIAL_GEO = {
  hosting: false,
  proxy: false,
  mobile: true,
  org: 'Some Reseller Ltd',
  isp: 'Consumer Access Networks',
  as: 'AS64500 Consumer Access Networks',
};

// Nothing either way: no hosting flags, no operator that sells hosting, and
// 198.18.x.x has no reverse DNS. The node's own rule reaches UNKNOWN on this,
// so whatever verdict it ends up with came from the published table.
const NEUTRAL_GEO = {
  hosting: false, proxy: false, mobile: false, org: 'Neutral Holdings', isp: 'Metro Fibre', as: 'AS64501 Metro Fibre',
};

// Hosting evidence the node can see about its OWN address, which is what lets
// it decline a published residential verdict meant for its neighbours.
const HOSTING_GEO = {
  hosting: true, proxy: false, mobile: false, org: 'Reseller', isp: 'Hetzner Online GmbH', as: 'AS24940 Hetzner Online GmbH',
};

async function bootToReady(env) {
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
 * allocateAppPort.
 */
async function seedApp(env, appName, { instances = 3, containerData = '/tmp', port = allocateAppPort() } = {}) {
  await pushImage(appName, 'v1');
  const app = await buildSeedableApp({
    name: appName,
    instances,
    compose: [{
      name: appName,
      description: 'test container',
      repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
      ports: [port],
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
  return app;
}


/**
 * When this node stopped holding an app, by its own account. Returns the epoch
 * ms at which it was first observed gone, so a caller can measure the gap
 * between two departures.
 */
async function whenGone(env, nodeIndex, appName, timeout) {
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
async function returnToService(env, node) {
  await setSystemSecure(subnet.nodeIp(node), true);
  await waitFor(async () => (await dbClient(node).residentialMarker()) === null,
    { timeout: 120000, label: `node ${node} is back in service` });
}

/** Put the settling window in the past, so evacuation may begin this run. */
async function elapseSettleWindow(nodeIndex) {
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
async function runningComponents(env, nodeIndex) {
  const res = await env.clients[nodeIndex - 1].get('/apps/listrunningapps');
  const list = res?.status === 'success' ? res.data : null;
  if (!Array.isArray(list)) throw new Error(`listrunningapps unreadable: ${JSON.stringify(res)?.slice(0, 200)}`);
  return list.flatMap((a) => a.Names || []).map((n) => n.replace(/^\//, ''));
}

describe('Residential node evacuation', function () {
  let env;
  dumpLogsOnFailure(() => env);

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
  const TARGET = 1;
  // .12 - same published organisation as the target, but with nothing of its own
  // to go on, so the table is the only thing that can decide it.
  const TABLE_DECIDED = 3;
  // .14 - same published organisation again, but its own address carries hosting
  // evidence, so it declines the verdict.
  const VETOING = 5;
  // A second residential node, so the serialisation claim has two holders to
  // serialise. Published residential like node 1, and attested until a test
  // withdraws it.
  const SECOND_TARGET = 3;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      // Seeded through createTestEnv, not POSTed afterwards: a node looks its
      // address up once during boot, so an override applied after the fleet is
      // up is never read and the node classifies itself from the stub default.
      geolocation: { [TARGET]: RESIDENTIAL_GEO, [TABLE_DECIDED]: NEUTRAL_GEO, [VETOING]: HOSTING_GEO },
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
          residentialCheckIntervalMs: 3000,
          // The give-up pass runs every removeFluxAppsPeriod * 4 blocks, and a
          // block costs one explorerPollIntervalMs. There is a three-way
          // relationship here and all three have to hold, or the serialisation
          // this suite checks cannot happen:
          //
          //   propagation  <  pass interval  <  queue step
          //
          // A departure has to be VISIBLE to the other holder by its next pass
          // (propagation < pass), and the two holders' turns have to fall on
          // different passes (pass < step). Measured: with the pass at 4 blocks
          // (~1s) the other node evaluated twice more before the
          // network:appremoved reached it - propagation lost the race, both
          // holders saw the app at full strength, and both left.
          //
          // Set from PASS_PERIOD_BLOCKS at the top of this file, which explains
          // what it costs and what bounds it from below. What it costs in wall
          // time is set by explorerPollIntervalMs, not by this number.
          removeFluxAppsPeriod: PASS_PERIOD_BLOCKS,
          // Left LONG on purpose, and opened by the test when it is ready. A
          // short window would let evacuation start while the hold is still
          // being asserted, and the ordering - hold first, deletes nothing, and
          // only later gives an app up - is the property under test.
          residentialSettleMs: 600000,
          residentialQueueBaseMs: 1000,
          // Position in the instance order sets a wait of base + position*step,
          // and the step is what stops two holders of the same app leaving
          // together: the second's turn has to arrive AFTER the first's
          // departure is visible to it.
          //
          // DERIVED, never written as a literal. The step has to outlast a pass
          // and the pass is a function of explorerPollIntervalMs - a block costs
          // one poll - so a literal here silently stops tracking the pass the
          // moment that knob moves. It did: 15000 was chosen against a pass this
          // comment called "about 4s", the poll went 250ms -> 833ms, the pass
          // went with it to ~16s, and the step ended up SHORTER than the pass.
          // Both holders then matured on the same pass and both handed the same
          // app back - the mechanism intact, the property compressed out of
          // existence, which is the defect production's own 15-minute step had.
          //
          // coupled-knobs.js carries the derivation and test-env asserts the
          // resulting ratio against production's on every fleet boot.
          residentialQueueStepMs: RESIDENTIAL_PACING.residentialQueueStepMs,
          // DERIVED too, and for a reason the 4000ms literal here could not
          // survive. A node inside its departure interval records nothing
          // against its queue tickets, so the block is what restarts them - and
          // that only works if the block outlasts the gap a ticket tolerates,
          // which IS the step. At 4000ms against a ~29s step the block stopped
          // reading as a gap: every ticket carried across it, every app was
          // instantly ready the moment the interval cleared, and two holders
          // whose blocks expired in the same pass handed back the same app
          // together. Production holds 6h against 40min and never meets it.
          //
          // It costs the suite real time - one departure per interval, and the
          // interval is now tens of seconds rather than four. That is the price
          // of the suite being able to see the property at all.
          residentialEvacuationIntervalMs: RESIDENTIAL_PACING.residentialEvacuationIntervalMs,
        },
      },
    });
    await bootToReady(env);
  });

  after(async function () {
    this.timeout(120000);
    await clearSystemSecure().catch(() => {});
    await stopTicker().catch(() => {});
    if (env) await env.teardown();
  });

  it('classifies the node RESIDENTIAL from the operator, not the registrant org', async function () {
    this.timeout(120000);

    // The node persists what it OBSERVED, not the verdict it drew from it - the
    // verdict also needs the published table, which arrives later, so it is
    // reached when asked rather than stored and left to go stale.
    await waitFor(async () => {
      const geo = await dbClient(TARGET).geolocation();
      return geo?.networkEvidence?.classification === 'RESIDENTIAL';
    }, { timeout: 90000, label: 'node 1 observes itself on an access network' });

    const geo = await dbClient(TARGET).geolocation();
    expect(geo.networkEvidence.evidenceAgainst).to.be.empty;
    expect(geo.networkEvidence.evidenceFor).to.not.be.empty;
    // The org string names a reseller. Reading it, as the old classifier did,
    // would have decided this node on the wrong field entirely.
    expect(geo.geolocation.org).to.equal('Some Reseller Ltd');
  });

  it('leaves an attested data-centre node alone', async function () {
    this.timeout(120000);

    const geo = await dbClient(2).geolocation();
    expect(geo.networkEvidence.classification).to.equal('DATACENTER');

    const info = await env.clients[1].get('/flux/info');
    expect(info.data.flux.dos.dosState).to.be.below(100);
  });

  it('takes the published verdict where the node has nothing of its own to go on', async function () {
    this.timeout(120000);

    await waitFor(async () => {
      const geo = await dbClient(TABLE_DECIDED).geolocation();
      return geo?.networkEvidence != null;
    }, { timeout: 90000, label: 'node 3 gathers its evidence' });

    const info = await env.clients[TABLE_DECIDED - 1].get('/flux/info');
    expect(info.data.flux.dos.dosState).to.be.below(100);

    // Its own reading is UNKNOWN - no signal for, none against - so a verdict of
    // RESIDENTIAL can only have come from the table.
    //
    // The dosState assertion above is guaranteed by this node's attestation and
    // establishes nothing on its own; what this test rests on is the evidence
    // below. Withdrawing the attestation to make the verdict decide, as the
    // veto test does, is not available here: node 3 is SECOND_TARGET for the
    // later drain tests and has to arrive at them attested.
    const geo = await dbClient(TABLE_DECIDED).geolocation();
    expect(geo.networkEvidence.classification).to.equal('UNKNOWN');
    expect(geo.networkEvidence.evidenceFor).to.be.empty;
    expect(geo.networkEvidence.evidenceAgainst).to.be.empty;
  });

  it('declines a published verdict its own address contradicts', async function () {
    this.timeout(120000);

    await waitFor(async () => {
      const geo = await dbClient(VETOING).geolocation();
      return geo?.networkEvidence != null;
    }, { timeout: 90000, label: 'node 5 gathers its evidence' });

    // Published residential along with its neighbours, but it can see hosting
    // evidence about itself - 213.44.137.57 on Bouygues is the live instance.
    // The veto only ever removes a node from enforcement.
    const geo = await dbClient(VETOING).geolocation();
    expect(geo.networkEvidence.evidenceAgainst).to.not.be.empty;

    // Attestation alone keeps this node below 100, so asserting only that
    // proves nothing about the veto: shouldEnforce is `residential && !arcane`,
    // and deleting the veto entirely left this test green. Withdraw the
    // attestation and the verdict is the only thing left deciding. Node 5 is
    // used by no later test, so it stays withdrawn.
    await setSystemSecure(subnet.nodeIp(VETOING), false);

    // The node now publishes what each tick concluded, so this waits for the
    // decision instead of waiting out thirty seconds and inferring it from
    // nothing having happened.
    //
    // Matched on the VERDICT, not on enforce. A veto lands the node in
    // CONFLICTED, and isResidential collapses CONFLICTED to null the same as
    // UNKNOWN and the same as no-table-consulted - so enforce alone cannot tell
    // "this node declined a published verdict about its own address" from
    // "this node has read nothing yet". source: node-veto is the assertion that
    // the veto is what did it.
    const decision = await waitForResidentialDecision(
      env.clients[VETOING - 1], (d) => d.source === 'node-veto', 60000,
    );
    expect(decision.data.classification, 'a vetoed verdict is CONFLICTED').to.equal('CONFLICTED');
    expect(decision.data.enforce, 'and CONFLICTED enforces nothing').to.equal(null);

    expect(await dbClient(VETOING).residentialMarker(), 'a vetoing node must not start a settling window').to.equal(null);
    const after = await env.clients[VETOING - 1].get('/flux/info');
    expect(after.data.flux.dos.dosState).to.be.below(100);
  });

  it('leaves a residential node alone while it is still attested', async function () {
    this.timeout(300000);

    // ArcaneOS is the whole discriminator. A residential connection on its own
    // enforces nothing, and this node has to be able to take work like any
    // other - otherwise there would be nothing to evacuate later.
    const info = await env.clients[TARGET - 1].get('/flux/info');
    expect(info.data.flux.dos.dosState).to.be.below(100);
    // A residential node that IS attested reports nothing at all. The field
    // names the staging, not the connection - otherwise every residential
    // operator running ArcaneOS reads it and asks what is wrong with their node.
    expect(info.data.flux.dosStaging).to.equal(null);

    await seedApp(env, 'residentapp', { instances: 5 });
    await advanceBlocks(3);
    await waitForAppInstalled(env.clients[TARGET - 1], 'residentapp', 240000);

    const installed = await env.clients[TARGET - 1].get('/apps/installedapps');
    expect(installed.data.map((a) => a.name)).to.include('residentapp');
  });

  it('stops taking new apps the moment attestation is withdrawn, deleting nothing', async function () {
    this.timeout(300000);

    await setSystemSecure(subnet.nodeIp(TARGET), false);

    await waitForSpawnerBlocked(env.clients[TARGET - 1], 'placement_hold', 120000);

    // The hold is immediate; nothing it already runs is touched by it, and the
    // DOS path - the one that deletes - must not have been taken.
    const info = await env.clients[TARGET - 1].get('/flux/info');
    expect(info.data.flux.dos.dosState).to.be.below(100);

    // And the node SAYS so. Without this the stage is invisible: a held node
    // takes no new apps and is otherwise indistinguishable from one that has
    // simply not been given work - and this is the stage, lasting a whole
    // settling window, where the operator can still put it right and lose
    // nothing at all.
    expect(info.data.flux.dosStaging).to.equal('HOLD');

    const installed = await env.clients[TARGET - 1].get('/apps/installedapps');
    expect(installed.data.map((a) => a.name)).to.include('residentapp');
  });

  it('hands the app back once the settling window has passed', async function () {
    this.timeout(600000);

    // The clock is persisted and wall-clock, so a node cannot restart its way
    // out of the drain. Which is also what lets the test open the gate: put the
    // start of the window far enough in the past that it has elapsed.
    const marker = await dbClient(TARGET).residentialMarker();
    expect(marker, 'the settling window should be running').to.not.be.null;

    await elapseSettleWindow(TARGET);

    // The stage moves when the WINDOW is served, before any app has moved -
    // which is the ordering the staging is built on, and the one an operator
    // reads. Asserted here rather than after the removal, so it cannot pass on a
    // stage that only appeared once the app had already gone.
    await waitFor(async () => {
      const staged = await env.clients[TARGET - 1].get('/flux/info');
      return staged?.data?.flux?.dosStaging === 'EVACUATE';
    }, { timeout: 120000, interval: 2000, label: 'the node reports it is evacuating' });

    const stillHeld = await env.clients[TARGET - 1].get('/apps/installedapps');
    expect(stillHeld.data.map((a) => a.name), 'the stage moved only after the app had gone')
      .to.include('residentapp');

    // Drive the chain from here rather than letting the ticker free-run, so the
    // give-up pass is reached on a block the node processed AS the tip. See
    // driveUntil.
    await stopTicker();
    // Read from the EVENT STREAM, not by polling two endpoints.
    //
    // What this has to establish is an ORDER: the app goes, and only then does
    // DOS land. "goes into DOS only once it holds nothing" cannot see a
    // violation on its own, because nodeStatusMonitor removes every local app
    // at DOS >= 100 - so a premature DOS empties the node and satisfies that
    // test's waits FASTER than the correct behaviour does.
    //
    // Polling cannot establish it. Two earlier forms of this check failed for
    // two different reasons: asserting DOS unconditionally fails on the correct
    // sequence, because DOS follows the departure by about two seconds and the
    // next poll sees 100 with nothing held; and gating that assertion on
    // /apps/installedapps fails because the installed-apps RECORD is dropped
    // LAST, after the runtime state - measured at 20s behind "Application
    // residentapp locally removed", which the whenGone wait below exists to
    // absorb. The endpoint says held long after the node holds nothing, and
    // `Checking 0 installed apps for image updates` in the same log says so.
    //
    // app:removed and dos:changed arrive on ONE stream with monotonic ids, so
    // comparing their ids is a fact about what happened rather than a race
    // between two reads of two different sources.
    //
    // Both waits are armed BEFORE the pass runs, because both events are the
    // subject: the claim is that one precedes the other, so neither may be
    // sampled from a buffer read at a moment of this test's choosing. An
    // earlier form read the buffer as soon as app:removed landed and found no
    // DOS at all - DOS follows the departure by about two seconds, so it had
    // not happened yet. Awaiting both is what makes the comparison meaningful
    // rather than a race against whichever arrived first.
    const removal = env.clients[TARGET - 1].waitForEvent(
      'app:removed', (d) => d.name === 'residentapp', 300000,
    );
    const dosLanded = env.clients[TARGET - 1].waitForEvent(
      'dos:changed', (d) => d.dosState >= 100, 300000,
    );

    // Only the removal needs blocks. DOS is applied by the residential tick on
    // its own residentialCheckIntervalMs timer, so it arrives with the chain
    // stopped - which is also why it cannot be driven for.
    await driveUntil(env.clients[TARGET - 1], async () => {
      const buffer = env.clients[TARGET - 1].getEventBuffer();
      return buffer.some((e) => e.event === 'app:removed' && e.data?.name === 'residentapp');
    }, { timeoutMs: DEPARTURE_WAIT_MS });

    const [removedEvent, dosEvent] = await Promise.all([removal, dosLanded]);

    // One stream, monotonic ids, so this is an ordering fact rather than two
    // polls of two sources that disagree about what happened first.
    expect(dosEvent.id, 'DOS landed before the app was handed back')
      .to.be.above(removedEvent.id);

    // The node's own view, not app:removed - that event is published part-way
    // through the uninstall, after the runtime state is dropped and before the
    // installed-apps record is, so asserting on the record when it lands still
    // finds the app.
    await whenGone(env, TARGET, 'residentapp', 120000);
    await startTicker();
  });

  it('the app survives the departure on every other host', async function () {
    this.timeout(300000);

    // The point of the whole design: the app is still on the network. PR #1784
    // as originally written deleted this node's copy along with everything else
    // it held, and for an app whose every instance sat on residential nodes
    // that was the last copy.
    //
    // The replacement itself is not asserted here and cannot be on this fleet:
    // the app asks for five instances and all five nodes already ran it, so
    // there is no node left that is both short of it and not held. Refilling a
    // deficit is appSpawner's existing 120s loop, unchanged by this branch.
    // Wait for what is actually being asserted - the departure reaching the
    // rest of the fleet. Waiting on a COUNT was meaningless here: the app was
    // already at five instances including the one leaving, so `>= 4` was
    // satisfied before anything had happened.
    const targetIp = subnet.nodeIp(TARGET);
    await waitFor(async () => {
      const current = await dbClient(2).getAppLocations('residentapp');
      return !current.map((l) => l.ip.split(':')[0]).includes(targetIp);
    }, { timeout: 240000, label: 'the departure reaches the other nodes' });

    const locations = await dbClient(2).getAppLocations('residentapp');
    expect(locations.length).to.be.at.least(4);
  });

  it('goes into DOS only once it holds nothing', async function () {
    this.timeout(300000);

    await waitFor(async () => {
      const installed = await env.clients[TARGET - 1].get('/apps/installedapps');
      return installed.data.length === 0;
    }, { timeout: 240000, label: 'node 1 empties' });

    await waitFor(async () => {
      const info = await env.clients[TARGET - 1].get('/flux/info');
      return info.data.flux.dos.dosState >= 100;
    }, { timeout: 120000, label: 'node 1 enters DOS after emptying' });

    const info = await env.clients[TARGET - 1].get('/flux/info');
    expect(info.data.flux.dos.dosMessage).to.contain('Residential node not running ArcaneOS');
  });

  it('releases the node the moment it becomes attested', async function () {
    this.timeout(300000);

    await setSystemSecure(subnet.nodeIp(TARGET), true);

    await waitFor(async () => {
      const info = await env.clients[TARGET - 1].get('/flux/info');
      return info.data.flux.dos.dosState < 100;
    }, { timeout: 120000, label: 'node 1 leaves DOS after migrating to ArcaneOS' });

    // And the settling window is torn down with it, so a node that flips back
    // serves the full window again rather than resuming a part-served one.
    await waitFor(async () => {
      const marker = await dbClient(TARGET).residentialMarker();
      return marker === null;
    }, { timeout: 60000, label: 'the settling marker is torn down with the verdict' });
  });

  it('will not hand back a stateful app while no peer demonstrably holds its data', async function () {
    this.timeout(600000);

    // worldapp mounts s:, so its volume IS the product - the shape of the ten
    // Palworld and Minecraft worlds on the real fleet, which sit at exactly two
    // instances. Nothing reports holding a copy of it.
    await seedApp(env, 'worldapp', { instances: 5, containerData: 's:/appdata' });

    // A synced folder has to be DECLARED before the app can run. The stub's
    // default for a folder nobody has spoken about is "no evidence", and a
    // sync-mounted component does not start against that - so without this the
    // app installs nowhere and never reaches an instance count at all.
    await setSynced({ folder: 'fluxworldapp_worldapp' });
    await setPeerHasData({ folder: 'fluxworldapp_worldapp' });

    await advanceBlocks(3);
    await waitForAppInstalled(env.clients[TARGET - 1], 'worldapp', 300000);

    // Let it reach full strength before enforcing. The pass refuses to act on an
    // app that is already short - that is the serialisation gate, and it fires
    // BEFORE the data check, so a test that starts too early proves nothing
    // about the data check at all.
    await waitFor(async () => (await dbClient(2).getAppLocations('worldapp')).length >= 5,
      { timeout: 300000, label: 'worldapp reaches its instance count across the fleet' });

    // Now take the evidence away: the data was there, and no peer can be shown
    // to hold it any more. This is the state the gate exists for.
    await setNoPeerData({ folder: 'fluxworldapp_worldapp' });

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the settling window starts again' });
    await elapseSettleWindow(TARGET);

    // Drive the chain so the pass is reached deterministically, and keep
    // driving until the verdict lands: the queue ticket is WALL-CLOCK, so
    // driving a fixed few blocks races through the chain in seconds and stops
    // long before this node's turn comes round.
    await stopTicker();
    let safetyVerdict = null;
    const considered = waitForGiveUpConsidered(env.clients[TARGET - 1], 'worldapp',
      (d) => d.giveUp === true && d.reason === 'EVACUATION', 300000);
    considered.catch(() => {});
    const refused = waitForGiveUpSafety(env.clients[TARGET - 1], 'worldapp',
      (d) => d.safe === false, 300000).then((v) => { safetyVerdict = v; return v; });
    refused.catch(() => {});
    await driveUntil(env.clients[TARGET - 1], async () => safetyVerdict !== null,
      { timeoutMs: DEPARTURE_WAIT_MS });
    await startTicker();

    // The pass reports on every app it holds, every pass, so this proves the
    // pass RAN and wanted this app - not merely that nothing happened.
    await considered;

    // And the gate is what stopped it. Before this, every removal path decided
    // on an instance count alone, and a count cannot tell a redundant copy from
    // the last one holding the data.
    const verdict = await refused;
    expect(verdict.data.detail).to.contain('fluxworldapp_worldapp');

    const installed = await env.clients[TARGET - 1].get('/apps/installedapps');
    expect(installed.data.map((a) => a.name)).to.include('worldapp');
  });

  it('hands the stateful app back once a peer holds it in full', async function () {
    this.timeout(600000);

    // The same node, the same pass, the same app - the only thing that changed
    // is that a connected peer now reports the folder complete. That contrast
    // is what shows the refusal above was the gate deciding rather than the
    // node simply being slow.
    await setPeerHasData({ folder: 'fluxworldapp_worldapp' });

    await stopTicker();
    await driveUntil(env.clients[TARGET - 1], async () => {
      const current = await env.clients[TARGET - 1].get('/apps/installedapps');
      return !current.data.map((a) => a.name).includes('worldapp');
    }, { timeoutMs: DEPARTURE_WAIT_MS });
    await startTicker();

    await whenGone(env, TARGET, 'worldapp', 120000);

    const locations = await dbClient(2).getAppLocations('worldapp');
    expect(locations.map((l) => l.ip.split(':')[0])).to.not.include(subnet.nodeIp(TARGET));
  });

  it('keeps the settling clock across a restart, so restarting cannot postpone the drain', async function () {
    this.timeout(600000);

    // The clock is persisted precisely so that bouncing FluxOS - on a cron, say
    // - cannot keep a node permanently just short of the window. An in-memory
    // counter of agreeing ticks would reset here, and this is the test that
    // would have caught that.
    //
    // What the window counts is time the node OBSERVED the verdict, not time
    // that elapsed, so the total observed is the half that has to survive: a
    // first-seen timestamp surviving a restart proves nothing on its own now.
    await returnToService(env, TARGET);

    // It has to be HOLDING something. An empty target goes straight to DOS -
    // there is no data at stake - and never starts a settling window at all.
    await seedApp(env, 'clockapp', { instances: 5 });
    await advanceBlocks(3);
    await waitForAppInstalled(env.clients[TARGET - 1], 'clockapp', 300000);

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the settling window starts' });
    // Let it confirm at least twice, so there is observed time to lose.
    await waitFor(async () => ((await dbClient(TARGET).residentialMarker()).observedMs || 0) > 0,
      { timeout: 120000, label: 'the node has accrued observed time' });
    const before = await dbClient(TARGET).residentialMarker();

    await env.restartNode(TARGET - 1);
    await waitForDaemonReady(env.clients[TARGET - 1]);

    // Positive evidence that the restarted node's residential service has run,
    // not just that mongo still holds a document. Mongo is a separate container
    // and restartNode restarts only FluxOS, so the marker survives whatever the
    // node does; and waitFor evaluates its condition on the first iteration, so
    // "the marker is still there" returned immediately and compared two reads
    // of a row nothing was required to touch. The service's only writer sits
    // behind nodeReady, which is raised by SPAWNER_READY - and the placement
    // hold is published by the same pass that would rewrite the marker.
    await waitForSpawnerBlocked(env.clients[TARGET - 1], 'placement_hold', 180000);
    const after = await dbClient(TARGET).residentialMarker();
    expect(after.residentialSince).to.eql(before.residentialSince);
    // The restart cost it nothing it had already watched.
    expect(after.observedMs).to.be.at.least(before.observedMs);
  });

  it('only one residential node gives up an app at a time', async function () {
    this.timeout(900000);

    // The claim that makes the drain terminate: a departure takes the app below
    // its instance count, and every OTHER evacuating holder sees that and waits.
    // With one target node it is untestable by construction - it needs two.
    // Node 3 is published residential like node 1, so withdrawing its
    // attestation puts it in the same position.
    await returnToService(env, TARGET);

    await seedApp(env, 'sharedapp', { instances: 5 });
    await advanceBlocks(3);
    await waitFor(async () => (await dbClient(2).getAppLocations('sharedapp')).length >= 5,
      { timeout: 300000, label: 'sharedapp reaches its instance count across the fleet' });

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await setSystemSecure(subnet.nodeIp(SECOND_TARGET), false);
    await Promise.all([TARGET, SECOND_TARGET].map((node) => waitFor(
      async () => (await dbClient(node).residentialMarker()) !== null,
      { timeout: 120000, label: `node ${node} starts its settling window` },
    )));

    // Opened TOGETHER, not one after the other. The queue ticket is
    // `observed >= base + position*step`, and `observed` starts when a node
    // first sees the app whole - so it fixes a different DURATION per node, not
    // a different deadline. Open the two windows a few seconds apart and the
    // later start with the shorter wait lands on the same instant as the earlier
    // start with the longer one, both nodes decide in the same pass, and the
    // ordering the test exists to prove is gone. In production both holders
    // start observing together, which is what makes position decide.
    await Promise.all([TARGET, SECOND_TARGET].map((node) => elapseSettleWindow(node)));

    // Whichever goes first, the other must be refused while the app is short.
    //
    // Read from the PACING decision, not the safety gate. The strength test sits
    // in the queue ticket now - an app short of its count accrues nothing
    // towards its turn - so a short app is refused before the pass ever consults
    // appEvacuationSafety, and the safety event this used to wait on is never
    // published. The refusal itself is unchanged, and it carries the same name
    // for the same fact one layer up.
    let refusal = null;
    const refusedForBeingShort = Promise.race([TARGET, SECOND_TARGET].map((node) => waitForGiveUpConsidered(
      env.clients[node - 1], 'sharedapp',
      (d) => d.giveUp === false && d.code === 'BELOW_INSTANCE_COUNT', 600000,
    ))).then((v) => { refusal = v; return v; });
    refusedForBeingShort.catch(() => {});

    // Keep driving UNTIL the refusal arrives, not just until the first
    // departure. The give-up pass only runs on a block, so stopping the chain
    // the moment one node leaves means the other never gets a pass in which to
    // refuse, and the wait times out on a suite that stopped the clock itself.
    await stopTicker();
    await driveUntil(env.clients[TARGET - 1], async () => refusal !== null,
      { timeoutMs: DEPARTURE_WAIT_MS });
    await startTicker();

    const verdict = await refusedForBeingShort;
    expect(verdict.data.code).to.equal('BELOW_INSTANCE_COUNT');
    expect(verdict.data.detail).to.contain('below its instance count');
  });

  it('serves a fresh queue turn after a departure, not one that matured during it', async function () {
    this.timeout(900000);

    // The ticket is the only thing separating two holders of one app, and it
    // separates them only while it is still binding. A node inside its
    // departure interval cannot act on anything, so time passing there is not
    // evidence about any app it holds - but the ticket used to keep maturing
    // through the block anyway, and the node came out of it instantly ready for
    // everything at once. Two holders whose blocks expire in the same pass -
    // and the pass is fired from a block height, so the whole fleet runs it
    // together - then hand back the same app in the same pass, both read it at
    // full strength, and both delete.
    //
    // Written as ONE node's second departure rather than two nodes colliding:
    // the collision needs both blocks to expire on the same pass, which is a
    // coincidence to arrange and a tautology to assert. What actually fixes it
    // is that a departure restarts the queue, and that is directly observable.
    await returnToService(env, TARGET);
    await returnToService(env, SECOND_TARGET);

    await seedApp(env, 'firstout', { instances: 5 });
    await seedApp(env, 'secondout', { instances: 5 });
    await advanceBlocks(3);
    await waitFor(async () => {
      const first = await dbClient(2).getAppLocations('firstout');
      const second = await dbClient(2).getAppLocations('secondout');
      return first.length >= 5 && second.length >= 5;
    }, { timeout: 300000, label: 'both apps reach their instance count across the fleet' });

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the settling window starts' });
    await elapseSettleWindow(TARGET);

    const client = env.clients[TARGET - 1];
    const seeded = ['firstout', 'secondout'];
    const wentFirst = (e) => e.event === 'app:removed' && seeded.includes(e.data?.name);

    await stopTicker();
    await driveUntil(env.clients[TARGET - 1], async () => client.getEventBuffer().some(wentFirst),
      { timeoutMs: DEPARTURE_WAIT_MS });
    const gone = client.getEventBuffer().filter(wentFirst).pop();
    const remaining = gone.data.name === 'firstout' ? 'secondout' : 'firstout';

    // Through the block every pass refuses with 'next departure in'. The first
    // time it says 'its turn is in' AFTER that departure, the block has cleared
    // and the ticket has started over - which is the claim. On the accounting
    // this replaces the ticket had matured inside the block, so the same pass
    // removed the second app instead and this never arrives.
    const turnRestarted = (e) => e.event === 'giveUp:considered'
      && e.data?.appName === remaining
      && e.data?.giveUp === false
      && /its turn is in/.test(e.data?.detail || '')
      && e.id > gone.id;

    await driveUntil(env.clients[TARGET - 1], async () => client.getEventBuffer().some(turnRestarted),
      { timeoutMs: DEPARTURE_WAIT_MS });
    await startTicker();

    // One stream, monotonic ids: the second app was still waiting its turn on a
    // pass that came after the first one left, rather than leaving with it.
    const verdict = client.getEventBuffer().filter(turnRestarted).pop();
    expect(verdict, `${remaining} never served a fresh turn after the departure`).to.not.be.undefined;
    expect(client.getEventBuffer().some(
      (e) => e.event === 'app:removed' && e.data?.name === remaining && e.id < verdict.id,
    ), `${remaining} left during the departure interval instead of serving a turn`).to.equal(false);
  });

  it('stands down as the elected primary rather than handing the app back from under itself', async function () {
    this.timeout(900000);

    // The elected primary is the node WRITING to the volume. Handing the app
    // back from under it drops whatever it has written since the peer last
    // reported the folder complete. So it stops the component first and asks
    // again next pass, by which time the election has given the role to a peer.
    await returnToService(env, SECOND_TARGET);
    // Node 1 too - it is still held from the previous test, and a held node
    // takes no new apps, so the app would reach four instances and never five.
    await returnToService(env, TARGET);

    await seedApp(env, 'primaryapp', { instances: 5, containerData: 'g:/appdata' });
    await setSynced({ folder: 'fluxprimaryapp_primaryapp' });
    await setPeerHasData({ folder: 'fluxprimaryapp_primaryapp' });
    await advanceBlocks(3);
    await waitFor(async () => (await dbClient(2).getAppLocations('primaryapp')).length >= 5,
      { timeout: 300000, label: 'primaryapp reaches its instance count across the fleet' });

    // FDM names node 1 the primary, which is what masterSlaveApps reads.
    await electMaster('primaryapp', subnet.nodeIp(TARGET));

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the settling window starts' });
    await elapseSettleWindow(TARGET);

    let standDownVerdict = null;
    const stoodDown = waitForGiveUpSafety(env.clients[TARGET - 1], 'primaryapp',
      (d) => d.safe === false && d.code === 'STAND_DOWN_REQUIRED', 600000)
      .then((v) => { standDownVerdict = v; return v; });
    stoodDown.catch(() => {});

    await stopTicker();
    await driveUntil(env.clients[TARGET - 1], async () => standDownVerdict !== null,
      { timeoutMs: DEPARTURE_WAIT_MS });
    await startTicker();

    const verdict = await stoodDown;
    expect(verdict.data.code).to.equal('STAND_DOWN_REQUIRED');

    // The container is what "standing down" means, and this assertion has to be
    // able to FAIL. Read through a helper that throws on an unreadable answer:
    // `!names.some(...)` over an empty list is true, so a failed request or a
    // shape that does not match reads as "stopped" and the test passes while the
    // node is still writing. It did exactly that on the first run here.
    // Positive control: the component must be running here NOW, or the wait
    // below proves nothing about a stop.
    expect(await runningComponents(env, TARGET)).to.include('fluxprimaryapp_primaryapp');

    await waitFor(async () => !(await runningComponents(env, TARGET)).includes('fluxprimaryapp_primaryapp'),
      { timeout: 180000, label: 'the g: component is stopped on the standing-down node' });

    // And it must STAY stopped. appReconciler takes a g: component's desired
    // state from controllerDesired, so a stand-down that stops the container
    // without telling the controller is undone on the next sweep.
    await advanceBlocks(3);
    expect(await runningComponents(env, TARGET)).to.not.include('fluxprimaryapp_primaryapp');
  });

  it('hands the app back on the pass after standing down, and the app survives elsewhere', async function () {
    this.timeout(900000);

    // Runs on from the test above: node TARGET has stopped primaryapp's g:
    // component and is no longer a candidate for it, so the next pass finds the
    // component not running here, re-proves a connected peer holds the folder
    // with nothing left to write, and removes.
    await waitFor(async () => {
      const locations = await dbClient(2).getAppLocations('primaryapp');
      return !locations.map((l) => l.ip.split(':')[0]).includes(subnet.nodeIp(TARGET));
    }, { timeout: 600000, label: 'the standing-down node hands primaryapp back' });

    const locations = await dbClient(2).getAppLocations('primaryapp');
    expect(locations.length).to.be.greaterThan(0);
    expect(locations.map((l) => l.ip.split(':')[0])).to.not.include(subnet.nodeIp(TARGET));
  });

  it('will not hand back a g: app it is running while no FDM can name the primary', async function () {
    this.timeout(900000);

    // The other half of the same question, and the one that used to answer
    // "safe". An election that has NOT RUN and an election that named another
    // node were the same answer - false - and the gate deleted the volume on
    // it. Every other unavailable input in that gate refuses.
    //
    // SEEDS ITS OWN APP. This used to run on from the stand-down tests, on the
    // strength of node TARGET still holding primaryapp and still being its
    // primary - but that state only ever existed because the stand-down was
    // BROKEN: the container was stopped and the reconciler started it again, so
    // the node could never hand the app back and stayed primary indefinitely.
    // With the stand-down working the app leaves, nothing considers it again,
    // and the refusal under test is unreachable - the test was passing on the
    // defect. A scenario a test depends on is a scenario it has to build.
    await returnToService(env, TARGET);

    await seedApp(env, 'lockedapp', { instances: 5, containerData: 'g:/appdata' });
    await setSynced({ folder: 'fluxlockedapp_lockedapp' });
    await setPeerHasData({ folder: 'fluxlockedapp_lockedapp' });
    await advanceBlocks(3);
    await waitFor(async () => (await dbClient(2).getAppLocations('lockedapp')).length >= 5,
      { timeout: 300000, label: 'lockedapp reaches its instance count across the fleet' });

    // A peer holds the folder in full, so the synced-peer loop PASSES and the
    // pass reaches the election question. That ordering is the safety property
    // this suite proves elsewhere; here it is the precondition, because a node
    // refused at the peer loop never gets far enough to refuse on the election.

    // Elected while FDM is still answering. The refusal under test is a verdict
    // going STALE, not one that never existed, so the node has to have reached
    // one before the outage starts.
    await electMaster('lockedapp', subnet.nodeIp(TARGET));

    // And the component has to be RUNNING here before FDM goes down. The gate
    // asks the election question only of a node running the g: component - a
    // node not running it cannot be the writer - so without this the pass
    // answers SYNCED_ELSEWHERE and hands the app back, which is correct and
    // tests nothing. masterSlaveApps only starts the component because FDM
    // named this node, so taking FDM down first means it never starts at all.
    await waitFor(async () => (await runningComponents(env, TARGET)).includes('fluxlockedapp_lockedapp'),
      { timeout: 300000, label: 'the elected primary is running the g: component' });

    // The stub closes its listening socket, not an empty ips array. An empty
    // array is FDM ANSWERING that nobody is primary; this is nobody answering,
    // and a refused connection is the signature a real FDM outage carries - the
    // error reaches the node with no response on it at all. The gate is allowed
    // to act on the first and must not act on the second.
    await startFdmOutage('refuse');

    // THE ORDER HERE IS THE TEST. The verdict has to go stale BEFORE the node
    // starts draining, and it is the stand-down that makes that so: a draining
    // node that still remembers being primary now hands the app over and
    // leaves, so the verdict never survives long enough to expire. Withdrawing
    // attestation first - which is what this test used to inherit from the
    // stand-down tests before them - reaches STAND_DOWN_REQUIRED instead, and
    // ELECTION_UNKNOWN becomes unreachable.
    //
    // Waited rather than observed, because staleness has no external signal:
    // primaryElectionCheckedAt is refreshed only where FDM ANSWERED, so with
    // no region answering at all nothing touches it and it ages out on wall clock.
    // Derived from the knob it is a multiple of, never written as a literal -
    // PRIMARY_ELECTION_STALE_MS is masterSlaveIntervalMs x 10, and the harness
    // compresses that knob to 3s, so this costs ~30s here and tracks the knob
    // if it moves. One extra cycle of margin so the expiry is past, not level.
    const electionCycleMs = loadSharedConfig().fluxapps.masterSlaveIntervalMs;
    await sleepUnlessInfraDead((electionCycleMs * 10) + electionCycleMs);

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the settling window starts' });
    await elapseSettleWindow(TARGET);

    try {
      let unknownRefusal = null;
      const refused = waitForGiveUpSafety(env.clients[TARGET - 1], 'lockedapp',
        (d) => d.safe === false && d.code === 'ELECTION_UNKNOWN', 600000)
        .then((v) => { unknownRefusal = v; return v; });
      refused.catch(() => {});

      // Driven from the start rather than after a sleep. The verdict has to age
      // past PRIMARY_ELECTION_STALE_MS before the gate reports ELECTION_UNKNOWN,
      // and until it does the pass refuses with ELECTION_PRIMARY instead - so
      // the passes in between are not wasted, they are the evidence that the
      // node kept answering from what it knew while FDM was up. Waiting for the
      // refusal to change rather than sleeping for the window means the test
      // ends when the property holds, not when a timer says it should.
      //
      // That window is ten election cycles derived from masterSlaveIntervalMs,
      // which the harness already compresses 10x to 3s - so this costs ~30s and
      // shortening it means compressing masterSlaveIntervalMs further, which
      // has its own couplings to check first.
      await stopTicker();
      await driveUntil(env.clients[TARGET - 1], async () => unknownRefusal !== null,
      { timeoutMs: DEPARTURE_WAIT_MS });
      await startTicker();

      const verdict = await refused;

      expect(verdict.data.code).to.equal('ELECTION_UNKNOWN');
      expect(verdict.data.detail).to.contain('cannot say who is primary');
      // And the app is still here. A refusal that let the removal through
      // anyway would satisfy the assertions above and lose the volume.
      const stillInstalled = await env.clients[TARGET - 1].get('/apps/installedapps');
      expect(stillInstalled.data.map((a) => a.name)).to.include('lockedapp');
    } finally {
      await endFdmOutage();
    }
  });
});
