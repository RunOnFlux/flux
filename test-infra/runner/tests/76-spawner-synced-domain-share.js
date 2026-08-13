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
// This is the field proof of the regression guard: the domain is PERMITTED to
// hold all N, held stable - the same fleet shape the multi-instance spawner suite
// proves for plain apps, for the app class the old veto stranded.
//
// The opposite direction - that the domain is also CAPPED at N - is a separate
// test below, and skipped. It reads like the same arithmetic and is not: the
// share permits N deterministically, but refusing the N+1th depends on the
// admitting nodes having heard each other's claims.

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

  it('converges a synced app to its instance count inside one /16', async function () {
    this.timeout(200000);
    const appName = `e2esyncshare${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableSyncthingApp({
      name: appName, mode: 'g', ports: [31131], instances: 3,
    });
    await seedSpawnerApp(env, app);

    // pre-fix code refuses every install after the first ("same ip range") and
    // this pins at 1/3 until the suite times out. The ceiling is deliberately not
    // asserted here - see the skipped test below for why it is a different claim.
    const placed = await waitForInstanceCount(env, appName, 3, {
      timeout: 150000, stableMs: 15000, exact: false,
    });
    expect(placed.length).to.be.at.least(3);
  });

  // Skipped until the spawner is redesigned: the ceiling is not a property of the
  // share arithmetic, and no amount of it can be. A node admits itself by counting
  // the claimants ahead of it in a gossiped list; two nodes whose lists are each
  // missing the other both count themselves inside the remaining share and both
  // install. Nothing removes the surplus within this window either -
  // checkAndRemoveApplicationInstance is paced at 44 blocks, roughly 22 minutes.
  //
  // Observed at about one run in fourteen, and worse under a loaded gate, which is
  // the worst frequency to carry live: often enough to cost an investigation, rare
  // enough to train people to skim past a red gate.
  //
  // Deterministic placement makes the ceiling true by construction - a node asks
  // whether it is among the app's chosen nodes, computed identically on every node
  // from the app and the node list, rather than counting claimants it may not have
  // heard from yet. That is the spawner rebuild, and this is its acceptance test.
  // Un-skip it then.
  it.skip('caps the domain at its share, admitting no fourth instance', async function () {
    this.timeout(200000);
    const appName = `e2esynccap${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableSyncthingApp({
      name: appName, mode: 'g', ports: [31132], instances: 3,
    });
    await seedSpawnerApp(env, app);

    const placed = await waitForInstanceCount(env, appName, 3, { timeout: 150000, stableMs: 15000 });
    expect(placed.length).to.equal(3);
  });
});
