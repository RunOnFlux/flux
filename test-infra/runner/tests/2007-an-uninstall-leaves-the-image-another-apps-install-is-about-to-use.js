// weight: heavy
/*
 * An uninstall leaves an image another app's install is about to use.
 *
 * Apps A and B run the same image. A is installed on node 1. B's install is held
 * at the checkpoint before it creates its containers - after its pull, the moment
 * the image is on the node with no container of B's referencing it. A is then
 * removed. Its uninstall offers the image for removal while B's install holds B,
 * so the image stays; released, B creates its container from it and runs.
 *
 * The app is delivered to node 1 alone, so no other node's spawner takes either.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { deliverApp } from '../framework/app-delivery.js';
import { execInContainer } from '../framework/container.js';
import { waitForAppInstalled, waitForAppRemoved } from '../framework/wait.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const SUBJECT = 1;
const BEFORE_CONTAINERS = 'install:beforeContainers';

describe('an uninstall leaves the image another app\'s install is about to use', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();
  const image = `e2eshared${stamp}`;
  const repotag = `${REGISTRY_REPO_HOST}/${image}:v1`;
  const appA = `e2eimga${stamp}`;
  const appB = `e2eimgb${stamp}`;
  const subject = () => env.clients[SUBJECT];
  let teamAuth;

  const imageOnNode = async () => (await execInContainer(subject().container, `docker image inspect ${repotag} >/dev/null 2>&1; echo $?`)).stdout.trim() === '0';
  const component = (name) => ({
    name,
    description: 'shared image',
    repotag,
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
  });

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3 });
    await bootAndPeer(env);
    await pushImage(image, 'v1');
    teamAuth = (await authenticate(subject().url, fluxTeamKey())).zelidauth;

    await installOnNodes(env, await buildSeedableApp({
      env, name: appA, instances: 1, compose: [component(appA)],
    }), [SUBJECT]);
    expect(await imageOnNode(), 'fixture: app A\'s image is not on the node').to.equal(true);
  });

  afterTeardown(async function () {
    if (env) await subject().releaseCheckpoint(BEFORE_CONTAINERS, appB).catch(() => {});
    await env?.teardown();
  });

  it('keeps the image through app A\'s uninstall while app B\'s install is between its pull and its container', async function () {
    this.timeout(600000);
    await deliverApp(env, await buildSeedableApp({
      env, name: appB, instances: 1, compose: [component(appB)],
    }), [SUBJECT]);

    const mark = subject().getLastEventId();
    await subject().holdCheckpoint(BEFORE_CONTAINERS, appB);
    const installing = subject().installAppLocally(appB, teamAuth).catch((error) => error);
    await subject().waitForEvent('checkpoint:held', (d) => d.name === BEFORE_CONTAINERS && d.key === appB, 240000, { afterId: mark });

    await subject().removeAppLocally(appA, teamAuth);
    await waitForAppRemoved(subject(), appA, 180000, { afterId: mark });
    expect(await imageOnNode(), 'app A\'s uninstall removed the image app B was about to use').to.equal(true);

    await subject().releaseCheckpoint(BEFORE_CONTAINERS, appB);
    await installing;
    await waitForAppInstalled(subject(), appB, 180000, { afterId: mark });
  });
});
