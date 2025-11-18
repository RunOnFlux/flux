// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// Create mocks for dependencies
const syncthingServiceMock = {
  getPeerSyncDiagnostics: sinon.stub(),
  systemRestart: sinon.stub(),
};

const logMock = {
  info: sinon.stub(),
  warn: sinon.stub(),
  error: sinon.stub(),
  debug: sinon.stub(),
};

// Mock constants
const constantsMock = {
  HEALTH_STOP_THRESHOLD_MS: 10 * 60 * 1000, // 10 minutes
  HEALTH_RESTART_SYNCTHING_THRESHOLD_MS: 20 * 60 * 1000, // 20 minutes
  HEALTH_REMOVE_THRESHOLD_MS: 30 * 60 * 1000, // 30 minutes
  HEALTH_WARNING_THRESHOLD_MS: 5 * 60 * 1000, // 5 minutes
  HEALTH_PEERS_BEHIND_THRESHOLD_MS: 15 * 60 * 1000, // 15 minutes
};

// Load module with mocked dependencies
const healthMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/syncthingHealthMonitor', {
  '../syncthingService': syncthingServiceMock,
  '../../lib/log': logMock,
  './syncthingMonitorConstants': constantsMock,
});

describe('syncthingHealthMonitor tests', () => {
  beforeEach(() => {
    // Reset all stubs before each test
    sinon.reset();
    syncthingServiceMock.getPeerSyncDiagnostics.reset();
    syncthingServiceMock.systemRestart.reset();
    logMock.info.reset();
    logMock.warn.reset();
    logMock.error.reset();
    logMock.debug.reset();
  });

  describe('extractAppNameFromFolderId', () => {
    it('should extract app name from simple folder id', () => {
      const result = healthMonitor.extractAppNameFromFolderId('fluxmyapp');
      expect(result).to.equal('myapp');
    });

    it('should extract app name from component folder id', () => {
      const result = healthMonitor.extractAppNameFromFolderId('fluxweb_myapp');
      expect(result).to.equal('myapp');
    });

    it('should handle multiple underscores in app name', () => {
      const result = healthMonitor.extractAppNameFromFolderId('fluxweb_my_app_name');
      expect(result).to.equal('my_app_name');
    });

    it('should handle empty folder id after flux prefix', () => {
      const result = healthMonitor.extractAppNameFromFolderId('flux');
      expect(result).to.equal('');
    });
  });

  describe('getOrCreateHealthStatus', () => {
    it('should create new health status when folder not in cache', () => {
      const cache = new Map();
      const result = healthMonitor.getOrCreateHealthStatus(cache, 'fluxtest');

      expect(result).to.deep.include({
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastAction: 'none',
        appWasStopped: false,
      });
      expect(result.lastHealthyTimestamp).to.be.a('number');
      expect(cache.has('fluxtest')).to.be.true;
    });

    it('should return existing health status when folder in cache', () => {
      const cache = new Map();
      const existingStatus = {
        isolatedSince: 1000,
        cannotSyncSince: 2000,
        peersBehindSince: null,
        lastHealthyTimestamp: 3000,
        lastAction: 'warning',
        appWasStopped: true,
      };
      cache.set('fluxtest', existingStatus);

      const result = healthMonitor.getOrCreateHealthStatus(cache, 'fluxtest');
      expect(result).to.equal(existingStatus);
    });
  });

  describe('resetHealthStatus', () => {
    it('should reset all health status fields except sync tracking', () => {
      const status = {
        isolatedSince: 1000,
        cannotSyncSince: 2000,
        peersBehindSince: 3000,
        lastHealthyTimestamp: 4000,
        lastAction: 'stopped',
        appWasStopped: true,
        lastSyncPercentage: 75,
      };

      healthMonitor.resetHealthStatus(status);

      expect(status.isolatedSince).to.be.null;
      expect(status.cannotSyncSince).to.be.null;
      expect(status.peersBehindSince).to.be.null;
      expect(status.lastAction).to.equal('none');
      expect(status.appWasStopped).to.be.false;
      expect(status.lastHealthyTimestamp).to.be.a('number');
      // Sync tracking fields should persist for future stall detection
      expect(status.lastSyncPercentage).to.equal(75);
    });
  });

  describe('shouldRemoveFolder', () => {
    it('should return false when folder not in cache', () => {
      const cache = new Map();
      const result = healthMonitor.shouldRemoveFolder('fluxtest', cache);
      expect(result).to.be.false;
    });

    it('should return false when no issues', () => {
      const cache = new Map();
      cache.set('fluxtest', {
        cannotSyncSince: null,
        peersBehindSince: null,
      });

      const result = healthMonitor.shouldRemoveFolder('fluxtest', cache);
      expect(result).to.be.false;
    });

    it('should return true when cannotSyncSince exceeds threshold', () => {
      const cache = new Map();
      cache.set('fluxtest', {
        cannotSyncSince: Date.now() - constantsMock.HEALTH_REMOVE_THRESHOLD_MS - 1000,
        peersBehindSince: null,
      });

      const result = healthMonitor.shouldRemoveFolder('fluxtest', cache);
      expect(result).to.be.true;
    });

    it('should return true when peersBehindSince exceeds threshold', () => {
      const cache = new Map();
      cache.set('fluxtest', {
        cannotSyncSince: null,
        peersBehindSince: Date.now() - constantsMock.HEALTH_REMOVE_THRESHOLD_MS - 1000,
      });

      const result = healthMonitor.shouldRemoveFolder('fluxtest', cache);
      expect(result).to.be.true;
    });

    it('should return false when issues are below threshold', () => {
      const cache = new Map();
      cache.set('fluxtest', {
        cannotSyncSince: Date.now() - 1000,
        peersBehindSince: Date.now() - 2000,
      });

      const result = healthMonitor.shouldRemoveFolder('fluxtest', cache);
      expect(result).to.be.false;
    });
  });

  describe('getHealthSummary', () => {
    it('should return empty summary for empty cache', () => {
      const cache = new Map();
      const result = healthMonitor.getHealthSummary(cache);

      expect(result).to.deep.equal({
        totalFolders: 0,
        healthy: 0,
        warning: 0,
        stopped: 0,
        removed: 0,
        issues: [],
      });
    });

    it('should count healthy folders', () => {
      const cache = new Map();
      cache.set('fluxtest1', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastAction: 'none',
      });
      cache.set('fluxtest2', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastAction: 'none',
      });

      const result = healthMonitor.getHealthSummary(cache);
      expect(result.totalFolders).to.equal(2);
      expect(result.healthy).to.equal(2);
      expect(result.issues).to.have.length(0);
    });

    it('should count folders by action status', () => {
      const cache = new Map();
      cache.set('fluxtest1', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastAction: 'warning',
      });
      cache.set('fluxtest2', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastAction: 'stopped',
      });
      cache.set('fluxtest3', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastAction: 'removed',
      });

      const result = healthMonitor.getHealthSummary(cache);
      expect(result.warning).to.equal(1);
      expect(result.stopped).to.equal(1);
      expect(result.removed).to.equal(1);
    });

    it('should track folders with issues', () => {
      const cache = new Map();
      cache.set('fluxtest1', {
        isolatedSince: 1000,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastAction: 'none',
      });
      cache.set('fluxtest2', {
        isolatedSince: null,
        cannotSyncSince: 2000,
        peersBehindSince: 3000,
        lastAction: 'warning',
      });

      const result = healthMonitor.getHealthSummary(cache);
      expect(result.issues).to.have.length(2);
      expect(result.issues[0].folderId).to.equal('fluxtest1');
      expect(result.issues[1].folderId).to.equal('fluxtest2');
    });
  });

  describe('monitorFolderHealth', () => {
    let mockState;
    let mockFoldersConfiguration;
    let mockFolderHealthCache;
    let mockReceiveOnlySyncthingAppsCache;
    let appDockerStopFn;
    let appDockerStartFn;
    let removeAppLocallyFn;

    beforeEach(() => {
      mockState = {
        installationInProgress: false,
        removalInProgress: false,
        softRedeployInProgress: false,
        hardRedeployInProgress: false,
        backupInProgress: [],
        restoreInProgress: [],
      };
      mockFoldersConfiguration = [];
      mockFolderHealthCache = new Map();
      mockReceiveOnlySyncthingAppsCache = new Map();
      appDockerStopFn = sinon.stub().resolves();
      appDockerStartFn = sinon.stub().resolves();
      removeAppLocallyFn = sinon.stub().resolves();
    });

    it('should skip health check when installation in progress', async () => {
      mockState.installationInProgress = true;

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.checked).to.be.false;
      expect(result.actions).to.have.length(0);
    });

    it('should skip health check when removal in progress', async () => {
      mockState.removalInProgress = true;

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.checked).to.be.false;
    });

    it('should skip health check when backup in progress', async () => {
      mockState.backupInProgress = ['someapp'];

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.checked).to.be.false;
      expect(result.actions).to.have.length(0);
    });

    it('should skip health check when restore in progress', async () => {
      mockState.restoreInProgress = ['someapp'];

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.checked).to.be.false;
      expect(result.actions).to.have.length(0);
    });

    it('should skip folders whose apps have not completed initial process', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100 },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      // App not in cache (not completed initial process)
      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.checked).to.be.true;
      expect(result.foldersHealthy).to.equal(0);
      expect(result.foldersWithIssues).to.equal(0);
      expect(logMock.debug.calledWith(sinon.match(/initial process not completed/))).to.be.true;
    });

    it('should skip folders whose apps have restarted flag set to false', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: false });
      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100 },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersHealthy).to.equal(0);
      expect(result.foldersWithIssues).to.equal(0);
    });

    it('should process folders whose apps have completed initial process', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100 },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersHealthy).to.equal(1);
      expect(result.foldersWithIssues).to.equal(0);
    });

    it('should handle null diagnostics gracefully', async () => {
      syncthingServiceMock.getPeerSyncDiagnostics.resolves(null);

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.checked).to.be.true;
      expect(logMock.warn.calledWith(sinon.match(/Could not get peer sync diagnostics/))).to.be.true;
    });

    it('should detect global isolation', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100 },
            issues: [],
          },
        },
        summary: { connectedPeers: [], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersWithIssues).to.equal(1);
      expect(logMock.warn.calledWith(sinon.match(/Node is ISOLATED/))).to.be.true;
    });

    it('should detect cannot sync issues', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [{ connected: false }],
            localStatus: { syncPercentage: 50 },
            issues: [{ message: 'Peer disconnected' }],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersWithIssues).to.equal(1);
      const healthStatus = mockFolderHealthCache.get('fluxmyapp');
      expect(healthStatus.cannotSyncSince).to.be.a('number');
    });

    it('should detect peers behind issues when not actively syncing', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: true,
            peerStatuses: [],
            localStatus: { syncPercentage: 80, state: 'idle' },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersWithIssues).to.equal(1);
      const healthStatus = mockFolderHealthCache.get('fluxmyapp');
      expect(healthStatus.peersBehindSince).to.be.a('number');
    });

    it('should NOT flag peers behind when actively syncing', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: true,
            peerStatuses: [],
            localStatus: { syncPercentage: 80, state: 'syncing' },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersHealthy).to.equal(1);
      expect(result.foldersWithIssues).to.equal(0);
      const healthStatus = mockFolderHealthCache.get('fluxmyapp');
      expect(healthStatus.peersBehindSince).to.be.null;
    });

    it('should clear peers behind issue when sync starts', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      // Pre-set an existing peers behind issue
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: Date.now() - 60000, // 1 minute ago
        lastHealthyTimestamp: Date.now() - 60000,
        lastAction: 'none',
        appWasStopped: false,
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: true,
            peerStatuses: [],
            localStatus: { syncPercentage: 85, state: 'syncing' }, // Now syncing
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersHealthy).to.equal(1);
      const healthStatus = mockFolderHealthCache.get('fluxmyapp');
      expect(healthStatus.peersBehindSince).to.be.null;
      expect(logMock.info.calledWith(sinon.match(/is now actively syncing/))).to.be.true;
    });

    it('should NOT flag peers behind when in sync-preparing state', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: true,
            peerStatuses: [],
            localStatus: { syncPercentage: 50, state: 'sync-preparing' },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersHealthy).to.equal(1);
      expect(result.foldersWithIssues).to.equal(0);
    });

    it('should detect stalled sync when percentage does not change', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      // Pre-set tracking to simulate stalled sync - percentage same as current
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now(),
        lastAction: 'none',
        appWasStopped: false,
        lastSyncPercentage: 50, // Same as current - will be detected as stalled
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: true,
            peerStatuses: [],
            localStatus: { syncPercentage: 50, state: 'syncing' }, // Still at 50%, stalled!
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersWithIssues).to.equal(1);
      const healthStatus = mockFolderHealthCache.get('fluxmyapp');
      expect(healthStatus.peersBehindSince).to.be.a('number');
      expect(logMock.warn.calledWith(sinon.match(/sync appears STALLED/))).to.be.true;
    });

    it('should NOT flag stalled sync when percentage changes', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      // Pre-set tracking with old percentage
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now(),
        lastAction: 'none',
        appWasStopped: false,
        lastSyncPercentage: 50, // Previous percentage
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: true,
            peerStatuses: [],
            localStatus: { syncPercentage: 55, state: 'syncing' }, // Progress made (50 -> 55)
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersHealthy).to.equal(1);
      expect(result.foldersWithIssues).to.equal(0);
      const healthStatus = mockFolderHealthCache.get('fluxmyapp');
      expect(healthStatus.lastSyncPercentage).to.equal(55); // Updated
      expect(healthStatus.peersBehindSince).to.be.null;
    });

    it('should update sync tracking when sync completes', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100, state: 'idle' },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersHealthy).to.equal(1);
      const healthStatus = mockFolderHealthCache.get('fluxmyapp');
      expect(healthStatus.lastSyncPercentage).to.equal(100);
    });

    it('should handle first check with null lastSyncPercentage (not stalled)', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      // New folder, no previous percentage tracked
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now(),
        lastAction: 'none',
        appWasStopped: false,
        lastSyncPercentage: null, // First time seeing this folder
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: true,
            peerStatuses: [],
            localStatus: { syncPercentage: 50, state: 'syncing' },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      // Should NOT be flagged as stalled on first check
      expect(result.foldersHealthy).to.equal(1);
      const healthStatus = mockFolderHealthCache.get('fluxmyapp');
      expect(healthStatus.lastSyncPercentage).to.equal(50);
      expect(healthStatus.peersBehindSince).to.be.null;
    });

    it('should handle multiple folders with different states', async () => {
      mockFoldersConfiguration = [
        { id: 'fluxapp1' },
        { id: 'fluxapp2' },
        { id: 'fluxapp3' },
      ];
      mockReceiveOnlySyncthingAppsCache.set('fluxapp1', { restarted: true });
      mockReceiveOnlySyncthingAppsCache.set('fluxapp2', { restarted: true });
      mockReceiveOnlySyncthingAppsCache.set('fluxapp3', { restarted: true });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxapp1: {
            canSync: true,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100, state: 'idle' },
            issues: [],
          },
          fluxapp2: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [{ connected: false }],
            localStatus: { syncPercentage: 50, state: 'idle' },
            issues: [{ message: 'disconnected' }],
          },
          fluxapp3: {
            canSync: true,
            peersAreMoreUpdated: true,
            peerStatuses: [],
            localStatus: { syncPercentage: 75, state: 'syncing' },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 3 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      // app1: healthy, app2: cannot sync (issue), app3: syncing (healthy)
      expect(result.foldersHealthy).to.equal(2);
      expect(result.foldersWithIssues).to.equal(1);
      expect(mockFolderHealthCache.get('fluxapp2').cannotSyncSince).to.be.a('number');
    });

    it('should handle component folder names correctly', async () => {
      mockFoldersConfiguration = [{ id: 'fluxweb_mycomposeapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxweb_mycomposeapp', { restarted: true });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxweb_mycomposeapp: {
            canSync: true,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100, state: 'idle' },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.foldersHealthy).to.equal(1);
    });

    it('should restart syncthing after restart threshold', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: Date.now() - constantsMock.HEALTH_RESTART_SYNCTHING_THRESHOLD_MS - 1000,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now() - constantsMock.HEALTH_RESTART_SYNCTHING_THRESHOLD_MS - 1000,
        lastAction: 'stopped',
        appWasStopped: true,
        lastSyncPercentage: null,
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [{ connected: false }],
            localStatus: { syncPercentage: 50, state: 'idle' },
            issues: [{ message: 'disconnected' }],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      syncthingServiceMock.systemRestart.resolves();

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.actions).to.have.length(1);
      expect(result.actions[0].action).to.equal('restart_syncthing');
      expect(syncthingServiceMock.systemRestart.calledOnce).to.be.true;
    });

    it('should only restart syncthing once when multiple folders need restart', async () => {
      mockFoldersConfiguration = [{ id: 'fluxapp1' }, { id: 'fluxapp2' }, { id: 'fluxapp3' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxapp1', { restarted: true });
      mockReceiveOnlySyncthingAppsCache.set('fluxapp2', { restarted: true });
      mockReceiveOnlySyncthingAppsCache.set('fluxapp3', { restarted: true });

      // All three folders have issues exceeding restart threshold
      const restartTime = Date.now() - constantsMock.HEALTH_RESTART_SYNCTHING_THRESHOLD_MS - 1000;
      mockFolderHealthCache.set('fluxapp1', {
        isolatedSince: null,
        cannotSyncSince: restartTime,
        peersBehindSince: null,
        lastHealthyTimestamp: restartTime,
        lastAction: 'stopped',
        appWasStopped: false,
        lastSyncPercentage: null,
      });
      mockFolderHealthCache.set('fluxapp2', {
        isolatedSince: null,
        cannotSyncSince: restartTime,
        peersBehindSince: null,
        lastHealthyTimestamp: restartTime,
        lastAction: 'stopped',
        appWasStopped: false,
        lastSyncPercentage: null,
      });
      mockFolderHealthCache.set('fluxapp3', {
        isolatedSince: null,
        cannotSyncSince: restartTime,
        peersBehindSince: null,
        lastHealthyTimestamp: restartTime,
        lastAction: 'stopped',
        appWasStopped: false,
        lastSyncPercentage: null,
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxapp1: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [{ connected: false }],
            localStatus: { syncPercentage: 50, state: 'idle' },
            issues: [{ message: 'disconnected' }],
          },
          fluxapp2: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [{ connected: false }],
            localStatus: { syncPercentage: 50, state: 'idle' },
            issues: [{ message: 'disconnected' }],
          },
          fluxapp3: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [{ connected: false }],
            localStatus: { syncPercentage: 50, state: 'idle' },
            issues: [{ message: 'disconnected' }],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 3 },
      });

      syncthingServiceMock.systemRestart.resolves();

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      // Should have 3 actions (one restart, two skipped)
      expect(result.actions).to.have.length(3);

      // First folder should trigger actual restart
      expect(result.actions[0].action).to.equal('restart_syncthing');
      expect(result.actions[0].folderId).to.equal('fluxapp1');

      // Second and third should be skipped
      expect(result.actions[1].action).to.equal('restart_syncthing_skipped');
      expect(result.actions[1].folderId).to.equal('fluxapp2');
      expect(result.actions[2].action).to.equal('restart_syncthing_skipped');
      expect(result.actions[2].folderId).to.equal('fluxapp3');

      // systemRestart should only be called once, not three times
      expect(syncthingServiceMock.systemRestart.calledOnce).to.be.true;

      // All folders should be marked as restarted
      expect(mockFolderHealthCache.get('fluxapp1').lastAction).to.equal('restarted_syncthing');
      expect(mockFolderHealthCache.get('fluxapp2').lastAction).to.equal('restarted_syncthing');
      expect(mockFolderHealthCache.get('fluxapp3').lastAction).to.equal('restarted_syncthing');
    });

    it('should skip soft redeploy in progress', async () => {
      mockState.softRedeployInProgress = true;

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.checked).to.be.false;
    });

    it('should skip hard redeploy in progress', async () => {
      mockState.hardRedeployInProgress = true;

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.checked).to.be.false;
    });

    it('should take warning action after warning threshold', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: Date.now() - constantsMock.HEALTH_WARNING_THRESHOLD_MS - 1000,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now() - constantsMock.HEALTH_WARNING_THRESHOLD_MS - 1000,
        lastAction: 'none',
        appWasStopped: false,
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [{ connected: false }],
            localStatus: { syncPercentage: 50 },
            issues: [{ message: 'Peer disconnected' }],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.actions).to.have.length(1);
      expect(result.actions[0].action).to.equal('warning');
    });

    it('should take stop action after stop threshold', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: Date.now() - constantsMock.HEALTH_STOP_THRESHOLD_MS - 1000,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now() - constantsMock.HEALTH_STOP_THRESHOLD_MS - 1000,
        lastAction: 'warning',
        appWasStopped: false,
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [{ connected: false }],
            localStatus: { syncPercentage: 50 },
            issues: [{ message: 'Peer disconnected' }],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.actions).to.have.length(1);
      expect(result.actions[0].action).to.equal('stop');
      expect(appDockerStopFn.calledOnce).to.be.true;
    });

    it('should restart app when issues resolve after being stopped', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now() - 10000,
        lastAction: 'stopped',
        appWasStopped: true,
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100 },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.actions).to.have.length(1);
      expect(result.actions[0].action).to.equal('restart_app');
      expect(appDockerStartFn.calledOnce).to.be.true;
    });

    it('should remove app after remove threshold', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: Date.now() - constantsMock.HEALTH_REMOVE_THRESHOLD_MS - 1000,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now() - constantsMock.HEALTH_REMOVE_THRESHOLD_MS - 1000,
        lastAction: 'restarted_syncthing',
        appWasStopped: false,
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: false,
            peersAreMoreUpdated: false,
            peerStatuses: [{ connected: false }],
            localStatus: { syncPercentage: 50 },
            issues: [{ message: 'Peer disconnected' }],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.actions).to.have.length(1);
      expect(result.actions[0].action).to.equal('remove');
      expect(removeAppLocallyFn.calledOnce).to.be.true;
      expect(removeAppLocallyFn.calledWith('myapp', null, true, false, false)).to.be.true;
    });

    it('should clean up cache for folders that no longer exist', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      mockReceiveOnlySyncthingAppsCache.set('fluxmyapp', { restarted: true });
      mockFolderHealthCache.set('fluxmyapp', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now(),
        lastAction: 'none',
        appWasStopped: false,
      });
      mockFolderHealthCache.set('fluxoldapp', {
        isolatedSince: null,
        cannotSyncSince: null,
        peersBehindSince: null,
        lastHealthyTimestamp: Date.now(),
        lastAction: 'none',
        appWasStopped: false,
      });

      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100 },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(mockFolderHealthCache.has('fluxmyapp')).to.be.true;
      expect(mockFolderHealthCache.has('fluxoldapp')).to.be.false;
    });

    it('should handle errors gracefully', async () => {
      syncthingServiceMock.getPeerSyncDiagnostics.rejects(new Error('Network error'));

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: mockReceiveOnlySyncthingAppsCache,
      });

      expect(result.checked).to.be.true;
      expect(result.error).to.equal('Network error');
      expect(logMock.error.calledWith(sinon.match(/Error: Network error/))).to.be.true;
    });

    it('should work without receiveOnlySyncthingAppsCache (backwards compatibility)', async () => {
      mockFoldersConfiguration = [{ id: 'fluxmyapp' }];
      syncthingServiceMock.getPeerSyncDiagnostics.resolves({
        folders: {
          fluxmyapp: {
            canSync: true,
            peersAreMoreUpdated: false,
            peerStatuses: [],
            localStatus: { syncPercentage: 100 },
            issues: [],
          },
        },
        summary: { connectedPeers: ['peer1'], totalFolders: 1 },
      });

      const result = await healthMonitor.monitorFolderHealth({
        foldersConfiguration: mockFoldersConfiguration,
        folderHealthCache: mockFolderHealthCache,
        appDockerStopFn,
        appDockerStartFn,
        removeAppLocallyFn,
        state: mockState,
        receiveOnlySyncthingAppsCache: null,
      });

      expect(result.checked).to.be.true;
      expect(result.foldersHealthy).to.equal(1);
    });
  });
});
