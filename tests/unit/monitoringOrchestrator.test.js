const chai = require('chai');
chai.use(require('chai-as-promised'));

const sinon = require('sinon');
const monitoringOrchestrator = require('../../ZelBack/src/services/appMonitoring/monitoringOrchestrator');
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

  // The control was removed: the node monitors every app for the CPU throttling loop,
  // so there is nothing for a caller to turn on or off. The routes answer with an error
  // rather than a success, because a caller told 'success' would believe monitoring had
  // been stopped when it is still running.
  describe('deprecated monitoring control', () => {
    it('should refuse to start monitoring and say why', async () => {
      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, res);

      expect(result.status).to.equal('error');
      expect(result.data.name).to.equal('Deprecated');
      expect(result.data.message).to.match(/managed by the node/);
    });

    it('should refuse to stop monitoring and say why', async () => {
      req.params = { appname: 'TestApp' };

      const result = await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      expect(result.status).to.equal('error');
      expect(result.data.name).to.equal('Deprecated');
    });

    it('should not touch monitoring for a named app', async () => {
      req.params = { appname: 'TestApp' };
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      const stopStub = sinon.stub(appInspector, 'stopAppMonitoring');

      await monitoringOrchestrator.startAppMonitoringAPI(req, res);
      await monitoringOrchestrator.stopAppMonitoringAPI(req, res);

      sinon.assert.notCalled(startStub);
      sinon.assert.notCalled(stopStub);
      sinon.assert.notCalled(installedAppsStub);
    });

    it('should answer without a res object', async () => {
      const result = await monitoringOrchestrator.startAppMonitoringAPI(req, null);

      expect(result.status).to.equal('error');
    });

    it('should no longer expose the control functions', () => {
      expect(monitoringOrchestrator.startMonitoring).to.be.undefined;
      expect(monitoringOrchestrator.stopMonitoring).to.be.undefined;
    });
  });
});
