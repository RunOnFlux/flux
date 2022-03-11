const chai = require('chai');
const sinon = require('sinon');
const benchmarkrpc = require('daemonrpc');
const proxyquire = require('proxyquire');

const adminConfig = {
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    testnet: true,
  },
};
const benchmarkService = proxyquire('../../ZelBack/src/services/benchmarkService',
  { '../../../config/userconfig': adminConfig });

const { expect } = chai;

describe('benchmarkService tests', () => {
  describe('executeCall tests', () => {
    let benchmarkStub;

    beforeEach(() => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'getstatus').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
    });

    it('should return a sucessful response if called properly with no parameters', async () => {
      const executeCallResult = await benchmarkService.executeCall('getstatus');

      expect(executeCallResult).to.be.an('object');
      expect(executeCallResult.status).to.equal('success');
      expect(executeCallResult.data).to.equal('called');
      sinon.assert.calledOnce(benchmarkStub);
    });

    it('should return a sucessful response if called properly with parameters', async () => {
      const params = ['test', 10, '192.168.0.0'];

      const executeCallResult = await benchmarkService.executeCall('getstatus', params);

      expect(executeCallResult).to.be.an('object');
      expect(executeCallResult.status).to.equal('success');
      sinon.assert.calledOnceWithExactly(benchmarkStub, ...params);
    });

    it('should throw error if called function does not exist', async () => {
      expect(async () => { await benchmarkService.executeCall('testing123'); }).to.throw;
    });

    it('should throw error if parameter is not an iterable', async () => {
      const params = {
        test: 'test1',
        test2: 'test3',
      };
      expect(async () => { await benchmarkService.executeCall('getstatus', params); }).to.throw;
    });
  });

  describe('getStatus tests', () => {
    let benchmarkStub;

    beforeEach(() => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'getstatus').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
    });

    it('should return a sucessful response if called without parameters', async () => {
      const getStatusResult = await benchmarkService.getStatus();

      expect(getStatusResult).to.be.an('object');
      expect(getStatusResult.status).to.equal('success');
      expect(getStatusResult.data).to.equal('called');
      sinon.assert.calledOnce(benchmarkStub);
    });

    it('should handle properly if response object is passed', async () => {
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.stub().returns(res);
        return res;
      };
      const mockResponse = generateResponse();
      const expectedSuccessMessage = { status: 'success', data: 'called' };

      await benchmarkService.getStatus(undefined, mockResponse);

      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
    });
  });
});
