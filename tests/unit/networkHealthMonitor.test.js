const chai = require('chai');
const sinon = require('sinon');
const EventEmitter = require('events');
const WebSocket = require('ws');

const { expect } = chai;

const {
  NetworkHealthMonitor,
  HEALTH_STATUS,
  isUnexpectedDisconnect,
  VELOCITY_THRESHOLD_COUNT,
  VELOCITY_WINDOW_MS,
  MIN_CONNECTION_AGE_MS,
  STEADY_STATE_DELAY_MS,
  DIAGNOSIS_COOLDOWN_MS,
} = require('../../ZelBack/src/services/utils/NetworkHealthMonitor');
const { CLOSE_CODES } = require('../../ZelBack/src/services/utils/FluxPeerSocket');
const { FluxPeerManager } = require('../../ZelBack/src/services/utils/FluxPeerManager');

function createMockWs() {
  const ws = new EventEmitter();
  ws.readyState = WebSocket.OPEN;
  ws.ping = sinon.stub();
  ws.send = sinon.stub();
  ws.close = sinon.stub();
  ws.onclose = null;
  ws.onerror = null;
  ws.onmessage = null;
  ws._socket = { remoteAddress: '10.0.0.1', _peername: { address: '10.0.0.1' } };
  return ws;
}

describe('NetworkHealthMonitor', () => {
  let monitor;
  let manager;

  beforeEach(() => {
    monitor = new NetworkHealthMonitor();
    manager = new FluxPeerManager();
    manager.messageDispatcher = sinon.stub();
    monitor.setPeerManager(manager);
  });

  afterEach(() => {
    sinon.restore();
    monitor._clear();
    manager._clear();
  });

  describe('isUnexpectedDisconnect', () => {
    it('should return true for no close code', () => {
      expect(isUnexpectedDisconnect(undefined)).to.be.true;
    });

    it('should return true for standard WebSocket codes', () => {
      expect(isUnexpectedDisconnect(1000)).to.be.true;
      expect(isUnexpectedDisconnect(1006)).to.be.true;
    });

    it('should return true for DEAD_CONNECTION', () => {
      expect(isUnexpectedDisconnect(CLOSE_CODES.DEAD_CONNECTION)).to.be.true;
    });

    it('should return true for MAX_CONNECTIONS', () => {
      expect(isUnexpectedDisconnect(CLOSE_CODES.MAX_CONNECTIONS)).to.be.true;
    });

    it('should return false for policy codes', () => {
      expect(isUnexpectedDisconnect(CLOSE_CODES.BLOCKED_INBOUND)).to.be.false;
      expect(isUnexpectedDisconnect(CLOSE_CODES.BAD_ORIGIN_OUTBOUND)).to.be.false;
      expect(isUnexpectedDisconnect(CLOSE_CODES.DUPLICATE_PEER)).to.be.false;
    });
  });

  describe('recordConnect / steady state', () => {
    it('should not be in steady state initially', () => {
      expect(monitor.isInSteadyState()).to.be.false;
    });

    it('should track first peer connection time', () => {
      monitor.recordConnect();
      expect(monitor._firstPeerConnectedAt).to.be.a('number');
    });

    it('should not enter steady state before delay', () => {
      monitor._firstPeerConnectedAt = Date.now() - 1000; // 1s ago
      monitor.recordConnect();
      expect(monitor.isInSteadyState()).to.be.false;
    });

    it('should enter steady state after delay', () => {
      monitor._firstPeerConnectedAt = Date.now() - STEADY_STATE_DELAY_MS - 1;
      monitor.recordConnect();
      expect(monitor.isInSteadyState()).to.be.true;
    });
  });

  describe('recordDisconnect / velocity filtering', () => {
    it('should ignore short-lived connections', () => {
      const recentConnect = Date.now() - 5000; // 5s ago — below MIN_CONNECTION_AGE_MS
      monitor.recordDisconnect(recentConnect, undefined);
      expect(monitor._velocityCount).to.equal(0);
    });

    it('should ignore policy close codes', () => {
      const oldConnect = Date.now() - 60000; // 60s ago
      monitor.recordDisconnect(oldConnect, CLOSE_CODES.BLOCKED_INBOUND);
      expect(monitor._velocityCount).to.equal(0);
    });

    it('should record established unexpected disconnects', () => {
      const oldConnect = Date.now() - 60000;
      monitor.recordDisconnect(oldConnect, undefined);
      expect(monitor._velocityCount).to.equal(1);
    });

    it('should record DEAD_CONNECTION disconnects', () => {
      const oldConnect = Date.now() - 60000;
      monitor.recordDisconnect(oldConnect, CLOSE_CODES.DEAD_CONNECTION);
      expect(monitor._velocityCount).to.equal(1);
    });
  });

  describe('velocity calculation', () => {
    it('should count disconnects within window', () => {
      const now = Date.now();
      // Simulate 3 recent disconnects
      for (let i = 0; i < 3; i++) {
        monitor._disconnectTimes[i] = now - 10000; // 10s ago
        monitor._velocityCount += 1;
        monitor._velocityIndex = (monitor._velocityIndex + 1) % 32;
      }
      // 1 old disconnect
      monitor._disconnectTimes[3] = now - VELOCITY_WINDOW_MS - 1000;
      monitor._velocityCount += 1;
      monitor._velocityIndex = (monitor._velocityIndex + 1) % 32;

      expect(monitor._getDisconnectVelocity(now)).to.equal(3);
    });
  });

  describe('diagnosis gating', () => {
    it('should not trigger before steady state', () => {
      const oldConnect = Date.now() - 60000;
      const spy = sinon.spy(monitor, '_triggerDiagnosis');
      // Record enough disconnects to exceed threshold
      for (let i = 0; i < VELOCITY_THRESHOLD_COUNT + 1; i++) {
        monitor.recordDisconnect(oldConnect, undefined);
      }
      expect(spy.called).to.be.false;
    });

    it('should not trigger during cooldown', () => {
      monitor._inSteadyState = true;
      monitor._lastDiagnosisAt = Date.now(); // just diagnosed
      const oldConnect = Date.now() - 60000;
      const spy = sinon.spy(monitor, '_triggerDiagnosis');
      for (let i = 0; i < VELOCITY_THRESHOLD_COUNT + 1; i++) {
        monitor.recordDisconnect(oldConnect, undefined);
      }
      expect(spy.called).to.be.false;
    });

    it('should not trigger while already diagnosing', () => {
      monitor._inSteadyState = true;
      monitor._diagnosing = true;
      const oldConnect = Date.now() - 60000;
      const spy = sinon.spy(monitor, '_triggerDiagnosis');
      for (let i = 0; i < VELOCITY_THRESHOLD_COUNT + 1; i++) {
        monitor.recordDisconnect(oldConnect, undefined);
      }
      expect(spy.called).to.be.false;
    });

    it('should trigger when velocity exceeds threshold in steady state', () => {
      monitor._inSteadyState = true;
      monitor._lastDiagnosisAt = 0;
      const oldConnect = Date.now() - 60000;
      const stub = sinon.stub(monitor, '_triggerDiagnosis');
      for (let i = 0; i < VELOCITY_THRESHOLD_COUNT; i++) {
        monitor.recordDisconnect(oldConnect, undefined);
      }
      expect(stub.calledOnce).to.be.true;
      expect(stub.firstCall.args[0]).to.equal(VELOCITY_THRESHOLD_COUNT);
    });
  });

  describe('_pingAllPeers', () => {
    it('should return all responded when peers reply to ping', async () => {
      const ws1 = createMockWs();
      ws1.ping = () => { setImmediate(() => ws1.emit('pong')); };
      const peer1 = manager.add(ws1, '44.0.0.1', '16127', { source: 'random' });

      const ws2 = createMockWs();
      ws2.ping = () => { setImmediate(() => ws2.emit('pong')); };
      const peer2 = manager.add(ws2, '45.0.0.1', '16127', { source: 'random' });

      const result = await monitor._pingAllPeers();
      expect(result.sent).to.equal(2);
      expect(result.responded).to.equal(2);
      expect(result.respondedKeys).to.include(peer1.key);
      expect(result.respondedKeys).to.include(peer2.key);
    });

    it('should return 0 responded when peers do not reply', async () => {
      const ws = createMockWs();
      ws.ping = sinon.stub(); // no pong emitted
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      const result = await monitor._pingAllPeers();
      expect(result.sent).to.equal(1);
      expect(result.responded).to.equal(0);
    }).timeout(5000);

    it('should handle empty peer list', async () => {
      const result = await monitor._pingAllPeers();
      expect(result.sent).to.equal(0);
      expect(result.responded).to.equal(0);
    });
  });

  describe('_correlateTopology', () => {
    it('should find lost peers still visible in topology', () => {
      // Set up a responding peer with topology
      const ws = createMockWs();
      const peer = manager.add(ws, '44.0.0.1', '16127', { source: 'random' });
      manager.handlePeerExchange(peer, ['10.0.0.5:16127'], ['10.0.0.6:16127']);

      // Simulate a disconnect event in history for 10.0.0.5
      // (which is in the responder's topology)
      const ws2 = createMockWs();
      manager.add(ws2, '10.0.0.5', '16127', { source: 'random' });
      manager.remove('10.0.0.5:16127', 1006);

      const result = monitor._correlateTopology([peer.key]);
      expect(result.recentlyLost).to.be.greaterThan(0);
      expect(result.peersStillSeen).to.be.greaterThan(0);
    });

    it('should detect peers gone from topology', () => {
      const ws = createMockWs();
      const peer = manager.add(ws, '44.0.0.1', '16127', { source: 'random' });
      // Topology does NOT include 10.0.0.5
      manager.handlePeerExchange(peer, ['10.0.0.99:16127'], []);

      const ws2 = createMockWs();
      manager.add(ws2, '10.0.0.5', '16127', { source: 'random' });
      manager.remove('10.0.0.5:16127', 1006);

      const result = monitor._correlateTopology([peer.key]);
      expect(result.peersGone).to.be.greaterThan(0);
    });
  });

  describe('_triggerDiagnosis — NOT_AFFECTED', () => {
    it('should diagnose NOT_AFFECTED when all peers respond', async () => {
      const ws = createMockWs();
      ws.ping = () => { setImmediate(() => ws.emit('pong')); };
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      const events = [];
      monitor.onHealthEvent((evt) => events.push(evt));

      await monitor._triggerDiagnosis(5);

      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.NOT_AFFECTED);
      expect(events).to.have.length(1);
      expect(events[0].status).to.equal(HEALTH_STATUS.NOT_AFFECTED);
      expect(events[0].evidence.pingResults.responded).to.equal(1);
    });
  });

  describe('_triggerDiagnosis — NETWORK_LOSS', () => {
    it('should diagnose NETWORK_LOSS when no peers respond and probe fails', async () => {
      const ws = createMockWs();
      ws.ping = sinon.stub(); // no pong
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      // Stub probe to return failure
      sinon.stub(monitor, '_probeKnownGoodPeers').resolves({ attempted: 3, succeeded: 0, targets: [] });

      await monitor._triggerDiagnosis(5);

      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.NETWORK_LOSS);
    }).timeout(5000);
  });

  describe('_triggerDiagnosis — IP_CHANGE', () => {
    it('should diagnose IP_CHANGE when no peers respond but probe succeeds', async () => {
      const ws = createMockWs();
      ws.ping = sinon.stub(); // no pong
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      sinon.stub(monitor, '_probeKnownGoodPeers').resolves({ attempted: 3, succeeded: 2, targets: [] });

      await monitor._triggerDiagnosis(5);

      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.IP_CHANGE);
    }).timeout(5000);
  });

  describe('_triggerDiagnosis — DEGRADED', () => {
    it('should diagnose DEGRADED when some peers respond', async () => {
      // Peer 1 responds
      const ws1 = createMockWs();
      ws1.ping = () => { setImmediate(() => ws1.emit('pong')); };
      manager.add(ws1, '44.0.0.1', '16127', { source: 'random' });

      // Peer 2 does not respond
      const ws2 = createMockWs();
      ws2.ping = sinon.stub();
      manager.add(ws2, '45.0.0.1', '16127', { source: 'random' });

      await monitor._triggerDiagnosis(5);

      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.DEGRADED);
    }).timeout(5000);
  });

  describe('observer', () => {
    it('should notify listeners and support unsubscribe', async () => {
      const ws = createMockWs();
      ws.ping = () => { setImmediate(() => ws.emit('pong')); };
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      const events = [];
      const unsub = monitor.onHealthEvent((evt) => events.push(evt));

      await monitor._triggerDiagnosis(5);
      expect(events).to.have.length(1);

      unsub();
      await monitor._triggerDiagnosis(5);
      expect(events).to.have.length(1); // no new event
    });
  });

  describe('diagnosis history', () => {
    it('should record events in ring buffer', async () => {
      const ws = createMockWs();
      ws.ping = () => { setImmediate(() => ws.emit('pong')); };
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      await monitor._triggerDiagnosis(5);
      await monitor._triggerDiagnosis(6);

      const history = monitor.getDiagnosisHistory();
      expect(history).to.have.length(2);
      expect(history[0].triggerReason.disconnectsInWindow).to.equal(5);
      expect(history[1].triggerReason.disconnectsInWindow).to.equal(6);
    });
  });

  describe('_clear', () => {
    it('should reset all state', async () => {
      monitor._inSteadyState = true;
      monitor._firstPeerConnectedAt = Date.now();
      monitor._currentStatus = HEALTH_STATUS.NETWORK_LOSS;
      monitor.onHealthEvent(() => {});
      monitor._clear();

      expect(monitor.isInSteadyState()).to.be.false;
      expect(monitor._firstPeerConnectedAt).to.be.null;
      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.HEALTHY);
      expect(monitor._listeners).to.have.length(0);
      expect(monitor.getDiagnosisHistory()).to.have.length(0);
    });
  });
});
