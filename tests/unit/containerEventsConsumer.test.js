const { expect } = require('chai');
const sinon = require('sinon');
const { resetGlobalState } = require('./fixtures/globalState');
const proxyquire = require('proxyquire').noCallThru();
const { EventEmitter } = require('node:events');

describe('containerEventsConsumer die bridge', () => {
  let stubs;
  let containerEventsConsumer;

  beforeEach(() => {
    stubs = {
      log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      dockerService: { dockerGetEvents: sinon.stub() },
      globalState: (() => {
        const state = resetGlobalState();
        state.bootContainerStateSettled = true;
        return state;
      })(),
      appsRuntimeState: { recordExit: sinon.stub().resolves(), recordStopRequested: sinon.stub().resolves() },
      appReconciler: { enqueue: sinon.stub(), enqueueAll: sinon.stub().resolves() },
    };
    containerEventsConsumer = proxyquire('../../ZelBack/src/services/appMonitoring/containerEventsConsumer', {
      '../../lib/log': stubs.log,
      '../dockerService': stubs.dockerService,
      '../utils/globalState': stubs.globalState,
      '../appManagement/appsRuntimeState': stubs.appsRuntimeState,
      './appReconciler': stubs.appReconciler,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  const dieEvent = (name, exitCode = 1) => ({ Actor: { Attributes: { name, exitCode: String(exitCode) } } });

  it('enqueues a reconcile for a flux container crash die (raw name; the reconciler canonicalises)', async () => {
    await containerEventsConsumer.handleContainerDie(dieEvent('fluxwww_app', 137));
    // pass the RAW container name - enqueue/recordExit canonicalise to the bare
    // component id (one strip, in one place), exactly like every other enqueue caller
    expect(stubs.appReconciler.enqueue.calledOnceWith('fluxwww_app')).to.be.true;
    expect(stubs.appsRuntimeState.recordExit.calledOnceWith('fluxwww_app')).to.be.true;
  });

  it('does NOT reconcile a deliberate-stop die while the stop operation holds the flag', async () => {
    stubs.globalState.stoppingContainers.add('fluxwww_app'); // held by an in-flight appDockerStop
    await containerEventsConsumer.handleContainerDie(dieEvent('fluxwww_app', 0));
    expect(stubs.appReconciler.enqueue.called).to.be.false;
    expect(stubs.appsRuntimeState.recordExit.called).to.be.false;
    // the flag is OWNED by the stop operation (cleared in its finally), not by
    // this event - the handler must not clear it out from under the operation
    expect(stubs.globalState.stoppingContainers.has('fluxwww_app')).to.be.true;
  });

  it('ignores non-flux containers', async () => {
    await containerEventsConsumer.handleContainerDie(dieEvent('some_other_container'));
    expect(stubs.appReconciler.enqueue.called).to.be.false;
    expect(stubs.appsRuntimeState.recordExit.called).to.be.false;
  });

  // A stop asked of a container is recorded at Docker's own time for it: the
  // reconciler compares it with the container's StartedAt to tell a run that was
  // stopped from one that died, since both can exit 137.
  describe('stop requests', () => {
    // the line as Docker writes it: timeNano is past JavaScript's exact integers,
    // and parsing it loses nanoseconds, never milliseconds
    const stopLine = (name) => `{"Action":"stop","time":1794925851,"timeNano":1794925851505123456,"Actor":{"Attributes":{"name":"${name}"}}}\n`;

    it('subscribes to stop events beside die events, and records each stop at Docker\'s time without a reconcile', async () => {
      const stream = new EventEmitter();
      stream.destroy = sinon.stub();
      stubs.dockerService.dockerGetEvents.resolves(stream);
      try {
        await containerEventsConsumer.start();
        expect(stubs.dockerService.dockerGetEvents.firstCall.args[0].filters.event).to.have.members(['die', 'stop']);

        stream.emit('data', Buffer.from(stopLine('fluxwww_app')));
        await new Promise((resolve) => { setImmediate(resolve); });

        sinon.assert.calledOnceWithExactly(stubs.appsRuntimeState.recordStopRequested, 'fluxwww_app', 1794925851505);
        expect(stubs.appReconciler.enqueue.called, 'a stop is followed by its die, which reconciles').to.be.false;

        stream.emit('data', Buffer.from(`${JSON.stringify({ Action: 'die', ...dieEvent('fluxwww_app', 137) })}\n`));
        await new Promise((resolve) => { setImmediate(resolve); });
        sinon.assert.calledOnceWithExactly(stubs.appReconciler.enqueue, 'fluxwww_app');
      } finally {
        containerEventsConsumer.stop();
      }
    });

    it('ignores the stop of a container that is not Flux\'s', async () => {
      await containerEventsConsumer.handleContainerStop(JSON.parse(stopLine('some_other_container')));
      sinon.assert.notCalled(stubs.appsRuntimeState.recordStopRequested);
    });
  });

  // The event stream is the reconciler's primary trigger; losing it silently
  // means crashes go unnoticed until the hourly sweep. Every way the stream
  // can die must lead to exactly ONE resubscribe: 'close' can fire without
  // 'error'/'end' (raw socket teardown), and one outage firing several of the
  // signals must not double the stream (each duplicate doubles every die
  // event's handling from then on).
  describe('event stream lifecycle', () => {
    const makeStream = () => {
      const stream = new EventEmitter();
      stream.destroy = sinon.stub();
      return stream;
    };

    it('resubscribes when the stream closes without error or end', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        const first = makeStream();
        stubs.dockerService.dockerGetEvents.resolves(makeStream());
        stubs.dockerService.dockerGetEvents.onFirstCall().resolves(first);
        await containerEventsConsumer.start();
        expect(stubs.dockerService.dockerGetEvents.callCount).to.equal(1);

        first.emit('close');
        clock.tick(10000 + 1);
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(stubs.dockerService.dockerGetEvents.callCount, 'a closed stream must be resubscribed').to.equal(2);
      } finally {
        containerEventsConsumer.stop();
        clock.restore();
      }
    });

    it('collapses error+end+close from one outage into a single resubscribe', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        const first = makeStream();
        stubs.dockerService.dockerGetEvents.resolves(makeStream());
        stubs.dockerService.dockerGetEvents.onFirstCall().resolves(first);
        await containerEventsConsumer.start();

        first.emit('error', new Error('stream died'));
        first.emit('end');
        first.emit('close');
        clock.tick(10000 + 1);
        await new Promise((resolve) => { setImmediate(resolve); });
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(stubs.dockerService.dockerGetEvents.callCount, 'one outage must produce exactly one new stream').to.equal(2);
      } finally {
        containerEventsConsumer.stop();
        clock.restore();
      }
    });
  });
});
