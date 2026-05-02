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
const globalState = require('../utils/globalState');
const {
  globalAppsMessages,
  globalAppsTempMessages,
  globalAppsLocations,
  globalAppsInstallingLocations,
  globalAppsInstallingErrorsLocations,
  globalAppsInstallingErrorsBroadcasts,
  appsHashesCollection,
} = require('../utils/appConstants');
const { specificationFormatter } = require('../utils/appSpecHelpers');

const GOSSIP_VALIDITY_MS = 5 * 60 * 1000;
const RUNNING_EXPIRY_MS = 125 * 60 * 1000;
const INSTALLING_EXPIRY_MS = 15 * 60 * 1000;
const INSTALLING_ERRORS_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Store temporary app message
 * @param {object} message - Message to store
 * @param {object} [options] - Options
 * @param {boolean} [options.furtherVerification=true] - Whether further verification is needed
 * @returns {Promise<boolean|Error>} Whether message should be rebroadcast or Error if invalid
 */
async function storeAppTemporaryMessage(message, options = {}) {
  const furtherVerification = options.furtherVerification ?? true;
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
      txid: 1,
      value: 1,
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
    // eslint-disable-next-line global-require
    const advancedWorkflows = require('../appLifecycle/advancedWorkflows');
    const appRegistration = message.type === 'zelappregister' || message.type === 'fluxappregister';

    // For updates, fetch previous app specs first - if registration doesn't exist yet, queue the update
    let previousAppSpecs = null;
    if (!appRegistration) {
      previousAppSpecs = await advancedWorkflows.getPreviousAppSpecifications(appSpecFormatted, messageTimestamp);
      if (!previousAppSpecs) {
        // Registration doesn't exist yet - queue this update for later processing
        const appName = appSpecFormatted.name;
        log.info(`Queueing update for ${appName} - registration not yet stored`);
        globalState.queuePendingUpdate(appName, message, block);
        return false; // Don't rebroadcast - we'll process when registration arrives
      }
    }

    if (appSpecFormatted.version >= 8 && appSpecFormatted.enterprise) {
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
          await advancedWorkflows.validateApplicationUpdateCompatibility(appSpecFormattedDecrypted, previousAppSpecs);
        }
      }
    } else {
      await appValidator.verifyAppSpecifications(appSpecFormatted, block);
      if (appRegistration) {
        await registryManager.checkApplicationRegistrationNameConflicts(appSpecFormatted, message.hash);
      } else {
        await advancedWorkflows.validateApplicationUpdateCompatibility(appSpecFormatted, previousAppSpecs);
      }
    }

    await messageVerifier.verifyAppHash(message);
    if (appRegistration) {
      await messageVerifier.verifyAppMessageSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature);
    } else {
      // previousAppSpecs already fetched above for update validation
      const { owner } = previousAppSpecs;
      // here signature is checked against PREVIOUS app owner
      await messageVerifier.verifyAppMessageUpdateSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature, owner, block, previousAppSpecs);
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
    if (result && result.txid && result.height) {
      setImmediate(() => {
        messageVerifier.checkAndRequestApp(message.hash, result.txid, result.height, result.value, 2)
          .catch((err) => log.error(`Immediate promotion failed for ${message.hash}: ${err.message}`));
      });
    }
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

  if (message.broadcastedAt + GOSSIP_VALIDITY_MS < Date.now()) {
    log.warn(`Rejecting old/not valid Fluxapprunning message, message:${JSON.stringify(message)}`);
    return { stored: false, rebroadcast: false };
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const expireAt = new Date(message.broadcastedAt + RUNNING_EXPIRY_MS);

  let anyStored = false;
  for (let i = 0; i < appsMessages.length; i += 1) {
    const app = appsMessages[i];
    const newAppRunningMessage = {
      name: app.name,
      hash: app.hash, // hash of application specifics that are running
      ip: message.ip,
      broadcastedAt: new Date(message.broadcastedAt),
      expireAt,
      osUptime: message.osUptime,
      staticIp: message.staticIp,
    };

    // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
    const queryFind = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
    const projection = { _id: 0, runningSince: 1, broadcastedAt: 1 };
    // eslint-disable-next-line no-await-in-loop
    const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
    if (result && result.broadcastedAt && result.broadcastedAt >= newAppRunningMessage.broadcastedAt) {
      // eslint-disable-next-line no-continue
      continue;
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
    anyStored = true;
  }

  if (message.version === 2 && appsMessages.length === 0) {
    const result = await dbHelper.findInDatabase(database, globalAppsLocations, { ip: message.ip }, { _id: 0, runningSince: 1 });
    if (result.length > 0) {
      const broadcastDate = new Date(message.broadcastedAt);
      const olderThanBroadcast = { ip: message.ip, broadcastedAt: { $lte: broadcastDate } };
      await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, olderThanBroadcast);
      await dbHelper.removeDocumentsFromCollection(database, appsRunningBroadcasts, olderThanBroadcast);
      await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingLocations, { ip: message.ip });
      await dbHelper.removeDocumentsFromCollection(database, appsInstallingBroadcasts, { 'data.ip': message.ip });
      anyStored = true;
    } else {
      return { stored: false, rebroadcast: false };
    }
  }

  for (const app of appsMessages) {
    const queryFind = { name: app.name, ip: message.ip };
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingLocations, queryFind);
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.removeDocumentsFromCollection(database, appsInstallingBroadcasts, { 'data.name': app.name, 'data.ip': message.ip });
  }

  return { stored: anyStored, rebroadcast: anyStored };
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

  if (message.broadcastedAt + GOSSIP_VALIDITY_MS < Date.now()) {
    log.warn(`Rejecting old/not valid fluxappinstalling message, message:${JSON.stringify(message)}`);
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const newAppInstallingMessage = {
    name: message.name,
    ip: message.ip,
    broadcastedAt: new Date(message.broadcastedAt),
    expireAt: new Date(message.broadcastedAt + INSTALLING_EXPIRY_MS),
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

  if (message.broadcastedAt + GOSSIP_VALIDITY_MS < Date.now()) {
    log.warn(`Rejecting old/not valid fluxappinstallingerror message, message:${JSON.stringify(message)}`);
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
    expireAt: new Date(message.broadcastedAt + INSTALLING_ERRORS_EXPIRY_MS),
  };

  const queryFind = { name: newAppInstallingErrorMessage.name, hash: newAppInstallingErrorMessage.hash, ip: newAppInstallingErrorMessage.ip };
  const projection = { _id: 0, broadcastedAt: 1 };
  const result = await dbHelper.findOneInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, projection);
  if (result && result.broadcastedAt && result.broadcastedAt >= newAppInstallingErrorMessage.broadcastedAt) {
    return false;
  }

  const update = { $set: newAppInstallingErrorMessage };
  await dbHelper.updateOneInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, update, { upsert: true });

  const installingQuery = { name: newAppInstallingErrorMessage.name, ip: newAppInstallingErrorMessage.ip };
  await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingLocations, installingQuery);
  await dbHelper.removeDocumentsFromCollection(database, appsInstallingBroadcasts, { 'data.name': newAppInstallingErrorMessage.name, 'data.ip': newAppInstallingErrorMessage.ip });

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

const appsRunningBroadcasts = config.database.appsglobal.collections.appsRunningBroadcasts;

function storeSignedAppRunningBroadcast(signedBroadcast) {
  const { data } = signedBroadcast;
  if (!data || !data.ip || !data.broadcastedAt) return;
  if (data.broadcastedAt + RUNNING_EXPIRY_MS < Date.now()) return;
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const doc = {
    ip: data.ip,
    version: signedBroadcast.version,
    timestamp: signedBroadcast.timestamp,
    pubKey: signedBroadcast.pubKey,
    signature: signedBroadcast.signature,
    data,
    broadcastedAt: new Date(data.broadcastedAt),
    expireAt: new Date(data.broadcastedAt + RUNNING_EXPIRY_MS),
  };
  const filter = data.apps ? { ip: data.ip } : { ip: data.ip, 'data.name': data.name };
  return dbHelper.updateOneInDatabase(
    database, appsRunningBroadcasts,
    filter,
    { $set: doc },
    { upsert: true },
  ).catch((err) => log.error(`storeSignedAppRunningBroadcast: ${err.message}`));
}

async function storeBatchAppRunningMessages(verifiedBroadcasts) {
  if (verifiedBroadcasts.length === 0) return { stored: 0 };
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const signedOps = [];
  const locationOps = [];
  const v2AppsByIp = new Map();

  for (const broadcast of verifiedBroadcasts) {
    const { data } = broadcast;
    const validTill = data.broadcastedAt + RUNNING_EXPIRY_MS;
    if (validTill < Date.now()) continue;

    const filter = data.apps ? { ip: data.ip } : { ip: data.ip, 'data.name': data.name };
    signedOps.push({
      updateOne: {
        filter,
        update: {
          $set: {
            ip: data.ip,
            version: broadcast.version,
            timestamp: broadcast.timestamp,
            pubKey: broadcast.pubKey,
            signature: broadcast.signature,
            data,
            broadcastedAt: new Date(data.broadcastedAt),
            expireAt: new Date(validTill),
          },
        },
        upsert: true,
      },
    });

    const apps = data.version === 2 ? (data.apps || []) : [{ name: data.name, hash: data.hash }];
    if (data.version === 2 && apps.length > 0) {
      const existing = v2AppsByIp.get(data.ip);
      if (!existing || data.broadcastedAt > existing.broadcastedAt) {
        v2AppsByIp.set(data.ip, { names: apps.map((a) => a.name), broadcastedAt: data.broadcastedAt });
      }
    }
    const incomingDate = new Date(data.broadcastedAt);
    const incomingExpiry = new Date(validTill);
    const isNewer = { $gt: [incomingDate, { $ifNull: ['$broadcastedAt', new Date(0)] }] };
    for (const app of apps) {
      const setFields = {
        name: app.name,
        ip: data.ip,
        hash: { $cond: [isNewer, app.hash, { $ifNull: ['$hash', app.hash] }] },
        broadcastedAt: { $cond: [isNewer, incomingDate, '$broadcastedAt'] },
        expireAt: { $cond: [isNewer, incomingExpiry, '$expireAt'] },
        osUptime: { $cond: [isNewer, data.osUptime, { $ifNull: ['$osUptime', data.osUptime] }] },
        staticIp: { $cond: [isNewer, data.staticIp ?? null, { $ifNull: ['$staticIp', data.staticIp ?? null] }] },
      };
      const runningSince = data.runningSince ? new Date(data.runningSince) : (app.runningSince ? new Date(app.runningSince) : null);
      if (runningSince) {
        setFields.runningSince = { $cond: [isNewer, runningSince, { $ifNull: ['$runningSince', runningSince] }] };
      }
      locationOps.push({
        updateOne: {
          filter: { name: app.name, ip: data.ip },
          update: [{ $set: setFields }],
          upsert: true,
        },
      });
    }
  }

  for (const [ip, { names, broadcastedAt }] of v2AppsByIp) {
    const cutoff = new Date(broadcastedAt);
    locationOps.push({
      deleteMany: {
        filter: { ip, name: { $nin: names }, broadcastedAt: { $lte: cutoff } },
      },
    });
    signedOps.push({
      deleteMany: {
        filter: { ip, 'data.name': { $nin: [null, ...names] }, broadcastedAt: { $lte: cutoff } },
      },
    });
  }

  if (signedOps.length > 0) {
    await database.collection(appsRunningBroadcasts).bulkWrite(signedOps, { ordered: false })
      .catch((err) => log.error(`storeBatchAppRunningMessages signed: ${err.message}`));
  }
  if (locationOps.length > 0) {
    await database.collection(globalAppsLocations).bulkWrite(locationOps, { ordered: false })
      .catch((err) => log.error(`storeBatchAppRunningMessages locations: ${err.message}`));
  }

  return { stored: signedOps.length };
}

const appsInstallingBroadcasts = config.database.appsglobal.collections.appsInstallingBroadcasts;

function storeSignedAppInstallingBroadcast(signedBroadcast) {
  const { data } = signedBroadcast;
  if (!data || !data.ip || !data.name || !data.broadcastedAt) return;
  if (data.broadcastedAt + INSTALLING_EXPIRY_MS < Date.now()) return;
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const doc = {
    version: signedBroadcast.version,
    timestamp: signedBroadcast.timestamp,
    pubKey: signedBroadcast.pubKey,
    signature: signedBroadcast.signature,
    data,
    broadcastedAt: new Date(data.broadcastedAt),
    expireAt: new Date(data.broadcastedAt + INSTALLING_EXPIRY_MS),
  };
  return dbHelper.updateOneInDatabase(
    database, appsInstallingBroadcasts,
    { 'data.name': data.name, 'data.ip': data.ip },
    { $set: doc },
    { upsert: true },
  ).catch((err) => log.error(`storeSignedAppInstallingBroadcast: ${err.message}`));
}

async function storeBatchAppInstallingMessages(verifiedBroadcasts) {
  if (verifiedBroadcasts.length === 0) return { stored: 0 };
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const signedOps = [];
  const locationOps = [];

  for (const broadcast of verifiedBroadcasts) {
    const { data } = broadcast;
    const validTill = data.broadcastedAt + INSTALLING_EXPIRY_MS;
    if (validTill < Date.now()) continue;

    signedOps.push({
      updateOne: {
        filter: { 'data.name': data.name, 'data.ip': data.ip },
        update: {
          $set: {
            version: broadcast.version,
            timestamp: broadcast.timestamp,
            pubKey: broadcast.pubKey,
            signature: broadcast.signature,
            data,
            broadcastedAt: new Date(data.broadcastedAt),
            expireAt: new Date(validTill),
          },
        },
        upsert: true,
      },
    });

    const incomingDate = new Date(data.broadcastedAt);
    const incomingExpiry = new Date(validTill);
    const isNewer = { $gt: [incomingDate, { $ifNull: ['$broadcastedAt', new Date(0)] }] };
    locationOps.push({
      updateOne: {
        filter: { name: data.name, ip: data.ip },
        update: [{ $set: {
          name: data.name,
          ip: data.ip,
          broadcastedAt: { $cond: [isNewer, incomingDate, '$broadcastedAt'] },
          expireAt: { $cond: [isNewer, incomingExpiry, '$expireAt'] },
        } }],
        upsert: true,
      },
    });
  }

  if (signedOps.length > 0) {
    await database.collection(appsInstallingBroadcasts).bulkWrite(signedOps, { ordered: false })
      .catch((err) => log.error(`storeBatchAppInstallingMessages signed: ${err.message}`));
  }
  if (locationOps.length > 0) {
    await database.collection(globalAppsInstallingLocations).bulkWrite(locationOps, { ordered: false })
      .catch((err) => log.error(`storeBatchAppInstallingMessages locations: ${err.message}`));
  }
  return { stored: signedOps.length };
}

function storeSignedAppInstallingErrorBroadcast(signedBroadcast) {
  const { data } = signedBroadcast;
  if (!data || !data.ip || !data.name || !data.hash || !data.broadcastedAt) return;
  if (data.broadcastedAt + INSTALLING_ERRORS_EXPIRY_MS < Date.now()) return;
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const doc = {
    version: signedBroadcast.version,
    timestamp: signedBroadcast.timestamp,
    pubKey: signedBroadcast.pubKey,
    signature: signedBroadcast.signature,
    data,
    broadcastedAt: new Date(data.broadcastedAt),
    expireAt: new Date(data.broadcastedAt + INSTALLING_ERRORS_EXPIRY_MS),
  };
  return dbHelper.updateOneInDatabase(
    database, globalAppsInstallingErrorsBroadcasts,
    { 'data.name': data.name, 'data.hash': data.hash, 'data.ip': data.ip },
    { $set: doc },
    { upsert: true },
  ).catch((err) => log.error(`storeSignedAppInstallingErrorBroadcast: ${err.message}`));
}

async function storeBatchAppInstallingErrorMessages(verifiedBroadcasts) {
  if (verifiedBroadcasts.length === 0) return { stored: 0 };
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const signedOps = [];
  const locationOps = [];

  for (const broadcast of verifiedBroadcasts) {
    const { data } = broadcast;
    const validTill = data.broadcastedAt + INSTALLING_ERRORS_EXPIRY_MS;
    if (validTill < Date.now()) continue;

    const incomingDate = new Date(data.broadcastedAt);
    const incomingExpiry = new Date(validTill);

    signedOps.push({
      updateOne: {
        filter: { 'data.name': data.name, 'data.hash': data.hash, 'data.ip': data.ip },
        update: {
          $set: {
            version: broadcast.version,
            timestamp: broadcast.timestamp,
            pubKey: broadcast.pubKey,
            signature: broadcast.signature,
            data,
            broadcastedAt: incomingDate,
            expireAt: incomingExpiry,
          },
        },
        upsert: true,
      },
    });

    const isNewer = { $gt: [incomingDate, { $ifNull: ['$broadcastedAt', new Date(0)] }] };
    locationOps.push({
      updateOne: {
        filter: { name: data.name, hash: data.hash, ip: data.ip },
        update: [{ $set: {
          name: data.name,
          hash: data.hash,
          ip: data.ip,
          error: { $cond: [isNewer, data.error, { $ifNull: ['$error', data.error] }] },
          broadcastedAt: { $cond: [isNewer, incomingDate, '$broadcastedAt'] },
          expireAt: { $cond: [isNewer, incomingExpiry, '$expireAt'] },
        } }],
        upsert: true,
      },
    });
  }

  if (signedOps.length > 0) {
    await database.collection(globalAppsInstallingErrorsBroadcasts).bulkWrite(signedOps, { ordered: false })
      .catch((err) => log.error(`storeBatchAppInstallingErrorMessages signed: ${err.message}`));
  }
  if (locationOps.length > 0) {
    await database.collection(globalAppsInstallingErrorsLocations).bulkWrite(locationOps, { ordered: false })
      .catch((err) => log.error(`storeBatchAppInstallingErrorMessages locations: ${err.message}`));
  }
  return { stored: signedOps.length };
}

module.exports = {
  storeAppTemporaryMessage,
  storeAppPermanentMessage,
  storeAppRunningMessage,
  storeSignedAppRunningBroadcast,
  storeBatchAppRunningMessages,
  storeAppInstallingMessage,
  storeSignedAppInstallingBroadcast,
  storeBatchAppInstallingMessages,
  storeAppRemovedMessage,
  storeAppInstallingErrorMessage,
  storeSignedAppInstallingErrorBroadcast,
  storeBatchAppInstallingErrorMessages,
  storeIPChangedMessage,
};
