// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { getAppContainerStatus, moveNodeAddress } from '../framework/container.js';
import { setNodeAddress, clearNodeAddress } from '../framework/daemon-control.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A node's public address moves and benchmark is the first to notice: it reports
// the new address as the node's own while the network still lists the old one.
// The node's collision check then finds its own collateral listed at an address
// nothing answers at - its own former address - and that is this node's move,
// not another machine's: it records the move, tells its peers, and confirms the
// new address. The daemon stub mines that confirmation on the next block, so the
// list moves while peers may still be hearing the move, and they accept it either
// way.
//
// The app is single-instance. The node's own registry must hold it at the new
// address only: a row left at the old address reads as a second instance there,
// and the surplus check removes the app from the node that is actually running it.

const DETECTION_MS = 8 * 60 * 1000;
// Several surplus-check passes after the move.
const WATCHED_MS = 6 * 60 * 1000;

describe('a node that notices its move through benchmark first keeps its apps', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let nodeIp;
  let movedIp;
  const appName = `e2ebenchfirst${Date.now()}`;
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
        description: 'benchmark-first move',
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
    movedIp = nodeIp.replace(/\.\d+$/, '.240');
    await waitFor(isUp, { timeout: 120000, interval: 3000, label: 'the app running before the move' });
  });

  after(async function () {
    this.timeout(60000);
    await clearNodeAddress(nodeIp).catch(() => {});
    await env?.teardown();
  });

  it('records its own move, and every peer holds it', async function () {
    this.timeout(DETECTION_MS + 300000);
    const oldSocket = `${nodeIp}:16127`;
    const newSocket = `${movedIp}:16127`;
    const heldMove = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === newSocket);

    await moveNodeAddress(client(idx).container, movedIp, nodeIp);
    await client(idx).followTo(movedIp);
    await setNodeAddress(nodeIp, movedIp, { scope: 'benchmark' });

    await waitFor(() => heldMove(idx), { timeout: DETECTION_MS, interval: 5000, label: 'the node records its own move' });
    const peers = [0, 1, 2].filter((i) => i !== idx);
    await waitFor(async () => (await Promise.all(peers.map(heldMove))).every(Boolean), {
      timeout: 240000, interval: 5000, label: 'every peer holds the move',
    });
  });

  it('keeps its app, and holds its own rows only at its new address', async function () {
    this.timeout(WATCHED_MS + 180000);
    await new Promise((resolve) => { setTimeout(resolve, WATCHED_MS); });

    expect(await isUp(), 'the app still runs on the node that moved').to.equal(true);
    const rows = await dbClient(idx + 1).getAppLocations(appName);
    expect(rows.map((row) => String(row.ip).split(':')[0]), 'the node\'s own rows for the app').to.deep.equal([movedIp]);
    // eslint-disable-next-line no-restricted-syntax
    for (const peer of [0, 1, 2].filter((i) => i !== idx)) {
      // eslint-disable-next-line no-await-in-loop
      const held = await dbClient(peer + 1).getAppLocations(appName);
      expect(held.map((row) => String(row.ip).split(':')[0]), `node ${peer}'s rows for the app`).to.deep.equal([movedIp]);
    }
  });
});
