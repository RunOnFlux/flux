const chai = require('chai');
chai.use(require('chai-as-promised'));

const sinon = require('sinon');
const monitoringOrchestrator = require('../../ZelBack/src/services/appMonitoring/monitoringOrchestrator');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const appInspector = require('../../ZelBack/src/services/appManagement/appInspector');
const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');

const { expect } = chai;

describe('monitoringOrchestrator tests', () => {
  let req;
  let res;
  let installedAppsStub;

  beforeEach(() => {
    req = {
      params: {},
      query: {},
      headers: {},
    };
    res = {
      json: sinon.stub().callsFake((msg) => msg),
      status: sinon.stub().returnsThis(),
      write: sinon.stub(),
      end: sinon.stub(),
      flush: sinon.stub(),
    };
    installedAppsStub = sinon.stub(appQueryService, 'installedApps');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('startMonitoringOfApps tests', () => {
    it('should start monitoring for v1-v3 apps', async () => {
      const apps = [
        { name: 'App1', version: 1 },
        { name: 'App2', version: 2 },
        { name: 'App3', version: 3 },
      ];

      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await monitoringOrchestrator.startMonitoringOfApps(apps);

      sinon.assert.calledThrice(startStub);
      sinon.assert.calledWith(startStub, 'App1');
      sinon.assert.calledWith(startStub, 'App2');
      sinon.assert.calledWith(startStub, 'App3');
    });

    it('should start monitoring for compose apps (v4+)', async () => {
      const apps = [
        {
          name: 'ComposedApp',
          version: 4,
          compose: [
            { name: 'Component1' },
            { name: 'Component2' },
          ],
        },
      ];

      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await monitoringOrchestrator.startMonitoringOfApps(apps);

      sinon.assert.calledTwice(startStub);
      sinon.assert.calledWith(startStub, 'Component1_ComposedApp');
      sinon.assert.calledWith(startStub, 'Component2_ComposedApp');
    });

    it('should get installed apps if no apps provided', async () => {
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'App1', version: 3 }] });
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await monitoringOrchestrator.startMonitoringOfApps(null);

      sinon.assert.calledOnce(installedAppsStub);
      sinon.assert.calledOnceWithExactly(startStub, 'App1');
    });

    it('should throw if the installed apps lookup fails', async () => {
      installedAppsStub.resolves({ status: 'error', data: { message: 'Failed' } });
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await expect(monitoringOrchestrator.startMonitoringOfApps(null))
        .to.eventually.be.rejectedWith('Failed to get installed Apps');

      sinon.assert.notCalled(startStub);
    });

    it('should handle mixed app versions', async () => {
      const apps = [
        { name: 'App1', version: 2 },
        {
          name: 'App2',
          version: 4,
          compose: [
            { name: 'Comp1' },
          ],
        },
      ];

      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await monitoringOrchestrator.startMonitoringOfApps(apps);

      sinon.assert.calledTwice(startStub);
      sinon.assert.calledWith(startStub, 'App1');
      sinon.assert.calledWith(startStub, 'Comp1_App2');
    });

    it('should keep monitoring the rest when one app fails', async () => {
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      startStub.withArgs('App1').throws(new Error('Monitor error'));

      await monitoringOrchestrator.startMonitoringOfApps([
        { name: 'App1', version: 3 },
        { name: 'App2', version: 3 },
      ]);

      sinon.assert.calledWith(startStub, 'App2');
    });
  });

  describe('stopMonitoringOfApps tests', () => {
    it('should stop monitoring for v1-v3 apps', async () => {
      const apps = [
        { name: 'App1', version: 1 },
        { name: 'App2', version: 3 },
      ];

      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.stopMonitoringOfApps(apps, false);

      sinon.assert.calledTwice(stopStub);
      sinon.assert.calledWith(stopStub, 'App1', false);
      sinon.assert.calledWith(stopStub, 'App2', false);
    });

    it('should stop monitoring for compose apps', async () => {
      const apps = [
        {
          name: 'ComposedApp',
          version: 4,
          compose: [
            { name: 'Component1' },
            { name: 'Component2' },
          ],
        },
      ];

      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.stopMonitoringOfApps(apps, false);

      sinon.assert.calledTwice(stopStub);
      sinon.assert.calledWith(stopStub, 'Component1_ComposedApp', false);
      sinon.assert.calledWith(stopStub, 'Component2_ComposedApp', false);
    });

    it('should delete data when deleteData is true', async () => {
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.stopMonitoringOfApps([{ name: 'App1', version: 3 }], true);

      sinon.assert.calledWith(stopStub, 'App1', true);
    });

    it('should get installed apps if no apps provided', async () => {
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'App1', version: 3 }] });
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.stopMonitoringOfApps(null, false);

      sinon.assert.calledOnce(installedAppsStub);
      sinon.assert.calledOnceWithExactly(stopStub, 'App1', false);
    });

    it('should throw if the installed apps lookup fails', async () => {
      installedAppsStub.resolves({ status: 'error', data: { message: 'Failed' } });
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await expect(monitoringOrchestrator.stopMonitoringOfApps(null, false))
        .to.eventually.be.rejectedWith('Failed to get installed Apps');

      sinon.assert.notCalled(stopStub);
    });

    it('should keep stopping the rest when one app fails', async () => {
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');
      stopStub.withArgs('App1').throws(new Error('Monitor error'));

      await monitoringOrchestrator.stopMonitoringOfApps([
        { name: 'App1', version: 3 },
        { name: 'App2', version: 3 },
      ], false);

      sinon.assert.calledWith(stopStub, 'App2');
    });
  });

  describe('startMonitoring tests', () => {
    it('should restart monitoring of every app when no appname given', async () => {
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'App1', version: 3 }] });
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      const message = await monitoringOrchestrator.startMonitoring();

      expect(message).to.equal('Application monitoring started for all apps');
      sinon.assert.calledWith(stopStub, 'App1', false);
      sinon.assert.calledWith(startStub, 'App1');
    });

    it('should start monitoring for a named app', async () => {
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'TestApp', version: 3 }] });
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');

      const message = await monitoringOrchestrator.startMonitoring('TestApp');

      expect(message).to.equal('Application monitoring started for TestApp');
      sinon.assert.calledWith(installedAppsStub, 'TestApp');
      sinon.assert.calledWith(startStub, 'TestApp');
    });

    it('should start monitoring a single component without touching siblings', async () => {
      installedAppsStub.resolves({
        status: 'success',
        data: [{ name: 'TestApp', version: 4, compose: [{ name: 'Component1' }] }],
      });
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.startMonitoring('Component1_TestApp');

      sinon.assert.calledOnceWithExactly(stopStub, 'Component1_TestApp', false);
      sinon.assert.calledOnceWithExactly(startStub, 'Component1_TestApp');
    });

    it('should throw if the app is not installed', async () => {
      installedAppsStub.resolves({ status: 'success', data: [] });

      await expect(monitoringOrchestrator.startMonitoring('NonExistentApp'))
        .to.eventually.be.rejectedWith('Application NonExistentApp is not installed');
    });

    it('should throw if the installed apps lookup fails', async () => {
      installedAppsStub.resolves({ status: 'error', data: { message: 'Failed' } });

      await expect(monitoringOrchestrator.startMonitoring('TestApp'))
        .to.eventually.be.rejectedWith('Failed to get installed Apps');
    });
  });

  describe('stopMonitoring tests', () => {
    it('should report retained data when stopping every app', async () => {
      installedAppsStub.resolves({ status: 'success', data: [] });

      const message = await monitoringOrchestrator.stopMonitoring(undefined, false);

      expect(message).to.equal('Application monitoring stopped for all apps. Existing monitoring data maintained.');
    });

    it('should report deleted data when stopping every app', async () => {
      installedAppsStub.resolves({ status: 'success', data: [] });

      const message = await monitoringOrchestrator.stopMonitoring(undefined, true);

      expect(message).to.equal('Application monitoring stopped for all apps. Monitoring data deleted for all apps.');
    });

    it('should stop monitoring for a named app', async () => {
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'TestApp', version: 3 }] });
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      const message = await monitoringOrchestrator.stopMonitoring('TestApp', false);

      expect(message).to.equal('Application monitoring stopped for TestApp. Existing monitoring data maintained.');
      sinon.assert.calledWith(stopStub, 'TestApp', false);
    });

    it('should stop monitoring a single component', async () => {
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.stopMonitoring('Component1_TestApp', false);

      sinon.assert.calledOnceWithExactly(stopStub, 'Component1_TestApp', false);
      sinon.assert.notCalled(installedAppsStub);
    });

    it('should pass deleteData through for a component', async () => {
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      const message = await monitoringOrchestrator.stopMonitoring('Component1_TestApp', true);

      expect(message).to.equal('Application monitoring stopped and monitoring data deleted for Component1_TestApp.');
      sinon.assert.calledOnceWithExactly(stopStub, 'Component1_TestApp', true);
    });
  });

  describe('startAppMonitoringAPI tests', () => {
    it('should return unauthorized if no appname and not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      sinon.stub(messageHelper, 'errUnauthorizedMessage').returns({
        status: 'error',
        data: { code: 401, message: 'Unauthorized' },
      });

      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, res);

      expect(result.status).to.equal('error');
    });

    it('should reserve monitoring every app for the flux team', async () => {
      const verifyStub = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [] });
      sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.startAppMonitoringAPI(req, res);

      sinon.assert.calledWith(verifyStub, 'fluxteam', req);
      sinon.assert.neverCalledWith(verifyStub, 'adminandfluxteam', req);
    });

    it('should report an error when monitoring every app could not be started', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'error', data: { message: 'Failed' } });
      const successStub = sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error', data: {} });

      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, res);

      expect(result.status).to.equal('error');
      sinon.assert.notCalled(successStub);
    });

    it('should verify appownerabove privilege for a specific app', async () => {
      req.params = { appname: 'TestApp' };
      const verifyStub = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'TestApp', version: 3 }] });
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.startAppMonitoringAPI(req, res);

      sinon.assert.calledWith(verifyStub, 'appownerabove', req, 'TestApp');
    });

    it('should scope authorization to the parent app for a component', async () => {
      req.params = { appname: 'Component1_TestApp' };
      const verifyStub = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({
        status: 'success',
        data: [{ name: 'TestApp', version: 4, compose: [{ name: 'Component1' }] }],
      });
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.startAppMonitoringAPI(req, res);

      sinon.assert.calledWith(verifyStub, 'appownerabove', req, 'TestApp');
    });

    it('should take appname from the query string', async () => {
      req.query = { appname: 'TestApp' };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'TestApp', version: 3 }] });
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');
      const successStub = sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.startAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(successStub, 'Application monitoring started for TestApp');
    });

    it('should return error if app not installed', async () => {
      req.params = { appname: 'NonExistentApp' };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [] });
      sinon.stub(messageHelper, 'createErrorMessage').returns({
        status: 'error',
        data: { message: 'Application NonExistentApp is not installed' },
      });

      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, res);

      expect(result.status).to.equal('error');
    });

    it('should return error if failed to get installed apps', async () => {
      req.params = { appname: 'TestApp' };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'error', data: { message: 'Failed' } });
      sinon.stub(messageHelper, 'createErrorMessage').returns({
        status: 'error',
        data: { message: 'Failed to get installed Apps' },
      });

      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, res);

      expect(result.status).to.equal('error');
    });

    it('should work without res object', async () => {
      req.params = { appname: 'TestApp' };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'TestApp', version: 3 }] });
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Started' },
      });

      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, null);

      expect(result.status).to.equal('success');
    });
  });

  describe('stopAppMonitoringAPI tests', () => {
    it('should return unauthorized if no appname and not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      sinon.stub(messageHelper, 'errUnauthorizedMessage').returns({
        status: 'error',
        data: { code: 401, message: 'Unauthorized' },
      });

      const result = await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      expect(result.status).to.equal('error');
    });

    it('should reserve stopping every app for the flux team', async () => {
      const verifyStub = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [] });
      sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      sinon.assert.calledWith(verifyStub, 'fluxteam', req);
      sinon.assert.neverCalledWith(verifyStub, 'adminandfluxteam', req);
    });

    it('should still allow an app owner to stop monitoring their own app', async () => {
      req.params = { appname: 'TestApp' };
      const verifyStub = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'TestApp', version: 3 }] });
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      sinon.assert.calledWith(verifyStub, 'appownerabove', req, 'TestApp');
    });

    it('should include correct message when deletedata is false', async () => {
      req.query = { deletedata: false };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [] });
      const successStub = sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      sinon.assert.calledWith(successStub, 'Application monitoring stopped for all apps. Existing monitoring data maintained.');
    });

    it('should include correct message when deletedata is true', async () => {
      req.query = { deletedata: true };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [] });
      const successStub = sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      sinon.assert.calledWith(successStub, 'Application monitoring stopped for all apps. Monitoring data deleted for all apps.');
    });

    it('should stop monitoring for specific app', async () => {
      req.params = { appname: 'TestApp' };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'TestApp', version: 3 }] });
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      sinon.assert.calledWith(stopStub, 'TestApp', false);
    });

    it('should handle component-based monitoring stop', async () => {
      req.params = { appname: 'Component1_TestApp' };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(stopStub, 'Component1_TestApp', false);
    });

    it('should pass deletedata parameter correctly', async () => {
      req.params = { appname: 'Component1_TestApp', deletedata: 'true' };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returnsArg(0);

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(stopStub, 'Component1_TestApp', true);
    });

    it('should work without res object', async () => {
      req.params = { appname: 'TestApp' };
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      installedAppsStub.resolves({ status: 'success', data: [{ name: 'TestApp', version: 3 }] });
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Stopped' },
      });

      const result = await monitoringOrchestrator.stopAppMonitoringAPI(req, null);

      expect(result.status).to.equal('success');
    });

    it('should handle errors and return error message', async () => {
      req.params = { appname: 'TestApp' };
      sinon.stub(verificationHelper, 'verifyPrivilege').rejects(new Error('Verification failed'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({
        status: 'error',
        data: { message: 'Verification failed' },
      });

      const result = await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      expect(result.status).to.equal('error');
    });
  });
});
