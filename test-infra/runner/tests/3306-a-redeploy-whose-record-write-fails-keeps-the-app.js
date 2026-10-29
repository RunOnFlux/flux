// weight: heavy
/*
 * The periodic reinstall pass redeploys an app whose specification changed, and the
 * database refuses the write of the app's new record. The app keeps its record, at the
 * old specification, so the node still knows it holds the app, and is left with no
 * container. A later pass redeploys it at the new specification from there.
 *
 * The reconciler would recreate the container, and a pass can come before it does: the
 * pass period is drawn again after every pass. The reconciler's recreate is held, so the
 * pass that redeploys the app always finds no container. It is released once that pass
 * has created the new one, before the pass restarts the app through the reconciler.
 *
 * The change arrives as in suite 85: the app's global row is replaced and a new
 * permanent message and hash seeded beside it. The pass runs every 16 to 36 blocks
 * here, so the drive is budgeted in blocks.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes, seedSpecUpdate } from '../framework/reconciler-suite.js';
import { getAppContainerId } from '../framework/container.js';
import { waitFor, waitForComponentRedeployed } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { failWrites } from '../framework/mongo-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// four passes at the longest period: the one whose write is refused, and others after it
const PASS_BLOCKS = 144;
const HOLDER = 0;
const BEFORE_RECREATE = 'reconciler:beforeRecreate';

describe('a redeploy whose record write fails keeps the app', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eredeployrow${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  let holder;
  let recreateHeld = false;
  let app;
  let updated;
  let containerBefore;
  let release;
  let beforeUpdate;

  async function localSpec(client) {
    const res = await client.getInstalledApps();
    if (res.status !== 'success') return null;
    return (res.data ?? []).find((a) => a.name === appName) ?? null;
  }

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootAndPeer(env);
    holder = env.clients[HOLDER];

    await pushImage(appName, 'v1');
    app = await buildSeedableApp({
      env,
      name: appName,
      instances: 1,
      compose: [{
        name: appName,
        description: 'redeploy row test container',
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
    await installOnNodes(env, app, [HOLDER]);
    await waitFor(async () => {
      containerBefore = await getAppContainerId(holder.container, appName, appName);
      return Boolean(containerBefore);
    }, { timeout: 120000, interval: 2000, label: 'the app is running before its spec changes' });

    // a description change takes the soft path, which keeps the data volume
    updated = await buildSeedableUpdate(app, (spec) => {
      spec.compose[0].description = 'redeploy row test container, second specification';
    });
    beforeUpdate = holder.getLastEventId();
    await seedSpecUpdate(env, updated, [HOLDER]);
    // the only thing advancing the chain from here is the drive below
    await stopTicker();
    await holder.holdCheckpoint(BEFORE_RECREATE, identifier);
    recreateHeld = true;
    release = await failWrites(HOLDER + 1, 'localzelapps', 'zelappsinformation', { times: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await release?.().catch(() => {});
    if (recreateHeld) await holder.releaseCheckpoint(BEFORE_RECREATE, identifier).catch(() => {});
    await env?.teardown();
  });

  it('comes back at the new specification', async function () {
    // a backstop: the drive is bounded in blocks, and blocks cost what the node takes
    this.timeout(2400000);
    // The pass whose write is refused takes the container away. With the recreate held,
    // only a later pass can bring one back, and its restart waits on the component the
    // held recreate is working on: the hold ends once the container is back.
    let sawGone = false;
    const replaced = async () => {
      if (recreateHeld) {
        const container = await getAppContainerId(holder.container, appName, appName);
        if (!container) sawGone = true;
        if (container && sawGone) {
          await holder.releaseCheckpoint(BEFORE_RECREATE, identifier);
          recreateHeld = false;
        }
      }
      return waitForComponentRedeployed(holder, appName, appName, false, 0, { afterId: beforeUpdate })
        .then(() => true, () => false);
    };
    await driveUntil(holder, replaced, {
      blocks: PASS_BLOCKS, label: 'the node redeploys the app at the new specification',
    });
    expect(sawGone, 'fixture: the app\'s container was never seen gone while its recreate was held').to.equal(true);

    const installed = await localSpec(holder);
    expect(installed, 'the node no longer holds the app').to.not.equal(null);
    expect(installed.hash, 'the row is at the new specification').to.equal(updated.hash);
    const containerAfter = await getAppContainerId(holder.container, appName, appName);
    expect(containerAfter, 'the app is not running').to.be.a('string');
    expect(containerAfter, 'the component was never replaced').to.not.equal(containerBefore);
  });

  it('had the write of the app\'s record refused by the database', async function () {
    const failed = await release();
    release = null;
    expect(failed, 'the database refused none of the node\'s record writes, so nothing above was tested').to.equal(1);
  });
});
