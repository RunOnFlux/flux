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
  dbRevert: sinon.stub(),
  systemPause: sinon.stub(),
  systemResume: sinon.stub(),
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

const appReconcilerMock = {
  setControllerDesired: sinon.stub(),
  requestStopAndClearData: sinon.stub(),
  enqueue: sinon.stub(),
};
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
    syncthingServiceMock.dbRevert.reset();
    syncthingServiceMock.dbRevert.resolves({ status: 'success' });
    syncthingServiceMock.systemPause.reset();
    syncthingServiceMock.systemPause.resolves({ status: 'success' });
    syncthingServiceMock.systemResume.reset();
    syncthingServiceMock.systemResume.resolves({ status: 'success' });
    dockerServiceMock.dockerContainerInspect.reset();
    dockerServiceMock.appDockerStart.reset();
    dockerServiceMock.getAppIdentifier.reset();
    serviceHelperMock.delay.reset();
    serviceHelperMock.delay.resolves();
    nodecmdMock.run.reset();
    appUninstallerMock.removeAppLocally.reset();
    appUninstallerMock.removeAppLocally.resolves();
    appReconcilerMock.setControllerDesired.reset();
    appReconcilerMock.requestStopAndClearData.reset();
    appReconcilerMock.enqueue.reset();

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

    it('should NOT treat an empty/unknown global (globalBytes 0) as synced', async () => {
      // An empty global index is "unknown / not yet synced", never "done": a node
      // holding the only copy before peers reconnect reads globalBytes 0. Treating
      // that as synced lets the promotion gate revert (delete the only copy) or
      // promote on unverified data (B1). syncPercentage stays 100 for display, but
      // isSynced must be false so the gate waits.
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
      expect(result.isSynced).to.be.false;
    });

    it('should NOT treat an empty global with local changes as synced (the B1 trap)', async () => {
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 0,
          inSyncBytes: 0,
          state: 'idle',
          receiveOnlyChangedFiles: 2,
        },
      });

      const result = await stateMachine.getFolderSyncCompletion('test-folder');

      expect(result.receiveOnlyChangedFiles).to.equal(2);
      expect(result.isSynced).to.be.false;
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
      // the stop+wipe is now declared to the reconciler (the sole actuator), not done
      // imperatively here - so a start can never race the wipe (S1)
      sinon.assert.calledOnceWithExactly(appReconcilerMock.requestStopAndClearData, 'test-app', sinon.match.string);
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
      // the start is now declared to the reconciler, not done imperatively here
      sinon.assert.calledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
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

      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
      expect(result.cache.restarted).to.not.equal(true);
      expect(result.cache.leaderStreak).to.equal(1);
    });

    it('should let a confirmed leader start even while stall evidence is accumulating', async () => {
      // The old machinery stopped the container during its stall recovery, so
      // leadership had to be suppressed mid-recovery. The ladder never stops the
      // container before an (atomic) removal, so a confirmed leader simply starts -
      // that is the cold-start fallback when no peer runs the app.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        leaderStreak: 5,
        lastProgressBytes: 500,
        lastProgressAt: Date.now() - 30 * 60 * 1000,
        nudgeCount: 3,
        lastNudgeAt: Date.now() - 16 * 60 * 1000,
        evidenceSince: Date.now() - 25 * 60 * 1000,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 }, // sole peer -> leader
      ]);

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.calledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
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
      sinon.assert.calledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
    });

    // Contract: a receive-only folder with LOCAL changes must never be promoted to
    // sendreceive — promotion broadcasts the local changes cluster-wide (verified
    // live: ~2s to reach peers). Completion metrics are blind to local changes
    // (needBytes stays 0, completion stays 100); only receiveOnlyChangedFiles
    // reveals them. The remedy is db/revert (undo local changes), then promote on a
    // later cycle once the folder is verifiably clean. The LEADER path is exempt:
    // the leader's local data IS the seed by design.
    it('should revert local changes instead of promoting a polluted receive-only folder', async () => {
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
          receiveOnlyChangedFiles: 1,
          receiveOnlyChangedBytes: 555,
        },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.calledOnceWithExactly(syncthingServiceMock.dbRevert, 'test-app');
      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.be.false;
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
    });

    it('should NOT promote when the revert of local changes fails', async () => {
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
          receiveOnlyChangedFiles: 2,
          receiveOnlyChangedBytes: 555,
        },
      });
      syncthingServiceMock.dbRevert.rejects(new Error('syncthing api down'));

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.be.false;
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
    });

    it('should let the leader promote without reverting (its local data is the seed)', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: {
          globalBytes: 1000,
          inSyncBytes: 500,
          state: 'idle',
          receiveOnlyChangedFiles: 7,
          receiveOnlyChangedBytes: 555,
        },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      sinon.assert.calledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
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
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
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
      sinon.assert.calledOnceWithExactly(appReconcilerMock.requestStopAndClearData, 'test-app', sinon.match.string);
    });

    it('should process skipped app on second encounter', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        firstEncounterSkipped: true,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.numberOfExecutions).to.equal(1);
      sinon.assert.calledOnceWithExactly(appReconcilerMock.requestStopAndClearData, 'test-app', sinon.match.string);
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
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
    });

    // --- stall ladder ------------------------------------------------------
    // Contract (verified live against the fleet's syncthing v2.0.x):
    //  - inSyncBytes is block-granular while pulling, so byte movement IS progress;
    //  - an ACTIVE folder state with flat bytes is still healthy (e.g. a long
    //    sync-preparing phase on a large folder);
    //  - flat bytes while idle has causes that need DIFFERENT responses:
    //      source offline -> wait (syncthing auto-resumes when it returns);
    //      dormant puller (failed-pull retry backoff, or the inert no-retry state)
    //        -> nudge: device pause/resume forces a reconnect + index re-exchange,
    //           which re-arms the puller;
    //      node provably cannot ingest -> remove, ONLY with a CONNECTED synced
    //        source, repeated nudges and zero progress over a minimum window;
    //  - a syncthing process restart is never a remedy.
    const MIN = 60 * 1000;

    function setupIdleNoProgress(cacheFields, completionData) {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        ...cacheFields,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 900 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: { globalBytes: 1000, inSyncBytes: 500, state: 'idle' },
      });
      syncthingServiceMock.getConfig = sinon.stub().resolves({
        status: 'success',
        data: { folders: [{ id: 'test-app', type: 'receiveonly', devices: [{ deviceID: 'DEVICE123' }] }] },
      });
      syncthingServiceMock.getDbCompletion = sinon.stub().resolves({
        status: 'success',
        data: completionData ?? { completion: 100, globalBytes: 1000, remoteState: 'valid' },
      });
    }

    it('should nudge the folder devices (pause/resume) when idle with no progress and a connected synced peer', async () => {
      setupIdleNoProgress({ lastProgressBytes: 500, lastProgressAt: Date.now() - 4 * MIN });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.calledOnce(syncthingServiceMock.systemPause);
      expect(syncthingServiceMock.systemPause.firstCall.args[0].params.device).to.equal('DEVICE123');
      sinon.assert.calledOnce(syncthingServiceMock.systemResume);
      expect(syncthingServiceMock.systemResume.firstCall.args[0].params.device).to.equal('DEVICE123');
      sinon.assert.notCalled(syncthingServiceMock.systemRestart);
      sinon.assert.notCalled(appReconcilerMock.requestStopAndClearData);
      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      expect(result.cache.nudgeCount).to.equal(1);
      expect(result.syncthingFolder.type).to.equal('receiveonly');
    });

    it('should treat byte progress as healthy and reset the nudge ladder', async () => {
      setupIdleNoProgress({
        lastProgressBytes: 400,
        lastProgressAt: Date.now() - 10 * MIN,
        nudgeCount: 2,
        lastNudgeAt: Date.now() - 5 * MIN,
        evidenceSince: Date.now() - 10 * MIN,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(syncthingServiceMock.systemPause);
      sinon.assert.notCalled(syncthingServiceMock.systemRestart);
      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      expect(result.cache.nudgeCount).to.equal(0);
      expect(result.cache.evidenceSince).to.equal(null);
      expect(result.cache.lastProgressBytes).to.equal(500);
      // lastNudgeAt is part of the stall state machine and must reset with its
      // siblings on progress - leaving it stale is an incoherent half-reset
      expect(result.cache.lastNudgeAt).to.equal(null);
    });

    it('should take no action while the folder state is active, even with flat bytes', async () => {
      setupIdleNoProgress({ lastProgressBytes: 500, lastProgressAt: Date.now() - 10 * MIN });
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: { globalBytes: 1000, inSyncBytes: 500, state: 'sync-preparing' },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(syncthingServiceMock.systemPause);
      sinon.assert.notCalled(syncthingServiceMock.systemRestart);
      sinon.assert.notCalled(appReconcilerMock.requestStopAndClearData);
      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      expect(result.syncthingFolder.type).to.equal('receiveonly');
    });

    it('should wait out the no-progress window before nudging', async () => {
      setupIdleNoProgress({ lastProgressBytes: 500, lastProgressAt: Date.now() - 1 * MIN });

      await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(syncthingServiceMock.systemPause);
      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
    });

    it('should not nudge again before the nudge backoff elapses', async () => {
      setupIdleNoProgress({
        lastProgressBytes: 500,
        lastProgressAt: Date.now() - 10 * MIN,
        nudgeCount: 1,
        lastNudgeAt: Date.now() - 2 * MIN,
        evidenceSince: Date.now() - 8 * MIN,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(syncthingServiceMock.systemPause);
      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      expect(result.cache.nudgeCount).to.equal(1);
    });

    it('should remove only with sustained evidence: nudges exhausted over the window, zero progress, connected synced peer', async () => {
      setupIdleNoProgress({
        lastProgressBytes: 500,
        lastProgressAt: Date.now() - 30 * MIN,
        nudgeCount: 3,
        lastNudgeAt: Date.now() - 16 * MIN,
        evidenceSince: Date.now() - 25 * MIN,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.calledOnceWithExactly(appUninstallerMock.removeAppLocally, 'test-app', null, true, false, true);
      sinon.assert.notCalled(syncthingServiceMock.systemRestart);
      sinon.assert.notCalled(appReconcilerMock.requestStopAndClearData);
      expect(result.cache.restarted).to.be.true;
    });

    it('should remove by the BARE app name when the folder belongs to a component - a component-scoped removal leaves the installed-DB row behind (zombie app)', async () => {
      const componentId = 'component1_testapp';
      mockParams.appId = componentId;
      mockParams.installedAppName = 'testapp';
      mockParams.syncthingFolder = { id: componentId, type: 'receiveonly' };
      mockParams.receiveOnlySyncthingAppsCache.set(componentId, {
        restarted: false,
        lastProgressBytes: 500,
        lastProgressAt: Date.now() - 30 * MIN,
        nudgeCount: 3,
        lastNudgeAt: Date.now() - 16 * MIN,
        evidenceSince: Date.now() - 25 * MIN,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 900 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        status: 'success',
        data: { globalBytes: 1000, inSyncBytes: 500, state: 'idle' },
      });
      syncthingServiceMock.getConfig = sinon.stub().resolves({
        status: 'success',
        data: { folders: [{ id: componentId, type: 'receiveonly', devices: [{ deviceID: 'DEVICE123' }] }] },
      });
      syncthingServiceMock.getDbCompletion = sinon.stub().resolves({
        status: 'success',
        data: { completion: 100, globalBytes: 1000, remoteState: 'valid' },
      });

      await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.calledOnceWithExactly(appUninstallerMock.removeAppLocally, 'testapp', null, true, false, true);
    });

    it('should keep nudging instead of removing while the evidence window has not elapsed', async () => {
      setupIdleNoProgress({
        lastProgressBytes: 500,
        lastProgressAt: Date.now() - 18 * MIN,
        nudgeCount: 3,
        lastNudgeAt: Date.now() - 16 * MIN,
        evidenceSince: Date.now() - 15 * MIN,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      sinon.assert.calledOnce(syncthingServiceMock.systemPause);
      expect(result.cache.nudgeCount).to.equal(4);
    });

    // A peer's completion figure is only trustworthy while that peer is CONNECTED.
    // Syncthing computes db/completion from the last-known index, so a dead/offline
    // peer still reports completion=100 (verified live on v2.0.x). remoteState is
    // the connectivity discriminator: 'valid' when connected. Without a connected
    // synced source there is no evidence: no nudge (nothing to reconnect), no
    // removal - syncthing auto-resumes when the source returns.
    it('should neither nudge nor remove when the only "synced" peer is disconnected (stale completion)', async () => {
      setupIdleNoProgress({
        lastProgressBytes: 500,
        lastProgressAt: Date.now() - 30 * MIN,
        nudgeCount: 3,
        lastNudgeAt: Date.now() - 16 * MIN,
        evidenceSince: Date.now() - 25 * MIN,
      }, { completion: 100, globalBytes: 1000, remoteState: 'unknown' });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      sinon.assert.notCalled(syncthingServiceMock.systemPause);
      expect(result.cache.restarted).to.be.false;
      expect(result.syncthingFolder.type).to.equal('receiveonly');
    });

    it('should neither nudge nor remove when the peer completion carries no remoteState (untrusted)', async () => {
      setupIdleNoProgress({
        lastProgressBytes: 500,
        lastProgressAt: Date.now() - 30 * MIN,
        nudgeCount: 3,
        lastNudgeAt: Date.now() - 16 * MIN,
        evidenceSince: Date.now() - 25 * MIN,
      }, { completion: 100, globalBytes: 1000 });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      sinon.assert.notCalled(syncthingServiceMock.systemPause);
      expect(result.cache.restarted).to.be.false;
      expect(result.syncthingFolder.type).to.equal('receiveonly');
    });

    it('should not remove when the only peer reports 100% but holds no data (empty)', async () => {
      // Syncthing reports completion 100 for an empty folder too; an empty peer must
      // not count as a synced source or we would drop the good local copy (data loss).
      setupIdleNoProgress({
        lastProgressBytes: 500,
        lastProgressAt: Date.now() - 30 * MIN,
        nudgeCount: 3,
        lastNudgeAt: Date.now() - 16 * MIN,
        evidenceSince: Date.now() - 25 * MIN,
      }, { completion: 100, globalBytes: 0, remoteState: 'valid' });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      expect(result.cache.restarted).to.be.false;
    });

    it('should never remove when the sync status is unreadable (no evidence)', async () => {
      // Unreadable status means we can verify nothing - neither that the data is
      // synced nor that a peer holds it. No removal without positive evidence; alert
      // and wait instead (an operator or recovery elsewhere resolves it).
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        statusUnreadableSince: Date.now() - 3 * 60 * MIN, // far past any old threshold
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 900 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({ status: 'error' });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.notCalled(appUninstallerMock.removeAppLocally);
      expect(result.cache.restarted).to.be.false;
      expect(result.syncthingFolder.type).to.equal('receiveonly');
    });
  });

  // The nudge pauses then resumes each DEVICE the folder shares with (source-
  // confirmed device-level pause: /rest/system/pause?device= drops that device's
  // connection - so the pause briefly affects every folder shared with that peer).
  // The resume MUST therefore always run once a pause succeeded: a device left
  // paused stays disconnected, silently degrading its folders until some unrelated
  // later nudge happens to resume it. (Folder-level pause cannot substitute - our
  // POC proved it does not cure the inert no-retry stall; only device pause does.)
  describe('nudgeFolderDevices', () => {
    function folderWithDevices(...deviceIds) {
      syncthingServiceMock.getConfig.resolves({
        status: 'success',
        data: { folders: [{ id: 'test-app', devices: deviceIds.map((deviceID) => ({ deviceID })) }] },
      });
    }

    it('pauses then resumes each device the folder shares with', async () => {
      folderWithDevices('DEVICE_A', 'DEVICE_B');

      await stateMachine.nudgeFolderDevices('test-app');

      sinon.assert.calledTwice(syncthingServiceMock.systemPause);
      sinon.assert.calledTwice(syncthingServiceMock.systemResume);
      sinon.assert.callOrder(syncthingServiceMock.systemPause, syncthingServiceMock.systemResume);
    });

    // The fix: resume must run even when something between the pause and the resume
    // throws (here the inter-step delay). Without the finally, a paused device is
    // never resumed - it stays disconnected.
    it('still resumes the device when the inter-step delay throws', async () => {
      folderWithDevices('DEVICE_A');
      serviceHelperMock.delay.rejects(new Error('interrupted'));

      await stateMachine.nudgeFolderDevices('test-app');

      sinon.assert.calledOnce(syncthingServiceMock.systemPause);
      sinon.assert.calledOnce(syncthingServiceMock.systemResume);
    });

    it('does not throw when the resume itself fails (it was still attempted)', async () => {
      folderWithDevices('DEVICE_A');
      syncthingServiceMock.systemResume.rejects(new Error('syncthing api down'));

      await stateMachine.nudgeFolderDevices('test-app'); // must not reject

      sinon.assert.calledOnce(syncthingServiceMock.systemResume);
    });

    it('does not resume a device whose pause failed (nothing to undo)', async () => {
      folderWithDevices('DEVICE_A');
      syncthingServiceMock.systemPause.rejects(new Error('pause failed'));

      await stateMachine.nudgeFolderDevices('test-app');

      sinon.assert.notCalled(syncthingServiceMock.systemResume);
    });

    it('resumes a later device even if an earlier device resume throws', async () => {
      folderWithDevices('DEVICE_A', 'DEVICE_B');
      // first resume (DEVICE_A) throws; DEVICE_B must still be paused AND resumed
      syncthingServiceMock.systemResume.onFirstCall().rejects(new Error('blip'));
      syncthingServiceMock.systemResume.resolves({ status: 'success' });

      await stateMachine.nudgeFolderDevices('test-app');

      sinon.assert.calledTwice(syncthingServiceMock.systemPause);
      sinon.assert.calledTwice(syncthingServiceMock.systemResume);
      expect(syncthingServiceMock.systemResume.secondCall.args[0].params.device).to.equal('DEVICE_B');
    });
  });
});
