const { expect } = require('chai');
const sinon = require('sinon');
const systemIntegration = require('../../ZelBack/src/services/appSystem/systemIntegration');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const dockerService = require('../../ZelBack/src/services/dockerService');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');

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

  describe('nodeFullGeolocation tests', () => {
    it('should return full geolocation string', async () => {
      // eslint-disable-next-line global-require
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'getNodeGeolocation').resolves({
        continentCode: 'EU',
        countryCode: 'FR',
        regionName: 'IleDeFrance',
      });

      const result = await systemIntegration.nodeFullGeolocation();

      expect(result).to.equal('EU_FR_IleDeFrance');
    });

    it('should throw error if geolocation not set', async () => {
      // eslint-disable-next-line global-require
      const geolocationService = require('../../ZelBack/src/services/geolocationService');
      sinon.stub(geolocationService, 'getNodeGeolocation').resolves(null);

      try {
        await systemIntegration.nodeFullGeolocation();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Node Geolocation not set');
      }
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

});
