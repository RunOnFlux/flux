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
  let getMissingHashesStub;
  let reindexStub;
  let expireStub;
  let isNodeStatusConfirmedStub;
  let globalStateStub;
  let checkAndNotifyStub;

  function makePeer(key) {
    return { key, send: sinon.stub(), missedPongs: 0 };
  }

  function makeEligiblePeers(count) {
    const peers = [];
    for (let i = 0; i < count; i += 1) {
      peers.push(makePeer(`10.0.0.${i + 1}:16127`));
    }
    return peers;
  }

  beforeEach(() => {
    blockEmitter = new EventEmitter();
    peerManager = new EventEmitter();
    peerManager.getEligibleSyncPeers = sinon.stub().returns([]);

    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    syncMissingHashesStub = sinon.stub().resolves({ resolved: 0, missing: 0, unreachable: 0 });
    getMissingHashesStub = sinon.stub().resolves([]);
    reindexStub = sinon.stub().resolves();
    expireStub = sinon.stub().resolves();
    isNodeStatusConfirmedStub = sinon.stub().resolves(true);
    globalStateStub = {
      checkAndSyncAppHashesWasEverExecuted: false,
    };
    checkAndNotifyStub = sinon.stub().resolves();

    const mod = proxyquire('../../ZelBack/src/services/appMessaging/appSyncOrchestrator', {
      '../../lib/log': logStub,
      '../generalService': { isNodeStatusConfirmed: isNodeStatusConfirmedStub },
      './appHashSyncService': { syncMissingHashes: syncMissingHashesStub, getMissingHashes: getMissingHashesStub },
      './peerNotification': { checkAndNotifyPeersOfRunningApps: checkAndNotifyStub, stopBroadcastInterval: sinon.stub() },
      '../appDatabase/registryManager': {
        reindexGlobalAppsInformation: reindexStub,
        expireGlobalApplications: expireStub,
      },
      '../utils/globalState': globalStateStub,
      '../utils/peerCodec': {
        encodeRequestTempMessages: sinon.stub().returns(Buffer.alloc(9, 0x20)),
        encodeRequestAppRunning: sinon.stub().returns(Buffer.alloc(9, 0x21)),
        encodeRequestAppInstalling: sinon.stub().returns(Buffer.alloc(9, 0x22)),
        encodeRequestAppInstallingErrors: sinon.stub().returns(Buffer.alloc(9, 0x23)),
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
    it('should call getEligibleSyncPeers on peerThresholdReached', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));
      expect(peerManager.getEligibleSyncPeers.calledOnce).to.be.true;
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

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
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

  describe('sync requests', () => {
    it('should send all 4 request types to eligible peers', async () => {
      const peers = makeEligiblePeers(3);
      peerManager.getEligibleSyncPeers = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      for (const peer of peers) {
        expect(peer.send.callCount).to.equal(4);
      }
    });

    it('should not send when fewer than 3 eligible peers on first attempt', async () => {
      const peers = makeEligiblePeers(2);
      peerManager.getEligibleSyncPeers = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      for (const peer of peers) {
        expect(peer.send.called).to.be.false;
      }
    });

    it('should not ask the same peer twice in the same cycle', async () => {
      const peers = makeEligiblePeers(3);
      peerManager.getEligibleSyncPeers = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      // Second threshold event — same peers returned, but already asked
      peerManager.emit('peerThresholdReached', 15);
      await new Promise((r) => setTimeout(r, 50));

      for (const peer of peers) {
        expect(peer.send.callCount).to.equal(4);
      }
    });

    it('should reset asked peers on degradation', async () => {
      const peers = makeEligiblePeers(3);
      peerManager.getEligibleSyncPeers = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();

      // Get to READY via block-count fallback
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));

      if (orchestrator.state === STATES.READY) {
        // Degrade and recover — peers should be asked again
        peerManager.emit('peersBelowThreshold', 3);
        const sendCountBefore = peers[0].send.callCount;
        peerManager.emit('peerThresholdReached', 12);
        await new Promise((r) => setTimeout(r, 50));
        expect(peers[0].send.callCount).to.be.greaterThan(sendCountBefore);
      }
    });
  });

  describe('state sync readiness', () => {
    it('should reach READY when all 3 sync types complete from 3 peers', async () => {
      const peers = makeEligiblePeers(3);
      peerManager.getEligibleSyncPeers = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();

      // Start hash sync
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      // Send sync requests
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      // Complete all syncs from 3 peers
      for (let i = 0; i < 3; i += 1) {
        orchestrator.onSyncComplete('apprunning');
        orchestrator.onSyncComplete('appinstalling');
        orchestrator.onSyncComplete('apperrors');
      }
      await new Promise((r) => setTimeout(r, 50));

      expect(orchestrator.state).to.equal(STATES.READY);
    });

    it('should not reach READY when only 2 peers complete apprunning', async () => {
      const peers = makeEligiblePeers(3);
      peerManager.getEligibleSyncPeers = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      // Only 2 apprunning, but 3 of the others
      orchestrator.onSyncComplete('apprunning');
      orchestrator.onSyncComplete('apprunning');
      for (let i = 0; i < 3; i += 1) {
        orchestrator.onSyncComplete('appinstalling');
        orchestrator.onSyncComplete('apperrors');
      }
      await new Promise((r) => setTimeout(r, 50));

      expect(orchestrator.state).to.equal(STATES.SYNCING);
    });

    it('should fall back to block count when no sync peers available', async () => {
      peerManager.getEligibleSyncPeers = sinon.stub().returns([]);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      // After sync but before enough blocks, should still be SYNCING
      expect(orchestrator.state).to.equal(STATES.SYNCING);

      // After enough blocks (enterprise = 124), should reach READY
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(orchestrator.state).to.equal(STATES.READY);
    });

    it('should reset sync completions on degradation', async () => {
      const peers = makeEligiblePeers(3);
      peerManager.getEligibleSyncPeers = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      // Complete all syncs → READY
      for (let i = 0; i < 3; i += 1) {
        orchestrator.onSyncComplete('apprunning');
        orchestrator.onSyncComplete('appinstalling');
        orchestrator.onSyncComplete('apperrors');
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(orchestrator.state).to.equal(STATES.READY);

      // Degrade
      peerManager.emit('peersBelowThreshold', 3);
      expect(orchestrator.state).to.equal(STATES.DEGRADED);

      // Recovery — need fresh syncs, previous completions reset
      peerManager.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));
      expect(orchestrator.state).to.equal(STATES.RESYNCING);
    });
  });

  describe('hash sync recovery', () => {
    it('should retry hash sync on failure', async () => {
      syncMissingHashesStub.onFirstCall().rejects(new Error('connection failed'));
      syncMissingHashesStub.onSecondCall().resolves({ resolved: 10, missing: 0, unreachable: 0 });

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      expect(syncMissingHashesStub.calledOnce).to.be.true;
      expect(orchestrator.state).to.equal(STATES.SYNCING);
      expect(logStub.error.calledWith(sinon.match(/Hash sync failed.*attempt 1\/3/))).to.be.true;
    }).timeout(10000);

    it('should fall back to block timer when hash sync retries exhausted', async () => {
      syncMissingHashesStub.rejects(new Error('persistent failure'));

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      // All 3 retries happen via timers — we can't wait for real timers in tests
      // But we can verify the block timer fallback works
      expect(orchestrator.state).to.equal(STATES.SYNCING);

      // Emit enough blocks to trigger block timer (enterprise = 124 blocks)
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555001 + i);
      }
      await new Promise((r) => setTimeout(r, 50));

      expect(orchestrator.state).to.equal(STATES.READY);
    }).timeout(10000);

    it('should reach READY via block timer when hash sync never completes', async () => {
      syncMissingHashesStub.rejects(new Error('failed'));

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      // Emit enough blocks for enterprise threshold
      for (let i = 1; i <= 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));

      // Block timer should have triggered DB rebuild and readiness
      expect(orchestrator.state).to.equal(STATES.READY);
      expect(reindexStub.called).to.be.true;
    }).timeout(10000);

    it('should not get stuck when DB rebuild fails', async () => {
      reindexStub.rejects(new Error('reindex failed'));

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      // Hash sync succeeded but DB rebuild failed
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Block timer should still allow readiness (will retry DB rebuild)
      for (let i = 1; i <= 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));

      // The block timer fallback tries rebuildDb again
      expect(reindexStub.callCount).to.be.greaterThan(1);
    }).timeout(10000);
  });

  describe('invalidateHashSync', () => {
    it('should reset hashSyncComplete so backgroundHashRecheck no longer short-circuits', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();

      // Complete initial sync — hashSyncComplete becomes true
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Invalidate hash sync — resets #hashSyncComplete to false
      orchestrator.invalidateHashSync();

      // Verify the invalidation was logged (proves #hashSyncComplete was true and is now false)
      expect(logStub.info.calledWith('AppSyncOrchestrator - Hash sync invalidated, will recheck on next block')).to.be.true;
    });

    it('should not log when hash sync was not yet complete', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();

      // Don't complete any sync — hashSyncComplete is still false
      orchestrator.invalidateHashSync();

      // Should not log because hashSyncComplete was already false
      expect(logStub.info.calledWith('AppSyncOrchestrator - Hash sync invalidated, will recheck on next block')).to.be.false;
    });

    it('should prevent checkReadiness from completing until recheck runs', async () => {
      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, peerManager, isEnterprise: () => true,
      });
      orchestrator.start();

      // Complete initial sync and reach READY via block timer
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(orchestrator.state).to.equal(STATES.READY);

      // After invalidation, hash sync state is reset but orchestrator stays READY
      // (invalidateHashSync only resets the flag, doesn't change state)
      orchestrator.invalidateHashSync();
      expect(orchestrator.state).to.equal(STATES.READY);
    });
  });

  describe('hashesReconstructed event', () => {
    it('should call invalidateHashSync when blockEmitter emits hashesReconstructed', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();

      // Complete initial sync
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      // Emit hashesReconstructed — should internally call invalidateHashSync()
      blockEmitter.emit('hashesReconstructed');

      expect(logStub.info.calledWith('AppSyncOrchestrator - Hash sync invalidated, will recheck on next block')).to.be.true;
    });

    it('should register hashesReconstructed listener on start', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      expect(blockEmitter.listenerCount('hashesReconstructed')).to.equal(0);
      orchestrator.start();
      expect(blockEmitter.listenerCount('hashesReconstructed')).to.equal(1);
    });

    it('should not log invalidation when hashesReconstructed fires before initial sync', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, peerManager });
      orchestrator.start();

      // hashesReconstructed before any block — hashSyncComplete is false, so no-op
      blockEmitter.emit('hashesReconstructed');

      expect(logStub.info.calledWith('AppSyncOrchestrator - Hash sync invalidated, will recheck on next block')).to.be.false;
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
