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

  // Helper functions to match original API
  removalInProgressReset() { removalInProgress = false; },
  setRemovalInProgressToTrue() { removalInProgress = true; },
  installationInProgressReset() { installationInProgress = false; },

  // Clear functions
  clearAppsMonitored() { appsMonitored = {}; },
  setAppsMonitored(value) { appsMonitored = value; },
};
