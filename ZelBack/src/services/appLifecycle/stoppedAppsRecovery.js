/**
 * Stopped Apps Recovery Service
 *
 * This module handles the recovery of Flux applications that are stopped on boot.
 * It iterates installed apps with stopped containers and starts every component
 * that is NOT in g: syncthing mode. Components in g: mode are left stopped so the
 * masterSlaveApps service can elect a primary. For mixed compose apps (some
 * components g:, some not), only the non-g components are started here.
 */

const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const dockerService = require('../dockerService');
const serviceHelper = require('../serviceHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const registryManager = require('../appDatabase/registryManager');
const advancedWorkflows = require('./advancedWorkflows');
const appUninstaller = require('./appUninstaller');
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
 * Return the identifiers (component_appName for v>=4, appName for v<=3) of the
 * components this service should start on boot — i.e. every component that does
 * NOT use g: syncthing mode. g: components are intentionally left stopped so
 * masterSlaveApps can elect a primary.
 * @param {Object} appSpec - App specification
 * @param {string} appName - Canonical app name (from container parsing); used as
 *   the fallback when appSpec.name is absent (e.g. legacy specs or test fixtures).
 * @returns {string[]} Identifiers ready to pass to advancedWorkflows.appDockerStart
 */
function getNonGComponentIdentifiers(appSpec, appName) {
  if (!appSpec) {
    return [];
  }
  const resolvedName = appSpec.name || appName;

  // Compose apps (version >= 4): partition components by containerData.
  if (appSpec.compose && appSpec.compose.length > 0) {
    return appSpec.compose
      .filter((comp) => !(comp.containerData && comp.containerData.includes('g:')))
      .map((comp) => `${comp.name}_${resolvedName}`);
  }

  // Legacy single-component apps (version <= 3).
  if (appSpec.containerData && appSpec.containerData.includes('g:')) {
    return [];
  }
  return [resolvedName];
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
 * Start stopped Flux app containers on boot, partitioned by g: syncthing mode.
 * - Apps with no g: components: started normally (whole app).
 * - Apps where every component is g:: skipped entirely (managed by masterSlaveApps).
 * - Mixed compose apps: only non-g components started; g: components left stopped.
 * @returns {Promise<Object>} Results of the recovery operation
 */
async function startStoppedAppsOnBoot() {
  const results = {
    appsChecked: 0,
    appsStarted: [],
    appsPartiallyStarted: [], // mixed compose: non-g components started, g: components left for masterSlaveApps
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

      // Partition the app's components by g: syncthing mode. Non-g components are
      // started here; g: components are left stopped for masterSlaveApps to elect a
      // primary. If every component is g:, the app is skipped entirely.
      const componentsToStart = getNonGComponentIdentifiers(appSpec, appName);
      const totalComponents = (appSpec.compose && appSpec.compose.length > 0)
        ? appSpec.compose.length
        : 1;
      const isPartial = componentsToStart.length > 0
        && componentsToStart.length < totalComponents;

      if (componentsToStart.length === 0) {
        log.info(`stoppedAppsRecovery - App ${appName} uses g: syncthing mode in every component, skipping (managed by masterSlaveApps)`);
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

      // App has valid location - start the non-g components individually so that any
      // g: siblings remain stopped (masterSlaveApps will start them only on the primary).
      if (isPartial) {
        log.info(`stoppedAppsRecovery - App ${appName} has valid location, starting ${componentsToStart.length}/${totalComponents} non-g components (g: components managed by masterSlaveApps)`);
      } else {
        log.info(`stoppedAppsRecovery - App ${appName} has valid location, starting app`);
      }

      let anyComponentFailed = false;
      // eslint-disable-next-line no-restricted-syntax
      for (const identifier of componentsToStart) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await advancedWorkflows.appDockerStart(identifier);
          log.info(`stoppedAppsRecovery - Successfully started ${identifier}`);
          // Add small delay between starts to avoid overwhelming the system
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(2000);
        } catch (startError) {
          anyComponentFailed = true;
          log.error(`stoppedAppsRecovery - Failed to start ${identifier}: ${startError.message}`);
          results.appsFailed.push({
            app: identifier,
            error: startError.message,
          });
        }
      }

      if (!anyComponentFailed) {
        if (isPartial) {
          results.appsPartiallyStarted.push(appName);
        } else {
          results.appsStarted.push(appName);
        }
      }
    }

    log.info(
      'stoppedAppsRecovery - Recovery complete. '
      + `Apps checked: ${results.appsChecked}, `
      + `Apps started: ${results.appsStarted.length}, `
      + `Apps partially started (mixed g:): ${results.appsPartiallyStarted.length}, `
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

module.exports = {
  startStoppedAppsOnBoot,
  getStoppedFluxContainers,
  appUsesGSyncthingMode,
  getNonGComponentIdentifiers,
  appHasValidLocationOnNode,
  parseContainerName,
};
