const sinon = require('sinon');
const { PassThrough } = require('stream');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonServiceUtils');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonServiceTransactionRpcs = require('../../ZelBack/src/services/daemonServiceTransactionRpcs');
const client = require('../../ZelBack/src/services/utils/daemonrpcClient').default;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe.only('daemonServiceTransactionRpcs tests', () => {
  describe('createRawTransaction tests', () => {
    let daemonServiceUtilsStub;
    let clientStub;
    const execCallResult = 'RPC call executed';
    beforeEach(() => {
      clientStub = sinon.stub(client, 'getBlockCount');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create a raw transaction if all parameters are set properly - response passed', async () => {
      clientStub.resolves('5243422');
      const req = {
        params: {
          transactions: {
            test: 'testtransaction',
            something: 'somethingelse',
          },
          addresses: {
            addr1: '1235asdf',
            addr2: '12344aaaa',
          },
          locktime: 5999,
          expiryheight: 1234677,
        },
      };
      const res = generateResponse();
      const result = await daemonServiceTransactionRpcs.createRawTransaction(req, res);
      const expectedCallParams = [
        { test: 'testtransaction', something: 'somethingelse' },
        { addr1: '1235asdf', addr2: '12344aaaa' },
        5999,
        1234677,
      ];

      expect(result).to.equal(`Response: ${execCallResult}`);
      sinon.assert.calledOnce(clientStub);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createRawTransaction', expectedCallParams);
    });

    it('should create a raw transaction if all parameters are set properly - no response passed', async () => {
      clientStub.resolves('5243422');
      const req = {
        params: {
          transactions: {
            test: 'testtransaction',
            something: 'somethingelse',
          },
          addresses: {
            addr1: '1235asdf',
            addr2: '12344aaaa',
          },
          locktime: 5999,
          expiryheight: 1234677,
        },
      };
      const result = await daemonServiceTransactionRpcs.createRawTransaction(req);
      const expectedCallParams = [
        { test: 'testtransaction', something: 'somethingelse' },
        { addr1: '1235asdf', addr2: '12344aaaa' },
        5999,
        1234677,
      ];

      expect(result).to.equal(execCallResult);
      sinon.assert.calledOnce(clientStub);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createRawTransaction', expectedCallParams);
    });

    it('should create a raw transaction if all parameters are set properly, passed in query - no response passed', async () => {
      clientStub.resolves('5243422');
      const req = {
        params: {
          param1: 'test',
        },
        query: {
          transactions: {
            test: 'testtransaction',
            something: 'somethingelse',
          },
          addresses: {
            addr1: '1235asdf',
            addr2: '12344aaaa',
          },
          locktime: 5999,
          expiryheight: 1234677,
        },
      };
      const result = await daemonServiceTransactionRpcs.createRawTransaction(req);
      const expectedCallParams = [
        { test: 'testtransaction', something: 'somethingelse' },
        { addr1: '1235asdf', addr2: '12344aaaa' },
        5999,
        1234677,
      ];

      expect(result).to.equal(execCallResult);
      sinon.assert.calledOnce(clientStub);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createRawTransaction', expectedCallParams);
    });

    it('should create a raw transaction if no expiryheight is passed - no response passed', async () => {
      clientStub.resolves('5243422');
      const req = {
        params: {
          param1: 'test',
        },
        query: {
          transactions: {
            test: 'testtransaction',
            something: 'somethingelse',
          },
          addresses: {
            addr1: '1235asdf',
            addr2: '12344aaaa',
          },
          locktime: 5999,
        },
      };
      const result = await daemonServiceTransactionRpcs.createRawTransaction(req);
      const expectedCallParams = [
        { test: 'testtransaction', something: 'somethingelse' },
        { addr1: '1235asdf', addr2: '12344aaaa' },
        5999,
        524342220,
      ];

      expect(result).to.equal(execCallResult);
      sinon.assert.calledOnce(clientStub);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createRawTransaction', expectedCallParams);
    });

    it('should create a raw transaction if no locktime is passed - no response passed', async () => {
      clientStub.resolves('5243422');
      const req = {
        params: {
          param1: 'test',
        },
        query: {
          transactions: {
            test: 'testtransaction',
            something: 'somethingelse',
          },
          addresses: {
            addr1: '1235asdf',
            addr2: '12344aaaa',
          },
          expiryheight: 1234677,
        },
      };
      const result = await daemonServiceTransactionRpcs.createRawTransaction(req);
      const expectedCallParams = [
        { test: 'testtransaction', something: 'somethingelse' },
        { addr1: '1235asdf', addr2: '12344aaaa' },
        0,
        1234677,
      ];

      expect(result).to.equal(execCallResult);
      sinon.assert.calledOnce(clientStub);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createRawTransaction', expectedCallParams);
    });

    it('should return error message if client rejects promise', async () => {
      clientStub.rejects('Error message!');
      const req = {
        params: {
          param1: 'test',
        },
        query: {
          transactions: {
            test: 'testtransaction',
            something: 'somethingelse',
          },
          addresses: {
            addr1: '1235asdf',
            addr2: '12344aaaa',
          },
          expiryheight: 1234677,
        },
      };
      const expectedResult = {
        status: 'error',
        data: {
          code: undefined,
          message: 'Unknown error',
          name: 'Error message!',
        },
      };

      const result = await daemonServiceTransactionRpcs.createRawTransaction(req);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnce(clientStub);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });
  });

  describe.only('createRawTransactionPost tests', () => {
    let daemonServiceUtilsStub;
    let clientStub;
    const execCallResult = 'RPC call executed';
    beforeEach(() => {
      clientStub = sinon.stub(client, 'getBlockCount');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create a raw transaction if all parameters are set properly', async () => {
      clientStub.resolves('5243422');
      const params = {
        transactions: {
          test: 'testtransaction',
          something: 'somethingelse',
        },
        addresses: {
          addr1: '1235asdf',
          addr2: '12344aaaa',
        },
        locktime: 5999,
        expiryheight: 1234677,
      };
      const expectedCallParams = [
        { test: 'testtransaction', something: 'somethingelse' },
        { addr1: '1235asdf', addr2: '12344aaaa' },
        5999,
        1234677,
      ];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceTransactionRpcs.createRawTransactionPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createRawTransaction', expectedCallParams);
    });

    it('should create a raw transaction if no locktime is given', async () => {
      clientStub.resolves('5243422');
      const params = {
        transactions: {
          test: 'testtransaction',
          something: 'somethingelse',
        },
        addresses: {
          addr1: '1235asdf',
          addr2: '12344aaaa',
        },
        expiryheight: 1234677,
      };
      const expectedCallParams = [
        { test: 'testtransaction', something: 'somethingelse' },
        { addr1: '1235asdf', addr2: '12344aaaa' },
        0,
        1234677,
      ];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceTransactionRpcs.createRawTransactionPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createRawTransaction', expectedCallParams);
    });

    it('should return an error message if client rejects the promise', async () => {
      clientStub.rejects('New Error!');
      const params = {
        transactions: {
          test: 'testtransaction',
          something: 'somethingelse',
        },
        addresses: {
          addr1: '1235asdf',
          addr2: '12344aaaa',
        },
        expiryheight: 1234677,
      };
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'New Error!',
          message: 'Unknown error',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceTransactionRpcs.createRawTransactionPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });
  });
});
