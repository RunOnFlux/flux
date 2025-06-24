const dockerService = require('./dockerService');
const appsAuxiliarService = require('./appsAuxiliarService');
const serviceHelper = require('./serviceHelper');
// eslint-disable-next-line import/no-extraneous-dependencies
const nodecmd = require('node-cmd');

const util = require('util');

const cmdAsync = util.promisify(nodecmd.get);

const log = require('../lib/log');

const appsMonitored = {
};

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
          clearInterval(appsMonitored[appName].oneMinuteInterval);
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
 * To restart an app. Restarts each component if the app is using Docker Compose.
 * Function to ba called after synthing database revert that can cause no data to show up inside container despite it exists on mountpoint.
 * @param {string} appname Request.
 */
async function appDockerRestart(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerRestart(appname);
      startAppMonitoring(appname);
    } else {
      // ask for restarting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await appsAuxiliarService.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerRestart(appname);
        startAppMonitoring(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerRestart(`${appComponent.name}_${appSpecs.name}`);
          startAppMonitoring(`${appComponent.name}_${appSpecs.name}`);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Gets appsMonitored memory object;
 */
function getAppsMonitored() {
  return appsMonitored;
}

/**
 * To start an app. Start each component if the app is using Docker Compose.
 * @param {string} appname Request.
 */
async function appDockerStart(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerStart(appname);
      startAppMonitoring(appname);
    } else {
      // ask for restarting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await appsAuxiliarService.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerStart(appname);
        startAppMonitoring(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStart(`${appComponent.name}_${appSpecs.name}`);
          startAppMonitoring(`${appComponent.name}_${appSpecs.name}`);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To stop an app. Stop each component if the app is using Docker Compose.
 * Function to ba called before starting synthing in r: mode.
 * @param {string} appname Request.
 */
async function appDockerStop(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerStop(appname);
      stopAppMonitoring(appname, false);
    } else {
      // ask for restarting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await appsAuxiliarService.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerStop(appname);
        stopAppMonitoring(appname, false);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStop(`${appComponent.name}_${appSpecs.name}`);
          stopAppMonitoring(`${appComponent.name}_${appSpecs.name}`, false);
        }
      }
    }
  } catch (error) {
    log.error(error);
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
      apps = await appsAuxiliarService.installedApps();
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
      apps = await appsAuxiliarService.installedApps();
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

module.exports = {
  startMonitoringOfApps,
  stopMonitoringOfApps,
  appDockerStop,
  appDockerStart,
  appDockerRestart,
  startAppMonitoring,
  stopAppMonitoring,
  getAppsMonitored,
  getContainerStorage,
};
