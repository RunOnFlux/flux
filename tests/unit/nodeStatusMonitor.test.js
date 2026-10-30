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

  describe('start', () => {
    it('runs no pass until boot has settled, and runs one once it has', async () => {
      let settle;
      const settled = new Promise((resolve) => { settle = resolve; });
      const isNodeDos = sinon.stub().returns(false);
      const monitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {
        '../serviceHelper': { delay: () => new Promise(() => {}) },
        '../fluxNetworkHelper': { isNodeDos },
        '../nodeConfirmationService': { isDaemonStale: () => false, isConfirmed: () => false },
        '../utils/globalState': { waitForBootContainerStateSettled: () => settled },
        '../../lib/log': logStub,
      });
      const installedAppsFn = sinon.stub().resolves({ status: 'success', data: [] });

      const started = monitor.start(installedAppsFn, sinon.stub());
      await new Promise((resolve) => { setImmediate(resolve); });
      sinon.assert.notCalled(isNodeDos);

      settle();
      await started;
      sinon.assert.calledOnce(isNodeDos);
    });
  });

  describe('initialize', () => {
    let listeners;
    let monitor;

    beforeEach(() => {
      listeners = {};
      monitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {
        '../dbHelper': {},
        '../serviceHelper': { delay: sinon.stub().resolves() },
        '../fluxNetworkHelper': { onIpChangeHold: (cb) => { listeners.ipChangeHold = cb; } },
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

    it('removes every app at once when the node is held for its IP changes', async () => {
      const installedAppsFn = sinon.stub().resolves({ status: 'success', data: [{ name: 'one' }, { name: 'two' }] });
      const removeAppLocallyFn = sinon.stub().resolves('removed');
      monitor.initialize(installedAppsFn, removeAppLocallyFn);

      listeners.ipChangeHold(2);
      await new Promise((resolve) => { setImmediate(resolve); });
      await new Promise((resolve) => { setImmediate(resolve); });

      // each removal is a hand-back the network should hear of; whether it can is the announcement's to read
      sinon.assert.calledWithExactly(removeAppLocallyFn, 'one', null, true, false, true);
      sinon.assert.calledWith(removeAppLocallyFn, 'two');
      sinon.assert.calledWithMatch(logStub.info, /going to be removed: IP changes over the limit/);
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
    let confirmed;
    let bus;
    let globalState;
    const SPACING = 5000;
    const never = () => new Promise(() => {});
    const installed = (...names) => sinon.stub().resolves({ status: 'success', data: names.map((name) => ({ name })) });

    beforeEach(() => {
      clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      dos = false;
      confirmed = true;
      bus = { publish: sinon.stub() };
      appKill = {
        readContainers: sinon.stub().resolves([]),
        appsOnDisk: sinon.stub().resolves([]),
        containersOf: sinon.stub().callsFake((name) => [`flux${name}`]),
        stillRunnable: sinon.stub().resolves([]),
        kill: sinon.stub().resolves([]),
        killOutsideSlices: sinon.stub().resolves([]),
        stillRunnableOutsideSlices: sinon.stub().resolves([]),
      };
      dockerService = { appDockerStop: sinon.stub().resolves('stopped') };
      globalState = proxyquire('../../ZelBack/src/services/utils/globalState', {});
      monitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {
        config: {
          fluxapps: { appRemovalDeadlineMs: DEADLINE, nodeMonitorRemovalDelayMs: SPACING },
          hostStall: { stopWindowMs: STOP_WINDOW },
          database: { appsglobal: { collections: {} } },
        },
        '../dbHelper': {},
        // the spacing between removals runs on the clock, and the wait before the next pass never ends
        '../serviceHelper': { delay: sinon.stub().callsFake((ms) => (ms === SPACING ? new Promise((resolve) => { setTimeout(resolve, ms); }) : never())) },
        '../fluxNetworkHelper': { isNodeDos: () => dos, onIpChangeHold: sinon.stub() },
        '../fluxCommunicationUtils': {},
        '../appMessaging/messageStore': {},
        '../networkStateService': {},
        '../nodeConfirmationService': {
          onConfirmationChange: sinon.stub(),
          onDaemonStale: sinon.stub(),
          canSendMessages: () => true,
          isDaemonStale: () => false,
          isConfirmed: () => confirmed,
        },
        '../hostStallService': { onTrip: (listener) => { onTrip = listener; } },
        '../appLifecycle/appKill': appKill,
        '../dockerService': dockerService,
        '../utils/fluxEventBus': bus,
        '../utils/globalState': globalState,
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
      appKill.containersOf.withArgs('one').returns(['fluxweb_one', 'fluxdb_one']);
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

      sinon.assert.calledOnceWithExactly(appKill.kill, 'stuck', []);
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

    it('reads docker\'s records once, and finds, stops, checks and kills every app from that one read', async () => {
      const records = [{ id: '1', name: 'fluxa', app: 'a' }];
      appKill.readContainers.resolves(records);
      appKill.stillRunnable.onFirstCall().resolves(['41']);

      await monitor.unloadForHostStall(installed('a', 'b'), sinon.stub().resolves('removed'));

      sinon.assert.calledOnce(appKill.readContainers);
      sinon.assert.calledWithExactly(appKill.appsOnDisk, records);
      ['containersOf', 'stillRunnable'].forEach((call) => appKill[call].getCalls().forEach(({ args }) => expect(args[1], call).to.equal(records)));
      sinon.assert.calledOnceWithExactly(appKill.kill, 'a', records);
    });

    it('stops and kills every app through its slice when docker\'s records do not answer within the stop window', async () => {
      appKill.readContainers.callsFake(never);
      appKill.appsOnDisk.withArgs(null).resolves(['ondisk']);
      dockerService.appDockerStop.callsFake(never);
      appKill.stillRunnable.callsFake(async (name) => (appKill.kill.calledWith(name) ? [] : ['41']));

      const unload = monitor.unloadForHostStall(installed('a'), sinon.stub().resolves('removed'));
      await clock.tickAsync(STOP_WINDOW * 2);

      sinon.assert.calledWithMatch(logStub.error, /container records could not be read \(no answer\)/);
      expect(appKill.kill.getCalls().map(({ args }) => args)).to.deep.equal([['a', null], ['ondisk', null]]);
      sinon.assert.calledWithMatch(bus.publish, 'hostStall:appsStopped');
      await unload;
    });

    it('reads the installed apps and docker\'s records at once, so a stall that holds both delays the stop by one wait', async () => {
      const after = (ms, value) => () => new Promise((resolve) => { setTimeout(resolve, ms, value); });
      const installedAppsFn = sinon.stub().callsFake(after(STOP_WINDOW - 1, { status: 'success', data: [{ name: 'a' }] }));
      appKill.readContainers.callsFake(after(STOP_WINDOW - 1, []));
      dockerService.appDockerStop.callsFake(never);

      const unload = monitor.unloadForHostStall(installedAppsFn, sinon.stub().resolves('removed'));
      await clock.tickAsync(STOP_WINDOW - 1);

      sinon.assert.calledWith(dockerService.appDockerStop, 'fluxa');
      await clock.tickAsync(STOP_WINDOW);
      await unload;
    });

    describe('when docker\'s records cannot be read', () => {
      beforeEach(() => {
        appKill.readContainers.resolves(null);
      });

      // A disk the database and docker share stalls both: no app is listed, and the
      // containers made before the slices are found by no name.
      it('kills every container outside the slices though no app is found, and says what can still run of them', async () => {
        appKill.killOutsideSlices.resolves(['/sys/fs/cgroup/system.slice/docker-1.scope']);
        appKill.stillRunnableOutsideSlices.resolves([]);

        const unload = monitor.unloadForHostStall(sinon.stub().callsFake(never), sinon.stub().resolves('removed'));
        await clock.tickAsync(DEADLINE + STOP_WINDOW);
        await unload;

        sinon.assert.calledOnce(appKill.killOutsideSlices);
        sinon.assert.calledWithExactly(bus.publish, 'hostStall:appsStopped', { apps: [], outsideSlices: { containers: 1, runnable: [] } });
      });

      it('kills them once whatever the number of apps, after the stop window', async () => {
        dockerService.appDockerStop.callsFake(never);

        const unload = monitor.unloadForHostStall(installed('a', 'b', 'c'), sinon.stub().resolves('removed'));
        await clock.tickAsync(STOP_WINDOW - 1);
        sinon.assert.notCalled(appKill.killOutsideSlices);
        await clock.tickAsync(1);
        await unload;

        sinon.assert.calledOnce(appKill.killOutsideSlices);
      });

      it('names what of them can still run, or that it cannot be known', async () => {
        appKill.stillRunnableOutsideSlices.onFirstCall().resolves(['77']);

        await monitor.unloadForHostStall(installed('a'), sinon.stub().resolves('removed'));

        sinon.assert.calledWithMatch(logStub.error, /processes 77 of containers outside the app slices can still run/);
        sinon.assert.calledWithMatch(bus.publish, 'hostStall:appsStopped', { outsideSlices: { runnable: ['77'] } });
      });
    });

    it('kills nothing outside the slices when docker\'s records name every container', async () => {
      await monitor.unloadForHostStall(installed('a'), sinon.stub().resolves('removed'));

      sinon.assert.notCalled(appKill.killOutsideSlices);
      sinon.assert.calledWithExactly(bus.publish, 'hostStall:appsStopped', { apps: [{ app: 'a', killed: false, runnable: [] }] });
    });

    it('names a refusal to list docker\'s records', async () => {
      appKill.readContainers.resolves(null);

      await monitor.unloadForHostStall(installed('a'), sinon.stub().resolves('removed'));

      sinon.assert.calledWithMatch(logStub.error, /container records could not be read \(refused\)/);
      sinon.assert.calledWithExactly(appKill.appsOnDisk, null);
    });

    it('reports an app whose processes cannot all be found as unknown, never as unable to run', async () => {
      appKill.stillRunnable.resolves(null);

      await monitor.unloadForHostStall(installed('app'), sinon.stub().resolves('timedOut'));

      sinon.assert.calledWithExactly(bus.publish, 'hostStall:appsStopped', { apps: [{ app: 'app', killed: false, runnable: null }] });
      sinon.assert.calledWithExactly(bus.publish, 'hostStall:appUnloaded', {
        app: 'app', removal: 'timedOut', killed: false, runnable: null,
      });
      sinon.assert.calledWithMatch(logStub.error, /app: whether it can still run cannot be known/);
      sinon.assert.neverCalledWithMatch(logStub.warn, /can no longer run/);
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
      await clock.tickAsync(DEADLINE + SPACING);

      sinon.assert.calledWith(remove, 'next');
      sinon.assert.calledWithMatch(logStub.error, /stuck was not removed within 300s, moving on/);
    });

    describe('with an install running', () => {
      const listings = (...lists) => {
        const stub = sinon.stub();
        lists.forEach((names, call) => stub.onCall(call).resolves({ status: 'success', data: names.map((name) => ({ name })) }));
        return stub;
      };
      const removedNames = (remove) => remove.getCalls().map((call) => call.args[0]);

      beforeEach(() => {
        dos = true;
        globalState.installationInProgress = true;
        globalState.installingApp = 'newapp';
      });

      it('removes every other app, and the install\'s app once the install releases the node', async () => {
        const remove = sinon.stub().resolves('removed');

        monitor.monitorNodeStatus(listings(['oldapp', 'newapp'], ['newapp']), remove);
        await clock.tickAsync(0);
        expect(removedNames(remove)).to.deep.equal(['oldapp']);

        globalState.installationInProgress = false;
        await clock.tickAsync(0);

        expect(removedNames(remove)).to.deep.equal(['oldapp', 'newapp']);
      });

      it('leaves the install\'s app when the node is back in service by the time the install finishes', async () => {
        const remove = sinon.stub().resolves('removed');

        monitor.monitorNodeStatus(listings(['oldapp', 'newapp'], ['newapp']), remove);
        await clock.tickAsync(0);
        dos = false;
        globalState.installationInProgress = false;
        await clock.tickAsync(0);

        expect(removedNames(remove)).to.deep.equal(['oldapp']);
        sinon.assert.calledWithMatch(logStub.info, /back in service while the install of newapp ran/);
      });

      it('removes the install\'s app for whatever keeps the node out of service when the install finishes', async () => {
        const remove = sinon.stub().resolves('removed');

        monitor.monitorNodeStatus(listings(['oldapp', 'newapp'], ['newapp']), remove);
        await clock.tickAsync(0);
        dos = false;
        confirmed = false;
        globalState.installationInProgress = false;
        await clock.tickAsync(0);

        expect(removedNames(remove)).to.deep.equal(['oldapp', 'newapp']);
        sinon.assert.calledWithMatch(logStub.info, /newapp going to be removed: node not confirmed/);
      });

      it('removes the install\'s app when the install finishes while the other apps are removed', async () => {
        const remove = sinon.stub().resolves('removed');
        remove.withArgs('oldapp').callsFake(async () => {
          globalState.installationInProgress = false;
          return 'removed';
        });

        monitor.monitorNodeStatus(listings(['oldapp', 'newapp'], ['newapp']), remove);
        await clock.tickAsync(0);

        expect(removedNames(remove)).to.deep.equal(['oldapp', 'newapp']);
      });

      it('leaves nothing to remove when the install took its own app back', async () => {
        const remove = sinon.stub().resolves('removed');
        const installedFn = listings(['oldapp', 'newapp'], []);

        monitor.monitorNodeStatus(installedFn, remove);
        await clock.tickAsync(0);
        globalState.installationInProgress = false;
        await clock.tickAsync(0);

        sinon.assert.calledTwice(installedFn);
        expect(removedNames(remove)).to.deep.equal(['oldapp']);
      });
    });

    it('starts each DOS removal nodeMonitorRemovalDelayMs after the one before it returns', async () => {
      dos = true;
      const remove = sinon.stub().resolves('removed');
      const removed = () => remove.getCalls().map((call) => call.args[0]);

      monitor.monitorNodeStatus(installed('one', 'two', 'three'), remove);
      await clock.tickAsync(0);
      expect(removed()).to.deep.equal(['one']);
      await clock.tickAsync(SPACING - 1);
      expect(removed(), 'the next removal started before the spacing').to.deep.equal(['one']);
      await clock.tickAsync(1);
      expect(removed()).to.deep.equal(['one', 'two']);
      await clock.tickAsync(SPACING);
      expect(removed()).to.deep.equal(['one', 'two', 'three']);
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
