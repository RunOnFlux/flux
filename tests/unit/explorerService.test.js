const sinon = require('sinon');
const { expect } = require('chai');
const LRU = require('lru-cache');
const explorerService = require('../../ZelBack/src/services/explorerService');
const daemonServiceTransactionRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceTransactionRpcs');
const daemonServiceBlockchainRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBlockchainRpcs');
const dbHelper = require('../../ZelBack/src/services/dbHelper');

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

  describe.only('processInsight tests', () => {
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

    it('save to db if version is >0 and <5', async () => {
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

    it('save to db if version == 5', async () => {
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
  });
});
