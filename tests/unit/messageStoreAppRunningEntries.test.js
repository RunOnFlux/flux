const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const log = require('../../ZelBack/src/lib/log');
const { appRunningEntries } = require('../../ZelBack/src/services/utils/appRunningEntries');
const { RUNNING_EXPIRY_MS } = require('../../ZelBack/src/services/utils/appConstants');
const { requireMongo } = require('./dbTestHelper');

// A version 2 apprunning message is judged entry by entry: one entry without a
// name and hash costs its sender that entry, never the rest of the message.
describe('apprunning entries are stored one at a time', () => {
  const ip = '203.0.113.21:16127';
  const otherIp = '203.0.113.22:16127';
  const weeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);

  describe('appRunningEntries', () => {
    it('keeps an entry with a string name and a string hash', () => {
      const app = { name: 'web', hash: 'h1', runningSince: weeksAgo.toISOString() };
      expect(appRunningEntries([app])).to.deep.equal({ stored: [app], refused: [] });
    });

    it('refuses each entry without a string name and hash, and only those', () => {
      const good = { name: 'web', hash: 'h1' };
      const bad = [
        { name: 'probe' },
        { name: 'probe', hash: null },
        { name: 'probe', hash: 7 },
        { hash: 'h2' },
        { name: 3, hash: 'h2' },
        null,
        'web',
        undefined,
      ];
      const { stored, refused } = appRunningEntries([bad[0], good, ...bad.slice(1)]);
      expect(stored).to.deep.equal([good]);
      expect(refused).to.deep.equal(bad);
    });

    it('answers an empty list with nothing either way', () => {
      expect(appRunningEntries([])).to.deep.equal({ stored: [], refused: [] });
    });
  });

  describe('on a database', () => {
    before(requireMongo);

    let locations;

    const row = (name, rowIp, broadcastedAt, runningSince = broadcastedAt) => ({
      name,
      ip: rowIp,
      hash: `${name}hash`,
      broadcastedAt: new Date(broadcastedAt),
      expireAt: new Date(broadcastedAt + RUNNING_EXPIRY_MS),
      runningSince: new Date(runningSince),
    });
    const message = (apps, broadcastedAt = Date.now(), from = ip) => ({
      type: 'fluxapprunning', version: 2, apps, ip: from, broadcastedAt, osUptime: 1000, staticIp: true,
    });
    const rowsAt = async (rowIp = ip) => (await locations.find({ ip: rowIp }).sort({ name: 1 }).toArray());

    beforeEach(async () => {
      const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
      locations = database.collection(config.database.appsglobal.collections.appsLocations);
      await locations.deleteMany({ ip: { $in: [ip, otherIp] } });
    });

    afterEach(async () => {
      await locations.deleteMany({ ip: { $in: [ip, otherIp] } });
    });

    describe('storeAppRunningMessage', () => {
      it('stores the entries with a name and hash and refuses the one without', async () => {
        const result = await messageStore.storeAppRunningMessage(message([
          { name: 'web', hash: 'webhash' },
          { name: 'probe' },
          { name: 'db', hash: 'dbhash' },
        ]));

        expect(result).to.deep.equal({ stored: true, rebroadcast: true });
        expect((await rowsAt()).map((r) => r.name)).to.deep.equal(['db', 'web']);
      });

      // A long-running app announced beside an app installed without a hash.
      it('keeps refreshing a long-running app announced beside an entry without a hash', async () => {
        const lastHour = Date.now() - 60 * 60 * 1000;
        await locations.insertOne(row('hytale', ip, lastHour, weeksAgo.getTime()));

        const now = Date.now();
        await messageStore.storeAppRunningMessage(message([
          { name: 'hytale', hash: 'hytalehash', runningSince: weeksAgo.toISOString() },
          { name: 'probe', runningSince: new Date(now).toISOString() },
        ], now));

        const [hytale, ...rest] = await rowsAt();
        expect(rest).to.deep.equal([]);
        expect(hytale.name).to.equal('hytale');
        expect(hytale.broadcastedAt.getTime()).to.equal(now);
        expect(hytale.expireAt.getTime()).to.equal(now + RUNNING_EXPIRY_MS);
        expect(hytale.runningSince.getTime()).to.equal(weeksAgo.getTime());
      });

      it('stores nothing and relays nothing when every entry is refused', async () => {
        const result = await messageStore.storeAppRunningMessage(message([{ name: 'probe' }, null]));

        expect(result).to.deep.equal({ stored: false, rebroadcast: false });
        expect(await rowsAt()).to.deep.equal([]);
      });

      // An empty v2 message deletes the sender's rows. A message whose entries
      // were all refused named apps; it must not be read as one that named none.
      it('never reads a message whose every entry was refused as an empty snapshot', async () => {
        const earlier = Date.now() - 10 * 60 * 1000;
        await locations.insertOne(row('web', ip, earlier));

        await messageStore.storeAppRunningMessage(message([{ name: 'probe' }]));

        const kept = await rowsAt();
        expect(kept.map((r) => r.name)).to.deep.equal(['web']);
        expect(kept[0].broadcastedAt.getTime()).to.equal(earlier);
      });

      // Canary for the test above: the deletion it guards against is real.
      it('still deletes the sender\'s older rows on a message that names no apps', async () => {
        await locations.insertOne(row('web', ip, Date.now() - 10 * 60 * 1000));

        const result = await messageStore.storeAppRunningMessage(message([]));

        expect(result).to.deep.equal({ stored: true, rebroadcast: true });
        expect(await rowsAt()).to.deep.equal([]);
      });

      it('writes nothing for another node', async () => {
        await locations.insertOne(row('web', otherIp, Date.now() - 10 * 60 * 1000));

        await messageStore.storeAppRunningMessage(message([{ name: 'probe' }, { name: 'db', hash: 'dbhash' }]));

        expect((await rowsAt(otherIp)).map((r) => r.name)).to.deep.equal(['web']);
      });

      it('still refuses a version 1 message without a hash', async () => {
        const result = await messageStore.storeAppRunningMessage({
          type: 'fluxapprunning', version: 1, name: 'probe', ip, broadcastedAt: Date.now(),
        });

        expect(result).to.be.instanceOf(Error);
        expect(await rowsAt()).to.deep.equal([]);
      });
    });

    describe('storeBatchAppRunningMessages', () => {
      const broadcast = (data) => ({ version: 1, timestamp: data.broadcastedAt, pubKey: '04ab', signature: 'sig', data });

      it('stores the entries with a name and hash and writes no row for the one without', async () => {
        const result = await messageStore.storeBatchAppRunningMessages([
          broadcast(message([{ name: 'web', hash: 'webhash' }, { name: 'probe' }, { name: 'db', hash: 'dbhash' }])),
        ]);

        expect(result.writeFailed).to.equal(false);
        const rows = await rowsAt();
        expect(rows.map((r) => r.name)).to.deep.equal(['db', 'web']);
        expect(rows.every((r) => typeof r.hash === 'string')).to.equal(true);
      });

      it('logs the refusals of a whole batch in one line', async () => {
        const warn = sinon.stub(log, 'warn');
        try {
          await messageStore.storeBatchAppRunningMessages([
            broadcast(message([{ name: 'probe' }, { name: 'web', hash: 'webhash' }])),
            broadcast(message([{ name: 'probe2' }, { name: 'probe3' }], Date.now(), otherIp)),
          ]);
        } finally {
          warn.restore();
        }

        expect(warn.callCount).to.equal(1);
        expect(warn.firstCall.args[0]).to.match(/^storeBatchAppRunningMessages - 3 app entries in 2 messages have no string name and hash and are not stored\./);
      });

      it('stores the other broadcasts of a batch when one has only refused entries', async () => {
        await messageStore.storeBatchAppRunningMessages([
          broadcast(message([{ name: 'probe' }])),
          broadcast(message([{ name: 'web', hash: 'webhash' }], Date.now(), otherIp)),
        ]);

        expect(await rowsAt()).to.deep.equal([]);
        expect((await rowsAt(otherIp)).map((r) => r.name)).to.deep.equal(['web']);
      });
    });
  });
});
