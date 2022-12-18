const sinon = require('sinon');
const { PassThrough } = require('stream');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const daemonServiceAddressRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceAddressRpcs').default;
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => param);
  return res;
};

describe('daemonServiceAddressRpcs tests', () => {
  describe('getAddressTxids tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return transactions\' ids for specified address(es)', async () => {
      daemonServiceUtilsStub.resolves('success');
      const params = {
        addresses: '12QSasdfggYy4sditOpQzsee',
        start: 1670654443,
        end: 167068000,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceAddressRpcs.getAddressTxids(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddresstxids', [params]);
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

      await daemonServiceAddressRpcs.getAddressTxids(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddresstxids', [{ addresses: undefined, start: undefined, end: undefined }]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParamsGiven');
    });
  });

  describe('getSingleAddresssTxids tests', () => {
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
          address: '12QSasdfggYy4sditOpQzsee',
          start: 1670654443,
          end: 167068000,
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.params.address],
        start: req.params.start,
        end: req.params.end,
      };

      const result = await daemonServiceAddressRpcs.getSingleAddresssTxids(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddresstxids', [expectedParams]);
    });

    it('should execute RPC if parameters are passed in query, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          address: '12QSasdfggYy4sditOpQzsee',
          start: 1670654443,
          end: 167068000,
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.query.address],
        start: req.query.start,
        end: req.query.end,
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddresssTxids(req, res);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddresstxids', [expectedParams]);
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
      const expectedParams = {
        addresses: [req.query.address],
        start: req.query.start,
        end: req.query.end,
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddresssTxids(req, res);

      expect(result).to.eql('NoParams');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddresstxids', [expectedParams]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParams');
    });
  });

  describe('getAddressBalance tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call getAddressBalance rpc', async () => {
      daemonServiceUtilsStub.resolves('success');
      const params = {
        addresses: '12QSasdfggYy4sditOpQzsee',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceAddressRpcs.getAddressBalance(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressbalance', [params]);
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

      await daemonServiceAddressRpcs.getAddressBalance(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressbalance', [{ addresses: undefined }]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParamsGiven');
    });
  });

  describe('getSingleAddressBalance tests', () => {
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
          address: '12QSasdfggYy4sditOpQzsee',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.params.address],
      };

      const result = await daemonServiceAddressRpcs.getSingleAddressBalance(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressbalance', [expectedParams]);
    });

    it('should execute RPC if parameters are passed in query, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          address: '12QSasdfggYy4sditOpQzsee',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.query.address],
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddressBalance(req, res);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressbalance', [expectedParams]);
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
      const expectedParams = {
        addresses: [req.query.address],
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddressBalance(req, res);

      expect(result).to.eql('NoParams');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressbalance', [expectedParams]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParams');
    });
  });

  describe('getAddressDeltas tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call getAddressDeltas rpc', async () => {
      daemonServiceUtilsStub.resolves('success');
      const params = {
        addresses: '12QSasdfggYy4sditOpQzsee',
        start: 1670654443,
        end: 167068000,
        chainInfo: 'ethereum',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceAddressRpcs.getAddressDeltas(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressdeltas', [params]);
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

      await daemonServiceAddressRpcs.getAddressDeltas(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressdeltas', [{
        addresses: undefined,
        start: undefined,
        end: undefined,
        chainInfo: undefined,
      }]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParamsGiven');
    });
  });

  describe('getSingleAddressDeltas tests', () => {
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
          address: '12QSasdfggYy4sditOpQzsee',
          start: 1670654443,
          end: 167068000,
          chaininfo: 'ethereum',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.params.address],
        start: req.params.start,
        end: req.params.end,
        chainInfo: req.params.chaininfo,
      };

      const result = await daemonServiceAddressRpcs.getSingleAddressDeltas(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressdeltas', [expectedParams]);
    });

    it('should execute RPC if parameters are passed in query, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          address: '12QSasdfggYy4sditOpQzsee',
          start: 1670654443,
          end: 167068000,
          chaininfo: 'ethereum',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.query.address],
        start: req.query.start,
        end: req.query.end,
        chainInfo: req.query.chaininfo,
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddressDeltas(req, res);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressdeltas', [expectedParams]);
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
      const expectedParams = {
        addresses: [req.query.address],
        start: req.query.start,
        end: req.query.end,
        chainInfo: req.query.chaininfo,
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddressDeltas(req, res);

      expect(result).to.eql('NoParams');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressdeltas', [expectedParams]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParams');
    });
  });

  describe('getAddressUtxos tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call getAddressDeltas rpc', async () => {
      daemonServiceUtilsStub.resolves('success');
      const params = {
        addresses: '12QSasdfggYy4sditOpQzsee',
        chainInfo: 'ethereum',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceAddressRpcs.getAddressUtxos(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressutxos', [params]);
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

      await daemonServiceAddressRpcs.getAddressUtxos(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressutxos', [{ addresses: undefined, chainInfo: undefined }]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParamsGiven');
    });
  });

  describe('getSingleAddressUtxos tests', () => {
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
          address: '12QSasdfggYy4sditOpQzsee',
          chaininfo: 'ethereum',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.params.address],
        chainInfo: req.params.chaininfo,
      };

      const result = await daemonServiceAddressRpcs.getSingleAddressUtxos(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressutxos', [expectedParams]);
    });

    it('should execute RPC if parameters are passed in query, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          address: '12QSasdfggYy4sditOpQzsee',
          chaininfo: 'ethereum',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.query.address],
        chainInfo: req.query.chaininfo,
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddressUtxos(req, res);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressutxos', [expectedParams]);
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
      const expectedParams = {
        addresses: [req.query.address],
        chainInfo: req.query.chaininfo,
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddressUtxos(req, res);

      expect(result).to.eql('NoParams');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressutxos', [expectedParams]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParams');
    });
  });

  describe('getAddressMempool tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call getAddressMempool rpc', async () => {
      daemonServiceUtilsStub.resolves('success');
      const params = {
        addresses: '12QSasdfggYy4sditOpQzsee',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceAddressRpcs.getAddressMempool(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressmempool', [params]);
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

      await daemonServiceAddressRpcs.getAddressMempool(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressmempool', [{ addresses: undefined }]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParamsGiven');
    });
  });

  describe('getSingleAddressMempool tests', () => {
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
          address: '12QSasdfggYy4sditOpQzsee',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.params.address],
      };

      const result = await daemonServiceAddressRpcs.getSingleAddressMempool(req);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressmempool', [expectedParams]);
    });

    it('should execute RPC if parameters are passed in query, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          address: '12QSasdfggYy4sditOpQzsee',
          chaininfo: 'ethereum',
        },
      };
      daemonServiceUtilsStub.returns('success');
      const expectedParams = {
        addresses: [req.query.address],
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddressMempool(req, res);

      expect(result).to.eql('success');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressmempool', [expectedParams]);
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
      const expectedParams = {
        addresses: [req.query.address],
      };
      const res = generateResponse();

      const result = await daemonServiceAddressRpcs.getSingleAddressMempool(req, res);

      expect(result).to.eql('NoParams');
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getaddressmempool', [expectedParams]);
      sinon.assert.calledOnceWithExactly(res.json, 'NoParams');
    });
  });
});
