// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { crashFluxos, getAppContainerStatus, stopAppContainer } from '../framework/container.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { bootAndPeer, installSeededOnNodes } from '../framework/reconciler-suite.js';
import { deliverAppByBlock } from '../framework/app-delivery.js';
import { advanceBlock, startTicker, stopTicker } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A second machine starts on the collateral of a node running a single-instance
// app. Whatever the second machine is, the collateral serves from one node and the
// app runs on one node: every node of the fleet is watched from the second
// machine's start until the network has settled, and a moment the app runs on two
// fails the case.
//
// A machine installed afresh on the collateral finds the listed node answering,
// holds itself out of service and runs nothing, and the app stays where it is.
// When the listed node's machine dies, the collateral goes to the second machine,
// the app comes back on exactly one node, and no move is announced: a second
// machine taking a collateral over is not the listed node moving.
//
// A machine started from a clone of the listed node's disk holds the app and reads
// its new address as the node having moved: it confirms there, the chain lists the
// collateral there, and the listed node holds itself out of service and gives the
// app up, which the network places again.

// Three nodes start together, so the fleet peers past the threshold and holds
// policy, which an install needs; the second machine starts after them.
const LISTED = 0;
const BYSTANDER = 1;
const OTHER = 2;
const COPY = 3;
// The collision check's grace and the confirmation's block, from the death.
const COLLATERAL_MS = 6 * 60 * 1000;
// The dead node's location lifetime (63s in this fleet), then a spawn and a start.
const RESPAWN_MS = 6 * 60 * 1000;
const OUT_OF_SERVICE = 100;

const listedAt = (i) => `${subnet.nodeIp(i + 1)}:16127`;
const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:16127`);

/**
 * Three nodes, the app registered on chain and running on the listed node, and
 * the second machine not yet started.
 * @param {object} hookCtx
 * @param {string} appName
 * @returns {Promise<{env: object, app: object}>}
 */
async function fleetRunningTheApp(hookCtx, appName) {
  const env = await createTestEnv({
    hookCtx,
    nodes: 4,
    deferredNodes: 1,
    collateralOf: { [COPY + 1]: LISTED + 1 },
    tickerAutostart: false,
    configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
  });
  await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  await pushImage(appName, 'v1');
  const app = await buildSeedableApp({
    name: appName,
    instances: 1,
    compose: [{
      name: 'alpha',
      description: 'an app on a collateral two machines run on',
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
  // Registered on chain, as on the network: the three online hold the app from the
  // owner's broadcast and the payment.
  const online = [LISTED, BYSTANDER, OTHER];
  await stopTicker();
  await deliverAppByBlock(env, app, online);
  await advanceBlock();
  await startTicker();
  await waitFor(async () => (await Promise.all(online.map((i) => dbClient(i + 1).globalAppSpec(appName))))
    .every((row) => row?.hash === app.hash), { timeout: 120000, interval: 2000, label: 'every node online holds the app' });
  await installSeededOnNodes(env, app, [LISTED]);
  return { env, app };
}

/**
 * Where the chain lists the collateral, seen from a node that answers.
 * @param {object} env
 * @returns {Promise<string|null>}
 */
async function collateralAt(env) {
  const list = await env.clients[BYSTANDER].get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`);
  return (list.data || []).map((node) => socketOf(node.ip)).find((ip) => ip === listedAt(LISTED) || ip === listedAt(COPY)) ?? null;
}

async function isUp(env, appName, i) {
  const status = await getAppContainerStatus(env.clients[i].container, appName);
  return Boolean(status && status.status.startsWith('Up'));
}

async function dosStateOf(env, i) {
  return (await env.clients[i].getDOSState()).data?.dosState;
}

/**
 * Watches every node for the app until stopped, noting the first moment it runs on
 * more than one. A node that cannot be asked counts as not running it.
 * @param {object} env
 * @param {string} appName
 * @returns {{runningOn: () => Promise<number[]>, stop: () => Promise<{at: string, nodes: number[]}|null>}}
 */
function watchRunsOnce(env, appName) {
  let twice = null;
  let stopped = false;
  const nodes = () => env.clients.map((_unused, i) => i).filter((i) => env.clients[i]);
  const runningOn = async () => {
    const up = await Promise.all(nodes().map((i) => isUp(env, appName, i).catch(() => false)));
    const on = nodes().filter((_unused, k) => up[k]);
    if (on.length > 1 && !twice) twice = { at: new Date().toISOString(), nodes: on };
    return on;
  };
  const loop = (async () => {
    while (!stopped) {
      // eslint-disable-next-line no-await-in-loop
      await runningOn();
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
  })();
  return {
    runningOn,
    stop: async () => {
      stopped = true;
      await loop;
      return twice;
    },
  };
}

/**
 * Holds until the app has run on exactly one node for the whole of `ms`, the
 * window in which a location left to lapse is lapsed and the app placed again.
 * @param {{runningOn: () => Promise<number[]>}} watch
 * @param {number} ms
 * @returns {Promise<number>} the node that runs it
 */
async function runsOnOneThroughout(watch, ms) {
  const deadline = Date.now() + ms;
  let on = await watch.runningOn();
  while (Date.now() < deadline) {
    expect(on, 'the nodes running the app').to.have.lengthOf(1);
    // eslint-disable-next-line no-await-in-loop
    await sleepUnlessInfraDead(3000);
    // eslint-disable-next-line no-await-in-loop
    on = await watch.runningOn();
  }
  expect(on, 'the nodes running the app').to.have.lengthOf(1);
  return on[0];
}

describe('a second machine installed afresh on the collateral of a node running an app', function () {
  let env;
  let watch;
  dumpLogsOnFailure(() => env);
  const appName = `e2ecopyapp${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    ({ env } = await fleetRunningTheApp(this, appName));
    await waitFor(() => isUp(env, appName, LISTED), { timeout: 120000, interval: 3000, label: 'the app running on the listed node' });
    watch = watchRunsOnce(env, appName);
    await env.startNode(COPY);
  });

  after(async function () {
    this.timeout(60000);
    await watch?.stop();
    await env?.teardown();
  });

  it('holds itself out of service while the listed node answers, and leaves the app where it is', async function () {
    this.timeout(420000);
    await waitFor(async () => (await dosStateOf(env, COPY)) >= OUT_OF_SERVICE, {
      timeout: 360000, interval: 5000, label: 'the second machine holds itself out of service',
    });

    expect(await collateralAt(env), 'the collateral is listed at the node that answers').to.equal(listedAt(LISTED));
    expect(await isUp(env, appName, LISTED), 'the app runs on the listed node').to.equal(true);
    expect(await isUp(env, appName, COPY), 'the app runs on the second machine').to.equal(false);
  });

  it('when the listed node dies, takes the collateral, the app comes back once, and no move is announced', async function () {
    this.timeout(COLLATERAL_MS + RESPAWN_MS + 120000);
    await crashFluxos(env.clients[LISTED].container, { hold: true });
    await stopAppContainer(env.clients[LISTED].container, appName, 'alpha');
    await env.disconnectNode(LISTED);

    await waitFor(async () => (await collateralAt(env)) === listedAt(COPY), {
      timeout: COLLATERAL_MS, interval: 5000, label: 'the collateral listed at the second machine',
    });
    await waitFor(async () => (await dosStateOf(env, COPY)) === 0, {
      timeout: 180000, interval: 5000, label: 'the second machine back in service',
    });
    const alive = [BYSTANDER, OTHER, COPY];
    const running = async () => (await Promise.all(alive.map((i) => isUp(env, appName, i)))).filter(Boolean).length;
    await waitFor(async () => (await running()) > 0, {
      timeout: RESPAWN_MS, interval: 5000, label: 'the app running again',
    });

    await runsOnOneThroughout(watch, RESPAWN_MS);
    expect(await watch.stop(), 'the app ran on two nodes').to.equal(null);
    const moves = await dbClient(BYSTANDER + 1).getAppStateEvents({ ip: listedAt(LISTED), type: 'ipchanged' });
    expect(moves, 'moves of the listed node the bystander holds').to.deep.equal([]);
  });
});

describe('a second machine started from a clone of the listed node\'s disk', function () {
  let env;
  let app;
  dumpLogsOnFailure(() => env);
  const appName = `e2ecloneapp${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    ({ env, app } = await fleetRunningTheApp(this, appName));
    await waitFor(() => isUp(env, appName, LISTED), { timeout: 120000, interval: 3000, label: 'the app running on the listed node' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('takes the collateral over, the listed node stands aside, and the app runs on one node', async function () {
    this.timeout(COLLATERAL_MS + (2 * RESPAWN_MS) + 120000);
    await dbClient(COPY + 1).cloneFrom(LISTED + 1);
    const watch = watchRunsOnce(env, appName);
    try {
      await env.startNode(COPY);
      expect((await dbClient(COPY + 1).globalAppSpec(appName))?.hash, 'fixture: the clone holds the app').to.equal(app.hash);

      await waitFor(async () => (await collateralAt(env)) === listedAt(COPY)
        && (await dosStateOf(env, LISTED)) >= OUT_OF_SERVICE, {
        timeout: COLLATERAL_MS, interval: 5000, label: 'the collateral at the clone and the listed node out of service',
      });
      // A node out of service gives its apps up, so the app is placed again.
      await waitFor(async () => !(await isUp(env, appName, LISTED)), {
        timeout: 120000, interval: 3000, label: 'the listed node gave the app up',
      });
      await waitFor(async () => (await watch.runningOn()).length === 1, {
        timeout: RESPAWN_MS, interval: 5000, label: 'the app running on one node again',
      });
      await runsOnOneThroughout(watch, RESPAWN_MS);
    } finally {
      expect(await watch.stop(), 'the app ran on two nodes').to.equal(null);
    }
  });
});
