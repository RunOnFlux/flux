// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// Create mocks for dependencies
const syncthingServiceMock = {
  getDbStatus: sinon.stub(),
  systemRestart: sinon.stub(),
  getConfig: sinon.stub(),
  getDbCompletion: sinon.stub(),
};

const dockerServiceMock = {
  dockerContainerInspect: sinon.stub(),
  appDockerStart: sinon.stub(),
  getAppIdentifier: sinon.stub(),
};

const serviceHelperMock = {
  delay: sinon.stub().resolves(),
};

const nodecmdMock = {
  run: sinon.stub(),
};

const appReconcilerMock = { setControllerDesired: sinon.stub(), enqueue: sinon.stub() };
const appUninstallerMock = { removeAppLocally: sinon.stub().resolves() };

// Load module with mocked dependencies
const stateMachine = proxyquire('../../ZelBack/src/services/appMonitoring/syncthingFolderStateMachine', {
  '../dockerService': dockerServiceMock,
  '../syncthingService': syncthingServiceMock,
  '../serviceHelper': serviceHelperMock,
  'node-cmd': nodecmdMock,
  // stub new collaborators so the unit test doesn't load the real module graph
  './appReconciler': appReconcilerMock,
  '../appLifecycle/appUninstaller': appUninstallerMock,
});

describe('syncthingFolderStateMachine tests', () => {
  beforeEach(() => {
    // Reset only this file's own stubs (NOT a global sinon.reset(), which would
    // wipe stub behaviour set up by other test files in the same mocha process)
    syncthingServiceMock.getDbStatus.reset();
    syncthingServiceMock.systemRestart.reset();
    syncthingServiceMock.systemRestart.resolves();
    syncthingServiceMock.getConfig.reset();
    syncthingServiceMock.getDbCompletion.reset();
    dockerServiceMock.dockerContainerInspect.reset();
    dockerServiceMock.appDockerStart.reset();
    dockerServiceMock.getAppIdentifier.reset();
    serviceHelperMock.delay.reset();
    serviceHelperMock.delay.resolves();
    nodecmdMock.run.reset();
    appUninstallerMock.removeAppLocally.reset();
    appUninstallerMock.removeAppLocally.resolves();

    // Mock successful file system operations for safety checks
    // This makes verifyFolderMountSafety return isSafe: true
    // nodecmd.run callback signature: (err, data, stderr)
    nodecmdMock.run.callsFake((cmd, callback) => {
      if (cmd.includes('test -d')) {
        // Directory exists
        callback(null, 'exists', '');
      } else if (cmd.includes('mountpoint')) {
        // Not a mount point (exit code 1) - this causes an error
        const err = new Error('not a mountpoint');
        err.code = 1;
        callback(err, '', '');
      } else if (cmd.includes('find')) {
        // Has files (return count > 0)
        callback(null, '10\n', '');
      } else if (cmd.includes('chmod')) {
        // Permission changes succeed
        callback(null, '', '');
      } else {
        callback(null, '', '');
      }
    });
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
        localSocketAddr: '10.0.0.1:16127',
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
        leaderStreak: 5, // leadership already confirmed over prior cycles
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
      sinon.assert.calledOnce(mockParams.appDockerRestartFn);
    });

    it('should not self-promote to leader on a single observation (debounce)', async () => {
      // sole peer -> isDesignatedLeader is true, but with no confirmed streak yet a
      // single transient observation must NOT start the app as leader.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      // valid, not-synced, not-yet-stalled status so the non-leader path just waits
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: { globalBytes: 1000, inSyncBytes: 500, state: 'syncing' },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(mockParams.appDockerRestartFn);
      expect(result.cache.restarted).to.not.equal(true);
      expect(result.cache.leaderStreak).to.equal(1);
    });

    it('should NOT let leader election hijack an in-progress recovery', async () => {
      // mid-recovery (syncthingRestartAttempted) AND sole peer (would-be leader):
      // the recovery guard must keep us out of the leader-start path so the safe
      // stall-recovery/removal completes instead of spuriously starting the app.
      const syncHistory = [];
      for (let i = 0; i < 10; i++) {
        syncHistory.push({ inSyncBytes: 500, globalBytes: 1000, syncPercentage: 50, timestamp: Date.now() + i * 1000 });
      }
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        syncHistory,
        syncthingRestartAttempted: true,
        leaderStreak: 5, // even with leadership "confirmed", recovery must win
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 }, // sole peer -> would be leader
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: { globalBytes: 1000, inSyncBytes: 500, state: 'syncing' },
      });
      syncthingServiceMock.getConfig.resolves({
        status: 'success',
        data: { folders: [{ id: 'test-app', type: 'receiveonly', devices: [{ deviceID: 'DEVICE123' }] }] },
      });
      syncthingServiceMock.getDbCompletion.resolves({ status: 'success', data: { completion: 100, globalBytes: 1000 } });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      // must NOT have taken the leader-start path (no sendreceive flip, no start)
      sinon.assert.notCalled(mockParams.appDockerRestartFn);
      expect(result.syncthingFolder.type).to.equal('receiveonly');
      // recovery completed instead (removal path sets restarted)
      expect(result.cache.restarted).to.be.true;
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

    it('should NOT start on unsynced data while sync is still progressing (no force-start)', async () => {
      // not the leader, sync at 50% and still progressing (not stalled)
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 119,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 900 }, // leader
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 }, // this node
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

      // must stay receiveonly and never start — starting here would propagate
      // unsynced data to peers
      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
      sinon.assert.notCalled(mockParams.appDockerRestartFn);
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

    it('never force-starts when sync status is unavailable (stays receiveonly on unverified data)', async () => {
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

      // cannot verify the data is synced -> must not flip to sendreceive or start, and
      // must not remove yet (well under the removal threshold on the first unreadable cycle)
      sinon.assert.notCalled(mockParams.appDockerRestartFn);
      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
    });

    it('removes locally (never starts) when sync status stays unreadable past the removal threshold', async () => {
      // unreadable since well before the removal threshold (2h30)
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        statusUnreadableSince: Date.now() - (3 * 60 * 60 * 1000),
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({ status: 'error', data: null });

      await stateMachine.manageFolderSyncState(mockParams);

      // never started on unverified data, but cleaned up rather than stuck forever
      sinon.assert.notCalled(mockParams.appDockerRestartFn);
      sinon.assert.calledOnce(appUninstallerMock.removeAppLocally);
    });

    it('should stop Docker and restart Syncthing when sync is stalled with synced peers', async () => {
      // Setup stalled sync scenario
      const syncHistory = [];
      for (let i = 0; i < 10; i++) {
        syncHistory.push({
          inSyncBytes: 500, // Same bytes - stalled
          globalBytes: 1000,
          syncPercentage: 50,
          timestamp: Date.now() + i * 1000,
        });
      }

      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 15,
        syncHistory,
      });
      // Add multiple peers so this node is NOT the leader
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 900 }, // Earlier broadcast - will be leader
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 }, // This node
      ]);

      // Mock sync status showing stalled sync
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 1000,
          inSyncBytes: 500,
          state: 'syncing',
        },
      });

      // Mock config showing peers with sendreceive
      syncthingServiceMock.getConfig = sinon.stub().resolves({
        status: 'success',
        data: {
          folders: [{
            id: 'test-app',
            type: 'receiveonly',
            devices: [{ deviceID: 'DEVICE123' }],
          }],
        },
      });

      // Mock completion showing peer is synced (100% AND holds data)
      syncthingServiceMock.getDbCompletion = sinon.stub().resolves({
        status: 'success',
        data: { completion: 100, globalBytes: 1000 },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      // numberOfExecutions should NOT be reset - continues incrementing toward max
      // Started at 15, incremented to 16 during processing, not reset to 1
      expect(result.cache.numberOfExecutions).to.equal(16);
      expect(result.cache.syncHistory).to.be.an('array').that.is.empty;
      expect(result.cache.syncthingRestartAttempted).to.be.true;
      sinon.assert.calledOnce(mockParams.appDockerStopFn);
      sinon.assert.calledOnce(syncthingServiceMock.systemRestart);
    });

    it('should not restart Syncthing more than once for stalled sync', async () => {
      // Setup stalled sync scenario with restart already attempted
      const syncHistory = [];
      for (let i = 0; i < 10; i++) {
        syncHistory.push({
          inSyncBytes: 500, // Same bytes - stalled
          globalBytes: 1000,
          syncPercentage: 50,
          timestamp: Date.now() + i * 1000,
        });
      }

      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 20,
        syncHistory,
        syncthingRestartAttempted: true, // Already attempted restart
      });
      // Add multiple peers so this node is NOT the leader
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 900 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);

      // Mock sync status showing still stalled
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 1000,
          inSyncBytes: 500,
          state: 'syncing',
        },
      });

      // Mock config showing peers
      syncthingServiceMock.getConfig = sinon.stub().resolves({
        status: 'success',
        data: {
          folders: [{
            id: 'test-app',
            type: 'receiveonly',
            devices: [{ deviceID: 'DEVICE123' }],
          }],
        },
      });

      // Mock completion showing peer is synced (100% AND holds data)
      syncthingServiceMock.getDbCompletion = sinon.stub().resolves({
        status: 'success',
        data: { completion: 100, globalBytes: 1000 },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      // Should NOT restart Syncthing again (already attempted)
      expect(syncthingServiceMock.systemRestart.called).to.be.false;
      // Should continue waiting
      expect(result.cache.syncthingRestartAttempted).to.be.true;
      expect(result.syncthingFolder.type).to.equal('receiveonly');
    });

    it('should remove app when stalled with synced peers after a recovery attempt', async () => {
      // Setup stalled sync scenario where the one-shot recovery has already run
      const syncHistory = [];
      for (let i = 0; i < 10; i++) {
        syncHistory.push({
          inSyncBytes: 500, // Same bytes - stalled
          globalBytes: 1000,
          syncPercentage: 50,
          timestamp: Date.now() + i * 1000,
        });
      }

      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        syncHistory,
        syncthingRestartAttempted: true, // recovery already tried -> safe to give up
      });
      // Add multiple peers so this node is NOT the leader
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 900 }, // Earlier broadcast - will be leader
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 }, // This node
      ]);

      // Mock sync status showing NOT synced
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 1000,
          inSyncBytes: 500,
          state: 'syncing',
        },
      });

      // Mock config showing peers
      syncthingServiceMock.getConfig = sinon.stub().resolves({
        status: 'success',
        data: {
          folders: [{
            id: 'test-app',
            type: 'receiveonly',
            devices: [{ deviceID: 'DEVICE123' }],
          }],
        },
      });

      // Mock completion showing peer is synced (100% AND holds data)
      syncthingServiceMock.getDbCompletion = sinon.stub().resolves({
        status: 'success',
        data: { completion: 100, globalBytes: 1000 },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.cache.restarted).to.be.true;
      // Note: We can't easily test appUninstaller.removeAppLocally since it's required dynamically
      // In production, this would remove the app
    });

    it('should NOT remove app when stalled and the only peer reports 100% but holds no data (empty)', async () => {
      // Same stalled + recovery-already-attempted setup as above, but the peer is
      // empty: completion 100 with globalBytes 0. That must NOT count as a synced
      // source, otherwise we would drop the good local copy in favour of an empty
      // one (data loss). The correct action is to keep waiting, not remove.
      const syncHistory = [];
      for (let i = 0; i < 10; i++) {
        syncHistory.push({
          inSyncBytes: 500, // Same bytes - stalled
          globalBytes: 1000,
          syncPercentage: 50,
          timestamp: Date.now() + i * 1000,
        });
      }

      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        syncHistory,
        syncthingRestartAttempted: true, // recovery already tried
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 900 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);

      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: { globalBytes: 1000, inSyncBytes: 500, state: 'syncing' },
      });

      syncthingServiceMock.getConfig = sinon.stub().resolves({
        status: 'success',
        data: { folders: [{ id: 'test-app', type: 'receiveonly', devices: [{ deviceID: 'DEVICE123' }] }] },
      });

      // Peer reports 100% but 0 bytes -> NOT a safe source
      syncthingServiceMock.getDbCompletion = sinon.stub().resolves({
        status: 'success',
        data: { completion: 100, globalBytes: 0 },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      // No synced peer found -> we keep waiting, app is not removed (restarted stays false)
      expect(result.cache.restarted).to.be.false;
    });
  });
});
