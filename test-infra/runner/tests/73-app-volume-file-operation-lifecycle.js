import { describe, it, before, beforeEach, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushImage, mirrorExecutorImage, executorImageReference } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitFor, waitForOperation } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import {
  volumeRoot, resetVolume, seedVolumeTree, seedLargeFile, treeOf, exists,
} from '../framework/volume-fixture.js';

// How an operation behaves around the things that happen TO it: a node that has
// never held the executor image, a prune that deletes it, another operation
// arriving while one runs, and a cancel.
//
// The image cases are the ones nobody finds by hand. Creating a container does
// not pull - POST /containers/create answers 404 for an image the node does not
// hold - and a digest-pinned image carries no tag, which is exactly what
// docker's dangling filter matches, so every app install used to delete it.

describe('app volume file operations - lifecycle', function () {
  let env;
  let node;
  let auth;
  let executorImage;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2efilelife${ts}`;
  const root = volumeRoot(appName);

  const post = (path, body) => node.request('POST', path, { body, headers: { zelidauth: auth.zelidauth } });

  async function inNode(command) {
    return execInContainer(node.container, command);
  }

  async function imageHeld() {
    const r = await inNode(`docker image inspect ${executorImage} >/dev/null 2>&1; echo $?`);
    return r.stdout.trim() === '0';
  }

  before(async function () {
    this.timeout(600000);
    executorImage = executorImageReference();

    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        // A three-node fleet cannot reach the production peer floors: the
        // discovery mesh is a ring needing at least 2*minOutgoing+1 nodes to
        // close, so three can only carry minOutgoing 1. This suite exercises
        // one node's own volume, so the fleet exists to make that node a real
        // one rather than to be peered with.
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          volumeOperations: {
            image: executorImage,
            progressIntervalMs: 200,
            // Long enough that a cancel is still a cancel and not a race with
            // the operation finishing on its own.
            cancelGraceSeconds: 15,
          },
        },
      },
    });
    // After the fleet, not before: the registry this copies into is one of the
    // containers createTestEnv starts.
    await mirrorExecutorImage();
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'file operation lifecycle',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [31801],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, [0]);

    node = env.clients[0];
    auth = await authenticate(node.url, appOwnerKey());
    await waitFor(async () => exists(node.container, root), {
      timeout: 60000, interval: 2000, label: 'app volume mounted',
    });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  beforeEach(async function () {
    this.timeout(60000);
    await resetVolume(node.container, appName);
    await seedVolumeTree(node.container, appName, { 'photos/a.txt': 'first' });
  });

  describe('the executor image', () => {
    it('is fetched by the first operation on a node that has never held it', async function () {
      this.timeout(300000);
      // Free: an empty image store is the default state here, because each node
      // runs its own dockerd on a per-run volume.
      await inNode(`docker rmi -f ${executorImage} >/dev/null 2>&1 || true`);
      expect(await imageHeld(), 'FIXTURE: the image is still held').to.equal(false);

      const accepted = await post('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });
      expect(accepted.status, JSON.stringify(accepted.data)).to.equal(202);
      const job = await waitForOperation(node, accepted.data.data.jobId, auth.zelidauth, { timeout: 240000 });

      expect(job.status, JSON.stringify(job.error)).to.equal('Succeeded');
      expect(await imageHeld()).to.equal(true);
    });

    it('still works after a prune deletes it', async function () {
      this.timeout(300000);
      // The image is pinned by digest and therefore carries no tag, which is
      // what docker's dangling filter matches - so performDockerCleanup, which
      // runs before EVERY app install, removes it. A fetch only at startup
      // would work until the next install and then stop.
      await inNode('docker image prune -f >/dev/null 2>&1 || true');
      expect(await imageHeld(), 'FIXTURE: the prune did not remove the pinned image').to.equal(false);

      const accepted = await post('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });
      expect(accepted.status, JSON.stringify(accepted.data)).to.equal(202);
      const job = await waitForOperation(node, accepted.data.data.jobId, auth.zelidauth, { timeout: 240000 });

      expect(job.status, JSON.stringify(job.error)).to.equal('Succeeded');
      expect(await exists(node.container, `${root}/copied/a.txt`)).to.equal(true);
    });
  });

  describe('concurrency', () => {
    it('refuses a second operation with 503 and a Retry-After, registering no job', async function () {
      this.timeout(300000);
      // Big enough that the first operation is still running when the second
      // arrives; the refusal is decided before any job exists, so a caller
      // turned away never sees an operation that briefly existed.
      await seedLargeFile(node.container, appName, 'bulk.bin', 256);

      const first = await post('/apps/copyobject', {
        appname: appName, component: appName, source: 'bulk.bin', destination: 'bulk-one.bin',
      });
      expect(first.status, JSON.stringify(first.data)).to.equal(202);

      const second = await post('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });

      expect(second.status, `expected a refusal, got ${JSON.stringify(second.data)}`).to.equal(503);
      expect(second.headers['retry-after']).to.match(/^\d+$/);
      expect(second.data.data.jobId ?? null, 'a job was registered for a refused operation').to.equal(null);

      const job = await waitForOperation(node, first.data.data.jobId, auth.zelidauth, { timeout: 240000 });
      expect(job.status, JSON.stringify(job.error)).to.equal('Succeeded');
    });
  });

  describe('cancellation', () => {
    it('stops the operation, leaves the destination alone, and reclaims its staging', async function () {
      this.timeout(300000);
      await seedLargeFile(node.container, appName, 'bulk.bin', 256);

      const accepted = await post('/apps/copyobject', {
        appname: appName, component: appName, source: 'bulk.bin', destination: 'bulk-copy.bin',
      });
      expect(accepted.status, JSON.stringify(accepted.data)).to.equal(202);
      const { jobId } = accepted.data.data;

      // Wait until the container is actually running, so this cancels work in
      // flight rather than racing the setup.
      await waitFor(async () => {
        const staging = await treeOf(node.container, root);
        return staging.some((p) => p.includes('.flux-op-'));
      }, { timeout: 60000, interval: 500, label: 'staging directory created' });

      const cancelled = await node.del(`/apps/operations/${jobId}`, auth.zelidauth);
      expect(cancelled.data.cancelRequested).to.equal(true);

      const job = await waitForOperation(node, jobId, auth.zelidauth, { timeout: 240000 });
      expect(job.status).to.equal('Canceled');

      // The destination was never written: publishing is the last thing that
      // happens and it never got there.
      expect(await exists(node.container, `${root}/bulk-copy.bin`)).to.equal(false);

      // And the space is given back. A cancel sends SIGTERM, which flux-op
      // traps to stop the command and remove its staging - docker's kill sends
      // SIGKILL, which reaches neither and leaves the space spent until the
      // next boot sweep.
      await waitFor(async () => {
        const leftovers = await treeOf(node.container, root);
        return !leftovers.some((p) => p.includes('.flux-op-'));
      }, { timeout: 60000, interval: 1000, label: 'staging reclaimed after cancel' });
    });

    it('leaves no executor container behind', async function () {
      this.timeout(120000);
      const running = await inNode('docker ps -a --filter label=runonflux.role=fileop --format "{{.ID}}"');
      expect(running.stdout.trim(), 'an executor container outlived its operation').to.equal('');
    });
  });
});
