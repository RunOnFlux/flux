/*
 * A peer that sends a message the database cannot store costs the node fetching in bulk only that
 * message: the fetch goes on, and the message comes from a peer that sends a copy it can store.
 *
 * The serving nodes hold 600 messages but one, X, the last; the peer stub holds only X and sends
 * it twice, first a copy with a field name holding a null character, which no database stores,
 * then the real one. Whichever order the joiner asks its peers in, the stub is asked, since it
 * alone holds X, and the copy the database refuses arrives in the stub's last piece. The joiner
 * keeps all 600, X among them.
 *
 * A bulk fetch asks up to three peers, chosen at random among those its ring did not give it: the
 * nodes that dialled it, and peers added to it. In a ring of eight with every node on a two-peer
 * arc, the joiner is dialled by two serving nodes, and the stub sits outside the joiner's ring, so
 * its link is one the bulk fetch may ask: three peers, every one of them asked when needed. The
 * joiner is given its payment records only once it holds those three, and the block-driven retry
 * then fetches them; its first sync, with nothing to fetch, may run before they are in place.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor, waitForOrchestratorState } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  buildMessageLog, seedMessageLog, startJoiner, messagesNotKept,
} from '../framework/message-log.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const subnet = getSubnetConfig();

const PEERS = [0, 1, 2, 4, 5, 6];
const STUB = 3;
const JOINER = 7;
// syncMissingHashes' maxConcurrentPeers
const PEERS_ASKED = 3;
const BEFORE_VERIFY = 'hashSync:beforeVerify';
// the block-driven retry's recheck interval, twice over
const RETRY_BLOCKS = 2 * loadSharedConfig().fluxapps.hashSyncFallbackRecheckBlocks;

describe('a peer that sends a message the database cannot store costs only that message', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let log;
  let stubKey;
  let askable;
  let verifyHeld;
  let bulkFetched;
  let stubAsks;

  // The peers of the joiner a bulk fetch may ask, as ip:port.
  async function askablePeers(client) {
    const peers = await client.getTestState('peers');
    return [...(peers.outbound ?? []), ...(peers.inbound ?? [])]
      .filter((peer) => !peer.handshaking && peer.source !== 'deterministic')
      .map((peer) => `${peer.ip}:${peer.port}`);
  }

  before(async function () {
    this.timeout(1800000);
    env = await createTestEnv({
      hookCtx: this, nodes: 8, deferredNodes: 1, stubPeers: [STUB], stubPeeredWith: { [STUB]: [JOINER] },
    });
    await bootAndPeer(env);
    stubKey = `${subnet.nodeIp(STUB + 1)}:16127`;

    log = await buildMessageLog({
      env, name: `e2eUnstorable${Date.now()}x`, apps: 10, updates: 59, height: env.initialHeight - 2000,
    });
    const withheld = log[log.length - 1];
    await seedMessageLog({ log, servers: PEERS, withheld: new Set([withheld.hash]) });
    const unstorable = { ...withheld.permanentMessage, 'note\u0000': 'a field name no database stores' };
    const stub = env.stubPeerClients.get(STUB);
    await stub.serveMessageLog([JSON.stringify(unstorable), JSON.stringify(withheld.permanentMessage)]);

    const client = await startJoiner(env, JOINER);
    await env.startDiscovery([JOINER]);
    await waitFor(async () => {
      askable = await askablePeers(client);
      return askable.includes(stubKey) && askable.length === PEERS_ASKED;
    }, { timeout: 300000, interval: 2000, label: 'the joiner holding the stub and the two nodes that dial it' });
    await waitForOrchestratorState(client, 'READY', 600000);

    await stopTicker();
    await client.holdCheckpoint(BEFORE_VERIFY);
    const mark = client.getLastEventId();
    await dbClient(JOINER + 1).seedAppHashes(log.map((m) => ({ ...m.hashEntry, message: false })));
    const heldAfter = () => client.getEventBuffer()
      .find((e) => e.id > mark && e.event === 'checkpoint:held' && e.data.name === BEFORE_VERIFY);
    await driveUntil(client, () => heldAfter() !== undefined, { blocks: RETRY_BLOCKS, label: 'the retry\'s bulk fetch staged and held before verifying' })
      .catch(() => {});
    verifyHeld = heldAfter() ?? null;
    askable = await askablePeers(client);
    await client.releaseCheckpoint(BEFORE_VERIFY);
    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', () => true, 600000, { afterId: mark }).catch(() => null);
    stubAsks = await stub.messageLogRequests();
    await waitFor(async () => (await messagesNotKept(JOINER, log)).length === 0, {
      timeout: 300000, interval: 3000, label: 'every message kept',
    }).catch(() => {});
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('left the joiner three peers to ask, the stub among them, and asked the stub', function () {
    expect(askable, JSON.stringify(askable)).to.include(stubKey);
    expect(askable.length, JSON.stringify(askable)).to.be.at.most(PEERS_ASKED);
    expect(stubAsks.filter((ask) => ask.route === 'byHeight'), JSON.stringify(stubAsks)).to.not.be.empty;
  });

  it('staged what its peers sent and went on to verify it', function () {
    expect(verifyHeld, 'the bulk fetch reached verification').to.not.equal(null);
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
