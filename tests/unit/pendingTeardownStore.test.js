const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('pendingTeardownStore tests', () => {
  let dbHelperStub;
  let logStub;
  let configStub;

  function build() {
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
      findOneInDatabase: sinon.stub(),
    };
    logStub = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
    configStub = {
      database: {
        appslocal: {
          database: 'localapps',
          collections: { pendingAppTeardowns: 'zelappspendingteardowns' },
        },
      },
    };
    return proxyquire('../../ZelBack/src/services/appLifecycle/pendingTeardownStore', {
      config: configStub,
      '../../lib/log': logStub,
      '../dbHelper': dbHelperStub,
    });
  }

  afterEach(() => {
    sinon.restore();
  });

  describe('teardownOwedFor', () => {
    it('returns true when a teardown doc exists for the name', async () => {
      const store = build();
      dbHelperStub.findOneInDatabase.resolves({ key: 'comp_app' });
      expect(await store.teardownOwedFor('app')).to.equal(true);
    });

    it('returns false when no teardown doc exists for the name', async () => {
      const store = build();
      dbHelperStub.findOneInDatabase.resolves(null);
      expect(await store.teardownOwedFor('app')).to.equal(false);
    });

    it('FAILS CLOSED (returns true) on a DB read error so an install never races a live rm -rf', async () => {
      const store = build();
      dbHelperStub.findOneInDatabase.rejects(new Error('db blip'));
      // A read failure must NOT admit the install (the per-app removal gate is already
      // released before Phase B's rm -rf, so this read is the only thing guarding it).
      expect(await store.teardownOwedFor('app')).to.equal(true);
    });
  });
});
