/**
 * Stopped Apps Recovery Service
 *
 * This module handles the recovery of Flux applications that are stopped on boot.
 * It checks for installed apps that have stopped containers and starts them,
 * but only if they do NOT use g: syncthing mode (master/slave mode).
 * Apps using g: syncthing mode are managed by the masterSlaveApps service.
 */

const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const dockerService = require('../dockerService');
const serviceHelper = require('../serviceHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const generalService = require('../generalService');
const registryManager = require('../appDatabase/registryManager');
const advancedWorkflows = require('./advancedWorkflows');
const appInstaller = require('./appInstaller');
const appUninstaller = require('./appUninstaller');
const appInspector = require('../appManagement/appInspector');
const appTamperingDetectionService = require('../appTamperingDetectionService');
const globalState = require('../utils/globalState');
const cacheManager = require('../utils/cacheManager').default;
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const { localAppsInformation } = require('../utils/appConstants');

const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

/**
 * Check if an app uses g: syncthing mode in ANY of its components
 * For legacy apps (v <= 3), checks containerData at root level
 * For compose apps (v > 3), checks containerData in each component
 * @param {Object} appSpec - App specification
 * @returns {boolean} True if ANY component uses g: syncthing mode
 */
function appUsesGSyncthingMode(appSpec) {
  if (!appSpec) {
    return false;
  }

  // For compose apps (version >= 4), check all components
  if (appSpec.compose && appSpec.compose.length > 0) {
    return appSpec.compose.some((comp) => comp.containerData && comp.containerData.includes('g:'));
  }

  // For legacy single-component apps (version <= 3), check root containerData
  if (appSpec.containerData) {
    return appSpec.containerData.includes('g:');
  }

  return false;
}

/**
 * Check if an app still has a valid (non-expired) location record for this node's IP.
 * The globalAppsLocations collection has a TTL index of 7500 seconds on broadcastedAt.
 * If the record is missing or expired, the app was already reassigned to another node.
 * @param {string} appName - Application name
 * @param {string} myIp - This node's IP address
 * @returns {Promise<boolean>} True if a valid location record exists
 */
async function appHasValidLocationOnNode(appName, myIp) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = { name: appName, ip: myIp };
    const projection = { _id: 0, expireAt: 1 };
    const records = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);

    if (!records || records.length === 0) {
      return false;
    }

    // Check expireAt directly - this field is kept in sync when broadcastedAt
    // is manipulated during sigterm handling (both locally and on peers)
    const now = Date.now();
    return records.some((record) => {
      if (!record.expireAt) return false;
      return new Date(record.expireAt).getTime() > now;
    });
  } catch (error) {
    log.error(`stoppedAppsRecovery - Error checking app location for ${appName}: ${error.message}`);
    // On error, assume valid to avoid incorrectly removing apps
    return true;
  }
}

/**
 * Get all installed apps from local database
 * @returns {Promise<Array>} Array of installed app specifications
 */
async function getInstalledAppsFromDb() {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {};
    const appsProjection = {
      projection: { _id: 0 },
    };
    const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    return apps || [];
  } catch (error) {
    log.error(`stoppedAppsRecovery - Error getting installed apps: ${error.message}`);
    return [];
  }
}

/**
 * Get all stopped Flux containers
 * @returns {Promise<Array>} Array of stopped container info
 */
async function getStoppedFluxContainers() {
  try {
    // Get all containers including stopped ones
    const containers = await dockerService.dockerListContainers(true);

    if (!containers || containers.length === 0) {
      return [];
    }

    // Filter for Flux app containers that are stopped (not running)
    const stoppedContainers = containers.filter((container) => {
      const name = container.Names && container.Names[0] ? container.Names[0] : '';
      // Flux containers start with /flux or /zel
      const isFluxContainer = name.startsWith('/flux') || name.startsWith('/zel');
      // Check if container is stopped (State is 'exited' or not 'running')
      const isStopped = container.State !== 'running';
      return isFluxContainer && isStopped;
    });

    return stoppedContainers;
  } catch (error) {
    log.error(`stoppedAppsRecovery - Error getting stopped containers: ${error.message}`);
    return [];
  }
}

/**
 * Extract app name and component name from container name
 * Container names follow the pattern: /flux{component}_{appName} or /zel{component}_{appName}
 * For single-component apps: /flux{appName} or /zel{appName}
 * @param {string} containerName - Container name (e.g., /fluxcomponent_appname)
 * @returns {Object} Object with appName and componentName
 */
function parseContainerName(containerName) {
  // Remove leading slash
  const name = containerName.replace(/^\//, '');

  // Remove flux or zel prefix
  let cleanName = name;
  if (name.startsWith('flux')) {
    cleanName = name.substring(4);
  } else if (name.startsWith('zel')) {
    cleanName = name.substring(3);
  }

  // Check if it has component_appname format
  const underscoreIndex = cleanName.indexOf('_');
  if (underscoreIndex > 0) {
    return {
      componentName: cleanName.substring(0, underscoreIndex),
      appName: cleanName.substring(underscoreIndex + 1),
    };
  }

  // Single component app - component name is same as app name
  return {
    componentName: cleanName,
    appName: cleanName,
  };
}

/**
 * Start stopped apps that don't use g: syncthing mode in ANY component
 * If an app has ANY component using g: syncthing, ALL containers for that app are skipped
 * @returns {Promise<Object>} Results of the recovery operation
 */
async function startStoppedAppsOnBoot() {
  const results = {
    appsChecked: 0,
    appsStarted: [],
    appsSkippedGMode: [],
    appsSkippedNoSpec: [],
    appsRemoved: [],
    appsFailed: [],
  };

  try {
    log.info('stoppedAppsRecovery - Starting stopped apps recovery check');

    // Get all installed apps from database (just to get the list of app names)
    const installedApps = await getInstalledAppsFromDb();
    if (installedApps.length === 0) {
      log.info('stoppedAppsRecovery - No installed apps found');
      return results;
    }

    // Create a set for quick lookup of installed app names
    const installedAppNames = new Set(installedApps.map((app) => app.name));

    // Get all stopped Flux containers
    const stoppedContainers = await getStoppedFluxContainers();
    if (stoppedContainers.length === 0) {
      log.info('stoppedAppsRecovery - No stopped containers found');
      return results;
    }

    log.info(`stoppedAppsRecovery - Found ${stoppedContainers.length} stopped Flux containers`);

    // Get unique app names from stopped containers
    const appsWithStoppedContainers = new Set();
    for (const container of stoppedContainers) {
      const containerName = container.Names[0];
      const { appName } = parseContainerName(containerName);
      appsWithStoppedContainers.add(appName);
    }

    log.info(`stoppedAppsRecovery - Stopped containers belong to ${appsWithStoppedContainers.size} app(s)`);

    // Get this node's IP for location checks
    const myIp = await fluxNetworkHelper.getMyFluxIPandPort();

    // Process each app
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsWithStoppedContainers) {
      results.appsChecked += 1;

      log.info(`stoppedAppsRecovery - Checking app ${appName}`);

      // Check if app is installed
      if (!installedAppNames.has(appName)) {
        log.warn(`stoppedAppsRecovery - App ${appName} not in installed apps list, skipping all its containers`);
        results.appsSkippedNoSpec.push(appName);
        // eslint-disable-next-line no-continue
        continue;
      }

      // Get the app specification (with decryption for enterprise apps)
      let appSpec;
      try {
        // Use getApplicationGlobalSpecifications which handles enterprise app decryption
        // eslint-disable-next-line no-await-in-loop
        appSpec = await registryManager.getApplicationGlobalSpecifications(appName);
      } catch (specError) {
        log.error(`stoppedAppsRecovery - Error fetching specs for app ${appName}: ${specError.message}`);
      }

      if (!appSpec) {
        log.warn(`stoppedAppsRecovery - No global spec found for app ${appName}, skipping all its containers`);
        results.appsSkippedNoSpec.push(appName);
        // eslint-disable-next-line no-continue
        continue;
      }

      // Check if ANY component of the app uses g: syncthing mode
      if (appUsesGSyncthingMode(appSpec)) {
        log.info(`stoppedAppsRecovery - App ${appName} uses g: syncthing mode, skipping all its containers (managed by masterSlaveApps)`);
        results.appsSkippedGMode.push(appName);
        // eslint-disable-next-line no-continue
        continue;
      }

      // Check if the app still has a valid location record for this node
      // If the node was offline longer than the TTL (~7 minutes after sigterm),
      // the location record expired and the app was respawned elsewhere
      if (myIp) {
        // eslint-disable-next-line no-await-in-loop
        const hasValidLocation = await appHasValidLocationOnNode(appName, myIp);
        if (!hasValidLocation) {
          log.warn(`stoppedAppsRecovery - App ${appName} no longer has a valid location record for this node (${myIp}), removing locally`);
          try {
            // eslint-disable-next-line no-await-in-loop
            await appUninstaller.removeAppLocally(appName, null, true, true, false);
            results.appsRemoved.push(appName);
            log.info(`stoppedAppsRecovery - App ${appName} removed locally (was reassigned to another node)`);
          } catch (removeError) {
            log.error(`stoppedAppsRecovery - Failed to remove app ${appName}: ${removeError.message}`);
            results.appsFailed.push({ app: appName, error: removeError.message });
          }
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(2000);
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      // App has valid location - start it (handles all components)
      log.info(`stoppedAppsRecovery - App ${appName} has valid location, starting app`);

      try {
        // eslint-disable-next-line no-await-in-loop
        await advancedWorkflows.appDockerStart(appName);
        results.appsStarted.push(appName);
        log.info(`stoppedAppsRecovery - Successfully started app ${appName}`);

        // Add small delay between app starts to avoid overwhelming the system
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(2000);
      } catch (startError) {
        log.error(`stoppedAppsRecovery - Failed to start app ${appName}: ${startError.message}`);
        results.appsFailed.push({
          app: appName,
          error: startError.message,
        });
      }
    }

    log.info(
      'stoppedAppsRecovery - Recovery complete. '
      + `Apps checked: ${results.appsChecked}, `
      + `Apps started: ${results.appsStarted.length}, `
      + `Apps removed (expired location): ${results.appsRemoved.length}, `
      + `Apps skipped (g: mode): ${results.appsSkippedGMode.length}, `
      + `Apps skipped (no spec): ${results.appsSkippedNoSpec.length}, `
      + `Apps failed: ${results.appsFailed.length}`,
    );

    return results;
  } catch (error) {
    log.error(`stoppedAppsRecovery - Critical error during recovery: ${error.message}`);
  }
}

async function recreateMissingContainers(componentIdentifier) {
  const mainAppName = componentIdentifier.split('_')[1] || componentIdentifier;
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appslocal.database);

  const appsQuery = { name: mainAppName };
  const appsProjection = { projection: { _id: 0 } };
  let appSpec = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);

  if (!appSpec) {
    throw new Error(`App ${mainAppName} not found in local database`);
  }

  appSpec = await decryptEnterpriseApps([appSpec], { formatSpecs: false });
  // eslint-disable-next-line prefer-destructuring
  appSpec = appSpec[0];

  if (!appSpec.compose || appSpec.compose.length === 0) {
    throw new Error(`App ${mainAppName} has no components to install`);
  }

  const tier = await generalService.nodeTier();
  const isComponent = componentIdentifier.includes('_');

  if (isComponent) {
    const componentName = componentIdentifier.split('_')[0];
    const componentSpec = appSpec.compose.find((c) => c.name === componentName);
    if (!componentSpec) {
      throw new Error(`Component ${componentName} not found in app ${mainAppName}`);
    }
    const hddTier = `hdd${tier}`;
    const ramTier = `ram${tier}`;
    const cpuTier = `cpu${tier}`;
    componentSpec.cpu = componentSpec[cpuTier] || componentSpec.cpu;
    componentSpec.ram = componentSpec[ramTier] || componentSpec.ram;
    componentSpec.hdd = componentSpec[hddTier] || componentSpec.hdd;
    await appInstaller.installApplicationHard(componentSpec, mainAppName, true, null, appSpec);
  } else {
    for (const componentSpec of appSpec.compose) {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      componentSpec.cpu = componentSpec[cpuTier] || componentSpec.cpu;
      componentSpec.ram = componentSpec[ramTier] || componentSpec.ram;
      componentSpec.hdd = componentSpec[hddTier] || componentSpec.hdd;
      // eslint-disable-next-line no-await-in-loop
      await appInstaller.installApplicationHard(componentSpec, mainAppName, true, null, appSpec);
    }
  }

  log.info(`Successfully recreated missing containers for ${componentIdentifier}`);
}

async function handleMissingMasterSlaveContainer(stoppedApp, mainAppName) {
  const containerExists = await dockerService.getDockerContainerOnly(stoppedApp);
  if (containerExists) return;

  log.warn(`Container for master/slave app ${stoppedApp} doesn't exist, recreating...`);
  try {
    await recreateMissingContainers(stoppedApp);
    log.info(`Successfully recreated master/slave app container ${stoppedApp}`);
    appInspector.startAppMonitoring(stoppedApp, globalState.appsMonitored);
  } catch (recreateErr) {
    const containerExistsNow = await dockerService.getDockerContainerOnly(stoppedApp);
    if (containerExistsNow) {
      log.info(`Container for ${stoppedApp} was created by another process, skipping removal`);
      return;
    }
    log.error(`Failed to recreate master/slave app ${stoppedApp}: ${recreateErr.message}`);
    log.warn(`REMOVAL REASON: Master/slave container recreation failure - ${mainAppName} (stoppedAppsRecovery)`);
    await appTamperingDetectionService.recordEvent(mainAppName, 'recreation_failed', `Master/slave container recreation failure: ${recreateErr.message}`);
    if (appTamperingDetectionService.isNetworkMissingError(recreateErr.message)) {
      await appTamperingDetectionService.recordEvent(mainAppName, 'network_pruned', `Docker network missing during recreation: ${recreateErr.message}`);
    }
    await appUninstaller.removeAppLocally(mainAppName, null, false, true, true, () => {},
      () => globalState, (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, globalState.appsMonitored));
  }
}

/**
 * Check for stopped apps and recover them. Returns list of master/slave apps
 * that have syncthing containers (needed by the broadcast to include them even
 * if some containers are stopped).
 * @param {string} myIP - This node's IP
 * @param {Array} appsInstalled - Installed app specs
 * @param {Array} runningAppsNames - Names of running containers
 * @returns {Promise<Array>} masterSlaveAppsInstalled
 */
async function checkStoppedApps(myIP, appsInstalled, runningAppsNames) {
  const masterSlaveAppsInstalled = [];
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
  const runningSet = new Set(runningAppsNames);
  const stoppedApps = installedAppComponentNames.filter((installedApp) => !runningSet.has(installedApp));

  const backupInProgress = globalState.backupInProgress || [];
  const restoreInProgress = globalState.restoreInProgress || [];
  const appsStoppedCache = cacheManager.stoppedAppsCache;

  if (globalState.removalInProgress || globalState.installationInProgress || globalState.softRedeployInProgress || globalState.hardRedeployInProgress || globalState.reinstallationOfOldAppsInProgress) {
    log.warn('Stopped application checks not running, some removal or installation is in progress');
    return masterSlaveAppsInstalled;
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const stoppedApp of stoppedApps) {
    try {
      const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
      // eslint-disable-next-line no-await-in-loop
      const appDetails = await registryManager.getApplicationGlobalSpecifications(mainAppName);
      const appInstalledMasterSlave = appsInstalled.find((app) => app.name === mainAppName);
      const appInstalledSyncthing = appInstalledMasterSlave.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:'));
      const appInstalledMasterSlaveCheck = appInstalledMasterSlave.compose.find((comp) => comp.containerData.includes('g:'));
      if (appInstalledSyncthing) {
        masterSlaveAppsInstalled.push(appInstalledMasterSlave);
      }
      if (appInstalledMasterSlaveCheck && appDetails) {
        const backupSkip = backupInProgress.some((backupItem) => stoppedApp === backupItem);
        const restoreSkip = restoreInProgress.some((backupItem) => stoppedApp === backupItem);
        if (!backupSkip && !restoreSkip) {
          // eslint-disable-next-line no-await-in-loop
          await handleMissingMasterSlaveContainer(stoppedApp, mainAppName);
        }
      } else if (appDetails) {
        log.warn(`${stoppedApp} is stopped but should be running. Starting...`);
        const backupSkip = backupInProgress.some((backupItem) => stoppedApp === backupItem);
        const restoreSkip = restoreInProgress.some((backupItem) => stoppedApp === backupItem);
        if (backupSkip || restoreSkip) {
          log.warn(`Application ${stoppedApp} backup/restore is in progress...`);
        }
        if (!globalState.removalInProgress && !globalState.installationInProgress && !globalState.softRedeployInProgress && !globalState.hardRedeployInProgress && !globalState.reinstallationOfOldAppsInProgress && !restoreSkip && !backupSkip) {
          // eslint-disable-next-line no-await-in-loop
          const containerExists = await dockerService.getDockerContainerOnly(stoppedApp);

          if (containerExists && appInstalledSyncthing) {
            const db = dbHelper.databaseConnection();
            const database = db.db(config.database.appsglobal.database);
            const queryFind = { name: mainAppName, ip: myIP };
            const projection = { _id: 0, runningSince: 1 };
            // eslint-disable-next-line no-await-in-loop
            const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
            if (!result || !result.runningSince || Date.parse(result.runningSince) + 30 * 60 * 1000 > Date.now()) {
              log.info(`Application ${stoppedApp} uses r syncthing and container exists but is stopped. Haven't started yet because was installed less than 30m ago.`);
              // eslint-disable-next-line no-continue
              continue;
            }
          }

          if (!containerExists) {
            log.warn(`Container for ${stoppedApp} doesn't exist, recreating immediately...`);
            // eslint-disable-next-line no-await-in-loop
            await appTamperingDetectionService.recordEvent(mainAppName, 'container_vanished', `Container ${stoppedApp} missing, not found in Docker`);
            try {
              // eslint-disable-next-line no-await-in-loop
              await recreateMissingContainers(stoppedApp);
              log.info(`Successfully recreated ${stoppedApp}`);
              appInspector.startAppMonitoring(stoppedApp, globalState.appsMonitored);
            } catch (recreateErr) {
              log.error(`Failed to recreate containers for ${stoppedApp}: ${recreateErr.message}`);
              log.warn(`REMOVAL REASON: Container recreation failure - ${mainAppName} failed to recreate with error: ${recreateErr.message} (stoppedAppsRecovery)`);
              // eslint-disable-next-line no-await-in-loop
              await appTamperingDetectionService.recordEvent(mainAppName, 'recreation_failed', `Container recreation failure: ${recreateErr.message}`);
              if (appTamperingDetectionService.isNetworkMissingError(recreateErr.message)) {
                // eslint-disable-next-line no-await-in-loop
                await appTamperingDetectionService.recordEvent(mainAppName, 'network_pruned', `Docker network missing during recreation: ${recreateErr.message}`);
              }
              // eslint-disable-next-line no-await-in-loop
              await appUninstaller.removeAppLocally(mainAppName, null, false, true, true, () => {
              }, () => globalState, (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, globalState.appsMonitored));
            }
          } else {
            log.warn(`${stoppedApp} is stopped, starting`);
            if (!appsStoppedCache.has(stoppedApp)) {
              appsStoppedCache.set(stoppedApp, '');
            } else {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerStart(stoppedApp);
              appInspector.startAppMonitoring(stoppedApp, globalState.appsMonitored);
            }
          }
        } else {
          log.warn(`Not starting ${stoppedApp} as application removal or installation or backup/restore is in progress`);
        }
      }
    } catch (err) {
      log.error(err);
      const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
      if (!globalState.removalInProgress && !globalState.installationInProgress && !globalState.softRedeployInProgress && !globalState.hardRedeployInProgress && !globalState.reinstallationOfOldAppsInProgress) {
        log.warn(`REMOVAL REASON: App start failure - ${mainAppName} failed to start with error: ${err.message} (stoppedAppsRecovery)`);
        // eslint-disable-next-line no-await-in-loop
        await appUninstaller.removeAppLocally(mainAppName, null, false, true, true, () => {
        }, () => globalState, (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, globalState.appsMonitored));
      }
    }
  }
  return masterSlaveAppsInstalled;
}

module.exports = {
  startStoppedAppsOnBoot,
  getStoppedFluxContainers,
  appUsesGSyncthingMode,
  appHasValidLocationOnNode,
  checkStoppedApps,
  parseContainerName,
  handleMissingMasterSlaveContainer,
};
