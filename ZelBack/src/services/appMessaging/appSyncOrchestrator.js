const fs = require('fs').promises;
const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const appHashSyncService = require('./appHashSyncService');
const peerNotification = require('./peerNotification');
const registryManager = require('../appDatabase/registryManager');
const globalState = require('../utils/globalState');
const peerCodec = require('../utils/peerCodec');
const { appSyncEvents, EVENTS } = require('../utils/appSyncEvents');
const fluxEventBus = require('../utils/fluxEventBus');
const { nodeSigner } = require('../utils/nodeSigner');

const startupCollection = config.database.local.collections.nodeStartupTracker;

const STATES = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  SYNCING: 'SYNCING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  RESYNCING: 'RESYNCING',
});

const MIN_SYNC_COMPLETIONS = config.fluxapps.appSyncMinCompletions ?? 3;
const SYNC_TIMEOUT_MS = config.fluxapps.syncTimeoutMs ?? 120000;
const HASH_SYNC_MAX_RETRIES = config.fluxapps.hashSyncMaxRetries ?? 3;
const HASH_SYNC_RETRY_MS = config.fluxapps.hashSyncRetryMs ?? 300000;
const FALLBACK_RECHECK_BLOCKS = config.fluxapps.hashSyncFallbackRecheckBlocks ?? 100;
const FALLBACK_MINUTES = config.fluxapps.appSyncFallbackMinutes ?? 125;
const FALLBACK_MINUTES_ENTERPRISE = config.fluxapps.appSyncFallbackMinutesEnterprise ?? 62;
const BLOCKS_PER_MINUTE = 2;
// THE TWO WAYS A PEER CAN BE QUIET, and they mean different things.
//
// A slot must be able to fail and its replacement still finish inside the
// budget, so with S as a healthy peer's completion time - about a minute on
// our fleet - both of these have to satisfy `deadline + S <= SYNC_TIMEOUT_MS`.
// At 120s that leaves 50s and 30s of slack respectively.
//
// FIRST_RESPONSE is "never spoke". The only work between our send and the
// peer's first batch is a signature check, one indexed query and serialising
// 2000 documents, so a tenth of the budget is about an order of magnitude more
// than it needs - and a peer that has sent NOTHING is unambiguous, because a
// peer with nothing to report still sends an empty final batch.
//
// STALL is "spoke, then stopped", which needs more room because a peer may
// legitimately be working between batches. A quarter caps what a stalled peer
// can spend. In production it also lands inside the transport's own liveness
// window (wsPingIntervalMs * wsMaxMissedPongs = 45s), so the sync replaces a
// stalled peer before the socket layer has decided it is dead.
const FIRST_RESPONSE_MS = Math.max(1, Math.floor(SYNC_TIMEOUT_MS / 12));
const STALL_MS = Math.max(1, Math.floor(SYNC_TIMEOUT_MS / 4));

class AppSyncOrchestrator {
  #state = STATES.INITIALIZING;
  #blockEmitter = null;
  #getEligibleSyncPeers = null;
  #onPeerEvent = null;
  #offPeerEvent = null;
  #markSyncRequested = null;
  #markSyncDeclined = null;

  #isSyncRequested = null;
  #clearSyncRequested = null;
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
  #peerAddedHandler = null;
  #peerRemovedHandler = null;
  #ephemeralSyncHandler = null;
  #ephemeralRefusedHandler = null;
  #ephemeralProgressHandler = null;
  #hashUnresolvedHandler = null;
  #hashesChangedHandler = null;
  #broadcastStarted = null;
  #started = false;
  #syncInProgress = false;
  // WHICH peers answered, not how many answers arrived. Three responses from
  // one peer are one peer's view of the network, and counting them as three
  // satisfied the requirement without ever asking anyone else.
  #syncCompletions = { apprunning: new Set(), appinstalling: new Set(), apperrors: new Set() };
  #stateSyncComplete = false;
  #syncTimeout = null;
  // peerKey -> { timer, spoken }. One entry per outstanding request. A peer
  // with a slot is a request that can still be answered; the slot is what the
  // deadline hangs off, and freeing it is what makes room for someone else.
  #slots = new Map();
  #hashSyncAttempts = 0;
  #hashSyncRetryTimer = null;
  #nextHashRetryHeight = 0;
  #lastBlockHeight = 0;
  #fluxVersion = null;
  #heartbeatInterval = null;
  #bootContext = null;
  #canSendMessages = false;
  #peerCountIfAboveThreshold = () => 0;

  constructor(options = {}) {
    this.#blockEmitter = options.blockEmitter;
    this.#getEligibleSyncPeers = options.getEligibleSyncPeers;
    this.#onPeerEvent = options.onPeerEvent;
    this.#offPeerEvent = options.offPeerEvent;
    this.#markSyncRequested = options.markSyncRequested ?? (() => {});
    this.#markSyncDeclined = options.markSyncDeclined ?? (() => false);
    // The peer manager owns the peers, so it owns which of them have been asked.
    // Keeping a second set here was the defect: remove() deletes its copy when a
    // peer goes, and nothing deleted this one.
    this.#isSyncRequested = options.isSyncRequested ?? (() => false);
    this.#clearSyncRequested = options.clearSyncRequested ?? (() => {});
    this.#isEnterprise = options.isEnterprise ?? (() => false);
    this.#peerCountIfAboveThreshold = options.peerCountIfAboveThreshold ?? (() => 0);
    this.#waitForNetworkState = options.networkStateReady ?? null;
    this.#fluxVersion = options.fluxVersion ?? null;
  }

  get state() {
    return this.#state;
  }

  #setState(newState) {
    const prevState = this.#state;
    if (prevState === newState) return;
    this.#state = newState;
    fluxEventBus.publish('orchestrator:stateChanged', { from: prevState, to: newState });
    if (prevState === STATES.READY && newState !== STATES.READY) {
      appSyncEvents.emit(EVENTS.READINESS_LOST);
    }
    if (newState === STATES.READY && prevState !== STATES.READY) {
      appSyncEvents.emit(EVENTS.SPAWNER_READY);
    }
  }

  async start(bootContext) {
    if (this.#started) return;
    this.#started = true;
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
    // A peer that joins while the state sync is still short is the retry the
    // request path already anticipates and never performed. The asked-mark
    // lives on the peer so it dies with the connection that carried the
    // request - the peer becomes askable again - but the only trigger was
    // `peerThresholdReached`, which is a latched edge that had already been
    // spent, so nothing asked. The remaining road was the block timer, 125
    // minutes of SYNCING with the spawner paused.
    this.#peerAddedHandler = () => this.#onPeerAdded();
    this.#onPeerEvent('peerThresholdReached', this.#peerThresholdHandler);
    this.#onPeerEvent('peersBelowThreshold', this.#peersBelowHandler);
    this.#onPeerEvent('peerAdded', this.#peerAddedHandler);
    this.#peerRemovedHandler = (peerKey) => this.#onPeerRemoved(peerKey);
    this.#onPeerEvent('peerRemoved', this.#peerRemovedHandler);

    // peerThresholdReached is edge-triggered and latched in FluxPeerManager:
    // if peers connected fast enough that the threshold was crossed BEFORE the
    // subscriptions above (e.g. inbound reconnects racing a restart), the edge
    // has already fired and never re-fires, which would leave #peersReady
    // false and stall ephemeral state sync until the block timer. Read the
    // level after subscribing to the edge.
    const peersAlready = this.#peerCountIfAboveThreshold();
    if (peersAlready && !this.#peersReady) {
      this.#peerThresholdHandler(peersAlready);
    }

    this.#ephemeralSyncHandler = (syncType, peerKey) => this.#onEphemeralSyncComplete(syncType, peerKey);
    appSyncEvents.on(EVENTS.EPHEMERAL_SYNC_COMPLETE, this.#ephemeralSyncHandler);

    this.#ephemeralRefusedHandler = (syncType, peerKey) => this.#onEphemeralSyncRefused(syncType, peerKey);
    appSyncEvents.on(EVENTS.EPHEMERAL_SYNC_REFUSED, this.#ephemeralRefusedHandler);

    this.#ephemeralProgressHandler = (syncType, peerKey) => this.#onEphemeralSyncProgress(syncType, peerKey);
    appSyncEvents.on(EVENTS.EPHEMERAL_SYNC_PROGRESS, this.#ephemeralProgressHandler);

    this.#hashUnresolvedHandler = () => this.#onHashUnresolved();
    appSyncEvents.on(EVENTS.HASH_UNRESOLVED, this.#hashUnresolvedHandler);

    this.#blockReceivedHandler = (blockHeight) => {
      this.#onBlocksProcessed(blockHeight);
    };
    this.#blockEmitter.on('blocksProcessed', this.#blockReceivedHandler);

    this.#hashesChangedHandler = () => this.#onHashesChanged();
    this.#blockEmitter.on('hashesChanged', this.#hashesChangedHandler);

    fluxEventBus.publish('orchestrator:started', { state: this.#state, bootContext });

    if (this.#waitForNetworkState) {
      await this.#waitForNetworkState();
      this.#networkReady = true;
      log.info('AppSyncOrchestrator - Network state ready');
    } else {
      this.#networkReady = true;
    }
    // Before any block arrives, because a node whose fallback is 0 blocks is
    // authoritative from the moment it starts and a peer may ask it first.
    this.#publishStateSyncAuthority();

    // #peersReady may already be true here (live edge during the network-state
    // wait, or the latched-level check above), so always attempt the start.
    this.#tryStartSync();
  }

  #tryStartSync() {
    if (!this.#networkReady || !this.#peersReady) return;
    this.#onPeersReady();
  }

  /**
   * Top the pool of outstanding sync requests back up when a peer joins.
   *
   * Only while the state sync is still incomplete, and only once it has
   * started - before that the threshold edge owns the first ask. #requestSyncs
   * asks the deficit, so this sends nothing while the pool is whole.
   * @returns {void}
   */
  #onPeerAdded() {
    if (!this.#networkReady || !this.#peersReady) return;
    if (this.#stateSyncComplete) return;
    this.#requestSyncs();
  }

  /**
   * Record that one peer finished one sync type.
   * @param {string} syncType apprunning | appinstalling | apperrors
   * @param {string} peerKey ip:port of the peer that answered.
   * @returns {void}
   */
  #onEphemeralSyncComplete(syncType, peerKey) {
    if (this.#stateSyncComplete) return;
    const answered = this.#syncCompletions[syncType];
    if (answered === undefined) return;
    // An answer nobody can attribute cannot be counted. Counting it is the
    // defect this records peers to avoid, and a completion whose peer is
    // missing means the response path stopped saying who it came from - which
    // is a fault to report, not to absorb.
    if (!peerKey) {
      log.error(`AppSyncOrchestrator - ${syncType} sync complete with no peer, not counted`);
      return;
    }
    answered.add(peerKey);
    // Its answer is in, so it is no longer something being waited on.
    if (this.#syncCompletions.appinstalling.has(peerKey)
      && this.#syncCompletions.apperrors.has(peerKey)
      && this.#syncCompletions.apprunning.has(peerKey)) this.#closeSlot(peerKey);
    log.info(`AppSyncOrchestrator - ${syncType} sync complete from ${peerKey} (${answered.size}/${MIN_SYNC_COMPLETIONS} peers)`);
    fluxEventBus.publish('ephemeralSync:peerComplete', {
      syncType,
      peer: peerKey,
      completions: answered.size,
      required: MIN_SYNC_COMPLETIONS,
    });
    if (this.#syncCompletions.apprunning.size >= MIN_SYNC_COMPLETIONS
      && this.#syncCompletions.appinstalling.size >= MIN_SYNC_COMPLETIONS
      && this.#syncCompletions.apperrors.size >= MIN_SYNC_COMPLETIONS) {
      this.#stateSyncComplete = true;
      this.#publishStateSyncAuthority();
      if (this.#syncTimeout) {
        clearTimeout(this.#syncTimeout);
        this.#syncTimeout = null;
      }
      this.#clearSyncRequested();
      log.info('AppSyncOrchestrator - All state syncs complete');
      fluxEventBus.publish('ephemeralSync:allComplete', {
        apprunning: this.#syncCompletions.apprunning.size,
        appinstalling: this.#syncCompletions.appinstalling.size,
        apperrors: this.#syncCompletions.apperrors.size,
      });
      this.#checkReadiness();
    }
  }

  /**
   * How many peers have answered every counted sync type.
   * @returns {number}
   */
  #completedPeerCount() {
    let complete = 0;
    for (const peerKey of this.#syncCompletions.apprunning) {
      if (this.#syncCompletions.appinstalling.has(peerKey)
        && this.#syncCompletions.apperrors.has(peerKey)) complete += 1;
    }
    return complete;
  }

  /**
   * Start waiting on a peer, with a deadline for it saying anything at all.
   * @param {string} peerKey ip:port
   * @returns {void}
   */
  #openSlot(peerKey) {
    this.#closeSlot(peerKey);
    const timer = setTimeout(
      () => this.#onSlotDeadline(peerKey, 'said nothing'),
      FIRST_RESPONSE_MS,
    );
    if (timer.unref) timer.unref();
    this.#slots.set(peerKey, { timer, spoken: false });
  }

  /**
   * Stop waiting on a peer, whatever the reason.
   * @param {string} peerKey ip:port
   * @returns {boolean} true if a slot was held.
   */
  #closeSlot(peerKey) {
    const slot = this.#slots.get(peerKey);
    if (!slot) return false;
    clearTimeout(slot.timer);
    this.#slots.delete(peerKey);
    return true;
  }

  /**
   * Anything arriving from a peer proves it is working, so its clock restarts.
   *
   * The first arrival moves it off the short "never spoke" deadline and onto
   * the longer stall one, because a peer part-way through a large answer is
   * doing exactly what was asked and may legitimately pause between batches.
   * @param {string} syncType apprunning | appinstalling | apperrors
   * @param {string} peerKey ip:port
   * @returns {void}
   */
  #onEphemeralSyncProgress(syncType, peerKey) {
    const slot = this.#slots.get(peerKey);
    if (!slot) return;
    clearTimeout(slot.timer);
    slot.spoken = true;
    slot.timer = setTimeout(
      () => this.#onSlotDeadline(peerKey, 'stopped mid-answer'),
      STALL_MS,
    );
    if (slot.timer.unref) slot.timer.unref();
  }

  /**
   * A peer that is still connected and is not talking.
   *
   * The only case a deadline is for: a closed socket frees its slot the moment
   * it closes, and a refusal frees it on the answer. Declining it here is the
   * same statement the peer would have made itself - it is no use on this
   * connection - so it stops being a candidate and the freed slot is refilled.
   * @param {string} peerKey ip:port
   * @param {string} why What the peer did, for the log.
   * @returns {void}
   */
  #onSlotDeadline(peerKey, why) {
    if (!this.#closeSlot(peerKey)) return;
    if (this.#stateSyncComplete) return;
    this.#markSyncDeclined(peerKey);
    log.warn(`AppSyncOrchestrator - ${peerKey} ${why} within its deadline, asking another peer`);
    fluxEventBus.publish('ephemeralSync:peerTimedOut', { peer: peerKey, reason: why });
    this.#requestSyncs();
  }

  /**
   * A peer whose socket closed can never answer, so its slot frees at once.
   *
   * This is a fact rather than something to infer from a deadline passing, and
   * waiting one out when the answer is already known would cost the sync the
   * whole first-response window for nothing.
   * @param {string} peerKey ip:port
   * @returns {void}
   */
  #onPeerRemoved(peerKey) {
    if (!this.#closeSlot(peerKey)) return;
    if (this.#stateSyncComplete) return;
    log.info(`AppSyncOrchestrator - ${peerKey} went away with a sync outstanding, asking another peer`);
    this.#requestSyncs();
  }

  /**
   * A peer answered by declining, which is not a completion.
   *
   * Declining takes the peer out of the eligible pool for this connection, so
   * the deficit that #requestSyncs asks against opens by one and the next pass
   * fills it from a peer that may actually know something. A peer refuses all
   * three types when it refuses any, and the passes after the first find the
   * pool already topped up and send nothing.
   * @param {string} syncType apprunning | appinstalling | apperrors
   * @param {string} peerKey ip:port of the peer that declined.
   * @returns {void}
   */
  #onEphemeralSyncRefused(syncType, peerKey) {
    if (this.#stateSyncComplete) return;
    if (!peerKey) {
      log.error(`AppSyncOrchestrator - ${syncType} sync declined with no peer, cannot replace it`);
      return;
    }
    this.#closeSlot(peerKey);
    if (this.#markSyncDeclined(peerKey)) {
      log.info(`AppSyncOrchestrator - ${peerKey} declined the ${syncType} sync, asking another peer`);
    }
    // Unconditional, because the deficit decides. A refusal from a peer this
    // node never had in its pool leaves the pool whole, and a whole pool asks
    // nobody - so an early return here would only be a second way of saying
    // the same thing, and one that no test could tell from its absence.
    this.#requestSyncs();
  }

  async #onPeersReady() {
    if (this.#state === STATES.DEGRADED) {
      this.#setState(STATES.RESYNCING);
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

  async #requestSyncs() {
    const eligible = this.#getEligibleSyncPeers();
    // Asked-ness is read from the peer manager rather than remembered here. A
    // peer whose connection dies between being marked and the bytes leaving is
    // removed, which drops its mark with it - so it becomes askable again
    // instead of being permanently recorded as asked and never retried.
    const fresh = eligible.filter((p) => !this.#isSyncRequested(p.key));

    // HOW MANY SLOTS ARE OPEN. Completion needs MIN_SYNC_COMPLETIONS peers to
    // have answered in full, so that many requests have to be outstanding at
    // once - no more, which is what stops this becoming a second round for
    // every peer that arrives during a boot, and no fewer, which is what left
    // a boot waiting on a peer that was never going to reply.
    //
    // A peer holding a slot is an answer still in flight. A peer that has
    // finished is not, and never needs asking again.
    const open = MIN_SYNC_COMPLETIONS - this.#completedPeerCount() - this.#slots.size;

    if (open <= 0) return;

    if (fresh.length < open && !this.#slots.size) {
      log.info(`AppSyncOrchestrator - Only ${fresh.length} eligible sync peers (need ${MIN_SYNC_COMPLETIONS}), falling back to block timer`);
      return;
    }

    const peersToAsk = fresh.slice(0, open);

    if (peersToAsk.length === 0) {
      log.info('AppSyncOrchestrator - No new eligible sync peers to ask');
      return;
    }

    let pubkey;
    let requestTs;
    let signMsg;
    try {
      const signer = await nodeSigner();
      if (!signer) throw new Error('this node cannot sign as itself');
      pubkey = signer.pubKey;
      requestTs = Date.now();
      signMsg = (type, sinceTs) => {
        const msg = peerCodec.buildSyncSignatureMessage(type, sinceTs, requestTs);
        return signer.sign(msg);
      };
    } catch (error) {
      log.error(`AppSyncOrchestrator - Failed to sign sync requests: ${error.message}`);
      return;
    }

    for (const peer of peersToAsk) {
      this.#markSyncRequested(peer.key);
      this.#openSlot(peer.key);
    }

    const tempSig = signMsg(peerCodec.MSG_TYPE.REQUEST_TEMP_MESSAGES, 0);
    const runningSig = signMsg(peerCodec.MSG_TYPE.REQUEST_APP_RUNNING, 0);
    const installingSig = signMsg(peerCodec.MSG_TYPE.REQUEST_APP_INSTALLING, 0);
    const errorsSig = signMsg(peerCodec.MSG_TYPE.REQUEST_APP_INSTALLING_ERRORS, 0);

    this.#sendRequests(peersToAsk, 'temp messages', peerCodec.encodeRequestTempMessages(0, requestTs, pubkey, tempSig));
    this.#sendRequests(peersToAsk, 'apprunning', peerCodec.encodeRequestAppRunning(0, requestTs, pubkey, runningSig));
    this.#sendRequests(peersToAsk, 'appinstalling', peerCodec.encodeRequestAppInstalling(0, requestTs, pubkey, installingSig));
    this.#sendRequests(peersToAsk, 'apperrors', peerCodec.encodeRequestAppInstallingErrors(0, requestTs, pubkey, errorsSig));
    fluxEventBus.publish('ephemeralSync:requested', {
      peerCount: peersToAsk.length,
      peers: peersToAsk.map((p) => p.key),
    });

    if (!this.#syncTimeout && !this.#stateSyncComplete) {
      this.#syncTimeout = setTimeout(() => {
        this.#syncTimeout = null;
        this.#clearSyncRequested();
        if (!this.#stateSyncComplete) {
          log.warn(`AppSyncOrchestrator - Sync timeout, peers answered: apprunning=${this.#syncCompletions.apprunning.size} appinstalling=${this.#syncCompletions.appinstalling.size} apperrors=${this.#syncCompletions.apperrors.size}`);
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
    if (this.#state === STATES.READY || this.#state === STATES.SYNCING) {
      this.#setState(STATES.DEGRADED);
      this.#hashSyncComplete = false;
      this.#dbRebuilt = false;
      globalState.dbReady = false;
      this.#resetSyncState();
      log.warn('AppSyncOrchestrator - Degraded, pausing spawner');
    }
  }

  #resetSyncState() {
    this.#clearSyncRequested();
    for (const peerKey of [...this.#slots.keys()]) this.#closeSlot(peerKey);
    this.#syncCompletions = { apprunning: new Set(), appinstalling: new Set(), apperrors: new Set() };
    this.#stateSyncComplete = false;
    this.#publishStateSyncAuthority();
    this.#hashSyncAttempts = 0;
    if (this.#syncTimeout) {
      clearTimeout(this.#syncTimeout);
      this.#syncTimeout = null;
    }
    if (this.#hashSyncRetryTimer) {
      clearTimeout(this.#hashSyncRetryTimer);
      this.#hashSyncRetryTimer = null;
    }
  }

  #onBlocksProcessed(blockHeight) {
    const count = this.#lastBlockHeight > 0 ? blockHeight - this.#lastBlockHeight : 1;
    this.#lastBlockHeight = blockHeight;
    if (!this.#explorerSynced) {
      this.#explorerSynced = true;
      log.info(`AppSyncOrchestrator - Explorer synced at block ${blockHeight}`);
      if (this.#state === STATES.INITIALIZING) {
        this.#setState(STATES.SYNCING);
        this.#ensureBlockThreshold();
        this.#runInitialSync();
      }
    }
    if (this.#state === STATES.SYNCING || this.#state === STATES.READY || this.#state === STATES.RESYNCING) {
      this.#blocksSinceSyncStarted += count;
      this.#publishStateSyncAuthority();
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
    if (!this.#canSendMessages) return;
    if (this.#syncInProgress) return;
    if (blockHeight < this.#nextHashRetryHeight) return;

    this.#syncInProgress = true;
    try {
      const result = await appHashSyncService.syncMissingHashes({ currentHeight: this.#lastBlockHeight });
      this.#nextHashRetryHeight = result.nextRetryHeight ?? (this.#lastBlockHeight + FALLBACK_RECHECK_BLOCKS);
      if (result.missing > 0) {
        log.info(`AppSyncOrchestrator - Hash retry: ${result.resolved} resolved, ${result.missing} remaining, next check at block ${this.#nextHashRetryHeight}`);
      }
    } catch (error) {
      log.error(`AppSyncOrchestrator - Hash retry failed: ${error.message}`);
      this.#nextHashRetryHeight = this.#lastBlockHeight + FALLBACK_RECHECK_BLOCKS;
    } finally {
      this.#syncInProgress = false;
    }
  }

  async #runInitialSync() {
    if (this.#syncInProgress) return;
    if (!this.#canSendMessages) {
      log.info('AppSyncOrchestrator - Sync deferred, waiting for message capability');
      return;
    }
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
      const result = await appHashSyncService.syncMissingHashes({ currentHeight: this.#lastBlockHeight });
      if (result.missing > 0) {
        log.warn(`AppSyncOrchestrator - Hash sync has ${result.missing} unresolvable hashes, proceeding`);
      } else {
        log.info('AppSyncOrchestrator - Hash sync complete');
      }
      this.#hashSyncComplete = true;
      this.#nextHashRetryHeight = result.nextRetryHeight ?? (this.#lastBlockHeight + FALLBACK_RECHECK_BLOCKS);
      await this.#writeVersionMarker();
      await this.#rebuildDb();
      fluxEventBus.publish('hashSync:complete', { attempt: this.#hashSyncAttempts, missing: result.missing });
    } catch (error) {
      log.error(`AppSyncOrchestrator - Hash sync failed (attempt ${this.#hashSyncAttempts}/${HASH_SYNC_MAX_RETRIES}): ${error.message}`);
      const willRetry = this.#hashSyncAttempts < HASH_SYNC_MAX_RETRIES;
      fluxEventBus.publish('hashSync:failed', { attempt: this.#hashSyncAttempts, maxRetries: HASH_SYNC_MAX_RETRIES, willRetry, error: error.message });
      if (willRetry) {
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
      globalState.dbReady = true;
      log.info('AppSyncOrchestrator - DB ready');
    } catch (error) {
      log.error(`AppSyncOrchestrator - DB rebuild failed: ${error.message}`);
    }
  }

  // Derived on demand rather than in the constructor because enterprise
  // identity resolves from a cache that may not be warm yet. A configured 0
  // re-derives to 0, so the guard saves repeated work and decides nothing.
  #ensureBlockThreshold() {
    if (this.#blockThreshold !== 0) return;
    const minutes = this.#isEnterprise() ? FALLBACK_MINUTES_ENTERPRISE : FALLBACK_MINUTES;
    this.#blockThreshold = minutes * BLOCKS_PER_MINUTE;
  }

  #isBlockTimerExpired() {
    this.#ensureBlockThreshold();
    return this.#blocksSinceSyncStarted >= this.#blockThreshold;
  }

  #isStateSyncReady() {
    if (this.#stateSyncComplete) return true;
    return this.#isBlockTimerExpired();
  }

  /**
   * Mirror the state-sync verdict where the sync responder can read it.
   *
   * Called wherever an input to #isStateSyncReady moves, so the value never
   * disagrees with the rule. A peer asking us for app state gets a refusal
   * while this is false, because an empty answer from a node that does not yet
   * know is indistinguishable from an empty answer from a node that does - and
   * the asker counts both as a completed survey.
   * @returns {void}
   */
  #publishStateSyncAuthority() {
    globalState.appStateAuthoritative = this.#isStateSyncReady();
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

    if (!this.#canSendMessages) return;

    this.#setState(STATES.READY);
    log.info('AppSyncOrchestrator - All readiness conditions met');
  }

  onMessageCapabilityChange(capable) {
    const prev = this.#canSendMessages;
    this.#canSendMessages = capable;
    if (prev === capable) return;
    if (capable) {
      log.info('AppSyncOrchestrator - Message capability gained');
      if (this.#explorerSynced && !this.#hashSyncComplete) {
        this.#runInitialSync();
      } else {
        this.#checkReadiness();
      }
    } else {
      log.info('AppSyncOrchestrator - Message capability lost');
      if (this.#state === STATES.READY) {
        this.#setState(STATES.SYNCING);
        log.warn('AppSyncOrchestrator - Readiness lost (message capability), pausing spawner');
      }
    }
  }

  async #startAppRunningBroadcast() {
    if (this.#broadcastStarted) return;
    this.#broadcastStarted = true;
    log.info('AppSyncOrchestrator - App running broadcast started');
    await globalState.waitForBootContainerStateSettled();
    peerNotification.checkAndNotifyPeersOfRunningApps();
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

      let currentBootId = null;
      try {
        const bootIdPath = config.system.bootIdPath ?? '/proc/sys/kernel/random/boot_id';
        currentBootId = (await fs.readFile(bootIdPath, 'utf8')).trim();
      } catch (err) {
        log.warn(`Failed to read boot_id: ${err.message}, assuming machine rebooted`);
      }

      const machineRebooted = !currentBootId || !heartbeat || heartbeat.machineBootId !== currentBootId;
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

  async #clearShutdownReason() {
    try {
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      await dbHelper.findOneAndUpdateInDatabase(database, startupCollection, { _id: 'heartbeat' }, { $unset: { shutdownReason: '' } });
    } catch (error) {
      log.error(`Failed to clear shutdown reason: ${error.message}`);
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
    this.#clearShutdownReason();
    writeHeartbeat();
    this.#heartbeatInterval = setInterval(writeHeartbeat, config.system.heartbeatIntervalMs ?? 30000);
  }

  static async writeShutdownReason(reason) {
    try {
      const db = dbHelper.databaseConnection();
      if (!db) return;
      const database = db.db(config.database.local.database);
      await Promise.race([
        dbHelper.findOneAndUpdateInDatabase(
          database,
          config.database.local.collections.nodeStartupTracker,
          { _id: 'heartbeat' },
          { $set: { shutdownReason: reason } },
          { upsert: true },
        ),
        new Promise((_, reject) => { setTimeout(() => reject(new Error('shutdown write timeout')), 3000); }),
      ]);
    } catch (error) {
      log.error(`Failed to write shutdown reason: ${error.message}`);
    }
  }

  stop() {
    this.#started = false;
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval);
      this.#heartbeatInterval = null;
    }
    if (this.#ephemeralSyncHandler) {
      appSyncEvents.removeListener(EVENTS.EPHEMERAL_SYNC_COMPLETE, this.#ephemeralSyncHandler);
    }
    if (this.#ephemeralProgressHandler) {
      appSyncEvents.removeListener(EVENTS.EPHEMERAL_SYNC_PROGRESS, this.#ephemeralProgressHandler);
    }
    if (this.#ephemeralRefusedHandler) {
      appSyncEvents.removeListener(EVENTS.EPHEMERAL_SYNC_REFUSED, this.#ephemeralRefusedHandler);
    }
    if (this.#hashUnresolvedHandler) {
      appSyncEvents.removeListener(EVENTS.HASH_UNRESOLVED, this.#hashUnresolvedHandler);
    }
    if (this.#blockReceivedHandler) {
      this.#blockEmitter.removeListener('blocksProcessed', this.#blockReceivedHandler);
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
    if (this.#peerAddedHandler) {
      this.#offPeerEvent('peerAdded', this.#peerAddedHandler);
    }
    if (this.#peerRemovedHandler) {
      this.#offPeerEvent('peerRemoved', this.#peerRemovedHandler);
    }
    for (const peerKey of [...this.#slots.keys()]) this.#closeSlot(peerKey);
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
