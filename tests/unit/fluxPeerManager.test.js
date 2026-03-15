const chai = require('chai');
const sinon = require('sinon');
const EventEmitter = require('events');
const WebSocket = require('ws');

const { expect } = chai;

const { FluxPeerSocket, CLOSE_CODES, PEER_SOURCE } = require('../../ZelBack/src/services/utils/FluxPeerSocket');
const { FluxPeerManager, peerManager } = require('../../ZelBack/src/services/utils/FluxPeerManager');

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

describe('FluxPeerSocket tests', () => {
  let manager;

  beforeEach(() => {
    manager = new FluxPeerManager();
    manager.messageDispatcher = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
    manager._clear();
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
    it('should send JSON NAK message', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      peer.sendNak('abc123', 'stale message');

      sinon.assert.calledOnce(ws.send);
      const sentData = JSON.parse(ws.send.firstCall.args[0]);
      expect(sentData).to.deep.equal({
        type: 'nak',
        hash: 'abc123',
        reason: 'stale message',
      });
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
      const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
      sinon.stub(fluxNetworkHelper, 'lruRateLimit').returns(true);

      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);

      peer.source = PEER_SOURCE.RANDOM;

      expect(ws.onmessage).to.be.a('function');

      const msgData = JSON.stringify({ type: 'test', data: 'hello' });
      await ws.onmessage({ data: msgData });

      sinon.assert.calledOnce(manager.messageDispatcher);
    });

    it('should handle NAK messages via onNakReceived', async () => {
      const ws = createMockWs();
      const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
      sinon.stub(fluxNetworkHelper, 'lruRateLimit').returns(true);

      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);

      peer.source = PEER_SOURCE.RANDOM;
      sinon.spy(peer, 'onNakReceived');

      const nakMsg = JSON.stringify({ type: 'nak', hash: 'abc', reason: 'stale' });
      await ws.onmessage({ data: nakMsg });

      sinon.assert.calledOnce(peer.onNakReceived);
      sinon.assert.notCalled(manager.messageDispatcher);
    });

    it('should not dispatch when rate limited', async () => {
      const ws = createMockWs();
      const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
      sinon.stub(fluxNetworkHelper, 'lruRateLimit').returns(false);

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
    it('should increment nakCount', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;
      expect(peer.nakCount).to.equal(0);

      peer.onNakReceived();
      expect(peer.nakCount).to.equal(1);

      peer.onNakReceived();
      expect(peer.nakCount).to.equal(2);
    });

    it('should reset nakCount when window expires', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, '10.0.0.1', '16127', manager);
      peer.source = PEER_SOURCE.RANDOM;

      peer.nakCount = 5;
      // Set window start to 6 minutes ago (beyond 5 min window)
      peer.nakWindowStart = Date.now() - (6 * 60 * 1000);

      peer.onNakReceived();
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
    manager._clear();
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
      manager._unstableNodes.set('10.0.0.1:16127', {
        disconnects: 10,
        firstDisconnect: Date.now() - (3 * 60 * 60 * 1000), // 3 hours ago (beyond 2h window)
      });

      expect(manager.isUnstable('10.0.0.1', '16127')).to.equal(false);
      // Should also clean up expired entry
      expect(manager._unstableNodes.has('10.0.0.1:16127')).to.equal(false);
    });

    it('trackDisconnect should reset when window expires', () => {
      manager._unstableNodes.set('10.0.0.1:16127', {
        disconnects: 10,
        firstDisconnect: Date.now() - (3 * 60 * 60 * 1000),
      });

      manager.trackDisconnect('10.0.0.1', '16127');

      const entry = manager._unstableNodes.get('10.0.0.1:16127');
      expect(entry.disconnects).to.equal(1);
    });
  });

  describe('pruneUnstableList', () => {
    it('should remove expired entries', () => {
      manager._unstableNodes.set('10.0.0.1:16127', {
        disconnects: 5,
        firstDisconnect: Date.now() - (3 * 60 * 60 * 1000), // expired
      });
      manager._unstableNodes.set('10.0.0.2:16127', {
        disconnects: 3,
        firstDisconnect: Date.now(), // not expired
      });

      manager.pruneUnstableList();

      expect(manager._unstableNodes.has('10.0.0.1:16127')).to.equal(false);
      expect(manager._unstableNodes.has('10.0.0.2:16127')).to.equal(true);
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
      });
    });
  });

  describe('_clear', () => {
    it('should empty everything', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager.add(createMockWs('10.0.0.2', '16127'), '10.0.0.2', '16127', { source: PEER_SOURCE.INBOUND });
      manager.queueReconnect('10.0.0.3', '16127');
      manager.trackDisconnect('10.0.0.4', '16127');

      manager._clear();

      expect(manager.getNumberOfPeers()).to.equal(0);
      expect(manager.outboundCount).to.equal(0);
      expect(manager.inboundCount).to.equal(0);
      expect(manager.getReconnectQueue().size).to.equal(0);
      expect(manager._unstableNodes.size).to.equal(0);
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

  describe('isPrivateIp', () => {
    it('should detect 10.0.0.0/8 range', () => {
      expect(FluxPeerManager.isPrivateIp('10.0.0.1')).to.equal(true);
      expect(FluxPeerManager.isPrivateIp('10.255.255.255')).to.equal(true);
    });

    it('should detect 172.16.0.0/12 range', () => {
      expect(FluxPeerManager.isPrivateIp('172.16.0.1')).to.equal(true);
      expect(FluxPeerManager.isPrivateIp('172.31.255.255')).to.equal(true);
      expect(FluxPeerManager.isPrivateIp('172.15.0.1')).to.equal(false);
      expect(FluxPeerManager.isPrivateIp('172.32.0.1')).to.equal(false);
    });

    it('should detect 192.168.0.0/16 range', () => {
      expect(FluxPeerManager.isPrivateIp('192.168.0.1')).to.equal(true);
      expect(FluxPeerManager.isPrivateIp('192.168.255.255')).to.equal(true);
      expect(FluxPeerManager.isPrivateIp('192.169.0.1')).to.equal(false);
    });

    it('should return false for public IPs', () => {
      expect(FluxPeerManager.isPrivateIp('8.8.8.8')).to.equal(false);
      expect(FluxPeerManager.isPrivateIp('1.1.1.1')).to.equal(false);
      expect(FluxPeerManager.isPrivateIp('203.0.113.1')).to.equal(false);
    });

    it('should return false for malformed IPs', () => {
      expect(FluxPeerManager.isPrivateIp('abc')).to.equal(false);
      expect(FluxPeerManager.isPrivateIp('10.0')).to.equal(false);
    });
  });

  describe('validateAndAddInbound', () => {
    it('should add valid inbound peer', () => {
      manager.numberOfFluxNodes = 10000;
      const ws = createMockWs('8.8.8.8', '16127');
      ws.close = sinon.stub();

      manager.validateAndAddInbound(ws, '16127');

      expect(manager.inboundCount).to.equal(1);
      expect(manager.has('8.8.8.8:16127')).to.equal(true);
    });

    it('should use default port 16127 when not provided', () => {
      manager.numberOfFluxNodes = 10000;
      const ws = createMockWs('8.8.8.8', '16127');

      manager.validateAndAddInbound(ws);

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

      manager.validateAndAddInbound(ws, '16127');

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

      manager.validateAndAddInbound(ws, '16127');

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

      manager.validateAndAddInbound(ws2, '16127');

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
      ws._socket.remoteAddress = '::ffff:8.8.8.8';

      manager.validateAndAddInbound(ws, '16127');

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
      manager._failedConnections.get('10.0.0.1:16127').lastAttempt = Date.now() - (3 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(true);
    });

    it('should increase backoff on subsequent failures', () => {
      manager.recordFailedConnection('10.0.0.1', '16127');
      manager.recordFailedConnection('10.0.0.1', '16127');
      // Second failure: 5min backoff. 3 minutes ago should still be blocked.
      manager._failedConnections.get('10.0.0.1:16127').lastAttempt = Date.now() - (3 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(false);
      // 6 minutes ago should be allowed
      manager._failedConnections.get('10.0.0.1:16127').lastAttempt = Date.now() - (6 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(true);
    });

    it('should cap backoff at 15 minutes', () => {
      for (let i = 0; i < 10; i += 1) {
        manager.recordFailedConnection('10.0.0.1', '16127');
      }
      // 14 minutes ago — should still be blocked (cap is 15min)
      manager._failedConnections.get('10.0.0.1:16127').lastAttempt = Date.now() - (14 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(false);
      // 16 minutes ago — should be allowed
      manager._failedConnections.get('10.0.0.1:16127').lastAttempt = Date.now() - (16 * 60000);
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(true);
    });

    it('should return false for already connected peers', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      expect(manager.shouldAttemptConnection('10.0.0.1', '16127')).to.equal(false);
    });

    it('should clear failed connection on successful add', () => {
      manager.recordFailedConnection('10.0.0.1', '16127');
      expect(manager._failedConnections.has('10.0.0.1:16127')).to.equal(true);

      manager.add(createMockWs('10.0.0.1', '16127'), '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      expect(manager._failedConnections.has('10.0.0.1:16127')).to.equal(false);
    });
  });

  describe('_shouldReconnect', () => {
    it('should return true for no close code (unexpected disconnect)', () => {
      expect(manager._shouldReconnect(undefined)).to.equal(true);
      expect(manager._shouldReconnect(null)).to.equal(true);
      expect(manager._shouldReconnect(0)).to.equal(true);
    });

    it('should return true for standard WebSocket close codes', () => {
      expect(manager._shouldReconnect(1000)).to.equal(true); // normal
      expect(manager._shouldReconnect(1001)).to.equal(true); // going away
      expect(manager._shouldReconnect(1006)).to.equal(true); // abnormal
    });

    it('should return true for DEAD_CONNECTION', () => {
      expect(manager._shouldReconnect(CLOSE_CODES.DEAD_CONNECTION)).to.equal(true);
    });

    it('should return true for MAX_CONNECTIONS', () => {
      expect(manager._shouldReconnect(CLOSE_CODES.MAX_CONNECTIONS)).to.equal(true);
    });

    it('should return false for DUPLICATE_PEER', () => {
      expect(manager._shouldReconnect(CLOSE_CODES.DUPLICATE_PEER)).to.equal(false);
    });

    it('should return false for policy violations', () => {
      expect(manager._shouldReconnect(CLOSE_CODES.BLOCKED_INBOUND)).to.equal(false);
      expect(manager._shouldReconnect(CLOSE_CODES.BLOCKED_OUTBOUND)).to.equal(false);
      expect(manager._shouldReconnect(CLOSE_CODES.BAD_ORIGIN_INBOUND)).to.equal(false);
    });

    it('should return false for purposeful closes', () => {
      expect(manager._shouldReconnect(CLOSE_CODES.CLOSED_OUTBOUND)).to.equal(false);
      expect(manager._shouldReconnect(CLOSE_CODES.CLOSED_INBOUND)).to.equal(false);
    });

    it('should return false for auth failures', () => {
      expect(manager._shouldReconnect(CLOSE_CODES.AUTH_FAILURE_1)).to.equal(false);
      expect(manager._shouldReconnect(CLOSE_CODES.AUTH_FAILURE_4)).to.equal(false);
    });

    it('should return false for invalid messages', () => {
      expect(manager._shouldReconnect(CLOSE_CODES.INVALID_MSG_INBOUND)).to.equal(false);
      expect(manager._shouldReconnect(CLOSE_CODES.INVALID_MSG_OUTBOUND)).to.equal(false);
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

    it('should be cleared by _clear', () => {
      manager.markPending('10.0.0.1:16127');
      manager._clear();
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
      manager.validateAndAddInbound(ws2, '16127');

      expect(manager.has('8.8.8.8:16127')).to.equal(true);
      const current = manager.get('8.8.8.8:16127');
      expect(current.ws).to.equal(ws2);
    });
  });

  describe('_verifyOrReplace (reconnect duplicate handling)', () => {
    it('should replace existing connection when pong does not arrive within timeout', (done) => {
      manager.numberOfFluxNodes = 10000;
      const ws1 = createMockWs('8.8.8.8', '16127');
      manager.add(ws1, '8.8.8.8', '16127', { source: PEER_SOURCE.INBOUND });

      const ws2 = createMockWs('8.8.8.8', '16127');
      const req = { headers: { 'x-flux-reconnect': 'true' } };
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
      const req = { headers: { 'x-flux-reconnect': 'true' } };
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
      const req = { headers: { 'x-flux-reconnect': 'true' } };
      manager.validateAndAddInbound(ws2, '16127', req);

      const current = manager.get('8.8.8.8:16127');
      expect(current.ws).to.equal(ws2);
    });

    it('should reject immediately when no X-Flux-Reconnect header', () => {
      manager.numberOfFluxNodes = 10000;
      const ws1 = createMockWs('8.8.8.8', '16127');
      manager.add(ws1, '8.8.8.8', '16127', { source: PEER_SOURCE.INBOUND });

      const ws2 = createMockWs('8.8.8.8', '16127');
      const req = { headers: {} };
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
      manager._clear();
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

    it('should be cleared by _clear', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      manager.add(ws, '10.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
      manager._clear();
      expect(manager.getHistory()).to.deep.equal([]);
    });
  });

  describe('singleton export', () => {
    it('peerManager should be an instance of FluxPeerManager', () => {
      expect(peerManager).to.be.instanceOf(FluxPeerManager);
    });
  });
});
