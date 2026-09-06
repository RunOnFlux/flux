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
const { RUNNING_EXPIRY_MS } = require('../utils/appConstants');

const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

let broadcastTimer = null;
let broadcastInProgress = false;
let rebroadcastNeeded = false;
let overrunning = false;

/**
 * How often this node announces the apps it is running.
 *
 * Not a preference. The announcement below writes this node's OWN location row
 * before it sends, and that row expires RUNNING_EXPIRY_MS after the
 * announcement that carried it - so a node announcing less often than the row
 * lives stops being a holder of its own apps, on its own reading and on every
 * peer's. Production ships 3600s against a 7500s expiry.
 *
 * The ceiling is what stops any other pairing deleting that property in
 * silence, whether it arrives as a harness compression or a hand edit. Half the
 * expiry, so one missed announcement is survivable and two are not.
 *
 * @returns {number} milliseconds
 */
function announceIntervalMs() {
  const configured = config.fluxapps.peerNotifyIntervalMs ?? 3600000;
  return Math.min(configured, Math.floor(RUNNING_EXPIRY_MS / 2));
}

/**
 * Schedule the next announcement so that the PERIOD is fixed, rather than the
 * gap between one cycle ending and the next beginning.
 *
 * The timer used to be recreated after the cycle, which made the real period
 * `interval + however long the cycle took`: the work sat inside the thing it
 * was being timed against. Nothing reported it and nothing measured it, so a
 * node whose cycle took 40s against a 30s interval announced every 70s while
 * every configuration file said 30. Subtracting the elapsed time is what makes
 * the period the period.
 *
 * Measured monotonically. A wall clock can step backwards over an NTP
 * correction, and a negative elapsed would push the next announcement away by
 * the size of the step.
 *
 * @param {bigint} startedAt process.hrtime.bigint() taken when the cycle began
 */
function scheduleNextBroadcast(startedAt) {
  if (broadcastTimer) clearTimeout(broadcastTimer);

  const interval = announceIntervalMs();
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  // Said once on the transition and once when it clears, never per cycle. A
  // node whose cycle no longer fits its interval is announcing itself less
  // often than it is configured to, and its presence on the network decays with
  // nothing anywhere saying so - which is why this went unseen for as long as
  // it did.
  if (elapsedMs > interval) {
    if (!overrunning) {
      overrunning = true;
      log.warn(`peerNotification - a broadcast cycle took ${Math.round(elapsedMs)}ms against a ${interval}ms interval; this node is announcing itself less often than it is configured to`);
    }
  } else if (overrunning) {
    overrunning = false;
    log.info('peerNotification - broadcast cycles fit inside their interval again');
  }

  // Clamped at zero rather than scheduled into the past. A cycle that outran
  // its interval runs again immediately, which is the most the node can do.
  broadcastTimer = setTimeout(() => {
    checkAndNotifyPeersOfRunningApps();
  }, Math.max(0, interval - elapsedMs));
}

function stopBroadcastInterval() {
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
}

function initialize() {
  nodeConfirmationService.onMessageCapabilityChange((capable) => {
    if (capable && broadcastTimer) {
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
  stopBroadcastInterval,
};
