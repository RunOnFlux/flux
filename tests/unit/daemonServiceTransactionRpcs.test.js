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

  describe('createRawTransactionPost tests', () => {
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

    it('should create a raw transaction if no expiryheight is given', async () => {
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
      };
      const expectedCallParams = [
        { test: 'testtransaction', something: 'somethingelse' },
        { addr1: '1235asdf', addr2: '12344aaaa' },
        5999,
        524342220,
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

  describe('decodeRawTransactionPost tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call decodeRawTransaction rpc', async () => {
      daemonServiceUtilsStub.resolves('success');
      const params = {
        hexstring: '0x412368904412378BAF',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceTransactionRpcs.decodeRawTransactionPost(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'decodeRawTransaction', [params.hexstring]);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should call rpc even without parameters', async () => {
      daemonServiceUtilsStub.resolves('NoParamsGiven');
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceTransactionRpcs.decodeRawTransactionPost(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'decodeRawTransaction', []);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParamsGiven');
    });
  });

  describe('decodeScript tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should execute RPC if parameters are passed in params, no response passed', async () => {
      const req = {
        params: {
          hex: '0x412368904412378BAF',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.params.hex];

      const result = await daemonServiceTransactionRpcs.decodeScript(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'decodeScript', expectedParams);
    });

    it('should execute RPC if parameters are passed in query, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          hex: '0x412368904412378BAF',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.query.hex];

      const res = generateResponse();

      const result = await daemonServiceTransactionRpcs.decodeScript(req, res);

      expect(result).to.eql('Response: success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'decodeScript', expectedParams);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should execute RPC if no params are given', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',

        },
      };
      daemonServiceUtilsStub.returns('NoParams');
      const res = generateResponse();

      const result = await daemonServiceTransactionRpcs.decodeScript(req, res);

      expect(result).to.eql('Response: NoParams');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'decodeScript', []);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParams');
    });
  });

  describe('fundRawTransaction tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should execute RPC if parameters are passed in params, no response passed', async () => {
      const req = {
        params: {
          hexstring: '0x412368904412378BAF',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.params.hexstring];

      const result = await daemonServiceTransactionRpcs.fundRawTransaction(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'fundRawTransaction', expectedParams);
    });

    it('should execute RPC if parameters are passed in query, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          hexstring: '0x412368904412378BAF',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.query.hexstring];

      const res = generateResponse();

      const result = await daemonServiceTransactionRpcs.fundRawTransaction(req, res);

      expect(result).to.eql('Response: success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'fundRawTransaction', expectedParams);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should execute RPC if no params are given', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',

        },
      };
      daemonServiceUtilsStub.returns('NoParams');
      const res = generateResponse();

      const result = await daemonServiceTransactionRpcs.fundRawTransaction(req, res);

      expect(result).to.eql('Response: NoParams');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'fundRawTransaction', []);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParams');
    });
  });

  describe('fundRawTransactionPost tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call decodeRawTransaction rpc', async () => {
      daemonServiceUtilsStub.resolves('success');
      const params = {
        hexstring: '0x412368904412378BAF',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceTransactionRpcs.fundRawTransactionPost(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'fundRawTransaction', [params.hexstring]);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should call rpc even without parameters', async () => {
      daemonServiceUtilsStub.resolves('NoParamsGiven');
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceTransactionRpcs.fundRawTransactionPost(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'fundRawTransaction', []);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParamsGiven');
    });
  });

  describe('getRawTransaction tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should execute RPC if parameters are passed in params, no response passed', async () => {
      const req = {
        params: {
          txid: '0x412368904412378BAF',
          verbose: 1,
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.params.txid, req.params.verbose];

      const result = await daemonServiceTransactionRpcs.getRawTransaction(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawTransaction', expectedParams);
    });

    it('should execute RPC if parameters are passed in query, no verbose param, no response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          txid: '0x412368904412378BAF',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.query.txid, 0];

      const result = await daemonServiceTransactionRpcs.getRawTransaction(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawTransaction', expectedParams);
    });

    it('should execute RPC if parameters are passed in query, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          txid: '0x412368904412378BAF',
          verbose: 1,
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.query.txid, req.query.verbose];

      const res = generateResponse();

      const result = await daemonServiceTransactionRpcs.getRawTransaction(req, res);

      expect(result).to.eql('Response: success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawTransaction', expectedParams);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should execute RPC if no params are given', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      daemonServiceUtilsStub.returns('NoParams');
      const res = generateResponse();

      const result = await daemonServiceTransactionRpcs.getRawTransaction(req, res);

      expect(result).to.eql('Response: NoParams');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawTransaction', []);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParams');
    });
  });

  describe('sendRawTransaction tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should execute RPC if parameters are passed in params, no response passed', async () => {
      const req = {
        params: {
          hexstring: '0x412368904412378BAF',
          allowhighfees: true,
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.params.hexstring, req.params.allowhighfees];

      const result = await daemonServiceTransactionRpcs.sendRawTransaction(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendRawTransaction', expectedParams);
    });

    it('should execute RPC if parameters are passed in query, no allowhighfees param, no response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          hexstring: '0x412368904412378BAF',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.query.hexstring, false];

      const result = await daemonServiceTransactionRpcs.sendRawTransaction(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendRawTransaction', expectedParams);
    });

    it('should execute RPC if parameters are passed in query, allohighfees as a string, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          hexstring: '0x412368904412378BAF',
          allowhighfees: 'true',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = [req.query.hexstring, true];

      const res = generateResponse();

      const result = await daemonServiceTransactionRpcs.sendRawTransaction(req, res);

      expect(result).to.eql('Response: success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendRawTransaction', expectedParams);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should execute RPC if no params are given', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      daemonServiceUtilsStub.returns('NoParams');
      const res = generateResponse();

      const result = await daemonServiceTransactionRpcs.sendRawTransaction(req, res);

      expect(result).to.eql('Response: NoParams');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'sendRawTransaction', []);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParams');
    });
  });
});
