const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

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
      // the most senior slot - inverting the rule the sibling test asserts. An
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

  describe('pacing: mayEvacuateApp', () => {
    const locations = [
      { ip: '5.6.7.8:16127', runningSince: new Date(1000) },
      { ip: LOCAL, runningSince: new Date(2000) },
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

    it('refuses until the app has been seen whole for its queue turn', () => {
      const now = Date.now();
      service.mayEvacuateApp('someapp', locations, LOCAL, now);

      const result = service.mayEvacuateApp('someapp', locations, LOCAL, now + 1000);

      expect(result.ok).to.equal(false);
      expect(result.reason).to.contain('its turn is in');
    });

    it('allows once the queue turn has been served', () => {
      const now = Date.now();
      service.mayEvacuateApp('someapp', locations, LOCAL, now);
      // Position 1 in the seniority order: base plus one step.
      const wait = service.QUEUE_BASE_MS + service.QUEUE_STEP_MS;

      const result = service.mayEvacuateApp('someapp', locations, LOCAL, now + wait + 1);

      expect(result.ok).to.equal(true);
    });

    it('paces departures by the evacuation interval', () => {
      const now = Date.now();
      service.mayEvacuateApp('someapp', locations, LOCAL, now);
      const wait = service.QUEUE_BASE_MS + service.QUEUE_STEP_MS;
      expect(service.mayEvacuateApp('someapp', locations, LOCAL, now + wait + 1).ok).to.equal(true);

      service.noteEvacuated('someapp', now + wait + 1);
      const next = service.mayEvacuateApp('other', locations, LOCAL, now + wait + 2);

      expect(next.ok).to.equal(false);
      expect(next.reason).to.contain('next departure in');
    });

    it("restarts an app's observation when it stops being whole", () => {
      const now = Date.now();
      service.mayEvacuateApp('someapp', locations, LOCAL, now);
      service.forgetAppObservation('someapp');
      const wait = service.QUEUE_BASE_MS + service.QUEUE_STEP_MS;

      const result = service.mayEvacuateApp('someapp', locations, LOCAL, now + wait + 1);

      expect(result.ok).to.equal(false);
    });
  });

  describe('queueDelayMs is a delay, never a veto', () => {
    it('gives the senior instance the shortest wait, and still a non-zero one', () => {
      const locations = [
        { ip: LOCAL, runningSince: new Date(1000) },
        { ip: '5.6.7.8:16127', runningSince: new Date(2000) },
      ];

      expect(service.queueDelayMs(locations, LOCAL)).to.equal(service.QUEUE_BASE_MS);
    });

    it('spaces each subsequent position by one step', () => {
      const locations = [
        { ip: '5.6.7.8:16127', runningSince: new Date(1000) },
        { ip: '9.9.9.9:16127', runningSince: new Date(2000) },
        { ip: LOCAL, runningSince: new Date(3000) },
      ];

      expect(service.queueDelayMs(locations, LOCAL)).to.equal(
        service.QUEUE_BASE_MS + (2 * service.QUEUE_STEP_MS),
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
