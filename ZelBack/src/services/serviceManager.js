const config = require('config');
const https = require('https');

// we import this first so the caches are instantiated before any other modules
// are imported
const cacheManager = require('./utils/cacheManager').default;
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const explorerService = require('./explorerService');
const fluxCommunication = require('./fluxCommunication');
const networkStateService = require('./networkStateService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
// App modular services - replacing appsService
const appInstaller = require('./appLifecycle/appInstaller');
const appUninstaller = require('./appLifecycle/appUninstaller');
const appController = require('./appManagement/appController');
const dockerOperations = require('./appManagement/dockerOperations');
const monitoringOrchestrator = require('./appMonitoring/monitoringOrchestrator');
const portManager = require('./appNetwork/portManager');
const appInspector = require('./appManagement/appInspector');
const availabilityChecker = require('./appMonitoring/availabilityChecker');
const nodeStatusMonitor = require('./appMonitoring/nodeStatusMonitor');
const peerNotification = require('./appMessaging/peerNotification');
const syncthingMonitor = require('./appMonitoring/syncthingMonitor');
const daemonHealthMonitor = require('./appMonitoring/daemonHealthMonitor');
const containerCrashRecovery = require('./appMonitoring/containerCrashRecovery');
const appReconciler = require('./appMonitoring/appReconciler');
const advancedWorkflows = require('./appLifecycle/advancedWorkflows');
const imageManager = require('./appSecurity/imageManager');
const appSpawner = require('./appLifecycle/appSpawner');
const { AppSyncOrchestrator } = require('./appMessaging/appSyncOrchestrator');
const crontabAndMountsCleanup = require('./appLifecycle/crontabAndMountsCleanup');
const containerMountRecovery = require('./appLifecycle/containerMountRecovery');
const appStartupManager = require('./appLifecycle/appStartupManager');
const hardwareValidationService = require('./appLifecycle/hardwareValidationService');
const globalState = require('./utils/globalState');
const { peerManager } = require('./utils/peerState');
const enterpriseNetwork = require('./utils/enterpriseNetwork');
const enterpriseConfig = require('./utils/enterpriseConfig');
const appQueryService = require('./appQuery/appQueryService');
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
const fluxNodeService = require('./fluxNodeService');
const volumeValidationService = require('./volumeValidationService');
const watchdogService = require('./watchdogService');
const cloudUIUpdateService = require('./cloudUIUpdateService');
const appTamperingBlocklistService = require('./appTamperingBlocklistService');
const nodeConfirmationService = require('./nodeConfirmationService');
const appTamperingDetectionService = require('./appTamperingDetectionService');
const imageUpdateService = require('./imageUpdateService');
const { version: fluxVersion } = require('../../../package.json');
// const throughputLogger = require('./utils/throughputLogger');

// Initialize globalState caches with cacheManager
globalState.initializeCaches(cacheManager);

const apiPort = userconfig.initial.apiport || config.server.apiport;
const development = userconfig.initial.development || false;
const fluxTransactionCollection = config.database.daemon.collections.fluxTransactions;

const bootDelayMultiplier = config.fluxapps.bootDelayMultiplier;
function bootDelay(ms) { return Math.round(ms * bootDelayMultiplier); }

const portRestoreIntervalMs = config.fluxapps.portRestoreIntervalMs;
const cpuCheckIntervalMs = config.fluxapps.cpuCheckIntervalMs;
const imageComplianceIntervalMs = config.fluxapps.imageComplianceIntervalMs;
const forceRemovalIntervalMs = config.fluxapps.forceRemovalIntervalMs;
const tempMsgTtlS = config.fluxapps.tempMsgTtlS;

// State objects for monitoring services
const dosState = {
  dosMessage: null,
  dosMountMessage: null,
  dosDuplicateAppMessage: null,
  get dosStateValue() { return fluxNetworkHelper.getDosStateValue(); },
  set dosStateValue(value) { fluxNetworkHelper.setDosStateValue(value); },
  testingPort: null,
  nextTestingPort: null,
  originalPortFailed: null,
  lastUPNPMapFailed: false,
};
const portsNotWorking = new Set();
const appsStorageViolations = [];

/**
 * createIndex that tolerates a pre-existing index with conflicting options
 * (IndexOptionsConflict / IndexKeySpecsConflict) by finding the conflicting
 * index via listIndexes, dropping it by its actual name, and recreating.
 * Every other error bubbles up.
 */
async function ensureIndex(collection, spec, options = {}) {
  try {
    await collection.createIndex(spec, options);
  } catch (err) {
    const conflict = err && (err.codeName === 'IndexOptionsConflict' || err.codeName === 'IndexKeySpecsConflict');
    if (!conflict) throw err;
    const specKeys = JSON.stringify(spec);
    const indexes = await collection.listIndexes().toArray();
    const match = indexes.find((idx) => JSON.stringify(idx.key) === specKeys);
    const dropName = match?.name;
    if (dropName) {
      log.warn(`ensureIndex - conflicting index '${dropName}' on ${collection.collectionName} (key: ${specKeys}), dropping and recreating`);
      await collection.dropIndex(dropName);
    }
    await collection.createIndex(spec, options);
  }
}

/**
 * To start FluxOS. A series of checks are performed on port and UPnP (Universal Plug and Play) support and mapping. Database connections are established. The other relevant functions required to start FluxOS services are called.
 */
async function startFluxFunctions() {
  try {
    if (!config.server.allowedPorts.includes(+apiPort)) {
      log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
      process.exit();
    }
    // Seed the enterprise node->owners map from helpers/enterprisenodes.json on disk
    // and sync it from github (every 6h thereafter). Awaited so consumers (identity
    // resolution, the spawn loop, app-spec validation) have data before they run; the
    // disk read and github fetch are both bounded (10s fetch timeout) so boot is never
    // stuck on this. A failed/invalid sync keeps the last-good value.
    await enterpriseConfig.startSync().catch((err) => log.error(`enterpriseConfig sync start error: ${err.message}`));
    // Hard dependencies — nothing starts until these are confirmed.
    await dbHelper.waitForMongo();
    await dockerService.waitForDocker();

    // Check and update CloudUI if needed (for legacy nodes without watchdog)
    log.info('Checking CloudUI installation...');
    await cloudUIUpdateService.checkAndUpdateCloudUI();
    // User configured UPnP node with routerIP, UPnP has already been verified and setup
    if (userconfig.initial.routerIP) {
      setInterval(() => {
        // this is only used as a protection against node operators removing rules
        // on legacy nodes.
        upnpService.adjustFirewallForUPNP();
      }, (60 * 60 * 1000) + 1000); // every 60m.
      setTimeout(() => {
        portManager.callOtherNodeToKeepUpnpPortsOpen();
        setInterval(() => {
          portManager.callOtherNodeToKeepUpnpPortsOpen();
        }, 8 * 60 * 1000);
      }, 1 * 60 * 1000);
    }
    await fluxNetworkHelper.addFluxNodeServiceIpToLoopback();
    await fluxNetworkHelper.allowOnlyDockerNetworksToFluxNodeService();
    fluxNodeService.start();
    log.info('Checking docker log for corruption...');
    await dockerService.dockerLogsFix();
    await systemService.mongodGpgKeyVeryfity();
    await systemService.mongoDBConfig();
    systemService.monitorSystem();
    log.info('System service initiated');
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
    await ensureIndex(database.collection(config.database.local.collections.loggedUsers), { createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });
    await ensureIndex(database.collection(config.database.local.collections.activeLoginPhrases), { createdAt: 1 }, { expireAfterSeconds: 900 });
    await ensureIndex(database.collection(config.database.local.collections.activeSignatures), { createdAt: 1 }, { expireAfterSeconds: 900 });
    await ensureIndex(database.collection(config.database.local.collections.activePaymentRequests), { createdAt: 1 }, { expireAfterSeconds: 3600 });
    await ensureIndex(database.collection(config.database.local.collections.completedPayments), { paymentId: 1 });
    await ensureIndex(database.collection(config.database.local.collections.completedPayments), { createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
    await ensureIndex(
      database.collection(config.database.local.collections.appTamperingEvents),
      { detectedAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'detectedAt_ttl' }, // 30 days
    );
    await ensureIndex(
      database.collection(config.database.local.collections.appTamperingEvents),
      { appName: 1, detectedAt: -1 },
      { name: 'appName_detectedAt' },
    );
    await appTamperingDetectionService.checkFrequentRestart();
    log.info('Local database prepared');
    log.info('Preparing temporary database...');
    // no need to drop temporary messages
    const databaseTemp = db.db(config.database.appsglobal.database);
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsTemporaryMessages), { receivedAt: 1 }, { expireAfterSeconds: tempMsgTtlS });
    log.info('Temporary database prepared');
    log.info('Preparing Flux Apps locations');

    // ToDo: Fix all these broken database drops / index creations / removals all over the place. The prior dropIndex was removing the
    // index entirely so there was no index at all!

    // The below index is created in the Explorer Service. We need to remove all the database indexing from the Explorer Service.
    // It's not the explorer service's responsibility, and other services need these indexes before Explorer Service creates them.

    // It should be the dbService's responsibility that the db is in a state fit for use.

    // we have to create this index again here, as we need it to repair the db. As we were deleting this on every reboot (and it was only created when scannedHeight was 0)
    // Creating an index that already exists is a no-op
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsMessages), { hash: 1 }, { name: 'query for getting zelapp message based on hash', unique: true });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsMessages), { 'appSpecifications.version': 1 }, { name: 'query for getting app message based on version' });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsMessages), { 'appSpecifications.nodes': 1 }, { name: 'query for getting app message based on nodes' });
    // TTL is driven by expireAt (set per-document by store functions). Migrate from old broadcastedAt-based TTL.
    await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).dropIndex('broadcastedAt_1').catch(() => {});
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsLocations), { expireAt: 1 }, { expireAfterSeconds: 0 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsLocations), { name: 1 }, { name: 'query for getting zelapp location based on zelapp specs name' });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsLocations), { ip: 1, name: 1 });
    log.info('Flux Apps locations prepared');
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appStateEvents), { expireAt: 1 }, { expireAfterSeconds: 0 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appStateEvents), { ip: 1, type: 1, dedupKey: 1 }, { unique: true });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appStateEvents), { broadcastedAt: 1 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appStateEvents), { createdAt: 1 });
    log.info('App state events collection prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts).dropIndex('broadcastedAt_1').catch(() => {});
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts), { expireAt: 1 }, { expireAfterSeconds: 0 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts), { broadcastedAt: 1 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts), { 'data.name': 1, 'data.ip': 1 }, { unique: true });
    log.info('Signed appinstalling broadcasts collection prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingLocations).dropIndex('broadcastedAt_1').catch(() => {});
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingLocations), { expireAt: 1 }, { expireAfterSeconds: 0 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingLocations), { name: 1 }, { name: 'query for getting flux app install location based on specs name' });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingLocations), { name: 1, ip: 1 }, { name: 'query for getting flux app install location based on specs name and node ip' });
    log.info('Flux Apps installing locations prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).dropIndex('cachedAt_1').catch(() => {});
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).dropIndex('broadcastedAt_1').catch(() => {});
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations), { expireAt: 1 }, { expireAfterSeconds: 0 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations), { name: 1 }, { name: 'query for getting flux app install errors location based on specs name' });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations), { name: 1, hash: 1 }, { name: 'query for getting flux app install errors location based on specs name and hash' });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations), { name: 1, hash: 1, ip: 1 }, { name: 'query for getting flux app install errors location based on specs name and hash and node ip' });
    log.info('App installing errors locations prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts).dropIndex('broadcastedAt_1').catch(() => {});
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts), { expireAt: 1 }, { expireAfterSeconds: 0 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts), { broadcastedAt: 1 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts), { 'data.name': 1, 'data.hash': 1, 'data.ip': 1 }, { unique: true });
    log.info('Signed app installing errors broadcasts collection prepared');

    // This fixes an issue where the appsMessage db has NaN for valueSat. Once db is repaired on all nodes,
    // we can remove this.
    await dbHelper.repairNanInAppsMessagesDb();

    // Check for apps with incorrect volume mounts (containing /flux/ path)
    log.info('Checking for apps with incorrect volume mounts...');
    setTimeout(() => {
      volumeValidationService.checkAndFixIncorrectVolumeMounts().catch((error) => {
        log.error(`Volume validation service error: ${error.message}`);
      });
    }, bootDelay(45 * 1000)); // Run after 45 seconds to allow system to stabilize

    // Validate hardware requirements and remove non-compliant apps FIRST
    log.info('Scheduling hardware validation check...');
    setTimeout(() => {
      hardwareValidationService.performBootTimeHardwareValidation().catch((error) => {
        log.error(`Hardware validation service error: ${error.message}`);
      });
    }, bootDelay(50 * 1000)); // Run at 50 seconds - BEFORE boot reconciliation

    // Migrate existing containers from 'unless-stopped'/'always' to 'no' restart policy.
    // Non-destructive — doesn't stop containers, just prevents Docker from auto-starting
    // them on future daemon restarts. FluxOS manages container startup after dbReady.
    dockerService.migrateContainerRestartPolicies();

    // Start the reconcile workqueue (the single container actuator) and the
    // Docker die-event bridge that feeds it. The workqueue holds all triggers
    // until bootContainerStateSettled, then drains once daemon/DB are ready.
    appReconciler.start().catch((error) => {
      log.error(`App reconciler error: ${error.message}`);
    });
    containerCrashRecovery.start();

    // Read boot context early — determines startup behavior for container management.
    const bootContext = await AppSyncOrchestrator.readBootContext();

    // App startup manager owns all boot-time container lifecycle decisions:
    // Locations expired → remove all. Otherwise wait for daemon/DB, then reconcile.
    appStartupManager.manageAppsOnBoot(bootContext).catch((error) => {
      log.error(`App startup manager error: ${error.message}`);
    });

    // Wait for daemon RPC — manageAppsOnBoot (above) is fire-and-forget and gates
    // on waitForDaemonReady() internally with a 5-min timeout. It must be running
    // before daemonReady is set so its timeout/removal logic can trigger.
    await daemonServiceUtils.buildFluxdClient();
    await daemonServiceMiscRpcs.waitForDaemonRpc();
    // awaited so isDaemonSynced cache is populated before hash sync reads it
    await daemonServiceMiscRpcs.daemonBlockchainInfoService();
    globalState.daemonReady = true;

    // Initialize app sync orchestrator and spawner
    const orchestrator = new AppSyncOrchestrator({
      blockEmitter: explorerService.getBlockEmitter(),
      getEligibleSyncPeers: (minUptime) => peerManager.getEligibleSyncPeers(minUptime)
        .map((p) => ({ key: p.key, send: (msg) => p.send(msg) })),
      onPeerEvent: (event, cb) => peerManager.on(event, cb),
      offPeerEvent: (event, cb) => peerManager.removeListener(event, cb),
      markSyncRequested: (key) => peerManager.markSyncRequested(key),
      clearSyncRequested: () => peerManager.clearSyncRequested(),
      isEnterprise: () => enterpriseNetwork.getCachedEnterpriseIdentity(),
      networkStateReady: () => networkStateService.waitStarted(),
      fluxVersion,
    });
    nodeConfirmationService.onMessageCapabilityChange((capable) => orchestrator.onMessageCapabilityChange(capable));
    peerNotification.initialize();
    appSpawner.initialize();
    appInstaller.setOnInstallComplete(() => peerNotification.checkAndNotifyPeersOfRunningApps());
    log.info('App Spawner initialized');

    fluxNetworkHelper.adjustFirewall();
    log.info('Firewalls checked');
    fluxNetworkHelper.allowNodeToBindPrivilegedPorts();
    log.info('Node allowed to bind privileged ports');
    fluxCommunication.keepConnectionsAlive();
    log.info('Connections polling prepared');
    fluxNetworkHelper.initClockOffsetCache();
    log.info('Clock offset cache initialized');
    // Remove existing watchtower container (replaced by native image update service)
    imageUpdateService.removeWatchtowerContainer();
    // Start native image update service (delayed start)
    setTimeout(() => {
      imageUpdateService.startImageUpdateService();
      log.info('Native image update service started');
    }, bootDelay(10 * 60 * 1000)); // 10 minutes after startup
    fluxNetworkHelper.checkDeterministicNodesCollisions();
    appTamperingBlocklistService.start().catch((err) => {
      log.error(`appTamperingBlocklist start error: ${err.message}`);
    });
    log.info('Flux checks operational');
    fluxCommunication.initializeDiscovery();
    await nodeConfirmationService.start();
    if (config.fluxapps.discoveryAutostart !== false) {
      fluxCommunication.startDiscovery();
      log.info('Flux Discovery started');
    }
    // Cleanup and fix crontab mount entries (add wait logic, remove stale entries, ensure mounts are active)
    log.info('crontab and mounts cleanup...');
    await crontabAndMountsCleanup.cleanupCrontabAndMounts().catch((error) => {
      log.error(`Crontab and mounts cleanup service error: ${error.message}`);
    });
    // Perform container mount recovery - restart containers that started before their mounts were created
    log.info('Container mount recovery check...');
    await containerMountRecovery.performContainerMountRecovery().catch((error) => {
      log.error(`Container mount recovery service error: ${error.message}`);
    });
    syncthingService.startSyncthingSentinel();
    log.info('Syncthing service started');
    await pgpService.generateIdentity();
    log.info('PGP service initiated');
    // Ensure watchdog is installed and running on legacy OS (non-ArcaneOS) nodes
    watchdogService.ensureWatchdogRunning().catch((error) => {
      log.error(`Watchdog service error: ${error.message}`);
    });
    log.info('Watchdog service check initiated');
    const explorerDatabase = db.db(config.database.daemon.database);
    await dbHelper.dropCollection(explorerDatabase, fluxTransactionCollection).catch((error) => {
      if (error.message !== 'ns not found') {
        log.error(error);
      }
    });
    log.info('Mongodb zelnodetransactions dropped');

    networkStateService.start(
      { stateEmitter: explorerService.getBlockEmitter() },
    );
    cacheManager.logCacheSizesEvery(600_000);
    fluxCommunication.logSocketsEvery(600_000);

    // Uncomment for network interface debug traffic stats. Will move this
    // to part of the 'debug' setting in a future pull (and auto fetch the interface)

    // const throughput = new throughputLogger.ThroughputLogger(
    //   (result) => console.log(result),
    //   { intervalMs: 60_000, matchInterfaces: ['ens18'] },
    // );

    // await throughput.start();

    setTimeout(async () => {
      const fluxNetworkInterfaces = await dockerService.getFluxDockerNetworkPhysicalInterfaceNames();
      await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable(fluxNetworkInterfaces);
      log.info('Rechecking firewall app rules');
      await fluxNetworkHelper.purgeUFW();
      advancedWorkflows.testAppMount(); // test if our node can mount a volume
    }, bootDelay(30 * 1000));
    setTimeout(() => {
      appController.stopAllNonFluxRunningApps();
      monitoringOrchestrator.startMonitoringOfApps(null, globalState.appsMonitored, appQueryService.installedApps);
      portManager.restoreAppsPortsSupport();
    }, bootDelay(1 * 60 * 1000));
    // Resolve this node's enterprise identity once, up front. Self-reschedules
    // every 5 minutes until the pubkey resolves (daemon/benchmark may still be
    // coming up). Once cached, hot paths (spawn loop) read it synchronously
    // via getCachedEnterpriseIdentity() with no network call and no throws.
    const identityReady = enterpriseNetwork.scheduleIdentityResolution();

    // Services that read from zelappsinformation wait for the orchestrator
    // to finish rebuilding it rather than guessing a setTimeout delay.
    async function startDbDependentServices() {
      await globalState.waitForDbReady();
      log.info('DB ready - starting db-dependent services');
      advancedWorkflows.checkAndRemoveEnterpriseAppsOnNonArcane();
      await identityReady;
      try {
        await enterpriseNetwork.cleanupOwnershipViolations();
        log.info('Enterprise network cleanup completed');
      } catch (error) {
        log.error(`Enterprise network cleanup failed: ${error.message || error}`);
      }
      setInterval(() => {
        portManager.restorePortsSupport();
      }, portRestoreIntervalMs);
    }
    startDbDependentServices();
    log.info('Starting setting Node Geolocation');
    geolocationService.setNodeGeolocation();
    setTimeout(() => {
      const { daemon: { zmqport } } = config;
      log.info(`Ensuring zmq is enabled for fluxd on port: ${zmqport}`);
      try {
        systemService.enableFluxdZmq(`tcp://127.0.0.1:${zmqport}`);
      } catch (err) {
        log.error(err);
      }
    }, bootDelay(20 * 60 * 1000));
    explorerService.initiateBlockProcessor(true, true);
    log.info('Flux Block Processing Service started');
    setTimeout(() => {
      appInspector.checkApplicationsCpuUSage(globalState.appsMonitored, appQueryService.installedApps);
      setInterval(() => {
        appInspector.checkApplicationsCpuUSage(globalState.appsMonitored, appQueryService.installedApps);
      }, cpuCheckIntervalMs);
    }, bootDelay(cpuCheckIntervalMs));
    setTimeout(() => {
      // appsService.checkForNonAllowedAppsOnLocalNetwork();
      availabilityChecker.checkMyAppsAvailability(
        appQueryService.installedApps,
        dosState,
        portsNotWorking,
        portManager.failedNodesTestPortsCache,
        fluxNetworkHelper.isArcane,
      );
    }, bootDelay(3 * 60 * 1000));
    nodeStatusMonitor.initialize(appQueryService.installedApps, appUninstaller.removeAppLocally);
    setTimeout(() => {
      nodeStatusMonitor.monitorNodeStatus(appQueryService.installedApps, appUninstaller.removeAppLocally);
    }, bootDelay(1.5 * 60 * 1000));
    // Start the syncthing/masterSlave deciders once boot container state has settled
    // (the same AsyncGate the reconciler starts on), not after a fixed delay. Each
    // decider self-gates per cycle on its own prerequisites (mounts, syncthing health,
    // own-IP, FDM), so an early start is safe - it skips and retries until ready.
    globalState.waitForBootContainerStateSettled().then(() => {
      syncthingMonitor.syncthingApps(
        globalState,
        appQueryService.installedApps,
        () => globalState,
        // stop: record the desired run-state, then really stop synchronously so
        // the folder data wipe that follows happens on a stopped container
        async (id) => {
          appReconciler.setControllerDesired(id, 'stopped', 'syncthing sync');
          await dockerService.appDockerStop(id);
        },
        // start: hand the run-state to the reconciler (the single actuator);
        // permissions are already fixed by the state machine before this point
        async (id) => { appReconciler.setControllerDesired(id, 'running', 'syncthing synced'); },
        dockerOperations.appDeleteDataInMountPoint,
        appUninstaller.removeAppLocally,
      ); // rechecks syncthing configuration each cycle
      // masterSlave self-gates on syncthingAppsFirstRun (the syncthing monitor's
      // first-run mount-safety must complete before any g: election), so it starts
      // concurrently rather than after a timed offset.
      advancedWorkflows.masterSlaveApps(
        globalState,
        appQueryService.installedApps,
        appQueryService.listRunningApps,
        globalState.receiveOnlySyncthingAppsCache,
        globalState.backupInProgress,
        globalState.restoreInProgress,
        https,
      ); // stops and starts g: syncthing apps when a new master is required or changed.
      setTimeout(() => {
        appInspector.monitorSharedDBApps(appQueryService.installedApps, appUninstaller.removeAppLocally, globalState); // Monitor SharedDB Apps.
      }, 60 * 1000);
    });
    // Hash sync and spawner startup are now managed by the AppSyncOrchestrator (event-driven)
    orchestrator.start(bootContext);
    log.info('AppSyncOrchestrator started');
    setInterval(() => {
      imageManager.checkApplicationsCompliance(appQueryService.installedApps, appUninstaller.removeAppLocally);
    }, imageComplianceIntervalMs);
    setTimeout(() => {
      advancedWorkflows.forceAppRemovals();
      setInterval(() => {
        advancedWorkflows.forceAppRemovals();
      }, forceRemovalIntervalMs);
    }, bootDelay(30 * 60 * 1000));
    // Daemon health monitoring
    setTimeout(() => {
      daemonHealthMonitor.checkDaemonHealthAndCleanup();
      setInterval(() => {
        daemonHealthMonitor.checkDaemonHealthAndCleanup();
      }, bootDelay(15 * 60 * 1000));
    }, bootDelay(5 * 60 * 1000));
    setTimeout(() => {
      appInspector.checkStorageSpaceForApps(
        appQueryService.installedApps,
        appUninstaller.removeAppLocally,
        advancedWorkflows.softRedeploy,
        appsStorageViolations,
      );
    }, bootDelay(20 * 60 * 1000));
    setInterval(() => {
      backupRestoreService.cleanLocalBackup();
    }, bootDelay(25 * 60 * 1000));
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
