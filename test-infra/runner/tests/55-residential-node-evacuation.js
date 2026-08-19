import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, allocateAppPort } from '../framework/seed-helper.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker, setSystemSecure, clearSystemSecure,
} from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold, waitForAppInstalled,
  waitForSpawnerBlocked, waitFor, waitForGiveUpConsidered, waitForGiveUpSafety,
} from '../framework/wait.js';
import { setNoPeerData, setPeerHasData, setSynced } from '../framework/syncthing-control.js';
import { electMaster } from '../framework/fdm-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A residential node is one whose network classification reaches RESIDENTIAL on
// positive evidence with nothing contradicting it. In the harness the only
// signal available is what the ip-api stub serves - 198.18.x.x has no reverse
// DNS and the stub tiers are not asymmetric enough to count - so `mobile` is the
// positive signal and every contradiction is turned off.
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
 * Drive the chain until a condition holds, at a stated RATE, up to a stated
 * deadline.
 *
 * Two reasons this drives rather than letting the ticker free-run:
 *
 * The ticker produces blocks on the same period the explorer polls on, so the
 * node learns about them in bursts and processes a burst back to back - and only
 * the last block of a burst is still the chain tip. FluxOS runs its app
 * maintenance, the give-up pass included, only for a block that was the tip and
 * only on every fourth block, so whether the pass runs at all comes down to
 * which parity the race settles on.
 *
 * And the waits here are WALL-CLOCK. A node's queue ticket is real time, so a
 * budget counted in blocks means nothing: driving flat out races through the
 * chain in milliseconds and stops long before the node's turn comes round,
 * leaving no pass in which to act. The deadline is therefore in milliseconds and
 * the rate is explicit - `blockIntervalMs` sets how fast the chain moves, which
 * is what fixes how long a give-out pass takes in wall-clock, which is what the
 * queue step has to outlast. Changing one without the other is what quietly
 * deletes the ordering these tests exist to check.
 *
 * @param {number} [opts.timeoutMs] How long to keep driving before giving up.
 * @param {number} [opts.blockIntervalMs] Minimum wall-clock between blocks.
 * @returns {Promise<number>} Blocks driven.
 */
async function driveUntil(env, nodeIndex, condition, { timeoutMs = 120000, blockIntervalMs = 200 } = {}) {
  const node = env.clients[nodeIndex - 1];
  const deadline = Date.now() + timeoutMs;
  let blocks = 0;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    if (await condition()) return blocks;
    const startedAt = Date.now();
    const afterId = node.getLastEventId();
    // eslint-disable-next-line no-await-in-loop
    await advanceBlock();
    // eslint-disable-next-line no-await-in-loop
    await node.waitForEvent('block:processed', () => true, 60000, { afterId });
    blocks += 1;
    const spent = Date.now() - startedAt;
    // eslint-disable-next-line no-await-in-loop
    if (spent < blockIntervalMs) await new Promise((resolve) => { setTimeout(resolve, blockIntervalMs - spent); });
  }
  if (await condition()) return blocks;
  throw new Error(`condition not reached in ${timeoutMs}ms (${blocks} blocks driven)`);
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
  await dbClient(nodeIndex).setResidentialSince(Date.now() - (48 * 60 * 60 * 1000));
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
          // Left LONG on purpose, and opened by the test when it is ready. A
          // short window would let evacuation start while the hold is still
          // being asserted, and the ordering - hold first, deletes nothing, and
          // only later gives an app up - is the property under test.
          residentialSettleMs: 600000,
          residentialEvacuationIntervalMs: 4000,
          residentialQueueBaseMs: 1000,
          // Position in the instance order sets a wait of base + position*step,
          // and the step is what stops two holders of the same app leaving
          // together: the second's turn has to arrive AFTER the first's
          // departure is visible to it.
          //
          // So the step only has to outlast one give-up pass plus the
          // propagation of a removal. A pass is four blocks, and driveUntil
          // paces the chain at 200ms a block, so a pass is under a second here;
          // the fluxappremoved broadcast is sub-second too. 5s is several times
          // the margin needed and caps the worst wait - last of five instances -
          // at 21s.
          //
          // Production's 15 MINUTES is that same relationship against a pass
          // that runs every 44 blocks. The ratio transfers; the number does not,
          // and copying it would add minutes per test for nothing.
          //
          // Do not shorten it below a pass. At 500ms both holders became
          // eligible within the same pass and both left - the mechanism intact,
          // the property compressed out of existence. And do not change it
          // without looking at driveUntil's blockIntervalMs, which is what fixes
          // how long a pass takes.
          residentialQueueStepMs: 5000,
          removeFluxAppsPeriod: 1,
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

    const info = await env.clients[VETOING - 1].get('/flux/info');
    expect(info.data.flux.dos.dosState).to.be.below(100);
  });

  it('leaves a residential node alone while it is still attested', async function () {
    this.timeout(300000);

    // ArcaneOS is the whole discriminator. A residential connection on its own
    // enforces nothing, and this node has to be able to take work like any
    // other - otherwise there would be nothing to evacuate later.
    const info = await env.clients[TARGET - 1].get('/flux/info');
    expect(info.data.flux.dos.dosState).to.be.below(100);

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

    // Drive the chain from here rather than letting the ticker free-run, so the
    // give-up pass is reached on a block the node processed AS the tip. See
    // driveUntil.
    await stopTicker();
    await driveUntil(env, TARGET, async () => {
      const current = await env.clients[TARGET - 1].get('/apps/installedapps');
      return !current.data.map((a) => a.name).includes('residentapp');
    });

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
    await driveUntil(env, TARGET, async () => safetyVerdict !== null);
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
    await driveUntil(env, TARGET, async () => {
      const current = await env.clients[TARGET - 1].get('/apps/installedapps');
      return !current.data.map((a) => a.name).includes('worldapp');
    });
    await startTicker();

    await whenGone(env, TARGET, 'worldapp', 120000);

    const locations = await dbClient(2).getAppLocations('worldapp');
    expect(locations.map((l) => l.ip.split(':')[0])).to.not.include(subnet.nodeIp(TARGET));
  });

  it('keeps the settling clock across a restart, so restarting cannot postpone the drain', async function () {
    this.timeout(600000);

    // The clock is persisted and measured in wall-clock precisely so that
    // bouncing FluxOS - on a cron, say - cannot keep a node permanently just
    // short of the window. An in-memory counter of agreeing ticks would reset
    // here, and this is the test that would have caught that.
    await returnToService(env, TARGET);

    // It has to be HOLDING something. An empty target goes straight to DOS -
    // there is no data at stake - and never starts a settling window at all.
    await seedApp(env, 'clockapp', { instances: 5 });
    await advanceBlocks(3);
    await waitForAppInstalled(env.clients[TARGET - 1], 'clockapp', 300000);

    await setSystemSecure(subnet.nodeIp(TARGET), false);
    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the settling window starts' });
    const before = (await dbClient(TARGET).residentialMarker()).residentialSince;

    await env.restartNode(TARGET - 1);
    await waitForDaemonReady(env.clients[TARGET - 1]);

    await waitFor(async () => (await dbClient(TARGET).residentialMarker()) !== null,
      { timeout: 120000, label: 'the marker is still there after the restart' });
    const after = (await dbClient(TARGET).residentialMarker()).residentialSince;
    expect(after).to.eql(before);
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
    for (const node of [TARGET, SECOND_TARGET]) {
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => (await dbClient(node).residentialMarker()) !== null,
        { timeout: 120000, label: `node ${node} starts its settling window` });
      // eslint-disable-next-line no-await-in-loop
      await elapseSettleWindow(node);
    }

    // Whichever goes first, the other must be refused while the app is short.
    let refusal = null;
    const refusedForBeingShort = Promise.race([TARGET, SECOND_TARGET].map((node) => waitForGiveUpSafety(
      env.clients[node - 1], 'sharedapp',
      (d) => d.safe === false && /below its instance count/.test(d.detail), 600000,
    ))).then((v) => { refusal = v; return v; });
    refusedForBeingShort.catch(() => {});

    // Keep driving UNTIL the refusal arrives, not just until the first
    // departure. The give-up pass only runs on a block, so stopping the chain
    // the moment one node leaves means the other never gets a pass in which to
    // refuse, and the wait times out on a suite that stopped the clock itself.
    await stopTicker();
    await driveUntil(env, TARGET, async () => refusal !== null);
    await startTicker();

    const verdict = await refusedForBeingShort;
    expect(verdict.data.detail).to.contain('below its instance count');
  });

  it('will not hand back a g: app while this node is its elected primary', async function () {
    this.timeout(900000);

    // The elected primary is the node WRITING to the volume. Handing the app
    // back from under it drops whatever it has written since the peer last
    // reported the folder complete, so it stands down and lets masterSlaveApps
    // elect a successor first.
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

    let primaryRefusal = null;
    const refused = waitForGiveUpSafety(env.clients[TARGET - 1], 'primaryapp',
      (d) => d.safe === false && /elected primary/.test(d.detail), 600000)
      .then((v) => { primaryRefusal = v; return v; });
    refused.catch(() => {});

    await stopTicker();
    await driveUntil(env, TARGET, async () => primaryRefusal !== null);
    await startTicker();

    const verdict = await refused;

    expect(verdict.data.detail).to.contain('elected primary');
  });
});
