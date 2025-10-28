// App Hash Sync Service - Manages synchronization of application hashes across the network
const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const messageStore = require('./messageStore');
const messageVerifier = require('./messageVerifier');
const registryManager = require('../appDatabase/registryManager');
const log = require('../../lib/log');
const { invalidMessages } = require('../invalidMessages');
const globalState = require('../utils/globalState');

// Database collections
const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const appsHashesCollection = config.database.daemon.collections.appsHashes;

// Module-level state variables
let checkAndSyncAppHashesRunning = false;
let continuousFluxAppHashesCheckRunning = false;
let firstContinuousFluxAppHashesCheckRun = true;
const hashesNumberOfSearchs = new Map();

/**
 * Check and sync app hashes from other nodes
 */
async function checkAndSyncAppHashes() {
  try {
    checkAndSyncAppHashesRunning = true;
    // eslint-disable-next-line global-require
    const { outgoingPeers } = require('../utils/establishedConnections');
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    // get flux app hashes that do not have a message;
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        message: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    const numberOfMissingApps = results.filter((app) => app.message === false).length;
    if (numberOfMissingApps > results.length * 0.95) {
      let finished = false;
      let i = 0;
      while (!finished && i <= 5) {
        i += 1;
        const client = outgoingPeers[Math.floor(Math.random() * outgoingPeers.length)];
        let axiosConfig = {
          timeout: 5000,
        };
        log.info(`checkAndSyncAppHashes - Getting explorer sync status from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-await-in-loop
        const response = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/explorer/issynced`, axiosConfig).catch((error) => log.error(error));
        if (!response || !response.data || response.data.status !== 'success') {
          log.info(`checkAndSyncAppHashes - Failed to get explorer sync status from ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        if (!response.data.data) {
          log.info(`checkAndSyncAppHashes - Explorer is not synced on ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        log.info(`checkAndSyncAppHashes - Explorer is synced on ${client.ip}:${client.port}`);
        axiosConfig = {
          timeout: 120000,
        };
        log.info(`checkAndSyncAppHashes - Getting permanent app messages from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-await-in-loop
        const appsResponse = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/apps/permanentmessages`, axiosConfig).catch((error) => log.error(error));
        if (!appsResponse || !appsResponse.data || appsResponse.data.status !== 'success' || !appsResponse.data.data) {
          log.info(`checkAndSyncAppHashes - Failed to get permanent app messages from ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        const apps = appsResponse.data.data;
        log.info(`checkAndSyncAppHashes - Will process ${apps.length} apps messages`);
        // sort it by height, so we process oldest messages first
        apps.sort((a, b) => a.height - b.height);

        // because there are broken nodes on the network, we need to temporarily skip
        // any apps that have null for valueSat.
        const filteredApps = apps.filter((app) => app.valueSat !== null);

        let y = 0;
        // eslint-disable-next-line no-restricted-syntax
        for (const appMessage of filteredApps) {
          y += 1;
          try {
            // Clean the permanent message to only include fields used in signature verification
            // Permanent messages have extra fields (txid, height, valueSat) that aren't part of the original signature
            const cleanMessage = {
              type: appMessage.type,
              version: appMessage.version,
              appSpecifications: appMessage.appSpecifications,
              hash: appMessage.hash,
              timestamp: appMessage.timestamp,
              signature: appMessage.signature,
            };
            // Support legacy field name if present
            if (appMessage.zelAppSpecifications) {
              cleanMessage.zelAppSpecifications = appMessage.zelAppSpecifications;
            }
            // eslint-disable-next-line no-await-in-loop
            await messageStore.storeAppTemporaryMessage(cleanMessage, true);
            // eslint-disable-next-line no-await-in-loop
            await messageVerifier.checkAndRequestApp(appMessage.hash, appMessage.txid, appMessage.height, appMessage.valueSat, 2);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(50);
          } catch (error) {
            log.error(error);
          }
          if (y % 500 === 0) {
            log.info(`checkAndSyncAppHashes - ${y} were already processed`);
          }
        }
        finished = true;
        // eslint-disable-next-line no-await-in-loop
        await registryManager.expireGlobalApplications();
        log.info('checkAndSyncAppHashes - Process finished');
      }
    }
    globalState.checkAndSyncAppHashesWasEverExecuted = true;
    checkAndSyncAppHashesRunning = false;
  } catch (error) {
    log.error(error);
    globalState.checkAndSyncAppHashesWasEverExecuted = false;
    checkAndSyncAppHashesRunning = false;
  }
}

/**
 * Continuously check and request missing flux app hashes
 * @param {boolean} force - Force the check even if conditions aren't met
 */
async function continuousFluxAppHashesCheck(force = false) {
  try {
    if (continuousFluxAppHashesCheckRunning) {
      return;
    }

    // Check if checkAndSyncAppHashes is currently running
    if (checkAndSyncAppHashesRunning) {
      log.info('continuousFluxAppHashesCheck: checkAndSyncAppHashes is currently running, skipping this execution');
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
            messageVerifier.checkAndRequestMultipleApps(appsMessagesMissing);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(2 * 60 * 1000); // delay 2 minutes to give enough time to process all messages received
            appsMessagesMissing = [];
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          await messageVerifier.appHashHasMessageNotFound(result.hash); // mark message as not found
          hashesNumberOfSearchs.delete(result.hash); // remove from our map
        }
      }
    }
    if (appsMessagesMissing.length > 0) {
      log.info(`Requesting ${appsMessagesMissing.length} app messages`);
      messageVerifier.checkAndRequestMultipleApps(appsMessagesMissing);
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
 * Trigger app hashes check API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
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
  checkAndSyncAppHashes,
  continuousFluxAppHashesCheck,
  triggerAppHashesCheckAPI,
};
