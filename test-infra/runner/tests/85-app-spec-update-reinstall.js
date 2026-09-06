// weight: heavy
/*
 * An owner changes a running app's specification, and the node reinstalls it.
 *
 * Until this suite the harness could register an app and remove one, and could
 * not CHANGE one - `grep -rn appupdate test-infra/` found nothing, and no suite
 * reached reinstallOldApplications at all. That left every path that answers a
 * spec change with unit coverage only: the periodic reinstall pass, the
 * per-component change detector that decides soft against hard, the strip list
 * that decides which fields count as a change, and the guards that are supposed
 * to stop the pass colliding with an install already in flight.
 *
 * How the change arrives: the app's global row is REPLACED and a new permanent
 * message and hash seeded beside it, which is what hash sync leaves behind when
 * the chain carries a newer message for an app. The node compares the hash it
 * installed against the hash the global row now carries; that comparison is the
 * whole trigger, and it does not care how the row got there. The real submission
 * path (/apps/appupdate, signature, temp message, block confirmation) is covered
 * by app-helper's updateAndConfirm and is a different question - this suite is
 * about what the node does once it knows.
 *
 * DRIVEN BY BLOCKS, not by a timer. The pass fires on
 * `blockHeight % (updateFluxAppsPeriod * speedMultiplier) === 0`, and
 * updateFluxAppsPeriod is re-randomised to 4-9 after every firing. The harness
 * chain starts above daemonPONFork so speedMultiplier is 4, which puts a firing
 * every 16 to 36 blocks - hence driveUntil rather than a wait.
 *
 * The component's hdd is untouched, so this is the SOFT path: the component is
 * softly uninstalled and reinstalled through softRegisterAppLocally, and the
 * app's data volume survives. A change to hdd takes the hard path and reformats
 * it, which is a different suite.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes, seedSpecUpdate } from '../framework/reconciler-suite.js';
import { getAppContainerId } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { driveUntil } from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

describe('an app whose specification changed is reinstalled at the new specification', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2especupd${Date.now()}`;
  let holder;
  let app;
  let containerBefore;

  async function localSpec(client) {
    const res = await client.getInstalledApps();
    if (res.status !== 'success') return null;
    return (res.data ?? []).find((a) => a.name === appName) ?? null;
  }

  before(async function () {
    this.timeout(420000);

    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootAndPeer(env);
    [holder] = env.clients;

    await pushImage(appName, 'v1');
    app = await buildSeedableApp({
      env,
      name: appName,
      instances: 1,
      compose: [{
        name: appName,
        description: 'spec update test container',
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

    await installOnNodes(env, app, [0]);
    // The container id recorded before the change is the only thing that
    // separates "reinstalled" from "left alone": the row's hash could be
    // rewritten by anything, the container being a different container could not.
    await waitFor(async () => {
      containerBefore = await getAppContainerId(holder.container, appName, appName);
      return Boolean(containerBefore);
    }, { timeout: 120000, interval: 2000, label: 'the app is running before its spec changes' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('notices the new specification and reinstalls the component at it', async function () {
    this.timeout(600000);

    const updated = await buildSeedableUpdate(app, (spec) => {
      // Not hdd: that takes the hard path, which reformats the data volume. A
      // description change is a change the detector must act on and the cheapest
      // one that leaves everything else about the app alone.
      spec.compose[0].description = 'spec update test container, second specification';
    });
    expect(updated.hash, 'an update that hashes the same is not an update').to.not.equal(app.hash);

    await seedSpecUpdate(env, updated, [0]);

    await driveUntil(
      holder,
      async () => (await localSpec(holder))?.hash === updated.hash,
      { timeoutMs: 420000, label: 'the node installs the app at the new specification' },
    );

    const installed = await localSpec(holder);
    expect(installed, 'the app is still installed').to.not.be.null;
    expect(installed.compose[0].description, 'the row carries the new specification, not just its hash')
      .to.equal('spec update test container, second specification');

    // A row rewritten without the container being replaced is the failure this
    // exists to catch: the node would report the new specification while running
    // the old one.
    const containerAfter = await getAppContainerId(holder.container, appName, appName);
    expect(containerAfter, 'the app is running after the reinstall').to.be.a('string');
    expect(containerAfter, 'the component was replaced, not just re-recorded').to.not.equal(containerBefore);
  });
});
