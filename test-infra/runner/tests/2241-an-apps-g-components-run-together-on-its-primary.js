import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, stopDaemon, startDaemon,
} from '../framework/syncthing-real.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An app with two single-writer (g:) components, on real syncthing daemons: its
// primary runs both, and every other holder runs neither. Every wait holds that no
// two nodes run any of its g: components at once (g-components.js).

const APP_UID = 1000;

describe('an app\'s g: components run together on its primary', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2etwin${Date.now()}`;
  const COMPONENTS = ['db', 'web'];
  // Placed in this order, so the election ranks them in it; a third node holds
  // nothing and keeps the ring whole.
  const FIRST = 0;
  const SECOND = 1;
  const HOLDERS = [FIRST, SECOND];

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost, holdsFor } = watchGComponents(() => env, {
    appName, components: COMPONENTS, holders: HOLDERS,
  });
  const folderTypes = async (i) => Promise.all(COMPONENTS.map(async (component) => (await getFolderConfig(client(i), folderOf(component)))?.type));

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushTestApp(appName, 'v1', 'twin', { user: APP_UID });
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: COMPONENTS.map((name) => gComponent(appName, name)),
    });

    await installOnNodes(env, app, [FIRST]);
    await waitHolding(async () => (await oneHolderAtMost())[FIRST].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the first holder runs every g: component',
    });
    await installOnNodes(env, app, [SECOND]);
    await Promise.all(COMPONENTS.map((component) => waitFor(() => isFolderSynced(client(SECOND), folderOf(component)), {
      timeout: 300000, interval: 3000, label: `the second holder has the primary's ${component} data`,
    })));
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('runs every g: component on the primary, and none on the standby', async function () {
    this.timeout(180000);
    await holdsFor(60000, { [FIRST]: COMPONENTS, [SECOND]: [] });
    expect(await folderTypes(FIRST), 'the primary\'s folders').to.deep.equal(['sendreceive', 'sendreceive']);
    expect(await folderTypes(SECOND), 'the standby\'s folders').to.deep.equal(['receiveonly', 'receiveonly']);
  });

  it('moves every g: component together when the primary dies', async function () {
    this.timeout(420000);
    // The whole machine: the process, the containers and the daemon.
    await crashFluxos(client(FIRST).container, { hold: true });
    await Promise.all(COMPONENTS.map((component) => execInContainer(client(FIRST).container, `docker kill ${folderOf(component)}`)));
    await stopDaemon(client(FIRST));

    await waitHolding(async () => (await oneHolderAtMost())[SECOND].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the second holder runs every g: component',
    });
    await waitFor(async () => (await folderTypes(SECOND)).every((type) => type === 'sendreceive'), {
      timeout: 120000, interval: 2000, label: 'every folder of the new primary sends',
    });
  });

  it('brings the old primary back as a standby of the whole app', async function () {
    this.timeout(420000);
    await startDaemon(client(FIRST), { paused: true });
    await releaseFluxos(client(FIRST).container);

    await waitFor(async () => (await folderTypes(FIRST)).every((type) => type === 'receiveonly'), {
      timeout: 300000, interval: 3000, label: 'every folder of the old primary receives',
    });
    await holdsFor(60000, { [FIRST]: [], [SECOND]: COMPONENTS });
  });
});
