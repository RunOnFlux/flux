const path = require('path');
const config = require('config');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');
// eslint-disable-next-line no-unused-vars
const { appConstants } = require('../utils/appConstants');
const { getContainerStorage } = require('../utils/appUtilities');
const generalService = require('../generalService');
const registryManager = require('../appDatabase/registryManager');
const globalState = require('../utils/globalState');

// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
// eslint-disable-next-line import/no-extraneous-dependencies
const nodecmd = require('node-cmd');

// eslint-disable-next-line no-unused-vars
const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
// eslint-disable-next-line no-unused-vars
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');

const dosState = 0;
const dosMessage = null;

// Cache for enterprise app owner lookups (TTL: 5 minutes)
// Reduces DB calls since owner rarely changes
const enterpriseOwnerCache = new Map();
const ENTERPRISE_OWNER_CACHE_TTL = 5 * 60 * 1000;

const cmdAsync = util.promisify(nodecmd.run);
const dockerStatsStreamPromise = util.promisify(dockerService.dockerContainerStatsStream);

/**
 * Get top processes running in an application container
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appTop(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const appRes = await dockerService.appDockerTop(appname);
    const appResponse = messageHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
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
 * Get application logs
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appLog(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    let { lines } = req.params;
    lines = lines || req.query.lines || 'all';

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      let logs = await dockerService.dockerContainerLogs(appname, lines);
      logs = serviceHelper.dockerBufferToString(logs);
      const dataMessage = messageHelper.createDataMessage(logs);
      res.json(dataMessage);
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
 * Stream application logs
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function appLogStream(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      res.setHeader('Content-Type', 'application/json');
      dockerService.dockerContainerLogsStream(appname, res, (error) => {
        if (error) {
          log.error(error);
          const errorResponse = messageHelper.createErrorMessage(
            error.message || error,
            error.name,
            error.code,
          );
          res.write(errorResponse);
          res.end();
        } else {
          res.end();
        }
      });
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
 * Poll application logs with filtering
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appLogPolling(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { lines } = req.params;
    lines = lines || req.query.lineCount || 'all';
    let { since } = req.params;
    since = since || req.query.since || '';

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      let parsedLineCount;
      if (lines === 'all') {
        parsedLineCount = 'all';
      } else {
        parsedLineCount = parseInt(lines, 10) || 100;
      }

      const logs = [];
      await new Promise((resolve, reject) => {
        dockerService.dockerContainerLogsPolling(appname, parsedLineCount, since, (err, logLine) => {
          if (err) {
            reject(err);
          } else if (logLine === 'Stream ended') {
            resolve();
          } else if (logLine) {
            logs.push(logLine);
          }
        });
      });

      res.json({
        logs,
        lineCount: parsedLineCount,
        logCount: logs.length,
        sinceTimestamp: since,
        truncated: parsedLineCount === 'all' ? false : logs.length >= parsedLineCount,
        status: 'success',
      });
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
 * Inspect application container
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function appInspect(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const response = await dockerService.dockerContainerInspect(appname);
      const appResponse = messageHelper.createDataMessage(response);
      res.json(appResponse);
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
 * Get application statistics
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function appStats(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const response = await dockerService.dockerContainerStats(appname);
      const containerStorageInfo = await getContainerStorage(appname);
      response.disk_stats = containerStorageInfo;
      const inspect = await dockerService.dockerContainerInspect(appname);
      response.nanoCpus = inspect.HostConfig.NanoCpus;
      const appResponse = messageHelper.createDataMessage(response);
      res.json(appResponse);
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
 * Get application monitoring data
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {object} appsMonitored - Apps monitoring data
 * @returns {Promise<void>}
 */
async function appMonitor(req, res, appsMonitored) {
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
          const hoursInMs = 24 * 60 * 60 * 1000;
          appStatsMonitoring = appStatsMonitoring.filter((stats) => stats.timestamp >= cutoffTimestamp);
          if (range > hoursInMs) {
            appStatsMonitoring = appStatsMonitoring.filter((_, index, array) => index % 20 === 0 || index === array.length - 1);
          }
        }
        const appResponse = messageHelper.createDataMessage(appStatsMonitoring);
        res.json(appResponse);
      } else {
        throw new Error('No data available');
      }
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
 * Stream application monitoring data
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>}
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
 * Get application folder size
 * @param {string} appName - Application name
 * @returns {Promise<number>} Folder size in bytes
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
 * Start monitoring an application
 * @param {string} appName - Application name
 * @param {object} [appsMonitored] - Apps monitoring data reference (optional, will get from appsService if not provided)
 * @returns {void}
 */
function startAppMonitoring(appName, appsMonitored) {
  if (!appName) {
    throw new Error('No App specified');
  }

  // eslint-disable-next-line global-require
  // Get appsMonitored from globalState if not provided (to avoid circular dependency)
  if (!appsMonitored) {
    // eslint-disable-next-line global-require
    const globalState = require('../utils/globalState');
    // eslint-disable-next-line prefer-destructuring, no-param-reassign
    appsMonitored = globalState.appsMonitored;
  }

  // Safety check: if appsMonitored is still undefined, throw a more descriptive error
  if (!appsMonitored) {
    // eslint-disable-next-line no-param-reassign
    throw new Error('Failed to initialize app monitoring: appsMonitored object is undefined');
  // eslint-disable-next-line no-param-reassign
  }

  // eslint-disable-next-line no-param-reassign
  log.info('Initialize Monitoring...');
  // Clear previous interval for this app to prevent multiple intervals
  if (appsMonitored[appName] && appsMonitored[appName].oneMinuteInterval) {
    clearInterval(appsMonitored[appName].oneMinuteInterval);
  }
  // eslint-disable-next-line no-param-reassign
  appsMonitored[appName] = {}; // Initialize the app's monitoring object
  if (!appsMonitored[appName].statsStore) {
    // eslint-disable-next-line no-param-reassign
    appsMonitored[appName].statsStore = [];
  }
  if (!appsMonitored[appName].lastHourstatsStore) {
    // eslint-disable-next-line no-param-reassign
    appsMonitored[appName].lastHourstatsStore = [];
  }
  // eslint-disable-next-line no-param-reassign
  appsMonitored[appName].run = 0;
  // eslint-disable-next-line no-param-reassign
  appsMonitored[appName].oneMinuteInterval = setInterval(async () => {
    try {
      if (!appsMonitored[appName]) {
        log.error(`Monitoring of ${appName} already stopped`);
        return;
      // eslint-disable-next-line no-param-reassign
      }
      const dockerContainer = await dockerService.getDockerContainerOnly(appName);
      if (!dockerContainer) {
        log.error(`Monitoring of ${appName} not possible. App does not exist. Forcing stopping of monitoring`);
        // eslint-disable-next-line no-use-before-define
        stopAppMonitoring(appName, true, appsMonitored);
        return;
      }
      // eslint-disable-next-line no-param-reassign
      appsMonitored[appName].run += 1;
      const statsNow = await dockerService.dockerContainerStats(appName);
      const containerStorageInfo = await getContainerStorage(appName);
      // eslint-disable-next-line no-param-reassign
      statsNow.disk_stats = containerStorageInfo;
      const now = Date.now();
      if (appsMonitored[appName].run % 3 === 0) {
        const inspect = await dockerService.dockerContainerInspect(appName);
        // eslint-disable-next-line no-param-reassign
        statsNow.nanoCpus = inspect.HostConfig.NanoCpus;
        appsMonitored[appName].statsStore.push({ timestamp: now, data: statsNow });
        const statsStoreSizeInBytes = new TextEncoder().encode(JSON.stringify(appsMonitored[appName].statsStore)).length;
        const estimatedSizeInMB = statsStoreSizeInBytes / (1024 * 1024);
        log.info(`Size of stats for ${appName}: ${estimatedSizeInMB.toFixed(2)} MB`);
        // eslint-disable-next-line no-param-reassign
        appsMonitored[appName].statsStore = appsMonitored[appName].statsStore.filter(
          (stat) => now - stat.timestamp <= 7 * 24 * 60 * 60 * 1000,
        );
      }
      appsMonitored[appName].lastHourstatsStore.push({ timestamp: now, data: statsNow });
      // eslint-disable-next-line no-param-reassign
      appsMonitored[appName].lastHourstatsStore = appsMonitored[appName].lastHourstatsStore.filter(
        (stat) => now - stat.timestamp <= 60 * 60 * 1000,
      );
    } catch (error) {
      log.error(error);
    }
  }, 1 * 60 * 1000);
}
// eslint-disable-next-line global-require

/**
 * Stop monitoring an application
 * @param {string} appName - Application name
 * @param {boolean} deleteData - Whether to delete monitoring data
 * @param {object} [appsMonitored] - Apps monitoring data reference (optional, will get from appsService if not provided)
 * @returns {void}
 */
function stopAppMonitoring(appName, deleteData, appsMonitored) {
  // Get appsMonitored from globalState if not provided (to avoid circular dependency)
  if (!appsMonitored) {
    // eslint-disable-next-line global-require
    const globalState = require('../utils/globalState');
    // eslint-disable-next-line prefer-destructuring, no-param-reassign
    appsMonitored = globalState.appsMonitored;
  }

  // Safety check: if appsMonitored is still undefined, log warning and return early
  if (!appsMonitored) {
    log.warn(`Cannot stop monitoring for ${appName}: appsMonitored object is undefined`);
    return;
  }

  if (appsMonitored[appName]) {
    clearInterval(appsMonitored[appName].oneMinuteInterval);
    if (deleteData) {
      // eslint-disable-next-line no-param-reassign
      delete appsMonitored[appName];
    }
  }
}

/**
 * Execute command in application container
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function appExec(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);

      if (!processedBody.appname) {
        throw new Error('No Flux App specified');
      }

      if (!processedBody.cmd) {
        throw new Error('No command specified');
      }

      const mainAppName = processedBody.appname.split('_')[1] || processedBody.appname;

      const authorized = await verificationHelper.verifyPrivilege('appowner', req, mainAppName);
      if (authorized === true) {
        let cmd = processedBody.cmd || [];
        let env = processedBody.env || [];

        cmd = serviceHelper.ensureObject(cmd);
        env = serviceHelper.ensureObject(env);

        const containers = await dockerService.dockerListContainers(true);
        const myContainer = containers.find((container) => (container.Names[0] === dockerService.getAppDockerNameIdentifier(processedBody.appname) || container.Id === processedBody.appname));
        const dockerContainer = dockerService.getDockerContainer(myContainer.Id);

        res.setHeader('Content-Type', 'application/json');

        dockerService.dockerContainerExec(dockerContainer, cmd, env, res, (error) => {
          if (error) {
            log.error(error);
            const errorResponse = messageHelper.createErrorMessage(
              error.message || error,
              error.name,
              error.code,
            );
            res.write(errorResponse);
            res.end();
          } else {
            res.end();
          }
        });
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
  });
}

/**
 * Get application changes/diff
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function appChanges(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const response = await dockerService.dockerContainerChanges(appname);
      const appResponse = messageHelper.createDataMessage(response);
      res.json(appResponse);
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
 * List Docker images used by apps
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<object>} List of Docker images
 */
async function listAppsImages(req, res) {
  try {
    const apps = await dockerService.dockerListImages();
    const appsResponse = messageHelper.createDataMessage(apps);
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
 * Get Apps DOS (Denial of Service) State
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} DOS state information
 */
function getAppsDOSState(req, res) {
  const data = {
    dosState,
    dosMessage,
  };
  const response = messageHelper.createDataMessage(data);
  return res ? res.json(response) : response;
}

/**
 * Check if an app owner is an enterprise owner
 * @param {string} appOwner - The app owner address
 * @returns {boolean} True if owner is in enterpriseAppOwners list
 */
function isEnterpriseApp(appOwner) {
  if (!appOwner) return false;
  return config.enterpriseAppOwners.includes(appOwner);
}

/**
 * Get application owner with caching to reduce DB calls
 * Cache TTL is 5 minutes - owner rarely changes
 * @param {string} appName - Application name
 * @returns {Promise<string|null>} Owner address or null
 */
async function getCachedApplicationOwner(appName) {
  const cached = enterpriseOwnerCache.get(appName);
  const now = Date.now();

  if (cached && (now - cached.timestamp) < ENTERPRISE_OWNER_CACHE_TTL) {
    return cached.owner;
  }

  const owner = await registryManager.getApplicationOwner(appName);
  enterpriseOwnerCache.set(appName, { owner, timestamp: now });
  return owner;
}

/**
 * Calculate available CPU for enterprise burst on this node
 * @param {Array} installedApps - List of installed apps with their specs
 * @returns {Promise<number>} Available burst CPU in cores
 */
async function calculateNodeAvailableCpu(installedApps) {
  try {
    const tier = await generalService.getNewNodeTier();
    // CPU is stored in tenths (e.g., 40 = 4 cores)
    const nodeTotalCpu = config.fluxSpecifics.cpu[tier] / 10;
    const lockedCpu = config.lockedSystemResources.cpu / 10;
    const reservePercentage = config.enterpriseBurst.minSparePercentage / 100;
    const reserveCpu = nodeTotalCpu * reservePercentage;

    // Sum all app spec CPUs (baseline allocations)
    let sumAppSpecCpus = 0;
    for (const app of installedApps) {
      if (app.version <= 3) {
        sumAppSpecCpus += app.cpu;
      } else {
        for (const component of app.compose) {
          sumAppSpecCpus += component.cpu;
        }
      }
    }

    const availableBurst = nodeTotalCpu - lockedCpu - sumAppSpecCpus - reserveCpu;
    return Math.max(0, availableBurst);
  } catch (error) {
    log.error(`calculateNodeAvailableCpu error: ${error}`);
    return 0;
  }
}

/**
 * Calculate burst allocations for enterprise apps proportionally
 * @param {Array} enterpriseAppsNeedingBurst - Array of {containerName, specCpu} for apps needing burst
 * @param {number} availableBurstCpu - Available CPU for bursting in cores
 * @returns {Map<string, number>} Map of containerName -> finalNanoCpus
 */
function calculateEnterpriseBurstAllocations(enterpriseAppsNeedingBurst, availableBurstCpu) {
  const allocations = new Map();

  if (!enterpriseAppsNeedingBurst || enterpriseAppsNeedingBurst.length === 0 || availableBurstCpu <= 0) {
    return allocations;
  }

  // Calculate total spec CPU of all enterprise apps requesting burst
  const totalEnterpriseSpecCpu = enterpriseAppsNeedingBurst.reduce((sum, app) => sum + app.specCpu, 0);

  for (const app of enterpriseAppsNeedingBurst) {
    // Proportional share of available burst CPU
    const proportion = app.specCpu / totalEnterpriseSpecCpu;
    const burstShare = availableBurstCpu * proportion;

    // Calculate final CPU (spec + burst share), capped at maxMultiplier * spec
    const maxAllowedCpu = app.specCpu * config.enterpriseBurst.maxMultiplier;
    const finalCpu = Math.min(app.specCpu + burstShare, maxAllowedCpu);

    // Convert to nanoCPUs (1 core = 1e9 nanoCPUs)
    const finalNanoCpus = Math.round(finalCpu * 1e9);
    allocations.set(app.containerName, finalNanoCpus);
  }

  return allocations;
}

/**
 * Analyze CPU stats for an enterprise container within the detection window
 * IMPORTANT: CPU percentage is calculated against SPEC CPU, not current limit
 * This prevents oscillation when app is already bursted
 * @param {Array} allStats - All stats from lastHourstatsStore
 * @param {number} specCpu - The app's specified CPU in cores (NOT current allocation)
 * @param {object} burstConfig - Enterprise burst configuration
 * @returns {object} { needsBurst: boolean, needsReset: boolean, recentStats: Array, avgCpuPercent: number }
 */
function analyzeEnterpriseCpuStats(allStats, specCpu, burstConfig) {
  const now = Date.now();
  const detectionWindow = burstConfig.detectionWindowMs || 15 * 60 * 1000;
  const highThreshold = burstConfig.highUtilThreshold || 85;
  const lowThreshold = burstConfig.lowUtilThreshold || 60;
  const minStats = burstConfig.minStatsRequired || 5;
  const sampleThreshold = (burstConfig.sampleThresholdPercent || 80) / 100;

  // Filter to only recent stats within the detection window
  const recentStats = allStats.filter((stat) => (now - stat.timestamp) <= detectionWindow);

  if (recentStats.length < minStats) {
    return { needsBurst: false, needsReset: false, recentStats, avgCpuPercent: 0 };
  }

  let highUtilCount = 0;
  let lowUtilCount = 0;
  let totalCpuPercent = 0;
  let validSamples = 0;

  for (const stat of recentStats) {
    const cpuUsage = stat.data.cpu_stats.cpu_usage.total_usage - stat.data.precpu_stats.cpu_usage.total_usage;
    const systemCpuUsage = stat.data.cpu_stats.system_cpu_usage - stat.data.precpu_stats.system_cpu_usage;

    // Guard against division by zero
    if (systemCpuUsage <= 0) {
      continue;
    }

    // Calculate CPU percentage against SPEC, not current allocation
    // This ensures consistent thresholds regardless of current burst state
    const cpuCores = (cpuUsage / systemCpuUsage) * stat.data.cpu_stats.online_cpus;
    const cpuPercent = (cpuCores / specCpu) * 100;

    // Guard against invalid values
    if (!Number.isFinite(cpuPercent) || cpuPercent < 0) {
      continue;
    }

    validSamples += 1;
    totalCpuPercent += cpuPercent;

    if (cpuPercent >= highThreshold) {
      highUtilCount += 1;
    }
    if (cpuPercent < lowThreshold) {
      lowUtilCount += 1;
    }
  }

  // Need minimum valid samples
  if (validSamples < minStats) {
    return { needsBurst: false, needsReset: false, recentStats, avgCpuPercent: 0 };
  }

  const avgCpuPercent = totalCpuPercent / validSamples;

  // Need burst if CPU was high on configured percentage of recent checks
  const needsBurst = highUtilCount >= validSamples * sampleThreshold;
  // Need reset if CPU was low on configured percentage of recent checks
  const needsReset = lowUtilCount >= validSamples * sampleThreshold;

  return { needsBurst, needsReset, recentStats, avgCpuPercent };
}

/**
 * Check if cooldown period has passed since last burst change
 * @param {string} containerName - Container name
 * @param {number} cooldownMs - Cooldown period in milliseconds
 * @returns {boolean} True if cooldown has passed or no previous change
 */
function isCooldownPassed(containerName, cooldownMs) {
  const allocation = globalState.enterpriseBurstAllocations.get(containerName);
  if (!allocation || !allocation.lastChangeTime) {
    return true;
  }
  return (Date.now() - allocation.lastChangeTime) >= cooldownMs;
}

/**
 * Apply enterprise CPU burst to eligible apps
 * Uses configurable detection window for faster response (default 5 minutes)
 * Includes cooldown to prevent oscillation (similar to Kubernetes stabilization window)
 * @param {object} appsMonitored - Applications monitoring data
 * @param {Array} installedApps - List of installed apps
 * @returns {Promise<void>}
 */
async function applyEnterpriseCpuBurst(appsMonitored, installedApps) {
  try {
    // Check if enterprise burst is enabled
    if (!config.enterpriseBurst || !config.enterpriseBurst.enabled) {
      return;
    }

    const burstConfig = config.enterpriseBurst;
    const cooldownMs = burstConfig.cooldownMs || 5 * 60 * 1000;
    const enterpriseAppsNeedingBurst = [];
    const enterpriseAppsNotNeedingBurst = [];

    // Track which containers are still installed (for cleanup)
    const installedContainerNames = new Set();

    // Process each installed app
    for (const app of installedApps) {
      // Get owner from global app database
      // eslint-disable-next-line no-await-in-loop
      const appOwner = await getCachedApplicationOwner(app.name);

      if (!isEnterpriseApp(appOwner)) {
        continue; // Skip non-enterprise apps
      }

      if (app.version <= 3) {
        // Simple app (non-composed)
        const containerName = app.name;
        installedContainerNames.add(containerName);
        const allStats = appsMonitored[containerName]?.lastHourstatsStore || [];
        const specCpu = app.cpu;

        // eslint-disable-next-line no-await-in-loop
        const inspect = await dockerService.dockerContainerInspect(containerName);
        if (inspect) {
          const currentNanoCpus = inspect.HostConfig.NanoCpus;

          // Pass specCpu to analyze (NOT currentCpuLimit) - prevents oscillation
          const { needsBurst, needsReset, avgCpuPercent } = analyzeEnterpriseCpuStats(allStats, specCpu, burstConfig);

          // Check cooldown before making changes
          const cooldownPassed = isCooldownPassed(containerName, cooldownMs);

          if (needsBurst && cooldownPassed) {
            enterpriseAppsNeedingBurst.push({ containerName, specCpu });
            log.info(`Enterprise burst: ${containerName} high CPU (${avgCpuPercent.toFixed(1)}% of spec), requesting burst`);
          } else if (needsReset && currentNanoCpus > specCpu * 1e9 && cooldownPassed) {
            enterpriseAppsNotNeedingBurst.push({ containerName, specCpu });
            log.info(`Enterprise burst: ${containerName} low CPU (${avgCpuPercent.toFixed(1)}% of spec), will reset`);
          } else if (!cooldownPassed && (needsBurst || needsReset)) {
            log.debug(`Enterprise burst: ${containerName} change skipped - cooldown active`);
          }
        }
      } else {
        // Composed app
        for (const component of app.compose) {
          const containerName = `${component.name}_${app.name}`;
          installedContainerNames.add(containerName);
          const allStats = appsMonitored[containerName]?.lastHourstatsStore || [];
          const specCpu = component.cpu;

          // eslint-disable-next-line no-await-in-loop
          const inspect = await dockerService.dockerContainerInspect(containerName);
          if (inspect) {
            const currentNanoCpus = inspect.HostConfig.NanoCpus;

            // Pass specCpu to analyze (NOT currentCpuLimit) - prevents oscillation
            const { needsBurst, needsReset, avgCpuPercent } = analyzeEnterpriseCpuStats(allStats, specCpu, burstConfig);

            // Check cooldown before making changes
            const cooldownPassed = isCooldownPassed(containerName, cooldownMs);

            if (needsBurst && cooldownPassed) {
              enterpriseAppsNeedingBurst.push({ containerName, specCpu });
              log.info(`Enterprise burst: ${containerName} high CPU (${avgCpuPercent.toFixed(1)}% of spec), requesting burst`);
            } else if (needsReset && currentNanoCpus > specCpu * 1e9 && cooldownPassed) {
              enterpriseAppsNotNeedingBurst.push({ containerName, specCpu });
              log.info(`Enterprise burst: ${containerName} low CPU (${avgCpuPercent.toFixed(1)}% of spec), will reset`);
            } else if (!cooldownPassed && (needsBurst || needsReset)) {
              log.debug(`Enterprise burst: ${containerName} change skipped - cooldown active`);
            }
          }
        }
      }
    }

    // Cleanup stale entries from enterpriseBurstAllocations (apps that were uninstalled)
    for (const containerName of globalState.enterpriseBurstAllocations.keys()) {
      if (!installedContainerNames.has(containerName)) {
        globalState.enterpriseBurstAllocations.delete(containerName);
        log.info(`Enterprise burst: Cleaned up stale allocation for uninstalled container ${containerName}`);
      }
    }

    // Calculate available burst CPU and allocations
    const availableBurstCpu = await calculateNodeAvailableCpu(installedApps);
    const allocations = calculateEnterpriseBurstAllocations(enterpriseAppsNeedingBurst, availableBurstCpu);

    // Apply burst allocations
    for (const [containerName, nanoCpus] of allocations) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await dockerService.appDockerUpdateCpu(containerName, nanoCpus);
        const app = enterpriseAppsNeedingBurst.find((a) => a.containerName === containerName);
        log.info(`Enterprise CPU burst: ${containerName} allocated ${nanoCpus / 1e9} CPUs (spec: ${app.specCpu})`);

        // Store allocation in global state with timestamp for cooldown
        globalState.enterpriseBurstAllocations.set(containerName, {
          specCpu: app.specCpu,
          currentAllocation: nanoCpus / 1e9,
          lastChangeTime: Date.now(),
          state: 'bursted',
        });
      } catch (error) {
        log.error(`Failed to apply enterprise burst to ${containerName}: ${error}`);
      }
    }

    // Reset apps that no longer need burst back to spec
    for (const app of enterpriseAppsNotNeedingBurst) {
      try {
        const specNanoCpus = Math.round(app.specCpu * 1e9);
        // eslint-disable-next-line no-await-in-loop
        await dockerService.appDockerUpdateCpu(app.containerName, specNanoCpus);
        log.info(`Enterprise CPU burst reset: ${app.containerName} back to spec ${app.specCpu} CPUs`);

        // Update allocation state with timestamp for cooldown
        globalState.enterpriseBurstAllocations.set(app.containerName, {
          specCpu: app.specCpu,
          currentAllocation: app.specCpu,
          lastChangeTime: Date.now(),
          state: 'normal',
        });
      } catch (error) {
        log.error(`Failed to reset enterprise burst for ${app.containerName}: ${error}`);
      }
    }
  } catch (error) {
    log.error(`applyEnterpriseCpuBurst error: ${error}`);
  }
}

/**
 * Fast-loop check for enterprise CPU burst - runs independently every 2 minutes (configurable)
 * This provides Kubernetes-like response times (~5 minutes) for enterprise apps
 * @param {object} appsMonitored - Applications monitoring data
 * @param {Function} installedApps - Async function to get installed apps
 * @returns {Promise<void>}
 */
async function checkEnterpriseCpuBurst(appsMonitored, installedApps) {
  try {
    // Check if enterprise burst is enabled
    if (!config.enterpriseBurst || !config.enterpriseBurst.enabled) {
      return;
    }

    // Get list of locally installed apps
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      log.warn('checkEnterpriseCpuBurst: Failed to get installed apps');
      return;
    }

    // Decrypt enterprise apps (version 8 with encrypted content)
    installedAppsRes.data = await decryptEnterpriseApps(installedAppsRes.data);
    const appsInstalled = installedAppsRes.data;

    // Apply enterprise CPU burst
    await applyEnterpriseCpuBurst(appsMonitored, appsInstalled);
  } catch (error) {
    log.error(`checkEnterpriseCpuBurst error: ${error}`);
  }
}

/**
 * Check if applications are throttling CPU and adjust CPU limits
 * @param {object} appsMonitored - Applications monitoring data
 * @param {Function} installedApps - Async function to get installed apps
 * @returns {Promise<void>}
 */
async function checkApplicationsCpuUSage(appsMonitored, installedApps) {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    // Decrypt enterprise apps (version 8 with encrypted content)
    installedAppsRes.data = await decryptEnterpriseApps(installedAppsRes.data);
    const appsInstalled = installedAppsRes.data;

    // Build a map of enterprise app names for quick lookup
    const enterpriseAppNames = new Set();
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      // eslint-disable-next-line no-await-in-loop
      const appOwner = await getCachedApplicationOwner(app.name);
      if (isEnterpriseApp(appOwner)) {
        enterpriseAppNames.add(app.name);
      }
    }

    let stats;
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      // Skip throttling for enterprise apps - they use burst instead
      if (enterpriseAppNames.has(app.name)) {
        log.info(`checkApplicationsCpuUSage: Skipping throttling for enterprise app ${app.name}`);
        continue;
      }

      if (app.version <= 3) {
        stats = appsMonitored[app.name]?.lastHourstatsStore;
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
          // eslint-disable-next-line no-param-reassign
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
          stats = appsMonitored[`${appComponent.name}_${app.name}`]?.lastHourstatsStore;
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
            // eslint-disable-next-line no-param-reassign
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
    // Note: Enterprise CPU burst is now handled by the dedicated fast-loop (checkEnterpriseCpuBurst)
    // which runs every 2 minutes for Kubernetes-like response times
  } catch (error) {
    log.error(error);
  }
}

/**
 * Monitor shared database applications and handle uninstall signals
 * @param {Function} installedApps - Async function to get installed apps
 * @param {Function} removeAppLocally - Async function to remove app locally
 * @param {object} globalState - Global state object with installation/removal flags
 * @returns {Promise<void>}
 */
async function monitorSharedDBApps(installedApps, removeAppLocally, globalState) {
  try {
    // do not run if installationInProgress or removalInProgress or softRedeployInProgress or hardRedeployInProgress
    if (globalState.installationInProgress || globalState.removalInProgress || globalState.softRedeployInProgress || globalState.hardRedeployInProgress) {
      return;
    }
    // get list of all installed apps
    const appsInstalled = await installedApps();
    // Decrypt enterprise apps (version 8 with encrypted content)
    appsInstalled.data = await decryptEnterpriseApps(appsInstalled.data);

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
              log.warn(`REMOVAL REASON: Operator uninstall request - ${installedApp.name} operator status set to UNINSTALL (sharedDB monitoring)`);
              // eslint-disable-next-line no-await-in-loop
              await removeAppLocally(installedApp.name, null, true, false, true);
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
    monitorSharedDBApps(installedApps, removeAppLocally, globalState);
  // eslint-disable-next-line global-require
  }
}

/**
 * Check storage space usage of applications and enforce limits
 * @param {Function} installedApps - Async function to get installed apps
 * @param {Function} removeAppLocally - Async function to remove app locally
 * @param {Function} softRedeploy - Async function to soft redeploy app (can be null)
 * @param {Array} appsStorageViolations - Array tracking storage violations
 * @returns {Promise<void>}
 */
async function checkStorageSpaceForApps(installedApps, removeAppLocally, softRedeploy, appsStorageViolations) {
  try {
    // eslint-disable-next-line global-require
    const config = require('config');
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    // Decrypt enterprise apps (version 8 with encrypted content)
    installedAppsRes.data = await decryptEnterpriseApps(installedAppsRes.data);
    const appsInstalled = installedAppsRes.data;
    const dockerSystemDF = await dockerService.dockerGetUsage();
    const allowedMaximum = (config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap) * 1000 * 1024 * 1024;
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      if (app.version >= 4) {
        let totalSize = 0;
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          // compose
          const identifier = `${component.name}_${app.name}`;
          const contId = dockerService.getAppDockerNameIdentifier(identifier);
          const contExists = dockerSystemDF.Containers.find((cont) => cont.Names[0] === contId);
          if (contExists) {
            totalSize += contExists.SizeRootFs;
          }
        // eslint-disable-next-line no-param-reassign
        }
        const maxAllowedSize = app.compose.length * allowedMaximum;
        if (totalSize > maxAllowedSize) { // here we allow that one component can take more space than allowed as long as total per entire app is lower than total allowed
          // soft redeploy, todo remove the entire app if multiple violations
          appsStorageViolations.push(app.name);
          const occurancies = appsStorageViolations.filter((appName) => (appName) === app.name).length;
          if (occurancies > 3) { // if more than 3 violations, then remove the app
            log.warn(`Application ${app.name} is using ${totalSize} space which is more than allowed ${maxAllowedSize}. Removing...`);
            log.warn(`REMOVAL REASON: Storage violation - ${app.name} using ${totalSize} bytes (max: ${maxAllowedSize}) - ${occurancies} violations (storage monitoring)`);
            // eslint-disable-next-line no-await-in-loop
            await removeAppLocally(app.name).catch((error) => {
              log.error(error);
            });
            const adjArray = appsStorageViolations.filter((appName) => (appName) !== app.name);
            // eslint-disable-next-line no-param-reassign
            appsStorageViolations = adjArray;
          } else {
            log.warn(`Application ${app.name} is using ${totalSize} space which is more than allowed ${maxAllowedSize}. Soft redeploying...`);
            // eslint-disable-next-line no-await-in-loop
            await softRedeploy(app).catch((error) => {
              log.error(error);
            });
          }
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(2 * 60 * 1000); // 2 mins
        }
      } else {
        const identifier = app.name;
        // eslint-disable-next-line no-param-reassign
        const contId = dockerService.getAppDockerNameIdentifier(identifier);
        const contExists = dockerSystemDF.Containers.find((cont) => cont.Names[0] === contId);
        if (contExists) {
          if (contExists.SizeRootFs > allowedMaximum) {
            // soft redeploy, todo remove the entire app if multiple violations
            appsStorageViolations.push(app.name);
            const occurancies = appsStorageViolations.filter((appName) => (appName) === app.name).length;
            if (occurancies > 3) { // if more than 3 violations, then remove the app
              log.warn(`Application ${app.name} is using ${contExists.SizeRootFs} space which is more than allowed ${allowedMaximum}. Removing...`);
              log.warn(`REMOVAL REASON: Container storage violation - ${app.name} container using ${contExists.SizeRootFs} bytes (max: ${allowedMaximum}) - ${occurancies} violations (storage monitoring)`);
              // eslint-disable-next-line no-await-in-loop
              await removeAppLocally(app.name).catch((error) => {
                log.error(error);
              });
              const adjArray = appsStorageViolations.filter((appName) => (appName) !== app.name);
              // eslint-disable-next-line no-param-reassign
              appsStorageViolations = adjArray;
            } else {
              log.warn(`Application ${app.name} is using ${contExists.SizeRootFs} space which is more than allowed ${allowedMaximum}. Soft redeploying...`);
              // eslint-disable-next-line no-await-in-loop
              await softRedeploy(app).catch((error) => {
                log.error(error);
              });
            }
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(2 * 60 * 1000); // 2 mins
          }
        }
      }
    }
    setTimeout(() => {
      checkStorageSpaceForApps(installedApps, removeAppLocally, softRedeploy, appsStorageViolations);
    }, 30 * 60 * 1000);
  } catch (error) {
    log.error(error);
    setTimeout(() => {
      checkStorageSpaceForApps(installedApps, removeAppLocally, softRedeploy, appsStorageViolations);
    }, 30 * 60 * 1000);
  }
}

module.exports = {
  appTop,
  appLog,
  appLogStream,
  appLogPolling,
  appInspect,
  appStats,
  appMonitor,
  appMonitorStream,
  appExec,
  appChanges,
  getAppFolderSize,
  startAppMonitoring,
  stopAppMonitoring,
  listAppsImages,
  getAppsDOSState,
  checkApplicationsCpuUSage,
  checkEnterpriseCpuBurst,
  monitorSharedDBApps,
  checkStorageSpaceForApps,
  // Enterprise CPU burst exports (for testing)
  isEnterpriseApp,
  getCachedApplicationOwner,
  calculateNodeAvailableCpu,
  calculateEnterpriseBurstAllocations,
  analyzeEnterpriseCpuStats,
  isCooldownPassed,
  applyEnterpriseCpuBurst,
};
