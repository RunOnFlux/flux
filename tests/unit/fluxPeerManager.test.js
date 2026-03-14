const chai = require('chai');
const sinon = require('sinon');
const WebSocket = require('ws');

const { expect } = chai;

const { FluxPeerSocket, CLOSE_CODES } = require('../../ZelBack/src/services/utils/FluxPeerSocket');
const { FluxPeerManager, peerManager } = require('../../ZelBack/src/services/utils/FluxPeerManager');

/**
 * Creates a mock WebSocket object suitable for FluxPeerSocket tests.
 * The `on` stub captures the 'pong' handler so tests can invoke it.
 */
function createMockWs(ip = '192.168.1.1', port = '16127') {
  const ws = {
    readyState: WebSocket.OPEN,
    ip,
    port,
    ping: sinon.stub(),
    send: sinon.stub(),
    close: sinon.stub(),
    on: sinon.stub().callsFake((event, cb) => {
      if (event === 'pong') ws._pongHandler = cb;
    }),
    onclose: null,
    onerror: null,
    onmessage: null,
    _socket: { remoteAddress: ip, _peername: { address: ip } },
    _pongHandler: null,
  };
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
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

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
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', 16127, manager);
      expect(peer.port).to.equal('16127');
    });

    it('should set backward-compat properties on raw ws', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = new FluxPeerSocket(ws, 'inbound', '10.0.0.1', '16127', manager);

      expect(ws.ip).to.equal('10.0.0.1');
      expect(ws.port).to.equal('16127');
      expect(ws.msgMap).to.equal(peer.msgMap);
    });
  });

  describe('closeCodes', () => {
    it('should return inbound close codes for inbound direction', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, 'inbound', '10.0.0.1', '16127', manager);
      expect(peer.closeCodes).to.deep.equal(CLOSE_CODES.inbound);
      expect(peer.closeCodes.invalidMsg).to.equal(4016);
      expect(peer.closeCodes.blocked).to.equal(4003);
    });

    it('should return outbound close codes for outbound direction', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
      expect(peer.closeCodes).to.deep.equal(CLOSE_CODES.outbound);
      expect(peer.closeCodes.invalidMsg).to.equal(4017);
      expect(peer.closeCodes.blocked).to.equal(4006);
    });
  });

  describe('isAlive', () => {
    it('should return true when missedPongs < 3 and ws.readyState === OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
      peer.missedPongs = 0;
      expect(peer.isAlive).to.equal(true);

      peer.missedPongs = 2;
      expect(peer.isAlive).to.equal(true);
    });

    it('should return false when missedPongs >= 3', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
      peer.missedPongs = 3;
      expect(peer.isAlive).to.equal(false);

      peer.missedPongs = 5;
      expect(peer.isAlive).to.equal(false);
    });

    it('should return false when ws.readyState !== OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.CLOSED;
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
      peer.missedPongs = 0;
      expect(peer.isAlive).to.equal(false);
    });
  });

  describe('onPingSent', () => {
    it('should increment missedPongs and set lastPingTime', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
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
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

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
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
      peer.onPongReceived();
      expect(peer.latency).to.equal(null);
      expect(peer.missedPongs).to.equal(0);
    });
  });

  describe('send', () => {
    it('should return true on success when OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

      const result = peer.send('hello');
      expect(result).to.equal(true);
      sinon.assert.calledOnce(ws.send);
      sinon.assert.calledWith(ws.send, 'hello');
    });

    it('should return false when ws is not OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.CLOSED;
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

      const result = peer.send('hello');
      expect(result).to.equal(false);
      sinon.assert.notCalled(ws.send);
    });

    it('should return false when ws.send throws', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      ws.send.throws(new Error('send error'));
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

      const result = peer.send('hello');
      expect(result).to.equal(false);
    });
  });

  describe('ping', () => {
    it('should call ws.ping and onPingSent when OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
      sinon.spy(peer, 'onPingSent');

      peer.ping();

      sinon.assert.calledOnce(ws.ping);
      sinon.assert.calledOnce(peer.onPingSent);
      expect(peer.missedPongs).to.equal(1);
    });

    it('should not call ws.ping when not OPEN', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.CLOSED;
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

      peer.ping();

      sinon.assert.notCalled(ws.ping);
      expect(peer.missedPongs).to.equal(0);
    });
  });

  describe('close', () => {
    it('should call ws.close with code and reason', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

      peer.close(4011, 'dead connection');

      sinon.assert.calledOnce(ws.close);
      sinon.assert.calledWith(ws.close, 4011, 'dead connection');
    });

    it('should call ws.close without args when none provided', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

      peer.close();

      sinon.assert.calledOnce(ws.close);
    });
  });

  describe('sendNak', () => {
    it('should send JSON NAK message', () => {
      const ws = createMockWs();
      ws.readyState = WebSocket.OPEN;
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

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
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
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
      const peer = new FluxPeerSocket(ws, 'inbound', '10.0.0.1', '16127', manager);
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
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
      sinon.spy(peer, 'onPongReceived');

      // The pong handler was captured via ws.on stub
      expect(ws._pongHandler).to.be.a('function');
      ws._pongHandler();

      sinon.assert.calledOnce(peer.onPongReceived);
    });

    it('should set onclose that calls manager.remove', () => {
      const ws = createMockWs();
      sinon.spy(manager, 'remove');
      // Add via manager so peer is in the map
      const peer = manager.add(ws, 'outbound', '10.0.0.1', '16127');

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

      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

      expect(ws.onmessage).to.be.a('function');

      const msgData = JSON.stringify({ type: 'test', data: 'hello' });
      await ws.onmessage({ data: msgData });

      sinon.assert.calledOnce(manager.messageDispatcher);
    });

    it('should handle NAK messages via onNakReceived', async () => {
      const ws = createMockWs();
      const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
      sinon.stub(fluxNetworkHelper, 'lruRateLimit').returns(true);

      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
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

      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

      await ws.onmessage({ data: '{"type":"test"}' });

      sinon.assert.notCalled(manager.messageDispatcher);
    });

    it('should return early when evt is falsy', async () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

      // Should not throw
      await ws.onmessage(null);
      await ws.onmessage(undefined);

      sinon.assert.notCalled(manager.messageDispatcher);
    });
  });

  describe('onNakReceived', () => {
    it('should increment nakCount', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);
      expect(peer.nakCount).to.equal(0);

      peer.onNakReceived();
      expect(peer.nakCount).to.equal(1);

      peer.onNakReceived();
      expect(peer.nakCount).to.equal(2);
    });

    it('should reset nakCount when window expires', () => {
      const ws = createMockWs();
      const peer = new FluxPeerSocket(ws, 'outbound', '10.0.0.1', '16127', manager);

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
      const peer = manager.add(ws, 'outbound', '10.0.0.1', '16127');

      expect(peer).to.be.instanceOf(FluxPeerSocket);
      expect(manager.has('10.0.0.1:16127')).to.equal(true);
      expect(manager.get('10.0.0.1:16127')).to.equal(peer);
      expect(manager.outboundCount).to.equal(1);
      expect(manager.inboundCount).to.equal(0);
    });

    it('should add inbound peer to inbound set', () => {
      const ws = createMockWs('10.0.0.2', '16127');
      const peer = manager.add(ws, 'inbound', '10.0.0.2', '16127');

      expect(peer).to.be.instanceOf(FluxPeerSocket);
      expect(manager.inboundCount).to.equal(1);
      expect(manager.outboundCount).to.equal(0);
    });

    it('should return the created FluxPeerSocket', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, 'outbound', '10.0.0.1', '16127');

      expect(peer).to.be.instanceOf(FluxPeerSocket);
      expect(peer.ip).to.equal('10.0.0.1');
      expect(peer.port).to.equal('16127');
      expect(peer.direction).to.equal('outbound');
    });

    it('should convert port to string', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, 'outbound', '10.0.0.1', 16127);
      expect(peer.port).to.equal('16127');
      expect(peer.key).to.equal('10.0.0.1:16127');
    });
  });

  describe('remove', () => {
    it('should delete from map and correct direction set, return removed peer', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, 'outbound', '10.0.0.1', '16127');

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
      manager.add(ws1, 'outbound', '10.0.0.1', '16127');
      manager.add(ws2, 'inbound', '10.0.0.2', '16127');

      manager.remove('10.0.0.1:16127');

      expect(manager.outboundCount).to.equal(0);
      expect(manager.inboundCount).to.equal(1);
    });

    it('should call trackDisconnect', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      manager.add(ws, 'outbound', '10.0.0.1', '16127');
      sinon.spy(manager, 'trackDisconnect');

      manager.remove('10.0.0.1:16127');

      sinon.assert.calledOnce(manager.trackDisconnect);
      sinon.assert.calledWith(manager.trackDisconnect, '10.0.0.1', '16127');
    });
  });

  describe('has / get', () => {
    it('should return true/peer for existing key', () => {
      const ws = createMockWs('10.0.0.1', '16127');
      const peer = manager.add(ws, 'outbound', '10.0.0.1', '16127');

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
      manager.add(createMockWs('10.0.0.1', '16127'), 'outbound', '10.0.0.1', '16127');
      manager.add(createMockWs('10.0.0.2', '16127'), 'outbound', '10.0.0.2', '16127');
      manager.add(createMockWs('10.0.0.3', '16127'), 'inbound', '10.0.0.3', '16127');
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

      manager.add(createMockWs('10.0.0.1', '16127'), 'outbound', '10.0.0.1', '16127');
      manager.add(createMockWs('10.0.0.2', '16127'), 'inbound', '10.0.0.2', '16127');
      manager.add(createMockWs('10.0.0.3', '16127'), 'outbound', '10.0.0.3', '16127');

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

      manager.add(ws1, 'outbound', '10.0.0.1', '16127');
      manager.add(ws2, 'inbound', '10.0.0.2', '16127');

      manager.pingAll();

      sinon.assert.calledOnce(ws1.ping);
      sinon.assert.calledOnce(ws2.ping);
    });
  });

  describe('pruneDeadConnections', () => {
    it('should remove peers where isAlive is false', () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');

      const peer1 = manager.add(ws1, 'outbound', '10.0.0.1', '16127');
      const peer2 = manager.add(ws2, 'inbound', '10.0.0.2', '16127');

      // Make peer1 dead
      peer1.missedPongs = 3;

      const count = manager.pruneDeadConnections();

      expect(count).to.equal(1);
      expect(manager.has('10.0.0.1:16127')).to.equal(false);
      expect(manager.has('10.0.0.2:16127')).to.equal(true);
      sinon.assert.calledOnce(ws1.close);
    });

    it('should leave alive peers untouched', () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');

      manager.add(ws1, 'outbound', '10.0.0.1', '16127');
      manager.add(ws2, 'inbound', '10.0.0.2', '16127');

      const count = manager.pruneDeadConnections();

      expect(count).to.equal(0);
      expect(manager.getNumberOfPeers()).to.equal(2);
      sinon.assert.notCalled(ws1.close);
      sinon.assert.notCalled(ws2.close);
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
      manager.add(createMockWs('10.0.0.1', '16127'), 'outbound', '10.0.0.1', '16127');
      manager.add(createMockWs('10.0.0.2', '16127'), 'outbound', '10.0.0.2', '16127');
      manager.add(createMockWs('10.0.0.3', '16127'), 'inbound', '10.0.0.3', '16127');

      const outPeer = manager.getRandomPeer('outbound');
      expect(outPeer).to.be.instanceOf(FluxPeerSocket);
      expect(outPeer.direction).to.equal('outbound');

      const inPeer = manager.getRandomPeer('inbound');
      expect(inPeer).to.be.instanceOf(FluxPeerSocket);
      expect(inPeer.direction).to.equal('inbound');
    });

    it('should return null when no peers of that direction exist', () => {
      manager.add(createMockWs('10.0.0.1', '16127'), 'outbound', '10.0.0.1', '16127');

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
      manager.add(createMockWs('10.0.0.1', '16127'), 'outbound', '10.0.0.1', '16127');
      manager.add(createMockWs('10.0.0.1', '16128'), 'inbound', '10.0.0.1', '16128');
      manager.add(createMockWs('10.0.0.2', '16127'), 'outbound', '10.0.0.2', '16127');
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
      manager.add(createMockWs('10.0.0.1', '16127'), 'outbound', '10.0.0.1', '16127');
      expect(manager.allPeersDown()).to.equal(false);
    });
  });

  describe('getStats', () => {
    it('should return correct diagnostics', () => {
      const ws1 = createMockWs('10.0.0.1', '16127');
      const ws2 = createMockWs('10.0.0.2', '16127');
      const ws3 = createMockWs('10.0.0.3', '16127');

      manager.add(ws1, 'outbound', '10.0.0.1', '16127');
      const peer2 = manager.add(ws2, 'inbound', '10.0.0.2', '16127');
      manager.add(ws3, 'outbound', '10.0.0.3', '16127');

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
      manager.add(createMockWs('10.0.0.1', '16127'), 'outbound', '10.0.0.1', '16127');
      manager.add(createMockWs('10.0.0.2', '16127'), 'inbound', '10.0.0.2', '16127');
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

  describe('singleton export', () => {
    it('peerManager should be an instance of FluxPeerManager', () => {
      expect(peerManager).to.be.instanceOf(FluxPeerManager);
    });
  });
});
