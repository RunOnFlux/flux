import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import {
  execInContainer, killAppContainer, getAppContainerStatus,
} from '../framework/container.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForBootSettled,
} from '../framework/wait.js';
import { waitFor } from '../framework/wait.js';

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

async function seedAndWaitForInstall(env, appName) {
  await pushImage(appName, 'v1');
  const app = await buildSeedableApp({
    name: appName,
    compose: [{
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
    }],
  });

  for (let i = 1; i <= env.nodeCount; i++) {
    const dc = dbClient(i);
    await dc.seedGlobalAppSpec(app.spec);
    await dc.seedPermanentMessage(app.permanentMessage);
    await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
  }

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
    installedOnIndex = await seedAndWaitForInstall(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should reconcile app container after simulated reboot', async function () {
    this.timeout(180000);
    const nodeNum = installedOnIndex + 1;
    const dc = dbClient(nodeNum);
    const client = env.clients[installedOnIndex];

    await dc.writeHeartbeat({
      machineBootId: 'old-boot-id',
      lastAlive: Date.now(),
      shutdownReason: 'sigterm',
    });

    await env.restartNode(installedOnIndex);

    await waitForBootSettled(client, 120000);

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
    installedOnIndex = await seedAndWaitForInstall(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should recreate container after docker rm -f', async function () {
    this.timeout(120000);
    const client = env.clients[installedOnIndex];

    const beforeKill = await getAppContainerStatus(client.container, appName);
    expect(beforeKill, 'container should exist before kill').to.not.be.null;

    await killAppContainer(client.container, appName, appName);

    const afterKill = await getAppContainerStatus(client.container, appName);
    expect(afterKill, 'container should be gone after kill').to.be.null;

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
    installedOnIndex = await seedAndWaitForInstall(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should restart container after docker stop', async function () {
    this.timeout(180000);
    const client = env.clients[installedOnIndex];
    const containerName = `flux${appName}_${appName}`;

    await execInContainer(client.container, `docker stop ${containerName}`);

    const afterStop = await getAppContainerStatus(client.container, appName);
    expect(afterStop).to.not.be.null;
    expect(afterStop.status).to.not.match(/^Up/);

    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 120000, interval: 5000, label: 'stopped container restarted by health monitor' });
  });
});
