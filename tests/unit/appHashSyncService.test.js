const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appHashSyncService tests', () => {
  let appHashSyncService;
  let dbHelperStub;
  let messageHelperStub;
  let serviceHelperStub;
  let verificationHelperStub;
  let logStub;
  let configStub;
  let messageVerifierStub;
  let messageStoreStub;
  let fluxCommSenderStub;
  let peerManagerStub;

  function makePeer(ip, port, source = 'random') {
    return {
      key: `${ip}:${port}`,
      ip,
      port,
      source,
      send: sinon.stub(),
      toPeerInfo: () => ({ ip, port }),
    };
  }

  beforeEach(() => {
    configStub = {
      database: {
        daemon: {
          collections: {
            scannedHeight: 'scannedHeight',
            appsHashes: 'appsHashes',
          },
          database: 'daemon',
        },
        appsglobal: {
          collections: {
            appsMessages: 'appsMessages',
          },
          database: 'globalapps',
        },
      },
      fluxapps: {
        blocksLasting: 22000,
      },
    };

    dbHelperStub = {
      databaseConnection: sinon.stub(),
      findInDatabase: sinon.stub(),
      findOneInDatabase: sinon.stub(),
    };

    messageHelperStub = {
      createErrorMessage: sinon.stub(),
      createSuccessMessage: sinon.stub(),
      errUnauthorizedMessage: sinon.stub().returns({ status: 'error' }),
    };

    serviceHelperStub = {
      axiosGet: sinon.stub(),
      delay: sinon.stub().resolves(),
      ensureNumber: sinon.stub().returnsArg(0),
    };

    verificationHelperStub = {
      verifyPrivilege: sinon.stub(),
    };

    messageVerifierStub = {
      checkAndRequestApp: sinon.stub().resolves(true),
      appHashHasMessage: sinon.stub().resolves(),
      appHashHasMessageNotFound: sinon.stub().resolves(),
      checkAndRequestMultipleApps: sinon.stub().resolves(),
    };

    messageStoreStub = {
      storeAppTemporaryMessage: sinon.stub().resolves(true),
    };

    fluxCommSenderStub = {
      sendSignedMessage: sinon.stub().resolves(),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    peerManagerStub = {
      getRandomPeer: sinon.stub().returns(makePeer('192.168.1.1', '16127')),
      allValues: sinon.stub().returns([
        makePeer('10.0.0.1', '16127'),
        makePeer('10.0.0.2', '16127'),
        makePeer('10.0.0.3', '16127'),
        makePeer('10.0.0.4', '16127'),
        makePeer('10.0.0.5', '16127'),
        makePeer('10.0.0.6', '16127'),
      ]),
    };

    appHashSyncService = proxyquire('../../ZelBack/src/services/appMessaging/appHashSyncService', {
      config: configStub,
      '../dbHelper': dbHelperStub,
      '../messageHelper': messageHelperStub,
      '../serviceHelper': serviceHelperStub,
      '../verificationHelper': verificationHelperStub,
      '../../lib/log': logStub,
      './messageStore': messageStoreStub,
      './messageVerifier': messageVerifierStub,
      '../fluxCommunicationMessagesSender': fluxCommSenderStub,
      '../invalidMessages': { invalidMessages: [] },
      '../utils/peerState': { peerManager: peerManagerStub },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('triggerAppHashesCheckAPI', () => {
    it('should trigger sync when authorized', async () => {
      const req = {};
      const res = { json: sinon.stub() };

      verificationHelperStub.verifyPrivilege.resolves(true);
      messageHelperStub.createSuccessMessage.returns({ status: 'success' });

      await appHashSyncService.triggerAppHashesCheckAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.calledWith('adminandfluxteam', req)).to.be.true;
    });

    it('should deny unauthorized access', async () => {
      const req = {};
      const res = { json: sinon.stub() };

      verificationHelperStub.verifyPrivilege.resolves(false);

      await appHashSyncService.triggerAppHashesCheckAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.errUnauthorizedMessage.calledOnce).to.be.true;
    });

    it('should handle errors gracefully', async () => {
      const req = {};
      const res = { json: sinon.stub() };
      const error = new Error('Test error');

      verificationHelperStub.verifyPrivilege.rejects(error);
      messageHelperStub.createErrorMessage.returns({ status: 'error' });

      await appHashSyncService.triggerAppHashesCheckAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.calledWith(error)).to.be.true;
    });
  });

  describe('getMissingHashes', () => {
    it('should return missing hashes sorted by height', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves([
        { hash: 'b', height: 200, message: false },
        { hash: 'a', height: 100, message: false },
      ]);

      const result = await appHashSyncService.getMissingHashes();

      expect(result).to.have.lengthOf(2);
      expect(result[0].hash).to.equal('a');
      expect(result[1].hash).to.equal('b');
    });

    it('should exclude invalid messages when not forced', async () => {
      const mod = proxyquire('../../ZelBack/src/services/appMessaging/appHashSyncService', {
        config: configStub,
        '../dbHelper': dbHelperStub,
        '../messageHelper': messageHelperStub,
        '../serviceHelper': serviceHelperStub,
        '../verificationHelper': verificationHelperStub,
        '../../lib/log': logStub,
        './messageStore': messageStoreStub,
        './messageVerifier': messageVerifierStub,
        '../invalidMessages': {
          invalidMessages: [{ hash: 'invalid1', txid: 'tx1' }],
        },
        '../utils/peerState': {
          peerManager: { getRandomPeer: () => null },
        },
      });

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves([
        { hash: 'invalid1', txid: 'tx1', height: 100, message: false },
        { hash: 'valid1', txid: 'tx2', height: 200, message: false },
      ]);

      const result = await mod.getMissingHashes();
      expect(result).to.have.lengthOf(1);
      expect(result[0].hash).to.equal('valid1');
    });

    it('should return empty array when no hashes are missing', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves([]);

      const result = await appHashSyncService.getMissingHashes();
      expect(result).to.have.lengthOf(0);
    });
  });

  describe('syncMissingHashes', () => {
    it('should return immediately when no hashes are missing', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves([]);

      const result = await appHashSyncService.syncMissingHashes();

      expect(result.resolved).to.equal(0);
      expect(result.missing).to.equal(0);
    });

    it('should skip when already running', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      // Make findInDatabase slow so syncMissingHashes is still running when we call again
      let resolveFirst;
      const firstCallPromise = new Promise((r) => { resolveFirst = r; });
      dbHelperStub.findInDatabase.onFirstCall().returns(firstCallPromise);
      dbHelperStub.findInDatabase.onSecondCall().resolves([]);

      const first = appHashSyncService.syncMissingHashes();
      const second = await appHashSyncService.syncMissingHashes();

      expect(second.resolved).to.equal(0);
      expect(logStub.info.calledWith('syncMissingHashes - Already running, skipping')).to.be.true;

      resolveFirst([]);
      await first;
    });

    it('should use bulk fetch when many hashes are missing', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      const manyMissing = Array(1500).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100, message: false,
      }));

      // First call: getMissingHashes returns many
      // Subsequent calls (after bulk fetch): return empty
      dbHelperStub.findInDatabase.onFirstCall().resolves(manyMissing);
      dbHelperStub.findInDatabase.resolves([]);
      dbHelperStub.findOneInDatabase.resolves(null);

      serviceHelperStub.axiosGet.resolves({
        data: { status: 'success', data: true },
      });

      // Bulk fetch returns no messages (peer has nothing)
      serviceHelperStub.axiosGet.onSecondCall().resolves({
        data: { status: 'success', data: [] },
      });

      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      const result = await appHashSyncService.syncMissingHashes();

      // Should have attempted bulk fetch (axiosGet called for explorer sync check + permanent messages)
      expect(serviceHelperStub.axiosGet.called).to.be.true;
      expect(logStub.info.calledWith(sinon.match('using bulk fetch'))).to.be.true;
    });

    it('should handle errors without crashing', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.rejects(new Error('DB error'));

      const result = await appHashSyncService.syncMissingHashes();

      expect(result.missing).to.equal(-1);
      expect(logStub.error.called).to.be.true;
    });

    it('should send requests to 3 different peers per round', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      const missing = [
        { hash: 'h1', txid: 'tx1', height: 100, value: 10, message: false },
        { hash: 'h2', txid: 'tx2', height: 101, value: 10, message: false },
      ];

      // First call returns missing, subsequent calls return empty (simulates resolution)
      dbHelperStub.findInDatabase.onFirstCall().resolves(missing);
      dbHelperStub.findInDatabase.resolves([]);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      expect(fluxCommSenderStub.sendSignedMessage.callCount).to.equal(3);
      const sentMessages = fluxCommSenderStub.sendSignedMessage.args.map((a) => a[0]);
      sentMessages.forEach((msg) => {
        expect(msg.type).to.equal('fluxapprequest');
        expect(msg.version).to.equal(2);
        expect(msg.hashes).to.deep.equal(['h1', 'h2']);
      });

      // Verify 3 different peers were used
      const peerKeys = fluxCommSenderStub.sendSignedMessage.args.map((a) => a[1].key);
      const uniqueKeys = new Set(peerKeys);
      expect(uniqueKeys.size).to.equal(3);
    });

    it('should not reuse peers across rounds', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      const missing = [
        { hash: 'h1', txid: 'tx1', height: 100, value: 10, message: false },
      ];

      // Return missing for 2 rounds then empty
      let callCount = 0;
      dbHelperStub.findInDatabase.callsFake(() => {
        callCount += 1;
        // Calls 1-3 return missing (initial + round 1 polls), then empty
        if (callCount <= 3) return Promise.resolve(missing);
        return Promise.resolve([]);
      });
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      // All peers used across rounds should be unique
      const peerKeys = fluxCommSenderStub.sendSignedMessage.args.map((a) => a[1].key);
      const uniqueKeys = new Set(peerKeys);
      expect(uniqueKeys.size).to.equal(peerKeys.length);
    });

    it('should stop when peer pool is exhausted', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      // Only 2 peers available
      peerManagerStub.allValues.returns([
        makePeer('10.0.0.1', '16127'),
        makePeer('10.0.0.2', '16127'),
      ]);

      const missing = [
        { hash: 'h1', txid: 'tx1', height: 100, value: 10, message: false },
      ];

      dbHelperStub.findInDatabase.resolves(missing);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      clock.restore();

      // Should only send to 2 peers (pool exhausted)
      expect(fluxCommSenderStub.sendSignedMessage.callCount).to.equal(2);
      expect(logStub.info.calledWith(sinon.match('No more untried peers'))).to.be.true;
    });

    it('should continue rounds even when a round resolves nothing', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      const missing = [
        { hash: 'h1', txid: 'tx1', height: 100, value: 10, message: false },
      ];

      dbHelperStub.findInDatabase.resolves(missing);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      clock.restore();

      // 6 peers available, 3 per round = 2 rounds before exhausted
      expect(fluxCommSenderStub.sendSignedMessage.callCount).to.equal(6);
    });

    it('should exclude deterministic peers', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      // All peers are deterministic except one
      peerManagerStub.allValues.returns([
        makePeer('10.0.0.1', '16127', 'deterministic'),
        makePeer('10.0.0.2', '16127', 'deterministic'),
        makePeer('10.0.0.3', '16127', 'deterministic'),
        makePeer('10.0.0.4', '16127', 'random'),
      ]);

      const missing = [
        { hash: 'h1', txid: 'tx1', height: 100, value: 10, message: false },
      ];

      dbHelperStub.findInDatabase.resolves(missing);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      clock.restore();

      // Only the random peer should have been used
      expect(fluxCommSenderStub.sendSignedMessage.callCount).to.equal(1);
      const peerUsed = fluxCommSenderStub.sendSignedMessage.args[0][1];
      expect(peerUsed.source).to.equal('random');
    });

    it('should use proportional timeout based on hash count', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      const missing = Array(50).fill(null).map((_, i) => ({
        hash: `h${i}`, txid: `tx${i}`, height: 100 + i, value: 10, message: false,
      }));

      // Return missing once then empty (resolved after first poll)
      dbHelperStub.findInDatabase.onFirstCall().resolves(missing);
      dbHelperStub.findInDatabase.resolves([]);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      // serviceHelper.delay is called with 1000ms for polling
      const delayCalls = serviceHelperStub.delay.args.map((a) => a[0]);
      expect(delayCalls.every((d) => d === 1000)).to.be.true;
    });
  });

  describe('waitForResolution', () => {
    it('should return immediately when all hashes resolve', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      const missing = [
        { hash: 'h1', txid: 'tx1', height: 100, value: 10, message: false },
      ];

      dbHelperStub.findInDatabase.onFirstCall().resolves(missing);
      dbHelperStub.findInDatabase.resolves([]);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      const result = await appHashSyncService.syncMissingHashes();

      clock.restore();

      expect(result.resolved).to.equal(1);
      expect(result.missing).to.equal(0);
    });

    it('should settle after no changes for settle time', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);

      const missing3 = [
        { hash: 'h1', txid: 'tx1', height: 2555000, value: 10, message: false },
        { hash: 'h2', txid: 'tx2', height: 2555001, value: 10, message: false },
        { hash: 'h3', txid: 'tx3', height: 2555002, value: 10, message: false },
      ];
      const missing1 = [
        { hash: 'h3', txid: 'tx3', height: 2555002, value: 10, message: false },
      ];

      // Initial call: 3 missing. First poll in waitForResolution: drops to 1.
      // Subsequent polls: stays at 1, settles after 4s.
      let findCallCount = 0;
      dbHelperStub.findInDatabase.callsFake(() => {
        findCallCount += 1;
        if (findCallCount === 1) return Promise.resolve(missing3);
        return Promise.resolve(missing1);
      });
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      const result = await appHashSyncService.syncMissingHashes();

      clock.restore();

      // 2 of 3 resolved in first round, 1 remains (settled after no progress)
      expect(result.resolved).to.equal(2);
      expect(result.missing).to.equal(1);
    });
  });
});
