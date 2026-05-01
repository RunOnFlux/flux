const { EventEmitter } = require('events');
const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const { FluxPeerSocket, CLOSE_CODES, PEER_SOURCE, DIRECTION, FLUX_VERSION, FLUX_CAPABILITIES } = require('./FluxPeerSocket');
const peerCodec = require('./peerCodec');

const UNSTABLE_DISCONNECT_THRESHOLD = 5;
const UNSTABLE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const HISTORY_BUFFER_SIZE = 1000;
const PEER_EXCHANGE_MAX_PEERS = 60;
const PEER_TOPOLOGY_MAX_REPORTERS = 100;
const PEER_UPDATE_DEBOUNCE_MS = 2000;
const allowedPortsSet = new Set(config.server.allowedPorts);

function isValidPeerKey(key) {
  if (typeof key !== 'string') return false;
  const colon = key.lastIndexOf(':');
  if (colon === -1) return false;
  if (!allowedPortsSet.has(+key.substring(colon + 1))) return false;
  return !serviceHelper.isNonRoutableAddress(key.substring(0, colon));
}

// Reverse lookup: code number → enum name
const CLOSE_CODE_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(CLOSE_CODES).map(([name, code]) => [code, name])),
);

class FluxPeerManager extends EventEmitter {
  static CONNECTION_BACKOFF_MS = [2 * 60000, 5 * 60000, 10 * 60000, 15 * 60000];

  /** @type {Map<string, FluxPeerSocket>} */
  #peers = new Map();
  /** @type {Set<string>} */
  #inboundKeys = new Set();
  /** @type {Set<string>} */
  #outboundKeys = new Set();
  /** @type {Map<string, {ip: string, port: string, attempts: number, lastAttempt: number}>} */
  #reconnectQueue = new Map();
  /** @type {Map<string, {disconnects: number, firstDisconnect: number}>} */
  #unstableNodes = new Map();
  /** @type {Map<string, number>} "outbound:192.168" → count */
  #ipGroupCounts = new Map();
  /** @type {Map<string, number>} "outbound:10.0.0.1" → count */
  #uniqueIps = new Map();
  /** @type {Map<string, {attempts: number, lastAttempt: number}>} */
  #failedConnections = new Map();
  /** @type {Set<string>} keys of outbound connections currently being established */
  #pendingConnections = new Set();
  /** @type {Map<string, number>} reconnect count per peer key, persists across connection cycles */
  #reconnectCounts = new Map();
  /** @type {number} peer count threshold for app sync readiness */
  #syncPeerThreshold;
  /** @type {number} peer count threshold for degraded state */
  #syncDegradedThreshold;
  /** @type {boolean} true when peer count is above syncPeerThreshold */
  #aboveThreshold;
  /** @type {Map<string, Set<string>>} reporter key → their peer keys */
  #peerTopology = new Map();
  /** @type {Array<function>} topology change listeners */
  #peerExchangeListeners = [];
  /** @type {{ outbound: Set<string>, inbound: Set<string> }} peers added since last update */
  #pendingAdds = { outbound: new Set(), inbound: new Set() };
  /** @type {Set<string>} peers removed since last peerUpdate broadcast */
  #pendingRemoves = new Set();
  /** @type {ReturnType<typeof setTimeout>|null} debounce timer */
  #peerUpdateTimer = null;
  /** @type {Array<object>} Circular buffer of peer lifecycle events */
  #history = new Array(HISTORY_BUFFER_SIZE); // HISTORY_BUFFER_SIZE
  /** @type {number} Next write position in the ring buffer */
  #historyIndex = 0;
  /** @type {number} Total events recorded (used to know if buffer has wrapped) */
  #historyCount = 0;

  constructor() {
    super();

    this.#syncPeerThreshold = config.fluxapps.appSyncPeerThreshold;
    this.#syncDegradedThreshold = config.fluxapps.appSyncDegradedThreshold;
    this.#aboveThreshold = false;

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
    const existing = this.#peers.get(key);
    if (existing) {
      log.warn(`Replacing existing ${existing.direction} peer ${key}`);
      // Detach old handlers so its onclose doesn't remove the new peer
      existing.ws.onclose = null;
      existing.ws.onerror = null;
      existing.ws.onmessage = null;
      try { existing.ws.close(CLOSE_CODES.DUPLICATE_PEER, 'replaced'); } catch (_e) { /* noop */ }
      this.#removeTracking(existing);
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
    if (typeof options.remoteFluxUptime === 'number' && !Number.isNaN(options.remoteFluxUptime)) {
      peer.remoteFluxUptime = options.remoteFluxUptime;
    }
    if (existing || options.source === PEER_SOURCE.RECONNECT) {
      this.#reconnectCounts.set(key, (this.#reconnectCounts.get(key) || 0) + 1);
    }
    const { direction } = peer;
    this.#peers.set(peer.key, peer);
    if (direction === DIRECTION.INBOUND) {
      this.#inboundKeys.add(peer.key);
    } else {
      this.#outboundKeys.add(peer.key);
      // Successful outbound connection — clear from reconnect queue
      this.#reconnectQueue.delete(peer.key);
    }
    // Track IP group and unique IP for diversity checks
    const groupKey = `${direction}:${FluxPeerManager.getIpGroup(ip)}`;
    this.#ipGroupCounts.set(groupKey, (this.#ipGroupCounts.get(groupKey) || 0) + 1);
    const ipKey = `${direction}:${ip}`;
    this.#uniqueIps.set(ipKey, (this.#uniqueIps.get(ipKey) || 0) + 1);
    // Successful connection — clear from failed connections and pending
    this.#failedConnections.delete(peer.key);
    this.#pendingConnections.delete(peer.key);
    this.#recordEvent({
      event: 'connected',
      ip,
      port: String(port),
      direction,
      source: peer.source,
    });
    // Peer exchange: send our full list to new peer, notify others about the addition
    this.sendPeerExchange(peer);
    const dirSet = peer.direction === DIRECTION.OUTBOUND ? this.#pendingAdds.outbound : this.#pendingAdds.inbound;
    dirSet.add(peer.key);
    this.#pendingRemoves.delete(peer.key);
    this.#schedulePeerUpdate();
    if (this.networkHealthMonitor) this.networkHealthMonitor.recordConnect();
    if (!this.#aboveThreshold && this.#peers.size >= this.#syncPeerThreshold) {
      this.#aboveThreshold = true;
      this.emit('peerThresholdReached', this.#peers.size);
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
    const peer = this.#peers.get(key);
    if (!peer) return null;

    this.#removeTracking(peer);

    // Clean up peer exchange topology and notify others
    this.#peerTopology.delete(key);
    this.#pendingRemoves.add(key);
    this.#pendingAdds.outbound.delete(key);
    this.#pendingAdds.inbound.delete(key);
    this.#schedulePeerUpdate();

    // Track disconnect for unstable node detection and network health
    this.trackDisconnect(peer.ip, peer.port);
    if (this.networkHealthMonitor) this.networkHealthMonitor.recordDisconnect(peer.connectedAt, closeCode);

    // Queue outbound peers for reconnection only on unexpected disconnections.
    // Whitelist: only reconnect for dead connections, capacity rejections,
    // and standard WebSocket closes (network failures, crashes).
    if (peer.direction === DIRECTION.OUTBOUND && FluxPeerManager.shouldReconnect(closeCode)) {
      this.queueReconnect(peer.ip, peer.port);
    }

    const now = Date.now();
    this.#recordEvent({
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
    if (this.#aboveThreshold && this.#peers.size < this.#syncDegradedThreshold) {
      this.#aboveThreshold = false;
      this.emit('peersBelowThreshold', this.#peers.size);
    }
    return peer;
  }

  /**
   * Remove tracking data for a peer without triggering reconnect logic.
   * Used by both remove() and add() (when replacing an existing peer).
   * @param {FluxPeerSocket} peer
   * @private
   */
  #removeTracking(peer) {
    this.#peers.delete(peer.key);
    this.#inboundKeys.delete(peer.key);
    this.#outboundKeys.delete(peer.key);

    // Decrement IP group and unique IP tracking
    const groupKey = `${peer.direction}:${FluxPeerManager.getIpGroup(peer.ip)}`;
    const groupCount = (this.#ipGroupCounts.get(groupKey) || 1) - 1;
    if (groupCount <= 0) this.#ipGroupCounts.delete(groupKey);
    else this.#ipGroupCounts.set(groupKey, groupCount);
    const ipKey = `${peer.direction}:${peer.ip}`;
    const ipCount = (this.#uniqueIps.get(ipKey) || 1) - 1;
    if (ipCount <= 0) this.#uniqueIps.delete(ipKey);
    else this.#uniqueIps.set(ipKey, ipCount);
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
  #verifyOrReplace(existing, ws, ip, port, metadata) {
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
    return this.#peers.has(key);
  }

  /**
   * @param {string} key
   * @returns {FluxPeerSocket|undefined}
   */
  get(key) {
    return this.#peers.get(key);
  }

  // --- Iteration ---

  * outboundValues() {
    for (const key of this.#outboundKeys) {
      const peer = this.#peers.get(key);
      if (peer) yield peer;
    }
  }

  * inboundValues() {
    for (const key of this.#inboundKeys) {
      const peer = this.#peers.get(key);
      if (peer) yield peer;
    }
  }

  * allValues() {
    yield* this.#peers.values();
  }

  // --- Counts ---

  get outboundCount() {
    return this.#outboundKeys.size;
  }

  get inboundCount() {
    return this.#inboundKeys.size;
  }

  getNumberOfPeers() {
    return this.#peers.size;
  }

  getPeerFluxUptime(key) {
    const peer = this.#peers.get(key);
    if (!peer || peer.remoteFluxUptime === null) return null;
    return peer.remoteFluxUptime + (Date.now() - peer.connectedAt) / 1000;
  }

  getEligibleTempSyncPeers(minUptimeSeconds) {
    const eligible = [];
    for (const peer of this.#peers.values()) {
      if (!peer.remoteCapabilities.has('tempMessageSync')) continue;
      const uptime = this.getPeerFluxUptime(peer.key);
      if (uptime === null || uptime < minUptimeSeconds) continue;
      eligible.push(peer);
    }
    return eligible;
  }

  getEligibleAppRunningSyncPeers(minUptimeSeconds) {
    const eligible = [];
    for (const peer of this.#peers.values()) {
      if (!peer.remoteCapabilities.has('appRunningSync')) continue;
      const uptime = this.getPeerFluxUptime(peer.key);
      if (uptime === null || uptime < minUptimeSeconds) continue;
      eligible.push(peer);
    }
    return eligible;
  }

  // --- Liveness ---

  /**
   * Ping all connected peers.
   */
  pingAll() {
    for (const peer of this.#peers.values()) {
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
    const existing = this.#reconnectQueue.get(key);
    if (existing) {
      existing.attempts += 1;
      existing.lastAttempt = Date.now();
    } else {
      this.#reconnectQueue.set(key, {
        ip, port, attempts: 1, lastAttempt: Date.now(),
      });
    }
  }

  getReconnectQueue() {
    return this.#reconnectQueue;
  }

  clearReconnectEntry(key) {
    this.#reconnectQueue.delete(key);
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
    const entry = this.#unstableNodes.get(key);
    if (entry) {
      if (now - entry.firstDisconnect > UNSTABLE_WINDOW_MS) {
        // Window expired, reset
        this.#unstableNodes.set(key, { disconnects: 1, firstDisconnect: now });
      } else {
        entry.disconnects += 1;
      }
    } else {
      this.#unstableNodes.set(key, { disconnects: 1, firstDisconnect: now });
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
    const entry = this.#unstableNodes.get(key);
    if (!entry) return false;
    if (Date.now() - entry.firstDisconnect > UNSTABLE_WINDOW_MS) {
      this.#unstableNodes.delete(key);
      return false;
    }
    return entry.disconnects >= UNSTABLE_DISCONNECT_THRESHOLD;
  }

  /**
   * Remove expired entries from the unstable nodes map.
   */
  pruneUnstableList() {
    const now = Date.now();
    for (const [key, entry] of this.#unstableNodes) {
      if (now - entry.firstDisconnect > UNSTABLE_WINDOW_MS) {
        this.#unstableNodes.delete(key);
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
  static shouldReconnect(closeCode) {
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
    return this.#peers.size === 0;
  }

  // --- Utility ---

  /**
   * Get a random peer from a given direction.
   * @param {'inbound'|'outbound'} direction
   * @returns {FluxPeerSocket|null}
   */
  getRandomPeer(direction) {
    const keys = direction === DIRECTION.INBOUND ? this.#inboundKeys : this.#outboundKeys;
    if (keys.size === 0) return null;
    const arr = [...keys];
    const randomKey = arr[Math.floor(Math.random() * arr.length)];
    return this.#peers.get(randomKey) || null;
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
  markPending(key) { this.#pendingConnections.add(key); }

  /**
   * Clear a pending connection marker.
   * @param {string} key - ip:port
   */
  clearPending(key) { this.#pendingConnections.delete(key); }

  /**
   * Check if an outbound connection is currently being established.
   * @param {string} key - ip:port
   * @returns {boolean}
   */
  isPending(key) { return this.#pendingConnections.has(key); }

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
      await this.#broadcastToGroup(data, direction, exclude, delayMs);
    } else {
      await this.#broadcastToGroup(data, DIRECTION.OUTBOUND, exclude, delayMs);
      await serviceHelper.delay(500);
      await this.#broadcastToGroup(data, DIRECTION.INBOUND, exclude, delayMs);
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
  async #broadcastToGroup(data, direction, exclude, delayMs) {
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
    return (this.#ipGroupCounts.get(`${direction}:${ipGroup}`) || 0) > 0;
  }

  /**
   * Get the number of unique IPs connected in a direction.
   * @param {'inbound'|'outbound'} direction
   * @returns {number}
   */
  getUniqueIpCount(direction) {
    let count = 0;
    for (const [key] of this.#uniqueIps) {
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
    for (const [key] of this.#ipGroupCounts) {
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
        if (req.headers['x-flux-uptime']) {
          metadata.remoteFluxUptime = Number(req.headers['x-flux-uptime']);
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
        ipv4Peer = (req.socket.remoteAddress || '').replace('::ffff:', '');
      } catch (error) {
        log.error(error);
        return;
      }
      if (!ipv4Peer) {
        log.error('validateAndAddInbound: could not determine remote IP');
        return;
      }

      if (serviceHelper.isNonRoutableAddress(ipv4Peer)) {
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
          this.#verifyOrReplace(existing, ws, ipv4Peer, port, metadata);
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
    for (const [key, entry] of this.#reconnectQueue) {
      if (this.has(key)) {
        this.#reconnectQueue.delete(key);
        continue;
      }
      if (this.isUnstable(entry.ip, entry.port)) {
        this.#reconnectQueue.delete(key);
        continue;
      }
      if (entry.attempts > 3) {
        this.#reconnectQueue.delete(key);
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
    const entry = this.#failedConnections.get(key);
    if (entry) {
      entry.attempts += 1;
      entry.lastAttempt = Date.now();
    } else {
      this.#failedConnections.set(key, { attempts: 1, lastAttempt: Date.now() });
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
    const entry = this.#failedConnections.get(key);
    if (!entry) return true;
    const backoffIdx = Math.min(entry.attempts - 1, FluxPeerManager.CONNECTION_BACKOFF_MS.length - 1);
    const backoffMs = FluxPeerManager.CONNECTION_BACKOFF_MS[backoffIdx];
    return (Date.now() - entry.lastAttempt) >= backoffMs;
  }

  // --- Diagnostics ---

  getStats() {
    let dead = 0;
    for (const peer of this.#peers.values()) {
      if (!peer.isAlive) dead += 1;
    }
    return {
      inbound: this.#inboundKeys.size,
      outbound: this.#outboundKeys.size,
      total: this.#peers.size,
      dead,
      reconnectQueue: this.#reconnectQueue.size,
      unstable: this.#unstableNodes.size,
      peerTopology: this.#peerTopology.size,
    };
  }

  // --- History ---

  /**
   * Record a peer lifecycle event to the ring buffer.
   * @param {object} data Event data (event, ip, port, direction, etc.)
   * @private
   */
  #recordEvent(data) {
    this.#history[this.#historyIndex] = { timestamp: Date.now(), ...data };
    this.#historyIndex = (this.#historyIndex + 1) % HISTORY_BUFFER_SIZE;
    this.#historyCount += 1;
  }

  /**
   * Get peer history events in chronological order.
   * @returns {Array<object>}
   */
  getHistory() {
    const count = Math.min(this.#historyCount, HISTORY_BUFFER_SIZE);
    if (count === 0) return [];
    if (this.#historyCount <= HISTORY_BUFFER_SIZE) {
      // Buffer hasn't wrapped yet
      return this.#history.slice(0, count);
    }
    // Buffer has wrapped — oldest is at #historyIndex, newest is at #historyIndex - 1
    return [
      ...this.#history.slice(this.#historyIndex),
      ...this.#history.slice(0, this.#historyIndex),
    ];
  }

  /**
   * Get filtered peer history events.
   * @param {object} [filters]
   * @param {string} [filters.ip] IP prefix to match
   * @param {number} [filters.code] Close code to match
   * @param {string} [filters.event] Event type to match
   * @param {number} [filters.since] Only events after this timestamp
   * @param {number} [filters.limit] Max number of most recent events
   * @returns {Array<object>}
   */
  getFilteredHistory(filters = {}) {
    let events = this.getHistory();
    const { ip, code, event, since, limit } = filters;
    if (since) events = events.filter((e) => e.timestamp >= since);
    if (ip) events = events.filter((e) => e.ip.startsWith(ip));
    if (code) events = events.filter((e) => e.closeCode === code);
    if (event) events = events.filter((e) => e.event === event);
    if (limit && limit > 0) events = events.slice(-limit);
    return events;
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
        case peerCodec.MSG_TYPE.REQUEST_TEMP_MESSAGES: {
          if (this.hashHandlers && this.hashHandlers.handleTempMessagesRequest) {
            const sinceTimestamp = buf.length >= 9 ? peerCodec.decodeSyncTimestamp(buf) : 0;
            this.hashHandlers.handleTempMessagesRequest(peer, sinceTimestamp);
          }
          break;
        }
        case peerCodec.MSG_TYPE.REQUEST_APP_RUNNING: {
          if (buf.length < 9) break;
          const sinceTimestamp = peerCodec.decodeSyncTimestamp(buf);
          if (this.hashHandlers && this.hashHandlers.handleAppRunningRequest) {
            this.hashHandlers.handleAppRunningRequest(peer, sinceTimestamp);
          }
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
    for (const p of this.#peers.values()) {
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
  #schedulePeerUpdate() {
    if (this.#peerUpdateTimer) return;
    this.#peerUpdateTimer = setTimeout(() => {
      this.#peerUpdateTimer = null;
      // Net adds and removes — if a key appears in both, they cancel out
      const netAddOut = [...this.#pendingAdds.outbound].filter((k) => !this.#pendingRemoves.has(k));
      const netAddIn = [...this.#pendingAdds.inbound].filter((k) => !this.#pendingRemoves.has(k));
      const allAdds = new Set([...this.#pendingAdds.outbound, ...this.#pendingAdds.inbound]);
      const netRm = [...this.#pendingRemoves].filter((k) => !allAdds.has(k));
      this.#pendingAdds.outbound.clear();
      this.#pendingAdds.inbound.clear();
      this.#pendingRemoves.clear();
      if (netAddOut.length === 0 && netAddIn.length === 0 && netRm.length === 0) return;
      const binBuf = peerCodec.encodePeerUpdate(netAddOut, netAddIn, netRm);
      const jsonStr = JSON.stringify({
        type: 'peerUpdate',
        ...(netAddOut.length ? { addOutbound: netAddOut } : {}),
        ...(netAddIn.length ? { addInbound: netAddIn } : {}),
        ...(netRm.length ? { rm: netRm } : {}),
      });
      for (const peer of this.#peers.values()) {
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
    if (this.#peerTopology.size >= PEER_TOPOLOGY_MAX_REPORTERS && !this.#peerTopology.has(peer.key)) return;
    const outSet = new Set();
    const inSet = new Set();
    const outLimit = Math.min(outbound.length, PEER_EXCHANGE_MAX_PEERS);
    for (let i = 0; i < outLimit; i++) {
      if (isValidPeerKey(outbound[i])) outSet.add(outbound[i]);
    }
    const inLimit = Math.min(inbound.length, PEER_EXCHANGE_MAX_PEERS);
    for (let i = 0; i < inLimit; i++) {
      if (isValidPeerKey(inbound[i])) inSet.add(inbound[i]);
    }
    const entry = { outbound: outSet, inbound: inSet };
    this.#peerTopology.set(peer.key, entry);
    this.#notifyListeners({ type: 'exchange', reporter: peer.key, outbound: [...outSet], inbound: [...inSet] });
  }

  /**
   * Handle incoming incremental peer update from a remote peer.
   * @param {FluxPeerSocket} peer
   * @param {string[]} addOutbound Outbound peers added
   * @param {string[]} addInbound Inbound peers added
   * @param {string[]} rm Peers removed
   */
  handlePeerUpdate(peer, addOutbound, addInbound, rm) {
    const existing = this.#peerTopology.get(peer.key);
    if (!existing) return; // ignore without prior full exchange
    const maxPeers = PEER_EXCHANGE_MAX_PEERS * 2;
    if (Array.isArray(addOutbound)) {
      for (const p of addOutbound) {
        if (existing.outbound.size + existing.inbound.size >= maxPeers) break;
        if (isValidPeerKey(p)) existing.outbound.add(p);
      }
    }
    if (Array.isArray(addInbound)) {
      for (const p of addInbound) {
        if (existing.outbound.size + existing.inbound.size >= maxPeers) break;
        if (isValidPeerKey(p)) existing.inbound.add(p);
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
      this.#notifyListeners({ type: 'add', reporter: peer.key, peers: allAdds });
    }
    if (rm && rm.length) {
      this.#notifyListeners({ type: 'remove', reporter: peer.key, peers: rm.filter((p) => typeof p === 'string') });
    }
  }

  /**
   * Register a listener for peer topology changes.
   * @param {function} callback Called with {type, reporter, peers}
   * @returns {function} Unsubscribe function
   */
  onPeerTopologyChange(callback) {
    this.#peerExchangeListeners.push(callback);
    return () => {
      const idx = this.#peerExchangeListeners.indexOf(callback);
      if (idx !== -1) this.#peerExchangeListeners.splice(idx, 1);
    };
  }

  /**
   * Notify topology change listeners.
   * @param {object} event
   * @private
   */
  #notifyListeners(event) {
    for (const fn of this.#peerExchangeListeners) {
      try { fn(event); } catch (e) { log.error(e); }
    }
  }

  /**
   * Compute the union of all reported peer sets on demand.
   * @returns {Set<string>}
   */
  get knownPeers() {
    const union = new Set();
    for (const entry of this.#peerTopology.values()) {
      for (const p of entry.outbound) union.add(p);
      for (const p of entry.inbound) union.add(p);
    }
    return union;
  }

  get peerTopologySize() {
    return this.#peerTopology.size;
  }

  /**
   * Get a specific reporter's topology entry.
   * @param {string} key - reporter peer key
   * @returns {{ outbound: Set<string>, inbound: Set<string> }|undefined}
   */
  getTopologyEntry(key) {
    return this.#peerTopology.get(key);
  }

  /**
   * Iterate over all unstable node entries.
   * @returns {IterableIterator<[string, {disconnects: number, firstDisconnect: number}]>}
   */
  unstableEntries() {
    return this.#unstableNodes.entries();
  }

  /**
   * Iterate over all peer topology entries.
   * @returns {IterableIterator<[string, {outbound: Set<string>, inbound: Set<string>}]>}
   */
  topologyEntries() {
    return this.#peerTopology.entries();
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
    for (const peer of this.#peers.values()) {
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
    const peer = this.#peers.get(peerKey);
    if (!peer) return;
    if (peer.remoteCapabilities.has('binaryMessages')) {
      peer.send(peerCodec.encodeHashRequest(hexHash));
    } else {
      peer.send(JSON.stringify({ requestMessageHash: hexHash }));
    }
  }

  /**
   * Get the reconnect count for a peer key.
   * @param {string} key - ip:port
   * @returns {number}
   */
  getReconnectCount(key) {
    return this.#reconnectCounts.get(key) || 0;
  }

  /**
   * Get the number of unstable node entries.
   * @returns {number}
   */
  get unstableCount() {
    return this.#unstableNodes.size;
  }

  /**
   * Get an unstable node entry by key.
   * @param {string} key - ip:port
   * @returns {{disconnects: number, firstDisconnect: number}|undefined}
   */
  getUnstableEntry(key) {
    return this.#unstableNodes.get(key);
  }

  /**
   * Set an unstable node entry directly (for testing).
   * @param {string} key - ip:port
   * @param {{disconnects: number, firstDisconnect: number}} entry
   */
  setUnstableEntry(key, entry) {
    this.#unstableNodes.set(key, entry);
  }

  /**
   * Check if an unstable node entry exists.
   * @param {string} key - ip:port
   * @returns {boolean}
   */
  hasUnstableEntry(key) {
    return this.#unstableNodes.has(key);
  }

  /**
   * Get a failed connection entry by key.
   * @param {string} key - ip:port
   * @returns {{attempts: number, lastAttempt: number}|undefined}
   */
  getFailedConnection(key) {
    return this.#failedConnections.get(key);
  }

  /**
   * Check if a failed connection entry exists.
   * @param {string} key - ip:port
   * @returns {boolean}
   */
  hasFailedConnection(key) {
    return this.#failedConnections.has(key);
  }

  /**
   * Check if a topology entry exists for a reporter.
   * @param {string} key - reporter peer key
   * @returns {boolean}
   */
  hasTopologyEntry(key) {
    return this.#peerTopology.has(key);
  }

  /**
   * Get the number of reconnect count entries.
   * @returns {number}
   */
  get reconnectCountsSize() {
    return this.#reconnectCounts.size;
  }

  /**
   * Get the number of registered peer exchange listeners.
   * @returns {number}
   */
  get peerExchangeListenerCount() {
    return this.#peerExchangeListeners.length;
  }

  /**
   * Get the pending adds/removes state — for testing debounce logic.
   * @returns {{ pendingAddsOutboundSize: number, pendingAddsInboundSize: number, pendingRemovesSize: number, hasPeerUpdateTimer: boolean }}
   */
  getPendingUpdateState() {
    return {
      pendingAddsOutboundSize: this.#pendingAdds.outbound.size,
      pendingAddsInboundSize: this.#pendingAdds.inbound.size,
      pendingRemovesSize: this.#pendingRemoves.size,
      hasPeerUpdateTimer: this.#peerUpdateTimer !== null,
    };
  }

  /**
   * Cancel the pending peer update timer and clear pending state — for testing.
   */
  cancelPendingUpdate() {
    if (this.#peerUpdateTimer) { clearTimeout(this.#peerUpdateTimer); this.#peerUpdateTimer = null; }
    this.#pendingAdds.outbound.clear();
    this.#pendingAdds.inbound.clear();
    this.#pendingRemoves.clear();
  }

  /**
   * Inject pending adds/removes and trigger the debounce timer — for testing.
   * @param {string[]} addOutbound
   * @param {string[]} addInbound
   * @param {string[]} removes
   */
  injectPendingUpdate(addOutbound, addInbound, removes) {
    for (const k of addOutbound) this.#pendingAdds.outbound.add(k);
    for (const k of addInbound) this.#pendingAdds.inbound.add(k);
    for (const k of removes) this.#pendingRemoves.add(k);
    this.#schedulePeerUpdate();
  }

  /**
   * Clear all peers — for testing only.
   */
  reset() {
    this.#peers.clear();
    this.#inboundKeys.clear();
    this.#outboundKeys.clear();
    this.#reconnectQueue.clear();
    this.#unstableNodes.clear();
    this.#ipGroupCounts.clear();
    this.#uniqueIps.clear();
    this.#failedConnections.clear();
    this.#pendingConnections.clear();
    this.#reconnectCounts.clear();
    this.#peerTopology.clear();
    this.#peerExchangeListeners.length = 0;
    this.#pendingAdds.outbound.clear();
    this.#pendingAdds.inbound.clear();
    this.#pendingRemoves.clear();
    if (this.#peerUpdateTimer) { clearTimeout(this.#peerUpdateTimer); this.#peerUpdateTimer = null; }
    if (this.networkHealthMonitor) this.networkHealthMonitor.reset();
    this.#history = new Array(HISTORY_BUFFER_SIZE);
    this.#historyIndex = 0;
    this.#historyCount = 0;
  }
}

// Singleton export
const peerManager = new FluxPeerManager();

module.exports = { FluxPeerManager, peerManager, CLOSE_CODES, PEER_SOURCE, DIRECTION, FLUX_VERSION, FLUX_CAPABILITIES };
