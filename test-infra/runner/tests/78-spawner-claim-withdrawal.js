import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  bootAndPeer, seedSpawnerApp, waitForInstanceCount,
  installingClaimIpsByNode, installingErrorsByNode,
} from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Withdrawing an installing claim.
//
// A node claims an app before it knows whether it is needed - the claim is what
// lets every contender see the contention - so losing that race is ordinary. It
// must then retract, because the claim lives for fifteen minutes and until it
// expires every other node counts the withdrawing node as installing: the app
// looks staffed by someone who walked away, and the nodes that should install
// it stand down.
//
// The retraction is a version 2 fluxappinstalling - the claim's own message,
// withdrawing the claim. It must NEVER be an installing error: that means an
// install was attempted and failed, it is counted and acted on as such, and a
// node standing aside attempted nothing. Counting these would make the apps
// most in demand, whose races have the most losers, look the most broken.
//
// The whole fleet shares one /16, so a synced app has one fault domain and a
// share of one however many nodes want it - exactly one node may hold it.
//
// The rival is REAL and it arrives first, rather than being raced for. Left to
// itself the fleet usually produces no contention at all: the first claim
// propagates, every other node reads the domain as full and stands aside
// BEFORE claiming, and a suite that needs losers has none. That is the share
// gate working, and it is the gate this branch added - so the better it works,
// the less often this suite has anything to measure.
//
// The contention is BUILT, not waited for, and nothing here is left to timing.
//
// A node claims, waits installCollisionWaitMs, then re-reads and ranks - the
// loser withdraws at that second read. So two nodes must both reach the claim
// before either can see the other, which is the race the fleet only sometimes
// runs on its own: whichever node claims first is visible to the rest, and the
// share gate then makes them stand aside BEFORE claiming, leaving nothing to
// withdraw. Planting a rival cannot help for the same reason - a visible rival
// is exactly what stops a node claiming.
//
// Severing the fleet removes the visibility instead. Each half holds nothing,
// so each half's first node claims; neither half can see the other's claim.
// Healing inside the collision window puts both claims in front of both nodes
// at their second read, and the loser withdraws. Every run.
//
// The window is widened from the harness default so healing lands well inside
// it - production waits 90s here and the harness compresses it to 5s, which is
// too tight to heal within.
const SIDE_A = [0, 1, 2];
const SIDE_B = [3, 4, 5];
const COLLISION_WINDOW_MS = 90 * 1000;

describe('spawner withdraws an installing claim without reporting a failure', function () {
  let env;
  let appName;
  let holder;
  dumpLogsOnFailure(() => env);

  // Every address the fleet has been told gave its claim up. The withdrawal is
  // a version 2 of the claim's own message, so it arrives on the same event and
  // names itself.
  const withdrawnIps = () => new Set(
    env.clients
      .flatMap((client) => (client ? client.getEventBuffer() : []))
      .filter((e) => e.event === 'network:appinstalling'
        && e.data?.name === appName && e.data?.withdrawn === true)
      .map((e) => e.data.ip.split(':')[0]),
  );

  before(async function () {
    this.timeout(420000);
    appName = `e2ewithdraw${Date.now()}`;
    env = await createTestEnv({
      hookCtx: this,
      nodes: 6,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          // Long enough that healing the partition lands inside every claimant's
          // window with room to spare; the ranking that follows is what this
          // suite reads.
          installCollisionWaitMs: COLLISION_WINDOW_MS,
          // Sized to the fleet as it is DURING the sever: three and three, so a
          // node reaches two addresses. The harness defaults are unreachable
          // then, and a node under them stops spawning entirely.
          minOutgoing: 2,
          minIncoming: 1,
          minUniqueIpsOutgoing: 2,
          minUniqueIpsIncoming: 1,
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 2, minInbound: 2 });
    await pushTestApp(appName);
    const app = await buildSeedableSyncthingApp({
      name: appName, mode: 'g', ports: [31171], instances: 1,
    });

    // Sever first: neither half can see the other's claim, so each half's first
    // node claims rather than standing aside.
    await env.partitionGroups(SIDE_A, SIDE_B);
    await seedSpawnerApp(env, app);

    // Both halves have claimed once two distinct claimants have been announced.
    // Read from the event stream, which reports each claim as it is stored:
    // the installing-locations endpoint clears a claim the moment its node acts
    // on it, so a poll of that misses claims that were plainly made.
    const claimants = () => new Set(
      env.clients
        .flatMap((client) => (client ? client.getEventBuffer() : []))
        .filter((e) => e.event === 'network:appinstalling'
          && e.data?.name === appName && e.data?.withdrawn !== true)
        .map((e) => e.data.ip.split(':')[0]),
    );
    await waitFor(async () => claimants().size >= 2, {
      timeout: 240000,
      interval: 2000,
      label: 'both halves of the severed fleet claimed',
    });

    // Heal while both are still inside their collision window, so the second
    // read each of them makes sees the other's claim and ranks against it.
    await env.healPartition(SIDE_A, SIDE_B);

    // one fault domain, share of one: exactly one node may hold it, and the
    // rest of the fleet claims and stands aside
    [holder] = await waitForInstanceCount(env, appName, 1, { timeout: 240000, stableMs: 15000 });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('every loser retracts its claim, and the holder keeps its own', function () {
    // Read as the network reads it: the retraction is announced, and the
    // announcement says it is one. A peer that cannot tell a withdrawal from a
    // claim stands down for a node that already walked away.
    const withdrew = withdrawnIps();

    expect(withdrew.size, 'a contended app must produce at least one withdrawal').to.be.at.least(1);
    expect(
      [...withdrew],
      'the node that installed it never withdrew',
    ).to.not.include(getSubnetConfig().nodeIp(holder + 1));
  });

  it('clears the withdrawn claim on the PEERS, not just the node that sent it', async function () {
    this.timeout(120000);
    // A claim is only harmful where other nodes can see it: their view is what
    // decides whether they stand down. A withdrawal that only cleared the
    // sender's own database would leave every peer stalled for the full TTL.
    const holderIp = getSubnetConfig().nodeIp(holder + 1);

    await waitFor(async () => {
      const perNode = await installingClaimIpsByNode(env, appName);
      return perNode.every((claims) => claims !== null
        && claims.every((ip) => ip.startsWith(holderIp)));
    }, {
      timeout: 90000,
      interval: 3000,
      label: `every node has dropped the withdrawn claims for ${appName}`,
    });

    const perNode = await installingClaimIpsByNode(env, appName);
    perNode.forEach((claims, index) => {
      expect(claims, `node ${index} answered the installing locations endpoint`).to.not.equal(null);
      claims.forEach((ip) => {
        expect(ip, `node ${index} still sees a claim from a node that withdrew`).to.have.string(holderIp);
      });
    });
  });

  it('never records a withdrawal as an install error, on any node', async function () {
    this.timeout(60000);
    // The regression this suite exists for. An installing error is counted,
    // surfaced to operators and acted on, so a withdrawal filed as one turns
    // demand into apparent failure - and the more nodes race for an app, the
    // worse it looks.
    const perNode = await installingErrorsByNode(env, appName);

    perNode.forEach((errors, index) => {
      expect(errors, `node ${index} answered the installing errors endpoint`).to.not.equal(null);
      expect(
        errors,
        `node ${index} recorded ${errors?.length} install error(s) for an app nothing failed to install: ${JSON.stringify(errors)}`,
      ).to.deep.equal([]);
    });
  });

  it('holds at one instance, so a withdrawal does not free the domain to refill', async function () {
    this.timeout(120000);
    // A withdrawal clears a claim. It must not read as "this domain is free
    // again" and let the nodes that stood aside pile back in - so the count
    // holds where the surplus sweep left it, and holds STABLE, which is what
    // catches a refill rather than a slow reclaim.
    const holders = await waitForInstanceCount(env, appName, 1, { timeout: 60000, stableMs: 30000 });
    expect(holders, 'one fault domain, share of one').to.have.lengthOf(1);
    expect(holders[0], 'the same node still holds it').to.equal(holder);

    // The nodes that withdrew are the ones a refill would come from, and none of
    // them may be holding it.
    const withdrew = withdrawnIps();
    expect([...withdrew], 'fixture: the sever must have produced a withdrawal').to.not.be.empty;
    const holderIps = holders.map((index) => getSubnetConfig().nodeIp(index + 1));
    withdrew.forEach((ip) => {
      expect(holderIps, `${ip} withdrew and then installed it anyway`).to.not.include(ip);
    });
  });
});
