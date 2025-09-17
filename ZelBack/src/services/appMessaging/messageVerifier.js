const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const generalService = require('../generalService');
const signatureVerifier = require('../signatureVerifier');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const {
  globalAppsMessages,
  globalAppsTempMessages,
  globalAppsLocations,
  globalAppsInstallingLocations,
  appsHashesCollection,
} = require('../utils/appConstants');

/**
 * Verify app hash against message content
 * @param {object} message - Message object to verify
 * @returns {Promise<boolean>} True if hash is valid
 */
async function verifyAppHash(message) {
  /* message object
   * @param type string
   * @param version number
   * @param appSpecifications object
   * @param hash string
   * @param timestamp number
   * @param signature string
   */
  const specifications = message.appSpecifications || message.zelAppSpecifications;
  let messToHash = message.type + message.version + JSON.stringify(specifications) + message.timestamp + message.signature;
  let messageHASH = await generalService.messageHash(messToHash);

  if (messageHASH === message.hash) return true;

  const appSpecsCopy = JSON.parse(JSON.stringify(specifications));

  if (specifications.version <= 3) {
    // as of specification changes, adjust our appSpecs order of owner and repotag
    // in new scheme it is always version, name, description, owner, repotag... Old format was version, name, description, repotag, owner
    delete appSpecsCopy.version;
    delete appSpecsCopy.name;
    delete appSpecsCopy.description;
    delete appSpecsCopy.repotag;
    delete appSpecsCopy.owner;

    const appSpecOld = {
      version: specifications.version,
      name: specifications.name,
      description: specifications.description,
      repotag: specifications.repotag,
      owner: specifications.owner,
      ...appSpecsCopy,
    };

    messToHash = message.type + message.version + JSON.stringify(appSpecOld) + message.timestamp + message.signature;
    messageHASH = await generalService.messageHash(messToHash);

    if (messageHASH === message.hash) return true;
  }

  return false;
}

/**
 * Verify app message signature
 * @param {string} type - Message type
 * @param {number} version - Message version
 * @param {object} appSpec - App specifications
 * @param {number} timestamp - Message timestamp
 * @param {string} signature - Message signature
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifyAppMessageSignature(type, version, appSpec, timestamp, signature) {
  if (!appSpec || typeof appSpec !== 'object' || Array.isArray(appSpec) || typeof timestamp !== 'number' || typeof signature !== 'string' || typeof version !== 'number' || typeof type !== 'string') {
    throw new Error('Invalid Flux App message specifications');
  }
  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  let isValidSignature = verificationHelper.verifyMessage(messageToVerify, appSpec.owner, signature); // only btc
  if (timestamp > 1688947200000) {
    isValidSignature = signatureVerifier.verifySignature(messageToVerify, appSpec.owner, signature); // btc, eth
  }
  if (isValidSignature !== true && appSpec.version <= 3) {
    // as of specification changes, adjust our appSpecs order of owner and repotag
    // in new scheme it is always version, name, description, owner, repotag... Old format was version, name, description, repotag, owner
    const appSpecsCopy = JSON.parse(JSON.stringify(appSpec));
    delete appSpecsCopy.version;
    delete appSpecsCopy.name;
    delete appSpecsCopy.description;
    delete appSpecsCopy.repotag;
    delete appSpecsCopy.owner;
    const appSpecOld = {
      version: appSpec.version,
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      owner: appSpec.owner,
      ...appSpecsCopy,
    };
    const messageToVerifyOld = type + version + JSON.stringify(appSpecOld) + timestamp;
    if (timestamp > 1688947200000) {
      isValidSignature = signatureVerifier.verifySignature(messageToVerifyOld, appSpec.owner, signature); // btc, eth
    } else {
      isValidSignature = verificationHelper.verifyMessage(messageToVerifyOld, appSpec.owner, signature); // only btc
    }
  }
  return isValidSignature === true;
}

/**
 * Verify app message update signature
 * @param {string} type - Message type
 * @param {number} version - Message version
 * @param {object} appSpec - App specifications
 * @param {number} timestamp - Message timestamp
 * @param {string} signature - Message signature
 * @param {string} appOwner - App owner address
 * @param {number} daemonHeight - Daemon height
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifyAppMessageUpdateSignature(type, version, appSpec, timestamp, signature, appOwner, daemonHeight) {
  if (!appSpec || typeof appSpec !== 'object' || Array.isArray(appSpec) || typeof timestamp !== 'number' || typeof signature !== 'string' || typeof version !== 'number' || typeof type !== 'string') {
    throw new Error('Invalid Flux App message specifications');
  }

  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  let isValidSignature = false;

  if (timestamp > 1688947200000) {
    isValidSignature = signatureVerifier.verifySignature(messageToVerify, appOwner, signature);
  } else {
    isValidSignature = verificationHelper.verifyMessage(messageToVerify, appOwner, signature);
  }

  if (isValidSignature !== true && appSpec.version <= 3) {
    // Handle old specification format
    const appSpecsCopy = JSON.parse(JSON.stringify(appSpec));
    delete appSpecsCopy.version;
    delete appSpecsCopy.name;
    delete appSpecsCopy.description;
    delete appSpecsCopy.repotag;
    delete appSpecsCopy.owner;

    const appSpecOld = {
      version: appSpec.version,
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      owner: appSpec.owner,
      ...appSpecsCopy,
    };

    const messageToVerifyOld = type + version + JSON.stringify(appSpecOld) + timestamp;
    if (timestamp > 1688947200000) {
      isValidSignature = signatureVerifier.verifySignature(messageToVerifyOld, appOwner, signature);
    } else {
      isValidSignature = verificationHelper.verifyMessage(messageToVerifyOld, appOwner, signature);
    }
  }

  return isValidSignature === true;
}

/**
 * Request app message from network
 * @param {string} hash - Message hash to request
 */
async function requestAppMessage(hash) {
  // some message type request app message, message hash
  // peer responds with data from permanent database or temporary database. If does not have it requests further
  const message = {
    type: 'fluxapprequest',
    version: 1,
    hash,
  };
  await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(message);
  await generalService.delay(500);
  await fluxCommunicationMessagesSender.broadcastMessageToIncoming(message);
}

/**
 * Request multiple app messages from network
 * @param {Array} apps - List of apps with hash property
 * @param {boolean} incoming - If true, request from incoming peers
 */
async function requestAppsMessage(apps, incoming) {
  // some message type request app message, message hash
  // peer responds with data from permanent database or temporary database. If does not have it requests further
  const message = {
    type: 'fluxapprequest',
    version: 2,
    hashes: apps.map((a) => a.hash),
  };

  if (incoming) {
    await fluxCommunicationMessagesSender.broadcastMessageToIncoming(message);
  } else {
    await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(message);
  }
}

/**
 * Request app message via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function requestAppMessageAPI(req, res) {
  try {
    // only flux team and node owner can do this
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    let { hash } = req.params;
    hash = hash || req.query.hash;

    if (!hash) {
      throw new Error('No Flux App Hash specified');
    }
    requestAppMessage(hash);
    const resultsResponse = messageHelper.createSuccessMessage(`Application hash ${hash} requested from the network`);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * Store app temporary message
 * @param {object} message - Message to store
 * @param {boolean} furtherVerification - Whether further verification is needed
 * @returns {Promise<object>} Storage result
 */
async function storeAppTemporaryMessage(message, furtherVerification = false) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    // Add timestamp and verification status
    const messageToStore = {
      ...message,
      storedAt: Date.now(),
      furtherVerification: furtherVerification || false,
    };

    await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, messageToStore);

    log.info(`Temporary app message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'Temporary message stored' };
  } catch (error) {
    log.error(`Error storing temporary app message: ${error.message}`);
    throw error;
  }
}

/**
 * Store app permanent message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppPermanentMessage(message) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const messageToStore = {
      ...message,
      storedAt: Date.now(),
    };

    await dbHelper.insertOneToDatabase(database, globalAppsMessages, messageToStore);

    log.info(`Permanent app message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'Permanent message stored' };
  } catch (error) {
    log.error(`Error storing permanent app message: ${error.message}`);
    throw error;
  }
}

/**
 * Store app running message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppRunningMessage(message) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const locationMessage = {
      ...message,
      status: 'running',
      timestamp: Date.now(),
    };

    await dbHelper.insertOneToDatabase(database, globalAppsLocations, locationMessage);

    log.info(`App running message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'Running message stored' };
  } catch (error) {
    log.error(`Error storing app running message: ${error.message}`);
    throw error;
  }
}

/**
 * Store app installing message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppInstallingMessage(message) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const installingMessage = {
      ...message,
      status: 'installing',
      timestamp: Date.now(),
    };

    await dbHelper.insertOneToDatabase(database, globalAppsInstallingLocations, installingMessage);

    log.info(`App installing message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'Installing message stored' };
  } catch (error) {
    log.error(`Error storing app installing message: ${error.message}`);
    throw error;
  }
}

/**
 * Store app installing error message
 * @param {object} message - Error message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppInstallingErrorMessage(message) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const errorMessage = {
      ...message,
      status: 'error',
      timestamp: Date.now(),
    };

    await dbHelper.insertOneToDatabase(database, globalAppsInstallingLocations, errorMessage);

    log.error(`App installing error message stored for ${message.appName || 'unknown'}: ${message.error || 'Unknown error'}`);
    return { status: 'success', message: 'Error message stored' };
  } catch (error) {
    log.error(`Error storing app installing error message: ${error.message}`);
    throw error;
  }
}

/**
 * Store IP changed message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeIPChangedMessage(message) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const ipChangeMessage = {
      ...message,
      type: 'ip_changed',
      timestamp: Date.now(),
    };

    await dbHelper.insertOneToDatabase(database, globalAppsLocations, ipChangeMessage);

    log.info(`IP changed message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'IP change message stored' };
  } catch (error) {
    log.error(`Error storing IP changed message: ${error.message}`);
    throw error;
  }
}

/**
 * Store app removed message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppRemovedMessage(message) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const removedMessage = {
      ...message,
      status: 'removed',
      timestamp: Date.now(),
    };

    await dbHelper.insertOneToDatabase(database, globalAppsLocations, removedMessage);

    log.info(`App removed message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'Removed message stored' };
  } catch (error) {
    log.error(`Error storing app removed message: ${error.message}`);
    throw error;
  }
}

/**
 * Check if app hash has message
 * @param {string} hash - Hash to check
 * @returns {Promise<boolean>} True if hash has message
 */
async function appHashHasMessage(hash) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);

    const query = { hash, messageNotFound: { $ne: true } };
    const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, query);

    return !!result;
  } catch (error) {
    log.error(`Error checking if app hash has message: ${error.message}`);
    return false;
  }
}

/**
 * Check if app hash has message not found
 * @param {string} hash - Hash to check
 * @returns {Promise<boolean>} True if hash has message not found
 */
async function appHashHasMessageNotFound(hash) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);

    const query = { hash, messageNotFound: true };
    const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, query);

    return !!result;
  } catch (error) {
    log.error(`Error checking if app hash has message not found: ${error.message}`);
    return false;
  }
}

/**
 * Get temporary app messages via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppsTemporaryMessages(req, res) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsTempMessages, query, projection);
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
 * Get permanent app messages via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppsPermanentMessages(req, res) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
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
  verifyAppHash,
  verifyAppMessageSignature,
  verifyAppMessageUpdateSignature,
  requestAppMessage,
  requestAppsMessage,
  requestAppMessageAPI,
  storeAppTemporaryMessage,
  storeAppPermanentMessage,
  storeAppRunningMessage,
  storeAppInstallingMessage,
  storeAppInstallingErrorMessage,
  storeIPChangedMessage,
  storeAppRemovedMessage,
  appHashHasMessage,
  appHashHasMessageNotFound,
  getAppsTemporaryMessages,
  getAppsPermanentMessages,
};