const config = require('config');
const crypto = require('crypto');
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
// Every timing here is config, not a constant. See ZelBack/config/default.js for what each
// one means and which of them compress: the backstop period does, the two latency bounds
// do not. A 24-hour period written in this file could not be observed by any test, so the
// periodic refresh had no fleet coverage and the suites restarted nodes to fake it.
const REFRESH_INTERVAL_MS = config.policy.refreshIntervalMs;
const FETCH_TIMEOUT_MS = config.policy.fetchTimeoutMs;

// The verified payload, or null when this node has never obtained one, and the bytes it was
// verified from. The bytes are kept because that is what a peer is served: re-serialising the
// payload would produce something the signature does not cover.
let current = null;
let currentRaw = null;
// Whether this node has established that NO PEER IT CAN REACH IS AHEAD OF IT.
//
// Not "my policy is current" - no node can know that without an authority, which is the
// dependency this design exists to remove. It is the strongest available claim, and it is
// what the acquisition gate actually needs: a node must not install on policy the network
// has already moved past, and a peer holding more is how it finds out that it has.
//
// HOLDING a bundle and being entitled to ACT on it are different things. A bundle off
// disk is real and signed, but it says nothing about whether policy moved while this node
// was down - and the documents in it decide who may host what. So a restored bundle opens
// the gate once a peer reports a sequence no higher than ours, or something newer
// replaces it.
//
// There is no fallback for "nobody answered", deliberately. A node with no peer set is
// below appSyncPeerThreshold, and the network already says such a node should not be
// acquiring apps - appSyncDegradedThreshold pauses the spawner for exactly that reason.
// Unconfirmed and not-spawning are the same condition arriving twice, so a timer that
// forced the gate open would be overriding a decision the fleet had already made.
let confirmed = false;
let refreshInterval = null;
// The one-shot that carries the schedule from boot to this node's own slot in the period.
let phaseTimer = null;

// Broadcasts the ask to connected peers, and tells them what this node has adopted. Wired
// once peering is up, so this module does not reach into the communication layer and the
// ladder can be exercised without one.
let peerRequest = null;
let peerAnnounce = null;
let peerCount = null;
// Whether there is a peer set worth asking, as a LEVEL rather than an edge. Without it the
// peer rung cannot tell "asked and nobody answered" from "asked nobody" -- and the second
// is what every boot does, because the store is started before discovery.

// How long a refresh waits for a peer to answer before going to the backstop. Peers are on
// the local network and answer in milliseconds; this is the bound on how long a refresh is
// prepared to sit doing nothing, not an expectation of how long they take.
const PEER_WINDOW_MS = config.policy.peerWindowMs;

// Resolved by offerBundle when a peer's answer is adopted, so a refresh waiting on peers is
// woken rather than polling for it.
let peerAnswered = null;

// One refresh at a time. Without this, a node that gains sixteen peers in a second would
// start sixteen refreshes, each of which can reach the backstop -- the fleet-wide lockstep
// stampede against the published source that this design exists to avoid, arriving by the
// back door. A caller that asks while one is running waits for that one.
let refreshInFlight = null;

// Whether the peer rung has been offered any peers yet. The boot refresh runs before
// discovery has started (serviceManager wires peering after it), so its peer step
// broadcasts to an empty set and the ladder silently degenerates to stored + backstop.
let askedPeersSinceBoot = false;

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

/**
 * No reachable peer is ahead of this node, so it may act on what it holds.
 *
 * Called when a peer answers with a sequence at or below ours, or when anything is
 * adopted. A peer that is merely repeating a bundle we gave it still supports the claim:
 * "nobody I can reach is ahead of me" does not depend on where their copy came from. What
 * it cannot tell you is whether the WIDER network has moved on - an isolated segment
 * cannot detect that from the inside, and the backstop tick is what corrects it.
 * @param {string} source What established it, for the log.
 */
function markConfirmed(source) {
  if (confirmed) return;
  confirmed = true;
  if (!current) return;
  globalState.policyReady = true;
  log.info(`policyStore - seq ${current.seq}: no reachable peer is ahead (${source})`);
}

function adopt(raw, payload, source) {
  current = payload;
  currentRaw = raw;
  log.info(`policyStore - adopted seq ${payload.seq} from ${source}`);
  // Adopting settles it too: this bundle came from outside this node, moments ago.
  markConfirmed(`adoption from ${source}`);
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
  // Deliberately NOT opening the gate. Disk proves the bundle is real, never that it is
  // still the network's - see `confirmed`.
  log.info(`policyStore - restored seq ${payload.seq} from disk, pending confirmation`);
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
  // The rung is skipped when there is nobody worth asking. A broadcast to no peers reaches
  // nobody by definition, and waiting PEER_WINDOW_MS afterwards waits for an answer that
  // cannot come - which every node used to do on every boot, because this runs before
  // discovery has connected anything. It cost the 3s window plus the 500ms the broadcast
  // itself sleeps between directions, on every boot, to ask nobody anything.
  //
  // The count comes from peerManager's LATCHED threshold, not from a raw tally: the
  // network already defines "enough peers to gossip with" hysteretically, at
  // appSyncPeerThreshold on the way up and appSyncDegradedThreshold on the way down (12
  // and 4). Reusing it means the policy rung opens and closes with the same peer set the
  // spawner and the sync orchestrator use, and cannot flap on a single reconnect.
  //
  // A transport that does not report a count is treated as "unknown, ask anyway", so the
  // rung is only skipped on a positive answer of zero.
  const reachable = peerCount ? peerCount() : null;
  if (peerRequest && reachable !== 0) {
    // Armed before the ask, because a peer can answer while peerRequest is still awaiting.
    const answered = new Promise((resolve) => { peerAnswered = () => resolve(true); });
    await peerRequest(getSeq()).catch((error) => log.warn(`policyStore - peer request failed: ${error.message}`));
    const adopted = await Promise.race([answered, serviceHelper.delay(PEER_WINDOW_MS).then(() => false)]);
    peerAnswered = null;
    if (adopted) return true;
  }

  const raw = await fetchFromBackstop();
  if (!raw) return false;
  const adopted = consider(raw, 'backstop');
  // The source answered. Even when it carried the sequence we already had - which is the
  // ordinary case - that is the publisher itself, which is the one answer that DOES mean
  // current rather than merely not-behind-my-neighbours.
  // consider() returns false for "valid, but nothing new", which is not a failure.
  markConfirmed('the published source');
  return adopted;
}

/**
 * There is now a peer set worth asking.
 *
 * The boot refresh cannot use the peer rung: policyStore is started before discovery, so
 * when it asks, this node has no peers and the broadcast reaches nobody. Without this, the
 * first time peers are ever asked is the 24-hour backstop tick -- so a node that booted
 * while the published source was unreachable holds no policy for a day, with neighbours
 * beside it that have it. That is the gap peers-first was chosen to close, and it was open.
 *
 * Driven by peerManager's threshold edge rather than by every connection: one ask when the
 * peer set becomes usable, not sixteen as it fills. While this node holds NOTHING a later
 * crossing is another chance and gets another ask; once it holds something, one is enough
 * -- being a little behind is not urgent, and the backstop tick covers it.
 */
function notePeerAvailable() {
  if (current && askedPeersSinceBoot) return;
  askedPeersSinceBoot = true;
  refreshOnce().catch((error) => log.warn(`policyStore - peer-triggered refresh failed: ${error.message}`));
}

/**
 * Where in the backstop period this node's tick falls, derived from its identity.
 *
 * The period is per node, so the fleet's tick distribution IS its restart distribution.
 * In steady state that is spread and the first node to tick finds a change within
 * seconds. After a release wave it is not: thousands of nodes restart together, their
 * ticks bunch, and the fleet then both waits a whole period for the first look AND makes
 * that look simultaneously - a synchronised fetch against the published source. The phase
 * persists until the next wave re-scatters it.
 *
 * DETERMINISTIC, not random. A random offset re-rolls on every boot, so a restart wave
 * still has every node drawing inside the same minute and the spread decays back toward
 * the restart distribution. Hashing a stable identity instead means a node returns to the
 * slot it already had: restarting changes nothing, and the fleet is uniformly spread over
 * the period by construction rather than by luck. The ticks are aligned to absolute time,
 * so two nodes with the same identity would collide and everything else is spread by the
 * hash - which is uniform over the period by definition.
 *
 * @param {string} identity Something unique to this node and stable across restarts.
 * @param {number} periodMs The backstop period.
 * @returns {number} An offset in [0, periodMs).
 */
function backstopPhaseMs(identity, periodMs) {
  const digest = crypto.createHash('sha256').update(String(identity)).digest();
  return Number(digest.readBigUInt64BE(0) % BigInt(periodMs));
}

/**
 * This node's identity for phasing: its collateral, which is unique and outlives a reboot.
 *
 * Resolved through a local require to keep policyStore off generalService's load path -
 * the same reason fluxCommunicationMessagesSender requires this module locally. A node
 * that cannot answer falls back to a random phase, which is worse than a stable one but
 * still better than every node sharing zero.
 * @returns {Promise<string>}
 */
async function nodePhaseIdentity() {
  try {
    // eslint-disable-next-line global-require
    const generalService = require('./generalService');
    const collateral = await generalService.obtainNodeCollateralInformation();
    if (collateral && collateral.txhash) return `${collateral.txhash}:${collateral.txindex}`;
  } catch (error) {
    log.warn(`policyStore - could not read collateral for tick phasing: ${error.message}`);
  }
  return `random:${crypto.randomBytes(16).toString('hex')}`;
}

/** refresh(), with at most one in flight. Every caller but the interval goes through this. */
function refreshOnce() {
  if (!refreshInFlight) {
    refreshInFlight = refresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/**
 * Wire the peer steps. Called once peering is up; until then the ladder is stored + backstop.
 * @param {Function} request Ask peers for anything above a sequence.
 * @param {Function} announce Tell peers what this node has adopted.
 * @param {Function} [count] How many peers are connected right now. Without it the store
 *   asks regardless and waits out the window, which is what a boot used to do.
 */
function setPeerTransport({ request, announce, count } = {}) {
  peerRequest = request || null;
  peerAnnounce = announce || null;
  peerCount = count || null;
}

/**
 * A peer says it holds a sequence. It cannot be checked, so it is a prompt to ask rather than
 * something to believe -- and what comes back is a signed bundle, which can be. A peer
 * claiming a sequence it cannot produce costs one request.
 * @param {number} seq The sequence the peer claims.
 */
function notePeerSeq(seq) {
  // `null` is a peer saying it holds no policy at all. Not confirmation - an empty peer
  // cannot speak to whether ours is current - but not nothing either: it answered, so it
  // is alive, and a node whose peers all answer this way is on a network that has no
  // policy rather than one it cannot reach.
  if (!Number.isInteger(seq)) return;
  if (seq <= getSeq()) {
    // A peer that is not ahead of us is the evidence we are not behind. This is the
    // whole reason a peer answers "nothing newer" with a number instead of with silence.
    markConfirmed('peer');
    return;
  }
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
  const restored = await restore();

  // Only fetch at boot when this node came back with NOTHING.
  //
  // Phasing the tick spreads the periodic fetch across the period, but boot is not the
  // tick: a release wave restarts the fleet inside a short window, and an unconditional
  // boot fetch is then every node hitting the published source at once - the same storm
  // the phase exists to prevent, arriving through a different door. A node that restored
  // a verified bundle does not need it: it HAS policy, its own slot will bring anything
  // newer, and the first peer-threshold crossing asks peers, which is local and free.
  //
  // The cost is that a restored node can be up to one period behind until its slot comes
  // round or a peer tells it. It is never WITHOUT policy, which is the property that
  // matters - and for a node that has been off for a long time the peer ask on the first
  // threshold crossing closes the gap in seconds.
  if (!restored) await refreshOnce();

  // The first tick lands on this node's own slot rather than one period from boot, so the
  // schedule is a property of the node and not of when it happened to start. Aligned to
  // absolute time: ticks fall at t ≡ phase (mod period) forever, through any number of
  // restarts.
  const phase = backstopPhaseMs(await nodePhaseIdentity(), REFRESH_INTERVAL_MS);
  const now = Date.now();
  const firstTickIn = (Math.ceil((now - phase) / REFRESH_INTERVAL_MS) * REFRESH_INTERVAL_MS + phase) - now;
  log.info(`policyStore - backstop phase ${Math.round(phase / 1000)}s, first tick in ${Math.round(firstTickIn / 1000)}s`);
  phaseTimer = setTimeout(() => {
    refreshOnce().catch((error) => log.error(`policyStore - refresh error: ${error.message}`));
    refreshInterval = setInterval(() => {
      refreshOnce().catch((error) => log.error(`policyStore - refresh error: ${error.message}`));
    }, REFRESH_INTERVAL_MS);
  }, firstTickIn);
  // Held so start() is still idempotent while the first tick is pending.
  refreshInterval = refreshInterval || phaseTimer;
}

function stop() {
  if (phaseTimer) {
    clearTimeout(phaseTimer);
    phaseTimer = null;
  }
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
  peerCount = null;
  peerAnswered = null;
  refreshInFlight = null;
  askedPeersSinceBoot = false;
  confirmed = false;
  globalState.policyReady = false;
}

module.exports = {
  backstopPhaseMs,
  getArtifact,
  getDocument,
  getRawBundle,
  getSeq,
  isReady,
  notePeerAvailable,
  notePeerSeq,
  offerBundle,
  refresh,
  reset,
  restore,
  setPeerTransport,
  start,
  stop,
};
