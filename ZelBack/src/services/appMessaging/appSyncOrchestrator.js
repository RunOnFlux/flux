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
// A chain fact, not a policy: blocks are 30 seconds since the PON fork
// (config.fluxapps.daemonPONFork), so two a minute. Not a knob - a node that
// disagrees with the chain about this converts appSyncFallbackMinutes into the
// wrong number of blocks and waits the wrong length of time in silence.
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

/**
 * A fresh record of which peers have answered which stream.
 *
 * One place, because the tally is built twice - once at construction and again
 * whenever a sync starts over - and a stream present in one copy and not the
 * other is a requirement that quietly stops being checked.
 * @returns {{[syncType: string]: Set<string>}}
 */
function freshSyncCompletions() {
  return {
    apprunning: new Set(),
    appinstalling: new Set(),
    apperrors: new Set(),
    apptemp: new Set(),
  };
}

class AppSyncOrchestrator {
  #state = STATES.INITIALIZING;
  #blockEmitter = null;
  #getEligibleSyncPeers = null;
  #onPeerEvent = null;
  #offPeerEvent = null;
  #waitForNetworkState = null;
  #networkReady = false;
  /**
   * Whether the peer set is up RIGHT NOW, mirroring FluxPeerManager's latch.
   *
   * A level, not a one-way latch. It used to be set on peerThresholdReached
   * and cleared nowhere, which was survivable while nothing but "has the sync
   * ever been allowed to start" read it - and is not, now that the block
   * fallback is gated on it. A latch that never falls cannot say a peer set
   * was lost, and the whole point of the gate is that it was.
   *
   * It tracks the HYSTERETIC pair, because that is the pair the two events it
   * rides on are emitted from: up at appSyncPeerThreshold (12), down at
   * appSyncDegradedThreshold (4). Not a raw count - a node oscillating between
   * 5 and 11 peers is the case the hysteresis exists to absorb, and a gate
   * that reset on any dip below 12 would never let such a node finish.
   */
  #peersReady = false;
  #explorerSynced = false;
  #hashSyncComplete = false;
  #dbRebuilt = false;
  #blocksSinceSyncStarted = 0;
  #blockReceivedHandler = null;
  #peerThresholdHandler = null;
  #peersBelowHandler = null;
  #peerConnectedHandler = null;
  #peerDisconnectedHandler = null;
  #ephemeralSyncHandler = null;
  #ephemeralRefusedHandler = null;
  #ephemeralUnverifiedHandler = null;
  #ephemeralProgressHandler = null;
  #hashUnresolvedHandler = null;
  #hashesChangedHandler = null;
  #broadcastStarted = null;
  #started = false;
  #syncInProgress = false;
  // WHICH peers answered, not how many answers arrived. Three responses from
  // one peer are one peer's view of the network, and counting them as three
  // satisfied the requirement without ever asking anyone else.
  //
  // EVERY stream this node asked for, pending registrations included. A peer
  // answers all four or refuses all four, so a tally that stopped at three
  // credited a peer while it was still delivering - and the record closing on
  // that credit is what stopped this node listening to the rest of it.
  #syncCompletions = freshSyncCompletions();
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
  /**
   * Whether this node has spent its state-sync budget.
   *
   * The budget bounds THE attempt, not one round inside an open-ended series of
   * them: when it runs out the attempt is over, the block fallback is what
   * carries the node to readiness, and nothing asks anyone anything until the
   * sync genuinely starts again - which is a drop below the peer threshold and
   * a recovery, or a restart. Without it "how long before this node gives up"
   * has no answer, because a peer joining an hour later would open another one.
   */
  #syncBudgetSpent = false;
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
      this.#peersReady = false;
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
    this.#peerConnectedHandler = () => this.#reconcile();
    this.#onPeerEvent('peerThresholdReached', this.#peerThresholdHandler);
    this.#onPeerEvent('peersBelowThreshold', this.#peersBelowHandler);
    this.#onPeerEvent('peerConnected', this.#peerConnectedHandler);
    this.#peerDisconnectedHandler = (peerKey, connectionId) => this.#onPeerDisconnected(peerKey, connectionId);
    this.#onPeerEvent('peerDisconnected', this.#peerDisconnectedHandler);

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

    this.#ephemeralUnverifiedHandler = (peerKey) => this.#onEphemeralSyncUnverified(peerKey);
    appSyncEvents.on(EVENTS.EPHEMERAL_SYNC_UNVERIFIED, this.#ephemeralUnverifiedHandler);

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
    if (this.#peerAnswered(peerKey)) this.#closeRequest(peerKey, 'answered');
    log.info(`AppSyncOrchestrator - ${syncType} sync complete from ${peerKey} (${answered.size}/${MIN_SYNC_COMPLETIONS} peers)`);
    fluxEventBus.publish('ephemeralSync:peerComplete', {
      syncType,
      peer: peerKey,
      completions: answered.size,
      required: MIN_SYNC_COMPLETIONS,
    });
    if (Object.values(this.#syncCompletions).every((peers) => peers.size >= MIN_SYNC_COMPLETIONS)) {
      this.#stateSyncComplete = true;
      this.#publishStateSyncAuthority();
      if (this.#syncTimeout) {
        clearTimeout(this.#syncTimeout);
        this.#syncTimeout = null;
      }
      this.#closeRound('the sync completed');
      log.info('AppSyncOrchestrator - All state syncs complete');
      fluxEventBus.publish('ephemeralSync:allComplete', this.#completionCounts());
      this.#checkReadiness();
    }
  }

  /**
   * Whether one peer has delivered every stream it was asked for.
   *
   * Read off the tally rather than named stream by stream, so a stream added
   * to the tally is one a peer has to be seen answering.
   * @param {string} peerKey ip:port
   * @returns {boolean}
   */
  #peerAnswered(peerKey) {
    for (const answered of Object.values(this.#syncCompletions)) {
      if (!answered.has(peerKey)) return false;
    }
    return true;
  }

  /**
   * How many peers have answered every stream.
   *
   * One set is enough to walk: a peer that answered everything is in all of
   * them, so any of them holds every candidate.
   * @returns {number}
   */
  #completedPeerCount() {
    let complete = 0;
    for (const peerKey of this.#syncCompletions.apprunning) {
      if (this.#peerAnswered(peerKey)) complete += 1;
    }
    return complete;
  }

  /**
   * How many peers have answered each stream, for a log line or an event.
   * @returns {{[syncType: string]: number}}
   */
  #completionCounts() {
    return Object.fromEntries(
      Object.entries(this.#syncCompletions).map(([type, peers]) => [type, peers.size]),
    );
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
   * A peer whose connection ended can never answer it, so its request ends too.
   *
   * A peer gets ONE attempt per sync. Its connection dying is the peer's
   * answer to this attempt - it dropped in the middle of it - and a node that
   * re-asked it would spend another of very few slots on a peer that has just
   * shown it cannot hold a socket long enough to answer. The record therefore
   * closes rather than being discarded, and stands: a peer that dials back in
   * is one already tried.
   *
   * Told rather than inferred, and told about the CONNECTION. The two ways one
   * ends - the peer leaving, and a dead socket being replaced by the peer's
   * own reconnect - used to announce themselves differently, and the second not
   * at all; what noticed it was a sweep looking for a connection id that had
   * changed underneath a record. An announcement naming the connection is the
   * whole of that, and an announcement about a connection this request was not
   * written into says nothing about it.
   * @param {string} peerKey ip:port
   * @param {number|null} connectionId The connection that ended.
   * @returns {void}
   */
  #onPeerDisconnected(peerKey, connectionId) {
    const request = this.#requests.get(peerKey);
    if (!request) return;
    if (request.connectionId !== (connectionId ?? null)) return;
    if (!this.#closeRequest(peerKey, 'disconnected')) return;
    if (this.#stateSyncComplete) return;
    log.info(`AppSyncOrchestrator - ${peerKey} went away with a sync outstanding, asking another peer`);
    fluxEventBus.publish('ephemeralSync:peerDisconnected', { peer: peerKey, connectionId: connectionId ?? null });
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

  /**
   * A peer sent something this node cannot attribute to it.
   *
   * Its request ends here rather than on a deadline, because the answer is
   * already known: a stream with a hole in it is not a survey, and waiting the
   * peer out would spend one of very few slots on an answer that cannot be
   * counted whatever else arrives. The record stands, so the peer is not asked
   * again on this connection.
   * @param {string} peerKey ip:port of the peer whose response failed.
   * @returns {void}
   */
  #onEphemeralSyncUnverified(peerKey) {
    if (this.#stateSyncComplete) return;
    if (!peerKey) {
      log.error('AppSyncOrchestrator - An unverifiable sync response named no peer, cannot replace it');
      return;
    }
    if (this.#closeRequest(peerKey, 'unverified')) {
      log.warn(`AppSyncOrchestrator - ${peerKey} sent a response this node could not verify, asking another peer`);
      fluxEventBus.publish('ephemeralSync:peerUnverified', { peer: peerKey });
    }
    // Unconditional for the same reason a refusal is: the deficit decides, and
    // a pool that is already whole asks nobody.
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
    } catch (error) {
      // NOBODY IS HOLDING THIS PROMISE. Every one of the five triggers calls
      // and returns - a peer joining, a peer leaving, a refusal, a deadline,
      // the threshold - and one of them is a timer, so a throw here is a
      // rejection with no owner, which node raises to the process handler in
      // apiServer and answers by exiting. A failed pass is not evidence that
      // the node is broken, and it already has a name: it leaves the pool
      // short exactly as the two passes that give up and return do, and the
      // next trigger asks again. Caught here rather than at the call sites
      // because they all come through here, so a sixth cannot forget.
      log.error(`AppSyncOrchestrator - Reconcile pass failed: ${error.message}`);
    } finally {
      this.#reconciling = false;
    }
  }

  async #reconcilePass() {
    if (this.#stateSyncComplete) return;
    if (this.#syncBudgetSpent) return;
    // Is the peer set up. Before the threshold is first crossed there is
    // nobody worth asking, and once it has fallen below the degraded level
    // there is nobody worth asking again.
    if (!this.#networkReady || !this.#peersReady) return;
    // Are there enough peers to trust an answer RIGHT NOW. A level, and the
    // reason the latch is not enough on its own: DEGRADED is this node's own
    // verdict that it has too few peers for gossip to be reliable, so a survey
    // gathered from them is not one to complete a sync on.
    //
    // Only the gathering. What this stops is a node that has not earned
    // authority taking a short cut to it through the few peers it has left.
    // Authority itself is revoked by #onPeersDegraded, which zeroes the block
    // counter along with everything else a degrade invalidates.
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

    // A peer with any record has had its turn in this attempt, whether it
    // answered, declined, ran out of time or dropped. A record is only ever
    // dropped when the whole attempt restarts.
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

    // Every signature is in hand before the first record opens. Signing can
    // still fail once the key is known - it answers null rather than throwing -
    // and a record opened ahead of one is a peer marked asked with a deadline
    // armed and nothing sent.
    const tempSig = signMsg(peerCodec.MSG_TYPE.REQUEST_TEMP_MESSAGES, 0);
    const runningSig = signMsg(peerCodec.MSG_TYPE.REQUEST_APP_RUNNING, 0);
    const installingSig = signMsg(peerCodec.MSG_TYPE.REQUEST_APP_INSTALLING, 0);
    const errorsSig = signMsg(peerCodec.MSG_TYPE.REQUEST_APP_INSTALLING_ERRORS, 0);

    if (!tempSig || !runningSig || !installingSig || !errorsSig) {
      log.error('AppSyncOrchestrator - Failed to sign sync requests: this node could not sign as itself');
      return;
    }

    for (const peer of peersToAsk) this.#openRequest(peer);

    this.#sendRequests(peersToAsk, 'temp messages', peerCodec.encodeRequestTempMessages(0, requestTs, pubkey, tempSig));
    this.#sendRequests(peersToAsk, 'apprunning', peerCodec.encodeRequestAppRunning(0, requestTs, pubkey, runningSig));
    this.#sendRequests(peersToAsk, 'appinstalling', peerCodec.encodeRequestAppInstalling(0, requestTs, pubkey, installingSig));
    this.#sendRequests(peersToAsk, 'apperrors', peerCodec.encodeRequestAppInstallingErrors(0, requestTs, pubkey, errorsSig));
    // OUTSTANDING IS THE POOL CAP ITSELF, and it is published because nothing
    // outside can work it out. A round's own size is not the cap - two rounds
    // opened in one pass are two events, and a decline is answered here without
    // reaching the event stream at all, so the peers named across events cannot
    // be added up into the number of requests actually open at any moment.
    fluxEventBus.publish('ephemeralSync:requested', {
      peerCount: peersToAsk.length,
      peers: peersToAsk.map((p) => p.key),
      outstanding: this.#openRequestCount(),
    });

    if (!this.#syncTimeout && !this.#stateSyncComplete) {
      this.#syncTimeout = setTimeout(() => {
        this.#syncTimeout = null;
        if (this.#stateSyncComplete) return;
        this.#closeRound('the budget ran out');
        this.#syncBudgetSpent = true;
        for (const peerKey of [...this.#requests.keys()]) this.#discardRequest(peerKey);
        const answered = Object.entries(this.#completionCounts())
          .map(([type, count]) => `${type}=${count}`).join(' ');
        log.warn(`AppSyncOrchestrator - Sync timeout, peers answered: ${answered}`);
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
    // ZEROED, and before the state check, because this is not a state
    // transition - it is the counter losing its meaning. #blocksSinceSyncStarted
    // is a claim about time spent in a position to hear announcements, and the
    // peer set has just gone, so credit earned before the gap does not add to
    // credit earned after it. The state check below only admits READY and
    // SYNCING; a node in RESYNCING that loses its peers again changes no state
    // at all and has exactly the same false credit to lose.
    //
    // It also stops the node answering peers' state-sync requests until it has
    // earned that again, and that is a correction rather than a price. What the
    // fallback buys is the claim that every holder of a running-app location has
    // had time to announce itself TO THIS NODE; a node below
    // appSyncDegradedThreshold (4 peers) was not hearing them, so answering
    // anyway served a view it no longer had. Everything else this method does
    // already takes that view - it drops #hashSyncComplete, #dbRebuilt,
    // globalState.dbReady and #stateSyncComplete.
    this.#blocksSinceSyncStarted = 0;
    if (this.#state === STATES.READY || this.#state === STATES.SYNCING) {
      this.#setState(STATES.DEGRADED);
      this.#hashSyncComplete = false;
      this.#dbRebuilt = false;
      globalState.dbReady = false;
      this.#resetSyncState();
      log.warn('AppSyncOrchestrator - Degraded, pausing spawner');
    }
    this.#publishStateSyncAuthority();
  }

  #resetSyncState() {
    // Everything asked in the round that is ending is forgotten outright, not
    // set aside: the sync starts over, so a peer already tried is a peer to
    // try again rather than one to skip.
    for (const peerKey of [...this.#requests.keys()]) this.#discardRequest(peerKey);
    this.#syncBudgetSpent = false;
    this.#syncCompletions = freshSyncCompletions();
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
        this.#runInitialSync();
      }
    }
    if (this.#state === STATES.SYNCING || this.#state === STATES.READY || this.#state === STATES.RESYNCING) {
      // ONLY WHILE THERE ARE PEERS. The fallback is a bound on a sync attempt
      // that is not finishing; it was also, silently, a bound on having nobody
      // to attempt with, and those are not the same thing. A node that asked
      // and got no answer has waited; a node that asked nobody has not.
      //
      // This is the whole of the invariant: every gate #checkReadiness waives
      // is waived by this counter, so a counter that cannot advance without
      // peers is a node that cannot reach READY without them. There is no
      // separate peer condition for a later change to forget.
      if (this.#peersReady) this.#blocksSinceSyncStarted += count;
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

  // ONE NUMBER, and it is not a preference. FALLBACK_MINUTES is the lifetime of
  // a running-app location record, so it is the point at which every holder has
  // had to announce itself at least once: wait it out and what this node holds
  // is a full view, whether or not a sync ever completed.
  //
  // The announcements have to have been able to ARRIVE for that to be true,
  // which is why the counter behind it only advances while the peer threshold
  // is met (#onBlocksProcessed) and is zeroed when it is lost
  // (#onPeersDegraded). It is therefore 125 CONTINUOUS minutes with peers, not
  // 125 minutes of uptime.
  //
  // There used to be a second, shorter value for enterprise nodes, halved in
  // the manner of the spawner's enterprise deferrals. Those are a priority -
  // how long before a node may compete for an app - and halving one grants an
  // advantage. This is not that: it is how long before a node assumes it knows
  // what the network looks like, and there is no advantage in assuming it
  // sooner. A node can be given priority; it cannot be given information it has
  // not received.
  #isBlockTimerExpired() {
    return this.#blocksSinceSyncStarted >= FALLBACK_MINUTES * BLOCKS_PER_MINUTE;
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
    peerNotification.startBroadcasting();
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

  /**
   * Tear the orchestrator down, and do not return until it is torn down.
   *
   * Async because the announcement loop's stop waits for the cycle in flight:
   * a teardown that returns while that cycle is still running leaves it to
   * finish against services this method has already taken apart.
   *
   * @returns {Promise<void>}
   */
  async stop() {
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
    if (this.#ephemeralUnverifiedHandler) {
      appSyncEvents.removeListener(EVENTS.EPHEMERAL_SYNC_UNVERIFIED, this.#ephemeralUnverifiedHandler);
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
    if (this.#peerConnectedHandler) {
      this.#offPeerEvent('peerConnected', this.#peerConnectedHandler);
    }
    if (this.#peerDisconnectedHandler) {
      this.#offPeerEvent('peerDisconnected', this.#peerDisconnectedHandler);
    }
    for (const peerKey of [...this.#requests.keys()]) this.#discardRequest(peerKey);
    await peerNotification.stopBroadcasting();
    this.#broadcastStarted = null;
    if (this.#syncTimeout) {
      clearTimeout(this.#syncTimeout);
      this.#syncTimeout = null;
    }
    if (this.#hashSyncRetryTimer) {
      clearTimeout(this.#hashSyncRetryTimer);
      this.#hashSyncRetryTimer = null;
    }
    // Authority belongs to a running orchestrator. It is this node's claim to
    // know what the network runs, and the two guards answering a peer's sync
    // request read it - so leaving it set serves a survey drawn from state
    // nothing is maintaining any more.
    globalState.appStateAuthoritative = false;
  }
}

module.exports = { AppSyncOrchestrator, STATES };
