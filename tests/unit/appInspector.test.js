const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appInspector tests', () => {
  let appInspector;
  let dockerServiceStub;
  let messageHelperStub;
  let logStub;
  let configStub;
  let globalStateStub;
  let cpuBurstHelperStub;

  beforeEach(() => {
    configStub = {
      database: {
        url: 'mongodb://localhost:27017',
      },
    };

    dockerServiceStub = {
      appDockerInspect: sinon.stub(),
      appDockerStats: sinon.stub(),
      appDockerUpdateCpu: sinon.stub().resolves(),
      dockerContainerInspect: sinon.stub(),
      dockerContainerStatsStream: (containerId, callback) => callback(null, {}),
    };

    cpuBurstHelperStub = {
      isBurstActive: sinon.stub().resolves(false),
    };

    messageHelperStub = {
      createDataMessage: sinon.stub(),
      createErrorMessage: sinon.stub(),
      errUnauthorizedMessage: sinon.stub().returns({
        status: 'error',
        data: { code: 401, name: 'Unauthorized', message: 'Unauthorized. Access denied.' },
      }),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    globalStateStub = {
      appsMonitored: {},
    };

    appInspector = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
      config: configStub,
      '../utils/globalState': globalStateStub,
      '../dockerService': dockerServiceStub,
      '../messageHelper': messageHelperStub,
      '../../lib/log': logStub,
      '../appQuery/appQueryService': {
        decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
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
      '../utils/cpuBurstHelper': cpuBurstHelperStub,
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
          decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
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
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
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
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
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
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
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
    const stats = [
      { timestamp: 1_000, data: { cpu: 1 } },
      { timestamp: 2_000, data: { cpu: 2 } },
    ];

    it('should return every collected sample when no range is given', () => {
      globalStateStub.appsMonitored = { test_myapp: { statsStore: stats } };

      expect(appInspector.appMonitor('test_myapp')).to.deep.equal(stats);
    });

    it('should drop samples older than the requested range', () => {
      const now = Date.now();
      const recent = { timestamp: now - 1_000, data: { cpu: 3 } };
      globalStateStub.appsMonitored = {
        test_myapp: { statsStore: [{ timestamp: now - 60_000, data: { cpu: 1 } }, recent] },
      };

      expect(appInspector.appMonitor('test_myapp', 30_000)).to.deep.equal([recent]);
    });

    it('should accept a range given as a string', () => {
      const now = Date.now();
      const recent = { timestamp: now - 1_000, data: { cpu: 3 } };
      globalStateStub.appsMonitored = { test_myapp: { statsStore: [recent] } };

      expect(appInspector.appMonitor('test_myapp', '30000')).to.deep.equal([recent]);
    });

    it('should throw if no app name was passed', () => {
      expect(() => appInspector.appMonitor()).to.throw('No Flux App specified');
    });

    it('should throw if the range is not a positive integer', () => {
      globalStateStub.appsMonitored = { test_myapp: { statsStore: stats } };

      expect(() => appInspector.appMonitor('test_myapp', -1)).to.throw('Invalid range value');
      expect(() => appInspector.appMonitor('test_myapp', 'soon')).to.throw('Invalid range value');
    });

    it('should throw if the app is not monitored', () => {
      globalStateStub.appsMonitored = {};

      expect(() => appInspector.appMonitor('test_myapp')).to.throw('No data available');
    });

    // Beyond a day the series is thinned so a week of samples does not have to be sent
    // or drawn in full. The frontend offers 2, 3 and 7 day ranges, so this is the path
    // those take.
    describe('ranges beyond a day', () => {
      const DAY_MS = 24 * 60 * 60 * 1000;

      function seed(count) {
        const now = Date.now();
        const samples = Array.from({ length: count }, (_, i) => ({
          timestamp: now - (count - i) * 1000,
          data: { cpu: i },
        }));
        globalStateStub.appsMonitored = { test_myapp: { statsStore: samples } };
        return samples;
      }

      it('should keep every twentieth sample and the most recent one', () => {
        const samples = seed(45);

        const result = appInspector.appMonitor('test_myapp', DAY_MS + 1);

        expect(result.map((s) => samples.indexOf(s))).to.deep.equal([0, 20, 40, 44]);
      });

      it('should return every sample for a range of exactly one day', () => {
        seed(45);

        const result = appInspector.appMonitor('test_myapp', DAY_MS);

        expect(result).to.have.lengthOf(45);
      });

      it('should return every sample for ranges under a day', () => {
        seed(45);

        const result = appInspector.appMonitor('test_myapp', 60 * 60 * 1000);

        expect(result).to.have.lengthOf(45);
      });
    });
  });

  describe('appMonitorAPI authorization tests', () => {
    // An app's resource history belongs to its owner, so the check has to be proven by
    // showing the data does not come back — asserting only that some response was sent
    // passes just as well when the check is gone.
    function buildWithPrivilege(authorized) {
      return proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../utils/globalState': globalStateStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../appQuery/appQueryService': {
          decryptEnterpriseApps: sinon.stub().returnsArg(0),
        },
        '../serviceHelper': { ensureString: sinon.stub().returnsArg(0) },
        '../dbHelper': { databaseConnection: sinon.stub() },
        '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(authorized) },
        '../utils/appConstants': { appConstants: {} },
        '../utils/appUtilities': { getContainerStorage: sinon.stub().returns(0) },
        '../utils/cpuBurstHelper': { isBurstActive: sinon.stub().resolves(false) },
        'node-cmd': { run: sinon.stub() },
      });
    }

    const stats = [{ timestamp: 1, cpu: 5 }];
    let req;
    let res;

    beforeEach(() => {
      req = { params: { appname: 'test_myapp' }, query: {} };
      res = { json: sinon.stub() };
      globalStateStub.appsMonitored = { test_myapp: { statsStore: stats } };
    });

    it('should withhold monitoring data from an unauthorized caller', async () => {
      const unauthorized = buildWithPrivilege(false);

      await unauthorized.appMonitorAPI(req, res);

      sinon.assert.notCalled(messageHelperStub.createDataMessage);
      sinon.assert.calledOnce(messageHelperStub.errUnauthorizedMessage);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should return monitoring data to an authorized caller', async () => {
      const authorized = buildWithPrivilege(true);
      messageHelperStub.createDataMessage.returnsArg(0);

      await authorized.appMonitorAPI(req, res);

      sinon.assert.calledOnceWithExactly(messageHelperStub.createDataMessage, stats);
      sinon.assert.notCalled(messageHelperStub.errUnauthorizedMessage);
      sinon.assert.calledOnceWithExactly(res.json, stats);
    });

    it('should scope the privilege check to the parent app of a component', async () => {
      const verifyPrivilege = sinon.stub().resolves(true);
      const inspector = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../utils/globalState': globalStateStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../appQuery/appQueryService': { decryptEnterpriseApps: sinon.stub().returnsArg(0) },
        '../serviceHelper': { ensureString: sinon.stub().returnsArg(0) },
        '../dbHelper': { databaseConnection: sinon.stub() },
        '../verificationHelper': { verifyPrivilege },
        '../utils/appConstants': { appConstants: {} },
        '../utils/appUtilities': { getContainerStorage: sinon.stub().returns(0) },
        '../utils/cpuBurstHelper': { isBurstActive: sinon.stub().resolves(false) },
        'node-cmd': { run: sinon.stub() },
      });

      await inspector.appMonitorAPI(req, res);

      sinon.assert.calledOnceWithExactly(verifyPrivilege, 'appownerabove', req, 'myapp');
    });
  });

  describe('appMonitorAPI tests', () => {
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

      await appInspector.appMonitorAPI(req, res);

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
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
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

      await appInspectorWithAuth.appMonitorAPI(req, res);

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
      const stats = [{ timestamp: 1, cpu: 5 }];
      globalStateStub.appsMonitored = { test_myappname: { statsStore: stats } };

      const dataMessage = { status: 'success', data: stats };
      messageHelperStub.createDataMessage.returns(dataMessage);

      await appInspector.appMonitorAPI(req, res);

      expect(messageHelperStub.createDataMessage.calledOnceWithExactly(stats)).to.be.true;
      expect(res.json.calledOnceWithExactly(dataMessage)).to.be.true;
      expect(logStub.error.called).to.be.false;
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
      const stats = [{ timestamp: 1, cpu: 5 }];
      globalStateStub.appsMonitored = { myappname: { statsStore: stats } };

      const dataMessage = { status: 'success', data: stats };
      messageHelperStub.createDataMessage.returns(dataMessage);

      await appInspector.appMonitorAPI(req, res);

      expect(messageHelperStub.createDataMessage.calledOnceWithExactly(stats)).to.be.true;
      expect(res.json.calledOnceWithExactly(dataMessage)).to.be.true;
      expect(logStub.error.called).to.be.false;
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

      await appInspector.appMonitorAPI(req, res);

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
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
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
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
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

  // The throttler physically re-allocates container CPU, so these pin the exact
  // decisions it makes for a given window of samples: which calls it emits, and
  // what it leaves behind for the next pass.
  describe('checkApplicationsCpuUSage', () => {
    // A sample carries its own cpu delta, so `ratio` is that sample's usage as a
    // fraction of one core-second: 1 is saturated, 0.5 is half loaded.
    function cpuSample(ratio, minutesAgo) {
      return {
        timestamp: Date.now() - minutesAgo * 60 * 1000,
        data: {
          cpu_stats: {
            cpu_usage: { total_usage: 100 + 100 * ratio },
            system_cpu_usage: 200,
            online_cpus: 2,
          },
          precpu_stats: {
            cpu_usage: { total_usage: 100 },
            system_cpu_usage: 100,
          },
        },
      };
    }

    function window(ratios) {
      return ratios.map((ratio, i) => cpuSample(ratio, ratios.length - i));
    }

    // nanoCpus over cpu over 1e9 is the allocation the node has actually applied
    // against what the spec asked for: 2e9 on a 2-cpu app is the full share.
    function installedAppsReturning(app) {
      return sinon.stub().resolves({ status: 'success', data: [app] });
    }

    const simpleApp = { name: 'myapp', version: 3, cpu: 2 };

    beforeEach(() => {
      dockerServiceStub.dockerContainerInspect.resolves({
        HostConfig: { NanoCpus: 2e9 },
        State: { Pid: 1234 },
      });
    });

    it('lowers cpu when load was high on at least 80% of the window', async () => {
      globalStateStub.appsMonitored = { myapp: { lastHourstatsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.calledOnceWithExactly('myapp', 1.8e9)).to.be.true;
    });

    it('leaves cpu alone when load was high on less than 80% of the window', async () => {
      globalStateStub.appsMonitored = { myapp: { lastHourstatsStore: window([1, 1, 1, 0.5, 0.5]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
    });

    it('restores cpu when the applied allocation is below the spec and load is not high', async () => {
      dockerServiceStub.dockerContainerInspect.resolves({
        HostConfig: { NanoCpus: 1.6e9 },
        State: { Pid: 1234 },
      });
      globalStateStub.appsMonitored = { myapp: { lastHourstatsStore: window([0.5, 0.5, 0.5, 0.5, 0.5]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.calledOnceWithExactly('myapp', 1.7e9)).to.be.true;
    });

    it('makes no decision on four or fewer samples, and keeps them for the next pass', async () => {
      globalStateStub.appsMonitored = { myapp: { lastHourstatsStore: window([1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      expect(globalStateStub.appsMonitored.myapp.lastHourstatsStore).to.have.lengthOf(4);
    });

    it('does not reuse a sample in a later decision', async () => {
      globalStateStub.appsMonitored = { myapp: { lastHourstatsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );
      dockerServiceStub.appDockerUpdateCpu.resetHistory();
      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
    });

    it('makes no decision while cfs burst is applied, and consumes the window', async () => {
      cpuBurstHelperStub.isBurstActive.resolves(true);
      globalStateStub.appsMonitored = { myapp: { lastHourstatsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      expect(globalStateStub.appsMonitored.myapp.lastHourstatsStore).to.be.empty;
    });

    it('keeps the window when docker cannot inspect the container', async () => {
      dockerServiceStub.dockerContainerInspect.resolves(null);
      globalStateStub.appsMonitored = { myapp: { lastHourstatsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      expect(globalStateStub.appsMonitored.myapp.lastHourstatsStore).to.have.lengthOf(5);
    });

    it('decides per component for a composed app', async () => {
      const composed = {
        name: 'myapp',
        version: 4,
        compose: [{ name: 'db', cpu: 2 }, { name: 'web', cpu: 2 }],
      };
      globalStateStub.appsMonitored = {
        db_myapp: { lastHourstatsStore: window([1, 1, 1, 1, 1]) },
        web_myapp: { lastHourstatsStore: window([0.5, 0.5, 0.5, 0.5, 0.5]) },
      };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(composed),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.calledOnceWithExactly('db_myapp', 1.8e9)).to.be.true;
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
});
