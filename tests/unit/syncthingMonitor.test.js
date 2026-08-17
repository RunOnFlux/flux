// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// Create mocks for all dependencies
const dbHelperMock = {
  databaseConnection: sinon.stub(),
  findInDatabase: sinon.stub(),
};

const serviceHelperMock = {
  delay: sinon.stub().resolves(),
};

const dockerServiceMock = {
  getAppIdentifier: sinon.stub((id) => id),
  dockerContainerInspect: sinon.stub(),
  appDockerStart: sinon.stub(),
};

const fluxNetworkHelperMock = {
  getLocalSocketAddress: sinon.stub(),
};

const syncthingServiceMock = {
  getDeviceId: sinon.stub(),
  getConfigFolders: sinon.stub(),
  getConfigDevices: sinon.stub(),
  adjustConfigDevices: sinon.stub().resolves(),
  adjustConfigFolders: sinon.stub().resolves(),
  getFolderIdErrors: sinon.stub(),
  getConfigRestartRequired: sinon.stub(),
  systemRestart: sinon.stub().resolves(),
  getDbStatus: sinon.stub(),
};

const syncthingFolderStateMachineMock = {
  manageFolderSyncState: sinon.stub().resolves({
    syncthingFolder: { type: 'sendreceive' },
    cache: null,
  }),
  getFolderSyncCompletion: sinon.stub(),
  isDesignatedLeader: sinon.stub(),
  verifyFolderMountSafety: sinon.stub().resolves({ isSafe: true, isMounted: true, fileCount: 1 }),
  verifySendReceiveFolderSafety: sinon.stub().resolves({ isSafe: true, isMounted: true, fileCount: 1 }),
};

const volumeServiceMock = {
  ensureAppVolumeMounted: sinon.stub().resolves({ mounted: true, alreadyMounted: true }),
};

const appReconcilerMock = {
  setControllerDesired: sinon.stub(),
};

const syncthingMonitorHelpersMock = {
  sortAndFilterLocations: sinon.stub((locs) => locs),
  buildDeviceConfiguration: sinon.stub().resolves([]),
  createSyncthingFolderConfig: sinon.stub((id, label, path, devices, type) => ({
    id,
    label,
    path,
    devices,
    type: type || 'sendreceive',
  })),
  ensureStfolderExists: sinon.stub().resolves(true),
  ensureStignoreCovers: sinon.stub().resolves(),
  getContainerFolderPath: sinon.stub().returns(''),
  getContainerDataFlags: sinon.stub().returns(''),
  requiresSyncing: sinon.stub().returns(false),
  folderNeedsUpdate: sinon.stub().returns(false),
};

const syncthingHealthMonitorMock = {
  monitorFolderHealth: sinon.stub().resolves({
    actions: [],
    summary: { healthy: 0, warnings: 0, issues: 0 },
  }),
};

const appQueryServiceMock = {
  // default: nothing to decrypt, so the list comes back as-is. callsFake rather
  // than returnsArg so a test can override it - sinon resolves returnsArg first
  decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
};

const syncthingEventsConsumerMock = {
  start: sinon.stub(),
  stop: sinon.stub().resolves(),
  isRunning: sinon.stub().returns(false),
  getFolderErrors: sinon.stub(),
  mountVerifyPendingIds: sinon.stub().returns([]),
  resolveMountVerify: sinon.stub(),
};

// One pass's view of its peers. The pass builds it and hands it to the state
// machine; what it asks for, and whether it asks at all, is the contract here.
const livenessMock = {
  read: sinon.stub().resolves({ reachable: true, ready: true, folders: [] }),
  prewarm: sinon.stub().resolves(),
  localConnectivity: sinon.stub().returns({ connected: true, responding: 8, total: 8 }),
};
const peerFolderLivenessMock = {
  createPeerFolderLiveness: sinon.stub().returns(livenessMock),
};

// Load module with mocked dependencies
const syncthingMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/syncthingMonitor', {
  './peerFolderLiveness': peerFolderLivenessMock,
  '../dbHelper': dbHelperMock,
  '../serviceHelper': serviceHelperMock,
  '../dockerService': dockerServiceMock,
  '../fluxNetworkHelper': fluxNetworkHelperMock,
  '../syncthingService': syncthingServiceMock,
  '../appQuery/appQueryService': appQueryServiceMock,
  '../utils/volumeService': volumeServiceMock,
  './appReconciler': appReconcilerMock,
  './syncthingFolderStateMachine': syncthingFolderStateMachineMock,
  './syncthingMonitorHelpers': syncthingMonitorHelpersMock,
  './syncthingHealthMonitor': syncthingHealthMonitorMock,
  './syncthingEventsConsumer': syncthingEventsConsumerMock,
});

describe('syncthingMonitor tests', () => {
  let mockState;
  let mockInstalledAppsFn;
  let mockGetGlobalStateFn;
  let mockAppDockerStopFn;
  let mockAppDockerRestartFn;
  let mockAppDeleteDataFn;
  let mockRemoveAppLocallyFn;
  let monitorControl;
  let clock;

  beforeEach(() => {
    mockState = {
      installationInProgress: false,
      removalInProgress: false,
      updateSyncthingRunning: false,
      backupInProgress: [],
      restoreInProgress: [],
      syncthingDevicesIDCache: new Map(),
      receiveOnlySyncthingAppsCache: new Map(),
      syncthingAppsFirstRun: false,
    };
    mockInstalledAppsFn = sinon.stub();
    mockGetGlobalStateFn = sinon.stub();
    mockAppDockerStopFn = sinon.stub().resolves();
    mockAppDockerRestartFn = sinon.stub().resolves();
    mockAppDeleteDataFn = sinon.stub().resolves();
    mockRemoveAppLocallyFn = sinon.stub().resolves();

    // Reset all mocked services
    syncthingServiceMock.getDeviceId.reset();
    syncthingServiceMock.getConfigFolders.reset();
    syncthingServiceMock.getConfigDevices.reset();
    syncthingServiceMock.adjustConfigDevices.reset();
    syncthingServiceMock.adjustConfigFolders.reset();
    syncthingServiceMock.getFolderIdErrors.reset();
    syncthingServiceMock.getConfigRestartRequired.reset();
    syncthingServiceMock.systemRestart.reset();
    fluxNetworkHelperMock.getLocalSocketAddress.reset();
    dockerServiceMock.dockerContainerInspect.reset();
    dockerServiceMock.appDockerStart.reset();
    syncthingHealthMonitorMock.monitorFolderHealth.reset();
    syncthingEventsConsumerMock.start.reset();
    syncthingEventsConsumerMock.stop.reset();
    syncthingEventsConsumerMock.stop.resolves();
    syncthingEventsConsumerMock.mountVerifyPendingIds.reset();
    syncthingEventsConsumerMock.mountVerifyPendingIds.returns([]);
    syncthingEventsConsumerMock.resolveMountVerify.reset();

    volumeServiceMock.ensureAppVolumeMounted.reset();
    volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: true, alreadyMounted: true });
    appReconcilerMock.setControllerDesired.reset();
    syncthingFolderStateMachineMock.verifyFolderMountSafety.reset();
    syncthingFolderStateMachineMock.verifyFolderMountSafety.resolves({ isSafe: true, isMounted: true, fileCount: 1 });
    syncthingFolderStateMachineMock.manageFolderSyncState.reset();
    syncthingFolderStateMachineMock.manageFolderSyncState.resolves({
      syncthingFolder: { type: 'sendreceive' },
      cache: null,
    });

    // the sync-flag and mount-marker reads a test means to control: reset() wipes
    // behaviour as well as history, so each default is restored here
    syncthingMonitorHelpersMock.requiresSyncing.reset();
    syncthingMonitorHelpersMock.requiresSyncing.returns(false);
    syncthingMonitorHelpersMock.getContainerDataFlags.reset();
    syncthingMonitorHelpersMock.getContainerDataFlags.returns('');
    syncthingMonitorHelpersMock.ensureStfolderExists.reset();
    syncthingMonitorHelpersMock.ensureStfolderExists.resolves(true);
    syncthingMonitorHelpersMock.ensureStignoreCovers.reset();
    syncthingMonitorHelpersMock.ensureStignoreCovers.resolves();

    appQueryServiceMock.decryptEnterpriseApps.reset();
    appQueryServiceMock.decryptEnterpriseApps.callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps }));

    livenessMock.prewarm.reset();
    livenessMock.prewarm.resolves();
    peerFolderLivenessMock.createPeerFolderLiveness.resetHistory();
    dbHelperMock.databaseConnection.reset();
    dbHelperMock.findInDatabase.reset();

    // Default stub behaviors
    syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [] });
    syncthingServiceMock.getConfigDevices.resolves({ status: 'success', data: [] });
    syncthingServiceMock.getConfigRestartRequired.resolves({
      status: 'success',
      data: { requiresRestart: false },
    });
    syncthingHealthMonitorMock.monitorFolderHealth.resolves({
      actions: [],
      summary: { healthy: 0, warnings: 0, issues: 0 },
    });

    // Use fake timers to control setInterval
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    // Stop monitoring service if running
    if (monitorControl && monitorControl.isActive()) {
      monitorControl.stop();
    }
    clock.restore();
  });

  describe('syncthingApps tests', () => {
    it('should return control object with stop and isActive methods', () => {
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );

      expect(monitorControl).to.have.property('stop').that.is.a('function');
      expect(monitorControl).to.have.property('isActive').that.is.a('function');
      expect(monitorControl.isActive()).to.be.true;
    });

    it('should stop monitoring when stop is called', () => {
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );

      expect(monitorControl.isActive()).to.be.true;
      monitorControl.stop();
      expect(monitorControl.isActive()).to.be.false;
    });

    it('should not run if installation in progress', async () => {
      mockState.installationInProgress = true;
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );

      // Wait for first execution to complete
      await clock.tickAsync(100);

      sinon.assert.notCalled(mockInstalledAppsFn);
      expect(mockState.updateSyncthingRunning).to.be.false;
    });

    it('should not run if removal in progress', async () => {
      mockState.removalInProgress = true;
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );

      // Wait for first execution to complete
      await clock.tickAsync(100);

      sinon.assert.notCalled(mockInstalledAppsFn);
      expect(mockState.updateSyncthingRunning).to.be.false;
    });

    it('should not run if already running', async () => {
      mockState.updateSyncthingRunning = true;
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );

      // Wait for first execution to complete
      await clock.tickAsync(100);

      sinon.assert.notCalled(mockInstalledAppsFn);
    });

    it('should switch unsafe-mount folders to receiveonly on first run WITHOUT restarting syncthing', async () => {
      // The receiveonly PATCH applies live on syncthing v2 (verified against the
      // fleet's v2.0.x) - a process restart here drops every folder's transfers
      // and delays startup by 5s for nothing.
      mockState.syncthingAppsFirstRun = true;
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');
      syncthingServiceMock.getConfigFolders.resolves({
        status: 'success',
        data: [{ id: 'fluxcomp_testapp', path: '/apps/fluxcomp_testapp', type: 'sendreceive' }],
      });
      syncthingServiceMock.adjustConfigFolders.resolves(); // beforeEach reset() wipes behavior; restore it
      syncthingFolderStateMachineMock.verifySendReceiveFolderSafety.resolves({ isSafe: false, reason: 'not mounted' });

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );
      await clock.tickAsync(10000);

      sinon.assert.calledWithExactly(syncthingServiceMock.adjustConfigFolders, 'patch', { type: 'receiveonly' }, 'fluxcomp_testapp');
      sinon.assert.notCalled(syncthingServiceMock.systemRestart);

      syncthingFolderStateMachineMock.verifySendReceiveFolderSafety.resolves({ isSafe: true, isMounted: true, fileCount: 1 });
    });

    it('demotes a sendreceive folder over an unrepairable mount while skipping the cycle, and resolves the flag', async function () {
      // syncthing raised FolderErrors for the folder (storage went bad), the
      // repair fails (no backing image) -> the cycle is skipped, but a folder
      // left sendreceive over the bad mount could still broadcast its disk
      // state - it must be demoted and its container held before bailing.
      // The demotion is patched directly, no config pre-read: the safety
      // action is never conditioned on a read that could silently fail.
      mockInstalledAppsFn.resolves({
        status: 'success',
        data: [{ name: 'testapp', version: 3, containerData: 'g:/appdata' }],
      });
      syncthingEventsConsumerMock.mountVerifyPendingIds.returns(['testapp']);
      syncthingFolderStateMachineMock.verifyFolderMountSafety.resolves({ isSafe: false, isMounted: false, reason: 'unmounted_with_content' });
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: false, reason: 'volume_file_missing' });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
      );
      await clock.tickAsync(100);

      sinon.assert.calledWithExactly(syncthingServiceMock.adjustConfigFolders, 'patch', { type: 'receiveonly' }, 'testapp');
      sinon.assert.calledWith(appReconcilerMock.setControllerDesired, 'testapp', 'stopped');
      // the action completed - only now is the flag resolved
      sinon.assert.calledWithExactly(syncthingEventsConsumerMock.resolveMountVerify, 'testapp');
      // the cycle itself was skipped - per-app processing never ran
      sinon.assert.notCalled(syncthingServiceMock.getDeviceId);
    });

    it('keeps the flag standing when the demotion fails, so the next pass retries', async function () {
      // the exact defect class this design exists for: the one pass with the
      // signal hits a transient failure - under the old drained-edge contract
      // the signal was already consumed and the demotion was permanently
      // missed, silently
      mockInstalledAppsFn.resolves({
        status: 'success',
        data: [{ name: 'testapp', version: 3, containerData: 'g:/appdata' }],
      });
      syncthingEventsConsumerMock.mountVerifyPendingIds.returns(['testapp']);
      syncthingFolderStateMachineMock.verifyFolderMountSafety.resolves({ isSafe: false, isMounted: false, reason: 'unmounted_with_content' });
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: false, reason: 'volume_file_missing' });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'error', data: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:8384' } });

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
      );
      await clock.tickAsync(100);

      sinon.assert.notCalled(syncthingEventsConsumerMock.resolveMountVerify);
      sinon.assert.notCalled(appReconcilerMock.setControllerDesired);
    });

    it('resolves a flagged component that does not sync when syncthing has no such folder', async function () {
      // no installed component owns this folder id (the primary mount carries
      // no g:/r:/s: flag), so the 4xx confirms there is nothing to demote and
      // nothing left to act on
      mockInstalledAppsFn.resolves({
        status: 'success',
        data: [{ name: 'testapp', version: 3, containerData: 'g:/appdata' }],
      });
      syncthingEventsConsumerMock.mountVerifyPendingIds.returns(['testapp']);
      syncthingFolderStateMachineMock.verifyFolderMountSafety.resolves({ isSafe: false, isMounted: false, reason: 'unmounted_with_content' });
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: false, reason: 'volume_file_missing' });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'error', data: { code: 'ERR_BAD_REQUEST', name: 'AxiosError', message: 'Request failed with status code 404' } });

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
      );
      await clock.tickAsync(100);

      sinon.assert.calledWithExactly(syncthingEventsConsumerMock.resolveMountVerify, 'testapp');
      sinon.assert.notCalled(appReconcilerMock.setControllerDesired);
    });

    it('resolves the flag when the folder verifies safe, and processing continues', async function () {
      mockInstalledAppsFn.resolves({
        status: 'success',
        data: [{ name: 'testapp', version: 3, containerData: 'g:/appdata' }],
      });
      syncthingEventsConsumerMock.mountVerifyPendingIds.returns(['testapp']);
      syncthingFolderStateMachineMock.verifyFolderMountSafety.resolves({ isSafe: true, isMounted: true, fileCount: 3 });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
      );
      await clock.tickAsync(100);

      sinon.assert.calledWithExactly(syncthingEventsConsumerMock.resolveMountVerify, 'testapp');
      sinon.assert.notCalled(syncthingServiceMock.adjustConfigFolders);
      // the cycle was NOT skipped
      sinon.assert.called(syncthingServiceMock.getDeviceId);
    });

    it('resolves a flagged folder no installed app carries', async function () {
      mockInstalledAppsFn.resolves({
        status: 'success',
        data: [{ name: 'testapp', version: 3, containerData: 'g:/appdata' }],
      });
      syncthingEventsConsumerMock.mountVerifyPendingIds.returns(['ghostfolder']);
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
      );
      await clock.tickAsync(100);

      sinon.assert.calledWithExactly(syncthingEventsConsumerMock.resolveMountVerify, 'ghostfolder');
    });

    it('should start the events consumer (edge accelerator) and stop it on shutdown', async () => {
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );

      sinon.assert.calledOnce(syncthingEventsConsumerMock.start);
      const handlers = syncthingEventsConsumerMock.start.firstCall.args[0];
      expect(handlers.onFolderActivity).to.be.a('function');
      expect(handlers.onResync).to.be.a('function');

      monitorControl.stop();
      sinon.assert.calledOnce(syncthingEventsConsumerMock.stop);
    });

    it('should run an early evaluation for a folder in active transition', async () => {
      // events never decide anything - they only run the SAME monitoring pass
      // earlier than the interval would, and only for folders the state
      // machine is actively transitioning
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');
      mockState.receiveOnlySyncthingAppsCache.set('fluxcomp_app1', { numberOfExecutions: 3 });

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );
      await clock.tickAsync(100); // initial run completes
      const runsAfterStart = mockInstalledAppsFn.callCount;

      const handlers = syncthingEventsConsumerMock.start.firstCall.args[0];
      handlers.onFolderActivity('fluxcomp_app1', 'FolderSummary');
      handlers.onFolderActivity('fluxcomp_app1', 'StateChanged'); // coalesces

      // a continuous event stream must not drive back-to-back passes: nothing
      // fires before the min gap from the last completed pass
      await clock.tickAsync(2500);
      expect(mockInstalledAppsFn.callCount).to.equal(runsAfterStart);

      // past the min gap, before the interval
      await clock.tickAsync(8500);
      expect(mockInstalledAppsFn.callCount).to.equal(runsAfterStart + 1);
    });

    it('does not sweep mounts in steady state (no FolderErrors, not first run)', async () => {
      // an unsafe mount exists, but nothing flagged it - the steady-state pass
      // must not go looking: syncthing's .stfolder marker converts real
      // storage loss into FolderErrors, which is the only trigger
      mockInstalledAppsFn.resolves({
        status: 'success',
        data: [{ name: 'testapp', version: 3, containerData: 'g:/appdata' }],
      });
      syncthingFolderStateMachineMock.verifyFolderMountSafety.resolves({ isSafe: false, isMounted: false, reason: 'empty_unmounted_directory' });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'testapp', type: 'sendreceive' }] });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
      );
      await clock.tickAsync(100);

      sinon.assert.notCalled(syncthingFolderStateMachineMock.verifyFolderMountSafety);
      sinon.assert.neverCalledWith(syncthingServiceMock.adjustConfigFolders, 'patch', { type: 'receiveonly' }, 'testapp');
      // and the pass itself proceeded - it was not skipped
      sinon.assert.called(syncthingServiceMock.getDeviceId);
    });

    it('should NOT accelerate on activity from steady-state folders', async () => {
      // a healthy folder (synced, or simply a busy app writing into it) emits
      // events continuously - those belong to the level pass, never the
      // accelerator, or a busy g: app degenerates the 30s cadence into
      // back-to-back full passes
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');
      // a completed transition (restarted) is steady state too
      mockState.receiveOnlySyncthingAppsCache.set('fluxcomp_done', { restarted: true });

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );
      await clock.tickAsync(100); // initial run completes
      const runsAfterStart = mockInstalledAppsFn.callCount;

      const handlers = syncthingEventsConsumerMock.start.firstCall.args[0];
      handlers.onFolderActivity('fluxcomp_untracked', 'FolderSummary');
      handlers.onFolderActivity('fluxcomp_done', 'FolderSummary');
      handlers.onFolderActivity('fluxcomp_done', 'StateChanged');

      await clock.tickAsync(15000); // well past debounce and min gap

      expect(mockInstalledAppsFn.callCount).to.equal(runsAfterStart);
    });

    it('should accelerate on FolderErrors regardless of folder state', async () => {
      // FolderErrors is syncthing's own storage-went-bad signal (e.g. the
      // .stfolder marker vanished with its mount) - always worth an early pass
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );
      await clock.tickAsync(100); // initial run completes
      const runsAfterStart = mockInstalledAppsFn.callCount;

      const handlers = syncthingEventsConsumerMock.start.firstCall.args[0];
      handlers.onFolderActivity('fluxcomp_untracked', 'FolderErrors');

      await clock.tickAsync(11000);

      expect(mockInstalledAppsFn.callCount).to.equal(runsAfterStart + 1);
    });

    it('should prevent overlapping executions', async () => {
      let resolveFirst;
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      mockInstalledAppsFn.onFirstCall().returns(firstPromise);
      mockInstalledAppsFn.onSecondCall().resolves({ status: 'success', data: [] });

      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );

      // First execution starts immediately
      await clock.tickAsync(1);

      // Advance to next interval while first is still running
      await clock.tickAsync(30000);

      // First execution still not complete - should skip second call
      expect(mockInstalledAppsFn.callCount).to.equal(1);

      // Complete first execution
      resolveFirst({ status: 'success', data: [] });
      // Give time for all async operations in the promise chain to complete
      await clock.tickAsync(100);

      // Now advance to next interval - should execute again
      await clock.tickAsync(30000);
      await clock.tickAsync(100);

      expect(mockInstalledAppsFn.callCount).to.be.greaterThan(1);
    });

    it('should run at regular intervals', async () => {
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');

      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
        mockAppDockerStopFn,
        mockAppDockerRestartFn,
        mockAppDeleteDataFn,
        mockRemoveAppLocallyFn,
      );

      // Wait for first execution to complete
      await clock.tickAsync(100);
      const firstCallCount = mockInstalledAppsFn.callCount;

      // Advance to next interval and let it complete
      await clock.tickAsync(30000);
      await clock.tickAsync(100);

      expect(mockInstalledAppsFn.callCount).to.be.greaterThan(firstCallCount);
    });
  });

  // Peer liveness is asked once for the pass, before the folder loop, and only
  // for folders that will actually put a question to a peer. The loop is
  // sequential and an unreachable peer costs a full timeout, so asking inside it
  // multiplied that timeout by the folder count until the pass outran its own
  // interval - but a node whose synced apps are all running must still ask
  // nothing at all.
  describe('per-pass peer liveness', () => {
    const syncingApp = { name: 'testapp', version: 3, containerData: 'g:/appdata' };

    function primaryMountSyncs() {
      syncthingMonitorHelpersMock.getContainerDataFlags.returns('g');
      syncthingMonitorHelpersMock.requiresSyncing.returns(true);
    }

    function locationsAre(entries) {
      dbHelperMock.databaseConnection.returns({ db: () => ({}) });
      dbHelperMock.findInDatabase.resolves(entries);
    }

    async function runOnePass() {
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');
      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
      );
      await clock.tickAsync(100);
    }

    it('asks about no peer at all while every synced folder is already running', async () => {
      // The steady state, and the overwhelming majority of passes. A promoted
      // folder never re-enters the election, so there is nothing to ask and no
      // node on the network should see a request.
      primaryMountSyncs();
      mockState.receiveOnlySyncthingAppsCache.set('testapp', { restarted: true });
      locationsAre([{ ip: '10.0.0.2:16127' }, { ip: '10.0.0.3:16127' }]);
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });

      await runOnePass();

      sinon.assert.notCalled(livenessMock.prewarm);
    });

    it('asks about the holders of a folder still awaiting promotion', async () => {
      primaryMountSyncs();
      mockState.receiveOnlySyncthingAppsCache.set('testapp', { restarted: false });
      locationsAre([{ ip: '10.0.0.2:16127' }, { ip: '10.0.0.3:16127' }]);
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });

      await runOnePass();

      sinon.assert.calledOnce(livenessMock.prewarm);
      expect(livenessMock.prewarm.firstCall.args[0]).to.have.members(['10.0.0.2:16127', '10.0.0.3:16127']);
    });

    it('does not ask about itself', async () => {
      // This node is in its own app's location list. Probing itself proves
      // nothing and the answer is never consulted.
      primaryMountSyncs();
      mockState.receiveOnlySyncthingAppsCache.set('testapp', { restarted: false });
      locationsAre([{ ip: '10.0.0.1:16127' }, { ip: '10.0.0.2:16127' }]);
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });

      await runOnePass();

      expect(livenessMock.prewarm.firstCall.args[0]).to.deep.equal(['10.0.0.2:16127']);
    });

    it('asks once for a peer two of an app\'s folders both wait on', async () => {
      // The defect this replaces: the same holder was asked once per folder, and
      // an unreachable one charged its full timeout every time.
      primaryMountSyncs();
      const twoComponents = {
        name: 'testapp',
        version: 4,
        compose: [
          { name: 'db', containerData: 'g:/appdata' },
          { name: 'web', containerData: 'g:/appdata' },
        ],
      };
      mockState.receiveOnlySyncthingAppsCache.set('db_testapp', { restarted: false });
      mockState.receiveOnlySyncthingAppsCache.set('web_testapp', { restarted: false });
      locationsAre([{ ip: '10.0.0.2:16127' }]);
      mockInstalledAppsFn.resolves({ status: 'success', data: [twoComponents] });

      await runOnePass();

      sinon.assert.calledOnce(livenessMock.prewarm);
      expect(livenessMock.prewarm.firstCall.args[0]).to.deep.equal(['10.0.0.2:16127']);
    });

    it('asks nothing about an app suspended for backup', async () => {
      // Backup and restore rebuild their own folders; a promotion decision is not
      // being made underneath them.
      primaryMountSyncs();
      mockState.receiveOnlySyncthingAppsCache.set('testapp', { restarted: false });
      mockState.backupInProgress = ['testapp'];
      locationsAre([{ ip: '10.0.0.2:16127' }]);
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });

      await runOnePass();

      sinon.assert.notCalled(livenessMock.prewarm);
    });

    it('builds a fresh view for every pass', async () => {
      // Liveness must never outlive the pass that measured it: carried over, a
      // recovered holder stays dead and a dead one stays serving.
      primaryMountSyncs();
      mockState.receiveOnlySyncthingAppsCache.set('testapp', { restarted: false });
      locationsAre([{ ip: '10.0.0.2:16127' }]);
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });

      await runOnePass();
      const afterFirst = peerFolderLivenessMock.createPeerFolderLiveness.callCount;
      await clock.tickAsync(30000);
      await clock.tickAsync(100);

      expect(peerFolderLivenessMock.createPeerFolderLiveness.callCount).to.be.greaterThan(afterFirst);
    });
  });

  describe('ignore-policy convergence', () => {
    const syncingApp = { name: 'testapp', version: 3, containerData: 'g:/appdata' };

    it('converges the ignores of every folder it replicates, by folder id, each pass', async () => {
      // syncthing owns .stignore; the converge sets the patterns through its API
      // by folder id. The monitor pass is the one place every replicated folder
      // is visited with its mount verified and its config known.
      syncthingMonitorHelpersMock.getContainerDataFlags.returns('g');
      syncthingMonitorHelpersMock.requiresSyncing.returns(true);
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'testapp', type: 'sendreceive' }] });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      monitorControl = syncthingMonitor.syncthingApps(mockState, mockInstalledAppsFn, mockGetGlobalStateFn);
      await clock.tickAsync(100);

      sinon.assert.calledWithExactly(syncthingMonitorHelpersMock.ensureStignoreCovers, 'testapp');
    });

    it('does not converge a folder syncthing does not yet know, so the API is never asked for an unknown folder', async () => {
      // A fresh install whose folder is not yet configured: the creation-time
      // write already seeded its .stignore, so skipping is correct. Converging
      // via the API would only draw an error.
      syncthingMonitorHelpersMock.getContainerDataFlags.returns('g');
      syncthingMonitorHelpersMock.requiresSyncing.returns(true);
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [] });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      monitorControl = syncthingMonitor.syncthingApps(mockState, mockInstalledAppsFn, mockGetGlobalStateFn);
      await clock.tickAsync(100);

      sinon.assert.notCalled(syncthingMonitorHelpersMock.ensureStignoreCovers);
    });

    it('does not touch the ignore file of a folder whose volume is not mounted', async () => {
      // The same mount-safety rule as the marker: a write on the bare
      // directory lands on the host filesystem, not in the volume.
      syncthingMonitorHelpersMock.getContainerDataFlags.returns('g');
      syncthingMonitorHelpersMock.requiresSyncing.returns(true);
      syncthingMonitorHelpersMock.ensureStfolderExists.resolves(false);
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'testapp', type: 'sendreceive' }] });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      monitorControl = syncthingMonitor.syncthingApps(mockState, mockInstalledAppsFn, mockGetGlobalStateFn);
      await clock.tickAsync(100);

      sinon.assert.notCalled(syncthingMonitorHelpersMock.ensureStignoreCovers);
    });
  });

  // A syncthing folder is swept because no installed component owns it - never
  // because a pass failed to reach the component that owns it. Deleting a live
  // folder drops syncthing's whole record of the app: the index, the peer
  // devices and, on the next pass, any mount-safety demotion standing on it.
  describe('unused-folder cleanup', () => {
    const syncingApp = { name: 'testapp', version: 3, containerData: 'g:/appdata' };

    // the primary mount carries a g: flag, so the component owns its folder
    function primaryMountSyncs() {
      syncthingMonitorHelpersMock.getContainerDataFlags.returns('g');
      syncthingMonitorHelpersMock.requiresSyncing.returns(true);
    }

    async function runOnePass() {
      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getLocalSocketAddress.resolves('10.0.0.1:16127');
      monitorControl = syncthingMonitor.syncthingApps(
        mockState,
        mockInstalledAppsFn,
        mockGetGlobalStateFn,
      );
      await clock.tickAsync(100);
    }

    it('keeps the folder of a component skipped for an unmounted volume', async () => {
      // the mount-safety early return in processContainerData leaves the
      // component unprocessed for the cycle - it fires one pass after every
      // successful demotion, and the folder it belongs to is still owned
      primaryMountSyncs();
      syncthingMonitorHelpersMock.ensureStfolderExists.resolves(false);
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'testapp', type: 'sendreceive' }] });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      await runOnePass();

      sinon.assert.neverCalledWith(syncthingServiceMock.adjustConfigFolders, 'delete', undefined, 'testapp');
    });

    it('keeps the folder of a component the state machine defers on first encounter', async () => {
      // the first-encounter deferral is a "look again next pass", not a verdict
      // that the folder should not exist
      primaryMountSyncs();
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });
      syncthingFolderStateMachineMock.manageFolderSyncState.resolves({
        syncthingFolder: { id: 'testapp', type: 'sendreceive' },
        cache: { firstEncounterSkipped: true },
        skipProcessing: true,
      });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'testapp', type: 'sendreceive' }] });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      await runOnePass();

      sinon.assert.neverCalledWith(syncthingServiceMock.adjustConfigFolders, 'delete', undefined, 'testapp');
    });

    it('deletes nothing when an enterprise spec cannot be decrypted', async () => {
      // An app whose spec cannot be read says nothing about which folders it
      // owns, so its folders must not be swept - but the rest of the pass has
      // no reason to stop.
      primaryMountSyncs();
      const entapp = {
        name: 'entapp', version: 8, enterprise: 'ENCRYPTED-BLOB', compose: [],
      };
      appQueryServiceMock.decryptEnterpriseApps.callsFake(async (apps) => ({
        readable: apps.filter((app) => app !== entapp),
        unreadable: apps.filter((app) => app === entapp),
        inPlace: apps,
      }));
      mockInstalledAppsFn.resolves({ status: 'success', data: [entapp] });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'fluxweb_entapp', type: 'sendreceive' }] });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      await runOnePass();

      sinon.assert.neverCalledWith(syncthingServiceMock.adjustConfigFolders, 'delete');
    });

    it('sweeps an unowned folder while protecting one whose app could not be decrypted', async () => {
      // one opaque app costs its own folders' sweep and nothing else
      primaryMountSyncs();
      const entapp = {
        name: 'entapp', version: 8, enterprise: 'ENCRYPTED-BLOB', compose: [],
      };
      appQueryServiceMock.decryptEnterpriseApps.callsFake(async (apps) => ({
        readable: apps.filter((app) => app !== entapp),
        unreadable: apps.filter((app) => app === entapp),
        inPlace: apps,
      }));
      mockInstalledAppsFn.resolves({ status: 'success', data: [entapp] });
      syncthingServiceMock.getConfigFolders.resolves({
        status: 'success',
        data: [
          { id: 'fluxweb_entapp', type: 'sendreceive' },
          { id: 'fluxweb_goneapp', type: 'sendreceive' },
        ],
      });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      await runOnePass();

      const deletions = syncthingServiceMock.adjustConfigFolders.getCalls()
        .filter((call) => call.args[0] === 'delete')
        .map((call) => call.args[2]);
      expect(deletions).to.include('fluxweb_goneapp');
      expect(deletions).to.not.include('fluxweb_entapp');
    });

    it('raises the designation only after the folder batch is applied', async () => {
      // The state machine records intent; the flag masterSlaveApps starts
      // containers on becomes true when the promotion reaches syncthing, not
      // when it is decided - raised earlier, a primary starts against a
      // folder that is still receiveonly for as long as the apply takes.
      primaryMountSyncs();
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });
      syncthingFolderStateMachineMock.manageFolderSyncState.resolves({
        syncthingFolder: { id: 'testapp', type: 'sendreceive' },
        cache: { designationPending: true },
      });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'testapp', type: 'receiveonly' }] });
      syncthingMonitorHelpersMock.folderNeedsUpdate.returns(true);
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      await runOnePass();

      const cache = mockState.receiveOnlySyncthingAppsCache.get('testapp');
      expect(cache.designatedLeader).to.be.true;
      expect(cache.designationPending).to.not.equal(true);
    });

    it('keeps the designation as intent when the apply fails, so the retry raises it', async () => {
      primaryMountSyncs();
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });
      syncthingFolderStateMachineMock.manageFolderSyncState.resolves({
        syncthingFolder: { id: 'testapp', type: 'sendreceive' },
        cache: { designationPending: true },
      });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'testapp', type: 'receiveonly' }] });
      syncthingMonitorHelpersMock.folderNeedsUpdate.returns(true);
      syncthingServiceMock.adjustConfigFolders
        .withArgs('put', sinon.match.any).resolves({ status: 'error', data: { message: 'apply failed' } });

      await runOnePass();

      const cache = mockState.receiveOnlySyncthingAppsCache.get('testapp');
      expect(cache.designationPending).to.be.true;
      expect(cache.designatedLeader).to.not.equal(true);
    });

    it('keeps a safety flag standing when its folder belongs to an app it cannot decrypt', async () => {
      // A flag is resolved when no installed app carries its folder - the
      // uninstall already removed whatever it protected. An unreadable app
      // carries nothing either, but for a reason that says nothing about the
      // folder, so resolving there drops a live protection.
      primaryMountSyncs();
      const entapp = {
        name: 'entapp', version: 8, enterprise: 'ENCRYPTED-BLOB', compose: [],
      };
      appQueryServiceMock.decryptEnterpriseApps.callsFake(async (apps) => ({
        readable: apps.filter((app) => app !== entapp),
        unreadable: apps.filter((app) => app === entapp),
        inPlace: apps,
      }));
      mockInstalledAppsFn.resolves({ status: 'success', data: [entapp] });
      syncthingEventsConsumerMock.mountVerifyPendingIds.returns(['fluxweb_entapp']);
      syncthingFolderStateMachineMock.verifyFolderMountSafety.resolves({ isSafe: false, isMounted: false, reason: 'unmounted_with_content' });
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: false, reason: 'volume_file_missing' });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'error', data: { code: 'ERR_BAD_REQUEST', name: 'AxiosError', message: 'Request failed with status code 404' } });

      await runOnePass();

      sinon.assert.neverCalledWith(syncthingEventsConsumerMock.resolveMountVerify, 'fluxweb_entapp');
    });

    it('holds the container and keeps the flag when an owned folder is unknown to syncthing', async () => {
      // 4xx on the safety demotion of a folder an installed syncing component
      // owns is a contradiction, not a "this app does not sync": the mount is
      // still unsafe, so the container is held and the flag stays standing
      primaryMountSyncs();
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });
      syncthingEventsConsumerMock.mountVerifyPendingIds.returns(['testapp']);
      syncthingFolderStateMachineMock.verifyFolderMountSafety.resolves({ isSafe: false, isMounted: false, reason: 'unmounted_with_content' });
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: false, reason: 'volume_file_missing' });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'error', data: { code: 'ERR_BAD_REQUEST', name: 'AxiosError', message: 'Request failed with status code 404' } });

      await runOnePass();

      sinon.assert.notCalled(syncthingEventsConsumerMock.resolveMountVerify);
      sinon.assert.calledWith(appReconcilerMock.setControllerDesired, 'testapp', 'stopped');
    });

    it('deletes the folder of an installed component that no longer syncs', async () => {
      // dropping the g:/r:/s: flag from the primary mount is how an operator
      // retires a folder - the stale folder must go
      mockInstalledAppsFn.resolves({
        status: 'success',
        data: [{ name: 'testapp', version: 3, containerData: '/appdata' }],
      });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'testapp', type: 'sendreceive' }] });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      await runOnePass();

      sinon.assert.calledWithExactly(syncthingServiceMock.adjustConfigFolders, 'delete', undefined, 'testapp');
    });

    it('deletes the folder of an app that is no longer installed', async () => {
      primaryMountSyncs();
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'ghostapp', type: 'sendreceive' }] });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      await runOnePass();

      sinon.assert.calledWithExactly(syncthingServiceMock.adjustConfigFolders, 'delete', undefined, 'ghostapp');
    });

    it('deletes the folder of an app under backup', async () => {
      // backup suspends syncing by deleting the app's folders itself - the
      // monitor must not keep one alive underneath it
      primaryMountSyncs();
      mockState.backupInProgress = ['testapp'];
      mockInstalledAppsFn.resolves({ status: 'success', data: [syncingApp] });
      syncthingServiceMock.getConfigFolders.resolves({ status: 'success', data: [{ id: 'testapp', type: 'sendreceive' }] });
      syncthingServiceMock.adjustConfigFolders.resolves({ status: 'success', data: {} });

      await runOnePass();

      sinon.assert.calledWithExactly(syncthingServiceMock.adjustConfigFolders, 'delete', undefined, 'testapp');
    });
  });
});
