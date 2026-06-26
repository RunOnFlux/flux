// App Spawner - Handles automatic spawning of global applications
const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const benchmarkService = require('../benchmarkService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const geolocationService = require('../geolocationService');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const log = require('../../lib/log');
const { normalizeSocketAddress, extractIp, extractPort, socketAddressesMatch } = require('../utils/socketAddressUtils');

// Import modular services
const appQueryService = require('../appQuery/appQueryService');
const registryManager = require('../appDatabase/registryManager');
const imageManager = require('../appSecurity/imageManager');
const hwRequirements = require('../appRequirements/hwRequirements');
const portManager = require('../appNetwork/portManager');
const appUtilities = require('../utils/appUtilities');
const mountParser = require('../utils/mountParser');
const systemIntegration = require('../appSystem/systemIntegration');
const globalState = require('../utils/globalState');
const enterpriseNetwork = require('../utils/enterpriseNetwork');
const { FluxCacheManager } = require('../utils/cacheManager');
const appInstaller = require('./appInstaller');
const appUninstaller = require('./appUninstaller');
const InstallResult = require('./installResult');
const appNetworkLinker = require('./appNetworkLinker');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('../utils/appSyncEvents');
const fluxEventBus = require('../utils/fluxEventBus');

let appsCountAvailableToInstallOnMyNode = 0;

const collisionWaitMs = config.fluxapps.installCollisionWaitMs;
const spawnReconfirmDelayMs = config.fluxapps.spawnReconfirmDelayMs;
const nonEnterpriseSpawnDelayMs = config.fluxapps.nonEnterpriseSpawnDelayMs ?? 2 * 60 * 1000;

let spawnLoopRunning = false;

// Last node socket address resolved by a spawn cycle. Cached at module scope
// so notifySpecStored - which runs outside a spawn cycle, from the spec-store
// path - can do the pinned-to-this-node check without re-querying benchmark.
let lastKnownLocalSocketAddr = null;

// One-shot resolver for the inter-cycle idle delay. Set only while the loop is
// parked in that delay; calling it ends the delay early. Null at every other
// time, so a wake outside the idle window is a harmless no-op.
let idleWakeResolve = null;
// One-bit latch for a wake that arrives while the loop is mid-cycle (idleWakeResolve
// null): wakeIdleLoop sets it instead of dropping the signal, and spawnLoop checks +
// clears it before the next idle delay so the wake is honored on the next park rather
// than lost. Without it a sibling pinned-enterprise spec stored mid-cycle could wait out
// a ~30s park if the cycle deferred. Single-threaded event loop, so no race.
let wakePending = false;

/**
 * A node-pinned app whose pin set is no larger than its required instance count has
 * no installation contention: every pinned node is a mandatory installer, so the
 * collision-avoidance election (and the two propagation waits that feed it - the
 * pre-install collision wait and the post-install over-instance self-evict) has
 * nothing to resolve. Owner- and flag-agnostic; provably safe because no overshoot
 * is possible when eligible installers do not exceed required instances.
 * @param {object} appSpecifications - full app spec (carries the `nodes` pin list)
 * @param {number} minInstances - required instance count for the app
 * @returns {boolean}
 */
function isSoleRequiredInstaller(appSpecifications, minInstances) {
  const pinnedNodes = appSpecifications && appSpecifications.nodes;
  return Array.isArray(pinnedNodes)
    && pinnedNodes.length > 0
    && pinnedNodes.length <= minInstances;
}

/**
 * A node-pinned app whose pin set is LARGER than its required instance count has genuine multi-node
 * install contention: more nodes are eligible installers than instances are needed, so a collision-
 * avoidance election must pick the winner(s). Unlike a non-pinned app (open contention), the
 * eligible set is a known, bounded list - which lets such an app run its collision window OFF the
 * serial spawn loop (deferred) instead of via an inline wait that head-of-line-blocks every app
 * queued behind it.
 * @param {object} appSpecifications - full app spec (carries the `nodes` pin list)
 * @param {number} minInstances - required instance count for the app
 * @returns {boolean}
 */
function isPinnedContended(appSpecifications, minInstances) {
  const pinnedNodes = appSpecifications && appSpecifications.nodes;
  return Array.isArray(pinnedNodes)
    && pinnedNodes.length > 0
    && pinnedNodes.length > minInstances;
}

/**
 * Over-instance self-evict check: if more than the required instances are running and this node is
 * the surplus one (newest by runningSince), remove the local instance. Used both inline (sole
 * installer - no propagation wait needed) and detached after a wait (contended app).
 */
async function overInstanceSelfEvictCheck(appSpecifications, appToRun, appHash, minInstances, localSocketAddr) {
  const runningAppList = await registryManager.appLocation(appToRun);
  if (runningAppList.length > minInstances) {
    runningAppList.sort((a, b) => {
      if (!a.runningSince && b.runningSince) {
        return -1;
      }
      if (a.runningSince && !b.runningSince) {
        return 1;
      }
      if (a.runningSince < b.runningSince) {
        return -1;
      }
      if (a.runningSince > b.runningSince) {
        return 1;
      }
      return 0;
    });
    const index = runningAppList.findIndex((x) => socketAddressesMatch(x.ip, localSocketAddr));
    log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned on ${runningAppList.length} instances, my instance is number ${index + 1}`);
    if (index + 1 > minInstances) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is going to be removed as already passed the instances required.`);
      log.warn(`REMOVAL REASON: Exceeded required instances - ${appSpecifications.name} already has sufficient instances, removing local installation (appSpawner)`);
      globalState.trySpawningGlobalAppCache.delete(appHash);
      appUninstaller.removeAppLocally(appSpecifications.name, null, true, null, true).catch((error) => log.error(error));
    }
  }
}

/**
 * Detached wrapper for the over-instance self-evict of a contended (non-sole-installer) app. Run
 * fire-and-forget after the install so the post-install propagation wait never blocks the serial
 * spawn loop (an inline 60s sleep would head-of-line-block every queued app). Errors are logged.
 */
async function scheduleOverInstanceSelfEvict(appSpecifications, appToRun, appHash, minInstances, localSocketAddr) {
  try {
    await serviceHelper.delay(1 * 60 * 1000); // give peers' running-broadcasts time to propagate
    await overInstanceSelfEvictCheck(appSpecifications, appToRun, appHash, minInstances, localSocketAddr);
  } catch (error) {
    log.error(error);
  }
}

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
  // Start each loop incarnation with a clean latch: a wake can latch wakePending while the
  // loop is paused (notifySpecStored self-gates on spawnerPaused, but an already-set bit can
  // carry over), and honoring it after a SPAWNER_READY restart would skip the first cycle's
  // delay for no reason. Resetting here keeps the latch strictly intra-run.
  wakePending = false;
  try {
    while (!globalState.spawnerPaused) {
      const delayMs = await trySpawningGlobalApplication();
      // A wake that fired while we were mid-cycle (idleWakeResolve null) latched
      // wakePending instead of being dropped; honor it now by skipping this idle
      // delay so a sibling pinned-enterprise spec stored during the cycle is picked
      // up immediately instead of waiting out the park. Checked + cleared in exactly
      // this one place.
      if (wakePending) {
        wakePending = false;
        // eslint-disable-next-line no-continue
        continue;
      }
      // Race the inter-cycle delay against a one-shot wake so an app spec this
      // node must install, landing mid-delay, is picked up now instead of on
      // the next poll tick. serviceHelper.delay still runs every idle iteration;
      // the wake stays pending (inert) unless notifySpecStored fires.
      if (delayMs > 0) {
        const wake = new Promise((resolve) => { idleWakeResolve = resolve; });
        try {
          await Promise.race([serviceHelper.delay(delayMs), wake]);
        } finally {
          idleWakeResolve = null;
        }
      }
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
    lastKnownLocalSocketAddr = localSocketAddr;

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
    const blocksLasting = config.fluxapps.blocksLasting;
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
          description: { $ifNull: ['$description', ''] },
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
    // True when a contended app is pulled back off appsToBeCheckedLater after its collision window
    // elapsed off-loop: it already broadcast its installing message on the first pass, so it skips
    // the broadcast + collision wait and goes straight to the over-instance election + install.
    let collisionWindowElapsed = false;
    const { appsToBeCheckedLater, appsSyncthingToBeCheckedLater } = globalState;
    const appIndex = appsToBeCheckedLater.findIndex((app) => app.timeToCheck <= Date.now());
    const appSyncthingIndex = appsSyncthingToBeCheckedLater.findIndex((app) => app.timeToCheck <= Date.now());
    let runningAppList = [];
    let installingAppList = [];

    if (appIndex >= 0) {
      appToRun = appsToBeCheckedLater[appIndex].appName;
      appHash = appsToBeCheckedLater[appIndex].hash;
      minInstances = appsToBeCheckedLater[appIndex].required;
      collisionWindowElapsed = appsToBeCheckedLater[appIndex].collisionDeferred === true;
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

      // filter apps that failed to install before
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => !runningApps.data.find((appsRunning) => appsRunning.Names[0].slice(5) === app.name)
        && !globalState.spawnErrorsLongerAppCache.has(app.hash)
        && !globalState.trySpawningGlobalAppCache.has(app.hash)
        && !appsToBeCheckedLater.some((appAux) => appAux.appName === app.name));
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
      // filter apps that dont have geolocation or that are forbidden to spawn on my node geolocation
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('a!c')).length === 0 || !app.geolocation.find((loc) => loc.startsWith('a!c') && `a!c${myNodeLocation}`.startsWith(loc.replace('_NONE', '')))));
      // filter apps that dont have geolocation or have and match my node geolocation
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('ac')).length === 0 || app.geolocation.find((loc) => loc.startsWith('ac') && `ac${myNodeLocation}`.startsWith(loc))));
      globalAppNamesLocation = enterpriseNetwork.filterAppsByOwnership(globalAppNamesLocation, isEnterprise);

      // Suppress dependencyOnly apps (stats collectors) that no workload assigned
      // to this node requires - they only install while an app networkWith-links
      // to them, and must not be respawned after a teardown. Best-effort: on a
      // registry-read failure, fall back to not suppressing rather than aborting.
      // Gated off in production: flux console owns the dependency lifecycle.
      if (config.fluxapps.manageDependencyOnlyLifecycle) {
        try {
          const requiredDependencyNames = await appNetworkLinker.getRequiredDependencyNamesForNode(localSocketAddr);
          globalAppNamesLocation = globalAppNamesLocation.filter((app) => !appNetworkLinker.parseDependencyOnly(app.description) || requiredDependencyNames.has(app.name));
        } catch (error) {
          log.error(`trySpawningGlobalApplication - could not compute required dependencies, not suppressing collectors this cycle: ${error.message}`);
        }
      }

      // Readiness-ordered selection: drop candidates whose networkWith dependencies
      // are not ready, so a linked group installs root-first (a dependency before
      // its consumers) instead of a consumer being selected ahead of its dependency
      // and then starving the loop from the deferred-retry queue. A not-ready app is
      // simply skipped this cycle and reconsidered once its deps come up - no
      // priority deferral, so it can never monopolise the loop, and no error cache,
      // so it installs the instant its dependency appears (e.g. a dependency that is
      // registered later). This skip is intentionally ungated: it is general spawner
      // robustness, not part of the node-managed lifecycle. Only the strictness of
      // "ready" is flag-gated, inside checkAppNetworkRequirements - lifecycle off:
      // the dependency must be installed locally; on: also actually running.
      if (globalAppNamesLocation.length > 0) {
        const readiness = await Promise.all(globalAppNamesLocation.map(async (app) => {
          try {
            await appNetworkLinker.checkAppNetworkRequirements({ name: app.name, description: app.description, owner: app.owner });
            return true;
          } catch (error) {
            // Dependency not ready yet -> skip this cycle. Any other error (e.g.
            // owner mismatch) is a real misconfig handled at install.
            return error.code !== 'NETWORK_DEPENDENCY_NOT_READY';
          }
        }));
        globalAppNamesLocation = globalAppNamesLocation.filter((_, i) => readiness[i]);
      }

      appsCountAvailableToInstallOnMyNode = globalAppNamesLocation.length + appsSyncthingToBeCheckedLater.length + appsToBeCheckedLater.length;
      ({ shortDelayTime, delayTime } = enterpriseNetwork.getSpawnDelays(isEnterprise, appsCountAvailableToInstallOnMyNode));

      if (globalAppNamesLocation.length === 0) {
        log.info('trySpawningGlobalApplication - No app currently to be processed');
        return delayTime;
      }
      log.info(`trySpawningGlobalApplication - Found ${globalAppNamesLocation.length} apps that are missing instances on the network and can be selected to try to spawn on my node.`);
      let random = Math.floor(Math.random() * globalAppNamesLocation.length);
      appToRunAux = globalAppNamesLocation[random];
      const filterAppsWithNyNodeIP = globalAppNamesLocation.filter((app) => app.nodes.find((ip) => socketAddressesMatch(ip, localSocketAddr)));
      if (filterAppsWithNyNodeIP.length > 0) {
        random = Math.floor(Math.random() * filterAppsWithNyNodeIP.length);
        appToRunAux = filterAppsWithNyNodeIP[random];
      }

      appToRun = appToRunAux.name;
      appHash = appToRunAux.hash;
      minInstances = appToRunAux.required;

      log.info(`trySpawningGlobalApplication - Application ${appToRun} selected to try to spawn. Reported as been running in ${appToRunAux.actual} instances and ${appToRunAux.required} are required.`);
      runningAppList = await registryManager.appLocation(appToRun);
      installingAppList = await registryManager.appInstallingLocation(appToRun);
      if (runningAppList.length + installingAppList.length > minInstances) {
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

    const adjustedIP = extractIp(localSocketAddr); // just IP address
    // check if app not running on this device
    if (runningAppList.find((document) => document.ip.includes(adjustedIP))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already running on this Flux IP`);
      return delayTime;
    }
    if (installingAppList.find((document) => document.ip.includes(adjustedIP))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already being installed on this Flux IP`);
      return delayTime;
    }

    // get app specifications
    const appSpecifications = await registryManager.getApplicationGlobalSpecifications(appToRun);
    if (!appSpecifications) {
      throw new Error(`trySpawningGlobalApplication - Specifications for application ${appToRun} were not found!`);
    }

    // A dependencyOnly app (stats collector) installs only while a workload
    // assigned to this node networkWith-links to it. Re-check here so the deferred
    // selection path is covered too, and clear the spawn throttle set above so it
    // is reconsidered promptly once a workload that needs it arrives. Best-effort:
    // a registry-read failure falls back to allowing the spawn.
    if (config.fluxapps.manageDependencyOnlyLifecycle && appNetworkLinker.parseDependencyOnly(appSpecifications.description)) {
      let requiredDeps = null;
      try {
        requiredDeps = await appNetworkLinker.getRequiredDependencyNamesForNode(localSocketAddr);
      } catch (error) {
        log.error(`trySpawningGlobalApplication - could not check dependency requirement for ${appSpecifications.name}: ${error.message}`);
      }
      if (requiredDeps && !requiredDeps.has(appSpecifications.name)) {
        log.info(`trySpawningGlobalApplication - ${appSpecifications.name} is dependency-only and nothing on this node requires it; skipping spawn`);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        return shortDelayTime;
      }
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

    // verify requirements
    await hwRequirements.checkAppRequirements(appSpecifications);
    // enterprise network nodes: reserve >4 vCores of burst headroom (automatic CPU burst)
    if (isEnterprise) {
      await hwRequirements.checkAppCpuBurstHeadroom(appSpecifications);
    }

    // ensure ports unused
    // Get apps running specifically on this IP
    const localSocketAddrAddress = extractIp(localSocketAddr); // just IP address without port
    const runningAppsOnThisIP = await registryManager.getRunningAppIpList(localSocketAddrAddress);
    const runningAppsNames = runningAppsOnThisIP.map((app) => app.name);

    await portManager.ensureApplicationPortsNotUsed(appSpecifications, runningAppsNames);

    // Note: User-blocked port check happens earlier (line ~353) before Docker Hub calls
    // Check if ports are publicly available - critical for proper Flux network operation
    const portsPubliclyAvailable = await portManager.checkInstallingAppPortAvailable(appPorts);
    if (portsPubliclyAvailable === false) {
      log.error(`trySpawningGlobalApplication - Some of application ports of ${appSpecifications.name} are not available publicly. Installation aborted.`);
      return shortDelayTime;
    }

    // double check if app is installed on the number of instances requested
    runningAppList = await registryManager.appLocation(appToRun);
    installingAppList = await registryManager.appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
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

    const localIp = extractIp(localSocketAddr);
    const lastIndex = localIp.lastIndexOf('.');
    const secondLastIndex = localIp.substring(0, lastIndex).lastIndexOf('.');
    const ipPrefix = localIp.substring(0, secondLastIndex + 1); // includes the '.' e.g. "192.168."

    if (syncthingApp) {
      let sameIpRangeNode = runningAppList.find((location) => location.ip.startsWith(ipPrefix));
      if (sameIpRangeNode) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already spawned on Fluxnode with same ip range`);
        return shortDelayTime;
      }
      sameIpRangeNode = installingAppList.find((location) => location.ip.startsWith(ipPrefix));
      if (sameIpRangeNode) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already being installed on Fluxnode with same ip range`);
        return shortDelayTime;
      }
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
      // check image is whitelisted and repotag is available for download
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
    if (runningAppList.length + installingAppList.length > minInstances) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
      return shortDelayTime;
    }

    // an application was selected and checked that it can run on this node. try to install and run it locally
    // A pinned app with no install contention (pins <= required) skips the propagation waits below
    // (see isSoleRequiredInstaller). A pinned app with MORE pins than required has genuine multi-node
    // contention (isPinnedContended) and runs the collision election OFF the loop. A non-pinned app
    // keeps the legacy inline election.
    const soleRequiredInstaller = isSoleRequiredInstaller(appSpecifications, minInstances);
    const pinnedContended = isPinnedContended(appSpecifications, minInstances);
    // lets broadcast to the network the app is going to be installed on this node, so we don't get lot's of intances installed when it's not needed
    let broadcastedAt = Date.now();
    const newAppInstallingMessage = {
      type: 'fluxappinstalling',
      version: 1,
      name: appSpecifications.name,
      ip: localSocketAddr,
      broadcastedAt,
    };

    // Store it in the local DB first (the spawner's own over-instance check below reads
    // this), then tell peers. The local store stays AWAITED; the broadcast is the part we
    // can offload on the contention-free path.
    if (soleRequiredInstaller) {
      // Contention-free pinned install: the collision/over-instance waits below are skipped
      // for this path, and nothing local depends on peers having seen the installing message
      // before we proceed. Fire-and-forget the ~500ms relay so the install starts sooner.
      // Safe against reordering: the PEER-side consumer (messageStore.storeAppInstallingMessage,
      // reached via fluxCommunication on receipt - distinct from the local registryManager store
      // on the line above) applies a fluxappinstalling only if its broadcastedAt is strictly
      // newer, so a late/duplicate can never clobber a newer state - like the appremoved broadcast.
      await registryManager.storeAppInstallingMessage(newAppInstallingMessage);
      fluxCommunicationMessagesSender.broadcastMessageToAll(newAppInstallingMessage)
        .catch((e) => log.error(`installing broadcast for ${appToRun} failed: ${e.message}`));
    } else if (pinnedContended && !collisionWindowElapsed) {
      // Genuine multi-node contention on a pinned app (more pins than required instances): the
      // collision election needs peers' installing-broadcasts to propagate. Store + broadcast our
      // intent, then DEFER the propagation window onto appsToBeCheckedLater instead of sleeping on
      // it inline - an inline delay here freezes the single-threaded spawn loop for the whole window
      // and head-of-line-blocks every contention-free app queued behind it (e.g. sole-installer apps
      // pinned only to this node, which have nothing to wait for). It comes back off the queue once
      // the window has elapsed and proceeds straight to the over-instance election + install below.
      // The installing message persists in the local registry for installingTtlS (900s, >> the 90s
      // window), so it is NOT re-stored on the way back, and must not be re-broadcast (which would
      // reset broadcastedAt and skew the election ordering).
      await registryManager.storeAppInstallingMessage(newAppInstallingMessage);
      await fluxCommunicationMessagesSender.broadcastMessageToAll(newAppInstallingMessage);
      appsToBeCheckedLater.push({
        appName: appToRun,
        hash: appHash,
        required: minInstances,
        timeToCheck: Date.now() + collisionWaitMs,
        collisionDeferred: true,
      });
      log.info(`trySpawningGlobalApplication - ${appToRun} has multi-node install contention; deferring its ${collisionWaitMs}ms collision window off the spawn loop so contention-free apps queued behind it are not blocked`);
      return shortDelayTime;
    } else if (!collisionWindowElapsed) {
      // Non-pinned app (open contention - any node may install): keep the legacy inline election.
      // This node population has always paid this wait inline; deferring it too is a broader change
      // intentionally left out of scope here.
      await registryManager.storeAppInstallingMessage(newAppInstallingMessage);
      await fluxCommunicationMessagesSender.broadcastMessageToAll(newAppInstallingMessage);
      await serviceHelper.delay(collisionWaitMs); // give it 1.5m so messages are propagated on the network
    }
    // A pinned-contended app back from the deferred queue (collisionWindowElapsed) already stored +
    // broadcast its installing message on the first pass, so it falls straight through to the
    // over-instance election check below.

    // double check if app is installed in more of the instances requested
    runningAppList = await registryManager.appLocation(appToRun);
    installingAppList = await registryManager.appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
      installingAppList.sort((a, b) => {
        if (a.broadcastedAt < b.broadcastedAt) {
          return -1;
        }
        if (a.broadcastedAt > b.broadcastedAt) {
          return 1;
        }
        return 0;
      });
      broadcastedAt = Date.now();
      const index = installingAppList.findIndex((x) => socketAddressesMatch(x.ip, localSocketAddr));
      if (runningAppList.length + index + 1 > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances, my instance is number ${runningAppList.length + index + 1}`);
        return shortDelayTime;
      }
    }

    if (syncthingApp) {
      const sameIpRangeNode = runningAppList.find((location) => location.ip.startsWith(ipPrefix));
      if (sameIpRangeNode) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already spawned on Fluxnode with same ip range`);
        return shortDelayTime;
      }
      const sameIpRangeInstallingNodes = installingAppList.filter((location) => location.ip.startsWith(ipPrefix));
      if (sameIpRangeInstallingNodes.length > 0) {
        // Find the node with the oldest broadcastedAt (first to start installing)
        const oldestNode = sameIpRangeInstallingNodes.reduce((oldest, current) => {
          if (!oldest.broadcastedAt) return current;
          if (!current.broadcastedAt) return oldest;
          return current.broadcastedAt < oldest.broadcastedAt ? current : oldest;
        });
        // If our node is not the oldest one, skip - let the first node continue
        if (!socketAddressesMatch(oldestNode.ip, localSocketAddr)) {
          log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already being installed on Fluxnode with same ip range`);
          return shortDelayTime;
        }
        // Our node is the oldest - we were first, continue with installation
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing, we are the first node in ip range to start installing, continuing`);
      }
    }

    // install the app
    // Dependency readiness gate: if a networkWith dependency is not ready (not
    // installed yet, or - with the managed lifecycle on - not yet running), this app
    // cannot install this cycle. Skip it and reconsider on the next pass; crucially
    // do NOT push it into appsToBeCheckedLater, which is drained ahead of fresh
    // selection - an app whose dependency never appears would otherwise re-defer
    // every cycle and starve all other apps from being selected. Skipping keeps the
    // loop free and is self-correcting: the app is retried the moment its dependency
    // comes up, with no error cache to expire (so a dependency registered later is
    // picked up immediately). This reaches an app processed from the deferred queue
    // too (which bypasses the selection-time readiness filter): it is spliced out
    // above and, by not being re-pushed here, leaves the queue. Any other failure
    // (e.g. owner mismatch) falls through to registerAppLocally, which re-checks and
    // fails it through the normal path.
    try {
      await appNetworkLinker.checkAppNetworkRequirements(appSpecifications);
    } catch (error) {
      if (error && error.code === 'NETWORK_DEPENDENCY_NOT_READY') {
        log.info(`trySpawningGlobalApplication - ${appToRun} is waiting on a networkWith dependency; skipping this cycle until it comes up`);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        fluxEventBus.publish('spawner:deferred', { appName: appToRun, reason: 'dependency_not_ready', delayMs: 0 });
        return shortDelayTime;
      }
      log.warn(`trySpawningGlobalApplication - dependency precheck for ${appToRun} raised a non-deferrable error: ${error.message}`);
    }

    let registerResult = InstallResult.FAILED;
    try {
      registerResult = await appInstaller.registerAppLocally(appSpecifications, null, null, false); // can throw
    } catch (error) {
      log.error(error);
      registerResult = InstallResult.FAILED;
    }
    if (registerResult === InstallResult.DEFERRED) {
      // Transient: this app (or another) is mid-removal/install, a same-name teardown is
      // still owed, or the node tier is not yet resolved. NOT a failure - re-select on the
      // next cycle/wake once the condition clears. Drop the spawn-throttle entry set
      // unconditionally at selection time above: left in place it filters this hash out of
      // candidate selection for the full 12h TTL, turning a seconds-long blip into a half-day
      // silent outage of a pinned single-instance app. (We likewise never poison the 7-day
      // spawnErrorsLongerAppCache here - a register->cancel->re-register cycle would otherwise
      // strand the app for a week; that cache is only for genuine, cleaned-up failures below.)
      globalState.trySpawningGlobalAppCache.delete(appHash);
      log.info(`trySpawningGlobalApplication - Install of ${appToRun} deferred (transient), will retry`);
      return shortDelayTime;
    }
    if (registerResult !== InstallResult.INSTALLED) {
      // FAILED (a real, cleaned-up failure) - cache the hash so we don't immediately retry a
      // hard failure. (DEFERRED is handled above and never reaches here, so it is never cached.)
      log.info(`trySpawningGlobalApplication - Install failed for ${appToRun}, adding to local error cache`);
      globalState.spawnErrorsLongerAppCache.set(appHash, '');
      fluxEventBus.publish('spawner:installFailed', { appName: appToRun, hash: appHash });
      return shortDelayTime;
    }

    if (pinnedContended) {
      // Multi-node contention: the post-install over-instance self-evict needs peers' running-
      // broadcasts to propagate, but that wait must NOT block the serial spawn loop (an inline 60s
      // sleep head-of-line-blocks every queued app). Run it detached - the app is already installed,
      // so this only trims a surplus local instance if the election overshot.
      scheduleOverInstanceSelfEvict(appSpecifications, appToRun, appHash, minInstances, localSocketAddr);
    } else {
      // Non-pinned apps keep the legacy inline propagation wait before the check; sole-installers
      // can never over-install (pin set <= required) so they need neither the wait nor a real check.
      if (!soleRequiredInstaller) {
        await serviceHelper.delay(1 * 60 * 1000); // give running-broadcasts time to propagate
      }
      await overInstanceSelfEvictCheck(appSpecifications, appToRun, appHash, minInstances, localSocketAddr);
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

/**
 * Wake the spawn loop if it is currently parked in its inter-cycle idle delay.
 * No-op when the loop is mid-cycle (no pending delay) or paused.
 */
function wakeIdleLoop() {
  if (idleWakeResolve) {
    const resolve = idleWakeResolve;
    idleWakeResolve = null;
    resolve();
  } else {
    // Loop is mid-cycle (no pending delay to interrupt) or between iterations: latch
    // the wake so spawnLoop skips its NEXT idle delay instead of dropping the signal.
    wakePending = true;
  }
}

/**
 * React to a freshly-stored global app spec by waking the spawn loop early -
 * but ONLY for the contention-free enterprise case where this node is a
 * mandatory installer, so reacting instantly cannot cause an install race:
 *   1. this is an enterprise node,
 *   2. the app is enterprise-owned,
 *   3. its pin set is no larger than its required instances
 *      (isSoleRequiredInstaller - no overshoot, so no install race), and
 *   4. it is pinned to THIS node.
 * Every other spec is left to the normal poll cadence; public/global apps keep
 * their deliberate collision-avoidance latency untouched. Fully synchronous and
 * best-effort: it only ever ends an idle wait early, never installs directly,
 * and never throws into the caller (the spec-store path).
 * @param {object} spec - full app spec just written to globalAppsInformation
 */
function notifySpecStored(spec) {
  try {
    if (!spec || globalState.spawnerPaused) return;
    // 1. enterprise node only (null = identity not yet resolved -> skip)
    if (enterpriseNetwork.getCachedEnterpriseIdentity() !== true) return;
    // 2. enterprise-owned app only
    if (!enterpriseNetwork.isEnterpriseAppOwner(spec.owner)) return;
    // 3. contention-free: pinned, with pin set <= required instances. The
    //    instances default mirrors the globalAppsInformation aggregation's
    //    `$ifNull: ['$instances', 3]` used to derive required.
    if (!isSoleRequiredInstaller(spec, spec.instances ?? 3)) return;
    // 4. pinned to THIS node. lastKnownLocalSocketAddr is null until the first
    //    spawn cycle resolves this node's address; until then the match yields
    //    false and the spec simply rides the normal poll cadence.
    const { nodes } = spec;
    if (!Array.isArray(nodes) || !nodes.some((ip) => socketAddressesMatch(ip, lastKnownLocalSocketAddr))) return;
    log.info(`notifySpecStored - ${spec.name} is pinned to this node and contention-free; waking spawn loop`);
    wakeIdleLoop();
  } catch (error) {
    log.error(`notifySpecStored - ${error.message}`);
  }
}

module.exports = {
  initialize,
  trySpawningGlobalApplication,
  isSoleRequiredInstaller,
  isPinnedContended,
  notifySpecStored,
};
