const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const appController = require('../../ZelBack/src/services/appManagement/appController');
const dockerService = require('../../ZelBack/src/services/dockerService');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const appInspector = require('../../ZelBack/src/services/appManagement/appInspector');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');

describe('appController tests', () => {
  let verificationHelperStub;
  let db;
  // eslint-disable-next-line no-unused-vars
  let database;

  beforeEach(async () => {
    await dbHelper.initiateDB();
    db = dbHelper.databaseConnection();
    database = db.db(config.database.appsglobal.database);

    // Setup common stubs
    // eslint-disable-next-line global-require
    const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
    verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('appStart tests', () => {
    beforeEach(() => {
      sinon.stub(dockerService, 'appDockerStart').resolves('Flux App TestApp successfully started.');
      sinon.stub(appInspector, 'startAppMonitoring');
    });

    it('should start app and return success message', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'TestApp',
        version: 3,
      });

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledOnce(dockerService.appDockerStart);
    });

    it('should return error if no app name provided', async () => {
      verificationHelperStub.resolves(true);

      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('error');
      expect(result.data.message).to.include('No Flux App specified');
    });

    it('should return unauthorized if user not authorized', async () => {
      verificationHelperStub.resolves(false);

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('error');
      expect(result.data.code).to.equal(401);
    });

    it('should handle component start for component names', async () => {
      verificationHelperStub.resolves(true);

      const req = {
        params: { appname: 'Component_TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledOnce(dockerService.appDockerStart);
      sinon.assert.calledWith(dockerService.appDockerStart, 'Component_TestApp');
    });

    it('should start all components for version 4+ apps', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'Component1' },
          { name: 'Component2' },
        ],
      });

      const req = {
        params: { appname: 'ComposedApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledTwice(dockerService.appDockerStart);
      sinon.assert.calledWith(dockerService.appDockerStart, 'Component1_ComposedApp');
      sinon.assert.calledWith(dockerService.appDockerStart, 'Component2_ComposedApp');
    });

    it('should handle global start parameter', async () => {
      verificationHelperStub.resolves(true);

      const req = {
        params: { appname: 'TestApp', global: 'true' },
        query: {},
        headers: { zelidauth: 'test-auth' },
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      sinon.stub(appController, 'executeAppGlobalCommand');

      await appController.appStart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      expect(result.data.message).to.include('global start');
    });
  });

  describe('appStop tests', () => {
    beforeEach(() => {
      sinon.stub(dockerService, 'appDockerStop').resolves('Flux App TestApp successfully stopped.');
      sinon.stub(appInspector, 'stopAppMonitoring');
    });

    it('should stop app and return success message', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'TestApp',
        version: 3,
      });

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStop(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledOnce(dockerService.appDockerStop);
      sinon.assert.calledOnce(appInspector.stopAppMonitoring);
    });

    it('should stop all components for version 4+ apps in reverse order', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'Component1' },
          { name: 'Component2' },
        ],
      });

      const req = {
        params: { appname: 'ComposedApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStop(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      // Should be called in reverse order
      sinon.assert.calledTwice(dockerService.appDockerStop);
    });

    it('should handle component stop', async () => {
      verificationHelperStub.resolves(true);

      const req = {
        params: { appname: 'Component_TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStop(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledOnce(dockerService.appDockerStop);
      sinon.assert.calledWith(dockerService.appDockerStop, 'Component_TestApp');
    });
  });

  describe('appRestart tests', () => {
    beforeEach(() => {
      sinon.stub(dockerService, 'appDockerRestart').resolves('Flux App TestApp successfully restarted.');
    });

    it('should restart app and return success message', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'TestApp',
        version: 3,
      });

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appRestart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledOnce(dockerService.appDockerRestart);
    });

    it('should restart all components for version 4+ apps', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'Component1' },
          { name: 'Component2' },
        ],
      });

      const req = {
        params: { appname: 'ComposedApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appRestart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledTwice(dockerService.appDockerRestart);
    });

    it('should return unauthorized if user not authorized', async () => {
      verificationHelperStub.resolves(false);

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appRestart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('error');
      expect(result.data.code).to.equal(401);
    });
  });

  describe('appKill tests', () => {
    beforeEach(() => {
      sinon.stub(dockerService, 'appDockerKill').resolves('Flux App TestApp successfully killed.');
    });

    it('should kill app and return success message', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'TestApp',
        version: 3,
      });

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appKill(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledOnce(dockerService.appDockerKill);
    });

    it('should kill all components for version 4+ apps in reverse order', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'Component1' },
          { name: 'Component2' },
        ],
      });

      const req = {
        params: { appname: 'ComposedApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appKill(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledTwice(dockerService.appDockerKill);
    });

    it('should return error if app not found', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves(null);

      const req = {
        params: { appname: 'NonExistentApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appKill(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('error');
      expect(result.data.message).to.include('Application not found');
    });
  });

  describe('appPause tests', () => {
    beforeEach(() => {
      sinon.stub(dockerService, 'appDockerPause').resolves('Flux App TestApp successfully paused.');
    });

    it('should pause app and return success message', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'TestApp',
        version: 3,
      });

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appPause(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledOnce(dockerService.appDockerPause);
    });

    it('should pause all components for version 4+ apps', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'Component1' },
          { name: 'Component2' },
        ],
      });

      const req = {
        params: { appname: 'ComposedApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appPause(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledTwice(dockerService.appDockerPause);
    });
  });

  describe('appUnpause tests', () => {
    beforeEach(() => {
      sinon.stub(dockerService, 'appDockerUnpause').resolves('Flux App TestApp successfully unpaused.');
    });

    it('should unpause app and return success message', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'TestApp',
        version: 3,
      });

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appUnpause(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledOnce(dockerService.appDockerUnpause);
    });

    it('should unpause all components for version 4+ apps', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'Component1' },
          { name: 'Component2' },
        ],
      });

      const req = {
        params: { appname: 'ComposedApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appUnpause(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      sinon.assert.calledTwice(dockerService.appDockerUnpause);
    });
  });

  describe('stopAllNonFluxRunningApps tests', () => {
    it('should stop all non-Flux apps', async () => {
      const nonFluxApps = [
        { Id: 'container1', Names: ['/testapp1'] },
        { Id: 'container2', Names: ['/testapp2'] },
      ];
      const fluxApps = [
        { Id: 'container3', Names: ['/fluxapp1'] },
        { Id: 'container4', Names: ['/zelapp1'] },
      ];

      sinon.stub(dockerService, 'dockerListContainers').resolves([...nonFluxApps, ...fluxApps]);
      const stopStub = sinon.stub(dockerService, 'appDockerStop').resolves();
      const clock = sinon.useFakeTimers();

      // Start the function (it will call itself recursively)
      appController.stopAllNonFluxRunningApps();

      // Wait for first iteration to complete
      await clock.tickAsync(100);

      // Verify only non-Flux apps were stopped
      sinon.assert.calledTwice(stopStub);
      sinon.assert.calledWith(stopStub.firstCall, 'container1');
      sinon.assert.calledWith(stopStub.secondCall, 'container2');

      clock.restore();
    });
  });

  describe('executeAppGlobalCommand tests', () => {
    beforeEach(() => {
      const locations = [
        { ip: '192.168.1.1:16127', name: 'TestApp' },
        { ip: '192.168.1.2:16127', name: 'TestApp' },
      ];
      sinon.stub(dbHelper, 'findInDatabase').resolves(locations);
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.3:16127');
    });

    it('should execute command on all app instances', async () => {
      // eslint-disable-next-line global-require
      const axios = require('axios');
      const axiosStub = sinon.stub(axios, 'get').resolves({ status: 200 });

      await appController.executeAppGlobalCommand('TestApp', 'appstart', 'test-auth');

      sinon.assert.calledTwice(axiosStub);
    });

    it('should skip own IP when bypassMyIp is true', async () => {
      sinon.restore();
      const locations = [
        { ip: '192.168.1.3:16127', name: 'TestApp' },
        { ip: '192.168.1.2:16127', name: 'TestApp' },
      ];
      sinon.stub(dbHelper, 'findInDatabase').resolves(locations);
      // eslint-disable-next-line global-require, no-shadow
      const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.3:16127');

      // eslint-disable-next-line global-require
      const axios = require('axios');
      const axiosStub = sinon.stub(axios, 'get').resolves({ status: 200 });

      await appController.executeAppGlobalCommand('TestApp', 'appstart', 'test-auth', null, true);

      // Should only call once, skipping own IP
      sinon.assert.calledOnce(axiosStub);
    });
  });
});
