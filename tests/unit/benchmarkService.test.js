const chai = require('chai');
const sinon = require('sinon');
const benchmarkrpc = require('daemonrpc');
const proxyquire = require('proxyquire');

const { expect } = chai;
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');

const adminConfig = {
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    testnet: true,
  },
};
const benchmarkService = proxyquire('../../ZelBack/src/services/benchmarkService',
  { '../../../config/userconfig': adminConfig });

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

    it('should call getstatus properly if response object is passed', async () => {
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.stub().returns(res);
        return res;
      };
      const mockResponse = generateResponse();
      const expectedSuccessMessage = { status: 'success', data: 'called' };

      await benchmarkService.getStatus(undefined, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
    });
  });

  describe('restartNodeBenchmarks tests', () => {
    let benchmarkStub;
    let verificationHelperStub;

    beforeEach(async () => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'restartnodebenchmarks').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
      verificationHelperStub.restore();
    });

    // No need to test specific privilege - function has been tested in verification helper
    it('should return a sucessful response if called without parameters by an authorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc=',
          },
        },
      };

      const restartNodeBenchmarksResult = await benchmarkService.restartNodeBenchmarks(req);

      expect(restartNodeBenchmarksResult).to.be.an('object');
      expect(restartNodeBenchmarksResult.status).to.equal('success');
      expect(restartNodeBenchmarksResult.data).to.equal('called');
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    });

    // No need to test specific privilege - function has been tested in verification helper
    it('should return a sucessful response if called with parameters by an authorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc=',
          },
        },
      };
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.stub().returns(res);
        return res;
      };
      const mockResponse = generateResponse();
      const expectedSuccessMessage = { status: 'success', data: 'called' };

      await benchmarkService.restartNodeBenchmarks(req, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    });

    // No need to test specific privilege - function has been tested in verification helper
    it('should return an access denied response if called without parameters by an unauthorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uV',
            signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBx=',
          },
        },
      };
      const restartNodeBenchmarksResult = await benchmarkService.restartNodeBenchmarks(req);

      expect(restartNodeBenchmarksResult).to.be.an('object');
      expect(restartNodeBenchmarksResult.status).to.equal('error');
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
      sinon.assert.notCalled(benchmarkStub);
    });
  });

  describe('signFluxTransaction tests', () => {
    let benchmarkStub;
    let verificationHelperStub;

    beforeEach(async () => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'signzelnodetransaction').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
      verificationHelperStub.restore();
    });

    // No need to test specific privilege - function has been tested in verification helper
    it('should return a sucessful response if called without parameters by an authorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc=',
          },
        },
        params: {
          hexstring: '0x0123ABCDF',
        },
      };

      const signFluxTransactionResult = await benchmarkService.signFluxTransaction(req);

      expect(signFluxTransactionResult).to.be.an('object');
      expect(signFluxTransactionResult.status).to.equal('success');
      expect(signFluxTransactionResult.data).to.equal('called');
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'admin', req);
      sinon.assert.calledOnceWithExactly(benchmarkStub, req.params.hexstring);
    });

    // No need to test specific privilege - function has been tested in verification helper
    it('should return a sucessful response if called with parameters by an authorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uZ',
            signature: 'IH9d68fk/dYQtuMlNx7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc=',
          },
        },
        params: {
          hexstring: '0x0123ABCDF',
        },
      };
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.stub().returns(res);
        return res;
      };
      const mockResponse = generateResponse();
      const expectedSuccessMessage = { status: 'success', data: 'called' };

      await benchmarkService.signFluxTransaction(req, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'admin', req);
      sinon.assert.calledOnceWithExactly(benchmarkStub, req.params.hexstring);
    });

    // No need to test specific privilege - function has been tested in verification helper
    it('should return an access denied response if called without parameters by an unauthorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc=',
          },
        },
        params: {
          hexstring: '0x0123ABCDF',
        },
      };
      const signFluxTransactionResult = await benchmarkService.signFluxTransaction(req);

      expect(signFluxTransactionResult).to.be.an('object');
      expect(signFluxTransactionResult.status).to.equal('error');
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'admin', req);
      sinon.assert.notCalled(benchmarkStub);
    });
  });
});
