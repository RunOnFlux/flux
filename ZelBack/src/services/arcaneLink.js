// Authenticated Arcane links.
//
// A link between two Arcane nodes derives a secret only the two of them can
// compute, and is authenticated once each has proved it holds that secret. A
// legacy node cannot compute it, so it cannot authenticate; a node relaying the
// handshake between two Arcane nodes cannot compute it either, and anything it
// injects fails the MAC.
//
// On each new socket, both directions:
//   1. each side sends `fluxlinknonce` {nonce}, a fresh 32-byte nonce in a signed
//      envelope. dispatchFluxMessage has checked the signature, and that the key
//      is listed, before the handler runs. A fluxbench call is made only for a
//      key listed at the socket's address, or one this node has heard move there
//      (listedHere), so one key holds a handshake budget only on the addresses
//      its nodes hold;
//   2. each side derives the secret as fluxbench's node-auth encryption of a
//      digest of both nonces, both node keys and both IPs - its own listed IP and
//      the IP the socket comes from. A relay sits on a third IP, so the two ends
//      it joins derive different secrets;
//   3. each side sends `fluxlinkconfirm` {mac}, a MAC under its own direction's
//      key, and the link is authenticated when the peer's checks out.
//
// From then on FluxPeerSocket MACs and numbers every text frame on the link
// under the sender's key, and marks what arrives under a valid MAC and a number
// past the last it took (arrivedAuthenticated).
//
// The secret never leaves the node, and nothing is cached: a new socket derives
// afresh, so no address can carry another connection's trust.
//
// A link refused because its key was not yet known at the socket's address
// (notListedHere) is handshaken again on the same socket once it is: when this
// node takes a move of that key to that address, or its node list shows it
// there. The connection carries traffic unauthenticated meanwhile, and its
// frames are MAC'd from the moment the new handshake authenticates. A peer
// whose link has not authenticated takes a fresh nonce on a joined socket as
// the start of a new handshake; an authenticated link is never handshaken
// again.

const crypto = require('node:crypto');
const config = require('config');
const log = require('../lib/log');
const benchmarkService = require('./benchmarkService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxEventBus = require('./utils/fluxEventBus');
const networkStateService = require('./networkStateService');
const { peerManager } = require('./utils/peerState');
const { normalizeSocketAddress } = require('./utils/socketAddressUtils');
const { sendSignedMessage } = require('./fluxCommunicationMessagesSender');
const peerCodec = require('./utils/peerCodec');
const linkCrypto = require('./utils/linkCrypto');

const isArcane = Boolean(process.env.FLUXOS_PATH);

const { CAPABILITY, NONCE_TYPE, CONFIRM_TYPE } = linkCrypto;

const FAILURE = Object.freeze({
  // The peer's nonce is this node's own: a reflected handshake.
  REFLECTED: 'reflected',
  MALFORMED: 'malformed',
  // The confirm is signed by a key other than the one the nonce came under.
  KEY_CHANGED: 'keyChanged',
  // This node cannot read its own node key.
  NO_KEY: 'noKey',
  BUDGET: 'budget',
  BUSY: 'busy',
  FLUXBENCH: 'fluxbench',
  // The peer did not prove the secret.
  CONFIRM: 'confirm',
  // The peer's own handshake failed, and it said so.
  PEER_GAVE_UP: 'peerGaveUp',
  // The key is not listed at the socket's address, and no move of it there
  // has been taken.
  NOT_LISTED_HERE: 'notListedHere',
  // A handshake on a joined socket was not answered in linkHandshakeDeadlineMs.
  TIMEOUT: 'timeout',
});

// The failures that are the peer's doing, and so back its IP off.
const BACKS_OFF = new Set([FAILURE.REFLECTED, FAILURE.MALFORMED, FAILURE.KEY_CHANGED, FAILURE.CONFIRM]);

// Per peer IP: { windowStart, count, backoffUntil }. Entries are made only for
// a peer whose nonce arrived under a listed key, so the map is bounded by the
// node list.
const handshakesByIp = new Map();

let nodeAuthCallsInFlight = 0;
const nodeAuthCallQueue = [];

// Moves this node has taken, by the normalized address moved to: { pubKey,
// validTill }. Each is a verified move of a listed node, kept for as long as
// the move itself is valid.
const movesTaken = new Map();

/**
 * Whether a handshake with a peer at `ip` may cost a fluxbench call now, and
 * counts it when it may.
 * @param {string} ip
 * @param {number} now
 * @returns {boolean}
 */
function admitHandshake(ip, now) {
  const { linkHandshakesPerIp, linkHandshakeWindowMs } = config.fluxapps;
  let entry = handshakesByIp.get(ip);
  if (!entry || now - entry.windowStart >= linkHandshakeWindowMs) {
    entry = { windowStart: now, count: 0, backoffUntil: entry?.backoffUntil ?? 0 };
    handshakesByIp.set(ip, entry);
  }
  if (now < entry.backoffUntil || entry.count >= linkHandshakesPerIp) return false;
  entry.count += 1;
  return true;
}

/**
 * Whether `pubKey` is listed at the peer's socket address, or has been taken
 * as moved there.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 * @param {string} pubKey
 * @returns {Promise<boolean>}
 */
async function listedHere(peer, pubKey) {
  const address = normalizeSocketAddress(peer.key);
  const node = await networkStateService.getFluxnodeBySocketAddress(address);
  if (node?.pubkey === pubKey) return true;
  const move = movesTaken.get(address);
  return Boolean(move && move.pubKey === pubKey && move.validTill > Date.now());
}

function backOff(ip, now) {
  const entry = handshakesByIp.get(ip) ?? { windowStart: now, count: 0, backoffUntil: 0 };
  entry.backoffUntil = now + config.fluxapps.linkHandshakeBackoffMs;
  handshakesByIp.set(ip, entry);
}

/**
 * Run `call` under the global cap on concurrent node-auth fluxbench calls, so a
 * reconnect flood never starves fluxbench's benchmarks and confirmation
 * signing. Over the cap the call waits; past the queue it is not made.
 * @param {function(): Promise<*>} call
 * @returns {Promise<{ran: boolean, result?: *}>}
 */
async function withNodeAuthSlot(call) {
  const { nodeAuthCallsConcurrent, nodeAuthCallsQueued } = config.fluxapps;
  if (nodeAuthCallsInFlight >= nodeAuthCallsConcurrent) {
    if (nodeAuthCallQueue.length >= nodeAuthCallsQueued) return { ran: false };
    await new Promise((resolve) => { nodeAuthCallQueue.push(resolve); });
  }
  nodeAuthCallsInFlight += 1;
  try {
    return { ran: true, result: await call() };
  } finally {
    nodeAuthCallsInFlight -= 1;
    const next = nodeAuthCallQueue.shift();
    if (next) next();
  }
}

function sendLinkFrame(data, peer) {
  return sendSignedMessage(data, peer, { encode: peerCodec.encodeLinkFrame });
}

function isLive(peer, link) {
  return peer.link === link && peer.isAlive;
}

function fail(peer, link, reason) {
  if (link.authenticated || link.failed) return;
  link.failed = reason;
  link.settle();
  if (BACKS_OFF.has(reason)) backOff(peer.ip, Date.now());
  log.warn(`arcaneLink - link with ${peer.key} not authenticated: ${reason}`);
  fluxEventBus.publish('peers:linkFailed', {
    ip: peer.ip, port: peer.port, connectionId: peer.connectionId, reason,
  });
  // A handshake settles at both ends together: a confirm with no MAC tells the
  // peer this end will not authenticate, so it settles now rather than at its
  // deadline. It names the peer's nonce, so it speaks for this handshake alone.
  // Unsent when this node cannot sign, when the peer gave up first, or when the
  // peer sent no nonce to name, which leaves the peer to its deadline.
  if (reason !== FAILURE.NO_KEY && reason !== FAILURE.PEER_GAVE_UP && linkCrypto.isHex32(link.peerNonce)) {
    sendLinkFrame({
      type: CONFIRM_TYPE, version: 1, mac: null, nonce: link.peerNonce,
    }, peer).catch((error) => log.error(error));
  }
}

/**
 * The peer's handshake failed. A link not yet authenticated settles
 * unauthenticated; one that had authenticated stops being so, since its peer no
 * longer takes what is MAC'd on it.
 * @param {object} peer
 * @param {object} link
 */
function peerGaveUp(peer, link) {
  if (!link.authenticated) {
    fail(peer, link, FAILURE.PEER_GAVE_UP);
    return;
  }
  link.authenticated = false;
  link.failed = FAILURE.PEER_GAVE_UP;
  log.warn(`arcaneLink - link with ${peer.key} no longer authenticated: ${FAILURE.PEER_GAVE_UP}`);
  fluxEventBus.publish('peers:linkFailed', {
    ip: peer.ip, port: peer.port, connectionId: peer.connectionId, reason: FAILURE.PEER_GAVE_UP,
  });
  peerManager.noteAuthenticatedLinkLost(peer.key);
}

function checkConfirm(peer, link) {
  const { mac, pubKey } = link.peerConfirm;
  if (pubKey !== link.peerPubKey) {
    fail(peer, link, FAILURE.KEY_CHANGED);
    return;
  }
  if (!linkCrypto.confirmVerifies(link.recvKey, mac)) {
    fail(peer, link, FAILURE.CONFIRM);
    return;
  }
  link.authenticated = true;
  link.settle();
  log.info(`arcaneLink - link with ${peer.key} authenticated`);
  fluxEventBus.publish('peers:linkAuthenticated', {
    ip: peer.ip, port: peer.port, connectionId: peer.connectionId, joined: !peer.handshaking,
  });
  // A connection that joined before its link authenticated is counted now.
  if (!peer.handshaking) peerManager.noteAuthenticatedLinkGained(peer.key);
}

async function deriveKeys(peer, link) {
  if (!await listedHere(peer, link.peerPubKey)) {
    fail(peer, link, FAILURE.NOT_LISTED_HERE);
    return;
  }
  if (!isLive(peer, link) || link.failed) return;
  if (!link.admitted && !admitHandshake(peer.ip, Date.now())) {
    fail(peer, link, FAILURE.BUDGET);
    return;
  }
  const { ran, result: secret } = await withNodeAuthSlot(() => benchmarkService.nodeAuthEncrypt(linkCrypto.transcript(link)));
  if (!isLive(peer, link)) return;
  if (!ran) {
    fail(peer, link, FAILURE.BUSY);
    return;
  }
  if (!secret) {
    fail(peer, link, FAILURE.FLUXBENCH);
    return;
  }
  Object.assign(link, linkCrypto.directionKeys(secret, link.localNonce, link.peerNonce));
  await sendLinkFrame({ type: CONFIRM_TYPE, version: 1, mac: linkCrypto.confirmMac(link.sendKey) }, peer);
  if (link.peerConfirm) checkConfirm(peer, link);
}

/**
 * A fresh handshake on `peer`, replacing any link it held, with its nonce sent.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 * @param {string} ownAddress
 * @returns {{link: object, settled: Promise<void>}}
 */
function openLink(peer, ownAddress) {
  const link = {
    localNonce: crypto.randomBytes(32).toString('hex'),
    localIp: ownAddress.split(':')[0],
    localPubKey: null,
    peerIp: peer.ip,
    peerNonce: null,
    peerPubKey: null,
    peerConfirm: null,
    sendKey: null,
    recvKey: null,
    // The number of the next frame this end seals, and of the last it took.
    sendNumber: 0,
    recvNumber: -1,
    authenticated: false,
    failed: null,
    // Counted against the peer IP's handshake budget already.
    admitted: false,
    ready: null,
    settle: null,
  };
  const settled = new Promise((resolve) => { link.settle = resolve; });
  peer.link = link;
  link.ready = (async () => {
    link.localPubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    if (!link.localPubKey) {
      fail(peer, link, FAILURE.NO_KEY);
      return;
    }
    await sendLinkFrame({ type: NONCE_TYPE, version: 1, nonce: link.localNonce }, peer);
  })().catch((error) => log.error(error));
  return { link, settled };
}

/**
 * Open the handshake on a new connection. FluxPeerManager calls this before the
 * connection joins the peer set, and joins it when the answer settles.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 * @returns {Promise<void>|null} Settles when the link authenticates or fails;
 *   null when no handshake applies: this node is not Arcane, does not know its
 *   own address, or the peer does not advertise the capability.
 */
function startLink(peer) {
  if (!isArcane || peer.link || !peer.remoteCapabilities.has(CAPABILITY)) return null;
  const ownAddress = peerManager.getOwnSocketAddress();
  if (!ownAddress) return null;
  return openLink(peer, ownAddress).settled;
}

/**
 * Whether a connection can be handshaken again: it has joined, and its link
 * failed. A failed link never authenticated, or stopped being authenticated
 * when its peer gave up on it.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 * @returns {boolean}
 */
function mayRestart(peer) {
  return isArcane && Boolean(peer.link?.failed) && !peer.handshaking && peer.isAlive
    && Boolean(peerManager.getOwnSocketAddress());
}

/**
 * Handshake a connection mayRestart allows again, on the same socket. Fails
 * `timeout` if it has not settled in linkHandshakeDeadlineMs.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 * @returns {object} The new link.
 */
function restartLink(peer) {
  const { link } = openLink(peer, peerManager.getOwnSocketAddress());
  const deadline = setTimeout(() => fail(peer, link, FAILURE.TIMEOUT), config.fluxapps.linkHandshakeDeadlineMs);
  const { settle } = link;
  link.settle = () => { clearTimeout(deadline); settle(); };
  return link;
}

/**
 * Handshake again each joined connection refused as notListedHere whose key is
 * now listed at its address, or taken as moved there.
 * @param {string} [address] Only the connections at this socket address.
 * @returns {Promise<void>}
 */
async function relinkListed(address) {
  const due = peerManager.getUnauthenticatedPeers().filter((peer) => peer.link?.failed === FAILURE.NOT_LISTED_HERE
    && (!address || normalizeSocketAddress(peer.key) === address));
  await Promise.all(due.map(async (peer) => {
    const { link } = peer;
    if (!await listedHere(peer, link.peerPubKey)) return;
    if (mayRestart(peer)) restartLink(peer);
  }));
}

/**
 * A move this node has taken: the node listed with `pubKey` is now at `newIP`.
 * Its links refused there for want of a listing are handshaken again.
 * @param {string} newIP The socket address moved to.
 * @param {string} pubKey The move's verified signer.
 * @param {number} validTill When the move stops being valid (ms).
 * @returns {Promise<void>}
 */
async function noteMoveTaken(newIP, pubKey, validTill) {
  if (!isArcane) return;
  const now = Date.now();
  movesTaken.forEach((move, address) => { if (move.validTill <= now) movesTaken.delete(address); });
  const address = normalizeSocketAddress(newIP);
  if (!address || validTill <= now) return;
  movesTaken.set(address, { pubKey, validTill });
  await relinkListed(address);
}

if (isArcane) {
  networkStateService.onUpdated(() => { relinkListed().catch((error) => log.error(error)); });
}

/**
 * A peer's nonce. A link takes one. A later one starts a new handshake where
 * mayRestart allows, counted against the peer IP's handshake budget when it
 * starts, and is ignored otherwise or past the budget.
 * @param {object} msg Verified envelope.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 */
async function handleNonce(msg, peer) {
  let { link } = peer;
  if (!link) return;
  if (link.peerNonce || link.failed) {
    if (!mayRestart(peer) || !admitHandshake(peer.ip, Date.now())) return;
    link = restartLink(peer);
    link.admitted = true;
  }
  const nonce = msg.data?.nonce;
  link.peerNonce = typeof nonce === 'string' ? nonce : '';
  link.peerPubKey = msg.pubKey;
  if (!linkCrypto.isHex32(link.peerNonce)) {
    fail(peer, link, FAILURE.MALFORMED);
    return;
  }
  if (link.peerNonce === link.localNonce) {
    fail(peer, link, FAILURE.REFLECTED);
    return;
  }
  await link.ready;
  if (link.failed || !isLive(peer, link)) return;
  await deriveKeys(peer, link);
}

/**
 * A peer's proof that it derived the secret, one per link; or, with no MAC and
 * this link's nonce, its word that its own handshake failed. A peer sends its confirm after its
 * nonce, so a link takes one only once it holds the peer's nonce: a confirm
 * that arrives before it belongs to a handshake this link replaced.
 * @param {object} msg Verified envelope.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 */
function handleConfirm(msg, peer) {
  const { link } = peer;
  if (!link || link.failed || !link.peerNonce) return;
  if (msg.data?.mac === null) {
    if (msg.pubKey === link.peerPubKey && msg.data.nonce === link.localNonce) peerGaveUp(peer, link);
    return;
  }
  if (link.peerConfirm) return;
  link.peerConfirm = { mac: msg.data?.mac, pubKey: msg.pubKey };
  if (link.recvKey) checkConfirm(peer, link);
}

/**
 * Whether a peer's link has authenticated as Arcane.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 * @returns {boolean}
 */
function isAuthenticated(peer) {
  return Boolean(peer?.link?.authenticated);
}

/** Test seam: forget every per-IP budget, the call queue and the moves taken. */
function resetState() {
  handshakesByIp.clear();
  movesTaken.clear();
  nodeAuthCallsInFlight = 0;
  nodeAuthCallQueue.length = 0;
}

module.exports = {
  CAPABILITY,
  NONCE_TYPE,
  CONFIRM_TYPE,
  FAILURE,
  startLink,
  noteMoveTaken,
  handleNonce,
  handleConfirm,
  isAuthenticated,
  resetState,
};
