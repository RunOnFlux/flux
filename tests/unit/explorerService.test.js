const sinon = require('sinon');
const { expect } = require('chai');
const LRU = require('lru-cache');
const explorerService = require('../../ZelBack/src/services/explorerService');
const appsService = require('../../ZelBack/src/services/appsService');
const daemonServiceTransactionRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceTransactionRpcs');
const daemonServiceBlockchainRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBlockchainRpcs');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const log = require('../../ZelBack/src/lib/log');

describe.only('explorerService tests', () => {
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

  describe.only('processStandard tests', () => {
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

    it.only('should do nothing if version is >5', async () => {
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
      await explorerService.processStandard(blockVerbose, database);

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
      await explorerService.processStandard(blockVerbose, database);

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
      await explorerService.processStandard(blockVerbose, database);

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
      await explorerService.processStandard(blockVerbose, database);

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
      await explorerService.processStandard(blockVerbose, database);

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
});
