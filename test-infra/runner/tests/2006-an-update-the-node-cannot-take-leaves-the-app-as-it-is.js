// weight: heavy
/*
 * An update a node cannot take leaves the app as it is, on every pass that finds
 * it: its container, its data and its row.
 *
 * The update pass checks the node can hold the new specification before it tears
 * any component down. The node is sized so the update cannot fit at all: a cumulus
 * node with 25 GB left for apps (240 GB disk, 228 usable, 203 reserved), an app of
 * 10 GB, and an update asking for 30. The hdd change is the HARD path, which
 * deletes the component's volume, so a teardown before the check costs the app's
 * data, and the pass finds the update still undone and tears down again.
 *
 * The suite drives the chain until update passes that began after the update was
 * stored have finished (a pass started before it may not have seen it), then reads
 * the container, a file written into the app's volume before the update, and the
 * row, and that each of those passes declined the update.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { deliverApp } from '../framework/app-delivery.js';
import { execInContainer, getAppContainerId } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// Node 1 (client index 0): a cumulus node with 25 GB left for apps.
const ROOM_FOR_25_GB = { lockedSystemResources: { hdd: 0, extrahdd: 203 } };
const PASSES = 2;

describe('an update the node cannot take leaves the app as it is', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eupdnofit${Date.now()}`;
  const marker = `/mnt/appdata/flux-apps/flux${appName}_${appName}/appdata/kept-through-the-update`;
  let holder;
  let app;
  let containerBefore;

  async function localSpec(client) {
    const res = await client.get(`/apps/installedapps?_=${Date.now()}`);
    if (res.status !== 'success') return null;
    return (res.data ?? []).find((a) => a.name === appName) ?? null;
  }

  before(async function () {
    this.timeout(420000);

    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      nodeTiers: { 1: 'CUMULUS' },
      nodeConfigOverrides: { 0: ROOM_FOR_25_GB },
    });
    await bootAndPeer(env);
    [holder] = env.clients;

    await pushImage(appName, 'v1');
    app = await buildSeedableApp({
      env,
      name: appName,
      instances: 1,
      compose: [{
        name: appName,
        description: 'update that does not fit',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 10,
        repoauth: '',
      }],
    });

    await installOnNodes(env, app, [0]);
    await waitFor(async () => {
      containerBefore = await getAppContainerId(holder.container, appName, appName);
      return Boolean(containerBefore);
    }, { timeout: 180000, interval: 2000, label: 'the app is running before its spec changes' });
    const wrote = await execInContainer(holder.container, `echo kept > ${marker} && test -s ${marker}`);
    expect(wrote.exitCode, `writing into the app's volume failed: ${wrote.output}`).to.equal(0);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('declines the update on every pass, and the app keeps its container, data and row', async function () {
    // Counted in blocks: the update pass fires on a block-height modulus.
    this.timeout(2400000);

    const updated = await buildSeedableUpdate(app, (spec) => {
      spec.compose[0].hdd = 30;
    });
    await deliverApp(env, updated, [0]);
    await stopTicker();
    const stored = holder.getLastEventId();

    const after = (name) => holder.getEventBuffer().filter((e) => e.id > stored && e.event === name);
    await driveUntil(holder, async () => after('reinstall:passEnded').length >= PASSES + 1, {
      blocks: 108 * (PASSES + 1), label: `${PASSES + 1} update passes end`,
    });

    const containerAfter = await getAppContainerId(holder.container, appName, appName);
    expect(containerAfter, 'the component was torn down').to.equal(containerBefore);
    const kept = await execInContainer(holder.container, `cat ${marker}`);
    expect(kept.stdout.trim(), 'the app\'s data was deleted').to.equal('kept');
    const installed = await localSpec(holder);
    expect(installed?.hash, 'the row left the specification the app runs').to.equal(app.hash);
    expect(installed.compose[0].hdd).to.equal(10);
    const declines = after('app:updateDeclined').filter((e) => e.data?.name === appName);
    expect(declines.length, 'passes that declined the update').to.be.at.least(PASSES);
    expect(declines.every((e) => e.data.hash === updated.hash)).to.equal(true);
  });
});
