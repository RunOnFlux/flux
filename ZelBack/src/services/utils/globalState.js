const { AsyncGate } = require('./asyncGate');

// Global state variables for apps service
// These need to be shared across all modules to maintain the original business logic

let removalInProgress = false;
let installationInProgress = false;
let softRedeployInProgress = false;
let hardRedeployInProgress = false;
let reinstallationOfOldAppsInProgress = false;
let masterSlaveAppsRunning = false;
const daemonReadyGate = new AsyncGate();
const bootContainerStateSettledGate = new AsyncGate();
const dbReadyGate = new AsyncGate();
let updateSyncthingRunning = false;
let syncthingAppsFirstRun = true;
const backupInProgress = [];
const restoreInProgress = [];

// Apps monitored state
let appsMonitored = {};

// Additional state variables for trySpawningGlobalApplication
let fluxNodeWasNotConfirmedOnLastCheck = false;
let firstExecutionAfterItsSynced = true;
let fluxNodeWasAlreadyConfirmed = false;
let spawnerPaused = false;

// Cache and delay lists
const appsToBeCheckedLater = [];
const appsSyncthingToBeCheckedLater = [];
const receiveOnlySyncthingAppsCache = new Map();
const syncthingDevicesIDCache = new Map();
const folderHealthCache = new Map(); // Tracks health status for sync folders (isolation, connectivity issues)

// Pending app updates cache reference - initialized from cacheManager
let pendingAppUpdatesCache = null;

// Running apps cache - tracks app names that have been broadcasted as running
const runningAppsCache = new Set();

// Containers intentionally stopped by FluxOS — crash recovery skips die events for these
const stoppingContainers = new Set();

// Containers FluxOS removed and has not created again — who removed the container,
// which is the only thing the tampering decision turns on. Docker names, keyed as
// stoppingContainers is.
//
// An absent container is the strongest local evidence of host-side interference the
// node has, and the reconciler records it as `container_vanished`, the
// heaviest-weighted tampering event there is. That reading holds only for a
// container FluxOS did not remove: a teardown that fails part way leaves an absence
// FluxOS caused with the app's row intact, and the app keeps being reconciled, so
// membership here is what stops a node scoring its own removal against the app it
// is hosting.
//
// Written by dockerService's removal funnels, dropped by its creation funnel, and
// dropped for a whole app when the app's local row goes (nothing reconciles it
// after that, so there is no absence left to attribute). FluxOS removed it ->
// present; FluxOS created it -> absent; anything missing without an entry here is
// what the tampering event is for.
//
// In-memory deliberately: across a restart the node genuinely cannot tell its own
// removal from anyone else's, and an entry that survived would suppress a real
// signal.
const fluxRemovedContainers = new Set();

// Syncthing folders this node holds writable (sendreceive), refreshed by the
// syncthing monitor each pass and served to peers that ask before promoting a
// folder of their own. Kept here rather than read from syncthing per request:
// the route is unauthenticated, and an on-demand read would be an amplifier into
// syncthing on a node any peer can reach.
//
// null until the monitor's first validated read, and a Set from then on. "I hold
// nothing writable" and "I have not looked yet" are the same empty set but
// opposite answers to a peer deciding whether to promote, so they must not be the
// same value: a node that IS holding a folder would otherwise read as free, and
// the peer would promote alongside it. On a booting node that pass is not
// immediate, and a fleet-wide restart puts every holder of an app in the state at
// once. Same null-is-no-opinion convention appReconciler's controllerDesired uses.
let promotedFolderIds = null;


// Cache references - these will be initialized from cacheManager
let spawnErrorsLongerAppCache = null;
let trySpawningGlobalAppCache = null;

// Initialize cache references - this must be called after cacheManager is ready
function initializeCaches(cacheManager) {
  if (cacheManager && cacheManager.appSpawnErrorCache && cacheManager.appSpawnCache) {
    spawnErrorsLongerAppCache = cacheManager.appSpawnErrorCache;
    trySpawningGlobalAppCache = cacheManager.appSpawnCache;
    ({ pendingAppUpdatesCache } = cacheManager);
  }
}

module.exports = {
  // State getters/setters
  get removalInProgress() { return removalInProgress; },
  set removalInProgress(value) { removalInProgress = value; },

  get installationInProgress() { return installationInProgress; },
  set installationInProgress(value) { installationInProgress = value; },

  get softRedeployInProgress() { return softRedeployInProgress; },
  set softRedeployInProgress(value) { softRedeployInProgress = value; },

  get hardRedeployInProgress() { return hardRedeployInProgress; },
  set hardRedeployInProgress(value) { hardRedeployInProgress = value; },

  get reinstallationOfOldAppsInProgress() { return reinstallationOfOldAppsInProgress; },
  set reinstallationOfOldAppsInProgress(value) { reinstallationOfOldAppsInProgress = value; },

  // The operation holding this node right now, named, or null. `except` is the
  // caller's OWN flag: a guard excludes the operation it belongs to and no
  // others, because a redeploy that asked without excluding itself would refuse
  // its own reinstall. Order is the order the guards asked in.
  //
  // Every entry point that can START work asks this. The five flags used to be
  // read as hand-picked subsets - forty-six guards, exactly one of which read
  // reinstallationOfOldAppsInProgress - so the periodic reinstall pass announced
  // itself and the spawner walked straight past it, took the node during the
  // pass's own wait, and left an app torn down that could not be rebuilt.
  operationHolding(except = null) {
    const held = [
      ['removal', removalInProgress],
      ['installation', installationInProgress],
      ['soft redeploy', softRedeployInProgress],
      ['hard redeploy', hardRedeployInProgress],
      ['reinstallation', reinstallationOfOldAppsInProgress],
    ].find(([name, on]) => on && name !== except);
    return held ? held[0] : null;
  },

  isOperationInProgress() {
    return removalInProgress || installationInProgress || softRedeployInProgress || hardRedeployInProgress || reinstallationOfOldAppsInProgress;
  },

  get masterSlaveAppsRunning() { return masterSlaveAppsRunning; },
  set masterSlaveAppsRunning(value) { masterSlaveAppsRunning = value; },

  get daemonReady() { return daemonReadyGate.ready; },
  set daemonReady(value) { if (value) daemonReadyGate.open(); else daemonReadyGate.close(); },
  waitForDaemonReady() { return daemonReadyGate.wait(); },

  get bootContainerStateSettled() { return bootContainerStateSettledGate.ready; },
  set bootContainerStateSettled(value) { if (value) bootContainerStateSettledGate.open(); else bootContainerStateSettledGate.close(); },
  waitForBootContainerStateSettled() { return bootContainerStateSettledGate.wait(); },

  get dbReady() { return dbReadyGate.ready; },
  set dbReady(value) { if (value) dbReadyGate.open(); else dbReadyGate.close(); },
  waitForDbReady() { return dbReadyGate.wait(); },

  get updateSyncthingRunning() { return updateSyncthingRunning; },
  set updateSyncthingRunning(value) { updateSyncthingRunning = value; },

  get syncthingAppsFirstRun() { return syncthingAppsFirstRun; },
  set syncthingAppsFirstRun(value) { syncthingAppsFirstRun = value; },

  // A frozen snapshot, not the live array: readers (the monitor, the election,
  // the reconciler) only ever test membership, and handing out the backing
  // array let any of them push or splice it and bypass the atomic claim below.
  // Frozen rather than merely copied so that a stray write throws here instead
  // of silently mutating a copy nobody reads. The claim and release are the
  // only writers, and they hold the real arrays.
  get backupInProgress() { return Object.freeze([...backupInProgress]); },
  get restoreInProgress() { return Object.freeze([...restoreInProgress]); },

  // Claiming an app for a backup or a restore is a test-and-set, not a read
  // then a later write: these run to completion before the event loop hands the
  // next request in, so two overlapping requests for one app cannot both find it
  // free. The lists stay the observable "this app is busy" signal the monitor,
  // the election and the reconciler read; only the claim on them is made
  // indivisible here so a caller cannot split the test from the set.
  tryStartBackup(appname) {
    if (backupInProgress.includes(appname)) return false;
    backupInProgress.push(appname);
    return true;
  },
  finishBackup(appname) {
    const index = backupInProgress.indexOf(appname);
    if (index !== -1) backupInProgress.splice(index, 1);
  },
  tryStartRestore(appname) {
    if (restoreInProgress.includes(appname)) return false;
    restoreInProgress.push(appname);
    return true;
  },
  finishRestore(appname) {
    const index = restoreInProgress.indexOf(appname);
    if (index !== -1) restoreInProgress.splice(index, 1);
  },

  get appsMonitored() { return appsMonitored; },
  set appsMonitored(value) { appsMonitored = value; },

  // Additional state getters/setters
  get fluxNodeWasNotConfirmedOnLastCheck() { return fluxNodeWasNotConfirmedOnLastCheck; },
  set fluxNodeWasNotConfirmedOnLastCheck(value) { fluxNodeWasNotConfirmedOnLastCheck = value; },

  get firstExecutionAfterItsSynced() { return firstExecutionAfterItsSynced; },
  set firstExecutionAfterItsSynced(value) { firstExecutionAfterItsSynced = value; },

  get fluxNodeWasAlreadyConfirmed() { return fluxNodeWasAlreadyConfirmed; },
  set fluxNodeWasAlreadyConfirmed(value) { fluxNodeWasAlreadyConfirmed = value; },

  get spawnerPaused() { return spawnerPaused; },
  set spawnerPaused(value) { spawnerPaused = value; },

  get appsToBeCheckedLater() { return appsToBeCheckedLater; },
  get appsSyncthingToBeCheckedLater() { return appsSyncthingToBeCheckedLater; },
  get receiveOnlySyncthingAppsCache() { return receiveOnlySyncthingAppsCache; },
  get promotedFolderIds() { return promotedFolderIds; },
  set promotedFolderIds(ids) { promotedFolderIds = ids; },
  get syncthingDevicesIDCache() { return syncthingDevicesIDCache; },
  get folderHealthCache() { return folderHealthCache; },
  get runningAppsCache() { return runningAppsCache; },
  get stoppingContainers() { return stoppingContainers; },
  get fluxRemovedContainers() { return fluxRemovedContainers; },

  get spawnErrorsLongerAppCache() { return spawnErrorsLongerAppCache; },
  set spawnErrorsLongerAppCache(value) { spawnErrorsLongerAppCache = value; },

  get trySpawningGlobalAppCache() { return trySpawningGlobalAppCache; },
  set trySpawningGlobalAppCache(value) { trySpawningGlobalAppCache = value; },

  // Helper functions to match original API
  removalInProgressReset() { removalInProgress = false; },
  setRemovalInProgressToTrue() { removalInProgress = true; },
  installationInProgressReset() { installationInProgress = false; },
  setInstallationInProgressTrue() { installationInProgress = true; },
  softRedeployInProgressReset() { softRedeployInProgress = false; },
  setSoftRedeployInProgressTrue() { softRedeployInProgress = true; },
  hardRedeployInProgressReset() { hardRedeployInProgress = false; },
  setHardRedeployInProgressTrue() { hardRedeployInProgress = true; },

  // Clear functions
  clearAppsMonitored() { appsMonitored = {}; },
  setAppsMonitored(value) { appsMonitored = value; },

  // Cache initialization
  initializeCaches,

  // Pending app updates cache
  get pendingAppUpdatesCache() { return pendingAppUpdatesCache; },

  /**
   * Queue an update message that arrived before registration was stored.
   * Uses TTL cache - entries automatically expire after 30 minutes.
   * @param {string} appName - The app name
   * @param {object} message - The raw update message to queue
   * @param {number} height - The blockchain height of the update
   */
  queuePendingUpdate(appName, message, height) {
    if (!pendingAppUpdatesCache) return;
    const updates = pendingAppUpdatesCache.get(appName) || [];
    updates.push({ message, height });
    // Keep sorted by height ascending
    updates.sort((a, b) => a.height - b.height);
    pendingAppUpdatesCache.set(appName, updates);
  },

  /**
   * Get pending updates for an app and remove them from the cache.
   * @param {string} appName - The app name
   * @returns {Array<{ message, height }>} The pending updates sorted by height
   */
  getPendingUpdates(appName) {
    if (!pendingAppUpdatesCache) return [];
    const pending = pendingAppUpdatesCache.get(appName);
    if (!pending || pending.length === 0) {
      return [];
    }
    // Remove from cache - they will be processed
    pendingAppUpdatesCache.delete(appName);
    return pending;
  },

  /**
   * Clear all pending updates for an app (e.g., after a failed update).
   * @param {string} appName - The app name
   */
  clearPendingUpdates(appName) {
    if (!pendingAppUpdatesCache) return;
    pendingAppUpdatesCache.delete(appName);
  },
};
