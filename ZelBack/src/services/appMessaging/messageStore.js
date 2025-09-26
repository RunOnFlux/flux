const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const log = require('../../lib/log');
const {
  globalAppsMessages,
  globalAppsTempMessages,
  globalAppsLocations,
  globalAppsInstallingLocations
} = require('../utils/appConstants');
const { specificationFormatter } = require('../utils/appSpecHelpers');

/**
 * Store temporary app message
 * @param {object} message - Message to store
 * @param {boolean} furtherVerification - Whether further verification is needed
 * @returns {Promise<object>} Storage result
 */
async function storeAppTemporaryMessage(message, furtherVerification = false) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number' || typeof message.signature !== 'string' || typeof message.timestamp !== 'number' || typeof message.hash !== 'string') {
    return new Error('Invalid Flux App message for storing');
  }
  // expect one to be present
  if (typeof message.appSpecifications !== 'object' && typeof message.zelAppSpecifications !== 'object') {
    return new Error('Invalid Flux App message for storing');
  }

  const specifications = message.appSpecifications || message.zelAppSpecifications;
  // eslint-disable-next-line no-use-before-define
  const appSpecFormatted = specificationFormatter(specifications);
  const messageTimestamp = serviceHelper.ensureNumber(message.timestamp);
  const messageVersion = serviceHelper.ensureNumber(message.version);

  // Verify message hash and signature FIRST before checking database
  if (furtherVerification) {
    try {
      // Import verification functions locally to avoid circular dependency
      const { verifyAppHash, verifyAppMessageSignature } = require('./messageVerifier');

      // Check if required fields are present for verification
      if (!appSpecFormatted.owner || !message.signature) {
        log.warn('App message missing required fields for verification');
        return false;
      }

      // Verify hash matches message content
      const hashValid = await verifyAppHash(message);
      if (!hashValid) {
        log.warn('App message hash verification failed');
        return false;
      }

      // Verify signature - pass signature directly as in original code
      const signatureValid = await verifyAppMessageSignature(
        message.type,
        messageVersion,
        appSpecFormatted,
        messageTimestamp,
        message.signature
      );
      if (signatureValid !== true) {
        log.warn(`App message signature verification failed for ${appSpecFormatted.name} - type: ${message.type}, version: ${messageVersion}`);
        return false;
      }
    } catch (error) {
      log.warn(`App message verification failed: ${error.message}`);
      return false;
    }
  }

  // Import these functions locally to avoid circular dependency
  const { checkAppMessageExistence, checkAppTemporaryMessageExistence } = require('./messageVerifier');

  // check permanent app message storage
  const appMessage = await checkAppMessageExistence(message.hash);
  if (appMessage) {
    // do not rebroadcast further
    return false;
  }
  // check temporary message storage
  const tempMessage = await checkAppTemporaryMessageExistence(message.hash);
  if (tempMessage) {
    // rebroadcast
    return true;
  }

  const adjustedAppSpecFormatted = appSpecFormatted;

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  // Add timestamp and verification status
  const messageToStore = {
    type: message.type,
    version: messageVersion,
    appSpecifications: adjustedAppSpecFormatted,
    hash: message.hash,
    timestamp: messageTimestamp,
    signature: message.signature,
    createdAt: new Date(),
    expireAt: new Date(messageTimestamp + (3 * 24 * 60 * 60 * 1000)), // 3 days
    furtherVerification: furtherVerification || false,
  };

  try {
    await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, messageToStore);
    log.info(`Temporary app message stored for ${adjustedAppSpecFormatted.name}`);
    return true;
  } catch (error) {
    log.error(`Error storing temporary app message: ${error.message}`);
    throw error;
  }
}

/**
 * Store permanent app message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppPermanentMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  * @param txid string
  * @param height number
  * @param valueSat number
  */
  if (!message || !message.appSpecifications || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number' || typeof message.appSpecifications !== 'object' || typeof message.signature !== 'string'
    || typeof message.timestamp !== 'number' || typeof message.hash !== 'string' || typeof message.txid !== 'string' || typeof message.height !== 'number' || typeof message.valueSat !== 'number') {
    throw new Error('Invalid Flux App message for storing');
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  await dbHelper.insertOneToDatabase(database, globalAppsMessages, message).catch((error) => {
    log.error(error);
    throw error;
  });
  return true;
}

/**
 * Store app running message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppRunningMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param hash string
  * @param broadcastedAt number
  * @param name string
  * @param ip string
  */
  const appsMessages = [];
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string') {
    return new Error('Invalid Flux App Running message for storing');
  }

  if (message.version !== 1 && message.version !== 2) {
    return new Error(`Invalid Flux App Running message for storing version ${message.version} not supported`);
  }

  if (message.version === 1) {
    if (typeof message.hash !== 'string' || typeof message.name !== 'string') {
      return new Error('Invalid Flux App Running message for storing');
    }
    const app = {
      name: message.name,
      hash: message.hash,
    };
    appsMessages.push(app);
  }

  if (message.version === 2) {
    if (!message.apps || !Array.isArray(message.apps)) {
      return new Error('Invalid Flux App Running message for storing');
    }
    for (let i = 0; i < message.apps.length; i += 1) {
      const app = message.apps[i];
      appsMessages.push(app);
      if (typeof app.hash !== 'string' || typeof app.name !== 'string') {
        return new Error('Invalid Flux App Running v2 message for storing');
      }
    }
  }

  const validTill = message.broadcastedAt + (125 * 60 * 1000); // 7500 seconds
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid Fluxapprunning message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  try {
    // eslint-disable-next-line no-restricted-syntax
    for (const appMessage of appsMessages) {
      const newAppRunningMessage = {
        name: appMessage.name,
        hash: appMessage.hash,
        ip: message.ip,
        broadcastedAt: new Date(message.broadcastedAt),
        expireAt: new Date(validTill),
      };

      // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
      const queryFind = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
      const projection = { _id: 0 };
      // we already have the exact same data
      // eslint-disable-next-line no-await-in-loop
      const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
      if (result && result.broadcastedAt && result.broadcastedAt >= newAppRunningMessage.broadcastedAt) {
        // found a message that was already stored/probably from duplicated message processsed
        // eslint-disable-next-line no-continue
        continue;
      }

      const queryUpdate = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
      const update = { $set: newAppRunningMessage };
      const options = {
        upsert: true,
      };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.updateOneInDatabase(database, globalAppsLocations, queryUpdate, update, options);
    }

    return true;
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

  try {
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

    return true;
  } catch (error) {
    log.error(`Error storing app installing message: ${error.message}`);
    throw error;
  }
}


/**
 * Get temporary app messages
 * @param {object} filter - Filter criteria
 * @returns {Promise<Array>} Array of temporary messages
 */
async function getAppsTemporaryMessages(filter = {}) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const messages = await dbHelper.findInDatabase(database, globalAppsTempMessages, filter);
    return messages;
  } catch (error) {
    log.error(`Error getting temporary app messages: ${error.message}`);
    return [];
  }
}

/**
 * Get permanent app messages
 * @param {object} filter - Filter criteria
 * @returns {Promise<Array>} Array of permanent messages
 */
async function getAppsPermanentMessages(filter = {}) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const messages = await dbHelper.findInDatabase(database, globalAppsMessages, filter);
    return messages;
  } catch (error) {
    log.error(`Error getting permanent app messages: ${error.message}`);
    return [];
  }
}

/**
 * Clean up old temporary messages
 * @param {number} maxAge - Maximum age in milliseconds
 * @returns {Promise<number>} Number of messages cleaned up
 */
async function cleanupOldTemporaryMessages(maxAge = 24 * 60 * 60 * 1000) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const cutoffTime = Date.now() - maxAge;
    const query = { storedAt: { $lt: cutoffTime } };

    const result = await dbHelper.removeInDatabase(database, globalAppsTempMessages, query);
    log.info(`Cleaned up ${result.deletedCount || 0} old temporary messages`);

    return result.deletedCount || 0;
  } catch (error) {
    log.error(`Error cleaning up old temporary messages: ${error.message}`);
    return 0;
  }
}

/**
 * Store app removed message
 * @param {object} message - Message to store
 * @returns {Promise<boolean|Error>} Whether message should be rebroadcast or Error if invalid
 */
async function storeAppRemovedMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param ip string
  * @param appName string
  * @param broadcastedAt number
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.appName !== 'string') {
    return new Error('Invalid Flux App Removed message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux App Removed message for storing version ${message.version} not supported`);
  }

  if (!message.ip) {
    return new Error('Invalid Flux App Removed message ip cannot be empty');
  }

  if (!message.appName) {
    return new Error('Invalid Flux App Removed message appName cannot be empty');
  }

  log.info('New Flux App Removed message received.');
  log.info(message);

  const validTill = message.broadcastedAt + (65 * 60 * 1000); // 3900 seconds
  if (validTill < Date.now()) {
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = { ip: message.ip, name: message.appName };
  const projection = {};
  await dbHelper.findOneAndDeleteInDatabase(database, globalAppsLocations, query, projection);

  // all stored, rebroadcast
  return true;
}

/**
 * Store app installing error message
 * @param {object} message - Error message to store
 * @returns {Promise<boolean>} Whether message should be rebroadcast
 */
async function storeAppInstallingErrorMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param name string
  * @param ip string
  * @param error string
  * @param broadcastedAt number
  */
  try {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
      || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.name !== 'string') {
      log.error('Invalid Flux App Installing Error message for storing');
      return false;
    }

    if (message.version !== 1) {
      log.error(`Invalid Flux App Installing Error message for storing version ${message.version} not supported`);
      return false;
    }

    const validTill = message.broadcastedAt + (10 * 60 * 1000); // 10 minutes
    if (validTill < Date.now()) {
      log.warn(`Rejecting old/not valid fluxappinstallingerror message, message:${JSON.stringify(message)}`);
      // reject old message
      return false;
    }

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const newAppErrorMessage = {
      name: message.name,
      ip: message.ip,
      error: message.error || 'Unknown error',
      broadcastedAt: new Date(message.broadcastedAt),
      expireAt: new Date(validTill),
      status: 'error',
    };

    // Check if we already have this error message
    const queryFind = { name: newAppErrorMessage.name, ip: newAppErrorMessage.ip };
    const projection = { _id: 0 };
    const existingMessage = await dbHelper.findOneInDatabase(database, globalAppsInstallingLocations, queryFind, projection);

    if (existingMessage && existingMessage.broadcastedAt && existingMessage.broadcastedAt >= newAppErrorMessage.broadcastedAt) {
      // found a message that was already stored/probably from duplicated message processed
      return false;
    }

    // Update or insert the error message
    const queryUpdate = { name: newAppErrorMessage.name, ip: newAppErrorMessage.ip };
    const update = { $set: newAppErrorMessage };
    const options = { upsert: true };

    await dbHelper.updateOneInDatabase(database, globalAppsInstallingLocations, queryUpdate, update, options);

    log.error(`App installing error message stored for ${message.name} on ${message.ip}: ${message.error || 'Unknown error'}`);
    return true; // rebroadcast to peers
  } catch (error) {
    log.error(`Error storing app installing error message: ${error.message}`);
    return false;
  }
}

/**
 * Store IP changed message
 * @param {object} message - Message to store
 * @returns {Promise<boolean>} Whether message should be rebroadcast
 */
async function storeIPChangedMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param name string
  * @param oldIP string
  * @param newIP string
  * @param broadcastedAt number
  */
  try {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
      || typeof message.broadcastedAt !== 'number' || typeof message.oldIP !== 'string' || typeof message.newIP !== 'string'
      || typeof message.name !== 'string') {
      log.error('Invalid IP Changed message for storing');
      return false;
    }

    if (message.version !== 1) {
      log.error(`Invalid IP Changed message for storing version ${message.version} not supported`);
      return false;
    }

    const validTill = message.broadcastedAt + (30 * 60 * 1000); // 30 minutes
    if (validTill < Date.now()) {
      log.warn(`Rejecting old/not valid IP changed message, message:${JSON.stringify(message)}`);
      // reject old message
      return false;
    }

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    // Remove old location
    await dbHelper.removeFromDatabase(database, globalAppsLocations, { name: message.name, ip: message.oldIP });

    // Add new location
    const newAppLocationMessage = {
      name: message.name,
      ip: message.newIP,
      broadcastedAt: new Date(message.broadcastedAt),
      expireAt: new Date(validTill),
      ipChanged: true,
      previousIP: message.oldIP,
    };

    const queryUpdate = { name: newAppLocationMessage.name, ip: newAppLocationMessage.ip };
    const update = { $set: newAppLocationMessage };
    const options = { upsert: true };

    await dbHelper.updateOneInDatabase(database, globalAppsLocations, queryUpdate, update, options);

    log.info(`IP changed message stored for ${message.name}: ${message.oldIP} -> ${message.newIP}`);
    return true; // rebroadcast to peers
  } catch (error) {
    log.error(`Error storing IP changed message: ${error.message}`);
    return false;
  }
}

module.exports = {
  storeAppTemporaryMessage,
  storeAppPermanentMessage,
  storeAppRunningMessage,
  storeAppInstallingMessage,
  storeAppRemovedMessage,
  storeAppInstallingErrorMessage,
  storeIPChangedMessage,
  getAppsTemporaryMessages,
  getAppsPermanentMessages,
  cleanupOldTemporaryMessages,
};