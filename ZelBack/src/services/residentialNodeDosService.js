const config = require('config');
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const geolocationService = require('./geolocationService');
const benchmarkService = require('./benchmarkService');

const DOS_MESSAGE_PREFIX = 'Residential node not running ArcaneOS';

// A tick that could not read both inputs decides nothing, so it is retried on a
// short delay instead of waiting out the full interval - geolocation is only
// available once fluxbench has resolved this node's IP, which can be minutes
// after boot.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let timerHandle = null;
let started = false;
let stopping = false;
let ourDosActive = false;
let inconclusiveStreak = 0;

/**
 * True when the current sticky DOS message was set by this service.
 * Identified by the DOS_MESSAGE_PREFIX we always prepend when we set it.
 */
function isOurStickyDos() {
  const msg = fluxNetworkHelper.getStickyDosMessage();
  return typeof msg === 'string' && msg.startsWith(DOS_MESSAGE_PREFIX);
}

/**
 * Three-state ArcaneOS check via fluxbenchd.
 *   true  — confirmed ArcaneOS, nothing to enforce
 *   false — confirmed NOT ArcaneOS
 *   null  — fluxbenchd unreachable or response malformed, decide nothing
 *
 * Read from bench rather than `process.env.FLUXOS_PATH` because the env var is
 * set by whoever launches FluxOS, and this check is exactly what a residential
 * operator has an incentive to fake. The null case is deliberate: a momentarily
 * unreachable bench must never DOS a real ArcaneOS node.
 */
async function isArcaneOs() {
  try {
    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (!benchmarkResponse || benchmarkResponse.status !== 'success' || !benchmarkResponse.data) {
      return null;
    }
    const { systemsecure } = benchmarkResponse.data;
    if (typeof systemsecure !== 'boolean') return null;
    return systemsecure;
  } catch (error) {
    log.warn(`residentialNodeDos - benchmark check failed: ${error.message}`);
    return null;
  }
}

/**
 * Three-state residential check.
 *   true  — geolocation resolved and says this IP is not a data center
 *   false — geolocation resolved and says this IP is a data center
 *   null  — no geolocation yet (in memory or in db), decide nothing
 *
 * isDataCenter() alone cannot answer this: it defaults to false before the
 * first successful lookup, so a node whose geolocation never resolved would
 * read as residential. The geolocation object is what says the lookup actually
 * happened, and getNodeGeolocation() is also what restores the flag from the db
 * after a restart - so it has to be awaited before the flag is read.
 */
async function isResidential() {
  try {
    const geolocation = await geolocationService.getNodeGeolocation();
    if (!geolocation) return null;
    return geolocationService.isDataCenter() !== true;
  } catch (error) {
    log.warn(`residentialNodeDos - geolocation check failed: ${error.message}`);
    return null;
  }
}

/**
 * Give up the DOS this service is holding. The slot is only cleared when the
 * message in it is still ours: another owner may have taken it since we wrote,
 * and clearing that would drop their DOS on the floor. Dropping our own claim
 * is all we are entitled to do in that case.
 * @param {string} reason Logged context for the release.
 */
function releaseOurDos(reason) {
  if (isOurStickyDos()) {
    log.info(`residentialNodeDos - clearing sticky DOS (${reason})`);
    fluxNetworkHelper.clearStickyDosMessage();
    ourDosActive = false;
    return;
  }
  if (ourDosActive) {
    log.info(`residentialNodeDos - our DOS was replaced by another owner, releasing our claim only (${reason})`);
    ourDosActive = false;
  }
}

/**
 * Core check: a node on a residential connection that is not running ArcaneOS
 * is DOSed. Otherwise, if we previously DOSed it, the DOS is cleared. This
 * service owns the DOS message it sets and only clears its own.
 *
 * @returns {Promise<boolean>} True when the tick reached a decision, false when
 * an input was unavailable and the tick decided nothing (caller retries sooner).
 */
async function enforceResidentialPolicy() {
  if (config.residentialDos && config.residentialDos.enabled === false) {
    log.info('residentialNodeDos - enforcement disabled by config');
    releaseOurDos('disabled by config');
    return true;
  }

  const [arcane, residential] = await Promise.all([isArcaneOs(), isResidential()]);

  if (arcane === null) {
    log.info('residentialNodeDos - benchmark unreachable, skipping this tick');
    return false;
  }
  if (residential === null) {
    log.info('residentialNodeDos - geolocation not available yet, skipping this tick');
    return false;
  }

  const shouldDos = residential && !arcane;

  log.info(`residentialNodeDos - residential=${residential} arcaneOs=${arcane} shouldDos=${shouldDos}`);

  if (shouldDos) {
    // The sticky slot holds one message. Another owner's DOS already has this
    // node out of service for its own reason, and overwriting it would take
    // that owner's state away from it - so leave it and re-check next tick.
    const sticky = fluxNetworkHelper.getStickyDosMessage();
    if (sticky && !isOurStickyDos()) {
      log.info('residentialNodeDos - another sticky DOS is active, not overwriting it');
      return true;
    }
    const message = `${DOS_MESSAGE_PREFIX}. Migrate this node to ArcaneOS or move it to a data center connection.`;
    fluxNetworkHelper.setStickyDosMessage(message);
    fluxNetworkHelper.setStickyDosStateValue(100);
    ourDosActive = true;
    log.error(message);
    return true;
  }

  releaseOurDos(`residential=${residential}, arcaneOs=${arcane}`);
  return true;
}

/**
 * Delay before the next tick. A decided tick waits out the full interval; an
 * inconclusive one comes back on the short retry, doubling each time it stays
 * inconclusive. The doubling matters for the node whose geolocation never
 * resolves at all: a flat 5-minute retry would have it deciding nothing and
 * logging that it decided nothing 288 times a day, forever.
 * @param {boolean} decided Whether the tick reached a decision.
 * @param {number} streak Consecutive inconclusive ticks, this one included.
 * @returns {number} Milliseconds until the next tick.
 */
function nextDelay(decided, streak) {
  if (decided) return CHECK_INTERVAL_MS;
  return Math.min(RETRY_INTERVAL_MS * 2 ** (streak - 1), CHECK_INTERVAL_MS);
}

/**
 * Run one tick and schedule the next one.
 */
async function tick() {
  let decided = false;
  try {
    decided = await enforceResidentialPolicy();
  } catch (error) {
    log.error(`residentialNodeDos - tick error: ${error.message}`);
  }
  inconclusiveStreak = decided ? 0 : inconclusiveStreak + 1;
  if (stopping) return;
  timerHandle = setTimeout(tick, nextDelay(decided, inconclusiveStreak));
}

/**
 * Start the enforcer. Performs the first check immediately, then reschedules
 * itself. Safe to call multiple times (no-ops if already started).
 */
async function start() {
  // The guard is `started`, not `timerHandle`: the first tick is awaited before
  // any timer exists, so a second start() landing inside it would run a second
  // self-rescheduling chain.
  if (started) return;
  started = true;
  stopping = false;
  inconclusiveStreak = 0;
  log.info('residentialNodeDos - enforcer starting');
  await tick();
}

function stop() {
  stopping = true;
  started = false;
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
}

function isDosActive() {
  return ourDosActive;
}

module.exports = {
  start,
  stop,
  enforceResidentialPolicy,
  isArcaneOs,
  isResidential,
  isDosActive,
  DOS_MESSAGE_PREFIX,
  CHECK_INTERVAL_MS,
  RETRY_INTERVAL_MS,
};
