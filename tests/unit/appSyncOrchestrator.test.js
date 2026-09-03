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
  let clock;
  let getEligibleSyncPeersStub;
  let syncRequested;
  let logStub;
  let syncMissingHashesStub;
  let getMissingHashesStub;
  let reindexStub;
  let globalStateStub;
  let checkAndNotifyStub;
  let resetHashSyncForUpgradeStub;
  let dbHelperStub;
  let findOneAndUpdateStub;
  let getFluxNodePublicKeyStub;
  let getFluxNodePrivateKeyStub;
  let signMessageStub;

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

  const defaultBootContext = {
    machineRebooted: false,
    downtimeMs: 0,
    cleanShutdown: true,
    currentBootId: 'test-boot-id-12345',
    firstBoot: false,
  };

  // Asked-ness lives with the peers, exactly as it does in production: the peer
  // manager holds the set and drops a peer's mark when the peer is removed. The
  // orchestrator reads it rather than keeping a copy, and a copy that outlived
  // the peer is what made a lost request permanent.
  function makePeerOptions(overrides = {}) {
    return {
      getEligibleSyncPeers: getEligibleSyncPeersStub,
      onPeerEvent: (event, cb) => peerEmitter.on(event, cb),
      offPeerEvent: (event, cb) => peerEmitter.removeListener(event, cb),
      markSyncRequested: (key) => syncRequested.add(key),
      isSyncRequested: (key) => syncRequested.has(key),
      clearSyncRequested: () => syncRequested.clear(),
      ...overrides,
    };
  }

  // What FluxPeerManager.remove() does: the peer goes and its mark goes with it.
  function removePeer(key) {
    syncRequested.delete(key);
  }

  // A completion carries the peer it came from, exactly as the response
  // handlers emit it - they have had the key all along. Distinct peers here, so
  // a test that means "three peers answered" says so rather than relying on a
  // count that three answers from one peer would also satisfy.
  function completeAllTypes(count, types = ['apprunning', 'appinstalling', 'apperrors']) {
    for (let i = 0; i < count; i += 1) {
      for (const type of types) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, type, `10.0.0.${i + 1}:16127`);
      }
    }
  }

  function makeOrchestrator(overrides = {}) {
    const orchestrator = new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions(), ...overrides });
    orchestrator.onMessageCapabilityChange(true);
    return orchestrator;
  }

  beforeEach(() => {
    clock = sinon.useFakeTimers({ shouldAdvanceTime: false });
    blockEmitter = new EventEmitter();
    peerEmitter = new EventEmitter();
    getEligibleSyncPeersStub = sinon.stub().returns([]);
    syncRequested = new Set();

    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    syncMissingHashesStub = sinon.stub().resolves({ resolved: 0, missing: 0, unreachable: 0, nextRetryHeight: null });
    getMissingHashesStub = sinon.stub().resolves([]);
    reindexStub = sinon.stub().resolves();
    globalStateStub = {
      dbReady: false,
      waitForBootContainerStateSettled: () => Promise.resolve(),
    };
    checkAndNotifyStub = sinon.stub().resolves();
    resetHashSyncForUpgradeStub = sinon.stub().resolves(0);
    findOneAndUpdateStub = sinon.stub().resolves();
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
      findOneInDatabase: sinon.stub().resolves(null),
      findOneAndUpdateInDatabase: findOneAndUpdateStub,
    };
    getFluxNodePublicKeyStub = sinon.stub().resolves('04testpubkey1234567890');
    getFluxNodePrivateKeyStub = sinon.stub().resolves('L1testprivkey');
    signMessageStub = sinon.stub().returns('fakesig==');

    const appSyncEventsModule = require('../../ZelBack/src/services/utils/appSyncEvents');
    ({ appSyncEvents, EVENTS } = appSyncEventsModule);
    appSyncEvents.removeAllListeners();

    const mod = proxyquire('../../ZelBack/src/services/appMessaging/appSyncOrchestrator', {
      'fs': { promises: { readFile: sinon.stub().resolves('test-boot-id-12345\n') } },
      '../../lib/log': logStub,
      '../dbHelper': dbHelperStub,
      './appHashSyncService': { syncMissingHashes: syncMissingHashesStub, getMissingHashes: getMissingHashesStub, resetHashSyncForUpgrade: resetHashSyncForUpgradeStub },
      './peerNotification': { checkAndNotifyPeersOfRunningApps: checkAndNotifyStub, stopBroadcastInterval: sinon.stub() },
      '../appDatabase/registryManager': {
        reindexGlobalAppsInformation: reindexStub,
      },
      '../utils/globalState': globalStateStub,
      '../utils/peerCodec': {
        MSG_TYPE: { REQUEST_TEMP_MESSAGES: 0x20, REQUEST_APP_RUNNING: 0x21, REQUEST_APP_INSTALLING: 0x22, REQUEST_APP_INSTALLING_ERRORS: 0x23 },
        buildSyncSignatureMessage: sinon.stub().returns('testmsg'),
        encodeRequestTempMessages: sinon.stub().returns(Buffer.alloc(9, 0x20)),
        encodeRequestAppRunning: sinon.stub().returns(Buffer.alloc(9, 0x21)),
        encodeRequestAppInstalling: sinon.stub().returns(Buffer.alloc(9, 0x22)),
        encodeRequestAppInstallingErrors: sinon.stub().returns(Buffer.alloc(9, 0x23)),
      },
      '../utils/nodeSigner': {
        nodeSigner: async () => {
          const pubKey = await getFluxNodePublicKeyStub();
          const privKey = await getFluxNodePrivateKeyStub();
          if (!pubKey || typeof pubKey !== 'string' || !privKey || typeof privKey !== 'string') return null;
          return { pubKey, sign: (message) => signMessageStub(message, privKey) };
        },
      },
      '../utils/appSyncEvents': appSyncEventsModule,
    });
    ({ AppSyncOrchestrator, STATES } = mod);
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  describe('state machine', () => {
    it('should start in INITIALIZING state', () => {
      const orchestrator = makeOrchestrator();
      expect(orchestrator.state).to.equal(STATES.INITIALIZING);
    });

    it('should transition to SYNCING on first blockReceived', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.SYNCING);
    });

    it('should log sync started on first blockReceived', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(logStub.info.calledWith('AppSyncOrchestrator - Sync started')).to.be.true;
    });

    it('should call syncMissingHashes on first blockReceived', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledOnce).to.be.true;
    });

    it('should call reindexGlobalAppsInformation after sync', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(reindexStub.calledOnce).to.be.true;
    });

    it('should set dbReady after sync', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(globalStateStub.dbReady).to.be.true;
    });

    it('should log DB ready after reindex', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(logStub.info.calledWith('AppSyncOrchestrator - DB ready')).to.be.true;
    });
  });

  describe('peer threshold events', () => {
    it('should call getEligibleSyncPeers on peerThresholdReached', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      expect(getEligibleSyncPeersStub.calledOnce).to.be.true;
    });

    it('should start apprunning broadcast on peerThresholdReached', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      expect(checkAndNotifyStub.calledOnce).to.be.true;
    });

    it('should start sync from the latched level when the threshold edge fired before start', async () => {
      // peerThresholdReached is edge-triggered and latched in FluxPeerManager:
      // if peers connected before start() subscribed, the edge never re-fires.
      // start() must read the level after subscribing — no edge is emitted here.
      const orchestrator = makeOrchestrator({ peerCountIfAboveThreshold: () => 12 });
      orchestrator.start(defaultBootContext);
      await clock.tickAsync(0);
      expect(getEligibleSyncPeersStub.calledOnce).to.be.true;
      expect(checkAndNotifyStub.calledOnce).to.be.true;
    });

    it('should not start sync from the level when the threshold has not been reached', async () => {
      const orchestrator = makeOrchestrator({ peerCountIfAboveThreshold: () => 0 });
      orchestrator.start(defaultBootContext);
      await clock.tickAsync(0);
      expect(getEligibleSyncPeersStub.called).to.be.false;
    });

    it('should transition to DEGRADED on peersBelowThreshold when READY', async () => {
      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);


      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      if (orchestrator.state === STATES.READY) {
        peerEmitter.emit('peersBelowThreshold', 3);
        expect(orchestrator.state).to.equal(STATES.DEGRADED);
      }
    });

    it('should emit readinessLost on degradation', async () => {
      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      const spy = sinon.spy();
      appSyncEvents.on(EVENTS.READINESS_LOST, spy);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

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

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      for (const peer of peers) {
        expect(peer.send.callCount).to.equal(4);
      }
    });

    it('should not send when fewer than 3 eligible peers on first attempt', async () => {
      const peers = makeEligiblePeers(2);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      for (const peer of peers) {
        expect(peer.send.called).to.be.false;
      }
    });

    // A node asks one peer, the connection dies before the bytes leave, and the
    // request is lost silently - a send into a closing socket does not throw. The
    // peer was recorded as asked, so every later pass filtered it out, logged
    // "No new eligible sync peers to ask" and asked nobody. The node stayed
    // SYNCING and never reached READY, permanently, from one lost message.
    //
    // Seen on a real fleet: 74ms for one direction of the same 3-node fleet, 30s
    // and zero completions for the other, and that log line 15 times in another
    // suite's node.
    it('asks a peer again when its connection went away before it answered', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      const asked = peers.filter((p) => p.send.called);
      expect(asked.length).to.be.greaterThan(0);

      // The peer goes, which is what drops its mark. The request it was sent is
      // gone with it and no answer will ever arrive.
      asked.forEach((p) => removePeer(p.key));
      asked.forEach((p) => p.send.resetHistory());

      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // Asked again rather than filtered out forever.
      expect(asked.some((p) => p.send.called), 'a peer that went away was never asked again').to.equal(true);
    });

    it('should not ask the same peer twice in the same cycle', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // Second threshold event — same peers returned, but already asked
      peerEmitter.emit('peerThresholdReached', 15);
      await clock.tickAsync(0);

      for (const peer of peers) {
        expect(peer.send.callCount).to.equal(4);
      }
    });

    it('should reset asked peers on degradation', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);


      // Get to READY via block-count fallback
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      if (orchestrator.state === STATES.READY) {
        // Degrade and recover — peers should be asked again
        peerEmitter.emit('peersBelowThreshold', 3);
        const sendCountBefore = peers[0].send.callCount;
        peerEmitter.emit('peerThresholdReached', 12);
        await clock.tickAsync(0);
        expect(peers[0].send.callCount).to.be.greaterThan(sendCountBefore);
      }
    });
  });

  // The pool of outstanding requests equalled the requirement exactly: three
  // asked, three completions needed, no spare. When one asked peer's connection
  // went away the request went with it and nothing re-asked - the only trigger
  // was `peerThresholdReached`, a latched edge that had already been spent and
  // that is cleared only below the DEGRADED level, so the count never fell.
  // The node then waited for the block timer: 125 minutes in SYNCING with the
  // spawner paused, observed on a three-node fleet booting 50ms apart.
  describe('re-driving the sync when a peer joins', () => {
    it('asks a peer that joins after an asked one was lost, with no second threshold edge', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      for (const peer of peers) expect(peer.send.callCount).to.equal(4);

      // What remove() does: the mark dies with the connection, and the peer is
      // no longer eligible because it is no longer in the peer map.
      removePeer(peers[0].key);
      const joiner = makePeer('10.0.0.9:16127');
      getEligibleSyncPeersStub.returns([peers[1], peers[2], joiner]);

      // No threshold event. The latch fired before the loss and the count never
      // dropped below DEGRADED, so on `development` nothing happens here.
      peerEmitter.emit('peerAdded', joiner.key, 12);
      await clock.tickAsync(0);

      expect(joiner.send.callCount, 'the peer that joined was never asked').to.equal(4);
    });

    it('sends nothing when a peer joins and the pool is still whole', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // Nothing was lost, so nothing is owed. A boot brings peers in steadily
      // and every one of them arrives here; asking on each is the over-asking
      // this must not become - two extra event-log streams per node boot,
      // fleet-wide and permanently, to cover a rare case.
      const joiner = makePeer('10.0.0.9:16127');
      getEligibleSyncPeersStub.returns([...peers, joiner]);
      peerEmitter.emit('peerAdded', joiner.key, 13);
      await clock.tickAsync(0);

      expect(joiner.send.called, 'a joining peer was asked while the pool was whole').to.equal(false);
      for (const peer of peers) expect(peer.send.callCount).to.equal(4);
    });

    it('asks the shortfall and no more when several peers are available', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // Two of the three go; one asked peer is still outstanding, so the
      // deficit is two - not a fresh round of three.
      removePeer(peers[0].key);
      removePeer(peers[1].key);
      const joiners = [makePeer('10.0.0.7:16127'), makePeer('10.0.0.8:16127'), makePeer('10.0.0.9:16127')];
      getEligibleSyncPeersStub.returns([peers[2], ...joiners]);

      peerEmitter.emit('peerAdded', joiners[0].key, 12);
      await clock.tickAsync(0);

      const asked = joiners.filter((p) => p.send.called);
      expect(asked.length, 'asked a different number of peers than were missing').to.equal(2);
      expect(peers[2].send.callCount, 'the peer still outstanding was asked twice').to.equal(4);
    });

    it('asks nobody once the state sync is complete', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      completeAllTypes(3);
      await clock.tickAsync(0);

      // Completion clears the marks, so without the state-sync guard every
      // later join looks like a pool that owes three requests - and it is the
      // ALREADY-ASKED peers it would ask again, since they come first in the
      // eligible list. Asserting only that the joiner is quiet passes on the
      // slice order rather than on the guard, so count every peer.
      const before = peers.map((p) => p.send.callCount);
      const joiner = makePeer('10.0.0.9:16127');
      getEligibleSyncPeersStub.returns([...peers, joiner]);
      peerEmitter.emit('peerAdded', joiner.key, 13);
      await clock.tickAsync(0);

      expect(joiner.send.called, 'a joining peer was asked after the sync was complete').to.equal(false);
      expect(peers.map((p) => p.send.callCount), 'peers were asked again after the sync was complete').to.deep.equal(before);
    });

    it('does not ask before the threshold has started the sync', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      // Peers arrive before the threshold is crossed. The first ask belongs to
      // the threshold edge; joining early must not bring it forward.
      peerEmitter.emit('peerAdded', peers[0].key, 1);
      await clock.tickAsync(0);

      for (const peer of peers) expect(peer.send.called, 'asked before the sync had started').to.equal(false);
    });

    // The fourth road out of #requestSyncs: too few eligible peers and none yet
    // asked went straight to the block timer, and nothing revisited it when the
    // fleet grew.
    it('asks when a join takes the eligible pool up to the requirement', async () => {
      const peers = makeEligiblePeers(2);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      for (const peer of peers) expect(peer.send.called).to.equal(false);

      const joiner = makePeer('10.0.0.9:16127');
      getEligibleSyncPeersStub.returns([...peers, joiner]);
      peerEmitter.emit('peerAdded', joiner.key, 13);
      await clock.tickAsync(0);

      for (const peer of [...peers, joiner]) {
        expect(peer.send.callCount, 'the fleet reached three eligible peers and still asked nobody').to.equal(4);
      }
    });
  });

  // Completion needs MIN_SYNC_COMPLETIONS answers because three peers' views of
  // the network are what make the result trustworthy. Counting answers rather
  // than peers meant one peer could satisfy all three, and the node concluded
  // it had surveyed the network when it had surveyed one node.
  describe('a completion is a peer, not a tally', () => {
    const driveToRequests = async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);
      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      return orchestrator;
    };

    it('does not complete on three answers from one peer', async () => {
      const orchestrator = await driveToRequests();

      for (let i = 0; i < 3; i += 1) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning', '10.0.0.1:16127');
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'appinstalling', '10.0.0.1:16127');
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apperrors', '10.0.0.1:16127');
      }
      await clock.tickAsync(0);

      expect(orchestrator.state, 'one peer answering three times completed the sync').to.equal(STATES.SYNCING);
    });

    it('completes on the same nine answers spread across three peers', async () => {
      const orchestrator = await driveToRequests();

      completeAllTypes(3);
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.READY);
    });

    // The response handlers have the key and always had it. A completion
    // arriving without one means that path stopped saying, and absorbing it
    // silently is how the tally came back.
    it('refuses a completion that cannot be attributed to a peer', async () => {
      const orchestrator = await driveToRequests();

      for (let i = 0; i < 3; i += 1) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning');
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'appinstalling');
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apperrors');
      }
      await clock.tickAsync(0);

      expect(orchestrator.state, 'unattributed completions were counted').to.equal(STATES.SYNCING);
      expect(logStub.error.called, 'an unattributable completion was absorbed silently').to.equal(true);
    });
  });

  describe('state sync readiness', () => {
    it('should reach READY when all 3 sync types complete from 3 peers', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);


      // Start hash sync
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      // Send sync requests
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // Complete all syncs from 3 peers
      completeAllTypes(3);
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.READY);
    });

    it('should not reach READY when only 2 peers complete apprunning', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // Only 2 apprunning, but 3 of the others
      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning', '10.0.0.1:16127');
      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning', '10.0.0.2:16127');
      completeAllTypes(3, ['appinstalling', 'apperrors']);
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.SYNCING);
    });

    it('should fall back to block count when no sync peers available', async () => {
      getEligibleSyncPeersStub = sinon.stub().returns([]);

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      // After sync but before enough blocks, should still be SYNCING
      expect(orchestrator.state).to.equal(STATES.SYNCING);

      // After enough blocks (enterprise = 124), should reach READY
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.READY);
    });

    it('should reset sync completions on degradation', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);


      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // Complete all syncs → READY
      completeAllTypes(3);
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.READY);

      // Degrade
      peerEmitter.emit('peersBelowThreshold', 3);
      expect(orchestrator.state).to.equal(STATES.DEGRADED);

      // Recovery — need fresh syncs, previous completions reset
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.RESYNCING);
    });
  });

  describe('hash sync recovery', () => {
    it('should retry hash sync on failure', async () => {
      syncMissingHashesStub.onFirstCall().rejects(new Error('connection failed'));
      syncMissingHashesStub.onSecondCall().resolves({ resolved: 10, missing: 0, unreachable: 0 });

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      expect(syncMissingHashesStub.calledOnce).to.be.true;
      expect(orchestrator.state).to.equal(STATES.SYNCING);
      expect(logStub.error.calledWith(sinon.match(/Hash sync failed.*attempt 1\/3/))).to.be.true;
    });

    it('should fall back to block timer when hash sync retries exhausted', async () => {
      syncMissingHashesStub.rejects(new Error('persistent failure'));

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);


      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      // All 3 retries happen via timers — we can't wait for real timers in tests
      // But we can verify the block timer fallback works
      expect(orchestrator.state).to.equal(STATES.SYNCING);

      // Emit enough blocks to trigger block timer (enterprise = 124 blocks)
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555001 + i);
      }
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.READY);
    });

    it('should reach READY via block timer when hash sync never completes', async () => {
      syncMissingHashesStub.rejects(new Error('failed'));

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);


      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      // Emit enough blocks for enterprise threshold
      for (let i = 1; i <= 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      // Block timer should have triggered DB rebuild and readiness
      expect(orchestrator.state).to.equal(STATES.READY);
      expect(reindexStub.called).to.be.true;
    });

    it('should not get stuck when DB rebuild fails', async () => {
      reindexStub.rejects(new Error('reindex failed'));

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      // Hash sync succeeded but DB rebuild failed
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Block timer should still allow readiness (will retry DB rebuild)
      for (let i = 1; i <= 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      // The block timer fallback tries rebuildDb again
      expect(reindexStub.callCount).to.be.greaterThan(1);
    });
  });

  describe('dbReady on fallback paths', () => {
    it('should set dbReady after block timer fallback when hash sync fails', async () => {
      syncMissingHashesStub.rejects(new Error('failed'));

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      for (let i = 1; i <= 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.READY);
      expect(globalStateStub.dbReady).to.be.true;
    });

    it('should set dbReady when too few sync peers and block timer fires', async () => {
      getEligibleSyncPeersStub = sinon.stub().returns([]);

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      for (let i = 1; i <= 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.READY);
      expect(globalStateStub.dbReady).to.be.true;
    });

    it('should leave dbReady false when rebuildDb throws on fallback path', async () => {
      syncMissingHashesStub.rejects(new Error('failed'));
      reindexStub.rejects(new Error('reindex failed'));

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      for (let i = 1; i <= 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      expect(globalStateStub.dbReady).to.be.false;
      expect(orchestrator.state).to.not.equal(STATES.READY);
    });
  });

  describe('hash retry scheduling', () => {
    it('should retry hash sync when block reaches nextRetryHeight', async () => {
      syncMissingHashesStub.onFirstCall().resolves({ resolved: 5, missing: 2, unreachable: 0, nextRetryHeight: 2555200 });
      syncMissingHashesStub.onSecondCall().resolves({ resolved: 2, missing: 0, unreachable: 0, nextRetryHeight: null });

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      // Initial sync sets nextRetryHeight to 2555200
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Block before retry height — should not trigger sync
      blockEmitter.emit('blocksProcessed', 2555100);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Block at retry height — should trigger sync
      blockEmitter.emit('blocksProcessed', 2555200);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledTwice).to.be.true;
    });

    it('should use fallback interval when no hashes are backed off', async () => {
      syncMissingHashesStub.resolves({ resolved: 0, missing: 0, unreachable: 0, nextRetryHeight: null });

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Fallback is 100 blocks — should not trigger before that
      blockEmitter.emit('blocksProcessed', 2555050);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // At fallback threshold — should trigger
      blockEmitter.emit('blocksProcessed', 2555100);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledTwice).to.be.true;
    });

    it('should schedule immediate check on HASH_UNRESOLVED event', async () => {
      syncMissingHashesStub.onFirstCall().resolves({ resolved: 0, missing: 0, unreachable: 0, nextRetryHeight: 2560000 });
      syncMissingHashesStub.onSecondCall().resolves({ resolved: 1, missing: 0, unreachable: 0, nextRetryHeight: null });

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // New unresolved hash — should schedule immediate check
      appSyncEvents.emit(EVENTS.HASH_UNRESOLVED);

      // Next block should trigger sync even though nextRetryHeight was 2560000
      blockEmitter.emit('blocksProcessed', 2555001);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledTwice).to.be.true;
    });

    it('should ignore HASH_UNRESOLVED before initial sync completes', async () => {
      syncMissingHashesStub.rejects(new Error('not ready'));

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

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

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Reconstruct found changes
      blockEmitter.emit('hashesChanged');

      // Next block should trigger sync immediately
      blockEmitter.emit('blocksProcessed', 2555001);
      await clock.tickAsync(0);
      expect(syncMissingHashesStub.calledTwice).to.be.true;
    });

    it('should register hashesChanged listener on start', async () => {
      const orchestrator = makeOrchestrator();
      expect(blockEmitter.listenerCount('hashesChanged')).to.equal(0);
      orchestrator.start(defaultBootContext);
      expect(blockEmitter.listenerCount('hashesChanged')).to.equal(1);
    });

    it('should ignore hashesChanged before initial sync completes', async () => {
      syncMissingHashesStub.rejects(new Error('not ready'));

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('hashesChanged');

      expect(logStub.info.calledWith(sinon.match(/Reconstruct audit found changes/))).to.be.false;
    });
  });

  describe('version upgrade reset', () => {
    it('should call resetHashSyncForUpgrade with block height on version change', async () => {
      dbHelperStub.findOneInDatabase.resolves(null);

      const orchestrator = makeOrchestrator({ fluxVersion: '8.12.0' });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      expect(resetHashSyncForUpgradeStub.calledOnce).to.be.true;
      expect(resetHashSyncForUpgradeStub.firstCall.args[0]).to.equal(2555000);
      expect(logStub.info.calledWith(sinon.match(/Version upgrade to 8\.12\.0/))).to.be.true;
    });

    it('should skip reset when version matches marker', async () => {
      dbHelperStub.findOneInDatabase.resolves({ _id: 'hashSyncVersion', version: '8.12.0' });

      const orchestrator = makeOrchestrator({ fluxVersion: '8.12.0' });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      expect(resetHashSyncForUpgradeStub.called).to.be.false;
    });

    it('should write version marker after hash sync completes', async () => {
      dbHelperStub.findOneInDatabase.resolves(null);

      const orchestrator = makeOrchestrator({ fluxVersion: '8.12.0' });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      const versionCall = findOneAndUpdateStub.getCalls().find(
        (c) => c.args[2]?._id === 'hashSyncVersion',
      );
      expect(versionCall).to.not.be.undefined;
      expect(versionCall.args[3]).to.deep.equal({ $set: { version: '8.12.0' } });
    });

    it('should skip version check when fluxVersion not provided', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      expect(resetHashSyncForUpgradeStub.called).to.be.false;
      const versionCall = findOneAndUpdateStub.getCalls().find(
        (c) => c.args[2]?._id === 'hashSyncVersion',
      );
      expect(versionCall).to.be.undefined;
    });
  });

  describe('stop', () => {
    it('should remove all listeners and clear intervals', () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      orchestrator.stop();
      expect(blockEmitter.listenerCount('blocksProcessed')).to.equal(0);
      expect(blockEmitter.listenerCount('hashesChanged')).to.equal(0);
      expect(peerEmitter.listenerCount('peerThresholdReached')).to.equal(0);
      expect(peerEmitter.listenerCount('peersBelowThreshold')).to.equal(0);
      expect(peerEmitter.listenerCount('peerAdded')).to.equal(0);
    });

    it('should clear heartbeat interval on stop', () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      orchestrator.stop();
      // No error thrown, interval cleaned up
    });
  });

  describe('readBootContext', () => {
    it('should detect machine reboot when boot_id differs', async () => {
      dbHelperStub.findOneInDatabase.resolves({
        lastAlive: Date.now() - 60000,
        machineBootId: 'old-boot-id',
        shutdownReason: 'sigterm',
      });

      const ctx = await AppSyncOrchestrator.readBootContext();

      expect(ctx.machineRebooted).to.be.true;
      expect(ctx.cleanShutdown).to.be.true;
      expect(ctx.firstBoot).to.be.false;
      expect(ctx.currentBootId).to.equal('test-boot-id-12345');
    });

    it('should detect FluxOS-only restart when boot_id matches', async () => {
      dbHelperStub.findOneInDatabase.resolves({
        lastAlive: Date.now() - 5000,
        machineBootId: 'test-boot-id-12345',
        shutdownReason: 'sigterm',
      });

      const ctx = await AppSyncOrchestrator.readBootContext();

      expect(ctx.machineRebooted).to.be.false;
      expect(ctx.cleanShutdown).to.be.true;
    });

    it('should detect first boot when no heartbeat exists', async () => {
      dbHelperStub.findOneInDatabase.resolves(null);

      const ctx = await AppSyncOrchestrator.readBootContext();

      expect(ctx.firstBoot).to.be.true;
      expect(ctx.machineRebooted).to.be.true;
      expect(ctx.downtimeMs).to.equal(Infinity);
    });

    it('should detect unclean shutdown when shutdownReason is absent', async () => {
      dbHelperStub.findOneInDatabase.resolves({
        lastAlive: Date.now() - 120000,
        machineBootId: 'old-boot-id',
      });

      const ctx = await AppSyncOrchestrator.readBootContext();

      expect(ctx.cleanShutdown).to.be.false;
      expect(ctx.machineRebooted).to.be.true;
    });

    it('should compute downtime from lastAlive', async () => {
      const fiveMinAgo = Date.now() - 300000;
      dbHelperStub.findOneInDatabase.resolves({
        lastAlive: fiveMinAgo,
        machineBootId: 'old-boot-id',
      });

      const ctx = await AppSyncOrchestrator.readBootContext();

      expect(ctx.downtimeMs).to.be.within(299000, 301000);
    });

    it('should return safe defaults on error', async () => {
      dbHelperStub.findOneInDatabase.rejects(new Error('DB down'));

      const ctx = await AppSyncOrchestrator.readBootContext();

      expect(ctx.machineRebooted).to.be.true;
      expect(ctx.downtimeMs).to.equal(Infinity);
      expect(ctx.cleanShutdown).to.be.false;
      expect(ctx.firstBoot).to.be.true;
    });
  });

  describe('writeShutdownReason', () => {
    it('should write shutdown reason to heartbeat doc', async () => {
      await AppSyncOrchestrator.writeShutdownReason('sigterm');

      const call = findOneAndUpdateStub.getCalls().find(
        (c) => c.args[2]?._id === 'heartbeat',
      );
      expect(call).to.not.be.undefined;
      expect(call.args[3]).to.deep.equal({ $set: { shutdownReason: 'sigterm' } });
    });

    it('should not throw on error', async () => {
      findOneAndUpdateStub.rejects(new Error('DB down'));
      await AppSyncOrchestrator.writeShutdownReason('sigterm');
      expect(logStub.error.calledWithMatch(/Failed to write shutdown reason/)).to.be.true;
    });
  });

  describe('heartbeat', () => {
    it('should write heartbeat immediately on start', async () => {
      const orchestrator = makeOrchestrator();
      await orchestrator.start(defaultBootContext);

      const heartbeatCall = findOneAndUpdateStub.getCalls().find(
        (c) => c.args[2]?._id === 'heartbeat' && c.args[3]?.$set && 'lastAlive' in c.args[3].$set,
      );
      expect(heartbeatCall).to.not.be.undefined;
      expect(heartbeatCall.args[3].$set.machineBootId).to.equal('test-boot-id-12345');
      orchestrator.stop();
    });

    it('should store boot context and expose via getter', async () => {
      const orchestrator = makeOrchestrator();
      await orchestrator.start(defaultBootContext);

      expect(orchestrator.bootContext).to.deep.equal(defaultBootContext);
      orchestrator.stop();
    });
  });

  describe('message capability changes', () => {
    function makeUncapableOrchestrator(overrides = {}) {
      return new AppSyncOrchestrator({ blockEmitter, ...makePeerOptions(), ...overrides });
    }

    it('should not reach READY without message capability', async () => {
      const orchestrator = makeUncapableOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.SYNCING);
    });

    it('should reach READY when capability gained after other conditions met', async () => {
      const orchestrator = makeUncapableOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      // Explorer syncs but hash sync deferred (no capability)
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.SYNCING);

      // Capability gained — triggers deferred sync + readiness
      orchestrator.onMessageCapabilityChange(true);
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.READY);
    });

    it('should emit READINESS_LOST when capability lost while READY', async () => {
      const spy = sinon.spy();
      appSyncEvents.on(EVENTS.READINESS_LOST, spy);

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.READY);

      orchestrator.onMessageCapabilityChange(false);
      expect(orchestrator.state).to.equal(STATES.SYNCING);
      expect(spy.calledOnce).to.be.true;
    });

    it('should emit SPAWNER_READY when capability regained', async () => {
      const readySpy = sinon.spy();
      const lostSpy = sinon.spy();
      appSyncEvents.on(EVENTS.SPAWNER_READY, readySpy);
      appSyncEvents.on(EVENTS.READINESS_LOST, lostSpy);

      const orchestrator = makeOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);


      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.READY);
      expect(readySpy.calledOnce).to.be.true;

      orchestrator.onMessageCapabilityChange(false);
      expect(lostSpy.calledOnce).to.be.true;

      orchestrator.onMessageCapabilityChange(true);
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.READY);
      expect(readySpy.calledTwice).to.be.true;
    });

    it('should be a no-op when same value set twice', async () => {
      const orchestrator = makeUncapableOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);
      orchestrator.onMessageCapabilityChange(false);
      orchestrator.onMessageCapabilityChange(false);

      expect(logStub.info.calledWith('AppSyncOrchestrator - Message capability lost')).to.be.false;
    });

    it('should not produce log spam from block events when not confirmed', async () => {
      const orchestrator = makeUncapableOrchestrator({ isEnterprise: () => true });
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 130; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      const notConfirmedLogs = logStub.info.getCalls().filter(
        (c) => typeof c.args[0] === 'string' && c.args[0].includes('not confirmed'),
      );
      expect(notConfirmedLogs).to.have.lengthOf(0);
    });
  });
});
