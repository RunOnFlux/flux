import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { dbClient } from '../framework/db-client.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import {
  startTicker, advanceBlock, setNodeStatus, clearAllNodeStatus,
} from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForOrchestratorState, waitForPeerThreshold, waitForAppInstalled,
  waitForPeerSetDos, waitForPeerSetDosReleased, assertNoEvent, waitFor,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { peerSetSweepsPerWindow } from '../framework/coupled-knobs.js';

const subnet = getSubnetConfig();

// THE FLEET IS THE POINT OF THIS SUITE. The rule is unit-tested down to the
// arithmetic - five dips inside two hours, the window rolling, the tally capped
// - and every one of those tests hands the service its events by hand. What no
// unit test can say is whether a peer set lost to the NETWORK produces the event
// at all, whether the node's own teardown is distinguishable from it when it
// really happens, and whether the DOS that follows actually reaches the things
// that read it. Those three are what this asks a real fleet.
//
// The count is compressed to 2 and the arithmetic is left to the unit suite: a
// fleet proves the mechanism, and driving three more collapses would only prove
// that 2 < 5 on a machine that costs a minute a collapse to ask.
const DIP_THRESHOLD = 2;

// A node alone on its side of a partition holds zero peers, which is below the
// harness's appSyncDegradedThreshold of 1 and so is a real fall edge - the same
// edge production crosses at 4, reached the same way, by having nothing left.
const ISOLATED = [0];
const REST = [1, 2, 3, 4];

// partitionGroups only returns once the cross-group sockets are GONE, and that
// wait is peer liveness. Compressed like every other cadence here;
// wsMaxMissedPongs stays at 3, because three consecutive misses is a far safer
// signal on a loaded box than one slow round trip.
const PEERS_OVERRIDE = { wsPingIntervalMs: 3000 };

/**
 * The window and the tick that sweeps it are ONE decision at two scales, so they
 * compress together or the suite measures the tick instead of the rule.
 * Production is 120 minutes against a 60-second tick; this asserts the
 * compressed pair holds the same ratio rather than trusting two literals to
 * have been edited together.
 */
function releaseKnobs(windowMinutes) {
  const ratio = peerSetSweepsPerWindow();
  const windowMs = windowMinutes * 60 * 1000;
  const evaluateMs = Math.round(windowMs / ratio);
  expect(evaluateMs, 'the compressed tick rounded to nothing').to.be.greaterThan(0);
  expect(windowMs / evaluateMs, 'the compressed pair does not hold production\'s ratio').to.equal(ratio);
  return { windowMinutes, evaluateMs, windowMs, ratio };
}

async function bootAndPeerFleet(env) {
  for (const client of env.clients) await waitForDaemonReady(client);
  await Promise.all(env.clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of env.clients) {
    await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
  }
  await env.startDiscovery();
  await waitForPeerThreshold(env.clients[0], 120000);
  await startTicker();
  await waitForOrchestratorState(env.clients[0], 'READY', 120000);
}

/**
 * Take every peer away from one node by cutting it off from the rest, and give
 * them back.
 *
 * A PARTITION RATHER THAN disconnectNode: taking the container off the network
 * takes its route to the daemon and its event stream with it, so the node stops
 * being observable at the moment it becomes interesting, and a confirmation loss
 * would arrive alongside the peer loss and produce the DELIBERATE teardown this
 * suite spends a whole block distinguishing. The iptables split leaves the node
 * daemon-confirmed and readable and removes only its peers, which is the event
 * under test and nothing else.
 */
async function collapsePeerSet(env) {
  await env.partitionGroups(ISOLATED, REST);
}

async function restorePeerSet(env) {
  await env.healPartition(ISOLATED, REST);
  await waitForPeerThreshold(env.clients[0], 120000);
}

async function seedAndWaitForInstall(env, appName) {
  await pushImage(appName, 'v1');
  const app = await buildSeedableApp({
    name: appName,
    compose: [{
      name: appName,
      description: 'test container',
      repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
      ports: [],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData: '/tmp',
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

describe('A peer set lost to the network is counted; the node\'s own teardown is not', function () {
  let env;
  let node;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      configOverrides: {
        peers: PEERS_OVERRIDE,
        // Two collapses, and a window long enough that nothing in this block can
        // age out of it - the rolling window is the unit suite's subject.
        fluxapps: { peerSetDipDosThreshold: DIP_THRESHOLD, peerSetDipWindowMinutes: 120 },
      },
    });
    await bootAndPeerFleet(env);
    [node] = env.clients;
  });

  after(async function () {
    this.timeout(60000);
    await env?.healPartition(ISOLATED, REST).catch(() => {});
    await env?.teardown();
  });

  it('reports a peer set lost to the network as not this node\'s own doing', async function () {
    this.timeout(180000);
    const anchor = node.getLastEventId();

    await collapsePeerSet(env);

    // The ENVELOPE, not the payload: waitForEvent resolves with { event, id,
    // data }, and reading a field straight off it gives undefined - which an
    // expect(...).to.not.equal(...) would happily pass.
    const fall = await node.waitForEvent('peers:belowThreshold', () => true, 120000, { afterId: anchor });
    expect(fall.data.deliberate, 'a fall caused by the network was marked as our own teardown').to.equal(false);
    await waitForOrchestratorState(node, 'DEGRADED', 60000);
  });

  it('does not take the node out of service on the first collapse', async function () {
    this.timeout(60000);
    // The canary for this negative: the collapse above is asserted to have
    // reached the service, so "no DOS" cannot be true merely because nothing
    // arrived. A threshold of 2 means one is not enough, and that is the claim.
    const falls = node.getEventBuffer()
      .filter((e) => e.event === 'peers:belowThreshold' && e.data.deliberate === false);
    expect(falls, 'no real collapse reached the node, so the absence below proves nothing').to.have.lengthOf(1);

    await assertNoEvent(node, 'peerSetStability:dos', () => true, 15000);
  });

  it('takes the node out of service on the second', async function () {
    this.timeout(300000);
    await restorePeerSet(env);
    const anchor = node.getLastEventId();

    await collapsePeerSet(env);

    const dos = await waitForPeerSetDos(node, () => true, 150000, { afterId: anchor });
    expect(dos.data.dips, 'the tally is the number of collapses inside the window').to.equal(DIP_THRESHOLD);
  });

  it('says so where an operator and the spawner both read it', async function () {
    this.timeout(60000);
    const res = await node.getDOSState();
    expect(res.status).to.equal('success');
    // 100 is the value isNodeDos() reads - the one appSpawner, appStartupManager
    // and nodeStatusMonitor all gate on. A lower number would report the reason
    // and enforce nothing.
    expect(res.data.dosState, 'the node reported a reason but not a DOS').to.equal(100);
    expect(res.data.dosMessage).to.contain('Peer set unstable');
    expect(res.data.dosMessage, 'the operator is told how many and over what window').to.match(/\d+ times/);
  });
});

describe('Losing confirmation tears the peer set down and is not counted against the node', function () {
  let env;
  let node;
  let nodeIp;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      configOverrides: {
        peers: PEERS_OVERRIDE,
        fluxapps: { peerSetDipDosThreshold: DIP_THRESHOLD, peerSetDipWindowMinutes: 120 },
      },
    });
    await bootAndPeerFleet(env);
    [node] = env.clients;
    nodeIp = subnet.nodeIp(1);
  });

  after(async function () {
    this.timeout(60000);
    await clearAllNodeStatus().catch(() => {});
    await env?.teardown();
  });

  // disconnectAll() drops every peer when confirmation goes, which crosses the
  // same threshold as an outage. nodeStatusMonitor already removes an
  // unconfirmed node's apps, so counting this here would punish one fault twice
  // - and it is the ONLY way a node empties its own peer set, so if the flag
  // were wrong in either direction this is where it shows.
  it('marks a teardown this node performed as its own doing, twice over', async function () {
    this.timeout(300000);
    const seen = [];

    for (let round = 0; round < DIP_THRESHOLD; round += 1) {
      const anchor = node.getLastEventId();
      await setNodeStatus(nodeIp, 'EXPIRED');
      await node.waitForEvent('confirmation:changed', (d) => d.confirmed === false, 60000, { afterId: anchor });
      const fall = await node.waitForEvent('peers:belowThreshold', () => true, 60000, { afterId: anchor });
      seen.push(fall.data.deliberate);

      await clearAllNodeStatus();
      await node.waitForEvent('confirmation:changed', (d) => d.confirmed === true, 60000);
      await waitForPeerThreshold(node, 120000);
    }

    // THE CANARY. Every entry here is a fall edge that genuinely fired, so the
    // negative assertion in the next test is about a rule refusing rather than
    // about nothing having happened.
    expect(seen, 'the confirmation loss did not empty the peer set at all').to.have.lengthOf(DIP_THRESHOLD);
    expect(seen.every((d) => d === true), `a teardown this node performed was reported as a network failure: ${JSON.stringify(seen)}`).to.equal(true);
  });

  it('does not take the node out of service for them', async function () {
    this.timeout(60000);
    await assertNoEvent(node, 'peerSetStability:dos', () => true, 15000);
    const res = await node.getDOSState();
    expect(res.data.dosMessage ?? '', 'our own teardowns were counted as instability').to.not.contain('Peer set unstable');
  });
});

describe('The DOS a collapsing peer set earns takes the apps off the node', function () {
  let env;
  let node;
  const appName = `e2epeerflap${Date.now()}`;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      configOverrides: {
        peers: PEERS_OVERRIDE,
        fluxapps: { peerSetDipDosThreshold: DIP_THRESHOLD, peerSetDipWindowMinutes: 120 },
      },
    });
    await bootAndPeerFleet(env);
    [node] = env.clients;
    await seedAndWaitForInstall(env, appName);
    // Node 0 specifically, because node 0 is the one this suite can isolate.
    // Waited for rather than assumed: an app that never landed here would make
    // the removal below trivially true.
    await waitForAppInstalled(node, appName, 240000);
  });

  after(async function () {
    this.timeout(60000);
    await env?.healPartition(ISOLATED, REST).catch(() => {});
    await env?.teardown();
  });

  it('removes the app once the node is out of service', async function () {
    this.timeout(600000);
    const before = await node.getInstalledApps();
    expect(before.status).to.equal('success');
    expect(
      before.data.find((a) => a.name === appName),
      'the app was not on this node to begin with, so its absence later proves nothing',
    ).to.not.be.undefined;

    const anchor = node.getLastEventId();
    await collapsePeerSet(env);
    await restorePeerSet(env);
    await collapsePeerSet(env);
    await waitForPeerSetDos(node, () => true, 180000, { afterId: anchor });

    await waitFor(async () => {
      const res = await node.getInstalledApps();
      return res.status === 'success' && !res.data.find((a) => a.name === appName);
    }, { timeout: 300000, interval: 3000, label: 'app removed after peer-set DOS' });
  });
});

describe('Coming back needs the peer set up, not merely quiet', function () {
  let env;
  let node;
  const knobs = releaseKnobs(2);
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      configOverrides: {
        peers: PEERS_OVERRIDE,
        fluxapps: {
          peerSetDipDosThreshold: DIP_THRESHOLD,
          peerSetDipWindowMinutes: knobs.windowMinutes,
          peerSetDipEvaluateMs: knobs.evaluateMs,
        },
      },
    });
    await bootAndPeerFleet(env);
    [node] = env.clients;

    const anchor = node.getLastEventId();
    await collapsePeerSet(env);
    await restorePeerSet(env);
    await collapsePeerSet(env);
    await waitForPeerSetDos(node, () => true, 180000, { afterId: anchor });
  });

  after(async function () {
    this.timeout(60000);
    await env?.healPartition(ISOLATED, REST).catch(() => {});
    await env?.teardown();
  });

  // A node out of service loses confirmation, drops every peer and then cannot
  // dip because it has none. Quiet is exactly what that node looks like, and
  // releasing on quiet would let it back in having demonstrated nothing.
  it('holds the DOS while the node still has no peers, past the whole window', async function () {
    this.timeout(600000);
    // Longer than the window by a clear margin, so a release keyed on "no dips
    // lately" would have fired inside it. Still partitioned throughout.
    await assertNoEvent(node, 'peerSetStability:released', () => true, knobs.windowMs * 1.5);

    const res = await node.getDOSState();
    expect(res.data.dosMessage ?? '', 'released while the node still had no peers').to.contain('Peer set unstable');
  });

  // The discriminator for the test above: the same wait, the only difference
  // being that the peer set is back. If this does not release, the one above was
  // passing because the tick never ran rather than because the rule held.
  it('releases once the peer set has been up for the window', async function () {
    this.timeout(600000);
    const anchor = node.getLastEventId();
    await restorePeerSet(env);

    await waitForPeerSetDosReleased(node, knobs.windowMs * 2, { afterId: anchor });

    const res = await node.getDOSState();
    expect(res.data.dosMessage ?? '', 'the slot was not given back').to.not.contain('Peer set unstable');
    expect(res.data.dosState, 'the node is still out of service').to.not.equal(100);
  });
});
