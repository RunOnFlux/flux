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
      appReconciler: { enqueue: sinon.stub(), enqueueAll: sinon.stub().resolves() },
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
        clock.tick(10000 + 1);
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
        clock.tick(10000 + 1);
        await new Promise((resolve) => { setImmediate(resolve); });
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(stubs.dockerService.dockerGetEvents.callCount, 'one outage must produce exactly one new stream').to.equal(2);
      } finally {
        containerCrashRecovery.stop();
        clock.restore();
      }
    });

    // A reconnect follows a Docker restart, which is when Docker takes up a user
    // namespace setting.
    describe('a reconnect asks whether Docker remaps container users', () => {
      async function reconnect(clock) {
        const first = makeStream();
        stubs.dockerService.dockerGetEvents.resolves(makeStream());
        stubs.dockerService.dockerGetEvents.onFirstCall().resolves(first);
        await containerCrashRecovery.start();
        first.emit('close');
        clock.tick(10000 + 1);
        await new Promise((resolve) => { setImmediate(resolve); });
        await new Promise((resolve) => { setImmediate(resolve); });
      }

      it('does not ask on the first connection', async () => {
        try {
          stubs.dockerService.dockerGetEvents.resolves(makeStream());
          await containerCrashRecovery.start();
          expect(stubs.fluxNetworkHelper.checkDockerUserNamespace.called).to.be.false;
        } finally {
          containerCrashRecovery.stop();
        }
      });

      it('asks with what Docker reports, then sweeps every component', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          await reconnect(clock);
          sinon.assert.calledOnceWithExactly(
            stubs.fluxNetworkHelper.checkDockerUserNamespace,
            ['name=apparmor', 'name=seccomp,profile=builtin', 'name=cgroupns'],
          );
          sinon.assert.calledOnceWithExactly(stubs.appReconciler.enqueueAll, 'reconnect');
        } finally {
          containerCrashRecovery.stop();
          clock.restore();
        }
      });

      it('rebuilds nothing under a Docker that now remaps', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          stubs.dockerService.dockerInfo.resolves({ SecurityOptions: ['name=userns'] });
          stubs.fluxNetworkHelper.checkDockerUserNamespace.returns(false);
          await reconnect(clock);
          sinon.assert.calledOnceWithExactly(stubs.fluxNetworkHelper.checkDockerUserNamespace, ['name=userns']);
          expect(stubs.appReconciler.enqueueAll.called).to.be.false;
        } finally {
          containerCrashRecovery.stop();
          clock.restore();
        }
      });

      it('passes null when Docker does not answer', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          stubs.dockerService.dockerInfo.rejects(new Error('connect ENOENT /var/run/docker.sock'));
          await reconnect(clock);
          sinon.assert.calledOnceWithExactly(stubs.fluxNetworkHelper.checkDockerUserNamespace, null);
        } finally {
          containerCrashRecovery.stop();
          clock.restore();
        }
      });
    });
  });
});
