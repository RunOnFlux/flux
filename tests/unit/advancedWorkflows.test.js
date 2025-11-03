// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const dbHelper = require('../../ZelBack/src/services/dbHelper');

describe('advancedWorkflows tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('getPreviousAppSpecifications tests', () => {
    it('should throw error if no previous message found', async () => {
      const specifications = { name: 'NewApp' };
      const verificationTimestamp = Date.now();

      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);

      try {
        await advancedWorkflows.getPreviousAppSpecifications(specifications, verificationTimestamp);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('does not exists');
      }
    });
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
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.restoreInProgress = [];
    });

    it('should add app to restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');

      const globalState = require('../../ZelBack/src/services/utils/globalState');
      expect(globalState.restoreInProgress).to.include('TestApp');
    });

    it('should remove app from restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');
      advancedWorkflows.removeFromRestoreProgress('TestApp');

      const globalState = require('../../ZelBack/src/services/utils/globalState');
      expect(globalState.restoreInProgress).to.not.include('TestApp');
    });

    it('should not duplicate apps in restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');
      advancedWorkflows.addToRestoreProgress('TestApp');

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
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgress = false;
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;
      globalState.restoreInProgress = [];

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

  // Note: verifyAppUpdateParameters, validateApplicationUpdateCompatibility,
  // createAppVolume, getPeerAppsInstallingErrorMessages, and stopSyncthingApp are
  // complex integration functions or HTTP request handlers that require extensive
  // mocking of database connections, HTTP requests, and external services.
  // These should be tested in integration tests rather than unit tests.
});
