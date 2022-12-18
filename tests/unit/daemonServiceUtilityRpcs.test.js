const sinon = require('sinon');
const { PassThrough } = require('stream');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonServiceUtilityRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceUtilityRpcs').default;
const verificationHelper = require('../../ZelBack/src/services/verificationHelper').default;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceUtilityRpcs tests', () => {
  describe('createMultiSig tests', () => {
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

      const result = await daemonServiceUtilityRpcs.createMultiSig(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', []);
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

      const result = await daemonServiceUtilityRpcs.createMultiSig(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          n: '12345',
          keys: {
            key1: 'key1',
            key2: 'key2',
          },
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.createMultiSig(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', [+req.params.n, req.params.keys]);
    });

    it('should trigger rpc, no n param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          keys: {
            key1: 'key1',
            key2: 'key2',
          },
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.createMultiSig(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', []);
    });

    it('should trigger rpc, no keys param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          n: '12345',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.createMultiSig(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', []);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          n: '12345',
          keys: {
            key1: 'key1',
            key2: 'key2',
          },
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.createMultiSig(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', [+req.query.n, req.query.keys]);
    });
  });

  describe('createMultiSigPost tests', () => {
    let daemonServiceUtilsStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call createMultiSig if no params are given', async () => {
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceUtilityRpcs.createMultiSigPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', expectedCallParams);
    });

    it('should call createMultiSig with all params', async () => {
      const params = {
        n: '12345',
        keys: {
          key1: 'key1',
          key2: 'key2',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceUtilityRpcs.createMultiSigPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', [+params.n, params.keys]);
    });

    it('should call createMultiSig with no keys param', async () => {
      const params = {
        n: '12345',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceUtilityRpcs.createMultiSigPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', []);
    });

    it('should call rpc with no n param', async () => {
      const params = {
        keys: {
          key1: 'key1',
          key2: 'key2',
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceUtilityRpcs.createMultiSigPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createMultiSig', []);
    });
  });

  describe('estimateFee tests', () => {
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

      const result = await daemonServiceUtilityRpcs.estimateFee(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'estimateFee', []);
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

      const result = await daemonServiceUtilityRpcs.estimateFee(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'estimateFee', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          nblocks: '12345',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.estimateFee(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'estimateFee', [+req.params.nblocks]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          nblocks: '12345',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.estimateFee(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'estimateFee', [+req.query.nblocks]);
    });
  });

  describe('estimatePriority tests', () => {
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

      const result = await daemonServiceUtilityRpcs.estimatePriority(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'estimatePriority', []);
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

      const result = await daemonServiceUtilityRpcs.estimatePriority(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'estimatePriority', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          nblocks: '12345',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.estimatePriority(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'estimatePriority', [+req.params.nblocks]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          nblocks: '12345',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.estimatePriority(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'estimatePriority', [+req.query.nblocks]);
    });
  });

  describe('validateAddress tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').returns({
        data: {
          test: 'test1',
          ismine: true,
          iswatchonly: true,
        },
      });
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call rpc, no response, all params in req', async () => {
      const req = {
        params: {
          zelcashaddress: 'ACEFDABB1235AAC',
        },
      };
      const expectedResult = {
        data: {
          test: 'test1',
        },
      };
      const result = await daemonServiceUtilityRpcs.validateAddress(req);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'validateAddress', [req.params.zelcashaddress]);
    });

    it('should call rpc, no response, all params in query', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          zelcashaddress: 'ACEFDABB1235AAC',
        },
      };
      const expectedResult = {
        data: {
          test: 'test1',
        },
      };
      const result = await daemonServiceUtilityRpcs.validateAddress(req);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'validateAddress', [req.query.zelcashaddress]);
    });

    it('should call rpc, no response, no params in req', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResult = {
        data: {
          test: 'test1',
        },
      };
      const result = await daemonServiceUtilityRpcs.validateAddress(req);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'validateAddress', []);
    });

    it('should trigger rpc, all parameters passed in params, response passed, user is not admin', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          zelcashaddress: 'ACEFDABB1235AAC',
        },
      };
      const expectedResult = {
        data: {
          test: 'test1',
        },
      };
      const res = generateResponse();

      const result = await daemonServiceUtilityRpcs.validateAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResult}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'validateAddress', [req.params.zelcashaddress]);
    });

    it('should trigger rpc, all parameters passed in params, response passed, user is admin', async () => {
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          zelcashaddress: 'ACEFDABB1235AAC',
        },
      };
      const expectedResult = {
        data: {
          test: 'test1',
          ismine: true,
          iswatchonly: true,
        },
      };
      const res = generateResponse();

      const result = await daemonServiceUtilityRpcs.validateAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResult}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'validateAddress', [req.params.zelcashaddress]);
    });
  });

  describe('verifyMessage tests', () => {
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

      const result = await daemonServiceUtilityRpcs.verifyMessage(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
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

      const result = await daemonServiceUtilityRpcs.verifyMessage(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashaddress: '112376589445679ACFED',
          signature: '76589445679ACFED',
          message: 'my test message',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.verifyMessage(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', [req.params.zelcashaddress, req.params.signature, req.params.message]);
    });

    it('should trigger rpc, data passed in params, no zelcashaddress param,, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          signature: '76589445679ACFED',
          message: 'my test message',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.verifyMessage(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', []);
    });

    it('should trigger rpc, data passed in params, no signature param,, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashaddress: '112376589445679ACFED',
          message: 'my test message',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.verifyMessage(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', []);
    });

    it('should trigger rpc, data passed in params, no message param,, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zelcashaddress: '112376589445679ACFED',
          signature: '76589445679ACFED',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.verifyMessage(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', []);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          zelcashaddress: '112376589445679ACFED',
          signature: '76589445679ACFED',
          message: 'my test message',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.verifyMessage(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', [req.query.zelcashaddress, req.query.signature, req.query.message]);
    });
  });

  describe('zValidateAddress tests', () => {
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

      const result = await daemonServiceUtilityRpcs.zValidateAddress(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_validateaddress', []);
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

      const result = await daemonServiceUtilityRpcs.zValidateAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_validateaddress', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zaddr: '12345',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.zValidateAddress(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_validateaddress', [req.params.zaddr]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          zaddr: '12345',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceUtilityRpcs.zValidateAddress(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_validateaddress', [req.query.zaddr]);
    });
  });

  describe('verifyMessagePost tests', () => {
    let daemonServiceUtilsStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call verifyMessage if no params are given', async () => {
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceUtilityRpcs.verifyMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', expectedCallParams);
    });

    it('should call verifyMessage with all params', async () => {
      const params = {
        zelcashaddress: '112376589445679ACFED',
        signature: '76589445679ACFED',
        message: 'my test message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceUtilityRpcs.verifyMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', [params.zelcashaddress, params.signature, params.message]);
    });

    it('should call createMultiSig with no keys param', async () => {
      const params = {
        zelcashaddress: '112376589445679ACFED',
        signature: '76589445679ACFED',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceUtilityRpcs.verifyMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', []);
    });

    it('should call rpc with no n param', async () => {
      const params = {
        zelcashaddress: '112376589445679ACFED',
        message: 'my test message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceUtilityRpcs.verifyMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', []);
    });

    it('should call rpc with no n param', async () => {
      const params = {
        signature: '76589445679ACFED',
        message: 'my test message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceUtilityRpcs.verifyMessagePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyMessage', []);
    });
  });
});
