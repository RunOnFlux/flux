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
