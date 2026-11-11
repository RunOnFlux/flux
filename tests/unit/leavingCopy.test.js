const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('leavingCopy tests', () => {
  const component = { identifier: 'web_app', folderId: 'fluxweb_app', unsyncedSubdirs: [] };
  const stoppedAt = (finishedAt) => ({
    reachable: true, exists: true, running: false, finishedAt,
  });
  let leavingCopy;
  let appReconciler;
  let syncthingService;
  let serviceHelper;
  let fluxEventBus;
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    appReconciler = {
      dockerActual: sinon.stub().resolves(stoppedAt(500)),
      holdLeavingCopy: sinon.stub().resolves(true),
      releaseLeavingCopy: sinon.stub(),
    };
    syncthingService = { scanFolder: sinon.stub().resolves({}) };
    serviceHelper = { delay: sinon.stub().callsFake(async (ms) => clock.tick(ms)) };
    fluxEventBus = { checkpoint: sinon.stub().resolves(), Checkpoint: { LEAVING_COPY_BEFORE_SCAN: 'leavingCopy:beforeScan' } };
    leavingCopy = proxyquire('../../ZelBack/src/services/appLifecycle/leavingCopy', {
      config: { syncthing: { leavingCopyWaitMs: 60000, leavingCopyPollMs: 1000 } },
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../serviceHelper': serviceHelper,
      '../utils/fluxEventBus': fluxEventBus,
      '../syncthingService': syncthingService,
      '../appMonitoring/appReconciler': appReconciler,
    });
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  it('holds the copy stopped, scans it, then proves it, in that order', async () => {
    const held = sinon.stub().resolves(true);

    const result = await leavingCopy.stopAndProve([component], held);

    expect(result).to.include({ proven: true, code: 'PROVEN' });
    sinon.assert.calledOnceWithExactly(appReconciler.holdLeavingCopy, 'web_app');
    sinon.assert.callOrder(appReconciler.holdLeavingCopy, appReconciler.dockerActual, syncthingService.scanFolder, held);
  });

  it('scans once, however long the proof takes', async () => {
    const held = sinon.stub().resolves(false);
    held.onCall(3).resolves(true);

    const result = await leavingCopy.stopAndProve([component], held);

    expect(result.proven).to.equal(true);
    sinon.assert.calledOnce(syncthingService.scanFolder);
    sinon.assert.callCount(serviceHelper.delay, 3);
  });

  it('holds every component before it scans any', async () => {
    const other = { identifier: 'db_app', folderId: 'fluxdb_app', unsyncedSubdirs: [] };

    await leavingCopy.stopAndProve([component, other], async () => true);

    sinon.assert.calledWithExactly(appReconciler.holdLeavingCopy, 'web_app');
    sinon.assert.calledWithExactly(appReconciler.holdLeavingCopy, 'db_app');
    expect(appReconciler.holdLeavingCopy.secondCall.calledBefore(syncthingService.scanFolder.firstCall)).to.equal(true);
  });

  [
    ['still running', { reachable: true, running: true }],
    ['docker unreachable', { reachable: false, running: false }],
    ['indeterminate', { reachable: true, running: false, indeterminate: true }],
  ].forEach(([name, actual]) => {
    it(`refuses before any scan when the stop is not confirmed: ${name}`, async () => {
      appReconciler.dockerActual.onCall(0).resolves(actual);

      const result = await leavingCopy.stopAndProve([component], async () => true);

      expect(result).to.include({ proven: false, code: 'COPY_NOT_STOPPED' });
      sinon.assert.notCalled(syncthingService.scanFolder);
    });
  });

  it('refuses when the scan does not finish, without asking for the proof', async () => {
    syncthingService.scanFolder.rejects(new Error('timed out'));
    const held = sinon.stub().resolves(true);

    const result = await leavingCopy.stopAndProve([component], held);

    expect(result).to.include({ proven: false, code: 'COPY_SCAN_FAILED' });
    sinon.assert.notCalled(held);
  });

  it('gives the scan only what is left of the wait', async () => {
    await leavingCopy.stopAndProve([component], async () => true);

    sinon.assert.calledOnceWithExactly(syncthingService.scanFolder, 'fluxweb_app', { timeoutMs: 60000 });
  });

  it('refuses at the deadline when no peer holds the copy', async () => {
    const result = await leavingCopy.stopAndProve([component], async () => false);

    expect(result).to.include({ proven: false, code: 'COPY_NOT_HELD' });
    expect(Date.now() - 1_000_000).to.equal(60000);
  });

  it('asks only about what is still unproven', async () => {
    const other = { identifier: 'db_app', folderId: 'fluxdb_app', unsyncedSubdirs: [] };
    appReconciler.dockerActual.reset();
    appReconciler.dockerActual.resolves(stoppedAt(500));
    const held = sinon.stub();
    held.withArgs(component).resolves(true);
    held.withArgs(other).onFirstCall().resolves(false);
    held.withArgs(other).onSecondCall().resolves(true);

    const result = await leavingCopy.stopAndProve([component, other], held);

    expect(result.proven).to.equal(true);
    sinon.assert.calledOnce(held.withArgs(component));
  });

  it('refuses a copy that ran again after its scan, though it reads stopped', async () => {
    appReconciler.dockerActual.onCall(1).resolves(stoppedAt(900));

    const result = await leavingCopy.stopAndProve([component], async () => true);

    expect(result).to.include({ proven: false, code: 'COPY_RESTARTED' });
  });

  it('refuses a copy running again at the decision', async () => {
    appReconciler.dockerActual.onCall(1).resolves({ reachable: true, running: true, finishedAt: 500 });

    const result = await leavingCopy.stopAndProve([component], async () => true);

    expect(result).to.include({ proven: false, code: 'COPY_RESTARTED' });
  });

  it('keeps the hold whatever the attempt answers: the caller ends it', async () => {
    await leavingCopy.stopAndProve([component], async () => false);

    sinon.assert.notCalled(appReconciler.releaseLeavingCopy);
  });

  it('gives back: the hold goes', async () => {
    await leavingCopy.stopAndProve([component], async () => false);

    leavingCopy.giveBack([component]);

    sinon.assert.calledOnceWithExactly(appReconciler.releaseLeavingCopy, 'web_app');
  });

  it('releases the hold of a copy that was removed', async () => {
    await leavingCopy.stopAndProve([component], async () => true);

    leavingCopy.removed([component]);

    sinon.assert.calledOnceWithExactly(appReconciler.releaseLeavingCopy, 'web_app');
  });
});
