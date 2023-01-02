import sinon from 'sinon';
import { PassThrough } from 'stream';
import { expect } from 'chai';
import daemonServiceUtils from '../../ZelBack/src/services/daemonService/daemonServiceUtils.js';
import verificationHelper from '../../ZelBack/src/services/verificationHelper.js';
verificationHelper.default;
import serviceHelper from '../../ZelBack/src/services/serviceHelper.js';
import daemonServiceMiningRpcs from '../../ZelBack/src/services/daemonService/daemonServiceMiningRpcs.js';

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceMiningRpcs tests', () => {
  describe('getBlockSubsidy tests', () => {
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

      const result = await daemonServiceMiningRpcs.getBlockSubsidy(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockSubsidy', []);
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

      const result = await daemonServiceMiningRpcs.getBlockSubsidy(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockSubsidy', []);
    });

    it('should trigger rpc, height passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          height: '12345',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getBlockSubsidy(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockSubsidy', [+req.params.height]);
    });

    it('should trigger rpc, height passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          height: '12345',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getBlockSubsidy(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockSubsidy', [+req.query.height]);
    });
  });

  describe('getBlockTemplate tests', () => {
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

      const result = await daemonServiceMiningRpcs.getBlockTemplate(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockTemplate', []);
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

      const result = await daemonServiceMiningRpcs.getBlockTemplate(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockTemplate', []);
    });

    it('should trigger rpc, jsonrequestobject passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const req = {
        params: {
          jsonrequestobject: JSON.stringify(jsonObject),
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getBlockTemplate(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockTemplate', [jsonObject]);
    });

    it('should trigger rpc, jsonrequestobject passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const req = {
        params: {
          test: 'test',
        },
        query: {
          jsonrequestobject: JSON.stringify(jsonObject),
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getBlockTemplate(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getBlockTemplate', [jsonObject]);
    });
  });

  describe('getLocalSolPs tests', () => {
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

      const result = await daemonServiceMiningRpcs.getLocalSolPs();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getLocalSolPs');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getLocalSolPs(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getLocalSolPs');
    });
  });

  describe('getMiningInfo tests', () => {
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

      const result = await daemonServiceMiningRpcs.getMiningInfo();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getMiningInfo');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getMiningInfo(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getMiningInfo');
    });
  });

  describe('getNetworkHashPs tests', () => {
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

      const result = await daemonServiceMiningRpcs.getNetworkHashPs(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkHashPs', [120, -1]);
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

      const result = await daemonServiceMiningRpcs.getNetworkHashPs(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkHashPs', [120, -1]);
    });

    it('should trigger rpc, height passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          height: '12345',
          blocks: '5',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getNetworkHashPs(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkHashPs', [+req.params.blocks, +req.params.height]);
    });

    it('should trigger rpc, height passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          height: '12345',
          blocks: '-5',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getNetworkHashPs(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkHashPs', [+req.query.blocks, +req.query.height]);
    });
  });

  describe('getNetworkSolPs tests', () => {
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

      const result = await daemonServiceMiningRpcs.getNetworkSolPs(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkSolPs', [120, -1]);
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

      const result = await daemonServiceMiningRpcs.getNetworkSolPs(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkSolPs', [120, -1]);
    });

    it('should trigger rpc, height passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          height: '12345',
          blocks: '5',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getNetworkSolPs(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkSolPs', [+req.params.blocks, +req.params.height]);
    });

    it('should trigger rpc, height passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          height: '12345',
          blocks: '-5',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.getNetworkSolPs(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkSolPs', [+req.query.blocks, +req.query.height]);
    });
  });

  describe('prioritiseTransaction tests', () => {
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
          txid: 'ABC212345F09848',
          prioritydelta: '45',
          feedelta: '5',
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

      const result = await daemonServiceMiningRpcs.prioritiseTransaction(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: 'ABC212345F09848',
          prioritydelta: '45',
          feedelta: '5',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.prioritiseTransaction(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'prioritiseTransaction', [req.params.txid, +req.params.prioritydelta, +req.params.feedelta]);
    });

    it('should trigger rpc with dns parameter when no txid is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          prioritydelta: '45',
          feedelta: '5',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.prioritiseTransaction(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'prioritiseTransaction', []);
    });

    it('should trigger rpc with dns parameter when no feedelta is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: 'ABC212345F09848',
          prioritydelta: '45',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.prioritiseTransaction(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'prioritiseTransaction', []);
    });

    it('should trigger rpc without parameters if no prioritydelta is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: 'ABC212345F09848',
          feedelta: '5',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.prioritiseTransaction(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'prioritiseTransaction', []);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          txid: 'ABC212345F09848',
          prioritydelta: '45',
          feedelta: '5',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.prioritiseTransaction(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'prioritiseTransaction', [req.query.txid, +req.query.prioritydelta, +req.query.feedelta]);
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

      const result = await daemonServiceMiningRpcs.prioritiseTransaction(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'prioritiseTransaction', []);
    });

    it('should trigger rpc, all parameters passed in params,  response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          txid: 'ABC212345F09848',
          prioritydelta: '45',
          feedelta: '5',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceMiningRpcs.prioritiseTransaction(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'prioritiseTransaction', [req.params.txid, +req.params.prioritydelta, +req.params.feedelta]);
    });
  });

  describe('submitBlock tests', () => {
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
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const req = {
        params: {
          jsonparametersobject: JSON.stringify(jsonObject),
          hexdata: '0x1209378487347821378712384782561656451604567670acdef',
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

      const result = await daemonServiceMiningRpcs.submitBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const req = {
        params: {
          jsonparametersobject: JSON.stringify(jsonObject),
          hexdata: '0x1209378487347821378712384782561656451604567670acdef',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.submitBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'submitBlock', [req.params.hexdata, jsonObject]);
    });

    it('should trigger rpc with hexdata parameter when no jsonObject is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          hexdata: '0x1209378487347821378712384782561656451604567670acdef',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.submitBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'submitBlock', [req.params.hexdata]);
    });

    it('should trigger rpc without parameters if no hexdata is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const req = {
        params: {
          jsonparametersobject: JSON.stringify(jsonObject),
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.submitBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'submitBlock', []);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const req = {
        params: {
          test: 'test',
        },
        query: {
          jsonparametersobject: JSON.stringify(jsonObject),
          hexdata: '0x1209378487347821378712384782561656451604567670acdef',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceMiningRpcs.submitBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'submitBlock', [req.query.hexdata, jsonObject]);
    });

    it('should trigger rpc, even without params', async () => {
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

      const result = await daemonServiceMiningRpcs.submitBlock(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'submitBlock', []);
    });

    it('should trigger rpc, all parameters passed in params,  response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const req = {
        params: {
          jsonparametersobject: JSON.stringify(jsonObject),
          hexdata: '0x1209378487347821378712384782561656451604567670acdef',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceMiningRpcs.submitBlock(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'submitBlock', [req.params.hexdata, jsonObject]);
    });
  });

  describe('submitBlockPost tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call submitBlock rpc', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.resolves('success');
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const params = {
        jsonparametersobject: JSON.stringify(jsonObject),
        hexdata: '0x1209378487347821378712384782561656451604567670acdef',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceMiningRpcs.submitBlockPost(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'submitBlock', [params.hexdata, jsonObject]);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should call submitBlock rpc no jsonparametersobject passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.resolves('success');
      const params = {
        hexdata: '0x1209378487347821378712384782561656451604567670acdef',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceMiningRpcs.submitBlockPost(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'submitBlock', [params.hexdata]);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should call submitBlock rpc no hexdata passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.resolves('success');
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const params = {
        jsonparametersobject: JSON.stringify(jsonObject),
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceMiningRpcs.submitBlockPost(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'submitBlock', []);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should call submitBlock rpc no params passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.resolves('success');
      const params = {
        test: 'test',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceMiningRpcs.submitBlockPost(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'submitBlock', []);
      sinon.assert.calledOnceWithExactly(res.json, 'success');
    });

    it('should return error if user is unauthorized', async () => {
      verifyPrivilegeStub.returns(false);
      const jsonObject = {
        param1: 'val1',
        param2: 'val2',
      };
      const params = {
        jsonparametersobject: JSON.stringify(jsonObject),
        hexdata: '0x1209378487347821378712384782561656451604567670acdef',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();
      const expectedResponse = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };
      await daemonServiceMiningRpcs.submitBlockPost(mockStream, res);

      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.notCalled(daemonServiceUtilsStub);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });
  });
});
