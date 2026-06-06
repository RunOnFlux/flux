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

    it('resets the backoff after a stable run (>10m since last restart)', async () => {
      const clock = sinon.useFakeTimers();
      await appsRuntimeState.recordRestart('www_App');
      await appsRuntimeState.recordRestart('www_App');
      clock.tick(appsRuntimeState.STABLE_RUN_MS + 1000);
      expect(await appsRuntimeState.restartWaitMs('www_App')).to.equal(0);
      expect(store.get('www_App').restartHistory).to.deep.equal([]); // cleared
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
});
