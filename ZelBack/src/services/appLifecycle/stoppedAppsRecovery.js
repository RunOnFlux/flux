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
    const projection = { _id: 0, broadcastedAt: 1 };
    const records = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);

    if (!records || records.length === 0) {
      return false;
    }

    // Double-check expiration in case MongoDB TTL cleanup hasn't run yet
    const now = Date.now();
    const ttlSeconds = 7500;
    return records.some((record) => {
      const expiresAt = new Date(record.broadcastedAt).getTime() + (ttlSeconds * 1000);
      return expiresAt > now;
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

module.exports = {
  startStoppedAppsOnBoot,
  getStoppedFluxContainers,
  appUsesGSyncthingMode,
  appHasValidLocationOnNode,
  parseContainerName,
};
