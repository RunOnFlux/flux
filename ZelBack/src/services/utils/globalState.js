const { AsyncGate } = require('./asyncGate');

// Global state variables for apps service
// These need to be shared across all modules to maintain the original business logic

// removalInProgress was a single node-wide boolean. It is now a per-app Set of
// bare app names, so concurrent removals of DIFFERENT apps proceed (e.g. the
// expiry sweep cancelling several at once) while a second removal of the SAME app
// still serializes. The boolean getter/setter below are a size>0 compat shim for
// the many COARSE "is the node removing anything" readers (reconciler defer,
// watchtower prune, daemon-health, syncthing); per-app GATES use hasRemovalInProgress(name).
const removalsInProgress = new Set();
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

// In-flight installs by bare app name -> AbortController, so a cancel/removal of the
// same app can abort an in-progress image pull (cancel-during-install) instead of
// downloading gigabytes only to tear them down. Registered in registerAppLocally,
// cleared in its finally; the pull threads the controller's signal to docker.pull.
const installingApps = new Map();


// Cache references - these will be initialized from cacheManager
let spawnErrorsLongerAppCache = null;
let trySpawningGlobalAppCache = null;

// Initialize cache references - this must be called after cacheManager is ready
function initializeCaches(cacheManager) {
  if (cacheManager && cacheManager.appSpawnErrorCache && cacheManager.appSpawnCache) {
    spawnErrorsLongerAppCache = cacheManager.appSpawnErrorCache;
    trySpawningGlobalAppCache = cacheManager.appSpawnCache;
    pendingAppUpdatesCache = cacheManager.pendingAppUpdatesCache;
  }
}

module.exports = {
  // State getters/setters

  // The per-app removal Set itself (for callers that want size / membership).
  get removalsInProgress() { return removalsInProgress; },
  // Per-app removal gate API — the real serialization point. A removal of `name`
  // claims its entry on entry and releases it when done; a same-name removal sees
  // it, a different-app removal does not.
  hasRemovalInProgress(name) { return removalsInProgress.has(name); },
  markRemovalInProgress(name) { removalsInProgress.add(name); },
  removalDone(name) { removalsInProgress.delete(name); },

  // Coarse READ-ONLY derived flag: "is the node removing anything" === the per-app
  // Set is non-empty. The ~25 coarse readers (reconciler defer, watchtower prune,
  // daemon-health, syncthing) keep reading removalInProgress unchanged. There is no
  // setter: a removal is always OF A SPECIFIC APP, so callers use
  // markRemovalInProgress(name)/removalDone(name); "clear everything" is
  // removalInProgressReset() (boot recovery).
  get removalInProgress() { return removalsInProgress.size > 0; },

  get installationInProgress() { return installationInProgress; },
  set installationInProgress(value) { installationInProgress = value; },

  get softRedeployInProgress() { return softRedeployInProgress; },
  set softRedeployInProgress(value) { softRedeployInProgress = value; },

  get hardRedeployInProgress() { return hardRedeployInProgress; },
  set hardRedeployInProgress(value) { hardRedeployInProgress = value; },

  get reinstallationOfOldAppsInProgress() { return reinstallationOfOldAppsInProgress; },
  set reinstallationOfOldAppsInProgress(value) { reinstallationOfOldAppsInProgress = value; },

  isOperationInProgress() {
    return removalsInProgress.size > 0 || installationInProgress || softRedeployInProgress || hardRedeployInProgress || reinstallationOfOldAppsInProgress;
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

  get backupInProgress() { return backupInProgress; },
  get restoreInProgress() { return restoreInProgress; },

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
  get syncthingDevicesIDCache() { return syncthingDevicesIDCache; },
  get folderHealthCache() { return folderHealthCache; },
  get runningAppsCache() { return runningAppsCache; },
  get stoppingContainers() { return stoppingContainers; },
  get installingApps() { return installingApps; },

  get spawnErrorsLongerAppCache() { return spawnErrorsLongerAppCache; },
  set spawnErrorsLongerAppCache(value) { spawnErrorsLongerAppCache = value; },

  get trySpawningGlobalAppCache() { return trySpawningGlobalAppCache; },
  set trySpawningGlobalAppCache(value) { trySpawningGlobalAppCache = value; },

  // Helper functions to match original API
  // Clears ALL in-flight per-app removals (boot/global recovery only — a normal
  // removal releases its own app via removalDone(name)).
  removalInProgressReset() { removalsInProgress.clear(); },
  installationInProgressReset() { installationInProgress = false; },
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
