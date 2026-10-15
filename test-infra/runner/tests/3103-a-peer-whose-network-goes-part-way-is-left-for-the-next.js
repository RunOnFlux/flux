/*
 * A node whose peer drops off the network part way through its message log gives that peer up and
 * takes the rest from the next one.
 *
 * Every serving peer is held after the first piece of its log. The joiner asks one of them, which
 * sends that piece; then that peer is taken off the network, so its connection ends with no word
 * to the joiner, as one through a NAT that has dropped its mapping does. The joiner abandons it
 * once it has heard nothing for hashSyncBulkIdleMs, keeping what it sent, and asks the next peer
 * only for the rest.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { waitForOrchestratorState } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import {
  BEFORE_LOG_PIECE, fleetMissingALog, startJoiner, firstPeerHeldAfterOnePiece, peerKey, messagesNotKept,
} from '../framework/message-log.js';

describe('a node whose peer drops off the network part way through its log takes the rest from the next', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let log;
  let joiner;
  let first;
  let bulkFetched;
  let dropped;

  before(async function () {
    this.timeout(1200000);
    let peers;
    ({ env, log, peers, joiner } = await fleetMissingALog(this, { name: 'e2eDroppedPeer' }));
    await Promise.all(peers.map((i) => env.clients[i].holdCheckpoint(BEFORE_LOG_PIECE, 1)));

    const client = await startJoiner(env, joiner);
    await env.startDiscovery([joiner]);

    first = await firstPeerHeldAfterOnePiece(env, peers);
    await Promise.all(peers.filter((i) => i !== first).map((i) => env.clients[i].releaseCheckpoint(BEFORE_LOG_PIECE, 1)));
    await env.disconnectNode(first);
    dropped = first;

    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000);
    await waitForOrchestratorState(client, 'READY', 600000);
  });

  after(async function () {
    this.timeout(120000);
    if (dropped !== undefined) await env?.reconnectNode(dropped);
    await env?.teardown();
  });

  it('asked the held peer first, and gave it up with what it had sent', function () {
    const [failed] = bulkFetched.data.peers;
    expect(failed.peer, JSON.stringify(bulkFetched.data.peers)).to.equal(peerKey(first));
    expect(failed.error, JSON.stringify(failed)).to.be.a('string');
    expect(failed.staged, 'staged from the first piece').to.be.above(0);
    expect(failed.staged).to.be.below(log.length);
  });

  it('took only the rest from the peers after it', function () {
    const [failed, ...later] = bulkFetched.data.peers;
    expect(later.map((outcome) => outcome.peer)).to.not.include(failed.peer);
    expect(later.reduce((sum, outcome) => sum + outcome.staged, 0)).to.equal(log.length - failed.staged);
    expect(bulkFetched.data.processed).to.equal(log.length);
  });

  it('keeps every message, each at its own record\'s txid, height and payment', async function () {
    const notKept = await messagesNotKept(joiner, log);
    expect(notKept, JSON.stringify(notKept)).to.deep.equal([]);
  });
});
