const chai = require('chai');
const sinon = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const path = require('path');
const nodecmd = require('node-cmd');
const proxyquire = require('proxyquire');
const fs = require('fs');
const util = require('util');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const explorerService = require('../../ZelBack/src/services/explorerService');
const generalService = require('../../ZelBack/src/services/generalService');
const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const appsService = require('../../ZelBack/src/services/appsService');
const daemonServiceControlRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceControlRpcs');
const daemonServiceBenchmarkRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceZelnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceZelnodeRpcs');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const packageJson = require('../../package.json');

const fsPromises = fs.promises;

const adminConfig = {
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    kadena: '1234kadena',
    cruxid: '12345678',
    apiport: '5550',
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
  res.download = sinon.fake(() => 'File downloaded');
  return res;
};

describe('fluxService tests', () => {
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

  describe('getFluxIP tests', () => {
    let daemonStub;

    beforeEach(() => {
      daemonStub = sinon.stub(daemonServiceBenchmarkRpcs, 'getBenchmarks');
    });

    afterEach(() => {
      daemonStub.restore();
    });

    it('should return IP and Port if benchmark response is correct, no response passed', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      daemonStub.resolves(getBenchmarkResponseData);
      const expectedResponse = {
        status: 'success',
        data: ip,
      };

      const getIpResult = await fluxService.getFluxIP();

      expect(getIpResult).to.eql(expectedResponse);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return IP and Port if benchmark response is correct, response passed', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      daemonStub.resolves(getBenchmarkResponseData);
      const expectedResponse = {
        status: 'success',
        data: ip,
      };
      const res = generateResponse();

      const getIpResult = await fluxService.getFluxIP(undefined, res);

      expect(getIpResult).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return null if daemon\'s response is invalid', async () => {
      const getBenchmarkResponseData = {
        status: 'error',
      };
      daemonStub.resolves(getBenchmarkResponseData);
      const expectedResponse = {
        status: 'success',
        data: null,
      };

      const getIpResult = await fluxService.getFluxIP();

      expect(getIpResult).to.be.eql(expectedResponse);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return null if daemon\'s response IP is too short', async () => {
      const ip = '12734';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      daemonStub.resolves(getBenchmarkResponseData);
      const expectedResponse = {
        status: 'success',
        data: null,
      };

      const getIpResult = await fluxService.getFluxIP();

      expect(getIpResult).to.be.eql(expectedResponse);
      sinon.assert.calledOnce(daemonStub);
    });
  });

  describe('daemonDebug tests', () => {
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return unauthorized message if the user is not an admin', async () => {
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

      const result = await fluxService.daemonDebug(undefined, res);

      expect(result).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return debug log file if the user is an admin', async () => {
      verifyPrivilegeStub.returns(true);
      const res = generateResponse();
      const expectedResponse = 'File downloaded';

      const result = await fluxService.daemonDebug(undefined, res);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledWithMatch(res.download, 'debug.log');
    });
  });

  describe('benchmarkDebug tests', () => {
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return unauthorized message if the user is not an admin', async () => {
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

      const result = await fluxService.benchmarkDebug(undefined, res);

      expect(result).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return debug log file if the user is an admin', async () => {
      verifyPrivilegeStub.returns(true);
      const res = generateResponse();
      const expectedResponse = 'File downloaded';

      const result = await fluxService.benchmarkDebug(undefined, res);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledWithMatch(res.download, 'debug.log');
    });
  });

  describe('tailDaemonDebug tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return unauthorized message if the user is not an admin', async () => {
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

      await fluxService.tailDaemonDebug(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return debug log file if the user is an admin', async () => {
      verifyPrivilegeStub.returns(true);
      const res = generateResponse();
      nodeCmdStub.yields(null, {
        message: 'success message',
      });

      await fluxService.tailDaemonDebug(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: { message: 'success message' } },
      });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../../../../.flux/debug.log'); // 2 more
      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error obtaining Daemon debug file: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.tailDaemonDebug(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `tail -n 100 ${nodedpath}`);
    });
  });

  describe('tailBenchmarkDebug tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return unauthorized message if the user is not an admin', async () => {
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

      await fluxService.tailBenchmarkDebug(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return debug log file if the user is an admin', async () => {
      verifyPrivilegeStub.returns(true);
      const res = generateResponse();
      nodeCmdStub.yields(null, 'debug.log');

      await fluxService.tailBenchmarkDebug(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledWithMatch(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'debug.log' },
      });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../../.zelbenchmark/debug.log'); // .fluxbenchmark
      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error obtaining Benchmark debug file: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.tailBenchmarkDebug(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `tail -n 100 ${nodedpath}`);
    });
  });

  describe('fluxLog tests', () => {
    it('should trigger download ', async () => {
      const res = generateResponse();
      const filename = 'test';
      const filepath = path.join(__dirname, `../../../flux/${filename}.log`);

      await fluxService.fluxLog(res, filename);

      sinon.assert.calledOnceWithExactly(res.download, filepath, `${filename}.log`);
    });
  });

  describe('fluxErrorLog tests', () => {
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await fluxService.fluxErrorLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return file download', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const filepath = path.join(__dirname, '../../../flux/error.log');

      await fluxService.fluxErrorLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.download, filepath, 'error.log');
    });
  });

  describe('fluxInfoLog tests', () => {
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await fluxService.fluxInfoLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return file download', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const filepath = path.join(__dirname, '../../../flux/info.log');

      await fluxService.fluxInfoLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.download, filepath, 'info.log');
    });
  });

  describe('fluxDebugLog tests', () => {
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await fluxService.fluxDebugLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return file download', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const filepath = path.join(__dirname, '../../../flux/debug.log');

      await fluxService.fluxDebugLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.download, filepath, 'debug.log');
    });
  });

  describe('tailFluxLog tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return unauthorized message if the user is not an admin', async () => {
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

      await fluxService.tailFluxLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return debug log file if the user is an admin', async () => {
      verifyPrivilegeStub.returns(true);
      const res = generateResponse();
      nodeCmdStub.yields(null, {
        message: 'success message',
      });

      await fluxService.tailFluxLog(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: { message: 'success message' } },
      });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields({
        message: 'This is an error',
        code: 403,
        name: 'testing error',
      });
      const nodedpath = path.join(__dirname, '../../../flux/test.log');
      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error obtaining Flux test file: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.tailFluxLog(undefined, res, 'test');
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(nodeCmdStub, `tail -n 100 ${nodedpath}`);
    });
  });

  describe('tailFluxErrorLog tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await fluxService.tailFluxErrorLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return file download', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null, {
        message: 'success message',
      });

      await fluxService.tailFluxErrorLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: { message: 'success message' },
        },
      });
    });
  });

  describe('tailFluxWarnLog tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await fluxService.tailFluxWarnLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return file download', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null, {
        message: 'success message',
      });

      await fluxService.tailFluxWarnLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: { message: 'success message' },
        },
      });
    });
  });

  describe('tailFluxInfoLog tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await fluxService.tailFluxInfoLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return file download', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null, {
        message: 'success message',
      });

      await fluxService.tailFluxInfoLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: { message: 'success message' },
        },
      });
    });
  });

  describe('tailFluxDebugLog tests', () => {
    let verifyPrivilegeStub;
    let nodeCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      nodeCmdStub = sinon.stub(nodecmd, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await fluxService.tailFluxDebugLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return file download', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      nodeCmdStub.yields(null, {
        message: 'success message',
      });

      await fluxService.tailFluxDebugLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: { message: 'success message' },
        },
      });
    });
  });

  describe('getFluxTimezone tests', () => {
    it('should return timezone, no response passed', () => {
      const result = fluxService.getFluxTimezone();

      expect(result.status).to.eql('success');
      expect(result.data).to.be.a('string');
    });

    it('should return timezone,  response passed', () => {
      const res = generateResponse();

      fluxService.getFluxTimezone(undefined, res);

      sinon.assert.calledWithMatch(res.json, { status: 'success' });
    });
  });

  describe('getFluxInfo tests', () => {
    let daemonServiceControlRpcsStub;
    let daemonServiceZelnodeRpcsStub;
    let benchmarkServiceGetInfoStub;
    let benchmarkServiceGetStatusStub;
    let benchmarkServiceGetBenchmarksStub;
    let appsServiceFluxUsageStub;
    let appsServiceListRunningAppsStub;
    let appsServiceAppsResourcesStub;
    let appsServiceGetAppHashesStub;
    let explorerServiceStub;
    let fluxCommunicationStub;
    let fluxNetworkHelperStub;

    beforeEach(() => {
      daemonServiceControlRpcsStub = sinon.stub(daemonServiceControlRpcs, 'getInfo');
      daemonServiceZelnodeRpcsStub = sinon.stub(daemonServiceZelnodeRpcs, 'getZelNodeStatus');
      benchmarkServiceGetInfoStub = sinon.stub(benchmarkService, 'getInfo');
      benchmarkServiceGetStatusStub = sinon.stub(benchmarkService, 'getStatus');
      benchmarkServiceGetBenchmarksStub = sinon.stub(benchmarkService, 'getBenchmarks');
      appsServiceFluxUsageStub = sinon.stub(appsService, 'fluxUsage');
      appsServiceListRunningAppsStub = sinon.stub(appsService, 'listRunningApps');
      appsServiceAppsResourcesStub = sinon.stub(appsService, 'appsResources');
      appsServiceGetAppHashesStub = sinon.stub(appsService, 'getAppHashes');
      explorerServiceStub = sinon.stub(explorerService, 'getScannedHeight');
      fluxCommunicationStub = sinon.stub(fluxCommunication, 'connectedPeersInfo');
      fluxNetworkHelperStub = sinon.stub(fluxNetworkHelper, 'getIncomingConnectionsInfo');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return flux info no response passed', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });

      const result = await fluxService.getFluxInfo();

      expect(result).to.be.an('object');
      expect(result.status).to.equal('success');
      expect(result.data.daemon).to.eql({ info: 'info data' });
      expect(result.data.node).to.eql({ status: 'status data' });
      expect(result.data.flux).to.be.an('object');
      expect(result.data.apps).to.be.an('object');
      expect(result.data.benchmark).to.eql({
        info: 'info2 data',
        status: 'status2 data',
        bench: 'benchmarks data',
      });
    });

    it('should return flux info response passed', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'success',
        data: {
          daemon: { info: 'info data' },
          node: { status: 'status data' },
          benchmark: {
            info: 'info2 data',
            status: 'status2 data',
            bench: 'benchmarks data',
          },
          apps: {
            fluxusage: 'usage data',
            runningapps: 'listRunningApps data',
            resources: 'appsResources data',
          },
          geolocation: null,
          appsHashesTotal: 1,
          hashesPresent: 1,
        },
      });
    });

    it('should return error if control rpcs returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'error', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'info data' },
      });
    });

    it('should return error if status returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'error', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'status data' },
      });
    });

    it('should return error if benchmarkServiceGetInfo returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'error', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'info2 data' },
      });
    });

    it('should return error if benchmarkServiceGetStatus returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'error', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'status2 data' },
      });
    });

    it('should return error if benchmarkServiceGetBenchmarks returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'error', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'benchmarks data' },
      });
    });

    it('should return error if appsServiceFluxUsage returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'error', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'usage data' },
      });
    });

    it('should return error if appsServiceListRunningApps returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'error', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'listRunningApps data' },
      });
    });

    it('should return error if appsServiceAppsResources returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'error', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'appsResources data' },
      });
    });

    it('should return error if appsServiceGetAppHashesStub returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'error', data: 'getAppHashes data' });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'getAppHashes data' },
      });
    });

    it('should return error if explorerService returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'error', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'getScannedHeight data' },
      });
    });

    it('should return error if fluxCommunication returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'error', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'connectedPeersInfo data' },
      });
    });

    it('should return error if fluxNetworkHelperStub returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceZelnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: 'listRunningApps data' });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'error', data: 'getIncomingConnectionsInfo data' });
      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'getIncomingConnectionsInfo data' },
      });
    });
  });

  describe('adjustCruxID tests', () => {
    let verifyPrivilegeStub;
    let fsPromisesSpy;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      fsPromisesSpy = sinon.stub(fsPromises, 'writeFile');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await fluxService.adjustCruxID(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return a message when cruxid is proper and is adjusted ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          cruxid: 'testing@testing.crux',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'CruxID adjusted',
          name: undefined,
        },
        status: 'success',
      };
      const expectedData = `module.exports = {
        initial: {
          ipaddress: '${adminConfig.initial.ipaddress || '127.0.0.1'}',
          zelid: '${adminConfig.initial.zelid}',
          kadena: '${adminConfig.initial.kadena || ''}',
          testnet: ${adminConfig.initial.testnet || false},
          apiport: ${Number(adminConfig.initial.apiport)},
        }
      }`;
      const fluxDirPath = path.join(__dirname, '../../../flux/config/userconfig.js');

      await fluxService.adjustCruxID(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(fsPromisesSpy, fluxDirPath, expectedData);
    });

    it('should return a message when cruxid is proper, passed in queryand is adjusted', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          test: 'test',
        },
        query: {
          cruxid: 'testing@testing.crux',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'CruxID adjusted',
          name: undefined,
        },
        status: 'success',
      };
      await fluxService.adjustCruxID(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if there is no @ symbol', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          cruxid: 'testingtesting.crux',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Invalid Crux ID provided',
          name: 'Error',
        },
        status: 'error',
      };
      await fluxService.adjustCruxID(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if there is no .crux in the id', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          cruxid: 'testing@testing',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Invalid Crux ID provided',
          name: 'Error',
        },
        status: 'error',
      };
      await fluxService.adjustCruxID(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if no crux id is provided', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'No Crux ID provided',
          name: 'Error',
        },
        status: 'error',
      };
      await fluxService.adjustCruxID(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });
  });

  describe('adjustKadenaAccount tests', () => {
    let verifyPrivilegeStub;
    let fsPromisesSpy;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      fsPromisesSpy = sinon.stub(fsPromises, 'writeFile');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await fluxService.adjustKadenaAccount(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return a message when cruxid is proper and is adjusted ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          account: 'testing',
          chainid: '5',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Kadena account adjusted',
          name: undefined,
        },
        status: 'success',
      };
      const expectedData = `module.exports = {
  initial: {
    ipaddress: '${adminConfig.initial.ipaddress}',
    zelid: '${adminConfig.initial.zelid}',
    kadena: 'kadena:testing?chainid=5',
    testnet: ${adminConfig.initial.testnet},
    apiport: ${Number(adminConfig.initial.apiport)},
  }
}`;
      const fluxDirPath = path.join(__dirname, '../../../flux/config/userconfig.js');

      await fluxService.adjustKadenaAccount(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(fsPromisesSpy, fluxDirPath, expectedData);
    });

    it('should return a message when cruxid is proper, passed in query and is adjusted', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          test: 'test',
        },
        query: {
          account: 'testing',
          chainid: '5',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Kadena account adjusted',
          name: undefined,
        },
        status: 'success',
      };
      await fluxService.adjustKadenaAccount(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if chain id > 20', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          account: 'testingtesting',
          chainid: '22',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Invalid Chain ID 22 provided.',
          name: 'Error',
        },
        status: 'error',
      };
      await fluxService.adjustKadenaAccount(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if chain id < 0', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          account: 'testingtesting',
          chainid: '-1',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Invalid Chain ID -1 provided.',
          name: 'Error',
        },
        status: 'error',
      };
      await fluxService.adjustKadenaAccount(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if there is no account provided', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          chainid: '10',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'No Kadena Account provided',
          name: 'Error',
        },
        status: 'error',
      };
      await fluxService.adjustKadenaAccount(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if no chainid is provided', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          account: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'No Kadena Chain ID provided',
          name: 'Error',
        },
        status: 'error',
      };
      await fluxService.adjustKadenaAccount(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });
  });

  describe('getNodeTier tests', () => {
    let generalServiceNodeTierStub;
    let generalServiceNodeCollateralStub;
    beforeEach(() => {
      generalServiceNodeTierStub = sinon.stub(generalService, 'nodeTier');
      generalServiceNodeCollateralStub = sinon.stub(generalService, 'nodeCollateral');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if values are not correct', async () => {
      generalServiceNodeTierStub.returns('test');
      generalServiceNodeCollateralStub.returns('1');
      const res = generateResponse();
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Unrecognised Flux node tier',
          name: 'Error',
        },
        status: 'error',
      };

      await fluxService.getNodeTier(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return cumulus if tier is basic and collateral is 10000', async () => {
      generalServiceNodeTierStub.returns('basic');
      generalServiceNodeCollateralStub.returns(10000);
      const res = generateResponse();
      const expectedResponse = { status: 'success', data: 'cumulus' };

      await fluxService.getNodeTier(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return nimbus if tier is super and collateral is 25000', async () => {
      generalServiceNodeTierStub.returns('super');
      generalServiceNodeCollateralStub.returns(25000);
      const res = generateResponse();
      const expectedResponse = { status: 'success', data: 'nimbus' };

      await fluxService.getNodeTier(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return stratus if tier is bamf and collateral is 100000', async () => {
      generalServiceNodeTierStub.returns('bamf');
      generalServiceNodeCollateralStub.returns(100000);
      const res = generateResponse();
      const expectedResponse = { status: 'success', data: 'stratus' };

      await fluxService.getNodeTier(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return cumulus_new if tier is basic and collateral is 1000', async () => {
      generalServiceNodeTierStub.returns('basic');
      generalServiceNodeCollateralStub.returns(1000);
      const res = generateResponse();
      const expectedResponse = { status: 'success', data: 'cumulus_new' };

      await fluxService.getNodeTier(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return nimbus_new if tier is super and collateral is 12500', async () => {
      generalServiceNodeTierStub.returns('super');
      generalServiceNodeCollateralStub.returns(12500);
      const res = generateResponse();
      const expectedResponse = { status: 'success', data: 'nimbus_new' };

      await fluxService.getNodeTier(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return stratus_new if tier is bamf and collateral is 40000', async () => {
      generalServiceNodeTierStub.returns('bamf');
      generalServiceNodeCollateralStub.returns(40000);
      const res = generateResponse();
      const expectedResponse = { status: 'success', data: 'stratus_new' };

      await fluxService.getNodeTier(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });
  });

  describe('installFluxWatchTower tests', () => {
    let utilStub;
    let funcStub;

    beforeEach(() => {
      utilStub = sinon.stub(util, 'promisify');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if firewall is active', async () => {
      funcStub = sinon.fake(() => 'Status: active');
      utilStub.returns(funcStub);
      const nodedpath = path.join(__dirname, '../../../flux/helpers');

      await fluxService.installFluxWatchTower();

      sinon.assert.calledOnceWithExactly(funcStub, `cd ${nodedpath} && bash fluxwatchtower.sh`);
    });
  });
});
