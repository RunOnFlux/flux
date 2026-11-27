const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const policyArtifactRepository = require('./appDatabase/policyArtifactRepository');
const fluxEventBus = require('./utils/fluxEventBus');
const { verifySignedDocument, MAX_BUNDLE_BYTES } = require('./utils/policySignature');
const { SignedDocumentExchange, collateralPhaseIdentity } = require('./utils/signedDocumentExchange');

// The signed list of FluxOS code hashes fluxbench accepts, exchanged with peers by
// SignedDocumentExchange: what this node holds, then peers, then the published list as the
// backstop. FluxOS carries the list and does not judge by it: fluxbench hashes the code and
// decides. This node serves the bytes it holds to its peers and to fluxbench on /flux/hashlist,
// and verifies them first, so a peer offering anything else spreads nothing.
//
// A network whose profile names no hash list keys runs no store: it answers peers that it holds
// nothing, and /flux/hashlist has nothing to serve.

// A tree hash as the list carries it: 32 lower-case hex characters.
const TREE_HASH = /^[0-9a-f]{32}$/;

/**
 * Verify a signed hash list: a signed document whose payload carries `hashes`, every one a
 * tree hash.
 * @param {string} raw The list as served.
 * @param {object} options `{ minSeq, onReject }`.
 * @returns {object|null} The payload `{ seq, issued_at, hashes }`, or null.
 */
function verifyHashList(raw, options = {}) {
  const inner = verifySignedDocument(raw, {
    ...options, publicKeys: config.hashList.publicKeys, noun: 'hash list',
  });
  if (!inner) return null;
  if (!Array.isArray(inner.hashes) || !inner.hashes.every((h) => typeof h === 'string' && TREE_HASH.test(h))) {
    if (options.onReject) options.onReject('hashes is not a list of tree hashes');
    return null;
  }
  return inner;
}

const exchange = new SignedDocumentExchange({
  name: 'hashListStore',
  noun: 'hash list',
  log,
  publish: (event, payload) => fluxEventBus.publish(event, payload),
  events: {
    changed: 'hashList:documentChanged',
    backstopAsked: 'hashList:backstopAsked',
    backstopAnswered: 'hashList:backstopAnswered',
  },
  verify: verifyHashList,
  read: () => policyArtifactRepository.readSignedDocument(policyArtifactRepository.HASH_LIST_ID),
  write: (raw, seq) => policyArtifactRepository.writeSignedDocument(policyArtifactRepository.HASH_LIST_ID, raw, seq),
  fetchSource: async () => {
    const res = await serviceHelper.axiosGet(config.hashList.sourceUrl, {
      timeout: config.hashList.fetchTimeoutMs,
      maxContentLength: MAX_BUNDLE_BYTES,
      transformResponse: [(data) => data],
    });
    return typeof res?.data === 'string' ? res.data : null;
  },
  phaseIdentity: () => collateralPhaseIdentity(log, 'hashListStore'),
  timing: {
    refreshIntervalMs: config.hashList.refreshIntervalMs,
    peerWindowMs: config.hashList.peerWindowMs,
    minConfirmingPeers: config.hashList.minConfirmingPeers,
    backstopRetryIntervalMs: config.hashList.backstopRetryIntervalMs,
  },
});

/** Whether this network names hash list keys and a source, so the store runs. */
function isEnabled() {
  return Boolean(config.hashList.sourceUrl) && config.hashList.publicKeys.length > 0;
}

/** The bytes of the held list, or null. Served exactly as verified. */
function getRawList() {
  return exchange.getRaw();
}

/** The sequence this node holds, or 0 when it holds nothing. */
function getSeq() {
  return exchange.getSeq();
}

/** Restore, then keep the list current. Does nothing on a network with no hash list. */
async function start() {
  if (!isEnabled()) {
    log.info('hashListStore - this network names no hash list, so none is kept');
    return;
  }
  await exchange.start();
}

module.exports = {
  exchange,
  getRawList,
  getSeq,
  isEnabled,
  notePeerAvailable: (peerKey) => exchange.notePeerAvailable(peerKey),
  notePeerGone: (peerKey) => exchange.notePeerGone(peerKey),
  noteThresholdReached: () => exchange.noteThresholdReached(),
  notePeerSeq: (seq, peerKey, correlationId) => exchange.notePeerSeq(seq, peerKey, correlationId),
  offerList: (raw, peerKey, correlationId) => exchange.offer(raw, peerKey, correlationId),
  reset: () => exchange.reset(),
  setPeerTransport: (transport) => exchange.setPeerTransport(transport),
  start,
  stop: () => exchange.stop(),
  verifyHashList,
};
