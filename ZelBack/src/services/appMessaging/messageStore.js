const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const log = require('../../lib/log');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const messageVerifier = require('./messageVerifier');
const appValidator = require('../appRequirements/appValidator');
const registryManager = require('../appDatabase/registryManager');
// const advancedWorkflows = require('../appLifecycle/advancedWorkflows'); // Moved to dynamic require to avoid circular dependency
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const {
  globalAppsMessages,
  globalAppsTempMessages,
  globalAppsLocations,
  globalAppsInstallingLocations,
  globalAppsInstallingErrorsLocations,
  appsHashesCollection,
} = require('../utils/appConstants');
const { specificationFormatter } = require('../utils/appSpecHelpers');

/**
 * Store temporary app message
 * @param {object} message - Message to store
 * @param {boolean} furtherVerification - Whether further verification is needed
 * @returns {Promise<boolean|Error>} Whether message should be rebroadcast or Error if invalid
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

  // check permanent app message storage
  const appMessage = await messageVerifier.checkAppMessageExistence(message.hash);
  if (appMessage) {
    // do not rebroadcast further
    return false;
  }
  // check temporary message storage
  const tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(message.hash);
  if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
    // do not rebroadcast further
    return false;
  }

  let isAppRequested = false;
  const db = dbHelper.databaseConnection();
  const query = { hash: message.hash };
  const projection = {
    projection: {
      _id: 0,
      message: 1,
      height: 1,
    },
  };
  let database = db.db(config.database.daemon.database);
  const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, query, projection);
  const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
  const daemonHeight = syncStatus.data.height;
  let block = daemonHeight;
  if (result && !result.message) {
    isAppRequested = true;
    block = result.height;
  }

  // data shall already be verified by the broadcasting node. But verify all again.
  // this takes roughly at least 1 second
  if (furtherVerification) {
    // Dynamic require to avoid circular dependency
    const advancedWorkflows = require('../appLifecycle/advancedWorkflows');
    const appRegistration = message.type === 'zelappregister' || message.type === 'fluxappregister';
    if (appSpecFormatted.version >= 8 && appSpecFormatted.enterprise) {
      if (!message.arcaneSender) {
        return new Error('Invalid Flux App message for storing, enterprise app where original sender was not arcane node');
      }
      // eslint-disable-next-line global-require
      const fluxService = require('../fluxService');
      if (await fluxService.isSystemSecure()) {
        // eslint-disable-next-line no-use-before-define
        const appSpecDecrypted = await checkAndDecryptAppSpecs(
          appSpecFormatted,
          { daemonHeight: block, owner: appSpecFormatted.owner },
        );
        // eslint-disable-next-line no-use-before-define
        const appSpecFormattedDecrypted = specificationFormatter(appSpecDecrypted);
        await appValidator.verifyAppSpecifications(appSpecFormattedDecrypted, block);
        if (appRegistration) {
          await registryManager.checkApplicationRegistrationNameConflicts(appSpecFormattedDecrypted, message.hash);
        } else {
          await advancedWorkflows.validateApplicationUpdateCompatibility(appSpecFormattedDecrypted, messageTimestamp);
        }
      }
    } else {
      await appValidator.verifyAppSpecifications(appSpecFormatted, block);
      if (appRegistration) {
        await registryManager.checkApplicationRegistrationNameConflicts(appSpecFormatted, message.hash);
      } else {
        await advancedWorkflows.validateApplicationUpdateCompatibility(appSpecFormatted, messageTimestamp);
      }
    }

    await messageVerifier.verifyAppHash(message);
    if (appRegistration) {
      await messageVerifier.verifyAppMessageSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature);
    } else {
      // get previousAppSpecifications as we need previous owner
      const previousAppSpecs = await advancedWorkflows.getPreviousAppSpecifications(appSpecFormatted, messageTimestamp);
      const { owner } = previousAppSpecs;
      // here signature is checked against PREVIOUS app owner
      await messageVerifier.verifyAppMessageUpdateSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature, owner, block);
    }
  }

  const receivedAt = Date.now();
  const validTill = receivedAt + (60 * 60 * 1000); // 60 minutes

  const newMessage = {
    appSpecifications: appSpecFormatted,
    type: message.type, // shall be fluxappregister, fluxappupdate
    version: messageVersion,
    hash: message.hash,
    timestamp: messageTimestamp,
    signature: message.signature,
    receivedAt: new Date(receivedAt),
    expireAt: new Date(validTill),
    arcaneSender: message.arcaneSender,
  };
  const value = newMessage;

  database = db.db(config.database.appsglobal.database);
  // message does not exist anywhere and is ok, store it
  await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, value).catch((error) => {
    log.error(error);
    throw error;
  });
  // it is stored and rebroadcasted
  if (isAppRequested) {
    // node received the message but it is coming from a requestappmessage we should not rebroadcast to all peers
    return false;
  }
  return true;
}

/**
 * Store permanent app message
 * @param {object} message - Message to store
 * @returns {Promise<boolean>} Whether message was stored successfully
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
 * @returns {Promise<boolean|Error>} Whether message should be rebroadcast or Error if invalid
 */
async function storeAppRunningMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param hash string
  * @param broadcastedAt number
  * @param name string
  * @param ip string
  * @param osUptime number (optional)
  * @param staticIp string (optional)
  * @param runningSince number (optional)
  * @param apps array (for version 2)
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

  let messageNotOk = false;
  for (let i = 0; i < appsMessages.length; i += 1) {
    const app = appsMessages[i];
    const newAppRunningMessage = {
      name: app.name,
      hash: app.hash, // hash of application specifics that are running
      ip: message.ip,
      broadcastedAt: new Date(message.broadcastedAt),
      expireAt: new Date(validTill),
      osUptime: message.osUptime,
      staticIp: message.staticIp,
    };

    // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
    const queryFind = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
    const projection = { _id: 0, runningSince: 1, broadcastedAt: 1 };
    // we already have the exact same data
    // eslint-disable-next-line no-await-in-loop
    const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
    if (result && result.broadcastedAt && result.broadcastedAt >= newAppRunningMessage.broadcastedAt) {
      // found a message that was already stored/probably from duplicated message processsed
      messageNotOk = true;
      break;
    }
    if (message.runningSince) {
      newAppRunningMessage.runningSince = new Date(message.runningSince);
    } else if (app.runningSince) {
      newAppRunningMessage.runningSince = new Date(app.runningSince);
    } else if (result && result.runningSince) {
      newAppRunningMessage.runningSince = result.runningSince;
    }
    const queryUpdate = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
    const update = { $set: newAppRunningMessage };
    const options = {
      upsert: true,
    };
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.updateOneInDatabase(database, globalAppsLocations, queryUpdate, update, options);
  }

  if (message.version === 2 && appsMessages.length === 0) {
    const queryFind = { ip: message.ip };
    const projection = { _id: 0, runningSince: 1 };
    // we already have the exact same data
    const result = await dbHelper.findInDatabase(database, globalAppsLocations, queryFind, projection);
    if (result.length > 0) {
      await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, queryFind);
    } else {
      return false;
    }
  }

  if (message.version === 1) {
    const queryFind = { name: appsMessages[0].name, ip: message.ip };
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingLocations, queryFind);
  }

  if (messageNotOk) {
    return false;
  }

  // all stored, rebroadcast
  return true;
}

/**
 * Store app installing message
 * @param {object} message - Message to store
 * @returns {Promise<boolean|Error>} Whether message should be rebroadcast or Error if invalid
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
  // eslint-disable-next-line no-await-in-loop
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
  // eslint-disable-next-line no-await-in-loop
  await dbHelper.updateOneInDatabase(database, globalAppsInstallingLocations, queryUpdate, update, options);

  // all stored, rebroadcast
  return true;
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
  * @param hash string
  * @param ip string
  * @param error string
  * @param broadcastedAt number
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.name !== 'string'
    || typeof message.hash !== 'string' || typeof message.error !== 'string') {
    return new Error('Invalid Flux App Installing Error message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux App Installing Error message for storing version ${message.version} not supported`);
  }

  const validTill = message.broadcastedAt + (60 * 60 * 1000); // 60 minutes
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid fluxappinstallingerror message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const newAppInstallingErrorMessage = {
    name: message.name,
    hash: message.hash,
    ip: message.ip,
    error: message.error,
    broadcastedAt: new Date(message.broadcastedAt),
    startCacheAt: new Date(message.broadcastedAt),
    expireAt: new Date(validTill),
  };

  let queryFind = { name: newAppInstallingErrorMessage.name, hash: newAppInstallingErrorMessage.hash, ip: newAppInstallingErrorMessage.ip };
  const projection = { _id: 0 };
  // we already have the exact same data
  // eslint-disable-next-line no-await-in-loop
  const result = await dbHelper.findOneInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, projection);
  if (result && result.broadcastedAt && result.broadcastedAt >= newAppInstallingErrorMessage.broadcastedAt) {
    // found a message that was already stored/probably from duplicated message processsed
    return false;
  }

  let update = { $set: newAppInstallingErrorMessage };
  const options = {
    upsert: true,
  };
  await dbHelper.updateOneInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, update, options);

  queryFind = { name: newAppInstallingErrorMessage.name, hash: newAppInstallingErrorMessage.hash };
  // we already have the exact same data
  // eslint-disable-next-line no-await-in-loop
  const results = await dbHelper.countInDatabase(database, globalAppsInstallingErrorsLocations, queryFind);
  if (results >= 5) {
    update = { $set: { startCacheAt: null, expireAt: null } };
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.updateInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, update);
  }
  // all stored, rebroadcast
  return true;
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
  * @param oldIP string
  * @param newIP string
  * @param broadcastedAt number
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.oldIP !== 'string' || typeof message.newIP !== 'string') {
    return new Error('Invalid Flux IP Changed message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux IP Changed message for storing version ${message.version} not supported`);
  }

  if (!message.oldIP || !message.newIP) {
    return new Error('Invalid Flux IP Changed message oldIP and newIP cannot be empty');
  }

  if (message.oldIP === message.newIP) {
    return new Error(`Invalid Flux IP Changed message oldIP and newIP are the same ${message.newIP}`);
  }

  log.info('New Flux IP Changed message received.');
  log.info(message);

  const validTill = message.broadcastedAt + (65 * 60 * 1000); // 3900 seconds
  if (validTill < Date.now()) {
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = { ip: message.oldIP };
  const update = { $set: { ip: message.newIP, broadcastedAt: new Date(message.broadcastedAt) } };
  await dbHelper.updateInDatabase(database, globalAppsLocations, query, update);

  // all stored, rebroadcast
  return true;
}

module.exports = {
  storeAppTemporaryMessage,
  storeAppPermanentMessage,
  storeAppRunningMessage,
  storeAppInstallingMessage,
  storeAppRemovedMessage,
  storeAppInstallingErrorMessage,
  storeIPChangedMessage,
};
