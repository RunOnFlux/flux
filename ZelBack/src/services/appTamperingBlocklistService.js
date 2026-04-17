const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const generalService = require('./generalService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const fluxCaching = require('./utils/cacheManager').default;

const BLOCKLIST_URL = 'https://raw.githubusercontent.com/RunOnFlux/flux/master/helpers/tamperingblockednodes.json';
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SYNC_POLL_MS = 60 * 1000; // 60s while waiting for daemon sync
const TAMPERING_EVENT_THRESHOLD = 10;
const DOS_MESSAGE_PREFIX = 'Node flagged via tampering blocklist';
const isArcane = Boolean(process.env.FLUXOS_PATH);

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
    const cached = fluxCaching.tamperingBlocklistCache.get('tamperingBlocklist');
    if (cached) return cached;
    const res = await serviceHelper.axiosGet(BLOCKLIST_URL);
    if (res && Array.isArray(res.data)) {
      fluxCaching.tamperingBlocklistCache.set('tamperingBlocklist', res.data);
      return res.data;
    }
    log.warn('appTamperingBlocklist - unexpected response shape from blocklist URL');
    return [];
  } catch (error) {
    log.warn(`appTamperingBlocklist - failed to fetch blocklist: ${error.message}`);
    return [];
  }
}

/**
 * Count documents in the tampering events collection (all types, all apps).
 * The 30-day TTL on detectedAt already scopes this.
 */
async function countTamperingEvents() {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) return 0;
    const database = db.db(config.database.local.database);
    return await database.collection(tamperingEventsCollection).countDocuments({});
  } catch (error) {
    log.warn(`appTamperingBlocklist - failed to count events: ${error.message}`);
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
 * Core check: if our txhash is in the blocklist AND we have more than
 * TAMPERING_EVENT_THRESHOLD events, DOS the node. Otherwise, if we previously
 * DOSed it, clear the DOS. This service owns the DOS message it sets and only
 * clears it when its own condition is no longer true.
 */
async function enforceBlocklist() {
  if (isArcane) {
    log.info('appTamperingBlocklist - node is ArcaneOS, enforcement disabled');
    return;
  }

  const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
  if (!syncStatus || !syncStatus.data || !syncStatus.data.synced) {
    log.info('appTamperingBlocklist - daemon not synced, skipping this tick');
    return;
  }

  const [myTxhash, blocklist, eventCount] = await Promise.all([
    getMyTxhash(),
    fetchBlocklist(),
    countTamperingEvents(),
  ]);

  if (!myTxhash) {
    log.warn('appTamperingBlocklist - own txhash unavailable, skipping this tick');
    return;
  }

  const listed = Array.isArray(blocklist) && blocklist.includes(myTxhash);
  const exceedsThreshold = eventCount > TAMPERING_EVENT_THRESHOLD;
  const shouldDos = listed && exceedsThreshold;

  log.info(`appTamperingBlocklist - txhash=${myTxhash} listed=${listed} events=${eventCount} shouldDos=${shouldDos}`);

  if (shouldDos) {
    const message = `${DOS_MESSAGE_PREFIX}: ${eventCount} events, txhash ${myTxhash}`;
    fluxNetworkHelper.setStickyDosMessage(message);
    fluxNetworkHelper.setStickyDosStateValue(100);
    ourDosActive = true;
    log.error(message);
    return;
  }

  if (ourDosActive || isOurStickyDos()) {
    log.info(`appTamperingBlocklist - clearing sticky DOS (listed=${listed}, events=${eventCount})`);
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
  if (isArcane) {
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
  countTamperingEvents,
  getMyTxhash,
  isDosActive,
  TAMPERING_EVENT_THRESHOLD,
  DOS_MESSAGE_PREFIX,
};
