const { AsyncGate } = require('./asyncGate');
const { AsyncLock } = require('./asyncLock');
const operationRegistry = require('./operationRegistry');

// Global state variables for apps service
// These need to be shared across all modules to maintain the original business logic

// The removals running: each removal marks its own start and end.
let removals = 0;
// The installs running: each install marks its own start and end.
let installations = 0;
let softRedeployInProgress = false;
let hardRedeployInProgress = false;
let reinstallationOfOldAppsInProgress = false;
let masterSlaveAppsRunning = false;
let shutdownInProgress = false;
const daemonReadyGate = new AsyncGate();
const bootContainerStateSettledGate = new AsyncGate();
const dbReadyGate = new AsyncGate();
const policyReadyGate = new AsyncGate();
let appStateAuthoritative = false;
let appSyncState = 'INITIALIZING';
let updateSyncthingRunning = false;
let syncthingAppsFirstRun = true;

// Apps monitored state
let appsMonitored = {};

// Additional state variables for trySpawningGlobalApplication
let fluxNodeWasNotConfirmedOnLastCheck = false;
let firstExecutionAfterItsSynced = true;
let fluxNodeWasAlreadyConfirmed = false;
let spawnerPaused = false;

// Cache and delay lists
const appsToBeCheckedLater = [];
const appsSyncthingToBeCheckedLater = [];
const receiveOnlySyncthingAppsCache = new Map();
const syncthingDevicesIDCache = new Map();
const folderHealthCache = new Map(); // Tracks health status for sync folders (isolation, connectivity issues)

// Pending app updates cache reference - initialized from cacheManager
let pendingAppUpdatesCache = null;

// Running apps cache - tracks app names that have been broadcasted as running
const runningAppsCache = new Set();

// Apps this node has told the network it is removing, by the name the removal
// message carries. An announcement states which apps the node holds, and an app
// whose removal has been broadcast is no longer one of them.
//
// Membership spans the removal: the message goes out before the app's local row is
// deleted, so an announcement built in that window would still name the app and
// re-create the location row the removal had just cleared. Peers apply the two
// messages in arrival order and cannot tell which describes the later state.
//
// Only a removal that tells the network belongs here. A removal whose containers
// are coming straight back - a redeploy - keeps announcing, or its row lapses and
// the app is placed a second time.
//
// In-memory deliberately: a restart ends the removal that entered it, and an entry
// that survived would silence an app nothing is removing any more.
//
// Counted, not a set. A forced removal skips the single-removal guard, so two of
// them can run against one app at once - a surplus trim and an expiry removal, or
// an app and one of its components, which share the name the message carries. The
// first to finish would clear a set outright and hand the announcement back to the
// removal still running.
const departingCounts = new Map();

// Apps this node is only trying out. A test install writes the app's row like any
// other install, and the announcement is built from that table - so an announcement
// landing inside one claims a placement for an app about to be thrown away, and the
// test teardown tells the network nothing that would take the claim back.
//
// A set, not a count: the node admits one installation at a time, so a second test
// install of the same app cannot start while this one holds the node.
//
// In-memory deliberately: a restart ends the test install that entered it.
const testInstallingApps = new Set();

// Held for the whole of an announcement cycle. It lives here rather than inside
// peerNotification because a removal has to wait on it too, and peerNotification
// already reaches appUninstaller through the reconciler - so the uninstaller
// cannot reach back without a require cycle.
const announceCycle = new AsyncLock();

const departingApps = {
  /**
   * Record that a broadcast removal of this app has begun.
   * @param {string} appName Name the removal message carries.
   * @returns {void}
   */
  enter(appName) {
    departingCounts.set(appName, (departingCounts.get(appName) || 0) + 1);
  },

  /**
   * Record that one broadcast removal of this app has finished.
   * @param {string} appName Name the removal message carries.
   * @returns {void}
   */
  leave(appName) {
    const held = departingCounts.get(appName);
    if (!held) return;
    if (held === 1) departingCounts.delete(appName);
    else departingCounts.set(appName, held - 1);
  },

  /**
   * Whether any broadcast removal of this app is in flight.
   * @param {string} appName Name the removal message carries.
   * @returns {boolean}
   */
  has(appName) {
    return departingCounts.has(appName);
  },

  /**
   * How many apps have a broadcast removal in flight.
   * @returns {number}
   */
  get size() {
    return departingCounts.size;
  },
};

// Apps boot found stopped and whose location records it could not read, so it cannot
// tell whether this node still holds them or the network placed them elsewhere while
// it was down. Until boot reads the records, an app here is not started, elected,
// announced, backed up, restored or torn down to be rebuilt.
//
// Keyed by app name; the value is the hold, so the check deciding an app can tell
// its own hold from a later one under the same name. An app's full uninstall ends
// its hold.
//
// In-memory deliberately: a restart runs the boot check again.
const unconfirmedApps = new Map();

// Containers intentionally stopped by FluxOS — containerEventsConsumer skips die events for these
const stoppingContainers = new Set();

// Containers a backup or restore took down, by docker name: running when the
// operation's hold was set, and held stopped until it is lifted. The node is still
// routed to for them (appQueryService.listRunningApps). Written by the
// reconciler's holdStopped and releaseHold.
const operationStoppedContainers = new Set();

// Containers FluxOS removed and has not created again — who removed the container,
// which is the only thing the tampering decision turns on. Docker names, keyed as
// stoppingContainers is.
//
// An absent container is the strongest local evidence of host-side interference the
// node has, and the reconciler records it as `container_vanished`, the
// heaviest-weighted tampering event there is. That reading holds only for a
// container FluxOS did not remove: a teardown that fails part way leaves an absence
// FluxOS caused with the app's row intact, and the app keeps being reconciled, so
// membership here is what stops a node scoring its own removal against the app it
// is hosting.
//
// Written by dockerService's removal funnels, dropped by its creation funnel, and
// dropped for a whole app when the app's local row goes (nothing reconciles it
// after that, so there is no absence left to attribute). FluxOS removed it ->
// present; FluxOS created it -> absent; anything missing without an entry here is
// what the tampering event is for.
//
// In-memory deliberately: across a restart the node genuinely cannot tell its own
// removal from anyone else's, and an entry that survived would suppress a real
// signal.
const fluxRemovedContainers = new Set();

// Syncthing folders this node holds writable (sendreceive), refreshed by the
// syncthing monitor each pass and served to peers that ask before promoting a
// folder of their own. Kept here rather than read from syncthing per request:
// the route is unauthenticated, and an on-demand read would be an amplifier into
// syncthing on a node any peer can reach.
//
// null until the monitor's first validated read, and a Set from then on. "I hold
// nothing writable" and "I have not looked yet" are the same empty set but
// opposite answers to a peer deciding whether to promote, so they must not be the
// same value: a node that IS holding a folder would otherwise read as free, and
// the peer would promote alongside it. On a booting node that pass is not
// immediate, and a fleet-wide restart puts every holder of an app in the state at
// once. Same null-is-no-opinion convention appReconciler's controllerDesired uses.
let promotedFolderIds = null;

// Where each receive-only folder of an installed app stands in telling peers what this
// node holds of it: folderId -> a state from appMonitoring/folderStates. Peers read it
// before promoting one of their own, so that the node with the data wins rather than
// the node with the lowest address.
const folderStates = new Map();
// What each folder this node sends holds in the cluster's index, in file bytes, as the
// monitor pass last read it: folderId -> bytes. Peers read it to tell a writable copy
// holding nothing from one they have not heard from yet.
const publishedFileBytes = new Map();

// This node's place in deciding which holder seeds a folder at a cold start:
// folderId -> { stage, bytes, newestModified }. `intent` while this node is elected,
// `deciding` while it reads its peers before seeding, `decided` once it seeds. Peers
// read it before they seed, so two holders that can reach each other never both seed
// - see the seed decision in syncthingFolderStateMachine.
const seedMarks = new Map();


// Cache references - these will be initialized from cacheManager
let spawnErrorsLongerAppCache = null;
let trySpawningGlobalAppCache = null;

/**
 * Marks one install running (true) or none (false), for a caller that is not an
 * install. An install marks itself with beginInstallation and endInstallation, so
 * one ending leaves the others marked.
 * @param {boolean} value
 */
function setInstallationInProgress(value) {
  installations = value ? Math.max(installations, 1) : 0;
}

// Initialize cache references - this must be called after cacheManager is ready
function initializeCaches(cacheManager) {
  if (cacheManager && cacheManager.appSpawnErrorCache && cacheManager.appSpawnCache) {
    spawnErrorsLongerAppCache = cacheManager.appSpawnErrorCache;
    trySpawningGlobalAppCache = cacheManager.appSpawnCache;
    ({ pendingAppUpdatesCache } = cacheManager);
  }
}

module.exports = {
  // State getters/setters
  get removalInProgress() { return removals > 0; },
  // Marks one removal running (true) or none (false), for a caller that is not a
  // removal. A removal marks itself with beginRemoval and endRemoval, so one ending
  // leaves the others marked.
  set removalInProgress(value) { removals = value ? Math.max(removals, 1) : 0; },
  beginRemoval() { removals += 1; },
  endRemoval() { removals = Math.max(0, removals - 1); },

  get installationInProgress() { return installations > 0; },
  set installationInProgress(value) { setInstallationInProgress(value); },
  beginInstallation() { installations += 1; },
  endInstallation() { installations = Math.max(0, installations - 1); },

  get softRedeployInProgress() { return softRedeployInProgress; },
  set softRedeployInProgress(value) { softRedeployInProgress = value; },

  get hardRedeployInProgress() { return hardRedeployInProgress; },
  set hardRedeployInProgress(value) { hardRedeployInProgress = value; },

  get reinstallationOfOldAppsInProgress() { return reinstallationOfOldAppsInProgress; },
  set reinstallationOfOldAppsInProgress(value) { reinstallationOfOldAppsInProgress = value; },

  // Set by the graceful shutdown path and never cleared: the process exits at the
  // end of it. From then on no container starts and no decider acts, so what the
  // shutdown stops and drains stays stopped and drained.
  get shutdownInProgress() { return shutdownInProgress; },
  setShutdownInProgressTrue() { shutdownInProgress = true; },

  get masterSlaveAppsRunning() { return masterSlaveAppsRunning; },
  set masterSlaveAppsRunning(value) { masterSlaveAppsRunning = value; },

  get daemonReady() { return daemonReadyGate.ready; },
  set daemonReady(value) { if (value) daemonReadyGate.open(); else daemonReadyGate.close(); },
  waitForDaemonReady() { return daemonReadyGate.wait(); },

  get bootContainerStateSettled() { return bootContainerStateSettledGate.ready; },
  set bootContainerStateSettled(value) { if (value) bootContainerStateSettledGate.open(); else bootContainerStateSettledGate.close(); },
  waitForBootContainerStateSettled() { return bootContainerStateSettledGate.wait(); },

  get dbReady() { return dbReadyGate.ready; },
  set dbReady(value) { if (value) dbReadyGate.open(); else dbReadyGate.close(); },
  waitForDbReady() { return dbReadyGate.wait(); },

  // Whether this node may act on the network policy: it holds a verified bundle AND has
  // established that no peer it can reach is ahead of it. Written only by policyStore,
  // which derives it from that pair.
  //
  // The distinction is the point: an unread policy and an empty one give every lookup the
  // same answer, and acting on it is how a node fills itself with apps it must not host
  // and then has them uninstalled from under it. Holding a bundle is not enough on its
  // own - one off disk is whatever this node last had, and the documents in it decide who
  // may host what.
  //
  // What waits on it is anything that would JUDGE an app - whether it may be hosted, run
  // or pulled here - and anything that would destroy one it then has to rebuild. A node
  // that cannot judge is not refusing a particular app; it is not yet in a position to
  // answer about any of them, which is a fact about the node and is what the caller needs
  // told. Nothing else waits: serving the API, keeping containers running and removing an
  // app outright all work without it.
  get policyReady() { return policyReadyGate.ready; },
  set policyReady(value) { if (value) policyReadyGate.open(); else policyReadyGate.close(); },
  waitForPolicyReady() { return policyReadyGate.wait(); },

  // Whether this node's ephemeral app-state store is worth another node's
  // survey: its own state sync completed, or it has spent the block timer
  // taking live broadcasts. NOT dbReady, which is about globalAppsInformation
  // and a different set of collections entirely.
  //
  // It lives here rather than being read off the orchestrator because the only
  // caller is the sync responder, and fluxCommunicationMessagesSender reaching
  // back into appSyncOrchestrator is a cycle. The orchestrator owns the value
  // and mirrors it; nothing else writes it.
  get appStateAuthoritative() { return appStateAuthoritative; },
  set appStateAuthoritative(value) { appStateAuthoritative = Boolean(value); },

  // The app sync orchestrator's state (INITIALIZING, SYNCING, READY, DEGRADED,
  // RESYNCING), for readers that cannot require the orchestrator without a
  // cycle. The orchestrator owns the value and mirrors it; nothing else writes it.
  get appSyncState() { return appSyncState; },
  set appSyncState(value) { appSyncState = value; },

  get updateSyncthingRunning() { return updateSyncthingRunning; },
  set updateSyncthingRunning(value) { updateSyncthingRunning = value; },

  get syncthingAppsFirstRun() { return syncthingAppsFirstRun; },
  set syncthingAppsFirstRun(value) { syncthingAppsFirstRun = value; },

  // The apps a backup or a restore holds, as frozen snapshots of the operation
  // registry, which alone takes and releases an app (operationRegistry.js).
  get backupInProgress() { return Object.freeze(operationRegistry.listByType('backup')); },
  get restoreInProgress() { return Object.freeze(operationRegistry.listByType('restore')); },

  get appsMonitored() { return appsMonitored; },
  set appsMonitored(value) { appsMonitored = value; },

  // Additional state getters/setters
  get fluxNodeWasNotConfirmedOnLastCheck() { return fluxNodeWasNotConfirmedOnLastCheck; },
  set fluxNodeWasNotConfirmedOnLastCheck(value) { fluxNodeWasNotConfirmedOnLastCheck = value; },

  get firstExecutionAfterItsSynced() { return firstExecutionAfterItsSynced; },
  set firstExecutionAfterItsSynced(value) { firstExecutionAfterItsSynced = value; },

  get fluxNodeWasAlreadyConfirmed() { return fluxNodeWasAlreadyConfirmed; },
  set fluxNodeWasAlreadyConfirmed(value) { fluxNodeWasAlreadyConfirmed = value; },

  get spawnerPaused() { return spawnerPaused; },
  set spawnerPaused(value) { spawnerPaused = value; },

  get appsToBeCheckedLater() { return appsToBeCheckedLater; },
  get appsSyncthingToBeCheckedLater() { return appsSyncthingToBeCheckedLater; },
  get receiveOnlySyncthingAppsCache() { return receiveOnlySyncthingAppsCache; },
  get promotedFolderIds() { return promotedFolderIds; },
  set promotedFolderIds(ids) { promotedFolderIds = ids; },
  get folderStates() { return folderStates; },
  get publishedFileBytes() { return publishedFileBytes; },
  get seedMarks() { return seedMarks; },
  get syncthingDevicesIDCache() { return syncthingDevicesIDCache; },
  get folderHealthCache() { return folderHealthCache; },
  get runningAppsCache() { return runningAppsCache; },
  get departingApps() { return departingApps; },
  get testInstallingApps() { return testInstallingApps; },
  get unconfirmedApps() { return unconfirmedApps; },
  get announceCycle() { return announceCycle; },
  get stoppingContainers() { return stoppingContainers; },
  get operationStoppedContainers() { return operationStoppedContainers; },
  get fluxRemovedContainers() { return fluxRemovedContainers; },

  get spawnErrorsLongerAppCache() { return spawnErrorsLongerAppCache; },
  set spawnErrorsLongerAppCache(value) { spawnErrorsLongerAppCache = value; },

  get trySpawningGlobalAppCache() { return trySpawningGlobalAppCache; },
  set trySpawningGlobalAppCache(value) { trySpawningGlobalAppCache = value; },

  // Helper functions to match original API
  removalInProgressReset() { removals = 0; },
  setRemovalInProgressToTrue() { removals = Math.max(removals, 1); },
  installationInProgressReset() { setInstallationInProgress(false); },
  setInstallationInProgressTrue() { setInstallationInProgress(true); },
  softRedeployInProgressReset() { softRedeployInProgress = false; },
  setSoftRedeployInProgressTrue() { softRedeployInProgress = true; },
  hardRedeployInProgressReset() { hardRedeployInProgress = false; },
  setHardRedeployInProgressTrue() { hardRedeployInProgress = true; },

  // Clear functions
  clearAppsMonitored() { appsMonitored = {}; },
  setAppsMonitored(value) { appsMonitored = value; },

  // Cache initialization
  initializeCaches,

  // Pending app updates cache
  get pendingAppUpdatesCache() { return pendingAppUpdatesCache; },

  /**
   * Queue an update message that arrived before registration was stored.
   * Uses TTL cache - entries automatically expire after 30 minutes. One message
   * is queued once, whichever peers send it.
   * @param {string} appName - The app name
   * @param {object} message - The raw update message to queue
   * @param {number} height - The blockchain height of the update
   * @param {function(): void} [release] Gives back the place an unpaid update
   *   holds in its sender's allowance; called once the update leaves the queue,
   *   whether replayed, cleared, expired or evicted.
   */
  queuePendingUpdate(appName, message, height, release) {
    if (!pendingAppUpdatesCache) {
      release?.();
      return;
    }
    const updates = pendingAppUpdatesCache.get(appName) || [];
    if (updates.some((queued) => queued.message.hash === message.hash)) {
      release?.();
      return;
    }
    updates.push({ message, height, release });
    // Keep sorted by height ascending
    updates.sort((a, b) => a.height - b.height);
    pendingAppUpdatesCache.set(appName, updates);
  },

  /**
   * Get pending updates for an app and remove them from the cache. Each holds
   * its place in its sender's allowance until the caller calls its `release`.
   * @param {string} appName - The app name
   * @returns {Array<{ message, height, release?: function(): void }>} The pending
   *   updates sorted by height
   */
  getPendingUpdates(appName) {
    if (!pendingAppUpdatesCache) return [];
    const pending = pendingAppUpdatesCache.get(appName);
    if (!pending || pending.length === 0) {
      return [];
    }
    // Handed to the caller, which releases them: removing the cache entry does not.
    pending.forEach((queued) => { queued.handedOver = true; });
    pendingAppUpdatesCache.delete(appName);
    return pending;
  },

  /**
   * Clear all pending updates for an app (e.g., after a failed update).
   * @param {string} appName - The app name
   */
  clearPendingUpdates(appName) {
    if (!pendingAppUpdatesCache) return;
    pendingAppUpdatesCache.delete(appName);
  },
};
