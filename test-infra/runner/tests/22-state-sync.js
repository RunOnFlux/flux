import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppSpecStored, waitForAppInstalled, waitForOrchestratorState,
} from '../framework/wait.js';
import { waitFor } from '../framework/wait.js';

function localRegistryCompose(appName) {
  return [{
    name: appName,
    description: 'test container',
    repotag: `198.18.0.5:5000/${appName}:v1`,
    ports: [31111],
    domains: [''],
    environmentParameters: [],
    commands: [],
    containerPorts: [80],
    containerData: '/tmp',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
  }];
}

async function bootAndPeer(env, nodeIndices = null) {
  const clients = nodeIndices
    ? nodeIndices.map((i) => env.clients[i]).filter(Boolean)
    : env.clients.filter(Boolean);

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

describe('Late-joining node syncs state from peers', function () {
  let env;
  const appName = `e2esync${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    // 12 nodes: 10 running + 2 deferred (for late-join testing)
    env = await createTestEnv({ nodes: 12, deferredNodes: 2, tickerAutostart: false });

    // Boot and peer only the first 10 nodes
    const initialIndices = Array.from({ length: 10 }, (_, i) => i);
    await bootAndPeer(env, initialIndices);

    // Register an app on the initial 10 nodes
    await pushImage(appName, 'v1');
    const spec = buildAppSpec({
      name: appName,
      compose: localRegistryCompose(appName),
      instances: 3,
    });
    const regResult = await registerAndConfirm(
      env.clients[0].url, nodeKey(1), spec, env.clients.slice(0, 10),
    );
    expect(regResult.status).to.equal('success');
    await waitForBlockProcessed(
      env.clients[0], (d) => d.height >= regResult.targetHeight, 60000,
    );
    await waitForAppSpecStored(env.clients[0], appName);

    // Wait for app to install on at least one node
    await Promise.any(
      env.clients.slice(0, 10).map((c) => waitForAppInstalled(c, appName, 120000)),
    );

    // Wait for a running broadcast to propagate (app:running event)
    await env.clients[0].waitForEvent('app:running', (d) => d.apps?.some((a) => a.name === appName), 60000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should start the late-joining node', async function () {
    this.timeout(60000);
    const client = await env.startNode(10);
    await waitForDaemonReady(client);
    await waitForNodeStatus(client, (d) => d.confirmed === true, 30000);
  });

  it('should reach orchestrator READY on the late-joining node', async function () {
    this.timeout(180000);
    const client = env.clients[10];
    await waitForOrchestratorState(client, 'READY', 120000);
  });

  it('should have the app spec on the late-joining node', async function () {
    this.timeout(30000);
    const client = env.clients[10];
    const res = await client.getAppSpecs(appName);
    expect(res.status).to.equal('success');
    expect(res.data).to.have.property('name', appName);
  });

  it('should have app locations on the late-joining node', async function () {
    this.timeout(30000);
    const client = env.clients[10];
    const res = await client.getAppLocations(appName);
    expect(res.status).to.equal('success');
    expect(res.data).to.be.an('array').with.length.greaterThan(0);
  });

  it('should have permanent messages on the late-joining node', async function () {
    this.timeout(30000);
    const dc = dbClient(11);
    const count = await dc.permanentMessageCount();
    expect(count).to.be.greaterThan(0);
  });

  it('should have resolved app hashes on the late-joining node', async function () {
    this.timeout(30000);
    const dc = dbClient(11);
    const counts = await dc.hashCounts();
    expect(counts.resolved).to.be.greaterThan(0);
    expect(counts.missing).to.equal(0);
  });
});
