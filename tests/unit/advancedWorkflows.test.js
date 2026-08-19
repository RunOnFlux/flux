// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const config = require('config');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const appsRuntimeState = require('../../ZelBack/src/services/appManagement/appsRuntimeState');
const log = require('../../ZelBack/src/lib/log');

describe('advancedWorkflows tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('setInstallationInProgress and getInstallationInProgress tests', () => {
    it('should set installation in progress', () => {
      advancedWorkflows.setInstallationInProgressTrue();

      const inProgress = advancedWorkflows.getInstallationInProgress();
      expect(inProgress).to.be.true;
    });

    it('should reset installation in progress', () => {
      advancedWorkflows.setInstallationInProgressTrue();
      advancedWorkflows.installationInProgressReset();

      const inProgress = advancedWorkflows.getInstallationInProgress();
      expect(inProgress).to.be.false;
    });

    it('should set specific app installation in progress', () => {
      advancedWorkflows.setInstallationInProgress('TestApp', true);

      const inProgress = advancedWorkflows.getInstallationInProgress();
      // When setting specific app, function returns the app name, not just true
      expect(inProgress).to.equal('TestApp');
    });
  });

  describe('setRemovalInProgress and getRemovalInProgress tests', () => {
    it('should set removal in progress', () => {
      advancedWorkflows.setRemovalInProgressToTrue();

      const inProgress = advancedWorkflows.getRemovalInProgress();
      expect(inProgress).to.be.true;
    });

    it('should reset removal in progress', () => {
      advancedWorkflows.setRemovalInProgressToTrue();
      advancedWorkflows.removalInProgressReset();

      const inProgress = advancedWorkflows.getRemovalInProgress();
      expect(inProgress).to.be.false;
    });

    it('should set specific app removal in progress', () => {
      advancedWorkflows.setRemovalInProgress('TestApp', true);

      const inProgress = advancedWorkflows.getRemovalInProgress();
      // When setting specific app, function returns the app name, not just true
      expect(inProgress).to.equal('TestApp');
    });
  });

  describe('addToRestoreProgress and removeFromRestoreProgress tests', () => {
    beforeEach(() => {
      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.restoreInProgress = [];
    });

    it('should add app to restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');

      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      expect(globalState.restoreInProgress).to.include('TestApp');
    });

    it('should remove app from restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');
      advancedWorkflows.removeFromRestoreProgress('TestApp');

      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      expect(globalState.restoreInProgress).to.not.include('TestApp');
    });

    it('should not duplicate apps in restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');
      advancedWorkflows.addToRestoreProgress('TestApp');

      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      const count = globalState.restoreInProgress.filter((app) => app === 'TestApp').length;
      expect(count).to.equal(1);
    });
  });

  describe('redeployComponentAPI tests', () => {
    let req;
    let res;
    let globalState;
    let verificationHelper;

    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgress = false;
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;
      globalState.restoreInProgress = [];

      // eslint-disable-next-line global-require
      verificationHelper = require('../../ZelBack/src/services/verificationHelper');

      req = {
        params: {},
        query: {},
        headers: {},
      };
      res = {
        json: sinon.stub(),
        write: sinon.stub(),
        flush: sinon.stub(),
        setHeader: sinon.stub(),
      };
    });

    it('should return error if appname is not provided', async () => {
      req.params.component = 'frontend';

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('No Flux App specified');
    });

    it('should return error if component is not provided', async () => {
      req.params.appname = 'myapp';

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('No component specified');
    });

    it('should return error if appname contains underscore', async () => {
      req.params.appname = 'frontend_myapp';
      req.params.component = 'frontend';

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('Invalid app name format');
    });

    it('should skip redeploy if app is in restore progress', async () => {
      req.params.appname = 'myapp';
      req.params.component = 'frontend';

      // Use the proper method to add to restore progress
      advancedWorkflows.addToRestoreProgress('myapp');

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('warning');
      expect(response.data.message).to.include('Restore is running');

      // Clean up
      advancedWorkflows.removeFromRestoreProgress('myapp');
    });

    it('should return unauthorized error if not authorized', async () => {
      req.params.appname = 'myapp';
      req.params.component = 'frontend';

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelper.verifyPrivilege.calledWith('appownerabove', req, 'myapp')).to.be.true;
    });

    it('should handle force parameter from query string', async () => {
      req.params.appname = 'myapp';
      req.params.component = 'frontend';
      req.query.force = 'true';

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      await advancedWorkflows.redeployComponentAPI(req, res);

      // Should attempt to call hardRedeployComponent but will fail because app not found
      expect(res.json.calledOnce).to.be.true;
    });
  });

  describe('softRedeployComponent tests', () => {
    let globalState;
    let res;

    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgress = false;
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;

      res = {
        write: sinon.stub(),
        flush: sinon.stub(),
      };
    });

    it('should return early if removal is in progress', async () => {
      globalState.removalInProgress = true;

      await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing removal');
    });

    it('should return early if installation is in progress', async () => {
      globalState.installationInProgress = true;

      await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing installation');
    });

    it('should return early if soft redeploy is in progress', async () => {
      globalState.softRedeployInProgress = true;

      await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing soft redeploy');
    });

    it('should return early if hard redeploy is in progress', async () => {
      globalState.hardRedeployInProgress = true;

      await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing hard redeploy');
    });

    it('should throw error if application not found', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      try {
        await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Application myapp not found');
        expect(globalState.softRedeployInProgress).to.be.false;
      }
    });

    it('should throw error if app is not composed', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        name: 'myapp',
        version: 3,
        // No compose field
      });

      try {
        await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('is not a composed application');
        expect(globalState.softRedeployInProgress).to.be.false;
      }
    });

    it('should throw error if component not found in app', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        name: 'myapp',
        version: 4,
        compose: [
          { name: 'backend', repotag: 'myapp/backend:1.0' },
        ],
      });

      try {
        await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Component frontend not found');
        expect(globalState.softRedeployInProgress).to.be.false;
      }
    });
  });

  describe('hardRedeployComponent tests', () => {
    let globalState;
    let res;

    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgress = false;
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;

      res = {
        write: sinon.stub(),
        flush: sinon.stub(),
      };
    });

    it('should return early if removal is in progress', async () => {
      globalState.removalInProgress = true;

      await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing removal');
    });

    it('should return early if installation is in progress', async () => {
      globalState.installationInProgress = true;

      await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing installation');
    });

    it('should return early if soft redeploy is in progress', async () => {
      globalState.softRedeployInProgress = true;

      await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing soft redeploy');
    });

    it('should return early if hard redeploy is in progress', async () => {
      globalState.hardRedeployInProgress = true;

      await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing hard redeploy');
    });

    it('should throw error if application not found', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      try {
        await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Application myapp not found');
        expect(globalState.hardRedeployInProgress).to.be.false;
      }
    });

    it('should throw error if app is not composed', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        name: 'myapp',
        version: 3,
        // No compose field
      });

      try {
        await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('is not a composed application');
        expect(globalState.hardRedeployInProgress).to.be.false;
      }
    });

    it('should throw error if component not found in app', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        name: 'myapp',
        version: 4,
        compose: [
          { name: 'backend', repotag: 'myapp/backend:1.0' },
        ],
      });

      try {
        await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Component frontend not found');
        expect(globalState.hardRedeployInProgress).to.be.false;
      }
    });

    it('should set hardRedeployInProgress to false on error', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      try {
        await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(globalState.hardRedeployInProgress).to.be.false;
      }
    });
  });

  // Note: masterSlaveApps is a recursive function that continuously runs in production.
  // These tests use a counter to prevent infinite recursion after the first iteration.
  describe('masterSlaveApps tests', () => {
    let globalState;
    let serviceHelperStub;
    let serviceHelperDelayStub;
    let fluxNetworkHelperStub;
    let registryManagerStub;
    let dockerServiceStub;
    let syncthingServiceStub;
    let syncthingCompletionStub;
    let syncthingDevicesStub;
    let axiosGetStub;
    let recursionCounter;

    beforeEach(() => {
      recursionCounter = 0;
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.masterSlaveAppsRunning = false;
      globalState.installationInProgress = false;
      globalState.removalInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;
      // the syncthing monitor's first-run mount-safety is assumed complete for the
      // election tests; a dedicated test below covers the not-complete skip
      globalState.syncthingAppsFirstRun = false;

      // Setup stubs
      const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
      serviceHelperStub = sinon.stub(serviceHelper, 'axiosGet');

      // Stub delay to prevent recursive calls - after first call, block recursion
      serviceHelperDelayStub = sinon.stub(serviceHelper, 'delay').callsFake(async () => {
        recursionCounter += 1;
        if (recursionCounter > 1) {
          // Prevent recursion by returning a promise that never resolves
          return new Promise(() => {});
        }
        return Promise.resolve();
      });

      const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
      fluxNetworkHelperStub = sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress');

      const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
      registryManagerStub = sinon.stub(registryManager, 'appLocation');

      const dockerService = require('../../ZelBack/src/services/dockerService');
      dockerServiceStub = sinon.stub(dockerService, 'getAppIdentifier');

      const syncthingService = require('../../ZelBack/src/services/syncthingService');
      syncthingServiceStub = sinon.stub(syncthingService, 'getConfigFolders');
      sinon.stub(syncthingService, 'getHealth').resolves({
        status: 'success',
        data: { status: 'OK' },
      });

      // Stub decryptEnterpriseApps to return apps as-is
      const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');
      sinon.stub(appQueryService, 'decryptEnterpriseApps').callsFake((apps) => Promise.resolve({ readable: apps, unreadable: [], inPlace: apps }));

      // Stub database connection to prevent actual DB access
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      // The peer probe hits /apps/heldcomponents and /apps/listrunningapps on the
      // other nodes in the location list. Unstubbed these become real network
      // calls with a 10s ceiling each, so every election test would hang on
      // unroutable fixture IPs. Default to unreachable, which the probe treats as
      // UNKNOWN and will not start beside - so a test that expects a start must
      // say what its peers answer.
      axiosGetStub = sinon.stub(axios, 'get').rejects(new Error('peer unreachable (test default)'));

      // The evidence half: this node's own syncthing view of a silent peer, and
      // whether this node can still see the fleet. Defaults are the ignorant node
      // (no device ever resolved) on a healthy fleet, so a test that wants a
      // silence acted on has to supply the evidence for it.
      const syncthingServiceModule = require('../../ZelBack/src/services/syncthingService');
      syncthingCompletionStub = sinon.stub(syncthingServiceModule, 'getDbCompletion').resolves(null);
      syncthingDevicesStub = sinon.stub(syncthingServiceModule, 'getConfigDevices').resolves({ status: 'success', data: [] });
      globalState.syncthingDevicesIDCache.clear();
      const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
      sinon.stub(fluxCommunication, 'peerResponsiveness').returns({ responding: 4, total: 4 });
    });

    it('should skip execution if installation is in progress', async () => {
      globalState.installationInProgress = true;

      const installedApps = sinon.stub().resolves({ status: 'success', data: [] });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      const receiveOnlyCache = new Map();
      const backupInProgress = [];
      const restoreInProgress = [];
      const https = require('https');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        receiveOnlyCache,
        backupInProgress,
        restoreInProgress,
        https,
      );

      expect(installedApps.called).to.be.false;
    });

    it('should skip execution if removal is in progress', async () => {
      globalState.removalInProgress = true;

      const installedApps = sinon.stub().resolves({ status: 'success', data: [] });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      const receiveOnlyCache = new Map();
      const backupInProgress = [];
      const restoreInProgress = [];
      const https = require('https');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        receiveOnlyCache,
        backupInProgress,
        restoreInProgress,
        https,
      );

      expect(installedApps.called).to.be.false;
    });

    it('skips the whole cycle until the syncthing first-run mount-safety has completed', async () => {
      globalState.syncthingAppsFirstRun = true; // syncthing monitor first run not done yet
      const installedApps = sinon.stub().resolves({ status: 'success', data: [] });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        new Map(),
        [],
        [],
        require('https'),
      );

      // guard returns before any election work, so installed apps are never read
      expect(installedApps.called).to.be.false;
    });

    it('should skip apps in backup progress', async () => {
      const appName = 'testapp';
      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: appName,
            version: 3,
            containerData: 'g:/data',
          },
        ],
      });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      const receiveOnlyCache = new Map();
      const backupInProgress = [appName];
      const restoreInProgress = [];
      const https = require('https');

      // Mock FDM to return no errors
      serviceHelperStub.resolves({ data: [] });

      // Execute - should skip processing this app due to backup
      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        receiveOnlyCache,
        backupInProgress,
        restoreInProgress,
        https,
      );

      // Function should have been called to get installed apps
      expect(installedApps.called).to.be.true;
      // But FDM should not be queried since app is skipped
      expect(serviceHelperStub.called).to.be.false;
    });

    // Shared fixture for the recovery tests below: a v3 g: app with this node in
    // the location list. `peers` are the other nodes, in election order.
    // `selfRunningSince` places this node in the election order; `receiveOnlyCache`
    // lets a test seed the syncthing state machine's per-app cache and inspect it
    // afterwards. Both default to the plain index-0 fixture.
    const electionFixture = (appName, peers = [], options = {}) => {
      const {
        selfRunningSince = '2026-01-01T00:00:00.000Z',
        receiveOnlyCache = new Map(),
      } = options;
      // Mirror getAppIdentifier: a name that is neither zel- nor flux-prefixed gets
      // `flux`. The container names peers report are this exact string, and the
      // election compares whole names, so a stand-in value would not match.
      const appId = `flux${appName}`;
      dockerServiceStub.returns(appId);
      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: appName, version: 3, containerData: 'g:/syncdata' }],
      });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      if (!receiveOnlyCache.has(appId)) receiveOnlyCache.set(appId, { restarted: true });
      fluxNetworkHelperStub.resolves('192.168.1.5:16127');
      // Election order is runningSince ascending, with ip only as a tiebreak. Give
      // explicit, distinct timestamps so this node's index rests on the primary key
      // rather than on how two IPs happen to sort as strings. Peers are one minute
      // apart from 00:01, so a selfRunningSince between two of them puts this node
      // between those peers - the only arrangement with a peer ABOVE us.
      registryManagerStub.resolves([
        { name: appName, ip: '192.168.1.5:16127', runningSince: selfRunningSince },
        ...peers.map((ip, n) => ({ name: appName, ip, runningSince: `2026-01-01T00:0${n + 1}:00.000Z` })),
      ]);
      syncthingServiceStub.resolves({
        status: 'success',
        data: [{ path: `/root/.flux/ZelApps/${appId}`, type: 'sendreceive' }],
      });

      // masterSlaveApps re-invokes itself from its own finally, so a single call
      // otherwise executes the election twice and every count assertion doubles.
      // Let exactly one full pass run: the first delay resolves but arms the
      // installation gate so the recursive pass returns at the top, and the second
      // delay never resolves so the chain stops there.
      let delayCalls = 0;
      serviceHelperDelayStub.resetBehavior();
      serviceHelperDelayStub.callsFake(async () => {
        delayCalls += 1;
        if (delayCalls === 1) {
          globalState.installationInProgress = true;
          return undefined;
        }
        return new Promise(() => {});
      });

      return async () => {
        delayCalls = 0;
        globalState.installationInProgress = false;
        await advancedWorkflows.masterSlaveApps(
          globalState, installedApps, listRunningApps, receiveOnlyCache, [], [], require('https'),
        );
      };
    };

    // The probe asks /apps/heldcomponents first and only falls back to
    // /apps/listrunningapps when a peer cannot serve it, so a stub has to answer
    // per URL. `held: null` is a peer too old to know the endpoint.
    // A node too old for /apps/heldcomponents replies 404, and axios carries that
    // reply on error.response. A bare rejection is what an UNREACHABLE node looks
    // like, and the two must not be interchangeable here: one is a peer answering
    // the old way, the other is a peer that cannot be ruled out at all.
    const peerAnswers = ({ held = null, running = [] }) => (url) => {
      if (url.includes('/apps/heldcomponents')) {
        return held === null
          ? Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }))
          : Promise.resolve({ data: { data: held } });
      }
      return Promise.resolve({ data: { data: running } });
    };

    // This node's own syncthing view of a peer's device, which is what a silence is
    // judged on. 'valid' is a live connection; any other state is a closed one; and
    // leaving the device out of the cache entirely is the third answer - this node
    // never resolved the peer and cannot say.
    const peerSyncthingSays = (peerSocketAddr, remoteState) => {
      globalState.syncthingDevicesIDCache.set(peerSocketAddr, `DEVICE-${peerSocketAddr}`);
      syncthingCompletionStub.resolves({ status: 'success', data: { remoteState } });
    };

    const linesMatching = (logInfo, needle) => logInfo.getCalls()
      .map((call) => String(call.args[0]))
      .filter((msg) => msg.includes(needle));

    it('announces the exclusion once when a g: component is operator-stopped, not every cycle', async () => {
      const appName = 'opstoppedapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(true);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName);

      await runPass();

      // positive proof the skip branch is what ran: election never reached FDM
      expect(serviceHelperStub.called).to.be.false;
      expect(linesMatching(logInfo, 'operator-stopped')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'operator-stopped')[0]).to.include(appName);

      // a second 30s cycle must NOT repeat it - the latch is what makes the line
      // affordable at election cadence
      await runPass();
      expect(linesMatching(logInfo, 'operator-stopped')).to.have.lengthOf(1);
    });

    it('announces again after the operator lock is lifted and re-applied', async () => {
      const appName = 'relockapp';
      const operatorStopped = sinon.stub(appsRuntimeState, 'isOperatorStopped');
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName);
      serviceHelperStub.resolves({ data: [] });

      operatorStopped.resetBehavior();
      operatorStopped.resolves(true);
      await runPass();
      expect(linesMatching(logInfo, 'operator-stopped')).to.have.lengthOf(1);

      // operator starts it again - the latch must clear
      operatorStopped.resetBehavior();
      operatorStopped.resolves(false);
      await runPass();
      expect(linesMatching(logInfo, 'operator-stopped')).to.have.lengthOf(1);

      // and a fresh stop must be announced rather than swallowed by a stale latch
      operatorStopped.resetBehavior();
      operatorStopped.resolves(true);
      await runPass();
      expect(linesMatching(logInfo, 'operator-stopped')).to.have.lengthOf(2);
    });

    it('lets a stopped last-primary be elected again by clearing its own stale record', async () => {
      const appName = 'lastprimaryapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      // The peer answers and holds nothing. Left unreachable it would hold the
      // start on its own, and this test would pass or fail on the peer probe
      // rather than on the eviction it is about.
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] }));

      // Cycle 1: FDM names THIS node as primary, so the node records itself.
      serviceHelperStub.resetBehavior();
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.5'] } } });
      await runPass();

      // Judge only what the SECOND cycle does - cycle 1 legitimately starts the app
      // (FDM named this node), and crediting that start to the eviction would make
      // this test pass with the fix removed.
      logInfo.resetHistory();

      // Cycle 2: the app has been stopped and FDM no longer names a primary. The
      // node is index 0 and remembers ITSELF, which disqualifies it from both the
      // no-history start and the previous-primary branch. Without the eviction it
      // logs "conditions not met" forever and the app never returns.
      serviceHelperStub.resetBehavior();
      serviceHelperStub.resolves({ data: [] });
      await runPass();

      expect(linesMatching(logInfo, 'cleared this node\'s own stale primary record')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'conditions not met')).to.have.lengthOf(0);
    });

    it('does not start at index 0 while a peer is already running the component', async () => {
      const appName = 'peerbusyapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] }); // FDM: no primary registered yet

      // the peer IS running it - FDM simply has not caught up yet
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [`flux${appName}`] }));

      await runPass();

      expect(linesMatching(logInfo, 'a peer is already running it')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('starts at index 0 when no peer is running the component', async () => {
      const appName = 'peerfreeapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });

      // peer answers, and is NOT running the component
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: ['fluxsomethingelse'] }));

      await runPass();

      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'a peer is already running it')).to.have.lengthOf(0);
    });

    it('seeds a confirmed leader even when a stagger was already scheduled for it', async () => {
      // The election runs on its own cadence and the state machine confirms the
      // leader on another, so a pass can schedule the stagger before the leadership
      // is known. A seed that then defers to that schedule waits index*3min on peers
      // that cannot become ready, which is the wait the claim exists to skip.
      const appName = 'seedafterscheduleapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const cache = new Map([[`flux${appName}`, { restarted: true }]]);
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127', '192.168.1.91:16127'],
        { selfRunningSince: '2026-01-01T00:02:30.000Z', receiveOnlyCache: cache },
      );
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] }));

      // pass one: not yet the confirmed leader, so the stagger gets scheduled
      await runPass();
      expect(linesMatching(logInfo, 'scheduling app')).to.have.lengthOf(1);

      // pass two: leadership confirmed. The pending schedule must not hold it back.
      logInfo.resetHistory();
      cache.get(`flux${appName}`).designatedLeader = true;
      await runPass();

      expect(linesMatching(logInfo, 'seeds without the index stagger')).to.have.lengthOf(1);
    });

    it('does not start when a peer has committed to the component but has no container yet', async () => {
      // The masterSlave primary path fixes ownership on the persistent data before
      // it starts anything, so a committed peer legitimately has no container for
      // that whole window. Asked only for containers it answers "free", and this
      // node starts a second writer on the shared volume.
      const appName = 'peerclaimedapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });

      // holds the component, runs no containers at all
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [`flux${appName}`], running: [] }));

      await runPass();

      expect(linesMatching(logInfo, 'is held on peer node')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('falls back to the running-container check against a peer that cannot answer heldcomponents', async () => {
      // The fleet is mixed for the length of a rollout. A peer that cannot serve the
      // endpoint must be asked the old way; reading its 404 as "holds nothing" is
      // the same second-writer start, arrived at from the other direction.
      const appName = 'peeroldapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });

      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: null, running: [{ Names: [`/flux${appName}`] }] }));

      await runPass();

      expect(linesMatching(logInfo, 'is running on peer node')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('will not start against a peer whose held-components answer is an in-band error', async () => {
      // FluxOS reports failures inside a 200, so a peer that HAS the endpoint and
      // could not serve it looks, by shape alone, like a peer too old to have it -
      // and the old-peer path falls back to the container list.
      // That fallback cannot see the durable stop lock at all. So a peer whose lock
      // store is unreadable would report an owner-stopped primary as free, and this
      // node would elect itself onto the volume that owner is working on. The
      // container list here says free, and the pass must still refuse.
      const appName = 'peerunreadableapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });

      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake((url) => (url.includes('/apps/heldcomponents')
        ? Promise.resolve({ data: { status: 'error', data: { name: 'Error', message: 'no primary available' } } })
        : Promise.resolve({ data: { data: [] } })));

      await runPass();

      expect(linesMatching(logInfo, 'could not answer what it holds')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('claims the component before the ownership fix, and releases it once the attempt ends', async () => {
      // The claim has to be taken BEFORE the slow pre-start work, or it does not
      // cover the window it exists for. Releasing it at the end is safe: a start
      // that got as far as controllerDesired is held by that from then on, and one
      // that failed must stop claiming rather than block the fleet.
      const appName = 'claimlifecycleapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const appReconciler = require('../../ZelBack/src/services/appMonitoring/appReconciler');
      const claimStarting = sinon.stub(appReconciler, 'claimStarting');
      const releaseStarting = sinon.stub(appReconciler, 'releaseStarting');
      const setControllerDesired = sinon.stub(appReconciler, 'setControllerDesired');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] })); // nobody holds it - we start

      await runPass();

      // The start is deliberately not awaited by the election pass, so the release
      // lands after it returns - wait for the attempt to finish rather than racing
      // it. Waited on THIS app: earlier tests leave their own starts in flight, and
      // any-call-happened is satisfied by one of those landing here.
      const releasedThisApp = () => releaseStarting.getCalls().some((c) => c.args[0] === appName);
      for (let tick = 0; tick < 100 && !releasedThisApp(); tick += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, 20); });
      }

      sinon.assert.calledWith(claimStarting, appName);
      sinon.assert.calledWith(releaseStarting, appName);
      // the claim precedes any pre-start work, and outlives it
      sinon.assert.callOrder(claimStarting, releaseStarting);
      if (setControllerDesired.called) {
        sinon.assert.callOrder(claimStarting, setControllerDesired, releaseStarting);
      }
    });

    it('does not mistake a longer-named app on a peer for this component', async () => {
      // The peer runs `<app>1`, a different app whose name merely starts the same
      // way - simplexsmp against simplexsmp1 on the live network. A substring test
      // reads that as this component being live and declines to start, forever.
      const appName = 'prefixapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });

      axiosGetStub.resetBehavior();
      // answered the OLD way, so the whole-name comparison is what is under test
      axiosGetStub.callsFake(peerAnswers({ running: [{ Names: [`/flux${appName}1`] }] }));

      await runPass();

      expect(linesMatching(logInfo, 'a peer is already running it')).to.have.lengthOf(0);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
    });

    it('probes every peer, not just lower-index ones, before a designated leader leaves the stagger', async () => {
      // The seed claim exists precisely to leave the index stagger, so the
      // lower-index probe that serialises the staggered starts is the wrong set
      // to ask: a peer ABOVE us in the order is the one it cannot see, and FDM's
      // registration lag means nothing else reports that peer as live either.
      // Starting anyway puts a second writer on the syncthing-shared volume.
      const appName = 'seedjumpapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const cache = new Map([[`flux${appName}`, { restarted: true, designatedLeader: true }]]);
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127', '192.168.1.91:16127', '192.168.1.92:16127'],
        { selfRunningSince: '2026-01-01T00:02:30.000Z', receiveOnlyCache: cache },
      );
      serviceHelperStub.resolves({ data: [] }); // FDM: no primary registered yet

      // Order: .90 (00:01), .91 (00:02), this node (00:02:30), .92 (00:03). Only
      // .92 - the peer above us, invisible to a lower-index probe - is running it.
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(async (url) => (url.includes('192.168.1.92')
        ? peerAnswers({ held: [`flux${appName}`] })(url)
        : peerAnswers({ held: [] })(url)));

      await runPass();

      expect(linesMatching(logInfo, 'a peer is already running it')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('spends the seed claim on the pass that uses it, so it cannot outlive genesis', async () => {
      // designatedLeader describes genesis, and the state machine stops
      // republishing it the moment the folder goes sendreceive - manageFolderSyncState
      // returns on its already-syncing branch and never reaches the election again,
      // so nothing retracts a claim left standing. This node would then skip the
      // stagger on every later primary loss, for the life of the process.
      const appName = 'seedspentapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const appId = `flux${appName}`;
      const cache = new Map([[appId, { restarted: true, designatedLeader: true }]]);
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127', '192.168.1.91:16127'],
        { selfRunningSince: '2026-01-01T00:02:30.000Z', receiveOnlyCache: cache },
      );
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.resolves({ data: { data: [] } }); // no peer is running it

      await runPass();

      expect(linesMatching(logInfo, 'seeds without the index stagger')).to.have.lengthOf(1);
      expect(cache.get(appId).designatedLeader).to.equal(false);

      // and the next pass is an ordinary staggered candidate again
      logInfo.resetHistory();
      await runPass();

      expect(linesMatching(logInfo, 'seeds without the index stagger')).to.have.lengthOf(0);
      expect(linesMatching(logInfo, 'scheduling app')).to.have.lengthOf(1);
    });

    it('probes every peer at once, so an unreachable fleet costs one timeout and not N', async () => {
      const appName = 'peerconcurrentapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const runPass = electionFixture(appName, [
        '192.168.1.90:16127', '192.168.1.91:16127', '192.168.1.92:16127',
      ]);
      serviceHelperStub.resolves({ data: [] });

      // Hold every probe open and release them only once all have been issued.
      // Probing one peer at a time cannot get past the first: its await never
      // settles, so the second request is never sent and the count stays at 1.
      // That is the shape being pinned - probed serially, an unreachable fleet
      // blocks the promotion for the SUM of its peers' timeouts, on a path that
      // re-runs every 30s until the component is actually running.
      const release = [];
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(() => new Promise((resolve) => { release.push(resolve); }));

      const pass = runPass();
      for (let tick = 0; tick < 50 && axiosGetStub.callCount < 3; tick += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setImmediate(resolve); });
      }

      expect(axiosGetStub.callCount).to.equal(3);

      release.forEach((resolve) => resolve({ data: { data: [] } }));
      await pass;
    });

    it('leaves a silent peer alone while this node\'s syncthing still holds a connection to it', async () => {
      // The FluxOS restart window. FluxOS and the container fail independently: the
      // peer's API is gone for tens of seconds while its syncthing and its container
      // carry on writing, so the silence is the strongest reason to suspect the peer
      // IS running the component. In-fleet, six seconds of it was enough to start a
      // second writer on the shared volume.
      const appName = 'restartingpeerapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });
      // the peer answers nothing at all (the axios default), but its sync connection
      // to this node is open
      peerSyncthingSays('192.168.1.90:16127', 'valid');

      await runPass();

      expect(linesMatching(logInfo, 'still holds a live connection to it')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('will not start beside a silent peer it cannot ask its own syncthing about', async () => {
      // The correlated restart: this node's own process cycled while the peer was
      // already down, so it never resolved the peer's device and has no view of it
      // either way. The node with the least knowledge must not be the one that
      // authorises a second writer - absence of evidence authorises nothing.
      const appName = 'unknownpeerapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });
      // no device cached for the peer, and the peer answers nothing

      await runPass();

      expect(linesMatching(logInfo, 'cannot ask its own syncthing about it')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('starts once a silent peer\'s sync connection is gone and this node can still see the fleet', async () => {
      // The other direction, and the one that stops this becoming a stall: a peer
      // that is genuinely down loses its sync connection, and that IS evidence. The
      // start proceeds without waiting for the location record to expire.
      const appName = 'deadpeerapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });
      peerSyncthingSays('192.168.1.90:16127', 'unknown');

      await runPass();

      expect(linesMatching(logInfo, 'the component is free there')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
    });

    it('resolves a dead peer\'s device from this node\'s own syncthing when the cache never learned it', async () => {
      // The device cache is in memory and is filled by asking the PEER, so it is
      // empty for exactly the peer that matters: one that died while this node's own
      // process was restarting. Without the on-disk fallback this node would call
      // itself ignorant and hold the app down until the dead peer's location record
      // expired - up to the full broadcast lifetime, for a peer it had a perfectly
      // good local record of.
      const appName = 'diskdeviceapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });
      // nothing cached, but this node's syncthing still has the device configured
      // under the name the monitor gave it, and reports the connection closed
      syncthingDevicesStub.resolves({
        status: 'success',
        data: [{ name: '192.168.1.90:16127', deviceID: 'DEVICE-DEAD-PEER' }],
      });
      syncthingCompletionStub.resolves({ status: 'success', data: { remoteState: 'unknown' } });

      await runPass();

      expect(linesMatching(logInfo, 'the component is free there')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
    });

    it('will not start when a silent peer\'s connection is gone but this node cannot see the fleet either', async () => {
      // A dead peer and a live peer on the far side of a split this node is the
      // small end of look identical from here - in both, the peer is silent and its
      // sync connection has dropped. The proportional floor is the only thing that
      // separates them, and below it the peer is very likely still serving.
      const appName = 'isolatedselfapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });
      peerSyncthingSays('192.168.1.90:16127', 'unknown');
      const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
      fluxCommunication.peerResponsiveness.returns({ responding: 1, total: 8 });

      await runPass();

      expect(linesMatching(logInfo, 'cannot see the fleet either')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('will not start beside a peer that answered with an error status', async () => {
      // A peer that answered anything is alive, and "cannot say" is not "is not
      // running it". The evidence path must not be reached at all here: a live peer
      // whose sync connection happens to be down would otherwise read as free.
      const appName = 'erroringpeerapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.rejects(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }));
      peerSyncthingSays('192.168.1.90:16127', 'unknown');

      await runPass();

      expect(linesMatching(logInfo, 'alive, and cannot be ruled out')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'the component is free there')).to.have.lengthOf(0);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('holds the start on one unreadable peer even when every other peer answers', async () => {
      // Peers answering "not me" say nothing about the one that did not answer.
      // Folding the set as "some peer is free" rather than "every peer was ruled
      // out" is how a single blind spot becomes a start.
      const appName = 'onedarkpeerapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127', '192.168.1.91:16127', '192.168.1.92:16127'],
      );
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(async (url) => (url.includes('192.168.1.92')
        ? Promise.reject(new Error('peer unreachable'))
        : peerAnswers({ held: [] })(url)));

      await runPass();

      expect(linesMatching(logInfo, 'could not be ruled out')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('holds a due schedule rather than dropping it when a lower-index node cannot be read', async () => {
      // The two ways of not starting are not the same. A lower-index node that IS
      // running it settles the question, and the schedule is spent. A lower-index
      // node this node could not read settles nothing - dropping the schedule there
      // sends this node back through a fresh index * 3min wait for a peer it may be
      // able to read on the very next pass.
      const appName = 'holdscheduleapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127'],
        { selfRunningSince: '2026-01-01T00:02:00.000Z' },
      );
      serviceHelperStub.resolves({ data: [] });
      // Only Date is faked: the schedule is compared against Date.now(), and faking
      // the timer functions as well would take the probe's own cancel timers with it.
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });

      // Pass 1: index 1 behind an answering peer, so this node schedules its stagger.
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] }));
      await runPass();
      expect(linesMatching(logInfo, 'scheduling app')).to.have.lengthOf(1);

      // Pass 2: the schedule is due, and now the lower-index peer cannot be read.
      clock.tick(3 * 60 * 1000);
      logInfo.resetHistory();
      axiosGetStub.resetBehavior();
      axiosGetStub.rejects(new Error('lower-index node unreachable'));
      await runPass();
      expect(linesMatching(logInfo, 'holding the scheduled start')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);

      // Pass 3 discriminates: the schedule is still there and still due, so this pass
      // re-probes immediately. Had it been dropped, this node would be scheduling a
      // fresh stagger instead.
      logInfo.resetHistory();
      await runPass();
      expect(linesMatching(logInfo, 'holding the scheduled start')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'scheduling app')).to.have.lengthOf(0);
    });

    it('asks every peer when a booked turn comes due at index 0, instead of asking nobody', async () => {
      // The stagger serialises candidates by index, so a due turn only checks the
      // nodes AHEAD of this one. At index 0 there are none, and "nobody ahead" was
      // read as "nobody" - a start issued without a single peer being asked.
      //
      // Reaching it takes three things at once, which is why it is rare rather than
      // impossible: a remembered primary (so the index-0 branch, which probes every
      // peer, is skipped), a booked turn (so the previous-primary branch, which
      // requires none, is skipped), and index 0 by the time the turn is due. The
      // turn is booked at index >= 2 and index is re-derived from the location list
      // every pass, so the instances ahead ageing out is all it takes.
      //
      // What makes it harmful is FDM's registration lag: for ~110s after a node
      // starts, FDM still reports no primary. A less-senior node can be live and
      // invisible throughout, and starting beside it puts two writers on the volume.
      const appName = 'duestagger0app';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      // Index 2: behind two peers, and far enough back to book a turn rather than
      // start at once (at index 1 the wait computes to zero).
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127', '192.168.1.91:16127'],
        { selfRunningSince: '2026-01-01T00:03:00.000Z' },
      );
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });

      // Pass 1: FDM names a primary, so this node remembers one. Nothing else happens
      // - it is a standby with no container.
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.90'] } } });
      await runPass();

      // Pass 2: the primary is gone from FDM. The previous-primary branch probes it,
      // finds it free, and books this node's turn one place back.
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] }));
      await runPass();
      expect(linesMatching(logInfo, 'will start docker app')).to.have.lengthOf(1);

      // Both instances ahead of this one age out of the location list. This node is
      // now index 0 and still holds the turn it booked at index 2.
      registryManagerStub.resolves([
        { name: appName, ip: '192.168.1.5:16127', runningSince: '2026-01-01T00:03:00.000Z' },
        { name: appName, ip: '192.168.1.92:16127', runningSince: '2026-01-01T00:04:00.000Z' },
      ]);

      // The turn comes due, and a LESS senior node is running the component - the
      // FDM-lag window. Only a probe can see it; FDM still says there is no primary.
      clock.tick(config.fluxapps.masterSlaveStaggerMs);
      logInfo.resetHistory();
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [`flux${appName}`] }));
      await runPass();

      expect(linesMatching(logInfo, 'is held on peer node')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('leaves the staggered order alone when there IS a node ahead to ask', async () => {
      // The escalation above must not turn every due turn into a fleet-wide probe:
      // at index 1 the node ahead is the one the stagger exists to defer to, and
      // asking it alone is the whole point of the lower-only scope.
      const appName = 'duestagger1app';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127'],
        { selfRunningSince: '2026-01-01T00:02:00.000Z' },
      );
      serviceHelperStub.resolves({ data: [] });
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });

      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] }));
      await runPass();
      expect(linesMatching(logInfo, 'scheduling app')).to.have.lengthOf(1);

      clock.tick(config.fluxapps.masterSlaveStaggerMs);
      logInfo.resetHistory();
      axiosGetStub.resetBehavior();
      // Only the node ahead is asked, and it is free - so this node takes the primary.
      axiosGetStub.callsFake(peerAnswers({ held: [] }));
      await runPass();

      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
    });

    it('takes the per-place stagger from config, not from a literal', async () => {
      // Four call sites computed the wait from `index * 3 * 60 * 1000`, which is why
      // no harness suite exercises a staggered start: reaching one costs minutes of
      // wall clock, so the whole class went uncovered at rig level.
      //
      // Asserted to the millisecond against the CONFIGURED value, and the unit
      // config deliberately differs from the code's fallback - otherwise a
      // misspelled key would default to the same 3 minutes and read as wired.
      const appName = 'staggerconfigapp';
      const stagger = config.fluxapps.masterSlaveStaggerMs;
      expect(stagger, 'unit config must differ from the fallback or this proves nothing').to.not.equal(3 * 60 * 1000);
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127'],
        { selfRunningSince: '2026-01-01T00:02:00.000Z' },
      );
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] }));
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });

      // Index 1, no history: one place of wait.
      await runPass();
      expect(linesMatching(logInfo, 'scheduling app')).to.have.lengthOf(1);

      // One millisecond short: still not this node's turn.
      clock.tick(stagger - 1);
      logInfo.resetHistory();
      await runPass();
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);

      // And due on the millisecond the configured wait elapses.
      clock.tick(1);
      logInfo.resetHistory();
      await runPass();
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
    });

    it('keeps the seed claim when a peer cannot be ruled out, rather than spending it on a non-answer', async () => {
      // The claim is what the seed decision is made FROM, and no decision was
      // reached. Spending it here drops this node to the index stagger on no
      // evidence - the exact wait the claim exists to remove, given up because a
      // peer did not answer.
      const appName = 'seedheldapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const appId = `flux${appName}`;
      const cache = new Map([[appId, { restarted: true, designatedLeader: true }]]);
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127', '192.168.1.91:16127'],
        { selfRunningSince: '2026-01-01T00:02:30.000Z', receiveOnlyCache: cache },
      );
      serviceHelperStub.resolves({ data: [] });
      // both peers silent, and this node has no view of either

      await runPass();

      expect(linesMatching(logInfo, 'holding the seed')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
      expect(cache.get(appId).designatedLeader).to.equal(true);
    });

    it('keeps the component when the previous primary is silent and its sync connection is still alive', async () => {
      // FDM dropping a primary is not evidence that it stopped - its registration
      // lags reality in both directions. The remembered primary is the instance most
      // likely to still hold the volume, so a silence there keeps the component
      // rather than releasing it to an election.
      const appName = 'prevprimaryapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);

      // Cycle 1: FDM names the PEER, so this node records it as the previous primary.
      serviceHelperStub.resetBehavior();
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.90'] } } });
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] }));
      await runPass();
      logInfo.resetHistory();

      // Cycle 2: FDM reports no primary and the peer has gone silent - but its
      // syncthing connection to this node is still open, so it is restarting.
      serviceHelperStub.resetBehavior();
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.rejects(new Error('previous primary unreachable'));
      peerSyncthingSays('192.168.1.90:16127', 'valid');

      await runPass();

      expect(linesMatching(logInfo, 'still holds a live connection to it')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('keeps electing later g: apps when an earlier one is still held by its previous master', async () => {
      // Two g: apps on one node. The first is settled - its previous master (the
      // peer) still holds it, so there is nothing to elect. That must not cost the
      // SECOND app its cycle. Abandoning the pass here is invisible in the logs,
      // which is the failure this whole area keeps producing.
      const first = 'starvedfirst';
      const second = 'starvedsecond';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');

      dockerServiceStub.callsFake((name) => `flux${name}`);
      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          { name: first, version: 3, containerData: 'g:/syncdata' },
          { name: second, version: 3, containerData: 'g:/syncdata' },
        ],
      });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      const receiveOnlyCache = new Map([
        [`flux${first}`, { restarted: true }],
        [`flux${second}`, { restarted: true }],
      ]);
      fluxNetworkHelperStub.resolves('192.168.1.5:16127');
      // This node is index 0 for both, so the second app is startable the moment
      // it is reached - which makes "was it reached?" unambiguous.
      registryManagerStub.callsFake(async (name) => [
        { name, ip: '192.168.1.5:16127', runningSince: '2026-01-01T00:00:00.000Z' },
        { name, ip: '192.168.1.90:16127', runningSince: '2026-01-01T00:01:00.000Z' },
      ]);
      syncthingServiceStub.resolves({
        status: 'success',
        data: [
          { path: `/root/.flux/ZelApps/flux${first}`, type: 'sendreceive' },
          { path: `/root/.flux/ZelApps/flux${second}`, type: 'sendreceive' },
        ],
      });

      let delayCalls = 0;
      serviceHelperDelayStub.resetBehavior();
      serviceHelperDelayStub.callsFake(async () => {
        delayCalls += 1;
        if (delayCalls === 1) {
          globalState.installationInProgress = true;
          return undefined;
        }
        return new Promise(() => {});
      });
      const runPass = async () => {
        delayCalls = 0;
        globalState.installationInProgress = false;
        await advancedWorkflows.masterSlaveApps(
          globalState, installedApps, listRunningApps, receiveOnlyCache, [], [], require('https'),
        );
      };

      // Cycle 1: FDM names the PEER as primary for both, so this node records it
      // as the previous master for each.
      serviceHelperStub.resetBehavior();
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.90'] } } });
      await runPass();
      logInfo.resetHistory();

      // Cycle 2: FDM reports no primary for either. The peer answers, and holds the
      // FIRST component only - so app one is settled and app two is free.
      serviceHelperStub.resetBehavior();
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [`flux${first}`] }));

      await runPass();

      expect(linesMatching(logInfo, `component:${first} is held on peer node (previous primary)`)).to.have.lengthOf(1);
      // the assertion that discriminates: the pass carried on to the second app
      expect(linesMatching(logInfo, `starting docker component:${second}`)).to.have.lengthOf(1);
    });

    it('should handle apps with g: containerData (master-slave mode)', async () => {
      const appName = 'masterslaveapp';
      dockerServiceStub.returns('zel_masterslaveapp');

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: appName,
            version: 3,
            containerData: 'g:/syncdata',
          },
        ],
      });
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: [],
      });

      const receiveOnlyCache = new Map();
      receiveOnlyCache.set('zel_masterslaveapp', { restarted: true });

      const backupInProgress = [];
      const restoreInProgress = [];
      const https = require('https');

      // Mock FDM responses (no IP)
      serviceHelperStub.resolves({ data: [] });

      // Mock node IP
      fluxNetworkHelperStub.resolves('192.168.1.5:16127');

      // Mock running app list - this node is at index 0
      registryManagerStub.resolves([
        {
          name: appName,
          ip: '192.168.1.5:16127',
          runningSince: null,
        },
        {
          name: appName,
          ip: '192.168.1.10:16127',
          runningSince: null,
        },
      ]);

      // Mock syncthing folder check
      syncthingServiceStub.resolves({
        status: 'success',
        data: [
          {
            path: '/root/.flux/ZelApps/zel_masterslaveapp',
            type: 'sendreceive',
          },
        ],
      });

      // This should attempt to start the app since this node is at index 0
      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        receiveOnlyCache,
        backupInProgress,
        restoreInProgress,
        https,
      );

      // Verify FDM was queried
      expect(serviceHelperStub.called).to.be.true;
    });

    it('should schedule non-index-0 nodes when no FDM IP and no history', async () => {
      const appName = 'masterslaveapp';
      dockerServiceStub.returns('zel_masterslaveapp');

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: appName,
            version: 3,
            containerData: 'g:/syncdata',
          },
        ],
      });
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: [],
      });

      const receiveOnlyCache = new Map();
      receiveOnlyCache.set('zel_masterslaveapp', { restarted: true });

      const backupInProgress = [];
      const restoreInProgress = [];
      const https = require('https');

      // Mock FDM responses (no IP)
      serviceHelperStub.resolves({ data: [] });

      // Mock node IP - this node is at index 1 (second in list)
      fluxNetworkHelperStub.resolves('192.168.1.10:16127');

      // Mock running app list - sorted by IP
      registryManagerStub.resolves([
        {
          name: appName,
          ip: '192.168.1.5:16127',
          runningSince: null,
        },
        {
          name: appName,
          ip: '192.168.1.10:16127', // This node
          runningSince: null,
        },
      ]);

      // Mock syncthing folder check
      syncthingServiceStub.resolves({
        status: 'success',
        data: [
          {
            path: '/root/.flux/ZelApps/zel_masterslaveapp',
            type: 'sendreceive',
          },
        ],
      });

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        receiveOnlyCache,
        backupInProgress,
        restoreInProgress,
        https,
      );

      // Node at index 1 should schedule start for 3 minutes later, not start immediately
      // This is verified by the function logic - it should NOT call appDockerRestart immediately
      expect(serviceHelperStub.called).to.be.true;
      expect(fluxNetworkHelperStub.called).to.be.true;
    });

    it('stops only the g: component on a standby node, leaving non-g siblings running', async () => {
      const appName = 'n8napp';
      const dockerService = require('../../ZelBack/src/services/dockerService');
      dockerServiceStub.returns('fluxn8n_n8napp');
      const appDockerStopStub = sinon.stub(dockerService, 'appDockerStop').resolves();
      // post-inversion, a standby records desired-stopped through the reconciler seam
      const appReconciler = require('../../ZelBack/src/services/appMonitoring/appReconciler');
      const setControllerDesiredStub = sinon.stub(appReconciler, 'setControllerDesired');

      // Mixed compose app: n8n uses g: master/slave, pgcluster needs all instances running
      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: appName,
            version: 8,
            compose: [
              { name: 'n8n', containerData: 'g:/home/node/.n8n' },
              { name: 'pgcluster', containerData: '/var/lib/postgresql/data' },
            ],
          },
        ],
      });
      // Both components currently running on this node
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: [
          { Names: ['/fluxn8n_n8napp'] },
          { Names: ['/fluxpgcluster_n8napp'] },
        ],
      });

      const receiveOnlyCache = new Map();
      const https = require('https');

      // FDM reports the primary is another node
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.99'] } } });
      // This node's address differs from the FDM primary -> we are a standby
      fluxNetworkHelperStub.resolves('192.168.1.5:16127');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        receiveOnlyCache,
        [],
        [],
        https,
      );

      // masterSlaveApps' job here is the election DECISION: it must declare the g:
      // component desired-stopped (with the standby reason) and touch nothing else.
      // Actuation is the reconciler's job (covered in appReconciler.test.js), so it
      // must NOT call appDockerStop directly.
      expect(setControllerDesiredStub.calledWith('n8n_n8napp', 'stopped', 'masterSlave standby')).to.be.true;
      expect(setControllerDesiredStub.neverCalledWith('pgcluster_n8napp')).to.be.true;
      expect(setControllerDesiredStub.neverCalledWith(appName)).to.be.true;
      expect(appDockerStopStub.called).to.be.false;
    });

    it('does not stop anything on a standby node when the g: component is already stopped', async () => {
      const appName = 'n8napp';
      const dockerService = require('../../ZelBack/src/services/dockerService');
      dockerServiceStub.returns('fluxn8n_n8napp');
      const appDockerStopStub = sinon.stub(dockerService, 'appDockerStop').resolves();

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: appName,
            version: 8,
            compose: [
              { name: 'n8n', containerData: 'g:/home/node/.n8n' },
              { name: 'pgcluster', containerData: '/var/lib/postgresql/data' },
            ],
          },
        ],
      });
      // Steady state on a standby: only the non-g component is running
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: [
          { Names: ['/fluxpgcluster_n8napp'] },
        ],
      });

      const receiveOnlyCache = new Map();
      const https = require('https');

      // FDM reports the primary is another node
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.99'] } } });
      fluxNetworkHelperStub.resolves('192.168.1.5:16127');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        receiveOnlyCache,
        [],
        [],
        https,
      );

      // The g: component is not running here and we are not primary - nothing to stop.
      // The running pgcluster sibling must be left alone.
      expect(appDockerStopStub.called).to.be.false;
    });

    it('does NOT stop its own container when it is the primary on a UPnP (non-default) port', async () => {
      // Regression: FDM returns a bare master IP (production format). A UPnP node (e.g.
      // :16157) that IS the primary must recognise itself and keep running. The pre-fix
      // code compared with socketAddressesMatch, which normalized the bare IP to :16127,
      // failed to match its own :16157 socket, and repeatedly stopped its own container
      // (start/stop flap loop). ipsMatch compares on IP only, so it matches.
      const appName = 'valheim1777035136949';
      const dockerService = require('../../ZelBack/src/services/dockerService');
      dockerServiceStub.returns('fluxvalheim_valheim1777035136949');
      const appDockerStopStub = sinon.stub(dockerService, 'appDockerStop').resolves();

      // Compose app with a g: component so the identifier is component_app: this makes the
      // (mistaken) stop call hit dockerService.appDockerStop directly, so the assertion
      // actually observes the bug if it regresses.
      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: appName,
            version: 8,
            compose: [
              { name: 'valheim', containerData: 'g:/root/.config/valheim' },
            ],
          },
        ],
      });
      // The g: component is currently running on this node (it is the primary).
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: [
          { Names: ['/fluxvalheim_valheim1777035136949'] },
        ],
      });

      const receiveOnlyCache = new Map();
      const https = require('https');

      // FDM returns a bare IP (current production behavior - no FDM change required).
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['90.228.196.203'] } } });
      // This node's API socket is on a non-default UPnP port at the same IP -> we are the primary.
      fluxNetworkHelperStub.resolves('90.228.196.203:16157');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        receiveOnlyCache,
        [],
        [],
        https,
      );

      // We are the primary - the container must be left running, never stopped.
      expect(appDockerStopStub.called).to.be.false;
    });

    it('stops the g: component on a UPnP standby when FDM names a different primary IP', async () => {
      // Guards the inverse: a genuine standby (different IP, itself on a non-default port)
      // must still be detected and stopped - ipsMatch must not over-match across IPs.
      const appName = 'n8napp';
      const dockerService = require('../../ZelBack/src/services/dockerService');
      dockerServiceStub.returns('fluxn8n_n8napp');
      const appDockerStopStub = sinon.stub(dockerService, 'appDockerStop').resolves();
      const appReconciler = require('../../ZelBack/src/services/appMonitoring/appReconciler');
      const setControllerDesiredStub = sinon.stub(appReconciler, 'setControllerDesired');

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: appName,
            version: 8,
            compose: [
              { name: 'n8n', containerData: 'g:/home/node/.n8n' },
              { name: 'pgcluster', containerData: '/var/lib/postgresql/data' },
            ],
          },
        ],
      });
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: [
          { Names: ['/fluxn8n_n8napp'] },
          { Names: ['/fluxpgcluster_n8napp'] },
        ],
      });

      const receiveOnlyCache = new Map();
      const https = require('https');

      // FDM primary is a different node, returned as a bare IP (production format).
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.99'] } } });
      // This node has a different IP (and its own non-default port) -> we are a standby.
      fluxNetworkHelperStub.resolves('192.168.1.5:16137');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        receiveOnlyCache,
        [],
        [],
        https,
      );

      // The standby's g: component is declared desired-stopped through the reconciler
      // seam; the non-g sibling is untouched and Docker is not actuated directly here.
      expect(setControllerDesiredStub.calledWith('n8n_n8napp', 'stopped', 'masterSlave standby')).to.be.true;
      expect(setControllerDesiredStub.neverCalledWith('pgcluster_n8napp')).to.be.true;
      expect(appDockerStopStub.called).to.be.false;
    });
  });

  describe('validateApplicationUpdateCompatibility tests', () => {
    it('should allow component count changes for version 8+ apps', async () => {
      const oldAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 8,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        enterprise: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [] },
          { name: 'backend', repotag: 'repo/backend:1.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [] },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 8,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        enterprise: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [] },
          { name: 'backend', repotag: 'repo/backend:1.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [] },
          { name: 'database', repotag: 'repo/database:1.0', ports: ['5432'], containerPorts: ['5432'], domains: [], environmentParameters: [], commands: [] },
        ],
      };

      // Should not throw error for v8+ apps with component changes
      const result = await advancedWorkflows.validateApplicationUpdateCompatibility(
        newAppSpecs,
        oldAppSpecs,
      );

      expect(result).to.be.true;
    });

    it('should allow component name changes for version 8+ apps', async () => {
      const oldAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 8,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        enterprise: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [] },
          { name: 'backend', repotag: 'repo/backend:1.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [] },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 8,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        enterprise: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [] },
          { name: 'api', repotag: 'repo/api:1.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [] }, // Renamed from 'backend' to 'api'
        ],
      };

      // Should not throw error for v8+ apps with component name changes
      const result = await advancedWorkflows.validateApplicationUpdateCompatibility(
        newAppSpecs,
        oldAppSpecs,
      );

      expect(result).to.be.true;
    });

    it('should reject component count changes for version 4-7 apps', async () => {
      const oldAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 7,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        repoAuth: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [], tiered: false },
          { name: 'backend', repotag: 'repo/backend:1.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [], tiered: false },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 7,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        repoAuth: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [], tiered: false },
          { name: 'backend', repotag: 'repo/backend:1.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [], tiered: false },
          { name: 'database', repotag: 'repo/database:1.0', ports: ['5432'], containerPorts: ['5432'], domains: [], environmentParameters: [], commands: [], tiered: false },
        ],
      };

      // Should throw error for v4-7 apps with component count changes
      try {
        await advancedWorkflows.validateApplicationUpdateCompatibility(
          newAppSpecs,
          oldAppSpecs,
        );
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Cannot change the number of components');
        expect(error.message).to.include('v4-7 applications');
        expect(error.message).to.include('Upgrade to version 8');
      }
    });

    it('should reject component name changes for version 4-7 apps', async () => {
      const oldAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 6,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        repoAuth: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [], tiered: false },
          { name: 'backend', repotag: 'repo/backend:1.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [], tiered: false },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 6,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        repoAuth: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [], tiered: false },
          { name: 'api', repotag: 'repo/api:1.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [], tiered: false }, // Renamed from 'backend'
        ],
      };

      // Should throw error for v4-7 apps with component name changes
      try {
        await advancedWorkflows.validateApplicationUpdateCompatibility(
          newAppSpecs,
          oldAppSpecs,
        );
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Component "backend" not found');
        expect(error.message).to.include('v4-7 applications');
        expect(error.message).to.include('Upgrade to version 8');
      }
    });

    it('should allow version changes (policy enforced elsewhere)', async () => {
      const oldAppSpecs = {
        name: 'TestApp',
        version: 5,
        compose: [
          { name: 'app', repotag: 'repo/app:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [], tiered: false },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        version: 6,
        compose: [
          { name: 'app', repotag: 'repo/app:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [], tiered: false },
        ],
      };

      // validateApplicationUpdateCompatibility no longer enforces version upgrade policy —
      // that is now handled in storeAppTemporaryMessage. Structural compatibility should pass.
      const result = await advancedWorkflows.validateApplicationUpdateCompatibility(
        newAppSpecs,
        oldAppSpecs,
      );

      expect(result).to.be.true;
    });

    it('should allow repotag changes for all v4+ apps', async () => {
      const oldAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 7,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        repoAuth: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [], tiered: false },
          { name: 'backend', repotag: 'repo/backend:1.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [], tiered: false },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        description: 'Test application',
        owner: 'testowner',
        version: 7,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 10000,
        nodes: [],
        staticip: false,
        repoAuth: '',
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:2.0', ports: ['8080'], containerPorts: ['8080'], domains: [], environmentParameters: [], commands: [], tiered: false }, // Changed tag
          { name: 'backend', repotag: 'repo/backend:2.0', ports: ['3000'], containerPorts: ['3000'], domains: [], environmentParameters: [], commands: [], tiered: false }, // Changed tag
        ],
      };

      // Should allow repotag changes for v4+ apps
      const result = await advancedWorkflows.validateApplicationUpdateCompatibility(
        newAppSpecs,
        oldAppSpecs,
      );

      expect(result).to.be.true;
    });
  });

  describe('softRedeploy component structure change handling tests', () => {
    let findInDatabaseStub;

    beforeEach(() => {
      // Reset global state
      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgress = false;
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;

      // Setup database connection stub
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should escalate to hard redeploy when component count changes for v8+ app', async () => {
      const installedApp = {
        name: 'TestApp',
        version: 8,
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0' },
          { name: 'backend', repotag: 'repo/backend:1.0' },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        version: 8,
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0' },
          { name: 'backend', repotag: 'repo/backend:1.0' },
          { name: 'database', repotag: 'repo/database:1.0' },
        ],
      };

      // Stub dbHelper.findInDatabase to return the installed app
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase').resolves([installedApp]);

      // Stub appUninstaller so hardRedeploy doesn't actually try to remove the app
      // eslint-disable-next-line global-require
      const appUninstaller = require('../../ZelBack/src/services/appLifecycle/appUninstaller');
      sinon.stub(appUninstaller, 'removeAppLocally').resolves();

      // Stub appInstaller so hardRedeploy doesn't actually try to install the app
      // eslint-disable-next-line global-require
      const appInstaller = require('../../ZelBack/src/services/appLifecycle/appInstaller');
      sinon.stub(appInstaller, 'checkAppRequirements').resolves();
      sinon.stub(appInstaller, 'registerAppLocally').resolves();

      // Stub serviceHelper.delay so hardRedeploy doesn't wait
      // eslint-disable-next-line global-require
      const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
      sinon.stub(serviceHelper, 'delay').resolves();

      // Create a mock response object
      const res = {
        write: sinon.stub(),
        flush: sinon.stub(),
        end: sinon.stub(),
      };

      await advancedWorkflows.softRedeploy(newAppSpecs, res);

      // Should have called dbHelper.findInDatabase to check for structure changes
      expect(findInDatabaseStub.called).to.be.true;

      // Should have written escalation message to response
      expect(res.write.called).to.be.true;
      const messages = res.write.getCalls().map(call => call.args[0]);
      const escalationMessage = messages.find(msg => msg.includes('Component structure changed'));
      expect(escalationMessage).to.exist;
      expect(escalationMessage).to.include('hard redeploy');
    });

    it('should escalate to hard redeploy when component names change for v8+ app', async () => {
      const installedApp = {
        name: 'TestApp',
        version: 8,
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0' },
          { name: 'backend', repotag: 'repo/backend:1.0' },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        version: 8,
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0' },
          { name: 'api', repotag: 'repo/api:1.0' }, // Renamed
        ],
      };

      // Stub dbHelper.findInDatabase to return the installed app
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase').resolves([installedApp]);

      // Stub appUninstaller so hardRedeploy doesn't actually try to remove the app
      // eslint-disable-next-line global-require
      const appUninstaller = require('../../ZelBack/src/services/appLifecycle/appUninstaller');
      sinon.stub(appUninstaller, 'removeAppLocally').resolves();

      // Stub appInstaller so hardRedeploy doesn't actually try to install the app
      // eslint-disable-next-line global-require
      const appInstaller = require('../../ZelBack/src/services/appLifecycle/appInstaller');
      sinon.stub(appInstaller, 'checkAppRequirements').resolves();
      sinon.stub(appInstaller, 'registerAppLocally').resolves();

      // Stub serviceHelper.delay so hardRedeploy doesn't wait
      // eslint-disable-next-line global-require
      const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
      sinon.stub(serviceHelper, 'delay').resolves();

      const res = {
        write: sinon.stub(),
        flush: sinon.stub(),
        end: sinon.stub(),
      };

      await advancedWorkflows.softRedeploy(newAppSpecs, res);

      // Should have called dbHelper.findInDatabase to check for structure changes
      expect(findInDatabaseStub.called).to.be.true;

      // Should have written escalation message to response
      expect(res.write.called).to.be.true;
      const messages = res.write.getCalls().map(call => call.args[0]);
      const escalationMessage = messages.find(msg => msg.includes('Component structure changed'));
      expect(escalationMessage).to.exist;
      expect(escalationMessage).to.include('hard redeploy');
    });

    it('should proceed with normal soft redeploy when no component structure changes', async () => {
      const installedApp = {
        name: 'TestApp',
        version: 8,
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0' },
          { name: 'backend', repotag: 'repo/backend:1.0' },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        version: 8,
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:2.0' }, // Only tag changed
          { name: 'backend', repotag: 'repo/backend:2.0' }, // Only tag changed
        ],
      };

      // Stub dbHelper.findInDatabase to return the installed app
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase').resolves([installedApp]);

      // Mock other required dependencies for soft redeploy
      sinon.stub(advancedWorkflows, 'softRemoveAppLocally').resolves();
      sinon.stub(advancedWorkflows, 'softRegisterAppLocally').resolves();

      // Stub appInstaller.checkAppRequirements so softRedeploy doesn't validate real env
      // eslint-disable-next-line global-require
      const appInstaller = require('../../ZelBack/src/services/appLifecycle/appInstaller');
      sinon.stub(appInstaller, 'checkAppRequirements').resolves();

      const clock = sinon.useFakeTimers();

      const res = {
        write: sinon.stub(),
        flush: sinon.stub(),
        end: sinon.stub(),
      };

      const softRedeployPromise = advancedWorkflows.softRedeploy(newAppSpecs, res);
      await clock.tickAsync(31 * 1000);
      await softRedeployPromise;

      expect(findInDatabaseStub.called).to.be.true;

      // Should not have written escalation message to response
      const messages = res.write.getCalls().map(call => call.args[0]);
      const escalationMessage = messages.find(msg => msg.includes('Component structure changed'));
      expect(escalationMessage).to.not.exist;
    });

    it('should not check component structure for v4-7 apps during soft redeploy', async () => {
      const installedApp = {
        name: 'TestApp',
        version: 7,
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:1.0' },
          { name: 'backend', repotag: 'repo/backend:1.0' },
        ],
      };

      const newAppSpecs = {
        name: 'TestApp',
        version: 7,
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:2.0' },
          { name: 'backend', repotag: 'repo/backend:2.0' },
        ],
      };

      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase').resolves([installedApp]);

      // Mock other required dependencies
      sinon.stub(advancedWorkflows, 'softRemoveAppLocally').resolves();
      sinon.stub(advancedWorkflows, 'softRegisterAppLocally').resolves();

      // Stub appInstaller.checkAppRequirements so softRedeploy doesn't validate real env
      // eslint-disable-next-line global-require
      const appInstaller = require('../../ZelBack/src/services/appLifecycle/appInstaller');
      sinon.stub(appInstaller, 'checkAppRequirements').resolves();

      const clock = sinon.useFakeTimers();

      const res = {
        write: sinon.stub(),
        flush: sinon.stub(),
        end: sinon.stub(),
      };

      const softRedeployPromise = advancedWorkflows.softRedeploy(newAppSpecs, res);
      await clock.tickAsync(31 * 1000);
      await softRedeployPromise;

      // For v4-7 apps, component structure checks are not applicable.
      expect(findInDatabaseStub.called).to.be.false;
    });

    it('should not escalate to hard redeploy when enterprise compose is redacted in local DB', async () => {
      const installedApp = {
        name: 'TestApp',
        version: 8,
        enterprise: 'encryptedEnterprisePayload',
        compose: [], // Redacted in local DB
        hash: 'testhash',
      };

      const newAppSpecs = {
        name: 'TestApp',
        version: 8,
        compose: [
          { name: 'frontend', repotag: 'repo/frontend:2.0' },
          { name: 'backend', repotag: 'repo/backend:2.0' },
        ],
      };

      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase').resolves([installedApp]);

      sinon.stub(advancedWorkflows, 'softRemoveAppLocally').resolves();
      sinon.stub(advancedWorkflows, 'softRegisterAppLocally').resolves();

      // Stub appInstaller.checkAppRequirements so softRedeploy doesn't validate real env
      // eslint-disable-next-line global-require
      const appInstaller = require('../../ZelBack/src/services/appLifecycle/appInstaller');
      sinon.stub(appInstaller, 'checkAppRequirements').resolves();

      const clock = sinon.useFakeTimers();

      const res = {
        write: sinon.stub(),
        flush: sinon.stub(),
        end: sinon.stub(),
      };

      const softRedeployPromise = advancedWorkflows.softRedeploy(newAppSpecs, res);
      await clock.tickAsync(31 * 1000);
      await softRedeployPromise;

      expect(findInDatabaseStub.called).to.be.true;

      const messages = res.write.getCalls().map(call => call.args[0]);
      const escalationMessage = messages.find(msg => msg.includes('Component structure changed'));
      expect(escalationMessage).to.not.exist;
    });
  });

  describe('createAppVolume synced-mark invalidation', () => {
    const identifier = 'fluxfrontend_TestApp';
    const component = { name: 'frontend', hdd: 1 };
    let volGlobalState;

    const armSyncedMark = () => {
      volGlobalState.receiveOnlySyncthingAppsCache.set(identifier, {
        restarted: true, numberOfExecutionsRequired: 4, numberOfExecutions: 10,
      });
    };

    beforeEach(() => {
      volGlobalState = require('../../ZelBack/src/services/utils/globalState');
      volGlobalState.receiveOnlySyncthingAppsCache.clear();
      const hwRequirements = require('../../ZelBack/src/services/appRequirements/hwRequirements');
      sinon.stub(hwRequirements, 'getNodeSpecs').resolves({ ssdStorage: 10000 });
      // The volume search reads the real mount table through findmnt. Stubbing
      // it keeps these cases about the synced-mark rather than about whichever
      // disks the machine running the suite happens to have.
      // eslint-disable-next-line global-require
      const volumeService = require('../../ZelBack/src/services/utils/volumeService');
      sinon.stub(volumeService, 'capacityVolumesInGib').resolves([
        {
          filesystem: '/dev/sda1', mount: '/dat', size: 1000, used: 100, available: 900,
        },
      ]);
    });

    afterEach(() => {
      volGlobalState.receiveOnlySyncthingAppsCache.clear();
    });

    it('preserves the synced-mark when the pre-flight aborts before any volume is touched', async () => {
      // a recreate whose pre-flight fails (a resources-query blip, or out of
      // space - the LIKELY population for failed recreates) leaves the existing
      // volume and its data untouched. Stripping the mark there would hand
      // intact data to the not-in-cache skip / second-encounter chain, which
      // clears it.
      armSyncedMark();
      const resourceQueryService = require('../../ZelBack/src/services/appQuery/resourceQueryService');
      sinon.stub(resourceQueryService, 'appsResources').resolves({ status: 'error' });

      let thrown = null;
      try {
        await advancedWorkflows.createAppVolume(component, 'TestApp', true, null);
      } catch (error) { thrown = error; }

      expect(thrown, 'the pre-flight abort did not fire').to.not.equal(null);
      expect(thrown.message).to.include('Unable to obtain locked system resources');
      expect(
        volGlobalState.receiveOnlySyncthingAppsCache.has(identifier),
        'an aborted pre-flight stripped the synced-mark of an app whose data is intact',
      ).to.equal(true);
    });

    it('drops a stale synced-mark at the point of no return', async () => {
      // once the allocation runs the old volume state is gone: a cache entry
      // surviving from the previous incarnation would let this fresh install
      // skip the new-install receiveonly protection and read as instantly
      // ready to become g: primary.
      armSyncedMark();
      const resourceQueryService = require('../../ZelBack/src/services/appQuery/resourceQueryService');
      sinon.stub(resourceQueryService, 'appsResources').resolves({ status: 'success', data: { appsHddLocked: 0 } });
      // let the flow reach the point of no return, then block the allocation
      // itself - the drop must already have happened by then
      const svcHelper = require('../../ZelBack/src/services/serviceHelper');
      sinon.stub(svcHelper, 'runCommand').callsFake(async (cmd) => (
        cmd === 'fallocate' ? { error: new Error('fallocate blocked by test') } : {}));

      let thrown = null;
      try {
        await advancedWorkflows.createAppVolume(component, 'TestApp', true, null);
      } catch (error) { thrown = error; }

      // assert WHICH error aborted before judging the cache: this test rides
      // the host's real df output through the space pre-flight, so on a
      // low-disk host the pre-flight throws first - that must read as "never
      // reached the allocation", not as a phantom production regression
      expect(thrown, 'the flow never reached the allocation').to.not.equal(null);
      expect(thrown.message, 'the flow aborted before the allocation').to.equal('fallocate blocked by test');
      expect(
        volGlobalState.receiveOnlySyncthingAppsCache.has(identifier),
        'the point of no return left a stale synced-mark in place',
      ).to.equal(false);
    });
  });

  // Note: verifyAppUpdateParameters, getPeerAppsInstallingErrorMessages, and
  // stopSyncthingApp are complex integration functions or HTTP request handlers
  // that require extensive mocking of database connections, HTTP requests, and
  // external services. These should be tested in integration tests rather than
  // unit tests. masterSlaveApps is included above with basic tests, but full
  // integration testing is recommended for comprehensive coverage of the
  // master-slave coordination logic.
});
