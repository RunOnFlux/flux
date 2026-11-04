const config = require('config');
const { performance } = require('perf_hooks');
const WebSocket = require('ws');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const { version: FLUX_VERSION } = require('../../../../package.json');
const peerCodec = require('./peerCodec');
const rateLimit = require('./rateLimit');
const { isHandshake, isOrdered } = require('./messageRoutes');
const linkCrypto = require('./linkCrypto');
const fluxEventBus = require('./fluxEventBus');

let _fluxNetworkHelper;
function getFluxNetworkHelper() {
  if (!_fluxNetworkHelper) _fluxNetworkHelper = require('../fluxNetworkHelper');
  return _fluxNetworkHelper;
}

/**
 * Milliseconds from a clock that only moves forward.
 *
 * Every elapsed measurement below uses this rather than Date.now(). Wall clock is adjusted by NTP
 * and by hand, and a backward step makes an elapsed time negative while a forward one makes a peer
 * look silent for however far the clock jumped — either can terminate a healthy connection.
 * Timestamps that are REPORTED stay on the wall clock, because a caller reading connectedAt or
 * lastPongTime wants a date, not milliseconds since this process started.
 *
 * @returns {number}
 */
function monotonicMs() {
  return performance.now();
}

/**
 * The messages that arrived in a frame carrying a valid link MAC, which only the
 * other end of an authenticated Arcane link (services/arcaneLink.js) can make.
 */
const arrivedOverAuthenticatedLink = new WeakSet();

/**
 * Whether a parsed message arrived in a frame carrying a valid link MAC.
 * @param {object} msgObj As handed to the dispatchers.
 * @returns {boolean}
 */
function arrivedAuthenticated(msgObj) {
  return typeof msgObj === 'object' && msgObj !== null && arrivedOverAuthenticatedLink.has(msgObj);
}

// The most frames, and bytes of frames, a connection takes while its link
// handshake runs.
const HANDSHAKE_QUEUE_MAX = 256;
const HANDSHAKE_QUEUE_MAX_BYTES = 1024 * 1024;
// The handshake frames a connection holds awaiting verification. A handshake is
// a nonce and a confirm from each side of its restart, so an honest peer holds
// two or three.
const HANDSHAKE_FRAMES_HELD_MAX = 8;

// The admission protocol (services/appMessaging/admissionQuorum.js), and an
// Arcane node's report of its authenticated links, taken only from a frame
// carrying a valid link MAC.
const LINK_MESSAGE_TYPES = new Set(['appproposal', 'appreceipt', 'appcommit', 'arcanepeers']);

// These number the PEER sockets. The browser routes on the same server carry
// their own meanings for the same numbers - the payment relay answers a
// browser with 4012 when a transaction id arrives - so a code read off a
// socket means what that socket's route says it means.
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

  // Auth failures (idService)
  AUTH_FAILURE_1: 4012,
  AUTH_FAILURE_2: 4013,
  AUTH_FAILURE_3: 4014,
  AUTH_FAILURE_4: 4015,

  // Invalid messages
  INVALID_MSG_INBOUND: 4016,
  INVALID_MSG_OUTBOUND: 4017,

  // Ephemeral connection complete
  EPHEMERAL_DONE: 4018,

  // Node lost confirmation — disconnecting all peers
  NODE_UNCONFIRMED: 4019,

  // Dialled for an authenticated Arcane link, and its handshake did not
  // authenticate: not a fault of the peer, and not redialled
  NOT_ARCANE_LINK: 4020,

  // Inbound on a path port that is not one of config.server.allowedPorts
  PORT_NOT_ALLOWED: 4021,
});

const PEER_SOURCE = Object.freeze({
  DETERMINISTIC: 'deterministic',
  RANDOM: 'random',
  RECONNECT: 'reconnect',
  MANUAL: 'manual',
  INBOUND: 'inbound',
  EPHEMERAL: 'ephemeral',
  // Dialled to hold admissionLinkTarget authenticated links (fluxCommunication).
  ARCANE: 'arcane',
});

const DIRECTION = Object.freeze({
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
});

class FluxPeerSocket {
  /**
   * Distinguishes one connection to an address from the next one to it.
   *
   * `ip:port` names a NODE, and a node that reconnects is the same key over a
   * different socket. Anything recorded against a connection - a request whose
   * answer is still expected, and what that peer said about it - needs an
   * identity the address alone does not give it.
   */
  static #nextConnectionId = 1;

  /** Frames that arrived while the link handshake ran, waiting for the connection to join. */
  #queuedFrames = [];

  // Handshake frames in arrival order, and how many are held.
  #handshakeTail = Promise.resolve();

  #handshakeFramesHeld = 0;

  #queuedBytes = 0;

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
    this.connectionId = FluxPeerSocket.#nextConnectionId;
    FluxPeerSocket.#nextConnectionId += 1;
    this.manager = manager;

    this.latency = null;
    // Reported, so wall clock. The elapsed maths uses the monotonic pair below.
    this.lastPingTime = null;
    this.lastPongTime = null;
    this.lastPingMono = null;
    this.missedPongs = 0;
    /**
     * Whether a ping has gone out that this peer has not yet answered.
     *
     * A ping in flight is not a missed pong, and the two used to be the same
     * number: missedPongs was incremented at SEND, so it read 1 on a healthy
     * peer for the whole round trip after every ping. Anything asking "has this
     * peer missed a pong" got yes, once per ping interval, about a peer that
     * was answering perfectly.
     */
    this.pingOutstanding = false;
    this.maxMissedPongs = config.peers.wsMaxMissedPongs ?? 3;
    /**
     * When anything was last heard from this peer, on the monotonic clock.
     *
     * A peer mid-conversation is the one case the heartbeat should never fire on, and crediting
     * only pongs makes it fire there first: a pong is an ordinary frame that queues behind
     * whatever else that peer sent, so the busiest connections look the most silent.
     *
     * Null until something actually arrives. Seeding it with the connection time would credit a
     * peer for existing and give every new connection a free window in which no missed pong can
     * terminate it.
     */
    this.lastMessageMono = null;
    /**
     * How long a peer may go completely quiet before a missed-pong count can terminate it.
     *
     * Derived, not a new tunable: it is exactly the window the pong count already allows, so a
     * genuinely silent peer is dropped on the same schedule as before and only a talking one is
     * treated differently.
     */
    this.livenessWindowMs = (config.peers.wsPingIntervalMs ?? 15000) * this.maxMissedPongs;
    this.connectedAt = Date.now();
    this.nakCount = 0;
    this.nakWindowStart = Date.now();
    this.lastTransmissionDelay = null;
    this.badMessageTimestamps = [];
    this.fetchRecord = { startedAt: Date.now(), misses: 0, served: 0 };
    this.remoteCapabilities = new Set();
    // This connection's Arcane link handshake (services/arcaneLink.js): null
    // until it opens, and never carried to another connection.
    this.link = null;
    // Whether this connection's link handshake is still running: it has not
    // joined the peer set yet (FluxPeerManager.add).
    this.handshaking = false;
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

  /** Anything received from this peer within the window the pong count allows. */
  get heardFromRecently() {
    return this.lastMessageMono !== null
      && monotonicMs() - this.lastMessageMono < this.livenessWindowMs;
  }

  get isAlive() {
    return this.ws.readyState === WebSocket.OPEN
      && (this.missedPongs < this.maxMissedPongs || this.heardFromRecently);
  }

  get reconnects() {
    return this.manager.getReconnectCount(this.key) || 0;
  }

  onPingSent() {
    // The ping going out now is IN FLIGHT, and nothing is yet known about it.
    // What this moment decides is the fate of the PREVIOUS one: its pong has had
    // a full interval to arrive, so if the peer still owes us one, that is a
    // pong genuinely missed. Counting at send instead made the number a count of
    // pings sent since the last pong, which is not what it is named, not what
    // isAlive means by it, and not what the peers that read it assume.
    //
    // So a peer answering normally now sits at 0 always, and one that has gone
    // silent reaches maxMissedPongs after that many intervals rather than one
    // early - the ~45s that peerResponsiveness already documents.
    if (this.pingOutstanding) this.missedPongs += 1;
    this.pingOutstanding = true;
    this.lastPingTime = Date.now();
    this.lastPingMono = monotonicMs();
    // Unanswered pings only terminate a peer we have heard NOTHING else from. Three unanswered
    // pings from a peer that is streaming messages at us means our own reader has not reached the
    // pong yet, not that the peer is gone.
    if (this.missedPongs >= this.maxMissedPongs && !this.heardFromRecently) {
      log.info(`Peer ${this.key} missed ${this.missedPongs} pongs and sent nothing else, terminating`);
      this.terminate();
    }
  }

  onPongReceived() {
    this.pingOutstanding = false;
    this.missedPongs = 0;
    this.lastPongTime = Date.now();
    this.lastMessageMono = monotonicMs();
    if (this.lastPingMono !== null) {
      this.latency = Math.ceil((monotonicMs() - this.lastPingMono) / 2);
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
      const payload = this.#frame(data);
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
   * Send data over the WebSocket, returning a Promise that resolves when the
   * data has been flushed to the kernel TCP buffer. Provides backpressure —
   * callers can await to pace sends to the drain rate.
   * @param {string|Buffer} data
   * @returns {Promise<boolean>} true if sent successfully
   */
  sendAsync(data) {
    return new Promise((resolve) => {
      try {
        if (this.ws.readyState !== WebSocket.OPEN) { resolve(false); return; }
        const payload = this.#frame(data);
        this.ws.send(payload, (err) => {
          if (err) { resolve(false); return; }
          this.messagesSent += 1;
          this.bytesSent += Buffer.byteLength(payload, 'utf8');
          resolve(true);
        });
      } catch (e) {
        log.error(e);
        resolve(false);
      }
    });
  }

  /**
   * A text frame as it goes on the wire: the transmission timestamp when the
   * peer takes one, and on an authenticated link a MAC over all of it under
   * this direction's key. Binary frames go as they are.
   * @param {string|Buffer} data
   * @returns {string|Buffer}
   */
  #frame(data) {
    if (typeof data !== 'string') return data;
    const timed = this.remoteCapabilities.has('transmissionTimestamps') ? `T${Date.now()}|${data}` : data;
    if (!this.link?.authenticated) return timed;
    const number = this.link.sendNumber;
    this.link.sendNumber += 1;
    return linkCrypto.sealFrame(this.link.sendKey, number, timed);
  }

  /**
   * The frame under a link MAC prefix, when the MAC is the peer's and its number
   * is past the last frame taken on this link, which it then becomes.
   *
   * Checked once this node has derived the link's keys, before it has necessarily
   * read the peer's confirm: the peer MACs only after accepting this node's
   * confirm, which it sent once it had the keys, and a valid MAC proves what the
   * confirm proves.
   * @param {string} raw A frame beginning with `M`.
   * @returns {string|null} The rest of the frame, or null when the MAC is not
   *   this link's or the frame is not newer than the last taken.
   */
  #openLinkFrame(raw) {
    const { link } = this;
    if (!link?.recvKey || link.failed) return null;
    const opened = linkCrypto.openFrame(link.recvKey, raw);
    if (!opened || opened.number <= link.recvNumber) return null;
    link.recvNumber = opened.number;
    return opened.frame;
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

  terminate() {
    this.ws.terminate();
  }

  /**
   * Drop every handler on the underlying socket.
   *
   * Used when the manager has already accounted for this peer's departure. onclose is the
   * only caller of FluxPeerManager.remove(), so a socket that completes its handshake
   * afterwards would remove an entry that has since been replaced or already retired, and
   * a frame arriving in the meantime would be processed for a peer no longer held.
   */
  detachHandlers() {
    this.ws.onclose = null;
    this.ws.onerror = null;
    this.ws.onmessage = null;
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
      if (this.handshaking) {
        manager.removeHandshaking(this);
      } else if (this.source === PEER_SOURCE.EPHEMERAL) {
        manager.removeEphemeral(this.key);
      } else {
        manager.remove(this.key, evt.code);
      }
    };

    ws.onerror = (evt) => {
      log.info(`${this.direction === DIRECTION.INBOUND ? 'Incoming' : 'Outgoing'} connection ${this.direction === DIRECTION.INBOUND ? 'from' : 'to'} ${this.key} errored with code ${evt.code}`);
      // Per WS spec, error is always followed by close — no need to remove here
    };

    ws.onmessage = (evt) => {
      if (!evt) return;

      // Before the rate limit: a frame we decline to process still proves the peer is there, and
      // liveness is a question about the peer rather than about how much work we accept from it.
      this.lastMessageMono = monotonicMs();

      const rateOK = rateLimit.lruRateLimit(`${this.ip}:${this.port}`, 120);
      if (!rateOK) return;

      const bytes = Buffer.isBuffer(evt.data) ? evt.data.length : Buffer.byteLength(evt.data, 'utf8');
      let frame = { data: evt.data, bytes, linkVerified: false };
      // A frame under a link MAC is opened here, as it arrives: the frames reach
      // this handler in the order the peer numbered them, and nothing that holds
      // a frame back comes before this point.
      if (typeof evt.data === 'string' && evt.data[0] === 'M') {
        const opened = this.#openLinkFrame(evt.data);
        if (opened === null) {
          log.warn(`Dropping a frame from ${this.direction} peer ${this.key}: its link MAC does not verify, or it is not newer than the last frame taken`);
          fluxEventBus.publish('peers:frameDropped', {
            ip: this.ip, port: this.port, type: null, bytes, reason: 'linkMac',
          });
          return;
        }
        frame = { data: opened, bytes, linkVerified: true };
      }

      if (Buffer.isBuffer(evt.data) && peerCodec.isLinkFrame(evt.data)) {
        this.#takeLinkFrame(evt.data);
        return;
      }

      // Until the link handshake settles only its own frames are handled; everything
      // else waits on the socket, in order, for the connection to join.
      if (this.handshaking) {
        if (this.#queuedFrames.length >= HANDSHAKE_QUEUE_MAX || this.#queuedBytes + bytes > HANDSHAKE_QUEUE_MAX_BYTES) {
          log.warn(`Closing ${this.direction} connection ${this.key}: more than ${HANDSHAKE_QUEUE_MAX} frames or ${HANDSHAKE_QUEUE_MAX_BYTES} bytes arrived before its link handshake settled`);
          this.close(this.closeCodes.invalidMsg, 'too much arrived before the link settled');
          return;
        }
        this.#queuedFrames.push(frame);
        this.#queuedBytes += bytes;
        return;
      }
      this.#handleFrame(frame);
    };
  }

  /**
   * Handle the frames that arrived while the link handshake ran, once the
   * connection has joined.
   */
  flushQueuedFrames() {
    const queued = this.#queuedFrames;
    this.#queuedFrames = [];
    this.#queuedBytes = 0;
    queued.forEach((evt) => this.#handleFrame(evt));
  }

  /**
   * A binary link frame, which is decoded by its layout and never parsed. One
   * that does not decode, as none over the layout's size does, closes the connection.
   * @param {Buffer} buf
   */
  #takeLinkFrame(buf) {
    this.messagesReceived += 1;
    this.bytesReceived += buf.length;
    const msgObj = peerCodec.decodeLinkFrame(buf);
    if (!msgObj) {
      log.warn(`Closing ${this.direction} connection ${this.key}: a ${buf.length} byte link frame that does not decode`);
      this.close(this.closeCodes.invalidMsg, 'link frame does not decode');
      return;
    }
    this.#takeHandshakeFrame(msgObj, buf.length);
  }

  /**
   * A handshake frame takes its place on this connection in the step it arrives.
   * Its verification runs at once and may finish in any order; the frame is
   * handled once every frame before it has been, so a peer's confirm is never
   * handled ahead of the nonce it answers.
   * @param {object} msgObj
   * @param {number} bytes
   */
  #takeHandshakeFrame(msgObj, bytes) {
    const { manager } = this;
    if (this.#handshakeFramesHeld >= HANDSHAKE_FRAMES_HELD_MAX) {
      log.warn(`Dropping a ${msgObj.data.type} from ${this.direction} peer ${this.key}: ${HANDSHAKE_FRAMES_HELD_MAX} handshake frames are awaiting verification`);
      fluxEventBus.publish('peers:frameDropped', {
        ip: this.ip, port: this.port, type: msgObj.data.type, bytes, reason: 'handshakeHeld',
      });
      return;
    }
    this.#handshakeFramesHeld += 1;
    const verified = manager.handshakeFrameVerifier(msgObj, this);
    this.#handshakeTail = this.#handshakeTail
      .then(() => verified)
      .then((ok) => {
        this.#handshakeFramesHeld -= 1;
        if (ok) manager.handshakeFrameDispatcher(msgObj, this);
      })
      .catch((error) => log.error(error));
  }

  /**
   * One frame, its link MAC already checked and removed.
   * @param {{data: string|Buffer, bytes: number, linkVerified: boolean}} evt
   *   `bytes` is the frame's size as it arrived; `linkVerified`, whether it
   *   carried a valid link MAC.
   */
  #handleFrame(evt) {
    const { manager } = this;
    // Binary frame — handle before the string pipeline
    if (Buffer.isBuffer(evt.data)) {
      this.messagesReceived += 1;
      this.bytesReceived += evt.data.length;
      manager.handleBinaryMessage(this, evt.data);
      return;
    }

    this.messagesReceived += 1;
    const frameBytes = evt.bytes;
    this.bytesReceived += frameBytes;

    // Strip transmission timestamp prefix if present (T{timestamp}|{json})
    // Adjust for clock skew using exchanged NTP offsets:
    //   rawDelay = localTime - remoteTime
    //   skew = localOffset - remoteOffset (positive = our clock is ahead)
    //   adjustedDelay = rawDelay - skew
    let rawData = evt.data;
    const { linkVerified } = evt;
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
    if (linkVerified && typeof msgObj === 'object' && msgObj !== null) arrivedOverAuthenticatedLink.add(msgObj);

    // Handle peer-level protocol messages (not broadcast)
    if (LINK_MESSAGE_TYPES.has(msgObj.type)) {
      // Only the other end of an authenticated link can send these.
      if (linkVerified && manager.linkMessageDispatcher) {
        setImmediate(() => {
          try {
            manager.linkMessageDispatcher(msgObj, this);
          } catch (error) {
            log.error(error);
          }
        });
      }
      return;
    }
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

    // Around the gossip pipeline: these keep their arrival order.
    if (isOrdered(msgObj.data?.type)) {
      if (manager.syncResponseDispatcher && manager.isSyncResponseWanted(this)) {
        setImmediate(() => manager.syncResponseDispatcher(msgObj, this));
        return;
      }
    }

    // No event a node takes is larger than this, so a broadcast that is goes no
    // further: it is not verified, stored or relayed. A sync answer holds many
    // events and each is held to it on its own (fluxCommunication).
    if (frameBytes > config.fluxapps.gossipMessageMaxBytes) {
      log.warn(`Dropping a ${frameBytes} byte ${msgObj.data?.type} from ${this.direction} peer ${this.key}: over ${config.fluxapps.gossipMessageMaxBytes} bytes`);
      fluxEventBus.publish('peers:frameDropped', {
        ip: this.ip, port: this.port, type: msgObj.data?.type ?? null, bytes: frameBytes,
      });
      return;
    }

    // The handshake travels in binary link frames, so a text copy of one is no part of it.
    if (isHandshake(msgObj.data?.type)) return;

    // Dispatch to the manager's message handler (gossip pipeline)
    if (manager.messageDispatcher) {
      setImmediate(() => manager.messageDispatcher(msgObj, this).catch((e) => log.error(e)));
    }
  }
}

const FLUX_CAPABILITIES = Object.freeze([
  'transmissionTimestamps',
  'peerExchange',
  'binaryMessages',
  'appStateSync',
  // This build answers a state-sync request it cannot usefully serve with a
  // refusal, instead of an empty batch that reads as a completed survey. A peer
  // that does not claim it cannot tell us it knows nothing, so it is still held
  // to the uptime proxy - see getEligibleSyncPeers.
  'appStateSyncRefusal',
  // This build speaks the policy bundle protocol - it answers fluxpolicyrequest and
  // understands an adoption announcement. A peer that does not claim it is not a quiet
  // participant, it is not a participant: asking it spends a window waiting for a reply
  // that cannot come, and announcing to it logs an unrecognised type on its side.
  'policyBundle',
  // This build authenticates links between Arcane nodes (services/arcaneLink.js).
  // Only an Arcane node claims it: a legacy node's fluxbench cannot derive the
  // link secret.
  ...(process.env.FLUXOS_PATH ? [linkCrypto.CAPABILITY] : []),
]);

module.exports = {
  FluxPeerSocket, CLOSE_CODES, PEER_SOURCE, DIRECTION, FLUX_VERSION, FLUX_CAPABILITIES, arrivedAuthenticated,
};
