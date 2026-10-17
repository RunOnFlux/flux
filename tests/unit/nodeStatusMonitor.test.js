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
    let clock;
    let monitor;
    let appKill;
    let onTrip;
    let dos;
    const never = () => new Promise(() => {});
    const installed = (...names) => sinon.stub().resolves({ status: 'success', data: names.map((name) => ({ name })) });

    beforeEach(() => {
      clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      dos = false;
      appKill = {
        appsOnDisk: sinon.stub().resolves([]),
        stillRunnable: sinon.stub().resolves([]),
        kill: sinon.stub().resolves([]),
      };
      monitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {
        config: { fluxapps: { appRemovalDeadlineMs: DEADLINE, nodeMonitorRemovalDelayMs: 0 }, database: { appsglobal: { collections: {} } } },
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
        '../../lib/log': logStub,
      });
    });

    afterEach(() => {
      clock.restore();
    });

    it('removes every app once the host stalls, starting from the trip', async () => {
      const remove = sinon.stub().resolves('removed');
      monitor.initialize(installed('one', 'two'), remove);

      onTrip();
      await clock.tickAsync(0);

      expect(remove.getCalls().map((call) => call.args[0])).to.deep.equal(['one', 'two']);
      sinon.assert.notCalled(appKill.kill);
    });

    it('kills an app whose removal does not return within the deadline, and moves on', async () => {
      const remove = sinon.stub();
      remove.withArgs('stuck').callsFake(never);
      remove.withArgs('next').resolves('removed');
      appKill.stillRunnable.withArgs('stuck').onFirstCall().resolves(['41']).onSecondCall().resolves([]);

      const unload = monitor.unloadForHostStall(installed('stuck', 'next'), remove);
      await clock.tickAsync(DEADLINE - 1);
      sinon.assert.notCalled(appKill.kill);
      await clock.tickAsync(1);
      await unload;

      sinon.assert.calledOnceWithExactly(appKill.kill, 'stuck');
      sinon.assert.calledWith(remove, 'next');
      sinon.assert.calledWithMatch(logStub.warn, /stuck can no longer run/);
    });

    it('kills an app whose removal failed while its processes can still run', async () => {
      const remove = sinon.stub().resolves('failed');
      appKill.stillRunnable.onFirstCall().resolves(['41']).onSecondCall().resolves([]);

      await monitor.unloadForHostStall(installed('app'), remove);

      sinon.assert.calledOnceWithExactly(appKill.kill, 'app');
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
