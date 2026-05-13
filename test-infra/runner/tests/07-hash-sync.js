import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { waitForDaemonReady, waitForBlockProcessed, waitFor, waitForPeers } from '../framework/wait.js';
import { advanceBlock, startTicker } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';

async function bootAndPeer(env) {
  for (const client of env.clients) {
    if (client) await waitForDaemonReady(client);
  }
  await advanceBlock();
  for (const client of env.clients) {
    if (client) await waitForBlockProcessed(client, (d) => d.height > 2100000, 50000);
  }
  await env.startDiscovery();
  await waitForPeers(env.clients[0], { outbound: 4, inbound: 2 });
  await startTicker();
}

async function registerApp(env, { excludeNodes = [] } = {}) {
  const appName = `e2eHash${Date.now()}`;
  const spec = buildAppSpec({ name: appName, instances: 3 });
  const onlineClients = env.clients.filter((c, i) => c !== null && !excludeNodes.includes(i));
  const result = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, onlineClients);
  expect(result.status).to.equal('success');
  return { appName, appHash: result.appHash };
}

async function waitForHashResolved(nodeNum, initialResolved, timeout = 120000) {
  const db = dbClient(nodeNum);
  await waitFor(async () => {
    const counts = await db.hashCounts();
    return counts.resolved > initialResolved;
  }, { timeout, interval: 5000, label: `hash resolved on node ${nodeNum} via sync` });
}

describe('Hash sync: late-joining node', function () {
  let env;
  let appHash;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 8, deferredNodes: 1, tickerAutostart: false });
    await bootAndPeer(env);

    ({ appHash } = await registerApp(env));

    await waitFor(async () => {
      const counts = await dbClient(1).hashCounts();
      return counts.resolved > 0;
    }, { timeout: 60000, interval: 5000, label: 'node 1 has resolved hash' });

    await env.startNode(7);
    await waitForDaemonReady(env.clients[7]);
    await waitForBlockProcessed(env.clients[7], (d) => d.height > 2100000, 60000);
    await env.startDiscovery();
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should resolve hash by fetching permanent message from peers', async function () {
    this.timeout(120000);
    await waitForHashResolved(8, 0);
    const counts = await dbClient(8).hashCounts();
    expect(counts.resolved).to.be.greaterThan(0);
  });

  it('should create permanent message from resolved hash', async function () {
    const count = await dbClient(8).permanentMessageCount();
    expect(count).to.be.greaterThan(0);
  });

  it('should create app spec from permanent message', async function () {
    this.timeout(60000);
    await waitFor(async () => (await dbClient(8).appSpecCount()) > 0,
      { timeout: 50000, interval: 5000, label: 'app spec on node 8' });
    expect(await dbClient(8).appSpecCount()).to.be.greaterThan(0);
  });
});

describe('Hash sync: network partition', function () {
  let env;
  let appHash;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 8, tickerAutostart: false });
    await bootAndPeer(env);

    await env.disconnectNode(7);

    ({ appHash } = await registerApp(env, { excludeNodes: [7] }));

    await waitFor(async () => {
      const counts = await dbClient(1).hashCounts();
      return counts.resolved > 0;
    }, { timeout: 60000, interval: 5000, label: 'node 1 has resolved hash' });

    await env.reconnectNode(7);
    await waitForDaemonReady(env.clients[7]);
    await waitForBlockProcessed(env.clients[7], () => true, 60000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should resolve hash after reconnecting to network', async function () {
    this.timeout(120000);
    await waitForHashResolved(8, 0);
    const counts = await dbClient(8).hashCounts();
    expect(counts.resolved).to.be.greaterThan(0);
  });

  it('should create permanent message from resolved hash', async function () {
    const count = await dbClient(8).permanentMessageCount();
    expect(count).to.be.greaterThan(0);
  });

  it('should create app spec from permanent message', async function () {
    this.timeout(60000);
    await waitFor(async () => (await dbClient(8).appSpecCount()) > 0,
      { timeout: 50000, interval: 5000, label: 'app spec on node 8' });
    expect(await dbClient(8).appSpecCount()).to.be.greaterThan(0);
  });
});

describe('Hash sync: stale state recovery', function () {
  let env;
  let appHash;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 8, tickerAutostart: false });
    await bootAndPeer(env);
    ({ appHash } = await registerApp(env));

    const db8 = dbClient(8);
    await waitFor(async () => {
      const counts = await db8.hashCounts();
      return counts.resolved > 0;
    }, { timeout: 60000, interval: 5000, label: 'node 8 has resolved hash' });

    await db8.markHashUnresolved(appHash);
    await db8.deletePermanentMessage(appHash);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should re-resolve hash by fetching message from peers', async function () {
    this.timeout(120000);
    await waitForHashResolved(8, 0);
    const counts = await dbClient(8).hashCounts();
    expect(counts.resolved).to.be.greaterThan(0);
  });

  it('should re-create permanent message', async function () {
    const count = await dbClient(8).permanentMessageCount();
    expect(count).to.be.greaterThan(0);
  });
});

// Scenario 4 (missing hashes / bulk sync) was removed: the bulk hash sync
// (checkAndSyncAppHashes) only runs once at startup. Deleting a hash after
// startup cannot be rediscovered — the node would need to re-process the
// block from the explorer. The late-joining node scenario (scenario 1)
// already covers the bootstrap path where a fresh node discovers hashes
// from block processing and resolves messages via peer sync.
