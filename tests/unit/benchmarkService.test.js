const chai = require('chai');
const sinon = require('sinon');
const benchmarkrpc = require('daemonrpc');
const path = require('path');
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

describe.only('benchmarkService tests', () => {
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

    it('should return a sucessful response if called properly', async () => {
      const params = ['test', 10, '192.168.0.0'];

      const executeCallResult = await benchmarkService.executeCall('getstatus', params);

      expect(executeCallResult).to.be.an('object');
      expect(executeCallResult.status).to.equal('success');
      sinon.assert.calledOnceWithExactly(benchmarkStub, ...params);
    });
  });
});
