/**
 * Post-Restart Recovery Service
 *
 * This module handles the recovery of Flux applications after an OS restart.
 * When the OS restarts, Docker may auto-start containers before FluxOS properly
 * sets up volume mounts. This service detects such scenarios and restarts
 * affected containers to ensure they have proper mount configurations.
 */

const os = require('os');
const log = require('../../lib/log');
const dockerService = require('../dockerService');
const serviceHelper = require('../serviceHelper');

/**
 * Check if this FluxOS startup is likely after an OS restart
 * @returns {Promise<boolean>} True if OS was recently restarted
 */
async function isOsRecentlyRestarted() {
  try {
    // Get system uptime in seconds
    const systemUptime = os.uptime();

    // Get FluxOS process uptime in seconds
    const fluxUptime = process.uptime();

    // If system uptime is less than 15 minutes and close to FluxOS uptime,
    // it's likely an OS restart
    const fifteenMinutes = 15 * 60;

    if (systemUptime < fifteenMinutes) {
      const uptimeDiff = Math.abs(systemUptime - fluxUptime);
      // If the difference is less than 5 minutes, consider it an OS restart
      if (uptimeDiff < 5 * 60) {
        log.info(`postRestartRecovery - OS restart detected. System uptime: ${systemUptime}s, FluxOS uptime: ${fluxUptime}s`);
        return true;
      }
    }

    return false;
  } catch (error) {
    log.error(`postRestartRecovery - Error checking OS restart: ${error.message}`);
    return false;
  }
}

/**
 * Get all running Flux application containers
 * @returns {Promise<Array>} Array of container info objects
 */
async function getRunningFluxContainers() {
  try {
    // Get all running containers
    const containers = await dockerService.dockerListContainers(false);

    if (!containers || containers.length === 0) {
      log.info('postRestartRecovery - No running containers found');
      return [];
    }

    // Filter for Flux app containers
    const fluxContainers = containers.filter((container) => {
      const name = container.Names && container.Names[0] ? container.Names[0] : '';
      // Flux containers start with /flux or /zel
      return name.startsWith('/flux') || name.startsWith('/zel');
    });

    log.info(`postRestartRecovery - Found ${fluxContainers.length} running Flux containers`);

    // Return all running Flux containers
    const runningFluxContainers = fluxContainers.map((container) => {
      const containerName = container.Names[0].replace(/^\//, ''); // Remove leading slash
      return {
        id: container.Id,
        name: containerName,
      };
    });

    return runningFluxContainers;
  } catch (error) {
    log.error(`postRestartRecovery - Error getting running Flux containers: ${error.message}`);
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
    log.info('postRestartRecovery - No containers to restart');
    return results;
  }

  log.info(`postRestartRecovery - Attempting to restart ${containers.length} containers with proper mounts`);

  // eslint-disable-next-line no-restricted-syntax
  for (const container of containers) {
    try {
      log.info(`postRestartRecovery - Restarting container ${container.name} to ensure proper mounts`);
      // eslint-disable-next-line no-await-in-loop
      await dockerService.appDockerRestart(container.name);
      results.restarted.push(container.name);
      log.info(`postRestartRecovery - Successfully restarted ${container.name}`);

      // Add small delay between restarts to avoid overwhelming the system
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(2000);
    } catch (error) {
      log.error(`postRestartRecovery - Failed to restart container ${container.name}: ${error.message}`);
      results.failed.push({
        name: container.name,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Main recovery function - checks for OS restart and restarts containers if needed
 * This should be called during FluxOS startup, after crontab and mounts cleanup
 * @returns {Promise<Object>} Recovery results
 */
async function performPostRestartRecovery() {
  const recoveryResults = {
    osRestartDetected: false,
    containersFound: 0,
    restartResults: null,
  };

  try {
    log.info('postRestartRecovery - Starting post-restart recovery check');

    // Check if this is an OS restart scenario
    const isOsRestart = await isOsRecentlyRestarted();
    recoveryResults.osRestartDetected = isOsRestart;

    if (!isOsRestart) {
      log.info('postRestartRecovery - No OS restart detected, skipping recovery');
      return recoveryResults;
    }

    log.info('postRestartRecovery - OS restart detected, checking for running containers');

    // Get all running Flux containers
    const containersToRestart = await getRunningFluxContainers();
    recoveryResults.containersFound = containersToRestart.length;

    if (containersToRestart.length === 0) {
      log.info('postRestartRecovery - No running containers found, recovery complete');
      return recoveryResults;
    }

    // Restart all containers to ensure proper mounts after OS restart
    const restartResults = await restartContainersWithProperMounts(containersToRestart);
    recoveryResults.restartResults = restartResults;

    log.info(
      'postRestartRecovery - Recovery complete. '
      + `Restarted: ${restartResults.restarted.length}, `
      + `Failed: ${restartResults.failed.length}`,
    );

    return recoveryResults;
  } catch (error) {
    log.error(`postRestartRecovery - Critical error during recovery: ${error.message}`);
    throw error;
  }
}

module.exports = {
  performPostRestartRecovery,
  isOsRecentlyRestarted,
  getRunningFluxContainers,
  restartContainersWithProperMounts,
};
