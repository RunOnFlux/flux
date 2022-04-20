const chai = require('chai');
const sinon = require('sinon');
const LRU = require('lru-cache');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonServiceUtils');
const client = require('../../ZelBack/src/services/utils/daemonrpcClient').default;

const { expect } = chai;

describe('daemonServiceUtils tests', () => {
  describe('executeCall tests', () => {
    let getSpy;
    beforeEach(() => {
      getSpy = sinon.spy(LRU.prototype, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return getBlock from cache if it exists', async () => {
      const rpc = 'getBlock';
      const params = ['testing1', 'testing2'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      daemonServiceUtils.setBlockCache(key, data);

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
    });

    it('should return getRawTransaction from cache if it exists', async () => {
      const rpc = 'getRawTransaction';
      const params = ['testing3', 'testing4'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      daemonServiceUtils.setRawTxCache(key, data);

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
    });

    it('should return data from cache if it exists', async () => {
      const rpc = 'getInfo';
      const params = ['testing3', 'testing4'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      daemonServiceUtils.setStandardCache(key, data);

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
    });

    it('should call rpc client if getBlock data is not cached ', async () => {
      const rpc = 'getBlock';
      const params = ['getBlockParam'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      const daemonRpcClientStub = sinon.stub(client, rpc).returns(data);

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
      sinon.assert.calledOnceWithExactly(daemonRpcClientStub, ...params);
      expect(daemonServiceUtils.getBlockCache(key)).to.eql(data);
    });

    it('should call rpc client if getRawTransaction data is not cached ', async () => {
      const rpc = 'getRawTransaction';
      const params = ['getRawTransactionParam'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      const daemonRpcClientStub = sinon.stub(client, rpc).returns(data);

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
      sinon.assert.calledOnceWithExactly(daemonRpcClientStub, ...params);
      expect(daemonServiceUtils.getRawTxCacheCache(key)).to.eql(data);
    });

    it('should call rpc client if any other rpc call data is not cached ', async () => {
      const rpc = 'getInfo';
      const params = ['testingcallParam'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      const daemonRpcClientStub = sinon.stub(client, rpc).returns(data);

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
      sinon.assert.calledOnceWithExactly(daemonRpcClientStub, ...params);
      expect(daemonServiceUtils.getStandardCache(key)).to.eql(data);
    });

    it('should return an error message if rpc call throws an error', async () => {
      const rpc = 'getInfo';
      const params = ['someParameterGetinfo'];
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          message: 'Error',
          name: 'Error',
        },
      };
      sinon.stub(client, rpc).throws();

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedErrorMessage);
    });
  });
});
