// App Spawner - Handles automatic spawning of global applications
const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const benchmarkService = require('../benchmarkService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const log = require('../../lib/log');

// Import modular services
const appQueryService = require('../appQuery/appQueryService');
const registryManager = require('../appDatabase/registryManager');
const imageManager = require('../appSecurity/imageManager');
const hwRequirements = require('../appRequirements/hwRequirements');
const portManager = require('../appNetwork/portManager');
const appUtilities = require('../utils/appUtilities');
const systemIntegration = require('../appSystem/systemIntegration');
const globalState = require('../utils/globalState');
const { FluxCacheManager } = require('../utils/cacheManager');
// const advancedWorkflows = require('./advancedWorkflows'); // Moved to dynamic require to avoid circular dependency

let appInstaller; // Will be initialized to avoid circular dependency
let appUninstaller; // Will be initialized to avoid circular dependency

/**
 * Initialize the module with dependencies
 * @param {object} deps - Dependencies object
 */
function initialize(deps) {
  // eslint-disable-next-line prefer-destructuring
  appInstaller = deps.appInstaller;
  // eslint-disable-next-line prefer-destructuring
  appUninstaller = deps.appUninstaller;
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
  let shortDelayTime = 5 * 60 * 1000; // Default 5 minutes
  let appHash = null; // Declare outside try block to be accessible in catch
  try {
    // how do we continue with this function?
    // we have globalapplication specifics list
    // check if we are synced
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    if (!globalState.checkAndSyncAppHashesWasEverExecuted) {
      log.info('Flux checkAndSyncAppHashesWasEverExecuted not yet executed');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Global applications will not be installed');
      globalState.fluxNodeWasNotConfirmedOnLastCheck = true;
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    if (globalState.firstExecutionAfterItsSynced === true) {
      log.info('Explorer Synced, checking for expired apps');
      await registryManager.expireGlobalApplications();
      globalState.firstExecutionAfterItsSynced = false;
      // Dynamic require to avoid circular dependency
      // eslint-disable-next-line global-require
      const advancedWorkflows = require('./advancedWorkflows');
      await advancedWorkflows.getPeerAppsInstallingErrorMessages();
    }

    if (globalState.fluxNodeWasAlreadyConfirmed && globalState.fluxNodeWasNotConfirmedOnLastCheck) {
      globalState.fluxNodeWasNotConfirmedOnLastCheck = false;
      setTimeout(() => {
        // after 125 minutes of running ok and to make sure we are connected for enough time for receiving all apps running on other nodes
        // 125 minutes should give enough time for node receive currently two times the apprunning messages
        trySpawningGlobalApplication();
      }, 125 * 60 * 1000);
      return;
    }
    globalState.fluxNodeWasAlreadyConfirmed = true;

    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (benchmarkResponse.status === 'error') {
      log.info('FluxBench status Error. Global applications will not be installed');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    if (benchmarkResponse.data.thunder) {
      log.info('Flux Node is a Fractus Storage Node. Global applications will not be installed');
      await serviceHelper.delay(24 * 3600 * 1000); // check again in one day as changing from and to only requires the restart of flux daemon
      trySpawningGlobalApplication();
      return;
    }

    // get my external IP and check that it is longer than 5 in length.
    let myIP = null;
    if (benchmarkResponse.data.ipaddress) {
      log.info(`Gathered IP ${benchmarkResponse.data.ipaddress}`);
      myIP = benchmarkResponse.data.ipaddress.length > 5 ? benchmarkResponse.data.ipaddress : null;
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }

    // get all the applications list names missing instances
    // eslint-disable-next-line global-require
    const { globalAppsInformation } = require('../utils/appConstants');
    const pipeline = [
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
          required: '$instances',
          nodes: { $ifNull: ['$nodes', []] },
          geolocation: { $ifNull: ['$geolocation', []] },
          hash: '$hash',
          version: '$version',
          enterprise: '$enterprise',
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
      await serviceHelper.delay(30 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }
    log.info(`trySpawningGlobalApplication - Found ${numberOfGlobalApps} apps that are missing instances on the network.`);

    // If there are multiple apps to process, use shorter delays
    const delayTime = numberOfGlobalApps > 1 ? 60 * 1000 : 30 * 60 * 1000;
    shortDelayTime = numberOfGlobalApps > 1 ? 60 * 1000 : 5 * 60 * 1000;

    let appToRun = null;
    let appToRunAux = null;
    let minInstances = null;
    let appFromAppsToBeCheckedLater = false;
    let appFromAppsSyncthingToBeCheckedLater = false;
    const { appsToBeCheckedLater, appsSyncthingToBeCheckedLater } = globalState;
    const appIndex = appsToBeCheckedLater.findIndex((app) => app.timeToCheck >= Date.now());
    const appSyncthingIndex = appsSyncthingToBeCheckedLater.findIndex((app) => app.timeToCheck >= Date.now());
    let runningAppList = [];
    let installingAppList = [];

    if (appIndex >= 0) {
      appToRun = appsToBeCheckedLater[appIndex].appName;
      appHash = appsToBeCheckedLater[appIndex].hash;
      minInstances = appsToBeCheckedLater[appIndex].required;
      appsToBeCheckedLater.splice(appIndex, 1);
      appFromAppsToBeCheckedLater = true;
    } else if (appSyncthingIndex >= 0) {
      appToRun = appsSyncthingToBeCheckedLater[appSyncthingIndex].appName;
      appHash = appsSyncthingToBeCheckedLater[appSyncthingIndex].hash;
      minInstances = appsSyncthingToBeCheckedLater[appSyncthingIndex].required;
      appsSyncthingToBeCheckedLater.splice(appSyncthingIndex, 1);
      appFromAppsSyncthingToBeCheckedLater = true;
    } else {
      const myNodeLocation = systemIntegration.nodeFullGeolocation();

      const runningApps = await appQueryService.listRunningApps();
      if (runningApps.status !== 'success') {
        throw new Error('trySpawningGlobalApplication - Unable to check running apps on this Flux');
      }

      // filter apps that failed to install before
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => !runningApps.data.find((appsRunning) => appsRunning.Names[0].slice(5) === app.name)
        && !globalState.spawnErrorsLongerAppCache.has(app.hash)
        && !globalState.trySpawningGlobalAppCache.has(app.hash)
        && !appsToBeCheckedLater.includes((appAux) => appAux.appName === app.name));
      // filter apps that are non enterprise or are marked to install on my node
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => app.nodes.length === 0 || app.nodes.find((ip) => ip === myIP) || app.version >= 8);
      // filter apps that dont have geolocation or that are forbidden to spawn on my node geolocation
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('a!c')).length === 0 || !app.geolocation.find((loc) => loc.startsWith('a!c') && `a!c${myNodeLocation}`.startsWith(loc.replace('_NONE', '')))));
      // filter apps that dont have geolocation or have and match my node geolocation
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('ac')).length === 0 || app.geolocation.find((loc) => loc.startsWith('ac') && `ac${myNodeLocation}`.startsWith(loc))));

      if (globalAppNamesLocation.length === 0) {
        log.info('trySpawningGlobalApplication - No app currently to be processed');
        await serviceHelper.delay(30 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
      log.info(`trySpawningGlobalApplication - Found ${globalAppNamesLocation.length} apps that are missing instances on the network and can be selected to try to spawn on my node.`);
      let random = Math.floor(Math.random() * globalAppNamesLocation.length);
      appToRunAux = globalAppNamesLocation[random];
      const filterAppsWithNyNodeIP = globalAppNamesLocation.filter((app) => app.nodes.find((ip) => ip === myIP));
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
        await serviceHelper.delay(shortDelayTime);
        trySpawningGlobalApplication();
        return;
      }
      const isArcane = Boolean(process.env.FLUXOS_PATH);
      if (appToRunAux.enterprise && !isArcane) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} can only install on ArcaneOS`);
        globalState.spawnErrorsLongerAppCache.set(appHash, '');
        await serviceHelper.delay(shortDelayTime);
        trySpawningGlobalApplication();
        return;
      }
    }

    globalState.trySpawningGlobalAppCache.set(appHash, '');
    log.info(`trySpawningGlobalApplication - App ${appToRun} hash: ${appHash}`);

    /* const installingAppErrorsList = await registryManager.appInstallingErrorsLocation(appToRun);
    if (installingAppErrorsList.find((app) => !app.expireAt && app.hash === appHash)) {
      globalState.spawnErrorsLongerAppCache.set(appHash, '');
      throw new Error(`trySpawningGlobalApplication - App ${appToRun} is marked as having errors on app installing errors locations.`);
    } */

    runningAppList = await registryManager.appLocation(appToRun);

    const adjustedIP = myIP.split(':')[0]; // just IP address
    // check if app not running on this device
    if (runningAppList.find((document) => document.ip.includes(adjustedIP))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already running on this Flux IP`);
      await serviceHelper.delay(delayTime);
      trySpawningGlobalApplication();
      return;
    }
    if (installingAppList.find((document) => document.ip.includes(adjustedIP))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already being installed on this Flux IP`);
      await serviceHelper.delay(delayTime);
      trySpawningGlobalApplication();
      return;
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
      await serviceHelper.delay(shortDelayTime);
      trySpawningGlobalApplication();
      return;
    }

    // EARLY CHECK: Verify app doesn't use user-blocked ports before expensive Docker Hub operations
    const appPorts = appUtilities.getAppPorts(appSpecifications);
    // eslint-disable-next-line no-restricted-syntax
    for (let i = 0; i < appPorts.length; i += 1) {
      const port = appPorts[i];
      const isUserBlocked = fluxNetworkHelper.isPortUserBlocked(port);
      if (isUserBlocked) {
        log.info(`trySpawningGlobalApplication - App ${appSpecifications.name} uses user-blocked port ${port}. Adding to error cache.`);
        globalState.spawnErrorsLongerAppCache.set(appHash, '');
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(shortDelayTime);
        trySpawningGlobalApplication();
        return;
      }
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

    // ensure ports unused
    // Get apps running specifically on this IP
    const myIPAddress = myIP.split(':')[0]; // just IP address without port
    const runningAppsOnThisIP = await registryManager.getRunningAppIpList(myIPAddress);
    const runningAppsNames = runningAppsOnThisIP.map((app) => app.name);

    await portManager.ensureApplicationPortsNotUsed(appSpecifications, runningAppsNames);

    // Note: User-blocked port check happens earlier (line ~353) before Docker Hub calls
    // Check if ports are publicly available - critical for proper Flux network operation
    const portsPubliclyAvailable = await portManager.checkInstallingAppPortAvailable(appPorts);
    if (portsPubliclyAvailable === false) {
      log.error(`trySpawningGlobalApplication - Some of application ports of ${appSpecifications.name} are not available publicly. Installation aborted.`);
      await serviceHelper.delay(shortDelayTime);
      trySpawningGlobalApplication();
      return;
    }

    // double check if app is installed on the number of instances requested
    runningAppList = await registryManager.appLocation(appToRun);
    installingAppList = await registryManager.appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
      await serviceHelper.delay(shortDelayTime);
      trySpawningGlobalApplication();
      return;
    }

    let syncthingApp = false;
    if (appSpecifications.version <= 3) {
      syncthingApp = appSpecifications.containerData.includes('g:') || appSpecifications.containerData.includes('r:') || appSpecifications.containerData.includes('s:');
    } else {
      syncthingApp = appSpecifications.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
    }

    if (syncthingApp) {
      const myIpWithoutPort = myIP.split(':')[0];
      const lastIndex = myIpWithoutPort.lastIndexOf('.');
      const secondLastIndex = myIpWithoutPort.substring(0, lastIndex).lastIndexOf('.');
      let sameIpRangeNode = runningAppList.find((location) => location.ip.includes(myIpWithoutPort.substring(0, secondLastIndex)));
      if (sameIpRangeNode) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already spawned on Fluxnode with same ip range`);
        await serviceHelper.delay(shortDelayTime);
        trySpawningGlobalApplication();
        return;
      }
      sameIpRangeNode = installingAppList.find((location) => location.ip.includes(myIpWithoutPort.substring(0, secondLastIndex)));
      if (sameIpRangeNode) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already being installed on Fluxnode with same ip range`);
        await serviceHelper.delay(shortDelayTime);
        trySpawningGlobalApplication();
        return;
      }
      if (!appFromAppsToBeCheckedLater && !appFromAppsSyncthingToBeCheckedLater && runningAppList.length < 6) {
        // check if there are connectivity to all nodes
        // eslint-disable-next-line no-restricted-syntax
        for (const node of runningAppList) {
          const ip = node.ip.split(':')[0];
          const port = node.ip.split(':')[1] || '16127';
          // eslint-disable-next-line no-await-in-loop
          const isOpen = await fluxNetworkHelper.isPortOpen(ip, port);
          if (!isOpen) {
            log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and instance running on ${ip}:${port} is not reachable, possible conenctivity issue, will be installed in 45m if remaining missing instances`);
            const appToCheck = {
              timeToCheck: Date.now() + 0.45 * 60 * 60 * 1000,
              appName: appToRun,
              hash: appHash,
              required: minInstances,
            };
            globalState.appsSyncthingToBeCheckedLater.push(appToCheck);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(shortDelayTime);
            globalState.trySpawningGlobalAppCache.delete(appHash);
            trySpawningGlobalApplication();
            return;
          }
        }
        // eslint-disable-next-line no-restricted-syntax
        for (const node of installingAppList) {
          const ip = node.ip.split(':')[0];
          const port = node.ip.split(':')[1] || '16127';
          // eslint-disable-next-line no-await-in-loop
          const isOpen = await fluxNetworkHelper.isPortOpen(ip, port);
          if (!isOpen) {
            log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and instance being installed on ${ip}:${port} is not reachable, possible conenctivity issue, will be installed in 45m if remaining missing instances`);
            const appToCheck = {
              timeToCheck: Date.now() + 0.45 * 60 * 60 * 1000,
              appName: appToRun,
              hash: appHash,
              required: minInstances,
            };
            globalState.appsSyncthingToBeCheckedLater.push(appToCheck);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(shortDelayTime);
            globalState.trySpawningGlobalAppCache.delete(appHash);
            trySpawningGlobalApplication();
            return;
          }
        }
      }
    }

    if (!appFromAppsToBeCheckedLater) {
      const tier = await generalService.nodeTier();
      const appHWrequirements = hwRequirements.totalAppHWRequirements(appSpecifications, tier);
      let delay = false;
      const isArcane = Boolean(process.env.FLUXOS_PATH);
      if (!appToRunAux.enterprise && isArcane) {
        const appToCheck = {
          timeToCheck: Date.now() + 0.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs not enterprise, will check in around 1h if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length > 0 && !appToRunAux.nodes.find((ip) => ip === myIP)) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.5 * 60 * 60 * 1000 : Date.now() + 0.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs have target ips, will check in around 0.5h if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.5 * 60 * 60 * 1000 : Date.now() + 1.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around 2h if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 7 && appHWrequirements.ram < 29000 && appHWrequirements.hdd < 370) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.35 * 60 * 60 * 1000 : Date.now() + 1.45 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from nimbus, will check in around 1h30 if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'super' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.2 * 60 * 60 * 1000 : Date.now() + 0.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around 1h if instances are still missing`);
        globalState.appsToBeCheckedLater.push(appToCheck);
        globalState.trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      }
      if (delay) {
        await serviceHelper.delay(shortDelayTime);
        trySpawningGlobalApplication();
        return;
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
      await serviceHelper.delay(shortDelayTime);
      trySpawningGlobalApplication();
      return;
    }

    // an application was selected and checked that it can run on this node. try to install and run it locally
    // lets broadcast to the network the app is going to be installed on this node, so we don't get lot's of intances installed when it's not needed
    let broadcastedAt = Date.now();
    const newAppInstallingMessage = {
      type: 'fluxappinstalling',
      version: 1,
      name: appSpecifications.name,
      ip: myIP,
      broadcastedAt,
    };

    // store it in local database first
    await registryManager.storeAppInstallingMessage(newAppInstallingMessage);
    // broadcast messages about running apps to all peers
    // eslint-disable-next-line global-require
    const fluxCommMessagesSender = require('../fluxCommunicationMessagesSender');
    await fluxCommMessagesSender.broadcastMessageToOutgoing(newAppInstallingMessage);
    await serviceHelper.delay(500);
    await fluxCommMessagesSender.broadcastMessageToIncoming(newAppInstallingMessage);

    await serviceHelper.delay(90 * 1000); // give it 1.5m so messages are propagated on the network

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
      const index = installingAppList.findIndex((x) => x.ip === myIP);
      if (runningAppList.length + index + 1 > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances, my instance is number ${runningAppList.length + index + 1}`);
        await serviceHelper.delay(shortDelayTime);
        trySpawningGlobalApplication();
        return;
      }
    }

    // install the app
    let registerOk = false;
    try {
      registerOk = await appInstaller.registerAppLocally(appSpecifications, null, null, false); // can throw
    } catch (error) {
      log.error(error);
      registerOk = false;
    }
    if (!registerOk) {
      log.info('trySpawningGlobalApplication - Error on registerAppLocally');
      await serviceHelper.delay(shortDelayTime);
      trySpawningGlobalApplication();
      return;
    }

    await serviceHelper.delay(1 * 60 * 1000); // await 1 minute to give time for messages to be propagated on the network
    // double check if app is installed in more of the instances requested
    runningAppList = await registryManager.appLocation(appToRun);
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
      const index = runningAppList.findIndex((x) => x.ip === myIP);
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned on ${runningAppList.length} instances, my instance is number ${index + 1}`);
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

    await serviceHelper.delay(delayTime);
    log.info('trySpawningGlobalApplication - Reinitiating possible app installation');
    trySpawningGlobalApplication();
  } catch (error) {
    log.error(error);
    // Check if hash is assigned and not present in both caches, then add to trySpawningGlobalAppCache
    if (appHash && !globalState.spawnErrorsLongerAppCache.has(appHash) && !globalState.trySpawningGlobalAppCache.has(appHash)) {
      log.info(`trySpawningGlobalApplication - Adding app hash ${appHash} to trySpawningGlobalAppCache due to installation error`);
      globalState.trySpawningGlobalAppCache.set(appHash, '', { ttl: FluxCacheManager.oneHour * 6 });
    }
    await serviceHelper.delay(shortDelayTime || 5 * 60 * 1000);
    trySpawningGlobalApplication();
  }
}

module.exports = {
  initialize,
  trySpawningGlobalApplication,
};
