const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
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
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 * @returns {Promise<object>} List of app hashes
 */
async function getAppHashes(_req, res) {
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
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 */
async function getAppsLocations(_req, res) {
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

    const { data: { height: _daemonHeight } } = syncStatus;

    let { appname, decrypt } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    decrypt = req.query.decrypt || decrypt;

    const specifications = await getApplicationSpecifications(appname);
    const _mainAppName = appname.split('_')[1] || appname;

    if (!specifications) {
      throw new Error('Application not found');
    }

    // Check enterprise status for future use
    // const isEnterprise = Boolean(specifications.version >= 8 && specifications.enterprise);

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
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 */
async function getGlobalAppsSpecifications(_req, res) {
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
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 */
async function availableApps(_req, res) {
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

/**
 * Get registration information for Flux apps
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Registration information
 */
function registrationInformation(_req, res) {
  try {
    const data = config.fluxapps;
    const response = messageHelper.createDataMessage(data);
    res.json(response);
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
 * Get all global applications from database
 * @param {string[]} proj - Optional projection fields
 * @returns {Promise<object[]>} Array of global applications
 */
async function getAllGlobalApplications(proj = []) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    const projection = proj.length > 0 ? { projection: proj.reduce((acc, field) => ({ ...acc, [field]: 1 }), { _id: 0 }) } : { projection: { _id: 0 } };

    const result = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);
    return result.sort((a, b) => a.height - b.height);
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * Remove expired applications from global database and local installations
 * @returns {Promise<void>} Completion status
 */
async function expireGlobalApplications() {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not synced.');
    }

    const currentHeight = syncStatus.data.height;
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    // Find expired applications
    const expiredQuery = {
      expire: { $lt: currentHeight }
    };

    const expiredApps = await dbHelper.findInDatabase(database, globalAppsInformation, expiredQuery, { projection: { _id: 0, name: 1 } });

    // Remove expired apps from database
    if (expiredApps.length > 0) {
      await dbHelper.removeDocumentsFromCollection(database, globalAppsInformation, expiredQuery);
      await dbHelper.removeDocumentsFromCollection(database, globalAppsMessages, expiredQuery);

      log.info(`Removed ${expiredApps.length} expired applications from global database`);

      // TODO: Also remove expired apps from local installations
      // This would involve calling app removal logic for each expired app
    }
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * Rebuild the global apps information collection from messages collection
 * @returns {Promise<string>} Success message
 */
async function reindexGlobalAppsInformation() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    // Get all app messages
    const messages = await dbHelper.findInDatabase(database, globalAppsMessages, {}, { projection: { _id: 0 } });

    // Clear existing information collection
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInformation, {});

    // Rebuild from messages
    for (const message of messages) {
      if (message.appSpecification) {
        const appInfo = {
          ...message.appSpecification,
          hash: message.hash,
          height: message.height,
          txid: message.txid
        };

        await dbHelper.insertOneToDatabase(database, globalAppsInformation, appInfo);
      }
    }

    log.info(`Reindexed ${messages.length} applications in global apps information`);
    return 'Reindex completed successfully';
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * Reconstruct app messages hash collection by validating hash records against actual messages
 * @returns {Promise<string>} Success message
 */
async function reconstructAppMessagesHashCollection() {
  try {
    const db = dbHelper.databaseConnection();
    const databaseApps = db.db(config.database.appsglobal.database);
    const databaseDaemon = db.db(config.database.daemon.database);
    const query = {};
    const projection = { projection: { _id: 0 } };

    const permanentMessages = await dbHelper.findInDatabase(databaseApps, globalAppsMessages, query, projection);
    const appHashes = await dbHelper.findInDatabase(databaseDaemon, appsHashesCollection, query, projection);

    // eslint-disable-next-line no-restricted-syntax
    for (const appHash of appHashes) {
      const options = {};
      const queryUpdate = {
        hash: appHash.hash,
        txid: appHash.txid,
      };

      const permanentMessageFound = permanentMessages.find((message) => message.hash === appHash.hash);

      if (permanentMessageFound) {
        // update that we have the message
        const update = { $set: { message: true, messageNotFound: false } };
        // eslint-disable-next-line no-await-in-loop
        await dbHelper.updateOneInDatabase(databaseDaemon, appsHashesCollection, queryUpdate, update, options);
      } else {
        // update that we do not have the message
        const update = { $set: { message: false, messageNotFound: false } };
        // eslint-disable-next-line no-await-in-loop
        await dbHelper.updateOneInDatabase(databaseDaemon, appsHashesCollection, queryUpdate, update, options);
      }
    }

    return 'Reconstruct success';
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * API endpoint to reconstruct app messages hash collection
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Reconstruction result
 */
async function reconstructAppMessagesHashCollectionAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }

    const result = await reconstructAppMessagesHashCollection();
    const response = messageHelper.createDataMessage(result);
    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
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
  registrationInformation,
  getAllGlobalApplications,
  expireGlobalApplications,
  reindexGlobalAppsInformation,
  reconstructAppMessagesHashCollection,
  reconstructAppMessagesHashCollectionAPI,
};