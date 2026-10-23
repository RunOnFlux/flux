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
const appReconciler = require('../appMonitoring/appReconciler');
const appUninstaller = require('./appUninstaller');
const appNetworkLinker = require('./appNetworkLinker');
const appSlice = require('./appSlice');
const nodeStatusMonitor = require('../appMonitoring/nodeStatusMonitor');
const { TIMED_OUT } = require('../utils/withinDeadline');
const portManager = require('../appNetwork/portManager');
const globalState = require('../utils/globalState');
const fluxEventBus = require('../utils/fluxEventBus');
const nodeConfirmationService = require('../nodeConfirmationService');
const { localAppsInformation, SIGTERM_EXPIRY_MS, RUNNING_EXPIRY_MS } = require('../utils/appConstants');
const { getNonGComponentIdentifiers, parseContainerName, appHasValidLocationOnNode } = require('../utils/appUtilities');
const { RemovalOutcome } = require('../utils/removalOutcome');
const { untilSucceeds, BOOT_STEP_RETRY_MS } = require('../utils/untilSucceeds');

const SYNC_TIMEOUT_MS = config.system.bootSyncTimeoutMs ?? 300000;

/**
 * Await a promise, giving up after a deadline. The timer is cleared however the
 * race ends, so work that finishes early leaves nothing pending behind it.
 * @param {Promise<any>} work What to wait for.
 * @param {number} timeoutMs How long to wait.
 * @param {string} reason Message of the error thrown when the deadline passes.
 * @returns {Promise<any>} Whatever `work` resolved to.
 */
async function awaitWithin(work, timeoutMs, reason) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(reason)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get all installed apps from local database
 * @returns {Promise<Array>} Array of installed app specifications
 */
async function getInstalledAppsFromDb() {
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appslocal.database);
  const appsQuery = {};
  const appsProjection = {
    projection: { _id: 0 },
  };
  const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
  return apps || [];
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
 * Opens every installed app's ports in the firewall, in one ufw batch, before
 * the apps start. ufw keeps the rules across restarts and skips one it already
 * holds, so this changes nothing unless the rules were lost, as a ufw reset
 * loses them. An app whose specification cannot be read is left out and
 * logged; a failure is logged and the apps still start.
 */
async function openInstalledAppPorts() {
  try {
    const { apps, unreadable } = await portManager.appsWithPorts(await getInstalledAppsFromDb());
    if (unreadable.length) log.warn(`appStartupManager - ports of ${unreadable.length} installed app(s) not opened in the firewall: specification unreadable`);
    const ports = apps.flatMap((app) => app.ports).map((port) => serviceHelper.ensureNumber(port));
    if (!ports.length) return;
    const { failed, locked } = await fluxNetworkHelper.allowAppPorts(ports);
    if (locked) log.warn('appStartupManager - app ports not opened in the firewall: ufw is locked by another ufw command');
    failed.forEach(({ rule, error }) => log.warn(`appStartupManager - app port not opened in the firewall: ufw ${rule}: ${error}`));
  } catch (error) {
    log.error(`appStartupManager - app ports not opened in the firewall: ${error.message}`);
  }
}


/**
 * Removes an app whose location this node no longer holds. The network has dropped
 * the record, so the removal tells it nothing. A removal that does not finish holds
 * the app as departing - never started by the reconciler, never announced as
 * running - and is run again until it does.
 * @param {string} appName
 * @returns {Promise<boolean>} Whether the app is gone now.
 */
async function removeAppBootMayNotStart(appName) {
  const outcome = await appUninstaller.removeAppLocally(appName, null, true, true, false);
  if (outcome === RemovalOutcome.REMOVED || outcome === RemovalOutcome.NOT_INSTALLED) return true;
  appUninstaller.finishRemoval(appName, true, false);
  return false;
}

/**
 * Hands the components boot starts to the reconciler.
 * @param {string[]} componentsToStart
 * @returns {void}
 */
function startAtBoot(componentsToStart) {
  // the reconciler actuates once the boot gate opens (daemon/DB ready) and applies
  // desired-state + restart policy
  // eslint-disable-next-line no-restricted-syntax
  for (const identifier of componentsToStart) {
    appReconciler.enqueue(identifier);
    log.info(`appStartupManager - Queued ${identifier} for reconcile`);
  }
}

/**
 * Whether this node holds an unexpired location record for an app.
 * @param {string} appName
 * @param {string} localSocketAddr
 * @returns {Promise<boolean>}
 * @throws {Error} When the records cannot be read.
 */
async function readLocation(appName, localSocketAddr) {
  const valid = await appHasValidLocationOnNode(appName, localSocketAddr);
  if (valid === null) throw new Error(`the location record of ${appName} could not be read`);
  return valid;
}

/**
 * Decides an app held in globalState.unconfirmedApps once its location record can
 * be read, reading it every BOOT_STEP_RETRY_MS until then. A valid record releases
 * the app and starts the components boot starts; any other answer removes it, the
 * app held until the removal has finished or holds it as departing. An app whose
 * hold has ended by then - uninstalled meanwhile, perhaps installed again since -
 * is not this check's to decide, and it does nothing.
 * @param {string} appName
 * @param {string[]} componentsToStart
 * @param {string} localSocketAddr
 * @param {symbol} hold The hold this check decides, as boot set it.
 * @returns {Promise<void>}
 */
async function confirmHeldApp(appName, componentsToStart, localSocketAddr, hold) {
  const isHeld = () => globalState.unconfirmedApps.get(appName) === hold;
  await serviceHelper.delay(BOOT_STEP_RETRY_MS);
  const valid = await untilSucceeds(`Location check of ${appName}`, () => readLocation(appName, localSocketAddr));
  await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.BOOT_BEFORE_LOCATION_DECISION, appName);
  // Nothing awaits between this check and the decision below, so the hold cannot
  // end in between.
  if (!isHeld()) {
    log.info(`appStartupManager - App ${appName}: its hold ended before its location record was read, nothing to decide`);
    fluxEventBus.publish('boot:appConfirmed', { name: appName, valid, released: true });
    return;
  }
  fluxEventBus.publish('boot:appConfirmed', { name: appName, valid });
  if (valid) {
    log.info(`appStartupManager - App ${appName}: its location record is valid, starting it`);
    globalState.unconfirmedApps.delete(appName);
    startAtBoot(componentsToStart);
    return;
  }
  log.warn(`appStartupManager - App ${appName}: no valid location record for this node (${localSocketAddr}), removing locally`);
  try {
    await removeAppBootMayNotStart(appName);
  } finally {
    if (isHeld()) globalState.unconfirmedApps.delete(appName);
  }
}
/**
 * Reconcile local app state against the network on boot. For each stopped
 * container, checks whether this node still has a valid location record.
 * - Valid location, non-g components: started.
 * - Valid location, g: components: left stopped (managed by masterSlaveApps).
 * - Expired/missing location: app removed locally (node was reassigned).
 * - Unreadable location: app held stopped until the record can be read, then
 *   decided as above (confirmHeldApp).
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
    appsUnconfirmed: [], // location unreadable: held stopped until it can be read
    appsFailed: [],
  };

  try {
    log.info('appStartupManager - Starting boot reconciliation check');

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
    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();

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
      if (localSocketAddr) {
        // eslint-disable-next-line no-await-in-loop
        const hasValidLocation = await appHasValidLocationOnNode(appName, localSocketAddr);
        if (hasValidLocation === null) {
          // Whether the network placed it elsewhere while this node was down is not
          // known, so it is neither started nor removed until it is.
          log.warn(`appStartupManager - App ${appName}: its location record could not be read, held stopped until it can be`);
          const hold = Symbol(appName);
          globalState.unconfirmedApps.set(appName, hold);
          fluxEventBus.publish('boot:appUnconfirmed', { name: appName });
          confirmHeldApp(appName, componentsToStart, localSocketAddr, hold)
            .catch((error) => log.error(`appStartupManager - App ${appName}: the location check stopped: ${error.message}`));
          results.appsUnconfirmed.push(appName);
          // eslint-disable-next-line no-continue
          continue;
        }
        if (!hasValidLocation) {
          // placed elsewhere while this node was down: removed, never started
          log.warn(`appStartupManager - App ${appName}: no valid location record for this node (${localSocketAddr}), removing locally`);
          // eslint-disable-next-line no-await-in-loop
          const removed = await removeAppBootMayNotStart(appName);
          if (removed) results.appsRemoved.push(appName);
          else results.appsFailed.push({ app: appName, error: 'not removed; held stopped until it is' });
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

      startAtBoot(componentsToStart);

      if (isPartial) {
        results.appsPartiallyStarted.push(appName);
      } else {
        results.appsStarted.push(appName);
      }
    }

    log.info(
      'appStartupManager - Recovery complete. '
      + `Apps checked: ${results.appsChecked}, `
      + `Apps started: ${results.appsStarted.length}, `
      + `Apps partially started (mixed g:): ${results.appsPartiallyStarted.length}, `
      + `Apps removed (expired location): ${results.appsRemoved.length}, `
      + `Apps held (location unreadable): ${results.appsUnconfirmed.length}, `
      + `Apps skipped (g: mode): ${results.appsSkippedGMode.length}, `
      + `Apps skipped (no spec): ${results.appsSkippedNoSpec.length}, `
      + `Apps failed: ${results.appsFailed.length}`,
    );

    // Re-apply app-to-app network links (networkWith token in the description).
    // Idempotent and best-effort — defensive in case docker did not restore a
    // secondary network membership across the reboot.
    await appNetworkLinker.reconcileAllAppNetworkLinks();

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
      // One removal that never returns must not hold boot, or every app after it.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await nodeStatusMonitor.removeWithinDeadline(appUninstaller.removeAppLocally, app.name, true);
      if (outcome === TIMED_OUT) log.error(`appStartupManager - ${app.name} was not removed within ${config.fluxapps.appRemovalDeadlineMs / 1000}s, moving on`);
      else if (outcome === nodeStatusMonitor.STILL_REMOVING) log.warn(`appStartupManager - ${app.name} is still being removed, moving on`);
    }
  }
}

async function manageAppsOnBoot(bootContext) {
  try {
    // ahead of every container start, so no slice in use can be empty here
    await appSlice.stopEmptySlices();
    if (bootContext.firstBoot) {
      log.info('appStartupManager - First boot (no heartbeat history), waiting for sync');
    } else if (bootContext.unreadable) {
      log.warn('appStartupManager - Boot context unreadable: whether locations expired is decided app by app');
    } else {
      const locationsExpired = (bootContext.cleanShutdown && bootContext.downtimeMs > SIGTERM_EXPIRY_MS)
        || bootContext.downtimeMs > RUNNING_EXPIRY_MS;

      if (locationsExpired) {
        log.info(`appStartupManager - Locations expired (downtime ${Math.round(bootContext.downtimeMs / 1000)}s, cleanShutdown=${bootContext.cleanShutdown}), removing all apps`);
        await removeAllApps('Locations expired');
        return;
      }
    }

    // Locations still valid — wait for daemon + sync then reconcile.
    const DAEMON_TIMEOUT_MS = config.system.bootDaemonTimeoutMs ?? 300000;
    try {
      await awaitWithin(globalState.waitForDaemonReady(), DAEMON_TIMEOUT_MS, 'daemon_timeout');
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

    if (fluxNetworkHelper.isStickyDosHeldBy(fluxNetworkHelper.StickyDosOwner.HOST_STALL)) {
      log.error('appStartupManager - Node is out of service for a host stall; its own removal unloads the apps');
      return;
    }

    if (fluxNetworkHelper.isNodeDos()) {
      log.error('appStartupManager - Node is in DOS state, removing all apps');
      await removeAllApps('Node DOS');
      return;
    }

    try {
      await awaitWithin(globalState.waitForDbReady(), SYNC_TIMEOUT_MS, 'sync_timeout');
    } catch (error) {
      if (error.message === 'sync_timeout') {
        log.error(`appStartupManager - DB not ready after ${SYNC_TIMEOUT_MS / 1000}s, removing all apps`);
        await removeAllApps('Sync timeout');
        return;
      }
      throw error;
    }

    log.info('appStartupManager - Daemon, DB, and node confirmed, reconciling apps');
    await openInstalledAppPorts();
    await reconcileAppsOnBoot();
  } finally {
    globalState.bootContainerStateSettled = true;
    fluxEventBus.publish('boot:settled', {});
    log.info('appStartupManager - Boot container state settled');
  }
}

module.exports = {
  manageAppsOnBoot,
  openInstalledAppPorts,
  reconcileAppsOnBoot,
  getStoppedFluxContainers,
  getInstalledAppsFromDb,
};
