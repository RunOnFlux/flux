const log = require('../../lib/log');
const { FluxPeerSocket } = require('./FluxPeerSocket');

const UNSTABLE_DISCONNECT_THRESHOLD = 5;
const UNSTABLE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

class FluxPeerManager {
  constructor() {
    /** @type {Map<string, FluxPeerSocket>} */
    this._peers = new Map();
    /** @type {Set<string>} */
    this._inboundKeys = new Set();
    /** @type {Set<string>} */
    this._outboundKeys = new Set();
    /** @type {Map<string, {ip: string, port: string, attempts: number, lastAttempt: number}>} */
    this._reconnectQueue = new Map();
    /** @type {Map<string, {disconnects: number, firstDisconnect: number}>} */
    this._unstableNodes = new Map();

    /**
     * Message dispatch callback — set by fluxCommunication.js to break circular dependency.
     * @type {function(object, FluxPeerSocket)|null}
     */
    this.messageDispatcher = null;
  }

  // --- Core CRUD ---

  /**
   * Add a peer connection.
   * @param {WebSocket} ws
   * @param {'inbound'|'outbound'} direction
   * @param {string} ip
   * @param {string} port
   * @returns {FluxPeerSocket}
   */
  add(ws, direction, ip, port) {
    const peer = new FluxPeerSocket(ws, direction, ip, String(port), this);
    this._peers.set(peer.key, peer);
    if (direction === 'inbound') {
      this._inboundKeys.add(peer.key);
    } else {
      this._outboundKeys.add(peer.key);
      // Successful outbound connection — clear from reconnect queue
      this._reconnectQueue.delete(peer.key);
    }
    return peer;
  }

  /**
   * Remove a peer by key. Single cleanup path.
   * @param {string} key - ip:port
   * @param {number} [closeCode] - WebSocket close code, used to decide reconnect behavior
   * @returns {FluxPeerSocket|null}
   */
  remove(key, closeCode) {
    const peer = this._peers.get(key);
    if (!peer) return null;

    this._peers.delete(key);
    this._inboundKeys.delete(key); // no-op if not present
    this._outboundKeys.delete(key); // no-op if not present

    // Track disconnect for unstable node detection
    this.trackDisconnect(peer.ip, peer.port);

    // Queue outbound peers for reconnection only on unexpected disconnections.
    // Deliberate closes (send failure, policy violation, blocked, purposeful)
    // should not be retried.
    if (peer.direction === 'outbound' && !this._isDeliberateClose(closeCode)) {
      this.queueReconnect(peer.ip, peer.port);
    }

    log.info(`Connection ${key} removed from peerManager (${peer.direction})`);
    return peer;
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this._peers.has(key);
  }

  /**
   * @param {string} key
   * @returns {FluxPeerSocket|undefined}
   */
  get(key) {
    return this._peers.get(key);
  }

  // --- Iteration ---

  * outboundValues() {
    for (const key of this._outboundKeys) {
      const peer = this._peers.get(key);
      if (peer) yield peer;
    }
  }

  * inboundValues() {
    for (const key of this._inboundKeys) {
      const peer = this._peers.get(key);
      if (peer) yield peer;
    }
  }

  * allValues() {
    yield* this._peers.values();
  }

  // --- Counts ---

  get outboundCount() {
    return this._outboundKeys.size;
  }

  get inboundCount() {
    return this._inboundKeys.size;
  }

  getNumberOfPeers() {
    return this._peers.size;
  }

  // --- Backward-compat getters (return fresh arrays matching old API shape) ---

  get outgoingConnections() {
    return [...this.outboundValues()].map((p) => p.ws);
  }

  get incomingConnections() {
    return [...this.inboundValues()].map((p) => p.ws);
  }

  get outgoingPeers() {
    return [...this.outboundValues()].map((p) => p.toPeerInfo());
  }

  get incomingPeers() {
    return [...this.inboundValues()].map((p) => p.toPeerInfo());
  }

  // --- Liveness ---

  /**
   * Ping all connected peers.
   */
  pingAll() {
    for (const peer of this._peers.values()) {
      peer.ping();
    }
  }

  /**
   * Terminate peers that have missed 3+ pongs.
   * @returns {number} count of pruned connections
   */
  pruneDeadConnections() {
    let count = 0;
    for (const [key, peer] of this._peers) {
      if (!peer.isAlive) {
        log.info(`Pruning dead connection ${key} (missed ${peer.missedPongs} pongs)`);
        peer.close(4011, 'dead connection');
        this.remove(key);
        count += 1;
      }
    }
    return count;
  }

  // --- Reconnection queue ---

  /**
   * Queue an outbound peer for reconnection by fluxDiscovery.
   * @param {string} ip
   * @param {string} port
   */
  queueReconnect(ip, port) {
    const key = `${ip}:${port}`;
    const existing = this._reconnectQueue.get(key);
    if (existing) {
      existing.attempts += 1;
      existing.lastAttempt = Date.now();
    } else {
      this._reconnectQueue.set(key, {
        ip, port, attempts: 1, lastAttempt: Date.now(),
      });
    }
  }

  getReconnectQueue() {
    return this._reconnectQueue;
  }

  clearReconnectEntry(key) {
    this._reconnectQueue.delete(key);
  }

  // --- Unstable node tracking ---

  /**
   * Track a disconnect for unstable node detection.
   * @param {string} ip
   * @param {string} port
   */
  trackDisconnect(ip, port) {
    const key = `${ip}:${port}`;
    const now = Date.now();
    const entry = this._unstableNodes.get(key);
    if (entry) {
      if (now - entry.firstDisconnect > UNSTABLE_WINDOW_MS) {
        // Window expired, reset
        this._unstableNodes.set(key, { disconnects: 1, firstDisconnect: now });
      } else {
        entry.disconnects += 1;
      }
    } else {
      this._unstableNodes.set(key, { disconnects: 1, firstDisconnect: now });
    }
  }

  /**
   * Check if a node is considered unstable.
   * @param {string} ip
   * @param {string} port
   * @returns {boolean}
   */
  isUnstable(ip, port) {
    const key = `${ip}:${port}`;
    const entry = this._unstableNodes.get(key);
    if (!entry) return false;
    if (Date.now() - entry.firstDisconnect > UNSTABLE_WINDOW_MS) {
      this._unstableNodes.delete(key);
      return false;
    }
    return entry.disconnects >= UNSTABLE_DISCONNECT_THRESHOLD;
  }

  /**
   * Remove expired entries from the unstable nodes map.
   */
  pruneUnstableList() {
    const now = Date.now();
    for (const [key, entry] of this._unstableNodes) {
      if (now - entry.firstDisconnect > UNSTABLE_WINDOW_MS) {
        this._unstableNodes.delete(key);
      }
    }
  }

  // --- Close code classification ---

  /**
   * Returns true if the close code indicates a deliberate/policy close
   * that should not trigger a reconnection attempt.
   * @param {number} [code]
   * @returns {boolean}
   */
  // eslint-disable-next-line class-methods-use-this
  _isDeliberateClose(code) {
    if (!code) return false;
    // 4003-4008: blocked/badOrigin/blockedOrigin (both directions)
    // 4009-4010: purposefully closed
    // 4011: dead connection (pruned)
    // 4016-4017: invalidMsg (both directions)
    return (code >= 4003 && code <= 4011) || code === 4016 || code === 4017;
  }

  // --- Network state ---

  /**
   * @returns {boolean} true if no peers connected
   */
  allPeersDown() {
    return this._peers.size === 0;
  }

  // --- Utility ---

  /**
   * Get a random peer from a given direction.
   * @param {'inbound'|'outbound'} direction
   * @returns {FluxPeerSocket|null}
   */
  getRandomPeer(direction) {
    const keys = direction === 'inbound' ? this._inboundKeys : this._outboundKeys;
    if (keys.size === 0) return null;
    const arr = [...keys];
    const randomKey = arr[Math.floor(Math.random() * arr.length)];
    return this._peers.get(randomKey) || null;
  }

  /**
   * Find peers by IP, optionally filtered by direction.
   * @param {string} ip
   * @param {'inbound'|'outbound'} [direction]
   * @returns {FluxPeerSocket[]}
   */
  findByIp(ip, direction) {
    const results = [];
    const iter = direction
      ? (direction === 'inbound' ? this.inboundValues() : this.outboundValues())
      : this.allValues();
    for (const peer of iter) {
      if (peer.ip === ip) results.push(peer);
    }
    return results;
  }

  // --- Diagnostics ---

  getStats() {
    let dead = 0;
    for (const peer of this._peers.values()) {
      if (!peer.isAlive) dead += 1;
    }
    return {
      inbound: this._inboundKeys.size,
      outbound: this._outboundKeys.size,
      total: this._peers.size,
      dead,
      reconnectQueue: this._reconnectQueue.size,
      unstable: this._unstableNodes.size,
    };
  }

  /**
   * Clear all peers — for testing only.
   */
  _clear() {
    this._peers.clear();
    this._inboundKeys.clear();
    this._outboundKeys.clear();
    this._reconnectQueue.clear();
    this._unstableNodes.clear();
  }
}

// Singleton export
const peerManager = new FluxPeerManager();

module.exports = { FluxPeerManager, peerManager };
