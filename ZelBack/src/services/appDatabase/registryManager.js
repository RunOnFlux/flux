const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
// Removed appsService to avoid circular dependency - will use dynamic require where needed
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const {
  globalAppsInformation,
  localAppsInformation,
  globalAppsMessages,
  globalAppsLocations,
  globalAppsInstallingLocations,
  globalAppsInstallingErrorsLocations,
  appsHashesCollection,
} = require('../utils/appConstants');

let reindexRunning = false;

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
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
      runningSince: 1,
      osUptime: 1,
      staticIp: 1,
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
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsInstallingLocations, query, projection);
  return results;
}

/**
 * Get app installing errors locations for a specific app or all apps
 * @param {string} appname - Application name (optional)
 * @returns {Promise<Array>} Array of app installing error locations
 */
async function appInstallingErrorsLocation(appname) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      error: 1,
      broadcastedAt: 1,
      cachedAt: 1,
      expireAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsInstallingErrorsLocations, query, projection);
  return results;
}

/**
 * Get app installing errors locations API endpoint
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppsInstallingErrorsLocations(req, res) {
  try {
    const results = await appInstallingErrorsLocation();
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
 * Get a specific app's installing error locations API endpoint
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppInstallingErrorsLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appInstallingErrorsLocation(appname);
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
 * Store an app installing message in the database
 * @param {object} message - App installing message
 * @returns {Promise<boolean>} True if stored successfully, false if message is old/duplicate
 */
async function storeAppInstallingMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param broadcastedAt number
  * @param name string
  * @param ip string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.name !== 'string') {
    return new Error('Invalid Flux App Installing message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux App Installing message for storing version ${message.version} not supported`);
  }

  const validTill = message.broadcastedAt + (5 * 60 * 1000); // 5 minutes
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid fluxappinstalling message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const newAppInstallingMessage = {
    name: message.name,
    ip: message.ip,
    broadcastedAt: new Date(message.broadcastedAt),
    expireAt: new Date(validTill),
  };

  // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
  const queryFind = { name: newAppInstallingMessage.name, ip: newAppInstallingMessage.ip };
  const projection = { _id: 0 };
  // we already have the exact same data
  const result = await dbHelper.findOneInDatabase(database, globalAppsInstallingLocations, queryFind, projection);
  if (result && result.broadcastedAt && result.broadcastedAt >= newAppInstallingMessage.broadcastedAt) {
    // found a message that was already stored/probably from duplicated message processsed
    return false;
  }

  const queryUpdate = { name: newAppInstallingMessage.name, ip: newAppInstallingMessage.ip };
  const update = { $set: newAppInstallingMessage };
  const options = {
    upsert: true,
  };
  await dbHelper.updateOneInDatabase(database, globalAppsInstallingLocations, queryUpdate, update, options);

  // all stored, rebroadcast
  return true;
}

/**
 * To return the owner of a FluxOS application.
 * @param {string} appName Name of app.
 * @returns {string|null} Owner.
 */
async function getApplicationOwner(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
      owner: 1,
    },
  };
  const globalAppsInfoCollection = config.database.appsglobal.collections.appsInformation;
  const appSpecs = await dbHelper.findOneInDatabase(database, globalAppsInfoCollection, query, projection);
  if (appSpecs) {
    return appSpecs.owner;
  }
  // eslint-disable-next-line no-use-before-define
  const allApps = await availableApps();
  const appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  if (appInfo) {
    return appInfo.owner;
  }
  return null;
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
    let { appname } = req?.params || {};
    appname = appname || req?.query?.appname;
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
    let { appname } = req?.params || {};
    appname = appname || req?.query?.appname;
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

  // Decrypt and format specifications if needed
  let appSpec = await checkAndDecryptAppSpecs(dbAppSpec);
  appSpec = specificationFormatter(appSpec);
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
  let appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (!appInfo) {
    const allApps = await availableApps();
    appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  }

  // This is abusing the spec formatter. It's not meant for this. This whole thing
  // is kind of broken. The reason we have to use the spec formatter here is the
  // frontend is passing properties as strings (then stringify the whole object)
  // the frontend should parse the strings up front, and just pass an encrypted,
  // stringified object.
  //
  // Will fix this in v9 specs. Move to model based specs with pre sorted keys.
  appInfo = await checkAndDecryptAppSpecs(appInfo);
  if (appInfo && appInfo.version >= 8 && appInfo.enterprise) {
    const { height, hash } = appInfo;
    appInfo = specificationFormatter(appInfo);
    appInfo.height = height;
    appInfo.hash = hash;
  }
  return appInfo;
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

    // const { data: { height: daemonHeight } } = syncStatus; // Not used currently

    let { appname, decrypt } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    decrypt = req.query.decrypt || decrypt;

    const specifications = await getApplicationSpecifications(appname);
    // const mainAppName = appname.split('_')[1] || appname; // Not used currently

    if (!specifications) {
      throw new Error('Application not found');
    }

    // Check enterprise status for future use
    // const isEnterprise = Boolean(specifications.version >= 8 && specifications.enterprise);

    if (!decrypt) {
      const specificationsResponse = messageHelper.createDataMessage(specifications);
      return res.json(specificationsResponse);
    }

    // Add decryption logic for enterprise apps
    const decryptedSpecs = await checkAndDecryptAppSpecs(specifications);

    const specificationsResponse = messageHelper.createDataMessage(decryptedSpecs);
    return res.json(specificationsResponse);
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

/**
 * Get application owner via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getApplicationOwnerAPI(req, res) {
  try {
    let { appname } = req?.params || {};
    appname = appname || req?.query?.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const owner = await getApplicationOwner(appname);
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
 * @param {object} req - Request object with optional params/query for hash, owner, appname
 * @param {object} res - Response object
 */
async function getGlobalAppsSpecifications(req, res) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    let { hash } = req.params;
    hash = hash || req.query.hash;
    let { owner } = req.params;
    owner = owner || req.query.owner;
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (hash) {
      query.hash = hash;
    }
    if (owner) {
      query.owner = owner;
    }
    if (appname) {
      query.name = appname;
    }
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
      return res.json(resultsResponse);
    }
    return allApps;
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
  // check if name is not yet registered
  const dbopen = dbHelper.databaseConnection();

  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { name: new RegExp(`^${appSpecFormatted.name}$`, 'i') }; // case insensitive
  const appsProjection = {
    projection: {
      _id: 0,
      name: 1,
      height: 1,
      expire: 1,
    },
  };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsInformation, appsQuery, appsProjection);

  if (appResult) {
    // in this case, check if hash of the message is older than our current app
    if (hash) {
      // check if we have the hash of the app in our db
      const query = { hash };
      const projection = {
        projection: {
          _id: 0,
          txid: 1,
          hash: 1,
          height: 1,
        },
      };
      const database = dbopen.db(config.database.daemon.database);
      const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, query, projection);
      if (!result) {
        throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name. Hash not found in collection.`);
      }
      if (appResult.height <= result.height) {
        log.debug(appResult);
        log.debug(result);
        const currentExpiration = appResult.height + (appResult.expire || 22000);
        if (currentExpiration >= result.height) {
          throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name. Hash is not older than our current app.`);
        } else {
          log.warn(`Flux App ${appSpecFormatted.name} active specifications are outdated. Will be cleaned on next expiration`);
        }
      }
    } else {
      throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name.`);
    }
  }

  const localApps = await availableApps();
  const appExists = localApps.find((localApp) => localApp.name.toLowerCase() === appSpecFormatted.name.toLowerCase());
  if (appExists) {
    throw new Error(`Flux App ${appSpecFormatted.name} already assigned to local application. Flux App has to be registered under different name.`);
  }
  if (appSpecFormatted.name.toLowerCase() === 'share') {
    throw new Error(`Flux App ${appSpecFormatted.name} already assigned to Flux main application. Flux App has to be registered under different name.`);
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
  // check if synced
  try {
    // get current height from explorer
    const dbopen = dbHelper.databaseConnection();
    const daemonDatabase = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
    const result = await dbHelper.findOneInDatabase(daemonDatabase, scannedHeightCollection, query, projection);
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight);
    let minExpirationHeight = explorerHeight - config.fluxapps.newMinBlocksAllowance; // do a pre search in db as every app has to live for at least newMinBlocksAllowance
    if (explorerHeight < config.fluxapps.newMinBlocksAllowanceBlock) {
      minExpirationHeight = explorerHeight - config.fluxapps.minBlocksAllowance; // do a pre search in db as every app has to live for at least minBlocksAllowance
    }
    // get global applications specification that have up to date data
    // find applications that have specifications height lower than minExpirationHeight
    const databaseApps = dbopen.db(config.database.appsglobal.database);
    const queryApps = { height: { $lt: minExpirationHeight } };
    const projectionApps = {
      projection: {
        _id: 0, name: 1, hash: 1, expire: 1, height: 1,
      },
    };
    const results = await dbHelper.findInDatabase(databaseApps, globalAppsInformation, queryApps, projectionApps);
    const appsToExpire = [];
    const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
    results.forEach((appSpecs) => {
      const expireIn = appSpecs.expire || defaultExpire;
      if (appSpecs.height + expireIn < explorerHeight) { // registered/updated on height, expires in expireIn is lower than current height
        appsToExpire.push(appSpecs);
      }
    });
    const appNamesToExpire = appsToExpire.map((res) => res.name);
    // remove appNamesToExpire apps from global database
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsToExpire) {
      log.info(`Expiring application ${app.name}`);
      const queryDeleteApp = { name: app.name };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.findOneAndDeleteInDatabase(databaseApps, globalAppsInformation, queryDeleteApp, projectionApps);

      const queryDeleteAppErrors = { name: app.name };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.removeDocumentsFromCollection(databaseApps, globalAppsInstallingErrorsLocations, queryDeleteAppErrors);
    }

    // get list of locally installed apps.
    // Use dynamic require to avoid circular dependency
    const appsService = require('../appsService');
    const installedAppsRes = await appsService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    // remove any installed app which height is lower (or not present) but is not infinite app
    const appsToRemove = [];
    appsInstalled.forEach((app) => {
      if (appNamesToExpire.includes(app.name)) {
        appsToRemove.push(app);
      } else if (!app.height) {
        appsToRemove.push(app);
      } else if (app.height === 0) {
        // do nothing, forever lasting local app
      } else {
        const expireIn = app.expire || defaultExpire;
        if (app.height + expireIn < explorerHeight) {
          appsToRemove.push(app);
        }
      }
    });
    const appsToRemoveNames = appsToRemove.map((app) => app.name);

    // remove appsToRemoveNames apps from locally running
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsToRemoveNames) {
      log.warn(`Application ${appName} is expired, removing`);
      // eslint-disable-next-line no-await-in-loop
      await appsService.removeAppLocally(appName, null, false, true, true);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(1 * 60 * 1000); // wait for 1 min
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To update app specifications.
 * @param {object} appSpecs App specifications.
 */
async function updateAppSpecifications(appSpecs) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { name: appSpecs.name };
    const update = { $set: appSpecs };
    const options = {
      upsert: true,
    };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
    if (appInfo) {
      if (appInfo.height < appSpecs.height) {
        await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
      }
    } else {
      await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
    }
    const queryDeleteAppErrors = { name: appSpecs.name };
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingErrorsLocations, queryDeleteAppErrors);
  } catch (error) {
    // retry
    log.error(error);
    await serviceHelper.delay(60 * 1000);
    updateAppSpecifications(appSpecs);
  }
}

/**
 * Rebuild the global apps information collection from messages collection
 * @returns {Promise<string>} Success message
 */
async function reindexGlobalAppsInformation() {
  try {
    if (reindexRunning) {
      return 'Previous app reindex not yet finished. Skipping.';
    }
    reindexRunning = true;
    log.info('Reindexing global application list');

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await dbHelper.dropCollection(database, globalAppsInformation).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    await database.collection(globalAppsInformation).createIndex({ name: 1 }, { name: 'query for getting zelapp based on zelapp specs name' });
    await database.collection(globalAppsInformation).createIndex({ owner: 1 }, { name: 'query for getting zelapp based on zelapp specs owner' });
    await database.collection(globalAppsInformation).createIndex({ repotag: 1 }, { name: 'query for getting zelapp based on image' });
    await database.collection(globalAppsInformation).createIndex({ height: 1 }, { name: 'query for getting zelapp based on last height update' }); // we need to know the height of app adjustment
    await database.collection(globalAppsInformation).createIndex({ hash: 1 }, { name: 'query for getting zelapp based on last hash' }); // we need to know the hash of the last message update which is the true identifier
    const query = {};
    const projection = { projection: { _id: 0 }, sort: { height: 1 } }; // sort from oldest to newest
    const results = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
    // eslint-disable-next-line no-restricted-syntax
    for (const message of results) {
      const updateForSpecifications = message.appSpecifications || message.zelAppSpecifications;
      updateForSpecifications.hash = message.hash;
      updateForSpecifications.height = message.height;
      // eslint-disable-next-line no-await-in-loop
      await updateAppSpecsForRescanReindex(updateForSpecifications);
    }
    log.info('Reindexing of global application list finished. Starting expiring global apps.');
    await expireGlobalApplications();
    log.info('Expiration of global application list finished. Done.');
    reindexRunning = false;
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  } finally {
    reindexRunning = false;
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
  appInstallingErrorsLocation,
  storeAppInstallingMessage,
  getAppsLocations,
  getAppsLocation,
  getAppInstallingLocation,
  getAppInstallingErrorsLocation,
  getAppsInstallingErrorsLocations,
  getApplicationGlobalSpecifications,
  getApplicationLocalSpecifications,
  getApplicationSpecifications,
  getApplicationSpecificationAPI,
  getApplicationOwner,
  getApplicationOwnerAPI,
  getGlobalAppsSpecifications,
  availableApps,
  checkApplicationRegistrationNameConflicts,
  updateAppSpecifications,
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
