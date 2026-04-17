const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appTamperingDetectionService tests', () => {
  let service;
  let dbHelperStub;
  let insertedDocs;
  let findResults;
  let lastFindArgs;
  let databaseConnectionReturn;

  beforeEach(() => {
    insertedDocs = [];
    findResults = [];
    lastFindArgs = null;

    databaseConnectionReturn = {
      db: sinon.stub().returns({ name: 'mockdb' }),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub().callsFake(() => databaseConnectionReturn),
      insertOneToDatabase: sinon.stub().callsFake(async (db, coll, doc) => {
        insertedDocs.push({ db, coll, doc });
        return { insertedId: 'mock-id' };
      }),
      findInDatabase: sinon.stub().callsFake(async (db, coll, query, options) => {
        lastFindArgs = { db, coll, query, options };
        return findResults;
      }),
    };

    service = proxyquire('../../ZelBack/src/services/appTamperingDetectionService', {
      config: {
        database: {
          local: {
            database: 'zelfluxlocal',
            collections: { appTamperingEvents: 'apptamperingevents' },
          },
        },
      },
      './dbHelper': dbHelperStub,
      '../lib/log': {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
      },
      './messageHelper': {
        createDataMessage: (d) => ({ status: 'success', data: d }),
        createErrorMessage: (m) => ({ status: 'error', data: { message: m } }),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('isNetworkMissingError', () => {
    it('returns false for null/empty/undefined', () => {
      expect(service.isNetworkMissingError(null)).to.be.false;
      expect(service.isNetworkMissingError('')).to.be.false;
      expect(service.isNetworkMissingError(undefined)).to.be.false;
    });

    it('returns false for messages without "network"', () => {
      expect(service.isNetworkMissingError('container failed to start')).to.be.false;
      expect(service.isNetworkMissingError('disk full')).to.be.false;
    });

    it('returns false for generic network errors that are not "missing"', () => {
      expect(service.isNetworkMissingError('network timeout')).to.be.false;
      expect(service.isNetworkMissingError('network unreachable')).to.be.false;
      expect(service.isNetworkMissingError('network is flaky')).to.be.false;
    });

    it('returns true for "network not found"', () => {
      expect(service.isNetworkMissingError('network foo not found')).to.be.true;
    });

    it('returns true for "no such network"', () => {
      expect(service.isNetworkMissingError('no such network: fluxnet')).to.be.true;
    });

    it('returns true for "network ... does not exist"', () => {
      expect(service.isNetworkMissingError('docker network abc does not exist')).to.be.true;
    });

    it('returns true for "network ... missing"', () => {
      expect(service.isNetworkMissingError('network bridge missing from host')).to.be.true;
    });

    it('is case-insensitive', () => {
      expect(service.isNetworkMissingError('NETWORK Not Found')).to.be.true;
      expect(service.isNetworkMissingError('No Such Network')).to.be.true;
    });

    it('coerces non-string input safely', () => {
      expect(service.isNetworkMissingError({ toString: () => 'network not found' })).to.be.true;
      expect(service.isNetworkMissingError(123)).to.be.false;
    });
  });

  describe('recordEvent', () => {
    it('inserts a new document with expected shape', async () => {
      await service.recordEvent('myapp', 'container_vanished', 'details here');

      expect(insertedDocs).to.have.lengthOf(1);
      const { coll, doc } = insertedDocs[0];
      expect(coll).to.equal('apptamperingevents');
      expect(doc.appName).to.equal('myapp');
      expect(doc.eventType).to.equal('container_vanished');
      expect(doc.details).to.equal('details here');
      expect(doc.detectedAt).to.be.instanceOf(Date);
    });

    it('inserts a NEW row on every call (does not upsert)', async () => {
      await service.recordEvent('myapp', 'mount_vanished', 'a');
      await service.recordEvent('myapp', 'mount_vanished', 'b');
      await service.recordEvent('myapp', 'mount_vanished', 'c');

      expect(insertedDocs).to.have.lengthOf(3);
      expect(insertedDocs.map((x) => x.doc.details)).to.deep.equal(['a', 'b', 'c']);
    });

    it('no-ops when DB is not available', async () => {
      databaseConnectionReturn = null;
      dbHelperStub.databaseConnection = sinon.stub().returns(null);

      await service.recordEvent('myapp', 'container_vanished', 'x');

      expect(dbHelperStub.insertOneToDatabase.called).to.be.false;
    });

    it('swallows insert errors without throwing', async () => {
      dbHelperStub.insertOneToDatabase = sinon.stub().rejects(new Error('boom'));

      await service.recordEvent('myapp', 'container_vanished', 'x');
      // no assertion needed — test passes if no error thrown
    });
  });

  describe('getEvents', () => {
    function makeRes() {
      const res = {};
      res.json = sinon.stub().returns(res);
      return res;
    }

    it('returns all events when no appname filter, sorted by detectedAt desc', async () => {
      findResults = [
        { appName: 'a', eventType: 'x', detectedAt: new Date() },
      ];
      const req = { params: {}, query: {} };
      const res = makeRes();

      await service.getEvents(req, res);

      expect(lastFindArgs.coll).to.equal('apptamperingevents');
      expect(lastFindArgs.query).to.deep.equal({});
      expect(lastFindArgs.options.sort).to.deep.equal({ detectedAt: -1 });
      expect(lastFindArgs.options.projection).to.deep.equal({ _id: 0 });
      sinon.assert.calledWith(res.json, sinon.match({ status: 'success' }));
    });

    it('filters by appname from params', async () => {
      const req = { params: { appname: 'myapp' }, query: {} };
      const res = makeRes();

      await service.getEvents(req, res);

      expect(lastFindArgs.query).to.deep.equal({ appName: 'myapp' });
    });

    it('filters by appname from query string when params missing', async () => {
      const req = { params: {}, query: { appname: 'otherapp' } };
      const res = makeRes();

      await service.getEvents(req, res);

      expect(lastFindArgs.query).to.deep.equal({ appName: 'otherapp' });
    });

    it('returns an error message when the query throws', async () => {
      dbHelperStub.findInDatabase = sinon.stub().rejects(new Error('db down'));
      const req = { params: {}, query: {} };
      const res = makeRes();

      await service.getEvents(req, res);

      sinon.assert.calledWith(res.json, sinon.match({ status: 'error' }));
    });
  });
});
