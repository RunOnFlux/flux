const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const generalService = require('../generalService');
const signatureVerifier = require('../signatureVerifier');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const serviceHelper = require('../serviceHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
// Removed messageStore require to avoid circular dependency - will import locally where needed
const { getChainParamsPriceUpdates, appPricePerMonth } = require('../utils/appUtilities');
const { updateAppSpecifications } = require('../appDatabase/registryManager');
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
  await serviceHelper.delay(500);
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
 * Check if app message exists in permanent storage
 * @param {string} hash - Message hash to check
 * @returns {Promise<object|boolean>} Message object if found, false otherwise
 */
async function checkAppMessageExistence(hash) {
  const dbopen = dbHelper.databaseConnection();
  if (!dbopen) {
    log.warn(`Database connection is null when checking app message existence for hash ${hash}`);
    return false;
  }
  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { hash };
  const appsProjection = {};
  // a permanent global zelappmessage looks like this:
  // const permanentAppMessage = {
  //   type: messageType,
  //   version: typeVersion,
  //   zelAppSpecifications: appSpecFormatted,
  //   appSpecifications: appSpecFormatted,
  //   hash: messageHASH,
  //   timestamp,
  //   signature,
  //   txid,
  //   height,
  //   valueSat,
  // };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsMessages, appsQuery, appsProjection);
  if (appResult) {
    return appResult;
  }
  return false;
}

/**
 * Check if app temporary message exists
 * @param {string} hash - Message hash to check
 * @returns {Promise<object|boolean>} Message object if found, false otherwise
 */
async function checkAppTemporaryMessageExistence(hash) {
  const dbopen = dbHelper.databaseConnection();
  if (!dbopen) {
    log.warn(`Database connection is null when checking app temporary message existence for hash ${hash}`);
    return false;
  }
  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { hash };
  const appsProjection = {};
  // a temporary zelappmessage looks like this:
  // const newMessage = {
  //   appSpecifications: message.appSpecifications,
  //   type: message.type,
  //   version: message.version,
  //   hash: message.hash,
  //   timestamp: message.timestamp,
  //   signature: message.signature,
  //   createdAt: new Date(message.timestamp),
  //   expireAt: new Date(validTill),
  // };
  const tempResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsTempMessages, appsQuery, appsProjection);
  if (tempResult) {
    return tempResult;
  }
  return false;
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

/**
 * Check if app message exists and request it if not found
 * @param {string} hash - Message hash
 * @param {string} txid - Transaction ID
 * @param {number} height - Block height
 * @param {number} valueSat - Transaction value in satoshis
 * @param {number} i - Retry counter
 * @returns {Promise<object|null>} Message if found, null otherwise
 */
async function checkAndRequestApp(hash, txid, height, valueSat, i = 0) {
  try {
    if (height < config.fluxapps.epochstart) { // do not request testing apps
      return false;
    }

    const appMessageExists = await checkAppMessageExistence(hash);
    if (appMessageExists) {
      return appMessageExists;
    }

    // check temporary message storage
    const tempMessage = await checkAppTemporaryMessageExistence(hash);
    if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
      const specifications = tempMessage.appSpecifications || tempMessage.zelAppSpecifications;
      // temp message means its all ok. store it as permanent app message
      const permanentAppMessage = {
        type: tempMessage.type,
        version: tempMessage.version,
        appSpecifications: specifications,
        hash: tempMessage.hash,
        timestamp: tempMessage.timestamp,
        signature: tempMessage.signature,
        txid: serviceHelper.ensureString(txid),
        height: serviceHelper.ensureNumber(height),
        valueSat: serviceHelper.ensureNumber(valueSat),
      };
      // Import locally to avoid circular dependency
      const messageStore = require('./messageStore');
      await messageStore.storeAppPermanentMessage(permanentAppMessage);
      // await update zelapphashes that we already have it stored
      await appHashHasMessage(hash);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height;
      const expire = specifications.expire || 22000;
      if (height + expire > daemonHeight) {
        // we only do this validations if the app can still be currently running to insert it or update it in globalappspecifications
        const appPrices = await getChainParamsPriceUpdates();
        const intervals = appPrices.filter((interval) => interval.height < height);
        const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
        if (tempMessage.type === 'zelappregister' || tempMessage.type === 'fluxappregister') {
          // check if value is optimal or higher
          let appPrice = await appPricePerMonth(specifications, height, appPrices);
          const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
          const expireIn = specifications.expire || defaultExpire;
          // app prices are ceiled to highest 0.01
          const multiplier = expireIn / defaultExpire;
          appPrice *= multiplier;
          appPrice = Math.ceil(appPrice * 100) / 100;
          if (appPrice < priceSpecifications.minPrice) {
            appPrice = priceSpecifications.minPrice;
          }
          if (valueSat >= appPrice * 1e8) {
            const updateForSpecifications = permanentAppMessage.appSpecifications;
            updateForSpecifications.hash = permanentAppMessage.hash;
            updateForSpecifications.height = permanentAppMessage.height;
            // object of appSpecifications extended for hash and height
            await updateAppSpecifications(updateForSpecifications);
            // every time we ask for a missing app message that is a appregister call after expireGlobalApplications to make sure we don't have on
          } else {
            log.warn(`Apps message ${permanentAppMessage.hash} is underpaid ${valueSat} < ${appPrice * 1e8} - priceSpecs ${JSON.stringify(priceSpecifications)} - specs ${JSON.stringify(specifications)}`);
          }
        } else if (tempMessage.type === 'zelappupdate' || tempMessage.type === 'fluxappupdate') {
          // appSpecifications.name as identifier
          const db = dbHelper.databaseConnection();
          const database = db.db(config.database.appsglobal.database);
          const projection = {
            projection: {
              _id: 0,
            },
          };
          // we may not have the application in global apps. This can happen when we receive the message after the app has already expired AND we need to get message right before our message. Thus using messages system that is accurate
          const appsQuery = {
            'appSpecifications.name': specifications.name,
          };
          const findPermAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
          let latestPermanentRegistrationMessage;
          findPermAppMessage.forEach((foundMessage) => {
            // has to be registration message
            if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
              if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= tempMessage.timestamp) { // no message and found message is not newer than our message
                latestPermanentRegistrationMessage = foundMessage;
              } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
                if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= tempMessage.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
                  latestPermanentRegistrationMessage = foundMessage;
                }
              }
            }
          });
          // some early app have zelAppSepcifications
          const appsQueryB = {
            'zelAppSpecifications.name': specifications.name,
          };
          const findPermAppMessageB = await dbHelper.findInDatabase(database, globalAppsMessages, appsQueryB, projection);
          findPermAppMessageB.forEach((foundMessage) => {
            // has to be registration message
            if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
              if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= tempMessage.timestamp) { // no message and found message is not newer than our message
                latestPermanentRegistrationMessage = foundMessage;
              } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
                if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= tempMessage.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
                  latestPermanentRegistrationMessage = foundMessage;
                }
              }
            }
          });
          const messageInfo = latestPermanentRegistrationMessage;
          if (!messageInfo) {
            log.error(`Last permanent message for ${specifications.name} not found`);
            return true;
          }
          const previousSpecs = messageInfo.appSpecifications || messageInfo.zelAppSpecifications;
          // here comparison of height differences and specifications
          // price shall be price for standard registration plus minus already paid price according to old specifics. height remains height valid for 22000 blocks
          let appPrice = await appPricePerMonth(specifications, height, appPrices);
          let previousSpecsPrice = await appPricePerMonth(previousSpecs, messageInfo.height || height, appPrices);
          const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
          const currentExpireIn = specifications.expire || defaultExpire;
          const previousExpireIn = previousSpecs.expire || defaultExpire;
          // app prices are ceiled to highest 0.01
          const multiplierCurrent = currentExpireIn / defaultExpire;
          appPrice *= multiplierCurrent;
          appPrice = Math.ceil(appPrice * 100) / 100;
          const multiplierPrevious = previousExpireIn / defaultExpire;
          previousSpecsPrice *= multiplierPrevious;
          previousSpecsPrice = Math.ceil(previousSpecsPrice * 100) / 100;
          // what is the height difference
          const heightDifference = permanentAppMessage.height - messageInfo.height;
          // currentExpireIn is always higher than heightDifference
          const perc = (previousExpireIn - heightDifference) / previousExpireIn; // how much of previous specs was not used yet
          let actualPriceToPay = appPrice * 0.9;
          if (perc > 0) {
            actualPriceToPay = (appPrice - (perc * previousSpecsPrice)) * 0.9; // discount for missing heights. Allow 90%
          }
          actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
          if (actualPriceToPay < priceSpecifications.minPrice) {
            actualPriceToPay = priceSpecifications.minPrice;
          }
          if (valueSat >= actualPriceToPay * 1e8) {
            const updateForSpecifications = permanentAppMessage.appSpecifications;
            updateForSpecifications.hash = permanentAppMessage.hash;
            updateForSpecifications.height = permanentAppMessage.height;
            // object of appSpecifications extended for hash and height
            // do not await this
            updateAppSpecifications(updateForSpecifications);
          } else {
            log.warn(`Apps message ${permanentAppMessage.hash} is underpaid ${valueSat} < ${appPrice * 1e8}`);
          }
        }
      }
      return true;
    }

    if (i < 2) {
      // request the message and broadcast the message further to our connected peers.
      // rerun this after 1 min delay
      // We ask to the connected nodes 2 times in 1 minute interval for the app message, if connected nodes don't
      // have the app message we will ask for it again when continuousFluxAppHashesCheck executes again.
      // in total we ask to the connected nodes 10 (30m interval) x 2 (1m interval) = 20 times before apphash is marked as not found
      await requestAppMessage(hash);
      await serviceHelper.delay(60 * 1000);
      return checkAndRequestApp(hash, txid, height, valueSat, i + 1);
      // additional requesting of missing app messages is done on rescans
    }
    return false;
  } catch (error) {
    log.error(`Error checking and requesting app ${hash}:`, error);
    log.error(`Error details - Message: ${error.message}, Stack: ${error.stack}`);
    return false;
  }
}

/**
 * Check and request multiple app messages in batch
 * @param {object[]} apps - Array of app objects with hash, txid, height, value properties
 * @param {boolean} incoming - Whether messages are incoming
 * @param {number} i - Retry counter
 * @returns {Promise<void>} Completion status
 */
async function checkAndRequestMultipleApps(apps, incoming = false, i = 1) {
  try {
    if (!Array.isArray(apps) || apps.length === 0) {
      return;
    }

    log.info(`Processing batch of ${apps.length} app messages (attempt ${i})`);

    const promises = apps.map(app => {
      if (app.hash && app.txid && app.height !== undefined && app.value !== undefined) {
        return checkAndRequestApp(app.hash, app.txid, app.height, app.value, i);
      }
      return Promise.resolve(null);
    });

    await Promise.allSettled(promises);

    if (incoming) {
      log.info(`Completed processing ${apps.length} incoming app messages`);
    }
  } catch (error) {
    log.error('Error processing multiple apps:', error);
  }
}

// Global variables for continuousFluxAppHashesCheck
let continuousFluxAppHashesCheckRunning = false;
let firstContinuousFluxAppHashesCheckRun = true;

/**
 * Continuously checks for missing flux app hashes and requests missing messages
 * @param {boolean} force - Force check even if already running
 * @param {Map} hashesNumberOfSearchs - Map tracking number of searches per hash
 * @param {Array} invalidMessages - Array of known invalid messages
 * @param {Function} checkAndSyncAppHashes - Function to check and sync app hashes
 * @param {boolean} checkAndSyncAppHashesWasEverExecuted - Flag indicating if sync was executed
 * @param {string} scannedHeightCollection - Collection name for scanned heights
 * @param {object} fluxNetworkHelper - Flux network helper object
 * @param {object} serviceHelper - Service helper object
 * @returns {Promise<void>}
 */
async function continuousFluxAppHashesCheck(force = false, hashesNumberOfSearchs, invalidMessages, checkAndSyncAppHashes, checkAndSyncAppHashesWasEverExecuted, scannedHeightCollection, fluxNetworkHelper, serviceHelper) {
  try {
    if (continuousFluxAppHashesCheckRunning) {
      return;
    }
    log.info('Requesting missing Flux App messages');
    continuousFluxAppHashesCheckRunning = true;
    const numberOfPeers = fluxNetworkHelper.getNumberOfPeers();
    if (numberOfPeers < 12) {
      log.info('Not enough connected peers to request missing Flux App messages');
      continuousFluxAppHashesCheckRunning = false;
      return;
    }

    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
      continuousFluxAppHashesCheckRunning = false;
      return;
    }

    if (firstContinuousFluxAppHashesCheckRun && !checkAndSyncAppHashesWasEverExecuted) {
      await checkAndSyncAppHashes();
    }

    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const queryHeight = { generalScannedHeight: { $gte: 0 } };
    const projectionHeight = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const scanHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, queryHeight, projectionHeight);
    if (!scanHeight) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(scanHeight.generalScannedHeight);

    // get flux app hashes that do not have a message;
    const query = { message: false };
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
    // sort it by height, so we request oldest messages first
    results.sort((a, b) => a.height - b.height);
    let appsMessagesMissing = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const result of results) {
      if (!result.messageNotFound || force || firstContinuousFluxAppHashesCheckRun) { // most likely wrong data, if no message found. This attribute is cleaned every reconstructAppMessagesHashPeriod blocks so all nodes search again for missing messages
        let heightDifference = explorerHeight - result.height;
        if (heightDifference < 0) {
          heightDifference = 0;
        }
        let maturity = Math.round(heightDifference / config.fluxapps.blocksLasting);
        if (maturity > 12) {
          maturity = 16; // maturity of max 16 representing its older than 1 year. Old messages will only be searched 3 times, newer messages more oftenly
        }
        if (invalidMessages.find((message) => message.hash === result.hash && message.txid === result.txid)) {
          if (!force) {
            maturity = 30; // do not request known invalid messages.
          }
        }
        // every config.fluxapps.blocksLasting increment maturity by 2;
        let numberOfSearches = maturity;
        if (hashesNumberOfSearchs.has(result.hash)) {
          numberOfSearches = hashesNumberOfSearchs.get(result.hash) + 2; // max 10 tries
        }
        hashesNumberOfSearchs.set(result.hash, numberOfSearches);
        log.info(`Requesting missing Flux App message: ${result.hash}, ${result.txid}, ${result.height}`);
        if (numberOfSearches <= 20) { // up to 10 searches
          const appMessageInformation = {
            hash: result.hash,
            txid: result.txid,
            height: result.height,
            value: result.value,
          };
          appsMessagesMissing.push(appMessageInformation);
          if (appsMessagesMissing.length === 500) {
            log.info('Requesting 500 app messages');
            checkAndRequestMultipleApps(appsMessagesMissing);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(2 * 60 * 1000); // delay 2 minutes to give enough time to process all messages received
            appsMessagesMissing = [];
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          await appHashHasMessageNotFound(result.hash); // mark message as not found
          hashesNumberOfSearchs.delete(result.hash); // remove from our map
        }
      }
    }
    if (appsMessagesMissing.length > 0) {
      log.info(`Requesting ${appsMessagesMissing.length} app messages`);
      checkAndRequestMultipleApps(appsMessagesMissing);
    }
    continuousFluxAppHashesCheckRunning = false;
    firstContinuousFluxAppHashesCheckRun = false;
  } catch (error) {
    log.error(error);
    continuousFluxAppHashesCheckRunning = false;
    firstContinuousFluxAppHashesCheckRun = false;
  }
}

/**
 * API endpoint to manually trigger app hashes check
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {Function} continuousFluxAppHashesCheckFunc - The actual check function
 * @returns {Promise<void>}
 */
async function triggerAppHashesCheckAPI(req, res, continuousFluxAppHashesCheckFunc) {
  try {
    // only flux team and node owner can do this
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    continuousFluxAppHashesCheckFunc(true);
    const resultsResponse = messageHelper.createSuccessMessage('Running check on missing application messages ');
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

module.exports = {
  verifyAppHash,
  verifyAppMessageSignature,
  verifyAppMessageUpdateSignature,
  requestAppMessage,
  requestAppsMessage,
  requestAppMessageAPI,
  checkAppMessageExistence,
  checkAppTemporaryMessageExistence,
  appHashHasMessage,
  appHashHasMessageNotFound,
  getAppsTemporaryMessages,
  getAppsPermanentMessages,
  checkAndRequestApp,
  checkAndRequestMultipleApps,
  continuousFluxAppHashesCheck,
  triggerAppHashesCheckAPI,
};