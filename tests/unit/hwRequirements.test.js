const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('hwRequirements tests', () => {
  let hwRequirements;
  let serviceHelperStub;
  let logStub;

  beforeEach(() => {
    serviceHelperStub = {
      ensureNumber: sinon.stub().returnsArg(0),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    hwRequirements = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
      '../serviceHelper': serviceHelperStub,
      '../benchmarkService': {
        getBenchmarks: sinon.stub().resolves({
          status: 'success',
          data: {
            cpucores: 4,
            ram: 8000,
            ssd: 100,
          },
        }),
      },
      '../generalService': {
        nodeTier: sinon.stub().resolves('cumulus'),
      },
      '../geolocationService': {
        isStaticIP: sinon.stub().returns(true),
        getNodeGeolocation: sinon.stub().returns('US-NY'),
      },
      '../fluxNetworkHelper': {
        getFluxNodeCount: sinon.stub().resolves(1000),
      },
      '../appDatabase/registryManager': {
        availableApps: sinon.stub().resolves([]),
      },
      '../appQuery/appQueryService': {
        installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
      },
      '../../lib/log': logStub,
      config: {
        fluxSpecifics: {
          cpu: {
            cumulus: 2,
            nimbus: 4,
            stratus: 8,
          },
          ram: {
            cumulus: 4000,
            nimbus: 8000,
            stratus: 16000,
          },
          hdd: {
            cumulus: 220,
            nimbus: 440,
            stratus: 880,
          },
        },
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('totalAppHWRequirements', () => {
    it('should calculate total hardware requirements for simple app', () => {
      const appSpecs = {
        name: 'testapp',
        version: 3,
        cpu: 1,
        ram: 1000,
        hdd: 10,
      };

      const result = hwRequirements.totalAppHWRequirements(appSpecs, 'cumulus');

      expect(result).to.have.property('cpu');
      expect(result).to.have.property('ram');
      expect(result).to.have.property('hdd');
      expect(result.cpu).to.equal(1);
      expect(result.ram).to.equal(1000);
      expect(result.hdd).to.equal(10);
    });

    it('should calculate total hardware requirements for v4+ app with compose', () => {
      const appSpecs = {
        name: 'testapp',
        version: 4,
        compose: [
          {
            name: 'component1', cpu: 0.5, ram: 500, hdd: 5,
          },
          {
            name: 'component2', cpu: 0.5, ram: 500, hdd: 5,
          },
        ],
      };

      const result = hwRequirements.totalAppHWRequirements(appSpecs, 'cumulus');

      expect(result.cpu).to.equal(1);
      expect(result.ram).to.equal(1000);
      expect(result.hdd).to.equal(10);
    });

    it('should return hw requirements for an app, version 2', () => {
      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 2,
      };
      const myNodeTier = 'stratus';

      const result = hwRequirements.totalAppHWRequirements(appSpecs, myNodeTier);

      expect(result).to.deep.equal({ cpu: 256000, ram: 50, hdd: 100 });
    });

    it('should return hw requirements for an app, version 3', () => {
      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 3,
      };
      const myNodeTier = 'stratus';

      const result = hwRequirements.totalAppHWRequirements(appSpecs, myNodeTier);

      expect(result).to.deep.equal({ cpu: 256000, ram: 50, hdd: 100 });
    });

    it('should return hw requirements for an app, version 4', () => {
      const appSpecs = {
        version: 4,
        compose: [
          {
            tiered: false,
            cpu: 256000,
            hdd: 100,
            ram: 50,
          },
          {
            tiered: true,
            cpu: 256000,
            hdd: 100,
            ram: 50,
          },
          {
            tiered: true,
            cpu: 256000,
            hdd: 100,
            ram: 50,
          },
        ],
      };
      const myNodeTier = 'stratus';

      const result = hwRequirements.totalAppHWRequirements(appSpecs, myNodeTier);

      expect(result).to.deep.equal({ cpu: 768000, ram: 150, hdd: 300 });
    });
  });

  describe('checkAppStaticIpRequirements', () => {
    it('should pass when app does not require static IP', () => {
      const appSpecs = {
        name: 'testapp',
        staticip: false,
      };

      // Should not throw
      hwRequirements.checkAppStaticIpRequirements(appSpecs);
    });

    it('should pass when node has static IP and app requires it', () => {
      const appSpecs = {
        name: 'testapp',
        staticip: true,
      };

      // Should not throw
      hwRequirements.checkAppStaticIpRequirements(appSpecs);
    });
  });

  describe('checkAppGeolocationRequirements', () => {
    it('should pass when app has no geolocation restrictions', async () => {
      const appSpecs = {
        name: 'testapp',
        geolocation: [],
      };

      // Should not throw
      await hwRequirements.checkAppGeolocationRequirements(appSpecs);
    });

    it('should throw if geolocation returns undefined', async () => {
      const hwRequirementsWithUndefinedGeo = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              cpucores: 4,
              ram: 8000,
              ssd: 100,
            },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().resolves(undefined),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
        },
        '../../lib/log': logStub,
        config: {
          fluxSpecifics: {
            cpu: {
              cumulus: 2,
              nimbus: 4,
              stratus: 8,
            },
            ram: {
              cumulus: 4000,
              nimbus: 8000,
              stratus: 16000,
            },
            hdd: {
              cumulus: 220,
              nimbus: 440,
              stratus: 880,
            },
          },
        },
      });

      const appSpec = {
        version: 5,
        geolocation: ['acEU'],
      };

      try {
        await hwRequirementsWithUndefinedGeo.checkAppGeolocationRequirements(appSpec);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it('should return true if app ver < 5', async () => {
      const appSpec = {
        version: 4,
      };

      const result = await hwRequirements.checkAppGeolocationRequirements(appSpec);

      expect(result).to.equal(true);
    });

    it('should return true if geolocation matches', async () => {
      const hwRequirementsWithMatchingGeo = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              cpucores: 4,
              ram: 8000,
              ssd: 100,
            },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().resolves({
            continentCode: 'EU',
            countryCode: 'CZ',
            regionName: 'PRG',
          }),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
        },
        '../../lib/log': logStub,
        config: {
          fluxSpecifics: {
            cpu: {
              cumulus: 2,
              nimbus: 4,
              stratus: 8,
            },
            ram: {
              cumulus: 4000,
              nimbus: 8000,
              stratus: 16000,
            },
            hdd: {
              cumulus: 220,
              nimbus: 440,
              stratus: 880,
            },
          },
        },
      });

      const appSpec = {
        version: 5,
        geolocation: ['acEU_CZ_PRG'],
      };

      const result = await hwRequirementsWithMatchingGeo.checkAppGeolocationRequirements(appSpec);

      expect(result).to.equal(true);
    });

    it('should throw if geolocation is forbidden', async () => {
      const hwRequirementsWithForbiddenGeo = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              cpucores: 4,
              ram: 8000,
              ssd: 100,
            },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().resolves({
            continentCode: 'EU',
            countryCode: 'CZ',
            regionName: 'PRG',
          }),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
        },
        '../../lib/log': logStub,
        config: {
          fluxSpecifics: {
            cpu: {
              cumulus: 2,
              nimbus: 4,
              stratus: 8,
            },
            ram: {
              cumulus: 4000,
              nimbus: 8000,
              stratus: 16000,
            },
            hdd: {
              cumulus: 220,
              nimbus: 440,
              stratus: 880,
            },
          },
        },
      });

      const appSpec = {
        version: 5,
        geolocation: ['a!cEU_CZ_PRG'],
      };

      try {
        await hwRequirementsWithForbiddenGeo.checkAppGeolocationRequirements(appSpec);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it('should throw if geolocation is not matching', async () => {
      const hwRequirementsWithNonMatchingGeo = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              cpucores: 4,
              ram: 8000,
              ssd: 100,
            },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().resolves({
            continentCode: 'EU',
            countryCode: 'CZ',
            regionName: 'PRG',
          }),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
        },
        '../../lib/log': logStub,
        config: {
          fluxSpecifics: {
            cpu: {
              cumulus: 2,
              nimbus: 4,
              stratus: 8,
            },
            ram: {
              cumulus: 4000,
              nimbus: 8000,
              stratus: 16000,
            },
            hdd: {
              cumulus: 220,
              nimbus: 440,
              stratus: 880,
            },
          },
        },
      });

      const appSpec = {
        version: 5,
        geolocation: ['acEU_PL_GDA'],
      };

      try {
        await hwRequirementsWithNonMatchingGeo.checkAppGeolocationRequirements(appSpec);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('checkAppHWRequirements tests', () => {
    it('should throw error if there would be insufficient space on node for the app - 0 on the node', async () => {
      const hwRequirementsWithResources = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              cpucores: 0,
              ram: 0,
              ssd: 0,
            },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().returns('US-NY'),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
        },
        '../appQuery/resourceQueryService': {
          appsResources: sinon.stub().resolves({
            status: 'success',
            data: { appsCpusLocked: 0, appsRamLocked: 0, appsHddLocked: 0 },
          }),
        },
        '../../lib/log': logStub,
        os: {
          cpus: sinon.stub().returns(new Array(4)),
          totalmem: sinon.stub().returns(8000 * 1024 * 1024),
        },
        config: {
          fluxSpecifics: {
            cpu: {
              cumulus: 2,
              nimbus: 4,
              stratus: 8,
            },
            ram: {
              cumulus: 4000,
              nimbus: 8000,
              stratus: 16000,
            },
            hdd: {
              cumulus: 220,
              nimbus: 440,
              stratus: 880,
            },
          },
          lockedSystemResources: {
            cpu: 0,
            ram: 0,
            hdd: 0,
            extrahdd: 0,
          },
        },
      });

      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 3,
      };

      try {
        await hwRequirementsWithResources.checkAppHWRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Insufficient');
      }
    });

    it('should throw error if there would be insufficient space on node for the app', async () => {
      const hwRequirementsWithLimitedSpace = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              cpucores: 10,
              ram: 20,
              ssd: 90,
            },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().returns('US-NY'),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({
            status: 'success',
            data: [
              {
                version: 3,
                tiered: true,
                cpu: 1000,
                ram: 256000,
                hdd: 100000,
                cpucumulus: 2000,
                ramcumulus: 100000,
                hddcumulus: 200000,
              },
            ],
          }),
        },
        '../appQuery/resourceQueryService': {
          appsResources: sinon.stub().resolves({
            status: 'success',
            data: {
              appsCpusLocked: 0,
              appsRamLocked: 0,
              appsHddLocked: 0,
            },
          }),
        },
        '../../lib/log': logStub,
        os: {
          cpus: sinon.stub().returns(new Array(4)),
          totalmem: sinon.stub().returns(8000 * 1024 * 1024),
        },
        config: {
          fluxSpecifics: {
            cpu: {
              cumulus: 2,
              nimbus: 4,
              stratus: 8,
            },
            ram: {
              cumulus: 4000,
              nimbus: 8000,
              stratus: 16000,
            },
            hdd: {
              cumulus: 220,
              nimbus: 440,
              stratus: 880,
            },
          },
          lockedSystemResources: {
            cpu: 0,
            ram: 0,
            hdd: 0,
            extrahdd: 0,
          },
        },
      });

      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 3,
      };

      try {
        await hwRequirementsWithLimitedSpace.checkAppHWRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Insufficient');
      }
    });

    it('should throw error if there would be insufficient cpu power on node for the app', async () => {
      const hwRequirementsWithLimitedCpu = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              cpucores: 10,
              ram: 20,
              ssd: 2000000,
            },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().returns('US-NY'),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({
            status: 'success',
            data: [
              {
                version: 3,
                tiered: true,
                cpu: 1000,
                ram: 256000,
                hdd: 100000,
                cpucumulus: 2000,
                ramcumulus: 100000,
                hddcumulus: 200000,
              },
            ],
          }),
        },
        '../appQuery/resourceQueryService': {
          appsResources: sinon.stub().resolves({
            status: 'success',
            data: {
              appsCpusLocked: 0,
              appsRamLocked: 0,
              appsHddLocked: 0,
            },
          }),
        },
        '../../lib/log': logStub,
        os: {
          cpus: sinon.stub().returns(new Array(4)),
          totalmem: sinon.stub().returns(8000 * 1024 * 1024),
        },
        config: {
          fluxSpecifics: {
            cpu: {
              cumulus: 2,
              nimbus: 4,
              stratus: 8,
            },
            ram: {
              cumulus: 4000,
              nimbus: 8000,
              stratus: 16000,
            },
            hdd: {
              cumulus: 220,
              nimbus: 440,
              stratus: 880,
            },
          },
          lockedSystemResources: {
            cpu: 0,
            ram: 0,
            hdd: 0,
            extrahdd: 0,
          },
        },
      });

      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 3,
      };

      try {
        await hwRequirementsWithLimitedCpu.checkAppHWRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Insufficient');
      }
    });

    it('should throw error if there would be insufficient ram on node for the app', async () => {
      const hwRequirementsWithLimitedRam = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              cpucores: 10000,
              ram: 50,
              ssd: 2000000,
            },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().returns('US-NY'),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({
            status: 'success',
            data: [
              {
                version: 3,
                tiered: true,
                cpu: 1000,
                ram: 256000,
                hdd: 100000,
                cpucumulus: 2000,
                ramcumulus: 100000,
                hddcumulus: 200000,
              },
            ],
          }),
        },
        '../appQuery/resourceQueryService': {
          appsResources: sinon.stub().resolves({
            status: 'success',
            data: {
              appsCpusLocked: 0,
              appsRamLocked: 0,
              appsHddLocked: 0,
            },
          }),
        },
        '../../lib/log': logStub,
        os: {
          cpus: sinon.stub().returns(new Array(4)),
          totalmem: sinon.stub().returns(8000 * 1024 * 1024),
        },
        config: {
          fluxSpecifics: {
            cpu: {
              cumulus: 2,
              nimbus: 4,
              stratus: 8,
            },
            ram: {
              cumulus: 4000,
              nimbus: 8000,
              stratus: 16000,
            },
            hdd: {
              cumulus: 220,
              nimbus: 440,
              stratus: 880,
            },
          },
          lockedSystemResources: {
            cpu: 0,
            ram: 0,
            hdd: 0,
            extrahdd: 0,
          },
        },
      });

      const appSpecs = {
        cpu: 4000,
        hdd: 100,
        ram: 50,
        version: 3,
      };

      try {
        await hwRequirementsWithLimitedRam.checkAppHWRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Insufficient');
      }
    });

    it('should return true if all reqs are met', async () => {
      const hwRequirementsWithGoodResources = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              cpucores: 10000,
              ram: 256000,
              ssd: 2000000,
            },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().returns('US-NY'),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({
            status: 'success',
            data: [],
          }),
        },
        '../appQuery/resourceQueryService': {
          appsResources: sinon.stub().resolves({
            status: 'success',
            data: {
              appsCpusLocked: 0,
              appsRamLocked: 0,
              appsHddLocked: 0,
            },
          }),
        },
        '../../lib/log': logStub,
        os: {
          cpus: sinon.stub().returns(new Array(4)),
          totalmem: sinon.stub().returns(8000 * 1024 * 1024),
        },
        config: {
          fluxSpecifics: {
            cpu: {
              cumulus: 2,
              nimbus: 4,
              stratus: 8,
            },
            ram: {
              cumulus: 4000,
              nimbus: 8000,
              stratus: 16000,
            },
            hdd: {
              cumulus: 220,
              nimbus: 440,
              stratus: 880,
            },
          },
          lockedSystemResources: {
            cpu: 0,
            ram: 0,
            hdd: 0,
            extrahdd: 0,
          },
        },
      });

      const appSpecs = {
        cpu: 0.5,
        hdd: 100,
        ram: 50,
        version: 3,
      };

      const result = await hwRequirementsWithGoodResources.checkAppHWRequirements(appSpecs);

      expect(result).to.equal(true);
    });
  });

  describe('checkAppCpuBurstHeadroom tests', () => {
    // Build a fresh hwRequirements module with plugable cpu/lock/app values.
    // Formula: freeCoresAfterInstall = cpuCores - lockedSystemResources.cpu/10
    //   - appsCpusLocked - appHWrequirements.cpu
    // Throws when freeCoresAfterInstall <= 4.
    function buildHw({ cpucores, appsCpusLocked, lockedCpuTenths = 10, appsResourcesStatus = 'success' }) {
      return proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../serviceHelper': serviceHelperStub,
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: { cpucores, ram: 8000, ssd: 1000 },
          }),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('stratus'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
          getNodeGeolocation: sinon.stub().returns('US-NY'),
        },
        '../fluxNetworkHelper': {
          getFluxNodeCount: sinon.stub().resolves(1000),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
        },
        '../appQuery/resourceQueryService': {
          appsResources: sinon.stub().resolves({
            status: appsResourcesStatus,
            data: { appsCpusLocked, appsRamLocked: 0, appsHddLocked: 0 },
          }),
        },
        '../../lib/log': logStub,
        os: {
          cpus: sinon.stub().returns(new Array(cpucores)),
          totalmem: sinon.stub().returns(8000 * 1024 * 1024),
        },
        config: {
          fluxSpecifics: {
            cpu: { cumulus: 2, nimbus: 4, stratus: 8 },
            ram: { cumulus: 4000, nimbus: 8000, stratus: 16000 },
            hdd: { cumulus: 220, nimbus: 440, stratus: 880 },
          },
          lockedSystemResources: {
            cpu: lockedCpuTenths, ram: 0, hdd: 0, extrahdd: 0,
          },
        },
      });
    }

    it('passes when remaining free cores after install are > 4', async () => {
      // 16 cores - 1 (system) - 3 (locked) - 2 (this app) = 10 > 4 → ok
      const hw = buildHw({ cpucores: 16, appsCpusLocked: 3 });
      const result = await hw.checkAppCpuBurstHeadroom({ version: 3, cpu: 2, ram: 10, hdd: 10 });
      expect(result).to.equal(true);
    });

    it('throws when remaining free cores would be exactly 4 (boundary)', async () => {
      // 10 cores - 1 - 3 - 2 = 4 → throw (rule is strict <=)
      const hw = buildHw({ cpucores: 10, appsCpusLocked: 3 });
      try {
        await hw.checkAppCpuBurstHeadroom({ version: 3, cpu: 2, ram: 10, hdd: 10 });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('CPU burst headroom');
      }
    });

    it('passes at 5 free cores (just above the boundary)', async () => {
      // 10 cores - 1 - 3 - 1 = 5 > 4 → ok
      const hw = buildHw({ cpucores: 10, appsCpusLocked: 3 });
      const result = await hw.checkAppCpuBurstHeadroom({ version: 3, cpu: 1, ram: 10, hdd: 10 });
      expect(result).to.equal(true);
    });

    it('throws when remaining free cores would be negative (over-subscribed)', async () => {
      // 8 cores - 1 - 5 - 4 = -2 → throw
      const hw = buildHw({ cpucores: 8, appsCpusLocked: 5 });
      try {
        await hw.checkAppCpuBurstHeadroom({ version: 3, cpu: 4, ram: 10, hdd: 10 });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('CPU burst headroom');
      }
    });

    it('throws when appsResources cannot be read', async () => {
      const hw = buildHw({ cpucores: 16, appsCpusLocked: 0, appsResourcesStatus: 'error' });
      try {
        await hw.checkAppCpuBurstHeadroom({ version: 3, cpu: 1, ram: 10, hdd: 10 });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('locked system resources');
      }
    });

    it('sums cpu across compose components for v4+ apps', async () => {
      // 10 cores - 1 - 0 - (3+3) = 0 → throw (compose summed)
      const hw = buildHw({ cpucores: 10, appsCpusLocked: 0 });
      const appSpecs = {
        version: 4,
        compose: [
          { name: 'c1', cpu: 3, ram: 10, hdd: 10 },
          { name: 'c2', cpu: 3, ram: 10, hdd: 10 },
        ],
      };
      try {
        await hw.checkAppCpuBurstHeadroom(appSpecs);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('CPU burst headroom');
      }
    });
  });

  describe('checkAppGeolocationRequirements with table-vocabulary regions', () => {
    const geoNode = {
      ip: '203.0.113.10', continentCode: 'EU', countryCode: 'FI', regionName: 'Uusimaa',
    };

    // vocabulary defaults to empty: a node holding no region-name vocabulary is
    // the state every node is in until a baseline carrying one arrives
    function gateWith(lookupResult, regionNames = {}) {
      return proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
        '../geolocationService': { getNodeGeolocation: sinon.stub().resolves(geoNode) },
        '../appPlacement/ipLocationStore': {
          lookup: lookupResult instanceof Error
            ? sinon.stub().rejects(lookupResult)
            : sinon.stub().resolves(lookupResult),
          regionCodeForName: (cc, name) => regionNames[`${cc}|${name}`] ?? null,
          isStoreUnavailable: () => false,
        },
      });
    }

    const inRegion = {
      org: 'aabbccddeeff', countryCode: 'FI', continentCode: 'EU', region: 'FI-18',
    };
    const otherRegion = { ...inRegion, region: 'FI-11' };
    const regionUnknown = { ...inRegion, region: null };

    // Bavaria is DE-BY, and until the artifact carries that a node cannot know
    // it. The vocabulary is what lets an entry written the way ip-api names
    // regions be answered at region granularity instead of country.
    const finnishNames = { 'FI|Uusimaa': 'FI-18', 'FI|Pirkanmaa': 'FI-11' };

    it('resolves a named region allow through the vocabulary', async () => {
      const ok = await gateWith(inRegion, finnishNames)
        .checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_Uusimaa'] });
      expect(ok).to.equal(true);
    });

    it('refuses a named region allow the table places elsewhere', async () => {
      // the node calls itself Uusimaa; the table puts its address in FI-11
      await gateWith(otherRegion, finnishNames)
        .checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_Uusimaa'] })
        .then(() => { throw new Error('expected rejection'); }, (err) => {
          expect(err.message).to.include('not matching');
        });
    });

    it('applies a named region deny through the vocabulary', async () => {
      await gateWith(inRegion, finnishNames)
        .checkAppGeolocationRequirements({ version: 7, geolocation: ['a!cEU_FI_Uusimaa'] })
        .then(() => { throw new Error('expected rejection'); }, (err) => {
          expect(err.message).to.include('forbidden');
        });
    });

    it('applies a named region deny by the self-reported name too, when the table disagrees', async () => {
      // The node calls itself Uusimaa; the table puts its address in FI-11. An
      // allow refuses here - the table is the only thing that may say yes. A DENY
      // must still catch it: the rule that makes an allow conservative makes a
      // ban permissive, and a ban is written for a reason the network cannot
      // see, so the error worth making is excluding a node that was fine.
      await gateWith(otherRegion, finnishNames)
        .checkAppGeolocationRequirements({ version: 7, geolocation: ['a!cEU_FI_Uusimaa'] })
        .then(() => { throw new Error('expected rejection'); }, (err) => {
          expect(err.message).to.include('forbidden');
        });
    });

    it('still lets the self-reported name grant nothing - it may only ever ban', async () => {
      // The same node and the same disagreement, asked the other way round: the
      // allow is refused, so the self-report cannot buy eligibility it lost.
      await gateWith(otherRegion, finnishNames)
        .checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_Uusimaa'] })
        .then(() => { throw new Error('expected rejection'); }, (err) => {
          expect(err.message).to.include('not matching');
        });
    });

    it('demands proof for a named region: an unknown table region satisfies no pin', async () => {
      await gateWith(regionUnknown, finnishNames)
        .checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_Uusimaa'] })
        .then(() => { throw new Error('expected rejection'); }, (err) => {
          expect(err.message).to.include('not matching');
        });
    });

    // the count reads the same vocabulary, so a resolved entry must be decided
    // on the table region alone - accepting it by self-reported name as well
    // would take nodes the count excluded
    it('does not fall back to the self-reported name once the vocabulary resolves', async () => {
      await gateWith(otherRegion, finnishNames)
        .checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_Uusimaa'] })
        .then(() => { throw new Error('expected rejection'); }, (err) => {
          expect(err.message).to.include('not matching');
        });
    });

    it('falls back to the self-reported name when the vocabulary cannot resolve', async () => {
      const ok = await gateWith(regionUnknown)
        .checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_Uusimaa'] });
      expect(ok).to.equal(true);
    });

    it('accepts an ISO region allow when the table places this node in it', async () => {
      const ok = await gateWith(inRegion).checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_FI-18'] });
      expect(ok).to.equal(true);
    });

    it('rejects an ISO region allow when the table places this node elsewhere', async () => {
      try {
        await gateWith(otherRegion).checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_FI-18'] });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('not matching');
      }
    });

    it('rejects an ISO region allow when its own region is unknown - a pin needs proof', async () => {
      try {
        await gateWith(regionUnknown).checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_FI-18'] });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('not matching');
      }
    });

    it('treats an unreadable store exactly like an unknown region', async () => {
      const err = new Error('iplocation store unavailable: no database connection');
      err.code = 'IPLOCATION_STORE_UNAVAILABLE';
      try {
        await gateWith(err).checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_FI-18'] });
        expect.fail('should have thrown');
      } catch (error) {
        expect(error.message).to.include('not matching');
      }
    });

    it('applies an ISO region deny only on proof', async () => {
      try {
        await gateWith(inRegion).checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU', 'a!cEU_FI_FI-18'] });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('forbidden');
      }
      const okElsewhere = await gateWith(otherRegion).checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU', 'a!cEU_FI_FI-18'] });
      expect(okElsewhere).to.equal(true);
      const okUnknown = await gateWith(regionUnknown).checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU', 'a!cEU_FI_FI-18'] });
      expect(okUnknown).to.equal(true);
    });

    it('keeps legacy name matching untouched alongside the table form', async () => {
      const ok = await gateWith(otherRegion).checkAppGeolocationRequirements({ version: 7, geolocation: ['acEU_FI_Uusimaa'] });
      expect(ok).to.equal(true);
    });
  });

  describe('exported functions', () => {
    it('should export requirement checking functions', () => {
      expect(hwRequirements.totalAppHWRequirements).to.be.a('function');
      expect(hwRequirements.checkAppHWRequirements).to.be.a('function');
      expect(hwRequirements.checkAppCpuBurstHeadroom).to.be.a('function');
      expect(hwRequirements.checkAppStaticIpRequirements).to.be.a('function');
      expect(hwRequirements.checkAppNodesRequirements).to.be.a('function');
      expect(hwRequirements.checkAppGeolocationRequirements).to.be.a('function');
    });
  });
});
