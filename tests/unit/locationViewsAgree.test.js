const { expect } = require('chai');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const { requireMongo } = require('./dbTestHelper');

// Where an app runs is kept twice: the location table, and the view derived
// from the event log. Every event that changes one is applied to both, and the
// two must give the same answer for every order the events can arrive in.
describe('the location table and the event-derived view agree', () => {
  before(requireMongo);

  const ips = [];
  let locations;
  let events;

  const envelope = { version: 1, timestamp: 1, pubKey: 'PUB', signature: 'SIG' };

  async function reportRunning(ip, appName, broadcastedAt) {
    const data = {
      type: 'fluxapprunning',
      version: 2,
      apps: [{ name: appName, hash: `hash-${appName}`, runningSince: new Date(broadcastedAt).toISOString() }],
      ip,
      broadcastedAt,
      osUptime: 1000,
      staticIp: false,
    };
    await messageStore.storeBatchAppRunningMessages([{ ...envelope, data }]);
  }

  async function shutDown(ip, broadcastedAt) {
    const message = {
      type: 'fluxnodesigterm', version: 1, ip, broadcastedAt,
    };
    await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.SIGTERM, { message, envelope });
    await messageStore.expireLocationsForSigterm(ip, broadcastedAt);
  }

  async function remove(ip, appName, broadcastedAt) {
    const message = {
      type: 'fluxappremoved', version: 1, appName, ip, broadcastedAt,
    };
    await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPREMOVED, { message, envelope });
    await messageStore.removeLocationForAppRemoved(ip, appName, broadcastedAt);
  }

  async function evict(ip, evictedAt) {
    await messageStore.applyEviction(ip, evictedAt);
  }

  beforeEach(async () => {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    locations = database.collection(config.database.appsglobal.collections.appsLocations);
    events = database.collection(config.database.appsglobal.collections.appStateEvents);
  });

  afterEach(async () => {
    await locations.deleteMany({ ip: { $in: ips } });
    await events.deleteMany({ ip: { $in: ips } });
    ips.length = 0;
  });

  // Running report at `runningAt`; `event` applied after it, at `eventAt`.
  const cases = [
    { title: 'an older shutdown', event: shutDown, offset: -30000, running: true },
    { title: 'a newer shutdown, inside its grace', event: shutDown, offset: 30000, running: true },
    { title: 'an older removal', event: remove, offset: -30000, running: true },
    { title: 'a removal at the same instant', event: remove, offset: 0, running: false },
    { title: 'a newer removal', event: remove, offset: 30000, running: false },
    { title: 'an older eviction', event: evict, offset: -30000, running: true },
    { title: 'an eviction at the same instant', event: evict, offset: 0, running: true },
    { title: 'a newer eviction', event: evict, offset: 30000, running: false },
  ];

  cases.forEach(({
    title, event, offset, running,
  }, index) => {
    it(`${title} arriving after the report: ${running ? 'running' : 'not running'} in both`, async () => {
      const ip = `203.0.113.${100 + index}:16127`;
      const appName = `viewsagree${index}`;
      ips.push(ip);
      const runningAt = Date.now() - 60000;

      await reportRunning(ip, appName, runningAt);
      if (event === remove) await event(ip, appName, runningAt + offset);
      else await event(ip, runningAt + offset);

      const table = (await registryManager.appLocation(appName)).map((row) => row.ip);
      const derived = (await registryManager.appLocationFromEvents({ appname: appName })).map((row) => row.ip);

      expect(derived, 'the two views disagree').to.deep.equal(table);
      expect(table, 'both views agree on the wrong answer').to.deep.equal(running ? [ip] : []);
    });
  });
});
