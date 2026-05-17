import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppSpecStored, waitForAppInstalled, waitForSpawnerDeferred,
} from '../framework/wait.js';

function localRegistryCompose(appName, { cpu = 0.1, ram = 100, hdd = 1 } = {}) {
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
    cpu,
    ram,
    hdd,
    repoauth: '',
  }];
}

async function bootAndPeer(env) {
  for (const client of env.clients) await waitForDaemonReady(client);
  await Promise.all(env.clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of env.clients) {
    await waitForBlockProcessed(client, (d) => d.height > 2100000, 50000);
  }
  await env.startDiscovery();
  await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await env.clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
  await startTicker();
}

async function registerApp(env, appName, specOverrides = {}) {
  await pushImage(appName, 'v1');
  const spec = buildAppSpec({
    name: appName,
    compose: localRegistryCompose(appName, specOverrides.hw),
    instances: 3,
    ...specOverrides,
  });
  delete spec.hw;
  const regResult = await registerAndConfirm(
    env.clients[0].url, nodeKey(1), spec, env.clients,
  );
  if (regResult.status !== 'success') {
    console.log('Registration failed:', JSON.stringify(regResult).substring(0, 500));
  }
  expect(regResult.status).to.equal('success');
  await waitForBlockProcessed(
    env.clients[0], (d) => d.height >= regResult.targetHeight, 60000,
  );
  await waitForAppSpecStored(env.clients[0], appName);
}

function anyDeferralEvent(env, appName, reason) {
  return Promise.any(
    env.clients.map((c) => waitForSpawnerDeferred(c, appName, reason, 30000)),
  );
}

// --- Targeted nodes deferral ---

describe('Spawner: targeted_nodes deferral', function () {
  let env;
  const appName = `e2etarget${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { nodes: ['198.18.5.0'] });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason targeted_nodes on non-target nodes', async function () {
    this.timeout(60000);
    const deferred = await anyDeferralEvent(env, appName, 'targeted_nodes');
    expect(deferred.reason).to.equal('targeted_nodes');
    expect(deferred.delayMs).to.equal(300);
  });

  it('should install on the target node', async function () {
    this.timeout(180000);
    await waitForAppInstalled(env.clients[4], appName, 120000);
  });
});

// --- Capacity gap deferrals ---

const allLegacy = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function allTiers(tier) {
  return Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, tier]));
}

describe('Spawner: capacity_gap_large — stratus tier, small app', function () {
  let env;
  const appName = `e2ecglarge${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({
      nodes: 10,
      legacyNodes: allLegacy,
      nodeTiers: allTiers('STRATUS'),
      dataCenter: false,
      tickerAutostart: false,
    });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: true });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason capacity_gap_large', async function () {
    this.timeout(60000);
    const deferred = await anyDeferralEvent(env, appName, 'capacity_gap_large');
    expect(deferred.reason).to.equal('capacity_gap_large');
    expect(deferred.delayMs).to.equal(700);
  });

  it('should install after deferral expires', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });
});

describe('Spawner: capacity_gap_medium — stratus tier, medium app', function () {
  let env;
  const appName = `e2ecgmed${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({
      nodes: 10,
      legacyNodes: allLegacy,
      nodeTiers: allTiers('STRATUS'),
      dataCenter: false,
      tickerAutostart: false,
    });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: true, hw: { cpu: 4, ram: 8000, hdd: 200 } });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason capacity_gap_medium', async function () {
    this.timeout(60000);
    const deferred = await anyDeferralEvent(env, appName, 'capacity_gap_medium');
    expect(deferred.reason).to.equal('capacity_gap_medium');
    expect(deferred.delayMs).to.equal(800);
  });

  it('should install after deferral expires', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });
});

describe('Spawner: capacity_gap_small — nimbus tier, small app', function () {
  let env;
  const appName = `e2ecgsmall${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({
      nodes: 10,
      legacyNodes: allLegacy,
      nodeTiers: allTiers('NIMBUS'),
      dataCenter: false,
      tickerAutostart: false,
    });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: true });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason capacity_gap_small', async function () {
    this.timeout(60000);
    const deferred = await anyDeferralEvent(env, appName, 'capacity_gap_small');
    expect(deferred.reason).to.equal('capacity_gap_small');
    expect(deferred.delayMs).to.equal(900);
  });

  it('should install after deferral expires', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });
});
