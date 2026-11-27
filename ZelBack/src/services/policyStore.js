const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const globalState = require('./utils/globalState');
const policyArtifactRepository = require('./appDatabase/policyArtifactRepository');
const fluxEventBus = require('./utils/fluxEventBus');
const { verifyBundle, MAX_BUNDLE_BYTES } = require('./utils/policySignature');
const { SignedDocumentExchange, backstopPhaseMs, collateralPhaseIdentity } = require('./utils/signedDocumentExchange');

// The network's policy documents, as one signed bundle, exchanged with peers by
// SignedDocumentExchange: what this node holds, then peers, then github as the backstop.
//
// What is policy's own is here: the documents and artifacts the bundle carries, and the
// acquisition gate. Everything here answers null rather than an empty value when this node has
// no verified bundle. A node that has never read policy must not act on the absence of it.

const FILE = 'policy-signed.json';
const URL = `${config.policy.signedBaseUrl}/${FILE}`;

/**
 * The acquisition gate: open when, and only when, this node holds a bundle AND has established
 * that no reachable peer is ahead of it.
 *
 * The two arrive in either order - a restored node holds one and waits for the other, a cold node
 * confirmed by an empty peer set has the other and waits for one - so the gate is derived from
 * the pair on every change rather than written by whichever arrives second.
 *
 * There is no fallback for "nobody answered", deliberately. A node with no peer set is below
 * appSyncPeerThreshold, and the network already says such a node should not be acquiring apps.
 */
function refreshGate() {
  // eslint-disable-next-line no-use-before-define
  globalState.policyReady = Boolean(exchange.isConfirmed() && exchange.isReady());
}

// Each dependency is read when it is used, so a module that replaces one of them - a test
// stubbing the repository or the fetch - replaces it for the exchange as well.
const exchange = new SignedDocumentExchange({
  name: 'policyStore',
  noun: 'bundle',
  log,
  publish: (event, payload) => fluxEventBus.publish(event, payload),
  events: {
    changed: 'policy:bundleChanged',
    backstopAsked: 'policy:backstopAsked',
    backstopAnswered: 'policy:backstopAnswered',
  },
  verify: (raw, options) => verifyBundle(raw, { ...options, publicKeys: config.policy.publicKeys }),
  read: () => policyArtifactRepository.readBundle(),
  write: (raw, seq) => policyArtifactRepository.writeBundle(raw, seq),
  fetchSource: async () => {
    const res = await serviceHelper.axiosGet(URL, {
      timeout: config.policy.fetchTimeoutMs,
      maxContentLength: MAX_BUNDLE_BYTES,
      transformResponse: [(data) => data],
    });
    return typeof res?.data === 'string' ? res.data : null;
  },
  phaseIdentity: () => collateralPhaseIdentity(log, 'policyStore'),
  // Every timing here is config, not a constant. See ZelBack/config/default.js for what each one
  // means and which of them compress: the backstop period does, the two latency bounds do not.
  timing: {
    refreshIntervalMs: config.policy.refreshIntervalMs,
    peerWindowMs: config.policy.peerWindowMs,
    minConfirmingPeers: config.policy.minConfirmingPeers,
    backstopRetryIntervalMs: config.policy.backstopRetryIntervalMs,
  },
  onStateChange: refreshGate,
});

/** Whether this node holds a verified bundle. False means unknown, never "empty". */
function isReady() {
  return exchange.isReady();
}

/** The sequence this node holds, or 0 when it holds nothing. */
function getSeq() {
  return exchange.getSeq();
}

/**
 * One policy document by name, or null when the policy is unknown.
 *
 * A name the bundle does not carry also answers null, so a document can be published before
 * the release that reads it and removed after the last release that did.
 */
function getDocument(name) {
  const current = exchange.getPayload();
  if (!current) return null;
  const value = current.documents[name];
  return value === undefined ? null : value;
}

/** The bytes of the held bundle, or null. Served to peers exactly as verified. */
function getRawBundle() {
  return exchange.getRaw();
}

/** What the bundle says about an artifact: its content-addressed name and hash. */
function getArtifact(name) {
  const current = exchange.getPayload();
  if (!current) return null;
  return current.artifacts?.[name] ?? null;
}

/**
 * Be told when the bundle changes, whether adopted or restored. Returns an unsubscribe.
 * @param {Function} listener Called with { seq, source } after the bundle is written.
 * @returns {Function} Removes the listener.
 */
function onBundleChanged(listener) {
  return exchange.onChanged(listener);
}

/**
 * A bundle a peer sent us, verified and adopted on its own merits.
 * @returns {Promise<boolean>} Whether it was adopted.
 */
function offerBundle(raw, peerKey, correlationId) {
  return exchange.offer(raw, peerKey, correlationId);
}

module.exports = {
  backstopPhaseMs,
  exchange,
  getArtifact,
  getDocument,
  getRawBundle,
  getSeq,
  isReady,
  notePeerAvailable: (peerKey) => exchange.notePeerAvailable(peerKey),
  notePeerGone: (peerKey) => exchange.notePeerGone(peerKey),
  noteThresholdReached: () => exchange.noteThresholdReached(),
  onBundleChanged,
  notePeerSeq: (seq, peerKey, correlationId) => exchange.notePeerSeq(seq, peerKey, correlationId),
  offerBundle,
  refresh: () => exchange.refresh(),
  reset: () => exchange.reset(),
  restore: () => exchange.restore(),
  setPeerTransport: (transport) => exchange.setPeerTransport(transport),
  start: () => exchange.start(),
  stop: () => exchange.stop(),
};
