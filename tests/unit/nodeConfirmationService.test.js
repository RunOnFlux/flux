const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('nodeConfirmationService', () => {
  let service;
  let clock;
  let getFluxNodeStatusStub;
  let getLocalSocketAddressStub;
  let getFluxNodePublicKeyStub;
  let getFluxnodeBySocketAddressStub;
  let logStub;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ shouldAdvanceTime: false });
    getFluxNodeStatusStub = sinon.stub();
    getLocalSocketAddressStub = sinon.stub();
    getFluxNodePublicKeyStub = sinon.stub();
    getFluxnodeBySocketAddressStub = sinon.stub();
    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

    service = proxyquire('../../ZelBack/src/services/nodeConfirmationService', {
      './daemonService/daemonServiceFluxnodeRpcs': { getFluxNodeStatus: getFluxNodeStatusStub },
      './fluxNetworkHelper': {
        getLocalSocketAddress: getLocalSocketAddressStub,
        getFluxNodePublicKey: getFluxNodePublicKeyStub,
      },
      './networkStateService': { getFluxnodeBySocketAddress: getFluxnodeBySocketAddressStub },
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
    await clock.tickAsync(30 * 1000);
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
      await advancePoll();

      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith(true)).to.be.true;
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
    async function advanceByMinutes(minutes) {
      await clock.tickAsync(minutes * 60 * 1000);
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
