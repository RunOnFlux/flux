const sinon = require('sinon');
const { PassThrough } = require('stream');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const daemonServiceWalletRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceWalletRpcs').default;
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper').default;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceWalletRpcs tests', () => {
  describe('addMultiSigAddress tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          n: '123',
          keysobject: {
            key1: 'key1',
            key2: 'key2',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.addMultiSigAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          n: '123',
          keysobject: {
            key1: 'key1',
            key2: 'key2',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.addMultiSigAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.addMultiSigAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.addMultiSigAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          n: '123',
          keysobject: {
            key1: 'key1',
            key2: 'key2',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.addMultiSigAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', [+req.params.n, req.params.keysobject]);
    });

    it('should trigger rpc, no n param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          keysobject: {
            key1: 'key1',
            key2: 'key2',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.addMultiSigAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', []);
    });

    it('should trigger rpc, no keysobject, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          n: '123',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.addMultiSigAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', []);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          n: '123',
          keysobject: JSON.stringify({
            key1: 'key1',
            key2: 'key2',
          }),
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.addMultiSigAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', [+req.query.n, JSON.parse(req.query.keysobject)]);
    });
  });

  describe('addMultiSigAddressPost tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      await daemonServiceWalletRpcs.addMultiSigAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should call rpc if no params are given', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.addMultiSigAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', expectedCallParams);
    });

    it('should call rpc with all params', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        n: '123',
        keysobject: {
          key1: 'key1',
          key2: 'key2',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.addMultiSigAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', [+params.n, params.keysobject]);
    });

    it('should call rpc with no n param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        keysobject: {
          key1: 'key1',
          key2: 'key2',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.addMultiSigAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', []);
    });

    it('should call rpc with no keysobject param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        n: '123',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.addMultiSigAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'addMultiSigAddress', []);
    });
  });

  describe('backupWallet tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          destination: '111ZACEF1230887178',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.backupWallet(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          destination: '111ZACEF1230887178',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.backupWallet(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.backupWallet(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'backupWallet', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.backupWallet(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'backupWallet', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          destination: '111ZACEF1230887178',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.backupWallet(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'backupWallet', [req.params.destination]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          destination: '111ZACEF1230887178',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.backupWallet(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'backupWallet', [req.query.destination]);
    });
  });

  describe('dumpPrivKey tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          destination: '111ZACEF1230887178',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.dumpPrivKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          destination: '111ZACEF1230887178',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.dumpPrivKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.dumpPrivKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'dumpPrivKey', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.dumpPrivKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'dumpPrivKey', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          taddr: '111ZACEF1230887178',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.dumpPrivKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'dumpPrivKey', [req.params.taddr]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          taddr: '111ZACEF1230887178',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.dumpPrivKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'dumpPrivKey', [req.query.taddr]);
    });
  });

  describe('getBalance tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getBalance(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBalance', ['', 1, false]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.getBalance(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBalance', ['', 1, false]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBalance', ['', +req.params.minconf, false]);
    });

    it('should trigger rpc, no minconf param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBalance', ['', 1, true]);
    });

    it('should trigger rpc, no includewatchonly, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBalance', ['', +req.params.minconf, false]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          minconf: '3',
          includewatchonly: 'false',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBalance', ['', +req.query.minconf, false]);
    });
  });

  describe('getNewAddress tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getNewAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getNewAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getNewAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNewAddress');
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.getNewAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNewAddress');
    });
  });

  describe('getRawChangeAddress tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getRawChangeAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getRawChangeAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getRawChangeAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawChangeAddress');
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.getRawChangeAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawChangeAddress');
    });
  });

  describe('getReceivedByAddress tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          minconf: '3',
          zelcashaddress: '1111ZZZZACEF12345',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getReceivedByAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getReceivedByAddress', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.getReceivedByAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getReceivedByAddress', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
          zelcashaddress: '1111ZZZZACEF12345',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getReceivedByAddress', [req.params.zelcashaddress, +req.params.minconf]);
    });

    it('should trigger rpc, no minconf param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: { zelcashaddress: '1111ZZZZACEF12345' },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getReceivedByAddress', [req.params.zelcashaddress, 1]);
    });

    it('should trigger rpc, no zelcashadress, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getReceivedByAddress', []);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          minconf: '3',
          zelcashaddress: '1111ZZZZACEF12345',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getReceivedByAddress', [req.query.zelcashaddress, +req.query.minconf]);
    });
  });

  describe('getTransaction tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getTransaction(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTransaction', []);
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getTransaction(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTransaction', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: '12345',
          includewatchonly: 'true',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getTransaction(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTransaction', [req.params.txid, true]);
    });

    it('should trigger rpc, no txid in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          includewatchonly: 'true',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getTransaction(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTransaction', []);
    });

    it('should trigger rpc, no includewatchonly in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: '12345',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getTransaction(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTransaction', [req.params.txid, false]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          txid: '12345',
          includewatchonly: 'false',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getTransaction(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTransaction', [req.query.txid, false]);
    });
  });

  describe('getBalance tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getUnconfirmedBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getUnconfirmedBalance(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getUnconfirmedBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getUnconfirmedBalance');
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.getUnconfirmedBalance(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getUnconfirmedBalance');
    });
  });

  describe('getWalletInfo tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getWalletInfo(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.getWalletInfo(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.getWalletInfo(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getWalletInfo');
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.getWalletInfo(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getWalletInfo');
    });
  });

  describe('importAddress tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          address: '111Z12345',
          label: 'somelabel',
          rescan: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.importAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importAddress(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importAddress', []);
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importAddress', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          address: '111Z12345',
          label: 'somelabel',
          rescan: 'false',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importAddress(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importAddress', [req.params.address, req.params.label, false]);
    });

    it('should trigger rpc, no rescan in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          address: '111Z12345',
          label: 'somelabel',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importAddress(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importAddress', [req.params.address, req.params.label, true]);
    });

    it('should trigger rpc, no address in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          label: 'somelabel',
          rescan: false,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importAddress(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importAddress', []);
    });

    it('should trigger rpc, no label in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          address: '111Z12345',
          rescan: false,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importAddress(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importAddress', [req.params.address, '', false]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          address: '111Z12345',
          label: 'somelabel',
          rescan: false,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importAddress(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importAddress', [req.query.address, req.query.label, false]);
    });
  });

  describe('importPrivKey tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zelcashprivkey: '111Z12345',
          label: 'somelabel',
          rescan: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.importPrivKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importPrivKey(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importPrivKey', []);
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importPrivKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importPrivKey', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashprivkey: '111Z12345',
          label: 'somelabel',
          rescan: 'false',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importPrivKey(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importPrivKey', [req.params.zelcashprivkey, req.params.label, false]);
    });

    it('should trigger rpc, no rescan in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashprivkey: '111Z12345',
          label: 'somelabel',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importPrivKey(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importPrivKey', [req.params.zelcashprivkey, req.params.label, true]);
    });

    it('should trigger rpc, no zelcashprivkey in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          label: 'somelabel',
          rescan: false,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importPrivKey(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importPrivKey', []);
    });

    it('should trigger rpc, no label in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashprivkey: '111Z12345',
          rescan: false,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importPrivKey(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importPrivKey', [req.params.zelcashprivkey, '', false]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          zelcashprivkey: '111Z12345',
          label: 'somelabel',
          rescan: false,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importPrivKey(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importPrivKey', [req.query.zelcashprivkey, req.query.label, false]);
    });
  });

  describe('importWallet tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          filename: 'test.txt',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.importWallet(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importWallet(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importWallet', []);
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importWallet(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importWallet', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filename: 'test.txt',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importWallet(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importWallet', [req.params.filename]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          filename: 'test.txt',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.importWallet(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'importWallet', [req.query.filename]);
    });
  });

  describe('keyPoolRefill tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          newsize: '1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.keyPoolRefill(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.keyPoolRefill(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'keyPoolRefill', [100]);
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.keyPoolRefill(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'keyPoolRefill', [100]);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          newsize: '200',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.keyPoolRefill(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'keyPoolRefill', [200]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test0',
        },
        query: {
          newsize: 0,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.keyPoolRefill(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'keyPoolRefill', [100]);
    });
  });

  describe('listAddressGroupings tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listAddressGroupings(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listAddressGroupings(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listAddressGroupings(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listAddressGroupings');
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.listAddressGroupings(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listAddressGroupings');
    });
  });

  describe('listLockUnspent tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listLockUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listLockUnspent(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listLockUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listLockUnspent');
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.listLockUnspent(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listLockUnspent');
    });
  });

  describe('rescanBlockchain tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          startheight: '15',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.rescanBlockchain(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.rescanBlockchain(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'rescanblockchain', [0]);
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.rescanBlockchain(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'rescanblockchain', [0]);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          startheight: '15',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.rescanBlockchain(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'rescanblockchain', [15]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test0',
        },
        query: {
          startheight: 3,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.rescanBlockchain(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'rescanblockchain', [3]);
    });
  });

  describe('listReceivedByAddress tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
          includeempty: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
          includeempty: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listReceivedByAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listReceivedByAddress', [1, false, false]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.listReceivedByAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listReceivedByAddress', [1, false, false]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
          includeempty: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listReceivedByAddress', [+req.params.minconf, true, false]);
    });

    it('should trigger rpc, no minconf param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          includewatchonly: 'false',
          includeempty: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listReceivedByAddress', [1, true, false]);
    });

    it('should trigger rpc, no includewatchonly, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
          includeempty: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listReceivedByAddress', [+req.params.minconf, true, false]);
    });

    it('should trigger rpc, no includeempty, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listReceivedByAddress', [+req.params.minconf, false, false]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          minconf: '3',
          includewatchonly: 'true',
          includeempty: false,
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listReceivedByAddress', [+req.query.minconf, false, true]);
    });
  });

  describe('listSinceBlock tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
          includeempty: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listSinceBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          blockhash: '124451124561ACEF',
          targetconfirmations: '3',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listSinceBlock(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listSinceBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listSinceBlock', ['', 1, false]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.listSinceBlock(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listSinceBlock', ['', 1, false]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          blockhash: '124451124561ACEF',
          targetconfirmations: '3',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listSinceBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listSinceBlock', [req.params.blockhash, +req.params.targetconfirmations, true]);
    });

    it('should trigger rpc, no targetconfirmations param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          blockhash: '124451124561ACEF',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listSinceBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listSinceBlock', [req.params.blockhash, 1, true]);
    });

    it('should trigger rpc, no includewatchonly, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          blockhash: '124451124561ACEF',
          targetconfirmations: '3',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listSinceBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listSinceBlock', [req.params.blockhash, +req.params.targetconfirmations, false]);
    });

    it('should trigger rpc, no blockhash, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          targetconfirmations: '3',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listSinceBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listSinceBlock', ['', +req.params.targetconfirmations, true]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          blockhash: '124451124561ACEF',
          targetconfirmations: '3',
          includewatchonly: 'true',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listSinceBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listSinceBlock', [req.query.blockhash, +req.query.targetconfirmations, true]);
    });
  });

  describe('listTransactions tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          count: '23',
          from: '1',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listTransactions(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          count: '23',
          from: '1',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listTransactions(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listTransactions(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listTransactions', ['*', 10, 0, false]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.listTransactions(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listTransactions', ['*', 10, 0, false]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          count: '23',
          from: '1',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listTransactions(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listTransactions', ['*', +req.params.count, +req.params.from, true]);
    });

    it('should trigger rpc, no count param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          from: '1',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listTransactions(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listTransactions', ['*', 10, +req.params.from, true]);
    });

    it('should trigger rpc, no from, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          count: '23',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listTransactions(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listTransactions', ['*', +req.params.count, 0, true]);
    });

    it('should trigger rpc, no includewatchonly, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          count: '23',
          from: '1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listTransactions(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listTransactions', ['*', +req.params.count, +req.params.from, false]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          count: '23',
          from: '1',
          includewatchonly: 'true',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listTransactions(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listTransactions', ['*', +req.query.count, +req.query.from, true]);
    });
  });

  describe('listUnspent tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          minconf: '3',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          minconf: '3',
          maxconf: '30',
          addresses: {
            addr1: '1111ZZZZACEF12345',
            addr2: '11ZZZ12354523ACF',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.listUnspent(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listUnspent', [1, 9999999]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.listUnspent(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listUnspent', [1, 9999999]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
          maxconf: '30',
          addresses: {
            addr1: '1111ZZZZACEF12345',
            addr2: '11ZZZ12354523ACF',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listUnspent', [+req.params.minconf, +req.params.maxconf, req.params.addresses]);
    });

    it('should trigger rpc, no minconf param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          maxconf: '30',
          addresses: {
            addr1: '1111ZZZZACEF12345',
            addr2: '11ZZZ12354523ACF',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listUnspent', [1, +req.params.maxconf, req.params.addresses]);
    });

    it('should trigger rpc, no maxconf, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
          addresses: {
            addr1: '1111ZZZZACEF12345',
            addr2: '11ZZZ12354523ACF',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listUnspent', [+req.params.minconf, 9999999, req.params.addresses]);
    });

    it('should trigger rpc, no addresses, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
          maxconf: '30',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listUnspent', [+req.params.minconf, +req.params.maxconf]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          minconf: '3',
          maxconf: '30',
          addresses: {
            addr1: '1111ZZZZACEF12345',
            addr2: '11ZZZ12354523ACF',
          },
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.listUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listUnspent', [+req.query.minconf, +req.query.maxconf, req.query.addresses]);
    });
  });

  describe('lockUnspent tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          unlock: false,
          transactions: {
            tr1: '1111ZZZZACEF12345',
            tr2: '11ZZZ12354523ACF',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.lockUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          unlock: false,
          transactions: {
            tr1: '1111ZZZZACEF12345',
            tr2: '11ZZZ12354523ACF',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.lockUnspent(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.lockUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'lockUnspent', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.lockUnspent(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'lockUnspent', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          unlock: false,
          transactions: {
            tr1: '1111ZZZZACEF12345',
            tr2: '11ZZZ12354523ACF',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.lockUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'lockUnspent', [false, req.params.transactions]);
    });

    it('should trigger rpc, no transactions, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          unlock: false,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.lockUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'lockUnspent', []);
    });

    it('should trigger rpc, no unlock, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          transactions: {
            tr1: '1111ZZZZACEF12345',
            tr2: '11ZZZ12354523ACF',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.lockUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'lockUnspent', []);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          unlock: true,
          transactions: {
            tr1: '1111ZZZZACEF12345',
            tr2: '11ZZZ12354523ACF',
          },
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.lockUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'lockUnspent', [true, req.query.transactions]);
    });
  });

  describe('sendFrom tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          tozelcashaddress: '1111ZASCVDF',
          amount: '111111',
          minconf: '3',
          comment: 'testcomment',
          commentto: 'testcommentto',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.sendFrom(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          tozelcashaddress: '1111ZASCVDF',
          amount: '111111',
          minconf: '3',
          comment: 'testcomment',
          commentto: 'testcommentto',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.sendFrom(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendFrom(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.sendFrom(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          tozelcashaddress: '1111ZASCVDF',
          amount: '111111',
          minconf: '3',
          comment: 'testcomment',
          commentto: 'testcommentto',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendFrom(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', ['', req.params.tozelcashaddress, +req.params.amount, +req.params.minconf, req.params.comment, req.params.commentto]);
    });

    it('should trigger rpc, no tozelcashaddress, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          amount: '111111',
          minconf: '3',
          comment: 'testcomment',
          commentto: 'testcommentto',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendFrom(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', []);
    });

    it('should trigger rpc, no amount, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          tozelcashaddress: '1111ZASCVDF',
          minconf: '3',
          comment: 'testcomment',
          commentto: 'testcommentto',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendFrom(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', []);
    });

    it('should trigger rpc, no minconf, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          tozelcashaddress: '1111ZASCVDF',
          amount: '111111',
          comment: 'testcomment',
          commentto: 'testcommentto',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendFrom(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', ['', req.params.tozelcashaddress, +req.params.amount, 1, req.params.comment, req.params.commentto]);
    });

    it('should trigger rpc, no comment, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          tozelcashaddress: '1111ZASCVDF',
          amount: '111111',
          minconf: '3',
          commentto: 'testcommentto',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendFrom(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', ['', req.params.tozelcashaddress, +req.params.amount, +req.params.minconf, '', req.params.commentto]);
    });

    it('should trigger rpc, no commentto, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          tozelcashaddress: '1111ZASCVDF',
          amount: '111111',
          minconf: '3',
          comment: 'testcomment',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendFrom(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', ['', req.params.tozelcashaddress, +req.params.amount, +req.params.minconf, req.params.comment, '']);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          tozelcashaddress: '1111ZASCVDF',
          amount: '111111',
          minconf: '3',
          comment: 'testcomment',
          commentto: 'testcommentto',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendFrom(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', ['', req.query.tozelcashaddress, +req.query.amount, +req.query.minconf, req.query.comment, req.query.commentto]);
    });
  });

  describe('sendFromPost tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      await daemonServiceWalletRpcs.sendFromPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should call rpc if no params are given', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendFromPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', expectedCallParams);
    });

    it('should call rpc with all params', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        tozelcashaddress: '1111ZASCVDF',
        amount: '111111',
        minconf: '3',
        comment: 'testcomment',
        commentto: 'testcommentto',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendFromPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', ['', params.tozelcashaddress, +params.amount, +params.minconf, params.comment, params.commentto]);
    });

    it('should call rpc with no tozelcashaddress param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        amount: '111111',
        minconf: '3',
        comment: 'testcomment',
        commentto: 'testcommentto',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendFromPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', []);
    });

    it('should call rpc with no amount param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        tozelcashaddress: '1111ZASCVDF',
        minconf: '3',
        comment: 'testcomment',
        commentto: 'testcommentto',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendFromPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', []);
    });

    it('should call rpc with no minconf param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        tozelcashaddress: '1111ZASCVDF',
        amount: '111111',
        comment: 'testcomment',
        commentto: 'testcommentto',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendFromPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', ['', params.tozelcashaddress, +params.amount, 1, params.comment, params.commentto]);
    });

    it('should call rpc with no comment param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        tozelcashaddress: '1111ZASCVDF',
        amount: '111111',
        minconf: '3',
        commentto: 'testcommentto',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendFromPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', ['', params.tozelcashaddress, +params.amount, +params.minconf, '', params.commentto]);
    });

    it('should call rpc with no commentto param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        tozelcashaddress: '1111ZASCVDF',
        amount: '111111',
        minconf: '3',
        comment: 'testcomment',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendFromPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendFrom', ['', params.tozelcashaddress, +params.amount, +params.minconf, params.comment, '']);
    });
  });

  describe('sendMany tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          amounts: {
            amount1: '12',
            amount2: '33',
            amount3: '44',
          },
          minconf: '3',
          comment: 'testcomment',
          substractfeefromamount: {
            fee1: '12',
            fee2: '33',
            fee3: '44',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.sendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          amounts: {
            amount1: '12',
            amount2: '33',
            amount3: '44',
          },
          minconf: '3',
          comment: 'testcomment',
          substractfeefromamount: {
            fee1: '12',
            fee2: '33',
            fee3: '44',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.sendMany(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.sendMany(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          amounts: {
            amount1: '12',
            amount2: '33',
            amount3: '44',
          },
          minconf: '3',
          comment: 'testcomment',
          substractfeefromamount: {
            fee1: '12',
            fee2: '33',
            fee3: '44',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', ['', req.params.amounts, +req.params.minconf, req.params.comment, req.params.substractfeefromamount]);
    });

    it('should trigger rpc, no amounts, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '3',
          comment: 'testcomment',
          substractfeefromamount: {
            fee1: '12',
            fee2: '33',
            fee3: '44',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', []);
    });

    it('should trigger rpc, no minconf, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          amounts: {
            amount1: '12',
            amount2: '33',
            amount3: '44',
          },
          comment: 'testcomment',
          substractfeefromamount: {
            fee1: '12',
            fee2: '33',
            fee3: '44',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', ['', req.params.amounts, 1, req.params.comment, req.params.substractfeefromamount]);
    });

    it('should trigger rpc, no comment, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          amounts: {
            amount1: '12',
            amount2: '33',
            amount3: '44',
          },
          minconf: '3',
          substractfeefromamount: {
            fee1: '12',
            fee2: '33',
            fee3: '44',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', ['', req.params.amounts, +req.params.minconf, '', req.params.substractfeefromamount]);
    });

    it('should trigger rpc, no subtractfeefromamount, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          amounts: {
            amount1: '12',
            amount2: '33',
            amount3: '44',
          },
          minconf: '3',
          comment: 'testcomment',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', ['', req.params.amounts, +req.params.minconf, req.params.comment]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          amounts: {
            amount1: '12',
            amount2: '33',
            amount3: '44',
          },
          minconf: '3',
          comment: 'testcomment',
          substractfeefromamount: {
            fee1: '12',
            fee2: '33',
            fee3: '44',
          },
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', ['', req.query.amounts, +req.query.minconf, req.query.comment, req.query.substractfeefromamount]);
    });
  });

  describe('sendFromPost tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      await daemonServiceWalletRpcs.sendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should call rpc if no params are given', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', expectedCallParams);
    });

    it('should call rpc with all params', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        amounts: {
          amount1: '12',
          amount2: '33',
          amount3: '44',
        },
        minconf: '3',
        comment: 'testcomment',
        substractfeefromamount: {
          fee1: '12',
          fee2: '33',
          fee3: '44',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', ['', params.amounts, +params.minconf, params.comment, params.substractfeefromamount]);
    });

    it('should call rpc with no amounts param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        minconf: '3',
        comment: 'testcomment',
        substractfeefromamount: {
          fee1: '12',
          fee2: '33',
          fee3: '44',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', []);
    });

    it('should call rpc with no minconf param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        amounts: {
          amount1: '12',
          amount2: '33',
          amount3: '44',
        },
        comment: 'testcomment',
        substractfeefromamount: {
          fee1: '12',
          fee2: '33',
          fee3: '44',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', ['', params.amounts, 1, params.comment, params.substractfeefromamount]);
    });

    it('should call rpc with no comment param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        amounts: {
          amount1: '12',
          amount2: '33',
          amount3: '44',
        },
        minconf: '3',
        substractfeefromamount: {
          fee1: '12',
          fee2: '33',
          fee3: '44',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', ['', params.amounts, +params.minconf, '', params.substractfeefromamount]);
    });

    it('should call rpc with no substractfeefromamount param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        amounts: {
          amount1: '12',
          amount2: '33',
          amount3: '44',
        },
        minconf: '3',
        comment: 'testcomment',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendMany', ['', params.amounts, +params.minconf, params.comment]);
    });
  });

  describe('sendToAddress tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          zelcashaddress: '1111ZZZZASD',
          amount: '123456',
          comment: 'testcomment',
          commentto: 'testcommentto',
          substractfeefromamount: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.sendToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zelcashaddress: '1111ZZZZASD',
          amount: '123456',
          comment: 'testcomment',
          commentto: 'testcommentto',
          substractfeefromamount: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.sendToAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.sendToAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashaddress: '1111ZZZZASD',
          amount: '123456',
          comment: 'testcomment',
          commentto: 'testcommentto',
          substractfeefromamount: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', [req.params.zelcashaddress, +req.params.amount, req.params.comment, req.params.commentto, false]);
    });

    it('should trigger rpc, no zelcashaddress, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          amount: '123456',
          comment: 'testcomment',
          commentto: 'testcommentto',
          substractfeefromamount: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', []);
    });

    it('should trigger rpc, no amount, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashaddress: '1111ZZZZASD',
          comment: 'testcomment',
          commentto: 'testcommentto',
          substractfeefromamount: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', []);
    });

    it('should trigger rpc, no comment, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashaddress: '1111ZZZZASD',
          amount: '123456',
          commentto: 'testcommentto',
          substractfeefromamount: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', [req.params.zelcashaddress, +req.params.amount, '', req.params.commentto, false]);
    });

    it('should trigger rpc, no commentto, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashaddress: '1111ZZZZASD',
          amount: '123456',
          comment: 'testcomment',
          substractfeefromamount: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', [req.params.zelcashaddress, +req.params.amount, req.params.comment, '', false]);
    });

    it('should trigger rpc, no subtractfeefromamount, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashaddress: '1111ZZZZASD',
          amount: '123456',
          comment: 'testcomment',
          commentto: 'testcommentto',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', [req.params.zelcashaddress, +req.params.amount, req.params.comment, req.params.commentto, false]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          zelcashaddress: '1111ZZZZASD',
          amount: '123456',
          comment: 'testcomment',
          commentto: 'testcommentto',
          substractfeefromamount: 'true',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.sendToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', [req.query.zelcashaddress, +req.query.amount, req.query.comment, req.query.commentto, true]);
    });
  });

  describe('sendFromPost tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      await daemonServiceWalletRpcs.sendToAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should call rpc if no params are given', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendToAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', expectedCallParams);
    });

    it('should call rpc with all params', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        zelcashaddress: '1111ZZZZASD',
        amount: '123456',
        comment: 'testcomment',
        commentto: 'testcommentto',
        substractfeefromamount: 'true',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendToAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', [params.zelcashaddress, +params.amount, params.comment, params.commentto, true]);
    });

    it('should call rpc with no amount param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        zelcashaddress: '1111ZZZZASD',
        comment: 'testcomment',
        commentto: 'testcommentto',
        substractfeefromamount: 'true',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendToAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', []);
    });

    it('should call rpc with no zelcashaddress param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        amount: '123456',
        comment: 'testcomment',
        commentto: 'testcommentto',
        substractfeefromamount: 'true',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendToAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', []);
    });

    it('should call rpc with no comment param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        zelcashaddress: '1111ZZZZASD',
        amount: '123456',
        commentto: 'testcommentto',
        substractfeefromamount: 'true',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendToAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', [params.zelcashaddress, +params.amount, '', params.commentto, true]);
    });

    it('should call rpc with no commentto param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        zelcashaddress: '1111ZZZZASD',
        amount: '123456',
        comment: 'testcomment',
        substractfeefromamount: 'true',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendToAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', [params.zelcashaddress, +params.amount, params.comment, '', true]);
    });
    it('should call rpc with no subtractfeefromamount param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        zelcashaddress: '1111ZZZZASD',
        amount: '123456',
        comment: 'testcomment',
        commentto: 'testcommentto',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.sendToAddressPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendToAddress', [params.zelcashaddress, +params.amount, params.comment, params.commentto, false]);
    });
  });

  describe('setTxFee tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          amount: '12345',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.setTxFee(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          amount: '12345',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.setTxFee(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.setTxFee(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setTxFee', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.setTxFee(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setTxFee', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          amount: '12345',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.setTxFee(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setTxFee', [+req.params.amount]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          amount: '12345',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.setTxFee(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setTxFee', [+req.query.amount]);
    });
  });

  describe('signMessage tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          taddr: '1ZZZ12345',
          message: 'this is test message',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.signMessage(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          taddr: '1ZZZ12345',
          message: 'this is test message',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceWalletRpcs.signMessage(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.signMessage(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.signMessage(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          taddr: '1ZZZ12345',
          message: 'this is test message',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.signMessage(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', [req.params.taddr, req.params.message]);
    });

    it('should trigger rpc, no taddr in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          message: 'this is test message',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.signMessage(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', []);
    });

    it('should trigger rpc, no message in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          taddr: '1ZZZ12345',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.signMessage(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', []);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          taddr: '1ZZZ12345',
          message: 'this is test message',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.signMessage(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', [req.query.taddr, req.query.message]);
    });
  });

  describe('signMessagePost tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      await daemonServiceWalletRpcs.signMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should call rpc if no params are given', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.signMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', expectedCallParams);
    });

    it('should call rpc with all params', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        taddr: '1ZZZ12345',
        message: 'this is test message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.signMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', [params.taddr, params.message]);
    });

    it('should call rpc with no taddr param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        message: 'this is test message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.signMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', []);
    });

    it('should call rpc with no message param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        taddr: '1ZZZ12345',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceWalletRpcs.signMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'signMessage', []);
    });
  });

  describe('listBanned tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';

      const result = await daemonServiceWalletRpcs.createConfirmationTransaction();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createconfirmationtransaction');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceWalletRpcs.createConfirmationTransaction(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createconfirmationtransaction');
    });
  });
});
