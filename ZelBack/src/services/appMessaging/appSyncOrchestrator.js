const fs = require('fs').promises;
const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const generalService = require('../generalService');
const appHashSyncService = require('./appHashSyncService');
const peerNotification = require('./peerNotification');
const registryManager = require('../appDatabase/registryManager');
const globalState = require('../utils/globalState');
const peerCodec = require('../utils/peerCodec');
const { appSyncEvents, EVENTS } = require('../utils/appSyncEvents');

const startupCollection = config.database.local.collections.nodeStartupTracker;

const STATES = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  SYNCING: 'SYNCING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  RESYNCING: 'RESYNCING',
});

const MIN_SYNC_COMPLETIONS = config.fluxapps.appSyncMinCompletions ?? 3;
const SYNC_TIMEOUT_MS = 2 * 60 * 1000;
const MIN_UPTIME_SECONDS = config.fluxapps.appSyncMinPeerUptime ?? 7500;
const HASH_SYNC_MAX_RETRIES = 3;
const HASH_SYNC_RETRY_MS = 5 * 60 * 1000;
const FALLBACK_RECHECK_BLOCKS = 100;

class AppSyncOrchestrator {
  #state = STATES.INITIALIZING;
  #blockEmitter = null;
  #getEligibleSyncPeers = null;
  #onPeerEvent = null;
  #offPeerEvent = null;
  #isEnterprise = null;
  #waitForNetworkState = null;
  #networkReady = false;
  #peersReady = false;
  #explorerSynced = false;
  #hashSyncComplete = false;
  #dbRebuilt = false;
  #blocksSinceSyncStarted = 0;
  #blockThreshold = 0;
  #blockReceivedHandler = null;
  #peerThresholdHandler = null;
  #peersBelowHandler = null;
  #ephemeralSyncHandler = null;
  #hashUnresolvedHandler = null;
  #hashesChangedHandler = null;
  #broadcastStarted = null;
  #syncInProgress = false;
  #askedPeers = new Set();
  #syncCompletions = { apprunning: 0, appinstalling: 0, apperrors: 0 };
  #stateSyncComplete = false;
  #syncTimeout = null;
  #hashSyncAttempts = 0;
  #hashSyncRetryTimer = null;
  #nextHashRetryHeight = 0;
  #lastBlockHeight = 0;
  #fluxVersion = null;
  #heartbeatInterval = null;
  #bootContext = null;

  constructor(options = {}) {
    this.#blockEmitter = options.blockEmitter;
    this.#getEligibleSyncPeers = options.getEligibleSyncPeers;
    this.#onPeerEvent = options.onPeerEvent;
    this.#offPeerEvent = options.offPeerEvent;
    this.#isEnterprise = options.isEnterprise ?? (() => false);
    this.#waitForNetworkState = options.networkStateReady ?? null;
    this.#fluxVersion = options.fluxVersion ?? null;
  }

  get state() {
    return this.#state;
  }

  async start(bootContext) {
    log.info(`AppSyncOrchestrator - Starting in state ${this.#state}`);

    this.#bootContext = bootContext;
    this.#startHeartbeat();

    this.#peerThresholdHandler = (count) => {
      log.info(`AppSyncOrchestrator - Peer threshold reached (${count} peers)`);
      this.#peersReady = true;
      this.#tryStartSync();
    };
    this.#peersBelowHandler = (count) => {
      log.info(`AppSyncOrchestrator - Peers below threshold (${count} peers)`);
      this.#onPeersDegraded();
    };
    this.#onPeerEvent('peerThresholdReached', this.#peerThresholdHandler);
    this.#onPeerEvent('peersBelowThreshold', this.#peersBelowHandler);

    this.#ephemeralSyncHandler = (syncType) => this.#onEphemeralSyncComplete(syncType);
    appSyncEvents.on(EVENTS.EPHEMERAL_SYNC_COMPLETE, this.#ephemeralSyncHandler);

    this.#hashUnresolvedHandler = () => this.#onHashUnresolved();
    appSyncEvents.on(EVENTS.HASH_UNRESOLVED, this.#hashUnresolvedHandler);

    this.#blockReceivedHandler = (blockHeight) => {
      this.#onBlockReceived(blockHeight);
    };
    this.#blockEmitter.on('blockReceived', this.#blockReceivedHandler);

    this.#hashesChangedHandler = () => this.#onHashesChanged();
    this.#blockEmitter.on('hashesChanged', this.#hashesChangedHandler);

    if (this.#waitForNetworkState) {
      await this.#waitForNetworkState();
      this.#networkReady = true;
      log.info('AppSyncOrchestrator - Network state ready');
      this.#tryStartSync();
    } else {
      this.#networkReady = true;
    }
  }

  #tryStartSync() {
    if (!this.#networkReady || !this.#peersReady) return;
    this.#onPeersReady();
  }

  #onEphemeralSyncComplete(syncType) {
    if (this.#stateSyncComplete) return;
    if (this.#syncCompletions[syncType] === undefined) return;
    this.#syncCompletions[syncType] += 1;
    log.info(`AppSyncOrchestrator - ${syncType} sync complete (${this.#syncCompletions[syncType]}/${MIN_SYNC_COMPLETIONS})`);
    if (this.#syncCompletions.apprunning >= MIN_SYNC_COMPLETIONS
      && this.#syncCompletions.appinstalling >= MIN_SYNC_COMPLETIONS
      && this.#syncCompletions.apperrors >= MIN_SYNC_COMPLETIONS) {
      this.#stateSyncComplete = true;
      if (this.#syncTimeout) {
        clearTimeout(this.#syncTimeout);
        this.#syncTimeout = null;
      }
      log.info('AppSyncOrchestrator - All state syncs complete');
      this.#checkReadiness();
    }
  }

  async #onPeersReady() {
    if (this.#state === STATES.DEGRADED) {
      this.#state = STATES.RESYNCING;
      log.info('AppSyncOrchestrator - Peers recovered, resyncing');
    }

    this.#startAppRunningBroadcast();
    this.#requestSyncs();

    if (this.#state === STATES.RESYNCING) {
      if (this.#syncInProgress) return;
      await this.#runHashSync();
      this.#checkReadiness();
    }
  }

  #requestSyncs() {
    const eligible = this.#getEligibleSyncPeers(MIN_UPTIME_SECONDS);
    const fresh = eligible.filter((p) => !this.#askedPeers.has(p.key));

    if (fresh.length < MIN_SYNC_COMPLETIONS && this.#askedPeers.size === 0) {
      log.info(`AppSyncOrchestrator - Only ${fresh.length} eligible sync peers (need ${MIN_SYNC_COMPLETIONS}), falling back to block timer`);
      return;
    }

    if (fresh.length === 0) {
      log.info('AppSyncOrchestrator - No new eligible sync peers to ask');
      return;
    }

    const peersToAsk = fresh.slice(0, MIN_SYNC_COMPLETIONS);
    for (const peer of peersToAsk) {
      this.#askedPeers.add(peer.key);
    }

    this.#sendRequests(peersToAsk, 'temp messages', peerCodec.encodeRequestTempMessages());
    this.#sendRequests(peersToAsk, 'apprunning', peerCodec.encodeRequestAppRunning(0));
    this.#sendRequests(peersToAsk, 'appinstalling', peerCodec.encodeRequestAppInstalling(0));
    this.#sendRequests(peersToAsk, 'apperrors', peerCodec.encodeRequestAppInstallingErrors(0));

    if (!this.#syncTimeout && !this.#stateSyncComplete) {
      this.#syncTimeout = setTimeout(() => {
        this.#syncTimeout = null;
        if (!this.#stateSyncComplete) {
          log.warn(`AppSyncOrchestrator - Sync timeout, completions: apprunning=${this.#syncCompletions.apprunning} appinstalling=${this.#syncCompletions.appinstalling} apperrors=${this.#syncCompletions.apperrors}`);
        }
      }, SYNC_TIMEOUT_MS);
    }
  }

  #sendRequests(peers, label, message) {
    const peerKeys = peers.map((p) => p.key).join(', ');
    log.info(`AppSyncOrchestrator - Requesting ${label} sync from ${peers.length} peers: ${peerKeys}`);
    for (const peer of peers) {
      try {
        peer.send(message);
      } catch (error) {
        log.error(`AppSyncOrchestrator - Failed to request ${label} from ${peer.key}: ${error.message}`);
      }
    }
  }

  #onPeersDegraded() {
    if (this.#state === STATES.READY) {
      this.#state = STATES.DEGRADED;
      this.#hashSyncComplete = false;
      this.#dbRebuilt = false;
      globalState.dbReady = false;
      this.#resetSyncState();
      log.warn('AppSyncOrchestrator - Degraded, pausing spawner');
      appSyncEvents.emit(EVENTS.READINESS_LOST);
    }
  }

  #resetSyncState() {
    this.#askedPeers.clear();
    this.#syncCompletions = { apprunning: 0, appinstalling: 0, apperrors: 0 };
    this.#stateSyncComplete = false;
    if (this.#syncTimeout) {
      clearTimeout(this.#syncTimeout);
      this.#syncTimeout = null;
    }
  }

  #onBlockReceived(blockHeight) {
    this.#lastBlockHeight = blockHeight;
    if (!this.#explorerSynced) {
      this.#explorerSynced = true;
      log.info(`AppSyncOrchestrator - Explorer synced at block ${blockHeight}`);
      if (this.#state === STATES.INITIALIZING) {
        this.#state = STATES.SYNCING;
        this.#ensureBlockThreshold();
        this.#runInitialSync();
      }
    }
    if (this.#state === STATES.SYNCING || this.#state === STATES.READY) {
      this.#blocksSinceSyncStarted += 1;
      this.#checkReadiness();
      this.#checkHashRetry(blockHeight);
    }
  }

  #onHashUnresolved() {
    if (!this.#hashSyncComplete) return;
    // New unresolved hash — schedule immediate check on next block
    this.#nextHashRetryHeight = 0;
  }

  #onHashesChanged() {
    if (!this.#hashSyncComplete) return;
    log.info('AppSyncOrchestrator - Reconstruct audit found changes, scheduling immediate hash recheck');
    this.#nextHashRetryHeight = 0;
  }

  async #checkHashRetry(blockHeight) {
    if (!this.#hashSyncComplete) return;
    if (this.#syncInProgress) return;
    if (blockHeight < this.#nextHashRetryHeight) return;

    try {
      const result = await appHashSyncService.syncMissingHashes();
      this.#nextHashRetryHeight = result.nextRetryHeight ?? (blockHeight + FALLBACK_RECHECK_BLOCKS);
      if (result.missing > 0) {
        log.info(`AppSyncOrchestrator - Hash retry: ${result.resolved} resolved, ${result.missing} remaining, next check at block ${this.#nextHashRetryHeight}`);
      }
    } catch (error) {
      log.error(`AppSyncOrchestrator - Hash retry failed: ${error.message}`);
      this.#nextHashRetryHeight = blockHeight + FALLBACK_RECHECK_BLOCKS;
    }
  }

  async #runInitialSync() {
    if (this.#syncInProgress) return;
    log.info('AppSyncOrchestrator - Sync started');
    await this.#checkVersionUpgrade();
    log.info('AppSyncOrchestrator - Starting initial hash sync');
    await this.#runHashSync();
    this.#checkReadiness();
  }

  async #checkVersionUpgrade() {
    if (!this.#fluxVersion) return;
    try {
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const marker = await dbHelper.findOneInDatabase(database, startupCollection, { _id: 'hashSyncVersion' });
      if (!marker || marker.version !== this.#fluxVersion) {
        const resetCount = await appHashSyncService.resetHashSyncForUpgrade(this.#lastBlockHeight);
        log.info(`AppSyncOrchestrator - Version upgrade to ${this.#fluxVersion}, reset ${resetCount} hash sync entries`);
      }
    } catch (error) {
      log.error(`AppSyncOrchestrator - Version upgrade check failed: ${error.message}`);
    }
  }

  async #writeVersionMarker() {
    if (!this.#fluxVersion) return;
    try {
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      await dbHelper.findOneAndUpdateInDatabase(
        database, startupCollection,
        { _id: 'hashSyncVersion' },
        { $set: { version: this.#fluxVersion } },
        { upsert: true },
      );
    } catch (error) {
      log.error(`AppSyncOrchestrator - Failed to update hashSyncVersion marker: ${error.message}`);
    }
  }

  async #runHashSync() {
    if (this.#syncInProgress) return;
    this.#syncInProgress = true;
    try {
      this.#hashSyncAttempts += 1;
      const result = await appHashSyncService.syncMissingHashes();
      if (result.missing > 0) {
        log.warn(`AppSyncOrchestrator - Hash sync has ${result.missing} unresolvable hashes, proceeding`);
      } else {
        log.info('AppSyncOrchestrator - Hash sync complete');
      }
      this.#hashSyncComplete = true;
      this.#nextHashRetryHeight = result.nextRetryHeight ?? (this.#lastBlockHeight + FALLBACK_RECHECK_BLOCKS);
      await this.#writeVersionMarker();
      await this.#rebuildDb();
      globalState.dbReady = true;
    } catch (error) {
      log.error(`AppSyncOrchestrator - Hash sync failed (attempt ${this.#hashSyncAttempts}/${HASH_SYNC_MAX_RETRIES}): ${error.message}`);
      if (this.#hashSyncAttempts < HASH_SYNC_MAX_RETRIES) {
        log.info(`AppSyncOrchestrator - Scheduling hash sync retry in ${HASH_SYNC_RETRY_MS / 1000}s`);
        this.#hashSyncRetryTimer = setTimeout(() => {
          this.#hashSyncRetryTimer = null;
          this.#runHashSync().then(() => this.#checkReadiness());
        }, HASH_SYNC_RETRY_MS);
      } else {
        log.warn('AppSyncOrchestrator - Hash sync retries exhausted, falling back to block timer');
      }
    } finally {
      this.#syncInProgress = false;
    }
  }

  async #rebuildDb() {
    try {
      log.info('AppSyncOrchestrator - Rebuilding globalAppsInformation');
      await registryManager.reindexGlobalAppsInformation();
      this.#dbRebuilt = true;
      log.info('AppSyncOrchestrator - DB ready');
    } catch (error) {
      log.error(`AppSyncOrchestrator - DB rebuild failed: ${error.message}`);
    }
  }

  #ensureBlockThreshold() {
    if (this.#blockThreshold === 0) {
      const enterprise = this.#isEnterprise();
      const blocksPerMinute = 2;
      this.#blockThreshold = enterprise
        ? 62 * blocksPerMinute
        : 125 * blocksPerMinute;
    }
  }

  #isBlockTimerExpired() {
    this.#ensureBlockThreshold();
    return this.#blocksSinceSyncStarted >= this.#blockThreshold;
  }

  #isStateSyncReady() {
    if (this.#stateSyncComplete) return true;
    return this.#isBlockTimerExpired();
  }

  async #checkReadiness() {
    if (this.#state !== STATES.SYNCING && this.#state !== STATES.RESYNCING) return;
    if (!this.#explorerSynced) return;

    const blockTimerExpired = this.#isBlockTimerExpired();
    if (!this.#hashSyncComplete && !blockTimerExpired) return;
    if (!this.#dbRebuilt && !blockTimerExpired) return;

    // Block timer fired but hash sync / DB rebuild never completed — rebuild from whatever data we have
    if (blockTimerExpired && !this.#dbRebuilt) {
      await this.#rebuildDb();
      if (!this.#dbRebuilt) return;
    }

    if (!this.#isStateSyncReady()) return;

    const isConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isConfirmed) {
      log.info('AppSyncOrchestrator - Node not confirmed, waiting');
      setTimeout(() => this.#checkReadiness(), 60 * 1000);
      return;
    }

    this.#state = STATES.READY;
    log.info('AppSyncOrchestrator - All readiness conditions met');
    appSyncEvents.emit(EVENTS.SPAWNER_READY);
  }

  #startAppRunningBroadcast() {
    if (this.#broadcastStarted) return;
    this.#broadcastStarted = true;
    peerNotification.checkAndNotifyPeersOfRunningApps();
    log.info('AppSyncOrchestrator - App running broadcast started');
  }

  get bootContext() {
    return this.#bootContext;
  }

  set bootContext(ctx) {
    this.#bootContext = ctx;
  }

  static async readBootContext() {
    try {
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const heartbeat = await dbHelper.findOneInDatabase(database, startupCollection, { _id: 'heartbeat' });
      const currentBootId = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      const machineRebooted = !heartbeat || heartbeat.machineBootId !== currentBootId;
      const downtimeMs = heartbeat ? Date.now() - heartbeat.lastAlive : Infinity;
      const cleanShutdown = heartbeat?.shutdownReason === 'sigterm';

      const ctx = {
        machineRebooted,
        downtimeMs,
        cleanShutdown,
        currentBootId,
        firstBoot: !heartbeat,
      };

      log.info(`Boot context: machineRebooted=${machineRebooted} downtime=${Math.round(downtimeMs / 1000)}s cleanShutdown=${cleanShutdown} firstBoot=${!heartbeat}`);
      return ctx;
    } catch (error) {
      log.error(`Failed to read boot context: ${error.message}`);
      return { machineRebooted: true, downtimeMs: Infinity, cleanShutdown: false, currentBootId: null, firstBoot: true };
    }
  }

  #startHeartbeat() {
    const writeHeartbeat = async () => {
      try {
        const db = dbHelper.databaseConnection();
        const database = db.db(config.database.local.database);
        const update = { $set: { lastAlive: Date.now() } };
        if (this.#bootContext?.currentBootId) {
          update.$set.machineBootId = this.#bootContext.currentBootId;
        }
        await dbHelper.findOneAndUpdateInDatabase(database, startupCollection, { _id: 'heartbeat' }, update, { upsert: true });
      } catch (error) {
        log.error(`Heartbeat write failed: ${error.message}`);
      }
    };
    writeHeartbeat();
    this.#heartbeatInterval = setInterval(writeHeartbeat, 30_000);
  }

  static async writeShutdownReason(reason) {
    try {
      const db = dbHelper.databaseConnection();
      if (!db) return;
      const database = db.db(config.database.local.database);
      await dbHelper.findOneAndUpdateInDatabase(
        database,
        config.database.local.collections.nodeStartupTracker,
        { _id: 'heartbeat' },
        { $set: { shutdownReason: reason } },
        { upsert: true },
      );
    } catch (error) {
      log.error(`Failed to write shutdown reason: ${error.message}`);
    }
  }

  stop() {
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval);
      this.#heartbeatInterval = null;
    }
    if (this.#ephemeralSyncHandler) {
      appSyncEvents.removeListener(EVENTS.EPHEMERAL_SYNC_COMPLETE, this.#ephemeralSyncHandler);
    }
    if (this.#hashUnresolvedHandler) {
      appSyncEvents.removeListener(EVENTS.HASH_UNRESOLVED, this.#hashUnresolvedHandler);
    }
    if (this.#blockReceivedHandler) {
      this.#blockEmitter.removeListener('blockReceived', this.#blockReceivedHandler);
    }
    if (this.#hashesChangedHandler) {
      this.#blockEmitter.removeListener('hashesChanged', this.#hashesChangedHandler);
    }
    if (this.#peerThresholdHandler) {
      this.#offPeerEvent('peerThresholdReached', this.#peerThresholdHandler);
    }
    if (this.#peersBelowHandler) {
      this.#offPeerEvent('peersBelowThreshold', this.#peersBelowHandler);
    }
    peerNotification.stopBroadcastInterval();
    this.#broadcastStarted = null;
    if (this.#syncTimeout) {
      clearTimeout(this.#syncTimeout);
      this.#syncTimeout = null;
    }
    if (this.#hashSyncRetryTimer) {
      clearTimeout(this.#hashSyncRetryTimer);
      this.#hashSyncRetryTimer = null;
    }
  }
}

module.exports = { AppSyncOrchestrator, STATES };
