const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Readable, Writable } = require('node:stream');
const zlib = require('node:zlib');

const tar = require('tar/create');

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const { expect } = chai;

const sinon = require('sinon');
const proxyquire = require('proxyquire');

const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const cloudUIUpdateService = require('../../ZelBack/src/services/cloudUIUpdateService');
const explorerService = require('../../ZelBack/src/services/explorerService');
const generalService = require('../../ZelBack/src/services/generalService');
const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const appInspector = require('../../ZelBack/src/services/appManagement/appInspector');
const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');
const resourceQueryService = require('../../ZelBack/src/services/appQuery/resourceQueryService');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const daemonServiceControlRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceControlRpcs');
// eslint-disable-next-line no-unused-vars
const daemonServiceBenchmarkRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceFluxnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceFluxnodeRpcs');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const syncthingService = require('../../ZelBack/src/services/syncthingService');
const packageJson = require('../../package.json');

// Mock adminConfig for consistent testing
const adminConfig = {
  initial: {
    ipaddress: '127.0.0.1',
    zelid: '1K6nyw2VjV6jEN1f1CkbKn9htWnYkQabbR',
    kadena: 'kadena:k:b3d922d1a57793651a1e0d951ef1671a10833e170810d3520388628cdc082fce?chainid=0',
    testnet: false,
    development: false,
    apiport: 16127,
    routerIP: '',
    pgpPrivateKey: '',
    pgpPublicKey: '',
    blockedPorts: [],
    blockedRepositories: [],
  },
};

// Create shared fs promises stubs for proxyquire
const fsPromisesStubs = {
  access: sinon.stub().resolves(), // Always resolve successfully
  writeFile: sinon.stub().resolves(), // Shared writeFile stub
};

const fluxService = proxyquire(
  '../../ZelBack/src/services/fluxService',
  {
    '../../../config/userconfig': adminConfig,
    'node:fs/promises': fsPromisesStubs,
  },
);

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  res.download = sinon.fake(() => 'File downloaded');
  res.end = sinon.stub();
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
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null });
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
      sinon.assert.calledWithMatch(runCmdStub, 'npm', { cwd: nodedpath, params: ['run', 'updateflux'] });
    });

    it('should return error if cmd exec throws error', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
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
      sinon.assert.calledWithExactly(runCmdStub, 'npm', { cwd: nodedpath, params: ['run', 'updateflux'] });
    });
  });

  describe('softUpdateFlux tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      const req = {};

      const response = await fluxService.softUpdateFluxApi(req, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({ error: null });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Flux successfully soft updated',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.softUpdateFluxApi({}, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithExactly(runCmdStub, 'npm', { cwd: nodedpath, params: ['run', 'softupdate'] });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
      });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error soft updating Flux: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.softUpdateFluxApi({}, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithExactly(runCmdStub, 'npm', { cwd: nodedpath, params: ['run', 'softupdate'] });
    });
  });

  describe('softUpdateFluxInstall tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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

      const response = await fluxService.softUpdateFluxInstallApi({}, res);

      expect(response).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledWithExactly(res.json, expectedResponse);
    });

    it('should return success message if cmd exec does not return error', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({ error: null });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Flux successfully soft updated with installation',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.softUpdateFluxInstallApi({}, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithExactly(runCmdStub, 'npm', { cwd: nodedpath, params: ['run', 'softupdateinstall'] });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
      });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error soft updating Flux with installation: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.softUpdateFluxInstallApi({}, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithExactly(runCmdStub, 'npm', { cwd: nodedpath, params: ['run', 'softupdateinstall'] });
    });
  });

  describe('hardUpdateFlux tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Flux successfully hard updated',
          name: undefined,
        },
        status: 'success',
      };
      const res = generateResponse();

      await fluxService.hardUpdateFlux(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithExactly(runCmdStub, 'npm', { cwd: nodedpath, params: ['run', 'hardupdateflux'] });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
      });
      const nodedpath = path.join(__dirname, '../../');

      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error hard updating Flux: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.hardUpdateFlux(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithExactly(runCmdStub, 'npm', { cwd: nodedpath, params: ['run', 'hardupdateflux'] });
    });
  });

  // The UI is fetched from a published release, so this asserts the fetch was asked for
  // rather than that some package script was spawned. The script this used to name was
  // deleted with the UI it built, and a stubbed runCommand cannot tell a script that is
  // missing from one that succeeded - so the endpoint returned an error in the field
  // while its tests stayed green.
  describe('rebuildUi tests', () => {
    let verifyPrivilegeStub;
    let runUpdateScriptStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runUpdateScriptStub = sinon.stub(cloudUIUpdateService, 'runUpdateScript');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should refuse a caller who is not an admin or flux team', async () => {
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

      await fluxService.rebuildUi(undefined, res);

      sinon.assert.calledWithExactly(res.json, expectedResponse);
      sinon.assert.notCalled(runUpdateScriptStub);
    });

    it('should report success when the UI is fetched', async () => {
      verifyPrivilegeStub.returns(true);
      runUpdateScriptStub.resolves(true);
      const res = generateResponse();

      await fluxService.rebuildUi(undefined, res);

      sinon.assert.calledOnce(runUpdateScriptStub);
      expect(res.json.firstCall.args[0].status).to.equal('success');
      expect(res.json.firstCall.args[0].data.message).to.equal('Flux UI successfully rebuilt');
    });

    it('should report an error when the fetch fails', async () => {
      verifyPrivilegeStub.returns(true);
      runUpdateScriptStub.resolves(false);
      const res = generateResponse();

      await fluxService.rebuildUi(undefined, res);

      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.contain('Error rebuilding Flux UI');
    });

    // The regression this replaced: a package script named here is one more thing that can
    // be deleted somewhere else without anything failing until a node runs it.
    it('should not spawn a package script of its own', async () => {
      verifyPrivilegeStub.returns(true);
      runUpdateScriptStub.resolves(true);

      await fluxService.rebuildUi(undefined, generateResponse());

      sinon.assert.notCalled(runCmdStub);
    });
  });

  describe('updateDaemon tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null });
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/updateDaemon.sh`, { cwd: nodedpath });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/updateDaemon.sh`, { cwd: nodedpath });
    });
  });

  describe('updateBenchmark tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null });
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/updateBenchmark.sh`, { cwd: nodedpath });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/updateBenchmark.sh`, { cwd: nodedpath });
    });
  });

  describe('startBenchmark tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null });

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
      sinon.assert.calledWithExactly(runCmdStub, 'fluxbenchd', { params: ['-daemon'] });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
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
      sinon.assert.calledWithExactly(runCmdStub, 'fluxbenchd', { params: ['-daemon'] });
    });
  });

  describe('restartBenchmark tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null });
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/restartBenchmark.sh`, { cwd: nodedpath });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/restartBenchmark.sh`, { cwd: nodedpath });
    });
  });

  describe('startDaemon tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null });

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
      sinon.assert.calledWithExactly(runCmdStub, 'fluxd');
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
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
      sinon.assert.calledWithExactly(runCmdStub, 'fluxd');
    });
  });

  describe('restartDaemon tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null });
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/restartDaemon.sh`, { cwd: nodedpath });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/restartDaemon.sh`, { cwd: nodedpath });
    });
  });

  describe('reindexDaemon tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null });
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/reindexDaemon.sh`, { cwd: nodedpath });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
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
      sinon.assert.calledWithExactly(runCmdStub, `${nodedpath}/reindexDaemon.sh`, { cwd: nodedpath });
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
    let originalUserConfig;

    beforeEach(() => {
      originalUserConfig = globalThis.userconfig;
      globalThis.userconfig = adminConfig;
    });

    afterEach(() => {
      globalThis.userconfig = originalUserConfig;
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

  describe('getFluxKadena tests', () => {
    let originalUserConfig;

    beforeEach(() => {
      originalUserConfig = globalThis.userconfig;
      globalThis.userconfig = adminConfig;
    });

    afterEach(() => {
      globalThis.userconfig = originalUserConfig;
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
    let getLocalSocketAddressStub;

    beforeEach(() => {
      getLocalSocketAddressStub = sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress');
    });

    afterEach(() => {
      getLocalSocketAddressStub.restore();
    });

    it('should return socket address if available, no response passed', async () => {
      getLocalSocketAddressStub.resolves('127.0.0.1:5050');
      const expectedResponse = {
        status: 'success',
        data: '127.0.0.1:5050',
      };

      const getIpResult = await fluxService.getFluxIP();

      expect(getIpResult).to.eql(expectedResponse);
      sinon.assert.calledOnce(getLocalSocketAddressStub);
    });

    it('should return socket address if available, response passed', async () => {
      getLocalSocketAddressStub.resolves('127.0.0.1:5050');
      const expectedResponse = {
        status: 'success',
        data: '127.0.0.1:5050',
      };
      const res = generateResponse();

      const getIpResult = await fluxService.getFluxIP(undefined, res);

      expect(getIpResult).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledOnce(getLocalSocketAddressStub);
    });

    it('should return null if IP cannot be detected', async () => {
      getLocalSocketAddressStub.resolves(null);
      const expectedResponse = {
        status: 'success',
        data: null,
      };

      const getIpResult = await fluxService.getFluxIP();

      expect(getIpResult).to.be.eql(expectedResponse);
      sinon.assert.calledOnce(getLocalSocketAddressStub);
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
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
      // Mock daemon service utils to return valid paths
      sinon.stub(daemonServiceUtils, 'getConfigValue').returns(path.join(os.homedir(), '.flux'));
      sinon.stub(daemonServiceUtils, 'getFluxdDir').returns(path.join(os.homedir(), '.flux'));
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
      runCmdStub.resolves({ error: null, stdout: 'success message' });

      await fluxService.tailDaemonDebug(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'success message' },
      });
    });

    it('should return error if cmd exec throws error', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
      });
      const nodedpath = path.join(os.homedir(), '.flux', 'debug.log');
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
      sinon.assert.calledWithMatch(runCmdStub, 'tail', { params: ['-n', '100', nodedpath] });
    });
  });

  describe('tailBenchmarkDebug tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;
    // eslint-disable-next-line no-unused-vars
    let fsAccessStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
      // Force fs.access to fail so it falls back to .zelbenchmark path
      fsAccessStub = sinon.stub(fs, 'access').callsFake(() => Promise.reject(new Error('ENOENT: no such file or directory')));
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
      runCmdStub.resolves({ error: null, stdout: 'some logs' });

      await fluxService.tailBenchmarkDebug(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledWithMatch(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'some logs' },
      });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
      });
      const nodedpath = path.join(__dirname, '../../../.fluxbenchmark/debug.log'); // Updated to match current implementation
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
      sinon.assert.calledWithMatch(runCmdStub, 'tail', { params: ['-n', '100', nodedpath] });
    });
  });

  describe('fluxLog tests', () => {
    it('should trigger download ', async () => {
      const res = generateResponse();
      const filename = 'test';
      const filepath = path.join(__dirname, `../../${filename}.log`);

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
      const filepath = path.join(__dirname, '../../error.log');

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
      const filepath = path.join(__dirname, '../../info.log');

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
      const filepath = path.join(__dirname, '../../debug.log');

      await fluxService.fluxDebugLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.download, filepath, 'debug.log');
    });
  });

  describe('tailFluxLog tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null, stdout: 'success message' });

      await fluxService.tailFluxLog(undefined, res);
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'success message' },
      });
    });

    it('should return error if cmd exec throws error ', async () => {
      verifyPrivilegeStub.returns(true);
      runCmdStub.resolves({
        error: {
          message: 'This is an error',
          code: 403,
          name: 'testing error',
        },
      });
      const nodePath = path.join(__dirname, '../../test.log');
      const expectedResponse = {
        data: {
          code: 403,
          message: 'Error obtaining Flux log file: This is an error',
          name: 'testing error',
        },
        status: 'error',
      };
      const res = generateResponse();

      await fluxService.tailFluxLog(undefined, res, 'test');
      await serviceHelper.delay(200);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWithMatch(runCmdStub, 'tail', { params: ['-n', '100', nodePath] });
    });
  });

  describe('tailFluxErrorLog tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized', async () => {
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
      runCmdStub.resolves({ error: null, stdout: 'success message' });

      await fluxService.tailFluxErrorLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'success message',
        },
      });
    });
  });

  describe('tailFluxWarnLog tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null, stdout: 'success message' });

      await fluxService.tailFluxWarnLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'success message',
        },
      });
    });
  });

  describe('tailFluxInfoLog tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null, stdout: 'success message' });

      await fluxService.tailFluxInfoLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'success message',
        },
      });
    });
  });

  describe('tailFluxDebugLog tests', () => {
    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
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
      runCmdStub.resolves({ error: null, stdout: 'success message' });

      await fluxService.tailFluxDebugLog(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'success message',
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
    let daemonServiceFluxnodeRpcsStub;
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
    let syncthingServiceStub;

    beforeEach(() => {
      daemonServiceControlRpcsStub = sinon.stub(daemonServiceControlRpcs, 'getInfo');
      daemonServiceFluxnodeRpcsStub = sinon.stub(daemonServiceFluxnodeRpcs, 'getFluxNodeStatus');
      benchmarkServiceGetInfoStub = sinon.stub(benchmarkService, 'getInfo');
      benchmarkServiceGetStatusStub = sinon.stub(benchmarkService, 'getStatus');
      benchmarkServiceGetBenchmarksStub = sinon.stub(benchmarkService, 'getBenchmarks');
      sinon.stub(appInspector, 'getAppsDOSState').returns({ status: 'success', data: { state: 'ok' } });
      appsServiceFluxUsageStub = sinon.stub(resourceQueryService, 'fluxUsage');
      appsServiceListRunningAppsStub = sinon.stub(appQueryService, 'listRunningApps');
      appsServiceAppsResourcesStub = sinon.stub(resourceQueryService, 'appsResources');
      appsServiceGetAppHashesStub = sinon.stub(registryManager, 'getAppHashes');
      explorerServiceStub = sinon.stub(explorerService, 'getScannedHeight');
      fluxCommunicationStub = sinon.stub(fluxCommunication, 'connectedPeersInfo');
      fluxNetworkHelperStub = sinon.stub(fluxNetworkHelper, 'getIncomingConnectionsInfo');
      syncthingServiceStub = sinon.stub(syncthingService, 'systemVersion');
    });

    afterEach(() => {
      sinon.restore();
    });

    // A container as docker reports it, so what /flux/info publishes of it is
    // decided by the projection rather than by what the stub was told to say.
    const runningContainer = {
      Id: '9f2c1b0e4d3a',
      Names: ['/fluxwww_App'],
      Image: 'someregistry.example/private:1.2.3',
      ImageID: 'sha256:0123456789abcdef',
      Command: '/entrypoint.sh --serve',
      Ports: [{ PrivatePort: 8080, PublicPort: 31000, Type: 'tcp' }],
      Labels: { 'org.opencontainers.image.revision': 'a1b2c3d4' },
      State: 'running',
      Status: 'Up 2 hours',
    };

    it('should return flux info no response passed', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const result = await fluxService.getFluxInfo();

      expect(result).to.be.an('object');
      expect(result.status).to.equal('success');
      expect(result.data.daemon).to.eql({ info: 'info data', zmqEnabled: false });
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
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

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
            // /flux/info carries the same public view /apps/listrunningapps
            // serves - it embeds the container listing, and a projection
            // applied at one exit and not the other is the shape it exists
            // to avoid.
            runningapps: [{ Names: ['/fluxwww_App'], State: 'running', Status: 'Up 2 hours' }],
            resources: 'appsResources data',
          },
          geolocation: null,
          appsHashesTotal: 1,
          hashesPresent: 1,
        },
      });
    });

    // calledOnceWithMatch is a partial match, so the assertion above would pass
    // on a runningapps entry that also carried the image. This one reads the key
    // set, which is the property the projection exists to hold.
    it('publishes three container fields and no others', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const result = await fluxService.getFluxInfo();

      expect(result.data.apps.runningapps).to.have.lengthOf(1);
      expect(Object.keys(result.data.apps.runningapps[0]).sort())
        .to.deep.equal(['Names', 'State', 'Status']);
    });

    it('should return error if control rpcs returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'error', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'info data' },
      });
    });

    it('should return error if status returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'error', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'status data' },
      });
    });

    it('should return error if benchmarkServiceGetInfo returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'error', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'info2 data' },
      });
    });

    it('should return error if benchmarkServiceGetStatus returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'error', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'status2 data' },
      });
    });

    it('should return error if benchmarkServiceGetBenchmarks returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'error', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'benchmarks data' },
      });
    });

    it('should return error if appsServiceFluxUsage returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'error', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'usage data' },
      });
    });

    it('should return error if appsServiceListRunningApps returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
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
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'listRunningApps data' },
      });
    });

    it('should return error if appsServiceAppsResources returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'error', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'appsResources data' },
      });
    });

    it('should return error if appsServiceGetAppHashesStub returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'error', data: 'getAppHashes data' });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'getAppHashes data' },
      });
    });

    it('should return error if explorerService returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'error', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'getScannedHeight data' },
      });
    });

    it('should return error if fluxCommunication returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'error', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'success', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'connectedPeersInfo data' },
      });
    });

    it('should return error if fluxNetworkHelperStub returns error', async () => {
      daemonServiceControlRpcsStub.returns({ status: 'success', data: 'info data' });
      daemonServiceFluxnodeRpcsStub.returns({ status: 'success', data: 'status data' });
      benchmarkServiceGetInfoStub.returns({ status: 'success', data: 'info2 data' });
      benchmarkServiceGetStatusStub.returns({ status: 'success', data: 'status2 data' });
      benchmarkServiceGetBenchmarksStub.returns({ status: 'success', data: 'benchmarks data' });
      appsServiceFluxUsageStub.returns({ status: 'success', data: 'usage data' });
      appsServiceListRunningAppsStub.returns({ status: 'success', data: [runningContainer] });
      appsServiceAppsResourcesStub.returns({ status: 'success', data: 'appsResources data' });
      appsServiceGetAppHashesStub.returns({ status: 'success', data: [{ height: 694000, message: true }] });
      explorerServiceStub.returns({ status: 'success', data: 'getScannedHeight data' });
      fluxCommunicationStub.returns({ status: 'success', data: 'connectedPeersInfo data' });
      fluxNetworkHelperStub.returns({ status: 'error', data: 'getIncomingConnectionsInfo data' });
      syncthingServiceStub.returns({ status: 'success', data: 'syncthingVersion data' });

      const res = generateResponse();

      await fluxService.getFluxInfo(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'getIncomingConnectionsInfo data' },
      });
    });
  });

  describe('routerIP tests', () => {
    let verifyPrivilegeStub;
    let originalUserConfig;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      // Reset the shared writeFile stub for each test
      fsPromisesStubs.writeFile.resetHistory();
      // Mock userconfig to match test expectations
      originalUserConfig = globalThis.userconfig;
      globalThis.userconfig = adminConfig;
    });

    afterEach(() => {
      sinon.restore();
      // Restore original userconfig
      globalThis.userconfig = originalUserConfig;
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
      await fluxService.adjustRouterIP(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return a message when routerIP is proper and is adjusted ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          routerip: '192.168.1.50',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'Router IP adjusted',
          name: undefined,
        },
        status: 'success',
      };
      // eslint-disable-next-line no-unused-vars
      const expectedData = `module.exports = {
        initial: {
          ipaddress: '${adminConfig.initial.ipaddress || '127.0.0.1'}',
          zelid: '${adminConfig.initial.zelid}',
          kadena: '${adminConfig.initial.kadena || ''}',
          testnet: ${adminConfig.initial.testnet || false},
          development: ${adminConfig.initial.development || false},
          apiport: ${Number(adminConfig.initial.apiport)},
          routerIP: '192.168.1.50',
          pgpPrivateKey: \`${adminConfig.initial.pgpPrivateKey}\`,
          pgpPublicKey: \`${adminConfig.initial.pgpPublicKey}\`,
          blockedPorts: ${JSON.stringify(adminConfig.initial.blockedPorts || [])},
          blockedRepositories: ${JSON.stringify(adminConfig.initial.blockedRepositories || []).replace(/"/g, "'")},
        }
      }`;
      const fluxDirPath = path.join(__dirname, '../../config/userconfig.js');

      await fluxService.adjustRouterIP(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWith(fsPromisesStubs.writeFile, fluxDirPath, sinon.match.string);
    });
  });

  describe('apiport tests', () => {
    let verifyPrivilegeStub;
    let originalUserConfig;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      // Reset the shared writeFile stub for each test
      fsPromisesStubs.writeFile.resetHistory();
      // Mock userconfig to match test expectations
      originalUserConfig = globalThis.userconfig;
      globalThis.userconfig = adminConfig;
    });

    afterEach(() => {
      sinon.restore();
      // Restore original userconfig
      globalThis.userconfig = originalUserConfig;
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
      await fluxService.adjustAPIPort(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if not valid api port is provided', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          apiport: '16450',
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'API Port not valid',
          name: undefined,
        },
        status: 'error',
      };
      await fluxService.adjustAPIPort(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return a message when apiport is proper and is adjusted ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(true);
      const req = {
        params: {
          apiport: 16147,
        },
      };
      const expectedResponse = {
        data: {
          code: undefined,
          message: 'API Port adjusted. A restart of FluxOS is necessary',
          name: undefined,
        },
        status: 'success',
      };
      // eslint-disable-next-line no-unused-vars
      const expectedData = `module.exports = {
        initial: {
          ipaddress: '${adminConfig.initial.ipaddress || '127.0.0.1'}',
          zelid: '${adminConfig.initial.zelid}',
          kadena: '${adminConfig.initial.kadena || ''}',
          testnet: ${adminConfig.initial.testnet || false},
          development: ${adminConfig.initial.development || false},
          apiport: ${Number(16147)},
          routerIP: '${adminConfig.initial.routerIP || ''}',
          pgpPrivateKey: \`${adminConfig.initial.pgpPrivateKey}\`,
          pgpPublicKey: \`${adminConfig.initial.pgpPublicKey}\`,
          blockedPorts: ${JSON.stringify(adminConfig.initial.blockedPorts || [])},
          blockedRepositories: ${JSON.stringify(adminConfig.initial.blockedRepositories || []).replace(/"/g, "'")},
        }
      }`;
      const fluxDirPath = path.join(__dirname, '../../config/userconfig.js');

      await fluxService.adjustAPIPort(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWith(fsPromisesStubs.writeFile, fluxDirPath, sinon.match.string);
    });
  });

  describe('blockedPorts tests', () => {
    let verifyPrivilegeStub;
    let originalUserConfig;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      // Reset the shared writeFile stub for each test
      fsPromisesStubs.writeFile.resetHistory();
      // Mock userconfig to match test expectations
      originalUserConfig = globalThis.userconfig;
      globalThis.userconfig = adminConfig;
    });

    afterEach(() => {
      sinon.restore();
      // Restore original userconfig
      globalThis.userconfig = originalUserConfig;
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
      await fluxService.adjustBlockedPorts(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if blockedPorts is not an array', async () => {
      const postData = { blockedPorts: '12' };
      const mockRes = {
        json: sinon.fake(),
        status: sinon.stub().returnsThis(),
      };
      const mockReq = {
        body: postData,
        method: 'POST',
      };
      const expectedResponse = {
        status: 'error',
        data: {
          code: undefined,
          message: 'Blocked Ports is not a valid array',
          name: 'Error',
        },
      };

      verifyPrivilegeStub.returns(true);
      await fluxService.adjustBlockedPorts(mockReq, mockRes);
      sinon.assert.calledOnceWithExactly(mockRes.json, expectedResponse);
    });

    it('should return a message when blockedPorts is proper and is adjusted ', async () => {
      const postData = { blockedPorts: [12, 32] };
      const mockRes = {
        json: sinon.fake(),
        status: sinon.stub().returnsThis(),
      };
      const mockReq = {
        body: postData,
        method: 'POST',
      };
      const expectedResponse = {
        status: 'success',
        data: {
          code: undefined,
          message: 'User Blocked Ports adjusted',
          name: undefined,
        },
      };
      // eslint-disable-next-line no-unused-vars
      const expectedData = `module.exports = {
            initial: {
              ipaddress: '${adminConfig.initial.ipaddress || '127.0.0.1'}',
              zelid: '${adminConfig.initial.zelid}',
              kadena: '${adminConfig.initial.kadena || ''}',
              testnet: ${adminConfig.initial.testnet || false},
              development: ${adminConfig.initial.development || false},
              apiport: ${Number(adminConfig.initial.apiport)},
              routerIP: '${adminConfig.initial.routerIP || ''}',
              pgpPrivateKey: \`${adminConfig.initial.pgpPrivateKey}\`,
              pgpPublicKey: \`${adminConfig.initial.pgpPublicKey}\`,
              blockedPorts: [12,32],
              blockedRepositories: ${JSON.stringify(adminConfig.initial.blockedRepositories || []).replace(/"/g, "'")},
            }
          }`;
      const fluxDirPath = path.join(__dirname, '../../config/userconfig.js');

      verifyPrivilegeStub.returns(true);
      await fluxService.adjustBlockedPorts(mockReq, mockRes);
      sinon.assert.calledOnceWithExactly(mockRes.json, expectedResponse);
      sinon.assert.calledWith(fsPromisesStubs.writeFile, fluxDirPath, sinon.match.string);
    });
  });

  describe('blockedRepositories tests', () => {
    let verifyPrivilegeStub;
    let originalUserConfig;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      // Reset the shared writeFile stub for each test
      fsPromisesStubs.writeFile.resetHistory();
      // Mock userconfig to match test expectations
      originalUserConfig = globalThis.userconfig;
      globalThis.userconfig = adminConfig;
    });

    afterEach(() => {
      sinon.restore();
      // Restore original userconfig
      globalThis.userconfig = originalUserConfig;
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
      await fluxService.adjustBlockedRepositories(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if blockedRepositories is not an array', async () => {
      const postData = { blockedRepositories: 'lol/test' };
      const mockRes = {
        json: sinon.fake(),
        status: sinon.stub().returnsThis(),
      };
      const mockReq = {
        body: postData,
        method: 'POST',
      };
      const expectedResponse = {
        status: 'error',
        data: {
          code: undefined,
          message: 'Blocked Repositories is not a valid array',
          name: 'Error',
        },
      };

      verifyPrivilegeStub.returns(true);
      await fluxService.adjustBlockedRepositories(mockReq, mockRes);
      sinon.assert.calledOnceWithExactly(mockRes.json, expectedResponse);
    });

    it('should return a message when blockedRepositories is proper and is adjusted', async () => {
      const postData = { blockedRepositories: ['blabla/test', 'ban/this'] };
      const mockRes = {
        json: sinon.fake(),
        status: sinon.stub().returnsThis(),
      };
      const mockReq = {
        body: postData,
        method: 'POST',
      };
      const expectedResponse = {
        status: 'success',
        data: {
          code: undefined,
          message: 'User Blocked Repositories adjusted',
          name: undefined,
        },
      };
      // eslint-disable-next-line no-unused-vars
      const expectedData = `module.exports = {
            initial: {
              ipaddress: '${adminConfig.initial.ipaddress || '127.0.0.1'}',
              zelid: '${adminConfig.initial.zelid}',
              kadena: '${adminConfig.initial.kadena || ''}',
              testnet: ${adminConfig.initial.testnet || false},
              development: ${adminConfig.initial.development || false},
              apiport: ${Number(adminConfig.initial.apiport)},
              routerIP: '${adminConfig.initial.routerIP || ''}',
              pgpPrivateKey: \`${adminConfig.initial.pgpPrivateKey}\`,
              pgpPublicKey: \`${adminConfig.initial.pgpPublicKey}\`,
              blockedPorts: ${JSON.stringify(adminConfig.initial.blockedPorts || [])},
              blockedRepositories: ['blabla/test','ban/this'],
            }
          }`;
      const fluxDirPath = path.join(__dirname, '../../config/userconfig.js');

      verifyPrivilegeStub.returns(true);
      await fluxService.adjustBlockedRepositories(mockReq, mockRes);
      sinon.assert.calledOnceWithExactly(mockRes.json, expectedResponse);
      sinon.assert.calledWith(fsPromisesStubs.writeFile, fluxDirPath, sinon.match.string);
    });
  });

  describe('adjustKadenaAccount tests', () => {
    let verifyPrivilegeStub;
    let originalUserConfig;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      // Reset the shared writeFile stub for each test
      fsPromisesStubs.writeFile.resetHistory();
      // Mock userconfig to match test expectations
      originalUserConfig = globalThis.userconfig;
      globalThis.userconfig = adminConfig;
    });

    afterEach(() => {
      sinon.restore();
      // Restore original userconfig
      globalThis.userconfig = originalUserConfig;
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

    it('should return a message when kadena account is proper and is adjusted ', async () => {
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
      // eslint-disable-next-line no-unused-vars
      const expectedData = `module.exports = {
  initial: {
    ipaddress: '${adminConfig.initial.ipaddress}',
    zelid: '${adminConfig.initial.zelid}',
    kadena: 'kadena:testing?chainid=5',
    testnet: ${adminConfig.initial.testnet},
    development: ${adminConfig.initial.development},
    apiport: ${Number(adminConfig.initial.apiport)},
    routerIP: '${adminConfig.initial.routerIP}',
    pgpPrivateKey: \`${adminConfig.initial.pgpPrivateKey}\`,
    pgpPublicKey: \`${adminConfig.initial.pgpPublicKey}\`,
    blockedPorts: [],
    blockedRepositories: [],
  }
}`;
      const fluxDirPath = path.join(__dirname, '../../config/userconfig.js');

      await fluxService.adjustKadenaAccount(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledWith(fsPromisesStubs.writeFile, fluxDirPath, sinon.match.string);
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

  describe('streamChain tests', () => {
    let osStub;
    // eslint-disable-next-line no-unused-vars
    let readdirStub;
    let daemonServiceUtilsStub;
    let tarPackStub;

    beforeEach(() => {
      osStub = sinon.stub(os, 'homedir');
      // Reset and configure the shared fs stubs for streamChain tests
      if (!fsPromisesStubs.stat || typeof fsPromisesStubs.stat.resetHistory !== 'function') {
        fsPromisesStubs.stat = sinon.stub();
      } else {
        fsPromisesStubs.stat.resetHistory();
      }
      if (!fsPromisesStubs.readdir || typeof fsPromisesStubs.readdir.resetHistory !== 'function') {
        fsPromisesStubs.readdir = sinon.stub();
      } else {
        fsPromisesStubs.readdir.resetHistory();
      }

      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'buildFluxdClient');
      tarPackStub = sinon.stub(tar, 'create');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return 422 if streaming is disabled', async () => {
      const res = generateResponse();
      fluxService.disableStreaming();

      await fluxService.streamChain(null, res);

      expect(res.statusMessage).to.equal('Failed minimium throughput criteria. Disabled.');
      expect(fluxService.getStreamLock()).to.equal(false);

      sinon.assert.calledWithExactly(res.status, 422);
      sinon.assert.calledOnce(res.end);
      fluxService.enableStreaming();
    });

    it('should return 503 if a stream is already in progress', async () => {
      const res = generateResponse();
      fluxService.lockStreamLock();

      await fluxService.streamChain(null, res);

      expect(res.statusMessage).to.equal('Streaming of chain already in progress, server busy.');
      expect(fluxService.getStreamLock()).to.equal(true);
      sinon.assert.calledWithExactly(res.status, 503);
      sinon.assert.calledOnce(res.end);
      fluxService.unlockStreamLock();
    });

    it('should lock if no other streams are in progress', async () => {
      // add this test
    });

    it('should return 400 if Fluxnode is behind a proxy', async () => {
      const res = generateResponse();
      const req = { socket: { remoteAddress: '' } };

      await fluxService.streamChain(req, res);

      expect(res.statusMessage).to.equal('Socket closed.');
      sinon.assert.calledWithExactly(res.status, 400);
      sinon.assert.calledOnce(res.end);
    });

    it('should return 403 if request if from a public IP address', async () => {
      const res = generateResponse();
      const req = { socket: { remoteAddress: '1.2.3.4' } };

      await fluxService.streamChain(req, res);

      expect(res.statusMessage).to.equal('Request must be from an address on the same private network as the host.');
      sinon.assert.calledWithExactly(res.status, 403);
      sinon.assert.calledOnce(res.end);
    });

    it('should return 500 if any chain folders are missing', async () => {
      const res = generateResponse();
      const req = { socket: { remoteAddress: '10.20.30.40' } };

      osStub.returns('/home/testuser');

      fsPromisesStubs.stat.rejects(new Error("Test block dir doesn't exist"));

      await fluxService.streamChain(req, res);

      expect(res.statusMessage).to.equal('Unable to find chain');
      sinon.assert.calledWithExactly(res.status, 500);
      sinon.assert.calledOnce(res.end);
    });

    it('should return 422 if unsafe and compression requested', async () => {
      const res = generateResponse();
      const req = { socket: { remoteAddress: '10.20.30.40' }, body: { unsafe: true, compress: true } };

      osStub.returns('/home/testuser');
      // Use callsFake to ensure each call to stat returns the right value
      fsPromisesStubs.stat.callsFake(async () => ({ isDirectory: () => true }));

      await fluxService.streamChain(req, res);

      expect(res.statusMessage).to.equal('Unable to compress blockchain in unsafe mode, it will corrupt new db.');
      sinon.assert.calledWithExactly(res.status, 422);
      sinon.assert.calledOnce(res.end);
    });

    it('should return 503 when fluxd still running when in safe mode', async () => {
      const res = generateResponse();
      const req = { socket: { remoteAddress: '10.20.30.40' } };

      osStub.returns('/home/testuser');
      fsPromisesStubs.stat.resolves({ isDirectory: () => true });
      daemonServiceUtilsStub.resolves({ run: async () => 123456 });

      await fluxService.streamChain(req, res);

      expect(res.statusMessage).to.equal('Flux daemon still running, unable to clone blockchain.');
      sinon.assert.calledWithExactly(res.status, 503);
      sinon.assert.calledOnce(res.end);
    });

    it('should set Approx-Content-Length response header with expected value', async () => {
      const received = [];

      const req = { socket: { remoteAddress: '10.20.30.40' } };

      const res = new Writable({
        write(chunk, encoding, done) {
          received.push(chunk.toString());
          done();
        },
      });

      res.setHeader = sinon.stub();

      let count = 0;
      const readable = new Readable({
        read() {
          this.push('test');
          if (count === 3) this.push(null);
          count += 1;
        },
      });

      osStub.returns('/home/testuser');

      const createFile = (name) => ({
        name,
        isDirectory: () => false,
        isFile: () => true,
      });

      const folderCount = 3;
      const testFileSize = 1048576;
      const testFiles = [...Array(50).keys()].map((x) => createFile(x.toString()));
      const headerSize = testFiles.length * 512 * folderCount;
      const eof = 1024;
      const totalFileSize = testFiles.length * testFileSize * folderCount;
      const expectedSize = headerSize + totalFileSize + eof;

      const daemonServiceError = new Error();
      daemonServiceError.code = 'ECONNREFUSED';

      fsPromisesStubs.stat.resolves({
        isDirectory: () => true,
        size: testFileSize,
      });

      fsPromisesStubs.readdir.resolves(testFiles);

      daemonServiceUtilsStub.resolves({ run: async () => daemonServiceError });
      tarPackStub.returns(readable);

      // Stub serviceHelper.dirInfo to return expected data for each folder
      const dirInfoStub = sinon.stub(serviceHelper, 'dirInfo');
      dirInfoStub.resolves({
        count: testFiles.length, // 50 files per folder
        size: testFiles.length * testFileSize, // total size per folder
      });

      await fluxService.streamChain(req, res);
      sinon.assert.calledWithExactly(res.setHeader, 'Approx-Content-Length', expectedSize.toString());
    });

    it('should stream chain uncompressed when no compression requested', async () => {
      const received = [];

      const req = { socket: { remoteAddress: '10.20.30.40' } };
      const daemonServiceError = new Error();
      daemonServiceError.code = 'ECONNREFUSED';

      const res = new Writable({
        write(chunk, encoding, done) {
          received.push(chunk.toString());
          done();
        },
      });

      res.setHeader = sinon.stub();

      let count = 0;
      const readable = new Readable({
        read() {
          this.push('test');
          if (count === 3) this.push(null);
          count += 1;
        },
      });

      osStub.returns('/home/testuser');
      fsPromisesStubs.stat.resolves({ isDirectory: () => true });
      daemonServiceUtilsStub.resolves({ run: async () => daemonServiceError });
      tarPackStub.returns(readable);

      await fluxService.streamChain(req, res);
      expect(received).to.deep.equal(['test', 'test', 'test', 'test']);
    });

    it('should stream chain compressed when compression requested', async () => {
      const received = [];

      const req = { socket: { remoteAddress: '10.20.30.40' }, body: { compress: true } };

      const daemonServiceError = new Error();
      daemonServiceError.code = 'ECONNREFUSED';

      const res = zlib.createGunzip();
      res.setHeader = sinon.stub();

      res.on('data', (data) => {
        // this gets all data in buffer
        received.push(data.toString());
      });

      res.on('end', () => { });

      let count = 0;
      const readable = new Readable({
        read() {
          this.push('test');
          if (count === 3) this.push(null);
          count += 1;
        },
      });

      osStub.returns('/home/testuser');
      fsPromisesStubs.stat.resolves({ isDirectory: () => true });
      daemonServiceUtilsStub.resolves({ run: async () => daemonServiceError });
      tarPackStub.returns(readable);

      await fluxService.streamChain(req, res);
      expect(received).to.deep.equal(['testtesttesttest']);
    });
  });
  // Each of these is a pair: an endpoint that authorises, and an operation that
  // does not, because it has no caller to authorise. One function cannot be
  // both, which is what the shape these replaced attempted - it decided whether
  // to check by whether a request object happened to have been passed, so the
  // scheduler that passed none was trusted, and so was anyone who arrived in a
  // way that left it undefined.
  describe('the command is behind the privilege check, not beside it', () => {
    // Two kinds of operation under one rule. The update pair runs a package script; the
    // branch switch drives git directly, so it is asserted on the git it runs.
    const npmPairs = [
      ['softUpdateFluxApi', 'softupdate'],
      ['softUpdateFluxInstallApi', 'softupdateinstall'],
    ];
    const gitPairs = [
      ['enterMasterApi', 'master'],
      ['enterDevelopmentApi', 'development'],
    ];

    let verifyPrivilegeStub;
    let runCmdStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: 'master\n' });
    });

    afterEach(() => {
      sinon.restore();
    });

    [...npmPairs, ...gitPairs].forEach(([api]) => {
      it(`${api} runs nothing when the caller is refused`, async () => {
        verifyPrivilegeStub.resolves(false);

        await fluxService[api]({}, generateResponse());

        sinon.assert.notCalled(runCmdStub);
      });
    });

    npmPairs.forEach(([api, script]) => {
      it(`${api} runs npm ${script} once the caller is admitted`, async () => {
        verifyPrivilegeStub.resolves(true);

        await fluxService[api]({}, generateResponse());

        sinon.assert.calledOnceWithMatch(runCmdStub, 'npm', { params: ['run', script] });
      });
    });

    gitPairs.forEach(([api, branch]) => {
      it(`${api} verifies ${branch} exists before checking it out`, async () => {
        verifyPrivilegeStub.resolves(true);

        await fluxService[api]({}, generateResponse());

        sinon.assert.calledWithMatch(runCmdStub, 'git', { params: ['rev-parse', '--verify', branch] });
        sinon.assert.calledWithMatch(runCmdStub, 'git', { params: ['checkout', branch] });
      });

      it(`${api} does not pull, so a switch changes the branch and nothing else`, async () => {
        verifyPrivilegeStub.resolves(true);

        await fluxService[api]({}, generateResponse());

        sinon.assert.neverCalledWithMatch(runCmdStub, 'git', { params: ['pull'] });
      });
    });

    // The operation itself takes no request and consults nobody. If one of
    // these ever asks a privilege question again, the endpoint above stops
    // being the only door and this fails.
    [...npmPairs, ...gitPairs].forEach(([api]) => {
      const operation = api.replace(/Api$/, '');
      it(`${operation} authorises nobody - that is the endpoint's job`, async () => {
        await fluxService[operation]();

        sinon.assert.notCalled(verifyPrivilegeStub);
        sinon.assert.called(runCmdStub);
      });
    });
  });

  // The branch switch reports what git says the node is on, rather than repeating the
  // branch it was asked for. The two are not the same thing when the checkout only
  // half worked, which is the case the old npm route could not tell apart.
  describe('switching branch says where the node actually ended up', () => {
    let runCmdStub;

    beforeEach(() => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('names the branch and commit read back from git', async () => {
      runCmdStub.resolves({ error: null, stdout: 'ok\n' });
      runCmdStub.withArgs('git', sinon.match({ params: ['rev-parse', '--abbrev-ref', 'HEAD'] }))
        .resolves({ error: null, stdout: 'master\n' });
      runCmdStub.withArgs('git', sinon.match({ params: ['rev-parse', '--short', 'HEAD'] }))
        .resolves({ error: null, stdout: 'abc1234\n' });
      const res = generateResponse();

      await fluxService.enterMasterApi({}, res);

      expect(res.json.firstCall.args[0].status).to.equal('success');
      expect(res.json.firstCall.args[0].data.message).to.contain('master at abc1234');
    });

    // A detached HEAD, or a node not deployed from a checkout at all, leaves nothing to
    // name. The switch still happened, so it must still be reported as success - failing
    // to describe an operation is not the same as the operation failing.
    it('still reports success when git cannot name the checkout', async () => {
      runCmdStub.resolves({ error: null, stdout: 'ok\n' });
      runCmdStub.withArgs('git', sinon.match({ params: ['rev-parse', '--abbrev-ref', 'HEAD'] }))
        .resolves({ error: new Error('not a git repository'), stdout: '' });
      const res = generateResponse();

      await fluxService.enterMasterApi({}, res);

      expect(res.json.firstCall.args[0].status).to.equal('success');
      expect(res.json.firstCall.args[0].data.message).to.equal('Master branch successfully entered');
    });

    it('reports the branch it could not find, not just that it failed', async () => {
      runCmdStub.resolves({ error: null, stdout: 'ok\n' });
      runCmdStub.withArgs('git', sinon.match({ params: ['rev-parse', '--verify', 'master'] }))
        .resolves({ error: new Error('unknown revision'), stdout: '' });
      const res = generateResponse();

      await fluxService.enterMasterApi({}, res);

      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.contain('Branch master not found on this node');
    });

    it('does not check out a branch it could not verify', async () => {
      runCmdStub.resolves({ error: null, stdout: 'ok\n' });
      runCmdStub.withArgs('git', sinon.match({ params: ['rev-parse', '--verify', 'master'] }))
        .resolves({ error: new Error('unknown revision'), stdout: '' });

      await fluxService.enterMasterApi({}, generateResponse());

      sinon.assert.neverCalledWithMatch(runCmdStub, 'git', { params: ['checkout', 'master'] });
    });
  });
});
