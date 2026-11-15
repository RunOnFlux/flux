/*
 * An s: copy held stopped because its volume could not be mounted safely runs again
 * once the volume mounts.
 *
 * The node boots the way a reboot leaves it: FluxOS down, the app's container stopped,
 * and the volume's image unmountable (its superblock zeroed). The monitor's first pass
 * after a start checks every syncing folder's mount and holds the copy stopped. An s:
 * component has no decider to say it may run again, so the hold must not outlive the
 * unsafe mount: once the superblock is back, the volume mounts and the copy starts.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import {
  crashFluxos, releaseFluxos, stopAppContainer, isAppContainerRunning,
} from '../framework/container.js';
import { breakFolderVolume, restoreFolderVolume } from '../framework/volume-fixture.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const MOUNT_SAFETY = 'mount safety block';

describe('an s: copy held for an unsafe mount runs once its volume mounts', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2emounthold${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${identifier}`;
  const HOLDERS = [1, 2];
  const BROKEN = 1;
  const client = (i) => env.clients[i];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3 });
    await bootAndPeer(env);

    await pushTestApp(appName, 'v1', appName, { user: 1000 });
    await installOnNodes(env, await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: [{
        name: appName,
        description: 'an s: component',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: 's:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    }), HOLDERS);
    await waitFor(async () => (await Promise.all(HOLDERS.map((i) => isAppContainerRunning(client(i).container, appName)))).every(Boolean), {
      timeout: 240000, interval: 3000, label: `${appName} running on every holder`,
    });
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('holds the copy stopped while its volume cannot be mounted', async function () {
    this.timeout(300000);
    const { container } = client(BROKEN);
    await crashFluxos(container, { hold: true });
    const stop = await stopAppContainer(container, appName);
    expect(stop.exitCode, `stopping ${appName}: ${stop.output}`).to.equal(0);
    await breakFolderVolume(container, folder);
    const mark = client(BROKEN).getLastEventId();
    await releaseFluxos(container);

    await client(BROKEN).waitForEvent(
      'reconciler:desiredChanged',
      (d) => d.identifier === identifier && d.state === 'stopped' && String(d.reason).startsWith(MOUNT_SAFETY),
      240000,
      { afterId: mark },
    );
    expect(await isAppContainerRunning(container, appName), 'the copy over the unsafe mount').to.equal(false);
  });

  it('starts the copy once its volume mounts', async function () {
    this.timeout(300000);
    const mark = client(BROKEN).getLastEventId();
    await restoreFolderVolume(client(BROKEN).container, folder);

    await waitForReconcileActuated(client(BROKEN), identifier, 'started', 120000, { afterId: mark });
    expect(await isAppContainerRunning(client(BROKEN).container, appName), 'the copy once its volume mounts').to.equal(true);
  });
});
