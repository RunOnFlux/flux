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

const { ensureIndex, ensureIndexes, dedupeByKey } = require('../../ZelBack/src/services/serviceManager');
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
// ensureIndexes is the same guarantee taken in one command. mongo pays a fixed
// cost per index BUILD whatever the data size, so a node asserting its schema
// one index at a time pays it 34 times over 14 collections - and in the
// integration harness, where ten nodes share one mongod and every database is
// new, ten nodes do it at once (measured: 938 builds per fleet boot). The batch
// is the fast path only: anything that fails falls back to ensureIndex, because
// the healing above has to know WHICH index failed and a batch rejection does
// not say.
describe('serviceManager ensureIndexes', () => {
  afterEach(() => {
    sinon.restore();
  });

  function stubCollection({ createIndexes, createIndex } = {}) {
    return {
      collectionName: 'somecollection',
      createIndexes: createIndexes || sinon.stub().resolves(['a_1']),
      createIndex: createIndex || sinon.stub().resolves('a_1'),
      listIndexes: sinon.stub(),
      dropIndex: sinon.stub().resolves(),
    };
  }

  it('asserts every index in ONE command, not one command per index', async () => {
    const collection = stubCollection();

    await ensureIndexes(collection, [
      { key: { expireAt: 1 }, expireAfterSeconds: 0 },
      { key: { name: 1 }, name: 'by name' },
      { key: { ip: 1, name: 1 } },
    ]);

    sinon.assert.calledOnce(collection.createIndexes);
    sinon.assert.notCalled(collection.createIndex);
    expect(collection.createIndexes.firstCall.args[0]).to.deep.equal([
      { key: { expireAt: 1 }, expireAfterSeconds: 0 },
      { key: { name: 1 }, name: 'by name' },
      { key: { ip: 1, name: 1 } },
    ]);
  });

  it('never hands mongo the recovery strategy, which is ours', async () => {
    const collection = stubCollection();

    await ensureIndexes(collection, [
      { key: { hash: 1 }, unique: true, recover: dedupeByKey },
    ]);

    const [models] = collection.createIndexes.firstCall.args;
    expect(models).to.deep.equal([{ key: { hash: 1 }, unique: true }]);
    expect(models[0]).to.not.have.property('recover');
  });

  it('falls back to one at a time when the batch is refused, and still heals', async () => {
    const duplicate = new Error('E11000 duplicate key error collection');
    duplicate.code = 11000;
    duplicate.codeName = 'DuplicateKey';

    const createIndex = sinon.stub();
    createIndex.onFirstCall().resolves('expireAt_1');
    createIndex.onSecondCall().rejects(duplicate);
    createIndex.onThirdCall().resolves('hash_1');

    const collection = stubCollection({
      createIndexes: sinon.stub().rejects(duplicate),
      createIndex,
    });
    const recover = sinon.stub().resolves(2);

    await ensureIndexes(collection, [
      { key: { expireAt: 1 }, expireAfterSeconds: 0 },
      { key: { hash: 1 }, unique: true, recover },
    ]);

    // one per index, with the recovery run between the failed build and its retry
    sinon.assert.calledThrice(createIndex);
    sinon.assert.calledOnce(recover);
    sinon.assert.calledWithExactly(createIndex.firstCall, { expireAt: 1 }, { expireAfterSeconds: 0 });
    sinon.assert.calledWithExactly(createIndex.secondCall, { hash: 1 }, { unique: true });
    sinon.assert.calledWithExactly(createIndex.thirdCall, { hash: 1 }, { unique: true });
  });

  it('still rethrows what the per-index path cannot heal', async () => {
    const fatal = new Error('not authorized on db to execute command');
    fatal.codeName = 'Unauthorized';

    const collection = stubCollection({
      createIndexes: sinon.stub().rejects(fatal),
      createIndex: sinon.stub().rejects(fatal),
    });

    await expect(ensureIndexes(collection, [{ key: { a: 1 } }])).to.be.rejectedWith('not authorized');
  });
});
