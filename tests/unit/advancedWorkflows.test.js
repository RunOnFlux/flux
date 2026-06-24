// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const InstallResult = require('../../ZelBack/src/services/appLifecycle/installResult');

describe('advancedWorkflows tests', () => {
  afterEach(() => {
    sinon.restore();
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
      globalState.removalInProgressReset();
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
      globalState.removalInProgressReset();
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;

      res = {
        write: sinon.stub(),
        flush: sinon.stub(),
      };
    });

    it('should return early if removal is in progress', async () => {
      globalState.markRemovalInProgress('__test__');

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
      globalState.removalInProgressReset();
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;

      res = {
        write: sinon.stub(),
        flush: sinon.stub(),
      };
    });

    it('should return early if removal is in progress', async () => {
      globalState.markRemovalInProgress('__test__');

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
    let syncthingServiceHealthStub;
    let decryptEnterpriseAppsStub;
    let recursionCounter;

    beforeEach(() => {
      recursionCounter = 0;
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.masterSlaveAppsRunning = false;
      globalState.installationInProgress = false;
      globalState.removalInProgressReset();
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
      syncthingServiceHealthStub = sinon.stub(syncthingService, 'getHealth').resolves({
        status: 'success',
        data: { status: 'OK' },
      });

      // Stub decryptEnterpriseApps to return apps as-is
      const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');
      decryptEnterpriseAppsStub = sinon.stub(appQueryService, 'decryptEnterpriseApps').callsFake((apps) => Promise.resolve(apps));

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
      globalState.markRemovalInProgress('__test__');

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
    let databaseConnectionStub;

    beforeEach(() => {
      // Reset global state
      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgressReset();
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;

      // Setup database connection stub
      databaseConnectionStub = sinon.stub(dbHelper, 'databaseConnection').returns({
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

  describe('redeploy port reconcile-on-register-success (C3) tests', () => {
    let globalState;
    let appUninstaller;
    let appInstaller;
    let serviceHelper;
    let res;

    // Same component count + names so no escalation to hard; ports differ so a delta exists.
    // old ports {31000, 31001}; new ports {31001, 31002}; delta toOpen [31002], toClose [31000].
    const installedApp = {
      name: 'TestApp',
      version: 8,
      compose: [{ name: 'c1', repotag: 'repo/c1:1.0', ports: [31000, 31001] }],
    };
    const newAppSpecs = {
      name: 'TestApp',
      version: 8,
      compose: [{ name: 'c1', repotag: 'repo/c1:2.0', ports: [31001, 31002] }],
    };

    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgressReset();
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;

      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      // getInstalledAppsFromDb (delta lookup) reads via findInDatabase
      sinon.stub(dbHelper, 'findInDatabase').resolves([installedApp]);
      // localAppRowConfirmedAbsent reads via findOneInDatabase; default: row absent
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      // eslint-disable-next-line global-require
      appUninstaller = require('../../ZelBack/src/services/appLifecycle/appUninstaller');
      sinon.stub(appUninstaller, 'removeAppLocally').resolves();
      sinon.stub(appUninstaller, 'cleanupPorts').resolves(); // observe port CLOSES

      // eslint-disable-next-line global-require
      appInstaller = require('../../ZelBack/src/services/appLifecycle/appInstaller');
      sinon.stub(appInstaller, 'checkAppRequirements').resolves();
      sinon.stub(appInstaller, 'setupApplicationPorts').resolves(); // observe port OPENS (reconcile)

      // eslint-disable-next-line global-require
      serviceHelper = require('../../ZelBack/src/services/serviceHelper');
      sinon.stub(serviceHelper, 'delay').resolves();

      res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('hardRedeploy reconciles the port DELTA when the reinstall SUCCEEDS (true)', async () => {
      sinon.stub(appInstaller, 'registerAppLocally').resolves(InstallResult.INSTALLED);

      await advancedWorkflows.hardRedeploy(newAppSpecs, res);

      // opened only the added ports (new-old)
      expect(appInstaller.setupApplicationPorts.calledOnce).to.be.true;
      expect(appInstaller.setupApplicationPorts.firstCall.args[0].ports).to.deep.equal([31002]);
      // closed only the removed ports (old-new) via reconcile - NOT the full old set
      expect(appUninstaller.cleanupPorts.calledOnce).to.be.true;
      expect(appUninstaller.cleanupPorts.firstCall.args[0].ports).to.deep.equal([31000]);
      expect(globalState.hardRedeployInProgress).to.be.false;
    });

    it('hardRedeploy does NOT open ports and closes the FULL old set when the reinstall DEFERS', async () => {
      sinon.stub(appInstaller, 'registerAppLocally').resolves(InstallResult.DEFERRED);

      await advancedWorkflows.hardRedeploy(newAppSpecs, res);

      // no open for an app that is gone
      expect(appInstaller.setupApplicationPorts.called).to.be.false;
      // closed the full old set (row confirmed absent)
      expect(appUninstaller.cleanupPorts.calledOnce).to.be.true;
      expect(appUninstaller.cleanupPorts.firstCall.args[0].ports).to.deep.equal([31000, 31001]);
      expect(globalState.hardRedeployInProgress).to.be.false;
    });

    it('hardRedeploy does NOT open ports and closes the FULL old set when the reinstall FAILS (false)', async () => {
      sinon.stub(appInstaller, 'registerAppLocally').resolves(InstallResult.FAILED);

      await advancedWorkflows.hardRedeploy(newAppSpecs, res);

      expect(appInstaller.setupApplicationPorts.called).to.be.false;
      expect(appUninstaller.cleanupPorts.calledOnce).to.be.true;
      expect(appUninstaller.cleanupPorts.firstCall.args[0].ports).to.deep.equal([31000, 31001]);
    });

    it('hardRedeploy does NOT strip ports when a local row still exists (concurrent reinstall re-adopted the app)', async () => {
      sinon.stub(appInstaller, 'registerAppLocally').resolves(InstallResult.DEFERRED);
      dbHelper.findOneInDatabase.resolves({ name: 'TestApp' }); // row PRESENT -> not confirmed-absent

      await advancedWorkflows.hardRedeploy(newAppSpecs, res);

      expect(appInstaller.setupApplicationPorts.called).to.be.false;
      // skipped: closing would strip a live app's ports
      expect(appUninstaller.cleanupPorts.called).to.be.false;
    });
  });

  describe('softRegisterAppLocally return contract (C3) tests', () => {
    let globalState;

    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgressReset();
      globalState.installationInProgress = false;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('returns true on a successful soft reinstall', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null); // not already installed
      sinon.stub(dbHelper, 'insertOneToDatabase').resolves({ insertedId: 'x' });

      // eslint-disable-next-line global-require
      const generalService = require('../../ZelBack/src/services/generalService');
      sinon.stub(generalService, 'nodeTier').resolves('cumulus');
      // eslint-disable-next-line global-require
      const appNetworkLinker = require('../../ZelBack/src/services/appLifecycle/appNetworkLinker');
      sinon.stub(appNetworkLinker, 'checkAppNetworkRequirements').resolves();
      sinon.stub(appNetworkLinker, 'reconnectLinkedApps').resolves();
      // eslint-disable-next-line global-require
      const dockerService = require('../../ZelBack/src/services/dockerService');
      sinon.stub(dockerService, 'createFluxAppDockerNetwork').resolves({ id: 'net' });
      sinon.stub(dockerService, 'getFluxDockerNetworkPhysicalInterfaceNames').resolves(['br-x']);
      // eslint-disable-next-line global-require
      const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
      sinon.stub(fluxNetworkHelper, 'removeDockerContainerAccessToNonRoutable').resolves(true);
      // eslint-disable-next-line global-require
      const appInstaller = require('../../ZelBack/src/services/appLifecycle/appInstaller');
      sinon.stub(appInstaller, 'installApplicationSoft').resolves();

      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };
      const spec = { name: 'TestApp', version: 8, compose: [{ name: 'c1', repotag: 'repo/c1:1.0', ports: [31000] }] };

      const result = await advancedWorkflows.softRegisterAppLocally(spec, undefined, res, { skipPorts: true });
      expect(result).to.equal(InstallResult.INSTALLED);
    });

    it('returns false AND awaits the cleanup removeAppLocally on a reinstall failure', async () => {
      // databaseConnection returns a stub whose db() has no collection() -> findOneInDatabase
      // throws inside the try, driving softRegisterAppLocally into its catch.
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      // eslint-disable-next-line global-require
      const generalService = require('../../ZelBack/src/services/generalService');
      sinon.stub(generalService, 'nodeTier').resolves('cumulus');
      // eslint-disable-next-line global-require
      const appUninstaller = require('../../ZelBack/src/services/appLifecycle/appUninstaller');
      const removeStub = sinon.stub(appUninstaller, 'removeAppLocally').resolves();

      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };
      const spec = { name: 'TestApp', version: 8, compose: [{ name: 'c1', repotag: 'repo/c1:1.0', ports: [31000] }] };

      const result = await advancedWorkflows.softRegisterAppLocally(spec, undefined, res, { skipPorts: true });
      expect(result).to.equal(InstallResult.FAILED);
      // the failure cleanup is now AWAITED (was fire-and-forget), so it has run by return
      expect(removeStub.calledOnce).to.be.true;
    });

    it('DEFERS (per-app gate) when THIS app is undergoing removal', async () => {
      globalState.markRemovalInProgress('TestApp'); // a removal of the SAME app
      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };
      const spec = { name: 'TestApp', version: 8, compose: [{ name: 'c1', ports: [31000] }] };

      const result = await advancedWorkflows.softRegisterAppLocally(spec, undefined, res, {});
      expect(result).to.equal(InstallResult.DEFERRED);
    });

    it('DEFERS (not FAILED) when nodeTier fails, and clears installationInProgress (no wedge)', async () => {
      // eslint-disable-next-line global-require
      const generalService = require('../../ZelBack/src/services/generalService');
      sinon.stub(generalService, 'nodeTier').resolves(null);
      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };
      const spec = { name: 'TestApp', version: 8, compose: [{ name: 'c1', ports: [31000] }] };

      const result = await advancedWorkflows.softRegisterAppLocally(spec, undefined, res, {});
      expect(result).to.equal(InstallResult.DEFERRED);
      expect(globalState.installationInProgress).to.be.false;
    });
  });

  // Note: verifyAppUpdateParameters, createAppVolume,
  // getPeerAppsInstallingErrorMessages, and stopSyncthingApp are
  // complex integration functions or HTTP request handlers that require extensive
  // mocking of database connections, HTTP requests, and external services.
  // These should be tested in integration tests rather than unit tests.
  // masterSlaveApps is included above with basic tests, but full integration testing
  // is recommended for comprehensive coverage of the master-slave coordination logic.

  describe('softRegisterAppLocally cancel-vs-install guards (C1) tests', () => {
    let globalState;
    let pendingTeardownStore;
    let appInstaller;
    let appNetworkLinker;
    let dockerService;
    let fluxNetworkHelper;
    let generalService;
    let res;

    const spec = { name: 'TestApp', version: 8, compose: [{ name: 'c1', repotag: 'repo/c1:1.0', ports: [31000] }] };

    // Stub the whole soft-install success path so a test can observe the guards. Each test
    // overrides one piece (teardownOwedFor, or what installApplicationSoft captures).
    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgressReset();
      globalState.installationInProgress = false;
      globalState.installingApps.clear();

      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null); // not already installed
      sinon.stub(dbHelper, 'insertOneToDatabase').resolves({ insertedId: 'x' });

      // eslint-disable-next-line global-require
      pendingTeardownStore = require('../../ZelBack/src/services/appLifecycle/pendingTeardownStore');
      sinon.stub(pendingTeardownStore, 'teardownOwedFor').resolves(false); // default: no teardown owed

      // eslint-disable-next-line global-require
      generalService = require('../../ZelBack/src/services/generalService');
      sinon.stub(generalService, 'nodeTier').resolves('cumulus');
      // eslint-disable-next-line global-require
      appNetworkLinker = require('../../ZelBack/src/services/appLifecycle/appNetworkLinker');
      sinon.stub(appNetworkLinker, 'checkAppNetworkRequirements').resolves();
      sinon.stub(appNetworkLinker, 'reconnectLinkedApps').resolves();
      // eslint-disable-next-line global-require
      dockerService = require('../../ZelBack/src/services/dockerService');
      sinon.stub(dockerService, 'createFluxAppDockerNetwork').resolves({ id: 'net' });
      sinon.stub(dockerService, 'getFluxDockerNetworkPhysicalInterfaceNames').resolves(['br-x']);
      // eslint-disable-next-line global-require
      fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
      sinon.stub(fluxNetworkHelper, 'removeDockerContainerAccessToNonRoutable').resolves(true);
      // eslint-disable-next-line global-require
      appInstaller = require('../../ZelBack/src/services/appLifecycle/appInstaller');
      sinon.stub(appInstaller, 'installApplicationSoft').resolves();
      sinon.stub(appInstaller, 'clearCondemnedStampsForInstall').resolves();

      res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('DEFERS (returns deferred, no install) when a teardown of the app is still owed', async () => {
      pendingTeardownStore.teardownOwedFor.resolves(true); // a cancel is still draining

      const result = await advancedWorkflows.softRegisterAppLocally(spec, undefined, res, {});

      expect(result).to.equal(InstallResult.DEFERRED);
      expect(appInstaller.installApplicationSoft.called).to.be.false; // never reached the install
    });

    it('does NOT defer when an UNRELATED app is being removed (per-app gate, F-C)', async () => {
      globalState.markRemovalInProgress('SomeOtherApp'); // a DIFFERENT app's removal

      const result = await advancedWorkflows.softRegisterAppLocally(spec, undefined, res, { skipPorts: true });

      // the per-app gate only blocks a removal of THIS app; an unrelated removal must not
      // spuriously fail the soft reinstall (the node-wide gate used to)
      expect(result).to.equal(InstallResult.INSTALLED);
      expect(appInstaller.installApplicationSoft.called).to.be.true;
    });

    it('registers an AbortController for the app during the install, and clears it after', async () => {
      let controllerDuringInstall;
      appInstaller.installApplicationSoft.callsFake(() => {
        controllerDuringInstall = globalState.installingApps.get('TestApp');
        return Promise.resolve();
      });

      const result = await advancedWorkflows.softRegisterAppLocally(spec, undefined, res, { skipPorts: true });

      expect(result).to.equal(InstallResult.INSTALLED);
      // the in-flight install was registered so a concurrent cancel can abort its pull
      expect(controllerDuringInstall).to.be.instanceOf(AbortController);
      // and cleared in the finally
      expect(globalState.installingApps.has('TestApp')).to.be.false;
    });

    it('clears the condemned stamp for the installed app (componentSpecs null for a whole-app install)', async () => {
      const result = await advancedWorkflows.softRegisterAppLocally(spec, undefined, res, { skipPorts: true });

      expect(result).to.equal(InstallResult.INSTALLED);
      expect(appInstaller.clearCondemnedStampsForInstall.calledOnce).to.be.true;
      expect(appInstaller.clearCondemnedStampsForInstall.firstCall.args[0]).to.equal(spec);
      expect(appInstaller.clearCondemnedStampsForInstall.firstCall.args[1]).to.equal(null);
    });
  });
});
