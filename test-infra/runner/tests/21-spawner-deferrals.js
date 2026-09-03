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
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';

function localRegistryCompose(appName) {
  return [{
    name: appName,
    description: 'test container',
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
  }];
}

async function bootAndPeer(env) {
  for (const client of env.clients) await waitForDaemonReady(client);
  await Promise.all(env.clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of env.clients) {
    await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
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

// One fleet per NODE TYPE, not one per scenario. The five scenarios here differ
// only in the app they register - three on Arcane nodes, two on Legacy - and a
// fleet boot is the most expensive thing this suite does: ten nodes, each building
// its own full index set on the shared mongod. Booting an identical fleet three
// times to register three different apps against it spends ~2,800 index builds to
// learn nothing, and leaves the suite still running when the rest of a gate is at
// its busiest, which is how its last fleet came to overshoot a hook budget.
//
// Each app is still registered immediately before its own tests, so the scenarios
// stay isolated in the way that matters: no test depends on another's app, and a
// deferral is observed against the app that caused it.

// --- Arcane node tests (default - all nodes have FLUXOS_PATH) ---

describe('Arcane spawner deferrals', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('non-enterprise app deferred as non_enterprise_on_arcane', function () {
    const appName = `e2earcdefer${Date.now()}`;

    before(async function () {
      this.timeout(180000);
      await registerApp(env, appName);
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

  describe('enterprise app deferred for static_ip', function () {
    const appName = `e2eentstatip${Date.now()}`;

    before(async function () {
      this.timeout(180000);
      await registerApp(env, appName, { enterprise: true, staticip: false });
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

  describe('enterprise app deferred for datacenter', function () {
    const appName = `e2eentdc${Date.now()}`;

    before(async function () {
      this.timeout(180000);
      await registerApp(env, appName, { enterprise: true, staticip: true });
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
});

// --- Legacy node tests (all nodes without FLUXOS_PATH) ---

describe('Legacy spawner deferrals', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({
      hookCtx: this, nodes: 10, legacyNodes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], tickerAutostart: false,
    });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('non-enterprise app deferred for static_ip', function () {
    const appName = `e2elegstatip${Date.now()}`;

    before(async function () {
      this.timeout(180000);
      await registerApp(env, appName, { staticip: false });
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

  describe('non-enterprise app deferred for datacenter', function () {
    const appName = `e2elegdc${Date.now()}`;

    before(async function () {
      this.timeout(180000);
      await registerApp(env, appName, { staticip: true });
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
});
