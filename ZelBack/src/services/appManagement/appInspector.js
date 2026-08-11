const config = require('config');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const globalState = require('../utils/globalState');
const cpuBurstHelper = require('../utils/cpuBurstHelper');
const log = require('../../lib/log');
const { getContainerStorage } = require('../utils/appUtilities');

const dosState = 0;
const dosMessage = null;


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
      const appResponse = messageHelper.createDataMessage(await latestStats(appname));
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
 * Milliseconds on the monotonic clock. Every elapsed-time decision here — how long
 * a sample is kept, which samples a CPU decision may count — reads this rather than
 * the wall clock, so an NTP step cannot expire the store early or hand a decision
 * samples it already counted. Samples carry the wall-clock time too: that is what
 * the charts plot and what a requested range means.
 * @returns {number} Milliseconds since an arbitrary fixed origin
 */
function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * Reduce a docker stats reading to the values the monitoring consumers read.
 *
 * Docker returns several kilobytes a sample — per-core usage arrays repeated for
 * the previous reading, the whole kernel memory counter set, one blkio entry per
 * device in the stack — and between them the charts and the CPU throttler read
 * the dozen values below. Keeping the extract is what makes a week of samples
 * affordable to hold.
 * @param {object} stats - A docker stats reading, with disk_stats and nanoCpus attached
 * @returns {object} The values worth keeping
 */
function extractSample(stats) {
  const blkio = stats.blkio_stats?.io_service_bytes_recursive;
  // a container's traffic passes through its loop device, device-mapper and the
  // physical disk, so every entry is a partial view; docker stats sums them
  const sumBlkio = (op) => (blkio
    ? blkio
      .filter((entry) => entry.op?.toLowerCase() === op)
      .reduce((total, entry) => total + (entry.value || 0), 0)
    : null);

  return {
    cpuTotal: stats.cpu_stats?.cpu_usage?.total_usage ?? 0,
    cpuTotalBefore: stats.precpu_stats?.cpu_usage?.total_usage ?? 0,
    cpuSystem: stats.cpu_stats?.system_cpu_usage ?? 0,
    cpuSystemBefore: stats.precpu_stats?.system_cpu_usage ?? 0,
    onlineCpus: stats.cpu_stats?.online_cpus ?? 0,
    nanoCpus: stats.nanoCpus ?? null,
    memoryUsage: stats.memory_stats?.usage ?? null,
    memoryLimit: stats.memory_stats?.limit ?? null,
    ioRead: sumBlkio('read'),
    ioWrite: sumBlkio('write'),
    networkRx: stats.networks?.eth0?.rx_bytes ?? null,
    networkTx: stats.networks?.eth0?.tx_bytes ?? null,
    disk: stats.disk_stats ?? null,
  };
}

/**
 * Put an extracted sample back into the shape callers parse.
 * @param {object} sample - An extracted sample
 * @returns {object} The docker stats shape the monitoring endpoints return
 */
function expandSample(sample) {
  const io = sample.ioRead === null && sample.ioWrite === null
    ? null
    : [{ op: 'read', value: sample.ioRead }, { op: 'write', value: sample.ioWrite }];

  return {
    cpu_stats: {
      cpu_usage: { total_usage: sample.cpuTotal },
      system_cpu_usage: sample.cpuSystem,
      online_cpus: sample.onlineCpus,
    },
    precpu_stats: {
      cpu_usage: { total_usage: sample.cpuTotalBefore },
      system_cpu_usage: sample.cpuSystemBefore,
    },
    memory_stats: { usage: sample.memoryUsage, limit: sample.memoryLimit },
    blkio_stats: { io_service_bytes_recursive: io },
    networks: { eth0: { rx_bytes: sample.networkRx, tx_bytes: sample.networkTx } },
    nanoCpus: sample.nanoCpus,
    disk_stats: sample.disk,
  };
}

/**
 * How long a reading stands in for the present. The chart polls every five seconds
 * per viewer, and every viewer of the same app wants the same reading, so this
 * bounds collection by time rather than by request count: one viewer costs what it
 * costs today, ten cost the same.
 */
const statsFreshnessMs = 5 * 1000;

/**
 * The most recent reading for an app, taking one only if what is held has aged out.
 *
 * The node already samples every running container a minute; without this the live
 * view collected the same three docker readings again on every poll and threw them
 * away, so the copy that was kept was the one nothing read.
 * @param {string} appname - Application name, optionally component-qualified
 * @returns {Promise<object>} The reading, in the docker stats shape callers parse
 */
async function latestStats(appname) {
  const monitored = globalState.appsMonitored[appname];
  const stored = monitored && monitored.statsStore
    ? monitored.statsStore[monitored.statsStore.length - 1]
    : null;
  const held = [monitored && monitored.latest, stored]
    .filter(Boolean)
    .sort((a, b) => b.elapsed - a.elapsed)[0];

  if (held && monotonicMs() - held.elapsed < statsFreshnessMs) {
    return expandSample(held);
  }

  const stats = await dockerService.dockerContainerStats(appname);
  stats.disk_stats = await getContainerStorage(appname);
  const inspect = await dockerService.dockerContainerInspect(appname);
  stats.nanoCpus = inspect.HostConfig.NanoCpus;

  const sample = { timestamp: Date.now(), elapsed: monotonicMs(), ...extractSample(stats) };
  if (monitored) {
    monitored.latest = sample;
  }
  return expandSample(sample);
}

/**
 * Get the collected monitoring statistics for an application
 * @param {string} appname - Application name, optionally component-qualified
 * @param {number|string} [range] - Window in milliseconds to report on, or null for everything
 * @returns {Array<object>} Collected statistics
 */
function appMonitor(appname, range = null) {
  if (!appname) {
    throw new Error('No Flux App specified');
  }

  let window = range;
  if (window !== null) {
    window = parseInt(window, 10);
    if (!Number.isInteger(window) || window <= 0) {
      throw new Error('Invalid range value. It must be a positive integer or null.');
    }
  }

  const monitored = globalState.appsMonitored[appname];
  if (!monitored) {
    throw new Error('No data available');
  }

  let appStatsMonitoring = monitored.statsStore;
  if (window) {
    const cutoffTimestamp = Date.now() - window;
    const dayInMs = 24 * 60 * 60 * 1000;
    appStatsMonitoring = appStatsMonitoring.filter((stats) => stats.timestamp >= cutoffTimestamp);
    if (window > dayInMs) {
      // Past a day the series is thinned to one sample an hour: a week of
      // minute-resolution samples is neither sendable nor plottable. Thinning by
      // timestamp rather than by position keeps the spacing an hour whatever the
      // sampler's cadence is.
      const hourInMs = 60 * 60 * 1000;
      const thinned = [];
      let lastKept = null;
      appStatsMonitoring.forEach((stats) => {
        if (lastKept === null || stats.timestamp - lastKept >= hourInMs) {
          thinned.push(stats);
          lastKept = stats.timestamp;
        }
      });
      const newest = appStatsMonitoring[appStatsMonitoring.length - 1];
      if (newest && thinned[thinned.length - 1] !== newest) {
        thinned.push(newest);
      }
      appStatsMonitoring = thinned;
    }
  }
  return appStatsMonitoring.map((stats) => ({
    timestamp: stats.timestamp,
    data: expandSample(stats),
  }));
}

/**
 * Get application monitoring data
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function appMonitorAPI(req, res) {
  try {
    const appname = req.params.appname || req.query.appname;
    const range = req.params.range || req.query.range || null;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const appResponse = messageHelper.createDataMessage(appMonitor(appname, range));
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
 * Start monitoring an application
 * @param {string} appName - Application name
 * @returns {void}
 */
function startAppMonitoring(appName) {
  if (!appName) {
    throw new Error('No App specified');
  }

  const { appsMonitored } = globalState;

  log.info('Initialize Monitoring...');
  // Clear previous interval for this app to prevent multiple intervals
  if (appsMonitored[appName] && appsMonitored[appName].oneMinuteInterval) {
    clearInterval(appsMonitored[appName].oneMinuteInterval);
  }
  appsMonitored[appName] = {
    statsStore: [],
    // the throttler reads everything past this, then moves it forward; a
    // watermark rather than a wipe, so the series stays whole for the charts
    lastCpuDecisionAt: 0,
    nanoCpus: null,
    run: 0,
  };
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
      // a container that is created, exited or dead reports no usage; sampling it
      // fills the store with empty readings and gives the throttler nothing to
      // read. The listing above already carries the state, so this costs nothing.
      if (dockerContainer.State !== 'running') {
        return;
      }
      appsMonitored[appName].run += 1;
      const statsNow = await dockerService.dockerContainerStats(appName);
      statsNow.disk_stats = await getContainerStorage(appName);
      // the allocation only moves when the throttler moves it, so it is read on
      // the same cadence as before and carried onto the samples in between
      if (appsMonitored[appName].run % 3 === 1) {
        const inspect = await dockerService.dockerContainerInspect(appName);
        appsMonitored[appName].nanoCpus = inspect?.HostConfig?.NanoCpus ?? null;
      }
      statsNow.nanoCpus = appsMonitored[appName].nanoCpus;

      const elapsed = monotonicMs();
      appsMonitored[appName].statsStore.push({
        timestamp: Date.now(),
        elapsed,
        ...extractSample(statsNow),
      });
      appsMonitored[appName].statsStore = appsMonitored[appName].statsStore.filter(
        (stat) => elapsed - stat.elapsed <= 7 * 24 * 60 * 60 * 1000,
      );
    } catch (error) {
      log.error(error);
    }
  }, config.fluxapps.statsSampleIntervalMs);
}

/**
 * Stop monitoring an application
 * @param {string} appName - Application name
 * @param {boolean} deleteData - Whether to delete monitoring data
 * @returns {void}
 */
function stopAppMonitoring(appName, deleteData) {
  const { appsMonitored } = globalState;

  if (appsMonitored[appName]) {
    clearInterval(appsMonitored[appName].oneMinuteInterval);
    if (deleteData) {
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
 * The samples a CPU decision is entitled to: everything recorded since the last
 * decision, so no sample is counted twice.
 *
 * The hour bound matters. A decision is skipped whenever docker cannot inspect the
 * container or too few samples have arrived, and the watermark does not move on a
 * skip — so without it, a long run of skips would eventually hand a decision days
 * of samples and the 80% rule would be measured against a different population
 * than it was designed for.
 * @param {object} monitored - The monitoring entry for one app or component
 * @returns {Array<object>} Samples this decision may count
 */
function cpuDecisionWindow(monitored) {
  if (!monitored || !monitored.statsStore) return [];
  const floor = Math.max(monitored.lastCpuDecisionAt || 0, monotonicMs() - 60 * 60 * 1000);
  return monitored.statsStore.filter((stat) => stat.elapsed > floor);
}

/**
 * One sample's CPU use as a percentage of what the spec asked for.
 * @param {object} sample - An extracted sample
 * @param {number} specifiedCpu - The cpu the app or component specified
 * @returns {number} Percentage of the specified cpu in use
 */
function sampleCpuLoad(sample, specifiedCpu) {
  const cpuUsage = sample.cpuTotal - sample.cpuTotalBefore;
  const systemCpuUsage = sample.cpuSystem - sample.cpuSystemBefore;
  return ((cpuUsage / systemCpuUsage) * sample.onlineCpus * 100) / specifiedCpu || 0;
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
    ({ inPlace: installedAppsRes.data } = await decryptEnterpriseApps(installedAppsRes.data));
    const appsInstalled = installedAppsRes.data;
    let stats;
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      if (app.version <= 3) {
        // Stamped from BEFORE the window was taken, not from after the awaits
        // below. The watermark marks where this decision stopped looking; a
        // sample arriving during the inspect is not in the snapshot, so dating
        // the watermark later would put it behind the next window too and no
        // decision would ever count it.
        const decisionAt = monotonicMs();
        stats = cpuDecisionWindow(appsMonitored[app.name]);
        // eslint-disable-next-line no-await-in-loop
        const inspect = await dockerService.dockerContainerInspect(app.name);
        // Skip CPU throttling for containers with CFS burst actively applied.
        // Ground truth comes from the kernel (cpu.max.burst > 0), not from the
        // owner whitelist — so a misconfigured/unsupported node where setCpuBurst
        // failed still gets normal throttling, never "worst of both worlds".
        // eslint-disable-next-line no-await-in-loop
        if (inspect && await cpuBurstHelper.isBurstActive(inspect.State?.Pid)) {
          log.info(`checkApplicationsCpuUSage ${app.name} burst-active, skipping CPU throttling`);
          if (appsMonitored[app.name]) {
            // eslint-disable-next-line no-param-reassign
            appsMonitored[app.name].lastCpuDecisionAt = decisionAt;
          }
          // eslint-disable-next-line no-continue
          continue;
        }
        if (inspect && stats && stats.length > 4) {
          const nanoCpus = inspect.HostConfig.NanoCpus;
          let cpuThrottlingRuns = 0;
          let cpuThrottling = false;
          const cpuPercentage = nanoCpus / app.cpu / 1e9;
          stats.forEach((stat) => {
            const realCpu = sampleCpuLoad(stat, app.cpu) / cpuPercentage;
            if (realCpu >= 92) {
              cpuThrottlingRuns += 1;
            }
          });
          if (cpuThrottlingRuns >= stats.length * 0.8) {
            // cpu was high on 80% of the checks
            cpuThrottling = true;
          }
          // eslint-disable-next-line no-param-reassign
          appsMonitored[app.name].lastCpuDecisionAt = decisionAt;
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
          const compName = `${appComponent.name}_${app.name}`;
          // As above: the watermark dates the snapshot, not the decision, so a
          // sample landing during the awaits is not lost between the two.
          const decisionAt = monotonicMs();
          stats = cpuDecisionWindow(appsMonitored[compName]);
          // eslint-disable-next-line no-await-in-loop
          const inspect = await dockerService.dockerContainerInspect(compName);
          // Skip CPU throttling for components with CFS burst actively applied.
          // Per-component check — components of the same app may have different
          // burst state if some failed to apply.
          // eslint-disable-next-line no-await-in-loop
          if (inspect && await cpuBurstHelper.isBurstActive(inspect.State?.Pid)) {
            log.info(`checkApplicationsCpuUSage ${compName} burst-active, skipping CPU throttling`);
            if (appsMonitored[compName]) {
              // eslint-disable-next-line no-param-reassign
              appsMonitored[compName].lastCpuDecisionAt = decisionAt;
            }
            // eslint-disable-next-line no-continue
            continue;
          }
          if (inspect && stats && stats.length > 4) {
            const nanoCpus = inspect.HostConfig.NanoCpus;
            let cpuThrottlingRuns = 0;
            let cpuThrottling = false;
            const cpuPercentage = nanoCpus / appComponent.cpu / 1e9;
            stats.forEach((stat) => {
              const realCpu = sampleCpuLoad(stat, appComponent.cpu) / cpuPercentage;
              if (realCpu >= 92) {
                cpuThrottlingRuns += 1;
              }
            });
            if (cpuThrottlingRuns >= stats.length * 0.8) {
              // cpu was high on 80% of the checks
              cpuThrottling = true;
            }
            // eslint-disable-next-line no-param-reassign
            appsMonitored[compName].lastCpuDecisionAt = decisionAt;
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
    ({ inPlace: appsInstalled.data } = await decryptEnterpriseApps(appsInstalled.data));

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
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    // Decrypt enterprise apps (version 8 with encrypted content)
    ({ inPlace: installedAppsRes.data } = await decryptEnterpriseApps(installedAppsRes.data));
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
  appMonitorAPI,
  appExec,
  appChanges,
  startAppMonitoring,
  stopAppMonitoring,
  listAppsImages,
  getAppsDOSState,
  checkApplicationsCpuUSage,
  monitorSharedDBApps,
  checkStorageSpaceForApps,
};
