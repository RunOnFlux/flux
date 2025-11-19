const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const resourceQueryService = require('../../ZelBack/src/services/appQuery/resourceQueryService');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const generalService = require('../../ZelBack/src/services/generalService');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const hwRequirements = require('../../ZelBack/src/services/appRequirements/hwRequirements');
const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');

describe('resourceQueryService tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('fluxUsage tests', () => {
    it('should return flux usage statistics', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const installedApps = [
        { name: 'App1', version: 3 },
        { name: 'App2', version: 4 },
        { name: 'App3', version: 3 },
      ];

      sinon.stub(registryManager, 'getInstalledApps').resolves(installedApps);
      sinon.stub(appQueryService, 'listRunningApps').resolves({
        status: 'success',
        data: [
          { name: 'App1' },
          { name: 'App2' },
        ],
      });
      sinon.stub(hwRequirements, 'getNodeSpecs').resolves({
        cpuCores: 8,
        ram: 16000,
        ssdStorage: 500,
      });
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.fluxUsage(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.totalApps).to.equal(3);
      expect(response.data.runningApps).to.equal(2);
      expect(response.data.stoppedApps).to.equal(1);
      expect(response.data.nodeSpecs.cpuCores).to.equal(8);
    });

    it('should work without response object', async () => {
      sinon.stub(registryManager, 'getInstalledApps').resolves([]);
      sinon.stub(appQueryService, 'listRunningApps').resolves({
        status: 'success',
        data: [],
      });
      sinon.stub(hwRequirements, 'getNodeSpecs').resolves({
        cpuCores: 8,
        ram: 16000,
        ssdStorage: 500,
      });
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      const result = await resourceQueryService.fluxUsage(null, null);

      expect(result.status).to.equal('success');
      expect(result.data.totalApps).to.equal(0);
    });

    it('should handle error gracefully', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(registryManager, 'getInstalledApps').rejects(new Error('Database error'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await resourceQueryService.fluxUsage(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should handle missing running apps data', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(registryManager, 'getInstalledApps').resolves([{ name: 'App1' }]);
      sinon.stub(appQueryService, 'listRunningApps').resolves({
        status: 'error',
      });
      sinon.stub(hwRequirements, 'getNodeSpecs').resolves({
        cpuCores: 8,
        ram: 16000,
        ssdStorage: 500,
      });
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.fluxUsage(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.runningApps).to.equal(0);
    });
  });

  describe('appsResources tests', () => {
    let db;
    let database;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      db = dbHelper.databaseConnection();
      database = db.db(config.database.appslocal.database);

      sinon.stub(generalService, 'nodeTier').resolves('stratus');
    });

    it('should calculate resources for version 3 non-tiered apps', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 3,
          tiered: false,
          cpu: 2,
          ram: 4000,
          hdd: 50,
        },
        {
          name: 'App2',
          version: 3,
          tiered: false,
          cpu: 1,
          ram: 2000,
          hdd: 25,
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.appsResources(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.appsCpusLocked).to.equal(3);
      expect(response.data.appsRamLocked).to.equal(6000);
      expect(response.data.appsHddLocked).to.be.greaterThan(75); // Base HDD + filesystem overhead
    });

    it('should calculate resources for version 3 tiered apps', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 3,
          tiered: true,
          cpu: 1,
          ram: 2000,
          hdd: 25,
          cpustratus: 4,
          ramstratus: 8000,
          hddstratus: 100,
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.appsResources(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.appsCpusLocked).to.equal(4);
      expect(response.data.appsRamLocked).to.equal(8000);
      expect(response.data.appsHddLocked).to.be.greaterThan(100);
    });

    it('should calculate resources for version 4+ compose apps', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 4,
          compose: [
            {
              name: 'Component1', cpu: 1, ram: 2000, hdd: 20,
            },
            {
              name: 'Component2', cpu: 2, ram: 4000, hdd: 30,
            },
          ],
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.appsResources(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.appsCpusLocked).to.equal(3);
      expect(response.data.appsRamLocked).to.equal(6000);
      expect(response.data.appsHddLocked).to.be.greaterThan(50);
    });

    it('should calculate resources for tiered compose apps', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 4,
          compose: [
            {
              name: 'Component1',
              tiered: true,
              cpu: 1,
              ram: 2000,
              hdd: 20,
              cpustratus: 2,
              ramstratus: 4000,
              hddstratus: 40,
            },
            {
              name: 'Component2',
              tiered: false,
              cpu: 1,
              ram: 2000,
              hdd: 20,
            },
          ],
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.appsResources(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.appsCpusLocked).to.equal(3);
      expect(response.data.appsRamLocked).to.equal(6000);
      expect(response.data.appsHddLocked).to.be.greaterThan(60);
    });

    it('should work without response object', async () => {
      const collection = config.database.appslocal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      const result = await resourceQueryService.appsResources(null, null);

      expect(result.status).to.equal('success');
      expect(result.data.appsCpusLocked).to.equal(0);
      expect(result.data.appsRamLocked).to.equal(0);
    });

    it('should handle empty database gracefully', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const collection = config.database.appslocal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.appsResources(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.appsCpusLocked).to.equal(0);
    });

    it('should handle tier error gracefully', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      generalService.nodeTier.restore();
      sinon.stub(generalService, 'nodeTier').rejects(new Error('Tier error'));

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 3,
          tiered: true,
          cpu: 1,
          ram: 2000,
          hdd: 25,
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.appsResources(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      // Should use fallback values
      expect(response.data.appsCpusLocked).to.equal(1);
    });

    it('should handle database errors', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(dbHelper, 'databaseConnection').throws(new Error('Database connection error'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await resourceQueryService.appsResources(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should include filesystem overhead for each app/component', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 4,
          compose: [
            {
              name: 'Component1', cpu: 1, ram: 2000, hdd: 10,
            },
            {
              name: 'Component2', cpu: 1, ram: 2000, hdd: 10,
            },
          ],
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.appsResources(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];

      // Base HDD (20) + 2 * (filesystem overhead + swap) = 20 + 2*7 = 34
      const expectedMinHdd = 20 + (2 * (config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap));
      expect(response.data.appsHddLocked).to.equal(expectedMinHdd);
    });

    it('should handle missing cpu/ram/hdd values', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 3,
          tiered: false,
          // Missing cpu, ram, hdd
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await resourceQueryService.appsResources(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.appsCpusLocked).to.equal(0);
      expect(response.data.appsRamLocked).to.equal(0);
    });
  });
});
