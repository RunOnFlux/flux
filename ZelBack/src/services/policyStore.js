const config = require('config');
const crypto = require('crypto');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const { PeerRequests } = require('./utils/peerRequests');
const globalState = require('./utils/globalState');
const policyArtifactRepository = require('./appDatabase/policyArtifactRepository');
const fluxEventBus = require('./utils/fluxEventBus');
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
// Asks ONE named peer whether it is ahead. One message and one reply, so it needs no
// rationing and can run on every arrival.
let peerRequestFrom = null;
let peerAnnounce = null;
// Whether the peer set is above appSyncPeerThreshold, as a LEVEL rather than an edge. Without
// it the peer rung cannot tell "asked and nobody answered" from "asked nobody" -- and the
// second is what every boot does, because the store is started before discovery.
let peerAboveThreshold = null;
// One seed at a time. Every settling ask evaluates the predicate, so a fleet answering
// together would otherwise have several of them find it true at once and fetch in lockstep -
// which is the traffic against the published source this whole design exists to avoid.
let seedInFlight = false;

// How long a refresh waits for a peer to answer before going to the backstop. Peers are on
// the local network and answer in milliseconds; this is the bound on how long a refresh is
// prepared to sit doing nothing, not an expectation of how long they take.
const PEER_WINDOW_MS = config.policy.peerWindowMs;

// Resolved by offerBundle when a peer's answer is adopted, so a refresh waiting on peers is
// woken rather than polling for it.
let peerAnswered = null;

// A RESTART is the one moment a node is certain to be behind and cannot tell: it restored a
// bundle, so it holds something, and its peers may hold the same stale thing. Peer
// confirmation cannot decide it - a peer at the same sequence answers "not ahead", which is
// true and useless, and it is what a whole fleet restarted together says to itself.
//
// What breaks that tie is the phased tick, not a per-boot ladder run. Ticks are spread over
// the period by node identity, so across the fleet one node is always the next to look - and
// whatever it finds it announces, which is how the answer reaches everyone that restarted
// beside it. A ladder run per boot breaks the same tie by having EVERY node ask the source,
// moments after the release-wave guard in start() declined to.

// Every peer answers - respondWithPolicy replies in all three states - so silence means only
// "not there". A targeted ask therefore ends on its answer, and PEER_WINDOW_MS is the floor
// for a peer that has gone away rather than the mechanism.
const peerAsks = new PeerRequests();

// Told when the bundle this node holds changes, so a consumer whose work depends on the
// bundle runs when it arrives rather than polling for it.
//
// THE BUNDLE IS A DEPENDENCY OTHER MODULES HAVE, and until this existed the only way to
// have one was to read getArtifact/getDocument at some moment and hope it was the right
// one. ipLocationSync did exactly that: it starts on dbReady, which is a signal about the
// app database and says nothing about policy, and when it found nothing it backed off for
// ten minutes. Both chains hang off the peer threshold, so which of them finished first
// was a race - won in practice, guaranteed nowhere.
const bundleListeners = new Set();

// One refresh at a time. The callers are boot-with-an-empty-store and this node's own tick,
// which can overlap only when a boot fetch is still outstanding as the first tick falls due -
// rare, and two concurrent fetches of the same bundle is exactly the lockstep traffic against
// the published source this design exists to avoid. A caller that asks while one is running
// waits for that one.
let refreshInFlight = null;


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
 * Open the acquisition gate when, and only when, BOTH facts hold.
 *
 * Holding a bundle and having established that nobody is ahead of it are independent, and
 * they arrive in either order: a restored node holds one and waits for the other, a cold
 * node confirmed by an empty peer set has the other and waits for one. The gate is derived
 * from the pair rather than written by whichever arrives second, because a latch on one of
 * them records the CONJUNCTION in a variable that only tracks one term - and then the term
 * it does not track can never open it. Recomputing costs nothing and cannot be ordered
 * wrongly.
 */
function refreshGate() {
  globalState.policyReady = Boolean(confirmed && current);
}

/**
 * No reachable peer is ahead of this node, so it may act on what it holds.
 *
 * Called when a peer answers with a sequence at or below ours, or when anything is
 * adopted. A peer that is merely repeating a bundle we gave it still supports the claim:
 * "nobody I can reach is ahead of me" does not depend on where their copy came from. What
 * it cannot tell you is whether the WIDER network has moved on - an isolated segment
 * cannot detect that from the inside, and the backstop tick is what corrects it.
 *
 * Says nothing about whether this node HOLDS anything: an empty node whose peers are all
 * level with it is genuinely not behind them, it just has nothing to act on yet. That pair
 * is what refreshGate() resolves.
 * @param {string} source What established it, for the log.
 */
function markConfirmed(source) {
  if (confirmed) return;
  confirmed = true;
  refreshGate();
  log.info(`policyStore - seq ${getSeq()}: no reachable peer is ahead (${source})`);
}

/**
 * Tell everything that depends on the bundle that it has changed.
 *
 * Fired wherever `current` is written, which is adoption and restore - a bundle off disk is
 * as much "the policy this node now holds" as one off a peer, and a consumer that only heard
 * about one of them would be right half the time.
 *
 * A listener that throws is logged and skipped. It is telemetry to its subscribers, not a
 * step in adopting: a consumer failing must not cost this node the bundle it just verified.
 * @param {string} source Where the bundle came from, for the log and the event.
 */
function notifyBundleChanged(source) {
  fluxEventBus.publish('policy:bundleChanged', { seq: getSeq(), source });
  bundleListeners.forEach((listener) => {
    try {
      listener({ seq: getSeq(), source });
    } catch (error) {
      log.warn(`policyStore - a bundle listener threw: ${error.message}`);
    }
  });
}

/**
 * Be told when the bundle changes. Returns an unsubscribe.
 * @param {Function} listener Called with { seq, source } after `current` is written.
 * @returns {Function} Removes the listener.
 */
function onBundleChanged(listener) {
  bundleListeners.add(listener);
  return () => bundleListeners.delete(listener);
}

function adopt(raw, payload, source) {
  current = payload;
  currentRaw = raw;
  refreshGate();
  log.info(`policyStore - adopted seq ${payload.seq} from ${source}`);
  // Adopting settles it too: this bundle came from outside this node, moments ago.
  markConfirmed(`adoption from ${source}`);
  // Announced on adoption, never on a timer. Each adopter tells its own peers, so a change
  // spreads outwards from whichever node reached the backstop first rather than every node
  // waiting out its own interval. The traffic is bounded by how often policy changes.
  if (peerAnnounce) {
    peerAnnounce(payload.seq).catch((error) => log.warn(`policyStore - could not announce seq: ${error.message}`));
  }
  notifyBundleChanged(source);
  // Persisted as the bytes that were verified. Failing to store is untidy rather than
  // incorrect: this node is already running on the bundle, it just will not have it at the
  // next boot.
  policyArtifactRepository.writeBundle(raw, payload.seq)
    .catch((error) => log.warn(`policyStore - could not persist bundle: ${error.message}`));
}

// What a candidate turned out to be. Three outcomes, not two: a body that did not verify
// and a body that verified and carried the sequence already held are both "nothing was
// adopted", and they mean opposite things about the source. Collapsing them to `false` is
// what let an unverified answer stand in for the publisher - see refresh().
const VERDICT = Object.freeze({ ADOPTED: 'adopted', LEVEL: 'level', REJECTED: 'rejected' });

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
  if (!payload) return VERDICT.REJECTED;
  if (current && payload.seq === current.seq) return VERDICT.LEVEL; // valid, but nothing new
  adopt(raw, payload, source);
  return VERDICT.ADOPTED;
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
  // Through the derivation like every other write to either fact, NOT because this opens
  // the gate - disk proves the bundle is real, never that it is still the network's, and
  // `confirmed` is false here on any ordinary boot, so this is a no-op. It is here because
  // a peer can answer while start() is still awaiting this: markConfirmed would then have
  // set `confirmed` with the store still empty, and a restore that wrote `current` without
  // re-deriving would strand the gate exactly as the old latch did. See `confirmed`.
  refreshGate();
  notifyBundleChanged('disk');
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
function offerBundle(raw, peerKey, correlationId) {
  const adopted = consider(raw, 'peer') === VERDICT.ADOPTED;
  if (adopted && peerAnswered) peerAnswered();
  settlePeerAsk(peerKey, correlationId);
  return adopted;
}

/**
 * Ends a targeted ask waiting on this peer. Any of the three answers settles it.
 * @param {string} [peerKey] ip:port of the peer that answered.
 */
function settlePeerAsk(peerKey, correlationId) {
  if (!peerKey) return;
  // An answer naming nothing is from a peer that does not send the id yet, and there the
  // socket it came back on is the only thing identifying it.
  peerAsks.settle(peerKey, 'answered', correlationId ? { id: correlationId } : {});
}

/**
 * Ask ONE peer whether it is ahead, and adopt what it sends if it is.
 *
 * This rung never reaches the published source. The source is rate-limited and shared by the
 * fleet, so anything that can reach it must run on the backstop's timer; the peer question is
 * one signed message on the local network and runs as often as peers arrive.
 *
 * Settles on the answer - a bundle if the peer is ahead, its sequence if not, null if it
 * holds nothing - so PEER_WINDOW_MS bounds only a peer that left between connecting and
 * being asked.
 * @param {string} peerKey ip:port.
 */
async function askPeer(peerKey) {
  // One outstanding ask per peer. A second is not more informative, and a peer that
  // reconnects repeatedly must not accumulate them.
  if (peerAsks.has(peerKey)) return;
  const request = peerAsks.open(peerKey, {
    timeoutMs: PEER_WINDOW_MS,
    onTimeout: (key) => peerAsks.settle(key, 'timedOut'),
  });
  try {
    await peerRequestFrom(peerKey, getSeq(), request.id);
    await request.settled;
  } finally {
    peerAsks.discard(peerKey);
    // IN THE FINALLY, so a send that threw still gets here. Otherwise an ask that failed to
    // leave the node would skip the decision, and if it were the last one outstanding the
    // node would sit holding nothing until another peer happened to arrive. Its own error is
    // kept separate so it cannot mask the one the ask is already propagating.
    await seedIfPeersHaveNothing()
      .catch((error) => log.error(`policyStore - seeding from the source failed: ${error.message}`));
  }
}

/**
 * The peers have been asked and have answered. If none of them had anything, seed from the
 * published source.
 *
 * THE ONLY PLACE A NODE WITHOUT POLICY REACHES THE SOURCE. Derived from three facts rather
 * than fired by an event, because any of the three can be the last to become true and a latch
 * on one of them records a conjunction it cannot track - the mistake refreshGate above exists
 * to avoid:
 *
 *   nothing is outstanding  every peer this node has was asked AND has answered. Peers reply
 *                           in all three states, so "holds nothing" settles an ask exactly as
 *                           a bundle does, and a peer that vanished settles on PEER_WINDOW_MS.
 *   the set is above threshold  enough peers to have been worth asking, as the network
 *                           already defines it. Below it, an empty store says only that
 *                           peering is young.
 *   this node holds nothing  anything at all, however old, is carried forward by peers and
 *                           by this node's own tick.
 *
 * Together they mean: nobody reachable has policy. That is the first rollout, and seeding it
 * is what the published source is for.
 *
 * Evaluated here rather than on peerThresholdReached because the edge can never satisfy it.
 * The peer that crosses the threshold is asked first - peerConnected is emitted before the
 * edge, and askPeer registers synchronously - so its own ask is always outstanding at the
 * moment the edge fires. Reading the threshold as a LEVEL here also means there is no latch
 * of ours to re-arm: a node that fell below the degraded level and peered back up asks its
 * new peers, and the last of those answers arrives here with the level true again.
 * @returns {Promise<void>}
 */
async function seedIfPeersHaveNothing() {
  if (current || peerAsks.openCount() || seedInFlight) return;
  if (!peerAboveThreshold || !peerAboveThreshold()) return;
  seedInFlight = true;
  try {
    log.info('policyStore - peers are up and none of them holds policy, seeding from the published source');
    const raw = await fetchFromBackstop();
    if (!raw) return;
    // Same verdict handling as the tick's ladder: a body that verifies is the publisher
    // answering, which is the one answer that means current rather than merely not-behind.
    if (consider(raw, 'backstop') !== VERDICT.REJECTED) markConfirmed('the published source');
  } finally {
    seedInFlight = false;
  }
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
  // cannot come - the 3s window plus the 500ms the broadcast sleeps between directions,
  // spent asking nobody anything.
  //
  // The level comes from peerManager's LATCHED threshold: the network already defines
  // "enough peers to gossip with" hysteretically, at appSyncPeerThreshold on the way up and
  // appSyncDegradedThreshold on the way down (12 and 4). Reusing it means the policy rung
  // opens and closes with the same peer set the spawner and the sync orchestrator use, and
  // cannot flap on a single reconnect.
  //
  // A transport that does not report the level is treated as "unknown, ask anyway", so the
  // rung is only skipped on a positive answer of no.
  if (peerRequest && (!peerAboveThreshold || peerAboveThreshold())) {
    // Armed before the ask, because a peer can answer while peerRequest is still awaiting.
    const answered = new Promise((resolve) => { peerAnswered = () => resolve(true); });
    await peerRequest(getSeq()).catch((error) => log.warn(`policyStore - peer request failed: ${error.message}`));
    const adopted = await Promise.race([answered, serviceHelper.delay(PEER_WINDOW_MS).then(() => false)]);
    peerAnswered = null;
    if (adopted) return true;
  }

  const raw = await fetchFromBackstop();
  if (!raw) return false;
  const verdict = consider(raw, 'backstop');
  // The source answered, and what it said VERIFIED. Even when it carried the sequence we
  // already had - which is the ordinary case - that is the publisher itself, which is the
  // one answer that DOES mean current rather than merely not-behind-my-neighbours.
  //
  // A body that did not verify is not the publisher answering, whatever the status code
  // was. A captive portal, a transparent proxy and an injected ISP page all return 200
  // with bytes, and treating those as confirmation opens the acquisition gate on policy
  // the network may have moved past - which is the one thing this module exists to
  // refuse. Only the signature can tell the publisher from whatever answered for it.
  if (verdict !== VERDICT.REJECTED) markConfirmed('the published source');
  return verdict === VERDICT.ADOPTED;
}

/**
 * A peer has connected. Ask it whether it is ahead of us.
 *
 * One message and one reply. A node ramping to its full peer set generates one of these per
 * arrival, so a ladder run here would be a fetch per arrival on every node, including the
 * fleet coming back from a release - the stampede the phased tick exists to prevent.
 *
 * This is the rung that closes the real gap. A peer announces what it adopts, but only to
 * nodes it is connected to AT THAT MOMENT - so a peer that obtained policy before it met us
 * announced to somebody else, and nothing afterwards revisits it. Asking on arrival is what
 * covers that, and it works just as well when this node holds nothing: it asks for anything
 * above seq 0.
 *
 * The answer settles this node's ask, and the last ask to settle is where the decision to
 * seed from the source is made - see seedIfPeersHaveNothing. So this rung reaches the source
 * only through a peer set that has been asked in full and had nothing, never through an
 * arrival on its own. Otherwise the source is this node's phased tick, which across the fleet
 * is what makes github a seed: spread over the period by identity, some node is always the
 * one that looks.
 * @param {string} peerKey ip:port of the peer that connected.
 */
function notePeerAvailable(peerKey) {
  if (!peerKey || !peerRequestFrom) return Promise.resolve();
  // Returned rather than dropped so a caller CAN wait for the ask and the seed decision that
  // follows it. Nothing in production does - a peer arriving must not hold up the event that
  // announced it - but a fire-and-forget chain is otherwise only observable by sleeping.
  return askPeer(peerKey).catch((error) => log.warn(`policyStore - peer ask failed: ${error.message}`));
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
 * @param {Function} [aboveThreshold] Whether the peer set is above appSyncPeerThreshold.
 *   Without it the store asks regardless and waits out the window.
 */
function setPeerTransport({
  request, requestFrom, announce, aboveThreshold,
} = {}) {
  peerRequest = request || null;
  peerRequestFrom = requestFrom || null;
  peerAnnounce = announce || null;
  peerAboveThreshold = aboveThreshold || null;
}

/**
 * A peer says it holds a sequence. It cannot be checked, so it is a prompt to ask rather than
 * something to believe -- and what comes back is a signed bundle, which can be. A peer
 * claiming a sequence it cannot produce costs one request.
 * @param {number} seq The sequence the peer claims.
 */
function notePeerSeq(seq, peerKey, correlationId) {
  // It answered, whatever it said. A targeted ask waiting on this peer is done.
  settlePeerAsk(peerKey, correlationId);
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
  await restore();

  // BOOT NEVER REACHES THE PUBLISHED SOURCE, whether this node restored a bundle or came
  // back with nothing.
  //
  // start() runs before discovery, so the peer set is empty here on every node, always.
  // A ladder run at this point therefore cannot take its peer rung - there is nobody to
  // ask - and falls through to the source. That made "no peers YET" and "peers have
  // nothing" the same answer, and sent a node whose neighbour held the bundle to github
  // instead of across the local network.
  //
  // What replaces it is seedIfPeersHaveNothing, evaluated as each peer answers: once the
  // set is above the threshold and every ask has settled, an empty store is evidence about
  // the NETWORK rather than about how far boot has got. A node that restored a bundle needs
  // no seed at all; its own slot brings anything newer, and an ahead peer sends it sooner.

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
  peerRequestFrom = null;
  peerAnnounce = null;
  peerAboveThreshold = null;
  seedInFlight = false;
  bundleListeners.clear();
  peerAnswered = null;
  refreshInFlight = null;
  peerAsks.discardAll();
  confirmed = false;
  refreshGate();
}

module.exports = {
  backstopPhaseMs,
  getArtifact,
  getDocument,
  getRawBundle,
  getSeq,
  isReady,
  notePeerAvailable,
  onBundleChanged,
  notePeerSeq,
  offerBundle,
  refresh,
  reset,
  restore,
  setPeerTransport,
  start,
  stop,
};
