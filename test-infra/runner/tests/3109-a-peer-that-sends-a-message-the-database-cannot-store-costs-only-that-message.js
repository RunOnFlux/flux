/*
 * A peer that sends a message the database cannot store costs the node fetching in bulk only that
 * message: the fetch goes on, and the message comes from a peer that sends a copy it can store.
 *
 * The joiner holds the payment records of 600 messages. Its serving nodes hold every message but
 * one, X; the peer stub holds only X and sends it twice, first a copy with a field name holding a
 * null character, which no database stores, then the real one. Whichever order the joiner asks its
 * peers in, the stub is asked, since it alone holds X, and the copy the database refuses arrives in
 * the stub's last piece. The joiner keeps all 600, X among them.
 *
 * The joiner asks up to three of its peers, chosen at random among those a bulk fetch may ask
 * (not the ones its ring dialled). The fleet leaves it fewer than four such peers, the stub among
 * them, so the stub is always among those asked; the first test checks this held.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor, waitForOrchestratorState } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  buildMessageLog, seedMessageLog, startJoiner, messagesNotKept,
} from '../framework/message-log.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const subnet = getSubnetConfig();

const PEERS = [0, 1, 2, 3];
const STUB = 4;
const JOINER = 5;
// syncMissingHashes' maxConcurrentPeers
const PEERS_ASKED = 3;

describe('a peer that sends a message the database cannot store costs only that message', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let log;
  let withheld;
  let stubKey;
  let askable;
  let bulkFetched;
  let stubAsks;

  before(async function () {
    this.timeout(1800000);
    env = await createTestEnv({
      hookCtx: this, nodes: 6, deferredNodes: 1, stubPeers: [STUB], stubPeeredWith: { [STUB]: [JOINER] },
    });
    await bootAndPeer(env);
    stubKey = `${subnet.nodeIp(STUB + 1)}:16127`;

    log = await buildMessageLog({
      env, name: `e2eUnstorable${Date.now()}x`, apps: 10, updates: 59, height: env.initialHeight - 2000,
    });
    withheld = log[300];
    await seedMessageLog({
      log, servers: PEERS, joiner: JOINER, withheld: new Set([withheld.hash]),
    });
    const unstorable = { ...withheld.permanentMessage, 'note\u0000': 'a field name no database stores' };
    const stub = env.stubPeerClients.get(STUB);
    await stub.serveMessageLog([JSON.stringify(unstorable), JSON.stringify(withheld.permanentMessage)]);

    const client = await startJoiner(env, JOINER);
    await waitFor(async () => JSON.stringify((await client.getPeers()).data ?? []).includes(subnet.nodeIp(STUB + 1)), {
      timeout: 120000, interval: 1000, label: 'the joiner holding the stub as a peer',
    });
    const mark = client.getLastEventId();
    await env.startDiscovery([JOINER]);
    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 900000, { afterId: mark }).catch(() => null);
    const peers = await client.getTestState('peers');
    askable = [...(peers.outbound ?? []), ...(peers.inbound ?? [])]
      .filter((peer) => peer.source !== 'deterministic')
      .map((peer) => `${peer.ip}:${peer.port}`);
    stubAsks = await stub.messageLogRequests();
    await waitForOrchestratorState(client, 'READY', 600000).catch(() => {});
    await waitFor(async () => (await messagesNotKept(JOINER, log)).length === 0, {
      timeout: 300000, interval: 3000, label: 'every message kept',
    }).catch(() => {});
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('left the joiner few enough peers to ask that the stub was among those asked', function () {
    expect(askable, JSON.stringify(askable)).to.include(stubKey);
    expect(askable.length, JSON.stringify(askable)).to.be.at.most(PEERS_ASKED);
    expect(stubAsks.filter((ask) => ask.route === 'byHeight'), JSON.stringify(stubAsks)).to.not.be.empty;
  });

  it('took every message it was missing in one bulk fetch, the stub\'s refused copy left out', function () {
    expect(bulkFetched, 'a bulk fetch that finished').to.not.equal(null);
    const outcome = bulkFetched.data.peers.find((peer) => peer.peer === stubKey);
    expect(outcome, JSON.stringify(bulkFetched.data.peers)).to.include({ received: 2, refused: 1, staged: 1 });
    expect(bulkFetched.data.processed, JSON.stringify(bulkFetched.data)).to.equal(log.length);
  });

  it('keeps every message, the one only the stub held among them, each at its own record\'s txid, height and payment', async function () {
    const notKept = await messagesNotKept(JOINER, log);
    expect(notKept, JSON.stringify(notKept)).to.deep.equal([]);
  });
});
