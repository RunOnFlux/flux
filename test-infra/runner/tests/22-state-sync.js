import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { dbClient } from '../framework/db-client.js';
import { buildSeedableApp, buildRunningState } from '../framework/seed-helper.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForOrchestratorState,
} from '../framework/wait.js';
import { waitFor } from '../framework/wait.js';

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

describe('Late-joining node syncs state from peers', function () {
  let env;
  const appNames = [];
  const apps = [];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ nodes: 12, deferredNodes: 2, tickerAutostart: false });

    const initialIndices = Array.from({ length: 10 }, (_, i) => i);
    await bootAndPeer(env, initialIndices);

    // Wait for orchestrator READY on initial nodes
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);

    // Seed 3 apps with full state on the 10 running nodes
    for (let a = 0; a < 3; a++) {
      const name = `e2esync${a}${Date.now()}`;
      appNames.push(name);
      await pushImage(name, 'v1');

      const app = await buildSeedableApp({
        name,
        compose: [{
          name,
          description: 'sync test container',
          repotag: `198.18.0.5:5000/${name}:v1`,
          ports: [31111 + a],
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
      apps.push(app);

      const nodeIps = initialIndices.map((i) => `198.18.${i + 1}.0`);
      const state = buildRunningState({ appName: name, nodeIps, hash: app.hash });

      for (let i = 1; i <= 10; i++) {
        const dc = dbClient(i);
        await dc.seedGlobalAppSpec(app.spec);
        await dc.seedPermanentMessage(app.permanentMessage);
        await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
        for (const loc of state.locations) {
          await dc.seedAppLocation(loc);
        }
        for (const evt of state.stateEvents) {
          await dc.seedAppStateEvent(evt);
        }
      }
    }
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
    await waitForOrchestratorState(env.clients[10], 'READY', 120000);
  });

  it('should have all app specs on the late-joining node', async function () {
    this.timeout(30000);
    for (const name of appNames) {
      const res = await env.clients[10].getAppSpecs(name);
      expect(res.status, `spec for ${name}`).to.equal('success');
      expect(res.data).to.have.property('name', name);
    }
  });

  it('should have app locations on the late-joining node', async function () {
    this.timeout(30000);
    for (const name of appNames) {
      const res = await env.clients[10].getAppLocations(name);
      expect(res.status, `locations for ${name}`).to.equal('success');
      expect(res.data).to.be.an('array').with.length.greaterThan(0);
    }
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
