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
    compose: localRegistryCompose(appName),
    instances: 3,
    ...specOverrides,
  });
  const regResult = await registerAndConfirm(
    env.clients[0].url, nodeKey(1), spec, env.clients,
  );
  expect(regResult.status).to.equal('success');
  await waitForBlockProcessed(
    env.clients[0], (d) => d.height >= regResult.targetHeight, 60000,
  );
  await waitForAppSpecStored(env.clients[0], appName);
}

describe('Spawner deferral — static IP node, app without staticip', function () {
  let env;
  const appName = `e2estaticip${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: false });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason static_ip and correct delay', async function () {
    this.timeout(60000);
    const deferred = await waitForSpawnerDeferred(env.clients[0], appName, 'static_ip', 30000);
    expect(deferred.reason).to.equal('static_ip');
    expect(deferred.delayMs).to.equal(400);
  });

  it('should install after deferral expires', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });
});

describe('Spawner deferral — static IP bypass with staticip: true', function () {
  let env;
  const appName = `e2enostatip${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: true });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should install without static_ip deferral', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
    const events = env.clients[0].getEventBuffer();
    const deferral = events.find(
      (e) => e.event === 'spawner:deferred' && e.data?.appName === appName && e.data?.reason === 'static_ip',
    );
    expect(deferral, 'should not have static_ip deferral').to.be.undefined;
  });
});

describe('Spawner deferral — datacenter node, app without datacenter', function () {
  let env;
  const appName = `e2edc${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: true });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason datacenter and correct delay', async function () {
    this.timeout(60000);
    const deferred = await waitForSpawnerDeferred(env.clients[0], appName, 'datacenter', 30000);
    expect(deferred.reason).to.equal('datacenter');
    expect(deferred.delayMs).to.equal(500);
  });

  it('should install after deferral expires', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });
});

describe('Spawner deferral — non-enterprise app on arcane node', function () {
  let env;
  const appName = `e2earcane${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: true, datacenter: true });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason non_enterprise_on_arcane', async function () {
    this.timeout(60000);
    const deferred = await waitForSpawnerDeferred(env.clients[0], appName, 'non_enterprise_on_arcane', 30000);
    expect(deferred.reason).to.equal('non_enterprise_on_arcane');
  });

  it('should install after deferral expires', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });
});

describe('Spawner deferral — enterprise app gets shorter static IP delay', function () {
  let env;
  const appName = `e2eentdefer${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { enterprise: true, staticip: false });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with enterprise static_ip delay (shorter than standard)', async function () {
    this.timeout(60000);
    const deferred = await waitForSpawnerDeferred(env.clients[0], appName, 'static_ip', 30000);
    expect(deferred.reason).to.equal('static_ip');
    expect(deferred.delayMs).to.equal(200);
  });

  it('should install after deferral expires', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });
});
