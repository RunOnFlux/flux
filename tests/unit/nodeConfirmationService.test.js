const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire').noCallThru();
const config = require('config');

// The service polls on this interval and the staleness helpers below advance the clock
// by exactly one of them, so reading it keeps the two from drifting apart.
const POLL_INTERVAL_MS = config.confirmation.pollIntervalMs;

describe('nodeConfirmationService', () => {
  let service;
  let clock;
  let getFluxNodeStatusStub;
  let getLocalSocketAddressStub;
  let getFluxNodePublicKeyStub;
  let getFluxnodeBySocketAddressStub;
  let logStub;
  let ownAddressKnown;
  let ownAddressChanged;
  let ownAddressUnresolved;
  let ownMoveChanged;
  let listUpdated;
  let peerManager;
  let ownMoveUnderwayStub;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ shouldAdvanceTime: false });
    getFluxNodeStatusStub = sinon.stub();
    getLocalSocketAddressStub = sinon.stub();
    getFluxNodePublicKeyStub = sinon.stub();
    getFluxnodeBySocketAddressStub = sinon.stub();
    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    peerManager = new EventEmitter();
    peerManager.isAboveThreshold = sinon.stub().returns(true);
    ownMoveUnderwayStub = sinon.stub().returns(false);

    service = proxyquire('../../ZelBack/src/services/nodeConfirmationService', {
      './daemonService/daemonServiceFluxnodeRpcs': { getFluxNodeStatus: getFluxNodeStatusStub },
      './fluxNetworkHelper': {
        getLocalSocketAddress: getLocalSocketAddressStub,
        getFluxNodePublicKey: getFluxNodePublicKeyStub,
        onLocalSocketAddressKnown: (listener) => { ownAddressKnown = listener; },
        onLocalSocketAddressChange: (listener) => { ownAddressChanged = listener; },
        onLocalSocketAddressUnresolved: (listener) => { ownAddressUnresolved = listener; },
        onOwnMoveUnderwayChange: (listener) => { ownMoveChanged = listener; },
        ownMoveUnderway: ownMoveUnderwayStub,
      },
      './networkStateService': {
        getFluxnodeBySocketAddress: getFluxnodeBySocketAddressStub,
        onUpdated: (listener) => { listUpdated = listener; },
      },
      './utils/FluxPeerManager': { peerManager },
      '../lib/log': logStub,
    });
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  function setupConfirmed() {
    getFluxNodeStatusStub.resolves({ status: 'success', data: { status: 'CONFIRMED' } });
    getFluxNodePublicKeyStub.resolves('04abcdef1234567890');
    getLocalSocketAddressStub.resolves('1.2.3.4:16127');
    getFluxnodeBySocketAddressStub.resolves({ pubkey: '04abcdef1234567890' });
  }

  function setupNotConfirmed() {
    getFluxNodeStatusStub.resolves({ status: 'success', data: { status: 'STARTED' } });
  }

  function setupConfirmedButIpMissing() {
    getFluxNodeStatusStub.resolves({ status: 'success', data: { status: 'CONFIRMED' } });
    getFluxNodePublicKeyStub.resolves('04abcdef1234567890');
    getLocalSocketAddressStub.resolves('1.2.3.4:16127');
    getFluxnodeBySocketAddressStub.resolves(null);
  }

  async function advancePoll() {
    await clock.tickAsync(POLL_INTERVAL_MS);
  }

  describe('isConfirmed', () => {
    it('should return null before start', () => {
      expect(service.isConfirmed()).to.be.null;
    });

    it('should return true when daemon reports CONFIRMED', async () => {
      setupConfirmed();
      await service.start();
      expect(service.isConfirmed()).to.be.true;
    });

    it('should return false when daemon reports non-CONFIRMED status', async () => {
      setupNotConfirmed();
      await service.start();
      expect(service.isConfirmed()).to.be.false;
    });

    it('should preserve previous state when daemon RPC fails', async () => {
      setupConfirmed();
      await service.start();
      expect(service.isConfirmed()).to.be.true;

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advancePoll();
      expect(service.isConfirmed()).to.be.true;
    });

    it('should preserve previous state when daemon returns error status', async () => {
      setupConfirmed();
      await service.start();
      expect(service.isConfirmed()).to.be.true;

      getFluxNodeStatusStub.resolves({ status: 'error', data: 'daemon loading' });
      await advancePoll();
      expect(service.isConfirmed()).to.be.true;
    });

    it('should remain null on first poll when RPC fails', async () => {
      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await service.start();
      expect(service.isConfirmed()).to.be.null;
    });
  });

  describe('canSendMessages', () => {
    it('should return false before start', () => {
      expect(service.canSendMessages()).to.be.false;
    });

    it('should return true when all four checks pass', async () => {
      setupConfirmed();
      await service.start();
      expect(service.canSendMessages()).to.be.true;
    });

    it('should return false when confirmed but IP not in deterministic list', async () => {
      setupConfirmedButIpMissing();
      await service.start();
      expect(service.isConfirmed()).to.be.true;
      expect(service.canSendMessages()).to.be.false;
    });

    it('should return false when confirmed but pubkey mismatch', async () => {
      getFluxNodeStatusStub.resolves({ status: 'success', data: { status: 'CONFIRMED' } });
      getFluxNodePublicKeyStub.resolves('04abcdef1234567890');
      getLocalSocketAddressStub.resolves('1.2.3.4:16127');
      getFluxnodeBySocketAddressStub.resolves({ pubkey: '04different9876543210' });

      await service.start();

      expect(service.isConfirmed()).to.be.true;
      expect(service.canSendMessages()).to.be.false;
    });

    it('should return false when confirmed but IP detection fails', async () => {
      getFluxNodeStatusStub.resolves({ status: 'success', data: { status: 'CONFIRMED' } });
      getFluxNodePublicKeyStub.resolves('04abcdef1234567890');
      getLocalSocketAddressStub.resolves(null);

      await service.start();

      expect(service.isConfirmed()).to.be.true;
      expect(service.canSendMessages()).to.be.false;
    });

    it('should return false when not confirmed', async () => {
      setupNotConfirmed();
      await service.start();
      expect(service.canSendMessages()).to.be.false;
    });
  });

  describe('onMessageCapabilityChange', () => {
    it('is heard the moment the node learns its address', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);
      setupConfirmed();
      getLocalSocketAddressStub.resolves(null);
      await service.start();
      expect(service.canSendMessages()).to.be.false;

      getLocalSocketAddressStub.resolves('1.2.3.4:16127');
      ownAddressKnown('1.2.3.4:16127');
      await clock.tickAsync(0);

      expect(service.canSendMessages()).to.be.true;
      sinon.assert.calledOnceWithExactly(callback, true);
    });

    it('reports one change when two checks start together', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);
      setupConfirmed();
      getLocalSocketAddressStub.resolves(null);
      await service.start();

      let answerFirstCheck;
      getLocalSocketAddressStub.onCall(1).returns(new Promise((resolve) => { answerFirstCheck = resolve; }));
      getLocalSocketAddressStub.resolves('1.2.3.4:16127');
      ownAddressKnown('1.2.3.4:16127');
      listUpdated();
      await clock.tickAsync(0);
      answerFirstCheck('1.2.3.4:16127');
      await clock.tickAsync(0);

      sinon.assert.calledOnceWithExactly(callback, true);
    });

    it('should fire callback on false→true transition', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);

      setupConfirmed();
      await service.start();

      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith(true)).to.be.true;
    });

    it('should fire callback on true→false transition', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);

      setupConfirmed();
      await service.start();
      expect(callback.calledOnce).to.be.true;
      expect(callback.firstCall.calledWith(true)).to.be.true;

      setupNotConfirmed();
      await advancePoll();

      expect(callback.calledTwice).to.be.true;
      expect(callback.secondCall.calledWith(false)).to.be.true;
    });

    it('should not fire callback when state unchanged', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);

      setupNotConfirmed();
      await service.start();
      await advancePoll();

      expect(callback.called).to.be.false;
    });

    it('should not fire when confirmed changes but canSendMessages stays false', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);

      setupNotConfirmed();
      await service.start();

      setupConfirmedButIpMissing();
      await advancePoll();

      expect(callback.called).to.be.false;
    });

    it('should fire when IP appears in deterministic list after delay', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);

      setupConfirmedButIpMissing();
      await service.start();
      expect(callback.called).to.be.false;

      setupConfirmed();
      listUpdated();
      await clock.tickAsync(0);

      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith(true)).to.be.true;
    });

    it('no capability check runs on the poll once the daemon says nothing new', async () => {
      setupConfirmed();
      await service.start();
      const reads = getLocalSocketAddressStub.callCount;

      await advancePoll();
      await advancePoll();

      expect(getLocalSocketAddressStub.callCount).to.equal(reads);
    });

    it('asks again when the daemon starts confirming the node', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);
      setupNotConfirmed();
      await service.start();

      setupConfirmed();
      await advancePoll();

      sinon.assert.calledOnceWithExactly(callback, true);
    });

    it('a node below the peer threshold cannot be heard, however well listed', async () => {
      setupConfirmed();
      peerManager.isAboveThreshold.returns(false);
      await service.start();

      expect(service.canSendMessages()).to.be.false;
    });

    it('loses capability when its peers fall below the threshold, and regains it at the threshold', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);
      setupConfirmed();
      await service.start();

      peerManager.isAboveThreshold.returns(false);
      peerManager.emit('peersBelowThreshold', 3, { deliberate: false });
      await clock.tickAsync(0);
      expect(service.canSendMessages()).to.be.false;

      peerManager.isAboveThreshold.returns(true);
      peerManager.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      expect(service.canSendMessages()).to.be.true;

      expect(callback.args).to.deep.equal([[true], [false], [true]]);
    });

    it('stays lost through its peers returning while a move is under way', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);
      setupConfirmed();
      await service.start();

      ownMoveUnderwayStub.returns(true);
      ownMoveChanged(true);
      await clock.tickAsync(0);
      peerManager.emit('peerThresholdReached', 12);
      listUpdated();
      ownAddressChanged('5.6.7.8:16127');
      await clock.tickAsync(0);

      expect(service.canSendMessages()).to.be.false;
      expect(callback.args).to.deep.equal([[true], [false]]);
    });

    it('regains capability once when a move ends with the node listed and its peers held', async () => {
      const callback = sinon.spy();
      service.onMessageCapabilityChange(callback);
      setupConfirmed();
      await service.start();
      ownMoveUnderwayStub.returns(true);
      ownMoveChanged(true);
      await clock.tickAsync(0);

      ownMoveUnderwayStub.returns(false);
      ownMoveChanged(false);
      await clock.tickAsync(0);

      expect(callback.args).to.deep.equal([[true], [false], [true]]);
    });

    it('loses capability when the node list stops holding it', async () => {
      setupConfirmed();
      await service.start();

      getFluxnodeBySocketAddressStub.resolves(null);
      listUpdated();
      await clock.tickAsync(0);

      expect(service.canSendMessages()).to.be.false;
    });

    it('loses capability when a read finds the node has no address', async () => {
      setupConfirmed();
      await service.start();

      getLocalSocketAddressStub.resolves(null);
      ownAddressUnresolved();
      await clock.tickAsync(0);

      expect(service.canSendMessages()).to.be.false;
    });

    it('a node with no address does not check itself in a loop', async () => {
      setupConfirmed();
      getLocalSocketAddressStub.resolves(null);
      await service.start();
      const reads = getLocalSocketAddressStub.callCount;

      ownAddressUnresolved();
      await clock.tickAsync(0);

      expect(getLocalSocketAddressStub.callCount).to.equal(reads);
    });

    it('asks nothing of a node the daemon does not confirm', async () => {
      setupNotConfirmed();
      await service.start();
      const reads = getLocalSocketAddressStub.callCount;

      peerManager.emit('peerThresholdReached', 12);
      listUpdated();
      await clock.tickAsync(0);

      expect(getLocalSocketAddressStub.callCount).to.equal(reads);
    });
  });

  describe('onConfirmationChange', () => {
    it('should fire on false→true transition', async () => {
      const callback = sinon.spy();
      service.onConfirmationChange(callback);

      setupConfirmed();
      await service.start();

      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith(true)).to.be.true;
    });

    it('should fire on true→false transition', async () => {
      const callback = sinon.spy();
      service.onConfirmationChange(callback);

      setupConfirmed();
      await service.start();

      setupNotConfirmed();
      await advancePoll();

      expect(callback.calledTwice).to.be.true;
      expect(callback.secondCall.calledWith(false)).to.be.true;
    });

    it('should not fire when RPC is unreachable', async () => {
      const callback = sinon.spy();
      service.onConfirmationChange(callback);

      setupConfirmed();
      await service.start();
      expect(callback.calledOnce).to.be.true;

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advancePoll();

      expect(callback.calledOnce).to.be.true;
    });

    it('should not fire when daemon returns error status', async () => {
      const callback = sinon.spy();
      service.onConfirmationChange(callback);

      setupConfirmed();
      await service.start();
      expect(callback.calledOnce).to.be.true;

      getFluxNodeStatusStub.resolves({ status: 'error', data: 'daemon loading' });
      await advancePoll();

      expect(callback.calledOnce).to.be.true;
    });

    it('should fire independently from message capability', async () => {
      const confirmCb = sinon.spy();
      const messageCb = sinon.spy();
      service.onConfirmationChange(confirmCb);
      service.onMessageCapabilityChange(messageCb);

      setupConfirmedButIpMissing();
      await service.start();

      expect(confirmCb.calledOnce).to.be.true;
      expect(confirmCb.calledWith(true)).to.be.true;
      expect(messageCb.called).to.be.false;
    });
  });

  describe('waitForConfirmed', () => {
    it('should resolve immediately when already confirmed', async () => {
      setupConfirmed();
      await service.start();

      let resolved = false;
      service.waitForConfirmed().then(() => { resolved = true; });
      await Promise.resolve();
      expect(resolved).to.be.true;
    });

    it('should wait until confirmed', async () => {
      setupNotConfirmed();
      await service.start();

      let resolved = false;
      service.waitForConfirmed().then(() => { resolved = true; });
      await Promise.resolve();
      expect(resolved).to.be.false;

      setupConfirmed();
      await advancePoll();
      expect(resolved).to.be.true;
    });

    it('should resolve multiple waiters on confirmation', async () => {
      setupNotConfirmed();
      await service.start();

      let resolved1 = false;
      let resolved2 = false;
      service.waitForConfirmed().then(() => { resolved1 = true; });
      service.waitForConfirmed().then(() => { resolved2 = true; });
      await Promise.resolve();
      expect(resolved1).to.be.false;
      expect(resolved2).to.be.false;

      setupConfirmed();
      await advancePoll();
      expect(resolved1).to.be.true;
      expect(resolved2).to.be.true;
    });
  });

  describe('daemon staleness', () => {
    // Staleness is derived from Date.now() when a poll runs, so only the poll landing
    // after the threshold decides the outcome. Move the clock, then run that one poll.
    async function advanceByMinutes(minutes) {
      clock.setSystemTime(Date.now() + minutes * 60 * 1000 - POLL_INTERVAL_MS);
      await clock.tickAsync(POLL_INTERVAL_MS);
    }

    it('should not be stale initially', async () => {
      setupConfirmed();
      await service.start();
      expect(service.isDaemonStale()).to.be.false;
    });

    it('should become stale after 125 minutes of RPC failure', async () => {
      setupConfirmed();
      await service.start();

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advanceByMinutes(126);

      expect(service.isDaemonStale()).to.be.true;
      expect(service.isConfirmed()).to.be.true;
    });

    it('should not be stale after brief RPC failure', async () => {
      setupConfirmed();
      await service.start();

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advanceByMinutes(10);

      expect(service.isDaemonStale()).to.be.false;
      expect(service.isConfirmed()).to.be.true;
    });

    it('should fire onDaemonStale callback at 125 minutes', async () => {
      const callback = sinon.spy();
      service.onDaemonStale(callback);

      setupConfirmed();
      await service.start();

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advanceByMinutes(124);
      expect(callback.called).to.be.false;

      await advanceByMinutes(2);
      expect(callback.calledOnce).to.be.true;
    });

    // Staleness latches: the transition is announced once, not on every poll for the
    // hours the daemon stays unreachable. Each of these polls again past the threshold,
    // which is the only way to exercise the latch.
    it('should fire onDaemonStale once however long the daemon stays unreachable', async () => {
      const callback = sinon.spy();
      service.onDaemonStale(callback);

      setupConfirmed();
      await service.start();

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advanceByMinutes(126);
      expect(callback.calledOnce).to.be.true;

      await advancePoll();
      await advancePoll();

      expect(callback.calledOnce).to.be.true;
    });

    it('should report lost confirmation once however long the daemon stays unreachable', async () => {
      const confirmCb = sinon.spy();
      service.onConfirmationChange(confirmCb);

      setupConfirmed();
      await service.start();
      expect(confirmCb.calledOnce).to.be.true;

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advanceByMinutes(321);
      expect(confirmCb.calledTwice).to.be.true;

      await advancePoll();
      await advancePoll();

      expect(confirmCb.calledTwice).to.be.true;
    });

    it('should not fire onDaemonStale on brief RPC failures', async () => {
      const callback = sinon.spy();
      service.onDaemonStale(callback);

      setupConfirmed();
      await service.start();

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advanceByMinutes(10);

      expect(callback.called).to.be.false;
    });

    it('should preserve messageCapable during staleness', async () => {
      setupConfirmed();
      await service.start();
      expect(service.canSendMessages()).to.be.true;

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advanceByMinutes(126);

      expect(service.isDaemonStale()).to.be.true;
      expect(service.canSendMessages()).to.be.true;
    });

    it('should set daemonConfirmed false after 320 minutes', async () => {
      const confirmCb = sinon.spy();
      service.onConfirmationChange(confirmCb);

      setupConfirmed();
      await service.start();
      expect(confirmCb.calledOnce).to.be.true;

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advanceByMinutes(321);

      expect(service.isConfirmed()).to.be.false;
      expect(service.canSendMessages()).to.be.false;
      expect(confirmCb.calledTwice).to.be.true;
      expect(confirmCb.secondCall.calledWith(false)).to.be.true;
    });

    it('should recover when daemon comes back after staleness', async () => {
      const staleCb = sinon.spy();
      service.onDaemonStale(staleCb);

      setupConfirmed();
      await service.start();

      getFluxNodeStatusStub.rejects(new Error('connection refused'));
      await advanceByMinutes(126);
      expect(service.isDaemonStale()).to.be.true;
      expect(staleCb.calledOnce).to.be.true;

      setupConfirmed();
      await advancePoll();
      expect(service.isDaemonStale()).to.be.false;
      expect(service.isConfirmed()).to.be.true;
      expect(service.canSendMessages()).to.be.true;
    });
  });

  describe('start', () => {
    it('should not start twice', async () => {
      setupNotConfirmed();
      await service.start();
      await service.start();
      expect(getFluxNodeStatusStub.calledOnce).to.be.true;
    });
  });
});
