const chai = require('chai');
const sinon = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const path = require('path');
const nodecmd = require('node-cmd');
const fluxService = require('../../ZelBack/src/services/fluxService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

chai.use(chaiAsPromised);
const { expect } = chai;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe.only('fluxService tests', () => {
  describe('fluxBackendFolder tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should return a proper folder path', async () => {
      const res = generateResponse();
      const fluxBackFolder = path.join(__dirname, '../../ZelBack/');
      const expectedResponse = {
        status: 'success',
        data: fluxBackFolder,
      };

      const response = await fluxService.fluxBackendFolder(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });
  });

  describe('updateFlux tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is not an admin or flux team', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const response = await fluxService.updateFlux(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Flux successfully updated',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.updateFlux(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run updateflux`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error updating Flux: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.updateFlux(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run updateflux`);
    });
  });

  describe('softUpdateFlux tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is not an admin or flux team', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const response = await fluxService.softUpdateFlux(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Flux successfully updated using soft method',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.softUpdateFlux(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run softupdate`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error softly updating Flux: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.softUpdateFlux(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run softupdate`);
    });
  });

  describe('softUpdateFluxInstall tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is not an admin or flux team', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const response = await fluxService.softUpdateFluxInstall(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Flux successfully updated softly with installation',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.softUpdateFluxInstall(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run softupdateinstall`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error softly updating Flux with installation: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.softUpdateFluxInstall(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run softupdateinstall`);
    });
  });

  describe('hardUpdateFlux tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is not an admin or flux team', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const response = await fluxService.hardUpdateFlux(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Flux successfully updating',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.hardUpdateFlux(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run hardupdateflux`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error hardupdating Flux: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.hardUpdateFlux(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run hardupdateflux`);
    });
  });

  describe('rebuildHome tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is not an admin or flux team', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const response = await fluxService.rebuildHome(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Flux successfully rebuilt',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.rebuildHome(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run homebuild`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error rebuilding Flux: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.rebuildHome(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && npm run homebuild`);
    });
  });
});
