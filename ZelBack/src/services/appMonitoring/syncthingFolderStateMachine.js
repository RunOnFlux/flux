// Syncthing Folder State Machine - Manages folder sync transitions
const util = require('util');
const nodecmd = require('node-cmd');
const log = require('../../lib/log');
const dockerService = require('../dockerService');
const syncthingService = require('../syncthingService');
const serviceHelper = require('../serviceHelper');
const { appsFolder } = require('../utils/appConstants');
const {
  MAX_SYNC_WAIT_EXECUTIONS,
  STALLED_SYNC_CHECK_COUNT,
  LEADER_ELECTION_MIN_EXECUTIONS,
  LEADER_ELECTION_EXECUTIONS_PER_INDEX,
  SYNC_COMPLETE_PERCENTAGE,
  OPERATION_DELAY_MS,
  CLOCK_SKEW_TOLERANCE_MS,
} = require('./syncthingMonitorConstants');
const { sortRunningAppList } = require('./syncthingMonitorHelpers');

const cmdAsync = util.promisify(nodecmd.run);

/**
 * Check if a path is a mount point (has a filesystem mounted on it)
 * This detects if loop devices or other filesystems are properly mounted
 * @param {string} dirPath - Directory path to check
 * @returns {Promise<boolean>} True if path is a mount point
 */
async function isPathMounted(dirPath) {
  try {
    // mountpoint command returns 0 if path is a mount point
    await cmdAsync(`mountpoint -q ${dirPath}`);
    return true;
  } catch (error) {
    // mountpoint returns non-zero if not a mount point
    return false;
  }
}

/**
 * Check if a directory has actual content (not just an empty mount point)
 * @param {string} dirPath - Directory path to check
 * @returns {Promise<{hasContent: boolean, fileCount: number}>} Content status
 */
async function checkDirectoryHasContent(dirPath) {
  try {
    // Count files in directory (excluding . and ..)
    const result = await cmdAsync(`find ${dirPath} -type f 2>/dev/null | head -100 | wc -l`);
    const fileCount = parseInt(result.toString().trim(), 10) || 0;
    return {
      hasContent: fileCount > 0,
      fileCount,
    };
  } catch (error) {
    log.warn(`checkDirectoryHasContent - Error checking ${dirPath}: ${error.message}`);
    return { hasContent: false, fileCount: 0 };
  }
}

/**
 * Verify that a Syncthing folder's mount is properly initialized
 * This is CRITICAL to prevent data loss when mounts are not ready after reboot
 * @param {string} appId - App ID (e.g., fluxwp_myapp)
 * @param {string} folderPath - Syncthing folder path
 * @returns {Promise<{isSafe: boolean, reason: string, isMounted: boolean, hasContent: boolean}>}
 */
async function verifyFolderMountSafety(appId, folderPath) {
  const result = {
    isSafe: true,
    reason: 'ok',
    isMounted: false,
    hasContent: false,
    fileCount: 0,
  };

  try {
    // Check 1: Does the base app directory exist?
    const baseDir = `${appsFolder}${appId}`;
    const baseDirExists = await cmdAsync(`test -d ${baseDir} && echo "exists"`).then(() => true).catch(() => false);

    if (!baseDirExists) {
      result.isSafe = false;
      result.reason = 'base_directory_missing';
      log.warn(`verifyFolderMountSafety - ${appId} base directory does not exist: ${baseDir}`);
      return result;
    }

    // Check 2: Is the base directory a mount point? (for loop-mounted volumes)
    result.isMounted = await isPathMounted(baseDir);

    // Check 3: Does the folder have actual content?
    const contentCheck = await checkDirectoryHasContent(folderPath);
    result.hasContent = contentCheck.hasContent;
    result.fileCount = contentCheck.fileCount;

    // Safety logic:
    // If directory exists but is NOT mounted and has NO content, this is dangerous
    // It might be an empty mount point waiting for loop device
    if (!result.isMounted && !result.hasContent) {
      result.isSafe = false;
      result.reason = 'empty_unmounted_directory';
      log.error(`verifyFolderMountSafety - CRITICAL: ${appId} directory exists but not mounted and empty! Likely missing loop mount.`);
      return result;
    }

    // If mounted but empty, be cautious (could be race condition)
    if (result.isMounted && !result.hasContent) {
      // Give a small grace period - maybe syncing hasn't completed yet
      // But this is still suspicious
      log.warn(`verifyFolderMountSafety - ${appId} is mounted but has no content (0 files). Potential data loss risk.`);
      // We'll allow it but log warning - Syncthing should handle this
    }

    return result;
  } catch (error) {
    log.error(`verifyFolderMountSafety - Error checking ${appId}: ${error.message}`);
    result.isSafe = false;
    result.reason = 'check_failed';
    return result;
  }
}

/**
 * Fix permissions on all mount directories for containers
 * Critical for synced data that may have wrong ownership
 * Fixes permissions on appdata and all additional mount points
 * @param {string} appId - App ID
 * @returns {Promise<void>}
 */
async function fixAppdataPermissions(appId) {
  try {
    // Fix permissions on entire app directory to cover appdata and all additional mounts
    // (appdata, logs, config, file mounts, etc.)
    const appPath = `${appsFolder}${appId}`;

    // Recursively set 777 permissions to allow any container user to write
    // This ensures containers running as any UID/GID can access their data
    // Covers both appdata (primary mount) and all additional mounts at the same level
    const fixPermissions = `sudo chmod -R 777 ${appPath}`;
    await cmdAsync(fixPermissions);
    log.info(`fixAppdataPermissions - Fixed permissions on ${appPath} (includes appdata and all mount points)`);
  } catch (error) {
    log.warn(`fixAppdataPermissions - Could not fix permissions for ${appId}: ${error.message}`);
    // Continue anyway - container might still work
  }
}

/**
 * Helper function to get Syncthing folder sync completion status
 * @param {string} folderId - The Syncthing folder ID
 * @returns {Promise<Object|null>} Sync status object or null if unavailable
 */
async function getFolderSyncCompletion(folderId) {
  try {
    const statusResponse = await syncthingService.getDbStatus({
      query: { folder: folderId },
    }, null);

    if (statusResponse && statusResponse.status === 'success') {
      const { globalBytes = 0, inSyncBytes = 0, state } = statusResponse.data;

      const syncPercentage = globalBytes > 0 ? (inSyncBytes / globalBytes) * 100 : 100;

      return {
        syncPercentage,
        globalBytes,
        inSyncBytes,
        state,
        isSynced: syncPercentage === SYNC_COMPLETE_PERCENTAGE,
      };
    }

    log.warn(`Failed to get sync status for folder ${folderId}`);
    return null;
  } catch (error) {
    log.error(`Error checking sync completion for ${folderId}: ${error.message}`);
    return null;
  }
}

/**
 * Determines if this node should be the designated leader for starting an app first.
 * Uses deterministic leader election to prevent race conditions.
 *
 * @param {Array<Object>} allPeersList - List of ALL peers including the current node
 * @param {string} myIP - The current node's IP address
 * @returns {boolean} True if this node is the designated leader
 */
function isDesignatedLeader(allPeersList, myIP) {
  if (!allPeersList || allPeersList.length === 0) {
    return false; // Be conservative - wait for peers to broadcast
  }

  // Check if any OTHER peer is already running
  const runningPeers = allPeersList.filter((peer) => peer.runningSince && peer.ip !== myIP);
  if (runningPeers.length > 0) {
    return false; // Someone else is already running
  }

  // Special case: single peer deployment
  if (allPeersList.length === 1 && allPeersList[0].ip === myIP) {
    return true;
  }

  // Deterministic leader election
  const sortedPeers = [...allPeersList].sort((a, b) => {
    if (a.broadcastedAt && b.broadcastedAt) {
      const timeDiff = a.broadcastedAt - b.broadcastedAt;
      // Only consider significant time differences to avoid clock skew issues
      if (Math.abs(timeDiff) > CLOCK_SKEW_TOLERANCE_MS) {
        return timeDiff;
      }
    }
    // Use IP as deterministic tie-breaker
    if (a.ip < b.ip) return -1;
    if (a.ip > b.ip) return 1;
    return 0;
  });

  const leader = sortedPeers[0];
  const isLeader = leader?.ip === myIP;

  return isLeader && allPeersList.some((peer) => peer.ip === myIP);
}

/**
 * Calculate required executions based on node index (fallback for time-based sync)
 * @param {Array} runningAppList - Sorted list of running apps
 * @param {string} myIP - Current node IP
 * @returns {number} Number of required executions
 */
function calculateRequiredExecutions(runningAppList, myIP) {
  const sortedList = sortRunningAppList(runningAppList);
  const index = sortedList.findIndex((x) => x.ip === myIP);

  let required = LEADER_ELECTION_MIN_EXECUTIONS;
  if (index > 0) {
    required = LEADER_ELECTION_MIN_EXECUTIONS + LEADER_ELECTION_EXECUTIONS_PER_INDEX * index;
  }

  return Math.min(required, MAX_SYNC_WAIT_EXECUTIONS);
}

/**
 * Handle first run scenario for an app/component
 * @param {Object} params - Parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function handleFirstRun(params) {
  const {
    appId,
    syncFolder,
    containerDataFlags,
    appDockerStopFn,
    appDeleteDataInMountPointFn,
    syncthingFolder,
    receiveOnlySyncthingAppsCache,
  } = params;

  if (!syncFolder) {
    // No sync folder exists - clean install
    log.info(`handleFirstRun - First run, no sync folder - stopping and cleaning ${appId}`);
    syncthingFolder.type = 'receiveonly';
    const cache = { numberOfExecutions: 1 };

    // Set cache BEFORE stopping/deleting to prevent race condition
    receiveOnlySyncthingAppsCache.set(appId, cache);

    await appDockerStopFn(appId);
    await serviceHelper.delay(OPERATION_DELAY_MS);
    await appDeleteDataInMountPointFn(appId);
    await serviceHelper.delay(OPERATION_DELAY_MS);

    return { syncthingFolder, cache };
  }

  // Sync folder exists - check container status
  log.info('handleFirstRun - First run, sync folder exists - checking container status');
  let containerRunning = false;

  try {
    const containerInspect = await dockerService.dockerContainerInspect(appId);
    containerRunning = containerInspect.State.Running;
    log.info(`handleFirstRun - ${appId} running status: ${containerRunning}`);
  } catch (error) {
    log.warn(`handleFirstRun - Could not inspect ${appId}: ${error.message}`);
  }

  if (containerRunning) {
    // App is running - this means FluxOS restart, not computer restart
    // Skip processing - keep existing state
    log.info(`handleFirstRun - ${appId} is running, FluxOS restart detected, keeping existing state`);
    const cache = { restarted: true };
    return { syncthingFolder, cache };
  }

  // Container is stopped - computer was restarted
  // Set to receiveonly mode to wait for sync before starting
  log.info(`handleFirstRun - ${appId} is stopped, computer restart detected, setting to receiveonly mode`);
  syncthingFolder.type = 'receiveonly';
  const cache = {
    restarted: false,
    numberOfExecutions: 1,
  };

  return { syncthingFolder, cache };
}

/**
 * Handle skipped app on second encounter
 * @param {Object} params - Parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function handleSkippedAppSecondEncounter(params) {
  const {
    appId,
    appDockerStopFn,
    appDeleteDataInMountPointFn,
    syncthingFolder,
    receiveOnlySyncthingAppsCache,
  } = params;

  log.info(`handleSkippedAppSecondEncounter - ${appId} was skipped on first encounter, now processing as new app`);
  syncthingFolder.type = 'receiveonly';
  const cache = { numberOfExecutions: 1 };

  // Set cache BEFORE stopping/deleting to prevent race condition
  receiveOnlySyncthingAppsCache.set(appId, cache);

  await appDockerStopFn(appId);
  await serviceHelper.delay(OPERATION_DELAY_MS);
  await appDeleteDataInMountPointFn(appId);
  await serviceHelper.delay(OPERATION_DELAY_MS);

  return { syncthingFolder, cache };
}

/**
 * Check if any remote peers have this folder in sendreceive mode and fully synced
 * @param {string} folderId - Syncthing folder ID
 * @returns {Promise<boolean>} True if at least one peer has folder in sendreceive and synced
 */
async function checkIfPeersAreSynced(folderId) {
  try {
    // Get all Syncthing folders
    const configResponse = await syncthingService.getConfig({}, null);
    if (!configResponse || configResponse.status !== 'success') {
      return false;
    }

    const folder = configResponse.data.folders?.find((f) => f.id === folderId);
    if (!folder) {
      return false;
    }

    // Check if folder exists in sendreceive on at least one device
    if (folder.type === 'sendreceive') {
      // We ourselves are in sendreceive, peers must be synced
      return true;
    }

    // Check remote devices for this folder
    const { devices = [] } = folder;
    if (devices.length === 0) {
      return false;
    }

    // Get device completion status for each remote device
    // eslint-disable-next-line no-restricted-syntax
    for (const device of devices) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const completionResponse = await syncthingService.getDbCompletion({
          query: { folder: folderId, device: device.deviceID },
        }, null);

        if (completionResponse?.status === 'success' && completionResponse.data) {
          const { completion = 0 } = completionResponse.data;
          // If any device has 100% completion, it means they have all the data
          if (completion === 100) {
            log.info(`checkIfPeersAreSynced - Found synced peer for ${folderId}: device ${device.deviceID.substring(0, 7)}... at ${completion}%`);
            return true;
          }
        }
      } catch (deviceError) {
        log.warn(`checkIfPeersAreSynced - Error checking device ${device.deviceID}: ${deviceError.message}`);
      }
    }

    return false;
  } catch (error) {
    log.error(`checkIfPeersAreSynced - Error checking peers for ${folderId}: ${error.message}`);
    return false;
  }
}

/**
 * Check if sync is stalled (no progress for STALLED_SYNC_CHECK_COUNT checks)
 * @param {Array} syncHistory - Array of recent sync statuses
 * @returns {boolean} True if sync appears stalled
 */
function isSyncStalled(syncHistory) {
  if (!syncHistory || syncHistory.length < STALLED_SYNC_CHECK_COUNT) {
    return false;
  }

  // Get last N statuses
  const recentStatuses = syncHistory.slice(-STALLED_SYNC_CHECK_COUNT);

  // Check if inSyncBytes hasn't changed
  const firstBytes = recentStatuses[0].inSyncBytes;
  const allSameBytes = recentStatuses.every((status) => status.inSyncBytes === firstBytes);

  if (allSameBytes) {
    log.warn(`isSyncStalled - Detected stalled sync: ${firstBytes} bytes unchanged for ${STALLED_SYNC_CHECK_COUNT} checks`);
    return true;
  }

  return false;
}

/**
 * Handle receive-only to send-receive transition
 * @param {Object} params - Parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function handleReceiveOnlyTransition(params) {
  const {
    appId,
    cache,
    runningAppList,
    myIP,
    containerDataFlags,
    appDockerRestartFn,
    syncthingFolder,
  } = params;

  log.info(`handleReceiveOnlyTransition - ${appId} in cache and not restarted, processing receive-only logic`);

  // Check if this node is the designated leader
  const isLeader = isDesignatedLeader(runningAppList, myIP);

  if (isLeader) {
    log.info(`handleReceiveOnlyTransition - ${appId} is the designated leader (elected from ${runningAppList.length} peers), starting immediately`);

    // Fix permissions before changing to sendreceive - ensures correct ownership for synced data
    await fixAppdataPermissions(appId);

    syncthingFolder.type = 'sendreceive';

    if (containerDataFlags.includes('r')) {
      log.info(`handleReceiveOnlyTransition - starting ${appId}`);
      await appDockerRestartFn(appId);
    }

    cache.restarted = true;
    return { syncthingFolder, cache };
  }

  // Not the leader - check sync status
  const syncStatus = await getFolderSyncCompletion(appId);
  syncthingFolder.type = 'receiveonly';
  cache.numberOfExecutions = (cache.numberOfExecutions || 0) + 1;

  if (syncStatus) {
    // Track sync history for stall detection
    if (!cache.syncHistory) {
      cache.syncHistory = [];
    }
    cache.syncHistory.push({
      inSyncBytes: syncStatus.inSyncBytes,
      globalBytes: syncStatus.globalBytes,
      syncPercentage: syncStatus.syncPercentage,
      timestamp: Date.now(),
    });
    // Keep only last 15 statuses to avoid memory bloat (need at least 10 for stall detection)
    if (cache.syncHistory.length > 15) {
      cache.syncHistory = cache.syncHistory.slice(-15);
    }

    log.info(
      `handleReceiveOnlyTransition - ${appId} sync status: ${syncStatus.syncPercentage.toFixed(2)}% `
      + `(${syncStatus.inSyncBytes}/${syncStatus.globalBytes} bytes), `
      + `state: ${syncStatus.state}, executions: ${cache.numberOfExecutions}`,
    );

    // Check for stalled sync - if no progress and peers are synced, restart
    if (isSyncStalled(cache.syncHistory)) {
      log.warn(`handleReceiveOnlyTransition - ${appId} sync appears stalled, checking if peers are available...`);
      const peersAreSynced = await checkIfPeersAreSynced(appId);

      if (peersAreSynced) {
        log.warn(
          `handleReceiveOnlyTransition - ${appId} sync stalled but peers are synced. `
          + 'Wiping local data and restarting sync to recover...',
        );

        // Wipe data and restart sync (similar to handleNewApp)
        const { appDockerStopFn, appDeleteDataInMountPointFn } = params;
        await appDockerStopFn(appId);
        await serviceHelper.delay(OPERATION_DELAY_MS);
        await appDeleteDataInMountPointFn(appId);
        await serviceHelper.delay(OPERATION_DELAY_MS);

        // Reset cache to start fresh
        cache.numberOfExecutions = 1;
        cache.syncHistory = [];
        delete cache.previousGlobalBytes;

        log.info(`handleReceiveOnlyTransition - ${appId} data wiped, sync restarted`);
        return { syncthingFolder, cache };
      }
      log.warn(`handleReceiveOnlyTransition - ${appId} sync stalled but no synced peers found, continuing to wait...`);
    }

    if (syncStatus.isSynced || cache.numberOfExecutions >= MAX_SYNC_WAIT_EXECUTIONS) {
      if (syncStatus.isSynced) {
        log.info(`handleReceiveOnlyTransition - ${appId} is synced (${syncStatus.syncPercentage.toFixed(2)}%), switching to sendreceive`);
      } else {
        log.warn(`handleReceiveOnlyTransition - ${appId} reached max wait time (${MAX_SYNC_WAIT_EXECUTIONS} executions), forcing start`);
      }

      // Fix permissions before changing to sendreceive - critical for synced data
      await fixAppdataPermissions(appId);

      syncthingFolder.type = 'sendreceive';
      if (containerDataFlags.includes('r')) {
        log.info(`handleReceiveOnlyTransition - starting ${appId}`);
        await appDockerRestartFn(appId);
      }
      cache.restarted = true;
    }
  } else {
    // Fallback to time-based approach
    log.warn(`handleReceiveOnlyTransition - Could not get sync status for ${appId}, using fallback time-based logic`);

    const numberOfExecutionsRequired = calculateRequiredExecutions(runningAppList, myIP);
    cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

    log.info(`handleReceiveOnlyTransition - ${appId} executions: ${cache.numberOfExecutions}/${cache.numberOfExecutionsRequired}`);

    if (cache.numberOfExecutions >= numberOfExecutionsRequired) {
      log.info(`handleReceiveOnlyTransition - ${appId} reached required executions, switching to sendreceive`);

      // Fix permissions before changing to sendreceive - critical for synced data
      await fixAppdataPermissions(appId);

      syncthingFolder.type = 'sendreceive';

      if (containerDataFlags.includes('r')) {
        log.info(`handleReceiveOnlyTransition - starting ${appId}`);
        await appDockerRestartFn(appId);
      }
      cache.restarted = true;
    }
  }

  return { syncthingFolder, cache };
}

/**
 * Handle new app that was never processed
 * @param {Object} params - Parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function handleNewApp(params) {
  const {
    appId,
    appDockerStopFn,
    appDeleteDataInMountPointFn,
    syncthingFolder,
    receiveOnlySyncthingAppsCache,
  } = params;

  log.info(`handleNewApp - ${appId} NOT in cache. stopping and cleaning ${appId}`);
  syncthingFolder.type = 'receiveonly';
  const cache = { numberOfExecutions: 1 };

  // Set cache BEFORE stopping/deleting to prevent race condition
  // This matches the old code behavior and ensures subsequent monitoring
  // cycles don't re-process this app as "new"
  receiveOnlySyncthingAppsCache.set(appId, cache);

  await appDockerStopFn(appId);
  await serviceHelper.delay(OPERATION_DELAY_MS);
  await appDeleteDataInMountPointFn(appId);
  await serviceHelper.delay(OPERATION_DELAY_MS);

  return { syncthingFolder, cache };
}

/**
 * Ensure container is running if needed
 * @param {string} appId - App ID
 * @param {string} containerDataFlags - Container flags
 * @returns {Promise<void>}
 */
async function ensureContainerRunning(appId, containerDataFlags) {
  try {
    const containerInspect = await dockerService.dockerContainerInspect(appId);

    if (!containerInspect.State.Running && containerDataFlags.includes('r')) {
      log.info(`ensureContainerRunning - ${appId} is not running, starting it`);
      await dockerService.appDockerStart(appId);
    }
  } catch (error) {
    log.error(`ensureContainerRunning - Error checking/starting ${appId}: ${error.message}`);
  }
}

/**
 * Main state machine for folder sync management
 * Manages the transition from receiveonly to sendreceive mode
 *
 * @param {Object} params - All required parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function manageFolderSyncState(params) {
  const {
    appId,
    syncFolder,
    containerDataFlags,
    syncthingAppsFirstRun,
    receiveOnlySyncthingAppsCache,
    appLocation,
    myIP,
    appDockerStopFn,
    appDockerRestartFn,
    appDeleteDataInMountPointFn,
    syncthingFolder,
    installedAppName,
  } = params;

  // Check if folder already exists and is in sendreceive mode
  const folderAlreadySyncing = syncFolder && syncFolder.type === 'sendreceive';

  // If already syncing in sendreceive mode, ensure container is running
  if (folderAlreadySyncing) {
    // CRITICAL SAFETY CHECK: Verify mount is properly initialized before trusting sendreceive mode
    // This prevents data loss when loop mounts aren't ready after reboot
    const folderPath = syncFolder.path || `${appsFolder}${appId}/appdata`;
    const mountSafety = await verifyFolderMountSafety(appId, folderPath);

    if (!mountSafety.isSafe) {
      // DANGER: Mount not ready! Switch to receiveonly to prevent data propagation
      log.error(`manageFolderSyncState - SAFETY BLOCK: ${appId} mount not safe (${mountSafety.reason}). Switching to receiveonly mode to prevent data loss.`);
      log.error(`manageFolderSyncState - Mount status: mounted=${mountSafety.isMounted}, hasContent=${mountSafety.hasContent}, files=${mountSafety.fileCount}`);

      // Update folder to receiveonly mode to prevent this node from sending "empty" state to peers
      syncthingFolder.type = 'receiveonly';
      const cache = {
        numberOfExecutions: 0,
        mountSafetyBlocked: true,
        blockedReason: mountSafety.reason,
        blockedAt: Date.now(),
      };
      receiveOnlySyncthingAppsCache.set(appId, cache);

      // Return with skipUpdate=false so the folder config gets updated to receiveonly
      return { syncthingFolder, cache, skipUpdate: false };
    }

    // Mount is safe, proceed normally
    await ensureContainerRunning(appId, containerDataFlags);
    // Ensure cache entry exists so health monitor can track this folder
    const existingCache = receiveOnlySyncthingAppsCache.get(appId);
    const cache = existingCache || { restarted: true };
    return { syncthingFolder, cache, skipUpdate: true };
  }

  // First run scenario
  if (syncthingAppsFirstRun) {
    const result = await handleFirstRun({
      appId,
      syncFolder,
      containerDataFlags,
      appDockerStopFn,
      appDeleteDataInMountPointFn,
      syncthingFolder,
      receiveOnlySyncthingAppsCache,
    });
    return result;
  }

  const cache = receiveOnlySyncthingAppsCache.get(appId);

  // Second encounter of a skipped app
  if (cache?.firstEncounterSkipped) {
    const result = await handleSkippedAppSecondEncounter({
      appId,
      appDockerStopFn,
      appDeleteDataInMountPointFn,
      syncthingFolder,
      receiveOnlySyncthingAppsCache,
    });
    return result;
  }

  // App in cache but not yet restarted - handle transition
  if (cache && !cache.restarted) {
    const runningAppList = await appLocation(installedAppName);
    const result = await handleReceiveOnlyTransition({
      appId,
      cache,
      runningAppList,
      myIP,
      containerDataFlags,
      appDockerRestartFn,
      appDockerStopFn,
      appDeleteDataInMountPointFn,
      syncthingFolder,
    });
    return result;
  }

  // App not in cache at all
  if (!cache) {
    // If syncFolder doesn't exist, this is a NEW app installation - process it immediately
    // regardless of syncthingAppsFirstRun flag to prevent data loss
    if (!syncFolder) {
      log.info(`manageFolderSyncState - ${appId} NOT in cache but syncFolder doesn't exist, treating as new app installation`);
      const result = await handleNewApp({
        appId,
        appDockerStopFn,
        appDeleteDataInMountPointFn,
        syncthingFolder,
        receiveOnlySyncthingAppsCache,
      });
      return result;
    }

    // syncFolder exists but not in cache and not first run - skip on first encounter
    // This handles apps that existed before monitoring but weren't tracked in cache
    if (!syncthingAppsFirstRun) {
      log.info(`manageFolderSyncState - ${appId} NOT in cache and not first run, marking for skip on first encounter`);
      const skipCache = { firstEncounterSkipped: true };
      return { syncthingFolder, cache: skipCache, skipProcessing: true };
    }

    // First run and not in cache - clean install
    const result = await handleNewApp({
      appId,
      appDockerStopFn,
      appDeleteDataInMountPointFn,
      syncthingFolder,
      receiveOnlySyncthingAppsCache,
    });
    return result;
  }

  // Default case - ensure container is running
  await ensureContainerRunning(appId, containerDataFlags);
  return { syncthingFolder, cache: null };
}

module.exports = {
  manageFolderSyncState,
  getFolderSyncCompletion,
  isDesignatedLeader,
  verifyFolderMountSafety,
  isPathMounted,
  checkDirectoryHasContent,
};
