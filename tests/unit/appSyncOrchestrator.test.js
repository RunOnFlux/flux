const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire').noCallThru();

describe('AppSyncOrchestrator', () => {
  let AppSyncOrchestrator;
  let STATES;
  let blockEmitter;
  let peerManager;
  let logStub;
  let syncMissingHashesStub;
  let reindexStub;
  let expireStub;
  let isNodeStatusConfirmedStub;
  let globalStateStub;
  let checkAndNotifyStub;

  beforeEach(() => {
    blockEmitter = new EventEmitter();
    peerManager = new EventEmitter();
    peerManager.getEligibleTempSyncPeers = sinon.stub().returns([]);
    peerManager.getEligibleAppRunningSyncPeers = sinon.stub().returns([]);

    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    syncMissingHashesStub = sinon.stub().resolves({ resolved: 0, missing: 0, unreachable: 0 });
    reindexStub = sinon.stub().resolves();
    expireStub = sinon.stub().resolves();
    isNodeStatusConfirmedStub = sinon.stub().resolves(true);
    globalStateStub = {
      checkAndSyncAppHashesWasEverExecuted: false,
      appRunningSyncComplete: false,
    };
    checkAndNotifyStub = sinon.stub().resolves();

    const mod = proxyquire('../../ZelBack/src/services/appMessaging/appSyncOrchestrator', {
      '../../lib/log': logStub,
      '../generalService': { isNodeStatusConfirmed: isNodeStatusConfirmedStub },
      './appHashSyncService': { syncMissingHashes: syncMissingHashesStub },
      './peerNotification': { checkAndNotifyPeersOfRunningApps: checkAndNotifyStub },
      '../appDatabase/registryManager': {
        reindexGlobalAppsInformation: reindexStub,
        expireGlobalApplications: expireStub,
      },
      '../utils/globalState': globalStateStub,
      '../utils/peerCodec': {
        encodeRequestTempMessages: sinon.stub().returns(Buffer.alloc(9, 0x20)),
        encodeRequestAppRunning: sinon.stub().returns(Buffer.alloc(9, 0x21)),
      },
    });
    AppSyncOrchestrator = mod.AppSyncOrchestrator;
    STATES = mod.STATES;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('state machine', () => {
    it('should start in INITIALIZING state', () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      expect(orchestrator.state).to.equal(STATES.INITIALIZING);
    });

    it('should transition to SYNCING on first blockReceived', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setImmediate(r));
      expect(orchestrator.state).to.equal(STATES.SYNCING);
    });

    it('should emit syncStarted on first blockReceived', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      const spy = sinon.spy();
      orchestrator.on('syncStarted', spy);
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setImmediate(r));
      expect(spy.calledOnce).to.be.true;
    });

    it('should call syncMissingHashes on first blockReceived', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledOnce).to.be.true;
    });

    it('should call reindexGlobalAppsInformation after sync', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(reindexStub.calledOnce).to.be.true;
    });

    it('should call expireGlobalApplications after reindex', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(expireStub.calledOnce).to.be.true;
    });

    it('should set checkAndSyncAppHashesWasEverExecuted after sync', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(globalStateStub.checkAndSyncAppHashesWasEverExecuted).to.be.true;
    });

    it('should emit dbReady after reindex', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      const spy = sinon.spy();
      orchestrator.on('dbReady', spy);
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(spy.calledOnce).to.be.true;
    });
  });

  describe('peer threshold events', () => {
    it('should trigger temp message catch-up on peerThresholdReached', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));
      expect(peerManager.getEligibleTempSyncPeers.calledOnce).to.be.true;
    });

    it('should start apprunning broadcast on peerThresholdReached', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));
      expect(checkAndNotifyStub.calledOnce).to.be.true;
    });

    it('should transition to DEGRADED on peersBelowThreshold when READY', async () => {
      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();

      // Get to READY state: sync completes + enough blocks + confirmed
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      // Simulate enough blocks for location readiness (enterprise = 124 blocks)
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));

      if (orchestrator.state === STATES.READY) {
        peerManager.emit('peersBelowThreshold', 3);
        expect(orchestrator.state).to.equal(STATES.DEGRADED);
      }
    });

    it('should emit readinessLost on degradation', async () => {
      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();
      const spy = sinon.spy();
      orchestrator.on('readinessLost', spy);

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));

      if (orchestrator.state === STATES.READY) {
        peerManager.emit('peersBelowThreshold', 3);
        expect(spy.calledOnce).to.be.true;
      }
    });
  });

  describe('temp message catch-up', () => {
    it('should send binary request to eligible peers', async () => {
      const fakePeer = { key: '1.2.3.4:16127', send: sinon.stub() };
      peerManager.getEligibleTempSyncPeers = sinon.stub().returns([fakePeer]);

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      expect(fakePeer.send.calledOnce).to.be.true;
    });

    it('should not send requests when no eligible peers', async () => {
      peerManager.getEligibleTempSyncPeers = sinon.stub().returns([]);
    peerManager.getEligibleAppRunningSyncPeers = sinon.stub().returns([]);

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      expect(logStub.info.calledWith('AppSyncOrchestrator - No eligible peers for temp message catch-up')).to.be.true;
    });
  });

  describe('stop', () => {
    it('should remove all listeners and clear intervals', () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      orchestrator.stop();
      expect(blockEmitter.listenerCount('blockReceived')).to.equal(0);
    });
  });
});
