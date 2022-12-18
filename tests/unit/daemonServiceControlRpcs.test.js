const sinon = require('sinon');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper').default;
const daemonServiceControlRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceControlRpcs').default;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceControlRpcs tests', () => {
  describe('help tests', () => {
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

      const result = await daemonServiceControlRpcs.help(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'help', ['']);
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

      const result = await daemonServiceControlRpcs.help(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'help', ['']);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          command: 'testcommand',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceControlRpcs.help(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'help', [req.params.command]);
    });
  });

  describe('getInfo tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall').returns({
        data: {
          test: 'test1',
          balance: '1234',
        },
      });
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call rpc, no response', async () => {
      const req = {};
      const expectedResult = {
        data: {
          test: 'test1',
        },
      };
      const result = await daemonServiceControlRpcs.getInfo(req);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getInfo');
    });

    it('should trigger rpc, response passed, user is not an admin', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {};
      const expectedResult = {
        data: {
          test: 'test1',
        },
      };
      const res = generateResponse();

      const result = await daemonServiceControlRpcs.getInfo(req, res);

      expect(result).to.equal(`Response: ${expectedResult}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getInfo');
    });

    it('should trigger rpc, response passed, user is an admin', async () => {
      verifyPrivilegeStub.returns(true);
      const req = {};
      const expectedResult = {
        data: {
          test: 'test1',
          balance: '1234',
        },
      };
      const res = generateResponse();

      const result = await daemonServiceControlRpcs.getInfo(req, res);

      expect(result).to.equal(`Response: ${expectedResult}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getInfo');
    });
  });

  describe('stop tests', () => {
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

      const result = await daemonServiceControlRpcs.stop();

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

      const result = await daemonServiceControlRpcs.stop(res);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceControlRpcs.stop();

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'stop');
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceControlRpcs.stop(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'stop');
    });
  });
});
