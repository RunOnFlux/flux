const { expect } = require('chai');
const config = require('config');
const proxyquire = require('proxyquire');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const appPlacements = require('../../ZelBack/src/services/appManagement/appPlacements');
const { requireMongo } = require('./dbTestHelper');

describe('appPlacements', () => {
  before(requireMongo);

  const me = '203.0.113.50:16127';
  const other = '203.0.113.51:16127';
  const june = new Date('2026-06-01T00:00:00.000Z');
  const july = new Date('2026-07-01T00:00:00.000Z');
  let placements;
  let locations;

  const recorded = async () => (await placements.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray());

  beforeEach(async () => {
    placements = dbHelper.databaseConnection().db(config.database.appslocal.database)
      .collection(config.database.appslocal.collections.appsPlacements);
    locations = dbHelper.databaseConnection().db(config.database.appsglobal.database)
      .collection(config.database.appsglobal.collections.appsLocations);
    await placements.deleteMany({});
    await locations.deleteMany({ ip: { $in: [me, other] } });
    await appPlacements.prepareCollection();
  });

  afterEach(async () => {
    await placements.deleteMany({});
    await locations.deleteMany({ ip: { $in: [me, other] } });
  });

  it('holds one record per app name', async () => {
    const indexes = await placements.indexes();
    expect(indexes.find((index) => index.name === 'name_unique')).to.include({ unique: true });
  });

  // A record written as an install writes it: dated at the call, over whatever
  // record the app had.
  const seed = (name, placedAt) => placements.insertOne({ name, placedAt });

  describe('recordPlacement', () => {
    it('records that this node took an app now', async () => {
      const before = Date.now();
      await appPlacements.recordPlacement('web');

      const [record] = await recorded();
      expect(record.name).to.equal('web');
      expect(record.placedAt.getTime()).to.be.within(before, Date.now());
    });

    // A hard install creates the app's volume: the record of the data before it
    // describes data this node no longer holds.
    it('replaces a record the app already had', async () => {
      await seed('web', june);
      const before = Date.now();

      await appPlacements.recordPlacement('web');

      const records = await recorded();
      expect(records).to.have.length(1);
      expect(records[0].placedAt.getTime()).to.be.within(before, Date.now());
    });

    it('keeps one record when two writers race the first one', async () => {
      await Promise.all([
        appPlacements.recordPlacement('web'),
        appPlacements.recordPlacement('web'),
        appPlacements.recordPlacement('web'),
      ]);

      expect(await recorded()).to.have.length(1);
    });
  });

  describe('placementsOf', () => {
    it('answers the apps it has records for, and only those', async () => {
      await seed('web', june);
      await seed('db', july);

      const found = await appPlacements.placementsOf(['web', 'cache']);

      expect([...found]).to.deep.equal([['web', june]]);
    });
  });

  describe('removePlacement', () => {
    it('forgets the one app', async () => {
      await seed('web', june);
      await seed('db', july);

      await appPlacements.removePlacement('web');

      expect(await recorded()).to.deep.equal([{ name: 'db', placedAt: july }]);
    });
  });

  describe('removeStrayPlacements', () => {
    it('removes the record of an app not installed here, and only that', async () => {
      await seed('gone', june);
      await seed('web', july);

      const removed = await appPlacements.removeStrayPlacements(['web']);

      expect(removed).to.equal(1);
      expect(await recorded()).to.deep.equal([{ name: 'web', placedAt: july }]);
    });

    it('removes every record when nothing is installed', async () => {
      await seed('gone', june);

      await appPlacements.removeStrayPlacements([]);

      expect(await recorded()).to.deep.equal([]);
    });
  });

  describe('backfillPlacements', () => {
    const row = (name, ip, runningSince) => ({
      name, ip, hash: `${name}hash`, broadcastedAt: new Date(), expireAt: new Date(Date.now() + 3600000), runningSince,
    });

    // Seeding from the row keeps every app where the network already ranks it, so
    // a node that has just upgraded does not become the newest copy of all it holds.
    it('dates an installed app with no record at the runningSince of this node\'s own row', async () => {
      await locations.insertOne(row('web', me, june));

      const result = await appPlacements.backfillPlacements(['web'], me);

      expect(result).to.deep.equal({ created: 1, fromLocationRows: 1 });
      expect(await recorded()).to.deep.equal([{ name: 'web', placedAt: june }]);
    });

    it('reads only this node\'s row, never another node\'s', async () => {
      await locations.insertOne(row('web', other, june));
      const before = Date.now();

      await appPlacements.backfillPlacements(['web'], me);

      const [{ placedAt }] = await recorded();
      expect(placedAt.getTime()).to.be.within(before, Date.now());
    });

    it('dates an installed app with neither a record nor a row now', async () => {
      const before = Date.now();

      await appPlacements.backfillPlacements(['web'], me);

      const [{ placedAt }] = await recorded();
      expect(placedAt.getTime()).to.be.within(before, Date.now());
    });

    it('leaves a record it already has, whatever the row says', async () => {
      await seed('web', june);
      await locations.insertOne(row('web', me, july));

      const result = await appPlacements.backfillPlacements(['web'], me);

      expect(result).to.deep.equal({ created: 0, fromLocationRows: 0 });
      expect(await recorded()).to.deep.equal([{ name: 'web', placedAt: june }]);
    });

    it('touches no record of an app not installed here', async () => {
      await seed('gone', june);

      await appPlacements.backfillPlacements(['web'], me);

      expect((await recorded()).map((r) => r.name)).to.deep.equal(['gone', 'web']);
    });
  });

  describe('waitForBackfill', () => {
    it('resolves once the backfill has written, and not before', async () => {
      const fresh = proxyquire('../../ZelBack/src/services/appManagement/appPlacements', {});
      let resolved = false;
      const waiting = fresh.waitForBackfill().then(() => { resolved = true; });
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(resolved, 'resolved before the backfill ran').to.equal(false);

      await fresh.backfillPlacements(['web'], me);
      await waiting;

      expect(resolved).to.equal(true);
      expect((await recorded()).map((r) => r.name)).to.deep.equal(['web']);
    });
  });
});
