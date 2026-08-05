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
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
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
// The contention is BUILT, and every step of it is controlled.
//
// A node claims, waits installCollisionWaitMs, then re-reads and ranks - the
// loser withdraws at that second read. A node will not claim at all if it can
// already see someone else's claim, so a rival that arrives FIRST prevents the
// claim rather than causing a withdrawal. The rival has to arrive SECOND,
// carrying an EARLIER timestamp: nothing was visible when the node decided to
// claim, and by the time it looks again it is ranked below a contender it
// cannot outrank.
//
// A peer stub does it, because it holds a fleet key and speaks the real
// protocol - a signed fluxappinstalling that every receiver validates and
// stores through the path it uses for any peer. Its claim is then given up the
// same way, a version 2 of that message, which frees the app for a real node.
//
// Nothing here races: the suite chooses when the rival speaks and what
// timestamp it carries, inside a collision window it also chooses.
const STUB_INDEX = 6;

// Comfortably inside the widened window below, and older than the claim it has
// to outrank - production waits 90s here and the harness compresses it to 5s,
// which is too tight to answer a claim within.
const COLLISION_WINDOW_MS = 90 * 1000;
const RIVAL_BACKDATE_MS = 30 * 1000;

describe('spawner withdraws an installing claim without reporting a failure', function () {
  let env;
  let appName;
  let holder;
  dumpLogsOnFailure(() => env);

  // Every address the fleet has been told gave its claim up. The withdrawal is
  // a version 2 of the claim's own message, so it arrives on the same event and
  // names itself.
  // The addresses currently holding a claim, and those that have given one up.
  // Read latest-event-wins: a node may claim, stand down, and legitimately claim
  // again, and only its most recent word counts.
  const latestByIp = () => {
    const latest = new Map();
    env.clients
      .flatMap((client) => (client ? client.getEventBuffer() : []))
      .filter((e) => e.event === 'network:appinstalling' && e.data?.name === appName)
      .sort((a, b) => a.id - b.id)
      .forEach((e) => latest.set(e.data.ip.split(':')[0], e.data.withdrawn === true));
    return latest;
  };
  const claimantIps = () => new Set(
    [...latestByIp()].filter(([, withdrawn]) => !withdrawn).map(([ip]) => ip),
  );
  const withdrawnIps = () => new Set(
    [...latestByIp()].filter(([, withdrawn]) => withdrawn).map(([ip]) => ip),
  );

  before(async function () {
    this.timeout(420000);
    appName = `e2ewithdraw${Date.now()}`;
    env = await createTestEnv({
      hookCtx: this,
      nodes: 7,
      stubPeers: [STUB_INDEX],
      tickerAutostart: false,
      configOverrides: {
        // Long enough for the rival to answer a claim before the claimant looks
        // again; the ranking that follows is what this suite reads.
        fluxapps: { installCollisionWaitMs: COLLISION_WINDOW_MS },
      },
    });
    await bootAndPeer(env, { minOutbound: 2, minInbound: 2 });
    await pushTestApp(appName);
    const app = await buildSeedableSyncthingApp({
      // TWO instances, with the rival holding one of them. A second real node
      // then has room to claim - running plus installing is 1, under the 2 it
      // needs - so it claims without racing anyone, and the rival's older claim
      // is what leaves it surplus at the ranking. One real node installs, one
      // stands down, and the rival installs nothing, so the app ends on exactly
      // one real instance.
      name: appName, mode: 'g', ports: [31171], instances: 2,
    });
    await seedSpawnerApp(env, app);

    // Both real claims first, and the rival only after them. Two instances leave
    // room for a second node to claim without racing the first - and the rival
    // must not arrive before it, or that room is gone and it never claims.
    await waitFor(async () => claimantIps().size >= 2, {
      timeout: 240000,
      interval: 1000,
      label: 'two nodes claimed the app',
    });

    // Now the rival speaks, backdated - which pushes the junior of the two into
    // surplus at its next read, while the senior still fits.
    const rival = env.stubPeerClients.get(STUB_INDEX);
    await rival.claimApp(appName, { broadcastedAt: Date.now() - RIVAL_BACKDATE_MS });

    await waitFor(async () => withdrawnIps().size >= 1, {
      timeout: 240000,
      interval: 1000,
      label: 'the junior claimant stood down for the older claim',
    });

    // The rival holds the second slot and installs nothing, so the app settles
    // on exactly one real instance - the senior claimant.
    [holder] = await waitForInstanceCount(env, appName, 1, { timeout: 240000, stableMs: 15000 });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('the loser retracts its claim, and the holder is left holding one', function () {
    // Read as the network reads it: the retraction is announced, and the
    // announcement says it is one. A peer that cannot tell a withdrawal from a
    // claim stands down for a node that already walked away.
    //
    // Latest word per address, not "did it ever withdraw" - a node that stands
    // down and later claims again is behaving correctly, and only its most
    // recent claim decides whether peers should defer to it.
    expect([...withdrawnIps()], 'a contended app must produce a withdrawal').to.not.be.empty;
    expect(
      [...claimantIps()],
      'the node holding it is not advertising a live claim',
    ).to.include(getSubnetConfig().nodeIp(holder + 1));
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

  it('nobody else claims while the app is already covered', async function () {
    this.timeout(90000);
    // One running and the rival's claim make two, which is what the app asks
    // for. A node arriving now has nothing to add, and claiming anyway would
    // cost a broadcast, a collision wait and a retraction to learn that.
    const before = claimantIps();

    await sleepUnlessInfraDead(30000);

    const after = claimantIps();
    const fresh = [...after].filter((ip) => !before.has(ip));
    expect(fresh, `claimed an app already covered: ${fresh.join(', ')}`).to.be.empty;
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

  it('takes the app after standing down, once it is short again', async function () {
    this.timeout(300000);
    // Standing aside must not cost eligibility. The rival gives up the slot it
    // was holding, so the app is one short again - and the node that stood down
    // for it is exactly the one that should be able to take it now.
    const stoodDown = [...withdrawnIps()];
    expect(stoodDown, 'fixture: a node must have stood down first').to.not.be.empty;

    const rival = env.stubPeerClients.get(STUB_INDEX);
    await rival.withdrawApp(appName);

    const holders = await waitForInstanceCount(env, appName, 2, { timeout: 240000, stableMs: 10000 });
    const holderIps = holders.map((index) => getSubnetConfig().nodeIp(index + 1));

    expect(
      holderIps.some((ip) => stoodDown.includes(ip)),
      `a node that stood down never came back: stood down ${stoodDown.join(', ')}, holders ${holderIps.join(', ')}`,
    ).to.be.true;
  });
});
