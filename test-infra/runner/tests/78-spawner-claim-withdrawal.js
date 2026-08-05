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
// The contention is FORCED, with a partition, rather than raced for. Left to
// itself the fleet usually produces no contention at all: the first claim
// propagates, every other node reads the domain as full and stands aside
// BEFORE claiming, and a suite that needs losers has none. That is the share
// gate working, and it is the same gate this branch added - so the better it
// works, the less often this suite has anything to measure. It failed exactly
// that way once and passed the next run with nothing changed between.
//
// Split the fleet first and neither half can see the other's claim, so each
// elects and claims independently. Healing makes both claims visible at once
// and the loser must retract. The spec is seeded into every node's database
// directly, so the partition withholds only the claims, never the app.

// Three and three: the smallest split where each half still holds enough peers
// to elect and claim on its own.
const SIDE_A = [0, 1, 2];
const SIDE_B = [3, 4, 5];

describe('spawner withdraws an installing claim without reporting a failure', function () {
  let env;
  let appName;
  let holder;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    appName = `e2ewithdraw${Date.now()}`;
    env = await createTestEnv({
      hookCtx: this,
      nodes: 6,
      tickerAutostart: false,
      configOverrides: {
        // Sized to the fleet as it is DURING the partition, which is what the
        // floors have to clear: split three and three, a node reaches two
        // addresses. The harness defaults (minOutgoing 4, minUniqueIpsOutgoing 3)
        // are unreachable then, and a node below them stops spawning - so the
        // suite would sit waiting for a claim that no node is willing to make.
        fluxapps: {
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

    // Sever first, so neither half can see the other half's claim.
    await env.partitionGroups(SIDE_A, SIDE_B);
    await seedSpawnerApp(env, app);

    // Each side now elects and claims on its own view. Two distinct claimants is
    // the contention this suite is about, and the partition guarantees it rather
    // than leaving it to whether a claim propagates before its rivals look.
    await waitFor(async () => {
      const perNode = await installingClaimIpsByNode(env, appName);
      const claimants = new Set(perNode.filter(Boolean).flat().map((ip) => ip.split(':')[0]));
      return claimants.size >= 2;
    }, {
      timeout: 240000,
      interval: 2000,
      label: 'both sides of the partition claimed the app',
    });

    // Heal, and the loser is now looking at a rival claim it cannot outrank.
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
    const withdrew = env.clients
      .map((unused, index) => index)
      .filter((index) => env.nodeHasLog(index, `withdrawing installing claim for ${appName}`));

    expect(withdrew.length, 'a contended app must produce at least one withdrawal').to.be.at.least(1);
    expect(withdrew, 'the node that installed it never withdrew').to.not.include(holder);
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
    // again" and let the nodes that stood aside pile back in.
    const holders = await waitForInstanceCount(env, appName, 1, { timeout: 60000, stableMs: 30000 });
    expect(holders, 'one fault domain, share of one').to.have.lengthOf(1);
    expect(holders[0], 'the same node still holds it').to.equal(holder);
  });
});
