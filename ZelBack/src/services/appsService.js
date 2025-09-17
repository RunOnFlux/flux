// Complete Modular Apps Service - Main Orchestrator
const os = require('os');
const config = require('config');
const axios = require('axios');
const dbHelper = require('./dbHelper');
const messageHelper = require('./messageHelper');
const dockerService = require('./dockerService');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const generalService = require('./generalService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const daemonServiceBenchmarkRpcs = require('./daemonService/daemonServiceBenchmarkRpcs');
const geolocationService = require('./geolocationService');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const log = require('../lib/log');

// Import all modularized components
const appConstants = require('./utils/appConstants');
const appSpecHelpers = require('./utils/appSpecHelpers');
const appUtilities = require('./utils/appUtilities');
const appValidator = require('./appRequirements/appValidator');
const hwRequirements = require('./appRequirements/hwRequirements');
const appController = require('./appManagement/appController');
const appInspector = require('./appManagement/appInspector');
const appInstaller = require('./appLifecycle/appInstaller');
const appUninstaller = require('./appLifecycle/appUninstaller');
const advancedWorkflows = require('./appLifecycle/advancedWorkflows');
const portManager = require('./appNetwork/portManager');
const messageStore = require('./appMessaging/messageStore');
const messageVerifier = require('./appMessaging/messageVerifier');
const imageManager = require('./appSecurity/imageManager');
const registryManager = require('./appDatabase/registryManager');
const systemIntegration = require('./appSystem/systemIntegration');

// Import shared state and caches that need to remain centralized
const cacheManager = require('./utils/cacheManager').default;

// Global state variables
let removalInProgress = false;
let installationInProgress = false;
let reinstallationOfOldAppsInProgress = false;
let masterSlaveAppsRunning = false;
const backupInProgress = [];
const restoreInProgress = [];

const hashesNumberOfSearchs = new Map();
const mastersRunningGSyncthingApps = new Map();
const timeTostartNewMasterApp = new Map();

// Cache references
const spawnErrorsLongerAppCache = cacheManager.appSpawnErrorCache;
const trySpawningGlobalAppCache = cacheManager.appSpawnCache;
const myShortCache = cacheManager.fluxRatesCache;
const myLongCache = cacheManager.appPriceBlockedRepoCache;
const failedNodesTestPortsCache = cacheManager.testPortsCache;
const receiveOnlySyncthingAppsCache = new Map();
const appsStopedCache = cacheManager.stoppedAppsCache;
const syncthingDevicesIDCache = cacheManager.syncthingDevicesCache;

// Apps monitored structure
const appsMonitored = {};

// DOS protection variables
let dosMountMessage = '';
let dosDuplicateAppMessage = '';
let checkAndNotifyPeersOfRunningAppsFirstRun = true;

/**
 * To get a list of installed apps. Where req can be equal to appname.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function installedApps(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    let appsQuery = {};
    if (req && req.params && req.query) {
      let { appname } = req.params;
      appname = appname || req.query.appname;
      if (appname) {
        appsQuery = { name: appname };
      }
    } else if (req && typeof req === 'string') {
      appsQuery = { name: req };
    }

    const appsProjection = {
      projection: { _id: 0 },
    };

    const apps = await dbHelper.findInDatabase(appsDatabase, appConstants.localAppsInformation, appsQuery, appsProjection);
    const dataResponse = messageHelper.createDataMessage(apps);
    return res ? res.json(dataResponse) : dataResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * To list running apps.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listRunningApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(false);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].slice(1, 4) === 'zel' || app.Names[0].slice(1, 5) === 'flux'));
    }
    const modifiedApps = [];
    apps.forEach((app) => {
      delete app.HostConfig;
      delete app.NetworkSettings;
      delete app.Mounts;
      modifiedApps.push(app);
    });
    const appsResponse = messageHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * List all apps (both running and installed)
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listAllApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(true);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].slice(1, 4) === 'zel' || app.Names[0].slice(1, 5) === 'flux'));
    }
    const modifiedApps = [];
    apps.forEach((app) => {
      // eslint-disable-next-line no-param-reassign
      delete app.HostConfig;
      // eslint-disable-next-line no-param-reassign
      delete app.NetworkSettings;
      // eslint-disable-next-line no-param-reassign
      delete app.Mounts;
      modifiedApps.push(app);
    });
    const appsResponse = messageHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Get application usage statistics
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function fluxUsage(req, res) {
  try {
    const apps = await appInstaller.getInstalledApps();
    const totalApps = apps.length;
    const runningApps = await listRunningApps();
    const totalRunning = runningApps.data ? runningApps.data.length : 0;

    const usage = {
      totalApps,
      runningApps: totalRunning,
      stoppedApps: totalApps - totalRunning,
      nodeSpecs: hwRequirements.returnNodeSpecs(),
    };

    const dataResponse = messageHelper.createDataMessage(usage);
    return res ? res.json(dataResponse) : dataResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Get applications monitoring data
 * @returns {object} Apps monitoring data
 */
function getAppsMonitored() {
  return appsMonitored;
}

/**
 * Get global state for app operations
 * @returns {object} Global state object
 */
function getGlobalState() {
  return {
    removalInProgress,
    installationInProgress,
    reinstallationOfOldAppsInProgress,
    masterSlaveAppsRunning,
    backupInProgress,
    restoreInProgress,
    hashesNumberOfSearchs,
    mastersRunningGSyncthingApps,
    timeTostartNewMasterApp,
  };
}

/**
 * Get apps resource usage
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function appsResources(req, res) {
  log.info('Checking appsResources');
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {};
    const appsProjection = { projection: { _id: 0 } };
    const appsResult = await dbHelper.findInDatabase(appsDatabase, appConstants.localAppsInformation, appsQuery, appsProjection);
    let appsCpusLocked = 0;
    let appsRamLocked = 0;
    let appsHddLocked = 0;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    const hddTier = `hdd${tier}`;
    const ramTier = `ram${tier}`;
    const cpuTier = `cpu${tier}`;
    appsResult.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((component) => {
          if (component.tiered && tier) {
            appsCpusLocked += serviceHelper.ensureNumber(component[cpuTier] || component.cpu) || 0;
            appsRamLocked += serviceHelper.ensureNumber(component[ramTier] || component.ram) || 0;
            appsHddLocked += serviceHelper.ensureNumber(component[hddTier] || component.hdd) || 0;
          } else {
            appsCpusLocked += serviceHelper.ensureNumber(component.cpu) || 0;
            appsRamLocked += serviceHelper.ensureNumber(component.ram) || 0;
            appsHddLocked += serviceHelper.ensureNumber(component.hdd) || 0;
          }
          appsHddLocked += config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // 5gb per component + 2gb swap
        });
      } else if (app.tiered && tier) {
        appsCpusLocked += serviceHelper.ensureNumber(app[cpuTier] || app.cpu) || 0;
        appsRamLocked += serviceHelper.ensureNumber(app[ramTier] || app.ram) || 0;
        appsHddLocked += serviceHelper.ensureNumber(app[hddTier] || app.hdd) || 0;
        appsHddLocked += config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // 5gb per component + 2gb swap
      } else {
        appsCpusLocked += serviceHelper.ensureNumber(app.cpu) || 0;
        appsRamLocked += serviceHelper.ensureNumber(app.ram) || 0;
        appsHddLocked += serviceHelper.ensureNumber(app.hdd) || 0;
        appsHddLocked += config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // 5gb per component + 2gb swap
      }
    });
    const appsUsage = {
      appsCpusLocked,
      appsRamLocked,
      appsHddLocked,
    };
    const response = messageHelper.createDataMessage(appsUsage);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Set applications monitoring data
 * @param {object} appData - App monitoring data
 */
function setAppsMonitored(appData) {
  appsMonitored[appData.appName] = appData;
}

/**
 * Clear applications monitoring data
 */
function clearAppsMonitored() {
  Object.keys(appsMonitored).forEach((key) => {
    delete appsMonitored[key];
  });
}

/**
 * Start monitoring multiple applications
 * @param {Array} appSpecsToMonitor - Array of app specifications to monitor
 * @returns {Promise<object>} Result of monitoring start
 */
async function startMonitoringOfApps(appSpecsToMonitor) {
  try {
    let apps = appSpecsToMonitor;
    if (!apps) {
      const installedAppsRes = await installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      apps = installedAppsRes.data;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        appInspector.startAppMonitoring(app.name, appsMonitored);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          appInspector.startAppMonitoring(monitoredName, appsMonitored);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Check and notify peers of running apps
 */
async function checkAndNotifyPeersOfRunningApps() {
  try {
    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isNodeConfirmed) {
      log.info('checkAndNotifyPeersOfRunningApps - FluxNode is not Confirmed');
      return;
    }

    // get my external IP and check that it is longer than 5 in length.
    const benchmarkResponse = await daemonServiceBenchmarkRpcs.getBenchmarks();
    let myIP = null;
    if (benchmarkResponse.status === 'success') {
      const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
      if (benchmarkResponseData.ipaddress) {
        log.info(`Gathered IP ${benchmarkResponseData.ipaddress}`);
        myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
      }
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }
    // get list of locally installed apps. Store them in database as running and send info to our peers.
    // check if they are running?
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const runningAppsRes = await listRunningApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const runningApps = runningAppsRes.data;
    const installedAppComponentNames = [];
    appsInstalled.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((appComponent) => {
          installedAppComponentNames.push(`${appComponent.name}_${app.name}`);
        });
      } else {
        installedAppComponentNames.push(app.name);
      }
    });
    // kadena and folding is old naming scheme having /zel.  all global application start with /flux
    const runningAppsNames = runningApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });
    // installed always is bigger array than running
    const runningSet = new Set(runningAppsNames);
    const stoppedApps = installedAppComponentNames.filter((installedApp) => !runningSet.has(installedApp));
    const masterSlaveAppsInstalled = [];
    // check if stoppedApp is a global application present in specifics. If so, try to start it.
    if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress) {
      // eslint-disable-next-line no-restricted-syntax
      for (const stoppedApp of stoppedApps) { // will uninstall app if some component is missing
        try {
          // proceed ONLY if it's a global App
          const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
          // eslint-disable-next-line no-await-in-loop
          const appDetails = await getApplicationGlobalSpecifications(mainAppName);
          const appInstalledMasterSlave = appsInstalled.find((app) => app.name === mainAppName);
          const appInstalledSyncthing = appInstalledMasterSlave.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:'));
          const appInstalledMasterSlaveCheck = appInstalledMasterSlave.compose.find((comp) => comp.containerData.includes('g:'));
          if (appInstalledSyncthing) {
            masterSlaveAppsInstalled.push(appInstalledMasterSlave);
          }
          if (appDetails && !appInstalledMasterSlaveCheck) {
            if (appInstalledSyncthing) {
              const db = dbHelper.databaseConnection();
              const database = db.db(config.database.appsglobal.database);
              const queryFind = { name: mainAppName, ip: myIP };
              const projection = { _id: 0, runningSince: 1 };
              // we already have the exact same data
              // eslint-disable-next-line no-await-in-loop
              const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
              if (!result || !result.runningSince || Date.parse(result.runningSince) + 30 * 60 * 1000 > Date.now()) {
                log.info(`Application ${stoppedApp} uses r syncthing and haven't started yet because was installed less than 30m ago.`);
                // eslint-disable-next-line no-continue
                continue;
              }
            }
            log.warn(`${stoppedApp} is stopped but should be running. Starting...`);
            // it is a stopped global app. Try to run it.
            // check if some removal is in progress and if it is don't start it!
            const backupSkip = backupInProgress.some((backupItem) => stoppedApp === backupItem);
            const restoreSkip = restoreInProgress.some((backupItem) => stoppedApp === backupItem);
            if (backupSkip || restoreSkip) {
              log.warn(`Application ${stoppedApp} backup/restore is in progress...`);
            }
            if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress && !restoreSkip && !backupSkip) {
              log.warn(`${stoppedApp} is stopped, starting`);
              if (!appsStopedCache.has(stoppedApp)) {
                appsStopedCache.set(stoppedApp, '');
              } else {
                // eslint-disable-next-line no-await-in-loop
                await dockerService.appDockerStart(stoppedApp);
                appInspector.startAppMonitoring(stoppedApp, appsMonitored);
              }
            } else {
              log.warn(`Not starting ${stoppedApp} as application removal or installation or backup/restore is in progress`);
            }
          }
        } catch (err) {
          log.error(err);
          if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress) {
            const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
            // already checked for mongo ok, daemon ok, docker ok.
            // eslint-disable-next-line no-await-in-loop
            await appUninstaller.removeAppLocally(mainAppName, null, false, true, true, res => {
              // Handle response
            });
          }
        }
      }
    } else {
      log.warn('Stopped application checks not running, some removal or installation is in progress');
    }
    const installedAndRunning = [];
    appsInstalled.forEach((app) => {
      if (app.version >= 4) {
        let appRunningWell = true;
        app.compose.forEach((appComponent) => {
          if (!runningAppsNames.includes(`${appComponent.name}_${app.name}`)) {
            appRunningWell = false;
          }
        });
        if (appRunningWell) {
          installedAndRunning.push(app);
        }
      } else if (runningAppsNames.includes(app.name)) {
        installedAndRunning.push(app);
      }
    });
    installedAndRunning.push(...masterSlaveAppsInstalled);
    const applicationsToBroadcast = [...new Set(installedAndRunning)];
    const apps = [];
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const application of applicationsToBroadcast) {
        const queryFind = { name: application.name, ip: myIP };
        const projection = { _id: 0, runningSince: 1 };
        let runningOnMyNodeSince = new Date().toISOString();
        // we already have the exact same data
        // eslint-disable-next-line no-await-in-loop
        const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
        if (result && result.runningSince) {
          runningOnMyNodeSince = result.runningSince;
        }
        log.info(`${application.name} is running/installed properly. Broadcasting status.`);
        // eslint-disable-next-line no-await-in-loop
        // we can distinguish pure local apps from global with hash and height
        const newAppRunningMessage = {
          type: 'fluxapprunning',
          version: 1,
          name: application.name,
          hash: application.hash, // hash of application specifics that are running
          ip: myIP,
          broadcastedAt: Date.now(),
          runningSince: runningOnMyNodeSince,
          osUptime: os.uptime(),
          staticIp: geolocationService.isStaticIP(),
        };
        const app = {
          name: application.name,
          hash: application.hash,
          runningSince: runningOnMyNodeSince,
        };
        apps.push(app);
        // store it in local database first
        // eslint-disable-next-line no-await-in-loop
        await messageStore.storeAppRunningMessage(newAppRunningMessage);
        if (installedAndRunning.length === 1) {
          // eslint-disable-next-line no-await-in-loop
          await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessage);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessage);
          // broadcast messages about running apps to all peers
          log.info(`App Running Message broadcasted ${JSON.stringify(newAppRunningMessage)}`);
        }
      }
      if (installedAndRunning.length > 1) {
        // send v2 unique message instead
        const newAppRunningMessageV2 = {
          type: 'fluxapprunning',
          version: 2,
          apps,
          ip: myIP,
          broadcastedAt: Date.now(),
          osUptime: os.uptime(),
          staticIp: geolocationService.isStaticIP(),
        };
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessageV2);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessageV2);
        // broadcast messages about running apps to all peers
        log.info(`App Running Message broadcasted ${JSON.stringify(newAppRunningMessageV2)}`);
      } else if (installedAndRunning.length === 0 && checkAndNotifyPeersOfRunningAppsFirstRun) {
        checkAndNotifyPeersOfRunningAppsFirstRun = false;
        // we will broadcast a message that we are not running any app
        // if multitoolbox option to reinstall fluxos or fix mongodb is executed all apps are removed from the node, once the node starts and it's confirmed
        // should broadcast to the network what is running or not
        // the nodes who receive the message will only rebroadcast if they had information about a app running on this node
        const newAppRunningMessageV2 = {
          type: 'fluxapprunning',
          version: 2,
          apps,
          ip: myIP,
          broadcastedAt: Date.now(),
          osUptime: os.uptime(),
          staticIp: geolocationService.isStaticIP(),
        };
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessageV2);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessageV2);
        // broadcast messages about running apps to all peers
        log.info(`No Apps Running Message broadcasted ${JSON.stringify(newAppRunningMessageV2)}`);
      }
    } catch (err) {
      log.error(err);
      // removeAppLocally(stoppedApp);
    }
    log.info('Running Apps broadcasted');
  } catch (error) {
    log.error(error);
  }
}

/**
 * Stop monitoring multiple applications
 * @param {Array} appSpecsToMonitor - Array of app specifications to stop monitoring
 * @param {boolean} deleteData - Whether to delete monitoring data
 * @returns {Promise<object>} Result of monitoring stop
 */
async function stopMonitoringOfApps(appSpecsToMonitor, deleteData = false) {
  try {
    let apps = appSpecsToMonitor;
    if (!apps) {
      const installedAppsRes = await installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      apps = installedAppsRes.data;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        appInspector.stopAppMonitoring(app.name, deleteData, appsMonitored);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          appInspector.stopAppMonitoring(monitoredName, deleteData, appsMonitored);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Start monitoring API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startAppMonitoringAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      // Only flux team and node owner can monitor all apps
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res ? res.json(errMessage) : errMessage;
      }
      await stopMonitoringOfApps();
      await startMonitoringOfApps();
      const monitoringResponse = messageHelper.createSuccessMessage('Application monitoring started for all apps');
      return res ? res.json(monitoringResponse) : monitoringResponse;
    } else {
      const mainAppName = appname.split('_')[1] || appname;
      const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res ? res.json(errMessage) : errMessage;
      }
      const installedAppsRes = await installedApps(mainAppName);
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      const apps = installedAppsRes.data;
      const appSpecs = apps[0];
      if (!appSpecs) {
        throw new Error(`Application ${mainAppName} is not installed`);
      }
      if (mainAppName === appname) {
        await stopMonitoringOfApps();
        await startMonitoringOfApps([appSpecs]);
      } else { // component based or <= 3
        appInspector.stopAppMonitoring(appname, false, appsMonitored);
        appInspector.startAppMonitoring(appname, appsMonitored);
      }
      const monitoringResponse = messageHelper.createSuccessMessage(`Application monitoring started for ${appSpecs.name}`);
      return res ? res.json(monitoringResponse) : monitoringResponse;
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Stop monitoring API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function stopAppMonitoringAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { deletedata } = req.params;
    deletedata = deletedata || req.query.deletedata || false;
    deletedata = serviceHelper.ensureBoolean(deletedata);

    if (!appname) {
      // Only flux team and node owner can stop monitoring for all apps
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res ? res.json(errMessage) : errMessage;
      }
      await stopMonitoringOfApps();
      let successMessage = '';
      if (!deletedata) {
        successMessage = 'Application monitoring stopped for all apps. Existing monitoring data maintained.';
      } else {
        successMessage = 'Application monitoring stopped for all apps. Monitoring data deleted for all apps.';
      }
      const monitoringResponse = messageHelper.createSuccessMessage(successMessage);
      return res ? res.json(monitoringResponse) : monitoringResponse;
    } else {
      const mainAppName = appname.split('_')[1] || appname;
      const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res ? res.json(errMessage) : errMessage;
      }
      let successMessage = '';
      if (mainAppName === appname) {
        // get appSpecs
        const installedAppsRes = await installedApps(mainAppName);
        if (installedAppsRes.status !== 'success') {
          throw new Error('Failed to get installed Apps');
        }
        const apps = installedAppsRes.data;
        const appSpecs = apps[0];
        if (!appSpecs) {
          throw new Error(`Application ${mainAppName} is not installed`);
        }
        await stopMonitoringOfApps([appSpecs], deletedata);
      } else { // component based or <= 3
        appInspector.stopAppMonitoring(appname, deletedata, appsMonitored);
      }
      if (deletedata) {
        successMessage = `Application monitoring stopped and monitoring data deleted for ${appname}.`;
      } else {
        successMessage = `Application monitoring stopped for ${appname}. Existing monitoring data maintained.`;
      }
      const monitoringResponse = messageHelper.createSuccessMessage(successMessage);
      return res ? res.json(monitoringResponse) : monitoringResponse;
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

// Enhanced appMonitor function that uses the inspector module but adds the monitored data
async function appMonitor(req, res) {
  return appInspector.appMonitor(req, res, appsMonitored);
}

// Global constants
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

/**
 * Method responsable to monitor node status ans uninstall apps if node is not confirmed
 */
// eslint-disable-next-line consistent-return
async function monitorNodeStatus() {
  try {
    // Create local reference to removeAppLocally function
    const removeAppLocally = async (app, res, force, endResponse, sendMessage) =>
      appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored));

    let isNodeConfirmed = false;
    if (fluxNetworkHelper.getDosStateValue() >= 100) {
      const installedAppsRes = await installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('monitorNodeStatus - Failed to get installed Apps');
      }
      isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
      const appsInstalled = installedAppsRes.data;
      // eslint-disable-next-line no-restricted-syntax
      for (const installedApp of appsInstalled) {
        log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed from node as the node have DOS state over 100`);
        log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocally(installedApp.name, null, true, false, isNodeConfirmed);
        log.warn(`monitorNodeStatus - Application ${installedApp.name} locally removed`);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(60 * 1000); // wait for 1 min between each removal
      }
      await serviceHelper.delay(10 * 60 * 1000); // 10m delay before next check
      return monitorNodeStatus();
    }
    let error = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => { error = true; });
    if (!isNodeConfirmed && !error) {
      log.info('monitorNodeStatus - Node is not Confirmed');
      const installedAppsRes = await installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('monitorNodeStatus - Failed to get installed Apps');
      }
      const appsInstalled = installedAppsRes.data;
      // eslint-disable-next-line no-restricted-syntax
      for (const installedApp of appsInstalled) {
        log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed from node as the node is not confirmed on the network`);
        log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocally(installedApp.name, null, true, false, false);
        log.warn(`monitorNodeStatus - Application ${installedApp.name} locally removed`);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(60 * 1000); // wait for 1 min between each removal
      }
      await serviceHelper.delay(20 * 60 * 1000); // 20m delay before next check
      return monitorNodeStatus();
    } if (isNodeConfirmed) {
      log.info('monitorNodeStatus - Node is Confirmed');
      // lets remove from locations when nodes are no longer confirmed
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      const variable = 'ip';
      // we already have the exact same data
      const appslocations = await dbHelper.distinctDatabase(database, globalAppsLocations, variable);
      const appsLocationCount = appslocations.length;
      log.info(`monitorNodeStatus - Found ${appsLocationCount} distinct IP's on appslocations`);

      const appsLocationsNotOnNodelist = [];

      const iterChunk = async (chunk) => {
        const promises = chunk.map(async (location) => {
          const found = await fluxCommunicationUtils.socketAddressInFluxList(location);
          if (!found) appsLocationsNotOnNodelist.push(location);
        });
        await Promise.all(promises);
      };

      const chunkSize = 250;
      let startIndex = 0;
      let endIndex = Math.min(chunkSize, appsLocationCount);

      while (startIndex < appsLocationCount) {
        const chunk = appslocations.slice(startIndex, endIndex);
        // eslint-disable-next-line no-await-in-loop
        await iterChunk(chunk);

        startIndex = endIndex;
        endIndex += chunk.length;
      }

      log.info(`monitorNodeStatus - Found ${appsLocationsNotOnNodelist.length} IP(s) not present on deterministic node list`);
      // eslint-disable-next-line no-restricted-syntax
      for (const location of appsLocationsNotOnNodelist) {
        log.info(`monitorNodeStatus - Checking IP ${location}.`);
        const ip = location.split(':')[0];
        const port = location.split(':')[1] || '16127';
        const { CancelToken } = axios;
        const source = CancelToken.source();
        let isResolved = false;
        const timeout = 10 * 1000; // 10 seconds
        setTimeout(() => {
          if (!isResolved) {
            source.cancel('Operation canceled by the user.');
          }
        }, timeout * 2);
        // eslint-disable-next-line no-await-in-loop
        const response = await axios.get(`http://${ip}:${port}/daemon/getfluxnodestatus`, { timeout, cancelToken: source.token }).catch(() => null);
        isResolved = true;
        if (response && response.data && response.data.status === 'success' && response.data.data.status === 'CONFIRMED') {
          log.info(`monitorNodeStatus - IP ${location} is available and confirmed, awaiting for a new confirmation transaction`);
        } else {
          log.info(`monitorNodeStatus - Removing IP ${location} from globalAppsLocations`);
          const query = { ip: location };
          // eslint-disable-next-line no-await-in-loop
          await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, query);
        }
      }
    }
    await serviceHelper.delay(20 * 60 * 1000); // 20m delay before next check
    monitorNodeStatus();
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(2 * 60 * 1000); // 2m delay before next check
    monitorNodeStatus();
  }
}

// Re-export ALL functions from modules for complete backward compatibility
module.exports = {
  // Local orchestrator functions
  installedApps,
  listRunningApps,
  listAllApps,
  fluxUsage,
  appsResources,
  getAppsMonitored,
  setAppsMonitored,
  clearAppsMonitored,
  checkAndNotifyPeersOfRunningApps,
  startMonitoringOfApps,
  stopMonitoringOfApps,
  startAppMonitoringAPI,
  stopAppMonitoringAPI,
  appMonitor, // Enhanced version
  monitorNodeStatus,

  // Re-exported from appSpecHelpers
  getChainParamsPriceUpdates: appSpecHelpers.getChainParamsPriceUpdates,
  getChainTeamSupportAddressUpdates: appSpecHelpers.getChainTeamSupportAddressUpdates,
  appPricePerMonth: appSpecHelpers.appPricePerMonth,
  parseAppSpecification: appSpecHelpers.parseAppSpecification,

  // Re-exported from appValidator
  verifyTypeCorrectnessOfApp: appValidator.verifyTypeCorrectnessOfApp,
  verifyRestrictionCorrectnessOfApp: appValidator.verifyRestrictionCorrectnessOfApp,
  verifyObjectKeysCorrectnessOfApp: appValidator.verifyObjectKeysCorrectnessOfApp,
  checkHWParameters: appValidator.checkHWParameters,
  checkComposeHWParameters: appValidator.checkComposeHWParameters,
  verifyAppSpecifications: appValidator.verifyAppSpecifications,

  // Re-exported from hwRequirements
  getNodeSpecs: hwRequirements.getNodeSpecs,
  setNodeSpecs: hwRequirements.setNodeSpecs,
  returnNodeSpecs: hwRequirements.returnNodeSpecs,
  totalAppHWRequirements: hwRequirements.totalAppHWRequirements,
  checkAppHWRequirements: hwRequirements.checkAppHWRequirements,
  checkAppRequirements: hwRequirements.checkAppRequirements,
  nodeFullGeolocation: hwRequirements.nodeFullGeolocation,
  checkAppStaticIpRequirements: hwRequirements.checkAppStaticIpRequirements,
  checkAppGeolocationRequirements: hwRequirements.checkAppGeolocationRequirements,
  checkAppNodesRequirements: hwRequirements.checkAppNodesRequirements,

  // Re-exported from appController
  executeAppGlobalCommand: appController.executeAppGlobalCommand,
  appStart: appController.appStart,
  appStop: appController.appStop,
  appRestart: appController.appRestart,
  appKill: appController.appKill,
  appPause: appController.appPause,
  appUnpause: appController.appUnpause,
  appDockerRestart: appController.appDockerRestart,
  stopAllNonFluxRunningApps: appController.stopAllNonFluxRunningApps,

  // Re-exported from appInspector
  appTop: appInspector.appTop,
  appLog: appInspector.appLog,
  appLogStream: appInspector.appLogStream,
  appLogPolling: appInspector.appLogPolling,
  appInspect: appInspector.appInspect,
  appStats: appInspector.appStats,
  appMonitor: async (req, res) => appInspector.appMonitor(req, res, appsMonitored),
  appMonitorStream: appInspector.appMonitorStream,
  appExec: appInspector.appExec,
  appChanges: appInspector.appChanges,
  getContainerStorage: appInspector.getContainerStorage,
  startAppMonitoring: (appName) => appInspector.startAppMonitoring(appName, appsMonitored),
  stopAppMonitoring: (appName, deleteData) => appInspector.stopAppMonitoring(appName, deleteData, appsMonitored),
  listAppsImages: appInspector.listAppsImages,
  getAppsDOSState: appInspector.getAppsDOSState,

  // Re-exported from appInstaller
  createAppVolume: appInstaller.createAppVolume,
  registerAppLocally: async (appSpecs, componentSpecs, res, test = false) => {
    // Original implementation with global state checks
    if (removalInProgress) {
      const rStatus = messageHelper.createWarningMessage('Another application is undergoing removal. Installation not possible.');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
    }
    if (installationInProgress) {
      const rStatus = messageHelper.createWarningMessage('Another application is undergoing installation. Installation not possible');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
    }

    // Call the modular implementation
    return appInstaller.registerAppLocally(appSpecs, componentSpecs, res, test);
  },
  installApplicationHard: appInstaller.installApplicationHard,
  installApplicationSoft: appInstaller.installApplicationSoft,
  softRegisterAppLocally: appInstaller.softRegisterAppLocally,
  getInstalledApps: appInstaller.getInstalledApps,
  updateAppStatus: appInstaller.updateAppStatus,
  cleanupFailedInstallation: appInstaller.cleanupFailedInstallation,

  // Re-exported from appUninstaller
  appUninstallHard: async (appName, appId, appSpecs, isComponent, res) =>
    appUninstaller.appUninstallHard(appName, appId, appSpecs, isComponent, res, (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)),
  appUninstallSoft: async (appName, appId, appSpecs, isComponent, res) =>
    appUninstaller.appUninstallSoft(appName, appId, appSpecs, isComponent, res, (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)),
  removeAppLocally: async (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)),
  softRemoveAppLocally: async (app, res) =>
    appUninstaller.softRemoveAppLocally(app, res, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)),
  removeAppLocallyApi: async (req, res) =>
    appUninstaller.removeAppLocallyApi(req, res, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)),
  cleanupAppData: appUninstaller.cleanupAppData,
  removeAppVolumes: appUninstaller.removeAppVolumes,

  // Re-exported from portManager
  appPortsUnique: portManager.appPortsUnique,
  ensureAppUniquePorts: portManager.ensureAppUniquePorts,
  assignedPortsInstalledApps: portManager.assignedPortsInstalledApps,
  assignedPortsGlobalApps: portManager.assignedPortsGlobalApps,
  ensureApplicationPortsNotUsed: portManager.ensureApplicationPortsNotUsed,
  restoreFluxPortsSupport: portManager.restoreFluxPortsSupport,
  restoreAppsPortsSupport: portManager.restoreAppsPortsSupport,
  restorePortsSupport: portManager.restorePortsSupport,
  callOtherNodeToKeepUpnpPortsOpen: async () => portManager.callOtherNodeToKeepUpnpPortsOpen(failedNodesTestPortsCache, installedApps),
  getAllUsedPorts: portManager.getAllUsedPorts,
  isPortAvailable: portManager.isPortAvailable,
  findNextAvailablePort: portManager.findNextAvailablePort,

  // Re-exported from messageStore
  storeAppTemporaryMessage: messageStore.storeAppTemporaryMessage,
  storeAppPermanentMessage: messageStore.storeAppPermanentMessage,
  storeAppRunningMessage: messageStore.storeAppRunningMessage,
  storeAppInstallingMessage: messageStore.storeAppInstallingMessage,
  checkAppMessageExistence: messageStore.checkAppMessageExistence,
  checkAppTemporaryMessageExistence: messageStore.checkAppTemporaryMessageExistence,
  getAppsTemporaryMessages: messageStore.getAppsTemporaryMessages,
  getAppsPermanentMessages: messageStore.getAppsPermanentMessages,
  cleanupOldTemporaryMessages: messageStore.cleanupOldTemporaryMessages,

  // App Utilities
  getChainParamsPriceUpdates: appUtilities.getChainParamsPriceUpdates,
  appPricePerMonth: appUtilities.appPricePerMonth,
  nodeFullGeolocation: appUtilities.nodeFullGeolocation,
  getAppFolderSize: appUtilities.getAppFolderSize,
  getContainerStorage: appUtilities.getContainerStorage,
  getAppPorts: appUtilities.getAppPorts,
  specificationFormatter: appUtilities.specificationFormatter,
  parseAppSpecification: appUtilities.parseAppSpecification,
  validateAppName: appUtilities.validateAppName,
  sanitizeAppInput: appUtilities.sanitizeAppInput,
  generateAppHash: appUtilities.generateAppHash,
  extractAppMetadata: appUtilities.extractAppMetadata,

  // Message Verification
  verifyAppHash: messageVerifier.verifyAppHash,
  verifyAppMessageSignature: messageVerifier.verifyAppMessageSignature,
  verifyAppMessageUpdateSignature: messageVerifier.verifyAppMessageUpdateSignature,
  requestAppMessage: messageVerifier.requestAppMessage,
  requestAppsMessage: messageVerifier.requestAppsMessage,
  requestAppMessageAPI: messageVerifier.requestAppMessageAPI,
  storeAppPermanentMessage: messageVerifier.storeAppPermanentMessage,
  storeAppInstallingErrorMessage: messageVerifier.storeAppInstallingErrorMessage,
  storeIPChangedMessage: messageVerifier.storeIPChangedMessage,
  storeAppRemovedMessage: messageVerifier.storeAppRemovedMessage,
  appHashHasMessage: messageVerifier.appHashHasMessage,
  appHashHasMessageNotFound: messageVerifier.appHashHasMessageNotFound,

  // Image Management & Security
  verifyRepository: imageManager.verifyRepository,
  getBlockedRepositores: imageManager.getBlockedRepositores,
  getUserBlockedRepositores: imageManager.getUserBlockedRepositores,
  checkAppSecrets: imageManager.checkAppSecrets,
  checkApplicationImagesComplience: imageManager.checkApplicationImagesComplience,
  checkApplicationImagesBlocked: imageManager.checkApplicationImagesBlocked,
  validateImageSecurity: imageManager.validateImageSecurity,
  clearBlockedRepositoriesCache: imageManager.clearBlockedRepositoriesCache,

  // Registry & Database Management
  getAppHashes: registryManager.getAppHashes,
  appLocation: registryManager.appLocation,
  appInstallingLocation: registryManager.appInstallingLocation,
  getAppsLocations: registryManager.getAppsLocations,
  getAppsLocation: registryManager.getAppsLocation,
  getAppInstallingLocation: registryManager.getAppInstallingLocation,
  getApplicationGlobalSpecifications: registryManager.getApplicationGlobalSpecifications,
  getApplicationLocalSpecifications: registryManager.getApplicationLocalSpecifications,
  getApplicationSpecifications: registryManager.getApplicationSpecifications,
  getApplicationSpecificationAPI: registryManager.getApplicationSpecificationAPI,
  getApplicationOwnerAPI: registryManager.getApplicationOwnerAPI,
  getGlobalAppsSpecifications: registryManager.getGlobalAppsSpecifications,
  availableApps: registryManager.availableApps,
  checkApplicationRegistrationNameConflicts: registryManager.checkApplicationRegistrationNameConflicts,
  updateAppSpecsForRescanReindex: registryManager.updateAppSpecsForRescanReindex,
  storeAppSpecificationInPermanentStorage: registryManager.storeAppSpecificationInPermanentStorage,
  removeAppSpecificationFromStorage: registryManager.removeAppSpecificationFromStorage,
  getAppSpecificationFromDb: registryManager.getAppSpecificationFromDb,
  getAllAppsInformation: registryManager.getAllAppsInformation,
  getInstalledApps: registryManager.getInstalledApps,
  getRunningApps: registryManager.getRunningApps,

  // Advanced Workflows
  createAppVolume: advancedWorkflows.createAppVolume,
  softRegisterAppLocally: advancedWorkflows.softRegisterAppLocally,
  softRemoveAppLocally: advancedWorkflows.softRemoveAppLocally,
  redeployAPI: advancedWorkflows.redeployAPI,
  checkFreeAppUpdate: advancedWorkflows.checkFreeAppUpdate,
  verifyAppUpdateParameters: advancedWorkflows.verifyAppUpdateParameters,
  stopSyncthingApp: advancedWorkflows.stopSyncthingApp,
  appendBackupTask: advancedWorkflows.appendBackupTask,
  appendRestoreTask: advancedWorkflows.appendRestoreTask,
  removeTestAppMount: advancedWorkflows.removeTestAppMount,
  testAppMount: advancedWorkflows.testAppMount,
  checkApplicationUpdateNameRepositoryConflicts: advancedWorkflows.checkApplicationUpdateNameRepositoryConflicts,

  // System Integration
  getNodeSpecs: systemIntegration.getNodeSpecs,
  setNodeSpecs: systemIntegration.setNodeSpecs,
  returnNodeSpecs: systemIntegration.returnNodeSpecs,
  systemArchitecture: systemIntegration.systemArchitecture,
  totalAppHWRequirements: systemIntegration.totalAppHWRequirements,
  checkAppStaticIpRequirements: systemIntegration.checkAppStaticIpRequirements,
  checkAppNodesRequirements: systemIntegration.checkAppNodesRequirements,
  checkAppHWRequirements: async (appSpecs) => {
    // Original implementation that calls appsResources
    const tier = await generalService.nodeTier();
    const resourcesLocked = await appsResources();
    if (resourcesLocked.status !== 'success') {
      throw new Error('Unable to obtain locked system resources by Flux Apps. Aborting.');
    }

    const appHWrequirements = systemIntegration.totalAppHWRequirements(appSpecs, tier);
    const nodeSpecifications = await systemIntegration.getNodeSpecs();
    const totalSpaceOnNode = nodeSpecifications.ssdStorage;
    if (totalSpaceOnNode === 0) {
      throw new Error('Insufficient space on Flux Node to spawn an application');
    }
    const useableSpaceOnNode = totalSpaceOnNode * 0.95 - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;
    const hddLockedByApps = resourcesLocked.data.appsHddLocked;
    const availableSpaceForApps = useableSpaceOnNode - hddLockedByApps;
    if (appHWrequirements.hdd > availableSpaceForApps) {
      throw new Error('Insufficient space on Flux Node to spawn an application');
    }

    const totalCpuOnNode = nodeSpecifications.cpuCores * 10;
    const useableCpuOnNode = totalCpuOnNode - config.lockedSystemResources.cpu;
    const cpuLockedByApps = resourcesLocked.data.appsCpusLocked * 10;
    const adjustedAppCpu = appHWrequirements.cpu * 10;
    const availableCpuForApps = useableCpuOnNode - cpuLockedByApps;
    if (adjustedAppCpu > availableCpuForApps) {
      throw new Error('Insufficient CPU power on Flux Node to spawn an application');
    }

    const totalRamOnNode = nodeSpecifications.ram;
    const useableRamOnNode = totalRamOnNode - config.lockedSystemResources.ram;
    const ramLockedByApps = resourcesLocked.data.appsRamLocked;
    const availableRamForApps = useableRamOnNode - ramLockedByApps;
    if (appHWrequirements.ram > availableRamForApps) {
      throw new Error('Insufficient RAM on Flux Node to spawn an application');
    }
    return true;
  },
  checkAppRequirements: systemIntegration.checkAppRequirements,
  checkHWParameters: systemIntegration.checkHWParameters,
  checkComposeHWParameters: systemIntegration.checkComposeHWParameters,
  createFluxNetworkAPI: systemIntegration.createFluxNetworkAPI,
  startMonitoringOfApps: systemIntegration.startMonitoringOfApps,
  stopMonitoringOfApps: systemIntegration.stopMonitoringOfApps,

  // State Management Functions
  removalInProgressReset: advancedWorkflows.removalInProgressReset,
  setRemovalInProgressToTrue: advancedWorkflows.setRemovalInProgressToTrue,
  installationInProgressReset: advancedWorkflows.installationInProgressReset,
  setInstallationInProgressTrue: advancedWorkflows.setInstallationInProgressTrue,

  // Additional functions
  appsResources,
  clearAppsMonitored,

  // Constants and utilities
  appConstants,

  // Global state access (controlled)
  getGlobalState,

  setGlobalState: (state) => {
    if (state.removalInProgress !== undefined) removalInProgress = state.removalInProgress;
    if (state.installationInProgress !== undefined) installationInProgress = state.installationInProgress;
    if (state.reinstallationOfOldAppsInProgress !== undefined) reinstallationOfOldAppsInProgress = state.reinstallationOfOldAppsInProgress;
    if (state.masterSlaveAppsRunning !== undefined) masterSlaveAppsRunning = state.masterSlaveAppsRunning;
  },

  // Cache and maps access
  getCaches: () => ({
    spawnErrorsLongerAppCache,
    trySpawningGlobalAppCache,
    myShortCache,
    myLongCache,
    failedNodesTestPortsCache,
    receiveOnlySyncthingAppsCache,
    appsStopedCache,
    syncthingDevicesIDCache,
  }),

  getMaps: () => ({
    hashesNumberOfSearchs,
    mastersRunningGSyncthingApps,
    timeTostartNewMasterApp,
  }),
};