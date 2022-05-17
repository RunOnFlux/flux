const sinon = require('sinon');
const { PassThrough } = require('stream');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonServiceUtils');
const daemonServiceWalletRpcs = require('../../ZelBack/src/services/daemonServiceWalletRpcs');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe.only('daemonServiceWalletRpcs tests', () => {
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
});
