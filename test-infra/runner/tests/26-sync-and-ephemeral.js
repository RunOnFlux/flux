import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { dbClient } from '../framework/db-client.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import {
  startTicker, stopTicker, advanceBlock, advanceBlocks, queueAppTx, driveUntil,
} from '../framework/daemon-control.js';
import { bootAndPeer as bootAndPeerFleet } from '../framework/reconciler-suite.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { nodeKey, fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
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

// A node that lost a message asks nodes it holds no connection to, over temporary
// connections, and between Arcane nodes they answer. Every node here is Arcane and
// real: a stub offers no link, so the case above passes whether or not an Arcane
// node takes a question on a temporary connection.
//
// Each node dials the four after it on the ring and is dialled by the four before
// it, so of twelve nodes SUBJECT is connected to eight and the round has three to
// open connections to. hashSyncMaxRounds 0 sends a missing message straight to that
// round: the subject's own peers, which hold the message, are never asked. The
// subject loses its unpromoted copy with the permanent one, as a node does once
// the copy has expired, so nothing it holds resolves the message.
describe('a node resolves a lost message over temporary connections to Arcane nodes', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const SUBJECT = 4;
  const REGISTRAR = 2;
  const RECHECK_BLOCKS = 2;
  let appHash;
  let db;
  let round;
  let marks;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 12,
      tickerAutostart: false,
      configOverrides: { fluxapps: { hashSyncMaxRounds: 0, hashSyncFallbackRecheckBlocks: RECHECK_BLOCKS } },
    });
    await bootAndPeerFleet(env);
    const spec = buildAppSpec({ name: `e2eephemarc${Date.now()}`, instances: 3 });
    const registered = await registerAndConfirm(env.clients[REGISTRAR].url, nodeKey(REGISTRAR + 1), spec, env.clients);
    expect(registered.status, JSON.stringify(registered)).to.equal('success');
    ({ appHash } = registered);

    db = dbClient(SUBJECT + 1);
    await waitFor(async () => (await db.appHashRecord(appHash))?.message === true
      && (await db.permanentMessages({ hash: appHash })).length === 1,
    { timeout: 60000, interval: 2000, label: `node ${SUBJECT} holds the message` });
    await stopTicker();

    const subject = env.clients[SUBJECT];
    const { zelidauth } = await authenticate(subject.url, fluxTeamKey());
    await db.deletePermanentMessage(appHash);
    await db.deleteTemporaryMessages(appHash);
    expect(await db.pendingMessage(appHash), `fixture: node ${SUBJECT} holds no unpromoted copy`).to.equal(null);
    const audit = await subject.reconstructHashes(zelidauth);
    expect(audit.data?.message?.changed, `fixture: node ${SUBJECT} marked the lost message missing: ${JSON.stringify(audit)}`).to.equal(1);

    marks = env.clients.map((c) => c.getLastEventId());
    const roundOf = () => subject.getEventBuffer().find((e) => e.id > marks[SUBJECT] && e.event === 'hashSync:ephemeralRound');
    await driveUntil(subject, () => Boolean(roundOf()), {
      blocks: RECHECK_BLOCKS + 2, label: `node ${SUBJECT} asked over temporary connections`,
    });
    round = roundOf().data;
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
    const answered = env.clients.filter((c, i) => askedIps.includes(c.ip) && c.getEventBuffer().some((e) => e.id > marks[i]
      && e.event === 'hashRequest:responded' && e.data.peer.split(':')[0] === subjectIp && e.data.found === 1));
    expect(answered.map((c) => c.ip), `asked: ${round.asked.join(', ')}`).to.not.be.empty;
  });

  it('resolves the message in that round and holds it again', async () => {
    expect(round).to.include({ requested: 1, unresolved: 0 });
    expect((await db.permanentMessages({ hash: appHash })).map((m) => m.hash)).to.deep.equal([appHash]);
  });
});
