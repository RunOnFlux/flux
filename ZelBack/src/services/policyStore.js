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
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 10 * 1000; // bound it so a boot is never stuck on one source

// The verified payload, or null when this node has never obtained one.
let current = null;
let refreshInterval = null;

// Asked for peer candidates. Wired by serviceManager once peering is up, so this module does
// not reach into the communication layer and the ladder can be exercised without one.
let peerFetch = null;

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

/** What the bundle says about an artifact: its content-addressed name and hash. */
function getArtifact(name) {
  if (!current) return null;
  return current.artifacts?.[name] ?? null;
}

function adopt(raw, payload, source) {
  current = payload;
  globalState.policyReady = true;
  log.info(`policyStore - adopted seq ${payload.seq} from ${source}`);
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
  globalState.policyReady = true;
  log.info(`policyStore - restored seq ${payload.seq} from disk`);
  return true;
}

/**
 * Ask peers, then the backstop. Stops at the first candidate that verifies and beats what is
 * held, so a healthy node asking its neighbours never reaches github.
 */
async function refresh() {
  if (peerFetch) {
    const candidates = await peerFetch(getSeq()).catch((error) => {
      log.warn(`policyStore - peer fetch failed: ${error.message}`);
      return [];
    });
    // eslint-disable-next-line no-restricted-syntax
    for (const candidate of candidates) {
      if (consider(candidate, 'peer')) return true;
    }
  }

  const raw = await fetchFromBackstop();
  return raw ? consider(raw, 'backstop') : false;
}

/** Wire the peer step. Called once peering is up; until then the ladder is stored + backstop. */
function setPeerFetch(fn) {
  peerFetch = fn;
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
  peerFetch = null;
  globalState.policyReady = false;
}

module.exports = {
  getArtifact,
  getDocument,
  getSeq,
  isReady,
  refresh,
  reset,
  restore,
  setPeerFetch,
  start,
  stop,
};
