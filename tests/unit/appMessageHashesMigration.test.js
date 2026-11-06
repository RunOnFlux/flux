// The boot steps that keep the app payment records' message flags and retry
// windows true to what this node stores.

const chai = require('chai');
const sinon = require('sinon');
const config = require('config');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const { repairLostMessageFlags, restartRetryWindows } = require('../../ZelBack/src/services/migrations/appMessageHashes');
const { requireMongo } = require('./dbTestHelper');

const { expect } = chai;

describe('app message hash boot steps', () => {
  before(requireMongo);

  let hashes;
  let messages;
  let startup;
  const record = (hash, fields) => ({
    hash, txid: `tx${hash}`, height: 990548, value: 1, syncAttempts: 0, ...fields,
  });
  const message = (hash) => ({ type: 'fluxappregister', hash, height: 990548 });

  beforeEach(async () => {
    const db = dbHelper.databaseConnection();
    hashes = db.db(config.database.daemon.database).collection(config.database.daemon.collections.appsHashes);
    messages = db.db(config.database.appsglobal.database).collection(config.database.appsglobal.collections.appsMessages);
    startup = db.db(config.database.local.database).collection(config.database.local.collections.nodeStartupTracker);
    await Promise.all([hashes.deleteMany({}), messages.deleteMany({}), startup.deleteMany({})]);
  });

  afterEach(async () => {
    sinon.restore();
    await Promise.all([hashes.deleteMany({}), messages.deleteMany({}), startup.deleteMany({})]);
  });

  describe('repairLostMessageFlags', () => {
    it('repairs the flags once more payments are flagged stored than messages are stored', async () => {
      await hashes.insertMany([record('kept', { message: true }), record('lost', { message: true })]);
      await messages.insertOne(message('kept'));

      expect((await repairLostMessageFlags()).changed).to.equal(1);

      const lost = await hashes.findOne({ hash: 'lost' });
      expect(lost.message, 'a lost message still reads as stored').to.equal(false);
      expect(lost, 'a lost message is not looked for afresh').to.not.have.property('retryFromHeight');
      expect((await hashes.findOne({ hash: 'kept' })).message).to.equal(true);
    });

    it('reads only the counts while every flagged payment has its message', async () => {
      await hashes.insertMany([record('kept', { message: true }), record('missing', { message: false })]);
      await messages.insertMany([message('kept'), message('unrecorded')]);
      const repair = sinon.spy(registryManager, 'reconstructAppMessagesHashCollection');

      expect((await repairLostMessageFlags()).changed).to.equal(0);
      sinon.assert.notCalled(repair);
    });
  });

  describe('restartRetryWindows', () => {
    it('gives every payment not stored a year from its next look, once', async () => {
      await hashes.insertMany([
        record('givenUp', { message: false, messageNotFound: true, retryFromHeight: 990548, nextRetryHeight: 3068388 }),
        record('waiting', { message: false, messageNotFound: false, retryFromHeight: 990548, nextRetryHeight: 3068388, syncAttempts: 4 }),
        record('stored', { message: true, retryFromHeight: 990548 }),
      ]);

      expect(await restartRetryWindows()).to.equal(2);

      // eslint-disable-next-line no-restricted-syntax
      for (const hash of ['givenUp', 'waiting']) {
        // eslint-disable-next-line no-await-in-loop
        const restarted = await hashes.findOne({ hash });
        expect(restarted.messageNotFound, `${hash} is still given up on`).to.equal(false);
        expect(restarted.syncAttempts).to.equal(0);
        expect(restarted, `${hash} keeps a year counted from its payment`).to.not.have.property('retryFromHeight');
        expect(restarted).to.not.have.property('nextRetryHeight');
      }
      expect((await hashes.findOne({ hash: 'stored' })).retryFromHeight).to.equal(990548);

      await hashes.updateOne({ hash: 'givenUp' }, { $set: { messageNotFound: true, retryFromHeight: 3100000 } });
      expect(await restartRetryWindows(), 'restarted again at the next boot').to.equal(0);
      expect((await hashes.findOne({ hash: 'givenUp' })).messageNotFound).to.equal(true);
    });
  });
});
