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

  describe('getAddedNodeInfo tests', () => {
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
          dns: true,
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

      const result = await daemonServiceNetworkRpcs.getAddedNodeInfo(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          node: 'node1',
          dns: true,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.getAddedNodeInfo(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'getAddedNodeInfo', [req.params.dns, req.params.node]);
    });

    it('should trigger rpc with dns parameter when no node is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          dns: true,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.getAddedNodeInfo(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'getAddedNodeInfo', [true]);
    });

    it('should trigger rpc without parameters if no dns passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          node: 'testnode',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.getAddedNodeInfo(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'getAddedNodeInfo', []);
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
          dns: true,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.getAddedNodeInfo(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub,
        'getAddedNodeInfo', [req.query.dns, req.query.node]);
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

      const result = await daemonServiceNetworkRpcs.getAddedNodeInfo(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getAddedNodeInfo', []);
    });

    it('should trigger rpc, all parameters passed in params,  response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          node: 'node1',
          dns: true,
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.getAddedNodeInfo(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getAddedNodeInfo', [req.params.dns, req.params.node]);
    });
  });

  describe('getConnectionCount tests', () => {
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

      const result = await daemonServiceNetworkRpcs.getConnectionCount();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getConnectionCount');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.getConnectionCount(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getConnectionCount');
    });
  });

  describe('getDeprecationInfo tests', () => {
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

      const result = await daemonServiceNetworkRpcs.getDeprecationInfo();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getDeprecationInfo');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.getDeprecationInfo(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getDeprecationInfo');
    });
  });

  describe('getNetTotals tests', () => {
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

      const result = await daemonServiceNetworkRpcs.getNetTotals();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetTotals');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.getNetTotals(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetTotals');
    });
  });

  describe('getNetworkInfo tests', () => {
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

      const result = await daemonServiceNetworkRpcs.getNetworkInfo();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkInfo');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.getNetworkInfo(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNetworkInfo');
    });
  });

  describe('getPeerInfo tests', () => {
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

      const result = await daemonServiceNetworkRpcs.getPeerInfo();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getPeerInfo');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.getPeerInfo(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getPeerInfo');
    });
  });

  describe('listBanned tests', () => {
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

      const result = await daemonServiceNetworkRpcs.listBanned();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listBanned');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.listBanned(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listBanned');
    });
  });

  describe('ping tests', () => {
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

      const result = await daemonServiceNetworkRpcs.ping();

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized, response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.ping(res);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.ping();

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'ping');
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.ping(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'ping');
    });
  });

  describe('setBan tests', () => {
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
          ip: '192.154.12.33',
          command: 'ban',
          bantime: 1000,
          absolute: true,

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

      const result = await daemonServiceNetworkRpcs.setBan(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          ip: '192.154.12.33',
          command: 'ban',
          bantime: 1000,
          absolute: true,
        },
        query: {
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.setBan(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setBan', [req.params.ip, req.params.command, req.params.bantime, req.params.absolute]);
    });

    it('should trigger rpc when no absolute param is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          ip: '192.154.12.33',
          command: 'ban',
          bantime: 1000,
        },
        query: {
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.setBan(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setBan', [req.params.ip, req.params.command, req.params.bantime]);
    });

    it('should trigger rpc if no bantime is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          ip: '192.154.12.33',
          command: 'ban',
          absolute: true,
        },
        query: {
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.setBan(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setBan', [req.params.ip, req.params.command]);
    });

    it('should trigger rpc without parameters if no command is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          ip: '192.154.12.33',
          absolute: true,
          bantime: 1000,
        },
        query: {
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.setBan(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setBan', []);
    });

    it('should trigger rpc without parameters if no ip is passed, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          command: 'ban',
          absolute: true,
          bantime: 1000,
        },
        query: {
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.setBan(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setBan', []);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          ip: '192.154.12.33',
          command: 'ban',
          bantime: 1000,
          absolute: true,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.setBan(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setBan', [req.query.ip, req.query.command, req.query.bantime, req.query.absolute]);
    });

    it('should trigger rpc, even without params', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
        },
        query: {
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceNetworkRpcs.setBan(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setBan', []);
    });

    it('should trigger rpc, all parameters passed in params,  response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          ip: '192.154.12.33',
          command: 'ban',
          bantime: 1000,
          absolute: true,
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceNetworkRpcs.setBan(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'setBan', [req.params.ip, req.params.command, req.params.bantime, req.params.absolute]);
    });
  });
});
