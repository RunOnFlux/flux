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
  getMyFluxIPandPort: sinon.stub(),
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
  ensureStfolderExists: sinon.stub().resolves(),
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
  decryptEnterpriseApps: sinon.stub().returnsArg(0), // Return apps as-is by default
};

// Load module with mocked dependencies
const syncthingMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/syncthingMonitor', {
  '../dbHelper': dbHelperMock,
  '../serviceHelper': serviceHelperMock,
  '../dockerService': dockerServiceMock,
  '../fluxNetworkHelper': fluxNetworkHelperMock,
  '../syncthingService': syncthingServiceMock,
  '../appQuery/appQueryService': appQueryServiceMock,
  './syncthingFolderStateMachine': syncthingFolderStateMachineMock,
  './syncthingMonitorHelpers': syncthingMonitorHelpersMock,
  './syncthingHealthMonitor': syncthingHealthMonitorMock,
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
    fluxNetworkHelperMock.getMyFluxIPandPort.reset();
    dockerServiceMock.dockerContainerInspect.reset();
    dockerServiceMock.appDockerStart.reset();
    syncthingHealthMonitorMock.monitorFolderHealth.reset();

    // Default stub behaviors
    syncthingServiceMock.getConfigFolders.resolves({ data: [] });
    syncthingServiceMock.getConfigDevices.resolves({ data: [] });
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
      fluxNetworkHelperMock.getMyFluxIPandPort.resolves('10.0.0.1:16127');

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
      fluxNetworkHelperMock.getMyFluxIPandPort.resolves('10.0.0.1:16127');

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

    it('should prevent overlapping executions', async () => {
      let resolveFirst;
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      mockInstalledAppsFn.onFirstCall().returns(firstPromise);
      mockInstalledAppsFn.onSecondCall().resolves({ status: 'success', data: [] });

      syncthingServiceMock.getDeviceId.resolves('DEVICE-ID');
      fluxNetworkHelperMock.getMyFluxIPandPort.resolves('10.0.0.1:16127');

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
      fluxNetworkHelperMock.getMyFluxIPandPort.resolves('10.0.0.1:16127');

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
});
