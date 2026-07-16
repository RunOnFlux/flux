const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const generalService = require('./generalService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const benchmarkService = require('./benchmarkService');
const appTamperingDetectionService = require('./appTamperingDetectionService');

const BLOCKLIST_URL = `${config.github.rawBaseUrl}/helpers/tamperingblockednodes.json`;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SYNC_POLL_MS = 60 * 1000; // 60s while waiting for daemon sync
const TAMPER_SCORE_THRESHOLD = 10;
const DOS_MESSAGE_PREFIX = 'Node flagged via tampering blocklist';

const tamperingEventsCollection = config.database.local.collections.appTamperingEvents;

let intervalHandle = null;
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
 * Fetch the manually-curated txhash blocklist from the RunOnFlux repo.
 * Returns [] on any failure so the caller never crashes the enforcer loop.
 */
async function fetchBlocklist() {
  try {
    const res = await serviceHelper.axiosGet(BLOCKLIST_URL);
    if (res && Array.isArray(res.data)) return res.data;
    log.warn('appTamperingBlocklist - unexpected response shape from blocklist URL');
    return [];
  } catch (error) {
    log.warn(`appTamperingBlocklist - failed to fetch blocklist: ${error.message}`);
    return [];
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
 * severity stamped at write time, so scoring is a plain sum: severity,
 * discounted for incidents flagged duringBootStorm (any reboot with a late
 * data disk produces per-app mount/volume noise — discounted, never dropped).
 * Pre-schema rows are excluded on purpose: they are row-per-observation noise
 * with no severity or boot context, exactly the data a raw countDocuments({})
 * once let cross the enforcement gate on honest nodes; they age out via TTL.
 */
async function computeTamperScore() {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) return 0;
    const database = db.db(config.database.local.database);
    const pipeline = [
      { $match: { schemaVersion: { $gte: 1 } } },
      { $project: { _id: 0, severity: 1, duringBootStorm: 1 } },
    ];
    const incidents = await dbHelper.aggregateInDatabase(database, tamperingEventsCollection, pipeline);
    return incidents.reduce((score, incident) => {
      const discount = incident.duringBootStorm ? appTamperingDetectionService.BOOT_STORM_DISCOUNT : 1;
      return score + (incident.severity ?? 0) * discount;
    }, 0);
  } catch (error) {
    log.warn(`appTamperingBlocklist - failed to compute tamper score: ${error.message}`);
    return 0;
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

  const listed = Array.isArray(blocklist) && blocklist.includes(myTxhash);
  const exceedsThreshold = tamperScore > TAMPER_SCORE_THRESHOLD;
  const shouldDos = listed && exceedsThreshold;

  log.info(`appTamperingBlocklist - txhash=${myTxhash} listed=${listed} score=${tamperScore} shouldDos=${shouldDos}`);

  if (shouldDos) {
    const message = `${DOS_MESSAGE_PREFIX}: tamper score ${tamperScore}, txhash ${myTxhash}`;
    fluxNetworkHelper.setStickyDosMessage(message);
    fluxNetworkHelper.setStickyDosStateValue(100);
    ourDosActive = true;
    log.error(message);
    return;
  }

  if (ourDosActive || isOurStickyDos()) {
    log.info(`appTamperingBlocklist - clearing sticky DOS (listed=${listed}, score=${tamperScore})`);
    fluxNetworkHelper.clearStickyDosMessage();
    ourDosActive = false;
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
  fetchBlocklist,
  computeTamperScore,
  getMyTxhash,
  isDosActive,
  TAMPER_SCORE_THRESHOLD,
  DOS_MESSAGE_PREFIX,
};
