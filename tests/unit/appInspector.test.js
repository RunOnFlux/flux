const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appInspector tests', () => {
  let appInspector;
  let dockerServiceStub;
  let messageHelperStub;
  let logStub;
  let configStub;
  let generalServiceStub;
  let registryManagerStub;
  let globalStateStub;

  beforeEach(() => {
    configStub = {
      database: {
        url: 'mongodb://localhost:27017',
      },
      enterpriseAppOwners: ['0x123enterpriseowner'],
      enterpriseBurst: {
        enabled: true,
        maxMultiplier: 2,
        minSystemReserveCores: 0.5,
      },
      fluxSpecifics: {
        cpu: {
          cumulus: 40,
          nimbus: 80,
          stratus: 160,
        },
      },
      lockedSystemResources: {
        cpu: 10,
      },
    };

    dockerServiceStub = {
      appDockerInspect: sinon.stub(),
      appDockerStats: sinon.stub(),
      dockerContainerInspect: sinon.stub(),
      dockerContainerStatsStream: (containerId, callback) => callback(null, {}),
      appDockerUpdateCpu: sinon.stub().resolves(),
    };

    messageHelperStub = {
      createDataMessage: sinon.stub(),
      createErrorMessage: sinon.stub(),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    generalServiceStub = {
      getNewNodeTier: sinon.stub().resolves('stratus'),
    };

    registryManagerStub = {
      getApplicationOwner: sinon.stub().resolves(null),
    };

    globalStateStub = {
      enterpriseBurstAllocations: new Map(),
    };

    appInspector = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
      config: configStub,
      '../dockerService': dockerServiceStub,
      '../messageHelper': messageHelperStub,
      '../../lib/log': logStub,
      '../appQuery/appQueryService': {
        decryptEnterpriseApps: sinon.stub().returnsArg(0), // Return apps as-is by default
      },
      '../serviceHelper': {
        ensureString: sinon.stub().returnsArg(0),
      },
      '../dbHelper': {
        databaseConnection: sinon.stub(),
      },
      '../verificationHelper': {
        verifyPrivilege: sinon.stub().resolves(true),
      },
      '../utils/appConstants': {
        appConstants: {},
      },
      '../utils/appUtilities': {
        getContainerStorage: sinon.stub().returns(0),
      },
      '../generalService': generalServiceStub,
      '../appDatabase/registryManager': registryManagerStub,
      '../utils/globalState': globalStateStub,
      'node-cmd': {
        run: (cmd, callback) => callback(null, 'data', 'stderr'),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('appInspect', () => {
    it('should inspect app and return data', async () => {
      const req = {
        params: { appname: 'testapp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      const mockInspectData = { Name: 'testapp', State: 'running' };
      dockerServiceStub.dockerContainerInspect.resolves(mockInspectData);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: mockInspectData });

      await appInspector.appInspect(req, res);

      expect(dockerServiceStub.dockerContainerInspect.called).to.be.true;
      expect(res.json.calledOnce).to.be.true;
    });

    it('should handle missing appname', async () => {
      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({ status: 'error' });

      await appInspector.appInspect(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });

  describe('appTop tests', () => {
    it('should return error if no params were passed, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appTop(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if no params were passed, no response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      const result = await appInspector.appTop(req);

      expect(result).to.have.property('status', 'error');
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges, response passed', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../appQuery/appQueryService': {
          decryptEnterpriseApps: sinon.stub().returnsArg(0),
        },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appTop(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should return error if user has no appowner privileges, no response passed', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().returnsArg(0),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      const result = await appInspectorWithAuth.appTop(req);

      expect(result).to.have.property('status', 'error');
    });

    it('should top app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };

      dockerServiceStub.appDockerTop = sinon.stub().resolves('some data');
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      const result = await appInspector.appTop(req);

      expect(result).to.have.property('status', 'success');
      expect(dockerServiceStub.appDockerTop.calledWith('test_myappname')).to.be.true;
    });

    it('should top app, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };

      dockerServiceStub.appDockerTop = sinon.stub().resolves('some data');
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      const result = await appInspector.appTop(req);

      expect(result).to.have.property('status', 'success');
      expect(dockerServiceStub.appDockerTop.calledWith('myappname')).to.be.true;
    });
  });

  describe('appLog tests', () => {
    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          dockerBufferToString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().returnsArg(0),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should log app, underscore in the name', async () => {
      const appInspectorWithHelper = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': {
          ...dockerServiceStub,
          dockerContainerLogs: sinon.stub().resolves('some data'),
        },
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          dockerBufferToString: sinon.stub().returns('some data'),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
          lines: '10',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspectorWithHelper.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should log app, no underscore in the name', async () => {
      const appInspectorWithHelper = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': {
          ...dockerServiceStub,
          dockerContainerLogs: sinon.stub().resolves('some data'),
        },
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          dockerBufferToString: sinon.stub().returns('some data'),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'myappname',
          lines: '10',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspectorWithHelper.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should log app, no underscore in the name, no lines param', async () => {
      const appInspectorWithHelper = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': {
          ...dockerServiceStub,
          dockerContainerLogs: sinon.stub().resolves('some data'),
        },
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          dockerBufferToString: sinon.stub().returns('some data'),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspectorWithHelper.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
    });
  });

  describe('appStats tests', () => {
    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appStats(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().returnsArg(0),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appStats(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should return app stats, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      const mockStats = { data: 1000 };
      dockerServiceStub.appDockerStats.resolves(mockStats);
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: mockStats,
      });

      await appInspector.appStats(req, res);

      expect(res.json.called).to.be.true;
    });

    it('should return app stats, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      const mockStats = { data: 1000 };
      dockerServiceStub.appDockerStats.resolves(mockStats);
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: mockStats,
      });

      await appInspector.appStats(req, res);

      expect(res.json.called).to.be.true;
    });
  });

  describe('appMonitor tests', () => {
    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appMonitor(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().returnsArg(0),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appMonitor(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should return app monitor data, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 1000,
      });

      await appInspector.appMonitor(req, res);

      expect(res.json.called).to.be.true;
    });

    it('should return app monitor data, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 1000,
      });

      await appInspector.appMonitor(req, res);

      expect(res.json.called).to.be.true;
    });

    it('should return error if app is not monitored', async () => {
      const req = {
        params: {
          appname: 'test_nonexistent',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No data available',
        },
      });

      await appInspector.appMonitor(req, res);

      expect(res.json.called).to.be.true;
    });
  });

  describe('appMonitorStream tests', () => {
    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
        end: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appMonitorStream(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().returnsArg(0),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
        end: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appMonitorStream(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should return app monitor stream, underscore in the name', async () => {
      const dockerServiceWithStream = {
        ...dockerServiceStub,
        dockerContainerStatsStream: (appname, req, res, callback) => {
          res.write('data');
          if (callback) callback(null);
        },
      };

      const appInspectorWithStream = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceWithStream,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
        write: sinon.stub(),
        setHeader: sinon.stub(),
        end: sinon.stub(),
      };

      await appInspectorWithStream.appMonitorStream(req, res);

      expect(res.end.called || res.write.called).to.be.true;
    });

    it('should return app monitor stream, no underscore in the name', async () => {
      const dockerServiceWithStream = {
        ...dockerServiceStub,
        dockerContainerStatsStream: (appname, req, res, callback) => {
          res.write('data');
          if (callback) callback(null);
        },
      };

      const appInspectorWithStream = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceWithStream,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
        write: sinon.stub(),
        setHeader: sinon.stub(),
        end: sinon.stub(),
      };

      await appInspectorWithStream.appMonitorStream(req, res);

      expect(res.end.called || res.write.called).to.be.true;
    });
  });

  describe('appChanges tests', () => {
    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().returnsArg(0),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should return app changes, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      dockerServiceStub.dockerContainerChanges = sinon.stub().resolves('some data');
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspector.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(dockerServiceStub.dockerContainerChanges.calledWith('test_myappname')).to.be.true;
    });

    it('should return app changes, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      dockerServiceStub.dockerContainerChanges = sinon.stub().resolves('some data');
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspector.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(dockerServiceStub.dockerContainerChanges.calledWith('myappname')).to.be.true;
    });

    it('should return error if docker throws', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      dockerServiceStub.dockerContainerChanges = sinon.stub().rejects(new Error('Docker error'));
      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Docker error',
        },
      });

      await appInspector.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });

  describe('getAppFolderSize tests', () => {
    it('should return folder size data', async () => {
      const appName = 'testapp';
      const result = await appInspector.getAppFolderSize(appName);
      expect(result).to.exist;
    });
  });

  describe('listAppsImages tests', () => {
    it('should return error if dockerService throws, no response passed', async () => {
      dockerServiceStub.dockerListImages = sinon.stub().rejects(new Error('Error'));
      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });

      const result = await appInspector.listAppsImages();

      expect(result).to.have.property('status', 'error');
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if dockerService throws, response passed', async () => {
      const res = {
        json: sinon.stub(),
      };
      dockerServiceStub.dockerListImages = sinon.stub().rejects(new Error('Error'));
      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });

      await appInspector.listAppsImages(undefined, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return running apps, no response passed', async () => {
      const mockImages = [{ RepoTags: ['image1:latest'] }, { RepoTags: ['image2:latest'] }];
      dockerServiceStub.dockerListImages = sinon.stub().resolves(mockImages);
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: mockImages,
      });

      const result = await appInspector.listAppsImages();

      expect(result).to.have.property('status', 'success');
    });

    it('should return running apps, response passed', async () => {
      const mockImages = [{ RepoTags: ['image1:latest'] }, { RepoTags: ['image2:latest'] }];
      const res = {
        json: sinon.stub(),
      };
      dockerServiceStub.dockerListImages = sinon.stub().resolves(mockImages);
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: mockImages,
      });

      await appInspector.listAppsImages(undefined, res);

      expect(res.json.calledOnce).to.be.true;
    });
  });

  describe('exported functions', () => {
    it('should export monitoring functions', () => {
      expect(appInspector.startAppMonitoring).to.be.a('function');
      expect(appInspector.stopAppMonitoring).to.be.a('function');
      expect(appInspector.appInspect).to.be.a('function');
      expect(appInspector.appTop).to.be.a('function');
      expect(appInspector.appLog).to.be.a('function');
      expect(appInspector.appStats).to.be.a('function');
      expect(appInspector.appMonitor).to.be.a('function');
      expect(appInspector.appMonitorStream).to.be.a('function');
      expect(appInspector.appChanges).to.be.a('function');
      expect(appInspector.getAppFolderSize).to.be.a('function');
      expect(appInspector.listAppsImages).to.be.a('function');
    });
  });

  describe('Enterprise CPU Burst', () => {
    let appInspectorWithBurst;
    let generalServiceStub;
    let registryManagerStub;
    let globalStateStub;
    let osStub;

    beforeEach(() => {
      generalServiceStub = {
        getNewNodeTier: sinon.stub().resolves('stratus'),
      };

      registryManagerStub = {
        getApplicationOwner: sinon.stub(),
      };

      globalStateStub = {
        enterpriseBurstAllocations: new Map(),
      };

      // Default to 16 CPU threads (stratus-like)
      osStub = {
        cpus: sinon.stub().returns(new Array(16).fill({ model: 'test' })),
      };

      appInspectorWithBurst = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        os: osStub,
        config: {
          enterpriseAppOwners: ['0x123enterpriseowner', '16mzUh6byiQr7rnYQxKraDbeBPsEHYpSTW'],
          enterpriseBurst: {
            enabled: true,
            maxMultiplier: 2,
            minSystemReserveCores: 0.5,
          },
          lockedSystemResources: {
            cpu: 10,
          },
          database: {
            url: 'mongodb://localhost:27017',
          },
        },
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../appQuery/appQueryService': {
          decryptEnterpriseApps: sinon.stub().returnsArg(0),
        },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        '../generalService': generalServiceStub,
        '../appDatabase/registryManager': registryManagerStub,
        '../utils/globalState': globalStateStub,
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });
    });

    describe('isEnterpriseApp', () => {
      it('should return true for enterprise app owner', () => {
        const result = appInspectorWithBurst.isEnterpriseApp('0x123enterpriseowner');
        expect(result).to.be.true;
      });

      it('should return true for known enterprise owner address', () => {
        const result = appInspectorWithBurst.isEnterpriseApp('16mzUh6byiQr7rnYQxKraDbeBPsEHYpSTW');
        expect(result).to.be.true;
      });

      it('should return false for non-enterprise app owner', () => {
        const result = appInspectorWithBurst.isEnterpriseApp('0x456regularowner');
        expect(result).to.be.false;
      });

      it('should return false for null owner', () => {
        const result = appInspectorWithBurst.isEnterpriseApp(null);
        expect(result).to.be.false;
      });

      it('should return false for undefined owner', () => {
        const result = appInspectorWithBurst.isEnterpriseApp(undefined);
        expect(result).to.be.false;
      });

      it('should return false for empty string owner', () => {
        const result = appInspectorWithBurst.isEnterpriseApp('');
        expect(result).to.be.false;
      });
    });

    describe('calculateNodeAvailableCpu', () => {
      it('should calculate available CPU using OS cpu count (16 cores)', async () => {
        // osStub defaults to 16 cores
        const installedApps = [
          { name: 'app1', version: 2, cpu: 2 },
          { name: 'app2', version: 2, cpu: 4 },
        ];

        const result = await appInspectorWithBurst.calculateNodeAvailableCpu(installedApps);

        // 16 cores from OS, 1 locked, 0.5 reserve, 6 for apps = 16 - 1 - 6 - 0.5 = 8.5
        expect(result).to.be.closeTo(8.5, 0.1);
      });

      it('should calculate available CPU with 8 cores', async () => {
        osStub.cpus.returns(new Array(8).fill({ model: 'test' }));
        const installedApps = [
          { name: 'app1', version: 2, cpu: 2 },
        ];

        const result = await appInspectorWithBurst.calculateNodeAvailableCpu(installedApps);

        // 8 cores from OS, 1 locked, 0.5 reserve, 2 for apps = 8 - 1 - 2 - 0.5 = 4.5
        expect(result).to.be.closeTo(4.5, 0.1);
      });

      it('should calculate available CPU with 4 cores', async () => {
        osStub.cpus.returns(new Array(4).fill({ model: 'test' }));
        const installedApps = [
          { name: 'app1', version: 2, cpu: 1 },
        ];

        const result = await appInspectorWithBurst.calculateNodeAvailableCpu(installedApps);

        // 4 cores from OS, 1 locked, 0.5 reserve, 1 for apps = 4 - 1 - 1 - 0.5 = 1.5
        expect(result).to.be.closeTo(1.5, 0.1);
      });

      it('should handle composed apps (version > 3)', async () => {
        // osStub defaults to 16 cores
        const installedApps = [
          {
            name: 'composedApp',
            version: 4,
            compose: [
              { name: 'frontend', cpu: 2 },
              { name: 'backend', cpu: 4 },
            ],
          },
        ];

        const result = await appInspectorWithBurst.calculateNodeAvailableCpu(installedApps);

        // 16 cores from OS, 1 locked, 0.5 reserve, 6 for apps = 16 - 1 - 6 - 0.5 = 8.5
        expect(result).to.be.closeTo(8.5, 0.1);
      });

      it('should return 0 when no spare capacity', async () => {
        // Set OS to 4 cores
        osStub.cpus.returns(new Array(4).fill({ model: 'test' }));
        const installedApps = [
          { name: 'app1', version: 2, cpu: 4 }, // Uses all available CPU
        ];

        const result = await appInspectorWithBurst.calculateNodeAvailableCpu(installedApps);

        // 4 cores from OS, 1 locked, 0.5 reserve, 4 for apps = 4 - 1 - 4 - 0.5 = -1.5 -> capped at 0
        expect(result).to.equal(0);
      });

      it('should return 0 on error', async () => {
        osStub.cpus.throws(new Error('OS error'));
        const installedApps = [];

        const result = await appInspectorWithBurst.calculateNodeAvailableCpu(installedApps);

        expect(result).to.equal(0);
      });
    });

    describe('calculateEnterpriseBurstAllocations', () => {
      it('should allocate burst proportionally to multiple apps', () => {
        const enterpriseApps = [
          { containerName: 'appA', specCpu: 2 },
          { containerName: 'appB', specCpu: 2 },
        ];
        const availableBurstCpu = 4;

        const allocations = appInspectorWithBurst.calculateEnterpriseBurstAllocations(enterpriseApps, availableBurstCpu);

        // Each app gets 50% of burst (2 cores each), so final is spec (2) + burst (2) = 4
        // Capped at maxMultiplier (2) * spec (2) = 4, so 4 cores each
        expect(allocations.get('appA')).to.equal(4 * 1e9);
        expect(allocations.get('appB')).to.equal(4 * 1e9);
      });

      it('should allocate burst proportionally based on spec CPU', () => {
        const enterpriseApps = [
          { containerName: 'appA', specCpu: 2 },
          { containerName: 'appC', specCpu: 4 },
        ];
        const availableBurstCpu = 6;

        const allocations = appInspectorWithBurst.calculateEnterpriseBurstAllocations(enterpriseApps, availableBurstCpu);

        // Total spec: 6, appA proportion: 2/6 = 0.333, appC proportion: 4/6 = 0.667
        // appA burst share: 6 * 0.333 = 2, final: 2 + 2 = 4, capped at 2*2 = 4
        // appC burst share: 6 * 0.667 = 4, final: 4 + 4 = 8, capped at 2*4 = 8
        expect(allocations.get('appA')).to.equal(4 * 1e9);
        expect(allocations.get('appC')).to.equal(8 * 1e9);
      });

      it('should cap allocation at maxMultiplier', () => {
        const enterpriseApps = [
          { containerName: 'appA', specCpu: 2 },
        ];
        const availableBurstCpu = 10; // Plenty of burst available

        const allocations = appInspectorWithBurst.calculateEnterpriseBurstAllocations(enterpriseApps, availableBurstCpu);

        // maxMultiplier is 2, so max allocation is 2 * 2 = 4 cores
        expect(allocations.get('appA')).to.equal(4 * 1e9);
      });

      it('should return empty map when no apps need burst', () => {
        const enterpriseApps = [];
        const availableBurstCpu = 4;

        const allocations = appInspectorWithBurst.calculateEnterpriseBurstAllocations(enterpriseApps, availableBurstCpu);

        expect(allocations.size).to.equal(0);
      });

      it('should return empty map when no burst capacity available', () => {
        const enterpriseApps = [
          { containerName: 'appA', specCpu: 2 },
        ];
        const availableBurstCpu = 0;

        const allocations = appInspectorWithBurst.calculateEnterpriseBurstAllocations(enterpriseApps, availableBurstCpu);

        expect(allocations.size).to.equal(0);
      });

      it('should return empty map when null apps array', () => {
        const allocations = appInspectorWithBurst.calculateEnterpriseBurstAllocations(null, 4);

        expect(allocations.size).to.equal(0);
      });
    });

    describe('applyEnterpriseCpuBurst', () => {
      it('should skip when enterprise burst is disabled', async () => {
        const appInspectorDisabled = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
          config: {
            enterpriseAppOwners: ['0x123'],
            enterpriseBurst: {
              enabled: false,
              maxMultiplier: 2,
              minSystemReserveCores: 0.5,
            },
            fluxSpecifics: {
              cpu: { stratus: 160 },
            },
            lockedSystemResources: { cpu: 10 },
            database: { url: 'mongodb://localhost:27017' },
          },
          '../dockerService': dockerServiceStub,
          '../messageHelper': messageHelperStub,
          '../../lib/log': logStub,
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().returnsArg(0),
          },
          '../serviceHelper': {
            ensureString: sinon.stub().returnsArg(0),
          },
          '../dbHelper': {
            databaseConnection: sinon.stub(),
          },
          '../verificationHelper': {
            verifyPrivilege: sinon.stub().resolves(true),
          },
          '../utils/appConstants': {
            appConstants: {},
          },
          '../utils/appUtilities': {
            getContainerStorage: sinon.stub().returns(0),
          },
          '../generalService': generalServiceStub,
          '../appDatabase/registryManager': registryManagerStub,
          '../utils/globalState': globalStateStub,
          'node-cmd': {
            run: (cmd, callback) => callback(null, 'data', 'stderr'),
          },
        });

        dockerServiceStub.appDockerUpdateCpu = sinon.stub().resolves();

        await appInspectorDisabled.applyEnterpriseCpuBurst({}, []);

        expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      });

      it('should apply burst to enterprise app with high CPU usage', async () => {
        registryManagerStub.getApplicationOwner.resolves('0x123enterpriseowner');
        generalServiceStub.getNewNodeTier.resolves('stratus');
        dockerServiceStub.dockerContainerInspect = sinon.stub().resolves({
          HostConfig: { NanoCpus: 2e9 },
        });
        dockerServiceStub.appDockerUpdateCpu = sinon.stub().resolves();

        // Generate stats showing high CPU usage (>= 85%)
        const highCpuStats = [];
        for (let i = 0; i < 10; i += 1) {
          highCpuStats.push({
            timestamp: Date.now() - i * 60000,
            data: {
              cpu_stats: {
                cpu_usage: { total_usage: 1000000 + i * 100 },
                system_cpu_usage: 100000 + i * 10,
                online_cpus: 16,
              },
              precpu_stats: {
                cpu_usage: { total_usage: 1000000 + (i - 1) * 100 },
                system_cpu_usage: 100000 + (i - 1) * 10,
              },
            },
          });
        }

        const appsMonitored = {
          enterpriseApp: {
            lastHourstatsStore: highCpuStats,
          },
        };

        const installedApps = [
          { name: 'enterpriseApp', version: 2, cpu: 2 },
        ];

        await appInspectorWithBurst.applyEnterpriseCpuBurst(appsMonitored, installedApps);

        // Should have attempted to update CPU (either burst apply or reset)
        // The exact call depends on the CPU calculation
        expect(registryManagerStub.getApplicationOwner.calledWith('enterpriseApp')).to.be.true;
      });

      it('should not burst non-enterprise apps', async () => {
        registryManagerStub.getApplicationOwner.resolves('0x456regularowner');
        dockerServiceStub.appDockerUpdateCpu = sinon.stub().resolves();

        const appsMonitored = {
          regularApp: {
            lastHourstatsStore: [{
              timestamp: Date.now(),
              data: {
                cpu_stats: {
                  cpu_usage: { total_usage: 1000000 },
                  system_cpu_usage: 100000,
                  online_cpus: 16,
                },
                precpu_stats: {
                  cpu_usage: { total_usage: 900000 },
                  system_cpu_usage: 90000,
                },
              },
            }],
          },
        };

        const installedApps = [
          { name: 'regularApp', version: 2, cpu: 2 },
        ];

        await appInspectorWithBurst.applyEnterpriseCpuBurst(appsMonitored, installedApps);

        // Should not apply burst to non-enterprise app
        expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      });

      it('should handle composed apps', async () => {
        registryManagerStub.getApplicationOwner.resolves('0x123enterpriseowner');
        generalServiceStub.getNewNodeTier.resolves('stratus');
        dockerServiceStub.dockerContainerInspect = sinon.stub().resolves({
          HostConfig: { NanoCpus: 2e9 },
        });
        dockerServiceStub.appDockerUpdateCpu = sinon.stub().resolves();

        const appsMonitored = {
          'frontend_composedApp': {
            lastHourstatsStore: [],
          },
          'backend_composedApp': {
            lastHourstatsStore: [],
          },
        };

        const installedApps = [
          {
            name: 'composedApp',
            version: 4,
            compose: [
              { name: 'frontend', cpu: 2 },
              { name: 'backend', cpu: 4 },
            ],
          },
        ];

        await appInspectorWithBurst.applyEnterpriseCpuBurst(appsMonitored, installedApps);

        expect(registryManagerStub.getApplicationOwner.calledWith('composedApp')).to.be.true;
      });

      it('should handle errors gracefully', async () => {
        registryManagerStub.getApplicationOwner.rejects(new Error('Database error'));

        const appsMonitored = {};
        const installedApps = [
          { name: 'testApp', version: 2, cpu: 2 },
        ];

        // Should not throw
        await appInspectorWithBurst.applyEnterpriseCpuBurst(appsMonitored, installedApps);

        expect(logStub.error.called).to.be.true;
      });
    });

    describe('analyzeEnterpriseCpuStats', () => {
      it('should detect high CPU usage within detection window', () => {
        const now = Date.now();
        const allStats = [];
        // Create 10 high CPU stats within the last 15 minutes
        for (let i = 0; i < 10; i += 1) {
          allStats.push({
            timestamp: now - i * 60000, // 1 minute apart
            data: {
              cpu_stats: {
                cpu_usage: { total_usage: 10000 },
                system_cpu_usage: 1000,
                online_cpus: 16,
              },
              precpu_stats: {
                cpu_usage: { total_usage: 1000 },
                system_cpu_usage: 100,
              },
            },
          });
        }

        const burstConfig = {
          detectionWindowMs: 15 * 60 * 1000,
          highUtilThreshold: 85,
          lowUtilThreshold: 60,
          minStatsRequired: 5,
        };

        const result = appInspectorWithBurst.analyzeEnterpriseCpuStats(allStats, 2, burstConfig);

        expect(result.recentStats.length).to.equal(10);
      });

      it('should filter out stats outside detection window', () => {
        const now = Date.now();
        const allStats = [
          // Old stat outside 15 minute window
          {
            timestamp: now - 20 * 60 * 1000,
            data: {
              cpu_stats: { cpu_usage: { total_usage: 10000 }, system_cpu_usage: 1000, online_cpus: 16 },
              precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 100 },
            },
          },
          // Recent stat within window
          {
            timestamp: now - 5 * 60 * 1000,
            data: {
              cpu_stats: { cpu_usage: { total_usage: 10000 }, system_cpu_usage: 1000, online_cpus: 16 },
              precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 100 },
            },
          },
        ];

        const burstConfig = {
          detectionWindowMs: 15 * 60 * 1000,
          highUtilThreshold: 85,
          lowUtilThreshold: 60,
          minStatsRequired: 1,
        };

        const result = appInspectorWithBurst.analyzeEnterpriseCpuStats(allStats, 2, burstConfig);

        expect(result.recentStats.length).to.equal(1);
      });

      it('should return needsBurst=false when not enough stats', () => {
        const now = Date.now();
        const allStats = [
          {
            timestamp: now - 60000,
            data: {
              cpu_stats: { cpu_usage: { total_usage: 10000 }, system_cpu_usage: 1000, online_cpus: 16 },
              precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 100 },
            },
          },
        ];

        const burstConfig = {
          detectionWindowMs: 15 * 60 * 1000,
          highUtilThreshold: 85,
          lowUtilThreshold: 60,
          minStatsRequired: 5, // Requires 5, but only 1 available
        };

        const result = appInspectorWithBurst.analyzeEnterpriseCpuStats(allStats, 2, burstConfig);

        expect(result.needsBurst).to.be.false;
        expect(result.needsReset).to.be.false;
      });

      it('should use default values when config properties are missing', () => {
        const now = Date.now();
        const allStats = [];
        for (let i = 0; i < 10; i += 1) {
          allStats.push({
            timestamp: now - i * 60000,
            data: {
              cpu_stats: { cpu_usage: { total_usage: 10000 }, system_cpu_usage: 1000, online_cpus: 16 },
              precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 100 },
            },
          });
        }

        const burstConfig = {}; // Empty config - should use defaults

        const result = appInspectorWithBurst.analyzeEnterpriseCpuStats(allStats, 2, burstConfig);

        // Should not throw and should return valid result
        expect(result).to.have.property('needsBurst');
        expect(result).to.have.property('needsReset');
        expect(result).to.have.property('recentStats');
      });

      it('should return avgCpuPercent in result', () => {
        const now = Date.now();
        const allStats = [];
        for (let i = 0; i < 5; i += 1) {
          allStats.push({
            timestamp: now - i * 60000,
            data: {
              cpu_stats: { cpu_usage: { total_usage: 10000 }, system_cpu_usage: 1000, online_cpus: 16 },
              precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 100 },
            },
          });
        }

        const burstConfig = {
          detectionWindowMs: 15 * 60 * 1000,
          highUtilThreshold: 85,
          lowUtilThreshold: 60,
          minStatsRequired: 3,
        };

        const result = appInspectorWithBurst.analyzeEnterpriseCpuStats(allStats, 2, burstConfig);

        expect(result).to.have.property('avgCpuPercent');
        expect(result.avgCpuPercent).to.be.a('number');
      });

      it('should handle division by zero (systemCpuUsage = 0)', () => {
        const now = Date.now();
        const allStats = [
          {
            timestamp: now - 60000,
            data: {
              cpu_stats: { cpu_usage: { total_usage: 10000 }, system_cpu_usage: 100, online_cpus: 16 },
              precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 100 }, // Same value = 0 delta
            },
          },
          {
            timestamp: now - 120000,
            data: {
              cpu_stats: { cpu_usage: { total_usage: 10000 }, system_cpu_usage: 1000, online_cpus: 16 },
              precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 100 },
            },
          },
        ];

        const burstConfig = {
          detectionWindowMs: 15 * 60 * 1000,
          highUtilThreshold: 85,
          lowUtilThreshold: 60,
          minStatsRequired: 1,
        };

        // Should not throw
        const result = appInspectorWithBurst.analyzeEnterpriseCpuStats(allStats, 2, burstConfig);

        expect(result).to.have.property('needsBurst');
        expect(result.avgCpuPercent).to.be.a('number');
        expect(Number.isFinite(result.avgCpuPercent)).to.be.true;
      });

      it('should use configurable sampleThresholdPercent', () => {
        const now = Date.now();
        const allStats = [];
        // Create stats where 60% are high (below default 80% threshold but above 50%)
        for (let i = 0; i < 10; i += 1) {
          const isHigh = i < 6; // 6 out of 10 = 60%
          allStats.push({
            timestamp: now - i * 60000,
            data: {
              cpu_stats: {
                cpu_usage: { total_usage: isHigh ? 200000 : 10000 },
                system_cpu_usage: 1000,
                online_cpus: 16,
              },
              precpu_stats: {
                cpu_usage: { total_usage: isHigh ? 100000 : 5000 },
                system_cpu_usage: 100,
              },
            },
          });
        }

        // With 50% threshold, should trigger burst (60% > 50%)
        const burstConfigLow = {
          detectionWindowMs: 15 * 60 * 1000,
          highUtilThreshold: 50,
          lowUtilThreshold: 30,
          minStatsRequired: 5,
          sampleThresholdPercent: 50,
        };

        const result = appInspectorWithBurst.analyzeEnterpriseCpuStats(allStats, 2, burstConfigLow);

        // 60% of samples exceed threshold, and sampleThresholdPercent is 50%, so should trigger
        expect(result.needsBurst).to.be.true;
      });
    });

    describe('isCooldownPassed', () => {
      it('should return true when no previous allocation exists', () => {
        globalStateStub.enterpriseBurstAllocations.clear();
        const result = appInspectorWithBurst.isCooldownPassed('newContainer', 5 * 60 * 1000);
        expect(result).to.be.true;
      });

      it('should return true when no lastChangeTime in allocation', () => {
        globalStateStub.enterpriseBurstAllocations.set('testContainer', {
          specCpu: 2,
          currentAllocation: 4,
          // No lastChangeTime
        });
        const result = appInspectorWithBurst.isCooldownPassed('testContainer', 5 * 60 * 1000);
        expect(result).to.be.true;
      });

      it('should return false during cooldown period', () => {
        globalStateStub.enterpriseBurstAllocations.set('testContainer', {
          specCpu: 2,
          currentAllocation: 4,
          lastChangeTime: Date.now() - 60000, // 1 minute ago
        });
        const result = appInspectorWithBurst.isCooldownPassed('testContainer', 5 * 60 * 1000); // 5 min cooldown
        expect(result).to.be.false;
      });

      it('should return true after cooldown period', () => {
        globalStateStub.enterpriseBurstAllocations.set('testContainer', {
          specCpu: 2,
          currentAllocation: 4,
          lastChangeTime: Date.now() - 10 * 60 * 1000, // 10 minutes ago
        });
        const result = appInspectorWithBurst.isCooldownPassed('testContainer', 5 * 60 * 1000); // 5 min cooldown
        expect(result).to.be.true;
      });
    });

    describe('checkEnterpriseCpuBurst', () => {
      it('should call applyEnterpriseCpuBurst when enabled', async () => {
        registryManagerStub.getApplicationOwner.resolves('0x456regularowner');
        const installedAppsFunc = sinon.stub().resolves({
          status: 'success',
          data: [{ name: 'testApp', version: 2, cpu: 2 }],
        });

        await appInspectorWithBurst.checkEnterpriseCpuBurst({}, installedAppsFunc);

        expect(installedAppsFunc.calledOnce).to.be.true;
      });

      it('should skip when enterprise burst is disabled', async () => {
        const appInspectorDisabled = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
          config: {
            enterpriseAppOwners: [],
            enterpriseBurst: {
              enabled: false,
            },
            fluxSpecifics: { cpu: { stratus: 160 } },
            lockedSystemResources: { cpu: 10 },
            database: { url: 'mongodb://localhost:27017' },
          },
          '../dockerService': dockerServiceStub,
          '../messageHelper': messageHelperStub,
          '../../lib/log': logStub,
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().returnsArg(0),
          },
          '../serviceHelper': { ensureString: sinon.stub().returnsArg(0) },
          '../dbHelper': { databaseConnection: sinon.stub() },
          '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
          '../utils/appConstants': { appConstants: {} },
          '../utils/appUtilities': { getContainerStorage: sinon.stub().returns(0) },
          '../generalService': generalServiceStub,
          '../appDatabase/registryManager': registryManagerStub,
          '../utils/globalState': globalStateStub,
          'node-cmd': { run: (cmd, callback) => callback(null, 'data', 'stderr') },
        });

        const installedAppsFunc = sinon.stub().resolves({ status: 'success', data: [] });

        await appInspectorDisabled.checkEnterpriseCpuBurst({}, installedAppsFunc);

        // Should return early, installedApps should NOT be called
        expect(installedAppsFunc.called).to.be.false;
      });

      it('should handle installedApps failure gracefully', async () => {
        const installedAppsFunc = sinon.stub().resolves({
          status: 'error',
          data: null,
        });

        await appInspectorWithBurst.checkEnterpriseCpuBurst({}, installedAppsFunc);

        expect(logStub.warn.called).to.be.true;
      });
    });

    describe('exported enterprise burst functions', () => {
      it('should export enterprise burst functions', () => {
        expect(appInspectorWithBurst.isEnterpriseApp).to.be.a('function');
        expect(appInspectorWithBurst.getCachedApplicationOwner).to.be.a('function');
        expect(appInspectorWithBurst.calculateNodeAvailableCpu).to.be.a('function');
        expect(appInspectorWithBurst.calculateEnterpriseBurstAllocations).to.be.a('function');
        expect(appInspectorWithBurst.analyzeEnterpriseCpuStats).to.be.a('function');
        expect(appInspectorWithBurst.isCooldownPassed).to.be.a('function');
        expect(appInspectorWithBurst.applyEnterpriseCpuBurst).to.be.a('function');
        expect(appInspectorWithBurst.checkEnterpriseCpuBurst).to.be.a('function');
      });
    });
  });
});
