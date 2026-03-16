const WebSocket = require('ws');
const log = require('../../lib/log');
const { CLOSE_CODES } = require('./FluxPeerSocket');
const networkStateService = require('../networkStateService');

// --- Constants ---

const VELOCITY_BUFFER_SIZE = 32;
const VELOCITY_THRESHOLD_COUNT = 5;
const VELOCITY_WINDOW_MS = 60 * 1000;
const MIN_CONNECTION_AGE_MS = 30 * 1000;
const STEADY_STATE_DELAY_MS = 120 * 1000;
const DIAGNOSIS_PING_TIMEOUT_MS = 2000;
const PROBE_CONNECT_TIMEOUT_MS = 5000;
const DIAGNOSIS_COOLDOWN_MS = 30 * 1000;
const PROBE_PEER_COUNT = 3;
const DIAGNOSIS_HISTORY_SIZE = 50;

const HEALTH_STATUS = Object.freeze({
  HEALTHY: 'HEALTHY',
  NOT_AFFECTED: 'NOT_AFFECTED',
  NETWORK_LOSS: 'NETWORK_LOSS',
  IP_CHANGE: 'IP_CHANGE',
  DEGRADED: 'DEGRADED',
});

/**
 * Replicate the reconnect whitelist from FluxPeerManager._shouldReconnect().
 * Returns true for close codes that indicate unexpected disconnects.
 * @param {number} [closeCode]
 * @returns {boolean}
 */
function isUnexpectedDisconnect(closeCode) {
  if (!closeCode) return true;
  if (closeCode <= 1015) return true;
  if (closeCode === CLOSE_CODES.DEAD_CONNECTION) return true;
  if (closeCode === CLOSE_CODES.MAX_CONNECTIONS) return true;
  return false;
}

class NetworkHealthMonitor {
  constructor() {
    /** @type {import('./FluxPeerManager').FluxPeerManager|null} */
    this._peerManager = null;

    // Velocity ring buffer — just timestamps
    this._disconnectTimes = new Array(VELOCITY_BUFFER_SIZE);
    this._velocityIndex = 0;
    this._velocityCount = 0;

    // Steady state
    this._firstPeerConnectedAt = null;
    this._inSteadyState = false;

    // Diagnosis state
    this._diagnosing = false;
    this._lastDiagnosisAt = 0;
    this._currentStatus = HEALTH_STATUS.HEALTHY;

    // Observers
    this._listeners = [];

    // Diagnosis history ring buffer
    this._history = new Array(DIAGNOSIS_HISTORY_SIZE);
    this._historyIndex = 0;
    this._historyCount = 0;
  }

  setPeerManager(pm) {
    this._peerManager = pm;
  }

  // --- Recording ---

  /**
   * Called from peerManager.add() on every new peer connection.
   */
  recordConnect() {
    if (!this._firstPeerConnectedAt) {
      this._firstPeerConnectedAt = Date.now();
    }
    if (!this._inSteadyState
        && this._firstPeerConnectedAt
        && Date.now() - this._firstPeerConnectedAt >= STEADY_STATE_DELAY_MS) {
      this._inSteadyState = true;
      log.info('NetworkHealthMonitor: entered steady state');
    }
    // Recovery: if we were in a degraded state and peers are reconnecting, reset to healthy
    if (this._currentStatus !== HEALTH_STATUS.HEALTHY) {
      const peerCount = this._peerManager ? this._peerManager.getNumberOfPeers() : 0;
      if (peerCount >= 5) {
        log.info(`NetworkHealthMonitor: recovered — ${peerCount} peers connected, resetting to HEALTHY`);
        this._currentStatus = HEALTH_STATUS.HEALTHY;
      }
    }
  }

  /**
   * Called from peerManager.remove() on every peer disconnect.
   * Only counts established, unexpected disconnects.
   * @param {number} connectedAt - peer.connectedAt timestamp
   * @param {number} [closeCode] - WebSocket close code
   */
  recordDisconnect(connectedAt, closeCode) {
    // Filter: only count established peers with unexpected close codes
    if (Date.now() - connectedAt < MIN_CONNECTION_AGE_MS) return;
    if (!isUnexpectedDisconnect(closeCode)) return;

    const now = Date.now();
    this._disconnectTimes[this._velocityIndex] = now;
    this._velocityIndex = (this._velocityIndex + 1) % VELOCITY_BUFFER_SIZE;
    this._velocityCount += 1;

    if (!this._inSteadyState) return;
    if (this._diagnosing) return;
    if (now - this._lastDiagnosisAt < DIAGNOSIS_COOLDOWN_MS) return;

    const velocity = this._getDisconnectVelocity(now);
    if (velocity >= VELOCITY_THRESHOLD_COUNT) {
      this._triggerDiagnosis(velocity);
    }
  }

  // --- Velocity ---

  /**
   * Count disconnect timestamps within the velocity window.
   * @param {number} now
   * @returns {number}
   */
  _getDisconnectVelocity(now) {
    let count = 0;
    const limit = Math.min(this._velocityCount, VELOCITY_BUFFER_SIZE);
    for (let i = 0; i < limit; i++) {
      if (now - this._disconnectTimes[i] <= VELOCITY_WINDOW_MS) {
        count += 1;
      }
    }
    return count;
  }

  // --- Diagnosis ---

  /**
   * Run the full diagnosis pipeline.
   * @param {number} velocity - disconnect count that triggered this
   */
  async _triggerDiagnosis(velocity) {
    this._diagnosing = true;
    this._lastDiagnosisAt = Date.now();

    try {
      const totalPeers = this._peerManager ? this._peerManager.getNumberOfPeers() : 0;
      log.warn(`NetworkHealthMonitor: velocity ${velocity} in ${VELOCITY_WINDOW_MS}ms, diagnosing (${totalPeers} peers remaining)`);

      // Stage 2a: Ping all remaining peers
      const pingResults = await this._pingAllPeers();

      let status;
      let topologyCorrelation = null;
      let probeResults = null;

      if (pingResults.responded === pingResults.sent && pingResults.sent > 0) {
        // ALL responded
        topologyCorrelation = this._correlateTopology(pingResults.respondedKeys);
        status = HEALTH_STATUS.NOT_AFFECTED;
      } else if (pingResults.responded === 0) {
        // NONE responded
        probeResults = await this._probeKnownGoodPeers();
        status = probeResults.succeeded > 0 ? HEALTH_STATUS.IP_CHANGE : HEALTH_STATUS.NETWORK_LOSS;
      } else {
        // SOME responded
        topologyCorrelation = this._correlateTopology(pingResults.respondedKeys);
        status = HEALTH_STATUS.DEGRADED;
      }

      const event = {
        status,
        timestamp: Date.now(),
        triggerReason: { disconnectsInWindow: velocity, windowMs: VELOCITY_WINDOW_MS },
        evidence: {
          totalPeersAtTrigger: totalPeers,
          pingResults: {
            sent: pingResults.sent,
            responded: pingResults.responded,
            failed: pingResults.sent - pingResults.responded,
          },
          topologyCorrelation,
          probeResults,
        },
      };

      this._currentStatus = status;
      this._recordDiagnosis(event);
      this._notifyListeners(event);

      log.warn(`NetworkHealthMonitor: diagnosis complete — ${status}`);
    } catch (e) {
      log.error(`NetworkHealthMonitor diagnosis error: ${e.message}`);
    } finally {
      this._diagnosing = false;
    }
  }

  /**
   * Ping all remaining peers and collect responses within timeout.
   * @returns {Promise<{sent: number, responded: number, respondedKeys: string[]}>}
   */
  async _pingAllPeers() {
    if (!this._peerManager) return { sent: 0, responded: 0, respondedKeys: [] };
    const peers = [...this._peerManager.allValues()];
    if (peers.length === 0) return { sent: 0, responded: 0, respondedKeys: [] };

    const results = await Promise.allSettled(peers.map((peer) => new Promise((resolve, reject) => {
      let settled = false;
      const onPong = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.ws.removeListener('pong', onPong);
        resolve(peer.key);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.ws.removeListener('pong', onPong);
        reject(new Error('timeout'));
      }, DIAGNOSIS_PING_TIMEOUT_MS);
      peer.ws.on('pong', onPong);
      try {
        peer.ws.ping();
      } catch (_e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          peer.ws.removeListener('pong', onPong);
          reject(_e);
        }
      }
    })));

    const respondedKeys = [];
    for (const r of results) {
      if (r.status === 'fulfilled') respondedKeys.push(r.value);
    }
    return { sent: peers.length, responded: respondedKeys.length, respondedKeys };
  }

  /**
   * Check if recently lost peers are still visible in responding peers' topology.
   * @param {string[]} respondedKeys - peers that responded to our ping
   * @returns {{ recentlyLost: number, peersStillSeen: number, peersGone: number }}
   */
  _correlateTopology(respondedKeys) {
    if (!this._peerManager) return { recentlyLost: 0, peersStillSeen: 0, peersGone: 0 };

    // Find recently disconnected peers from history
    const history = this._peerManager.getHistory();
    const cutoff = Date.now() - VELOCITY_WINDOW_MS;
    const recentlyLost = new Set();
    for (let i = history.length - 1; i >= 0; i--) {
      const evt = history[i];
      if (!evt || evt.timestamp < cutoff) break;
      if (evt.event === 'disconnected') {
        recentlyLost.add(`${evt.ip}:${evt.port}`);
      }
    }

    let peersStillSeen = 0;
    let peersGone = 0;
    for (const lostKey of recentlyLost) {
      let seenByAny = false;
      for (const responderKey of respondedKeys) {
        const topo = this._peerManager.getTopologyEntry(responderKey);
        if (topo && (topo.outbound.has(lostKey) || topo.inbound.has(lostKey))) {
          seenByAny = true;
          break;
        }
      }
      if (seenByAny) peersStillSeen += 1;
      else peersGone += 1;
    }

    return { recentlyLost: recentlyLost.size, peersStillSeen, peersGone };
  }

  /**
   * Try fresh outbound connections to known-good peers we're not currently connected to.
   * Lightweight probes — connect, wait for open, close immediately.
   * @returns {Promise<{attempted: number, succeeded: number, targets: string[]}>}
   */
  async _probeKnownGoodPeers() {
    const targets = await this._getProbeTargets();
    const attempted = targets.length;
    if (attempted === 0) return { attempted: 0, succeeded: 0, targets: [] };

    const results = await Promise.allSettled(targets.map((target) => new Promise((resolve) => {
      try {
        const ws = new WebSocket(`ws://${target}/ws/flux`, {
          handshakeTimeout: PROBE_CONNECT_TIMEOUT_MS,
        });
        const timer = setTimeout(() => {
          try { ws.close(); } catch (_) { /* noop */ }
          resolve(false);
        }, PROBE_CONNECT_TIMEOUT_MS);
        ws.onopen = () => {
          clearTimeout(timer);
          try { ws.close(); } catch (_) { /* noop */ }
          resolve(true);
        };
        ws.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
      } catch (_e) {
        resolve(false);
      }
    })));

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
    return { attempted, succeeded, targets };
  }

  /**
   * Select probe targets from the deterministic node list, filtering out
   * our own peers (we've already tried them via ping).
   * @returns {Promise<string[]>}
   */
  async _getProbeTargets() {
    const connected = new Set();
    if (this._peerManager) {
      for (const peer of this._peerManager.allValues()) {
        connected.add(peer.key);
      }
    }
    const candidates = [];
    for (let i = 0; i < PROBE_PEER_COUNT * 3 && candidates.length < PROBE_PEER_COUNT; i++) {
      // eslint-disable-next-line no-await-in-loop
      const addr = await networkStateService.getRandomSocketAddress();
      if (addr && !connected.has(addr)) {
        candidates.push(addr);
      }
    }
    return candidates;
  }

  // --- Observer ---

  onHealthEvent(callback) {
    this._listeners.push(callback);
    return () => {
      const idx = this._listeners.indexOf(callback);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  _notifyListeners(event) {
    for (const fn of this._listeners) {
      try { fn(event); } catch (e) { log.error(e); }
    }
  }

  // --- History ---

  _recordDiagnosis(event) {
    this._history[this._historyIndex] = event;
    this._historyIndex = (this._historyIndex + 1) % DIAGNOSIS_HISTORY_SIZE;
    this._historyCount += 1;
  }

  getDiagnosisHistory() {
    const count = Math.min(this._historyCount, DIAGNOSIS_HISTORY_SIZE);
    if (count === 0) return [];
    if (this._historyCount <= DIAGNOSIS_HISTORY_SIZE) {
      return this._history.slice(0, count);
    }
    return [
      ...this._history.slice(this._historyIndex),
      ...this._history.slice(0, this._historyIndex),
    ];
  }

  // --- Getters ---

  getStatus() { return this._currentStatus; }

  isInSteadyState() { return this._inSteadyState; }

  // --- Reset (testing) ---

  _clear() {
    this._disconnectTimes = new Array(VELOCITY_BUFFER_SIZE);
    this._velocityIndex = 0;
    this._velocityCount = 0;
    this._firstPeerConnectedAt = null;
    this._inSteadyState = false;
    this._diagnosing = false;
    this._lastDiagnosisAt = 0;
    this._currentStatus = HEALTH_STATUS.HEALTHY;
    this._listeners.length = 0;
    this._history = new Array(DIAGNOSIS_HISTORY_SIZE);
    this._historyIndex = 0;
    this._historyCount = 0;
  }
}

const networkHealthMonitor = new NetworkHealthMonitor();

module.exports = {
  NetworkHealthMonitor,
  networkHealthMonitor,
  HEALTH_STATUS,
  isUnexpectedDisconnect,
  // Exported for testing
  VELOCITY_THRESHOLD_COUNT,
  VELOCITY_WINDOW_MS,
  MIN_CONNECTION_AGE_MS,
  STEADY_STATE_DELAY_MS,
  DIAGNOSIS_COOLDOWN_MS,
};
