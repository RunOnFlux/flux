const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('departedLocations', () => {
  const GONE = '203.0.113.20:16127';
  const LISTED = '203.0.113.21:16127';
  let departed;
  let applyEviction;
  let isConfirmed;
  let distinctDatabase;
  let listed;
  let onUpdated;
  let isReady;
  let checkpoint;

  beforeEach(() => {
    applyEviction = sinon.stub().resolves();
    isConfirmed = sinon.stub().returns(true);
    distinctDatabase = sinon.stub().resolves([GONE, LISTED]);
    listed = sinon.stub().callsFake(async (address) => address === LISTED);
    onUpdated = sinon.stub();
    isReady = sinon.stub().returns(true);
    checkpoint = sinon.stub().resolves();
    departed = proxyquire('../../ZelBack/src/services/appMonitoring/departedLocations', {
      config: { database: { appsglobal: { database: 'globalapps', collections: { appsLocations: 'appsLocations' } } } },
      '../dbHelper': { databaseConnection: () => ({ db: () => ({}) }), distinctDatabase },
      '../fluxCommunicationUtils': { socketAddressInFluxList: listed },
      '../appMessaging/messageStore': { applyEviction },
      '../nodeConfirmationService': { isConfirmed },
      '../networkStateService': { onUpdated, isReady },
      '../utils/fluxEventBus': { checkpoint, Checkpoint: { LOCATIONS_BEFORE_EVICTION: 'locations:beforeEviction' } },
      '../../lib/log': { error: sinon.stub() },
    });
  });

  afterEach(() => sinon.restore());

  it('evicts the addresses with rows that the list does not hold, and only those', async () => {
    await departed.evictDepartedLocations();

    sinon.assert.calledOnce(applyEviction);
    expect(applyEviction.firstCall.args[0]).to.equal(GONE);
  });

  it('judges nobody while the daemon does not confirm this node', async () => {
    isConfirmed.returns(false);

    await departed.evictDepartedLocations();

    sinon.assert.notCalled(distinctDatabase);
    sinon.assert.notCalled(applyEviction);
  });

  it('runs one pass at a time', async () => {
    let release;
    distinctDatabase.onFirstCall().returns(new Promise((resolve) => { release = resolve; }));

    const first = departed.evictDepartedLocations();
    await departed.evictDepartedLocations();
    release([GONE]);
    await first;

    sinon.assert.calledOnce(distinctDatabase);
  });

  it('runs again after a pass that failed', async () => {
    distinctDatabase.onFirstCall().rejects(new Error('database down'));

    await departed.evictDepartedLocations();
    await departed.evictDepartedLocations();

    sinon.assert.calledOnce(applyEviction);
  });

  it('runs on every node list update, and at once when the list is known', () => {
    departed.start();

    sinon.assert.calledOnceWithExactly(onUpdated, departed.evictDepartedLocations);
    sinon.assert.calledOnce(distinctDatabase);
  });

  it('waits for the first list update when the list is not known yet', () => {
    isReady.returns(false);

    departed.start();

    sinon.assert.notCalled(distinctDatabase);
  });

  it('holds at the checkpoint before each eviction', async () => {
    await departed.evictDepartedLocations();

    sinon.assert.calledOnceWithExactly(checkpoint, 'locations:beforeEviction', GONE);
    sinon.assert.callOrder(checkpoint, applyEviction);
  });
});
