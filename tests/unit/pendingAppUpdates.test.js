const { expect } = require('chai');
const sinon = require('sinon');
const { default: nodeCaches, FluxTTLCache, FluxCacheManager } = require('../../ZelBack/src/services/utils/cacheManager');
const globalState = require('../../ZelBack/src/services/utils/globalState');

// The queue of updates waiting for their registration, on the cache configuration
// a node runs with, so its dispose rule is the one under test.
describe('the pending app updates queue', () => {
  let queue;

  const update = (hash, height = 1) => ({ message: { type: 'fluxappupdate', hash }, height });
  const useQueue = (overrides = {}) => {
    queue = new FluxTTLCache({ ...FluxCacheManager.cacheConfigs.pendingAppUpdatesCache, ...overrides });
    globalState.initializeCaches({ appSpawnErrorCache: new FluxTTLCache({ ttl: 1000 }), appSpawnCache: new FluxTTLCache({ ttl: 1000 }), pendingAppUpdatesCache: queue });
  };
  const enqueue = (appName, { message, height }) => {
    const release = sinon.stub();
    globalState.queuePendingUpdate(appName, message, height, release);
    return release;
  };

  beforeEach(() => useQueue());

  afterEach(() => {
    queue.clear();
    sinon.restore();
  });

  after(() => {
    globalState.initializeCaches(nodeCaches);
  });

  it('hands queued updates over in height order, each still holding its place', () => {
    const later = enqueue('app', update('u2', 20));
    const earlier = enqueue('app', update('u1', 10));

    const pending = globalState.getPendingUpdates('app');

    expect(pending.map(({ message }) => message.hash)).to.deep.equal(['u1', 'u2']);
    expect(pending.map(({ release }) => release)).to.deep.equal([earlier, later]);
    sinon.assert.notCalled(earlier);
    sinon.assert.notCalled(later);
    expect(globalState.getPendingUpdates('app')).to.deep.equal([]);
  });

  it('queues one message once, giving back the place a second copy took', () => {
    const first = enqueue('app', update('u1'));
    const copy = enqueue('app', update('u1'));

    expect(globalState.getPendingUpdates('app')).to.have.length(1);
    sinon.assert.calledOnce(copy);
    sinon.assert.notCalled(first);
  });

  it('gives back the place of an update cleared from the queue', () => {
    const release = enqueue('app', update('u1'));

    globalState.clearPendingUpdates('app');

    sinon.assert.calledOnce(release);
  });

  it('gives back the place of an update evicted from the queue, and of no other', () => {
    useQueue({ max: 1 });
    const evicted = enqueue('first', update('u1'));
    const kept = enqueue('second', update('u2'));

    sinon.assert.calledOnce(evicted);
    sinon.assert.notCalled(kept);
  });

  it('gives back the place of an update that expires in the queue', async () => {
    useQueue({ ttl: 5 });
    const release = enqueue('app', update('u1'));

    await new Promise((resolve) => { setTimeout(resolve, 50); });
    queue.purgeStale();

    sinon.assert.calledOnce(release);
  });

  it('gives back nothing when another update joins an app\'s list', () => {
    const first = enqueue('app', update('u1'));
    enqueue('app', update('u2'));

    sinon.assert.notCalled(first);
  });

  it('gives back nothing for updates handed over, when the queue is cleared after', () => {
    const release = enqueue('app', update('u1'));
    globalState.getPendingUpdates('app');

    queue.clear();

    sinon.assert.notCalled(release);
  });

  it('gives back the place at once when there is no queue to hold the update', () => {
    globalState.initializeCaches({ appSpawnErrorCache: new FluxTTLCache({ ttl: 1000 }), appSpawnCache: new FluxTTLCache({ ttl: 1000 }), pendingAppUpdatesCache: null });
    const release = sinon.stub();

    globalState.queuePendingUpdate('app', update('u1').message, 1, release);

    sinon.assert.calledOnce(release);
  });
});
