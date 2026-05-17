import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import {
  execInContainer, killAppContainer, getAppContainerStatus,
} from '../framework/container.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppSpecStored, waitForAppInstalled, waitForBootSettled,
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

async function registerAndInstall(env, appName) {
  await pushImage(appName, 'v1');
  const spec = buildAppSpec({
    name: appName,
    compose: localRegistryCompose(appName),
    instances: 3,
  });
  const regResult = await registerAndConfirm(
    env.clients[0].url, nodeKey(1), spec, env.clients,
  );
  expect(regResult.status).to.equal('success');
  await waitForBlockProcessed(
    env.clients[0], (d) => d.height >= regResult.targetHeight, 60000,
  );
  await waitForAppSpecStored(env.clients[0], appName);

  const installed = await Promise.any(
    env.clients.map(async (c, i) => {
      await waitForAppInstalled(c, appName, 120000);
      return i;
    }),
  );
  return installed;
}

describe('reconcileAppsOnBoot restarts containers after simulated reboot', function () {
  let env;
  let installedOnIndex;
  const appName = `e2erecon${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    installedOnIndex = await registerAndInstall(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should reconcile app container after simulated reboot', async function () {
    this.timeout(180000);
    const nodeNum = installedOnIndex + 1;
    const dc = dbClient(nodeNum);

    // Simulate a machine reboot by changing the stored boot ID
    await dc.writeHeartbeat({
      machineBootId: 'old-boot-id',
      lastAlive: Date.now(),
      shutdownReason: 'sigterm',
    });

    // Restart the FluxOS container
    const client = await env.restartNode(installedOnIndex);

    // Wait for boot to complete — reconcileAppsOnBoot should start the stopped app containers
    await waitForBootSettled(client, 120000);

    // Verify app container is running after reconciliation
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 3000, label: 'app container running after reconciliation' });
  });
});

describe('containerHealthMonitor recreates killed container', function () {
  let env;
  let installedOnIndex;
  const appName = `e2ehealth${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    installedOnIndex = await registerAndInstall(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should recreate container after docker rm -f', async function () {
    this.timeout(120000);
    const client = env.clients[installedOnIndex];

    // Verify container is running first
    const before = await getAppContainerStatus(client.container, appName);
    expect(before, 'app container should exist before kill').to.not.be.null;
    expect(before.status).to.match(/^Up/);

    // Kill the container (rm -f — container disappears entirely)
    await killAppContainer(client.container, appName, appName);

    // Verify it's gone
    const afterKill = await getAppContainerStatus(client.container, appName);
    expect(afterKill, 'container should be gone after kill').to.be.null;

    // Wait for health monitor to recreate it (1 broadcast cycle = ~30s)
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 90000, interval: 5000, label: 'container recreated by health monitor' });
  });
});

describe('containerHealthMonitor restarts stopped container', function () {
  let env;
  let installedOnIndex;
  const appName = `e2estop${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    installedOnIndex = await registerAndInstall(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should restart container after docker stop', async function () {
    this.timeout(180000);
    const client = env.clients[installedOnIndex];
    const containerName = `flux${appName}_${appName}`;

    // Stop the container (it still exists, just in Exited state)
    await execInContainer(client.container, `docker stop ${containerName}`);

    // Verify it's stopped
    const afterStop = await getAppContainerStatus(client.container, appName);
    expect(afterStop).to.not.be.null;
    expect(afterStop.status).to.not.match(/^Up/);

    // Wait for health monitor double-check pattern (2 broadcast cycles = ~60s)
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 120000, interval: 5000, label: 'stopped container restarted by health monitor' });
  });
});
