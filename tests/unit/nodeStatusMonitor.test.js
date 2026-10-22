const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('nodeStatusMonitor tests', () => {
  let nodeStatusMonitor;
  let logStub;

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    nodeStatusMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {
      axios: {
        get: sinon.stub().resolves({ data: { status: 'success' } }),
        CancelToken: {
          source: sinon.stub().returns({
            token: 'token',
            cancel: sinon.stub(),
          }),
        },
      },
      config: {
        fluxapps: { appRemovalDeadlineMs: 300000 },
        hostStall: { stopWindowMs: 60000 },
        database: {
          appsglobal: {
            database: 'globalapps',
            collections: {
              appsLocations: 'appsLocations',
            },
          },
        },
      },
      '../dbHelper': {
        databaseConnection: sinon.stub(),
        distinctDatabase: sinon.stub(),
        removeDocumentsFromCollection: sinon.stub(),
      },
      '../serviceHelper': {
        delay: sinon.stub().resolves(),
      },
      '../generalService': {
        isNodeStatusConfirmed: sinon.stub().resolves(true),
      },
      '../fluxNetworkHelper': {
        getDosStateValue: sinon.stub().returns(0),
      },
      '../fluxCommunicationUtils': {
        socketAddressInFluxList: sinon.stub().resolves(true),
      },
      '../../lib/log': logStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('monitorNodeStatus', () => {
    it('should be exported as a function', () => {
      expect(nodeStatusMonitor.monitorNodeStatus).to.be.a('function');
    });

    // Note: This is a recursive monitoring function with complex business logic
    // Full testing would require integration tests or extensive mocking
  });

  describe('initialize', () => {
    let listeners;
    let monitor;

    beforeEach(() => {
      listeners = {};
      monitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {
        '../dbHelper': {},
        '../serviceHelper': { delay: sinon.stub().resolves() },
        '../fluxNetworkHelper': {},
        '../fluxCommunicationUtils': {},
        '../appMessaging/messageStore': {},
        '../networkStateService': {},
        '../nodeConfirmationService': {
          onConfirmationChange: (cb) => { listeners.confirmation = cb; },
          onDaemonStale: (cb) => { listeners.daemonStale = cb; },
          canSendMessages: () => true,
        },
        '../../lib/log': logStub,
      });
    });

    // Nothing awaits a listener's removal: a read that fails there is logged,
    // never left to escape as an unhandled rejection that exits FluxOS.
    it('logs a removal whose installed-apps read fails when confirmation is lost', async () => {
      const installedAppsFn = sinon.stub().rejects(new Error('connection timed out'));
      const removeAppLocallyFn = sinon.stub();
      monitor.initialize(installedAppsFn, removeAppLocallyFn);

      listeners.confirmation(false);
      await new Promise((resolve) => { setImmediate(resolve); });

      sinon.assert.calledOnce(installedAppsFn);
      sinon.assert.notCalled(removeAppLocallyFn);
      sinon.assert.calledWithMatch(logStub.error, /node lost confirmation\) failed: connection timed out/);
    });

    it('logs a removal whose installed-apps read fails when the daemon goes stale', async () => {
      const installedAppsFn = sinon.stub().resolves({ status: 'error' });
      monitor.initialize(installedAppsFn, sinon.stub());

      listeners.daemonStale();
      await new Promise((resolve) => { setImmediate(resolve); });

      sinon.assert.calledWithMatch(logStub.error, /daemon unreachable\) failed/);
    });
  });

  describe('removal while out of service', () => {
    const DEADLINE = 300000;
    const STOP_WINDOW = 60000;
    let clock;
    let monitor;
    let appKill;
    let dockerService;
    let onTrip;
    let dos;
    let bus;
    const never = () => new Promise(() => {});
    const installed = (...names) => sinon.stub().resolves({ status: 'success', data: names.map((name) => ({ name })) });

    beforeEach(() => {
      clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      dos = false;
      bus = { publish: sinon.stub() };
      appKill = {
        appsOnDisk: sinon.stub().resolves([]),
        containersOf: sinon.stub().callsFake(async (name) => [`flux${name}`]),
        stillRunnable: sinon.stub().resolves([]),
        kill: sinon.stub().resolves([]),
      };
      dockerService = { appDockerStop: sinon.stub().resolves('stopped') };
      monitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {
        config: {
          fluxapps: { appRemovalDeadlineMs: DEADLINE, nodeMonitorRemovalDelayMs: 0 },
          hostStall: { stopWindowMs: STOP_WINDOW },
          database: { appsglobal: { collections: {} } },
        },
        '../dbHelper': {},
        // the spacing between apps passes, and the wait before the next pass never ends
        '../serviceHelper': { delay: sinon.stub().callsFake((ms) => (ms === 0 ? Promise.resolve() : never())) },
        '../fluxNetworkHelper': { isNodeDos: () => dos },
        '../fluxCommunicationUtils': {},
        '../appMessaging/messageStore': {},
        '../networkStateService': {},
        '../nodeConfirmationService': {
          onConfirmationChange: sinon.stub(), onDaemonStale: sinon.stub(), canSendMessages: () => true,
        },
        '../hostStallService': { onTrip: (listener) => { onTrip = listener; } },
        '../appLifecycle/appKill': appKill,
        '../dockerService': dockerService,
        '../utils/fluxEventBus': bus,
        '../../lib/log': logStub,
      });
    });

    afterEach(() => {
      clock.restore();
    });

    it('publishes an app its removal removed, with nothing left to run', async () => {
      await monitor.unloadForHostStall(installed('gone'), sinon.stub().resolves('removed'));

      sinon.assert.calledWithExactly(bus.publish, 'hostStall:appUnloaded', {
        app: 'gone', removal: 'removed', killed: false, runnable: [],
      });
    });

    it('publishes an app it killed, and what of it can still run, once it has stopped every app', async () => {
      appKill.stillRunnable.onFirstCall().resolves(['41', '42']).onSecondCall().resolves(['42']);

      const unload = monitor.unloadForHostStall(installed('stuck'), sinon.stub().callsFake(never));
      await clock.tickAsync(STOP_WINDOW + DEADLINE);
      await unload;

      sinon.assert.calledWithExactly(bus.publish, 'hostStall:appsStopped', {
        apps: [{ app: 'stuck', killed: true, runnable: ['42'] }],
      });
      sinon.assert.calledWithExactly(bus.publish, 'hostStall:appUnloaded', {
        app: 'stuck', removal: 'timedOut', killed: true, runnable: ['42'],
      });
    });

    it('asks docker to stop every container of every app at once', async () => {
      appKill.containersOf.withArgs('one').resolves(['fluxweb_one', 'fluxdb_one']);
      dockerService.appDockerStop.callsFake(never);

      const unload = monitor.unloadForHostStall(installed('one', 'two'), sinon.stub().resolves('removed'));
      await clock.tickAsync(0);

      expect(dockerService.appDockerStop.getCalls().map((call) => call.args[0])).to.have.members(['fluxweb_one', 'fluxdb_one', 'fluxtwo']);
      await clock.tickAsync(STOP_WINDOW);
      await unload;
    });

    it('waits one stop window for every app together, then kills what can still run', async () => {
      dockerService.appDockerStop.callsFake(never);
      appKill.stillRunnable.callsFake(async (name) => (appKill.kill.calledWith(name) ? [] : ['41']));

      const unload = monitor.unloadForHostStall(installed('a', 'b', 'c'), sinon.stub().resolves('removed'));
      await clock.tickAsync(STOP_WINDOW - 1);
      sinon.assert.notCalled(appKill.kill);
      await clock.tickAsync(1);
      await unload;

      expect(appKill.kill.getCalls().map((call) => call.args[0])).to.deep.equal(['a', 'b', 'c']);
    });

    it('goes on as soon as docker has stopped every app, without waiting out the window', async () => {
      const remove = sinon.stub().resolves('removed');

      await monitor.unloadForHostStall(installed('a', 'b'), remove);

      sinon.assert.calledTwice(remove);
      sinon.assert.notCalled(appKill.kill);
    });

    it('removes no app, and so tells the network of none, until every app has stopped or been killed', async () => {
      dockerService.appDockerStop.callsFake(never);
      appKill.stillRunnable.callsFake(async (name) => (appKill.kill.calledWith(name) ? [] : ['41']));
      const remove = sinon.stub().resolves('removed');

      const unload = monitor.unloadForHostStall(installed('a', 'b'), remove);
      await clock.tickAsync(STOP_WINDOW - 1);
      sinon.assert.notCalled(remove);
      await clock.tickAsync(1);
      await unload;

      sinon.assert.callOrder(appKill.kill.withArgs('b'), remove.withArgs('a'));
    });

    it('removes every app once the host stalls, starting from the trip', async () => {
      const remove = sinon.stub().resolves('removed');
      monitor.initialize(installed('one', 'two'), remove);

      onTrip();
      await clock.tickAsync(0);

      expect(remove.getCalls().map((call) => call.args[0])).to.deep.equal(['one', 'two']);
      sinon.assert.notCalled(appKill.kill);
    });

    it('moves past a removal that does not return within the deadline', async () => {
      const remove = sinon.stub();
      remove.withArgs('stuck').callsFake(never);
      remove.withArgs('next').resolves('removed');

      const unload = monitor.unloadForHostStall(installed('stuck', 'next'), remove);
      await clock.tickAsync(DEADLINE - 1);
      sinon.assert.neverCalledWith(remove, 'next');
      await clock.tickAsync(1);
      await unload;

      sinon.assert.calledWith(remove, 'next');
    });

    it('says an app it killed can no longer run', async () => {
      appKill.stillRunnable.onFirstCall().resolves(['41']).onSecondCall().resolves([]);

      await monitor.unloadForHostStall(installed('stuck'), sinon.stub().resolves('removed'));

      sinon.assert.calledOnceWithExactly(appKill.kill, 'stuck');
      sinon.assert.calledWithMatch(logStub.warn, /stuck can no longer run/);
    });

    it('says an app its removal could not finish can no longer run, when nothing of it is left to kill', async () => {
      const remove = sinon.stub().callsFake(never);

      const unload = monitor.unloadForHostStall(installed('stopped'), remove);
      await clock.tickAsync(DEADLINE);
      await unload;

      sinon.assert.notCalled(appKill.kill);
      sinon.assert.calledWithMatch(logStub.warn, /stopped was not removed \(timedOut\), and can no longer run/);
    });

    it('says nothing more of an app its removal removed', async () => {
      await monitor.unloadForHostStall(installed('gone'), sinon.stub().resolves('removed'));

      sinon.assert.neverCalledWithMatch(logStub.warn, /can no longer run/);
    });

    it('names the processes a kill could not stop', async () => {
      appKill.stillRunnable.resolves(['41', '42']);

      await monitor.unloadForHostStall(installed('app'), sinon.stub().resolves('failed'));

      sinon.assert.calledWithMatch(logStub.error, /app could not be stopped: processes 41, 42 can still run/);
    });

    it('removes the apps found on disk when the database cannot list them', async () => {
      appKill.appsOnDisk.resolves(['ondisk']);
      const remove = sinon.stub().resolves('removed');

      await monitor.unloadForHostStall(sinon.stub().rejects(new Error('timed out')), remove);

      sinon.assert.calledOnceWithMatch(remove, 'ondisk');
    });

    it('removes each app once when the database and the disk both name it', async () => {
      appKill.appsOnDisk.resolves(['both']);
      const remove = sinon.stub().resolves('removed');

      await monitor.unloadForHostStall(installed('both'), remove);

      sinon.assert.calledOnce(remove);
    });

    it('starts no second removal of an app whose removal is still running, and still checks it', async () => {
      let finish;
      const remove = sinon.stub().callsFake(() => new Promise((resolve) => { finish = resolve; }));
      const first = monitor.unloadForHostStall(installed('stuck'), remove);
      await clock.tickAsync(DEADLINE);
      await first;
      appKill.stillRunnable.resetHistory();

      await monitor.unloadForHostStall(installed('stuck'), remove);

      sinon.assert.calledOnce(remove);
      sinon.assert.calledWith(appKill.stillRunnable, 'stuck');
      finish('removed');
      await clock.tickAsync(0);
      const third = monitor.unloadForHostStall(installed('stuck'), remove);
      await clock.tickAsync(0);
      sinon.assert.calledTwice(remove);
      finish('removed');
      await third;
    });

    it('moves past a DOS removal that does not return within the deadline', async () => {
      dos = true;
      const remove = sinon.stub();
      remove.withArgs('stuck').callsFake(never);
      remove.withArgs('next').resolves('removed');

      monitor.monitorNodeStatus(installed('stuck', 'next'), remove);
      await clock.tickAsync(DEADLINE);

      sinon.assert.calledWith(remove, 'next');
      sinon.assert.calledWithMatch(logStub.error, /stuck was not removed within 300s, moving on/);
    });

    it('starts no DOS removal while a host stall\'s removal has the node', async () => {
      dos = true;
      const remove = sinon.stub().callsFake(never);
      const unload = monitor.unloadForHostStall(installed('held'), remove);
      await clock.tickAsync(0);

      monitor.monitorNodeStatus(installed('other'), remove);
      await clock.tickAsync(0);

      sinon.assert.neverCalledWith(remove, 'other');
      await clock.tickAsync(DEADLINE);
      await unload;
    });
  });
});
