const { expect } = require('chai');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const { requireMongo } = require('./dbTestHelper');

// On a real Mongo, so what is asserted is what the server stored.
describe('what a message carries reaches an update pipeline as data', () => {
  const { appsglobal } = config.database;
  const ip = '1.2.3.4:16127';
  // Fields of the shapes a stored value must come back in.
  const expressions = {
    sum: { $add: [1, 2] },
    field: '$ip',
    code: { $function: { body: 'function(){return 42}', args: [], lang: 'js' } },
    nested: { deeper: [{ $literal: 'x' }, '$broadcastedAt'] },
  };
  let database;

  before(async () => {
    await requireMongo();
  });

  beforeEach(async () => {
    await dbHelper.initiateDB();
    database = dbHelper.databaseConnection().db(appsglobal.database);
    await Promise.all(Object.values(appsglobal.collections).map((name) => database.collection(name).deleteMany({})));
  });

  const rowOf = (collection, query) => database.collection(appsglobal.collections[collection]).findOne(query, { projection: { _id: 0 } });

  [
    ['sigterm', 'fluxnodesigterm', { ip }],
    ['appremoved', 'fluxappremoved', { ip, appName: 'app' }],
    ['ipchanged', 'fluxipchanged', { oldIP: ip, newIP: '1.2.3.5:16127' }],
  ].forEach(([type, wire, fields]) => {
    it(`stores a ${type} as it was signed`, async () => {
      const message = {
        type: wire, version: 1, broadcastedAt: Date.now(), ...fields, ...expressions,
      };

      await messageStore.storeAppStateEvent(type, {
        message, envelope: { version: 1, timestamp: 1, pubKey: '$ip', signature: 'sig' },
      });

      const row = await rowOf('appStateEvents', { type });
      expect(row.data).to.deep.equal(message);
      expect(row.envelope.pubKey).to.equal('$ip');
    });
  });

  it('stores a live apprunning message as it was signed', async () => {
    const data = {
      type: 'fluxapprunning', version: 2, ip, broadcastedAt: Date.now(), apps: [{ name: 'app', hash: 'hash' }], ...expressions,
    };

    await messageStore.storeAppStateEvent('apprunning', {
      signedBroadcast: {
        version: 1, timestamp: 1, pubKey: 'key', signature: 'sig', data,
      },
    });

    expect((await rowOf('appStateEvents', { type: 'apprunning' })).data).to.deep.equal(data);
  });

  it('writes a location from app fields that read as expressions', async () => {
    const data = {
      type: 'fluxapprunning', version: 2, ip, broadcastedAt: Date.now(), osUptime: 1, staticIp: false, apps: [{ name: '$ip', hash: '$name' }],
    };

    await messageStore.storeBatchAppRunningMessages([{
      version: 1, timestamp: 1, pubKey: 'key', signature: 'sig', data,
    }]);

    const row = await rowOf('appsLocations', { ip });
    expect(row.name).to.equal('$ip');
    expect(row.hash).to.equal('$name');
  });

  it('writes an install error from text that reads as a field path', async () => {
    const data = {
      type: 'fluxappinstallingerror', version: 1, ip, broadcastedAt: Date.now(), name: '$ip', hash: '$name', error: '$hash',
    };

    await messageStore.storeBatchAppInstallingErrorMessages([{
      version: 1, timestamp: 1, pubKey: 'key', signature: 'sig', data, receivedAt: Date.now(),
    }]);

    const row = await rowOf('appsInstallingErrorsLocations', { ip });
    expect([row.name, row.hash, row.error]).to.deep.equal(['$ip', '$name', '$hash']);
  });

  it('writes an install claim from text that reads as a field path', async () => {
    const data = {
      type: 'fluxappinstalling', version: 1, ip, broadcastedAt: Date.now(), name: '$ip',
    };

    await messageStore.storeBatchAppInstallingMessages([{
      version: 1, timestamp: 1, pubKey: 'key', signature: 'sig', data, receivedAt: Date.now(),
    }]);

    expect((await rowOf('appsInstallingLocations', { ip })).name).to.equal('$ip');
  });

  it('keeps a row a report is older than', async () => {
    const now = Date.now();
    const report = (broadcastedAt, marker) => messageStore.storeAppStateEvent('sigterm', {
      message: {
        type: 'fluxnodesigterm', version: 1, ip, broadcastedAt, marker,
      },
      envelope: {
        version: 1, timestamp: 1, pubKey: 'key', signature: 'sig',
      },
    });

    await report(now, 'newer');
    await report(now - 1000, 'older');

    expect((await rowOf('appStateEvents', { type: 'sigterm' })).data.marker).to.equal('newer');
  });
});
