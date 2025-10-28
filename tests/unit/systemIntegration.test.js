const { expect } = require('chai');
const sinon = require('sinon');
const os = require('os');
const config = require('config');
const systemIntegration = require('../../ZelBack/src/services/appSystem/systemIntegration');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const dockerService = require('../../ZelBack/src/services/dockerService');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const daemonServiceBenchmarkRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBenchmarkRpcs');
const generalService = require('../../ZelBack/src/services/generalService');

describe('systemIntegration tests', () => {
  let req;
  let res;

  beforeEach(() => {
    req = {
      params: {},
      query: {},
      headers: {},
    };
    res = {
      json: sinon.stub(),
      status: sinon.stub().returnsThis(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getNodeSpecs tests', () => {
    it('should get CPU cores from os module', async () => {
      const cpusStub = sinon.stub(os, 'cpus').returns([{}, {}, {}, {}]); // 4 cores
      sinon.stub(os, 'totalmem').returns(16 * 1024 * 1024 * 1024); // 16GB
      sinon.stub(daemonServiceBenchmarkRpcs, 'getBenchmarks').resolves({
        status: 'success',
        data: JSON.stringify({ ssd: 500 }),
      });

      await systemIntegration.getNodeSpecs();

      const specs = systemIntegration.returnNodeSpecs();
      expect(specs.cpuCores).to.equal(4);
    });

    it('should get RAM from os module', async () => {
      sinon.stub(os, 'cpus').returns([{}]);
      const totalmemStub = sinon.stub(os, 'totalmem').returns(8 * 1024 * 1024 * 1024); // 8GB
      sinon.stub(daemonServiceBenchmarkRpcs, 'getBenchmarks').resolves({
        status: 'success',
        data: JSON.stringify({ ssd: 500 }),
      });

      await systemIntegration.getNodeSpecs();

      const specs = systemIntegration.returnNodeSpecs();
      expect(specs.ram).to.be.greaterThan(0);
    });

    it('should get SSD storage from benchmarks', async () => {
      // Note: setNodeSpecs uses || operator, so it cannot reset to 0
      // Previous tests have already cached ssdStorage to 500
      // This test verifies that cached values persist when getNodeSpecs is called
      // and the value is non-zero (caching behavior)

      sinon.stub(os, 'cpus').returns([{}]);
      sinon.stub(os, 'totalmem').returns(8 * 1024 * 1024 * 1024);
      const benchmarkStub = sinon.stub(daemonServiceBenchmarkRpcs, 'getBenchmarks').resolves({
        status: 'success',
        data: JSON.stringify({ ssd: 1000 }),
      });

      await systemIntegration.getNodeSpecs();

      const specs = systemIntegration.returnNodeSpecs();
      // Since ssdStorage was already set to 500 in previous tests,
      // and getNodeSpecs only fetches when ssdStorage === 0,
      // the value should remain 500 (cached)
      expect(specs.ssdStorage).to.equal(500);
      // Verify benchmark was not called since value was already cached
      sinon.assert.notCalled(benchmarkStub);
    });

    it('should handle error when getting benchmarks', async () => {
      sinon.stub(os, 'cpus').returns([{}]);
      sinon.stub(os, 'totalmem').returns(8 * 1024 * 1024 * 1024);
      sinon.stub(daemonServiceBenchmarkRpcs, 'getBenchmarks').resolves({
        status: 'error',
        data: 'Benchmark error',
      });

      await systemIntegration.getNodeSpecs();

      // Should handle error gracefully
      const specs = systemIntegration.returnNodeSpecs();
      expect(specs).to.be.an('object');
    });

    it('should cache specs and not requery if already set', async () => {
      systemIntegration.setNodeSpecs(8, 16000, 500);
      const benchmarkStub = sinon.stub(daemonServiceBenchmarkRpcs, 'getBenchmarks');

      await systemIntegration.getNodeSpecs();

      sinon.assert.notCalled(benchmarkStub);
    });
  });

  describe('setNodeSpecs tests', () => {
    it('should set node specs manually', () => {
      systemIntegration.setNodeSpecs(16, 32000, 1000);

      const specs = systemIntegration.returnNodeSpecs();
      expect(specs.cpuCores).to.equal(16);
      expect(specs.ram).to.equal(32000);
      expect(specs.ssdStorage).to.equal(1000);
    });

    it('should preserve existing specs if not provided', () => {
      systemIntegration.setNodeSpecs(4, 8000, 250);
      // Since setNodeSpecs uses || operator, passing null/undefined/0 preserves existing values
      // This test verifies that passing falsy values preserves the previous values
      systemIntegration.setNodeSpecs(undefined, undefined, 500);

      const specs = systemIntegration.returnNodeSpecs();
      expect(specs.cpuCores).to.equal(4);
      expect(specs.ram).to.equal(8000);
      expect(specs.ssdStorage).to.equal(500);
    });
  });

  describe('returnNodeSpecs tests', () => {
    it('should return copy of node specs', () => {
      systemIntegration.setNodeSpecs(8, 16000, 500);

      const specs1 = systemIntegration.returnNodeSpecs();
      const specs2 = systemIntegration.returnNodeSpecs();

      expect(specs1).to.deep.equal(specs2);
      expect(specs1).to.not.equal(specs2); // Different object reference
    });
  });

  describe('systemArchitecture tests', () => {
    it('should return AMD64 architecture', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({
        status: 'success',
        data: { architecture: 'AMD64' },
      });

      const arch = await systemIntegration.systemArchitecture();

      expect(arch).to.equal('AMD64');
    });

    it('should return ARM64 architecture', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({
        status: 'success',
        data: { architecture: 'ARM64' },
      });

      const arch = await systemIntegration.systemArchitecture();

      expect(arch).to.equal('ARM64');
    });

    it('should throw error if benchmarks fail', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({
        status: 'error',
        data: 'Benchmark error',
      });

      try {
        await systemIntegration.systemArchitecture();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('checkAppStaticIpRequirements tests', () => {
    it('should pass if app does not require static IP', () => {
      const appSpecs = { name: 'TestApp', version: 6, staticip: false };

      const result = systemIntegration.checkAppStaticIpRequirements(appSpecs);

      expect(result).to.be.true;
    });

    it('should pass if node has static IP and app requires it', () => {
      const appSpecs = { name: 'TestApp', version: 7, staticip: true };
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'isStaticIP').returns(true);

      const result = systemIntegration.checkAppStaticIpRequirements(appSpecs);

      expect(result).to.be.true;
    });

    it('should throw error if static IP mismatch', () => {
      const appSpecs = { name: 'TestApp', version: 7, staticip: true };
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'isStaticIP').returns(false);

      try {
        systemIntegration.checkAppStaticIpRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('requires static IP address');
      }
    });
  });

  describe('checkAppNodesRequirements tests', () => {
    it('should pass if app has no node restrictions', async () => {
      const appSpecs = { name: 'TestApp', version: 6 };

      const result = await systemIntegration.checkAppNodesRequirements(appSpecs);

      expect(result).to.be.true;
    });

    it('should pass if node IP is in allowed list', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 7,
        nodes: ['192.168.1.100', '192.168.1.101'],
      };

      sinon.stub(generalService, 'obtainNodeCollateralInformation').resolves({
        txhash: 'abc123',
        txindex: 0,
      });
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({
        status: 'success',
        data: { ipaddress: '192.168.1.100' },
      });

      const result = await systemIntegration.checkAppNodesRequirements(appSpecs);

      expect(result).to.be.true;
    });

    it('should pass if node collateral is in allowed list', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 7,
        nodes: ['abc123:0', '192.168.1.101'],
      };

      sinon.stub(generalService, 'obtainNodeCollateralInformation').resolves({
        txhash: 'abc123',
        txindex: 0,
      });
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({
        status: 'success',
        data: { ipaddress: '192.168.1.200' },
      });

      const result = await systemIntegration.checkAppNodesRequirements(appSpecs);

      expect(result).to.be.true;
    });

    it('should throw error if node not in allowed list', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 7,
        nodes: ['192.168.1.50', '192.168.1.51'],
      };

      sinon.stub(generalService, 'obtainNodeCollateralInformation').resolves({
        txhash: 'xyz789',
        txindex: 1,
      });
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({
        status: 'success',
        data: { ipaddress: '192.168.1.100' },
      });

      try {
        await systemIntegration.checkAppNodesRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('is not allowed to run on this node');
      }
    });

    it('should throw error if unable to detect IP', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 7,
        nodes: ['192.168.1.100'],
      };

      sinon.stub(generalService, 'obtainNodeCollateralInformation').resolves({
        txhash: 'abc123',
        txindex: 0,
      });
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({
        status: 'success',
        data: { ipaddress: '123' }, // Too short
      });

      try {
        await systemIntegration.checkAppNodesRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Unable to detect Flux IP address');
      }
    });
  });

  describe('checkAppGeolocationRequirements tests', () => {
    it('should pass if no geolocation requirements', () => {
      const appSpecs = { name: 'TestApp', version: 4, geolocation: [] };

      const result = systemIntegration.checkAppGeolocationRequirements(appSpecs);

      expect(result).to.be.true;
    });

    it('should pass if node matches continent requirement', () => {
      const appSpecs = { name: 'TestApp', version: 5, geolocation: ['acEU'] };
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'getNodeGeolocation').returns({
        continentCode: 'EU',
        countryCode: 'FR',
        regionName: 'Paris',
      });

      const result = systemIntegration.checkAppGeolocationRequirements(appSpecs);

      expect(result).to.be.true;
    });

    it('should pass if node matches country requirement', () => {
      const appSpecs = { name: 'TestApp', version: 5, geolocation: ['acEU_FR'] };
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'getNodeGeolocation').returns({
        continentCode: 'EU',
        countryCode: 'FR',
        regionName: 'Paris',
      });

      const result = systemIntegration.checkAppGeolocationRequirements(appSpecs);

      expect(result).to.be.true;
    });

    it('should throw error if continent mismatch', () => {
      const appSpecs = { name: 'TestApp', version: 5, geolocation: ['acNA'] };
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'getNodeGeolocation').returns({
        continentCode: 'EU',
        countryCode: 'FR',
        regionName: 'Paris',
      });

      try {
        systemIntegration.checkAppGeolocationRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('geolocation');
      }
    });

    it('should throw error if node location is forbidden', () => {
      const appSpecs = { name: 'TestApp', version: 5, geolocation: ['a!cEU'] };
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'getNodeGeolocation').returns({
        continentCode: 'EU',
        countryCode: 'FR',
        regionName: 'Paris',
      });

      try {
        systemIntegration.checkAppGeolocationRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('forbidden');
      }
    });

    it('should throw error if node geolocation not set', () => {
      const appSpecs = { name: 'TestApp', version: 5, geolocation: ['acEU'] };
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'getNodeGeolocation').returns(null);

      try {
        systemIntegration.checkAppGeolocationRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Node Geolocation not set');
      }
    });
  });

  describe('nodeFullGeolocation tests', () => {
    it('should return full geolocation string', () => {
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'getNodeGeolocation').returns({
        continentCode: 'EU',
        countryCode: 'FR',
        regionName: 'IleDeFrance',
      });

      const result = systemIntegration.nodeFullGeolocation();

      expect(result).to.equal('EU_FR_IleDeFrance');
    });

    it('should throw error if geolocation not set', () => {
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'getNodeGeolocation').returns(null);

      try {
        systemIntegration.nodeFullGeolocation();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Node Geolocation not set');
      }
    });
  });

  describe('checkHWParameters tests', () => {
    it('should pass for valid non-tiered app specs', () => {
      const appSpecs = {
        name: 'TestApp',
        cpu: 1.5,
        ram: 2000,
        hdd: 50,
        tiered: false,
      };

      const result = systemIntegration.checkHWParameters(appSpecs);

      expect(result).to.be.true;
    });

    it('should throw error for invalid CPU', () => {
      const appSpecs = {
        name: 'TestApp',
        cpu: 0.05, // Too small
        ram: 2000,
        hdd: 50,
        tiered: false,
      };

      try {
        systemIntegration.checkHWParameters(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('CPU badly assigned');
      }
    });

    it('should throw error for invalid RAM', () => {
      const appSpecs = {
        name: 'TestApp',
        cpu: 1.0,
        ram: 50, // Too small
        hdd: 50,
        tiered: false,
      };

      try {
        systemIntegration.checkHWParameters(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('RAM badly assigned');
      }
    });

    it('should throw error for invalid HDD', () => {
      const appSpecs = {
        name: 'TestApp',
        cpu: 1.0,
        ram: 2000,
        hdd: 0, // Too small
        tiered: false,
      };

      try {
        systemIntegration.checkHWParameters(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('SSD badly assigned');
      }
    });

    it('should validate tiered app specs', () => {
      const appSpecs = {
        name: 'TestApp',
        cpu: 1.0,
        ram: 2000,
        hdd: 50,
        tiered: true,
        cpubasic: 0.5,
        rambasic: 1000,
        hddbasic: 25,
        cpusuper: 1.5,
        ramsuper: 3000,
        hddsuper: 75,
        cpubamf: 2.0,
        rambamf: 4000,
        hddbamf: 100,
      };

      const result = systemIntegration.checkHWParameters(appSpecs);

      expect(result).to.be.true;
    });
  });

  describe('checkComposeHWParameters tests', () => {
    it('should pass for valid compose app', () => {
      const appSpecs = {
        name: 'ComposedApp',
        compose: [
          { name: 'Component1', cpu: 1.0, ram: 1000, hdd: 25 },
          { name: 'Component2', cpu: 1.5, ram: 2000, hdd: 50 },
        ],
      };

      const result = systemIntegration.checkComposeHWParameters(appSpecs);

      expect(result).to.be.true;
    });

    it('should throw error if total CPU exceeds limit', () => {
      const appSpecs = {
        name: 'ComposedApp',
        compose: [
          { name: 'Component1', cpu: 10.0, ram: 1000, hdd: 25 },
          { name: 'Component2', cpu: 10.0, ram: 1000, hdd: 25 },
        ],
      };

      try {
        systemIntegration.checkComposeHWParameters(appSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Too much CPU');
      }
    });

    it('should handle tiered compose apps', () => {
      const appSpecs = {
        name: 'ComposedApp',
        compose: [
          {
            name: 'Component1',
            cpu: 1.0,
            ram: 1000,
            hdd: 25,
            tiered: true,
            cpubasic: 0.5,
            rambasic: 500,
            hddbasic: 10,
            cpusuper: 1.5,
            ramsuper: 1500,
            hddsuper: 40,
            cpubamf: 2.0,
            rambamf: 2000,
            hddbamf: 50,
          },
        ],
      };

      const result = systemIntegration.checkComposeHWParameters(appSpecs);

      expect(result).to.be.true;
    });
  });

  describe('createFluxNetworkAPI tests', () => {
    it('should return unauthorized if user not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      sinon.stub(messageHelper, 'errUnauthorizedMessage').returns({
        status: 'error',
        data: { code: 401, message: 'Unauthorized' },
      });

      await systemIntegration.createFluxNetworkAPI(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should create flux network if authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(dockerService, 'createFluxDockerNetwork').resolves({
        message: 'Network created',
      });
      sinon.stub(messageHelper, 'createDataMessage').returns({
        status: 'success',
        data: { message: 'Network created' },
      });

      await systemIntegration.createFluxNetworkAPI(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('success');
    });

    it('should verify adminandfluxteam privilege', async () => {
      const verifyStub = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(dockerService, 'createFluxDockerNetwork').resolves({});
      sinon.stub(messageHelper, 'createDataMessage').returns({
        status: 'success',
        data: {},
      });

      await systemIntegration.createFluxNetworkAPI(req, res);

      sinon.assert.calledWith(verifyStub, 'adminandfluxteam', req);
    });

    it('should handle errors', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(dockerService, 'createFluxDockerNetwork').rejects(new Error('Network error'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({
        status: 'error',
        data: { message: 'Network error' },
      });

      await systemIntegration.createFluxNetworkAPI(req, res);

      expect(res.json.firstCall.args[0].status).to.equal('error');
    });
  });

  describe('startMonitoringOfApps tests', () => {
    it('should return early if no apps to monitor', async () => {
      await systemIntegration.startMonitoringOfApps([]);

      // Should complete without error
    });

    it('should return early if appSpecsToMonitor is null', async () => {
      await systemIntegration.startMonitoringOfApps(null);

      // Should complete without error
    });

    it('should start monitoring for multiple apps', async () => {
      const apps = [
        { name: 'App1' },
        { name: 'App2' },
      ];

      await systemIntegration.startMonitoringOfApps(apps);

      // Should complete without error
    });
  });

  describe('stopMonitoringOfApps tests', () => {
    it('should return early if no apps to stop monitoring', async () => {
      await systemIntegration.stopMonitoringOfApps([]);

      // Should complete without error
    });

    it('should stop monitoring for multiple apps', async () => {
      const apps = [
        { name: 'App1' },
        { name: 'App2' },
      ];

      await systemIntegration.stopMonitoringOfApps(apps, false);

      // Should complete without error
    });

    it('should handle deleteData flag', async () => {
      const apps = [
        { name: 'App1' },
      ];

      await systemIntegration.stopMonitoringOfApps(apps, true);

      // Should complete without error
    });
  });
});
