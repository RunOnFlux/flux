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
