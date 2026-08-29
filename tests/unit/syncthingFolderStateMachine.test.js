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
  getConfigDevices: sinon.stub(),
  dbRevert: sinon.stub(),
  systemPause: sinon.stub(),
  systemResume: sinon.stub(),
};

// The device cache the veto reads, owned by this suite and cleared between
// tests so one test's entries decide only its own election.
const globalStateMock = { syncthingDevicesIDCache: new Map() };

const dockerServiceMock = {
  dockerContainerInspect: sinon.stub(),
  appDockerStart: sinon.stub(),
  getAppIdentifier: sinon.stub(),
};

const serviceHelperMock = {
  delay: sinon.stub().resolves(),
  runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }),
};

const volumeServiceMock = {
  isPathMounted: sinon.stub(),
  ensureAppVolumeMounted: sinon.stub(),
};

const fsMock = {
  promises: {
    stat: sinon.stub(),
    readdir: sinon.stub(),
  },
};

const appTamperingDetectionServiceMock = {
  recordEvent: sinon.stub().resolves(),
};

const appReconcilerMock = {
  setControllerDesired: sinon.stub(),
  requestStopAndClearData: sinon.stub(),
  enqueue: sinon.stub(),
};
const appUninstallerMock = { removeAppLocally: sinon.stub().resolves() };
// the pre-promotion peer probe (/apps/promotedfolders)
const axiosMock = { get: sinon.stub() };
// this node's own connectivity - how it tells a dead peer from its own isolation
const fluxCommunicationMock = { peerResponsiveness: sinon.stub() };

// an axios rejection that carries a reply: the peer answered, just not usefully.
// A node that has not been upgraded yet has no /apps/promotedfolders and answers
// 404 - which is what makes this the rollout case rather than a rare one.
const httpStatus = (status) => Object.assign(
  new Error(`Request failed with status code ${status}`),
  { response: { status } },
);

// a syncthingService failure as the internal half reports it: an exception
// carrying the HTTP status its request failed with, null when nothing answered
const syncthingFailure = (message, { code, httpStatus = null } = {}) => Object.assign(
  new Error(message),
  { code, httpStatus },
);

// a directory entry as fs.readdir({ withFileTypes: true }) returns it
const dirent = (name, isFile = true) => ({
  name,
  isFile: () => isFile,
  isDirectory: () => !isFile,
});

// The real liveness module, stubbed only where it leaves the process. It carries
// both halves the state machine asks of a peer - whether it answered, and what
// this node's own syncthing says about it - so the decisions under test are still
// driven end to end by what a peer answers, what syncthing reports, and this
// node's own connectivity. Loaded before the state machine because the state
// machine is handed this same mocked copy: a second, unmocked one would reach the
// real syncthing service and answer every evidence question with silence.
const peerFolderLivenessMock = proxyquire('../../ZelBack/src/services/appMonitoring/peerFolderLiveness', {
  '../fluxCommunication': fluxCommunicationMock,
  '../syncthingService': syncthingServiceMock,
  '../utils/globalState': globalStateMock,
  axios: axiosMock,
});

// A fresh liveness object per call is the contract: it holds one pass's view.
const { createPeerFolderLiveness } = peerFolderLivenessMock;

// Load module with mocked dependencies
const stateMachine = proxyquire('../../ZelBack/src/services/appMonitoring/syncthingFolderStateMachine', {
  '../dockerService': dockerServiceMock,
  '../syncthingService': syncthingServiceMock,
  '../serviceHelper': serviceHelperMock,
  '../utils/volumeService': volumeServiceMock,
  '../appTamperingDetectionService': appTamperingDetectionServiceMock,
  'node:fs': fsMock,
  // stub new collaborators so the unit test doesn't load the real module graph
  './appReconciler': appReconcilerMock,
  '../appLifecycle/appUninstaller': appUninstallerMock,
  './peerFolderLiveness': peerFolderLivenessMock,
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
    syncthingServiceMock.getConfigDevices.reset();
    // default: this node's syncthing has no device configured for the peer either,
    // so a cache miss stays a genuine "cannot say" rather than silently resolving
    syncthingServiceMock.getConfigDevices.resolves([]);
    globalStateMock.syncthingDevicesIDCache.clear();
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
    serviceHelperMock.runCommand.reset();
    serviceHelperMock.runCommand.resolves({ error: null, stdout: '', stderr: '' });
    volumeServiceMock.isPathMounted.reset();
    volumeServiceMock.ensureAppVolumeMounted.reset();
    fsMock.promises.stat.reset();
    fsMock.promises.readdir.reset();
    appTamperingDetectionServiceMock.recordEvent.reset();
    appTamperingDetectionServiceMock.recordEvent.resolves();
    appUninstallerMock.removeAppLocally.reset();
    axiosMock.get.reset();
    // default: no peer holds a writable copy, so the promotion path is unchanged
    // for every test that is not about this probe
    axiosMock.get.resolves({ data: { data: { ready: true, folders: [] } } });
    fluxCommunicationMock.peerResponsiveness.reset();
    // default: this node is evidently well connected, so an unreachable peer reads
    // as a dead peer rather than as this node's own isolation
    fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
    appUninstallerMock.removeAppLocally.resolves();
    appReconcilerMock.setControllerDesired.reset();
    appReconcilerMock.requestStopAndClearData.reset();
    appReconcilerMock.enqueue.reset();

    // Default filesystem state: app dir exists, is a mountpoint, holds files.
    // This makes verifyFolderMountSafety return isSafe: true
    fsMock.promises.stat.resolves({ isDirectory: () => true });
    volumeServiceMock.isPathMounted.resolves(true);
    fsMock.promises.readdir.resolves([dirent('state.db'), dirent('config.yaml')]);
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

    it('elects the deterministic winner on a cold start when peers carry placement runningSince but none serves data', () => {
      // Every holder broadcasts runningSince on placement (not liveness). With no peer
      // actually serving the data (aPeerHasData=false) the election must NOT defer on
      // runningSince - else every node defers to every other and nobody seeds. It falls
      // through to the deterministic tiebreaker so EXACTLY ONE node (lowest IP) seeds.
      const peers = [
        { ip: '10.0.0.1:16127', runningSince: 2000, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: 2000, broadcastedAt: 1000 },
        { ip: '10.0.0.3:16127', runningSince: 2000, broadcastedAt: 1000 },
      ];

      expect(stateMachine.isDesignatedLeader(peers, '10.0.0.1:16127', false)).to.be.true;
      expect(stateMachine.isDesignatedLeader(peers, '10.0.0.2:16127', false)).to.be.false;
      expect(stateMachine.isDesignatedLeader(peers, '10.0.0.3:16127', false)).to.be.false;
    });

    it('still defers to a running peer that genuinely serves the data (aPeerHasData=true)', () => {
      const peers = [
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: 2000, broadcastedAt: 1000 },
      ];

      // a real source is serving - never seed, sync from it (even as the lowest IP)
      expect(stateMachine.isDesignatedLeader(peers, '10.0.0.1:16127', true)).to.be.false;
    });

    it('should return true for single peer deployment', () => {
      const peers = [{ ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 }];

      const result = stateMachine.isDesignatedLeader(peers, '10.0.0.1:16127');
      expect(result).to.be.true;
    });

    it('elects the lowest IP regardless of broadcastedAt (consistent across nodes - no split-brain)', () => {
      // broadcastedAt is the latest re-broadcast time and propagates with per-node delay,
      // so it is NOT a safe election key - each node could order the timestamps differently
      // and elect itself. IP is the only globally-consistent key. Here the EARLIEST
      // broadcaster has the HIGHEST IP: it must NOT win; the lowest IP is the agreed seed.
      const peers = [
        { ip: '10.0.0.3:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 50000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 25000 },
      ];

      expect(stateMachine.isDesignatedLeader(peers, '10.0.0.1:16127')).to.be.true;
      expect(stateMachine.isDesignatedLeader(peers, '10.0.0.2:16127')).to.be.false;
      expect(stateMachine.isDesignatedLeader(peers, '10.0.0.3:16127')).to.be.false;
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

  describe('probeFolderSyncCompletion', () => {
    // Syncthing saying "no such folder" is a finding about the data. Syncthing
    // not answering is a finding about syncthing. The backup gate reports one of
    // these to an operator as a fact about their data, so they must not arrive
    // here as the same thing.
    it('calls a 404 absent - syncthing answered, and the folder is not there', async () => {
      syncthingServiceMock.getDbStatus.rejects(syncthingFailure(
        'Request failed with status code 404',
        { code: 'ERR_BAD_REQUEST', httpStatus: 404 },
      ));

      const result = await stateMachine.probeFolderSyncCompletion('test-folder');

      expect(result).to.deep.equal({ status: null, reason: 'absent' });
    });

    it('calls an unreachable daemon unknown, not absent', async () => {
      syncthingServiceMock.getDbStatus.rejects(syncthingFailure(
        'connect ECONNREFUSED 127.0.0.1:8384',
        { code: 'ECONNREFUSED' },
      ));

      const result = await stateMachine.probeFolderSyncCompletion('test-folder');

      expect(result).to.deep.equal({ status: null, reason: 'unknown' });
    });

    it('calls a server error unknown - a 500 is not the folder telling us anything', async () => {
      syncthingServiceMock.getDbStatus.rejects(syncthingFailure(
        'Request failed with status code 500',
        { code: 'ERR_BAD_RESPONSE', httpStatus: 500 },
      ));

      const result = await stateMachine.probeFolderSyncCompletion('test-folder');

      expect(result.reason).to.equal('unknown');
    });

    it('calls a thrown lookup unknown', async () => {
      syncthingServiceMock.getDbStatus.rejects(new Error('socket hang up'));

      const result = await stateMachine.probeFolderSyncCompletion('test-folder');

      expect(result).to.deep.equal({ status: null, reason: 'unknown' });
    });

    it('reports a real reading as ok', async () => {
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 1000, inSyncBytes: 1000, state: 'idle' });

      const result = await stateMachine.probeFolderSyncCompletion('test-folder');

      expect(result.reason).to.equal('ok');
      expect(result.status.isSynced).to.equal(true);
    });
  });

  describe('getFolderSyncCompletion', () => {
    it('should return sync status when successful', async () => {
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 1000,
        inSyncBytes: 500,
        state: 'syncing',
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
        globalBytes: 0,
        inSyncBytes: 0,
        state: 'idle',
      });

      const result = await stateMachine.getFolderSyncCompletion('test-folder');

      expect(result.syncPercentage).to.equal(100);
      expect(result.isSynced).to.be.false;
    });

    it('should NOT treat an empty global with local changes as synced (the B1 trap)', async () => {
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0,
        inSyncBytes: 0,
        state: 'idle',
        receiveOnlyChangedFiles: 2,
      });

      const result = await stateMachine.getFolderSyncCompletion('test-folder');

      expect(result.receiveOnlyChangedFiles).to.equal(2);
      expect(result.isSynced).to.be.false;
    });

    it('should mark as synced when 100% complete', async () => {
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 1000,
        inSyncBytes: 1000,
        state: 'idle',
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
      syncthingServiceMock.getDbStatus.rejects(syncthingFailure('syncthing unavailable'));

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
        liveness: createPeerFolderLiveness(),
      };
    });

    it('asks a stopped r: container to run and keeps the cache entry when the folder is already syncing', async () => {
      // The folder config comes back untouched on this path, so the two side
      // effects are the whole of what it does: an r: container that has stopped
      // is asked to run again, and the entry the health monitor tracks the
      // folder by survives the pass rather than being reset to a fresh one.
      mockParams.syncFolder = { type: 'sendreceive' };
      mockParams.receiveOnlySyncthingAppsCache = new Map([['test-app', { restarted: true, marker: 'kept' }]]);
      dockerServiceMock.dockerContainerInspect.resolves({
        State: { Running: false },
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.calledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
      expect(result.cache).to.deep.equal({ restarted: true, marker: 'kept' });
      expect(result.syncthingFolder).to.equal(mockParams.syncthingFolder);
    });

    it('leaves an already-running container alone when the folder is already syncing', async () => {
      mockParams.syncFolder = { type: 'sendreceive' };
      dockerServiceMock.dockerContainerInspect.resolves({
        State: { Running: true },
      });

      await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
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

    it('hands back an unverified sendreceive folder for an established app whose folder is gone', async () => {
      // Documents the cost of losing a folder that should exist. The cache says
      // this app is established, so none of the receiveonly ladder applies and
      // no mount is inspected - the caller's sendreceive configuration is simply
      // handed back to be installed. A folder deleted in error therefore returns
      // as a writable folder over an unchecked mount.
      mockParams.syncFolder = null;
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', { restarted: true });
      dockerServiceMock.dockerContainerInspect.resolves({ State: { Running: true } });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache).to.equal(null);
      sinon.assert.notCalled(fsMock.promises.stat);
      sinon.assert.notCalled(volumeServiceMock.isPathMounted);
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
      // cold start: the folder is empty, which is what makes the unchecked seed sound
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
      // The state machine only DECIDES: it records intent, and the monitor
      // raises designatedLeader once the folder batch is applied. Raised here,
      // masterSlaveApps could start a primary against a folder whose
      // promotion has not reached syncthing yet.
      expect(result.cache.designationPending).to.be.true;
      expect(result.cache.designatedLeader).to.not.equal(true);
      // the start is now declared to the reconciler, not done imperatively here
      sinon.assert.calledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
    });

    it('does not crown itself while its own peers are silent - an isolated node cannot seed', async () => {
      // The same floor holderIsGone asks of a silent holder, asked of this node
      // before its own election can confirm: a node whose peers have all gone
      // quiet is the one that fell over, and letting it seed anyway starts the
      // app on a partition's minority side while the majority defers to its IP.
      // Identical to the seed test above in every respect but the peers.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 0, total: 8 });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.not.equal('sendreceive');
      expect(result.cache.designatedLeader).to.not.equal(true);
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
      // The confirmation itself must not survive isolation: a heal is followed
      // by LEADER_CONFIRM_COUNT clean passes, not an instant seed on stale wins.
      expect(result.cache.leaderStreak).to.equal(0);
    });

    it('confirms again after a heal - isolation resets the streak, it does not end the candidacy', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      fluxCommunicationMock.peerResponsiveness.returns({ responding: 0, total: 8 });
      let result = await stateMachine.manageFolderSyncState(mockParams);
      expect(result.syncthingFolder.type).to.not.equal('sendreceive');

      // Healed. The stale streak is gone, so the win must confirm afresh over
      // LEADER_CONFIRM_COUNT passes - deliberately not seeding on the first.
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
      for (let pass = 1; pass <= 2; pass += 1) {
        mockParams.receiveOnlySyncthingAppsCache.set('test-app', result.cache);
        // A liveness view is one pass's snapshot - the monitor builds a fresh
        // one each pass, and so does this loop, else the isolated verdict is
        // memoized across the heal.
        mockParams.liveness = createPeerFolderLiveness();
        // eslint-disable-next-line no-await-in-loop
        result = await stateMachine.manageFolderSyncState(mockParams);
        if (pass === 1) expect(result.syncthingFolder.type).to.not.equal('sendreceive');
      }
      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.designationPending).to.be.true;
    });

    it('does not seed a partial copy: a confirmed leader mid-sync stays receiveonly', async () => {
      // The seed path skips the sync check because a cold-start seed has nothing
      // to lose - an empty folder, or a synced survivor. A node can now reach the
      // seed election MID-SYNC (its source dropped from the election as provably
      // gone, the list collapsed to itself), and promoting there publishes a
      // partial copy as the truth: the missing files become deletions on every
      // peer the moment a source returns.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 100000, inSyncBytes: 40000, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
    });

    it('takes over when the elected holder is gone and this node is well connected', async () => {
      // The election picks by identity and carries no liveness, so a dead holder
      // keeps winning it and every survivor defers to a node that is not there -
      // until its location broadcast expires, 125 minutes later, with the app down
      // the whole time. This node is NOT the lowest IP, so without the exclusion it
      // would never elect itself at all.
      mockParams.localSocketAddr = '10.0.0.2:16127';
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      // the lowest-IP holder answers nothing; this node's own peers are fine
      axiosMock.get.rejects(new Error('connect ECONNREFUSED'));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
      // and the exclusion has its evidence: this node's syncthing was asked
      // about the holder's device and answered that it is not connected
      globalStateMock.syncthingDevicesIDCache.set('10.0.0.1:16127', 'HOLDER-DEVICE-ID');
      syncthingServiceMock.getDbCompletion.resolves({ remoteState: 'unknown', completion: 0, globalBytes: 0 });
      // the survivor had been syncing alongside and holds a full copy - a partial
      // survivor must NOT take over (covered by the partial-copy test above)
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 100000, inSyncBytes: 100000, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
    });

    it('cannot declare a holder gone without evidence - an unresolvable device keeps it', async () => {
      // Same silent holder, same healthy peers - but this node never resolved
      // the holder's syncthing device: its own process restarted during the
      // holder's outage, and a device it cannot ask about proves nothing.
      // Gone requires evidence, and the node with the least knowledge must
      // not be the one that authorises a second writer.
      mockParams.localSocketAddr = '10.0.0.2:16127';
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.rejects(new Error('connect ECONNREFUSED'));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
      // an empty folder, so no route to sendreceive exists except winning the
      // election - which requires the holder's exclusion, which has no evidence
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.not.equal('sendreceive');
      expect(result.cache.designationPending).to.not.equal(true);
      expect(result.cache.designatedLeader).to.not.equal(true);
    });

    it('leaves a holder whose syncthing is still connected in the election - its FluxOS is restarting, not gone', async () => {
      // FluxOS and syncthing are separate processes on that node. A FluxOS
      // restart takes the API away for tens of seconds while syncthing and the
      // container carry on writing, so API silence alone would drop a live
      // writer out of the election and put a second writable copy beside it.
      // A live sync connection is the evidence the API cannot give.
      mockParams.localSocketAddr = '10.0.0.2:16127';
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      // Same conditions as the takeover test above: the holder's API is silent
      // and this node's own peers are healthy. Only the sync connection differs.
      axiosMock.get.rejects(new Error('connect ECONNREFUSED'));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 100000, inSyncBytes: 100000, state: 'idle', receiveOnlyChangedFiles: 0,
      });
      globalStateMock.syncthingDevicesIDCache.set('10.0.0.1:16127', 'HOLDER-DEVICE-ID');
      syncthingServiceMock.getDbCompletion.resolves({ remoteState: 'valid', completion: 100, globalBytes: 100000 });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      // The holder stays in the election, so this node does not win it. Asserted
      // on the designation rather than on the folder type, because a synced
      // follower reaches sendreceive by its own route and that route is not what
      // this guard governs.
      expect(result.cache.designatedLeader).to.not.equal(true);
      // Asked about THIS folder: the completion endpoint's aggregate form never
      // sets remoteState, so a query without one reports 'unknown' and would
      // veto nothing.
      const asked = syncthingServiceMock.getDbCompletion.getCalls()
        .find((call) => call.args[0]?.device === 'HOLDER-DEVICE-ID');
      expect(asked, 'the holder was never asked about').to.not.equal(undefined);
      expect(asked.args[0].folder).to.equal('test-app');
    });

    it('leaves a holder that answers an error status in the election - it replied, so it is alive', async () => {
      // The whole second-writer path this PR could have shipped. /apps/promotedfolders
      // is new, so every node not yet upgraded answers 404 - and a 404 read as death
      // drops a live holder out of the election, lets this node win it, and puts a
      // second writable copy alongside a holder that is still writing. A reply is a
      // reply: silence is the only thing that means gone.
      mockParams.localSocketAddr = '10.0.0.2:16127';
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.rejects(httpStatus(404));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
      // An empty folder, so the election is the only thing that can promote here:
      // a synced one promotes on its own completion and would hide the answer.
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
    });

    it('keeps deferring to an unreachable holder when this node is the one cut off', async () => {
      // Identical failed request, opposite meaning. The holder is very likely still
      // serving on the other side of the split, and electing ourselves over it is a
      // second writable copy - the outage is the correct outcome here.
      mockParams.localSocketAddr = '10.0.0.2:16127';
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.rejects(new Error('connect ECONNREFUSED'));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 0, total: 8 });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
    });

    it('leaves the election alone while the elected holder still answers', async () => {
      // The probe runs on the deferring path every pass, so a reachable holder must
      // cost nothing but the request - it must not be dropped, and this node must
      // not elect itself over it.
      mockParams.localSocketAddr = '10.0.0.2:16127';
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.resolves({ data: { data: { ready: true, folders: [] } } });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
    });

    it('stays receiveonly when a peer already holds the writable copy', async () => {
      // Winning is not the same as winning first. The peer decided from a smaller
      // view of the holder list and promoted; promoting here too would leave two
      // writable copies of the same folder, and neither node revisits it.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.resolves({ data: { data: { ready: true, folders: ['test-app'] } } });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
      sinon.assert.notCalled(appReconcilerMock.setControllerDesired);
    });

    it('withdraws the designation when a gate turns the winner back', async () => {
      // masterSlaveApps reads this flag to skip the primary-selection index
      // stagger and start the container, so it has to mean "is the writable
      // holder". A node that wins the election and then stands down - here
      // because a peer already holds the copy - is not, and leaving the flag up
      // starts its primary against a folder it deliberately left receiveonly.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.resolves({ data: { data: { ready: true, folders: ['test-app'] } } });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.cache.designatedLeader).to.not.equal(true);
    });

    it('waits on a peer that has not determined its own folder state yet', async () => {
      // A booting peer cannot tell "I hold nothing" from "I have not looked", so its
      // empty list is not a clearance - a fleet-wide restart puts every holder of an
      // app in that state at once, and reading it as free promotes all of them.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.resolves({ data: { data: { ready: false, folders: [] } } });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
    });

    it('promotes once that peer has determined it holds nothing', async () => {
      // The wait needs no bound because it resolves itself: the peer completes its
      // pass and answers, or it stops responding and becomes the unreachable case,
      // which does not block.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.onFirstCall().resolves({ data: { data: { ready: false, folders: [] } } });
      axiosMock.get.resolves({ data: { data: { ready: true, folders: [] } } });
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const waited = await stateMachine.manageFolderSyncState(mockParams);
      expect(waited.syncthingFolder.type).to.equal('receiveonly');

      mockParams.syncthingFolder = { id: 'test-app', type: 'receiveonly', path: '/test/path' };
      // The next pass asks again. A pass's peer view never outlives it - carried
      // over, this node would still be holding the answer that made it wait.
      mockParams.liveness = createPeerFolderLiveness();
      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
    });

    it('promotes when no peer holds the writable copy', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.resolves({ data: { data: { ready: true, folders: [] } } });
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
    });

    it('promotes over an unreachable peer when this node is evidently well connected', async () => {
      // A node still trading pings with the fleet is watching one peer fall over,
      // not sitting in a partition. Deferring there would let a dead node strand the
      // app with no writable copy anywhere.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.rejects(new Error('connect ECONNREFUSED'));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
    });

    it('still seeds a cold start when a peer cannot be asked, instead of waiting to be upgraded', async () => {
      // The other half, and the reason a peer that cannot answer must not be filed
      // as "not ready yet": unready blocks with no bound, which it earns by
      // resolving itself. A peer that predates the endpoint never will. Blocking
      // there would hold this open until somebody upgrades that node - and since
      // every other holder defers to this same lowest IP, one un-upgraded peer
      // would stop the app starting anywhere at all.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.rejects(httpStatus(404));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
    });

    it('does not promote over an unreachable peer when this node is the one gone quiet', async () => {
      // Same failed request, opposite meaning. A node whose own peers have stopped
      // answering is the one that was cut off, and the holder it cannot reach is
      // very likely still running on the other side of the split - promoting there
      // is a second writable copy.
      //
      // Read from missed-pong state rather than the peer list on purpose: a socket
      // survives three missed rounds (~45s) before it is dropped, which lands after
      // the two confirmed passes (~30-60s) a promotion needs. Missed pongs move
      // within one ping round (~15s), so the signal arrives before the decision.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.rejects(new Error('connect ECONNREFUSED'));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 0, total: 8 });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
    });

    it('judges its connectivity proportionally, so a small fleet is not stalled forever', async () => {
      // An absolute floor would be a fleet size in disguise: a node holding two
      // peers could never clear a bar written for a node holding twelve, and would
      // refuse to promote over a genuinely dead holder for good.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.rejects(new Error('connect ECONNREFUSED'));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 2, total: 2 });
      // the survivor holds a full copy; the proportional bar is what is under test
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 100000, inSyncBytes: 100000, state: 'idle', receiveOnlyChangedFiles: 0,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
    });

    it('does not read having no peers at all as evidence of health', async () => {
      // Nobody to talk to is the isolation case, not a clean bill: this node holds
      // an app whose other holders demonstrably exist.
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      axiosMock.get.rejects(new Error('connect ECONNREFUSED'));
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 0, total: 0 });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
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
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 1000, inSyncBytes: 500, state: 'syncing' });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
      expect(result.cache.restarted).to.not.equal(true);
      expect(result.cache.leaderStreak).to.equal(1);
      // unconfirmed leadership must not claim the stagger skip
      expect(result.cache.designatedLeader).to.be.false;
    });

    it('withdraws the designated-leader claim when the election is lost', async () => {
      // a node that was on a leader streak but loses the election (a peer now
      // serves) must retract designatedLeader - a stale claim would let it
      // skip the primary-selection stagger it no longer deserves
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 3,
        designatedLeader: false,
      });
      mockParams.appLocation.resolves([
        { ip: '9.0.0.1:16127', runningSince: 1000, broadcastedAt: 900 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 1000, inSyncBytes: 500, state: 'syncing' });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.cache.leaderStreak).to.equal(0);
      expect(result.cache.designatedLeader).to.be.false;
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
      // the sources this folder was stalling against have gone entirely - their
      // index entries expired and the global collapsed to empty. The stall fields
      // above are the residue; an empty folder is the legitimate cold-start seed.
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 0,
      });

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
        globalBytes: 1000,
        inSyncBytes: 500,
        state: 'syncing',
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
        globalBytes: 1000,
        inSyncBytes: 1000,
        state: 'idle',
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
        globalBytes: 1000,
        inSyncBytes: 1000,
        state: 'idle',
        receiveOnlyChangedFiles: 1,
        receiveOnlyChangedBytes: 555,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.calledOnceWithExactly(syncthingServiceMock.dbRevert, 'test-app');
      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.be.false;
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
    });

    // B1 guard on the cold-start seed: a node holding its OWN data (preserved local
    // changes) on an empty global must WAIT for a connected source - never seed. Seeding
    // would promote unverified data, and a db/revert would delete the only copy. Even as
    // the lowest IP (which would win the seed election) and with a running peer present,
    // holding local data forces it to defer and take no action.
    it('does not seed on an empty global when it holds local data, even as the lowest IP', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5, // leadership would be confirmed if it elected itself
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 }, // self, lowest IP
        { ip: '10.0.0.2:16127', runningSince: 2000, broadcastedAt: 1000 }, // a running peer
      ]);
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 0, inSyncBytes: 0, state: 'idle', receiveOnlyChangedFiles: 2,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      // never seeds/promotes, never reverts the only copy - just waits, receiveonly
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
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
        globalBytes: 1000,
        inSyncBytes: 1000,
        state: 'idle',
        receiveOnlyChangedFiles: 2,
        receiveOnlyChangedBytes: 555,
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
      // synced, with local receive-only changes: the revert exemption is the
      // subject here - the leader's local data is the seed, so it promotes
      // without reverting. (A PARTIAL leader no longer promotes at all; that is
      // the partial-copy test above, not this one.)
      syncthingServiceMock.getDbStatus.resolves({
        globalBytes: 1000,
        inSyncBytes: 1000,
        state: 'idle',
        receiveOnlyChangedFiles: 7,
        receiveOnlyChangedBytes: 555,
      });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      sinon.assert.calledWith(appReconcilerMock.setControllerDesired, 'test-app', 'running');
    });

    // Pre-flip safety: completion metrics come from the index, and a stale index
    // claims bytes the disk does not hold. A folder must pass the sendreceive
    // safety verification BEFORE it flips - promoting first and demoting a cycle
    // later leaves a window where sendreceive broadcasts the missing files as
    // deletions.
    it('does not promote a synced folder whose index claims data over an empty disk', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.0:16127', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 1000, inSyncBytes: 1000, state: 'idle' });
      // only syncthing housekeeping on disk - no sync-scoped files
      fsMock.promises.readdir.resolves([dirent('.stignore'), dirent('backup', false)]);

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
    });

    it('does not let an elected leader seed when the index claims data over an empty disk', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 1000, inSyncBytes: 1000, state: 'idle' });
      fsMock.promises.readdir.resolves([dirent('.stignore'), dirent('backup', false)]);

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('receiveonly');
      expect(result.cache.restarted).to.not.equal(true);
      sinon.assert.neverCalledWith(appReconcilerMock.setControllerDesired, sinon.match.any, 'running');
    });

    it('still lets the leader seed a cold start (empty index over an empty disk)', async () => {
      mockParams.receiveOnlySyncthingAppsCache.set('test-app', {
        restarted: false,
        numberOfExecutions: 1,
        leaderStreak: 5,
      });
      mockParams.appLocation.resolves([
        { ip: '10.0.0.1:16127', runningSince: null, broadcastedAt: 1000 },
      ]);
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 0, inSyncBytes: 0, state: 'idle' });
      fsMock.promises.readdir.resolves([dirent('.stignore')]);

      const result = await stateMachine.manageFolderSyncState(mockParams);

      expect(result.syncthingFolder.type).to.equal('sendreceive');
      expect(result.cache.restarted).to.be.true;
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
        globalBytes: 1000,
        inSyncBytes: 500,
        state: 'syncing',
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
      syncthingServiceMock.getDbStatus.rejects(syncthingFailure('syncthing unavailable'));

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
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 1000, inSyncBytes: 500, state: 'idle' });
      syncthingServiceMock.getConfig = sinon.stub().resolves({ folders: [{ id: 'test-app', type: 'receiveonly', devices: [{ deviceID: 'DEVICE123' }] }] });
      syncthingServiceMock.getDbCompletion = sinon.stub().resolves(completionData ?? { completion: 100, globalBytes: 1000, remoteState: 'valid' });
    }

    it('should nudge the folder devices (pause/resume) when idle with no progress and a connected synced peer', async () => {
      setupIdleNoProgress({ lastProgressBytes: 500, lastProgressAt: Date.now() - 4 * MIN });

      const result = await stateMachine.manageFolderSyncState(mockParams);

      sinon.assert.calledOnce(syncthingServiceMock.systemPause);
      expect(syncthingServiceMock.systemPause.firstCall.args[0]).to.equal('DEVICE123');
      sinon.assert.calledOnce(syncthingServiceMock.systemResume);
      expect(syncthingServiceMock.systemResume.firstCall.args[0]).to.equal('DEVICE123');
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
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 1000, inSyncBytes: 500, state: 'sync-preparing' });

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
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 1000, inSyncBytes: 500, state: 'idle' });
      syncthingServiceMock.getConfig = sinon.stub().resolves({ folders: [{ id: componentId, type: 'receiveonly', devices: [{ deviceID: 'DEVICE123' }] }] });
      syncthingServiceMock.getDbCompletion = sinon.stub().resolves({ completion: 100, globalBytes: 1000, remoteState: 'valid' });

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
      syncthingServiceMock.getDbStatus.rejects(syncthingFailure('syncthing unavailable'));

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
      syncthingServiceMock.getConfig.resolves({ folders: [{ id: 'test-app', devices: deviceIds.map((deviceID) => ({ deviceID })) }] });
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
      expect(syncthingServiceMock.systemResume.secondCall.args[0]).to.equal('DEVICE_B');
    });
  });

  describe('verifyFolderMountSafety', () => {
    it('is unsafe when the dir is not mounted even if it has content', async () => {
      // the deletion-propagation regression: syncthing had pulled the master's
      // data onto the BARE dir, so content used to buy a pass while unmounted -
      // and the stale sendreceive folder then broadcast deletions to the master
      volumeServiceMock.isPathMounted.resolves(false);
      fsMock.promises.readdir.resolves([dirent('leaked.db')]);

      const result = await stateMachine.verifyFolderMountSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.false;
      expect(result.reason).to.equal('unmounted_with_content');
      expect(result.hasContent).to.be.true;
      sinon.assert.calledWith(appTamperingDetectionServiceMock.recordEvent, 'test-app', 'mount_vanished');
    });

    it('is unsafe when the dir is not mounted and empty', async () => {
      volumeServiceMock.isPathMounted.resolves(false);
      fsMock.promises.readdir.resolves([]);

      const result = await stateMachine.verifyFolderMountSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.false;
      expect(result.reason).to.equal('empty_unmounted_directory');
    });

    it('is safe when mounted with content', async () => {
      const result = await stateMachine.verifyFolderMountSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.true;
      expect(result.isMounted).to.be.true;
    });

    it('is unsafe when the base directory is missing', async () => {
      fsMock.promises.stat.rejects(new Error('ENOENT'));

      const result = await stateMachine.verifyFolderMountSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.false;
      expect(result.reason).to.equal('base_directory_missing');
    });
  });

  describe('mount-safety observation logging', () => {
    // eslint-disable-next-line global-require
    const log = require('../../ZelBack/src/lib/log');
    let sandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      sandbox.spy(log, 'warn');
      sandbox.spy(log, 'error');
      sandbox.spy(log, 'info');
    });

    afterEach(() => {
      sandbox.restore();
    });

    const callsMentioning = (spy, appId) => spy.getCalls().filter((c) => String(c.args[0]).includes(appId));

    it('logs a persistent mounted-but-empty observation once, not per pass', async () => {
      fsMock.promises.readdir.resolves([]); // mounted, no content

      await stateMachine.verifyFolderMountSafety('obs-empty-app', '/apps/obs-empty-app');
      await stateMachine.verifyFolderMountSafety('obs-empty-app', '/apps/obs-empty-app');
      await stateMachine.verifyFolderMountSafety('obs-empty-app', '/apps/obs-empty-app');

      expect(callsMentioning(log.warn, 'obs-empty-app')).to.have.lengthOf(1);
    });

    it('logs recovery once when the observation returns to ok', async () => {
      fsMock.promises.readdir.resolves([]);
      await stateMachine.verifyFolderMountSafety('obs-recover-app', '/apps/obs-recover-app');

      fsMock.promises.readdir.resolves([dirent('state.db')]);
      await stateMachine.verifyFolderMountSafety('obs-recover-app', '/apps/obs-recover-app');
      await stateMachine.verifyFolderMountSafety('obs-recover-app', '/apps/obs-recover-app');

      const recoveries = callsMentioning(log.info, 'obs-recover-app').filter((c) => String(c.args[0]).includes('recovered'));
      expect(recoveries).to.have.lengthOf(1);
    });

    it('logs again when the observation changes to a different condition', async () => {
      fsMock.promises.readdir.resolves([]); // mounted empty -> warn
      await stateMachine.verifyFolderMountSafety('obs-change-app', '/apps/obs-change-app');
      expect(callsMentioning(log.warn, 'obs-change-app')).to.have.lengthOf(1);

      volumeServiceMock.isPathMounted.resolves(false); // unmounted now -> error
      await stateMachine.verifyFolderMountSafety('obs-change-app', '/apps/obs-change-app');
      await stateMachine.verifyFolderMountSafety('obs-change-app', '/apps/obs-change-app');

      expect(callsMentioning(log.error, 'obs-change-app')).to.have.lengthOf(1);
    });

    it('re-logs a persisting unsafe observation after the relog interval', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['hrtime'] });
      try {
        fsMock.promises.readdir.resolves([]);
        await stateMachine.verifyFolderMountSafety('obs-relog-app', '/apps/obs-relog-app');
        expect(callsMentioning(log.warn, 'obs-relog-app')).to.have.lengthOf(1);

        clock.tick(6 * 60 * 1000); // past the 5-minute relog interval
        await stateMachine.verifyFolderMountSafety('obs-relog-app', '/apps/obs-relog-app');

        expect(callsMentioning(log.warn, 'obs-relog-app')).to.have.lengthOf(2);
      } finally {
        clock.restore();
      }
    });
  });

  describe('verifySendReceiveFolderSafety', () => {
    it('is unsafe when the index claims data but the disk holds no sync-scoped files', async () => {
      // stale ("phantom") index over a fresh empty volume: only FluxOS's own
      // housekeeping (.stignore, backup/) on disk, yet the index claims bytes -
      // sendreceive would broadcast every "missing" file as a deletion
      fsMock.promises.readdir.resolves([dirent('.stignore'), dirent('backup', false)]);
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 500000, inSyncBytes: 500000, state: 'idle' });

      const result = await stateMachine.verifySendReceiveFolderSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.false;
      expect(result.reason).to.equal('phantom_index_empty_disk');
    });

    it('is safe when the synced payload is only (empty) directories', async () => {
      // real 2026-07-04 false positive: an app whose synced content is empty
      // directories. The index counts each directory entry (globalBytes 256)
      // while the disk holds no regular file, so a files-only walk wrongly
      // called it a phantom index and the reconciler stopped the container
      // (exit 137) and held it down. Directories must count as content.
      fsMock.promises.readdir.resolves([]); // nested dirs are empty
      fsMock.promises.readdir.withArgs('/apps/test-app').resolves([
        dirent('.stignore'), dirent('.stfolder', false), dirent('data', false),
      ]);
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 256, inSyncBytes: 256, state: 'idle' });

      const result = await stateMachine.verifySendReceiveFolderSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.true;
    });

    it('still flags a phantom when only housekeeping survives a wiped disk', async () => {
      // the guard must keep protecting: a genuinely wiped volume keeps only what
      // FluxOS/syncthing recreate - .stignore, the .stfolder marker, the ignored
      // backup/ - none of which is synced payload, so an index that still claims
      // bytes is a stale index over an empty disk and must stay blocked.
      fsMock.promises.readdir.resolves([]);
      fsMock.promises.readdir.withArgs('/apps/test-app').resolves([
        dirent('.stignore'), dirent('.stfolder', false), dirent('backup', false),
      ]);
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 500000, inSyncBytes: 0, state: 'idle' });

      const result = await stateMachine.verifySendReceiveFolderSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.false;
      expect(result.reason).to.equal('phantom_index_empty_disk');
    });

    it('is safe on an empty disk when the index is empty too (cold-start seed)', async () => {
      fsMock.promises.readdir.resolves([dirent('.stignore')]);
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 0, inSyncBytes: 0, state: 'idle' });

      const result = await stateMachine.verifySendReceiveFolderSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.true;
    });

    it('is safe when the disk holds real data matching a non-empty index', async () => {
      syncthingServiceMock.getDbStatus.resolves({ globalBytes: 500000, inSyncBytes: 500000, state: 'idle' });

      const result = await stateMachine.verifySendReceiveFolderSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.true;
    });

    it('falls back to the mount-level verdict when the sync status is unreadable', async () => {
      syncthingServiceMock.getDbStatus.rejects(new Error('syncthing down'));

      const result = await stateMachine.verifySendReceiveFolderSafety('test-app', '/apps/test-app');

      expect(result.isSafe).to.be.true;
    });
  });
});
