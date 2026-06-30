const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('imageCacheStore tests', () => {
  let dbHelperStub;
  let logStub;
  let configStub;
  let indexStub;

  function build() {
    indexStub = sinon.stub().resolves();
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({
        db: sinon.stub().returns({
          collection: sinon.stub().returns({ createIndex: indexStub }),
        }),
      }),
      updateOneInDatabase: sinon.stub().resolves(),
      findOneInDatabase: sinon.stub(),
      findInDatabase: sinon.stub(),
      removeDocumentsFromCollection: sinon.stub().resolves(),
    };
    logStub = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
    configStub = {
      database: {
        appslocal: {
          database: 'localapps',
          collections: { cachedImages: 'cachedimages' },
        },
      },
    };
    return proxyquire('../../ZelBack/src/services/appLifecycle/imageCacheStore', {
      config: configStub,
      '../../lib/log': logStub,
      '../dbHelper': dbHelperStub,
    });
  }

  afterEach(() => {
    sinon.restore();
  });

  describe('upsertImage', () => {
    it('upserts keyed by (fluxId, repotag) and returns true', async () => {
      const store = build();
      const ok = await store.upsertImage({ fluxId: 'F1', repotag: 'r:1', state: 'pulling' });
      expect(ok).to.equal(true);
      const [, coll, query, update, options] = dbHelperStub.updateOneInDatabase.firstCall.args;
      expect(coll).to.equal('cachedimages');
      expect(query).to.deep.equal({ fluxId: 'F1', repotag: 'r:1' });
      expect(update).to.deep.equal({ $set: { fluxId: 'F1', repotag: 'r:1', state: 'pulling' } });
      expect(options).to.deep.equal({ upsert: true });
    });

    it('returns false on a DB error', async () => {
      const store = build();
      dbHelperStub.updateOneInDatabase.rejects(new Error('blip'));
      expect(await store.upsertImage({ fluxId: 'F1', repotag: 'r:1' })).to.equal(false);
    });
  });

  describe('patchImage', () => {
    it('patches without upsert and returns true', async () => {
      const store = build();
      const ok = await store.patchImage('F1', 'r:1', { state: 'pinned', sizeOnDiskBytes: 10 });
      expect(ok).to.equal(true);
      const [, , query, update, options] = dbHelperStub.updateOneInDatabase.firstCall.args;
      expect(query).to.deep.equal({ fluxId: 'F1', repotag: 'r:1' });
      expect(update).to.deep.equal({ $set: { state: 'pinned', sizeOnDiskBytes: 10 } });
      expect(options).to.deep.equal({ upsert: false });
    });

    it('returns false on a DB error', async () => {
      const store = build();
      dbHelperStub.updateOneInDatabase.rejects(new Error('blip'));
      expect(await store.patchImage('F1', 'r:1', { state: 'pinned' })).to.equal(false);
    });
  });

  describe('reads fail closed/safe with null on a DB error', () => {
    it('getImage returns the doc, null when missing, null on error', async () => {
      const store = build();
      dbHelperStub.findOneInDatabase.resolves({ fluxId: 'F1', repotag: 'r:1' });
      expect(await store.getImage('F1', 'r:1')).to.deep.equal({ fluxId: 'F1', repotag: 'r:1' });
      dbHelperStub.findOneInDatabase.resolves(null);
      expect(await store.getImage('F1', 'r:1')).to.equal(null);
      dbHelperStub.findOneInDatabase.rejects(new Error('blip'));
      expect(await store.getImage('F1', 'r:1')).to.equal(null);
    });

    it('listImagesForFluxId returns array on success and null on error (quota fail-closed)', async () => {
      const store = build();
      dbHelperStub.findInDatabase.resolves([{ repotag: 'r:1' }]);
      expect(await store.listImagesForFluxId('F1')).to.deep.equal([{ repotag: 'r:1' }]);
      dbHelperStub.findInDatabase.rejects(new Error('blip'));
      expect(await store.listImagesForFluxId('F1')).to.equal(null);
    });

    it('listAllImages returns array on success and null on error', async () => {
      const store = build();
      dbHelperStub.findInDatabase.resolves([]);
      expect(await store.listAllImages()).to.deep.equal([]);
      dbHelperStub.findInDatabase.rejects(new Error('blip'));
      expect(await store.listAllImages()).to.equal(null);
    });

    it('findPinsForRepotag returns array on success and null on error (gate fail-safe)', async () => {
      const store = build();
      dbHelperStub.findInDatabase.resolves([{ fluxId: 'F1', state: 'pinned' }]);
      expect(await store.findPinsForRepotag('r:1')).to.deep.equal([{ fluxId: 'F1', state: 'pinned' }]);
      dbHelperStub.findInDatabase.rejects(new Error('blip'));
      expect(await store.findPinsForRepotag('r:1')).to.equal(null);
    });
  });

  describe('removes', () => {
    it('removeImage removes one (fluxId, repotag) and returns true', async () => {
      const store = build();
      const ok = await store.removeImage('F1', 'r:1');
      expect(ok).to.equal(true);
      const [, coll, query] = dbHelperStub.removeDocumentsFromCollection.firstCall.args;
      expect(coll).to.equal('cachedimages');
      expect(query).to.deep.equal({ fluxId: 'F1', repotag: 'r:1' });
    });

    it('removeAllForFluxId removes by fluxId and returns true; false on error', async () => {
      const store = build();
      expect(await store.removeAllForFluxId('F1')).to.equal(true);
      expect(dbHelperStub.removeDocumentsFromCollection.firstCall.args[2]).to.deep.equal({ fluxId: 'F1' });
      dbHelperStub.removeDocumentsFromCollection.rejects(new Error('blip'));
      expect(await store.removeAllForFluxId('F1')).to.equal(false);
    });
  });

  describe('prepareCollection', () => {
    it('creates the unique (fluxId, repotag) index and the repotag lookup index', async () => {
      const store = build();
      await store.prepareCollection();
      expect(indexStub.callCount).to.equal(2);
      expect(indexStub.firstCall.args[0]).to.deep.equal({ fluxId: 1, repotag: 1 });
      expect(indexStub.firstCall.args[1]).to.include({ unique: true });
      expect(indexStub.secondCall.args[0]).to.deep.equal({ repotag: 1 });
    });

    it('swallows index errors (never throws)', async () => {
      const store = build();
      indexStub.rejects(new Error('blip'));
      await store.prepareCollection();
      expect(logStub.error.called).to.equal(true);
    });
  });
});
