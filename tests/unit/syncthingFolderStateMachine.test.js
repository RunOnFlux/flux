// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// Create mocks for dependencies
const syncthingServiceMock = {
  getDbStatus: sinon.stub(),
  systemRestart: sinon.stub(),
};

const dockerServiceMock = {
  dockerContainerInspect: sinon.stub(),
  appDockerStart: sinon.stub(),
  getAppIdentifier: sinon.stub(),
};

const serviceHelperMock = {
  delay: sinon.stub().resolves(),
};

// Load module with mocked dependencies
const stateMachine = proxyquire('../../ZelBack/src/services/appMonitoring/syncthingFolderStateMachine', {
  '../dockerService': dockerServiceMock,
  '../syncthingService': syncthingServiceMock,
  '../serviceHelper': serviceHelperMock,
});

describe('syncthingFolderStateMachine tests', () => {
  beforeEach(() => {
    // Reset all stubs before each test
    sinon.reset();
    syncthingServiceMock.getDbStatus.reset();
    syncthingServiceMock.systemRestart.reset();
    dockerServiceMock.dockerContainerInspect.reset();
    dockerServiceMock.appDockerStart.reset();
    dockerServiceMock.getAppIdentifier.reset();
    serviceHelperMock.delay.reset();
    serviceHelperMock.delay.resolves();
  });

  describe('isDesignatedLeader', () => {
    it('should return false when no peers provided', () => {
      const result = stateMachine.isDesignatedLeader([], '10.0.0.1:16127');
      expect(result).to.be.false;
    });

    it('should return false when null peers provided', () => {
      const result = stateMachine.isDesignatedLeader(null, '10.0.0.1:16127');
      expect(result).to.be.false;
    });

    it('should return false when another peer is already running', () => {
      const peers = [
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: 2000, broadcastedAt: 1000 },
      ];

      const result = stateMachine.isDesignatedLeader(peers, '10.0.0.1:16127');
      expect(result).to.be.false;
    });

    it('should return true for single peer deployment', () => {
      const peers = [{ ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 }];

      const result = stateMachine.isDesignatedLeader(peers, '10.0.0.1:16127');
      expect(result).to.be.true;
    });

    it('should elect node with earliest broadcastedAt', () => {
      const peers = [
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 10000 },
        { ip: '10.0.0.3:16127', runningSince: null, broadcastedAt: 20000 },
      ];

      const result1 = stateMachine.isDesignatedLeader(peers, '10.0.0.1:16127');
      const result2 = stateMachine.isDesignatedLeader(peers, '10.0.0.2:16127');

      expect(result1).to.be.true;
      expect(result2).to.be.false;
    });

    it('should use IP as tiebreaker when broadcastedAt within tolerance', () => {
      const peers = [
        { ip: '10.0.0.3:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1001 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1002 },
      ];

      // Within 5 second tolerance, should use IP
      const result1 = stateMachine.isDesignatedLeader(peers, '10.0.0.1:16127');
      const result2 = stateMachine.isDesignatedLeader(peers, '10.0.0.3:16127');

      expect(result1).to.be.true;
      expect(result2).to.be.false;
    });

    it('should return false when current node not in peer list', () => {
      const peers = [
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ];

      const result = stateMachine.isDesignatedLeader(peers, '10.0.0.3:16127');
      expect(result).to.be.false;
    });
  });

  describe('getFolderSyncCompletion', () => {
    it('should return sync status when successful', async () => {
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 1000,
          inSyncBytes: 500,
          state: 'syncing',
        },
      });

      const result = await stateMachine.getFolderSyncCompletion('test-folder');

      expect(result).to.deep.include({
        syncPercentage: 50,
        globalBytes: 1000,
        inSyncBytes: 500,
        state: 'syncing',
        isSynced: false,
      });
    });

    it('should return 100% for empty folder', async () => {
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 0,
          inSyncBytes: 0,
          state: 'idle',
        },
      });

      const result = await stateMachine.getFolderSyncCompletion('test-folder');

      expect(result.syncPercentage).to.equal(100);
      expect(result.isSynced).to.be.true;
    });

    it('should mark as synced when 100% complete', async () => {
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 1000,
          inSyncBytes: 1000,
          state: 'idle',
        },
      });

      const result = await stateMachine.getFolderSyncCompletion('test-folder');

      expect(result.syncPercentage).to.equal(100);
      expect(result.isSynced).to.be.true;
    });

    it('should return null on service error', async () => {
      syncthingServiceMock.getDbStatus.rejects(new Error('Service error'));

      const result = await stateMachine.getFolderSyncCompletion('test-folder');

      expect(result).to.be.null;
    });

    it('should return null when status is not success', async () => {
      syncthingServiceMock.getDbStatus.resolves({
        status: 'error',
        data: null,
      });

      const result = await stateMachine.getFolderSyncCompletion('test-folder');

      expect(result).to.be.null;
    });
  });

  describe('manageFolderSyncState', () => {
    let mockParams;

    beforeEach(() => {
      mockParams = {
        appId: 'test-app',
        syncFolder: null,
        containerDataFlags: 'r',
        syncthingAppsFirstRun: false,
        receiveOnlySyncthingAppsCache: new Map(),
        appLocation: sinon.stub().resolves([]),
        myIP: '10.0.0.1:16127',
        appDockerStopFn: sinon.stub().resolves(),
        appDockerRestartFn: sinon.stub().resolves(),
        appDeleteDataInMountPointFn: sinon.stub().resolves(),
        syncthingFolder: {
          id: 'test-app',
          type: 'sendreceive',
        },
        installedAppName: 'test-app',
      };
    });

    it('should skip update when folder already syncing', async () => {
      mockParams.syncFolder = { type: 'sendreceive' };
      dockerServiceMock.dockerContainerInspect.resolves({
        State: { Running: true },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.skipUpdate).to.be.true;
    });

    it('should handle first run with no sync folder', async () => {
      mockParams.syncthingAppsFirstRun = true;
      mockParams.syncFolder = null;

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.numberOfExecutions).to.equal(1);
      sinon.assert.calledOnce(mockParams.appDockerStopFn);
      sinon.assert.calledOnce(mockParams.appDeleteDataInMountPointFn);
    });

    it('should handle first run with existing receiveonly folder', async () => {
      mockParams.syncthingAppsFirstRun = true;
      mockParams.syncFolder = { type: 'receiveonly' };
      dockerServiceMock.dockerContainerInspect.resolves({
        State: { Running: false },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.cache.restarted).to.be.false;
      expect(result.cache.numberOfExecutions).to.equal(1);
    });

    it('should elect leader and start immediately', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
      sinon.assert.calledOnce(mockParams.appDockerRestartFn);
    });

    it('should wait for sync completion when not leader', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 1000,
          inSyncBytes: 500,
          state: 'syncing',
        },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.numberOfExecutions).to.equal(2);
      expect(result.cache.restarted).to.be.false; // Still waiting, not restarted yet
    });

    it('should transition to sendreceive when sync complete', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 1000,
          inSyncBytes: 1000,
          state: 'idle',
        },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
      sinon.assert.calledOnce(mockParams.appDockerRestartFn);
    });

    it('should force start after max executions', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 119, // MAX_SYNC_WAIT_EXECUTIONS - 1
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 1000,
          inSyncBytes: 500,
          state: 'syncing',
        },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
    });

    it('should skip processing on first encounter when not first run and syncFolder exists', async () => {
      mockParams.syncthingAppsFirstRun = false;
      // syncFolder exists (app existed before) but not in cache
      mockParams.syncFolder = { id: 'test-app', type: 'receiveonly' };

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.skipProcessing).to.be.true;
      expect(result.cache.firstEncounterSkipped).to.be.true;
    });

    it('should treat as new app when syncFolder does not exist even if not first run', async () => {
      mockParams.syncthingAppsFirstRun = false;
      mockParams.syncFolder = null; // NEW app installation - no syncFolder

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.numberOfExecutions).to.equal(1);
      sinon.assert.calledOnce(mockParams.appDockerStopFn);
      sinon.assert.calledOnce(mockParams.appDeleteDataInMountPointFn);
    });

    it('should process skipped app on second encounter', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        firstEncounterSkipped: true,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.numberOfExecutions).to.equal(1);
      sinon.assert.calledOnce(mockParams.appDockerStopFn);
    });

    it('should use fallback time-based logic when sync status unavailable', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        status: 'error',
        data: null,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.numberOfExecutionsRequired).to.be.a('number');
      expect(result.cache.numberOfExecutions).to.equal(2);
    });
  });
});
