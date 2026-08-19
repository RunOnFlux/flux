import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker, setSystemSecure, clearSystemSecure,
} from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold, waitForAppInstalled,
  waitForSpawnerBlocked, waitFor,
} from '../framework/wait.js';
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

async function seedApp(env, appName, { instances = 3, containerData = '/tmp' } = {}) {
  await pushImage(appName, 'v1');
  const app = await buildSeedableApp({
    name: appName,
    instances,
    compose: [{
      name: appName,
      description: 'test container',
      repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
      ports: [31111],
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
          residentialQueueStepMs: 500,
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
    this.timeout(300000);

    // The clock is persisted and wall-clock, so a node cannot restart its way
    // out of the drain. Which is also what lets the test open the gate: put the
    // start of the window far enough in the past that it has elapsed.
    const marker = await dbClient(TARGET).residentialMarker();
    expect(marker, 'the settling window should be running').to.not.be.null;

    await elapseSettleWindow(TARGET);
    await advanceBlocks(5);

    // Waited on the node's own view rather than on app:removed. That event is
    // published part-way through the uninstall - after the runtime state is
    // dropped, before the installed-apps record is - so a test that asserts on
    // the record the instant the event lands still sees the app.
    await waitFor(async () => {
      const current = await env.clients[TARGET - 1].get('/apps/installedapps');
      return !current.data.map((a) => a.name).includes('residentapp');
    }, { timeout: 240000, label: 'node 1 hands residentapp back' });
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
});
