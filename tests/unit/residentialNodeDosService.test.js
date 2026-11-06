const { expect } = require('chai');
const sinon = require('sinon');
const { resetGlobalState } = require('./fixtures/globalState');
const { EventEmitter } = require('node:events');
const proxyquire = require('proxyquire').noCallThru();

const { makeStickyDosDouble } = require('./stickyDosTestDouble');
const { StickyDosOwner } = require('../../ZelBack/src/services/fluxNetworkHelper');

const { EVENTS: SYNC_EVENTS } = require('../../ZelBack/src/services/utils/appSyncEvents');

const { CLASSIFICATION } = require('../../ZelBack/src/services/utils/networkClassifier');

describe('residentialNodeDosService tests', () => {
  const OWNER = StickyDosOwner.RESIDENTIAL_DOS;
  const TAMPERING = StickyDosOwner.APP_TAMPERING;
  let service;
  let fluxNetworkHelperStub;
  let geolocationServiceStub;
  let benchmarkServiceStub;
  let dbHelperStub;
  let markerStore;
  let applyUpdate;
  let globalStateStub;
  let deps;
  let installedApps;

  const LOCAL = '1.2.3.4:16127';
  const DAY = 24 * 60 * 60 * 1000;

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
    });
  }

  beforeEach(() => {
    // Owner-keyed, like the real one. A double that kept a single slot would
    // accept a release from any owner and so could never fail the way the real
    // module refuses to.
    const holds = new Map();
    fluxNetworkHelperStub = {
      ...makeStickyDosDouble(),
      PlacementHoldOwner: Object.freeze({ RESIDENTIAL_DOS: 'residentialDos' }),
      setPlacementHold: sinon.stub().callsFake((owner, reason) => { holds.set(owner, reason); }),
      clearPlacementHold: sinon.stub().callsFake((owner) => { holds.delete(owner); }),
      getPlacementHold: sinon.stub().callsFake(() => (holds.size ? [...holds.values()].join('; ') : null)),
      isPlacementHeld: sinon.stub().callsFake(() => holds.size > 0),
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
    globalStateStub = resetGlobalState();

    // The settle marker lives in mongo, so the double has to remember it across
    // a reload - surviving a restart is the whole point of that field.
    markerStore = new Map();
    applyUpdate = (query, update) => {
      const held = { _id: query._id, ...(markerStore.get(query._id) || {}), ...update.$set };
      Object.entries(update.$max || {}).forEach(([field, value]) => {
        if (held[field] === undefined || value > held[field]) held[field] = value;
      });
      markerStore.set(query._id, held);
    };
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
      findOneInDatabase: sinon.stub().callsFake(async (db, coll, query) => markerStore.get(query._id) || null),
      findOneAndUpdateInDatabase: sinon.stub().callsFake(async (db, coll, query, update) => applyUpdate(query, update)),
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

      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDos);
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

      const { decided } = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(false);
      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDos);
    });

    it('does not hold or DOS when there is no settled classification', async () => {
      geolocationServiceStub.getNetworkClassification.returns(null);

      const { decided } = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(false);
    });
  });

  describe('every tick publishes what it concluded', () => {
    it('says enforce=false when the node is fit to serve', async () => {
      geolocationServiceStub.getNetworkClassification.returns({ classification: 'DATACENTER' });

      const { decision } = await service.enforceResidentialPolicy(deps);

      expect(decision).to.not.equal(null);
      expect(decision).to.include({ enforce: false, residential: false, undecidedBecause: null });
    });

    it('says enforce=true when it is not', async () => {
      const { decision } = await service.enforceResidentialPolicy(deps);

      expect(decision).to.include({ enforce: true, residential: true, undecidedBecause: null });
    });

    it('separates a tick that could not decide from one that decided no', async () => {
      // null and false are opposite claims: one says nobody knows yet, the
      // other says this node is fit to serve. A consumer that reads them the
      // same way treats an unreadable benchmark as an all-clear.
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'error', data: 'down' });

      const { decision } = await service.enforceResidentialPolicy(deps);

      expect(decision).to.include({ enforce: null, undecidedBecause: 'benchmark' });
    });

    it('carries the verdict, so a veto is not read as an unread table', async () => {
      // Both come back enforce: null. CONFLICTED from a node declining a
      // published verdict about its own address is a decision; a null
      // classification is the absence of one, and a consumer that cannot
      // separate them learns nothing from either.
      geolocationServiceStub.getNetworkClassification.returns({
        classification: 'CONFLICTED', source: 'node-veto',
      });

      const { decision } = await service.enforceResidentialPolicy(deps);

      expect(decision).to.include({
        enforce: null, classification: 'CONFLICTED', source: 'node-veto',
      });
    });

    it('names the classification when that is the missing input', async () => {
      geolocationServiceStub.getNetworkClassification.returns(null);

      const { decision } = await service.enforceResidentialPolicy(deps);

      expect(decision).to.include({ enforce: null, undecidedBecause: 'classification' });
    });
  });

  describe('the DOS is only ever set on a confirmed empty node', () => {
    it('goes on at once when the node holds no apps', async () => {
      installedApps = [];

      await service.enforceResidentialPolicy(deps);

      sinon.assert.calledWith(fluxNetworkHelperStub.setStickyDos, OWNER, sinon.match.string);
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

      const { decided } = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDos);
      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(true);
    });

    it('is NOT set before the node knows what it is running', async () => {
      service.setNodeReadyForTests(false);
      installedApps = [];

      const { decided } = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDos);
      expect(fluxNetworkHelperStub.isPlacementHeld()).to.equal(true);
    });

    it('is released once the node is no longer a target', async () => {
      installedApps = [];
      await service.enforceResidentialPolicy(deps);
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });

      await service.enforceResidentialPolicy(deps);

      sinon.assert.calledWith(fluxNetworkHelperStub.clearStickyDos, OWNER);
      expect(service.isDosActive()).to.equal(false);
    });
  });

  describe('one verdict per owner', () => {
    const TAMPERING_REASON = 'Node flagged via tampering blocklist: score 40';

    it("records its verdict beside another owner's rather than instead of it", async () => {
      installedApps = [];
      fluxNetworkHelperStub.holds.set(TAMPERING, TAMPERING_REASON);

      await service.enforceResidentialPolicy(deps);

      expect(service.isDosActive(), 'the verdict was dropped because another owner held one').to.equal(true);
      expect(fluxNetworkHelperStub.getStickyDosMessage(), 'overwrote a verdict it does not own').to.contain('tampering');
      expect(fluxNetworkHelperStub.getStickyDosMessage()).to.contain(service.DOS_MESSAGE_PREFIX);
    });

    it("releases its own verdict and leaves another owner's standing", async () => {
      installedApps = [];
      await service.enforceResidentialPolicy(deps);
      fluxNetworkHelperStub.holds.set(TAMPERING, TAMPERING_REASON);
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });

      await service.enforceResidentialPolicy(deps);

      expect(fluxNetworkHelperStub.getStickyDosMessage(), "dropped another owner's DOS on the floor").to.contain('tampering');
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

    it('counts nothing of a window a verdict flip could not clear, until it is cleared', async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      const residential = geolocationServiceStub.getNetworkClassification();
      dbHelperStub.findOneAndDeleteInDatabase.rejects(new Error('marker delete failed'));
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });
      await service.enforceResidentialPolicy(deps);
      expect(markerStore.has('residentialDos')).to.equal(true);

      geolocationServiceStub.getNetworkClassification.returns(residential);
      await service.enforceResidentialPolicy(deps);

      expect(service.isEvacuating(), 'the window of the earlier verdict is not counted').to.equal(false);
      expect(markerStore.get('residentialDos').observedMs).to.equal(service.SETTLE_MS + 1000);

      dbHelperStub.findOneAndDeleteInDatabase.callsFake(async (db, coll, query) => { markerStore.delete(query._id); });
      await service.enforceResidentialPolicy(deps);

      expect(service.isEvacuating()).to.equal(false);
      expect(markerStore.get('residentialDos').observedMs, 'a fresh window').to.equal(0);
    });

    it('stops evacuating when the marker cannot be read', async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
      expect(service.isEvacuating()).to.equal(true);

      dbHelperStub.databaseConnection.returns(null);
      const { decided } = await service.enforceResidentialPolicy(deps);

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

    it('keeps the observed time and evacuates nothing when the marker cannot be read', async () => {
      const now = Date.now();
      markerStore.set('residentialDos', {
        _id: 'residentialDos',
        residentialSince: now - (5 * 24 * HOUR),
        lastConfirmedAt: now - service.CHECK_INTERVAL_MS,
        observedMs: service.SETTLE_MS - HOUR,
      });
      dbHelperStub.findOneInDatabase.rejects(new Error('marker read failed'));

      await service.enforceResidentialPolicy(deps);

      sinon.assert.notCalled(dbHelperStub.findOneAndUpdateInDatabase);
      expect(markerStore.get('residentialDos').observedMs).to.equal(service.SETTLE_MS - HOUR);
      expect(service.isEvacuating()).to.equal(false);
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
      const verdict = service.mayEvacuateApp(
        [{ key: 'own', expireAt: new Date(now + DAY) }],
        'own',
        1,
        { timeMs: now, previousTimeMs: now },
      );

      expect(verdict.ok).to.equal(false);
      expect(verdict.reason).to.contain('next departure in');
    });

    it('records the departure so the next process sees it', async () => {
      markerStore.set('residentialDos', windowServed());

      service.noteEvacuated('someapp');
      await new Promise((resolve) => { setImmediate(resolve); });

      expect(markerStore.get('residentialDos').lastEvacuationAt).to.be.a('number');
    });

    it('writes a departure time it could not record on the next tick', async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      dbHelperStub.findOneAndUpdateInDatabase.onFirstCall().rejects(new Error('marker write failed'));

      service.noteEvacuated('someapp');
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(markerStore.get('residentialDos').lastEvacuationAt).to.equal(undefined);

      await service.enforceResidentialPolicy(deps);

      expect(markerStore.get('residentialDos').lastEvacuationAt).to.be.a('number');
    });

    it('keeps the newer departure time when an older one it could not record is written again', async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      const wall = sinon.stub(Date, 'now');
      try {
        dbHelperStub.findOneAndUpdateInDatabase.onFirstCall().rejects(new Error('marker write failed'));
        wall.returns(1000000);
        service.noteEvacuated('someapp');
        await new Promise((resolve) => { setImmediate(resolve); });
        wall.returns(2000000);
        service.noteEvacuated('otherapp');
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(markerStore.get('residentialDos').lastEvacuationAt, 'the newer departure was not recorded').to.equal(2000000);

        await service.enforceResidentialPolicy(deps);
      } finally {
        wall.restore();
      }

      expect(markerStore.get('residentialDos').lastEvacuationAt, 'an older departure replaced a newer one').to.equal(2000000);
    });

    it('keeps the newer departure time when an older write lands after it', async () => {
      markerStore.set('residentialDos', windowServed());
      let landOlder;
      dbHelperStub.findOneAndUpdateInDatabase.onFirstCall().callsFake(async (db, coll, query, update) => {
        await new Promise((resolve) => { landOlder = resolve; });
        applyUpdate(query, update);
      });
      const wall = sinon.stub(Date, 'now');
      try {
        wall.returns(1000000);
        service.noteEvacuated('someapp');
        wall.returns(2000000);
        service.noteEvacuated('otherapp');
        await new Promise((resolve) => { setImmediate(resolve); });
        landOlder();
        await new Promise((resolve) => { setImmediate(resolve); });
      } finally {
        wall.restore();
      }

      expect(markerStore.get('residentialDos').lastEvacuationAt, 'an older departure replaced a newer one').to.equal(2000000);
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
      const { decided } = await service.enforceResidentialPolicy(deps);

      expect(decided).to.equal(false);
      expect(service.isEvacuating()).to.equal(false);
    });

    it('stops draining when the classification stops answering', async () => {
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
      expect(service.isEvacuating()).to.equal(true);

      geolocationServiceStub.getNetworkClassification.returns(null);
      const { decided } = await service.enforceResidentialPolicy(deps);

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

      const { decided } = await service.enforceResidentialPolicy(deps);

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
    const OWN = 'key-own';
    const KEYS = [OWN, 'key-b', 'key-c'];
    // One give-up pass at production scale: 11 x 4 blocks of 30s.
    const PASS_MS = 22 * 60 * 1000;
    // Standing far past any turn the tests judge at.
    const standing = (key) => ({ key, ip: `${key}:16127`, expireAt: new Date(4e12) });
    const holders = (keys = KEYS) => keys.map(standing);
    const ownerOf = (keys, from, key) => {
      for (let turn = from; ; turn += 1) {
        if (service.turnOwner(keys, turn) === key) return turn;
      }
    };
    // A pass `offsetMs` into a turn, with the pass before it one pass earlier.
    const passAt = (turn, offsetMs) => {
      const timeMs = (turn * service.TURN_MS) + offsetMs;
      return { timeMs, previousTimeMs: timeMs - PASS_MS };
    };
    const START = 500000;

    beforeEach(async () => {
      installedApps = [{ name: 'someapp' }];
      markerStore.set('residentialDos', windowServed());
      await service.enforceResidentialPolicy(deps);
    });

    it('refuses while the node is not evacuating', async () => {
      geolocationServiceStub.getNetworkClassification.returns({ classification: CLASSIFICATION.DATACENTER });
      await service.enforceResidentialPolicy(deps);

      const turn = ownerOf(KEYS, START, OWN);
      const result = service.mayEvacuateApp(holders(), OWN, 3, passAt(turn, PASS_MS + 1));

      expect(result.ok).to.equal(false);
      expect(result.code).to.equal('NOT_EVACUATING');
    });

    it('acts on the second pass of a turn it owns', () => {
      const turn = ownerOf(KEYS, START, OWN);

      const result = service.mayEvacuateApp(holders(), OWN, 3, passAt(turn, PASS_MS + 1));

      expect(result).to.include({ ok: true, code: 'READY' });
    });

    it('does not act on the first pass of a turn it owns', () => {
      // The pass before fell in the previous turn, so another holder may have
      // acted on it; this pass is the one that carries that departure to everyone.
      const turn = ownerOf(KEYS, START, OWN);

      const result = service.mayEvacuateApp(holders(), OWN, 3, passAt(turn, PASS_MS - 1));

      expect(result).to.include({ ok: false, code: 'AWAITING_TURN' });
    });

    it('does not act in a turn another holder owns', () => {
      const turn = ownerOf(KEYS, START, 'key-b');

      const result = service.mayEvacuateApp(holders(), OWN, 3, passAt(turn, PASS_MS + 1));

      expect(result).to.include({ ok: false, code: 'AWAITING_TURN' });
    });

    it('does not act while the app is short of its count', () => {
      const turn = ownerOf(KEYS, START, OWN);

      const result = service.mayEvacuateApp(holders(), OWN, 4, passAt(turn, PASS_MS + 1));

      // The CODE, not the prose: a caller tells "waiting its turn" from "the app
      // is short" by it. The name appEvacuationSafety uses for the same fact.
      expect(result).to.include({ ok: false, code: 'BELOW_INSTANCE_COUNT' });
    });

    it('does not act while the app has a spare copy', () => {
      // Two holders that each fail to count the other can both own a turn, and
      // above the count each is still at strength without the other.
      const turn = ownerOf(KEYS, START, OWN);

      const result = service.mayEvacuateApp(holders(), OWN, 2, passAt(turn, PASS_MS + 1));

      expect(result).to.include({ ok: false, code: 'ABOVE_INSTANCE_COUNT' });
    });

    it('has no turn without a standing announcement of its own', () => {
      const others = ['key-b', 'key-c', 'key-d'];
      const turn = ownerOf([...others, OWN], START, OWN);

      const result = service.mayEvacuateApp(holders(others), OWN, 3, passAt(turn, PASS_MS + 1));

      expect(result).to.include({ ok: false, code: 'NOT_LISTED' });
    });

    it('does not act when its own announcement lapses within the turn', () => {
      const turn = ownerOf(KEYS, START, OWN);
      const pass = passAt(turn, PASS_MS + 1);
      const lapsing = holders().map((holder) => (holder.key === OWN
        ? { ...holder, expireAt: new Date(pass.timeMs + service.TURN_MS) }
        : holder));

      const result = service.mayEvacuateApp(lapsing, OWN, 3, pass);

      expect(result).to.include({ ok: false, code: 'ANNOUNCEMENT_LAPSING' });
      // and one more millisecond of announcement is enough
      const lasting = lapsing.map((holder) => (holder.key === OWN
        ? { ...holder, expireAt: new Date(pass.timeMs + service.TURN_MS + 1) }
        : holder));
      expect(service.mayEvacuateApp(lasting, OWN, 3, pass).ok).to.equal(true);
    });

    it('paces departures by the evacuation interval', () => {
      const turn = ownerOf(KEYS, START, OWN);
      const now = 1e9;
      service.noteEvacuated('someapp', now);

      const result = service.mayEvacuateApp(holders(), OWN, 3, passAt(turn, PASS_MS + 1), now + 1);

      expect(result).to.include({ ok: false, code: 'DEPARTURE_INTERVAL' });
    });
  });

  describe('turnOwner', () => {
    const KEYS = ['key-a', 'key-b', 'key-c', 'key-d', 'key-e'];

    it('names one holder per turn whatever order the holders arrive in', () => {
      for (let turn = 0; turn < 200; turn += 1) {
        const owner = service.turnOwner(KEYS, turn);
        expect(KEYS).to.include(owner);
        expect(service.turnOwner([...KEYS].reverse(), turn)).to.equal(owner);
      }
    });

    it('never gives one turn to two holders that each count the other', () => {
      // Each node counts its own set of holders. Two that both count a and b,
      // and differ on any third, cannot see a own a turn and b own it too.
      for (let turn = 0; turn < 500; turn += 1) {
        const withC = service.turnOwner(['key-a', 'key-b', 'key-c'], turn);
        const withD = service.turnOwner(['key-a', 'key-b', 'key-d'], turn);
        expect(withC === 'key-a' && withD === 'key-b', `turn ${turn}`).to.equal(false);
        expect(withC === 'key-b' && withD === 'key-a', `turn ${turn}`).to.equal(false);
      }
    });

    it('gives every holder turns', () => {
      const owned = new Set();
      for (let turn = 0; turn < 200; turn += 1) owned.add(service.turnOwner(KEYS, turn));

      expect([...owned].sort()).to.eql(KEYS);
    });

    it('is cut from block time', () => {
      expect(service.turnOf(5 * service.TURN_MS)).to.equal(5);
      expect(service.turnOf((6 * service.TURN_MS) - 1)).to.equal(5);
    });

    it('tells a stood-down holder when it has owned a whole turn since', () => {
      let first = 1000;
      while (service.turnOwner(KEYS, first) !== 'key-a') first += 1;
      let next = first + 1;
      while (service.turnOwner(KEYS, next) !== 'key-a') next += 1;

      expect(service.ownedTurnSince(KEYS, 'key-a', first, next)).to.equal(false);
      expect(service.ownedTurnSince(KEYS, 'key-a', first, next + 1)).to.equal(true);
    });
  });

  describe('the turn against the passes and announcements that read it', () => {
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

    it('holds two give-up passes in every turn', () => {
      const { fluxapps } = productionConfig();

      expect(fluxapps.residentialTurnMs).to.be.at.least(2 * passIntervalMs(fluxapps));
    });

    it('is shorter than what a renewed announcement still has to run', () => {
      // eslint-disable-next-line global-require
      const { RUNNING_EXPIRY_MS, ANNOUNCE_INTERVAL_MS } = require('../../ZelBack/src/services/utils/appConstants');
      const { fluxapps } = productionConfig();

      expect(RUNNING_EXPIRY_MS - ANNOUNCE_INTERVAL_MS).to.be.above(fluxapps.residentialTurnMs);
    });

    it('is the same relationship the unit config copy models', () => {
      // Every other test in this file reads the copy, so a copy that has
      // drifted would silently measure a different model from the fleet's.
      const production = productionConfig().fluxapps;
      const unitCopy = require('config').fluxapps;

      expect(unitCopy.removeFluxAppsPeriod).to.equal(production.removeFluxAppsPeriod);
      expect(unitCopy.residentialTurnMs).to.equal(production.residentialTurnMs);
      expect(unitCopy.locationTtlS).to.equal(production.locationTtlS);
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
    // A node going down does not become a data centre by going down, and the
    // verdict is the only record of why it was taken out of service.
    it('stop() leaves the verdict it reached standing', async () => {
      installedApps = [];
      await service.enforceResidentialPolicy(deps);
      expect(service.isDosActive()).to.equal(true);

      service.stop();

      expect(service.isDosActive(), 'teardown erased the reason the node is out of service').to.equal(true);
      expect(fluxNetworkHelperStub.getStickyDosMessage()).to.contain(service.DOS_MESSAGE_PREFIX);
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
