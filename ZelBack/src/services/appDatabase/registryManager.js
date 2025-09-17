const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const {
  globalAppsInformation,
  localAppsInformation,
  globalAppsMessages,
  globalAppsLocations,
  globalAppsInstallingLocations,
  appsHashesCollection,
} = require('../utils/appConstants');

/**
 * Get all app hashes from the blockchain
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<object>} List of app hashes
 */
async function getAppHashes(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        hash: 1,
        height: 1,
        value: 1,
        message: 1,
        messageNotFound: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    return res ? res.json(resultsResponse) : resultsResponse;
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
 * Get app location information
 * @param {string} appname - Optional app name filter
 * @returns {Promise<Array>} Array of app locations
 */
async function appLocation(appname) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') };
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
  return results;
}

/**
 * Get app installing locations
 * @param {string} appname - Optional app name filter
 * @returns {Promise<Array>} Array of installing locations
 */
async function appInstallingLocation(appname) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') };
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsInstallingLocations, query, projection);
  return results;
}

/**
 * Get all app locations via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppsLocations(req, res) {
  try {
    const results = await appLocation();
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

/**
 * Get specific app location via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppsLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appLocation(appname);
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

/**
 * Get specific app installing location via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppInstallingLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appInstallingLocation(appname);
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

/**
 * Get global app specifications for a specific app
 * @param {string} appName - Application name
 * @returns {Promise<object|null>} App specifications
 */
async function getApplicationGlobalSpecifications(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const dbAppSpec = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);

  // TODO: Add proper specification decryption and formatting
  let appSpec = dbAppSpec; // This would need checkAndDecryptAppSpecs and specificationFormatter
  return appSpec;
}

/**
 * Get local app specifications for a specific app
 * @param {string} appName - Application name
 * @returns {Promise<object|null>} App specifications
 */
async function getApplicationLocalSpecifications(appName) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appslocal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = { projection: { _id: 0 } };

  const appInfo = await dbHelper.findOneInDatabase(database, localAppsInformation, query, projection);
  return appInfo;
}

/**
 * Get app specifications (tries global first, then local)
 * @param {string} appName - Application name
 * @returns {Promise<object|null>} App specifications
 */
async function getApplicationSpecifications(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };

  let dbAppSpec = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);

  if (!dbAppSpec) {
    // Try local apps
    dbAppSpec = await getApplicationLocalSpecifications(appName);
  }

  return dbAppSpec;
}

/**
 * Get application specification via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getApplicationSpecificationAPI(req, res) {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }

    const { data: { height: daemonHeight } } = syncStatus;

    let { appname, decrypt } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    decrypt = req.query.decrypt || decrypt;

    const specifications = await getApplicationSpecifications(appname);
    const mainAppName = appname.split('_')[1] || appname;

    if (!specifications) {
      throw new Error('Application not found');
    }

    const isEnterprise = Boolean(
      specifications.version >= 8 && specifications.enterprise,
    );

    if (!decrypt) {
      const specificationsResponse = messageHelper.createDataMessage(specifications);
      return res.json(specificationsResponse);
    }

    // TODO: Add decryption logic for enterprise apps
    const specificationsResponse = messageHelper.createDataMessage(specifications);
    res.json(specificationsResponse);
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
 * Get application owner via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getApplicationOwnerAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const owner = await serviceHelper.getApplicationOwner(appname);
    if (!owner) {
      throw new Error('Application not found');
    }
    const ownerResponse = messageHelper.createDataMessage(owner);
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
 * Get global apps specifications via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getGlobalAppsSpecifications(req, res) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);
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

/**
 * Get available apps (both global and local)
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function availableApps(req, res) {
  try {
    // Get global apps
    const globalDb = dbHelper.databaseConnection();
    const globalDatabase = globalDb.db(config.database.appsglobal.database);
    const globalQuery = {};
    const globalProjection = { projection: { _id: 0 } };
    const globalApps = await dbHelper.findInDatabase(globalDatabase, globalAppsInformation, globalQuery, globalProjection);

    // Get local apps
    const localDb = dbHelper.databaseConnection();
    const localDatabase = localDb.db(config.database.appslocal.database);
    const localQuery = {};
    const localProjection = { projection: { _id: 0 } };
    const localApps = await dbHelper.findInDatabase(localDatabase, localAppsInformation, localQuery, localProjection);

    const allApps = [...globalApps, ...localApps];

    if (res) {
      const resultsResponse = messageHelper.createDataMessage(allApps);
      res.json(resultsResponse);
    } else {
      return allApps;
    }
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
 * Check for registration name conflicts
 * @param {object} appSpecFormatted - Application specifications
 * @param {string} hash - Application hash
 * @returns {Promise<boolean>} True if no conflicts found
 */
async function checkApplicationRegistrationNameConflicts(appSpecFormatted, hash) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const globalQuery = { name: new RegExp(`^${appSpecFormatted.name}$`, 'i') };
  const globalProjection = { projection: { _id: 0, hash: 1, name: 1, owner: 1 } };

  const globalAppResult = await dbHelper.findOneInDatabase(database, globalAppsInformation, globalQuery, globalProjection);

  if (globalAppResult) {
    if (globalAppResult.hash !== hash) {
      if (globalAppResult.owner !== appSpecFormatted.owner) {
        throw new Error(`Flux App ${appSpecFormatted.name} already registered and is owned by a different user.`);
      }
    }
  }

  // Check local apps as well
  const localDb = dbHelper.databaseConnection();
  const localDatabase = localDb.db(config.database.appslocal.database);
  const localQuery = { name: new RegExp(`^${appSpecFormatted.name}$`, 'i') };
  const localProjection = { projection: { _id: 0, name: 1, owner: 1 } };

  const localAppResult = await dbHelper.findOneInDatabase(localDatabase, localAppsInformation, localQuery, localProjection);

  if (localAppResult && localAppResult.owner !== appSpecFormatted.owner) {
    throw new Error(`Flux App ${appSpecFormatted.name} already exists locally and is owned by a different user.`);
  }

  return true;
}

/**
 * Update app specifications for rescan/reindex
 * @param {object} appSpecs - Application specifications
 * @returns {Promise<object>} Update result
 */
async function updateAppSpecsForRescanReindex(appSpecs) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: appSpecs.name };
  const update = { $set: appSpecs };
  const options = { upsert: true };

  const result = await dbHelper.updateInDatabase(database, globalAppsInformation, query, update, options);
  log.info(`Updated app specifications for ${appSpecs.name} during rescan/reindex`);

  return result;
}

/**
 * Store app specification in permanent storage
 * @param {object} appSpec - Application specification
 * @returns {Promise<object>} Storage result
 */
async function storeAppSpecificationInPermanentStorage(appSpec) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    await dbHelper.insertOneToDatabase(database, globalAppsInformation, appSpec);

    log.info(`App specification stored permanently for ${appSpec.name}`);
    return { status: 'success', message: 'App specification stored' };
  } catch (error) {
    log.error(`Error storing app specification: ${error.message}`);
    throw error;
  }
}

/**
 * Remove app specification from storage
 * @param {string} appName - Application name
 * @returns {Promise<object>} Removal result
 */
async function removeAppSpecificationFromStorage(appName) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { name: new RegExp(`^${appName}$`, 'i') };
    const result = await dbHelper.removeInDatabase(database, globalAppsInformation, query);

    log.info(`App specification removed for ${appName}`);
    return { status: 'success', deletedCount: result.deletedCount };
  } catch (error) {
    log.error(`Error removing app specification: ${error.message}`);
    throw error;
  }
}

/**
 * Get app specification from database
 * @param {string} appName - Application name
 * @returns {Promise<object|null>} App specification
 */
async function getAppSpecificationFromDb(appName) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { name: new RegExp(`^${appName}$`, 'i') };
    const projection = { projection: { _id: 0 } };

    const appSpec = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
    return appSpec;
  } catch (error) {
    log.error(`Error getting app specification from database: ${error.message}`);
    return null;
  }
}

/**
 * Get all apps information (both global and local)
 * @returns {Promise<Array>} Array of all app information
 */
async function getAllAppsInformation() {
  try {
    const allApps = await availableApps();
    return allApps;
  } catch (error) {
    log.error(`Error getting all apps information: ${error.message}`);
    return [];
  }
}

/**
 * Get installed apps information
 * @returns {Promise<Array>} Array of installed apps
 */
async function getInstalledApps() {
  try {
    const localDb = dbHelper.databaseConnection();
    const localDatabase = localDb.db(config.database.appslocal.database);

    const query = {};
    const projection = { projection: { _id: 0 } };

    const installedApps = await dbHelper.findInDatabase(localDatabase, localAppsInformation, query, projection);
    return installedApps;
  } catch (error) {
    log.error(`Error getting installed apps: ${error.message}`);
    return [];
  }
}

/**
 * Get running apps information
 * @returns {Promise<Array>} Array of running apps
 */
async function getRunningApps() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = {};
    const projection = { projection: { _id: 0 } };

    const runningApps = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
    return runningApps;
  } catch (error) {
    log.error(`Error getting running apps: ${error.message}`);
    return [];
  }
}

module.exports = {
  getAppHashes,
  appLocation,
  appInstallingLocation,
  getAppsLocations,
  getAppsLocation,
  getAppInstallingLocation,
  getApplicationGlobalSpecifications,
  getApplicationLocalSpecifications,
  getApplicationSpecifications,
  getApplicationSpecificationAPI,
  getApplicationOwnerAPI,
  getGlobalAppsSpecifications,
  availableApps,
  checkApplicationRegistrationNameConflicts,
  updateAppSpecsForRescanReindex,
  storeAppSpecificationInPermanentStorage,
  removeAppSpecificationFromStorage,
  getAppSpecificationFromDb,
  getAllAppsInformation,
  getInstalledApps,
  getRunningApps,
};