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
          { name: 'component1', cpu: 0.5, ram: 500, hdd: 5 },
          { name: 'component2', cpu: 0.5, ram: 500, hdd: 5 },
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
    it('should pass when app has no geolocation restrictions', () => {
      const appSpecs = {
        name: 'testapp',
        geolocation: [],
      };

      // Should not throw
      hwRequirements.checkAppGeolocationRequirements(appSpecs);
    });

    it('should throw if geolocation returns undefined', () => {
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
          getNodeGeolocation: sinon.stub().returns(undefined),
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

      expect(() => hwRequirementsWithUndefinedGeo.checkAppGeolocationRequirements(appSpec)).to.throw();
    });

    it('should return true if app ver < 5', () => {
      const appSpec = {
        version: 4,
      };

      const result = hwRequirements.checkAppGeolocationRequirements(appSpec);

      expect(result).to.equal(true);
    });

    it('should return true if geolocation matches', () => {
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
          getNodeGeolocation: sinon.stub().returns({
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

      const result = hwRequirementsWithMatchingGeo.checkAppGeolocationRequirements(appSpec);

      expect(result).to.equal(true);
    });

    it('should throw if geolocation is forbidden', () => {
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
          getNodeGeolocation: sinon.stub().returns({
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

      expect(() => hwRequirementsWithForbiddenGeo.checkAppGeolocationRequirements(appSpec)).to.throw();
    });

    it('should throw if geolocation is not matching', () => {
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
          getNodeGeolocation: sinon.stub().returns({
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

      expect(() => hwRequirementsWithNonMatchingGeo.checkAppGeolocationRequirements(appSpec)).to.throw();
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

  describe('exported functions', () => {
    it('should export requirement checking functions', () => {
      expect(hwRequirements.totalAppHWRequirements).to.be.a('function');
      expect(hwRequirements.checkAppHWRequirements).to.be.a('function');
      expect(hwRequirements.checkAppStaticIpRequirements).to.be.a('function');
      expect(hwRequirements.checkAppNodesRequirements).to.be.a('function');
      expect(hwRequirements.checkAppGeolocationRequirements).to.be.a('function');
    });
  });
});
