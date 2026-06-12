// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// The consumer is the EDGE half of the level-triggered architecture: syncthing's
// events API accelerates reaction, but events never carry decisions - they only
// trigger the same evaluation the periodic poll runs. The stream's failure modes
// (finite buffer, ids reset on syncthing restart, dead long-poll) therefore cost
// LATENCY only, never correctness; this suite pins the failure handling that
// guarantees that property (gap/regression -> resync, error -> backoff retry).
const syncthingServiceMock = {
  getEvents: sinon.stub(),
};

const serviceHelperMock = {
  delay: sinon.stub().resolves(),
};

const fluxEventBusMock = {
  publish: sinon.stub(),
};

const consumer = proxyquire('../../ZelBack/src/services/appMonitoring/syncthingEventsConsumer', {
  '../syncthingService': syncthingServiceMock,
  '../serviceHelper': serviceHelperMock,
  '../utils/fluxEventBus': fluxEventBusMock,
});

// park the long-poll forever so a test can stop the loop deterministically
function parkForever() {
  return new Promise(() => {});
}

function eventsResponse(events) {
  return { status: 'success', data: events };
}

describe('syncthingEventsConsumer tests', () => {
  let onFolderActivity;
  let onResync;

  beforeEach(() => {
    syncthingServiceMock.getEvents.reset();
    serviceHelperMock.delay.reset();
    serviceHelperMock.delay.resolves();
    fluxEventBusMock.publish.reset();
    onFolderActivity = sinon.stub();
    onResync = sinon.stub();
  });

  afterEach(async () => {
    await consumer.stop();
  });

  it('long-polls with a persistent filtered subscription and tracks since', async () => {
    syncthingServiceMock.getEvents.onFirstCall().resolves(eventsResponse([
      { id: 5, time: '2026-06-12T10:00:00Z', type: 'FolderSummary', data: { folder: 'fluxcomp_app1', summary: {} } },
      { id: 6, time: '2026-06-12T10:00:01Z', type: 'StateChanged', data: { folder: 'fluxcomp_app1', to: 'idle' } },
    ]));
    syncthingServiceMock.getEvents.onSecondCall().callsFake(parkForever);

    consumer.start({ onFolderActivity, onResync });
    await new Promise((resolve) => { setImmediate(() => { setImmediate(resolve); }); });

    // both events surfaced for the same folder
    sinon.assert.calledWith(onFolderActivity, 'fluxcomp_app1', 'FolderSummary');
    sinon.assert.calledWith(onFolderActivity, 'fluxcomp_app1', 'StateChanged');
    // the second poll continues from the last seen id
    const secondCallQuery = syncthingServiceMock.getEvents.secondCall.args[0].query;
    expect(secondCallQuery.since).to.equal(6);
  });

  it('treats an id regression (syncthing restart) as a resync signal', async () => {
    syncthingServiceMock.getEvents.onFirstCall().resolves(eventsResponse([
      { id: 100, time: 't', type: 'FolderSummary', data: { folder: 'fluxa', summary: {} } },
    ]));
    // ids reset: next batch starts at 1
    syncthingServiceMock.getEvents.onSecondCall().resolves(eventsResponse([
      { id: 1, time: 't', type: 'FolderSummary', data: { folder: 'fluxa', summary: {} } },
    ]));
    syncthingServiceMock.getEvents.onThirdCall().callsFake(parkForever);

    consumer.start({ onFolderActivity, onResync });
    await new Promise((resolve) => { setImmediate(() => { setImmediate(() => { setImmediate(resolve); }); }); });

    sinon.assert.calledOnce(onResync);
    // since continues from the new stream's last id
    const thirdCallQuery = syncthingServiceMock.getEvents.thirdCall.args[0].query;
    expect(thirdCallQuery.since).to.equal(1);
  });

  it('treats a gap in event ids (buffer overflow) as a resync signal', async () => {
    syncthingServiceMock.getEvents.onFirstCall().resolves(eventsResponse([
      { id: 10, time: 't', type: 'FolderSummary', data: { folder: 'fluxa', summary: {} } },
    ]));
    // events 11-49 were lost to the finite buffer
    syncthingServiceMock.getEvents.onSecondCall().resolves(eventsResponse([
      { id: 50, time: 't', type: 'FolderSummary', data: { folder: 'fluxa', summary: {} } },
    ]));
    syncthingServiceMock.getEvents.onThirdCall().callsFake(parkForever);

    consumer.start({ onFolderActivity, onResync });
    await new Promise((resolve) => { setImmediate(() => { setImmediate(() => { setImmediate(resolve); }); }); });

    sinon.assert.calledOnce(onResync);
  });

  it('retries with a backoff delay when the events endpoint fails (degrades to the poll, never breaks)', async () => {
    syncthingServiceMock.getEvents.onFirstCall().rejects(new Error('socket hang up'));
    syncthingServiceMock.getEvents.onSecondCall().callsFake(parkForever);

    consumer.start({ onFolderActivity, onResync });
    await new Promise((resolve) => { setImmediate(() => { setImmediate(resolve); }); });

    sinon.assert.calledOnce(serviceHelperMock.delay);
    sinon.assert.calledTwice(syncthingServiceMock.getEvents);
    sinon.assert.notCalled(onFolderActivity);
  });

  it('keeps FolderErrors events as the durable per-folder error record', async () => {
    // scans wipe /rest/folder/errors and pullErrors (verified live) - the event
    // stream is the only durable record of pull failures
    const errors = [{ path: 'big.bin', error: 'insufficient space' }];
    syncthingServiceMock.getEvents.onFirstCall().resolves(eventsResponse([
      { id: 7, time: '2026-06-12T10:00:00Z', type: 'FolderErrors', data: { folder: 'fluxcomp_app1', errors } },
    ]));
    syncthingServiceMock.getEvents.onSecondCall().callsFake(parkForever);

    consumer.start({ onFolderActivity, onResync });
    await new Promise((resolve) => { setImmediate(() => { setImmediate(resolve); }); });

    const record = consumer.getFolderErrors('fluxcomp_app1');
    expect(record.errors).to.deep.equal(errors);
    sinon.assert.calledWith(fluxEventBusMock.publish, 'syncthing:folderErrors', sinon.match({ folder: 'fluxcomp_app1' }));
  });

  it('paces itself when the events endpoint returns empty instantly (never hot-loops)', async () => {
    // a real syncthing long-poll holds the request for the timeout; a fast-
    // returning server (misconfiguration, harness stub) must not turn the loop
    // into a tight spin - an empty poll that returns immediately is followed by
    // a pacing delay before the next poll
    syncthingServiceMock.getEvents.onFirstCall().resolves(eventsResponse([]));
    syncthingServiceMock.getEvents.onSecondCall().callsFake(parkForever);

    consumer.start({ onFolderActivity, onResync });
    await new Promise((resolve) => { setImmediate(() => { setImmediate(resolve); }); });

    sinon.assert.calledOnce(serviceHelperMock.delay);
    sinon.assert.calledTwice(syncthingServiceMock.getEvents);
  });

  it('stop() halts the loop and start() is idempotent while running', async () => {
    syncthingServiceMock.getEvents.callsFake(parkForever);

    consumer.start({ onFolderActivity, onResync });
    consumer.start({ onFolderActivity, onResync }); // second start must not spawn a second loop
    await new Promise((resolve) => { setImmediate(resolve); });

    sinon.assert.calledOnce(syncthingServiceMock.getEvents);

    await consumer.stop();
    expect(consumer.isRunning()).to.equal(false);
  });
});
