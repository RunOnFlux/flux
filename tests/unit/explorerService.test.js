const sinon = require('sinon');
const { expect } = require('chai');
const LRU = require('lru-cache');
const explorerService = require('../../ZelBack/src/services/explorerService');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const appsService = require('../../ZelBack/src/services/appsService');
const daemonServiceTransactionRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceTransactionRpcs').default;
const daemonServiceBlockchainRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBlockchainRpcs').default;
const daemonServiceAddressRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceAddressRpcs').default;
const daemonServiceControlRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceControlRpcs').default;
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs').default;
const dbHelper = require('../../ZelBack/src/services/dbHelper').default;
const log = require('../../ZelBack/src/lib/log').default;

describe('explorerService tests', () => {
  describe('getSenderTransactionFromDaemon tests', () => {
    let daemonServiceTransactionRpcsStub;
    const txid = '12345';

    beforeEach(() => {
      daemonServiceTransactionRpcsStub = sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if daemonService returns error', async () => {
      daemonServiceTransactionRpcsStub.returns({
        status: 'error',
        data: 'there was an error',
      });

      await expect(explorerService.getSenderTransactionFromDaemon(txid)).to.eventually.be.rejectedWith('there was an error');
      sinon.assert.calledOnceWithExactly(daemonServiceTransactionRpcsStub, { params: { txid: '12345', verbose: 1 } });
    });

    it('should return sender if there was no errro', async () => {
      daemonServiceTransactionRpcsStub.returns({
        status: 'success',
        data: '1ZA123444DD',
      });

      const result = await explorerService.getSenderTransactionFromDaemon(txid);

      expect(result).to.equal('1ZA123444DD');
      sinon.assert.calledOnceWithExactly(daemonServiceTransactionRpcsStub, { params: { txid: '12345', verbose: 1 } });
    });
  });

  describe('getSenderForFluxTxInsight tests', () => {
    let dbStub;
    let lruStubGet;
    let lruStubSet;
    const txid = '12345';
    const vout = '444';
    let daemonServiceTransactionRpcsStub;

    beforeEach(async () => {
      lruStubGet = sinon.stub(LRU.prototype, 'get');
      lruStubSet = sinon.stub(LRU.prototype, 'set');
      dbStub = sinon.stub(dbHelper, 'findOneInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      daemonServiceTransactionRpcsStub = sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if node cache exists', async () => {
      lruStubGet.returns(true);

      const result = await explorerService.getSenderForFluxTxInsight(txid, vout);

      expect(result).to.equal(true);
      sinon.assert.calledOnceWithExactly(lruStubGet, `${txid}-${vout}`);
    });

    it('should set cache and return sender if there is an entry in the db', async () => {
      const txContent = {
        txid,
        address: 12345,
        satoshis: 10000,
      };
      lruStubGet.returns(false);
      dbStub.returns(txContent);

      const result = await explorerService.getSenderForFluxTxInsight(txid, vout);

      expect(result).to.equal(txContent);
      sinon.assert.calledOnceWithExactly(lruStubGet, `${txid}-${vout}`);
      sinon.assert.calledOnceWithExactly(lruStubSet, `${txid}-${vout}`, txContent);
    });

    it('should adjustedTxContent if there is no entry in the db', async () => {
      const txContent = {
        txid,
        vout: [{
          n: 444,
          scriptPubKey:
          { addresses: ['1ZACDE1234567'] },
          valueSat: 1000,
        }],
      };
      lruStubGet.returns(false);
      dbStub.returns(false);
      daemonServiceTransactionRpcsStub.returns({
        status: 'success',
        data: { ...txContent },
      });
      const result = await explorerService.getSenderForFluxTxInsight(txid, vout);

      expect(result).to.eql({ txid: '12345', address: '1ZACDE1234567', satoshis: 1000 });
      sinon.assert.calledOnceWithExactly(lruStubGet, `${txid}-${vout}`);
      sinon.assert.calledOnceWithExactly(lruStubSet, `${txid}-${vout}`, { txid: '12345', address: '1ZACDE1234567', satoshis: 1000 });
    });

    it('should adjustedTxContent if there is no entry in the db, transactionOutput not found', async () => {
      const txContent = {
        txid,
        vout: [{
          n: 443,
          scriptPubKey:
          { addresses: ['1ZACDE1234567'] },
          valueSat: 1000,
        }],
      };
      lruStubGet.returns(false);
      dbStub.returns(false);
      daemonServiceTransactionRpcsStub.returns({
        status: 'success',
        data: { ...txContent },
      });
      const result = await explorerService.getSenderForFluxTxInsight(txid, vout);

      expect(result).to.eql({ txid: '12345', address: undefined, satoshis: undefined });
      sinon.assert.calledOnceWithExactly(lruStubGet, `${txid}-${vout}`);
      sinon.assert.notCalled(lruStubSet);
    });
  });

  describe('getSenderForFluxTx tests', () => {
    let dbStub;
    let lruStubGet;
    let lruStubSet;
    const txid = '12345';
    const vout = '444';

    beforeEach(async () => {
      lruStubGet = sinon.stub(LRU.prototype, 'get');
      lruStubSet = sinon.stub(LRU.prototype, 'set');
      dbStub = sinon.stub(dbHelper, 'findOneInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if node cache exists', async () => {
      lruStubGet.returns(true);

      const result = await explorerService.getSenderForFluxTx(txid, vout);

      expect(result).to.equal(true);
      sinon.assert.calledOnceWithExactly(lruStubGet, `${txid}-${vout}`);
    });

    it('should set cache and return sender if there is an entry in the db', async () => {
      const txContent = {
        txid,
        address: 12345,
        satoshis: 10000,
      };
      lruStubGet.returns(false);
      dbStub.onCall(0).returns(txContent);

      const result = await explorerService.getSenderForFluxTx(txid, vout);

      expect(result).to.equal(txContent);
      sinon.assert.calledOnceWithExactly(lruStubGet, `${txid}-${vout}`);
      sinon.assert.calledOnceWithExactly(lruStubSet, `${txid}-${vout}`, txContent);
      sinon.assert.calledOnceWithMatch(dbStub, sinon.match.object, 'utxoindex',
        { txid: '12345', vout: '444' },
        {
          projection: {
            _id: 0, txid: 1, address: 1, satoshis: 1,
          },
        });
    });

    it('should set cache and return sender if there is an entry in the db found by fluxTransactionCollection', async () => {
      const txContent = {
        txid,
        address: 12345,
        satoshis: 10000,
      };
      lruStubGet.returns(false);
      dbStub.onCall(0).returns(false);
      dbStub.onCall(1).returns(txContent);

      const result = await explorerService.getSenderForFluxTx(txid, vout);

      expect(result).to.equal(txContent);
      sinon.assert.calledOnceWithExactly(lruStubGet, `${txid}-${vout}`);
      sinon.assert.calledOnceWithExactly(lruStubSet, `${txid}-${vout}`, txContent);
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'utxoindex',
        { txid: '12345', vout: '444' },
        {
          projection: {
            _id: 0, txid: 1, address: 1, satoshis: 1,
          },
        });
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'zelnodetransactions',
        { collateralHash: '12345', collateralIndex: '444' },
        {
          projection: {
            _id: 0, collateralHash: 1, zelAddress: 1, lockedAmount: 1,
          },
        });
    });
  });

  describe('getSender tests', () => {
    let dbStub;
    const txid = '12345';
    const vout = '444';

    beforeEach(async () => {
      dbStub = sinon.stub(dbHelper, 'findOneAndDeleteInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return sender if exists in db', async () => {
      const txContent = {
        txid,
        address: 12345,
        satoshis: 10000,
        value: 'my test value',
      };
      dbStub.returns(txContent);

      const result = await explorerService.getSender(txid, vout);

      expect(result).to.equal(txContent.value);
    });

    it('should set cache and return sender if there is an entry in the db', async () => {
      const daemonServiceTransactionRpcsStub = sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction').returns({
        status: 'success',
        data: {
          txid,
          address: 12345,
          satoshis: 10000,
          value: 'my test value',
          vout: {
            444: {
              scriptPubKey:
            { addresses: ['1ZACDE1234567'] },
              valueSat: 1000,
            },
          },
        },
      });

      dbStub.returns(false);

      const result = await explorerService.getSender(txid, vout);

      expect(result).to.eql({ address: '1ZACDE1234567' });
      sinon.assert.calledOnceWithExactly(daemonServiceTransactionRpcsStub, { params: { txid: '12345', verbose: 1 } });
      sinon.assert.calledOnceWithMatch(dbStub, sinon.match.object, 'utxoindex',
        { $and: [{ txid: '12345' }, { vout: '444' }] },
        { projection: { _id: 0, address: 1 } });
    });
  });

  describe('processTransaction tests', () => {
    let dbStubInsert;

    beforeEach(async () => {
      dbStubInsert = sinon.stub(dbHelper, 'insertOneToDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should do nothing if the transaction version is >= 5', async () => {
      const txContent = {
        version: 5,
        vin: [
          {
            txid: 1,
            vout: 123455,
          }, {
            txid: 2,
            vout: 444445,
          },
        ],
      };
      const height = 829000;

      const result = await explorerService.processTransaction(txContent, height);

      expect(result).to.eql({
        version: 5,
        vin: [{ txid: 1, vout: 123455 }, { txid: 2, vout: 444445 }],
      });
      sinon.assert.notCalled(dbStubInsert);
    });

    it('should do nothing if the transaction version is == 0', async () => {
      const txContent = {
        version: 0,
        vin: [
          {
            txid: 1,
            vout: 123455,
          }, {
            txid: 2,
            vout: 444445,
          },
        ],
      };
      const height = 829000;

      const result = await explorerService.processTransaction(txContent, height);

      expect(result).to.eql({
        version: 0,
        vin: [{ txid: 1, vout: 123455 }, { txid: 2, vout: 444445 }],
      });
      sinon.assert.notCalled(dbStubInsert);
    });

    it('should write to db if version is between 4 and 1', async () => {
      sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').returns({
        txid: 2222,
        address: 12345,
        satoshis: 10000,
        value: 'my test value',
      });
      sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction').returns({
        status: 'success',
        data: {
          txid: 12345,
          address: 12345,
          satoshis: 10000,
          value: 'my test value',
          vout: {
            444: {
              scriptPubKey:
            { addresses: ['1ZACDE1234567'] },
              valueSat: 1000,
            },
          },
        },
      });
      dbStubInsert.returns(true);
      const txContent = {
        version: 4,
        txid: 11222233333,
        vin: [
          {
            txid: 1,
            vout: 12345,
          }, {
            txid: 2,
            vout: 555454,
          },
        ],
        vout: [{
          scriptPubKey: {
            addresses: [1111, 22222, 3333],
            hex: 0x1AFFF,
          },
          valueSat: 555,
        }],
      };
      const height = 829000;

      const result = await explorerService.processTransaction(txContent, height);

      expect(result.version).to.equal(4);
      expect(result.txid).to.equal(11222233333);
      expect(result.vin).to.eql([{ txid: 1, vout: 12345 }, { txid: 2, vout: 555454 }]);
      expect(result.senders).to.eql(['my test value', 'my test value']);
      sinon.assert.calledOnceWithMatch(dbStubInsert, sinon.match.object, 'utxoindex',
        {
          txid: 11222233333,
          vout: 0,
          height: 829000,
          address: 1111,
          satoshis: 555,
          scriptPubKey: 110591,
          coinbase: false,
        });
    });
  });

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

    it('save to db if version is >0 and <5 and data is correct', async () => {
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

      sinon.assert.calledOnceWithExactly(dbStubInsert, {}, 'zelappshashes', [
        {
          txid: '12345',
          height: 983000,
          hash: 'This string is exactly 64 characters long. Including this string',
          value: 20000000,
          message: false,
        },
      ], { ordered: false });
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

    it('save to db if version == 5 and data is correct', async () => {
      dbStubFind.returns({
        txid: 12345,
        address: 55555,
        satoshis: 10000,
      });
      const blockVerbose = {
        tx: [
          {
            version: 5,
            txid: '12345',
            type: 'send',
            update_type: 'someType',
            ip: '192.168.1.1',
            benchmark_tier: 'stratus',
            txhash: 'hash1234',
            outidx: '1111',
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

      sinon.assert.calledOnceWithExactly(dbStubInsert, {}, 'zelnodetransactions', [
        {
          txid: '12345',
          version: 5,
          type: 'send',
          updateType: 'someType',
          ip: '192.168.1.1',
          benchTier: 'stratus',
          collateralHash: 'hash1234',
          collateralIndex: '1111',
          zelAddress: 55555,
          lockedAmount: 10000,
          height: 983000,
        },
      ], { ordered: false });
    });
  });

  describe('processStandard tests', () => {
    let dbStubFind;
    let dbStubInsert;
    const database = {};
    let logErrorSpy;

    beforeEach(async () => {
      dbStubFind = sinon.stub(dbHelper, 'findOneInDatabase');
      dbStubInsert = sinon.stub(dbHelper, 'insertOneToDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
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
      await explorerService.processStandard(blockVerbose, database);

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
      await explorerService.processStandard(blockVerbose, database);

      sinon.assert.notCalled(dbStubInsert);
    });

    it('should update db if version is >0 and <5 and data is correct, does not contain app message', async () => {
      const blockVerbose = {
        tx: [
          {
            version: 4,
            txid: 11222233333,
            vin: [
              {
                txid: 1,
                vout: 12345,
              }, {
                txid: 2,
                vout: 555454,
              },
            ],
            vout: [{
              scriptPubKey: {
                addresses: [1111, 22222, 3333],
                hex: 0x1AFFF,
              },
              valueSat: 555,
            }],
          },
        ],
        height: 829000,
      };
      dbStubFind.returns({
        txid: 2222,
        address: 12345,
        satoshis: 10000,
        value: 'my test value',
      });
      sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').returns({
        txid: 2222,
        address: 12345,
        satoshis: 10000,
        value: 'my test value',
      });
      const updateStub = sinon.stub(dbHelper, 'updateOneInDatabase').returns(true);
      sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction').returns({
        status: 'success',
        data: {
          txid: 12345,
          address: 12345,
          satoshis: 10000,
          value: 'my test value',
          vout: {
            444: {
              scriptPubKey:
            { addresses: ['1ZACDE1234567'] },
              valueSat: 1000,
            },
          },
        },
      });
      dbStubInsert.returns(true);

      await explorerService.processStandard(blockVerbose, database);

      sinon.assert.calledWithMatch(updateStub, sinon.match.object, 'addresstransactionindex',
        { address: undefined, count: { $lt: 10000 } },
        {
          $set: { address: undefined },
          $push: { transactions: { txid: 11222233333, height: 829000 } },
          $inc: { count: 1 },
        },
        { upsert: true });
    });

    it('should save to db if version is >0 and <5 and data is correct and contains app message', async () => {
      const blockVerbose = {
        tx: [
          {
            version: 4,
            txid: 11222233333,
            vin: [
              {
                txid: 1,
                vout: 12345,
              }, {
                txid: 2,
                vout: 555454,
              },
            ],
            vout: [{
              scriptPubKey: {
                addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6', 22222, 3333],
                hex: 0x1AFFF,
                asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
              },
              valueSat: 200000000,
            }],
          },
        ],
        height: 829000,
      };
      dbStubFind.returns(false);
      sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').returns({
        txid: 2222,
        address: 12345,
        satoshis: 10000,
        value: 'my test value',
      });
      sinon.stub(dbHelper, 'updateOneInDatabase').returns(true);
      sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction').returns({
        status: 'success',
        data: {
          txid: 12345,
          address: 12345,
          satoshis: 10000,
          value: 'my test value',
          vout: {
            444: {
              scriptPubKey:
            { addresses: ['1ZACDE1234567'] },
              valueSat: 1000,
            },
          },
        },
      });
      dbStubInsert.returns(true);

      await explorerService.processStandard(blockVerbose, database);

      sinon.assert.calledWithMatch(dbStubInsert, sinon.match.object, 'utxoindex',
        {
          txid: 11222233333,
          vout: 0,
          height: 829000,
          address: 't1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6',
          satoshis: 200000000,
          scriptPubKey: 110591,
          coinbase: false,
        });
      sinon.assert.calledWithMatch(dbStubInsert, sinon.match.object, 'zelappshashes',
        {
          txid: 11222233333,
          height: 829000,
          hash: 'This string is exactly 64 characters long. Including this string',
          value: 200000000,
          message: false,
        });
    });

    it('should log error if version is >0 and <5 and data is correct and contains app message, but exists in db', async () => {
      const blockVerbose = {
        tx: [
          {
            version: 4,
            txid: 11222233333,
            vin: [
              {
                txid: 1,
                vout: 12345,
              }, {
                txid: 2,
                vout: 555454,
              },
            ],
            vout: [{
              scriptPubKey: {
                addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6', 22222, 3333],
                hex: 0x1AFFF,
                asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
              },
              valueSat: 200000000,
            }],
          },
        ],
        height: 829000,
      };
      dbStubFind.returns(true);
      sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').returns({
        txid: 2222,
        address: 12345,
        satoshis: 10000,
        value: 'my test value',
      });
      sinon.stub(dbHelper, 'updateOneInDatabase').returns(true);
      sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction').returns({
        status: 'success',
        data: {
          txid: 12345,
          address: 12345,
          satoshis: 10000,
          value: 'my test value',
          vout: {
            444: {
              scriptPubKey:
            { addresses: ['1ZACDE1234567'] },
              valueSat: 1000,
            },
          },
        },
      });
      dbStubInsert.returns(true);

      await explorerService.processStandard(blockVerbose, database);

      sinon.assert.calledWithMatch(dbStubInsert, sinon.match.object, 'utxoindex',
        {
          txid: 11222233333,
          vout: 0,
          height: 829000,
          address: 't1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6',
          satoshis: 200000000,
          scriptPubKey: 110591,
          coinbase: false,
        });
      sinon.assert.calledWithMatch(logErrorSpy, 'Hash This string is exactly 64 characters long. Including this string already exists. Not adding at height 829000');
    });

    it('should save to db if version == 5 and data is correct', async () => {
      const blockVerbose = {
        tx: [
          {
            version: 5,
            collateral_output: 'COutPoint(46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7, 0)',
            txid: 11222233333,
            type: 'someType',
            update_type: 'update',
            ip: '192.168.0.0',
            benchTier: 'cumulus',
            vin: [
              {
                txid: 1,
                vout: 12345,
              }, {
                txid: 2,
                vout: 555454,
              },
            ],
            vout: [{
              scriptPubKey: {
                addresses: ['t1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6', 22222, 3333],
                hex: 0x1AFFF,
                asm: 'OP_RETURN 5468697320737472696e672069732065786163746c792036342063686172616374657273206c6f6e672e20496e636c7564696e67207468697320737472696e67',
              },
              valueSat: 200000000,
            }],
          },
        ],
        height: 829000,
      };
      dbStubFind.returns(true);
      sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').returns({
        txid: 2222,
        address: 12345,
        satoshis: 10000,
        value: 'my test value',
      });
      sinon.stub(dbHelper, 'updateOneInDatabase').returns(true);
      sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction').returns({
        status: 'success',
        data: {
          txid: 12345,
          address: 12345,
          satoshis: 10000,
          value: 'my test value',
          vout: {
            444: {
              scriptPubKey:
            { addresses: ['1ZACDE1234567'] },
              valueSat: 1000,
            },
          },
        },
      });
      dbStubInsert.returns(true);

      await explorerService.processStandard(blockVerbose, database);

      sinon.assert.calledWithMatch(dbStubInsert, {}, 'zelnodetransactions', {
        txid: 11222233333,
        version: 5,
        type: 'someType',
        updateType: 'update',
        ip: '192.168.0.0',
        benchTier: undefined,
        collateralHash: '46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7',
        collateralIndex: 0,
        zelAddress: undefined,
        lockedAmount: undefined,
        height: 829000,
      });
    });
  });

  describe('processBlock tests', () => {
    let dbStubUpdate;
    let dbStubCollectionStats;
    let logInfoSpy;
    let expireGlobalApplicationsStub;
    let checkAndRemoveApplicationInstanceStub;
    let reinstallOldApplicationsStub;
    let restorePortsSupportStub;
    let daemonServiceBlockchainRpcsStub;
    let daemonServiceMiscRpcsStub;

    beforeEach(async () => {
      sinon.stub(dbHelper, 'findOneInDatabase');
      sinon.stub(dbHelper, 'insertManyToDatabase');
      dbStubUpdate = sinon.stub(dbHelper, 'updateOneInDatabase');
      dbStubCollectionStats = sinon.stub(dbHelper, 'collectionStats');
      expireGlobalApplicationsStub = sinon.stub(appsService, 'expireGlobalApplications');
      checkAndRemoveApplicationInstanceStub = sinon.stub(appsService, 'checkAndRemoveApplicationInstance');
      reinstallOldApplicationsStub = sinon.stub(appsService, 'reinstallOldApplications');
      restorePortsSupportStub = sinon.stub(appsService, 'restorePortsSupport');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      daemonServiceMiscRpcsStub = sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced');
      daemonServiceBlockchainRpcsStub = sinon.stub(daemonServiceBlockchainRpcs, 'getBlock');
      logInfoSpy = sinon.spy(log, 'info');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return and retry function if daemon is not synced', async () => {
      const blockHeight = 100000;
      const isInsightExplorer = true;
      daemonServiceMiscRpcsStub.returns({
        data:
      {
        synced: false,
      },
      });

      const result = await explorerService.processBlock(blockHeight, isInsightExplorer);

      expect(result).to.be.undefined;
    });

    it('should update db if all parameters are passed correctly, block height == 695000', async () => {
      const blockHeight = 695000;
      const isInsightExplorer = true;
      dbStubUpdate.returns(true);
      expireGlobalApplicationsStub.returns(true);
      // prevent infinite func loop while testing
      explorerService.setBlockProccessingCanContinue(false);
      dbStubCollectionStats.returns({
        size: 10000,
        count: 15,
        avgObjSize: 1111,
      });
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

      await explorerService.processBlock(blockHeight, isInsightExplorer);

      sinon.assert.calledOnce(expireGlobalApplicationsStub);
      sinon.assert.notCalled(checkAndRemoveApplicationInstanceStub);
      sinon.assert.notCalled(reinstallOldApplicationsStub);
      sinon.assert.calledOnce(restorePortsSupportStub);
      sinon.assert.calledOnceWithMatch(dbStubUpdate, sinon.match.object, 'scannedheight',
        { generalScannedHeight: { $gte: 0 } },
        { $set: { generalScannedHeight: 695000 } },
        { upsert: true });
      sinon.assert.calledWith(logInfoSpy, 'Processing Explorer Block Height: 695000');
      sinon.assert.calledWith(logInfoSpy, 'FLUX documents: 10000, 15, 1111');
    });

    it('should update db if all parameters are passed correctly, height == 900009', async () => {
      const blockHeight = 900009;
      const isInsightExplorer = true;
      dbStubUpdate.returns(true);
      checkAndRemoveApplicationInstanceStub.returns(true);
      // prevent infinite func loop while testing
      explorerService.setBlockProccessingCanContinue(false);
      dbStubCollectionStats.returns({
        size: 10000,
        count: 15,
        avgObjSize: 1111,
      });
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
        },
      });

      await explorerService.processBlock(blockHeight, isInsightExplorer);

      sinon.assert.notCalled(expireGlobalApplicationsStub);
      sinon.assert.calledOnce(checkAndRemoveApplicationInstanceStub);
      sinon.assert.calledOnce(reinstallOldApplicationsStub);
      sinon.assert.notCalled(restorePortsSupportStub);
      sinon.assert.calledOnceWithMatch(dbStubUpdate, sinon.match.object, 'scannedheight',
        { generalScannedHeight: { $gte: 0 } },
        { $set: { generalScannedHeight: 900009 } },
        { upsert: true });
    });

    it('should update db if all parameters are passed correctly, height == 9000259', async () => {
      const blockHeight = 900025;
      const isInsightExplorer = true;
      dbStubUpdate.returns(true);
      checkAndRemoveApplicationInstanceStub.returns(true);
      // prevent infinite func loop while testing
      explorerService.setBlockProccessingCanContinue(false);
      dbStubCollectionStats.returns({
        size: 10000,
        count: 15,
        avgObjSize: 1111,
      });
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

      await explorerService.processBlock(blockHeight, isInsightExplorer);

      sinon.assert.notCalled(expireGlobalApplicationsStub);
      sinon.assert.notCalled(checkAndRemoveApplicationInstanceStub);
      sinon.assert.notCalled(reinstallOldApplicationsStub);
      sinon.assert.calledOnce(restorePortsSupportStub);
      sinon.assert.calledOnceWithMatch(dbStubUpdate, sinon.match.object, 'scannedheight',
        { generalScannedHeight: { $gte: 0 } },
        { $set: { generalScannedHeight: 900025 } },
        { upsert: true });
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
      sinon.assert.calledOnceWithExactly(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'utxoindex', { height: { $gt: height } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'coinbasefusionindex', { height: { $gt: height } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'addresstransactionindex', { transactions: { $exists: true, $size: 0 } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'zelnodetransactions', { height: { $gt: height } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'zelappshashes', { height: { $gt: height } });
      sinon.assert.calledWithMatch(updateInDatabaseStub, sinon.match.object, 'addresstransactionindex', {}, { $pull: { transactions: { height: sinon.match.object } } });
    });

    it('should remove and update db properly, rescan parameter passed', async () => {
      removeDocumentsFromCollectionStub.returns(true);
      updateInDatabaseStub.returns(true);
      const height = 100000;

      const result = await explorerService.restoreDatabaseToBlockheightState(height, true);

      expect(result).to.equal(true);
      sinon.assert.calledWith(logInfoSpy, 'Rescanning Apps!');
      sinon.assert.calledWith(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'utxoindex', { height: { $gt: height } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'coinbasefusionindex', { height: { $gt: height } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'addresstransactionindex', { transactions: { $exists: true, $size: 0 } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'zelnodetransactions', { height: { $gt: height } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'zelappshashes', { height: { $gt: height } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'zelappsmessages', { height: { $gt: height } });
      sinon.assert.calledWithMatch(removeDocumentsFromCollectionStub, sinon.match.object, 'zelappsinformation', { height: { $gt: height } });
      sinon.assert.calledWithMatch(updateInDatabaseStub, sinon.match.object, 'addresstransactionindex', {}, { $pull: { transactions: { height: sinon.match.object } } });
    });
  });

  describe('getAllUtxos tests', () => {
    let findInDatabaseStub;
    let logErrorSpy;
    let isInsightExplorerStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase');
      isInsightExplorerStub = sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if isInsigtExplorer is true', async () => {
      isInsightExplorerStub.returns(true);
      const res = generateResponse();

      await explorerService.getAllUtxos(undefined, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Data unavailable. Deprecated',
        },
      });
    });

    it('should return record from db if isInsightExplorer is false', async () => {
      isInsightExplorerStub.returns(false);
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);

      await explorerService.getAllUtxos(undefined, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'utxoindex', {}, {
        projection: {
          _id: 0,
          txid: 1,
          vout: 1,
          height: 1,
          address: 1,
          satoshis: 1,
          scriptPubKey: 1,
          coinbase: 1,
        },
      });
    });
  });

  describe('getAllFusionCoinbase tests', () => {
    let findInDatabaseStub;
    let logErrorSpy;
    let isInsightExplorerStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase');
      isInsightExplorerStub = sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if isInsigtExplorer is true', async () => {
      isInsightExplorerStub.returns(true);
      const res = generateResponse();

      await explorerService.getAllFusionCoinbase(undefined, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Data unavailable. Deprecated',
        },
      });
    });

    it('should return record from db if isInsightExplorer is false', async () => {
      isInsightExplorerStub.returns(false);
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);

      await explorerService.getAllFusionCoinbase(undefined, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'coinbasefusionindex', {}, {
        projection: {
          _id: 0,
          txid: 1,
          vout: 1,
          height: 1,
          address: 1,
          satoshis: 1,
          scriptPubKey: 1,
          coinbase: 1,
        },
      });
    });
  });

  describe('getAllFluxTransactions tests', () => {
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

    it('should return record from db if isInsightExplorer is false', async () => {
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);

      await explorerService.getAllFluxTransactions(undefined, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'zelnodetransactions', {}, {
        projection: {
          _id: 0,
          txid: 1,
          version: 1,
          type: 1,
          updateType: 1,
          ip: 1,
          benchTier: 1,
          collateralHash: 1,
          collateralIndex: 1,
          zelAddress: 1,
          lockedAmount: 1,
          height: 1,
        },
      });
    });
  });

  describe('getAllAddressesWithTransactions tests', () => {
    let findInDatabaseStub;
    let logErrorSpy;
    let isInsightExplorerStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase');
      isInsightExplorerStub = sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if isInsigtExplorer is true', async () => {
      isInsightExplorerStub.returns(true);
      const res = generateResponse();

      await explorerService.getAllAddressesWithTransactions(undefined, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Data unavailable. Deprecated',
        },
      });
    });

    it('should return record from db if isInsightExplorer is false', async () => {
      isInsightExplorerStub.returns(false);
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);

      await explorerService.getAllAddressesWithTransactions(undefined, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'addresstransactionindex', {}, {
        projection: {
          _id: 0, transactions: 1, address: 1, count: 1,
        },
      });
    });
  });

  describe('getAllAddresses tests', () => {
    let distinctDatabaseStub;
    let logErrorSpy;
    let isInsightExplorerStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      distinctDatabaseStub = sinon.stub(dbHelper, 'distinctDatabase');
      isInsightExplorerStub = sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if isInsigtExplorer is true', async () => {
      isInsightExplorerStub.returns(true);
      const res = generateResponse();

      await explorerService.getAllAddresses(undefined, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Data unavailable. Deprecated',
        },
      });
    });

    it('should return record from db if isInsightExplorer is false', async () => {
      isInsightExplorerStub.returns(false);
      const res = generateResponse();
      distinctDatabaseStub.returns(['addr1', 'addr2']);

      await explorerService.getAllAddresses(undefined, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['addr1', 'addr2'] });
      sinon.assert.calledOnceWithMatch(distinctDatabaseStub, sinon.match.object, 'addresstransactionindex', 'address');
    });
  });

  describe('getAddressFusionCoinbase tests', () => {
    let findInDatabaseStub;
    let logErrorSpy;
    let isInsightExplorerStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase');
      isInsightExplorerStub = sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if isInsigtExplorer is true', async () => {
      isInsightExplorerStub.returns(true);
      const res = generateResponse();

      await explorerService.getAddressFusionCoinbase(undefined, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Data unavailable. Deprecated',
        },
      });
    });

    it('should throw error if isInsigtExplorer is false, no address provided', async () => {
      isInsightExplorerStub.returns(true);
      const res = generateResponse();
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };

      await explorerService.getAddressFusionCoinbase(req, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Data unavailable. Deprecated',
        },
      });
    });

    it('should return record from db if isInsightExplorer is false, address provided in params', async () => {
      isInsightExplorerStub.returns(false);
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);
      const req = {
        params: {
          address: '1Z123456ACED',
        },
        query: {
          test2: 'test2',
        },
      };
      await explorerService.getAddressFusionCoinbase(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'coinbasefusionindex', { address: '1Z123456ACED' }, {
        projection: {
          _id: 0,
          txid: 1,
          vout: 1,
          height: 1,
          address: 1,
          satoshis: 1,
          scriptPubKey: 1,
          coinbase: 1,
        },
      });
    });

    it('should return record from db if isInsightExplorer is false, address provided in query', async () => {
      isInsightExplorerStub.returns(false);
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);
      const req = {
        params: {
          test2: 'test2',
        },
        query: {
          address: '1Z123456ACED',
        },
      };
      await explorerService.getAddressFusionCoinbase(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'coinbasefusionindex', { address: '1Z123456ACED' }, {
        projection: {
          _id: 0,
          txid: 1,
          vout: 1,
          height: 1,
          address: 1,
          satoshis: 1,
          scriptPubKey: 1,
          coinbase: 1,
        },
      });
    });
  });

  describe('getFilteredFluxTxs tests', () => {
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

    it('should return error if filter is not valid - 38 chars long', async () => {
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);
      const req = {
        params: {
          filter: '12342314324123412312341234123411111111',
        },
        query: {
          test2: 'test2',
        },
      };
      await explorerService.getFilteredFluxTxs(req, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'It is possible to only filter via IP address, Flux address and Collateral hash.',
        },
      });
    });

    it('should properly filter out records if filter is ip', async () => {
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);
      const req = {
        params: {
          filter: '192.168.0.0',
        },
        query: {
          test2: 'test2',
        },
      };
      await explorerService.getFilteredFluxTxs(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'zelnodetransactions', { ip: '192.168.0.0' }, {
        projection: {
          _id: 0,
          txid: 1,
          version: 1,
          type: 1,
          updateType: 1,
          ip: 1,
          benchTier: 1,
          collateralHash: 1,
          collateralIndex: 1,
          zelAddress: 1,
          lockedAmount: 1,
          height: 1,
        },
      });
    });

    it('should properly filter out records if filter is 64 chars long', async () => {
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);
      const req = {
        params: {
          filter: '123423143241234123123412341234asdfsdfdasfasdfasdfasdfasdfqwqqqee',
        },
        query: {
          test2: 'test2',
        },
      };
      await explorerService.getFilteredFluxTxs(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'zelnodetransactions', { collateralHash: '123423143241234123123412341234asdfsdfdasfasdfasdfasdfasdfqwqqqee' }, {
        projection: {
          _id: 0,
          txid: 1,
          version: 1,
          type: 1,
          updateType: 1,
          ip: 1,
          benchTier: 1,
          collateralHash: 1,
          collateralIndex: 1,
          zelAddress: 1,
          lockedAmount: 1,
          height: 1,
        },
      });
    });

    it('should properly filter out records if filter is 30 chars long', async () => {
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);
      const req = {
        params: {
          filter: '123423143241234123123412341234',
        },
        query: {
          test2: 'test2',
        },
      };
      await explorerService.getFilteredFluxTxs(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'zelnodetransactions', { zelAddress: '123423143241234123123412341234' }, {
        projection: {
          _id: 0,
          txid: 1,
          version: 1,
          type: 1,
          updateType: 1,
          ip: 1,
          benchTier: 1,
          collateralHash: 1,
          collateralIndex: 1,
          zelAddress: 1,
          lockedAmount: 1,
          height: 1,
        },
      });
    });

    it('should properly filter out records if filter is 37 chars long', async () => {
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);
      const req = {
        params: {
          filter: '1234231432412341231234123412341111111',
        },
        query: {
          test2: 'test2',
        },
      };
      await explorerService.getFilteredFluxTxs(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'zelnodetransactions', { zelAddress: '1234231432412341231234123412341111111' }, {
        projection: {
          _id: 0,
          txid: 1,
          version: 1,
          type: 1,
          updateType: 1,
          ip: 1,
          benchTier: 1,
          collateralHash: 1,
          collateralIndex: 1,
          zelAddress: 1,
          lockedAmount: 1,
          height: 1,
        },
      });
    });
  });

  describe('getAddressFusionCoinbase tests', () => {
    let distinctDatabaseStub;
    let logErrorSpy;
    let isInsightExplorerStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      distinctDatabaseStub = sinon.stub(dbHelper, 'distinctDatabase');
      isInsightExplorerStub = sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if no params are passed', async () => {
      isInsightExplorerStub.returns(true);
      const res = generateResponse();

      await explorerService.getAddressTransactions(undefined, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'TypeError',
          message: "Cannot read property 'params' of undefined",
        },
      });
    });

    it('should throw error if no address param is passed', async () => {
      isInsightExplorerStub.returns(true);
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

    it('should return record from db if isInsightExplorer is false, address provided in params', async () => {
      isInsightExplorerStub.returns(false);
      const res = generateResponse();
      distinctDatabaseStub.returns(['tx1', 'tx2']);
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
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(distinctDatabaseStub, sinon.match.object, 'addresstransactionindex', 'transactions', { address: '1Z123456ACED' });
    });

    it('should return txid if isInsightExplorer is true, address provided in params', async () => {
      sinon.stub(daemonServiceAddressRpcs, 'getSingleAddresssTxids').returns({
        data: {
          reverse: sinon.fake(() => ['txid1', 'txid2', 'txid3']),
        },
      });
      isInsightExplorerStub.returns(true);
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
    let isInsightExplorerStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase');
      isInsightExplorerStub = sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if no address is provided', async () => {
      isInsightExplorerStub.returns(true);
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

    it('should return record from db if isInsightExplorer is false, address provided in params', async () => {
      isInsightExplorerStub.returns(false);
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
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: 3000 });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'utxoindex', { address: '1Z123456ACED' }, { projection: { _id: 0, satoshis: 1 } });
    });

    it('should return record from db if isInsightExplorer is false, address provided in query', async () => {
      isInsightExplorerStub.returns(false);
      const res = generateResponse();
      findInDatabaseStub.returns([{ satoshis: 1000 }, { satoshis: 2000 }]);
      const req = {
        query: {
          address: '1Z123456ACED',
        },
        params: {
          test2: 'test2',
        },
      };
      await explorerService.getAddressBalance(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: 3000 });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'utxoindex', { address: '1Z123456ACED' }, { projection: { _id: 0, satoshis: 1 } });
    });

    it('should return data from daemon service if isInsightExplorer is true, address provided in params', async () => {
      isInsightExplorerStub.returns(true);
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
    let getInfoStub;
    let dropCollectionStub;
    let logErrorSpy;
    let logInfoSpy;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findOneInDatabase');
      dropCollectionStub = sinon.stub(dbHelper, 'dropCollection');
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true } });
      getInfoStub = sinon.stub(daemonServiceControlRpcs, 'getInfo');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
      logInfoSpy = sinon.spy(log, 'info');
      sinon.stub(dbHelper, 'insertManyToDatabase').returns(true);
      sinon.stub(dbHelper, 'updateOneInDatabase').returns(true);
      sinon.stub(dbHelper, 'collectionStats').returns({
        size: 10000,
        count: 15,
        avgObjSize: 1111,
      });
      sinon.stub(appsService, 'expireGlobalApplications').returns(true);
      sinon.stub(appsService, 'checkAndRemoveApplicationInstance').returns(true);
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
      sinon.restore();
    });

    it('should return right away if isInInitiationOfBP is true', async () => {
      explorerService.setIsInInitiationOfBP(true);
      const res = generateResponse();
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };

      const result = await explorerService.initiateBlockProcessor(req, res);

      expect(result).to.be.undefined;
      sinon.assert.notCalled(findInDatabaseStub);
    });

    it('should return error if daemon service getInfo does not return success message', async () => {
      getInfoStub.returns({
        status: 'error',
        data: {
          message: 'message',
        },
      });
      const res = generateResponse();
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };

      await explorerService.initiateBlockProcessor(req, res);

      sinon.assert.calledOnce(logErrorSpy);
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'scannedheight', { generalScannedHeight: { $gte: 0 } }, { projection: { _id: 0, generalScannedHeight: 1 } });
    });

    it('should run the block processor, all params false', async () => {
      findInDatabaseStub.returns({ generalScannedHeight: 0 });
      dropCollectionStub.resolves(true);
      const createIndexFake = sinon.fake.resolves(true);
      const collectionFake = sinon.fake.returns({ createIndex: createIndexFake });
      const dbFake = sinon.fake.returns({ collection: collectionFake });
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: dbFake });
      getInfoStub.returns({
        status: 'success',
        data: {
          blocks: 200000,
        },
      });
      sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer').returns(true);
      explorerService.setBlockProccessingCanContinue(false);

      await explorerService.initiateBlockProcessor(false, false, false);
      await serviceHelper.delay(200);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledWithMatch(logInfoSpy, 'FLUX documents: 10000, 15, 1111');
      sinon.assert.calledWithMatch(logInfoSpy, 'Processing Explorer Block Height: 695000');
      sinon.assert.calledWithMatch(logInfoSpy, 'Preparing apps collections');
      sinon.assert.calledWithMatch(logInfoSpy, 'Preparation done');
    });

    it('should run the block processor, restoreDatabase set to true, height > 0', async () => {
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves(true);
      sinon.stub(dbHelper, 'updateInDatabase').resolves(true);
      findInDatabaseStub.returns({ generalScannedHeight: 1000 });
      dropCollectionStub.resolves(true);
      const createIndexFake = sinon.fake.resolves(true);
      const collectionFake = sinon.fake.returns({ createIndex: createIndexFake });
      const dbFake = sinon.fake.returns({ collection: collectionFake });
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: dbFake });
      getInfoStub.returns({
        status: 'success',
        data: {
          blocks: 200000,
        },
      });
      sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer').returns(true);
      explorerService.setBlockProccessingCanContinue(false);

      await explorerService.initiateBlockProcessor(true, false, false);
      await serviceHelper.delay(200);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledWithMatch(logInfoSpy, 'FLUX documents: 10000, 15, 1111');
      sinon.assert.calledWithMatch(logInfoSpy, 'Processing Explorer Block Height: 695000');
      sinon.assert.calledWithMatch(logInfoSpy, 'Restoring database...');
      sinon.assert.calledWithMatch(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(logInfoSpy, 'Database restored OK');
    });

    it('should run the block processor, deepRestore, restoreDatabase set to true, height > 0', async () => {
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves(true);
      sinon.stub(dbHelper, 'updateInDatabase').resolves(true);
      findInDatabaseStub.returns({ generalScannedHeight: 1000 });
      dropCollectionStub.resolves(true);
      const createIndexFake = sinon.fake.resolves(true);
      const collectionFake = sinon.fake.returns({ createIndex: createIndexFake });
      const dbFake = sinon.fake.returns({ collection: collectionFake });
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: dbFake });
      getInfoStub.returns({
        status: 'success',
        data: {
          blocks: 200000,
        },
      });
      sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer').returns(true);
      explorerService.setBlockProccessingCanContinue(false);

      await explorerService.initiateBlockProcessor(true, true, false);
      await serviceHelper.delay(200);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledWithMatch(logInfoSpy, 'FLUX documents: 10000, 15, 1111');
      sinon.assert.calledWithMatch(logInfoSpy, 'Processing Explorer Block Height: 695000');
      sinon.assert.calledWithMatch(logInfoSpy, 'Deep restoring of database...');
      sinon.assert.calledWithMatch(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(logInfoSpy, 'Rescan completed');
      sinon.assert.calledWithMatch(logInfoSpy, 'Database restored OK');
    });

    it('should run the block processor, reindexOrRescanGlobalApps set to true, height == 0', async () => {
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves(true);
      sinon.stub(dbHelper, 'updateInDatabase').resolves(true);
      findInDatabaseStub.returns({ generalScannedHeight: 0 });
      dropCollectionStub.resolves(true);
      const createIndexFake = sinon.fake.resolves(true);
      const collectionFake = sinon.fake.returns({ createIndex: createIndexFake });
      const dbFake = sinon.fake.returns({ collection: collectionFake });
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: dbFake });
      getInfoStub.returns({
        status: 'success',
        data: {
          blocks: 200000,
        },
      });
      sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer').returns(true);
      explorerService.setBlockProccessingCanContinue(false);

      await explorerService.initiateBlockProcessor(false, false, true);
      await serviceHelper.delay(200);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledWithMatch(logInfoSpy, 'FLUX documents: 10000, 15, 1111');
      sinon.assert.calledWithMatch(logInfoSpy, 'Processing Explorer Block Height: 695000');
      sinon.assert.calledWithMatch(logInfoSpy, 'Preparing apps collections');
      sinon.assert.calledWithMatch(logInfoSpy, 'Preparation done');
      sinon.assert.calledWithMatch(dropCollectionStub, sinon.match.object, 'zelappslocation');
      sinon.assert.calledWithMatch(dropCollectionStub, sinon.match.object, 'zelappsmessages');
      sinon.assert.calledWithMatch(dropCollectionStub, sinon.match.object, 'coinbasefusionindex');
      sinon.assert.calledWithMatch(dropCollectionStub, sinon.match.object, 'zelappshashes');
      sinon.assert.calledWithMatch(dropCollectionStub, sinon.match.object, 'addresstransactionindex');
      sinon.assert.calledWithMatch(dropCollectionStub, sinon.match.object, 'zelnodetransactions');
    });
  });

  describe('getAddressUtxos tests', () => {
    let findInDatabaseStub;
    let logErrorSpy;
    let isInsightExplorerStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase');
      isInsightExplorerStub = sinon.stub(daemonServiceMiscRpcs, 'isInsightExplorer');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logErrorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if no address param is passed', async () => {
      isInsightExplorerStub.returns(true);
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

    it('should return record from db if isInsightExplorer is false, addr in params', async () => {
      isInsightExplorerStub.returns(false);
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

      await explorerService.getAddressUtxos(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'utxoindex', {}, {
        projection: {
          _id: 0,
          txid: 1,
          vout: 1,
          height: 1,
          address: 1,
          satoshis: 1,
          scriptPubKey: 1,
          coinbase: 1,
        },
      });
    });

    it('should return record from db if isInsightExplorer is false, addr in query', async () => {
      isInsightExplorerStub.returns(false);
      const res = generateResponse();
      findInDatabaseStub.returns(['tx1', 'tx2']);
      const req = {
        query: {
          address: '1Z123123123123123AAAACCC',
        },
        params: {
          test1: 'test1',
        },
      };

      await explorerService.getAddressUtxos(req, res);

      sinon.assert.notCalled(logErrorSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: ['tx1', 'tx2'] });
      sinon.assert.calledOnceWithMatch(findInDatabaseStub, sinon.match.object, 'utxoindex', {}, {
        projection: {
          _id: 0,
          txid: 1,
          vout: 1,
          height: 1,
          address: 1,
          satoshis: 1,
          scriptPubKey: 1,
          coinbase: 1,
        },
      });
    });

    it('should data from daemon if isInsightExplorer is true', async () => {
      isInsightExplorerStub.returns(true);
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
});
