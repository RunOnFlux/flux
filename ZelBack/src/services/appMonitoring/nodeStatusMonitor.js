// Node Status Monitor - Monitors node status and uninstalls apps if node is not confirmed
const axios = require('axios');
const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const messageStore = require('../appMessaging/messageStore');
const nodeConfirmationService = require('../nodeConfirmationService');
const networkStateService = require('../networkStateService');
const hostStallService = require('../hostStallService');
const appKill = require('../appLifecycle/appKill');
const dockerService = require('../dockerService');
const { RemovalOutcome } = require('../utils/removalOutcome');
const { withinDeadline, TIMED_OUT } = require('../utils/withinDeadline');
const fluxEventBus = require('../utils/fluxEventBus');
const globalState = require('../utils/globalState');
const log = require('../../lib/log');
const { extractIp, extractPort } = require('../utils/socketAddressUtils');

let removalInProgress = false;
let unloadingForHostStall = false;
/** What initialize was given, for the removal a host stall starts. */
let deps = null;

const REMOVAL_DEADLINE_MS = config.fluxapps.appRemovalDeadlineMs;
const STOP_WINDOW_MS = config.hostStall.stopWindowMs;
const STILL_REMOVING = 'stillRemoving';
/** Apps whose removal started here and has not returned, deadline or not. */
const removalsRunning = new Set();

/**
 * Remove one app, waiting for it at most REMOVAL_DEADLINE_MS. A removal past
 * its deadline keeps running, so an app whose removal is still running is not
 * removed again: a second removal beside it would only wait behind the same
 * stall, and the next pass would add a third. Boot removes through this too, so a
 * removal boot stopped waiting for is one the monitor does not start again.
 * @param {Function} removeAppLocallyFn
 * @param {string} name
 * @returns {Promise<string>} The removal's outcome, TIMED_OUT, or STILL_REMOVING.
 */
async function removeWithinDeadline(removeAppLocallyFn, name) {
  if (removalsRunning.has(name)) return STILL_REMOVING;
  removalsRunning.add(name);
  const removal = Promise.resolve()
    .then(() => removeAppLocallyFn(name, null, true, false, true))
    .finally(() => removalsRunning.delete(name));
  return withinDeadline(removal, REMOVAL_DEADLINE_MS);
}

// Database collections
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

/**
 * Remove every installed app but `skip`, one after another.
 * @param {Function} installedAppsFn
 * @param {Function} removeAppLocallyFn
 * @param {string} reason
 * @param {string|null} skip
 * @returns {Promise<void>}
 */
async function removeInstalledApps(installedAppsFn, removeAppLocallyFn, reason, skip) {
  const installedAppsRes = await installedAppsFn();
  if (installedAppsRes.status !== 'success') {
    throw new Error('monitorNodeStatus - Failed to get installed Apps');
  }
  let removedOne = false;
  for (const installedApp of installedAppsRes.data) {
    // a host stall's own removal has the node, and this one gives way to it
    if (unloadingForHostStall) return;
    if (installedApp.name !== skip) {
      if (removedOne) {
        // Each removal sends its own fluxappremoved before its teardown, a teardown
        // can take under a second, and every node relays each message: unspaced, a
        // node holding maxAppsPerNode apps sends that many at once. The spacing goes
        // once the node's apps are named in one message, sent apart from their
        // teardowns: v9 sends a removal's message before a teardown it can defer,
        // still one app to a message.
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(config.fluxapps.nodeMonitorRemovalDelayMs);
        if (unloadingForHostStall) return;
      }
      removedOne = true;
      log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed: ${reason}`);
      log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
      // One removal that never returns must not hold every other app here.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await removeWithinDeadline(removeAppLocallyFn, installedApp.name);
      if (outcome === TIMED_OUT) {
        log.error(`monitorNodeStatus - Application ${installedApp.name} was not removed within ${REMOVAL_DEADLINE_MS / 1000}s, moving on`);
      } else if (outcome === STILL_REMOVING) {
        log.warn(`monitorNodeStatus - Application ${installedApp.name} is still being removed, moving on`);
      } else {
        log.warn(`monitorNodeStatus - Application ${installedApp.name} locally removed`);
      }
    }
  }
}

/**
 * Why this node is out of service now, from the same reads as the monitor's own
 * pass, or null while it is in service.
 * @returns {string|null}
 */
function outOfService() {
  if (fluxNetworkHelper.isNodeDos()) return 'DOS state >= 100';
  if (nodeConfirmationService.isDaemonStale()) return 'daemon unreachable';
  if (!nodeConfirmationService.isConfirmed()) return 'node not confirmed';
  return null;
}

/**
 * Remove every app from a node that is out of service.
 *
 * An install cannot be cancelled, and removing its app while it runs leaves the
 * containers it goes on to create with no record of the app. So the app an
 * install is running for is left to that install: every other app is removed
 * first, and once the install has released the node, whatever it left installed
 * is removed too if the node is out of service then. The wait has no deadline -
 * an image pull that keeps moving can take most of an hour, and one that stops
 * fails after pullStallMs - and holds nothing but this removal: every other app
 * is gone before it starts. This is a stopgap until installs can be cancelled,
 * as v9's are by the removal of their app.
 * @param {Function} installedAppsFn - Function to get installed apps
 * @param {Function} removeAppLocallyFn - Function to remove apps locally
 * @param {string} reason
 * @returns {Promise<void>}
 */
// eslint-disable-next-line consistent-return
async function removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, reason) {
  if (removalInProgress) return;
  removalInProgress = true;
  try {
    const installRunning = globalState.installationInProgress;
    const installing = installRunning ? globalState.installingApp : null;
    await removeInstalledApps(installedAppsFn, removeAppLocallyFn, reason, installing);
    if (unloadingForHostStall || !(installRunning || globalState.installationInProgress)) return;
    log.info(`monitorNodeStatus - waiting for the running install${installing ? ` of ${installing}` : ''} to finish before removing what it installed: ${reason}`);
    await globalState.whenInstallationReleased();
    // decided by the node's standing now, not by what made it remove the others
    const stillOut = outOfService();
    if (!stillOut) {
      log.info(`monitorNodeStatus - back in service while the install${installing ? ` of ${installing}` : ''} ran, leaving what it installed`);
      return;
    }
    await removeInstalledApps(installedAppsFn, removeAppLocallyFn, stillOut, null);
  } finally {
    removalInProgress = false;
  }
}

/**
 * Removal started from a listener: nothing awaits it, so its failure is logged
 * here. The periodic monitor tries again on its next pass.
 * @param {Function} installedAppsFn
 * @param {Function} removeAppLocallyFn
 * @param {string} reason
 * @returns {Promise<void>}
 */
async function removeAllAppsOnSignal(installedAppsFn, removeAppLocallyFn, reason) {
  try {
    await removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, reason);
  } catch (error) {
    log.error(`monitorNodeStatus - app removal (${reason}) failed: ${error.message}`);
  }
}

/**
 * Ask docker to stop every container of the app, on its normal grace.
 * @param {string} name
 * @param {Array<object>|null} containers appKill.readContainers
 * @returns {Promise<void>}
 */
async function stopApp(name, containers) {
  await Promise.allSettled(appKill.containersOf(name, containers).map((container) => dockerService.appDockerStop(container)));
}

/**
 * Remove every app from a node whose host is stalled, and make sure none can
 * run again before the network is told.
 *
 * Every app is asked to stop at once, and all of them share one STOP_WINDOW_MS:
 * a docker that can still deliver a stop signal stops each app cleanly, and one
 * that cannot costs the window once, not once per app. Whatever of each app can
 * still run after the window is killed through its cgroups and checked: an app
 * whose every process is gone or has the kill pending can never run its code
 * again. Then each app gets its normal removal, which tells the network, within
 * REMOVAL_DEADLINE_MS; nothing of it runs by then, so the removals take turns.
 *
 * The apps are read from the database and from what is on disk, at once, so an
 * app the database cannot list is still found. Docker's records of its
 * containers are read once, within STOP_WINDOW_MS: on a disk that does not answer
 * they are not waited for further, and every app is still stopped and killed
 * through its slice, with every container outside the slices (appKill). An app
 * is reported with runnable null only when systemd does not say which containers
 * are outside the slices.
 * @param {Function} installedAppsFn
 * @param {Function} removeAppLocallyFn
 */
async function unloadForHostStall(installedAppsFn, removeAppLocallyFn) {
  if (unloadingForHostStall) return;
  unloadingForHostStall = true;
  try {
    // Read at once: a stall that holds one of them is likely to hold the other.
    const [listed, read] = await Promise.all([
      withinDeadline(installedAppsFn(), REMOVAL_DEADLINE_MS).catch(() => null),
      withinDeadline(appKill.readContainers(), STOP_WINDOW_MS),
    ]);
    const installed = listed?.status === 'success' ? listed.data.map((app) => app.name) : [];
    const containers = Array.isArray(read) ? read : null;
    if (!containers) log.error(`monitorNodeStatus - host stall: docker's container records could not be read (${read === TIMED_OUT ? 'no answer' : 'refused'}); every container outside the app slices is killed`);
    const names = [...new Set([...installed, ...await appKill.appsOnDisk(containers)])];
    log.warn(`monitorNodeStatus - host stall: stopping ${names.length} applications within one ${STOP_WINDOW_MS / 1000}s window`);
    await withinDeadline(Promise.allSettled(names.map((name) => stopApp(name, containers))), STOP_WINDOW_MS);

    // With no records, a container outside the slices cannot be named, whatever apps
    // were found: every one is killed and checked, once.
    let outsideSlices;
    if (!containers) {
      const killedIn = await appKill.killOutsideSlices();
      const runnable = await appKill.stillRunnableOutsideSlices();
      outsideSlices = { containers: killedIn?.length ?? null, runnable };
      if (runnable === null) log.error('monitorNodeStatus - host stall: which containers are outside the app slices cannot be known');
      else if (runnable.length) log.error(`monitorNodeStatus - host stall: processes ${runnable.join(', ')} of containers outside the app slices can still run`);
      else log.warn(`monitorNodeStatus - host stall: nothing of the ${killedIn.length} containers outside the app slices can run`);
    }

    const stopped = new Map();
    // eslint-disable-next-line no-restricted-syntax
    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop
      let runnable = await appKill.stillRunnable(name, containers);
      const killed = Boolean(runnable?.length);
      if (killed) {
        log.error(`monitorNodeStatus - Application ${name} still runs after being asked to stop, killing it`);
        // eslint-disable-next-line no-await-in-loop
        await appKill.kill(name, containers);
        // eslint-disable-next-line no-await-in-loop
        runnable = await appKill.stillRunnable(name, containers);
        if (runnable?.length) {
          log.error(`monitorNodeStatus - Application ${name} could not be stopped: processes ${runnable.join(', ')} can still run`);
        } else if (runnable) {
          log.warn(`monitorNodeStatus - Application ${name} can no longer run`);
        }
      }
      if (runnable === null) log.error(`monitorNodeStatus - Application ${name}: whether it can still run cannot be known`);
      stopped.set(name, { killed, runnable });
    }
    // runnable: the processes of each app that can still run its code, empty when
    // none can, null when that cannot be known; outsideSlices, when the records could
    // not be read: how many containers outside the slices were killed, and which of
    // their processes can still run
    fluxEventBus.publish('hostStall:appsStopped', {
      apps: names.map((name) => ({ app: name, ...stopped.get(name) })),
      ...(outsideSlices ? { outsideSlices } : {}),
    });

    // eslint-disable-next-line no-restricted-syntax
    for (const name of names) {
      log.warn(`monitorNodeStatus - Application ${name} going to be removed: host stall`);
      // eslint-disable-next-line no-await-in-loop
      const outcome = await removeWithinDeadline(removeAppLocallyFn, name)
        .catch(() => RemovalOutcome.FAILED);
      const { killed, runnable } = stopped.get(name);
      if (runnable?.length === 0 && outcome !== RemovalOutcome.REMOVED && outcome !== RemovalOutcome.NOT_INSTALLED) {
        log.warn(`monitorNodeStatus - Application ${name} was not removed (${outcome}), and can no longer run`);
      }
      fluxEventBus.publish('hostStall:appUnloaded', {
        app: name, removal: outcome, killed, runnable,
      });
    }
  } finally {
    unloadingForHostStall = false;
  }
}

/** The removal a host stall starts. Nothing awaits it, so its failure is logged here. */
async function unloadOnHostStall() {
  try {
    await unloadForHostStall(deps.installedAppsFn, deps.removeAppLocallyFn);
  } catch (error) {
    log.error(`monitorNodeStatus - app removal (host stall) failed: ${error.message}`);
  }
}

function initialize(installedAppsFn, removeAppLocallyFn) {
  deps = { installedAppsFn, removeAppLocallyFn };
  hostStallService.onTrip(unloadOnHostStall);
  nodeConfirmationService.onConfirmationChange((confirmed) => {
    if (!confirmed) {
      log.info('monitorNodeStatus - Confirmation lost, triggering immediate app removal');
      removeAllAppsOnSignal(installedAppsFn, removeAppLocallyFn, 'node lost confirmation');
    }
  });
  fluxNetworkHelper.onIpChangeHold((ipChanges) => {
    log.info(`monitorNodeStatus - ${ipChanges} IP changes over the limit, triggering app removal`);
    removeAllAppsOnSignal(installedAppsFn, removeAppLocallyFn, 'IP changes over the limit');
  });
  nodeConfirmationService.onDaemonStale(() => {
    log.info('monitorNodeStatus - Daemon stale, triggering app removal');
    removeAllAppsOnSignal(installedAppsFn, removeAppLocallyFn, 'daemon unreachable');
  });
}

async function monitorNodeStatus(installedAppsFn, removeAppLocallyFn) {
  try {
    if (fluxNetworkHelper.isNodeDos()) {
      await removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, 'DOS state >= 100');
      await serviceHelper.delay(config.fluxapps.nodeMonitorDosRecoveryDelayMs ?? 600000);
      return monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
    }
    if (nodeConfirmationService.isDaemonStale()) {
      await removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, 'daemon unreachable (backstop)');
      await serviceHelper.delay(config.fluxapps.nodeMonitorConfirmationLossDelayMs ?? 1200000);
      return monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
    }
    if (!nodeConfirmationService.isConfirmed()) {
      await removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, 'node not confirmed');
      await serviceHelper.delay(config.fluxapps.nodeMonitorConfirmationLossDelayMs ?? 1200000);
      return monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
    } if (nodeConfirmationService.isConfirmed()) {
      log.info('monitorNodeStatus - Node is Confirmed');
      // Everything above this point is app removal and needs no node list. What
      // follows compares every app location against it, so an unknown list
      // makes every location read as departed and sends the whole set down the
      // HTTP probe path. The accessors wait for the list, and this loop only
      // re-arms once it has finished, so it checks and comes back rather than
      // awaiting in here - the same shape as the branches above.
      if (!networkStateService.isReady()) {
        log.info('monitorNodeStatus - node list not known yet, deferring the location sweep');
        await serviceHelper.delay(config.fluxapps.nodeMonitorCheckIntervalMs ?? 120000);
        return monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
      }
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
      let endIndex = Math.min(chunkSize, appsLocationCount);

      while (startIndex < appsLocationCount) {
        const chunk = appslocations.slice(startIndex, endIndex);
        // eslint-disable-next-line no-await-in-loop
        await iterChunk(chunk);

        startIndex = endIndex;
        endIndex += chunk.length;
      }

      log.info(`monitorNodeStatus - Found ${appsLocationsNotOnNodelist.length} IP(s) not present on deterministic node list`);
      // eslint-disable-next-line no-restricted-syntax
      for (const location of appsLocationsNotOnNodelist) {
        log.info(`monitorNodeStatus - Checking IP ${location}.`);
        const ip = extractIp(location);
        const port = extractPort(location);
        const { CancelToken } = axios;
        const source = CancelToken.source();
        let isResolved = false;
        const timeout = config.fluxapps.nodeMonitorCheckTimeoutMs ?? 10000;
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
          // eslint-disable-next-line no-await-in-loop
          await messageStore.applyEviction(location, Date.now());
        }
      }
    }
    await serviceHelper.delay(config.fluxapps.nodeMonitorIntervalMs ?? 1200000);
    monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(config.fluxapps.nodeMonitorErrorRecoveryDelayMs ?? 120000);
    monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
  }
}

/**
 * Start the monitor once boot has settled, whatever boot decided: boot removes
 * every app itself when the node may run none, and the two never remove at once.
 * @param {Function} installedAppsFn
 * @param {Function} removeAppLocallyFn
 */
async function start(installedAppsFn, removeAppLocallyFn) {
  await globalState.waitForBootContainerStateSettled();
  monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
}

module.exports = {
  initialize,
  start,
  monitorNodeStatus,
  removeWithinDeadline,
  unloadForHostStall,
  STILL_REMOVING,
};
