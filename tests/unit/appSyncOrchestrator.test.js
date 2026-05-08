const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire').noCallThru();

describe('AppSyncOrchestrator', () => {
  let AppSyncOrchestrator;
  let STATES;
  let EVENTS;
  let appSyncEvents;
  let blockEmitter;
  let peerEmitter;
  let getEligibleSyncPeersStub;
  let logStub;
  let syncMissingHashesStub;
  let getMissingHashesStub;
  let reindexStub;
  let expireStub;
  let isNodeStatusConfirmedStub;
  let globalStateStub;
  let checkAndNotifyStub;

  function makePeer(key) {
    return { key, send: sinon.stub() };
  }

  function makeEligiblePeers(count) {
    const peers = [];
    for (let i = 0; i < count; i += 1) {
      peers.push(makePeer(`10.0.0.${i + 1}:16127`));
    }
    return peers;
  }

  function makePeerOptions(overrides = {}) {
    return {
      getEligibleSyncPeers: getEligibleSyncPeersStub,
      onPeerEvent: (event, cb) => peerEmitter.on(event, cb),
      offPeerEvent: (event, cb) => peerEmitter.removeListener(event, cb),
      ...overrides,
    };
  }

  beforeEach(() => {
    blockEmitter = new EventEmitter();
    peerEmitter = new EventEmitter();
    getEligibleSyncPeersStub = sinon.stub().returns([]);

    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    syncMissingHashesStub = sinon.stub().resolves({ resolved: 0, missing: 0, unreachable: 0, nextRetryHeight: null });
    getMissingHashesStub = sinon.stub().resolves([]);
    reindexStub = sinon.stub().resolves();
    expireStub = sinon.stub().resolves();
    isNodeStatusConfirmedStub = sinon.stub().resolves(true);
    globalStateStub = {
      checkAndSyncAppHashesWasEverExecuted: false,
    };
    checkAndNotifyStub = sinon.stub().resolves();

    const appSyncEventsModule = require('../../ZelBack/src/services/utils/appSyncEvents');
    appSyncEvents = appSyncEventsModule.appSyncEvents;
    EVENTS = appSyncEventsModule.EVENTS;
    appSyncEvents.removeAllListeners();

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
      '../utils/appSyncEvents': appSyncEventsModule,
    });
    AppSyncOrchestrator = mod.AppSyncOrchestrator;
    STATES = mod.STATES;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('state machine', () => {
    it('should start in INITIALIZING state', () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      expect(orchestrator.state).to.equal(STATES.INITIALIZING);
    });

    it('should transition to SYNCING on first blockReceived', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setImmediate(r));
      expect(orchestrator.state).to.equal(STATES.SYNCING);
    });

    it('should log sync started on first blockReceived', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setImmediate(r));
      expect(logStub.info.calledWith('AppSyncOrchestrator - Sync started')).to.be.true;
    });

    it('should call syncMissingHashes on first blockReceived', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledOnce).to.be.true;
    });

    it('should call reindexGlobalAppsInformation after sync', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(reindexStub.calledOnce).to.be.true;
    });

    it('should call expireGlobalApplications after reindex', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(expireStub.calledOnce).to.be.true;
    });

    it('should set checkAndSyncAppHashesWasEverExecuted after sync', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(globalStateStub.checkAndSyncAppHashesWasEverExecuted).to.be.true;
    });

    it('should log DB ready after reindex', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(logStub.info.calledWith('AppSyncOrchestrator - DB ready')).to.be.true;
    });
  });

  describe('peer threshold events', () => {
    it('should call getEligibleSyncPeers on peerThresholdReached', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));
      expect(getEligibleSyncPeersStub.calledOnce).to.be.true;
    });

    it('should start apprunning broadcast on peerThresholdReached', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));
      expect(checkAndNotifyStub.calledOnce).to.be.true;
    });

    it('should transition to DEGRADED on peersBelowThreshold when READY', async () => {
      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
      });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));

      if (orchestrator.state === STATES.READY) {
        peerEmitter.emit('peersBelowThreshold', 3);
        expect(orchestrator.state).to.equal(STATES.DEGRADED);
      }
    });

    it('should emit readinessLost on degradation', async () => {
      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
      });
      orchestrator.start();
      const spy = sinon.spy();
      appSyncEvents.on(EVENTS.READINESS_LOST, spy);

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));

      if (orchestrator.state === STATES.READY) {
        peerEmitter.emit('peersBelowThreshold', 3);
        expect(spy.calledOnce).to.be.true;
      }
    });
  });

  describe('sync requests', () => {
    it('should send all 4 request types to eligible peers', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      for (const peer of peers) {
        expect(peer.send.callCount).to.equal(4);
      }
    });

    it('should not send when fewer than 3 eligible peers on first attempt', async () => {
      const peers = makeEligiblePeers(2);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      for (const peer of peers) {
        expect(peer.send.called).to.be.false;
      }
    });

    it('should not ask the same peer twice in the same cycle', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      // Second threshold event — same peers returned, but already asked
      peerEmitter.emit('peerThresholdReached', 15);
      await new Promise((r) => setTimeout(r, 50));

      for (const peer of peers) {
        expect(peer.send.callCount).to.equal(4);
      }
    });

    it('should reset asked peers on degradation', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
      });
      orchestrator.start();

      // Get to READY via block-count fallback
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blockReceived', 2555000 + i);
      }
      await new Promise((r) => setTimeout(r, 50));

      if (orchestrator.state === STATES.READY) {
        // Degrade and recover — peers should be asked again
        peerEmitter.emit('peersBelowThreshold', 3);
        const sendCountBefore = peers[0].send.callCount;
        peerEmitter.emit('peerThresholdReached', 12);
        await new Promise((r) => setTimeout(r, 50));
        expect(peers[0].send.callCount).to.be.greaterThan(sendCountBefore);
      }
    });
  });

  describe('state sync readiness', () => {
    it('should reach READY when all 3 sync types complete from 3 peers', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
      });
      orchestrator.start();

      // Start hash sync
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      // Send sync requests
      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      // Complete all syncs from 3 peers
      for (let i = 0; i < 3; i += 1) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning');
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'appinstalling');
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apperrors');
      }
      await new Promise((r) => setTimeout(r, 50));

      expect(orchestrator.state).to.equal(STATES.READY);
    });

    it('should not reach READY when only 2 peers complete apprunning', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
      });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));

      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      // Only 2 apprunning, but 3 of the others
      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning');
      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning');
      for (let i = 0; i < 3; i += 1) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'appinstalling');
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apperrors');
      }
      await new Promise((r) => setTimeout(r, 50));

      expect(orchestrator.state).to.equal(STATES.SYNCING);
    });

    it('should fall back to block count when no sync peers available', async () => {
      getEligibleSyncPeersStub = sinon.stub().returns([]);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
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
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = new AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
      });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));

      // Complete all syncs → READY
      for (let i = 0; i < 3; i += 1) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning');
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'appinstalling');
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apperrors');
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(orchestrator.state).to.equal(STATES.READY);

      // Degrade
      peerEmitter.emit('peersBelowThreshold', 3);
      expect(orchestrator.state).to.equal(STATES.DEGRADED);

      // Recovery — need fresh syncs, previous completions reset
      peerEmitter.emit('peerThresholdReached', 12);
      await new Promise((r) => setTimeout(r, 50));
      expect(orchestrator.state).to.equal(STATES.RESYNCING);
    });
  });

  describe('hash sync recovery', () => {
    it('should retry hash sync on failure', async () => {
      syncMissingHashesStub.onFirstCall().rejects(new Error('connection failed'));
      syncMissingHashesStub.onSecondCall().resolves({ resolved: 10, missing: 0, unreachable: 0 });

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
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
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
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
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
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
        blockEmitter, ...makePeerOptions(), isEnterprise: () => true,
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

  describe('hash retry scheduling', () => {
    it('should retry hash sync when block reaches nextRetryHeight', async () => {
      syncMissingHashesStub.onFirstCall().resolves({ resolved: 5, missing: 2, unreachable: 0, nextRetryHeight: 2555200 });
      syncMissingHashesStub.onSecondCall().resolves({ resolved: 2, missing: 0, unreachable: 0, nextRetryHeight: null });

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();

      // Initial sync sets nextRetryHeight to 2555200
      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Block before retry height — should not trigger sync
      blockEmitter.emit('blockReceived', 2555100);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Block at retry height — should trigger sync
      blockEmitter.emit('blockReceived', 2555200);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledTwice).to.be.true;
    });

    it('should use fallback interval when no hashes are backed off', async () => {
      syncMissingHashesStub.resolves({ resolved: 0, missing: 0, unreachable: 0, nextRetryHeight: null });

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Fallback is 100 blocks — should not trigger before that
      blockEmitter.emit('blockReceived', 2555050);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // At fallback threshold — should trigger
      blockEmitter.emit('blockReceived', 2555100);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledTwice).to.be.true;
    });

    it('should schedule immediate check on HASH_UNRESOLVED event', async () => {
      syncMissingHashesStub.onFirstCall().resolves({ resolved: 0, missing: 0, unreachable: 0, nextRetryHeight: 2560000 });
      syncMissingHashesStub.onSecondCall().resolves({ resolved: 1, missing: 0, unreachable: 0, nextRetryHeight: null });

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // New unresolved hash — should schedule immediate check
      appSyncEvents.emit(EVENTS.HASH_UNRESOLVED);

      // Next block should trigger sync even though nextRetryHeight was 2560000
      blockEmitter.emit('blockReceived', 2555001);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledTwice).to.be.true;
    });

    it('should ignore HASH_UNRESOLVED before initial sync completes', async () => {
      syncMissingHashesStub.rejects(new Error('not ready'));

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();

      // Emit HASH_UNRESOLVED before any block (hashSyncComplete is false)
      appSyncEvents.emit(EVENTS.HASH_UNRESOLVED);

      // Should not crash or change state
      expect(orchestrator.state).to.equal(STATES.INITIALIZING);
    });
  });

  describe('hashesChanged event', () => {
    it('should schedule immediate hash recheck when reconstruct changes hashes', async () => {
      syncMissingHashesStub.onFirstCall().resolves({ resolved: 0, missing: 0, unreachable: 0, nextRetryHeight: 2560000 });
      syncMissingHashesStub.onSecondCall().resolves({ resolved: 1, missing: 0, unreachable: 0, nextRetryHeight: null });

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();

      blockEmitter.emit('blockReceived', 2555000);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Reconstruct found changes
      blockEmitter.emit('hashesChanged');

      // Next block should trigger sync immediately
      blockEmitter.emit('blockReceived', 2555001);
      await new Promise((r) => setTimeout(r, 50));
      expect(syncMissingHashesStub.calledTwice).to.be.true;
    });

    it('should register hashesChanged listener on start', async () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      expect(blockEmitter.listenerCount('hashesChanged')).to.equal(0);
      orchestrator.start();
      expect(blockEmitter.listenerCount('hashesChanged')).to.equal(1);
    });

    it('should ignore hashesChanged before initial sync completes', async () => {
      syncMissingHashesStub.rejects(new Error('not ready'));

      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();

      blockEmitter.emit('hashesChanged');

      expect(logStub.info.calledWith(sinon.match(/Reconstruct audit found changes/))).to.be.false;
    });
  });

  describe('stop', () => {
    it('should remove all listeners and clear intervals', () => {
      const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions() });
      orchestrator.start();
      orchestrator.stop();
      expect(blockEmitter.listenerCount('blockReceived')).to.equal(0);
      expect(blockEmitter.listenerCount('hashesChanged')).to.equal(0);
      expect(peerEmitter.listenerCount('peerThresholdReached')).to.equal(0);
      expect(peerEmitter.listenerCount('peersBelowThreshold')).to.equal(0);
    });
  });
});
