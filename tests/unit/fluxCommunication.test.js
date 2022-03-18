const chai = require('chai');
const sinon = require('sinon');

const { expect } = chai;

const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonService = require('../../ZelBack/src/services/daemonService');

describe('fluxCommunication tests', () => {
  describe('isFluxAvailable tests', () => {
    let stub;
    const ip = '127.0.0.1';
    const port = '16125';
    const axiosConfig = {
      timeout: 5000,
    };

    afterEach(() => {
      serviceHelper.axiosGet.restore();
    });

    it('Should return true if node is running flux, port taken from config', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '3.10.0',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(true);
    });

    it('Should return true if node is running flux, port provided explicitly', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '3.10.0',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(true);
    });

    it('Should return false if node if flux version is lower than expected', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '2.01.0', // minimum allowed version is 3.10.0
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });

    it('Should return false if response status is not success', async () => {
      const mockResponse = {
        data: {
          status: 'error',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });

    it('Should return false if axios request throws error', async () => {
      stub = sinon.stub(serviceHelper, 'axiosGet').throws();
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });
  });

  describe('checkFluxAvailability tests', () => {
    let stub;
    const axiosConfig = {
      timeout: 5000,
    };
    const fluxAvailabilitySuccessResponse = {
      data: {
        status: 'success',
        data: '3.10.0',
      },
    };
    const fluxAvailabilityErrorResponse = {
      data: {
        status: 'error',
        data: '3.10.0',
      },
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    afterEach(() => {
      serviceHelper.axiosGet.restore();
    });

    it('Should return success message if proper parameters are passed in params', async () => {
      const mockResponse = generateResponse();
      const req = {
        params: {
          test1: 'test1',
          ip: '127.0.0.1',
          port: '16125',
        },
        query: {
          test2: 'test2',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilitySuccessResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';
      const expectedMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is available',
        },
      };

      const checkFluxAvailabilityResult = await fluxCommunication.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedMessage);
      expect(checkFluxAvailabilityResult).to.eql(expectedMessage);
    });

    it('Should return success message if proper parameters are passed in query', async () => {
      const mockResponse = generateResponse();
      const req = {
        params: {
          test1: 'test1',
        },
        query: {
          test2: 'test2',
          ip: '127.0.0.1',
          port: '16125',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilitySuccessResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';
      const expectedMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is available',
        },
      };

      const checkFluxAvailabilityResult = await fluxCommunication.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedMessage);
      expect(checkFluxAvailabilityResult).to.eql(expectedMessage);
    });

    it('Should return error message if flux is not available', async () => {
      const mockResponse = generateResponse();
      const req = {
        params: {
          test1: 'test1',
        },
        query: {
          test2: 'test2',
          ip: '127.0.0.1',
          port: '16125',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilityErrorResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';
      const expectedMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is not available',
        },
      };

      const checkFluxAvailabilityResult = await fluxCommunication.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedMessage);
      expect(checkFluxAvailabilityResult).to.eql(expectedMessage);
    });

    it('Should return error message if no ip is provided', async () => {
      const mockResponse = generateResponse();
      const req = {
        params: {
          test1: 'test1',
        },
        query: {
          test2: 'test2',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilitySuccessResponse);
      const expectedMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'No ip specified.',
        },
      };

      const checkFluxAvailabilityResult = await fluxCommunication.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedMessage);
      expect(checkFluxAvailabilityResult).to.eql(expectedMessage);
    });
  });

  describe.only('getMyFluxIPandPort tests', () => {
    const daemonStub = sinon.stub(daemonService, 'getBenchmarks');

    afterEach(() => {
      daemonStub.restore();
    });

    it('should return IP and Port if benchmark response is correct', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      daemonStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxCommunication.getMyFluxIPandPort();

      expect(getIpResult).to.equal(ip);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return null if daemon\'s response is invalid', async () => {
      const getBenchmarkResponseData = {
        status: 'error',
      };
      daemonStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxCommunication.getMyFluxIPandPort();

      expect(getIpResult).to.be.null;
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return null if daemon\'s response IP is too short', async () => {
      const ip = '12734';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      daemonStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxCommunication.getMyFluxIPandPort();

      expect(getIpResult).to.be.null;
      sinon.assert.calledOnce(daemonStub);
    });
  });
});
