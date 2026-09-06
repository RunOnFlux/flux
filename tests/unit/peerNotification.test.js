const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('peerNotification tests', () => {
  let peerNotification;
  let logStub;
  let enqueueAllStub;
  let waitForBootDrainSettledStub;
  let storeAppRunningMessageStub;
  let storeAppStateEventStub;
  let broadcastMessageToAllStub;
  let nodeSignerStub;
  let installedAppsStub;
  let listRunningAppsStub;

  // One stub map, so a test that needs a different interval, expiry or cycle
  // length states only that difference instead of restating sixty lines.
  const loadPeerNotification = (opts = {}) => proxyquire('../../ZelBack/src/services/appMessaging/peerNotification', {
    config: {
      database: {
        appslocal: {
          collections: { appsInformation: 'localAppsInformation' },
          database: 'localapps',
        },
        appsglobal: {
          database: 'globalapps',
          collections: { appsLocations: 'appsLocations' },
        },
      },
      fluxapps: {
        peerNotifyIntervalMs: opts.peerNotifyIntervalMs ?? 3600000,
      },
    },
    '../dbHelper': {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
      findOneInDatabase: sinon.stub().resolves(null),
      findInDatabase: sinon.stub().resolves([]),
      updateOneInDatabase: sinon.stub().resolves(),
    },
    '../dockerService': {
      appDockerStart: sinon.stub().resolves(),
      getDockerContainerOnly: sinon.stub().resolves(null),
    },
    '../serviceHelper': {
      delay: sinon.stub().resolves(),
      ensureString: sinon.stub().returnsArg(0),
    },
    '../generalService': {
      isNodeStatusConfirmed: sinon.stub().resolves(true),
      nodeTier: sinon.stub().resolves('cumulus'),
    },
    '../fluxNetworkHelper': {
      getLocalSocketAddress: sinon.stub().resolves('192.168.1.1:16127'),
    },
    '../geolocationService': {
      isStaticIP: sinon.stub().returns(true),
    },
    '../fluxCommunicationMessagesSender': {
      broadcastMessageToOutgoing: sinon.stub().resolves(),
      broadcastMessageToIncoming: sinon.stub().resolves(),
      broadcastMessageToAll: broadcastMessageToAllStub,
    },
    './messageStore': {
      storeAppRunningMessage: storeAppRunningMessageStub,
      storeAppStateEvent: storeAppStateEventStub,
      APP_STATE_EVENT_TYPES: { APPRUNNING: 'apprunning' },
    },
    '../appDatabase/registryManager': {
      getApplicationGlobalSpecifications: sinon.stub().resolves(null),
    },
    '../appManagement/appInspector': {
      startAppMonitoring: sinon.stub(),
      stopAppMonitoring: sinon.stub(),
    },
    '../appLifecycle/appUninstaller': {
      removeAppLocally: sinon.stub().resolves(),
    },
    '../appLifecycle/appInstaller': {
      installApplicationHard: sinon.stub().resolves(),
    },
    '../appMonitoring/appReconciler': {
      enqueueAll: enqueueAllStub,
      waitForBootDrainSettled: waitForBootDrainSettledStub,
    },
    '../appQuery/appQueryService': {
      installedApps: installedAppsStub,
      listRunningApps: opts.listRunningApps ?? listRunningAppsStub,
      decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
    },
    '../appTamperingDetectionService': {
      recordEvent: sinon.stub().resolves(),
      isNetworkMissingError: sinon.stub().returns(false),
    },
    '../utils/appConstants': {
      localAppsInformation: 'localAppsInformation',
      // The announcement interval is capped against this, so a suite that
      // leaves it undefined schedules on NaN and re-fires forever.
      RUNNING_EXPIRY_MS: opts.runningExpiryMs ?? 7500 * 1000,
    },
    '../nodeConfirmationService': {
      canSendMessages: sinon.stub().returns(true),
      onMessageCapabilityChange: sinon.stub(),
    },
    '../utils/nodeSigner': { nodeSigner: nodeSignerStub },
    '../../lib/log': logStub,
  });

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    enqueueAllStub = sinon.stub().resolves();
    waitForBootDrainSettledStub = sinon.stub().resolves();
    storeAppRunningMessageStub = sinon.stub().resolves();
    storeAppStateEventStub = sinon.stub().resolves();
    broadcastMessageToAllStub = sinon.stub().resolves('signed');
    nodeSignerStub = sinon.stub().resolves({ pubKey: '04', sign: () => 'sig' });
    installedAppsStub = sinon.stub().resolves({
      status: 'success',
      data: [{ name: 'app1', version: 4, compose: [{ name: 'c1', containerData: '/data' }] }],
    });
    listRunningAppsStub = sinon.stub().resolves({
      status: 'success',
      data: [{ Names: ['/fluxc1_app1'] }],
    });

    peerNotification = loadPeerNotification();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('checkAndNotifyPeersOfRunningApps', () => {
    it('should be exported as a function', () => {
      expect(peerNotification.checkAndNotifyPeersOfRunningApps).to.be.a('function');
    });

    it('triggers the hourly reconciler sweep', async () => {
      await peerNotification.checkAndNotifyPeersOfRunningApps();
      expect(enqueueAllStub.calledOnceWith('hourly')).to.be.true;
    });

    it('broadcasts a compose app whose components are all running', async () => {
      await peerNotification.checkAndNotifyPeersOfRunningApps();
      expect(storeAppRunningMessageStub.calledOnce).to.be.true;
      const [message] = storeAppRunningMessageStub.firstCall.args;
      expect(message.type).to.equal('fluxapprunning');
      expect(message.ip).to.equal('192.168.1.1:16127');
      expect(message.apps.map((a) => a.name)).to.deep.equal(['app1']);
      expect(storeAppStateEventStub.calledOnce, 'the announcement is recorded in the event log').to.be.true;
    });

    // The announcement is one fact recorded twice - the location table and the
    // event log peers sync from - and sent once. A node that cannot sign as
    // itself sends nothing a peer would accept, so it records nothing either:
    // its own view of where it runs is the network's view.
    it('records nothing and announces nothing when this node cannot sign as itself', async () => {
      nodeSignerStub.resolves(null);

      await peerNotification.checkAndNotifyPeersOfRunningApps();

      expect(storeAppRunningMessageStub.called, 'wrote its own location').to.be.false;
      expect(broadcastMessageToAllStub.called, 'sent an announcement').to.be.false;
      expect(storeAppStateEventStub.called, 'wrote the event log').to.be.false;
      expect(logStub.warn.calledWith(sinon.match('cannot sign'))).to.be.true;
    });

    it('does not broadcast a plain app with a stopped component', async () => {
      installedAppsStub.resolves({
        status: 'success',
        data: [
          { name: 'app1', version: 4, compose: [{ name: 'c1', containerData: '/data' }] },
          { name: 'app2', version: 4, compose: [{ name: 'c2', containerData: '/data' }] },
        ],
      });
      // only app1's container is running
      await peerNotification.checkAndNotifyPeersOfRunningApps();
      const [message] = storeAppRunningMessageStub.firstCall.args;
      expect(message.apps.map((a) => a.name)).to.deep.equal(['app1']);
    });

    // An empty snapshot must NEVER be broadcast: on the receive side an empty v2
    // message deletes every appsLocations row for the sender's IP - and the sender
    // stores its own message first, so it erases its own network presence. The
    // legitimate corrections all have targeted mechanisms (fluxappremoved on
    // uninstall, sigterm/TTL row expiry for wiped or dead nodes).
    it('never broadcasts an empty snapshot - reboot-race shape (installed apps, none running yet)', async () => {
      listRunningAppsStub.resolves({ status: 'success', data: [] }); // containers not started yet
      await peerNotification.checkAndNotifyPeersOfRunningApps(); // first run after boot
      expect(storeAppRunningMessageStub.called, 'must not store an empty snapshot (self-wipe)').to.be.false;
      expect(broadcastMessageToAllStub.called, 'must not broadcast an empty snapshot').to.be.false;
    });

    it('never broadcasts an empty snapshot - wiped-node shape (nothing installed)', async () => {
      installedAppsStub.resolves({ status: 'success', data: [] });
      listRunningAppsStub.resolves({ status: 'success', data: [] });
      await peerNotification.checkAndNotifyPeersOfRunningApps(); // first run after boot
      expect(storeAppRunningMessageStub.called, 'must not store an empty snapshot (self-wipe)').to.be.false;
      expect(broadcastMessageToAllStub.called, 'must not broadcast an empty snapshot').to.be.false;
    });

    // The first broadcast after boot races the reconciler's container starts; a
    // too-early snapshot misses apps whose rows then expire on the sigterm TTL.
    // Every broadcast waits for the reconciler's boot drain to settle (the gate
    // resolves immediately in steady state, and is capped reconciler-side so a
    // wedged reconcile cannot suppress network presence).
    it('waits for the reconciler boot drain before broadcasting', async () => {
      let openDrainGate;
      waitForBootDrainSettledStub.callsFake(() => new Promise((resolve) => { openDrainGate = resolve; }));

      const callPromise = peerNotification.checkAndNotifyPeersOfRunningApps();
      await new Promise((resolve) => { setImmediate(resolve); });
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(storeAppRunningMessageStub.called, 'must not snapshot/broadcast before the boot drain settles').to.be.false;
      expect(broadcastMessageToAllStub.called).to.be.false;

      openDrainGate();
      await callPromise;
      expect(broadcastMessageToAllStub.calledOnce, 'broadcast proceeds once the drain settles').to.be.true;
      const [message] = storeAppRunningMessageStub.firstCall.args;
      expect(message.apps.map((a) => a.name)).to.deep.equal(['app1']);
    });

    it('still broadcasts a g:/r: app with stopped components (derived from specs, not run-state)', async () => {
      // a masterSlave-managed app intentionally stops slave components, so the
      // broadcast set must come from the spec, not from container run-state
      installedAppsStub.resolves({
        status: 'success',
        data: [
          { name: 'app1', version: 4, compose: [{ name: 'c1', containerData: '/data' }] },
          { name: 'gapp', version: 4, compose: [{ name: 'gc', containerData: 'g:/data' }] },
          { name: 'rapp', version: 4, compose: [{ name: 'rc', containerData: 'r:/data' }] },
        ],
      });
      // neither gapp's nor rapp's containers are running
      await peerNotification.checkAndNotifyPeersOfRunningApps();
      const [message] = storeAppRunningMessageStub.firstCall.args;
      expect(message.apps.map((a) => a.name).sort()).to.deep.equal(['app1', 'gapp', 'rapp']);
    });
  });

  describe('the announcement period', () => {
    // A node writes its OWN location row when it announces, and that row expires
    // on a TTL. So the period is a contract: announce later than the row lives
    // and the node stops being a holder of its own apps. These drive a cycle of
    // a known length against a known interval and read the gap to the next
    // announcement.
    //
    // hrtime is faked alongside the timers because the schedule is measured
    // monotonically. Faking setTimeout alone leaves the elapsed reading real,
    // every cycle then measures as ~0ms, and all four of these pass against the
    // defect they exist to catch.
    let clock;

    // Only the cycles under measurement are slow. A rescheduled cycle that is
    // slow too reschedules at zero again, and tickAsync then drains an endless
    // chain of them rather than returning.
    const runOneCycle = async (opts) => {
      clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'hrtime'] });
      let cycles = 0;
      const listRunningApps = sinon.stub().callsFake(async () => {
        cycles += 1;
        if (opts.cycleMs && cycles <= (opts.slowCycles ?? 1)) clock.tick(opts.cycleMs);
        return { status: 'success', data: [{ Names: ['/fluxc1_app1'] }] };
      });
      const mod = loadPeerNotification({ ...opts, listRunningApps });
      await mod.checkAndNotifyPeersOfRunningApps();
      return mod;
    };

    afterEach(() => {
      clock?.restore();
      clock = null;
    });

    it('subtracts the time the cycle took from the wait for the next one', async () => {
      await runOneCycle({ peerNotifyIntervalMs: 30000, cycleMs: 20000 });
      const announced = broadcastMessageToAllStub.callCount;

      await clock.tickAsync(9999);
      expect(broadcastMessageToAllStub.callCount, 'announced before the interval was up').to.equal(announced);

      await clock.tickAsync(1);
      expect(
        broadcastMessageToAllStub.callCount,
        'the cycle time was added to the interval rather than subtracted from it',
      ).to.equal(announced + 1);
    });

    it('announces again immediately when a cycle outran its whole interval', async () => {
      await runOneCycle({ peerNotifyIntervalMs: 30000, cycleMs: 40000 });
      const announced = broadcastMessageToAllStub.callCount;

      // Clamped at zero rather than scheduled into the past.
      await clock.tickAsync(0);
      expect(broadcastMessageToAllStub.callCount).to.equal(announced + 1);
    });

    it('says a cycle no longer fits its interval once, not on every cycle', async () => {
      const mod = await runOneCycle({ peerNotifyIntervalMs: 30000, cycleMs: 40000, slowCycles: 2 });
      // Driven rather than left to the timer, so the second overrun is the only
      // thing between the two readings.
      await mod.checkAndNotifyPeersOfRunningApps();

      const said = logStub.warn.getCalls()
        .filter((call) => /announcing itself less often/.test(String(call.args[0])));
      expect(said, 'the overrun is reported on the transition, not per cycle').to.have.lengthOf(1);
    });

    it('refuses an interval longer than the row it keeps alive', async () => {
      // 60s expiry caps the interval at 30s however large the configured value.
      await runOneCycle({ peerNotifyIntervalMs: 3600000, runningExpiryMs: 60000 });
      const announced = broadcastMessageToAllStub.callCount;

      await clock.tickAsync(29999);
      expect(broadcastMessageToAllStub.callCount).to.equal(announced);

      await clock.tickAsync(1);
      expect(
        broadcastMessageToAllStub.callCount,
        'an interval longer than half the row expiry was accepted, so the row lapses between announcements',
      ).to.equal(announced + 1);
    });
  });

});
