const sinon = require('sinon');
const { PassThrough } = require('stream');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonServiceUtils');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const daemonServiceZcashRpcs = require('../../ZelBack/src/services/daemonServiceZcashRpcs');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

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

  describe('zSendMany tests', () => {
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

      const result = await daemonServiceZcashRpcs.zSendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          amounts: {
            amount1: '12345566',
            amount2: '756543',
          },
          minconf: 3,
          fee: 0.1,
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

      const result = await daemonServiceZcashRpcs.zSendMany(req, res);

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

      const result = await daemonServiceZcashRpcs.zSendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', []);
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

      const result = await daemonServiceZcashRpcs.zSendMany(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          amounts: {
            amount1: '12345566',
            amount2: '756543',
          },
          minconf: '3',
          fee: '0.1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zSendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', [req.params.fromaddress, req.params.amounts, +req.params.minconf, +req.params.fee]);
    });

    it('should trigger rpc, no fromaddress in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          amounts: {
            amount1: '12345566',
            amount2: '756543',
          },
          minconf: 3,
          fee: 0.1,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zSendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', []);
    });

    it('should trigger rpc, no amounts in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          minconf: 3,
          fee: 0.1,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zSendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', []);
    });

    it('should trigger rpc, no fee in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          amounts: {
            amount1: '12345566',
            amount2: '756543',
          },
          minconf: 3,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zSendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', [req.params.fromaddress, req.params.amounts, req.params.minconf, 0.0001]);
    });

    it('should trigger rpc, no minconf in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          amounts: {
            amount1: '12345566',
            amount2: '756543',
          },
          fee: 0.1,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zSendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', [req.params.fromaddress, req.params.amounts, 1, req.params.fee]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          fromaddress: '1ZASC123455',
          amounts: {
            amount1: '12345566',
            amount2: '756543',
          },
          minconf: 3,
          fee: 0.1,
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zSendMany(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', [req.query.fromaddress, req.query.amounts, req.query.minconf, req.query.fee]);
    });
  });

  describe('zSendManyPost tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      await daemonServiceZcashRpcs.zSendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should call rpc if no params are given', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zSendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', expectedCallParams);
    });

    it('should call rpc with all params', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        fromaddress: '1ZASC123455',
        amounts: {
          amount1: '12345566',
          amount2: '756543',
        },
        minconf: 3,
        fee: 0.1,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zSendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', [params.fromaddress, params.amounts, params.minconf, params.fee]);
    });

    it('should call rpc with no fromaddress param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        amounts: {
          amount1: '12345566',
          amount2: '756543',
        },
        minconf: 3,
        fee: 0.1,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zSendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', []);
    });

    it('should call rpc with no amounts param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        fromaddress: '1ZASC123455',
        minconf: 3,
        fee: 0.1,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zSendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', []);
    });

    it('should call rpc with no minconf param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        fromaddress: '1ZASC123455',
        amounts: {
          amount1: '12345566',
          amount2: '756543',
        },
        fee: 0.1,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zSendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', [params.fromaddress, params.amounts, 1, params.fee]);
    });

    it('should call rpc with no fee param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        fromaddress: '1ZASC123455',
        amounts: {
          amount1: '12345566',
          amount2: '756543',
        },
        minconf: 3,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zSendManyPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_sendmany', [params.fromaddress, params.amounts, params.minconf, 0.0001]);
    });
  });

  describe('zSetMigration tests', () => {
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

      const result = await daemonServiceZcashRpcs.zSetMigration(req);

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

      const result = await daemonServiceZcashRpcs.zSetMigration(req, res);

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

      const result = await daemonServiceZcashRpcs.zSetMigration(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_setmigration', []);
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

      const result = await daemonServiceZcashRpcs.zSetMigration(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_setmigration', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          enabled: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zSetMigration(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_setmigration', [true]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          enabled: false,
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zSetMigration(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_setmigration', [false]);
    });
  });

  describe('zShieldCoinBase tests', () => {
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
          fromaddress: '1ZASC123455',
          toaddress: '1SASC123453',
          limit: 0,
          fee: 0.1,
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

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          toaddress: '1SASC123453',
          limit: 0,
          fee: 0.1,
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

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req, res);

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

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_shieldcoinbase', []);
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

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_shieldcoinbase', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          toaddress: '1SASC123453',
          limit: 0,
          fee: '0.1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_shieldcoinbase', [req.params.fromaddress, req.params.toaddress, +req.params.fee, +req.params.limit]);
    });

    it('should trigger rpc, no fromaddress in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          toaddress: '1SASC123453',
          limit: 0,
          fee: 0.1,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_shieldcoinbase', []);
    });

    it('should trigger rpc, no toaddress in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          limit: 0,
          fee: 0.1,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_shieldcoinbase', []);
    });

    it('should trigger rpc, no limit in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          toaddress: '1SASC123453',
          fee: 0.1,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_shieldcoinbase', [req.params.fromaddress, req.params.toaddress, +req.params.fee, 50]);
    });

    it('should trigger rpc, no fee in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          fromaddress: '1ZASC123455',
          toaddress: '1SASC123453',
          limit: '12',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_shieldcoinbase', [req.params.fromaddress, req.params.toaddress, 0.0001, +req.params.limit]);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          fromaddress: '1ZASC123455',
          toaddress: '1SASC123453',
          limit: 0,
          fee: 0.1,
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zShieldCoinBase(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'z_shieldcoinbase', [req.query.fromaddress, req.query.toaddress, req.query.fee, req.query.limit]);
    });
  });

  describe('zcBenchmark tests', () => {
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
          fromaddress: '1ZASC123455',
          toaddress: '1SASC123453',
          limit: 0,
          fee: 0.1,
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

      const result = await daemonServiceZcashRpcs.zcBenchmark(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          benchmarktype: 'sometype',
          samplecount: '42',
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

      const result = await daemonServiceZcashRpcs.zcBenchmark(req, res);

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

      const result = await daemonServiceZcashRpcs.zcBenchmark(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcbenchmark', []);
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

      const result = await daemonServiceZcashRpcs.zcBenchmark(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcbenchmark', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          benchmarktype: 'sometype',
          samplecount: '42',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcBenchmark(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcbenchmark', [req.params.benchmarktype, +req.params.samplecount]);
    });

    it('should trigger rpc, no benchmarktype in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          samplecount: '42',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcBenchmark(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcbenchmark', []);
    });

    it('should trigger rpc, no samplecount in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          benchmarktype: 'sometype',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcBenchmark(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcbenchmark', []);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          benchmarktype: 'sometype',
          samplecount: '42',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcBenchmark(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcbenchmark', [req.query.benchmarktype, +req.query.samplecount]);
    });
  });

  describe('zcRawJoinSplit tests', () => {
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
          rawtx: '0x2311241231231ZASC123455',
          inputs: {
            input1: 'test2',
            input2: 'input2',
          },
          outputs: {
            test1: 'test',
            output2: 'output2',
          },
          vpubnew: 'param1',
          vpubold: 'param2',
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

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should throw error if user is unauthorized,  response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          rawtx: '0x2311241231231ZASC123455',
          inputs: {
            input1: 'test2',
            input2: 'input2',
          },
          outputs: {
            test1: 'test',
            output2: 'output2',
          },
          vpubnew: 'param1',
          vpubold: 'param2',
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

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req, res);

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

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
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

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          rawtx: '0x2311241231231ZASC123455',
          inputs: JSON.stringify({
            input1: 'test2',
            input2: 'input2',
          }),
          outputs: JSON.stringify({
            test1: 'test',
            output2: 'output2',
          }),
          vpubnew: 'param1',
          vpubold: 'param2',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', [req.params.rawtx, JSON.parse(req.params.inputs),
        JSON.parse(req.params.outputs), req.params.vpubold, req.params.vpubnew]);
    });

    it('should trigger rpc, no rawtx in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          inputs: {
            input1: 'test2',
            input2: 'input2',
          },
          outputs: {
            test1: 'test',
            output2: 'output2',
          },
          vpubnew: 'param1',
          vpubold: 'param2',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should trigger rpc, no inputs in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          rawtx: '0x2311241231231ZASC123455',
          outputs: {
            test1: 'test',
            output2: 'output2',
          },
          vpubnew: 'param1',
          vpubold: 'param2',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should trigger rpc, no outputs in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          rawtx: '0x2311241231231ZASC123455',
          inputs: {
            input1: 'test2',
            input2: 'input2',
          },
          vpubnew: 'param1',
          vpubold: 'param2',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should trigger rpc, no vpubnew in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          rawtx: '0x2311241231231ZASC123455',
          inputs: {
            input1: 'test2',
            input2: 'input2',
          },
          outputs: {
            test1: 'test',
            output2: 'output2',
          },
          vpubold: 'param2',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should trigger rpc, no vpubold in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          rawtx: '0x2311241231231ZASC123455',
          inputs: {
            input1: 'test2',
            input2: 'input2',
          },
          outputs: {
            test1: 'test',
            output2: 'output2',
          },
          vpubnew: 'param1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          rawtx: '0x2311241231231ZASC123455',
          inputs: {
            input1: 'test2',
            input2: 'input2',
          },
          outputs: {
            test1: 'test',
            output2: 'output2',
          },
          vpubnew: 'param1',
          vpubold: 'param2',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawJoinSplit(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', [req.query.rawtx, req.query.inputs, req.query.outputs, req.query.vpubold, req.query.vpubnew]);
    });
  });

  describe('zcRawJoinSplitPost tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      await daemonServiceZcashRpcs.zcRawJoinSplitPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should call rpc if no params are given', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawJoinSplitPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', expectedCallParams);
    });

    it('should call rpc with all params', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        rawtx: '0x2311241231231ZASC123455',
        inputs: JSON.stringify({
          input1: 'test2',
          input2: 'input2',
        }),
        outputs: JSON.stringify({
          test1: 'test',
          output2: 'output2',
        }),
        vpubnew: 'param1',
        vpubold: 'param2',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawJoinSplitPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', [params.rawtx, JSON.parse(params.inputs), JSON.parse(params.outputs),
        params.vpubold, params.vpubnew]);
    });

    it('should call rpc with no rawtx param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        inputs: JSON.stringify({
          input1: 'test2',
          input2: 'input2',
        }),
        outputs: JSON.stringify({
          test1: 'test',
          output2: 'output2',
        }),
        vpubnew: 'param1',
        vpubold: 'param2',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawJoinSplitPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should call rpc with no inputs param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        rawtx: '0x2311241231231ZASC123455',
        outputs: JSON.stringify({
          test1: 'test',
          output2: 'output2',
        }),
        vpubnew: 'param1',
        vpubold: 'param2',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawJoinSplitPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should call rpc with no outputs param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        rawtx: '0x2311241231231ZASC123455',
        inputs: JSON.stringify({
          input1: 'test2',
          input2: 'input2',
        }),
        vpubnew: 'param1',
        vpubold: 'param2',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawJoinSplitPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should call rpc with no vpubnew param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        rawtx: '0x2311241231231ZASC123455',
        inputs: JSON.stringify({
          input1: 'test2',
          input2: 'input2',
        }),
        outputs: JSON.stringify({
          test1: 'test',
          output2: 'output2',
        }),
        vpubold: 'param2',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawJoinSplitPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });

    it('should call rpc with no vpubold param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        rawtx: '0x2311241231231ZASC123455',
        inputs: JSON.stringify({
          input1: 'test2',
          input2: 'input2',
        }),
        outputs: JSON.stringify({
          test1: 'test',
          output2: 'output2',
        }),
        vpubnew: 'param1',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawJoinSplitPost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawjoinsplit', []);
    });
  });

  describe('zcRawKeygen tests', () => {
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

      const result = await daemonServiceZcashRpcs.zcRawKeygen(req);

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

      const result = await daemonServiceZcashRpcs.zcRawKeygen(req, res);

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

      const result = await daemonServiceZcashRpcs.zcRawKeygen(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawkeygen');
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

      const result = await daemonServiceZcashRpcs.zcRawKeygen(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawkeygen');
    });
  });

  describe('zcRawReceive tests', () => {
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

      const result = await daemonServiceZcashRpcs.zcRawReceive(req);

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

      const result = await daemonServiceZcashRpcs.zcRawReceive(req, res);

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

      const result = await daemonServiceZcashRpcs.zcRawReceive(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', []);
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

      const result = await daemonServiceZcashRpcs.zcRawReceive(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', []);
    });

    it('should trigger rpc, data in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zcsecretkey: '1ZASC123455',
          encryptednote: 'someencryptednote',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawReceive(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', [req.params.zcsecretkey, req.params.encryptednote]);
    });

    it('should trigger rpc, no zcsecretkey, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          encryptednote: 'someencryptednote',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawReceive(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', []);
    });

    it('should trigger rpc, no encryptednote, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          zcsecretkey: '1ZASC123455',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawReceive(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', []);
    });

    it('should trigger rpc, data in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        query: {
          zcsecretkey: '1ZASC123455',
          encryptednote: 'someencryptednote',
        },
        params: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZcashRpcs.zcRawReceive(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', [req.query.zcsecretkey, req.query.encryptednote]);
    });
  });

  describe('zcRawReceivePost tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;
    const execCallResult = 'RPC call executed';

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').resolves(execCallResult);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const params = {
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      await daemonServiceZcashRpcs.zcRawReceivePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should call rpc if no params are given', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
      };
      const expectedCallParams = [];
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawReceivePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', expectedCallParams);
    });

    it('should call rpc with all params', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        zcsecretkey: '1ZASC123455',
        encryptednote: 'someencryptednote',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawReceivePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', [params.zcsecretkey, params.encryptednote]);
    });

    it('should call rpc with no zcsecretkey param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        encryptednote: 'someencryptednote',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawReceivePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', []);
    });

    it('should call rpc with no encryptednote param', async () => {
      verifyPrivilegeStub.returns(true);
      const params = {
        zcsecretkey: '1ZASC123455',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();
      const res = generateResponse();

      await daemonServiceZcashRpcs.zcRawReceivePost(mockStream, res);
      // await because of the async nature of the request processing
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, execCallResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zcrawreceive', []);
    });
  });

  describe('getNewAddress tests', () => {
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

      const result = await daemonServiceZcashRpcs.getNewAddress(req);

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

      const result = await daemonServiceZcashRpcs.getNewAddress(req, res);

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

      const result = await daemonServiceZcashRpcs.getNewAddress(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNewAddress');
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

      const result = await daemonServiceZcashRpcs.getNewAddress(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getNewAddress');
    });
  });
});
