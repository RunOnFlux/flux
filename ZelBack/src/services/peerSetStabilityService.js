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
let peerSetUp = false;
let ourDosActive = false;
let timerHandle = null;
let started = false;
let deps = null;

/**
 * True when the sticky slot currently holds a message this service wrote.
 * @returns {boolean}
 */
function isOurStickyDos() {
  const msg = fluxNetworkHelper.getStickyDosMessage();
  return typeof msg === 'string' && msg.startsWith(DOS_MESSAGE_PREFIX);
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
 *
 * The slot is left alone when another owner holds it. That owner's verdict
 * already has the node out of service for its own reason, and taking the slot
 * would leave it unable to recognise or release its own state.
 * @param {number} count Dips inside the window.
 * @returns {void}
 */
function applyDos(count) {
  if (isOurStickyDos()) return;
  const sticky = fluxNetworkHelper.getStickyDosMessage();
  if (sticky) {
    log.info('peerSetStability - another sticky DOS is active, not overwriting it');
    return;
  }
  const message = `${DOS_MESSAGE_PREFIX}: lost every peer ${count} times in the last `
    + `${WINDOW_MS / 60000} minutes. Check this node's network connection.`;
  fluxNetworkHelper.setStickyDosMessage(message);
  fluxNetworkHelper.setStickyDosStateValue(100);
  ourDosActive = true;
  log.error(message);
  fluxEventBus.publish('peerSetStability:dos', { dips: count, windowMs: WINDOW_MS });
}

/**
 * Give up the DOS this service holds, if it still holds it.
 * @param {string} reason Logged context.
 * @returns {void}
 */
function releaseDos(reason) {
  if (isOurStickyDos()) {
    log.info(`peerSetStability - clearing sticky DOS (${reason})`);
    fluxNetworkHelper.clearStickyDosMessage();
    ourDosActive = false;
    fluxEventBus.publish('peerSetStability:released', { reason });
    return;
  }
  if (ourDosActive) {
    // Someone else holds the slot now. Releasing our claim is all we may do -
    // clearing it would drop their DOS on the floor.
    log.info(`peerSetStability - our DOS was replaced by another owner, releasing our claim only (${reason})`);
    ourDosActive = false;
  }
}

/**
 * Decide, from the tally and the current peer set, whether the node is out.
 *
 * THE RELEASE NEEDS POSITIVE EVIDENCE, not merely the absence of dips. A node
 * that is out of service loses confirmation, drops every peer, and then cannot
 * dip because it has none - so "no dip in the window" would let it back in
 * having demonstrated nothing, take on apps, and collapse again. Requiring the
 * peer set to be UP and dip-free for the whole window means it comes back only
 * after the same continuous stability the readiness fallback asks for, which is
 * the condition it would have had to meet to spawn anything anyway.
 * @returns {void}
 */
function evaluate() {
  const remaining = pruneDips(Date.now());
  if (remaining >= DIP_THRESHOLD) {
    applyDos(remaining);
    return;
  }
  if (!ourDosActive && !isOurStickyDos()) return;
  if (remaining > 0) return;
  if (!peerSetUp) return;
  releaseDos('peer set has been up for the whole window with no further dips');
}

/**
 * One fall of the peer count below the degraded threshold.
 * @param {number} count Peers remaining, for the log.
 * @param {{deliberate?: boolean}} [info] Why it fell.
 * @returns {void}
 */
function noteDip(count, info) {
  peerSetUp = false;
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
  peerSetUp = true;
}

/**
 * @param {object} injected
 * @param {Function} injected.onPeerEvent
 * @param {Function} injected.offPeerEvent
 * @param {Function} [injected.peerCountIfAboveThreshold] The latched level, read
 * once at start because the rise edge is latched and may already have fired.
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
  if (injected.peerCountIfAboveThreshold && injected.peerCountIfAboveThreshold()) {
    peerSetUp = true;
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
  // Cleared with the timer, so a later start() does not inherit a claim from
  // the previous run and skip the read-back that decides whether the slot is
  // still ours. The DOS itself is deliberately NOT released here: stop() runs
  // on teardown, and a node going down does not become stable by doing so.
  ourDosActive = false;
  dips = [];
  peerSetUp = false;
}

module.exports = {
  start,
  stop,
  noteDip,
  noteRecovery,
  evaluate,
  isDosActive: () => ourDosActive,
  dipCount: () => dips.length,
  DOS_MESSAGE_PREFIX,
  DIP_THRESHOLD,
  WINDOW_MS,
  EVALUATE_INTERVAL_MS,
};
