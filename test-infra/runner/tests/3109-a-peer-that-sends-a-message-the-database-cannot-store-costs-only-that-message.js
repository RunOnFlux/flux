/*
 * A peer that sends a message the database cannot store costs the node fetching in bulk only that
 * message: the fetch goes on, and the message comes from a peer that sends a copy it can store.
 *
 * The serving nodes hold 600 messages but two, Y and X, the last two. The peer stub serves all 600,
 * with two copies the database cannot store: one of Y nesting objects 250 deep just before the real
 * Y, and one of X holding a field name with a null character just before the real X. The database
 * refuses a document nested that deep together with every document written beside it, so the
 * nested copy shows whether a refused message costs its whole piece. A bulk fetch asks up to three peers, chosen at random among those its ring did not
 * give it, which are the peers that dialled it: a node it dialled, whether by its ring or because
 * that node asked to be dialled, is a ring peer. So the stub dials the joiner, as any peer reaches
 * another's bulk fetch, and since only the stub holds X it is asked whatever order the peers are
 * asked in. Both copies arrive in the last piece the stub sends. The joiner keeps all 600, Y and X
 * among them.
 *
 * The joiner is given its payment records only once the stub's link is up, and the block-driven
 * retry then fetches them; its first sync, with nothing to fetch, may run first.
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
// deeper than the database stores
const NESTED_LEVELS = 250;

// `levels` objects, one inside the next.
function nested(levels) {
  let value = 'x';
  for (let i = 0; i < levels; i += 1) value = { inner: value };
  return value;
}

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
      hookCtx: this, nodes: 8, deferredNodes: 1, stubPeers: [STUB], stubPeeredWith: { [STUB]: [] },
    });
    await bootAndPeer(env);
    stubKey = `${subnet.nodeIp(STUB + 1)}:16127`;

    log = await buildMessageLog({
      env, name: `e2eUnstorable${Date.now()}x`, apps: 10, updates: 59, height: env.initialHeight - 2000,
    });
    const [y, x] = log.slice(-2);
    await seedMessageLog({ log, servers: PEERS, withheld: new Set([y.hash, x.hash]) });
    const tooDeep = { ...y.permanentMessage, note: nested(NESTED_LEVELS) };
    const unstorable = { ...x.permanentMessage, 'note\u0000': 'a field name no database stores' };
    const stub = env.stubPeerClients.get(STUB);
    await stub.serveMessageLog([
      ...log.slice(0, -2).map((m) => JSON.stringify(m.permanentMessage)),
      JSON.stringify(tooDeep),
      JSON.stringify(y.permanentMessage),
      JSON.stringify(unstorable),
      JSON.stringify(x.permanentMessage),
    ]);

    const client = await startJoiner(env, JOINER);
    await env.startDiscovery([JOINER]);
    // A node refuses a peer's link until it takes inbound peers, so the stub dials until it holds one.
    await waitFor(async () => {
      askable = await askablePeers(client);
      if (askable.includes(stubKey)) return true;
      await stub.dialLinks([`${subnet.nodeIp(JOINER + 1)}:16127`]);
      return false;
    }, { timeout: 300000, interval: 5000, label: 'the joiner holding the stub\'s link as a peer a bulk fetch may ask' });
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

  it('left the joiner at most three peers to ask, the stub among them, and asked the stub', function () {
    expect(askable, JSON.stringify(askable)).to.include(stubKey);
    expect(askable.length, JSON.stringify(askable)).to.be.at.most(PEERS_ASKED);
    expect(stubAsks.filter((ask) => ask.route === 'byHeight'), JSON.stringify(stubAsks)).to.not.be.empty;
  });

  it('staged what its peers sent and went on to verify it', function () {
    expect(verifyHeld, 'the bulk fetch reached verification').to.not.equal(null);
  });

  it('took every message it was missing in one bulk fetch, the stub\'s two refused copies left out', function () {
    expect(bulkFetched, 'a bulk fetch that finished').to.not.equal(null);
    const outcome = bulkFetched.data.peers.find((peer) => peer.peer === stubKey);
    expect(outcome, JSON.stringify(bulkFetched.data.peers)).to.include({ refused: 2 });
    expect(outcome.received - outcome.staged, JSON.stringify(outcome)).to.equal(2);
    expect(outcome.error, JSON.stringify(outcome)).to.equal(undefined);
    expect(bulkFetched.data.processed, JSON.stringify(bulkFetched.data)).to.equal(log.length);
  });

  it('keeps every message, the two only the stub held among them, each at its own record\'s txid, height and payment', async function () {
    const notKept = await messagesNotKept(JOINER, log);
    expect(notKept, JSON.stringify(notKept)).to.deep.equal([]);
  });
});
