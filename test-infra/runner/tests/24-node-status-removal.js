import { describe, it, before, after } from 'mocha';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { dbClient } from '../framework/db-client.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';

const subnet = getSubnetConfig();
import {
  startTicker, advanceBlock, setNodeStatus, enableRpcFailure,
} from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled,
} from '../framework/wait.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

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
      repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
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

describe('Confirmation loss removes installed apps', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let installedOnIndex;
  const appName = `e2econfirm${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    installedOnIndex = await seedAndWaitForInstall(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should remove app when node loses confirmation', async function () {
    this.timeout(120000);
    const nodeIp = subnet.nodeIp(installedOnIndex + 1);
    const client = env.clients[installedOnIndex];

    await setNodeStatus(nodeIp, 'EXPIRED');
    await client.waitForEvent('confirmation:changed', (d) => d.confirmed === false, 30000);

    await waitFor(async () => {
      const res = await client.getInstalledApps();
      return res.status === 'success' && !res.data.find((a) => a.name === appName);
    }, { timeout: 60000, interval: 2000, label: 'app removed after confirmation loss' });
  });
});

describe('Daemon stale removes installed apps', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let installedOnIndex;
  const appName = `e2edaemonstale${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    // fast stale window: this suite exercises the stale-removal flow directly
    // (the fleet default is stall-proof and would take minutes here)
    env = await createTestEnv({
      hookCtx: this,
      nodes: 10,
      tickerAutostart: false,
      configOverrides: { confirmation: { daemonStaleMs: 10000, daemonExpiredMs: 20000 } },
    });
    await bootAndPeer(env);
    installedOnIndex = await seedAndWaitForInstall(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should remove app when daemon becomes stale', async function () {
    this.timeout(120000);
    const nodeIp = subnet.nodeIp(installedOnIndex + 1);
    const client = env.clients[installedOnIndex];

    await enableRpcFailure(nodeIp);

    await waitFor(async () => {
      const res = await client.getInstalledApps();
      return res.status === 'success' && !res.data.find((a) => a.name === appName);
    }, { timeout: 60000, interval: 2000, label: 'app removed after daemon stale' });
  });
});
