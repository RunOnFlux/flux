// weight: medium
/*
 * A container FluxOS took down is not called tampering when its absence outlasts the
 * call that took it down: a FluxOS restart before the container is created again,
 * and a removal docker finishes after FluxOS stopped waiting for it.
 *
 * FluxOS records each container it takes down in the component's runtime state
 * before it sends the removal, and clears the record when the container is created
 * again. In both cases the app's row describes the component and its container is
 * gone, so the reconciler recreates it; it reads the record first, and records no
 * container_vanished. The tampering decision is made and written before the
 * recreate, so once the container is back the rows are final.
 *
 * Restart: an owner's soft redeploy of the component is held at install:beforePull,
 * after its container is removed and before the new one is created, and FluxOS is
 * restarted there.
 *
 * Late removal: an owner's soft redeploy of the app is held at
 * container:beforeRemove, with its container stopped and the removal recorded, and
 * the node's docker data root is frozen (framework/host-stall.js) before it goes on,
 * so docker's removal is held in the kernel. FluxOS waits dockerRequestTimeoutMs,
 * gives up, and the redeploy fails with the container still there; the reconciler
 * finds docker removing it. Thawed, docker finishes the removal.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import {
  execInContainer, getAppContainerId, listAppContainers, restartFluxos,
} from '../framework/container.js';
import {
  DOCKER_ROOT, freezeDocker, thawDocker, thawEveryNode,
} from '../framework/host-stall.js';
import { waitFor } from '../framework/wait.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const BEFORE_PULL = 'install:beforePull';
const BEFORE_REMOVE = 'container:beforeRemove';
const HOLDER = 0;
// how long FluxOS waits for one docker request before it gives up on it
const DOCKER_REQUEST_MS = 15000;

describe('a container FluxOS took down is not tampering', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2etookdown${Date.now()}`;
  const component = `${appName}a`;
  const containerName = `flux${component}_${appName}`;
  let holder;
  let auth;

  const container = async () => (await listAppContainers(holder.container, { all: true }))
    .find((c) => c.name === containerName) ?? null;

  // The route is cached on its URL; the unique parameter makes each read a fresh one.
  async function tamperingEvents() {
    const res = await holder.get(`/apps/tamperingevents/${appName}?_=${Date.now()}`);
    expect(res.status, `tamperingevents refused: ${JSON.stringify(res)}`).to.equal('success');
    return res.data;
  }

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      freezableDockerRoot: [HOLDER],
      configOverrides: { fluxapps: { dockerRequestTimeoutMs: DOCKER_REQUEST_MS } },
    });
    await bootAndPeer(env);
    holder = env.clients[HOLDER];

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      env,
      name: appName,
      compose: [{
        name: component,
        description: 'a component taken down and restarted around',
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
      async () => (await container())?.status?.startsWith('Up'),
      { timeout: 120000, interval: 2000, label: `${containerName} running before the redeploy` },
    );
    auth = await authenticate(holder.url, appOwnerKey());
  });

  afterTeardown(async function () {
    if (env) await thawEveryNode(env.clients);
    if (env) await holder.releaseCheckpoint(BEFORE_REMOVE, containerName).catch(() => {});
    await env?.teardown();
  });

  // rows written since `since`: a row is updated in place when its incident recurs
  const recreatedWithoutTampering = async (before, since) => {
    await waitFor(
      async () => (await container())?.status?.startsWith('Up'),
      { timeout: 300000, interval: 2000, label: `${containerName} recreated` },
    );
    const recreated = await getAppContainerId(holder.container, appName, component);
    expect(recreated, 'canary: the container is the one from before the redeploy').to.not.equal(before);

    const vanished = (await tamperingEvents())
      .filter((e) => e.eventType === 'container_vanished' && Date.parse(e.lastSeen) >= since);
    expect(vanished, `FluxOS called its own removal tampering: ${JSON.stringify(vanished)}`).to.have.lengthOf(0);
  };

  it('recreates the component without recording container_vanished after a restart', async function () {
    this.timeout(420000);
    const since = Date.now();
    const before = await getAppContainerId(holder.container, appName, component);
    expect(before, 'fixture: no container before the redeploy').to.be.a('string');

    const mark = holder.getLastEventId();
    await holder.holdCheckpoint(BEFORE_PULL, appName);
    // FluxOS is killed while this request streams, so its end is a broken connection
    holder.redeployComponent(appName, component, auth.zelidauth).catch(() => {});
    await holder.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_PULL && d.key === appName, 240000, { afterId: mark });
    expect(await container(), 'fixture: the redeploy held with its container still in place').to.equal(null);

    await restartFluxos(holder.container);

    await recreatedWithoutTampering(before, since);
  });

  it('recreates the component without recording container_vanished after a removal docker finished late', async function () {
    this.timeout(600000);
    await waitFor(
      async () => (await container())?.status?.startsWith('Up'),
      { timeout: 120000, interval: 2000, label: `${containerName} running before the redeploy` },
    );
    const since = Date.now();
    const before = await getAppContainerId(holder.container, appName, component);

    const mark = holder.getLastEventId();
    await holder.holdCheckpoint(BEFORE_REMOVE, containerName);
    holder.redeployApp(appName, auth.zelidauth).catch(() => {});
    await holder.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_REMOVE && d.key === containerName, 240000, { afterId: mark });
    await freezeDocker(holder.container);
    await holder.releaseCheckpoint(BEFORE_REMOVE, containerName);
    await holder.waitForEvent('app:softRedeployed', (d) => d.name === appName && d.outcome === 'failed', 2 * DOCKER_REQUEST_MS + 60000, { afterId: mark });
    // The container's directory under the data root, which docker deletes in its removal,
    // read from the filesystem: the freeze holds writes, never reads. dockerd is not asked,
    // since listing a container reads its image from the frozen root.
    const containerDir = `${DOCKER_ROOT}/containers/${before}`;
    const held = await execInContainer(holder.container, `test -d ${containerDir}`);
    expect(held.exitCode, `canary: docker had finished the removal before FluxOS gave up (${containerDir}, exit ${held.exitCode}): ${held.output}`).to.equal(0);

    await thawDocker(holder.container);
    await waitFor(
      async () => (await getAppContainerId(holder.container, appName, component)) !== before,
      { timeout: 120000, interval: 1000, label: 'docker finishes the removal once thawed' },
    );

    await recreatedWithoutTampering(before, since);
  });
});
