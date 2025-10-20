const { expect } = require('chai');
const sinon = require('sinon');
const monitoringOrchestrator = require('../../ZelBack/src/services/appMonitoring/monitoringOrchestrator');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const appInspector = require('../../ZelBack/src/services/appManagement/appInspector');

describe('monitoringOrchestrator tests', () => {
  let req;
  let res;
  let mockAppsMonitored;
  let mockInstalledAppsFn;

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
    mockAppsMonitored = {};
    mockInstalledAppsFn = sinon.stub();
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

      await monitoringOrchestrator.startMonitoringOfApps(apps, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledThrice(startStub);
      sinon.assert.calledWith(startStub, 'App1', mockAppsMonitored);
      sinon.assert.calledWith(startStub, 'App2', mockAppsMonitored);
      sinon.assert.calledWith(startStub, 'App3', mockAppsMonitored);
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

      await monitoringOrchestrator.startMonitoringOfApps(apps, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledTwice(startStub);
      sinon.assert.calledWith(startStub, 'Component1_ComposedApp', mockAppsMonitored);
      sinon.assert.calledWith(startStub, 'Component2_ComposedApp', mockAppsMonitored);
    });

    it('should get installed apps if no apps provided', async () => {
      const apps = [
        { name: 'App1', version: 3 },
      ];

      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await monitoringOrchestrator.startMonitoringOfApps(null, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledOnce(mockInstalledAppsFn);
      sinon.assert.calledOnce(startStub);
    });

    it('should handle error if failed to get installed apps', async () => {
      mockInstalledAppsFn.resolves({ status: 'error', data: { message: 'Failed' } });

      await monitoringOrchestrator.startMonitoringOfApps(null, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledOnce(mockInstalledAppsFn);
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

      await monitoringOrchestrator.startMonitoringOfApps(apps, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledTwice(startStub);
      sinon.assert.calledWith(startStub, 'App1', mockAppsMonitored);
      sinon.assert.calledWith(startStub, 'Comp1_App2', mockAppsMonitored);
    });

    it('should handle errors gracefully', async () => {
      sinon.stub(appInspector, 'startAppMonitoring').throws(new Error('Monitor error'));

      const apps = [{ name: 'App1', version: 3 }];

      await monitoringOrchestrator.startMonitoringOfApps(apps, mockAppsMonitored, mockInstalledAppsFn);

      // Should not throw, error is logged
    });
  });

  describe('stopMonitoringOfApps tests', () => {
    it('should stop monitoring for v1-v3 apps', async () => {
      const apps = [
        { name: 'App1', version: 1 },
        { name: 'App2', version: 3 },
      ];

      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.stopMonitoringOfApps(apps, false, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledTwice(stopStub);
      sinon.assert.calledWith(stopStub, 'App1', false, mockAppsMonitored);
      sinon.assert.calledWith(stopStub, 'App2', false, mockAppsMonitored);
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

      await monitoringOrchestrator.stopMonitoringOfApps(apps, false, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledTwice(stopStub);
      sinon.assert.calledWith(stopStub, 'Component1_ComposedApp', false, mockAppsMonitored);
      sinon.assert.calledWith(stopStub, 'Component2_ComposedApp', false, mockAppsMonitored);
    });

    it('should delete data when deleteData is true', async () => {
      const apps = [
        { name: 'App1', version: 3 },
      ];

      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.stopMonitoringOfApps(apps, true, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledWith(stopStub, 'App1', true, mockAppsMonitored);
    });

    it('should get installed apps if no apps provided', async () => {
      const apps = [
        { name: 'App1', version: 3 },
      ];

      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.stopMonitoringOfApps(null, false, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledOnce(mockInstalledAppsFn);
      sinon.assert.calledOnce(stopStub);
    });

    it('should handle error if failed to get installed apps', async () => {
      mockInstalledAppsFn.resolves({ status: 'error', data: { message: 'Failed' } });

      await monitoringOrchestrator.stopMonitoringOfApps(null, false, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledOnce(mockInstalledAppsFn);
    });

    it('should handle errors gracefully', async () => {
      sinon.stub(appInspector, 'stopAppMonitoring').throws(new Error('Monitor error'));

      const apps = [{ name: 'App1', version: 3 }];

      await monitoringOrchestrator.stopMonitoringOfApps(apps, false, mockAppsMonitored, mockInstalledAppsFn);

      // Should not throw, error is logged
    });
  });

  describe('startAppMonitoringAPI tests', () => {
    it('should return unauthorized if no appname and not authorized', async () => {
      req.params = {};
      req.query = {};

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      sinon.stub(messageHelper, 'errUnauthorizedMessage').returns({
        status: 'error',
        data: { code: 401, message: 'Unauthorized' },
      });

      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      expect(result.status).to.equal('error');
    });

    it('should start monitoring for all apps when no appname and authorized', async () => {
      req.params = {};
      req.query = {};

      const apps = [
        { name: 'App1', version: 3 },
        { name: 'App2', version: 3 },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Application monitoring started for all apps' },
      });

      await monitoringOrchestrator.startAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledOnce(res.json);
    });

    it('should verify adminandfluxteam privilege for all apps', async () => {
      req.params = {};
      req.query = {};

      const verifyStub = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Started' },
      });

      await monitoringOrchestrator.startAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledWith(verifyStub, 'adminandfluxteam', req);
    });

    it('should start monitoring for specific app when appname in params', async () => {
      req.params = { appname: 'TestApp' };

      const apps = [
        { name: 'TestApp', version: 3 },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Application monitoring started for TestApp' },
      });

      await monitoringOrchestrator.startAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledOnce(res.json);
    });

    it('should start monitoring for specific app when appname in query', async () => {
      req.query = { appname: 'TestApp' };

      const apps = [
        { name: 'TestApp', version: 3 },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Started' },
      });

      await monitoringOrchestrator.startAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledOnce(res.json);
    });

    it('should verify appownerabove privilege for specific app', async () => {
      req.params = { appname: 'TestApp' };

      const apps = [
        { name: 'TestApp', version: 3 },
      ];

      const verifyStub = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Started' },
      });

      await monitoringOrchestrator.startAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledWith(verifyStub, 'appownerabove', req, 'TestApp');
    });

    it('should handle component-based monitoring (app_component format)', async () => {
      req.params = { appname: 'Component1_TestApp' };

      const apps = [
        {
          name: 'TestApp',
          version: 4,
          compose: [{ name: 'Component1' }],
        },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Started' },
      });

      await monitoringOrchestrator.startAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledWith(stopStub, 'Component1_TestApp', false, mockAppsMonitored);
      sinon.assert.calledWith(startStub, 'Component1_TestApp', mockAppsMonitored);
    });

    it('should return error if app not installed', async () => {
      req.params = { appname: 'NonExistentApp' };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      sinon.stub(messageHelper, 'createErrorMessage').returns({
        status: 'error',
        data: { message: 'Application NonExistentApp is not installed' },
      });

      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      expect(result.status).to.equal('error');
    });

    it('should return error if failed to get installed apps', async () => {
      req.params = { appname: 'TestApp' };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'error', data: { message: 'Failed' } });
      sinon.stub(messageHelper, 'createErrorMessage').returns({
        status: 'error',
        data: { message: 'Failed to get installed Apps' },
      });

      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      expect(result.status).to.equal('error');
    });

    it('should work without res object', async () => {
      req.params = { appname: 'TestApp' };

      const apps = [
        { name: 'TestApp', version: 3 },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Started' },
      });

      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, null, mockAppsMonitored, mockInstalledAppsFn);

      expect(result.status).to.equal('success');
    });
  });

  describe('stopAppMonitoringAPI tests', () => {
    it('should return unauthorized if no appname and not authorized', async () => {
      req.params = {};
      req.query = {};

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      sinon.stub(messageHelper, 'errUnauthorizedMessage').returns({
        status: 'error',
        data: { code: 401, message: 'Unauthorized' },
      });

      const result = await monitoringOrchestrator.stopAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      expect(result.status).to.equal('error');
    });

    it('should stop monitoring for all apps when no appname and authorized', async () => {
      req.params = {};
      req.query = {};

      const apps = [
        { name: 'App1', version: 3 },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Application monitoring stopped for all apps' },
      });

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledOnce(res.json);
    });

    it('should include correct message when deletedata is false', async () => {
      req.params = {};
      req.query = { deletedata: false };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      sinon.stub(serviceHelper, 'ensureBoolean').returns(false);
      const createSuccessStub = sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Application monitoring stopped for all apps. Existing monitoring data maintained.' },
      });

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledWith(createSuccessStub, 'Application monitoring stopped for all apps. Existing monitoring data maintained.');
    });

    it('should include correct message when deletedata is true', async () => {
      req.params = {};
      req.query = { deletedata: true };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: [] });
      sinon.stub(serviceHelper, 'ensureBoolean').returns(true);
      const createSuccessStub = sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Application monitoring stopped for all apps. Monitoring data deleted for all apps.' },
      });

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledWith(createSuccessStub, 'Application monitoring stopped for all apps. Monitoring data deleted for all apps.');
    });

    it('should stop monitoring for specific app', async () => {
      req.params = { appname: 'TestApp' };

      const apps = [
        { name: 'TestApp', version: 3 },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(serviceHelper, 'ensureBoolean').returns(false);
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Stopped' },
      });

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledOnce(res.json);
    });

    it('should handle component-based monitoring stop', async () => {
      req.params = { appname: 'Component1_TestApp' };

      const apps = [
        {
          name: 'TestApp',
          version: 4,
          compose: [{ name: 'Component1' }],
        },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(serviceHelper, 'ensureBoolean').returns(false);
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Stopped' },
      });

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledWith(stopStub, 'Component1_TestApp', false, mockAppsMonitored);
    });

    it('should pass deletedata parameter correctly', async () => {
      req.params = { appname: 'Component1_TestApp', deletedata: 'true' };

      const apps = [
        { name: 'TestApp', version: 4, compose: [{ name: 'Component1' }] },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(serviceHelper, 'ensureBoolean').returns(true);
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Stopped' },
      });

      await monitoringOrchestrator.stopAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      sinon.assert.calledWith(stopStub, 'Component1_TestApp', true, mockAppsMonitored);
    });

    it('should work without res object', async () => {
      req.params = { appname: 'TestApp' };

      const apps = [
        { name: 'TestApp', version: 3 },
      ];

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(appInspector, 'stopAppMonitoring');
      sinon.stub(serviceHelper, 'ensureBoolean').returns(false);
      sinon.stub(messageHelper, 'createSuccessMessage').returns({
        status: 'success',
        data: { message: 'Stopped' },
      });

      const result = await monitoringOrchestrator.stopAppMonitoringAPI(req, null, mockAppsMonitored, mockInstalledAppsFn);

      expect(result.status).to.equal('success');
    });

    it('should handle errors and return error message', async () => {
      req.params = { appname: 'TestApp' };

      sinon.stub(verificationHelper, 'verifyPrivilege').rejects(new Error('Verification failed'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({
        status: 'error',
        data: { message: 'Verification failed' },
      });

      const result = await monitoringOrchestrator.stopAppMonitoringAPI(req, res, mockAppsMonitored, mockInstalledAppsFn);

      expect(result.status).to.equal('error');
    });
  });

  describe('appMonitor tests', () => {
    it('should delegate to appInspector.appMonitor', async () => {
      const monitorStub = sinon.stub(appInspector, 'appMonitor').resolves({
        status: 'success',
        data: { monitoring: 'data' },
      });

      await monitoringOrchestrator.appMonitor(req, res, mockAppsMonitored);

      sinon.assert.calledOnce(monitorStub);
      sinon.assert.calledWith(monitorStub, req, res, mockAppsMonitored);
    });

    it('should return result from appInspector', async () => {
      const expectedResult = {
        status: 'success',
        data: { monitoring: 'data' },
      };
      sinon.stub(appInspector, 'appMonitor').resolves(expectedResult);

      const result = await monitoringOrchestrator.appMonitor(req, res, mockAppsMonitored);

      expect(result).to.deep.equal(expectedResult);
    });
  });
});
