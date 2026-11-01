const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const repository = require('../../ZelBack/src/services/appDatabase/policyArtifactRepository');
const { requireMongo } = require('./dbTestHelper');

const MODULE_PATH = '../../ZelBack/src/services/appDatabase/policyArtifactRepository';
const POLICY_DOCUMENTS = 'policydocuments';
const LOCAL_DB = 'zelfluxlocal';

// The bundle sits inline in an ordinary document rather than in the GridFS bucket, which
// exists here for the 4.6 MB location table. These are about that row: what is written, what
// is read back, and what happens when there is no database yet -- which is the state a node
// is in for the first part of its boot.
function load({ database = {}, connected = true } = {}) {
  const dbHelper = {
    databaseConnection: sinon.stub().returns(connected ? { db: sinon.stub().returns(database) } : null),
    findOneInDatabase: sinon.stub().resolves(null),
    findOneAndUpdateInDatabase: sinon.stub().resolves({}),
  };
  const log = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
  const module = proxyquire(MODULE_PATH, {
    config: {
      database: { local: { database: LOCAL_DB, collections: { policyDocuments: POLICY_DOCUMENTS } } },
    },
    '../dbHelper': dbHelper,
    '../../lib/log': log,
    mongodb: { GridFSBucket: class {} },
  });
  return { module, dbHelper, database };
}

describe('policyArtifactRepository - the signed bundle', () => {
  afterEach(() => sinon.restore());

  describe('writeBundle', () => {
    it('upserts the bundle under its own id, with the sequence and a timestamp', async () => {
      const { module: m, dbHelper, database } = load();

      const ok = await m.writeBundle('{"payload_b64":"x"}', 42);

      expect(ok).to.equal(true);
      const [db, collection, query, update, options] = dbHelper.findOneAndUpdateInDatabase.firstCall.args;
      expect(db).to.equal(database);
      expect(collection).to.equal(POLICY_DOCUMENTS);
      expect(query, 'only over a lower sequence, or none').to.deep.equal({ _id: m.BUNDLE_ID, $or: [{ seq: { $lt: 42 } }, { seq: { $exists: false } }] });
      expect(update.$set.raw).to.equal('{"payload_b64":"x"}');
      expect(update.$set.seq).to.equal(42);
      expect(update.$set.verifiedAt).to.be.a('number');
      expect(options).to.deep.equal({ upsert: true });
    });

    it('does not collide with the artifact record, which keys on its own name', async () => {
      // Both live in policydocuments. A shared id would mean the location table's record and
      // the bundle overwriting each other's fields.
      const { module: m } = load();
      expect(m.BUNDLE_ID).to.not.equal('ipLocationTable');
    });

    const duplicateKey = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

    it('answers false when a bundle of this sequence or a higher one is stored', async () => {
      const { module: m, dbHelper: stubbedDb } = load();
      stubbedDb.findOneAndUpdateInDatabase.rejects(duplicateKey());

      expect(await m.writeBundle('{}', 4)).to.equal(false);
      expect(stubbedDb.findOneAndUpdateInDatabase.callCount, 'asked once more, the document existing').to.equal(2);
    });

    it('records a bundle whose insert met another write\'s first insert, once asked again', async () => {
      const { module: m, dbHelper: stubbedDb } = load();
      stubbedDb.findOneAndUpdateInDatabase.onFirstCall().rejects(duplicateKey());

      expect(await m.writeBundle('{}', 40)).to.equal(true);
      expect(stubbedDb.findOneAndUpdateInDatabase.callCount).to.equal(2);
    });

    it('answers false rather than throwing when there is no database yet', async () => {
      // The state a node is in early in boot. The caller treats a failed write as untidy
      // rather than fatal - it is already running on the bundle, it just will not have it
      // at the next boot.
      const { module: m, dbHelper } = load({ connected: false });

      expect(await m.writeBundle('{}', 1)).to.equal(false);
      expect(dbHelper.findOneAndUpdateInDatabase.called).to.equal(false);
    });
  });

  describe('readBundle', () => {
    it('reads back what was written', async () => {
      const { module: m, dbHelper } = load();
      dbHelper.findOneInDatabase.resolves({ _id: 'networkPolicy', raw: '{"a":1}', seq: 7, verifiedAt: 123 });

      expect(await m.readBundle()).to.deep.equal({ raw: '{"a":1}', seq: 7, verifiedAt: 123 });
      const [, collection, query] = dbHelper.findOneInDatabase.firstCall.args;
      expect(collection).to.equal(POLICY_DOCUMENTS);
      expect(query).to.deep.equal({ _id: m.BUNDLE_ID });
    });

    it('answers null when the row is absent', async () => {
      const { module: m } = load();
      expect(await m.readBundle()).to.equal(null);
    });

    it('answers null for a row with no bundle in it', async () => {
      // The artifact record shares this collection and has no `raw`. Returning it as a
      // bundle would hand the store a document it cannot verify, every boot.
      const { module: m, dbHelper } = load();
      dbHelper.findOneInDatabase.resolves({ _id: 'networkPolicy', fileId: 'abc', etag: 'x' });

      expect(await m.readBundle()).to.equal(null);
    });

    it('answers null rather than throwing when there is no database yet', async () => {
      const { module: m } = load({ connected: false });
      expect(await m.readBundle()).to.equal(null);
    });

    it('defaults a missing sequence to 0 rather than undefined', async () => {
      // getSeq() feeds a minSeq comparison. undefined there would make every comparison
      // false and quietly disable the rollback check.
      const { module: m, dbHelper } = load();
      dbHelper.findOneInDatabase.resolves({ raw: '{}' });

      expect((await m.readBundle()).seq).to.equal(0);
    });
  });
});

// The stored bundle only moves forward, in the database itself: of two writes the higher
// sequence is what stays, whichever order they are made or finish in.
describe('policyArtifactRepository - the stored bundle against a database', () => {
  const clear = () => dbHelper.databaseConnection().db(config.database.local.database)
    .collection(config.database.local.collections.policyDocuments).deleteOne({ _id: repository.BUNDLE_ID });
  const storedSeq = async () => (await repository.readBundle())?.seq ?? null;

  before(requireMongo);
  beforeEach(clear);
  after(clear);

  it('keeps the newer when the older is written after it', async () => {
    expect(await repository.writeBundle('{"b":40}', 40)).to.equal(true);
    expect(await repository.writeBundle('{"b":4}', 4)).to.equal(false);
    expect(await storedSeq()).to.equal(40);
  });

  it('moves to the newer when it is written after the older', async () => {
    await repository.writeBundle('{"b":4}', 4);
    expect(await repository.writeBundle('{"b":40}', 40)).to.equal(true);
    expect(await storedSeq()).to.equal(40);
  });

  [[4, 40], [40, 4]].forEach(([first, second]) => {
    it(`keeps the newer of two written at once with none stored, ${first} sent first`, async () => {
      await Promise.all([
        repository.writeBundle(`{"b":${first}}`, first),
        repository.writeBundle(`{"b":${second}}`, second),
      ]);
      expect(await storedSeq()).to.equal(40);
    });
  });
});
