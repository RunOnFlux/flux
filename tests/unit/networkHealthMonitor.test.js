const chai = require('chai');
const sinon = require('sinon');
const EventEmitter = require('events');
const WebSocket = require('ws');

const { expect } = chai;

const {
  NetworkHealthMonitor,
  HEALTH_STATUS,
  isUnexpectedDisconnect,
  VELOCITY_BUFFER_SIZE,
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
    monitor.reset();
    manager.reset();
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
      // After recordConnect, the monitor should have recorded a timestamp internally.
      // We verify indirectly: calling recordConnect again after STEADY_STATE_DELAY should enter steady state.
      monitor._testSetup({ firstPeerConnectedAt: Date.now() - STEADY_STATE_DELAY_MS - 1 });
      monitor.recordConnect();
      expect(monitor.isInSteadyState()).to.be.true;
    });

    it('should not enter steady state before delay', () => {
      monitor._testSetup({ firstPeerConnectedAt: Date.now() - 1000 }); // 1s ago
      monitor.recordConnect();
      expect(monitor.isInSteadyState()).to.be.false;
    });

    it('should enter steady state after delay', () => {
      monitor._testSetup({ firstPeerConnectedAt: Date.now() - STEADY_STATE_DELAY_MS - 1 });
      monitor.recordConnect();
      expect(monitor.isInSteadyState()).to.be.true;
    });

    it('should reset to HEALTHY when peers recover after network loss', () => {
      monitor._testSetup({ currentStatus: HEALTH_STATUS.NETWORK_LOSS });
      // Simulate 5 peers connected via peerManager
      for (let i = 1; i <= 5; i++) {
        const ws = createMockWs();
        manager.add(ws, `44.0.0.${i}`, '16127', { source: 'random' });
      }
      monitor.recordConnect();
      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.HEALTHY);
    });

    it('should not reset to HEALTHY with too few peers', () => {
      monitor._testSetup({ currentStatus: HEALTH_STATUS.NETWORK_LOSS });
      const ws = createMockWs();
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });
      monitor.recordConnect();
      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.NETWORK_LOSS);
    });
  });

  describe('recordDisconnect / velocity filtering', () => {
    it('should ignore short-lived connections', () => {
      const recentConnect = Date.now() - 5000; // 5s ago — below MIN_CONNECTION_AGE_MS
      monitor.recordDisconnect(recentConnect, undefined);
      expect(monitor.velocityCount).to.equal(0);
    });

    it('should ignore policy close codes', () => {
      const oldConnect = Date.now() - 60000; // 60s ago
      monitor.recordDisconnect(oldConnect, CLOSE_CODES.BLOCKED_INBOUND);
      expect(monitor.velocityCount).to.equal(0);
    });

    it('should record established unexpected disconnects', () => {
      const oldConnect = Date.now() - 60000;
      monitor.recordDisconnect(oldConnect, undefined);
      expect(monitor.velocityCount).to.equal(1);
    });

    it('should record DEAD_CONNECTION disconnects', () => {
      const oldConnect = Date.now() - 60000;
      monitor.recordDisconnect(oldConnect, CLOSE_CODES.DEAD_CONNECTION);
      expect(monitor.velocityCount).to.equal(1);
    });
  });

  describe('velocity calculation', () => {
    it('should count disconnects within window', () => {
      // Record 3 recent disconnects via the public API
      const oldConnect = Date.now() - 60000;
      for (let i = 0; i < 3; i++) {
        monitor.recordDisconnect(oldConnect, undefined);
      }
      expect(monitor.velocityCount).to.equal(3);
    });
  });

  describe('diagnosis gating', () => {
    it('should not trigger before steady state', () => {
      const oldConnect = Date.now() - 60000;
      // Not in steady state, so diagnosis should not be triggered
      for (let i = 0; i < VELOCITY_THRESHOLD_COUNT + 1; i++) {
        monitor.recordDisconnect(oldConnect, undefined);
      }
      // If diagnosis had triggered, status would have changed
      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.HEALTHY);
      expect(monitor.isDiagnosing).to.be.false;
    });

    it('should not trigger during cooldown', () => {
      monitor._testSetup({ inSteadyState: true, lastDiagnosisAt: Date.now() });
      const oldConnect = Date.now() - 60000;
      for (let i = 0; i < VELOCITY_THRESHOLD_COUNT + 1; i++) {
        monitor.recordDisconnect(oldConnect, undefined);
      }
      // Status should remain HEALTHY because cooldown blocked diagnosis
      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.HEALTHY);
    });

    it('should not trigger while already diagnosing', () => {
      monitor._testSetup({ inSteadyState: true, diagnosing: true });
      const oldConnect = Date.now() - 60000;
      for (let i = 0; i < VELOCITY_THRESHOLD_COUNT + 1; i++) {
        monitor.recordDisconnect(oldConnect, undefined);
      }
      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.HEALTHY);
    });

    it('should trigger when velocity exceeds threshold in steady state', async () => {
      monitor._testSetup({ inSteadyState: true, lastDiagnosisAt: 0 });

      // Add a peer that responds to ping so diagnosis completes
      const ws = createMockWs();
      ws.ping = () => { setImmediate(() => ws.emit('pong')); };
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      const oldConnect = Date.now() - 60000;
      for (let i = 0; i < VELOCITY_THRESHOLD_COUNT; i++) {
        monitor.recordDisconnect(oldConnect, undefined);
      }
      // Wait for async diagnosis to complete
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Diagnosis should have run and changed status
      expect(monitor.getStatus()).to.not.equal(HEALTH_STATUS.HEALTHY);
    });
  });

  describe('diagnose — NOT_AFFECTED', () => {
    it('should diagnose NOT_AFFECTED when all peers respond', async () => {
      const ws = createMockWs();
      ws.ping = () => { setImmediate(() => ws.emit('pong')); };
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      const events = [];
      monitor.onHealthEvent((evt) => events.push(evt));

      await monitor.diagnose(5);

      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.NOT_AFFECTED);
      expect(events).to.have.length(1);
      expect(events[0].status).to.equal(HEALTH_STATUS.NOT_AFFECTED);
      expect(events[0].evidence.pingResults.responded).to.equal(1);
    });
  });

  describe('diagnose — NETWORK_LOSS', () => {
    it('should diagnose NETWORK_LOSS when no peers respond and probe fails', async () => {
      const ws = createMockWs();
      ws.ping = sinon.stub(); // no pong
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      // We cannot stub private #probeKnownGoodPeers directly.
      // Instead, stub the external dependency so probing returns no results.
      const networkStateService = require('../../ZelBack/src/services/networkStateService');
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves(null);

      await monitor.diagnose(5);

      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.NETWORK_LOSS);
    }).timeout(10000);
  });

  describe('diagnose — DEGRADED', () => {
    it('should diagnose DEGRADED when some peers respond', async () => {
      // Peer 1 responds
      const ws1 = createMockWs();
      ws1.ping = () => { setImmediate(() => ws1.emit('pong')); };
      manager.add(ws1, '44.0.0.1', '16127', { source: 'random' });

      // Peer 2 does not respond
      const ws2 = createMockWs();
      ws2.ping = sinon.stub();
      manager.add(ws2, '45.0.0.1', '16127', { source: 'random' });

      await monitor.diagnose(5);

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

      await monitor.diagnose(5);
      expect(events).to.have.length(1);

      unsub();
      await monitor.diagnose(5);
      expect(events).to.have.length(1); // no new event
    });
  });

  describe('diagnosis history', () => {
    it('should record events in ring buffer', async () => {
      const ws = createMockWs();
      ws.ping = () => { setImmediate(() => ws.emit('pong')); };
      manager.add(ws, '44.0.0.1', '16127', { source: 'random' });

      await monitor.diagnose(5);
      await monitor.diagnose(6);

      const history = monitor.getDiagnosisHistory();
      expect(history).to.have.length(2);
      expect(history[0].triggerReason.disconnectsInWindow).to.equal(5);
      expect(history[1].triggerReason.disconnectsInWindow).to.equal(6);
    });
  });

  describe('reset', () => {
    it('should reset all state', async () => {
      monitor._testSetup({
        inSteadyState: true,
        firstPeerConnectedAt: Date.now(),
        currentStatus: HEALTH_STATUS.NETWORK_LOSS,
      });
      monitor.onHealthEvent(() => {});
      monitor.reset();

      expect(monitor.isInSteadyState()).to.be.false;
      expect(monitor.getStatus()).to.equal(HEALTH_STATUS.HEALTHY);
      expect(monitor.getDiagnosisHistory()).to.have.length(0);
    });
  });
});
