const { expect } = require('chai');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const { SIGTERM_EXPIRY_MS, RUNNING_EXPIRY_MS, EVICTED_EXPIRY_MS } = require('../../ZelBack/src/services/utils/appConstants');
const sinon = require('sinon');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const fluxnodeAddressRecord = require('../../ZelBack/src/services/fluxnodeAddressRecord');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const { ADDRESS_MOVE_GRACE_BLOCKS } = require('../../ZelBack/src/services/utils/appConstants');
const { requireMongo } = require('./dbTestHelper');

// A shutdown or a removal speaks only for the location rows its node broadcast
// before it. Peer sync replays every unexpired event after a restart, so these
// arrive out of order in normal operation.
describe('messageStore location ordering', () => {
  before(requireMongo);

  const ip = '203.0.113.7:16127';
  const otherIp = '203.0.113.8:16127';
  let collection;
  let events;

  const row = (name, rowIp, broadcastedAt) => ({
    name,
    ip: rowIp,
    hash: 'h',
    broadcastedAt: new Date(broadcastedAt),
    expireAt: new Date(broadcastedAt + RUNNING_EXPIRY_MS),
    runningSince: new Date(broadcastedAt),
  });
  const find = (name, rowIp = ip) => collection.findOne({ name, ip: rowIp });

  beforeEach(async () => {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    collection = database.collection(config.database.appsglobal.collections.appsLocations);
    events = database.collection(config.database.appsglobal.collections.appStateEvents);
    await collection.deleteMany({ ip: { $in: [ip, otherIp] } });
    await events.deleteMany({ ip: { $in: [ip, otherIp] } });
  });

  afterEach(async () => {
    await collection.deleteMany({ ip: { $in: [ip, otherIp] } });
    await events.deleteMany({ ip: { $in: [ip, otherIp] } });
  });

  describe('expireLocationsForSigterm', () => {
    it('leaves a row broadcast after the sigterm, even when the sigterm arrives later', async () => {
      const now = Date.now();
      const sigtermAt = now - 90 * 60 * 1000;
      await collection.insertOne(row('app', ip, now - 5 * 60 * 1000));

      await messageStore.expireLocationsForSigterm(ip, sigtermAt);

      const kept = await find('app');
      expect(kept.expireAt.getTime()).to.equal(now - 5 * 60 * 1000 + RUNNING_EXPIRY_MS);
    });

    it('expires a row broadcast before the sigterm', async () => {
      const now = Date.now();
      await collection.insertOne(row('app', ip, now - 10 * 60 * 1000));

      await messageStore.expireLocationsForSigterm(ip, now);

      const expired = await find('app');
      expect(expired.expireAt.getTime()).to.equal(now + SIGTERM_EXPIRY_MS);
    });

    it('treats a row broadcast at the sigterm instant as the node running again', async () => {
      const now = Date.now();
      await collection.insertOne(row('app', ip, now));

      await messageStore.expireLocationsForSigterm(ip, now);

      expect((await find('app')).expireAt.getTime()).to.equal(now + RUNNING_EXPIRY_MS);
    });

    it('never lengthens a row that already expires sooner', async () => {
      const now = Date.now();
      const early = { ...row('app', ip, now - 10 * 60 * 1000), expireAt: new Date(now + 1000) };
      await collection.insertOne(early);

      await messageStore.expireLocationsForSigterm(ip, now);

      expect((await find('app')).expireAt.getTime()).to.equal(now + 1000);
    });

    it('touches only the sending node', async () => {
      const now = Date.now();
      await collection.insertOne(row('app', otherIp, now - 10 * 60 * 1000));

      await messageStore.expireLocationsForSigterm(ip, now);

      expect((await find('app', otherIp)).expireAt.getTime()).to.equal(now - 10 * 60 * 1000 + RUNNING_EXPIRY_MS);
    });
  });

  describe('removeLocationForAppRemoved', () => {
    it('keeps a row broadcast after the removal (the app was installed again)', async () => {
      const now = Date.now();
      await collection.insertOne(row('app', ip, now - 60 * 1000));

      await messageStore.removeLocationForAppRemoved(ip, 'app', now - 30 * 60 * 1000);

      expect(await find('app')).to.not.equal(null);
    });

    it('removes a row broadcast at the removal instant, as the event-derived view does', async () => {
      const now = Date.now();
      await collection.insertOne(row('app', ip, now));

      await messageStore.removeLocationForAppRemoved(ip, 'app', now);

      expect(await find('app')).to.equal(null);
    });

    it('removes the app row broadcast before the removal and nothing else', async () => {
      const now = Date.now();
      await collection.insertMany([
        row('app', ip, now - 10 * 60 * 1000),
        row('sibling', ip, now - 10 * 60 * 1000),
        row('app', otherIp, now - 10 * 60 * 1000),
      ]);

      await messageStore.removeLocationForAppRemoved(ip, 'app', now);

      expect(await find('app')).to.equal(null);
      expect(await find('sibling')).to.not.equal(null);
      expect(await find('app', otherIp)).to.not.equal(null);
    });
  });

  describe('applyEviction of an address a node told of moving to', () => {
    const OLD = '203.0.113.6:16127';
    const KEY = '02aa';
    const eviction = () => events.findOne({ ip, type: 'evicted' });
    const movedHere = ({ signer = KEY, listedKey = KEY } = {}) => {
      sinon.stub(networkStateService, 'highestConfirmedHeight').returns(5000);
      sinon.stub(fluxnodeAddressRecord, 'holds').returns(true);
      sinon.stub(fluxnodeAddressRecord, 'movedAwayFrom').resolves(null);
      sinon.stub(registryManager, 'addressMovesTo').resolves(new Map([[OLD, { to: ip, at: Date.now(), signer }]]));
      sinon.stub(networkStateService, 'getFluxnodeBySocketAddress').resolves(listedKey ? { pubkey: listedKey } : null);
    };
    const evictRow = async () => {
      const now = Date.now();
      await collection.insertOne(row('app', ip, now - 5 * 60 * 1000));
      await messageStore.applyEviction(ip, now);
    };

    afterEach(() => sinon.restore());

    it('keeps the rows while the list still holds the node at the address it left', async () => {
      movedHere();
      await evictRow();

      expect(await find('app')).to.not.equal(null);
      expect(await eviction()).to.equal(null);
    });

    it('evicts once the address it left has gone from the list: it moved and is gone', async () => {
      movedHere({ listedKey: null });
      await evictRow();

      expect(await find('app')).to.equal(null);
    });

    it('evicts when another node holds the address it left', async () => {
      movedHere({ listedKey: '02bb' });
      await evictRow();

      expect(await find('app')).to.equal(null);
    });

    it('keeps the rows for a move recorded with no signer while the address it left is listed', async () => {
      movedHere({ signer: null });
      await evictRow();

      expect(await find('app')).to.not.equal(null);
    });

    it('judges nothing while the moves cannot be read', async () => {
      movedHere();
      registryManager.addressMovesTo.rejects(new Error('database down'));
      await evictRow();

      expect(await find('app')).to.not.equal(null);
    });
  });

  describe('applyEviction of a node the chain moved', () => {
    const NEW = '203.0.113.9:16127';
    const TIP = 5000;
    const eviction = () => events.findOne({ ip, type: 'evicted' });

    const chain = ({ movedAt = TIP, listed = true, recordHolds = true } = {}) => {
      sinon.stub(networkStateService, 'highestConfirmedHeight').returns(TIP);
      sinon.stub(fluxnodeAddressRecord, 'holds').returns(recordHolds);
      sinon.stub(fluxnodeAddressRecord, 'highestRecorded').returns(TIP);
      sinon.stub(fluxnodeAddressRecord, 'movedAwayFrom').resolves(movedAt === null ? null : { to: NEW, height: movedAt });
      sinon.stub(networkStateService, 'socketAddressInNetworkState').resolves(listed);
      sinon.stub(registryManager, 'addressMovesTo').resolves(new Map());
    };

    afterEach(() => sinon.restore());

    const evictRowOlderThanNow = async () => {
      const now = Date.now();
      await collection.insertOne(row('app', ip, now - 5 * 60 * 1000));
      await messageStore.applyEviction(ip, now);
    };

    it('keeps its rows and records no eviction, so none reaches a peer', async () => {
      chain();
      await evictRowOlderThanNow();

      expect(await find('app')).to.not.equal(null);
      expect(await eviction()).to.equal(null);
    });

    it('keeps them on the last block of the grace', async () => {
      chain({ movedAt: TIP - ADDRESS_MOVE_GRACE_BLOCKS + 1 });
      await evictRowOlderThanNow();

      expect(await find('app')).to.not.equal(null);
    });

    it('evicts once the grace has passed: a node that kept its collateral and started empty sends no move', async () => {
      chain({ movedAt: TIP - ADDRESS_MOVE_GRACE_BLOCKS });
      await evictRowOlderThanNow();

      expect(await find('app')).to.equal(null);
      expect(await eviction()).to.not.equal(null);
    });

    it('evicts a node the chain moved to an address the list does not hold: it moved and is gone', async () => {
      chain({ listed: false });
      await evictRowOlderThanNow();

      expect(await find('app')).to.equal(null);
    });

    it('evicts a node the chain did not move', async () => {
      chain({ movedAt: null });
      await evictRowOlderThanNow();

      expect(await find('app')).to.equal(null);
    });

    it('judges nothing while the record is behind the node list', async () => {
      chain({ movedAt: null, recordHolds: false });
      await evictRowOlderThanNow();

      expect(await find('app')).to.not.equal(null);
      expect(await eviction()).to.equal(null);
    });

    it('judges nothing while the record cannot be read', async () => {
      chain();
      fluxnodeAddressRecord.movedAwayFrom.rejects(new Error('database down'));
      await evictRowOlderThanNow();

      expect(await find('app')).to.not.equal(null);
    });
  });

  describe('applyEviction', () => {
    const eviction = () => events.findOne({ ip, type: 'evicted' });

    it('keeps a row broadcast after the eviction (the node came back)', async () => {
      const now = Date.now();
      await collection.insertOne(row('app', ip, now - 5 * 60 * 1000));

      await messageStore.applyEviction(ip, now - 60 * 60 * 1000);

      expect(await find('app')).to.not.equal(null);
    });

    it('removes the rows broadcast before the eviction, for that node only', async () => {
      const now = Date.now();
      await collection.insertMany([
        row('app', ip, now - 60 * 60 * 1000),
        row('sibling', ip, now - 50 * 60 * 1000),
        row('app', otherIp, now - 60 * 60 * 1000),
      ]);

      await messageStore.applyEviction(ip, now - 10 * 60 * 1000);

      expect(await find('app')).to.equal(null);
      expect(await find('sibling')).to.equal(null);
      expect(await find('app', otherIp)).to.not.equal(null);
    });

    it('records the eviction under the time it was made, however late it arrives', async () => {
      const madeAt = Date.now() - 100 * 60 * 1000;

      await messageStore.applyEviction(ip, madeAt);

      const stored = await eviction();
      expect(stored.createdAt.getTime()).to.equal(madeAt);
      expect(stored.expireAt.getTime()).to.equal(madeAt + EVICTED_EXPIRY_MS);
    });

    it('keeps the newer of two evictions of one node, in either order', async () => {
      const older = Date.now() - 90 * 60 * 1000;
      const newer = Date.now() - 20 * 60 * 1000;

      await messageStore.applyEviction(ip, newer);
      await messageStore.applyEviction(ip, older);
      expect((await eviction()).createdAt.getTime()).to.equal(newer);

      await events.deleteMany({ ip });
      await messageStore.applyEviction(ip, older);
      await messageStore.applyEviction(ip, newer);
      expect((await eviction()).createdAt.getTime()).to.equal(newer);
    });

    it('changes nothing for an eviction older than a location lifetime', async () => {
      const now = Date.now();
      await collection.insertOne(row('app', ip, now - EVICTED_EXPIRY_MS - 10 * 60 * 1000));

      await messageStore.applyEviction(ip, now - EVICTED_EXPIRY_MS - 1000);

      expect(await eviction()).to.equal(null);
      expect(await find('app')).to.not.equal(null);
    });

    it('takes a time in the future as now', async () => {
      const before = Date.now();
      await collection.insertOne(row('app', ip, before + 60 * 1000));

      await messageStore.applyEviction(ip, before + 24 * 60 * 60 * 1000);

      const stored = await eviction();
      expect(stored.createdAt.getTime()).to.be.within(before, Date.now());
      expect(await find('app')).to.not.equal(null);
    });

    it('takes an unreadable time as now', async () => {
      const before = Date.now();
      await collection.insertOne(row('app', ip, before - 1000));

      await messageStore.applyEviction(ip, NaN);

      expect((await eviction()).createdAt.getTime()).to.be.within(before, Date.now());
      expect(await find('app')).to.equal(null);
    });
  });
});
