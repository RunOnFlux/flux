const config = require('config');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
// eslint-disable-next-line import/no-extraneous-dependencies
const nodecmd = require('node-cmd');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const {
  outgoingPeers, incomingPeers,
} = require('../utils/establishedConnections');
const serviceHelper = require('../serviceHelper');
const dbHelper = require('../dbHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const dockerService = require('../dockerService');
const generalService = require('../generalService');
const upnpService = require('../upnpService');
const networkStateService = require('../networkStateService');
const fluxHttpTestServer = require('../utils/fluxHttpTestServer');
const log = require('../../lib/log');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const cacheManager = require('../utils/cacheManager').default;

const fluxDirPath = path.join(__dirname, '../../../../');
// ToDo: Fix all the string concatenation in this file and use path.join()
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');

const cmdAsync = util.promisify(nodecmd.run);
const dockerStatsStreamPromise = util.promisify(dockerService.dockerContainerStatsStream);

const scannedHeightCollection = config.database.daemon.collections.scannedHeight;

const localAppsInformation = config.database.appslocal.collections.appsInformation;
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

const isArcane = Boolean(process.env.FLUXOS_PATH);

const failedNodesTestPortsCache = cacheManager.testPortsCache;

const nodeSpecs = {
  cpuCores: 0,
  ram: 0,
  ssdStorage: 0,
};

const appsMonitored = {
  // appsMonitored Object Examples:
  // component1_appname2: { // >= 4 or name for <= 3
  //   oneMinuteInterval: null, // interval
  //   fifteenMinInterval: null, // interval
  //   oneMinuteStatsStore: [ // stores last hour of stats of app measured every minute
  //     { // object of timestamp, data
  //       timestamp: 0,
  //       data: { },
  //     },
  //   ],
  //   fifteenMinStatsStore: [ // stores last 24 hours of stats of app measured every 15 minutes
  //     { // object of timestamp, data
  //       timestamp: 0,
  //       data: { },
  //     },
  //   ],
  // },
};

// Variables for checkMyAppsAvailability
let testingPort = null;
let originalPortFailed = null;
let lastUPNPMapFailed = false;
let nextTestingPort = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
const portsNotWorking = new Set();

/**
 * To show resource usage statistics for an app's Docker container. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appMonitor(req, res) {
  try {
    let { appname, range } = req.params;
    appname = appname || req.query.appname;
    range = range || req.query.range || null;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    if (range !== null) {
      range = parseInt(range, 10);
      if (!Number.isInteger(range) || range <= 0) {
        throw new Error('Invalid range value. It must be a positive integer or null.');
      }
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      if (appsMonitored[appname]) {
        let appStatsMonitoring = appsMonitored[appname].statsStore;
        if (range) {
          const now = Date.now();
          const cutoffTimestamp = now - range;
          const hoursInMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
          appStatsMonitoring = appStatsMonitoring.filter((stats) => stats.timestamp >= cutoffTimestamp);
          if (range > hoursInMs) {
            appStatsMonitoring = appStatsMonitoring.filter((_, index, array) => index % 20 === 0 || index === array.length - 1); // keep always last entry
          }
        }
        const appResponse = messageHelper.createDataMessage(appStatsMonitoring);
        res.json(appResponse);
      } else throw new Error('No data available');
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

/**
 * To show resource usage statistics for an app's Docker container. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appMonitorStream(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      await dockerStatsStreamPromise(appname, req, res);
      res.end();
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

/**
 * Returns folder size in byes of application component
 * @param {object} appName monitored component name
 */
async function getAppFolderSize(appName) {
  try {
    const appsDirPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
    const directoryPath = path.join(appsDirPath, appName);
    const exec = `sudo du -s --block-size=1 ${directoryPath}`;
    const cmdres = await cmdAsync(exec);
    const size = serviceHelper.ensureString(cmdres).split('\t')[0] || 0;
    return size;
  } catch (error) {
    log.error(error);
    return 0;
  }
}

/**
 * Retrieves the storage usage of a specified Docker container, including bind mounts and volume mounts.
 * @param {string} appName The name of the Docker container to inspect.
 * @returns {Promise<object>} An object containing the sizes of bind mounts, volume mounts, root filesystem, total used storage, and status.
 *   - bind: Size of bind mounts in bytes.
 *   - volume: Size of volume mounts in bytes.
 *   - rootfs: Size of the container's root filesystem in bytes.
 *   - used: Total used size (sum of bind, volume, and rootfs sizes) in bytes.
 *   - status: 'success' if the operation succeeded, 'error' otherwise.
 *   - message: An error message if the operation failed.
 */
async function getContainerStorage(appName) {
  try {
    const containerInfo = await dockerService.dockerContainerInspect(appName, { size: true });
    let bindMountsSize = 0;
    let volumeMountsSize = 0;
    const containerRootFsSize = serviceHelper.ensureNumber(containerInfo.SizeRootFs) || 0;
    if (containerInfo?.Mounts?.length) {
      await Promise.all(containerInfo.Mounts.map(async (mount) => {
        let source = mount?.Source;
        const mountType = mount?.Type;
        if (source) {
          if (mountType === 'bind') {
            source = source.replace('/appdata', '');
            const exec = `sudo du -sb ${source}`;
            const mountInfo = await cmdAsync(exec);
            if (mountInfo) {
              const sizeNum = serviceHelper.ensureNumber(mountInfo.split('\t')[0]) || 0;
              bindMountsSize += sizeNum;
            } else {
              log.warn(`No mount info returned for source: ${source}`);
            }
          } else if (mountType === 'volume') {
            const exec = `sudo du -sb ${source}`;
            const mountInfo = await cmdAsync(exec);
            if (mountInfo) {
              const sizeNum = serviceHelper.ensureNumber(mountInfo.split('\t')[0]) || 0;
              volumeMountsSize += sizeNum;
            } else {
              log.warn(`No mount info returned for source: ${source}`);
            }
          } else {
            log.warn(`Unsupported mount type or source: Type: ${mountType}, Source: ${source}`);
          }
        }
      }));
    }
    const usedSize = bindMountsSize + volumeMountsSize + containerRootFsSize;
    return {
      bind: bindMountsSize,
      volume: volumeMountsSize,
      rootfs: containerRootFsSize,
      used: usedSize,
      status: 'success',
    };
  } catch (error) {
    log.error(`Error fetching container storage: ${error.message}`);
    return {
      bind: 0,
      volume: 0,
      rootfs: 0,
      used: 0,
      status: 'error',
      message: error.message,
    };
  }
}

/**
 * Starts app monitoring for a single app and saves monitoring data in-memory to the appsMonitored object.
 * @param {object} appName monitored component name
 */
function startAppMonitoring(appName) {
  if (!appName) {
    throw new Error('No App specified');
  } else {
    log.info('Initialize Monitoring...');
    appsMonitored[appName] = {}; // Initialize the app's monitoring object
    if (!appsMonitored[appName].statsStore) {
      appsMonitored[appName].statsStore = [];
    }
    if (!appsMonitored[appName].lastHourstatsStore) {
      appsMonitored[appName].lastHourstatsStore = [];
    }
    // Clear previous interval for this app to prevent multiple intervals
    clearInterval(appsMonitored[appName].oneMinuteInterval);
    appsMonitored[appName].run = 0;
    appsMonitored[appName].oneMinuteInterval = setInterval(async () => {
      try {
        if (!appsMonitored[appName]) {
          log.error(`Monitoring of ${appName} already stopped`);
          return;
        }
        const dockerContainer = await dockerService.getDockerContainerOnly(appName);
        if (!dockerContainer) {
          log.error(`Monitoring of ${appName} not possible. App does not exist. Forcing stopping of monitoring`);
          // eslint-disable-next-line no-use-before-define
          stopAppMonitoring(appName, true);
          return;
        }
        appsMonitored[appName].run += 1;
        const statsNow = await dockerService.dockerContainerStats(appName);
        const containerStorageInfo = await getContainerStorage(appName);
        statsNow.disk_stats = containerStorageInfo;
        const now = Date.now();
        if (appsMonitored[appName].run % 3 === 0) {
          const inspect = await dockerService.dockerContainerInspect(appName);
          statsNow.nanoCpus = inspect.HostConfig.NanoCpus;
          appsMonitored[appName].statsStore.push({ timestamp: now, data: statsNow });
          const statsStoreSizeInBytes = new TextEncoder().encode(JSON.stringify(appsMonitored[appName].statsStore)).length;
          const estimatedSizeInMB = statsStoreSizeInBytes / (1024 * 1024);
          log.info(`Size of stats for ${appName}: ${estimatedSizeInMB.toFixed(2)} MB`);
          appsMonitored[appName].statsStore = appsMonitored[appName].statsStore.filter(
            (stat) => now - stat.timestamp <= 7 * 24 * 60 * 60 * 1000,
          );
        }
        appsMonitored[appName].lastHourstatsStore.push({ timestamp: now, data: statsNow });
        appsMonitored[appName].lastHourstatsStore = appsMonitored[appName].lastHourstatsStore.filter(
          (stat) => now - stat.timestamp <= 60 * 60 * 1000,
        );
      } catch (error) {
        log.error(error);
      }
    }, 1 * 60 * 1000);
  }
}

/**
 * Stops app monitoring for a single app.
 * @param {object} appName App specifications.
 * @param {boolean} deleteData Delete monitored data
 */
// At any stage after the monitoring is started, trigger stop on demand without loosing data (unless delete data is chosen)
function stopAppMonitoring(appName, deleteData) {
  if (appsMonitored[appName]) {
    clearInterval(appsMonitored[appName].oneMinuteInterval);
  }
  if (deleteData) {
    delete appsMonitored[appName];
  }
}

/**
 * Starts app monitoring for all apps.
 * @param {array} appSpecsToMonitor Array of application specs to be monitored
 */
async function startMonitoringOfApps(appSpecsToMonitor) {
  try {
    let apps = appSpecsToMonitor;
    if (!apps) {
            const installedAppsRes = await appFileService.installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      apps = installedAppsRes.data;
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        startAppMonitoring(app.name);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          startAppMonitoring(monitoredName);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Stops app monitoring for all apps.
 * @param {array} appSpecsToMonitor Array of application specs to be stopped for monitor
 */
async function stopMonitoringOfApps(appSpecsToMonitor, deleteData = false) {
  try {
    let apps = appSpecsToMonitor;
    if (!apps) {
            const installedAppsRes = await appFileService.installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      apps = installedAppsRes.data;
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        stopAppMonitoring(app.name, deleteData);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          stopAppMonitoring(monitoredName, deleteData);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * API call to start app monitoring and save monitoring data in-memory to the appsMonitored object. Monitors all apps or a single app if its name is specified in the API request.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function startAppMonitoringAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) { // If no appname specified, monitor all apps
      // only flux team and node owner can do this
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      // this should not be started if some monitoring is already running. Stop all monitoring before
      await stopMonitoringOfApps();
      await startMonitoringOfApps();
      const monitoringResponse = messageHelper.createSuccessMessage('Application monitoring started for all apps');
      res.json(monitoringResponse);
    } else {
      const mainAppName = appname.split('_')[1] || appname;
      const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
            const installedAppsRes = await appFileService.installedApps(mainAppName);
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      const apps = installedAppsRes.data;
      const appSpecs = apps[0];
      if (!appSpecs) {
        throw new Error(`Application ${mainAppName} is not installed`);
      }
      if (mainAppName === appname) {
        await stopMonitoringOfApps([appSpecs]);
        await startMonitoringOfApps([appSpecs]);
      } else { // component based or <= 3
        stopAppMonitoring(appname);
        startAppMonitoring(appname);
      }
      const monitoringResponse = messageHelper.createSuccessMessage(`Application monitoring started for ${appSpecs.name}`);
      res.json(monitoringResponse);
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
 * API call to stop app monitoring. Applies to all apps or a single app if its name is specified in the API request. Maintains existing monitoring data or deletes existing monitoring data if specified in the API request.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function stopAppMonitoringAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { deletedata } = req.params;
    deletedata = deletedata || req.query.deletedata || false;
    // 1. Stop all apps
    if (!appname) {
      // only flux team and node owner can do this
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      await stopMonitoringOfApps();
      let successMessage = '';
      if (!deletedata) {
        successMessage = 'Application monitoring stopped for all apps. Existing monitoring data maintained.';
      } else {
        successMessage = 'Application monitoring stopped for all apps. Monitoring data deleted for all apps.';
      }
      const monitoringResponse = messageHelper.createSuccessMessage(successMessage);
      res.json(monitoringResponse);
      // 2. Stop a specific app
    } else {
      const mainAppName = appname.split('_')[1] || appname;
      const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      let successMessage = '';
      if (mainAppName === appname) {
        // get appSpecs
        const installedAppsRes = await appFileService.installedApps(mainAppName);
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
        stopAppMonitoring(appname, deletedata);
      }
      if (deletedata) {
        successMessage = `Application monitoring stopped and monitoring data deleted for ${appname}.`;
      } else {
        successMessage = `Application monitoring stopped for ${appname}. Existing monitoring data maintained.`;
      }
      const monitoringResponse = messageHelper.createSuccessMessage(successMessage);
      res.json(monitoringResponse);
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
 * Created for testing purposes - sets appMonitored
 *
 * @param {object} appData
 */
function setAppsMonitored(appData) {
  appsMonitored[appData.appName] = appData;
}

/**
 * Created for testing purposes - gets appMonitored
 */
function getAppsMonitored() {
  return appsMonitored;
}

/**
 * Created for testing purposes - clears appMonitored
 *
 * @param {object} appData
 */
function clearAppsMonitored() {
  // eslint-disable-next-line no-restricted-syntax
  for (const prop of Object.getOwnPropertyNames(appsMonitored)) {
    delete appsMonitored[prop];
  }
}

/**
 * To show CPU usage of the node and app CPU usage. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function fluxUsage(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!result) {
      log.error('Scanning not initiated');
    }
    let explorerHeight = 999999999;
    if (result) {
      explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight) || 999999999;
    }
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const daemonHeight = syncStatus.data.height;
    let cpuCores = 0;
    const cpus = os.cpus();
    if (cpus) {
      cpuCores = cpus.length;
    }
    if (cpuCores > 8) {
      cpuCores = 8;
    }
    let cpuUsage = 0;
    if (explorerHeight < (daemonHeight - 5)) {
      // Initial scanning is in progress
      cpuUsage += 0.5;
    } else if (explorerHeight < daemonHeight) {
      cpuUsage += 0.25;
    } else {
      cpuUsage += 0.1; // normal load
    }
    cpuUsage *= cpuCores;

    // load usedResources of apps
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {};
    const appsProjection = { projection: { _id: 0 } };
    const appsResult = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    let appsCpusLocked = 0;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    const cpuTier = `cpu${tier}`;
    appsResult.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((component) => {
          if (component.tiered && tier) {
            appsCpusLocked += serviceHelper.ensureNumber(component[cpuTier] || component.cpu) || 0;
          } else {
            appsCpusLocked += serviceHelper.ensureNumber(component.cpu) || 0;
          }
        });
      } else if (app.tiered && tier) {
        appsCpusLocked += serviceHelper.ensureNumber(app[cpuTier] || app.cpu) || 0;
      } else {
        appsCpusLocked += serviceHelper.ensureNumber(app.cpu) || 0;
      }
    });

    cpuUsage += appsCpusLocked;
    let fiveMinUsage = 0;
    const loadavg = os.loadavg();
    if (loadavg) {
      fiveMinUsage = serviceHelper.ensureNumber(loadavg[1]) || 0;
    }
    if (fiveMinUsage > cpuCores) {
      fiveMinUsage = cpuCores;
    }
    // do an average of fiveMinUsage and cpuUsage;
    const avgOfUsage = ((fiveMinUsage + cpuUsage) / 2).toFixed(8);
    const response = messageHelper.createDataMessage(avgOfUsage);
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
 * To show app resources locked (CPUs, RAM and HDD).
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
    const appsResult = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
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
 * To check if more than allowed instances of application are running
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkApplicationsCompliance() {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await appFileService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const appsToRemoveNames = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      // eslint-disable-next-line no-await-in-loop
      const isAppBlocked = await appValidationService.checkApplicationImagesBlocked(app);
      if (isAppBlocked) {
        if (!appsToRemoveNames.includes(app.name)) {
          appsToRemoveNames.push(app.name);
        }
      }
    }
    // remove appsToRemoveNames apps from locally running
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsToRemoveNames) {
      log.warn(`Application ${appName} is blacklisted, removing`);
      // eslint-disable-next-line no-await-in-loop
      await appInstallationService.removeAppLocally(appName, null, false, true, true);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(3 * 60 * 1000); // wait for 3 mins so we don't have more removals at the same time
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * check if app cpu is throttling
 */
async function checkApplicationsCpuUSage() {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await appFileService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    let stats;
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      if (app.version <= 3) {
        stats = appsMonitored[app.name].lastHourstatsStore;
        // eslint-disable-next-line no-await-in-loop
        const inspect = await dockerService.dockerContainerInspect(app.name);
        if (inspect && stats && stats.length > 4) {
          const nanoCpus = inspect.HostConfig.NanoCpus;
          let cpuThrottlingRuns = 0;
          let cpuThrottling = false;
          const cpuPercentage = nanoCpus / app.cpu / 1e9;
          // eslint-disable-next-line no-restricted-syntax
          for (const stat of stats) {
            const cpuUsage = stat.data.cpu_stats.cpu_usage.total_usage - stat.data.precpu_stats.cpu_usage.total_usage;
            const systemCpuUsage = stat.data.cpu_stats.system_cpu_usage - stat.data.precpu_stats.system_cpu_usage;
            const cpu = ((cpuUsage / systemCpuUsage) * stat.data.cpu_stats.online_cpus * 100) / app.cpu || 0;
            const realCpu = cpu / cpuPercentage;
            if (realCpu >= 92) {
              cpuThrottlingRuns += 1;
            }
          }
          if (cpuThrottlingRuns >= stats.length * 0.8) {
            // cpu was high on 80% of the checks
            cpuThrottling = true;
          }
          appsMonitored[app.name].lastHourstatsStore = [];
          log.info(`checkApplicationsCpuUSage ${app.name} cpu high load: ${cpuThrottling}`);
          log.info(`checkApplicationsCpuUSage ${cpuPercentage}`);
          if (cpuThrottling && app.cpu > 1) {
            if (cpuPercentage === 1) {
              if (app.cpu > 2) {
                // eslint-disable-next-line no-await-in-loop
                await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.8));
              } else {
                // eslint-disable-next-line no-await-in-loop
                await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.9));
              }
              log.info(`checkApplicationsCpuUSage ${app.name} lowering cpu.`);
            }
          } else if (cpuPercentage <= 0.8) {
            // eslint-disable-next-line no-await-in-loop
            await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.85));
            log.info(`checkApplicationsCpuUSage ${app.name} increasing cpu 85.`);
          } else if (cpuPercentage <= 0.85) {
            // eslint-disable-next-line no-await-in-loop
            await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.9));
            log.info(`checkApplicationsCpuUSage ${app.name} increasing cpu 90.`);
          } else if (cpuPercentage <= 0.9) {
            // eslint-disable-next-line no-await-in-loop
            await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.95));
            log.info(`checkApplicationsCpuUSage ${app.name} increasing cpu 95.`);
          } else if (cpuPercentage < 1) {
            // eslint-disable-next-line no-await-in-loop
            await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9));
            log.info(`checkApplicationsCpuUSage ${app.name} increasing cpu 100.`);
          }
        }
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of app.compose) {
          stats = appsMonitored[`${appComponent.name}_${app.name}`].lastHourstatsStore;
          // eslint-disable-next-line no-await-in-loop
          const inspect = await dockerService.dockerContainerInspect(`${appComponent.name}_${app.name}`);
          if (inspect && stats && stats.length > 4) {
            const nanoCpus = inspect.HostConfig.NanoCpus;
            let cpuThrottlingRuns = 0;
            let cpuThrottling = false;
            const cpuPercentage = nanoCpus / appComponent.cpu / 1e9;
            // eslint-disable-next-line no-restricted-syntax
            for (const stat of stats) {
              const cpuUsage = stat.data.cpu_stats.cpu_usage.total_usage - stat.data.precpu_stats.cpu_usage.total_usage;
              const systemCpuUsage = stat.data.cpu_stats.system_cpu_usage - stat.data.precpu_stats.system_cpu_usage;
              const cpu = ((cpuUsage / systemCpuUsage) * 100 * stat.data.cpu_stats.online_cpus) / appComponent.cpu || 0;
              const realCpu = cpu / cpuPercentage;
              if (realCpu >= 92) {
                cpuThrottlingRuns += 1;
              }
            }
            if (cpuThrottlingRuns >= stats.length * 0.8) {
              // cpu was high on 80% of the checks
              cpuThrottling = true;
            }
            appsMonitored[`${appComponent.name}_${app.name}`].lastHourstatsStore = [];
            log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} cpu high load: ${cpuThrottling}`);
            log.info(`checkApplicationsCpuUSage ${cpuPercentage}`);
            if (cpuThrottling && appComponent.cpu > 1) {
              if (cpuPercentage === 1) {
                if (appComponent.cpu > 2) {
                  // eslint-disable-next-line no-await-in-loop
                  await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.8));
                } else {
                  // eslint-disable-next-line no-await-in-loop
                  await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.9));
                }
                log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} lowering cpu.`);
              }
            } else if (cpuPercentage <= 0.8) {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.85));
              log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} increasing cpu 85.`);
            } else if (cpuPercentage <= 0.85) {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.9));
              log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} increasing cpu 90.`);
            } else if (cpuPercentage <= 0.9) {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.95));
              log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} increasing cpu 95.`);
            } else if (cpuPercentage < 1) {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9));
              log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} increasing cpu 100.`);
            }
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To find and remove apps that are spawned more than maximum number of instances allowed locally.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkAndRemoveApplicationInstance() {
  // To check if more than allowed instances of application are running
  // check if synced
  try {
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Application duplication removal paused. Not yet synced');
      return;
    }

    // get list of locally installed apps.
    const installedAppsRes = await appFileService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled) {
      // eslint-disable-next-line no-await-in-loop
      const runningAppList = await appContainerService.appLocation(installedApp.name);
      const minInstances = installedApp.instances || config.fluxapps.minimumInstances; // introduced in v3 of apps specs
      if (runningAppList.length > minInstances) {
        // eslint-disable-next-line no-await-in-loop
        const appDetails = await appGlobalService.getApplicationGlobalSpecifications(installedApp.name);
        if (appDetails) {
          log.info(`Application ${installedApp.name} is already spawned on ${runningAppList.length} instances. Checking if should be unninstalled from the FluxNode..`);
          runningAppList.sort((a, b) => {
            if (!a.runningSince && b.runningSince) {
              return 1;
            }
            if (a.runningSince && !b.runningSince) {
              return -1;
            }
            if (a.runningSince < b.runningSince) {
              return 1;
            }
            if (a.runningSince > b.runningSince) {
              return -1;
            }
            if (a.ip < b.ip) {
              return 1;
            }
            if (a.ip > b.ip) {
              return -1;
            }
            return 0;
          });
          // eslint-disable-next-line no-await-in-loop
          const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
          if (myIP) {
            const index = runningAppList.findIndex((x) => x.ip === myIP);
            if (index === 0) {
              log.info(`Application ${installedApp.name} going to be removed from node as it was the latest one running it to install it..`);
              log.warn(`Removing application ${installedApp.name} locally`);
              // eslint-disable-next-line no-await-in-loop
              await appInstallationService.removeAppLocally(installedApp.name, null, false, true, true);
              log.warn(`Application ${installedApp.name} locally removed`);
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(config.fluxapps.removal.delay * 1000); // wait for 6 mins so we don't have more removals at the same time
            }
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Function to monitor shared database apps
 */
async function monitorSharedDBApps() {
  try {
    // do not run if installationInProgress or removalInProgress
    if (appProgressState.removalInProgress || appProgressState.installationInProgress) {
      return;
    }
    // get list of all installed apps
    const appsInstalled = await appFileService.installedApps();

    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data.filter((app) => app.version > 3)) {
      const componentUsingSharedDB = installedApp.compose.find((comp) => comp.repotag.includes('runonflux/shared-db'));
      if (componentUsingSharedDB) {
        log.info(`monitorSharedDBApps: Found app ${installedApp.name} using sharedDB`);
        if (componentUsingSharedDB.ports && componentUsingSharedDB.ports.length > 0) {
          const apiPort = componentUsingSharedDB.ports[componentUsingSharedDB.ports.length - 1]; // it's the last port from the shareddb that is the api port
          // eslint-disable-next-line no-await-in-loop
          const url = `http://localhost:${apiPort}/status`;
          log.info(`monitorSharedDBApps: ${installedApp.name} going to check operator status on url ${url}`);
          // eslint-disable-next-line no-await-in-loop
          const operatorStatus = await serviceHelper.axiosGet(url).catch((error) => log.error(`monitorSharedDBApps: ${installedApp.name} operatorStatus error: ${error}`));
          if (operatorStatus && operatorStatus.data) {
            if (operatorStatus.data.status === 'UNINSTALL') {
              log.info(`monitorSharedDBApps: ${installedApp.name} operatorStatus is UNINSTALL, going to uninstall the app`);
              // eslint-disable-next-line no-await-in-loop
              await appInstallationService.removeAppLocally(installedApp.name, null, true, false, true);
            } else {
              log.info(`monitorSharedDBApps: ${installedApp.name} operatorStatus is ${operatorStatus.data.status}`);
            }
          } else {
            log.info(`monitorSharedDBApps: ${installedApp.name} operatorStatus is not set`);
          }
        }
      }
    }
  } catch (error) {
    log.error(`monitorSharedDBApps: ${error}`);
  } finally {
    await serviceHelper.delay(5 * 60 * 1000);
    monitorSharedDBApps();
  }
}

async function signCheckAppData(message) {
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey();
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

/**
 *
 * @param {Number} testingPort The target port
 * @param {http.Server} testHttpServer The test http server
 * @param {{skipFirewall?: Boolean, skipUpnp?: Boolean, skipHttpServer?: Boolean}} options Options
 */
async function handleTestShutdown(testingPort, testHttpServer, options = {}) {
  const skipFirewall = options.skipFirewall || false;
  const skipUpnp = options.skipUpnp || false;
  const skipHttpServer = options.skipHttpServer || false;

  // fail open on the firewall check
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

/**
 * Function to check app availability
 */
async function checkMyAppsAvailability() {
  /**
   * default timeout = 1h     - Normal state  \
   * error timeout = 60s      - Something unexpected happened  \
   * failure timeout = 15s    - Our port testing failed  \
   * dos timeout = 5m         - We're DOS  \
   * app error = 4m           - Something on the fluxNode is broken
   */
  const timeouts = {
    default: 3_600_000,
    error: 60_000,
    failure: 15_000,
    dos: 300_000,
    appError: 240_000,
  };

  /**
   * dos              - Dos is a number between 0-100. The threshold is the upper limit
   * ports high edge  - The upper limit after which the dos counter will increment
   * ports low edge   - The lower limit after which the node can resume normal state
   */
  const thresholds = {
    dos: 100,
    portsHighEdge: 100,
    portsLowEdge: 80,
  };

  if (appDOSState.dosMountMessage || appDOSState.dosDuplicateAppMessage) {
    appDOSState.dosMessage = appDOSState.dosMountMessage || appDOSState.dosDuplicateAppMessage;
    appDOSState.dosState = thresholds.dos;

    await serviceHelper.delay(timeouts.appError);
    setImmediate(checkMyAppsAvailability);
    return;
  }

  const isUpnp = upnpService.isUPNP();
  const testHttpServer = new fluxHttpTestServer.FluxHttpTestServer();

  /**
   * Sets the next port if we come across a port that is banned or excluded etc
   *
   * @returns {void}
   */
  const setNextPort = () => {
    if (originalPortFailed && testingPort > originalPortFailed) {
      nextTestingPort = originalPortFailed - 1;
    } else {
      nextTestingPort = null;
      originalPortFailed = null;
    }
  };

  /**
   * Picks a random port from the existing set of not working ports
   *
   * @returns {Array} The array of not working ports. Just so any caller
   * doesn't have to convert to an Array
   */
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

    const installedAppsRes = await appFileService.installedApps();
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
      log.info(
        `checkMyAppsAvailability - Testing port ${testingPort} is banned`,
      );

      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    if (isUpnp) {
      const isPortUpnpBanned = fluxNetworkHelper.isPortUPNPBanned(testingPort);

      if (isPortUpnpBanned) {
        log.info(
          `checkMyAppsAvailability - Testing port ${testingPort} is UPNP banned`,
        );

        setNextPort();
        await serviceHelper.delay(timeouts.failure);
        setImmediate(checkMyAppsAvailability);
        return;
      }
    }

    const isPortUserBlocked = fluxNetworkHelper.isPortUserBlocked(testingPort);

    if (isPortUserBlocked) {
      log.info(
        `checkMyAppsAvailability - Testing port ${testingPort} is user blocked`,
      );

      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    if (appPorts.includes(testingPort)) {
      log.info(
        `checkMyAppsAvailability - Skipped checking ${testingPort} - in use`,
      );

      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const remoteSocketAddress = await networkStateService.getRandomSocketAddress(
      localSocketAddress,
    );

    if (!remoteSocketAddress) {
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    if (failedNodesTestPortsCache.has(remoteSocketAddress)) {
      // same as above. This is unlikley, just wait the 15 seconds
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const firewallActive = isArcane
      ? true
      : await fluxNetworkHelper.isFirewallActive();

    if (firewallActive) {
      await fluxNetworkHelper.allowPort(testingPort);
    }

    if (isUpnp) {
      const upnpMapResult = await upnpService.mapUpnpPort(
        testingPort,
        'Flux_Test_App',
      );

      // upnp dos takes precedence over both port dos and others
      if (!upnpMapResult) {
        if (lastUPNPMapFailed) {
          appDOSState.dosState += 4;
          if (appDOSState.dosState >= thresholds.dos) {
            appDOSState.dosMessage = 'Not possible to run applications on the node, '
              + 'router returning exceptions when creating UPNP ports mappings';
          }
        }
        lastUPNPMapFailed = true;
        log.info(
          `checkMyAppsAvailability - Testing port ${testingPort} `
          + 'failed to create UPnP mapping',
        );

        setNextPort();

        await handleTestShutdown(testingPort, testHttpServer, {
          skipFirewall: !firewallActive,
          skipUpnp: true,
          skipHttpServer: true,
        });

        // If we are failing mappings, we still need o fail 25 times before we go DOS.
        const upnpDelay = appDOSState.dosMessage ? timeouts.dos : timeouts.error;
        await serviceHelper.delay(upnpDelay);
        setImmediate(checkMyAppsAvailability);
        return;
      }

      lastUPNPMapFailed = false;
    }

    // Tested: This catches EADDRINUSE. Previously, this was crashing the entire app
    // note - if you kill the port with:
    //    ss --kill state listening src :<the port>
    // nodeJS does not raise an error.
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
      log.warn(`Unable to listen on port: ${testingPort}.Error: ${error}`);

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

    // The other end only waits 5 seconds anyway
    const timeout = 10_000;
    // we set an empty content-type header here. This is for when we fix
    // the api, that the checkappavailability call will work will old and new
    // nodes while we transition
    const axiosConfig = {
      timeout,
      headers: {
        'content-type': '',
      },
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
      .post(
        `http://${remoteIp}:${remotePort}/flux/checkappavailability`,
        JSON.stringify(data),
        axiosConfig,
      )
      .catch(() => {
        log.error(
          `checkMyAppsAvailability - ${remoteSocketAddress} `
          + 'for app availability is not reachable',
        );
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

    // at this point - testing is complete. Analyze the result and set up the
    // next test (if applicable)

    const {
      data: {
        status: responseStatus = null,
        data: { message: responseMessasge = 'No response' } = {
          message: 'No response',
        },
      },
    } = resMyAppAvailability;

    if (!['success', 'error'].includes(responseStatus)) {
      // we retry the same port but with another node
      log.warning('checkMyAppsAvailability - Unexpected response '
        + `status: ${responseStatus}`);

      await serviceHelper.delay(timeouts.error);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    /**
     * States
     *
     * Normal
     *   No broken ports, or broken ports less than 80 and a "good" port test
     * Normal - Rising edge
     *   I.e. broken ports increasing but threshold not reached. This state could
     *   also be considered normal, and could take many many hours to cross the threshold
     * Failed - Rising edge
     *   Threshold crossed. There are 100 ports in portsNotWorking. At this time the
     *   dosState starts rising 4 per fail. (takes 25 ports once in this state to DOS)
     * Failed - DOS
     *    There are 100 ports in the portsNotWorking array. 25 of those ports
     *   have failed a second time. Node is in DOS state.
     * Failed - Lowering edge
     *   Same as failed, however the node is now considered "working" and is removing
     *   ports from the portsNotWorking array. It will remain in this state until 20 ports
     *   have been removed from the portsNotWorking array. (hysteresis) Once this happens, the node
     *   is then considered in the "normal" state - and the portsNotWorking array is cleared
     */

    const portTestFailed = responseStatus === 'error';
    let waitMs = 0;

    if (portTestFailed && portsNotWorking.size < thresholds.portsHighEdge) {
      // Normal - Rising edge
      portsNotWorking.add(testingPort);

      if (!originalPortFailed) {
        originalPortFailed = testingPort;
        nextTestingPort = testingPort < 65535 ? testingPort + 1 : testingPort - 1;
      } else if (
        testingPort >= originalPortFailed
        && testingPort + 1 <= 65535
      ) {
        nextTestingPort = testingPort + 1;
      } else if (testingPort - 1 > 0) {
        nextTestingPort = testingPort - 1;
      } else {
        nextTestingPort = null;
        originalPortFailed = null;
      }

      waitMs = timeouts.failure;
    } else if (portTestFailed && appDOSState.dosState < thresholds.dos) {
      // Failed - Rising edge (by default takes 25 of these to get to 100)
      appDOSState.dosState += 4;
      setRandomPort();

      waitMs = timeouts.failure;
    } else if (portTestFailed && appDOSState.dosState >= thresholds.dos) {
      // Failed - DOS. At this point - all apps will be removed off node
      // by monitorNodeStatus
      const failedPorts = setRandomPort();

      // this dosMessage takes priority over dosMountMessage or dosDuplicateAppMessage
      appDOSState.dosMessage = 'Ports tested not reachable from outside, DMZ or UPNP '
        + `required! All ports that have failed: ${JSON.stringify(
          failedPorts,
        )}`;

      waitMs = timeouts.dos;
    } else if (!portTestFailed && portsNotWorking.size > thresholds.portsLowEdge) {
      // Failed - Lowering edge, the hysteresis stops bouncing between states
      portsNotWorking.delete(testingPort);
      setRandomPort();

      waitMs = timeouts.failure;
    } else {
      // Normal. This means that if we have less than 80 ports failed
      // (and we haven't gone DOS), and we get a good port, it will reset
      // the not working list
      portsNotWorking.clear();
      nextTestingPort = null;
      originalPortFailed = null;
      // we have to set this here. As the mount or duplicate messages could be set
      // in between when we last checked and now
      appDOSState.dosMessage = appDOSState.dosMountMessage || appDOSState.dosDuplicateAppMessage || null;
      appDOSState.dosState = appDOSState.dosMessage ? thresholds.dos : 0;

      waitMs = timeouts.default;
    }

    if (portTestFailed) {
      log.error(
        `checkMyAppsAvailability - Port ${testingPort} unreachable. `
        + `Detected from ${remoteIp}:${remotePort}. DosState: ${appDOSState.dosState}`,
      );
    } else {
      log.info(
        `${responseMessasge} Detected from ${remoteIp}:${remotePort} on `
        + `port ${testingPort}. DosState: ${appDOSState.dosState}`,
      );
    }

    if (portsNotWorking.size) {
      log.error(
        `checkMyAppsAvailability - Count: ${portsNotWorking.size}. `
        + `portsNotWorking: ${JSON.stringify(
          Array.from(portsNotWorking),
        )}`,
      );
    }

    await serviceHelper.delay(waitMs);
    setImmediate(checkMyAppsAvailability);
  } catch (error) {
    // this whole catch block is problematic. We are assuming that the rules have been
    // allowed, the rule has been mapped, and that the testing server has been
    // started. While all of these are then caught, we're logging errors that
    // aren't necessary. We should only remove stuff if it's been added. (and just
    // catch the errors as they are happening instead of using a catch all block)
    if (!appDOSState.dosMessage && (appDOSState.dosMountMessage || appDOSState.dosDuplicateAppMessage)) {
      appDOSState.dosMessage = appDOSState.dosMountMessage || appDOSState.dosDuplicateAppMessage;
    }

    await handleTestShutdown(testingPort, testHttpServer, { skipUpnp: !isUpnp });

    log.error(`checkMyAppsAvailability - Error: ${error}`);
    await serviceHelper.delay(timeouts.appError);
    setImmediate(checkMyAppsAvailability);
  }
}

/**
 * Function to monitor node status
 */
async function monitorNodeStatus() {
  try {
    let isNodeConfirmed = false;
    if (fluxNetworkHelper.getDosStateValue() >= 100) {
      const installedAppsRes = await appFileService.installedApps();
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
        await appInstallationService.removeAppLocally(installedApp.name, null, true, false, isNodeConfirmed);
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
      const installedAppsRes = await appFileService.installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('monitorNodeStatus - Failed to get installed Apps');
      }
      const appsInstalled = installedAppsRes.data;
      // eslint-disable-next-line no-restricted-syntax
      for (const installedApp of appsInstalled) {
        log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed from node as the node is not confirmed on the network`);
        log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
        // eslint-disable-next-line no-await-in-loop
        await appInstallationService.removeAppLocally(installedApp.name, null, true, false, false);
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
      let endIndex = chunkSize;

      while (endIndex < appsLocationCount) {
        const chunk = appslocations.slice(startIndex, endIndex);
        // eslint-disable-next-line no-await-in-loop
        await iterChunk(chunk);
        startIndex = endIndex;
        endIndex += chunkSize;
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

const appDOSState = require('./appDosState');
const appProgressState = require('./appProgressState');
const appFileService = require('./appFileService');
const appContainerService = require('./appContainerService');
const appInstallationService = require('./appInstallationService');
const appGlobalService = require('./appGlobalService');
const appValidationService = require('./appValidationService');

/**
 * To get apps DOS state.
 * @returns {object} DOS state information.
 */
function getAppsDOSState() {
  return {
    message: appDOSState.dosMessage,
    mountMessage: appDOSState.dosMountMessage,
    duplicateAppMessage: appDOSState.dosDuplicateAppMessage,
    state: appDOSState.dosState,
  };
}

module.exports = {
  appMonitor,
  appMonitorStream,
  startAppMonitoring,
  stopAppMonitoring,
  startMonitoringOfApps,
  stopMonitoringOfApps,
  startAppMonitoringAPI,
  stopAppMonitoringAPI,
  setAppsMonitored,
  getAppsMonitored,
  clearAppsMonitored,
  getAppFolderSize,
  getContainerStorage,
  checkMyAppsAvailability,
  checkApplicationsCompliance,
  checkApplicationsCpuUSage,
  checkAndRemoveApplicationInstance,
  monitorNodeStatus,
  monitorSharedDBApps,
  fluxUsage,
  appsResources,
  getAppsDOSState,
};
