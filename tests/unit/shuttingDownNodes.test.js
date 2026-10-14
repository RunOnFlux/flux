const { expect } = require('chai');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const { SIGTERM_EXPIRY_MS } = require('../../ZelBack/src/services/utils/appConstants');
const { requireMongo } = require('./dbTestHelper');

describe('registryManager.shuttingDownNodes', () => {
  before(requireMongo);

  const ips = ['203.0.113.11:16127', '203.0.113.12:16127', '203.0.113.13:16127'];
  let events;

  beforeEach(async () => {
    const db = dbHelper.databaseConnection();
    events = db.db(config.database.appsglobal.database).collection(config.database.appsglobal.collections.appStateEvents);
    await events.deleteMany({ ip: { $in: ips } });
  });

  afterEach(async () => {
    await events.deleteMany({ ip: { $in: ips } });
  });

  const sigterm = (ip, at) => events.insertOne({ ip, type: 'sigterm', dedupKey: 'sigterm', broadcastedAt: new Date(at) });
  const running = (ip, at) => events.insertOne({ ip, type: 'apprunning', dedupKey: 'v2', broadcastedAt: new Date(at) });

  it('names a node whose newest event is a recent sigterm', async () => {
    const now = Date.now();
    await running(ips[0], now - 60 * 60 * 1000);
    await sigterm(ips[0], now - 60 * 1000);

    expect(await registryManager.shuttingDownNodes()).to.include(ips[0]);
  });

  it('does not name a node that has broadcast apprunning since its sigterm', async () => {
    const now = Date.now();
    await sigterm(ips[1], now - 2 * 60 * 1000);
    await running(ips[1], now - 60 * 1000);

    expect(await registryManager.shuttingDownNodes()).to.not.include(ips[1]);
  });

  it('does not name a node whose sigterm is older than the sigterm window', async () => {
    await sigterm(ips[2], Date.now() - SIGTERM_EXPIRY_MS - 60 * 1000);

    expect(await registryManager.shuttingDownNodes()).to.not.include(ips[2]);
  });
});
