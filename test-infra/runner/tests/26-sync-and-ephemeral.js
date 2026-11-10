import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { dbClient } from '../framework/db-client.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import {
  startTicker, advanceBlock, advanceBlocks, queueAppTx,
} from '../framework/daemon-control.js';
import { bootAndPeer as bootAndPeerFleet } from '../framework/reconciler-suite.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { nodeKey } from '../framework/keys.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForOrchestratorState, waitFor,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

async function bootAndPeer(env, nodeIndices) {
  const clients = nodeIndices.map((i) => env.clients[i]).filter(Boolean);
  for (const client of clients) await waitForDaemonReady(client);
  await Promise.all(clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of clients) {
    await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
  }
  await env.startDiscovery(nodeIndices);
  await clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
  await startTicker();
}

describe('Signed sync completes on late-joining node', function () {
  let env;
  const appName = `e2esync${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 11, deferredNodes: 1, tickerAutostart: false });
    const initial = Array.from({ length: 10 }, (_, i) => i);
    await bootAndPeer(env, initial);

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName, description: 'sync test',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [], domains: [''], environmentParameters: [], commands: [],
        containerPorts: [80], containerData: '/tmp',
        cpu: 0.1, ram: 100, hdd: 1, repoauth: '',
      }],
    });
    for (let i = 1; i <= 10; i++) {
      const dc = dbClient(i);
      await dc.seedGlobalAppSpec(app.spec);
      await dc.seedPermanentMessage(app.permanentMessage);
      await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
    }
    await queueAppTx(app.hash);
    await advanceBlock();
    await Promise.any(
      env.clients.slice(0, 10).map((c) => waitForAppInstalled(c, appName, 120000)),
    );
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should sync app locations via signed 0x21 request', async function () {
    this.timeout(180000);
    const client = await env.startNode(10);
    await waitForDaemonReady(client);
    await waitForNodeStatus(client, (d) => d.confirmed === true, 30000);
    await waitForOrchestratorState(client, 'READY', 120000);

    const res = await client.getAppLocations(appName);
    expect(res.status).to.equal('success');
    expect(res.data).to.be.an('array').with.length.greaterThan(0);
  });
});

describe('Ephemeral connections resolve hashes via stub peers', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eephem${Date.now()}`;
  const stubIndices = [5, 7, 9, 11, 13];
  const realIndices = [0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 15];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this,
      nodes: 16,
      stubPeers: stubIndices,
      // NOBODY IS A STANDING PEER OF THESE STUBS, which is the whole subject:
      // the hash is resolved over an EPHEMERAL connection opened to reach a
      // peer this node does not hold. A stub the fleet is already peered with
      // is reached without opening one, so the mechanism under test never runs
      // and the suite passes on the ordinary path instead.
      stubPeeredWith: Object.fromEntries(stubIndices.map((index) => [index, []])),
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          hashSyncFallbackRecheckBlocks: 2,
          hashSyncMaxRounds: 1,
          hashSyncEphemeralPeers: 5,
        },
      },
    });
    await bootAndPeer(env, realIndices);
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should resolve hash via ephemeral connection to stub peer', async function () {
    this.timeout(180000);

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName, description: 'ephemeral test',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [], domains: [''], environmentParameters: [], commands: [],
        containerPorts: [80], containerData: '/tmp',
        cpu: 0.1, ram: 100, hdd: 1, repoauth: '',
      }],
    });

    const dc0 = dbClient(1);
    await dc0.seedAppHash(app.hash, app.permanentMessage.height, false);

    for (const [, stub] of env.stubPeerClients) {
      await stub.loadMessage(app.permanentMessage);
    }

    await advanceBlocks(3);

    await waitFor(async () => {
      const counts = await dc0.hashCounts();
      return counts.missing === 0;
    }, { timeout: 120000, interval: 3000, label: 'hash resolved via ephemeral connection' });

    expect(env.nodeHasLog(0, /Ephemeral round/)).to.be.true;

    let totalServed = 0;
    for (const [, stub] of env.stubPeerClients) {
      const stats = await stub.getStats();
      totalServed += stats.messagesServed;
    }
    expect(totalServed).to.be.greaterThan(0);
  });
});

// A node cut off while an app registered asks, over temporary connections, nodes
// it holds no connection to for the message, and between Arcane nodes they answer.
// Every node here is Arcane and real: a stub offers no link, so the case above
// passes whether or not an Arcane node takes a question on a temporary connection.
//
// While SUBJECT is partitioned it sees the payment and has no peer to ask, so its
// scan leaves the message to hash sync. The fleet's unpromoted copies are gone
// before the partition heals, as they are once they expire, so its resync brings
// none. hashSyncMaxRounds 0 leaves the hash sync it runs on rejoining one round:
// temporary connections. Each node dials the four after it on the ring and is
// dialled by the four before it, so of twelve nodes SUBJECT is connected to eight
// and the round has three to ask.
describe('a node cut off while an app registered resolves its message over temporary connections to Arcane nodes', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const SUBJECT = 5;
  const REGISTRAR = 2;
  let rest;
  let appHash;
  let marks;
  let round;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 12,
      tickerAutostart: false,
      configOverrides: { fluxapps: { hashSyncMaxRounds: 0 } },
    });
    await bootAndPeerFleet(env);
    rest = env.clients.map((c, i) => i).filter((i) => i !== SUBJECT);
    await env.partitionGroups([SUBJECT], rest);

    const spec = buildAppSpec({ name: `e2eephemarc${Date.now()}`, instances: 3 });
    const registered = await registerAndConfirm(
      env.clients[REGISTRAR].url, nodeKey(REGISTRAR + 1), spec, rest.map((i) => env.clients[i]),
    );
    expect(registered.status, JSON.stringify(registered)).to.equal('success');
    ({ appHash } = registered);

    const subjectDb = dbClient(SUBJECT + 1);
    await waitFor(async () => (await subjectDb.appHashRecord(appHash))?.message === false,
      { timeout: 120000, interval: 2000, label: `node ${SUBJECT} records the payment without its message` });
    await Promise.all(rest.map((i) => waitFor(
      async () => (await dbClient(i + 1).permanentMessages({ hash: appHash })).length === 1,
      { timeout: 60000, interval: 2000, label: `node ${i} stores the message` },
    )));
    await Promise.all(rest.map(async (i) => {
      await dbClient(i + 1).deleteTemporaryMessages(appHash);
      expect(await dbClient(i + 1).pendingMessage(appHash), `fixture: node ${i} holds no unpromoted copy`).to.equal(null);
    }));
    expect(await subjectDb.pendingMessage(appHash), `fixture: node ${SUBJECT} holds no unpromoted copy`).to.equal(null);

    marks = env.clients.map((c) => c.getLastEventId());
    await env.healPartition([SUBJECT], rest);
    round = (await env.clients[SUBJECT].waitForEvent('hashSync:ephemeralRound', () => true, 180000,
      { afterId: marks[SUBJECT] })).data;
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('asks nodes it holds no connection to', () => {
    expect(round.asked, 'the round opened no connection').to.not.be.empty;
  });

  it('is answered by a node it asked', () => {
    const subjectIp = env.clients[SUBJECT].ip;
    const askedIps = round.asked.map((key) => key.split(':')[0]);
    const answered = env.clients.filter((c, i) => i !== SUBJECT && askedIps.includes(c.ip) && c.getEventBuffer()
      .some((e) => e.id > marks[i] && e.event === 'hashRequest:responded'
        && e.data.peer.split(':')[0] === subjectIp && e.data.found === 1));
    expect(answered.map((c) => c.ip), `asked: ${round.asked.join(', ')}`).to.not.be.empty;
  });

  it('resolves the message in that round and holds it', async () => {
    expect(round).to.include({ requested: 1, unresolved: 0 });
    expect((await dbClient(SUBJECT + 1).permanentMessages({ hash: appHash })).map((m) => m.hash)).to.deep.equal([appHash]);
  });
});
