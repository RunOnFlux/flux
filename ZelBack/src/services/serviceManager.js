const config = require('config');
const log = require('../lib/log');

const dbHelper = require('./dbHelper');
const explorerService = require('./explorerService');
const fluxCommunication = require('./fluxCommunication');
const appsService = require('./appsService');
const daemonService = require('./daemonService');
const fluxService = require('./fluxService');
const upnpService = require('./upnpService');
const userconfig = require('../../../config/userconfig');

const apiPort = userconfig.initial.apiport || config.server.apiport;

/**
 * To start FluxOS. A series of checks are performed on port and UPnP (Universal Plug and Play) support and mapping. Database connections are established. The other relevant functions required to start FluxOS services are called.
 */
async function startFluxFunctions() {
  try {
    if (!config.server.allowedPorts.includes(+apiPort)) {
      log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
      process.exit();
    }
    if (userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) {
      const verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
      if (verifyUpnp !== true) {
        log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to verify support. Shutting down.`);
        process.exit();
      }
      const setupUpnp = await upnpService.setupUPNP(apiPort);
      if (setupUpnp !== true) {
        log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to map to api or home port. Shutting down.`);
        process.exit();
      }
    }
    log.info('Initiating MongoDB connection');
    await dbHelper.initiateDB(); // either true or throws error
    log.info('DB connected');
    log.info('Preparing local database...');
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    await dbHelper.dropCollection(database, config.database.local.collections.activeLoginPhrases).catch((error) => {
      if (error.message !== 'ns not found') {
        log.error(error);
      }
    });
    await dbHelper.dropCollection(database, config.database.local.collections.activeSignatures).catch((error) => {
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
    fluxService.InstallFluxWatchTower();
    fluxCommunication.checkDeterministicNodesCollisions();
    log.info('Flux checks operational');
    fluxCommunication.fluxDiscovery();
    log.info('Flux Discovery started');
    try {
      appsService.reconstructAppMessagesHashCollection();
      log.info('Validation of App Messages Hash Collection');
    } catch (error) {
      log.error(error);
    }
    setTimeout(() => { // wait as of restarts due to ui building
      explorerService.initiateBlockProcessor(true, true);
      log.info('Flux Block Processing Service started');
    }, 2 * 60 * 1000);
    setInterval(() => { // every 4 mins (2 blocks)
      appsService.checkAndNotifyPeersOfRunningApps();
    }, 4 * 60 * 1000);
    setInterval(() => { // every 8 mins (4 blocks)
      appsService.continuousFluxAppHashesCheck();
    }, 8 * 60 * 1000);
    setTimeout(() => {
      // after 14 minutes of running ok.
      // is stopped on basics
      log.info('Starting to spawn applications');
      appsService.trySpawningGlobalApplication();
    }, 14 * 60 * 1000);
    setTimeout(() => {
      appsService.stopAllNonFluxRunningApps();
    }, 1 * 60 * 1000);
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
