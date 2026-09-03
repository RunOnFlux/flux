const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const generalService = require('./generalService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const benchmarkService = require('./benchmarkService');

const BLOCKLIST_URL = `${config.policy.baseUrl}/tamperingblockednodes.json`;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
// How often to look at the DOS slot while waiting for another owner to let go
// of it. Purely local - it reads the slot and nothing else, so it costs no
// blocklist fetch and no benchmark call, which is why it can run this often
// against a 12-hourly enforcement cadence.
const SLOT_WATCH_MS = 60 * 1000; // 60s
const SYNC_POLL_MS = 60 * 1000; // 60s while waiting for daemon sync
const TAMPER_SCORE_THRESHOLD = 10;
const DOS_MESSAGE_PREFIX = 'Node flagged via tampering blocklist';

const tamperingEventsCollection = config.database.local.collections.appTamperingEvents;

let intervalHandle = null;
let slotWatchHandle = null;
// The DOS this node should be under, held here while another owner has the
// single sticky slot. Enforcement runs every 12 hours, so without this a
// blocklisted node that the other owner later RELEASES - a residential verdict
// flipping to datacenter clears its own sticky - sits at DOS 0 taking apps
// until the next 12-hourly tick. The slot is watched instead, and claimed
// within a minute of it coming free.
let deferredDosMessage = null;
let ourDosActive = false;
let stopping = false;
let syncWaitTimer = null;
let syncWaitResolver = null;

/**
 * True when the current sticky DOS message was set by this service.
 * Identified by the DOS_MESSAGE_PREFIX we always prepend when we set it.
 */
function isOurStickyDos() {
  const msg = fluxNetworkHelper.getStickyDosMessage();
  return typeof msg === 'string' && msg.startsWith(DOS_MESSAGE_PREFIX);
}

/**
 * Give up the DOS this service is holding. The slot is only cleared when the
 * message in it is still ours: the slot holds one message and has more than one
 * enforcer writing to it, so clearing on our own `ourDosActive` alone would drop
 * another owner's DOS on the floor. Dropping our claim is all we are entitled to
 * do once the slot has changed hands.
 * @param {string} reason Logged context for the release.
 */
function releaseOurDos(reason) {
  if (isOurStickyDos()) {
    log.info(`appTamperingBlocklist - clearing sticky DOS (${reason})`);
    fluxNetworkHelper.clearStickyDosMessage();
    ourDosActive = false;
    return;
  }
  if (ourDosActive) {
    log.info(`appTamperingBlocklist - our DOS was replaced by another owner, releasing our claim only (${reason})`);
    ourDosActive = false;
  }
}

/**
 * Fetch the manually-curated txhash blocklist from the policy repo.
 * Returns null on any failure - could-not-fetch is not an empty list, and the
 * enforcer must distinguish them or an outage clears an active DOS.
 */
async function fetchBlocklist() {
  try {
    const res = await serviceHelper.axiosGet(BLOCKLIST_URL);
    if (res && Array.isArray(res.data)) return res.data;
    log.warn('appTamperingBlocklist - unexpected response shape from blocklist URL');
    return null;
  } catch (error) {
    log.warn(`appTamperingBlocklist - failed to fetch blocklist: ${error.message}`);
    return null;
  }
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
    // Another owner's DOS already has this node out of service for its own
    // reason. Taking the single slot from it would leave that owner unable to
    // recognise or release its own state, and the node is DOSed either way -
    // so leave it and re-check next tick.
    const message = `${DOS_MESSAGE_PREFIX}: tamper score ${tamperScore}, txhash ${myTxhash}`;
    const sticky = fluxNetworkHelper.getStickyDosMessage();
    if (sticky && !isOurStickyDos()) {
      log.info('appTamperingBlocklist - another sticky DOS is active, not overwriting it; watching for the slot');
      // Remembered, and the slot watched. The score in it can be a few hours
      // stale by the time the slot frees, which is the right trade: the next
      // full tick refreshes the message, and the node is one this build has
      // already determined should be out of service.
      deferredDosMessage = message;
      startSlotWatch();
      return;
    }
    stopSlotWatch();
    fluxNetworkHelper.setStickyDosMessage(message);
    fluxNetworkHelper.setStickyDosStateValue(100);
    ourDosActive = true;
    log.error(message);
    return;
  }

  stopSlotWatch();
  releaseOurDos(`listed=${listed}, score=${tamperScore}`);
}

/**
 * Claim the DOS slot the moment the owner holding it lets go.
 *
 * Local only: it reads the sticky message and nothing else, so it costs no
 * blocklist fetch, no benchmark call and no RPC.
 */
function claimSlotIfFree() {
  if (!deferredDosMessage) {
    stopSlotWatch();
    return;
  }
  const sticky = fluxNetworkHelper.getStickyDosMessage();
  if (sticky && !isOurStickyDos()) return;
  fluxNetworkHelper.setStickyDosMessage(deferredDosMessage);
  fluxNetworkHelper.setStickyDosStateValue(100);
  ourDosActive = true;
  log.error(`${deferredDosMessage} (claimed after another owner released the slot)`);
  deferredDosMessage = null;
  stopSlotWatch();
}

function startSlotWatch() {
  if (slotWatchHandle || stopping) return;
  slotWatchHandle = setInterval(claimSlotIfFree, SLOT_WATCH_MS);
  if (slotWatchHandle.unref) slotWatchHandle.unref();
}

function stopSlotWatch() {
  deferredDosMessage = null;
  if (slotWatchHandle) {
    clearInterval(slotWatchHandle);
    slotWatchHandle = null;
  }
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
  stopSlotWatch();
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
  return ourDosActive;
}

module.exports = {
  start,
  stop,
  enforceBlocklist,
  // Test seam: the slot watch is otherwise only driven by its own timer.
  claimSlotIfFree,
  fetchBlocklist,
  computeTamperScore,
  getMyTxhash,
  isDosActive,
  TAMPER_SCORE_THRESHOLD,
  DOS_MESSAGE_PREFIX,
};
