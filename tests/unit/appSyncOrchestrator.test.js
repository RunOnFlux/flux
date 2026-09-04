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
  let proxyquireMap;
  let loadWithConfig;
  let connections;
  let nextConnectionId;
  let removed;
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

  // A peer is a CONNECTION, not an address. FluxPeerSocket stamps each one
  // with an id so a request written into one socket can be told from whatever
  // dials in next under the same ip:port.
  function makePeer(key) {
    nextConnectionId += 1;
    connections.set(key, nextConnectionId);
    return { key, connectionId: nextConnectionId, send: sinon.stub() };
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

  // Which peers have been asked is the orchestrator's own record now, so the
  // manager side of the seam is only what FluxPeerManager actually offers:
  // the peers worth asking, and which connection is currently held to each.
  function makePeerOptions(overrides = {}) {
    return {
      getEligibleSyncPeers: getEligibleSyncPeersStub,
      onPeerEvent: (event, cb) => peerEmitter.on(event, cb),
      offPeerEvent: (event, cb) => peerEmitter.removeListener(event, cb),
      peerConnectionId: (key) => connections.get(key) ?? null,
      ...overrides,
    };
  }

  // What FluxPeerManager.remove() does: the peer goes and the removal is
  // ANNOUNCED. The announcement is the half that matters to anything waiting
  // on that peer for an answer - without it the wait can only end at a
  // deadline, which is the whole point of saying so.
  function removePeer(key) {
    connections.delete(key);
    // It leaves the peer map, so getEligibleSyncPeers stops offering it - a
    // fake that goes on returning a peer whose socket closed lets the code
    // re-ask a peer production could not have offered.
    removed.add(key);
    peerEmitter.emit('peerRemoved', key, 0);
  }

  // What FluxPeerManager.add() does when a peer is already there: the old
  // socket is dropped and a NEW one takes the same key. Same address, and
  // nothing arriving on it answers a request written into the old one.
  function reconnectPeer(key) {
    const peer = makePeer(key);
    peerEmitter.emit('peerAdded', key, 12);
    return peer;
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
    connections = new Map();
    nextConnectionId = 0;
    removed = new Set();

    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    syncMissingHashesStub = sinon.stub().resolves({ resolved: 0, missing: 0, unreachable: 0, nextRetryHeight: null });
    getMissingHashesStub = sinon.stub().resolves([]);
    reindexStub = sinon.stub().resolves();
    globalStateStub = {
      dbReady: false,
      // globalState's own initial value: nothing is authoritative until the
      // orchestrator says so.
      appStateAuthoritative: false,
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

    // Kept so a test that needs a different config can reload the module with
    // the same doubles - the module reads its constants once, at require time.
    proxyquireMap = {
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
    };

    loadWithConfig = (fluxappsOverrides) => {
      const realConfig = require('config');
      return proxyquire('../../ZelBack/src/services/appMessaging/appSyncOrchestrator', {
        ...proxyquireMap,
        config: {
          ...realConfig,
          database: realConfig.database,
          fluxapps: { ...realConfig.fluxapps, ...fluxappsOverrides },
        },
      });
    };

    ({ AppSyncOrchestrator, STATES } = proxyquire('../../ZelBack/src/services/appMessaging/appSyncOrchestrator', proxyquireMap));
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
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);


      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 260; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      if (orchestrator.state === STATES.READY) {
        peerEmitter.emit('peersBelowThreshold', 3);
        expect(orchestrator.state).to.equal(STATES.DEGRADED);
      }
    });

    it('should emit readinessLost on degradation', async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      const spy = sinon.spy();
      appSyncEvents.on(EVENTS.READINESS_LOST, spy);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 260; i += 1) {
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

    // A pool that cannot be filled yet is still worth part-filling. Waiting for
    // enough candidates to arrive before asking ANY of them was a road out of
    // the request path that sent nothing at all, and the answers it declined to
    // collect are exactly the ones that would have been banked by the time the
    // rest of the fleet showed up.
    it('asks the peers it has, even when there are fewer than the requirement', async () => {
      const peers = makeEligiblePeers(2);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      for (const peer of peers) {
        expect(peer.send.callCount, 'a peer that could have answered was not asked').to.equal(4);
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

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);


      // Get to READY via block-count fallback
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      for (let i = 0; i < 260; i += 1) {
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

    // The pool was part-filled because that was all there was, so the join
    // completes it rather than starting it. The peers already asked are not
    // asked again, which is the record doing its job.
    it('asks a joiner for the shortfall a part-filled pool still carries', async () => {
      const peers = makeEligiblePeers(2);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      for (const peer of peers) expect(peer.send.callCount).to.equal(4);

      const joiner = makePeer('10.0.0.9:16127');
      getEligibleSyncPeersStub.returns([...peers, joiner]);
      peerEmitter.emit('peerAdded', joiner.key, 13);
      await clock.tickAsync(0);

      for (const peer of peers) expect(peer.send.callCount, 'an outstanding request was sent twice').to.equal(4);

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
      const orchestrator = makeOrchestrator();
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

  // A peer that declines has ANSWERED, and the answer is not a completion. It
  // leaves the candidate pool for that connection, so the deficit #requestSyncs
  // asks against opens by one and someone who may actually know gets asked.
  describe('a peer that declines is replaced', () => {
    it('asks another peer when one declines', async () => {
      const peers = makeEligiblePeers(3);
      const spare = makePeer('10.0.0.9:16127');
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      for (const peer of peers) expect(peer.send.callCount).to.equal(4);

      // Declining takes it out of the eligible list, exactly as the flag on the
      // socket takes it out of getEligibleSyncPeers.
      getEligibleSyncPeersStub.returns([peers[1], peers[2], spare]);
      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_REFUSED, 'apprunning', peers[0].key);
      await clock.tickAsync(0);

      expect(spare.send.callCount, 'a peer declined and nobody else was asked').to.equal(4);
    });

    it('does not start a second round for a refusal from a peer it never asked', async () => {
      const peers = makeEligiblePeers(3);
      const spare = makePeer('10.0.0.9:16127');
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // Nothing was marked, so the pool never lost a member. The deficit is what
      // decides, and a whole pool owes nothing however the pass was reached.
      getEligibleSyncPeersStub.returns([...peers, spare]);
      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_REFUSED, 'apprunning', '203.0.113.1:16127');
      await clock.tickAsync(0);

      expect(spare.send.called).to.equal(false);
      for (const peer of peers) expect(peer.send.callCount).to.equal(4);
    });

    it('replaces a peer once however many types it declines', async () => {
      const peers = makeEligiblePeers(3);
      const spares = [makePeer('10.0.0.7:16127'), makePeer('10.0.0.8:16127'), makePeer('10.0.0.9:16127')];
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // A node refuses all three types when it refuses any, and the passes
      // after the first find the pool already topped up.
      getEligibleSyncPeersStub.returns([peers[1], peers[2], ...spares]);
      for (const type of ['apprunning', 'appinstalling', 'apperrors']) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_REFUSED, type, peers[0].key);
      }
      await clock.tickAsync(0);

      const asked = spares.filter((p) => p.send.called);
      expect(asked.length, 'one declining peer pulled in more than one replacement').to.equal(1);
    });

    it('asks nobody more once the state sync is complete', async () => {
      const peers = makeEligiblePeers(3);
      const spare = makePeer('10.0.0.9:16127');
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      completeAllTypes(3);
      await clock.tickAsync(0);

      getEligibleSyncPeersStub.returns([peers[1], peers[2], spare]);
      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_REFUSED, 'apprunning', peers[0].key);
      await clock.tickAsync(0);

      expect(spare.send.called).to.equal(false);
    });

    it('reports a refusal that names no peer instead of absorbing it', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_REFUSED, 'apprunning');
      await clock.tickAsync(0);

      expect(logStub.error.called, 'a refusal with no peer was absorbed silently').to.equal(true);
    });

    it('stops listening for refusals on stop', () => {
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      orchestrator.stop();

      expect(appSyncEvents.listenerCount(EVENTS.EPHEMERAL_SYNC_REFUSED)).to.equal(0);
    });
  });

  // The sync responder reads this to decide whether its own answer is worth
  // another node's survey. It has to follow the rule, not a copy of it.
  describe('the state-sync verdict is published for the responder', () => {
    it('is false while the sync is incomplete and true once it completes', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      expect(globalStateStub.appStateAuthoritative, 'authoritative before anyone answered').to.equal(false);

      completeAllTypes(3);
      await clock.tickAsync(0);

      expect(globalStateStub.appStateAuthoritative).to.equal(true);
    });

    it('goes false again when the peers go and the sync is reset', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      completeAllTypes(3);
      await clock.tickAsync(0);
      expect(globalStateStub.appStateAuthoritative).to.equal(true);

      peerEmitter.emit('peersBelowThreshold', 3);
      await clock.tickAsync(0);

      expect(globalStateStub.appStateAuthoritative, 'a degraded node still claimed authority').to.equal(false);
    });
  });

  // The block fallback was two literals, so no fleet could have a node that
  // was able to answer a sync request from the moment it started - and on a
  // fleet where every node is still syncing, every node declines every other
  // and they all wait out 250 blocks.
  describe('the block fallback is configured, not hardcoded', () => {
    it('is authoritative from the moment it starts when told to wait no blocks', async () => {
      const mod = loadWithConfig({ appSyncFallbackMinutes: 0 });
      const orchestrator = new mod.AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(),
      });
      orchestrator.onMessageCapabilityChange(true);

      await orchestrator.start(defaultBootContext);

      expect(globalStateStub.appStateAuthoritative, 'a node told to wait no blocks still declined').to.equal(true);
    });

    it('is not authoritative at start on the production budget', async () => {
      const mod = loadWithConfig({ appSyncFallbackMinutes: 125 });
      const orchestrator = new mod.AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(),
      });
      orchestrator.onMessageCapabilityChange(true);

      await orchestrator.start(defaultBootContext);

      expect(globalStateStub.appStateAuthoritative).to.equal(false);
    });

    it('reaches readiness on the configured number of blocks rather than 250', async () => {
      const mod = loadWithConfig({ appSyncFallbackMinutes: 2 });
      getEligibleSyncPeersStub = sinon.stub().returns([]);
      const orchestrator = new mod.AppSyncOrchestrator({
        blockEmitter, ...makePeerOptions(),
      });
      orchestrator.onMessageCapabilityChange(true);
      await orchestrator.start(defaultBootContext);

      // 2 minutes at 2 blocks a minute, so the fourth block is past it and the
      // 250th is not the bar any more.
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 1; i <= 4; i += 1) blockEmitter.emit('blocksProcessed', 2555000 + i);
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(mod.STATES.READY);
      expect(globalStateStub.appStateAuthoritative).to.equal(true);
    });
  });

  // ONE RECORD PER REQUEST, ONE THING THAT WRITES IT.
  //
  // "there is a request outstanding to this peer" used to be written down three
  // times - an asked-mark on the peer manager, a slot here, a declined flag on
  // the socket - by different code, cleared by different rules. Every way they
  // could disagree was a defect, and the four below are those ways.
  describe('the request record is the only account of what has been asked', () => {
    const STALL_MS = 30000;
    const SYNC_TIMEOUT_MS = 120000;

    // FluxPeerManager.add() emits peerThresholdReached and then peerAdded from
    // the same call, so the trigger that starts the sync and one that tops it
    // up land in the same tick. Choosing peers cannot be one uninterrupted step
    // - the signing key is fetched in the middle - so without the reconciler
    // holding the table both passes read an empty pool and both fill it.
    it('asks each peer once when the threshold crossing and the join it rode in on both land', async () => {
      const peers = makeEligiblePeers(6);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      peerEmitter.emit('peerAdded', peers[0].key, 12);
      await clock.tickAsync(0);

      const asked = peers.filter((p) => p.send.called);
      expect(asked.length, 'a boot asked more peers than the pool holds').to.equal(3);
      for (const peer of asked) {
        expect(peer.send.callCount, 'a peer was sent the same four requests twice').to.equal(4);
      }
      orchestrator.stop();
    });

    // A node below its degraded threshold has judged its own gossip
    // unreliable. Asking anyway would let it complete a survey from the peers
    // it has left and publish itself authoritative on the strength of them.
    it('stops asking once it has judged its own peer set unreliable', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      blockEmitter.emit('blocksProcessed', 2555000);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      for (const peer of peers) expect(peer.send.callCount).to.equal(4);

      // Degrading throws the sync progress away, so every peer is a candidate
      // again and a pass that ran would re-ask them. Asserted on THAT rather
      // than on the joiner: the joiner sits fourth in a list of four and a pool
      // of three never reaches it, so it goes unasked either way.
      peerEmitter.emit('peersBelowThreshold', 1);
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.DEGRADED);

      const joiner = makePeer('10.0.0.9:16127');
      getEligibleSyncPeersStub.returns([...peers, joiner]);
      peerEmitter.emit('peerAdded', joiner.key, 2);
      await clock.tickAsync(0);

      for (const peer of peers) {
        expect(peer.send.callCount, 'a degraded node asked its remaining peers for state').to.equal(4);
      }
      expect(joiner.send.called, 'a degraded node asked a joining peer for state').to.equal(false);
      expect(globalStateStub.appStateAuthoritative, 'a degraded node still claimed authority').to.equal(false);
      orchestrator.stop();
    });

    // And it starts again - a guard that stops the asking has to be shown to
    // let it resume, or it is indistinguishable from wedging the node.
    it('asks again once enough peers are back for the threshold to re-arm', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      blockEmitter.emit('blocksProcessed', 2555000);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      peerEmitter.emit('peersBelowThreshold', 1);
      await clock.tickAsync(0);

      const recovered = makeEligiblePeers(3);
      getEligibleSyncPeersStub.returns(recovered);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      for (const peer of recovered) {
        expect(peer.send.callCount, 'a node that recovered its peers never asked again').to.equal(4);
      }
      orchestrator.stop();
    });

    // WHAT THE RE-ENTRANCY GUARD BUYS, on its own.
    //
    // The pool cap survives without it, because a pass reads the table and
    // reserves in it without yielding, so a second pass started concurrently
    // sees the first one's records and finds nothing owed. What the guard adds
    // is that the second pass never starts: a boot brings peers in a burst and
    // every one of them is a trigger, and each pass that gets as far as the
    // await fetches this node's signing key. One arrival, one key.
    it('fetches the signing key once however many triggers arrive together', async () => {
      const peers = makeEligiblePeers(6);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      getFluxNodePublicKeyStub.resetHistory();

      peerEmitter.emit('peerThresholdReached', 12);
      for (const peer of peers) peerEmitter.emit('peerAdded', peer.key, 12);
      await clock.tickAsync(0);

      expect(getFluxNodePublicKeyStub.callCount, 'a burst of joins fetched the node key once each').to.equal(1);
      orchestrator.stop();
    });

    // WHAT THE RE-RUN BUYS, on its own.
    //
    // The guard stops a second pass running, but it does not stop the table
    // changing underneath the one that is: a deadline firing or a peer leaving
    // while the signing key is being fetched closes a request and widens the
    // deficit the pass already counted. Those triggers mark the table dirty
    // instead of acting, and the re-run is what then asks for the shortfall
    // they left. Without it the peer that went is not replaced until something
    // else happens to trigger, which on a quiet fleet is the block timer.
    it('replaces a peer that was lost while the signing key was being fetched', async () => {
      const peers = makeEligiblePeers(3);
      const spares = [makePeer('10.0.9.1:16127'), makePeer('10.0.9.2:16127')];
      getEligibleSyncPeersStub = sinon.stub().callsFake(
        () => [...peers, ...spares].filter((p) => !removed.has(p.key)),
      );

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      for (const peer of peers) expect(peer.send.callCount).to.equal(4);

      // The second key fetch is the one for the top-up below. While it is in
      // flight a second peer goes, so the deficit when the fetch returns is two
      // and not the one it was when the pass started.
      getFluxNodePublicKeyStub.onCall(1).callsFake(async () => {
        removePeer(peers[1].key);
        return '04testpubkey1234567890';
      });

      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_REFUSED, 'apprunning', peers[0].key);
      await clock.tickAsync(0);

      const asked = spares.filter((p) => p.send.called).length;
      expect(asked, 'a peer lost during the key fetch went unreplaced').to.equal(2);
      orchestrator.stop();
    });

    // The round's budget and the per-peer deadlines used to be kept in separate
    // places: the budget cleared the asked-marks and left the deadlines armed,
    // so a peer that was streaming perfectly went quiet only because this node
    // had stopped listening - and was then recorded as having stalled.
    it('ends a round without accusing a peer that was still delivering', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // One peer keeps sending right up to the budget, inside every stall window.
      for (let elapsed = 0; elapsed < SYNC_TIMEOUT_MS; elapsed += STALL_MS - 1000) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_PROGRESS, peers[0].key);
        // eslint-disable-next-line no-await-in-loop
        await clock.tickAsync(STALL_MS - 1000);
      }
      await clock.tickAsync(SYNC_TIMEOUT_MS);

      const accusations = logStub.warn.getCalls()
        .map((c) => String(c.args[0]))
        .filter((m) => m.includes(peers[0].key) && m.includes('stopped mid-answer'));
      expect(accusations, 'a peer delivering to the last second was blamed for stalling').to.deep.equal([]);
      // And its request is closed, so nothing arriving afterwards is taken as
      // an answer to a round that is over.
      expect(orchestrator.isSyncResponseWanted(peers[0]), 'a finished round still wanted answers').to.equal(false);
      orchestrator.stop();
    });

    // THE BUDGET BOUNDS THE ATTEMPT, not one round of an open-ended series.
    // When it runs out the attempt is over: the block fallback is what carries
    // this node to readiness, and nobody is asked anything more. Without that,
    // "how long before it gives up" has no answer - a peer arriving an hour
    // later would open another round with its own budget.
    it('asks nobody once the budget has been spent, however many peers arrive', async () => {
      const peers = makeEligiblePeers(3);
      const untried = makePeer('10.9.9.1:16127');
      getEligibleSyncPeersStub = sinon.stub().callsFake(() => [...peers, untried]);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      // Nobody answers, so the deadlines take everyone and the budget runs out.
      await clock.tickAsync(SYNC_TIMEOUT_MS + 1000);
      const spent = [...peers, untried].reduce((n, p) => n + p.send.callCount, 0);

      const joiner = makePeer('10.9.9.2:16127');
      getEligibleSyncPeersStub.callsFake(() => [...peers, untried, joiner]);
      peerEmitter.emit('peerAdded', joiner.key, 13);
      await clock.tickAsync(0);

      expect(joiner.send.called, 'a peer that joined after the budget was asked').to.equal(false);
      expect([...peers, untried].reduce((n, p) => n + p.send.callCount, 0),
        'the budget ran out and it went on asking').to.equal(spent);
      orchestrator.stop();
    });

    // And a spent budget is not a permanent one. A guard that stops the asking
    // has to be shown to let it start again, or it cannot be told from a node
    // that has wedged itself.
    it('starts a fresh attempt when the sync genuinely restarts', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      blockEmitter.emit('blocksProcessed', 2555000);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      await clock.tickAsync(SYNC_TIMEOUT_MS + 1000);
      const spent = peers.reduce((n, p) => n + p.send.callCount, 0);

      // Losing the peers and getting them back is a restart of the sync, not a
      // continuation of the attempt that ran out.
      peerEmitter.emit('peersBelowThreshold', 1);
      await clock.tickAsync(0);
      const recovered = makeEligiblePeers(3);
      getEligibleSyncPeersStub.returns(recovered);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      expect(recovered.reduce((n, p) => n + p.send.callCount, 0),
        'a sync that restarted never asked anyone').to.be.greaterThan(0);
      expect(spent, 'the first attempt never asked at all').to.be.greaterThan(0);
      orchestrator.stop();
    });

    // The request went into a socket that has since been replaced. Nothing on
    // the new connection answers it, and the peer never received it - so it is
    // a peer worth asking rather than one already tried.
    it('asks a peer that reconnected, and wants nothing from the connection that went', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      const oldConnection = peers[0];
      expect(orchestrator.isSyncResponseWanted(oldConnection)).to.equal(true);

      const reconnected = reconnectPeer(peers[0].key);
      getEligibleSyncPeersStub.returns([reconnected, peers[1], peers[2]]);
      await clock.tickAsync(0);

      expect(orchestrator.isSyncResponseWanted(oldConnection), 'a dead connection could still complete the sync').to.equal(false);
      expect(reconnected.send.callCount, 'a reconnected peer was skipped as already asked').to.equal(4);
      orchestrator.stop();
    });

    // A peer refuses all three types when it refuses any. Only the first of
    // those ends the request, so the log says once what happened once.
    it('records one refusal when a peer declines all three types', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);

      for (const type of ['apprunning', 'appinstalling', 'apperrors']) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_REFUSED, type, peers[0].key);
      }
      await clock.tickAsync(0);

      const declines = logStub.info.getCalls()
        .map((c) => String(c.args[0]))
        .filter((m) => m.includes(peers[0].key) && m.includes('declined'));
      expect(declines.length, 'one peer declining once was reported three times').to.equal(1);
      orchestrator.stop();
    });
  });

  // THE POOL IS SLOTS, AND EVERY SLOT HAS ITS OWN CLOCK.
  //
  // The design this replaced fired its requests and then waited on one deadline
  // for the whole batch, so it only ever re-examined anything when something
  // external happened to poke it - a peer joined, a peer declined. A peer that
  // simply never replied was invisible until the whole budget expired, and an
  // earlier attempt to fix that by starting a timer on the FIRST answer failed
  // on the case that matters most: if none of them answer, there is no first
  // answer and no timer.
  //
  // syncTimeoutMs is 120000 here, so the first-response deadline is 10s and the
  // stall deadline 30s.
  describe('a slot is held by one peer and has its own deadline', () => {
    const FIRST_RESPONSE_MS = 10000;
    const STALL_MS = 30000;

    const askThree = async (spares = 3) => {
      const peers = makeEligiblePeers(3);
      const extra = Array.from({ length: spares }, (_, i) => makePeer(`10.0.9.${i + 1}:16127`));
      getEligibleSyncPeersStub = sinon.stub().returns(peers);
      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);
      peerEmitter.emit('peerThresholdReached', 12);
      await clock.tickAsync(0);
      for (const peer of peers) expect(peer.send.callCount).to.equal(4);

      // The manager offers every capable peer it holds, asked or not - which is
      // what it does in production now that no record of asking lives there.
      // Whether a peer is a candidate is decided by the orchestrator's own
      // request table, so a double that pre-filtered would hide that.
      getEligibleSyncPeersStub.callsFake(() => [
        ...peers.filter((p) => !removed.has(p.key)), ...extra,
      ]);
      return { orchestrator, peers, extra };
    };

    // The case the previous design could not see at all.
    it('replaces every peer when none of them ever says anything', async () => {
      const { peers, extra } = await askThree();

      await clock.tickAsync(FIRST_RESPONSE_MS + 1);

      expect(extra.filter((p) => p.send.called).length, 'silent peers were never replaced').to.equal(3);
      for (const peer of peers) expect(peer.send.callCount, 'a silent peer was asked twice').to.equal(4);
    });

    it('keeps a peer that is still sending, past the first-response deadline', async () => {
      const { peers, extra } = await askThree();

      // One batch is enough to prove it is working. A large answer arrives over
      // many of these and only the last one is a completion.
      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_PROGRESS, peers[0].key);
      await clock.tickAsync(FIRST_RESPONSE_MS + 1);

      expect(extra.filter((p) => p.send.called).length, 'a peer mid-answer was replaced').to.equal(2);
    });

    it('replaces a peer that starts answering and then stops', async () => {
      const { orchestrator, peers } = await askThree(12);

      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_PROGRESS, peers[0].key);
      await clock.tickAsync(FIRST_RESPONSE_MS + 1);
      const wantedAfterFirstWindow = orchestrator.isSyncResponseWanted(peers[0]);

      await clock.tickAsync(STALL_MS + 1);

      // Asserted on this peer's own record, not on how many spares were
      // consumed: the two that never spoke are replaced by spares that also
      // never speak, so a spare count reaches any number you like without this
      // peer's stall deadline ever firing. The record is also the fact the
      // response gate reads, so this is the difference that matters.
      expect(wantedAfterFirstWindow, 'a peer mid-answer was written off at the first-response deadline').to.equal(true);
      expect(orchestrator.isSyncResponseWanted(peers[0]), 'a peer that stopped mid-answer was never replaced').to.equal(false);
    });

    it('keeps a peer alive for as long as it keeps sending', async () => {
      const { orchestrator, peers } = await askThree(12);

      appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_PROGRESS, peers[0].key);
      // Four stall windows of steady batches: total elapsed is well past any
      // whole-answer deadline, which is the point - a peer ninety percent
      // through a large transfer must not be abandoned for taking a while.
      // Asserted on the peer itself rather than on how many spares were used,
      // because the silent two are replaced by spares that also go silent.
      for (let i = 0; i < 4; i += 1) {
        await clock.tickAsync(STALL_MS - 1);
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_PROGRESS, peers[0].key);
      }
      await clock.tickAsync(1);

      expect(orchestrator.isSyncResponseWanted(peers[0]), 'a peer delivering steadily was written off').to.equal(true);
      expect(peers[0].send.callCount, 'a peer delivering steadily was asked again').to.equal(4);
    });

    // A closed socket is a fact. Waiting out a deadline for something already
    // known would spend the whole first-response window for nothing.
    it('frees a slot the moment the socket closes, without waiting for a deadline', async () => {
      const { extra } = await askThree();

      removePeer('10.0.0.1:16127');
      await clock.tickAsync(0);

      expect(extra.filter((p) => p.send.called).length, 'a closed socket did not free its slot at once').to.equal(1);
    });

    it('holds no slot for a peer that has answered in full', async () => {
      const { extra } = await askThree();

      for (const type of ['apprunning', 'appinstalling', 'apperrors']) {
        appSyncEvents.emit(EVENTS.EPHEMERAL_SYNC_COMPLETE, type, '10.0.0.1:16127');
      }
      await clock.tickAsync(FIRST_RESPONSE_MS + 1);

      // Its answer is in, so its deadline is gone with it - only the two that
      // never spoke are replaced, and the finished peer is not asked again.
      expect(extra.filter((p) => p.send.called).length, 'a finished peer was replaced or re-asked').to.equal(2);
    });

    it('fires no slot deadline after stop', async () => {
      const { orchestrator, extra } = await askThree();

      orchestrator.stop();
      await clock.tickAsync(STALL_MS * 2);

      expect(extra.some((p) => p.send.called), 'a stopped orchestrator went on asking peers').to.equal(false);
    });
  });

  describe('state sync readiness', () => {
    it('should reach READY when all 3 sync types complete from 3 peers', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
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

      const orchestrator = makeOrchestrator();
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

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      // After sync but before enough blocks, should still be SYNCING
      expect(orchestrator.state).to.equal(STATES.SYNCING);

      // Past the fallback's 250 blocks, so it reaches READY on the timer
      for (let i = 0; i < 260; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);
      expect(orchestrator.state).to.equal(STATES.READY);
    });

    it('should reset sync completions on degradation', async () => {
      const peers = makeEligiblePeers(3);
      getEligibleSyncPeersStub = sinon.stub().returns(peers);

      const orchestrator = makeOrchestrator();
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

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);


      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      // All 3 retries happen via timers — we can't wait for real timers in tests
      // But we can verify the block timer fallback works
      expect(orchestrator.state).to.equal(STATES.SYNCING);

      // Past the fallback's 250 blocks, so the block timer fires
      for (let i = 0; i < 260; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555001 + i);
      }
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.READY);
    });

    it('should reach READY via block timer when hash sync never completes', async () => {
      syncMissingHashesStub.rejects(new Error('failed'));

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);


      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      // Past the fallback's 250 blocks
      for (let i = 1; i <= 260; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      // Block timer should have triggered DB rebuild and readiness
      expect(orchestrator.state).to.equal(STATES.READY);
      expect(reindexStub.called).to.be.true;
    });

    it('should not get stuck when DB rebuild fails', async () => {
      reindexStub.rejects(new Error('reindex failed'));

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      // Hash sync succeeded but DB rebuild failed
      expect(syncMissingHashesStub.calledOnce).to.be.true;

      // Block timer should still allow readiness (will retry DB rebuild)
      for (let i = 1; i <= 260; i += 1) {
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

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      for (let i = 1; i <= 260; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.READY);
      expect(globalStateStub.dbReady).to.be.true;
    });

    it('should set dbReady when too few sync peers and block timer fires', async () => {
      getEligibleSyncPeersStub = sinon.stub().returns([]);

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      for (let i = 1; i <= 260; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.READY);
      expect(globalStateStub.dbReady).to.be.true;
    });

    it('should leave dbReady false when rebuildDb throws on fallback path', async () => {
      syncMissingHashesStub.rejects(new Error('failed'));
      reindexStub.rejects(new Error('reindex failed'));

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);

      for (let i = 1; i <= 260; i += 1) {
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
      const orchestrator = makeUncapableOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 260; i += 1) {
        blockEmitter.emit('blocksProcessed', 2555000 + i);
      }
      await clock.tickAsync(0);

      expect(orchestrator.state).to.equal(STATES.SYNCING);
    });

    it('should reach READY when capability gained after other conditions met', async () => {
      const orchestrator = makeUncapableOrchestrator();
      orchestrator.start(defaultBootContext);

      // Explorer syncs but hash sync deferred (no capability)
      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 260; i += 1) {
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

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 260; i += 1) {
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

      const orchestrator = makeOrchestrator();
      orchestrator.start(defaultBootContext);


      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 260; i += 1) {
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
      const orchestrator = makeUncapableOrchestrator();
      orchestrator.start(defaultBootContext);
      orchestrator.onMessageCapabilityChange(false);
      orchestrator.onMessageCapabilityChange(false);

      expect(logStub.info.calledWith('AppSyncOrchestrator - Message capability lost')).to.be.false;
    });

    it('should not produce log spam from block events when not confirmed', async () => {
      const orchestrator = makeUncapableOrchestrator();
      orchestrator.start(defaultBootContext);

      blockEmitter.emit('blocksProcessed', 2555000);
      await clock.tickAsync(0);
      for (let i = 0; i < 260; i += 1) {
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
