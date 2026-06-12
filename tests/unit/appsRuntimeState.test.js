const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appsRuntimeState tests', () => {
  let appsRuntimeState;
  let store; // fake collection: identifier -> doc
  let logStub;

  beforeEach(() => {
    store = new Map();
    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

    const dbHelperStub = {
      databaseConnection: () => ({ db: () => ({}) }),
      findOneInDatabase: async (_db, _coll, query) => store.get(query.identifier) || null,
      updateOneInDatabase: async (_db, _coll, query, update) => {
        const existing = store.get(query.identifier) || {};
        store.set(query.identifier, { ...existing, ...update.$set });
      },
      removeDocumentsFromCollection: async (_db, _coll, query) => { store.delete(query.identifier); },
    };

    appsRuntimeState = proxyquire('../../ZelBack/src/services/appManagement/appsRuntimeState', {
      '../../lib/log': logStub,
      '../dbHelper': dbHelperStub,
      '../dockerService': { getBaseAppName: (id) => id.replace(/^flux/, '').replace(/^zel/, '') },
    });
  });

  afterEach(() => sinon.restore());

  describe('operatorStopped', () => {
    it('persists the stop lock and reads it back', async () => {
      await appsRuntimeState.setOperatorStopped('www_App', true);
      expect(await appsRuntimeState.isOperatorStopped('www_App')).to.be.true;
    });

    it('defaults to not-stopped for an unknown component', async () => {
      expect(await appsRuntimeState.isOperatorStopped('nope_App')).to.be.false;
    });

    it('clearing the lock (start) also clears the restart backoff history', async () => {
      await appsRuntimeState.recordRestart('www_App');
      await appsRuntimeState.recordRestart('www_App');
      expect(store.get('www_App').restartHistory).to.have.lengthOf(2);

      await appsRuntimeState.setOperatorStopped('www_App', false);
      expect(await appsRuntimeState.isOperatorStopped('www_App')).to.be.false;
      expect(store.get('www_App').restartHistory).to.deep.equal([]);
    });
  });

  describe('restartHistory + backoff', () => {
    it('caps restartHistory at the ladder length', async () => {
      for (let i = 0; i < appsRuntimeState.MAX_HISTORY + 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await appsRuntimeState.recordRestart('www_App');
      }
      expect(store.get('www_App').restartHistory).to.have.lengthOf(appsRuntimeState.MAX_HISTORY);
    });

    it('restartWaitMs is 0 with no history (restart immediately)', async () => {
      expect(await appsRuntimeState.restartWaitMs('www_App')).to.equal(0);
    });

    it('returns the remaining ladder delay and counts down', async () => {
      const clock = sinon.useFakeTimers();
      await appsRuntimeState.recordRestart('www_App'); // history length 1 -> ladder[1] = 30s
      expect(await appsRuntimeState.restartWaitMs('www_App')).to.equal(30 * 1000);
      clock.tick(10 * 1000);
      expect(await appsRuntimeState.restartWaitMs('www_App')).to.equal(20 * 1000);
      clock.tick(20 * 1000);
      expect(await appsRuntimeState.restartWaitMs('www_App')).to.equal(0);
      clock.restore();
    });

    it('escalates up the ladder and caps at 30m', async () => {
      const clock = sinon.useFakeTimers();
      const ladder = appsRuntimeState.BACKOFF_DELAYS_MS;
      // record enough restarts to reach and exceed the cap, ticking past each wait
      for (let i = 1; i < ladder.length + 2; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await appsRuntimeState.recordRestart('www_App');
        // eslint-disable-next-line no-await-in-loop
        const wait = await appsRuntimeState.restartWaitMs('www_App');
        const expected = ladder[Math.min(i, ladder.length - 1)];
        expect(wait).to.equal(expected);
        clock.tick(expected); // advance to allow next
      }
      // capped at the last ladder entry (30m)
      clock.restore();
    });

  });

  describe('exit + remove', () => {
    it('records the last exit code and time', async () => {
      await appsRuntimeState.recordExit('www_App', 137);
      const state = await appsRuntimeState.getState('www_App');
      expect(state.lastExitCode).to.equal(137);
      expect(state.lastDiedAt).to.be.a('number');
    });

    it('remove drops all runtime state for a component', async () => {
      await appsRuntimeState.setOperatorStopped('www_App', true);
      await appsRuntimeState.remove('www_App');
      expect(store.has('www_App')).to.be.false;
    });
  });

  describe('backoff ladder reset requires a stable RUN (not time since the attempt)', () => {
    // "Stable" must mean the container provably RAN for STABLE_RUN_MS - measured
    // from the last start to the death. Time spent sitting stopped in backoff is
    // not stability: resetting on time-since-attempt launders a crash loop's
    // history at any rung longer than STABLE_RUN_MS, making the cap unreachable.
    // Death evidence comes from the recorded die event OR docker's State.FinishedAt
    // (passed in by the reconciler from the inspect it already performed) - docker
    // records the true death time even when the event was missed (reboot, FluxOS
    // restart, stream gap).
    let clock;

    beforeEach(() => {
      clock = sinon.useFakeTimers({ now: 1_000_000_000 });
    });

    afterEach(() => clock.restore());

    it('walks the full ladder to the cap on a continuous crash loop (waits honored)', async () => {
      const id = 'www_App';
      const runMs = 20 * 1000; // each run crashes after 20s
      let lastWait = null;

      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        let wait = await appsRuntimeState.restartWaitMs(id);
        if (wait > 0) {
          clock.tick(wait); // reconciler defers exactly this long
          // eslint-disable-next-line no-await-in-loop
          wait = await appsRuntimeState.restartWaitMs(id);
        }
        expect(wait).to.equal(0);
        lastWait = null;
        // eslint-disable-next-line no-await-in-loop
        await appsRuntimeState.recordRestart(id);
        clock.tick(runMs);
        // eslint-disable-next-line no-await-in-loop
        await appsRuntimeState.recordExit(id, 1);
        // eslint-disable-next-line no-await-in-loop
        lastWait = await appsRuntimeState.restartWaitMs(id);
      }

      // the cap rung must be reachable and sticky: 30m minus the 20s run
      expect(lastWait).to.equal(appsRuntimeState.BACKOFF_DELAYS_MS[appsRuntimeState.BACKOFF_DELAYS_MS.length - 1] - runMs);
      expect(store.get('www_App').restartHistory.length).to.be.at.least(4);
    });

    it('holds the history when docker FinishedAt shows the run was short (die event lost)', async () => {
      const id = 'www_App';
      await appsRuntimeState.recordRestart(id);
      const startedAt = Date.now();
      clock.tick(15 * 60 * 1000); // sat stopped for 15 minutes, death never recorded

      await appsRuntimeState.restartWaitMs(id, startedAt + 5000); // docker: died 5s after start

      expect(store.get('www_App').restartHistory).to.have.lengthOf(1); // not laundered
    });

    it('resets at boot when FinishedAt shows the previous run was stable (deaths unrecorded while FluxOS was down)', async () => {
      const id = 'www_App';
      await appsRuntimeState.recordExit(id, 1); // an old crash, long before this run
      clock.tick(1000);
      await appsRuntimeState.recordRestart(id);
      const startedAt = Date.now();
      clock.tick(3 * 24 * 60 * 60 * 1000); // ran for days; died during reboot, no event

      const wait = await appsRuntimeState.restartWaitMs(id, startedAt + (2 * 24 * 60 * 60 * 1000));

      expect(wait).to.equal(0);
      expect(store.get('www_App').restartHistory).to.deep.equal([]);
    });

    it('resets after a recorded stable run (die event present)', async () => {
      const id = 'www_App';
      await appsRuntimeState.recordRestart(id);
      clock.tick(11 * 60 * 1000); // ran 11 minutes
      await appsRuntimeState.recordExit(id, 1);

      const wait = await appsRuntimeState.restartWaitMs(id);

      expect(wait).to.equal(0);
      expect(store.get('www_App').restartHistory).to.deep.equal([]);
    });

    it('holds the history when there is no death evidence at all', async () => {
      const id = 'www_App';
      await appsRuntimeState.recordRestart(id);
      clock.tick(60 * 60 * 1000); // an hour since the attempt, nothing else known

      const wait = await appsRuntimeState.restartWaitMs(id);

      expect(wait).to.equal(0); // the hour exceeds every rung - restart now
      expect(store.get('www_App').restartHistory).to.have.lengthOf(1); // but no laundering
    });
  });

  describe('config-tunable ladder (harness compression)', () => {
    it('reads the ladder and stable-run window from config when present', () => {
      const tuned = proxyquire('../../ZelBack/src/services/appManagement/appsRuntimeState', {
        '../../lib/log': logStub,
        '../dbHelper': {},
        '../dockerService': { getBaseAppName: (id) => id },
        config: {
          database: { appslocal: { database: 'localzelapps', collections: { appsRuntimeState: 'zelappsruntimestate' } } },
          fluxapps: { crashBackoffDelaysMs: [0, 1000, 2000], crashBackoffStableRunMs: 5000 },
        },
      });
      expect(tuned.BACKOFF_DELAYS_MS).to.deep.equal([0, 1000, 2000]);
      expect(tuned.STABLE_RUN_MS).to.equal(5000);
      expect(tuned.MAX_HISTORY).to.equal(3);
    });
  });

  describe('identifier namespace (storage-boundary normalization)', () => {
    // The collection is keyed by the bare component identifier. All six current
    // call sites pass that form by convention, but convention across files is not
    // an invariant: a future caller passing the docker-prefixed form would create
    // a same-component twin the unique index cannot see (different key strings).
    // The module therefore normalizes at its own boundary.
    it('keys a docker-prefixed identifier and its bare form to the same document', async () => {
      await appsRuntimeState.setOperatorStopped('fluxwww_App', true);
      expect(await appsRuntimeState.isOperatorStopped('www_App')).to.be.true;
      expect(store.has('fluxwww_App')).to.be.false;
    });

    it('removes under either form', async () => {
      await appsRuntimeState.setOperatorStopped('www_App', true);
      await appsRuntimeState.remove('fluxwww_App');
      expect(await appsRuntimeState.isOperatorStopped('www_App')).to.be.false;
    });
  });

  describe('setFields duplicate-key retry', () => {
    // Under a unique index, the loser of a concurrent first-upsert THROWS E11000
    // instead of converting to an update (mongo behavior). The document exists at
    // that point, so one retry takes the update path; without it the loser's
    // write - possibly the operator stop lock - is silently dropped.
    let updateStub;
    let retryState;

    beforeEach(() => {
      updateStub = sinon.stub();
      retryState = proxyquire('../../ZelBack/src/services/appManagement/appsRuntimeState', {
        '../../lib/log': logStub,
        '../dbHelper': {
          databaseConnection: () => ({ db: () => ({}) }),
          findOneInDatabase: async () => null,
          updateOneInDatabase: updateStub,
        },
        '../dockerService': { getBaseAppName: (id) => id },
      });
    });

    it('retries once when the upsert loses a concurrent-insert race (E11000)', async () => {
      const dup = new Error('E11000 duplicate key error');
      dup.code = 11000;
      updateStub.onFirstCall().rejects(dup);
      updateStub.onSecondCall().resolves();

      await retryState.setOperatorStopped('www_App', true);

      expect(updateStub.callCount).to.equal(2);
      expect(updateStub.secondCall.args[3].$set.operatorStopped).to.equal(true);
      sinon.assert.notCalled(logStub.error);
    });

    it('gives up after one retry on a persistent duplicate-key failure and surfaces it', async () => {
      const dup = new Error('E11000 duplicate key error');
      dup.code = 11000;
      updateStub.rejects(dup);

      let thrown = null;
      await retryState.setOperatorStopped('www_App', true).catch((e) => { thrown = e; });

      expect(updateStub.callCount).to.equal(2); // exactly one retry, no loop
      expect(thrown).to.be.an('error');
    });

    it('does not retry non-duplicate errors', async () => {
      updateStub.rejects(new Error('network blip'));

      let thrown = null;
      await retryState.setOperatorStopped('www_App', true).catch((e) => { thrown = e; });

      expect(updateStub.callCount).to.equal(1);
      expect(thrown).to.be.an('error');
    });

    it('propagates a lock-write failure to the caller (API must not report success)', async () => {
      // The stop lock is the contract that the reconciler will not restart the
      // app. Swallowing the write failure makes the API report success while the
      // lock silently never persisted - the reconciler then restarts the app the
      // operator just stopped.
      updateStub.rejects(new Error('db unavailable'));

      let thrown = null;
      await retryState.setOperatorStopped('www_App', true).catch((e) => { thrown = e; });

      expect(thrown).to.be.an('error');
      expect(thrown.message).to.include('db unavailable');
    });
  });

  describe('prepareCollection (merge-dedupe + unique index)', () => {
    // Fleet nodes wrote into this collection before the unique index existed, so
    // same-identifier twins may exist - and because every later updateOne matched
    // an arbitrary twin, fields SCATTER across them (the lock on one, the backoff
    // history on the other). Dedupe must merge field-wise: dropping a doc whole
    // could drop a real operator lock, whose loss auto-starts a deliberately
    // stopped app. Then the unique index makes twins impossible.
    let docs;
    let removed;
    let upserts;
    let createIndexStub;
    let prepState;

    beforeEach(() => {
      removed = [];
      upserts = [];
      createIndexStub = sinon.stub().resolves();
      prepState = proxyquire('../../ZelBack/src/services/appManagement/appsRuntimeState', {
        '../../lib/log': logStub,
        '../dbHelper': {
          databaseConnection: () => ({ db: () => ({ collection: () => ({ createIndex: createIndexStub }) }) }),
          findInDatabase: async () => docs,
          removeDocumentsFromCollection: async (_db, _coll, query) => { removed.push(query.identifier); },
          updateOneInDatabase: async (_db, _coll, query, update) => { upserts.push({ query, set: update.$set }); },
        },
        '../dockerService': { getBaseAppName: (id) => id },
      });
    });

    it('merges twins field-wise: lock is OR, histories union, newest exit wins', async () => {
      docs = [
        {
          identifier: 'www_App', operatorStopped: true, restartHistory: [100, 200], updatedAt: 1000,
        },
        {
          identifier: 'www_App', restartHistory: [200, 300], lastExitCode: 137, lastDiedAt: 5000, updatedAt: 9000,
        },
      ];

      await prepState.prepareCollection();

      expect(removed).to.deep.equal(['www_App']);
      expect(upserts).to.have.lengthOf(1);
      const merged = upserts[0].set;
      expect(merged.operatorStopped).to.equal(true); // the lock survives the merge
      expect(merged.restartHistory).to.deep.equal([100, 200, 300]);
      expect(merged.lastExitCode).to.equal(137);
      expect(merged.lastDiedAt).to.equal(5000);
      sinon.assert.called(logStub.warn);
    });

    it('trims a merged history to the ladder length', async () => {
      const longA = Array.from({ length: 6 }, (_, i) => i + 1);
      const longB = Array.from({ length: 6 }, (_, i) => i + 100);
      docs = [
        { identifier: 'www_App', restartHistory: longA, updatedAt: 1 },
        { identifier: 'www_App', restartHistory: longB, updatedAt: 2 },
      ];

      await prepState.prepareCollection();

      const merged = upserts[0].set;
      expect(merged.restartHistory).to.have.lengthOf(prepState.MAX_HISTORY);
      // keeps the newest entries
      expect(merged.restartHistory[merged.restartHistory.length - 1]).to.equal(105);
    });

    it('leaves singleton documents untouched and still creates the unique index', async () => {
      docs = [
        { identifier: 'www_App', operatorStopped: true, updatedAt: 1 },
        { identifier: 'db_App', restartHistory: [1], updatedAt: 2 },
      ];

      await prepState.prepareCollection();

      expect(removed).to.deep.equal([]);
      expect(upserts).to.deep.equal([]);
      sinon.assert.calledOnce(createIndexStub);
      expect(createIndexStub.firstCall.args[0]).to.deep.equal({ identifier: 1 });
      expect(createIndexStub.firstCall.args[1]).to.deep.include({ unique: true });
    });
  });
});
