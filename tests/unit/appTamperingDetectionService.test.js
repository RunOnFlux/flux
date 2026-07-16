const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appTamperingDetectionService tests', () => {
  let service;
  let dbHelperStub;
  let logStub;
  let fsReadFileStub;
  let fluxnodeRpcsStub;
  let generalServiceStub;
  let upsertCalls;
  let findResults;
  let lastFindArgs;
  let installedApps;

  const CURRENT_BOOT_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PREVIOUS_BOOT_ID = 'bbbbbbbb-5555-6666-7777-888888888888';
  const NODE_STATUS = {
    status: 'success',
    data: {
      txhash: 'deadbeefcafe',
      outidx: 0,
      ip: '65.108.1.2:16127',
      pubkey: '04aabbcc',
      payment_address: 't1payout',
      collateral: 'COutPoint(deadbeefcafe, 0)',
    },
  };

  function eventUpserts() {
    return upsertCalls.filter((c) => c.coll === 'apptamperingevents');
  }

  function markerUpdates() {
    return upsertCalls.filter((c) => c.coll === 'nodestartuptracker' && c.query._id === 'lastStartup');
  }

  function historyUpdates() {
    return upsertCalls.filter((c) => c.coll === 'nodestartuptracker' && c.query._id === 'bootHistory');
  }

  beforeEach(() => {
    upsertCalls = [];
    findResults = [];
    lastFindArgs = null;
    installedApps = {}; // name -> { owner, hash }

    dbHelperStub = {
      databaseConnection: sinon.stub().returns({
        db: sinon.stub().callsFake((name) => ({ name })),
      }),
      findOneAndUpdateInDatabase: sinon.stub().callsFake(async (db, coll, query, update, options) => {
        upsertCalls.push({
          db, coll, query, update, options,
        });
        return null; // driver v6 upsert shape: null means a fresh insert
      }),
      findInDatabase: sinon.stub().callsFake(async (db, coll, query, options) => {
        lastFindArgs = {
          db, coll, query, options,
        };
        return findResults;
      }),
      findOneInDatabase: sinon.stub().callsFake(async (db, coll, query) => {
        if (coll === 'zelappsinformation') return installedApps[query.name] || null;
        return null; // startup marker by default absent
      }),
      removeDocumentsFromCollection: sinon.stub().resolves({ deletedCount: 0 }),
      updateInDatabase: sinon.stub().resolves({ modifiedCount: 0 }),
    };

    logStub = {
      info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
    };

    fsReadFileStub = sinon.stub().resolves(`${CURRENT_BOOT_ID}\n`);
    fluxnodeRpcsStub = { getFluxNodeStatus: sinon.stub().resolves(NODE_STATUS) };
    generalServiceStub = { getCollateralInfo: sinon.stub().returns({ txhash: 'colTx', txindex: 7 }) };

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
          appslocal: {
            database: 'localzelappsinformation',
            collections: { appsInformation: 'zelappsinformation' },
          },
        },
        system: {
          bootIdPath: '/proc/sys/kernel/random/boot_id',
        },
      },
      fs: {
        promises: { readFile: fsReadFileStub },
      },
      os: { uptime: () => 3600 },
      './dbHelper': dbHelperStub,
      '../lib/log': logStub,
      './generalService': generalServiceStub,
      './daemonService/daemonServiceFluxnodeRpcs': fluxnodeRpcsStub,
      './utils/appConstants': { localAppsInformation: 'zelappsinformation' },
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

  describe('deriveMainAppName', () => {
    it('passes a plain app name through', () => {
      expect(service.deriveMainAppName('MyApp')).to.equal('MyApp');
    });

    it('strips the flux docker prefix', () => {
      expect(service.deriveMainAppName('fluxMyApp')).to.equal('MyApp');
    });

    it('strips the zel docker prefix', () => {
      expect(service.deriveMainAppName('zelMyApp')).to.equal('MyApp');
    });

    it('reduces a component identifier to the main app name', () => {
      expect(service.deriveMainAppName('fluxweb_MyApp')).to.equal('MyApp');
      expect(service.deriveMainAppName('web_MyApp')).to.equal('MyApp');
    });
  });

  describe('recordEvent', () => {
    it('upserts an incident with the full schema on first sight', async () => {
      await service.recordEvent('myapp', 'container_vanished', 'details here');

      expect(eventUpserts()).to.have.lengthOf(1);
      const { query, update, options } = eventUpserts()[0];
      expect(query.appName).to.equal('myapp');
      expect(query.eventType).to.equal('container_vanished');
      expect(query.incidentKey).to.be.a('string');
      expect(options).to.deep.equal({ upsert: true });

      const ins = update.$setOnInsert;
      expect(ins.schemaVersion).to.equal(1);
      expect(ins.severity).to.equal(service.EVENT_SEVERITY.container_vanished);
      expect(ins.duringBootStorm).to.be.false;
      expect(ins.firstSeen).to.be.instanceOf(Date);
      expect(ins.detailsSample).to.equal('details here');
      expect(ins.uptimeSecAtEvent).to.equal(3600);
      expect(update.$set.lastSeen).to.be.instanceOf(Date);
      expect(update.$inc).to.deep.equal({ count: 1 });
    });

    it('stamps node and operator identity from the daemon status', async () => {
      await service.recordEvent('myapp', 'container_vanished', 'x');

      const ins = eventUpserts()[0].update.$setOnInsert;
      expect(ins.nodeTxid).to.equal('deadbeefcafe');
      expect(ins.nodeOutidx).to.equal(0);
      expect(ins.nodeIp).to.equal('65.108.1.2:16127');
      expect(ins.pubkey).to.equal('04aabbcc');
      expect(ins.paymentAddress).to.equal('t1payout');
    });

    it('caches node identity across events (one RPC)', async () => {
      await service.recordEvent('a', 'container_vanished', 'x');
      await service.recordEvent('b', 'container_vanished', 'x');

      sinon.assert.calledOnce(fluxnodeRpcsStub.getFluxNodeStatus);
    });

    it('falls back to collateral parsing when status lacks txhash/outidx', async () => {
      fluxnodeRpcsStub.getFluxNodeStatus.resolves({
        status: 'success',
        data: { collateral: 'COutPoint(colTx, 7)', ip: '1.2.3.4' },
      });

      await service.recordEvent('myapp', 'container_vanished', 'x');

      const ins = eventUpserts()[0].update.$setOnInsert;
      expect(ins.nodeTxid).to.equal('colTx');
      expect(ins.nodeOutidx).to.equal(7);
    });

    it('records unattributed when the daemon is unreachable, and backs off', async () => {
      fluxnodeRpcsStub.getFluxNodeStatus.rejects(new Error('daemon down'));

      await service.recordEvent('a', 'container_vanished', 'x');
      await service.recordEvent('b', 'container_vanished', 'x');

      expect(eventUpserts()).to.have.lengthOf(2);
      expect(eventUpserts()[0].update.$setOnInsert.nodeTxid).to.be.null;
      expect(eventUpserts()[0].update.$setOnInsert.pubkey).to.be.null;
      sinon.assert.calledOnce(fluxnodeRpcsStub.getFluxNodeStatus); // backoff, no hammering
    });

    it('attributes the app owner and spec hash by exact name', async () => {
      installedApps.myapp = { owner: '1ownerZelid', hash: 'spechash1' };

      await service.recordEvent('myapp', 'container_vanished', 'x');

      const ins = eventUpserts()[0].update.$setOnInsert;
      expect(ins.ownerZelid).to.equal('1ownerZelid');
      expect(ins.appHash).to.equal('spechash1');
    });

    it('attributes a component identifier via the derived main app name', async () => {
      installedApps.MyApp = { owner: '1ownerZelid', hash: 'spechash1' };

      await service.recordEvent('fluxweb_MyApp', 'mount_vanished', 'x');

      const ins = eventUpserts()[0].update.$setOnInsert;
      expect(ins.ownerZelid).to.equal('1ownerZelid');
      expect(ins.appHash).to.equal('spechash1');
    });

    it('records null attribution for unknown apps and for __system__', async () => {
      await service.recordEvent('ghostapp', 'container_vanished', 'x');
      await service.recordEvent(service.SYSTEM_APP_NAME, 'node_reboot', 'x');

      expect(eventUpserts()[0].update.$setOnInsert.ownerZelid).to.be.null;
      expect(eventUpserts()[1].update.$setOnInsert.ownerZelid).to.be.null;
    });

    it('uses the same incidentKey for repeats within the hour bucket', async () => {
      const clock = sinon.useFakeTimers(new Date('2026-07-16T10:00:00Z'));

      await service.recordEvent('myapp', 'mount_vanished', 'a');
      clock.tick(10 * 60 * 1000);
      await service.recordEvent('myapp', 'mount_vanished', 'b');

      expect(eventUpserts()).to.have.lengthOf(2); // both reach the DB: count rolls up
      expect(eventUpserts()[0].query.incidentKey).to.equal(eventUpserts()[1].query.incidentKey);
    });

    it('opens a new incident in the next hour bucket', async () => {
      const clock = sinon.useFakeTimers(new Date('2026-07-16T10:00:00Z'));

      await service.recordEvent('myapp', 'mount_vanished', 'a');
      clock.tick(service.INCIDENT_BUCKET_MS);
      await service.recordEvent('myapp', 'mount_vanished', 'b');

      expect(eventUpserts()[0].query.incidentKey).to.not.equal(eventUpserts()[1].query.incidentKey);
    });

    it('stamps severity 0 for operational and unknown event types', async () => {
      await service.recordEvent('myapp', 'recreation_failed', 'x');
      await service.recordEvent('myapp', 'some_future_type', 'x');

      expect(eventUpserts()[0].update.$setOnInsert.severity).to.equal(0);
      expect(eventUpserts()[1].update.$setOnInsert.severity).to.equal(0);
    });

    it('retries once when concurrent upserts race on the unique index', async () => {
      const dupErr = new Error('E11000 duplicate key');
      dupErr.code = 11000;
      dbHelperStub.findOneAndUpdateInDatabase = sinon.stub()
        .onFirstCall().rejects(dupErr)
        .callsFake(async (db, coll, query, update, options) => {
          upsertCalls.push({
            db, coll, query, update, options,
          });
          return { count: 1 };
        });

      await service.recordEvent('myapp', 'container_vanished', 'x');

      expect(eventUpserts()).to.have.lengthOf(1);
      expect(logStub.error.called).to.be.false;
    });

    it('no-ops when DB is not available', async () => {
      dbHelperStub.databaseConnection = sinon.stub().returns(null);

      await service.recordEvent('myapp', 'container_vanished', 'x');

      expect(dbHelperStub.findOneAndUpdateInDatabase.called).to.be.false;
    });

    it('swallows write errors without throwing and logs them', async () => {
      dbHelperStub.findOneAndUpdateInDatabase = sinon.stub().rejects(new Error('boom'));

      await service.recordEvent('myapp', 'container_vanished', 'x');

      sinon.assert.calledOnce(logStub.error);
      expect(logStub.error.firstCall.args[0]).to.include('boom');
    });
  });

  describe('boot storm flagging', () => {
    async function rebootNow() {
      dbHelperStub.findOneInDatabase = sinon.stub().callsFake(async (db, coll, query) => {
        if (coll === 'nodestartuptracker' && query._id === 'lastStartup') {
          return { _id: 'lastStartup', at: new Date(), bootId: PREVIOUS_BOOT_ID };
        }
        return null;
      });
      await service.checkNodeReboot();
    }

    it('flags events inside the window after a boot_id change', async () => {
      sinon.useFakeTimers(new Date('2026-07-16T10:00:00Z'));
      await rebootNow();

      await service.recordEvent('myapp', 'mount_vanished', 'late disk');

      const incident = eventUpserts().find((c) => c.query.eventType === 'mount_vanished');
      expect(incident.update.$setOnInsert.duringBootStorm).to.be.true;
      expect(incident.update.$setOnInsert.bootId).to.equal(CURRENT_BOOT_ID);
      expect(incident.query.incidentKey).to.include(CURRENT_BOOT_ID);
    });

    it('stops flagging once the window has elapsed', async () => {
      const clock = sinon.useFakeTimers(new Date('2026-07-16T10:00:00Z'));
      await rebootNow();

      clock.tick(service.BOOT_STORM_WINDOW_MS);
      await service.recordEvent('myapp', 'mount_vanished', 'vanished while up');

      const incident = eventUpserts().find((c) => c.query.eventType === 'mount_vanished');
      expect(incident.update.$setOnInsert.duringBootStorm).to.be.false;
    });

    it('does NOT open the window on a same-boot_id process restart', async () => {
      sinon.useFakeTimers(new Date('2026-07-16T10:00:00Z'));
      dbHelperStub.findOneInDatabase = sinon.stub().callsFake(async (db, coll, query) => {
        if (coll === 'nodestartuptracker' && query._id === 'lastStartup') {
          return { _id: 'lastStartup', at: new Date(), bootId: CURRENT_BOOT_ID };
        }
        return null;
      });
      await service.checkNodeReboot();

      await service.recordEvent('myapp', 'mount_vanished', 'x');

      const incident = eventUpserts().find((c) => c.query.eventType === 'mount_vanished');
      expect(incident.update.$setOnInsert.duringBootStorm).to.be.false;
    });
  });

  describe('identity backfill', () => {
    it('stamps identity onto unattributed incidents once the daemon answers, then stops', async () => {
      const clock = sinon.useFakeTimers(new Date('2026-07-16T10:00:00Z'));
      fluxnodeRpcsStub.getFluxNodeStatus.rejects(new Error('daemon starting'));

      await service.checkNodeReboot(); // starts the backfill; immediate attempt fails
      await clock.tickAsync(0);
      expect(dbHelperStub.updateInDatabase.called).to.be.false;

      fluxnodeRpcsStub.getFluxNodeStatus.resolves(NODE_STATUS);
      await clock.tickAsync(service.IDENTITY_BACKFILL_INTERVAL_MS);

      sinon.assert.calledOnce(dbHelperStub.updateInDatabase);
      const call = dbHelperStub.updateInDatabase.firstCall;
      expect(call.args[1]).to.equal('apptamperingevents');
      expect(call.args[2]).to.deep.equal({ schemaVersion: { $gte: 1 }, nodeTxid: null });
      expect(call.args[3].$set.nodeTxid).to.equal('deadbeefcafe');
      expect(call.args[3].$set.pubkey).to.equal('04aabbcc');
      expect(call.args[3].$set.paymentAddress).to.equal('t1payout');

      // stopped for good: further intervals do not fire another update
      await clock.tickAsync(2 * service.IDENTITY_BACKFILL_INTERVAL_MS);
      sinon.assert.calledOnce(dbHelperStub.updateInDatabase);
    });

    it('keeps retrying while the daemon stays unreachable', async () => {
      const clock = sinon.useFakeTimers(new Date('2026-07-16T10:00:00Z'));
      fluxnodeRpcsStub.getFluxNodeStatus.rejects(new Error('daemon down'));

      await service.checkNodeReboot();
      await clock.tickAsync(2 * service.IDENTITY_BACKFILL_INTERVAL_MS);

      expect(dbHelperStub.updateInDatabase.called).to.be.false;
      expect(fluxnodeRpcsStub.getFluxNodeStatus.callCount).to.be.greaterThan(1);
    });

    it('does not start a second timer when called repeatedly', async () => {
      const clock = sinon.useFakeTimers(new Date('2026-07-16T10:00:00Z'));
      fluxnodeRpcsStub.getFluxNodeStatus.rejects(new Error('daemon down'));

      service.startIdentityBackfill();
      service.startIdentityBackfill();
      await clock.tickAsync(service.IDENTITY_BACKFILL_INTERVAL_MS);

      // one immediate attempt + one interval tick — not doubled
      expect(fluxnodeRpcsStub.getFluxNodeStatus.callCount).to.equal(2);
    });
  });

  describe('getEvents', () => {
    function makeRes() {
      const res = {};
      res.json = sinon.stub().returns(res);
      return res;
    }

    it('returns events newest first, keeping _id as the stable paging key', async () => {
      findResults = [
        { _id: 'x', appName: 'a', eventType: 'y' },
      ];
      const req = { params: {}, query: {} };
      const res = makeRes();

      await service.getEvents(req, res);

      expect(lastFindArgs.coll).to.equal('apptamperingevents');
      expect(lastFindArgs.query).to.deep.equal({});
      expect(lastFindArgs.options.sort).to.deep.equal({ lastSeen: -1, detectedAt: -1 });
      expect(lastFindArgs.options.projection).to.equal(undefined);
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
    function setMarker(marker) {
      dbHelperStub.findOneInDatabase = sinon.stub().callsFake(async (db, coll, query) => {
        if (coll === 'nodestartuptracker' && query._id === 'lastStartup') return marker;
        return null;
      });
    }

    it('records a node_reboot incident when the boot_id changed', async () => {
      const previousAt = new Date('2026-07-15T10:00:00Z');
      setMarker({ _id: 'lastStartup', at: previousAt, bootId: PREVIOUS_BOOT_ID });

      await service.checkNodeReboot();

      const reboots = eventUpserts().filter((c) => c.query.eventType === 'node_reboot');
      expect(reboots).to.have.lengthOf(1);
      expect(reboots[0].query.appName).to.equal(service.SYSTEM_APP_NAME);
      const ins = reboots[0].update.$setOnInsert;
      expect(ins.severity).to.equal(0);
      expect(ins.detailsSample).to.include(PREVIOUS_BOOT_ID.slice(0, 8));
      expect(ins.detailsSample).to.include(CURRENT_BOOT_ID.slice(0, 8));
      expect(ins.detailsSample).to.include(previousAt.toISOString());
    });

    it('does NOT record an incident on a same-boot_id process restart', async () => {
      setMarker({ _id: 'lastStartup', at: new Date(), bootId: CURRENT_BOOT_ID });

      await service.checkNodeReboot();

      expect(eventUpserts()).to.have.lengthOf(0);
      expect(historyUpdates()).to.have.lengthOf(0);
      expect(markerUpdates()).to.have.lengthOf(1);
    });

    it('does NOT record an incident on first-ever startup, but seeds marker and history', async () => {
      setMarker(null);

      await service.checkNodeReboot();

      expect(eventUpserts()).to.have.lengthOf(0);
      expect(historyUpdates()).to.have.lengthOf(1);
      const marker = markerUpdates();
      expect(marker).to.have.lengthOf(1);
      expect(marker[0].update.$set.bootId).to.equal(CURRENT_BOOT_ID);
      expect(marker[0].update.$set.at).to.be.instanceOf(Date);
      expect(marker[0].options).to.deep.equal({ upsert: true });
    });

    it('does NOT record an incident when upgrading from a marker without bootId', async () => {
      // Pre-boot_id marker only carried `at`; reboot vs restart is unknowable.
      setMarker({ _id: 'lastStartup', at: new Date(Date.now() - 1000) });

      await service.checkNodeReboot();

      expect(eventUpserts()).to.have.lengthOf(0);
      expect(historyUpdates()).to.have.lengthOf(1);
      expect(markerUpdates()).to.have.lengthOf(1);
    });

    it('appends the new boot to the rolling history on reboot', async () => {
      setMarker({ _id: 'lastStartup', at: new Date(), bootId: PREVIOUS_BOOT_ID });

      await service.checkNodeReboot();

      const history = historyUpdates();
      expect(history).to.have.lengthOf(1);
      const push = history[0].update.$push.boots;
      expect(push.$each[0].bootId).to.equal(CURRENT_BOOT_ID);
      expect(push.$each[0].at).to.be.instanceOf(Date);
      expect(push.$slice).to.equal(-service.BOOT_HISTORY_MAX);
      expect(history[0].options).to.deep.equal({ upsert: true });
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

    it('skips entirely when boot_id cannot be read', async () => {
      fsReadFileStub.rejects(new Error('ENOENT'));

      await service.checkNodeReboot();

      expect(upsertCalls).to.have.lengthOf(0);
      sinon.assert.called(logStub.warn);
    });

    it('skips entirely when boot_id reads empty', async () => {
      fsReadFileStub.resolves('  \n');

      await service.checkNodeReboot();

      expect(upsertCalls).to.have.lengthOf(0);
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
