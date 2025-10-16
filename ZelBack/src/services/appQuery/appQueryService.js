// App Query Service - Query and information functions for installed apps
const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const registryManager = require('../appDatabase/registryManager');
const appConstants = require('../utils/appConstants');
const log = require('../../lib/log');

// Database collections
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

/**
 * To list installed apps. Returns apps from local database.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function installedApps(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    let appsQuery = {};
    if (req && req.params && req.query) {
      let { appname } = req.params;
      appname = appname || req.query.appname;
      if (appname) {
        appsQuery = { name: appname };
      }
    } else if (req && typeof req === 'string') {
      appsQuery = { name: req };
    }

    const appsProjection = {
      projection: { _id: 0 },
    };

    const apps = await dbHelper.findInDatabase(appsDatabase, appConstants.localAppsInformation, appsQuery, appsProjection);
    const dataResponse = messageHelper.createDataMessage(apps);
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
 * To list running apps.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listRunningApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(false);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].slice(1, 4) === 'zel' || app.Names[0].slice(1, 5) === 'flux'));
    }
    const modifiedApps = [];
    apps.forEach((app) => {
      delete app.HostConfig;
      delete app.NetworkSettings;
      delete app.Mounts;
      modifiedApps.push(app);
    });
    const appsResponse = messageHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
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
 * List all apps (both running and installed)
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listAllApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(true);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].slice(1, 4) === 'zel' || app.Names[0].slice(1, 5) === 'flux'));
    }
    const modifiedApps = [];
    apps.forEach((app) => {
      // eslint-disable-next-line no-param-reassign
      delete app.HostConfig;
      // eslint-disable-next-line no-param-reassign
      delete app.NetworkSettings;
      // eslint-disable-next-line no-param-reassign
      delete app.Mounts;
      modifiedApps.push(app);
    });
    const appsResponse = messageHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
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
 * To get latest application specification API version.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getlatestApplicationSpecificationAPI(req, res) {
  const latestSpec = config.fluxapps.latestAppSpecification || 1;

  const message = messageHelper.createDataMessage(latestSpec);

  res.json(message);
}

/**
 * To get application original owner.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getApplicationOriginalOwner(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const projection = {
      projection: {
        _id: 0,
      },
    };
    log.info(`Searching register permanent messages for ${appname}`);
    const appsQuery = {
      'appSpecifications.name': appname,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
    const ownerResponse = messageHelper.createDataMessage(lastAppRegistration.appSpecifications.owner);
    res.json(ownerResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To get apps installing locations.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsInstallingLocations(req, res) {
  try {
    const results = await registryManager.appInstallingLocation();
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

module.exports = {
  installedApps,
  listRunningApps,
  listAllApps,
  getlatestApplicationSpecificationAPI,
  getApplicationOriginalOwner,
  getAppsInstallingLocations,
};
