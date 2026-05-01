const WebSocket = require('ws');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const { version: FLUX_VERSION } = require('../../../../package.json');
const peerCodec = require('./peerCodec');
const rateLimit = require('./rateLimit');

let _fluxNetworkHelper;
function getFluxNetworkHelper() {
  if (!_fluxNetworkHelper) _fluxNetworkHelper = require('../fluxNetworkHelper');
  return _fluxNetworkHelper;
}

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

const PEER_SOURCE = Object.freeze({
  DETERMINISTIC: 'deterministic',
  RANDOM: 'random',
  RECONNECT: 'reconnect',
  MANUAL: 'manual',
  INBOUND: 'inbound',
});

const DIRECTION = Object.freeze({
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
});

class FluxPeerSocket {
  /**
   * @param {WebSocket} ws - raw WebSocket
   * @param {string} ip
   * @param {string} port
   * @param {import('./FluxPeerManager').FluxPeerManager} manager
   */
  constructor(ws, ip, port, manager) {
    this.ws = ws;
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
    this.remoteVersion = null;
    this.remoteFluxUptime = null;
    this.source = PEER_SOURCE.INBOUND;
    this.msgMap = new Map([['requestHash', 0], ['newHash', 0]]);
    this.messagesReceived = 0;
    this.messagesSent = 0;
    this.bytesReceived = 0;
    this.bytesSent = 0;

    this.#bindHandlers();
  }

  /**
   * Direction derived from source. INBOUND source = inbound, everything else = outbound.
   * @returns {'inbound'|'outbound'}
   */
  get direction() {
    return this.source === PEER_SOURCE.INBOUND ? DIRECTION.INBOUND : DIRECTION.OUTBOUND;
  }

  get closeCodes() {
    return this.direction === DIRECTION.INBOUND
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

  get reconnects() {
    return this.manager.getReconnectCount(this.key) || 0;
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
      let payload;
      if (this.remoteCapabilities.has('transmissionTimestamps') && typeof data === 'string') {
        payload = `T${Date.now()}|${data}`;
      } else {
        payload = data;
      }
      this.ws.send(payload);
      this.messagesSent += 1;
      this.bytesSent += Buffer.byteLength(payload, 'utf8');
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
   * Send a NAK (negative acknowledgement) back to sender.
   * @param {string} messageHash - 40-char hex hash
   * @param {number} reasonCode - peerCodec.NAK_REASON value
   */
  sendNak(messageHash, reasonCode) {
    if (this.remoteCapabilities.has('binaryMessages')) {
      this.send(peerCodec.encodeNak(messageHash, reasonCode));
    } else {
      const reasonNames = { [peerCodec.NAK_REASON.STALE]: 'stale', [peerCodec.NAK_REASON.DUPLICATE]: 'duplicate', [peerCodec.NAK_REASON.INVALID]: 'invalid' };
      this.send(JSON.stringify({ type: 'nak', hash: messageHash, reason: reasonNames[reasonCode] || 'unknown' }));
    }
  }

  /**
   * Track incoming NAK messages. If too many NAKs in a time window,
   * log a warning (self-DOS / clock drift detection).
   * @param {string} [messageHash] - hash that was NAKed
   * @param {number} [reasonCode] - NAK_REASON value
   */
  onNakReceived(messageHash, reasonCode) {
    const now = Date.now();
    const NAK_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    const NAK_THRESHOLD = 10;

    if (now - this.nakWindowStart > NAK_WINDOW_MS) {
      this.nakCount = 0;
      this.nakWindowStart = now;
    }
    this.nakCount += 1;

    if (this.nakCount >= NAK_THRESHOLD) {
      log.warn(`Received ${this.nakCount} NAKs from ${this.key} in the last 5 minutes (last: hash=${messageHash}, reason=${reasonCode}). Possible clock drift or network issue.`);
    }
  }

  /**
   * Returns peer info matching existing API shapes.
   * @returns {object}
   */
  toPeerInfo() {
    if (this.direction === DIRECTION.OUTBOUND) {
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
  #bindHandlers() {
    const { ws, manager } = this;

    ws.on('pong', () => {
      try {
        this.onPongReceived();
      } catch (error) {
        log.error(error);
      }
    });

    ws.onclose = (evt) => {
      log.info(`${this.direction === DIRECTION.INBOUND ? 'Incoming' : 'Outgoing'} connection ${this.direction === DIRECTION.INBOUND ? 'from' : 'to'} ${this.key} closed with code ${evt.code}`);
      manager.remove(this.key, evt.code);
    };

    ws.onerror = (evt) => {
      log.info(`${this.direction === DIRECTION.INBOUND ? 'Incoming' : 'Outgoing'} connection ${this.direction === DIRECTION.INBOUND ? 'from' : 'to'} ${this.key} errored with code ${evt.code}`);
      // Per WS spec, error is always followed by close — no need to remove here
    };

    ws.onmessage = (evt) => {
      if (!evt) return;

      const rateOK = rateLimit.lruRateLimit(`${this.ip}:${this.port}`, 120);
      if (!rateOK) return;

      // Binary frame — handle before the string pipeline
      if (Buffer.isBuffer(evt.data)) {
        this.messagesReceived += 1;
        this.bytesReceived += evt.data.length;
        manager.handleBinaryMessage(this, evt.data);
        return;
      }

      this.messagesReceived += 1;
      this.bytesReceived += Buffer.byteLength(evt.data, 'utf8');

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
            const localOffset = getFluxNetworkHelper().getLocalClockOffsetMs();
            if (localOffset !== null && this.remoteClockOffsetMs !== null) {
              delay -= (localOffset - this.remoteClockOffsetMs);
            }
            this.lastTransmissionDelay = delay;
            rawData = rawData.substring(pipeIdx + 1);
          }
        }
      }

      const msgObj = serviceHelper.ensureObject(rawData);

      // Handle peer-level protocol messages (not broadcast)
      if (msgObj.type === 'nak') {
        const reasonMap = { stale: peerCodec.NAK_REASON.STALE, duplicate: peerCodec.NAK_REASON.DUPLICATE, invalid: peerCodec.NAK_REASON.INVALID };
        this.onNakReceived(msgObj.hash, reasonMap[msgObj.reason] ?? msgObj.reason);
        return;
      }
      if (msgObj.type === 'peerExchange') {
        if (this.remoteCapabilities.has('peerExchange')) {
          manager.handlePeerExchange(this, msgObj.outbound || [], msgObj.inbound || []);
        }
        return;
      }
      if (msgObj.type === 'peerUpdate') {
        if (this.remoteCapabilities.has('peerExchange')) {
          manager.handlePeerUpdate(this, msgObj.addOutbound || [], msgObj.addInbound || [], msgObj.rm || []);
        }
        return;
      }

      // Dispatch to the manager's message handler
      if (manager.messageDispatcher) {
        Promise.resolve(manager.messageDispatcher(msgObj, this)).catch((e) => log.error(e));
      }
    };
  }
}

const FLUX_CAPABILITIES = Object.freeze([
  'transmissionTimestamps',
  'peerExchange',
  'binaryMessages',
  'appStateSync',
]);

module.exports = { FluxPeerSocket, CLOSE_CODES, PEER_SOURCE, DIRECTION, FLUX_VERSION, FLUX_CAPABILITIES };
