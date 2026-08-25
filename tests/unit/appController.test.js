const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const appController = require('../../ZelBack/src/services/appManagement/appController');
const dockerService = require('../../ZelBack/src/services/dockerService');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const appInspector = require('../../ZelBack/src/services/appManagement/appInspector');
const appsRuntimeState = require('../../ZelBack/src/services/appManagement/appsRuntimeState');
const appReconciler = require('../../ZelBack/src/services/appMonitoring/appReconciler');
const globalState = require('../../ZelBack/src/services/utils/globalState');
const bootGateAtStart = globalState.bootContainerStateSettled;
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');
const { requireMongo } = require('./dbTestHelper');

describe('appController tests', () => {
  before(requireMongo);

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
    // globalState is a shared module, so a test that opens the boot gate leaves
    // it open for every test after it in this process - including files mocha
    // runs later. Restored explicitly; sinon does not own it.
    globalState.bootContainerStateSettled = bootGateAtStart;
  });

  describe('appStart tests', () => {
    beforeEach(() => {
      sinon.stub(dockerService, 'appDockerStart').resolves('Flux App TestApp successfully started.');
      sinon.stub(appInspector, 'startAppMonitoring');
      sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
      // Runs the caller's mutate so the intent write stays observable, and
      // reports the pass as run so the outcome below is the probe's answer
      // rather than "no reconcile yet".
      sinon.stub(appReconciler, 'applyIntent').callsFake(async (id, mutate) => {
        await mutate();
        return true;
      });
      sinon.stub(appReconciler, 'dockerActual').resolves({ reachable: true, running: true });
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
      expect(result.data).to.equal('Application TestApp started');
      // The handler no longer drives the container: whether it may run is the
      // election's decision, and the reconciler is the one that consults it.
      sinon.assert.notCalled(dockerService.appDockerStart);
      sinon.assert.calledWith(appsRuntimeState.setOperatorStopped, 'TestApp', false);
      // startAppMonitoring wipes statsStore, so a second caller alongside the
      // reconciler's own call would discard the series the charts read.
      sinon.assert.notCalled(appInspector.startAppMonitoring);
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
      sinon.assert.notCalled(dockerService.appDockerStart);
      sinon.assert.calledWith(appsRuntimeState.setOperatorStopped, 'Component_TestApp', false);
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
      sinon.assert.notCalled(dockerService.appDockerStart);
      // Every component gets the intent, not just the first - a composed app
      // half-started is the failure this covers.
      sinon.assert.calledWith(appsRuntimeState.setOperatorStopped, 'Component1_ComposedApp', false);
      sinon.assert.calledWith(appsRuntimeState.setOperatorStopped, 'Component2_ComposedApp', false);
      // Forward, and pinned: a start is the direction a stop is the reverse OF, so
      // reversing both would satisfy the stop test and still be wrong here.
      expect(appsRuntimeState.setOperatorStopped.firstCall.args[0]).to.equal('Component1_ComposedApp');
      expect(appsRuntimeState.setOperatorStopped.secondCall.args[0]).to.equal('Component2_ComposedApp');
    });

    it('should report the election, not a start, for a component held by its decider', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'TestApp',
        version: 3,
      });
      appReconciler.dockerActual.resolves({ reachable: true, running: false });
      sinon.stub(appReconciler, 'desiredRunState').resolves({ desired: null, reason: 'awaitingController' });

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStart(req, res);

      const result = res.json.firstCall.args[0];
      // A synced component runs on the node the election made the writer, so
      // "not started here" is the correct outcome - and saying which of the two
      // it is stops an operator retrying against a decision that already holds.
      expect(result.data).to.equal('Application TestApp will be started: waiting for the election');
    });

    it('should report an unreachable docker rather than claiming a start', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'TestApp',
        version: 3,
      });
      appReconciler.dockerActual.resolves({ reachable: false, running: false });

      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.fake((param) => param),
      };

      await appController.appStart(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.data).to.equal('Application TestApp will be started: docker is not reachable');
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
      // The handler no longer drives the container. Two writers to one container
      // is what let an operator stop interleave with a reconcile pass.
      sinon.assert.notCalled(dockerService.appDockerStop);
      // Monitoring goes with the container, so the reconciler turns it off when
      // it stops one. Stopping it here turned the sampler off for a container
      // the stop had not reached.
      sinon.assert.notCalled(appInspector.stopAppMonitoring);
    });

    it('should stop all components for version 4+ apps in reverse order', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
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
      sinon.assert.notCalled(dockerService.appDockerStop);
      // Every component gets the intent, not just the first - a composed app
      // half-stopped is the failure this covers.
      sinon.assert.calledWith(appsRuntimeState.setOperatorStopped, 'Component1_ComposedApp', true);
      sinon.assert.calledWith(appsRuntimeState.setOperatorStopped, 'Component2_ComposedApp', true);
      // And in reverse, which is the half calledWith cannot see - it holds whether
      // the components are addressed forwards or backwards. The call index is the
      // only thing that pins the order this test is named for.
      expect(appsRuntimeState.setOperatorStopped.firstCall.args[0]).to.equal('Component2_ComposedApp');
      expect(appsRuntimeState.setOperatorStopped.secondCall.args[0]).to.equal('Component1_ComposedApp');
    });

    it('should handle component stop', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();

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
      sinon.assert.notCalled(dockerService.appDockerStop);
      sinon.assert.calledWith(appsRuntimeState.setOperatorStopped, 'Component_TestApp', true);
    });

    it('reports pending, not failure, when docker cannot be reached', async () => {
      // The old direct call threw here - AFTER the lock had been written - so an
      // operator was told their stop failed while it was durable and would apply
      // the moment docker returned. They retry against an app that is already
      // stopping. Pending is the true answer.
      verificationHelperStub.resolves(true);
      sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
      // The boot gate holds every enqueue until daemon/DB are ready, and a
      // handler that never got a pass reports pending for that reason instead.
      globalState.bootContainerStateSettled = true;
      sinon.stub(appReconciler, 'dockerActual').resolves({ reachable: false, running: false });

      const req = { params: { appname: 'Component_TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appStop(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      expect(result.data).to.contain('will be stopped');
      expect(result.data).to.contain('docker is not reachable');
    });

    it('reports stopped only once the container is actually down', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
      globalState.bootContainerStateSettled = true;
      sinon.stub(appReconciler, 'dockerActual').resolves({ reachable: true, running: false });

      const req = { params: { appname: 'Component_TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appStop(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.data).to.equal('Application Component_TestApp stopped');
    });

    it('writes the intent and leaves the container to the reconciler', async () => {
      // This replaces an ordering assertion - lock before docker stop - whose
      // premise was that the handler stops the container. It does not: the
      // reconciler is the only actuator, so there is no second operation for the
      // lock to be ordered against, and a crash after the write leaves an intent
      // that converges rather than a stopped container that gets restarted.
      verificationHelperStub.resolves(true);
      const setOperatorStopped = sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();

      const req = { params: { appname: 'Component_TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appStop(req, res);

      sinon.assert.calledOnceWithExactly(setOperatorStopped, 'Component_TestApp', true, { force: false });
      sinon.assert.notCalled(dockerService.appDockerStop);
    });

    it('retracts the controller desire so a released lock cannot restart it behind the election', async () => {
      // The lock only suppresses the reconciler while it is held. A g: component
      // carries a controller desire of "running" from the masterSlave primary
      // start; left standing, it is reconciled against the stopped container once
      // the lock lifts and restarts it without an election pass, beside whichever
      // peer took over.
      verificationHelperStub.resolves(true);
      sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
      const clearControllerDesired = sinon.stub(appReconciler, 'clearControllerDesired');

      const req = { params: { appname: 'Component_TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appStop(req, res);

      sinon.assert.calledOnceWithExactly(clearControllerDesired, 'Component_TestApp');
    });

    it('leaves the controller desire alone when the operator STARTS a component', async () => {
      // Only a stop overrides the controller. Clearing on start too would be
      // indistinguishable here but wrong in meaning: start hands the decision back
      // to the decider, it does not express one.
      verificationHelperStub.resolves(true);
      sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
      const clearControllerDesired = sinon.stub(appReconciler, 'clearControllerDesired');

      const req = { params: { appname: 'Component_TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appStart(req, res);

      sinon.assert.notCalled(clearControllerDesired);
    });
  });

  describe('operator intent event', () => {
    let publishStub;

    beforeEach(() => {
      publishStub = sinon.stub(fluxEventBus, 'publish');
      sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
      sinon.stub(appsRuntimeState, 'requestRestart').resolves();
      sinon.stub(appReconciler, 'dockerActual').resolves({ reachable: true, running: false });
    });

    const intents = () => publishStub.getCalls()
      .filter((c) => c.args[0] === 'app:operatorIntent')
      .map((c) => c.args[1]);

    it('announces a stop, with the mode it was asked for', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(appReconciler, 'applyIntent').callsFake(async (id, mutate) => {
        await mutate();
        return true;
      });

      const req = { params: { appname: 'Component_TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appStop(req, res);

      expect(intents()).to.deep.equal([{
        identifier: 'Component_TestApp', stopped: true, force: false, restartRequested: false,
      }]);
    });

    it('announces a kill as a forced stop and a restart as a start that asked for one', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(appReconciler, 'applyIntent').callsFake(async (id, mutate) => {
        await mutate();
        return true;
      });
      appReconciler.dockerActual.resolves({ reachable: true, running: true });

      const res = { json: sinon.fake((param) => param) };
      await appController.appKill({ params: { appname: 'Component_TestApp' }, query: {} }, res);
      await appController.appRestart({ params: { appname: 'Component_TestApp' }, query: {} }, res);

      expect(intents()).to.deep.equal([
        {
          identifier: 'Component_TestApp', stopped: true, force: true, restartRequested: false,
        },
        {
          identifier: 'Component_TestApp', stopped: false, force: false, restartRequested: true,
        },
      ]);
    });

    // The whole point of the event is to be the ordering point, and it can only
    // be that if it is published while the slot is still held - after the write,
    // so it never claims an intent that did not persist, and before the pass,
    // which awaitPass would otherwise put first.
    it('is published inside the slot, before the pass runs', async () => {
      verificationHelperStub.resolves(true);
      let announcedWhileHeld = null;
      sinon.stub(appReconciler, 'applyIntent').callsFake(async (id, mutate) => {
        await mutate();
        announcedWhileHeld = intents().length;
        return true;
      });

      const req = { params: { appname: 'Component_TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appStop(req, res);

      expect(announcedWhileHeld, 'the intent must be announced while the slot is still held').to.equal(1);
    });

    it('says nothing when the intent could not be written', async () => {
      verificationHelperStub.resolves(true);
      appsRuntimeState.setOperatorStopped.rejects(new Error('mongo is down'));
      sinon.stub(appReconciler, 'applyIntent').callsFake(async (id, mutate) => {
        await mutate();
        return true;
      });

      const req = { params: { appname: 'Component_TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appStop(req, res);

      // An announced intent that never persisted is worse than silence: a
      // consumer would order actuations against a lock that is not there.
      expect(intents()).to.deep.equal([]);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });
  });

  describe('appRestart tests', () => {
    beforeEach(() => {
      sinon.stub(dockerService, 'appDockerRestart').resolves('Flux App TestApp successfully restarted.');
      sinon.stub(appsRuntimeState, 'requestRestart').resolves();
      sinon.stub(appReconciler, 'applyIntent').callsFake(async (id, mutate) => {
        await mutate();
        return true;
      });
      sinon.stub(appReconciler, 'dockerActual').resolves({ reachable: true, running: true });
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
      expect(result.data).to.equal('Application TestApp restarted');
      // The bounce is the reconciler's: a restart is a level it converges to, so
      // there is no window between this handler deciding and a pass deciding.
      sinon.assert.notCalled(dockerService.appDockerRestart);
      sinon.assert.calledOnceWithExactly(appsRuntimeState.requestRestart, 'TestApp');
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
      sinon.assert.notCalled(dockerService.appDockerRestart);
      sinon.assert.calledWith(appsRuntimeState.requestRestart, 'Component1_ComposedApp');
      sinon.assert.calledWith(appsRuntimeState.requestRestart, 'Component2_ComposedApp');
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

    // A restart is an explicit "make it run": it clears the durable operator stop
    // lock with the same scope as appStart. Without it, stop -> restart leaves the
    // lock set and the reconciler silently re-stops the app at its next trigger.
    it('clears the operator stop lock and raises the generation together (v1-3 app)', async () => {
      verificationHelperStub.resolves(true);
      const setOperatorStopped = sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({ name: 'TestApp', version: 3 });

      const req = { params: { appname: 'TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appRestart(req, res);

      sinon.assert.calledOnceWithExactly(setOperatorStopped, 'TestApp', false, { force: false });
      // Both land inside one applyIntent slot, so a pass can never read the
      // cleared lock without the raised generation and leave the container alone.
      sinon.assert.callOrder(setOperatorStopped, appsRuntimeState.requestRestart);
      sinon.assert.calledOnce(appReconciler.applyIntent);
    });

    it('clears every component lock before restarting a composed app', async () => {
      verificationHelperStub.resolves(true);
      const setOperatorStopped = sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [{ name: 'Component1' }, { name: 'Component2' }],
      });

      const req = { params: { appname: 'ComposedApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appRestart(req, res);

      sinon.assert.calledWith(setOperatorStopped, 'Component1_ComposedApp', false, { force: false });
      sinon.assert.calledWith(setOperatorStopped, 'Component2_ComposedApp', false, { force: false });
    });

    it('clears only the named component lock on a component restart', async () => {
      verificationHelperStub.resolves(true);
      const setOperatorStopped = sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();

      const req = { params: { appname: 'Component1_ComposedApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appRestart(req, res);

      sinon.assert.calledOnceWithExactly(setOperatorStopped, 'Component1_ComposedApp', false, { force: false });
    });

    // A synced component the election holds elsewhere still gets its lock lifted -
    // the stop veto is the operator's, the run decision is the election's - but it
    // is reported as held rather than as restarted.
    it('lifts the lock for a synced component the election holds, and says so', async () => {
      verificationHelperStub.resolves(true);
      const setOperatorStopped = sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'ComposedApp',
        version: 4,
        compose: [{ name: 'Gcomp', containerData: 'g:/data' }],
      });
      appReconciler.dockerActual.resolves({ reachable: true, running: false });
      sinon.stub(appReconciler, 'desiredRunState').resolves({ desired: null, reason: 'awaitingController' });

      const req = { params: { appname: 'Gcomp_ComposedApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appRestart(req, res);

      sinon.assert.calledOnceWithExactly(setOperatorStopped, 'Gcomp_ComposedApp', false, { force: false });
      const result = res.json.firstCall.args[0];
      expect(result.data).to.equal('Application Gcomp_ComposedApp will be restarted: waiting for the election');
      sinon.assert.notCalled(dockerService.appDockerRestart);
    });
  });

  describe('appKill tests', () => {
    beforeEach(() => {
      sinon.stub(dockerService, 'appDockerKill').resolves('Flux App TestApp successfully killed.');
      sinon.stub(appReconciler, 'applyIntent').callsFake(async (id, mutate) => {
        await mutate();
        return true;
      });
      sinon.stub(appReconciler, 'dockerActual').resolves({ reachable: true, running: false });
    });

    it('records the kill as a forced stop and leaves the signal to the reconciler', async () => {
      verificationHelperStub.resolves(true);
      const setOperatorStopped = sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();

      const req = { params: { appname: 'Component_TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appKill(req, res);

      // A kill is the same desired state as a stop carrying a mode, so the choice
      // of signal sits with the reconciler that stops the container rather than
      // in a handler racing it.
      sinon.assert.calledOnceWithExactly(setOperatorStopped, 'Component_TestApp', true, { force: true });
      sinon.assert.notCalled(dockerService.appDockerKill);
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
      expect(result.data).to.equal('Application TestApp killed');
      sinon.assert.notCalled(dockerService.appDockerKill);
    });

    it('should kill all components for version 4+ apps', async () => {
      verificationHelperStub.resolves(true);
      const setOperatorStopped = sinon.stub(appsRuntimeState, 'setOperatorStopped').resolves();
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
      // Force reaches every component: a composed app half-killed and half-drained
      // is the failure this covers.
      sinon.assert.calledWith(setOperatorStopped, 'Component1_ComposedApp', true, { force: true });
      sinon.assert.calledWith(setOperatorStopped, 'Component2_ComposedApp', true, { force: true });
      // A kill goes down in the same reverse order as a stop - it is the same
      // shutdown, without the drain.
      expect(setOperatorStopped.firstCall.args[0]).to.equal('Component2_ComposedApp');
      expect(setOperatorStopped.secondCall.args[0]).to.equal('Component1_ComposedApp');
    });

    it('reports pending rather than killed when docker cannot be reached', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({
        name: 'TestApp',
        version: 3,
      });
      appReconciler.dockerActual.resolves({ reachable: false, running: false });

      const req = { params: { appname: 'TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appKill(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.data).to.equal('Application TestApp will be killed: docker is not reachable');
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
    });

    // Narrower than its siblings on purpose: appownerabove admits the node
    // operator, and ending someone else's app abruptly is not theirs to order.
    it('asks for a privilege that excludes the node operator', async () => {
      verificationHelperStub.resolves(true);
      sinon.stub(registryManager, 'getApplicationSpecifications').resolves({ name: 'TestApp', version: 3 });

      const req = { params: { appname: 'TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appKill(req, res);

      expect(verificationHelperStub.firstCall.args[0]).to.equal('appownerorfluxteam');
    });

    it('refuses a caller the narrower privilege rejects', async () => {
      verificationHelperStub.resolves(false);

      const req = { params: { appname: 'TestApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };
      await appController.appKill(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('error');
      expect(result.data.code).to.equal(401);
    });
  });

  // Pause and unpause were removed: docker reports a paused container as running, so
  // the reconciler and load balancer keep treating it as healthy while it is frozen.
  // The routes answer with an error so a caller is not told the container stopped.
  describe('deprecated pause control', () => {
    beforeEach(() => {
      verificationHelperStub.resolves(true);
    });

    it('should refuse to pause and name the replacement', async () => {
      const req = { params: { appname: 'TestApp' }, query: {}, headers: {} };
      const res = { json: sinon.fake(param => param) };

      await appController.appPause(req, res);

      const result = res.json.firstCall.args[0];

      expect(result.status).to.equal('error');
      expect(result.data.name).to.equal('Deprecated');
      expect(result.data.message).to.include('appstop');
      // The in-band contract: wire status 200, outcome as `code` in the body -
      // the one field a caller switches on.
      expect(result.data.code).to.equal(410);
    });

    it('should refuse to unpause', async () => {
      const req = { params: { appname: 'TestApp' }, query: {}, headers: {} };
      const res = { json: sinon.fake(param => param) };

      await appController.appUnpause(req, res);

      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.code).to.equal(410);
    });

    it('should still refuse an unauthorized caller before saying anything else', async () => {
      verificationHelperStub.resolves(false);

      const req = { params: { appname: 'TestApp' }, query: {}, headers: {} };
      const res = { json: sinon.fake(param => param) };

      await appController.appPause(req, res);

      const result = res.json.firstCall.args[0];

      expect(result.status).to.equal('error');
      // Asserted by identity, not by negation: `not.equal('Deprecated')` is
      // satisfied by any other error name, including one from an unrelated throw
      // that never reached the privilege check at all.
      expect(result.data.name).to.equal('Unauthorized');
    });

    // Express's default extended query parser turns ?appname=a&appname=b into an
    // ARRAY and ?appname[x]=1 into an object. Neither has .split, and the split
    // runs ahead of verifyPrivilege because the app name is what the privilege is
    // scoped to - so this was reachable unauthenticated from the open internet.
    // Unguarded, the rejection was dropped and res was never written: the socket
    // stayed open with nothing left to answer it.
    [
      ['an array', ['a', 'b']],
      ['an object', { x: '1' }],
      ['a number', 7],
    ].forEach(([shape, appname]) => {
      it(`answers when the app name arrives as ${shape}, instead of hanging the socket`, async () => {
        const req = { params: {}, query: { appname }, headers: {} };
        const res = { json: sinon.fake(param => param) };

        await appController.appPause(req, res);

        sinon.assert.calledOnce(res.json);
        const result = res.json.firstCall.args[0];
        expect(result.status).to.equal('error');
        // Named, not merely answered. Without the shape check the split still
        // throws and the catch still answers - but with a raw TypeError about
        // `.split`, which says nothing to the caller and tells them the request
        // was rejected for a reason internal to us rather than for the name they
        // sent.
        expect(result.data.message).to.include('Invalid Flux App name');
      });

      it(`answers appunpause too when the app name arrives as ${shape}`, async () => {
        const req = { params: {}, query: { appname }, headers: {} };
        const res = { json: sinon.fake(param => param) };

        await appController.appUnpause(req, res);

        sinon.assert.calledOnce(res.json);
        expect(res.json.firstCall.args[0].data.message).to.include('Invalid Flux App name');
      });
    });

    it('does not consult the privilege check with a name it could not parse', async () => {
      const req = { params: {}, query: { appname: ['a', 'b'] }, headers: {} };
      const res = { json: sinon.fake(param => param) };

      await appController.appPause(req, res);

      sinon.assert.notCalled(verificationHelperStub);
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

    it('leaves a container FluxOS runs for itself alone', async () => {
      // A file operation's container is created with no name, so docker gives
      // it a random one that no prefix test can tell from a tenant's. This
      // sweep runs every two hours, so before the label check it would stop a
      // long copy out from under the caller who asked for it.
      const executor = { Id: 'container-fileop', Names: ['/adoring_borg'], Labels: { 'runonflux.role': 'fileop' } };
      const foreign = { Id: 'container-foreign', Names: ['/watchtower'] };

      sinon.stub(dockerService, 'dockerListContainers').resolves([executor, foreign]);
      const stopStub = sinon.stub(dockerService, 'appDockerStop').resolves();
      const clock = sinon.useFakeTimers();

      appController.stopAllNonFluxRunningApps();
      await clock.tickAsync(100);

      sinon.assert.calledOnceWithExactly(stopStub, 'container-foreign');

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
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.3:16127');
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
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.3:16127');

      // eslint-disable-next-line global-require
      const axios = require('axios');
      const axiosStub = sinon.stub(axios, 'get').resolves({ status: 200 });

      await appController.executeAppGlobalCommand('TestApp', 'appstart', 'test-auth', null, true);

      // Should only call once, skipping own IP
      sinon.assert.calledOnce(axiosStub);
    });
  });

  describe('deliverGlobalCommand tests', () => {
    // eslint-disable-next-line global-require
    const axios = require('axios');
    // eslint-disable-next-line global-require
    const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
    // eslint-disable-next-line global-require
    const log = require('../../ZelBack/src/lib/log');

    afterEach(() => sinon.restore());

    const boot503 = () => ({ response: { status: 503, headers: { 'retry-after': '15' } } });

    it('retries a node that answers 503 while booting, so the command lands', async () => {
      // Without the retry a global command aimed at a node mid-restart is
      // dropped on the first refusal and the app is never actually removed.
      const axiosStub = sinon.stub(axios, 'get');
      axiosStub.onFirstCall().rejects(boot503());
      axiosStub.onSecondCall().resolves({ status: 200 });
      const delayStub = sinon.stub(serviceHelper, 'delay').resolves();

      await appController.deliverGlobalCommand('http://node/apps/appremove/x', {});

      sinon.assert.calledTwice(axiosStub); // refused, then landed
      sinon.assert.calledOnce(delayStub); // waited between the two
    });

    it('gives up after the retry bound and warns rather than dropping silently', async () => {
      sinon.stub(axios, 'get').rejects(boot503());
      sinon.stub(serviceHelper, 'delay').resolves();
      const warnStub = sinon.stub(log, 'warn');

      await appController.deliverGlobalCommand('http://node/apps/appremove/x', {});

      sinon.assert.calledOnce(warnStub);
      expect(warnStub.firstCall.args[0]).to.include('not delivered');
    });

    it('does not retry a failure that is not a boot-gate 503', async () => {
      // A 500, a refused command, a real error - that is the node's answer, not
      // a self-resolving "come back later", so it is taken as final.
      const axiosStub = sinon.stub(axios, 'get').rejects({ response: { status: 500 } });
      const delayStub = sinon.stub(serviceHelper, 'delay').resolves();

      await appController.deliverGlobalCommand('http://node/apps/appremove/x', {});

      sinon.assert.calledOnce(axiosStub);
      sinon.assert.notCalled(delayStub);
    });
  });
});
