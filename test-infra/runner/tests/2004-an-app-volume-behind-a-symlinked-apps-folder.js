// weight: heavy
/*
 * A legacy node whose apps folder is reached through a symlink manages its
 * apps' volumes as any other node does: each is mounted once, uses direct I/O,
 * and a crashed container is restarted over it.
 *
 * The mount table names a mount point by its real path. FluxOS is given the
 * link (FLUX_APPS_FOLDER), so the node has to compare the mount table against
 * the folder's real path to see its own volumes mounted. One that does not
 * treats every mounted volume as unmounted: the mount it then retries is
 * refused as already mounted, the reconciler reports the volume unavailable
 * and starts nothing over it, and the loop device is never switched to direct
 * I/O.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { crashAppContainer, execInContainer, getAppContainerId } from '../framework/container.js';
import { volumeRoot } from '../framework/volume-fixture.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const APPS_FOLDER_LINK = '/mnt/appdata/flux-apps-link';
const APPS_FOLDER = '/mnt/appdata/flux-apps';

describe('an app volume behind a symlinked apps folder', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2evollink${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  let holder;

  // How many mounts the mount table lists at the volume's real path.
  async function mountCount(client) {
    const r = await execInContainer(client.container, `grep -c " ${volumeRoot(appName)} " /proc/self/mountinfo; true`);
    return Number(r.output.trim());
  }

  // The direct I/O flag of the loop device the volume's mount point resolves
  // through; null when it is not mounted from a loop device.
  async function volumeDirectIo(client) {
    const r = await execInContainer(
      client.container,
      `src=$(findmnt -no SOURCE ${volumeRoot(appName)} | tail -1); `
      + 'case "$src" in /dev/loop*) cat "/sys/block/${src#/dev/}/loop/dio";; *) echo none;; esac',
    );
    const out = r.output.trim();
    return out === 'none' || r.exitCode !== 0 ? null : out;
  }

  before(async function () {
    this.timeout(420000);

    env = await createTestEnv({
      hookCtx: this, nodes: 5, legacyNodes: [0], symlinkedAppsFolder: [0], tickerAutostart: false,
    });
    await bootAndPeer(env);
    [holder] = env.clients;

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: 1,
      compose: [{
        name: appName,
        description: 'symlinked apps folder test container',
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
    await waitFor(
      async () => Boolean(await getAppContainerId(holder.container, appName, appName)),
      { timeout: 120000, interval: 2000, label: 'the app is running' },
    );
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('reaches the apps folder through a symlink', async function () {
    this.timeout(30000);
    const r = await execInContainer(holder.container, `readlink ${APPS_FOLDER_LINK}`);
    expect(r.output.trim(), 'the node\'s apps folder is not a symlink').to.equal(APPS_FOLDER);
  });

  it('mounts the volume once, with direct I/O', async function () {
    this.timeout(60000);
    expect(await mountCount(holder), 'mounts at the volume\'s real path').to.equal(1);
    expect(await volumeDirectIo(holder), 'the volume is not on a loop device, or it is buffered').to.equal('1');
  });

  it('restarts a crashed container over its mounted volume', async function () {
    this.timeout(120000);
    const afterId = holder.getLastEventId();
    await crashAppContainer(holder.container, appName);
    await waitForReconcileActuated(holder, identifier, 'started', 90000, { afterId });
    expect(await mountCount(holder), 'mounts at the volume\'s real path').to.equal(1);
  });

  it('mounts the volume once, with direct I/O, after the node restarts', async function () {
    this.timeout(420000);

    await env.restartNode(0);
    await waitFor(
      async () => Boolean(await getAppContainerId(holder.container, appName, appName)) && await volumeDirectIo(holder) !== null,
      { timeout: 300000, interval: 3000, label: 'the app and its volume are back after the restart' },
    );

    expect(await mountCount(holder), 'mounts at the volume\'s real path').to.equal(1);
    expect(await volumeDirectIo(holder), 'the volume FluxOS mounted at boot is buffered').to.equal('1');
  });
});
