const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appTamperingDetectionService tests', () => {
  let service;
  let dbHelperStub;
  let logStub;
  let fsReadFileStub;
  let insertedDocs;
  let findResults;
  let lastFindArgs;
  let databaseConnectionReturn;

  const CURRENT_BOOT_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PREVIOUS_BOOT_ID = 'bbbbbbbb-5555-6666-7777-888888888888';

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
        lastFindArgs = {
          db, coll, query, options,
        };
        return findResults;
      }),
      findOneInDatabase: sinon.stub().resolves(null),
      findOneAndUpdateInDatabase: sinon.stub().resolves({ value: null }),
      removeDocumentsFromCollection: sinon.stub().resolves({ deletedCount: 0 }),
    };

    logStub = {
      info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
    };

    fsReadFileStub = sinon.stub().resolves(`${CURRENT_BOOT_ID}\n`);

    service = proxyquire('../../ZelBack/src/services/appTamperingDetectionService', {
      config: {
        database: {
          local: {
            database: 'zelfluxlocal',
            collections: {
              appTamperingEvents: 'apptamperingevents',
              nodeStartupTracker: 'nodestartuptracker',
            },
          },
        },
        system: {
          bootIdPath: '/proc/sys/kernel/random/boot_id',
        },
      },
      fs: {
        promises: { readFile: fsReadFileStub },
      },
      './dbHelper': dbHelperStub,
      '../lib/log': logStub,
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

    it('suppresses repeat (appName, eventType) calls within the episode window', async () => {
      await service.recordEvent('myapp', 'mount_vanished', 'a');
      await service.recordEvent('myapp', 'mount_vanished', 'b');
      await service.recordEvent('myapp', 'mount_vanished', 'c');

      expect(insertedDocs).to.have.lengthOf(1);
      expect(insertedDocs[0].doc.details).to.equal('a');
    });

    it('records different event types for the same app independently', async () => {
      await service.recordEvent('myapp', 'container_vanished', 'a');
      await service.recordEvent('myapp', 'recreation_failed', 'b');

      expect(insertedDocs).to.have.lengthOf(2);
    });

    it('records the same event type for different apps independently', async () => {
      await service.recordEvent('app1', 'mount_vanished', 'a');
      await service.recordEvent('app2', 'mount_vanished', 'b');

      expect(insertedDocs).to.have.lengthOf(2);
    });

    it('records again once the episode window has elapsed', async () => {
      const clock = sinon.useFakeTimers(new Date('2026-07-16T00:00:00Z'));

      await service.recordEvent('myapp', 'mount_vanished', 'first episode');
      clock.tick(service.EPISODE_WINDOW_MS);
      await service.recordEvent('myapp', 'mount_vanished', 'second episode');

      expect(insertedDocs).to.have.lengthOf(2);
    });

    it('still suppresses just before the episode window elapses', async () => {
      const clock = sinon.useFakeTimers(new Date('2026-07-16T00:00:00Z'));

      await service.recordEvent('myapp', 'mount_vanished', 'first');
      clock.tick(service.EPISODE_WINDOW_MS - 1);
      await service.recordEvent('myapp', 'mount_vanished', 'still same episode');

      expect(insertedDocs).to.have.lengthOf(1);
    });

    it('no-ops when DB is not available', async () => {
      databaseConnectionReturn = null;
      dbHelperStub.databaseConnection = sinon.stub().returns(null);

      await service.recordEvent('myapp', 'container_vanished', 'x');

      expect(dbHelperStub.insertOneToDatabase.called).to.be.false;
    });

    it('swallows insert errors without throwing and logs them', async () => {
      dbHelperStub.insertOneToDatabase = sinon.stub().rejects(new Error('boom'));

      await service.recordEvent('myapp', 'container_vanished', 'x');

      sinon.assert.calledOnce(logStub.error);
      expect(logStub.error.firstCall.args[0]).to.include('boom');
    });

    it('does not consume the episode when the insert fails', async () => {
      dbHelperStub.insertOneToDatabase = sinon.stub().rejects(new Error('boom'));
      await service.recordEvent('myapp', 'container_vanished', 'lost');

      dbHelperStub.insertOneToDatabase = sinon.stub().callsFake(async (db, coll, doc) => {
        insertedDocs.push({ db, coll, doc });
        return { insertedId: 'mock-id' };
      });
      await service.recordEvent('myapp', 'container_vanished', 'retried');

      expect(insertedDocs).to.have.lengthOf(1);
      expect(insertedDocs[0].doc.details).to.equal('retried');
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

    it('caps results at the default limit when none is requested', async () => {
      const req = { params: {}, query: {} };
      const res = makeRes();

      await service.getEvents(req, res);

      expect(lastFindArgs.options.limit).to.equal(500);
    });

    it('honours an explicit limit', async () => {
      const req = { params: {}, query: { limit: '50' } };
      const res = makeRes();

      await service.getEvents(req, res);

      expect(lastFindArgs.options.limit).to.equal(50);
    });

    it('clamps the limit to the maximum', async () => {
      const req = { params: {}, query: { limit: '999999' } };
      const res = makeRes();

      await service.getEvents(req, res);

      expect(lastFindArgs.options.limit).to.equal(1000);
    });

    it('clamps a non-positive limit up to 1', async () => {
      const req = { params: {}, query: { limit: '-5' } };
      const res = makeRes();

      await service.getEvents(req, res);

      expect(lastFindArgs.options.limit).to.equal(1);
    });

    it('falls back to the default limit on a non-numeric limit', async () => {
      const req = { params: {}, query: { limit: 'lots' } };
      const res = makeRes();

      await service.getEvents(req, res);

      expect(lastFindArgs.options.limit).to.equal(500);
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

  describe('checkNodeReboot', () => {
    function markerUpdates() {
      return dbHelperStub.findOneAndUpdateInDatabase.getCalls()
        .filter((c) => c.args[2] && c.args[2]._id === 'lastStartup');
    }

    function historyUpdates() {
      return dbHelperStub.findOneAndUpdateInDatabase.getCalls()
        .filter((c) => c.args[2] && c.args[2]._id === 'bootHistory');
    }

    it('records a node_reboot event when the boot_id changed', async () => {
      const previousAt = new Date('2026-07-15T10:00:00Z');
      dbHelperStub.findOneInDatabase = sinon.stub().resolves({
        _id: 'lastStartup', at: previousAt, bootId: PREVIOUS_BOOT_ID,
      });

      await service.checkNodeReboot();

      expect(insertedDocs).to.have.lengthOf(1);
      const { doc } = insertedDocs[0];
      expect(doc.appName).to.equal(service.SYSTEM_APP_NAME);
      expect(doc.eventType).to.equal('node_reboot');
      expect(doc.details).to.include(PREVIOUS_BOOT_ID.slice(0, 8));
      expect(doc.details).to.include(CURRENT_BOOT_ID.slice(0, 8));
      expect(doc.details).to.include(previousAt.toISOString());
    });

    it('does NOT record an event on a same-boot_id process restart', async () => {
      dbHelperStub.findOneInDatabase = sinon.stub().resolves({
        _id: 'lastStartup', at: new Date(), bootId: CURRENT_BOOT_ID,
      });

      await service.checkNodeReboot();

      expect(insertedDocs).to.have.lengthOf(0);
      expect(historyUpdates()).to.have.lengthOf(0);
      expect(markerUpdates()).to.have.lengthOf(1);
    });

    it('does NOT record an event on first-ever startup, but seeds marker and history', async () => {
      dbHelperStub.findOneInDatabase = sinon.stub().resolves(null);

      await service.checkNodeReboot();

      expect(insertedDocs).to.have.lengthOf(0);
      expect(historyUpdates()).to.have.lengthOf(1);
      const marker = markerUpdates();
      expect(marker).to.have.lengthOf(1);
      expect(marker[0].args[3].$set.bootId).to.equal(CURRENT_BOOT_ID);
      expect(marker[0].args[3].$set.at).to.be.instanceOf(Date);
      expect(marker[0].args[4]).to.deep.equal({ upsert: true });
    });

    it('does NOT record an event when upgrading from a marker without bootId', async () => {
      // Pre-boot_id marker only carried `at`; reboot vs restart is unknowable.
      dbHelperStub.findOneInDatabase = sinon.stub().resolves({
        _id: 'lastStartup', at: new Date(Date.now() - 1000),
      });

      await service.checkNodeReboot();

      expect(insertedDocs).to.have.lengthOf(0);
      expect(historyUpdates()).to.have.lengthOf(1);
      expect(markerUpdates()).to.have.lengthOf(1);
    });

    it('appends the new boot to the rolling history on reboot', async () => {
      dbHelperStub.findOneInDatabase = sinon.stub().resolves({
        _id: 'lastStartup', at: new Date(), bootId: PREVIOUS_BOOT_ID,
      });

      await service.checkNodeReboot();

      const history = historyUpdates();
      expect(history).to.have.lengthOf(1);
      const push = history[0].args[3].$push.boots;
      expect(push.$each[0].bootId).to.equal(CURRENT_BOOT_ID);
      expect(push.$each[0].at).to.be.instanceOf(Date);
      expect(push.$slice).to.equal(-service.BOOT_HISTORY_MAX);
      expect(history[0].args[4]).to.deep.equal({ upsert: true });
    });

    it('skips entirely when boot_id cannot be read', async () => {
      fsReadFileStub.rejects(new Error('ENOENT'));

      await service.checkNodeReboot();

      expect(insertedDocs).to.have.lengthOf(0);
      expect(dbHelperStub.findOneAndUpdateInDatabase.called).to.be.false;
      sinon.assert.called(logStub.warn);
    });

    it('skips entirely when boot_id reads empty', async () => {
      fsReadFileStub.resolves('  \n');

      await service.checkNodeReboot();

      expect(insertedDocs).to.have.lengthOf(0);
      expect(dbHelperStub.findOneAndUpdateInDatabase.called).to.be.false;
    });

    it('purges legacy frequent_restart rows', async () => {
      await service.checkNodeReboot();

      sinon.assert.calledOnce(dbHelperStub.removeDocumentsFromCollection);
      const { args } = dbHelperStub.removeDocumentsFromCollection.firstCall;
      expect(args[1]).to.equal('apptamperingevents');
      expect(args[2]).to.deep.equal({ eventType: 'frequent_restart' });
    });

    it('still tracks the boot when the legacy purge fails', async () => {
      dbHelperStub.removeDocumentsFromCollection = sinon.stub().rejects(new Error('no permission'));

      await service.checkNodeReboot();

      expect(markerUpdates()).to.have.lengthOf(1);
      sinon.assert.called(logStub.warn);
    });

    it('no-ops when DB is unavailable', async () => {
      dbHelperStub.databaseConnection = sinon.stub().returns(null);

      await service.checkNodeReboot();

      expect(dbHelperStub.findOneInDatabase.called).to.be.false;
      expect(dbHelperStub.findOneAndUpdateInDatabase.called).to.be.false;
      expect(dbHelperStub.removeDocumentsFromCollection.called).to.be.false;
    });

    it('swallows errors without throwing and logs them', async () => {
      dbHelperStub.findOneInDatabase = sinon.stub().rejects(new Error('mongo down'));

      await service.checkNodeReboot();

      sinon.assert.calledOnce(logStub.error);
      expect(logStub.error.firstCall.args[0]).to.include('mongo down');
    });
  });
});
