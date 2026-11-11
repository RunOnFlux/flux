const { expect } = require('chai');
const sinon = require('sinon');
const { resetGlobalState } = require('./fixtures/globalState');
const proxyquire = require('proxyquire').noCallThru();
const { EventEmitter } = require('node:events');

describe('containerCrashRecovery die bridge', () => {
  let stubs;
  let containerCrashRecovery;

  beforeEach(() => {
    stubs = {
      log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      dockerService: {
        dockerGetEvents: sinon.stub(),
        dockerInfo: sinon.stub().resolves({ SecurityOptions: ['name=apparmor', 'name=seccomp,profile=builtin', 'name=cgroupns'] }),
      },
      fluxNetworkHelper: { checkDockerUserNamespace: sinon.stub().returns(true) },
      globalState: (() => {
        const state = resetGlobalState();
        state.bootContainerStateSettled = true;
        return state;
      })(),
      appsRuntimeState: { recordExit: sinon.stub().resolves() },
      appReconciler: {
        enqueue: sinon.stub(), enqueueAll: sinon.stub().resolves(), dockerUnwatched: sinon.stub(), dockerWatchedAgain: sinon.stub(),
      },
    };
    containerCrashRecovery = proxyquire('../../ZelBack/src/services/appMonitoring/containerCrashRecovery', {
      '../../lib/log': stubs.log,
      '../dockerService': stubs.dockerService,
      '../fluxNetworkHelper': stubs.fluxNetworkHelper,
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
    await containerCrashRecovery.handleContainerDie(dieEvent('fluxwww_app', 137));
    // pass the RAW container name - enqueue/recordExit canonicalise to the bare
    // component id (one strip, in one place), exactly like every other enqueue caller
    expect(stubs.appReconciler.enqueue.calledOnceWith('fluxwww_app')).to.be.true;
    expect(stubs.appsRuntimeState.recordExit.calledOnceWith('fluxwww_app')).to.be.true;
  });

  it('does NOT reconcile a deliberate-stop die while the stop operation holds the flag', async () => {
    stubs.globalState.stoppingContainers.add('fluxwww_app'); // held by an in-flight appDockerStop
    await containerCrashRecovery.handleContainerDie(dieEvent('fluxwww_app', 0));
    expect(stubs.appReconciler.enqueue.called).to.be.false;
    expect(stubs.appsRuntimeState.recordExit.called).to.be.false;
    // the flag is OWNED by the stop operation (cleared in its finally), not by
    // this event - the handler must not clear it out from under the operation
    expect(stubs.globalState.stoppingContainers.has('fluxwww_app')).to.be.true;
  });

  it('ignores non-flux containers', async () => {
    await containerCrashRecovery.handleContainerDie(dieEvent('some_other_container'));
    expect(stubs.appReconciler.enqueue.called).to.be.false;
    expect(stubs.appsRuntimeState.recordExit.called).to.be.false;
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
        await containerCrashRecovery.start();
        expect(stubs.dockerService.dockerGetEvents.callCount).to.equal(1);

        first.emit('close');
        clock.tick(1000 + 1);
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(stubs.dockerService.dockerGetEvents.callCount, 'a closed stream must be resubscribed').to.equal(2);
      } finally {
        containerCrashRecovery.stop();
        clock.restore();
      }
    });

    it('collapses error+end+close from one outage into a single resubscribe', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        const first = makeStream();
        stubs.dockerService.dockerGetEvents.resolves(makeStream());
        stubs.dockerService.dockerGetEvents.onFirstCall().resolves(first);
        await containerCrashRecovery.start();

        first.emit('error', new Error('stream died'));
        first.emit('end');
        first.emit('close');
        clock.tick(1000 + 1);
        await new Promise((resolve) => { setImmediate(resolve); });
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(stubs.dockerService.dockerGetEvents.callCount, 'one outage must produce exactly one new stream').to.equal(2);
      } finally {
        containerCrashRecovery.stop();
        clock.restore();
      }
    });

    describe('the stream is retried at a capped backoff', () => {
      it('retries after 1, 2, 4 and then every 5 seconds while Docker does not answer', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          const first = makeStream();
          stubs.dockerService.dockerGetEvents.rejects(new Error('connect ECONNREFUSED /var/run/docker.sock'));
          stubs.dockerService.dockerGetEvents.onFirstCall().resolves(first);
          await containerCrashRecovery.start();
          first.emit('end');
          for (const [delay, calls] of [[1000, 2], [2000, 3], [4000, 4], [5000, 5], [5000, 6]]) {
            clock.tick(delay - 1);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => { setImmediate(resolve); });
            expect(stubs.dockerService.dockerGetEvents.callCount, `not yet at ${delay}ms`).to.equal(calls - 1);
            clock.tick(1);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => { setImmediate(resolve); });
            expect(stubs.dockerService.dockerGetEvents.callCount, `retried after ${delay}ms`).to.equal(calls);
          }
        } finally {
          containerCrashRecovery.stop();
          clock.restore();
        }
      });

      it('starts again from 1 second after a subscribe succeeds', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          const first = makeStream();
          const second = makeStream();
          stubs.dockerService.dockerGetEvents.resolves(makeStream());
          stubs.dockerService.dockerGetEvents.onCall(0).resolves(first);
          stubs.dockerService.dockerGetEvents.onCall(1).rejects(new Error('connect ECONNREFUSED'));
          stubs.dockerService.dockerGetEvents.onCall(2).resolves(second);
          await containerCrashRecovery.start();
          first.emit('end');
          clock.tick(1000);
          await new Promise((resolve) => { setImmediate(resolve); });
          clock.tick(2000);
          await new Promise((resolve) => { setImmediate(resolve); });
          await new Promise((resolve) => { setImmediate(resolve); });
          expect(stubs.dockerService.dockerGetEvents.callCount).to.equal(3);
          second.emit('end');
          clock.tick(1000);
          await new Promise((resolve) => { setImmediate(resolve); });
          expect(stubs.dockerService.dockerGetEvents.callCount, 'the delay was reset by the subscribe that succeeded').to.equal(4);
        } finally {
          containerCrashRecovery.stop();
          clock.restore();
        }
      });
    });

    // The stream is a local socket that drops only when Docker stops: the reconciler
    // is held from the loss until the Docker behind the restored stream is checked.
    describe('the reconciler is held while the stream is lost', () => {
      async function loseAndRestore(clock) {
        const first = makeStream();
        stubs.dockerService.dockerGetEvents.resolves(makeStream());
        stubs.dockerService.dockerGetEvents.onFirstCall().resolves(first);
        await containerCrashRecovery.start();
        first.emit('close');
        sinon.assert.calledOnce(stubs.appReconciler.dockerUnwatched);
        clock.tick(1000);
        await new Promise((resolve) => { setImmediate(resolve); });
        await new Promise((resolve) => { setImmediate(resolve); });
      }

      it('holds nothing and checks nothing on the first connection', async () => {
        try {
          stubs.dockerService.dockerGetEvents.resolves(makeStream());
          await containerCrashRecovery.start();
          sinon.assert.notCalled(stubs.appReconciler.dockerUnwatched);
          sinon.assert.notCalled(stubs.fluxNetworkHelper.checkDockerUserNamespace);
        } finally {
          containerCrashRecovery.stop();
        }
      });

      it('checks the restored Docker, then releases the reconciler, then reconciles every component', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          await loseAndRestore(clock);
          sinon.assert.calledOnceWithExactly(
            stubs.fluxNetworkHelper.checkDockerUserNamespace,
            ['name=apparmor', 'name=seccomp,profile=builtin', 'name=cgroupns'],
          );
          sinon.assert.callOrder(
            stubs.fluxNetworkHelper.checkDockerUserNamespace,
            stubs.appReconciler.dockerWatchedAgain,
            stubs.appReconciler.enqueueAll,
          );
          sinon.assert.calledOnceWithExactly(stubs.appReconciler.enqueueAll, 'reconnect');
        } finally {
          containerCrashRecovery.stop();
          clock.restore();
        }
      });

      it('keeps the reconciler held under a Docker that now remaps', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          stubs.dockerService.dockerInfo.resolves({ SecurityOptions: ['name=userns'] });
          stubs.fluxNetworkHelper.checkDockerUserNamespace.returns(false);
          await loseAndRestore(clock);
          sinon.assert.calledOnceWithExactly(stubs.fluxNetworkHelper.checkDockerUserNamespace, ['name=userns']);
          sinon.assert.notCalled(stubs.appReconciler.dockerWatchedAgain);
          sinon.assert.notCalled(stubs.appReconciler.enqueueAll);
        } finally {
          containerCrashRecovery.stop();
          clock.restore();
        }
      });

      it('asks with null when Docker does not answer the check', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          stubs.dockerService.dockerInfo.rejects(new Error('connect ENOENT /var/run/docker.sock'));
          await loseAndRestore(clock);
          sinon.assert.calledOnceWithExactly(stubs.fluxNetworkHelper.checkDockerUserNamespace, null);
        } finally {
          containerCrashRecovery.stop();
          clock.restore();
        }
      });

      it('holds the reconciler from a first subscribe that fails until one succeeds', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          stubs.dockerService.dockerGetEvents.resolves(makeStream());
          stubs.dockerService.dockerGetEvents.onFirstCall().rejects(new Error('connect ECONNREFUSED'));
          await containerCrashRecovery.start();
          sinon.assert.calledOnce(stubs.appReconciler.dockerUnwatched);
          clock.tick(1000);
          await new Promise((resolve) => { setImmediate(resolve); });
          await new Promise((resolve) => { setImmediate(resolve); });
          sinon.assert.calledOnce(stubs.appReconciler.dockerWatchedAgain);
          sinon.assert.calledOnceWithExactly(stubs.appReconciler.enqueueAll, 'reconnect');
        } finally {
          containerCrashRecovery.stop();
          clock.restore();
        }
      });
    });
  });
});
