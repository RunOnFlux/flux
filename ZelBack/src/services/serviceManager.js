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
const hashSyncIntervalMs = config.fluxapps.hashSyncIntervalMs;
const peerNotifyIntervalMs = config.fluxapps.peerNotifyIntervalMs;
const locationTtlS = config.fluxapps.locationTtlS;
const installingTtlS = config.fluxapps.installingTtlS;
const installErrorTtlS = config.fluxapps.installErrorTtlS;
const tempMsgTtlS = config.fluxapps.tempMsgTtlS;
const removalSpacingMs = config.fluxapps.removalSpacingMs;

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
 * (IndexOptionsConflict / IndexKeySpecsConflict) by dropping the old one and
 * recreating. Every other error bubbles up.
 */
async function ensureIndex(collection, spec, options = {}) {
  try {
    await collection.createIndex(spec, options);
  } catch (err) {
    const conflict = err && (err.codeName === 'IndexOptionsConflict' || err.codeName === 'IndexKeySpecsConflict');
    if (!conflict) throw err;
    const indexName = options.name || Object.entries(spec).map(([k, v]) => `${k}_${v}`).join('_');
    log.warn(`ensureIndex - conflicting index ${indexName} on ${collection.collectionName}, dropping and recreating`);
    await collection.dropIndex(indexName).catch((dropErr) => {
      log.warn(`ensureIndex - dropIndex ${indexName} failed: ${dropErr.message}`);
    });
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
    await database.collection(config.database.local.collections.loggedUsers).createIndex({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 }); // 2days
    await database.collection(config.database.local.collections.activeLoginPhrases).createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
    await database.collection(config.database.local.collections.activeSignatures).createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
    await database.collection(config.database.local.collections.activePaymentRequests).createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 }); // 1 hour
    await database.collection(config.database.local.collections.completedPayments).createIndex({ paymentId: 1 });
    await database.collection(config.database.local.collections.completedPayments).createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }); // 7 days
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
    await databaseTemp.collection(config.database.appsglobal.collections.appsTemporaryMessages).createIndex({ receivedAt: 1 }, { expireAfterSeconds: tempMsgTtlS });
    log.info('Temporary database prepared');
    log.info('Preparing Flux Apps locations');

    // ToDo: Fix all these broken database drops / index creations / removals all over the place. The prior dropIndex was removing the
    // index entirely so there was no index at all!

    // The below index is created in the Explorer Service. We need to remove all the database indexing from the Explorer Service.
    // It's not the explorer service's responsibility, and other services need these indexes before Explorer Service creates them.

    // It should be the dbService's responsibility that the db is in a state fit for use.

    // we have to create this index again here, as we need it to repair the db. As we were deleting this on every reboot (and it was only created when scannedHeight was 0)
    // Creating an index that already exists is a no-op
    await databaseTemp.collection(config.database.appsglobal.collections.appsMessages).createIndex({ hash: 1 }, { name: 'query for getting zelapp message based on hash', unique: true });
    await databaseTemp.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.version': 1 }, { name: 'query for getting app message based on version' });
    await databaseTemp.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.nodes': 1 }, { name: 'query for getting app message based on nodes' });
    // TTL is driven by expireAt (set per-document by store functions). Migrate from old broadcastedAt-based TTL.
    await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).dropIndex('broadcastedAt_1').catch(() => {});
    await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
    await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).createIndex({ name: 1 }, { name: 'query for getting zelapp location based on zelapp specs name' });
    await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).createIndex({ ip: 1, name: 1 });
    log.info('Flux Apps locations prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appStateEvents).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
    await databaseTemp.collection(config.database.appsglobal.collections.appStateEvents).createIndex({ ip: 1, type: 1, dedupKey: 1 }, { unique: true });
    await databaseTemp.collection(config.database.appsglobal.collections.appStateEvents).createIndex({ broadcastedAt: 1 });
    await databaseTemp.collection(config.database.appsglobal.collections.appStateEvents).createIndex({ createdAt: 1 });
    log.info('App state events collection prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts).dropIndex('broadcastedAt_1').catch(() => {});
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts).createIndex({ broadcastedAt: 1 });
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts).createIndex({ 'data.name': 1, 'data.ip': 1 }, { unique: true });
    log.info('Signed appinstalling broadcasts collection prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingLocations).dropIndex('broadcastedAt_1').catch(() => {});
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingLocations).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingLocations).createIndex({ name: 1 }, { name: 'query for getting flux app install location based on specs name' });
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingLocations).createIndex({ name: 1, ip: 1 }, { name: 'query for getting flux app install location based on specs name and node ip' });
    log.info('Flux Apps installing locations prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).dropIndex('cachedAt_1').catch(() => {});
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).dropIndex('broadcastedAt_1').catch(() => {});
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).createIndex({ name: 1 }, { name: 'query for getting flux app install errors location based on specs name' });
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).createIndex({ name: 1, hash: 1 }, { name: 'query for getting flux app install errors location based on specs name and hash' });
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).createIndex({ name: 1, hash: 1, ip: 1 }, { name: 'query for getting flux app install errors location based on specs name and hash and node ip' });
    log.info('App installing errors locations prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts).dropIndex('broadcastedAt_1').catch(() => {});
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts).createIndex({ broadcastedAt: 1 });
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts).createIndex({ 'data.name': 1, 'data.hash': 1, 'data.ip': 1 }, { unique: true });
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
    }, bootDelay(50 * 1000)); // Run at 50 seconds - BEFORE stopped apps recovery

    // Migrate existing containers from 'unless-stopped'/'always' to 'no' restart policy.
    // Non-destructive — doesn't stop containers, just prevents Docker from auto-starting
    // them on future daemon restarts. FluxOS manages container startup after dbReady.
    dockerService.migrateContainerRestartPolicies();

    // Read boot context early — determines startup behavior for container management.
    const bootContext = await AppSyncOrchestrator.readBootContext();

    // App startup manager owns all boot-time container lifecycle decisions:
    // FluxOS restart → skip (containers running). Locations expired → remove all.
    // Machine rebooted → wait for dbReady, then start valid apps. Timeout → remove all.
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
    setTimeout(() => {
      nodeStatusMonitor.monitorNodeStatus(appQueryService.installedApps, appUninstaller.removeAppLocally);
    }, bootDelay(1.5 * 60 * 1000));
    setTimeout(() => {
      syncthingMonitor.syncthingApps(
        globalState,
        appQueryService.installedApps,
        () => globalState,
        dockerService.appDockerStop,
        dockerService.appDockerRestart,
        dockerOperations.appDeleteDataInMountPoint,
        appUninstaller.removeAppLocally,
      ); // rechecks and possibly adjust syncthing configuration every 2 minutes
      setTimeout(() => {
        advancedWorkflows.masterSlaveApps(
          globalState,
          appQueryService.installedApps,
          appQueryService.listRunningApps,
          globalState.receiveOnlySyncthingAppsCache,
          globalState.backupInProgress,
          globalState.restoreInProgress,
          https,
        ); // stop and starts apps using syncthing g: when a new master is required or was changed.
      }, 30 * 1000);
      setTimeout(() => {
        appInspector.monitorSharedDBApps(appQueryService.installedApps, appUninstaller.removeAppLocally, globalState); // Monitor SharedDB Apps.
      }, 60 * 1000);
    }, bootDelay(3 * 60 * 1000));
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
