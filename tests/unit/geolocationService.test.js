const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('geolocationService tests', () => {
  let geolocationService;
  let dbHelperStub;
  let serviceHelperStub;
  let fluxNetworkHelperStub;
  let logStub;
  let configStub;

  const mockGeolocationData = {
    ip: '185.199.108.1',
    continent: 'Europe',
    continentCode: 'EU',
    country: 'Germany',
    countryCode: 'DE',
    region: 'HE',
    regionName: 'Hesse',
    lat: 50.1109,
    lon: 8.6821,
    org: 'Hetzner Online GmbH',
    static: true,
    dataCenter: true,
  };

  const mockDbResult = {
    geolocation: mockGeolocationData,
    staticIp: true,
    dataCenter: true,
    lastIpChangeDate: Date.now() - (15 * 24 * 60 * 60 * 1000), // 15 days ago
  };

  beforeEach(() => {
    // Create stubs
    const mockDb = {
      db: sinon.stub().returns({
        collection: sinon.stub(),
      }),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub().returns(mockDb),
      updateOneInDatabase: sinon.stub().resolves(),
      findOneInDatabase: sinon.stub(),
    };

    serviceHelperStub = {
      axiosGet: sinon.stub(),
    };

    fluxNetworkHelperStub = {
      getMyFluxIPandPort: sinon.stub(),
      hasPublicIpOnInterface: sinon.stub(),
    };

    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    configStub = {
      database: {
        local: {
          database: 'zelfluxlocaltest',
          collections: {
            geolocation: 'geolocation',
          },
        },
      },
    };

    // Load module with stubs
    geolocationService = proxyquire('../../ZelBack/src/services/geolocationService', {
      config: configStub,
      '../lib/log': logStub,
      './dbHelper': dbHelperStub,
      './serviceHelper': serviceHelperStub,
      './fluxNetworkHelper': fluxNetworkHelperStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('isStaticIP tests', () => {
    it('should return false by default', () => {
      expect(geolocationService.isStaticIP()).to.equal(false);
    });
  });

  describe('isDataCenter tests', () => {
    it('should return false by default', () => {
      expect(geolocationService.isDataCenter()).to.equal(false);
    });
  });

  describe('getLastIpChangeDate tests', () => {
    it('should return null by default', () => {
      expect(geolocationService.getLastIpChangeDate()).to.equal(null);
    });
  });

  describe('hasPublicIp tests', () => {
    it('should return false when fluxNetworkHelper.hasPublicIpOnInterface returns false', async () => {
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false);

      const result = await geolocationService.hasPublicIp();

      expect(result).to.equal(false);
      sinon.assert.calledOnce(fluxNetworkHelperStub.hasPublicIpOnInterface);
    });

    it('should return true when fluxNetworkHelper.hasPublicIpOnInterface returns true', async () => {
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);

      const result = await geolocationService.hasPublicIp();

      expect(result).to.equal(true);
      sinon.assert.calledOnce(fluxNetworkHelperStub.hasPublicIpOnInterface);
    });
  });

  describe('getNodeGeolocation tests', () => {
    it('should return null when no geolocation is stored and db is empty', async () => {
      dbHelperStub.findOneInDatabase.resolves(null);

      const result = await geolocationService.getNodeGeolocation();

      expect(result).to.equal(null);
    });

    it('should return geolocation from database when not in memory', async () => {
      dbHelperStub.findOneInDatabase.resolves(mockDbResult);

      const result = await geolocationService.getNodeGeolocation();

      expect(result).to.deep.equal(mockGeolocationData);
      sinon.assert.calledOnce(logStub.info);
    });

    it('should restore staticIp, dataCenter, and lastIpChangeDate from db', async () => {
      dbHelperStub.findOneInDatabase.resolves(mockDbResult);

      await geolocationService.getNodeGeolocation();

      expect(geolocationService.isStaticIP()).to.equal(true);
      expect(geolocationService.isDataCenter()).to.equal(true);
      expect(geolocationService.getLastIpChangeDate()).to.equal(mockDbResult.lastIpChangeDate);
    });

    it('should return defaults when db connection is not available', async () => {
      dbHelperStub.databaseConnection.returns(null);

      const result = await geolocationService.getNodeGeolocation();

      expect(result).to.equal(null);
    });

    it('should handle db error gracefully', async () => {
      dbHelperStub.findOneInDatabase.rejects(new Error('DB error'));

      const result = await geolocationService.getNodeGeolocation();

      expect(result).to.equal(null);
      sinon.assert.calledOnce(logStub.error);
    });
  });

  describe('setNodeGeolocation tests', () => {
    beforeEach(() => {
      // Setup default successful response
      fluxNetworkHelperStub.getMyFluxIPandPort.resolves('185.199.108.1:16127');
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
          continent: 'Europe',
          continentCode: 'EU',
          country: 'Germany',
          countryCode: 'DE',
          region: 'HE',
          regionName: 'Hesse',
          lat: 50.1109,
          lon: 8.6821,
          org: 'Hetzner Online GmbH',
          isp: 'Hetzner Online GmbH',
          proxy: false,
          hosting: true,
        },
      });
    });

    it('should not proceed if IP is not detected', async () => {
      fluxNetworkHelperStub.getMyFluxIPandPort.resolves(null);

      await geolocationService.setNodeGeolocation();

      sinon.assert.calledWith(logStub.error, 'Flux IP not detected. Flux geolocation service is awaiting');
      sinon.assert.notCalled(serviceHelperStub.axiosGet);
    });

    it('should fetch geolocation from ip-api.com', async () => {
      await geolocationService.setNodeGeolocation();

      sinon.assert.calledOnce(serviceHelperStub.axiosGet);
      expect(serviceHelperStub.axiosGet.firstCall.args[0]).to.include('ip-api.com');
    });

    it('should fallback to stats.runonflux.io when ip-api.com fails', async () => {
      serviceHelperStub.axiosGet.onFirstCall().resolves({
        data: { status: 'fail' },
      });
      serviceHelperStub.axiosGet.onSecondCall().resolves({
        data: {
          status: 'success',
          data: mockGeolocationData,
        },
      });

      await geolocationService.setNodeGeolocation();

      sinon.assert.calledTwice(serviceHelperStub.axiosGet);
      expect(serviceHelperStub.axiosGet.secondCall.args[0]).to.include('stats.runonflux.io');
    });

    it('should set staticIp to true when org contains known hosting provider', async () => {
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false);
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
          org: 'Hetzner Online GmbH',
          proxy: false,
          hosting: false,
        },
      });

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.isStaticIP()).to.equal(true);
    });

    it('should set dataCenter to true when hosting flag is true', async () => {
      await geolocationService.setNodeGeolocation();

      expect(geolocationService.isDataCenter()).to.equal(true);
    });

    it('should set dataCenter to true when org contains known hosting provider', async () => {
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
          org: 'OVH SAS',
          proxy: false,
          hosting: false,
        },
      });

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.isDataCenter()).to.equal(true);
    });

    it('should store geolocation to database', async () => {
      await geolocationService.setNodeGeolocation();

      sinon.assert.calledOnce(dbHelperStub.updateOneInDatabase);
    });

    it('should handle API error gracefully', async () => {
      serviceHelperStub.axiosGet.rejects(new Error('API error'));

      await geolocationService.setNodeGeolocation();

      sinon.assert.called(logStub.error);
    });

    it('should set staticIp to true with public IP on interface and null lastIpChangeDate', async () => {
      // This tests the case where lastIpChangeDate is null (considered stable for 10+ days)
      await geolocationService.setNodeGeolocation();

      expect(geolocationService.isStaticIP()).to.equal(true);
    });
  });

  describe('Static IP org detection tests', () => {
    const testOrgs = [
      { org: 'Hetzner Online GmbH', expected: true },
      { org: 'OVH SAS', expected: true },
      { org: 'netcup GmbH', expected: true },
      { org: 'Contabo GmbH', expected: true },
      { org: 'Hostslim B.V.', expected: true },
      { org: 'Zayo Bandwidth', expected: true },
      { org: 'Cogent Communications', expected: true },
      { org: 'Lumen Technologies', expected: true },
      { org: 'Hostnodes LLC', expected: true },
      { org: 'Comcast Cable', expected: false },
      { org: 'AT&T Services', expected: false },
      { org: 'Verizon Business', expected: false },
    ];

    testOrgs.forEach(({ org, expected }) => {
      it(`should ${expected ? 'detect' : 'not detect'} "${org}" as static IP org`, async () => {
        fluxNetworkHelperStub.getMyFluxIPandPort.resolves('185.199.108.1:16127');
        fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false); // No public IP on interface
        serviceHelperStub.axiosGet.resolves({
          data: {
            status: 'success',
            query: '185.199.108.1',
            org,
            proxy: false,
            hosting: false,
          },
        });

        // Reload module to reset state
        geolocationService = proxyquire('../../ZelBack/src/services/geolocationService', {
          config: configStub,
          '../lib/log': logStub,
          './dbHelper': dbHelperStub,
          './serviceHelper': serviceHelperStub,
          './fluxNetworkHelper': fluxNetworkHelperStub,
        });

        await geolocationService.setNodeGeolocation();

        expect(geolocationService.isStaticIP()).to.equal(expected);
      });
    });
  });

  describe('Database storage tests', () => {
    beforeEach(() => {
      fluxNetworkHelperStub.getMyFluxIPandPort.resolves('185.199.108.1:16127');
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false);
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
          org: 'Test',
          proxy: false,
          hosting: false,
        },
      });
    });

    it('should not store to db when connection is unavailable', async () => {
      dbHelperStub.databaseConnection.returns(null);

      await geolocationService.setNodeGeolocation();

      sinon.assert.calledWith(logStub.warn, 'Database connection not available for storing geolocation');
    });

    it('should handle db storage error gracefully', async () => {
      dbHelperStub.updateOneInDatabase.rejects(new Error('DB write error'));

      await geolocationService.setNodeGeolocation();

      sinon.assert.calledWithMatch(logStub.error, /Failed to store geolocation to database/);
    });
  });
});
