const sinon = require('sinon');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonServiceUtils');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const daemonServiceNetworkRpcs = require('../../ZelBack/src/services/daemonServiceNetworkRpcs');

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceNetworkRpcs tests', () => {
  describe('addNode tests', () => {
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
          node: 'node1',
          command: 'myCommand',
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

      const result = await daemonServiceNetworkRpcs.addNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          node: 'node1',
          command: 'myCommand',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.addNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'addNode', [req.params.node, req.params.command]);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          node: 'node1',
          command: 'myCommand',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.addNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'addNode', [req.query.node, req.query.command]);
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

      const result = await daemonServiceNetworkRpcs.addNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'addNode', []);
    });

    it('should trigger rpc, all parameters passed in params,  response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          node: 'node1',
          command: 'myCommand',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.addNode(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'addNode', [req.params.node, req.params.command]);
    });
  });

  describe('clearBanned tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc if authorized, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.clearBanned(undefined);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'clearBanned');
    });

    it('should trigger rpc if authorized, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.clearBanned(undefined, res);

      expect(result).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'clearBanned');
    });

    it('should return an error if not authorized', async () => {
      verifyPrivilegeStub.returns(false);
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceNetworkRpcs.clearBanned(undefined);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });
  });

  describe('disconnectNode tests', () => {
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
          node: 'node1',
          command: 'myCommand',
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

      const result = await daemonServiceNetworkRpcs.disconnectNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          node: 'node1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.disconnectNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'disconnectNode', [req.params.node]);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          node: 'node1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.disconnectNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'disconnectNode', [req.query.node]);
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

      const result = await daemonServiceNetworkRpcs.disconnectNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'disconnectNode', []);
    });

    it('should trigger rpc, all parameters passed in params,  response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          node: 'node1',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.disconnectNode(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'disconnectNode', [req.params.node]);
    });
  });
});
