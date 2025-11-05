const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
// Removed appsService to avoid circular dependency - will use dynamic require where needed
const { checkAndDecryptAppSpecs, encryptEnterpriseFromSession } = require('../utils/enterpriseHelper');
const { specificationFormatter, updateToLatestAppSpecifications } = require('../utils/appUtilities');
const {
  globalAppsInformation,
  localAppsInformation,
  globalAppsMessages,
  globalAppsLocations,
  globalAppsInstallingLocations,
  globalAppsInstallingErrorsLocations,
  appsHashesCollection,
  scannedHeightCollection,
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
    throw new Error('Invalid Flux App Installing message for storing');
  }

  if (message.version !== 1) {
    throw new Error(`Invalid Flux App Installing message for storing version ${message.version} not supported`);
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
  if (appSpec && appSpec.version >= 8 && appSpec.enterprise) {
    const { height, hash } = appSpec;
    appSpec = specificationFormatter(appSpec);
    appSpec.height = height;
    appSpec.hash = hash;
  }
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
  // appSpecs: {
  //   version: 2,
  //   name: 'FoldingAtHomeB',
  //   description: 'Folding @ Home is cool :)',
  //   repotag: 'yurinnick/folding-at-home:latest',
  //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  //   ports: '[30001]', // []
  //   containerPorts: '[7396]', // []
  //   domains: '[""]', // []
  //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
  //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
  //   containerData: '/config',
  //   cpu: 0.5,
  //   ram: 500,
  //   hdd: 5,
  //   tiered: true,
  //   cpubasic: 0.5,
  //   rambasic: 500,
  //   hddbasic: 5,
  //   cpusuper: 1,
  //   ramsuper: 1000,
  //   hddsuper: 5,
  //   cpubamf: 2,
  //   rambamf: 2000,
  //   hddbamf: 5,
  //   hash: hash of message that has these paramenters,
  //   height: height containing the message
  // };
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
    // eslint-disable-next-line no-use-before-define
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

    const { data: { height: daemonHeight } } = syncStatus;

    let { appname, decrypt } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    // query params take precedence over params (they were set explictly)
    decrypt = req.query.decrypt || decrypt;

    const specifications = await getApplicationSpecifications(appname);
    const mainAppName = appname.split('_')[1] || appname;

    if (!specifications) {
      throw new Error(`Application: ${appname} not found`);
    }

    const isEnterprise = Boolean(
      specifications.version >= 8 && specifications.enterprise,
    );

    if (!decrypt) {
      if (isEnterprise) {
        specifications.compose = [];
        specifications.contacts = [];
      }

      const specResponse = messageHelper.createDataMessage(specifications);
      res.json(specResponse);
      return null;
    }

    if (!isEnterprise) {
      throw new Error('App spec decryption is only possible for version 8+ Apps.');
    }

    const encryptedEnterpriseKey = req.headers['enterprise-key'];
    if (!encryptedEnterpriseKey) {
      throw new Error('Header with enterpriseKey is mandatory for enterprise Apps.');
    }

    const ownerAuthorized = await verificationHelper.verifyPrivilege(
      'appowner',
      req,
      mainAppName,
    );

    const fluxTeamAuthorized = ownerAuthorized === true
      ? false
      : await verificationHelper.verifyPrivilege(
        'appownerabove',
        req,
        mainAppName,
      );

    if (ownerAuthorized !== true && fluxTeamAuthorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return null;
    }

    if (fluxTeamAuthorized) {
      specifications.compose.forEach((component) => {
        const comp = component;
        comp.environmentParameters = [];
        comp.repoauth = '';
      });
    }

    // this seems a bit weird, but the client can ask for the specs encrypted or decrypted.
    // If decrypted, they pass us another session key and we use that to encrypt.
    specifications.enterprise = await encryptEnterpriseFromSession(
      specifications,
      daemonHeight,
      encryptedEnterpriseKey,
    );

    specifications.contacts = [];
    specifications.compose = [];

    const specResponse = messageHelper.createDataMessage(specifications);
    res.json(specResponse);
  } catch (error) {
    log.error(error);

    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );

    res.json(errorResponse);
  }

  return null;
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
 * Update application specification to latest version via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<object|null>} Response with updated specifications
 */
async function updateApplicationSpecificationAPI(req, res) {
  try {
    const { appname } = req.params;
    if (!appname) {
      throw new Error('appname parameter is mandatory');
    }

    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }

    const { data: { height: daemonHeight } } = syncStatus;

    const specifications = await getApplicationSpecifications(appname);
    if (!specifications) {
      throw new Error('Application not found');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const isEnterprise = Boolean(
      specifications.version >= 8 && specifications.enterprise,
    );

    let encryptedEnterpriseKey = null;
    if (isEnterprise) {
      encryptedEnterpriseKey = req.headers['enterprise-key'];
      if (!encryptedEnterpriseKey) {
        throw new Error('Header with enterpriseKey is mandatory for enterprise Apps.');
      }
    }

    const authorized = await verificationHelper.verifyPrivilege(
      'appownerabove',
      req,
      mainAppName,
    );

    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return null;
    }

    const updatedSpecs = updateToLatestAppSpecifications(specifications);

    if (isEnterprise) {
      const enterprise = await encryptEnterpriseFromSession(
        updatedSpecs,
        daemonHeight,
        encryptedEnterpriseKey,
      );

      updatedSpecs.enterprise = enterprise;
      updatedSpecs.contacts = [];
      updatedSpecs.compose = [];
    }

    const specResponse = messageHelper.createDataMessage(updatedSpecs);
    res.json(specResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
  return null;
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
        // Determine default expire based on whether app was registered after PON fork
        const defaultExpire = appResult.height >= config.fluxapps.daemonPONFork ? 88000 : 22000;
        const expireIn = appResult.expire || defaultExpire;
        let currentExpiration = appResult.height + expireIn;

        // If app was registered before fork block and expiration extends past fork block
        // the chain moves 4x faster, so we need to adjust the expiration
        if (appResult.height < config.fluxapps.daemonPONFork && currentExpiration > config.fluxapps.daemonPONFork) {
          // Calculate blocks that were supposed to live after fork block
          const blocksAfterFork = currentExpiration - config.fluxapps.daemonPONFork;
          // Multiply by 4 to account for 4x faster chain
          const adjustedBlocksAfterFork = blocksAfterFork * 4;
          // New expiration = fork block + adjusted blocks
          currentExpiration = config.fluxapps.daemonPONFork + adjustedBlocksAfterFork;
        }

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
 * @returns {Promise<boolean>} Update result
 */
async function updateAppSpecsForRescanReindex(appSpecs) {
  // appSpecs: {
  //   version: 3,
  //   name: 'FoldingAtHomeB',
  //   description: 'Folding @ Home is cool :)',
  //   repotag: 'yurinnick/folding-at-home:latest',
  //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  //   ports: '[30001]',
  //   containerPorts: '[7396]',
  //   domains: '[""]',
  //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
  //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
  //   containerData: '/config',
  //   cpu: 0.5,
  //   ram: 500,
  //   hdd: 5,
  //   tiered: true,
  //   cpubasic: 0.5,
  //   rambasic: 500,
  //   hddbasic: 5,
  //   cpusuper: 1,
  //   ramsuper: 1000,
  //   hddsuper: 5,
  //   cpubamf: 2,
  //   rambamf: 2000,
  //   hddbamf: 5,
  //   instances: 10, // version 3 fork
  //   hash: hash of message that has these paramenters,
  //   height: height containing the message
  // };
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
  return true;
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
 * To get all apps running on a specific IP address. Returns all apps running on this ip
 * @param {string} ip IP address to check
 * @returns {Promise<Array>} Array of apps running on the specified IP
 */
async function getRunningAppIpList(ip) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  const query = { ip: new RegExp(`^${ip}`) };
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
 * Get registration information for Flux apps
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 * @returns {void} Registration information
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
    const wantedProjection = {
      _id: 0,
    };
    proj.forEach((field) => {
      wantedProjection[field] = 1;
    });
    const projection = { projection: wantedProjection, sort: { height: 1 } }; // ensure sort from oldest to newest
    const results = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);
    return results;
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * Remove expired applications from global database and local installations
 * @returns {Promise<void>} Completion status
 */
async function expireGlobalApplications() {
  // check if synced
  try {
    // get current height
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
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
      let actualExpirationHeight = appSpecs.height + expireIn;

      // If app was registered before fork block and we are past fork block
      // the chain moves 4x faster, so we need to adjust the expiration
      if (appSpecs.height < config.fluxapps.daemonPONFork && explorerHeight >= config.fluxapps.daemonPONFork) {
        const originalExpirationHeight = appSpecs.height + expireIn;
        if (originalExpirationHeight > config.fluxapps.daemonPONFork) {
          // Calculate blocks that were supposed to live after fork block
          const blocksAfterFork = originalExpirationHeight - config.fluxapps.daemonPONFork;
          // Multiply by 4 to account for 4x faster chain
          const adjustedBlocksAfterFork = blocksAfterFork * 4;
          // New expiration = fork block + adjusted blocks
          actualExpirationHeight = config.fluxapps.daemonPONFork + adjustedBlocksAfterFork;
        }
      }

      if (actualExpirationHeight < explorerHeight) { // registered/updated on height, expires in expireIn is lower than current height
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
    // eslint-disable-next-line global-require
    const appQueryService = require('../appQuery/appQueryService');
    const installedAppsRes = await appQueryService.installedApps();
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
        let actualExpirationHeight = app.height + expireIn;

        // If app was registered before fork block and we are past fork block
        // the chain moves 4x faster, so we need to adjust the expiration
        if (app.height < config.fluxapps.daemonPONFork && explorerHeight >= config.fluxapps.daemonPONFork) {
          const originalExpirationHeight = app.height + expireIn;
          if (originalExpirationHeight > config.fluxapps.daemonPONFork) {
            // Calculate blocks that were supposed to live after fork block
            const blocksAfterFork = originalExpirationHeight - config.fluxapps.daemonPONFork;
            // Multiply by 4 to account for 4x faster chain
            const adjustedBlocksAfterFork = blocksAfterFork * 4;
            // New expiration = fork block + adjusted blocks
            actualExpirationHeight = config.fluxapps.daemonPONFork + adjustedBlocksAfterFork;
          }
        }

        if (actualExpirationHeight < explorerHeight) {
          appsToRemove.push(app);
        }
      }
    });
    const appsToRemoveNames = appsToRemove.map((app) => app.name);

    // remove appsToRemoveNames apps from locally running
    // Use dynamic require to avoid circular dependency
    // eslint-disable-next-line global-require
    const appUninstaller = require('../appLifecycle/appUninstaller');
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsToRemoveNames) {
      log.warn(`Application ${appName} is expired, removing`);
      log.warn(`REMOVAL REASON: App expired - ${appName} reached expiration date (registryManager)`);
      // eslint-disable-next-line no-await-in-loop
      await appUninstaller.removeAppLocally(appName, null, false, true, true);
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
    // appSpecs: {
    //   version: 3,
    //   name: 'FoldingAtHomeB',
    //   description: 'Folding @ Home is cool :)',
    //   repotag: 'yurinnick/folding-at-home:latest',
    //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    //   ports: '[30001]',
    //   containerPorts: '[7396]',
    //   domains: '[""]',
    //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
    //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
    //   containerData: '/config',
    //   cpu: 0.5,
    //   ram: 500,
    //   hdd: 5,
    //   tiered: true,
    //   cpubasic: 0.5,
    //   rambasic: 500,
    //   hddbasic: 5,
    //   cpusuper: 1,
    //   ramsuper: 1000,
    //   hddsuper: 5,
    //   cpubamf: 2,
    //   rambamf: 2000,
    //   hddbamf: 5,
    //   instances: 10, // version 3 fork
    //   hash: hash of message that has these paramenters,
    //   height: height containing the message
    // };
    // const appSpecs = {
    //   version: 4, // int
    //   name: 'FoldingAtHomeB', // string
    //   description: 'Folding @ Home is cool :)', // string
    //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', // string
    //   compose: [ // array of max 5 objects of following specs
    //     {
    //       name: 'Daemon', // string
    //       description: 'Main ddaemon for foldingAtHome', // string
    //       repotag: 'yurinnick/folding-at-home:latest',
    //       ports: '[30001]', // array of ints
    //       containerPorts: '[7396]', // array of ints
    //       domains: '[""]', // array of strings
    //       environmentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // array of strings
    //       commands: '["--allow","0/0","--web-allow","0/0"]', // array of strings
    //       containerData: '/config', // string
    //       cpu: 0.5, // float
    //       ram: 500, // int
    //       hdd: 5, // int
    //       tiered: true, // bool
    //       cpubasic: 0.5, // float
    //       rambasic: 500, // int
    //       hddbasic: 5, // int
    //       cpusuper: 1, // float
    //       ramsuper: 1000, // int
    //       hddsuper: 5, // int
    //       cpubamf: 2, // float
    //       rambamf: 2000, // int
    //       hddbamf: 5, // int
    //     },
    //   ],
    //   instances: 10, // int
    // };
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
 * @returns {Promise<object>} Reconstruction result message
 */
async function reconstructAppMessagesHashCollectionAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      const result = await reconstructAppMessagesHashCollection();
      const message = messageHelper.createSuccessMessage(result);
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
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
 * To register an application globally via API. Only accessible by authorized users.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function registerAppGlobalyApi(req, res) {
  // Import dependencies needed for this function
  // eslint-disable-next-line global-require
  const generalService = require('../generalService');
  // eslint-disable-next-line global-require
  const appUtilities = require('../utils/appUtilities');
  // eslint-disable-next-line global-require
  const appValidator = require('../appRequirements/appValidator');
  // eslint-disable-next-line global-require
  const imageManager = require('../appSecurity/imageManager');
  // eslint-disable-next-line global-require
  const messageVerifier = require('../appMessaging/messageVerifier');
  // eslint-disable-next-line global-require
  const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
  // eslint-disable-next-line global-require
  const { outgoingPeers, incomingPeers } = require('../utils/establishedConnections');

  const isArcane = Boolean(process.env.FLUXOS_PATH);

  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      // first check if this node is available for application registration
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application registration');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application registration');
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and port HAVE to be unique for application. Check if they don't exist in global database
      // first let's check if all fields are present and have proper format except tiered and tiered specifications and those can be omitted
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, type, version, timestamp and signature are provided.');
      }
      if (messageType !== 'zelappregister' && messageType !== 'fluxappregister') {
        throw new Error('Invalid type of message');
      }
      if (typeVersion !== 1) {
        throw new Error('Invalid version of message');
      }
      appSpecification = serviceHelper.ensureObject(appSpecification);
      timestamp = serviceHelper.ensureNumber(timestamp);
      signature = serviceHelper.ensureString(signature);
      messageType = serviceHelper.ensureString(messageType);
      typeVersion = serviceHelper.ensureNumber(typeVersion);

      const timestampNow = Date.now();
      if (timestamp < timestampNow - 1000 * 3600) {
        throw new Error('Message timestamp is over 1 hour old, not valid. Check if your computer clock is synced and restart the registration process.');
      } else if (timestamp > timestampNow + 1000 * 60 * 5) {
        throw new Error('Message timestamp from future, not valid. Check if your computer clock is synced and restart the registration process.');
      }

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
          owner: appSpecification.owner,
        },
      );

      const appSpecFormatted = await appUtilities.specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await appValidator.verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await imageManager.checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // check if name is not yet registered
      await checkApplicationRegistrationNameConflicts(appSpecFormatted);

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const toVerify = isEnterprise
        ? await appUtilities.specificationFormatter(appSpecification)
        : appSpecFormatted;

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type or bad message received. Respond with 'Received message is invalid';
      await messageVerifier.verifyAppMessageSignature(messageType, typeVersion, toVerify, timestamp, signature);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may pose some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);

      // now all is great. Store appSpecFormatted, timestamp, signature and hash in appsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryAppMessage = { // specification of temp message
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
        arcaneSender: isArcane,
      };
      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);
      // above takes 2-3 seconds
      await serviceHelper.delay(1200); // it takes receiving node at least 1 second to process the message. Add 1200 ms mas for processing
      // this operations takes 2.5-3.5 seconds and is heavy, message gets verified again.
      await messageVerifier.requestAppMessage(messageHASH); // this itself verifies that Peers received our message broadcast AND peers send us the message back. By peers sending the message back we finally store it to our temporary message storage and rebroadcast it again
      // request app message is quite slow and from performance testing message will appear roughly 5 seconds after ask
      await serviceHelper.delay(1200); // 1200 ms mas for processing - peer sends message back to us
      // check temporary message storage
      let tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(messageHASH); // Cumulus measurement: after roughly 8 seconds here
      for (let i = 0; i < 20; i += 1) { // ask for up to 20 times - 10 seconds. Must have been processed by that time or it failed. Cumulus measurement: Approx 5-6 seconds
        if (!tempMessage) {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(messageHASH);
        }
      }
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const responseHash = messageHelper.createDataMessage(tempMessage.hash);
        res.json(responseHash); // all ok
        return;
      }
      throw new Error('Unable to register application on the network. Try again later.');
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * Drops and recreates global apps locations collection with indexes
 * @returns {Promise<boolean>} True if successful
 */
async function reindexGlobalAppsLocation() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await dbHelper.dropCollection(database, globalAppsLocations).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    await database.collection(globalAppsLocations).createIndex({ name: 1 }, { name: 'query for getting app location based on app specs name' });
    await database.collection(globalAppsLocations).createIndex({ hash: 1 }, { name: 'query for getting app location based on app hash' });
    await database.collection(globalAppsLocations).createIndex({ ip: 1 }, { name: 'query for getting app location based on ip' });
    await database.collection(globalAppsLocations).createIndex({ name: 1, ip: 1 }, { name: 'query for getting app based on ip and name' });
    await database.collection(globalAppsLocations).createIndex({ name: 1, ip: 1, broadcastedAt: 1 }, { name: 'query for getting app to ensure we possess a message' });
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To reindex global apps location via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsLocationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsLocation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
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
 * To reindex global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsInformation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
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
 * Rescans global apps information from messages collection starting from a specific height
 * @param {number} height - Starting block height for rescan (default 0)
 * @param {boolean} removeLastInformation - Whether to remove existing information before rescanning (default false)
 * @returns {Promise<boolean>} True if successful
 */
async function rescanGlobalAppsInformation(height = 0, removeLastInformation = false) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    await dbHelper.dropCollection(database, globalAppsInformation).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });

    const query = { height: { $gte: height } };
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);

    if (removeLastInformation === true) {
      await dbHelper.removeDocumentsFromCollection(database, globalAppsInformation, query);
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const message of results) {
      const updateForSpecifications = message.appSpecifications || message.zelAppSpecifications;
      updateForSpecifications.hash = message.hash;
      updateForSpecifications.height = message.height;
      // eslint-disable-next-line no-await-in-loop
      await updateAppSpecsForRescanReindex(updateForSpecifications);
    }
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To rescan global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function rescanGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req.query.blockheight;
      if (!blockheight) {
        const errMessage = messageHelper.createErrorMessage('No blockheight provided');
        res.json(errMessage);
        return;
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
      if (!currentHeight) {
        throw new Error('No scanned height found');
      }
      if (currentHeight.generalScannedHeight <= blockheight) {
        throw new Error('Block height shall be lower than currently scanned');
      }
      if (blockheight < 0) {
        throw new Error('BlockHeight lower than 0');
      }
      let { removelastinformation } = req.params;
      removelastinformation = removelastinformation || req.query.removelastinformation || false;
      removelastinformation = serviceHelper.ensureBoolean(removelastinformation);

      await rescanGlobalAppsInformation(blockheight, removelastinformation);
      const message = messageHelper.createSuccessMessage('Rescan successfull');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
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
  updateApplicationSpecificationAPI,
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
  getRunningAppIpList,
  registrationInformation,
  getAllGlobalApplications,
  expireGlobalApplications,
  reindexGlobalAppsInformation,
  reindexGlobalAppsLocation,
  rescanGlobalAppsInformation,
  reconstructAppMessagesHashCollection,
  reconstructAppMessagesHashCollectionAPI,
  registerAppGlobalyApi,
  reindexGlobalAppsLocationAPI,
  reindexGlobalAppsInformationAPI,
  rescanGlobalAppsInformationAPI,
};
