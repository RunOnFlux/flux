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
// HOW LONG AN UNSUCCESSFUL REQUEST STANDS BEFORE THE PEER IS A CANDIDATE AGAIN.
//
// A peer declines because its own app state is not authoritative YET, and a
// peer misses its deadline because it was busy or unlucky. Both stop being
// true, so a record of either has to expire or a peer is never asked again on
// a connection that outlives the reason it was set aside.
//
// This is the responder's own throttle and not a number of its own: a peer
// drops any sync request arriving within syncResponseThrottleMs of the last
// one on that connection, so re-asking sooner is answered with silence and
// spends a first-response deadline to learn nothing. Cooling for less than the
// throttle is strictly worse than not re-asking at all.
//
// It exceeds SYNC_TIMEOUT_MS, so within one round a peer set aside stays set
// aside; it becomes a candidate again for a later one.
const RETRY_AFTER_MS = config.fluxapps.syncResponseThrottleMs ?? 300000;

class AppSyncOrchestrator {
  #state = STATES.INITIALIZING;
  #blockEmitter = null;
  #getEligibleSyncPeers = null;
  #onPeerEvent = null;
  #offPeerEvent = null;
  #peerConnectionId = null;
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
  /**
   * peerKey -> the request outstanding to that peer, and how it ended.
   *
   * ONE record. The deadline hangs off it, the pool counts it, the candidate
   * filter reads it, and the response path asks it whether an arriving answer
   * is still wanted. Those were separate records with separate owners and
   * separate clearing rules, and every way they could disagree was a defect:
   * a round that ended cleared one and left the others running, and a decline
   * written onto a socket had no lifetime at all.
   *
   * A record is OPEN until it has an outcome, then it stands - a peer that has
   * answered or been set aside is not a candidate - until #sweepRequests
   * decides it no longer describes anything.
   * @type {Map<string, {peerKey: string, connectionId: number|null, spoken: boolean,
   *   timer: ReturnType<typeof setTimeout>|null, outcome: string|null, closedAt: number}>}
   */
  #requests = new Map();
  #reconciling = false;
  #reconcileAgain = false;
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
    // Which connection is currently held to an address, so a request can be
    // told from one written into a socket that has since been replaced.
    this.#peerConnectionId = options.peerConnectionId ?? (() => null);
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
    // Every join, because a peer arriving while the pool is short is what can
    // fill it. `peerThresholdReached` is a latched edge that fires once, so it
    // says nothing about a pool that has since lost a member; without this the
    // only remaining road was the block timer, 125 minutes of SYNCING with the
    // spawner paused.
    //
    // Note it announces a change rather than deciding anything: the threshold
    // crossing emits both events from the same call, so this and the handler
    // above run in the same tick, and it is the reconciler that makes that
    // safe rather than either of them knowing about the other.
    this.#peerAddedHandler = () => this.#reconcile();
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

    this.#ephemeralProgressHandler = (peerKey) => this.#onEphemeralSyncProgress(peerKey);
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
    // Its answer is in, so it is no longer something being waited on. The
    // record stands as answered rather than being dropped: a peer that has
    // given its whole view has nothing left to add and must not be re-asked.
    if (this.#syncCompletions.appinstalling.has(peerKey)
      && this.#syncCompletions.apperrors.has(peerKey)
      && this.#syncCompletions.apprunning.has(peerKey)) this.#closeRequest(peerKey, 'answered');
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
      this.#closeRound('the sync completed');
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
   * How many requests are still waiting on an answer.
   * @returns {number}
   */
  #openRequestCount() {
    let open = 0;
    for (const request of this.#requests.values()) if (!request.outcome) open += 1;
    return open;
  }

  /**
   * Start waiting on a peer, with a deadline for it saying anything at all.
   * @param {{key: string, connectionId?: number}} peer
   * @returns {void}
   */
  #openRequest(peer) {
    this.#discardRequest(peer.key);
    const request = {
      peerKey: peer.key,
      connectionId: peer.connectionId ?? null,
      spoken: false,
      timer: null,
      outcome: null,
      closedAt: 0,
    };
    this.#requests.set(peer.key, request);
    request.timer = setTimeout(() => this.#onRequestDeadline(peer.key, 'said nothing'), FIRST_RESPONSE_MS);
    if (request.timer.unref) request.timer.unref();
  }

  /**
   * Stop waiting on a peer, recording why.
   *
   * The record STANDS after this. It is what keeps a peer that has answered,
   * declined or run out of time from being asked again in the next breath, and
   * #sweepRequests is the only thing that decides it has stopped meaning
   * anything.
   * @param {string} peerKey ip:port
   * @param {string} outcome answered | declined | timedOut
   * @returns {boolean} true if the request was still open.
   */
  #closeRequest(peerKey, outcome) {
    const request = this.#requests.get(peerKey);
    if (!request || request.outcome) return false;
    if (request.timer) {
      clearTimeout(request.timer);
      request.timer = null;
    }
    request.outcome = outcome;
    request.closedAt = Date.now();
    return true;
  }

  /**
   * Forget a request entirely, so the peer is a candidate again.
   * @param {string} peerKey ip:port
   * @returns {void}
   */
  #discardRequest(peerKey) {
    const request = this.#requests.get(peerKey);
    if (!request) return;
    if (request.timer) clearTimeout(request.timer);
    this.#requests.delete(peerKey);
  }

  /**
   * Drop the records that have stopped describing anything.
   *
   * Two ways that happens, and each was a peer that could never be asked again
   * for a reason that had expired:
   *
   * - the connection it was sent on is gone, so whatever is at that address
   *   now never saw the request and nothing it says is an answer to it;
   * - it ended in something other than an answer, and long enough has passed
   *   that the reason - not caught up yet, busy, unlucky - can have changed.
   *
   * An answered record never expires. A peer that has given its whole view has
   * nothing to add by being asked twice.
   * @returns {void}
   */
  #sweepRequests() {
    const now = Date.now();
    for (const [peerKey, request] of [...this.#requests]) {
      if (this.#peerConnectionId(peerKey) !== request.connectionId) {
        this.#discardRequest(peerKey);
      } else if (request.outcome && request.outcome !== 'answered'
        && now - request.closedAt >= RETRY_AFTER_MS) {
        this.#discardRequest(peerKey);
      }
    }
  }

  /**
   * End every request still outstanding, because the round they belong to has.
   *
   * Closing them is what stops their answers being accepted, so the response
   * gate and the deadlines read one fact and cannot disagree about whether a
   * peer is still being waited on. A peer that was mid-answer when the budget
   * ran out is recorded as having run out of time, which is what happened -
   * not as having stalled, which is what it would look like to a deadline left
   * armed over a gate that had already stopped listening.
   * @param {string} why For the log.
   * @returns {number} how many were still outstanding.
   */
  #closeRound(why) {
    let outstanding = 0;
    for (const [peerKey, request] of this.#requests) {
      if (request.outcome) continue;
      outstanding += 1;
      this.#closeRequest(peerKey, 'timedOut');
    }
    if (outstanding) {
      log.info(`AppSyncOrchestrator - ${outstanding} state-sync ${outstanding === 1 ? 'request was' : 'requests were'} still outstanding when ${why}`);
    }
    return outstanding;
  }

  /**
   * Anything arriving from a peer proves it is working, so its clock restarts.
   *
   * The first arrival moves it off the short "never spoke" deadline and onto
   * the longer stall one, because a peer part-way through a large answer is
   * doing exactly what was asked and may legitimately pause between batches.
   *
   * Which stream it arrived on does not matter - the question this answers is
   * whether the peer is still there, and any of its four responses says so.
   * @param {string} peerKey ip:port
   * @returns {void}
   */
  #onEphemeralSyncProgress(peerKey) {
    const request = this.#requests.get(peerKey);
    if (!request || request.outcome) return;
    clearTimeout(request.timer);
    request.spoken = true;
    request.timer = setTimeout(() => this.#onRequestDeadline(peerKey, 'stopped mid-answer'), STALL_MS);
    if (request.timer.unref) request.timer.unref();
  }

  /**
   * A peer that is still connected and is not talking.
   *
   * The only case a deadline is for: a closed socket ends its request the
   * moment it closes, a refusal ends it on the answer, and the round ending
   * ends every one of them. So reaching here means the peer is still there and
   * has nothing to show for the time.
   * @param {string} peerKey ip:port
   * @param {string} why What the peer did, for the log.
   * @returns {void}
   */
  #onRequestDeadline(peerKey, why) {
    if (!this.#closeRequest(peerKey, 'timedOut')) return;
    if (this.#stateSyncComplete) return;
    log.warn(`AppSyncOrchestrator - ${peerKey} ${why} within its deadline, asking another peer`);
    fluxEventBus.publish('ephemeralSync:peerTimedOut', { peer: peerKey, reason: why });
    this.#reconcile();
  }

  /**
   * A peer whose socket closed can never answer, so its request ends at once.
   *
   * Discarded rather than closed: the request went into a connection that no
   * longer exists, so it says nothing about the node at that address, and one
   * that dials back in is a peer worth asking rather than one already tried.
   * This is a fact rather than something to infer from a deadline passing, and
   * waiting one out when the answer is already known would cost the sync the
   * whole first-response window for nothing.
   * @param {string} peerKey ip:port
   * @returns {void}
   */
  #onPeerRemoved(peerKey) {
    const request = this.#requests.get(peerKey);
    if (!request) return;
    const wasOpen = !request.outcome;
    this.#discardRequest(peerKey);
    if (!wasOpen || this.#stateSyncComplete) return;
    log.info(`AppSyncOrchestrator - ${peerKey} went away with a sync outstanding, asking another peer`);
    this.#reconcile();
  }

  /**
   * Whether a sync response arriving on this connection is still wanted.
   *
   * The request record answers it, so the gate that admits a response and the
   * deadline that gives up on one read the same fact and cannot drift apart.
   * Asked with the socket because a reconnected peer is a different connection:
   * the request went into the old one, and nothing on the new one answers it.
   * @param {{key: string, connectionId?: number}} peerSocket
   * @returns {boolean}
   */
  isSyncResponseWanted(peerSocket) {
    if (!peerSocket) return false;
    const request = this.#requests.get(peerSocket.key);
    if (!request || request.outcome) return false;
    return request.connectionId === (peerSocket.connectionId ?? null);
  }

  /**
   * A peer answered by declining, which is not a completion.
   *
   * Its request ends as declined, so it stops being a candidate and the pool
   * shows a deficit that the next pass fills from a peer that may actually
   * know something. A peer refuses all three types when it refuses any, and
   * only the first of those closes the request - so the log says once what
   * happened once.
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
    if (this.#closeRequest(peerKey, 'declined')) {
      log.info(`AppSyncOrchestrator - ${peerKey} declined the ${syncType} sync, asking another peer`);
    }
    // Unconditional, because the deficit decides. A refusal from a peer this
    // node never had in its pool leaves the pool whole, and a whole pool asks
    // nobody - so an early return here would only be a second way of saying
    // the same thing, and one that no test could tell from its absence.
    this.#reconcile();
  }

  async #onPeersReady() {
    if (this.#state === STATES.DEGRADED) {
      this.#setState(STATES.RESYNCING);
      log.info('AppSyncOrchestrator - Peers recovered, resyncing');
    }

    this.#startAppRunningBroadcast();
    this.#reconcile();

    if (this.#state === STATES.RESYNCING) {
      if (this.#syncInProgress) return;
      await this.#runHashSync();
      this.#checkReadiness();
    }
  }

  /**
   * How many more peers have to be asked for the sync to be able to complete.
   *
   * Completion needs MIN_SYNC_COMPLETIONS peers to have answered in full, so
   * that many requests are outstanding at once - no more, which is what stops
   * a boot becoming a second round for every peer that arrives, and no fewer,
   * which is what left one waiting on a peer that was never going to reply.
   * @returns {number}
   */
  #syncDeficit() {
    this.#sweepRequests();
    return MIN_SYNC_COMPLETIONS - this.#completedPeerCount() - this.#openRequestCount();
  }

  /**
   * Bring the pool of outstanding sync requests back to what it should be.
   *
   * The only reader-and-writer of the request table. Everything that changes
   * what the pool ought to look like - the peer threshold, a peer joining or
   * leaving, a refusal, a deadline - says so by calling this, and none of them
   * decides anything itself. That is the difference between a level and a
   * poke: a trigger that decided would have to know what the other four had
   * just done.
   *
   * A call arriving while a pass is running marks the table dirty and returns,
   * and the pass runs again to pick up whatever changed. Serialising them is
   * what holds the pool cap: a pass counts the deficit, then fetches a signing
   * key before it can reserve anything, so a second one admitted in that window
   * would count the same deficit and fill it a second time. The threshold
   * crossing emits two triggers from one call, so that window is every boot
   * rather than a corner. It also means a burst of joins fetches the key once.
   *
   * The re-run is not a formality. What lands during a pass is a peer leaving
   * or a deadline firing, both of which close a request and widen the deficit
   * the pass already counted - so the shortfall it left behind is asked for
   * immediately rather than waiting on the next unrelated event.
   *
   * It terminates: the only thing a pass can do to dirty the table itself is
   * lose a peer while writing to it, and that peer is then not a candidate, so
   * the loop is bounded by the number of candidates.
   * @returns {Promise<void>}
   */
  async #reconcile() {
    if (this.#reconciling) {
      this.#reconcileAgain = true;
      return;
    }
    this.#reconciling = true;
    try {
      do {
        this.#reconcileAgain = false;
        // eslint-disable-next-line no-await-in-loop
        await this.#reconcilePass();
      } while (this.#reconcileAgain);
    } finally {
      this.#reconciling = false;
    }
  }

  async #reconcilePass() {
    if (this.#stateSyncComplete) return;
    // Has the sync ever been allowed to start. A latch, and never cleared:
    // before the threshold is first crossed there is nobody worth asking.
    if (!this.#networkReady || !this.#peersReady) return;
    // Are there enough peers to trust an answer RIGHT NOW. A level, and the
    // reason the latch is not enough on its own: DEGRADED is this node's own
    // verdict that it has too few peers for gossip to be reliable, and a node
    // that has said so must not then go and complete a survey on the strength
    // of them - it would publish itself authoritative and start answering
    // other nodes from a view it has already judged untrustworthy.
    //
    // Recovery needs nothing here: crossing the threshold again moves the
    // state to RESYNCING before #onPeersReady reconciles.
    if (this.#state === STATES.DEGRADED) return;

    // Counted once, before the key fetch, and it can only be too LOW by the
    // time that returns: nothing opens a request but this pass, and the guard
    // means no other pass is running. Anything that CLOSES one in the meantime
    // - a deadline, a peer leaving - marks the table dirty on its way past, so
    // the re-run below asks for whatever this pass left behind.
    const open = this.#syncDeficit();
    if (open <= 0) return;

    let signer;
    try {
      signer = await nodeSigner();
      if (!signer) throw new Error('this node cannot sign as itself');
    } catch (error) {
      log.error(`AppSyncOrchestrator - Failed to sign sync requests: ${error.message}`);
      return;
    }

    // A peer with any record is one already asked on this connection, whether
    // it answered, declined or ran out of time. #sweepRequests has just
    // dropped the records that stopped meaning anything.
    const peersToAsk = this.#getEligibleSyncPeers()
      .filter((peer) => !this.#requests.has(peer.key))
      .slice(0, open);

    if (!peersToAsk.length) {
      log.info(`AppSyncOrchestrator - No peer left to ask, ${open} state-sync ${open === 1 ? 'answer is' : 'answers are'} still needed`);
      return;
    }

    const requestTs = Date.now();
    const pubkey = signer.pubKey;
    const signMsg = (type, sinceTs) => signer.sign(peerCodec.buildSyncSignatureMessage(type, sinceTs, requestTs));

    for (const peer of peersToAsk) this.#openRequest(peer);

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
        if (this.#stateSyncComplete) return;
        this.#closeRound('the round ran out of time');
        log.warn(`AppSyncOrchestrator - Sync timeout, peers answered: apprunning=${this.#syncCompletions.apprunning.size} appinstalling=${this.#syncCompletions.appinstalling.size} apperrors=${this.#syncCompletions.apperrors.size}`);
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
    // Everything asked in the round that is ending is forgotten outright, not
    // set aside: the sync starts over, so a peer already tried is a peer to
    // try again rather than one to skip.
    for (const peerKey of [...this.#requests.keys()]) this.#discardRequest(peerKey);
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
    for (const peerKey of [...this.#requests.keys()]) this.#discardRequest(peerKey);
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
