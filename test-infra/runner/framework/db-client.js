import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://198.18.0.2:27017';

let sharedClient = null;

async function getClient() {
  if (!sharedClient) {
    sharedClient = new MongoClient(MONGO_URL);
    await sharedClient.connect();
  }
  return sharedClient;
}

export async function closeDb() {
  if (sharedClient) {
    await sharedClient.close();
    sharedClient = null;
  }
}

export function dbClient(nodeNum) {
  const prefix = `node${String(nodeNum).padStart(2, '0')}_`;

  const dbNames = {
    local: `${prefix}zelfluxlocal`,
    explorer: `${prefix}zelcashdata`,
    appsLocal: `${prefix}localzelapps`,
    appsGlobal: `${prefix}globalzelapps`,
    chainparams: `${prefix}chainparams`,
  };

  async function db(name) {
    const client = await getClient();
    return client.db(dbNames[name]);
  }

  return {
    prefix,
    dbNames,

    async hashCounts() {
      const explorerDb = await db('explorer');
      const col = explorerDb.collection('zelappshashes');
      const [total, resolved, missing, notFound] = await Promise.all([
        col.countDocuments({}),
        col.countDocuments({ message: true }),
        col.countDocuments({ message: false, messageNotFound: { $ne: true } }),
        col.countDocuments({ messageNotFound: true }),
      ]);
      return { total, resolved, missing, notFound };
    },

    async explorerHeight() {
      const explorerDb = await db('explorer');
      const doc = await explorerDb.collection('scannedheight').findOne({});
      return doc?.generalScannedHeight ?? 0;
    },

    async permanentMessageCount() {
      const globalDb = await db('appsGlobal');
      return globalDb.collection('zelappsmessages').countDocuments({});
    },

    async appSpecCount() {
      const globalDb = await db('appsGlobal');
      return globalDb.collection('zelappsinformation').countDocuments({});
    },

    async tempMessageCount() {
      const globalDb = await db('appsGlobal');
      return globalDb.collection('zelappstemporarymessages').countDocuments({});
    },

    async locationCount() {
      const globalDb = await db('appsGlobal');
      return globalDb.collection('zelappslocation').countDocuments({});
    },

    async installingCount() {
      const globalDb = await db('appsGlobal');
      return globalDb.collection('appsinstallinglocations').countDocuments({});
    },

    async installingErrorCount() {
      const globalDb = await db('appsGlobal');
      return globalDb.collection('appsInstallingErrorsLocations').countDocuments({});
    },

    async localAppCount() {
      const localDb = await db('appsLocal');
      return localDb.collection('zelappsinformation').countDocuments({});
    },

    async eventCounts() {
      const globalDb = await db('appsGlobal');
      const col = globalDb.collection('appstateevents');
      const hasCollection = await globalDb.listCollections({ name: 'appstateevents' }).hasNext();
      if (!hasCollection) return { total: 0 };
      const total = await col.countDocuments({});
      return { total };
    },

    async geolocation() {
      const localDb = await db('local');
      return localDb.collection('geolocation').findOne({ _id: 'nodeGeolocation' });
    },

    async clearExplorer() {
      const explorerDb = await db('explorer');
      const collections = await explorerDb.listCollections().toArray();
      for (const col of collections) {
        if (col.name !== 'scannedheight') {
          await explorerDb.collection(col.name).deleteMany({});
        }
      }
    },

    async clearAppsGlobal() {
      const globalDb = await db('appsGlobal');
      const collections = await globalDb.listCollections().toArray();
      for (const col of collections) {
        await globalDb.collection(col.name).deleteMany({});
      }
    },

    async clearAll() {
      await this.clearExplorer();
      await this.clearAppsGlobal();
      const localDb = await db('appsLocal');
      const localCols = await localDb.listCollections().toArray();
      for (const col of localCols) {
        await localDb.collection(col.name).deleteMany({});
      }
    },

    async seedScannedHeight(height) {
      const explorerDb = await db('explorer');
      await explorerDb.collection('scannedheight').updateOne(
        {},
        { $set: { generalScannedHeight: height } },
        { upsert: true },
      );
    },

    async seedGeolocation(ip) {
      const localDb = await db('local');
      await localDb.collection('geolocation').updateOne(
        { _id: 'nodeGeolocation' },
        {
          $set: {
            geolocation: {
              ip,
              continent: 'Europe',
              continentCode: 'EU',
              country: 'Germany',
              countryCode: 'DE',
              region: 'HE',
              regionName: 'Hesse',
              lat: 50.1109,
              lon: 8.6821,
              org: 'Test Network',
              static: true,
              dataCenter: true,
            },
            staticIp: true,
            dataCenter: true,
            lastIpChangeDate: null,
            updatedAt: Date.now(),
          },
        },
        { upsert: true },
      );
    },

    async seedAppHash(hash, height, resolved = false) {
      const explorerDb = await db('explorer');
      await explorerDb.collection('zelappshashes').insertOne({
        hash,
        height,
        txid: hash,
        value: 200000000,
        message: resolved,
        messageNotFound: false,
        createdAt: new Date(),
      });
    },

    async markHashUnresolved(hash) {
      const explorerDb = await db('explorer');
      await explorerDb.collection('zelappshashes').updateOne(
        { hash },
        { $set: { message: false, messageNotFound: false } },
      );
    },

    async deletePermanentMessage(hash) {
      const explorerDb = await db('explorer');
      await explorerDb.collection('zelappsmessages').deleteOne({ hash });
    },

    async deleteAppHash(hash) {
      const explorerDb = await db('explorer');
      await explorerDb.collection('zelappshashes').deleteOne({ hash });
    },

    async deleteAppSpec(name) {
      const explorerDb = await db('explorer');
      await explorerDb.collection('zelappsinformation').deleteOne({ name });
    },

    async writeHeartbeat({ lastAlive, shutdownReason, machineBootId }) {
      const localDb = await db('local');
      const update = { lastAlive };
      if (shutdownReason !== undefined) update.shutdownReason = shutdownReason;
      if (machineBootId !== undefined) update.machineBootId = machineBootId;
      await localDb.collection('nodestartuptracker').updateOne(
        { _id: 'heartbeat' },
        { $set: update },
        { upsert: true },
      );
    },

    async seedGlobalAppSpec(spec) {
      const globalDb = await db('appsGlobal');
      await globalDb.collection('zelappsinformation').insertOne(spec);
    },

    async seedPermanentMessage(msg) {
      const globalDb = await db('appsGlobal');
      await globalDb.collection('zelappsmessages').insertOne(msg);
    },

    async seedAppLocation({ name, ip, hash, broadcastedAt, runningSince }) {
      const globalDb = await db('appsGlobal');
      const ts = broadcastedAt ?? Date.now();
      await globalDb.collection('zelappslocation').insertOne({
        name,
        ip,
        hash,
        broadcastedAt: new Date(ts),
        expireAt: new Date(ts + 125 * 60 * 1000),
        runningSince: runningSince ?? ts,
      });
    },

    async seedAppStateEvent(event) {
      const globalDb = await db('appsGlobal');
      await globalDb.collection('appstateevents').insertOne(event);
    },

    async seedLocalApp(spec) {
      const localDb = await db('appsLocal');
      await localDb.collection('zelappsinformation').insertOne(spec);
    },

    async seedInstallingLocation({ name, ip, broadcastedAt }) {
      const globalDb = await db('appsGlobal');
      const ts = broadcastedAt ?? Date.now();
      await globalDb.collection('appsinstallinglocations').insertOne({
        name,
        ip,
        broadcastedAt: new Date(ts),
        expireAt: new Date(ts + 15 * 60 * 1000),
      });
    },

    async seedInstallingError({ name, hash, ip, error, broadcastedAt }) {
      const globalDb = await db('appsGlobal');
      const ts = broadcastedAt ?? Date.now();
      await globalDb.collection('appsInstallingErrorsLocations').insertOne({
        name,
        hash,
        ip,
        error,
        broadcastedAt: new Date(ts),
        expireAt: new Date(ts + 24 * 60 * 60 * 1000),
      });
    },

    async dropAndReseed(ip, height) {
      const client = await getClient();
      for (const name of Object.values(dbNames)) {
        await client.db(name).dropDatabase();
      }
      await this.seedScannedHeight(height);
      await this.seedGeolocation(ip);
    },
  };
}
