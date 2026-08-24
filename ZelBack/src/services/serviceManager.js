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
const fileOperationRecovery = require('./appSystem/fileOperationRecovery');
const networkRecovery = require('./appSystem/networkRecovery');
const volumeExecutor = require('./appSystem/volumeExecutor');
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
const ipLocationSync = require('./appPlacement/ipLocationSync');
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
const appsRuntimeState = require('./appManagement/appsRuntimeState');
const imageUpdateService = require('./imageUpdateService');
const { version: fluxVersion } = require('../../../package.json');
// const throughputLogger = require('./utils/throughputLogger');

// Initialize globalState caches with cacheManager
globalState.initializeCaches(cacheManager);

const apiPort = userconfig.initial.apiport || config.server.apiport;
const development = userconfig.initial.development || false;
const fluxTransactionCollection = config.database.daemon.collections.fluxTransactions;

const { bootDelayMultiplier } = config.fluxapps;
function bootDelay(ms) { return Math.round(ms * bootDelayMultiplier); }

const {
  portRestoreIntervalMs,
  cpuCheckIntervalMs,
  imageComplianceIntervalMs,
  forceRemovalIntervalMs,
  tempMsgTtlS,
} = config.fluxapps;

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
 * Remove rows that duplicate a would-be-unique key, keeping the newest of each.
 *
 * A recovery strategy for ensureIndex: when a unique build fails because the
 * collection already holds rows that violate it, this makes the data conform to
 * the invariant the index DECLARES - it deletes duplicates on the key the index
 * says must be unique, which is enforcing a contract rather than losing data.
 * Only safe where the key IS the row's identity, so it is passed in per build by
 * the caller that knows the collection, never applied by default. A rollup whose
 * duplicates must be summed rather than dropped (the tampering incident count)
 * belongs to its owning service instead - see the note on ensureIndex.
 *
 * Keeps the newest per group (rows sort by _id, which is time-ordered), honours
 * the index's partialFilterExpression so it only touches rows the index covers,
 * and returns how many it removed.
 *
 * @param {object} collection - a mongo collection handle
 * @param {object} spec - the index key, e.g. { hash: 1 }
 * @param {object} options - the index options (read for partialFilterExpression)
 * @returns {Promise<number>} rows removed
 */
async function dedupeByKey(collection, spec, options = {}) {
  const groupId = {};
  Object.keys(spec).forEach((key, i) => { groupId[`k${i}`] = `$${key}`; });
  // Held in memory deliberately, and measured rather than assumed: run against a
  // live node's collection unioned with itself until every key appeared 16 times
  // - 1,030,208 rows, the duplicate state this exists to repair - it finished in
  // under 2s without spilling. The $sort adds nothing on top while it stays an
  // index walk on _id, which it is for a spec with no partialFilterExpression;
  // the first partial index to use this wants re-measuring, because the $match
  // ahead of the sort is what would make the sort blocking. allowDiskUse is not
  // set: it would take a mongo below 6.0, where the cap errors instead of
  // spilling, and the network floor is moving past that.
  //
  // ids[0] rather than $max: $group does not document that it carries a
  // preceding sort into an accumulator, and that non-guarantee is about results
  // merged from several sources - this is one standalone mongod. Checked against
  // 64,388 real duplicate groups, ids[0] was the newest in all 64,388.
  const pipeline = [
    ...(options.partialFilterExpression ? [{ $match: options.partialFilterExpression }] : []),
    { $sort: { _id: -1 } },
    { $group: { _id: groupId, ids: { $push: '$_id' } } },
    { $match: { 'ids.1': { $exists: true } } },
  ];
  const groups = await collection.aggregate(pipeline).toArray();
  const toRemove = groups.flatMap((group) => group.ids.slice(1));
  if (!toRemove.length) return 0;
  await collection.deleteMany({ _id: { $in: toRemove } });
  return toRemove.length;
}

/**
 * Assert one index, healing the failures that are recoverable.
 *
 *   - a pre-existing index with conflicting OPTIONS (IndexOptionsConflict /
 *     IndexKeySpecsConflict) is dropped by its real name and recreated;
 *   - a unique build blocked by DUPLICATE ROWS runs the caller's `recover`
 *     strategy (see dedupeByKey) and rebuilds, so the node ends up WITH the
 *     index rather than running degraded without it;
 *   - anything else rethrows.
 *
 * The rethrow is deliberate and is NOT the blanket swallow it replaced. Index
 * setup runs before any service or interval starts, so the 15s startFluxFunctions
 * retry re-runs it safely: a TRANSIENT failure (mongo mid-election, a slow-disk
 * blip) heals on the next pass instead of being skipped until the next reboot,
 * and a genuinely UNRECOVERABLE database wedges loudly - which is correct, since
 * a node whose DB cannot hold its schema cannot serve apps and appremove would
 * not rescue it. The realistic wedge that finding motivated - a unique index
 * over rows that already violate it - is repaired above, not hidden.
 *
 * TRUE NORTH: eventually every collection owns its own schema-prepare - its
 * index spec plus whatever dedupe or merge its data needs - the way
 * appsRuntimeState.prepareCollection and appTamperingDetectionService already
 * do, and boot just invokes those prepare functions. That turns this ~40-call
 * imperative block into a set of owned, individually testable units. This
 * function is the increment toward it, not the destination; a full move of the
 * remaining builds is a separate refactor, out of scope for the PR that added it.
 *
 * @param {object} collection - a mongo collection handle
 * @param {object} spec - the index key
 * @param {object} [options] - the index options
 * @param {(collection: object, spec: object, options: object) => Promise<number>} [recover]
 *   run when a unique build is blocked by existing duplicate rows
 */
async function ensureIndex(collection, spec, options = {}, recover = null) {
  try {
    await collection.createIndex(spec, options);
  } catch (err) {
    const conflict = err && (err.codeName === 'IndexOptionsConflict' || err.codeName === 'IndexKeySpecsConflict');
    if (conflict) {
      const specKeys = JSON.stringify(spec);
      const indexes = await collection.listIndexes().toArray();
      const match = indexes.find((idx) => JSON.stringify(idx.key) === specKeys);
      if (match?.name) {
        log.warn(`ensureIndex - conflicting index '${match.name}' on ${collection.collectionName} (key: ${specKeys}), dropping and recreating`);
        await collection.dropIndex(match.name);
      }
      await collection.createIndex(spec, options);
      return;
    }
    const duplicate = err && (err.code === 11000 || err.codeName === 'DuplicateKey');
    if (duplicate && recover) {
      const removed = await recover(collection, spec, options);
      log.warn(`ensureIndex - ${collection.collectionName} (key: ${JSON.stringify(spec)}) held ${removed} row(s) violating a unique index; removed and rebuilding`);
      await collection.createIndex(spec, options);
      return;
    }
    throw err;
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
    // legacy pre-incident-schema rows expire via detectedAt; current incident
    // documents expire via lastSeen. The tamper service purges pre-schema
    // rows at startup, so the detectedAt pair only matters where old code
    // still writes; drop it once the fleet is past the incident schema.
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
    await ensureIndex(
      database.collection(config.database.local.collections.appTamperingEvents),
      { lastSeen: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'lastSeen_ttl' }, // 30 days
    );
    await ensureIndex(
      database.collection(config.database.local.collections.appTamperingEvents),
      { appName: 1, eventType: 1, lastSeen: -1 },
      { name: 'appName_eventType_lastSeen' },
    );
    // The unique incident-rollup index lives with its owner: duplicate rollups
    // must have their counts SUMMED, not one dropped, so the merge needs the
    // collection's own knowledge rather than a generic dedupe. See
    // prepareIncidentRollup.
    await appTamperingDetectionService.prepareIncidentRollup();
    await appTamperingDetectionService.checkNodeReboot();
    // appsRuntimeState (localzelapps): merge any pre-unique-index duplicate docs,
    // then enforce one doc per component identifier
    await appsRuntimeState.prepareCollection();
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
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsMessages), { hash: 1 }, { name: 'query for getting zelapp message based on hash', unique: true }, dedupeByKey);
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsMessages), { 'appSpecifications.version': 1 }, { name: 'query for getting app message based on version' });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsMessages), { 'appSpecifications.nodes': 1 }, { name: 'query for getting app message based on nodes' });
    // TTL is driven by expireAt (set per-document by store functions). Migrate from old broadcastedAt-based TTL.
    await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).dropIndex('broadcastedAt_1').catch(() => {});
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsLocations), { expireAt: 1 }, { expireAfterSeconds: 0 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsLocations), { name: 1 }, { name: 'query for getting zelapp location based on zelapp specs name' });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsLocations), { ip: 1, name: 1 });
    log.info('Flux Apps locations prepared');
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appStateEvents), { expireAt: 1 }, { expireAfterSeconds: 0 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appStateEvents), { ip: 1, type: 1, dedupKey: 1 }, { unique: true }, dedupeByKey);
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appStateEvents), { broadcastedAt: 1 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appStateEvents), { createdAt: 1 });
    log.info('App state events collection prepared');
    await databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts).dropIndex('broadcastedAt_1').catch(() => {});
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts), { expireAt: 1 }, { expireAfterSeconds: 0 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts), { broadcastedAt: 1 });
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts), { 'data.name': 1, 'data.ip': 1 }, { unique: true }, dedupeByKey);
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
    await ensureIndex(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts), { 'data.name': 1, 'data.hash': 1, 'data.ip': 1 }, { unique: true }, dedupeByKey);
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
      peerCountIfAboveThreshold: () => peerManager.peerCountIfAboveThreshold(),
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
    // a reconciler start (incl. a backoff straggler after boot) must refresh the
    // app's network presence inside the sigterm TTL window, not at the hourly tick;
    // checkAndNotifyPeersOfRunningApps coalesces bursts
    appReconciler.setOnContainerStarted(() => peerNotification.checkAndNotifyPeersOfRunningApps());
    // a removed component's in-memory controller verdict dies with it - a
    // reinstalled g:/r: app must await a fresh election, not inherit a stale one
    appUninstaller.setOnComponentRemoved((id) => appReconciler.forgetDesiredState(id));
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
    // Mount every installed app's data volume (derived from the installed-apps
    // DB) and drop the superseded legacy @reboot remount crontab entries
    log.info('crontab and mounts cleanup...');
    await crontabAndMountsCleanup.cleanupCrontabAndMounts().catch((error) => {
      log.error(`Crontab and mounts cleanup service error: ${error.message}`);
    });
    // Perform container mount recovery - restart containers that started before their mounts were created
    log.info('Container mount recovery check...');
    await containerMountRecovery.performContainerMountRecovery().catch((error) => {
      log.error(`Container mount recovery service error: ${error.message}`);
    });
    // A file operation's container is detached from the process that started
    // it, so a FluxOS restart leaves one running with nobody waiting for its
    // result, and its staging directory on the volume. The recovery below
    // reclaims both, after the volumes above are mounted, since it reads them.
    //
    // The fetch starts early so the image is in hand before the first file
    // operation arrives, rather than being pulled while an owner waits on a
    // request. The recovery does not depend on it: that is a host rm over names
    // readdir returned, and runs on a node that can reach nothing.
    //
    // Not awaited: the node takes the image at its own place in a window, so
    // the fleet ends up holding it without every node fetching at the same
    // moment. A node that cannot reach the registry takes it from one that did,
    // which only works if they have it.
    volumeExecutor.startImagePrefetch();

    log.info('Reclaiming interrupted file operations...');
    await fileOperationRecovery.recoverInterruptedFileOperations().catch((error) => {
      log.error(`File operation recovery error: ${error.message}`);
    });

    // At boot, before anything installs: an app network is created per app and
    // removed only by the uninstaller, so an uninstall interrupted between the
    // container going and the network going leaves one behind for ever. Each
    // holds an octet that getFreeFluxAppNetworkOctet cannot hand out again, and
    // when the last of 255 is gone nothing can be installed on the node.
    //
    // Here rather than on a schedule because a sweep must not meet an install
    // in progress: at boot the expected names are simply what the database
    // holds, with no window in which an app has a network and no record yet.
    await networkRecovery.reclaimOrphanedAppNetworks();
    syncthingService.startSyncthingSentinel();
    log.info('Syncthing service started');
    // Awaited: generating an identity rewrites config/userconfig.js, and that
    // write is not atomic - a reload landing inside it leaves the process with
    // no userconfig.initial at all. A node that already has an identity returns
    // from here immediately, so this costs the fleet nothing.
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
      // Best effort during boot — the reconciler starts monitoring per app as it settles.
      monitoringOrchestrator.startMonitoringOfApps(null).catch((error) => log.error(error));
      portManager.restoreAppsPortsSupport();
    }, bootDelay(1 * 60 * 1000));
    // Resolve this node's enterprise identity once, up front. Self-reschedules
    // every 5 minutes until the pubkey resolves (daemon/benchmark may still be
    // coming up). Once cached, hot paths (spawn loop) read it synchronously
    // via getCachedEnterpriseIdentity() with no network call and no throws.
    const identityReady = enterpriseNetwork.scheduleIdentityResolution();

    // Services that read from zelappsinformation wait for the orchestrator
    // to finish rebuilding it rather than guessing a setTimeout delay.
    const startDbDependentServices = async () => {
      await globalState.waitForDbReady();
      log.info('DB ready - starting db-dependent services');
      // Interim until policyStore supersedes it at the userconfig rebase (see the
      // module header): restore the iplocation table from its GridFS cache and keep
      // it fresh. Detached - placement degrades to /16 arithmetic without a table.
      ipLocationSync.startSync().catch((err) => log.error(`ipLocationSync start error: ${err.message}`));
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
    };
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
      // The syncthing decider is declare-only: it writes desired run-state and
      // data-state (via appReconciler) and enqueues; the reconciler is the sole
      // actuator that stops, starts, and wipes - inside its per-key single-flight,
      // so a start can never race a data wipe.
      syncthingMonitor.syncthingApps(
        globalState,
        appQueryService.installedApps,
        () => globalState,
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
  ensureIndex,
  dedupeByKey,
};
