// Complete Modular Apps Service - Main Orchestrator
const os = require('os');
const config = require('config');
const path = require('node:path');
const axios = require('axios');
const util = require('util');
const archiver = require('archiver');
const fs = require('fs').promises;
const { PassThrough } = require('stream');
const dbHelper = require('./dbHelper');
const messageHelper = require('./messageHelper');
const dockerService = require('./dockerService');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const generalService = require('./generalService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const benchmarkService = require('./benchmarkService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const geolocationService = require('./geolocationService');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const syncthingService = require('./syncthingService');
const upnpService = require('./upnpService');
const networkStateService = require('./networkStateService');
const fluxHttpTestServer = require('./utils/fluxHttpTestServer');
const IOUtils = require('./IOUtils');
const cmdAsync = require('util').promisify(require('child_process').exec);
const execShell = util.promisify(require('child_process').exec);
const log = require('../lib/log');
const {
  outgoingPeers, incomingPeers,
} = require('./utils/establishedConnections');

// Import all modularized components
const appConstants = require('./utils/appConstants');
const appSpecHelpers = require('./utils/appSpecHelpers');
const appUtilities = require('./utils/appUtilities');
const chainUtilities = require('./utils/chainUtilities');
const enterpriseHelper = require('./utils/enterpriseHelper');
const { checkAndDecryptAppSpecs } = enterpriseHelper;
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

// Import shared global state
const globalState = require('./utils/globalState');
const { invalidMessages } = require('./invalidMessages');

// Legacy variable references for backward compatibility
let removalInProgress = false;
let installationInProgress = false;
let reinstallationOfOldAppsInProgress = false;
let masterSlaveAppsRunning = false;
const backupInProgress = globalState.backupInProgress;
const restoreInProgress = globalState.restoreInProgress;

// Database collections
const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const appsHashesCollection = config.database.daemon.collections.appsHashes;
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
const globalAppsInstallingErrorsLocations = config.database.appsglobal.collections.appsInstallingErrorsLocations;

// App hash verification state
let continuousFluxAppHashesCheckRunning = false;
let checkAndSyncAppHashesRunning = false;
let firstContinuousFluxAppHashesCheckRun = true;
const hashesNumberOfSearchs = new Map();
const mastersRunningGSyncthingApps = new Map();
const timeTostartNewMasterApp = new Map();

// Cache references
const spawnErrorsLongerAppCache = cacheManager.appSpawnErrorCache;
const trySpawningGlobalAppCache = cacheManager.appSpawnCache;

// Initialize globalState caches
globalState.initializeCaches(cacheManager);
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

// Additional global variables for syncthingApps and checkMyAppsAvailability
let updateSyncthingRunning = false;
let syncthingAppsFirstRun = true;
let dosState = 0;
let dosMessage = null;
let testingPort = null;
let originalPortFailed = null;
let lastUPNPMapFailed = false;
let nextTestingPort = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
const portsNotWorking = new Set();
const isArcane = Boolean(process.env.FLUXOS_PATH);
const fluxDirPath = path.join(__dirname, '../../../');
// ToDo: Fix all the string concatenation in this file and use path.join()
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

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
    const apps = await registryManager.getInstalledApps();
    const totalApps = apps.length;
    const runningApps = await listRunningApps();
    const totalRunning = runningApps.data ? runningApps.data.length : 0;

    // Ensure node specs are loaded before accessing them
    const nodeSpecs = await hwRequirements.getNodeSpecs();

    const usage = {
      totalApps,
      runningApps: totalRunning,
      stoppedApps: totalApps - totalRunning,
      nodeSpecs,
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
  // Sync with globalState module
  removalInProgress = globalState.removalInProgress;
  installationInProgress = globalState.installationInProgress;
  reinstallationOfOldAppsInProgress = globalState.reinstallationOfOldAppsInProgress;
  masterSlaveAppsRunning = globalState.masterSlaveAppsRunning;

  return {
    removalInProgress,
    installationInProgress,
    reinstallationOfOldAppsInProgress,
    masterSlaveAppsRunning,
    backupInProgress,
    restoreInProgress: globalState.restoreInProgress,
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

    // Ensure appsResult is an array
    const apps = Array.isArray(appsResult) ? appsResult : [];
    apps.forEach((app) => {
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
    // Sync global state before checking
    getGlobalState();
    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isNodeConfirmed) {
      log.info('checkAndNotifyPeersOfRunningApps - FluxNode is not Confirmed');
      return;
    }

    // get my external IP and check that it is longer than 5 in length.
    const benchmarkResponse = await benchmarkService.getBenchmarks();
    let myIP = null;
    if (benchmarkResponse.status === 'success') {
      const benchmarkResponseData = benchmarkResponse.data;
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
          const appDetails = await registryManager.getApplicationGlobalSpecifications(mainAppName);
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
            const restoreSkip = globalState.restoreInProgress.some((backupItem) => stoppedApp === backupItem);
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

// Helper functions for syncthingApps and checkMyAppsAvailability
async function signCheckAppData(message) {
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey();
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

async function getDeviceID(fluxIP) {
  try {
    const axiosConfig = {
      timeout: 5000,
    };
    const response = await axios.get(`http://${fluxIP}/syncthing/deviceid`, axiosConfig);
    if (response.data.status === 'success') {
      return response.data.data;
    }
    throw new Error(`Unable to get deviceid from ${fluxIP}`);
  } catch (error) {
    log.error(error);
    return null;
  }
}

async function appLocation(appName) {
  // Get app location data from global apps database
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = { name: appName };
    const projection = { _id: 0 };
    const results = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
    return results || [];
  } catch (error) {
    log.error(`Error getting app location for ${appName}: ${error.message}`);
    return [];
  }
}

async function handleTestShutdown(testingPort, testHttpServer, options = {}) {
  const skipFirewall = options.skipFirewall || false;
  const skipUpnp = options.skipUpnp || false;
  const skipHttpServer = options.skipHttpServer || false;

  const updateFirewall = skipFirewall
    ? false
    : isArcane
    || await fluxNetworkHelper.isFirewallActive().catch(() => true);

  if (updateFirewall) {
    await fluxNetworkHelper
      .deleteAllowPortRule(testingPort)
      .catch((e) => log.error(e));
  }

  if (!skipUpnp) {
    await upnpService
      .removeMapUpnpPort(testingPort, 'Flux_Test_App')
      .catch((e) => log.error(e));
  }

  if (!skipHttpServer) {
    testHttpServer.close((err) => {
      if (err) {
        log.error(`testHttpServer shutdown failed: ${err.message}`);
      }
    });
  }
}

// Docker control functions with app monitoring integration
async function appDockerStop(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component stop. Proceed with stopping just component
    if (isComponent) {
      await dockerService.appDockerStop(appname);
      appInspector.stopAppMonitoring(appname, false, appsMonitored);
    } else {
      // ask for stopping entire composed application
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerStop(appname);
        appInspector.stopAppMonitoring(appname, false, appsMonitored);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStop(`${appComponent.name}_${appSpecs.name}`);
          appInspector.stopAppMonitoring(`${appComponent.name}_${appSpecs.name}`, false, appsMonitored);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

async function appDockerRestart(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerRestart(appname);
      appInspector.startAppMonitoring(appname, appsMonitored);
    } else {
      // ask for restarting entire composed application
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerRestart(appname);
        appInspector.startAppMonitoring(appname, appsMonitored);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerRestart(`${appComponent.name}_${appSpecs.name}`);
          appInspector.startAppMonitoring(`${appComponent.name}_${appSpecs.name}`, appsMonitored);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

async function appDeleteDataInMountPoint(appId) {
  // Implementation for deleting app data in mount point
  try {
    const execDelete = `sudo rm -rf ${appsFolder}${appId}/appdata/*`;
    await cmdAsync(execDelete);
    log.info(`Deleted data for app ${appId}`);
  } catch (error) {
    log.error(`Error deleting data for app ${appId}: ${error.message}`);
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

// Global constants - already defined above

/**
 * Check and sync app hashes from other nodes
 */
async function checkAndSyncAppHashes() {
  try {
    checkAndSyncAppHashesRunning = true;
    const { outgoingPeers } = require('./utils/establishedConnections');
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    // get flux app hashes that do not have a message;
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        message: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    const numberOfMissingApps = results.filter((app) => app.message === false).length;
    if (numberOfMissingApps > results.length * 0.95) {
      let finished = false;
      let i = 0;
      while (!finished && i <= 5) {
        i += 1;
        const client = outgoingPeers[Math.floor(Math.random() * outgoingPeers.length)];
        let axiosConfig = {
          timeout: 5000,
        };
        log.info(`checkAndSyncAppHashes - Getting explorer sync status from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-await-in-loop
        const response = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/explorer/issynced`, axiosConfig).catch((error) => log.error(error));
        if (!response || !response.data || response.data.status !== 'success') {
          log.info(`checkAndSyncAppHashes - Failed to get explorer sync status from ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        if (!response.data.data) {
          log.info(`checkAndSyncAppHashes - Explorer is not synced on ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        log.info(`checkAndSyncAppHashes - Explorer is synced on ${client.ip}:${client.port}`);
        axiosConfig = {
          timeout: 120000,
        };
        log.info(`checkAndSyncAppHashes - Getting permanent app messages from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-await-in-loop
        const appsResponse = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/apps/permanentmessages`, axiosConfig).catch((error) => log.error(error));
        if (!appsResponse || !appsResponse.data || appsResponse.data.status !== 'success' || !appsResponse.data.data) {
          log.info(`checkAndSyncAppHashes - Failed to get permanent app messages from ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        const apps = appsResponse.data.data;
        log.info(`checkAndSyncAppHashes - Will process ${apps.length} apps messages`);
        // sort it by height, so we process oldest messages first
        apps.sort((a, b) => a.height - b.height);

        // because there are broken nodes on the network, we need to temporarily skip
        // any apps that have null for valueSat.
        const filteredApps = apps.filter((app) => app.valueSat !== null);

        let y = 0;
        // eslint-disable-next-line no-restricted-syntax
        for (const appMessage of filteredApps) {
          y += 1;
          try {
            // Clean the permanent message to only include fields used in signature verification
            // Permanent messages have extra fields (txid, height, valueSat) that aren't part of the original signature
            const cleanMessage = {
              type: appMessage.type,
              version: appMessage.version,
              appSpecifications: appMessage.appSpecifications,
              hash: appMessage.hash,
              timestamp: appMessage.timestamp,
              signature: appMessage.signature
            };
            // Support legacy field name if present
            if (appMessage.zelAppSpecifications) {
              cleanMessage.zelAppSpecifications = appMessage.zelAppSpecifications;
            }
            // eslint-disable-next-line no-await-in-loop
            await messageStore.storeAppTemporaryMessage(cleanMessage, true);
            // eslint-disable-next-line no-await-in-loop
            await messageVerifier.checkAndRequestApp(appMessage.hash, appMessage.txid, appMessage.height, appMessage.valueSat, 2);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(50);
          } catch (error) {
            log.error(error);
          }
          if (y % 500 === 0) {
            log.info(`checkAndSyncAppHashes - ${y} were already processed`);
          }
        }
        finished = true;
        // eslint-disable-next-line no-await-in-loop
        await registryManager.expireGlobalApplications();
        log.info('checkAndSyncAppHashes - Process finished');
      }
    }
    globalState.checkAndSyncAppHashesWasEverExecuted = true;
    checkAndSyncAppHashesRunning = false;
  } catch (error) {
    log.error(error);
    globalState.checkAndSyncAppHashesWasEverExecuted = false;
    checkAndSyncAppHashesRunning = false;
  }
}

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

// Main functions: syncthingApps and checkMyAppsAvailability
async function syncthingApps() {
  try {
    // Sync global state before checking
    getGlobalState();
    // do not run if installationInProgress or removalInProgress
    if (installationInProgress || removalInProgress || updateSyncthingRunning) {
      return;
    }
    updateSyncthingRunning = true;
    // get list of all installed apps
    const appsInstalled = await installedApps();
    if (appsInstalled.status === 'error') {
      return;
    }
    // go through every containerData of all components of every app
    const devicesIds = [];
    const devicesConfiguration = [];
    const folderIds = [];
    const foldersConfiguration = [];
    const newFoldersConfiguration = [];
    const myDeviceId = await syncthingService.getDeviceId();

    if (!myDeviceId) {
      log.error('syncthingApps - Failed to get myDeviceId');
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      log.error('syncthingApps - Failed to get myIP');
      return;
    }

    const allFoldersResp = await syncthingService.getConfigFolders();
    const allDevicesResp = await syncthingService.getConfigDevices();
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data) {
      const backupSkip = backupInProgress.some((backupItem) => installedApp.name === backupItem);
      const restoreSkip = restoreInProgress.some((backupItem) => installedApp.name === backupItem);
      if (backupSkip || restoreSkip) {
        log.info(`syncthingApps - Backup is running for ${installedApp.name}, syncthing disabled for that app`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (installedApp.version <= 3) {
        const containersData = installedApp.containerData.split('|');
        // eslint-disable-next-line no-restricted-syntax
        for (let i = 0; i < containersData.length; i += 1) {
          const container = containersData[i];
          const containerDataFlags = container.split(':')[1] ? container.split(':')[0] : '';
          if (containerDataFlags.includes('s') || containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
            const containerFolder = i === 0 ? '' : `/appdata${container.split(':')[1].replace(containersData[0], '')}`;
            const identifier = installedApp.name;
            const appId = dockerService.getAppIdentifier(identifier);
            const folder = `${appsFolder + appId + containerFolder}`;
            const id = appId;
            const label = appId;
            const devices = [{ deviceID: myDeviceId }];
            const execDIRst = `[ ! -d \\"${folder}/.stfolder\\" ] && sudo mkdir -p ${folder}/.stfolder`; // if stfolder doesn't exist creates it
            // eslint-disable-next-line no-await-in-loop
            await cmdAsync(execDIRst);
            // eslint-disable-next-line no-await-in-loop
            let locations = await appLocation(installedApp.name);
            locations.sort((a, b) => {
              if (a.ip < b.ip) {
                return -1;
              }
              if (a.ip > b.ip) {
                return 1;
              }
              return 0;
            });
            locations = locations.filter((loc) => loc.ip !== myIP);
            // eslint-disable-next-line no-restricted-syntax
            for (const appInstance of locations) {
              const ip = appInstance.ip.split(':')[0];
              const port = appInstance.ip.split(':')[1] || '16127';
              const addresses = [`tcp://${ip}:${+port + 2}`, `quic://${ip}:${+port + 2}`];
              const name = `${ip}:${port}`;
              let deviceID;
              if (syncthingDevicesIDCache.has(name)) {
                deviceID = syncthingDevicesIDCache.get(name);
              } else {
                // eslint-disable-next-line no-await-in-loop
                deviceID = await getDeviceID(name);
                if (deviceID) {
                  syncthingDevicesIDCache.set(name, deviceID);
                }
              }
              if (deviceID) {
                if (deviceID !== myDeviceId) { // skip my id, already present
                  const folderDeviceExists = devices.find((device) => device.deviceID === deviceID);
                  if (!folderDeviceExists) { // double check if not multiple the same ids
                    devices.push({ deviceID });
                  }
                }
                const deviceExists = devicesConfiguration.find((device) => device.name === name);
                if (!deviceExists) {
                  const newDevice = {
                    deviceID,
                    name,
                    addresses,
                    autoAcceptFolders: true,
                  };
                  devicesIds.push(deviceID);
                  if (deviceID !== myDeviceId) {
                    const syncthingDeviceExists = allDevicesResp.data.find((device) => device.name === name);
                    if (!syncthingDeviceExists) {
                      devicesConfiguration.push(newDevice);
                    }
                  }
                }
              }
            }
            const syncthingFolder = {
              id,
              label,
              path: folder,
              devices,
              paused: false,
              type: 'sendreceive',
              rescanIntervalS: 900,
              maxConflicts: 0,
            };
            const syncFolder = allFoldersResp.data.find((x) => x.id === id);
            if (containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
              if (syncthingAppsFirstRun) {
                if (!syncFolder) {
                  log.info(`syncthingApps - stopping and cleaning appIdentifier ${appId}`);
                  syncthingFolder.type = 'receiveonly';
                  const cache = {
                    numberOfExecutions: 1,
                  };
                  receiveOnlySyncthingAppsCache.set(appId, cache);
                  // eslint-disable-next-line no-await-in-loop
                  await appDockerStop(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                  // eslint-disable-next-line no-await-in-loop
                  await appDeleteDataInMountPoint(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                } else {
                  const cache = {
                    restarted: true,
                  };
                  receiveOnlySyncthingAppsCache.set(appId, cache);
                  if (syncFolder.type === 'receiveonly') {
                    cache.restarted = false;
                    cache.numberOfExecutions = 1;
                    receiveOnlySyncthingAppsCache.set(appId, cache);
                  }
                }
              } else if (receiveOnlySyncthingAppsCache.has(appId) && !receiveOnlySyncthingAppsCache.get(appId).restarted) {
                const cache = receiveOnlySyncthingAppsCache.get(appId);
                // eslint-disable-next-line no-await-in-loop
                const runningAppList = await appLocation(installedApp.name);
                log.info(`syncthingApps - appIdentifier ${appId} is running on nodes ${JSON.stringify(runningAppList)}`);
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
                  if (a.broadcastedAt < b.broadcastedAt) {
                    return -1;
                  }
                  if (a.broadcastedAt > b.broadcastedAt) {
                    return 1;
                  }
                  if (a.ip < b.ip) {
                    return -1;
                  }
                  if (a.ip > b.ip) {
                    return 1;
                  }
                  return 0;
                });
                if (myIP) {
                  const index = runningAppList.findIndex((x) => x.ip === myIP);
                  let numberOfExecutionsRequired = 2;
                  if (index > 0) {
                    numberOfExecutionsRequired = 2 + 10 * index;
                  }
                  if (numberOfExecutionsRequired > 60) {
                    numberOfExecutionsRequired = 60;
                  }
                  cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

                  syncthingFolder.type = 'receiveonly';
                  cache.numberOfExecutions += 1;
                  if (cache.numberOfExecutions === cache.numberOfExecutionsRequired) {
                    syncthingFolder.type = 'sendreceive';
                  } else if (cache.numberOfExecutions >= cache.numberOfExecutionsRequired + 1) {
                    log.info(`syncthingApps - changing syncthing type to sendreceive for appIdentifier ${appId}`);
                    syncthingFolder.type = 'sendreceive';
                    if (containerDataFlags.includes('r')) {
                      log.info(`syncthingApps - starting appIdentifier ${appId}`);
                      // eslint-disable-next-line no-await-in-loop
                      await appDockerRestart(id);
                    }
                    cache.restarted = true;
                  }
                  receiveOnlySyncthingAppsCache.set(appId, cache);
                }
              } else if (!receiveOnlySyncthingAppsCache.has(appId)) {
                log.info(`syncthingApps - stopping and cleaning appIdentifier ${appId}`);
                syncthingFolder.type = 'receiveonly';
                const cache = {
                  numberOfExecutions: 1,
                };
                receiveOnlySyncthingAppsCache.set(appId, cache);
                // eslint-disable-next-line no-await-in-loop
                await appDockerStop(id);
                // eslint-disable-next-line no-await-in-loop
                await serviceHelper.delay(500);
                // eslint-disable-next-line no-await-in-loop
                await appDeleteDataInMountPoint(id);
                // eslint-disable-next-line no-await-in-loop
                await serviceHelper.delay(500);
              }
            }
            folderIds.push(id);
            foldersConfiguration.push(syncthingFolder);
            if (!syncFolder) {
              newFoldersConfiguration.push(syncthingFolder);
            } else if (syncFolder && (syncFolder.maxConflicts !== 0 || syncFolder.paused || syncFolder.type !== syncthingFolder.type || JSON.stringify(syncFolder.devices) !== JSON.stringify(syncthingFolder.devices))) {
              newFoldersConfiguration.push(syncthingFolder);
            }
          }
        }
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const installedComponent of installedApp.compose) {
          const containersData = installedComponent.containerData.split('|');
          // eslint-disable-next-line no-restricted-syntax
          for (let i = 0; i < containersData.length; i += 1) {
            const container = containersData[i];
            const containerDataFlags = container.split(':')[1] ? container.split(':')[0] : '';
            if (containerDataFlags.includes('s') || containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
              const containerFolder = i === 0 ? '' : `/appdata${container.split(':')[1].replace(containersData[0], '')}`;
              const identifier = `${installedComponent.name}_${installedApp.name}`;
              const appId = dockerService.getAppIdentifier(identifier);
              const folder = `${appsFolder + appId + containerFolder}`;
              const id = appId;
              const label = appId;
              const devices = [{ deviceID: myDeviceId }];
              const execDIRst = `[ ! -d \\"${folder}/.stfolder\\" ] && sudo mkdir -p ${folder}/.stfolder`; // if stfolder doesn't exist creates it
              // eslint-disable-next-line no-await-in-loop
              await cmdAsync(execDIRst);
              // eslint-disable-next-line no-await-in-loop
              let locations = await appLocation(installedApp.name);
              locations.sort((a, b) => {
                if (a.ip < b.ip) {
                  return -1;
                }
                if (a.ip > b.ip) {
                  return 1;
                }
                return 0;
              });
              locations = locations.filter((loc) => loc.ip !== myIP);
              // eslint-disable-next-line no-restricted-syntax
              for (const appInstance of locations) {
                const ip = appInstance.ip.split(':')[0];
                const port = appInstance.ip.split(':')[1] || '16127';
                const addresses = [`tcp://${ip}:${+port + 2}`, `quic://${ip}:${+port + 2}`];
                const name = `${ip}:${port}`;
                let deviceID;
                if (syncthingDevicesIDCache.has(name)) {
                  deviceID = syncthingDevicesIDCache.get(name);
                } else {
                  // eslint-disable-next-line no-await-in-loop
                  deviceID = await getDeviceID(name);
                  if (deviceID) {
                    syncthingDevicesIDCache.set(name, deviceID);
                  }
                }
                if (deviceID) {
                  if (deviceID !== myDeviceId) { // skip my id, already present
                    const folderDeviceExists = devices.find((device) => device.deviceID === deviceID);
                    if (!folderDeviceExists) { // double check if not multiple the same ids
                      devices.push({ deviceID });
                    }
                  }
                  const deviceExists = devicesConfiguration.find((device) => device.name === name);
                  if (!deviceExists) {
                    const newDevice = {
                      deviceID,
                      name,
                      addresses,
                      autoAcceptFolders: true,
                    };
                    devicesIds.push(deviceID);
                    if (deviceID !== myDeviceId) {
                      const syncthingDeviceExists = allDevicesResp.data.find((device) => device.name === name);
                      if (!syncthingDeviceExists) {
                        devicesConfiguration.push(newDevice);
                      }
                    }
                  }
                }
              }
              const syncthingFolder = {
                id,
                label,
                path: folder,
                devices,
                paused: false,
                type: 'sendreceive',
                rescanIntervalS: 900,
                maxConflicts: 0,
              };
              const syncFolder = allFoldersResp.data.find((x) => x.id === id);
              if (containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
                if (syncthingAppsFirstRun) {
                  if (!syncFolder) {
                    log.info(`syncthingApps - stopping and cleaning appIdentifier ${appId}`);
                    syncthingFolder.type = 'receiveonly';
                    const cache = {
                      numberOfExecutions: 1,
                    };
                    receiveOnlySyncthingAppsCache.set(appId, cache);
                    // eslint-disable-next-line no-await-in-loop
                    await appDockerStop(id);
                    // eslint-disable-next-line no-await-in-loop
                    await serviceHelper.delay(500);
                    // eslint-disable-next-line no-await-in-loop
                    await appDeleteDataInMountPoint(id);
                    // eslint-disable-next-line no-await-in-loop
                    await serviceHelper.delay(500);
                  } else {
                    const cache = {
                      restarted: true,
                    };
                    receiveOnlySyncthingAppsCache.set(appId, cache);
                    if (syncFolder.type === 'receiveonly') {
                      cache.restarted = false;
                      cache.numberOfExecutions = 1;
                      receiveOnlySyncthingAppsCache.set(appId, cache);
                    }
                  }
                } else if (receiveOnlySyncthingAppsCache.has(appId) && !receiveOnlySyncthingAppsCache.get(appId).restarted) {
                  const cache = receiveOnlySyncthingAppsCache.get(appId);
                  // eslint-disable-next-line no-await-in-loop
                  const runningAppList = await appLocation(installedApp.name);
                  log.info(`syncthingApps - appIdentifier ${appId} is running on nodes ${JSON.stringify(runningAppList)}`);
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
                    if (a.broadcastedAt < b.broadcastedAt) {
                      return -1;
                    }
                    if (a.broadcastedAt > b.broadcastedAt) {
                      return 1;
                    }
                    if (a.ip < b.ip) {
                      return -1;
                    }
                    if (a.ip > b.ip) {
                      return 1;
                    }
                    return 0;
                  });
                  if (myIP) {
                    const index = runningAppList.findIndex((x) => x.ip === myIP);
                    log.info(`syncthingApps - appIdentifier ${appId} is node index ${index}`);
                    let numberOfExecutionsRequired = 2;
                    if (index > 0) {
                      numberOfExecutionsRequired = 2 + 10 * index;
                    }
                    if (numberOfExecutionsRequired > 60) {
                      numberOfExecutionsRequired = 60;
                    }
                    cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

                    syncthingFolder.type = 'receiveonly';
                    cache.numberOfExecutions += 1;
                    log.info(`syncthingApps - appIdentifier ${appId} execution ${cache.numberOfExecutions} of ${cache.numberOfExecutionsRequired + 1} to start the app`);
                    if (cache.numberOfExecutions === cache.numberOfExecutionsRequired) {
                      syncthingFolder.type = 'sendreceive';
                    } else if (cache.numberOfExecutions === cache.numberOfExecutionsRequired + 1) {
                      log.info(`syncthingApps - starting appIdentifier ${appId}`);
                      syncthingFolder.type = 'sendreceive';
                      if (containerDataFlags.includes('r')) {
                        log.info(`syncthingApps - starting appIdentifier ${appId}`);
                        // eslint-disable-next-line no-await-in-loop
                        await appDockerRestart(id);
                      }
                      cache.restarted = true;
                    }
                    receiveOnlySyncthingAppsCache.set(appId, cache);
                  }
                } else if (!receiveOnlySyncthingAppsCache.has(appId)) {
                  log.info(`syncthingApps - stopping and cleaning appIdentifier ${appId}`);
                  syncthingFolder.type = 'receiveonly';
                  const cache = {
                    numberOfExecutions: 1,
                  };
                  receiveOnlySyncthingAppsCache.set(appId, cache);
                  // eslint-disable-next-line no-await-in-loop
                  await appDockerStop(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                  // eslint-disable-next-line no-await-in-loop
                  await appDeleteDataInMountPoint(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                }
              }
              folderIds.push(id);
              foldersConfiguration.push(syncthingFolder);
              if (!syncFolder) {
                newFoldersConfiguration.push(syncthingFolder);
              } else if (syncFolder && (syncFolder.maxConflicts !== 0 || syncFolder.paused || syncFolder.type !== syncthingFolder.type || JSON.stringify(syncFolder.devices) !== JSON.stringify(syncthingFolder.devices))) {
                newFoldersConfiguration.push(syncthingFolder);
              }
            }
          }
        }
      }
    }

    // remove folders that should not be synced anymore (this shall actually not trigger)
    const nonUsedFolders = allFoldersResp.data.filter((syncthingFolder) => !folderIds.includes(syncthingFolder.id));
    // eslint-disable-next-line no-restricted-syntax
    for (const nonUsedFolder of nonUsedFolders) {
      log.info(`syncthingApps - Removing unused Syncthing of folder ${nonUsedFolder.id}`);
      // eslint-disable-next-line no-await-in-loop
      await syncthingService.adjustConfigFolders('delete', undefined, nonUsedFolder.id);
    }
    // remove obsolete devices
    const nonUsedDevices = allDevicesResp.data.filter((syncthingDevice) => !devicesIds.includes(syncthingDevice.deviceID));
    // eslint-disable-next-line no-restricted-syntax
    for (const nonUsedDevice of nonUsedDevices) {
      // exclude our deviceID
      if (nonUsedDevice.deviceID !== myDeviceId) {
        log.info(`syncthingApps - Removing unused Syncthing device ${nonUsedDevice.deviceID}`);
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.adjustConfigDevices('delete', undefined, nonUsedDevice.deviceID);
      }
    }
    // finally apply all new configuration
    // now we have new accurate devicesConfiguration and foldersConfiguration
    // add more of current devices
    // excludes our current deviceID adjustment
    if (devicesConfiguration.length >= 0) {
      await syncthingService.adjustConfigDevices('put', devicesConfiguration);
    }
    if (newFoldersConfiguration.length >= 0) {
      await syncthingService.adjustConfigFolders('put', newFoldersConfiguration);
    }
    // all configuration changes applied

    // check for errors in folders and if true reset that index database
    for (let i = 0; i < foldersConfiguration.length; i += 1) {
      const folder = foldersConfiguration[i];
      // eslint-disable-next-line no-await-in-loop
      const folderError = await syncthingService.getFolderIdErrors(folder.id);
      if (folderError && folderError.status === 'success' && folderError.data.errors && folderError.data.errors.length > 0) {
        log.error(`syncthingApps - Errors detected on syncthing folderId:${folder.id} - app is going to be uninstalled`);
        log.error(folderError);
        let appName = folder.id;
        if (appName.includes('_')) {
          appName = appName.split('_')[1];
        }
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocally(appName, null, true, false, true);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(5 * 1000);
      }
    }
    // check if restart is needed
    const restartRequired = await syncthingService.getConfigRestartRequired();
    if (restartRequired.status === 'success' && restartRequired.data.requiresRestart === true) {
      log.info('syncthingApps - New configuration applied. Syncthing restart required, restarting...');
      await syncthingService.systemRestart();
    }
  } catch (error) {
    log.error(error);
  } finally {
    updateSyncthingRunning = false;
    syncthingAppsFirstRun = false;
    await serviceHelper.delay(30 * 1000);
    syncthingApps();
  }
}

async function checkMyAppsAvailability() {
  const timeouts = {
    default: 3_600_000,
    error: 60_000,
    failure: 15_000,
    dos: 300_000,
    appError: 240_000,
  };

  const thresholds = {
    dos: 100,
    portsHighEdge: 100,
    portsLowEdge: 80,
  };

  if (dosMountMessage || dosDuplicateAppMessage) {
    dosMessage = dosMountMessage || dosDuplicateAppMessage;
    dosState = thresholds.dos;

    await serviceHelper.delay(timeouts.appError);
    setImmediate(checkMyAppsAvailability);
    return;
  }

  const isUpnp = upnpService.isUPNP();
  const testHttpServer = new fluxHttpTestServer.FluxHttpTestServer();

  const setNextPort = () => {
    if (originalPortFailed && testingPort > originalPortFailed) {
      nextTestingPort = originalPortFailed - 1;
    } else {
      nextTestingPort = null;
      originalPortFailed = null;
    }
  };

  const setRandomPort = () => {
    const ports = Array.from(portsNotWorking);
    const randomIndex = Math.floor(Math.random() * ports.length);
    nextTestingPort = ports[randomIndex];
    return ports;
  };

  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      log.info('Flux Node daemon not synced. Application checks are disabled');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);

    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Application checks are disabled');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const localSocketAddress = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!localSocketAddress) {
      log.info('No Public IP found. Application checks are disabled');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      log.error('Failed to get installed Apps');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const apps = installedAppsRes.data;
    const appPorts = [];

    apps.forEach((app) => {
      if (app.version === 1) {
        appPorts.push(+app.port);
      } else if (app.version <= 3) {
        app.ports.forEach((port) => {
          appPorts.push(+port);
        });
      } else {
        app.compose.forEach((component) => {
          component.ports.forEach((port) => {
            appPorts.push(+port);
          });
        });
      }
    });

    if (nextTestingPort) {
      testingPort = nextTestingPort;
    } else {
      const { fluxapps: { portMin, portMax } } = config;
      testingPort = Math.floor(Math.random() * (portMax - portMin) + portMin);
    }

    log.info(`checkMyAppsAvailability - Testing port ${testingPort}`);

    const isPortBanned = fluxNetworkHelper.isPortBanned(testingPort);
    if (isPortBanned) {
      log.info(`checkMyAppsAvailability - Testing port ${testingPort} is banned`);
      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    if (isUpnp) {
      const isPortUpnpBanned = fluxNetworkHelper.isPortUPNPBanned(testingPort);
      if (isPortUpnpBanned) {
        log.info(`checkMyAppsAvailability - Testing port ${testingPort} is UPNP banned`);
        setNextPort();
        await serviceHelper.delay(timeouts.failure);
        setImmediate(checkMyAppsAvailability);
        return;
      }
    }

    const isPortUserBlocked = fluxNetworkHelper.isPortUserBlocked(testingPort);
    if (isPortUserBlocked) {
      log.info(`checkMyAppsAvailability - Testing port ${testingPort} is user blocked`);
      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    if (appPorts.includes(testingPort)) {
      log.info(`checkMyAppsAvailability - Skipped checking ${testingPort} - in use`);
      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const remoteSocketAddress = await networkStateService.getRandomSocketAddress(localSocketAddress);
    if (!remoteSocketAddress) {
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    if (failedNodesTestPortsCache.has(remoteSocketAddress)) {
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const firewallActive = isArcane ? true : await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      await fluxNetworkHelper.allowPort(testingPort);
    }

    if (isUpnp) {
      const upnpMapResult = await upnpService.mapUpnpPort(testingPort, 'Flux_Test_App');
      if (!upnpMapResult) {
        if (lastUPNPMapFailed) {
          dosState += 4;
          if (dosState >= thresholds.dos) {
            dosMessage = 'Not possible to run applications on the node, router returning exceptions when creating UPNP ports mappings';
          }
        }
        lastUPNPMapFailed = true;
        log.info(`checkMyAppsAvailability - Testing port ${testingPort} failed to create UPnP mapping`);
        setNextPort();
        await handleTestShutdown(testingPort, testHttpServer, {
          skipFirewall: !firewallActive,
          skipUpnp: true,
          skipHttpServer: true,
        });
        const upnpDelay = dosMessage ? timeouts.dos : timeouts.error;
        await serviceHelper.delay(upnpDelay);
        setImmediate(checkMyAppsAvailability);
        return;
      }
      lastUPNPMapFailed = false;
    }

    const listening = new Promise((resolve, reject) => {
      testHttpServer
        .once('error', (err) => {
          testHttpServer.removeAllListeners('listening');
          reject(err.message);
        })
        .once('listening', () => {
          testHttpServer.removeAllListeners('error');
          resolve(null);
        });
      testHttpServer.listen(testingPort);
    });

    const error = await listening.catch((err) => err);
    if (error) {
      log.warn(`Unable to listen on port: ${testingPort}. Error: ${error}`);
      setNextPort();
      await handleTestShutdown(testingPort, testHttpServer, {
        skipFirewall: !firewallActive,
        skipUpnp: !isUpnp,
        skipHttpServer: true,
      });
      await serviceHelper.delay(timeouts.error);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const timeout = 10_000;
    const axiosConfig = {
      timeout,
      headers: { 'content-type': '' },
    };

    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    const [localIp, localPort = '16127'] = localSocketAddress.split(':');
    const [remoteIp, remotePort = '16127'] = remoteSocketAddress.split(':');

    const data = {
      ip: localIp,
      port: localPort,
      appname: 'appPortsTest',
      ports: [testingPort],
      pubKey,
    };

    const signature = await signCheckAppData(JSON.stringify(data));
    data.signature = signature;

    const resMyAppAvailability = await axios
      .post(`http://${remoteIp}:${remotePort}/flux/checkappavailability`, JSON.stringify(data), axiosConfig)
      .catch(() => {
        log.error(`checkMyAppsAvailability - ${remoteSocketAddress} for app availability is not reachable`);
        nextTestingPort = testingPort;
        failedNodesTestPortsCache.set(remoteSocketAddress, '');
        return null;
      });

    await handleTestShutdown(testingPort, testHttpServer, {
      skipFirewall: !firewallActive,
      skipUpnp: !isUpnp,
    });

    if (!resMyAppAvailability) {
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const {
      data: {
        status: responseStatus = null,
        data: { message: responseMessage = 'No response' } = { message: 'No response' },
      },
    } = resMyAppAvailability;

    if (!['success', 'error'].includes(responseStatus)) {
      log.warn(`checkMyAppsAvailability - Unexpected response status: ${responseStatus}`);
      await serviceHelper.delay(timeouts.error);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const portTestFailed = responseStatus === 'error';
    let waitMs = 0;

    if (portTestFailed && portsNotWorking.size < thresholds.portsHighEdge) {
      portsNotWorking.add(testingPort);
      if (!originalPortFailed) {
        originalPortFailed = testingPort;
        nextTestingPort = testingPort < 65535 ? testingPort + 1 : testingPort - 1;
      } else if (testingPort >= originalPortFailed && testingPort + 1 <= 65535) {
        nextTestingPort = testingPort + 1;
      } else if (testingPort - 1 > 0) {
        nextTestingPort = testingPort - 1;
      } else {
        nextTestingPort = null;
        originalPortFailed = null;
      }
      waitMs = timeouts.failure;
    } else if (portTestFailed && dosState < thresholds.dos) {
      dosState += 4;
      setRandomPort();
      waitMs = timeouts.failure;
    } else if (portTestFailed && dosState >= thresholds.dos) {
      const failedPorts = setRandomPort();
      dosMessage = `Ports tested not reachable from outside, DMZ or UPNP required! All ports that have failed: ${JSON.stringify(failedPorts)}`;
      waitMs = timeouts.dos;
    } else if (!portTestFailed && portsNotWorking.size > thresholds.portsLowEdge) {
      portsNotWorking.delete(testingPort);
      setRandomPort();
      waitMs = timeouts.failure;
    } else {
      portsNotWorking.clear();
      nextTestingPort = null;
      originalPortFailed = null;
      dosMessage = dosMountMessage || dosDuplicateAppMessage || null;
      dosState = dosMessage ? thresholds.dos : 0;
      waitMs = timeouts.default;
    }

    if (portTestFailed) {
      log.error(`checkMyAppsAvailability - Port ${testingPort} unreachable. Detected from ${remoteIp}:${remotePort}. DosState: ${dosState}`);
    } else {
      log.info(`${responseMessage} Detected from ${remoteIp}:${remotePort} on port ${testingPort}. DosState: ${dosState}`);
    }

    if (portsNotWorking.size) {
      log.error(`checkMyAppsAvailability - Count: ${portsNotWorking.size}. portsNotWorking: ${JSON.stringify(Array.from(portsNotWorking))}`);
    }

    await serviceHelper.delay(waitMs);
    setImmediate(checkMyAppsAvailability);
  } catch (error) {
    if (!dosMessage && (dosMountMessage || dosDuplicateAppMessage)) {
      dosMessage = dosMountMessage || dosDuplicateAppMessage;
    }
    await handleTestShutdown(testingPort, testHttpServer, { skipUpnp: !isUpnp });
    log.error(`checkMyAppsAvailability - Error: ${error}`);
    await serviceHelper.delay(timeouts.appError);
    setImmediate(checkMyAppsAvailability);
  }
}

/**
 * To get deployment information. Returns information needed for application deployment regarding specification limitation and prices.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function deploymentInformation(req, res) {
  try {
    // respond with information needed for application deployment regarding specification limitation and prices
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const daemonHeight = syncStatus.data.height;
    let deployAddr = config.fluxapps.address;
    if (daemonHeight >= config.fluxapps.appSpecsEnforcementHeights[6]) {
      deployAddr = config.fluxapps.addressMultisig;
    }
    if (daemonHeight >= config.fluxapps.multisigAddressChange) {
      deployAddr = config.fluxapps.addressMultisigB;
    }
    // search in chainparams db for chainmessages of p version
    const appPrices = await chainUtilities.getChainParamsPriceUpdates();
    const { fluxapps: { portMin, portMax } } = config;
    const information = {
      price: appPrices,
      appSpecsEnforcementHeights: config.fluxapps.appSpecsEnforcementHeights,
      address: deployAddr,
      portMin,
      portMax,
      enterprisePorts: config.fluxapps.enterprisePorts,
      bannedPorts: config.fluxapps.bannedPorts,
      maxImageSize: config.fluxapps.maxImageSize,
      minimumInstances: config.fluxapps.minimumInstances,
      maximumInstances: config.fluxapps.maximumInstances,
      blocksLasting: config.fluxapps.blocksLasting,
      minBlocksAllowance: config.fluxapps.minBlocksAllowance,
      maxBlocksAllowance: config.fluxapps.maxBlocksAllowance,
      blocksAllowanceInterval: config.fluxapps.blocksAllowanceInterval,
    };
    const respondPrice = messageHelper.createDataMessage(information);
    res.json(respondPrice);
  } catch (error) {
    log.warn(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To get application specification usd prices.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Returns object with application specification usd prices.
 */
async function getAppSpecsUSDPrice(req, res) {
  try {
    const resMessage = messageHelper.createDataMessage(config.fluxapps.usdprice);
    res.json(resMessage);
  } catch (error) {
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  }
}

/**
 * To get latest application specification API version.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getlatestApplicationSpecificationAPI(req, res) {
  const latestSpec = config.fluxapps.latestAppSpecification || 1;

  const message = messageHelper.createDataMessage(latestSpec);

  res.json(message);
}

/**
 * To register an app globally via API. Performs various checks before the app can be registered. Only accessible by users.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function registerAppGlobalyApi(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      // first check if this node is available for application registration
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application registration');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application registration');
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and port HAVE to be unique for application. Check if they don't exist in global database
      // first let's check if all fields are present and have proper format except tiered and tiered specifications and those can be omitted
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, type, version, timestamp and signature are provided.');
      }
      if (messageType !== 'zelappregister' && messageType !== 'fluxappregister') {
        throw new Error('Invalid type of message');
      }
      if (typeVersion !== 1) {
        throw new Error('Invalid version of message');
      }
      appSpecification = serviceHelper.ensureObject(appSpecification);
      timestamp = serviceHelper.ensureNumber(timestamp);
      signature = serviceHelper.ensureString(signature);
      messageType = serviceHelper.ensureString(messageType);
      typeVersion = serviceHelper.ensureNumber(typeVersion);

      const timestampNow = Date.now();
      if (timestamp < timestampNow - 1000 * 3600) {
        throw new Error('Message timestamp is over 1 hour old, not valid. Check if your computer clock is synced and restart the registration process.');
      } else if (timestamp > timestampNow + 1000 * 60 * 5) {
        throw new Error('Message timestamp from future, not valid. Check if your computer clock is synced and restart the registration process.');
      }

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
          owner: appSpecification.owner,
        },
      );

      const appSpecFormatted = appUtilities.specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await appValidator.verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await imageManager.checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // check if name is not yet registered
      await registryManager.checkApplicationRegistrationNameConflicts(appSpecFormatted);

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const toVerify = isEnterprise
        ? appUtilities.specificationFormatter(appSpecification)
        : appSpecFormatted;

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type or bad message received. Respond with 'Received message is invalid';
      await messageVerifier.verifyAppMessageSignature(messageType, typeVersion, toVerify, timestamp, signature);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may pose some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);

      // now all is great. Store appSpecFormatted, timestamp, signature and hash in appsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryAppMessage = { // specification of temp message
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
        arcaneSender: isArcane,
      };
      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);
      // above takes 2-3 seconds
      await serviceHelper.delay(1200); // it takes receiving node at least 1 second to process the message. Add 1200 ms mas for processing
      // this operations takes 2.5-3.5 seconds and is heavy, message gets verified again.
      await messageVerifier.requestAppMessage(messageHASH); // this itself verifies that Peers received our message broadcast AND peers send us the message back. By peers sending the message back we finally store it to our temporary message storage and rebroadcast it again
      // request app message is quite slow and from performance testing message will appear roughly 5 seconds after ask
      await serviceHelper.delay(1200); // 1200 ms mas for processing - peer sends message back to us
      // check temporary message storage
      let tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(messageHASH); // Cumulus measurement: after roughly 8 seconds here
      for (let i = 0; i < 20; i += 1) { // ask for up to 20 times - 10 seconds. Must have been processed by that time or it failed. Cumulus measurement: Approx 5-6 seconds
        if (!tempMessage) {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(messageHASH);
        }
      }
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const responseHash = messageHelper.createDataMessage(tempMessage.hash);
        res.json(responseHash); // all ok
        return;
      }
      throw new Error('Unable to register application on the network. Try again later.');
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * To reindex global apps location via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsLocationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsLocation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To reindex global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsInformation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To rescan global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function rescanGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req.query.blockheight;
      if (!blockheight) {
        const errMessage = messageHelper.createErrorMessage('No blockheight provided');
        res.json(errMessage);
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
      if (!currentHeight) {
        throw new Error('No scanned height found');
      }
      if (currentHeight.generalScannedHeight <= blockheight) {
        throw new Error('Block height shall be lower than currently scanned');
      }
      if (blockheight < 0) {
        throw new Error('BlockHeight lower than 0');
      }
      let { removelastinformation } = req.params;
      removelastinformation = removelastinformation || req.query.removelastinformation || false;
      removelastinformation = serviceHelper.ensureBoolean(removelastinformation);
      await rescanGlobalAppsInformation(blockheight, removelastinformation);
      const message = messageHelper.createSuccessMessage('Rescan successfull');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To get application original owner.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getApplicationOriginalOwner(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const projection = {
      projection: {
        _id: 0,
      },
    };
    log.info(`Searching register permanent messages for ${appname}`);
    const appsQuery = {
      'appSpecifications.name': appname,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
    const ownerResponse = messageHelper.createDataMessage(lastAppRegistration.appSpecifications.owner);
    res.json(ownerResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To get apps installing locations.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsInstallingLocations(req, res) {
  try {
    const results = await appInstallingLocation();
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To get apps folder contents.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${folder}`;
      } else {
        throw new Error('Application volume not found');
      }
      const options = {
        withFileTypes: false,
      };
      const files = await fs.readdir(filepath, options);
      const filesWithDetails = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const fileStats = await fs.lstat(`${filepath}/${file}`);
        const isDirectory = fileStats.isDirectory();
        const isFile = fileStats.isFile();
        const isSymbolicLink = fileStats.isSymbolicLink();
        let fileFolderSize = fileStats.size;
        if (isDirectory) {
          // eslint-disable-next-line no-await-in-loop
          fileFolderSize = await IOUtils.getFolderSize(`${filepath}/${file}`);
        }
        const detailedFile = {
          name: file,
          size: fileFolderSize, // bytes
          isDirectory,
          isFile,
          isSymbolicLink,
          createdAt: fileStats.birthtime,
          modifiedAt: fileStats.mtime,
        };
        filesWithDetails.push(detailedFile);
      }
      const resultsResponse = messageHelper.createDataMessage(filesWithDetails);
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To create a folder
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function createAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${folder}`;
      } else {
        throw new Error('Application volume not found');
      }
      const cmd = `sudo mkdir "${filepath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      const resultsResponse = messageHelper.createSuccessMessage('Folder Created');
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To rename a file or folder. Oldpath is relative path to default fluxshare directory; newname is just a new name of folder/file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function renameAppsObject(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { oldpath } = req.params;
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      oldpath = oldpath || req.query.oldpath;
      if (!oldpath) {
        throw new Error('No file nor folder to rename specified');
      }
      let { newname } = req.params;
      newname = newname || req.query.newname;
      if (!newname) {
        throw new Error('No new name specified');
      }
      if (newname.includes('/')) {
        throw new Error('New name is invalid');
      }
      // stop sharing of ALL files that start with the path
      const fileURI = encodeURIComponent(oldpath);
      let oldfullpath;
      let newfullpath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        oldfullpath = `${appVolumePath[0].mount}/appdata/${oldpath}`;
        newfullpath = `${appVolumePath[0].mount}/appdata/${newname}`;
      } else {
        throw new Error('Application volume not found');
      }
      const fileURIArray = fileURI.split('%2F');
      fileURIArray.pop();
      if (fileURIArray.length > 0) {
        const renamingFolder = fileURIArray.join('/');
        newfullpath = `${appVolumePath[0].mount}/appdata/${renamingFolder}/${newname}`;
      }
      const cmd = `sudo mv -T "${oldfullpath}" "${newfullpath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      const response = messageHelper.createSuccessMessage('Rename successful');
      res.json(response);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To remove a specified shared file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function removeAppsObject(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { object } = req.params;
      object = object || req.query.object;
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!component) {
        throw new Error('component parameter is mandatory');
      }
      if (!object) {
        throw new Error('No object specified');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${object}`;
      } else {
        throw new Error('Application volume not found');
      }
      const cmd = `sudo rm -rf "${filepath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      const response = messageHelper.createSuccessMessage('File Removed');
      res.json(response);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To download a zip folder for a specified directory. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {boolean} authorized False until verified as an admin.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function downloadAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder;
      let { component } = req.params;
      component = component || req.query.component;
      if (!folder || !component) {
        const errorResponse = messageHelper.createErrorMessage('folder and component parameters are mandatory');
        res.json(errorResponse);
        return;
      }
      let folderpath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        folderpath = `${appVolumePath[0].mount}/appdata/${folder}`;
      } else {
        throw new Error('Application volume not found');
      }
      const zip = archiver('zip');
      const sizeStream = new PassThrough();
      let compressedSize = 0;
      sizeStream.on('data', (chunk) => {
        compressedSize += chunk.length;
      });
      sizeStream.on('end', () => {
        const folderNameArray = folderpath.split('/');
        const folderName = folderNameArray[folderNameArray.length - 1];
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-disposition': `attachment; filename=${folderName}.zip`,
          'Content-Length': compressedSize,
        });
        // Now, pipe the compressed data to the response stream
        const zipFinal = archiver('zip');
        zipFinal.pipe(res);
        zipFinal.directory(folderpath, false);
        zipFinal.finalize();
      });
      zip.pipe(sizeStream);
      zip.directory(folderpath, false);
      zip.finalize();
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To download a specified file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function downloadAppsFile(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      let { component } = req.params;
      component = component || req.query.component;
      if (!file || !component) {
        const errorResponse = messageHelper.createErrorMessage('file and component parameters are mandatory');
        res.json(errorResponse);
        return;
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${file}`;
      } else {
        throw new Error('Application volume not found');
      }
      const cmd = `sudo chmod 777 "${filepath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      // beautify name
      const fileNameArray = filepath.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
      res.download(filepath, fileName);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function getAppPublicKey(fluxID, appName, blockHeight) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  const inputData = JSON.stringify({
    fluxID,
    appName,
    blockHeight,
  });
  const dataReturned = await benchmarkService.getPublicKey(inputData);
  const { status, data } = dataReturned;
  let publicKey = null;
  if (status === 'success') {
    const dataParsed = JSON.parse(data);
    publicKey = dataParsed.status === 'ok' ? dataParsed.publicKey : null;
    if (!publicKey) {
      throw new Error('Error getting public key to encrypt app enterprise content from SAS.');
    }
  } else {
    throw new Error('Error getting public key to encrypt app enterprise content.');
  }

  return publicKey;
}

/**
 * To get Public Key to Encrypt Enterprise Content.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {string} Key.
 */
async function getPublicKey(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res.json(errMessage);
      }

      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;
      appSpecification = serviceHelper.ensureObject(appSpecification);
      if (!appSpecification.owner || !appSpecification.name) {
        throw new Error('Input parameters missing.');
      }
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const publicKey = await getAppPublicKey(appSpecification.owner, appSpecification.name, daemonHeight);
      // respond with formatted specifications
      const response = messageHelper.createDataMessage(publicKey);
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
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

  syncthingApps,
  checkMyAppsAvailability,
  startMonitoringOfApps,
  stopMonitoringOfApps,
  startAppMonitoringAPI,
  stopAppMonitoringAPI,
  appMonitor, // Enhanced version
  monitorNodeStatus,

  // Re-exported from appSpecHelpers
  getChainTeamSupportAddressUpdates: appSpecHelpers.getChainTeamSupportAddressUpdates,
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
  // checkAppHWRequirements is defined below with custom implementation
  checkAppRequirements: hwRequirements.checkAppRequirements,
  nodeFullGeolocation: hwRequirements.nodeFullGeolocation,
  checkAppStaticIpRequirements: hwRequirements.checkAppStaticIpRequirements,
  checkAppGeolocationRequirements: hwRequirements.checkAppGeolocationRequirements,
  checkAppNodesRequirements: hwRequirements.checkAppNodesRequirements,

  // Re-exported from appController
  executeAppGlobalCommand: appController.executeAppGlobalCommand,
  appStart: (req, res) => appController.appStart(req, res, (appname) => appInspector.startAppMonitoring(appname, appsMonitored)),
  appStop: (req, res) => appController.appStop(req, res, (appname, deleteData) => appInspector.stopAppMonitoring(appname, deleteData, appsMonitored)),
  appRestart: (req, res) => appController.appRestart(req, res, (appname) => appInspector.startAppMonitoring(appname, appsMonitored), (appname, deleteData) => appInspector.stopAppMonitoring(appname, deleteData, appsMonitored)),
  appKill: (req, res) => appController.appKill(req, res),
  appPause: (req, res) => appController.appPause(req, res),
  appUnpause: (req, res) => appController.appUnpause(req, res),
  appDockerRestart: (req, res) => appController.appDockerRestart(req, res),
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
  startAppMonitoring: (appName) => appInspector.startAppMonitoring(appName, appsMonitored),
  stopAppMonitoring: (appName, deleteData) => appInspector.stopAppMonitoring(appName, deleteData, appsMonitored),
  listAppsImages: appInspector.listAppsImages,
  getAppsDOSState: appInspector.getAppsDOSState,
  checkApplicationsCpuUSage: () => appInspector.checkApplicationsCpuUSage(appsMonitored, installedApps),
  monitorSharedDBApps: () => appInspector.monitorSharedDBApps(installedApps, (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)), getGlobalState()),
  checkStorageSpaceForApps: () => appInspector.checkStorageSpaceForApps(installedApps, (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)), null, []),

  // Re-exported from appInstaller
  createAppVolume: appInstaller.createAppVolume,
  registerAppLocally: async (appSpecs, componentSpecs, res, test = false) => {
    // Sync global state before checking
    getGlobalState();

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

  // Re-exported from appUninstaller
  appUninstallHard: async (appName, appId, appSpecs, isComponent, res) =>
    appUninstaller.appUninstallHard(appName, appId, appSpecs, isComponent, res, (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored), receiveOnlySyncthingAppsCache),
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
  checkAppMessageExistence: messageVerifier.checkAppMessageExistence,
  checkAppTemporaryMessageExistence: messageVerifier.checkAppTemporaryMessageExistence,
  getAppsTemporaryMessages: messageVerifier.getAppsTemporaryMessages,
  getAppsPermanentMessages: messageVerifier.getAppsPermanentMessages,
  cleanupOldTemporaryMessages: messageStore.cleanupOldTemporaryMessages,

  // App Utilities
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

  // Chain Utilities
  getChainParamsPriceUpdates: chainUtilities.getChainParamsPriceUpdates,
  getChainTeamSupportAddressUpdates: chainUtilities.getChainTeamSupportAddressUpdates,

  // Message Verification
  verifyAppHash: messageVerifier.verifyAppHash,
  verifyAppMessageSignature: messageVerifier.verifyAppMessageSignature,
  verifyAppMessageUpdateSignature: messageVerifier.verifyAppMessageUpdateSignature,
  requestAppMessage: messageVerifier.requestAppMessage,
  requestAppsMessage: messageVerifier.requestAppsMessage,
  requestAppMessageAPI: messageVerifier.requestAppMessageAPI,
  storeAppInstallingErrorMessage: messageStore.storeAppInstallingErrorMessage,
  storeIPChangedMessage: messageStore.storeIPChangedMessage,
  storeAppRemovedMessage: messageStore.storeAppRemovedMessage,
  appHashHasMessage: messageVerifier.appHashHasMessage,
  appHashHasMessageNotFound: messageVerifier.appHashHasMessageNotFound,
  checkAndRequestApp: messageVerifier.checkAndRequestApp,
  checkAndRequestMultipleApps: messageVerifier.checkAndRequestMultipleApps,
  continuousFluxAppHashesCheck: async (force = false) => {
    try {
      if (continuousFluxAppHashesCheckRunning) {
        return;
      }

      // Check if checkAndSyncAppHashes is currently running
      if (checkAndSyncAppHashesRunning) {
        log.info('continuousFluxAppHashesCheck: checkAndSyncAppHashes is currently running, skipping this execution');
        return;
      }

      log.info('Requesting missing Flux App messages');
      continuousFluxAppHashesCheckRunning = true;
      const numberOfPeers = fluxNetworkHelper.getNumberOfPeers();
      if (numberOfPeers < 12) {
        log.info('Not enough connected peers to request missing Flux App messages');
        continuousFluxAppHashesCheckRunning = false;
        return;
      }

      const synced = await generalService.checkSynced();
      if (synced !== true) {
        log.info('Flux not yet synced');
        continuousFluxAppHashesCheckRunning = false;
        return;
      }

      if (firstContinuousFluxAppHashesCheckRun && !globalState.checkAndSyncAppHashesWasEverExecuted) {
        await checkAndSyncAppHashes();
      }

      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const queryHeight = { generalScannedHeight: { $gte: 0 } };
      const projectionHeight = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const scanHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, queryHeight, projectionHeight);
      if (!scanHeight) {
        throw new Error('Scanning not initiated');
      }
      const explorerHeight = serviceHelper.ensureNumber(scanHeight.generalScannedHeight);

      // get flux app hashes that do not have a message;
      const query = { message: false };
      const projection = {
        projection: {
          _id: 0,
          txid: 1,
          hash: 1,
          height: 1,
          value: 1,
          message: 1,
          messageNotFound: 1,
        },
      };
      const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
      // sort it by height, so we request oldest messages first
      results.sort((a, b) => a.height - b.height);
      let appsMessagesMissing = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const result of results) {
        if (!result.messageNotFound || force || firstContinuousFluxAppHashesCheckRun) { // most likely wrong data, if no message found. This attribute is cleaned every reconstructAppMessagesHashPeriod blocks so all nodes search again for missing messages
          let heightDifference = explorerHeight - result.height;
          if (heightDifference < 0) {
            heightDifference = 0;
          }
          let maturity = Math.round(heightDifference / config.fluxapps.blocksLasting);
          if (maturity > 12) {
            maturity = 16; // maturity of max 16 representing its older than 1 year. Old messages will only be searched 3 times, newer messages more oftenly
          }
          if (invalidMessages.find((message) => message.hash === result.hash && message.txid === result.txid)) {
            if (!force) {
              maturity = 30; // do not request known invalid messages.
            }
          }
          // every config.fluxapps.blocksLasting increment maturity by 2;
          let numberOfSearches = maturity;
          if (hashesNumberOfSearchs.has(result.hash)) {
            numberOfSearches = hashesNumberOfSearchs.get(result.hash) + 2; // max 10 tries
          }
          hashesNumberOfSearchs.set(result.hash, numberOfSearches);
          log.info(`Requesting missing Flux App message: ${result.hash}, ${result.txid}, ${result.height}`);
          if (numberOfSearches <= 20) { // up to 10 searches
            const appMessageInformation = {
              hash: result.hash,
              txid: result.txid,
              height: result.height,
              value: result.value,
            };
            appsMessagesMissing.push(appMessageInformation);
            if (appsMessagesMissing.length === 500) {
              log.info('Requesting 500 app messages');
              messageVerifier.checkAndRequestMultipleApps(appsMessagesMissing);
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(2 * 60 * 1000); // delay 2 minutes to give enough time to process all messages received
              appsMessagesMissing = [];
            }
          } else {
            // eslint-disable-next-line no-await-in-loop
            await messageVerifier.appHashHasMessageNotFound(result.hash); // mark message as not found
            hashesNumberOfSearchs.delete(result.hash); // remove from our map
          }
        }
      }
      if (appsMessagesMissing.length > 0) {
        log.info(`Requesting ${appsMessagesMissing.length} app messages`);
        messageVerifier.checkAndRequestMultipleApps(appsMessagesMissing);
      }
      continuousFluxAppHashesCheckRunning = false;
      firstContinuousFluxAppHashesCheckRun = false;
    } catch (error) {
      log.error(error);
      continuousFluxAppHashesCheckRunning = false;
      firstContinuousFluxAppHashesCheckRun = false;
    }
  },
  triggerAppHashesCheckAPI: async (req, res) => {
    try {
      // only flux team and node owner can do this
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }

      module.exports.continuousFluxAppHashesCheck(true);
      const resultsResponse = messageHelper.createSuccessMessage('Running check on missing application messages ');
      res.json(resultsResponse);
    } catch (error) {
      log.error(error);
      const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
      res.json(errMessage);
    }
  },

  // Image Management & Security
  verifyRepository: imageManager.verifyRepository,
  getBlockedRepositores: imageManager.getBlockedRepositores,
  getUserBlockedRepositores: imageManager.getUserBlockedRepositores,
  checkAppSecrets: imageManager.checkAppSecrets,
  checkApplicationImagesComplience: imageManager.checkApplicationImagesComplience,
  checkApplicationImagesBlocked: imageManager.checkApplicationImagesBlocked,
  checkApplicationsCompliance: () => imageManager.checkApplicationsCompliance(installedApps, (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored))),

  // Registry & Database Management
  getAppHashes: registryManager.getAppHashes,
  appLocation: registryManager.appLocation,
  appInstallingLocation: registryManager.appInstallingLocation,
  getAppsLocations: registryManager.getAppsLocations,
  getAppsLocation: registryManager.getAppsLocation,
  getAppInstallingLocation: registryManager.getAppInstallingLocation,
  getAppInstallingErrorsLocation: registryManager.getAppInstallingErrorsLocation,
  getAppsInstallingErrorsLocations: registryManager.getAppsInstallingErrorsLocations,
  getApplicationGlobalSpecifications: registryManager.getApplicationGlobalSpecifications,
  getApplicationLocalSpecifications: registryManager.getApplicationLocalSpecifications,
  getApplicationSpecifications: registryManager.getApplicationSpecifications,
  getApplicationSpecificationAPI: registryManager.getApplicationSpecificationAPI,
  updateApplicationSpecificationAPI: registryManager.updateApplicationSpecificationAPI,
  getApplicationOwnerAPI: registryManager.getApplicationOwnerAPI,
  getGlobalAppsSpecifications: registryManager.getGlobalAppsSpecifications,
  availableApps: registryManager.availableApps,
  checkApplicationRegistrationNameConflicts: registryManager.checkApplicationRegistrationNameConflicts,
  updateAppSpecifications: registryManager.updateAppSpecifications,
  updateAppSpecsForRescanReindex: registryManager.updateAppSpecsForRescanReindex,
  storeAppSpecificationInPermanentStorage: registryManager.storeAppSpecificationInPermanentStorage,
  removeAppSpecificationFromStorage: registryManager.removeAppSpecificationFromStorage,
  getAppSpecificationFromDb: registryManager.getAppSpecificationFromDb,
  getAllAppsInformation: registryManager.getAllAppsInformation,
  getInstalledApps: registryManager.getInstalledApps,
  getRunningApps: registryManager.getRunningApps,
  getAllGlobalApplications: registryManager.getAllGlobalApplications,
  expireGlobalApplications: registryManager.expireGlobalApplications,
  reindexGlobalAppsInformation: registryManager.reindexGlobalAppsInformation,
  reconstructAppMessagesHashCollection: registryManager.reconstructAppMessagesHashCollection,
  reconstructAppMessagesHashCollectionAPI: registryManager.reconstructAppMessagesHashCollectionAPI,

  // Advanced Workflows
  createAppVolume: advancedWorkflows.createAppVolume,
  softRegisterAppLocally: advancedWorkflows.softRegisterAppLocally,
  redeployAPI: advancedWorkflows.redeployAPI,
  checkFreeAppUpdate: appSpecHelpers.checkFreeAppUpdate,
  // verifyAppUpdateParameters moved to appValidator module
  stopSyncthingApp: advancedWorkflows.stopSyncthingApp,
  appendBackupTask: advancedWorkflows.appendBackupTask,
  appendRestoreTask: advancedWorkflows.appendRestoreTask,
  removeTestAppMount: advancedWorkflows.removeTestAppMount,
  testAppMount: advancedWorkflows.testAppMount,
  checkApplicationUpdateNameRepositoryConflicts: advancedWorkflows.checkApplicationUpdateNameRepositoryConflicts,
  forceAppRemovals: () => advancedWorkflows.forceAppRemovals(installedApps, listAllApps, registryManager.getApplicationGlobalSpecifications, (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored))),
  masterSlaveApps: () => {
    const https = require('https');
    return advancedWorkflows.masterSlaveApps(getGlobalState(), installedApps, listRunningApps, receiveOnlySyncthingAppsCache, backupInProgress, globalState.restoreInProgress, https);
  },
  trySpawningGlobalApplication: async () => {
    try {
      // how do we continue with this function?
      // we have globalapplication specifics list
      // check if we are synced
      const synced = await generalService.checkSynced();
      if (synced !== true) {
        log.info('Flux not yet synced');
        await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      if (!globalState.checkAndSyncAppHashesWasEverExecuted) {
        log.info('Flux checkAndSyncAppHashesWasEverExecuted not yet executed');
        await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      let isNodeConfirmed = false;
      isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
      if (!isNodeConfirmed) {
        log.info('Flux Node not Confirmed. Global applications will not be installed');
        globalState.fluxNodeWasNotConfirmedOnLastCheck = true;
        await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      if (globalState.firstExecutionAfterItsSynced === true) {
        log.info('Explorer Synced, checking for expired apps');
        await registryManager.expireGlobalApplications();
        globalState.firstExecutionAfterItsSynced = false;
        await advancedWorkflows.getPeerAppsInstallingErrorMessages();
      }

      if (globalState.fluxNodeWasAlreadyConfirmed && globalState.fluxNodeWasNotConfirmedOnLastCheck) {
        globalState.fluxNodeWasNotConfirmedOnLastCheck = false;
        setTimeout(() => {
          // after 125 minutes of running ok and to make sure we are connected for enough time for receiving all apps running on other nodes
          // 125 minutes should give enough time for node receive currently two times the apprunning messages
          module.exports.trySpawningGlobalApplication();
        }, 125 * 60 * 1000);
        return;
      }
      globalState.fluxNodeWasAlreadyConfirmed = true;

      const benchmarkResponse = await benchmarkService.getBenchmarks();
      if (benchmarkResponse.status === 'error') {
        log.info('FluxBench status Error. Global applications will not be installed');
        await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }
      if (benchmarkResponse.data.thunder) {
        log.info('Flux Node is a Fractus Storage Node. Global applications will not be installed');
        await serviceHelper.delay(24 * 3600 * 1000); // check again in one day as changing from and to only requires the restart of flux daemon
        module.exports.trySpawningGlobalApplication();
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
      const { globalAppsInformation } = require('./utils/appConstants');
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
        log.info('No installable application found');
        await serviceHelper.delay(30 * 60 * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }
      log.info(`trySpawningGlobalApplication - Found ${numberOfGlobalApps} apps that are missing instances on the network.`);

      let appToRun = null;
      let appToRunAux = null;
      let minInstances = null;
      let appHash = null;
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

        const runningApps = await listRunningApps();
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
          module.exports.trySpawningGlobalApplication();
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
          await serviceHelper.delay(5 * 60 * 1000);
          module.exports.trySpawningGlobalApplication();
          return;
        }
        const isArcane = Boolean(process.env.FLUXOS_PATH);
        if (appToRunAux.enterprise && !isArcane) {
          log.info(`trySpawningGlobalApplication - Application ${appToRun} can only install on ArcaneOS`);
          globalState.spawnErrorsLongerAppCache.set(appHash, '');
          await serviceHelper.delay(5 * 60 * 1000);
          module.exports.trySpawningGlobalApplication();
          return;
        }
      }

      globalState.trySpawningGlobalAppCache.set(appHash, '');
      log.info(`trySpawningGlobalApplication - App ${appToRun} hash: ${appHash}`);

      const installingAppErrorsList = await registryManager.appInstallingErrorsLocation(appToRun);
      if (installingAppErrorsList.find((app) => !app.expireAt && app.hash === appHash)) {
        globalState.spawnErrorsLongerAppCache.set(appHash, '');
        throw new Error(`trySpawningGlobalApplication - App ${appToRun} is marked as having errors on app installing errors locations.`);
      }

      runningAppList = await registryManager.appLocation(appToRun);

      const adjustedIP = myIP.split(':')[0]; // just IP address
      // check if app not running on this device
      if (runningAppList.find((document) => document.ip.includes(adjustedIP))) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already running on this Flux IP`);
        await serviceHelper.delay(30 * 60 * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }
      if (installingAppList.find((document) => document.ip.includes(adjustedIP))) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already being installed on this Flux IP`);
        await serviceHelper.delay(30 * 60 * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      // get app specifications
      const appSpecifications = await registryManager.getApplicationGlobalSpecifications(appToRun);
      if (!appSpecifications) {
        throw new Error(`trySpawningGlobalApplication - Specifications for application ${appToRun} were not found!`);
      }

      // eslint-disable-next-line no-restricted-syntax
      const dbopen = dbHelper.databaseConnection();
      const { localAppsInformation } = require('./utils/appConstants');
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
        await serviceHelper.delay(5 * 60 * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      // verify app compliance
      await imageManager.checkApplicationImagesComplience(appSpecifications).catch((error) => {
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

      const appPorts = appUtilities.getAppPorts(appSpecifications);
      // check port is not user blocked
      const fluxNetworkHelper = require('./fluxNetworkHelper');
      appPorts.forEach((port) => {
        const isUserBlocked = fluxNetworkHelper.isPortUserBlocked(port);
        if (isUserBlocked) {
          globalState.spawnErrorsLongerAppCache.set(appHash, '');
          throw new Error(`trySpawningGlobalApplication - Port ${port} is blocked by user. Installation aborted.`);
        }
      });

      // Check if ports are publicly available - critical for proper Flux network operation
      const portsPubliclyAvailable = await portManager.checkInstallingAppPortAvailable(appPorts);
      if (portsPubliclyAvailable === false) {
        log.error(`trySpawningGlobalApplication - Some of application ports of ${appSpecifications.name} are not available publicly. Installation aborted.`);
        await serviceHelper.delay(5 * 60 * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      // double check if app is installed on the number of instances requested
      runningAppList = await registryManager.appLocation(appToRun);
      installingAppList = await registryManager.appInstallingLocation(appToRun);
      if (runningAppList.length + installingAppList.length > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
        await serviceHelper.delay(5 * 60 * 1000);
        module.exports.trySpawningGlobalApplication();
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
        const sameIpRangeNode = runningAppList.find((location) => location.ip.includes(myIpWithoutPort.substring(0, secondLastIndex)));
        if (sameIpRangeNode) {
          log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already spawned on Fluxnode with same ip range`);
          await serviceHelper.delay(5 * 60 * 1000);
          module.exports.trySpawningGlobalApplication();
          return;
        }
        if (!appFromAppsToBeCheckedLater && !appFromAppsSyncthingToBeCheckedLater && runningAppList.length < 6) {
          // check if there are connectivity to all nodes
          const fluxNetworkHelper = require('./fluxNetworkHelper');
          // eslint-disable-next-line no-restricted-syntax
          for (const node of runningAppList) {
            const ip = node.ip.split(':')[0];
            const port = node.ip.split(':')[1] || '16127';
            // eslint-disable-next-line no-await-in-loop
            const isOpen = await fluxNetworkHelper.isPortOpen(ip, port);
            if (!isOpen) {
              log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and instance running on ${ip}:${port} is not reachable, possible conenctivity issue, will be installed in 30m if remaining missing instances`);
              const appToCheck = {
                timeToCheck: Date.now() + 0.45 * 60 * 60 * 1000,
                appName: appToRun,
                hash: appHash,
                required: minInstances,
              };
              globalState.appsSyncthingToBeCheckedLater.push(appToCheck);
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(5 * 60 * 1000);
              globalState.trySpawningGlobalAppCache.delete(appHash);
              module.exports.trySpawningGlobalApplication();
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
          await serviceHelper.delay(5 * 60 * 1000);
          module.exports.trySpawningGlobalApplication();
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
        await imageManager.verifyRepository(componentToInstall.repotag, { repoauth: componentToInstall.repoauth, architecture }).catch((error) => {
          globalState.spawnErrorsLongerAppCache.set(appHash, '');
          throw error;
        });
      }

      // triple check if app is installed on the number of instances requested
      runningAppList = await registryManager.appLocation(appToRun);
      installingAppList = await registryManager.appInstallingLocation(appToRun);
      if (runningAppList.length + installingAppList.length > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
        await serviceHelper.delay(5 * 60 * 1000);
        module.exports.trySpawningGlobalApplication();
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
      const fluxCommMessagesSender = require('./fluxCommunicationMessagesSender');
      await fluxCommMessagesSender.broadcastMessageToOutgoing(newAppInstallingMessage);
      await serviceHelper.delay(500);
      await fluxCommMessagesSender.broadcastMessageToIncoming(newAppInstallingMessage);

      await serviceHelper.delay(30 * 1000); // give it time so messages are propagated on the network

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
          await serviceHelper.delay(5 * 60 * 1000);
          module.exports.trySpawningGlobalApplication();
          return;
        }
      }

      // install the app
      let registerOk = false;
      try {
        registerOk = await module.exports.registerAppLocally(appSpecifications, null, null, false); // can throw
      } catch (error) {
        log.error(error);
        registerOk = false;
      }
      if (!registerOk) {
        log.info('trySpawningGlobalApplication - Error on registerAppLocally');
        await serviceHelper.delay(5 * 60 * 1000);
        module.exports.trySpawningGlobalApplication();
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
          globalState.trySpawningGlobalAppCache.delete(appHash);
          module.exports.removeAppLocally(appSpecifications.name, null, true, null, true).catch((error) => log.error(error));
        }
      }

      await serviceHelper.delay(30 * 60 * 1000);
      log.info('trySpawningGlobalApplication - Reinitiating possible app installation');
      module.exports.trySpawningGlobalApplication();
    } catch (error) {
      log.error(error);
      await serviceHelper.delay(5 * 60 * 1000);
      module.exports.trySpawningGlobalApplication();
    }
  },

  // System Integration
  systemArchitecture: systemIntegration.systemArchitecture,
  // Use the original business logic for checkAppHWRequirements that calls appsResources
  checkAppHWRequirements: async (appSpecs) => {
    // appSpecs has hdd, cpu and ram assigned to correct tier
    const tier = await generalService.nodeTier();
    const resourcesLocked = await appsResources();
    if (resourcesLocked.status !== 'success') {
      throw new Error('Unable to obtain locked system resources by Flux Apps. Aborting.');
    }

    const appHWrequirements = hwRequirements.totalAppHWRequirements(appSpecs, tier);
    const nodeSpecs = await hwRequirements.getNodeSpecs();
    const totalSpaceOnNode = nodeSpecs.ssdStorage;
    if (totalSpaceOnNode === 0) {
      throw new Error('Insufficient space on Flux Node to spawn an application');
    }
    const useableSpaceOnNode = totalSpaceOnNode * 0.95 - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;
    const hddLockedByApps = resourcesLocked.data.appsHddLocked;
    const availableSpaceForApps = useableSpaceOnNode - hddLockedByApps;
    // bigger or equal so we have the 1 gb free...
    if (appHWrequirements.hdd > availableSpaceForApps) {
      throw new Error('Insufficient space on Flux Node to spawn an application');
    }

    const totalCpuOnNode = nodeSpecs.cpuCores * 10;
    const useableCpuOnNode = totalCpuOnNode - config.lockedSystemResources.cpu;
    const cpuLockedByApps = resourcesLocked.data.appsCpusLocked * 10;
    const adjustedAppCpu = appHWrequirements.cpu * 10;
    const availableCpuForApps = useableCpuOnNode - cpuLockedByApps;
    if (adjustedAppCpu > availableCpuForApps) {
      throw new Error('Insufficient CPU power on Flux Node to spawn an application');
    }

    const totalRamOnNode = nodeSpecs.ram;
    const useableRamOnNode = totalRamOnNode - config.lockedSystemResources.ram;
    const ramLockedByApps = resourcesLocked.data.appsRamLocked;
    const availableRamForApps = useableRamOnNode - ramLockedByApps;
    if (appHWrequirements.ram > availableRamForApps) {
      throw new Error('Insufficient RAM on Flux Node to spawn an application');
    }
    return true;
  },
  createFluxNetworkAPI: systemIntegration.createFluxNetworkAPI,

  // State Management Functions
  removalInProgressReset: globalState.removalInProgressReset,
  setRemovalInProgressToTrue: globalState.setRemovalInProgressToTrue,
  installationInProgressReset: globalState.installationInProgressReset,
  setInstallationInProgressTrue: globalState.setInstallationInProgressTrue,
  checkAndRemoveApplicationInstance: advancedWorkflows.checkAndRemoveApplicationInstance,
  reinstallOldApplications: advancedWorkflows.reinstallOldApplications,

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

  // Critical API functions
  installAppLocally: appInstaller.installAppLocally,
  testAppInstall: appInstaller.testAppInstall,
  updateAppGlobalyApi: advancedWorkflows.updateAppGlobalyApi,
  getAppPrice: appSpecHelpers.getAppPrice,
  getAppFiatAndFluxPrice: appSpecHelpers.getAppFiatAndFluxPrice,
  verifyAppRegistrationParameters: appValidator.verifyAppRegistrationParameters,
  verifyAppUpdateParameters: appValidator.verifyAppUpdateParameters,
  checkDockerAccessibility: imageManager.checkDockerAccessibility,
  deploymentInformation,
  registrationInformation: registryManager.registrationInformation,

  // Added API functions from parent branch
  getAppSpecsUSDPrice,
  getlatestApplicationSpecificationAPI,
  registerAppGlobalyApi,
  reindexGlobalAppsLocationAPI,
  reindexGlobalAppsInformationAPI,
  rescanGlobalAppsInformationAPI,
  getApplicationOriginalOwner,
  getAppsInstallingLocations,
  getAppsFolder,
  createAppsFolder,
  renameAppsObject,
  removeAppsObject,
  downloadAppsFolder,
  downloadAppsFile,
  getPublicKey,
  appLocation,
};