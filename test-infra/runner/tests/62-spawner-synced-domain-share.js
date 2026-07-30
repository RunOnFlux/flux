import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import {
  bootAndPeer, seedSpawnerApp, waitForInstanceCount,
} from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Synced (g:/r:/s:) apps and the placement share. Every harness node sits in
// one /16, i.e. one network fault domain - the WordPress-in-Bahrain incident
// in miniature (all 49 Bahraini nodes are one /16 under one provider). The
// retired rule refused to co-locate ANY two synced instances inside a /16
// without checking whether the app's eligible nodes could satisfy that, so a
// synced app here pinned at 1 of N forever while its cluster operator waited
// for the full count. The placement share computes the domain's allotment from
// the eligible candidate set: one domain available -> that domain holds all N.
//
// This is the field proof of the regression guard: convergence to exactly N,
// held stable - the same fleet shape that suite 39 proves for plain apps, for
// the app class the old veto stranded. waitForInstanceCount's stability window
// also fails a 4th instance, so the share must CAP the domain at N as well as
// permit N - both directions of the arithmetic in one assertion.

describe('spawner shares one fault domain among synced-app instances', function () {
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

  it('converges a synced app to its instance count inside one /16 and holds there', async function () {
    this.timeout(200000);
    const appName = `e2esyncshare${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableSyncthingApp({
      name: appName, mode: 'g', ports: [31131], instances: 3,
    });
    await seedSpawnerApp(env, app);

    // pre-fix code refuses every install after the first ("same ip range") and
    // this pins at 1/3 until the suite times out
    const placed = await waitForInstanceCount(env, appName, 3, { timeout: 150000, stableMs: 15000 });
    expect(placed.length).to.equal(3);
  });
});
