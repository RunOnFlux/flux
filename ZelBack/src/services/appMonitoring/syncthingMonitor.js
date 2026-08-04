// Syncthing Monitor - Manages syncthing configuration for apps
const path = require('node:path');
const config = require('config');
const dbHelper = require('../dbHelper');
// eslint-disable-next-line no-unused-vars
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const messageHelper = require('../messageHelper');
const syncthingService = require('../syncthingService');
const globalState = require('../utils/globalState');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');
const {
  MONITOR_INTERVAL_MS,
  // eslint-disable-next-line no-unused-vars
  ERROR_RETRY_DELAY_MS,
  SYNC_STATE_LOG_INTERVAL_MS,
  HEALTH_CHECK_INTERVAL_MS,
  EARLY_EVAL_DEBOUNCE_MS,
  EARLY_EVAL_MIN_GAP_MS,
} = require('./syncthingMonitorConstants');
const { createMonitorAccelerator } = require('./syncthingMonitorAccelerator');
const {
  sortAndFilterLocations,
  buildDeviceConfiguration,
  createSyncthingFolderConfig,
  ensureStfolderExists,
  getContainerDataFlags,
  requiresSyncing,
  folderNeedsUpdate,
} = require('./syncthingMonitorHelpers');
const volumeService = require('../utils/volumeService');
const appReconciler = require('./appReconciler');
const {
  manageFolderSyncState,
  verifyFolderMountSafety,
  verifySendReceiveFolderSafety,
} = require('./syncthingFolderStateMachine');
const {
  monitorFolderHealth,
} = require('./syncthingHealthMonitor');
const syncthingEventsConsumer = require('./syncthingEventsConsumer');

// Global collections
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

// Path constants
const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

/**
 * Verify one app folder's mount safety, repairing an unmounted volume on the
 * spot (FluxOS owns the mount - the backing image normally still exists, so
 * the actionable response is to mount it, not just to report it).
 * @param {string} appId - Docker app identifier
 * @param {string} appFolder - App folder path
 * @returns {Promise<{isSafe: boolean, reason: string}>} Result after any repair
 */
async function verifyAppFolderMountWithRepair(appId, appFolder) {
  let mountSafety = await verifyFolderMountSafety(appId, appFolder);
  if (!mountSafety.isSafe && !mountSafety.isMounted) {
    const mountAttempt = await volumeService.ensureAppVolumeMounted(appId);
    if (mountAttempt.mounted) {
      log.info(`checkAppFolderMounts - ${appId} volume was not mounted; mounted it`);
      mountSafety = await verifyFolderMountSafety(appId, appFolder);
    }
  }
  return mountSafety;
}

/**
 * The components of one installed app, each as its docker app identifier (which
 * IS its syncthing folder id) paired with the containerData that decides
 * whether it syncs. A version <= 3 app is a single component - itself.
 * @param {object} installedApp - Installed app specification
 * @returns {Array<{appId: string, containerData: string}>} The app's components
 */
function appComponents(installedApp) {
  if (installedApp.version <= 3) {
    return [{
      appId: dockerService.getAppIdentifier(installedApp.name),
      containerData: installedApp.containerData,
    }];
  }
  return (installedApp.compose || []).map((component) => ({
    appId: dockerService.getAppIdentifier(`${component.name}_${installedApp.name}`),
    containerData: component.containerData,
  }));
}

/**
 * Check if app folders are properly mounted
 * Uses verifyFolderMountSafety to detect folders that exist but aren't properly mounted
 * @param {Array} appsInstalled - List of installed apps
 * @returns {Promise<{unmountedApps: Array, verifiedSafeIds: string[]}>} Apps with
 *  unmounted folders, and the folder ids that verified safe (so a pending
 *  mount-verify flag on them can be resolved)
 */
async function checkAppFolderMounts(appsInstalled) {
  const unmountedApps = [];
  const verifiedSafeIds = [];

  const verifyOne = async (appId, appName) => {
    const appFolder = `${appsFolder}${appId}`;
    const mountSafety = await verifyAppFolderMountWithRepair(appId, appFolder);
    if (mountSafety.isSafe) {
      verifiedSafeIds.push(appId);
    } else {
      // Folder exists but mount is not safe (empty and not mounted - likely unmounted loop device)
      unmountedApps.push({ appId, appName, reason: mountSafety.reason });
    }
  };

  // eslint-disable-next-line no-restricted-syntax
  for (const installedApp of appsInstalled) {
    // eslint-disable-next-line no-restricted-syntax
    for (const { appId } of appComponents(installedApp)) {
      // eslint-disable-next-line no-await-in-loop
      await verifyOne(appId, installedApp.name);
    }
  }

  return { unmountedApps, verifiedSafeIds };
}

/**
 * Installed apps having at least one component whose docker app identifier is
 * in the given folder-id list (syncthing folder ids ARE the app identifiers).
 * @param {Array} appsInstalled - List of installed apps
 * @param {string[]} folderIds - Syncthing folder ids to match
 * @returns {Array} Matching installed apps
 */
function appsMatchingFolderIds(appsInstalled, folderIds) {
  if (folderIds.length === 0) return [];
  const wanted = new Set(folderIds);
  return appsInstalled.filter(
    (installedApp) => appComponents(installedApp).some(({ appId }) => wanted.has(appId)),
  );
}

/**
 * The syncthing folder ids this node's installed apps own. A folder is owned
 * when an installed component whose primary mount carries a sync flag (g:/r:/s:)
 * maps to it - ownership is a property of the installed specification, not of
 * what any one pass managed to process. Apps suspended for backup or restore are
 * owner-exempt: those flows delete and rebuild their own folders, so a folder
 * must be neither kept nor re-added underneath them.
 * @param {Array} appsInstalled - List of installed apps (decrypted)
 * @param {Set<string>} suspendedAppNames - Apps under backup or restore
 * @returns {Set<string>} Owned folder ids
 */
function syncingFolderOwnerIds(appsInstalled, suspendedAppNames) {
  const ownerIds = new Set();
  appsInstalled.forEach((installedApp) => {
    if (suspendedAppNames.has(installedApp.name)) return;
    appComponents(installedApp).forEach(({ appId, containerData }) => {
      const primaryContainer = (containerData ?? '').split('|')[0];
      if (requiresSyncing(getContainerDataFlags(primaryContainer))) ownerIds.add(appId);
    });
  });
  return ownerIds;
}

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
    localSocketAddr,
    localDeviceId,
    state,
    erroredFolderIds,
    allFoldersResp,
    allDevicesResp,
    devicesConfiguration,
    devicesIds,
    folderIds,
    foldersConfiguration,
    newFoldersConfiguration,
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

  // Ensure .stfolder directory exists at appId level - refused on an
  // unmounted dir (the marker may only ever live inside the volume)
  const markerReady = await ensureStfolderExists(folder);
  if (!markerReady) {
    log.warn(`processContainerData - ${appId} volume not mounted; skipping syncthing configuration this cycle`);
    return;
  }

  // Get and process app locations
  let locations = await appLocation(installedAppName);
  locations = sortAndFilterLocations(locations, localSocketAddr);

  // Build device configuration (parallelized internally)
  const devices = await buildDeviceConfiguration(
    locations,
    localSocketAddr,
    localDeviceId,
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
      localSocketAddr,
      syncthingFolder,
      installedAppName,
      mountVerifyNeeded: state.syncthingAppsFirstRun || erroredFolderIds.has(appId),
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
 * @returns {Promise<void>}
 */
async function syncthingAppsCore(state, installedAppsFn, getGlobalStateFn) {
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

    // Decrypt enterprise apps (version 8 with encrypted content). This pass acts
    // on the specification, and an app whose spec cannot be read tells us
    // nothing about which folders it owns - so its folders are protected from
    // the sweep and its safety flags are left standing, while every app that
    // DID decrypt is managed normally. Aborting the whole pass instead would
    // stop folder registration, mount safety, promotion and error draining for
    // every app on the node, and stop publishing the writable-folder answer its
    // peers block on - for as long as one app stays unreadable.
    const decrypted = await decryptEnterpriseApps(appsInstalled.data);
    appsInstalled.data = decrypted.apps;
    const unreadableAppNames = new Set(decrypted.unreadable.map((app) => app.name));
    if (unreadableAppNames.size) {
      log.warn(`syncthingAppsCore - folders of undecryptable apps are protected this pass: ${[...unreadableAppNames].join(', ')}`);
    }
    // A folder id is the component identifier, which ends in _<appName> - and an
    // app name cannot contain an underscore - so a folder always names the app
    // that owns it, even when that app's components are unreadable.
    const ownedByUnreadableApp = (folderId) => {
      const appName = folderId.slice(folderId.lastIndexOf('_') + 1);
      return unreadableAppNames.has(appName);
    };

    // The folders installed apps own. Computed here, before any decision the
    // pass makes: the skip-gate below tells "syncthing has no such folder
    // because this component does not sync" from "an owned folder has gone
    // missing" by it, and the sweep at the end deletes by it.
    const ownerIds = syncingFolderOwnerIds(
      appsInstalled.data,
      new Set([...state.backupInProgress, ...state.restoreInProgress]),
    );

    // Mount safety is verified at decision points and in reaction to
    // syncthing's own storage signal - never as a steady-state sweep. The full
    // sweep runs on the first pass after process start (the reboot case: loop
    // mounts may not be up yet, and the sweep repairs them). After that, a
    // vanished mount takes the folder's .stfolder marker with it, syncthing
    // halts the folder and raises FolderErrors, and only the flagged folders
    // are verified here (checkAppFolderMounts repairs an unmounted volume
    // itself when the backing image still exists, so a non-empty unmountedApps
    // means repair failed too). The flags are a durable level, resolved only
    // by a completed outcome below - never consumed by being read - so a pass
    // that fails mid-action leaves the flag standing and the next pass
    // retries; the guard does not depend on FolderErrors ever re-firing.
    const pendingFolderIds = syncthingEventsConsumer.mountVerifyPendingIds();
    const appsToVerify = state.syncthingAppsFirstRun
      ? appsInstalled.data
      : appsMatchingFolderIds(appsInstalled.data, pendingFolderIds);
    // A flagged folder no installed app carries can never be acted on -
    // resolve it rather than re-match it forever (the uninstall already
    // removed whatever the flag was protecting). An app whose spec could not be
    // read carries nothing either, but for a reason that says nothing about the
    // folder: its flag stays standing until its components can be enumerated.
    if (!state.syncthingAppsFirstRun && pendingFolderIds.length > 0) {
      const matchable = new Set();
      appsToVerify.forEach((installedApp) => {
        appComponents(installedApp).forEach(({ appId }) => matchable.add(appId));
      });
      pendingFolderIds.filter((id) => !matchable.has(id) && !ownedByUnreadableApp(id))
        .forEach((id) => syncthingEventsConsumer.resolveMountVerify(id));
    }
    const { unmountedApps, verifiedSafeIds } = appsToVerify.length > 0
      ? await checkAppFolderMounts(appsToVerify)
      : { unmountedApps: [], verifiedSafeIds: [] };
    // safe mount = the condition the flag exists for is gone
    verifiedSafeIds.forEach((id) => syncthingEventsConsumer.resolveMountVerify(id));
    if (unmountedApps.length > 0) {
      const unmountedList = unmountedApps.map((app) => app.appId).join(', ');
      log.warn(`syncthingAppsCore - Skipping processing: ${unmountedApps.length} app folders not mounted yet: ${unmountedList}`);
      log.warn('syncthingAppsCore - Waiting for app folders to be mounted before syncthing processing');

      // Never leave an unsafe-mount folder sendreceive while processing is
      // skipped: the syncthing daemon keeps running as configured, so an
      // un-demoted sendreceive folder over a bad mount can still broadcast its
      // (leaked or missing) disk state to the healthy peers. The demotion is
      // patched directly, with no config pre-read: a safety action must not be
      // conditioned on a fallible read whose failure silently reads as
      // "nothing to protect" (that exact silent no-op once cost a gate run).
      // The patch is safe to repeat - syncthing restarts a folder only when
      // its config actually changed (model.go CommitConfiguration diffs
      // RequiresRestartOnly) - and a folder syncthing does not know answers
      // 404, which means "not a syncthing app", not a failure. The normal
      // receiveonly machinery re-promotes once the mount is healthy.
      // eslint-disable-next-line no-restricted-syntax
      for (const { appId, reason } of unmountedApps) {
        // eslint-disable-next-line no-await-in-loop
        const patchResponse = await syncthingService.adjustConfigFolders('patch', { type: 'receiveonly' }, appId);
        if (patchResponse.status === 'success') {
          log.error(`syncthingAppsCore - SAFETY BLOCK: ${appId} folder over an unsafe mount (${reason}); switched to receiveonly and holding the container`);
          appReconciler.setControllerDesired(appId, 'stopped', `mount safety block: ${reason}`);
          syncthingEventsConsumer.resolveMountVerify(appId);
        } else if (patchResponse.data?.code === 'ERR_BAD_REQUEST') {
          // 4xx: syncthing has no such folder. What that means turns entirely on
          // ownership.
          if (ownerIds.has(appId)) {
            // An installed syncing component owns this id, so "no such folder"
            // is a contradiction, not an answer: the demotion could not be
            // applied, so the flag stays standing for the next pass. The mount
            // is unsafe either way, so the container is held now. Nothing is
            // recreated from here - the level loop rebuilds the folder once the
            // mount is healthy, under the normal receiveonly machinery.
            log.error(`syncthingAppsCore - SAFETY BLOCK: ${appId} folder over an unsafe mount (${reason}) is unknown to syncthing though an installed component syncs it; holding the container, flag stands`);
            appReconciler.setControllerDesired(appId, 'stopped', `mount safety block: ${reason}`);
          } else {
            // no installed component syncs this id - there is nothing to demote
            // and nothing left to act on
            syncthingEventsConsumer.resolveMountVerify(appId);
          }
        } else {
          // transient failure: the flag stays standing and the next pass
          // retries the demotion - loudly, never silently
          log.error(`syncthingAppsCore - SAFETY BLOCK FAILED for ${appId} (${reason}): ${patchResponse.data?.message || 'unknown error'}; retrying next pass`);
        }
      }
      return;
    }

    // Get required IDs and configurations
    const localDeviceId = await syncthingService.getDeviceId();
    if (!localDeviceId) {
      log.error('syncthingAppsCore - Failed to get localDeviceId');
      return;
    }

    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddr) {
      log.error('syncthingAppsCore - Failed to get localSocketAddr');
      return;
    }

    // Get current Syncthing configuration
    const allFoldersResp = await syncthingService.getConfigFolders();
    const allDevicesResp = await syncthingService.getConfigDevices();

    // CRITICAL: Validate Syncthing configuration is loaded before proceeding
    // On system restart, Syncthing API might be available but config not fully loaded
    // This prevents data deletion during the race condition window
    // Status first, shape second: an in-band transport error must never read
    // as "empty configuration" (an EMPTY folders array is legal data).
    if (allFoldersResp?.status !== 'success' || !Array.isArray(allFoldersResp.data)) {
      if (state.syncthingAppsFirstRun) {
        log.warn('syncthingAppsCore - Syncthing folder configuration not ready yet on first run. Waiting for next cycle to avoid data loss.');
      } else {
        log.error(`syncthingAppsCore - Failed to get Syncthing folders configuration: ${allFoldersResp?.data?.message || 'malformed response'}`);
      }
      return;
    }

    // Publish which folders this node holds writable, for the peers that ask before
    // promoting one of their own. Recorded here rather than read on demand: the
    // answer is a byproduct of a pass the monitor already makes, so serving it costs
    // nothing, where an endpoint calling syncthing per request would be an
    // unauthenticated amplifier into it. Replaced only by a validated response, so a
    // failed read leaves the last good answer standing rather than momentarily
    // claiming this node holds nothing writable.
    globalState.promotedFolderIds = new Set(
      allFoldersResp.data.filter((folder) => folder.type === 'sendreceive').map((folder) => folder.id),
    );

    if (allDevicesResp?.status !== 'success' || !Array.isArray(allDevicesResp.data)) {
      if (state.syncthingAppsFirstRun) {
        log.warn('syncthingAppsCore - Syncthing device configuration not ready yet on first run. Waiting for next cycle to avoid data loss.');
      } else {
        log.error(`syncthingAppsCore - Failed to get Syncthing devices configuration: ${allDevicesResp?.data?.message || 'malformed response'}`);
      }
      return;
    }

    // Mark that Syncthing is properly initialized - safe to clear first run flag
    syncthingInitializedSuccessfully = true;

    // CRITICAL STARTUP SAFETY CHECK: Verify all sendreceive folders have safe mounts
    // This prevents data loss when loop mounts aren't ready after reboot
    if (state.syncthingAppsFirstRun && allFoldersResp.data.length > 0) {
      log.info('syncthingAppsCore - First run detected, performing mount safety verification on existing folders');
      let unsafeFoldersCount = 0;

      // eslint-disable-next-line no-restricted-syntax
      for (const folder of allFoldersResp.data) {
        if (folder.type === 'sendreceive') {
          // Extract appId from folder.id (e.g., fluxwp_myapp -> fluxwp_myapp)
          const appId = folder.id;
          const folderPath = folder.path;

          // eslint-disable-next-line no-await-in-loop
          const mountSafety = await verifySendReceiveFolderSafety(appId, folderPath);

          if (!mountSafety.isSafe) {
            unsafeFoldersCount += 1;
            log.error(`syncthingAppsCore - STARTUP SAFETY: Folder ${appId} has unsafe mount (${mountSafety.reason}). Switching to receiveonly to prevent data loss.`);

            // Immediately switch to receiveonly mode. In-band status check:
            // performRequest never throws, so a .catch here would be dead code
            // and a failed demotion would pass silently.
            // eslint-disable-next-line no-await-in-loop
            const startupPatch = await syncthingService.adjustConfigFolders('patch', { type: 'receiveonly' }, folder.id);
            if (startupPatch?.status !== 'success') {
              log.error(`syncthingAppsCore - Failed to switch ${folder.id} to receiveonly: ${startupPatch?.data?.message || 'unknown error'}`);
            }
          } else {
            log.info(`syncthingAppsCore - Folder ${appId} mount is safe (mounted=${mountSafety.isMounted}, files=${mountSafety.fileCount})`);
          }
        }
      }

      if (unsafeFoldersCount > 0) {
        // The receiveonly PATCH applies live (no restart needed on syncthing v2) -
        // a process restart here would drop every folder's transfers node-wide.
        log.error(`syncthingAppsCore - STARTUP WARNING: ${unsafeFoldersCount} folders had unsafe mounts and were switched to receiveonly mode. Check loop mounts!`);
      }
    }

    // Initialize tracking arrays
    const devicesIds = [];
    const devicesConfiguration = [];
    const folderIds = [];
    const foldersConfiguration = [];
    const newFoldersConfiguration = [];

    // Shared parameters for processing
    const sharedParams = {
      localSocketAddr,
      localDeviceId,
      state,
      // the folders flagged when the pass began: the state machine re-verifies
      // exactly these on its own decision points (resolution of the flag by
      // this pass does not retract the request to look)
      erroredFolderIds: new Set(pendingFolderIds),
      allFoldersResp,
      allDevicesResp,
      devicesConfiguration,
      devicesIds,
      folderIds,
      foldersConfiguration,
      newFoldersConfiguration,
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

    // Remove unused folders and devices (parallelized for better performance).
    // A folder is unused when no installed syncing component owns it: the app
    // was uninstalled, dropped the g:/r:/s: flag from its primary mount, or is
    // suspended for backup/restore (those flows own their folders' lifecycle
    // themselves). Whether this pass reached the component is a different
    // question - a component skipped for an unmounted volume or deferred by the
    // state machine still owns its folder, and deleting it would take
    // syncthing's index, peer devices and any standing safety demotion with it.
    const nonUsedFolders = allFoldersResp.data.filter(
      (syncthingFolder) => !ownerIds.has(syncthingFolder.id)
        && !ownedByUnreadableApp(syncthingFolder.id),
    );
    allFoldersResp.data
      .filter((syncthingFolder) => !ownerIds.has(syncthingFolder.id)
        && ownedByUnreadableApp(syncthingFolder.id))
      .forEach((syncthingFolder) => log.warn(`syncthingAppsCore - keeping folder ${syncthingFolder.id}: its app could not be decrypted, so ownership is unknown`));
    // An owned folder the pass never registered means its component went
    // unprocessed: the folder survives, but the skip is never silent - no
    // configuration is being applied to it until the component is reached again.
    const processedFolderIds = new Set(folderIds);
    allFoldersResp.data
      .filter((syncthingFolder) => ownerIds.has(syncthingFolder.id) && !processedFolderIds.has(syncthingFolder.id))
      .forEach((syncthingFolder) => log.warn(`syncthingAppsCore - keeping folder ${syncthingFolder.id}: its component went unprocessed this pass`));
    const nonUsedDevices = allDevicesResp.data.filter(
      (syncthingDevice) => !devicesIds.includes(syncthingDevice.deviceID) && syncthingDevice.deviceID !== localDeviceId,
    );

    // Parallelize cleanup operations
    const cleanupPromises = [
      ...nonUsedFolders.map(async (folder) => {
        log.info(`syncthingAppsCore - Removing unused Syncthing folder ${folder.id}`);
        const response = await syncthingService.adjustConfigFolders('delete', undefined, folder.id);
        if (response?.status !== 'success') {
          log.error(`Failed to remove folder ${folder.id}: ${response?.data?.message || 'unknown error'}`);
        }
      }),
      ...nonUsedDevices.map(async (device) => {
        log.info(`syncthingAppsCore - Removing unused Syncthing device ${device.deviceID}`);
        const response = await syncthingService.adjustConfigDevices('delete', undefined, device.deviceID);
        if (response?.status !== 'success') {
          log.error(`Failed to remove device ${device.deviceID}: ${response?.data?.message || 'unknown error'}`);
        }
      }),
    ];

    await Promise.all(cleanupPromises);

    // Apply new configuration. A failed apply aborts the pass loudly (outer
    // catch): the steps below reason about the configuration this was meant
    // to install, and the level loop reassembles everything next pass anyway.
    if (devicesConfiguration.length > 0) {
      messageHelper.dataOrThrow(await syncthingService.adjustConfigDevices('put', devicesConfiguration));
    }
    if (newFoldersConfiguration.length > 0) {
      messageHelper.dataOrThrow(await syncthingService.adjustConfigFolders('put', newFoldersConfiguration));
    }

    // Check for folder errors in parallel
    const folderErrorChecks = await Promise.all(
      foldersConfiguration.map(async (folder) => {
        const folderError = await syncthingService.getFolderIdErrors(folder.id);
        if (folderError?.status === 'success' && folderError.data.errors?.length > 0) {
          return { folder, error: folderError };
        }
        if (folderError?.status !== 'success') {
          log.warn(`Failed to check errors for folder ${folder.id}: ${folderError?.data?.message || 'malformed response'}`);
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

    // Run health monitoring every HEALTH_CHECK_INTERVAL_MS
    // This checks for isolated nodes, connectivity issues, and takes corrective actions
    if (!state.lastHealthCheckTime || (now - state.lastHealthCheckTime >= HEALTH_CHECK_INTERVAL_MS)) {
      log.info('syncthingAppsCore - Running periodic health check');
      try {
        // The health monitor is a watchdog only: it alerts and nudges folder
        // devices - it takes no container or app-lifecycle actions
        const healthResults = await monitorFolderHealth({
          foldersConfiguration,
          folderHealthCache: state.folderHealthCache,
          state,
          receiveOnlySyncthingAppsCache: state.receiveOnlySyncthingAppsCache,
        });

        if (healthResults.actions.length > 0) {
          log.warn(`syncthingAppsCore - Health monitoring took ${healthResults.actions.length} corrective action(s)`);
          healthResults.actions.forEach((action) => {
            log.warn(`  - ${action.action.toUpperCase()} ${action.folderId}: ${action.reason} (${action.durationMinutes.toFixed(0)} min)`);
          });
        }

        state.lastHealthCheckTime = now;
      } catch (healthError) {
        log.error(`syncthingAppsCore - Health monitoring error: ${healthError.message}`);
      }
    }

    // Check if Syncthing restart is needed
    const restartRequired = await syncthingService.getConfigRestartRequired();
    if (restartRequired?.status !== 'success') {
      log.warn(`syncthingAppsCore - could not read restart-required state: ${restartRequired?.data?.message || 'malformed response'}; next pass re-checks`);
    } else if (restartRequired.data.requiresRestart === true) {
      log.info('syncthingAppsCore - New configuration applied. Syncthing restart required, restarting...');
      const restartResponse = await syncthingService.systemRestart();
      if (restartResponse?.status !== 'success') {
        log.error(`syncthingAppsCore - syncthing restart request failed: ${restartResponse?.data?.message || 'unknown error'}; next pass re-checks`);
      }
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
 * @returns {Object} Control object with stop() method
 */
function syncthingApps(state, installedAppsFn, getGlobalStateFn) {
  let intervalId = null;
  let isRunning = false;
  let accelerator; // assigned below; runMonitoring only executes after assignment

  const runMonitoring = async () => {
    if (isRunning) {
      log.warn('syncthingApps - Previous execution still running, skipping this iteration');
      return;
    }

    isRunning = true;
    accelerator.notePassStarted();
    try {
      await syncthingAppsCore(
        state,
        installedAppsFn,
        getGlobalStateFn,
      );
    } catch (error) {
      log.error(`syncthingApps - Unexpected error in monitoring loop: ${error.message}`);
      log.error(error.stack);
    } finally {
      isRunning = false;
      accelerator.notePassEnded();
    }
  };

  // Edge accelerator: folder events for folders the state machine is actively
  // transitioning (plus FolderErrors and resync requests) trigger an early run
  // of the SAME monitoring pass the interval drives - events never carry
  // decisions, and steady-state folder activity never accelerates anything.
  accelerator = createMonitorAccelerator({
    run: runMonitoring,
    isFolderInTransition: (folderId) => {
      const entry = state.receiveOnlySyncthingAppsCache.get(folderId);
      return Boolean(entry && !entry.restarted);
    },
    debounceMs: EARLY_EVAL_DEBOUNCE_MS,
    minGapMs: EARLY_EVAL_MIN_GAP_MS,
  });

  // Run immediately on start
  runMonitoring();

  // Then run at regular intervals (the LEVEL: ground truth, self-healing)
  intervalId = setInterval(runMonitoring, MONITOR_INTERVAL_MS);

  syncthingEventsConsumer.start({
    onFolderActivity: (folder, eventType) => accelerator.onFolderActivity(folder, eventType),
    onResync: () => accelerator.onResync(),
  });

  // Return control object for graceful shutdown
  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        accelerator.stop();
        syncthingEventsConsumer.stop();
        log.info('syncthingApps - Monitoring service stopped');
      }
    },
    isActive: () => intervalId !== null,
  };
}

module.exports = {
  syncthingApps,
};
