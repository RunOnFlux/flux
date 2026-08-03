// Monitoring Orchestrator - Functions to start/stop monitoring and handle API endpoints
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const appInspector = require('../appManagement/appInspector');
const appQueryService = require('../appQuery/appQueryService');
const log = require('../../lib/log');

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
  try {
    const apps = await resolveAppSpecs(appSpecsToMonitor);

    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        appInspector.startAppMonitoring(app.name);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          appInspector.startAppMonitoring(monitoredName);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Stop monitoring multiple applications
 * @param {Array} appSpecsToMonitor - Array of app specifications to stop monitoring, or null for every installed app
 * @param {boolean} deleteData - Whether to delete monitoring data
 * @returns {Promise<void>}
 */
async function stopMonitoringOfApps(appSpecsToMonitor, deleteData = false) {
  try {
    const apps = await resolveAppSpecs(appSpecsToMonitor);

    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        appInspector.stopAppMonitoring(app.name, deleteData);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          appInspector.stopAppMonitoring(monitoredName, deleteData);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Look up the installed specifications for an application
 * @param {string} mainAppName - Application name without a component prefix
 * @returns {Promise<object>} App specifications
 */
async function installedAppSpecs(mainAppName) {
  const installedAppsRes = await appQueryService.installedApps(mainAppName);
  if (installedAppsRes.status !== 'success') {
    throw new Error('Failed to get installed Apps');
  }
  const appSpecs = installedAppsRes.data[0];
  if (!appSpecs) {
    throw new Error(`Application ${mainAppName} is not installed`);
  }
  return appSpecs;
}

/**
 * Start monitoring an application, or every installed application
 * @param {string} [appname] - Application name, optionally component-qualified. Omit for every app.
 * @returns {Promise<string>} Outcome description
 */
async function startMonitoring(appname) {
  if (!appname) {
    await stopMonitoringOfApps(null);
    await startMonitoringOfApps(null);
    return 'Application monitoring started for all apps';
  }

  const mainAppName = appname.split('_')[1] || appname;
  const appSpecs = await installedAppSpecs(mainAppName);

  if (mainAppName === appname) {
    await stopMonitoringOfApps(null);
    await startMonitoringOfApps([appSpecs]);
  } else { // component based or <= 3
    appInspector.stopAppMonitoring(appname, false);
    appInspector.startAppMonitoring(appname);
  }
  return `Application monitoring started for ${appSpecs.name}`;
}

/**
 * Stop monitoring an application, or every installed application
 * @param {string} [appname] - Application name, optionally component-qualified. Omit for every app.
 * @param {boolean} deleteData - Whether to delete monitoring data
 * @returns {Promise<string>} Outcome description
 */
async function stopMonitoring(appname, deleteData) {
  if (!appname) {
    await stopMonitoringOfApps(null, deleteData);
    return deleteData
      ? 'Application monitoring stopped for all apps. Monitoring data deleted for all apps.'
      : 'Application monitoring stopped for all apps. Existing monitoring data maintained.';
  }

  const mainAppName = appname.split('_')[1] || appname;
  if (mainAppName === appname) {
    await stopMonitoringOfApps([await installedAppSpecs(mainAppName)], deleteData);
  } else { // component based or <= 3
    appInspector.stopAppMonitoring(appname, deleteData);
  }
  return deleteData
    ? `Application monitoring stopped and monitoring data deleted for ${appname}.`
    : `Application monitoring stopped for ${appname}. Existing monitoring data maintained.`;
}

/**
 * Start monitoring API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startAppMonitoringAPI(req, res) {
  try {
    const appname = req.params.appname || req.query.appname;

    // Only flux team and node owner can monitor all apps
    const authorized = appname
      ? await verificationHelper.verifyPrivilege('appownerabove', req, appname.split('_')[1] || appname)
      : await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const monitoringResponse = messageHelper.createSuccessMessage(await startMonitoring(appname));
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
 * @returns {object} Message.
 */
async function stopAppMonitoringAPI(req, res) {
  try {
    const appname = req.params.appname || req.query.appname;
    const deleteData = serviceHelper.ensureBoolean(
      req.params.deletedata || req.query.deletedata || false,
    );

    // Only flux team and node owner can stop monitoring for all apps
    const authorized = appname
      ? await verificationHelper.verifyPrivilege('appownerabove', req, appname.split('_')[1] || appname)
      : await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const monitoringResponse = messageHelper.createSuccessMessage(await stopMonitoring(appname, deleteData));
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

module.exports = {
  startMonitoringOfApps,
  stopMonitoringOfApps,
  startMonitoring,
  stopMonitoring,
  startAppMonitoringAPI,
  stopAppMonitoringAPI,
};
