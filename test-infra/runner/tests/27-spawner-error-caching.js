import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { pushBrokenImage, pushImage } from '../framework/registry-helper.js';
import { advanceBlock, startTicker, stopTicker } from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForOrchestratorState, waitForAppSpecStored,
  waitFor,
} from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const REGISTRY = '198.18.0.5:5000';

describe('Spawner error caching: local install failure', function () {
  let env;
  const appName = `e2eBroken${Date.now()}`;
  const repoName = 'broken-app';
  const brokenRepotag = `${REGISTRY}/${repoName}:v1`;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    for (const c of env.clients) await waitForDaemonReady(c);
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await advanceBlock();
    for (const c of env.clients) {
      await waitForBlockProcessed(c, (d) => d.height > 2100000, 50000);
    }

    // Push broken image to test registry before discovery so it's available when spawner tries
    await pushBrokenImage(repoName, 'v1');

    await env.startDiscovery();
    await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);

    await startTicker();

    const spec = buildAppSpec({
      name: appName,
      instances: 3,
      compose: [{
        name: appName,
        description: 'broken test app',
        repotag: brokenRepotag,
        ports: [39111],
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
    const result = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
    expect(result.status).to.equal('success');
    await waitForBlockProcessed(env.clients[0], (d) => d.height >= result.targetHeight, 60000);
    await waitForAppSpecStored(env.clients[0], appName);
  });

  after(async function () {
    this.timeout(30000);
    await stopTicker().catch(() => {});
    await env?.teardown();
  });

  it('should emit installFailed event after broken app install attempt', async function () {
    this.timeout(180000);
    const event = await Promise.any(
      env.clients.map((c) => c.waitForEvent(
        'spawner:installFailed',
        (d) => d.appName === appName,
        170000,
      )),
    );
    expect(event.data.appName).to.equal(appName);
    expect(event.data.hash).to.be.a('string');
  });

  it('should broadcast install error to other nodes', async function () {
    this.timeout(60000);
    // At least one other node should have received the error broadcast
    const received = await Promise.any(
      env.clients.map((c) => c.waitForEvent(
        'network:appinstallingerror',
        (d) => d.name === appName,
        50000,
      )),
    );
    expect(received.data.name).to.equal(appName);
  });

  it('should not retry the app on the node that failed (7-day cache)', async function () {
    this.timeout(60000);
    // Find which node had the installFailed event
    let failedNodeIdx = -1;
    for (let i = 0; i < env.clients.length; i++) {
      const buf = env.clients[i].getEventBuffer();
      if (buf.some((e) => e.event === 'spawner:installFailed' && e.data.appName === appName)) {
        failedNodeIdx = i;
        break;
      }
    }
    expect(failedNodeIdx).to.be.gte(0, 'should have found a node with installFailed');

    const mark = env.clients[failedNodeIdx].getLastEventId();

    // Wait and verify no second install attempt on the same node
    await new Promise((r) => { setTimeout(r, 30000); });

    const buf = env.clients[failedNodeIdx].getEventBuffer();
    const retries = buf.filter(
      (e) => e.id > mark && e.event === 'spawner:installFailed' && e.data.appName === appName,
    );
    expect(retries.length).to.equal(0, 'failed node should not retry the app');
  });
});

describe('Spawner error caching: network-wide error skip', function () {
  let env;
  const appName = `e2eNetErr${Date.now()}`;
  const goodRepoName = 'good-app';
  const goodRepotag = `${REGISTRY}/${goodRepoName}:v1`;
  let appHash;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    for (const c of env.clients) await waitForDaemonReady(c);
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await advanceBlock();
    for (const c of env.clients) {
      await waitForBlockProcessed(c, (d) => d.height > 2100000, 50000);
    }

    await pushImage(goodRepoName, 'v1');

    await env.startDiscovery();
    await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);

    await startTicker();

    const spec = buildAppSpec({
      name: appName,
      instances: 3,
      compose: [{
        name: appName,
        description: 'good test app for network error test',
        repotag: goodRepotag,
        ports: [39222],
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
    const result = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
    expect(result.status).to.equal('success');
    appHash = result.appHash;
    await waitForBlockProcessed(env.clients[0], (d) => d.height >= result.targetHeight, 60000);
    await waitForAppSpecStored(env.clients[0], appName);

    // Seed 5 install errors on every node so each spawner sees network-wide failures
    for (let n = 1; n <= env.nodeCount; n++) {
      const db = dbClient(n);
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await db.seedInstallingError({
          name: appName,
          hash: appHash,
          ip: `10.0.0.${i + 1}`,
          error: `simulated failure ${i + 1}`,
          broadcastedAt: Date.now(),
        });
      }
    }
  });

  after(async function () {
    this.timeout(30000);
    await stopTicker().catch(() => {});
    await env?.teardown();
  });

  it('should emit networkErrorSkip when error count >= 5', async function () {
    this.timeout(180000);
    const event = await Promise.any(
      env.clients.map((c) => c.waitForEvent(
        'spawner:networkErrorSkip',
        (d) => d.appName === appName,
        170000,
      )),
    );
    expect(event.data.appName).to.equal(appName);
    expect(event.data.errorCount).to.be.gte(5);
  });

  it('should not have installed the app on the skipping node', async function () {
    this.timeout(10000);
    // Find the node that skipped
    let skipNodeIdx = -1;
    for (let i = 0; i < env.clients.length; i++) {
      const buf = env.clients[i].getEventBuffer();
      if (buf.some((e) => e.event === 'spawner:networkErrorSkip' && e.data.appName === appName)) {
        skipNodeIdx = i;
        break;
      }
    }
    expect(skipNodeIdx).to.be.gte(0);

    const buf = env.clients[skipNodeIdx].getEventBuffer();
    const installed = buf.some((e) => e.event === 'app:installed' && e.data.name === appName);
    expect(installed).to.equal(false, 'app should not have been installed on skipping node');
  });

  it('should use short-term cache not long-term cache for network errors', async function () {
    this.timeout(10000);
    // The node that skipped should still consider the app later (6h cache, not 7-day).
    // We verify by checking no installFailed event was emitted (which would indicate 7-day cache path).
    let skipNodeIdx = -1;
    for (let i = 0; i < env.clients.length; i++) {
      const buf = env.clients[i].getEventBuffer();
      if (buf.some((e) => e.event === 'spawner:networkErrorSkip' && e.data.appName === appName)) {
        skipNodeIdx = i;
        break;
      }
    }
    expect(skipNodeIdx).to.be.gte(0);

    const buf = env.clients[skipNodeIdx].getEventBuffer();
    const localFailed = buf.some((e) => e.event === 'spawner:installFailed' && e.data.appName === appName);
    expect(localFailed).to.equal(false, 'network error skip should not trigger local install failure event');
  });
});
