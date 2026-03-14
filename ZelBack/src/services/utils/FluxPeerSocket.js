const WebSocket = require('ws');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');

const CLOSE_CODES = Object.freeze({
  // Inbound validation (FluxPeerManager.validateAndAddInbound)
  MAX_CONNECTIONS: 4000,
  DUPLICATE_PEER: 4001,
  PRIVATE_IP: 4002,

  // Policy violations — inbound
  BLOCKED_INBOUND: 4003,
  BAD_ORIGIN_INBOUND: 4004,
  BLOCKED_ORIGIN_INBOUND: 4005,

  // Policy violations — outbound
  BLOCKED_OUTBOUND: 4006,
  BAD_ORIGIN_OUTBOUND: 4007,
  BLOCKED_ORIGIN_OUTBOUND: 4008,

  // Purposeful close (admin action or send failure)
  CLOSED_OUTBOUND: 4009,
  CLOSED_INBOUND: 4010,

  // Dead connection (keepalive failure)
  DEAD_CONNECTION: 4011,

  // Auth failures (paymentService, idService)
  AUTH_FAILURE_1: 4012,
  AUTH_FAILURE_2: 4013,
  AUTH_FAILURE_3: 4014,
  AUTH_FAILURE_4: 4015,

  // Invalid messages
  INVALID_MSG_INBOUND: 4016,
  INVALID_MSG_OUTBOUND: 4017,
});

class FluxPeerSocket {
  /**
   * @param {WebSocket} ws - raw WebSocket
   * @param {'inbound'|'outbound'} direction
   * @param {string} ip
   * @param {string} port
   * @param {import('./FluxPeerManager').FluxPeerManager} manager
   */
  constructor(ws, direction, ip, port, manager) {
    this.ws = ws;
    this.direction = direction;
    this.ip = ip;
    this.port = String(port);
    this.key = `${ip}:${this.port}`;
    this.manager = manager;

    this.latency = null;
    this.lastPingTime = null;
    this.lastPongTime = null;
    this.missedPongs = 0;
    this.connectedAt = Date.now();
    this.nakCount = 0;
    this.nakWindowStart = Date.now();
    this.lastTransmissionDelay = null;
    this.badMessageTimestamps = [];
    this.remoteCapabilities = new Set();
    this.remoteClockOffsetMs = null;
    this.msgMap = new Map([['requestHash', 0], ['newHash', 0]]);

    // backward compat: set ip, port, msgMap on the raw socket
    ws.ip = ip;
    ws.port = this.port;
    ws.msgMap = this.msgMap;

    // Read remote capabilities and clock offset from HTTP upgrade headers
    // (set by socketServer.js for inbound, or by the 'upgrade' event handler for outbound).
    // Old nodes don't send these headers.
    if (Array.isArray(ws._remoteCapabilities) && ws._remoteCapabilities.length) {
      this.remoteCapabilities = new Set(ws._remoteCapabilities);
      log.info(`Peer ${this.key} capabilities (from header): ${ws._remoteCapabilities.join(', ')}`);
    }
    if (typeof ws._remoteClockOffsetMs === 'number' && !Number.isNaN(ws._remoteClockOffsetMs)) {
      this.remoteClockOffsetMs = ws._remoteClockOffsetMs;
    }

    this._bindHandlers();
  }

  get closeCodes() {
    return this.direction === 'inbound'
      ? {
        invalidMsg: CLOSE_CODES.INVALID_MSG_INBOUND, blocked: CLOSE_CODES.BLOCKED_INBOUND,
        badOrigin: CLOSE_CODES.BAD_ORIGIN_INBOUND, blockedOrigin: CLOSE_CODES.BLOCKED_ORIGIN_INBOUND,
      }
      : {
        invalidMsg: CLOSE_CODES.INVALID_MSG_OUTBOUND, blocked: CLOSE_CODES.BLOCKED_OUTBOUND,
        badOrigin: CLOSE_CODES.BAD_ORIGIN_OUTBOUND, blockedOrigin: CLOSE_CODES.BLOCKED_ORIGIN_OUTBOUND,
      };
  }

  get isAlive() {
    return this.missedPongs < 3 && this.ws.readyState === WebSocket.OPEN;
  }

  onPingSent() {
    this.lastPingTime = Date.now();
    this.missedPongs += 1;
    if (this.missedPongs >= 3) {
      log.info(`Peer ${this.key} missed ${this.missedPongs} pongs, closing`);
      this.close(CLOSE_CODES.DEAD_CONNECTION, 'dead connection');
    }
  }

  onPongReceived() {
    this.missedPongs = 0;
    this.lastPongTime = Date.now();
    if (this.lastPingTime) {
      this.latency = Math.ceil((this.lastPongTime - this.lastPingTime) / 2);
    }
  }

  /**
   * Send data over the WebSocket.
   * @param {string|Buffer} data
   * @returns {boolean} true if sent successfully
   */
  send(data) {
    try {
      if (this.ws.readyState !== WebSocket.OPEN) return false;
      if (this.remoteCapabilities.has('transmissionTimestamps') && typeof data === 'string') {
        this.ws.send(`T${Date.now()}|${data}`);
      } else {
        this.ws.send(data);
      }
      return true;
    } catch (e) {
      log.error(e);
      return false;
    }
  }

  /**
   * Send a WebSocket ping and track it.
   */
  ping() {
    try {
      if (this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.ping();
      this.onPingSent();
    } catch (e) {
      log.error(e);
    }
  }

  /**
   * Close the WebSocket connection.
   * @param {number} [code]
   * @param {string} [reason]
   */
  close(code, reason) {
    try {
      this.ws.close(code, reason);
    } catch (e) {
      log.error(e);
    }
  }

  /**
   * Send a NAK (negative acknowledgement) back to sender for stale messages.
   * @param {string} messageHash
   * @param {string} reason
   */
  sendNak(messageHash, reason) {
    const nak = JSON.stringify({ type: 'nak', hash: messageHash, reason });
    this.send(nak);
  }

  /**
   * Track incoming NAK messages. If too many NAKs in a time window,
   * log a warning (self-DOS / clock drift detection).
   */
  onNakReceived() {
    const now = Date.now();
    const NAK_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    const NAK_THRESHOLD = 10;

    if (now - this.nakWindowStart > NAK_WINDOW_MS) {
      this.nakCount = 0;
      this.nakWindowStart = now;
    }
    this.nakCount += 1;

    if (this.nakCount >= NAK_THRESHOLD) {
      log.warn(`Received ${this.nakCount} NAKs from ${this.key} in the last 5 minutes. Possible clock drift or network issue.`);
    }
  }

  /**
   * Returns peer info matching existing API shapes.
   * @returns {object}
   */
  toPeerInfo() {
    if (this.direction === 'outbound') {
      return {
        ip: this.ip,
        port: this.port,
        latency: this.latency,
        lastPingTime: this.lastPingTime,
      };
    }
    return {
      ip: this.ip,
      port: this.port,
    };
  }

  /**
   * Bind WebSocket event handlers. Called once in constructor.
   * @private
   */
  _bindHandlers() {
    const { ws, manager } = this;

    ws.on('pong', () => {
      try {
        this.onPongReceived();
      } catch (error) {
        log.error(error);
      }
    });

    ws.onclose = (evt) => {
      log.info(`${this.direction === 'inbound' ? 'Incoming' : 'Outgoing'} connection ${this.direction === 'inbound' ? 'from' : 'to'} ${this.key} closed with code ${evt.code}`);
      manager.remove(this.key, evt.code);
    };

    ws.onerror = (evt) => {
      log.info(`${this.direction === 'inbound' ? 'Incoming' : 'Outgoing'} connection ${this.direction === 'inbound' ? 'from' : 'to'} ${this.key} errored with code ${evt.code}`);
      // Per WS spec, error is always followed by close — no need to remove here
    };

    ws.onmessage = async (evt) => {
      if (!evt) return;

      const fluxNetworkHelper = require('../fluxNetworkHelper');
      const rateOK = fluxNetworkHelper.lruRateLimit(`${this.ip}:${this.port}`, 120);
      if (!rateOK) return;

      // Strip transmission timestamp prefix if present (T{timestamp}|{json})
      // Adjust for clock skew using exchanged NTP offsets:
      //   rawDelay = localTime - remoteTime
      //   skew = localOffset - remoteOffset (positive = our clock is ahead)
      //   adjustedDelay = rawDelay - skew
      let rawData = evt.data;
      if (typeof rawData === 'string' && rawData.length > 2 && rawData[0] === 'T') {
        const pipeIdx = rawData.indexOf('|');
        if (pipeIdx > 1 && pipeIdx < 16) { // timestamp is 13-14 digits
          const tsStr = rawData.substring(1, pipeIdx);
          const ts = Number(tsStr);
          if (ts > 0) {
            let delay = Date.now() - ts;
            const localOffset = fluxNetworkHelper.getLocalClockOffsetMs();
            if (localOffset !== null && this.remoteClockOffsetMs !== null) {
              delay -= (localOffset - this.remoteClockOffsetMs);
            }
            this.lastTransmissionDelay = delay;
            rawData = rawData.substring(pipeIdx + 1);
          }
        }
      }

      const msgObj = serviceHelper.ensureObject(rawData);

      // Handle NAK messages
      if (msgObj.type === 'nak') {
        this.onNakReceived();
        return;
      }

      // Dispatch to the manager's message handler
      if (manager.messageDispatcher) {
        manager.messageDispatcher(msgObj, this);
      }
    };
  }
}

module.exports = { FluxPeerSocket, CLOSE_CODES };
