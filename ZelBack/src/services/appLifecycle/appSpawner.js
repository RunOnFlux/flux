// App Spawner - Handles automatic spawning of global applications
const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const benchmarkService = require('../benchmarkService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const geolocationService = require('../geolocationService');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const log = require('../../lib/log');
const { normalizeSocketAddress, extractIp, extractPort, socketAddressesMatch } = require('../utils/socketAddressUtils');
const { compareInstallingClaims, compareInstanceSeniority, describeRanking } = require('../utils/instanceOrdering');

// Import modular services
const appQueryService = require('../appQuery/appQueryService');

// What this node last concluded about each app: the stage that removed it from
// the candidate list, or 'candidate' when it survived to the draw.
//
// Kept so the verdict can be published on CHANGE ONLY. "This pass passed over
// that app" is true every pass for every app the fleet already covers - it is a
// fact about the clock, and fluxEventBus says plainly that a cadence is a
// counter, not an event. What actually happens, rarely, is a verdict FLIPPING:
// an app this node was excluded from becoming one it may take again, which is
// the thing a caller wants to know and the thing no log line makes assertable.
const lastCandidacy = new Map();

/**
 * Which stage removed each app, from the survivor snapshots taken through the
 * filter chain, and publish only the ones whose answer changed since last pass.
 *
 * @param {Array<[string, Set<string>]>} stages Ordered [stageName, names still in].
 */
function publishCandidacyChanges(stages) {
  if (!stages.length) return;
  const [, initial] = stages[0];
  const verdicts = new Map();
  for (const name of initial) {
    let stage = 'candidate';
    for (let i = 1; i < stages.length; i += 1) {
      if (!stages[i][1].has(name)) { stage = stages[i][0]; break; }
    }
    verdicts.set(name, stage);
  }
  for (const [name, stage] of verdicts) {
    if (lastCandidacy.get(name) === stage) continue;
    lastCandidacy.set(name, stage);
    fluxEventBus.publish('spawner:candidacy', { name, stage, candidate: stage === 'candidate' });
  }
  for (const name of [...lastCandidacy.keys()]) {
    if (!verdicts.has(name)) lastCandidacy.delete(name);
  }
}
const resourceQueryService = require('../appQuery/resourceQueryService');
const messageStore = require('../appMessaging/messageStore');
const registryManager = require('../appDatabase/registryManager');
const imageManager = require('../appSecurity/imageManager');
const hwRequirements = require('../appRequirements/hwRequirements');
const portManager = require('../appNetwork/portManager');
const appUtilities = require('../utils/appUtilities');
const mountParser = require('../utils/mountParser');
const ipLocationStore = require('../appPlacement/ipLocationStore');
const placementFeasibility = require('../appPlacement/placementFeasibility');
const systemIntegration = require('../appSystem/systemIntegration');
const globalState = require('../utils/globalState');
const enterpriseNetwork = require('../utils/enterpriseNetwork');
const { FluxCacheManager } = require('../utils/cacheManager');
const appInstaller = require('./appInstaller');
const appUninstaller = require('./appUninstaller');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('../utils/appSyncEvents');
const fluxEventBus = require('../utils/fluxEventBus');

let appsCountAvailableToInstallOnMyNode = 0;

const collisionWaitMs = config.fluxapps.installCollisionWaitMs;
const { spawnReconfirmDelayMs } = config.fluxapps;
const nonEnterpriseSpawnDelayMs = config.fluxapps.nonEnterpriseSpawnDelayMs ?? 2 * 60 * 1000;

let spawnLoopRunning = false;

function initialize() {
  appSyncEvents.on(SYNC_EVENTS.SPAWNER_READY, () => {
    log.info('AppSyncOrchestrator signals ready, starting spawn loop');
    globalState.spawnerPaused = false;
    fluxEventBus.publish('spawner:resumed', {});
    if (!spawnLoopRunning) {
      spawnLoop();
    }
  });
  appSyncEvents.on(SYNC_EVENTS.READINESS_LOST, () => {
    log.warn('AppSyncOrchestrator signals readiness lost, spawner will pause on next iteration');
    globalState.spawnerPaused = true;
    fluxEventBus.publish('spawner:paused', {});
  });
}

async function spawnLoop() {
  spawnLoopRunning = true;
  try {
    while (!globalState.spawnerPaused) {
      const delayMs = await trySpawningGlobalApplication();
      if (delayMs > 0) await serviceHelper.delay(delayMs);
    }
  } finally {
    spawnLoopRunning = false;
    log.info('Spawn loop exited (paused)');
  }
}

// Note: Docker Hub error classification and caching is now handled by imageManager.js
// which uses structured error metadata from imageVerifier.js for accurate classification
// This spawner cache serves as an additional layer to prevent repeated spawn attempts

/**
 * Try spawning a global application that needs more instances
 * This is the main function that continuously checks for applications that need more instances
 * and attempts to spawn them on this node if it meets the requirements
 * @returns {Promise<void>}
 */
async function trySpawningGlobalApplication() {
  const installDelay = config.fluxapps.installation.delay * 1000;
  const isEnterprise = enterpriseNetwork.getCachedEnterpriseIdentity();
  if (isEnterprise === null) {
    log.info('Flux enterprise identity not yet resolved');
    fluxEventBus.publish('spawner:blocked', { reason: 'enterprise_unresolved' });
    return installDelay;
  }
  let { shortDelayTime, delayTime } = enterpriseNetwork.getSpawnDelays(isEnterprise, 0);
  let appHash = null;
  try {
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
      fluxEventBus.publish('spawner:blocked', { reason: 'not_synced' });
      return installDelay;
    }

    if (!globalState.dbReady) {
      log.info('DB not yet ready, waiting for orchestrator');
      fluxEventBus.publish('spawner:blocked', { reason: 'db_not_ready' });
      return installDelay;
    }

    if (fluxNetworkHelper.isNodeDos()) {
      log.info('Node is in DOS state. Global applications will not be installed');
      fluxEventBus.publish('spawner:blocked', { reason: 'dos' });
      return installDelay;
    }

    if (fluxNetworkHelper.isPlacementHeld()) {
      log.info(`Node held back from new placements (${fluxNetworkHelper.getPlacementHold()}). Global applications will not be installed`);
      fluxEventBus.publish('spawner:blocked', { reason: 'placement_hold' });
      return installDelay;
    }

    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Global applications will not be installed');
      fluxEventBus.publish('spawner:blocked', { reason: 'not_confirmed' });
      globalState.fluxNodeWasNotConfirmedOnLastCheck = true;
      return installDelay;
    }

    if (globalState.firstExecutionAfterItsSynced === true) {
      log.info('Explorer Synced, checking for expired apps');
      await registryManager.expireGlobalApplications();
      globalState.firstExecutionAfterItsSynced = false;
    }

    if (globalState.fluxNodeWasAlreadyConfirmed && globalState.fluxNodeWasNotConfirmedOnLastCheck) {
      globalState.fluxNodeWasNotConfirmedOnLastCheck = false;
      return spawnReconfirmDelayMs;
    }
    globalState.fluxNodeWasAlreadyConfirmed = true;

    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (benchmarkResponse.status === 'error') {
      log.info('FluxBench status Error. Global applications will not be installed');
      return installDelay;
    }
    // get my external IP and check that it is longer than 5 in length.
    let localSocketAddr = null;
    if (benchmarkResponse.data.ipaddress) {
      log.info(`Gathered IP ${benchmarkResponse.data.ipaddress}`);
      localSocketAddr = benchmarkResponse.data.ipaddress.length > 5 ? normalizeSocketAddress(benchmarkResponse.data.ipaddress) : null;
    }
    if (localSocketAddr === null) {
      throw new Error('Unable to detect Flux IP address');
    }

    // Our address without the port, derived once. It was being recomputed in
    // four places under three different names, so nothing told a reader they
    // were the same value.
    const localIp = extractIp(localSocketAddr);

    const runningApps = await appQueryService.listRunningApps();
    if (runningApps.status !== 'success') {
      throw new Error('trySpawningGlobalApplication - Unable to check running apps on this Flux');
    }
    if (runningApps.data.length >= config.fluxapps.maxAppsPerNode) {
      log.info(`trySpawningGlobalApplication - Node at max apps capacity (${runningApps.data.length}/${config.fluxapps.maxAppsPerNode})`);
      return delayTime;
    }

    // get all the applications list names missing instances
    // eslint-disable-next-line global-require
    const { globalAppsInformation } = require('../utils/appConstants');
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const currentHeight = syncStatus.data.height;
    const ponFork = config.fluxapps.daemonPONFork;
    const { blocksLasting } = config.fluxapps;
    const minBlocksAllowance = config.fluxapps.newMinBlocksAllowance;
    const pipeline = [
      // Filter out apps that are expired or expiring within minBlocksAllowance (100) blocks
      {
        $addFields: {
          _expireIn: {
            $ifNull: [
              '$expire',
              {
                $cond: {
                  if: { $gte: ['$height', ponFork] },
                  then: blocksLasting * 4,
                  else: blocksLasting,
                },
              },
            ],
          },
        },
      },
      {
        $addFields: {
          _actualExpirationHeight: {
            $cond: {
              if: { $lt: ['$height', ponFork] },
              then: {
                $cond: {
                  if: { $lte: [{ $add: ['$height', '$_expireIn'] }, ponFork] },
                  then: { $add: ['$height', '$_expireIn'] },
                  else: {
                    $add: [
                      ponFork,
                      { $multiply: [
                        { $subtract: [{ $add: ['$height', '$_expireIn'] }, ponFork] },
                        4,
                      ] },
                    ],
                  },
                },
              },
              else: { $add: ['$height', '$_expireIn'] },
            },
          },
        },
      },
      {
        $match: {
          _actualExpirationHeight: { $gt: currentHeight + minBlocksAllowance },
        },
      },
      {
        $lookup: {
          from: 'zelappslocation',
          localField: 'name',
          foreignField: 'name',
          as: 'locations',
        },
      },
      {
        $addFields: {
          actual: { $size: '$locations.name' },
        },
      },
      {
        $match: {
          $expr: { $lt: ['$actual', { $ifNull: ['$instances', 3] }] },
        },
      },
      {
        $project: {
          _id: 0,
          name: '$name',
          actual: '$actual',
          required: { $ifNull: ['$instances', 3] },
          nodes: { $ifNull: ['$nodes', []] },
          geolocation: { $ifNull: ['$geolocation', []] },
          hash: '$hash',
          version: '$version',
          enterprise: '$enterprise',
          owner: '$owner',
        },
      },
      { $sort: { name: 1 } },
    ];

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    log.info('trySpawningGlobalApplication - Checking for apps that are missing instances on the network.');
    let globalAppNamesLocation = await dbHelper.aggregateInDatabase(database, globalAppsInformation, pipeline);
    const numberOfGlobalApps = globalAppNamesLocation.length;
    if (!numberOfGlobalApps) {
      log.info('trySpawningGlobalApplication - No installable application found');
      return delayTime;
    }
    log.info(`trySpawningGlobalApplication - Found ${numberOfGlobalApps} apps that are missing instances on the network.`);

    let appToRun = null;
    let appToRunAux = null;
    let minInstances = null;
    let appFromAppsToBeCheckedLater = false;
    let appFromAppsSyncthingToBeCheckedLater = false;
    const { appsToBeCheckedLater, appsSyncthingToBeCheckedLater } = globalState;
    const appIndex = appsToBeCheckedLater.findIndex((app) => app.timeToCheck <= Date.now());
    const appSyncthingIndex = appsSyncthingToBeCheckedLater.findIndex((app) => app.timeToCheck <= Date.now());
    let runningAppList = [];
    let installingAppList = [];

    if (appIndex >= 0) {
      appToRun = appsToBeCheckedLater[appIndex].appName;
      appHash = appsToBeCheckedLater[appIndex].hash;
      minInstances = appsToBeCheckedLater[appIndex].required;
      appsToBeCheckedLater.splice(appIndex, 1);
      appFromAppsToBeCheckedLater = true;
      appsCountAvailableToInstallOnMyNode = Math.max(0, appsCountAvailableToInstallOnMyNode - 1);
    } else if (appSyncthingIndex >= 0) {
      appToRun = appsSyncthingToBeCheckedLater[appSyncthingIndex].appName;
      appHash = appsSyncthingToBeCheckedLater[appSyncthingIndex].hash;
      minInstances = appsSyncthingToBeCheckedLater[appSyncthingIndex].required;
      appsSyncthingToBeCheckedLater.splice(appSyncthingIndex, 1);
      appFromAppsSyncthingToBeCheckedLater = true;
      appsCountAvailableToInstallOnMyNode = Math.max(0, appsCountAvailableToInstallOnMyNode - 1);
    } else {
      const myNodeLocation = await systemIntegration.nodeFullGeolocation();

      // Where the candidates went. Every filter below removes apps for a
      // different and entirely reasonable reason, and none of them says so - the
      // pass ends with "No app currently to be processed" whether one filter
      // dropped everything or five each took a share. From outside the process
      // that is indistinguishable from an app nobody wanted, which is how a port
      // collision looked like a placement failure for a whole day.
      const survivors = { found: globalAppNamesLocation.length };
      const nameSet = () => new Set(globalAppNamesLocation.map((app) => app.name));
      const stages = [['found', nameSet()]];

      // filter apps that failed to install before
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => !runningApps.data.find((appsRunning) => appsRunning.Names[0].slice(5) === app.name)
        && !globalState.spawnErrorsLongerAppCache.has(app.hash)
        && !globalState.trySpawningGlobalAppCache.has(app.hash)
        && !appsToBeCheckedLater.some((appAux) => appAux.appName === app.name));
      survivors.afterAlreadyHeldOrTried = globalAppNamesLocation.length;
      stages.push(['afterAlreadyHeldOrTried', nameSet()]);

      // filter apps that are non enterprise or are marked to install on my node.
      // Enterprise-owned apps that target specific node IPs are strict: only a node
      // whose IP is listed may install them, regardless of version (the version>=8
      // bypass below does not apply to them).
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => {
        if (app.nodes.length > 0 && enterpriseNetwork.isEnterpriseAppOwner(app.owner)) {
          return app.nodes.some((ip) => socketAddressesMatch(ip, localSocketAddr));
        }
        return app.nodes.length === 0 || app.nodes.find((ip) => socketAddressesMatch(ip, localSocketAddr)) || app.version >= 8;
      });
      // Selection uses the SAME eligibility implementation as candidate counting
      // and the install gate, over the SAME source for where this node is - the
      // published table, which is the only thing the count can read for the
      // thousands of nodes it cannot ask. Taking continent and country from the
      // node's ip-api self-report instead put this one reader on a different
      // source from the other two: measured across the fleet, the two disagree on
      // country for about one node in thirteen, and where they disagree the table
      // is right roughly eighteen times out of nineteen. A node the count credits
      // to the table's country would then never volunteer for an app pinned there,
      // and the app sits below its instance count with candidates that look
      // available.
      //
      // The self-report is the fallback, for a node the table cannot place at all
      // - the same fallback, in the same direction, as the install gate. The old
      // string-prefix filters here hid every table-vocabulary region pin from
      // spawning and stripped _NONE, which turned a no-op deny into a whole-country
      // selection ban.
      const [selfContinentCode, selfCountryCode] = (myNodeLocation ?? '').split('_');
      let myContinentCode = selfContinentCode ?? null;
      let myCountryCode = selfCountryCode ?? null;
      let myTableRegion = null;
      try {
        const localHit = await ipLocationStore.lookup(localIp);
        // Both or neither: a hit carrying one without the other cannot place the
        // node any better than its own report can.
        if (localHit?.continentCode && localHit?.countryCode) {
          myContinentCode = localHit.continentCode;
          myCountryCode = localHit.countryCode;
        }
        myTableRegion = localHit?.region ?? null;
      } catch (error) {
        // store unreadable = the table cannot place this node, so its self-report
        // stands and the region is unknown; selection over-includes and the
        // installer arbitrates
      }
      const myLocation = { continentCode: myContinentCode, countryCode: myCountryCode, region: myTableRegion };
      survivors.afterNodePin = globalAppNamesLocation.length;
      stages.push(['afterNodePin', nameSet()]);
      globalAppNamesLocation = globalAppNamesLocation.filter(
        (app) => placementFeasibility.nodeLocationMatchesGeolocation(myLocation, app.geolocation),
      );
      survivors.afterGeolocation = globalAppNamesLocation.length;
      stages.push(['afterGeolocation', nameSet()]);
      globalAppNamesLocation = enterpriseNetwork.filterAppsByOwnership(globalAppNamesLocation, isEnterprise);
      survivors.afterOwnership = globalAppNamesLocation.length;
      stages.push(['afterOwnership', nameSet()]);

      // Drop candidates whose remaining slots are already claimed, before one is
      // picked at random. The pool counts running instances only, so an app that
      // other nodes are already installing still reads as short - and selection
      // is a lottery, so such a candidate does not merely waste its own cycle:
      // it can win the draw ahead of one this node could have installed, and the
      // node then spawns nothing for a whole pass. Counting every candidate's
      // claims costs one grouped read of a collection that holds only live
      // claims. The re-read before claiming still runs and is the authority;
      // this only spares the draw candidates it would have turned away.
      const claimsByApp = await registryManager.installingCountsByApp();
      globalAppNamesLocation = globalAppNamesLocation.filter(
        (app) => app.actual + (claimsByApp.get(app.name.toLowerCase()) ?? 0) < app.required,
      );

      appsCountAvailableToInstallOnMyNode = globalAppNamesLocation.length + appsSyncthingToBeCheckedLater.length + appsToBeCheckedLater.length;
      ({ shortDelayTime, delayTime } = enterpriseNetwork.getSpawnDelays(isEnterprise, appsCountAvailableToInstallOnMyNode));

      survivors.afterClaims = globalAppNamesLocation.length;
      stages.push(['afterClaims', nameSet()]);

      publishCandidacyChanges(stages);

      if (globalAppNamesLocation.length === 0) {
        log.info(`trySpawningGlobalApplication - No app currently to be processed (${JSON.stringify(survivors)})`);
        // A TALLY, not a stream. This is true on every pass of a fleet whose apps
        // are all at their instance count - roughly every 240ms per node under
        // the harness multiplier - and as an event it spent a ring every other
        // consumer shares, which is why nothing could afford to subscribe to it.
        // The breakdown stays in the log line above, and what CHANGED went out as
        // spawner:candidacy.
        fluxEventBus.count('spawner:noCandidates');
        return delayTime;
      }
      log.info(`trySpawningGlobalApplication - Found ${globalAppNamesLocation.length} apps that are missing instances on the network and can be selected to try to spawn on my node.`);
      let random = Math.floor(Math.random() * globalAppNamesLocation.length);
      appToRunAux = globalAppNamesLocation[random];
      const appsNamingThisNode = globalAppNamesLocation.filter((app) => app.nodes.find((ip) => socketAddressesMatch(ip, localSocketAddr)));
      if (appsNamingThisNode.length > 0) {
        random = Math.floor(Math.random() * appsNamingThisNode.length);
        appToRunAux = appsNamingThisNode[random];
      }

      appToRun = appToRunAux.name;
      appHash = appToRunAux.hash;
      minInstances = appToRunAux.required;

      log.info(`trySpawningGlobalApplication - Application ${appToRun} selected to try to spawn. Reported as been running in ${appToRunAux.actual} instances and ${appToRunAux.required} are required.`);
      runningAppList = await registryManager.appLocation(appToRun);
      installingAppList = await registryManager.appInstallingLocation(appToRun);
      if (runningAppList.length + installingAppList.length >= minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
        return shortDelayTime;
      }
      const isArcane = Boolean(process.env.FLUXOS_PATH);
      if (appToRunAux.enterprise && !isArcane) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} can only install on ArcaneOS`);
        globalState.spawnErrorsLongerAppCache.set(appHash, '');
        return shortDelayTime;
      }
    }

    globalState.trySpawningGlobalAppCache.set(appHash, '');
    log.info(`trySpawningGlobalApplication - App ${appToRun} hash: ${appHash}`);

    // TODO: re-enable once error classification (transient vs permanent) is implemented.
    // Without classification, transient infra errors suppress healthy apps network-wide.
    const errorCount = await registryManager.countAppInstallingErrors(appHash);
    if (errorCount >= 5) {
      log.warn(`trySpawningGlobalApplication - App ${appToRun} hash ${appHash} has ${errorCount} network-wide install failures (not blocking)`);
      fluxEventBus.publish('spawner:networkErrorSkip', { appName: appToRun, hash: appHash, errorCount });
    }

    runningAppList = await registryManager.appLocation(appToRun);

    // check if app not running on this device
    if (runningAppList.find((document) => document.ip.includes(localIp))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already running on this Flux IP`);
      return delayTime;
    }
    if (installingAppList.find((document) => document.ip.includes(localIp))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already being installed on this Flux IP`);
      return delayTime;
    }

    // get app specifications
    const appSpecifications = await registryManager.getApplicationGlobalSpecifications(appToRun);
    if (!appSpecifications) {
      throw new Error(`trySpawningGlobalApplication - Specifications for application ${appToRun} were not found!`);
    }

    // eslint-disable-next-line no-restricted-syntax
    const dbopen = dbHelper.databaseConnection();
    // eslint-disable-next-line global-require
    const { localAppsInformation } = require('../utils/appConstants');
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {}; // all
    const appsProjection = {
      projection: {
        _id: 0,
        name: 1,
        version: 1,
        repotag: 1,
        compose: 1,
      },
    };
    const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    const appExists = apps.find((app) => app.name === appSpecifications.name);
    if (appExists) { // double checked in installation process.
      log.info(`trySpawningGlobalApplication - Application ${appSpecifications.name} is already installed`);
      return shortDelayTime;
    }

    // Get app ports early - needed for both user-blocked check and public availability check
    const appPorts = appUtilities.getAppPorts(appSpecifications);

    // EARLY CHECK: Verify app doesn't use user-blocked ports before expensive Docker Hub operations
    // Skip this check for vetted apps
    const appIsVetted = await imageManager.isAppVetted(appSpecifications);
    if (!appIsVetted) {
      // eslint-disable-next-line no-restricted-syntax
      for (let i = 0; i < appPorts.length; i += 1) {
        const port = appPorts[i];
        const isUserBlocked = fluxNetworkHelper.isPortUserBlocked(port);
        if (isUserBlocked) {
          log.info(`trySpawningGlobalApplication - App ${appSpecifications.name} uses user-blocked port ${port}. Adding to error cache.`);
          globalState.spawnErrorsLongerAppCache.set(appHash, '');
          // eslint-disable-next-line no-await-in-loop
          return shortDelayTime;
        }
      }
    } else {
      log.info(`trySpawningGlobalApplication - App ${appSpecifications.name} is vetted. Bypassing user-blocked ports check.`);
    }

    // verify app compliance
    await imageManager.checkApplicationImagesCompliance(appSpecifications).catch((error) => {
      if (error.message !== 'Unable to communicate with Flux Services! Try again later.') {
        globalState.spawnErrorsLongerAppCache.set(appHash, '');
      }
      throw error;
    });

    // Refused before taking on new work, and only here. An application this node
    // cannot read contributes nothing to the totals the check below subtracts
    // from its capacity, so the space it believes is free includes space already
    // spoken for and this node would over-commit. The same refusal on the
    // maintenance paths would be wrong: a redeploy of an app already counted adds
    // nothing, and one unreadable application would freeze every other one on the
    // node. Named, because a node that quietly stops accepting work is a long
    // afternoon for whoever has to find out why.
    const unaccounted = resourceQueryService.unaccountedApps(await resourceQueryService.appsResources());
    if (unaccounted.length) {
      log.error(`trySpawningGlobalApplication - cannot account for what this node has committed: ${unaccounted.join(', ')} could not be read. Not taking on more.`);
      return shortDelayTime;
    }

    // verify requirements
    await hwRequirements.checkAppRequirements(appSpecifications);
    // enterprise network nodes: reserve >4 vCores of burst headroom (automatic CPU burst)
    if (isEnterprise) {
      await hwRequirements.checkAppCpuBurstHeadroom(appSpecifications);
    }

    // ensure ports unused
    // Get apps running specifically on this IP
    const appsRunningAtOurIp = await registryManager.getRunningAppIpList(localIp);
    const runningAppsNames = appsRunningAtOurIp.map((app) => app.name);

    await portManager.ensureApplicationPortsNotUsed(appSpecifications, runningAppsNames);

    // The check above reads a sibling's ports from the specifications the
    // network broadcasts, so it sees only what has been reported as RUNNING. A
    // sibling that has installed an application and not started it, or is still
    // installing it, appears nowhere in that list and holds the router's forward
    // regardless. Ask the other Flux nodes at this address directly, here rather
    // than during the port test, so a refusal costs no firewall rule and no port
    // mapping to unwind.
    //
    // Not because an enterprise application hides its ports. It seals them, and
    // a node running ArcaneOS opens them - assignedPortsGlobalApps decrypts. On
    // a node that is not running ArcaneOS it cannot, and there this ask is the
    // only thing that sees a sealed neighbour's ports at all.
    //
    // Answered rather than raised, and handled exactly as an unreachable port is
    // below: this node cannot host this app, which is an ordinary answer and not
    // a fault. What separates the two is how it is told, not what it costs the
    // app: raised, this is an error with a stack trace and no event; answered,
    // it is one line and a deferral the fleet can observe. The app holds the
    // entry every selection takes in the spawn cache either way - it was filed
    // at selection, and the catch below adds nothing for a hash already there -
    // so this node stops considering it until that expires, which is right,
    // because nothing changes here until the sibling gives the port up.
    const sibling = await portManager.siblingHoldingPort(appPorts, localSocketAddr);
    if (sibling) {
      log.error(`trySpawningGlobalApplication - ${appSpecifications.name} port ${sibling.port} is held by the Flux node at ${sibling.address}, which shares this public address. Installation aborted.`);
      // A deferral, published as one: this stands the node down and returns
      // shortDelayTime exactly as the seven reasons below it do, so it belongs
      // in that vocabulary rather than in an event of its own.
      fluxEventBus.publish('spawner:deferred', {
        appName: appSpecifications.name,
        reason: 'sibling_holds_port',
        delayMs: shortDelayTime,
        port: sibling.port,
        address: sibling.address,
      });
      return shortDelayTime;
    }

    // Note: User-blocked port check happens earlier (line ~353) before Docker Hub calls
    // Check if ports are publicly available - critical for proper Flux network operation
    const portVerdict = await portManager.checkInstallingAppPortAvailable(appPorts);
    if (portVerdict.ok === false) {
      log.error(`trySpawningGlobalApplication - Some of application ports of ${appSpecifications.name} are not available publicly. Installation aborted.`);
      // The cause lives in portManager, which says which port and which peers;
      // this says the spawner deferred, and on which of its verdicts.
      fluxEventBus.publish('spawner:deferred', {
        appName: appSpecifications.name,
        reason: 'ports_not_available',
        portVerdict: portVerdict.reason,
        delayMs: shortDelayTime,
      });
      return shortDelayTime;
    }

    // double check if app is installed on the number of instances requested
    runningAppList = await registryManager.appLocation(appToRun);
    installingAppList = await registryManager.appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length >= minInstances) {
      // KEPT when the running copies alone meet the count, CLEARED when the
      // claims were needed to reach it.
      //
      // A running copy is a durable fact and caching it is the point of the
      // cache - the app is covered, and re-deciding that every pass is waste.
      // A claim is not: it is withdrawn as soon as its node finds the share
      // already filled, seconds later and by design, because the share is
      // checked after the claim goes out. Cached on a count that needed those
      // claims, this node remembers "covered" for the cache's twelve hours and
      // never reconsiders, so an app that falls back below its instance count
      // waits out the day on every node that glanced inside that window.
      //
      // Clearing unconditionally is the other way to be wrong: an app whose
      // count is genuinely met would re-enter the candidate pool on every pass
      // and be declined again forever, never cached because it was never
      // installed.
      if (runningAppList.length < minInstances) {
        globalState.trySpawningGlobalAppCache.delete(appHash);
      }
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
      return shortDelayTime;
    }

    // canonical classification: sync flags are only valid on the primary mount, so a
    // g:/r:/s: in an invalid position (or inside a word like 'logs:') is NOT a synced
    // app and the same-IP-range placement caution below must not apply to it
    let syncthingApp = false;
    if (appSpecifications.version <= 3) {
      syncthingApp = mountParser.isSyncedComponent(appSpecifications.containerData);
    } else {
      syncthingApp = appSpecifications.compose.some((comp) => mountParser.isSyncedComponent(comp.containerData));
    }

    // An owner who names exactly as many nodes as instances has assigned the
    // placement, and the diversity share does not second-guess it. A longer
    // list is a candidate pool - `nodes` may carry up to 120 entries against
    // an instance count as low as one - so the share still governs, computed
    // over that pool (placementFeasibility restricts its candidate set to it).
    // The bypass applies only when THIS node is named: a v8+ app spawning on
    // an off-list node is subject to the share either way.
    let ownerNamedThisNode = false;
    if (syncthingApp) {
      const pinList = appSpecifications.nodes ?? [];
      ownerNamedThisNode = pinList.length > 0 && pinList.length <= minInstances
        && await placementFeasibility.specNamesThisNode(appSpecifications, localSocketAddr);
    }

    // A synced app may only be refused when a better-placed candidate provably
    // exists: this domain is refused once it holds its share of the instances,
    // computed over the app's eligible candidate set - never refused outright.
    let placementShare = null;
    let placementDomainOf = null;
    let myDomain = null;
    if (syncthingApp && !ownerNamedThisNode) {
      // placementComputation refuses a geo-restricted question while the location
      // table is still loading, because answering it over the whole network would
      // advise on numbers that mean nothing. That refusal is addressed to the HTTP
      // caller; reaching the catch below instead would read as a pre-install error
      // and park this app for six hours over a table that is seconds from ready.
      let computation;
      try {
        computation = await placementFeasibility.placementComputation(appSpecifications, minInstances);
      } catch (error) {
        if (error.statusCode !== 503) throw error;
        log.info(`trySpawningGlobalApplication - ${appSpecifications.name} deferred: ${error.message}`);
        return shortDelayTime;
      }
      placementShare = computation.feasibility;
      placementDomainOf = computation.domainOf;
      myDomain = placementDomainOf(localIp);
      // No `placeable` gate here, deliberately. This node reached the placement
      // check having passed its own geolocation filter, so it is itself an
      // eligible candidate - a table that resolves zero candidates network-wide
      // is contradicting the node's own location rather than proving the app
      // unplaceable, and refusing on that would strand the app everywhere.
      // Install-time geolocation checks remain authoritative.
      const heldInMine = await placementFeasibility.countHeldInDomain(runningAppList, myDomain, placementDomainOf)
        + await placementFeasibility.countHeldInDomain(installingAppList, myDomain, placementDomainOf);
      if (heldInMine >= placementShare.maxPerDomain) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and fault domain ${myDomain} already holds ${heldInMine} of its ${placementShare.maxPerDomain}-instance share (${placementShare.domainCount} eligible domains)`);
        return shortDelayTime;
      }
    }

    if (syncthingApp) {
      if (!appFromAppsToBeCheckedLater && !appFromAppsSyncthingToBeCheckedLater && runningAppList.length < 6) {
        // check if there are connectivity to all nodes
        // eslint-disable-next-line no-restricted-syntax
        for (const node of runningAppList) {
          const ip = extractIp(node.ip);
          const port = extractPort(node.ip);
          // eslint-disable-next-line no-await-in-loop
          const isOpen = await fluxNetworkHelper.isPortOpen(ip, port);
          if (!isOpen) {
            log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and instance running on ${ip}:${port} is not reachable, possible conenctivity issue, will be installed in 27m if remaining missing instances`);
            const appToCheck = {
              timeToCheck: Date.now() + 0.45 * 60 * 60 * 1000,
              appName: appToRun,
              hash: appHash,
              required: minInstances,
            };
            globalState.appsSyncthingToBeCheckedLater.push(appToCheck);
            globalState.trySpawningGlobalAppCache.delete(appHash);
            return shortDelayTime;
          }
        }
        // eslint-disable-next-line no-restricted-syntax
        for (const node of installingAppList) {
          const ip = extractIp(node.ip);
          const port = extractPort(node.ip);
          // eslint-disable-next-line no-await-in-loop
          const isOpen = await fluxNetworkHelper.isPortOpen(ip, port);
          if (!isOpen) {
            log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and instance being installed on ${ip}:${port} is not reachable, possible conenctivity issue, will be installed in 27m if remaining missing instances`);
            const appToCheck = {
              timeToCheck: Date.now() + 0.45 * 60 * 60 * 1000,
              appName: appToRun,
              hash: appHash,
              required: minInstances,
            };
            globalState.appsSyncthingToBeCheckedLater.push(appToCheck);
            globalState.trySpawningGlobalAppCache.delete(appHash);
            return shortDelayTime;
          }
        }
      }
    }

    if (!appFromAppsToBeCheckedLater && !appFromAppsSyncthingToBeCheckedLater
      && appToRunAux.nodes.length > 0 && !appToRunAux.nodes.find((ip) => socketAddressesMatch(ip, localSocketAddr))) {
      const deferral = config.fluxapps.spawnDeferrals.targetedNodesMs;
      const appToCheck = {
        timeToCheck: Date.now() + (appToRunAux.enterprise ? deferral.enterprise : deferral.standard),
        appName: appToRun,
        hash: appHash,
        required: minInstances,
      };
      const delayMs = appToRunAux.enterprise ? deferral.enterprise : deferral.standard;
      log.info(`trySpawningGlobalApplication - App ${appToRun} specs have target ips, will check in around ${Math.round(delayMs / 60000)}m if instances are still missing`);
      globalState.appsToBeCheckedLater.push(appToCheck);
      globalState.trySpawningGlobalAppCache.delete(appHash);
      fluxEventBus.publish('spawner:deferred', { appName: appToRun, reason: 'targeted_nodes', delayMs });
      return shortDelayTime;
    }

    if (!isEnterprise && !appFromAppsToBeCheckedLater && !appFromAppsSyncthingToBeCheckedLater) {
      const tier = await generalService.nodeTier();
      const appHWrequirements = hwRequirements.totalAppHWRequirements(appSpecifications, tier);
      let delay = false;
      const isArcane = Boolean(process.env.FLUXOS_PATH);
      if (!appToRunAux.enterprise && isArcane) {
        const appToCheck = {
          timeToCheck: Date.now() + nonEnterpriseSpawnDelayMs,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs not enterprise, will check in around ${Math.round(nonEnterpriseSpawnDelayMs / 1000)}s if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        fluxEventBus.publish('spawner:deferred', { appName: appToRun, reason: 'non_enterprise_on_arcane', delayMs: nonEnterpriseSpawnDelayMs });
        delay = true;
      } else if (!appSpecifications.staticip && geolocationService.isStaticIP()) {
        const deferral = config.fluxapps.spawnDeferrals.staticIpMs;
        const appToCheck = {
          timeToCheck: Date.now() + (appToRunAux.enterprise ? deferral.enterprise : deferral.standard),
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        const delayMs = appToRunAux.enterprise ? deferral.enterprise : deferral.standard;
        log.info(`trySpawningGlobalApplication - App ${appToRun} does not require static IP but node has static IP, will check in around ${Math.round(delayMs / 60000)}m if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        fluxEventBus.publish('spawner:deferred', { appName: appToRun, reason: 'static_ip', delayMs });
        delay = true;
      } else if (!appSpecifications.datacenter && geolocationService.isDataCenter()) { // NOTE: datacenter=true requires enterpriseAppOwners (validator) → ownership filter routes to enterprise nodes → which skip this deferral chain entirely. So datacenter is always falsy here.
        const deferral = config.fluxapps.spawnDeferrals.datacenterMs;
        const appToCheck = {
          timeToCheck: Date.now() + (appToRunAux.enterprise ? deferral.enterprise : deferral.standard),
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        const delayMs = appToRunAux.enterprise ? deferral.enterprise : deferral.standard;
        log.info(`trySpawningGlobalApplication - App ${appToRun} does not require datacenter but node is datacenter, will check in around ${Math.round(delayMs / 60000)}m if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        fluxEventBus.publish('spawner:deferred', { appName: appToRun, reason: 'datacenter', delayMs });
        delay = true;
      } else if (appToRunAux.nodes.length > 0 && appToRunAux.nodes.find((ip) => socketAddressesMatch(ip, localSocketAddr))) {
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs have this node as target ip`);
      } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
        const deferral = config.fluxapps.spawnDeferrals.capacityGap.largeMs;
        const appToCheck = {
          timeToCheck: Date.now() + (appToRunAux.enterprise ? deferral.enterprise : deferral.standard),
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        const delayMs = appToRunAux.enterprise ? deferral.enterprise : deferral.standard;
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around ${Math.round(delayMs / 60000)}m if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        fluxEventBus.publish('spawner:deferred', { appName: appToRun, reason: 'capacity_gap_large', delayMs });
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 7 && appHWrequirements.ram < 29000 && appHWrequirements.hdd < 370) {
        const deferral = config.fluxapps.spawnDeferrals.capacityGap.mediumMs;
        const appToCheck = {
          timeToCheck: Date.now() + (appToRunAux.enterprise ? deferral.enterprise : deferral.standard),
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        const delayMs = appToRunAux.enterprise ? deferral.enterprise : deferral.standard;
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from nimbus, will check in around ${Math.round(delayMs / 60000)}m if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        fluxEventBus.publish('spawner:deferred', { appName: appToRun, reason: 'capacity_gap_medium', delayMs });
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'super' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
        const deferral = config.fluxapps.spawnDeferrals.capacityGap.smallMs;
        const appToCheck = {
          timeToCheck: Date.now() + (appToRunAux.enterprise ? deferral.enterprise : deferral.standard),
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        const delayMs = appToRunAux.enterprise ? deferral.enterprise : deferral.standard;
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around ${Math.round(delayMs / 60000)}m if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        fluxEventBus.publish('spawner:deferred', { appName: appToRun, reason: 'capacity_gap_small', delayMs });
        delay = true;
      }
      if (delay) {
        return shortDelayTime;
      }
    }

    // ToDo: Move this to global
    const architecture = await systemIntegration.systemArchitecture();

    // TODO evaluate later to move to more broad check as image can be shared among multiple apps
    const compositedSpecification = appSpecifications.compose || [appSpecifications]; // use compose array if v4+ OR if not defined its <= 3 do an array of appSpecs.

    // eslint-disable-next-line no-restricted-syntax
    for (const componentToInstall of compositedSpecification) {
      // check repotag is available for download
      // eslint-disable-next-line no-await-in-loop
      await imageManager.verifyRepository(componentToInstall.repotag, {
        repoauth: componentToInstall.repoauth,
        specVersion: appSpecifications.version,
        architecture,
        appName: appSpecifications.name,
      }).catch((error) => {
        // imageManager already handles error classification and caching with intelligent TTLs (1h-7d)
        // Add to spawn cache with 1-hour TTL to allow retry sooner than default 12h
        // This lets temporary Docker Hub issues (network, rate limit) be retried faster
        log.warn(`trySpawningGlobalApplication - Docker Hub verification failed for ${appToRun}: ${error.message}`);
        globalState.trySpawningGlobalAppCache.set(appHash, '', { ttl: FluxCacheManager.oneHour });
        throw error;
      });
    }

    // triple check if app is installed on the number of instances requested
    runningAppList = await registryManager.appLocation(appToRun);
    installingAppList = await registryManager.appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length >= minInstances) {
      // KEPT when the running copies alone meet the count, CLEARED when the
      // claims were needed to reach it.
      //
      // A running copy is a durable fact and caching it is the point of the
      // cache - the app is covered, and re-deciding that every pass is waste.
      // A claim is not: it is withdrawn as soon as its node finds the share
      // already filled, seconds later and by design, because the share is
      // checked after the claim goes out. Cached on a count that needed those
      // claims, this node remembers "covered" for the cache's twelve hours and
      // never reconsiders, so an app that falls back below its instance count
      // waits out the day on every node that glanced inside that window.
      //
      // Clearing unconditionally is the other way to be wrong: an app whose
      // count is genuinely met would re-enter the candidate pool on every pass
      // and be declined again forever, never cached because it was never
      // installed.
      if (runningAppList.length < minInstances) {
        globalState.trySpawningGlobalAppCache.delete(appHash);
      }
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
      return shortDelayTime;
    }

    // Retract this node's installing claim, network-wide. A silent back-out
    // leaves the fluxappinstalling broadcast alive for its full TTL, and that
    // ghost keeps counting against instance totals and domain shares - and can
    // even win the cold-start seed election - for up to 15 minutes. On a small
    // eligible pool (a pinned org or region) one collision round of ghosts
    // stalls the whole domain for that window, so every withdrawal must say so.
    //
    // The retraction is a version 2 fluxappinstalling: the claim's own message,
    // withdrawing the claim. NOT an installing error - that means an install was
    // attempted and failed, it is counted and acted on as such, and a node
    // standing aside has attempted nothing. Counting these would make the apps
    // most in demand, whose races have the most losers, look the most broken.
    //
    // A node that does not know version 2 rejects the message whole, so it
    // neither acts on it nor refreshes the claim's clock: the claim expires on
    // its own, exactly as it did before any of this existed.
    // Standing aside costs no eligibility. A node that reconsiders this app while
    // the winner is still installing is turned away by the guards above - they
    // count claims as well as running instances - so it never re-claims and
    // nothing loops. And when the app IS short again because a holder died, a
    // node that once lost the race is exactly the one that should take it.
    const withdrawInstallingClaim = async (reason) => {
      log.info(`trySpawningGlobalApplication - withdrawing installing claim for ${appToRun}: ${reason}`);
      try {
        const withdrawal = {
          type: 'fluxappinstalling',
          version: 2,
          name: appSpecifications.name,
          ip: localSocketAddr,
          broadcastedAt: Date.now(),
          withdrawn: true,
        };
        await messageStore.storeAppInstallingMessage(withdrawal);
        // eslint-disable-next-line global-require
        const fluxCommMessagesSenderLib = require('../fluxCommunicationMessagesSender');
        await fluxCommMessagesSenderLib.broadcastMessageToAll(withdrawal);
      } catch (error) {
        // best effort - the installing TTL remains the backstop
        log.warn(`trySpawningGlobalApplication - could not retract installing claim for ${appToRun}: ${error.message}`);
      }
    };

    // an application was selected and checked that it can run on this node. try to install and run it locally
    // lets broadcast to the network the app is going to be installed on this node, so we don't get lot's of intances installed when it's not needed
    let broadcastedAt = Date.now();
    const newAppInstallingMessage = {
      type: 'fluxappinstalling',
      version: 1,
      name: appSpecifications.name,
      ip: localSocketAddr,
      broadcastedAt,
    };

    // store it in local database first
    await registryManager.storeAppInstallingMessage(newAppInstallingMessage);
    // broadcast messages about running apps to all peers
    // eslint-disable-next-line global-require
    const fluxCommMessagesSender = require('../fluxCommunicationMessagesSender');
    await fluxCommMessagesSender.broadcastMessageToAll(newAppInstallingMessage);

    await serviceHelper.delay(collisionWaitMs); // give it 1.5m so messages are propagated on the network

    // double check if app is installed in more of the instances requested
    runningAppList = await registryManager.appLocation(appToRun);
    installingAppList = await registryManager.appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
      installingAppList.sort(compareInstallingClaims);
      log.info(`trySpawningGlobalApplication - Application ${appToRun} contended: ${runningAppList.length} running, claims after wait: ${describeRanking(installingAppList, 'broadcastedAt')}`);
      broadcastedAt = Date.now();
      const index = installingAppList.findIndex((x) => socketAddressesMatch(x.ip, localSocketAddr));
      if (runningAppList.length + index + 1 > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances, my instance is number ${runningAppList.length + index + 1}`);
        await withdrawInstallingClaim('instance count filled by earlier claimants');
        globalState.trySpawningGlobalAppCache.delete(appHash);
        return shortDelayTime;
      }
    }

    if (syncthingApp && !ownerNamedThisNode && placementShare) {
      // Re-check the domain share against the propagated lists, keyed by the
      // same computation that produced the share - a fresher view of the
      // network would move nodes between domains the share was never computed
      // for. Running instances consume the share outright; among simultaneous
      // installing claimants the earliest broadcasts win the remainder - the
      // generalisation of the old oldest-wins resolver to shares above one.
      const runningInMine = await placementFeasibility.countHeldInDomain(runningAppList, myDomain, placementDomainOf);
      const remainingShare = placementShare.maxPerDomain - runningInMine;
      if (remainingShare <= 0) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and fault domain ${myDomain} already runs ${runningInMine} of its ${placementShare.maxPerDomain}-instance share`);
        await withdrawInstallingClaim('domain share held by running instances');
        globalState.trySpawningGlobalAppCache.delete(appHash);
        return shortDelayTime;
      }
      const claimantsInMine = installingAppList
        .filter((location) => placementDomainOf(location.ip) === myDomain)
        .sort(compareInstallingClaims);
      const myIndex = claimantsInMine.findIndex((location) => socketAddressesMatch(location.ip, localSocketAddr));
      const claimantsAhead = myIndex === -1 ? claimantsInMine.length : myIndex;
      if (claimantsAhead >= remainingShare) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and ${claimantsAhead} earlier claimants in fault domain ${myDomain} fill its remaining share of ${remainingShare} (claims: ${describeRanking(claimantsInMine, 'broadcastedAt')})`);
        await withdrawInstallingClaim('domain share filled by earlier claimants');
        globalState.trySpawningGlobalAppCache.delete(appHash);
        return shortDelayTime;
      }
      if (claimantsInMine.length > 1) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing, this node is claim ${claimantsAhead + 1} of ${remainingShare} remaining in fault domain ${myDomain}, continuing (claims: ${describeRanking(claimantsInMine, 'broadcastedAt')})`);
      }
    }

    // install the app
    let registerOk = false;
    // The installer signals failure two ways - a false return and a throw - and
    // only the reason it throws with says WHICH check refused. A port already
    // held by another app is raised that way, and reporting the failure without
    // it leaves a suite unable to tell a refusal from an app that was simply
    // never selected.
    let installError = null;
    try {
      registerOk = await appInstaller.registerAppLocally(appSpecifications, null, null, false); // can throw
    } catch (error) {
      log.error(error);
      installError = error.message ?? String(error);
      registerOk = false;
    }
    if (!registerOk) {
      log.info(`trySpawningGlobalApplication - Install failed for ${appToRun}, adding to local error cache`);
      globalState.spawnErrorsLongerAppCache.set(appHash, '');
      fluxEventBus.publish('spawner:installFailed', { appName: appToRun, hash: appHash, error: installError });
      return shortDelayTime;
    }

    await serviceHelper.delay(1 * 60 * 1000); // await 1 minute to give time for messages to be propagated on the network
    // double check if app is installed in more of the instances requested
    runningAppList = await registryManager.appLocation(appToRun);
    if (runningAppList.length > minInstances) {
      runningAppList.sort(compareInstanceSeniority);
      const index = runningAppList.findIndex((x) => socketAddressesMatch(x.ip, localSocketAddr));
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned on ${runningAppList.length} instances, my instance is number ${index + 1} (instances: ${describeRanking(runningAppList, 'runningSince')})`);
      if (index + 1 > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is going to be removed as already passed the instances required.`);
        log.warn(`REMOVAL REASON: Exceeded required instances - ${appSpecifications.name} already has sufficient instances, removing local installation (appSpawner)`);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        // Call appUninstaller.removeAppLocally directly (initialized via initialize())
        // This needs getGlobalState and stopAppMonitoring callbacks which we don't have here
        // Since we're removing an app that shouldn't be running, we use basic parameters
        appUninstaller.removeAppLocally(appSpecifications.name, null, true, null, true).catch((error) => log.error(error));
      }
    }

    log.info('trySpawningGlobalApplication - Reinitiating possible app installation');
    return isEnterprise ? 0 : delayTime;
  } catch (error) {
    log.error(error);
    if (appHash && !globalState.spawnErrorsLongerAppCache.has(appHash) && !globalState.trySpawningGlobalAppCache.has(appHash)) {
      log.info(`trySpawningGlobalApplication - Adding app hash ${appHash} to trySpawningGlobalAppCache due to pre-install error`);
      globalState.trySpawningGlobalAppCache.set(appHash, '', { ttl: FluxCacheManager.oneHour * 6 });
    }
    return shortDelayTime || 5 * 60 * 1000;
  }
}

module.exports = {
  initialize,
  trySpawningGlobalApplication,
};
