const crypto = require('crypto');
const { PeerRequests } = require('./peerRequests');
const { newCorrelationId } = require('./messageIntent');

// A signed document this node holds, keeps current from its peers, and serves to them.
//
// Resolution is a ladder: what this node already holds, then peers, then the published source
// as a backstop. Every candidate is verified by the receiver, so a source that answers wrongly is
// skipped rather than believed, and the ladder can prefer whatever is nearest without that being
// a trust decision.
//
// The order is what makes the published source a seed rather than a dependency. In steady state
// nothing is fetched at all -- the stored document is valid and that is the end of it -- and when
// a refresh is due, the peers are asked before one request leaves for the source. A node that
// boots while the source is unreachable gets the document from a neighbour.
//
// Everything here answers null rather than an empty value when this node holds no verified
// document. A node that has never read the document must not act on the absence of it.
//
// One instance per document. Everything it touches outside itself -- the log, the event bus, the
// signature check, storage, the source -- is handed to it, so each document's module owns its
// dependencies and its tests replace them where they always have.

// What a candidate turned out to be. Three outcomes, not two: a body that did not verify and a
// body that verified and carried the sequence already held are both "nothing was adopted", and
// they mean opposite things about the source.
const VERDICT = Object.freeze({ ADOPTED: 'adopted', LEVEL: 'level', REJECTED: 'rejected' });

// What a peer's answer established about it, recorded as the ask's outcome. Only NOT_AHEAD bears
// on whether the document this node holds is current. The others say the peer answered, which is
// what ends the ask and releases the decision waiting on the whole set.
const ANSWER = Object.freeze({
  NOT_AHEAD: 'notAhead',
  HOLDS_NOTHING: 'holdsNothing',
  AHEAD: 'ahead',
  ANSWERED: 'answered',
});

/**
 * Milliseconds on the monotonic clock.
 *
 * The one stamp an exchange keeps is an elapsed-time decision and nothing outside this process
 * reads it, so wall time buys nothing and costs the case the interval exists for: a node boots,
 * ntp steps the clock, and a window measured on Date.now() either expires on the spot or holds
 * the source off for as long as the step was.
 * @returns {number}
 */
function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * Where in the backstop period this node's tick falls, derived from its identity.
 *
 * The period is per node, so the fleet's tick distribution IS its restart distribution. After a
 * release wave thousands of nodes restart together, and a period anchored to each start would
 * have them both wait a whole period for the first look AND make that look simultaneously.
 *
 * DETERMINISTIC, not random. A random offset re-rolls on every boot, so a restart wave still has
 * every node drawing inside the same minute. Hashing a stable identity means a node returns to
 * the slot it already had, and the fleet is spread over the period by construction.
 *
 * @param {string} identity Something unique to this node and stable across restarts.
 * @param {number} periodMs The backstop period.
 * @returns {number} An offset in [0, periodMs).
 */
function backstopPhaseMs(identity, periodMs) {
  const digest = crypto.createHash('sha256').update(String(identity)).digest();
  return Number(digest.readBigUInt64BE(0) % BigInt(periodMs));
}

/**
 * This node's identity for phasing a backstop tick: its collateral, which is unique and outlives
 * a reboot.
 *
 * Resolved through a local require to keep the document stores off generalService's load path -
 * the same reason fluxCommunicationMessagesSender requires policyStore locally. A node that
 * cannot answer falls back to a random phase, which is worse than a stable one but still better
 * than every node sharing zero.
 * @param {object} log `{ warn }`.
 * @param {string} name The asking store, for the log.
 * @returns {Promise<string>}
 */
async function collateralPhaseIdentity(log, name) {
  try {
    // eslint-disable-next-line global-require
    const generalService = require('../generalService');
    const collateral = await generalService.obtainNodeCollateralInformation();
    if (collateral && collateral.txhash) return `${collateral.txhash}:${collateral.txindex}`;
  } catch (error) {
    log.warn(`${name} - could not read collateral for tick phasing: ${error.message}`);
  }
  return `random:${crypto.randomBytes(16).toString('hex')}`;
}

class SignedDocumentExchange {
  /**
   * @param {object} options
   * @param {string} options.name Prefix for this exchange's log lines.
   * @param {string} options.noun What the document is called in a log line.
   * @param {object} options.log `{ info, warn, error }`.
   * @param {Function} options.publish `(event, payload)`, the event bus.
   * @param {{changed: string, backstopAsked: string, backstopAnswered: string}} options.events
   * @param {Function} options.verify `(raw, { minSeq, onReject })` -> payload or null.
   * @param {Function} options.read `()` -> `{ raw }` or null: the document last stored.
   * @param {Function} options.write `(raw, seq)`: store an adopted document.
   * @param {Function} options.fetchSource `()` -> the published document's text, or null.
   * @param {Function} options.phaseIdentity `()` -> this node's stable identity, for the tick.
   * @param {object} options.timing
   * @param {number} options.timing.refreshIntervalMs The backstop period.
   * @param {number} options.timing.peerWindowMs How long an ask waits for a peer that has gone.
   * @param {number} options.timing.minConfirmingPeers Peers whose "not ahead" settles it.
   * @param {number} options.timing.backstopRetryIntervalMs Least time between source attempts.
   * @param {Function} [options.onStateChange] Called whenever holding or confirmation changes.
   */
  constructor(options) {
    this.name = options.name;
    this.noun = options.noun;
    this.log = options.log;
    this.publish = options.publish;
    this.events = options.events;
    this.verify = options.verify;
    this.read = options.read;
    this.write = options.write;
    this.fetchSource = options.fetchSource;
    this.phaseIdentity = options.phaseIdentity;
    this.timing = options.timing;
    this.onStateChange = options.onStateChange || (() => {});

    // The verified payload, or null when this node has never obtained one, and the bytes it was
    // verified from. The bytes are kept because that is what a peer is served: re-serialising the
    // payload would produce something the signature does not cover.
    this.current = null;
    this.currentRaw = null;
    // Whether this node has established that NO PEER IT CAN REACH IS AHEAD OF IT. Not "my
    // document is current" - no node can know that without an authority, which is the dependency
    // this design exists to remove. HOLDING a document and having established this are
    // different things: one off disk is real and signed, but says nothing about whether the
    // document moved while this node was down.
    this.confirmed = false;
    this.refreshInterval = null;
    // The one-shot that carries the schedule from boot to this node's own slot in the period.
    this.phaseTimer = null;
    // Asks ONE named peer whether it is ahead: the only way this node asks.
    this.peerRequestFrom = null;
    // The peers that speak this document's protocol. One that does not advertise the capability
    // has no handler for the ask, so it can only be waited out.
    this.peerCapableKeys = null;
    this.peerAnnounce = null;
    // Whether the peer set is above appSyncPeerThreshold, as a LEVEL rather than an edge.
    this.peerAboveThreshold = null;
    // One backstop fetch at a time, so a fleet answering together does not fetch in lockstep.
    this.backstopFetchInFlight = false;
    // When the source was last asked, on the monotonic clock; null until it has been.
    this.lastBackstopAttemptAt = null;
    // The peers that have said they hold a sequence this node does not, and what each claimed.
    // Entries are dropped once this node reaches the sequence they claimed.
    this.claimants = new Map();
    // Whether those claims are being worked through. One chase at a time.
    this.chasingClaim = false;
    // The wait that paces the chase between asks: {timer, resolve}, or null.
    this.claimPace = null;
    // Every peer answers, so silence means only "not there". A settled ask is kept until its
    // peer disconnects: the question belongs to the connection.
    this.peerAsks = new PeerRequests();
    // Told when the document this node holds changes.
    this.listeners = new Set();
    // One refresh at a time.
    this.refreshInFlight = null;
  }

  /** Whether this node holds a verified document. False means unknown, never "empty". */
  isReady() {
    return this.current !== null;
  }

  /** Whether no reachable peer is ahead of what this node holds. */
  isConfirmed() {
    return this.confirmed;
  }

  /** The sequence this node holds, or 0 when it holds nothing. */
  getSeq() {
    return this.current ? this.current.seq : 0;
  }

  /** The verified payload, or null. */
  getPayload() {
    return this.current;
  }

  /** The bytes of the held document, or null. Served to peers exactly as verified. */
  getRaw() {
    return this.currentRaw;
  }

  /**
   * No reachable peer is ahead of this node, so it may act on what it holds.
   *
   * Says nothing about whether this node HOLDS anything: an empty node whose peers are all level
   * with it is genuinely not behind them, it just has nothing to act on yet.
   * @param {string} source What established it, for the log.
   */
  markConfirmed(source) {
    if (this.confirmed) return;
    this.confirmed = true;
    this.onStateChange();
    this.log.info(`${this.name} - seq ${this.getSeq()}: no reachable peer is ahead (${source})`);
  }

  /**
   * Tell everything that depends on the document that it has changed: adoption and restore
   * alike. A listener that throws is logged and skipped.
   * @param {string} source Where the document came from.
   */
  notifyChanged(source) {
    this.publish(this.events.changed, { seq: this.getSeq(), source });
    this.listeners.forEach((listener) => {
      try {
        listener({ seq: this.getSeq(), source });
      } catch (error) {
        this.log.warn(`${this.name} - a ${this.noun} listener threw: ${error.message}`);
      }
    });
  }

  /**
   * Be told when the document changes. Returns an unsubscribe.
   * @param {Function} listener Called with { seq, source } after the document is written.
   * @returns {Function}
   */
  onChanged(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async adopt(raw, payload, source) {
    this.current = payload;
    this.currentRaw = raw;
    this.onStateChange();
    this.log.info(`${this.name} - adopted seq ${payload.seq} from ${source}`);
    this.markConfirmed(`adoption from ${source}`);
    // Persisted before anything downstream is told, so a restart restores what a listener acted
    // on. Failing to store is untidy rather than incorrect - the node runs on the verified
    // document in memory - so a write failure is logged and the announce and notify still happen.
    await this.write(raw, payload.seq)
      .catch((error) => this.log.warn(`${this.name} - could not persist ${this.noun}: ${error.message}`));
    // Announced on adoption, never on a timer: a change spreads outwards from whichever node
    // reached it first, and the traffic is bounded by how often the document changes.
    if (this.peerAnnounce) {
      this.peerAnnounce(payload.seq)
        .catch((error) => this.log.warn(`${this.name} - could not announce seq: ${error.message}`));
    }
    this.notifyChanged(source);
  }

  /**
   * Verify a candidate and adopt it if it beats what this node holds. minSeq is the sequence
   * held, so a source that is merely level is not treated as hostile.
   * @returns {Promise<string>} One of VERDICT.
   */
  async consider(raw, source) {
    const payload = this.verify(raw, {
      minSeq: this.getSeq(),
      onReject: (reason) => this.log.warn(`${this.name} - rejected ${this.noun} from ${source}: ${reason}`),
    });
    if (!payload) return VERDICT.REJECTED;
    if (this.current && payload.seq === this.current.seq) return VERDICT.LEVEL;
    await this.adopt(raw, payload, source);
    return VERDICT.ADOPTED;
  }

  /** The published source. Last in the ladder, and the only step that leaves the network. */
  async fetchFromBackstop() {
    try {
      return await this.fetchSource();
    } catch (error) {
      this.log.warn(`${this.name} - backstop fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Restore the document this node last verified. Re-verified rather than trusted, and dropped
   * when it no longer verifies, because the pinned keys may have moved on.
   * @returns {Promise<boolean>}
   */
  async restore() {
    const stored = await Promise.resolve().then(() => this.read()).catch(() => null);
    if (!stored) return false;
    const payload = this.verify(stored.raw, {
      onReject: (reason) => this.log.warn(`${this.name} - stored ${this.noun} rejected, will refetch: ${reason}`),
    });
    if (!payload) return false;
    if (this.getSeq() >= payload.seq) {
      this.log.info(`${this.name} - stored seq ${payload.seq} not restored: seq ${this.getSeq()} is held`);
      return false;
    }
    this.current = payload;
    this.currentRaw = stored.raw;
    this.onStateChange();
    this.notifyChanged('disk');
    this.log.info(`${this.name} - restored seq ${payload.seq} from disk, pending confirmation`);
    return true;
  }

  /**
   * A document a peer sent. Verified and adopted on its own merits, exactly as one fetched from
   * the backstop would be -- the source is not part of the decision.
   * @returns {Promise<boolean>} Whether it was adopted.
   */
  async offer(raw, peerKey, correlationId) {
    let verdict = VERDICT.REJECTED;
    try {
      verdict = await this.consider(raw, 'peer');
    } catch (error) {
      this.log.error(`${this.name} - ${this.noun} from ${peerKey} could not be considered: ${error.message}`);
    }
    this.settlePeerAsk(peerKey, correlationId,
      verdict === VERDICT.REJECTED ? ANSWER.ANSWERED : ANSWER.NOT_AHEAD);
    return verdict === VERDICT.ADOPTED;
  }

  /**
   * Ends the ask this answer names. THE ID IS THE WHOLE TEST: an adoption announcement carries
   * no id, and a peer volunteering what it holds has not answered a question.
   */
  settlePeerAsk(peerKey, correlationId, outcome = ANSWER.ANSWERED) {
    if (!peerKey || !correlationId) return;
    this.peerAsks.settle(peerKey, outcome, { id: correlationId });
  }

  /**
   * Ask ONE peer whether it is ahead, and adopt what it sends if it is. Never reaches the
   * published source. Settles on the answer, so peerWindowMs bounds only a peer that left.
   * @param {string} peerKey ip:port.
   */
  async askPeer(peerKey) {
    const inFlight = this.peerAsks.pending(peerKey);
    if (inFlight) {
      await inFlight;
      return;
    }
    const request = this.peerAsks.open(peerKey, {
      timeoutMs: this.timing.peerWindowMs,
      onTimeout: (key) => this.peerAsks.settle(key, 'timedOut'),
    });
    try {
      await this.peerRequestFrom(peerKey, this.getSeq(), request.id);
      await request.settled;
    } finally {
      this.peerAsks.settle(peerKey, 'notSent', { id: request.id });
      await this.reconsider()
        .catch((error) => this.log.error(`${this.name} - reconsidering after an ask failed: ${error.message}`));
    }
  }

  /**
   * Ask every capable peer, and wait for all of them. An empty capable set is not an answer:
   * it is this node having nobody to ask, and the caller goes to the backstop.
   */
  async askEveryCapablePeer() {
    const keys = this.peerCapableKeys ? this.peerCapableKeys() : [];
    if (!keys.length) return;
    await Promise.all(keys.map((key) => this.askPeer(key)
      .catch((error) => this.log.warn(`${this.name} - peer ask failed: ${error.message}`))));
  }

  /**
   * Whether this peer speaks the protocol. A transport that cannot say treats every peer as
   * capable: not knowing is not a reason to stop asking.
   */
  isCapable(peerKey) {
    const keys = this.peerCapableKeys ? this.peerCapableKeys() : null;
    return keys === null || keys.includes(peerKey);
  }

  /**
   * The peer set agrees this node is not behind: nothing is outstanding, and at least
   * minConfirmingPeers said "not ahead". A peer holding nothing does not count towards it.
   */
  considerPeerConfirmation() {
    if (this.confirmed || this.peerAsks.openCount()) return;
    const candidates = this.peerCapableKeys ? this.peerCapableKeys() : this.peerAsks.keys();
    const notAhead = candidates.filter((key) => this.peerAsks.outcomeOf(key) === ANSWER.NOT_AHEAD);
    if (notAhead.length < this.timing.minConfirmingPeers) return;
    this.markConfirmed(`${notAhead.length} peers not ahead`);
  }

  /**
   * Announce what the published source answered.
   * @param {string|null} verdict The served body's verdict, or null when nothing was served.
   */
  announceBackstopAnswer(verdict) {
    this.publish(this.events.backstopAnswered, { served: verdict !== null, verdict, seq: this.getSeq() });
  }

  /**
   * The peer set has not settled it, so ask the publisher. Derived from three facts, evaluated
   * wherever one changes: this node is unconfirmed, the peer set is above threshold, and nothing
   * is outstanding. No more often than backstopRetryIntervalMs.
   */
  async considerBackstopFetch() {
    if (this.confirmed || this.peerAsks.openCount() || this.backstopFetchInFlight) return;
    if (!this.peerAboveThreshold || !this.peerAboveThreshold()) return;
    if (this.lastBackstopAttemptAt !== null
      && monotonicMs() - this.lastBackstopAttemptAt < this.timing.backstopRetryIntervalMs) return;
    this.backstopFetchInFlight = true;
    try {
      this.log.info(`${this.name} - the peer set has not settled what this node holds, asking the published source`);
      this.publish(this.events.backstopAsked, { seq: this.getSeq() });
      const raw = await this.fetchFromBackstop();
      if (!raw) {
        this.announceBackstopAnswer(null);
        return;
      }
      const verdict = await this.consider(raw, 'backstop');
      this.announceBackstopAnswer(verdict);
      if (verdict !== VERDICT.REJECTED) this.markConfirmed('the published source');
    } finally {
      this.backstopFetchInFlight = false;
      this.lastBackstopAttemptAt = monotonicMs();
    }
  }

  /** Decide again, because the peer picture changed. Peers first, the publisher second. */
  async reconsider() {
    this.considerPeerConfirmation();
    await this.considerBackstopFetch();
  }

  /**
   * Ask peers, then the backstop.
   * @returns {Promise<boolean>} Whether anything was adopted.
   */
  async refresh() {
    if (this.peerRequestFrom && (!this.peerAboveThreshold || this.peerAboveThreshold())) {
      const before = this.getSeq();
      await this.askEveryCapablePeer();
      if (this.getSeq() > before) return true;
    }
    this.backstopFetchInFlight = true;
    let raw = null;
    try {
      raw = await this.fetchFromBackstop();
    } finally {
      this.backstopFetchInFlight = false;
      this.lastBackstopAttemptAt = monotonicMs();
    }
    if (!raw) {
      this.announceBackstopAnswer(null);
      return false;
    }
    const verdict = await this.consider(raw, 'backstop');
    this.announceBackstopAnswer(verdict);
    if (verdict !== VERDICT.REJECTED) this.markConfirmed('the published source');
    return verdict === VERDICT.ADOPTED;
  }

  /**
   * A peer has connected. Ask it whether it is ahead of us: one message and one reply. Every
   * arrival reconsiders both routes to confirmation, asked or not.
   * @param {string} peerKey ip:port of the peer that connected.
   */
  notePeerAvailable(peerKey) {
    if (!peerKey || !this.peerRequestFrom) return Promise.resolve();
    if (!this.isCapable(peerKey) || this.peerAsks.settled(peerKey)) {
      return this.reconsider()
        .catch((error) => this.log.error(`${this.name} - reconsidering after a peer change failed: ${error.message}`));
    }
    return this.askPeer(peerKey).catch((error) => this.log.warn(`${this.name} - peer ask failed: ${error.message}`));
  }

  /**
   * A peer has gone. Forget what it said, and decide again without it.
   * @param {string} peerKey ip:port of the peer that disconnected.
   */
  notePeerGone(peerKey) {
    if (!peerKey) return Promise.resolve();
    this.peerAsks.discard(peerKey);
    return this.reconsider()
      .catch((error) => this.log.error(`${this.name} - reconsidering after a peer change failed: ${error.message}`));
  }

  /**
   * The peer set has reached the level at which it is worth asking, so decide again. Its own
   * event because the level is written after the arrival that crosses it.
   */
  noteThresholdReached() {
    return this.reconsider()
      .catch((error) => this.log.error(`${this.name} - reconsidering after a peer change failed: ${error.message}`));
  }

  /** refresh(), with at most one in flight. */
  refreshOnce() {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refresh().finally(() => { this.refreshInFlight = null; });
    }
    return this.refreshInFlight;
  }

  /**
   * Wire the peer steps. Until then the ladder is stored + backstop.
   * @param {object} transport
   * @param {Function} [transport.requestFrom] `(peerKey, seq, correlationId)`: ask one peer.
   * @param {Function} [transport.announce] `(seq)`: tell peers what this node has adopted.
   * @param {Function} [transport.aboveThreshold] Whether the peer set is above appSyncPeerThreshold.
   * @param {Function} [transport.capableKeys] The keys of the peers that speak the protocol.
   */
  setPeerTransport({
    requestFrom, announce, aboveThreshold, capableKeys,
  } = {}) {
    this.peerRequestFrom = requestFrom || null;
    this.peerCapableKeys = capableKeys || null;
    this.peerAnnounce = announce || null;
    this.peerAboveThreshold = aboveThreshold || null;
  }

  /**
   * Wait peerWindowMs between the asks of a claim chase.
   * @returns {Promise<boolean>} false when stop() ended the wait.
   */
  paceClaim() {
    return new Promise((resolve) => {
      this.claimPace = {
        timer: setTimeout(() => {
          this.claimPace = null;
          resolve(true);
        }, this.timing.peerWindowMs),
        resolve,
      };
    });
  }

  /**
   * Ask each peer that claimed a sequence this node does not hold, paced, until none is left.
   * A claim cannot be checked; what comes back is a signed document, which can be.
   */
  async pursueClaim() {
    if (this.chasingClaim) return;
    this.chasingClaim = true;
    try {
      const askedFor = new Map();
      for (;;) {
        const next = [...this.claimants.keys()]
          .find((key) => !(this.claimants.get(key) <= askedFor.get(key)));
        if (!next) return;
        const claimed = this.claimants.get(next);
        askedFor.set(next, claimed);
        if (this.getSeq() >= claimed) continue;
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve(this.peerRequestFrom(next, this.getSeq(), newCorrelationId()))
          .catch((error) => this.log.warn(`${this.name} - peer request failed: ${error.message}`));
        // eslint-disable-next-line no-await-in-loop
        if (!await this.paceClaim()) return;
      }
    } finally {
      this.chasingClaim = false;
      for (const [key, claimed] of this.claimants) {
        if (claimed <= this.getSeq()) this.claimants.delete(key);
      }
    }
  }

  /**
   * A peer said what sequence it holds: null for nothing, at or below ours for "not ahead",
   * above ours for a claim worth asking it about.
   */
  notePeerSeq(seq, peerKey, correlationId) {
    if (!Number.isInteger(seq)) {
      this.settlePeerAsk(peerKey, correlationId, ANSWER.HOLDS_NOTHING);
      return;
    }
    if (seq <= this.getSeq()) {
      this.settlePeerAsk(peerKey, correlationId, ANSWER.NOT_AHEAD);
      return;
    }
    this.settlePeerAsk(peerKey, correlationId, ANSWER.AHEAD);
    if (!this.peerRequestFrom || !peerKey) return;
    this.claimants.set(peerKey, seq);
    this.pursueClaim().catch((error) => this.log.warn(`${this.name} - pursuing seq ${seq}: ${error.message}`));
  }

  /** Restore, then keep refreshing on this node's own slot in the period. Safe to call twice. */
  async start() {
    if (this.refreshInterval) return;
    await this.restore();
    const period = this.timing.refreshIntervalMs;
    const phase = backstopPhaseMs(await this.phaseIdentity(), period);
    const now = Date.now();
    const firstTickIn = (Math.ceil((now - phase) / period) * period + phase) - now;
    this.log.info(`${this.name} - backstop phase ${Math.round(phase / 1000)}s, first tick in ${Math.round(firstTickIn / 1000)}s`);
    this.phaseTimer = setTimeout(() => {
      this.refreshOnce().catch((error) => this.log.error(`${this.name} - refresh error: ${error.message}`));
      this.refreshInterval = setInterval(() => {
        this.refreshOnce().catch((error) => this.log.error(`${this.name} - refresh error: ${error.message}`));
      }, period);
    }, firstTickIn);
    this.refreshInterval = this.refreshInterval || this.phaseTimer;
  }

  /** Stop the refresh tick and any claim chase in progress. */
  stop() {
    if (this.claimPace) {
      clearTimeout(this.claimPace.timer);
      this.claimPace.resolve(false);
      this.claimPace = null;
    }
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /** Test seam: forget everything this process holds. */
  reset() {
    this.stop();
    this.current = null;
    this.currentRaw = null;
    this.peerCapableKeys = null;
    this.peerRequestFrom = null;
    this.peerAnnounce = null;
    this.peerAboveThreshold = null;
    this.backstopFetchInFlight = false;
    this.lastBackstopAttemptAt = null;
    this.chasingClaim = false;
    this.claimants.clear();
    this.listeners.clear();
    this.refreshInFlight = null;
    this.peerAsks.discardAll();
    this.confirmed = false;
    this.onStateChange();
  }
}

module.exports = {
  SignedDocumentExchange,
  backstopPhaseMs,
  collateralPhaseIdentity,
  VERDICT,
};
