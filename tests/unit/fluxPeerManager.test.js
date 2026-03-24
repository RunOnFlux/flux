const chai = require('chai');
const sinon = require('sinon');
const EventEmitter = require('events');
const WebSocket = require('ws');

const { expect } = chai;

const { FluxPeerSocket, CLOSE_CODES, PEER_SOURCE } = require('../../ZelBack/src/services/utils/FluxPeerSocket');
const { FluxPeerManager, peerManager } = require('../../ZelBack/src/services/utils/FluxPeerManager');
const peerCodec = require('../../ZelBack/src/services/utils/peerCodec');
const rateLimit = require('../../ZelBack/src/services/utils/rateLimit');
const { NetworkHealthMonitor } = require('../../ZelBack/src/services/utils/NetworkHealthMonitor');

/**
 * Creates a mock WebSocket object suitable for FluxPeerSocket tests.
 * Extends EventEmitter so on/removeListener/emit work natively.
 */
function createMockWs(ip = '192.168.1.1') {
  const ws = new EventEmitter();
  ws.readyState = WebSocket.OPEN;
  ws.ping = sinon.stub();
  ws.send = sinon.stub();
  ws.close = sinon.stub();
  ws.onclose = null;
  ws.onerror = null;
  ws.onmessage = null;
  ws._socket = { remoteAddress: ip, _peername: { address: ip } };
  return ws;
}

/**
 * Creates a mock HTTP upgrade request object for validateAndAddInbound tests.
 */
function createMockReq(ip = '192.168.1.1', headers = {}) {
  return {
    socket: { remoteAddress: ip },
    headers,
  };
}

describe('FluxPeerSocket tests', () => {
  let manager;

  beforeEach(() => {
    manager = new FluxPeerManager();
    manager.messageDispatcher = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
    manager.reset();
  });

  describe('constructor', () => {
    it('should set all properties correctly', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      expect(peer.ws).to.equal(ws);
      expect(peer.direction).to.equal('outbound');
      expect(peer.ip).to.equal('10.0.0.1');
      expect(peer.port).to.equal('16127');
      expect(peer.key).to.equal('10.0.0.1:16127');
      expect(peer.manager).to.equal(manager);
      expect(peer.latency).to.equal(null);
      expect(peer.lastPingTime).to.equal(null);
      expect(peer.lastPongTime).to.equal(null);
      expect(peer.missedPongs).to.equal(0);
      expect(peer.connectedAt).to.be.a('number');
      expect(peer.nakCount).to.equal(0);
      expect(peer.nakWindowStart).to.be.a('number');
      expect(peer.msgMap).to.be.instanceOf(Map);
      expect(peer.msgMap.get('requestHash')).to.equal(0);
      expect(peer.msgMap.get('newHash')).to.equal(0);
    });

    it('should convert port to string', () => {
      const ws = createMockWs('10.0.0.1', 16127);
      const peer = new FluxPeerSocket(ws, '10.0.0.1', 16127, manager);
      peer.source = PEER_SOURCE.RANDOM;
      expect(peer.port).to.equal('16127');
    });

  });

  describe('closeCodes', () => {
    it('should return inbound close codes for inbound direction', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      expect(peer.closeCodes.invalidMsg).to.equal(CLOSE_CODES.INVALID_MSG_INBOUND);
      expect(peer.closeCodes.blocked).to.equal(CLOSE_CODES.BLOCKED_INBOUND);
      expect(peer.closeCodes.badOrigin).to.equal(CLOSE_CODES.BAD_ORIGIN_INBOUND);
      expect(peer.closeCodes.blockedOrigin).to.equal(CLOSE_CODES.BLOCKED_ORIGIN_INBOUND);
    });

    it('should return outbound close codes for outbound direction', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      expect(peer.closeCodes.invalidMsg).to.equal(CLOSE_CODES.INVALID_MSG_OUTBOUND);
      expect(peer.closeCodes.blocked).to.equal(CLOSE_CODES.BLOCKED_OUTBOUND);
      expect(peer.closeCodes.badOrigin).to.equal(CLOSE_CODES.BAD_ORIGIN_OUTBOUND);
      expect(peer.closeCodes.blockedOrigin).to.equal(CLOSE_CODES.BLOCKED_ORIGIN_OUTBOUND);
    });
  });

  describe('isAlive', () => {
    it('should return true when missedPongs < 3 and ws.readyState === OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      peer.missedPongs = 0;
      expect(peer.isAlive).to.equal(true);

      peer.missedPongs = 2;
      expect(peer.isAlive).to.equal(true);
    });

    it('should return false when missedPongs >= 3', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      peer.missedPongs = 3;
      expect(peer.isAlive).to.equal(false);

      peer.missedPongs = 5;
      expect(peer.isAlive).to.equal(false);
    });

    it('should return false when ws.readyState !== OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.CLOSED;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      peer.missedPongs = 0;
      expect(peer.isAlive).to.equal(false);
    });
  });

  describe('onPingSent', () => {
    it('should increment missedPongs and set lastPingTime', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      expect(peer.missedPongs).to.equal(0);
      expect(peer.lastPingTime).to.equal(null);

      peer.onPingSent();
      expect(peer.missedPongs).to.equal(1);
      expect(peer.lastPingTime).to.be.a('number');
      expect(peer.lastPingTime).to.be.closeTo(Date.now(), 50);

      peer.onPingSent();
      expect(peer.missedPongs).to.equal(2);
    });
  });

  describe('onPongReceived', () => {
    it('should reset missedPongs, set lastPongTime, and compute latency', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      // Simulate a ping then pong
      peer.onPingSent();
      peer.onPingSent();
      expect(peer.missedPongs).to.equal(2);

      const pingTime = peer.lastPingTime;
      peer.onPongReceived();

      expect(peer.missedPongs).to.equal(0);
      expect(peer.lastPongTime).to.be.a('number');
      expect(peer.lastPongTime).to.be.at.least(pingTime);
      expect(peer.latency).to.be.a('number');
      expect(peer.latency).to.be.at.least(0);
    });

    it('should not compute latency if lastPingTime is null', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      peer.onPongReceived();
      expect(peer.latency).to.equal(null);
      expect(peer.missedPongs).to.equal(0);
    });
  });

  describe('send', () => {
    it('should return true on success when OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      const result = peer.send('hello');
      expect(result).to.equal(true);
      sinon.assert.calledOnce(ws.send);
      sinon.assert.calledWith(ws.send, 'hello');
    });

    it('should return false when ws is not OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.CLOSED;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      const result = peer.send('hello');
      expect(result).to.equal(false);
      sinon.assert.notCalled(ws.send);
    });

    it('should return false when ws.send throws', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      ws.send.throws(new Error('send error'));
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      const result = peer.send('hello');
      expect(result).to.equal(false);
    });
  });

  describe('ping', () => {
    it('should call ws.ping and onPingSent when OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      sinon.spy(peer, 'onPingSent');

      peer.ping();

      sinon.assert.calledOnce(ws.ping);
      sinon.assert.calledOnce(peer.onPingSent);
      expect(peer.missedPongs).to.equal(1);
    });

    it('should not call ws.ping when not OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.CLOSED;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      peer.ping();

      sinon.assert.notCalled(ws.ping);
      expect(peer.missedPongs).to.equal(0);
    });
  });

  describe('close', () => {
    it('should call ws.close with code and reason', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      peer.close(4011, 'dead connection');

      sinon.assert.calledOnce(ws.close);
      sinon.assert.calledWith(ws.close, 4011, 'dead connection');
    });

    it('should call ws.close without args when none provided', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      peer.close();

      sinon.assert.calledOnce(ws.close);
    });
  });

  describe('sendNak', () => {


    it('should send JSON NAK message to legacy peer with reason name', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      peer.sendNak('abc123', peerCodec.NAK_REASON.STALE);

      sinon.assert.calledOnce(ws.send);
      const sentData = JSON.parse(ws.send.firstCall.args[0]);
      expect(sentData.type).to.equal('nak');
      expect(sentData.hash).to.equal('abc123');
      expect(sentData.reason).to.equal('stale');
    });

    it('should send binary NAK to peer with binaryMessages capability', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      peer.remoteCapabilities.add('binaryMessages');

      peer.sendNak('abcdef0123456789abcdef0123456789abcdef01', peerCodec.NAK_REASON.STALE);

      sinon.assert.calledOnce(ws.send);
      const sent = ws.send.firstCall.args[0];
      expect(Buffer.isBuffer(sent)).to.be.true;
      expect(sent[0]).to.equal(peerCodec.MSG_TYPE.NAK);
      const decoded = peerCodec.decodeNak(sent);
      expect(decoded.hash).to.equal('abcdef0123456789abcdef0123456789abcdef01');
      expect(decoded.reason).to.equal(peerCodec.NAK_REASON.STALE);
    });
  });

  describe('toPeerInfo', () => {
    it('should return correct shape for outbound (with latency and lastPingTime)', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      peer.latency = 42;
      peer.lastPingTime = 1700000000000;

      const info = peer.toPeerInfo();
      expect(info).to.deep.equal({
        ip: '10.0.0.1',
        port: '16127',
        latency: 42,
        lastPingTime: 1700000000000,
      });
    });

    it('should return correct shape for inbound (ip and port only)', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.latency = 42;
      peer.lastPingTime = 1700000000000;

      const info = peer.toPeerInfo();
      expect(info).to.deep.equal({
        ip: '10.0.0.1',
        port: '16127',
      });
    });
  });

  describe('_bindHandlers', () => {
    it('should bind pong handler that calls onPongReceived', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      sinon.spy(peer, 'onPongReceived');

      // Emit pong event — handler was bound via ws.on('pong', ...) in _bindHandlers
      ws.emit('pong');

      sinon.assert.calledOnce(peer.onPongReceived);
    });

    it('should set onclose that calls manager.remove', () => {
      const ws = createMockWs();
      sinon.spy(manager, 'remove');
      // Add via manager so peer is in the map
      const peer = manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      expect(ws.onclose).to.be.a('function');
      ws.onclose({ code: 1000 });

      sinon.assert.calledOnce(manager.remove);
      sinon.assert.calledWith(manager.remove, '10.0.0.1:16127');
    });

    it('should set onmessage that calls manager.messageDispatcher', async () => {
      const ws = createMockWs();
      // Stub the rate limiter to allow the message through

      sinon.stub(rateLimit, 'lruRateLimit').returns(true);

      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);

      peer.source = PEER_SOURCE.RANDOM;

      expect(ws.onmessage).to.be.a('function');

      const msgData = JSON.stringify({ type: 'test', data: 'hello' });
      await ws.onmessage({ data: msgData });

      sinon.assert.calledOnce(manager.messageDispatcher);
    });

    it('should handle NAK messages via onNakReceived', async () => {
      const ws = createMockWs();

      sinon.stub(rateLimit, 'lruRateLimit').returns(true);


      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);

      peer.source = PEER_SOURCE.RANDOM;
      sinon.spy(peer, 'onNakReceived');

      const nakMsg = JSON.stringify({ type: 'nak', hash: 'abc', reason: 'stale' });
      await ws.onmessage({ data: nakMsg });

      sinon.assert.calledOnce(peer.onNakReceived);
      sinon.assert.calledWithExactly(peer.onNakReceived, 'abc', peerCodec.NAK_REASON.STALE);
      sinon.assert.notCalled(manager.messageDispatcher);
    });

    it('should not dispatch when rate limited', async () => {
      const ws = createMockWs();

      sinon.stub(rateLimit, 'lruRateLimit').returns(false);

      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);

      peer.source = PEER_SOURCE.RANDOM;

      await ws.onmessage({ data: '{"type":"test"}' });

      sinon.assert.notCalled(manager.messageDispatcher);
    });

    it('should return early when evt is falsy', async () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      // Should not throw
      await ws.onmessage(null);
      await ws.onmessage(undefined);

      sinon.assert.notCalled(manager.messageDispatcher);
    });
  });

  describe('onNakReceived', () => {


    it('should increment nakCount with hash and reason', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      expect(peer.nakCount).to.equal(0);

      peer.onNakReceived('abc123', peerCodec.NAK_REASON.STALE);
      expect(peer.nakCount).to.equal(1);

      peer.onNakReceived('def456', peerCodec.NAK_REASON.STALE);
      expect(peer.nakCount).to.equal(2);
    });

    it('should reset nakCount when window expires', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      peer.nakCount = 5;
      // Set window start to 6 minutes ago (beyond 5 min window)
      peer.nakWindowStart = Date.now() - (6 * 60 * 1000);

      peer.onNakReceived('abc123', peerCodec.NAK_REASON.STALE);
      expect(peer.nakCount).to.equal(1);
    });
  });
});

describe('FluxPeerManager tests', () => {
  let manager;

  beforeEach(() => {
    manager = new FluxPeerManager();
    manager.messageDispatcher = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
    manager.reset();
  });

  describe('add', () => {
    it('should create FluxPeerSocket, insert into map and correct direction set', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      expect(peer).to.be.instanceOf(FluxPeerSocket);
      expect(manager.has('10.0.0.1:16127')).to.equal(true);
      expect(manager.get('10.0.0.1:16127')).to.equal(peer);
      expect(manager.outboundCount).to.equal(1);
      expect(manager.inboundCount).to.equal(0);
    });

    it('should add inbound peer to inbound set', () => {
      const ws = createMockWs('10.0.0.2', '16127');
      const peer = manager.add(ws, '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });

      expect(peer).to.be.instanceOf(FluxPeerSocket);
      expect(manager.inboundCount).to.equal(1);
      expect(manager.outboundCount).to.equal(0);
    });

    it('should return the created FluxPeerSocket', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      expect(peer).to.be.instanceOf(FluxPeerSocket);
      expect(peer.ip).to.equal('10.0.0.1');
      expect(peer.port).to.equal('16127');
      expect(peer.direction).to.equal('outbound');
    });

    it('should convert port to string', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, '10.0.0.1', 16127, { source: PEER_SOURCE.RANDOM });
      expect(peer.port).to.equal('16127');
      expect(peer.key).to.equal('10.0.0.1:16127');
    });
  });

  describe('remove', () => {
    it('should delete from map and correct direction set, return removed peer', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      const removed = manager.remove('10.0.0.1:16127');

      expect(removed).to.equal(peer);
      expect(manager.has('10.0.0.1:16127')).to.equal(false);
      expect(manager.outboundCount).to.equal(0);
    });

    it('should return null for non-existent key', () => {
      const removed = manager.remove('1.2.3.4:16127');
      expect(removed).to.equal(null);
    });

    it('should not affect wrong direction set (no-op on other set)', () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');
      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(ws2, '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });

      manager.remove('10.0.0.1:16127');

      expect(manager.outboundCount).to.equal(0);
      expect(manager.inboundCount).to.equal(1);
    });

    it('should call trackDisconnect', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      sinon.spy(manager, 'trackDisconnect');

      manager.remove('10.0.0.1:16127');

      sinon.assert.calledOnce(manager.trackDisconnect);
      sinon.assert.calledWith(manager.trackDisconnect, '10.0.0.1', '16127');
    });
  });

  describe('has / get', () => {
    it('should return true/peer for existing key', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      expect(manager.has('10.0.0.1:16127')).to.equal(true);
      expect(manager.get('10.0.0.1:16127')).to.equal(peer);
    });

    it('should return false/undefined for non-existent key', () => {
      expect(manager.has('1.2.3.4:16127')).to.equal(false);
      expect(manager.get('1.2.3.4:16127')).to.equal(undefined);
    });
  });

  describe('iteration', () => {
    beforeEach(() => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.0.0.2', '16127'), '10.0.0.2', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.0.0.3', '16127'), '10.0.0.3', '16127', { source: PEER_SOURCE.INBOUND });
    });

    it('outboundValues should yield only outbound peers', () => {
      const outbound = [...manager.outboundValues()];
      expect(outbound).to.have.lengthOf(2);
      outbound.forEach((p) => expect(p.direction).to.equal('outbound'));
    });

    it('inboundValues should yield only inbound peers', () => {
      const inbound = [...manager.inboundValues()];
      expect(inbound).to.have.lengthOf(1);
      inbound.forEach((p) => expect(p.direction).to.equal('inbound'));
    });

    it('allValues should yield all peers', () => {
      const all = [...manager.allValues()];
      expect(all).to.have.lengthOf(3);
    });
  });

  describe('counts', () => {
    it('should return correct outboundCount, inboundCount, getNumberOfPeers', () => {
      expect(manager.outboundCount).to.equal(0);
      expect(manager.inboundCount).to.equal(0);
      expect(manager.getNumberOfPeers()).to.equal(0);

      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.0.0.2', '16127'), '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });
      manager.add(createMockWs('10.0.0.3', '16127'), '10.0.0.3', '16127', { source: PEER_SOURCE.RANDOM });

      expect(manager.outboundCount).to.equal(2);
      expect(manager.inboundCount).to.equal(1);
      expect(manager.getNumberOfPeers()).to.equal(3);
    });
  });

  describe('pingAll', () => {
    it('should call ping() on each peer', () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');
      ws1.readyState = WebSocket.OPEN;
      ws2.readyState = WebSocket.OPEN;

      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(ws2, '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });

      manager.pingAll();

      sinon.assert.calledOnce(ws1.ping);
      sinon.assert.calledOnce(ws2.ping);
    });
  });

  describe('onPingSent auto-close', () => {
    it('should close the connection when missedPongs reaches 3', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      peer.onPingSent(); // missedPongs = 1
      peer.onPingSent(); // missedPongs = 2
      sinon.assert.notCalled(ws.close);

      peer.onPingSent(); // missedPongs = 3 — should close
      sinon.assert.calledOnce(ws.close);
      sinon.assert.calledWith(ws.close, CLOSE_CODES.DEAD_CONNECTION, 'dead connection');
    });

    it('should not close if pongs are received', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      peer.onPingSent(); // missedPongs = 1
      peer.onPingSent(); // missedPongs = 2
      peer.onPongReceived(); // missedPongs = 0
      peer.onPingSent(); // missedPongs = 1
      peer.onPingSent(); // missedPongs = 2
      sinon.assert.notCalled(ws.close);
    });
  });

  describe('trackDisconnect / isUnstable', () => {
    it('should mark node unstable after threshold disconnects', () => {
      for (let i = 0; i < 5; i += 1) {
        manager.trackDisconnect('10.0.0.1', '16127');
      }

      expect(manager.isUnstable('10.0.0.1', '16127')).to.equal(true);
    });

    it('should not be unstable below threshold', () => {
      for (let i = 0; i < 4; i += 1) {
        manager.trackDisconnect('10.0.0.1', '16127');
      }

      expect(manager.isUnstable('10.0.0.1', '16127')).to.equal(false);
    });

    it('should return false when no tracking data exists', () => {
      expect(manager.isUnstable('10.0.0.1', '16127')).to.equal(false);
    });

    it('should return false when window expired', () => {
      // Manually set entry with expired window
      manager.setUnstableEntry('10.0.0.1:16127', {
        disconnects: 10,
        firstDisconnect: Date.now() - (3 * 60 * 60 * 1000), // 3 hours ago (beyond 2h window)
      });

      expect(manager.isUnstable('10.0.0.1', '16127')).to.equal(false);
      // Should also clean up expired entry
      expect(manager.hasUnstableEntry('10.0.0.1:16127')).to.equal(false);
    });

    it('trackDisconnect should reset when window expires', () => {
      manager.setUnstableEntry('10.0.0.1:16127', {
        disconnects: 10,
        firstDisconnect: Date.now() - (3 * 60 * 60 * 1000),
      });

      manager.trackDisconnect('10.0.0.1', '16127');

      const entry = manager.getUnstableEntry('10.0.0.1:16127');
      expect(entry.disconnects).to.equal(1);
    });
  });

  describe('pruneUnstableList', () => {
    it('should remove expired entries', () => {
      manager.setUnstableEntry('10.0.0.1:16127', {
        disconnects: 5,
        firstDisconnect: Date.now() - (3 * 60 * 60 * 1000), // expired
      });
      manager.setUnstableEntry('10.0.0.2:16127', {
        disconnects: 3,
        firstDisconnect: Date.now(), // not expired
      });

      manager.pruneUnstableList();

      expect(manager.hasUnstableEntry('10.0.0.1:16127')).to.equal(false);
      expect(manager.hasUnstableEntry('10.0.0.2:16127')).to.equal(true);
    });
  });

  describe('getRandomPeer', () => {
    it('should return a peer from the correct direction', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.0.0.2', '16127'), '10.0.0.2', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.0.0.3', '16127'), '10.0.0.3', '16127', { source: PEER_SOURCE.INBOUND });

      const outPeer = manager.getRandomPeer('outbound');
      expect(outPeer).to.be.instanceOf(FluxPeerSocket);
      expect(outPeer.direction).to.equal('outbound');

      const inPeer = manager.getRandomPeer('inbound');
      expect(inPeer).to.be.instanceOf(FluxPeerSocket);
      expect(inPeer.direction).to.equal('inbound');
    });

    it('should return null when no peers of that direction exist', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      const result = manager.getRandomPeer('inbound');
      expect(result).to.equal(null);
    });

    it('should return null when no peers at all', () => {
      expect(manager.getRandomPeer('outbound')).to.equal(null);
      expect(manager.getRandomPeer('inbound')).to.equal(null);
    });
  });

  describe('findByIp', () => {
    beforeEach(() => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.0.0.1', '16128'), '10.0.0.1', '16128', { source: PEER_SOURCE.INBOUND });
      manager.add(createMockWs('10.0.0.2', '16127'), '10.0.0.2', '16127', { source: PEER_SOURCE.RANDOM });
    });

    it('should find all peers matching IP when no direction filter', () => {
      const results = manager.findByIp('10.0.0.1');
      expect(results).to.have.lengthOf(2);
      results.forEach((p) => expect(p.ip).to.equal('10.0.0.1'));
    });

    it('should filter by direction when specified', () => {
      const outbound = manager.findByIp('10.0.0.1', 'outbound');
      expect(outbound).to.have.lengthOf(1);
      expect(outbound[0].direction).to.equal('outbound');

      const inbound = manager.findByIp('10.0.0.1', 'inbound');
      expect(inbound).to.have.lengthOf(1);
      expect(inbound[0].direction).to.equal('inbound');
    });

    it('should return empty array when no match', () => {
      const results = manager.findByIp('99.99.99.99');
      expect(results).to.deep.equal([]);
    });
  });

  describe('allPeersDown', () => {
    it('should return true when empty', () => {
      expect(manager.allPeersDown()).to.equal(true);
    });

    it('should return false when peers exist', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      expect(manager.allPeersDown()).to.equal(false);
    });
  });

  describe('getStats', () => {
    it('should return correct diagnostics', () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');
      const ws3 = createMockWs('10.0.0.3', '16127');

      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      const peer2 = manager.add(ws2, '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });
      manager.add(ws3, '10.0.0.3', '16127', { source: PEER_SOURCE.RANDOM });

      // Make one peer dead
      peer2.missedPongs = 5;

      // Add a reconnect entry and unstable entry
      manager.queueReconnect('10.0.0.4', '16127');
      manager.trackDisconnect('10.0.0.5', '16127');

      const stats = manager.getStats();
      expect(stats).to.deep.equal({
        inbound: 1,
        outbound: 2,
        total: 3,
        dead: 1,
        reconnectQueue: 1,
        unstable: 1,
        peerTopology: 0,
      });
    });

    it('should return zeroes when empty', () => {
      const stats = manager.getStats();
      expect(stats).to.deep.equal({
        inbound: 0,
        outbound: 0,
        total: 0,
        dead: 0,
        reconnectQueue: 0,
        unstable: 0,
        peerTopology: 0,
      });
    });
  });

  describe('reset', () => {
    it('should empty everything', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.0.0.2', '16127'), '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });
      manager.queueReconnect('10.0.0.3', '16127');
      manager.trackDisconnect('10.0.0.4', '16127');

      manager.reset();

      expect(manager.getNumberOfPeers()).to.equal(0);
      expect(manager.outboundCount).to.equal(0);
      expect(manager.inboundCount).to.equal(0);
      expect(manager.getReconnectQueue().size).to.equal(0);
      expect(manager.unstableCount).to.equal(0);
    });
  });

  describe('broadcast', () => {
    it('should send data to all peers when no direction specified', async () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');
      const ws3 = createMockWs('10.0.0.3', '16127');
      ws1.readyState = 1; // WebSocket.OPEN
      ws2.readyState = 1;
      ws3.readyState = 1;
      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(ws2, '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });
      manager.add(ws3, '10.0.0.3', '16127', { source: PEER_SOURCE.RANDOM });

      await manager.broadcast('hello');

      sinon.assert.calledOnce(ws1.send);
      sinon.assert.calledOnce(ws2.send);
      sinon.assert.calledOnce(ws3.send);
    });

    it('should send only to outbound when direction is outbound', async () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');
      ws1.readyState = 1;
      ws2.readyState = 1;
      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(ws2, '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });

      await manager.broadcast('hello', { direction: 'outbound' });

      sinon.assert.calledOnce(ws1.send);
      sinon.assert.notCalled(ws2.send);
    });

    it('should send only to inbound when direction is inbound', async () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');
      ws1.readyState = 1;
      ws2.readyState = 1;
      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(ws2, '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });

      await manager.broadcast('hello', { direction: 'inbound' });

      sinon.assert.notCalled(ws1.send);
      sinon.assert.calledOnce(ws2.send);
    });

    it('should skip excluded peer', async () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');
      ws1.readyState = 1;
      ws2.readyState = 1;
      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(ws2, '10.0.0.2', '16127', { source: PEER_SOURCE.RANDOM });

      await manager.broadcast('hello', { exclude: '10.0.0.1:16127' });

      sinon.assert.notCalled(ws1.send);
      sinon.assert.calledOnce(ws2.send);
    });

    it('should close peer with correct code on send failure', async () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');
      ws1.readyState = WebSocket.CLOSED; // will fail to send
      ws2.readyState = 1;
      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(ws2, '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });

      await manager.broadcast('hello');

      // outbound peer closed with 4009
      sinon.assert.calledOnce(ws1.close);
      sinon.assert.calledWith(ws1.close, 4009, 'send failure');
      // inbound peer sent successfully
      sinon.assert.calledOnce(ws2.send);
    });

    it('should close inbound peer with 4010 on send failure', async () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      ws1.readyState = WebSocket.CLOSED;
      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.INBOUND });

      await manager.broadcast('hello');

      sinon.assert.calledOnce(ws1.close);
      sinon.assert.calledWith(ws1.close, 4010, 'send failure');
    });
  });

  describe('getIpGroup', () => {
    it('should return first two octets', () => {
      expect(FluxPeerManager.getIpGroup('192.168.1.1')).to.equal('192.168');
      expect(FluxPeerManager.getIpGroup('10.0.0.1')).to.equal('10.0');
      expect(FluxPeerManager.getIpGroup('172.16.5.200')).to.equal('172.16');
    });

    it('should return ip as-is for non-standard formats', () => {
      expect(FluxPeerManager.getIpGroup('localhost')).to.equal('localhost');
    });
  });

  describe('IP group tracking', () => {
    it('should track IP groups on add and remove', () => {
      const ws1 = createMockWs('192.168.1.1', '16127');
      const ws2 = createMockWs('192.168.1.2', '16128');
      manager.add(ws1, '192.168.1.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(ws2, '192.168.1.2', '16128', { source: PEER_SOURCE.RANDOM });

      expect(manager.isIpGroupConnected('192.168', 'outbound')).to.equal(true);
      expect(manager.isIpGroupConnected('192.168', 'inbound')).to.equal(false);
      expect(manager.getUniqueIpCount('outbound')).to.equal(2);

      manager.remove('192.168.1.1:16127');

      expect(manager.isIpGroupConnected('192.168', 'outbound')).to.equal(true); // still have .1.2
      expect(manager.getUniqueIpCount('outbound')).to.equal(1);

      manager.remove('192.168.1.2:16128');

      expect(manager.isIpGroupConnected('192.168', 'outbound')).to.equal(false);
      expect(manager.getUniqueIpCount('outbound')).to.equal(0);
    });

    it('should track different directions independently', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.0.0.2', '16127'), '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });

      expect(manager.isIpGroupConnected('10.0', 'outbound')).to.equal(true);
      expect(manager.isIpGroupConnected('10.0', 'inbound')).to.equal(true);
      expect(manager.getUniqueIpCount('outbound')).to.equal(1);
      expect(manager.getUniqueIpCount('inbound')).to.equal(1);
    });

    it('getConnectedIpGroups should return set of groups', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('172.16.0.1', '16127'), '172.16.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('192.168.1.1', '16127'), '192.168.1.1', '16127', { source: PEER_SOURCE.INBOUND });

      const outGroups = manager.getConnectedIpGroups('outbound');
      expect(outGroups).to.deep.equal(new Set(['10.0', '172.16']));

      const inGroups = manager.getConnectedIpGroups('inbound');
      expect(inGroups).to.deep.equal(new Set(['192.168']));
    });
  });

  describe('needsMorePeers', () => {
    it('should return true when below max count', () => {
      expect(manager.needsMorePeers('outbound')).to.equal(true);
    });

    it('should return true when at max count but below unique IP threshold', () => {
      // Add 14 outbound peers all from same IP (different ports)
      for (let i = 0; i < 14; i += 1) {
        const port = String(16127 + i);
        manager.add(createMockWs('10.0.0.1', port), '10.0.0.1', port, { source: PEER_SOURCE.RANDOM });
      }
      expect(manager.outboundCount).to.equal(14);
      expect(manager.getUniqueIpCount('outbound')).to.equal(1);
      // Still needs more because uniqueIps (1) < minUniqueIps (9)
      expect(manager.needsMorePeers('outbound')).to.equal(true);
    });

    it('should return false when both thresholds met', () => {
      // Add 14 outbound peers with 9+ unique IPs
      for (let i = 0; i < 14; i += 1) {
        const ip = `10.${i}.0.1`;
        const port = '16127';
        manager.add(createMockWs(ip, port), ip, port, { source: PEER_SOURCE.RANDOM });
      }
      expect(manager.outboundCount).to.equal(14);
      expect(manager.getUniqueIpCount('outbound')).to.equal(14);
      expect(manager.needsMorePeers('outbound')).to.equal(false);
    });

    it('should use custom thresholds', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.1.0.1', '16127'), '10.1.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      expect(manager.needsMorePeers('outbound', { maxCount: 2, minUniqueIps: 2 })).to.equal(false);
      expect(manager.needsMorePeers('outbound', { maxCount: 3, minUniqueIps: 2 })).to.equal(true);
    });
  });

  describe('canAcceptPeer', () => {
    it('should reject already connected peer', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      expect(manager.canAcceptPeer('10.0.0.1', '16127', 'outbound', '192.168')).to.equal(false);
    });

    it('should reject peer in same IP group as self', () => {
      expect(manager.canAcceptPeer('192.168.1.5', '16127', 'outbound', '192.168')).to.equal(false);
    });

    it('should reject peer whose IP group already has a connection in that direction', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      // Same /16 group (10.0), different IP
      expect(manager.canAcceptPeer('10.0.0.2', '16127', 'outbound', '192.168')).to.equal(false);
    });

    it('should accept peer in different IP group with no conflicts', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      expect(manager.canAcceptPeer('172.16.0.1', '16127', 'outbound', '192.168')).to.equal(true);
    });

    it('should allow same IP group in different direction', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      // Same group but inbound direction — allowed
      expect(manager.canAcceptPeer('10.0.0.2', '16127', 'inbound', '192.168')).to.equal(true);
    });
  });


  describe('validateAndAddInbound', () => {
    it('should add valid inbound peer', () => {
      manager.numberOfFluxNodes = 10000;
      const ws = createMockWs('8.8.8.8', '16127');
      ws.close = sinon.stub();

      manager.validateAndAddInbound(ws, '16127', createMockReq('8.8.8.8'));

      expect(manager.inboundCount).to.equal(1);
      expect(manager.has('8.8.8.8:16127')).to.equal(true);
    });

    it('should use default port 16127 when not provided', () => {
      manager.numberOfFluxNodes = 10000;
      const ws = createMockWs('8.8.8.8', '16127');

      manager.validateAndAddInbound(ws, createMockReq('8.8.8.8'));

      expect(manager.has('8.8.8.8:16127')).to.equal(true);
    });

    it('should reject when max connections reached', (done) => {
      manager.numberOfFluxNodes = 0; // maxCon = max(4*minIncoming, 0) = 4*minIncoming
      // Fill up inbound to exceed max
      for (let i = 0; i < 200; i += 1) {
        const ip = `${100 + Math.floor(i / 256)}.${i % 256}.0.1`;
        manager.add(createMockWs(ip, '16127'), ip, '16127', { source: PEER_SOURCE.INBOUND });
      }

      const ws = createMockWs('8.8.8.8', '16127');
      ws.close = sinon.stub();

      manager.validateAndAddInbound(ws, '16127', createMockReq('8.8.8.8'));

      // Close is called via setTimeout
      setTimeout(() => {
        sinon.assert.calledOnce(ws.close);
        sinon.assert.calledWith(ws.close, 4000, sinon.match(/Max number/));
        done();
      }, 1100);
    });

    it('should reject private IPs', (done) => {
      manager.numberOfFluxNodes = 10000;
      const ws = createMockWs('10.0.0.1', '16127');
      ws.close = sinon.stub();

      manager.validateAndAddInbound(ws, '16127', createMockReq('10.0.0.1'));

      setTimeout(() => {
        sinon.assert.calledOnce(ws.close);
        sinon.assert.calledWith(ws.close, 4002, sinon.match(/internal IP/));
        expect(manager.inboundCount).to.equal(0);
        done();
      }, 1100);
    });

    it('should reject duplicate peers', (done) => {
      manager.numberOfFluxNodes = 10000;
      const ws1 = createMockWs('8.8.8.8', '16127');
      manager.add(ws1, '8.8.8.8', '16127', { source: PEER_SOURCE.INBOUND });

      const ws2 = createMockWs('8.8.8.8', '16127');
      ws2.close = sinon.stub();

      manager.validateAndAddInbound(ws2, '16127', createMockReq('8.8.8.8'));

      setTimeout(() => {
        sinon.assert.calledOnce(ws2.close);
        sinon.assert.calledWith(ws2.close, CLOSE_CODES.DUPLICATE_PEER, sinon.match(/already connected/));
        expect(manager.inboundCount).to.equal(1);
        done();
      }, 1100);
    });

    it('should extract IPv4 from IPv6-mapped address', () => {
      manager.numberOfFluxNodes = 10000;
      const ws = createMockWs('8.8.8.8', '16127');

      manager.validateAndAddInbound(ws, '16127', createMockReq('::ffff:8.8.8.8'));

      expect(manager.has('8.8.8.8:16127')).to.equal(true);
    });
  });

  describe('getReconnectCandidates', () => {
    it('should return queued entries with ≤3 attempts', () => {
      manager.queueReconnect('10.0.0.1', '16127');
      manager.queueReconnect('10.1.0.1', '16127');

      const candidates = manager.getReconnectCandidates();
      expect(candidates).to.have.lengthOf(2);
      expect(candidates[0].key).to.equal('10.0.0.1:16127');
      expect(candidates[1].key).to.equal('10.1.0.1:16127');
    });

    it('should exclude already connected peers and clean up', () => {
      manager.queueReconnect('10.0.0.1', '16127');
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      const candidates = manager.getReconnectCandidates();
      expect(candidates).to.have.lengthOf(0);
      expect(manager.getReconnectQueue().has('10.0.0.1:16127')).to.equal(false);
    });

    it('should exclude unstable peers and clean up', () => {
      manager.queueReconnect('10.0.0.1', '16127');
      // Make unstable
      for (let i = 0; i < 5; i += 1) {
        manager.trackDisconnect('10.0.0.1', '16127');
      }

      const candidates = manager.getReconnectCandidates();
      expect(candidates).to.have.lengthOf(0);
      expect(manager.getReconnectQueue().has('10.0.0.1:16127')).to.equal(false);
    });

    it('should exclude entries with >3 attempts and clean up', () => {
      manager.queueReconnect('10.0.0.1', '16127');
      manager.queueReconnect('10.0.0.1', '16127');
      manager.queueReconnect('10.0.0.1', '16127');
      manager.queueReconnect('10.0.0.1', '16127'); // 4th attempt

      const candidates = manager.getReconnectCandidates();
      expect(candidates).to.have.lengthOf(0);
      expect(manager.getReconnectQueue().has('10.0.0.1:16127')).to.equal(false);
    });
  });

  describe('failed connection tracking', () => {
    it('should allow first connection attempt', () => {
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(true);
    });

    it('should block attempt during backoff window', () => {
      manager.recordFailedConnection('10.0.0.1', '16127');
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(false);
    });

    it('should allow attempt after backoff expires', () => {
      manager.recordFailedConnection('10.0.0.1', '16127');
      // Manually set lastAttempt to 3 minutes ago (beyond 2min first backoff)
      manager.getFailedConnection('10.0.0.1:16127').lastAttempt = Date.now() - (3 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(true);
    });

    it('should increase backoff on subsequent failures', () => {
      manager.recordFailedConnection('10.0.0.1', '16127');
      manager.recordFailedConnection('10.0.0.1', '16127');
      // Second failure: 5min backoff. 3 minutes ago should still be blocked.
      manager.getFailedConnection('10.0.0.1:16127').lastAttempt = Date.now() - (3 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(false);
      // 6 minutes ago should be allowed
      manager.getFailedConnection('10.0.0.1:16127').lastAttempt = Date.now() - (6 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(true);
    });

    it('should cap backoff at 15 minutes', () => {
      for (let i = 0; i < 10; i += 1) {
        manager.recordFailedConnection('10.0.0.1', '16127');
      }
      // 14 minutes ago — should still be blocked (cap is 15min)
      manager.getFailedConnection('10.0.0.1:16127').lastAttempt = Date.now() - (14 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(false);
      // 16 minutes ago — should be allowed
      manager.getFailedConnection('10.0.0.1:16127').lastAttempt = Date.now() - (16 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(true);
    });

    it('should return false for already connected peers', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(false);
    });

    it('should clear failed connection on successful add', () => {
      manager.recordFailedConnection('10.0.0.1', '16127');
      expect(manager.hasFailedConnection('10.0.0.1:16127')).to.equal(true);

      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      expect(manager.hasFailedConnection('10.0.0.1:16127')).to.equal(false);
    });
  });

  describe('shouldReconnect (static)', () => {
    it('should return true for no close code (unexpected disconnect)', () => {
      expect(FluxPeerManager.shouldReconnect(undefined)).to.equal(true);
      expect(FluxPeerManager.shouldReconnect(null)).to.equal(true);
      expect(FluxPeerManager.shouldReconnect(0)).to.equal(true);
    });

    it('should return true for standard WebSocket close codes', () => {
      expect(FluxPeerManager.shouldReconnect(1000)).to.equal(true); // normal
      expect(FluxPeerManager.shouldReconnect(1001)).to.equal(true); // going away
      expect(FluxPeerManager.shouldReconnect(1006)).to.equal(true); // abnormal
    });

    it('should return true for DEAD_CONNECTION', () => {
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.DEAD_CONNECTION)).to.equal(true);
    });

    it('should return true for MAX_CONNECTIONS', () => {
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.MAX_CONNECTIONS)).to.equal(true);
    });

    it('should return false for DUPLICATE_PEER', () => {
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.DUPLICATE_PEER)).to.equal(false);
    });

    it('should return false for policy violations', () => {
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.BLOCKED_INBOUND)).to.equal(false);
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.BLOCKED_OUTBOUND)).to.equal(false);
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.BAD_ORIGIN_INBOUND)).to.equal(false);
    });

    it('should return false for purposeful closes', () => {
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.CLOSED_OUTBOUND)).to.equal(false);
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.CLOSED_INBOUND)).to.equal(false);
    });

    it('should return false for auth failures', () => {
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.AUTH_FAILURE_1)).to.equal(false);
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.AUTH_FAILURE_4)).to.equal(false);
    });

    it('should return false for invalid messages', () => {
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.INVALID_MSG_INBOUND)).to.equal(false);
      expect(FluxPeerManager.shouldReconnect(CLOSE_CODES.INVALID_MSG_OUTBOUND)).to.equal(false);
    });
  });

  describe('remove reconnect integration', () => {
    it('should queue reconnect for outbound dead connection', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      manager.remove('10.0.0.1:16127', CLOSE_CODES.DEAD_CONNECTION);

      expect(manager.getReconnectQueue().has('10.0.0.1:16127')).to.equal(true);
    });

    it('should NOT queue reconnect for outbound duplicate rejection', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      manager.remove('10.0.0.1:16127', CLOSE_CODES.DUPLICATE_PEER);

      expect(manager.getReconnectQueue().has('10.0.0.1:16127')).to.equal(false);
    });

    it('should NOT queue reconnect for inbound peers regardless of code', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.INBOUND });

      manager.remove('10.0.0.1:16127', CLOSE_CODES.DEAD_CONNECTION);

      expect(manager.getReconnectQueue().has('10.0.0.1:16127')).to.equal(false);
    });
  });

  describe('pending connections', () => {
    it('should track pending state', () => {
      expect(manager.isPending('10.0.0.1:16127')).to.equal(false);
      manager.markPending('10.0.0.1:16127');
      expect(manager.isPending('10.0.0.1:16127')).to.equal(true);
      manager.clearPending('10.0.0.1:16127');
      expect(manager.isPending('10.0.0.1:16127')).to.equal(false);
    });

    it('should clear pending on successful add', () => {
      manager.markPending('10.0.0.1:16127');
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      expect(manager.isPending('10.0.0.1:16127')).to.equal(false);
    });

    it('should be cleared by reset', () => {
      manager.markPending('10.0.0.1:16127');
      manager.reset();
      expect(manager.isPending('10.0.0.1:16127')).to.equal(false);
    });
  });

  describe('add with existing peer', () => {
    it('should replace existing peer and close old socket', () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.1', '16127');
      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      const newPeer = manager.add(ws2, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      expect(newPeer.ws).to.equal(ws2);
      expect(manager.getNumberOfPeers()).to.equal(1);
      sinon.assert.calledOnce(ws1.close);
    });

    it('should detach old handlers to prevent interference', () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      manager.add(ws1, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      const ws2 = createMockWs('10.0.0.1', '16127');
      manager.add(ws2, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      // Old socket's handlers should be nulled
      expect(ws1.onclose).to.equal(null);
      expect(ws1.onerror).to.equal(null);
      expect(ws1.onmessage).to.equal(null);
    });
  });

  describe('validateAndAddInbound stale replacement', () => {
    it('should replace stale connection instead of rejecting', () => {
      manager.numberOfFluxNodes = 10000;
      const ws1 = createMockWs('8.8.8.8', '16127');
      const peer1 = manager.add(ws1, '8.8.8.8', '16127', { source: PEER_SOURCE.INBOUND });
      // Make stale
      peer1.missedPongs = 5;
      ws1.readyState = 3; // CLOSED

      const ws2 = createMockWs('8.8.8.8', '16127');
      manager.validateAndAddInbound(ws2, '16127', createMockReq('8.8.8.8'));

      expect(manager.has('8.8.8.8:16127')).to.equal(true);
      const current = manager.get('8.8.8.8:16127');
      expect(current.ws).to.equal(ws2);
    });
  });

  describe('verifyOrReplace (reconnect duplicate handling)', () => {
    it('should replace existing connection when pong does not arrive within timeout', (done) => {
      manager.numberOfFluxNodes = 10000;
      const ws1 = createMockWs('8.8.8.8', '16127');
      manager.add(ws1, '8.8.8.8', '16127', { source: PEER_SOURCE.INBOUND });

      const ws2 = createMockWs('8.8.8.8', '16127');
      const req = createMockReq('8.8.8.8', { 'x-flux-reconnect': 'true' });
      manager.validateAndAddInbound(ws2, '16127', req);

      // Don't send a pong — wait for timeout to replace
      setTimeout(() => {
        const current = manager.get('8.8.8.8:16127');
        expect(current.ws).to.equal(ws2);
        done();
      }, 1200);
    });

    it('should reject new connection when existing responds to pong', (done) => {
      manager.numberOfFluxNodes = 10000;
      const ws1 = createMockWs('8.8.8.8', '16127');
      manager.add(ws1, '8.8.8.8', '16127', { source: PEER_SOURCE.INBOUND });

      const ws2 = createMockWs('8.8.8.8', '16127');
      const req = createMockReq('8.8.8.8', { 'x-flux-reconnect': 'true' });
      manager.validateAndAddInbound(ws2, '16127', req);

      // Simulate pong coming back quickly
      setTimeout(() => {
        ws1.emit('pong');
      }, 50);

      setTimeout(() => {
        const current = manager.get('8.8.8.8:16127');
        expect(current.ws).to.equal(ws1);
        expect(ws2.close.calledWith(CLOSE_CODES.DUPLICATE_PEER)).to.equal(true);
        done();
      }, 200);
    });

    it('should replace immediately when ping throws', () => {
      manager.numberOfFluxNodes = 10000;
      const ws1 = createMockWs('8.8.8.8', '16127');
      ws1.ping = sinon.stub().throws(new Error('socket dead'));
      manager.add(ws1, '8.8.8.8', '16127', { source: PEER_SOURCE.INBOUND });

      const ws2 = createMockWs('8.8.8.8', '16127');
      const req = createMockReq('8.8.8.8', { 'x-flux-reconnect': 'true' });
      manager.validateAndAddInbound(ws2, '16127', req);

      const current = manager.get('8.8.8.8:16127');
      expect(current.ws).to.equal(ws2);
    });

    it('should reject immediately when no X-Flux-Reconnect header', () => {
      manager.numberOfFluxNodes = 10000;
      const ws1 = createMockWs('8.8.8.8', '16127');
      manager.add(ws1, '8.8.8.8', '16127', { source: PEER_SOURCE.INBOUND });

      const ws2 = createMockWs('8.8.8.8', '16127');
      const req = createMockReq('8.8.8.8');
      manager.validateAndAddInbound(ws2, '16127', req);

      // Should still have old connection
      const current = manager.get('8.8.8.8:16127');
      expect(current.ws).to.equal(ws1);
    });
  });

  describe('peer history', () => {
    let manager;

    beforeEach(() => {
      manager = new FluxPeerManager();
    });

    afterEach(() => {
      manager.reset();
    });

    it('should record connected events on add', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      const history = manager.getHistory();
      expect(history).to.have.lengthOf(1);
      expect(history[0].event).to.equal('connected');
      expect(history[0].ip).to.equal('10.0.0.1');
      expect(history[0].port).to.equal('16127');
      expect(history[0].direction).to.equal('outbound');
      expect(history[0].timestamp).to.be.a('number');
    });

    it('should record disconnected events on remove with close code details', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.remove('10.0.0.1:16127', 4004);

      const history = manager.getHistory();
      expect(history).to.have.lengthOf(2);
      const disc = history[1];
      expect(disc.event).to.equal('disconnected');
      expect(disc.closeCode).to.equal(4004);
      expect(disc.closeCodeName).to.equal('BAD_ORIGIN_INBOUND');
      expect(disc.duration).to.be.a('number');
      expect(disc.latency).to.equal(null);
      expect(disc.missedPongs).to.equal(0);
    });

    it('should wrap around when buffer is full', () => {
      // Fill buffer beyond capacity
      for (let i = 0; i < 1005; i += 1) {
        const ip = `10.0.${Math.floor(i / 256)}.${i % 256}`;
        const ws = createMockWs(ip);
        manager.add(ws, ip, '16127', { source: PEER_SOURCE.RANDOM });
      }

      const history = manager.getHistory();
      expect(history).to.have.lengthOf(1000);
      // Oldest should be event 6 (index 5), newest should be event 1005 (index 1004)
      expect(history[0].timestamp).to.be.lessThan(history[999].timestamp);
    });

    it('should return empty array when no events', () => {
      expect(manager.getHistory()).to.deep.equal([]);
    });

    it('should be cleared by reset', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.reset();
      expect(manager.getHistory()).to.deep.equal([]);
    });
  });

  describe('singleton export', () => {
    it('peerManager should be an instance of FluxPeerManager', () => {
      expect(peerManager).to.be.instanceOf(FluxPeerManager);
    });
  });

  describe('per-peer metrics', () => {
    describe('message and byte counters', () => {
      it('should initialize counters to zero', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        expect(peer.messagesReceived).to.equal(0);
        expect(peer.messagesSent).to.equal(0);
        expect(peer.bytesReceived).to.equal(0);
        expect(peer.bytesSent).to.equal(0);
      });

      it('should increment messagesReceived and bytesReceived on ws.onmessage', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const data = '{"type":"test"}';
        ws.onmessage({ data });
        expect(peer.messagesReceived).to.equal(1);
        expect(peer.bytesReceived).to.equal(Buffer.byteLength(data, 'utf8'));
      });

      it('should increment messagesSent and bytesSent on send()', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const payload = '{"type":"hello"}';
        peer.send(payload);
        expect(peer.messagesSent).to.equal(1);
        expect(peer.bytesSent).to.equal(Buffer.byteLength(payload, 'utf8'));
      });

      it('should track bytes including transmission timestamp prefix', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        peer.remoteCapabilities.add('transmissionTimestamps');
        const payload = '{"type":"hello"}';
        peer.send(payload);
        expect(peer.messagesSent).to.equal(1);
        // bytesSent should include the T{timestamp}| prefix
        expect(peer.bytesSent).to.be.greaterThan(Buffer.byteLength(payload, 'utf8'));
      });
    });

    describe('remoteVersion', () => {
      it('should default to null', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        expect(peer.remoteVersion).to.be.null;
      });

      it('should set remoteVersion from options', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM, remoteVersion: '8.8.0' });
        expect(peer.remoteVersion).to.equal('8.8.0');
      });

      it('should not set remoteVersion for empty string', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM, remoteVersion: '' });
        expect(peer.remoteVersion).to.be.null;
      });
    });

    describe('reconnect count', () => {
      it('should start at zero for new peers', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        expect(peer.reconnects).to.equal(0);
      });

      it('should increment on RECONNECT source', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RECONNECT });
        expect(peer.reconnects).to.equal(1);
      });

      it('should increment when replacing an existing peer', () => {
        const ws1 = createMockWs('44.0.0.1');
        manager.add(ws1, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

        const ws2 = createMockWs('44.0.0.1');
        const peer2 = manager.add(ws2, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        expect(peer2.reconnects).to.equal(1);
      });

      it('should accumulate across multiple reconnects', () => {
        const ws1 = createMockWs('44.0.0.1');
        manager.add(ws1, '44.0.0.1', '16127', { source: PEER_SOURCE.RECONNECT });

        const ws2 = createMockWs('44.0.0.1');
        const peer2 = manager.add(ws2, '44.0.0.1', '16127', { source: PEER_SOURCE.RECONNECT });
        expect(peer2.reconnects).to.equal(2);
      });

      it('should be cleared by reset()', () => {
        const ws = createMockWs('44.0.0.1');
        manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RECONNECT });
        manager.reset();
        expect(manager.reconnectCountsSize).to.equal(0);
      });
    });

    describe('disconnect history includes counters', () => {
      it('should record message/byte counters in disconnect event', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const payload = '{"type":"test"}';
        peer.send(payload);
        manager.remove(peer.key, 1000);
        const history = manager.getHistory();
        const disconnectEvent = history.find((e) => e.event === 'disconnected' && e.ip === '44.0.0.1');
        expect(disconnectEvent).to.exist;
        expect(disconnectEvent.messagesSent).to.equal(1);
        expect(disconnectEvent.bytesSent).to.equal(Buffer.byteLength(payload, 'utf8'));
        expect(disconnectEvent.messagesReceived).to.equal(0);
        expect(disconnectEvent.bytesReceived).to.equal(0);
      });
    });
  });

  describe('peer exchange', () => {


    describe('sendPeerExchange', () => {
      it('should send peer list to capable peer (binary)', () => {
        const ws1 = createMockWs('44.0.0.1');
        manager.add(ws1, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const ws2 = createMockWs('45.0.0.1');
        const peer2 = manager.add(ws2, '45.0.0.1', '16127', {
          source: PEER_SOURCE.RANDOM,
          remoteCapabilities: ['peerExchange', 'binaryMessages'],
        });
        // sendPeerExchange is called inside add(), check ws2 received a binary buffer
        const sendCalls = ws2.send.getCalls();
        const binaryCall = sendCalls.find((c) => Buffer.isBuffer(c.args[0]) && c.args[0][0] === peerCodec.MSG_TYPE.PEER_EXCHANGE);
        expect(binaryCall).to.exist;
        const decoded = peerCodec.decodePeerExchange(binaryCall.args[0]);
        // First peer was added as outbound (RANDOM source)
        expect(decoded.outbound).to.include('44.0.0.1:16127');
        expect(decoded.outbound).to.not.include(peer2.key);
        expect(decoded.inbound).to.not.include(peer2.key);
      });

      it('should send JSON to peer with peerExchange but without binaryMessages', () => {
        const ws1 = createMockWs('44.0.0.1');
        manager.add(ws1, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const ws2 = createMockWs('45.0.0.1');
        manager.add(ws2, '45.0.0.1', '16127', {
          source: PEER_SOURCE.RANDOM,
          remoteCapabilities: ['peerExchange'],
        });
        const sendCalls = ws2.send.getCalls();
        const jsonCall = sendCalls.find((c) => typeof c.args[0] === 'string' && c.args[0].includes('peerExchange'));
        expect(jsonCall).to.exist;
        const parsed = JSON.parse(jsonCall.args[0]);
        expect(parsed.type).to.equal('peerExchange');
        expect(parsed.outbound).to.include('44.0.0.1:16127');
      });

      it('should not send to peer without peerExchange capability', () => {
        const ws1 = createMockWs('44.0.0.1');
        manager.add(ws1, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const ws2 = createMockWs('45.0.0.1');
        manager.add(ws2, '45.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        // ws2 should not have received any peerExchange
        const sendCalls = ws2.send.getCalls();
        const exchangeCall = sendCalls.find((c) => {
          if (Buffer.isBuffer(c.args[0])) return c.args[0][0] === peerCodec.MSG_TYPE.PEER_EXCHANGE;
          if (typeof c.args[0] === 'string') return c.args[0].includes('peerExchange');
          return false;
        });
        expect(exchangeCall).to.be.undefined;
      });
    });

    describe('handlePeerExchange', () => {
      it('should store topology from reporter', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', {
          source: PEER_SOURCE.RANDOM,
          remoteCapabilities: ['peerExchange'],
        });
        manager.handlePeerExchange(peer, ['50.0.0.1:16127'], ['50.0.0.2:16127']);
        expect(manager.hasTopologyEntry(peer.key)).to.be.true;
        const entry = manager.getTopologyEntry(peer.key);
        expect(entry.outbound.size).to.equal(1);
        expect(entry.inbound.size).to.equal(1);
        expect(entry.outbound.has('50.0.0.1:16127')).to.be.true;
        expect(entry.inbound.has('50.0.0.2:16127')).to.be.true;
      });

      it('should enforce max peers cap per direction', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const bigOut = [];
        const bigIn = [];
        for (let i = 0; i < 100; i++) bigOut.push(`50.0.${i % 256}.${i}:16127`);
        for (let i = 0; i < 100; i++) bigIn.push(`20.0.${i % 256}.${i}:16127`);
        manager.handlePeerExchange(peer, bigOut, bigIn);
        const entry = manager.getTopologyEntry(peer.key);
        expect(entry.outbound.size).to.equal(60);
        expect(entry.inbound.size).to.equal(60);
      });

      it('should notify listeners', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const events = [];
        manager.onPeerTopologyChange((evt) => events.push(evt));
        manager.handlePeerExchange(peer, ['50.0.0.1:16127'], []);
        expect(events).to.have.length(1);
        expect(events[0].type).to.equal('exchange');
        expect(events[0].reporter).to.equal(peer.key);
      });
    });

    describe('handlePeerUpdate', () => {
      it('should add and remove peers incrementally with direction', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        manager.handlePeerExchange(peer, ['50.0.0.1:16127'], ['50.0.0.2:16127']);
        manager.handlePeerUpdate(peer, ['50.0.0.3:16127'], ['50.0.0.4:16127'], ['50.0.0.1:16127']);
        const entry = manager.getTopologyEntry(peer.key);
        expect(entry.outbound.has('50.0.0.3:16127')).to.be.true;
        expect(entry.inbound.has('50.0.0.4:16127')).to.be.true;
        expect(entry.outbound.has('50.0.0.1:16127')).to.be.false;
        expect(entry.inbound.has('50.0.0.2:16127')).to.be.true;
      });

      it('should ignore update without prior exchange', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        manager.handlePeerUpdate(peer, ['50.0.0.1:16127'], [], []);
        expect(manager.hasTopologyEntry(peer.key)).to.be.false;
      });
    });

    describe('knownPeers', () => {
      it('should compute union across reporters', () => {
        const ws1 = createMockWs('44.0.0.1');
        const peer1 = manager.add(ws1, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const ws2 = createMockWs('45.0.0.1');
        const peer2 = manager.add(ws2, '45.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        manager.handlePeerExchange(peer1, ['50.0.0.1:16127'], ['50.0.0.2:16127']);
        manager.handlePeerExchange(peer2, ['50.0.0.2:16127'], ['50.0.0.3:16127']);
        const known = manager.knownPeers;
        expect(known.size).to.equal(3);
        expect(known.has('50.0.0.1:16127')).to.be.true;
        expect(known.has('50.0.0.2:16127')).to.be.true;
        expect(known.has('50.0.0.3:16127')).to.be.true;
      });
    });

    describe('onPeerTopologyChange', () => {
      it('should call listener and support unsubscribe', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const events = [];
        const unsub = manager.onPeerTopologyChange((evt) => events.push(evt));
        manager.handlePeerExchange(peer, ['50.0.0.1:16127'], []);
        expect(events).to.have.length(1);
        unsub();
        manager.handlePeerExchange(peer, ['50.0.0.2:16127'], []);
        expect(events).to.have.length(1); // no new event after unsub
      });
    });

    describe('remove() topology cleanup', () => {
      it('should delete topology entry on peer disconnect', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        manager.handlePeerExchange(peer, ['50.0.0.1:16127'], []);
        expect(manager.hasTopologyEntry(peer.key)).to.be.true;
        manager.remove(peer.key, 1000);
        expect(manager.hasTopologyEntry(peer.key)).to.be.false;
      });
    });

    describe('schedulePeerUpdate debounce', () => {
      it('should batch add+remove that cancel out', function batchTest(done) {
        this.timeout(5000);
        const ws1 = createMockWs('44.0.0.1');
        manager.add(ws1, '44.0.0.1', '16127', {
          source: PEER_SOURCE.RANDOM,
          remoteCapabilities: ['peerExchange', 'binaryMessages'],
        });
        // Cancel the timer from add() and clear pending state
        manager.cancelPendingUpdate();
        ws1.send.resetHistory();
        // Simulate add then immediate remove of the same peer — should cancel out
        manager.injectPendingUpdate(['99.99.99.99:16127'], [], ['99.99.99.99:16127']);
        setTimeout(() => {
          const updateCalls = ws1.send.getCalls().filter((c) => {
            if (Buffer.isBuffer(c.args[0])) return c.args[0][0] === peerCodec.MSG_TYPE.PEER_UPDATE;
            return false;
          });
          expect(updateCalls).to.have.length(0);
          done();
        }, 2500);
      });
    });

    describe('reset() cleanup', () => {
      it('should reset all peer exchange structures', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        manager.handlePeerExchange(peer, ['50.0.0.1:16127'], []);
        manager.onPeerTopologyChange(() => {});
        manager.reset();
        expect(manager.peerTopologySize).to.equal(0);
        expect(manager.peerExchangeListenerCount).to.equal(0);
        const state = manager.getPendingUpdateState();
        expect(state.pendingAddsOutboundSize).to.equal(0);
        expect(state.pendingAddsInboundSize).to.equal(0);
        expect(state.pendingRemovesSize).to.equal(0);
        expect(state.hasPeerUpdateTimer).to.be.false;
      });
    });
  });

  describe('binary message handling', () => {


    describe('handleBinaryMessage', () => {
      it('should dispatch HASH_PRESENT to hashHandlers', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const hexHash = 'abcdef0123456789abcdef0123456789abcdef01';
        let received = null;
        manager.hashHandlers = {
          handleHashPresent: (p, h) => { received = { peer: p, hash: h }; },
          handleHashRequest: () => {},
        };
        manager.handleBinaryMessage(peer, peerCodec.encodeHashPresent(hexHash));
        expect(received).to.not.be.null;
        expect(received.hash).to.equal(hexHash);
        expect(received.peer).to.equal(peer);
      });

      it('should dispatch HASH_REQUEST to hashHandlers', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const hexHash = 'abcdef0123456789abcdef0123456789abcdef01';
        let received = null;
        manager.hashHandlers = {
          handleHashPresent: () => {},
          handleHashRequest: (p, h) => { received = { peer: p, hash: h }; },
        };
        manager.handleBinaryMessage(peer, peerCodec.encodeHashRequest(hexHash));
        expect(received).to.not.be.null;
        expect(received.hash).to.equal(hexHash);
      });

      it('should dispatch NAK to peer.onNakReceived with hash and reason', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const spy = sinon.spy(peer, 'onNakReceived');
        const hexHash = 'abcdef0123456789abcdef0123456789abcdef01';
        manager.handleBinaryMessage(peer, peerCodec.encodeNak(hexHash, peerCodec.NAK_REASON.STALE));
        expect(peer.nakCount).to.equal(1);
        sinon.assert.calledWithExactly(spy, hexHash, peerCodec.NAK_REASON.STALE);
      });

      it('should dispatch PEER_EXCHANGE to handlePeerExchange', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', {
          source: PEER_SOURCE.RANDOM,
          remoteCapabilities: ['peerExchange', 'binaryMessages'],
        });
        manager.handleBinaryMessage(peer, peerCodec.encodePeerExchange(['50.0.0.1:16127'], ['50.0.0.2:16137']));
        expect(manager.hasTopologyEntry(peer.key)).to.be.true;
        const entry = manager.getTopologyEntry(peer.key);
        expect(entry.outbound.size).to.equal(1);
        expect(entry.inbound.size).to.equal(1);
      });

      it('should ignore unknown message types', () => {
        const ws = createMockWs('44.0.0.1');
        const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        const buf = Buffer.from([0xFF, 0x00, 0x01]);
        // Should not throw
        manager.handleBinaryMessage(peer, buf);
      });
    });

    describe('broadcastHash', () => {
      it('should send binary to capable peers and JSON to others', () => {
        const ws1 = createMockWs('44.0.0.1');
        manager.add(ws1, '44.0.0.1', '16127', {
          source: PEER_SOURCE.RANDOM,
          remoteCapabilities: ['binaryMessages'],
        });
        const ws2 = createMockWs('45.0.0.1');
        manager.add(ws2, '45.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

        ws1.send.resetHistory();
        ws2.send.resetHistory();

        const hexHash = 'abcdef0123456789abcdef0123456789abcdef01';
        manager.broadcastHash(hexHash);

        // ws1 should get binary
        const bin = ws1.send.getCalls().find((c) => Buffer.isBuffer(c.args[0]));
        expect(bin).to.exist;
        expect(bin.args[0][0]).to.equal(peerCodec.MSG_TYPE.HASH_PRESENT);

        // ws2 should get JSON
        const json = ws2.send.getCalls().find((c) => typeof c.args[0] === 'string');
        expect(json).to.exist;
        const parsed = JSON.parse(json.args[0]);
        expect(parsed.messageHashPresent).to.equal(hexHash);
      });

      it('should exclude specified peer', () => {
        const ws1 = createMockWs('44.0.0.1');
        manager.add(ws1, '44.0.0.1', '16127', {
          source: PEER_SOURCE.RANDOM,
          remoteCapabilities: ['binaryMessages'],
        });
        ws1.send.resetHistory();
        manager.broadcastHash('abcdef0123456789abcdef0123456789abcdef01', '44.0.0.1:16127');
        expect(ws1.send.called).to.be.false;
      });
    });

    describe('sendHashRequest', () => {
      it('should send binary to capable peer', () => {
        const ws = createMockWs('44.0.0.1');
        manager.add(ws, '44.0.0.1', '16127', {
          source: PEER_SOURCE.RANDOM,
          remoteCapabilities: ['binaryMessages'],
        });
        ws.send.resetHistory();
        const hexHash = 'abcdef0123456789abcdef0123456789abcdef01';
        manager.sendHashRequest('44.0.0.1:16127', hexHash);
        const call = ws.send.getCall(0);
        expect(Buffer.isBuffer(call.args[0])).to.be.true;
        expect(call.args[0][0]).to.equal(peerCodec.MSG_TYPE.HASH_REQUEST);
      });

      it('should send JSON to legacy peer', () => {
        const ws = createMockWs('44.0.0.1');
        manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        ws.send.resetHistory();
        manager.sendHashRequest('44.0.0.1:16127', 'abcdef0123456789abcdef0123456789abcdef01');
        const call = ws.send.getCall(0);
        expect(typeof call.args[0]).to.equal('string');
        const parsed = JSON.parse(call.args[0]);
        expect(parsed.requestMessageHash).to.equal('abcdef0123456789abcdef0123456789abcdef01');
      });
    });
  });

  describe('binary frame interception in _bindHandlers', () => {


    it('should route binary Buffer to handleBinaryMessage', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange', 'binaryMessages'],
      });
      const spy = sinon.spy(manager, 'handleBinaryMessage');
      const buf = peerCodec.encodePeerExchange(['50.0.0.1:16127'], ['50.0.0.2:16127']);
      ws.onmessage({ data: buf });
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0]).to.equal(peer);
      expect(Buffer.isBuffer(spy.firstCall.args[1])).to.be.true;
    });

    it('should count binary message in messagesReceived and bytesReceived', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange', 'binaryMessages'],
      });
      const buf = peerCodec.encodeHashPresent('abcdef0123456789abcdef0123456789abcdef01');
      manager.hashHandlers = { handleHashPresent: sinon.stub(), handleHashRequest: sinon.stub() };
      ws.onmessage({ data: buf });
      expect(peer.messagesReceived).to.equal(1);
      expect(peer.bytesReceived).to.equal(buf.length);
    });
  });

  describe('JSON peerExchange/peerUpdate receive in _bindHandlers', () => {
    it('should handle JSON peerExchange from capable peer', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      const msg = JSON.stringify({ type: 'peerExchange', outbound: ['50.0.0.1:16127'], inbound: ['50.0.0.2:16127'] });
      ws.onmessage({ data: msg });
      expect(manager.hasTopologyEntry(peer.key)).to.be.true;
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.has('50.0.0.1:16127')).to.be.true;
      expect(entry.inbound.has('50.0.0.2:16127')).to.be.true;
    });

    it('should handle JSON peerUpdate from capable peer', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      // First send a full exchange
      manager.handlePeerExchange(peer, ['50.0.0.1:16127'], []);
      // Then a JSON update
      const msg = JSON.stringify({ type: 'peerUpdate', addOutbound: ['50.0.0.3:16127'], addInbound: [], rm: ['50.0.0.1:16127'] });
      ws.onmessage({ data: msg });
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.has('50.0.0.3:16127')).to.be.true;
      expect(entry.outbound.has('50.0.0.1:16127')).to.be.false;
    });

    it('should ignore peerExchange from peer without capability', () => {
      const ws = createMockWs('44.0.0.1');
      manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      const msg = JSON.stringify({ type: 'peerExchange', outbound: ['50.0.0.1:16127'], inbound: [] });
      ws.onmessage({ data: msg });
      expect(manager.peerTopologySize).to.equal(0);
    });
  });

  describe('isValidPeerKey (private IP rejection)', () => {
    it('should reject 10.x.x.x private IPs in peer exchange', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      manager.handlePeerExchange(peer, ['10.0.0.1:16127', '50.0.0.1:16127'], []);
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.size).to.equal(1);
      expect(entry.outbound.has('50.0.0.1:16127')).to.be.true;
      expect(entry.outbound.has('10.0.0.1:16127')).to.be.false;
    });

    it('should reject 172.16-31.x.x private IPs', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      manager.handlePeerExchange(peer, ['172.16.0.1:16127', '172.31.255.1:16127', '172.15.0.1:16127', '172.32.0.1:16127'], []);
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.has('172.16.0.1:16127')).to.be.false;
      expect(entry.outbound.has('172.31.255.1:16127')).to.be.false;
      expect(entry.outbound.has('172.15.0.1:16127')).to.be.true;
      expect(entry.outbound.has('172.32.0.1:16127')).to.be.true;
    });

    it('should reject 192.168.x.x private IPs', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      manager.handlePeerExchange(peer, ['192.168.1.1:16127', '192.169.1.1:16127'], []);
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.has('192.168.1.1:16127')).to.be.false;
      expect(entry.outbound.has('192.169.1.1:16127')).to.be.true;
    });

    it('should reject loopback 127.x.x.x IPs', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      manager.handlePeerExchange(peer, ['127.0.0.1:16127', '50.0.0.1:16127'], []);
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.has('127.0.0.1:16127')).to.be.false;
      expect(entry.outbound.has('50.0.0.1:16127')).to.be.true;
    });

    it('should reject link-local 169.254.x.x IPs', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      manager.handlePeerExchange(peer, ['169.254.1.1:16127', '50.0.0.1:16127'], []);
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.has('169.254.1.1:16127')).to.be.false;
      expect(entry.outbound.has('50.0.0.1:16127')).to.be.true;
    });

    it('should reject CGN 100.64-127.x.x IPs', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      manager.handlePeerExchange(peer, ['100.64.0.1:16127', '100.127.0.1:16127', '100.63.0.1:16127'], []);
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.has('100.64.0.1:16127')).to.be.false;
      expect(entry.outbound.has('100.127.0.1:16127')).to.be.false;
      expect(entry.outbound.has('100.63.0.1:16127')).to.be.true;
    });

    it('should reject invalid port', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      manager.handlePeerExchange(peer, ['50.0.0.1:9999', '50.0.0.2:16127'], []);
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.has('50.0.0.1:9999')).to.be.false;
      expect(entry.outbound.has('50.0.0.2:16127')).to.be.true;
    });
  });

  describe('handlePeerUpdate size limit enforcement', () => {
    it('should not exceed PEER_EXCHANGE_MAX_PEERS * 2 during a single update', () => {
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange'],
      });
      // Seed with 118 peers (close to 120 limit)
      const initialOut = [];
      const initialIn = [];
      for (let i = 0; i < 59; i++) initialOut.push(`50.${Math.floor(i / 256)}.${i % 256}.1:16127`);
      for (let i = 0; i < 59; i++) initialIn.push(`51.${Math.floor(i / 256)}.${i % 256}.1:16127`);
      manager.handlePeerExchange(peer, initialOut, initialIn);
      const entry = manager.getTopologyEntry(peer.key);
      expect(entry.outbound.size + entry.inbound.size).to.equal(118);

      // Try to add 50 more outbound — should only allow 2 before hitting 120
      const extraOut = [];
      for (let i = 0; i < 50; i++) extraOut.push(`52.${Math.floor(i / 256)}.${i % 256}.1:16127`);
      manager.handlePeerUpdate(peer, extraOut, [], []);
      expect(entry.outbound.size + entry.inbound.size).to.be.at.most(120);
    });
  });

  describe('binary frame rate limiting', () => {
    it('should rate limit binary frames', () => {

      sinon.stub(rateLimit, 'lruRateLimit').returns(false);

      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', {
        source: PEER_SOURCE.RANDOM,
        remoteCapabilities: ['peerExchange', 'binaryMessages'],
      });
      const spy = sinon.spy(manager, 'handleBinaryMessage');

      const buf = peerCodec.encodeHashPresent('abcdef0123456789abcdef0123456789abcdef01');
      ws.onmessage({ data: buf });

      expect(spy.called).to.be.false;
      expect(peer.messagesReceived).to.equal(0);
    });
  });

  describe('network health monitor integration', () => {


    it('should call recordConnect on add()', () => {
      const monitor = new NetworkHealthMonitor();
      monitor.setPeerManager(manager);
      manager.networkHealthMonitor = monitor;
      const spy = sinon.spy(monitor, 'recordConnect');

      const ws = createMockWs('44.0.0.1');
      manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });

      expect(spy.calledOnce).to.be.true;
    });

    it('should call recordDisconnect on remove() with connectedAt and closeCode', () => {
      const monitor = new NetworkHealthMonitor();
      monitor.setPeerManager(manager);
      manager.networkHealthMonitor = monitor;
      const spy = sinon.spy(monitor, 'recordDisconnect');

      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.remove(peer.key, 1006);

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0]).to.equal(peer.connectedAt);
      expect(spy.firstCall.args[1]).to.equal(1006);
    });

    it('should not crash if no monitor is set', () => {
      manager.networkHealthMonitor = null;
      const ws = createMockWs('44.0.0.1');
      const peer = manager.add(ws, '44.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      // Should not throw
      manager.remove(peer.key, 1006);
    });
  });
});
