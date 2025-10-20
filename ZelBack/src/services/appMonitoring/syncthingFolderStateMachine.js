// Syncthing Folder State Machine - Manages folder sync transitions
const log = require('../../lib/log');
const dockerService = require('../dockerService');
const syncthingService = require('../syncthingService');
const serviceHelper = require('../serviceHelper');
const {
  MAX_SYNC_WAIT_EXECUTIONS,
  LEADER_ELECTION_MIN_EXECUTIONS,
  LEADER_ELECTION_EXECUTIONS_PER_INDEX,
  SYNC_COMPLETE_PERCENTAGE,
  OPERATION_DELAY_MS,
  CLOCK_SKEW_TOLERANCE_MS,
} = require('./syncthingMonitorConstants');
const { sortRunningAppList } = require('./syncthingMonitorHelpers');

/**
 * Helper function to get Syncthing folder sync completion status
 * @param {string} folderId - The Syncthing folder ID
 * @returns {Promise<Object|null>} Sync status object or null if unavailable
 */
async function getFolderSyncCompletion(folderId) {
  try {
    const statusResponse = await syncthingService.getDbStatus(null, {
      query: { folder: folderId },
    });

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
  } = params;

  if (!syncFolder) {
    // No sync folder exists - clean install
    log.info(`syncthingApps - First run, no sync folder - stopping and cleaning ${appId}`);
    syncthingFolder.type = 'receiveonly';
    const cache = { numberOfExecutions: 1 };

    await appDockerStopFn(appId);
    await serviceHelper.delay(OPERATION_DELAY_MS);
    await appDeleteDataInMountPointFn(appId);
    await serviceHelper.delay(OPERATION_DELAY_MS);

    return { syncthingFolder, cache };
  }

  // Sync folder exists - check container status
  log.info(`syncthingApps - First run, sync folder exists - checking container status`);
  let containerRunning = false;

  try {
    const containerInspect = await dockerService.dockerContainerInspect(appId);
    containerRunning = containerInspect.State.Running;
    log.info(`syncthingApps - ${appId} running status: ${containerRunning}`);
  } catch (error) {
    log.warn(`syncthingApps - Could not inspect ${appId}: ${error.message}`);
  }

  const cache = { restarted: true };

  if (syncFolder.type === 'receiveonly') {
    log.info(`syncthingApps - Sync folder is receiveonly, updating cache`);
    cache.restarted = false;
    cache.numberOfExecutions = 1;
  } else if (!containerRunning && containerDataFlags.includes('r')) {
    log.info(`syncthingApps - Container not running, starting ${appId}`);
    try {
      await dockerService.appDockerStart(appId);
    } catch (error) {
      log.error(`syncthingApps - Error starting ${appId}: ${error.message}`);
    }
  }

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
  } = params;

  log.info(`syncthingApps - ${appId} was skipped on first encounter, now processing as new app`);
  syncthingFolder.type = 'receiveonly';
  const cache = { numberOfExecutions: 1 };

  await appDockerStopFn(appId);
  await serviceHelper.delay(OPERATION_DELAY_MS);
  await appDeleteDataInMountPointFn(appId);
  await serviceHelper.delay(OPERATION_DELAY_MS);

  return { syncthingFolder, cache };
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

  log.info(`syncthingApps - ${appId} in cache and not restarted, processing receive-only logic`);

  // Check if this node is the designated leader
  const isLeader = isDesignatedLeader(runningAppList, myIP);

  if (isLeader) {
    log.info(`syncthingApps - ${appId} is the designated leader (elected from ${runningAppList.length} peers), starting immediately`);
    syncthingFolder.type = 'sendreceive';

    if (containerDataFlags.includes('r')) {
      log.info(`syncthingApps - starting ${appId}`);
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
    log.info(
      `syncthingApps - ${appId} sync status: ${syncStatus.syncPercentage.toFixed(2)}% ` +
      `(${syncStatus.inSyncBytes}/${syncStatus.globalBytes} bytes), ` +
      `state: ${syncStatus.state}, executions: ${cache.numberOfExecutions}`
    );

    if (syncStatus.isSynced || cache.numberOfExecutions >= MAX_SYNC_WAIT_EXECUTIONS) {
      if (syncStatus.isSynced) {
        log.info(`syncthingApps - ${appId} is synced (${syncStatus.syncPercentage.toFixed(2)}%), switching to sendreceive`);
      } else {
        log.warn(`syncthingApps - ${appId} reached max wait time (${MAX_SYNC_WAIT_EXECUTIONS} executions), forcing start`);
      }

      syncthingFolder.type = 'sendreceive';
      if (containerDataFlags.includes('r')) {
        log.info(`syncthingApps - starting ${appId}`);
        await appDockerRestartFn(appId);
      }
      cache.restarted = true;
    }
  } else {
    // Fallback to time-based approach
    log.warn(`syncthingApps - Could not get sync status for ${appId}, using fallback time-based logic`);

    const numberOfExecutionsRequired = calculateRequiredExecutions(runningAppList, myIP);
    cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

    log.info(`syncthingApps - ${appId} executions: ${cache.numberOfExecutions}/${cache.numberOfExecutionsRequired}`);

    if (cache.numberOfExecutions >= numberOfExecutionsRequired) {
      log.info(`syncthingApps - ${appId} reached required executions, switching to sendreceive`);
      syncthingFolder.type = 'sendreceive';

      if (containerDataFlags.includes('r')) {
        log.info(`syncthingApps - starting ${appId}`);
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
    syncthingAppsFirstRun,
    appDockerStopFn,
    appDeleteDataInMountPointFn,
    syncthingFolder,
  } = params;

  log.info(`syncthingApps - ${appId} NOT in cache. stopping and cleaning ${appId}`);
  syncthingFolder.type = 'receiveonly';
  const cache = { numberOfExecutions: 1 };

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
      log.info(`syncthingApps - ${appId} is not running, starting it`);
      await dockerService.appDockerStart(appId);
    }
  } catch (error) {
    log.error(`syncthingApps - Error checking/starting ${appId}: ${error.message}`);
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
    await ensureContainerRunning(appId, containerDataFlags);
    return { syncthingFolder, cache: null, skipUpdate: true };
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
      syncthingFolder,
    });
    return result;
  }

  // App not in cache at all
  if (!cache) {
    // If not first run, skip it on first encounter
    if (!syncthingAppsFirstRun) {
      log.info(`syncthingApps - ${appId} NOT in cache and not first run, marking for skip on first encounter`);
      const skipCache = { firstEncounterSkipped: true };
      return { syncthingFolder, cache: skipCache, skipProcessing: true };
    }

    // First run and not in cache - clean install
    const result = await handleNewApp({
      appId,
      syncthingAppsFirstRun,
      appDockerStopFn,
      appDeleteDataInMountPointFn,
      syncthingFolder,
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
};
