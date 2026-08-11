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

    // The node samples every running container already. Before this the live view
    // took the same three docker readings again on every five-second poll and threw
    // them away, so the copy that was kept was the one nothing read.
    describe('serving a held reading', () => {
      const monotonicNow = () => Number(process.hrtime.bigint() / 1000000n);
      let req;
      let res;

      function storedSample(ageMs, overrides = {}) {
        return {
          timestamp: Date.now() - ageMs,
          elapsed: monotonicNow() - ageMs,
          cpuTotal: 500,
          cpuTotalBefore: 100,
          cpuSystem: 800,
          cpuSystemBefore: 400,
          onlineCpus: 4,
          nanoCpus: 3e9,
          memoryUsage: 2048,
          memoryLimit: 8192,
          ioRead: 1,
          ioWrite: 2,
          networkRx: 3,
          networkTx: 4,
          disk: { bind: 7 },
          ...overrides,
        };
      }

      beforeEach(() => {
        req = { params: { appname: 'myapp' }, query: {} };
        res = { json: sinon.stub() };
        messageHelperStub.createDataMessage.returnsArg(0);
        dockerServiceStub.dockerContainerStats = sinon.stub().resolves({
          cpu_stats: { cpu_usage: { total_usage: 1 }, system_cpu_usage: 2, online_cpus: 1 },
          precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
          memory_stats: { usage: 1, limit: 2 },
        });
        dockerServiceStub.dockerContainerInspect.resolves({ HostConfig: { NanoCpus: 1e9 } });
      });

      it('should read what the sampler already collected rather than docker', async () => {
        globalStateStub.appsMonitored = { myapp: { statsStore: [storedSample(500)] } };

        await appInspector.appStats(req, res);

        expect(dockerServiceStub.dockerContainerStats.called).to.be.false;
        const reported = res.json.firstCall.args[0];
        expect(reported.memory_stats).to.deep.equal({ usage: 2048, limit: 8192 });
        expect(reported.cpu_stats.online_cpus).to.equal(4);
      });

      it('should take one reading however many callers ask at once', async () => {
        globalStateStub.appsMonitored = { myapp: { statsStore: [] } };

        await appInspector.appStats(req, res);
        await appInspector.appStats(req, { json: sinon.stub() });
        await appInspector.appStats(req, { json: sinon.stub() });

        expect(dockerServiceStub.dockerContainerStats.calledOnce).to.be.true;
      });

      // Without this a permanently stuck reading passes the test above perfectly.
      it('should take a fresh reading once the held one has aged out', async () => {
        globalStateStub.appsMonitored = { myapp: { statsStore: [storedSample(30_000)] } };

        await appInspector.appStats(req, res);

        expect(dockerServiceStub.dockerContainerStats.calledOnce).to.be.true;
      });
    });
  });

  describe('appMonitor tests', () => {
    // Samples are held as the handful of values the consumers read; the endpoint
    // puts them back into the docker stats shape callers already parse.
    function sample(timestamp, overrides = {}) {
      return {
        timestamp,
        elapsed: timestamp,
        cpuTotal: 200,
        cpuTotalBefore: 100,
        cpuSystem: 400,
        cpuSystemBefore: 200,
        onlineCpus: 2,
        nanoCpus: 2e9,
        memoryUsage: 1024,
        memoryLimit: 4096,
        ioRead: 10,
        ioWrite: 20,
        networkRx: 30,
        networkTx: 40,
        disk: {
          bind: 5, volume: 0, rootfs: 0, used: 5, status: 'ok',
        },
        ...overrides,
      };
    }

    const stats = [sample(1_000), sample(2_000)];

    it('should return every collected sample when no range is given', () => {
      globalStateStub.appsMonitored = { test_myapp: { statsStore: stats } };

      const result = appInspector.appMonitor('test_myapp');

      expect(result.map((s) => s.timestamp)).to.deep.equal([1_000, 2_000]);
    });

    it('should report a sample in the shape consumers parse', () => {
      globalStateStub.appsMonitored = { test_myapp: { statsStore: [sample(1_000)] } };

      const [{ data }] = appInspector.appMonitor('test_myapp');

      expect(data.cpu_stats.cpu_usage.total_usage).to.equal(200);
      expect(data.precpu_stats.cpu_usage.total_usage).to.equal(100);
      expect(data.cpu_stats.system_cpu_usage).to.equal(400);
      expect(data.precpu_stats.system_cpu_usage).to.equal(200);
      expect(data.cpu_stats.online_cpus).to.equal(2);
      expect(data.nanoCpus).to.equal(2e9);
      expect(data.memory_stats).to.deep.equal({ usage: 1024, limit: 4096 });
      expect(data.networks.eth0).to.deep.equal({ rx_bytes: 30, tx_bytes: 40 });
      expect(data.disk_stats.bind).to.equal(5);
    });

    // The chart sums the blkio entries because docker reports one per device in
    // the stack. Reporting the totals as a read and a write entry gives the same
    // sum, and gives a caller that reads only the first entry the true figure.
    it('should report summed disk io as one read and one write entry', () => {
      globalStateStub.appsMonitored = { test_myapp: { statsStore: [sample(1_000)] } };

      const [{ data }] = appInspector.appMonitor('test_myapp');

      expect(data.blkio_stats.io_service_bytes_recursive).to.deep.equal([
        { op: 'read', value: 10 },
        { op: 'write', value: 20 },
      ]);
    });

    it('should report absent disk io as absent rather than zero', () => {
      globalStateStub.appsMonitored = {
        test_myapp: { statsStore: [sample(1_000, { ioRead: null, ioWrite: null })] },
      };

      const [{ data }] = appInspector.appMonitor('test_myapp');

      expect(data.blkio_stats.io_service_bytes_recursive).to.be.null;
    });

    it('should drop samples older than the requested range', () => {
      const now = Date.now();
      globalStateStub.appsMonitored = {
        test_myapp: { statsStore: [sample(now - 60_000), sample(now - 1_000)] },
      };

      const result = appInspector.appMonitor('test_myapp', 30_000);

      expect(result.map((s) => s.timestamp)).to.deep.equal([now - 1_000]);
    });

    it('should accept a range given as a string', () => {
      const now = Date.now();
      globalStateStub.appsMonitored = { test_myapp: { statsStore: [sample(now - 1_000)] } };

      const result = appInspector.appMonitor('test_myapp', '30000');

      expect(result.map((s) => s.timestamp)).to.deep.equal([now - 1_000]);
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
      const HOUR_MS = 60 * 60 * 1000;

      // A minute apart, which is the sampler's cadence.
      function seedMinutes(count) {
        const now = Date.now();
        const samples = Array.from(
          { length: count },
          (_, i) => sample(now - (count - 1 - i) * 60_000),
        );
        globalStateStub.appsMonitored = { test_myapp: { statsStore: samples } };
        return samples;
      }

      it('should thin to one sample an hour', () => {
        seedMinutes(6 * 60); // six hours of samples

        const result = appInspector.appMonitor('test_myapp', 2 * DAY_MS);

        const gaps = result.slice(1).map((s, i) => s.timestamp - result[i].timestamp);
        gaps.slice(0, -1).forEach((gap) => expect(gap).to.equal(HOUR_MS));
        expect(result.length).to.be.within(6, 8);
      });

      // Thinning by position would drop it whenever the count is not a multiple of
      // the stride, leaving the chart's right edge short of the present.
      it('should always include the most recent sample', () => {
        const samples = seedMinutes(6 * 60 + 7);

        const result = appInspector.appMonitor('test_myapp', 2 * DAY_MS);

        expect(result[result.length - 1].timestamp).to.equal(samples[samples.length - 1].timestamp);
      });

      // The store's cadence is the sampler's business, not the endpoint's: thinning
      // reads timestamps, so a denser or sparser series still comes back hourly.
      it('should thin to one an hour whatever the sampling cadence', () => {
        const now = Date.now();
        const samples = Array.from({ length: 72 }, (_, i) => sample(now - (71 - i) * 5 * 60_000));
        globalStateStub.appsMonitored = { test_myapp: { statsStore: samples } };

        const result = appInspector.appMonitor('test_myapp', 2 * DAY_MS);

        const gaps = result.slice(1).map((s, i) => s.timestamp - result[i].timestamp);
        gaps.slice(0, -1).forEach((gap) => expect(gap).to.equal(HOUR_MS));
      });

      it('should return every sample for a range of exactly one day', () => {
        seedMinutes(45);

        const result = appInspector.appMonitor('test_myapp', DAY_MS);

        expect(result).to.have.lengthOf(45);
      });

      it('should return every sample for ranges under a day', () => {
        seedMinutes(45);

        const result = appInspector.appMonitor('test_myapp', HOUR_MS);

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

      const reported = messageHelperStub.createDataMessage.firstCall.args[0];
      expect(reported.map((s) => s.timestamp)).to.deep.equal(stats.map((s) => s.timestamp));
      sinon.assert.notCalled(messageHelperStub.errUnauthorizedMessage);
      sinon.assert.calledOnceWithExactly(res.json, reported);
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

      expect(messageHelperStub.createDataMessage.calledOnce).to.be.true;
      expect(messageHelperStub.createDataMessage.firstCall.args[0].map((s) => s.timestamp))
        .to.deep.equal(stats.map((s) => s.timestamp));
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

      expect(messageHelperStub.createDataMessage.calledOnce).to.be.true;
      expect(messageHelperStub.createDataMessage.firstCall.args[0].map((s) => s.timestamp))
        .to.deep.equal(stats.map((s) => s.timestamp));
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
    // elapsed is the monotonic clock the decision window filters on; timestamp is
    // the wall clock the charts plot
    const monotonicNow = () => Number(process.hrtime.bigint() / 1000000n);

    // The monotonic clock counts from system boot, so a sample described as five
    // minutes old is only expressible on a host that has been up that long - on a
    // younger one it lands before the origin, falls outside the decision window,
    // and the throttler is asked to decide on fewer samples than it was given.
    // These tests are about which decisions a window of samples produces, so the
    // clock is pinned to a host of a settled age and the arithmetic stops
    // depending on the machine that happens to be running them.
    const hostUpMs = 6 * 60 * 60 * 1000;
    let realHrtimeBigint;

    beforeEach(() => {
      realHrtimeBigint = process.hrtime.bigint;
      const origin = realHrtimeBigint();
      process.hrtime.bigint = () => BigInt(hostUpMs) * 1000000n + (realHrtimeBigint() - origin);
    });

    afterEach(() => {
      process.hrtime.bigint = realHrtimeBigint;
    });

    function cpuSample(ratio, minutesAgo) {
      return {
        timestamp: Date.now() - minutesAgo * 60 * 1000,
        elapsed: monotonicNow() - minutesAgo * 60 * 1000,
        cpuTotal: 100 + 100 * ratio,
        cpuTotalBefore: 100,
        cpuSystem: 200,
        cpuSystemBefore: 100,
        onlineCpus: 2,
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
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.calledOnceWithExactly('myapp', 1.8e9)).to.be.true;
    });

    it('does not strand a sample that arrives while the decision is being made', async () => {
      // The window is snapshotted before the inspect, so a sample landing during
      // it is not in this decision. Dating the watermark after the awaits would
      // also put that sample behind the NEXT window's floor, and no decision
      // would ever count it - the gap the watermark exists to close.
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };
      let midFlight;
      dockerServiceStub.dockerContainerInspect.callsFake(async () => {
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        midFlight = cpuSample(1, 0);
        globalStateStub.appsMonitored.myapp.statsStore.push(midFlight);
        return { HostConfig: { NanoCpus: 2e9 }, State: { Pid: 1234 } };
      });

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(midFlight, 'the sample really did arrive mid-decision').to.not.be.undefined;
      expect(globalStateStub.appsMonitored.myapp.lastCpuDecisionAt)
        .to.be.below(midFlight.elapsed);
    });

    it('leaves cpu alone when load was high on less than 80% of the window', async () => {
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 0.5, 0.5]) } };

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
      globalStateStub.appsMonitored = { myapp: { statsStore: window([0.5, 0.5, 0.5, 0.5, 0.5]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.calledOnceWithExactly('myapp', 1.7e9)).to.be.true;
    });

    it('makes no decision on four or fewer samples, and keeps them for the next pass', async () => {
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      expect(globalStateStub.appsMonitored.myapp.statsStore).to.have.lengthOf(4);
    });

    it('does not reuse a sample in a later decision', async () => {
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };

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
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;

      // burst ends, but the samples it declined to judge are spent
      cpuBurstHelperStub.isBurstActive.resolves(false);
      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
    });

    it('keeps the window when docker cannot inspect the container', async () => {
      dockerServiceStub.dockerContainerInspect.resolves(null);
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      expect(globalStateStub.appsMonitored.myapp.statsStore).to.have.lengthOf(5);
    });

    it('decides per component for a composed app', async () => {
      const composed = {
        name: 'myapp',
        version: 4,
        compose: [{ name: 'db', cpu: 2 }, { name: 'web', cpu: 2 }],
      };
      globalStateStub.appsMonitored = {
        db_myapp: { statsStore: window([1, 1, 1, 1, 1]) },
        web_myapp: { statsStore: window([0.5, 0.5, 0.5, 0.5, 0.5]) },
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
      expect(appInspector.appChanges).to.be.a('function');
      expect(appInspector.listAppsImages).to.be.a('function');
    });
  });
});
