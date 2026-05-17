import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { dbClient } from '../framework/db-client.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { startTicker, advanceBlock, queueAppTx } from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForOrchestratorState,
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

describe('State sync: app running state (0x21)', function () {
  let env;
  const appName = `e2esynrun${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ nodes: 12, deferredNodes: 2, tickerAutostart: false });
    const initial = Array.from({ length: 10 }, (_, i) => i);
    await bootAndPeer(env, initial);

    // Seed global spec + permanent message + hash on all 10 nodes
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'sync test',
        repotag: `198.18.0.5:5000/${appName}:v1`,
        ports: [31111],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1, ram: 100, hdd: 1,
        repoauth: '',
      }],
    });
    for (let i = 1; i <= 10; i++) {
      const dc = dbClient(i);
      await dc.seedGlobalAppSpec(app.spec);
      await dc.seedPermanentMessage(app.permanentMessage);
      await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
    }

    // Put hash in a block so late-joiner's explorer finds it
    await queueAppTx(app.hash);
    await advanceBlock();

    // Wait for spawner to install on at least one node
    await Promise.any(
      env.clients.slice(0, 10).map((c) => waitForAppInstalled(c, appName, 120000)),
    );

    // Wait for running broadcast to propagate across network
    await Promise.any(
      env.clients.slice(0, 10).map((c) => c.waitForEvent('network:apprunning',
        (d) => d.apps?.some((a) => a.name === appName), 60000)),
    );
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should sync app locations to late-joining node', async function () {
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

describe('State sync: hash resolution', function () {
  let env;
  const appName = `e2esynhash${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ nodes: 12, deferredNodes: 2, tickerAutostart: false });
    const initial = Array.from({ length: 10 }, (_, i) => i);
    await bootAndPeer(env, initial);
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);

    // Seed permanent message on all 10 nodes (but NOT the spec — that comes from hash resolution)
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'hash sync test',
        repotag: `198.18.0.5:5000/${appName}:v1`,
        ports: [31112],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1, ram: 100, hdd: 1,
        repoauth: '',
      }],
    });
    for (let i = 1; i <= 10; i++) {
      const dc = dbClient(i);
      await dc.seedPermanentMessage(app.permanentMessage);
      await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
    }

    // Put hash in a block so late-joiner's explorer finds it
    await queueAppTx(app.hash);
    await advanceBlock();
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should resolve hashes and create app spec on late-joining node', async function () {
    this.timeout(180000);
    const client = await env.startNode(10);
    await waitForDaemonReady(client);
    await waitForNodeStatus(client, (d) => d.confirmed === true, 30000);
    await waitForOrchestratorState(client, 'READY', 120000);

    const dc = dbClient(11);
    const counts = await dc.hashCounts();
    expect(counts.resolved).to.be.greaterThan(0);
    expect(counts.missing).to.equal(0);

    const msgCount = await dc.permanentMessageCount();
    expect(msgCount).to.be.greaterThan(0);

    const res = await client.getAppSpecs(appName);
    expect(res.status).to.equal('success');
    expect(res.data).to.have.property('name', appName);
  });
});
