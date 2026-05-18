import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { dbClient } from '../framework/db-client.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import {
  startTicker, advanceBlock, advanceBlocks, queueAppTx,
} from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForOrchestratorState, waitFor,
} from '../framework/wait.js';

async function bootAndPeer(env, nodeIndices) {
  const clients = nodeIndices.map((i) => env.clients[i]).filter(Boolean);
  for (const client of clients) await waitForDaemonReady(client);
  await Promise.all(clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of clients) {
    await waitForBlockProcessed(client, (d) => d.height > 2100000, 50000);
  }
  await env.startDiscovery(nodeIndices);
  await clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
  await startTicker();
}

describe('Signed sync completes on late-joining node', function () {
  let env;
  const appName = `e2esync${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ nodes: 11, deferredNodes: 1, tickerAutostart: false });
    const initial = Array.from({ length: 10 }, (_, i) => i);
    await bootAndPeer(env, initial);

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName, description: 'sync test',
        repotag: `198.18.0.5:5000/${appName}:v1`,
        ports: [31111], domains: [''], environmentParameters: [], commands: [],
        containerPorts: [80], containerData: '/tmp',
        cpu: 0.1, ram: 100, hdd: 1, repoauth: '',
      }],
    });
    for (let i = 1; i <= 10; i++) {
      const dc = dbClient(i);
      await dc.seedGlobalAppSpec(app.spec);
      await dc.seedPermanentMessage(app.permanentMessage);
      await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
    }
    await queueAppTx(app.hash);
    await advanceBlock();
    await Promise.any(
      env.clients.slice(0, 10).map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should sync app locations via signed 0x21 request', async function () {
    this.timeout(180000);
    const client = await env.startNode(10);
    await waitForDaemonReady(client);
    await waitForNodeStatus(client, (d) => d.confirmed === true, 30000);
    await waitForOrchestratorState(client, 'READY', 120000);

    const res = await client.getAppLocations(appName);
    expect(res.status).to.equal('success');
    expect(res.data).to.be.an('array').with.length.greaterThan(0);
  });
});

describe('Ephemeral connections resolve hashes from non-connected peers', function () {
  let env;
  const appName = `e2eephem${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      nodes: 10,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          hashSyncFallbackRecheckBlocks: 2,
          hashSyncMaxRounds: 1,
          hashSyncEphemeralPeers: 3,
        },
      },
    });
    const indices = Array.from({ length: 10 }, (_, i) => i);
    await bootAndPeer(env, indices);
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should resolve hash via ephemeral connection to non-connected peer', async function () {
    this.timeout(180000);
    const target = env.clients[0];

    const peersRes = await target.getPeers();
    const connectedIps = new Set(peersRes.data);

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName, description: 'ephemeral test',
        repotag: `198.18.0.5:5000/${appName}:v1`,
        ports: [31113], domains: [''], environmentParameters: [], commands: [],
        containerPorts: [80], containerData: '/tmp',
        cpu: 0.1, ram: 100, hdd: 1, repoauth: '',
      }],
    });

    const dc0 = dbClient(1);
    await dc0.seedAppHash(app.hash, app.permanentMessage.height, false);

    for (let i = 2; i <= 10; i++) {
      const nodeIp = `198.18.${i}.0`;
      if (!connectedIps.has(nodeIp)) {
        const dc = dbClient(i);
        await dc.seedPermanentMessage(app.permanentMessage);
        await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
      }
    }

    await advanceBlocks(3);

    await waitFor(async () => {
      const dc = dbClient(1);
      const counts = await dc.hashCounts();
      return counts.missing === 0;
    }, { timeout: 120000, interval: 3000, label: 'hash resolved via ephemeral connection' });

    expect(env.nodeHasLog(0, /Ephemeral round/)).to.be.true;
  });
});
