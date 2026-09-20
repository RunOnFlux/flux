const config = require('config');
const log = require('../lib/log');
const policyStore = require('./policyStore');
const dbHelper = require('./dbHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const generalService = require('./generalService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const benchmarkService = require('./benchmarkService');

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SYNC_POLL_MS = 60 * 1000; // 60s while waiting for daemon sync
const TAMPER_SCORE_THRESHOLD = 10;
const DOS_MESSAGE_PREFIX = 'Node flagged via tampering blocklist';
const OWNER = fluxNetworkHelper.StickyDosOwner.APP_TAMPERING;

const tamperingEventsCollection = config.database.local.collections.appTamperingEvents;

let intervalHandle = null;
let stopping = false;
let syncWaitTimer = null;
let syncWaitResolver = null;

/**
 * True while this service's own verdict holds the node out of service.
 * @returns {boolean}
 */
function isOurDosHeld() {
  return fluxNetworkHelper.isStickyDosHeldBy(OWNER);
}

/**
 * Give up the DOS this service is holding. Every other owner's verdict stands.
 * @param {string} reason Logged context for the release.
 */
function releaseOurDos(reason) {
  if (!isOurDosHeld()) return;
  log.info(`appTamperingBlocklist - clearing sticky DOS (${reason})`);
  fluxNetworkHelper.clearStickyDos(OWNER);
}

/**
 * Fetch the manually-curated txhash blocklist from the policy repo.
 * Returns null on any failure - could-not-fetch is not an empty list, and the
 * enforcer must distinguish them or an outage clears an active DOS.
 */
function fetchBlocklist() {
  // Read from the signed bundle rather than fetched here. Null still means "could not read
  // it", which the caller already treats as a reason to skip the tick rather than as an
  // empty list -- an unreadable blocklist releasing a node the network deliberately DOSed is
  // the bug this contract was written for.
  const blocklist = policyStore.getDocument('tamperingblockednodes');
  if (blocklist === null) return null;
  // A signature says who published a document, not that it is the shape this code expects.
  if (!Array.isArray(blocklist)) {
    log.warn('appTamperingBlocklist - tamperingblockednodes in the signed bundle is not an array');
    return null;
  }
  return blocklist;
}

/**
 * Three-state ArcaneOS check via fluxbenchd.
 *   true  — confirmed ArcaneOS, skip enforcement
 *   false — confirmed NOT ArcaneOS, enforce
 *   null  — fluxbenchd unreachable or response malformed, skip this tick
 *
 * Harder to spoof than `process.env.FLUXOS_PATH` because it depends on a
 * separate daemon process. The null case is intentional: we never want to
 * falsely DOS a real ArcaneOS node just because bench is momentarily down.
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
    log.warn(`appTamperingBlocklist - benchmark check failed: ${error.message}`);
    return null;
  }
}

/**
 * Tamper score over incident documents (30-day TTL bounds the window).
 * Each schemaVersion>=1 document already IS one deduplicated incident with a
 * severity stamped at write time, so scoring is a plain sum of severities.
 * Pre-schema rows are excluded on purpose: they are row-per-observation noise
 * with no severity, exactly the data a raw countDocuments({}) once let cross
 * the enforcement gate on honest nodes. The startup purge removes them; the
 * filter here covers anything written before that purge has run.
 */
async function computeTamperScore() {
  try {
    const db = dbHelper.databaseConnection();
    // null, never 0: a score this node could not read is not a score of zero,
    // and returning zero would take the clear branch and release a node this
    // service had deliberately DOSed - the same distinction the blocklist
    // fetch makes between could-not-ask and nothing-listed
    if (!db) return null;
    const database = db.db(config.database.local.database);
    const pipeline = [
      { $match: { schemaVersion: { $gte: 1 } } },
      { $project: { _id: 0, severity: 1 } },
    ];
    const incidents = await dbHelper.aggregateInDatabase(database, tamperingEventsCollection, pipeline);
    return incidents.reduce((score, incident) => score + (incident.severity ?? 0), 0);
  } catch (error) {
    log.warn(`appTamperingBlocklist - failed to compute tamper score: ${error.message}`);
    return null;
  }
}

/**
 * Read this node's collateral txhash via fluxd.
 */
async function getMyTxhash() {
  try {
    const info = await generalService.obtainNodeCollateralInformation();
    return info && info.txhash ? info.txhash : null;
  } catch (error) {
    log.warn(`appTamperingBlocklist - failed to read node collateral: ${error.message}`);
    return null;
  }
}

/**
 * Block until the daemon reports synced. Polls every SYNC_POLL_MS.
 * The per-iteration sleep is cancellable via stop() so shutdown is prompt.
 */
async function waitForDaemonSynced() {
  while (!stopping) {
    const s = daemonServiceMiscRpcs.isDaemonSynced();
    if (s && s.data && s.data.synced) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      syncWaitResolver = resolve;
      syncWaitTimer = setTimeout(() => {
        syncWaitTimer = null;
        syncWaitResolver = null;
        resolve();
      }, SYNC_POLL_MS);
    });
  }
}

/**
 * Core check: if our txhash is in the blocklist AND the weighted tamper score
 * exceeds TAMPER_SCORE_THRESHOLD, DOS the node. Otherwise, if we previously
 * DOSed it, clear the DOS. This service owns the DOS message it sets and only
 * clears it when its own condition is no longer true.
 */
async function enforceBlocklist() {
  const arcane = await isArcaneOs();
  if (arcane === true) {
    log.info('appTamperingBlocklist - node is ArcaneOS, enforcement disabled');
    return;
  }
  if (arcane === null) {
    log.info('appTamperingBlocklist - benchmark unreachable, skipping this tick');
    return;
  }

  const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
  if (!syncStatus || !syncStatus.data || !syncStatus.data.synced) {
    log.info('appTamperingBlocklist - daemon not synced, skipping this tick');
    return;
  }

  const [myTxhash, blocklist, tamperScore] = await Promise.all([
    getMyTxhash(),
    fetchBlocklist(),
    computeTamperScore(),
  ]);

  if (!myTxhash) {
    log.warn('appTamperingBlocklist - own txhash unavailable, skipping this tick');
    return;
  }

  // An unreadable blocklist is not an empty one. Falling through on null would
  // take the clear branch below and release a node this service had already
  // DOSed - an outage would undo enforcement rather than postpone it.
  if (blocklist === null) {
    log.warn('appTamperingBlocklist - blocklist unavailable, skipping this tick');
    return;
  }

  // Same rule for the other input to the decision: an unreadable score cannot
  // clear an active DOS.
  if (tamperScore === null) {
    log.warn('appTamperingBlocklist - tamper score unavailable, skipping this tick');
    return;
  }

  const listed = blocklist.includes(myTxhash);
  const exceedsThreshold = tamperScore > TAMPER_SCORE_THRESHOLD;
  const shouldDos = listed && exceedsThreshold;

  log.info(`appTamperingBlocklist - txhash=${myTxhash} listed=${listed} score=${tamperScore} shouldDos=${shouldDos}`);

  if (shouldDos) {
    const message = `${DOS_MESSAGE_PREFIX}: tamper score ${tamperScore}, txhash ${myTxhash}`;
    fluxNetworkHelper.setStickyDos(OWNER, message);
    return;
  }

  releaseOurDos(`listed=${listed}, score=${tamperScore}`);
}

/**
 * Start the enforcer. Waits for daemon sync, performs the first check, then
 * runs every 12h. Safe to call multiple times (no-ops if already started).
 */
async function start() {
  if (intervalHandle) return;
  if ((await isArcaneOs()) === true) {
    log.info('appTamperingBlocklist - node is ArcaneOS, enforcer will not start');
    return;
  }
  stopping = false;
  log.info('appTamperingBlocklist - enforcer starting, waiting for daemon sync');
  try {
    await waitForDaemonSynced();
  } catch (err) {
    log.error(`appTamperingBlocklist - sync wait failed: ${err.message}`);
    return;
  }
  if (stopping) {
    log.info('appTamperingBlocklist - stop() called during sync wait, aborting start');
    return;
  }
  try {
    await enforceBlocklist();
  } catch (err) {
    log.error(`appTamperingBlocklist - first tick error: ${err.message}`);
  }
  if (stopping) {
    log.info('appTamperingBlocklist - stop() called during first tick, not scheduling interval');
    return;
  }
  intervalHandle = setInterval(() => {
    enforceBlocklist().catch((err) => log.error(`appTamperingBlocklist - tick error: ${err.message}`));
  }, CHECK_INTERVAL_MS);
}

function stop() {
  stopping = true;
  if (syncWaitTimer) {
    clearTimeout(syncWaitTimer);
    syncWaitTimer = null;
  }
  if (syncWaitResolver) {
    const resolve = syncWaitResolver;
    syncWaitResolver = null;
    resolve();
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function isDosActive() {
  return isOurDosHeld();
}

module.exports = {
  start,
  stop,
  enforceBlocklist,
  fetchBlocklist,
  computeTamperScore,
  getMyTxhash,
  isDosActive,
  TAMPER_SCORE_THRESHOLD,
  DOS_MESSAGE_PREFIX,
};
