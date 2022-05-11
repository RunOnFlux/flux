const sinon = require('sinon');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonServiceUtils');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const daemonServiceZcashRpcs = require('../../ZelBack/src/services/daemonServiceZcashRpcs');

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceZcashRpcs tests', () => {
  describe('zExportKey tests', () => {
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
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zExportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zExportKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zExportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_exportkey', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zExportKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_exportkey', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zExportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_exportkey', [req.params.zaddr]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          zaddr: '1ZASC123455',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zExportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_exportkey', [req.query.zaddr]);
    });
  });

  describe('zExportViewingKey tests', () => {
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
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zExportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zExportViewingKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zExportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_exportviewingkey', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zExportViewingKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_exportviewingkey', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zExportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_exportviewingkey', [req.params.zaddr]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          zaddr: '1ZASC123455',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zExportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_exportviewingkey', [req.query.zaddr]);
    });
  });

  describe('zGetBalance tests', () => {
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
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetBalance(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getbalance', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zGetBalance(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getbalance', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          address: '1ZASC123455',
          minconf: '0',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getbalance', [req.params.address, +req.params.minconf]);
    });

    it('should trigger rpc, no minconf in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          address: '1ZASC123455',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getbalance', [req.params.address, 1]);
    });

    it('should trigger rpc, no address in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '0',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getbalance', []);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          address: '1ZASC123455',
          minconf: '0',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getbalance', [req.query.address, +req.query.minconf]);
    });
  });

  describe('zGetMigrationStatus tests', () => {
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
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetMigrationStatus(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetMigrationStatus(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetMigrationStatus(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getmigrationstatus');
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zGetMigrationStatus(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getmigrationstatus');
    });
  });

  describe('zGetNewAddress tests', () => {
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
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetNewAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetNewAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetNewAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getnewaddress', ['sapling']);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zGetNewAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getnewaddress', ['sapling']);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          type: 'testing123',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetNewAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getnewaddress', [req.params.type]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          type: 'testing123',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetNewAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getnewaddress', [req.query.type]);
    });
  });

  describe('zGetOperationResult tests', () => {
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
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetOperationResult(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetOperationResult(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetOperationResult(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getoperationresult', [[]]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zGetOperationResult(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getoperationresult', [[]]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          operationid: {
            test1: 'test1',
            test2: 'test2',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetOperationResult(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getoperationresult', [req.params.operationid]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          operationid: {
            test1: 'test1',
            test2: 'test2',
          },
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetOperationResult(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getoperationresult', [req.query.operationid]);
    });
  });

  describe('zGetOperationStatus tests', () => {
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
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetOperationStatus(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetOperationStatus(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetOperationStatus(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getoperationstatus', [[]]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zGetOperationStatus(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getoperationstatus', [[]]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          operationid: {
            test1: 'test1',
            test2: 'test2',
          },
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetOperationStatus(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getoperationstatus', [req.params.operationid]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          operationid: {
            test1: 'test1',
            test2: 'test2',
          },
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetOperationStatus(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_getoperationstatus', [req.query.operationid]);
    });
  });

  describe('zGetTotalBalance tests', () => {
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
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetTotalBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          zaddr: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zGetTotalBalance(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetTotalBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_gettotalbalance', [1, false]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zGetTotalBalance(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_gettotalbalance', [1, false]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '123',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetTotalBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_gettotalbalance', [+req.params.minconf, true]);
    });

    it('should trigger rpc, no minconf param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetTotalBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_gettotalbalance', [1, true]);
    });

    it('should trigger rpc, no includewatchonly param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '123',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetTotalBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_gettotalbalance', [+req.params.minconf, false]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          minconf: '123',
          includewatchonly: 'false',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zGetTotalBalance(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_gettotalbalance', [+req.query.minconf, false]);
    });
  });

  describe('zImportKey tests', () => {
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
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zImportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zImportKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importkey', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zImportKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importkey', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zkey: 'Z13456789912223',
          rescan: 'testcommand',
          startheight: '1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importkey', [req.params.zkey, req.params.rescan, +req.params.startheight]);
    });

    it('should trigger rpc, no zkey param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          rescan: 'testcommand',
          startheight: '1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importkey', []);
    });

    it('should trigger rpc, no startheight param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zkey: 'Z13456789912223',
          rescan: 'testcommand',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importkey', [req.params.zkey, req.params.rescan, 0]);
    });

    it('should trigger rpc, no rescan param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zkey: 'Z13456789912223',
          startheight: '1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importkey', [req.params.zkey, 'whenkeyisnew', +req.params.startheight]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          zkey: 'Z13456789912223',
          rescan: 'testcommand',
          startheight: '1',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importkey', [req.query.zkey, req.query.rescan, +req.query.startheight]);
    });
  });

  describe('zImportViewingKey tests', () => {
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
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zImportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zImportViewingKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importviewingkey', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zImportViewingKey(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importviewingkey', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          vkey: 'Z13456789912223',
          rescan: 'testcommand',
          startheight: '1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importviewingkey', [req.params.vkey, req.params.rescan, +req.params.startheight]);
    });

    it('should trigger rpc, no vkey param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          rescan: 'testcommand',
          startheight: '1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importviewingkey', []);
    });

    it('should trigger rpc, no startheight param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          vkey: 'Z13456789912223',
          rescan: 'testcommand',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importviewingkey', [req.params.vkey, req.params.rescan, 0]);
    });

    it('should trigger rpc, no rescan param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          vkey: 'Z13456789912223',
          startheight: '1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importviewingkey', [req.params.vkey, 'whenkeyisnew', +req.params.startheight]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          vkey: 'Z13456789912223',
          rescan: 'testcommand',
          startheight: '1',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportViewingKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importviewingkey', [req.query.vkey, req.query.rescan, +req.query.startheight]);
    });
  });

  describe('zImportWallet tests', () => {
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
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zImportWallet(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zImportWallet(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportWallet(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importwallet', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zImportWallet(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importwallet', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filename: 'test.txt',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportWallet(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importwallet', [req.params.filename]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          filename: 'test.txt',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zImportWallet(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_importwallet', [req.query.filename]);
    });
  });

  describe('zListAddresses tests', () => {
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
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zListAddresses(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zListAddresses(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListAddresses(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listaddresses', [false]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zListAddresses(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listaddresses', [false]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListAddresses(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listaddresses', [true]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          includewatchonly: true,
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListAddresses(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listaddresses', [true]);
    });
  });

  describe('zListOperationIds tests', () => {
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
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zListOperationIds(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized, response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          test: '1ZASC123455',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zListOperationIds(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListOperationIds(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listoperationids');
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zListOperationIds(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listoperationids');
    });
  });

  describe('zListReceivedByAddress tests', () => {
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
          address: '1ZASC123455',
          minconf: '1',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zListReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          address: '1ZASC123455',
          minconf: '1',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zListReceivedByAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listreceivedbyaddress', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zListReceivedByAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listreceivedbyaddress', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          address: '1ZASC123455',
          minconf: '0',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listreceivedbyaddress', [req.params.address, +req.params.minconf]);
    });

    it('should trigger rpc, no minconf in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          address: '1ZASC123455',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listreceivedbyaddress', [req.params.address, 1]);
    });

    it('should trigger rpc, no address in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '0',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listreceivedbyaddress', []);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          address: '1ZASC123455',
          minconf: '0',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListReceivedByAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listreceivedbyaddress', [req.query.address, +req.query.minconf]);
    });
  });

  describe('zListUnspent tests', () => {
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
          addresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          minconf: '1',
          maxconf: '50',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zListUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          addresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          minconf: '1',
          maxconf: '50',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zListUnspent(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listunspent', [1, 9999999, false]);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zListUnspent(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listunspent', [1, 9999999, false]);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          addresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          minconf: '1',
          maxconf: '50',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listunspent', [+req.params.minconf, +req.params.maxconf, true, req.params.addresses]);
    });

    it('should trigger rpc, no minconf in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          addresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          maxconf: '50',
          includewatchonly: 'false',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listunspent', [1, +req.params.maxconf, false, req.params.addresses]);
    });

    it('should trigger rpc, no maxconf in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          addresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          minconf: '33',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listunspent', [+req.params.minconf, 9999999, true, req.params.addresses]);
    });

    it('should trigger rpc, no addresses in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          minconf: '2',
          maxconf: '50',
          includewatchonly: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listunspent', [+req.params.minconf, +req.params.maxconf, true]);
    });

    it('should trigger rpc, no includewatchonly in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          addresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          minconf: '5',
          maxconf: '50',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listunspent', [+req.params.minconf, +req.params.maxconf, false, req.params.addresses]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          addresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          minconf: '12',
          maxconf: '80',
          includewatchonly: 'true',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zListUnspent(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_listunspent', [+req.query.minconf, +req.query.maxconf, true, req.query.addresses]);
    });
  });

  describe('zMergeToAddress tests', () => {
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
          fromaddresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          toaddress: '1SASC123453',
          transparentlimit: 0,
          shieldedlimit: 0,
          fee: 0.1,
          memo: 'somememo',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          fromaddresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          toaddress: '1SASC123453',
          transparentlimit: 0,
          shieldedlimit: 0,
          fee: 0.1,
          memo: 'somememo',
        },
        query: {
          test: 'test',
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

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', []);
    });

    it('should trigger rpc, no params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          toaddress: '1SASC123453',
          transparentlimit: 0,
          shieldedlimit: 0,
          fee: 0.1,
          memo: 'somememo',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', [req.params.fromaddresses, req.params.toaddress, req.params.fee, req.params.transparentlimit,
        req.params.shieldedlimit, req.params.memo]);
    });

    it('should trigger rpc, no fromaddresses in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          toaddress: '1SASC123453',
          fee: 0.1,
          transparentlimit: 0,
          shieldedlimit: 0,
          memo: 'somememo',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', []);
    });

    it('should trigger rpc, no toaddress in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          fee: 0.1,
          transparentlimit: 0,
          shieldedlimit: 0,
          memo: 'somememo',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', []);
    });

    it('should trigger rpc, no fee in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          toaddress: '1SASC123453',
          transparentlimit: 0,
          shieldedlimit: 0,
          memo: 'somememo',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', [req.params.fromaddresses, req.params.toaddress, 0.0001, req.params.transparentlimit,
        req.params.shieldedlimit, req.params.memo]);
    });

    it('should trigger rpc, no transparentlimit in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          toaddress: '1SASC123453',
          fee: 0.1,
          shieldedlimit: 0,
          memo: 'somememo',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', [req.params.fromaddresses, req.params.toaddress, req.params.fee, 50,
        req.params.shieldedlimit, req.params.memo]);
    });

    it('should trigger rpc, no shieldedlimit in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          toaddress: '1SASC123453',
          fee: 0.1,
          transparentlimit: 0,
          memo: 'somememo',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', [req.params.fromaddresses, req.params.toaddress, req.params.fee, req.params.transparentlimit,
        20, req.params.memo]);
    });

    it('should trigger rpc, no memo in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          toaddress: '1SASC123453',
          fee: 0.1,
          transparentlimit: 3,
          shieldedlimit: 49,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', [req.params.fromaddresses, req.params.toaddress, req.params.fee, req.params.transparentlimit,
        req.params.shieldedlimit, '']);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          fromaddresses: {
            addr1: '1ZASC123455',
            addr2: '1ZASC123455',
          },
          toaddress: '1SASC123453',
          transparentlimit: 3,
          fee: 0.1,
          shieldedlimit: 11,
          memo: 'somememo',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zMergeToAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_mergetoaddress', [req.query.fromaddresses, req.query.toaddress, req.query.fee, req.query.transparentlimit,
        req.query.shieldedlimit, req.query.memo]);
    });
  });
});
