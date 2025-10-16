// Resource Query Service - Query functions for app and node resource usage
const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const registryManager = require('../appDatabase/registryManager');
const hwRequirements = require('../appRequirements/hwRequirements');
const appConstants = require('../utils/appConstants');
const log = require('../../lib/log');

// Import appQueryService to avoid circular dependency (will be cleaned up later)
const appQueryService = require('./appQueryService');

/**
 * Get application usage statistics
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function fluxUsage(req, res) {
  try {
    const apps = await registryManager.getInstalledApps();
    const totalApps = apps.length;
    const runningApps = await appQueryService.listRunningApps();
    const totalRunning = runningApps.data ? runningApps.data.length : 0;

    // Ensure node specs are loaded before accessing them
    const nodeSpecs = await hwRequirements.getNodeSpecs();

    const usage = {
      totalApps,
      runningApps: totalRunning,
      stoppedApps: totalApps - totalRunning,
      nodeSpecs,
    };

    const dataResponse = messageHelper.createDataMessage(usage);
    return res ? res.json(dataResponse) : dataResponse;
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
 * Get apps resource usage
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function appsResources(req, res) {
  log.info('Checking appsResources');
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {};
    const appsProjection = { projection: { _id: 0 } };
    const appsResult = await dbHelper.findInDatabase(appsDatabase, appConstants.localAppsInformation, appsQuery, appsProjection);
    let appsCpusLocked = 0;
    let appsRamLocked = 0;
    let appsHddLocked = 0;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    const hddTier = `hdd${tier}`;
    const ramTier = `ram${tier}`;
    const cpuTier = `cpu${tier}`;

    // Ensure appsResult is an array
    const apps = Array.isArray(appsResult) ? appsResult : [];
    apps.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((component) => {
          if (component.tiered && tier) {
            appsCpusLocked += serviceHelper.ensureNumber(component[cpuTier] || component.cpu) || 0;
            appsRamLocked += serviceHelper.ensureNumber(component[ramTier] || component.ram) || 0;
            appsHddLocked += serviceHelper.ensureNumber(component[hddTier] || component.hdd) || 0;
          } else {
            appsCpusLocked += serviceHelper.ensureNumber(component.cpu) || 0;
            appsRamLocked += serviceHelper.ensureNumber(component.ram) || 0;
            appsHddLocked += serviceHelper.ensureNumber(component.hdd) || 0;
          }
          appsHddLocked += config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // 5gb per component + 2gb swap
        });
      } else if (app.tiered && tier) {
        appsCpusLocked += serviceHelper.ensureNumber(app[cpuTier] || app.cpu) || 0;
        appsRamLocked += serviceHelper.ensureNumber(app[ramTier] || app.ram) || 0;
        appsHddLocked += serviceHelper.ensureNumber(app[hddTier] || app.hdd) || 0;
        appsHddLocked += config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // 5gb per component + 2gb swap
      } else {
        appsCpusLocked += serviceHelper.ensureNumber(app.cpu) || 0;
        appsRamLocked += serviceHelper.ensureNumber(app.ram) || 0;
        appsHddLocked += serviceHelper.ensureNumber(app.hdd) || 0;
        appsHddLocked += config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // 5gb per component + 2gb swap
      }
    });
    const appsUsage = {
      appsCpusLocked,
      appsRamLocked,
      appsHddLocked,
    };
    const response = messageHelper.createDataMessage(appsUsage);
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

module.exports = {
  fluxUsage,
  appsResources,
};
