// App payment positions: where each payment's transaction sits in its block,
// from the daemon's address index, and the boot backfill that gives every
// payment record recorded without one its position.

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const config = require('config');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const messageVerifier = require('../../ZelBack/src/services/appMessaging/messageVerifier');
const { appPaymentAddresses, appPaymentPositions } = require('../../ZelBack/src/services/appPaymentPositions');
const { backfillPaymentPositions, BACKFILL_BATCH } = require('../../ZelBack/src/services/migrations/paymentPositions');
const { requireMongo } = require('./dbTestHelper');

chai.use(chaiAsPromised);
const { expect } = chai;

const delta = (txid, height, blockindex, satoshis = 500000000) => ({
  txid, height, blockindex, satoshis, index: 0, address: config.fluxapps.address,
});

describe('app payment positions', () => {
  let executeCall;

  beforeEach(() => {
    executeCall = sinon.stub(daemonServiceUtils, 'executeCall');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('appPaymentAddresses', () => {
    let developmentBefore;

    beforeEach(() => {
      developmentBefore = config.development;
    });

    afterEach(() => {
      config.development = developmentBefore;
    });

    it('asks for every payment address, and the development address only on a development node', () => {
      config.development = false;
      expect(appPaymentAddresses()).to.deep.equal([
        config.fluxapps.address, config.fluxapps.addressMultisig, config.fluxapps.addressMultisigB,
      ]);
      config.development = true;
      expect(appPaymentAddresses()).to.include(config.fluxapps.addressDevelopment);
    });
  });

  describe('appPaymentPositions', () => {
    it('places each paying transaction at its height and position, once, from one uncached call', async () => {
      executeCall.resolves({
        status: 'success',
        data: [delta('a', 100, 3), delta('a', 100, 3), delta('b', 101, 0)],
      });

      const positions = await appPaymentPositions(90, 200);

      expect([...positions]).to.deep.equal([['a', { height: 100, txIndex: 3 }], ['b', { height: 101, txIndex: 0 }]]);
      sinon.assert.calledOnce(executeCall);
      const [rpc, params, options] = executeCall.firstCall.args;
      expect(rpc).to.equal('getaddressdeltas');
      expect(params).to.deep.equal([{ addresses: appPaymentAddresses(), start: 90, end: 200 }]);
      expect(options).to.deep.equal({ useCache: false });
    });

    it('ignores a transaction that only spends from a payment address', async () => {
      executeCall.resolves({ status: 'success', data: [delta('spend', 100, 2, -500000000)] });
      expect((await appPaymentPositions(90, 200)).size).to.equal(0);
    });

    it('refuses an answer without positions rather than guess one', async () => {
      executeCall.resolves({ status: 'success', data: [{ ...delta('a', 100, 0), blockindex: undefined }] });
      await expect(appPaymentPositions(90, 200)).to.be.rejectedWith('no blockindex for a');
    });

    it('fails when the daemon cannot answer', async () => {
      executeCall.resolves({ status: 'error', data: { message: 'Address index not enabled' } });
      await expect(appPaymentPositions(90, 200)).to.be.rejectedWith('Address index not enabled');
    });
  });

  describe('backfillPaymentPositions against the database', () => {
    before(requireMongo);

    let hashes;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      hashes = dbHelper.databaseConnection().db(config.database.daemon.database).collection(config.database.daemon.collections.appsHashes);
      await hashes.deleteMany({});
      sinon.stub(messageVerifier, 'moveStoredMessagesToPayments').resolves([]);
      sinon.stub(messageVerifier, 'storeGoverningAppSpecifications').resolves();
      executeCall.withArgs('getBlockCount').resolves({ status: 'success', data: 1000 });
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: [] });
    });

    afterEach(async () => {
      await hashes.deleteMany({});
    });

    it('asks the daemon nothing for a record it already found not on the chain', async () => {
      await hashes.insertOne({
        hash: 'orphaned', txid: 'orphaned', height: 500, value: 1,
      });

      expect((await backfillPaymentPositions()).notOnChain).to.equal(1);
      expect((await hashes.findOne({ hash: 'orphaned' })).notOnChain).to.equal(true);
      executeCall.resetHistory();

      expect(await backfillPaymentPositions()).to.deep.equal({
        positioned: 0, heightsCorrected: 0, notOnChain: 0, aboveTip: 0,
      });
      sinon.assert.notCalled(executeCall);
    });
  });

  describe('backfillPaymentPositions', () => {
    let findInDatabase;
    let bulkWriteInDatabase;
    let moveStoredMessagesToPayments;
    let storeGoverningAppSpecifications;
    const TIP = 1000;

    beforeEach(() => {
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      findInDatabase = sinon.stub(dbHelper, 'findInDatabase');
      bulkWriteInDatabase = sinon.stub(dbHelper, 'bulkWriteInDatabase').resolves();
      moveStoredMessagesToPayments = sinon.stub(messageVerifier, 'moveStoredMessagesToPayments').resolves([]);
      storeGoverningAppSpecifications = sinon.stub(messageVerifier, 'storeGoverningAppSpecifications').resolves();
      executeCall.withArgs('getBlockCount').resolves({ status: 'success', data: TIP });
    });

    const writes = () => bulkWriteInDatabase.firstCall.args[2].map(({ updateOne }) => [updateOne.filter.txid, updateOne.update.$set]);

    it('asks the daemon nothing when every record has a position', async () => {
      findInDatabase.resolves([]);
      const outcome = await backfillPaymentPositions();
      expect(outcome).to.deep.equal({
        positioned: 0, heightsCorrected: 0, notOnChain: 0, aboveTip: 0,
      });
      sinon.assert.notCalled(executeCall);
      sinon.assert.notCalled(bulkWriteInDatabase);
    });

    it('reads only the records without a position', async () => {
      findInDatabase.resolves([]);
      await backfillPaymentPositions();
      expect(findInDatabase.firstCall.args[1]).to.equal(config.database.daemon.collections.appsHashes);
      expect(findInDatabase.firstCall.args[2]).to.deep.equal({ txIndex: { $exists: false }, notOnChain: { $ne: true } });
    });

    it('positions a record, at the height the chain holds its transaction', async () => {
      findInDatabase.resolves([{ txid: 'same', height: 500 }, { txid: 'moved', height: 501 }]);
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: [delta('same', 500, 4), delta('moved', 503, 1)] });

      const outcome = await backfillPaymentPositions();

      expect(writes()).to.deep.equal([['same', { txIndex: 4, height: 500 }], ['moved', { txIndex: 1, height: 503 }]]);
      expect(outcome).to.deep.equal({
        positioned: 2, heightsCorrected: 1, notOnChain: 0, aboveTip: 0,
      });
      expect(executeCall.withArgs('getaddressdeltas').firstCall.args[1][0]).to.include({ start: config.fluxapps.epochstart, end: TIP });
    });

    it('moves the stored message of a record whose height it corrects before writing the record, and writes its app\'s registry row after', async () => {
      findInDatabase.resolves([
        {
          hash: 'hsame', txid: 'same', height: 500, value: 5,
        },
        {
          hash: 'hmoved', txid: 'moved', height: 501, value: 7,
        },
      ]);
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: [delta('same', 500, 4), delta('moved', 503, 1)] });
      moveStoredMessagesToPayments.resolves(['MovedApp']);

      await backfillPaymentPositions();

      sinon.assert.calledOnceWithExactly(moveStoredMessagesToPayments, [{
        hash: 'hmoved', txid: 'moved', height: 503, value: 7,
      }]);
      sinon.assert.calledOnceWithExactly(storeGoverningAppSpecifications, ['MovedApp']);
      sinon.assert.callOrder(moveStoredMessagesToPayments, bulkWriteInDatabase, storeGoverningAppSpecifications);
    });

    it('writes no record when moving the stored messages fails, so the next start finds them again', async () => {
      findInDatabase.resolves([{
        hash: 'hmoved', txid: 'moved', height: 501, value: 7,
      }]);
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: [delta('moved', 503, 1)] });
      moveStoredMessagesToPayments.rejects(new Error('mongo gone'));

      await expect(backfillPaymentPositions()).to.be.rejectedWith('mongo gone');
      sinon.assert.notCalled(bulkWriteInDatabase);
      sinon.assert.notCalled(storeGoverningAppSpecifications);
    });

    it('writes no registry row when writing the records fails', async () => {
      findInDatabase.resolves([{
        hash: 'hmoved', txid: 'moved', height: 501, value: 7,
      }]);
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: [delta('moved', 503, 1)] });
      moveStoredMessagesToPayments.resolves(['MovedApp']);
      bulkWriteInDatabase.rejects(new Error('mongo gone'));

      await expect(backfillPaymentPositions()).to.be.rejectedWith('mongo gone');
      sinon.assert.notCalled(storeGoverningAppSpecifications);
    });

    it('moves no stored message when no height is corrected', async () => {
      findInDatabase.resolves([{
        hash: 'hsame', txid: 'same', height: 500, value: 5,
      }]);
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: [delta('same', 500, 4)] });

      await backfillPaymentPositions();

      expect(writes()).to.deep.equal([['same', { txIndex: 4, height: 500 }]]);
      sinon.assert.calledOnceWithExactly(moveStoredMessagesToPayments, []);
      sinon.assert.calledOnceWithExactly(storeGoverningAppSpecifications, []);
    });

    it('marks a record whose transaction the chain does not hold as not on the chain', async () => {
      findInDatabase.resolves([{ txid: 'orphaned', height: 600 }]);
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: [] });

      const outcome = await backfillPaymentPositions();

      expect(writes()).to.deep.equal([['orphaned', { notOnChain: true }]]);
      expect(outcome.notOnChain).to.equal(1);
    });

    it('leaves a record above the daemon\'s tip for a later run', async () => {
      findInDatabase.resolves([{ txid: 'ahead', height: TIP + 1 }]);
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: [] });

      const outcome = await backfillPaymentPositions();

      sinon.assert.notCalled(bulkWriteInDatabase);
      expect(outcome).to.deep.equal({
        positioned: 0, heightsCorrected: 0, notOnChain: 0, aboveTip: 1,
      });
    });

    it('writes the records in batches, each of at most BACKFILL_BATCH', async () => {
      const count = (2 * BACKFILL_BATCH) + 1;
      const records = Array.from({ length: count }, (_, i) => ({ txid: `t${i}`, height: 500 }));
      findInDatabase.resolves(records);
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: records.map(({ txid }, i) => delta(txid, 500, i)) });

      const outcome = await backfillPaymentPositions();

      expect(bulkWriteInDatabase.getCalls().map((call) => call.args[2].length)).to.deep.equal([BACKFILL_BATCH, BACKFILL_BATCH, 1]);
      expect(outcome.positioned).to.equal(count);
    });

    it('writes only to a record that still has no position', async () => {
      findInDatabase.resolves([{ txid: 'a', height: 500 }]);
      executeCall.withArgs('getaddressdeltas').resolves({ status: 'success', data: [delta('a', 500, 0)] });

      await backfillPaymentPositions();

      expect(bulkWriteInDatabase.firstCall.args[2][0].updateOne.filter).to.deep.equal({ txid: 'a', txIndex: { $exists: false } });
    });

    it('fails, writing nothing, when the daemon cannot give its tip', async () => {
      findInDatabase.resolves([{ txid: 'a', height: 500 }]);
      executeCall.withArgs('getBlockCount').resolves({ status: 'error', data: { message: 'warming up' } });

      await expect(backfillPaymentPositions()).to.be.rejectedWith('getBlockCount failed: warming up');
      sinon.assert.notCalled(bulkWriteInDatabase);
    });
  });
});
