// Syncthing Monitor - Manages syncthing configuration for apps
const path = require('node:path');
const config = require('config');
const dbHelper = require('../dbHelper');
// eslint-disable-next-line no-unused-vars
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const syncthingService = require('../syncthingService');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');
const {
  MONITOR_INTERVAL_MS,
  // eslint-disable-next-line no-unused-vars
  ERROR_RETRY_DELAY_MS,
  SYNC_STATE_LOG_INTERVAL_MS,
} = require('./syncthingMonitorConstants');
const {
  sortAndFilterLocations,
  buildDeviceConfiguration,
  createSyncthingFolderConfig,
  ensureStfolderExists,
  getContainerDataFlags,
  requiresSyncing,
  folderNeedsUpdate,
} = require('./syncthingMonitorHelpers');
const {
  manageFolderSyncState,
} = require('./syncthingFolderStateMachine');

// Global collections
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

// Path constants
const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

// Helper function to get app locations
async function appLocation(appName) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = { name: appName };
    const projection = { _id: 0 };
    const results = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
    return results || [];
  } catch (error) {
    log.error(`Error getting app location for ${appName}: ${error.message}`);
    return [];
  }
}

/**
 * Process container data for an app component
 * This function handles both legacy apps (version <= 3) and newer apps (version > 3)
 *
 * @param {Object} params - Parameters object
 * @returns {Promise<void>}
 */
async function processContainerData(params) {
  const {
    containerData,
    identifier,
    installedAppName,
    myIP,
    myDeviceId,
    state,
    allFoldersResp,
    allDevicesResp,
    devicesConfiguration,
    devicesIds,
    folderIds,
    foldersConfiguration,
    newFoldersConfiguration,
    appDockerStopFn,
    appDockerRestartFn,
    appDeleteDataInMountPointFn,
  } = params;

  const containersData = containerData.split('|');

  // Check if syncing is required (only check primary mount - index 0)
  const primaryContainer = containersData[0];
  const primaryContainerDataFlags = getContainerDataFlags(primaryContainer);

  if (!requiresSyncing(primaryContainerDataFlags)) {
    // No syncing required for this app
    return;
  }

  // Sync the entire appId folder (not individual mount points)
  // This ensures all subdirectories (appdata, logs, config, etc.) are synced together
  const appId = dockerService.getAppIdentifier(identifier);
  const folder = `${appsFolder}${appId}`;
  const id = appId;
  const label = appId;

  // Ensure .stfolder directory exists at appId level
  await ensureStfolderExists(folder);

  // Get and process app locations
  let locations = await appLocation(installedAppName);
  locations = sortAndFilterLocations(locations, myIP);

  // Build device configuration (parallelized internally)
  const devices = await buildDeviceConfiguration(
    locations,
    myIP,
    myDeviceId,
    state.syncthingDevicesIDCache,
    devicesConfiguration,
    devicesIds,
    allDevicesResp,
  );

  // Create base folder configuration
  const syncthingFolder = createSyncthingFolderConfig(id, label, folder, devices);
  const syncFolder = allFoldersResp.data.find((x) => x.id === id);

  // Handle receive-only or global sync flags
  if (primaryContainerDataFlags.includes('r') || primaryContainerDataFlags.includes('g')) {
    // Use state machine to manage folder sync transitions
    const { syncthingFolder: updatedFolder, cache, skipProcessing } = await manageFolderSyncState({
      appId,
      syncFolder,
      containerDataFlags: primaryContainerDataFlags,
      syncthingAppsFirstRun: state.syncthingAppsFirstRun,
      receiveOnlySyncthingAppsCache: state.receiveOnlySyncthingAppsCache,
      appLocation,
      myIP,
      appDockerStopFn,
      appDockerRestartFn,
      appDeleteDataInMountPointFn,
      syncthingFolder,
      installedAppName,
    });

    // Update cache if provided
    if (cache !== null) {
      state.receiveOnlySyncthingAppsCache.set(appId, cache);
    }

    // Skip processing if marked to skip
    if (skipProcessing) {
      return;
    }

    // Update folder with state machine result
    Object.assign(syncthingFolder, updatedFolder);
  }

  // Add to tracking arrays
  folderIds.push(id);
  foldersConfiguration.push(syncthingFolder);

  // Check if folder needs update
  if (folderNeedsUpdate(syncFolder, syncthingFolder)) {
    newFoldersConfiguration.push(syncthingFolder);
  }
}

/**
 * Log sync state for all folders
 * @param {Array} foldersConfiguration - Array of folder configurations
 * @returns {Promise<void>}
 */
async function logSyncState(foldersConfiguration) {
  if (!foldersConfiguration || foldersConfiguration.length === 0) {
    log.info('syncthingAppsCore - No folders to log sync state for');
    return;
  }

  log.info(`syncthingAppsCore - Logging sync state for ${foldersConfiguration.length} folders`);

  // Get sync status for all folders in parallel
  const syncStatusPromises = foldersConfiguration.map(async (folder) => {
    try {
      const statusResponse = await syncthingService.getDbStatus({
        query: { folder: folder.id },
      }, null);

      if (statusResponse && statusResponse.status === 'success') {
        const { globalBytes = 0, inSyncBytes = 0, state: syncState } = statusResponse.data;
        const syncPercentage = globalBytes > 0 ? (inSyncBytes / globalBytes) * 100 : 100;

        return {
          id: folder.id,
          type: folder.type,
          syncPercentage,
          globalBytes,
          inSyncBytes,
          state: syncState,
        };
      }

      return {
        id: folder.id,
        type: folder.type,
        error: 'Failed to get status',
      };
    } catch (error) {
      return {
        id: folder.id,
        type: folder.type,
        error: error.message,
      };
    }
  });

  const syncStatuses = await Promise.all(syncStatusPromises);

  // Log each folder's sync state
  syncStatuses.forEach((status) => {
    if (status.error) {
      log.warn(`syncthingAppsCore - Folder ${status.id} (${status.type}): Error - ${status.error}`);
    } else {
      const bytesInfo = status.globalBytes > 0
        ? ` (${status.inSyncBytes}/${status.globalBytes} bytes)`
        : '';
      log.info(
        `syncthingAppsCore - Folder ${status.id} (${status.type}): `
        + `${status.syncPercentage.toFixed(2)}% synced, state: ${status.state}${bytesInfo}`,
      );
    }
  });
}

/**
 * Core function to process all installed apps and configure Syncthing
 * @param {object} state - State object
 * @param {Function} installedAppsFn - Get installed apps function
 * @param {Function} getGlobalStateFn - Get global state function
 * @param {Function} appDockerStopFn - Stop docker function
 * @param {Function} appDockerRestartFn - Restart docker function
 * @param {Function} appDeleteDataInMountPointFn - Delete data function
 * @param {Function} removeAppLocallyFn - Remove app function
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
async function syncthingAppsCore(state, installedAppsFn, getGlobalStateFn, appDockerStopFn, appDockerRestartFn, appDeleteDataInMountPointFn, removeAppLocallyFn) {
  // Sync global state before checking
  getGlobalStateFn();

  // Early return if operations in progress
  if (state.installationInProgress || state.removalInProgress || state.softRedeployInProgress || state.hardRedeployInProgress || state.updateSyncthingRunning) {
    return;
  }

  state.updateSyncthingRunning = true;
  let syncthingInitializedSuccessfully = false;

  try {
    // Get list of all installed apps
    const appsInstalled = await installedAppsFn();
    if (appsInstalled.status === 'error') {
      log.error('syncthingAppsCore - Failed to get installed apps');
      return;
    }

    // Decrypt enterprise apps (version 8 with encrypted content)
    appsInstalled.data = await decryptEnterpriseApps(appsInstalled.data);

    // Get required IDs and configurations
    const myDeviceId = await syncthingService.getDeviceId();
    if (!myDeviceId) {
      log.error('syncthingAppsCore - Failed to get myDeviceId');
      return;
    }

    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      log.error('syncthingAppsCore - Failed to get myIP');
      return;
    }

    // Get current Syncthing configuration
    const allFoldersResp = await syncthingService.getConfigFolders();
    const allDevicesResp = await syncthingService.getConfigDevices();

    // CRITICAL: Validate Syncthing configuration is loaded before proceeding
    // On system restart, Syncthing API might be available but config not fully loaded
    // This prevents data deletion during the race condition window
    if (!allFoldersResp || !allFoldersResp.data || !Array.isArray(allFoldersResp.data)) {
      if (state.syncthingAppsFirstRun) {
        log.warn('syncthingAppsCore - Syncthing folder configuration not ready yet on first run. Waiting for next cycle to avoid data loss.');
      } else {
        log.error('syncthingAppsCore - Failed to get Syncthing folders configuration');
      }
      return;
    }

    if (!allDevicesResp || !allDevicesResp.data || !Array.isArray(allDevicesResp.data)) {
      if (state.syncthingAppsFirstRun) {
        log.warn('syncthingAppsCore - Syncthing device configuration not ready yet on first run. Waiting for next cycle to avoid data loss.');
      } else {
        log.error('syncthingAppsCore - Failed to get Syncthing devices configuration');
      }
      return;
    }

    // Mark that Syncthing is properly initialized - safe to clear first run flag
    syncthingInitializedSuccessfully = true;

    // Initialize tracking arrays
    const devicesIds = [];
    const devicesConfiguration = [];
    const folderIds = [];
    const foldersConfiguration = [];
    const newFoldersConfiguration = [];

    // Shared parameters for processing
    const sharedParams = {
      myIP,
      myDeviceId,
      state,
      allFoldersResp,
      allDevicesResp,
      devicesConfiguration,
      devicesIds,
      folderIds,
      foldersConfiguration,
      newFoldersConfiguration,
      appDockerStopFn,
      appDockerRestartFn,
      appDeleteDataInMountPointFn,
    };

    // Process all installed apps
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data) {
      // Skip if backup/restore in progress
      const backupSkip = state.backupInProgress.some((item) => installedApp.name === item);
      const restoreSkip = state.restoreInProgress.some((item) => installedApp.name === item);

      if (backupSkip || restoreSkip) {
        log.info(`syncthingAppsCore - Backup/restore in progress for ${installedApp.name}, syncthing disabled`);
        // eslint-disable-next-line no-continue
        continue;
      }

      // Process based on app version
      if (installedApp.version <= 3) {
        // Legacy app (version <= 3) - single containerData
        // eslint-disable-next-line no-await-in-loop
        await processContainerData({
          ...sharedParams,
          containerData: installedApp.containerData,
          identifier: installedApp.name,
          installedAppName: installedApp.name,
        });
      } else {
        // Newer app (version > 3) - compose with multiple components
        // eslint-disable-next-line no-restricted-syntax
        for (const installedComponent of installedApp.compose) {
          const identifier = `${installedComponent.name}_${installedApp.name}`;
          // eslint-disable-next-line no-await-in-loop
          await processContainerData({
            ...sharedParams,
            containerData: installedComponent.containerData,
            identifier,
            installedAppName: installedApp.name,
          });
        }
      }
    }

    // Remove unused folders and devices (parallelized for better performance)
    const nonUsedFolders = allFoldersResp.data.filter(
      (syncthingFolder) => !folderIds.includes(syncthingFolder.id),
    );
    const nonUsedDevices = allDevicesResp.data.filter(
      (syncthingDevice) => !devicesIds.includes(syncthingDevice.deviceID) && syncthingDevice.deviceID !== myDeviceId,
    );

    // Parallelize cleanup operations
    const cleanupPromises = [
      ...nonUsedFolders.map((folder) => {
        log.info(`syncthingAppsCore - Removing unused Syncthing folder ${folder.id}`);
        return syncthingService.adjustConfigFolders('delete', undefined, folder.id).catch((err) => {
          log.error(`Failed to remove folder ${folder.id}: ${err.message}`);
        });
      }),
      ...nonUsedDevices.map((device) => {
        log.info(`syncthingAppsCore - Removing unused Syncthing device ${device.deviceID}`);
        return syncthingService.adjustConfigDevices('delete', undefined, device.deviceID).catch((err) => {
          log.error(`Failed to remove device ${device.deviceID}: ${err.message}`);
        });
      }),
    ];

    await Promise.all(cleanupPromises);

    // Apply new configuration
    if (devicesConfiguration.length > 0) {
      await syncthingService.adjustConfigDevices('put', devicesConfiguration);
    }
    if (newFoldersConfiguration.length > 0) {
      await syncthingService.adjustConfigFolders('put', newFoldersConfiguration);
    }

    // Check for folder errors in parallel
    const folderErrorChecks = await Promise.all(
      foldersConfiguration.map(async (folder) => {
        try {
          const folderError = await syncthingService.getFolderIdErrors(folder.id);
          if (folderError?.status === 'success' && folderError.data.errors?.length > 0) {
            return { folder, error: folderError };
          }
        } catch (error) {
          log.warn(`Failed to check errors for folder ${folder.id}: ${error.message}`);
        }
        return null;
      }),
    );

    // Process folder errors sequentially (app removal requires sequential processing)
    // eslint-disable-next-line no-restricted-syntax
    for (const errorInfo of folderErrorChecks) {
      // eslint-disable-next-line no-continue
      if (!errorInfo) continue;

      const { folder, error } = errorInfo;
      log.error(`syncthingAppsCore - Errors detected on syncthing folderId:${folder.id}`);
      log.error(error);
    }

    // Log sync state every 5 minutes
    const now = Date.now();
    if (!state.lastSyncStateLogTime || (now - state.lastSyncStateLogTime >= SYNC_STATE_LOG_INTERVAL_MS)) {
      await logSyncState(foldersConfiguration);
      state.lastSyncStateLogTime = now;
    }

    // Check if Syncthing restart is needed
    const restartRequired = await syncthingService.getConfigRestartRequired();
    if (restartRequired?.status === 'success' && restartRequired.data.requiresRestart === true) {
      log.info('syncthingAppsCore - New configuration applied. Syncthing restart required, restarting...');
      await syncthingService.systemRestart();
    }
  } catch (error) {
    log.error(`syncthingAppsCore - Error in sync monitoring: ${error.message}`);
    log.error(error.stack);
  } finally {
    state.updateSyncthingRunning = false;
    // Only clear first run flag if Syncthing was successfully initialized
    // This ensures we don't proceed with app processing until Syncthing is fully ready
    if (syncthingInitializedSuccessfully) {
      state.syncthingAppsFirstRun = false;
    }
  }
}

/**
 * Starts the Syncthing monitoring service with interval-based scheduling
 * Replaces the old recursive approach with a proper interval
 *
 * @param {object} state - State object
 * @param {Function} installedAppsFn - Get installed apps function
 * @param {Function} getGlobalStateFn - Get global state function
 * @param {Function} appDockerStopFn - Stop docker function
 * @param {Function} appDockerRestartFn - Restart docker function
 * @param {Function} appDeleteDataInMountPointFn - Delete data function
 * @param {Function} removeAppLocallyFn - Remove app function
 * @returns {Object} Control object with stop() method
 */
function syncthingApps(state, installedAppsFn, getGlobalStateFn, appDockerStopFn, appDockerRestartFn, appDeleteDataInMountPointFn, removeAppLocallyFn) {
  let intervalId = null;
  let isRunning = false;

  const runMonitoring = async () => {
    if (isRunning) {
      log.warn('syncthingApps - Previous execution still running, skipping this iteration');
      return;
    }

    isRunning = true;
    try {
      await syncthingAppsCore(
        state,
        installedAppsFn,
        getGlobalStateFn,
        appDockerStopFn,
        appDockerRestartFn,
        appDeleteDataInMountPointFn,
        removeAppLocallyFn,
      );
    } catch (error) {
      log.error(`syncthingApps - Unexpected error in monitoring loop: ${error.message}`);
      log.error(error.stack);
    } finally {
      isRunning = false;
    }
  };

  // Run immediately on start
  runMonitoring();

  // Then run at regular intervals
  intervalId = setInterval(runMonitoring, MONITOR_INTERVAL_MS);

  // Return control object for graceful shutdown
  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        log.info('syncthingApps - Monitoring service stopped');
      }
    },
    isActive: () => intervalId !== null,
  };
}

module.exports = {
  syncthingApps,
};
