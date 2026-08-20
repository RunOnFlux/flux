const chai = require('chai');
chai.use(require('chai-as-promised'));

const sinon = require('sinon');
const monitoringOrchestrator = require('../../ZelBack/src/services/appMonitoring/monitoringOrchestrator');
const appInspector = require('../../ZelBack/src/services/appManagement/appInspector');
const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');
const log = require('../../ZelBack/src/lib/log');

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

    it('keeps monitoring the components after one that cannot be named', async () => {
      // Monitoring feeds the CPU throttler, so a component nobody monitors is a
      // component nobody throttles. A null in the middle of a compose used to take
      // every component AFTER it with it, and named the app in the log rather than
      // the component - so the survivors looked like the whole app.
      const apps = [
        {
          name: 'App',
          version: 4,
          compose: [{ name: 'c1' }, null, { name: 'c3' }],
        },
      ];
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await monitoringOrchestrator.startMonitoringOfApps(apps);

      expect(startStub.getCalls().map((call) => call.args[0])).to.deep.equal(['c1_App', 'c3_App']);
    });

    it('monitors nothing under a name a container cannot have', async () => {
      // startAppMonitoring refuses only a FALSY name, and `${component.name}_${app.name}`
      // is never falsy - a nameless component produced `undefined_App`, arming a
      // timer, a store and a sampler against a container that cannot exist, once a
      // minute, with nothing to say it had gone wrong.
      const apps = [
        {
          name: 'App',
          version: 4,
          compose: [{ name: 'c1' }, {}, { name: '' }, { name: 'c3' }],
        },
      ];
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await monitoringOrchestrator.startMonitoringOfApps(apps);

      expect(startStub.getCalls().map((call) => call.args[0])).to.deep.equal(['c1_App', 'c3_App']);
    });

    it('monitors nothing for a composed app with no name of its own', async () => {
      const apps = [{ name: '', version: 4, compose: [{ name: 'c1' }, { name: 'c2' }] }];
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await monitoringOrchestrator.startMonitoringOfApps(apps);

      sinon.assert.notCalled(startStub);
    });

    it('refuses a compose that is not a list, rather than walking it', async () => {
      // for-of takes anything iterable and a STRING is iterable, so a compose of
      // 'nope' walked its four characters and armed four monitors named
      // `undefined_App`. A missing compose threw and was at least logged; this one
      // was silent, which is the worse of the two.
      const apps = [{ name: 'App', version: 4, compose: 'nope' }];
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      const logError = sinon.stub(log, 'error');

      await monitoringOrchestrator.startMonitoringOfApps(apps);

      sinon.assert.notCalled(startStub);
      // Asserted on the reason, not just on nothing being started: the per-component
      // name guard already refuses every character of 'nope', so a test that checks
      // only the call count passes whether the list is rejected as a list or walked
      // one character at a time. The difference is one honest log line against four
      // claiming to skip components that were never there.
      sinon.assert.calledOnce(logError);
      expect(String(logError.firstCall.args[0])).to.include('has no component list');
    });

    it('keeps monitoring the other apps when one app has no compose at all', async () => {
      const apps = [
        { name: 'Broken', version: 4 },
        { name: 'Fine', version: 4, compose: [{ name: 'c1' }] },
      ];
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');

      await monitoringOrchestrator.startMonitoringOfApps(apps);

      sinon.assert.calledOnceWithExactly(startStub, 'c1_Fine');
    });

    it('keeps monitoring the components after one that throws', async () => {
      const apps = [
        { name: 'App', version: 4, compose: [{ name: 'c1' }, { name: 'c2' }, { name: 'c3' }] },
      ];
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      startStub.withArgs('c2_App').throws(new Error('cannot arm'));

      await monitoringOrchestrator.startMonitoringOfApps(apps);

      expect(startStub.getCalls().map((call) => call.args[0])).to.deep.equal(['c1_App', 'c2_App', 'c3_App']);
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

    // The existing test above makes startAppMonitoring throw, which the catch
    // handles cleanly. These are the cases where the CATCH ITSELF is what breaks:
    // it labelled the log by reading a property off the value that had just
    // failed, and a throw raised inside a catch is not caught by that catch. The
    // loop was abandoned and every remaining app went unmonitored - and
    // unthrottled - with nothing logged at all.
    it('keeps monitoring the rest when an entry is not an app', async () => {
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(log, 'error');

      await monitoringOrchestrator.startMonitoringOfApps([
        { name: 'App1', version: 3 },
        null,
        { name: 'App3', version: 3 },
      ]);

      sinon.assert.calledWith(startStub, 'App1');
      sinon.assert.calledWith(startStub, 'App3');
    });

    it('logs the failure rather than being defeated by it', async () => {
      sinon.stub(appInspector, 'startAppMonitoring');
      const logError = sinon.stub(log, 'error');

      await monitoringOrchestrator.startMonitoringOfApps([null]);

      sinon.assert.called(logError);
    });

    it('keeps monitoring the later components when one has a name that throws', async () => {
      const startStub = sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(log, 'error');
      const exploding = { get name() { throw new Error('nameboom'); } };

      await monitoringOrchestrator.startMonitoringOfApps([
        { name: 'App1', version: 4, compose: [exploding, { name: 'c2' }] },
      ]);

      sinon.assert.calledWith(startStub, 'c2_App1');
    });

    it('refuses a specification list that is not a list, rather than walking it', async () => {
      sinon.stub(appInspector, 'startAppMonitoring');

      // for-of accepts any iterable, so a string was walked character by
      // character and every character treated as an app.
      await expect(monitoringOrchestrator.startMonitoringOfApps('nope'))
        .to.be.rejectedWith('must be an array');
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
