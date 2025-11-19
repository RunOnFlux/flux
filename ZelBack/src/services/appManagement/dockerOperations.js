/**
 * Docker Operations Module
 *
 * This module contains Docker-related helper functions for managing app containers.
 * These are internal operations that work directly with Docker containers and monitoring.
 */

const util = require('util');
const dockerService = require('../dockerService');
const log = require('../../lib/log');

const cmdAsync = util.promisify(require('child_process').exec);

// Import app constants
const { appsFolder } = require('../utils/appConstants');

/**
 * Stop a Docker container for a specific app (with monitoring integration)
 * @param {string} appname - Application name or component name
 * @param {Function} stopMonitoringCallback - Callback function to stop app monitoring
 * @param {Map} appsMonitored - Map of currently monitored apps
 * @param {Function} getApplicationSpecifications - Function to get app specifications
 * @returns {Promise<void>}
 */
async function appDockerStop(appname, stopMonitoringCallback, appsMonitored, getApplicationSpecifications) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component stop. Proceed with stopping just component
    if (isComponent) {
      await dockerService.appDockerStop(appname);
      if (stopMonitoringCallback) {
        stopMonitoringCallback(appname, false, appsMonitored);
      }
    } else {
      // ask for stopping entire composed application
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerStop(appname);
        if (stopMonitoringCallback) {
          stopMonitoringCallback(appname, false, appsMonitored);
        }
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStop(`${appComponent.name}_${appSpecs.name}`);
          if (stopMonitoringCallback) {
            stopMonitoringCallback(`${appComponent.name}_${appSpecs.name}`, false, appsMonitored);
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Restart a Docker container for a specific app (with monitoring integration)
 * @param {string} appname - Application name or component name
 * @param {Function} startMonitoringCallback - Callback function to start app monitoring
 * @param {Map} appsMonitored - Map of currently monitored apps
 * @param {Function} getApplicationSpecifications - Function to get app specifications
 * @returns {Promise<void>}
 */
async function appDockerRestart(appname, startMonitoringCallback, appsMonitored, getApplicationSpecifications) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerRestart(appname);
      if (startMonitoringCallback) {
        startMonitoringCallback(appname, appsMonitored);
      }
    } else {
      // ask for restarting entire composed application
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerRestart(appname);
        if (startMonitoringCallback) {
          startMonitoringCallback(appname, appsMonitored);
        }
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerRestart(`${appComponent.name}_${appSpecs.name}`);
          if (startMonitoringCallback) {
            startMonitoringCallback(`${appComponent.name}_${appSpecs.name}`, appsMonitored);
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Delete all data in the mount point for a specific app
 * @param {string} appId - Application ID
 * @returns {Promise<void>}
 */
async function appDeleteDataInMountPoint(appId) {
  // Implementation for deleting app data in mount point
  try {
    const execDelete = `sudo rm -rf ${appsFolder}${appId}/appdata/*`;
    await cmdAsync(execDelete);
    log.info(`Deleted data for app ${appId}`);
  } catch (error) {
    log.error(`Error deleting data for app ${appId}: ${error.message}`);
  }
}

module.exports = {
  appDockerStop,
  appDockerRestart,
  appDeleteDataInMountPoint,
};
