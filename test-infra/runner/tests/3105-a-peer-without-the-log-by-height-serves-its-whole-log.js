/*
 * A node fetching messages in bulk from a peer that does not serve the log by height - one that
 * has not upgraded - takes that peer's whole log instead.
 *
 * The only peer holding the messages is a stub that serves /apps/permanentmessages and answers 404
 * at /apps/permanentmessagesbyheight, as every node from before the route does. The real peers
 * hold none of them. The joiner has three peers to ask, so it asks each: the real ones answer
 * complete logs with nothing it is missing, and the stub, refusing the range, is asked for its
 * whole log, from which the joiner keeps every missing message.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitForOrchestratorState } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { buildMessageLog, startJoiner, peerKey, messagesNotKept } from '../framework/message-log.js';

const STUB = 2;
const JOINER = 3;

describe('a node takes the whole log from a peer that does not serve it by height', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let log;
  let bulkFetched;
  let stubRequests;

  before(async function () {
    this.timeout(1200000);
    env = await createTestEnv({
      hookCtx: this, nodes: 4, deferredNodes: 1, stubPeers: [STUB],
    });
    await bootAndPeer(env);

    log = await buildMessageLog({
      env, name: `e2eWholeLog${Date.now()}x`, apps: 10, updates: 59, height: env.initialHeight - 2000,
    });
    const stub = env.stubPeerClients.get(STUB);
    await stub.setMessageLog(log.map((m) => m.permanentMessage));
    await dbClient(JOINER + 1).seedAppHashes(log.map((m) => ({ ...m.hashEntry, message: false })));

    const client = await startJoiner(env, JOINER);
    await env.startDiscovery([JOINER]);
    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000);
    await waitForOrchestratorState(client, 'READY', 600000);
    stubRequests = await stub.messageLogRequests();
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asked the stub for the log by height, and then for its whole log', function () {
    expect(stubRequests.map(({ url, status }) => [url.split('?')[0], status]), JSON.stringify(stubRequests)).to.deep.equal([
      ['/apps/permanentmessagesbyheight', 404],
      ['/apps/permanentmessages', 200],
    ]);
  });

  it('took every missing message from the stub\'s whole log', function () {
    const fromStub = bulkFetched.data.peers.find((outcome) => outcome.peer === peerKey(STUB));
    expect(fromStub, JSON.stringify(bulkFetched.data.peers)).to.include({
      route: 'wholeLog', received: log.length, staged: log.length,
    });
    expect(fromStub.error).to.equal(undefined);
    expect(bulkFetched.data.processed).to.equal(log.length);
  });

  it('took nothing from the real peers, which hold none of it', function () {
    const fromReal = bulkFetched.data.peers.filter((outcome) => outcome.peer !== peerKey(STUB));
    expect(fromReal.map(({ route, received, staged }) => ({ route, received, staged })))
      .to.deep.equal(fromReal.map(() => ({ route: 'byHeight', received: 0, staged: 0 })));
  });

  it('keeps every message, each at its own record\'s txid, height and payment', async function () {
    expect(await messagesNotKept(JOINER, log)).to.deep.equal([]);
  });
});
