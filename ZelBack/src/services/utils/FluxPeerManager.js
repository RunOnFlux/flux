const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
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
    /** @type {Map<string, number>} "outbound:192.168" → count */
    this._ipGroupCounts = new Map();
    /** @type {Map<string, number>} "outbound:10.0.0.1" → count */
    this._uniqueIps = new Map();
    /** @type {Map<string, {attempts: number, lastAttempt: number}>} */
    this._failedConnections = new Map();

    /**
     * Message dispatch callback — set by fluxCommunication.js to break circular dependency.
     * @type {function(object, FluxPeerSocket)|null}
     */
    this.messageDispatcher = null;

    /**
     * Number of flux nodes in the network — set by fluxDiscovery.
     * @type {number}
     */
    this.numberOfFluxNodes = 0;
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
    // Track IP group and unique IP for diversity checks
    const groupKey = `${direction}:${FluxPeerManager.getIpGroup(ip)}`;
    this._ipGroupCounts.set(groupKey, (this._ipGroupCounts.get(groupKey) || 0) + 1);
    const ipKey = `${direction}:${ip}`;
    this._uniqueIps.set(ipKey, (this._uniqueIps.get(ipKey) || 0) + 1);
    // Successful connection — clear from failed connections
    this._failedConnections.delete(peer.key);
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

    // Decrement IP group and unique IP tracking
    const groupKey = `${peer.direction}:${FluxPeerManager.getIpGroup(peer.ip)}`;
    const groupCount = (this._ipGroupCounts.get(groupKey) || 1) - 1;
    if (groupCount <= 0) this._ipGroupCounts.delete(groupKey);
    else this._ipGroupCounts.set(groupKey, groupCount);
    const ipKey = `${peer.direction}:${peer.ip}`;
    const ipCount = (this._uniqueIps.get(ipKey) || 1) - 1;
    if (ipCount <= 0) this._uniqueIps.delete(ipKey);
    else this._uniqueIps.set(ipKey, ipCount);

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

  // --- Broadcast ---

  /**
   * Send data to peers, with optional direction filter and exclusion.
   * @param {string|Buffer} data
   * @param {object} [options]
   * @param {'inbound'|'outbound'} [options.direction] - limit to one direction
   * @param {string} [options.exclude] - peer key to skip
   * @param {number} [options.delayMs=25] - delay between sends
   */
  async broadcast(data, options = {}) {
    const { direction, exclude, delayMs = 25 } = options;
    // eslint-disable-next-line no-nested-ternary
    const iter = direction === 'outbound' ? this.outboundValues()
      : direction === 'inbound' ? this.inboundValues()
        : this.allValues();
    for (const peer of iter) {
      if (exclude && peer.key === exclude) continue;
      try {
        await serviceHelper.delay(delayMs);
        if (!peer.send(data)) {
          throw new Error(`Connection to ${peer.key} is not open`);
        }
      } catch (e) {
        try {
          const code = peer.direction === 'outbound' ? 4009 : 4010;
          peer.close(code, 'send failure');
        } catch (err) {
          log.error(err);
        }
      }
    }
  }

  // --- IP group tracking ---

  /**
   * Groups IPs by their /16 prefix (first two octets).
   * Heuristic for "same hosting provider" — not a real CIDR calculation,
   * but sufficient for peer diversity across datacenters.
   * @param {string} ip
   * @returns {string}
   */
  static getIpGroup(ip) {
    const parts = ip.split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : ip;
  }

  /**
   * Check if a given IP group already has a connected peer in a direction.
   * @param {string} ipGroup - /16 prefix e.g. "192.168"
   * @param {'inbound'|'outbound'} direction
   * @returns {boolean}
   */
  isIpGroupConnected(ipGroup, direction) {
    return (this._ipGroupCounts.get(`${direction}:${ipGroup}`) || 0) > 0;
  }

  /**
   * Get the number of unique IPs connected in a direction.
   * @param {'inbound'|'outbound'} direction
   * @returns {number}
   */
  getUniqueIpCount(direction) {
    let count = 0;
    for (const [key] of this._uniqueIps) {
      if (key.startsWith(`${direction}:`)) count += 1;
    }
    return count;
  }

  /**
   * Get the set of connected IP groups for a direction.
   * @param {'inbound'|'outbound'} direction
   * @returns {Set<string>}
   */
  getConnectedIpGroups(direction) {
    const groups = new Set();
    const prefix = `${direction}:`;
    for (const [key] of this._ipGroupCounts) {
      if (key.startsWith(prefix)) {
        groups.add(key.substring(prefix.length));
      }
    }
    return groups;
  }

  /**
   * Check if more peers are needed in a given direction.
   * @param {'inbound'|'outbound'} direction
   * @param {object} [thresholds]
   * @param {number} [thresholds.maxCount] - max peer count
   * @param {number} [thresholds.minUniqueIps] - min unique IPs
   * @returns {boolean}
   */
  needsMorePeers(direction, thresholds = {}) {
    const defaults = direction === 'outbound'
      ? { maxCount: 14, minUniqueIps: 9 }
      : { maxCount: 12, minUniqueIps: 5 };
    const { maxCount = defaults.maxCount, minUniqueIps = defaults.minUniqueIps } = thresholds;
    const count = direction === 'outbound' ? this.outboundCount : this.inboundCount;
    const uniqueIps = this.getUniqueIpCount(direction);
    return count < maxCount || uniqueIps < minUniqueIps;
  }

  /**
   * Check if a peer can be accepted for connection.
   * @param {string} ip
   * @param {string} port
   * @param {'inbound'|'outbound'} direction
   * @param {string} myIpGroup - our own IP group
   * @returns {boolean}
   */
  canAcceptPeer(ip, port, direction, myIpGroup) {
    const key = `${ip}:${port}`;
    if (this.has(key)) return false;
    const peerIpGroup = FluxPeerManager.getIpGroup(ip);
    if (peerIpGroup === myIpGroup) return false;
    if (this.isIpGroupConnected(peerIpGroup, direction)) return false;
    return true;
  }

  // --- Private IP detection ---

  /**
   * Check if an IP is in RFC 1918 private ranges.
   * @param {string} ip
   * @returns {boolean}
   */
  static isPrivateIp(ip) {
    const parts = ip.split('.');
    if (parts.length < 4) return false;
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    return false;
  }

  // --- Inbound connection validation ---

  /**
   * Validate and add an inbound WebSocket connection.
   * Handles max connections, IPv4 extraction, private IP rejection, and duplicate checks.
   * Closes the socket on rejection.
   * @param {WebSocket} ws
   * @param {string} [optionalPort]
   */
  validateAndAddInbound(ws, optionalPort) {
    try {
      const port = optionalPort || '16127';
      const maxPeers = 4 * config.fluxapps.minIncoming;
      const maxNumberOfConnections = this.numberOfFluxNodes / 160 < 9 * config.fluxapps.minIncoming
        ? this.numberOfFluxNodes / 160
        : 9 * config.fluxapps.minIncoming;
      const maxCon = Math.max(maxPeers, maxNumberOfConnections);
      if (this.inboundCount > maxCon) {
        setTimeout(() => {
          ws.close(4000, `Max number of incomming connections ${maxCon} reached`);
        }, 1000);
        return;
      }

      let ipv4Peer;
      try {
        ipv4Peer = ws._socket.remoteAddress.replace('::ffff:', '');
        if (!ipv4Peer) {
          ipv4Peer = ws._socket._peername.address.replace('::ffff:', '');
        }
      } catch (error) {
        log.error(error);
        ipv4Peer = ws._socket._peername.address.replace('::ffff:', '');
      }

      if (FluxPeerManager.isPrivateIp(ipv4Peer)) {
        setTimeout(() => {
          ws.close(4002, 'Peer received is using internal IP');
        }, 1000);
        log.error(`Incoming connection of peer from internal IP not allowed: ${ipv4Peer}`);
        return;
      }

      const key = `${ipv4Peer}:${port}`;
      if (this.has(key)) {
        setTimeout(() => {
          ws.close(4001, 'Peer received is already in peers list');
        }, 1000);
        return;
      }

      this.add(ws, 'inbound', ipv4Peer, port);
    } catch (error) {
      log.error(error);
    }
  }

  // --- Reconnect candidates ---

  /**
   * Get filtered reconnect candidates (outbound only).
   * Returns entries that are: not already connected, not unstable, ≤3 attempts.
   * Cleans up ineligible entries internally.
   * @returns {Array<{key: string, ip: string, port: string, attempts: number}>}
   */
  getReconnectCandidates() {
    const candidates = [];
    for (const [key, entry] of this._reconnectQueue) {
      if (this.has(key)) {
        this._reconnectQueue.delete(key);
        continue;
      }
      if (this.isUnstable(entry.ip, entry.port)) {
        this._reconnectQueue.delete(key);
        continue;
      }
      if (entry.attempts > 3) {
        this._reconnectQueue.delete(key);
        continue;
      }
      candidates.push({ key, ...entry });
    }
    return candidates;
  }

  // --- Failed connection tracking ---

  /**
   * Record a failed connection attempt for backoff tracking.
   * @param {string} ip
   * @param {string} port
   */
  recordFailedConnection(ip, port) {
    const key = `${ip}:${port}`;
    const entry = this._failedConnections.get(key);
    if (entry) {
      entry.attempts += 1;
      entry.lastAttempt = Date.now();
    } else {
      this._failedConnections.set(key, { attempts: 1, lastAttempt: Date.now() });
    }
  }

  /**
   * Check if a connection attempt should be made (respects backoff).
   * @param {string} ip
   * @param {string} port
   * @returns {boolean}
   */
  shouldAttemptConnection(ip, port) {
    const key = `${ip}:${port}`;
    if (this.has(key)) return false;
    const entry = this._failedConnections.get(key);
    if (!entry) return true;
    const backoffIdx = Math.min(entry.attempts - 1, FluxPeerManager.CONNECTION_BACKOFF_MS.length - 1);
    const backoffMs = FluxPeerManager.CONNECTION_BACKOFF_MS[backoffIdx];
    return (Date.now() - entry.lastAttempt) >= backoffMs;
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
    this._ipGroupCounts.clear();
    this._uniqueIps.clear();
    this._failedConnections.clear();
  }
}

// Backoff schedule for failed connections: 2min, 5min, 10min, 15min cap
FluxPeerManager.CONNECTION_BACKOFF_MS = [2 * 60000, 5 * 60000, 10 * 60000, 15 * 60000];

// Singleton export
const peerManager = new FluxPeerManager();

module.exports = { FluxPeerManager, peerManager };
