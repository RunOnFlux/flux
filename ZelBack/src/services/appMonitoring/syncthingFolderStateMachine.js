// Syncthing Folder State Machine - Manages folder sync transitions
const util = require('util');
const nodecmd = require('node-cmd');
const log = require('../../lib/log');
const dockerService = require('../dockerService');
const appReconciler = require('./appReconciler');
const appUninstaller = require('../appLifecycle/appUninstaller');
const syncthingService = require('../syncthingService');
const serviceHelper = require('../serviceHelper');
const { appsFolder } = require('../utils/appConstants');
const appTamperingDetectionService = require('../appTamperingDetectionService');
const { socketAddressesMatch } = require('../utils/socketAddressUtils');
const {
  LEADER_CONFIRM_COUNT,
  SYNC_COMPLETE_PERCENTAGE,
  OPERATION_DELAY_MS,
  CLOCK_SKEW_TOLERANCE_MS,
  STALL_NUDGE_AFTER_MS,
  STALL_NUDGE_MAX_INTERVAL_MS,
  STALL_REMOVE_MIN_WINDOW_MS,
  STALL_REMOVE_MIN_NUDGES,
  ACTIVE_FOLDER_STATES,
} = require('./syncthingMonitorConstants');

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
      await appTamperingDetectionService.recordEvent(appId, 'mount_vanished', `Base directory missing: ${baseDir}`);
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
      const {
        globalBytes = 0, inSyncBytes = 0, state, receiveOnlyChangedFiles = 0,
      } = statusResponse.data;

      const syncPercentage = globalBytes > 0 ? (inSyncBytes / globalBytes) * 100 : 100;

      return {
        syncPercentage,
        globalBytes,
        inSyncBytes,
        state,
        // local additions/modifications in a receiveonly folder; invisible to the
        // completion metrics above (they only count cluster data)
        receiveOnlyChangedFiles,
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
 * @param {string} localSocketAddr - The current node's IP address
 * @returns {boolean} True if this node is the designated leader
 */
function isDesignatedLeader(allPeersList, localSocketAddr) {
  if (!allPeersList || allPeersList.length === 0) {
    return false; // Be conservative - wait for peers to broadcast
  }

  // Check if any OTHER peer is already running
  const runningPeers = allPeersList.filter((peer) => peer.runningSince && !socketAddressesMatch(peer.ip, localSocketAddr));
  if (runningPeers.length > 0) {
    return false; // Someone else is already running
  }

  // Special case: single peer deployment
  if (allPeersList.length === 1 && socketAddressesMatch(allPeersList[0].ip, localSocketAddr)) {
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
  const isLeader = socketAddressesMatch(leader?.ip, localSocketAddr);

  return isLeader && allPeersList.some((peer) => socketAddressesMatch(peer.ip, localSocketAddr));
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
          const { completion = 0, globalBytes = 0, remoteState = 'unknown' } = completionResponse.data;
          // A peer is a safe source only if it is CONNECTED (remoteState 'valid'),
          // reports 100%, AND actually holds data:
          // - db/completion is computed from the peer's last-known index, so a dead or
          //   offline peer still reports completion 100. Trusting that stale figure
          //   turns a source-node reboot into followers deleting their partial copies.
          //   remoteState is the connectivity discriminator ('valid' iff connected);
          //   when absent, there is no evidence and the peer must not be trusted.
          // - Syncthing reports completion 100 for an empty folder (globalBytes 0) too,
          //   so without the globalBytes check a peer that synced empty/wrong data from
          //   a bad seed would falsely satisfy "peers are synced" and we would remove
          //   the good local copy in favour of an empty one (data loss).
          if (remoteState === 'valid' && completion === 100 && globalBytes > 0) {
            log.info(`checkIfPeersAreSynced - Found synced peer for ${folderId}: device ${device.deviceID.substring(0, 7)}... at ${completion}% (${globalBytes} bytes, connected)`);
            return true;
          }
          if (completion === 100 && remoteState !== 'valid') {
            log.warn(`checkIfPeersAreSynced - ${folderId}: device ${device.deviceID.substring(0, 7)}... reports 100% but is not connected (remoteState ${remoteState}); stale index, not a synced source`);
          } else if (completion === 100) {
            log.warn(`checkIfPeersAreSynced - ${folderId}: device ${device.deviceID.substring(0, 7)}... reports 100% but 0 bytes (empty); not treating it as a synced source`);
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
 * Nudge a folder's devices: pause then resume each device the folder is shared
 * with. The reconnect forces a fresh index exchange, which re-arms a dormant
 * puller (failed-pull retry backoff, or the inert no-retry state where a failed
 * pull never retries again - verified live; recovery takes ~30s). This is the
 * surgical version of the only useful thing a syncthing process restart did,
 * without dropping every other folder's transfers node-wide.
 * @param {string} folderId - Syncthing folder ID
 */
async function nudgeFolderDevices(folderId) {
  try {
    const configResponse = await syncthingService.getConfig({}, null);
    if (!configResponse || configResponse.status !== 'success') return;
    const folder = configResponse.data.folders?.find((f) => f.id === folderId);
    if (!folder) return;
    // eslint-disable-next-line no-restricted-syntax
    for (const device of folder.devices || []) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.systemPause({ params: { device: device.deviceID }, query: {} }, null);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(OPERATION_DELAY_MS);
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.systemResume({ params: { device: device.deviceID }, query: {} }, null);
      } catch (error) {
        log.warn(`nudgeFolderDevices - ${folderId}: pause/resume of device ${device.deviceID.substring(0, 7)} failed: ${error.message}`);
      }
    }
  } catch (error) {
    log.warn(`nudgeFolderDevices - ${folderId}: ${error.message}`);
  }
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
    localSocketAddr,
    containerDataFlags,
    appDockerRestartFn,
    syncthingFolder,
  } = params;

  log.info(`handleReceiveOnlyTransition - ${appId} in cache and not restarted, processing receive-only logic`);

  // Designated-leader election, debounced: require leadership to hold for
  // LEADER_CONFIRM_COUNT consecutive cycles, so a single transient peer-visibility
  // blip doesn't flip a follower to leader. (The stall ladder below never stops the
  // container before its atomic removal decision, so leadership needs no recovery
  // suppression - a confirmed leader simply starts; that is the cold-start fallback.)
  const electedLeader = isDesignatedLeader(runningAppList, localSocketAddr);
  cache.leaderStreak = electedLeader ? (cache.leaderStreak || 0) + 1 : 0;
  const isLeader = electedLeader && cache.leaderStreak >= LEADER_CONFIRM_COUNT;

  // KNOWN LIMITATION (pre-existing, intentionally not addressed here): the designated
  // leader is the cold-start seed source, so it starts and flips to sendreceive WITHOUT
  // a sync check - it cannot verify against a source because it IS the source. If a node
  // holding stale or empty data wins leadership on a multi-node app, it seeds that
  // version as authoritative and can overwrite newer data on peers. The leader-streak
  // debounce and the recovery guard reduce transient mis-elections but are not a data
  // check. Closing this requires data-aware leader selection (the deterministic election
  // here for r:, FDM for g:) - a separate change, out of scope for the reconciler work.
  if (isLeader) {
    log.info(`handleReceiveOnlyTransition - ${appId} is the designated leader (elected from ${runningAppList.length} peers, confirmed ${cache.leaderStreak}x), starting immediately`);

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
    cache.statusUnreadableSince = null; // status readable again - reset the unreadable timer

    log.info(
      `handleReceiveOnlyTransition - ${appId} sync status: ${syncStatus.syncPercentage.toFixed(2)}% `
      + `(${syncStatus.inSyncBytes}/${syncStatus.globalBytes} bytes), `
      + `state: ${syncStatus.state}, executions: ${cache.numberOfExecutions}`,
    );

    // Synced -> candidate for sendreceive. But completion metrics only count CLUSTER
    // data: local additions in a receiveonly folder leave needBytes 0 / completion 100,
    // and promoting would broadcast those local changes cluster-wide. Verify the folder
    // is clean first; if not, revert the local changes (db/revert undoes local edits in
    // a receiveonly folder) and promote on a later cycle once verifiably clean. The
    // leader path above is exempt by design - the leader's local data IS the seed.
    if (syncStatus.isSynced && syncStatus.receiveOnlyChangedFiles > 0) {
      log.warn(`handleReceiveOnlyTransition - ${appId} is synced but the receive-only folder has ${syncStatus.receiveOnlyChangedFiles} locally changed item(s); reverting local changes instead of promoting (promotion would propagate them to the cluster)`);
      try {
        await syncthingService.dbRevert(appId);
      } catch (error) {
        log.error(`handleReceiveOnlyTransition - revert of local changes for ${appId} failed: ${error.message}`);
      }
      return { syncthingFolder, cache };
    }
    if (syncStatus.isSynced) {
      log.info(`handleReceiveOnlyTransition - ${appId} is synced (${syncStatus.syncPercentage.toFixed(2)}%), switching to sendreceive`);
      await fixAppdataPermissions(appId);
      syncthingFolder.type = 'sendreceive';
      if (containerDataFlags.includes('r')) {
        log.info(`handleReceiveOnlyTransition - starting ${appId}`);
        await appDockerRestartFn(appId);
      }
      cache.restarted = true;
      return { syncthingFolder, cache };
    }

    // Not synced. We must NEVER start on unsynced data: going sendreceive would
    // propagate an inconsistent state to peers. While bytes are moving (block-
    // granular accounting) or the folder state is active (e.g. a long
    // sync-preparing phase), syncthing is working - wait. Flat bytes while idle
    // means no blocks are arriving; the causes need DIFFERENT responses:
    //   - no CONNECTED synced source (offline source, partition): wait - syncthing
    //     resumes by itself when the source returns; acting destroys a healthy copy.
    //   - source available but the puller is dormant (failed-pull retry backoff up
    //     to ~1h, or the inert no-retry state): nudge - device pause/resume forces
    //     a reconnect + index re-exchange, which re-arms the puller in seconds.
    //   - sustained evidence (connected synced source, repeated nudges over a
    //     minimum window, zero progress): this node provably cannot ingest the
    //     data - remove locally, the data is preserved on the synced peer.
    const now = Date.now();
    if (cache.lastProgressBytes === undefined || syncStatus.inSyncBytes !== cache.lastProgressBytes) {
      cache.lastProgressBytes = syncStatus.inSyncBytes;
      cache.lastProgressAt = now;
      cache.nudgeCount = 0;
      cache.evidenceSince = null;
      return { syncthingFolder, cache };
    }

    if (ACTIVE_FOLDER_STATES.includes(syncStatus.state)) {
      return { syncthingFolder, cache };
    }

    if (now - cache.lastProgressAt < STALL_NUDGE_AFTER_MS) {
      return { syncthingFolder, cache };
    }

    const peersAreSynced = await checkIfPeersAreSynced(appId);
    if (!peersAreSynced) {
      log.warn(`handleReceiveOnlyTransition - ${appId} idle with no sync progress and no CONNECTED synced peer; waiting (syncthing auto-resumes when a source returns)`);
      return { syncthingFolder, cache };
    }

    cache.evidenceSince = cache.evidenceSince || now;
    const nudgeCount = cache.nudgeCount || 0;
    const nudgeInterval = Math.min(STALL_NUDGE_AFTER_MS * 2 ** nudgeCount, STALL_NUDGE_MAX_INTERVAL_MS);
    const nudgeDue = !cache.lastNudgeAt || now - cache.lastNudgeAt >= nudgeInterval;
    if (!nudgeDue) {
      return { syncthingFolder, cache };
    }

    if (nudgeCount >= STALL_REMOVE_MIN_NUDGES && now - cache.evidenceSince >= STALL_REMOVE_MIN_WINDOW_MS) {
      log.error(`handleReceiveOnlyTransition - ${appId}: ${nudgeCount} nudges over ${Math.round((now - cache.evidenceSince) / 60000)}m with zero progress and a connected synced peer; this node cannot ingest the data - removing locally (data preserved on peers)`);
      // the whole app, by its bare main name: a component identifier here routes
      // removeAppLocally into a component-scoped removal that leaves the app's
      // installed-DB row behind (still broadcast as running, never re-evaluated)
      const mainAppName = appId.split('_')[1] || appId;
      try {
        await appUninstaller.removeAppLocally(mainAppName, null, true, false, true);
      } catch (error) {
        log.error(`handleReceiveOnlyTransition - Failed to remove ${mainAppName}: ${error.message}`);
      }
      cache.restarted = true;
      return { syncthingFolder, cache };
    }

    log.warn(`handleReceiveOnlyTransition - ${appId} idle with no sync progress for ${Math.round((now - cache.lastProgressAt) / 60000)}m and a connected synced peer; nudging the folder devices (pause/resume #${nudgeCount + 1})`);
    await nudgeFolderDevices(appId);
    cache.nudgeCount = nudgeCount + 1;
    cache.lastNudgeAt = now;
    return { syncthingFolder, cache };
  } else {
    // Could not read the folder's sync status, so we can verify NOTHING - neither
    // that the local data is synced nor that any peer holds it. Never start on
    // unverified data, and never remove without positive evidence either: removal
    // justified by blindness would delete a possibly-good copy. Alert and wait -
    // an operator, or recovery of the status endpoint, resolves it.
    cache.statusUnreadableSince = cache.statusUnreadableSince || Date.now();
    const unreadableMs = Date.now() - cache.statusUnreadableSince;
    log.warn(`handleReceiveOnlyTransition - ${appId} sync status unreadable for ${Math.round(unreadableMs / 60000)}m; staying receiveonly (will not start on unverified data, will not remove without evidence)`);
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
      log.info(`ensureContainerRunning - ${appId} is not running, requesting start`);
      appReconciler.setControllerDesired(appId, 'running', 'syncthing r: ensure-running');
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
    localSocketAddr,
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
      localSocketAddr,
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
  nudgeFolderDevices,
};
