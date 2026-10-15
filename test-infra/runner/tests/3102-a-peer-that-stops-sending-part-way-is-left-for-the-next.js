/*
 * A node whose peer stops sending part way through its message log gives that peer up and takes
 * the rest from the next one.
 *
 * Every serving peer is held after the first piece of its log. The joiner asks one of them, which
 * sends that piece and then nothing, with its connection open; the other peers are let go. Once
 * the peer has sent nothing for hashSyncBulkIdleMs the joiner abandons it, keeping what it sent,
 * and asks the next peer only for the rest.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { waitForOrchestratorState } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import {
  BEFORE_LOG_PIECE, fleetMissingALog, startJoiner, firstPeerHeldAfterOnePiece, peerKey, messagesNotKept,
} from '../framework/message-log.js';

describe('a node whose peer stops sending part way through its log takes the rest from the next', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let log;
  let joiner;
  let first;
  let bulkFetched;

  before(async function () {
    this.timeout(1200000);
    let peers;
    ({ env, log, peers, joiner } = await fleetMissingALog(this, { name: 'e2eSilentPeer' }));
    await Promise.all(peers.map((i) => env.clients[i].holdCheckpoint(BEFORE_LOG_PIECE, 1)));

    const client = await startJoiner(env, joiner);
    await env.startDiscovery([joiner]);

    first = await firstPeerHeldAfterOnePiece(env, peers);
    await Promise.all(peers.filter((i) => i !== first).map((i) => env.clients[i].releaseCheckpoint(BEFORE_LOG_PIECE, 1)));
    // The peer stays held, its connection open and silent, until the joiner has moved on.

    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 600000);
    await waitForOrchestratorState(client, 'READY', 600000);
  });

  after(async function () {
    this.timeout(120000);
    await env?.clients[first]?.releaseAllCheckpoints().catch(() => {});
    await env?.teardown();
  });

  it('asked the held peer first, and gave it up with what it had sent', function () {
    const [failed] = bulkFetched.data.peers;
    expect(failed.peer, JSON.stringify(bulkFetched.data.peers)).to.equal(peerKey(first));
    expect(failed.error, JSON.stringify(failed)).to.equal(`no data from ${peerKey(first)} for 20s`);
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
    expect(await messagesNotKept(joiner, log)).to.deep.equal([]);
  });
});
