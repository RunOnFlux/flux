// Monitoring Orchestrator - Functions to start/stop monitoring and handle API endpoints
const messageHelper = require('../messageHelper');
const appInspector = require('../appManagement/appInspector');
const appQueryService = require('../appQuery/appQueryService');
const log = require('../../lib/log');

// Monitoring is started by the node whenever a container comes up and feeds the CPU
// throttling loop, so it is not a setting an operator turns on or off. The routes stay
// so callers are told that rather than silently succeeding against a control that is
// gone; they go at the next major version.
const DEPRECATION_MESSAGE = 'Application monitoring is managed by the node and runs for every app. This endpoint no longer has any effect and will be removed.';

/**
 * Resolve the app specifications monitoring should act on
 * @param {Array} appSpecsToMonitor - Explicit specifications, or null for every installed app
 * @returns {Promise<Array>} App specifications
 */
async function resolveAppSpecs(appSpecsToMonitor) {
  if (appSpecsToMonitor) {
    return appSpecsToMonitor;
  }
  const installedAppsRes = await appQueryService.installedApps();
  if (installedAppsRes.status !== 'success') {
    throw new Error('Failed to get installed Apps');
  }
  return installedAppsRes.data;
}

/**
 * Start monitoring multiple applications
 * @param {Array} appSpecsToMonitor - Array of app specifications to monitor, or null for every installed app
 * @returns {Promise<void>}
 */
async function startMonitoringOfApps(appSpecsToMonitor) {
  const apps = await resolveAppSpecs(appSpecsToMonitor);

  // Monitoring drives CPU throttling, so one app that cannot be monitored must not
  // leave the rest of them unthrottled.
  // eslint-disable-next-line no-restricted-syntax
  for (const app of apps) {
    try {
      if (app.version <= 3) {
        appInspector.startAppMonitoring(app.name);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          appInspector.startAppMonitoring(monitoredName);
        }
      }
    } catch (error) {
      log.error(`startMonitoringOfApps - could not start monitoring ${app.name}: ${error.message}`);
    }
  }
}

/**
 * Stop monitoring multiple applications
 * @param {Array} appSpecsToMonitor - Array of app specifications to stop monitoring, or null for every installed app
 * @param {boolean} deleteData - Whether to delete monitoring data
 * @returns {Promise<void>}
 */
async function stopMonitoringOfApps(appSpecsToMonitor, deleteData = false) {
  const apps = await resolveAppSpecs(appSpecsToMonitor);

  // eslint-disable-next-line no-restricted-syntax
  for (const app of apps) {
    try {
      if (app.version <= 3) {
        appInspector.stopAppMonitoring(app.name, deleteData);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          appInspector.stopAppMonitoring(monitoredName, deleteData);
        }
      }
    } catch (error) {
      log.error(`stopMonitoringOfApps - could not stop monitoring ${app.name}: ${error.message}`);
    }
  }
}

/**
 * Start monitoring API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startAppMonitoringAPI(req, res) {
  const errMessage = messageHelper.createErrorMessage(DEPRECATION_MESSAGE, 'Deprecated', 410);
  return res ? res.json(errMessage) : errMessage;
}

/**
 * Stop monitoring API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function stopAppMonitoringAPI(req, res) {
  const errMessage = messageHelper.createErrorMessage(DEPRECATION_MESSAGE, 'Deprecated', 410);
  return res ? res.json(errMessage) : errMessage;
}

module.exports = {
  startMonitoringOfApps,
  stopMonitoringOfApps,
  startAppMonitoringAPI,
  stopAppMonitoringAPI,
};
