// Syncthing Monitor - Manages syncthing configuration for apps
const path = require('node:path');
const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const syncthingService = require('../syncthingService');
const log = require('../../lib/log');
const {
  MONITOR_INTERVAL_MS,
  ERROR_RETRY_DELAY_MS,
} = require('./syncthingMonitorConstants');
const {
  sortAndFilterLocations,
  buildDeviceConfiguration,
  createSyncthingFolderConfig,
  ensureStfolderExists,
  getContainerFolderPath,
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

  // Process each container
  for (let i = 0; i < containersData.length; i += 1) {
    const container = containersData[i];
    const containerDataFlags = getContainerDataFlags(container);

    // Skip if no syncing required
    if (!requiresSyncing(containerDataFlags)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    // Build folder path
    const containerFolder = getContainerFolderPath(containersData, i);
    const appId = dockerService.getAppIdentifier(identifier);
    const folder = `${appsFolder + appId + containerFolder}`;
    const id = appId;
    const label = appId;

    // Ensure .stfolder directory exists
    // eslint-disable-next-line no-await-in-loop
    await ensureStfolderExists(folder);

    // Get and process app locations
    // eslint-disable-next-line no-await-in-loop
    let locations = await appLocation(installedAppName);
    locations = sortAndFilterLocations(locations, myIP);

    // Build device configuration (parallelized internally)
    // eslint-disable-next-line no-await-in-loop
    const devices = await buildDeviceConfiguration(
      locations,
      myIP,
      myDeviceId,
      state.syncthingDevicesIDCache,
      devicesConfiguration,
      devicesIds,
      allDevicesResp
    );

    // Create base folder configuration
    const syncthingFolder = createSyncthingFolderConfig(id, label, folder, devices);
    const syncFolder = allFoldersResp.data.find((x) => x.id === id);

    // Handle receive-only or global sync flags
    if (containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
      // Use state machine to manage folder sync transitions
      // eslint-disable-next-line no-await-in-loop
      const { syncthingFolder: updatedFolder, cache, skipProcessing } = await manageFolderSyncState({
        appId,
        syncFolder,
        containerDataFlags,
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
        // eslint-disable-next-line no-continue
        continue;
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
async function syncthingAppsCore(state, installedAppsFn, getGlobalStateFn, appDockerStopFn, appDockerRestartFn, appDeleteDataInMountPointFn, removeAppLocallyFn) {
  // Sync global state before checking
  getGlobalStateFn();

  // Early return if operations in progress
  if (state.installationInProgress || state.removalInProgress || state.updateSyncthingRunning) {
    return;
  }

  state.updateSyncthingRunning = true;

  try {
    // Get list of all installed apps
    const appsInstalled = await installedAppsFn();
    if (appsInstalled.status === 'error') {
      log.error('syncthingAppsCore - Failed to get installed apps');
      return;
    }

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
      (syncthingFolder) => !folderIds.includes(syncthingFolder.id)
    );
    const nonUsedDevices = allDevicesResp.data.filter(
      (syncthingDevice) => !devicesIds.includes(syncthingDevice.deviceID) && syncthingDevice.deviceID !== myDeviceId
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
      })
    );

    // Process folder errors sequentially (app removal requires sequential processing)
    for (const errorInfo of folderErrorChecks) {
      if (!errorInfo) continue;

      const { folder, error } = errorInfo;
      log.error(`syncthingAppsCore - Errors detected on syncthing folderId:${folder.id} - app is going to be uninstalled`);
      log.error(error);

      let appName = folder.id;
      if (appName.includes('_')) {
        appName = appName.split('_')[1];
      }

      // eslint-disable-next-line no-await-in-loop
      await removeAppLocallyFn(appName, null, true, false, true);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(ERROR_RETRY_DELAY_MS);
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
    state.syncthingAppsFirstRun = false;
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
        removeAppLocallyFn
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
