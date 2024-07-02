const config = require('config');
const log = require('../lib/log');

const dbHelper = require('./dbHelper');
const explorerService = require('./explorerService');
const fluxCommunication = require('./fluxCommunication');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const appsService = require('./appsService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');
const fluxService = require('./fluxService');
const geolocationService = require('./geolocationService');
const upnpService = require('./upnpService');
const syncthingService = require('./syncthingService');
const pgpService = require('./pgpService');
const dockerService = require('./dockerService');
const backupRestoreService = require('./backupRestoreService');
const systemService = require('./systemService');

const apiPort = userconfig.initial.apiport || config.server.apiport;
const development = userconfig.initial.development || false;
const fluxTransactionCollection = config.database.daemon.collections.fluxTransactions;

/**
 * To start FluxOS. A series of checks are performed on port and UPnP (Universal Plug and Play) support and mapping. Database connections are established. The other relevant functions required to start FluxOS services are called.
 */
async function startFluxFunctions() {
  try {
    if (!config.server.allowedPorts.includes(+apiPort)) {
      log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
      process.exit();
    }

    // User configured UPnP node with routerIP, UPnP has already been verified and setup
    if (userconfig.initial.routerIP) {
      setInterval(() => {
        upnpService.adjustFirewallForUPNP();
      }, 1 * 60 * 60 * 1000); // every 1 hours
    }
    await daemonServiceUtils.buildFluxdClient();
    log.info('Checking docker log for corruption...');
    await dockerService.dockerLogsFix();
    await systemService.mongodGpgKeyVeryfity();
    await systemService.mongoDBConfig();
    systemService.monitorSystem();
    log.info('System service initiated');
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
    await databaseTemp.collection(config.database.appsglobal.collections.appsMessages).dropIndex({ hash: 1 }, { name: 'query for getting zelapp message based on hash' }).catch(() => { console.log('Welcome to FluxOS'); }); // drop old index or display message for new installations
    // more than 2 hours and 5m. Meaning we have not received status message for a long time. So that node is no longer on a network or app is down.
    await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).createIndex({ broadcastedAt: 1 }, { expireAfterSeconds: 7500 });
    log.info('Flux Apps locations prepared');
    fluxNetworkHelper.adjustFirewall();
    log.info('Firewalls checked');
    fluxNetworkHelper.allowNodeToBindPrivilegedPorts();
    log.info('Node allowed to bind privileged ports');
    fluxCommunication.keepConnectionsAlive();
    log.info('Connections polling prepared');
    daemonServiceMiscRpcs.daemonBlockchainInfoService();
    log.info('Flux Daemon Info Service Started');
    fluxService.installFluxWatchTower();
    fluxNetworkHelper.checkDeterministicNodesCollisions();
    log.info('Flux checks operational');
    fluxCommunication.fluxDiscovery();
    log.info('Flux Discovery started');
    syncthingService.startSyncthingSentinel();
    log.info('Syncthing service started');
    await pgpService.generateIdentity();
    log.info('PGP service initiated');
    const explorerDatabase = db.db(config.database.daemon.database);
    await dbHelper.dropCollection(explorerDatabase, fluxTransactionCollection).catch((error) => {
      if (error.message !== 'ns not found') {
        log.error(error);
      }
    });
    log.info('Mongodb zelnodetransactions dropped');

    setTimeout(() => {
      fluxCommunicationUtils.constantlyUpdateDeterministicFluxList(); // updates deterministic flux list for communication every 2 minutes, so we always trigger cache and have up to date value
    }, 15 * 1000);
    setTimeout(async () => {
      log.info('Rechecking firewall app rules');
      fluxNetworkHelper.purgeUFW();
      const fluxNetworkInterfaces = await dockerService.getFluxDockerNetworkPhysicalInterfaceNames();
      fluxNetworkHelper.removeDockerContainerAccessToNonRoutable(fluxNetworkInterfaces);
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
    setTimeout(() => {
      const { daemon: { zmqport } } = config;
      log.info(`Ensuring zmq is enabled for fluxd on port: ${zmqport}`);
      systemService.enablefluxdZmq(`tcp://127.0.0.1:${zmqport}`);
    }, 20 * 60 * 1000);
    setTimeout(async () => { // wait as of restarts due to ui building
      try {
        // todo code shall be removed after some time
        const databaseApps = db.db(config.database.appsglobal.database);
        const databaseDaemon = db.db(config.database.daemon.database);
        const resultApps = await dbHelper.collectionStats(databaseApps, config.database.appsglobal.collections.appsMessages);
        log.info(`Apps messages count: ${resultApps.count}`);
        const resultHashes = await dbHelper.collectionStats(databaseDaemon, config.database.daemon.collections.appsHashes);
        log.info(`Apps hashes count: ${resultHashes.count}`);
        const query = {};
        const projection = { projection: { _id: 0 } };
        const resultAppsA = await dbHelper.findInDatabase(databaseApps, config.database.appsglobal.collections.appsMessages, query, projection);
        // for every hash of app check if it is in the database of hashes
        const processedHashes = [];
        const duplicateHashes = [];
        log.info('Running database consistency check');
        for (let i = 0; i < resultAppsA.length; i += 1) {
          const queryHash = { hash: resultAppsA[i].hash };
          // eslint-disable-next-line no-await-in-loop
          const resultHash = await dbHelper.findOneInDatabase(databaseDaemon, config.database.daemon.collections.appsHashes, queryHash, projection);
          if (!resultHash) {
            log.info(`Hash not found in hashes: ${resultAppsA[i].hash}`);
            // remove from app messages
            // eslint-disable-next-line no-await-in-loop
            // await dbHelper.findOneAndDeleteInDatabase(databaseApps, config.database.appsglobal.collections.appsMessages, queryHash, projection);
          }
          if (processedHashes.includes(resultAppsA[i].hash)) {
            log.info(`Duplicate hash in apps: ${resultAppsA[i].hash}`);
            // remove from app messages
            // eslint-disable-next-line no-await-in-loop
            await dbHelper.findOneAndDeleteInDatabase(databaseApps, config.database.appsglobal.collections.appsMessages, queryHash, projection);
            duplicateHashes.push(resultAppsA[i].hash);
          } else {
            processedHashes.push(resultAppsA[i].hash);
          }
        }
        // log all duplicated hashes
        log.info('Duplicate hashes:');
        log.info(JSON.stringify(duplicateHashes));
        const result = await dbHelper.findInDatabase(databaseDaemon, config.database.daemon.collections.appsHashes, query, projection);
        if (result && result.length) {
          log.info('Last known application hash');
          log.info(result[result.length - 1]);
        } else {
          log.info('No known application hash');
        }
        // check if valueSat is null, if so run fixExplorer as of typo bug
        let wrongAppMessage = false;
        const appMessage = await appsService.checkAppMessageExistence('e7e2e129dd24b8bcc5a93800c425da81f69c3dcdf02d1d5b3ce09ce2e1c94d67');
        if (appMessage && !appMessage.valueSat) {
          wrongAppMessage = true;
          log.info('Fixing explorer due to wrong app message');
        } else {
          log.info('App consistency check OK');
        }
        // rescan before last known height of hashes
        // it is important to have count values before consistency check
        if ((resultApps.count > resultHashes.count && result && result.length && result[result.length - 1].height >= 100) || wrongAppMessage) {
          // run fixExplorer at least from height 1670000
          explorerService.fixExplorer(result[result.length - 1].height - 50 > 1670000 ? 1670000 : result[result.length - 1].height - 50, wrongAppMessage);
          log.info('Flux Block Processing Service started in fix mode');
        } else if (resultApps.count > resultHashes.count) {
          explorerService.fixExplorer(0, true);
          log.info('Flux Block Processing Service started in fix mode from scratch');
        } else {
          // just initiate
          explorerService.initiateBlockProcessor(true, true);
          log.info('Flux Block Processing Service started');
        }
      } catch (error) {
        log.error(error);
        // just initiate
        explorerService.initiateBlockProcessor(true, true);
        log.info('Flux Block Processing Service started with exception.');
      }
    }, 2 * 60 * 1000);
    setTimeout(() => {
      // appsService.checkForNonAllowedAppsOnLocalNetwork();
      appsService.checkMyAppsAvailability(); // periodically checks
    }, 3 * 60 * 1000);
    setTimeout(() => {
      appsService.checkAndNotifyPeersOfRunningApps(); // first broadcast after 4m of starting fluxos
      setInterval(() => { // every 60 mins messages stay on db for 65m
        appsService.checkAndNotifyPeersOfRunningApps();
      }, 60 * 60 * 1000);
    }, 2 * 60 * 1000);
    setTimeout(() => {
      appsService.syncthingApps(); // rechecks and possibly adjust syncthing configuration every 2 minutes
      setTimeout(() => {
        appsService.masterSlaveApps(); // stop and starts apps using syncthing g: when a new master is required or was changed.
      }, 30 * 1000);
    }, 3 * 60 * 1000);
    setTimeout(() => {
      setInterval(() => { // every 30 mins (15 blocks)
        appsService.continuousFluxAppHashesCheck();
      }, 30 * 60 * 1000);
      appsService.continuousFluxAppHashesCheck();
    }, (Math.floor(Math.random() * (30 - 15 + 1)) + 15) * 60 * 1000); // start between 15m and 30m after fluxOs start
    setTimeout(() => {
      // after 125 minutes of running ok and to make sure we are connected for enough time for receiving all apps running on other nodes
      // 125 minutes should give enough time for node receive currently two times the apprunning messages
      log.info('Starting to spawn applications');
      appsService.trySpawningGlobalApplication();
    }, 125 * 60 * 1000);
    setInterval(() => {
      appsService.checkApplicationsCompliance();
    }, 60 * 60 * 1000); //  every hour
    setTimeout(() => {
      appsService.forceAppRemovals(); // force cleanup of apps every day
      setInterval(() => {
        appsService.forceAppRemovals();
      }, 24 * 60 * 60 * 1000);
    }, 30 * 60 * 1000);
    setTimeout(() => {
      appsService.checkStorageSpaceForApps();
    }, 20 * 60 * 1000);
    setInterval(() => {
      backupRestoreService.cleanLocalBackup();
    }, 25 * 60 * 1000); // every 25 minutes
    if (development) { // just on development branch
      setInterval(async () => {
        await fluxService.enterDevelopment().catch((error) => log.error(error));
        if (development === true || development === 'true' || development === 1 || development === '1') { // in other cases pause git pull
          setTimeout(async () => {
            await fluxService.softUpdateFlux().catch((error) => log.error(error));
          }, 15 * 1000);
        }
      }, 20 * 60 * 1000); // every 20 minutes
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
