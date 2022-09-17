const sinon = require('sinon');
const { expect } = require('chai');
const LRU = require('lru-cache');
const explorerService = require('../../ZelBack/src/services/explorerService');
const daemonServiceTransactionRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceTransactionRpcs');
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

  describe.only('getSenderForFluxTx tests', () => {
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
});
