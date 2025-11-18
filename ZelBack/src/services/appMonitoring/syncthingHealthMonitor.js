// Syncthing Health Monitor - Monitors cluster health and takes corrective actions
const log = require('../../lib/log');
const syncthingService = require('../syncthingService');
const { isPathMounted } = require('./syncthingFolderStateMachine');
const { appsFolder } = require('../utils/appConstants');
const {
  HEALTH_STOP_THRESHOLD_MS,
  HEALTH_RESTART_SYNCTHING_THRESHOLD_MS,
  HEALTH_REMOVE_THRESHOLD_MS,
  HEALTH_WARNING_THRESHOLD_MS,
  // eslint-disable-next-line no-unused-vars
  HEALTH_PEERS_BEHIND_THRESHOLD_MS, // Reserved for future use with more granular peer-behind detection
} = require('./syncthingMonitorConstants');

/**
 * Health status for a folder
 * @typedef {Object} FolderHealthStatus
 * @property {number|null} isolatedSince - Timestamp when folder became isolated (no peers connected)
 * @property {number|null} cannotSyncSince - Timestamp when folder cannot sync
 * @property {number|null} peersBehindSince - Timestamp when peers have more data but not syncing
 * @property {number|null} lastHealthyTimestamp - Last time folder was healthy
 * @property {string} lastAction - Last action taken (none, warning, stopped, restarted_syncthing, removed)
 * @property {boolean} appWasStopped - Whether the app was stopped due to health issues (for auto-restart)
 */

/**
 * Extract app name from folderId
 * FolderIds are in format: fluxappname or fluxcomponent_appname
 * @param {string} folderId - Syncthing folder ID
 * @returns {string} App name
 */
function extractAppNameFromFolderId(folderId) {
  // Remove 'flux' prefix
  const withoutFlux = folderId.replace(/^flux/, '');

  // If contains underscore, it's a component: component_appname
  // We need the main app name (after the underscore)
  if (withoutFlux.includes('_')) {
    const parts = withoutFlux.split('_');
    // Return the app name (last part after component name)
    return parts.slice(1).join('_');
  }

  // Otherwise it's just the app name
  return withoutFlux;
}

/**
 * Get or create health status for a folder
 * @param {Map} folderHealthCache - Cache map for folder health
 * @param {string} folderId - Folder ID
 * @returns {FolderHealthStatus} Health status object
 */
function getOrCreateHealthStatus(folderHealthCache, folderId) {
  if (!folderHealthCache.has(folderId)) {
    folderHealthCache.set(folderId, {
      isolatedSince: null,
      cannotSyncSince: null,
      peersBehindSince: null,
      lastHealthyTimestamp: Date.now(),
      lastAction: 'none',
      appWasStopped: false,
      lastSyncPercentage: null, // Track sync progress for stall detection
    });
  }
  return folderHealthCache.get(folderId);
}

/**
 * Reset health status when folder becomes healthy again
 * @param {FolderHealthStatus} healthStatus - Health status object
 */
function resetHealthStatus(healthStatus) {
  /* eslint-disable no-param-reassign */
  healthStatus.isolatedSince = null;
  healthStatus.cannotSyncSince = null;
  healthStatus.peersBehindSince = null;
  healthStatus.lastHealthyTimestamp = Date.now();
  healthStatus.lastAction = 'none';
  healthStatus.appWasStopped = false;
  // Note: lastSyncPercentage and lastSyncProgressTime are NOT reset here
  // They track sync progress for stall detection and should persist across health checks
  /* eslint-enable no-param-reassign */
}

/**
 * Determine what action should be taken based on duration of issue
 * @param {number} issueSince - Timestamp when issue started
 * @param {string} currentAction - Current action status
 * @returns {string} Action to take: 'none', 'warning', 'stop', 'restart_syncthing', 'remove'
 */
function determineAction(issueSince, currentAction) {
  if (!issueSince) return 'none';

  const duration = Date.now() - issueSince;

  // Priority order: remove > restart_syncthing > stop > warning
  if (duration >= HEALTH_REMOVE_THRESHOLD_MS) {
    return 'remove';
  }
  if (duration >= HEALTH_RESTART_SYNCTHING_THRESHOLD_MS && currentAction !== 'restarted_syncthing' && currentAction !== 'removed') {
    return 'restart_syncthing';
  }
  if (duration >= HEALTH_STOP_THRESHOLD_MS && currentAction !== 'stopped' && currentAction !== 'restarted_syncthing' && currentAction !== 'removed') {
    return 'stop';
  }
  if (duration >= HEALTH_WARNING_THRESHOLD_MS && currentAction === 'none') {
    return 'warning';
  }

  return 'none';
}

/**
 * Monitor folder health and take corrective actions
 * @param {Object} params - Parameters
 * @param {Array} params.foldersConfiguration - Array of folder configurations
 * @param {Map} params.folderHealthCache - Cache for health tracking
 * @param {Function} params.appDockerStopFn - Function to stop docker container
 * @param {Function} params.appDockerStartFn - Function to start docker container
 * @param {Function} params.removeAppLocallyFn - Function to remove app locally
 * @param {Object} params.state - Global state object
 * @param {Map} params.receiveOnlySyncthingAppsCache - Cache tracking app initialization state
 * @returns {Promise<Object>} Health monitoring results
 */
async function monitorFolderHealth(params) {
  const {
    foldersConfiguration,
    folderHealthCache,
    appDockerStopFn,
    appDockerStartFn,
    removeAppLocallyFn,
    state,
    receiveOnlySyncthingAppsCache,
  } = params;

  // Skip if other operations in progress
  if (state.installationInProgress || state.removalInProgress || state.softRedeployInProgress || state.hardRedeployInProgress) {
    log.info('monitorFolderHealth - Skipping health check, other operations in progress');
    return { checked: false, actions: [] };
  }

  // Skip if backup or restore in progress
  if ((state.backupInProgress && state.backupInProgress.length > 0) || (state.restoreInProgress && state.restoreInProgress.length > 0)) {
    log.info('monitorFolderHealth - Skipping health check, backup or restore in progress');
    return { checked: false, actions: [] };
  }

  const results = {
    checked: true,
    timestamp: Date.now(),
    actions: [],
    diagnostics: null,
    foldersHealthy: 0,
    foldersWithIssues: 0,
  };

  try {
    // Get peer sync diagnostics
    const diagnostics = await syncthingService.getPeerSyncDiagnostics();
    results.diagnostics = diagnostics;

    if (!diagnostics || !diagnostics.folders) {
      log.warn('monitorFolderHealth - Could not get peer sync diagnostics');
      return results;
    }

    // Check for global isolation (no peers connected at all)
    const isGloballyIsolated = diagnostics.summary.connectedPeers.length === 0 && diagnostics.summary.totalFolders > 0;
    if (isGloballyIsolated) {
      log.warn(`monitorFolderHealth - Node is ISOLATED: No peers connected, ${diagnostics.summary.totalFolders} folders configured`);
    }

    // Track if Syncthing restart was already triggered in this execution to prevent multiple restarts
    let syncthingRestartTriggered = false;

    // Process each folder
    // eslint-disable-next-line no-restricted-syntax
    for (const folderConfig of foldersConfiguration) {
      const folderId = folderConfig.id;

      // Skip folders whose mounts are not ready
      const folderPath = `${appsFolder}${folderId}`;
      // eslint-disable-next-line no-await-in-loop
      const isMounted = await isPathMounted(folderPath);
      if (isMounted === false) {
        // Check if folder exists but not mounted (unmounted loop device)
        try {
          // eslint-disable-next-line no-await-in-loop
          const fs = require('node:fs');
          // eslint-disable-next-line no-await-in-loop
          const stats = await fs.promises.stat(folderPath);
          if (stats.isDirectory()) {
            log.warn(`monitorFolderHealth - Skipping ${folderId}, folder exists but not mounted yet`);
            // eslint-disable-next-line no-continue
            continue;
          }
        } catch (err) {
          // Folder doesn't exist - proceed with health check
        }
      }

      // Skip folders whose apps haven't completed their initial process
      // Note: receiveOnlySyncthingAppsCache is keyed by folderId (same as appId), not extracted app name
      if (receiveOnlySyncthingAppsCache) {
        const appCache = receiveOnlySyncthingAppsCache.get(folderId);
        if (!appCache || appCache.restarted !== true) {
          log.debug(`monitorFolderHealth - Skipping ${folderId}, initial process not completed`);
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      const folderDiag = diagnostics.folders[folderId];

      if (!folderDiag) {
        log.warn(`monitorFolderHealth - No diagnostics for folder ${folderId}`);
        // eslint-disable-next-line no-continue
        continue;
      }

      const healthStatus = getOrCreateHealthStatus(folderHealthCache, folderId);
      const now = Date.now();

      // Check for various health issues
      let hasIssue = false;

      // Issue 0: Global isolation (no peers connected to syncthing at all)
      if (isGloballyIsolated) {
        if (!healthStatus.isolatedSince) {
          healthStatus.isolatedSince = now;
          log.warn(`monitorFolderHealth - Folder ${folderId} marked as isolated (node has no connected peers)`);
        }
        hasIssue = true;
      } else if (healthStatus.isolatedSince) {
        log.info(`monitorFolderHealth - Folder ${folderId} no longer isolated (peers connected)`);
        healthStatus.isolatedSince = null;
      }

      // Issue 1: Cannot sync (all peers disconnected for this folder)
      if (!folderDiag.canSync && folderDiag.peerStatuses.length > 0) {
        if (!healthStatus.cannotSyncSince) {
          healthStatus.cannotSyncSince = now;
          log.warn(`monitorFolderHealth - Folder ${folderId} cannot sync: ${folderDiag.issues.map((i) => i.message).join(', ')}`);
        }
        hasIssue = true;
      } else if (healthStatus.cannotSyncSince) {
        log.info(`monitorFolderHealth - Folder ${folderId} connectivity restored`);
        healthStatus.cannotSyncSince = null;
      }

      // Issue 2: Peers have more updated data but we're not syncing
      // Only flag as issue if NOT actively syncing (state is idle, scanning, etc.)
      // OR if syncing but stalled (percentage hasn't changed since last check)
      const folderState = folderDiag.localStatus?.state || 'unknown';
      const currentSyncPercentage = folderDiag.localStatus?.syncPercentage || 0;
      const isActivelySyncing = folderState === 'syncing' || folderState === 'sync-preparing';

      // Detect stalled sync by comparing with previous check
      let isSyncStalled = false;
      if (isActivelySyncing && folderDiag.peersAreMoreUpdated && currentSyncPercentage < 100) {
        // If percentage hasn't changed since last check, sync is stalled
        if (healthStatus.lastSyncPercentage !== null && currentSyncPercentage === healthStatus.lastSyncPercentage) {
          isSyncStalled = true;
          log.warn(`monitorFolderHealth - Folder ${folderId} sync appears STALLED: stuck at ${currentSyncPercentage.toFixed(2)}% (same as last check)`);
        }
      }

      // Always update the tracking for next comparison
      healthStatus.lastSyncPercentage = currentSyncPercentage;

      if (folderDiag.peersAreMoreUpdated && folderDiag.localStatus?.syncPercentage < 100 && (!isActivelySyncing || isSyncStalled)) {
        if (!healthStatus.peersBehindSince) {
          healthStatus.peersBehindSince = now;
          if (isSyncStalled) {
            log.warn(`monitorFolderHealth - Folder ${folderId} sync stalled (local: ${currentSyncPercentage.toFixed(2)}%, state: ${folderState})`);
          } else {
            log.warn(`monitorFolderHealth - Folder ${folderId} peers have more updated data but not syncing (local: ${currentSyncPercentage.toFixed(2)}%, state: ${folderState})`);
          }
        }
        hasIssue = true;
      } else if (healthStatus.peersBehindSince) {
        if (isActivelySyncing && !isSyncStalled) {
          log.info(`monitorFolderHealth - Folder ${folderId} is now actively syncing, clearing peers behind issue`);
        } else {
          log.info(`monitorFolderHealth - Folder ${folderId} sync caught up with peers`);
        }
        healthStatus.peersBehindSince = null;
      }

      // Determine action based on longest-standing issue
      let actionToTake = 'none';
      let issueType = '';

      // For isolatedSince, only log warnings but don't take stop/remove actions
      // Global isolation is too risky to act on automatically
      if (healthStatus.isolatedSince) {
        const isolatedDuration = (now - healthStatus.isolatedSince) / (60 * 1000);
        if (isolatedDuration >= HEALTH_WARNING_THRESHOLD_MS / (60 * 1000)) {
          log.warn(`monitorFolderHealth - Folder ${folderId} isolated for ${isolatedDuration.toFixed(0)} minutes (no action taken)`);
        }
        // Don't set actionToTake for isolation - just log
      }

      if (healthStatus.cannotSyncSince) {
        const cannotSyncAction = determineAction(healthStatus.cannotSyncSince, healthStatus.lastAction);
        if (cannotSyncAction !== 'none') {
          actionToTake = cannotSyncAction;
          issueType = 'cannot_sync';
        }
      }

      if (healthStatus.peersBehindSince) {
        const peersBehindAction = determineAction(healthStatus.peersBehindSince, healthStatus.lastAction);
        // Only escalate if this is a longer-standing issue
        if (peersBehindAction === 'remove' && actionToTake !== 'remove') {
          actionToTake = peersBehindAction;
          issueType = 'peers_behind';
        } else if (peersBehindAction === 'stop' && actionToTake !== 'remove' && actionToTake !== 'stop') {
          actionToTake = peersBehindAction;
          issueType = 'peers_behind';
        }
      }

      // Take action based on severity
      if (actionToTake === 'remove' && healthStatus.lastAction !== 'removed') {
        let issueDuration = 0;
        if (healthStatus.cannotSyncSince) {
          issueDuration = (now - healthStatus.cannotSyncSince) / (60 * 1000);
        } else if (healthStatus.peersBehindSince) {
          issueDuration = (now - healthStatus.peersBehindSince) / (60 * 1000);
        }

        // Extract app name from folderId (fluxappname -> appname)
        const appName = extractAppNameFromFolderId(folderId);
        log.error(`monitorFolderHealth - REMOVING app ${appName} (folder ${folderId}) due to ${issueType} for ${issueDuration.toFixed(0)} minutes`);

        try {
          // removeAppLocallyFn expects app name, not folderId
          // Also pass null for res, force=true to bypass checks, endResponse=false, sendMessage=false
          // eslint-disable-next-line no-await-in-loop
          await removeAppLocallyFn(appName, null, true, false, false);
          healthStatus.lastAction = 'removed';
          results.actions.push({
            folderId,
            appName,
            action: 'remove',
            reason: issueType,
            durationMinutes: issueDuration,
          });
        } catch (error) {
          log.error(`monitorFolderHealth - Failed to remove ${appName}: ${error.message}`);
        }
      } else if (actionToTake === 'stop' && healthStatus.lastAction !== 'stopped' && healthStatus.lastAction !== 'restarted_syncthing' && healthStatus.lastAction !== 'removed') {
        let issueDuration = 0;
        if (healthStatus.cannotSyncSince) {
          issueDuration = (now - healthStatus.cannotSyncSince) / (60 * 1000);
        } else if (healthStatus.peersBehindSince) {
          issueDuration = (now - healthStatus.peersBehindSince) / (60 * 1000);
        }

        log.warn(`monitorFolderHealth - STOPPING ${folderId} due to ${issueType} for ${issueDuration.toFixed(0)} minutes`);

        try {
          // eslint-disable-next-line no-await-in-loop
          await appDockerStopFn(folderId);
          healthStatus.lastAction = 'stopped';
          healthStatus.appWasStopped = true; // Track that we stopped the app for auto-restart later
          results.actions.push({
            folderId,
            action: 'stop',
            reason: issueType,
            durationMinutes: issueDuration,
          });
        } catch (error) {
          log.error(`monitorFolderHealth - Failed to stop ${folderId}: ${error.message}`);
        }
      } else if (actionToTake === 'restart_syncthing' && healthStatus.lastAction !== 'restarted_syncthing' && healthStatus.lastAction !== 'removed') {
        let issueDuration = 0;
        if (healthStatus.cannotSyncSince) {
          issueDuration = (now - healthStatus.cannotSyncSince) / (60 * 1000);
        } else if (healthStatus.peersBehindSince) {
          issueDuration = (now - healthStatus.peersBehindSince) / (60 * 1000);
        }

        // Only actually restart Syncthing once per execution, even if multiple folders need it
        if (!syncthingRestartTriggered) {
          log.warn(`monitorFolderHealth - RESTARTING SYNCTHING for ${folderId} due to ${issueType} for ${issueDuration.toFixed(0)} minutes`);

          try {
            // eslint-disable-next-line no-await-in-loop
            await syncthingService.systemRestart();
            syncthingRestartTriggered = true;
            healthStatus.lastAction = 'restarted_syncthing';
            results.actions.push({
              folderId,
              action: 'restart_syncthing',
              reason: issueType,
              durationMinutes: issueDuration,
            });
          } catch (error) {
            log.error(`monitorFolderHealth - Failed to restart syncthing for ${folderId}: ${error.message}`);
          }
        } else {
          // Syncthing already restarted in this execution, just mark this folder
          log.info(`monitorFolderHealth - Syncthing already restarted this cycle, marking ${folderId} as restarted`);
          healthStatus.lastAction = 'restarted_syncthing';
          results.actions.push({
            folderId,
            action: 'restart_syncthing_skipped',
            reason: issueType,
            durationMinutes: issueDuration,
          });
        }
      } else if (actionToTake === 'warning' && healthStatus.lastAction === 'none') {
        let issueDuration = 0;
        if (healthStatus.cannotSyncSince) {
          issueDuration = (now - healthStatus.cannotSyncSince) / (60 * 1000);
        } else if (healthStatus.peersBehindSince) {
          issueDuration = (now - healthStatus.peersBehindSince) / (60 * 1000);
        }

        log.warn(`monitorFolderHealth - WARNING: ${folderId} has ${issueType} issue for ${issueDuration.toFixed(0)} minutes`);
        healthStatus.lastAction = 'warning';
        results.actions.push({
          folderId,
          action: 'warning',
          reason: issueType,
          durationMinutes: issueDuration,
        });
      }

      // Reset health if no issues and restart app if it was stopped
      if (!hasIssue) {
        // If app was stopped due to health issues, restart it now that issues are resolved
        if (healthStatus.appWasStopped) {
          log.info(`monitorFolderHealth - Issues resolved for ${folderId}, restarting app`);
          try {
            // eslint-disable-next-line no-await-in-loop
            await appDockerStartFn(folderId);
            results.actions.push({
              folderId,
              action: 'restart_app',
              reason: 'issues_resolved',
              durationMinutes: 0,
            });
          } catch (error) {
            log.error(`monitorFolderHealth - Failed to restart app ${folderId}: ${error.message}`);
          }
        }
        resetHealthStatus(healthStatus);
        results.foldersHealthy += 1;
      } else {
        results.foldersWithIssues += 1;
      }

      // Update cache
      folderHealthCache.set(folderId, healthStatus);
    }

    // Clean up cache for folders that no longer exist
    // eslint-disable-next-line no-restricted-syntax
    for (const cacheKey of folderHealthCache.keys()) {
      const folderExists = foldersConfiguration.some((f) => f.id === cacheKey);
      if (!folderExists) {
        folderHealthCache.delete(cacheKey);
      }
    }

    log.info(`monitorFolderHealth - Health check complete: ${results.foldersHealthy} healthy, ${results.foldersWithIssues} with issues`);

    return results;
  } catch (error) {
    log.error(`monitorFolderHealth - Error: ${error.message}`);
    results.error = error.message;
    return results;
  }
}

/**
 * Check if a specific app/folder should be removed based on health status
 * This is a lighter check that can be called from other modules
 * Note: Does not consider isolatedSince as that only logs warnings
 * @param {string} folderId - Folder ID to check
 * @param {Map} folderHealthCache - Health cache
 * @returns {boolean} True if folder should be removed
 */
function shouldRemoveFolder(folderId, folderHealthCache) {
  const healthStatus = folderHealthCache.get(folderId);
  if (!healthStatus) return false;

  if (healthStatus.cannotSyncSince) {
    const duration = Date.now() - healthStatus.cannotSyncSince;
    if (duration >= HEALTH_REMOVE_THRESHOLD_MS) {
      return true;
    }
  }

  if (healthStatus.peersBehindSince) {
    const duration = Date.now() - healthStatus.peersBehindSince;
    if (duration >= HEALTH_REMOVE_THRESHOLD_MS) {
      return true;
    }
  }

  return false;
}

/**
 * Get health summary for all monitored folders
 * @param {Map} folderHealthCache - Health cache
 * @returns {Object} Summary of folder health
 */
function getHealthSummary(folderHealthCache) {
  const summary = {
    totalFolders: folderHealthCache.size,
    healthy: 0,
    warning: 0,
    stopped: 0,
    removed: 0,
    issues: [],
  };

  folderHealthCache.forEach((status, folderId) => {
    if (status.lastAction === 'removed') {
      summary.removed += 1;
    } else if (status.lastAction === 'stopped') {
      summary.stopped += 1;
    } else if (status.lastAction === 'warning') {
      summary.warning += 1;
    } else if (!status.isolatedSince && !status.cannotSyncSince && !status.peersBehindSince) {
      summary.healthy += 1;
    }

    if (status.isolatedSince || status.cannotSyncSince || status.peersBehindSince) {
      summary.issues.push({
        folderId,
        isolatedSince: status.isolatedSince,
        cannotSyncSince: status.cannotSyncSince,
        peersBehindSince: status.peersBehindSince,
        lastAction: status.lastAction,
      });
    }
  });

  return summary;
}

module.exports = {
  monitorFolderHealth,
  shouldRemoveFolder,
  getHealthSummary,
  getOrCreateHealthStatus,
  resetHealthStatus,
  extractAppNameFromFolderId,
};
