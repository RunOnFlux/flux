import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { pushImage, pushUpdatedImage } from '../framework/registry-helper.js';
import { getContainerImageDigest } from '../framework/container.js';
import { startTicker, advanceBlock, advanceBlocks } from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForAppSpecStored,
  waitForImageUpdateRedeploy, waitForImageUpdateRedeployComplete,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

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

describe('Non-enterprise image update redeploy', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eimgupd${Date.now()}`;
  let installedNodeIndex;

  before(async function () {
    this.timeout(300000);

    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);

    await pushImage(appName, 'v1');

    const spec = buildAppSpec({
      name: appName,
      compose: localRegistryCompose(appName),
      instances: 3,
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

    const installed = await Promise.any(
      env.clients.map((c, i) =>
        waitForAppInstalled(c, appName, 180000).then(() => i),
      ),
    );
    installedNodeIndex = installed;
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should have height in local DB after initial install', async function () {
    const res = await env.clients[installedNodeIndex].getInstalledApps();
    expect(res.status).to.equal('success');
    const app = res.data.find((a) => a.name === appName);
    expect(app, 'app not in installed apps').to.exist;
    expect(app.height, 'height missing from installed app').to.be.a('number');
    expect(app.height).to.be.greaterThan(0);
  });

  it('should preserve height after image update triggers soft redeploy', async function () {
    this.timeout(180000);

    const beforeRes = await env.clients[installedNodeIndex].getInstalledApps();
    const originalApp = beforeRes.data.find((a) => a.name === appName);
    const originalHeight = originalApp.height;

    const newDigest = await pushUpdatedImage(appName, 'v1');

    await waitForImageUpdateRedeployComplete(
      env.clients[installedNodeIndex], appName, 120000,
    );

    const afterRes = await env.clients[installedNodeIndex].getInstalledApps();
    const updatedApp = afterRes.data.find((a) => a.name === appName);
    expect(updatedApp, 'app not found after redeploy').to.exist;
    expect(updatedApp.height, 'height lost after redeploy').to.equal(originalHeight);

    const runningDigest = await getContainerImageDigest(
      env.clients[installedNodeIndex].container, appName, appName,
    );
    expect(runningDigest, 'running image digest should match pushed').to.equal(newDigest);
  });

  it('should survive expiry check after redeploy', async function () {
    this.timeout(60000);

    await advanceBlocks(8);
    await waitForBlockProcessed(env.clients[installedNodeIndex], () => true, 30000);

    await new Promise((r) => setTimeout(r, 5000));

    const events = env.clients[installedNodeIndex].getEventBuffer();
    const removalEvent = events.find(
      (e) => e.event === 'app:removed' && e.data?.name === appName,
    );
    expect(removalEvent, 'app was removed by expiry check').to.be.undefined;

    const res = await env.clients[installedNodeIndex].getInstalledApps();
    const app = res.data.find((a) => a.name === appName);
    expect(app, 'app missing from installed apps after expiry').to.exist;
  });
});

describe('Enterprise image update redeploy', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eentupd${Date.now()}`;
  let installedNodeIndex;

  before(async function () {
    this.timeout(300000);

    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);

    await pushImage(appName, 'v1');

    const spec = buildAppSpec({
      name: appName,
      compose: localRegistryCompose(appName),
      enterprise: true,
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
      env.clients.map((c, i) =>
        waitForAppInstalled(c, appName, 180000).then(() => i),
      ),
    );
    installedNodeIndex = installed;
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should install enterprise app with height and encrypted compose', async function () {
    const res = await env.clients[installedNodeIndex].getInstalledApps();
    expect(res.status).to.equal('success');
    const app = res.data.find((a) => a.name === appName);
    expect(app, 'app not in installed apps').to.exist;
    expect(app.height, 'height missing').to.be.a('number');
    expect(app.height).to.be.greaterThan(0);
    expect(app.enterprise, 'enterprise field missing').to.be.a('string').that.is.not.empty;
    expect(app.compose, 'compose should be empty for enterprise').to.deep.equal([]);
  });

  it('should preserve height after image update triggers soft redeploy', async function () {
    this.timeout(180000);

    const beforeRes = await env.clients[installedNodeIndex].getInstalledApps();
    const originalApp = beforeRes.data.find((a) => a.name === appName);
    const originalHeight = originalApp.height;

    const newDigest = await pushUpdatedImage(appName, 'v1');

    await waitForImageUpdateRedeployComplete(
      env.clients[installedNodeIndex], appName, 120000,
    );

    const afterRes = await env.clients[installedNodeIndex].getInstalledApps();
    const updatedApp = afterRes.data.find((a) => a.name === appName);
    expect(updatedApp, 'app not found after redeploy').to.exist;
    expect(updatedApp.height, 'height lost after redeploy').to.equal(originalHeight);
    expect(updatedApp.enterprise, 'enterprise field lost').to.be.a('string').that.is.not.empty;

    const runningDigest = await getContainerImageDigest(
      env.clients[installedNodeIndex].container, appName, appName,
    );
    expect(runningDigest, 'running image digest should match pushed').to.equal(newDigest);
  });

  it('should survive expiry check after redeploy', async function () {
    this.timeout(60000);

    await advanceBlocks(8);
    await waitForBlockProcessed(env.clients[installedNodeIndex], () => true, 30000);

    await new Promise((r) => setTimeout(r, 5000));

    const events = env.clients[installedNodeIndex].getEventBuffer();
    const removalEvent = events.find(
      (e) => e.event === 'app:removed' && e.data?.name === appName,
    );
    expect(removalEvent, 'app was removed by expiry check').to.be.undefined;

    const res = await env.clients[installedNodeIndex].getInstalledApps();
    const app = res.data.find((a) => a.name === appName);
    expect(app, 'app missing after expiry').to.exist;
    expect(app.height, 'height missing after expiry').to.be.a('number');
  });
});
