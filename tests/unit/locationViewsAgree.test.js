const { expect } = require('chai');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const { requireMongo } = require('./dbTestHelper');
const { SIGTERM_EXPIRY_MS } = require('../../ZelBack/src/services/utils/appConstants');

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

  describe('when a node moves', () => {
    const A = '203.0.113.150:16127';
    const B = '203.0.113.151:16127';
    const C = '203.0.113.152:16127';
    const A2 = '203.0.113.150:16157';
    const appName = 'viewsagreemoved';

    async function reportByGossip(ip, name, broadcastedAt) {
      const data = {
        type: 'fluxapprunning',
        version: 2,
        apps: [{ name, hash: `hash-${name}`, runningSince: new Date(broadcastedAt).toISOString() }],
        ip,
        broadcastedAt,
        osUptime: 1000,
        staticIp: false,
      };
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, { signedBroadcast: { ...envelope, data } });
      await messageStore.storeAppRunningMessage(data);
    }

    async function move(oldIP, newIP, broadcastedAt) {
      const message = {
        type: 'fluxipchanged', version: 1, oldIP, newIP, broadcastedAt,
      };
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.IPCHANGED, { message, envelope });
      await messageStore.storeIPChangedMessage(message);
    }

    function orders(items) {
      if (items.length <= 1) return [items];
      return items.flatMap((item, i) => orders([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
    }

    // Each step is signed the given seconds before now, inside gossip's window.
    //
    // The event view is held to the answer in every order. The table only keeps
    // what has arrived, so it is held where it has what it needs: the report
    // arrives before what cancels it, and what was signed after a move arrives
    // after the move that says whose address it is.
    const scenarios = [
      {
        title: 'a report made before the move, arriving after it',
        steps: [{ report: [A, 240] }, { move: [A, B, 160] }],
        expected: [B],
      },
      {
        title: 'a report at the new address beside one made before the move',
        steps: [{ report: [A, 240] }, { move: [A, B, 160] }, { report: [B, 80] }],
        expected: [B],
      },
      {
        title: 'a removal at the new address',
        steps: [{ report: [A, 240] }, { move: [A, B, 160] }, { remove: [B, 80] }],
        expected: [],
      },
      {
        title: 'a removal made before the move',
        steps: [{ report: [A, 240] }, { remove: [A, 200] }, { move: [A, B, 160] }],
        expected: [],
      },
      {
        title: 'a removal at the old address by whoever holds it after the move',
        steps: [{ report: [A, 240] }, { move: [A, B, 160] }, { remove: [A, 80] }],
        expected: [B],
      },
      {
        title: 'a removal before the report and one after it, at the two addresses',
        steps: [{ remove: [A, 280] }, { report: [A, 240] }, { move: [A, B, 160] }, { remove: [B, 80] }],
        expected: [],
      },
      {
        title: 'a removal at the new address before the report, and one at the old address after it',
        steps: [{ remove: [B, 300] }, { report: [A, 240] }, { remove: [A, 200] }, { move: [A, B, 160] }],
        expected: [],
      },
      {
        title: 'an eviction of the new address before the report, and one of the old address after it',
        steps: [{ evict: [B, 300] }, { report: [A, 240] }, { evict: [A, 200] }, { move: [A, B, 160] }],
        expected: [],
      },
      {
        title: 'an eviction at the new address',
        steps: [{ report: [A, 240] }, { move: [A, B, 160] }, { evict: [B, 80] }],
        expected: [],
      },
      {
        title: 'an eviction made before the move',
        steps: [{ report: [A, 240] }, { evict: [A, 200] }, { move: [A, B, 160] }],
        expected: [],
      },
      {
        title: 'an eviction of the old address after the move',
        steps: [{ report: [A, 240] }, { move: [A, B, 160] }, { evict: [A, 80] }],
        expected: [B],
      },
      {
        title: 'a shutdown at the new address, inside its grace',
        steps: [{ report: [A, 240] }, { move: [A, B, 160] }, { shutDown: [B, 10] }],
        expected: [B],
      },
      {
        title: 'two moves',
        steps: [{ report: [A, 240] }, { move: [A, B, 160] }, { move: [B, C, 80] }],
        expected: [C],
      },
      {
        title: 'a move away and back',
        steps: [{ report: [A, 240] }, { move: [A, B, 160] }, { move: [B, A, 80] }],
        expected: [A],
      },
      {
        title: 'a move of the port alone',
        steps: [{ report: [A, 240] }, { move: [A, A2, 160] }],
        expected: [A2],
      },
      {
        title: 'a move announced at the same instant as the report',
        steps: [{ report: [A, 240] }, { move: [A, B, 240] }],
        expected: [A],
      },
    ];

    const cancels = (step) => step.remove || step.evict || step.shutDown;
    const signedAgo = (step) => Object.values(step)[0].at(-1);
    function tableHasWhatItNeeds(order) {
      const position = (step) => order.indexOf(step);
      return order.filter(cancels).every((cancel) => order.every((step) => {
        if (step.report) return position(step) < position(cancel);
        if (step.move && signedAgo(step) > signedAgo(cancel)) return position(step) < position(cancel);
        return true;
      }));
    }

    const writers = [
      { name: 'gossip', report: reportByGossip },
      { name: 'sync', report: reportRunning },
    ];

    writers.forEach((writer) => {
      scenarios.forEach(({ title, steps, expected }) => {
        it(`${title}, reported by ${writer.name}: the same answer in every order`, async () => {
          const now = Date.now();
          const at = (seconds) => now - seconds * 1000;
          ips.push(A, B, C, A2);
          const failures = [];
          // eslint-disable-next-line no-restricted-syntax
          for (const order of orders(steps)) {
            // eslint-disable-next-line no-await-in-loop
            await locations.deleteMany({ ip: { $in: ips } });
            // eslint-disable-next-line no-await-in-loop
            await events.deleteMany({ ip: { $in: ips } });
            // eslint-disable-next-line no-restricted-syntax
            for (const step of order) {
              /* eslint-disable no-await-in-loop */
              if (step.report) await writer.report(step.report[0], appName, at(step.report[1]));
              if (step.move) await move(step.move[0], step.move[1], at(step.move[2]));
              if (step.remove) await remove(step.remove[0], appName, at(step.remove[1]));
              if (step.evict) await evict(step.evict[0], at(step.evict[1]));
              if (step.shutDown) await shutDown(step.shutDown[0], at(step.shutDown[1]));
              /* eslint-enable no-await-in-loop */
            }
            const describeOrder = order.map((step) => Object.entries(step)[0].join(':')).join(' then ');
            // eslint-disable-next-line no-await-in-loop
            const derived = (await registryManager.appLocationFromEvents({ appname: appName })).map((row) => row.ip).sort();
            // eslint-disable-next-line no-await-in-loop
            const table = (await registryManager.appLocation(appName)).map((row) => row.ip).sort();
            if (JSON.stringify(derived) !== JSON.stringify(expected)) failures.push(`event view ${JSON.stringify(derived)} after ${describeOrder}`);
            const tableHeld = tableHasWhatItNeeds(order);
            if (tableHeld && JSON.stringify(table) !== JSON.stringify(expected)) failures.push(`table ${JSON.stringify(table)} after ${describeOrder}`);
          }
          expect(failures, `expected ${JSON.stringify(expected)}`).to.deep.equal([]);
        });
      });
    });

    it('a shutdown made before the move shortens the row at the new address', async () => {
      ips.push(A, B);
      const now = Date.now();
      await reportRunning(A, appName, now - 240000);
      await move(A, B, now - 160000);
      await shutDown(A, now - 200000);

      const [row] = await registryManager.appLocation(appName);
      const stored = await locations.findOne({ name: appName, ip: row.ip });
      expect(row.ip).to.equal(B);
      expect(stored.expireAt.getTime()).to.equal(now - 200000 + SIGTERM_EXPIRY_MS);
    });

    it('an ipchanged event that is not a move is not followed', async () => {
      ips.push(A, B);
      const now = Date.now();
      await reportRunning(A, appName, now - 240000);
      const notAMove = { type: 'fluxipchanged', version: 2, oldIP: A, newIP: B, broadcastedAt: now - 160000 };
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.IPCHANGED, { message: notAMove, envelope });

      expect((await registryManager.appLocationFromEvents({ appname: appName })).map((row) => row.ip)).to.deep.equal([A]);
    });

    it('a sync response prunes what a node stopped running where the node is now', async () => {
      ips.push(A, B);
      const now = Date.now();
      const report = (apps, broadcastedAt) => ({
        ...envelope,
        data: {
          type: 'fluxapprunning', version: 2, ip: A, broadcastedAt, osUptime: 1, staticIp: false,
          apps: apps.map((name) => ({ name, hash: `hash-${name}`, runningSince: new Date(now - 300000).toISOString() })),
        },
      });
      await messageStore.storeBatchAppRunningMessages([report([appName, `${appName}gone`], now - 280000)]);
      await move(A, B, now - 160000);
      await messageStore.storeBatchAppRunningMessages([report([appName], now - 240000)]);
      await messageStore.pruneAppRunningLocations(new Map([[A, { names: [appName], broadcastedAt: now - 240000 }]]));

      expect((await registryManager.appLocation(`${appName}gone`)).map((row) => row.ip)).to.deep.equal([]);
      expect((await registryManager.appLocationFromEvents({ appname: `${appName}gone` })).map((row) => row.ip)).to.deep.equal([]);
      expect((await registryManager.appLocation(appName)).map((row) => row.ip)).to.deep.equal([B]);
    });

    it('a move leaves what was reported at the old address after it', async () => {
      ips.push(A, B);
      const now = Date.now();
      await reportRunning(A, appName, now - 80000);
      await move(A, B, now - 160000);

      expect((await registryManager.appLocation(appName)).map((row) => row.ip)).to.deep.equal([A]);
    });

    it('a report made before a move meets the node\'s row at its new address: the earlier runningSince stays', async () => {
      ips.push(A, B);
      const now = Date.now();
      await move(A, B, now - 160000);
      await reportRunning(B, appName, now - 80000);
      await reportByGossip(A, appName, now - 240000);

      const [row] = await registryManager.appLocation(appName);
      expect(new Date(row.runningSince).getTime()).to.equal(now - 240000);
    });

    it('a node that moved here is found by its address, by what it said before the move', async () => {
      ips.push(A, B);
      const now = Date.now();
      await reportRunning(A, appName, now - 240000);
      await move(A, B, now - 160000);

      expect((await registryManager.appLocationFromEvents({ ip: B })).map((row) => row.ip)).to.deep.equal([B]);
      expect(await registryManager.appLocationFromEvents({ ip: A })).to.deep.equal([]);
    });
  });
});
