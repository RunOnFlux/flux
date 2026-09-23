/**
 * Take a node out of service when its own peer set keeps collapsing.
 *
 * WHY THIS EXISTS AT ALL. The readiness fallback only advances while the peer
 * threshold is met and resets when it is lost (appSyncOrchestrator), so a node
 * that keeps losing its peers silently never reaches READY and never spawns.
 * That is correct and it is invisible: the operator sees a node that is not
 * taking apps and nothing anywhere says why. This is the half that says why,
 * and it is a DOS rather than a note because a node whose network keeps going
 * away is not serving the apps it already holds either.
 *
 * WHAT COUNTS. One dip is the fall edge of the hysteretic pair - the peer count
 * crossing below appSyncDegradedThreshold having been above
 * appSyncPeerThreshold. Measured across a random sample of 228 fleet nodes and
 * ~20,700 node-hours (2026-09-12): p10 26 peers, median 36, p90 52, and the
 * lowest count at any of 890 connectivity diagnoses was 7 - not one observation
 * at or below 4. So reaching the floor is not a bad minute, it is the loss of
 * roughly ninety per cent of the set, and the tally counts outages.
 *
 * WHAT DOES NOT COUNT. A fall this node caused itself. disconnectAll() drops
 * every peer when confirmation is lost, which is the same edge and a different
 * fact - and a node flapping confirmation is already handled by
 * nodeStatusMonitor. Counting our own teardown would punish that node twice for
 * one fault. A restart does not count either: the rise latch starts false, so
 * the fall edge cannot fire on the way up.
 *
 * NOT COUNTED IS NOT CREDITED. A teardown is left out of the tally and still
 * breaks the run of peered time the release asks for, because those minutes are
 * minutes the node had nothing to be stable with. The two questions are
 * different: one is what the node did wrong, the other is what it has shown.
 */

const config = require('config');
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxEventBus = require('./utils/fluxEventBus');

// The prefix is the OWNERSHIP MARK on the single sticky slot, exactly as
// residentialNodeDosService and appTamperingBlocklistService use theirs: the
// slot holds one owner's verdict, and an owner that cannot recognise its own
// message can neither refuse to overwrite someone else's nor release only its
// own.
const DOS_MESSAGE_PREFIX = 'Peer set unstable';

const DIP_THRESHOLD = config.fluxapps.peerSetDipDosThreshold ?? 5;
const WINDOW_MS = (config.fluxapps.peerSetDipWindowMinutes ?? 120) * 60 * 1000;
// Only the release needs a clock - a dip evaluates on arrival. A node that has
// stabilised produces no events at all, so without this it would hold the DOS
// until something unrelated happened to it.
const EVALUATE_INTERVAL_MS = config.fluxapps.peerSetDipEvaluateMs ?? 60 * 1000;

/**
 * Dip timestamps, newest last, never more than DIP_THRESHOLD of them.
 *
 * Capped because the two questions asked of it are "are there at least
 * DIP_THRESHOLD inside the window" and "is there any inside the window", and
 * keeping the newest DIP_THRESHOLD answers both exactly: a count that reaches
 * the threshold does so on the newest entries, and the newest entry alone
 * settles the second. Unbounded, a node dipping in a tight loop would grow it
 * without bound for no extra information.
 * @type {number[]}
 */
let dips = [];
/**
 * When the peer set came up, or null while it is down.
 *
 * A stamp rather than a flag because the release asks how LONG it has held, and
 * a flag can only say that it holds now. Cleared by every fall, so the interval
 * it measures is unbroken by construction.
 * @type {number|null}
 */
let upSince = null;
let timerHandle = null;
let started = false;
let deps = null;

const OWNER = fluxNetworkHelper.StickyDosOwner.PEER_SET_STABILITY;

/**
 * True while this service's own verdict holds the node out of service.
 * @returns {boolean}
 */
function isOurDosHeld() {
  return fluxNetworkHelper.isStickyDosHeldBy(OWNER);
}

/**
 * Drop dips that have aged out, and report how many remain.
 * @param {number} now
 * @returns {number} dips inside the trailing window
 */
function pruneDips(now) {
  dips = dips.filter((t) => now - t <= WINDOW_MS);
  return dips.length;
}

/**
 * Put the node out of service, naming the reason.
 * @param {number} count Dips inside the window.
 * @returns {void}
 */
function applyDos(count) {
  if (isOurDosHeld()) return;
  const message = `${DOS_MESSAGE_PREFIX}: lost every peer ${count} times in the last `
    + `${WINDOW_MS / 60000} minutes. Check this node's network connection.`;
  fluxNetworkHelper.setStickyDos(OWNER, message);
  fluxEventBus.publish('peerSetStability:dos', { dips: count, windowMs: WINDOW_MS });
}

/**
 * Give up the DOS this service holds, if it still holds it.
 * @param {string} reason Logged context.
 * @returns {void}
 */
function releaseDos(reason) {
  if (!isOurDosHeld()) return;
  log.info(`peerSetStability - clearing sticky DOS (${reason})`);
  fluxNetworkHelper.clearStickyDos(OWNER);
  fluxEventBus.publish('peerSetStability:released', { reason });
}

/**
 * Decide, from the tally and how long the peer set has held, whether the node is out.
 *
 * THE RELEASE NEEDS POSITIVE EVIDENCE, not merely the absence of dips. A node
 * whose peer set is down cannot dip at all - the fall edge fires only from above
 * the rise threshold - so quiet from it is quiet for want of anything to
 * observe. Releasing on that would hand a node its apps back for having
 * demonstrated nothing, and it would collapse again.
 *
 * So it asks for a whole window of the peer set actually holding: dip-free, and
 * continuously up since a stamp that every fall clears. A node that cannot keep
 * a peer set for a full window stays out, which is the right answer for the node
 * it describes - one that would otherwise re-acquire apps on each brief return
 * and lose them again on the next fall.
 *
 * Coming back needs the rise threshold, not the degraded one. Between them a
 * node produces no edge either way, so it can neither dip nor show that it has
 * stopped dipping.
 * @returns {void}
 */
function evaluate() {
  const now = Date.now();
  const remaining = pruneDips(now);
  if (remaining >= DIP_THRESHOLD) {
    applyDos(remaining);
    return;
  }
  if (!isOurDosHeld()) return;
  if (remaining > 0) return;
  if (upSince === null || now - upSince < WINDOW_MS) return;
  releaseDos('peer set held above the threshold for a whole window with no collapse');
}

/**
 * One fall of the peer count below the degraded threshold.
 * @param {number} count Peers remaining, for the log.
 * @param {{deliberate?: boolean}} [info] Why it fell.
 * @returns {void}
 */
function noteDip(count, info) {
  // Before the deliberate check, because the run of peered time ends whoever
  // ended it. What the check below decides is only whether it was a fault.
  upSince = null;
  if (info && info.deliberate) {
    log.info(`peerSetStability - peer set torn down by this node (${count} peers), not counted as a dip`);
    return;
  }
  const now = Date.now();
  dips.push(now);
  const remaining = pruneDips(now);
  // Capped from the front: the newest DIP_THRESHOLD entries answer both
  // questions this list is asked, so older ones are not information.
  if (dips.length > DIP_THRESHOLD) dips = dips.slice(dips.length - DIP_THRESHOLD);
  log.warn(`peerSetStability - peer set collapsed to ${count} peers `
    + `(${remaining}/${DIP_THRESHOLD} in the last ${WINDOW_MS / 60000} minutes)`);
  evaluate();
}

function noteRecovery() {
  upSince = Date.now();
}

/**
 * @param {object} injected
 * @param {Function} injected.onPeerEvent
 * @param {Function} injected.offPeerEvent
 * @param {Function} [injected.isAboveThreshold] The latched level, read once at
 * start because the rise edge is latched and may already have fired.
 * @returns {void}
 */
function start(injected) {
  if (started) return;
  started = true;
  deps = {
    onDip: (count, info) => noteDip(count, info),
    onRise: () => noteRecovery(),
    offPeerEvent: injected.offPeerEvent,
  };
  injected.onPeerEvent('peersBelowThreshold', deps.onDip);
  injected.onPeerEvent('peerThresholdReached', deps.onRise);
  if (injected.isAboveThreshold && injected.isAboveThreshold()) {
    upSince = Date.now();
  }
  timerHandle = setInterval(evaluate, EVALUATE_INTERVAL_MS);
  log.info(`peerSetStability - watching for ${DIP_THRESHOLD} peer-set collapses in ${WINDOW_MS / 60000} minutes`);
}

function stop() {
  started = false;
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
  if (deps) {
    deps.offPeerEvent('peersBelowThreshold', deps.onDip);
    deps.offPeerEvent('peerThresholdReached', deps.onRise);
    deps = null;
  }
  // The DOS is deliberately NOT released here: stop() runs on teardown, and a
  // node going down does not become stable by doing so.
  dips = [];
  upSince = null;
}

module.exports = {
  start,
  stop,
  noteDip,
  noteRecovery,
  evaluate,
  isDosActive: () => isOurDosHeld(),
  dipCount: () => dips.length,
  DOS_MESSAGE_PREFIX,
  DIP_THRESHOLD,
  WINDOW_MS,
  EVALUATE_INTERVAL_MS,
};
