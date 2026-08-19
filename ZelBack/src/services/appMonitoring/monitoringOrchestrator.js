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
  // leave the rest of them unthrottled. The same holds one level down: a composed
  // app's components are monitored independently, so one that cannot be started
  // must not take the components after it in the same compose with it. Catching per
  // app alone did exactly that, and named the app in the log rather than the
  // component that actually failed.
  //
  // The name is built INSIDE the try. A component that is null throws on
  // `component.name` before startAppMonitoring is ever reached, so a guard placed
  // any later would not see the case it exists for.
  // A monitored name is `<component>_<app>`, and startAppMonitoring only refuses a
  // FALSY one - so gluing two strings together always produces something it
  // accepts. A component with no name became `undefined_App`, a monitor armed
  // against a container that cannot exist: a timer, a store, and a sampler asking
  // docker about it once a minute, forever, with nothing to say it went wrong.
  // Both halves have to be real before there is anything worth monitoring.
  const startComponent = (app, component) => {
    try {
      const componentName = component?.name;
      if (typeof componentName !== 'string' || !componentName || !app.name) {
        log.error(`startMonitoringOfApps - skipping a component of ${app.name || '<unnamed app>'}: no usable name to monitor it under`);
        return;
      }
      appInspector.startAppMonitoring(`${componentName}_${app.name}`);
    } catch (error) {
      log.error(`startMonitoringOfApps - could not start monitoring ${component?.name}_${app.name}: ${error.message}`);
    }
  };

  // eslint-disable-next-line no-restricted-syntax
  for (const app of apps) {
    try {
      if (app.version <= 3) {
        appInspector.startAppMonitoring(app.name);
      } else if (!Array.isArray(app.compose)) {
        // for-of accepts anything iterable, and a STRING is iterable: a compose of
        // 'nope' walked its four characters and armed four monitors, none of which
        // named a container. A missing compose threw and was at least logged; a
        // malformed one was silent, which is the worse of the two.
        log.error(`startMonitoringOfApps - ${app.name} has no component list to monitor`);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          startComponent(app, component);
        }
      }
    } catch (error) {
      // Still needed for what is not one component's failure: a compose that is not
      // iterable at all, which no per-component catch can be reached to see.
      log.error(`startMonitoringOfApps - could not start monitoring ${app.name}: ${error.message}`);
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
  startAppMonitoringAPI,
  stopAppMonitoringAPI,
};
