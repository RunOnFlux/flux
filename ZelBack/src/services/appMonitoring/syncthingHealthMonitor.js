// Syncthing Health Monitor - observes steady-state cluster sync health.
// It is a WATCHDOG, not an actuator: it alerts, and at most nudges a folder's
// devices (pause/resume forces a reconnect + index re-exchange, re-arming a
// dormant puller). It never stops containers (the reconciler owns container
// actuation - an unrecorded stop here is drift the reconciler immediately
// undoes), never restarts syncthing (node-wide collateral, fixes nothing a
// nudge doesn't - verified live), and never removes apps (removing a RUNNING
// app because peers are unreachable destroys the healthiest copy; rebalancing
// belongs to the election/reconciler designs, with evidence).
const log = require('../../lib/log');
const syncthingService = require('../syncthingService');
const { isPathMounted, nudgeFolderDevices } = require('./syncthingFolderStateMachine');
const { appsFolder } = require('../utils/appConstants');
const {
  HEALTH_NUDGE_THRESHOLD_MS,
  HEALTH_WARNING_THRESHOLD_MS,
} = require('./syncthingMonitorConstants');

/**
 * Health status for a folder
 * @typedef {Object} FolderHealthStatus
 * @property {number|null} isolatedSince - Timestamp when folder became isolated (no peers connected)
 * @property {number|null} cannotSyncSince - Timestamp when folder cannot sync
 * @property {number|null} peersBehindSince - Timestamp when peers have more data but not syncing
 * @property {number|null} lastHealthyTimestamp - Last time folder was healthy
 * @property {string} lastAction - Last action taken (none, warning, nudged)
 * @property {number|null} lastNudgeAt - Timestamp of the last device nudge
 */

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
      lastNudgeAt: null,
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
  healthStatus.lastNudgeAt = null;
  // Note: lastSyncPercentage and lastSyncProgressTime are NOT reset here
  // They track sync progress for stall detection and should persist across health checks
  /* eslint-enable no-param-reassign */
}

/**
 * Determine what action should be taken based on duration of issue.
 * 'nudge' is only meaningful when the folder has CONNECTED peers (nudgeable:
 * with everyone disconnected there is nothing to pause/resume - reconnection
 * is syncthing's own dialer's job, so we only alert and wait).
 * @param {number} issueSince - Timestamp when issue started
 * @param {string} currentAction - Current action status
 * @param {boolean} nudgeable - Whether a device nudge can help (connected peers)
 * @param {number|null} lastNudgeAt - Timestamp of the previous nudge
 * @returns {string} Action to take: 'none', 'warning', 'nudge'
 */
function determineAction(issueSince, currentAction, nudgeable, lastNudgeAt) {
  if (!issueSince) return 'none';

  const duration = Date.now() - issueSince;

  if (nudgeable && duration >= HEALTH_NUDGE_THRESHOLD_MS
    && (!lastNudgeAt || Date.now() - lastNudgeAt >= HEALTH_NUDGE_THRESHOLD_MS)) {
    return 'nudge';
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
 * @param {Object} params.state - Global state object
 * @param {Map} params.receiveOnlySyncthingAppsCache - Cache tracking app initialization state
 * @returns {Promise<Object>} Health monitoring results
 */
async function monitorFolderHealth(params) {
  const {
    foldersConfiguration,
    folderHealthCache,
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

      // Determine action based on longest-standing issue. A nudge only helps
      // when the folder has connected peers (it forces a reconnect + index
      // re-exchange on them); with everyone disconnected we only alert.
      const nudgeable = folderDiag.peerStatuses.some((peer) => peer.connected);
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
        const cannotSyncAction = determineAction(healthStatus.cannotSyncSince, healthStatus.lastAction, nudgeable, healthStatus.lastNudgeAt);
        if (cannotSyncAction !== 'none') {
          actionToTake = cannotSyncAction;
          issueType = 'cannot_sync';
        }
      }

      if (healthStatus.peersBehindSince) {
        const peersBehindAction = determineAction(healthStatus.peersBehindSince, healthStatus.lastAction, nudgeable, healthStatus.lastNudgeAt);
        if (peersBehindAction === 'nudge' || (peersBehindAction === 'warning' && actionToTake === 'none')) {
          actionToTake = peersBehindAction;
          issueType = 'peers_behind';
        }
      }

      let issueDuration = 0;
      if (healthStatus.cannotSyncSince) {
        issueDuration = (now - healthStatus.cannotSyncSince) / (60 * 1000);
      } else if (healthStatus.peersBehindSince) {
        issueDuration = (now - healthStatus.peersBehindSince) / (60 * 1000);
      }

      if (actionToTake === 'nudge') {
        log.warn(`monitorFolderHealth - NUDGING ${folderId} (device pause/resume) due to ${issueType} for ${issueDuration.toFixed(0)} minutes`);
        // eslint-disable-next-line no-await-in-loop
        await nudgeFolderDevices(folderId);
        healthStatus.lastAction = 'nudged';
        healthStatus.lastNudgeAt = now;
        results.actions.push({
          folderId,
          action: 'nudge',
          reason: issueType,
          durationMinutes: issueDuration,
        });
      } else if (actionToTake === 'warning' && healthStatus.lastAction === 'none') {
        log.warn(`monitorFolderHealth - WARNING: ${folderId} has ${issueType} issue for ${issueDuration.toFixed(0)} minutes`);
        healthStatus.lastAction = 'warning';
        results.actions.push({
          folderId,
          action: 'warning',
          reason: issueType,
          durationMinutes: issueDuration,
        });
      }

      // Reset health tracking once the folder is healthy again (nothing was
      // stopped, so there is nothing to start back up)
      if (!hasIssue) {
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
 * Get health summary for all monitored folders
 * @param {Map} folderHealthCache - Health cache
 * @returns {Object} Summary of folder health
 */
function getHealthSummary(folderHealthCache) {
  const summary = {
    totalFolders: folderHealthCache.size,
    healthy: 0,
    warning: 0,
    nudged: 0,
    issues: [],
  };

  folderHealthCache.forEach((status, folderId) => {
    if (status.lastAction === 'nudged') {
      summary.nudged += 1;
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
  getHealthSummary,
  getOrCreateHealthStatus,
  resetHealthStatus,
};
