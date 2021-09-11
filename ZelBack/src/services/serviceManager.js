const config = require('config');
const log = require('../lib/log');

const serviceHelper = require('./serviceHelper');
const explorerService = require('./explorerService');
const fluxCommunication = require('./fluxCommunication');
const appsService = require('./appsService');
const daemonService = require('./daemonService');

async function startFluxFunctions() {
  try {
    log.info('Initiating MongoDB connection');
    await serviceHelper.initiateDB(); // either true or throws error
    log.info('DB connected');
    log.info('Preparing local database...');
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    await serviceHelper.dropCollection(database, config.database.local.collections.activeLoginPhrases).catch((error) => {
      if (error.message !== 'ns not found') {
        log.error(error);
      }
    });
    await serviceHelper.dropCollection(database, config.database.local.collections.activeSignatures).catch((error) => {
      if (error.message !== 'ns not found') {
        log.error(error);
      }
    });
    await database.collection(config.database.local.collections.activeLoginPhrases).createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
    await database.collection(config.database.local.collections.activeSignatures).createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
    log.info('Local database prepared');
    log.info('Preparing temporary database...');
    // no need to drop temporary messages
    const databaseTemp = db.db(config.database.appsglobal.database);
    await databaseTemp.collection(config.database.appsglobal.collections.appsTemporaryMessages).createIndex({ receivedAt: 1 }, { expireAfterSeconds: 3600 }); // todo longer time? dropIndexes()
    log.info('Temporary database prepared');
    log.info('Preparing Flux Apps locations');
    // more than 1 hour. Meaning we have not received status message for a long time. So that node is no longer on a network or app is down.
    await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).createIndex({ broadcastedAt: 1 }, { expireAfterSeconds: 3900 });
    log.info('Flux Apps locations prepared');
    fluxCommunication.adjustFirewall();
    log.info('Firewalls checked');
    fluxCommunication.keepConnectionsAlive();
    log.info('Connections polling prepared');
    daemonService.daemonBlockchainInfoService();
    log.info('Flux Daemon Info Service Started');
    fluxCommunication.checkDeterministicNodesCollisions();
    log.info('Flux checks operational');
    fluxCommunication.fluxDiscovery();
    log.info('Flux Discovery started');
    setTimeout(() => { // wait as of restarts due to ui building
      explorerService.initiateBlockProcessor(true, true);
      log.info('Flux Block Processing Service started');
    }, 2 * 60 * 1000);
    setInterval(() => { // every 4 mins (2 blocks)
      appsService.checkAndNotifyPeersOfRunningApps();
    }, 4 * 60 * 1000);
    setInterval(() => { // every 8 mins (4 blocks)
      appsService.continuousFluxAppHashesCheck();
    }, 1 * 60 * 1000);
    setTimeout(() => {
      // after 14 minutes of running ok.
      // is stopped on basics
      log.info('Starting to spawn applications');
      appsService.trySpawningGlobalApplication();
    }, 14 * 60 * 1000);
    fluxCommunication.adjustGitRepository(); // temporary function to be removed after couple of versions
  } catch (e) {
    log.error(e);
    setTimeout(() => {
      startFluxFunctions();
    }, 15000);
  }
}

module.exports = {
  startFluxFunctions,
};
