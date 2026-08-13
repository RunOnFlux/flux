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
  volumeRoot, resetVolume, seedVolumeTree, exists,
} from '../framework/volume-fixture.js';

// Where a node gets the executor image, which decides whether it has a file
// browser at all: createfolder used to be a local mkdir and now needs a
// container. One registry is not a guarantee that a node can reach one, so a
// node asks the fleet as well - and the fleet is only an answer if the image
// really moves between nodes, which is what nothing but this exercises.
//
// The unit tests stub docker, the network and the peers, so they prove the
// decisions and nothing about a real image crossing a real wire.

describe('app volume file operations - where the image comes from', function () {
  let env;
  let auth;
  let executorImage;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2efileimg${ts}`;
  const root = volumeRoot(appName);

  const post = (node, path, body) => node.request('POST', path, { body, headers: { zelidauth: auth.zelidauth } });
  const get = (node, path) => node.request('GET', path, { headers: { zelidauth: auth.zelidauth } });

  const inNode = (index, command) => execInContainer(env.clients[index].container, command);

  async function imageHeldOn(index) {
    const r = await inNode(index, `docker image inspect ${executorImage} >/dev/null 2>&1; echo $?`);
    return r.stdout.trim() === '0';
  }

  async function forgetImageEverywhere() {
    await Promise.all(env.clients.map((_, index) => inNode(index, `docker rmi -f ${executorImage} >/dev/null 2>&1 || true`)));
  }

  async function giveImageTo(index) {
    const r = await inNode(index, `docker pull ${executorImage}`);
    expect(r.exitCode, `FIXTURE: node ${index} could not be given the image: ${r.output}`).to.equal(0);
  }

  // REJECT rather than DROP: an unreachable registry is the condition under
  // test, and a silently dropped packet only tests how long a pull waits.
  async function cutOffRegistry(index) {
    const r = await inNode(index, 'iptables -I OUTPUT -d $(getent hosts fluxregistry | awk \'{print $1}\') -j REJECT');
    expect(r.exitCode, `FIXTURE: could not cut node ${index} off from the registry`).to.equal(0);
  }

  async function restoreRegistry(index) {
    await inNode(index, 'iptables -D OUTPUT -d $(getent hosts fluxregistry | awk \'{print $1}\') -j REJECT || true');
  }

  before(async function () {
    this.timeout(600000);
    executorImage = executorImageReference();

    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          volumeOperations: {
            image: executorImage,
            // Far enough out that no node reaches its own registry slot during
            // the suite: what is being watched here is where an operation gets
            // the image, not the background fetch racing it.
            prefetchWindowMs: 24 * 60 * 60 * 1000,
          },
        },
      },
    });
    await mirrorExecutorImage();
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'where the file operation image comes from',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [31811],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 3,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, [0]);

    auth = await authenticate(env.clients[0].url, appOwnerKey());
    await waitFor(async () => exists(env.clients[0].container, root), {
      timeout: 60000, interval: 2000, label: 'app volume mounted',
    });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  beforeEach(async function () {
    this.timeout(120000);
    await restoreRegistry(0);
    await resetVolume(env.clients[0].container, appName);
    await seedVolumeTree(env.clients[0].container, appName, { 'photos/a.txt': 'first' });
  });

  it('takes the image from the node that has it when the registry cannot be reached', async function () {
    this.timeout(300000);
    await forgetImageEverywhere();
    await giveImageTo(2);
    await cutOffRegistry(0);
    expect(await imageHeldOn(0), 'FIXTURE: node 0 still holds the image').to.equal(false);

    const accepted = await post(env.clients[0], '/apps/copyobject', {
      appname: appName, component: appName, source: 'photos', destination: 'copied',
    });
    expect(accepted.status, JSON.stringify(accepted.data)).to.equal(202);
    const job = await waitForOperation(env.clients[0], accepted.data.data.jobId, auth.zelidauth, { timeout: 240000 });

    expect(job.status, JSON.stringify(job.error)).to.equal('Succeeded');
    expect(await imageHeldOn(0), 'the image never arrived').to.equal(true);
  });

  it('falls back to the registry when no peer has it', async function () {
    this.timeout(300000);
    await forgetImageEverywhere();
    expect(await imageHeldOn(0), 'FIXTURE: node 0 still holds the image').to.equal(false);

    const accepted = await post(env.clients[0], '/apps/copyobject', {
      appname: appName, component: appName, source: 'photos', destination: 'copied',
    });
    expect(accepted.status, JSON.stringify(accepted.data)).to.equal(202);
    const job = await waitForOperation(env.clients[0], accepted.data.data.jobId, auth.zelidauth, { timeout: 240000 });

    expect(job.status, JSON.stringify(job.error)).to.equal('Succeeded');
    expect(await imageHeldOn(0)).to.equal(true);
  });

  it('answers a folder request 503 with a Retry-After when nothing can supply it', async function () {
    this.timeout(300000);
    // createfolder runs the operation inline rather than registering a job, so
    // a node that cannot get the image answers the caller directly - which is
    // the whole reason a caller is given a deadline rather than the fetch's.
    await forgetImageEverywhere();
    await cutOffRegistry(0);

    const started = Date.now();
    const refused = await get(env.clients[0], `/apps/createfolder/${appName}/${appName}/${encodeURIComponent('photos/later')}`);
    const took = Date.now() - started;

    expect(refused.status).to.equal(503);
    expect(refused.headers['retry-after'], 'no Retry-After to act on').to.not.equal(undefined);
    // The caller's deadline, not the fetch's: four peers at two minutes each
    // plus a registry attempt is minutes, and nobody clicking a button waits.
    expect(took, `answered in ${took}ms`).to.be.below(60000);
  });

  it('succeeds once a peer has it, without the node being restarted', async function () {
    this.timeout(300000);
    await forgetImageEverywhere();
    await cutOffRegistry(0);
    const refused = await get(env.clients[0], `/apps/createfolder/${appName}/${appName}/${encodeURIComponent('photos/first')}`);
    expect(refused.status, 'FIXTURE: the node could still get the image').to.equal(503);

    await giveImageTo(1);
    // Past the window in which a failed attempt answers callers without
    // searching again.
    await new Promise((resolve) => { setTimeout(resolve, 61000); });

    const accepted = await get(env.clients[0], `/apps/createfolder/${appName}/${appName}/${encodeURIComponent('photos/second')}`);

    expect(accepted.status, JSON.stringify(accepted.data)).to.equal(200);
    expect(await imageHeldOn(0)).to.equal(true);
  });

  describe('handing it over', () => {
    it('refuses an id this node is not pinned to', async function () {
      this.timeout(60000);
      const other = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

      const answer = await get(env.clients[1], `/apps/fileoperationimage/${other}`);

      expect(answer.status).to.equal(404);
    });

    it('refuses an address that is not a node in the network state', async function () {
      this.timeout(120000);
      // The runner is not a Flux node, so its address is not in any node's
      // network state - which is exactly the caller the endpoint turns away.
      await giveImageTo(1);
      const pinned = await inNode(1, `docker image inspect ${executorImage} --format '{{.Id}}'`);
      const id = pinned.stdout.trim();

      const answer = await get(env.clients[1], `/apps/fileoperationimage/${id}`);

      expect(answer.status).to.equal(403);
    });
  });
});
