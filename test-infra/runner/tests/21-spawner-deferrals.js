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

function findDeferralEvent(env, appName, reason) {
  for (const client of env.clients) {
    const events = client.getEventBuffer();
    const match = events.find(
      (e) => e.event === 'spawner:deferred'
        && e.data?.appName === appName
        && e.data?.reason === reason,
    );
    if (match) return match.data;
  }
  return null;
}

// --- Arcane node tests (default — all nodes have FLUXOS_PATH) ---

describe('Arcane: non-enterprise app deferred as non_enterprise_on_arcane', function () {
  let env;
  const appName = `e2earcdefer${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason non_enterprise_on_arcane', async function () {
    this.timeout(60000);
    const deferred = await anyDeferralEvent(env, appName, 'non_enterprise_on_arcane');
    expect(deferred.reason).to.equal('non_enterprise_on_arcane');
  });

  it('should install after deferral expires', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });
});

describe('Arcane: enterprise app deferred for static_ip', function () {
  let env;
  const appName = `e2eentstatip${Date.now()}`;

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

  it('should defer with reason static_ip and enterprise delay', async function () {
    this.timeout(60000);
    const deferred = await anyDeferralEvent(env, appName, 'static_ip');
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

describe('Arcane: enterprise app deferred for datacenter', function () {
  let env;
  const appName = `e2eentdc${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { enterprise: true, staticip: true });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason datacenter and enterprise delay', async function () {
    this.timeout(60000);
    const deferred = await anyDeferralEvent(env, appName, 'datacenter');
    expect(deferred.reason).to.equal('datacenter');
    expect(deferred.delayMs).to.equal(250);
  });

  it('should install after deferral expires', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });
});

describe('Arcane: enterprise app bypasses all deferrals', function () {
  let env;
  const appName = `e2eentbypass${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({
      nodes: 10,
      tickerAutostart: false,
      configOverrides: { enterpriseAppOwners: ['1L2cmJ69frZTg83izRNJsYwDWh5ZmdoUSx'] },
    });
    await bootAndPeer(env);
    await registerApp(env, appName, { enterprise: true, staticip: true, datacenter: true });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should install without any deferral', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
    const staticIpDefer = findDeferralEvent(env, appName, 'static_ip');
    const datacenterDefer = findDeferralEvent(env, appName, 'datacenter');
    const arcaneDefer = findDeferralEvent(env, appName, 'non_enterprise_on_arcane');
    expect(staticIpDefer, 'should not have static_ip deferral').to.be.null;
    expect(datacenterDefer, 'should not have datacenter deferral').to.be.null;
    expect(arcaneDefer, 'should not have arcane deferral').to.be.null;
  });
});

// --- Legacy node tests (all nodes without FLUXOS_PATH) ---

describe('Legacy: non-enterprise app deferred for static_ip', function () {
  let env;
  const appName = `e2elegstatip${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, legacyNodes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: false });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason static_ip and standard delay', async function () {
    this.timeout(60000);
    const deferred = await anyDeferralEvent(env, appName, 'static_ip');
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

describe('Legacy: non-enterprise app deferred for datacenter', function () {
  let env;
  const appName = `e2elegdc${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, legacyNodes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: true });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should defer with reason datacenter and standard delay', async function () {
    this.timeout(60000);
    const deferred = await anyDeferralEvent(env, appName, 'datacenter');
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

describe('Legacy: non-enterprise app bypasses all deferrals', function () {
  let env;
  const appName = `e2elegbypass${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, legacyNodes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], tickerAutostart: false });
    await bootAndPeer(env);
    await registerApp(env, appName, { staticip: true, datacenter: true });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should install without any deferral', async function () {
    this.timeout(180000);
    await Promise.any(
      env.clients.map((c) => waitForAppInstalled(c, appName, 120000)),
    );
    const staticIpDefer = findDeferralEvent(env, appName, 'static_ip');
    const datacenterDefer = findDeferralEvent(env, appName, 'datacenter');
    const arcaneDefer = findDeferralEvent(env, appName, 'non_enterprise_on_arcane');
    expect(staticIpDefer, 'should not have static_ip deferral').to.be.null;
    expect(datacenterDefer, 'should not have datacenter deferral').to.be.null;
    expect(arcaneDefer, 'should not have arcane deferral').to.be.null;
  });
});
