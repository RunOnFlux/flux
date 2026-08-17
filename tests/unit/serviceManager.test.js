// ensureIndex is the boot sequence's self-healing index builder. It runs in the
// awaited stretch of startFluxFunctions, before any service or interval starts,
// so a throw re-runs boot safely: the recoverable failures (an options conflict,
// or a unique build blocked by duplicate rows) are healed here, and anything
// else rethrows - a transient blip heals on the next boot pass, a genuinely
// broken DB wedges loudly. dedupeByKey is the recovery strategy a unique build
// passes when its key is the row's identity.

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');

chai.use(chaiAsPromised);
const { expect } = chai;

const { ensureIndex, dedupeByKey } = require('../../ZelBack/src/services/serviceManager');
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

  const duplicateError = () => {
    const err = new Error('E11000 duplicate key error collection');
    err.code = 11000;
    err.codeName = 'DuplicateKey';
    return err;
  };

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

  it('runs the recovery strategy and rebuilds when duplicate rows block a unique index', async () => {
    // The node ends up WITH the index, not running degraded without it.
    const createIndex = sinon.stub();
    createIndex.onFirstCall().rejects(duplicateError());
    createIndex.onSecondCall().resolves('hash_1');
    const collection = stubCollection(createIndex);
    const recover = sinon.stub().resolves(3);

    await ensureIndex(collection, { hash: 1 }, { unique: true }, recover);

    sinon.assert.calledOnceWithExactly(recover, collection, { hash: 1 }, { unique: true });
    sinon.assert.calledTwice(createIndex);
    // recover ran before the rebuild
    sinon.assert.callOrder(createIndex, recover, createIndex);
  });

  it('rethrows a duplicate-key failure with no recovery strategy, rather than skipping', async () => {
    // A unique build with no strategy is not silently swallowed - it must be
    // seen, not hidden until the next reboot.
    const createIndex = sinon.stub().rejects(duplicateError());
    const collection = stubCollection(createIndex);

    await expect(ensureIndex(collection, { hash: 1 }, { unique: true })).to.be.rejectedWith('E11000');
    sinon.assert.calledOnce(createIndex);
  });

  it('rethrows a transient failure so the boot retry can heal it', async () => {
    // Not swallowed: index setup runs before services start, so the retry loop
    // re-runs safely and a transient blip heals rather than being skipped.
    const transient = new Error('connection 5 to mongo timed out');
    transient.codeName = 'NetworkTimeout';
    const createIndex = sinon.stub().rejects(transient);
    const collection = stubCollection(createIndex);
    const recover = sinon.stub().resolves(0);

    await expect(ensureIndex(collection, { spec: 1 }, {}, recover)).to.be.rejectedWith('timed out');
    // recovery is only for the duplicate-key case, not for a transient error
    sinon.assert.notCalled(recover);
  });

  it('rethrows if the rebuild after recovery still fails', async () => {
    const createIndex = sinon.stub().rejects(duplicateError());
    const collection = stubCollection(createIndex);
    const recover = sinon.stub().resolves(1);

    await expect(ensureIndex(collection, { hash: 1 }, { unique: true }, recover)).to.be.rejectedWith('E11000');
    sinon.assert.calledOnce(recover);
    sinon.assert.calledTwice(createIndex);
  });
});

describe('serviceManager dedupeByKey', () => {
  function stubCollection(groups) {
    return {
      collectionName: 'somecollection',
      aggregate: sinon.stub().returns({ toArray: async () => groups }),
      deleteMany: sinon.stub().resolves({ deletedCount: 0 }),
    };
  }

  it('removes all but the newest per key group and reports the count', async () => {
    // ids come newest-first from the pipeline's _id sort, so slice(1) keeps the
    // newest and removes the rest.
    const collection = stubCollection([
      { _id: { k0: 'a' }, ids: ['new1', 'old1', 'old2'] },
      { _id: { k0: 'b' }, ids: ['new3', 'old3'] },
    ]);

    const removed = await dedupeByKey(collection, { hash: 1 }, { unique: true });

    expect(removed).to.equal(3);
    sinon.assert.calledOnceWithExactly(collection.deleteMany, { _id: { $in: ['old1', 'old2', 'old3'] } });
  });

  it('builds the group key from every field of the index spec', async () => {
    const collection = stubCollection([]);

    await dedupeByKey(collection, { 'data.name': 1, 'data.ip': 1 }, {});

    const [pipeline] = collection.aggregate.firstCall.args;
    const group = pipeline.find((stage) => stage.$group);
    expect(group.$group._id).to.deep.equal({ k0: '$data.name', k1: '$data.ip' });
  });

  it('honours the index partial filter so it only touches covered rows', async () => {
    const collection = stubCollection([]);
    const partial = { incidentKey: { $exists: true } };

    await dedupeByKey(collection, { appName: 1, eventType: 1, incidentKey: 1 }, { partialFilterExpression: partial });

    const [pipeline] = collection.aggregate.firstCall.args;
    expect(pipeline[0]).to.deep.equal({ $match: partial });
  });

  it('deletes nothing when there are no duplicates', async () => {
    const collection = stubCollection([]);

    const removed = await dedupeByKey(collection, { hash: 1 }, {});

    expect(removed).to.equal(0);
    sinon.assert.notCalled(collection.deleteMany);
  });
});
