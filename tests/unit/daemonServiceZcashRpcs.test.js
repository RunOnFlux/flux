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

describe.only('daemonServiceZcashRpcs tests', () => {
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
});
