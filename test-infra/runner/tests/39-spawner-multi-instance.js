import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import {
  bootAndPeer, seedSpawnerApp, waitForInstanceCount,
} from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The spawner places the requested number of instances across the network by
// independent per-node self-selection (trySpawningGlobalApplication) — no central
// scheduler. Each node sees the app as missing-instances, races to install while
// broadcasting its installing location so others coordinate via the
// running+installing > minInstances backoff. These gates prove that coordination
// converges to the right count:
//   - a coordinated subset (no overshoot) when instances < nodeCount;
//   - every node when instances == nodeCount (the deterministic floor: the backoff
//     never trips, so all nodes install).
// Both apps run in one fleet on distinct ports so they don't contend.

describe('spawner places the requested number of instances', function () {
  let env;
  dumpLogsOnFailure(() => env);

  // Every address the fleet was told is claiming this app, read from the event
  // stream every node publishes. A claim is what makes convergence a contest:
  // if no more nodes claim than the app needs, the resolver has nothing to
  // resolve and a green result says nothing about whether it works.
  const claimantIps = (appName) => new Set(
    env.clients
      .flatMap((client) => (client ? client.getEventBuffer() : []))
      .filter((e) => e.event === 'network:appinstalling'
        && e.data?.name === appName
        && e.data?.withdrawn !== true)
      .map((e) => e.data.ip.split(':')[0]),
  );

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('converges to exactly N instances (N < nodeCount) with no overshoot', async function () {
    this.timeout(150000);
    const appName = `e2espawnn${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableTestApp({ name: appName, instances: 3, port: 31111 });
    await seedSpawnerApp(env, app);

    // reaches 3 and HOLDS at exactly 3 (a late 4th would fail the stability check)
    const placed = await waitForInstanceCount(env, appName, 3, { timeout: 120000, stableMs: 15000 });
    expect(placed.length).to.equal(3);

    // Converging on three is only a result if more than three nodes wanted the
    // app. With no more claimants than instances the resolver had nothing to
    // decide, and a green result would say nothing about whether it works - so
    // the premise is asserted rather than assumed. Measured at 6-9 of the ten
    // nodes claiming across passing runs, so this floor separates contention
    // from none rather than tuning a threshold: if it ever trips, the suite has
    // stopped testing what it claims to and the contention must be built.
    const claimants = claimantIps(appName).size;
    expect(
      claimants,
      `fixture: ${claimants} node(s) claimed ${appName}, not more than the 3 it required - there was no contention to resolve`,
    ).to.be.above(3);
  });

  it('places on every node when instances == nodeCount (deterministic floor)', async function () {
    this.timeout(180000);
    const appName = `e2espawnall${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableTestApp({ name: appName, instances: env.nodeCount, port: 31112 });
    await seedSpawnerApp(env, app);

    const placed = await waitForInstanceCount(env, appName, env.nodeCount, { timeout: 150000, stableMs: 10000 });
    expect(placed.length).to.equal(env.nodeCount);
  });
});
