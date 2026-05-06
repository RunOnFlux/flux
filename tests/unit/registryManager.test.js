const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const { ObjectId } = require('mongodb');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
// eslint-disable-next-line no-unused-vars
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
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

  describe('updateAppSpecifications tests', () => {
    it('should update app specifications', async () => {
      const initialSpecs = {
        name: 'UpdateTestApp',
        version: 3,
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        height: 100,
        hash: 'oldhash',
      };
      await registryManager.insertAppSpecifications(initialSpecs);

      const updatedSpecs = {
        name: 'UpdateTestApp',
        version: 3,
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        height: 200,
        hash: 'newhash',
      };
      await registryManager.updateAppSpecifications(updatedSpecs);

      const result = await registryManager.getApplicationSpecifications('UpdateTestApp');
      expect(result.name).to.equal('UpdateTestApp');
      expect(result.height).to.equal(200);
      expect(result.hash).to.equal('newhash');
    });

    it('should not update if height is lower than existing', async () => {
      const initialSpecs = {
        name: 'HeightTestApp',
        version: 3,
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        height: 300,
        hash: 'hash1',
      };

      await registryManager.insertAppSpecifications(initialSpecs);

      const lowerHeightSpecs = {
        ...initialSpecs,
        height: 200,
        hash: 'hash2',
      };

      await registryManager.updateAppSpecifications(lowerHeightSpecs);

      const result = await registryManager.getApplicationSpecifications('HeightTestApp');
      expect(result.height).to.equal(300);
      expect(result.hash).to.equal('hash1');
    });

    it('should not accumulate ghost fields when spec version changes', async () => {
      // Simulate a v3 flat spec registration
      const v3Spec = {
        version: 3,
        name: 'GhostFieldTestApp',
        description: 'Test',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        repotag: 'test/image:latest',
        cpu: 0.5,
        ram: 500,
        hdd: 5,
        height: 100,
        hash: 'hash1',
      };
      await registryManager.insertAppSpecifications(v3Spec);

      // Simulate a v4 compose update (no flat fields)
      const v4Spec = {
        version: 4,
        name: 'GhostFieldTestApp',
        description: 'Test',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        compose: [{ name: 'main', cpu: 0.5, ram: 500, hdd: 5 }],
        instances: 3,
        height: 200,
        hash: 'hash2',
      };
      await registryManager.updateAppSpecifications(v4Spec);

      const result = await registryManager.getApplicationSpecifications('GhostFieldTestApp');
      expect(result.version).to.equal(4);
      expect(result.compose).to.exist;
      // Ghost flat fields from v3 should NOT exist
      expect(result.repotag).to.be.undefined;
      expect(result.cpu).to.be.undefined;
      expect(result.ram).to.be.undefined;
      expect(result.hdd).to.be.undefined;
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

  describe('getAllGlobalApplications tests', () => {
    beforeEach(async () => {
      const collection = config.database.appsglobal.collections.appsInformation;
      const apps = [
        {
          name: 'App1',
          owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          height: 100,
        },
        {
          name: 'App2',
          owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          height: 200,
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, apps);
    });

    it('should return all global applications', async () => {
      const result = await registryManager.getAllGlobalApplications();

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(2);
    });

    it('should return applications with specific projections', async () => {
      const result = await registryManager.getAllGlobalApplications(['name', 'owner']);

      expect(result).to.be.an('array');
      if (result.length > 0) {
        expect(result[0]).to.have.property('name');
        expect(result[0]).to.have.property('owner');
      }
    });

    it('should sort applications by height', async () => {
      const result = await registryManager.getAllGlobalApplications(['name', 'height']);

      if (result.length > 1) {
        expect(result[0].height).to.be.at.most(result[1].height);
      }
    });
  });

  describe('getInstalledApps tests', () => {
    it('should return installed apps from local database', async () => {
      const result = await registryManager.getInstalledApps();

      expect(result).to.be.an('array');
    });

    it('should handle errors and return empty array', async () => {
      sinon.stub(dbHelper, 'findInDatabase').rejects(new Error('Database error'));

      const result = await registryManager.getInstalledApps();

      expect(result).to.be.an('array');
      expect(result).to.be.empty;
    });
  });

  describe('getRunningApps tests', () => {
    it('should return running apps from global locations', async () => {
      const result = await registryManager.getRunningApps();

      expect(result).to.be.an('array');
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
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testLocations);
    });

    it('should return apps running on specific IP', async () => {
      const result = await registryManager.getRunningAppIpList('192.168.1.1');

      expect(result).to.be.an('array');
      expect(result.length).to.equal(2);
      result.forEach((app) => {
        expect(app.ip).to.include('192.168.1.1');
      });
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

    function makeIPChangedEvent(oldIP, newIP, broadcastedAt) {
      return {
        ip: oldIP,
        type: 'ipchanged',
        dedupKey: 'ipchanged',
        broadcastedAt: new Date(broadcastedAt),
        expireAt: new Date(broadcastedAt + 125 * 60 * 1000),
        data: { oldIP, newIP, broadcastedAt },
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
