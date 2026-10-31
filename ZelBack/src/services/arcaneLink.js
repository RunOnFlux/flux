// Authenticated Arcane links.
//
// A link between two Arcane nodes derives a secret only the two of them can
// compute, and is authenticated once each has proved it holds that secret. A
// legacy node cannot compute it, so it cannot authenticate; a node relaying the
// handshake between two Arcane nodes cannot compute it either, and anything it
// injects fails the MAC.
//
// Once per socket, both directions:
//   1. each side sends `fluxlinknonce` {nonce}, a fresh 32-byte nonce in a signed
//      envelope. dispatchFluxMessage has checked the signature, and that the key
//      is listed, before the handler runs, so no fluxbench call is made for a
//      peer that holds no listed key;
//   2. each side derives the secret as fluxbench's node-auth encryption of a
//      digest of both nonces, both node keys and both IPs - its own listed IP and
//      the IP the socket comes from. A relay sits on a third IP, so the two ends
//      it joins derive different secrets;
//   3. each side sends `fluxlinkconfirm` {mac}, a MAC under its own direction's
//      key, and the link is authenticated when the peer's checks out.
//
// The secret never leaves the node, and nothing is cached: a new socket derives
// afresh, so no address can carry another connection's trust.

const crypto = require('node:crypto');
const config = require('config');
const log = require('../lib/log');
const benchmarkService = require('./benchmarkService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxEventBus = require('./utils/fluxEventBus');
const { peerManager } = require('./utils/peerState');
const { sendSignedMessage } = require('./fluxCommunicationMessagesSender');

const isArcane = Boolean(process.env.FLUXOS_PATH);

const CAPABILITY = 'arcaneLink';
const NONCE_TYPE = 'fluxlinknonce';
const CONFIRM_TYPE = 'fluxlinkconfirm';
const HEX_32_BYTES = /^[0-9a-f]{64}$/;

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
});

// The failures that are the peer's doing, and so back its IP off.
const BACKS_OFF = new Set([FAILURE.REFLECTED, FAILURE.MALFORMED, FAILURE.KEY_CHANGED, FAILURE.CONFIRM]);

// Per peer IP: { windowStart, count, backoffUntil }. Entries are made only for
// a peer whose nonce arrived under a listed key, so the map is bounded by the
// node list.
const handshakesByIp = new Map();

let nodeAuthCallsInFlight = 0;
const nodeAuthCallQueue = [];

function hmac(key, text) {
  return crypto.createHmac('sha256', key).update(text).digest();
}

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
  if (now < entry.backoffUntil) return false;
  if (entry.count >= linkHandshakesPerIp) return false;
  entry.count += 1;
  return true;
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

/**
 * The text both ends encrypt. Each list is sorted, so both derive one value.
 * Hashed, so fluxbench encrypts a fixed 64 characters.
 * @param {object} link
 * @returns {string}
 */
function transcript(link) {
  const sorted = (a, b) => [a, b].sort().join(',');
  const text = [
    NONCE_TYPE, 1,
    sorted(link.localNonce, link.peerNonce),
    sorted(link.localPubKey, link.peerPubKey),
    sorted(link.localIp, link.peerIp),
  ].join('|');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isLive(peer, link) {
  return peer.link === link && peer.isAlive;
}

function fail(peer, link, reason) {
  if (link.authenticated || link.failed) return;
  link.failed = reason;
  if (BACKS_OFF.has(reason)) backOff(peer.ip, Date.now());
  log.warn(`arcaneLink - link with ${peer.key} not authenticated: ${reason}`);
  fluxEventBus.publish('peers:linkFailed', { ip: peer.ip, port: peer.port, reason });
}

function checkConfirm(peer, link) {
  const { mac, pubKey } = link.peerConfirm;
  if (pubKey !== link.peerPubKey) {
    fail(peer, link, FAILURE.KEY_CHANGED);
    return;
  }
  const expected = hmac(link.recvKey, CONFIRM_TYPE);
  const given = typeof mac === 'string' && HEX_32_BYTES.test(mac) ? Buffer.from(mac, 'hex') : null;
  if (!given || !crypto.timingSafeEqual(given, expected)) {
    fail(peer, link, FAILURE.CONFIRM);
    return;
  }
  link.authenticated = true;
  log.info(`arcaneLink - link with ${peer.key} authenticated`);
  fluxEventBus.publish('peers:linkAuthenticated', { ip: peer.ip, port: peer.port });
}

async function deriveKeys(peer, link) {
  if (!admitHandshake(peer.ip, Date.now())) {
    fail(peer, link, FAILURE.BUDGET);
    return;
  }
  const { ran, result: secret } = await withNodeAuthSlot(() => benchmarkService.nodeAuthEncrypt(transcript(link)));
  if (!isLive(peer, link)) return;
  if (!ran) {
    fail(peer, link, FAILURE.BUSY);
    return;
  }
  if (!secret) {
    fail(peer, link, FAILURE.FLUXBENCH);
    return;
  }
  // One key per direction, named by the sender's nonce, so nothing sent on the
  // link verifies when it is sent back.
  link.sendKey = hmac(secret, `send|${link.localNonce}`);
  link.recvKey = hmac(secret, `send|${link.peerNonce}`);
  await sendSignedMessage({ type: CONFIRM_TYPE, version: 1, mac: hmac(link.sendKey, CONFIRM_TYPE).toString('hex') }, peer);
  if (link.peerConfirm) checkConfirm(peer, link);
}

/**
 * Open the handshake on a newly connected peer. Nothing happens unless this
 * node is Arcane, knows its own address, and the peer advertises the
 * capability. The link exists from the moment the peer connects, so a nonce
 * that arrives while this node is still reading its own key waits for it.
 * @param {string} peerKey
 */
async function startLink(peerKey) {
  if (!isArcane) return;
  const peer = peerManager.get(peerKey);
  if (!peer || peer.link || !peer.remoteCapabilities.has(CAPABILITY)) return;
  const ownAddress = peerManager.getOwnSocketAddress();
  if (!ownAddress) return;
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
    authenticated: false,
    failed: null,
    ready: null,
  };
  peer.link = link;
  link.ready = (async () => {
    link.localPubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    if (!link.localPubKey) {
      fail(peer, link, FAILURE.NO_KEY);
      return;
    }
    await sendSignedMessage({ type: NONCE_TYPE, version: 1, nonce: link.localNonce }, peer);
  })();
  await link.ready;
}

/**
 * A peer's nonce. One per socket; a later one is ignored.
 * @param {object} msg Verified envelope.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 */
async function handleNonce(msg, peer) {
  const { link } = peer;
  if (!link || link.peerNonce || link.failed) return;
  const nonce = msg.data?.nonce;
  link.peerNonce = typeof nonce === 'string' ? nonce : '';
  link.peerPubKey = msg.pubKey;
  if (!HEX_32_BYTES.test(link.peerNonce)) {
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
 * A peer's proof that it derived the secret. One per socket.
 * @param {object} msg Verified envelope.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 */
function handleConfirm(msg, peer) {
  const { link } = peer;
  if (!link || link.peerConfirm || link.failed) return;
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

/**
 * The MAC this node puts on `text` sent over an authenticated link.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 * @param {string} text
 * @returns {string|null} Hex, or null when the link is not authenticated.
 */
function macFor(peer, text) {
  if (!isAuthenticated(peer)) return null;
  return hmac(peer.link.sendKey, text).toString('hex');
}

/**
 * Whether `mac` is the peer's MAC on `text` over an authenticated link.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer
 * @param {string} text
 * @param {string} mac
 * @returns {boolean}
 */
function verifyFrom(peer, text, mac) {
  if (!isAuthenticated(peer) || typeof mac !== 'string' || !HEX_32_BYTES.test(mac)) return false;
  return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), hmac(peer.link.recvKey, text));
}

/** Test seam: forget every per-IP budget and the call queue. */
function resetState() {
  handshakesByIp.clear();
  nodeAuthCallsInFlight = 0;
  nodeAuthCallQueue.length = 0;
}

module.exports = {
  CAPABILITY,
  NONCE_TYPE,
  CONFIRM_TYPE,
  FAILURE,
  startLink,
  handleNonce,
  handleConfirm,
  isAuthenticated,
  macFor,
  verifyFrom,
  resetState,
};
