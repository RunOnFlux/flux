const { expect } = require('chai');
const config = require('config');
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

  describe('recordPlacement', () => {
    it('records when this node took an app', async () => {
      await appPlacements.recordPlacement('web', june);

      expect(await recorded()).to.deep.equal([{ name: 'web', placedAt: june }]);
    });

    // A redeploy reinstalls an app whose record this node kept.
    it('never moves a record that exists', async () => {
      await appPlacements.recordPlacement('web', june);
      await appPlacements.recordPlacement('web', july);

      expect(await recorded()).to.deep.equal([{ name: 'web', placedAt: june }]);
    });

    it('keeps one record when two writers race the first one', async () => {
      await Promise.all([
        appPlacements.recordPlacement('web', june),
        appPlacements.recordPlacement('web', july),
        appPlacements.recordPlacement('web', june),
      ]);

      expect(await recorded()).to.have.length(1);
    });
  });

  describe('placementsOf', () => {
    it('answers the apps it has records for, and only those', async () => {
      await appPlacements.recordPlacement('web', june);
      await appPlacements.recordPlacement('db', july);

      const found = await appPlacements.placementsOf(['web', 'cache']);

      expect([...found]).to.deep.equal([['web', june]]);
    });
  });

  describe('removePlacement', () => {
    it('forgets the one app', async () => {
      await appPlacements.recordPlacement('web', june);
      await appPlacements.recordPlacement('db', july);

      await appPlacements.removePlacement('web');

      expect(await recorded()).to.deep.equal([{ name: 'db', placedAt: july }]);
    });
  });

  describe('reconcilePlacements', () => {
    const row = (name, ip, runningSince) => ({
      name, ip, hash: `${name}hash`, broadcastedAt: new Date(), expireAt: new Date(Date.now() + 3600000), runningSince,
    });

    // Seeding from the row keeps every app where the network already ranks it, so
    // a node that has just upgraded does not become the newest copy of all it holds.
    it('dates an installed app with no record at the runningSince of this node\'s own row', async () => {
      await locations.insertOne(row('web', me, june));

      const result = await appPlacements.reconcilePlacements(['web'], me);

      expect(result).to.deep.equal({ created: 1, removed: 0 });
      expect(await recorded()).to.deep.equal([{ name: 'web', placedAt: june }]);
    });

    it('reads only this node\'s row, never another node\'s', async () => {
      await locations.insertOne(row('web', other, june));
      const before = Date.now();

      await appPlacements.reconcilePlacements(['web'], me);

      const [{ placedAt }] = await recorded();
      expect(placedAt.getTime()).to.be.within(before, Date.now());
    });

    it('dates an installed app with neither a record nor a row now', async () => {
      const before = Date.now();

      await appPlacements.reconcilePlacements(['web'], me);

      const [{ placedAt }] = await recorded();
      expect(placedAt.getTime()).to.be.within(before, Date.now());
    });

    it('dates an app now when this node does not know its own address', async () => {
      await locations.insertOne(row('web', me, june));
      const before = Date.now();

      await appPlacements.reconcilePlacements(['web'], null);

      const [{ placedAt }] = await recorded();
      expect(placedAt.getTime()).to.be.within(before, Date.now());
    });

    it('leaves a record it already has, whatever the row says', async () => {
      await appPlacements.recordPlacement('web', june);
      await locations.insertOne(row('web', me, july));

      const result = await appPlacements.reconcilePlacements(['web'], me);

      expect(result).to.deep.equal({ created: 0, removed: 0 });
      expect(await recorded()).to.deep.equal([{ name: 'web', placedAt: june }]);
    });

    it('removes the record of an app not installed here', async () => {
      await appPlacements.recordPlacement('gone', june);
      await appPlacements.recordPlacement('web', july);

      const result = await appPlacements.reconcilePlacements(['web'], me);

      expect(result).to.deep.equal({ created: 0, removed: 1 });
      expect(await recorded()).to.deep.equal([{ name: 'web', placedAt: july }]);
    });

    it('removes every record when nothing is installed', async () => {
      await appPlacements.recordPlacement('gone', june);

      await appPlacements.reconcilePlacements([], me);

      expect(await recorded()).to.deep.equal([]);
    });
  });
});
