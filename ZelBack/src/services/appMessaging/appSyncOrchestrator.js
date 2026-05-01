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

class AppSyncOrchestrator extends EventEmitter {
  #state = STATES.INITIALIZING;
  #blockEmitter = null;
  #peerManager = null;
  #isEnterprise = null;
  #explorerSynced = false;
  #hashSyncComplete = false;
  #dbRebuilt = false;
  #blocksSinceSyncStarted = 0;
  #locationBlockThreshold = 0;
  #blockReceivedHandler = null;
  #appRunningBroadcastInterval = null;
  #syncInProgress = false;

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

  async #onPeersReady() {
    if (this.#state === STATES.DEGRADED) {
      this.#state = STATES.RESYNCING;
      log.info('AppSyncOrchestrator - Peers recovered, resyncing');
    }

    this.#startAppRunningBroadcast();
    await this.#fetchTempMessages();
    this.#fetchAppRunningMessages();
    this.#fetchAppInstallingMessages();
    this.#fetchAppInstallingErrorMessages();

    if (this.#state === STATES.RESYNCING) {
      if (this.#syncInProgress) return;
      await this.#runHashSync();
      this.#checkReadiness();
    }
  }

  #onPeersDegraded() {
    if (this.#state === STATES.READY) {
      this.#state = STATES.DEGRADED;
      this.#hashSyncComplete = false;
      this.#dbRebuilt = false;
      globalState.appRunningSyncComplete = false;
      log.warn('AppSyncOrchestrator - Degraded, pausing spawner');
      this.emit('readinessLost');
    }
  }

  #onBlockReceived(blockHeight) {
    if (!this.#explorerSynced) {
      this.#explorerSynced = true;
      log.info(`AppSyncOrchestrator - Explorer synced at block ${blockHeight}`);
      if (this.#state === STATES.INITIALIZING) {
        this.#state = STATES.SYNCING;
        this.#runInitialSync();
      }
    }
    if (this.#state === STATES.SYNCING || this.#state === STATES.READY) {
      this.#blocksSinceSyncStarted += 1;
      if (!this.#isLocationReady() && this.#hashSyncComplete && this.#dbRebuilt) {
        this.#checkReadiness();
      }
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
      const result = await appHashSyncService.syncMissingHashes({
        onProgress: (progress) => this.emit('syncProgress', progress),
      });
      if (result.missing > 0) {
        log.warn(`AppSyncOrchestrator - Hash sync has ${result.missing} unresolvable hashes, proceeding`);
      } else {
        log.info('AppSyncOrchestrator - Hash sync complete');
      }
      this.#hashSyncComplete = true;
      this.emit('syncComplete');
      await this.#rebuildDb();
      globalState.checkAndSyncAppHashesWasEverExecuted = true;
    } catch (error) {
      log.error(`AppSyncOrchestrator - Hash sync failed: ${error.message}`);
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

  async #fetchTempMessages() {
    try {
      const eligible = this.#peerManager.getEligibleTempSyncPeers(7200);
      if (eligible.length === 0) {
        log.info('AppSyncOrchestrator - No eligible peers for temp message catch-up');
        return;
      }
      const peersToAsk = eligible.slice(0, 5);
      log.info(`AppSyncOrchestrator - Requesting temp messages from ${peersToAsk.length} peers`);
      for (const peer of peersToAsk) {
        try {
          peer.send(peerCodec.encodeRequestTempMessages());
        } catch (error) {
          log.error(`AppSyncOrchestrator - Failed to request temp messages from ${peer.key}: ${error.message}`);
        }
      }
    } catch (error) {
      log.error(`AppSyncOrchestrator - Temp message catch-up failed: ${error.message}`);
    }
  }

  #fetchAppRunningMessages() {
    try {
      const eligible = this.#peerManager.getEligibleAppRunningSyncPeers(7200);
      if (eligible.length === 0) {
        log.info('AppSyncOrchestrator - No eligible peers for apprunning sync');
        return;
      }
      const peersToAsk = eligible.slice(0, 3);
      log.info(`AppSyncOrchestrator - Requesting apprunning sync from ${peersToAsk.length} peers`);
      for (const peer of peersToAsk) {
        try {
          peer.send(peerCodec.encodeRequestAppRunning(0));
        } catch (error) {
          log.error(`AppSyncOrchestrator - Failed to request apprunning from ${peer.key}: ${error.message}`);
        }
      }
    } catch (error) {
      log.error(`AppSyncOrchestrator - Apprunning sync request failed: ${error.message}`);
    }
  }

  #fetchAppInstallingMessages() {
    try {
      const eligible = this.#peerManager.getEligibleAppRunningSyncPeers(7200);
      if (eligible.length === 0) return;
      const peersToAsk = eligible.slice(0, 3);
      log.info(`AppSyncOrchestrator - Requesting appinstalling sync from ${peersToAsk.length} peers`);
      for (const peer of peersToAsk) {
        try {
          peer.send(peerCodec.encodeRequestAppInstalling(0));
        } catch (error) {
          log.error(`AppSyncOrchestrator - Failed to request appinstalling from ${peer.key}: ${error.message}`);
        }
      }
    } catch (error) {
      log.error(`AppSyncOrchestrator - Appinstalling sync request failed: ${error.message}`);
    }
  }

  #fetchAppInstallingErrorMessages() {
    try {
      const eligible = this.#peerManager.getEligibleAppRunningSyncPeers(7200);
      if (eligible.length === 0) return;
      const peersToAsk = eligible.slice(0, 3);
      log.info(`AppSyncOrchestrator - Requesting appinstalling errors sync from ${peersToAsk.length} peers`);
      for (const peer of peersToAsk) {
        try {
          peer.send(peerCodec.encodeRequestAppInstallingErrors(0));
        } catch (error) {
          log.error(`AppSyncOrchestrator - Failed to request appinstalling errors from ${peer.key}: ${error.message}`);
        }
      }
    } catch (error) {
      log.error(`AppSyncOrchestrator - Appinstalling errors sync request failed: ${error.message}`);
    }
  }

  #isLocationReady() {
    if (globalState.appRunningSyncComplete) return true;
    // Fallback for networks without appStateSync peers
    if (this.#locationBlockThreshold === 0) {
      const enterprise = this.#isEnterprise();
      const blocksPerMinute = 2;
      this.#locationBlockThreshold = enterprise
        ? 62 * blocksPerMinute
        : 125 * blocksPerMinute;
    }
    return this.#blocksSinceSyncStarted >= this.#locationBlockThreshold;
  }

  async #checkReadiness() {
    if (this.#state !== STATES.SYNCING && this.#state !== STATES.RESYNCING) return;
    if (!this.#explorerSynced) return;
    if (!this.#hashSyncComplete) return;
    if (!this.#dbRebuilt) return;
    if (!this.#isLocationReady()) return;

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
    if (this.#appRunningBroadcastInterval) return;

    peerNotification.checkAndNotifyPeersOfRunningApps();
    this.#appRunningBroadcastInterval = setInterval(() => {
      peerNotification.checkAndNotifyPeersOfRunningApps();
    }, 60 * 60 * 1000);
    log.info('AppSyncOrchestrator - App running broadcast started');
  }

  stop() {
    if (this.#blockReceivedHandler) {
      this.#blockEmitter.removeListener('blockReceived', this.#blockReceivedHandler);
    }
    if (this.#appRunningBroadcastInterval) {
      clearInterval(this.#appRunningBroadcastInterval);
      this.#appRunningBroadcastInterval = null;
    }
    this.removeAllListeners();
  }
}

module.exports = { AppSyncOrchestrator, STATES };
