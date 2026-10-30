const sinon = require('sinon');
const config = require('config');
const explorerService = require('../../ZelBack/src/services/explorerService');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const portManager = require('../../ZelBack/src/services/appNetwork/portManager');
const daemonServiceBlockchainRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBlockchainRpcs');
const daemonServiceAddressRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceAddressRpcs');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const { MongoNetworkTimeoutError } = require('mongodb');
const globalState = require('../../ZelBack/src/services/utils/globalState');
const log = require('../../ZelBack/src/lib/log');
const { requireMongo } = require('./dbTestHelper');
const messageVerifier = require('../../ZelBack/src/services/appMessaging/messageVerifier');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const fluxnodeAddressRecord = require('../../ZelBack/src/services/fluxnodeAddressRecord');

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('explorerService tests', () => {
  beforeEach(() => {
    explorerService.resetBlockCadenceForTests();
  });

  before(requireMongo);

  describe('getVerboseBlock tests', () => {
    let daemonServiceBlockchainRpcsStub;
    const hash = '12345';

    beforeEach(() => {
      daemonServiceBlockchainRpcsStub = sinon.stub(daemonServiceBlockchainRpcs, 'getBlock');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if daemonService returns error', async () => {
      daemonServiceBlockchainRpcsStub.returns({
        status: 'error',
        data: 'there was an error',
      });

      await expect(explorerService.getVerboseBlock(hash)).to.eventually.be.rejectedWith('there was an error');
      sinon.assert.calledOnceWithExactly(daemonServiceBlockchainRpcsStub, { params: { hashheight: '12345', verbosity: 2 } });
    });

    it('should return data if daemonService returns data', async () => {
      daemonServiceBlockchainRpcsStub.returns({
        status: 'success',
        data: 'test data',
      });

      const result = await explorerService.getVerboseBlock(hash);
      expect(result).to.eql('test data');
      sinon.assert.calledOnceWithExactly(daemonServiceBlockchainRpcsStub, { params: { hashheight: '12345', verbosity: 2 } });
    });
  });

  describe('decodeMessage tests', () => {
    it('Should return a proper decoded message', () => {
      const encodedMessage = 'OP_RETURN 74657374';
      const expectedResult = 'test';
      const result = explorerService.decodeMessage(encodedMessage);

      expect(result).to.equal(expectedResult);
    });

    it('Should return a proper decoded message with only 2 words if there are 3', () => {
      const encodedMessage = 'OP_RETURN 74657374 74657374 74657374';
      const expectedResult = 'test\u0007FW7\u0004test';
      const result = explorerService.decodeMessage(encodedMessage);

      expect(result).to.eql(expectedResult);
    });

    it('Should return empty string if message is not in a proper format', () => {
      const encodedMessage = 'test123';
      const expectedResult = '';
      const result = explorerService.decodeMessage(encodedMessage);

      expect(result).to.equal(expectedResult);
    });
  });

  describe('processInsight tests', () => {
    let dbStubFind;
    let dbStubInsert;
    const database = {};

    beforeEach(async () => {
      dbStubFind = sinon.stub(dbHelper, 'findOneInDatabase');
      dbStubInsert = sinon.stub(dbHelper, 'insertManyToDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should do nothing if version is >5', async () => {
      const blockVerbose = {
        tx: [
          {
            version: 6,
            txid: '12345',
            type: 'send',
            update_type: 'someType',
            ip: '192.168.1.1',
            benchmark_tier: 'stratus',
            txhash: 'hash1234',
            outidx: '1111',
          },
        ],
      };
      await explorerService.processInsight(blockVerbose, database);

      sinon.assert.notCalled(dbStubInsert);
    });

    it('should do nothing if version is 0', async () => {
      const blockVerbose = {
        tx: [
          {
            version: 0,
            txid: '12345',
            type: 'send',
            update_type: 'someType',
            ip: '192.168.1.1',
            benchmark_tier: 'stratus',
            txhash: 'hash1234',
            outidx: '1111',
          },
        ],
      };
      await explorerService.processInsight(blockVerbose, database);

      sinon.assert.notCalled(dbStubInsert);
    });

    it('log error and not call db if version is >0 and <5 and data is correct, but tx exists in db', async () => {
      dbStubFind.returns(true);
      const blockVerbose = {
        tx: [
          {
            version: 3,
            txid: '12345',
            type: 'send',
            update_type: 'someType',
            ip: '192.168.1.1',
            benchmark_tier: 'stratus',
            txhash: 'hash1234',
            outidx: '1111',
            vin: [],
            vout: [{
              n: 444,
              scriptPubKey:
              {
                addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6'],
                asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
              },
              valueSat: 20000000,
            }],
          },
        ],
        height: 983000,
      };
      await explorerService.processInsight(blockVerbose, database);

      sinon.assert.notCalled(dbStubInsert);
    });

    it('log error and not call db if version is >0 and <5 and data is correct, but message value < priceSpecifications.minPrice', async () => {
      dbStubFind.returns(false);
      const blockVerbose = {
        tx: [
          {
            version: 3,
            txid: '12345',
            type: 'send',
            update_type: 'someType',
            ip: '192.168.1.1',
            benchmark_tier: 'stratus',
            txhash: 'hash1234',
            outidx: '1111',
            vin: [],
            vout: [{
              n: 444,
              scriptPubKey:
              {
                addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6'],
                asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
              },
              valueSat: 1000,
            }],
          },
        ],
        height: 983000,
      };
      await explorerService.processInsight(blockVerbose, database);

      sinon.assert.notCalled(dbStubInsert);
    });

    it('log error and not call db if version is >0 and <5 and data is correct, but height < epoch start', async () => {
      dbStubFind.returns(false);
      const blockVerbose = {
        tx: [
          {
            version: 3,
            txid: '12345',
            type: 'send',
            update_type: 'someType',
            ip: '192.168.1.1',
            benchmark_tier: 'stratus',
            txhash: 'hash1234',
            outidx: '1111',
            vin: [],
            vout: [{
              n: 444,
              scriptPubKey:
              {
                addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6'],
                asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
              },
              valueSat: 20000000,
            }],
          },
        ],
        height: 1,
      };
      await explorerService.processInsight(blockVerbose, database);

      sinon.assert.notCalled(dbStubInsert);
    });
  });

  describe('scheduleUpnpBench tests', () => {
    const PERIOD = 6480;
    const DUE = PERIOD * 470;
    const DUE_TIME = 1793000000;
    const IP = '203.0.113.7';
    const ROLL = serviceHelper.randomDelayMs(4 * 3_600_000, { initializer: IP + DUE });
    const BENCH_AT = DUE_TIME * 1000 + ROLL;
    let clock;
    let bench;
    // The delay the bench was started with, read off its timer rather than by running fake time
    // forward: the unit suite's mongo client keeps its pool with a 100ms timer, and a fake clock
    // ticked over hours runs that timer for every 100ms of them.
    let startIn;

    beforeEach(() => {
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves(`${IP}:16137`);
      startIn = null;
      bench = sinon.stub(benchmarkService, 'executeUpnpBench');
      const realSetTimeout = global.setTimeout;
      sinon.stub(global, 'setTimeout').callsFake((fn, ms, ...args) => {
        if (fn !== bench) return realSetTimeout(fn, ms, ...args);
        startIn = ms;
        return null;
      });
      sinon.stub(daemonServiceBlockchainRpcs, 'getBlock')
        .withArgs(sinon.match({ params: { hashheight: DUE } }))
        .resolves({ status: 'success', data: { height: DUE, time: DUE_TIME } });
    });

    afterEach(() => {
      clock?.restore();
      sinon.restore();
    });

    function at(nowMs) {
      clock = sinon.useFakeTimers({ now: nowMs, toFake: ['Date'] });
    }

    it('starts a node that processed the due block and one that caught up past it at the same instant', async () => {
      // The roll this ip gets is past the late node's catch-up, so both are still waiting for it.
      expect(ROLL).to.be.above(200000);

      at(DUE_TIME * 1000 + 1400);
      await explorerService.scheduleUpnpBench({ height: DUE, time: DUE_TIME }, PERIOD);
      const onTime = Date.now() + startIn;
      clock.restore();

      at(DUE_TIME * 1000 + 120000);
      await explorerService.scheduleUpnpBench({ height: DUE + 4, time: DUE_TIME + 118 }, PERIOD);

      expect(onTime).to.equal(BENCH_AT);
      expect(Date.now() + startIn).to.equal(BENCH_AT);
    });

    it('skips the bench on a node that caught up after its start had passed', async () => {
      at(BENCH_AT + 60000);
      await explorerService.scheduleUpnpBench({ height: DUE + 300, time: DUE_TIME + 9000 }, PERIOD);

      expect(startIn, 'the bench was started').to.equal(null);
      sinon.assert.notCalled(bench);
    });

    it('starts the bench at once on a node that processed the due block after its start', async () => {
      // A roll shorter than the block took to arrive: the node is on the due block, so it is
      // not running alone, and starts now.
      at(BENCH_AT + 5000);
      await explorerService.scheduleUpnpBench({ height: DUE, time: DUE_TIME }, PERIOD);

      expect(startIn).to.equal(0);
    });
  });

  describe('processBlock tests', () => {
    let dbStubUpdate;
    let logInfoSpy;
    let expireGlobalApplicationsStub;
    let checkAndRemoveApplicationInstanceStub;
    let restorePortsSupportStub;
    let daemonServiceBlockchainRpcsStub;
    let daemonServiceMiscRpcsStub;

    beforeEach(async () => {
      // An unsynced daemon makes processBlock retry itself in two minutes. Left
      // real, that timer outlives this file and re-enters block processing
      // against restored stubs.
      sinon.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
      sinon.stub(dbHelper, 'findOneInDatabase');
      sinon.stub(dbHelper, 'insertManyToDatabase');
      dbStubUpdate = sinon.stub(dbHelper, 'updateOneInDatabase');
      expireGlobalApplicationsStub = sinon.stub(registryManager, 'expireGlobalApplications');
      checkAndRemoveApplicationInstanceStub = sinon.stub(advancedWorkflows, 'checkAndRemoveApplicationInstance');
      restorePortsSupportStub = sinon.stub(portManager, 'restorePortsSupport');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      daemonServiceMiscRpcsStub = sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced');
      daemonServiceBlockchainRpcsStub = sinon.stub(daemonServiceBlockchainRpcs, 'getBlock');
      logInfoSpy = sinon.spy(log, 'info');
      globalState.dbReady = true;
    });

    afterEach(() => {
      globalState.dbReady = false;
      sinon.restore();
    });

    it('should return and retry function if daemon is not synced', async () => {
      const blockHeight = 100000;
      daemonServiceMiscRpcsStub.returns({
        data:
        {
          synced: false,
        },
      });

      const result = await explorerService.processBlock(blockHeight);

      expect(result).to.be.undefined;
    });

    it('should update db if all parameters are passed correctly, block height == 695000', async () => {
      const blockHeight = 695000;
      dbStubUpdate.returns(true);
      expireGlobalApplicationsStub.returns(true);
      // prevent infinite func loop while testing
      explorerService.setBlockProccessingCanContinue(false);
      daemonServiceMiscRpcsStub.returns({
        data:
        {
          synced: true,
        },
      });
      daemonServiceBlockchainRpcsStub.returns({
        status: 'success',
        data: {
          tx: [
            {
              version: 3,
              txid: '12345',
              type: 'send',
              update_type: 'someType',
              ip: '192.168.1.1',
              benchmark_tier: 'stratus',
              txhash: 'hash1234',
              outidx: '1111',
              vin: [],
              vout: [{
                n: 444,
                scriptPubKey:
                {
                  addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6'],
                  asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
                },
                valueSat: 20000000,
              }],
            },
          ],
          height: 695000,
          confirmations: 1,
        },
      });

      await explorerService.processBlock(blockHeight);

      sinon.assert.calledOnce(expireGlobalApplicationsStub);
      sinon.assert.notCalled(checkAndRemoveApplicationInstanceStub);
      sinon.assert.notCalled(restorePortsSupportStub);
      sinon.assert.calledOnceWithMatch(
        dbStubUpdate,
        sinon.match.object,
        'scannedheight',
        { generalScannedHeight: { $gte: 0 } },
        { $set: { generalScannedHeight: 695000 } },
        { upsert: true },
      );
      sinon.assert.calledWith(logInfoSpy, 'Processing Explorer Block Height: 695000');
    });

    // A payment record carries its transaction's position in the block, on both
    // scan paths: here the app payment is the block's second transaction.
    it('records an app payment\'s position in its block', async () => {
      explorerService.setBlockProccessingCanContinue(false);
      daemonServiceMiscRpcsStub.returns({ data: { synced: true } });
      daemonServiceBlockchainRpcsStub.returns({
        status: 'success',
        data: {
          tx: [
            {
              version: 3,
              txid: 'unrelated',
              vin: [],
              vout: [{ n: 0, scriptPubKey: { addresses: ['t1SomeoneElse'], asm: '' }, valueSat: 100000000 }],
            },
            {
              version: 3,
              txid: 'payment',
              vin: [],
              vout: [{
                n: 0,
                scriptPubKey: {
                  addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6'],
                  asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
                },
                valueSat: 200000000,
              }],
            },
          ],
          height: 695000,
          confirmations: 2,
        },
      });

      await explorerService.processBlock(695000);

      const hashInserts = dbHelper.insertManyToDatabase.getCalls().filter((call) => call.args[1] === 'zelappshashes');
      expect(hashInserts).to.have.length(1);
      expect(hashInserts[0].args[2].map((record) => [record.txid, record.txIndex])).to.deep.equal([['payment', 1]]);
    });

    it('should update db, and run only the work whose period this block passes, height == 900009', async () => {
      const blockHeight = 900009;
      dbStubUpdate.returns(true);
      checkAndRemoveApplicationInstanceStub.returns(true);
      // prevent infinite func loop while testing
      explorerService.setBlockProccessingCanContinue(false);
      daemonServiceMiscRpcsStub.returns({
        data:
        {
          synced: true,
        },
      });
      daemonServiceBlockchainRpcsStub.returns({
        status: 'success',
        data: {
          tx: [
            {
              version: 3,
              txid: '12345',
              type: 'send',
              update_type: 'someType',
              ip: '192.168.1.1',
              benchmark_tier: 'stratus',
              txhash: 'hash1234',
              outidx: '1111',
              vin: [],
              vout: [{
                n: 444,
                scriptPubKey:
                {
                  addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6'],
                  asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
                },
                valueSat: 20000000,
              }],
            },
          ],
          height: 900009,
          confirmations: 1,
          time: 1700000000,
        },
      });
      await explorerService.processBlock(blockHeight);

      sinon.assert.notCalled(expireGlobalApplicationsStub);
      // Every height answers with this block here, so the pass before reads the same time.
      sinon.assert.calledOnceWithExactly(checkAndRemoveApplicationInstanceStub, {
        height: blockHeight, period: config.fluxapps.removeFluxAppsPeriod, time: 1700000000, previousTime: 1700000000,
      });
      sinon.assert.notCalled(restorePortsSupportStub);
      sinon.assert.calledOnceWithMatch(
        dbStubUpdate,
        sinon.match.object,
        'scannedheight',
        { generalScannedHeight: { $gte: 0 } },
        { $set: { generalScannedHeight: 900009 } },
        { upsert: true },
      );
    });

    it('should update db, and run only the work whose period this block passes, height == 900025', async () => {
      const blockHeight = 900025;
      dbStubUpdate.returns(true);
      checkAndRemoveApplicationInstanceStub.returns(true);
      // prevent infinite func loop while testing
      explorerService.setBlockProccessingCanContinue(false);
      daemonServiceMiscRpcsStub.returns({
        data:
        {
          synced: true,
        },
      });
      daemonServiceBlockchainRpcsStub.returns({
        status: 'success',
        data: {
          tx: [
            {
              version: 3,
              txid: '12345',
              type: 'send',
              update_type: 'someType',
              ip: '192.168.1.1',
              benchmark_tier: 'stratus',
              txhash: 'hash1234',
              outidx: '1111',
              vin: [],
              vout: [{
                n: 444,
                scriptPubKey:
                {
                  addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6'],
                  asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
                },
                valueSat: 20000000,
              }],
            },
          ],
          height: 900025,
          confirmations: 1,
        },
      });
      await explorerService.processBlock(blockHeight);

      sinon.assert.notCalled(expireGlobalApplicationsStub);
      sinon.assert.notCalled(checkAndRemoveApplicationInstanceStub);
      sinon.assert.calledOnceWithMatch(
        dbStubUpdate,
        sinon.match.object,
        'scannedheight',
        { generalScannedHeight: { $gte: 0 } },
        { $set: { generalScannedHeight: 900025 } },
        { upsert: true },
      );
    });
    it('runs the work whose period a burst of blocks passed once, on the block that reaches the tip', async () => {
      dbStubUpdate.returns(true);
      checkAndRemoveApplicationInstanceStub.returns(true);
      explorerService.setBlockProccessingCanContinue(false);
      daemonServiceMiscRpcsStub.returns({ data: { synced: true } });
      async function processAt(height, confirmations) {
        daemonServiceBlockchainRpcsStub.returns({ status: 'success', data: { tx: [], height, confirmations } });
        await explorerService.processBlock(height);
      }

      // A multiple of the give-up pass's period, passed during a burst and landed on by no tip block.
      const period = config.fluxapps.removeFluxAppsPeriod;
      const multiple = Math.ceil(900000 / period) * period;
      await processAt(multiple - 3, 1);
      checkAndRemoveApplicationInstanceStub.resetHistory();
      for (let height = multiple - 2; height <= multiple + 2; height += 1) {
        // eslint-disable-next-line no-await-in-loop
        await processAt(height, 2);
      }
      sinon.assert.notCalled(checkAndRemoveApplicationInstanceStub);

      await processAt(multiple + 3, 1);
      sinon.assert.calledOnce(checkAndRemoveApplicationInstanceStub);
      await processAt(multiple + 4, 1);
      sinon.assert.calledOnce(checkAndRemoveApplicationInstanceStub);
    });

    it('judges a give-up pass run late at the times of the blocks it and the pass before fell due on', async () => {
      explorerService.setBlockProccessingCanContinue(false);
      daemonServiceMiscRpcsStub.returns({ data: { synced: true } });
      const period = config.fluxapps.removeFluxAppsPeriod;
      const multiple = Math.ceil(900100 / period) * period;
      const tip = multiple + 3;
      const timeOf = (height) => 1700000000 + (height * 30);
      daemonServiceBlockchainRpcsStub.callsFake(async (req) => {
        const height = Number(req.params.hashheight);
        return {
          status: 'success', data: { tx: [], height, confirmations: height === tip ? 1 : 2, time: timeOf(height) },
        };
      });
      await explorerService.processBlock(multiple - 3);
      checkAndRemoveApplicationInstanceStub.resetHistory();

      await explorerService.processBlock(tip);

      sinon.assert.calledOnceWithExactly(checkAndRemoveApplicationInstanceStub, {
        height: tip, period, time: timeOf(multiple), previousTime: timeOf(multiple - period),
      });
    });
  });

  describe('the fluxnode address record', () => {
    beforeEach(async () => {
      sinon.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
      await dbHelper.initiateDB();
      globalState.dbReady = true;
    });

    afterEach(() => {
      globalState.dbReady = false;
      explorerService.setBlockProccessingCanContinue(true);
      sinon.restore();
    });

    // The node list refreshes on blocksProcessed, so the list never shows a move
    // its block has not been recorded for.
    it('records each block before announcing it processed', async () => {
      const order = [];
      const block = {
        tx: [{ version: 5, txhash: 'ff'.repeat(32), outidx: '0', ip: '203.0.113.1:16127' }],
        height: 3_000_000,
        confirmations: 1,
      };
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true } });
      sinon.stub(daemonServiceBlockchainRpcs, 'getBlock').returns({ status: 'success', data: block });
      sinon.stub(dbHelper, 'updateOneInDatabase').resolves(true);
      sinon.stub(registryManager, 'expireGlobalApplications').resolves();
      sinon.stub(advancedWorkflows, 'checkAndRemoveApplicationInstance');
      const recorded = sinon.stub(fluxnodeAddressRecord, 'recordBlock').callsFake(async () => { order.push('recorded'); });
      const announced = () => order.push('announced');
      explorerService.getBlockEmitter().once('blocksProcessed', announced);
      explorerService.setBlockProccessingCanContinue(false);

      try {
        await explorerService.processBlock(block.height);
      } finally {
        explorerService.getBlockEmitter().off('blocksProcessed', announced);
      }

      sinon.assert.calledOnceWithExactly(recorded, sinon.match({ height: block.height }));
      expect(order).to.deep.equal(['recorded', 'announced']);
    });

    it('is returned to the height a reorg restores, on the maintenance client', async () => {
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves(true);
      sinon.stub(dbHelper, 'updateInDatabase').resolves(true);
      const restored = sinon.stub(fluxnodeAddressRecord, 'restoreToHeight').resolves();

      await explorerService.restoreDatabaseToBlockheightState(100000);

      sinon.assert.calledOnceWithExactly(restored, 100000, sinon.match.object);
      expect(restored.firstCall.args[1].client).to.equal(dbHelper.maintenanceConnection());
    });

    it('is dropped for a scan from the start of the chain', async () => {
      sinon.stub(dbHelper, 'dropCollection').resolves(true);
      sinon.stub(dbHelper, 'ensureIndexes').resolves();
      const dropped = sinon.stub(fluxnodeAddressRecord, 'drop').resolves();

      await explorerService.resetExplorerCollections();

      sinon.assert.calledOnce(dropped);
      expect(dropped.firstCall.args[0].client).to.equal(dbHelper.maintenanceConnection());
    });
  });

  describe('restoreDatabaseToBlockheightState tests', () => {
    let removeDocumentsFromCollectionStub;
    let updateInDatabaseStub;
    let logInfoSpy;

    beforeEach(async () => {
      removeDocumentsFromCollectionStub = sinon.stub(dbHelper, 'removeDocumentsFromCollection');
      updateInDatabaseStub = sinon.stub(dbHelper, 'updateInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logInfoSpy = sinon.spy(log, 'info');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw if height was not passed', async () => {
      await expect(explorerService.restoreDatabaseToBlockheightState(undefined)).to.eventually.be.rejectedWith('No blockheight for restoring provided');
    });

    it('should remove and update db properly, no rescan parameter passed', async () => {
      removeDocumentsFromCollectionStub.returns(true);
      updateInDatabaseStub.returns(true);
      const height = 100000;

      const result = await explorerService.restoreDatabaseToBlockheightState(height);

      expect(result).to.equal(true);
      sinon.assert.calledWith(logInfoSpy, 'Rescanning Blockchain Parameters!');
      sinon.assert.calledWith(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'zelappshashes', { height: { $gt: height } });
    });

    it('runs its deletes and updates on the maintenance client', async () => {
      removeDocumentsFromCollectionStub.returns(true);
      updateInDatabaseStub.returns(true);

      await explorerService.restoreDatabaseToBlockheightState(100000);

      const clients = [...removeDocumentsFromCollectionStub.getCalls(), ...updateInDatabaseStub.getCalls()].map((call) => call.args[0].client);
      expect(clients).to.have.length.above(0);
      clients.forEach((client) => expect(client).to.equal(dbHelper.maintenanceConnection()));
    });

    it('should leave the app messages and the registry alone', async () => {
      removeDocumentsFromCollectionStub.returns(true);
      updateInDatabaseStub.returns(true);
      const height = 100000;

      await explorerService.restoreDatabaseToBlockheightState(height);

      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'chainmessages', { height: { $gt: height } });
      const collections = removeDocumentsFromCollectionStub.getCalls().map((call) => call.args[1]);
      expect(collections).to.not.include('zelappsmessages');
      expect(collections).to.not.include('zelappsinformation');
    });
  });

  describe('endpoints whose data the address index does not hold', () => {
    afterEach(() => {
      sinon.restore();
    });

    ['getAllUtxos', 'getAllFusionCoinbase', 'getAllAddressesWithTransactions', 'getAllAddresses', 'getAddressFusionCoinbase'].forEach((endpoint) => {
      it(`${endpoint} answers that the data is unavailable`, async () => {
        const res = { json: sinon.stub() };

        await explorerService[endpoint]({ params: { address: 't1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6' }, query: {} }, res);

        sinon.assert.calledOnceWithExactly(res.json, {
          status: 'error',
          data: {
            code: undefined,
            name: 'Error',
            message: 'Data unavailable. Deprecated',
          },
        });
      });
    });
  });

  describe('getAddressTransactions tests', () => {
    let distinctDatabaseStub;
    let logErrorSpy;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      distinctDatabaseStub = sinon.stub(dbHelper, 'distinctDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if no params are passed', async () => {
      const res = generateResponse();

      await explorerService.getAddressTransactions(undefined, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'TypeError',
          message: "Cannot read properties of undefined (reading 'params')",
        },
      });
    });

    it('should throw error if no address param is passed', async () => {
      const res = generateResponse();
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };

      await explorerService.getAddressTransactions(req, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No address provided',
        },
      });
    });

    it('should return txids from the daemon, address provided in params', async () => {
      sinon.stub(daemonServiceAddressRpcs, 'getSingleAddresssTxids').returns({
        data: {
          reverse: sinon.fake(() => ['txid1', 'txid2', 'txid3']),
        },
      });
      const res = generateResponse();
      const req = {
        params: {
          address: '1Z123456ACED',
        },
        query: {
          test2: 'test2',
        },
      };
      await explorerService.getAddressTransactions(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: [{ txid: 'txid1' }, { txid: 'txid2' }, { txid: 'txid3' }] });
      sinon.assert.notCalled(distinctDatabaseStub);
    });
  });

  describe('getScannedHeight tests', () => {
    let findOneInDatabaseStub;
    let logErrorSpy;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findOneInDatabaseStub = sinon.stub(dbHelper, 'findOneInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should pass error if nothing was found in db', async () => {
      findOneInDatabaseStub.returns(null);
      const res = generateResponse();

      await explorerService.getScannedHeight(undefined, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Scanning not initiated',
        },
      });
    });

    it('should return result, response passed', async () => {
      findOneInDatabaseStub.returns(10000000);
      const res = generateResponse();

      await explorerService.getScannedHeight(undefined, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: 10000000 });
      sinon.assert.calledOnceWithMatch(findOneInDatabaseStub, sinon.match.object, 'scannedheight', { generalScannedHeight: { $gte: 0 } }, { projection: { _id: 0, generalScannedHeight: 1 } });
    });

    it('should return result, no response passed', async () => {
      findOneInDatabaseStub.returns(10000000);

      const result = await explorerService.getScannedHeight(undefined, undefined);

      sinon.assert.notCalled(logErrorSpy);
      expect(result).to.eql({ status: 'success', data: 10000000 });
      sinon.assert.calledOnceWithMatch(findOneInDatabaseStub, sinon.match.object, 'scannedheight', { generalScannedHeight: { $gte: 0 } }, { projection: { _id: 0, generalScannedHeight: 1 } });
    });
  });

  describe('getAddressBalance tests', () => {
    let findInDatabaseStub;
    let logErrorSpy;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if no address is provided', async () => {
      const res = generateResponse();
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };

      await explorerService.getAddressBalance(req, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No address provided',
        },
      });
    });

    it('should return the balance from the daemon, address provided in params', async () => {
      sinon.stub(daemonServiceAddressRpcs, 'getSingleAddressBalance').returns({
        data: { balance: 100000 },
      });
      const res = generateResponse();
      findInDatabaseStub.returns([{ satoshis: 1000 }, { satoshis: 2000 }]);
      const req = {
        params: {
          address: '1Z123456ACED',
        },
        query: {
          test2: 'test2',
        },
      };
      await explorerService.getAddressBalance(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: 100000 });
      sinon.assert.notCalled(findInDatabaseStub);
    });
  });

  describe('initiateBlockProcessor tests', () => {
    let findInDatabaseStub;
    let isBuiltStub;
    let rebuildStub;
    let getBlockCountStub;
    let dropCollectionStub;
    let logErrorSpy;
    let logInfoSpy;

    // The explorer's collections are prepared on the maintenance client, which
    // initiateDB connects to the real mongo; a test that fakes the database keeps
    // that work on the fake too.
    const fakeDatabase = (dbFake) => {
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: dbFake });
      sinon.stub(dbHelper, 'onMaintenanceClient').callsFake((database) => database);
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findOneInDatabase');
      dropCollectionStub = sinon.stub(dbHelper, 'dropCollection');
      isBuiltStub = sinon.stub(fluxnodeAddressRecord, 'isBuilt').resolves(true);
      rebuildStub = sinon.stub(fluxnodeAddressRecord, 'rebuild').resolves();
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true } });
      getBlockCountStub = sinon.stub(daemonServiceBlockchainRpcs, 'getBlockCount');
      sinon.stub(daemonServiceUtils, 'getConfigValue').returns('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'); // Valid WIF private key
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
      logInfoSpy = sinon.spy(log, 'info');
      sinon.stub(dbHelper, 'insertManyToDatabase').returns(true);
      sinon.stub(dbHelper, 'updateOneInDatabase').returns(true);
      sinon.stub(registryManager, 'expireGlobalApplications').returns(true);
      sinon.stub(advancedWorkflows, 'checkAndRemoveApplicationInstance').returns(true);
      sinon.stub(daemonServiceBlockchainRpcs, 'getBlock').returns({
        status: 'success',
        data: {
          tx: [
            {
              version: 3,
              txid: '12345',
              type: 'send',
              update_type: 'someType',
              ip: '192.168.1.1',
              benchmark_tier: 'stratus',
              txhash: 'hash1234',
              outidx: '1111',
              vin: [],
              vout: [{
                n: 444,
                scriptPubKey:
                {
                  addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6'],
                  asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
                },
                valueSat: 20000000,
              }],
            },
          ],
          height: 695000,
          confirmations: 1,
        },
      });
    });

    afterEach(() => {
      explorerService.setIsInInitiationOfBP(false);
      explorerService.setZelAppSpecsMigrationDone(false);
      sinon.restore();
    });

    it('should return right away if isInInitiationOfBP is true', async () => {
      explorerService.setIsInInitiationOfBP(true);

      const result = await explorerService.initiateBlockProcessor(true, true);

      expect(result).to.be.undefined;
      sinon.assert.notCalled(findInDatabaseStub);
    });

    it('should throw and log error if getBlockCount does not return success', async () => {
      explorerService.setZelAppSpecsMigrationDone(true);
      sinon.stub(dbHelper, 'countInDatabase').resolves(1);
      explorerService.setBlockProccessingCanContinue(false);
      getBlockCountStub.returns({
        status: 'error',
        data: {
          message: 'message',
        },
      });

      await explorerService.initiateBlockProcessor(false, false);
      await serviceHelper.delay(200);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledWithMatch(findInDatabaseStub, sinon.match.object, 'scannedheight', { generalScannedHeight: { $gte: 0 } }, { projection: { _id: 0, generalScannedHeight: 1 } });
    });

    it('should run the block processor, all params false', async () => {
      findInDatabaseStub.returns({ generalScannedHeight: 0 });
      dropCollectionStub.resolves(true);
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);
      sinon.stub(dbHelper, 'countInDatabase').resolves(1);
      const createIndexFake = sinon.fake.resolves(true);
      const collectionFake = sinon.fake.returns({
        createIndex: createIndexFake, updateMany: sinon.fake.resolves({ modifiedCount: 0 }), indexes: sinon.fake.resolves([]), deleteMany: sinon.fake.resolves({ deletedCount: 0 }),
        find: sinon.fake.returns({ toArray: sinon.fake.resolves([]) }),
      });
      const dbFake = sinon.fake.returns({ collection: collectionFake });
      fakeDatabase(dbFake);
      getBlockCountStub.returns({
        status: 'success',
        data: 2000000,
      });
      sinon.stub(daemonServiceUtils, 'executeCall').resolves({ status: 'success', data: [] });
      sinon.stub(daemonServiceUtils, 'executeBatchCall').resolves({ status: 'success', data: [] });
      explorerService.setBlockProccessingCanContinue(false);

      await explorerService.initiateBlockProcessor(false, false, false);
      await serviceHelper.delay(200);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledWithMatch(logInfoSpy, 'Bootstrap: Using address-index fast path');
      sinon.assert.calledWithMatch(logInfoSpy, 'Bootstrap complete');
      sinon.assert.calledWithMatch(logInfoSpy, 'Preparation done');
      sinon.assert.called(createIndexFake);
      sinon.assert.calledWithMatch(dbHelper.updateOneInDatabase, sinon.match.object, 'scannedheight', sinon.match.object, { $set: { generalScannedHeight: 2000000 - fluxnodeAddressRecord.RECORD_BLOCKS } });
      sinon.assert.calledWithMatch(daemonServiceBlockchainRpcs.getBlock, { params: { hashheight: 2000000 - fluxnodeAddressRecord.RECORD_BLOCKS + 1 } });
      sinon.assert.notCalled(rebuildStub);
    });

    it('scans from epochstart a chain too short to bootstrap below the record\'s blocks', async () => {
      findInDatabaseStub.returns({ generalScannedHeight: 0 });
      dropCollectionStub.resolves(true);
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);
      sinon.stub(dbHelper, 'countInDatabase').resolves(1);
      const collectionFake = sinon.fake.returns({
        createIndex: sinon.fake.resolves(true), updateMany: sinon.fake.resolves({ modifiedCount: 0 }), indexes: sinon.fake.resolves([]), deleteMany: sinon.fake.resolves({ deletedCount: 0 }),
        find: sinon.fake.returns({ toArray: sinon.fake.resolves([]) }),
      });
      fakeDatabase(sinon.fake.returns({ collection: collectionFake }));
      getBlockCountStub.returns({ status: 'success', data: config.fluxapps.epochstart + fluxnodeAddressRecord.RECORD_BLOCKS - 1 });
      const executeCallStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves({ status: 'success', data: [] });
      explorerService.setBlockProccessingCanContinue(false);

      await explorerService.initiateBlockProcessor(false, false, false);
      await serviceHelper.delay(200);

      sinon.assert.notCalled(executeCallStub);
      sinon.assert.calledWithMatch(daemonServiceBlockchainRpcs.getBlock, { params: { hashheight: config.fluxapps.epochstart } });
    });

    describe('the fluxnode address record', () => {
      const atHeight = (scanned) => {
        findInDatabaseStub.returns({ generalScannedHeight: scanned });
        sinon.stub(dbHelper, 'findInDatabase').resolves([]);
        sinon.stub(dbHelper, 'countInDatabase').resolves(1);
        const collectionFake = sinon.fake.returns({
          createIndex: sinon.fake.resolves(true), updateMany: sinon.fake.resolves({ modifiedCount: 0 }), indexes: sinon.fake.resolves([]), deleteMany: sinon.fake.resolves({ deletedCount: 0 }),
          find: sinon.fake.returns({ toArray: sinon.fake.resolves([]) }),
        });
        fakeDatabase(sinon.fake.returns({ collection: collectionFake }));
        getBlockCountStub.returns({ status: 'success', data: 200000 });
        explorerService.setBlockProccessingCanContinue(false);
      };

      it('is built from the blocks up to the scanned height when it holds nothing and the explorer is near the tip', async () => {
        atHeight(199500);
        isBuiltStub.resolves(false);

        await explorerService.initiateBlockProcessor(false, false, false);
        await serviceHelper.delay(200);

        sinon.assert.calledOnceWithMatch(rebuildStub, 199500, sinon.match.func);
      });

      it('is left to the catch-up when the explorer is further behind than the blocks it holds', async () => {
        atHeight(199000);
        isBuiltStub.resolves(false);

        await explorerService.initiateBlockProcessor(false, false, false);
        await serviceHelper.delay(200);

        sinon.assert.notCalled(rebuildStub);
      });

      it('is not built again once it holds the blocks', async () => {
        atHeight(199500);

        await explorerService.initiateBlockProcessor(false, false, false);
        await serviceHelper.delay(200);

        sinon.assert.notCalled(rebuildStub);
      });

      it('is read as holding every block up to the scanned height once it holds the blocks', async () => {
        const resumeAtStub = sinon.stub(fluxnodeAddressRecord, 'resumeAt');
        atHeight(199500);

        await explorerService.initiateBlockProcessor(false, false, false);
        await serviceHelper.delay(200);

        sinon.assert.calledOnceWithExactly(resumeAtStub, 199500);
      });

      it('is left to the blocks the explorer processes when it cannot be built, and the explorer carries on from the scanned height', async () => {
        atHeight(1999500);
        getBlockCountStub.returns({ status: 'success', data: 2000000 });
        isBuiltStub.resolves(false);
        rebuildStub.rejects(new Error('daemon gone'));

        await explorerService.initiateBlockProcessor(false, false, false);
        await serviceHelper.delay(200);

        sinon.assert.calledWithMatch(logErrorSpy, 'The fluxnode address record was not built: daemon gone');
        sinon.assert.calledWithMatch(daemonServiceBlockchainRpcs.getBlock, { params: { hashheight: 1999501 } });
        sinon.assert.neverCalledWithMatch(daemonServiceBlockchainRpcs.getBlock, { params: { hashheight: config.fluxapps.epochstart } });
      });

      it('is built from blocks asked for again while fluxd refuses them, up to five times', async () => {
        atHeight(199500);
        isBuiltStub.resolves(false);
        const delayStub = sinon.stub(serviceHelper, 'delay').resolves();

        await explorerService.initiateBlockProcessor(false, false, false);
        const fetchBlock = rebuildStub.firstCall.args[1];
        const getBlockStub = daemonServiceBlockchainRpcs.getBlock;
        const asked = () => getBlockStub.getCalls().filter((call) => call.args[0].params.hashheight === 199000).length;
        let refusals = 2;
        getBlockStub.callsFake((req) => {
          if (req.params.hashheight !== 199000) return { status: 'success', data: { height: req.params.hashheight, confirmations: 1, tx: [] } };
          if (refusals > 0) {
            refusals -= 1;
            return { status: 'error', data: { message: 'Work queue depth exceeded' } };
          }
          return { status: 'success', data: { height: 199000, confirmations: 501, tx: [] } };
        });

        expect((await fetchBlock(199000)).height).to.equal(199000);
        expect(asked()).to.equal(3);
        sinon.assert.calledWith(delayStub, 2000);

        refusals = Infinity;
        await expect(fetchBlock(199000)).to.be.rejected;
        expect(asked()).to.equal(3 + 5);
      });

      it('is not read as holding any block while it holds nothing', async () => {
        const resumeAtStub = sinon.stub(fluxnodeAddressRecord, 'resumeAt');
        atHeight(199000);
        isBuiltStub.resolves(false);

        await explorerService.initiateBlockProcessor(false, false, false);
        await serviceHelper.delay(200);

        sinon.assert.notCalled(resumeAtStub);
      });
    });

    it('starts the bootstrap again, never a scan from epochstart, when the bootstrap fails', async () => {
      findInDatabaseStub.returns({ generalScannedHeight: 0 });
      dropCollectionStub.resolves(true);
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);
      sinon.stub(dbHelper, 'countInDatabase').resolves(1);
      const collectionFake = sinon.fake.returns({
        createIndex: sinon.fake.resolves(true), updateMany: sinon.fake.resolves({ modifiedCount: 0 }), indexes: sinon.fake.resolves([]), deleteMany: sinon.fake.resolves({ deletedCount: 0 }),
        find: sinon.fake.returns({ toArray: sinon.fake.resolves([]) }),
      });
      fakeDatabase(sinon.fake.returns({ collection: collectionFake }));
      getBlockCountStub.returns({ status: 'success', data: 2000000 });
      const executeCallStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves({ status: 'error', data: { message: 'RPC unavailable' } });
      // The retries between calls pass at once; the wait before the next bootstrap holds it.
      const delayStub = sinon.stub(serviceHelper, 'delay').callsFake((ms) => (ms === 60000 ? new Promise(() => {}) : Promise.resolve()));
      // A scan that starts stops at its first block, so it is seen rather than run.
      daemonServiceBlockchainRpcs.getBlock.callsFake(() => {
        explorerService.setBlockProccessingCanContinue(false);
        return { status: 'error', data: { message: 'no scan expected' } };
      });
      explorerService.setBlockProccessingCanContinue(true);

      await explorerService.initiateBlockProcessor(false, false);
      await new Promise((resolve) => { setTimeout(resolve, 200); });
      explorerService.setBlockProccessingCanContinue(false);

      sinon.assert.callCount(executeCallStub.withArgs('getaddressdeltas'), 5);
      sinon.assert.calledWithMatch(logInfoSpy, 'Explorer has scanned nothing, bootstrapping again in 60s');
      sinon.assert.calledWith(delayStub, 60000);
      sinon.assert.notCalled(daemonServiceBlockchainRpcs.getBlock);
    });

    it('should run the block processor, restoreDatabase set to true, height > 0', async () => {
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves(true);
      sinon.stub(dbHelper, 'updateInDatabase').resolves(true);
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);
      sinon.stub(dbHelper, 'countInDatabase').resolves(1);
      findInDatabaseStub.returns({ generalScannedHeight: 1000 });
      dropCollectionStub.resolves(true);
      const createIndexFake = sinon.fake.resolves(true);
      const collectionFake = sinon.fake.returns({
        createIndex: createIndexFake, updateMany: sinon.fake.resolves({ modifiedCount: 0 }), indexes: sinon.fake.resolves([]), deleteMany: sinon.fake.resolves({ deletedCount: 0 }),
        find: sinon.fake.returns({ toArray: sinon.fake.resolves([]) }),
      });
      const dbFake = sinon.fake.returns({ collection: collectionFake });
      fakeDatabase(dbFake);
      getBlockCountStub.returns({
        status: 'success',
        data: 200000,
      });
      explorerService.setBlockProccessingCanContinue(false);

      await explorerService.initiateBlockProcessor(true, false, false);
      await serviceHelper.delay(200);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledWithMatch(logInfoSpy, 'Processing Explorer Block Height: 695000');
      sinon.assert.calledWithMatch(logInfoSpy, 'Restoring database...');
      sinon.assert.calledWithMatch(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(logInfoSpy, 'Database restored OK');
    });

    it('should run the block processor, deepRestore, restoreDatabase set to true, height > 0', async () => {
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves(true);
      sinon.stub(dbHelper, 'updateInDatabase').resolves(true);
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);
      sinon.stub(dbHelper, 'countInDatabase').resolves(1);
      findInDatabaseStub.returns({ generalScannedHeight: 1000 });
      dropCollectionStub.resolves(true);
      const createIndexFake = sinon.fake.resolves(true);
      const collectionFake = sinon.fake.returns({
        createIndex: createIndexFake, updateMany: sinon.fake.resolves({ modifiedCount: 0 }), indexes: sinon.fake.resolves([]), deleteMany: sinon.fake.resolves({ deletedCount: 0 }),
        find: sinon.fake.returns({ toArray: sinon.fake.resolves([]) }),
      });
      const dbFake = sinon.fake.returns({ collection: collectionFake });
      fakeDatabase(dbFake);
      getBlockCountStub.returns({
        status: 'success',
        data: 200000,
      });
      explorerService.setBlockProccessingCanContinue(false);

      await explorerService.initiateBlockProcessor(true, true, false);
      await serviceHelper.delay(200);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledWithMatch(logInfoSpy, 'Processing Explorer Block Height: 695000');
      sinon.assert.calledWithMatch(logInfoSpy, 'Deep restoring of database...');
      sinon.assert.calledWithMatch(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(logInfoSpy, 'Database restored OK');
    });

    it('should run the block processor from height 0 dropping chain data, never the app messages or locations', async () => {
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves(true);
      sinon.stub(dbHelper, 'updateInDatabase').resolves(true);
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);
      sinon.stub(dbHelper, 'countInDatabase').resolves(1);
      findInDatabaseStub.returns({ generalScannedHeight: 0 });
      dropCollectionStub.resolves(true);
      const createIndexFake = sinon.fake.resolves(true);
      const collectionFake = sinon.fake.returns({
        createIndex: createIndexFake, updateMany: sinon.fake.resolves({ modifiedCount: 0 }), indexes: sinon.fake.resolves([]), deleteMany: sinon.fake.resolves({ deletedCount: 0 }),
        find: sinon.fake.returns({ toArray: sinon.fake.resolves([]) }),
      });
      const dbFake = sinon.fake.returns({ collection: collectionFake });
      fakeDatabase(dbFake);
      getBlockCountStub.returns({
        status: 'success',
        data: 2000000,
      });
      sinon.stub(daemonServiceUtils, 'executeCall').resolves({ status: 'success', data: [] });
      sinon.stub(daemonServiceUtils, 'executeBatchCall').resolves({ status: 'success', data: [] });
      explorerService.setBlockProccessingCanContinue(false);

      await explorerService.initiateBlockProcessor(false, false);
      await serviceHelper.delay(200);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledWithMatch(logInfoSpy, 'Bootstrap: Using address-index fast path');
      sinon.assert.calledWithMatch(logInfoSpy, 'Preparation done');
      const dropped = dropCollectionStub.getCalls().map((call) => call.args[1]);
      expect(dropped).to.not.include('zelappslocation');
      expect(dropped).to.not.include('zelappsmessages');
      expect(dropped).to.not.include('zelappsinformation');
      sinon.assert.calledWithMatch(dropCollectionStub, sinon.match.object, 'zelappshashes');
    });
  });

  describe('the explorer\'s collections', () => {
    const { appsHashes } = config.database.daemon.collections;
    let hashes;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      hashes = dbHelper.databaseConnection().db(config.database.daemon.database).collection(appsHashes);
      await hashes.drop().catch(() => {});
    });

    afterEach(async () => {
      sinon.restore();
      await hashes.drop().catch(() => {});
    });

    it('keeps, of each hash\'s payment records, the earliest whose transaction is on the chain', async () => {
      await hashes.insertMany([
        { hash: 'paid', txid: 'stale', height: 200, notOnChain: true },
        { hash: 'paid', txid: 'later', height: 400, txIndex: 1 },
        { hash: 'paid', txid: 'first', height: 300, txIndex: 5 },
        { hash: 'paid', txid: 'sameblock', height: 300, txIndex: 7 },
        { hash: 'single', txid: 'only', height: 500 },
      ]);

      const removed = await explorerService.keepEarliestPayment(hashes);

      expect(removed).to.equal(3);
      expect((await hashes.find({}, { projection: { _id: 0, txid: 1 } }).sort({ txid: 1 }).toArray()).map((r) => r.txid)).to.deep.equal(['first', 'only']);
    });

    it('keeps every duplicate when the stored message cannot be moved, so the next index build recovers them again', async () => {
      await hashes.insertMany([
        { hash: 'paid', txid: 'first', height: 300 },
        { hash: 'paid', txid: 'later', height: 400 },
      ]);
      sinon.stub(messageVerifier, 'moveStoredMessagesToPayments').rejects(new Error('connection timed out'));

      await expect(explorerService.keepEarliestPayment(hashes)).to.be.rejectedWith('connection timed out');

      expect(await hashes.countDocuments({ hash: 'paid' })).to.equal(2);
    });

    it('moves the stored message of each hash it kept the earliest payment of onto that payment, then removes the rest', async () => {
      // The grouping and its order are the aggregate's; what is done with the groups is this.
      const collection = {
        aggregate: sinon.stub().returns({
          toArray: sinon.stub().resolves([{
            _id: 'paid',
            rows: [
              { id: 'id-first', txid: 'first', height: 300, value: 5 },
              { id: 'id-later', txid: 'later', height: 400, value: 7 },
            ],
          }]),
        }),
        deleteMany: sinon.stub().resolves({ deletedCount: 1 }),
      };
      const move = sinon.stub(messageVerifier, 'moveStoredMessagesToPayments').resolves();

      const removed = await explorerService.keepEarliestPayment(collection);

      expect(removed).to.equal(1);
      sinon.assert.calledOnceWithExactly(move, [{
        hash: 'paid', txid: 'first', height: 300, value: 5,
      }]);
      sinon.assert.calledOnceWithExactly(collection.deleteMany, { _id: { $in: ['id-later'] } });
      sinon.assert.callOrder(move, collection.deleteMany);
    });

    it('moves and removes nothing when no hash has more than one payment record', async () => {
      const collection = {
        aggregate: sinon.stub().returns({ toArray: sinon.stub().resolves([]) }),
        deleteMany: sinon.stub().resolves({ deletedCount: 0 }),
      };
      const move = sinon.stub(messageVerifier, 'moveStoredMessagesToPayments').resolves();

      expect(await explorerService.keepEarliestPayment(collection)).to.equal(0);
      sinon.assert.notCalled(move);
      sinon.assert.notCalled(collection.deleteMany);
    });

    it('asserts every index on the maintenance client', async () => {
      const ensureIndexes = sinon.stub(dbHelper, 'ensureIndexes').resolves();

      await explorerService.prepareCollections();

      expect(dbHelper.maintenanceConnection(), 'no maintenance client, so this proves nothing').to.not.equal(null);
      expect(ensureIndexes.callCount).to.equal(3);
      ensureIndexes.getCalls().forEach((call) => expect(call.args[0].client).to.equal(dbHelper.maintenanceConnection()));
    });

    it('builds the unique hash index on the payment records, recovering duplicates by keeping the earliest payment', async () => {
      const ensureIndexes = sinon.stub(dbHelper, 'ensureIndexes').resolves();

      await explorerService.prepareCollections();

      const call = ensureIndexes.getCalls().find((c) => c.args[0].collectionName === appsHashes);
      const unique = call.args[1].find((spec) => spec.name === 'query for getting app hash');
      expect(unique).to.include({ unique: true, recover: explorerService.keepEarliestPayment });
      expect(unique.key).to.deep.equal({ hash: 1 });
    });

    it('indexes the payment records by position, which the boot backfill reads the ones without through', async () => {
      const ensureIndexes = sinon.stub(dbHelper, 'ensureIndexes').resolves();

      await explorerService.prepareCollections();

      const call = ensureIndexes.getCalls().find((c) => c.args[0].collectionName === appsHashes);
      expect(call.args[1].map((spec) => spec.key)).to.deep.include({ txIndex: 1 });
    });

    it('starts no scan from zero until its collections hold their indexes', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({ generalScannedHeight: 0 });
      sinon.stub(dbHelper, 'countInDatabase').resolves(1);
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true } });
      sinon.stub(daemonServiceBlockchainRpcs, 'getBlockCount').returns({ status: 'success', data: 200000 });
      // a scan that starts stops the processor, so the assertion below reads it
      const scan = sinon.stub(daemonServiceBlockchainRpcs, 'getBlock').callsFake(async () => {
        explorerService.setBlockProccessingCanContinue(false);
        return { status: 'error', data: {} };
      });
      sinon.stub(dbHelper, 'ensureIndexes').rejects(new MongoNetworkTimeoutError('timed out'));
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
      explorerService.setZelAppSpecsMigrationDone(true);
      explorerService.setBlockProccessingCanContinue(true);
      try {
        await explorerService.initiateBlockProcessor(false, false);
        await clock.tickAsync(1000);

        sinon.assert.notCalled(scan);
      } finally {
        explorerService.setBlockProccessingCanContinue(false);
        explorerService.setIsInInitiationOfBP(false);
        explorerService.setZelAppSpecsMigrationDone(false);
        clock.restore();
      }
    });
  });

  describe('getAddressUtxos tests', () => {
    let findInDatabaseStub;
    let logErrorSpy;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if no address param is passed', async () => {
      const res = generateResponse();
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test1: 'test1',
        },
      };

      await explorerService.getAddressUtxos(req, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No address provided',
        },
      });
    });

    it('should return utxos from the daemon', async () => {
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);
      const req = {
        params: {
          address: '1Z123123123123123AAAACCC',
        },
        query: {
          test1: 'test1',
        },
      };
      sinon.stub(daemonServiceAddressRpcs, 'getSingleAddressUtxos').returns({
        data: [
          {
            address: '1ZADD',
            txid: 1,
            outputIndex: 11,
            height: 10000,
            satoshis: 123456,
            script: '1231244aaasdff',
          },
        ],
      });
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { height: 10000 } });

      await explorerService.getAddressUtxos(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: [
          {
            address: '1ZADD',
            txid: 1,
            vout: 11,
            height: 10000,
            satoshis: 123456,
            scriptPubKey: '1231244aaasdff',
            confirmations: 0,
          },
        ],
      });
      sinon.assert.notCalled(findInDatabaseStub);
    });
  });

  describe('getPriceSpecForHeight tests', () => {
    it('should return correct price spec via binary search', () => {
      const specs = [
        { height: -1, minPrice: 1 },
        { height: 983000, minPrice: 0.1 },
        { height: 1004000, minPrice: 0.01 },
      ];
      expect(explorerService.getPriceSpecForHeight(specs, 500000).minPrice).to.equal(1);
      expect(explorerService.getPriceSpecForHeight(specs, 983001).minPrice).to.equal(0.1);
      expect(explorerService.getPriceSpecForHeight(specs, 2000000).minPrice).to.equal(0.01);
    });
  });

  describe('processBootstrapTx tests', () => {
    const config = require('config');

    function makeTx(overrides = {}) {
      return {
        txid: 'abc123',
        version: 1,
        height: 700000,
        vin: [{ address: 't1SenderAddr' }],
        vout: [{
          valueSat: 500000000,
          scriptPubKey: {
            addresses: [config.fluxapps.address],
            asm: 'OP_RETURN 6162636465666768696a6b6c6d6e6f707172737475767778797a303132333435363738394142434445464748494a4b4c4d4e4f505152535455565758595a3031',
          },
        }],
        ...overrides,
      };
    }

    it('should extract valid app hash', () => {
      const priceSpecs = [{ height: -1, minPrice: 0.01 }];
      const seenHashes = new Set();
      const hashBatch = [];
      explorerService.processBootstrapTx(makeTx(), priceSpecs, seenHashes, hashBatch);
      expect(hashBatch).to.have.length(1);
      expect(hashBatch[0].txid).to.equal('abc123');
      expect(hashBatch[0].hash).to.have.length(64);
      expect(hashBatch[0].message).to.equal(false);
    });

    it('should skip tx with version >= 5', () => {
      const hashBatch = [];
      explorerService.processBootstrapTx(makeTx({ version: 5 }), [{ height: -1, minPrice: 0.01 }], new Set(), hashBatch);
      expect(hashBatch).to.have.length(0);
    });

    it('should skip tx below minPrice', () => {
      const hashBatch = [];
      explorerService.processBootstrapTx(
        makeTx({
          vout: [{
            valueSat: 100,
            scriptPubKey: {
              addresses: [config.fluxapps.address],
              asm: 'OP_RETURN 6162636465666768696a6b6c6d6e6f707172737475767778797a303132333435363738394142434445464748494a4b4c4d4e4f505152535455565758595a3031',
            },
          }],
        }),
        [{ height: -1, minPrice: 1 }],
        new Set(),
        hashBatch,
      );
      expect(hashBatch).to.have.length(0);
    });

    it('should deduplicate by hash', () => {
      const priceSpecs = [{ height: -1, minPrice: 0.01 }];
      const seenHashes = new Set();
      const hashBatch = [];
      explorerService.processBootstrapTx(makeTx(), priceSpecs, seenHashes, hashBatch);
      explorerService.processBootstrapTx(makeTx({ txid: 'def456' }), priceSpecs, seenHashes, hashBatch);
      expect(hashBatch).to.have.length(1);
    });

    it('should not collect soft forks (handled by bootstrapSoftForks pre-pass)', () => {
      const hashBatch = [];
      const tx = makeTx({
        vin: [{ address: config.fluxapps.addressMultisig }],
        vout: [{
          valueSat: 0,
          scriptPubKey: {
            addresses: [config.fluxapps.addressMultisig],
            asm: 'OP_RETURN 705f302e30315f302e30315f302e3030345f302e30315f302e345f302e385f302e34',
          },
        }],
      });
      explorerService.processBootstrapTx(tx, [{ height: -1, minPrice: 0.01 }], new Set(), hashBatch);
      expect(hashBatch).to.have.length(0);
    });

    it('should not count multisig payment before enforcement height', () => {
      const hashBatch = [];
      const tx = makeTx({
        height: 1200000,
        vout: [{
          valueSat: 500000000,
          scriptPubKey: {
            addresses: [config.fluxapps.addressMultisig],
            asm: 'OP_RETURN 6162636465666768696a6b6c6d6e6f707172737475767778797a303132333435363738394142434445464748494a4b4c4d4e4f505152535455565758595a3031',
          },
        }],
      });
      explorerService.processBootstrapTx(tx, [{ height: -1, minPrice: 0.01 }], new Set(), hashBatch);
      expect(hashBatch).to.have.length(0);
    });
  });

  describe('bootstrapAppHashes tests', () => {
    const config = require('config');
    let executeCallStub;
    let executeBatchCallStub;
    let insertManyStub;
    let updateOneStub;

    const hashHex1 = '6162636465666768696a6b6c6d6e6f707172737475767778797a303132333435363738394142434445464748494a4b4c4d4e4f505152535455565758595a3031';
    const hashHex2 = '30313233343536373839616263646566303132333435363738396162636465663031323334353637383961626364656630313233343536373839616263646566';

    function makeRpcTx(txid, height, address, valueSat, hashHex) {
      return {
        txid,
        version: 1,
        height,
        vin: [{ address: 't1Sender' }],
        vout: [{
          valueSat,
          scriptPubKey: { addresses: [address], asm: `OP_RETURN ${hashHex || hashHex1}` },
        }],
      };
    }

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      executeCallStub = sinon.stub(daemonServiceUtils, 'executeCall');
      executeBatchCallStub = sinon.stub(daemonServiceUtils, 'executeBatchCall');
      insertManyStub = sinon.stub(dbHelper, 'insertManyToDatabase').resolves();
      updateOneStub = sinon.stub(dbHelper, 'updateOneInDatabase').resolves();
      sinon.stub(serviceHelper, 'delay').resolves();
    });

    afterEach(() => {
      sinon.restore();
    });

    // The app payments the address index reports, as deltas carrying each
    // transaction's position in its block. The soft-fork bootstrap's own query
    // (the multisig addresses only) is answered with none.
    function stubPayments(payments) {
      executeCallStub.callsFake(async (rpc, params) => {
        if (rpc === 'getaddressdeltas' && params[0].addresses.includes(config.fluxapps.address)) {
          return {
            status: 'success',
            data: payments.map(({ txid, height, txIndex }) => ({
              txid, height, blockindex: txIndex, satoshis: 500000000, index: 0, address: config.fluxapps.address,
            })),
          };
        }
        return { status: 'success', data: [] };
      });
    }

    // Answers each requested transaction from `txs`, in the order requested.
    function stubTransactions(txs) {
      executeBatchCallStub.callsFake(async (calls) => ({
        status: 'success',
        data: calls.map((call, id) => {
          const tx = txs.find((t) => t.txid === call.params[0]);
          return tx ? { id, result: tx, error: null } : { id, result: null, error: { code: -5, message: 'Not found' } };
        }),
      }));
    }

    it('should extract hashes, record each payment\'s position, and update scannedHeight', async () => {
      stubPayments([{ txid: 'tx1', height: 700000, txIndex: 3 }, { txid: 'tx2', height: 700001, txIndex: 1 }]);
      stubTransactions([
        makeRpcTx('tx1', 700000, config.fluxapps.address, 500000000, hashHex1),
        makeRpcTx('tx2', 700001, config.fluxapps.address, 500000000, hashHex2),
      ]);

      await explorerService.bootstrapAppHashes(2579000);

      sinon.assert.calledOnce(insertManyStub);
      const inserted = insertManyStub.getCall(0).args[2];
      expect(inserted.map((r) => [r.txid, r.txIndex])).to.deep.equal([['tx1', 3], ['tx2', 1]]);
      expect(inserted[0].hash).to.have.length(64);

      sinon.assert.called(updateOneStub);
      const updateCall = updateOneStub.getCalls().find((c) => c.args[1] === config.database.daemon.collections.scannedHeight);
      expect(updateCall.args[3].$set.generalScannedHeight).to.equal(2579000);
    });

    it('should record a hash paid twice in one block by its first payment in the block', async () => {
      stubPayments([{ txid: 'later', height: 700000, txIndex: 5 }, { txid: 'earlier', height: 700000, txIndex: 2 }]);
      stubTransactions([
        makeRpcTx('later', 700000, config.fluxapps.address, 500000000, hashHex1),
        makeRpcTx('earlier', 700000, config.fluxapps.address, 500000000, hashHex1),
      ]);

      await explorerService.bootstrapAppHashes(2579000);

      const inserted = insertManyStub.getCall(0).args[2];
      expect(inserted.map((r) => [r.txid, r.txIndex])).to.deep.equal([['earlier', 2]]);
    });

    it('asks for the app payments again, and fails once getaddressdeltas has failed five times', async () => {
      executeCallStub.resolves({ status: 'error', data: { message: 'RPC failed' } });
      await expect(explorerService.bootstrapAppHashes(2579000)).to.be.rejectedWith('getaddressdeltas failed: RPC failed');
      sinon.assert.callCount(executeCallStub, 5);
      sinon.assert.notCalled(updateOneStub);
    });

    it('asks for a batch again, and fails once it has failed five times', async () => {
      stubPayments([{ txid: 'tx1', height: 700000, txIndex: 0 }]);
      executeBatchCallStub.resolves({ status: 'error', data: { message: 'Batch failed' } });
      await expect(explorerService.bootstrapAppHashes(2579000)).to.be.rejectedWith('getrawtransaction failed for 1 transactions, tx1 first: Batch failed');
      sinon.assert.callCount(executeBatchCallStub, 5);
      sinon.assert.notCalled(updateOneStub);
    });

    it('asks again for only the transactions fluxd did not return, and records every payment', async () => {
      stubPayments([{ txid: 'tx1', height: 700000, txIndex: 0 }, { txid: 'tx2', height: 700001, txIndex: 0 }]);
      const tx1 = makeRpcTx('tx1', 700000, config.fluxapps.address, 500000000, hashHex1);
      const tx2 = makeRpcTx('tx2', 700001, config.fluxapps.address, 500000000, hashHex2);
      executeBatchCallStub.onFirstCall().resolves({
        status: 'success',
        data: [{ id: 0, result: tx1, error: null }, { id: 1, result: null, error: { code: -32603, message: 'Work queue depth exceeded' } }],
      });
      executeBatchCallStub.onSecondCall().resolves({ status: 'success', data: [{ id: 0, result: tx2, error: null }] });

      await explorerService.bootstrapAppHashes(2579000);

      expect(executeBatchCallStub.secondCall.args[0].map((call) => call.params[0])).to.deep.equal(['tx2']);
      expect(insertManyStub.getCall(0).args[2].map((r) => r.txid)).to.deep.equal(['tx1', 'tx2']);
    });

    it('fails, recording no scanned height, when a transaction fails every time it is asked for', async () => {
      stubPayments([{ txid: 'tx1', height: 700000, txIndex: 0 }, { txid: 'tx2', height: 700001, txIndex: 0 }]);
      stubTransactions([makeRpcTx('tx1', 700000, config.fluxapps.address, 500000000)]);

      await expect(explorerService.bootstrapAppHashes(2579000)).to.be.rejectedWith('getrawtransaction failed for 1 transactions, tx2 first: Not found');
      sinon.assert.callCount(executeBatchCallStub, 5);
      const scanned = updateOneStub.getCalls().filter((call) => call.args[1] === config.database.daemon.collections.scannedHeight);
      expect(scanned).to.have.length(0);
    });

    it('should fetch a transaction once when it pays more than one app address', async () => {
      stubPayments([
        { txid: 'tx1', height: 700000, txIndex: 0 },
        { txid: 'tx1', height: 700000, txIndex: 0 },
        { txid: 'tx2', height: 700001, txIndex: 0 },
      ]);
      stubTransactions([
        makeRpcTx('tx1', 700000, config.fluxapps.address, 500000000),
        makeRpcTx('tx2', 700001, config.fluxapps.address, 500000000),
      ]);

      await explorerService.bootstrapAppHashes(2579000);
      const batchCalls = executeBatchCallStub.getCall(0).args[0];
      expect(batchCalls).to.have.length(2);
    });

    it('should insert in chunks when exceeding threshold', async () => {
      const txs = Array.from({ length: 6000 }, (_, i) => {
        const hexHash = Buffer.from(`hash${String(i).padStart(60, '0')}`).toString('hex');
        return {
          txid: `tx${i}`, version: 1, height: 700000 + i,
          vin: [{ address: 't1Sender' }],
          vout: [{ valueSat: 500000000, scriptPubKey: { addresses: [config.fluxapps.address], asm: `OP_RETURN ${hexHash}` } }],
        };
      });
      stubPayments(txs.map((tx) => ({ txid: tx.txid, height: tx.height, txIndex: 0 })));
      stubTransactions(txs);

      await explorerService.bootstrapAppHashes(2579000);
      expect(insertManyStub.callCount).to.be.greaterThan(1);
    });
  });

  describe('bootstrapSoftForks tests', () => {
    const config = require('config');
    const multisigA = config.fluxapps.addressMultisig;
    const multisigB = config.fluxapps.addressMultisigB;
    let executeCallStub;
    let executeBatchCallStub;
    let updateOneStub;

    // "p1_100000_200000_0.5_300_20_0.01_1_0" encoded as hex
    const priceForkMsg = 'p1_100000_200000_0.5_300_20_0.01_1_0';
    const priceForkHex = Buffer.from(priceForkMsg).toString('hex');

    function makeDelta(txid, address, satoshis) {
      return { txid, address, satoshis, index: 0, height: 1594832 };
    }

    function makeSoftForkTx(txid, height, msgHex) {
      return {
        txid,
        height,
        vin: [{ address: multisigA }],
        vout: [
          { valueSat: 100000, scriptPubKey: { addresses: [multisigA], asm: '' } },
          { valueSat: 0, scriptPubKey: { addresses: [], asm: `OP_RETURN ${msgHex}` } },
        ],
      };
    }

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      executeCallStub = sinon.stub(daemonServiceUtils, 'executeCall');
      executeBatchCallStub = sinon.stub(daemonServiceUtils, 'executeBatchCall');
      updateOneStub = sinon.stub(dbHelper, 'updateOneInDatabase').resolves();
      sinon.stub(serviceHelper, 'delay').resolves();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call getaddressdeltas for both multisig addresses', async () => {
      executeCallStub.resolves({ status: 'success', data: [] });

      await explorerService.bootstrapSoftForks(2579000);

      sinon.assert.calledOnce(executeCallStub);
      const { args } = executeCallStub.firstCall;
      expect(args[0]).to.equal('getaddressdeltas');
      expect(args[1][0].addresses).to.include(multisigA);
      expect(args[1][0].addresses).to.include(multisigB);
      expect(args[1][0].end).to.equal(2579000);
    });

    it('should identify self-send transactions and fetch them', async () => {
      executeCallStub.resolves({
        status: 'success',
        data: [
          makeDelta('selfTx1', multisigA, -500000),
          makeDelta('selfTx1', multisigA, 500000),
          makeDelta('onlySpend', multisigA, -100000),
          makeDelta('onlyReceive', multisigB, 200000),
        ],
      });
      executeBatchCallStub.resolves({
        status: 'success',
        data: [{ id: 0, result: makeSoftForkTx('selfTx1', 1594832, priceForkHex), error: null }],
      });

      await explorerService.bootstrapSoftForks(2579000);

      sinon.assert.calledOnce(executeBatchCallStub);
      const batch = executeBatchCallStub.firstCall.args[0];
      expect(batch).to.have.lengthOf(1);
      expect(batch[0].params[0]).to.equal('selfTx1');
    });

    it('should call processSoftFork for foundation-to-foundation tx with OP_RETURN', async () => {
      executeCallStub.resolves({
        status: 'success',
        data: [
          makeDelta('forkTx', multisigA, -500000),
          makeDelta('forkTx', multisigA, 500000),
        ],
      });
      executeBatchCallStub.resolves({
        status: 'success',
        data: [{ id: 0, result: makeSoftForkTx('forkTx', 1594832, priceForkHex), error: null }],
      });

      await explorerService.bootstrapSoftForks(2579000);

      const forkWrite = updateOneStub.getCalls().find(
        (c) => c.args[2]?.txid === 'forkTx',
      );
      expect(forkWrite).to.not.be.undefined;
      expect(forkWrite.args[3].$set.height).to.equal(1594832);
      expect(forkWrite.args[3].$set.message).to.equal(priceForkMsg);
    });

    it('should batch-fetch in chunks of 500', async () => {
      const deltas = [];
      for (let i = 0; i < 600; i++) {
        deltas.push(makeDelta(`tx${i}`, multisigA, -100));
        deltas.push(makeDelta(`tx${i}`, multisigA, 100));
      }
      executeCallStub.resolves({ status: 'success', data: deltas });
      executeBatchCallStub.callsFake(async (calls) => ({
        status: 'success',
        data: calls.map((call, id) => ({ id, result: { txid: call.params[0], vin: [], vout: [] }, error: null })),
      }));

      await explorerService.bootstrapSoftForks(2579000);

      expect(executeBatchCallStub.callCount).to.equal(2);
      expect(executeBatchCallStub.firstCall.args[0]).to.have.lengthOf(500);
      expect(executeBatchCallStub.secondCall.args[0]).to.have.lengthOf(100);
    });

    it('fails once getaddressdeltas has failed five times, fetching no transaction', async () => {
      executeCallStub.resolves({ status: 'error', data: { message: 'RPC unavailable' } });

      await expect(explorerService.bootstrapSoftForks(2579000)).to.be.rejectedWith('getaddressdeltas failed: RPC unavailable');

      sinon.assert.callCount(executeCallStub, 5);
      sinon.assert.notCalled(executeBatchCallStub);
    });

    it('fails once a foundation transaction has failed five times, storing no soft fork', async () => {
      executeCallStub.resolves({ status: 'success', data: [makeDelta('tx1', multisigA, -100000), makeDelta('tx1', multisigB, 100000)] });
      executeBatchCallStub.resolves({ status: 'error', data: { message: 'Batch failed' } });

      await expect(explorerService.bootstrapSoftForks(2579000)).to.be.rejectedWith('getrawtransaction failed for 1 transactions, tx1 first: Batch failed');

      sinon.assert.callCount(executeBatchCallStub, 5);
      sinon.assert.notCalled(updateOneStub);
    });

    it('should skip transactions without OP_RETURN message', async () => {
      executeCallStub.resolves({
        status: 'success',
        data: [
          makeDelta('noOpReturn', multisigA, -500000),
          makeDelta('noOpReturn', multisigA, 500000),
        ],
      });
      const txWithoutOpReturn = {
        txid: 'noOpReturn',
        height: 1594832,
        vin: [{ address: multisigA }],
        vout: [{ valueSat: 500000, scriptPubKey: { addresses: [multisigA], asm: '' } }],
      };
      executeBatchCallStub.resolves({
        status: 'success',
        data: [{ id: 0, result: txWithoutOpReturn, error: null }],
      });

      await explorerService.bootstrapSoftForks(2579000);

      sinon.assert.notCalled(updateOneStub);
    });
  });

  describe('a chain write that fails', () => {
    // A soft fork the foundation sent to itself: a price fork every node applies.
    const softForkBlock = () => ({
      height: 1000,
      tx: [{
        version: 4,
        txid: 'softforktx',
        vin: [{ address: config.fluxapps.addressMultisig }],
        vout: [{
          valueSat: 0,
          scriptPubKey: {
            addresses: [config.fluxapps.addressMultisig],
            asm: `OP_RETURN ${Buffer.from('p_1_2_3_4').toString('hex')}`,
          },
        }],
      }],
    });

    beforeEach(() => {
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      sinon.stub(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('fails the block when its soft fork cannot be written', async () => {
      sinon.stub(dbHelper, 'updateOneInDatabase').rejects(new MongoNetworkTimeoutError('connection timed out'));

      const outcome = await explorerService.processInsight(softForkBlock(), {}).catch((err) => err);

      expect(outcome, 'the block moved on without its price fork').to.be.instanceOf(MongoNetworkTimeoutError);
    });

    it('a canary: a soft fork that fails for another reason is skipped', async () => {
      const updateOne = sinon.stub(dbHelper, 'updateOneInDatabase').rejects(new Error('unreadable message'));

      await explorerService.processInsight(softForkBlock(), {});

      sinon.assert.called(updateOne);
    });

    it('fails the block when one of its app payments cannot be recorded', async () => {
      sinon.stub(dbHelper, 'insertManyToDatabase').rejects(new Error('batch failed'));
      const upsert = sinon.stub(dbHelper, 'updateOneInDatabase');
      upsert.onFirstCall().resolves();
      upsert.onSecondCall().rejects(new MongoNetworkTimeoutError('connection timed out'));

      const outcome = await explorerService.insertTransactions([{ hash: 'a', height: 1 }, { hash: 'b', height: 1 }], {}).catch((err) => err);

      expect(outcome, 'the block moved on with a payment unrecorded').to.be.instanceOf(MongoNetworkTimeoutError);
      sinon.assert.calledTwice(upsert);
    });
  });

  describe('explorer reset requests', () => {
    let res;
    let clock;

    beforeEach(() => {
      res = { json: sinon.spy(), status: sinon.stub().returnsThis() };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: sinon.fake.returns({}) });
      sinon.stub(log, 'error');
      explorerService.setIsInInitiationOfBP(false);
      explorerService.setBlockProccessingCanContinue(true);
    });

    afterEach(() => {
      clock?.restore();
      clock = undefined;
      explorerService.setIsInInitiationOfBP(false);
      explorerService.setBlockProccessingCanContinue(true);
      sinon.restore();
    });

    async function settle() {
      for (let k = 0; k < 5; k += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setImmediate(resolve); });
      }
    }

    it('reindex answers once with the error and releases the operation when the drop fails', async () => {
      const dropCollection = sinon.stub(dbHelper, 'dropCollection').rejects(new Error('connection timed out'));

      await explorerService.reindexExplorer({ params: {} }, res);
      await settle();

      sinon.assert.calledOnce(res.json);
      sinon.assert.calledWithMatch(res.json, { status: 'error', data: { message: 'connection timed out' } });

      dropCollection.rejects(new Error('connection timed out again'));
      res.json.resetHistory();
      await explorerService.reindexExplorer({ params: {} }, res);
      await settle();
      sinon.assert.calledWithMatch(res.json, { data: { message: 'connection timed out again' } });
    });

    it('rescan answers once with the error and releases the operation when the height write fails', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({ generalScannedHeight: 2000 });
      const updateOne = sinon.stub(dbHelper, 'updateOneInDatabase').rejects(new Error('connection timed out'));

      await explorerService.rescanExplorer({ params: { blockheight: 1000 } }, res);
      await settle();

      sinon.assert.calledOnce(res.json);
      sinon.assert.calledWithMatch(res.json, { status: 'error', data: { message: 'connection timed out' } });

      updateOne.rejects(new Error('connection timed out again'));
      res.json.resetHistory();
      await explorerService.rescanExplorer({ params: { blockheight: 1000 } }, res);
      await settle();
      sinon.assert.calledWithMatch(res.json, { data: { message: 'connection timed out again' } });
    });

    it('rescan without a block height answers once', async () => {
      const findOne = sinon.stub(dbHelper, 'findOneInDatabase');

      await explorerService.rescanExplorer({ params: {} }, res);

      sinon.assert.calledOnce(res.json);
      sinon.assert.calledWithMatch(res.json, { status: 'error', data: { message: 'No blockheight provided' } });
      sinon.assert.notCalled(findOne);
    });

    it('a stop that does not take leaves block processing allowed to continue', async () => {
      clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      explorerService.setIsInInitiationOfBP(true);

      await explorerService.stopBlockProcessing({}, res);
      await clock.tickAsync(13000);

      sinon.assert.calledWithMatch(res.json, { status: 'error' });
      expect(explorerService.getBlockProccessingCanContinue()).to.equal(true);
    });
  });
});
