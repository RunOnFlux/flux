// A node on a residential connection is only fit to serve the network when it
// runs ArcaneOS. This service moves such a node off the network in three stages:
//
//   HOLD   it stops accepting NEW apps. Immediate, and it deletes nothing.
//   EVACUATE  it gives up one app at a time, and only ones another host
//          demonstrably holds. Each departure leaves the app one short, the
//          spawner replaces it on a node that is not held, and that is what
//          releases the next holder. The removing is done by the single
//          give-up-an-app pass in advancedWorkflows; this service owns only the
//          policy and the pacing.
//   DOS    once the node runs nothing, the sticky DOS goes on. By then
//          removeAllAppsLocally has nothing to find.
//
// DOS >= 100 is not a mark: it makes nodeStatusMonitor and appStartupManager
// `rm -rf` every app directory and volume on the box. Reaching that state only
// on an empty node is the whole point of the staging.
//
// Nothing here enforces against a node that is not PROVABLY residential.
// geolocationService's classification is four-state and only RESIDENTIAL acts:
// CONFLICTED and UNKNOWN are left alone, as is a node whose bench cannot be read.

const config = require('config');
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const geolocationService = require('./geolocationService');
const benchmarkService = require('./benchmarkService');
const { CLASSIFICATION } = require('./utils/networkClassifier');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('./utils/appSyncEvents');
const { compareInstanceSeniority } = require('./utils/instanceOrdering');
const { socketAddressesMatch } = require('./utils/socketAddressUtils');

const DOS_MESSAGE_PREFIX = 'Residential node not running ArcaneOS';
const HOLD_REASON = 'residential node not running ArcaneOS';

const CHECK_INTERVAL_MS = config.fluxapps.residentialCheckIntervalMs;
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// Before the first app is given up, the verdict must have held this long.
// The placement hold deletes nothing and needs no window; this paces only the
// part that moves customer data, so a momentary misread can correct itself.
const SETTLE_MS = config.fluxapps.residentialSettleMs;
// A node may act on an app only once it has seen that app at full strength for
// base + position * step. Position in the shared instance order is a DELAY,
// never a veto: a rule of "only the most junior may leave" deadlocks, because
// the replacement is itself the most junior and does not want to leave.
const QUEUE_BASE_MS = config.fluxapps.residentialQueueBaseMs;
const QUEUE_STEP_MS = config.fluxapps.residentialQueueStepMs;
// Minimum gap between this node's departures. The give-up-an-app pass runs every
// 11 blocks (~22 min), which unpaced would empty the busiest node in the fleet in
// about four hours; there is no deadline here and slower is strictly safer.
const EVACUATION_INTERVAL_MS = config.fluxapps.residentialEvacuationIntervalMs;

const startupCollection = config.database.local.collections.nodeStartupTracker;
const SETTLE_MARKER_KEY = 'residentialDos';

let timerHandle = null;
let started = false;
let stopping = false;
let ourDosActive = false;
let inconclusiveStreak = 0;
// appName -> epoch ms at which we first saw the app at full strength. Process
// lifetime only: losing it costs a queue wait, never a premature removal.
const wholeSince = new Map();
// Whether the settling window has elapsed and departures may begin.
let evacuating = false;
// Paces departures. Process lifetime: a restart costs at most one extra wait.
let lastEvacuationAt = 0;

// Whether this node yet knows what it is running. Starts false and is only
// raised by the orchestrator's own signal - the same one appSpawner waits on.
// globalState.spawnerPaused is NOT this signal: it initialises to false, so
// reading it would report a freshly booted node as ready, and an app list read
// then is not evidence of an empty node.
let nodeReady = false;
appSyncEvents.on(SYNC_EVENTS.SPAWNER_READY, () => { nodeReady = true; });
appSyncEvents.on(SYNC_EVENTS.READINESS_LOST, () => { nodeReady = false; });

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
 *   true  - confirmed ArcaneOS, nothing to enforce
 *   false - confirmed NOT ArcaneOS
 *   null  - fluxbenchd unreachable or malformed, decide nothing
 *
 * Read from bench rather than `process.env.FLUXOS_PATH` because the env var is
 * set by whoever launches FluxOS, and this check is exactly what a residential
 * operator has an incentive to fake.
 * @returns {Promise<boolean|null>}
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
 *   true  - RESIDENTIAL: positive evidence with no contradiction
 *   false - DATACENTER
 *   null  - decide nothing. Either CONFLICTED/UNKNOWN, or there is no verdict
 *           to be had: nothing observed yet, or no published location table has
 *           been consulted. A node that has not read the table does not know
 *           what kind of network it is on, and enforcing on its own reading
 *           alone is what this whole staging exists to avoid.
 *
 * Awaiting getNodeGeolocation() first is what restores the observations from the
 * db after a restart.
 * @returns {Promise<boolean|null>}
 */
async function isResidential() {
  try {
    await geolocationService.getNodeGeolocation();
    const verdict = await geolocationService.getNetworkClassification();
    if (!verdict) return null;
    if (verdict.classification === CLASSIFICATION.RESIDENTIAL) return true;
    if (verdict.classification === CLASSIFICATION.DATACENTER) return false;
    return null;
  } catch (error) {
    log.warn(`residentialNodeDos - geolocation check failed: ${error.message}`);
    return null;
  }
}

/**
 * When this node first held the residential-and-not-ArcaneOS verdict.
 *
 * Persisted, and measured in wall-clock: a counter of consecutive evaluations
 * held in memory is reset by restarting FluxOS, which would make restarting on a
 * timer a way to postpone the drain indefinitely.
 * @returns {Promise<number|null>} Epoch ms, or null when never recorded.
 */
async function getSettleStartedAt() {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) return null;
    const database = db.db(config.database.local.database);
    const marker = await dbHelper.findOneInDatabase(database, startupCollection, { _id: SETTLE_MARKER_KEY });
    return marker && marker.residentialSince ? marker.residentialSince : null;
  } catch (error) {
    log.warn(`residentialNodeDos - could not read settle marker: ${error.message}`);
    return null;
  }
}

/**
 * Record the start of the settling window, if it is not already running. Keyed
 * on the VERDICT, not on the address: residential lines get dynamic addresses,
 * so restarting the clock on an IP change would make power-cycling the router
 * the way to postpone enforcement.
 * @param {number} now Epoch ms.
 * @returns {Promise<number|null>} The settle start in force after this call.
 */
async function markSettleStarted(now) {
  const existing = await getSettleStartedAt();
  if (existing) return existing;
  try {
    const db = dbHelper.databaseConnection();
    if (!db) return null;
    const database = db.db(config.database.local.database);
    await dbHelper.findOneAndUpdateInDatabase(
      database,
      startupCollection,
      { _id: SETTLE_MARKER_KEY },
      { $set: { residentialSince: now, lastVerdict: CLASSIFICATION.RESIDENTIAL } },
      { upsert: true },
    );
    log.info('residentialNodeDos - settling window started');
    return now;
  } catch (error) {
    log.warn(`residentialNodeDos - could not write settle marker: ${error.message}`);
    return null;
  }
}

/**
 * Clear the settling window. Only a verdict flip does this - the node is no
 * longer residential, or is now ArcaneOS.
 */
async function clearSettleMarker() {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) return;
    const database = db.db(config.database.local.database);
    await dbHelper.findOneAndDeleteInDatabase(database, startupCollection, { _id: SETTLE_MARKER_KEY }, {});
  } catch (error) {
    log.warn(`residentialNodeDos - could not clear settle marker: ${error.message}`);
  }
}

/**
 * The apps installed on this node, or null when that cannot be established.
 *
 * The null is load-bearing. Setting the DOS on a node believed empty that is not
 * makes nodeStatusMonitor delete every app it holds - the exact outcome this
 * service exists to avoid - so "could not read" must never arrive here as an
 * empty list.
 * @param {Function} installedAppsFn Injected app lister.
 * @returns {Promise<string[]|null>}
 */
async function listInstalledApps(installedAppsFn) {
  try {
    const response = await installedAppsFn();
    if (!response || response.status !== 'success' || !Array.isArray(response.data)) return null;
    return response.data.map((app) => app.name);
  } catch (error) {
    log.warn(`residentialNodeDos - could not list installed apps: ${error.message}`);
    return null;
  }
}

/**
 * How long this node must have seen an app whole before it may act on it.
 * @param {object[]} locations Instance locations, any order.
 * @param {string} localSocketAddr This node's socket address.
 * @returns {number} Milliseconds.
 */
function queueDelayMs(locations, localSocketAddr) {
  const ordered = [...locations].sort(compareInstanceSeniority);
  const index = ordered.findIndex((entry) => socketAddressesMatch(entry.ip, localSocketAddr));
  const position = index < 0 ? ordered.length : index;
  return QUEUE_BASE_MS + (position * QUEUE_STEP_MS);
}

/**
 * Whether this node is currently shedding the apps it holds.
 *
 * True only once the verdict has held for the settling window - the placement
 * hold starts immediately, but nothing that moves customer data does.
 * @returns {boolean}
 */
function isEvacuating() {
  return evacuating;
}

/**
 * May this node give up this particular app right now?
 *
 * This is the pacing half of the decision and says nothing about safety; the
 * give-up-an-app pass asks appEvacuationSafety separately, and both must agree.
 * @param {string} appName Global app name.
 * @param {object[]} locations Instance locations for the app.
 * @param {string} localSocketAddr This node's socket address.
 * @param {number} [now] Epoch ms, injectable for tests.
 * @returns {{ok: boolean, reason: string}}
 */
function mayEvacuateApp(appName, locations, localSocketAddr, now = Date.now()) {
  if (!evacuating) return { ok: false, reason: 'node is not evacuating' };
  if (now - lastEvacuationAt < EVACUATION_INTERVAL_MS) {
    const wait = Math.round((EVACUATION_INTERVAL_MS - (now - lastEvacuationAt)) / 60000);
    return { ok: false, reason: `next departure in ${wait}m` };
  }
  if (!wholeSince.has(appName)) wholeSince.set(appName, now);
  const wait = queueDelayMs(locations, localSocketAddr);
  const observed = now - wholeSince.get(appName);
  if (observed < wait) {
    return { ok: false, reason: `its turn is in ${Math.round((wait - observed) / 60000)}m` };
  }
  return { ok: true, reason: 'ready' };
}

/**
 * Record that this app has gone, so the interval before the next one starts.
 * @param {string} appName Global app name.
 * @param {number} [now] Epoch ms, injectable for tests.
 */
function noteEvacuated(appName, now = Date.now()) {
  lastEvacuationAt = now;
  wholeSince.delete(appName);
  log.info(`residentialNodeDos - ${appName} handed back; next departure no sooner than ${EVACUATION_INTERVAL_MS / 3600000}h`);
}

/**
 * Forget an app's queue observation. Called when it stops being safe to give up,
 * so the wait is served against an uninterrupted observation rather than
 * accumulated across a gap.
 * @param {string} appName Global app name.
 */
function forgetAppObservation(appName) {
  wholeSince.delete(appName);
}

/**
 * Give up the DOS this service is holding. The slot is only cleared when the
 * message in it is still ours: another owner may have taken it since we wrote,
 * and clearing that would drop their DOS on the floor.
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
 * Put the node fully out of service. Only ever reached once it holds no apps.
 */
function applyDos() {
  const sticky = fluxNetworkHelper.getStickyDosMessage();
  if (sticky && !isOurStickyDos()) {
    // Another owner's DOS already has this node out of service for its own
    // reason, and taking the single slot would leave it unable to recognise or
    // release its own state.
    log.info('residentialNodeDos - another sticky DOS is active, not overwriting it');
    return;
  }
  if (isOurStickyDos()) return;
  const message = `${DOS_MESSAGE_PREFIX}. Migrate this node to ArcaneOS or move it to a data center connection.`;
  fluxNetworkHelper.setStickyDosMessage(message);
  fluxNetworkHelper.setStickyDosStateValue(100);
  ourDosActive = true;
  log.error(message);
}

/**
 * One evaluation of the policy.
 *
 * @param {object} deps Injected collaborators.
 * @param {Function} deps.installedAppsFn Lists apps installed on this node.
 * @returns {Promise<boolean>} True when the tick reached a decision, false when
 *   an input was unavailable and the caller should retry sooner.
 */
async function enforceResidentialPolicy(deps) {
  const { installedAppsFn } = deps;

  const [arcane, residential] = await Promise.all([isArcaneOs(), isResidential()]);

  if (arcane === null) {
    log.info('residentialNodeDos - benchmark unreachable, skipping this tick');
    return false;
  }
  if (residential === null) {
    log.info('residentialNodeDos - no network verdict to act on yet, skipping this tick');
    return false;
  }

  const shouldEnforce = residential && !arcane;
  log.info(`residentialNodeDos - residential=${residential} arcaneOs=${arcane} enforce=${shouldEnforce}`);

  if (!shouldEnforce) {
    fluxNetworkHelper.clearPlacementHold();
    releaseOurDos(`residential=${residential}, arcaneOs=${arcane}`);
    await clearSettleMarker();
    evacuating = false;
    wholeSince.clear();
    return true;
  }

  // Costs the node nothing it already holds, so it needs no settling period.
  fluxNetworkHelper.setPlacementHold(HOLD_REASON);

  if (!nodeReady) {
    log.info('residentialNodeDos - node not ready yet, holding placement only this tick');
    return false;
  }

  const installed = await listInstalledApps(installedAppsFn);
  if (installed === null) {
    log.info('residentialNodeDos - installed app list unavailable, holding placement only this tick');
    return false;
  }

  if (!installed.length) {
    applyDos();
    return true;
  }

  const now = Date.now();
  const settleStartedAt = await markSettleStarted(now);
  if (!settleStartedAt) {
    evacuating = false;
    log.info('residentialNodeDos - settle marker unavailable, evacuation stays off');
    return false;
  }
  if (now - settleStartedAt < SETTLE_MS) {
    evacuating = false;
    const remaining = Math.round((SETTLE_MS - (now - settleStartedAt)) / (60 * 60 * 1000));
    log.info(`residentialNodeDos - held, evacuation begins in about ${remaining}h (${installed.length} app(s) installed)`);
    return true;
  }

  // The give-up-an-app pass reads this and does the removing; it asks
  // mayEvacuateApp for the pacing and appEvacuationSafety for the safety.
  if (!evacuating) log.warn(`residentialNodeDos - evacuation begins, ${installed.length} app(s) to hand back`);
  evacuating = true;
  return true;
}

/**
 * Delay before the next tick. A decided tick waits out the full interval; an
 * inconclusive one comes back on the short retry, doubling each time it stays
 * inconclusive, so a node that can never decide stops saying so 288 times a day.
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
 * @param {object} deps Injected collaborators, as enforceResidentialPolicy.
 */
async function tick(deps) {
  let decided = false;
  try {
    decided = await enforceResidentialPolicy(deps);
  } catch (error) {
    log.error(`residentialNodeDos - tick error: ${error.message}`);
  }
  inconclusiveStreak = decided ? 0 : inconclusiveStreak + 1;
  if (stopping) return;
  timerHandle = setTimeout(() => tick(deps), nextDelay(decided, inconclusiveStreak));
}

/**
 * Start the enforcer. Performs the first check immediately, then reschedules
 * itself. Safe to call multiple times.
 * @param {object} deps Injected collaborators, as enforceResidentialPolicy.
 */
async function start(deps) {
  // The guard is `started`, not `timerHandle`: the first tick is awaited before
  // any timer exists, so a second start() landing inside it would run a second
  // self-rescheduling chain.
  if (started) return;
  started = true;
  stopping = false;
  inconclusiveStreak = 0;
  log.info('residentialNodeDos - enforcer starting');
  await tick(deps);
}

function stop() {
  stopping = true;
  started = false;
  // Cleared with the timer: a later start() must not inherit a claim from the
  // previous run and skip the read-back that decides whether the slot is ours.
  ourDosActive = false;
  evacuating = false;
  wholeSince.clear();
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
  queueDelayMs,
  listInstalledApps,
  isEvacuating,
  mayEvacuateApp,
  noteEvacuated,
  forgetAppObservation,
  // Test seam for the readiness gate, which is otherwise only moved by events.
  setNodeReadyForTests: (value) => { nodeReady = value; },
  DOS_MESSAGE_PREFIX,
  HOLD_REASON,
  CHECK_INTERVAL_MS,
  RETRY_INTERVAL_MS,
  SETTLE_MS,
  QUEUE_BASE_MS,
  QUEUE_STEP_MS,
  EVACUATION_INTERVAL_MS,
};
