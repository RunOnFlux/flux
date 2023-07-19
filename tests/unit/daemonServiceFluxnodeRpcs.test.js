const sinon = require('sinon');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const daemonServiceFluxnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceFluxnodeRpcs');

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceFluxnodeRpcs tests', () => {
  describe('getFluxNodeStatus tests', () => {
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

      const result = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodestatus');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.getFluxNodeStatus(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodestatus');
    });
  });

  describe('getFluxNodeCount tests', () => {
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

      const result = await daemonServiceFluxnodeRpcs.getFluxNodeCount();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodecount');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.getFluxNodeCount(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodecount');
    });
  });

  describe('getDOSList tests', () => {
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

      const result = await daemonServiceFluxnodeRpcs.getDOSList();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getdoslist');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.getDOSList(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getdoslist');
    });
  });

  describe('getStartList tests', () => {
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

      const result = await daemonServiceFluxnodeRpcs.getStartList();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getstartlist');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.getStartList(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getstartlist');
    });
  });

  describe('fluxNodeCurrentWinner tests', () => {
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

      const result = await daemonServiceFluxnodeRpcs.fluxNodeCurrentWinner();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zelnodecurrentwinner');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.fluxNodeCurrentWinner(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zelnodecurrentwinner');
    });
  });

  describe('listFluxNodes tests', () => {
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

      const result = await daemonServiceFluxnodeRpcs.listFluxNodes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodes', []);
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

      const result = await daemonServiceFluxnodeRpcs.listFluxNodes(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodes', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'testing',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.listFluxNodes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodes', [req.params.filter]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          filter: 'testing',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.listFluxNodes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodes', [req.query.filter]);
    });
  });

  describe('viewDeterministicFluxNodeList tests', () => {
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

      const result = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'viewdeterministiczelnodelist', []);
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

      const result = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'viewdeterministiczelnodelist', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'viewdeterministiczelnodelist', [req.params.filter]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          filter: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'viewdeterministiczelnodelist', [req.query.filter]);
    });
  });

  describe('listFluxNodeConf tests', () => {
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
          filter: 'testfilter',
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

      const result = await daemonServiceFluxnodeRpcs.listFluxNodeConf(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'testfilter',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.listFluxNodeConf(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodeconf', [req.params.filter]);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          filter: 'testfilter',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.listFluxNodeConf(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodeconf', [req.query.filter]);
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

      const result = await daemonServiceFluxnodeRpcs.listFluxNodeConf(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodeconf', []);
    });

    it('should trigger rpc, all parameters passed in params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'testfilter',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceFluxnodeRpcs.listFluxNodeConf(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodeconf', [req.params.filter]);
    });
  });

  describe('createFluxNodeKey tests', () => {
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
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceFluxnodeRpcs.createFluxNodeKey(undefined);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'testfilter',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.createFluxNodeKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodekey');
    });

    it('should trigger rpc,response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceFluxnodeRpcs.createFluxNodeKey(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodekey');
    });
  });

  describe('getFluxNodeOutputs tests', () => {
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
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceFluxnodeRpcs.getFluxNodeOutputs();

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.getFluxNodeOutputs();

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodeoutputs');
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceFluxnodeRpcs.getFluxNodeOutputs(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodeoutputs');
    });
  });

  describe('startDeterministicFluxNode tests', () => {
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
          lockwallet: 'false',
          alias: 'alias1',
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

      const result = await daemonServiceFluxnodeRpcs.startDeterministicFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: 'false',
          alias: 'alias1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.startDeterministicFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', ['alias1', false]);
    });

    it('should trigger rpc, no lockwallet param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          alias: 'alias1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.startDeterministicFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', ['alias1', false]);
    });

    it('should trigger rpc, no alias param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.startDeterministicFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', [undefined, true]);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          lockwallet: true,
          alias: 'alias1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.startDeterministicFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', ['alias1', true]);
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

      const result = await daemonServiceFluxnodeRpcs.startDeterministicFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', [undefined, false]);
    });

    it('should trigger rpc, all parameters passed in params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: false,
          alias: 'alias1',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceFluxnodeRpcs.startDeterministicFluxNode(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', ['alias1', false]);
    });
  });

  describe('startFluxNode tests', () => {
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
          lockwallet: 'false',
          alias: 'alias1',
          set: 'set1',
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

      const result = await daemonServiceFluxnodeRpcs.startFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: false,
          alias: 'alias1',
          set: 'set1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.startFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', false, 'alias1']);
    });

    it('should trigger rpc, no lockwallet param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          alias: 'alias1',
          set: 'set1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.startFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', undefined, 'alias1']);
    });

    it('should trigger rpc, no set param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          alias: 'alias1',
          lockwallet: false,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.startFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', [undefined, false, 'alias1']);
    });

    it('should trigger rpc, no alias param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: 'true',
          set: 'set1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.startFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', 'true']);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          lockwallet: false,
          alias: 'alias1',
          set: 'set1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceFluxnodeRpcs.startFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', false, 'alias1']);
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

      const result = await daemonServiceFluxnodeRpcs.startFluxNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', [undefined, undefined]);
    });

    it('should trigger rpc, all parameters passed in params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: false,
          alias: 'alias1',
          set: 'set1',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceFluxnodeRpcs.startFluxNode(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', false, 'alias1']);
    });
  });
});
