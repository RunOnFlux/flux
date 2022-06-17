const chai = require('chai');
const sinon = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const path = require('path');
const nodecmd = require('node-cmd');
const proxyquire = require('proxyquire');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const packageJson = require('../../package.json');

const adminConfig = {
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    kadena: '1234kadena',
    cruxid: '12345678',
    testnet: true,
  },
};

const fluxService = proxyquire('../../ZelBack/src/services/fluxService',
  { '../../../config/userconfig': adminConfig });

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

  describe('updateDaemon tests', () => {
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

      const response = await fluxService.updateDaemon(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Daemon successfully updated',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.updateDaemon(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash updateDaemon.sh`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error updating Daemon: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.updateDaemon(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash updateDaemon.sh`);
    });
  });

  describe('updateBenchmark tests', () => {
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

      const response = await fluxService.updateBenchmark(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Benchmark successfully updated',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.updateBenchmark(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash updateBenchmark.sh`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error updating Benchmark: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.updateBenchmark(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash updateBenchmark.sh`);
    });
  });

  describe('startBenchmark tests', () => {
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

      const response = await fluxService.startBenchmark(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Benchmark successfully started',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.startBenchmark(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, 'fluxbenchd -daemon');
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error starting Benchmark: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.startBenchmark(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, 'fluxbenchd -daemon');
    });
  });

  describe('restartBenchmark tests', () => {
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

      const response = await fluxService.restartBenchmark(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Benchmark successfully restarted',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.restartBenchmark(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash restartBenchmark.sh`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error restarting Benchmark: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.restartBenchmark(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash restartBenchmark.sh`);
    });
  });

  describe('startDaemon tests', () => {
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

      const response = await fluxService.startDaemon(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Daemon successfully started',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.startDaemon(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, 'fluxd');
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error starting Daemon: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.startDaemon(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, 'fluxd');
    });
  });

  describe('restartDaemon tests', () => {
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

      const response = await fluxService.restartDaemon(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Daemon successfully restarted',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.restartDaemon(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash restartDaemon.sh`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error restarting Daemon: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.restartDaemon(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash restartDaemon.sh`);
    });
  });

  describe('reindexDaemon tests', () => {
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

      const response = await fluxService.reindexDaemon(undefined, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null);
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Daemon successfully reindexing',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.reindexDaemon(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash reindexDaemon.sh`);
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../helpers');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error reindexing Daemon: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.reindexDaemon(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `cd ${nodedpath} && bash reindexDaemon.sh`);
    });
  });

  describe('getFluxVersion tests', () => {
    const { version } = packageJson;
    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      const result = await fluxService.getFluxVersion();

      expect(result.status).to.equal('success');
      expect(result.data).to.be.a('string');
      expect(result.data).to.equal(version);
    });

    it('should trigger rpc, response passed', async () => {
      const res = generateResponse();
      const expectedResponse = {
        status: 'success',
        data: version,
      };

      const result = await fluxService.getFluxVersion(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });
  });

  describe('getFluxZelID tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      const result = await fluxService.getFluxZelID();

      expect(result.status).to.equal('success');
      expect(result.data).to.be.a('string');
      expect(result.data).to.equal(adminConfig.initial.zelid);
    });

    it('should trigger rpc, response passed', async () => {
      const res = generateResponse();
      const expectedResponse = {
        status: 'success',
        data: adminConfig.initial.zelid,
      };

      const result = await fluxService.getFluxZelID(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });
  });

  describe('getFluxCruxID tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      const result = await fluxService.getFluxCruxID();

      expect(result.status).to.equal('success');
      expect(result.data).to.be.a('string');
      expect(result.data).to.equal(adminConfig.initial.cruxid);
    });

    it('should trigger rpc, response passed', async () => {
      const res = generateResponse();
      const expectedResponse = {
        status: 'success',
        data: adminConfig.initial.cruxid,
      };

      const result = await fluxService.getFluxCruxID(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });
  });

  describe('getFluxKadena tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      const result = await fluxService.getFluxKadena();

      expect(result.status).to.equal('success');
      expect(result.data).to.be.a('string');
      expect(result.data).to.equal(adminConfig.initial.kadena);
    });

    it('should trigger rpc, response passed', async () => {
      const res = generateResponse();
      const expectedResponse = {
        status: 'success',
        data: adminConfig.initial.kadena,
      };

      const result = await fluxService.getFluxKadena(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });
  });
});
