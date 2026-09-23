const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { makeStickyDosDouble } = require('./stickyDosTestDouble');
const { StickyDosOwner } = require('../../ZelBack/src/services/fluxNetworkHelper');

describe('appTamperingBlocklistService tests', () => {
  const OWNER = StickyDosOwner.APP_TAMPERING;
  const RESIDENTIAL = StickyDosOwner.RESIDENTIAL_DOS;
  const RESIDENTIAL_REASON = 'Residential node not running ArcaneOS';
  let service;
  let dbHelperStub;
  let fluxNetworkHelperStub;
  let generalServiceStub;
  let daemonMiscStub;
  let benchmarkServiceStub;

  const MOCK_TXHASH = 'abc123deadbeef';

  // The blocklist arrives in the signed policy bundle now. getDocument answering null is
  // what "could not read it" looks like, and the service treats that as a reason to skip a
  // tick rather than as nobody being blocked.
  const policyStoreStub = { getDocument: sinon.stub().returns(null) };

  function loadService() {
    return proxyquire('../../ZelBack/src/services/appTamperingBlocklistService', {
      config: {
        database: {
          local: {
            database: 'zelfluxlocal',
            collections: { appTamperingEvents: 'apptamperingevents' },
          },
        },
        policy: {
          baseUrl: 'https://raw.githubusercontent.com/RunOnFlux/fluxos-network-policy/main',
        },
      },
      '../lib/log': {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
      },
      './policyStore': policyStoreStub,
      './dbHelper': dbHelperStub,
      './fluxNetworkHelper': fluxNetworkHelperStub,
      './generalService': generalServiceStub,
      './daemonService/daemonServiceMiscRpcs': daemonMiscStub,
      './benchmarkService': benchmarkServiceStub,
    });
  }

  beforeEach(() => {
    // Recreated, not restored: sinon.restore() does not reset an anonymous stub, so a
    // withArgs from one test would otherwise answer in the next.
    policyStoreStub.getDocument = sinon.stub().returns(null);
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({
        db: sinon.stub().returns({ name: 'mockdb' }),
      }),
      aggregateInDatabase: sinon.stub().resolves([]),
    };

    // Stateful on purpose: the real fluxNetworkHelper reads back the message it
    // was given, and every ownership rule in this service is written against
    // that read-back. A getter pinned to null would let a clear that must not
    // happen pass as if it had.
    fluxNetworkHelperStub = makeStickyDosDouble();

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

  // Helper: make the incident aggregation return n severity-1 incidents,
  // i.e. a tamper score of exactly n.
  function setTamperScore(n) {
    const incidents = Array.from({ length: n }, () => ({
      eventType: 'mount_vanished', severity: 1,
    }));
    dbHelperStub.aggregateInDatabase = sinon.stub().resolves(incidents);
  }

  describe('fetchBlocklist', () => {
    it('reads the blocklist the signed bundle carries', async () => {
      policyStoreStub.getDocument.withArgs('tamperingblockednodes').returns(['tx1', 'tx2']);

      expect(await service.fetchBlocklist()).to.deep.equal(['tx1', 'tx2']);
    });

    it('returns null when the policy has not been obtained - that is not an empty list', async () => {
      policyStoreStub.getDocument.returns(null);

      expect(await service.fetchBlocklist()).to.equal(null);
    });

    it('returns null when the signed document is not an array', async () => {
      // A signature says who published a document, not that it is the shape this expects.
      policyStoreStub.getDocument.returns({ notAnArray: true });

      expect(await service.fetchBlocklist()).to.equal(null);
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
        { eventType: 'container_vanished', severity: 3 },
        { eventType: 'network_pruned', severity: 1 },
        { eventType: 'network_detached', severity: 1 },
        { eventType: 'recreation_failed', severity: 0 }, // operational
      ]);

      const result = await service.computeTamperScore();

      expect(result).to.equal(5);
    });

    it('scores full weight regardless of stored duringBootStorm flags', async () => {
      // Stored incidents may carry a duringBootStorm flag; it is inert —
      // severities always sum in full.
      dbHelperStub.aggregateInDatabase = sinon.stub().resolves([
        { eventType: 'mount_vanished', severity: 1, duringBootStorm: true },
        { eventType: 'container_vanished', severity: 3, duringBootStorm: true },
      ]);

      const result = await service.computeTamperScore();

      expect(result).to.equal(4);
    });

    it('treats a missing severity as zero', async () => {
      dbHelperStub.aggregateInDatabase = sinon.stub().resolves([
        { eventType: 'mount_vanished' },
      ]);

      const result = await service.computeTamperScore();

      expect(result).to.equal(0);
    });

    // null, never 0: a score that could not be read must not read as
    // "no incidents" and clear an active DOS
    it('returns null when DB is unavailable', async () => {
      dbHelperStub.databaseConnection = sinon.stub().returns(null);

      const result = await service.computeTamperScore();

      expect(result).to.equal(null);
    });

    it('returns null on mongo errors', async () => {
      dbHelperStub.aggregateInDatabase = sinon.stub().rejects(new Error('mongo boom'));

      const result = await service.computeTamperScore();

      expect(result).to.equal(null);
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

      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
      expect(fluxNetworkHelperStub.clearStickyDos.called).to.be.false;
    });

    it('skips when own txhash cannot be determined', async () => {
      generalServiceStub.obtainNodeCollateralInformation = sinon.stub().resolves({});

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
      expect(fluxNetworkHelperStub.clearStickyDos.called).to.be.false;
    });

    it('keeps an active DOS when the blocklist cannot be fetched', async () => {
      // an unreadable blocklist is not an empty one: falling through would
      // take the clear branch and a github outage would undo enforcement
      policyStoreStub.getDocument.returns(null); // could not read the policy;
      fluxNetworkHelperStub.getStickyDosMessage = sinon.stub().returns(
        `Node flagged via tampering blocklist: tamper score 99, txhash ${MOCK_TXHASH}`,
      );
      setTamperScore(100);

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.clearStickyDos.called).to.be.false;
      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
    });

    it('does nothing when txhash is not on the blocklist', async () => {
      policyStoreStub.getDocument.returns(['otherhash']);
      setTamperScore(100);

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
    });

    it('does nothing when listed but score <= threshold', async () => {
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(10); // threshold is >10, so exactly 10 should NOT trigger

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
    });

    it('skips the tick when the score cannot be read, leaving an active DOS in place', async () => {
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      dbHelperStub.databaseConnection = sinon.stub().returns(null);

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.clearStickyDos.called).to.be.false;
      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
    });

    it('sets sticky DOS when listed AND score > threshold', async () => {
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(11);

      await service.enforceBlocklist();

      sinon.assert.calledOnce(fluxNetworkHelperStub.setStickyDos);
      const msg = fluxNetworkHelperStub.setStickyDos.firstCall.args[1];
      expect(msg).to.include(service.DOS_MESSAGE_PREFIX);
      expect(msg).to.include(MOCK_TXHASH);
      expect(msg).to.include('11');
      expect(service.isDosActive()).to.be.true;
    });

    it('clears sticky DOS on next tick when condition no longer holds', async () => {
      // First tick: set DOS
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(15);
      await service.enforceBlocklist();
      expect(service.isDosActive()).to.be.true;

      // Second tick: txhash removed from list
      policyStoreStub.getDocument.returns([]);
      await service.enforceBlocklist();

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDos);
      expect(service.isDosActive()).to.be.false;
    });

    it('clears sticky DOS when the score drops to <= threshold', async () => {
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(15);
      await service.enforceBlocklist();
      expect(service.isDosActive()).to.be.true;

      setTamperScore(5);
      await service.enforceBlocklist();

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDos);
      expect(service.isDosActive()).to.be.false;
    });

    it('clears a verdict of its own left standing by an earlier run', async () => {
      const ours = `${service.DOS_MESSAGE_PREFIX}: tamper score 42, txhash xyz`;
      fluxNetworkHelperStub.holds.set(OWNER, ours);
      policyStoreStub.getDocument.returns([]);
      setTamperScore(0);

      await service.enforceBlocklist();

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDos);
    });

    it("releases its own verdict and leaves another owner's standing", async () => {
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(15);
      await service.enforceBlocklist();
      expect(service.isDosActive()).to.be.true;
      fluxNetworkHelperStub.holds.set(RESIDENTIAL, RESIDENTIAL_REASON);

      // ...and our own condition stops holding.
      policyStoreStub.getDocument.returns([]);
      await service.enforceBlocklist();

      expect(service.isDosActive()).to.be.false;
      expect(fluxNetworkHelperStub.getStickyDosMessage(), "dropped another owner's DOS on the floor").to.equal(RESIDENTIAL_REASON);
    });

    // Enforcement runs every 12 hours. A verdict that waited for another owner
    // to let go of a shared slot left a node this build has determined should be
    // out of service taking apps until the next tick.
    it("records its verdict beside another owner's, without waiting for it", async () => {
      fluxNetworkHelperStub.holds.set(RESIDENTIAL, RESIDENTIAL_REASON);
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(15);

      await service.enforceBlocklist();

      expect(service.isDosActive()).to.be.true;
      const message = fluxNetworkHelperStub.getStickyDosMessage();
      expect(message, 'overwrote a verdict it does not own').to.contain('Residential');
      expect(message).to.contain('tamper score 15');
    });

    it('refreshes its own verdict rather than treating it as foreign', async () => {
      fluxNetworkHelperStub.holds.set(OWNER, `${service.DOS_MESSAGE_PREFIX}: tamper score 42, txhash xyz`);
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(15);

      await service.enforceBlocklist();

      sinon.assert.calledOnce(fluxNetworkHelperStub.setStickyDos);
      expect(fluxNetworkHelperStub.getStickyDosMessage()).to.contain('tamper score 15');
    });




    it('does NOT clear a verdict set by a different owner', async () => {
      fluxNetworkHelperStub.holds.set(RESIDENTIAL, RESIDENTIAL_REASON);
      policyStoreStub.getDocument.returns([]);
      setTamperScore(0);

      await service.enforceBlocklist();

      expect(fluxNetworkHelperStub.clearStickyDos.called).to.be.false;
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
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(100);

      await arcaneService.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
      expect(arcaneService.isDosActive()).to.be.false;
    });

    it('enforceBlocklist does not read blocklist or count events when ArcaneOS', async () => {
      const arcaneService = makeArcaneService();

      await arcaneService.enforceBlocklist();

      expect(policyStoreStub.getDocument.called).to.be.false;
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
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(100);

      await svc.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
      expect(policyStoreStub.getDocument.called).to.be.false;
    });

    it('enforceBlocklist skips tick when fluxbenchd returns status=error', async () => {
      benchmarkServiceStub.getBenchmarks = sinon.stub().resolves({ status: 'error' });
      const svc = loadService();
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(100);

      await svc.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
      expect(policyStoreStub.getDocument.called).to.be.false;
    });

    it('enforceBlocklist skips tick when systemsecure is not a boolean', async () => {
      benchmarkServiceStub.getBenchmarks = sinon.stub().resolves({
        status: 'success',
        data: { systemsecure: null },
      });
      const svc = loadService();
      policyStoreStub.getDocument.returns([MOCK_TXHASH]);
      setTamperScore(100);

      await svc.enforceBlocklist();

      expect(fluxNetworkHelperStub.setStickyDos.called).to.be.false;
    });

    it('FLUXOS_PATH env var alone does not skip enforcement (spoof guard)', async () => {
      // Simulate a legacy operator trying to bypass by setting FLUXOS_PATH.
      // Benchmark must be the source of truth.
      const originalFluxOSPath = process.env.FLUXOS_PATH;
      process.env.FLUXOS_PATH = '/fake/arcane/path';
      try {
        policyStoreStub.getDocument.returns([MOCK_TXHASH]);
        setTamperScore(100);
        const svc = loadService();

        await svc.enforceBlocklist();

        sinon.assert.calledOnce(fluxNetworkHelperStub.setStickyDos);
      } finally {
        if (originalFluxOSPath !== undefined) process.env.FLUXOS_PATH = originalFluxOSPath;
        else delete process.env.FLUXOS_PATH;
      }
    });
  });
});
