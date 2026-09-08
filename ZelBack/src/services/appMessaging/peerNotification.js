const os = require('os');
const config = require('config');
const dbHelper = require('../dbHelper');
const nodeConfirmationService = require('../nodeConfirmationService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const geolocationService = require('../geolocationService');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const messageStore = require('./messageStore');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');
const globalState = require('../utils/globalState');
const appQueryService = require('../appQuery/appQueryService');
const appReconciler = require('../appMonitoring/appReconciler');

const fluxEventBus = require('../utils/fluxEventBus');
const { nodeSigner } = require('../utils/nodeSigner');
const { ANNOUNCE_INTERVAL_MS } = require('../utils/appConstants');
const { AsyncLock } = require('../utils/asyncLock');

const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

let broadcastTimer = null;
let broadcastInProgress = false;
let rebroadcastNeeded = false;
let overrunning = false;

// Whether this node announces at all, and the only thing that decides whether a
// cycle arms the next one. A cycle ends by scheduling its successor, so a stop
// that clears the pending timer alone is undone a moment later by the work it
// was trying to end - the announcement loop outlives every stop taken while it
// is running.
//
// Ours rather than an abort signal's: FluxController's `aborted` is reset the
// moment its lock frees, so which of the two resumes first decides whether the
// loop survives its own abort. Nothing resets this.
let broadcasting = false;

// Held for the whole of a cycle, so a stop can wait for the cycle in flight
// rather than returning while it is still running. A teardown that returns
// before the thing is torn down is the same lie as a stop that does not stop.
const cycleLock = new AsyncLock();

/**
 * Schedule the next announcement so that the PERIOD is fixed, rather than the
 * gap between one cycle ending and the next beginning.
 *
 * The cycle's own duration is subtracted, so the work does not sit inside the
 * thing it is timed against: a timer recreated after the cycle makes the real
 * period `interval + however long the cycle took`, and a node announcing every
 * 70s while its configuration says 30 keeps a row alive that expires at 63.
 *
 * Measured monotonically. A wall clock can step backwards over an NTP
 * correction, and a negative elapsed would push the next announcement away by
 * the size of the step.
 *
 * @param {bigint} startedAt process.hrtime.bigint() taken when the cycle began
 */
function scheduleNextBroadcast(startedAt) {
  if (broadcastTimer) clearTimeout(broadcastTimer);
  // Asked here rather than at the caller, because every path that ends a cycle
  // arrives here and a stop must be honoured by all of them.
  if (!broadcasting) {
    broadcastTimer = null;
    return;
  }

  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  // Said once on the transition and once when it clears, never per cycle. A
  // node whose cycle no longer fits its interval announces itself less often
  // than the row it keeps alive, and its presence on the network decays with
  // nothing anywhere saying so.
  if (elapsedMs > ANNOUNCE_INTERVAL_MS) {
    if (!overrunning) {
      overrunning = true;
      log.warn(`peerNotification - a broadcast cycle took ${Math.round(elapsedMs)}ms against a ${ANNOUNCE_INTERVAL_MS}ms interval; this node is announcing itself less often than the location row it refreshes`);
    }
  } else if (overrunning) {
    overrunning = false;
    log.info('peerNotification - broadcast cycles fit inside their interval again');
  }

  // Clamped at zero rather than scheduled into the past. A cycle that outran
  // its interval runs again immediately, which is the most the node can do.
  broadcastTimer = setTimeout(() => {
    checkAndNotifyPeersOfRunningApps();
  }, Math.max(0, ANNOUNCE_INTERVAL_MS - elapsedMs));
}

/**
 * Start announcing, and keep announcing.
 *
 * Idempotent: a second call while the loop is running is not a second loop.
 *
 * @returns {void}
 */
function startBroadcasting() {
  if (broadcasting) return;
  broadcasting = true;
  checkAndNotifyPeersOfRunningApps();
}

/**
 * Stop announcing, and return once the cycle in flight has finished.
 *
 * @returns {Promise<void>}
 */
async function stopBroadcasting() {
  broadcasting = false;
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
  // The queued repeat goes with the stop. Left set, it is a cycle the next
  // start would run before the one it schedules for itself.
  rebroadcastNeeded = false;
  await cycleLock.waitReady();
}

function initialize() {
  nodeConfirmationService.onMessageCapabilityChange((capable) => {
    if (capable && broadcasting) {
      log.info('peerNotification - Message capability regained, triggering immediate broadcast');
      checkAndNotifyPeersOfRunningApps();
    }
  });
}

async function checkAndNotifyPeersOfRunningApps() {
  if (broadcastInProgress) {
    rebroadcastNeeded = true;
    log.info('Broadcast cycle already in progress, will rebroadcast when complete');
    return;
  }
  broadcastInProgress = true;
  // Taken before any work, so the schedule below subtracts the WHOLE cycle -
  // including the paths that give up early, which cost time too.
  const startedAt = process.hrtime.bigint();
  await cycleLock.enable();
  try {
    if (!nodeConfirmationService.canSendMessages()) {
      log.info('checkAndNotifyPeersOfRunningApps - Node cannot send messages, skipping broadcast');
      return;
    }

    // Never snapshot before the reconciler's boot drain settles: a too-early
    // snapshot misses apps whose containers are still being started, and their
    // unrefreshed rows expire on the ~7min sigterm TTL (respawn elsewhere).
    // Resolves immediately in steady state; capped reconciler-side, so a wedged
    // reconcile cannot block the node's network presence.
    await appReconciler.waitForBootDrainSettled();

    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddr) {
      throw new Error('Unable to detect Flux IP address');
    }

    const installedAppsRes = await appQueryService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    let appsInstalled = installedAppsRes.data;
    ({ inPlace: appsInstalled } = await decryptEnterpriseApps(appsInstalled, { formatSpecs: false }));
    const runningAppsRes = await appQueryService.listRunningApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    const runningApps = runningAppsRes.data;
    const runningAppsNames = runningApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });

    // hourly resync trigger: let the reconciler bring any drifted containers
    // (crashed, orphaned, missed events) back to their desired state
    appReconciler.enqueueAll('hourly').catch((err) => log.error(`peerNotification - reconcile sweep failed: ${err.message}`));

    // apps using g:/r: syncthing are advertised as installed-and-running even when
    // some components are intentionally stopped (e.g. slaves), so derive them
    // directly from the specs rather than from container run-state
    const masterSlaveAppsInstalled = appsInstalled.filter((app) => {
      const comps = app.version >= 4 && Array.isArray(app.compose) ? app.compose : [app];
      return comps.some((c) => c.containerData && (c.containerData.includes('g:') || c.containerData.includes('r:')));
    });

    const installedAndRunning = [];
    appsInstalled.forEach((app) => {
      if (app.version >= 4) {
        let appRunningWell = true;
        app.compose.forEach((appComponent) => {
          if (!runningAppsNames.includes(`${appComponent.name}_${app.name}`)) {
            appRunningWell = false;
          }
        });
        if (appRunningWell) {
          installedAndRunning.push(app);
        }
      } else if (runningAppsNames.includes(app.name)) {
        installedAndRunning.push(app);
      }
    });
    installedAndRunning.push(...masterSlaveAppsInstalled);
    const applicationsToBroadcast = [...new Set(installedAndRunning)];
    const apps = [];
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const application of applicationsToBroadcast) {
        const queryFind = { name: application.name, ip: localSocketAddr };
        const projection = { _id: 0, runningSince: 1 };
        // eslint-disable-next-line no-await-in-loop
        const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
        let runningOnMyNodeSince = new Date().toISOString();
        if (result && result.runningSince) {
          runningOnMyNodeSince = result.runningSince;
        }
        log.info(`${application.name} is running/installed properly. Broadcasting status.`);
        apps.push({
          name: application.name,
          hash: application.hash,
          runningSince: runningOnMyNodeSince,
        });
      }
      // An empty snapshot is NEVER broadcast: the receive side treats an empty
      // v2 message as "delete every appsLocations row for this IP" - and we
      // store our own message first, so it would erase our own presence. Every
      // legitimate correction has a targeted mechanism instead (fluxappremoved
      // on uninstall, sigterm/TTL row expiry for wiped or dead nodes).
      if (apps.length === 0) {
        return;
      }
      const appRunningMessage = {
        type: 'fluxapprunning',
        version: 2,
        apps,
        ip: localSocketAddr,
        broadcastedAt: Date.now(),
        osUptime: os.uptime(),
        staticIp: geolocationService.isStaticIP(),
      };
      // The announcement is one fact, recorded twice - the location table, and
      // the event log that peers sync from - and sent once. A node that cannot
      // sign as itself sends nothing a peer would accept, so it records nothing
      // either: its own view of where it runs stays the network's view. Asked
      // before the first write, for that reason.
      const signer = await nodeSigner();
      if (!signer) {
        log.warn('checkAndNotifyPeersOfRunningApps - this node cannot sign as itself; its running apps are not announced');
        return;
      }
      await messageStore.storeAppRunningMessage(appRunningMessage);
      const signed = await fluxCommunicationMessagesSender.broadcastMessageToAll(appRunningMessage);
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, { signedBroadcast: signed });
      fluxEventBus.publish('app:running', { apps, ip: appRunningMessage.ip });
      log.info(`App Running Message broadcasted: ${apps.length} apps`);
    } catch (err) {
      log.error(err);
    }
    const { runningAppsCache } = globalState;
    runningAppsCache.clear();
    apps.forEach((app) => {
      runningAppsCache.add(app.name);
    });
    log.info(`Running Apps cache updated with ${runningAppsCache.size} apps`);
    log.info('Running Apps broadcasted');
  } catch (error) {
    log.error(error);
  } finally {
    broadcastInProgress = false;
    cycleLock.disable();
    if (rebroadcastNeeded) {
      rebroadcastNeeded = false;
      setImmediate(() => checkAndNotifyPeersOfRunningApps());
    } else {
      scheduleNextBroadcast(startedAt);
    }
  }
}

module.exports = {
  initialize,
  checkAndNotifyPeersOfRunningApps,
  startBroadcasting,
  stopBroadcasting,
};
