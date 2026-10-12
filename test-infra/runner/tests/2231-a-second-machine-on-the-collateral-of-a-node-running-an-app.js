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
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A second machine starts on the collateral of a node running a single-instance
// app. While the listed node answers, the second machine holds itself out of
// service and runs nothing, and the app stays where it is. When the listed node's
// machine dies, the collateral goes to the second machine, the app comes back on
// exactly one node, and no move is announced: a second machine taking a
// collateral over is not the listed node moving.

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

describe('a second machine on the collateral of a node running an app', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ecopyapp${Date.now()}`;
  const client = (i) => env.clients[i];
  const listedAt = (i) => `${subnet.nodeIp(i + 1)}:16127`;
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:16127`);
  const collateralAt = async () => {
    const list = await client(BYSTANDER).get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`);
    return (list.data || []).map((node) => socketOf(node.ip)).find((ip) => ip === listedAt(LISTED) || ip === listedAt(COPY)) ?? null;
  };
  const isUp = async (i) => {
    const status = await getAppContainerStatus(client(i).container, appName);
    return Boolean(status && status.status.startsWith('Up'));
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
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
    await installOnNodes(env, app, [LISTED]);
    await waitFor(() => isUp(LISTED), { timeout: 120000, interval: 3000, label: 'the app running on the listed node' });
    await env.startNode(COPY);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('holds itself out of service while the listed node answers, and leaves the app where it is', async function () {
    this.timeout(420000);
    await waitFor(async () => (await client(COPY).getDOSState()).data?.dosState >= 100, {
      timeout: 360000, interval: 5000, label: 'the second machine holds itself out of service',
    });

    expect(await collateralAt(), 'the collateral is listed at the node that answers').to.equal(listedAt(LISTED));
    expect(await isUp(LISTED), 'the app runs on the listed node').to.equal(true);
    expect(await isUp(COPY), 'the app runs on the second machine').to.equal(false);
  });

  it('when the listed node dies, takes the collateral, the app comes back once, and no move is announced', async function () {
    this.timeout(COLLATERAL_MS + RESPAWN_MS + 120000);
    await crashFluxos(client(LISTED).container, { hold: true });
    await stopAppContainer(client(LISTED).container, appName, 'alpha');
    await env.disconnectNode(LISTED);

    await waitFor(async () => (await collateralAt()) === listedAt(COPY), {
      timeout: COLLATERAL_MS, interval: 5000, label: 'the collateral listed at the second machine',
    });
    await waitFor(async () => (await client(COPY).getDOSState()).data?.dosState === 0, {
      timeout: 180000, interval: 5000, label: 'the second machine back in service',
    });
    const alive = [BYSTANDER, OTHER, COPY];
    const running = async () => (await Promise.all(alive.map(isUp))).filter(Boolean).length;
    await waitFor(async () => (await running()) > 0, {
      timeout: RESPAWN_MS, interval: 5000, label: 'the app running again',
    });

    expect(await running(), 'the nodes running the app').to.equal(1);
    const moves = await dbClient(BYSTANDER + 1).getAppStateEvents({ ip: listedAt(LISTED), type: 'ipchanged' });
    expect(moves, 'moves of the listed node the bystander holds').to.deep.equal([]);
  });
});
