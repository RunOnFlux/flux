const { expect } = require('chai');
const sinon = require('sinon');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const localRemovalQueue = require('../../ZelBack/src/services/appLifecycle/localRemovalQueue');

describe('localRemovalQueue tests', () => {
  let delayStub;
  let removed;

  const deferred = () => {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
  };

  beforeEach(() => {
    removed = [];
    delayStub = sinon.stub(serviceHelper, 'delay').resolves();
  });

  afterEach(async () => {
    await localRemovalQueue.drained();
    localRemovalQueue.setRemover(null);
    sinon.restore();
  });

  it('should remove the queued apps one at a time, in the order queued, spaced apart', async () => {
    const order = [];
    localRemovalQueue.setRemover(async (name) => { order.push(`remove ${name}`); });
    delayStub.callsFake(async (ms) => { order.push(`wait ${ms}`); });

    localRemovalQueue.queueRemovals(['A', 'B', 'C']);
    await localRemovalQueue.drained();

    const wait = `wait ${localRemovalQueue.REMOVAL_SPACING_MS}`;
    expect(order).to.deep.equal(['remove A', wait, 'remove B', wait, 'remove C']);
    expect(localRemovalQueue.REMOVAL_SPACING_MS).to.equal(5000);
  });

  it('should not queue an app already queued or being removed', async () => {
    const first = deferred();
    localRemovalQueue.setRemover(async (name) => {
      removed.push(name);
      if (name === 'A') await first.promise;
    });

    localRemovalQueue.queueRemovals(['A', 'B']);
    // A is being removed and B is queued: neither is queued again
    localRemovalQueue.queueRemovals(['A', 'B', 'C']);
    first.resolve();
    await localRemovalQueue.drained();

    expect(removed).to.deep.equal(['A', 'B', 'C']);
  });

  it('should queue an app again once its removal has finished', async () => {
    localRemovalQueue.setRemover(async (name) => { removed.push(name); });

    localRemovalQueue.queueRemovals(['A']);
    await localRemovalQueue.drained();
    localRemovalQueue.queueRemovals(['A']);
    await localRemovalQueue.drained();

    expect(removed).to.deep.equal(['A', 'A']);
  });

  it('should hand back to its caller before any removal finishes', async () => {
    const removal = deferred();
    localRemovalQueue.setRemover(async (name) => {
      removed.push(name);
      await removal.promise;
    });

    localRemovalQueue.queueRemovals(['A']);

    expect(removed).to.deep.equal(['A']);
    removal.resolve();
  });

  it('should go on to the next app when a removal fails', async () => {
    localRemovalQueue.setRemover(async (name) => {
      removed.push(name);
      if (name === 'A') throw new Error('docker refused');
    });

    localRemovalQueue.queueRemovals(['A', 'B']);
    await localRemovalQueue.drained();

    expect(removed).to.deep.equal(['A', 'B']);
  });

  it('should hold what is queued until a remover is set', async () => {
    localRemovalQueue.queueRemovals(['A']);
    expect(removed).to.deep.equal([]);

    localRemovalQueue.setRemover(async (name) => { removed.push(name); });
    await localRemovalQueue.drained();

    expect(removed).to.deep.equal(['A']);
  });
});
