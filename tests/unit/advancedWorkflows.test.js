// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const https = require('https');
const config = require('config');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const appReconciler = require('../../ZelBack/src/services/appMonitoring/appReconciler');
const syncthingService = require('../../ZelBack/src/services/syncthingService');
const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');
const generalService = require('../../ZelBack/src/services/generalService');
const globalState = require('../../ZelBack/src/services/utils/globalState');
const appInstaller = require('../../ZelBack/src/services/appLifecycle/appInstaller');
const appUninstaller = require('../../ZelBack/src/services/appLifecycle/appUninstaller');

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
        end: sinon.stub(),
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
        end: sinon.stub(),
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
        end: sinon.stub(),
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
    let fluxNetworkHelperStub;
    let registryManagerStub;
    let dockerServiceStub;
    let syncthingServiceStub;

    beforeEach(() => {
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
      sinon.stub(appQueryService, 'decryptEnterpriseApps').callsFake((apps) => Promise.resolve(apps));

      // Stub database connection to prevent actual DB access
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);
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

    it('keeps the app and its data when the soft install fails - a failed soft redeploy never removes', async () => {
      // The data volume was deliberately preserved (that is what makes the
      // redeploy soft), so the rollback removal destroyed established data
      // over what is usually a node-local failure. With the local row present
      // the spec and volume must stay; the reconciler retries with the
      // current spec on its ladder.
      const composed = (repotag) => ({
        name: 'frontend',
        repotag,
        containerData: 'g:/data',
        ports: [31111],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        tiered: false,
      });
      const base = {
        name: 'TestApp',
        description: 'test app',
        owner: '1TESTOWNERADDRESS',
        version: 8,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 22000,
        nodes: [],
        staticip: false,
        hash: 'testhash',
        height: 1000,
      };
      const installedApp = { ...base, compose: [composed('repo/frontend:1.0')] };
      const newAppSpecs = { ...base, compose: [composed('repo/frontend:1.1')] };
      // The stubs mirror the real local-row lifecycle: the soft remove
      // deletes the row (so the register's already-installed check passes),
      // the register's insert restores it (so the catch's row-exists gate
      // sees it). A blanket always-returns-row stub aborts the register
      // with 'already installed' and never reaches the install.
      let localRow = installedApp;
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase').callsFake(async () => (localRow ? [localRow] : []));
      sinon.stub(dbHelper, 'findOneInDatabase').callsFake(async () => localRow);
      sinon.stub(dbHelper, 'insertOneToDatabase').callsFake(async (db, col, doc) => { localRow = doc; return doc; });
      sinon.stub(dbHelper, 'updateOneInDatabase').resolves();
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves();
      sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').callsFake(async () => { const row = localRow; localRow = null; return row; });

      const removeSpy = sinon.stub(appUninstaller, 'removeAppLocally').resolves();
      sinon.stub(appUninstaller, 'softUninstallComponent').resolves();

      sinon.stub(appInstaller, 'checkAppRequirements').resolves(true);
      sinon.stub(appInstaller, 'ensureAppDockerNetwork').resolves();
      const installSoft = sinon.stub(appInstaller, 'installApplicationSoft').rejects(new Error('Error: Port 31111 FAILed to open.'));
      sinon.stub(generalService, 'nodeTier').resolves('basic');

      sinon.stub(serviceHelper, 'delay').resolves();

      // the property is getter-only: clear the real shared map, never reassign
      globalState.receiveOnlySyncthingAppsCache.clear();

      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      await advancedWorkflows.softRedeploy(newAppSpecs, res);

      expect(installSoft.called, 'the flow never reached the soft install - the test is not exercising the register-site keep').to.equal(true);
      expect(removeSpy.called, 'a failed soft redeploy removed the app and its data').to.equal(false);
      expect(
        globalState.receiveOnlySyncthingAppsCache.size,
        'the kept g: component was not re-marked synced - the sync layer would clear its data',
      ).to.be.greaterThan(0);
    });

    it('falls back to full removal - and does not mark synced - when the app was never locally installed', async () => {
      // 'Flux App not found': a redeploy called on a node without the app.
      // Nothing of value exists here to keep - the removal fallback cleans up
      // local remnants - and a stale synced-mark would make an empty later
      // install eligible for g: primary, so the cache must stay untouched.
      // (A failure after this redeploy's OWN teardown deleted the row is the
      // opposite case: data on disk, row restored - pinned separately below.)
      const newAppSpecs = {
        name: 'TestAppGone',
        description: 'test app',
        owner: '1TESTOWNERADDRESS',
        version: 8,
        compose: [{ name: 'frontend', repotag: 'repo/frontend:1.1', containerData: 'g:/data' }],
      };
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase').resolves([]);
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      const removeSpy = sinon.stub(appUninstaller, 'removeAppLocally').resolves();

      sinon.stub(serviceHelper, 'delay').resolves();

      globalState.receiveOnlySyncthingAppsCache.clear();

      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      await advancedWorkflows.softRedeploy(newAppSpecs, res);

      expect(removeSpy.called, 'the rowless failure did not fall back to removal').to.equal(true);
      expect(
        globalState.receiveOnlySyncthingAppsCache.size,
        'marked synced for an app this node does not even have',
      ).to.equal(0);
    });

    // Shared fixture for the rowless-window tests: an installed v8 app with a
    // g: component whose redeploy is mid-flight when the failure lands.
    const rowlessWindowFixture = () => {
      const composed = (repotag) => ({
        name: 'frontend',
        repotag,
        containerData: 'g:/data',
        ports: [31111],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        tiered: false,
      });
      const base = {
        name: 'TestApp',
        description: 'test app',
        owner: '1TESTOWNERADDRESS',
        version: 8,
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 22000,
        nodes: [],
        staticip: false,
        hash: 'testhash',
        height: 1000,
      };
      return {
        installedApp: { ...base, compose: [composed('repo/frontend:1.0')] },
        newAppSpecs: { ...base, compose: [composed('repo/frontend:1.1')] },
      };
    };

    // Mutable-row db stubs mirroring the real local-row lifecycle (soft remove
    // deletes the row, the register's insert restores it). Returns accessors
    // so tests can observe and preset the row.
    const stubRowLifecycle = (initialRow) => {
      const state = { localRow: initialRow };
      sinon.stub(dbHelper, 'findInDatabase').callsFake(async () => (state.localRow ? [state.localRow] : []));
      sinon.stub(dbHelper, 'findOneInDatabase').callsFake(async () => state.localRow);
      sinon.stub(dbHelper, 'insertOneToDatabase').callsFake(async (db, col, doc) => { state.localRow = doc; return doc; });
      sinon.stub(dbHelper, 'updateOneInDatabase').resolves();
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves();
      sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').callsFake(async () => { const row = state.localRow; state.localRow = null; return row; });
      return state;
    };

    it('restores the local record and keeps the app when the requirements check fails after teardown', async () => {
      // The rowless window: this redeploy's own teardown deleted the row, and
      // checkAppRequirements throws before the register restored it (a blipped
      // geolocation/resource query - node-local, transient, and correlated
      // across nodes during an image-update wave). The volume is still mounted
      // with established data: the catch must put the row back and keep, never
      // hand the app to removeAppLocally.
      const { installedApp, newAppSpecs } = rowlessWindowFixture();
      const rowState = stubRowLifecycle(installedApp);

      const removeSpy = sinon.stub(appUninstaller, 'removeAppLocally').resolves();
      sinon.stub(appUninstaller, 'softUninstallComponent').resolves();

      sinon.stub(appInstaller, 'checkAppRequirements').rejects(new Error('Node Geolocation not set. Aborting.'));
      const installSoft = sinon.stub(appInstaller, 'installApplicationSoft').resolves();
      sinon.stub(generalService, 'nodeTier').resolves('basic');
      sinon.stub(serviceHelper, 'delay').resolves();

      globalState.receiveOnlySyncthingAppsCache.clear();

      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      await advancedWorkflows.softRedeploy(newAppSpecs, res);

      expect(removeSpy.called, 'a mid-flight failure removed the app and its data').to.equal(false);
      expect(installSoft.called, 'the install must not run after the requirements check failed').to.equal(false);
      expect(rowState.localRow, 'the local record deleted by the teardown was not restored').to.not.equal(null);
      expect(rowState.localRow.name).to.equal('TestApp');
      expect(
        globalState.receiveOnlySyncthingAppsCache.size,
        'the kept g: component was not re-marked synced',
      ).to.be.greaterThan(0);
      expect(res.end.called, 'the API response was left open - the client hangs to a gateway timeout').to.equal(true);
    });

    it('keeps the app - without stomping the other operation - when an install races into the redeploy window', async () => {
      // The spawner has no softRedeployInProgress gate, so during the redeploy
      // delay it can start installing an unrelated app and take
      // installationInProgress. The register's busy guard used to bare-return:
      // the redeploy then logged success with no row, no containers and an
      // orphaned volume. The guard must surface as a failure (restore + keep),
      // and the OTHER operation's flag must remain untouched - it is not ours
      // to clear.
      const { installedApp, newAppSpecs } = rowlessWindowFixture();
      const rowState = stubRowLifecycle(installedApp);

      const removeSpy = sinon.stub(appUninstaller, 'removeAppLocally').resolves();
      sinon.stub(appUninstaller, 'softUninstallComponent').resolves();

      sinon.stub(appInstaller, 'checkAppRequirements').resolves(true);
      const installSoft = sinon.stub(appInstaller, 'installApplicationSoft').resolves();
      sinon.stub(generalService, 'nodeTier').resolves('basic');
      // the racing install lands while this redeploy sits in its delay
      sinon.stub(serviceHelper, 'delay').callsFake(async () => { globalState.installationInProgress = true; });

      globalState.receiveOnlySyncthingAppsCache.clear();

      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      await advancedWorkflows.softRedeploy(newAppSpecs, res);

      expect(removeSpy.called, 'the busy collision removed the app and its data').to.equal(false);
      expect(installSoft.called, 'the install ran despite another operation holding the flag').to.equal(false);
      expect(rowState.localRow, 'the local record deleted by the teardown was not restored').to.not.equal(null);
      expect(
        globalState.installationInProgress,
        'the racing operation\'s installationInProgress flag was cleared by a flow that does not own it',
      ).to.equal(true);
      expect(
        globalState.receiveOnlySyncthingAppsCache.size,
        'the kept g: component was not re-marked synced',
      ).to.be.greaterThan(0);
      globalState.installationInProgress = false;
    });

    it('restores and keeps - without touching the remover\'s flag - when a removal races into the redeploy window', async () => {
      // A removal racing into the redeploy delay is almost always for an
      // UNRELATED app (removeAppLocally is not gated on
      // softRedeployInProgress). Hands-off here would orphan THIS app
      // permanently: its row is already deleted by its own teardown, nothing
      // enumerates a rowless app, its volume vanishes from the resource
      // accounting, and a later spawner re-selection reformats it. Restore
      // and keep, like any other mid-flight failure. The same-app
      // interleaving this could theoretically resurrect is self-correcting
      // in all but a milliseconds window (the remover deletes the row LAST,
      // so its own final delete undoes this restore) - and a removal that
      // FINISHES before the register runs resurrects on the success path
      // regardless, so hands-off bought nothing there either.
      const { installedApp, newAppSpecs } = rowlessWindowFixture();
      const rowState = stubRowLifecycle(installedApp);

      const removeSpy = sinon.stub(appUninstaller, 'removeAppLocally').resolves();
      sinon.stub(appUninstaller, 'softUninstallComponent').resolves();

      sinon.stub(appInstaller, 'checkAppRequirements').resolves(true);
      const installSoft = sinon.stub(appInstaller, 'installApplicationSoft').resolves();
      sinon.stub(generalService, 'nodeTier').resolves('basic');
      // the racing removal lands while this redeploy sits in its delay
      sinon.stub(serviceHelper, 'delay').callsFake(async () => { globalState.removalInProgress = true; });

      globalState.receiveOnlySyncthingAppsCache.clear();

      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      await advancedWorkflows.softRedeploy(newAppSpecs, res);

      expect(removeSpy.called, 'the redeploy raced the remover with a removal of its own').to.equal(false);
      expect(installSoft.called).to.equal(false);
      expect(rowState.localRow, 'the local record deleted by the teardown was not restored').to.not.equal(null);
      expect(
        globalState.receiveOnlySyncthingAppsCache.size,
        'the kept g: component was not re-marked synced',
      ).to.be.greaterThan(0);
      expect(
        globalState.removalInProgress,
        'the remover\'s removalInProgress flag was cleared by a flow that does not own it',
      ).to.equal(true);
      expect(res.end.called, 'the API response was left open').to.equal(true);
      globalState.removalInProgress = false;
    });

    it('reinstallOldApplications defers on a busy collision instead of force-removing the app', async () => {
      // the headline contract: the composed-update catch force-removes the
      // whole app (containers, volumes, data, row, broadcast) on a real
      // registration failure - it must NOT do that when the register merely
      // collided with another operation's flag. The components stay
      // soft-uninstalled with the row (already carrying the new spec) and
      // data volumes intact; the reconciler recreates the missing
      // components over the preserved volumes.
      const { installedApp, newAppSpecs } = rowlessWindowFixture();
      const localRowStart = { ...installedApp, hash: 'oldhash' };
      const globalSpec = { ...newAppSpecs, hash: 'newhash' };
      const globalCollection = config.database.appsglobal.collections.appsInformation;

      let localRow = localRowStart;
      sinon.stub(dbHelper, 'findInDatabase').callsFake(async () => (localRow ? [localRow] : []));
      sinon.stub(dbHelper, 'findOneInDatabase').callsFake(async (db, collection) => (
        collection === globalCollection ? globalSpec : localRow));
      sinon.stub(dbHelper, 'insertOneToDatabase').callsFake(async (db, col, doc) => { localRow = doc; return doc; });
      sinon.stub(dbHelper, 'updateOneInDatabase').resolves();
      sinon.stub(dbHelper, 'removeDocumentsFromCollection').callsFake(async () => { localRow = null; });
      sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').callsFake(async () => { const row = localRow; localRow = null; return row; });

      // mirror the real removal's row delete so the record assertion below
      // can actually fail if the catch takes the removal path
      const removeSpy = sinon.stub(appUninstaller, 'removeAppLocally').callsFake(async () => { localRow = null; });
      sinon.stub(appUninstaller, 'softUninstallComponent').resolves();

      sinon.stub(appInstaller, 'checkAppRequirements').resolves(true);
      const registerHard = sinon.stub(appInstaller, 'registerAppLocally').resolves(true);
      const installSoft = sinon.stub(appInstaller, 'installApplicationSoft').resolves();
      sinon.stub(generalService, 'nodeTier').resolves('basic');
      sinon.stub(generalService, 'checkSynced').resolves(true);
      // deterministic 'redeploy this cycle' outcome for the probability roll
      sinon.stub(Math, 'random').returns(0);
      // the collision lands during the composed delay before the register
      sinon.stub(serviceHelper, 'delay').callsFake(async () => { globalState.installationInProgress = true; });

      await advancedWorkflows.reinstallOldApplications();
      globalState.installationInProgress = false;

      expect(removeSpy.called, 'a busy collision force-removed the app and its data').to.equal(false);
      expect(registerHard.called, 'the equal-hdd component took the hard path').to.equal(false);
      expect(installSoft.called).to.equal(false);
      expect(localRow, 'the app must keep its local record for the reconciler').to.not.equal(null);
    });

    it('createAppVolume drops a stale synced-mark - a fresh volume is by definition not synced', async () => {
      // a cache entry surviving from a previous incarnation (e.g. a redeploy
      // keep-mark re-planted while a same-app removal raced it) would let the
      // next fresh install skip the new-install receiveonly protection and
      // read as instantly ready for g: primary
      const { newAppSpecs } = rowlessWindowFixture();
      const component = newAppSpecs.compose[0];
      globalState.receiveOnlySyncthingAppsCache.set('fluxfrontend_TestApp', {
        restarted: true, numberOfExecutionsRequired: 4, numberOfExecutions: 10,
      });

      // eslint-disable-next-line global-require
      const hwRequirements = require('../../ZelBack/src/services/appRequirements/hwRequirements');
      sinon.stub(hwRequirements, 'getNodeSpecs').resolves({ ssdStorage: 100 });
      // eslint-disable-next-line global-require
      const resourceQueryService = require('../../ZelBack/src/services/appQuery/resourceQueryService');
      // abort the creation right after the stale-mark drop - the volume
      // machinery itself is not under test
      sinon.stub(resourceQueryService, 'appsResources').resolves({ status: 'error' });

      let thrown = null;
      try {
        await advancedWorkflows.createAppVolume(component, 'TestApp', true, null);
      } catch (error) { thrown = error; }

      expect(thrown, 'the aborting stub did not fire').to.not.equal(null);
      expect(
        globalState.receiveOnlySyncthingAppsCache.has('fluxfrontend_TestApp'),
        'a fresh volume creation left a stale synced-mark in place',
      ).to.equal(false);
    });

    it('stamps busy-guard throws so callers can tell a collision from a real failure', async () => {
      // reinstallOldApplications' composed catch force-removes the whole app
      // on any registration error; a transient flag collision must be
      // distinguishable or a benign busy skip becomes data destruction.
      const { newAppSpecs } = rowlessWindowFixture();

      globalState.installationInProgress = true;
      let installErr = null;
      try {
        await advancedWorkflows.softRegisterAppLocally(newAppSpecs, undefined, null);
      } catch (error) { installErr = error; }
      globalState.installationInProgress = false;
      expect(installErr, 'the installation busy guard did not throw').to.not.equal(null);
      expect(installErr.busyCollision).to.equal('installation');

      globalState.removalInProgress = true;
      let removalErr = null;
      try {
        await advancedWorkflows.softRegisterAppLocally(newAppSpecs, undefined, null);
      } catch (error) { removalErr = error; }
      globalState.removalInProgress = false;
      expect(removalErr, 'the removal busy guard did not throw').to.not.equal(null);
      expect(removalErr.busyCollision).to.equal('removal');
    });

    it('ends the response when the redeploy is refused by a busy guard', async () => {
      // the top-of-function guards write a warning and return; without an end
      // the API client hangs to a gateway timeout
      const { newAppSpecs } = rowlessWindowFixture();

      globalState.installationInProgress = true;
      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };
      await advancedWorkflows.softRedeploy(newAppSpecs, res);
      globalState.installationInProgress = false;
      expect(res.write.called, 'no busy warning was written').to.equal(true);
      expect(res.end.called, 'softRedeploy busy guard left the response open').to.equal(true);

      globalState.removalInProgress = true;
      const res2 = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };
      await advancedWorkflows.hardRedeploy(newAppSpecs, res2);
      globalState.removalInProgress = false;
      expect(res2.write.called, 'no busy warning was written').to.equal(true);
      expect(res2.end.called, 'hardRedeploy busy guard left the response open').to.equal(true);
    });

    it('restores the local record and keeps the app when the register fails before its re-insert', async () => {
      // Same window, register side: the caller's teardown already deleted the
      // row, and ensureAppDockerNetwork throws before insertOneToDatabase ran.
      // A soft register only ever runs over an app installed here, so the
      // catch restores the row and keeps rather than removing.
      const { newAppSpecs } = rowlessWindowFixture();
      const rowState = stubRowLifecycle(null);

      const removeSpy = sinon.stub(appUninstaller, 'removeAppLocally').resolves();
      sinon.stub(appInstaller, 'checkAppRequirements').resolves(true);
      sinon.stub(appInstaller, 'ensureAppDockerNetwork').rejects(new Error('docker daemon not responding'));
      const installSoft = sinon.stub(appInstaller, 'installApplicationSoft').resolves();
      sinon.stub(generalService, 'nodeTier').resolves('basic');
      sinon.stub(serviceHelper, 'delay').resolves();

      globalState.receiveOnlySyncthingAppsCache.clear();

      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      await advancedWorkflows.softRegisterAppLocally(newAppSpecs, undefined, res);

      expect(removeSpy.called, 'a pre-insert register failure removed the app and its data').to.equal(false);
      expect(installSoft.called).to.equal(false);
      expect(rowState.localRow, 'the local record was not restored').to.not.equal(null);
      expect(rowState.localRow.name).to.equal('TestApp');
      expect(globalState.installationInProgress, 'the installation flag leaked').to.equal(false);
      expect(
        globalState.receiveOnlySyncthingAppsCache.size,
        'the kept g: component was not re-marked synced',
      ).to.be.greaterThan(0);
    });

    it('restores the local record and keeps the app when the node tier read fails mid-redeploy', async () => {
      // nodeTier failing (a wedged/restarting daemon) used to early-return out
      // of the register inside the rowless window: row deleted, containers
      // gone, volume mounted, nothing keeping or removing or converging the
      // app. It must route through the keep path like any other failure.
      const { installedApp, newAppSpecs } = rowlessWindowFixture();
      const rowState = stubRowLifecycle(installedApp);

      const removeSpy = sinon.stub(appUninstaller, 'removeAppLocally').resolves();
      sinon.stub(appUninstaller, 'softUninstallComponent').resolves();

      sinon.stub(appInstaller, 'checkAppRequirements').resolves(true);
      const installSoft = sinon.stub(appInstaller, 'installApplicationSoft').resolves();
      sinon.stub(generalService, 'nodeTier').rejects(new Error('daemon wedged'));
      sinon.stub(serviceHelper, 'delay').resolves();

      globalState.receiveOnlySyncthingAppsCache.clear();

      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      await advancedWorkflows.softRedeploy(newAppSpecs, res);

      expect(removeSpy.called, 'the tier failure removed the app and its data').to.equal(false);
      expect(installSoft.called).to.equal(false);
      expect(rowState.localRow, 'the local record was not restored').to.not.equal(null);
      expect(globalState.installationInProgress, 'the installation flag leaked').to.equal(false);
      expect(
        globalState.receiveOnlySyncthingAppsCache.size,
        'the kept g: component was not re-marked synced',
      ).to.be.greaterThan(0);
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

  // Note: verifyAppUpdateParameters, createAppVolume,
  // getPeerAppsInstallingErrorMessages, and stopSyncthingApp are
  // complex integration functions or HTTP request handlers that require extensive
  // mocking of database connections, HTTP requests, and external services.
  // These should be tested in integration tests rather than unit tests.
  // masterSlaveApps is included above with basic tests, but full integration testing
  // is recommended for comprehensive coverage of the master-slave coordination logic.

  describe('startMasterSlaveApps scheduler', () => {
    let clock;
    let globalStateMock;
    let installedAppsStub;
    let listRunningAppsStub;
    let intervalMs;
    let maxPassMs;

    beforeEach(() => {
      intervalMs = config.fluxapps.masterSlaveIntervalMs ?? 30 * 1000;
      maxPassMs = config.fluxapps.masterSlaveMaxPassMs ?? Math.max(intervalMs * 4, 2 * 60 * 1000);

      globalStateMock = {
        installationInProgress: false,
        removalInProgress: false,
        softRedeployInProgress: false,
        hardRedeployInProgress: false,
        syncthingAppsFirstRun: false,
        masterSlaveAppsRunning: false,
      };

      // Empty app list => masterSlaveApps completes a fast no-op pass each tick.
      installedAppsStub = sinon.stub().resolves({ status: 'success', data: [] });
      listRunningAppsStub = sinon.stub().resolves({ status: 'success', data: [] });

      sinon.stub(syncthingService, 'getHealth').resolves({ status: 'success', data: { status: 'OK' } });
      sinon.stub(appQueryService, 'decryptEnterpriseApps').callsFake((apps) => Promise.resolve(apps));

      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      if (clock) clock.restore();
      sinon.restore();
    });

    it('returns a control object and is active after start', () => {
      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedAppsStub, listRunningAppsStub, new Map(), [], [], https,
      );
      expect(control).to.have.property('stop').that.is.a('function');
      expect(control).to.have.property('isActive').that.is.a('function');
      expect(control.isActive()).to.be.true;
      control.stop();
    });

    it('stops ticking after stop() is called', async () => {
      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedAppsStub, listRunningAppsStub, new Map(), [], [], https,
      );
      await clock.tickAsync(50); // let the immediate pass run
      const callsBeforeStop = installedAppsStub.callCount;
      control.stop();
      expect(control.isActive()).to.be.false;
      await clock.tickAsync(intervalMs * 3);
      // no further passes after stop
      expect(installedAppsStub.callCount).to.equal(callsBeforeStop);
    });

    it('keeps running across intervals - the scheduler does not die after one pass', async () => {
      // This is the core guarantee of the fix: the previous recursive-finally
      // reschedule could stop after a single pass, leaving g: apps unelected.
      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedAppsStub, listRunningAppsStub, new Map(), [], [], https,
      );
      await clock.tickAsync(50); // immediate pass
      expect(installedAppsStub.callCount).to.equal(1);
      await clock.tickAsync(intervalMs); // next interval tick
      expect(installedAppsStub.callCount).to.be.at.least(2);
      await clock.tickAsync(intervalMs); // and again
      expect(installedAppsStub.callCount).to.be.at.least(3);
      control.stop();
    });

    // The watchdog is the whole reason the scheduler exists. Production died with a
    // pass wedged on an un-timed-out await (installedApps/listRunningApps have no
    // timeout), so the `finally` that held the only reschedule never ran and
    // elections stopped for 18h on a node that never restarted. These three cover
    // the contract: hold the guard while in flight, release it on timeout, run a
    // fresh pass after.
    const wedgedPass = () => new Promise(() => {});

    it('skips a tick while the previous pass is still in flight', async () => {
      const hanging = sinon.stub().callsFake(wedgedPass);
      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, hanging, listRunningAppsStub, new Map(), [], [], https,
      );
      await clock.tickAsync(50); // immediate pass, wedges on installedApps
      expect(hanging.callCount).to.equal(1);

      // ticks land while the pass is still running - single-flight must not
      // stack a second concurrent pass on top of it
      await clock.tickAsync(intervalMs * 2);
      expect(hanging.callCount).to.equal(1);
      control.stop();
    });

    it('runs a fresh pass after the watchdog abandons a wedged one', async () => {
      let calls = 0;
      // first pass never settles; later passes complete normally
      const installedApps = sinon.stub().callsFake(() => {
        calls += 1;
        return calls === 1 ? wedgedPass() : Promise.resolve({ status: 'success', data: [] });
      });

      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedApps, listRunningAppsStub, new Map(), [], [], https,
      );
      await clock.tickAsync(50);
      expect(installedApps.callCount).to.equal(1);

      // nothing runs while the pass is wedged
      await clock.tickAsync(intervalMs * 2);
      expect(installedApps.callCount).to.equal(1);

      // past the watchdog: the guard is released and the next tick runs again
      await clock.tickAsync(maxPassMs + intervalMs + 50);
      expect(installedApps.callCount, 'watchdog never released the single-flight guard').to.be.at.least(2);
      control.stop();
    });

    it('a pass abandoned by the watchdog cannot act when it later unwedges', async () => {
      // The watchdog frees the guard but cannot cancel the pass, and production
      // passes stalled 810s and 1050s and then RESUMED. A pass waking up that stale
      // must not flip a live primary's syncthing folder or write controller state
      // on a view of the world that has since been replaced.
      const appName = 'gapp';
      const identifier = `gcomp_${appName}`;
      const setControllerDesired = sinon.stub(appReconciler, 'setControllerDesired');
      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: { status: 'success', data: { ips: ['192.168.1.99'] } } });

      // this node is a standby (FDM names another primary) with the g: component
      // running, which is the branch that writes desired-stopped
      let releaseLocalAddr;
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').returns(new Promise((resolve) => {
        releaseLocalAddr = () => resolve('192.168.1.5:16127');
      }));

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: appName, version: 8, compose: [{ name: 'gcomp', containerData: 'g:/data' }] }],
      });
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: [{ Names: [`/flux${identifier}`] }],
      });

      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedApps, listRunningApps, new Map(), [], [], https,
      );

      // pass 1 reaches the FDM lookup then wedges before it can decide
      await clock.tickAsync(50);
      expect(setControllerDesired.called, 'acted before it had this node address').to.equal(false);

      // watchdog abandons it - generation moves on, and the next tick starts a fresh
      // pass which legitimately decides this node is a standby
      await clock.tickAsync(maxPassMs + 50);
      control.stop();

      // ...and only now does the abandoned pass's wedged call return. Both passes
      // are now resolving against the same stubs, so without the generation check
      // the decision is written twice - once by a pass whose view of FDM is
      // maxPassMs stale. Exactly one write is the contract.
      releaseLocalAddr();
      await clock.tickAsync(50);

      expect(
        setControllerDesired.callCount,
        'the abandoned pass wrote controller state on top of the pass that replaced it',
      ).to.equal(1);
      expect(setControllerDesired.calledWith(identifier, 'stopped', 'masterSlave standby')).to.equal(true);
    });

    it('a start chain from a completed pass survives a later pass being abandoned', async () => {
      // The start chain (two folder flips + a recursive permissions fix) legitimately
      // outlives the 30s pass cadence, so it is dispatched without await. Abandonment
      // must therefore be per-pass: when a LATER pass wedges and the watchdog gives up
      // on it, a completed pass's still-running chain must go on to issue its start.
      // Dropping it strands the g: app primaryless for another full cycle - every
      // cycle, on a node whose passes routinely run past the watchdog.
      const appName = 'gsurvive';
      const identifier = `gcomp_${appName}`;
      // eslint-disable-next-line global-require
      const dockerService = require('../../ZelBack/src/services/dockerService');
      // eslint-disable-next-line global-require
      const { appsFolder } = require('../../ZelBack/src/services/utils/appConstants');
      // eslint-disable-next-line global-require
      const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
      const appId = dockerService.getAppIdentifier(identifier);
      const setControllerDesired = sinon.stub(appReconciler, 'setControllerDesired');

      // FDM answers on every pass: no primary anywhere
      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: { status: 'success', data: { ips: [] } } });
      sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: '', stderr: '' }); // the chain's chmod
      // pass 1 gets this node's address; pass 2 wedges here and gets abandoned
      const localAddr = sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress');
      localAddr.onFirstCall().resolves('192.168.1.5:16127');
      localAddr.returns(new Promise(() => {}));
      // this node is the app's only location -> index 0, start immediately
      sinon.stub(registryManager, 'appLocation').resolves([{ ip: '192.168.1.5:16127' }]);

      // the chain parks on its first folder flip until the test releases it
      let releaseChain;
      const folders = (type) => ({ status: 'success', data: [{ id: 'f1', path: `${appsFolder}${appId}`, type }] });
      const getConfigFolders = sinon.stub(syncthingService, 'getConfigFolders');
      getConfigFolders.onFirstCall().returns(new Promise((resolve) => {
        releaseChain = () => resolve(folders('receiveonly'));
      }));
      getConfigFolders.resolves(folders('sendreceive'));

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: appName, version: 8, compose: [{ name: 'gcomp', containerData: 'g:/data' }] }],
      });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      const cache = new Map();
      cache.set(appId, { restarted: true }); // synced: eligible to become primary

      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedApps, listRunningApps, cache, [], [], https,
      );

      // pass 1 completes and dispatches the chain, which parks on the folder flip
      await clock.tickAsync(50);
      expect(installedApps.callCount).to.equal(1);
      expect(setControllerDesired.called, 'the chain acted before it was released').to.equal(false);

      // pass 2 wedges on the local-address lookup; the watchdog abandons it
      await clock.tickAsync(intervalMs + 50);
      expect(installedApps.callCount).to.equal(2);
      await clock.tickAsync(maxPassMs + 50);
      control.stop();

      // the completed pass's chain now finishes: its start must land
      releaseChain();
      await clock.tickAsync(50);

      expect(
        setControllerDesired.calledWith(identifier, 'running', 'masterSlave primary (synced)'),
        "another pass's abandonment dropped a completed pass's start",
      ).to.equal(true);
      expect(setControllerDesired.callCount).to.equal(1);
    });

    it('does not stack a second permissions-fix chain while one is still running', async () => {
      // The scheduler dispatches the chain without await every 30s, and the
      // recursive chmod legitimately runs for minutes - unguarded, every tick
      // stacks another full-tree walk over the inodes the previous one is
      // still fixing, with no self-termination.
      const appName = 'gstack';
      const identifier = `gcomp_${appName}`;
      // eslint-disable-next-line global-require
      const dockerService = require('../../ZelBack/src/services/dockerService');
      // eslint-disable-next-line global-require
      const { appsFolder } = require('../../ZelBack/src/services/utils/appConstants');
      // eslint-disable-next-line global-require
      const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
      const appId = dockerService.getAppIdentifier(identifier);
      const setControllerDesired = sinon.stub(appReconciler, 'setControllerDesired');

      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: { status: 'success', data: { ips: [] } } });
      sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: '', stderr: '' });
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.5:16127');
      sinon.stub(registryManager, 'appLocation').resolves([{ ip: '192.168.1.5:16127' }]);

      // the first chain parks on its first folder flip; later passes keep
      // electing and re-dispatching the whole time
      let releaseChain;
      const folders = (type) => ({ status: 'success', data: [{ id: 'f1', path: `${appsFolder}${appId}`, type }] });
      const getConfigFolders = sinon.stub(syncthingService, 'getConfigFolders');
      getConfigFolders.onFirstCall().returns(new Promise((resolve) => {
        releaseChain = () => resolve(folders('receiveonly'));
      }));
      getConfigFolders.resolves(folders('sendreceive'));

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: appName, version: 8, compose: [{ name: 'gcomp', containerData: 'g:/data' }] }],
      });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      const cache = new Map();
      cache.set(appId, { restarted: true });

      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedApps, listRunningApps, cache, [], [], https,
      );
      await clock.tickAsync(3 * intervalMs + 50); // pass 1 dispatches; passes 2-4 re-decide
      expect(installedApps.callCount).to.be.at.least(3);
      expect(
        getConfigFolders.callCount,
        'a second chain was dispatched while the first was still running',
      ).to.equal(1);
      control.stop();

      releaseChain();
      await clock.tickAsync(50);
      expect(setControllerDesired.calledOnceWith(identifier, 'running', 'masterSlave primary (synced)')).to.equal(true);
    });

    it('does not request a start when the permissions fix fails', async () => {
      // runCommand reports failure via result.error, never a rejection. The chain
      // must read that result - discarding it deadened the guard, and a node got
      // elected write-side primary over data whose ownership it could not fix.
      const appName = 'gpermfail';
      const identifier = `gcomp_${appName}`;
      // eslint-disable-next-line global-require
      const dockerService = require('../../ZelBack/src/services/dockerService');
      // eslint-disable-next-line global-require
      const { appsFolder } = require('../../ZelBack/src/services/utils/appConstants');
      // eslint-disable-next-line global-require
      const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
      const appId = dockerService.getAppIdentifier(identifier);
      const setControllerDesired = sinon.stub(appReconciler, 'setControllerDesired');

      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: { status: 'success', data: { ips: [] } } });
      sinon.stub(serviceHelper, 'runCommand').resolves({ error: new Error('chmod: cannot access'), stdout: '', stderr: '' });
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.5:16127');
      sinon.stub(registryManager, 'appLocation').resolves([{ ip: '192.168.1.5:16127' }]);
      const getConfigFolders = sinon.stub(syncthingService, 'getConfigFolders')
        .resolves({ status: 'success', data: [{ id: 'f1', path: `${appsFolder}${appId}`, type: 'receiveonly' }] });

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: appName, version: 8, compose: [{ name: 'gcomp', containerData: 'g:/data' }] }],
      });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      const cache = new Map();
      cache.set(appId, { restarted: true });

      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedApps, listRunningApps, cache, [], [], https,
      );
      await clock.tickAsync(50);
      control.stop();

      expect(
        setControllerDesired.called,
        'started a primary over data whose permissions fix failed',
      ).to.equal(false);
      expect(
        getConfigFolders.callCount,
        'flipped the folder to sendreceive after a failed permissions fix',
      ).to.equal(1);
    });

    it('does not abandon a pass that is slow but still making progress', async () => {
      // The watchdog judges silence, not total elapsed time: a pass with several
      // g: apps against a degraded FDM legitimately outruns any fixed budget
      // while advancing, and abandoning it drops the standby stops / primary
      // starts for every app later in the list - on stable timings, the same
      // tail every cycle.
      const appNames = ['gslowa', 'gslowb'];
      const identifiers = appNames.map((n) => `gcomp_${n}`);
      const setControllerDesired = sinon.stub(appReconciler, 'setControllerDesired');

      // FDM answers with another node as primary - after 3/4 of the watchdog
      // budget, so two apps together far exceed the budget but each answer is
      // fresh progress
      const fdmDelayMs = Math.round(maxPassMs * 0.75);
      sinon.stub(serviceHelper, 'axiosGet').callsFake(() => new Promise((resolve) => {
        setTimeout(() => resolve({ data: { status: 'success', data: { ips: ['192.168.1.99'] } } }), fdmDelayMs);
      }));
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.5:16127');

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: appNames.map((name) => ({ name, version: 8, compose: [{ name: 'gcomp', containerData: 'g:/data' }] })),
      });
      // both components run here, and FDM names another primary -> standby stops
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: identifiers.map((id) => ({ Names: [`/flux${id}`] })),
      });

      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedApps, listRunningApps, new Map(), [], [], https,
      );
      await clock.tickAsync(2 * fdmDelayMs + 1000);
      control.stop();

      identifiers.forEach((id) => {
        expect(
          setControllerDesired.calledWith(id, 'stopped', 'masterSlave standby'),
          `the slow-but-advancing pass was abandoned before it reached ${id}`,
        ).to.equal(true);
      });
    });

    it("an abandoned pass's late finally does not release the lock its replacement holds", async () => {
      // The finally only clears masterSlaveAppsRunning when its pass is still
      // current: an abandoned pass that unwedges minutes later must not clobber
      // the lock the live pass set for itself.
      const writes = [];
      let running = false;
      Object.defineProperty(globalStateMock, 'masterSlaveAppsRunning', {
        configurable: true,
        get: () => running,
        set: (value) => { running = value; writes.push(value); },
      });
      // eslint-disable-next-line global-require
      const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
      sinon.stub(registryManager, 'appLocation').resolves([]);
      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: { status: 'success', data: { ips: [] } } });
      sinon.stub(syncthingService, 'getConfigFolders').resolves({ status: 'error' });

      // pass 1 wedges on the address lookup and is abandoned; pass 2 wedges the
      // same way and is still in flight when pass 1 is released
      let releaseFirst;
      const localAddr = sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress');
      localAddr.onFirstCall().returns(new Promise((resolve) => {
        releaseFirst = () => resolve('192.168.1.5:16127');
      }));
      localAddr.returns(new Promise(() => {}));

      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: 'glateclear', version: 8, compose: [{ name: 'gcomp', containerData: 'g:/data' }] }],
      });

      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, installedApps, listRunningAppsStub, new Map(), [], [], https,
      );
      await clock.tickAsync(50);
      expect(writes).to.deep.equal([true]);

      // the watchdog abandons pass 1 (writes false), and the next interval tick -
      // possibly in the same timer batch - starts pass 2, which wedges too
      await clock.tickAsync(maxPassMs + intervalMs);
      expect(writes).to.deep.equal([true, false, true]);
      control.stop();

      releaseFirst(); // pass 1 unwedges and runs its finally
      await clock.tickAsync(50);
      expect(
        writes,
        "the abandoned pass's finally released the replacement's lock",
      ).to.deep.equal([true, false, true]);
    });

    it('releases the global masterSlaveAppsRunning lock when it abandons a pass', async () => {
      // masterSlaveApps sets this true on entry and false in its own `finally` -
      // which a wedged pass never reaches. appInstaller reads it to gate
      // performDockerCleanup, so if the scheduler does not clear it alongside its
      // own guard it stays set for the life of the process.
      const writes = [];
      let running = false;
      Object.defineProperty(globalStateMock, 'masterSlaveAppsRunning', {
        configurable: true,
        get: () => running,
        set: (value) => { running = value; writes.push(value); },
      });

      // every pass wedges, so masterSlaveApps itself can never write false -
      // any false here came from the scheduler releasing the lock
      const control = advancedWorkflows.startMasterSlaveApps(
        globalStateMock, sinon.stub().callsFake(wedgedPass), listRunningAppsStub, new Map(), [], [], https,
      );
      await clock.tickAsync(50);
      expect(writes).to.deep.equal([true]);

      await clock.tickAsync(maxPassMs + 50);
      expect(
        writes.includes(false),
        'a wedged pass leaves globalState.masterSlaveAppsRunning set forever',
      ).to.equal(true);
      control.stop();
    });
  });
});
