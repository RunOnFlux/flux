const chai = require('chai');
const sinon = require('sinon');
const benchmarkrpc = require('daemonrpc');
const { PassThrough } = require('stream');

const { expect } = chai;
const verificationHelper = require('../../ZelBack/src/services/verificationHelper').default;
const benchmarkService = require('../../ZelBack/src/services/benchmarkService').default;

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
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          message: 'client[rpc] is not a function',
          name: 'TypeError',
        },
      };
      const executeCallRes = await benchmarkService.executeCall('testing123');

      expect(executeCallRes).to.eql(expectedErrorMessage);
    });

    it('should throw error if parameter is not an iterable', async () => {
      const params = {
        test: 'test1',
        test2: 'test3',
      };
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'TypeError',
          message: 'Found non-callable @@iterator',
        },
      };
      const executeCallRes = await benchmarkService.executeCall('getstatus', params);

      expect(executeCallRes).to.eql(expectedErrorMessage);
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
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
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

    it('should return a sucessful response if called with parameters by an authorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
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

    it('should return an access denied response if called without parameters by an unauthorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uV',
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
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

    it('should return a sucessful response if called without parameters by an authorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
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

    it('should return a sucessful response if called with parameters by an authorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uZ',
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
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

    it('should return an access denied response if called without parameters by an unauthorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
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

  describe.skip('signFluxTransactionPost tests', () => {
    // TODO: These tests are going to be altered when we're switching all requests from streams to body.parse.
    // As they are right now - it's almost impossible to test without actually starting the deamon or without using hacky workarounds

    let benchmarkStub;
    let verificationHelperStub;

    beforeEach(async () => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'signzelnodetransaction').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
      verificationHelperStub.restore();
    });

    it('should sign flux transaction if called properly', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
            signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc=',
          },
        },
        params: {
          hexstring: '0x0123ABCDF',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.stub().returns(res);
        return res;
      };
      const mockResponse = generateResponse();
      const expectedSuccessMessage = { status: 'success', data: 'called' };

      await benchmarkService.signFluxTransactionPost(mockStream, mockResponse);

      sinon.assert.calledOnce(mockResponse.json);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
    });
  });

  describe('help tests', () => {
    let benchmarkStub;

    beforeEach(async () => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'help').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
    });

    it('should return a sucessful response if called without response', async () => {
      const req = {
        params: {
          command: 'testing',
        },
      };
      const signFluxTransactionResult = await benchmarkService.help(req);

      expect(signFluxTransactionResult).to.be.an('object');
      expect(signFluxTransactionResult.status).to.equal('success');
      expect(signFluxTransactionResult.data).to.equal('called');
      sinon.assert.calledOnceWithExactly(benchmarkStub, req.params.command);
    });

    it('should return a sucessful response if called with response', async () => {
      const req = {
        params: {
          command: 'testing',
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

      await benchmarkService.help(req, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(benchmarkStub, req.params.command);
    });

    it('should return a sucessful response if called with paramaters in query', async () => {
      const req = {
        params: {
          test: 'something',
        },
        query: {
          command: 'test',
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

      await benchmarkService.help(req, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(benchmarkStub, req.query.command);
    });

    it('should return a sucessful response if called without parameters in query or params', async () => {
      const req = {
        params: {
          test: 'something',
        },
        query: {
          test2: 'test3',
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

      await benchmarkService.help(req, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(benchmarkStub, '');
    });
  });

  describe('stop tests', () => {
    let benchmarkStub;
    let verificationHelperStub;

    beforeEach(async () => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'stop').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
      verificationHelperStub.restore();
    });

    it('should return a sucessful response if called without parameters by an authorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
            signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc=',
          },
        },
      };

      const signFluxTransactionResult = await benchmarkService.stop(req);

      expect(signFluxTransactionResult).to.be.an('object');
      expect(signFluxTransactionResult.status).to.equal('success');
      expect(signFluxTransactionResult.data).to.equal('called');
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'admin', req);
      sinon.assert.calledOnce(benchmarkStub);
    });

    it('should return a sucessful response if called with parameters by an authorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uZ',
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
            signature: 'IH9d68fk/dYQtuMlNx7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc=',
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

      await benchmarkService.stop(req, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'admin', req);
    });

    it('should return an access denied response if called without parameters by an unauthorized party', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      const req = {
        headers: {
          zelidauth: {
            zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
            loginPhrase: '16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9',
            signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc=',
          },
        },
      };
      const signFluxTransactionResult = await benchmarkService.stop(req);

      expect(signFluxTransactionResult).to.be.an('object');
      expect(signFluxTransactionResult.status).to.equal('error');
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'admin', req);
      sinon.assert.notCalled(benchmarkStub);
    });
  });

  describe('getBenchmarks tests', () => {
    let benchmarkStub;

    beforeEach(() => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'getbenchmarks').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
    });

    it('should return a sucessful response if called without parameters', async () => {
      const getBenchmarksResult = await benchmarkService.getBenchmarks();

      expect(getBenchmarksResult).to.be.an('object');
      expect(getBenchmarksResult.status).to.equal('success');
      expect(getBenchmarksResult.data).to.equal('called');
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

      await benchmarkService.getBenchmarks(undefined, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
    });
  });

  describe('getInfo tests', () => {
    let benchmarkStub;

    beforeEach(() => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'getInfo').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
    });

    it('should return a sucessful response if called without parameters', async () => {
      const getInfoResult = await benchmarkService.getInfo();

      expect(getInfoResult).to.be.an('object');
      expect(getInfoResult.status).to.equal('success');
      expect(getInfoResult.data).to.equal('called');
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

      await benchmarkService.getInfo(undefined, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
    });
  });

  describe('getPublicIp tests', () => {
    let benchmarkStub;

    beforeEach(() => {
      benchmarkStub = sinon.stub(benchmarkrpc.Client.prototype, 'getpublicip').returns(Promise.resolve('called'));
    });

    afterEach(() => {
      benchmarkStub.restore();
    });

    it('should return a sucessful response if called without parameters', async () => {
      const getPublicIpResult = await benchmarkService.getPublicIp();

      expect(getPublicIpResult).to.be.an('object');
      expect(getPublicIpResult.status).to.equal('success');
      expect(getPublicIpResult.data).to.equal('called');
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

      await benchmarkService.getPublicIp(undefined, mockResponse);

      sinon.assert.calledOnce(benchmarkStub);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedSuccessMessage);
    });
  });
});
