const { EventEmitter } = require('events');
const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const { ObjectId, Collection } = require('mongodb');
const proxyquire = require('proxyquire');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const appMessageChain = require('../../ZelBack/src/services/utils/appMessageChain');
// eslint-disable-next-line no-unused-vars
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const globalState = require('../../ZelBack/src/services/utils/globalState');
const localRemovalQueue = require('../../ZelBack/src/services/appLifecycle/localRemovalQueue');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('../../ZelBack/src/services/utils/appSyncEvents');
const { peerManager } = require('../../ZelBack/src/services/utils/peerState');
const { requireMongo } = require('./dbTestHelper');

describe('registryManager tests', () => {
  before(requireMongo);

  let db;
  let database;

  beforeEach(async () => {
    await dbHelper.initiateDB();
    db = dbHelper.databaseConnection();
    database = db.db(config.database.appsglobal.database);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getPreviousAppSpecifications tests', () => {
    // The messages the stubbed log returns, under the name rule with no payment facts.
    beforeEach(() => {
      sinon.stub(dbHelper, 'appMessagesThatCount').callsFake(async (daemonDb, messages) => appMessageChain.messagesThatCount(messages));
    });

    it('should return null if no previous message found', async () => {
      const specifications = { name: 'NewApp' };
      const verificationTimestamp = Date.now();

      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);

      const result = await registryManager.getPreviousAppSpecifications(specifications, verificationTimestamp);
      expect(result).to.be.null;
    });

    // dragonwilds1790467903997: an extension signed at 00:52 was paid for at height 3003381,
    // after an update signed at 01:01 had confirmed at 3003310. The spec in force is the one
    // at 3003381, and every node must pick it whatever order Mongo returns the messages in.
    const specLabelled = (description) => ({
      version: 1,
      name: 'OutOfOrderApp',
      description,
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      repotag: 'test/image:latest',
      port: 30001,
      containerPort: 7396,
      enviromentParameters: [],
      commands: [],
      containerData: '/data',
      cpu: 0.5,
      ram: 500,
      hdd: 5,
      tiered: false,
    });
    const outOfOrderMessages = [
      {
        type: 'fluxappregister', height: 100, timestamp: 1000, appSpecifications: specLabelled('registration'),
      },
      {
        type: 'fluxappupdate', height: 300, timestamp: 3000, appSpecifications: specLabelled('signed last, confirmed first'),
      },
      {
        type: 'fluxappupdate', height: 371, timestamp: 2500, appSpecifications: specLabelled('signed first, confirmed last'),
      },
    ];

    [
      ['insertion order', outOfOrderMessages],
      ['reverse order', [...outOfOrderMessages].reverse()],
      ['shuffled order', [outOfOrderMessages[2], outOfOrderMessages[0], outOfOrderMessages[1]]],
    ].forEach(([label, messages]) => {
      it(`should pick the newest message on chain, not the newest signed (${label})`, async () => {
        sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
        sinon.stub(dbHelper, 'findInDatabase').resolves(messages);

        // a live submission builds on the newest message on chain
        const result = await registryManager.getPreviousAppSpecifications({ name: 'OutOfOrderApp' });
        expect(result.description).to.equal('signed first, confirmed last');
      });
    });

    it('should check a message on chain against the one right below its block', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      sinon.stub(dbHelper, 'findInDatabase').resolves(outOfOrderMessages);

      // the renewal at 371 was below nothing but the 01:01 update at 300, whatever it was signed after
      const atRenewal = await registryManager.getPreviousAppSpecifications({ name: 'OutOfOrderApp' }, 371);
      expect(atRenewal.description).to.equal('signed last, confirmed first');
      // re-checking the 300 update later must not see the renewal that confirmed after it
      const atUpdate = await registryManager.getPreviousAppSpecifications({ name: 'OutOfOrderApp' }, 300);
      expect(atUpdate.description).to.equal('registration');
      expect(await registryManager.getPreviousAppSpecifications({ name: 'OutOfOrderApp' }, 100)).to.equal(null);
    });

    it('should see a registration paid in the same block as the update being checked', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      sinon.stub(dbHelper, 'findInDatabase').resolves([
        { type: 'fluxappregister', height: 500, timestamp: 10, appSpecifications: specLabelled('registration') },
        { type: 'fluxappupdate', height: 500, timestamp: 20, appSpecifications: specLabelled('update') },
      ]);

      const previous = await registryManager.getPreviousAppSpecifications({ name: 'OutOfOrderApp' }, 500, 20);
      expect(previous.description).to.equal('registration');
      // without its timestamp the whole block is left out
      expect(await registryManager.getPreviousAppSpecifications({ name: 'OutOfOrderApp' }, 500)).to.equal(null);
    });

    it('should check the holder\'s update against the holder\'s spec, past another owner\'s registration of the held name', async () => {
      const alice = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
      const mallory = '1Q9sjqQcR2jSFt8pdaF7fhv9ozqD4qLnHu';
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      sinon.stub(dbHelper, 'findInDatabase').resolves([
        { type: 'fluxappregister', height: 100, timestamp: 1000, appSpecifications: { ...specLabelled('alice registers'), owner: alice } },
        { type: 'fluxappregister', height: 200, timestamp: 2000, appSpecifications: { ...specLabelled('mallory registers'), owner: mallory } },
      ]);

      const previous = await registryManager.getPreviousAppSpecifications({ name: 'OutOfOrderApp' }, 300, 3000);
      expect(previous.owner).to.equal(alice);
    });

    it('should not let a backdated update be checked against the spec before a transfer', async () => {
      const alice = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
      const bob = '1Q9sjqQcR2jSFt8pdaF7fhv9ozqD4qLnHu';
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({}) });
      sinon.stub(dbHelper, 'findInDatabase').resolves([
        { type: 'fluxappregister', height: 100, timestamp: 1000, appSpecifications: { ...specLabelled('alice'), owner: alice } },
        { type: 'fluxappupdate', height: 200, timestamp: 2000, appSpecifications: { ...specLabelled('transfer'), owner: bob } },
      ]);

      // nothing about a signer-chosen timestamp can reach back past the transfer
      const previous = await registryManager.getPreviousAppSpecifications({ name: 'OutOfOrderApp' });
      expect(previous.owner).to.equal(bob);
    });
  });

  describe('getApplicationOwner tests', () => {
    beforeEach(async () => {
      const collection = config.database.appsglobal.collections.appsInformation;
      const insertApp = {
        _id: new ObjectId('6147045cd774409b374d253d'),
        name: 'TestApp',
        description: 'Test application',
        owner: '196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH',
      };

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertOneToDatabase(database, collection, insertApp);
    });

    it('should return application owner if app exists in database', async () => {
      const appOwner = '196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH';
      const getOwnerResult = await registryManager.getApplicationOwner('TestApp');

      expect(getOwnerResult).to.equal(appOwner);
    });

    it('should return null if the app does not exist', async () => {
      const getOwnerResult = await registryManager.getApplicationOwner('NonExistentApp');

      expect(getOwnerResult).to.be.null;
    });

    it('should be case insensitive', async () => {
      const appOwner = '196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH';
      const getOwnerResult = await registryManager.getApplicationOwner('testapp');

      expect(getOwnerResult).to.equal(appOwner);
    });
  });

  describe('an app name given as a pattern', () => {
    const owner = '196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH';
    const collection = config.database.appsglobal.collections.appsInformation;

    beforeEach(async () => {
      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertOneToDatabase(database, collection, { name: 'VictimApp', owner, version: 3 });
      await dbHelper.insertOneToDatabase(database, collection, { name: 'Fluxvictim', owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', version: 3 });
    });

    it('is a name, not a pattern, to getApplicationSpecifications', async () => {
      expect(await registryManager.getApplicationSpecifications('VictimApp$|_MyOwnApp')).to.equal(undefined);
      expect(await registryManager.getApplicationSpecifications('.*')).to.equal(undefined);
    });

    it('is a name, not a pattern, to getApplicationOwner', async () => {
      expect(await registryManager.getApplicationOwner('VictimApp$|_MyOwnApp')).to.equal(null);
      expect(await registryManager.getApplicationOwner('.*')).to.equal(null);
    });

    it('does not resolve a legacy container identifier to the owner of a case variant of it', async () => {
      expect(await registryManager.getApplicationOwner('fluxvictim')).to.equal(null);
      expect(await registryManager.getApplicationOwner('Fluxvictim')).to.equal('1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC');
      // not a container identifier: no docker name is built from it as it is
      expect(await registryManager.getApplicationOwner('FLUXVICTIM')).to.equal('1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC');
    });
  });

  describe('availableApps tests', () => {
    it('answers a public listing without an enterprise app\'s compose and contacts', async () => {
      const collection = config.database.appsglobal.collections.appsInformation;
      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertOneToDatabase(database, collection, {
        name: 'EntListed', version: 8, enterprise: 'blob', compose: [{ name: 'web' }], contacts: ['a@b.c'], owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      });
      const res = { json: sinon.fake((param) => param) };

      await registryManager.availableApps(null, res);

      const listed = res.json.firstCall.args[0].data.find((app) => app.name === 'EntListed');
      expect(listed.compose).to.eql([]);
      expect(listed.contacts).to.eql([]);
      expect(listed.enterprise).to.equal('blob');
    });
  });

  describe('getAppHashes tests', () => {
    it('should return app hashes without requiring parameters', async () => {
      const res = {
        json: sinon.fake((param) => param),
      };

      const result = await registryManager.getAppHashes(undefined, res);

      sinon.assert.calledOnce(res.json);
      expect(result.status).to.equal('success');
      expect(result.data).to.be.an('array');
    });

    it('should handle errors gracefully', async () => {
      const res = {
        json: sinon.fake((param) => param),
      };

      sinon.stub(dbHelper, 'databaseConnection').throws(new Error('Database error'));

      const result = await registryManager.getAppHashes(undefined, res);

      expect(result.status).to.equal('error');
      expect(result.data.message).to.include('Database error');
    });
  });

  describe('getRegistryStatus tests', () => {
    const infoCollection = config.database.appsglobal.collections.appsInformation;
    const hashesCollection = config.database.daemon.collections.appsHashes;
    const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
    let daemonDatabase;
    let syncStateBefore;

    const hashRecord = (i, message) => ({
      txid: `tx${i}`, height: 1000 + i, hash: `hash${i}`, value: 100000000, message,
    });

    beforeEach(async () => {
      daemonDatabase = db.db(config.database.daemon.database);
      await database.collection(infoCollection).deleteMany({});
      await daemonDatabase.collection(hashesCollection).deleteMany({});
      await daemonDatabase.collection(scannedHeightCollection).deleteMany({});
      syncStateBefore = globalState.appSyncState;
    });

    afterEach(async () => {
      globalState.appSyncState = syncStateBefore;
      await database.collection(infoCollection).deleteMany({});
      await daemonDatabase.collection(hashesCollection).deleteMany({});
      await daemonDatabase.collection(scannedHeightCollection).deleteMany({});
    });

    it('reports the sync state and counts the registry, the recorded transactions and those without a message', async () => {
      await database.collection(infoCollection).insertMany([
        { name: 'AppOne', owner: 'o1' }, { name: 'AppTwo', owner: 'o2' }, { name: 'AppThree', owner: 'o3' },
      ]);
      await daemonDatabase.collection(hashesCollection).insertMany([
        hashRecord(1, true), hashRecord(2, true), hashRecord(3, false), hashRecord(4, true), hashRecord(5, false),
      ]);
      await daemonDatabase.collection(scannedHeightCollection).insertOne({ generalScannedHeight: 2983500 });
      globalState.appSyncState = 'READY';
      const res = { json: sinon.fake((param) => param) };

      const result = await registryManager.getRegistryStatus(undefined, res);

      sinon.assert.calledOnce(res.json);
      expect(result).to.deep.equal({
        status: 'success',
        data: {
          syncState: 'READY', scannedHeight: 2983500, apps: 3, transactions: 5, missingMessages: 2, messagesNotFound: 0,
        },
      });
    });

    it('answers in every sync state, saying which', async () => {
      await daemonDatabase.collection(hashesCollection).insertMany([hashRecord(1, false), hashRecord(2, false)]);

      // eslint-disable-next-line no-restricted-syntax
      for (const syncState of ['INITIALIZING', 'SYNCING', 'DEGRADED', 'RESYNCING']) {
        globalState.appSyncState = syncState;

        // eslint-disable-next-line no-await-in-loop
        const result = await registryManager.getRegistryStatus(undefined, undefined);

        expect(result).to.deep.equal({
          status: 'success',
          data: {
            syncState, scannedHeight: null, apps: 0, transactions: 2, missingMessages: 2, messagesNotFound: 0,
          },
        });
      }
    });

    it('does not count a record whose message is unknown rather than missing', async () => {
      await daemonDatabase.collection(hashesCollection).insertMany([
        hashRecord(1, true), { txid: 'tx2', height: 1002, hash: 'hash2', value: 100000000 },
      ]);

      const result = await registryManager.getRegistryStatus(undefined, undefined);

      expect(result.data.transactions).to.equal(2);
      expect(result.data.missingMessages).to.equal(0);
    });

    it('counts a missing message the node stopped looking for in both missing counts', async () => {
      await daemonDatabase.collection(hashesCollection).insertMany([
        { ...hashRecord(1, false), messageNotFound: true },
        { ...hashRecord(2, false), messageNotFound: false },
        hashRecord(3, false),
        { ...hashRecord(4, true), messageNotFound: true },
      ]);

      const result = await registryManager.getRegistryStatus(undefined, undefined);

      expect(result.data.missingMessages).to.equal(3);
      expect(result.data.messagesNotFound).to.equal(1);
    });

    it('counts both totals from the _id index rather than reading every document', async () => {
      const count = sinon.spy(dbHelper, 'countInDatabase');

      await registryManager.getRegistryStatus(undefined, undefined);

      const totals = count.getCalls().filter((call) => Object.keys(call.args[2]).length === 0);
      expect(totals.map((call) => call.args[1])).to.have.members([infoCollection, hashesCollection]);
      totals.forEach((call) => expect(call.args[3]).to.deep.equal({ hint: { _id: 1 } }));
    });

    it('reports a database failure as an error, not as counts', async () => {
      sinon.stub(dbHelper, 'databaseConnection').throws(new Error('Database error'));
      const res = { json: sinon.fake((param) => param) };

      const result = await registryManager.getRegistryStatus(undefined, res);

      expect(result.status).to.equal('error');
      expect(result.data.message).to.include('Database error');
    });
  });

  describe('appLocation tests', () => {
    beforeEach(async () => {
      const collection = config.database.appsglobal.collections.appsLocations;
      const testLocation = {
        name: 'TestApp',
        hash: 'testhash123',
        ip: '192.168.1.1:16127',
        broadcastedAt: new Date(),
        expireAt: new Date(Date.now() + 3600000),
      };

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertOneToDatabase(database, collection, testLocation);
    });

    it('should return app location for specific app', async () => {
      const result = await registryManager.appLocation('TestApp');

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].name).to.equal('TestApp');
      expect(result[0].ip).to.equal('192.168.1.1:16127');
    });

    it('should return all locations when no appname provided', async () => {
      const result = await registryManager.appLocation();

      expect(result).to.be.an('array');
    });

    it('should be case insensitive', async () => {
      const result = await registryManager.appLocation('testapp');

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
    });
  });

  describe('signedHoldersOf', () => {
    const events = config.database.appsglobal.collections.appStateEvents;
    const AT = 1700000000000;
    const LIFE = 7500 * 1000;
    const running = (key, ip, at, apps = ['TestApp']) => ({
      ip, type: 'apprunning', dedupKey: 'v2', broadcastedAt: new Date(at), expireAt: new Date(at + LIFE),
      data: { ip, broadcastedAt: at, apps: apps.map((name) => ({ name, hash: 'h' })) },
      envelope: { pubKey: key },
    });
    const holderKeys = async () => (await registryManager.signedHoldersOf('TestApp', AT)).map((holder) => holder.key).sort();

    beforeEach(async () => {
      try {
        await database.collection(events).drop();
      } catch (err) {
        // Collection doesn't exist
      }
    });

    it('counts each key whose standing announcement names the app', async () => {
      await database.collection(events).insertMany([
        running('key-a', '1.1.1.1:16127', AT - 1000),
        running('key-b', '2.2.2.2:16127', AT - 1000),
        running('key-c', '3.3.3.3:16127', AT - 1000, ['OtherApp']),
      ]);

      expect(await holderKeys()).to.eql(['key-a', 'key-b']);
    });

    it('ignores an eviction, which no holder signed', async () => {
      await database.collection(events).insertMany([
        running('key-a', '1.1.1.1:16127', AT - 1000),
        {
          ip: '1.1.1.1:16127', type: 'evicted', dedupKey: 'evicted', createdAt: new Date(AT - 500), expireAt: new Date(AT + LIFE),
        },
      ]);

      expect(await holderKeys()).to.eql(['key-a']);
    });

    it('counts a key once across an address move, by its newest announcement', async () => {
      await database.collection(events).insertMany([
        running('key-a', '1.1.1.1:16127', AT - 5000),
        running('key-a', '1.1.1.1:16137', AT - 1000),
      ]);

      const holders = await registryManager.signedHoldersOf('TestApp', AT);

      expect(holders.map((holder) => [holder.key, holder.ip])).to.eql([['key-a', '1.1.1.1:16137']]);
    });

    it('drops a key whose newest announcement no longer names the app', async () => {
      await database.collection(events).insertMany([
        running('key-a', '1.1.1.1:16127', AT - 5000),
        running('key-a', '1.1.1.1:16137', AT - 1000, ['OtherApp']),
      ]);

      expect(await holderKeys()).to.eql([]);
    });

    it('drops a key that signed a removal of the app or a SIGTERM since its announcement', async () => {
      await database.collection(events).insertMany([
        running('key-a', '1.1.1.1:16127', AT - 5000),
        running('key-b', '2.2.2.2:16127', AT - 5000),
        running('key-c', '3.3.3.3:16127', AT - 5000),
        {
          ip: '1.1.1.1:16127', type: 'appremoved', dedupKey: 'appremoved:TestApp', broadcastedAt: new Date(AT - 1000), expireAt: new Date(AT + LIFE), data: { appName: 'TestApp' }, envelope: { pubKey: 'key-a' },
        },
        {
          ip: '2.2.2.2:16127', type: 'sigterm', dedupKey: 'sigterm', broadcastedAt: new Date(AT - 1000), expireAt: new Date(AT + LIFE), data: {}, envelope: { pubKey: 'key-b' },
        },
        {
          ip: '3.3.3.3:16127', type: 'appremoved', dedupKey: 'appremoved:TestApp', broadcastedAt: new Date(AT - 9000), expireAt: new Date(AT + LIFE), data: { appName: 'TestApp' }, envelope: { pubKey: 'key-c' },
        },
      ]);

      expect(await holderKeys()).to.eql(['key-c']);
    });

    it('counts only records standing at the instant judged', async () => {
      await database.collection(events).insertMany([
        running('key-a', '1.1.1.1:16127', AT - LIFE),
        running('key-b', '2.2.2.2:16127', AT - LIFE + 1),
      ]);

      expect(await holderKeys()).to.eql(['key-b']);
    });
  });

  describe('appsListedAt', () => {
    const locations = config.database.appsglobal.collections.appsLocations;
    const runs = (name, ip) => database.collection(locations).insertOne({
      name, hash: 'h', ip, broadcastedAt: new Date(), expireAt: new Date(Date.now() + 3600000),
    });

    beforeEach(async () => {
      await database.collection(locations).deleteMany({});
    });

    it('names each app listed at the address, once', async () => {
      await runs('alpha', '198.51.100.1:16127');
      await runs('beta', '198.51.100.1:16127');
      await runs('otherport', '198.51.100.1:16157');
      await runs('othernode', '198.51.100.2:16127');

      expect((await registryManager.appsListedAt('198.51.100.1:16127')).sort()).to.deep.equal(['alpha', 'beta']);
    });

    it('names the apps at a non-default port by that port only', async () => {
      await runs('otherport', '198.51.100.1:16157');
      await runs('withport', '198.51.100.1:16127');

      expect(await registryManager.appsListedAt('198.51.100.1:16157')).to.deep.equal(['otherport']);
    });
  });

  describe('address move tests', () => {
    const events = config.database.appsglobal.collections.appStateEvents;
    const locations = config.database.appsglobal.collections.appsLocations;
    const HOUR = 60 * 60 * 1000;
    const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);

    const moved = (from, to, at, expireAt = new Date(Date.now() + HOUR)) => database.collection(events).insertOne({
      ip: from, type: 'ipchanged', dedupKey: 'ipchanged', broadcastedAt: at, expireAt, data: { type: 'fluxipchanged', version: 1, oldIP: from, newIP: to, broadcastedAt: at.getTime() },
    });
    const runs = (name, ip, broadcastedAt) => database.collection(locations).insertOne({
      name, hash: 'h', ip, broadcastedAt, expireAt: new Date(Date.now() + HOUR),
    });

    beforeEach(async () => {
      await database.collection(events).deleteMany({});
      await database.collection(locations).deleteMany({});
    });

    describe('currentAddressesOf', () => {
      const currentAddressOf = async (ip, at) => (await registryManager.currentAddressesOf([{ ip, at: at.getTime() }]))[0];

      it('follows a move made after the saying to the new address', async () => {
        await moved('72.89.45.236:16137', '108.6.236.4:16137', minutesAgo(5));

        expect(await currentAddressOf('72.89.45.236:16137', minutesAgo(10))).to.equal('108.6.236.4:16137');
      });

      it('follows a chain of moves, each newer than the last', async () => {
        await moved('10.0.0.1:16127', '10.0.0.2:16127', minutesAgo(30));
        await moved('10.0.0.2:16127', '10.0.0.3:16127', minutesAgo(10));

        expect(await currentAddressOf('10.0.0.1:16127', minutesAgo(40))).to.equal('10.0.0.3:16127');
      });

      it('ends a node that moved away and back at the address it holds now', async () => {
        await moved('10.0.0.1:16127', '10.0.0.2:16127', minutesAgo(30));
        await moved('10.0.0.2:16127', '10.0.0.1:16127', minutesAgo(10));

        expect(await currentAddressOf('10.0.0.1:16127', minutesAgo(40))).to.equal('10.0.0.1:16127');
      });

      it('does not follow a move made before the saying: the address was another node\'s by then', async () => {
        await moved('10.0.0.1:16127', '10.0.0.2:16127', minutesAgo(30));

        expect(await currentAddressOf('10.0.0.1:16127', minutesAgo(20))).to.equal('10.0.0.1:16127');
      });

      it('ignores a move that is not version 1, one to the same address, and one whose new address is not an address', async () => {
        await database.collection(events).insertMany([
          {
            ip: '10.0.0.1:16127', type: 'ipchanged', broadcastedAt: minutesAgo(5), expireAt: new Date(Date.now() + HOUR), data: { version: 2, newIP: '10.0.0.2:16127' },
          },
          {
            ip: '10.0.0.3:16127', type: 'ipchanged', broadcastedAt: minutesAgo(5), expireAt: new Date(Date.now() + HOUR), data: { version: 1, newIP: '10.0.0.3' },
          },
          {
            ip: '10.0.0.4:16127', type: 'ipchanged', broadcastedAt: minutesAgo(5), expireAt: new Date(Date.now() + HOUR), data: { version: 1, newIP: { ip: '10.0.0.5' } },
          },
        ]);

        expect([...(await registryManager.addressMovesFrom(['10.0.0.1:16127', '10.0.0.3:16127', '10.0.0.4:16127'])).keys()]).to.deep.equal([]);
      });

      it('ignores an expired move', async () => {
        await moved('10.0.0.1:16127', '10.0.0.2:16127', minutesAgo(200), minutesAgo(1));

        expect(await currentAddressOf('10.0.0.1:16127', minutesAgo(210))).to.equal('10.0.0.1:16127');
      });

      it('follows a move of the port alone, on the same IP', async () => {
        await moved('198.51.100.40:16127', '198.51.100.40:16157', minutesAgo(5));

        expect(await currentAddressOf('198.51.100.40:16127', minutesAgo(10))).to.equal('198.51.100.40:16157');
      });

      it('reads a bare address as the default port', async () => {
        await moved('10.0.0.1:16127', '10.0.0.2:16127', minutesAgo(5));

        expect(await currentAddressOf('10.0.0.1', minutesAgo(10))).to.equal('10.0.0.2:16127');
      });
    });

    describe('addressesMovedFromIp', () => {
      it('gives the addresses at the IP a move leaves, and none at an IP it only begins', async () => {
        await moved('72.89.45.23:16137', '108.6.236.4:16137', minutesAgo(5));
        await moved('72.89.45.23:16127', '108.6.236.5:16127', minutesAgo(5));
        await moved('72.89.45.236:16127', '108.6.236.6:16127', minutesAgo(5));

        expect((await registryManager.addressesMovedFromIp('72.89.45.23')).sort()).to.deep.equal(['72.89.45.23:16127', '72.89.45.23:16137']);
      });
    });

    describe('addressMovesTo', () => {
      it('gives the moves to an address, with who signed each and when it was made', async () => {
        const at = minutesAgo(5);
        await database.collection(events).insertOne({
          ip: '10.0.0.1:16127', type: 'ipchanged', dedupKey: 'ipchanged', broadcastedAt: at, expireAt: new Date(Date.now() + HOUR), data: { version: 1, newIP: '10.0.0.9:16127' }, envelope: { pubKey: '04signer' },
        });
        await moved('10.0.0.2:16127', '10.0.0.8:16127', at);

        const moves = await registryManager.addressMovesTo('10.0.0.9');
        expect([...moves.keys()]).to.deep.equal(['10.0.0.1:16127']);
        expect(moves.get('10.0.0.1:16127')).to.deep.equal({ to: '10.0.0.9:16127', signer: '04signer', at: at.getTime() });
      });
    });

    describe('primaryAddressOf', () => {
      it('gives the port of the app\'s location at the IP FDM names', async () => {
        await runs('primaryapp', '72.89.45.236:16137', minutesAgo(5));

        expect(await registryManager.primaryAddressOf('primaryapp', '72.89.45.236')).to.equal('72.89.45.236:16137');
      });

      it('finds the node at the address its move carried its location to, from the IP it left', async () => {
        await moved('72.89.45.236:16137', '108.6.236.4:16137', minutesAgo(5));
        await runs('primaryapp', '108.6.236.4:16137', minutesAgo(10));

        expect(await registryManager.primaryAddressOf('primaryapp', '72.89.45.236')).to.equal('108.6.236.4:16137');
      });

      it('gives the new port of a node whose port alone moved', async () => {
        await moved('198.51.100.40:16127', '198.51.100.40:16157', minutesAgo(5));
        await runs('primaryapp', '198.51.100.40:16157', minutesAgo(10));

        expect(await registryManager.primaryAddressOf('primaryapp', '198.51.100.40')).to.equal('198.51.100.40:16157');
      });

      it('takes no move from an IP that only begins with the one FDM names', async () => {
        await moved('72.89.45.236:16137', '108.6.236.4:16137', minutesAgo(5));
        await runs('primaryapp', '108.6.236.4:16137', minutesAgo(10));

        expect(await registryManager.primaryAddressOf('primaryapp', '72.89.45.23')).to.equal('72.89.45.23');
      });

      it('keeps a location announced after a move away from that address', async () => {
        await moved('72.89.45.236:16137', '108.6.236.4:16137', minutesAgo(30));
        await runs('primaryapp', '72.89.45.236:16137', minutesAgo(5));

        expect(await registryManager.primaryAddressOf('primaryapp', '72.89.45.236')).to.equal('72.89.45.236:16137');
      });

      it('finds the node behind a shared IP that moved with its siblings, by the one that holds the app', async () => {
        await runs('primaryapp', '108.6.236.4:16137', minutesAgo(1));
        await runs('otherapp', '108.6.236.4:16127', minutesAgo(1));
        await moved('72.89.45.236:16127', '108.6.236.4:16127', minutesAgo(3));
        await moved('72.89.45.236:16137', '108.6.236.4:16137', minutesAgo(3));
        await moved('72.89.45.236:16147', '108.6.236.4:16147', minutesAgo(3));

        expect(await registryManager.primaryAddressOf('primaryapp', '72.89.45.236')).to.equal('108.6.236.4:16137');
      });

      it('leaves the IP unresolved when moves from it reach more than one holder', async () => {
        await runs('primaryapp', '108.6.236.4:16137', minutesAgo(1));
        await runs('primaryapp', '96.1.1.1:16127', minutesAgo(1));
        await moved('72.89.45.236:16137', '108.6.236.4:16137', minutesAgo(3));
        await moved('72.89.45.236:16127', '96.1.1.1:16127', minutesAgo(3));

        expect(await registryManager.primaryAddressOf('primaryapp', '72.89.45.236')).to.equal('72.89.45.236');
      });

      it('leaves the IP unresolved when no location and no move accounts for it', async () => {
        await runs('primaryapp', '96.1.1.1:16127', minutesAgo(1));

        expect(await registryManager.primaryAddressOf('primaryapp', '72.89.45.236')).to.equal('72.89.45.236');
      });

      it('leaves the IP unresolved when two locations share it, whatever moved away from it', async () => {
        await runs('primaryapp', '72.89.45.236:16127', minutesAgo(1));
        await runs('primaryapp', '72.89.45.236:16137', minutesAgo(1));
        await runs('primaryapp', '108.6.236.4:16147', minutesAgo(1));
        await moved('72.89.45.236:16147', '108.6.236.4:16147', minutesAgo(3));

        expect(await registryManager.primaryAddressOf('primaryapp', '72.89.45.236')).to.equal('72.89.45.236');
      });
    });
  });

  describe('appInstallingLocation tests', () => {
    beforeEach(async () => {
      const collection = config.database.appsglobal.collections.appsInstallingLocations;
      const testLocation = {
        name: 'InstallingApp',
        ip: '192.168.1.2:16127',
        broadcastedAt: new Date(),
        expireAt: new Date(Date.now() + 300000),
      };

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertOneToDatabase(database, collection, testLocation);
    });

    it('should return installing location for specific app', async () => {
      const result = await registryManager.appInstallingLocation('InstallingApp');

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].name).to.equal('InstallingApp');
    });

    it('should return all installing locations when no appname provided', async () => {
      const result = await registryManager.appInstallingLocation();

      expect(result).to.be.an('array');
    });
  });

  describe('storeAppInstallingMessage tests', () => {
    const validMessage = {
      type: 'fluxappinstalling',
      version: 1,
      broadcastedAt: Date.now(),
      name: 'TestApp',
      ip: '192.168.1.1:16127',
    };

    it('should store a valid app installing message', async () => {
      const result = await registryManager.storeAppInstallingMessage(validMessage);

      expect(result).to.be.true;
    });

    it('should reject invalid message without required fields', async () => {
      const invalidMessage = {
        type: 'fluxappinstalling',
        version: 1,
      };

      try {
        await registryManager.storeAppInstallingMessage(invalidMessage);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid Flux App Installing message');
      }
    });

    it('should reject message with wrong type', async () => {
      const wrongTypeMessage = {
        ...validMessage,
        type: 123,
      };

      try {
        await registryManager.storeAppInstallingMessage(wrongTypeMessage);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid Flux App Installing message');
      }
    });

    it('should reject message with unsupported version', async () => {
      const wrongVersionMessage = {
        ...validMessage,
        version: 2,
      };

      try {
        await registryManager.storeAppInstallingMessage(wrongVersionMessage);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('version 2 not supported');
      }
    });

    it('should reject old messages past valid time', async () => {
      const oldMessage = {
        ...validMessage,
        broadcastedAt: Date.now() - (10 * 60 * 1000), // 10 minutes ago
      };

      const result = await registryManager.storeAppInstallingMessage(oldMessage);

      expect(result).to.be.false;
    });

    it('should not store duplicate message', async () => {
      await registryManager.storeAppInstallingMessage(validMessage);
      const result = await registryManager.storeAppInstallingMessage(validMessage);

      expect(result).to.be.false;
    });
  });

  describe('getApplicationSpecifications tests', () => {
    beforeEach(async () => {
      const collection = config.database.appsglobal.collections.appsInformation;
      const testApp = {
        name: 'SpecTestApp',
        version: 3,
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        repotag: 'test/app:latest',
        ports: [30001, 30002],
        containerPorts: [8080],
        cpu: 1,
        ram: 1000,
        hdd: 10,
        hash: 'testhash',
        height: 100,
      };

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertOneToDatabase(database, collection, testApp);
    });

    it('should return application specifications', async () => {
      const result = await registryManager.getApplicationSpecifications('SpecTestApp');

      expect(result).to.be.an('object');
      expect(result.name).to.equal('SpecTestApp');
      expect(result.version).to.equal(3);
      expect(result.owner).to.equal('1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC');
    });

    it('should return null for non-existent app', async () => {
      const result = await registryManager.getApplicationSpecifications('NonExistent');

      expect(result).to.be.undefined;
    });

    it('should be case insensitive', async () => {
      const result = await registryManager.getApplicationSpecifications('spectestapp');

      expect(result).to.be.an('object');
      expect(result.name).to.equal('SpecTestApp');
    });
  });

  describe('getApplicationSpecificationAPI tests', () => {
    beforeEach(() => {
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: {
          synced: true,
          height: 1000,
        },
      });
    });

    it('should return error if no app name provided', async () => {
      const req = { params: {}, query: {} };
      const res = {
        json: sinon.fake((param) => param),
      };

      await registryManager.getApplicationSpecificationAPI(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('error');
      expect(result.data.message).to.include('No Application Name specified');
    });

    it('should return error if daemon not synced', async () => {
      daemonServiceMiscRpcs.isDaemonSynced.returns({
        data: {
          synced: false,
          height: 0,
        },
      });

      const req = { params: { appname: 'TestApp' }, query: {} };
      const res = {
        json: sinon.fake((param) => param),
      };

      await registryManager.getApplicationSpecificationAPI(req, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('error');
      expect(result.data.message).to.include('Daemon not yet synced');
    });

    // Decryption is the owner's alone, so this asks for the one privilege that
    // admits nobody else - not the node operator, and not the flux team either.
    // calledOnceWithExactly pins the count as well as the string: a second check
    // beside this one is how a wider path gets re-admitted, and it would fail
    // here.
    it('gates a decrypted enterprise spec on the owner, and nobody else', async () => {
      const collection = config.database.appsglobal.collections.appsInformation;
      await dbHelper.insertOneToDatabase(database, collection, {
        name: 'EntSpecApp',
        version: 8,
        enterprise: 'encrypted-blob',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        compose: [],
        hash: 'entspechash',
        height: 100,
      });

      const req = {
        params: { appname: 'EntSpecApp', decrypt: 'true' },
        query: {},
        headers: { 'enterprise-key': 'session-key' },
      };
      const res = { json: sinon.fake((param) => param) };

      // Reaching the gate needs the spec to decrypt, and checkAndDecryptAppSpecs
      // refuses outright off Arcane. It and the formatter it feeds are the only
      // two substitutions; everything else is the real module.
      const verifyPrivilege = sinon.stub().resolves(false);
      const subject = proxyquire('../../ZelBack/src/services/appDatabase/registryManager', {
        '../utils/enterpriseHelper': { checkAndDecryptAppSpecs: async (spec) => spec },
        '../utils/appUtilities': { specificationFormatter: (spec) => spec },
        '../verificationHelper': { verifyPrivilege },
      });

      await subject.getApplicationSpecificationAPI(req, res);

      sinon.assert.calledOnceWithExactly(verifyPrivilege, Privilege.APP_OWNER, authOf(req), { appName: 'EntSpecApp' });
    });
  });

  describe('the app a spec request is authorised against', () => {
    // Authorised against the app the lookup returned, not against a name cut out
    // of the request: an owner of one app must not be able to read another's by
    // spelling a name the two lookups read differently.
    it('asks about the name of the spec it found, whatever spelling the request used', async () => {
      const collection = config.database.appsglobal.collections.appsInformation;
      await dbHelper.insertOneToDatabase(database, collection, {
        name: 'EntSpecOwnerApp',
        version: 8,
        enterprise: 'encrypted-blob',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        compose: [],
        hash: 'entspecownerhash',
        height: 100,
      });
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 1000 } });
      const verifyPrivilege = sinon.stub().resolves(false);
      const subject = proxyquire('../../ZelBack/src/services/appDatabase/registryManager', {
        '../utils/enterpriseHelper': { checkAndDecryptAppSpecs: async (spec) => spec },
        '../utils/appUtilities': { specificationFormatter: (spec) => spec },
        '../verificationHelper': { verifyPrivilege },
      });
      const req = {
        params: { appname: 'entspecownerapp', decrypt: 'true' },
        query: {},
        headers: { 'enterprise-key': 'session-key' },
      };

      await subject.getApplicationSpecificationAPI(req, { json: sinon.fake() });

      sinon.assert.calledOnceWithExactly(verifyPrivilege, Privilege.APP_OWNER, authOf(req), { appName: 'EntSpecOwnerApp' });
    });

    it('finds nothing for a name that is an alternation of two apps', async () => {
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 1000 } });
      const res = { json: sinon.fake((param) => param) };

      await registryManager.getApplicationSpecificationAPI({ params: { appname: 'SpecTestApp|Other_Mine' }, query: {} }, res);

      expect(res.json.firstCall.args[0].status).to.equal('error');
    });
  });

  describe('getApplicationComponentNamesAPI tests', () => {
    const composedApp = {
      name: 'NamesApp',
      version: 8,
      enterprise: 'encrypted-blob',
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      hash: 'nameshash',
      height: 100,
      compose: [
        {
          name: 'palworld', containerData: 'g:/palworld/Pal/Saved', cpu: 4, ram: 16000, hdd: 50,
          repotag: 'private/palworld:1', repoauth: 'secret-token',
          environmentParameters: ['ADMIN_PASSWORD=hunter2'], secrets: 'sealed', commands: ['--token', 'abc'],
          ports: [30001], domains: ['pal.example.invalid'],
        },
        {
          name: 'sidecar', containerData: '/data', cpu: 1, ram: 2000, hdd: 5,
          repotag: 'private/sidecar:1', repoauth: '', environmentParameters: [],
        },
        {
          // A sync flag counts only on the primary mount, so this component is
          // not election managed and the election does not treat it as one. It
          // reads as one to a substring search, which is what separates the
          // classifier from a search. Its invalid second mount is rejected by
          // the parser, which logs - that rejection IS the answer.
          name: 'misplaced', containerData: '/data|g:/db', cpu: 2, ram: 1000, hdd: 5,
          repotag: 'private/misplaced:1', repoauth: '', environmentParameters: [],
        },
      ],
    };

    function subjectWithPrivilege(verifyPrivilege) {
      return proxyquire('../../ZelBack/src/services/appDatabase/registryManager', {
        '../utils/enterpriseHelper': { checkAndDecryptAppSpecs: async (spec) => spec },
        '../utils/appUtilities': { specificationFormatter: (spec) => spec },
        '../verificationHelper': { verifyPrivilege },
      });
    }

    beforeEach(async () => {
      const collection = config.database.appsglobal.collections.appsInformation;

      await dbHelper.insertOneToDatabase(database, collection, composedApp);
    });

    // fluxteam, not appownerorfluxteam: the owner reads the specification itself,
    // and the node operator is not a party to a customer's app at all.
    it('is refused to anyone the flux-team privilege refuses', async () => {
      const verifyPrivilege = sinon.stub().resolves(false);
      const req = { params: { appname: 'NamesApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };

      await subjectWithPrivilege(verifyPrivilege).getApplicationComponentNamesAPI(req, res);

      sinon.assert.calledOnceWithExactly(verifyPrivilege, Privilege.FLUX_TEAM, authOf(req));
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('answers with component names and their election mode', async () => {
      const req = { params: { appname: 'NamesApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };

      await subjectWithPrivilege(sinon.stub().resolves(true))
        .getApplicationComponentNamesAPI(req, res);

      const { status, data } = res.json.firstCall.args[0];

      expect(status).to.equal('success');
      expect(data.components).to.deep.equal([
        { name: 'palworld', masterSlave: true },
        { name: 'sidecar', masterSlave: false },
        { name: 'misplaced', masterSlave: false },
      ]);
    });

    // Totals, which v9 keeps outside the sealed envelope precisely so a node can
    // read them without decrypting. Summed, not per-component.
    it('answers with the app total, not per-component sizing', async () => {
      const req = { params: { appname: 'NamesApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };

      await subjectWithPrivilege(sinon.stub().resolves(true))
        .getApplicationComponentNamesAPI(req, res);

      expect(res.json.firstCall.args[0].data.resources)
        .to.deep.equal({ cpu: 7, ram: 19000, hdd: 60 });
    });

    // The whole reason this endpoint exists rather than a redacted spec. Asserted
    // over the serialised response so a field nested anywhere in it still fails.
    it('carries nothing that could configure or impersonate the app', async () => {
      const req = { params: { appname: 'NamesApp' }, query: {} };
      const res = { json: sinon.fake((param) => param) };

      await subjectWithPrivilege(sinon.stub().resolves(true))
        .getApplicationComponentNamesAPI(req, res);

      const serialised = JSON.stringify(res.json.firstCall.args[0]);

      ['secret-token', 'ADMIN_PASSWORD', 'hunter2', 'sealed', 'private/palworld', 'pal.example.invalid', '30001']
        .forEach((withheld) => expect(serialised).to.not.contain(withheld));
      // and no key by which one could be reintroduced
      ['repoauth', 'environmentParameters', 'secrets', 'commands', 'repotag', 'domains', 'ports', 'containerData', 'compose']
        .forEach((key) => expect(serialised).to.not.contain(key));
    });
  });

  describe('updateApplicationSpecificationAPI tests', () => {
    // The response carries the whole spec encrypted to a session key the CALLER
    // supplies, and nothing is stripped from it, so it discloses more of a
    // customer's enterprise app than the decrypt endpoint above. Same privilege
    // for the same reason: the owner alone.
    it('gates a spec upgrade on the owner, and nobody else', async () => {
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true, height: 1000 },
      });
      const collection = config.database.appsglobal.collections.appsInformation;
      await dbHelper.insertOneToDatabase(database, collection, {
        name: 'UpgradeSpecApp',
        version: 3,
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        repotag: 'test/app:latest',
        hash: 'upgradespechash',
        height: 100,
      });

      const req = { params: { appname: 'UpgradeSpecApp' }, query: {}, headers: {} };
      const res = { json: sinon.fake((param) => param) };

      const verifyPrivilege = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);

      await registryManager.updateApplicationSpecificationAPI(req, res);

      sinon.assert.calledOnceWithExactly(verifyPrivilege, Privilege.APP_OWNER, authOf(req), { appName: 'UpgradeSpecApp' });
    });
  });

  describe('checkApplicationRegistrationNameConflicts tests', () => {
    beforeEach(async () => {
      const collection = config.database.appsglobal.collections.appsInformation;
      const existingApp = {
        name: 'ExistingApp',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        height: 100,
        expire: 22000,
      };

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertOneToDatabase(database, collection, existingApp);
    });

    it('should throw error if app name already exists', async () => {
      const appSpec = {
        name: 'ExistingApp',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      };

      try {
        await registryManager.checkApplicationRegistrationNameConflicts(appSpec);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('already registered');
      }
    });

    it('should allow registration if app name is unique', async () => {
      const appSpec = {
        name: 'UniqueAppName',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      };

      const result = await registryManager.checkApplicationRegistrationNameConflicts(appSpec);

      expect(result).to.be.true;
    });

    describe('a registration message whose hash is given', () => {
      const hashesCollection = config.database.daemon.collections.appsHashes;
      let daemonDatabase;

      const insertHash = (hash, height) => dbHelper.insertOneToDatabase(daemonDatabase, hashesCollection, {
        txid: `tx${hash}`, hash, height, value: 100000000, message: false,
      });

      const rejectionOf = async (hash) => {
        try {
          await registryManager.checkApplicationRegistrationNameConflicts({ name: 'ExistingApp' }, hash);
        } catch (error) {
          return error.message;
        }
        return expect.fail('Should have thrown an error');
      };

      beforeEach(async () => {
        daemonDatabase = db.db(config.database.daemon.database);
        try {
          await daemonDatabase.collection(hashesCollection).drop();
        } catch (err) {
          // Collection doesn't exist
        }
      });

      it('is refused as registered when its hash is not on chain', async () => {
        expect(await rejectionOf('unknownhash')).to.include('already registered').and.include('Hash not found in collection');
      });

      it('is refused as registered when it is older than the app on record', async () => {
        await insertHash('olderhash', 50); // the app on record is at height 100

        const message = await rejectionOf('olderhash');

        expect(message).to.include('already registered').and.include('Hash is older than our current app');
        expect(message).to.not.include('local application');
      });

      it('is refused as registered when it is newer and the app on record has not expired', async () => {
        await insertHash('newerhash', 150);

        expect(await rejectionOf('newerhash')).to.include('already registered').and.include('Hash is not older than our current app');
      });
    });

    it('should reject app named "share"', async () => {
      const appSpec = {
        name: 'share',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      };

      try {
        await registryManager.checkApplicationRegistrationNameConflicts(appSpec);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('already assigned to Flux main application');
      }
    });
  });

  describe('expireGlobalApplications tests', () => {
    // heights well past the PON fork, so expiry is plain height + expire
    const tip = 3008000;
    const { appsInformation } = config.database.appsglobal.collections;
    const owner = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
    let installed;
    let queueRemovalsStub;
    // every installed app the pass queued for removal
    const queued = () => queueRemovalsStub.args.flatMap(([names]) => names);

    beforeEach(async () => {
      const daemonDb = db.db(config.database.daemon.database);
      await daemonDb.collection(config.database.daemon.collections.scannedHeight).deleteMany({});
      await daemonDb.collection(config.database.daemon.collections.scannedHeight).insertOne({ generalScannedHeight: tip });
      await database.collection(appsInformation).deleteMany({});
      installed = [];
      // eslint-disable-next-line global-require
      sinon.stub(require('../../ZelBack/src/services/appQuery/appQueryService'), 'installedApps').callsFake(async () => ({ status: 'success', data: installed }));
      queueRemovalsStub = sinon.stub(localRemovalQueue, 'queueRemovals');
    });

    const spec = (name, hash, height, expire) => ({
      name, owner, version: 3, hash, height, expire,
    });

    it('should expire an app past its expiry and keep a live one', async () => {
      await database.collection(appsInformation).insertMany([spec('DeadApp', 'd', 3000000, 100), spec('LiveApp', 'l', 3000000, 88000)]);
      installed = [spec('DeadApp', 'd', 3000000, 100), spec('LiveApp', 'l', 3000000, 88000)];

      await registryManager.expireGlobalApplications();

      const left = await database.collection(appsInformation).find({}).toArray();
      expect(left.map((a) => a.name)).to.deep.equal(['LiveApp']);
      expect(queued()).to.deep.equal(['DeadApp']);
    });

    describe('an app with no height', () => {
      afterEach(() => {
        globalState.testInstallingApps.clear();
      });

      it('should leave an app being tested installed', async () => {
        installed = [spec('TestedApp', 't', undefined, 100)];
        globalState.testInstallingApps.add('TestedApp');

        await registryManager.expireGlobalApplications();

        expect(queued()).to.deep.equal([]);
      });

      it('should uninstall one no test is running for', async () => {
        installed = [spec('LeftApp', 't', undefined, 100)];

        await registryManager.expireGlobalApplications();

        expect(queued()).to.deep.equal(['LeftApp']);
      });
    });

    it('should expire an app at its expiration height, installed or only global', async () => {
      // term ends at the tip
      await database.collection(appsInformation).insertMany([spec('EndsNowApp', 'n', 3007900, 100), spec('LiveApp', 'l', 3007900, 101)]);
      installed = [spec('LocalEndsNowApp', 'x', 3007900, 100), spec('LiveApp', 'l', 3007900, 101)];

      await registryManager.expireGlobalApplications();

      const left = await database.collection(appsInformation).find({}).toArray();
      expect(left.map((a) => a.name)).to.deep.equal(['LiveApp']);
      expect(queued()).to.deep.equal(['LocalEndsNowApp']);
    });

    it('should not keep an installed app for a renewal whose term ends at the tip', async () => {
      const realFind = dbHelper.findInDatabase;
      sinon.stub(dbHelper, 'findInDatabase').callsFake(async (dbase, collection, query, options) => {
        // the pass's first read finds nothing to expire; its renewal check finds the renewal
        if (collection === appsInformation && Object.keys(query).length === 0) return [];
        if (collection === appsInformation) return [spec('RenewedApp', 'renewal', 3007900, 100)];
        return realFind(dbase, collection, query, options);
      });
      installed = [spec('RenewedApp', 'cancel', 3003310, 56)];

      await registryManager.expireGlobalApplications();

      expect(queued()).to.deep.equal(['RenewedApp']);
    });

    it('should keep a renewal stored between reading the expired spec and deleting it', async () => {
      // the renewal confirmed right at the expiry block and replaced the spec mid-pass
      await database.collection(appsInformation).insertOne(spec('RenewedApp', 'renewal', 3003381, 88072));
      const realFind = dbHelper.findInDatabase;
      sinon.stub(dbHelper, 'findInDatabase').callsFake(async (dbase, collection, query, options) => {
        if (collection === appsInformation && Object.keys(query).length === 0) return [spec('RenewedApp', 'cancel', 3003310, 56)];
        return realFind(dbase, collection, query, options);
      });
      installed = [spec('RenewedApp', 'cancel', 3003310, 56)];

      await registryManager.expireGlobalApplications();

      const left = await database.collection(appsInformation).findOne({ name: 'RenewedApp' });
      expect(left.hash).to.equal('renewal');
      expect(queued()).to.deep.equal([]);
    });

    describe('another owner on the name of an installed app past its term', () => {
      const { appsMessages } = config.database.appsglobal.collections;
      const buyer = '1Q9sjqQcR2jSFt8pdaF7fhv9ozqD4qLnHu';
      const message = (type, hash, height, expire, signedFor) => ({
        type, hash, height, timestamp: height, appSpecifications: { name: 'TakenApp', version: 3, owner: signedFor, expire },
      });

      beforeEach(async () => {
        await database.collection(appsMessages).deleteMany({});
        // installed under the first owner, its term ending at 3003366
        installed = [spec('TakenApp', 'old', 3003310, 56)];
      });

      afterEach(async () => {
        await database.collection(appsMessages).deleteMany({});
      });

      it('should uninstall it when the other owner registered the name after the term', async () => {
        await database.collection(appsMessages).insertMany([
          message('fluxappregister', 'old', 3003310, 56, owner),
          message('fluxappregister', 'newowner', 3007900, 88000, buyer),
        ]);
        await database.collection(appsInformation).insertOne({ ...spec('TakenApp', 'newowner', 3007900, 88000), owner: buyer });

        await registryManager.expireGlobalApplications();

        expect(queued()).to.deep.equal(['TakenApp']);
      });

      it('should keep it when the name reached the other owner by a transfer this node has not applied', async () => {
        await database.collection(appsMessages).insertMany([
          message('fluxappregister', 'old', 3003310, 56, owner),
          // the owner's update naming the buyer, inside the installed term
          message('fluxappupdate', 'sold', 3003350, 56, buyer),
          // the buyer's update after the installed term ended
          message('fluxappupdate', 'buyerupdate', 3007900, 88000, buyer),
        ]);
        await database.collection(appsInformation).insertOne({ ...spec('TakenApp', 'buyerupdate', 3007900, 88000), owner: buyer });

        await registryManager.expireGlobalApplications();

        expect(queued()).to.deep.equal([]);
      });

      it('should uninstall it when the other owner\'s spec is itself past its term', async () => {
        await database.collection(appsMessages).insertMany([
          message('fluxappregister', 'old', 3003310, 56, owner),
          message('fluxappupdate', 'sold', 3003350, 56, buyer),
        ]);
        // read by the local branch only: the global pass found nothing to expire
        const realFind = dbHelper.findInDatabase;
        sinon.stub(dbHelper, 'findInDatabase').callsFake(async (dbase, collection, query, options) => {
          if (collection === appsInformation && Object.keys(query).length === 0) return [];
          if (collection === appsInformation) return [{ ...spec('TakenApp', 'sold', 3003350, 56), owner: buyer }];
          return realFind(dbase, collection, query, options);
        });

        await registryManager.expireGlobalApplications();

        expect(queued()).to.deep.equal(['TakenApp']);
      });
    });

    it('should not uninstall an app whose installed record is stale but the network renewed', async () => {
      await database.collection(appsInformation).insertOne(spec('RenewedApp', 'renewal', 3003381, 88072));
      // reinstallOldApplications has not refreshed the installed record yet
      installed = [spec('RenewedApp', 'cancel', 3003310, 56), spec('GoneApp', 'g', 3003310, 56)];

      await registryManager.expireGlobalApplications();

      expect(queued()).to.deep.equal(['GoneApp']);
    });

    it('should keep a renewed app whose 0x owner the renewal spells in another case', async () => {
      const ethOwner = '0x5a0b54d5dc17e0aadc383d2db43b0a0d3e029c4c';
      await database.collection(appsInformation).insertOne({ ...spec('EthApp', 'renewal', 3003381, 88072), owner: ethOwner.toUpperCase().replace('0X', '0x') });
      installed = [{ ...spec('EthApp', 'cancel', 3003310, 56), owner: ethOwner }, spec('GoneApp', 'g', 3003310, 56)];

      await registryManager.expireGlobalApplications();

      expect(queued()).to.deep.equal(['GoneApp']);
    });
  });

  describe('rescanGlobalAppsInformation tests', () => {
    it('should rebuild by the same rule as the reindex, a late renewal included', async () => {
      const { appsMessages, appsInformation } = config.database.appsglobal.collections;
      const daemonDb = db.db(config.database.daemon.database);
      await daemonDb.collection(config.database.daemon.collections.scannedHeight).deleteMany({});
      await daemonDb.collection(config.database.daemon.collections.scannedHeight).insertOne({ generalScannedHeight: 3008000 });
      await database.collection(appsMessages).deleteMany({});
      await database.collection(appsInformation).deleteMany({});
      // nothing installed here, so the rebuild has nothing to uninstall
      await db.db(config.database.appslocal.database).collection(config.database.appslocal.collections.appsInformation).deleteMany({});
      const message = (type, hash, height, expire) => ({
        type, hash, height, timestamp: height, appSpecifications: { name: 'RescanApp', version: 3, owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', expire },
      });
      await database.collection(appsMessages).insertMany([
        message('fluxappregister', 'reg', 3003000, 300),
        message('fluxappupdate', 'late', 3003381, 88072),
      ]);

      await registryManager.rescanGlobalAppsInformation(3003000);

      expect((await database.collection(appsInformation).findOne({ name: 'RescanApp' })).hash).to.equal('late');
    });
  });

  describe('reindexGlobalAppsInformation tests', () => {
    let rebuildStub;
    const deferred = () => {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
    const settled = (promise) => {
      const state = { done: false };
      promise.then(() => { state.done = true; }, () => { state.done = true; });
      return state;
    };
    // the rebuild reads the scanned height from mongo before it reaches the
    // stub, so this waits for the stub however long that read takes
    const rebuildsStarted = async (count) => {
      while (rebuildStub.callCount < count) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, 1); });
      }
      expect(rebuildStub.callCount).to.equal(count);
    };

    beforeEach(async () => {
      const daemonDb = db.db(config.database.daemon.database);
      await daemonDb.collection(config.database.daemon.collections.scannedHeight).deleteMany({});
      await daemonDb.collection(config.database.daemon.collections.scannedHeight).insertOne({ generalScannedHeight: 3008000 });
      rebuildStub = sinon.stub(dbHelper, 'reindexGlobalAppsInformation');
    });

    it('should resolve once the registry is swapped in, while the apps it ends are still being removed', async () => {
      rebuildStub.resolves(['GoneApp', 'OtherGoneApp']);
      const removal = deferred();
      const removed = [];
      localRemovalQueue.setRemover(async (name) => {
        removed.push(name);
        await removal.promise;
      });
      sinon.stub(serviceHelper, 'delay').resolves();

      expect(await registryManager.reindexGlobalAppsInformation()).to.equal(true);

      // the first removal has begun and not finished; the second waits behind it
      expect(removed).to.deep.equal(['GoneApp']);
      removal.resolve();
      await localRemovalQueue.drained();
      expect(removed).to.deep.equal(['GoneApp', 'OtherGoneApp']);
      localRemovalQueue.setRemover(null);
    });

    it('should resolve with nothing to remove', async () => {
      rebuildStub.resolves([]);
      const queueStub = sinon.stub(localRemovalQueue, 'queueRemovals');

      expect(await registryManager.reindexGlobalAppsInformation()).to.equal(true);

      sinon.assert.calledOnceWithExactly(queueStub, []);
    });

    it('should answer every call made during a rebuild with one rebuild after it', async () => {
      sinon.stub(localRemovalQueue, 'queueRemovals');
      const first = deferred();
      const second = deferred();
      rebuildStub.onFirstCall().returns(first.promise);
      rebuildStub.onSecondCall().returns(second.promise);

      const p1 = registryManager.reindexGlobalAppsInformation();
      await rebuildsStarted(1);
      const p2 = registryManager.reindexGlobalAppsInformation();
      const p3 = registryManager.reindexGlobalAppsInformation();
      const s2 = settled(p2);
      // neither call starts a rebuild beside the running one
      await new Promise((resolve) => { setImmediate(resolve); });
      sinon.assert.calledOnce(rebuildStub);

      first.resolve([]);
      expect(await p1).to.equal(true);
      await rebuildsStarted(2);
      expect(s2.done).to.equal(false);

      second.resolve([]);
      expect(await p2).to.equal(true);
      expect(await p3).to.equal(true);
      sinon.assert.calledTwice(rebuildStub);
    });

    it('should run the rebuild after a failed one, and fail only the call that failed', async () => {
      sinon.stub(localRemovalQueue, 'queueRemovals');
      const first = deferred();
      rebuildStub.onFirstCall().returns(first.promise);
      rebuildStub.onSecondCall().resolves([]);

      const p1 = registryManager.reindexGlobalAppsInformation();
      await rebuildsStarted(1);
      const p2 = registryManager.reindexGlobalAppsInformation();
      first.reject(new Error('rebuild failed'));

      let failure = null;
      await p1.catch((error) => { failure = error; });
      expect(failure.message).to.equal('rebuild failed');
      expect(await p2).to.equal(true);
      sinon.assert.calledTwice(rebuildStub);
    });

    it('should start a new rebuild for a call made after the last one finished', async () => {
      sinon.stub(localRemovalQueue, 'queueRemovals');
      rebuildStub.resolves([]);

      await registryManager.reindexGlobalAppsInformation();
      await registryManager.reindexGlobalAppsInformation();

      sinon.assert.calledTwice(rebuildStub);
    });
  });

  describe('reconstructAppMessagesHashCollection tests', () => {
    const { appsMessages } = config.database.appsglobal.collections;
    const { appsHashes } = config.database.daemon.collections;
    let daemonDb;
    let emitSpy;
    const record = (hash, fields) => ({
      hash, txid: `tx${hash}`, height: 3000000, value: 1, retryFromHeight: 3000000, nextRetryHeight: 3000000, syncAttempts: 0, ...fields,
    });
    const message = (hash) => ({
      type: 'fluxappregister', hash, height: 3000000, timestamp: 1, appSpecifications: { name: `App${hash}`, version: 3, owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC' },
    });
    const unresolvedSignals = () => emitSpy.args.filter(([event]) => event === SYNC_EVENTS.HASH_UNRESOLVED).length;
    const hashIndex = 'query for getting app hash';

    beforeEach(async () => {
      daemonDb = db.db(config.database.daemon.database);
      await daemonDb.collection(appsHashes).deleteMany({});
      // the node's own index; without it every correction scans the whole collection
      await daemonDb.collection(appsHashes).createIndex({ hash: 1 }, { name: hashIndex, unique: true });
      await database.collection(appsMessages).deleteMany({});
      emitSpy = sinon.spy(appSyncEvents, 'emit');
    });

    afterEach(async () => {
      await daemonDb.collection(appsHashes).dropIndex(hashIndex);
    });

    it('should signal a hash to fetch when it marks a received message missing', async () => {
      await daemonDb.collection(appsHashes).insertOne(record('lost', { message: true }));

      await registryManager.reconstructAppMessagesHashCollection();

      const lost = await daemonDb.collection(appsHashes).findOne({ hash: 'lost' });
      expect(lost.message).to.equal(false);
      expect(lost, 'looked for with the year it had, not afresh').to.not.have.property('retryFromHeight');
      expect(unresolvedSignals()).to.equal(1);
    });

    it('should not signal when it only marks a held message received', async () => {
      await daemonDb.collection(appsHashes).insertMany([
        record('held', { message: false }),
        { hash: 'old', txid: 'txold', height: 3000000, value: 1, message: true },
      ]);
      await database.collection(appsMessages).insertMany([message('held'), message('old')]);

      const { changed } = await registryManager.reconstructAppMessagesHashCollection();

      // the canary: the audit did correct the held record, and only it
      expect(changed).to.equal(1);
      expect((await daemonDb.collection(appsHashes).findOne({ hash: 'held' })).message).to.equal(true);
      expect(unresolvedSignals()).to.equal(0);
    });

    it('reads only the message hashes and writes its corrections in batches', async () => {
      const count = 5001;
      await daemonDb.collection(appsHashes).insertMany(Array.from({ length: count }, (_, i) => record(`h${i}`, { message: false })));
      await database.collection(appsMessages).insertMany(Array.from({ length: count }, (_, i) => message(`h${i}`)));
      const reads = sinon.spy(dbHelper, 'findInDatabase');
      const writes = sinon.spy(Collection.prototype, 'bulkWrite');

      const { changed } = await registryManager.reconstructAppMessagesHashCollection();

      expect(changed).to.equal(count);
      expect(reads.firstCall.args[3]).to.deep.equal({ projection: { _id: 0, hash: 1 } });
      expect(writes.getCalls().map((call) => call.args[0].length)).to.deep.equal([5000, 1]);
    });

    it('should signal from the operator route', async () => {
      await daemonDb.collection(appsHashes).insertOne(record('lost', { message: true }));
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      const res = { json: sinon.fake() };

      await registryManager.reconstructAppMessagesHashCollectionAPI({ headers: {} }, res);

      expect(res.json.firstCall.args[0].status).to.equal('success');
      expect(unresolvedSignals()).to.equal(1);
    });
  });

  describe('storeAppSpecificationInForce tests', () => {
    const { appsMessages, appsInformation } = config.database.appsglobal.collections;
    const owner = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
    const specOf = (name, m) => ({
      name, version: 3, owner, expire: m.expire, ...m.spec, height: m.height, hash: m.hash,
    });
    const messageOf = (name, m) => ({
      type: m.type || 'fluxappupdate', hash: m.hash, height: m.height, timestamp: m.timestamp ?? m.height, appSpecifications: specOf(name, m),
    });
    // the permanent messages of one app, already stored as promotion stores them before this runs
    const logMessages = async (name, messages) => {
      await database.collection(appsMessages).deleteMany({ 'appSpecifications.name': name });
      // hashes are unique in the log, and these are reused across apps
      await database.collection(appsMessages).deleteMany({ hash: { $in: messages.map((m) => m.hash) } });
      await database.collection(appsInformation).deleteMany({ name });
      await database.collection(appsMessages).insertMany(messages.map((m) => messageOf(name, m)));
    };
    const promote = (name, m) => registryManager.storeAppSpecificationInForce(specOf(name, m));
    const stored = (name) => database.collection(appsInformation).findOne({ name });
    const atHeight = (height) => sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height } });

    it('should break a same-block tie by timestamp when deciding the governing message', async () => {
      await logMessages('SameBlockApp', [
        { hash: 'first', height: 371, timestamp: 1000 },
        { hash: 'second', height: 371, timestamp: 2000 },
      ]);

      expect(await registryManager.isGoverningAppMessage('SameBlockApp', 'second')).to.equal(true);
      expect(await registryManager.isGoverningAppMessage('SameBlockApp', 'first')).to.equal(false);
      expect(await registryManager.isGoverningAppMessage('NoSuchApp', 'second')).to.equal(false);
    });

    it('rejects when the row cannot be written, never reporting the app stored', async () => {
      atHeight(150);
      const reg = { type: 'fluxappregister', hash: 'unwritten', height: 100 };
      await logMessages('UnwrittenApp', [reg]);
      sinon.stub(dbHelper, 'replaceOneInDatabase').rejects(new Error('connection timed out'));

      const failure = await promote('UnwrittenApp', reg).catch((err) => err);

      expect(failure, 'an unwritten row was reported stored').to.be.an('error');
      expect(await stored('UnwrittenApp')).to.equal(null);
    });

    it('leaves a row that already holds the message as it is', async () => {
      atHeight(150);
      const reg = { type: 'fluxappregister', hash: 'heldhash', height: 100 };
      await logMessages('HeldApp', [reg]);
      await promote('HeldApp', reg);
      const replace = sinon.spy(dbHelper, 'replaceOneInDatabase');
      const clearErrors = sinon.spy(dbHelper, 'removeDocumentsFromCollection');

      await promote('HeldApp', reg);

      sinon.assert.notCalled(replace);
      expect(clearErrors.called, 'the app\'s install errors were cleared for a write that changed nothing').to.be.false;
    });

    it('should store a registration, then the update that follows it', async () => {
      atHeight(150);
      const reg = { type: 'fluxappregister', hash: 'oldhash', height: 100 };
      const upd = { hash: 'newhash', height: 200 };
      await logMessages('UpdateTestApp', [reg]);
      await promote('UpdateTestApp', reg);
      expect((await stored('UpdateTestApp')).hash).to.equal('oldhash');

      await database.collection(appsMessages).insertOne(messageOf('UpdateTestApp', upd));
      await promote('UpdateTestApp', upd);

      const result = await registryManager.getApplicationSpecifications('UpdateTestApp');
      expect(result.height).to.equal(200);
      expect(result.hash).to.equal('newhash');
    });

    it('should not store another owner\'s registration of a live app over its holder', async () => {
      atHeight(250);
      const holder = { type: 'fluxappregister', hash: 'holderhash', height: 100 };
      const taker = {
        type: 'fluxappregister', hash: 'takerhash', height: 200, spec: { owner: '1Q9sjqQcR2jSFt8pdaF7fhv9ozqD4qLnHu' },
      };
      await logMessages('HeldApp', [holder]);
      await promote('HeldApp', holder);

      await database.collection(appsMessages).insertOne(messageOf('HeldApp', taker));
      await promote('HeldApp', taker);

      expect((await stored('HeldApp')).hash).to.equal('holderhash');
    });

    it('should not store a message whose term ends at the current block', async () => {
      atHeight(3003100);
      const reg = { type: 'fluxappregister', hash: 'endsnow', height: 3003000, expire: 100 };
      await logMessages('EndsNowApp', [reg]);

      await promote('EndsNowApp', reg);

      expect(await stored('EndsNowApp')).to.equal(null);
    });

    it('should change nothing for a message a newer one superseded', async () => {
      atHeight(3003400);
      const renewal = { hash: 'renewal', height: 3003290, expire: 88000 };
      await logMessages('SupersededApp', [
        { type: 'fluxappregister', hash: 'reg', height: 3003000, expire: 88000 },
        renewal,
        { hash: 'newer', height: 3003300, expire: 88000 },
      ]);

      await promote('SupersededApp', renewal);

      expect(await stored('SupersededApp')).to.equal(null);
    });

    it('should not accumulate ghost fields when spec version changes', async () => {
      const v3 = {
        type: 'fluxappregister',
        hash: 'hash1',
        height: 100,
        spec: {
          description: 'Test', repotag: 'test/image:latest', cpu: 0.5, ram: 500, hdd: 5,
        },
      };
      const v4 = {
        hash: 'hash2',
        height: 200,
        spec: {
          version: 4, description: 'Test', compose: [{ name: 'main', cpu: 0.5, ram: 500, hdd: 5 }], instances: 3,
        },
      };
      await logMessages('GhostFieldTestApp', [v3]);
      await promote('GhostFieldTestApp', v3);
      await database.collection(appsMessages).insertOne(messageOf('GhostFieldTestApp', v4));
      await promote('GhostFieldTestApp', v4);

      const result = await registryManager.getApplicationSpecifications('GhostFieldTestApp');
      expect(result.version).to.equal(4);
      expect(result.compose).to.exist;
      expect(result.repotag).to.be.undefined;
      expect(result.cpu).to.be.undefined;
      expect(result.ram).to.be.undefined;
      expect(result.hdd).to.be.undefined;
    });

    it('should renew an app this node expired, for an update that confirmed after the app had expired', async () => {
      // the app ran out at 3003300; the renewal confirmed at 3003381
      atHeight(3003400);
      const late = { hash: 'late', height: 3003381, expire: 88072 };
      await logMessages('LateApp', [
        { type: 'fluxappregister', hash: 'reg', height: 3003000, expire: 300 },
        late,
      ]);

      await promote('LateApp', late);

      expect((await stored('LateApp')).hash).to.equal('late');
    });

    it('should renew an app this node expired, for an update promoted after the expiry pass', async () => {
      // confirmed at 3003290, 10 blocks before the app ran out; promoted at 3003400
      atHeight(3003400);
      const renewal = { hash: 'renewal', height: 3003290, expire: 88000 };
      await logMessages('RenewedLateApp', [
        { type: 'fluxappregister', hash: 'reg', height: 3003000, expire: 300 },
        renewal,
      ]);

      await promote('RenewedLateApp', renewal);

      expect((await stored('RenewedLateApp')).hash).to.equal('renewal');
    });

    it('should change nothing for the newest message once its own term has ended', async () => {
      atHeight(3003400);
      const cancel = { hash: 'cancel', height: 3003290, expire: 100 };
      await logMessages('CancelledApp', [
        { type: 'fluxappregister', hash: 'reg', height: 3003000, expire: 88000 },
        cancel,
      ]);

      await promote('CancelledApp', cancel);

      expect(await stored('CancelledApp')).to.equal(null);
    });

    it('should settle a same-block tie by timestamp, not by which update was processed first', async () => {
      atHeight(3003600);
      const later = { hash: 'later', height: 3003500, timestamp: 2, expire: 88000 };
      const earlier = { hash: 'earlier', height: 3003500, timestamp: 1, expire: 88000 };
      await logMessages('TieApp', [{ type: 'fluxappregister', hash: 'reg', height: 3003000, expire: 88000 }, later, earlier]);

      await promote('TieApp', later);
      expect((await stored('TieApp')).hash).to.equal('later');
      await promote('TieApp', earlier);
      expect((await stored('TieApp')).hash).to.equal('later');
    });

    it('should never let an older promotion overwrite a newer one', async () => {
      atHeight(400);
      const older = { type: 'fluxappregister', hash: 'h300', height: 300 };
      const newer = { hash: 'h371', height: 371 };
      await logMessages('ConcurrentApp', [older]);
      // The newer message confirms and is promoted while the older one's promotion is between
      // reading the log and writing the spec.
      const realFind = dbHelper.findInDatabase;
      let newerPromotion = null;
      sinon.stub(dbHelper, 'findInDatabase').callsFake(async (dbase, collection, query, options) => {
        const result = await realFind(dbase, collection, query, options);
        if (!newerPromotion && collection === appsMessages && query['appSpecifications.name'] === 'ConcurrentApp') {
          await database.collection(appsMessages).insertOne(messageOf('ConcurrentApp', newer));
          newerPromotion = promote('ConcurrentApp', newer);
          await new Promise((resolve) => { setTimeout(resolve, 50); });
        }
        return result;
      });

      await promote('ConcurrentApp', older);
      await newerPromotion;

      const all = await database.collection(appsInformation).find({ name: 'ConcurrentApp' }).toArray();
      expect(all.map((a) => a.hash)).to.deep.equal(['h371']);
    });
  });

  describe('registrationInformation tests', () => {
    it('should return registration information from config', () => {
      const res = {
        json: sinon.fake((param) => param),
      };

      registryManager.registrationInformation(undefined, res);

      const result = res.json.firstCall.args[0];
      expect(result.status).to.equal('success');
      expect(result.data).to.exist;
    });
  });

  describe('getInstalledApps tests', () => {
    it('should return installed apps from local database', async () => {
      const result = await registryManager.getInstalledApps();

      expect(result).to.be.an('array');
    });

    it('should reject when the read fails, never answer an empty list', async () => {
      sinon.stub(dbHelper, 'findInDatabase').rejects(new Error('Database error'));

      const error = await registryManager.getInstalledApps().catch((err) => err);

      expect(error).to.be.instanceOf(Error);
      expect(error.message).to.equal('Database error');
    });
  });

  describe('getRunningAppIpList tests', () => {
    beforeEach(async () => {
      const collection = config.database.appsglobal.collections.appsLocations;
      const testLocations = [
        {
          name: 'App1',
          ip: '192.168.1.1:16127',
          hash: 'hash1',
        },
        {
          name: 'App2',
          ip: '192.168.1.1:16127',
          hash: 'hash2',
        },
        {
          name: 'App3',
          ip: '192.168.1.2:16127',
          hash: 'hash3',
        },
        {
          name: 'BeginsWithTheIp',
          ip: '192.168.1.10:16127',
          hash: 'hash4',
        },
        {
          name: 'MatchesOnlyAsAPattern',
          ip: '192x168x1x1:16127',
          hash: 'hash5',
        },
        {
          name: 'OtherPort',
          ip: '192.168.1.1:16137',
          hash: 'hash6',
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testLocations);
    });

    it('should return apps running on specific IP, at every port', async () => {
      const result = await registryManager.getRunningAppIpList('192.168.1.1');

      expect(result.map((app) => app.name).sort()).to.deep.equal(['App1', 'App2', 'OtherPort']);
    });

    // An address that only begins with the IP, or matches it with its dots read
    // as a pattern, is another node.
    it('returns no app at an address that only begins with the IP or matches it as a pattern', async () => {
      const names = (await registryManager.getRunningAppIpList('192.168.1.1')).map((app) => app.name);

      expect(names).to.not.include('BeginsWithTheIp');
      expect(names).to.not.include('MatchesOnlyAsAPattern');
    });

    it('reads a socket address as its IP', async () => {
      const result = await registryManager.getRunningAppIpList('192.168.1.1:16137');

      expect(result.map((app) => app.name).sort()).to.deep.equal(['App1', 'App2', 'OtherPort']);
    });

    it('returns nothing for no address', async () => {
      expect(await registryManager.getRunningAppIpList('')).to.deep.equal([]);
    });

    it('should return empty array for IP with no apps', async () => {
      const result = await registryManager.getRunningAppIpList('10.0.0.1');

      expect(result).to.be.an('array');
      expect(result).to.be.empty;
    });
  });

  describe('appLocationFromEvents tests', () => {
    const eventsCollection = config.database.appsglobal.collections.appStateEvents;
    const now = Date.now();

    beforeEach(async () => {
      try {
        await database.collection(eventsCollection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
    });

    function makeV2Event(ip, apps, broadcastedAt, opts = {}) {
      return {
        ip,
        type: 'apprunning',
        dedupKey: 'v2',
        broadcastedAt: new Date(broadcastedAt),
        expireAt: new Date(broadcastedAt + 125 * 60 * 1000),
        data: {
          ip, version: 2, apps, broadcastedAt, osUptime: 1000, staticIp: true,
        },
        envelope: { version: 1, timestamp: broadcastedAt, pubKey: '04abc', signature: 'sig' },
        ...opts,
      };
    }

    function makeV1Event(ip, name, hash, broadcastedAt) {
      return {
        ip,
        type: 'apprunning',
        dedupKey: `v1:${name}`,
        broadcastedAt: new Date(broadcastedAt),
        expireAt: new Date(broadcastedAt + 125 * 60 * 1000),
        data: {
          ip, name, hash, broadcastedAt, runningSince: new Date(broadcastedAt), osUptime: 1000, staticIp: true,
        },
        envelope: { version: 1, timestamp: broadcastedAt, pubKey: '04abc', signature: 'sig' },
      };
    }

    function makeAppRemovedEvent(ip, appName, broadcastedAt) {
      return {
        ip,
        type: 'appremoved',
        dedupKey: `appremoved:${appName}`,
        broadcastedAt: new Date(broadcastedAt),
        expireAt: new Date(broadcastedAt + 125 * 60 * 1000),
        data: { ip, appName, broadcastedAt },
        envelope: { version: 1, timestamp: broadcastedAt, pubKey: '04abc', signature: 'sig' },
      };
    }

    function makeSigtermEvent(ip, broadcastedAt) {
      return {
        ip,
        type: 'sigterm',
        dedupKey: 'sigterm',
        broadcastedAt: new Date(broadcastedAt),
        expireAt: new Date(broadcastedAt + 7 * 60 * 1000),
        envelope: { version: 1, timestamp: broadcastedAt, pubKey: '04abc', signature: 'sig' },
      };
    }

    function makeEvictedEvent(ip, createdAt) {
      return {
        ip,
        type: 'evicted',
        dedupKey: 'evicted',
        createdAt: new Date(createdAt),
        expireAt: new Date(createdAt + 125 * 60 * 1000),
      };
    }

    function makeIPChangedEvent(oldIp, newIp, broadcastedAt) {
      return {
        ip: oldIp,
        type: 'ipchanged',
        dedupKey: 'ipchanged',
        broadcastedAt: new Date(broadcastedAt),
        expireAt: new Date(broadcastedAt + 125 * 60 * 1000),
        data: {
          type: 'fluxipchanged', version: 1, oldIP: oldIp, newIP: newIp, broadcastedAt,
        },
      };
    }

    it('should derive locations from v2 events', async () => {
      await database.collection(eventsCollection).insertOne(
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }, { name: 'AppB', hash: 'h2' }], now),
      );

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(2);
      const names = result.map((r) => r.name).sort();
      expect(names).to.deep.equal(['AppA', 'AppB']);
      expect(result[0].ip).to.equal('1.2.3.4');
    });

    it('should derive locations from v1 events', async () => {
      await database.collection(eventsCollection).insertOne(
        makeV1Event('5.6.7.8', 'AppC', 'h3', now),
      );

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(1);
      expect(result[0].name).to.equal('AppC');
    });

    it('should include v1 newer than latest v2 for same IP', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now - 60000),
        makeV1Event('1.2.3.4', 'AppB', 'h2', now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(2);
      const names = result.map((r) => r.name).sort();
      expect(names).to.deep.equal(['AppA', 'AppB']);
    });

    it('should exclude v1 older than latest v2 for same IP', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV1Event('1.2.3.4', 'OldApp', 'h0', now - 120000),
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(1);
      expect(result[0].name).to.equal('AppA');
    });

    it('should exclude apps with newer appremoved event', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }, { name: 'AppB', hash: 'h2' }], now - 60000),
        makeAppRemovedEvent('1.2.3.4', 'AppA', now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(1);
      expect(result[0].name).to.equal('AppB');
    });

    it('should keep apps when appremoved is older than broadcast', async () => {
      await database.collection(eventsCollection).insertMany([
        makeAppRemovedEvent('1.2.3.4', 'AppA', now - 120000),
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(1);
      expect(result[0].name).to.equal('AppA');
    });

    it('should exclude apps when sigterm is newer and expired', async () => {
      const sigtermTime = now - 8 * 60 * 1000;
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now - 10 * 60 * 1000),
        makeSigtermEvent('1.2.3.4', sigtermTime),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(0);
    });

    it('should keep apps when sigterm expiry has not passed', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now - 60000),
        makeSigtermEvent('1.2.3.4', now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(1);
      expect(result[0].name).to.equal('AppA');
    });

    it('should exclude apps when sigterm is past grace period but still in event log', async () => {
      const sigtermTime = now - 30 * 60 * 1000; // 30 min ago — past 7-min grace, within 125-min TTL
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now - 60 * 60 * 1000),
        makeSigtermEvent('1.2.3.4', sigtermTime),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(0);
    });

    it('should keep apps when broadcast is newer than sigterm', async () => {
      await database.collection(eventsCollection).insertMany([
        makeSigtermEvent('1.2.3.4', now - 120000),
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(1);
    });

    it('should exclude apps immediately when evicted (no grace period)', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now - 60000),
        makeEvictedEvent('1.2.3.4', now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(0);
    });

    it('should exclude apps when evicted and expired', async () => {
      const evictedTime = now - 8 * 60 * 1000;
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now - 10 * 60 * 1000),
        makeEvictedEvent('1.2.3.4', evictedTime),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(0);
    });

    it('should keep apps when broadcast is newer than eviction', async () => {
      await database.collection(eventsCollection).insertMany([
        makeEvictedEvent('1.2.3.4', now - 60000),
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(1);
    });

    it('should remap IP when ipchanged event is newer than broadcast', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.1.1.1', [{ name: 'AppA', hash: 'h1' }, { name: 'AppB', hash: 'h2' }], now - 60000),
        makeIPChangedEvent('1.1.1.1', '2.2.2.2', now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(2);
      result.forEach((r) => expect(r.ip).to.equal('2.2.2.2'));
    });

    it('should not remap IP when ipchanged is older than broadcast', async () => {
      await database.collection(eventsCollection).insertMany([
        makeIPChangedEvent('1.1.1.1', '2.2.2.2', now - 120000),
        makeV2Event('1.1.1.1', [{ name: 'AppA', hash: 'h1' }], now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(1);
      expect(result[0].ip).to.equal('1.1.1.1');
    });

    it('should dedup remapped apps with fresh broadcast at new IP', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.1.1.1', [{ name: 'AppA', hash: 'h1' }, { name: 'AppB', hash: 'h2' }], now - 120000),
        makeIPChangedEvent('1.1.1.1', '2.2.2.2', now - 60000),
        makeV2Event('2.2.2.2', [{ name: 'AppA', hash: 'h1' }, { name: 'AppB', hash: 'h2' }, { name: 'AppC', hash: 'h3' }], now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(3);
      const names = result.map((r) => r.name).sort();
      expect(names).to.deep.equal(['AppA', 'AppB', 'AppC']);
      result.forEach((r) => expect(r.ip).to.equal('2.2.2.2'));
    });

    it('should exclude expired events', async () => {
      const expired = now - 130 * 60 * 1000;
      await database.collection(eventsCollection).insertOne(
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], expired),
      );

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(0);
    });

    it('should filter by appname (case insensitive)', async () => {
      await database.collection(eventsCollection).insertOne(
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }, { name: 'AppB', hash: 'h2' }], now),
      );

      const result = await registryManager.appLocationFromEvents({ appname: 'appa' });
      expect(result).to.be.an('array').with.lengthOf(1);
      expect(result[0].name).to.equal('AppA');
    });

    it('should dedup v1 overriding same app in v2 with newer timestamp', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'old' }, { name: 'AppB', hash: 'h2' }], now - 60000),
        makeV1Event('1.2.3.4', 'AppA', 'new', now),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(2);
      const appA = result.find((r) => r.name === 'AppA');
      expect(appA.hash).to.equal('new');
      const appB = result.find((r) => r.name === 'AppB');
      expect(appB.hash).to.equal('h2');
    });

    it('should handle multiple IPs independently', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now),
        makeV2Event('5.6.7.8', [{ name: 'AppB', hash: 'h2' }], now),
        makeAppRemovedEvent('5.6.7.8', 'AppB', now + 1000),
      ]);

      const result = await registryManager.appLocationFromEvents();
      expect(result).to.be.an('array').with.lengthOf(1);
      expect(result[0].name).to.equal('AppA');
      expect(result[0].ip).to.equal('1.2.3.4');
    });

    it('should filter by ip option', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now),
        makeV2Event('5.6.7.8', [{ name: 'AppB', hash: 'h2' }], now),
      ]);

      const result = await registryManager.appLocationFromEvents({ ip: '5.6.7.8' });
      expect(result).to.be.an('array').with.lengthOf(1);
      expect(result[0].name).to.equal('AppB');
      expect(result[0].ip).to.equal('5.6.7.8');
    });

    it('should return empty when filtering by ip with no apps', async () => {
      await database.collection(eventsCollection).insertMany([
        makeV2Event('1.2.3.4', [{ name: 'AppA', hash: 'h1' }], now),
      ]);

      const result = await registryManager.appLocationFromEvents({ ip: '9.9.9.9' });
      expect(result).to.be.an('array').with.lengthOf(0);
    });
  });
});

describe('registryManager registerAppGlobalyApi tests', () => {
  const spec = {
    version: 8,
    name: 'registertest',
    description: 'register test',
    owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    enterprise: 'blob',
  };

  const register = (appSpecification) => new Promise((resolve) => {
    const req = new EventEmitter();
    const res = { json: (response) => resolve(response) };
    registryManager.registerAppGlobalyApi(req, res);
    req.emit('data', JSON.stringify({
      appSpecification, timestamp: Date.now(), signature: 'sig', type: 'fluxappregister', version: 1,
    }));
    req.emit('end');
  });

  beforeEach(() => {
    sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
    sinon.stub(peerManager, 'outboundCount').get(() => 100);
    sinon.stub(peerManager, 'inboundCount').get(() => 100);
    sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 2500000 } });
  });

  afterEach(() => {
    sinon.restore();
  });

  [
    ['an invalid app name', { name: 'register_test' }],
    ['an invalid owner', { owner: 'my-owner' }],
  ].forEach(([description, change]) => {
    it(`should refuse an enterprise spec with ${description}`, async () => {
      const response = await register({ ...spec, ...change });
      expect(response.status).to.equal('error');
      expect(response.data.message).to.equal('Invalid app name or owner');
    });
  });

  it('should decrypt a spec with a valid app name and owner', async () => {
    // Off ArcaneOS the decrypt refuses, which shows the spec reached it.
    const response = await register(spec);
    expect(response.data.message).to.equal('Application Specifications can only be validated on a node running Arcane OS.');
  });
});
