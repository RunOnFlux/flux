/**
 * App Startup Manager
 *
 * Owns all boot-time app lifecycle decisions. Uses boot context (machine reboot
 * detection, downtime, shutdown reason) to determine whether to start, remove,
 * or wait before managing containers.
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
const globalState = require('../utils/globalState');
const nodeConfirmationService = require('../nodeConfirmationService');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const { localAppsInformation, SIGTERM_EXPIRY_MS, RUNNING_EXPIRY_MS } = require('../utils/appConstants');
const { appUsesGSyncthingMode, getNonGComponentIdentifiers, parseContainerName, appHasValidLocationOnNode } = require('../utils/appUtilities');

const SYNC_TIMEOUT_MS = 5 * 60 * 1000;

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
    log.error(`appStartupManager - Error getting installed apps: ${error.message}`);
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
    log.error(`appStartupManager - Error getting stopped containers: ${error.message}`);
    return [];
  }
}

/**
 * Reconcile local app state against the network on boot. For each stopped
 * container, checks whether this node still has a valid location record.
 * - Valid location, non-g components: started.
 * - Valid location, g: components: left stopped (managed by masterSlaveApps).
 * - Expired/missing location: app removed locally (node was reassigned).
 * @returns {Promise<Object>} Results of the reconciliation
 */
async function reconcileAppsOnBoot() {
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
    log.info('appStartupManager - Starting stopped apps recovery check');

    // Get all installed apps from database (just to get the list of app names)
    const installedApps = await getInstalledAppsFromDb();
    if (installedApps.length === 0) {
      log.info('appStartupManager - No installed apps found');
      return results;
    }

    // Create a set for quick lookup of installed app names
    const installedAppNames = new Set(installedApps.map((app) => app.name));

    // Get all stopped Flux containers
    const stoppedContainers = await getStoppedFluxContainers();
    if (stoppedContainers.length === 0) {
      log.info('appStartupManager - No stopped containers found');
      return results;
    }

    log.info(`appStartupManager - Found ${stoppedContainers.length} stopped Flux containers`);

    // Get unique app names from stopped containers
    const appsWithStoppedContainers = new Set();
    for (const container of stoppedContainers) {
      const containerName = container.Names[0];
      const { appName } = parseContainerName(containerName);
      appsWithStoppedContainers.add(appName);
    }

    log.info(`appStartupManager - Stopped containers belong to ${appsWithStoppedContainers.size} app(s)`);

    // Get this node's IP for location checks
    const myIp = await fluxNetworkHelper.getMyFluxIPandPort();

    // Process each app
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsWithStoppedContainers) {
      results.appsChecked += 1;

      log.info(`appStartupManager - Checking app ${appName}`);

      // Check if app is installed
      if (!installedAppNames.has(appName)) {
        log.warn(`appStartupManager - App ${appName} not in installed apps list, skipping all its containers`);
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
        log.error(`appStartupManager - Error fetching specs for app ${appName}: ${specError.message}`);
      }

      if (!appSpec) {
        log.warn(`appStartupManager - No global spec found for app ${appName}, skipping all its containers`);
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
        log.info(`appStartupManager - App ${appName} uses g: syncthing mode in every component, skipping (managed by masterSlaveApps)`);
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
          log.warn(`appStartupManager - App ${appName} no longer has a valid location record for this node (${myIp}), removing locally`);
          try {
            // eslint-disable-next-line no-await-in-loop
            await appUninstaller.removeAppLocally(appName, null, true, true, false);
            results.appsRemoved.push(appName);
            log.info(`appStartupManager - App ${appName} removed locally (was reassigned to another node)`);
          } catch (removeError) {
            log.error(`appStartupManager - Failed to remove app ${appName}: ${removeError.message}`);
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
        log.info(`appStartupManager - App ${appName} has valid location, starting ${componentsToStart.length}/${totalComponents} non-g components (g: components managed by masterSlaveApps)`);
      } else {
        log.info(`appStartupManager - App ${appName} has valid location, starting app`);
      }

      let anyComponentFailed = false;
      // eslint-disable-next-line no-restricted-syntax
      for (const identifier of componentsToStart) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await advancedWorkflows.appDockerStart(identifier);
          log.info(`appStartupManager - Successfully started ${identifier}`);
          // Add small delay between starts to avoid overwhelming the system
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(2000);
        } catch (startError) {
          anyComponentFailed = true;
          log.error(`appStartupManager - Failed to start ${identifier}: ${startError.message}`);
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
      'appStartupManager - Recovery complete. '
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
    log.error(`appStartupManager - Critical error during recovery: ${error.message}`);
  }
}

async function removeAllApps(reason) {
  const appQueryService = require('../appQuery/appQueryService');
  const installedAppsRes = await appQueryService.installedApps();
  if (installedAppsRes.status === 'success') {
    for (const app of installedAppsRes.data) {
      log.warn(`REMOVAL REASON: ${reason} - removing ${app.name}`);
      // eslint-disable-next-line no-await-in-loop
      await appUninstaller.removeAppLocally(app.name, null, true, false, true);
    }
  }
}

async function manageAppsOnBoot(bootContext) {
  try {
    if (!bootContext.machineRebooted) {
      log.info('appStartupManager - FluxOS-only restart, containers already running');
      return;
    }

    if (bootContext.firstBoot) {
      log.info('appStartupManager - First boot (no heartbeat history), waiting for sync');
    } else {
      const locationsExpired = (bootContext.cleanShutdown && bootContext.downtimeMs > SIGTERM_EXPIRY_MS)
        || bootContext.downtimeMs > RUNNING_EXPIRY_MS;

      if (locationsExpired) {
        log.info(`appStartupManager - Locations expired (downtime ${Math.round(bootContext.downtimeMs / 1000)}s, cleanShutdown=${bootContext.cleanShutdown}), removing all apps`);
        await removeAllApps('Locations expired');
        return;
      }
    }

    // Machine rebooted, locations still valid — wait for daemon + sync then reconcile.
    const DAEMON_TIMEOUT_MS = 5 * 60 * 1000;
    try {
      await Promise.race([
        globalState.waitForDaemonReady(),
        new Promise((_, reject) => { setTimeout(() => reject(new Error('daemon_timeout')), DAEMON_TIMEOUT_MS); }),
      ]);
    } catch (error) {
      if (error.message === 'daemon_timeout') {
        log.error(`appStartupManager - Daemon not ready after ${DAEMON_TIMEOUT_MS / 1000}s, removing all apps`);
        await removeAllApps('Daemon unavailable');
        return;
      }
      throw error;
    }

    await nodeConfirmationService.waitForConfirmationStatus();
    if (!nodeConfirmationService.isConfirmed()) {
      log.info('appStartupManager - Node not confirmed, removing all apps');
      await removeAllApps('Node not confirmed');
      return;
    }

    if (fluxNetworkHelper.isNodeDos()) {
      log.error('appStartupManager - Node is in DOS state, removing all apps');
      await removeAllApps('Node DOS');
      return;
    }

    try {
      await Promise.race([
        globalState.waitForDbReady(),
        new Promise((_, reject) => { setTimeout(() => reject(new Error('sync_timeout')), SYNC_TIMEOUT_MS); }),
      ]);
    } catch (error) {
      if (error.message === 'sync_timeout') {
        log.error(`appStartupManager - DB not ready after ${SYNC_TIMEOUT_MS / 1000}s, removing all apps`);
        await removeAllApps('Sync timeout');
        return;
      }
      throw error;
    }

    log.info('appStartupManager - Daemon, DB, and node confirmed, reconciling apps');
    await reconcileAppsOnBoot();
  } finally {
    globalState.bootContainerStateSettled = true;
    log.info('appStartupManager - Boot container state settled');
  }
}

module.exports = {
  manageAppsOnBoot,
  reconcileAppsOnBoot,
  getStoppedFluxContainers,
  getInstalledAppsFromDb,
};
