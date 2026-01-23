const serviceHelper = require('../serviceHelper');
const globalState = require('../utils/globalState');
const log = require('../../lib/log');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const registryManager = require('../appDatabase/registryManager');
const appUninstaller = require('../appLifecycle/appUninstaller');

// Module-level state tracking
let daemonUnsyncedSince = null;  // Timestamp when daemon became unsynced, or null if synced
let allAppsRemoved = false;

// Thresholds
const RUNTIME_THRESHOLD = 2 * 60 * 60 * 1000;  // 2 hours
const REMOVAL_DELAY = 3 * 60 * 1000;  // 3 minutes between app removals

/**
 * Removes all installed applications due to daemon failure
 * @param {string} reason - Reason for removal (for logging)
 */
async function removeAllApps(reason) {
  try {
    allAppsRemoved = true;  // Set flag to prevent repeated attempts

    // Get installed apps (follows pattern from checkAndRemoveEnterpriseAppsOnNonArcane)
    const installedApps = await registryManager.getInstalledApps();

    if (!installedApps || installedApps.length === 0) {
      log.info('No apps installed, nothing to remove');
      return;
    }

    log.warn(`Removing ${installedApps.length} applications due to daemon failure`);

    // Remove each app with delays between removals (matches forceAppRemovals pattern)
    for (const app of installedApps) {
      log.warn(`REMOVAL REASON: Daemon failure - removing ${app.name} (${reason})`);
      try {
        // we probably won't have peers - but broadcast anyway
        await appUninstaller.removeAppLocally(
          app.name,
          null,   // no res object
          true,   // force=true
          true,   // endResponse=true
          true,   // sendMessage=true (broadcast removal)
        );

        // 3-minute delay between removals to avoid system overload
        await serviceHelper.delay(REMOVAL_DELAY);
      } catch (error) {
        log.error(`Failed to remove ${app.name}: ${error.message}`);
        // Continue with next app even if one fails
      }
    }

    log.info('All applications removed due to daemon failure');
  } catch (error) {
    log.error(`Failed to remove apps during daemon failure cleanup: ${error.message}`);
  }
}

/**
 * Checks daemon health and removes all apps if daemon unsynced beyond threshold
 * Called periodically (every 15 minutes) from serviceManager
 */
async function checkDaemonHealthAndCleanup() {
  try {
    // Skip checks if operations in progress
    if (globalState.removalInProgress || globalState.installationInProgress
      || globalState.softRedeployInProgress || globalState.hardRedeployInProgress) {
      return;
    }

    // Check daemon sync status (updated every 30 seconds by daemonServiceMiscRpcs)
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();

    if (syncStatus.data.synced) {
      // Daemon is synced - reset tracking
      if (daemonUnsyncedSince !== null) {
        log.info('Daemon sync recovered, resetting health monitor state');
      }
      daemonUnsyncedSince = null;
      allAppsRemoved = false;
      return;
    }

    // Daemon NOT synced
    if (daemonUnsyncedSince === null) {
      // Just became unsynced, start tracking
      log.warn('Daemon detected as unsynced, starting health monitoring');
      daemonUnsyncedSince = Date.now();
      return;
    }

    // Calculate how long daemon has been unsynced
    const unsyncedDuration = Date.now() - daemonUnsyncedSince;

    // Check if threshold exceeded
    if (unsyncedDuration >= RUNTIME_THRESHOLD && !allAppsRemoved) {
      const reason = 'Daemon not synced for 2+ hours';
      log.error(`CRITICAL: ${reason}. Removing all applications.`);
      await removeAllApps(reason);
    }
  } catch (error) {
    log.error(`Error in daemon health check: ${error.message}`);
  }
}

module.exports = {
  checkDaemonHealthAndCleanup,
};
