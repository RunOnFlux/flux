import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { dbClient } from '../framework/db-client.js';
import {
  advanceBlocks, driveUntil, startTicker, stopTicker, setSystemSecure, clearSystemSecure,
} from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForAppInstalled, waitForSpawnerBlocked, waitFor,
  waitForResidentialDecision,
} from '../framework/wait.js';
import { setNoPeerData, setPeerHasData, setSynced } from '../framework/syncthing-control.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { electMaster, startFdmOutage, endFdmOutage } from '../framework/fdm-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';
import {
  subnet, TARGET, TABLE_DECIDED, VETOING, SECOND_TARGET,
  bootResidentialFleet, seedApp, whenGone, returnToService, elapseSettleWindow, runningComponents,
  departureWaitMs, fleetNodes, RESIDENTIAL_PACING, PASS_MS,
} from '../framework/residential-fleet.js';
import { keysOf, turnOwner, untilOwnedTurnEndsMs } from '../framework/handback-turns.js';

describe('Residential node evacuation: classification', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await bootResidentialFleet(this);
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

    // Its own reading is UNKNOWN - no signal for, none against - so a verdict of
    // RESIDENTIAL can only have come from the table.
    const geo = await dbClient(TABLE_DECIDED).geolocation();
    expect(geo.networkEvidence.classification).to.equal('UNKNOWN');
    expect(geo.networkEvidence.evidenceFor).to.be.empty;
    expect(geo.networkEvidence.evidenceAgainst).to.be.empty;

    // Attestation alone exempts a node from enforcement, so it is withdrawn and
    // the verdict is the only thing left deciding. Node 3 is used by no later
    // test on this fleet, so it stays withdrawn.
    const client = env.clients[TABLE_DECIDED - 1];
    const anchor = client.getLastEventId();
    await setSystemSecure(subnet.nodeIp(TABLE_DECIDED), false);
    const decision = await waitForResidentialDecision(client, (d) => d.arcaneOs === false, 60000, { afterId: anchor });
    expect(decision.data.source, 'the verdict did not come from the published table').to.equal('published-table');
    expect(decision.data.classification).to.equal('RESIDENTIAL');
    expect(decision.data.enforce, 'a node the table decides residential, withdrawn, is enforced').to.equal(true);
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
});

// A FLEET OF ITS OWN, of three: node 1 draining, a data-centre node, and node 3.
// Every app is held by every node, so node 1 owns about one handback turn in three.
describe('Residential node evacuation', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await bootResidentialFleet(this, { nodes: 3 });
  });

  after(async function () {
    this.timeout(120000);
    await clearSystemSecure().catch(() => {});
    await stopTicker().catch(() => {});
    if (env) await env.teardown();
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

    await seedApp(env, 'residentapp', { instances: env.nodeCount });
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
    // Both are read from one anchor taken before the pass runs, because both
    // events are the subject: the claim is that one precedes the other. The
    // removal ends the drive; DOS follows it by about two seconds and is waited
    // for from the same anchor, so a DOS that landed first is found as surely as
    // one that lands after.
    const client = env.clients[TARGET - 1];
    const anchor = client.getLastEventId();
    const removed = () => client.getEventBuffer()
      .find((e) => e.id > anchor && e.event === 'app:removed' && e.data?.name === 'residentapp');

    // Only the removal needs blocks. DOS is applied by the residential tick on
    // its own residentialCheckIntervalMs timer, so it arrives with the chain
    // stopped - which is also why it cannot be driven for.
    const budgetMs = departureWaitMs([TARGET], env.nodeCount);
    this.timeout(budgetMs + 300000);
    await driveUntil(client, async () => removed() !== undefined, { timeoutMs: budgetMs });

    const removedEvent = removed();
    const dosEvent = await client.waitForEvent('dos:changed', (d) => d.dosState >= 100, 120000, { afterId: anchor });

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
    // the app asks for an instance on every node and every node already runs
    // it, so there is no node left that is both short of it and not held.
    // Refilling a deficit is appSpawner's 120s loop. Waited for is the departure
    // reaching the rest of the fleet: a count one short of the fleet holds
    // before anything has happened, because the leaving node is counted in it.
    const targetIp = subnet.nodeIp(TARGET);
    await waitFor(async () => {
      const current = await dbClient(2).getAppLocations('residentapp');
      return !current.map((l) => l.ip.split(':')[0]).includes(targetIp);
    }, { timeout: 240000, label: 'the departure reaches the other nodes' });

    const locations = await dbClient(2).getAppLocations('residentapp');
    expect(locations.length).to.be.at.least(env.nodeCount - 1);
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
    await seedApp(env, 'worldapp', { instances: env.nodeCount, containerData: 's:/appdata' });

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
    await waitFor(async () => (await dbClient(2).getAppLocations('worldapp')).length >= env.nodeCount,
      { timeout: 300000, label: 'worldapp reaches its instance count across the fleet' });

    // Now take the evidence away: the data was there, and no peer can be shown
    // to hold it any more. This is the state the gate exists for.
    await setNoPeerData({ folder: 'fluxworldapp_worldapp' });

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the settling window starts again' });
    await elapseSettleWindow(TARGET);

    // Drive the chain so the pass is reached deterministically, and keep
    // driving until the verdict lands: turns are cut from block time, so driving
    // a fixed few blocks races through the chain in seconds and stops long
    // before this node's turn comes round.
    await stopTicker();
    const client = env.clients[TARGET - 1];
    const anchor = client.getLastEventId();
    const since = (name, predicate) => client.getEventBuffer()
      .filter((e) => e.id > anchor && e.event === name && e.data?.appName === 'worldapp' && predicate(e.data));
    const refusals = () => since('giveUp:safety', (d) => d.safe === false);
    const budgetMs = departureWaitMs([TARGET], env.nodeCount);
    this.timeout(budgetMs + 120000);
    await driveUntil(client, async () => refusals().length > 0, { timeoutMs: budgetMs });
    await startTicker();
    const [verdict] = refusals();

    // The pass reports on every app it holds, every pass, so this proves the
    // pass RAN and wanted this app - not merely that nothing happened.
    const considered = since('giveUp:considered', (d) => d.giveUp === true && d.reason === 'EVACUATION')
      .filter((e) => e.id < verdict.id);
    expect(considered, 'no pass wanted worldapp before the gate refused it').to.not.be.empty;

    // And the gate is what stopped it. Before this, every removal path decided
    // on an instance count alone, and a count cannot tell a redundant copy from
    // the last one holding the data.
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

    // Waited on the removal event: the installed-apps record is dropped last,
    // well after it, and whenGone below waits for that.
    const client = env.clients[TARGET - 1];
    const anchor = client.getLastEventId();
    await stopTicker();
    const budgetMs = departureWaitMs([TARGET], env.nodeCount);
    this.timeout(budgetMs + 180000);
    await driveUntil(client, async () => client.getEventBuffer()
      .some((e) => e.id > anchor && e.event === 'app:removed' && e.data?.name === 'worldapp'),
    { timeoutMs: budgetMs });
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
    await seedApp(env, 'clockapp', { instances: env.nodeCount });
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
});

// A FLEET OF ITS OWN. Both holders here need a departure to actually happen, and a
// node sheds ONE app per departure interval; on the shared fleet this would sit
// behind every app the tests above left on node 1.
describe('Residential node evacuation: one holder at a time', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await bootResidentialFleet(this, { nodes: 3 });
  });

  after(async function () {
    this.timeout(120000);
    await clearSystemSecure().catch(() => {});
    await stopTicker().catch(() => {});
    if (env) await env.teardown();
  });

  it('only one residential node gives up an app at a time', async function () {
    this.timeout(900000);

    // The claim that makes the drain terminate: a departure takes the app below
    // its instance count, and every OTHER evacuating holder sees that and waits.
    // With one target node it is untestable by construction - it needs two.
    // Node 3 is published residential like node 1, so withdrawing its
    // attestation puts it in the same position.
    await returnToService(env, TARGET);

    await seedApp(env, 'sharedapp', { instances: env.nodeCount });
    await advanceBlocks(3);
    await waitFor(async () => (await dbClient(2).getAppLocations('sharedapp')).length >= env.nodeCount,
      { timeout: 300000, label: 'sharedapp reaches its instance count across the fleet' });

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await setSystemSecure(subnet.nodeIp(SECOND_TARGET), false);
    await Promise.all([TARGET, SECOND_TARGET].map((node) => waitFor(
      async () => (await dbClient(node).residentialMarker()) !== null,
      { timeout: 120000, label: `node ${node} starts its settling window` },
    )));

    // Opened together, so both nodes are evacuating through the same turns.
    await Promise.all([TARGET, SECOND_TARGET].map((node) => elapseSettleWindow(node)));

    // Whichever goes first, the other must be refused while the app is short -
    // by the pacing decision, which refuses a short app before the pass ever
    // consults appEvacuationSafety.
    const anchors = new Map([TARGET, SECOND_TARGET].map((node) => [node, env.clients[node - 1].getLastEventId()]));
    const refusals = () => [TARGET, SECOND_TARGET].flatMap((node) => env.clients[node - 1].getEventBuffer()
      .filter((e) => e.id > anchors.get(node) && e.event === 'giveUp:considered' && e.data?.appName === 'sharedapp'
        && e.data?.giveUp === false && e.data?.code === 'BELOW_INSTANCE_COUNT'));

    // Keep driving UNTIL the refusal arrives, not just until the first
    // departure. The give-up pass only runs on a block, so stopping the chain
    // the moment one node leaves means the other never gets a pass in which to
    // refuse, and the wait times out on a suite that stopped the clock itself.
    // STOP ON THE VIOLATION TOO, not only on the refusal. The property here is
    // that the second holder does NOT depart, so a run where it does has already
    // answered the question - and waiting out the full departure budget for a
    // refusal that cannot now arrive reports it as a slow box. Three sessions
    // have read this timeout as one.
    const departures = () => [TARGET, SECOND_TARGET]
      .map((node) => env.clients[node - 1].getEventBuffer()
        .filter((e) => e.event === 'giveUp:considered'
          && e.data?.appName === 'sharedapp' && e.data?.giveUp === true).length)
      .reduce((a, b) => a + b, 0);

    await stopTicker();
    const budgetMs = departureWaitMs([TARGET, SECOND_TARGET], env.nodeCount);
    this.timeout(budgetMs + 120000);
    await driveUntil(env.clients[TARGET - 1],
      async () => refusals().length > 0 || departures() >= 2,
      { timeoutMs: budgetMs });
    await startTicker();

    expect(departures(), 'both holders handed the same app back, so one-at-a-time did not hold')
      .to.be.lessThan(2);

    const [verdict] = refusals();
    expect(verdict, 'neither holder was refused while the app was short').to.not.equal(undefined);
    expect(verdict.data.code).to.equal('BELOW_INSTANCE_COUNT');
    expect(verdict.data.detail).to.contain('below its instance count');
  });
});

// A FLEET OF ITS OWN, and the reason is arithmetic.
//
// These tests need one node that is the elected primary of one app and is
// draining. Every app this suite seeds lands on every node, and evacuation gives
// up ONE app per departure interval, so on a fleet where node 1 holds other apps
// the stand-down would queue behind them.
describe('Residential node evacuation: standing down as the elected primary', function () {
  let env;
  dumpLogsOnFailure(() => env);

  // The turn primaryapp's stand-down happened in, and its pass's event id, for the test that follows it.
  let stoodDownTurn = null;
  let stoodDownPass = null;
  // The give-up pass's account of the turn it judged primaryapp on, last before `beforeId`.
  const turnBefore = (beforeId) => env.clients[TARGET - 1].getEventBuffer()
    .filter((e) => e.event === 'giveUp:turn' && e.data?.appName === 'primaryapp' && e.id < beforeId)
    .pop();

  before(async function () {
    this.timeout(600000);
    env = await bootResidentialFleet(this, { nodes: 3 });
  });

  after(async function () {
    this.timeout(120000);
    await clearSystemSecure().catch(() => {});
    await stopTicker().catch(() => {});
    if (env) await env.teardown();
  });

  it('stands down as the elected primary rather than handing the app back from under itself', async function () {
    this.timeout(900000);

    // The elected primary is the node WRITING to the volume. Handing the app
    // back from under it drops whatever it has written since the peer last
    // reported the folder complete. So it stops the component on one pass of a
    // turn it owns and removes on a later pass of a turn it owns, by which time
    // the election has given the role to a peer.
    await returnToService(env, SECOND_TARGET);
    // Node 1 too: a held node takes no new apps, so the app would never reach
    // an instance on every node.
    await returnToService(env, TARGET);

    // FDM names node 1 the primary before the app is installed, so no other
    // holder starts it first: a node FDM names does not start a component a
    // peer is already running.
    await electMaster('primaryapp', subnet.nodeIp(TARGET));

    await seedApp(env, 'primaryapp', { instances: env.nodeCount, containerData: 'g:/appdata' });
    await setSynced({ folder: 'fluxprimaryapp_primaryapp' });
    await setPeerHasData({ folder: 'fluxprimaryapp_primaryapp' });
    await advanceBlocks(3);
    await waitFor(async () => (await dbClient(2).getAppLocations('primaryapp')).length >= env.nodeCount,
      { timeout: 300000, label: 'primaryapp reaches its instance count across the fleet' });
    // Only the node running the g: component is the writer, so only it can be
    // asked to stand down.
    await waitFor(async () => (await runningComponents(env, TARGET)).includes('fluxprimaryapp_primaryapp'),
      { timeout: 300000, label: 'the elected primary is running the g: component' });

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the settling window starts' });
    await elapseSettleWindow(TARGET);

    const client = env.clients[TARGET - 1];
    const anchor = client.getLastEventId();
    const stoodDown = () => client.getEventBuffer().find((e) => e.id > anchor && e.event === 'giveUp:safety'
      && e.data?.appName === 'primaryapp' && e.data?.safe === false && e.data?.code === 'STAND_DOWN_REQUIRED');

    // This fleet is fresh: the node holds primaryapp and nothing else, so the
    // stand-down is the first thing its evacuation reaches.
    await stopTicker();
    const budgetMs = departureWaitMs([TARGET], env.nodeCount);
    this.timeout(budgetMs + 600000);
    await driveUntil(client, async () => stoodDown() !== undefined, { timeoutMs: budgetMs });
    await startTicker();

    const verdict = stoodDown();
    expect(verdict.data.code).to.equal('STAND_DOWN_REQUIRED');
    // In a turn it owns, on that turn's second pass.
    const turn = turnBefore(verdict.id);
    expect(turn?.data?.owner, JSON.stringify(turn?.data)).to.equal(keysOf([TARGET])[0]);
    expect(turn.data.previousTurn, 'stood down on the first pass of its turn').to.equal(turn.data.turn);
    stoodDownTurn = turn.data.turn;
    stoodDownPass = turn.id;

    // STANDING DOWN IS A TRANSITION, so it is read as one. The reconciler
    // publishes the desired state it sets and the reason it set it, which is
    // what two samples of container state can never be: a transition that
    // completes between the samples is invisible to them, and the only thing
    // that used to make it visible was an image that ignored SIGTERM and so
    // spent docker's whole stop grace on its way out.
    //
    // The reason is half the property. A stopped container says nothing about
    // WHY it stopped, so sampling could not tell a stand-down from a crash or
    // from a component that was never running. This can. It also names the
    // identifier, which is what stops the negative assertion below being
    // satisfied by an empty answer - `!includes(...)` over an empty list is
    // true, so a failed request or a changed shape would otherwise read as
    // "stopped" while the node is still writing.
    const desired = await env.clients[TARGET - 1].waitForEvent(
      'reconciler:desiredChanged',
      (d) => d.identifier === 'primaryapp_primaryapp' && d.state === 'stopped',
      180000,
      // ANCHORED ON THE VERDICT, because the stand-down is what this transition
      // has to have been caused by. The install stops the component too, with
      // its own reason, and that lands whenever the local lifecycle gets there -
      // after the location count this test waits on, which is a database
      // reading. Anchoring anywhere before the decision picks that one up.
      { afterId: verdict.id },
    );
    expect(desired.data.reason, 'the component stopped for some reason other than standing down')
      .to.contain('standing down');

    // The intent above, carried out. Both are worth having: the reconciler can
    // record a desired state it never applies.
    await waitFor(async () => !(await runningComponents(env, TARGET)).includes('fluxprimaryapp_primaryapp'),
      { timeout: 180000, label: 'the g: component is stopped on the standing-down node' });

    // And it must STAY stopped. appReconciler takes a g: component's desired
    // state from controllerDesired, so a stand-down that stops the container
    // without telling the controller is undone on the next sweep.
    await advanceBlocks(3);
    expect(await runningComponents(env, TARGET)).to.not.include('fluxprimaryapp_primaryapp');
  });

  it('hands the app back on a later pass of a turn it owns, and the app survives elsewhere', async function () {
    this.timeout(900000);
    expect(stoodDownTurn, 'the test above did not stand down').to.not.equal(null);

    // Runs on from the test above: node TARGET has stopped primaryapp's g:
    // component and is no longer a candidate for it, so a later pass of a turn
    // it owns finds the component not running here, re-proves a connected peer
    // holds the folder with nothing left to write, and removes.
    const client = env.clients[TARGET - 1];
    const removal = () => client.getEventBuffer().find((e) => e.event === 'app:removed' && e.data?.name === 'primaryapp');
    await stopTicker();
    // The pass it stood down on may be the last of its turn, so the budget runs to
    // the end of the next turn it owns; a later pass of the same turn comes sooner.
    const budgetMs = untilOwnedTurnEndsMs({
      holders: keysOf(fleetNodes(env)),
      owners: keysOf([TARGET]),
      turnMs: RESIDENTIAL_PACING.residentialTurnMs,
      fromMs: (stoodDownTurn + 1) * RESIDENTIAL_PACING.residentialTurnMs,
    }) + (2 * PASS_MS);
    this.timeout(budgetMs + 180000);
    await driveUntil(client, async () => removal() !== undefined, { timeoutMs: budgetMs });
    await startTicker();
    const removed = removal();

    const turn = turnBefore(removed.id);
    expect(turn?.data?.owner, JSON.stringify(turn?.data)).to.equal(keysOf([TARGET])[0]);
    expect(turn.id, 'removed on the pass it stood down on').to.be.above(stoodDownPass);
    expect(turn.data.previousTurn, 'removed on the first pass of its turn').to.equal(turn.data.turn);

    await waitFor(async () => {
      const locations = await dbClient(2).getAppLocations('primaryapp');
      return !locations.map((l) => l.ip.split(':')[0]).includes(subnet.nodeIp(TARGET));
    }, { timeout: 120000, label: 'the departure reaches the rest of the fleet' });
    const locations = await dbClient(2).getAppLocations('primaryapp');
    expect(locations.length).to.be.greaterThan(0);
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

    // Elected before the app is installed, so no other holder starts it first,
    // and while FDM is still answering: the refusal under test is a verdict
    // going STALE, not one that never existed.
    await electMaster('lockedapp', subnet.nodeIp(TARGET));

    await seedApp(env, 'lockedapp', { instances: env.nodeCount, containerData: 'g:/appdata' });
    await setSynced({ folder: 'fluxlockedapp_lockedapp' });
    await setPeerHasData({ folder: 'fluxlockedapp_lockedapp' });
    await advanceBlocks(3);
    await waitFor(async () => (await dbClient(2).getAppLocations('lockedapp')).length >= env.nodeCount,
      { timeout: 300000, label: 'lockedapp reaches its instance count across the fleet' });

    // A peer holds the folder in full, so the synced-peer loop PASSES and the
    // pass reaches the election question. That ordering is the safety property
    // this suite proves elsewhere; here it is the precondition, because a node
    // refused at the peer loop never gets far enough to refuse on the election.

    // The component has to be RUNNING here before FDM goes down. The gate
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

    // The try opens HERE rather than after the staging below. Everything between
    // the outage and the assertions can throw - the settling-marker wait carries a
    // 120s timeout - and 'refuse' closes the stub's listening socket rather than
    // answering 503, so an outage left behind is a dead socket for whatever runs
    // next. Contained today only because this is the last test in the file and the
    // stub dies with the env, and neither is a property anyone maintains on purpose.
    try {
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

      const client = env.clients[TARGET - 1];
      const anchor = client.getLastEventId();
      const unknownRefusal = () => client.getEventBuffer().find((e) => e.id > anchor && e.event === 'giveUp:safety'
        && e.data?.appName === 'lockedapp' && e.data?.safe === false && e.data?.code === 'ELECTION_UNKNOWN');

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
      const budgetMs = departureWaitMs([TARGET], env.nodeCount);
      this.timeout(budgetMs + 120000);
      await driveUntil(client, async () => unknownRefusal() !== undefined, { timeoutMs: budgetMs });
      await startTicker();

      const verdict = unknownRefusal();

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

// A FLEET OF ITS OWN, so a stood-down app stays on node 1 without delaying the
// departures the describe above waits for.
describe('Residential node evacuation: a stand-down that cannot finish', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await bootResidentialFleet(this, { nodes: 3 });
  });

  after(async function () {
    this.timeout(120000);
    await clearSystemSecure().catch(() => {});
    await stopTicker().catch(() => {});
    if (env) await env.teardown();
  });

  /**
   * Node TARGET, the elected primary of a fresh g: app, drains until it stands down.
   * @param {object} test The running test's context, given the drive's budget.
   * @param {string} appName
   */
  async function standDown(test, appName) {
    const folder = `flux${appName}_${appName}`;
    await returnToService(env, TARGET);
    await electMaster(appName, subnet.nodeIp(TARGET));
    await seedApp(env, appName, { instances: env.nodeCount, containerData: 'g:/appdata' });
    await setSynced({ folder });
    await setPeerHasData({ folder });
    await advanceBlocks(3);
    await waitFor(async () => (await dbClient(2).getAppLocations(appName)).length >= env.nodeCount,
      { timeout: 300000, label: `${appName} reaches its instance count across the fleet` });
    await waitFor(async () => (await runningComponents(env, TARGET)).includes(folder),
      { timeout: 300000, label: 'the elected primary is running the g: component' });

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the settling window starts' });
    await elapseSettleWindow(TARGET);

    const client = env.clients[TARGET - 1];
    const anchor = client.getLastEventId();
    const stoodDown = () => client.getEventBuffer().find((e) => e.id > anchor && e.event === 'giveUp:standDown'
      && e.data?.appName === appName);
    await stopTicker();
    const budgetMs = departureWaitMs([TARGET], env.nodeCount);
    test.timeout(budgetMs + 120000);
    await driveUntil(client, async () => stoodDown() !== undefined, { timeoutMs: budgetMs });
    return { event: stoodDown(), folder };
  }

  it('stands for election again once it has owned a turn since without being able to leave', async function () {
    this.timeout(900000);
    const client = env.clients[TARGET - 1];
    const { event, folder } = await standDown(this, 'releaseapp');
    // No peer holds the folder any more, so its next owned turn cannot remove.
    await setNoPeerData({ folder });
    const stoodDownTurn = client.getEventBuffer()
      .filter((e) => e.event === 'giveUp:turn' && e.data?.appName === 'releaseapp' && e.id < event.id).pop().data.turn;
    const released = () => client.getEventBuffer().find((e) => e.id > event.id && e.event === 'giveUp:standDownReleased'
      && e.data?.identifier === 'releaseapp_releaseapp');

    const budgetMs = untilOwnedTurnEndsMs({
      holders: keysOf(fleetNodes(env)),
      owners: keysOf([TARGET]),
      turnMs: RESIDENTIAL_PACING.residentialTurnMs,
      fromMs: (stoodDownTurn + 1) * RESIDENTIAL_PACING.residentialTurnMs,
    }) + RESIDENTIAL_PACING.residentialTurnMs + (2 * PASS_MS);
    this.timeout(budgetMs + 120000);
    await driveUntil(client, async () => released() !== undefined, { timeoutMs: budgetMs });
    await startTicker();

    expect(released().data.reason).to.equal('OWNED_TURN_PASSED');
    // Released in a turn after the one it owned: it had that whole turn to leave in.
    const at = client.getEventBuffer()
      .filter((e) => e.event === 'giveUp:turn' && e.data?.appName === 'releaseapp' && e.id < released().id).pop().data.turn;
    const owned = Array.from({ length: at - stoodDownTurn - 1 }, (_, i) => stoodDownTurn + 1 + i)
      .filter((turn) => turnOwner(keysOf(fleetNodes(env)), turn) === keysOf([TARGET])[0]);
    expect(owned, 'released before it owned a whole turn').to.not.be.empty;
    const installed = await client.get('/apps/installedapps');
    expect(installed.data.map((a) => a.name)).to.include('releaseapp');
  });

  it('stands for election again once the node stops evacuating', async function () {
    this.timeout(900000);
    const client = env.clients[TARGET - 1];
    const { event } = await standDown(this, 'returnapp');
    await setSystemSecure(subnet.nodeIp(TARGET), true);
    const released = () => client.getEventBuffer().find((e) => e.id > event.id && e.event === 'giveUp:standDownReleased'
      && e.data?.identifier === 'returnapp_returnapp');

    await driveUntil(client, async () => released() !== undefined, { timeoutMs: 120000 + (2 * PASS_MS) });
    await startTicker();

    expect(released().data.reason).to.equal('NOT_EVACUATING');
  });
});
