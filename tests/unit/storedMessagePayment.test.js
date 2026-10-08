// A stored app message carries this node's chain facts for its payment: txid,
// height and payment. After a reorg the payment can be mined again in another
// block and recorded at its new height; the stored message, and the registry
// row it governs, follow the record.

const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const messageVerifier = require('../../ZelBack/src/services/appMessaging/messageVerifier');
const { requireMongo } = require('./dbTestHelper');

describe('a stored message follows this node\'s payment record', () => {
  const { appsMessages, appsInformation } = config.database.appsglobal.collections;
  const { appsHashes } = config.database.daemon.collections;
  const owner = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
  const HEIGHT = 3000000;
  let globalDb;
  let daemonDb;

  const message = (name, hash, chain) => ({
    type: 'fluxappregister',
    version: 1,
    hash,
    timestamp: chain.height,
    signature: 'sig',
    txid: chain.txid,
    height: chain.height,
    valueSat: chain.valueSat,
    appSpecifications: {
      name, version: 3, owner, expire: 100000,
    },
  });
  const payment = (hash, chain) => ({
    hash, txid: chain.txid, height: chain.height, value: chain.valueSat, txIndex: 0, message: true,
  });

  const names = ['MovedApp', 'StillApp', 'PromotedApp'];
  const hashes = ['movedhash', 'stillhash', 'unstoredhash', 'promotedhash'];

  before(async function setUp() {
    await requireMongo.call(this);
    const client = dbHelper.databaseConnection();
    globalDb = client.db(config.database.appsglobal.database);
    daemonDb = client.db(config.database.daemon.database);
  });

  beforeEach(async () => {
    await globalDb.collection(appsMessages).deleteMany({ hash: { $in: hashes } });
    await globalDb.collection(appsInformation).deleteMany({ name: { $in: names } });
    await daemonDb.collection(appsHashes).deleteMany({ hash: { $in: hashes } });
  });

  afterEach(async () => {
    sinon.restore();
    await globalDb.collection(appsMessages).deleteMany({ hash: { $in: hashes } });
    await globalDb.collection(appsInformation).deleteMany({ name: { $in: names } });
    await daemonDb.collection(appsHashes).deleteMany({ hash: { $in: hashes } });
  });

  describe('alignStoredMessagesWithPayments', () => {
    const before = { txid: 'tx-old', height: HEIGHT, valueSat: 100 };
    const after = { txid: 'tx-new', height: HEIGHT + 3, valueSat: 100 };

    it('takes the record\'s txid, height and payment for a message stored at others, and names its app', async () => {
      await globalDb.collection(appsMessages).insertMany([message('MovedApp', 'movedhash', before), message('StillApp', 'stillhash', before)]);

      const moved = await messageVerifier.alignStoredMessagesWithPayments([
        payment('movedhash', after),
        payment('stillhash', before),
        payment('unstoredhash', after),
      ]);

      expect(moved).to.deep.equal(['MovedApp']);
      const stored = await globalDb.collection(appsMessages).findOne({ hash: 'movedhash' });
      expect([stored.txid, stored.height, stored.valueSat]).to.deep.equal(['tx-new', HEIGHT + 3, 100]);
      const still = await globalDb.collection(appsMessages).findOne({ hash: 'stillhash' });
      expect([still.txid, still.height]).to.deep.equal(['tx-old', HEIGHT]);
      expect(await globalDb.collection(appsMessages).countDocuments({ hash: 'unstoredhash' })).to.equal(0);
    });

    it('takes a changed payment alone', async () => {
      await globalDb.collection(appsMessages).insertOne(message('MovedApp', 'movedhash', before));
      const moved = await messageVerifier.alignStoredMessagesWithPayments([payment('movedhash', { ...before, valueSat: 250 })]);
      expect(moved).to.deep.equal(['MovedApp']);
      expect((await globalDb.collection(appsMessages).findOne({ hash: 'movedhash' })).valueSat).to.equal(250);
    });

    it('asks nothing for no records', async () => {
      const find = sinon.spy(dbHelper, 'findInDatabase');
      expect(await messageVerifier.alignStoredMessagesWithPayments([])).to.deep.equal([]);
      sinon.assert.notCalled(find);
    });
  });

  describe('promotion of a message already stored', () => {
    it('moves the message and its registry row to the height this node recorded its payment at', async () => {
      const stale = { txid: 'tx-orphaned', height: HEIGHT, valueSat: 100 };
      const remined = { txid: 'tx-remined', height: HEIGHT + 7, valueSat: 100 };
      await globalDb.collection(appsMessages).insertOne(message('PromotedApp', 'promotedhash', stale));
      await globalDb.collection(appsInformation).insertOne({
        ...message('PromotedApp', 'promotedhash', stale).appSpecifications, hash: 'promotedhash', height: HEIGHT,
      });
      await daemonDb.collection(appsHashes).insertOne(payment('promotedhash', remined));
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: HEIGHT + 10 } });

      expect(await messageVerifier.checkAndRequestApp('promotedhash', 'tx-remined', HEIGHT + 7, 100)).to.equal(true);

      const stored = await globalDb.collection(appsMessages).findOne({ hash: 'promotedhash' });
      expect([stored.txid, stored.height]).to.deep.equal(['tx-remined', HEIGHT + 7]);
      const rows = await globalDb.collection(appsInformation).find({ name: 'PromotedApp' }).toArray();
      expect(rows.map((row) => [row.hash, row.height])).to.deep.equal([['promotedhash', HEIGHT + 7]]);
      expect((await daemonDb.collection(appsHashes).findOne({ hash: 'promotedhash' })).message).to.equal(true);
    });

    it('leaves the registry row alone when the message is where its payment is recorded', async () => {
      const chain = { txid: 'tx-same', height: HEIGHT, valueSat: 100 };
      await globalDb.collection(appsMessages).insertOne(message('PromotedApp', 'promotedhash', chain));
      await globalDb.collection(appsInformation).insertOne({
        ...message('PromotedApp', 'promotedhash', chain).appSpecifications, hash: 'promotedhash', height: HEIGHT, marker: 'untouched',
      });
      await daemonDb.collection(appsHashes).insertOne(payment('promotedhash', chain));
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: HEIGHT + 10 } });

      expect(await messageVerifier.checkAndRequestApp('promotedhash', 'tx-same', HEIGHT, 100)).to.equal(true);

      expect((await globalDb.collection(appsInformation).findOne({ name: 'PromotedApp' })).marker).to.equal('untouched');
    });
  });
});
