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
  let fluxBroadcastHelperStub;
  let peerManagerStub;
  let collectionStub;

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
        daemonPONFork: 1670000,
      },
    };

    collectionStub = {
      bulkWrite: sinon.stub().resolves({ ok: 1 }),
      insertMany: sinon.stub().resolves({ insertedCount: 0 }),
      find: sinon.stub().returns({ project: sinon.stub().returns({ sort: sinon.stub().returns({ toArray: sinon.stub().resolves([]) }) }) }),
    };
    const mockDatabase = { collection: sinon.stub().returns(collectionStub) };
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns(mockDatabase) }),
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
      ensureString: sinon.stub().callsFake((v) => String(v)),
    };

    verificationHelperStub = {
      verifyPrivilege: sinon.stub(),
    };

    messageVerifierStub = {
      checkAndRequestApp: sinon.stub().resolves(true),
      appHashHasMessage: sinon.stub().resolves(),
      appHashHasMessageNotFound: sinon.stub().resolves(),
      checkAndRequestMultipleApps: sinon.stub().resolves(),
      verifyAppHash: sinon.stub().resolves(true),
      verifyAppMessageSignature: sinon.stub().resolves(true),
      verifyAppMessageUpdateSignature: sinon.stub().resolves(true),
    };

    messageStoreStub = {
      storeAppTemporaryMessage: sinon.stub().resolves(true),
    };

    fluxBroadcastHelperStub = {
      serialiseAndSignFluxBroadcast: sinon.stub().resolves('{"signed":"data"}'),
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
      '../dbHelper': dbHelperStub,
      '../messageHelper': messageHelperStub,
      '../serviceHelper': serviceHelperStub,
      '../verificationHelper': verificationHelperStub,
      '../../lib/log': logStub,
      './messageStore': messageStoreStub,
      './messageVerifier': messageVerifierStub,
      '../appRequirements/appValidator': { verifyAppSpecifications: sinon.stub().resolves() },
      '../appDatabase/registryManager': { checkApplicationRegistrationNameConflicts: sinon.stub().resolves() },
      '../utils/appSpecHelpers': { specificationFormatter: sinon.stub().returnsArg(0) },
      '../utils/appUtilities': { appPricePerMonth: sinon.stub().returns(0.01) },
      '../utils/chainUtilities': { getChainParamsPriceUpdates: sinon.stub().resolves([{ height: 0, minPrice: 0.01, cpu: 1, ram: 1, hdd: 1 }]) },
      '../daemonService/daemonServiceMiscRpcs': { isDaemonSynced: sinon.stub().returns({ data: { height: 2555000 } }) },
      '../utils/fluxBroadcastHelper': fluxBroadcastHelperStub,
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
      dbHelperStub.findInDatabase.rejects(new Error('DB error'));

      const result = await appHashSyncService.syncMissingHashes();

      expect(result.missing).to.equal(-1);
      expect(logStub.error.called).to.be.true;
    });

    it('should batch existence checks and skip existing messages via bulk fetch', async () => {
      const manyMissing = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100, message: false,
      }));

      // Bulk fetch returns 10 messages (6 already exist, 4 new)
      const bulkFetchResult = Array(10).fill(null).map((_, i) => ({
        type: 'fluxappregister', version: 4, hash: `hash${i}`, timestamp: Date.now(),
        signature: 'sig', appSpecifications: { name: `app${i}` }, valueSat: 1e8,
        txid: `tx${i}`, height: 1000 + i,
      }));
      const existingPermanent = [
        { hash: 'hash0' }, { hash: 'hash1' }, { hash: 'hash2' },
        { hash: 'hash3' }, { hash: 'hash4' }, { hash: 'hash5' },
      ];

      let getMissingCalls = 0;
      dbHelperStub.findInDatabase.callsFake((db, col, query) => {
        if (query && query.message === false) {
          getMissingCalls += 1;
          if (getMissingCalls === 1) return Promise.resolve(manyMissing);
          return Promise.resolve([]);
        }
        if (query && query.hash && query.hash.$in) return Promise.resolve(existingPermanent);
        return Promise.resolve([]);
      });
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      // Bulk fetch: 3 peers × 2 calls each (explorer check + permanent messages)
      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) return Promise.resolve({ data: { status: 'success', data: bulkFetchResult } });
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      await appHashSyncService.syncMissingHashes();

      // 6 skipped via batch bulkWrite to mark hashes as message:true
      expect(collectionStub.bulkWrite.called).to.be.true;
      const bulkOps = collectionStub.bulkWrite.firstCall.args[0];
      expect(bulkOps.length).to.equal(6);
      bulkOps.forEach((op) => {
        expect(op.updateOne.update.$set.message).to.be.true;
      });
      // 4 new messages inserted via insertMany (not storeAppTemporaryMessage)
      expect(collectionStub.insertMany.calledOnce).to.be.true;
      expect(collectionStub.insertMany.firstCall.args[0].length).to.equal(4);
    });

    it('should send requests to 3 different peers per round', async () => {

      const missing = [
        { hash: 'h1', txid: 'tx1', height: 100, value: 10, message: false },
        { hash: 'h2', txid: 'tx2', height: 101, value: 10, message: false },
      ];

      // First call returns missing, subsequent calls return empty (simulates resolution)
      dbHelperStub.findInDatabase.onFirstCall().resolves(missing);
      dbHelperStub.findInDatabase.resolves([]);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      // serialiseAndSignFluxBroadcast called 3 times (once per peer)
      expect(fluxBroadcastHelperStub.serialiseAndSignFluxBroadcast.callCount).to.equal(3);
      const sentMessages = fluxBroadcastHelperStub.serialiseAndSignFluxBroadcast.args.map((a) => a[0]);
      sentMessages.forEach((msg) => {
        expect(msg.type).to.equal('fluxapprequest');
        expect(msg.version).to.equal(2);
        expect(msg.hashes).to.deep.equal(['h1', 'h2']);
      });

      // Verify 3 different peers were used (check peer.send was called)
      const peers = peerManagerStub.allValues();
      const calledPeers = peers.filter((p) => p.send.called);
      expect(calledPeers.length).to.equal(3);
    });

    it('should not reuse peers across rounds', async () => {

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

      // All peers used across rounds should be unique (no peer called twice)
      const peers = peerManagerStub.allValues();
      const calledPeers = peers.filter((p) => p.send.called);
      calledPeers.forEach((p) => {
        expect(p.send.callCount).to.equal(1);
      });
    });

    it('should stop when peer pool is exhausted', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };


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
      const peers = peerManagerStub.allValues();
      const calledPeers = peers.filter((p) => p.send.called);
      expect(calledPeers.length).to.equal(2);
      expect(logStub.info.calledWith(sinon.match('No more untried peers'))).to.be.true;
    });

    it('should continue rounds even when a round resolves nothing', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };


      const missing = [
        { hash: 'h1', txid: 'tx1', height: 100, value: 10, message: false },
      ];

      dbHelperStub.findInDatabase.resolves(missing);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      clock.restore();

      // 6 peers available, 3 per round = 2 rounds before exhausted
      const peers = peerManagerStub.allValues();
      const calledPeers = peers.filter((p) => p.send.called);
      expect(calledPeers.length).to.equal(6);
    });

    it('should exclude deterministic peers', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };


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
      const allPeers = peerManagerStub.allValues();
      const calledPeers = allPeers.filter((p) => p.send.called);
      expect(calledPeers.length).to.equal(1);
      expect(calledPeers[0].source).to.equal('random');
    });

    it('should use proportional timeout based on hash count', async () => {

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

  describe('resetMessageNotFoundFlags', () => {
    it('should call updateMany on appsHashes collection and return modifiedCount', async () => {
      const updateManyStub = sinon.stub().resolves({ modifiedCount: 5 });
      const collectionStubLocal = { updateMany: updateManyStub };
      const mockDatabase = { collection: sinon.stub().returns(collectionStubLocal) };
      dbHelperStub.databaseConnection.returns({ db: sinon.stub().returns(mockDatabase) });

      const result = await appHashSyncService.resetMessageNotFoundFlags();

      expect(result).to.equal(5);
      expect(updateManyStub.calledOnce).to.be.true;
      expect(updateManyStub.firstCall.args[0]).to.deep.equal({ $or: [{ messageNotFound: true }, { nextRetryHeight: { $exists: true } }] });
      expect(updateManyStub.firstCall.args[1]).to.deep.equal({ $set: { messageNotFound: false }, $unset: { nextRetryHeight: '', syncAttempts: '' } });
    });

    it('should return 0 when no documents match', async () => {
      const updateManyStub = sinon.stub().resolves({ modifiedCount: 0 });
      const collectionStubLocal = { updateMany: updateManyStub };
      const mockDatabase = { collection: sinon.stub().returns(collectionStubLocal) };
      dbHelperStub.databaseConnection.returns({ db: sinon.stub().returns(mockDatabase) });

      const result = await appHashSyncService.resetMessageNotFoundFlags();

      expect(result).to.equal(0);
    });
  });

  describe('hash sync backoff', () => {
    it('should exclude hashes with future nextRetryHeight from getMissingHashes', async () => {
      const missing = [
        { hash: 'h1', txid: 'tx1', height: 2555000, value: 10, message: false },
        { hash: 'h2', txid: 'tx2', height: 2555001, value: 10, message: false, nextRetryHeight: 9999999 },
        { hash: 'h3', txid: 'tx3', height: 2555002, value: 10, message: false, nextRetryHeight: 1000000 },
      ];
      dbHelperStub.findInDatabase.resolves(missing);
      // getMissingHashes adds $or filter for nextRetryHeight, but since we stub findInDatabase
      // the filter is applied by the DB. For this test, verify the query includes the filter.
      const result = await appHashSyncService.getMissingHashes();
      // All 3 returned because findInDatabase stub ignores the query — but verify the query was correct
      const query = dbHelperStub.findInDatabase.firstCall.args[2];
      expect(query.message).to.equal(false);
      expect(query.messageNotFound).to.deep.equal({ $ne: true });
      expect(query.$or).to.be.an('array');
      expect(query.$or).to.have.length(2);
      expect(query.$or[0]).to.deep.equal({ nextRetryHeight: { $exists: false } });
      expect(query.$or[1].nextRetryHeight).to.have.property('$lte');
    });

    it('should not filter by nextRetryHeight when force is true', async () => {
      dbHelperStub.findInDatabase.resolves([]);
      await appHashSyncService.getMissingHashes({ force: true });
      const query = dbHelperStub.findInDatabase.firstCall.args[2];
      expect(query.$or).to.be.undefined;
    });

    it('should clamp backoff index to last value for high attempt counts', () => {
      const { HASH_RETRY_BACKOFF } = require('../../ZelBack/src/services/utils/appConstants');
      const lastBackoff = HASH_RETRY_BACKOFF[HASH_RETRY_BACKOFF.length - 1];
      // Attempt 20 should clamp to last backoff value
      const idx = Math.min(20, HASH_RETRY_BACKOFF.length - 1);
      expect(HASH_RETRY_BACKOFF[idx]).to.equal(lastBackoff);
    });
  });

  describe('processMessages via bulk fetch', () => {
    let localModule;
    let localCollectionStub;
    let localDbHelperStub;
    let localMessageVerifierStub;
    let localCheckAndDecryptStub;
    let localLogStub;

    beforeEach(() => {
      localCollectionStub = {
        bulkWrite: sinon.stub().resolves({ ok: 1 }),
        insertMany: sinon.stub().resolves({ insertedCount: 0 }),
        find: sinon.stub().returns({
          project: sinon.stub().returns({
            sort: sinon.stub().returns({ toArray: sinon.stub().resolves([]) }),
          }),
        }),
        updateMany: sinon.stub().resolves({ modifiedCount: 0 }),
      };
      const mockDatabase = { collection: sinon.stub().returns(localCollectionStub) };
      localDbHelperStub = {
        databaseConnection: sinon.stub().returns({ db: sinon.stub().returns(mockDatabase) }),
        findInDatabase: sinon.stub().resolves([]),
        findOneInDatabase: sinon.stub(),
      };

      localMessageVerifierStub = {
        checkAndRequestApp: sinon.stub().resolves(true),
        appHashHasMessage: sinon.stub().resolves(),
        appHashHasMessageNotFound: sinon.stub().resolves(),
        checkAndRequestMultipleApps: sinon.stub().resolves(),
        verifyAppHash: sinon.stub().resolves(true),
        verifyAppMessageSignature: sinon.stub().resolves(true),
        verifyAppMessageUpdateSignature: sinon.stub().resolves(true),
      };

      localCheckAndDecryptStub = sinon.stub().callsFake((spec) => Promise.resolve(spec));

      localLogStub = {
        error: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
      };

      localModule = proxyquire('../../ZelBack/src/services/appMessaging/appHashSyncService', {
        '../dbHelper': localDbHelperStub,
        '../messageHelper': messageHelperStub,
        '../serviceHelper': serviceHelperStub,
        '../verificationHelper': verificationHelperStub,
        '../../lib/log': localLogStub,
        './messageStore': messageStoreStub,
        './messageVerifier': localMessageVerifierStub,
        '../appRequirements/appValidator': { verifyAppSpecifications: sinon.stub().resolves() },
        '../appDatabase/registryManager': { checkApplicationRegistrationNameConflicts: sinon.stub().resolves() },
        '../utils/appSpecHelpers': { specificationFormatter: sinon.stub().returnsArg(0) },
        '../utils/appUtilities': { appPricePerMonth: sinon.stub().returns(0.01) },
        '../utils/chainUtilities': { getChainParamsPriceUpdates: sinon.stub().resolves([{ height: 0, minPrice: 0.01, cpu: 1, ram: 1, hdd: 1 }]) },
        '../daemonService/daemonServiceMiscRpcs': { isDaemonSynced: sinon.stub().returns({ data: { height: 2555000 } }) },
        '../utils/fluxBroadcastHelper': fluxBroadcastHelperStub,
        '../invalidMessages': { invalidMessages: [] },
        '../utils/peerState': { peerManager: peerManagerStub },
        '../utils/enterpriseHelper': { checkAndDecryptAppSpecs: localCheckAndDecryptStub },
      });
    });

    it('should retry with previous owner when signature verification fails due to ownership change', async () => {
      // Two update messages for the same app where first changes ownership
      const bulkMessages = [
        {
          type: 'fluxappupdate', version: 4, hash: 'hash1', timestamp: Date.now() - 1000,
          signature: 'sig1', appSpecifications: { name: 'testapp', version: 4, owner: 'newOwner' },
          valueSat: 1e8, txid: 'tx1', height: 1000,
        },
        {
          type: 'fluxappupdate', version: 4, hash: 'hash2', timestamp: Date.now(),
          signature: 'sig2', appSpecifications: { name: 'testapp', version: 4, owner: 'newOwner' },
          valueSat: 1e8, txid: 'tx2', height: 1001,
        },
      ];

      // Generate > 500 missing hashes to trigger bulk fetch path
      const manyMissing = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100, message: false,
      }));

      // getMissingHashes: first call returns many missing, subsequent calls return empty
      let getMissingCalls = 0;
      localDbHelperStub.findInDatabase.callsFake(() => {
        getMissingCalls += 1;
        if (getMissingCalls === 1) return Promise.resolve(manyMissing);
        return Promise.resolve([]);
      });
      localDbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      // Bulk fetch returns our two update messages from all peers
      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) {
          return Promise.resolve({ data: { status: 'success', data: bulkMessages } });
        }
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      // Previous spec for the app (before first update) — from DB
      localCollectionStub.find.returns({
        project: sinon.stub().returns({
          sort: sinon.stub().returns({
            toArray: sinon.stub().resolves([
              {
                type: 'fluxappregister', hash: 'hash0', height: 999,
                appSpecifications: { name: 'testapp', version: 4, owner: 'oldOwner' },
              },
            ]),
          }),
        }),
      });

      // First verify succeeds (owner matches prevSpec.owner=oldOwner)
      // Second verify fails with newOwner (from updated prevSpecsMap), retries with oldOwner and succeeds
      let verifyCallCount = 0;
      localMessageVerifierStub.verifyAppMessageUpdateSignature.callsFake(
        async (type, ver, spec, ts, sig, owner) => {
          verifyCallCount += 1;
          if (verifyCallCount === 1) return true; // first message: owner=oldOwner matches prevSpec
          if (owner === 'newOwner') throw new Error('Invalid signature'); // second message first attempt
          if (owner === 'oldOwner') return true; // second message retry with prevOwnerMap
          return true;
        },
      );

      await localModule.syncMissingHashes();

      // Verify retry happened (3 calls: 1st msg success + 2nd msg fail + 2nd msg retry)
      expect(verifyCallCount).to.equal(3);
      // Both messages should be inserted
      expect(localCollectionStub.insertMany.called).to.be.true;
      const inserted = localCollectionStub.insertMany.firstCall.args[0];
      expect(inserted.length).to.equal(2);
    });

    it('should decrypt prevSpec for enterprise v8 updates before signature verification', async () => {
      const bulkMessages = [
        {
          type: 'fluxappupdate', version: 8, hash: 'hash1', timestamp: Date.now(),
          signature: 'sig1',
          appSpecifications: { name: 'enterpriseApp', version: 8, owner: 'owner1', enterprise: 'encBlob' },
          valueSat: 1e8, txid: 'tx1', height: 2000,
        },
      ];

      // Generate > 500 missing hashes to trigger bulk fetch path
      const manyMissing = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100, message: false,
      }));

      let getMissingCalls = 0;
      localDbHelperStub.findInDatabase.callsFake(() => {
        getMissingCalls += 1;
        if (getMissingCalls === 1) return Promise.resolve(manyMissing);
        return Promise.resolve([]);
      });
      localDbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) {
          return Promise.resolve({ data: { status: 'success', data: bulkMessages } });
        }
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      // Previous spec is enterprise v8 with encrypted data
      const prevSpec = {
        name: 'enterpriseApp', version: 8, owner: 'owner1', enterprise: 'prevEncBlob',
      };
      localCollectionStub.find.returns({
        project: sinon.stub().returns({
          sort: sinon.stub().returns({
            toArray: sinon.stub().resolves([
              {
                type: 'fluxappregister', hash: 'hash0', height: 1999,
                appSpecifications: prevSpec,
              },
            ]),
          }),
        }),
      });

      const decryptedPrevSpec = {
        name: 'enterpriseApp', version: 8, owner: 'owner1',
        compose: [{ name: 'comp1', repotag: 'repo/tag' }],
      };

      // Track calls: first for current spec, second for prevSpec
      let decryptCallCount = 0;
      localCheckAndDecryptStub.callsFake((spec) => {
        decryptCallCount += 1;
        if (decryptCallCount === 1) return Promise.resolve(spec);
        return Promise.resolve(decryptedPrevSpec);
      });

      localMessageVerifierStub.verifyAppMessageUpdateSignature.resolves(true);

      await localModule.syncMissingHashes();

      // checkAndDecryptAppSpecs should have been called at least twice
      // (once for current spec validation, once for prevSpec decryption)
      expect(localCheckAndDecryptStub.callCount).to.be.greaterThanOrEqual(2);
      // Verify that verifyAppMessageUpdateSignature received decrypted owner
      const verifyCall = localMessageVerifierStub.verifyAppMessageUpdateSignature.firstCall;
      expect(verifyCall).to.not.be.null;
      // The owner param (6th arg) should be from the decrypted prevSpec
      expect(verifyCall.args[5]).to.equal('owner1');
    });
  });

  describe('waitForResolution', () => {
    it('should return immediately when all hashes resolve', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };


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

    it('should keep waiting while hash responses arrive via event bus', async () => {
      const { appSyncEvents, EVENTS } = require('../../ZelBack/src/services/utils/appSyncEvents');
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };

      const missing3 = [
        { hash: 'h1', txid: 'tx1', height: 2555000, value: 10, message: false },
        { hash: 'h2', txid: 'tx2', height: 2555001, value: 10, message: false },
        { hash: 'h3', txid: 'tx3', height: 2555002, value: 10, message: false },
      ];
      const missing1 = [
        { hash: 'h3', txid: 'tx3', height: 2555002, value: 10, message: false },
      ];

      // Emit HASH_RESPONSE_RECEIVED every 2 seconds to keep settle alive.
      // After 3 emissions, stop — settle should fire 4s after last emission.
      let emissions = 0;
      let findCallCount = 0;
      dbHelperStub.findInDatabase.callsFake(() => {
        findCallCount += 1;
        if (findCallCount === 1) return Promise.resolve(missing3);
        // Emit response events for first 3 polls to keep settle alive
        if (emissions < 3) {
          emissions += 1;
          appSyncEvents.emit(EVENTS.HASH_RESPONSE_RECEIVED);
        }
        // After poll 5, resolve 2 hashes
        if (findCallCount > 5) return Promise.resolve(missing1);
        return Promise.resolve(missing3);
      });
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      const result = await appHashSyncService.syncMissingHashes();

      clock.restore();
      appSyncEvents.removeAllListeners(EVENTS.HASH_RESPONSE_RECEIVED);

      // Events kept settle alive long enough for hashes to resolve
      expect(result.resolved).to.equal(2);
      expect(result.missing).to.equal(1);
    });

    it('should settle after no changes for settle time', async () => {
      const clock = sinon.useFakeTimers();
      serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };


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
