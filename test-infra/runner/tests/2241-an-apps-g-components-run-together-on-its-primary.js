import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  execInContainer, listAppContainers, crashFluxos, releaseFluxos,
} from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, stopDaemon, startDaemon,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An app with two single-writer (g:) components, on real syncthing daemons.
//
// The election decides the app, not each component: its primary runs every g:
// component on one node, and every other holder runs none. A node running one of
// them and not the other is the app split across two nodes - the load balancer
// sends all of its ports to one of them, and the components cannot reach each
// other over the app's network - so every wait below holds that no two nodes run
// any of its g: components at once.

const APP_UID = 1000;

describe('an app\'s g: components run together on its primary', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2etwin${Date.now()}`;
  const COMPONENTS = ['db', 'web'];
  const folderOf = (component) => `flux${component}_${appName}`;
  // Placed in this order, so the election ranks them in it; a third node holds
  // nothing and keeps the ring whole.
  const FIRST = 0;
  const SECOND = 1;
  const HOLDERS = [FIRST, SECOND];

  const client = (i) => env.clients[i];
  // The app's g: components running on a node, in compose order.
  const runningOn = async (i) => {
    const containers = await listAppContainers(client(i).container);
    return COMPONENTS.filter((component) => containers.some(
      (c) => c.name === `flux${component}_${appName}` && c.status?.startsWith('Up'),
    ));
  };
  // Which holders run any of the app's g: components; asserted on every poll.
  const oneHolderAtMost = async () => {
    const running = await Promise.all(HOLDERS.map(runningOn));
    const holders = HOLDERS.filter((_, k) => running[k].length);
    expect(holders.length, `the app runs on more than one node: ${HOLDERS.map((i, k) => `node ${i} runs [${running[k]}]`).join(', ')}`).to.be.at.most(1);
    return Object.fromEntries(HOLDERS.map((i, k) => [i, running[k]]));
  };
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
      compose: COMPONENTS.map((component) => ({
        name: component,
        description: `${component} of a two-writer app`,
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [`WRITE_FILE=/appdata/${component}.txt`, `WRITE_CONTENT=${component}`],
        commands: [],
        containerPorts: [80],
        containerData: 'g:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      })),
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
    // Held over several election passes, not read once.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const running = await oneHolderAtMost();
      expect(running[FIRST], 'the primary').to.deep.equal(COMPONENTS);
      expect(running[SECOND], 'the standby').to.deep.equal([]);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(5000);
    }
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
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const running = await oneHolderAtMost();
      expect(running[FIRST], 'the old primary').to.deep.equal([]);
      expect(running[SECOND], 'the primary').to.deep.equal(COMPONENTS);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(5000);
    }
  });
});
