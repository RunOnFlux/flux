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
const { RemovalOutcome } = require('../utils/removalOutcome');
const { withinDeadline, TIMED_OUT } = require('../utils/withinDeadline');
const fluxEventBus = require('../utils/fluxEventBus');
const log = require('../../lib/log');
const { extractIp, extractPort } = require('../utils/socketAddressUtils');

let removalInProgress = false;
let unloadingForHostStall = false;
/** What initialize was given, for the removal a host stall starts. */
let deps = null;

const REMOVAL_DEADLINE_MS = config.fluxapps.appRemovalDeadlineMs;
const STILL_REMOVING = 'stillRemoving';
/** Apps whose removal started here and has not returned, deadline or not. */
const removalsRunning = new Set();

/**
 * Remove one app, waiting for it at most REMOVAL_DEADLINE_MS. A removal past
 * its deadline keeps running, so an app whose removal is still running is not
 * removed again: a second removal beside it would only wait behind the same
 * stall, and the next pass would add a third.
 * @param {Function} removeAppLocallyFn
 * @param {string} name
 * @param {boolean} canBroadcast
 * @returns {Promise<string>} The removal's outcome, TIMED_OUT, or STILL_REMOVING.
 */
async function removeWithinDeadline(removeAppLocallyFn, name, canBroadcast) {
  if (removalsRunning.has(name)) return STILL_REMOVING;
  removalsRunning.add(name);
  const removal = Promise.resolve()
    .then(() => removeAppLocallyFn(name, null, true, false, canBroadcast))
    .finally(() => removalsRunning.delete(name));
  return withinDeadline(removal, REMOVAL_DEADLINE_MS);
}

// Database collections
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

/**
 * Method responsible to monitor node status and uninstall apps if node is not confirmed
 * @param {Function} installedAppsFn - Function to get installed apps
 * @param {Function} removeAppLocallyFn - Function to remove apps locally
 * @returns {Promise<void>}
 */
// eslint-disable-next-line consistent-return
async function removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, reason) {
  if (removalInProgress) return;
  removalInProgress = true;
  try {
    const installedAppsRes = await installedAppsFn();
    if (installedAppsRes.status !== 'success') {
      throw new Error('monitorNodeStatus - Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const canBroadcast = nodeConfirmationService.canSendMessages();
    for (const installedApp of appsInstalled) {
      // a host stall's own removal has the node, and this one gives way to it
      if (unloadingForHostStall) break;
      log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed: ${reason}`);
      log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
      // One removal that never returns must not hold every other app here.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await removeWithinDeadline(removeAppLocallyFn, installedApp.name, canBroadcast);
      if (outcome === TIMED_OUT) {
        log.error(`monitorNodeStatus - Application ${installedApp.name} was not removed within ${REMOVAL_DEADLINE_MS / 1000}s, moving on`);
      } else if (outcome === STILL_REMOVING) {
        log.warn(`monitorNodeStatus - Application ${installedApp.name} is still being removed, moving on`);
      } else {
        log.warn(`monitorNodeStatus - Application ${installedApp.name} locally removed`);
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(config.fluxapps.nodeMonitorRemovalDelayMs ?? 60000);
    }
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
 * Remove every app from a node whose host is stalled, and make sure none can
 * run again. Each app gets its normal removal, which stops its containers before
 * it tells the network, within REMOVAL_DEADLINE_MS. Whatever of it can still run
 * afterwards is killed through its cgroups, and checked: an app whose every
 * process is gone or has the kill pending can never run its code again.
 *
 * The apps are read from the database and from what is on disk, so an app the
 * database cannot list is still found. Apps are not spaced out: every minute a
 * stalled node keeps one is a minute its standby waits.
 * @param {Function} installedAppsFn
 * @param {Function} removeAppLocallyFn
 */
async function unloadForHostStall(installedAppsFn, removeAppLocallyFn) {
  if (unloadingForHostStall) return;
  unloadingForHostStall = true;
  try {
    const listed = await withinDeadline(installedAppsFn(), REMOVAL_DEADLINE_MS).catch(() => null);
    const installed = listed?.status === 'success' ? listed.data.map((app) => app.name) : [];
    const names = [...new Set([...installed, ...await appKill.appsOnDisk()])];
    const canBroadcast = nodeConfirmationService.canSendMessages();
    // eslint-disable-next-line no-restricted-syntax
    for (const name of names) {
      log.warn(`monitorNodeStatus - Application ${name} going to be removed: host stall`);
      // eslint-disable-next-line no-await-in-loop
      const outcome = await removeWithinDeadline(removeAppLocallyFn, name, canBroadcast)
        .catch(() => RemovalOutcome.FAILED);
      // eslint-disable-next-line no-await-in-loop
      let runnable = await appKill.stillRunnable(name);
      const killed = runnable.length > 0;
      if (killed) {
        log.error(`monitorNodeStatus - Application ${name} still runs after its removal (${outcome}), killing it`);
        // eslint-disable-next-line no-await-in-loop
        await appKill.kill(name);
        // eslint-disable-next-line no-await-in-loop
        runnable = await appKill.stillRunnable(name);
        if (runnable.length) {
          log.error(`monitorNodeStatus - Application ${name} could not be stopped: processes ${runnable.join(', ')} can still run`);
        } else {
          log.warn(`monitorNodeStatus - Application ${name} can no longer run`);
        }
      } else if (outcome !== RemovalOutcome.REMOVED && outcome !== RemovalOutcome.NOT_INSTALLED) {
        log.warn(`monitorNodeStatus - Application ${name} was not removed (${outcome}), and can no longer run`);
      }
      // runnable: the processes of the app that can still run its code, empty when none can
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

module.exports = {
  initialize,
  monitorNodeStatus,
  unloadForHostStall,
};
