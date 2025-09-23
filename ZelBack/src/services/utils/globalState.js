// Global state variables for apps service
// These need to be shared across all modules to maintain the original business logic

let removalInProgress = false;
let installationInProgress = false;
let reinstallationOfOldAppsInProgress = false;
let masterSlaveAppsRunning = false;
let checkAndSyncAppHashesWasEverExecuted = false;
const backupInProgress = [];
const restoreInProgress = [];

// Apps monitored state
let appsMonitored = {};

// Additional state variables for trySpawningGlobalApplication
let fluxNodeWasNotConfirmedOnLastCheck = false;
let firstExecutionAfterItsSynced = true;
let fluxNodeWasAlreadyConfirmed = false;

// Cache and delay lists
const appsToBeCheckedLater = [];
const appsSyncthingToBeCheckedLater = [];

// Cache references - these will be initialized from cacheManager
let spawnErrorsLongerAppCache = null;
let trySpawningGlobalAppCache = null;

// Initialize cache references - this must be called after cacheManager is ready
function initializeCaches(cacheManager) {
  if (cacheManager && cacheManager.appSpawnErrorCache && cacheManager.appSpawnCache) {
    spawnErrorsLongerAppCache = cacheManager.appSpawnErrorCache;
    trySpawningGlobalAppCache = cacheManager.appSpawnCache;
  }
}

module.exports = {
  // State getters/setters
  get removalInProgress() { return removalInProgress; },
  set removalInProgress(value) { removalInProgress = value; },

  get installationInProgress() { return installationInProgress; },
  set installationInProgress(value) { installationInProgress = value; },

  get reinstallationOfOldAppsInProgress() { return reinstallationOfOldAppsInProgress; },
  set reinstallationOfOldAppsInProgress(value) { reinstallationOfOldAppsInProgress = value; },

  get masterSlaveAppsRunning() { return masterSlaveAppsRunning; },
  set masterSlaveAppsRunning(value) { masterSlaveAppsRunning = value; },

  get checkAndSyncAppHashesWasEverExecuted() { return checkAndSyncAppHashesWasEverExecuted; },
  set checkAndSyncAppHashesWasEverExecuted(value) { checkAndSyncAppHashesWasEverExecuted = value; },

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

  get appsToBeCheckedLater() { return appsToBeCheckedLater; },
  get appsSyncthingToBeCheckedLater() { return appsSyncthingToBeCheckedLater; },

  get spawnErrorsLongerAppCache() { return spawnErrorsLongerAppCache; },
  set spawnErrorsLongerAppCache(value) { spawnErrorsLongerAppCache = value; },

  get trySpawningGlobalAppCache() { return trySpawningGlobalAppCache; },
  set trySpawningGlobalAppCache(value) { trySpawningGlobalAppCache = value; },

  // Helper functions to match original API
  removalInProgressReset() { removalInProgress = false; },
  setRemovalInProgressToTrue() { removalInProgress = true; },
  installationInProgressReset() { installationInProgress = false; },

  // Clear functions
  clearAppsMonitored() { appsMonitored = {}; },
  setAppsMonitored(value) { appsMonitored = value; },

  // Cache initialization
  initializeCaches,
};
