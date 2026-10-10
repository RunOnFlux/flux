import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey, fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { waitForDaemonReady, waitForBlockProcessed, waitFor, waitForNodeStatus } from '../framework/wait.js';
import { advanceBlock, startTicker } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

async function bootAndPeer(env) {
  for (const client of env.clients) {
    if (client) await waitForDaemonReady(client);
  }
  for (const client of env.clients) {
    if (client) await waitForNodeStatus(client, (d) => d.confirmed === true, 30000);
  }
  await advanceBlock();
  for (const client of env.clients) {
    if (client) await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
  }
  await env.startDiscovery();
  await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await env.clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
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
  dumpLogsOnFailure(() => env);
  let appHash;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, deferredNodes: 1, tickerAutostart: false });
    await bootAndPeer(env);

    ({ appHash } = await registerApp(env));

    await waitFor(async () => {
      const counts = await dbClient(1).hashCounts();
      return counts.resolved > 0;
    }, { timeout: 60000, interval: 5000, label: 'node 1 has resolved hash' });

    await env.startNode(env.lastNodeIndex);
    await waitForDaemonReady(env.clients[env.lastNodeIndex]);
    await waitForNodeStatus(env.clients[env.lastNodeIndex], (d) => d.confirmed === true, 30000);
    await waitForBlockProcessed(env.clients[env.lastNodeIndex], (d) => d.height > env.initialHeight, 60000);
    await env.startDiscovery();
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should resolve hash by fetching permanent message from peers', async function () {
    this.timeout(120000);
    await waitForHashResolved(env.nodeCount, 0);
    const counts = await dbClient(env.nodeCount).hashCounts();
    expect(counts.resolved).to.be.greaterThan(0);
  });

  it('should create permanent message from resolved hash', async function () {
    const count = await dbClient(env.nodeCount).permanentMessageCount();
    expect(count).to.be.greaterThan(0);
  });

  it('should create app spec from permanent message', async function () {
    this.timeout(60000);
    await waitFor(async () => (await dbClient(env.nodeCount).appSpecCount()) > 0,
      { timeout: 50000, interval: 5000, label: `app spec on node ${env.nodeCount}` });
    expect(await dbClient(env.nodeCount).appSpecCount()).to.be.greaterThan(0);
  });
});

describe('Hash sync: network partition', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let appHash;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);

    await env.disconnectNode(env.lastNodeIndex);

    ({ appHash } = await registerApp(env, { excludeNodes: [env.lastNodeIndex] }));

    await waitFor(async () => {
      const counts = await dbClient(1).hashCounts();
      return counts.resolved > 0;
    }, { timeout: 60000, interval: 5000, label: 'node 1 has resolved hash' });

    await env.reconnectNode(env.lastNodeIndex);
    await waitForDaemonReady(env.clients[env.lastNodeIndex]);
    await waitForBlockProcessed(env.clients[env.lastNodeIndex], () => true, 60000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should resolve hash after reconnecting to network', async function () {
    this.timeout(120000);
    await waitForHashResolved(env.nodeCount, 0);
    const counts = await dbClient(env.nodeCount).hashCounts();
    expect(counts.resolved).to.be.greaterThan(0);
  });

  it('should create permanent message from resolved hash', async function () {
    const count = await dbClient(env.nodeCount).permanentMessageCount();
    expect(count).to.be.greaterThan(0);
  });

  it('should create app spec from permanent message', async function () {
    this.timeout(60000);
    await waitFor(async () => (await dbClient(env.nodeCount).appSpecCount()) > 0,
      { timeout: 50000, interval: 5000, label: `app spec on node ${env.nodeCount}` });
    expect(await dbClient(env.nodeCount).appSpecCount()).to.be.greaterThan(0);
  });
});

// A node that has lost a message it received finds the loss with the hash audit, which an
// operator runs through /apps/reconstructhashes, and stores the message again on the next block,
// from the copy its temporary pool still holds.
describe('Hash sync: stale state recovery', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let appHash;
  let db;
  let audit;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ appHash } = await registerApp(env));

    db = dbClient(env.nodeCount);
    await waitFor(async () => (await db.appHashRecord(appHash))?.message === true
      && (await db.permanentMessages({ hash: appHash })).length === 1,
    { timeout: 60000, interval: 5000, label: `node ${env.nodeCount} holds the message` });

    const node = env.clients[env.nodeCount - 1];
    const auth = await authenticate(node.url, fluxTeamKey());
    // An audit with nothing lost, so the one after the loss corrects that loss alone.
    const settled = await node.reconstructHashes(auth.zelidauth);
    expect(settled.status, JSON.stringify(settled)).to.equal('success');
    // the record still says the message was received
    await db.deletePermanentMessage(appHash);
    audit = await node.reconstructHashes(auth.zelidauth);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('marks the lost message missing', async () => {
    expect(audit.status, JSON.stringify(audit)).to.equal('success');
    expect(audit.data.message.changed).to.equal(1);
  });

  it('stores the message again on the next block', async function () {
    this.timeout(150000);
    await waitFor(async () => (await db.appHashRecord(appHash))?.message === true
      && (await db.permanentMessages({ hash: appHash })).length === 1,
    { timeout: 120000, interval: 2000, label: `node ${env.nodeCount} stored the message again` });
  });

  it('holds exactly that message again', async () => {
    expect((await db.permanentMessages({ hash: appHash })).map((m) => m.hash)).to.deep.equal([appHash]);
  });
});

// Scenario 4 (missing hashes / bulk sync) was removed: the bulk hash sync
// (checkAndSyncAppHashes) only runs once at startup. Deleting a hash after
// startup cannot be rediscovered — the node would need to re-process the
// block from the explorer. The late-joining node scenario (scenario 1)
// already covers the bootstrap path where a fresh node discovers hashes
// from block processing and resolves messages via peer sync.
