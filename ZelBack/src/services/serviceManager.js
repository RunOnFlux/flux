const config = require('config');
const https = require('https');

// we import this first so the caches are instantiated before any other modules
// are imported
const cacheManager = require('./utils/cacheManager').default;
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const { untilSucceeds } = require('./utils/untilSucceeds');
const explorerService = require('./explorerService');
const fluxCommunication = require('./fluxCommunication');
const networkStateService = require('./networkStateService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const databaseHealthService = require('./databaseHealthService');
const hostStallService = require('./hostStallService');
const appKill = require('./appLifecycle/appKill');
// App modular services - replacing appsService
const appInstaller = require('./appLifecycle/appInstaller');
const appUninstaller = require('./appLifecycle/appUninstaller');
const localRemovalQueue = require('./appLifecycle/localRemovalQueue');
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
const ufwHelper = require('./utils/ufwHelper');
const policyStore = require('./policyStore');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const appQueryService = require('./appQuery/appQueryService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');
const paymentPositions = require('./migrations/paymentPositions');
const placements = require('./migrations/placements');
const fluxService = require('./fluxService');
const geolocationService = require('./geolocationService');
const ipLocationSync = require('./appPlacement/ipLocationSync');
const upnpService = require('./upnpService');
const syncthingService = require('./syncthingService');
const pgpService = require('./pgpService');
const dockerService = require('./dockerService');
const backupRestoreService = require('./backupRestoreService');
const systemService = require('./systemService');
const systemdNotify = require('./utils/systemdNotify');
const fluxadmService = require('./fluxadmService');
const fluxNodeService = require('./fluxNodeService');
const volumeValidationService = require('./volumeValidationService');
const watchdogService = require('./watchdogService');
const cloudUIUpdateService = require('./cloudUIUpdateService');
const appTamperingBlocklistService = require('./appTamperingBlocklistService');
const residentialNodeDosService = require('./residentialNodeDosService');
const peerSetStabilityService = require('./peerSetStabilityService');
const outboundPathService = require('./outboundPathService');
const uplinkService = require('./uplinkService');
const nodeConfirmationService = require('./nodeConfirmationService');
const appTamperingDetectionService = require('./appTamperingDetectionService');
const appsRuntimeState = require('./appManagement/appsRuntimeState');
const appPlacements = require('./appManagement/appPlacements');
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
  forceRemovalIntervalMs,
  tempMsgTtlS,
} = config.fluxapps;

// State objects for monitoring services
const dosState = {
  get dosMessage() { return fluxNetworkHelper.getDosMessage(); },
  set dosMessage(value) { fluxNetworkHelper.setDosMessage(value); },
  get dosStateValue() { return fluxNetworkHelper.getDosStateValue(); },
  set dosStateValue(value) { fluxNetworkHelper.setDosStateValue(value); },
  testingPort: null,
  nextTestingPort: null,
  originalPortFailed: null,
  routerRefusalsSeen: 0,
};
const portsNotWorking = new Set();
const appsStorageViolations = [];

/**
 * Brings every collection boot depends on to its schema: indexes, the merges
 * their unique indexes need, and the one-off repairs. Every step is safe to
 * repeat, and any failure rejects.
 * @returns {Promise<void>}
 */
async function prepareDatabaseSchema() {
  log.info('Preparing local database...');
  // Index builds: they run on the maintenance client.
  const db = dbHelper.maintenanceConnection() || dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  // Logins survive a restart: every request re-verifies its signature and
  // re-checks its privilege against the node's current config, and each
  // session collection's TTL index expires its rows. A login row never holds
  // the session's signature (loginSignatures does, for a minute); one that
  // does loses it here.
  await dbHelper.updateInDatabase(database, config.database.local.collections.loggedUsers, { signature: { $exists: true } }, { $unset: { signature: '' } });
  // Named literally because they are no longer part of the schema: the payment
  // request and receipt collections outlived the endpoint that wrote them, and
  // a node's word was never the payment record - the chain is. Dropping is
  // idempotent, so this costs one 'ns not found' per boot once they are gone.
  await Promise.all(['activepaymentrequests', 'completedpayments'].map((orphan) => dbHelper
    .dropCollection(database, orphan).catch((error) => {
      if (error.message !== 'ns not found') {
        log.error(error);
      }
    })));
  await dbHelper.ensureIndexes(database.collection(config.database.local.collections.loggedUsers), [
    { key: { createdAt: 1 }, expireAfterSeconds: 14 * 24 * 60 * 60 },
  ]);
  await dbHelper.ensureIndexes(database.collection(config.database.local.collections.activeLoginPhrases), [
    { key: { createdAt: 1 }, expireAfterSeconds: 900 },
  ]);
  await dbHelper.ensureIndexes(database.collection(config.database.local.collections.activeSignatures), [
    { key: { createdAt: 1 }, expireAfterSeconds: 900 },
  ]);
  await dbHelper.ensureIndexes(database.collection(config.database.local.collections.loginSignatures), [
    { key: { createdAt: 1 }, expireAfterSeconds: 60 },
    { key: { loginPhrase: 1 } },
  ]);
  // legacy pre-incident-schema rows expire via detectedAt; current incident
  // documents expire via lastSeen. The tamper service purges pre-schema
  // rows at startup, so the detectedAt pair only matters where old code
  // still writes; drop it once the fleet is past the incident schema.
  await dbHelper.ensureIndexes(database.collection(config.database.local.collections.appTamperingEvents), [
    { key: { detectedAt: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60, name: 'detectedAt_ttl' }, // 30 days
    { key: { appName: 1, detectedAt: -1 }, name: 'appName_detectedAt' },
    { key: { lastSeen: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60, name: 'lastSeen_ttl' }, // 30 days
    { key: { appName: 1, eventType: 1, lastSeen: -1 }, name: 'appName_eventType_lastSeen' },
  ]);
  // The unique incident-rollup index lives with its owner: duplicate rollups
  // must have their counts SUMMED, not one dropped, so the merge needs the
  // collection's own knowledge rather than a generic dedupe. See
  // prepareIncidentRollup.
  await appTamperingDetectionService.prepareIncidentRollup();
  await appTamperingDetectionService.checkNodeReboot();
  // appsRuntimeState (localzelapps): merge any pre-unique-index duplicate docs,
  // then enforce one doc per component identifier
  await appsRuntimeState.prepareCollection();
  // appPlacements (localzelapps): one record per app
  await appPlacements.prepareCollection();
  // The explorer's collections: their indexes are the explorer's to declare.
  await explorerService.prepareCollections();
  log.info('Local database prepared');
  log.info('Preparing temporary database...');
  // no need to drop temporary messages
  const databaseTemp = db.db(config.database.appsglobal.database);
  await dbHelper.ensureIndexes(databaseTemp.collection(config.database.appsglobal.collections.appsTemporaryMessages), [
    { key: { receivedAt: 1 }, expireAfterSeconds: tempMsgTtlS },
  ]);
  log.info('Temporary database prepared');
  log.info('Preparing Flux Apps locations');

  // ToDo: Fix all these broken database drops / index creations / removals all over the place. The prior dropIndex was removing the
  // index entirely so there was no index at all!

  // The below index is created in the Explorer Service. We need to remove all the database indexing from the Explorer Service.
  // It's not the explorer service's responsibility, and other services need these indexes before Explorer Service creates them.

  // It should be the dbService's responsibility that the db is in a state fit for use.

  // we have to create this index again here, as we need it to repair the db. As we were deleting this on every reboot (and it was only created when scannedHeight was 0)
  // Creating an index that already exists is a no-op
  await dbHelper.ensureIndexes(databaseTemp.collection(config.database.appsglobal.collections.appsMessages), [
    { key: { hash: 1 }, name: 'query for getting zelapp message based on hash', unique: true, recover: dbHelper.dedupeByKey },
    { key: { txid: 1 }, name: 'query for getting zelapp message based on txid' },
    { key: { height: 1 }, name: 'query for getting zelapp message based on height' },
    { key: { 'appSpecifications.name': 1 }, name: 'query for getting app message based on zelapp specs name' },
    { key: { 'appSpecifications.owner': 1 }, name: 'query for getting app message based on zelapp specs owner' },
    { key: { 'appSpecifications.repotag': 1 }, name: 'query for getting app message based on image' },
    { key: { 'appSpecifications.version': 1 }, name: 'query for getting app message based on version' },
    { key: { 'appSpecifications.nodes': 1 }, name: 'query for getting app message based on nodes' },
  ]);
  await dbHelper.ensureNewestAppMessageIndex(databaseTemp.collection(config.database.appsglobal.collections.appsMessages));
  // TTL is driven by expireAt (set per-document by store functions).
  await dbHelper.ensureIndexes(databaseTemp.collection(config.database.appsglobal.collections.appsLocations), [
    { key: { expireAt: 1 }, expireAfterSeconds: 0 },
    { key: { name: 1 }, name: 'query for getting zelapp location based on zelapp specs name' },
    { key: { ip: 1, name: 1 } },
  ]);
  log.info('Flux Apps locations prepared');
  await dbHelper.ensureIndexes(databaseTemp.collection(config.database.appsglobal.collections.appStateEvents), [
    { key: { expireAt: 1 }, expireAfterSeconds: 0 },
    { key: { ip: 1, type: 1, dedupKey: 1 }, unique: true, recover: dbHelper.dedupeByKey },
    { key: { broadcastedAt: 1 } },
    { key: { createdAt: 1 } },
    // the events of one type still standing, every move among them
    { key: { type: 1, expireAt: 1 }, name: 'events by type and expiry' },
    // the moves that lead to an address
    { key: { 'data.newIP': 1 }, name: 'moves by the address they lead to', partialFilterExpression: { type: 'ipchanged' } },
  ]);
  log.info('App state events collection prepared');
  await dbHelper.ensureIndexes(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingBroadcasts), [
    { key: { expireAt: 1 }, expireAfterSeconds: 0 },
    { key: { broadcastedAt: 1 } },
    { key: { 'data.name': 1, 'data.ip': 1 }, unique: true, recover: dbHelper.dedupeByKey },
  ]);
  log.info('Signed appinstalling broadcasts collection prepared');
  await dbHelper.ensureIndexes(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingLocations), [
    { key: { expireAt: 1 }, expireAfterSeconds: 0 },
    { key: { name: 1 }, name: 'query for getting flux app install location based on specs name' },
    { key: { name: 1, ip: 1 }, name: 'query for getting flux app install location based on specs name and node ip' },
  ]);
  log.info('Flux Apps installing locations prepared');
  await dbHelper.ensureIndexes(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations), [
    { key: { expireAt: 1 }, expireAfterSeconds: 0 },
    { key: { name: 1 }, name: 'query for getting flux app install errors location based on specs name' },
    { key: { name: 1, hash: 1 }, name: 'query for getting flux app install errors location based on specs name and hash' },
    { key: { name: 1, hash: 1, ip: 1 }, name: 'query for getting flux app install errors location based on specs name and hash and node ip' },
  ]);
  log.info('App installing errors locations prepared');
  await dbHelper.ensureIndexes(databaseTemp.collection(config.database.appsglobal.collections.appsInstallingErrorsBroadcasts), [
    { key: { expireAt: 1 }, expireAfterSeconds: 0 },
    { key: { broadcastedAt: 1 } },
    { key: { 'data.name': 1, 'data.hash': 1, 'data.ip': 1 }, unique: true, recover: dbHelper.dedupeByKey },
  ]);
  log.info('Signed app installing errors broadcasts collection prepared');

  // This fixes an issue where the appsMessage db has NaN for valueSat. Once db is repaired on all nodes,
  // we can remove this.
  await dbHelper.repairNanInAppsMessagesDb();
}

/**
 * To start FluxOS. A series of checks are performed on port and UPnP (Universal Plug and Play) support and mapping. Database connections are established. The other relevant functions required to start FluxOS services are called.
 *
 * Not unit-testable: every step acts on the machine, and a throw re-runs the
 * whole boot 15 s later with whatever is stubbed by then. Unit-test the steps
 * it calls; the integration harness covers the sequence.
 */
async function startFluxFunctions() {
  try {
    if (!config.server.allowedPorts.includes(+apiPort)) {
      log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
      process.exit(systemdNotify.EXIT_CONFIG);
    }
    // Ahead of anything that might call a runtime API this NodeJS lacks. A
    // below-floor node stays up holding a sticky DOS, so /flux/info names the
    // version found and the version required.
    fluxNetworkHelper.checkNodeJsVersionAllowed();
    // Before the dependencies are waited for: a stalled one is what this sees.
    // Awaited so a trip recorded in this boot holds the node before boot acts.
    await hostStallService.start();
    // Hard dependencies — nothing starts until these are confirmed.
    await dbHelper.waitForMongo();
    databaseHealthService.watch(dbHelper.databaseConnection(), 'main');
    databaseHealthService.watch(dbHelper.maintenanceConnection(), 'maintenance');
    // As soon as MongoDB answers: a below-floor node stays up holding a sticky
    // DOS, so /flux/info names the version found and the version required.
    fluxNetworkHelper.checkMongoDbVersionAllowed(await dbHelper.getMongoDbVersion());
    await dockerService.waitForDocker();
    const dockerInfo = await dockerService.dockerInfo().catch(() => null);
    // Where docker keeps its records, read while it answers, for a kill made
    // while it does not.
    if (dockerInfo?.DockerRootDir) appKill.usePaths({ dockerRoot: dockerInfo.DockerRootDir });
    // As soon as Docker answers, before the container firewall is applied: a
    // below-floor node stays up holding a sticky DOS, so /flux/info names the
    // version found and the version required.
    fluxNetworkHelper.checkDockerVersionAllowed(await dockerService.dockerVersion().then((version) => version.Version, () => null));
    await fluxNetworkHelper.checkCgroupsAllowed(dockerInfo?.CgroupDriver ?? null);
    // Before any work that a restart would cut short: a registration that
    // needs its kill timeout raised restarts FluxOS, and this waits for it.
    await fluxService.ensurePm2KillTimeout();
    // Before anything runs the ufw helper: the copy root runs is installed once
    // per start.
    await ufwHelper.path();
    // Before anything reads or changes the firewall: a node whose ufw defaults
    // file is broken has no firewall until this repairs it.
    await fluxNetworkHelper.ensureUfwDefaults().catch((error) => log.error(error));
    // The node's own firewall rules, before any other code writes to the
    // firewall and before any app starts.
    await fluxNetworkHelper.adjustFirewall();
    log.info('Firewalls checked');

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
    fluxadmService.start();
    log.info('Fluxadm access service initiated');
    await untilSucceeds('Database schema preparation', prepareDatabaseSchema);
    const db = dbHelper.databaseConnection();

    // The location table this node already holds, brought back as soon as the
    // database is up. Detached and best-effort - every consumer degrades safely
    // without it. On a node that has run before this is a single marker read
    // against rows already in mongo, so the residential verdict and placement's
    // fault domains hold their table within milliseconds of boot rather than
    // behind the app-database rebuild, which neither depends on. Fetching a NEW
    // baseline is the expensive half and stays in startDbDependentServices,
    // where its two-million-row ingest cannot land on top of that rebuild.
    ipLocationSync.restoreCachedTable().catch((err) => log.error(`ipLocationSync restore error: ${err.message}`));

    // Check for apps with incorrect volume mounts (containing /flux/ path)
    log.info('Checking for apps with incorrect volume mounts...');
    // BOTH CONDITIONS, because neither implies the other. The delay is for the host
    // settling - docker, mounts, crontab - and the gate is for the policy the hard
    // redeploy it performs needs to pull an image again. This pass runs ONCE per
    // boot and has nothing that retries it, so firing it into a closed gate loses
    // the fix until the node next restarts.
    setTimeout(() => {
      globalState.waitForPolicyReady().then(() => volumeValidationService.checkAndFixIncorrectVolumeMounts()).catch((error) => {
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

    // The rules that keep app containers off private networks and off each
    // other's networks, applied before any app container starts. A failure is
    // logged and apps still start. Rechecked so a removed chain returns; each
    // network FluxOS creates or removes re-applies them as it goes.
    await dockerService.applyContainerFirewall();
    setInterval(() => dockerService.applyContainerFirewall(), 10 * 60 * 1000);

    // App startup manager owns all boot-time container lifecycle decisions:
    // Locations expired → remove all. Otherwise wait for daemon/DB, then reconcile.
    appStartupManager.manageAppsOnBoot(bootContext).catch((error) => {
      log.error(`App startup manager error: ${error.message}`);
    });
    // Not awaited: it waits for this node's address, and the announcer, the one
    // reader of what it writes, waits for it.
    placements.backfillPlacements();

    // Above the daemon wait, because syncthing has nothing to do with the
    // daemon: the sentinel talks to syncthing's own API and reads userconfig,
    // and the webserver is already answering. Below it, a node whose fluxd is
    // slow or dead never starts measuring syncthing at all, and a check nobody
    // is making cannot report a fault - see syncthingService's health stamps.
    syncthingService.startSyncthingSentinel();
    log.info('Syncthing service started');

    // Wait for daemon RPC — manageAppsOnBoot (above) is fire-and-forget and gates
    // on waitForDaemonReady() internally with a 5-min timeout. It must be running
    // before daemonReady is set so its timeout/removal logic can trigger.
    await daemonServiceUtils.buildFluxdClient();
    await daemonServiceMiscRpcs.waitForDaemonRpc();
    // awaited so isDaemonSynced cache is populated before hash sync reads it
    await daemonServiceMiscRpcs.daemonBlockchainInfoService();
    globalState.daemonReady = true;

    // App payments are placed in chain order from the daemon's address index: it
    // positions the payments recorded before the scan recorded positions, and a
    // node with no app history yet fetches its payments through it.
    if (!daemonServiceMiscRpcs.isAddressIndex()) {
      log.error('fluxd is running without addressindex=1. FluxOS needs the address index to order app messages. Set addressindex=1 in flux.conf and reindex the daemon, or reinstall the node. FluxOS is stopping.');
      process.exit(1);
    }
    await untilSucceeds('Payment position backfill', () => paymentPositions.backfillPaymentPositions());

    // Initialize app sync orchestrator and spawner
    const orchestrator = new AppSyncOrchestrator({
      blockEmitter: explorerService.getBlockEmitter(),
      getEligibleSyncPeers: () => peerManager.getEligibleSyncPeers()
        .map((p) => ({ key: p.key, connectionId: p.connectionId, send: (msg) => p.send(msg) })),
      onPeerEvent: (event, cb) => peerManager.on(event, cb),
      offPeerEvent: (event, cb) => peerManager.removeListener(event, cb),
      isAboveThreshold: () => peerManager.isAboveThreshold(),
      networkStateReady: () => networkStateService.waitStarted(),
      fluxVersion,
    });
    // The orchestrator issues the sync requests and holds their deadlines, so
    // it is the only thing that knows whether an arriving answer is still
    // wanted. The peer manager asks rather than keeping its own copy.
    peerManager.syncResponseWanted = (peerSocket) => orchestrator.isSyncResponseWanted(peerSocket);

    // The other half of the peer-gated fallback. The orchestrator stops a node
    // whose peer set keeps collapsing from ever reaching READY, which is silent;
    // this says so, and puts a node that does it repeatedly out of service. Same
    // two edges, read for a different purpose, so it subscribes for itself
    // rather than being another of the orchestrator's jobs.
    peerSetStabilityService.start({
      onPeerEvent: (event, cb) => peerManager.on(event, cb),
      offPeerEvent: (event, cb) => peerManager.removeListener(event, cb),
      isAboveThreshold: () => peerManager.isAboveThreshold(),
    });

    // Whether this node's calls to other nodes reach them. Started beside the
    // peer-set watch because it draws its observer from the same network state,
    // and like it the check says why a node is out rather than leaving it silent.
    outboundPathService.start();

    // Network policy, started here rather than at the top of boot because it needs both of
    // the things that only exist by now: mongo, to restore and re-verify the bundle this
    // node last held, and peers, to ask for anything newer. Its old position could reach
    // neither, which is why it could only ever fetch from github.
    //
    // Not awaited. Boot does not wait on policy and never did: the node comes up, serves its
    // API and keeps its containers running regardless. What waits is acquisition, through
    // globalState.policyReady, which is the one decision that must not be made on a guess.
    policyStore.setPeerTransport({
      // The peers worth asking. One that does not advertise the capability has no handler
      // for the ask, so including it would buy a deadline's wait and an unrecognised-type
      // warning in its log.
      capableKeys: () => peerManager.getPolicyCapablePeers().map((peer) => peer.key),
      // The only ask. A key that no longer resolves is a peer that left between connecting
      // and being asked, which is not an error.
      requestFrom: (key, seq, correlationId) => {
        const peer = peerManager.get(key);
        if (!peer) return Promise.resolve();
        return fluxCommunicationMessagesSender.requestPolicyFromPeer(peer, seq, correlationId);
      },
      announce: (seq) => fluxCommunicationMessagesSender.announcePolicySeq(seq),
      // The latched level: peerManager already defines "enough peers to gossip with" with
      // hysteresis (appSyncPeerThreshold 12 up, appSyncDegradedThreshold 4 down). A late
      // subscriber cannot see the edge it missed, which is what this accessor exists for -
      // and reading the level rather than keeping an edge of our own is why nothing here
      // needs re-arming when a peer set collapses and rebuilds.
      aboveThreshold: () => peerManager.isAboveThreshold(),
    });
    // Discovery has not started yet - it is fifty lines below - so the peer set is empty at
    // this point on every node, always. Nothing here asks peers or the source; both are
    // driven by the two subscriptions that follow, which is what makes peers-first true at
    // boot rather than only at the 24-hour tick. It is the whole difference between a node
    // that boots while github is down getting policy from the neighbour beside it and
    // getting none for a day.
    //
    // PER JOIN for the ASK. peerThresholdReached fires when the count first crosses
    // appSyncPeerThreshold and then never again unless the set has since fallen below
    // appSyncDegradedThreshold, so as a prompt to ask peers it is the wrong signal: a node
    // asks once, its peers have nothing either, and when one of them later obtains a bundle
    // nothing tells this node to ask again - its peer set never collapsed, so the edge never
    // re-arms. Measured on a three-node fleet: node 1 asked at 08:16:09, node 0 adopted at
    // 08:16:54, and node 1 held nothing thereafter. Every join re-arms the ask, and the join
    // that crosses the threshold is one of them.
    //
    // The key is the whole point: notePeerAvailable asks THAT peer and never the source.
    // A broadcast would have to be rationed, and a rationed ask cannot serve a node that is
    // merely behind.
    //
    // The orchestrator next door draws the same distinction for its sync pool, and for the
    // same reason: a latched edge says nothing about a pool that has changed since it fired.
    peerManager.on('peerConnected', (key) => policyStore.notePeerAvailable(key));
    // Both edges, because the store's decision is about the peer SET. A peer leaving takes
    // its answer with it, and a node waiting on one that has gone waits out a deadline for an
    // answer that cannot come.
    peerManager.on('peerDisconnected', (key) => policyStore.notePeerGone(key));
    // AND the threshold itself, which is written one line after the arrival that crosses it.
    // Without this the crossing arrival decides while the level still reads false, and a set
    // that stops exactly at the threshold has nothing left to re-trigger the decision.
    peerManager.on('peerThresholdReached', () => policyStore.noteThresholdReached());
    policyStore.start().catch((err) => log.error(`policyStore start error: ${err.message}`));
    nodeConfirmationService.onMessageCapabilityChange((capable) => orchestrator.onMessageCapabilityChange(capable));
    peerNotification.initialize();
    appSpawner.initialize();
    appInstaller.setOnInstallComplete(() => peerNotification.checkAndNotifyPeersOfRunningApps());
    // a removed component's in-memory controller verdict dies with it - a
    // reinstalled g:/r: app must await a fresh election, not inherit a stale one
    appUninstaller.setOnComponentRemoved((id) => appReconciler.forgetDesiredState(id));
    // an app the registry stops listing is removed here and its removal told to peers
    localRemovalQueue.setRemover((appName) => appUninstaller.removeAppLocally(appName, null, true, false, true));
    // the node's address moved, so every app that survived it has to come up on
    // the new one - asked for durably here rather than driven from the network
    // layer, which sits underneath the reconciler and cannot require it
    fluxNetworkHelper.setOnAddressChanged((apps, reason, key) => appReconciler.requestRestartOf(apps, reason, key));
    // this node's own address moved: it records the move as its peers will, so
    // it knows FDM naming its old IP means itself, and tells them once it has
    // peers at the new address
    fluxNetworkHelper.setOnOwnAddressMoved((oldIp, newIp, movedAt) => fluxCommunication.handleOwnAddressMove(oldIp, newIp, movedAt));
    // whether this node ran apps at an address it has no record of leaving
    fluxNetworkHelper.setInstalledAppsListedAt((socketAddress) => appQueryService.installedAppsListedAt(socketAddress));
    fluxCommunication.announceRecordedOwnMovesWhenConnected();
    // every address benchmark reports as this node's own, from boot on: one that
    // differs from the address it last adopted is its move
    fluxNetworkHelper.startOwnAddressWatch();
    log.info('App Spawner initialized');

    fluxNetworkHelper.allowNodeToBindPrivilegedPorts();
    log.info('Node allowed to bind privileged ports');
    fluxCommunication.keepConnectionsAlive();
    log.info('Connections polling prepared');
    fluxNetworkHelper.initClockOffsetCache();
    log.info('Clock offset cache initialized');
    // Remove existing watchtower container (replaced by native image update service)
    imageUpdateService.removeWatchtowerContainer();
    // Start native image update service (delayed start)
    // A check that lands before the policy gate opens refuses, and the next one is
    // six hours away - so the app runs on the image it has for that long over a
    // window measured in minutes. The interval is the fallback; the gate is when
    // the first check is actually able to do its work.
    setTimeout(() => {
      globalState.waitForPolicyReady().then(() => {
        imageUpdateService.startImageUpdateService();
        log.info('Native image update service started');
      }).catch((error) => log.error(`Image update service start error: ${error.message}`));
    }, bootDelay(10 * 60 * 1000)); // 10 minutes after startup
    // this node's own standing on the network - collisions, reachability, its
    // own address - judged as each thing it depends on changes
    fluxNetworkHelper.startOwnStandingWatch();
    syncthingService.onListenerStateKnown(fluxNetworkHelper.noteSyncthingListenerKnown);
    // STARTED ON THE POLICY, NOT ON BOOT. The blocklist this enforces is a document in the
    // signed bundle, and the bundle is not resolved by the time this line runs. Started
    // here, its first tick reads nothing - and reading nothing is correctly refused rather
    // than taken for an empty list, because an unreadable blocklist releasing a node the
    // network deliberately DOSed is the failure that contract was written for. What it
    // costs is the interval: the next tick is twelve hours away and nothing brings it
    // forward, so a node on the blocklist goes unenforced for twelve hours per restart.
    globalState.waitForPolicyReady()
      .then(() => appTamperingBlocklistService.start())
      .catch((err) => log.error(`appTamperingBlocklist start error: ${err.message}`));
    // Not awaited, and started ahead of setNodeGeolocation below on purpose: the
    // first tick reads geolocation from the db when there is one, and otherwise
    // decides nothing and retries until the lookup this boot has landed.
    //
    // Injected the same way nodeStatusMonitor is, and for the same reason: the
    // app list is read from a query service deep enough in the lifecycle graph
    // that requiring it here would put geolocation and the network helper on
    // that load path. Removing the app is not this service's job - the single
    // give-up-an-app pass in advancedWorkflows does that.
    residentialNodeDosService.start({
      installedAppsFn: appQueryService.installedApps,
    }).catch((err) => {
      log.error(`residentialNodeDos start error: ${err.message}`);
    });
    uplinkService.start();
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
      log.info('Rechecking firewall app rules');
      await fluxNetworkHelper.purgeUFW();
    }, bootDelay(30 * 1000));
    setTimeout(() => {
      appController.stopAllNonFluxRunningApps();
      // Best effort during boot — the reconciler starts monitoring per app as it settles.
      monitoringOrchestrator.startMonitoringOfApps(null).catch((error) => log.error(error));
      portManager.restoreAppsPortsSupport();
    }, bootDelay(1 * 60 * 1000));
    // Resolve this node's enterprise identity once, up front. The key comes off disk and
    // policy arrives on an event, so this settles at boot rather than on a timer; the
    // interval is the fallback for a config that cannot be read at all. Once cached, hot
    // paths (spawn loop) read it synchronously via getCachedEnterpriseIdentity() with no
    // network call and no throws.
    enterpriseNetwork.scheduleIdentityResolution();

    // Services that read from zelappsinformation wait for the orchestrator
    // to finish rebuilding it rather than guessing a setTimeout delay.
    const startDbDependentServices = async () => {
      await globalState.waitForDbReady();
      log.info('DB ready - starting db-dependent services');
      // Interim until policyStore supersedes it at the userconfig rebase (see the
      // module header): keep the iplocation table fresh. The cached copy is
      // already back - restoreCachedTable ran with the schema prep above - so
      // what starts here is the fetch loop, whose ingest is the half worth
      // keeping clear of the rebuild that just finished. Detached; placement
      // degrades to /16 arithmetic without a table.
      ipLocationSync.startSync().catch((err) => log.error(`ipLocationSync start error: ${err.message}`));
      advancedWorkflows.checkAndRemoveEnterpriseAppsOnNonArcane();
      // Detached. The sweep uninstalls apps, so it waits for policy this node has confirmed
      // is the network's, and everything below here starts whether or not that ever arrives.
      enterpriseNetwork.startOwnershipSweeps();
      // STARTED ON THE POLICY, NOT ON A CLOCK. What this removes is decided by the
      // blocklist in the signed bundle, so it runs when that changes and when the gate
      // opens on it. An application arriving afterwards is judged by the installer
      // before it is written, and what has neither - a specification that did not
      // decrypt, a removal the node was too busy to take, a pass that stopped part way
      // - is held by name and asked again on its own timer.
      //
      // Here rather than beside the other app services: the first thing a pass does is
      // read the local app table, so it waits on the same db the sweep beside it waits
      // on.
      imageManager.startComplianceSweeps(appQueryService.installedApps, appUninstaller.removeAppLocally);
      setInterval(() => {
        portManager.restorePortsSupport();
      }, portRestoreIntervalMs);
      // Detached: one pass per start, once the boot gate has settled and in
      // this node's own slot. Nothing waits on it.
      portManager.removeStaleUpnpMappings();
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
    nodeStatusMonitor.start(appQueryService.installedApps, appUninstaller.removeAppLocally);
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
      // The election reads the busy lists and the receive-only cache off
      // globalState itself at each decision; they are not parameters. The
      // getters return snapshots and the election runs for the life of the
      // process, so anything captured at this call is frozen at boot and goes
      // quietly stale.
      advancedWorkflows.startMasterSlaveApps(
        globalState,
        appQueryService.installedApps,
        appQueryService.listRunningApps,
        https,
      ); // stops and starts g: syncthing apps when a new master is required or changed.
      setTimeout(() => {
        appInspector.monitorSharedDBApps(appQueryService.installedApps, appUninstaller.removeAppLocally, globalState); // Monitor SharedDB Apps.
      }, 60 * 1000);
    });
    // Hash sync and spawner startup are now managed by the AppSyncOrchestrator (event-driven)
    orchestrator.start(bootContext);
    log.info('AppSyncOrchestrator started');
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
    // Gated for the same reason as the image updater: this pass redeploys on a
    // storage violation, and one that runs before policy refuses and re-arms
    // thirty minutes out. It re-arms itself from then on, so only the first run
    // needs the gate.
    setTimeout(() => {
      globalState.waitForPolicyReady().then(() => appInspector.checkStorageSpaceForApps(
        appQueryService.installedApps,
        appUninstaller.removeAppLocally,
        advancedWorkflows.softRedeploy,
        appsStorageViolations,
      )).catch((error) => log.error(`Storage space check error: ${error.message}`));
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
  prepareDatabaseSchema,
  // testing exports
  dosState,
};
