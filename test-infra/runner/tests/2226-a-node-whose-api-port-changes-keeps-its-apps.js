// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { getAppContainerStatus, restartFluxos, setNodeApiPort } from '../framework/container.js';
import { setNodeAddress, clearNodeAddress } from '../framework/daemon-control.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A node's operator moves its api port on the same IP, 16127 to 16157, and
// restarts FluxOS. Benchmark reports the node at the new port while the network
// still lists it at the old one. The node's collision check finds its own
// collateral listed on its own IP at a port nothing answers at - its former
// port - and that is this node's move: it records the move from the old socket
// address to the new one, tells its peers, and confirms the new port. The daemon
// stub mines that confirmation on the next block.
//
// The app is single-instance. The node's own registry must hold it at the new
// port only: a row left at the old port reads as a second instance on the IP.

const OLD_PORT = 16127;
const NEW_PORT = 16157;
const DETECTION_MS = 8 * 60 * 1000;
// Several surplus-check passes after the move.
const WATCHED_MS = 6 * 60 * 1000;

describe('a node whose api port changes keeps its apps', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let nodeIp;
  const appName = `e2eportmove${Date.now()}`;
  const client = (i) => env.clients[i];
  const isUp = async () => {
    const status = await getAppContainerStatus(client(idx).container, appName);
    return Boolean(status && status.status.startsWith('Up'));
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
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
        description: 'api port move',
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
    idx = await seedAndInstall(env, app);
    nodeIp = subnet.nodeIp(idx + 1);
    await waitFor(isUp, { timeout: 120000, interval: 3000, label: 'the app running before the port moves' });
  });

  after(async function () {
    this.timeout(60000);
    await clearNodeAddress(nodeIp).catch(() => {});
    await env?.teardown();
  });

  it('records its own move to the new port, and every peer holds it', async function () {
    this.timeout(DETECTION_MS + 300000);
    const oldSocket = `${nodeIp}:${OLD_PORT}`;
    const newSocket = `${nodeIp}:${NEW_PORT}`;
    const heldMove = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === newSocket);

    await setNodeApiPort(client(idx).container, NEW_PORT);
    await setNodeAddress(nodeIp, newSocket, { scope: 'benchmark' });
    await restartFluxos(client(idx).container, { apiPort: NEW_PORT });
    await client(idx).followTo(nodeIp, NEW_PORT);

    await waitFor(() => heldMove(idx), { timeout: DETECTION_MS, interval: 5000, label: 'the node records its own move' });
    const peers = [0, 1, 2].filter((i) => i !== idx);
    await waitFor(async () => (await Promise.all(peers.map(heldMove))).every(Boolean), {
      timeout: 240000, interval: 5000, label: 'every peer holds the move',
    });
  });

  it('keeps its app, and holds its own rows only at its new port', async function () {
    this.timeout(WATCHED_MS + 180000);
    await new Promise((resolve) => { setTimeout(resolve, WATCHED_MS); });

    expect(await isUp(), 'the app still runs on the node that moved').to.equal(true);
    const rows = await dbClient(idx + 1).getAppLocations(appName);
    expect(rows.map((row) => row.ip), 'the node\'s own rows for the app').to.deep.equal([`${nodeIp}:${NEW_PORT}`]);
  });
});
