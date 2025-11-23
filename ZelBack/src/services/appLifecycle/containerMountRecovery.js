/**
 * Container Mount Recovery Service
 *
 * This module handles the recovery of Flux applications when containers start
 * before their mounts are properly set up. This can happen after OS restarts
 * when Docker auto-starts containers before FluxOS creates volume mounts.
 * The service detects containers that started before their mounts existed
 * and restarts only those affected containers.
 */

const fs = require('fs').promises;
const log = require('../../lib/log');
const dockerService = require('../dockerService');
const serviceHelper = require('../serviceHelper');

/**
 * Check if a container started before its mounts were created
 * @param {string} containerName - Name of the container to check
 * @returns {Promise<boolean>} True if container started before mounts existed
 */
async function containerStartedBeforeMounts(containerName) {
  try {
    // Inspect the container to get start time and mounts
    const containerInfo = await dockerService.dockerContainerInspect(containerName);

    // Get container start time
    const startedAt = new Date(containerInfo.State.StartedAt);

    if (!containerInfo.State.Running) {
      // Container not running, no need to check
      return false;
    }

    // Get all mounts for this container
    const mounts = containerInfo.Mounts || [];

    if (mounts.length === 0) {
      // No mounts, no issue
      return false;
    }

    // Check each mount's creation time
    // eslint-disable-next-line no-restricted-syntax
    for (const mount of mounts) {
      try {
        // Get the host path (source) of the mount
        const mountPath = mount.Source;

        if (!mountPath) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // Get filesystem stats for the mount directory
        // eslint-disable-next-line no-await-in-loop
        const stats = await fs.stat(mountPath);

        // Use the earliest time available (birthtime or mtime)
        // birthtime is creation time (may not be available on all filesystems)
        // mtime is modification time (fallback)
        const mountCreationTime = stats.birthtime || stats.mtime;

        // If container started before mount was created, it needs restart
        if (startedAt < mountCreationTime) {
          log.info(
            `containerMountRecovery - Container ${containerName} started at ${startedAt.toISOString()} `
            + `before mount ${mountPath} was created at ${mountCreationTime.toISOString()}`,
          );
          return true;
        }
      } catch (statError) {
        // Mount path might not exist or be inaccessible
        log.warn(`containerMountRecovery - Could not check mount ${mount.Source} for ${containerName}: ${statError.message}`);
        // If mount doesn't exist but container is running, that's a problem
        return true;
      }
    }

    return false;
  } catch (error) {
    log.error(`containerMountRecovery - Error checking container ${containerName}: ${error.message}`);
    // On error, don't restart to be safe
    return false;
  }
}

/**
 * Get Flux containers that need restart (started before mounts were created)
 * @returns {Promise<Array>} Array of container info objects that need restart
 */
async function getContainersNeedingRestart() {
  try {
    // Get all running containers
    const containers = await dockerService.dockerListContainers(false);

    if (!containers || containers.length === 0) {
      log.info('containerMountRecovery - No running containers found');
      return [];
    }

    // Filter for Flux app containers
    const fluxContainers = containers.filter((container) => {
      const name = container.Names && container.Names[0] ? container.Names[0] : '';
      // Flux containers start with /flux or /zel
      return name.startsWith('/flux') || name.startsWith('/zel');
    });

    log.info(`containerMountRecovery - Found ${fluxContainers.length} running Flux containers, checking which need restart`);

    // Check each container to see if it started before its mounts
    const containersNeedingRestart = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const container of fluxContainers) {
      const containerName = container.Names[0].replace(/^\//, ''); // Remove leading slash

      try {
        // eslint-disable-next-line no-await-in-loop
        const needsRestart = await containerStartedBeforeMounts(containerName);

        if (needsRestart) {
          containersNeedingRestart.push({
            id: container.Id,
            name: containerName,
          });
          log.info(`containerMountRecovery - Container ${containerName} needs restart (started before mounts)`);
        } else {
          log.info(`containerMountRecovery - Container ${containerName} is OK (started after mounts)`);
        }
      } catch (error) {
        log.error(`containerMountRecovery - Error checking container ${containerName}: ${error.message}`);
        // Skip this container on error
      }
    }

    log.info(`containerMountRecovery - ${containersNeedingRestart.length} containers need restart`);
    return containersNeedingRestart;
  } catch (error) {
    log.error(`containerMountRecovery - Error getting containers needing restart: ${error.message}`);
    return [];
  }
}

/**
 * Restart Flux containers to ensure proper mount setup
 * @param {Array} containers - Array of container info objects to restart
 * @returns {Promise<Object>} Results of restart operations
 */
async function restartContainersWithProperMounts(containers) {
  const results = {
    restarted: [],
    failed: [],
  };

  if (!containers || containers.length === 0) {
    log.info('containerMountRecovery - No containers to restart');
    return results;
  }

  log.info(`containerMountRecovery - Attempting to restart ${containers.length} containers with proper mounts`);

  // eslint-disable-next-line no-restricted-syntax
  for (const container of containers) {
    try {
      log.info(`containerMountRecovery - Restarting container ${container.name} to ensure proper mounts`);
      // eslint-disable-next-line no-await-in-loop
      await dockerService.appDockerRestart(container.name);
      results.restarted.push(container.name);
      log.info(`containerMountRecovery - Successfully restarted ${container.name}`);

      // Add small delay between restarts to avoid overwhelming the system
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(2000);
    } catch (error) {
      log.error(`containerMountRecovery - Failed to restart container ${container.name}: ${error.message}`);
      results.failed.push({
        name: container.name,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Main recovery function - restarts containers that started before their mounts
 * This should be called during FluxOS startup, after crontab and mounts cleanup
 * @returns {Promise<Object>} Recovery results
 */
async function performContainerMountRecovery() {
  const recoveryResults = {
    containersChecked: 0,
    containersNeedingRestart: 0,
    restartResults: null,
  };

  try {
    log.info('containerMountRecovery - Starting mount timing recovery check');

    // Get containers that started before their mounts were created
    const containersToRestart = await getContainersNeedingRestart();
    recoveryResults.containersNeedingRestart = containersToRestart.length;

    if (containersToRestart.length === 0) {
      log.info('containerMountRecovery - No containers need restart, recovery complete');
      return recoveryResults;
    }

    log.info(`containerMountRecovery - Found ${containersToRestart.length} containers that need restart`);

    // Restart containers that started before their mounts
    const restartResults = await restartContainersWithProperMounts(containersToRestart);
    recoveryResults.restartResults = restartResults;

    log.info(
      'containerMountRecovery - Recovery complete. '
      + `Restarted: ${restartResults.restarted.length}, `
      + `Failed: ${restartResults.failed.length}`,
    );

    return recoveryResults;
  } catch (error) {
    log.error(`containerMountRecovery - Critical error during recovery: ${error.message}`);
    throw error;
  }
}

module.exports = {
  performContainerMountRecovery,
  containerStartedBeforeMounts,
  getContainersNeedingRestart,
  restartContainersWithProperMounts,
};
