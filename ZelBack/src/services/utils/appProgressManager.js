const log = require('../../lib/log');

// Global state for app installation and removal progress
let appInstallationInProgress = false;
let appRemovalInProgress = false;

/**
 * Reset removal in progress flag
 */
function removalInProgressReset() {
  appRemovalInProgress = false;
  log.info('App removal progress flag reset');
}

/**
 * Set removal in progress to true
 */
function setRemovalInProgressToTrue() {
  appRemovalInProgress = true;
  log.info('App removal progress flag set to true');
}

/**
 * Check if removal is in progress
 * @returns {boolean} True if removal is in progress
 */
function isRemovalInProgress() {
  return appRemovalInProgress;
}

/**
 * Reset installation in progress flag
 */
function installationInProgressReset() {
  appInstallationInProgress = false;
  log.info('App installation progress flag reset');
}

/**
 * Set installation in progress to true
 */
function setInstallationInProgressTrue() {
  appInstallationInProgress = true;
  log.info('App installation progress flag set to true');
}

/**
 * Check if installation is in progress
 * @returns {boolean} True if installation is in progress
 */
function isInstallationInProgress() {
  return appInstallationInProgress;
}

/**
 * Get current progress status
 * @returns {object} Progress status object
 */
function getProgressStatus() {
  return {
    installationInProgress: appInstallationInProgress,
    removalInProgress: appRemovalInProgress,
  };
}

/**
 * Reset all progress flags
 */
function resetAllProgress() {
  appInstallationInProgress = false;
  appRemovalInProgress = false;
  log.info('All app progress flags reset');
}

module.exports = {
  removalInProgressReset,
  setRemovalInProgressToTrue,
  isRemovalInProgress,
  installationInProgressReset,
  setInstallationInProgressTrue,
  isInstallationInProgress,
  getProgressStatus,
  resetAllProgress,
};