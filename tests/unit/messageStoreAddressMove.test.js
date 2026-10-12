const { expect } = require('chai');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const { requireMongo } = require('./dbTestHelper');

describe('messageStore address move tests', () => {
  before(requireMongo);

  const OLD = '72.89.45.236:16137';
  const NEW = '108.6.236.4:16137';
  const HOUR = 60 * 60 * 1000;
  let locations;

  const row = (name, ip, runningSince) => ({
    name, hash: 'h', ip, runningSince: new Date(runningSince), broadcastedAt: new Date(), expireAt: new Date(Date.now() + HOUR),
  });
  const moved = () => messageStore.storeIPChangedMessage({
    type: 'fluxipchanged', version: 1, oldIP: OLD, newIP: NEW, broadcastedAt: Date.now(),
  });

  beforeEach(async () => {
    await dbHelper.initiateDB();
    locations = dbHelper.databaseConnection().db(config.database.appsglobal.database)
      .collection(config.database.appsglobal.collections.appsLocations);
    await locations.deleteMany({});
  });

  it('carries every row at the old address to the new one, runningSince and all', async () => {
    await locations.insertMany([row('alpha', OLD, '2026-09-01T00:00:00Z'), row('beta', OLD, '2026-09-02T00:00:00Z')]);

    await moved();

    const rows = await locations.find({}, { projection: { _id: 0, name: 1, ip: 1, runningSince: 1 } }).sort({ name: 1 }).toArray();
    expect(rows).to.deep.equal([
      { name: 'alpha', ip: NEW, runningSince: new Date('2026-09-01T00:00:00Z') },
      { name: 'beta', ip: NEW, runningSince: new Date('2026-09-02T00:00:00Z') },
    ]);
  });

  it('leaves one row for an app already announced at the new address, with the earlier runningSince', async () => {
    await locations.insertMany([
      row('alpha', OLD, '2026-09-01T00:00:00Z'),
      row('alpha', NEW, '2026-10-11T06:01:59Z'),
      row('beta', OLD, '2026-09-02T00:00:00Z'),
    ]);

    await moved();

    const rows = await locations.find({}, { projection: { _id: 0, name: 1, ip: 1, runningSince: 1 } }).sort({ name: 1 }).toArray();
    expect(rows).to.deep.equal([
      { name: 'alpha', ip: NEW, runningSince: new Date('2026-09-01T00:00:00Z') },
      { name: 'beta', ip: NEW, runningSince: new Date('2026-09-02T00:00:00Z') },
    ]);
  });

  it('keeps the new address\'s runningSince when it is the earlier one', async () => {
    await locations.insertMany([row('alpha', OLD, '2026-10-01T00:00:00Z'), row('alpha', NEW, '2026-09-01T00:00:00Z')]);

    await moved();

    const rows = await locations.find({}, { projection: { _id: 0, name: 1, ip: 1, runningSince: 1 } }).toArray();
    expect(rows).to.deep.equal([{ name: 'alpha', ip: NEW, runningSince: new Date('2026-09-01T00:00:00Z') }]);
  });

  it('carries the rows of a move of the port alone', async () => {
    await locations.insertMany([row('alpha', '198.51.100.40:16127', '2026-09-01T00:00:00Z')]);

    await messageStore.storeIPChangedMessage({
      type: 'fluxipchanged', version: 1, oldIP: '198.51.100.40:16127', newIP: '198.51.100.40:16157', broadcastedAt: Date.now(),
    });

    const rows = await locations.find({}, { projection: { _id: 0, ip: 1 } }).toArray();
    expect(rows.map((r) => r.ip)).to.deep.equal(['198.51.100.40:16157']);
  });

  it('leaves rows at other addresses alone', async () => {
    await locations.insertMany([row('alpha', OLD, '2026-09-01T00:00:00Z'), row('alpha', '72.89.45.236:16127', '2026-09-03T00:00:00Z')]);

    await moved();

    const rows = await locations.find({}, { projection: { _id: 0, ip: 1 } }).sort({ ip: 1 }).toArray();
    expect(rows.map((r) => r.ip)).to.deep.equal(['108.6.236.4:16137', '72.89.45.236:16127']);
  });
});
