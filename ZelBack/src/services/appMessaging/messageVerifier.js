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
 * Check if app message exists in permanent storage
 * @param {string} hash - Message hash to check
 * @returns {Promise<object|boolean>} Message object if found, false otherwise
 */
async function checkAppMessageExistence(hash) {
  const dbopen = dbHelper.databaseConnection();
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
    const existingAppMessage = await checkAppMessageExistence(hash);
    if (existingAppMessage) {
      return existingAppMessage;
    }

    const existingTempMessage = await checkAppTemporaryMessageExistence(hash);
    if (existingTempMessage) {
      return existingTempMessage;
    }

    // Message not found, request it from network
    if (i <= 5) {
      log.info(`Requesting app message ${hash} from network (attempt ${i + 1})`);
      await requestAppMessage(hash);

      // Update hash collection to indicate we're looking for this message
      const db = dbHelper.databaseConnection();
      const databaseDaemon = db.db(config.database.daemon.database);
      const query = { hash, txid };
      const update = {
        $set: {
          messageNotFound: false,
          message: false,
          height,
          value: valueSat
        }
      };
      const options = { upsert: true };

      await dbHelper.updateOneInDatabase(databaseDaemon, appsHashesCollection, query, update, options);
    }

    return null;
  } catch (error) {
    log.error(`Error checking and requesting app ${hash}:`, error);
    return null;
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