const os = require('os');
const config = require('config');
const dbHelper = require('../dbHelper');
const nodeConfirmationService = require('../nodeConfirmationService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const geolocationService = require('../geolocationService');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const messageStore = require('./messageStore');
const log = require('../../lib/log');
const globalState = require('../utils/globalState');
const appQueryService = require('../appQuery/appQueryService');
const appReconciler = require('../appMonitoring/appReconciler');

const fluxEventBus = require('../utils/fluxEventBus');
const { nodeSigner } = require('../utils/nodeSigner');
const { appRunningEntries } = require('../utils/appRunningEntries');
const appPlacements = require('../appManagement/appPlacements');
const { ANNOUNCE_INTERVAL_MS } = require('../utils/appConstants');

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

// Held from a cycle's snapshot to its broadcast. A removal waits on it, so its
// message goes out after an announcement that took its list before the removal,
// which is why it lives in globalState.
const cycleLock = globalState.announceCycle;
// Settles when the cycle in flight, if any, has finished, so a stop can wait for
// it rather than returning while it is still running. A teardown that returns
// before the thing is torn down is the same lie as a stop that does not stop.
let cycleFinished = Promise.resolve();

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
  await cycleFinished;
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
  let finishCycle;
  cycleFinished = new Promise((resolve) => { finishCycle = resolve; });
  // Taken before any work, so the schedule below subtracts the WHOLE cycle -
  // including the paths that give up early, which cost time too.
  const startedAt = process.hrtime.bigint();
  let locked = false;
  try {
    // Observation only. The lock taken below is what a caller waiting on a cycle
    // in flight actually waits for.
    fluxEventBus.publish('app:announcing', {});
    if (!nodeConfirmationService.canSendMessages()) {
      log.info('checkAndNotifyPeersOfRunningApps - Node cannot send messages, skipping broadcast');
      return;
    }

    // The snapshot waits for the reconciler's first pass over the apps held at
    // boot: a pass that cannot recreate a container uninstalls the app, and a
    // claim made before it would have to be taken back by a broadcast that is
    // best-effort. Resolves immediately in steady state; capped reconciler-side,
    // so a wedged reconcile cannot block the node's network presence.
    await appReconciler.waitForBootDrainSettled();
    // Every app installed at start has a record before the first snapshot reads them.
    await appPlacements.waitForBackfill();

    const localSocketAddr = await fluxNetworkHelper.waitForLocalSocketAddress();

    // A cycle is in flight from the snapshot to the broadcast, and a removal waits
    // for it so the two go out in the order they happened. The waits above are
    // outside it, so a node waiting for its address holds up no removal.
    await cycleLock.enable();
    locked = true;

    // Stamped where the snapshot is taken, not where the message is built: every
    // consumer reads broadcastedAt as the time these apps were installed here, and
    // a stamp taken after the per-app reads below would out-rank a removal that
    // happened while they ran.
    const snapshotAt = Date.now();
    const installedAppsRes = await appQueryService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;

    // hourly resync trigger: let the reconciler bring any drifted containers
    // (crashed, orphaned, missed events) back to their desired state - a local
    // health concern, and not what this message reports
    appReconciler.enqueueAll('hourly').catch((err) => log.error(`peerNotification - reconcile sweep failed: ${err.message}`));

    // Every app installed here, whatever its containers are doing. The message
    // says "this node holds this app", which is what the spawner counts against
    // an app's instance target - a container that is down is recovered here, not
    // relocated, and whether it serves is settled by the load balancer's own
    // health check. Deriving this from run-state instead made a component that
    // could never start silence the node, so the app never reached its target
    // and was placed again, without end.
    //
    // Read straight from the installed set: an app's name and hash sit outside
    // the enterprise envelope, so a spec that cannot be decrypted still states
    // its claim, and one unreadable app cannot cost this node its presence.
    // An app whose removal this node has broadcast is excluded: it is still
    // installed until the removal finishes, and naming it here would re-create the
    // location row the removal just cleared. An app this node is only testing is
    // excluded too: its row is thrown away at the end of the test, and the teardown
    // that throws it away tells the network nothing. So is an app boot has not yet
    // confirmed this node still holds: naming it would renew a location record that
    // may have expired, and the boot check would then read it as valid.
    const applicationsToBroadcast = appsInstalled.filter(
      (application) => !globalState.departingApps.has(application.name)
        && !globalState.testInstallingApps.has(application.name)
        && !globalState.unconfirmedApps.has(application.name),
    );
    // An installed app without a string name and hash is left out and logged: no
    // node stores such an entry, and a node that has not upgraded refuses the
    // whole message for it, which would cost this node every other app it holds.
    const { stored: announceable, refused } = appRunningEntries(applicationsToBroadcast);
    if (refused.length) {
      log.warn(`checkAndNotifyPeersOfRunningApps - installed apps without a name and hash are not announced: ${refused.map((application) => application?.name).join(', ')}`);
    }
    const apps = [];
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    try {
      // When this node took each app comes from its own record of that, never from
      // the network's copy of its location rows: those lapse in normal running
      // while the app goes on running here. An app with no record is announced
      // from its row, and from now without one.
      const placements = await appPlacements.placementsOf(announceable.map((application) => application.name));
      const unrecorded = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const application of announceable) {
        let runningOnMyNodeSince = placements.get(application.name);
        if (!runningOnMyNodeSince) {
          unrecorded.push(application.name);
          const queryFind = { name: application.name, ip: localSocketAddr };
          const projection = { _id: 0, runningSince: 1 };
          // eslint-disable-next-line no-await-in-loop
          const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
          runningOnMyNodeSince = result?.runningSince ?? new Date();
        }
        apps.push({
          name: application.name,
          hash: application.hash,
          runningSince: new Date(runningOnMyNodeSince).toISOString(),
        });
      }
      if (unrecorded.length) {
        log.warn(`checkAndNotifyPeersOfRunningApps - no placement record for ${unrecorded.join(', ')}; announced from the location table`);
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
        broadcastedAt: snapshotAt,
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
      // Every peer applies the same rule to the message as this store does, so a
      // message this node will not store is one no peer stores either.
      const ownStore = await messageStore.storeAppRunningMessage(appRunningMessage);
      if (ownStore instanceof Error) {
        log.error(`checkAndNotifyPeersOfRunningApps - this node refuses its own announcement, not broadcast: ${ownStore.message}`);
        fluxEventBus.publish('app:announcementRefused', { reason: ownStore.message });
        return;
      }
      const signed = await fluxCommunicationMessagesSender.broadcastMessageToAll(appRunningMessage);
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, { signedBroadcast: signed });
      fluxEventBus.publish('app:running', { apps, ip: appRunningMessage.ip, unannounced: refused.map((application) => application?.name ?? null) });
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
    if (locked) cycleLock.disable();
    finishCycle();
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
