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
const { appPricePerMonth } = require('../utils/appUtilities');
const { getChainParamsPriceUpdates, getChainTeamSupportAddressUpdates } = require('../utils/chainUtilities');
const { updateAppSpecifications } = require('../appDatabase/registryManager');
const {
  globalAppsMessages,
  globalAppsTempMessages,
  // eslint-disable-next-line no-unused-vars
  globalAppsLocations,
  // eslint-disable-next-line no-unused-vars
  globalAppsInstallingLocations,
  appsHashesCollection,
  scannedHeightCollection,
} = require('../utils/appConstants');
const { invalidMessages } = require('../invalidMessages');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const globalState = require('../utils/globalState');

// Import hashesNumberOfSearchs from appsService - this should be shared state
// For now, we'll create a local instance, but ideally this should be moved to globalState
const hashesNumberOfSearchs = new Map();

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
  } else if (specifications.version === 7) {
    // fix for repoauth / secrets order change for apps created after 1750273721000
    appSpecsCopy.compose.forEach((component) => {
      // previously the order was secrets / repoauth. Now it's repoauth / secrets.
      const comp = component;
      const { secrets, repoauth } = comp;

      delete comp.secrets;
      delete comp.repoauth;

      // try the old secrets / repoauth
      comp.secrets = secrets;
      comp.repoauth = repoauth;
    });

    messToHash = message.type + message.version + JSON.stringify(appSpecsCopy) + message.timestamp + message.signature;
    messageHASH = await generalService.messageHash(messToHash);
  }

  if (messageHASH !== message.hash) {
    log.error(`Hashes dont match - expected - ${message.hash} - calculated - ${messageHASH} for the message ${JSON.stringify(message)}`);
    throw new Error('Invalid Flux App hash received');
  }

  // ToDo: fix this function. Should just return true / false and the upper layer deals with it,
  // none of this needs to be async, crypto.createHash is synchronous
  return true;
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
  // signature is already validated as string in the if check above, no need to ensureString
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
    const messageToVerifyB = type + version + JSON.stringify(appSpecOld) + timestamp;
    isValidSignature = verificationHelper.verifyMessage(messageToVerifyB, appSpec.owner, signature); // only btc
    if (timestamp > 1688947200000) {
      isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, appSpec.owner, signature); // btc, eth
    }
    // fix for repoauth / secrets order change for apps created after 1750273721000
  } else if (isValidSignature !== true && appSpec.version === 7) {
    const appSpecsClone = JSON.parse(JSON.stringify(appSpec));
    appSpecsClone.compose.forEach((component) => {
      // previously the order was secrets / repoauth. Now it's repoauth / secrets.
      const comp = component;
      const { secrets, repoauth } = comp;
      delete comp.secrets;
      delete comp.repoauth;
      // try the old secrets / repoauth
      comp.secrets = secrets;
      comp.repoauth = repoauth;
    });
    const messageToVerifyC = type + version + JSON.stringify(appSpecsClone) + timestamp;
    // we can just use the btc / eth verifier as v7 specs came out at 1688749251
    isValidSignature = signatureVerifier.verifySignature(messageToVerifyC, appSpec.owner, signature);
  }
  if (isValidSignature !== true) {
    log.debug(`${messageToVerify}, ${appSpec.owner}, ${signature}`);
    const errorMessage = isValidSignature === false ? 'Received signature is invalid or Flux App specifications are not properly formatted' : isValidSignature;
    throw new Error(errorMessage);
  }
  return true;
}

/**
 * Check if app update only changes the expire property
 * @param {object} newSpec - New app specifications
 * @param {object} existingSpec - Existing app specifications
 * @returns {boolean} True if only expire property is changed
 */
function isExpireOnlyUpdate(newSpec, existingSpec) {
  if (!existingSpec || !newSpec) {
    return false;
  }

  // Create copies to compare without expire
  const newCopy = JSON.parse(JSON.stringify(newSpec));
  const existingCopy = JSON.parse(JSON.stringify(existingSpec));

  // Remove expire from both (and height/hash which are added by system)
  delete newCopy.expire;
  delete existingCopy.expire;
  delete newCopy.height;
  delete existingCopy.height;
  delete newCopy.hash;
  delete existingCopy.hash;

  // Compare the rest - must be identical
  return JSON.stringify(newCopy) === JSON.stringify(existingCopy);
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

  // signature is already validated as string in the if check above, no need to ensureString
  let marketplaceApp = false;
  let fluxSupportTeamFluxID = null;
  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  let isValidSignature = signatureVerifier.verifySignature(messageToVerify, appOwner, signature); // btc, eth
  if (isValidSignature !== true) {
    const teamSupportAddresses = getChainTeamSupportAddressUpdates();
    if (teamSupportAddresses.length > 0) {
      const intervals = teamSupportAddresses.filter((interval) => interval.height <= daemonHeight); // if an app message was sent on block before the team support address was activated, will be empty array
      if (intervals && intervals.length) {
        const addressInfo = intervals[intervals.length - 1]; // always defined
        if (addressInfo && addressInfo.height && daemonHeight >= addressInfo.height) { // unneeded check for safety
          fluxSupportTeamFluxID = addressInfo.address;
          const numbersOnAppName = appSpec.name.match(/\d+/g);
          if (numbersOnAppName && numbersOnAppName.length > 0) {
            const dateBeforeReleaseMarketplace = Date.parse('2020-01-01');
            // eslint-disable-next-line no-restricted-syntax
            for (const possibleTimestamp of numbersOnAppName) {
              if (Number(possibleTimestamp) > dateBeforeReleaseMarketplace) {
                marketplaceApp = true;
                break;
              }
            }
            if (marketplaceApp) {
              isValidSignature = signatureVerifier.verifySignature(messageToVerify, fluxSupportTeamFluxID, signature); // btc, eth
            }
          }
        }
      }
    }
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

    const messageToVerifyB = type + version + JSON.stringify(appSpecOld) + timestamp;
    isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, appOwner, signature); // btc, eth
    if (isValidSignature !== true && marketplaceApp) {
      isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, fluxSupportTeamFluxID, signature); // btc, eth
    }
    // fix for repoauth / secrets order change for apps created after 1750273721000
  } else if (isValidSignature !== true && appSpec.version === 7) {
    const appSpecsClone = JSON.parse(JSON.stringify(appSpec));
    appSpecsClone.compose.forEach((component) => {
      // previously the order was secrets / repoauth. Now it's repoauth / secrets.
      const comp = component;
      const { secrets, repoauth } = comp;
      delete comp.secrets;
      delete comp.repoauth;
      // try the old secrets / repoauth
      comp.secrets = secrets;
      comp.repoauth = repoauth;
    });
    const messageToVerifyC = type + version + JSON.stringify(appSpecsClone) + timestamp;
    // we can just use the btc / eth verifier as v7 specs came out at 1688749251
    isValidSignature = signatureVerifier.verifySignature(messageToVerifyC, appOwner, signature);
  }

  // Check if usersToExtend can sign this update (only for expire-only changes)
  if (isValidSignature !== true) {
    const usersToExtend = config.fluxapps.usersToExtend || [];
    if (usersToExtend.length > 0) {
      // Check if signature matches any of the usersToExtend addresses
      // eslint-disable-next-line no-restricted-syntax
      for (const userToExtend of usersToExtend) {
        const isValidUserToExtendSignature = signatureVerifier.verifySignature(messageToVerify, userToExtend, signature);
        if (isValidUserToExtendSignature === true) {
          // Verify this is an expire-only update by fetching existing app specs
          // eslint-disable-next-line global-require
          const registryManager = require('../appDatabase/registryManager');
          // eslint-disable-next-line no-await-in-loop
          const existingSpec = await registryManager.getApplicationGlobalSpecifications(appSpec.name);
          if (existingSpec) {
            // For v8+ enterprise apps, we need to decrypt the new spec before comparing
            let newSpecToCompare = appSpec;
            if (appSpec.version >= 8 && appSpec.enterprise) {
              // eslint-disable-next-line global-require
              const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
              // eslint-disable-next-line no-await-in-loop
              newSpecToCompare = await checkAndDecryptAppSpecs(appSpec, { daemonHeight, owner: existingSpec.owner });
            }
            if (isExpireOnlyUpdate(newSpecToCompare, existingSpec)) {
              log.info(`App ${appSpec.name} expire extension signed by userToExtend address ${userToExtend}`);
              isValidSignature = true;
              break;
            }
          }
        }
      }
    }
  }

  if (isValidSignature !== true) {
    log.debug(`${messageToVerify}, ${appOwner}, ${signature}`);
    const errorMessage = isValidSignature === false ? 'Received signature does not correspond with Flux App owner or Flux App specifications are not properly formatted' : isValidSignature;
    throw new Error(errorMessage);
  }

  return true;
}

/**
 * Request app message from network
 * @param {string} hash - Message hash to request
 * @returns {Promise<void>}
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
 * @returns {Promise<void>}
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
    await fluxCommunicationMessagesSender.broadcastMessageToRandomIncoming(message);
  } else {
    await fluxCommunicationMessagesSender.broadcastMessageToRandomOutgoing(message);
  }
}

/**
 * Request app message via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>}
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
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { hash };
  const update = { $set: { message: true, messageNotFound: false } };
  const options = {};
  await dbHelper.updateOneInDatabase(database, appsHashesCollection, query, update, options);
  return true;
}

/**
 * Check if app hash has message not found
 * @param {string} hash - Hash to check
 * @returns {Promise<boolean>} True if hash has message not found
 */
async function appHashHasMessageNotFound(hash) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { hash };
  const update = { $set: { messageNotFound: true } };
  const options = {};
  await dbHelper.updateOneInDatabase(database, appsHashesCollection, query, update, options);
  return true;
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
    let query = {};
    let { hash } = req.params;
    hash = hash || req.query.hash;
    if (hash) {
      query = { hash };
    }
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
      query['appSpecifications.owner'] = owner;
    }
    if (appname) {
      query['appSpecifications.name'] = appname;
    }
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
 * @returns {Promise<boolean>} True if message found or stored, false otherwise
 */
async function checkAndRequestApp(hash, txid, height, valueSat, i = 0) {
  try {
    if (height < config.fluxapps.epochstart) { // do not request testing apps
      return false;
    }

    const appMessageExists = await checkAppMessageExistence(hash);
    if (appMessageExists === false) { // otherwise do nothing
      // we surely do not have that message in permanent storage.
      // check temporary message storage
      // if we have it in temporary storage, get the temporary message
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
        // eslint-disable-next-line global-require
        const messageStore = require('./messageStore');
        await messageStore.storeAppPermanentMessage(permanentAppMessage);
        // await update zelapphashes that we already have it stored
        await appHashHasMessage(hash);

        const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
        const daemonHeight = syncStatus.data.height;
        // Determine default expire based on whether app was registered after PON fork
        const defaultExpire = height >= config.fluxapps.daemonPONFork ? 88000 : 22000;
        const expire = specifications.expire || defaultExpire;
        let actualExpirationHeight = height + expire;

        // If app was registered before fork block and we are past fork block
        // the chain moves 4x faster, so we need to adjust the expiration
        if (height < config.fluxapps.daemonPONFork && daemonHeight >= config.fluxapps.daemonPONFork) {
          const originalExpirationHeight = height + expire;
          if (originalExpirationHeight > config.fluxapps.daemonPONFork) {
            // Calculate blocks that were supposed to live after fork block
            const blocksAfterFork = originalExpirationHeight - config.fluxapps.daemonPONFork;
            // Multiply by 4 to account for 4x faster chain
            const adjustedBlocksAfterFork = blocksAfterFork * 4;
            // New expiration = fork block + adjusted blocks
            actualExpirationHeight = config.fluxapps.daemonPONFork + adjustedBlocksAfterFork;
          }
        }

        if (actualExpirationHeight > daemonHeight) {
          // we only do this validations if the app can still be currently running to insert it or update it in globalappspecifications
          const appPrices = await getChainParamsPriceUpdates();
          const intervals = appPrices.filter((interval) => interval.height < height);
          const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
          if (tempMessage.type === 'zelappregister' || tempMessage.type === 'fluxappregister') {
          // check if value is optimal or higher
            let appPrice = await appPricePerMonth(specifications, height, appPrices);
            // Use defaultExpire from outer scope which accounts for PON fork
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
            // Calculate default expire for current and previous apps based on their registration heights
            const defaultExpireCurrent = height >= config.fluxapps.daemonPONFork
              ? config.fluxapps.blocksLasting * 4
              : config.fluxapps.blocksLasting;
            const defaultExpirePrevious = (messageInfo.height || height) >= config.fluxapps.daemonPONFork
              ? config.fluxapps.blocksLasting * 4
              : config.fluxapps.blocksLasting;
            const currentExpireIn = specifications.expire || defaultExpireCurrent;
            const previousExpireIn = previousSpecs.expire || defaultExpirePrevious;
            // app prices are ceiled to highest 0.01
            const multiplierCurrent = currentExpireIn / defaultExpireCurrent;
            appPrice *= multiplierCurrent;
            appPrice = Math.ceil(appPrice * 100) / 100;
            const multiplierPrevious = previousExpireIn / defaultExpirePrevious;
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
    }
    // update apphashes that we already have it stored
    await appHashHasMessage(hash);
    return true;
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
    const numberOfPeers = fluxNetworkHelper.getNumberOfPeers();
    if (numberOfPeers < 12) {
      log.info('checkAndRequestMultipleApps - Not enough connected peers to request missing Flux App messages');
      return;
    }
    await requestAppsMessage(apps, incoming);
    await serviceHelper.delay(30 * 1000);
    const appsToRemove = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      const messageReceived = await checkAndRequestApp(app.hash, app.txid, app.height, app.value, 2);
      if (messageReceived) {
        appsToRemove.push(app);
      }
    }
    // eslint-disable-next-line no-param-reassign
    apps = apps.filter((item) => !appsToRemove.includes(item));
    if (apps.length > 0 && i < 5) {
      await checkAndRequestMultipleApps(apps, i % 2 === 0, i + 1);
    }
  } catch (error) {
    log.error(error);
  }
}

// Global variables for continuousFluxAppHashesCheck
let continuousFluxAppHashesCheckRunning = false;
let firstContinuousFluxAppHashesCheckRun = true;

/**
 * Continuously checks for missing flux app hashes and requests missing messages
 * @param {boolean} force - Force check even if already running
 * @returns {Promise<void>}
 */
async function continuousFluxAppHashesCheck(force = false) {
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

    if (firstContinuousFluxAppHashesCheckRun && !globalState.checkAndSyncAppHashesWasEverExecuted) {
      // Import checkAndSyncAppHashes from appHashSyncService
      // eslint-disable-next-line global-require
      const appHashSyncService = require('./appHashSyncService');
      await appHashSyncService.checkAndSyncAppHashes();
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
 * @returns {Promise<void>}
 */
async function triggerAppHashesCheckAPI(req, res) {
  try {
    // only flux team and node owner can do this
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    continuousFluxAppHashesCheck(true);
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
  isExpireOnlyUpdate,
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
