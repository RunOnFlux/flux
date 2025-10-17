// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const dockerOperations = require('../../ZelBack/src/services/appManagement/dockerOperations');
const dockerService = require('../../ZelBack/src/services/dockerService');
const log = require('../../ZelBack/src/lib/log');

describe('dockerOperations tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('appDockerStop tests', () => {
    it('should stop a single component by name', async () => {
      const appname = 'Component1_TestApp';
      const stopCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub();

      sinon.stub(dockerService, 'appDockerStop').resolves();

      await dockerOperations.appDockerStop(appname, stopCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerStop, appname);
      sinon.assert.calledWith(stopCallback, appname, false, appsMonitored);
    });

    it('should stop a version 3 app', async () => {
      const appname = 'TestApp';
      const stopCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({
        name: 'TestApp',
        version: 3,
      });

      sinon.stub(dockerService, 'appDockerStop').resolves();

      await dockerOperations.appDockerStop(appname, stopCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerStop, appname);
      sinon.assert.calledWith(stopCallback, appname, false, appsMonitored);
    });

    it('should stop all components of a version 4 composed app', async () => {
      const appname = 'ComposedApp';
      const stopCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'Component1' },
          { name: 'Component2' },
          { name: 'Component3' },
        ],
      });

      sinon.stub(dockerService, 'appDockerStop').resolves();

      await dockerOperations.appDockerStop(appname, stopCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerStop, 'Component1_ComposedApp');
      sinon.assert.calledWith(dockerService.appDockerStop, 'Component2_ComposedApp');
      sinon.assert.calledWith(dockerService.appDockerStop, 'Component3_ComposedApp');
      sinon.assert.calledThrice(stopCallback);
    });

    it('should handle case when app specifications not found', async () => {
      const appname = 'NonExistentApp';
      const stopCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves(null);

      sinon.stub(dockerService, 'appDockerStop').resolves();
      const logStub = sinon.stub(log, 'error');

      await dockerOperations.appDockerStop(appname, stopCallback, appsMonitored, getSpecs);

      sinon.assert.calledOnce(logStub);
      expect(logStub.firstCall.args[0].message).to.include('Application not found');
    });

    it('should work without stopMonitoringCallback', async () => {
      const appname = 'Component1_TestApp';
      const appsMonitored = new Map();
      const getSpecs = sinon.stub();

      sinon.stub(dockerService, 'appDockerStop').resolves();

      await dockerOperations.appDockerStop(appname, null, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerStop, appname);
    });

    it('should handle docker stop errors gracefully', async () => {
      const appname = 'TestApp';
      const stopCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({ name: 'TestApp', version: 3 });

      sinon.stub(dockerService, 'appDockerStop').rejects(new Error('Docker stop failed'));
      const logStub = sinon.stub(log, 'error');

      await dockerOperations.appDockerStop(appname, stopCallback, appsMonitored, getSpecs);

      sinon.assert.calledOnce(logStub);
      expect(logStub.firstCall.args[0].message).to.include('Docker stop failed');
    });

    it('should stop component when name includes underscore', async () => {
      const appname = 'Web_MyApp';
      const stopCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub();

      sinon.stub(dockerService, 'appDockerStop').resolves();

      await dockerOperations.appDockerStop(appname, stopCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerStop, 'Web_MyApp');
      sinon.assert.calledWith(stopCallback, 'Web_MyApp', false, appsMonitored);
      sinon.assert.notCalled(getSpecs);
    });

    it('should extract main app name correctly from component', async () => {
      const appname = 'Frontend_ComplexApp';
      const stopCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub();

      sinon.stub(dockerService, 'appDockerStop').resolves();

      await dockerOperations.appDockerStop(appname, stopCallback, appsMonitored, getSpecs);

      // Should not call getSpecs for component-level stop
      sinon.assert.notCalled(getSpecs);
      sinon.assert.calledWith(dockerService.appDockerStop, appname);
    });
  });

  describe('appDockerRestart tests', () => {
    it('should restart a single component by name', async () => {
      const appname = 'Component1_TestApp';
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub();

      sinon.stub(dockerService, 'appDockerRestart').resolves();

      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerRestart, appname);
      sinon.assert.calledWith(startCallback, appname, appsMonitored);
    });

    it('should restart a version 3 app', async () => {
      const appname = 'TestApp';
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({
        name: 'TestApp',
        version: 3,
      });

      sinon.stub(dockerService, 'appDockerRestart').resolves();

      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerRestart, appname);
      sinon.assert.calledWith(startCallback, appname, appsMonitored);
    });

    it('should restart all components of a version 4 composed app', async () => {
      const appname = 'ComposedApp';
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'Component1' },
          { name: 'Component2' },
          { name: 'Component3' },
        ],
      });

      sinon.stub(dockerService, 'appDockerRestart').resolves();

      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerRestart, 'Component1_ComposedApp');
      sinon.assert.calledWith(dockerService.appDockerRestart, 'Component2_ComposedApp');
      sinon.assert.calledWith(dockerService.appDockerRestart, 'Component3_ComposedApp');
      sinon.assert.calledThrice(startCallback);
    });

    it('should handle case when app specifications not found', async () => {
      const appname = 'NonExistentApp';
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves(null);

      sinon.stub(dockerService, 'appDockerRestart').resolves();
      const logStub = sinon.stub(log, 'error');

      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.calledOnce(logStub);
      expect(logStub.firstCall.args[0].message).to.include('Application not found');
    });

    it('should work without startMonitoringCallback', async () => {
      const appname = 'Component1_TestApp';
      const appsMonitored = new Map();
      const getSpecs = sinon.stub();

      sinon.stub(dockerService, 'appDockerRestart').resolves();

      await dockerOperations.appDockerRestart(appname, null, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerRestart, appname);
    });

    it('should handle docker restart errors gracefully', async () => {
      const appname = 'TestApp';
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({ name: 'TestApp', version: 3 });

      sinon.stub(dockerService, 'appDockerRestart').rejects(new Error('Docker restart failed'));
      const logStub = sinon.stub(log, 'error');

      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.calledOnce(logStub);
      expect(logStub.firstCall.args[0].message).to.include('Docker restart failed');
    });

    it('should restart component when name includes underscore', async () => {
      const appname = 'API_MyService';
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub();

      sinon.stub(dockerService, 'appDockerRestart').resolves();

      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerRestart, 'API_MyService');
      sinon.assert.calledWith(startCallback, 'API_MyService', appsMonitored);
      sinon.assert.notCalled(getSpecs);
    });

    it('should handle version 2 app', async () => {
      const appname = 'LegacyApp';
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({
        name: 'LegacyApp',
        version: 2,
      });

      sinon.stub(dockerService, 'appDockerRestart').resolves();

      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerRestart, appname);
      sinon.assert.calledWith(startCallback, appname, appsMonitored);
    });

    it('should handle version 5 composed app', async () => {
      const appname = 'ModernApp';
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({
        name: 'ModernApp',
        version: 5,
        compose: [
          { name: 'Frontend' },
          { name: 'Backend' },
        ],
      });

      sinon.stub(dockerService, 'appDockerRestart').resolves();

      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerRestart, 'Frontend_ModernApp');
      sinon.assert.calledWith(dockerService.appDockerRestart, 'Backend_ModernApp');
      sinon.assert.calledTwice(startCallback);
    });
  });

  // appDeleteDataInMountPoint tests removed - they execute actual sudo commands
  // which require proper system access. These should be tested in integration tests.

  describe('integration scenarios', () => {
    it('should handle stopping and restarting the same app', async () => {
      const appname = 'TestApp';
      const stopCallback = sinon.stub();
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({
        name: 'TestApp',
        version: 3,
      });

      sinon.stub(dockerService, 'appDockerStop').resolves();
      sinon.stub(dockerService, 'appDockerRestart').resolves();

      await dockerOperations.appDockerStop(appname, stopCallback, appsMonitored, getSpecs);
      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.calledWith(dockerService.appDockerStop, appname);
      sinon.assert.calledWith(dockerService.appDockerRestart, appname);
      sinon.assert.calledOnce(stopCallback);
      sinon.assert.calledOnce(startCallback);
    });

    it('should handle composed app with multiple components', async () => {
      const appname = 'LargeApp';
      const stopCallback = sinon.stub();
      const startCallback = sinon.stub();
      const appsMonitored = new Map();
      const getSpecs = sinon.stub().resolves({
        name: 'LargeApp',
        version: 4,
        compose: [
          { name: 'Web' },
          { name: 'API' },
          { name: 'DB' },
          { name: 'Cache' },
        ],
      });

      sinon.stub(dockerService, 'appDockerStop').resolves();
      sinon.stub(dockerService, 'appDockerRestart').resolves();

      await dockerOperations.appDockerStop(appname, stopCallback, appsMonitored, getSpecs);

      sinon.assert.callCount(dockerService.appDockerStop, 4);
      sinon.assert.callCount(stopCallback, 4);

      await dockerOperations.appDockerRestart(appname, startCallback, appsMonitored, getSpecs);

      sinon.assert.callCount(dockerService.appDockerRestart, 4);
      sinon.assert.callCount(startCallback, 4);
    });

  });
});
