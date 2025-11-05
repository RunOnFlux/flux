// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const dbHelper = require('../../ZelBack/src/services/dbHelper');

describe('advancedWorkflows tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('getPreviousAppSpecifications tests', () => {
    it('should throw error if no previous message found', async () => {
      const specifications = { name: 'NewApp' };
      const verificationTimestamp = Date.now();

      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);

      try {
        await advancedWorkflows.getPreviousAppSpecifications(specifications, verificationTimestamp);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('does not exists');
      }
    });
  });

  describe('setInstallationInProgress and getInstallationInProgress tests', () => {
    it('should set installation in progress', () => {
      advancedWorkflows.setInstallationInProgressTrue();

      const inProgress = advancedWorkflows.getInstallationInProgress();
      expect(inProgress).to.be.true;
    });

    it('should reset installation in progress', () => {
      advancedWorkflows.setInstallationInProgressTrue();
      advancedWorkflows.installationInProgressReset();

      const inProgress = advancedWorkflows.getInstallationInProgress();
      expect(inProgress).to.be.false;
    });

    it('should set specific app installation in progress', () => {
      advancedWorkflows.setInstallationInProgress('TestApp', true);

      const inProgress = advancedWorkflows.getInstallationInProgress();
      // When setting specific app, function returns the app name, not just true
      expect(inProgress).to.equal('TestApp');
    });
  });

  describe('setRemovalInProgress and getRemovalInProgress tests', () => {
    it('should set removal in progress', () => {
      advancedWorkflows.setRemovalInProgressToTrue();

      const inProgress = advancedWorkflows.getRemovalInProgress();
      expect(inProgress).to.be.true;
    });

    it('should reset removal in progress', () => {
      advancedWorkflows.setRemovalInProgressToTrue();
      advancedWorkflows.removalInProgressReset();

      const inProgress = advancedWorkflows.getRemovalInProgress();
      expect(inProgress).to.be.false;
    });

    it('should set specific app removal in progress', () => {
      advancedWorkflows.setRemovalInProgress('TestApp', true);

      const inProgress = advancedWorkflows.getRemovalInProgress();
      // When setting specific app, function returns the app name, not just true
      expect(inProgress).to.equal('TestApp');
    });
  });

  describe('addToRestoreProgress and removeFromRestoreProgress tests', () => {
    beforeEach(() => {
      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.restoreInProgress = [];
    });

    it('should add app to restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');

      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      expect(globalState.restoreInProgress).to.include('TestApp');
    });

    it('should remove app from restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');
      advancedWorkflows.removeFromRestoreProgress('TestApp');

      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      expect(globalState.restoreInProgress).to.not.include('TestApp');
    });

    it('should not duplicate apps in restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');
      advancedWorkflows.addToRestoreProgress('TestApp');

      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      const count = globalState.restoreInProgress.filter((app) => app === 'TestApp').length;
      expect(count).to.equal(1);
    });
  });

  describe('redeployComponentAPI tests', () => {
    let req;
    let res;
    let globalState;
    let verificationHelper;

    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgress = false;
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;
      globalState.restoreInProgress = [];

      // eslint-disable-next-line global-require
      verificationHelper = require('../../ZelBack/src/services/verificationHelper');

      req = {
        params: {},
        query: {},
        headers: {},
      };
      res = {
        json: sinon.stub(),
        write: sinon.stub(),
        flush: sinon.stub(),
        setHeader: sinon.stub(),
      };
    });

    it('should return error if appname is not provided', async () => {
      req.params.component = 'frontend';

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('No Flux App specified');
    });

    it('should return error if component is not provided', async () => {
      req.params.appname = 'myapp';

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('No component specified');
    });

    it('should return error if appname contains underscore', async () => {
      req.params.appname = 'frontend_myapp';
      req.params.component = 'frontend';

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('Invalid app name format');
    });

    it('should skip redeploy if app is in restore progress', async () => {
      req.params.appname = 'myapp';
      req.params.component = 'frontend';

      // Use the proper method to add to restore progress
      advancedWorkflows.addToRestoreProgress('myapp');

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('warning');
      expect(response.data.message).to.include('Restore is running');

      // Clean up
      advancedWorkflows.removeFromRestoreProgress('myapp');
    });

    it('should return unauthorized error if not authorized', async () => {
      req.params.appname = 'myapp';
      req.params.component = 'frontend';

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);

      await advancedWorkflows.redeployComponentAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelper.verifyPrivilege.calledWith('appownerabove', req, 'myapp')).to.be.true;
    });

    it('should handle force parameter from query string', async () => {
      req.params.appname = 'myapp';
      req.params.component = 'frontend';
      req.query.force = 'true';

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      await advancedWorkflows.redeployComponentAPI(req, res);

      // Should attempt to call hardRedeployComponent but will fail because app not found
      expect(res.json.calledOnce).to.be.true;
    });
  });

  describe('softRedeployComponent tests', () => {
    let globalState;
    let res;

    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgress = false;
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;

      res = {
        write: sinon.stub(),
        flush: sinon.stub(),
      };
    });

    it('should return early if removal is in progress', async () => {
      globalState.removalInProgress = true;

      await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing removal');
    });

    it('should return early if installation is in progress', async () => {
      globalState.installationInProgress = true;

      await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing installation');
    });

    it('should return early if soft redeploy is in progress', async () => {
      globalState.softRedeployInProgress = true;

      await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing soft redeploy');
    });

    it('should return early if hard redeploy is in progress', async () => {
      globalState.hardRedeployInProgress = true;

      await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing hard redeploy');
    });

    it('should throw error if application not found', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      try {
        await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Application myapp not found');
        expect(globalState.softRedeployInProgress).to.be.false;
      }
    });

    it('should throw error if app is not composed', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        name: 'myapp',
        version: 3,
        // No compose field
      });

      try {
        await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('is not a composed application');
        expect(globalState.softRedeployInProgress).to.be.false;
      }
    });

    it('should throw error if component not found in app', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        name: 'myapp',
        version: 4,
        compose: [
          { name: 'backend', repotag: 'myapp/backend:1.0' },
        ],
      });

      try {
        await advancedWorkflows.softRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Component frontend not found');
        expect(globalState.softRedeployInProgress).to.be.false;
      }
    });
  });

  describe('hardRedeployComponent tests', () => {
    let globalState;
    let res;

    beforeEach(() => {
      // eslint-disable-next-line global-require
      globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.removalInProgress = false;
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;

      res = {
        write: sinon.stub(),
        flush: sinon.stub(),
      };
    });

    it('should return early if removal is in progress', async () => {
      globalState.removalInProgress = true;

      await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing removal');
    });

    it('should return early if installation is in progress', async () => {
      globalState.installationInProgress = true;

      await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing installation');
    });

    it('should return early if soft redeploy is in progress', async () => {
      globalState.softRedeployInProgress = true;

      await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing soft redeploy');
    });

    it('should return early if hard redeploy is in progress', async () => {
      globalState.hardRedeployInProgress = true;

      await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);

      expect(res.write.calledOnce).to.be.true;
      const response = res.write.firstCall.args[0];
      expect(response).to.include('Another application is undergoing hard redeploy');
    });

    it('should throw error if application not found', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      try {
        await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Application myapp not found');
        expect(globalState.hardRedeployInProgress).to.be.false;
      }
    });

    it('should throw error if app is not composed', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        name: 'myapp',
        version: 3,
        // No compose field
      });

      try {
        await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('is not a composed application');
        expect(globalState.hardRedeployInProgress).to.be.false;
      }
    });

    it('should throw error if component not found in app', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        name: 'myapp',
        version: 4,
        compose: [
          { name: 'backend', repotag: 'myapp/backend:1.0' },
        ],
      });

      try {
        await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Component frontend not found');
        expect(globalState.hardRedeployInProgress).to.be.false;
      }
    });

    it('should set hardRedeployInProgress to false on error', async () => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);

      try {
        await advancedWorkflows.hardRedeployComponent('myapp', 'frontend', res);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(globalState.hardRedeployInProgress).to.be.false;
      }
    });
  });

  describe('ensureMountPathsExist tests', () => {
    let dockerServiceStub;
    let fsStub;
    let nodecmdStub;
    let mountParserStub;
    let logStub;
    let utilStub;
    let appConstantsStub;
    let proxyquire;

    beforeEach(() => {
      // eslint-disable-next-line global-require
      proxyquire = require('proxyquire').noCallThru();

      // Create stubs
      dockerServiceStub = {
        getAppIdentifier: sinon.stub(),
      };

      fsStub = {
        access: sinon.stub(),
        promises: {
          access: sinon.stub(),
        },
      };

      // Mock node-cmd module
      nodecmdStub = {
        run: sinon.stub().callsFake((cmd, callback) => {
          // Call callback immediately to simulate async completion
          if (callback) callback(null, '', '');
        }),
      };

      // Mock util.promisify to return our stub
      utilStub = {
        promisify: sinon.stub().callsFake((fn) => {
          if (fn === nodecmdStub.run) {
            return sinon.stub().resolves('');
          }
          // eslint-disable-next-line global-require
          return require('util').promisify(fn);
        }),
      };

      mountParserStub = {
        parseContainerData: sinon.stub(),
        getRequiredLocalPaths: sinon.stub(),
        MountType: {
          PRIMARY: 'primary',
          DIRECTORY: 'directory',
          FILE: 'file',
          COMPONENT_PRIMARY: 'component_primary',
          COMPONENT_DIRECTORY: 'component_directory',
          COMPONENT_FILE: 'component_file',
        },
      };

      logStub = {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
      };

      appConstantsStub = {
        appsFolder: '/test/apps/folder/',
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should skip creating paths that already exist', async () => {
      // Setup
      const appSpecifications = {
        name: 'webserver',
        containerData: '/data|f:config.yaml:/etc/config.yaml',
      };
      const appName = 'testapp';
      const isComponent = true;

      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');

      mountParserStub.parseContainerData.returns({
        primary: {
          type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
        },
        additional: [
          {
            type: 'file', subdir: 'config.yaml', containerPath: '/etc/config.yaml', flags: [], isFile: true,
          },
        ],
        allMounts: [
          {
            type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
          },
          {
            type: 'file', subdir: 'config.yaml', containerPath: '/etc/config.yaml', flags: [], isFile: true,
          },
        ],
      });

      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'config.yaml', isFile: true },
      ]);

      // All paths exist - fs.access succeeds
      fsStub.promises.access.resolves();

      const advancedWorkflowsProxied = proxyquire('../../ZelBack/src/services/appLifecycle/advancedWorkflows', {
        '../dockerService': dockerServiceStub,
        '../utils/mountParser': mountParserStub,
        '../utils/appConstants': appConstantsStub,
        'node-cmd': nodecmdStub,
        util: utilStub,
        '../../lib/log': logStub,
        fs: fsStub,
      });

      // Execute
      await advancedWorkflowsProxied.ensureMountPathsExist(appSpecifications, appName, isComponent, null);

      // Verify
      expect(mountParserStub.parseContainerData.calledOnce).to.be.true;
      expect(mountParserStub.getRequiredLocalPaths.calledOnce).to.be.true;
      expect(fsStub.promises.access.callCount).to.equal(2); // Called for both paths
      expect(nodecmdStub.run.called).to.be.false; // No creation needed
    });

    it('should create missing file with proper ownership', async () => {
      // Setup
      const appSpecifications = {
        name: 'webserver',
        containerData: '/data|f:config.yaml:/etc/config.yaml',
      };
      const appName = 'testapp';
      const isComponent = true;

      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');

      mountParserStub.parseContainerData.returns({
        primary: {
          type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
        },
        additional: [
          {
            type: 'file', subdir: 'config.yaml', containerPath: '/etc/config.yaml', flags: [], isFile: true,
          },
        ],
        allMounts: [
          {
            type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
          },
          {
            type: 'file', subdir: 'config.yaml', containerPath: '/etc/config.yaml', flags: [], isFile: true,
          },
        ],
      });

      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'config.yaml', isFile: true },
      ]);

      // appdata exists, config.yaml doesn't
      fsStub.promises.access.onFirstCall().resolves(); // appdata exists
      fsStub.promises.access.onSecondCall().rejects(new Error('ENOENT')); // config.yaml doesn't exist

      const cmdAsyncStub = sinon.stub().resolves('');

      const advancedWorkflowsProxied = proxyquire('../../ZelBack/src/services/appLifecycle/advancedWorkflows', {
        '../dockerService': dockerServiceStub,
        '../utils/mountParser': mountParserStub,
        '../utils/appConstants': appConstantsStub,
        'node-cmd': nodecmdStub,
        util: {
          ...utilStub,
          promisify: sinon.stub().callsFake((fn) => {
            if (fn === nodecmdStub.run) {
              return cmdAsyncStub;
            }
            // eslint-disable-next-line global-require
            return require('util').promisify(fn);
          }),
        },
        '../../lib/log': logStub,
        fs: fsStub,
      });

      // Execute
      await advancedWorkflowsProxied.ensureMountPathsExist(appSpecifications, appName, isComponent, null);

      // Verify
      expect(cmdAsyncStub.callCount).to.equal(2); // mkdir parent dir + touch file
      // Should call mkdir to ensure parent directory exists
      expect(cmdAsyncStub.firstCall.args[0]).to.include('mkdir -p');
      // Should call touch to create file
      expect(cmdAsyncStub.secondCall.args[0]).to.include('touch');
      expect(cmdAsyncStub.secondCall.args[0]).to.include('config.yaml');
    });

    it('should create missing directory', async () => {
      // Setup
      const appSpecifications = {
        name: 'webserver',
        containerData: '/data|m:logs:/var/log',
      };
      const appName = 'testapp';
      const isComponent = true;

      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');

      mountParserStub.parseContainerData.returns({
        primary: {
          type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
        },
        additional: [
          {
            type: 'directory', subdir: 'logs', containerPath: '/var/log', flags: [], isFile: false,
          },
        ],
        allMounts: [
          {
            type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
          },
          {
            type: 'directory', subdir: 'logs', containerPath: '/var/log', flags: [], isFile: false,
          },
        ],
      });

      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'logs', isFile: false },
      ]);

      // appdata exists, logs doesn't
      fsStub.promises.access.onFirstCall().resolves(); // appdata exists
      fsStub.promises.access.onSecondCall().rejects(new Error('ENOENT')); // logs doesn't exist

      const cmdAsyncStub = sinon.stub().resolves('');

      const advancedWorkflowsProxied = proxyquire('../../ZelBack/src/services/appLifecycle/advancedWorkflows', {
        '../dockerService': dockerServiceStub,
        '../utils/mountParser': mountParserStub,
        'node-cmd': nodecmdStub,
        util: {
          ...utilStub,
          promisify: sinon.stub().callsFake((fn) => {
            if (fn === nodecmdStub.run) {
              return cmdAsyncStub;
            }
            // eslint-disable-next-line global-require
            return require('util').promisify(fn);
          }),
        },
        '../../lib/log': logStub,
        fs: fsStub,
      });

      // Execute
      await advancedWorkflowsProxied.ensureMountPathsExist(appSpecifications, appName, isComponent, null);

      // Verify
      expect(cmdAsyncStub.calledOnce).to.be.true;
      expect(cmdAsyncStub.firstCall.args[0]).to.include('mkdir -p');
      expect(cmdAsyncStub.firstCall.args[0]).to.include('logs');
    });

    it('should create multiple missing files and directories', async () => {
      // Setup
      const appSpecifications = {
        name: 'webserver',
        containerData: '/data|m:logs:/var/log|f:config.yaml:/etc/config.yaml|m:cache:/var/cache',
      };
      const appName = 'testapp';
      const isComponent = true;

      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');

      mountParserStub.parseContainerData.returns({
        primary: {
          type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
        },
        additional: [
          {
            type: 'directory', subdir: 'logs', containerPath: '/var/log', flags: [], isFile: false,
          },
          {
            type: 'file', subdir: 'config.yaml', containerPath: '/etc/config.yaml', flags: [], isFile: true,
          },
          {
            type: 'directory', subdir: 'cache', containerPath: '/var/cache', flags: [], isFile: false,
          },
        ],
        allMounts: [
          {
            type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
          },
          {
            type: 'directory', subdir: 'logs', containerPath: '/var/log', flags: [], isFile: false,
          },
          {
            type: 'file', subdir: 'config.yaml', containerPath: '/etc/config.yaml', flags: [], isFile: true,
          },
          {
            type: 'directory', subdir: 'cache', containerPath: '/var/cache', flags: [], isFile: false,
          },
        ],
      });

      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'logs', isFile: false },
        { name: 'config.yaml', isFile: true },
        { name: 'cache', isFile: false },
      ]);

      // appdata exists, all others don't
      fsStub.promises.access.onCall(0).resolves(); // appdata exists
      fsStub.promises.access.onCall(1).rejects(new Error('ENOENT')); // logs
      fsStub.promises.access.onCall(2).rejects(new Error('ENOENT')); // config.yaml
      fsStub.promises.access.onCall(3).rejects(new Error('ENOENT')); // cache

      const cmdAsyncStub = sinon.stub().resolves('');

      const advancedWorkflowsProxied = proxyquire('../../ZelBack/src/services/appLifecycle/advancedWorkflows', {
        '../dockerService': dockerServiceStub,
        '../utils/mountParser': mountParserStub,
        '../utils/appConstants': appConstantsStub,
        'node-cmd': nodecmdStub,
        util: {
          ...utilStub,
          promisify: sinon.stub().callsFake((fn) => {
            if (fn === nodecmdStub.run) {
              return cmdAsyncStub;
            }
            // eslint-disable-next-line global-require
            return require('util').promisify(fn);
          }),
        },
        '../../lib/log': logStub,
        fs: fsStub,
      });

      // Execute
      await advancedWorkflowsProxied.ensureMountPathsExist(appSpecifications, appName, isComponent, null);

      // Verify
      // Should create: logs dir, parent dir for file, config.yaml file (touch), cache dir = 4 commands
      expect(cmdAsyncStub.callCount).to.equal(4);

      // Check that mkdir was called for directories (logs, cache, and parent dir for config.yaml)
      const mkdirCalls = cmdAsyncStub.getCalls().filter((call) => call.args[0].includes('mkdir'));
      expect(mkdirCalls.length).to.equal(3); // logs, parent dir, and cache

      // Check that touch was called for file
      const touchCalls = cmdAsyncStub.getCalls().filter((call) => call.args[0].includes('touch'));
      expect(touchCalls.length).to.equal(1);
    });

    it('should handle non-component apps correctly', async () => {
      // Setup
      const appSpecifications = {
        containerData: '/data|f:config.yaml:/etc/config.yaml',
      };
      const appName = 'testapp';
      const isComponent = false;

      dockerServiceStub.getAppIdentifier.returns('fluxtestapp');

      mountParserStub.parseContainerData.returns({
        primary: {
          type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
        },
        additional: [
          {
            type: 'file', subdir: 'config.yaml', containerPath: '/etc/config.yaml', flags: [], isFile: true,
          },
        ],
        allMounts: [
          {
            type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
          },
          {
            type: 'file', subdir: 'config.yaml', containerPath: '/etc/config.yaml', flags: [], isFile: true,
          },
        ],
      });

      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'config.yaml', isFile: true },
      ]);

      fsStub.promises.access.resolves();

      const advancedWorkflowsProxied = proxyquire('../../ZelBack/src/services/appLifecycle/advancedWorkflows', {
        '../dockerService': dockerServiceStub,
        '../utils/mountParser': mountParserStub,
        '../utils/appConstants': appConstantsStub,
        'node-cmd': nodecmdStub,
        util: utilStub,
        '../../lib/log': logStub,
        fs: fsStub,
      });

      // Execute
      await advancedWorkflowsProxied.ensureMountPathsExist(appSpecifications, appName, isComponent, null);

      // Verify identifier is constructed correctly for non-component app
      expect(dockerServiceStub.getAppIdentifier.calledWith('testapp')).to.be.true;
    });

    it('should throw error when containerData parsing fails', async () => {
      // Setup
      const appSpecifications = {
        name: 'webserver',
        containerData: 'invalid:syntax:extra',
      };
      const appName = 'testapp';
      const isComponent = true;

      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.throws(new Error('Invalid containerData syntax'));

      const advancedWorkflowsProxied = proxyquire('../../ZelBack/src/services/appLifecycle/advancedWorkflows', {
        '../dockerService': dockerServiceStub,
        '../utils/mountParser': mountParserStub,
        '../utils/appConstants': appConstantsStub,
        'node-cmd': nodecmdStub,
        util: utilStub,
        '../../lib/log': logStub,
        fs: fsStub,
      });

      // Execute and verify
      try {
        await advancedWorkflowsProxied.ensureMountPathsExist(appSpecifications, appName, isComponent, null);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Invalid containerData syntax');
      }
    });

    it('should handle component references correctly (not create them)', async () => {
      // Setup - component references should NOT be created, only local paths
      const appSpecifications = {
        name: 'backup',
        containerData: '/data|0:/database',
      };
      const appName = 'testapp';
      const isComponent = true;

      // Provide fullAppSpecs so component references can be validated
      const fullAppSpecs = {
        version: 4,
        compose: [
          { name: 'db', containerData: 'r:/var/lib/db' },
          { name: 'backup', containerData: '/data|0:/database' },
        ],
      };

      dockerServiceStub.getAppIdentifier.returns('fluxbackup_testapp');

      mountParserStub.parseContainerData.returns({
        primary: {
          type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
        },
        additional: [
          {
            type: 'component_primary', componentIndex: 0, subdir: 'appdata', containerPath: '/database', flags: [], isFile: false,
          },
        ],
        allMounts: [
          {
            type: 'primary', subdir: 'appdata', containerPath: '/data', flags: [], isFile: false,
          },
          {
            type: 'component_primary', componentIndex: 0, subdir: 'appdata', containerPath: '/database', flags: [], isFile: false,
          },
        ],
      });

      // getRequiredLocalPaths should filter out component references
      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        // Note: component references NOT included here
      ]);

      fsStub.promises.access.resolves();

      const advancedWorkflowsProxied = proxyquire('../../ZelBack/src/services/appLifecycle/advancedWorkflows', {
        '../dockerService': dockerServiceStub,
        '../utils/mountParser': mountParserStub,
        '../utils/appConstants': appConstantsStub,
        'node-cmd': nodecmdStub,
        util: utilStub,
        '../../lib/log': logStub,
        fs: fsStub,
      });

      // Execute
      await advancedWorkflowsProxied.ensureMountPathsExist(appSpecifications, appName, isComponent, fullAppSpecs);

      // Verify - should check appdata for this component and also the component reference path
      // The component reference (component 0) path should also be checked to ensure it exists
      expect(fsStub.promises.access.callCount).to.be.at.least(1);
      expect(nodecmdStub.run.called).to.be.false;
    });
  });

  // Note: verifyAppUpdateParameters, validateApplicationUpdateCompatibility,
  // createAppVolume, getPeerAppsInstallingErrorMessages, and stopSyncthingApp are
  // complex integration functions or HTTP request handlers that require extensive
  // mocking of database connections, HTTP requests, and external services.
  // These should be tested in integration tests rather than unit tests.
});
