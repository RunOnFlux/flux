// ensureIndex is the boot sequence's index builder. It runs in the awaited
// stretch of startFluxFunctions before manageAppsOnBoot launches, where a
// throw aborts boot into a 15s retry loop with the boot gate shut — so its
// contract is that it never rejects: an options conflict is resolved by
// drop-and-recreate, and any other failure (a unique index over rows that
// already violate it being the persistent case) is logged and skipped.

const { expect } = require('chai');
const sinon = require('sinon');

const { ensureIndex } = require('../../ZelBack/src/services/serviceManager');
const log = require('../../ZelBack/src/lib/log');

describe('serviceManager ensureIndex', () => {
  let logErrorSpy;

  beforeEach(() => {
    logErrorSpy = sinon.spy(log, 'error');
  });

  afterEach(() => {
    sinon.restore();
  });

  function stubCollection(createIndex) {
    return {
      collectionName: 'somecollection',
      createIndex,
      listIndexes: sinon.stub(),
      dropIndex: sinon.stub().resolves(),
    };
  }

  it('builds the index and touches nothing else on success', async () => {
    const createIndex = sinon.stub().resolves('spec_1');
    const collection = stubCollection(createIndex);

    await ensureIndex(collection, { spec: 1 }, { unique: true });

    sinon.assert.calledOnceWithExactly(createIndex, { spec: 1 }, { unique: true });
    sinon.assert.notCalled(collection.dropIndex);
    sinon.assert.notCalled(logErrorSpy);
  });

  it('drops a conflicting index by its actual name and recreates', async () => {
    const conflict = new Error('Index with name: spec_1 already exists with different options');
    conflict.codeName = 'IndexOptionsConflict';
    const createIndex = sinon.stub();
    createIndex.onFirstCall().rejects(conflict);
    createIndex.onSecondCall().resolves('spec_1');
    const collection = stubCollection(createIndex);
    collection.listIndexes.returns({
      toArray: async () => [
        { key: { _id: 1 }, name: '_id_' },
        { key: { spec: 1 }, name: 'oldname' },
      ],
    });

    await ensureIndex(collection, { spec: 1 }, { expireAfterSeconds: 60 });

    sinon.assert.calledOnceWithExactly(collection.dropIndex, 'oldname');
    sinon.assert.calledTwice(createIndex);
    sinon.assert.notCalled(logErrorSpy);
  });

  it('resolves when the build fails outright, logging what was skipped', async () => {
    // duplicate rows already in the collection: building the unique index
    // fails identically on every boot, so this must not reject
    const duplicate = new Error('E11000 duplicate key error collection');
    duplicate.code = 11000;
    duplicate.codeName = 'DuplicateKey';
    const createIndex = sinon.stub().rejects(duplicate);
    const collection = stubCollection(createIndex);

    await ensureIndex(collection, { hash: 1 }, { unique: true });

    sinon.assert.calledOnce(createIndex);
    sinon.assert.notCalled(collection.dropIndex);
    sinon.assert.calledOnce(logErrorSpy);
    expect(logErrorSpy.firstCall.firstArg).to.include('somecollection');
    expect(logErrorSpy.firstCall.firstArg).to.include('E11000');
  });

  it('resolves when the recreate after a conflict fails too', async () => {
    const conflict = new Error('index exists with different options');
    conflict.codeName = 'IndexKeySpecsConflict';
    const duplicate = new Error('E11000 duplicate key error collection');
    duplicate.codeName = 'DuplicateKey';
    const createIndex = sinon.stub();
    createIndex.onFirstCall().rejects(conflict);
    createIndex.onSecondCall().rejects(duplicate);
    const collection = stubCollection(createIndex);
    collection.listIndexes.returns({
      toArray: async () => [{ key: { spec: 1 }, name: 'oldname' }],
    });

    await ensureIndex(collection, { spec: 1 }, { unique: true });

    sinon.assert.calledOnceWithExactly(collection.dropIndex, 'oldname');
    sinon.assert.calledTwice(createIndex);
    sinon.assert.calledOnce(logErrorSpy);
  });
});
