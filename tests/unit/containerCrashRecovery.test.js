const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('containerCrashRecovery die bridge', () => {
  let stubs;
  let containerCrashRecovery;

  beforeEach(() => {
    stubs = {
      log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      dockerService: { dockerGetEvents: sinon.stub() },
      globalState: { stoppingContainers: new Set(), bootContainerStateSettled: true },
      appsRuntimeState: { recordExit: sinon.stub().resolves() },
      appReconciler: { enqueue: sinon.stub(), enqueueAll: sinon.stub().resolves() },
    };
    containerCrashRecovery = proxyquire('../../ZelBack/src/services/appMonitoring/containerCrashRecovery', {
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

  it('enqueues a reconcile for a flux container crash die', async () => {
    await containerCrashRecovery.handleContainerDie(dieEvent('fluxwww_app', 137));
    expect(stubs.appReconciler.enqueue.calledOnceWith('www_app')).to.be.true;
    expect(stubs.appsRuntimeState.recordExit.calledOnce).to.be.true;
  });

  it('consumes the stoppingContainers flag and does NOT reconcile a deliberate-stop die', async () => {
    stubs.globalState.stoppingContainers.add('fluxwww_app'); // marked by appDockerStop
    await containerCrashRecovery.handleContainerDie(dieEvent('fluxwww_app', 0));
    // flag consumed (so no perpetual reconcile-defer loop) and no reconcile enqueued
    expect(stubs.globalState.stoppingContainers.has('fluxwww_app')).to.be.false;
    expect(stubs.appReconciler.enqueue.called).to.be.false;
    expect(stubs.appsRuntimeState.recordExit.called).to.be.false;
  });

  it('ignores non-flux containers', async () => {
    await containerCrashRecovery.handleContainerDie(dieEvent('some_other_container'));
    expect(stubs.appReconciler.enqueue.called).to.be.false;
    expect(stubs.appsRuntimeState.recordExit.called).to.be.false;
  });
});
