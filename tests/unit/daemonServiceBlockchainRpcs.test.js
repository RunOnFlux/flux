const sinon = require('sinon');
const { PassThrough } = require('stream');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonServiceUtils');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonServiceBlockchainRpcs = require('../../ZelBack/src/services/daemonServiceBlockchainRpcs');

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceBlockchainRpcs tests', () => {
  describe('getBestBlockHash tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getBestBlockHash();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBestBlockHash');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBestBlockHash(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBestBlockHash');
    });
  });

  describe('getBlock tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getBlock(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlock', [undefined, 2]);
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

      const result = await daemonServiceBlockchainRpcs.getBlock(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlock', [undefined, 2]);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          hashheight: 'testing',
          verbosity: '1',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlock(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlock', [req.params.hashheight, +req.params.verbosity]);
    });

    it('should trigger rpc, data passed in params, no verbosity provided, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          hashheight: 'testing',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlock(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlock', [req.params.hashheight, 2]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          hashheight: 'testing',
          verbosity: '1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlock(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlock', [req.query.hashheight, +req.query.verbosity]);
    });
  });

  describe('getBlockchainInfo tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getBlockchainInfo();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockchainInfo');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockchainInfo(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockchainInfo');
    });
  });

  describe('getBlockCount tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getBlockCount();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockCount');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockCount(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockCount');
    });
  });

  describe('getBlockHash tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getBlockHash(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHash', []);
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

      const result = await daemonServiceBlockchainRpcs.getBlockHash(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHash', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          index: '1234',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHash(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHash', [+req.params.index]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          index: '12345',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHash(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHash', [+req.query.index]);
    });
  });

  describe('getBlockDeltas tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getBlockDeltas(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockdeltas', []);
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

      const result = await daemonServiceBlockchainRpcs.getBlockDeltas(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockdeltas', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          hash: '1234',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockDeltas(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockdeltas', [req.params.hash]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          hash: '12345',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockDeltas(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockdeltas', [req.query.hash]);
    });
  });

  describe('getBlockHashes tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getBlockHashes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', []);
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

      const result = await daemonServiceBlockchainRpcs.getBlockHashes(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          high: '99',
          low: '1',
          noOrphans: 'true',
          logicalTimes: 'false',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHashes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', [+req.params.high, +req.params.low, { noOrphans: true, logicalTimes: false }]);
    });

    it('should trigger rpc, data passed in params, no logicalTimes param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          high: '99',
          low: '1',
          noOrphans: 'true',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHashes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', [+req.params.high, +req.params.low, { noOrphans: true }]);
    });

    it('should trigger rpc, data passed in params, no noOrphans param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          high: '99',
          low: '1',
          logicalTimes: 'false',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHashes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', [+req.params.high, +req.params.low, { logicalTimes: false }]);
    });

    it('should trigger rpc, data passed in params, no low param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          high: '99',
          noOrphans: 'true',
          logicalTimes: 'false',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHashes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', [+req.params.high, { noOrphans: true, logicalTimes: false }]);
    });

    it('should trigger rpc, data passed in params, no high param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          low: '1',
          noOrphans: 'true',
          logicalTimes: 'false',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHashes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', [+req.params.low, { noOrphans: true, logicalTimes: false }]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          high: '99',
          low: '1',
          noOrphans: 'true',
          logicalTimes: 'false',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHashes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', [+req.query.high, +req.query.low, { noOrphans: true, logicalTimes: false }]);
    });
  });

  describe('getBlockHashesPost tests', () => {
    let daemonServiceUtilsStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call getblockhashes if no params are given', async () => {
      const params = {
      };
      const expectedCallParams = [undefined, undefined];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceBlockchainRpcs.getBlockHashesPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', expectedCallParams);
    });

    it('should call getblockhashes with all params', async () => {
      const params = {
        high: '99',
        low: '1',
        options: { noOrphans: true, logicalTimes: false },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceBlockchainRpcs.getBlockHashesPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', [params.high, params.low, params.options]);
    });

    it('should call with no options', async () => {
      const params = {
        high: '99',
        low: '1',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceBlockchainRpcs.getBlockHashesPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getblockhashes', [params.high, params.low]);
    });
  });

  describe('getBlockHeader tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getBlockHeader(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHeader', []);
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

      const result = await daemonServiceBlockchainRpcs.getBlockHeader(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHeader', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          hash: '180457923ACDF99',
          verbose: false,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHeader(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHeader', [req.params.hash, req.params.verbose]);
    });

    it('should trigger rpc, data passed in params, no hash param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          verbose: true,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHeader(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHeader', []);
    });

    it('should trigger rpc, data passed in params, no verbose param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          hash: '180457923ACDF99',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHeader(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHeader', [req.params.hash, true]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          hash: '180457923ACDF99',
          verbose: true,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getBlockHeader(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockHeader', [req.query.hash, req.query.verbose]);
    });
  });

  describe('getChainTips tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getChainTips();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getChainTips');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getChainTips(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getChainTips');
    });
  });

  describe('getDifficulty tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getDifficulty();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getDifficulty');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getDifficulty(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getDifficulty');
    });
  });

  describe('getMempoolInfo tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getMempoolInfo();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getMempoolInfo');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getMempoolInfo(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getMempoolInfo');
    });
  });

  describe('getRawMemPool tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getRawMemPool(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawMemPool', [false]);
    });

    it('should trigger rpc,no params, response passed', async () => {
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

      const result = await daemonServiceBlockchainRpcs.getRawMemPool(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawMemPool', [false]);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          verbose: true,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getRawMemPool(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawMemPool', [req.params.verbose]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          verbose: true,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getRawMemPool(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getRawMemPool', [req.query.verbose]);
    });
  });

  describe('getTxOut tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getTxOut(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOut', []);
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

      const result = await daemonServiceBlockchainRpcs.getTxOut(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOut', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: '123490856ACFE',
          n: 3,
          includemempool: false,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOut(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOut', [req.params.txid, req.params.n, req.params.includemempool]);
    });

    it('should trigger rpc, data passed in params, no includemempool param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: '123490856ACFE',
          n: 3,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOut(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOut', [req.params.txid, req.params.n, true]);
    });

    it('should trigger rpc, data passed in params, no n parameter, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: '123490856ACFE',
          includemempool: false,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOut(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOut', []);
    });

    it('should trigger rpc, data passed in params, no txid, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          n: 3,
          includemempool: false,
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOut(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOut', []);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          txid: '123490856ACFE',
          n: 3,
          includemempool: false,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOut(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOut', [req.query.txid, req.query.n, req.query.includemempool]);
    });
  });

  describe('getTxOutProof tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getTxOutProof(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOutProof', []);
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

      const result = await daemonServiceBlockchainRpcs.getTxOutProof(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOutProof', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txids: '123490856ACFE, AA3490856ACFE, BB3490856ACFE',
          blockhash: '809123477801234178902343',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOutProof(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOutProof', [req.params.txids.split(','), req.params.blockhash]);
    });

    it('should trigger rpc, data passed in params, no blockhash param, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txids: '123490856ACFE, AA3490856ACFE, BB3490856ACFE',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOutProof(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOutProof', [req.params.txids.split(',')]);
    });

    it('should trigger rpc, data passed in params, no txids parameter, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          blockhash: '809123477801234178902343',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOutProof(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOutProof', []);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          txids: '123490856ACFE, AA3490856ACFE, BB3490856ACFE',
          blockhash: '809123477801234178902343',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOutProof(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOutProof', [req.query.txids.split(','), req.query.blockhash]);
    });
  });

  describe('getTxOutSetInfo tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.getTxOutSetInfo();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOutSetInfo');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.getTxOutSetInfo(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getTxOutSetInfo');
    });
  });

  describe('verifyChain tests', () => {
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
          checklevel: '1',
          numblocks: '233',
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

      const result = await daemonServiceBlockchainRpcs.verifyChain(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          checklevel: '1',
          numblocks: '233',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.verifyChain(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyChain', [+req.params.checklevel, +req.params.numblocks]);
    });

    it('should trigger rpc with dns parameter when no numblocks is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          checklevel: '1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.verifyChain(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyChain', [+req.params.checklevel, 288]);
    });

    it('should trigger rpc without parameters if no checklevel is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          numblocks: '233',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.verifyChain(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyChain', [3, +req.params.numblocks]);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          checklevel: '1',
          numblocks: '233',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.verifyChain(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyChain', [+req.query.checklevel, +req.query.numblocks]);
    });

    it('should trigger rpc, even without params', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test1: 'node1',
          test2: 'myCommand',
        },
        query: {
          test: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.verifyChain(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyChain', [3, 288]);
    });

    it('should trigger rpc, all parameters passed in params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          checklevel: '1',
          numblocks: '233',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceBlockchainRpcs.verifyChain(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyChain', [+req.params.checklevel, +req.params.numblocks]);
    });
  });

  describe('verifyTxOutProof tests', () => {
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

      const result = await daemonServiceBlockchainRpcs.verifyTxOutProof(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyTxOutProof', []);
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

      const result = await daemonServiceBlockchainRpcs.verifyTxOutProof(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyTxOutProof', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          proof: '123089123781237890ACFDE',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.verifyTxOutProof(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyTxOutProof', [req.params.proof]);
    });

    it('should trigger rpc, data passed in params, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          proof: '123089123781237890ACFDE',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceBlockchainRpcs.verifyTxOutProof(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyTxOutProof', [req.params.proof]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          proof: '123089123781237890ACFDE',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceBlockchainRpcs.verifyTxOutProof(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'verifyTxOutProof', [req.query.proof]);
    });
  });

  describe('getSpentInfo tests', () => {
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
      const expectedParameters = [{ txid: undefined, index: NaN }];

      const result = await daemonServiceBlockchainRpcs.getSpentInfo(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', expectedParameters);
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
      const expectedParameters = [{ txid: undefined, index: NaN }];

      const result = await daemonServiceBlockchainRpcs.getSpentInfo(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', expectedParameters);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: '123089123781237890ACFDE',
          index: '3',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';
      const expectedParameters = [{ txid: '123089123781237890ACFDE', index: 3 }];

      const result = await daemonServiceBlockchainRpcs.getSpentInfo(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', expectedParameters);
    });

    it('should trigger rpc, data passed in params, no txid, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          index: '3',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';
      const expectedParameters = [{ txid: undefined, index: 3 }];

      const result = await daemonServiceBlockchainRpcs.getSpentInfo(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', expectedParameters);
    });

    it('should trigger rpc, data passed in params, no index, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: '123089123781237890ACFDE',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';
      const expectedParameters = [{ txid: '123089123781237890ACFDE', index: NaN }];

      const result = await daemonServiceBlockchainRpcs.getSpentInfo(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', expectedParameters);
    });

    it('should trigger rpc, data passed in params, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: '123089123781237890ACFDE',
          index: '3',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();
      const expectedParameters = [{ txid: '123089123781237890ACFDE', index: 3 }];

      const result = await daemonServiceBlockchainRpcs.getSpentInfo(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', expectedParameters);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          txid: '123089123781237890ACFDE',
          index: '3',
        },
      };
      const expectedResponse = 'success';
      const expectedParameters = [{ txid: '123089123781237890ACFDE', index: 3 }];

      const result = await daemonServiceBlockchainRpcs.getSpentInfo(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', expectedParameters);
    });
  });

  describe('getSpentInfoPost tests', () => {
    let daemonServiceUtilsStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call getspentinfo if no params are given', async () => {
      const params = {
      };
      const expectedCallParams = [{ txid: undefined, index: NaN }];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceBlockchainRpcs.getSpentInfoPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', expectedCallParams);
    });

    it('should call getspentinfo with all params', async () => {
      const params = {
        txid: '123089123781237890ACFDE',
        index: '3',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceBlockchainRpcs.getSpentInfoPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', [{ txid: '123089123781237890ACFDE', index: 3 }]);
    });

    it('should call getspentinfo with no index', async () => {
      const params = {
        txid: '123089123781237890ACFDE',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceBlockchainRpcs.getSpentInfoPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', [{ txid: '123089123781237890ACFDE', index: NaN }]);
    });

    it('should call rpc with no txid', async () => {
      const params = {
        index: '3',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceBlockchainRpcs.getSpentInfoPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getspentinfo', [{ txid: undefined, index: 3 }]);
    });
  });
});
