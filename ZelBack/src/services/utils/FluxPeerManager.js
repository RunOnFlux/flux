const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const { FluxPeerSocket, CLOSE_CODES, PEER_SOURCE, DIRECTION, FLUX_VERSION } = require('./FluxPeerSocket');
const peerCodec = require('./peerCodec');

const UNSTABLE_DISCONNECT_THRESHOLD = 5;
const UNSTABLE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const HISTORY_BUFFER_SIZE = 1000;
const PEER_EXCHANGE_MAX_PEERS = 60;
const PEER_TOPOLOGY_MAX_REPORTERS = 100;
const PEER_UPDATE_DEBOUNCE_MS = 2000;

// Reverse lookup: code number → enum name
const CLOSE_CODE_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(CLOSE_CODES).map(([name, code]) => [code, name])),
);

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
    /** @type {Set<string>} keys of outbound connections currently being established */
    this._pendingConnections = new Set();
    /** @type {Map<string, number>} reconnect count per peer key, persists across connection cycles */
    this._reconnectCounts = new Map();

    // --- Peer exchange topology ---
    /** @type {Map<string, Set<string>>} reporter key → their peer keys */
    this._peerTopology = new Map();
    /** @type {Array<function>} topology change listeners */
    this._peerExchangeListeners = [];
    /** @type {{ outbound: Set<string>, inbound: Set<string> }} peers added since last update */
    this._pendingAdds = { outbound: new Set(), inbound: new Set() };
    /** @type {Set<string>} peers removed since last peerUpdate broadcast */
    this._pendingRemoves = new Set();
    /** @type {ReturnType<typeof setTimeout>|null} debounce timer */
    this._peerUpdateTimer = null;

    /**
     * Hash message handlers — set by fluxCommunication.js to break circular dependency.
     * @type {{ handleHashPresent: function, handleHashRequest: function }|null}
     */
    this.hashHandlers = null;

    /**
     * Network health monitor — set by fluxCommunication.js to break circular dependency.
     * @type {import('./NetworkHealthMonitor').NetworkHealthMonitor|null}
     */
    this.networkHealthMonitor = null;

    /** @type {Array<object>} Circular buffer of peer lifecycle events */
    this._history = new Array(HISTORY_BUFFER_SIZE);
    /** @type {number} Next write position in the ring buffer */
    this._historyIndex = 0;
    /** @type {number} Total events recorded (used to know if buffer has wrapped) */
    this._historyCount = 0;

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
   * @param {string} ip
   * @param {string} port
   * @param {object} [options]
   * @param {string} [options.source] - PEER_SOURCE value
   * @param {string[]} [options.remoteCapabilities] - Capabilities advertised by remote
   * @param {number} [options.remoteClockOffsetMs] - Remote clock offset in ms
   * @returns {FluxPeerSocket}
   */
  add(ws, ip, port, options = {}) {
    const key = `${ip}:${String(port)}`;
    const existing = this._peers.get(key);
    if (existing) {
      log.warn(`Replacing existing ${existing.direction} peer ${key}`);
      // Detach old handlers so its onclose doesn't remove the new peer
      existing.ws.onclose = null;
      existing.ws.onerror = null;
      existing.ws.onmessage = null;
      try { existing.ws.close(CLOSE_CODES.DUPLICATE_PEER, 'replaced'); } catch (_e) { /* noop */ }
      this._removeTracking(existing);
    }
    const peer = new FluxPeerSocket(ws, ip, String(port), this);
    peer.source = options.source || PEER_SOURCE.INBOUND;
    if (Array.isArray(options.remoteCapabilities) && options.remoteCapabilities.length) {
      peer.remoteCapabilities = new Set(options.remoteCapabilities);
      log.info(`Peer ${peer.key} capabilities: ${options.remoteCapabilities.join(', ')}`);
    }
    if (typeof options.remoteClockOffsetMs === 'number' && !Number.isNaN(options.remoteClockOffsetMs)) {
      peer.remoteClockOffsetMs = options.remoteClockOffsetMs;
    }
    if (typeof options.remoteVersion === 'string' && options.remoteVersion) {
      peer.remoteVersion = options.remoteVersion;
    }
    if (existing || options.source === PEER_SOURCE.RECONNECT) {
      this._reconnectCounts.set(key, (this._reconnectCounts.get(key) || 0) + 1);
    }
    const { direction } = peer;
    this._peers.set(peer.key, peer);
    if (direction === DIRECTION.INBOUND) {
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
    // Successful connection — clear from failed connections and pending
    this._failedConnections.delete(peer.key);
    this._pendingConnections.delete(peer.key);
    this._recordEvent({
      event: 'connected',
      ip,
      port: String(port),
      direction,
      source: peer.source,
    });
    // Peer exchange: send our full list to new peer, notify others about the addition
    this.sendPeerExchange(peer);
    const dirSet = peer.direction === DIRECTION.OUTBOUND ? this._pendingAdds.outbound : this._pendingAdds.inbound;
    dirSet.add(peer.key);
    this._pendingRemoves.delete(peer.key);
    this._schedulePeerUpdate();
    if (this.networkHealthMonitor) this.networkHealthMonitor.recordConnect();
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

    this._removeTracking(peer);

    // Clean up peer exchange topology and notify others
    this._peerTopology.delete(key);
    this._pendingRemoves.add(key);
    this._pendingAdds.outbound.delete(key);
    this._pendingAdds.inbound.delete(key);
    this._schedulePeerUpdate();

    // Track disconnect for unstable node detection and network health
    this.trackDisconnect(peer.ip, peer.port);
    if (this.networkHealthMonitor) this.networkHealthMonitor.recordDisconnect(peer.connectedAt, closeCode);

    // Queue outbound peers for reconnection only on unexpected disconnections.
    // Whitelist: only reconnect for dead connections, capacity rejections,
    // and standard WebSocket closes (network failures, crashes).
    if (peer.direction === DIRECTION.OUTBOUND && this._shouldReconnect(closeCode)) {
      this.queueReconnect(peer.ip, peer.port);
    }

    const now = Date.now();
    this._recordEvent({
      event: 'disconnected',
      ip: peer.ip,
      port: peer.port,
      direction: peer.direction,
      source: peer.source,
      closeCode: closeCode || null,
      closeCodeName: CLOSE_CODE_NAMES[closeCode] || null,
      duration: now - peer.connectedAt,
      latency: peer.latency,
      missedPongs: peer.missedPongs,
      messagesReceived: peer.messagesReceived,
      messagesSent: peer.messagesSent,
      bytesReceived: peer.bytesReceived,
      bytesSent: peer.bytesSent,
    });

    log.info(`Connection ${key} removed from peerManager (${peer.direction}, code: ${closeCode})`);
    return peer;
  }

  /**
   * Remove tracking data for a peer without triggering reconnect logic.
   * Used by both remove() and add() (when replacing an existing peer).
   * @param {FluxPeerSocket} peer
   * @private
   */
  _removeTracking(peer) {
    this._peers.delete(peer.key);
    this._inboundKeys.delete(peer.key);
    this._outboundKeys.delete(peer.key);

    // Decrement IP group and unique IP tracking
    const groupKey = `${peer.direction}:${FluxPeerManager.getIpGroup(peer.ip)}`;
    const groupCount = (this._ipGroupCounts.get(groupKey) || 1) - 1;
    if (groupCount <= 0) this._ipGroupCounts.delete(groupKey);
    else this._ipGroupCounts.set(groupKey, groupCount);
    const ipKey = `${peer.direction}:${peer.ip}`;
    const ipCount = (this._uniqueIps.get(ipKey) || 1) - 1;
    if (ipCount <= 0) this._uniqueIps.delete(ipKey);
    else this._uniqueIps.set(ipKey, ipCount);
  }

  /**
   * Ping an existing connection to verify it's alive. If the pong comes back
   * within 1s, reject the new socket. If not, the existing connection is dead —
   * replace it with the new one.
   *
   * Called when an inbound duplicate arrives with the X-Flux-Reconnect header,
   * indicating the remote peer believes its old connection died.
   *
   * @param {FluxPeerSocket} existing - The current peer connection to verify
   * @param {WebSocket} ws - The new inbound WebSocket
   * @param {string} ip
   * @param {string} port
   * @param {object} metadata - Peer metadata from upgrade headers
   * @private
   */
  _verifyOrReplace(existing, ws, ip, port, metadata) {
    const VERIFY_TIMEOUT_MS = 1000;
    let settled = false;

    const onPong = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      existing.ws.removeListener('pong', onPong);
      log.info(`Reconnect verify: existing connection ${existing.key} is alive, rejecting new inbound`);
      ws.close(CLOSE_CODES.DUPLICATE_PEER, 'Existing connection verified alive');
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      existing.ws.removeListener('pong', onPong);
      log.info(`Reconnect verify: existing connection ${existing.key} failed pong check, replacing`);
      this.add(ws, ip, port, { source: PEER_SOURCE.INBOUND, ...metadata });
    }, VERIFY_TIMEOUT_MS);

    existing.ws.on('pong', onPong);
    try {
      existing.ws.ping();
    } catch (_e) {
      // ping failed — socket is already dead
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        existing.ws.removeListener('pong', onPong);
        log.info(`Reconnect verify: ping failed for ${existing.key}, replacing`);
        this.add(ws, ip, port, { source: PEER_SOURCE.INBOUND, ...metadata });
      }
    }
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
   * Should we queue this peer for reconnection?
   * Whitelist approach: only reconnect for codes that mean "peer went away unexpectedly".
   * Everything else (policy, auth, admin close, duplicate) means "don't retry".
   * @param {number} [closeCode]
   * @returns {boolean}
   */
  // eslint-disable-next-line class-methods-use-this
  _shouldReconnect(closeCode) {
    // No close code = unexpected disconnect (network failure, crash)
    if (!closeCode) return true;
    // Standard WebSocket codes (1000-1015): normal close, going away, abnormal — worth retrying
    if (closeCode <= 1015) return true;
    // Dead connection: peer stopped responding, worth retrying
    if (closeCode === CLOSE_CODES.DEAD_CONNECTION) return true;
    // Max connections: remote is full, try again next cycle
    if (closeCode === CLOSE_CODES.MAX_CONNECTIONS) return true;
    // Everything else: policy violation, auth failure, admin close, duplicate — don't retry
    return false;
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
    const keys = direction === DIRECTION.INBOUND ? this._inboundKeys : this._outboundKeys;
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
      ? (direction === DIRECTION.INBOUND ? this.inboundValues() : this.outboundValues())
      : this.allValues();
    for (const peer of iter) {
      if (peer.ip === ip) results.push(peer);
    }
    return results;
  }

  // --- Pending connections ---

  /**
   * Mark an outbound connection as in progress (prevents race conditions).
   * @param {string} key - ip:port
   */
  markPending(key) { this._pendingConnections.add(key); }

  /**
   * Clear a pending connection marker.
   * @param {string} key - ip:port
   */
  clearPending(key) { this._pendingConnections.delete(key); }

  /**
   * Check if an outbound connection is currently being established.
   * @param {string} key - ip:port
   * @returns {boolean}
   */
  isPending(key) { return this._pendingConnections.has(key); }

  // --- Broadcast ---

  /**
   * Send data to peers, with optional direction filter and exclusion.
   * When sending to all peers, sends outbound first, then waits 500ms before inbound
   * to prevent broadcast storms.
   * @param {string|Buffer} data
   * @param {object} [options]
   * @param {string} [options.direction] - DIRECTION.INBOUND or DIRECTION.OUTBOUND
   * @param {string} [options.exclude] - peer key to skip
   * @param {number} [options.delayMs=25] - delay between sends
   */
  async broadcast(data, options = {}) {
    const { direction, exclude, delayMs = 25 } = options;
    if (direction) {
      await this._broadcastToGroup(data, direction, exclude, delayMs);
    } else {
      await this._broadcastToGroup(data, DIRECTION.OUTBOUND, exclude, delayMs);
      await serviceHelper.delay(500);
      await this._broadcastToGroup(data, DIRECTION.INBOUND, exclude, delayMs);
    }
  }

  /**
   * Send data to peers in a single direction.
   * @param {string|Buffer} data
   * @param {string} direction - DIRECTION.INBOUND or DIRECTION.OUTBOUND
   * @param {string} [exclude] - peer key to skip
   * @param {number} delayMs - delay between sends
   * @private
   */
  async _broadcastToGroup(data, direction, exclude, delayMs) {
    const iter = direction === DIRECTION.INBOUND ? this.inboundValues() : this.outboundValues();
    for (const peer of iter) {
      if (exclude && peer.key === exclude) continue;
      try {
        await serviceHelper.delay(delayMs);
        if (!peer.send(data)) {
          throw new Error(`Connection to ${peer.key} is not open`);
        }
      } catch (e) {
        try {
          const code = direction === DIRECTION.OUTBOUND ? CLOSE_CODES.CLOSED_OUTBOUND : CLOSE_CODES.CLOSED_INBOUND;
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
    const defaults = direction === DIRECTION.OUTBOUND
      ? { maxCount: 14, minUniqueIps: 9 }
      : { maxCount: 12, minUniqueIps: 5 };
    const { maxCount = defaults.maxCount, minUniqueIps = defaults.minUniqueIps } = thresholds;
    const count = direction === DIRECTION.OUTBOUND ? this.outboundCount : this.inboundCount;
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
   * Extracts remote peer metadata (capabilities, clock offset) from the HTTP upgrade request headers.
   *
   * Called by socketServer route matching. For `/ws/flux/:port`, args are (ws, port, request).
   * For `/ws/flux`, args are (ws, request) — the request lands in optionalPort.
   *
   * @param {WebSocket} ws
   * @param {string|object} [optionalPort] - Port string, or the request object if no :port in route
   * @param {object} [request] - HTTP upgrade request (carries headers for metadata extraction)
   */
  validateAndAddInbound(ws, optionalPort, request) {
    try {
      let port;
      let req;
      if (typeof optionalPort === 'object' && optionalPort !== null) {
        // No :port in route — optionalPort is actually the request
        req = optionalPort;
        port = '16127';
      } else {
        port = optionalPort || '16127';
        req = request;
      }

      // Extract remote peer metadata from upgrade request headers
      const metadata = {};
      if (req && req.headers) {
        if (req.headers['x-flux-capabilities']) {
          metadata.remoteCapabilities = req.headers['x-flux-capabilities']
            .split(',').map((s) => s.trim()).filter(Boolean);
        }
        const clockHeader = req.headers['x-flux-clock-offset'];
        if (clockHeader !== undefined) {
          metadata.remoteClockOffsetMs = Number(clockHeader);
        }
        if (req.headers['x-flux-version']) {
          metadata.remoteVersion = req.headers['x-flux-version'];
        }
      }
      const maxPeers = 4 * config.fluxapps.minIncoming;
      const maxNumberOfConnections = this.numberOfFluxNodes / 160 < 9 * config.fluxapps.minIncoming
        ? this.numberOfFluxNodes / 160
        : 9 * config.fluxapps.minIncoming;
      const maxCon = Math.max(maxPeers, maxNumberOfConnections);
      if (this.inboundCount > maxCon) {
        setTimeout(() => {
          ws.close(CLOSE_CODES.MAX_CONNECTIONS, `Max number of incomming connections ${maxCon} reached`);
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
          ws.close(CLOSE_CODES.PRIVATE_IP, 'Peer received is using internal IP');
        }, 1000);
        log.error(`Incoming connection of peer from internal IP not allowed: ${ipv4Peer}`);
        return;
      }

      const key = `${ipv4Peer}:${port}`;
      if (this.has(key)) {
        const existing = this.get(key);
        if (existing && !existing.isAlive) {
          log.info(`Replacing stale inbound connection ${key}`);
          this.add(ws, ipv4Peer, port, { source: PEER_SOURCE.INBOUND, ...metadata });
          return;
        }
        // If the remote is reconnecting (asymmetric disconnect), verify the
        // existing connection is still alive before rejecting. Ping it and
        // wait up to 1s — if no pong, the old socket is dead, replace it.
        const isReconnect = req && req.headers && req.headers['x-flux-reconnect'];
        if (isReconnect && existing) {
          this._verifyOrReplace(existing, ws, ipv4Peer, port, metadata);
          return;
        }
        setTimeout(() => {
          ws.close(CLOSE_CODES.DUPLICATE_PEER, 'Peer already connected');
        }, 1000);
        return;
      }

      this.add(ws, ipv4Peer, port, { source: PEER_SOURCE.INBOUND, ...metadata });
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
      peerTopology: this._peerTopology.size,
    };
  }

  // --- History ---

  /**
   * Record a peer lifecycle event to the ring buffer.
   * @param {object} data Event data (event, ip, port, direction, etc.)
   * @private
   */
  _recordEvent(data) {
    this._history[this._historyIndex] = { timestamp: Date.now(), ...data };
    this._historyIndex = (this._historyIndex + 1) % HISTORY_BUFFER_SIZE;
    this._historyCount += 1;
  }

  /**
   * Get peer history events in chronological order.
   * @returns {Array<object>}
   */
  getHistory() {
    const count = Math.min(this._historyCount, HISTORY_BUFFER_SIZE);
    if (count === 0) return [];
    if (this._historyCount <= HISTORY_BUFFER_SIZE) {
      // Buffer hasn't wrapped yet
      return this._history.slice(0, count);
    }
    // Buffer has wrapped — oldest is at _historyIndex, newest is at _historyIndex - 1
    return [
      ...this._history.slice(this._historyIndex),
      ...this._history.slice(0, this._historyIndex),
    ];
  }

  // --- Binary message dispatch ---

  /**
   * Handle an incoming binary WebSocket frame.
   * @param {FluxPeerSocket} peer
   * @param {Buffer} buf
   */
  handleBinaryMessage(peer, buf) {
    if (buf.length < 1) return;
    try {
      const type = buf[0];
      switch (type) {
        case peerCodec.MSG_TYPE.HASH_PRESENT: {
          if (buf.length < 21) return;
          const { hash } = peerCodec.decodeHashPresent(buf);
          if (this.hashHandlers) this.hashHandlers.handleHashPresent(peer, hash);
          break;
        }
        case peerCodec.MSG_TYPE.HASH_REQUEST: {
          if (buf.length < 21) return;
          const { hash } = peerCodec.decodeHashRequest(buf);
          if (this.hashHandlers) this.hashHandlers.handleHashRequest(peer, hash);
          break;
        }
        case peerCodec.MSG_TYPE.NAK: {
          if (buf.length < 22) return;
          const nak = peerCodec.decodeNak(buf);
          peer.onNakReceived(nak.hash, nak.reason);
          break;
        }
        case peerCodec.MSG_TYPE.PEER_EXCHANGE: {
          if (!peer.remoteCapabilities.has('peerExchange')) return;
          if (buf.length < 5) return;
          const { outbound, inbound } = peerCodec.decodePeerExchange(buf);
          this.handlePeerExchange(peer, outbound, inbound);
          break;
        }
        case peerCodec.MSG_TYPE.PEER_UPDATE: {
          if (!peer.remoteCapabilities.has('peerExchange')) return;
          if (buf.length < 7) return;
          const { addOutbound, addInbound, rm } = peerCodec.decodePeerUpdate(buf);
          this.handlePeerUpdate(peer, addOutbound, addInbound, rm);
          break;
        }
        default:
          // Unknown type — ignore for forward compatibility
          break;
      }
    } catch (e) {
      log.error(`Binary message decode error from ${peer.key}: ${e.message}`);
    }
  }

  // --- Peer exchange ---

  /**
   * Send our full peer list to a newly connected peer.
   * @param {FluxPeerSocket} peer
   */
  sendPeerExchange(peer) {
    if (!peer.remoteCapabilities.has('peerExchange')) return;
    const outbound = [];
    const inbound = [];
    for (const p of this._peers.values()) {
      if (p.key === peer.key) continue;
      if (p.direction === DIRECTION.OUTBOUND) outbound.push(p.key);
      else inbound.push(p.key);
    }
    if (peer.remoteCapabilities.has('binaryMessages')) {
      peer.send(peerCodec.encodePeerExchange(outbound, inbound));
    } else {
      peer.send(JSON.stringify({ type: 'peerExchange', outbound, inbound }));
    }
  }

  /**
   * Schedule a debounced peerUpdate broadcast to all capable peers.
   * @private
   */
  _schedulePeerUpdate() {
    if (this._peerUpdateTimer) return;
    this._peerUpdateTimer = setTimeout(() => {
      this._peerUpdateTimer = null;
      // Net adds and removes — if a key appears in both, they cancel out
      const netAddOut = [...this._pendingAdds.outbound].filter((k) => !this._pendingRemoves.has(k));
      const netAddIn = [...this._pendingAdds.inbound].filter((k) => !this._pendingRemoves.has(k));
      const allAdds = new Set([...this._pendingAdds.outbound, ...this._pendingAdds.inbound]);
      const netRm = [...this._pendingRemoves].filter((k) => !allAdds.has(k));
      this._pendingAdds.outbound.clear();
      this._pendingAdds.inbound.clear();
      this._pendingRemoves.clear();
      if (netAddOut.length === 0 && netAddIn.length === 0 && netRm.length === 0) return;
      const binBuf = peerCodec.encodePeerUpdate(netAddOut, netAddIn, netRm);
      const jsonStr = JSON.stringify({
        type: 'peerUpdate',
        ...(netAddOut.length ? { addOutbound: netAddOut } : {}),
        ...(netAddIn.length ? { addInbound: netAddIn } : {}),
        ...(netRm.length ? { rm: netRm } : {}),
      });
      for (const peer of this._peers.values()) {
        if (!peer.remoteCapabilities.has('peerExchange')) continue;
        if (peer.remoteCapabilities.has('binaryMessages')) {
          peer.send(binBuf);
        } else {
          peer.send(jsonStr);
        }
      }
    }, PEER_UPDATE_DEBOUNCE_MS);
  }

  /**
   * Handle incoming full peer exchange from a remote peer.
   * @param {FluxPeerSocket} peer
   * @param {string[]} outbound Remote's outbound peer keys
   * @param {string[]} inbound Remote's inbound peer keys
   */
  handlePeerExchange(peer, outbound, inbound) {
    if (!Array.isArray(outbound) || !Array.isArray(inbound)) return;
    if (this._peerTopology.size >= PEER_TOPOLOGY_MAX_REPORTERS && !this._peerTopology.has(peer.key)) return;
    const outSet = new Set();
    const inSet = new Set();
    const outLimit = Math.min(outbound.length, PEER_EXCHANGE_MAX_PEERS);
    for (let i = 0; i < outLimit; i++) {
      if (typeof outbound[i] === 'string' && outbound[i].includes(':')) outSet.add(outbound[i]);
    }
    const inLimit = Math.min(inbound.length, PEER_EXCHANGE_MAX_PEERS);
    for (let i = 0; i < inLimit; i++) {
      if (typeof inbound[i] === 'string' && inbound[i].includes(':')) inSet.add(inbound[i]);
    }
    const entry = { outbound: outSet, inbound: inSet };
    this._peerTopology.set(peer.key, entry);
    this._notifyListeners({ type: 'exchange', reporter: peer.key, outbound: [...outSet], inbound: [...inSet] });
  }

  /**
   * Handle incoming incremental peer update from a remote peer.
   * @param {FluxPeerSocket} peer
   * @param {string[]} addOutbound Outbound peers added
   * @param {string[]} addInbound Inbound peers added
   * @param {string[]} rm Peers removed
   */
  handlePeerUpdate(peer, addOutbound, addInbound, rm) {
    const existing = this._peerTopology.get(peer.key);
    if (!existing) return; // ignore without prior full exchange
    const totalSize = existing.outbound.size + existing.inbound.size;
    if (Array.isArray(addOutbound)) {
      for (const p of addOutbound) {
        if (typeof p === 'string' && p.includes(':') && totalSize < PEER_EXCHANGE_MAX_PEERS * 2) {
          existing.outbound.add(p);
        }
      }
    }
    if (Array.isArray(addInbound)) {
      for (const p of addInbound) {
        if (typeof p === 'string' && p.includes(':') && totalSize < PEER_EXCHANGE_MAX_PEERS * 2) {
          existing.inbound.add(p);
        }
      }
    }
    if (Array.isArray(rm)) {
      for (const p of rm) {
        existing.outbound.delete(p);
        existing.inbound.delete(p);
      }
    }
    const allAdds = [...(addOutbound || []), ...(addInbound || [])].filter((p) => typeof p === 'string');
    if (allAdds.length) {
      this._notifyListeners({ type: 'add', reporter: peer.key, peers: allAdds });
    }
    if (rm && rm.length) {
      this._notifyListeners({ type: 'remove', reporter: peer.key, peers: rm.filter((p) => typeof p === 'string') });
    }
  }

  /**
   * Register a listener for peer topology changes.
   * @param {function} callback Called with {type, reporter, peers}
   * @returns {function} Unsubscribe function
   */
  onPeerTopologyChange(callback) {
    this._peerExchangeListeners.push(callback);
    return () => {
      const idx = this._peerExchangeListeners.indexOf(callback);
      if (idx !== -1) this._peerExchangeListeners.splice(idx, 1);
    };
  }

  /**
   * Notify topology change listeners.
   * @param {object} event
   * @private
   */
  _notifyListeners(event) {
    for (const fn of this._peerExchangeListeners) {
      try { fn(event); } catch (e) { log.error(e); }
    }
  }

  /**
   * Compute the union of all reported peer sets on demand.
   * @returns {Set<string>}
   */
  get knownPeers() {
    const union = new Set();
    for (const entry of this._peerTopology.values()) {
      for (const p of entry.outbound) union.add(p);
      for (const p of entry.inbound) union.add(p);
    }
    return union;
  }

  get peerTopologySize() {
    return this._peerTopology.size;
  }

  /**
   * Get a specific reporter's topology entry.
   * @param {string} key - reporter peer key
   * @returns {{ outbound: Set<string>, inbound: Set<string> }|undefined}
   */
  getTopologyEntry(key) {
    return this._peerTopology.get(key);
  }

  // --- Hash broadcast ---

  /**
   * Broadcast a messageHashPresent to all peers, using binary for capable peers.
   * @param {string} hexHash 40-char hex hash
   * @param {string} [excludeKey] Peer key to exclude
   */
  broadcastHash(hexHash, excludeKey) {
    const binBuf = peerCodec.encodeHashPresent(hexHash);
    const jsonStr = JSON.stringify({ messageHashPresent: hexHash });
    for (const peer of this._peers.values()) {
      if (excludeKey && peer.key === excludeKey) continue;
      if (peer.remoteCapabilities.has('binaryMessages')) {
        peer.send(binBuf);
      } else {
        peer.send(jsonStr);
      }
    }
  }

  /**
   * Send a requestMessageHash to a specific peer, using binary if capable.
   * @param {string} peerKey ip:port
   * @param {string} hexHash 40-char hex hash
   */
  sendHashRequest(peerKey, hexHash) {
    const peer = this._peers.get(peerKey);
    if (!peer) return;
    if (peer.remoteCapabilities.has('binaryMessages')) {
      peer.send(peerCodec.encodeHashRequest(hexHash));
    } else {
      peer.send(JSON.stringify({ requestMessageHash: hexHash }));
    }
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
    this._pendingConnections.clear();
    this._reconnectCounts.clear();
    this._peerTopology.clear();
    this._peerExchangeListeners.length = 0;
    this._pendingAdds.outbound.clear();
    this._pendingAdds.inbound.clear();
    this._pendingRemoves.clear();
    if (this._peerUpdateTimer) { clearTimeout(this._peerUpdateTimer); this._peerUpdateTimer = null; }
    if (this.networkHealthMonitor) this.networkHealthMonitor._clear();
    this._history = new Array(HISTORY_BUFFER_SIZE);
    this._historyIndex = 0;
    this._historyCount = 0;
  }
}

// Backoff schedule for failed connections: 2min, 5min, 10min, 15min cap
FluxPeerManager.CONNECTION_BACKOFF_MS = [2 * 60000, 5 * 60000, 10 * 60000, 15 * 60000];

// Singleton export
const peerManager = new FluxPeerManager();

module.exports = { FluxPeerManager, peerManager, CLOSE_CODES, PEER_SOURCE, DIRECTION, FLUX_VERSION };
