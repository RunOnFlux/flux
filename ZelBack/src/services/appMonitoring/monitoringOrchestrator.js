// Monitoring Orchestrator - Functions to start/stop monitoring and handle API endpoints
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const appInspector = require('../appManagement/appInspector');
const bandwidthMonitor = require('./bandwidthMonitor');
const log = require('../../lib/log');

// Lazy load to avoid circular dependencies
let globalStateRef = null;
let appQueryServiceRef = null;

function getGlobalState() {
  if (!globalStateRef) {
    // eslint-disable-next-line global-require
    globalStateRef = require('../utils/globalState');
  }
  return globalStateRef;
}

function getAppQueryService() {
  if (!appQueryServiceRef) {
    // eslint-disable-next-line global-require
    appQueryServiceRef = require('../appQuery/appQueryService');
  }
  return appQueryServiceRef;
}

/**
 * Start monitoring multiple applications
 * @param {Array} appSpecsToMonitor - Array of app specifications to monitor
 * @param {object} appsMonitored - Apps monitored structure from appsService
 * @param {Function} installedAppsFn - Function to get installed apps
 * @returns {Promise<object>} Result of monitoring start
 */
async function startMonitoringOfApps(appSpecsToMonitor, appsMonitored, installedAppsFn) {
  try {
    let apps = appSpecsToMonitor;
    if (!apps) {
      const installedAppsRes = await installedAppsFn();
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      apps = installedAppsRes.data;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        appInspector.startAppMonitoring(app.name, appsMonitored);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          appInspector.startAppMonitoring(monitoredName, appsMonitored);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Stop monitoring multiple applications
 * @param {Array} appSpecsToMonitor - Array of app specifications to stop monitoring
 * @param {boolean} deleteData - Whether to delete monitoring data
 * @param {object} appsMonitored - Apps monitored structure from appsService
 * @param {Function} installedAppsFn - Function to get installed apps
 * @returns {Promise<object>} Result of monitoring stop
 */
// eslint-disable-next-line default-param-last
async function stopMonitoringOfApps(appSpecsToMonitor, deleteData = false, appsMonitored, installedAppsFn) {
  try {
    let apps = appSpecsToMonitor;
    if (!apps) {
      const installedAppsRes = await installedAppsFn();
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      apps = installedAppsRes.data;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        appInspector.stopAppMonitoring(app.name, deleteData, appsMonitored);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          appInspector.stopAppMonitoring(monitoredName, deleteData, appsMonitored);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Start monitoring API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {object} appsMonitored - Apps monitored structure from appsService
 * @param {Function} installedAppsFn - Function to get installed apps
 * @returns {object} Message.
 */
async function startAppMonitoringAPI(req, res, appsMonitored, installedAppsFn) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      // Only flux team and node owner can monitor all apps
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res ? res.json(errMessage) : errMessage;
      }
      await stopMonitoringOfApps(null, false, appsMonitored, installedAppsFn);
      await startMonitoringOfApps(null, appsMonitored, installedAppsFn);
      const monitoringResponse = messageHelper.createSuccessMessage('Application monitoring started for all apps');
      return res ? res.json(monitoringResponse) : monitoringResponse;
    }
    const mainAppName = appname.split('_')[1] || appname;
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
    const installedAppsRes = await installedAppsFn(mainAppName);
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const apps = installedAppsRes.data;
    const appSpecs = apps[0];
    if (!appSpecs) {
      throw new Error(`Application ${mainAppName} is not installed`);
    }
    if (mainAppName === appname) {
      await stopMonitoringOfApps(null, false, appsMonitored, installedAppsFn);
      await startMonitoringOfApps([appSpecs], appsMonitored, installedAppsFn);
    } else { // component based or <= 3
      appInspector.stopAppMonitoring(appname, false, appsMonitored);
      appInspector.startAppMonitoring(appname, appsMonitored);
    }
    const monitoringResponse = messageHelper.createSuccessMessage(`Application monitoring started for ${appSpecs.name}`);
    return res ? res.json(monitoringResponse) : monitoringResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Stop monitoring API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {object} appsMonitored - Apps monitored structure from appsService
 * @param {Function} installedAppsFn - Function to get installed apps
 * @returns {object} Message.
 */
async function stopAppMonitoringAPI(req, res, appsMonitored, installedAppsFn) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { deletedata } = req.params;
    deletedata = deletedata || req.query.deletedata || false;
    deletedata = serviceHelper.ensureBoolean(deletedata);

    if (!appname) {
      // Only flux team and node owner can stop monitoring for all apps
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res ? res.json(errMessage) : errMessage;
      }
      await stopMonitoringOfApps(null, deletedata, appsMonitored, installedAppsFn);
      let successMessage = '';
      if (!deletedata) {
        successMessage = 'Application monitoring stopped for all apps. Existing monitoring data maintained.';
      } else {
        successMessage = 'Application monitoring stopped for all apps. Monitoring data deleted for all apps.';
      }
      const monitoringResponse = messageHelper.createSuccessMessage(successMessage);
      return res ? res.json(monitoringResponse) : monitoringResponse;
    }
    const mainAppName = appname.split('_')[1] || appname;
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
    let successMessage = '';
    if (mainAppName === appname) {
      // get appSpecs
      const installedAppsRes = await installedAppsFn(mainAppName);
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      const apps = installedAppsRes.data;
      const appSpecs = apps[0];
      if (!appSpecs) {
        throw new Error(`Application ${mainAppName} is not installed`);
      }
      await stopMonitoringOfApps([appSpecs], deletedata, appsMonitored, installedAppsFn);
    } else { // component based or <= 3
      appInspector.stopAppMonitoring(appname, deletedata, appsMonitored);
    }
    if (deletedata) {
      successMessage = `Application monitoring stopped and monitoring data deleted for ${appname}.`;
    } else {
      successMessage = `Application monitoring stopped for ${appname}. Existing monitoring data maintained.`;
    }
    const monitoringResponse = messageHelper.createSuccessMessage(successMessage);
    return res ? res.json(monitoringResponse) : monitoringResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Enhanced appMonitor function that uses the inspector module but adds the monitored data
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {object} appsMonitored - Apps monitored structure from appsService
 * @returns {object} Monitoring data.
 */
async function appMonitor(req, res, appsMonitored) {
  return appInspector.appMonitor(req, res, appsMonitored);
}

/**
 * Get bandwidth usage statistics for an application
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Bandwidth statistics.
 */
async function appBandwidth(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const globalState = getGlobalState();
    const appsMonitored = globalState.appsMonitored;
    const bandwidthStats = bandwidthMonitor.getAppBandwidthStats(appname, appsMonitored);

    if (!bandwidthStats.available) {
      const response = messageHelper.createErrorMessage(bandwidthStats.message || 'No bandwidth data available');
      return res ? res.json(response) : response;
    }

    const response = messageHelper.createDataMessage(bandwidthStats);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Get bandwidth throttle status for all applications (Flux team only)
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Throttle status.
 */
async function appBandwidthStatus(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('fluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const appQueryService = getAppQueryService();
    const throttleStatus = bandwidthMonitor.getBandwidthThrottleStatus();
    const fairShareInfo = await bandwidthMonitor.getFairShareBandwidth(appQueryService.installedApps);
    const nodeBandwidth = await bandwidthMonitor.getNodeBandwidth();

    const response = messageHelper.createDataMessage({
      nodeBandwidth,
      fairShare: fairShareInfo,
      ...throttleStatus,
    });
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Clean up bandwidth monitoring data for an app (called when app is removed)
 * @param {string} appName - Application name
 * @param {number} version - App version
 * @param {Array} compose - App compose array (for v4+ apps)
 */
async function cleanupAppBandwidth(appName, version, compose) {
  try {
    if (version <= 3) {
      await bandwidthMonitor.cleanupContainerBandwidth(appName);
    } else if (compose) {
      // eslint-disable-next-line no-restricted-syntax
      for (const component of compose) {
        const containerName = `${component.name}_${appName}`;
        // eslint-disable-next-line no-await-in-loop
        await bandwidthMonitor.cleanupContainerBandwidth(containerName);
      }
    }
  } catch (error) {
    log.error(`Error cleaning up bandwidth for ${appName}: ${error.message}`);
  }
}

module.exports = {
  startMonitoringOfApps,
  stopMonitoringOfApps,
  startAppMonitoringAPI,
  stopAppMonitoringAPI,
  appMonitor,
  appBandwidth,
  appBandwidthStatus,
  cleanupAppBandwidth,
  // Re-export bandwidth monitor functions for direct access
  bandwidthMonitor,
};
