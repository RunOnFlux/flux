const { newCorrelationId } = require('./messageIntent');

/**
 * The requests this node has outstanding to peers.
 *
 * A request is named by its own id and bound to the channel it went out on. Both are
 * load-bearing: the channel dies when a peer reconnects, and the id is what tells two
 * sequential requests on one channel apart. An answer to a request that has already
 * ended must never settle the one that replaced it.
 *
 * Settling happens once. A settled request keeps its outcome until its owner discards
 * it, because "this peer answered" outlives the waiting for it.
 */
class PeerRequests {
  #requests = new Map();

  #arm(request, timeoutMs, onTimeout) {
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    if (!timeoutMs || !onTimeout) return;
    request.timer = setTimeout(() => onTimeout(request.peerKey, request.id), timeoutMs);
    // So a pending deadline cannot hold the process open.
    if (request.timer.unref) request.timer.unref();
  }

  /**
   * Start waiting on a peer, replacing whatever was outstanding to it.
   * @param {string} peerKey ip:port
   * @param {object} [options]
   * @param {string} [options.id] Defaults to a fresh one.
   * @param {*} [options.channel] What it went out on, null when the caller has no notion.
   * @param {number} [options.timeoutMs] Deadline for the peer saying anything at all.
   * @param {Function} [options.onTimeout] Called with (peerKey, id) when it expires.
   * @returns {{peerKey: string, id: string, channel: *, outcome: string|null,
   *   settled: Promise<string>}}
   */
  open(peerKey, options = {}) {
    const {
      id, channel = null, timeoutMs, onTimeout,
    } = options;
    this.discard(peerKey);
    const request = {
      peerKey,
      id: id || newCorrelationId(),
      channel,
      outcome: null,
      timer: null,
      resolve: null,
    };
    request.settled = new Promise((resolve) => { request.resolve = resolve; });
    this.#requests.set(peerKey, request);
    this.#arm(request, timeoutMs, onTimeout);
    return request;
  }

  /**
   * The peer is working, so its deadline restarts.
   * @param {string} peerKey ip:port
   * @param {object} [options] timeoutMs and onTimeout, as open takes them.
   * @returns {boolean} Whether a request was open to renew.
   */
  note(peerKey, options = {}) {
    const request = this.#requests.get(peerKey);
    if (!request || request.outcome) return false;
    this.#arm(request, options.timeoutMs, options.onTimeout);
    return true;
  }

  /**
   * End a request, recording why.
   *
   * An id or channel that does not match the open request is an answer to something
   * already over, and settles nothing.
   * @param {string} peerKey ip:port
   * @param {string} outcome Why it ended.
   * @param {object} [match] id and/or channel the answer named.
   * @returns {boolean} true if this call is the one that ended it.
   */
  settle(peerKey, outcome, match = {}) {
    const request = this.#requests.get(peerKey);
    if (!request || request.outcome) return false;
    if (match.id && match.id !== request.id) return false;
    if ('channel' in match && (match.channel ?? null) !== request.channel) return false;
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    request.outcome = outcome;
    request.resolve(outcome);
    return true;
  }

  /**
   * End every request still open, because whatever they belong to has.
   * @param {string} outcome
   * @returns {number} How many were still open.
   */
  settleAll(outcome) {
    let open = 0;
    this.#requests.forEach((request, peerKey) => {
      if (request.outcome) return;
      open += 1;
      this.settle(peerKey, outcome);
    });
    return open;
  }

  /**
   * Forget a request, so the peer is available again.
   * @param {string} peerKey ip:port
   * @returns {void}
   */
  discard(peerKey) {
    const request = this.#requests.get(peerKey);
    if (!request) return;
    if (request.timer) clearTimeout(request.timer);
    // So nothing awaiting it hangs on a request that no longer exists.
    if (!request.outcome) request.resolve('discarded');
    this.#requests.delete(peerKey);
  }

  /** Forget all of them. */
  discardAll() {
    [...this.#requests.keys()].forEach((peerKey) => this.discard(peerKey));
  }

  /**
   * The settling of a request already in flight to this peer, or null when there is none.
   *
   * What a caller waits on instead of opening a second. A second ask is not more
   * informative, and a caller that returned early instead would report "asked" on a
   * question it never waited for the answer to.
   * @param {string} peerKey ip:port
   * @returns {Promise<string>|null}
   */
  pending(peerKey) {
    const request = this.#requests.get(peerKey);
    return request && !request.outcome ? request.settled : null;
  }

  /**
   * Whether a request to this peer is still open, optionally on a given channel.
   * @param {string} peerKey ip:port
   * @param {object} [match] channel the answer arrived on.
   * @returns {boolean}
   */
  isOpen(peerKey, match = {}) {
    const request = this.#requests.get(peerKey);
    if (!request || request.outcome) return false;
    if ('channel' in match && (match.channel ?? null) !== request.channel) return false;
    return true;
  }

  /**
   * Whether this peer has a request against it at all, open or ended.
   * @param {string} peerKey ip:port
   * @returns {boolean}
   */
  has(peerKey) {
    return this.#requests.has(peerKey);
  }

  /**
   * Whether this peer has answered the question put to it, or ended it some other way.
   *
   * "Asked and heard from", as distinct from `isOpen`'s "waiting on right now". A caller
   * deciding something about the peer SET reads this of each of them, which is why a
   * settled request is kept rather than cleared by the waiting ending.
   * @param {string} peerKey ip:port
   * @returns {boolean}
   */
  settled(peerKey) {
    const request = this.#requests.get(peerKey);
    return Boolean(request && request.outcome);
  }

  /**
   * How the request against this peer ended, or null while it is open or absent.
   *
   * What a caller reads to decide something about the peer SET: the outcome records what the
   * peer's answer established, not merely that one arrived.
   * @param {string} peerKey ip:port
   * @returns {string|null}
   */
  outcomeOf(peerKey) {
    const request = this.#requests.get(peerKey);
    return (request && request.outcome) || null;
  }

  /** How many are still open. */
  openCount() {
    let open = 0;
    this.#requests.forEach((request) => { if (!request.outcome) open += 1; });
    return open;
  }

  /** Every peer with a request against it. */
  keys() {
    return [...this.#requests.keys()];
  }
}

module.exports = { PeerRequests };
