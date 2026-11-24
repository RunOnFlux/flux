const { expect } = require('chai');
const { specHash } = require('./fixtures/specHash');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const { RUNNING_EXPIRY_MS } = require('../../ZelBack/src/services/utils/appConstants');
const { requireMongo, releaseMongo } = require('./dbTestHelper');

// A report or removal is stored only when it is exactly the message its type and
// version describe (broadcastShape); any other is refused whole.
describe('the store takes only well-formed reports and removals', () => {
  before(requireMongo);
  after(releaseMongo);

  const ip = '203.0.113.21:16127';
  const otherIp = '203.0.113.22:16127';
  const weeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);

  let locations;
  let events;

  const without = (data, field) => Object.fromEntries(Object.entries(data).filter(([key]) => key !== field));
  const app = (name) => ({ name, hash: specHash(`${name}hash`), runningSince: weeksAgo.toISOString() });
  const row = (name, rowIp, broadcastedAt) => ({
    name,
    ip: rowIp,
    hash: specHash(`${name}hash`),
    broadcastedAt: new Date(broadcastedAt),
    expireAt: new Date(broadcastedAt + RUNNING_EXPIRY_MS),
    runningSince: weeksAgo,
  });
  const message = (apps, broadcastedAt = Date.now(), from = ip) => ({
    type: 'fluxapprunning', version: 2, apps, ip: from, broadcastedAt, osUptime: 1000, staticIp: true,
  });
  const signed = (data) => ({
    version: 1, timestamp: data.broadcastedAt, pubKey: '04ab', signature: 'sig', data,
  });
  const rowsAt = async (rowIp = ip) => (await locations.find({ ip: rowIp }).sort({ name: 1 }).toArray());
  const storedReports = async () => (await events.find({ ip, type: 'apprunning' }).toArray()).map((event) => event.data.apps.map((a) => a.name));

  beforeEach(async () => {
    const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
    locations = database.collection(config.database.appsglobal.collections.appsLocations);
    events = database.collection(config.database.appsglobal.collections.appStateEvents);
    await locations.deleteMany({ ip: { $in: [ip, otherIp] } });
    await events.deleteMany({ ip: { $in: [ip, otherIp] } });
  });

  afterEach(async () => {
    await locations.deleteMany({ ip: { $in: [ip, otherIp] } });
    await events.deleteMany({ ip: { $in: [ip, otherIp] } });
  });

  const malformedReports = [
    ['an app without a hash', () => message([app('web'), without(app('probe'), 'hash')])],
    ['an app with a field no app carries', () => message([app('web'), { ...app('db'), extra: 1 }])],
    ['an app that is not an object', () => message([app('web'), 'db'])],
    ['a field no report carries', () => ({ ...message([app('web')]), apps2: [] })],
    ['no uptime', () => without(message([app('web')]), 'osUptime')],
  ];

  describe('storeAppRunningMessage', () => {
    it('stores a well-formed report', async () => {
      const result = await messageStore.storeAppRunningMessage(message([app('web'), app('db')]));

      expect(result).to.deep.equal({
        stored: true, rebroadcast: true, written: [app('web'), app('db')], cleared: false,
      });
      expect((await rowsAt()).map((r) => r.name)).to.deep.equal(['db', 'web']);
    });

    malformedReports.forEach(([what, data]) => {
      it(`refuses a report with ${what} whole, and leaves the sender's rows as they were`, async () => {
        const earlier = Date.now() - 10 * 60 * 1000;
        await locations.insertOne(row('old', ip, earlier));

        const result = await messageStore.storeAppRunningMessage(data());

        expect(result).to.be.instanceOf(Error);
        const kept = await rowsAt();
        expect(kept.map((r) => r.name)).to.deep.equal(['old']);
        expect(kept[0].broadcastedAt.getTime()).to.equal(earlier);
      });
    });

    it('deletes the sender\'s older rows on a report that names no apps', async () => {
      await locations.insertOne(row('web', ip, Date.now() - 10 * 60 * 1000));

      const result = await messageStore.storeAppRunningMessage(message([]));

      expect(result).to.deep.equal({
        stored: true, rebroadcast: true, written: [], cleared: true,
      });
      expect(await rowsAt()).to.deep.equal([]);
    });

    it('reports no entry as written when a report changes no row', async () => {
      const at = Date.now();
      await messageStore.storeAppRunningMessage(message([app('web')], at));

      const again = await messageStore.storeAppRunningMessage(message([app('web')], at));

      expect(again).to.deep.equal({
        stored: false, rebroadcast: false, written: [], cleared: false,
      });
    });

    it('refuses a version 1 report', async () => {
      const result = await messageStore.storeAppRunningMessage({
        type: 'fluxapprunning', version: 1, name: 'probe', hash: specHash('probehash'), ip, broadcastedAt: Date.now(),
      });

      expect(result).to.be.instanceOf(Error);
      expect(await rowsAt()).to.deep.equal([]);
    });
  });

  describe('the event log', () => {
    malformedReports.forEach(([what, data]) => {
      it(`keeps the sender's last report over a later one with ${what}`, async () => {
        await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, { signedBroadcast: signed(message([app('web')], Date.now() - 1000)) });
        await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, { signedBroadcast: signed(data()) });

        expect(await storedReports()).to.deep.equal([['web']]);
      });
    });
  });

  describe('storeBatchAppRunningMessages', () => {
    it('writes a row for every app a well-formed synced report names', async () => {
      const result = await messageStore.storeBatchAppRunningMessages([signed(message([app('web'), app('db')]))]);

      expect(result.writeFailed).to.equal(false);
      expect((await rowsAt()).map((r) => r.name)).to.deep.equal(['db', 'web']);
    });
  });

  describe('dropMalformedStoredEvents', () => {
    const stored = (type, data) => ({
      ip: data.ip, type, dedupKey: `${type}:${data.broadcastedAt}`, broadcastedAt: new Date(data.broadcastedAt), data, envelope: {},
    });
    const removal = (fields) => ({
      type: 'fluxappremoved', version: 1, appName: 'web', ip, broadcastedAt: Date.now(), ...fields,
    });

    it('deletes every stored report and removal that is not well formed, and only those', async () => {
      const now = Date.now();
      const good = [
        stored('apprunning', message([app('web')], now)),
        stored('appremoved', removal({ broadcastedAt: now + 1 })),
        stored('appremoved', {
          type: 'fluxappremoved', version: 2, apps: ['web', 'db'], ip, broadcastedAt: now + 2,
        }),
      ];
      const bad = [
        stored('apprunning', message([app('web'), without(app('probe'), 'hash')], now + 3)),
        stored('appremoved', removal({ apps: 'x', broadcastedAt: now + 4 })),
        stored('appremoved', removal({ appName: { $ne: '' }, broadcastedAt: now + 5 })),
        stored('apprunning', without(message([app('web')], now + 6), 'type')),
        stored('appremoved', message([app('web')], now + 7)),
      ];
      await events.insertMany([...good, ...bad]);

      const dropped = await messageStore.dropMalformedStoredEvents(events);

      expect(dropped).to.equal(5);
      const left = await events.find({ ip }).sort({ broadcastedAt: 1 }).toArray();
      expect(left.map((event) => event.dedupKey)).to.deep.equal(good.map((event) => event.dedupKey));
    });

    it('leaves the events of other types alone', async () => {
      await events.insertOne({
        ip, type: 'sigterm', dedupKey: 'sigterm', broadcastedAt: new Date(), data: { anything: true },
      });

      expect(await messageStore.dropMalformedStoredEvents(events)).to.equal(0);
      expect(await events.countDocuments({ ip })).to.equal(1);
    });
  });
});
