const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const { ObjectId } = require('mongodb');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
// eslint-disable-next-line no-unused-vars
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');

describe('registryManager tests', () => {
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
      const appSpecs = {
        name: 'UpdateTestApp',
        version: 3,
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        height: 200,
        hash: 'newhash',
      };

      await registryManager.updateAppSpecifications(appSpecs);

      const result = await registryManager.getApplicationSpecifications('UpdateTestApp');
      expect(result.name).to.equal('UpdateTestApp');
      expect(result.height).to.equal(200);
    });

    it('should not update if height is lower than existing', async () => {
      const initialSpecs = {
        name: 'HeightTestApp',
        version: 3,
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        height: 300,
        hash: 'hash1',
      };

      await registryManager.updateAppSpecifications(initialSpecs);

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
});
