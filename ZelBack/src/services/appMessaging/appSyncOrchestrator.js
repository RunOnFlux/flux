const config = require('config');
const { EventEmitter } = require('events');
const log = require('../../lib/log');
const generalService = require('../generalService');
const appHashSyncService = require('./appHashSyncService');
const peerNotification = require('./peerNotification');
const registryManager = require('../appDatabase/registryManager');
const globalState = require('../utils/globalState');
const peerCodec = require('../utils/peerCodec');

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
const HASH_SYNC_RECHECK_MS = 20 * 60 * 1000;

class AppSyncOrchestrator extends EventEmitter {
  #state = STATES.INITIALIZING;
  #blockEmitter = null;
  #peerManager = null;
  #isEnterprise = null;
  #explorerSynced = false;
  #hashSyncComplete = false;
  #dbRebuilt = false;
  #blocksSinceSyncStarted = 0;
  #blockThreshold = 0;
  #blockReceivedHandler = null;
  #broadcastStarted = null;
  #syncInProgress = false;
  #askedPeers = new Set();
  #syncCompletions = { apprunning: 0, appinstalling: 0, apperrors: 0 };
  #stateSyncComplete = false;
  #syncTimeout = null;
  #hashSyncAttempts = 0;
  #hashSyncRetryTimer = null;
  #lastHashSyncCheck = 0;

  constructor(options = {}) {
    super();
    this.#blockEmitter = options.blockEmitter;
    this.#peerManager = options.peerManager;
    this.#isEnterprise = options.isEnterprise || (() => false);
  }

  get state() {
    return this.#state;
  }

  start() {
    log.info(`AppSyncOrchestrator - Starting in state ${this.#state}`);

    this.#peerManager.on('peerThresholdReached', (count) => {
      log.info(`AppSyncOrchestrator - Peer threshold reached (${count} peers)`);
      this.#onPeersReady();
    });

    this.#peerManager.on('peersBelowThreshold', (count) => {
      log.info(`AppSyncOrchestrator - Peers below threshold (${count} peers)`);
      this.#onPeersDegraded();
    });

    this.#blockReceivedHandler = (blockHeight) => {
      this.#onBlockReceived(blockHeight);
    };
    this.#blockEmitter.on('blockReceived', this.#blockReceivedHandler);
  }

  onSyncComplete(syncType) {
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
    const eligible = this.#peerManager.getEligibleSyncPeers(MIN_UPTIME_SECONDS);
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
    log.info(`AppSyncOrchestrator - Requesting ${label} sync from ${peers.length} peers`);
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
      this.#resetSyncState();
      log.warn('AppSyncOrchestrator - Degraded, pausing spawner');
      this.emit('readinessLost');
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
      this.#backgroundHashRecheck();
    }
  }

  async #backgroundHashRecheck() {
    if (this.#hashSyncComplete) return;
    if (this.#syncInProgress) return;
    if (Date.now() - this.#lastHashSyncCheck < HASH_SYNC_RECHECK_MS) return;
    this.#lastHashSyncCheck = Date.now();

    try {
      const missing = await appHashSyncService.getMissingHashes();
      if (missing.length === 0) {
        log.info('AppSyncOrchestrator - No missing hashes, marking hash sync complete');
        this.#hashSyncComplete = true;
        await this.#rebuildDb();
        this.#checkReadiness();
        return;
      }
      log.info(`AppSyncOrchestrator - Background recheck: ${missing.length} hashes still missing, retrying`);
      await this.#runHashSync();
      this.#checkReadiness();
    } catch (error) {
      log.error(`AppSyncOrchestrator - Background hash recheck failed: ${error.message}`);
    }
  }

  async #runInitialSync() {
    if (this.#syncInProgress) return;
    log.info('AppSyncOrchestrator - Starting initial hash sync');
    this.emit('syncStarted');
    await this.#runHashSync();
    this.#checkReadiness();
  }

  async #runHashSync() {
    if (this.#syncInProgress) return;
    this.#syncInProgress = true;
    try {
      this.#hashSyncAttempts += 1;
      const result = await appHashSyncService.syncMissingHashes({
        onProgress: (progress) => this.emit('syncProgress', progress),
      });
      if (result.missing > 0) {
        log.warn(`AppSyncOrchestrator - Hash sync has ${result.missing} unresolvable hashes, proceeding`);
      } else {
        log.info('AppSyncOrchestrator - Hash sync complete');
      }
      this.#hashSyncComplete = true;
      this.#lastHashSyncCheck = Date.now();
      this.emit('syncComplete');
      await this.#rebuildDb();
      globalState.checkAndSyncAppHashesWasEverExecuted = true;
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
      log.info('AppSyncOrchestrator - Running expireGlobalApplications');
      await registryManager.expireGlobalApplications();
      this.#dbRebuilt = true;
      this.emit('dbReady');
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
    this.emit('spawnerReady');
  }

  #startAppRunningBroadcast() {
    if (this.#broadcastStarted) return;
    this.#broadcastStarted = true;
    peerNotification.checkAndNotifyPeersOfRunningApps();
    log.info('AppSyncOrchestrator - App running broadcast started');
  }

  stop() {
    if (this.#blockReceivedHandler) {
      this.#blockEmitter.removeListener('blockReceived', this.#blockReceivedHandler);
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
    this.removeAllListeners();
  }
}

module.exports = { AppSyncOrchestrator, STATES };
