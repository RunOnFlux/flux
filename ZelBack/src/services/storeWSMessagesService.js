const config = require('config');
const dbHelper = require('./dbHelper');
const serviceHelper = require('./serviceHelper');
const appsMessageExistenceService = require('./appsMessageExistenceService');
const appsAuxiliarService = require('./appsAuxiliarService');
const appsEncryptDecryptService = require('./appsEncryptDecryptService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const benchmarkService = require('./benchmarkService');
const log = require('../lib/log');

const appsHashesCollection = config.database.daemon.collections.appsHashes;
const globalAppsTempMessages = config.database.appsglobal.collections.appsTemporaryMessages;
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;
const globalAppsInstallingLocations = config.database.appsglobal.collections.appsInstallingLocations;
const globalAppsInstallingErrorsLocations = config.database.appsglobal.collections.appsInstallingErrorsLocations;

/**
 * To store a temporary message for an app.
 * @param {object} message Message.
 * @param {boolean} furtherVerification Defaults to false.
 * @returns {boolean} True if message is successfully stored and rebroadcasted. Returns false if message is already in cache or has already been broadcast. Otherwise an error is thrown.
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
  const appSpecFormatted = appsAuxiliarService.specificationFormatter(specifications);
  const messageTimestamp = serviceHelper.ensureNumber(message.timestamp);
  const messageVersion = serviceHelper.ensureNumber(message.version);

  // check permanent app message storage
  const appMessage = await appsMessageExistenceService.checkAppMessageExistence(message.hash);
  if (appMessage) {
    // do not rebroadcast further
    return false;
  }
  // check temporary message storage
  const tempMessage = await appsMessageExistenceService.checkAppTemporaryMessageExistence(message.hash);
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
    const appRegistraiton = message.type === 'zelappregister' || message.type === 'fluxappregister';
    if (appSpecFormatted.version >= 8 && appSpecFormatted.enterprise) {
      if (!message.arcaneSender) {
        return new Error('Invalid Flux App message for storing, enterprise app where original sender was not arcane node');
      }
      if (await benchmarkService.isSystemSecure()) {
        // eslint-disable-next-line no-use-before-define
        const appSpecFormattedDecrypted = await appsEncryptDecryptService.checkAndDecryptAppSpecs(
          appSpecFormatted,
          { daemonHeight: block, owner: appSpecFormatted.owner },
        );
        await appsAuxiliarService.verifyAppSpecifications(appSpecFormattedDecrypted, block);
        if (appRegistraiton) {
          await appsAuxiliarService.checkApplicationRegistrationNameConflicts(appSpecFormattedDecrypted, message.hash);
        } else {
          await appsAuxiliarService.checkApplicationUpdateNameRepositoryConflicts(appSpecFormattedDecrypted, messageTimestamp);
        }
      }
    } else {
      await appsAuxiliarService.verifyAppSpecifications(appSpecFormatted, block);
      if (appRegistraiton) {
        await appsAuxiliarService.checkApplicationRegistrationNameConflicts(appSpecFormatted, message.hash);
      } else {
        await appsAuxiliarService.checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, messageTimestamp);
      }
    }

    await appsAuxiliarService.verifyAppHash(message);
    if (appRegistraiton) {
      await appsAuxiliarService.verifyAppMessageSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature);
    } else {
      // get previousAppSpecifications as we need previous owner
      const previousAppSpecs = await appsAuxiliarService.getPreviousAppSpecifications(appSpecFormatted, messageTimestamp);
      const { owner } = previousAppSpecs;
      // here signature is checked against PREVIOUS app owner
      await appsAuxiliarService.verifyAppMessageUpdateSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature, owner, block);
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
  await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, value);
  // it is stored and rebroadcasted
  if (isAppRequested) {
    // node received the message but it is coming from a requestappmessage we should not rebroadcast to all peers
    return false;
  }
  return true;
}

/**
 * To store a message for a running app.
 * @param {object} message Message.
 * @returns {boolean} True if message is successfully stored and rebroadcasted. Returns false if message is old. Throws an error if invalid.
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
    const projection = { _id: 0, runningSince: 1 };
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
 * To store a message for a installing app.
 * @param {object} message Message.
 * @returns {boolean} True if message is successfully stored and rebroadcasted. Returns false if message is old. Throws an error if invalid.
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
 * To store a message for a app error installing.
 * @param {object} message Message.
 * @returns {boolean} True if message is successfully stored and rebroadcasted. Returns false if message is old. Throws an error if invalid.
 */
async function storeAppInstallingErrorMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param broadcastedAt number
  * @param name string
  * @param hash string
  * @param ip string
  * @param error string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.name !== 'string'
    || typeof message.hash !== 'number' || typeof message.error !== 'string') {
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
  // eslint-disable-next-line no-await-in-loop
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
 * To update DB with new node IP that is running app.
 * @param {object} message Message.
 * @returns {boolean} True if message is valid. Returns false if message is old. Throws an error if invalid/wrong properties.
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

/**
 * To remove from DB that the IP is running the app.
 * @param {object} message Message.
 * @returns {boolean} True if message is valid. Returns false if message is old. Throws an error if invalid/wrong properties.
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

module.exports = {
  storeAppTemporaryMessage,
  storeAppRunningMessage,
  storeIPChangedMessage,
  storeAppRemovedMessage,
  storeAppInstallingMessage,
  storeAppInstallingErrorMessage,
};
