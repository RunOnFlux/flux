// weight: heavy
/*
 * An app's volume is a loop-mounted image file, and its loop device uses direct
 * I/O: from the mount that creates it, through a spec update that reinstalls the
 * app, and after the node restarts and FluxOS mounts it again.
 *
 * A buffered loop device caches the image file in the host page cache on top of
 * the cache the filesystem inside it keeps, and both are charged to the app's
 * memory cgroup. The loop worker allocates that second copy without being allowed
 * to do I/O, so an app at its memory limit cannot reclaim it and the kernel kills
 * the app's largest process. With direct I/O only the inner copy exists.
 *
 * Read from the kernel, never from FluxOS: /sys/block/loopN/loop/dio is the loop
 * device's own flag, and the device is the one the mount point resolves through.
 *
 * NOT COVERED HERE: a host filesystem that refuses direct I/O (ZFS aligns it to
 * its record size, which no loop device's block size reaches). The harness's
 * volumes sit on ext4, so the refusal and the volume staying buffered are
 * unit-proved only (volumeService.test.js, 'direct I/O on app volumes').
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes, seedSpecUpdate } from '../framework/reconciler-suite.js';
import { execInContainer, getAppContainerId } from '../framework/container.js';
import { volumeRoot } from '../framework/volume-fixture.js';
import { waitFor, waitForComponentRedeployed } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

describe('an app volume uses direct I/O', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2evoldio${Date.now()}`;
  let holder;
  let app;

  // The loop device the volume's mount point resolves through, and its flag.
  // null when the volume is not mounted from a loop device at all.
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
        description: 'direct I/O test container',
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

  it('mounts the volume it creates with direct I/O', async function () {
    this.timeout(60000);
    expect(await volumeDirectIo(holder), 'the volume is not on a loop device, or it is buffered').to.equal('1');
  });

  it('keeps direct I/O on the volume through a spec update', async function () {
    // Counted in blocks, as suite 85 explains: the reinstall pass fires on a
    // block-height modulus, so the chain is driven rather than waited on.
    this.timeout(1500000);

    const updated = await buildSeedableUpdate(app, (spec) => {
      spec.compose[0].description = 'direct I/O test container, second specification';
    });
    const beforeUpdate = holder.getLastEventId();
    await seedSpecUpdate(env, updated, [0]);
    await stopTicker();
    const replaced = () => waitForComponentRedeployed(holder, appName, appName, false, 0, { afterId: beforeUpdate })
      .then(() => true, () => false);
    await driveUntil(holder, replaced, { blocks: 108, label: 'the node reinstalls the app at its new specification' });

    expect(await volumeDirectIo(holder), 'the reinstalled app\'s volume is buffered').to.equal('1');
  });

  // A restart takes every mount with it, and FluxOS mounts the volumes again
  // at boot - through a different path than the one that created them.
  it('mounts the volume with direct I/O again after the node restarts', async function () {
    this.timeout(420000);

    await env.restartNode(0);
    await waitFor(
      async () => Boolean(await getAppContainerId(holder.container, appName, appName)) && await volumeDirectIo(holder) !== null,
      { timeout: 300000, interval: 3000, label: 'the app and its volume are back after the restart' },
    );

    expect(await volumeDirectIo(holder), 'the volume FluxOS mounted at boot is buffered').to.equal('1');
  });
});
