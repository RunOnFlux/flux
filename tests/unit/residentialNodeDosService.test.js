const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('node:events');
const proxyquire = require('proxyquire').noCallThru();

const { EVENTS: SYNC_EVENTS } = require('../../ZelBack/src/services/utils/appSyncEvents');

const { CLASSIFICATION } = require('../../ZelBack/src/services/utils/networkClassifier');

describe('residentialNodeDosService tests', () => {
  let service;
  let fluxNetworkHelperStub;
  let geolocationServiceStub;
  let benchmarkServiceStub;
  let dbHelperStub;
  let markerStore;
  let globalStateStub;
  let deps;
  let installedApps;

  const LOCAL = '1.2.3.4:16127';
  let fluxEventBusStub;

  // A node that has WATCHED the verdict hold for the whole window. The gate
  // counts observed time, not elapsed time, so seeding a start timestamp alone
  // no longer serves the window - which is the defect these tests used to
  // encode: two evaluations 24h apart, with a day of silence between them,
  // satisfied a check meant to prove the verdict held throughout.
  function windowServed(now = Date.now()) {
    return {
      _id: 'residentialDos',
      residentialSince: now - service.SETTLE_MS - 1000,
      lastConfirmedAt: now,
      observedMs: service.SETTLE_MS + 1000,
    };
  }

  // The harness's only way to see a tick that decided NOT to enforce: that
  // outcome sets no hold, writes no marker and raises no DOS, so without this
  // event a suite can only sleep and infer it from nothing having happened.
  function decisions() {
    return fluxEventBusStub.publish.getCalls()
      .filter((c) => c.args[0] === 'residential:decided')
      .map((c) => c.args[1]);
  }

  function loadService() {
    return proxyquire('../../ZelBack/src/services/residentialNodeDosService', {
      '../lib/log': {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
      },
      './dbHelper': dbHelperStub,
      './fluxNetworkHelper': fluxNetworkHelperStub,
      './geolocationService': geolocationServiceStub,
      './benchmarkService': benchmarkServiceStub,
      './utils/globalState': globalStateStub,
      // A private emitter per load. The service registers its readiness
      // listeners at module top level - deliberately, so the listener exists
      // before SPAWNER_READY can fire, which appSpawner's registration inside
      // initialize() cannot guarantee - and never removes them. That is right
      // for a module required once, and wrong for a test that reloads it forty
      // times onto the SHARED emitter: eighty listeners, a
      // MaxListenersExceededWarning, and every one of them still live. It is
      // not inert either, because appSpawner.test.js emits SPAWNER_READY on
      // that same emitter and mocha runs both files in one process, so those
      // dead instances take readiness from another file's test.
      './utils/appSyncEvents': { appSyncEvents: new EventEmitter(), EVENTS: SYNC_EVENTS },
      './utils/fluxEventBus': fluxEventBusStub,
    });
  }

  beforeEach(() => {
    // Stateful on purpose: the real fluxNetworkHelper reads back the message it
    // was given, and the ownership rules here are all written against that
    // read-back. A getter pinned to null would let a clear that must not happen
    // pass as if it had.
    let sticky = null;
    let hold = null;
    fluxNetworkHelperStub = {
      setStickyDosMessage: sinon.stub().callsFake((msg) => { sticky = msg; }),
      setStickyDosStateValue: sinon.stub(),
      clearStickyDosMessage: sinon.stub().callsFake(() => { sticky = null; }),
      getStickyDosMessage: sinon.stub().callsFake(() => sticky),
      setPlacementHold: sinon.stub().callsFake((reason) => { hold = reason; }),
      clearPlacementHold: sinon.stub().callsFake(() => { hold = null; }),
      getPlacementHold: sinon.stub().callsFake(() => hold),
      isPlacementHeld: sinon.stub().callsFake(() => hold !== null),
      getLocalSocketAddress: sinon.stub().resolves(LOCAL),
    };

    // Default: a settled RESIDENTIAL verdict.
    geolocationServiceStub = {
      getNodeGeolocation: sinon.stub().resolves({ ip: '1.2.3.4' }),
      getNetworkClassification: sinon.stub().returns({
        classification: CLASSIFICATION.RESIDENTIAL,
        evidenceFor: ['ptr access-network: dsl.example.net'],
        evidenceAgainst: [],
      }),
    };

    // Default: bench reachable, node is NOT ArcaneOS.
    benchmarkServiceStub = {
      getBenchmarks: sinon.stub().resolves({ status: 'success', data: { systemsecure: false } }),
    };

    // An install in flight is real before its database record exists, so the
    // empty check reads this rather than trusting an ordering in another file.
    fluxEventBusStub = { publish: sinon.stub() };
    globalStateStub = { installationInProgress: false, removalInProgress: false };

    // The settle marker lives in mongo, so the double has to remember it across
    // a reload - surviving a restart is the whole point of that field.
    markerStore = new Map();
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
      findOneInDatabase: sinon.stub().callsFake(async (db, coll, query) => markerStore.get(query._id) || null),
      findOneAndUpdateInDatabase: sinon.stub().callsFake(async (db, coll, query, update) => {
        markerStore.set(query._id, { _id: query._id, ...(markerStore.get(query._id) || {}), ...update.$set });
      }),
      findOneAndDeleteInDatabase: sinon.stub().callsFake(async (db, coll, query) => {
        markerStore.delete(query._id);
      }),
    };

    installedApps = [];
    deps = {
      installedAppsFn: sinon.stub().callsFake(async () => ({ status: 'success', data: installedApps })),
    };

    service = loadService();
    service.setNodeReadyForTests(true);
  });

  afterEach(() => {
    service.stop();
    sinon.restore();
  });

  describe('isArcaneOs', () => {
    it('returns true when bench reports systemsecure true', async () => {
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'success', data: { systemsecure: true } });

      expect(await service.isArcaneOs()).to.equal(true);
    });

    it('returns false when bench reports systemsecure false', async () => {
      expect(await service.isArcaneOs()).to.equal(false);
    });

    it('returns null when bench errors, so an outage never DOSes a real ArcaneOS node', async () => {
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'error', data: 'benchd down' });

      expect(await service.isArcaneOs()).to.equal(null);
    });

    it('returns null when systemsecure is not a boolean', async () => {
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'success', data: { systemsecure: null } });

      expect(await service.isArcaneOs()).to.equal(null);
    });
  });

  describe('isResidential reads one settled verdict', () => {
    it('is true only on RESIDENTIAL', async () => {
      expect(await service.isResidential()).to.equal(true);
    });

    it('is false on DATACENTER', async () => {
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });

      expect(await service.isResidential()).to.equal(false);
    });

    it('is null on CONFLICTED, which must never be enforced against', async () => {
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.CONFLICTED });

      expect(await service.isResidential()).to.equal(null);
    });

    it('is null on UNKNOWN, which must never be enforced against', async () => {
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.UNKNOWN });

      expect(await service.isResidential()).to.equal(null);
    });

    it('is null when no verdict has been reached at all', async () => {
      geolocationServiceStub.getNetworkClassification.returns(null);

      expect(await service.isResidential()).to.equal(null);
    });
  });

  describe('the placement hold', () => {
    it('goes on immediately, with no settling period', async () => {
      installedApps = [{ name: 'someapp' }];

      await service.enforceResidentialPolicy(deps);

      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(true);
      expect(fluxNetworkHelperStub.getPlacementHold()).to.equal(service.HOLD_REASON);
    });

    it('never sets a DOS on a node that still holds apps', async () => {
      installedApps = [{ name: 'someapp' }];

      await service.enforceResidentialPolicy(deps);

      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosStateValue);
    });

    it('lifts when the node is no longer residential', async () => {
      installedApps = [{ name: 'someapp' }];
      await service.enforceResidentialPolicy(deps);
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });

      await service.enforceResidentialPolicy(deps);

      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(false);
    });

    it('lifts when the node migrates to ArcaneOS', async () => {
      installedApps = [{ name: 'someapp' }];
      await service.enforceResidentialPolicy(deps);
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'success', data: { systemsecure: true } });

      await service.enforceResidentialPolicy(deps);

      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(false);
    });
  });

  describe('an unreadable input decides nothing', () => {
    it('does not hold or DOS when bench cannot be read', async () => {
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'error', data: 'down' });

      const decided = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(false);
      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosStateValue);
    });

    it('does not hold or DOS when there is no settled classification', async () => {
      geolocationServiceStub.getNetworkClassification.returns(null);

      const decided = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(false);
    });
  });

  describe('every tick publishes what it concluded', () => {
    it('says enforce=false when the node is fit to serve', async () => {
      geolocationServiceStub.getNetworkClassification.returns({ classification: 'DATACENTER' });

      await service.enforceResidentialPolicy(deps);

      expect(decisions()).to.have.lengthOf(1);
      expect(decisions()[0]).to.include({ enforce: false, residential: false, undecidedBecause: null });
    });

    it('says enforce=true when it is not', async () => {
      await service.enforceResidentialPolicy(deps);

      expect(decisions()[0]).to.include({ enforce: true, residential: true, undecidedBecause: null });
    });

    it('separates a tick that could not decide from one that decided no', async () => {
      // null and false are opposite claims: one says nobody knows yet, the
      // other says this node is fit to serve. A consumer that reads them the
      // same way treats an unreadable benchmark as an all-clear.
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'error', data: 'down' });

      await service.enforceResidentialPolicy(deps);

      expect(decisions()[0]).to.include({ enforce: null, undecidedBecause: 'benchmark' });
    });

    it('carries the verdict, so a veto is not read as an unread table', async () => {
      // Both come back enforce: null. CONFLICTED from a node declining a
      // published verdict about its own address is a decision; a null
      // classification is the absence of one, and a consumer that cannot
      // separate them learns nothing from either.
      geolocationServiceStub.getNetworkClassification.returns({
        classification: 'CONFLICTED', source: 'node-veto',
      });

      await service.enforceResidentialPolicy(deps);

      expect(decisions()[0]).to.include({
        enforce: null, classification: 'CONFLICTED', source: 'node-veto',
      });
    });

    it('names the classification when that is the missing input', async () => {
      geolocationServiceStub.getNetworkClassification.returns(null);

      await service.enforceResidentialPolicy(deps);

      expect(decisions()[0]).to.include({ enforce: null, undecidedBecause: 'classification' });
    });
  });

  describe('the DOS is only ever set on a confirmed empty node', () => {
    it('goes on at once when the node holds no apps', async () => {
      installedApps = [];

      await service.enforceResidentialPolicy(deps);

      sinon.assert.calledWith(fluxNetworkHelperStub.setStickyDosStateValue, 100);
      expect(service.isDosActive()).to.equal(true);
    });

    it('needs no settling period to do so', async () => {
      installedApps = [];

      await service.enforceResidentialPolicy(deps);

      // An empty node never enters the window at all.
      expect(markerStore.size).to.equal(0);
    });

    it('is NOT set when the installed-app list cannot be read', async () => {
      // Reading "could not ask" as "holds nothing" would set DOS >= 100 on a
      // node that has apps, and nodeStatusMonitor would then delete every one.
      deps.installedAppsFn.resolves({ status: 'error', data: 'db down' });

      const decided = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosStateValue);
      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(true);
    });

    it('is NOT set before the node knows what it is running', async () => {
      service.setNodeReadyForTests(false);
      installedApps = [];

      const decided = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosStateValue);
      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(true);
    });

    it('is released once the node is no longer a target', async () => {
      installedApps = [];
      await service.enforceResidentialPolicy(deps);
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });

      await service.enforceResidentialPolicy(deps);

      sinon.assert.called(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.equal(false);
    });
  });

  describe('sticky slot ownership', () => {
    it("leaves another owner's DOS alone rather than overwriting it", async () => {
      installedApps = [];
      fluxNetworkHelperStub.setStickyDosMessage('Node flagged via tampering blocklist: score 40');
      fluxNetworkHelperStub.setStickyDosMessage.resetHistory();

      await service.enforceResidentialPolicy(deps);

      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosMessage);
      expect(fluxNetworkHelperStub.getStickyDosMessage()).to.contain('tampering');
    });

    it('releases only its own claim when the slot has changed hands', async () => {
      installedApps = [];
      await service.enforceResidentialPolicy(deps);
      // Another owner takes the slot after we wrote.
      fluxNetworkHelperStub.setStickyDosMessage('Node flagged via tampering blocklist: score 40');
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });

      await service.enforceResidentialPolicy(deps);

      expect(fluxNetworkHelperStub.getStickyDosMessage()).to.contain('tampering');
      expect(service.isDosActive()).to.equal(false);
    });
  });

  describe('the settling window before evacuation', () => {
    it('does not begin evacuating on the first evaluation', async () => {
      installedApps = [{ name: 'someapp' }];

      await service.enforceResidentialPolicy(deps);

      expect(service.isEvacuating()).to.equal(false);
    });

    it('records when the window started', async () => {
      installedApps = [{ name: 'someapp' }];

      await service.enforceResidentialPolicy(deps);

      expect(markerStore.get('residentialDos').residentialSince).to.be.a('number');
    });

    it('begins evacuating once the window has elapsed', async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());

      await service.enforceResidentialPolicy(deps);

      expect(service.isEvacuating()).to.equal(true);
    });

    it('is not restarted by a restart, because it is persisted wall-clock', async () => {
      // A counter of consecutive evaluations held in memory would be reset by
      // restarting FluxOS, which would make restarting on a cron a way to
      // postpone evacuation indefinitely.
      installedApps = [{ name: 'someapp' }];
      const seeded = windowServed();
      markerStore.set('residentialDos', seeded);

      service.stop();
      service = loadService();
      service.setNodeReadyForTests(true);
      await service.enforceResidentialPolicy(deps);

      expect(markerStore.get('residentialDos').residentialSince).to.equal(seeded.residentialSince);
      // The observed total survived the restart too, which is the half that
      // actually decides now.
      expect(markerStore.get('residentialDos').observedMs).to.be.at.least(service.SETTLE_MS);
      expect(service.isEvacuating()).to.equal(true);
    });

    it('is cleared only by a verdict flip', async () => {
      installedApps = [{ name: 'someapp' }];
      await service.enforceResidentialPolicy(deps);
      expect(markerStore.has('residentialDos')).to.equal(true);

      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });
      await service.enforceResidentialPolicy(deps);

      expect(markerStore.has('residentialDos')).to.equal(false);
      expect(service.isEvacuating()).to.equal(false);
    });

    it('stops evacuating when the marker cannot be read', async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
      expect(service.isEvacuating()).to.equal(true);

      dbHelperStub.databaseConnection.returns(null);
      const decided = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      expect(service.isEvacuating()).to.equal(false);
    });
  });

  describe('the window counts time the verdict was WATCHED, not time that passed', () => {
    const HOUR = 60 * 60 * 1000;

    beforeEach(() => {
      installedApps = [{ name: 'someapp' }];
    });

    it('does not drain on two evaluations a day apart with silence between them', async () => {
      // The defect. A tick that cannot decide - unreadable bench, table that
      // will not load - returns without touching state, so a node could answer
      // once, say nothing for 24h, answer once more, and start deleting apps.
      // 293 of 6,115 fleet slots cannot read their bench today, and that is the
      // population being judged.
      const now = Date.now();
      markerStore.set('residentialDos', {
        _id: 'residentialDos',
        residentialSince: now - service.SETTLE_MS - HOUR,
        lastConfirmedAt: now - (24 * HOUR),
        observedMs: 0,
      });

      await service.enforceResidentialPolicy(deps);

      expect(service.isEvacuating()).to.equal(false);
      // And the silence bought nothing, so it cannot drain on the next tick either.
      expect(markerStore.get('residentialDos').observedMs).to.equal(0);
    });

    it('credits a gap at the normal check cadence', async () => {
      const now = Date.now();
      markerStore.set('residentialDos', {
        _id: 'residentialDos',
        residentialSince: now - service.SETTLE_MS,
        lastConfirmedAt: now - service.CHECK_INTERVAL_MS,
        observedMs: service.SETTLE_MS - service.CHECK_INTERVAL_MS,
      });

      await service.enforceResidentialPolicy(deps);

      expect(markerStore.get('residentialDos').observedMs).to.be.at.least(service.SETTLE_MS);
      expect(service.isEvacuating()).to.equal(true);
    });

    it('credits at most one check interval, however long the gap', async () => {
      // A gap short enough to count still buys only a tick's worth. Otherwise a
      // node that checks in rarely accrues the window faster than one checking
      // in as designed.
      const now = Date.now();
      markerStore.set('residentialDos', {
        _id: 'residentialDos',
        residentialSince: now - (11 * HOUR),
        lastConfirmedAt: now - (11 * HOUR),
        observedMs: 0,
      });

      await service.enforceResidentialPolicy(deps);

      expect(markerStore.get('residentialDos').observedMs).to.equal(service.CHECK_INTERVAL_MS);
    });

    it('starts a marker written before observed time was kept at zero, not credited', async () => {
      // An in-place upgrade. The old marker records when the clock started,
      // which is precisely the measure being replaced, so it earns nothing -
      // the node waits out a real window instead of inheriting a notional one.
      const now = Date.now();
      markerStore.set('residentialDos', {
        _id: 'residentialDos',
        residentialSince: now - (10 * 24 * HOUR),
      });

      await service.enforceResidentialPolicy(deps);

      expect(markerStore.get('residentialDos').observedMs).to.equal(0);
      expect(service.isEvacuating()).to.equal(false);
    });

    it('keeps the first-seen timestamp for the record while the gate reads observed time', async () => {
      const now = Date.now();
      const firstSeen = now - (5 * 24 * HOUR);
      markerStore.set('residentialDos', {
        _id: 'residentialDos', residentialSince: firstSeen, lastConfirmedAt: now - HOUR, observedMs: HOUR,
      });

      await service.enforceResidentialPolicy(deps);

      expect(markerStore.get('residentialDos').residentialSince).to.equal(firstSeen);
      expect(service.isEvacuating()).to.equal(false);
    });
  });

  describe('the bounded correctness set', () => {
    const HOUR = 60 * 60 * 1000;

    beforeEach(() => {
      installedApps = [{ name: 'someapp' }];
    });

    it('does not re-open the departure gate on a restart', async () => {
      // lastEvacuationAt started at 0, so `now - 0` is about 1.7e12 and the
      // gate was open on the first call after every process start. A node
      // restarting on a cron shed an app every queue wait instead of every
      // departure interval.
      const now = Date.now();
      markerStore.set('residentialDos', {
        ...windowServed(now), lastEvacuationAt: now - HOUR,
      });

      await service.enforceResidentialPolicy(deps);
      const verdict = service.mayEvacuateApp('someapp', [{ ip: LOCAL, runningSince: new Date(1) }], LOCAL, now);

      expect(verdict.ok).to.equal(false);
      expect(verdict.reason).to.contain('next departure in');
    });

    it('records the departure so the next process sees it', async () => {
      markerStore.set('residentialDos', windowServed());

      service.noteEvacuated('someapp');
      await new Promise((resolve) => { setImmediate(resolve); });

      expect(markerStore.get('residentialDos').lastEvacuationAt).to.be.a('number');
    });

    it('gives an empty location list the longest wait, not the shortest', async () => {
      // `index < 0 ? ordered.length : index` made an EMPTY list position 0 -
      // the front of the queue - inverting the rule the sibling test asserts. An
      // empty list is the ordinary result of expired location records.
      expect(service.queueDelayMs([], LOCAL)).to.be.above(service.QUEUE_BASE_MS);
    });

    it('refuses to drain on a settle comparison that is not a number', async () => {
      // NaN is neither < nor >= the window, so a gate written as `<` fell
      // through to draining. Reachable without malformed data: a clock behind
      // when the marker is written and corrected FORWARD reads it all as served.
      markerStore.set('residentialDos', {
        _id: 'residentialDos',
        residentialSince: Date.now(),
        lastConfirmedAt: 'not-a-number',
        observedMs: 'also-not-a-number',
      });

      await service.enforceResidentialPolicy(deps);

      expect(service.isEvacuating()).to.equal(false);
    });

    it('refuses to drain on a stored observation that is not finite', async () => {
      // Infinity is the case that separates the two guards. A string is
      // stopped by the negated comparison on its own; Infinity passes that -
      // it really is >= the window - and is stopped only by rejecting
      // non-finite values where the marker is read.
      markerStore.set('residentialDos', {
        _id: 'residentialDos',
        residentialSince: Date.now(),
        lastConfirmedAt: Date.now(),
        observedMs: Infinity,
      });

      await service.enforceResidentialPolicy(deps);

      expect(service.isEvacuating()).to.equal(false);
    });

    it('stops draining when the benchmark stops answering', async () => {
      // evacuating was latched, so a node already draining whose bench became
      // unreadable kept handing an app back per interval with no verdict.
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
      expect(service.isEvacuating()).to.equal(true);

      benchmarkServiceStub.getBenchmarks.resolves({ status: 'error' });
      const decided = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      expect(service.isEvacuating()).to.equal(false);
    });

    it('stops draining when the classification stops answering', async () => {
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
      expect(service.isEvacuating()).to.equal(true);

      geolocationServiceStub.getNetworkClassification.returns(null);
      const decided = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      expect(service.isEvacuating()).to.equal(false);
    });

    it('does not DOS an apparently empty node while an install is in flight', async () => {
      // The placement hold stops the spawner taking anything NEW, but not an
      // install already running - and an install is real from
      // installationProgress some way before its database record exists for the
      // app list to see.
      installedApps = [];
      globalStateStub.installationInProgress = true;

      const decided = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      expect(service.isDosActive()).to.equal(false);
    });

    it('DOSes an empty node once no install is in flight', async () => {
      installedApps = [];
      globalStateStub.installationInProgress = false;

      await service.enforceResidentialPolicy(deps);

      expect(service.isDosActive()).to.equal(true);
    });
  });

  describe('the ticket tolerance the harness models', () => {
    it('is the same multiple of the step that coupled-knobs derives from', async () => {
      // Two files have to agree on this or the harness builds fleets the product
      // does not behave like: coupled-knobs sizes the departure interval to
      // outlast the tolerance, and sizes it from ITS OWN idea of what the
      // tolerance is. If that drifts below the real one, a departure stops
      // reading as a gap and the serialisation this paces silently stops
      // existing - green, and testing nothing.
      // eslint-disable-next-line import/extensions
      const knobs = await import('../../test-infra/runner/framework/coupled-knobs.js');

      expect(service.MAX_TICKET_GAP_MS).to.equal(service.QUEUE_STEP_MS * knobs.TICKET_GAP_STEPS);
    });

    it('outlasts more than one give-up pass, so a late pass cannot trip it', async () => {
      // eslint-disable-next-line import/extensions
      const knobs = await import('../../test-infra/runner/framework/coupled-knobs.js');
      const passesPerStep = knobs.productionQueueRatio();

      // One step is 1.82 passes. The tolerance has to mean a pass was MISSED
      // rather than merely slow, so it has to clear two passes with room.
      expect(passesPerStep * knobs.TICKET_GAP_STEPS).to.be.above(3);
    });
  });

  describe('what /flux/info reports: dosStaging', () => {
    it('reports nothing on a node that is not being enforced', async () => {
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });
      installedApps = [{ name: 'someapp' }];

      await service.enforceResidentialPolicy(deps);

      expect(service.getDosStaging()).to.equal(null);
    });

    it('reports HOLD from the first enforced evaluation, before anything is deleted', async () => {
      // The stage worth reporting. It lasts a whole settling window, nothing has
      // been deleted in it, and the operator can still put the node right and
      // lose nothing - and without it a held node looks exactly like one that
      // has simply not been given any work.
      installedApps = [{ name: 'someapp' }];

      await service.enforceResidentialPolicy(deps);

      expect(service.getDosStaging()).to.equal('HOLD');
      expect(service.isEvacuating()).to.equal(false);
    });

    it('reports EVACUATE once the window is served', async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());

      await service.enforceResidentialPolicy(deps);

      expect(service.getDosStaging()).to.equal('EVACUATE');
    });

    it('does not go backwards when a tick cannot decide', async () => {
      // THE REASON THIS IS NOT DERIVED FROM `evacuating`. That flag is a per-tick
      // permission for the give-up pass and any tick that cannot read something
      // turns it off - correctly. Reporting it as a STAGE would show the node
      // retreating through a staging it never retreated through, on a tick where
      // nothing about the node changed at all.
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
      expect(service.getDosStaging()).to.equal('EVACUATE');

      benchmarkServiceStub.getBenchmarks.resolves({ status: 'error' });
      await service.enforceResidentialPolicy(deps);

      expect(service.isEvacuating(), 'the drain stops, which is correct').to.equal(false);
      expect(service.getDosStaging(), 'but the node has not moved back a stage').to.equal('EVACUATE');
    });

    it('does not go backwards when the settling marker cannot be written', async () => {
      // The other way a tick gives up, and it reaches FURTHER than an unreadable
      // benchmark does - past the point where the window figure is read. The
      // stage still must not move: the node has not retreated anywhere, this
      // node simply could not write its own note.
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
      expect(service.getDosStaging()).to.equal('EVACUATE');

      dbHelperStub.findOneAndUpdateInDatabase.rejects(new Error('marker write failed'));
      await service.enforceResidentialPolicy(deps);

      expect(service.isEvacuating(), 'the drain stops, which is correct').to.equal(false);
      expect(service.getDosStaging(), 'but the node has not moved back a stage').to.equal('EVACUATE');
    });

    it('reports nothing again once the node stops being enforced', async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
      expect(service.getDosStaging()).to.equal('EVACUATE');

      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });
      await service.enforceResidentialPolicy(deps);

      expect(service.getDosStaging()).to.equal(null);
    });
  });

  describe('pacing: mayEvacuateApp', () => {
    // Junior first, so the senior LOCAL sits at position 1 - the pacing tests
    // below are about the interval and the observation window, and they only
    // say what they mean from a position that is not the front of the queue.
    const locations = [
      { ip: '5.6.7.8:16127', runningSince: new Date(2000) },
      { ip: LOCAL, runningSince: new Date(1000) },
    ];

    beforeEach(async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
    });

    it('refuses while the node is not evacuating', async () => {
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });
      await service.enforceResidentialPolicy(deps);

      const result = service.mayEvacuateApp('someapp', locations, LOCAL);

      expect(result.ok).to.equal(false);
      expect(result.reason).to.contain('not evacuating');
    });

    // Two locations, so two is full strength for this app.
    const WHOLE = 2;
    // Position 1 in the queue order (junior first): base plus one step.
    const WAIT = () => service.QUEUE_BASE_MS + service.QUEUE_STEP_MS;

    // Walk the ticket forward the way the give-up pass does - an evaluation
    // every half step, which is well inside the gap an observation tolerates.
    // Written out rather than jumped, because what the ticket measures is an
    // uninterrupted observation and a single jump is not one.
    const walk = (name, locs, from, to, min = WHOLE) => {
      for (let t = from; t < to; t += service.MAX_TICKET_GAP_MS / 2) {
        service.mayEvacuateApp(name, locs, LOCAL, min, t);
      }
      return service.mayEvacuateApp(name, locs, LOCAL, min, to);
    };

    it('refuses until the app has been seen whole for its queue turn', () => {
      const now = Date.now();
      service.mayEvacuateApp('someapp', locations, LOCAL, WHOLE, now);

      const result = service.mayEvacuateApp('someapp', locations, LOCAL, WHOLE, now + 1000);

      expect(result.ok).to.equal(false);
      expect(result.reason).to.contain('its turn is in');
    });

    it('allows once the queue turn has been served', () => {
      const now = Date.now();

      const result = walk('someapp', locations, now, now + WAIT() + 1);

      expect(result.ok).to.equal(true);
    });

    it('paces departures by the evacuation interval', () => {
      const now = Date.now();
      const wait = WAIT();
      expect(walk('someapp', locations, now, now + wait + 1).ok).to.equal(true);

      service.noteEvacuated('someapp', now + wait + 1);
      const next = service.mayEvacuateApp('other', locations, LOCAL, WHOLE, now + wait + 2);

      expect(next.ok).to.equal(false);
      expect(next.reason).to.contain('next departure in');
    });

    it("restarts an app's observation when it stops being whole", () => {
      const now = Date.now();
      service.mayEvacuateApp('someapp', locations, LOCAL, WHOLE, now);
      service.forgetAppObservation('someapp');
      const wait = WAIT();

      const result = service.mayEvacuateApp('someapp', locations, LOCAL, WHOLE, now + wait + 1);

      expect(result.ok).to.equal(false);
    });

    it('does not arrive ready the instant its departure interval clears', () => {
      // The serialisation between two evacuating holders is the ticket, and the
      // ticket only separates them if it is still binding after a departure.
      // Both nodes stamp their tickets in the same pass; one leaves; and if the
      // other's ticket keeps maturing through the six hours it is blocked, then
      // when the blocks expire together - they are fired from the same block
      // height - both are ready for the same app in the same pass.
      const now = Date.now();
      const wait = WAIT();
      walk('other', locations, now, now + wait + 1);
      expect(walk('someapp', locations, now, now + wait + 1).ok).to.equal(true);
      service.noteEvacuated('someapp', now + wait + 1);

      // The pass goes on running through the block and goes on asking. It is
      // refused at the interval gate, and being refused there is NOT having
      // watched the app: the accounting sits below that gate for this reason.
      const cleared = now + wait + 1 + service.EVACUATION_INTERVAL_MS + 1;
      for (let t = now + wait + 2; t < cleared; t += service.MAX_TICKET_GAP_MS / 2) {
        service.mayEvacuateApp('other', locations, LOCAL, WHOLE, t);
      }

      const result = service.mayEvacuateApp('other', locations, LOCAL, WHOLE, cleared);

      expect(result.ok).to.equal(false);
      expect(result.reason).to.contain('its turn is in');
    });

    it('counts nothing towards the turn while the app is short', () => {
      // The clock is named for seeing the app at full strength and used to
      // start on the first ASK, so an app short for its entire wait served the
      // full wait anyway and was only caught later, by the safety gate.
      const now = Date.now();
      const wait = WAIT();
      const short = [{ ip: LOCAL, runningSince: new Date(1000) }];

      const during = walk('someapp', short, now, now + wait + 1);

      expect(during.ok).to.equal(false);
      // The CODE, not the prose. A caller has to tell "waiting its turn" from
      // "the app is short" - the first is this working, the second is a node
      // that wants to leave and cannot - and it must not have to match a
      // sentence to do it. Deliberately the name appEvacuationSafety uses for
      // the same fact, because it is the same fact asked one layer earlier.
      expect(during.code).to.equal('BELOW_INSTANCE_COUNT');
      expect(during.reason).to.contain('below its instance count');

      // And the turn runs from the moment it is whole, not from the first ask.
      const result = service.mayEvacuateApp('someapp', locations, LOCAL, WHOLE, now + wait + 2);

      expect(result.ok).to.equal(false);
    });

    it('restarts the turn when a gap says the node stopped watching', () => {
      const now = Date.now();
      const wait = WAIT();

      // Watched without interruption, the turn is served on time.
      expect(walk('someapp', locations, now, now + wait + 1).ok).to.equal(true);

      service.forgetAppObservation('someapp');
      service.mayEvacuateApp('someapp', locations, LOCAL, WHOLE, now);
      // An interruption longer than the tolerance. Expressed against the
      // tolerance and measured from where watching RESUMED, rather than against
      // the original stamp: the two are independent knobs, and an arithmetic
      // that assumes one outlasts the other silently stops testing anything the
      // moment either moves.
      const resumed = now + service.MAX_TICKET_GAP_MS + 1;

      // The turn starts again from `resumed`, so time already served is gone.
      expect(walk('someapp', locations, resumed, resumed + wait - 1).ok).to.equal(false);
      // ...and a full turn from there does mature.
      expect(walk('someapp', locations, resumed + wait - 1, resumed + wait + 1).ok).to.equal(true);
    });

    it('is not restarted by an ordinary pass running late', () => {
      // The tolerance is TWO steps because one is 1.82 passes, so at one step a
      // single slow pass restarts the ticket. Production hardly notices; the
      // harness compresses the same ratio to seconds, where a late pass is
      // ordinary - and on chud the countdown ran 2m, 1m, 0m and jumped back to
      // 2m, three times over, never maturing.
      const now = Date.now();
      const wait = WAIT();
      const lateButNotMissed = service.QUEUE_STEP_MS + 1000;

      expect(lateButNotMissed, 'a late pass must be inside the tolerance')
        .to.be.below(service.MAX_TICKET_GAP_MS);

      service.mayEvacuateApp('someapp', locations, LOCAL, WHOLE, now);
      service.mayEvacuateApp('someapp', locations, LOCAL, WHOLE, now + lateButNotMissed);

      expect(service.mayEvacuateApp('someapp', locations, LOCAL, WHOLE, now + wait + 1).ok)
        .to.equal(true);
    });
  });

  describe('queueDelayMs is a delay, never a veto', () => {
    it('gives the junior instance the shortest wait, and still a non-zero one', () => {
      const locations = [
        { ip: '5.6.7.8:16127', runningSince: new Date(1000) },
        { ip: LOCAL, runningSince: new Date(2000) },
      ];

      expect(service.queueDelayMs(locations, LOCAL)).to.equal(service.QUEUE_BASE_MS);
    });

    it('makes the senior instance wait longest, whatever order the list arrives in', () => {
      // The senior instance is the one masterSlaveApps elects primary, and it
      // is the only instance that cannot simply leave - it has to stand down
      // and hand the app back first. Ranking the senior end first put exactly
      // that node at the head of the queue, ahead of every node that could just
      // go. Locations arrive in broadcast order, so the answer must not depend
      // on it either.
      const senior = { ip: LOCAL, runningSince: new Date(1000) };
      const middle = { ip: '5.6.7.8:16127', runningSince: new Date(2000) };
      const junior = { ip: '9.9.9.9:16127', runningSince: new Date(3000) };

      [[senior, middle, junior], [junior, senior, middle]].forEach((locations) => {
        expect(service.queueDelayMs(locations, LOCAL)).to.equal(
          service.QUEUE_BASE_MS + (2 * service.QUEUE_STEP_MS),
        );
        expect(service.queueDelayMs(locations, junior.ip)).to.equal(service.QUEUE_BASE_MS);
      });
    });

    it('spaces each subsequent position by one step', () => {
      const locations = [
        { ip: '5.6.7.8:16127', runningSince: new Date(1000) },
        { ip: '9.9.9.9:16127', runningSince: new Date(3000) },
        { ip: LOCAL, runningSince: new Date(2000) },
      ];

      expect(service.queueDelayMs(locations, LOCAL)).to.equal(
        service.QUEUE_BASE_MS + service.QUEUE_STEP_MS,
      );
    });

    it('gives an instance it cannot find in the list the longest wait', () => {
      const locations = [{ ip: '5.6.7.8:16127', runningSince: new Date(1000) }];

      expect(service.queueDelayMs(locations, LOCAL)).to.equal(
        service.QUEUE_BASE_MS + service.QUEUE_STEP_MS,
      );
    });
  });

  describe('the queue step outlasts the pass that reads it', () => {
    // mayEvacuateApp is reachable only from the give-up pass
    // (explorerService.js:651 -> checkAndRemoveApplicationInstance) and
    // wholeSince is stamped inside that pass, so ticket maturity is quantised
    // to the pass interval. A step shorter than the pass cannot separate two
    // points on that grid: adjacent positions mature on the same pass, and the
    // pass is keyed on block height so every node in the fleet evaluates in the
    // same instant. Both holders then read the app at full strength, because
    // fluxappremoved is broadcast only after the volume is already deleted, and
    // an app at N drops to 1 in a single pass.
    //
    // Asserted against PRODUCTION's config, not the copy under
    // tests/unit/globalconfig and not the harness overlay. The harness
    // compresses both sides of this inequality, and compressing them by
    // different factors is what hid the defect - suite 55 separates every
    // position by about four passes and is structurally incapable of producing
    // the collision. An environment tuned until it is green cannot test what
    // was tuned, so the inequality is checked where the fleet reads it.
    const BLOCK_SECONDS = 30; // post-PON; stated in-repo at fluxService.js:1774
    const PON_SPEED_MULTIPLIER = 4; // explorerService.js:610

    // ZelBack/config/default.js requires config/userconfig, which is gitignored
    // and absent from a fresh checkout, so it is stubbed rather than resolved.
    function productionConfig() {
      return proxyquire('../../ZelBack/config/default', {
        '../../config/userconfig': { initial: { development: false } },
      });
    }

    function passIntervalMs(fluxapps) {
      return fluxapps.removeFluxAppsPeriod * PON_SPEED_MULTIPLIER * BLOCK_SECONDS * 1000;
    }

    it('spaces adjacent queue positions by more than one give-up pass', () => {
      const { fluxapps } = productionConfig();

      expect(fluxapps.residentialQueueStepMs).to.be.above(passIntervalMs(fluxapps));
    });

    it('gives every position in an instance list a pass of its own', () => {
      const { fluxapps } = productionConfig();
      const pass = passIntervalMs(fluxapps);
      const passIndex = (position) => Math.ceil(
        (fluxapps.residentialQueueBaseMs + (position * fluxapps.residentialQueueStepMs)) / pass,
      );

      // Nine positions covers the largest instance count the fleet runs.
      const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(passIndex);

      expect(new Set(indices).size).to.equal(indices.length);
    });

    it('is the same relationship the unit config copy models', () => {
      // Every other test in this file reads the copy, so a copy that has
      // drifted would silently measure a different model from the fleet's.
      const production = productionConfig().fluxapps;
      const unitCopy = require('config').fluxapps;

      expect(unitCopy.removeFluxAppsPeriod).to.equal(production.removeFluxAppsPeriod);
      expect(unitCopy.residentialQueueBaseMs).to.equal(production.residentialQueueBaseMs);
      expect(unitCopy.residentialQueueStepMs).to.equal(production.residentialQueueStepMs);
    });
  });

  describe('listInstalledApps', () => {
    it('returns null rather than an empty list when the read fails', async () => {
      const result = await service.listInstalledApps(async () => ({ status: 'error', data: 'nope' }));

      expect(result).to.equal(null);
    });

    it('returns null when the lister throws', async () => {
      const result = await service.listInstalledApps(async () => { throw new Error('boom'); });

      expect(result).to.equal(null);
    });

    it('returns the app names on success', async () => {
      const result = await service.listInstalledApps(async () => ({
        status: 'success', data: [{ name: 'a' }, { name: 'b' }],
      }));

      expect(result).to.deep.equal(['a', 'b']);
    });
  });

  describe('lifecycle', () => {
    it('stop() drops our DOS claim so a later start() re-reads the slot', async () => {
      installedApps = [];
      await service.enforceResidentialPolicy(deps);
      expect(service.isDosActive()).to.equal(true);

      service.stop();

      expect(service.isDosActive()).to.equal(false);
    });

    it('stop() stops evacuating', async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
      expect(service.isEvacuating()).to.equal(true);

      service.stop();

      expect(service.isEvacuating()).to.equal(false);
    });

    it('a second start() does not run a second self-rescheduling chain', async () => {
      installedApps = [];
      await service.start(deps);
      const callsAfterFirst = deps.installedAppsFn.callCount;

      await service.start(deps);

      expect(deps.installedAppsFn.callCount).to.equal(callsAfterFirst);
    });
  });
});
