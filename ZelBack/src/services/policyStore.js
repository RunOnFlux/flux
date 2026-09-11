const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const globalState = require('./utils/globalState');
const policyArtifactRepository = require('./appDatabase/policyArtifactRepository');
const { verifyBundle, MAX_BUNDLE_BYTES } = require('./utils/policySignature');

// The network's policy documents, as one signed bundle.
//
// Resolution is a ladder, the same one contentBlobService.resolveBlob uses for app content:
// what this node already holds, then peers, then the published source as a backstop. Every
// candidate is verified by the receiver, so a source that answers wrongly is skipped rather
// than believed, and the ladder can prefer whatever is nearest without that being a trust
// decision.
//
// The order is what makes github a seed rather than a dependency. In steady state nothing is
// fetched at all -- the stored bundle is valid and that is the end of it -- and when a refresh
// is due, sixteen peers on the local network are asked before one request leaves for github.
// A node that boots while github is unreachable gets its policy from a neighbour.
//
// Everything here answers null rather than an empty value when this node has no verified
// bundle. A node that has never read policy must not act on the absence of it.

const FILE = 'policy-signed.json';
const URL = `${config.policy.signedBaseUrl}/${FILE}`;
// The backstop poll. Long, because it is no longer how a change reaches a node: adoption is
// announced to peers and spreads outwards in seconds, so this exists for a node that missed
// the announcement -- offline at the time, or with no peers holding it yet -- and for the
// cold start where there is nothing to miss.
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 10 * 1000; // bound it so a boot is never stuck on one source

// The verified payload, or null when this node has never obtained one, and the bytes it was
// verified from. The bytes are kept because that is what a peer is served: re-serialising the
// payload would produce something the signature does not cover.
let current = null;
let currentRaw = null;
let refreshInterval = null;

// Broadcasts the ask to connected peers, and tells them what this node has adopted. Wired
// once peering is up, so this module does not reach into the communication layer and the
// ladder can be exercised without one.
let peerRequest = null;
let peerAnnounce = null;

// How long a refresh waits for a peer to answer before going to the backstop. Peers are on
// the local network and answer in milliseconds; this is the bound on how long a refresh is
// prepared to sit doing nothing, not an expectation of how long they take.
const PEER_WINDOW_MS = 3 * 1000;

// Resolved by offerBundle when a peer's answer is adopted, so a refresh waiting on peers is
// woken rather than polling for it.
let peerAnswered = null;

/** Whether this node holds a verified bundle. False means unknown, never "empty". */
function isReady() {
  return current !== null;
}

/** The sequence this node holds, or 0 when it holds nothing. */
function getSeq() {
  return current ? current.seq : 0;
}

/**
 * One policy document by name, or null when the policy is unknown.
 *
 * A name the bundle does not carry also answers null, so a document can be published before
 * the release that reads it and removed after the last release that did.
 */
function getDocument(name) {
  if (!current) return null;
  const value = current.documents[name];
  return value === undefined ? null : value;
}

/** The bytes of the held bundle, or null. Served to peers exactly as verified. */
function getRawBundle() {
  return currentRaw;
}

/** What the bundle says about an artifact: its content-addressed name and hash. */
function getArtifact(name) {
  if (!current) return null;
  return current.artifacts?.[name] ?? null;
}

function adopt(raw, payload, source) {
  current = payload;
  currentRaw = raw;
  globalState.policyReady = true;
  log.info(`policyStore - adopted seq ${payload.seq} from ${source}`);
  // Announced on adoption, never on a timer. Each adopter tells its own peers, so a change
  // spreads outwards from whichever node reached the backstop first rather than every node
  // waiting out its own interval. The traffic is bounded by how often policy changes.
  if (peerAnnounce) {
    peerAnnounce(payload.seq).catch((error) => log.warn(`policyStore - could not announce seq: ${error.message}`));
  }
  // Persisted as the bytes that were verified. Failing to store is untidy rather than
  // incorrect: this node is already running on the bundle, it just will not have it at the
  // next boot.
  policyArtifactRepository.writeBundle(raw, payload.seq)
    .catch((error) => log.warn(`policyStore - could not persist bundle: ${error.message}`));
}

/**
 * Verify a candidate and adopt it if it beats what this node holds.
 *
 * minSeq is getSeq() rather than getSeq() + 1: re-verifying the sequence already held is
 * harmless and means a source that is merely level is not treated as hostile.
 */
function consider(raw, source) {
  const payload = verifyBundle(raw, {
    publicKeys: config.policy.publicKeys,
    minSeq: getSeq(),
    onReject: (reason) => log.warn(`policyStore - rejected bundle from ${source}: ${reason}`),
  });
  if (!payload) return false;
  if (current && payload.seq === current.seq) return false; // valid, but nothing new
  adopt(raw, payload, source);
  return true;
}

/** The published source. Last in the ladder, and the only step that leaves the network. */
async function fetchFromBackstop() {
  try {
    const res = await serviceHelper.axiosGet(URL, {
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_BUNDLE_BYTES,
      // Kept as text: the signature covers the bytes as served, and letting axios parse and
      // this module re-serialise would verify something the signer never signed.
      transformResponse: [(data) => data],
    });
    return typeof res?.data === 'string' ? res.data : null;
  } catch (error) {
    log.warn(`policyStore - backstop fetch failed: ${error.message}`);
    return null;
  }
}

/**
 * Restore the bundle this node last verified.
 *
 * Re-verified rather than trusted: the row is as good as whatever could write to this node's
 * database, and a bundle that was valid when stored is cheap to check again. A stored bundle
 * that no longer verifies is dropped, because the pinned keys may have moved on.
 */
async function restore() {
  const stored = await policyArtifactRepository.readBundle().catch(() => null);
  if (!stored) return false;
  const payload = verifyBundle(stored.raw, {
    publicKeys: config.policy.publicKeys,
    onReject: (reason) => log.warn(`policyStore - stored bundle rejected, will refetch: ${reason}`),
  });
  if (!payload) return false;
  current = payload;
  currentRaw = stored.raw;
  globalState.policyReady = true;
  log.info(`policyStore - restored seq ${payload.seq} from disk`);
  return true;
}

/**
 * A bundle a peer sent us. Verified and adopted on its own merits, exactly as one fetched
 * from the backstop would be -- the source is not part of the decision.
 *
 * Called by the message handler whenever a peer answers, including outside a refresh: a peer
 * that has just adopted something newer is worth listening to whenever it speaks.
 * @param {string} raw The bundle as received.
 * @returns {boolean} Whether it was adopted.
 */
function offerBundle(raw) {
  const adopted = consider(raw, 'peer');
  if (adopted && peerAnswered) peerAnswered();
  return adopted;
}

/**
 * Ask peers, then the backstop.
 *
 * Peer replies arrive asynchronously through offerBundle rather than being returned, so this
 * asks and then waits a bounded moment to see whether the sequence moved. Polling the value
 * rather than waiting on a reply keeps the two paths independent: a bundle that arrives late,
 * or unprompted, is still adopted -- it just does not stop this refresh going to the backstop.
 */
async function refresh() {
  if (peerRequest) {
    // Armed before the ask, because a peer can answer while peerRequest is still awaiting.
    const answered = new Promise((resolve) => { peerAnswered = () => resolve(true); });
    await peerRequest(getSeq()).catch((error) => log.warn(`policyStore - peer request failed: ${error.message}`));
    const adopted = await Promise.race([answered, serviceHelper.delay(PEER_WINDOW_MS).then(() => false)]);
    peerAnswered = null;
    if (adopted) return true;
  }

  const raw = await fetchFromBackstop();
  return raw ? consider(raw, 'backstop') : false;
}

/**
 * Wire the peer steps. Called once peering is up; until then the ladder is stored + backstop.
 * @param {Function} request Ask peers for anything above a sequence.
 * @param {Function} announce Tell peers what this node has adopted.
 */
function setPeerTransport({ request, announce } = {}) {
  peerRequest = request || null;
  peerAnnounce = announce || null;
}

/**
 * A peer says it holds a sequence. It cannot be checked, so it is a prompt to ask rather than
 * something to believe -- and what comes back is a signed bundle, which can be. A peer
 * claiming a sequence it cannot produce costs one request.
 * @param {number} seq The sequence the peer claims.
 */
function notePeerSeq(seq) {
  if (!Number.isInteger(seq) || seq <= getSeq()) return;
  if (!peerRequest) return;
  peerRequest(getSeq()).catch((error) => log.warn(`policyStore - peer request failed: ${error.message}`));
}

/**
 * Restore, refresh, then keep refreshing. Safe to call twice.
 *
 * Boot is not blocked on this: a node that cannot resolve a bundle carries on, serves its API
 * and keeps its containers running. What waits is acquisition, through globalState.policyReady
 * -- the one decision that must never be made on a guess.
 */
async function start() {
  if (refreshInterval) return;
  await restore();
  await refresh();
  refreshInterval = setInterval(() => {
    refresh().catch((error) => log.error(`policyStore - refresh error: ${error.message}`));
  }, REFRESH_INTERVAL_MS);
}

function stop() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

/** Test seam: forget everything this process holds. */
function reset() {
  stop();
  current = null;
  currentRaw = null;
  peerRequest = null;
  peerAnnounce = null;
  peerAnswered = null;
  globalState.policyReady = false;
}

module.exports = {
  getArtifact,
  getDocument,
  getRawBundle,
  getSeq,
  isReady,
  notePeerSeq,
  offerBundle,
  refresh,
  reset,
  restore,
  setPeerTransport,
  start,
  stop,
};
