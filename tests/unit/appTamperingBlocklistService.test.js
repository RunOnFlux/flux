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
  let cacheStore;
  let cacheStub;

  const MOCK_TXHASH = 'abc123deadbeef';
  let originalFluxOSPath;

  function loadService() {
    return proxyquire('../../ZelBack/src/services/appTamperingBlocklistService', {
      config: {
        database: {
          local: {
            database: 'zelfluxlocal',
            collections: { appTamperingEvents: 'apptamperingevents' },
          },
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
      './utils/cacheManager': { default: cacheStub },
    });
  }

  beforeEach(() => {
    originalFluxOSPath = process.env.FLUXOS_PATH;
    delete process.env.FLUXOS_PATH; // default: non-Arcane
    cacheStore = new Map();
    cacheStub = {
      tamperingBlocklistCache: {
        get: (k) => cacheStore.get(k),
        set: (k, v) => cacheStore.set(k, v),
        clear: () => cacheStore.clear(),
      },
    };

    serviceHelperStub = {
      axiosGet: sinon.stub(),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub().returns({
        db: sinon.stub().returns({
          collection: sinon.stub().returns({
            countDocuments: sinon.stub().resolves(0),
          }),
        }),
      }),
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

    service = loadService();
  });

  afterEach(() => {
    sinon.restore();
    if (originalFluxOSPath !== undefined) {
      process.env.FLUXOS_PATH = originalFluxOSPath;
    } else {
      delete process.env.FLUXOS_PATH;
    }
  });

  // Helper: set documents returned by the mongo countDocuments stub
  function setEventCount(n) {
    dbHelperStub.databaseConnection = sinon.stub().returns({
      db: sinon.stub().returns({
        collection: sinon.stub().returns({
          countDocuments: sinon.stub().resolves(n),
        }),
      }),
    });
  }

  describe('fetchBlocklist', () => {
    it('returns cached value when present', async () => {
      cacheStore.set('tamperingBlocklist', ['cached']);

      const result = await service.fetchBlocklist();

      expect(result).to.deep.equal(['cached']);
      expect(serviceHelperStub.axiosGet.called).to.be.false;
    });

    it('fetches and caches when cache is empty', async () => {
      serviceHelperStub.axiosGet.resolves({ data: ['tx1', 'tx2'] });

      const result = await service.fetchBlocklist();

      expect(result).to.deep.equal(['tx1', 'tx2']);
      expect(cacheStore.get('tamperingBlocklist')).to.deep.equal(['tx1', 'tx2']);
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

  describe('countTamperingEvents', () => {
    it('returns the count from mongo', async () => {
      setEventCount(42);

      const result = await service.countTamperingEvents();

      expect(result).to.equal(42);
    });

    it('returns 0 when DB is unavailable', async () => {
      dbHelperStub.databaseConnection = sinon.stub().returns(null);

      const result = await service.countTamperingEvents();

      expect(result).to.equal(0);
    });

    it('returns 0 on mongo errors', async () => {
      dbHelperStub.databaseConnection = sinon.stub().returns({
        db: sinon.stub().returns({
          collection: sinon.stub().returns({
            countDocuments: sinon.stub().rejects(new Error('mongo boom')),
          }),
        }),
      });

      const result = await service.countTamperingEvents();

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
      setEventCount(100);

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
    });

    it('does nothing when listed but events <= threshold', async () => {
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setEventCount(10); // threshold is >10, so exactly 10 should NOT trigger

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
    });

    it('sets sticky DOS when listed AND events > threshold', async () => {
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setEventCount(11);

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
      setEventCount(15);
      await service.enforceBlocklist();
      expect(service.isDosActive()).to.be.true;

      // Second tick: txhash removed from list
      cacheStore.clear();
      serviceHelperStub.axiosGet.resolves({ data: [] });
      await service.enforceBlocklist();

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.be.false;
    });

    it('clears sticky DOS when events drop to <= threshold', async () => {
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setEventCount(15);
      await service.enforceBlocklist();
      expect(service.isDosActive()).to.be.true;

      setEventCount(5);
      await service.enforceBlocklist();

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.be.false;
    });

    it('clears an orphaned sticky DOS message owned by this service', async () => {
      // ourDosActive is false, but sticky owned by us (prefix match) from prior run
      const ours = `${service.DOS_MESSAGE_PREFIX}: 42 events, txhash xyz`;
      fluxNetworkHelperStub.getStickyDosMessage = sinon.stub().returns(ours);
      serviceHelperStub.axiosGet.resolves({ data: [] });
      setEventCount(0);

      await service.enforceBlocklist();

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDosMessage);
    });

    it('does NOT clear a sticky DOS set by a different module', async () => {
      // Some other module set sticky for an unrelated reason
      fluxNetworkHelperStub.getStickyDosMessage = sinon.stub().returns('some other module sticky reason');
      serviceHelperStub.axiosGet.resolves({ data: [] });
      setEventCount(0);

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

  describe('ArcaneOS gating', () => {
    it('enforceBlocklist is a no-op on ArcaneOS even when listed with many events', async () => {
      process.env.FLUXOS_PATH = '/opt/fluxos';
      const arcaneService = loadService();
      serviceHelperStub.axiosGet.resolves({ data: [MOCK_TXHASH] });
      setEventCount(100);

      await arcaneService.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDosMessage.called).to.be.false;
      expect(fluxNetworkHelperStub.setStickyDosStateValue.called).to.be.false;
      expect(arcaneService.isDosActive()).to.be.false;
    });

    it('enforceBlocklist does not read blocklist or count events on ArcaneOS', async () => {
      process.env.FLUXOS_PATH = '/opt/fluxos';
      const arcaneService = loadService();

      await arcaneService.enforceBlocklist();

      expect(serviceHelperStub.axiosGet.called).to.be.false;
      expect(generalServiceStub.obtainNodeCollateralInformation.called).to.be.false;
    });

    it('start() does not install the interval on ArcaneOS', async () => {
      process.env.FLUXOS_PATH = '/opt/fluxos';
      const arcaneService = loadService();
      const setIntervalSpy = sinon.spy(global, 'setInterval');

      await arcaneService.start();

      // No interval installed for the enforcer. (Other code may call setInterval,
      // but we assert no call targets CHECK_INTERVAL_MS = 12h.)
      const twelveH = 12 * 60 * 60 * 1000;
      const calledWith12h = setIntervalSpy.getCalls().some((c) => c.args[1] === twelveH);
      expect(calledWith12h).to.be.false;
    });
  });
});
