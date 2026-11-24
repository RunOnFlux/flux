// weight: medium
/*
 * A node removes the images nothing wants, on its block-paced pass: a cold tagged
 * image goes; an image a stopped container uses, and FluxOS's own file-operation
 * image, stay; and while an app's install is between its pull and its container,
 * the pass removes nothing.
 *
 * The images are put on node 1's own docker by hand: one cold (pulled, no
 * container), one under a container that is created and never started. The block
 * ticker is stopped once the fleet is up, so a pass runs only when the suite drives
 * the chain to one: block by block until the node reports the pass due
 * (blockWork:ran), then that pass's images:reaped. imageReapPeriod is 1, so a pass
 * falls due within a few blocks.
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
import { waitFor, waitForAppInstalled, waitForBlockProcessed } from '../framework/wait.js';
import { driveUntil, getState, stopTicker } from '../framework/daemon-control.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const SUBJECT = 1;
const BEFORE_CONTAINERS = 'install:beforeContainers';
const PASS_MS = 120000;
// period 1, times 4 after the fork: due within 4 blocks; twice that
const PASS_BLOCKS = 8;

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
  const eventsOf = (name, predicate = () => true, afterId = 0) => subject().getEventBuffer()
    .filter((e) => e.id > afterId && e.event === name && predicate(e.data));
  const passesDue = (afterId) => eventsOf('blockWork:ran', (d) => d.job === 'imageReap', afterId);
  // Drives the chain one block at a time to the block a pass falls due on, and
  // returns that pass's outcome: exactly one pass, started now.
  const pass = async () => {
    const mark = subject().getLastEventId();
    await driveUntil(subject(), async () => passesDue(mark).length > 0, { blocks: PASS_BLOCKS, label: 'an image pass falls due' });
    const [due] = passesDue(mark);
    return (await subject().waitForEvent('images:reaped', () => true, PASS_MS, { afterId: due.id })).data;
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: { fluxapps: { imageReapPeriod: 1 } },
    });
    await mirrorExecutorImage();
    await bootAndPeer(env);
    await stopTicker();
    // No pass is running when a test starts: the one at boot and one for every block
    // a pass fell due on have all reported.
    await subject().waitForEvent('images:reaped', () => true, PASS_MS);
    const { currentHeight } = await getState();
    await waitForBlockProcessed(subject(), (d) => d.height >= currentHeight, 120000);
    await waitFor(
      async () => eventsOf('images:reaped').length >= 1 + passesDue().length,
      { timeout: PASS_MS, interval: 1000, label: 'every image pass started has reported' },
    );
    // content of their own, so neither is the same image as any app's
    await pushImage(`e2ecold${stamp}`, 'v1', `cold-${stamp}`);
    await pushImage(`e2ekept${stamp}`, 'v1', `kept-${stamp}`);
  });

  afterTeardown(async function () {
    if (env) await subject().releaseCheckpoint(BEFORE_CONTAINERS, appB).catch(() => {});
    await env?.teardown();
  });

  it('removes nothing while an app\'s install is between its pull and its container, and the cold image once it has finished', async function () {
    this.timeout(600000);
    const teamAuth = (await authenticate(subject().url, fluxTeamKey())).zelidauth;
    await deliverApp(env, await buildSeedableApp({ env, name: appB, instances: 1 }), [SUBJECT]);

    const mark = subject().getLastEventId();
    await subject().holdCheckpoint(BEFORE_CONTAINERS, appB);
    const installing = subject().installAppLocally(appB, teamAuth).catch((error) => error);
    await subject().waitForEvent('checkpoint:held', (d) => d.name === BEFORE_CONTAINERS && d.key === appB, 240000, { afterId: mark });

    await pull(cold);

    const during = await pass();
    expect(await held(cold), 'the cold image went while an install was building').to.equal(true);
    expect(during.removed, 'a pass removed an image while an install was building').to.equal(0);
    expect(during.deferred, 'canary: the pass found the cold image').to.be.at.least(1);

    await subject().releaseCheckpoint(BEFORE_CONTAINERS, appB);
    await installing;
    await waitForAppInstalled(subject(), appB, 180000, { afterId: mark });
    await pass();
    expect(await held(cold), 'the cold image is still on the node').to.equal(false);
  });

  it('keeps an image a stopped container uses, and FluxOS\'s own file-operation image', async function () {
    this.timeout(300000);
    await pull(kept);
    await pull(executorImage);
    const created = await inNode(`docker create --name e2ekeeper${stamp} ${kept} >/dev/null && echo ok`);
    expect(created.stdout.trim(), `fixture: the container was not created: ${created.output}`).to.equal('ok');
    await pull(cold);

    await pass();

    expect(await held(cold), 'canary: the pass removed nothing at all').to.equal(false);
    expect(await held(kept), 'an image a stopped container uses was removed').to.equal(true);
    expect(await held(executorImage), 'FluxOS\'s own image was removed').to.equal(true);
  });
});
