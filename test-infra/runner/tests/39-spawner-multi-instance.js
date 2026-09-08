import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import {
  bootAndPeer, seedSpawnerApp, waitForInstanceCount,
} from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The spawner places the requested number of instances across the network by
// independent per-node self-selection (trySpawningGlobalApplication) — no central
// scheduler. Each node claims by broadcasting its installing location, and every
// contender counts those claims: once running+installing reaches minInstances the
// rest stand down. These gates prove that coordination converges to the right
// count:
//   - a coordinated subset (no overshoot) when instances < nodeCount;
//   - every node when instances == nodeCount (the deterministic floor: the backoff
//     never trips, so all nodes install).
// The contested gate carries stub rivals; the floor runs on a fleet without
// them, because a stub cannot be one of the nodes that must install.
//
// The contention in the first gate is BUILT rather than waited for.
//
// Converging on three is only a result if more than three nodes wanted the app.
// Left to itself this fleet no longer produces that: the standdown reads claims
// that are already in flight, so the fourth node to look sees three and never
// claims at all. That is the standdown working, and the better it works the less
// there is to resolve — measured at 6-9 of ten nodes claiming when this suite was
// written, and at exactly three on 2026-08-16, which is a contest that was never
// held rather than one that was lost.
//
// So rivals arrive from stub peers, and the timing that used to be hoped for is
// arranged. A rival that speaks FIRST suppresses a claim instead of contesting it
// — a node will not claim at all against a claim it can already see — so they
// speak SECOND, carrying an EARLIER timestamp: nothing was visible when the real
// nodes decided, and by the time they look again they are ranked below contenders
// they cannot outrank. Suite 78 established that ordering for a single rival.
//
// The stubs take slots 10-13 of a 14-slot fleet, so the ten real nodes are
// unchanged and only the number of contenders grows.
const STUB_INDICES = [10, 11, 12, 13];
const REAL_NODES = 10;

// Production waits 90s for a claim to be answered before ranking; the harness
// compresses it to 5s, which is too tight to land a rival inside. This is the
// window the rivals speak in, not a source of contention on its own.
const COLLISION_WINDOW_MS = 90 * 1000;
const RIVAL_BACKDATE_MS = 30 * 1000;

describe('spawner places the requested number of instances', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const subnet = getSubnetConfig();
  const stubIps = new Set(STUB_INDICES.map((i) => subnet.nodeIp(i + 1)));

  // Latest word per address, not "did it ever claim": a node may claim, stand
  // down, and legitimately claim again, and only its most recent message decides
  // whether peers defer to it.
  const latestByIp = (appName) => {
    const latest = new Map();
    env.clients
      .flatMap((client) => (client ? client.getEventBuffer() : []))
      .filter((e) => e.event === 'network:appinstalling' && e.data?.name === appName)
      .sort((a, b) => a.id - b.id)
      .forEach((e) => latest.set(e.data.ip.split(':')[0], e.data.withdrawn === true));
    return latest;
  };
  const claimantIps = (appName) => new Set(
    [...latestByIp(appName)].filter(([, withdrawn]) => !withdrawn).map(([ip]) => ip),
  );
  const withdrawnIps = (appName) => new Set(
    [...latestByIp(appName)].filter(([, withdrawn]) => withdrawn).map(([ip]) => ip),
  );
  // The stubs' own claims are the harness talking. Only a real node's decision
  // says anything about the code under test.
  const realOnly = (ips) => new Set([...ips].filter((ip) => !stubIps.has(ip)));

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      // 14 slots, four of them stubs: the ten real nodes are the fleet this
      // suite has always described, and the rivals are added beside them rather
      // than taken out of them.
      nodes: REAL_NODES + STUB_INDICES.length,
      stubPeers: STUB_INDICES,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { installCollisionWaitMs: COLLISION_WINDOW_MS },
      },
    });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('converges to exactly N instances (N < nodeCount) with no overshoot', async function () {
    this.timeout(420000);
    const appName = `e2espawnn${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableTestApp({ name: appName, instances: 3 });
    await seedSpawnerApp(env, app);

    // The real nodes commit first, on their own. The rivals must not be visible
    // yet or the third claim never happens.
    await waitFor(async () => realOnly(claimantIps(appName)).size >= 3, {
      timeout: 240000, interval: 1000, label: 'three real nodes claimed the app',
    });

    // Now the rivals speak, all older than anything already in flight, so every
    // real claimant is ranked into surplus at its next read.
    const backdatedAt = Date.now() - RIVAL_BACKDATE_MS;
    await Promise.all(STUB_INDICES.map(
      (i) => env.stubPeerClients.get(i).claimApp(appName, { broadcastedAt: backdatedAt }),
    ));

    await waitFor(async () => realOnly(withdrawnIps(appName)).size >= 1, {
      timeout: 240000, interval: 1000, label: 'a real claimant stood down for the older claims',
    });

    // Read before the rivals leave: afterwards the fleet re-claims and the
    // standdown is over.
    const contested = claimantIps(appName).size + withdrawnIps(appName).size;
    const stoodDown = [...realOnly(withdrawnIps(appName))];

    // The rivals install nothing, so they give the slots back and the fleet
    // fills them.
    await Promise.all(STUB_INDICES.map(
      (i) => env.stubPeerClients.get(i).withdrawApp(appName),
    ));

    // reaches 3 and HOLDS at exactly 3 (a late 4th would fail the stability check)
    const placed = await waitForInstanceCount(env, appName, 3, { timeout: 240000, stableMs: 15000 });
    expect(placed.length).to.equal(3);

    // The contest was real: more addresses wanted this app than it had room for.
    expect(contested, 'fixture: no more contenders than the app required').to.be.above(3);

    // And a REAL node resolved it. The stubs' claims are the harness speaking, so
    // a count of claimants proves only that the fixture ran; a real node reading
    // the ranking and giving way is the code under test.
    expect(stoodDown, 'no real node was outranked, so nothing exercised the ranking').to.not.be.empty;

    // It gave way rather than failed. A node standing aside attempted nothing,
    // and reporting it as an install error would make the apps with the most
    // contenders look the most broken.
    const errors = env.clients
      .flatMap((client) => (client ? client.getEventBuffer() : []))
      .filter((e) => e.event === 'network:appinstallingerror' && e.data?.name === appName)
      .map((e) => e.data.ip.split(':')[0]);
    expect(
      errors.filter((ip) => stoodDown.includes(ip)),
      'a node that stood aside reported an install failure it never attempted',
    ).to.be.empty;
  });

});

// A fleet of its own, with no stubs in it.
//
// The floor is "every node installs", and a stub node cannot: it holds no FluxOS,
// so it never claims and never runs anything. Leaving the rivals in this fleet
// would make the target unreachable by construction. They also cannot stand in as
// peers for the nodes that DO install - a stub answers `fluxapprequest` and
// nothing else, so a node that draws one as its app-state sync peer waits out the
// sync and never learns there is anything to place. That is what left one node
// idle here, and it is a property of the fleet's makeup rather than of the
// spawner.
describe('spawner places on every node when instances == nodeCount', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: REAL_NODES, tickerAutostart: false });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('places on every node (the deterministic floor: the backoff never trips)', async function () {
    this.timeout(300000);
    const appName = `e2espawnall${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableTestApp({ name: appName, instances: env.nodeCount });
    await seedSpawnerApp(env, app);

    const placed = await waitForInstanceCount(env, appName, env.nodeCount, { timeout: 240000, stableMs: 10000 });
    expect(placed.length).to.equal(env.nodeCount);
  });
});
