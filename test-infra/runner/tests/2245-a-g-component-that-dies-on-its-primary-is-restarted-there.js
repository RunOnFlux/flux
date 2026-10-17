import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { isDaemonUp, isFolderSynced, getFolderConfig } from '../framework/syncthing-real.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An app with two single-writer (g:) components, on real syncthing daemons. One of
// them dies on the primary while its FluxOS, its syncthing and the other component
// go on running.
//
// The primary still holds the app: it runs the other component, and its folders
// still send. It starts the dead one again where it was. A standby that started it
// would run the app on two nodes - the one it started, beside the one the primary
// still runs - so no other node starts any of its g: components meanwhile.

const APP_UID = 1000;

describe('a g: component that dies on its primary is restarted there', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2egdies${Date.now()}`;
  const COMPONENTS = ['db', 'web'];
  // Placed in this order, so the election ranks them in it; a third node holds
  // nothing and keeps the ring whole.
  const PRIMARY = 0;
  const STANDBY = 1;
  const HOLDERS = [PRIMARY, STANDBY];

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost, holdsFor } = watchGComponents(() => env, {
    appName, components: COMPONENTS, holders: HOLDERS,
  });
  // When docker last started a component's container on a node.
  const startedAt = async (i, name) => {
    const r = await execInContainer(client(i).container, `docker inspect -f '{{.State.StartedAt}}' ${folderOf(name)}`);
    if (r.exitCode !== 0 || !r.stdout.trim()) throw new Error(`docker inspect ${folderOf(name)} on node ${i} failed: ${r.stderr || r.stdout}`);
    return r.stdout.trim();
  };
  // Kills the given components on the primary, and holds until it runs every g:
  // component again, each killed one in a container docker started after the kill.
  const restartedInPlace = async (names, label) => {
    const before = await Promise.all(names.map((name) => startedAt(PRIMARY, name)));
    await Promise.all(names.map((name) => execInContainer(client(PRIMARY).container, `docker kill ${folderOf(name)}`)));
    await waitHolding(async () => {
      const running = await oneHolderAtMost();
      if (running[PRIMARY].length !== COMPONENTS.length) return false;
      const after = await Promise.all(names.map((name) => startedAt(PRIMARY, name)));
      return after.every((at, k) => at !== before[k]);
    }, { timeout: 300000, interval: 2000, label: `${label}: the primary runs every g: component again, the killed ones restarted` });
    await holdsFor(60000, { [PRIMARY]: COMPONENTS, [STANDBY]: [] });
    expect(await Promise.all(COMPONENTS.map(async (name) => (await getFolderConfig(client(PRIMARY), folderOf(name)))?.type)), 'the primary\'s folders')
      .to.deep.equal(['sendreceive', 'sendreceive']);
  };

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

    await pushTestApp(appName, 'v1', 'gdies', { user: APP_UID });
    const app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: COMPONENTS.map((name) => gComponent(appName, name)),
    });
    await installOnNodes(env, app, [PRIMARY]);
    await waitHolding(async () => (await oneHolderAtMost())[PRIMARY].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the primary runs every g: component',
    });
    await installOnNodes(env, app, [STANDBY]);
    await Promise.all(COMPONENTS.map((name) => waitFor(() => isFolderSynced(client(STANDBY), folderOf(name)), {
      timeout: 300000, interval: 3000, label: `the standby has the primary's ${name} data`,
    })));
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('restarts the second g: component on the primary when it dies there', async function () {
    this.timeout(600000);
    await restartedInPlace(['web'], 'web killed');
  });

  it('restarts the first g: component on the primary when it dies there', async function () {
    this.timeout(600000);
    await restartedInPlace(['db'], 'db killed');
  });

  it('restarts both on the primary when both die there and its FluxOS goes on running', async function () {
    this.timeout(600000);
    await restartedInPlace(COMPONENTS, 'db and web killed');
  });
});
