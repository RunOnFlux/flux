// weight: medium
/*
 * A node removes the images nothing wants, on its block-paced pass: a cold tagged
 * image goes; an image a stopped container uses, and FluxOS's own file-operation
 * image, stay; and while an app's install is between its pull and its container,
 * the pass removes nothing.
 *
 * The images are put on node 1's own docker by hand: one cold (pulled, no
 * container), one under a container that is created and never started. The pass
 * runs every imageReapPeriod x 4 blocks; the suite sets it to 1, so a pass runs
 * every few seconds of the ticker, and each pass is read from images:reaped.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage, mirrorExecutorImage, executorImageReference } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { deliverApp } from '../framework/app-delivery.js';
import { execInContainer } from '../framework/container.js';
import { waitForAppInstalled } from '../framework/wait.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const SUBJECT = 1;
const BEFORE_CONTAINERS = 'install:beforeContainers';
const PASS_MS = 120000;

describe('a node removes the images nothing wants', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();
  const cold = `${REGISTRY_REPO_HOST}/e2ecold${stamp}:v1`;
  const kept = `${REGISTRY_REPO_HOST}/e2ekept${stamp}:v1`;
  const appB = `e2ereapb${stamp}`;
  const subject = () => env.clients[SUBJECT];
  const executorImage = executorImageReference();

  const inNode = (command) => execInContainer(subject().container, command);
  const held = async (reference) => (await inNode(`docker image inspect ${reference} >/dev/null 2>&1; echo $?`)).stdout.trim() === '0';
  const pull = async (reference) => {
    const pulled = await inNode(`docker pull -q ${reference}`);
    expect(pulled.exitCode, `fixture: ${reference} could not be pulled: ${pulled.output}`).to.equal(0);
  };
  // the first pass that starts after `mark`
  const nextPass = async (mark) => (await subject().waitForEvent('images:reaped', () => true, PASS_MS, { afterId: mark })).data;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: { fluxapps: { imageReapPeriod: 1 } },
    });
    await mirrorExecutorImage();
    await bootAndPeer(env);
    await pushImage(`e2ecold${stamp}`, 'v1');
    await pushImage(`e2ekept${stamp}`, 'v1');
  });

  afterTeardown(async function () {
    if (env) await subject().releaseCheckpoint(BEFORE_CONTAINERS, appB).catch(() => {});
    await env?.teardown();
  });

  it('removes nothing while an app\'s install is between its pull and its container, and the cold image once it has finished', async function () {
    this.timeout(600000);
    await pull(cold);
    const teamAuth = (await authenticate(subject().url, fluxTeamKey())).zelidauth;
    await deliverApp(env, await buildSeedableApp({ env, name: appB, instances: 1 }), [SUBJECT]);

    const mark = subject().getLastEventId();
    await subject().holdCheckpoint(BEFORE_CONTAINERS, appB);
    const installing = subject().installAppLocally(appB, teamAuth).catch((error) => error);
    await subject().waitForEvent('checkpoint:held', (d) => d.name === BEFORE_CONTAINERS && d.key === appB, 240000, { afterId: mark });

    const during = await nextPass(subject().getLastEventId());
    expect(during.removed, 'a pass removed an image while an install was building').to.equal(0);
    expect(during.deferred, 'canary: the pass found the cold image').to.be.at.least(1);
    expect(await held(cold), 'the cold image went while an install was building').to.equal(true);

    await subject().releaseCheckpoint(BEFORE_CONTAINERS, appB);
    await installing;
    await waitForAppInstalled(subject(), appB, 180000, { afterId: mark });
    await nextPass(subject().getLastEventId());
    expect(await held(cold), 'the cold image is still on the node').to.equal(false);
  });

  it('keeps an image a stopped container uses, and FluxOS\'s own file-operation image', async function () {
    this.timeout(300000);
    await pull(kept);
    await pull(executorImage);
    const created = await inNode(`docker create --name e2ekeeper${stamp} ${kept} >/dev/null && echo ok`);
    expect(created.stdout.trim(), `fixture: the container was not created: ${created.output}`).to.equal('ok');
    await pull(cold);

    await nextPass(subject().getLastEventId());

    expect(await held(cold), 'canary: the pass removed nothing at all').to.equal(false);
    expect(await held(kept), 'an image a stopped container uses was removed').to.equal(true);
    expect(await held(executorImage), 'FluxOS\'s own image was removed').to.equal(true);
  });
});
