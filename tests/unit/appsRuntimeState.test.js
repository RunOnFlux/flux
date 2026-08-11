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
      // The fake honors projections the way mongo does: a query that stops
      // selecting a field loses that field here too. operatorStoppedIdentifiers
      // reads doc.identifier off an unauthenticated peer route, and a stub that
      // ignores the projection serves the field regardless - the seam where a
      // wrong projection answers [] to an election in production while every
      // test stays green.
      findInDatabase: async (_db, _coll, query = {}, options = {}) => {
        const docs = [...store.values()]
          .filter((doc) => Object.entries(query).every(([field, value]) => doc[field] === value));
        const projection = options.projection || {};
        const included = Object.entries(projection)
          .filter(([field, mode]) => mode === 1 && field !== '_id')
          .map(([field]) => field);
        if (included.length) {
          return docs.map((doc) => Object.fromEntries(
            included.filter((field) => field in doc).map((field) => [field, doc[field]]),
          ));
        }
        const excluded = Object.keys(projection).filter((field) => projection[field] === 0);
        if (excluded.length) {
          return docs.map((doc) => Object.fromEntries(
            Object.entries(doc).filter(([field]) => !excluded.includes(field)),
          ));
        }
        return docs;
      },
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
 
    // The set, not one component at a time. This is what a peer is told this node
    // owns, so it is read on an unauthenticated route at election cadence.
    describe('operatorStoppedIdentifiers', () => {
      it('lists only the components carrying the lock', async () => {
        await appsRuntimeState.setOperatorStopped('www_App', true);
        await appsRuntimeState.setOperatorStopped('db_App', true);
        await appsRuntimeState.recordRestart('api_App'); // a row, but no lock

        const stopped = await appsRuntimeState.operatorStoppedIdentifiers();

        expect(stopped.sort()).to.deep.equal(['db_App', 'www_App']);
      });

      it('is empty when nothing is stopped, and distinguishes that from unreadable', async () => {
        expect(await appsRuntimeState.operatorStoppedIdentifiers()).to.deep.equal([]);
      });

      it('drops a component whose lock was lifted', async () => {
        await appsRuntimeState.setOperatorStopped('www_App', true);
        await appsRuntimeState.setOperatorStopped('www_App', false);

        expect(await appsRuntimeState.operatorStoppedIdentifiers()).to.deep.equal([]);
      });

      it('THROWS when the store cannot be read, rather than reporting nothing stopped', async () => {
        // getState swallows and answers "no lock" because its callers act on this
        // node and get another pass. This answer leaves the node: an empty list
        // tells a peer the component is free, and the peer starts a second writer
        // on the shared volume. A read it could not perform must not look like a
        // read that found nothing.
        const failing = proxyquire('../../ZelBack/src/services/appManagement/appsRuntimeState', {
          '../../lib/log': logStub,
          '../dbHelper': {
            databaseConnection: () => ({ db: () => ({}) }),
            findInDatabase: async () => { throw new Error('no primary available'); },
          },
          '../dockerService': { getBaseAppName: (id) => id },
        });

        let threw = null;
        await failing.operatorStoppedIdentifiers().catch((err) => { threw = err; });

        expect(threw, 'an unreadable lock store answered as an empty one').to.be.an('error');
        expect(threw.message).to.include('no primary available');
      });
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

  describe('a clean exit is not a crash (and the burst window is what catches the ones that lie)', () => {
    // Docker's exit code cannot be trusted to mean "no fault": an image whose
    // entrypoint is a wrapper script ending in `exit 0` reports a clean stop for
    // a segfault, and nothing we wrap around the container can recover a status
    // the image already threw away. So the code is used only in the direction it
    // is sound - non-zero PROVES a fault, zero proves nothing - and the burst
    // window is the backstop for everything the code hid.
    let clock;

    beforeEach(() => { clock = sinon.useFakeTimers({ now: 1_000_000_000 }); });
    afterEach(() => clock.restore());

    it('restarts a clean exit immediately and leaves the ladder untouched', async () => {
      await appsRuntimeState.recordRestart('www_App', false);
      expect(store.get('www_App').restartHistory, 'no ladder entry for a clean exit').to.be.undefined;
      expect(await appsRuntimeState.restartWaitMs('www_App', null, false)).to.equal(0);
    });

    it('does not spend a rung built by earlier crashes on an operator restart', async () => {
      await appsRuntimeState.recordRestart('www_App', true);
      await appsRuntimeState.recordRestart('www_App', true);
      expect(await appsRuntimeState.restartWaitMs('www_App', null, true), 'a crash is still paced').to.be.above(0);

      clock.tick(1000);
      expect(await appsRuntimeState.restartWaitMs('www_App', null, false), 'the operator is not').to.equal(0);
      expect(store.get('www_App').restartHistory, 'and the rungs are still there for the next crash').to.have.lengthOf(2);
    });

    it('paces a container restarting faster than the burst window, whatever the exit code says', async () => {
      const id = 'www_App';
      for (let i = 0; i < appsRuntimeState.RESTART_BURST_COUNT; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        expect(await appsRuntimeState.restartWaitMs(id, null, false), `restart ${i} is free`).to.equal(0);
        // eslint-disable-next-line no-await-in-loop
        await appsRuntimeState.recordRestart(id, false);
        clock.tick(1000);
      }
      expect(store.get(id).restartHistory, 'still no ladder entry while under the burst').to.be.undefined;

      // the window is now full, so this restart is the one over the line
      await appsRuntimeState.recordRestart(id, false);
      expect(store.get(id).restartHistory, 'the trip is recorded as a crash would be').to.have.lengthOf(1);
      expect(await appsRuntimeState.restartWaitMs(id, null, false)).to.equal(appsRuntimeState.BACKOFF_DELAYS_MS[1]);
    });

    it('never trips on restarts spaced wider than the window', async () => {
      const id = 'www_App';
      for (let i = 0; i < appsRuntimeState.RESTART_BURST_COUNT * 2; i += 1) {
        clock.tick(appsRuntimeState.RESTART_BURST_WINDOW_MS);
        // eslint-disable-next-line no-await-in-loop
        expect(await appsRuntimeState.restartWaitMs(id, null, false), `restart ${i}`).to.equal(0);
        // eslint-disable-next-line no-await-in-loop
        await appsRuntimeState.recordRestart(id, false);
      }
      expect(store.get(id).restartHistory).to.be.undefined;
    });

    // How far the ceiling reaches is window/count, NOT the window: the check runs
    // BEFORE the append, so the five entries it judges span five gaps. Nothing
    // pinned that derived number, and the PR body described the reach as "a
    // minute or two" while the shipped values reached twelve seconds.
    const spacingIsPaced = async (id, spacingMs) => {
      for (let i = 0; i < appsRuntimeState.RESTART_BURST_COUNT * 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        if (await appsRuntimeState.restartWaitMs(id, null, false) > 0) return true;
        // eslint-disable-next-line no-await-in-loop
        await appsRuntimeState.recordRestart(id, false);
        clock.tick(spacingMs);
      }
      return false;
    };

    it('reaches restarts spaced window/count apart, and nothing slower', async () => {
      const reach = appsRuntimeState.RESTART_BURST_WINDOW_MS / appsRuntimeState.RESTART_BURST_COUNT;
      expect(await spacingIsPaced('atReach_App', reach), 'at the reach').to.equal(true);
      expect(await spacingIsPaced('pastReach_App', reach + 1), 'one millisecond past it').to.equal(false);
    });

    // The reach is a product decision, not just a mechanism: an image that
    // launders its exit status has no other protection, so what the shipped
    // configuration actually catches is the whole guarantee. Asserted in seconds
    // on purpose - a test derived from the same constants cannot notice them
    // being retuned, which is how the twelve-second reach went unnoticed.
    it('paces a laundered-exit container dying every 30 seconds', async () => {
      expect(await spacingIsPaced('halfMinute_App', 30_000)).to.equal(true);
    });

    it('leaves a container restarting every 90 seconds alone', async () => {
      expect(await spacingIsPaced('ninetySeconds_App', 90_000)).to.equal(false);
    });

    it('caps the burst window so a permanently restarting container cannot grow the document', async () => {
      for (let i = 0; i < appsRuntimeState.RESTART_BURST_COUNT + 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await appsRuntimeState.recordRestart('www_App', false);
      }
      expect(store.get('www_App').autoRestartWindow).to.have.lengthOf(appsRuntimeState.RESTART_BURST_COUNT);
    });

    it('a deliberate start clears the burst window, not just the ladder', async () => {
      for (let i = 0; i < appsRuntimeState.RESTART_BURST_COUNT; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await appsRuntimeState.recordRestart('www_App', false);
      }
      await appsRuntimeState.setOperatorStopped('www_App', false);
      expect(store.get('www_App').autoRestartWindow).to.deep.equal([]);
      expect(await appsRuntimeState.restartWaitMs('www_App', null, false), 'starts from clean').to.equal(0);
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
          fluxapps: {
            crashBackoffDelaysMs: [0, 1000, 2000],
            crashBackoffStableRunMs: 5000,
            restartBurstCount: 3,
            restartBurstWindowMs: 2000,
          },
        },
      });
      expect(tuned.BACKOFF_DELAYS_MS).to.deep.equal([0, 1000, 2000]);
      expect(tuned.STABLE_RUN_MS).to.equal(5000);
      expect(tuned.MAX_HISTORY).to.equal(3);
      expect(tuned.RESTART_BURST_COUNT).to.equal(3);
      expect(tuned.RESTART_BURST_WINDOW_MS).to.equal(2000);
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

  describe('networkHealRemoval (durable "I removed this container on purpose")', () => {
    it('persists the flag and reads it back', async () => {
      await appsRuntimeState.setNetworkHealRemoval('www_App', true);
      expect(await appsRuntimeState.isNetworkHealRemoval('www_App')).to.be.true;
    });

    it('defaults to false for an unknown component', async () => {
      expect(await appsRuntimeState.isNetworkHealRemoval('nope_App')).to.be.false;
    });

    it('clears the flag', async () => {
      await appsRuntimeState.setNetworkHealRemoval('www_App', true);
      await appsRuntimeState.clearNetworkHeal('www_App');
      expect(await appsRuntimeState.isNetworkHealRemoval('www_App')).to.be.false;
    });

    it('a read failure throws rather than reporting "not a heal removal"', async () => {
      // reading false on a DB blip is the DESTRUCTIVE guess: the reconciler would
      // treat its own removal as a vanished container and can uninstall the app.
      const failing = proxyquire('../../ZelBack/src/services/appManagement/appsRuntimeState', {
        '../../lib/log': logStub,
        '../dbHelper': {
          databaseConnection: () => ({ db: () => ({}) }),
          findOneInDatabase: async () => { throw new Error('db unavailable'); },
          updateOneInDatabase: async () => {},
          removeDocumentsFromCollection: async () => {},
        },
        '../dockerService': { getBaseAppName: (id) => id },
      });

      let thrown = null;
      await failing.isNetworkHealRemoval('www_App').catch((e) => { thrown = e; });

      expect(thrown, 'must not silently answer false').to.be.an('error');
    });

    it('is dropped with the rest of the component state on uninstall', async () => {
      await appsRuntimeState.setNetworkHealRemoval('www_App', true);
      await appsRuntimeState.remove('www_App');
      expect(await appsRuntimeState.isNetworkHealRemoval('www_App')).to.be.false;
    });

    it('survives a process restart: a fresh module instance reads the persisted flag', async () => {
      // this is the whole point of the flag - an in-memory map would lose the fact
      // that the reconciler removed the container itself, and the next process would
      // read the absence as tampering
      await appsRuntimeState.setNetworkHealRemoval('www_App', true);

      const restarted = proxyquire('../../ZelBack/src/services/appManagement/appsRuntimeState', {
        '../../lib/log': logStub,
        '../dbHelper': {
          databaseConnection: () => ({ db: () => ({}) }),
          findOneInDatabase: async (_db, _coll, query) => store.get(query.identifier) || null,
          updateOneInDatabase: async () => {},
          removeDocumentsFromCollection: async () => {},
        },
        '../dockerService': { getBaseAppName: (id) => id.replace(/^flux/, '').replace(/^zel/, '') },
      });

      expect(await restarted.isNetworkHealRemoval('www_App')).to.be.true;
    });
  });

  describe('network heal ladder (separate from the crash-restart ladder)', () => {
    it('allows the first attempt immediately, then paces the next ones', async () => {
      expect(await appsRuntimeState.networkHealWaitMs('www_App')).to.equal(0);

      await appsRuntimeState.recordNetworkHealAttempt('www_App');
      expect(await appsRuntimeState.networkHealWaitMs('www_App'), 'the second attempt waits').to.be.above(0);
    });

    it('does not touch the crash-restart backoff', async () => {
      // sharing restartHistory would hold down the very container the heal just
      // recreated (a g: component is created, not started, so the next pass reads the
      // ladder the heal grew) - and would block a heal for a crash-looping container
      await appsRuntimeState.recordNetworkHealAttempt('www_App');
      await appsRuntimeState.recordNetworkHealAttempt('www_App');

      expect(await appsRuntimeState.restartWaitMs('www_App'), 'the restart ladder is untouched').to.equal(0);
      expect(store.get('www_App').restartHistory).to.equal(undefined);
    });

    it('is reset once the container is healthy, so a later episode starts from the bottom', async () => {
      await appsRuntimeState.recordNetworkHealAttempt('www_App');
      await appsRuntimeState.recordNetworkHealAttempt('www_App');
      expect(await appsRuntimeState.networkHealWaitMs('www_App')).to.be.above(0);

      await appsRuntimeState.clearNetworkHeal('www_App');

      expect(await appsRuntimeState.networkHealWaitMs('www_App')).to.equal(0);
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
