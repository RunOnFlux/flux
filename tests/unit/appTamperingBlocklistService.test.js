const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appTamperingBlocklistService tests', () => {
  let service;
  let serviceHelperStub;
  let dbHelperStub;
  let fluxNetworkHelperStub;
  let generalServiceStub;
  let daemonMiscStub;
  let benchmarkServiceStub;

  const MOCK_TXHASH = 'abc123deadbeef';

  function loadService() {
    return proxyquire('../../ZelBack/src/services/appTamperingBlocklistService', {
      config: {
        database: {
          local: {
            database: 'zelfluxlocal',
            collections: { appTamperingEvents: 'apptamperingevents' },
          },
        },
        github: {
          rawBaseUrl: 'https://raw.githubusercontent.com/RunOnFlux/flux/master',
        },
      },
      '../lib/log': {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
      },
      './serviceHelper': serviceHelperStub,
      './dbHelper': dbHelperStub,
      './fluxNetworkHelper': fluxNetworkHelperStub,
      './generalService': generalServiceStub,
      './daemonService/daemonServiceMiscRpcs': daemonMiscStub,
      './benchmarkService': benchmarkServiceStub,
      './appTamperingDetectionService': {
        BOOT_STORM_DISCOUNT: 0.25,
        BOOT_STORM_DISCOUNT_TYPES: ['mount_vanished', 'volume_missing', 'network_pruned', 'recreation_failed'],
      },
    });
  }

  beforeEach(() => {
    serviceHelperStub = {
      axiosGet: sinon.stub(),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub().returns({
        db: sinon.stub().returns({ name: 'mockdb' }),
      }),
      aggregateInDatabase: sinon.stub().resolves([]),
    };

    fluxNetworkHelperStub = {
      setStickyDosMessage: sinon.stub(),
      setStickyDosStateValue: sinon.stub(),
      clearStickyDosMessage: sinon.stub(),
      getStickyDosMessage: sinon.stub().returns(null),
    };

    generalServiceStub = {
      obtainNodeCollateralInformation: sinon.stub().resolves({ txhash: MOCK_TXHASH, txindex: 0 }),
    };

    daemonMiscStub = {
      isDaemonSynced: sinon.stub().returns({ data: { synced: true } }),
    };

    // Default: non-Arcane node (bench says systemsecure=false).
    benchmarkServiceStub = {
      getBenchmarks: sinon.stub().resolves({ status: 'success', data: { systemsecure: false } }),
    };

    service = loadService();
  });

  afterEach(() => {
    sinon.restore();
  });

  // Helper: make the incident aggregation return n severity-1 incidents
  // outside any boot storm, i.e. a tamper score of exactly n.
  function setTamperScore(n) {
    const incidents = Array.from({ length: n }, () => ({
      eventType: 'mount_vanished', severity: 1, duringBootStorm: false,
    }));
    dbHelperStub.aggregateInDatabase = sinon.stub().resolves(incidents);
  }

  describe('fetchBlocklist', () => {
    it('fetches blocklist from URL', async () => {
      serviceHelperStub.axiosGet.resolves({ data: ['tx1', 'tx2'] });

      const result = await service.fetchBlocklist();

      expect(result).to.deep.equal(['tx1', 'tx2']);
      sinon.assert.calledOnce(serviceHelperStub.axiosGet);
    });

    it('returns [] on axios failure', async () => {
      serviceHelperStub.axiosGet.rejects(new Error('network timeout'));

      const result = await service.fetchBlocklist();

      expect(result).to.deep.equal([]);
    });

    it('returns [] when response shape is unexpected', async () => {
      serviceHelperStub.axiosGet.resolves({ data: { notAnArray: true } });

      const result = await service.fetchBlocklist();

      expect(result).to.deep.equal([]);
    });
  });

  describe('computeTamperScore', () => {
    it('scores only current-schema incident documents', async () => {
      setTamperScore(1);

      await service.computeTamperScore();

      const pipeline = dbHelperStub.aggregateInDatabase.firstCall.args[2];
      expect(pipeline[0]).to.deep.equal({ $match: { schemaVersion: { $gte: 1 } } });
    });

    it('sums stored severities across incidents', async () => {
      dbHelperStub.aggregateInDatabase = sinon.stub().resolves([
        { eventType: 'container_vanished', severity: 3, duringBootStorm: false },
        { eventType: 'network_pruned', severity: 1, duringBootStorm: false },
        { eventType: 'network_detached', severity: 1, duringBootStorm: false },
        { eventType: 'recreation_failed', severity: 0, duringBootStorm: false }, // operational
      ]);

      const result = await service.computeTamperScore();

      expect(result).to.equal(5);
    });

    it('discounts boot-race incidents flagged duringBootStorm', async () => {
      dbHelperStub.aggregateInDatabase = sinon.stub().resolves([
        { eventType: 'mount_vanished', severity: 1, duringBootStorm: true },
        { eventType: 'volume_missing', severity: 1, duringBootStorm: true },
        { eventType: 'container_vanished', severity: 3, duringBootStorm: false },
      ]);

      const result = await service.computeTamperScore();

      expect(result).to.equal(3.5); // 2 × (1 × 0.25) + 3
    });

    it('never discounts container_vanished, even inside the boot-storm window', async () => {
      // Containers persist as exited across a clean reboot, so a vanished
      // container is tamper signal regardless of the window — a reboot must
      // not buy kill-style tampering a discount.
      dbHelperStub.aggregateInDatabase = sinon.stub().resolves([
        { eventType: 'container_vanished', severity: 3, duringBootStorm: true },
      ]);

      const result = await service.computeTamperScore();

      expect(result).to.equal(3);
    });

    it('treats a missing severity as zero', async () => {
      dbHelperStub.aggregateInDatabase = sinon.stub().resolves([
        { eventType: 'mount_vanished', duringBootStorm: false },
      ]);

      const result = await service.computeTamperScore();

      expect(result).to.equal(0);
    });

    it('returns 0 when DB is unavailable', async () => {
      dbHelperStub.databaseConnection = sinon.stub().returns(null);

      const result = await service.computeTamperScore();

      expect(result).to.equal(0);
    });

    it('returns 0 on mongo errors', async () => {
      dbHelperStub.aggregateInDatabase = sinon.stub().rejects(new Error('mongo boom'));

      const result = await service.computeTamperScore();

      expect(result).to.equal(0);
    });
  });

  describe('getMyTxhash', () => {
    it('returns txhash from collateral info', async () => {
      const result = await service.getMyTxhash();

      expect(result).to.equal(MOCK_TXHASH);
    });

    it('returns null if collateral lookup throws', async () => {
      generalServiceStub.obtainNodeCollateralInformation = sinon.stub().rejects(new Error('no daemon'));

      const result = await service.getMyTxhash();

      expect(result).to.be.null;
    });

    it('returns null if collateral info lacks txhash', async () => {
      generalServiceStub.obtainNodeCollateralInformation = sinon.stub().resolves({});

      const result = await service.getMyTxhash();

      expect(result).to.be.null;
    });
  });

  describe('enforceBlocklist', () => {
    it('skips the tick when daemon is not synced', async () => {
      daemonMiscStub.isDaemonSynced = sinon.stub().returns({ data: { synced: false } });

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
      expect(fluxNetworkHelperStub.clearStickyDosMessage.called).to.be.false;
    });

    it('skips when own txhash cannot be determined', async () => {
      generalServiceStub.obtainNodeCollateralInformation = sinon.stub().resolves({});

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
      expect(fluxNetworkHelperStub.clearStickyDosMessage.called).to.be.false;
    });

    it('does nothing when txhash is not on the blocklist', async () => {
      serviceHelperStub.axiosGet.resolves({ data: ['otherhash'] });
      setTamperScore(100);

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
    });

    it('does nothing when listed but score <= threshold', async () => {
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setTamperScore(10); // threshold is >10, so exactly 10 should NOT trigger

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
    });

    it('sets sticky DOS when listed AND score > threshold', async () => {
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setTamperScore(11);

      await service.enforceBlocklist();

      sinon.assert.calledOnce(fluxNetworkHelperStub.setStickyDosMessage);
      const msg = fluxNetworkHelperStub.setStickyDosMessage.firstCall.args[0];
      expect(msg).to.include(service.DOS_MESSAGE_PREFIX);
      expect(msg).to.include(MOCK_TXHASH);
      expect(msg).to.include('11');
      sinon.assert.calledWith(fluxNetworkHelperStub.setStickyDosStateValue, 100);
      expect(service.isDosActive()).to.be.true;
    });

    it('clears sticky DOS on next tick when condition no longer holds', async () => {
      // First tick: set DOS
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setTamperScore(15);
      await service.enforceBlocklist();
      expect(service.isDosActive()).to.be.true;

      // Second tick: txhash removed from list
      serviceHelperStub.axiosGet.resolves({ data: [] });
      await service.enforceBlocklist();

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.be.false;
    });

    it('clears sticky DOS when the score drops to <= threshold', async () => {
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setTamperScore(15);
      await service.enforceBlocklist();
      expect(service.isDosActive()).to.be.true;

      setTamperScore(5);
      await service.enforceBlocklist();

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.be.false;
    });

    it('clears an orphaned sticky DOS message owned by this service', async () => {
      // ourDosActive is false, but sticky owned by us (prefix match) from prior run
      const ours = `${service.DOS_MESSAGE_PREFIX}: tamper score 42, txhash xyz`;
      fluxNetworkHelperStub.getStickyDosMessage = sinon.stub().returns(ours);
      serviceHelperStub.axiosGet.resolves({ data: [] });
      setTamperScore(0);

      await service.enforceBlocklist();

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDosMessage);
    });

    it('does NOT clear a sticky DOS set by a different module', async () => {
      // Some other module set sticky for an unrelated reason
      fluxNetworkHelperStub.getStickyDosMessage = sinon.stub().returns('some other module sticky reason');
      serviceHelperStub.axiosGet.resolves({ data: [] });
      setTamperScore(0);

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.clearStickyDosMessage.called).to.be.false;
    });
  });

  describe('start/stop cancellation', () => {
    it('start() aborts without scheduling an interval if stop() is called during daemon-sync wait', async () => {
      // Daemon never reports synced
      daemonMiscStub.isDaemonSynced = sinon.stub().returns({ data: { synced: false } });
      const setIntervalSpy = sinon.spy(global, 'setInterval');

      // Kick off start() — it will enter waitForDaemonSynced and poll
      const startPromise = service.start();

      // Give the loop a tick to enter the polling wait, then stop
      await new Promise((resolve) => setImmediate(resolve));
      service.stop();

      // Now make daemon report synced so a buggy implementation would proceed
      daemonMiscStub.isDaemonSynced = sinon.stub().returns({ data: { synced: true } });
      await startPromise;

      const twelveH = 12 * 60 * 60 * 1000;
      const scheduled12h = setIntervalSpy.getCalls().some((c) => c.args[1] === twelveH);
      expect(scheduled12h).to.be.false;
    });

    it('stop() clears the interval after it has been installed', async () => {
      // Daemon synced immediately so start() completes quickly
      await service.start();
      // Now interval should be set — stop and assert clearInterval ran
      const clearSpy = sinon.spy(global, 'clearInterval');

      service.stop();

      sinon.assert.called(clearSpy);
    });
  });

  describe('ArcaneOS gating (via fluxbenchd)', () => {
    function makeArcaneService() {
      benchmarkServiceStub.getBenchmarks = sinon.stub().resolves({
        status: 'success',
        data: { systemsecure: true },
      });
      return loadService();
    }

    it('enforceBlocklist is a no-op when bench reports systemsecure=true', async () => {
      const arcaneService = makeArcaneService();
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setTamperScore(100);

      await arcaneService.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
      expect(fluxNetworkHelperStub.setStickyDosStateValue.called).to.be.false;
      expect(arcaneService.isDosActive()).to.be.false;
    });

    it('enforceBlocklist does not read blocklist or count events when ArcaneOS', async () => {
      const arcaneService = makeArcaneService();

      await arcaneService.enforceBlocklist();

      expect(serviceHelperStub.axiosGet.called).to.be.false;
      expect(generalServiceStub.obtainNodeCollateralInformation.called).to.be.false;
    });

    it('start() does not install the interval when ArcaneOS', async () => {
      const arcaneService = makeArcaneService();
      const setIntervalSpy = sinon.spy(global, 'setInterval');

      await arcaneService.start();

      const twelveH = 12 * 60 * 60 * 1000;
      const calledWith12h = setIntervalSpy.getCalls().some((c) => c.args[1] === twelveH);
      expect(calledWith12h).to.be.false;
    });

    it('enforceBlocklist skips tick when fluxbenchd is unreachable (errors)', async () => {
      benchmarkServiceStub.getBenchmarks = sinon.stub().rejects(new Error('bench down'));
      const svc = loadService();
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setTamperScore(100);

      await svc.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
      expect(serviceHelperStub.axiosGet.called).to.be.false;
    });

    it('enforceBlocklist skips tick when fluxbenchd returns status=error', async () => {
      benchmarkServiceStub.getBenchmarks = sinon.stub().resolves({ status: 'error' });
      const svc = loadService();
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setTamperScore(100);

      await svc.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
      expect(serviceHelperStub.axiosGet.called).to.be.false;
    });

    it('enforceBlocklist skips tick when systemsecure is not a boolean', async () => {
      benchmarkServiceStub.getBenchmarks = sinon.stub().resolves({
        status: 'success',
        data: { systemsecure: null },
      });
      const svc = loadService();
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setTamperScore(100);

      await svc.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
    });

    it('FLUXOS_PATH env var alone does not skip enforcement (spoof guard)', async () => {
      // Simulate a legacy operator trying to bypass by setting FLUXOS_PATH.
      // Benchmark must be the source of truth.
      const originalFluxOSPath = process.env.FLUXOS_PATH;
      process.env.FLUXOS_PATH = '/fake/arcane/path';
      try {
        serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
        setTamperScore(100);
        const svc = loadService();

        await svc.enforceBlocklist();

        sinon.assert.calledOnce(fluxNetworkHelperStub.setStickyDosMessage);
      } finally {
        if (originalFluxOSPath !== undefined) process.env.FLUXOS_PATH = originalFluxOSPath;
        else delete process.env.FLUXOS_PATH;
      }
    });
  });
});
