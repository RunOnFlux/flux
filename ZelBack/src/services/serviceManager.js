const config = require('config');
const log = require('../lib/log');

const dbHelper = require('./dbHelper');
const explorerService = require('./explorerService');
const fluxCommunication = require('./fluxCommunication');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const appsService = require('./appsService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const fluxService = require('./fluxService');
const geolocationService = require('./geolocationService');
const upnpService = require('./upnpService');
const syncthingService = require('./syncthingService');
const pgpService = require('./pgpService');
const userconfig = require('../../../config/userconfig');

const apiPort = userconfig.initial.apiport || config.server.apiport;
const development = userconfig.initial.development || false;

/**
 * To start FluxOS. A series of checks are performed on port and UPnP (Universal Plug and Play) support and mapping. Database connections are established. The other relevant functions required to start FluxOS services are called.
 */
async function startFluxFunctions() {
  try {
    if (!config.server.allowedPorts.includes(+apiPort)) {
      log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
      process.exit();
    }
    const verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
    if (userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) {
      if (verifyUpnp !== true) {
        log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to verify support. Shutting down.`);
        process.exit();
      }
      const setupUpnp = await upnpService.setupUPNP(apiPort);
      if (setupUpnp !== true) {
        log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to map to api or home port. Shutting down.`);
        process.exit();
      }
    } else {
      upnpService.setupUPNP(apiPort);
    }
    log.info('Initiating MongoDB connection');
    await dbHelper.initiateDB(); // either true or throws error
    log.info('DB connected');
    log.info('Preparing local database...');
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    await dbHelper.dropCollection(database, config.database.local.collections.loggedUsers).catch((error) => { // drop currently logged users
      if (error.message !== 'ns not found') {
        log.error(error);
      }
    });
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
    await database.collection(config.database.local.collections.loggedUsers).createIndex({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 }); // 2days
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
    fluxNetworkHelper.adjustFirewall();
    log.info('Firewalls checked');
    fluxCommunication.keepConnectionsAlive();
    log.info('Connections polling prepared');
    daemonServiceMiscRpcs.daemonBlockchainInfoService();
    log.info('Flux Daemon Info Service Started');
    fluxService.installFluxWatchTower();
    fluxNetworkHelper.checkDeterministicNodesCollisions();
    log.info('Flux checks operational');
    fluxCommunication.fluxDiscovery();
    log.info('Flux Discovery started');
    syncthingService.startSyncthing();
    log.info('Syncthing service started');
    await pgpService.generateIdentity();
    log.info('PGP service initiated');
    setTimeout(() => {
      log.info('Rechecking firewall app rules');
      fluxNetworkHelper.purgeUFW();
      appsService.testAppMount(); // test if our node can mount a volume
    }, 30 * 1000);
    setTimeout(() => {
      appsService.stopAllNonFluxRunningApps();
      appsService.startMonitoringOfApps();
      appsService.restoreAppsPortsSupport();
    }, 1 * 60 * 1000);
    setInterval(() => {
      appsService.restorePortsSupport(); // restore fluxos and apps ports/upnp
    }, 10 * 60 * 1000); // every 10 minutes
    setTimeout(() => {
      log.info('Starting setting Node Geolocation');
      geolocationService.setNodeGeolocation();
    }, 90 * 1000);
    setTimeout(() => { // wait as of restarts due to ui building
      explorerService.initiateBlockProcessor(true, true);
      log.info('Flux Block Processing Service started');
    }, 2 * 60 * 1000);
    setTimeout(() => {
      appsService.checkForNonAllowedAppsOnLocalNetwork();
      appsService.checkMyAppsAvailability(); // periodically checks
    }, 3 * 60 * 1000);
    setTimeout(() => {
      appsService.checkAndNotifyPeersOfRunningApps(); // first broadcast after 4m of starting fluxos
      setInterval(() => { // every 60 mins messages stay on db for 65m
        appsService.checkAndNotifyPeersOfRunningApps();
      }, 60 * 60 * 1000);
    }, 4 * 60 * 1000);
    setTimeout(() => {
      appsService.syncthingApps(); // after 6 mins adjust our syncthing configuration
      setInterval(() => { // recheck and possibly adjust syncthing configuration every minute
        appsService.syncthingApps();
      }, 1 * 60 * 1000);
    }, 6 * 60 * 1000);
    setInterval(() => { // every 12 mins (6 blocks)
      appsService.continuousFluxAppHashesCheck();
    }, 12 * 60 * 1000);
    setTimeout(() => {
      // after 90 minutes of running ok and to make sure we are connected for enough time for receiving all apps running on other nodes
      log.info('Starting to spawn applications');
      appsService.trySpawningGlobalApplication();
    }, 90 * 60 * 1000);
    setInterval(() => {
      appsService.checkApplicationsCompliance();
    }, 60 * 60 * 1000); //  every hour
    setTimeout(() => {
      appsService.forceAppRemovals(); // force cleanup of apps every day
      setInterval(() => {
        appsService.forceAppRemovals();
      }, 24 * 60 * 60 * 1000);
    }, 30 * 60 * 1000);
    if (development) { // just on development branch
      setInterval(async () => {
        await fluxService.enterDevelopment().catch((error) => log.error(error));
        if (development === true || development === 'true' || development === 1 || development === '1') { // in other cases pause git pull
          setTimeout(async () => {
            await fluxService.softUpdateFluxInstall().catch((error) => log.error(error));
          }, 15 * 1000);
        }
      }, 60 * 60 * 1000); // every 1 hour
    }
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
