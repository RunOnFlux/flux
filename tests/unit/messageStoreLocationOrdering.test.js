const { expect } = require('chai');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const { SIGTERM_EXPIRY_MS, RUNNING_EXPIRY_MS } = require('../../ZelBack/src/services/utils/appConstants');
const { requireMongo } = require('./dbTestHelper');

// A shutdown or a removal speaks only for the location rows its node broadcast
// before it. Peer sync replays every unexpired event after a restart, so these
// arrive out of order in normal operation.
describe('messageStore location ordering', () => {
  before(requireMongo);

  const ip = '203.0.113.7:16127';
  const otherIp = '203.0.113.8:16127';
  let collection;

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
    await collection.deleteMany({ ip: { $in: [ip, otherIp] } });
  });

  afterEach(async () => {
    await collection.deleteMany({ ip: { $in: [ip, otherIp] } });
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
});
