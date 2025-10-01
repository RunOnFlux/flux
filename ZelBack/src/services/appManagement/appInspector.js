const path = require('path');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const log = require('../../lib/log');
const { appConstants } = require('../utils/appConstants');
const { getContainerStorage } = require('../utils/appUtilities');

// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
// eslint-disable-next-line import/no-extraneous-dependencies
const nodecmd = require('node-cmd');

const fluxDirPath = path.join(__dirname, '../../../../');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');

let dosState = 0;
let dosMessage = null;

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
 * @param {object} appsMonitored - Apps monitoring data reference (optional, will get from appsService if not provided)
 */
function startAppMonitoring(appName, appsMonitored) {
  if (!appName) {
    throw new Error('No App specified');
  }

  // Get appsMonitored from appsService if not provided (to avoid circular dependency)
  if (!appsMonitored) {
    const appsService = require('../appsService');
    appsMonitored = appsService.getAppsMonitored();
  }

  // Safety check: if appsMonitored is still undefined, throw a more descriptive error
  if (!appsMonitored) {
    throw new Error('Failed to initialize app monitoring: appsMonitored object is undefined');
  }

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
        stopAppMonitoring(appName, true, appsMonitored);
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

/**
 * Stop monitoring an application
 * @param {string} appName - Application name
 * @param {boolean} deleteData - Whether to delete monitoring data
 * @param {object} appsMonitored - Apps monitoring data reference (optional, will get from appsService if not provided)
 */
function stopAppMonitoring(appName, deleteData, appsMonitored) {
  // Get appsMonitored from appsService if not provided (to avoid circular dependency)
  if (!appsMonitored) {
    const appsService = require('../appsService');
    appsMonitored = appsService.getAppsMonitored();
  }

  // Safety check: if appsMonitored is still undefined, log warning and return early
  if (!appsMonitored) {
    log.warn(`Cannot stop monitoring for ${appName}: appsMonitored object is undefined`);
    return;
  }

  if (appsMonitored[appName]) {
    clearInterval(appsMonitored[appName].oneMinuteInterval);
  }
  if (deleteData) {
    delete appsMonitored[appName];
  }
}

/**
 * Execute command in application container
 * @param {object} req - Request object
 * @param {object} res - Response object
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
 * Check if applications are throttling CPU and adjust CPU limits
 * @param {object} appsMonitored - Applications monitoring data
 * @param {Function} installedApps - Function to get installed apps
 * @returns {Promise<void>}
 */
async function checkApplicationsCpuUSage(appsMonitored, installedApps) {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
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
 * Monitor shared database applications and handle uninstall signals
 * @param {Function} installedApps - Function to get installed apps
 * @param {Function} removeAppLocally - Function to remove app locally
 * @param {object} globalState - Global state object with installation/removal flags
 * @returns {Promise<void>}
 */
async function monitorSharedDBApps(installedApps, removeAppLocally, globalState) {
  try {
    // do not run if installationInProgress or removalInProgress
    if (globalState.installationInProgress || globalState.removalInProgress) {
      return;
    }
    // get list of all installed apps
    const appsInstalled = await installedApps();

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
  }
}

/**
 * Check storage space usage of applications and enforce limits
 * @param {Function} installedApps - Function to get installed apps
 * @param {Function} removeAppLocally - Function to remove app locally
 * @param {Function} softRedeploy - Function to soft redeploy app
 * @param {Array} appsStorageViolations - Array tracking storage violations
 * @returns {Promise<void>}
 */
async function checkStorageSpaceForApps(installedApps, removeAppLocally, softRedeploy, appsStorageViolations) {
  try {
    const config = require('config');
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
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
        }
        const maxAllowedSize = app.compose.length * allowedMaximum;
        if (totalSize > maxAllowedSize) { // here we allow that one component can take more space than allowed as long as total per entire app is lower than total allowed
          // soft redeploy, todo remove the entire app if multiple violations
          appsStorageViolations.push(app.name);
          const occurancies = appsStorageViolations.filter((appName) => (appName) === app.name).length;
          if (occurancies > 3) { // if more than 3 violations, then remove the app
            log.warn(`Application ${app.name} is using ${totalSize} space which is more than allowed ${maxAllowedSize}. Removing...`);
            // eslint-disable-next-line no-await-in-loop
            await removeAppLocally(app.name).catch((error) => {
              log.error(error);
            });
            const adjArray = appsStorageViolations.filter((appName) => (appName) !== app.name);
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
        const contId = dockerService.getAppDockerNameIdentifier(identifier);
        const contExists = dockerSystemDF.Containers.find((cont) => cont.Names[0] === contId);
        if (contExists) {
          if (contExists.SizeRootFs > allowedMaximum) {
            // soft redeploy, todo remove the entire app if multiple violations
            appsStorageViolations.push(app.name);
            const occurancies = appsStorageViolations.filter((appName) => (appName) === app.name).length;
            if (occurancies > 3) { // if more than 3 violations, then remove the app
              log.warn(`Application ${app.name} is using ${contExists.SizeRootFs} space which is more than allowed ${allowedMaximum}. Removing...`);
              // eslint-disable-next-line no-await-in-loop
              await removeAppLocally(app.name).catch((error) => {
                log.error(error);
              });
              const adjArray = appsStorageViolations.filter((appName) => (appName) !== app.name);
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
  monitorSharedDBApps,
  checkStorageSpaceForApps,
};