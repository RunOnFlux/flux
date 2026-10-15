const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const { expect } = chai;
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { GeoVerdict, GeoSource } = require('../../ZelBack/src/services/appRequirements/hwRequirements');

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

  describe('appGeolocationVerdict, for a node the table cannot place', () => {
    // The node's own report places it: the table has no row for it.
    const placedBySelfReport = (nodeGeo) => proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
      '../serviceHelper': serviceHelperStub,
      '../geolocationService': {
        isStaticIP: sinon.stub().returns(true),
        getNodeGeolocation: sinon.stub().resolves(nodeGeo),
      },
      '../appPlacement/ipLocationStore': {
        lookup: sinon.stub().resolves(null),
        regionCodeForName: sinon.stub().returns(null),
      },
      '../../lib/log': logStub,
    });
    const czPrague = {
      ip: '203.0.113.10', continentCode: 'EU', countryCode: 'CZ', regionName: 'PRG',
    };

    it('passes an app with no geolocation', async () => {
      const result = await hwRequirements.appGeolocationVerdict({ name: 'testapp', version: 5, geolocation: [] });

      expect(result).to.deep.equal({ verdict: hwRequirements.GeoVerdict.PASS, source: null, reason: null });
    });

    it('passes an app below version 5, whose geolocation is not read', async () => {
      const result = await hwRequirements.appGeolocationVerdict({ version: 4, geolocation: ['acNA'] });

      expect(result.verdict).to.equal(hwRequirements.GeoVerdict.PASS);
    });

    it('is UNKNOWN when the node has no geolocation at all', async () => {
      const gate = placedBySelfReport(undefined);

      const result = await gate.appGeolocationVerdict({ version: 5, geolocation: ['acEU'] });

      expect(result).to.deep.equal({
        verdict: gate.GeoVerdict.UNKNOWN,
        source: null,
        reason: 'Node Geolocation not set. Aborting.',
      });
    });

    it('passes a node whose self-reported region matches', async () => {
      const gate = placedBySelfReport(czPrague);

      const result = await gate.appGeolocationVerdict({ version: 5, geolocation: ['acEU_CZ_PRG'] });

      expect(result.verdict).to.equal(gate.GeoVerdict.PASS);
    });

    it('fails a forbidden location on the self-report', async () => {
      const gate = placedBySelfReport(czPrague);

      const result = await gate.appGeolocationVerdict({ version: 5, geolocation: ['a!cEU_CZ_PRG'] });

      expect(result).to.deep.equal({
        verdict: gate.GeoVerdict.FAIL,
        source: gate.GeoSource.SELF,
        reason: 'App specs of geolocation set is forbidden to run on node geolocation. Aborting.',
      });
    });

    it('fails a location the spec does not name, on the self-report', async () => {
      const gate = placedBySelfReport(czPrague);

      const result = await gate.appGeolocationVerdict({ version: 5, geolocation: ['acEU_PL_GDA'] });

      expect(result).to.deep.equal({
        verdict: gate.GeoVerdict.FAIL,
        source: gate.GeoSource.SELF,
        reason: 'App specs of geolocation set is not matching to run on node geolocation. Aborting.',
      });
    });

    it('fails a legacy continent and a legacy country entry, on the self-report', async () => {
      const gate = placedBySelfReport(czPrague);

      const continent = await gate.appGeolocationVerdict({ version: 5, geolocation: ['aNA'] });
      const country = await gate.appGeolocationVerdict({ version: 5, geolocation: ['aEU', 'bPL'] });

      expect(continent).to.deep.equal({
        verdict: gate.GeoVerdict.FAIL,
        source: gate.GeoSource.SELF,
        reason: 'App specs with continents geolocation set not matching node geolocation. Aborting.',
      });
      expect(country).to.deep.equal({
        verdict: gate.GeoVerdict.FAIL,
        source: gate.GeoSource.SELF,
        reason: 'App specs with countries geolocation set not matching node geolocation. Aborting.',
      });
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

  describe('appGeolocationVerdict, for a node the table places', () => {
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
        '../../lib/log': logStub,
      });
    }
    const verdictOf = (lookupResult, geolocation, regionNames) => gateWith(lookupResult, regionNames)
      .appGeolocationVerdict({ version: 7, geolocation });
    const NOT_MATCHING = 'App specs of geolocation set is not matching to run on node geolocation. Aborting.';
    const FORBIDDEN = 'App specs of geolocation set is forbidden to run on node geolocation. Aborting.';
    const failOn = (source, reason) => ({ verdict: GeoVerdict.FAIL, source, reason });
    const UNPROVEN = { verdict: GeoVerdict.UNKNOWN, source: null, reason: NOT_MATCHING };

    const inRegion = {
      org: 'aabbccddeeff', countryCode: 'FI', continentCode: 'EU', region: 'FI-18',
    };
    const otherRegion = { ...inRegion, region: 'FI-11' };
    const regionUnknown = { ...inRegion, region: null };
    const otherCountry = {
      org: 'aabbccddeeff', countryCode: 'FR', continentCode: 'EU', region: 'FR-GES',
    };

    // Bavaria is DE-BY, and until the artifact carries that a node cannot know
    // it. The vocabulary is what lets an entry written the way ip-api names
    // regions be answered at region granularity instead of country.
    const finnishNames = { 'FI|Uusimaa': 'FI-18', 'FI|Pirkanmaa': 'FI-11' };

    it('fails a country pin on the table when the table places the node in another country', async () => {
      // the node reports FI; the table places its address in FR
      expect(await verdictOf(otherCountry, ['acEU_FI'])).to.deep.equal(failOn(GeoSource.TABLE, NOT_MATCHING));
    });

    it('passes a country pin the table places the node in, whatever the node reports', async () => {
      expect(await verdictOf(otherCountry, ['acEU_FR'])).to.deep.equal({ verdict: GeoVerdict.PASS, source: null, reason: null });
    });

    it('resolves a named region allow through the vocabulary', async () => {
      expect((await verdictOf(inRegion, ['acEU_FI_Uusimaa'], finnishNames)).verdict).to.equal(GeoVerdict.PASS);
    });

    it('fails a named region allow on the table when the table places the node elsewhere', async () => {
      // the node calls itself Uusimaa; the table puts its address in FI-11, and
      // a resolved entry is decided on the table region alone, so the
      // self-reported name buys no eligibility the table refused
      expect(await verdictOf(otherRegion, ['acEU_FI_Uusimaa'], finnishNames)).to.deep.equal(failOn(GeoSource.TABLE, NOT_MATCHING));
    });

    it('applies a named region deny through the vocabulary, on the table', async () => {
      expect(await verdictOf(inRegion, ['a!cEU_FI_Uusimaa'], finnishNames)).to.deep.equal(failOn(GeoSource.TABLE, FORBIDDEN));
    });

    it('applies a named region deny by the self-reported name too, resting on the self-report', async () => {
      // The node calls itself Uusimaa; the table puts its address in FI-11. A ban
      // is written for a reason the network cannot see, so the self-reported
      // name still catches it - and what caught it is the node's own report.
      expect(await verdictOf(otherRegion, ['a!cEU_FI_Uusimaa'], finnishNames)).to.deep.equal(failOn(GeoSource.SELF, FORBIDDEN));
    });

    it('is UNKNOWN for a named region pin when the table knows the country but not the region', async () => {
      expect(await verdictOf(regionUnknown, ['acEU_FI_Uusimaa'], finnishNames)).to.deep.equal(UNPROVEN);
    });

    it('falls back to the self-reported name when the vocabulary cannot resolve', async () => {
      expect((await verdictOf(regionUnknown, ['acEU_FI_Uusimaa'])).verdict).to.equal(GeoVerdict.PASS);
    });

    it('fails an unresolvable region pin the self-reported name misses, on the self-report', async () => {
      expect(await verdictOf(regionUnknown, ['acEU_FI_Pirkanmaa'])).to.deep.equal(failOn(GeoSource.SELF, NOT_MATCHING));
    });

    it('passes an ISO region allow when the table places this node in it', async () => {
      expect((await verdictOf(inRegion, ['acEU_FI_FI-18'])).verdict).to.equal(GeoVerdict.PASS);
    });

    it('fails an ISO region allow on the table when the table places this node elsewhere', async () => {
      expect(await verdictOf(otherRegion, ['acEU_FI_FI-18'])).to.deep.equal(failOn(GeoSource.TABLE, NOT_MATCHING));
    });

    it('is UNKNOWN for an ISO region allow when its own region is unknown - a pin needs proof', async () => {
      expect(await verdictOf(regionUnknown, ['acEU_FI_FI-18'])).to.deep.equal(UNPROVEN);
    });

    it('treats an unreadable store exactly like an unknown region', async () => {
      const err = new Error('iplocation store unavailable: no database connection');
      err.code = 'IPLOCATION_STORE_UNAVAILABLE';
      expect(await verdictOf(err, ['acEU_FI_FI-18'])).to.deep.equal(UNPROVEN);
    });

    it('fails a country pin on the self-report when the store is unreadable', async () => {
      const err = new Error('iplocation store unavailable: no database connection');
      err.code = 'IPLOCATION_STORE_UNAVAILABLE';
      expect(await verdictOf(err, ['acEU_FR'])).to.deep.equal(failOn(GeoSource.SELF, NOT_MATCHING));
    });

    it('is UNKNOWN, not a table FAIL, when an unproven region pin sits beside pins the table rules out', async () => {
      expect(await verdictOf(regionUnknown, ['acEU_DE', 'acEU_FI_FI-18'])).to.deep.equal(UNPROVEN);
    });

    it('applies an ISO region deny only on proof', async () => {
      expect(await verdictOf(inRegion, ['acEU', 'a!cEU_FI_FI-18'])).to.deep.equal(failOn(GeoSource.TABLE, FORBIDDEN));
      expect((await verdictOf(otherRegion, ['acEU', 'a!cEU_FI_FI-18'])).verdict).to.equal(GeoVerdict.PASS);
      expect((await verdictOf(regionUnknown, ['acEU', 'a!cEU_FI_FI-18'])).verdict).to.equal(GeoVerdict.PASS);
    });

    it('keeps legacy name matching untouched alongside the table form', async () => {
      expect((await verdictOf(otherRegion, ['acEU_FI_Uusimaa'])).verdict).to.equal(GeoVerdict.PASS);
    });
  });

  describe('checkAppRequirements refuses on the geolocation verdict', () => {
    // Every other requirement passes: a four-core node with room to spare, no
    // static-IP, data-centre or node pin. Only the geolocation decides.
    const load = (lookupResult) => proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
      '../benchmarkService': {
        getBenchmarks: sinon.stub().resolves({ status: 'success', data: { ssd: 1000 } }),
      },
      '../generalService': { nodeTier: sinon.stub().resolves('cumulus') },
      '../appQuery/resourceQueryService': {
        appsResources: sinon.stub().resolves({
          status: 'success',
          data: { appsCpusLocked: 0, appsRamLocked: 0, appsHddLocked: 0 },
        }),
      },
      os: {
        cpus: sinon.stub().returns(new Array(4)),
        totalmem: sinon.stub().returns(8000 * 1024 * 1024),
      },
      '../geolocationService': {
        isStaticIP: sinon.stub().returns(true),
        getNodeGeolocation: sinon.stub().resolves({
          ip: '203.0.113.10', continentCode: 'EU', countryCode: 'FI', regionName: 'Uusimaa',
        }),
      },
      '../appPlacement/ipLocationStore': {
        lookup: sinon.stub().resolves(lookupResult),
        regionCodeForName: () => null,
      },
      '../../lib/log': logStub,
    });
    const app = (geolocation) => ({
      name: 'geoapp', version: 7, compose: [{ cpu: 0.5, ram: 500, hdd: 5 }], geolocation,
    });

    it('throws the verdict reason on a FAIL', async () => {
      const gate = load({ countryCode: 'FR', continentCode: 'EU', region: 'FR-GES' });
      await expect(gate.checkAppRequirements(app(['acEU_FI'])))
        .to.be.rejectedWith('App specs of geolocation set is not matching to run on node geolocation. Aborting.');
    });

    it('throws on an UNKNOWN as well: an install needs proof', async () => {
      const gate = load({ countryCode: 'FI', continentCode: 'EU', region: null });
      await expect(gate.checkAppRequirements(app(['acEU_FI_FI-18'])))
        .to.be.rejectedWith('App specs of geolocation set is not matching to run on node geolocation. Aborting.');
    });

    it('resolves on a PASS', async () => {
      const gate = load({ countryCode: 'FI', continentCode: 'EU', region: 'FI-18' });
      expect(await gate.checkAppRequirements(app(['acEU_FI_FI-18']))).to.equal(true);
    });
  });

  describe('exported functions', () => {
    it('should export requirement checking functions', () => {
      expect(hwRequirements.totalAppHWRequirements).to.be.a('function');
      expect(hwRequirements.checkAppHWRequirements).to.be.a('function');
      expect(hwRequirements.checkAppCpuBurstHeadroom).to.be.a('function');
      expect(hwRequirements.checkAppStaticIpRequirements).to.be.a('function');
      expect(hwRequirements.checkAppNodesRequirements).to.be.a('function');
      expect(hwRequirements.appGeolocationVerdict).to.be.a('function');
    });

    it('exports the verdict and its source as frozen enums', () => {
      expect(hwRequirements.GeoVerdict).to.deep.equal({ PASS: 'pass', FAIL: 'fail', UNKNOWN: 'unknown' });
      expect(hwRequirements.GeoSource).to.deep.equal({ TABLE: 'table', SELF: 'self' });
      expect(Object.isFrozen(hwRequirements.GeoVerdict)).to.equal(true);
      expect(Object.isFrozen(hwRequirements.GeoSource)).to.equal(true);
    });
  });

  describe('checkAppNodesRequirements tests', () => {
    const PINNED_ADDR = '10.0.0.1:16127';
    const OUTPOINT = 'a'.repeat(64) + ':0';

    const load = ({ collateral, localSocketAddr = PINNED_ADDR } = {}) => proxyquire(
      '../../ZelBack/src/services/appRequirements/hwRequirements',
      {
        '../generalService': {
          obtainNodeCollateralInformation: collateral instanceof Error
            ? sinon.stub().rejects(collateral)
            : sinon.stub().resolves(collateral),
        },
        '../fluxNetworkHelper': {
          getLocalSocketAddress: sinon.stub().resolves(localSocketAddr),
        },
        '../../lib/log': {
          info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
        },
      },
    );

    it('passes a spec that names this node by address, with the daemon unreachable', async () => {
      // The address needs no daemon. Refusing here aborts an install over a fact the spec
      // did not depend on, and the retry lands on a node whose daemon is still coming up.
      const hw = load({ collateral: new Error('daemon down') });
      expect(await hw.checkAppNodesRequirements({
        version: 8, name: 'app', nodes: [PINNED_ADDR],
      })).to.equal(true);
    });

    it('refuses a spec that names only other nodes, with the daemon unreachable', async () => {
      // The narrowing must not become a bypass: an unresolved outpoint matches nothing.
      const hw = load({ collateral: new Error('daemon down') });
      await expect(hw.checkAppNodesRequirements({
        version: 8, name: 'app', nodes: ['10.9.9.9:16127'],
      })).to.be.rejectedWith(/not allowed to run on this node/);
    });

    it('matches a collateral pin when the daemon answers', async () => {
      const hw = load({ collateral: { txhash: 'a'.repeat(64), txindex: 0 }, localSocketAddr: '10.5.5.5:16127' });
      expect(await hw.checkAppNodesRequirements({
        version: 8, name: 'app', nodes: [OUTPOINT],
      })).to.equal(true);
    });

    it('checks v8 as well as v7, so an install reached by any path is held to its pin', async () => {
      const hw = load({ collateral: { txhash: 'b'.repeat(64), txindex: 1 }, localSocketAddr: '10.5.5.5:16127' });
      for (const version of [7, 8]) {
        // eslint-disable-next-line no-await-in-loop
        await expect(hw.checkAppNodesRequirements({
          version, name: 'app', nodes: ['10.9.9.9:16127'],
        }), `v${version}`).to.be.rejectedWith(/not allowed to run on this node/);
      }
    });

    it('holds nothing to a pin it does not carry', async () => {
      const hw = load({ collateral: new Error('daemon down') });
      expect(await hw.checkAppNodesRequirements({ version: 8, name: 'app', nodes: [] })).to.equal(true);
      expect(await hw.checkAppNodesRequirements({ version: 8, name: 'app' })).to.equal(true);
    });
  });
});
