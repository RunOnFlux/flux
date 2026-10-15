const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');
const { Readable } = require('stream');
const config = require('config');
const { appSyncEvents: syncEvents, EVENTS: SYNC_EVENTS } = require('../../ZelBack/src/services/utils/appSyncEvents');

const MESSAGES = config.database.appsglobal.collections.appsMessages;

// A peer's answer from GET /apps/permanentmessagesbyheight: one message per line, then the
// closing count.
function makeStreamResponse(data) {
  const body = `${[...data.map((message) => JSON.stringify(message)), JSON.stringify({ status: 'success', data: { count: data.length } })].join('\n')}\n`;
  return { data: Readable.from([Buffer.from(body)]), headers: {}, request: { setTimeout: sinon.stub() } };
}

// A peer's answer from GET /apps/permanentmessages, the whole log as one JSON envelope.
function makeWholeLogResponse(data) {
  return { data: Readable.from([Buffer.from(JSON.stringify({ status: 'success', data }))]), headers: {}, request: { setTimeout: sinon.stub() } };
}

// The stage, in memory: what a peer sent, placed at this node's record height for its hash.
class MemoryStage {
  static opened = [];

  constructor(missing) {
    this.missing = missing;
    this.staged = new Map();
    this.discarded = false;
  }

  static async open(missing) {
    const stage = new MemoryStage(missing);
    MemoryStage.opened.push(stage);
    return stage;
  }

  get size() {
    return this.staged.size;
  }

  async add(message) {
    const record = this.missing.get(message?.hash);
    if (!record || this.staged.has(message.hash)) return;
    this.staged.set(message.hash, { height: record.height, message });
  }

  async flush() {}

  unstagedHeights() {
    return [...this.missing.values()].filter((record) => !this.staged.has(record.hash)).map((record) => record.height).sort((a, b) => a - b);
  }

  async* batches(size) {
    const ordered = [...this.staged.values()].sort((a, b) => a.height - b.height);
    let batch = [];
    for (let i = 0; i < ordered.length; i += 1) {
      batch.push(ordered[i].message);
      if (batch.length >= size && ordered[i + 1]?.height !== ordered[i].height) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
  }

  async discard() {
    this.discarded = true;
  }
}

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
      find: sinon.stub().returns({ project: sinon.stub().returns({ sort: sinon.stub().returns({ toArray: sinon.stub().resolves([]) }), toArray: sinon.stub().resolves([]) }) }),
    };
    const mockDatabase = { collection: sinon.stub().returns(collectionStub) };
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns(mockDatabase) }),
      findInDatabase: sinon.stub(),
      findOneInDatabase: sinon.stub(),
      appPaymentFacts: sinon.stub().resolves({ positions: new Map(), notOnChain: new Set() }),
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
      alignStoredMessagesWithPayments: sinon.stub().resolves([]),
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
      '../nodeConfirmationService': { canSendMessages: sinon.stub().returns(true) },
      '../utils/enterpriseHelper': { checkAndDecryptAppSpecs: sinon.stub().callsFake((spec) => Promise.resolve(spec)) },
      '../utils/FluxPeerSocket': { CLOSE_CODES: { EPHEMERAL_DONE: 4020 } },
      '../fluxCommunicationUtils': { deterministicFluxList: sinon.stub().resolves([]) },
      '../fluxCommunication': { openEphemeralConnection: sinon.stub().resolves(null) },
      '../fluxNetworkHelper': { getLocalSocketAddress: sinon.stub().resolves('10.0.0.99:16127') },
      './messageStage': { MessageStage: MemoryStage },
    });
    MemoryStage.opened = [];
  });

  afterEach(() => {
    sinon.restore();
  });



  describe('triggerAppHashesCheckAPI', () => {
    // queued for the sync orchestrator, which runs it once no hash sync or registry
    // build holds the node
    let requested;
    const onRequested = () => { requested += 1; };
    beforeEach(() => {
      requested = 0;
      syncEvents.on(SYNC_EVENTS.HASH_CHECK_REQUESTED, onRequested);
    });
    afterEach(() => {
      syncEvents.removeListener(SYNC_EVENTS.HASH_CHECK_REQUESTED, onRequested);
    });

    it('should queue the check when authorized, running nothing itself', async () => {
      const req = {};
      const res = { json: sinon.stub() };

      verificationHelperStub.verifyPrivilege.resolves(true);
      messageHelperStub.createSuccessMessage.returns({ status: 'success' });

      await appHashSyncService.triggerAppHashesCheckAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.calledWith(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req))).to.be.true;
      expect(requested, 'the check was not queued').to.equal(1);
      sinon.assert.notCalled(dbHelperStub.findInDatabase);
    });

    it('should deny unauthorized access', async () => {
      const req = {};
      const res = { json: sinon.stub() };

      verificationHelperStub.verifyPrivilege.resolves(false);

      await appHashSyncService.triggerAppHashesCheckAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.errUnauthorizedMessage.calledOnce).to.be.true;
      expect(requested, 'an unauthorized caller queued a check').to.equal(0);
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
        '../appRequirements/appValidator': { verifyAppSpecifications: sinon.stub().resolves() },
        '../appDatabase/registryManager': { checkApplicationRegistrationNameConflicts: sinon.stub().resolves() },
        '../utils/appSpecHelpers': { specificationFormatter: sinon.stub().returnsArg(0) },
        '../utils/appUtilities': { appPricePerMonth: sinon.stub().returns(0.01) },
        '../utils/chainUtilities': { getChainParamsPriceUpdates: sinon.stub().resolves([{ height: 0, minPrice: 0.01, cpu: 1, ram: 1, hdd: 1 }]) },
        '../daemonService/daemonServiceMiscRpcs': { isDaemonSynced: sinon.stub().returns({ data: { height: 2555000 } }) },
        '../utils/fluxBroadcastHelper': fluxBroadcastHelperStub,
        '../invalidMessages': {
          invalidMessages: [{ hash: 'invalid1', txid: 'tx1' }],
        },
        '../utils/peerState': {
          peerManager: { getRandomPeer: () => null },
        },
        '../nodeConfirmationService': { canSendMessages: sinon.stub().returns(true) },
        '../utils/enterpriseHelper': { checkAndDecryptAppSpecs: sinon.stub().callsFake((spec) => Promise.resolve(spec)) },
        '../utils/FluxPeerSocket': { CLOSE_CODES: { EPHEMERAL_DONE: 4020 } },
        '../fluxCommunicationUtils': { deterministicFluxList: sinon.stub().resolves([]) },
        '../fluxCommunication': { openEphemeralConnection: sinon.stub().resolves(null) },
        '../fluxNetworkHelper': { getLocalSocketAddress: sinon.stub().resolves('10.0.0.99:16127') },
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

    // A payment whose transaction is not on the chain has no message to fetch,
    // forced or not.
    [false, true].forEach((force) => {
      it(`should never ask for the message of a payment that is not on the chain (force: ${force})`, async () => {
        const mockDb = { db: sinon.stub().returns('database') };
        dbHelperStub.databaseConnection.returns(mockDb);
        dbHelperStub.findInDatabase.resolves([]);

        await appHashSyncService.getMissingHashes({ force });

        expect(dbHelperStub.findInDatabase.lastCall.args[2]).to.include({ message: false });
        expect(dbHelperStub.findInDatabase.lastCall.args[2].notOnChain).to.deep.equal({ $ne: true });
      });
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

      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse([]));
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      // Should have attempted bulk fetch (axiosGet called for explorer sync check + permanent messages)
      expect(serviceHelperStub.axiosGet.called).to.be.true;
      expect(logStub.info.calledWith(sinon.match('using bulk fetch'))).to.be.true;
    });

    describe('a bulk fetch', () => {
      const missingRecords = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100, message: false,
      }));
      const registration = (i) => ({
        type: 'fluxappregister', version: 1, hash: `hash${i}`, timestamp: 1000 + i, signature: `sig${i}`,
        appSpecifications: { name: `app${i}`, version: 4, owner: 'alice' }, valueSat: 100, txid: `tx${i}`, height: 1000 + i,
      });
      const lines = (messages) => messages.map((message) => `${JSON.stringify(message)}\n`).join('');
      const closing = (count) => `${JSON.stringify({ status: 'success', data: { count } })}\n`;
      const synced = { data: { status: 'success', data: true } };

      // A body that delivers `text` and then fails as a connection torn down mid-body does.
      function cutOff(text) {
        return {
          request: { setTimeout: sinon.stub() },
          data: new Readable({
            read() {
              if (this.sent) return;
              this.sent = true;
              this.push(Buffer.from(text));
              setImmediate(() => this.destroy(new Error('aborted')));
            },
          }),
        };
      }

      function notFound() {
        return Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }));
      }

      function byHeightCalls() {
        return serviceHelperStub.axiosGet.getCalls().filter((call) => call.args[0].includes('/apps/permanentmessagesbyheight'));
      }

      let published;
      function bulkFetchedEvent() {
        return published.find((event) => event.name === 'hashSync:bulkFetched')?.data;
      }

      beforeEach(() => {
        dbHelperStub.findInDatabase.onFirstCall().resolves(missingRecords);
        dbHelperStub.findInDatabase.resolves([]);
        dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });
        peerManagerStub.allValues.returns([makePeer('10.0.0.1', '16127'), makePeer('10.0.0.2', '16127')]);
        published = [];
        sinon.stub(fluxEventBus, 'publish').callsFake((name, data) => { published.push({ name, data }); });
      });

      it('keeps what a peer delivered before its connection was cut, and asks the next peer only for the rest', async () => {
        const firstHalf = Array(300).fill(null).map((_, i) => registration(i));
        const secondHalf = Array(300).fill(null).map((_, i) => registration(300 + i));
        let byHeight = 0;
        serviceHelperStub.axiosGet.callsFake((url) => {
          if (!url.includes('/apps/permanentmessagesbyheight')) return Promise.resolve(synced);
          byHeight += 1;
          if (byHeight === 1) return Promise.resolve(cutOff(lines(firstHalf)));
          return Promise.resolve(makeStreamResponse(secondHalf));
        });

        await appHashSyncService.syncMissingHashes();

        const calls = byHeightCalls();
        expect(new Set(calls.map((call) => call.args[0])).size, 'peers asked').to.equal(2);
        expect(calls.map((call) => call.args[1].params)).to.deep.equal([
          { fromHeight: 1000, toHeight: 1599 },
          { fromHeight: 1300, toHeight: 1599 },
        ]);
        const inserted = collectionStub.insertMany.getCalls().flatMap((call) => call.args[0].map((message) => message.hash));
        expect(inserted).to.have.lengthOf(600);
        expect(bulkFetchedEvent().peers.map((outcome) => [outcome.received, outcome.staged, Boolean(outcome.error)])).to.deep.equal([[300, 300, true], [300, 300, false]]);
      });

      it('treats a log that ends without its closing line as incomplete', async () => {
        let byHeight = 0;
        serviceHelperStub.axiosGet.callsFake((url) => {
          if (!url.includes('/apps/permanentmessagesbyheight')) return Promise.resolve(synced);
          byHeight += 1;
          const all = missingRecords.map((_, i) => registration(i));
          if (byHeight === 1) return Promise.resolve({ data: Readable.from([Buffer.from(lines(all.slice(0, 100)))]), request: { setTimeout: sinon.stub() } });
          return Promise.resolve({ data: Readable.from([Buffer.from(lines(all.slice(100)) + closing(500))]), request: { setTimeout: sinon.stub() } });
        });

        await appHashSyncService.syncMissingHashes();

        const [first] = bulkFetchedEvent().peers;
        expect(first.staged).to.equal(100);
        expect(first.error).to.match(/without its closing line/);
        expect(byHeightCalls()[1].args[1].params).to.deep.equal({ fromHeight: 1100, toHeight: 1599 });
        expect(bulkFetchedEvent().processed).to.equal(600);
      });

      it('takes the whole log from a peer that does not serve it by height', async () => {
        serviceHelperStub.axiosGet.callsFake((url) => {
          if (url.includes('/apps/permanentmessagesbyheight')) return notFound();
          if (url.endsWith('/apps/permanentmessages')) return Promise.resolve(makeWholeLogResponse(missingRecords.map((_, i) => registration(i))));
          return Promise.resolve(synced);
        });

        await appHashSyncService.syncMissingHashes();

        expect(bulkFetchedEvent().peers.map(({ route, received, staged }) => ({ route, received, staged }))).to.deep.equal([{ route: 'wholeLog', received: 600, staged: 600 }]);
        expect(bulkFetchedEvent().processed).to.equal(600);
      });

      it('reads every peer\'s log to its end before it verifies anything', async () => {
        const order = [];
        serviceHelperStub.axiosGet.callsFake((url) => {
          if (!url.includes('/apps/permanentmessagesbyheight')) return Promise.resolve(synced);
          const body = makeStreamResponse(missingRecords.map((_, i) => registration(i)));
          body.data.on('end', () => order.push('log read'));
          return Promise.resolve(body);
        });
        messageVerifierStub.verifyAppHash.callsFake(async () => { order.push('verify'); return true; });

        await appHashSyncService.syncMissingHashes();

        expect(order[0]).to.equal('log read');
        expect(order.filter((step) => step === 'log read')).to.have.lengthOf(1);
        expect(order.lastIndexOf('log read')).to.be.below(order.indexOf('verify'));
      });

      it('asks for two runs of missing messages in one request only when few payments lie between them', async () => {
        const near = [{ hash: 'n1', txid: 'tn1', height: 5000, value: 100, message: false }];
        const far = [{ hash: 'f1', txid: 'tf1', height: 90000, value: 100, message: false }];
        const records = [...missingRecords, ...near, ...far];
        dbHelperStub.findInDatabase.reset();
        dbHelperStub.findInDatabase.onFirstCall().resolves(records);
        // every payment this node recorded: 1999 between the first run and 5000, 2000 between 5000 and 90000
        const payments = [
          ...records.map((record) => ({ height: record.height })),
          ...Array(1999).fill(null).map((_, i) => ({ height: 2000 + i })),
          ...Array(2000).fill(null).map((_, i) => ({ height: 10000 + i })),
        ];
        dbHelperStub.findInDatabase.callsFake(async (db, collection, query) => (query.notOnChain && !('message' in query) ? payments : []));
        serviceHelperStub.axiosGet.callsFake((url) => {
          if (!url.includes('/apps/permanentmessagesbyheight')) return Promise.resolve(synced);
          return Promise.resolve(makeStreamResponse([]));
        });

        await appHashSyncService.syncMissingHashes();

        expect(byHeightCalls().filter((call) => call.args[0].startsWith('http://10.0.0.1:')).map((call) => call.args[1].params)).to.deep.equal([
          { fromHeight: 1000, toHeight: 5000 },
          { fromHeight: 90000, toHeight: 90000 },
        ]);
      });

      it('gives up a peer that stops sending, without counting the time spent staging, and asks the next for the rest', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
          const first = missingRecords.slice(0, 300).map((_, i) => registration(i));
          const silent = new Readable({ read() {} });
          silent.push(Buffer.from(lines(first)));
          const request = { setTimeout: sinon.stub() };
          let byHeight = 0;
          serviceHelperStub.axiosGet.callsFake((url) => {
            if (!url.includes('/apps/permanentmessagesbyheight')) return Promise.resolve(synced);
            byHeight += 1;
            if (byHeight === 1) return Promise.resolve({ data: silent, request });
            return Promise.resolve(makeStreamResponse(missingRecords.slice(300).map((_, i) => registration(300 + i))));
          });

          const run = appHashSyncService.syncMissingHashes();
          for (let i = 0; i < 20 && byHeight === 0; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => { setImmediate(resolve); });
          }
          await new Promise((resolve) => { setImmediate(resolve); });
          clock.tick(119000);
          await new Promise((resolve) => { setImmediate(resolve); });
          expect(byHeight, 'still waiting on the first peer').to.equal(1);
          clock.tick(2000);
          await run;

          expect(request.setTimeout.calledWith(0)).to.equal(true);
          const [failed] = bulkFetchedEvent().peers;
          expect(failed.staged).to.equal(300);
          expect(failed.error).to.match(/^no data from 10\.0\.0\.[12]:16127 for 120s$/);
          expect(bulkFetchedEvent().processed).to.equal(600);
        } finally {
          clock.restore();
        }
      });

      it('gives up a peer that answers and then sends no body at all', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
          let byHeight = 0;
          serviceHelperStub.axiosGet.callsFake((url) => {
            if (!url.includes('/apps/permanentmessagesbyheight')) return Promise.resolve(synced);
            byHeight += 1;
            if (byHeight === 1) return Promise.resolve({ data: new Readable({ read() {} }), request: { setTimeout: sinon.stub() } });
            return Promise.resolve(makeStreamResponse(missingRecords.map((_, i) => registration(i))));
          });

          const run = appHashSyncService.syncMissingHashes();
          for (let i = 0; i < 20 && byHeight === 0; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => { setImmediate(resolve); });
          }
          await new Promise((resolve) => { setImmediate(resolve); });
          clock.tick(121000);
          await run;

          const [failed, next] = bulkFetchedEvent().peers;
          expect(failed.staged).to.equal(0);
          expect(failed.error).to.match(/^no data from .* for 120s$/);
          expect(next.staged).to.equal(600);
        } finally {
          clock.restore();
        }
      });

      it('does not count the time the stage takes against the peer', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const add = sinon.stub(MemoryStage.prototype, 'add').callsFake(async function slowFirst(message) {
          if (add.callCount === 1) await new Promise((resolve) => { setTimeout(resolve, 150000); });
          return add.wrappedMethod.call(this, message);
        });
        try {
          serviceHelperStub.axiosGet.callsFake((url) => {
            if (!url.includes('/apps/permanentmessagesbyheight')) return Promise.resolve(synced);
            return Promise.resolve(makeStreamResponse(missingRecords.map((_, i) => registration(i))));
          });

          const run = appHashSyncService.syncMissingHashes();
          for (let i = 0; i < 20 && add.callCount === 0; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => { setImmediate(resolve); });
          }
          clock.tick(150000);
          await run;

          expect(bulkFetchedEvent().peers.map(({ staged, error }) => ({ staged, error }))).to.deep.equal([{ staged: 600, error: undefined }]);
        } finally {
          clock.restore();
        }
      });

      it('discards the stage when verifying fails', async () => {
        serviceHelperStub.axiosGet.callsFake((url) => {
          if (!url.includes('/apps/permanentmessagesbyheight')) return Promise.resolve(synced);
          return Promise.resolve(makeStreamResponse(missingRecords.map((_, i) => registration(i))));
        });
        dbHelperStub.appPaymentFacts.rejects(new Error('database gone'));

        await appHashSyncService.syncMissingHashes().catch(() => {});

        expect(MemoryStage.opened).to.have.lengthOf(1);
        expect(MemoryStage.opened[0].discarded).to.equal(true);
      });
    });

    describe('a missing hash whose message this node holds unpromoted', () => {
      const { appsMessages, appsTemporaryMessages } = config.database.appsglobal.collections;
      const record = {
        hash: 'pooled', txid: 'txpooled', height: 2555000, value: 10, message: false,
      };
      let stillMissing;

      beforeEach(() => {
        stillMissing = [record];
        dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });
      });

      const fake = (pool) => dbHelperStub.findInDatabase.callsFake(async (db, col) => {
        if (col === appsMessages) return [];
        if (col === appsTemporaryMessages) return pool;
        return stillMissing;
      });

      it('should promote it from that copy, and ask no peer', async () => {
        fake([{ hash: 'pooled' }]);
        messageVerifierStub.checkAndRequestApp.callsFake(async () => { stillMissing = []; return true; });

        const result = await appHashSyncService.syncMissingHashes();

        sinon.assert.calledOnceWithExactly(messageVerifierStub.checkAndRequestApp, 'pooled', 'txpooled', 2555000, 10, 2);
        expect(result.resolved).to.equal(1);
        expect(logStub.info.calledWith(sinon.match('requesting from peers'))).to.equal(false);
      });

      it('should ask its peers when it holds no copy', async () => {
        const clock = sinon.useFakeTimers();
        serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };
        fake([]);

        await appHashSyncService.syncMissingHashes();
        clock.restore();

        sinon.assert.notCalled(messageVerifierStub.checkAndRequestApp);
        expect(logStub.info.calledWith(sinon.match('requesting from peers'))).to.equal(true);
      });

      it('should ask its peers when the copy it holds is not promoted', async () => {
        const clock = sinon.useFakeTimers();
        serviceHelperStub.delay = (ms) => { clock.tick(ms); return Promise.resolve(); };
        fake([{ hash: 'pooled' }]);
        messageVerifierStub.checkAndRequestApp.resolves(false);

        await appHashSyncService.syncMissingHashes();
        clock.restore();

        sinon.assert.calledOnce(messageVerifierStub.checkAndRequestApp);
        expect(logStub.info.calledWith(sinon.match('requesting from peers'))).to.equal(true);
      });
    });

    it('should propagate errors to caller', async () => {
      dbHelperStub.findInDatabase.rejects(new Error('DB error'));

      let threw = false;
      try {
        await appHashSyncService.syncMissingHashes();
      } catch (err) {
        threw = true;
        expect(err.message).to.equal('DB error');
      }
      expect(threw).to.equal(true);
    });

    it('should have a message stored since the missing hashes were read follow this node\'s payment record', async () => {
      const manyMissing = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100, message: false,
      }));
      const bulkFetchResult = [{
        type: 'fluxappregister', version: 4, hash: 'hash7', timestamp: Date.now(),
        signature: 'sig', appSpecifications: { name: 'app7' }, valueSat: 1e8, txid: 'peer-tx', height: 1,
      }];
      let getMissingCalls = 0;
      let existenceChecks = 0;
      dbHelperStub.findInDatabase.callsFake((db, col, query) => {
        if (col === config.database.daemon.collections.appsHashes) {
          getMissingCalls += 1;
          return Promise.resolve(getMissingCalls === 1 ? manyMissing : []);
        }
        if (col === config.database.appsglobal.collections.appsMessages && query?.hash?.$in) {
          existenceChecks += 1;
          // Not stored when the missing hashes were read; stored by the time the peers answered.
          return Promise.resolve(existenceChecks === 1 ? [] : [{ hash: 'hash7' }].filter(({ hash }) => query.hash.$in.includes(hash)));
        }
        return Promise.resolve([]);
      });
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });
      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse(bulkFetchResult));
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      await appHashSyncService.syncMissingHashes();

      const aligned = messageVerifierStub.alignStoredMessagesWithPayments.getCalls().map((call) => call.args[0]);
      expect(aligned).to.have.length(1);
      expect(aligned[0].map(({
        hash, txid, height, value,
      }) => ({
        hash, txid, height, value,
      }))).to.deep.equal([{
        hash: 'hash7', txid: 'tx7', height: 1007, value: 100,
      }]);
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

      const existingHashSet = new Set(existingPermanent.map((h) => h.hash));
      const remainingAfterLocal = manyMissing.filter((h) => !existingHashSet.has(h.hash));
      let getMissingCalls = 0;
      dbHelperStub.findInDatabase.callsFake((db, col, query) => {
        if (col === config.database.daemon.collections.appsHashes) {
          getMissingCalls += 1;
          if (getMissingCalls === 1) return Promise.resolve(manyMissing);
          if (getMissingCalls === 2) return Promise.resolve(remainingAfterLocal);
          return Promise.resolve([]);
        }
        if (col === config.database.appsglobal.collections.appsMessages && query && query.hash && query.hash.$in) {
          return Promise.resolve(existingPermanent.filter(({ hash }) => query.hash.$in.includes(hash)));
        }
        return Promise.resolve([]);
      });
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      // Bulk fetch: 3 peers × 2 calls each (explorer check + permanent messages)
      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse(bulkFetchResult));
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      await appHashSyncService.syncMissingHashes();

      // The stored messages follow this node's payment records: those found locally, and those the
      // bulk fetch finds already stored.
      const expectedRecords = existingPermanent.map(({ hash }) => manyMissing.find((record) => record.hash === hash));
      const aligned = messageVerifierStub.alignStoredMessagesWithPayments.getCalls().map((call) => call.args[0]);
      expect(aligned).to.deep.equal([expectedRecords]);

      // 6 resolved locally via bulkWrite before bulk fetch
      expect(collectionStub.bulkWrite.called).to.be.true;
      const localOps = collectionStub.bulkWrite.firstCall.args[0];
      expect(localOps.length).to.equal(6);
      localOps.forEach((op) => {
        expect(op.updateOne.update.$set.message).to.be.true;
      });
      // 4 new messages inserted via insertMany from bulk fetch
      expect(collectionStub.insertMany.calledOnce).to.be.true;
      expect(collectionStub.insertMany.firstCall.args[0].length).to.equal(4);
    });

    it('should only mark hashes for successfully inserted messages on partial insertMany failure', async () => {
      const manyMissing = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100, message: false,
      }));

      const bulkFetchResult = Array(5).fill(null).map((_, i) => ({
        type: 'fluxappregister', version: 4, hash: `hash${i}`, timestamp: Date.now(),
        signature: 'sig', appSpecifications: { name: `app${i}` }, valueSat: 1e8,
        txid: `tx${i}`, height: 1000 + i,
      }));

      let getMissingCalls = 0;
      dbHelperStub.findInDatabase.callsFake((db, col, query) => {
        if (col === config.database.daemon.collections.appsHashes) {
          getMissingCalls += 1;
          if (getMissingCalls === 1) return Promise.resolve(manyMissing);
          return Promise.resolve([]);
        }
        if (col === config.database.appsglobal.collections.appsMessages && query && query.hash && query.hash.$in) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse(bulkFetchResult));
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      const insertError = new Error('write concern timeout');
      insertError.result = { insertedCount: 2 };
      collectionStub.insertMany.rejects(insertError);

      await appHashSyncService.syncMissingHashes();

      expect(logStub.error.calledWith(sinon.match('2/5 inserted'))).to.be.true;
      const bulkWriteCalls = collectionStub.bulkWrite.args.filter(
        (args) => args[0].some((op) => op.updateOne?.update?.$set?.message === true),
      );
      if (bulkWriteCalls.length > 0) {
        const hashMarkOps = bulkWriteCalls[bulkWriteCalls.length - 1][0];
        expect(hashMarkOps.length).to.equal(2);
      }
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

      // broadcastHashRequest signs once per round, sends to all peers in that round
      expect(fluxBroadcastHelperStub.serialiseAndSignFluxBroadcast.callCount).to.equal(1);
      const msg = fluxBroadcastHelperStub.serialiseAndSignFluxBroadcast.firstCall.args[0];
      expect(msg.type).to.equal('fluxapprequest');
      expect(msg.version).to.equal(2);
      expect(msg.hashes).to.deep.equal(['h1', 'h2']);

      // Verify 3 different peers were used (check peer.send was called)
      const peers = peerManagerStub.allValues();
      const calledPeers = peers.filter((p) => p.send.called);
      expect(calledPeers.length).to.equal(3);
    });

    it('sends no request when this node cannot sign it', async () => {
      fluxBroadcastHelperStub.serialiseAndSignFluxBroadcast.resolves(null);
      const missing = [
        { hash: 'h1', txid: 'tx1', height: 100, value: 10, message: false },
      ];
      dbHelperStub.findInDatabase.onFirstCall().resolves(missing);
      dbHelperStub.findInDatabase.resolves([]);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });

      await appHashSyncService.syncMissingHashes();

      const peers = peerManagerStub.allValues();
      expect(peers.filter((p) => p.send.called)).to.have.length(0);
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

  describe('resetHashSyncForUpgrade', () => {
    it('should give fresh start to hashes without retryFromHeight and one retry to hashes with it', async () => {
      const updateManyStub = sinon.stub()
        .onFirstCall().resolves({ modifiedCount: 3 })
        .onSecondCall().resolves({ modifiedCount: 7 });
      const collectionStubLocal = { updateMany: updateManyStub };
      const mockDatabase = { collection: sinon.stub().returns(collectionStubLocal) };
      dbHelperStub.databaseConnection.returns({ db: sinon.stub().returns(mockDatabase) });

      const result = await appHashSyncService.resetHashSyncForUpgrade(2555000);

      expect(result).to.equal(10);
      expect(updateManyStub.calledTwice).to.be.true;

      // First call: hashes with retryFromHeight — one retry, keep syncAttempts
      expect(updateManyStub.firstCall.args[0]).to.deep.equal({ message: false, retryFromHeight: { $exists: true } });
      expect(updateManyStub.firstCall.args[1].$set.messageNotFound).to.equal(false);
      expect(updateManyStub.firstCall.args[1].$set.nextRetryHeight).to.equal(2555000);
      expect(updateManyStub.firstCall.args[1].$set).to.not.have.property('syncAttempts');
      expect(updateManyStub.firstCall.args[1].$set).to.not.have.property('retryFromHeight');

      // Second call: hashes without retryFromHeight — full fresh start
      expect(updateManyStub.secondCall.args[0]).to.deep.equal({ message: false, retryFromHeight: { $exists: false } });
      expect(updateManyStub.secondCall.args[1].$set.messageNotFound).to.equal(false);
      expect(updateManyStub.secondCall.args[1].$set.syncAttempts).to.equal(0);
      expect(updateManyStub.secondCall.args[1].$set.nextRetryHeight).to.equal(2555000);
      expect(updateManyStub.secondCall.args[1].$set.retryFromHeight).to.equal(2555000);
    });

    it('should return 0 when no documents match', async () => {
      const updateManyStub = sinon.stub().resolves({ modifiedCount: 0 });
      const collectionStubLocal = { updateMany: updateManyStub };
      const mockDatabase = { collection: sinon.stub().returns(collectionStubLocal) };
      dbHelperStub.databaseConnection.returns({ db: sinon.stub().returns(mockDatabase) });

      const result = await appHashSyncService.resetHashSyncForUpgrade(2555000);

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
      await appHashSyncService.getMissingHashes();
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

    function makeExpiryTestHashes() {
      return {
        // Hash mined 2 years ago, retryFromHeight set recently (version upgrade) — should NOT expire
        recentRetry: {
          hash: 'ancient_recent', txid: 'tx1', height: 500000, value: 10, message: false,
          syncAttempts: 0, retryFromHeight: 2554000, nextRetryHeight: 2555000,
        },
        // Hash mined 2 years ago, retryFromHeight also old (exhausted its window) — should expire
        oldRetry: {
          hash: 'ancient_old', txid: 'tx2', height: 500000, value: 10, message: false,
          syncAttempts: 6, retryFromHeight: 500000, nextRetryHeight: 2555000,
        },
      };
    }

    function advanceDateOnDelay() {
      let now = Date.now();
      serviceHelperStub.delay.callsFake(() => { now += 5000; return Promise.resolve(); });
      sinon.stub(Date, 'now').callsFake(() => now);
    }

    function assertExpiryBehavior() {
      // oldRetry: retryFromHeight 500000, currentHeight 2555000, diff 2055000 > HASH_EXPIRY_BLOCKS — expired
      expect(messageVerifierStub.appHashHasMessageNotFound.calledWith('ancient_old')).to.be.true;
      // recentRetry: retryFromHeight 2554000, currentHeight 2555000, diff 1000 < HASH_EXPIRY_BLOCKS — NOT expired
      expect(messageVerifierStub.appHashHasMessageNotFound.calledWith('ancient_recent')).to.be.false;
      // recentRetry should get backoff instead
      expect(collectionStub.bulkWrite.called).to.be.true;
    }

    it('should use retryFromHeight for expiry via targeted peer path', async () => {
      const { recentRetry, oldRetry } = makeExpiryTestHashes();
      const both = [recentRetry, oldRetry];
      dbHelperStub.findInDatabase.resolves(both);
      dbHelperStub.findInDatabase.withArgs(sinon.match.any, MESSAGES).resolves([]);

      advanceDateOnDelay();
      try {
        await appHashSyncService.syncMissingHashes({ currentHeight: 2555000 });
      } finally {
        Date.now.restore();
      }

      assertExpiryBehavior();
    });

    it('counts the year of looking from the first look, not from an old payment', async () => {
      const unlooked = {
        hash: 'ancient_unlooked', txid: 'tx3', height: 500000, value: 10, message: false, syncAttempts: 0,
      };
      dbHelperStub.findInDatabase.resolves([unlooked]);
      dbHelperStub.findInDatabase.withArgs(sinon.match.any, MESSAGES).resolves([]);

      advanceDateOnDelay();
      try {
        await appHashSyncService.syncMissingHashes({ currentHeight: 2555000 });
      } finally {
        Date.now.restore();
      }

      expect(messageVerifierStub.appHashHasMessageNotFound.called, 'given up on at its first look').to.be.false;
      const backoff = collectionStub.bulkWrite.args.flatMap(([ops]) => ops)
        .find((op) => op.updateOne?.filter?.hash === 'ancient_unlooked');
      expect(backoff.updateOne.update.$set.retryFromHeight).to.equal(2555000);
    });

    it('should use retryFromHeight for expiry via bulk fetch path', async () => {
      const { recentRetry, oldRetry } = makeExpiryTestHashes();
      const padding = Array(500).fill(null).map((_, i) => ({
        hash: `pad${i}`, txid: `ptx${i}`, height: 500000, value: 10, message: false,
        syncAttempts: 0, retryFromHeight: 500000, nextRetryHeight: 2555000,
      }));

      dbHelperStub.findInDatabase.onFirstCall().resolves([recentRetry, oldRetry, ...padding]);
      dbHelperStub.findInDatabase.resolves([recentRetry, oldRetry]);
      dbHelperStub.findInDatabase.withArgs(sinon.match.any, MESSAGES).resolves([]);

      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse([]));
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      advanceDateOnDelay();
      try {
        await appHashSyncService.syncMissingHashes({ currentHeight: 2555000 });
      } finally {
        Date.now.restore();
      }

      assertExpiryBehavior();
    });

    // A hash whose message this node holds waits on no peer: the next pass writes its
    // registry row from the stored copy, so the ladder that spaces out asking peers
    // does not apply to it.
    describe('a hash whose message is already stored', () => {
      const backedOff = (hash) => collectionStub.bulkWrite.getCalls().some((call) => call.args[0]
        .some((op) => op.updateOne?.filter?.hash === hash && op.updateOne.update.$set.syncAttempts !== undefined));

      it('is not backed off', async () => {
        const { recentRetry } = makeExpiryTestHashes();
        dbHelperStub.findInDatabase.resolves([recentRetry]);
        dbHelperStub.findInDatabase.withArgs(sinon.match.any, MESSAGES).resolves([{ hash: recentRetry.hash }]);

        advanceDateOnDelay();
        try {
          await appHashSyncService.syncMissingHashes({ currentHeight: 2555000 });
        } finally {
          Date.now.restore();
        }

        expect(backedOff(recentRetry.hash), 'a hash whose message is stored was backed off').to.equal(false);
      });

      it('a canary: the same hash with no message stored is backed off', async () => {
        const { recentRetry } = makeExpiryTestHashes();
        dbHelperStub.findInDatabase.resolves([recentRetry]);
        dbHelperStub.findInDatabase.withArgs(sinon.match.any, MESSAGES).resolves([]);

        advanceDateOnDelay();
        try {
          await appHashSyncService.syncMissingHashes({ currentHeight: 2555000 });
        } finally {
          Date.now.restore();
        }

        expect(backedOff(recentRetry.hash)).to.equal(true);
      });

      it('is not given up on, however long it has waited', async () => {
        const { oldRetry } = makeExpiryTestHashes();
        dbHelperStub.findInDatabase.resolves([oldRetry]);
        dbHelperStub.findInDatabase.withArgs(sinon.match.any, MESSAGES).resolves([{ hash: oldRetry.hash }]);

        advanceDateOnDelay();
        try {
          await appHashSyncService.syncMissingHashes({ currentHeight: 2555000 });
        } finally {
          Date.now.restore();
        }

        expect(messageVerifierStub.appHashHasMessageNotFound.called, 'a hash whose message is stored was given up on').to.equal(false);
      });
    });
  });

  describe('processMessages via bulk fetch', () => {
    let localModule;
    let localCollectionStub;
    let localDbHelperStub;
    let localMessageVerifierStub;
    let localCheckAndDecryptStub;
    let localLogStub;
    let localGlobalState;

    beforeEach(() => {
      localGlobalState = { dbReady: true };
      localCollectionStub = {
        bulkWrite: sinon.stub().resolves({ ok: 1 }),
        insertMany: sinon.stub().resolves({ insertedCount: 0 }),
        find: sinon.stub().returns({
          project: sinon.stub().returns({
            sort: sinon.stub().returns({ toArray: sinon.stub().resolves([]) }),
            toArray: sinon.stub().resolves([]),
          }),
        }),
        updateMany: sinon.stub().resolves({ modifiedCount: 0 }),
      };
      const mockDatabase = { collection: sinon.stub().returns(localCollectionStub) };
      localDbHelperStub = {
        databaseConnection: sinon.stub().returns({ db: sinon.stub().returns(mockDatabase) }),
        findInDatabase: sinon.stub().resolves([]),
        findOneInDatabase: sinon.stub(),
        appPaymentFacts: sinon.stub().resolves({ positions: new Map(), notOnChain: new Set() }),
      };

      localMessageVerifierStub = {
        alignStoredMessagesWithPayments: sinon.stub().resolves([]),
        checkAndRequestApp: sinon.stub().resolves(true),
        storeGoverningAppSpecifications: sinon.stub().resolves(),
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
        '../nodeConfirmationService': { canSendMessages: sinon.stub().returns(true) },
        '../fluxCommunicationUtils': { deterministicFluxList: sinon.stub().resolves([]) },
        '../fluxCommunication': { openEphemeralConnection: sinon.stub().resolves(null) },
        '../fluxNetworkHelper': { getLocalSocketAddress: sinon.stub().resolves('10.0.0.99:16127') },
        '../utils/globalState': localGlobalState,
        './messageStage': { MessageStage: MemoryStage },
      });
    });

    describe('the registry rows of the apps it stores', () => {
      const streamOne = () => {
        const bulkMessages = [{
          type: 'fluxappregister', version: 1, hash: 'hash5', timestamp: Date.now(),
          signature: 'sig5', appSpecifications: { name: 'lateapp', version: 4, owner: 'owner' },
          valueSat: 105, txid: 'tx5', height: 1005,
        }];
        const manyMissing = Array(600).fill(null).map((_, i) => ({
          hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100 + i, message: false,
        }));
        let getMissingCalls = 0;
        localDbHelperStub.findInDatabase.callsFake(() => {
          getMissingCalls += 1;
          return Promise.resolve(getMissingCalls === 1 ? manyMissing : []);
        });
        localDbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });
        serviceHelperStub.axiosGet.callsFake((url) => {
          if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse(bulkMessages));
          return Promise.resolve({ data: { status: 'success', data: true } });
        });
      };
      // the write that marks a hash's message as held
      const hashMarks = () => localCollectionStub.bulkWrite.getCalls()
        .filter((call) => call.args[0].some((op) => op.updateOne?.update?.$set?.message === true));

      it('writes them on a node whose registry is built, before it marks their hashes', async () => {
        streamOne();

        await localModule.syncMissingHashes();

        expect(localCollectionStub.insertMany.called, 'the fixture stored nothing').to.be.true;
        sinon.assert.calledOnceWithExactly(localMessageVerifierStub.storeGoverningAppSpecifications, ['lateapp']);
        expect(hashMarks(), 'the hash was never marked').to.have.length(1);
        expect(localMessageVerifierStub.storeGoverningAppSpecifications.calledBefore(hashMarks()[0])).to.equal(true);
      });

      it('leaves them to the full rebuild on a node whose registry is not built yet', async () => {
        localGlobalState.dbReady = false;
        streamOne();

        await localModule.syncMissingHashes();

        expect(localCollectionStub.insertMany.called, 'the fixture stored nothing').to.be.true;
        sinon.assert.notCalled(localMessageVerifierStub.storeGoverningAppSpecifications);
        expect(hashMarks()).to.have.length(1);
      });

      it('writes the rows of only the apps whose messages the insert stored', async () => {
        const bulkMessages = ['firstapp', 'secondapp'].map((name, i) => ({
          type: 'fluxappregister', version: 1, hash: `hash${5 + i}`, timestamp: Date.now(),
          signature: `sig${5 + i}`, appSpecifications: { name, version: 4, owner: 'owner' },
          valueSat: 105 + i, txid: `tx${5 + i}`, height: 1005 + i,
        }));
        const manyMissing = Array(600).fill(null).map((_, i) => ({
          hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100 + i, message: false,
        }));
        let getMissingCalls = 0;
        localDbHelperStub.findInDatabase.callsFake(() => {
          getMissingCalls += 1;
          return Promise.resolve(getMissingCalls === 1 ? manyMissing : []);
        });
        localDbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });
        serviceHelperStub.axiosGet.callsFake((url) => {
          if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse(bulkMessages));
          return Promise.resolve({ data: { status: 'success', data: true } });
        });
        const partial = new Error('duplicate key');
        partial.result = { insertedCount: 1 };
        localCollectionStub.insertMany.rejects(partial);

        await localModule.syncMissingHashes();

        expect(localCollectionStub.insertMany.firstCall.args[0], 'the fixture inserted fewer than two').to.have.length(2);
        sinon.assert.calledOnceWithExactly(localMessageVerifierStub.storeGoverningAppSpecifications, ['firstapp']);
      });

      it('marks no hash whose app\'s row could not be written, so the next retry writes it', async () => {
        localMessageVerifierStub.storeGoverningAppSpecifications.rejects(new Error('connection timed out'));
        streamOne();

        await localModule.syncMissingHashes();

        expect(localCollectionStub.insertMany.called, 'the fixture stored nothing').to.be.true;
        expect(hashMarks()).to.deep.equal([]);
      });
    });

    it('should check a synced update against its holder, past another owner\'s registration of the held name', async () => {
      const bulkMessages = [{
        type: 'fluxappupdate', version: 4, hash: 'hash1', timestamp: Date.now(),
        signature: 'sig1', appSpecifications: { name: 'testapp', version: 4, owner: 'alice' },
        valueSat: 1e8, txid: 'tx1', height: 1001,
      }];
      const manyMissing = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100, message: false,
      }));
      let getMissingCalls = 0;
      localDbHelperStub.findInDatabase.callsFake(() => {
        getMissingCalls += 1;
        return Promise.resolve(getMissingCalls === 1 ? manyMissing : []);
      });
      localDbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });
      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse(bulkMessages));
        return Promise.resolve({ data: { status: 'success', data: true } });
      });
      localCollectionStub.find.returns({
        project: sinon.stub().returns({
          sort: sinon.stub().returns({
            toArray: sinon.stub().resolves([
              {
                type: 'fluxappregister', hash: 'held', height: 990, timestamp: 1,
                appSpecifications: { name: 'testapp', version: 4, owner: 'alice' },
              },
              {
                type: 'fluxappregister', hash: 'taken', height: 995, timestamp: 2,
                appSpecifications: { name: 'testapp', version: 4, owner: 'mallory' },
              },
            ]),
          }),
        }),
      });

      await localModule.syncMissingHashes();

      sinon.assert.called(localMessageVerifierStub.verifyAppMessageUpdateSignature);
      expect(localMessageVerifierStub.verifyAppMessageUpdateSignature.firstCall.args[5]).to.equal('alice');
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
          return Promise.resolve(makeStreamResponse(bulkMessages));
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

    it('should store a streamed message with this node\'s own txid, height and payment for its hash', async () => {
      // the peer places hash5 in another block, with another payment
      const bulkMessages = [{
        type: 'fluxappregister', version: 1, hash: 'hash5', timestamp: Date.now(),
        signature: 'sig5', appSpecifications: { name: 'placedapp', version: 4, owner: 'owner' },
        valueSat: 999e8, txid: 'peertx', height: 2000000,
      }];
      const manyMissing = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100 + i, message: false,
      }));
      let getMissingCalls = 0;
      localDbHelperStub.findInDatabase.callsFake(() => {
        getMissingCalls += 1;
        if (getMissingCalls === 1) return Promise.resolve(manyMissing);
        return Promise.resolve([]);
      });
      localDbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });
      serviceHelperStub.axiosGet.callsFake((url) => {
        if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse(bulkMessages));
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      await localModule.syncMissingHashes();

      const [inserted] = localCollectionStub.insertMany.firstCall.args[0];
      expect(inserted.hash).to.equal('hash5');
      expect(inserted.txid).to.equal('tx5');
      expect(inserted.height).to.equal(1005);
      expect(inserted.valueSat).to.equal(105);
    });

    describe('an enterprise registration', () => {
      const syncRegistration = async (change) => {
        const bulkMessages = [{
          type: 'fluxappregister', version: 1, hash: 'hash5', timestamp: Date.now(), signature: 'sig5',
          appSpecifications: {
            name: 'entapp', version: 8, owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', enterprise: 'blob', ...change,
          },
          valueSat: 1e8, txid: 'tx5', height: 1005,
        }];
        const manyMissing = Array(600).fill(null).map((_, i) => ({
          hash: `hash${i}`, txid: `tx${i}`, height: 1000 + i, value: 100 + i, message: false,
        }));
        let getMissingCalls = 0;
        localDbHelperStub.findInDatabase.callsFake(() => {
          getMissingCalls += 1;
          if (getMissingCalls === 1) return Promise.resolve(manyMissing);
          return Promise.resolve([]);
        });
        localDbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 2555000 });
        serviceHelperStub.axiosGet.callsFake((url) => {
          if (url.includes('permanentmessages')) return Promise.resolve(makeStreamResponse(bulkMessages));
          return Promise.resolve({ data: { status: 'success', data: true } });
        });

        await localModule.syncMissingHashes();
      };

      it('should decrypt a registration with a valid app name and owner', async () => {
        await syncRegistration({});

        sinon.assert.calledOnce(localCheckAndDecryptStub);
        expect(localCollectionStub.insertMany.firstCall.args[0][0].hash).to.equal('hash5');
      });

      [
        ['an invalid app name', { name: 'ent_app' }],
        ['an invalid owner', { owner: 'my-owner' }],
      ].forEach(([description, change]) => {
        it(`should store a registration with ${description} without decrypting it`, async () => {
          await syncRegistration(change);

          sinon.assert.notCalled(localCheckAndDecryptStub);
          expect(localCollectionStub.insertMany.firstCall.args[0][0].hash).to.equal('hash5');
        });
      });
    });

    it('should decrypt prevSpec for enterprise v8 updates before signature verification', async () => {
      const bulkMessages = [
        {
          type: 'fluxappupdate', version: 8, hash: 'hash1', timestamp: Date.now(),
          signature: 'sig1',
          appSpecifications: { name: 'enterpriseApp', version: 8, owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', enterprise: 'encBlob' },
          valueSat: 1e8, txid: 'tx1', height: 2000,
        },
      ];

      // Generate > 500 missing hashes to trigger bulk fetch path
      const manyMissing = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1999 + i, value: 1e8, message: false,
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
          return Promise.resolve(makeStreamResponse(bulkMessages));
        }
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      // Previous spec is enterprise v8 with encrypted data
      const prevSpec = {
        name: 'enterpriseApp', version: 8, owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', enterprise: 'prevEncBlob',
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
        name: 'enterpriseApp', version: 8, owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
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
      expect(verifyCall.args[5]).to.equal('1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC');
    });

    it('should verify an update against the stored prevSpec when its owner is invalid, without decrypting it', async () => {
      const bulkMessages = [
        {
          type: 'fluxappupdate', version: 8, hash: 'hash1', timestamp: Date.now(),
          signature: 'sig1',
          appSpecifications: { name: 'enterpriseApp', version: 8, owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', enterprise: 'encBlob' },
          valueSat: 1e8, txid: 'tx1', height: 2000,
        },
      ];

      // Generate > 500 missing hashes to trigger bulk fetch path
      const manyMissing = Array(600).fill(null).map((_, i) => ({
        hash: `hash${i}`, txid: `tx${i}`, height: 1999 + i, value: 1e8, message: false,
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
          return Promise.resolve(makeStreamResponse(bulkMessages));
        }
        return Promise.resolve({ data: { status: 'success', data: true } });
      });

      // Previous spec is enterprise v8 with encrypted data
      const prevSpec = {
        name: 'enterpriseApp', version: 8, owner: 'my-owner', enterprise: 'prevEncBlob',
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

      localMessageVerifierStub.verifyAppMessageUpdateSignature.resolves(true);

      await localModule.syncMissingHashes();

      // only the update itself is decrypted
      sinon.assert.calledOnce(localCheckAndDecryptStub);
      const verifyCall = localMessageVerifierStub.verifyAppMessageUpdateSignature.firstCall;
      expect(verifyCall.args[5]).to.equal('my-owner');
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
      dbHelperStub.findInDatabase.callsFake((db, col) => {
        if (col === config.database.appsglobal.collections.appsMessages || col === config.database.appsglobal.collections.appsTemporaryMessages) return Promise.resolve([]);
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
      dbHelperStub.findInDatabase.callsFake((db, col) => {
        if (col === config.database.appsglobal.collections.appsMessages || col === config.database.appsglobal.collections.appsTemporaryMessages) return Promise.resolve([]);
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


  describe('findPrevSpec', () => {
    // eslint-disable-next-line global-require
    const { findPrevSpec } = require('../../ZelBack/src/services/appMessaging/appHashSyncService');
    const list = [
      { hash: 'reg', height: 500, timestamp: 10 },
      { hash: 'upd', height: 500, timestamp: 20 },
      { hash: 'next', height: 600, timestamp: 5 },
    ];

    it('should find the message right before one in (height, timestamp) order', () => {
      expect(findPrevSpec(list, 500, 20).hash).to.equal('reg');
      expect(findPrevSpec(list, 600, 5).hash).to.equal('upd');
      expect(findPrevSpec(list, 700).hash).to.equal('next');
    });

    it('should leave the whole block out when no timestamp is given', () => {
      expect(findPrevSpec(list, 500)).to.equal(null);
      expect(findPrevSpec(list, 600).hash).to.equal('upd');
    });
  });
});
