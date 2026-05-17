import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import {
  startTicker, advanceBlock, setNodeStatus,
  clearNodeStatus, enableRpcFailure,
} from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppSpecStored, waitForAppInstalled,
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

describe('Confirmation loss removes installed apps', function () {
  let env;
  let installedOnIndex;
  const appName = `e2econfirm${Date.now()}`;

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

  it('should remove app when node loses confirmation', async function () {
    this.timeout(120000);
    const nodeIp = `198.18.${installedOnIndex + 1}.0`;
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
  let installedOnIndex;
  const appName = `e2edaemonstale${Date.now()}`;

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

  it('should remove app when daemon becomes stale', async function () {
    this.timeout(120000);
    const nodeIp = `198.18.${installedOnIndex + 1}.0`;
    const client = env.clients[installedOnIndex];

    await enableRpcFailure(nodeIp);

    await waitFor(async () => {
      const res = await client.getInstalledApps();
      return res.status === 'success' && !res.data.find((a) => a.name === appName);
    }, { timeout: 60000, interval: 2000, label: 'app removed after daemon stale' });
  });
});
