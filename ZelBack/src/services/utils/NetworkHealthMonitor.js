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
 * Replicate the reconnect whitelist from FluxPeerManager.shouldReconnect().
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
  /** @type {import('./FluxPeerManager').FluxPeerManager|null} */
  #peerManager = null;

  // Velocity ring buffer — just timestamps
  #disconnectTimes = new Array(VELOCITY_BUFFER_SIZE);
  #velocityIndex = 0;
  #velocityCount = 0;

  // Steady state
  #firstPeerConnectedAt = null;
  #inSteadyState = false;

  // Diagnosis state
  #diagnosing = false;
  #lastDiagnosisAt = 0;
  #currentStatus = HEALTH_STATUS.HEALTHY;

  // Observers
  #listeners = [];

  // Diagnosis history ring buffer
  #history = new Array(DIAGNOSIS_HISTORY_SIZE);
  #historyIndex = 0;
  #historyCount = 0;

  setPeerManager(pm) {
    this.#peerManager = pm;
  }

  // --- Recording ---

  /**
   * Called from peerManager.add() on every new peer connection.
   */
  recordConnect() {
    if (!this.#firstPeerConnectedAt) {
      this.#firstPeerConnectedAt = Date.now();
    }
    if (!this.#inSteadyState
        && this.#firstPeerConnectedAt
        && Date.now() - this.#firstPeerConnectedAt >= STEADY_STATE_DELAY_MS) {
      this.#inSteadyState = true;
      log.info('NetworkHealthMonitor: entered steady state');
    }
    // Recovery: if we were in a degraded state and peers are reconnecting, reset to healthy
    if (this.#currentStatus !== HEALTH_STATUS.HEALTHY) {
      const peerCount = this.#peerManager ? this.#peerManager.getNumberOfPeers() : 0;
      if (peerCount >= 5) {
        log.info(`NetworkHealthMonitor: recovered — ${peerCount} peers connected, resetting to HEALTHY`);
        this.#currentStatus = HEALTH_STATUS.HEALTHY;
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
    this.#disconnectTimes[this.#velocityIndex] = now;
    this.#velocityIndex = (this.#velocityIndex + 1) % VELOCITY_BUFFER_SIZE;
    this.#velocityCount += 1;

    if (!this.#inSteadyState) return;
    if (this.#diagnosing) return;
    if (now - this.#lastDiagnosisAt < DIAGNOSIS_COOLDOWN_MS) return;

    const velocity = this.#getDisconnectVelocity(now);
    if (velocity >= VELOCITY_THRESHOLD_COUNT) {
      this.#triggerDiagnosis(velocity);
    }
  }

  // --- Velocity ---

  /**
   * Count disconnect timestamps within the velocity window.
   * @param {number} now
   * @returns {number}
   */
  #getDisconnectVelocity(now) {
    let count = 0;
    const limit = Math.min(this.#velocityCount, VELOCITY_BUFFER_SIZE);
    for (let i = 0; i < limit; i++) {
      if (now - this.#disconnectTimes[i] <= VELOCITY_WINDOW_MS) {
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
  async #triggerDiagnosis(velocity) {
    this.#diagnosing = true;
    this.#lastDiagnosisAt = Date.now();

    try {
      const totalPeers = this.#peerManager ? this.#peerManager.getNumberOfPeers() : 0;
      log.warn(`NetworkHealthMonitor: velocity ${velocity} in ${VELOCITY_WINDOW_MS}ms, diagnosing (${totalPeers} peers remaining)`);

      // Stage 2a: Ping all remaining peers
      const pingResults = await this.#pingAllPeers();

      let status;
      let topologyCorrelation = null;
      let probeResults = null;

      if (pingResults.responded === pingResults.sent && pingResults.sent > 0) {
        // ALL responded
        topologyCorrelation = this.#correlateTopology(pingResults.respondedKeys);
        status = HEALTH_STATUS.NOT_AFFECTED;
      } else if (pingResults.responded === 0) {
        // NONE responded
        probeResults = await this.#probeKnownGoodPeers();
        status = probeResults.succeeded > 0 ? HEALTH_STATUS.IP_CHANGE : HEALTH_STATUS.NETWORK_LOSS;
      } else {
        // SOME responded
        topologyCorrelation = this.#correlateTopology(pingResults.respondedKeys);
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

      this.#currentStatus = status;
      this.#recordDiagnosis(event);
      this.#notifyListeners(event);

      log.warn(`NetworkHealthMonitor: diagnosis complete — ${status}`);
    } catch (e) {
      log.error(`NetworkHealthMonitor diagnosis error: ${e.message}`);
    } finally {
      this.#diagnosing = false;
    }
  }

  /**
   * Ping all remaining peers and collect responses within timeout.
   * @returns {Promise<{sent: number, responded: number, respondedKeys: string[]}>}
   */
  async #pingAllPeers() {
    if (!this.#peerManager) return { sent: 0, responded: 0, respondedKeys: [] };
    const peers = [...this.#peerManager.allValues()];
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
      peer.ws.once('pong', onPong);
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
  #correlateTopology(respondedKeys) {
    if (!this.#peerManager) return { recentlyLost: 0, peersStillSeen: 0, peersGone: 0 };

    // Find recently disconnected peers from history
    const history = this.#peerManager.getHistory();
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
        const topo = this.#peerManager.getTopologyEntry(responderKey);
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
  async #probeKnownGoodPeers() {
    const targets = await this.#getProbeTargets();
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
  async #getProbeTargets() {
    const connected = new Set();
    if (this.#peerManager) {
      for (const peer of this.#peerManager.allValues()) {
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
    this.#listeners.push(callback);
    return () => {
      const idx = this.#listeners.indexOf(callback);
      if (idx !== -1) this.#listeners.splice(idx, 1);
    };
  }

  #notifyListeners(event) {
    for (const fn of this.#listeners) {
      try { fn(event); } catch (e) { log.error(e); }
    }
  }

  // --- History ---

  #recordDiagnosis(event) {
    this.#history[this.#historyIndex] = event;
    this.#historyIndex = (this.#historyIndex + 1) % DIAGNOSIS_HISTORY_SIZE;
    this.#historyCount += 1;
  }

  getDiagnosisHistory() {
    const count = Math.min(this.#historyCount, DIAGNOSIS_HISTORY_SIZE);
    if (count === 0) return [];
    if (this.#historyCount <= DIAGNOSIS_HISTORY_SIZE) {
      return this.#history.slice(0, count);
    }
    return [
      ...this.#history.slice(this.#historyIndex),
      ...this.#history.slice(0, this.#historyIndex),
    ];
  }

  // --- Getters ---

  getStatus() { return this.#currentStatus; }

  get isDiagnosing() { return this.#diagnosing; }

  get velocityCount() { return this.#velocityCount; }

  isInSteadyState() { return this.#inSteadyState; }

  // --- Public trigger for diagnosis (wraps private #triggerDiagnosis) ---

  async diagnose(velocity) {
    return this.#triggerDiagnosis(velocity);
  }

  // --- Reset ---

  reset() {
    this.#disconnectTimes = new Array(VELOCITY_BUFFER_SIZE);
    this.#velocityIndex = 0;
    this.#velocityCount = 0;
    this.#firstPeerConnectedAt = null;
    this.#inSteadyState = false;
    this.#diagnosing = false;
    this.#lastDiagnosisAt = 0;
    this.#currentStatus = HEALTH_STATUS.HEALTHY;
    this.#listeners.length = 0;
    this.#history = new Array(DIAGNOSIS_HISTORY_SIZE);
    this.#historyIndex = 0;
    this.#historyCount = 0;
  }

  // Test-only: override internal state for test setup
  _testSetup(overrides = {}) {
    if ('inSteadyState' in overrides) this.#inSteadyState = overrides.inSteadyState;
    if ('lastDiagnosisAt' in overrides) this.#lastDiagnosisAt = overrides.lastDiagnosisAt;
    if ('diagnosing' in overrides) this.#diagnosing = overrides.diagnosing;
    if ('firstPeerConnectedAt' in overrides) this.#firstPeerConnectedAt = overrides.firstPeerConnectedAt;
    if ('currentStatus' in overrides) this.#currentStatus = overrides.currentStatus;
  }
}

const networkHealthMonitor = new NetworkHealthMonitor();

module.exports = {
  NetworkHealthMonitor,
  networkHealthMonitor,
  HEALTH_STATUS,
  isUnexpectedDisconnect,
  // Exported for testing
  VELOCITY_BUFFER_SIZE,
  VELOCITY_THRESHOLD_COUNT,
  VELOCITY_WINDOW_MS,
  MIN_CONNECTION_AGE_MS,
  STEADY_STATE_DELAY_MS,
  DIAGNOSIS_COOLDOWN_MS,
};
