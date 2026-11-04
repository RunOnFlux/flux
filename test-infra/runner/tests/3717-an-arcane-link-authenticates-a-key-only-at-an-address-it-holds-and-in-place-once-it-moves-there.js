/*
 * An Arcane link authenticates a node key only at an address the network holds
 * it at, and a link refused for want of that is authenticated on the same
 * connection once the network moves the key there.
 *
 * A handshake costs the node a fluxbench call, and one operator key is listed
 * on every node the operator runs. The node spends the call only on a key listed
 * at the connection's address, or one it has taken a move of to that address,
 * so one key holds a handshake budget only on the addresses its nodes hold.
 *
 * The fleet: four Arcane nodes and two stubs that speak as Arcane nodes.
 *   - UNLISTED signs with node 0's key and is listed nowhere itself: the key is
 *     listed, the address is not. It dials the nodes, because a node dials only
 *     listed addresses and takes an inbound connection from any.
 *   - SHARED signs with node 1's key and is listed at its own address with it:
 *     one operator's key on two addresses, which must authenticate at both.
 *
 * A moved node takes its new address at once and tells the move only after it
 * has decided it; it is held between the two (ownAddress:beforeReconcile), so
 * the connection it opens from the new address is refused. Released, it dials
 * again, and the move or the list update that follows upgrades the connection
 * then held: what is asserted is that one connection was refused and then
 * authenticated, not which one it was.
 *   - with the ticker stopped, no node list is fetched, so the move is the only
 *     thing that can upgrade the link;
 *   - with the move still held, a block that lists the node at its new address
 *     is the only thing that can.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { moveNodeAddress } from '../framework/container.js';
import {
  advanceBlock, clearNodeAddress, getJournal, setNodeAddress, stopTicker,
} from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const REAL = [0, 1, 2, 3];
const SHARED = 4;
const UNLISTED = 5;
const MOVED_BY_MOVE = 2;
const MOVED_BY_LIST = 3;
const MOVING = [MOVED_BY_MOVE, MOVED_BY_LIST];
const API_PORT = 16127;
const BEFORE_RECONCILE = 'ownAddress:beforeReconcile';
const NOT_LISTED_HERE = 'notListedHere';
const DETECTION_MS = 6 * 60 * 1000;
const RECONNECT_MS = 5 * 60 * 1000;

describe('an Arcane link authenticates a key only at an address it holds, and in place once it moves there', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const moved = [];
  const client = (i) => env.clients[i];
  const stub = (i) => env.stubPeerClients.get(i);
  const socketOf = (ip) => `${ip}:${API_PORT}`;
  const connections = async (i) => {
    const { outbound, inbound } = await client(i).getTestState('peers');
    return [...outbound, ...inbound];
  };
  const connectionTo = async (i, ip) => (await connections(i)).find((peer) => peer.ip === ip);
  const moveHeldBy = async (i, oldSocket, newSocket) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
    .find((event) => event.data?.newIP === newSocket);

  // The node's fluxbench calls in [from, to].
  const benchCallsBetween = async (i, from, to) => (await getJournal({ method: 'encryptmessage', sourceIp: client(i).ip })).entries
    .filter((entry) => entry.timestamp >= from && entry.timestamp <= to).length;

  const dialUnlisted = () => stub(UNLISTED).dialLinks(REAL.map((i) => socketOf(client(i).ip)));

  // Closes the stub's connections and waits until every real node holds a new
  // one with it whose handshake has settled. Answers, per node, the connection
  // and when its handshake settled.
  const reconnectStub = async (stubIndex) => {
    const ip = stub(stubIndex).ip;
    const before = new Map(await Promise.all(REAL.map(async (i) => [i, (await connectionTo(i, ip))?.connectionId])));
    const from = Date.now();
    expect(await stub(stubIndex).closeLinks(), 'fixture: the stub held a connection with every node').to.equal(REAL.length);
    if (stubIndex === UNLISTED) {
      await waitFor(async () => (await Promise.all(REAL.map((i) => connectionTo(i, ip)))).every((peer) => !peer), {
        timeout: 30000, interval: 200, label: 'every node dropped its connection with the unlisted stub',
      });
      await dialUnlisted();
    }
    const settled = new Map();
    await waitFor(async () => {
      await Promise.all(REAL.map(async (i) => {
        if (settled.has(i)) return;
        const peer = await connectionTo(i, ip);
        if (!peer || peer.connectionId === before.get(i) || peer.handshaking) return;
        if (!peer.authenticated && peer.linkFailed === null) return;
        settled.set(i, { peer, at: Date.now() });
      }));
      return settled.size === REAL.length;
    }, { timeout: 60000, interval: 500, label: `every node holds a new, settled connection with stub ${stubIndex}` });
    return { from, settled };
  };

  // Moves node `i` to `.lastOctet` and holds it after it has taken the new
  // address and before it tells the move, with benchmark reporting the new
  // address and the chain still listing the old one. Answers the move and the
  // node and connection that refused the moved node's new address.
  const moveAndHold = async (i, lastOctet) => {
    const node = client(i);
    const fromIp = node.ip;
    const toIp = fromIp.replace(/\.\d+$/, `.${lastOctet}`);
    const oldSocket = socketOf(fromIp);
    const newSocket = socketOf(toIp);
    await node.holdCheckpoint(BEFORE_RECONCILE, newSocket);
    const heldAnchor = node.getLastEventId();
    await moveNodeAddress(node.container, toIp, fromIp);
    await node.followTo(toIp);
    await setNodeAddress(fromIp, toIp, { scope: 'benchmark' });
    moved.push(fromIp);
    await node.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RECONCILE && d.key === newSocket, DETECTION_MS, { afterId: heldAnchor });

    let refused;
    await waitFor(async () => {
      const found = await Promise.all(REAL.filter((j) => j !== i).map(async (j) => ({ j, peer: await connectionTo(j, toIp) })));
      refused = found.find(({ peer }) => peer && !peer.handshaking && peer.linkFailed === NOT_LISTED_HERE);
      return Boolean(refused);
    }, { timeout: RECONNECT_MS, interval: 1000, label: `a node holds a connection from ${toIp} refused as ${NOT_LISTED_HERE}` });
    // eslint-disable-next-line no-restricted-syntax
    for (const j of REAL.filter((k) => k !== i)) {
      // eslint-disable-next-line no-await-in-loop
      expect(await moveHeldBy(j, oldSocket, newSocket), `fixture: node ${j} heard the move before the node told it`).to.equal(undefined);
    }
    return {
      fromIp, toIp, oldSocket, newSocket, observer: refused.j,
    };
  };

  // A connection of the observer's with `ip` that was refused authenticates on
  // the connection it joined as, and holds.
  const authenticatedInPlace = async (observer, ip, anchor, timeout, label) => {
    const node = client(observer);
    const { data } = await node.waitForEvent('peers:linkAuthenticated', (d) => d.ip === ip && d.joined === true, timeout, { afterId: anchor });
    const refused = node.getEventBuffer().find((entry) => entry.event === 'peers:linkFailed'
      && entry.data.ip === ip && entry.data.connectionId === data.connectionId && entry.data.reason === NOT_LISTED_HERE);
    expect(refused, `${label}: the connection that authenticated was refused first`).to.not.equal(undefined);
    const peer = await connectionTo(observer, ip);
    expect(peer?.connectionId, `${label}: the same connection`).to.equal(data.connectionId);
    expect(peer.authenticated, `${label}: authenticated`).to.equal(true);
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 6,
      stubPeers: [SHARED, UNLISTED],
      arcaneStubPeers: [SHARED, UNLISTED],
      // 1-based: SHARED signs with node 1's key at its own address; UNLISTED runs
      // on node 0's collateral, signing with its key and listed nowhere itself.
      sharedKeys: { [SHARED + 1]: 2 },
      collateralOf: { [UNLISTED + 1]: 1 },
      stubPeeredWith: { [UNLISTED]: [] },
      tickerAutostart: false,
    });
    await bootAndPeer(env);
    await dialUnlisted();
    await waitFor(async () => (await Promise.all(REAL.map(async (i) => {
      const peers = await connections(i);
      return [SHARED, UNLISTED].every((s) => peers.some((peer) => peer.ip === stub(s).ip && !peer.handshaking));
    }))).every(Boolean), { timeout: 120000, interval: 1000, label: 'every node holds a settled connection with both stubs' });
  });

  after(async function () {
    this.timeout(60000);
    await Promise.all(moved.map((ip) => clearNodeAddress(ip).catch(() => {})));
    await env?.teardown();
  });

  it('authenticates one operator\'s key at a second address it is listed at', async function () {
    this.timeout(120000);
    const { from, settled } = await reconnectStub(SHARED);

    // eslint-disable-next-line no-restricted-syntax
    for (const i of REAL) {
      const { peer, at } = settled.get(i);
      expect(peer.authenticated, `node ${i} authenticated the shared key at the stub's address`).to.equal(true);
      // eslint-disable-next-line no-await-in-loop
      expect(await benchCallsBetween(i, from, at), `node ${i} spent a fluxbench call on the handshake`).to.be.at.least(1);
    }
  });

  it('refuses a key listed only at another address before any fluxbench call, and carries its traffic unauthenticated', async function () {
    this.timeout(120000);
    const { from, settled } = await reconnectStub(UNLISTED);

    // eslint-disable-next-line no-restricted-syntax
    for (const i of REAL) {
      const { peer, at } = settled.get(i);
      expect([peer.authenticated, peer.linkFailed], `node ${i} refused the key at an address it is not listed at`).to.deep.equal([false, NOT_LISTED_HERE]);
      // eslint-disable-next-line no-await-in-loop
      expect(await benchCallsBetween(i, from, at), `node ${i} spent no fluxbench call on the handshake`).to.equal(0);
    }
    const { links } = await stub(UNLISTED).getStats();
    expect(links.filter((link) => !link.authenticated).length, 'the stub holds every connection, unauthenticated').to.equal(REAL.length);
  });

  it('authenticates a moved node\'s refused connection in place once the move is heard, with no node list fetched', async function () {
    this.timeout(DETECTION_MS + RECONNECT_MS + 300000);
    await stopTicker();
    const {
      toIp, oldSocket, newSocket, observer,
    } = await moveAndHold(MOVED_BY_MOVE, 231);
    const anchor = client(observer).getLastEventId();

    await client(MOVED_BY_MOVE).releaseCheckpoint(BEFORE_RECONCILE, newSocket);

    await authenticatedInPlace(observer, toIp, anchor, 180000, `node ${observer}'s connection from the moved node`);
    expect(await moveHeldBy(observer, oldSocket, newSocket), 'the observer upgraded the link on taking the move').to.not.equal(undefined);
    const ownView = await connectionTo(MOVED_BY_MOVE, client(observer).ip);
    expect(ownView?.authenticated, 'the moved node\'s end of the link authenticated too').to.equal(true);
  });

  it('authenticates a moved node\'s refused connection in place once the node list shows it there, with the move still untold, and handshakes nothing else again', async function () {
    this.timeout(DETECTION_MS + RECONNECT_MS + 300000);
    const {
      fromIp, toIp, oldSocket, newSocket, observer,
    } = await moveAndHold(MOVED_BY_LIST, 232);
    const anchor = client(observer).getLastEventId();
    const unlistedIp = stub(UNLISTED).ip;
    const unlistedBefore = new Map(await Promise.all(REAL.map(async (i) => [i, (await connectionTo(i, unlistedIp))?.connectionId])));

    await setNodeAddress(fromIp, toIp, { scope: 'all' });
    await advanceBlock();

    await authenticatedInPlace(observer, toIp, anchor, 120000, `node ${observer}'s connection from the moved node`);
    expect(await moveHeldBy(observer, oldSocket, newSocket), 'the observer upgraded the link with the move untold').to.equal(undefined);
    await client(MOVED_BY_LIST).releaseCheckpoint(BEFORE_RECONCILE, newSocket);

    // The same block listed nothing at the unlisted stub's address: the nodes
    // that did not move hold their connections with it refused, on the sockets
    // they were, and no socket of the stub's was handshaken again.
    // eslint-disable-next-line no-restricted-syntax
    for (const i of REAL.filter((j) => !MOVING.includes(j))) {
      // eslint-disable-next-line no-await-in-loop
      const peer = await connectionTo(i, unlistedIp);
      expect([peer?.connectionId, peer?.authenticated, peer?.linkFailed], `node ${i}'s connection with the unlisted stub`)
        .to.deep.equal([unlistedBefore.get(i), false, NOT_LISTED_HERE]);
    }
    const unlistedLinks = (await stub(UNLISTED).getStats()).links;
    expect(unlistedLinks.length, 'fixture: the unlisted stub holds connections').to.be.at.least(1);
    expect(unlistedLinks.filter((link) => link.authenticated || link.handshakes !== 1), 'the unlisted stub\'s links').to.deep.equal([]);
    // Two moves and a block later, no node that stayed put handshook an
    // authenticated link again.
    const stayed = REAL.filter((i) => !MOVING.includes(i)).map((i) => client(i).ip);
    const sharedLinks = (await stub(SHARED).getStats()).links.filter((link) => stayed.includes(link.peerIp));
    expect(sharedLinks.length, 'fixture: the shared-key stub holds connections').to.be.at.least(1);
    expect(sharedLinks.filter((link) => !link.authenticated || link.handshakes !== 1), 'the shared-key stub\'s links').to.deep.equal([]);
  });
});
