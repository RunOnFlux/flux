const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const path = require('path');
const os = require('os');
const nodecmd = require('node-cmd');
const systemcrontab = require('crontab');
const chaiAsPromised = require('chai-as-promised');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const dockerService = require('../../ZelBack/src/services/dockerService');
const geolocationService = require('../../ZelBack/src/services/geolocationService');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonServiceBenchmarkRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBenchmarkRpcs');
const generalService = require('../../ZelBack/src/services/generalService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const log = require('../../ZelBack/src/lib/log');

// Import new modular app services
const appContainerService = require('../../ZelBack/src/services/apps/appContainerService');
const appMonitoringService = require('../../ZelBack/src/services/apps/appMonitoringService');
const appInstallationService = require('../../ZelBack/src/services/apps/appInstallationService');
const appFileService = require('../../ZelBack/src/services/apps/appFileService');
const appProgressState = require('../../ZelBack/src/services/apps/appProgressState');

chai.use(chaiAsPromised);
const { expect } = chai;
const cmdAsyncFake = sinon.fake(async () => true);
const crontabLoadFake = sinon.fake(async () => ({
  jobs: sinon.fake(() => [
    {
      comment: sinon.fake(() => 1111),
      isValid: sinon.fake(() => true),
      command: sinon.fake(() => 'sudo mount -o loop /home/abcapp2TEMP /root/flux/ZelApps/abcapp2'),
    },
    {
      comment: sinon.fake(() => 2222),
      isValid: sinon.fake(() => false),
      command: sinon.fake(() => 'sudo mount -o loop /home/aaassssTEMP /root/flux/ZelApps/asdfg'),
    },
  ]),
  remove: sinon.fake(() => true),
  save: sinon.fake(() => true),
}));
const dockerPullStreamFake = sinon.fake(async () => true);
const dockerContainerStatsStreamFake = sinon.fake(async () => true);
const utilFake = {
  promisify: sinon.fake((arg) => {
    if (arg === nodecmd.run) return cmdAsyncFake;
    if (arg === systemcrontab.load) return crontabLoadFake;
    if (arg === dockerService.dockerPullStream) return dockerPullStreamFake;
    if (arg === dockerService.dockerContainerStatsStream) return dockerContainerStatsStreamFake;
    return true;
  }),
};

const adminConfig = {
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    testnet: true,
  },
  lockedSystemResources: {
    hdd: 50,
  },
};
// Import services directly instead of using proxyquire for now
const appFileServiceProxy = appFileService;
const appContainerServiceProxy = appContainerService;
const appMonitoringServiceProxy = appMonitoringService;
const appInstallationServiceProxy = appInstallationService;

describe('Apps Services tests', () => {
  describe('installedApps tests', () => {
    let dbStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      return res;
    };

    beforeEach(async () => {
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return apps data, response passed', async () => {
      dbStub.returns({
        app1: 'info',
        app2: 'info2',
      });
      const res = generateResponse();
      const req = {
        params: {
          appname: 'appName',
        },
      };

      await appFileServiceProxy.installedApps(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { app1: 'info', app2: 'info2' } });
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'zelappsinformation', {}, { projection: { _id: 0 } });
    });

    it('should return apps data, no response passed', async () => {
      dbStub.returns({
        app1: 'info',
        app2: 'info2',
      });
      const req = {
        query: {
          test: 'test',
        },
        params: {
          appname: 'appName',
        },
      };

      const result = await appFileServiceProxy.installedApps(req);

      expect(result).to.eql({ status: 'success', data: { app1: 'info', app2: 'info2' } });
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'zelappsinformation', {}, { projection: { _id: 0 } });
    });

    it('should return apps data, response passed, data in query', async () => {
      dbStub.returns({
        app1: 'info',
        app2: 'info2',
      });
      const res = generateResponse();
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          appname: 'appName',
        },
      };

      await appFileServiceProxy.installedApps(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { app1: 'info', app2: 'info2' } });
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'zelappsinformation', {}, { projection: { _id: 0 } });
    });

    it('should return apps data, response passed, data as a string', async () => {
      dbStub.returns({
        app1: 'info',
        app2: 'info2',
      });
      const res = generateResponse();
      const req = 'appName';

      await appFileServiceProxy.installedApps(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { app1: 'info', app2: 'info2' } });
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'zelappsinformation', {}, { projection: { _id: 0 } });
    });

    it('should return error, if error is thrown, response passed', async () => {
      dbStub.callsFake(async () => { throw new Error('Error'); });
      const res = generateResponse();
      const req = 'appName';

      await appFileServiceProxy.installedApps(req, res);

      sinon.assert.calledOnce(res.json);
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'zelappsinformation', {}, { projection: { _id: 0 } });
    });

    it('should return error, if error is thrown, no response passed', async () => {
      dbStub.callsFake(async () => { throw new Error('Error'); });
      const req = 'appName';

      const result = await appFileServiceProxy.installedApps(req);

      expect(result).to.be.an('object');
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'zelappsinformation', {}, { projection: { _id: 0 } });
    });
  });

  describe('listRunningApps tests', () => {
    let dockerServiceStub;
    let logSpy;
    const apps = [
      {
        Names: ['flux_zeltest'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testparam',
        testparam2: 'testparam02',
      },
      {
        Names: ['flux_testapp'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testtest',
        testparam2: 'testtest02',
      },
      {
        Names: ['somethingelse'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testtest',
        testparam2: 'testtest02',
      },
    ];
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      dockerServiceStub = sinon.stub(dockerService, 'dockerListContainers');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if dockerService throws, no response passed', async () => {
      dockerServiceStub.callsFake(async () => { throw new Error('Error'); });

      const result = await appContainerServiceProxy.listRunningApps();

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if dockerService throws, response passed', async () => {
      const res = generateResponse();
      dockerServiceStub.callsFake(async () => { throw new Error('Error'); });

      await appContainerServiceProxy.listRunningApps(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return running apps, no response passed', async () => {
      dockerServiceStub.reset();
      dockerServiceStub.returns(apps);

      const result = await appContainerServiceProxy.listRunningApps();

      expect(result).to.eql({
        status: 'success',
        data: [
          {
            Names: [
              'flux_zeltest',
            ],
            HostConfig: 'someconfig',
            NetworkSettings: 'mySettings',
            Mounts: 'mount1',
            testparam1: 'testparam',
            testparam2: 'testparam02',
          },
          {
            Names: [
              'flux_testapp',
            ],
            HostConfig: 'someconfig',
            NetworkSettings: 'mySettings',
            Mounts: 'mount1',
            testparam1: 'testtest',
            testparam2: 'testtest02',
          },
        ],
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return running apps, response passed', async () => {
      dockerServiceStub.reset();
      dockerServiceStub.returns(apps);
      const res = generateResponse();

      await appContainerServiceProxy.listRunningApps(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: [
          {
            Names: [
              'flux_zeltest',
            ],
            HostConfig: 'someconfig',
            NetworkSettings: 'mySettings',
            Mounts: 'mount1',
            testparam1: 'testparam',
            testparam2: 'testparam02',
          },
          {
            Names: [
              'flux_testapp',
            ],
            HostConfig: 'someconfig',
            NetworkSettings: 'mySettings',
            Mounts: 'mount1',
            testparam1: 'testtest',
            testparam2: 'testtest02',
          },
        ],
      });
      sinon.assert.notCalled(logSpy);
    });
  });

  describe('listAllApps tests', () => {
    let dockerServiceStub;
    let logSpy;
    const apps = [
      {
        Names: ['/flux_zeltest'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testparam',
        testparam2: 'testparam02',
      },
      {
        Names: ['/flux_testapp'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testtest',
        testparam2: 'testtest02',
      },
      {
        Names: ['/somethingelse'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testtest',
        testparam2: 'testtest02',
      },
    ];
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      dockerServiceStub = sinon.stub(dockerService, 'dockerListContainers');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if dockerService throws, no response passed', async () => {
      dockerServiceStub.callsFake(async () => { throw new Error('Error'); });

      const result = await appContainerServiceProxy.listAllApps();

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if dockerService throws, response passed', async () => {
      const res = generateResponse();
      dockerServiceStub.callsFake(async () => { throw new Error('Error'); });

      await appContainerServiceProxy.listAllApps(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return running apps, no response passed', async () => {
      dockerServiceStub.returns(apps);

      const result = await appContainerServiceProxy.listAllApps();

      expect(result).to.eql({
        status: 'success',
        data: [
          {
            Names: [
              'flux_zeltest',
            ],
            HostConfig: 'someconfig',
            NetworkSettings: 'mySettings',
            Mounts: 'mount1',
            testparam1: 'testparam',
            testparam2: 'testparam02',
          },
          {
            Names: [
              'flux_testapp',
            ],
            HostConfig: 'someconfig',
            NetworkSettings: 'mySettings',
            Mounts: 'mount1',
            testparam1: 'testtest',
            testparam2: 'testtest02',
          },
        ],
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return running apps, response passed', async () => {
      dockerServiceStub.returns(apps);
      const res = generateResponse();

      await appContainerServiceProxy.listAllApps(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: [
          {
            Names: [
              'flux_zeltest',
            ],
            HostConfig: 'someconfig',
            NetworkSettings: 'mySettings',
            Mounts: 'mount1',
            testparam1: 'testparam',
            testparam2: 'testparam02',
          },
          {
            Names: [
              'flux_testapp',
            ],
            HostConfig: 'someconfig',
            NetworkSettings: 'mySettings',
            Mounts: 'mount1',
            testparam1: 'testtest',
            testparam2: 'testtest02',
          },
        ],
      });
      sinon.assert.notCalled(logSpy);
    });
  });

  describe('listAppsImages tests', () => {
    let dockerServiceStub;
    let verificationHelperStub;
    let logSpy;
    const apps = [
      {
        Names: ['flux_zeltest'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testparam',
        testparam2: 'testparam02',
      },
      {
        Names: ['flux_testapp'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testtest',
        testparam2: 'testtest02',
      },
      {
        Names: ['somethingelse'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testtest',
        testparam2: 'testtest02',
      },
    ];
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(async () => {
      dockerServiceStub = sinon.stub(dockerService, 'dockerListImages');
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if dockerService throws, no response passed', async () => {
      dockerServiceStub.callsFake(async () => { throw new Error('Error'); });

      const result = await appContainerServiceProxy.listAppsImages();

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if dockerService throws, response passed', async () => {
      const res = generateResponse();
      dockerServiceStub.callsFake(async () => { throw new Error('Error'); });

      await appContainerServiceProxy.listAppsImages(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return running apps, no response passed', async () => {
      dockerServiceStub.returns(apps);

      const result = await appContainerServiceProxy.listAppsImages();

      expect(result).to.eql({
        status: 'success',
        data: apps,
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return running apps, response passed', async () => {
      dockerServiceStub.returns(apps);
      const res = generateResponse();

      await appContainerServiceProxy.listAppsImages(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: apps,
      });
      sinon.assert.notCalled(logSpy);
    });
  });

  describe('appStart tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no params were passed, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appStart(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
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

      const result = await appContainerServiceProxy.appStart(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges, response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appStart(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return error if user has no appowner privileges, no response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(false);

      const result = await appContainerServiceProxy.appStart(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should start app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStart').returns('some data');

      const result = await appContainerServiceProxy.appStart(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
    });

    it('should return error, no underscore in the name, app not found in db', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns(false);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStart').returns('some data');

      const result = await appContainerServiceProxy.appStart(req);

      expect(result).to.eql({
        data: {
          code: undefined,
          message: 'Application not found',
          name: 'Error',
        },
        status: 'error',
      });
      sinon.assert.calledOnce(logSpy);
      sinon.assert.notCalled(dockerStub);
    });

    it('should start app, no underscore in the name, app ver < 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 2, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStart').returns('some data');

      const result = await appContainerServiceProxy.appStart(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should start app, no underscore in the name, app ver = 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 3, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStart').returns('some data');

      const result = await appContainerServiceProxy.appStart(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should start app, no underscore in the name, app ver > 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({
        version: 4,
        test: 'test',
        name: 'my_app',
        compose: [{ name: 'my_test_app_name' }],
      });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStart').returns('some data');

      const result = await appContainerServiceProxy.appStart(req);

      expect(result).to.eql({
        status: 'success',
        data: 'Application my_app started',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'my_test_app_name_my_app');
    });
  });

  describe('appStop tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no params were passed, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appStop(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
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

      const result = await appContainerServiceProxy.appStop(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges, response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appStop(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return error if user has no appowner privileges, no response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(false);

      const result = await appContainerServiceProxy.appStop(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should stop app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStop').returns('some data');

      const result = await appContainerServiceProxy.appStop(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
    });

    it('should return error, no underscore in the name, app not found in db', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns(false);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStop').returns('some data');

      const result = await appContainerServiceProxy.appStop(req);

      expect(result).to.eql({
        data: {
          code: undefined,
          message: 'Application not found',
          name: 'Error',
        },
        status: 'error',
      });
      sinon.assert.calledOnce(logSpy);
      sinon.assert.notCalled(dockerStub);
    });

    it('should stop app, no underscore in the name, app ver < 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 2, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStop').returns('some data');

      const result = await appContainerServiceProxy.appStop(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should stop app, no underscore in the name, app ver = 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 3, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStop').returns('some data');

      const result = await appContainerServiceProxy.appStop(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should stop app, no underscore in the name, app ver > 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({
        version: 4,
        test: 'test',
        name: 'my_app',
        compose: [{ name: 'my_test_app_name' }],
      });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerStop').returns('some data');

      const result = await appContainerServiceProxy.appStop(req);

      expect(result).to.eql({
        status: 'success',
        data: 'Application my_app stopped',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'my_test_app_name_my_app');
    });
  });

  describe('appRestart tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no params were passed, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appRestart(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
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

      const result = await appContainerServiceProxy.appRestart(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges, response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appRestart(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return error if user has no appowner privileges, no response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(false);

      const result = await appContainerServiceProxy.appRestart(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should restart app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerRestart').returns('some data');

      const result = await appContainerServiceProxy.appRestart(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
    });

    it('should return error, no underscore in the name, app not found in db', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns(false);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerRestart').returns('some data');

      const result = await appContainerServiceProxy.appRestart(req);

      expect(result).to.eql({
        data: {
          code: undefined,
          message: 'Application not found',
          name: 'Error',
        },
        status: 'error',
      });
      sinon.assert.calledOnce(logSpy);
      sinon.assert.notCalled(dockerStub);
    });

    it('should restart app, no underscore in the name, app ver < 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 2, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerRestart').returns('some data');

      const result = await appContainerServiceProxy.appRestart(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should restart app, no underscore in the name, app ver = 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 3, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerRestart').returns('some data');

      const result = await appContainerServiceProxy.appRestart(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should restart app, no underscore in the name, app ver > 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({
        version: 4,
        test: 'test',
        name: 'my_app',
        compose: [{ name: 'my_test_app_name' }],
      });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerRestart').returns('some data');

      const result = await appContainerServiceProxy.appRestart(req);

      expect(result).to.eql({
        status: 'success',
        data: 'Application my_app restarted',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'my_test_app_name_my_app');
    });
  });

  describe('appKill tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no params were passed, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appKill(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
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

      const result = await appContainerServiceProxy.appKill(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges, response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appKill(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return error if user has no appowner privileges, no response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(false);

      const result = await appContainerServiceProxy.appKill(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should kill app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerKill').returns('some data');

      const result = await appContainerServiceProxy.appKill(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
    });

    it('should return error, no underscore in the name, app not found in db', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns(false);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerKill').returns('some data');

      const result = await appContainerServiceProxy.appKill(req);

      expect(result).to.eql({
        data: {
          code: undefined,
          message: 'Application not found',
          name: 'Error',
        },
        status: 'error',
      });
      sinon.assert.calledOnce(logSpy);
      sinon.assert.notCalled(dockerStub);
    });

    it('should kill app, no underscore in the name, app ver < 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 2, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerKill').returns('some data');

      const result = await appContainerServiceProxy.appKill(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should kill app, no underscore in the name, app ver = 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 3, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerKill').returns('some data');

      const result = await appContainerServiceProxy.appKill(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should kill app, no underscore in the name, app ver > 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({
        version: 4,
        test: 'test',
        name: 'my_app',
        compose: [{ name: 'my_test_app_name' }],
      });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerKill').returns('some data');

      const result = await appContainerServiceProxy.appKill(req);

      expect(result).to.eql({
        status: 'success',
        data: 'Application my_app killed',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'my_test_app_name_my_app');
    });
  });

  describe('appPause tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no params were passed, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appPause(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
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

      const result = await appContainerServiceProxy.appPause(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges, response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appPause(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return error if user has no appowner privileges, no response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(false);

      const result = await appContainerServiceProxy.appPause(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should pause app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerPause').returns('some data');

      const result = await appContainerServiceProxy.appPause(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
    });

    it('should return error, no underscore in the name, app not found in db', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns(false);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerPause').returns('some data');

      const result = await appContainerServiceProxy.appPause(req);

      expect(result).to.eql({
        data: {
          code: undefined,
          message: 'Application not found',
          name: 'Error',
        },
        status: 'error',
      });
      sinon.assert.calledOnce(logSpy);
      sinon.assert.notCalled(dockerStub);
    });

    it('should pause app, no underscore in the name, app ver < 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 2, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerPause').returns('some data');

      const result = await appContainerServiceProxy.appPause(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should pause app, no underscore in the name, app ver = 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 3, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerPause').returns('some data');

      const result = await appContainerServiceProxy.appPause(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should pause app, no underscore in the name, app ver > 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({
        version: 4,
        test: 'test',
        name: 'my_app',
        compose: [{ name: 'my_test_app_name' }],
      });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerPause').returns('some data');

      const result = await appContainerServiceProxy.appPause(req);

      expect(result).to.eql({
        status: 'success',
        data: 'Application my_app paused',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'my_test_app_name_my_app');
    });
  });

  describe('appUnpause tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no params were passed, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appUnpause(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
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

      const result = await appContainerServiceProxy.appUnpause(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges, response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appUnpause(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return error if user has no appowner privileges, no response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(false);

      const result = await appContainerServiceProxy.appUnpause(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should unpause app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerUnpause').returns('some data');

      const result = await appContainerServiceProxy.appUnpause(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
    });

    it('should return error, no underscore in the name, app not found in db', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns(false);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerUnpause').returns('some data');

      const result = await appContainerServiceProxy.appUnpause(req);

      expect(result).to.eql({
        data: {
          code: undefined,
          message: 'Application not found',
          name: 'Error',
        },
        status: 'error',
      });
      sinon.assert.calledOnce(logSpy);
      sinon.assert.notCalled(dockerStub);
    });

    it('should unpause app, no underscore in the name, app ver < 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 2, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerUnpause').returns('some data');

      const result = await appContainerServiceProxy.appUnpause(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should unpause app, no underscore in the name, app ver = 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 3, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerUnpause').returns('some data');

      const result = await appContainerServiceProxy.appUnpause(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });

    it('should unpause app, no underscore in the name, app ver > 3', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({
        version: 4,
        test: 'test',
        name: 'my_app',
        compose: [{ name: 'my_test_app_name' }],
      });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerUnpause').returns('some data');

      const result = await appContainerServiceProxy.appUnpause(req);

      expect(result).to.eql({
        status: 'success',
        data: 'Application my_app unpaused',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'my_test_app_name_my_app');
    });
  });

  describe('appTop tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no params were passed, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appTop(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
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

      const result = await appContainerServiceProxy.appTop(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges, response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appTop(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return error if user has no appowner privileges, no response passed', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(false);

      const result = await appContainerServiceProxy.appTop(req);

      expect(result).to.eql({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
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
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerTop').returns('some data');

      const result = await appContainerServiceProxy.appTop(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
    });

    it('should top app, no underscore in the name', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').returns({ version: 2, test: 'test' });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'appDockerTop').returns('some data');

      const result = await appContainerServiceProxy.appTop(req);

      expect(result).to.eql({
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });
  });

  describe('appLog tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appLog(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appLog(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should log app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'dockerContainerLogs').returns('some data');
      sinon.stub(serviceHelper, 'dockerBufferToString').returns('some data');
      const res = generateResponse();

      await appContainerServiceProxy.appLog(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname', [10, 11, 12]);
    });

    it('should log app, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'dockerContainerLogs').returns('some data');
      sinon.stub(serviceHelper, 'dockerBufferToString').returns('some data');
      const res = generateResponse();

      await appContainerServiceProxy.appLog(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname', [10, 11, 12]);
    });

    it('should log app, no underscore in the name, no lines param', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'dockerContainerLogs').returns('some data');
      sinon.stub(serviceHelper, 'dockerBufferToString').returns('some data');
      const res = generateResponse();

      await appContainerServiceProxy.appLog(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname', 'all');
    });
  });

  describe('appInspect tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appInspect(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appInspect(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should inspect app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'dockerContainerInspect').returns('some data');
      const res = generateResponse();

      await appContainerServiceProxy.appInspect(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
    });

    it('should inspect app, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'dockerContainerInspect').returns('some data');
      const res = generateResponse();

      await appContainerServiceProxy.appInspect(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });
  });

  describe('appStats tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appStats(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appStats(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return app stats, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const mockStats = {
        data: 1000,
      };
      const mockContainer = {
        Id: 'mockContainerId',
        Names: ['/test_myappname'],
        HostConfig: { NanoCpus: 1000 },
      };
      const dockerContainerStatsStub = sinon
        .stub(dockerService, 'dockerContainerStats')
        .returns(Promise.resolve(mockStats));

      const dockerContainerInspectStub = sinon
        .stub(dockerService, 'dockerContainerInspect')
        .returns(Promise.resolve(mockContainer));

      const res = generateResponse();

      await appContainerServiceProxy.appStats(req, res);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerContainerStatsStub, 'test_myappname');
      sinon.assert.calledTwice(dockerContainerInspectStub);
      sinon.assert.calledWith(dockerContainerInspectStub, 'test_myappname');
      sinon.assert.calledWith(dockerContainerInspectStub, 'test_myappname', { size: true });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: mockStats,
      });
    });

    it('should return app stats, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const mockStats = {
        data: 1000,
      };
      const mockContainer = {
        Id: 'mockContainerId',
        Names: ['/myappname'],
        HostConfig: { NanoCpus: 1000 },
      };
      const dockerContainerStatsStub = sinon
        .stub(dockerService, 'dockerContainerStats')
        .returns(Promise.resolve(mockStats));

      const dockerContainerInspectStub = sinon
        .stub(dockerService, 'dockerContainerInspect')
        .returns(Promise.resolve(mockContainer));

      const res = generateResponse();

      await appContainerServiceProxy.appStats(req, res);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerContainerStatsStub, 'myappname');
      sinon.assert.calledTwice(dockerContainerInspectStub);
      sinon.assert.calledWith(dockerContainerInspectStub, 'myappname');
      sinon.assert.calledWith(dockerContainerInspectStub, 'myappname', { size: true });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: mockStats,
      });
    });
  });

  describe('appMonitor tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
    });

    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appMonitoringServiceProxy.appMonitor(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appMonitoringServiceProxy.appMonitor(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return app monitor data, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const res = generateResponse();
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'test_myappname',
          statsStore: 1000,
        },
      );

      await appMonitoringServiceProxy.appMonitor(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: 1000 });
      sinon.assert.notCalled(logSpy);
    });

    it('should return app monitor data, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const res = generateResponse();
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'myappname',
          statsStore: 1000,
        },
      );

      await appMonitoringServiceProxy.appMonitor(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: 1000 });
      sinon.assert.notCalled(logSpy);
    });

    it('should return error if app is not monitored', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const res = generateResponse();

      await appMonitoringServiceProxy.appMonitor(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'No data available' },
      });
      sinon.assert.calledOnce(logSpy);
    });
  });

  describe('appMonitorStream tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      return res;
    };

    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appMonitoringServiceProxy.appMonitorStream(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appMonitoringServiceProxy.appMonitorStream(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return app monitor stream, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const res = generateResponse();

      await appMonitoringServiceProxy.appMonitorStream(req, res);

      sinon.assert.calledOnce(res.end);
      sinon.assert.calledWithExactly(
        dockerContainerStatsStreamFake,
        'test_myappname',
        {
          params: { appname: 'test_myappname', lines: [10, 11, 12] },
          query: { test2: 'test2' },
        },
        res,
      );
      sinon.assert.notCalled(logSpy);
    });

    it('should return app monitor stream, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
          lines: [10, 11, 12],
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const res = generateResponse();

      await appMonitoringServiceProxy.appMonitorStream(req, res);

      sinon.assert.calledOnce(res.end);
      sinon.assert.calledWithExactly(
        dockerContainerStatsStreamFake,
        'myappname',
        {
          params: { appname: 'myappname', lines: [10, 11, 12] },
          query: { test2: 'test2' },
        },
        res,
      );
      sinon.assert.notCalled(logSpy);
    });
  });

  describe('getAppFolderSize tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should return 0 if error occurs', async () => {
      const appName = 'testapp';
      const dirpath = path.join(__dirname, '../../');
      const directoryPath = `${dirpath}ZelApps/${appName}`;
      const exec = `sudo du -s --block-size=1 ${directoryPath}`;

      await appMonitoringServiceProxy.getAppFolderSize(appName);

      sinon.assert.calledWithExactly(cmdAsyncFake, exec);
    });
  });

  describe('startAppMonitoring tests', () => {
    beforeEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
    });

    afterEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
    });

    it('should throw error if no app name was passed', () => {
      expect(appMonitoringServiceProxy.startAppMonitoring.bind(appMonitoringServiceProxy)).to.throw('No App specified');
    });

    it('should set apps monitored of a new app', () => {
      const appName = 'myAppName';
      appMonitoringServiceProxy.startAppMonitoring(appName);

      const appsMonitored = appMonitoringServiceProxy.getAppsMonitored();
      expect(appsMonitored.myAppName).to.be.an('object');
      expect(appsMonitored.myAppName.statsStore).to.be.an('array');
      expect(appsMonitored.myAppName.oneMinuteInterval).to.be.an('object');
    });
  });

  describe('startMonitoringOfApps tests', () => {
    let dbStub;
    let logSpy;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
      appMonitoringServiceProxy.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
    });

    afterEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
    });

    it('should set apps monitored of a new apps, apps passed in param', async () => {
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
        {
          name: 'myAppNamev2',
          version: 2,
        },
        {
          name: 'myAppNamev4',
          version: 4,
          compose: [{ name: 'compname1' }, { name: 'compname2' }],
        },
      ];

      await appMonitoringServiceProxy.startMonitoringOfApps(apps);

      const appsMonitored = appMonitoringServiceProxy.getAppsMonitored();
      expect(appsMonitored.myAppNamev3).to.be.an('object');
      expect(appsMonitored.myAppNamev2).to.be.an('object');
      expect(appsMonitored.compname1_myAppNamev4).to.be.an('object');
      expect(appsMonitored.compname2_myAppNamev4).to.be.an('object');
    });

    it('should set apps monitored of a new apps, apps not passed in param', async () => {
      dbStub.returns([
        {
          name: 'myAppNamev3',
          version: 3,
        },
        {
          name: 'myAppNamev2',
          version: 2,
        },
        {
          name: 'myAppNamev4',
          version: 4,
          compose: [{ name: 'compname1' }, { name: 'compname2' }],
        },
      ]);

      await appMonitoringServiceProxy.startMonitoringOfApps();

      const appsMonitored = appMonitoringServiceProxy.getAppsMonitored();
      expect(appsMonitored.myAppNamev3).to.be.an('object');
      expect(appsMonitored.myAppNamev2).to.be.an('object');
      expect(appsMonitored.compname1_myAppNamev4).to.be.an('object');
      expect(appsMonitored.compname2_myAppNamev4).to.be.an('object');
    });

    it('should log error if db read fails', async () => {
      dbStub.callsFake(() => { throw new Error('Error'); });

      await appMonitoringServiceProxy.startMonitoringOfApps();

      sinon.assert.calledTwice(logSpy);
    });
  });

  describe('stopMonitoringOfApps tests', () => {
    let dbStub;
    let logSpy;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
      appMonitoringServiceProxy.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
    });

    afterEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
    });

    it('should stop apps monitoring, no delete, no apps passed in param', async () => {
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
        {
          name: 'myAppNamev2',
          version: 2,
        },
        {
          name: 'myAppNamev4',
          version: 4,
          compose: [{ name: 'compname1' }, { name: 'compname2' }],
        },
      ];
      dbStub.returns(apps);
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'myAppNamev3',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'myAppNamev2',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'compname1_myAppNamev4',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,

        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'compname2_myAppNamev4',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,

        },
      );

      await appMonitoringServiceProxy.stopMonitoringOfApps();

      const appsMonitored = appMonitoringServiceProxy.getAppsMonitored();
      expect(appsMonitored.myAppNamev3).to.be.an('object');
      expect(appsMonitored.myAppNamev2).to.be.an('object');
      expect(appsMonitored.compname1_myAppNamev4).to.be.an('object');
      expect(appsMonitored.compname2_myAppNamev4).to.be.an('object');
    });

    it('should stop apps monitoring, no delete, apps passed in param', async () => {
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
        {
          name: 'myAppNamev2',
          version: 2,
        },
        {
          name: 'myAppNamev4',
          version: 4,
          compose: [{ name: 'compname1' }, { name: 'compname2' }],
        },
      ];
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'myAppNamev3',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,

        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'myAppNamev2',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'compname1_myAppNamev4',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'compname2_myAppNamev4',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,

        },
      );

      await appMonitoringServiceProxy.stopMonitoringOfApps(apps);

      const appsMonitored = appMonitoringServiceProxy.getAppsMonitored();
      expect(appsMonitored.myAppNamev3).to.be.an('object');
      expect(appsMonitored.myAppNamev2).to.be.an('object');
      expect(appsMonitored.compname1_myAppNamev4).to.be.an('object');
      expect(appsMonitored.compname2_myAppNamev4).to.be.an('object');
    });

    it('should stop apps monitoring, delete, no apps passed in param', async () => {
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
        {
          name: 'myAppNamev2',
          version: 2,
        },
        {
          name: 'myAppNamev4',
          version: 4,
          compose: [{ name: 'compname1' }, { name: 'compname2' }],
        },
      ];
      dbStub.returns(apps);
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'myAppNamev3',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'myAppNamev2',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'compname1_myAppNamev4',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'compname2_myAppNamev4',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );

      await appMonitoringServiceProxy.stopMonitoringOfApps(undefined, true);

      const appsMonitored = appMonitoringServiceProxy.getAppsMonitored();
      expect(appsMonitored).to.be.empty;
    });

    it('should stop apps monitoring, delete, apps passed in param', async () => {
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
        {
          name: 'myAppNamev2',
          version: 2,
        },
        {
          name: 'myAppNamev4',
          version: 4,
          compose: [{ name: 'compname1' }, { name: 'compname2' }],
        },
      ];
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'myAppNamev3',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'myAppNamev2',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'compname1_myAppNamev4',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,

        },
      );
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'compname2_myAppNamev4',
          oneMinuteInterval: setInterval(() => { }, 60000),
          statsStore: 1000,
        },
      );

      await appMonitoringServiceProxy.stopMonitoringOfApps(apps, true);

      const appsMonitored = appMonitoringServiceProxy.getAppsMonitored();
      expect(appsMonitored).to.be.empty;
    });

    it('should log error if db read fails', async () => {
      dbStub.callsFake(() => { throw new Error('Error'); });

      await appMonitoringServiceProxy.stopMonitoringOfApps();

      sinon.assert.calledTwice(logSpy);
    });
  });

  describe('startAppMonitoringAPI tests', () => {
    let dbStub;
    let logSpy;
    let verificationHelperStub;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      return res;
    };

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
      appMonitoringServiceProxy.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
    });

    it('should return error if user has no appownerabove privileges, appname provided', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appMonitoringServiceProxy.startAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'appownerabove');
      sinon.assert.neverCalledWithMatch(verificationHelperStub, 'adminandfluxteam');
    });

    it('should return error if user has no adminandfluxteam privileges, no appname provided', async () => {
      const req = {
        params: {
          test2: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appMonitoringServiceProxy.startAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'adminandfluxteam');
      sinon.assert.neverCalledWithMatch(verificationHelperStub, 'appownerabove');
    });

    it('should start monitoring of all apps', async () => {
      const req = {
        params: {
          test2: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(true);
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
        {
          name: 'myAppNamev2',
          version: 2,
        },
        {
          name: 'myAppNamev4',
          version: 4,
          compose: [{ name: 'compname1' }, { name: 'compname2' }],
        },
      ];
      dbStub.returns(apps);

      await appMonitoringServiceProxy.startAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Application monitoring started for all apps',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'adminandfluxteam');
    });

    it('should start monitoring of an app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(true);
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
      ];
      dbStub.returns(apps);

      await appMonitoringServiceProxy.startAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Application monitoring started for myAppNamev3',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'appownerabove');
    });
  });

  describe('stopAppMonitoringAPI tests', () => {
    let dbStub;
    let logSpy;
    let verificationHelperStub;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      return res;
    };

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
      appMonitoringServiceProxy.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
    });

    it('should return error if user has no appownerabove privileges, appname provided', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appMonitoringServiceProxy.stopAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'appownerabove');
      sinon.assert.neverCalledWithMatch(verificationHelperStub, 'adminandfluxteam');
    });

    it('should return error if user has no adminandfluxteam privileges, no appname provided', async () => {
      const req = {
        params: {
          test2: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appMonitoringServiceProxy.stopAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'adminandfluxteam');
      sinon.assert.neverCalledWithMatch(verificationHelperStub, 'appownerabove');
    });

    it('should stop monitoring of all apps, deletedata false', async () => {
      const req = {
        params: {
          test2: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(true);
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
        {
          name: 'myAppNamev2',
          version: 2,
        },
        {
          name: 'myAppNamev4',
          version: 4,
          compose: [{ name: 'compname1' }, { name: 'compname2' }],
        },
      ];
      dbStub.returns(apps);

      await appMonitoringServiceProxy.stopAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Application monitoring stopped for all apps. Existing monitoring data maintained.',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'adminandfluxteam');
    });

    it('should stop monitoring of all apps, deletedata true', async () => {
      const req = {
        params: {
          test2: 'test_myappname',
          deletedata: true,
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(true);
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
        {
          name: 'myAppNamev2',
          version: 2,
        },
        {
          name: 'myAppNamev4',
          version: 4,
          compose: [{ name: 'compname1' }, { name: 'compname2' }],
        },
      ];
      dbStub.returns(apps);

      await appMonitoringServiceProxy.stopAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Application monitoring stopped for all apps. Monitoring data deleted for all apps.',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'adminandfluxteam');
    });

    it('should start monitoring of an app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(true);
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
      ];
      dbStub.returns(apps);

      await appMonitoringServiceProxy.stopAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Application monitoring stopped for test_myappname. Existing monitoring data maintained.',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'appownerabove');
    });

    it('should start monitoring of an app, underscore in the name, deletedata true', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
          deletedata: true,
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(true);
      const apps = [
        {
          name: 'myAppNamev3',
          version: 3,
        },
      ];
      dbStub.returns(apps);

      await appMonitoringServiceProxy.stopAppMonitoringAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Application monitoring stopped and monitoring data deleted for test_myappname.',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithMatch(verificationHelperStub, 'appownerabove');
    });
  });

  describe('appChanges tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };
    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();

      await appContainerServiceProxy.appChanges(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });
      sinon.assert.calledOnce(logSpy);
    });

    it('should return error if user has no appowner privileges', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);

      await appContainerServiceProxy.appChanges(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
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
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'dockerContainerChanges').returns('some data');
      const res = generateResponse();

      await appContainerServiceProxy.appChanges(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
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
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'dockerContainerChanges').returns('some data');
      const res = generateResponse();

      await appContainerServiceProxy.appChanges(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
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
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'dockerContainerChanges').callsFake(() => { throw new Error('Error'); });
      const res = generateResponse();

      await appContainerServiceProxy.appChanges(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'Error' },
      });
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
    });
  });

  describe('createFluxNetworkAPI tests', () => {
    let verificationHelperStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    beforeEach(() => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if user has no adminandfluxteam privileges', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      verificationHelperStub.returns(false);
      const dockerStub = sinon.stub(dockerService, 'createFluxDockerNetwork').returns('success');

      await appInstallationServiceProxy.createFluxNetworkAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.notCalled(dockerStub);
    });

    it('should create network api', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'createFluxDockerNetwork').returns('success');
      const res = generateResponse();

      await appInstallationServiceProxy.createFluxNetworkAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'success',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnce(dockerStub);
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
      verificationHelperStub.returns(true);
      const dockerStub = sinon.stub(dockerService, 'createFluxDockerNetwork').callsFake(() => { throw new Error('Error'); });
      const res = generateResponse();

      await appInstallationServiceProxy.createFluxNetworkAPI(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'Error' },
      });
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledOnce(dockerStub);
    });
  });

  describe('appsResources tests', () => {
    let dbStub;
    let nodeTierStub;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      return res;
    };

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      appMonitoringServiceProxy.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      nodeTierStub = sinon.stub(generalService, 'nodeTier');
    });

    afterEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
    });

    it('should return apps resources apps v3, no response passed', async () => {
      nodeTierStub.resolves(true);
      dbStub.returns([
        {
          version: 3, tiered: false, cpu: 1000, ram: 256000, hdd: 100000,
        },
        {
          version: 3, tiered: false, cpu: 1000, ram: 256000, hdd: 100000,
        },
      ]);
      const result = await appMonitoringServiceProxy.appsResources();

      expect(result).to.eql({
        status: 'success',
        data: {
          appsCpusLocked: 2000,
          appsRamLocked: 512000,
          appsHddLocked: 200024,
        },
      });
    });

    it('should return apps resources apps v3, tiered, no response passed', async () => {
      nodeTierStub.resolves('cumulus');
      dbStub.returns([
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
      ]);
      const result = await appMonitoringServiceProxy.appsResources();

      expect(result).to.eql({
        status: 'success',
        data: {
          appsCpusLocked: 4000,
          appsRamLocked: 200000,
          appsHddLocked: 400024,
        },
      });
    });

    it('should return apps resources apps v4, no response passed', async () => {
      nodeTierStub.resolves(true);
      dbStub.returns([
        {
          version: 4,
          compose: [{
            tiered: false, cpu: 1000, ram: 256000, hdd: 100000,
          }, {
            tiered: false, cpu: 1000, ram: 256000, hdd: 100000,
          }],
        },
        {
          version: 4,
          compose: [{
            tiered: false, cpu: 1000, ram: 256000, hdd: 100000,
          }, {
            tiered: false, cpu: 1000, ram: 256000, hdd: 100000,
          }],
        },
      ]);
      const result = await appMonitoringServiceProxy.appsResources();

      expect(result).to.eql({
        status: 'success',
        data: {
          appsCpusLocked: 4000,
          appsRamLocked: 1024000,
          appsHddLocked: 400048,
        },
      });
    });

    it('should return apps resources apps v4, tiered, no response passed', async () => {
      nodeTierStub.resolves('cumulus');
      dbStub.returns([
        {
          version: 4,
          compose: [{
            tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
          }, {
            tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
          }],
        },
        {
          version: 4,
          compose: [{
            tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
          }, {
            tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
          }],
        },
      ]);
      const result = await appMonitoringServiceProxy.appsResources();

      expect(result).to.eql({
        status: 'success',
        data: {
          appsCpusLocked: 8000,
          appsRamLocked: 400000,
          appsHddLocked: 800048,
        },
      });
    });

    it('should return apps resources apps v4, tiered, response passed', async () => {
      nodeTierStub.resolves('cumulus');
      dbStub.returns([
        {
          version: 4,
          compose: [{
            tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
          }, {
            tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
          }],
        },
        {
          version: 4,
          compose: [{
            tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
          }, {
            tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
          }],
        },
      ]);
      const res = generateResponse();

      await appMonitoringServiceProxy.appsResources(undefined, res);

      sinon.assert.calledWithExactly(res.json, {
        status: 'success',
        data: {
          appsCpusLocked: 8000,
          appsRamLocked: 400000,
          appsHddLocked: 800048,
        },
      });
    });

    it('should error if db throws, no response passed', async () => {
      nodeTierStub.resolves('cumulus');
      dbStub.callsFake(() => { throw new Error('Error'); });

      const result = await appMonitoringServiceProxy.appsResources();

      expect(result).to.eql({
        status: 'error',
        data: {
          code: undefined,
          message: 'Error',
          name: 'Error',
        },
      });
    });

    it('should error if db throws, response passed', async () => {
      nodeTierStub.resolves('cumulus');
      dbStub.callsFake(() => { throw new Error('Error'); });
      const res = generateResponse();

      await appMonitoringServiceProxy.appsResources(undefined, res);

      sinon.assert.calledWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          message: 'Error',
          name: 'Error',
        },
      });
    });
  });

  describe('getNodeSpecs tests', () => {
    let osStubCpu;
    let osStubRam;
    let daemonServiceBenchmarkRpcsStub;

    beforeEach(async () => {
      osStubCpu = sinon.stub(os, 'cpus');
      osStubRam = sinon.stub(os, 'totalmem');
      daemonServiceBenchmarkRpcsStub = sinon.stub(daemonServiceBenchmarkRpcs, 'getBenchmarks');
      benchmarkService.setNodeSpecs(0, 0, 0);
    });

    afterEach(() => {
      sinon.restore();
      benchmarkService.setNodeSpecs(0, 0, 0);
    });

    it('Should set node stats properly if they are not alerady set', async () => {
      osStubCpu.returns([1, 1, 1, 1]);
      osStubRam.returns(10 * 1024 * 1024);
      daemonServiceBenchmarkRpcsStub.returns({
        status: 'success',
        data: JSON.stringify({ ssd: 100 }),
      });

      await benchmarkService.getNodeSpecs();

      const nodeStats = benchmarkService.getNodeSpecs();
      expect(nodeStats).to.eql({ cpuCores: 4, ram: 10, ssdStorage: 100 });
    });

    it('Should set node stats properly if they are alerady set', async () => {
      benchmarkService.setNodeSpecs(5, 20, 99);
      osStubCpu.returns([1, 1, 1, 1]);
      osStubRam.returns(10 * 1024 * 1024);
      daemonServiceBenchmarkRpcsStub.returns({
        status: 'success',
        data: JSON.stringify({ ssd: 100 }),
      });

      await benchmarkService.getNodeSpecs();

      const nodeStats = benchmarkService.getNodeSpecs();
      expect(nodeStats).to.eql({ cpuCores: 5, ram: 20, ssdStorage: 99 });
    });
  });

  describe('appUninstallHard tests', async () => {
    let appDockerStopStub;
    let appDockerRemoveStub;
    let appDockerImageRemoveStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      res.write = sinon.fake(() => true);
      return res;
    };

    beforeEach(async () => {
      appMonitoringServiceProxy.clearAppsMonitored();
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'testapp',
          oneMinuteInterval: setInterval(() => { }, 60000),
          fifteenMinInterval: setInterval(() => { }, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appDockerStopStub = sinon.stub(dockerService, 'appDockerStop');
      appDockerRemoveStub = sinon.stub(dockerService, 'appDockerRemove');
      appDockerImageRemoveStub = sinon.stub(dockerService, 'appDockerImageRemove');
    });

    afterEach(() => {
      sinon.restore();
      appMonitoringServiceProxy.clearAppsMonitored();
    });

    it('should hard uninstall app, no ports passed, ', async () => {
      const appName = 'testapp';
      const appId = 1111;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
      };
      const isComponent = false;
      const res = generateResponse();
      appDockerStopStub.resolves(true);
      appDockerRemoveStub.resolves(true);
      appDockerImageRemoveStub.resolves(true);

      await appInstallationServiceProxy.appUninstallHard(appName, appId, appSpecifications, isComponent, res);

      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Stopping Flux App ${appName}...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} stopped` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Removing Flux App ${appName} container...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} container removed` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Removing Flux App ${appName} image...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} image operations done` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Denying Flux App ${appName} ports...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Ports of ${appName} denied` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Unmounting volume of ${appName}...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Volume of ${appName} unmounted` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Cleaning up ${appName} data...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Data of ${appName} cleaned` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Adjusting crontab...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Crontab Adjusted.' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Cleaning up data volume of testapp...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Volume of testapp cleaned' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp was successfuly removed' }));
    });

    it('should hard uninstall app ports passed', async () => {
      const appName = 'testapp';
      const appId = 2222;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
        port: 111,
      };
      const isComponent = false;
      const res = generateResponse();
      appDockerStopStub.resolves(true);
      appDockerRemoveStub.resolves(true);
      appDockerImageRemoveStub.resolves(true);

      await appInstallationServiceProxy.appUninstallHard(appName, appId, appSpecifications, isComponent, res);

      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Stopping Flux App ${appName}...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} stopped` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Removing Flux App ${appName} container...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} container removed` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Removing Flux App ${appName} image...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} image operations done` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Denying Flux App ${appName} ports...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Ports of ${appName} denied` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Unmounting volume of ${appName}...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Volume of ${appName} unmounted` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Cleaning up ${appName} data...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Data of ${appName} cleaned` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Adjusting crontab...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Crontab Adjusted.' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Cleaning up data volume of testapp...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Volume of testapp cleaned' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp was successfuly removed' }));
    });
  });

  describe('removeAppLocally tests', () => {
    let dbStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      res.write = sinon.fake(() => true);
      return res;
    };

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      appMonitoringServiceProxy.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findOneInDatabase');
    });

    afterEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
    });

    it('should throw error if app name is not specified', async () => {
      const res = generateResponse();

      await appInstallationServiceProxy.removeAppLocally(undefined, res);

      sinon.assert.calledOnceWithExactly(res.write, JSON.stringify({ status: 'error', data: { name: 'Error', message: 'No App specified' } }));
      sinon.assert.calledOnce(res.end);
    });

    it('remove app locally, app name is specified, app in the list of avaiable apps', async () => {
      const res = generateResponse();
      const appName = 'FoldingAtHomeB';
      dbStub.returns(undefined);
      const force = true;

      await appInstallationServiceProxy.removeAppLocally(appName, res, force);

      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Removing Flux App FoldingAtHomeB container...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App FoldingAtHomeB container removed' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Cleaning up FoldingAtHomeB data...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App FoldingAtHomeB was successfuly removed' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'success', data: { message: 'Removal step done. Result: Flux App FoldingAtHomeB was successfuly removed' } }));
      sinon.assert.calledOnce(res.end);
    });

    it('remove app locally,  if app name is specified, app in DB', async () => {
      const res = generateResponse();
      const appName = 'testapp';
      dbStub.returns({ // app specifications
        version: 2,
        name: 'testapp',
        description: 'testapp',
        repotag: 'yurinnick/testapp',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        tiered: true,
        ports: [30000],
        containerPorts: [7396],
        domains: [''],
        cpu: 0.5,
        ram: 500,
        hdd: 5,
        cpubasic: 0.5,
        cpusuper: 1,
        cpubamf: 2,
        rambasic: 500,
        ramsuper: 500,
        rambamf: 500,
        hddbasic: 5,
        hddsuper: 5,
        hddbamf: 5,
        enviromentParameters: ['TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
        commands: [],
        containerData: '/config',
        hash: 'localappinstancehashABCDEF', // hash of app message
        height: 0, // height of tx on which it was
      });
      const force = true;

      await appInstallationServiceProxy.removeAppLocally(appName, res, force);

      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Removing Flux App testapp container...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp container removed' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Cleaning up testapp data...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp was successfuly removed' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'success', data: { message: 'Removal step done. Result: Flux App testapp was successfuly removed' } }));
      sinon.assert.calledOnce(res.end);
    });
  });

  describe('appUninstallSoft tests', async () => {
    let appDockerStopStub;
    let appDockerRemoveStub;
    let appDockerImageRemoveStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      res.write = sinon.fake(() => true);
      return res;
    };

    beforeEach(async () => {
      appMonitoringServiceProxy.clearAppsMonitored();
      appMonitoringServiceProxy.setAppsMonitored(
        {
          appName: 'testapp',
          oneMinuteInterval: setInterval(() => { }, 60000),
          fifteenMinInterval: setInterval(() => { }, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appDockerStopStub = sinon.stub(dockerService, 'appDockerStop');
      appDockerRemoveStub = sinon.stub(dockerService, 'appDockerRemove');
      appDockerImageRemoveStub = sinon.stub(dockerService, 'appDockerImageRemove');
    });

    afterEach(() => {
      sinon.restore();
      appMonitoringServiceProxy.clearAppsMonitored();
    });

    it('should hard uninstall app, no ports passed, ', async () => {
      const appName = 'testapp';
      const appId = 1111;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
      };
      const isComponent = false;
      const res = generateResponse();
      appDockerStopStub.resolves(true);
      appDockerRemoveStub.resolves(true);
      appDockerImageRemoveStub.resolves(true);

      await appInstallationServiceProxy.appUninstallSoft(appName, appId, appSpecifications, isComponent, res);

      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Stopping Flux App ${appName}...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} stopped` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Removing Flux App ${appName} container...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} container removed` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Removing Flux App ${appName} image...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} image operations done` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Denying Flux App ${appName} ports...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Ports of ${appName} denied` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: `Unmounting volume of ${appName}...` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: `Volume of ${appName} unmounted` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: `Cleaning up ${appName} data...` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: `Data of ${appName} cleaned` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: 'Adjusting crontab...' }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: 'Crontab Adjusted.' }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: 'Cleaning up data volume of testapp...' }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: 'Volume of testapp cleaned' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp was successfuly removed' }));
    });

    it('should hard uninstall app ports passed', async () => {
      const appName = 'testapp';
      const appId = 2222;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
        port: 111,
      };
      const isComponent = false;
      const res = generateResponse();
      appDockerStopStub.resolves(true);
      appDockerRemoveStub.resolves(true);
      appDockerImageRemoveStub.resolves(true);

      await appInstallationServiceProxy.appUninstallSoft(appName, appId, appSpecifications, isComponent, res);

      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Stopping Flux App ${appName}...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} stopped` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Removing Flux App ${appName} container...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} container removed` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Removing Flux App ${appName} image...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Flux App ${appName} image operations done` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Denying Flux App ${appName} ports...` }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: `Ports of ${appName} denied` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: `Unmounting volume of ${appName}...` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: `Volume of ${appName} unmounted` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: `Cleaning up ${appName} data...` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: `Data of ${appName} cleaned` }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: 'Adjusting crontab...' }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: 'Crontab Adjusted.' }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: 'Cleaning up data volume of testapp...' }));
      sinon.assert.neverCalledWith(res.write, JSON.stringify({ status: 'Volume of testapp cleaned' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp was successfuly removed' }));
    });
  });

  describe('softRemoveAppLocally tests', () => {
    let dbStub;
    let dockerServiceStub;
    let appDockerStopStub;
    let appDockerRemoveStub;
    let appDockerImageRemoveStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      res.write = sinon.fake(() => true);
      return res;
    };

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      appMonitoringServiceProxy.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findOneInDatabase');
      dockerServiceStub = sinon.stub(dockerService, 'getAppIdentifier');
      appDockerStopStub = sinon.stub(dockerService, 'appDockerStop');
      appDockerRemoveStub = sinon.stub(dockerService, 'appDockerRemove');
      appDockerImageRemoveStub = sinon.stub(dockerService, 'appDockerImageRemove');
    });

    afterEach(async () => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
      appProgressState.removalInProgress = false;
    });

    it('should throw error if app name is not specified', async () => {
      const res = generateResponse();

      await expect(appInstallationServiceProxy.softRemoveAppLocally(undefined, res)).to.eventually.be.rejectedWith('No Flux App specified');
    });

    it('return error, no app in db', async () => {
      const res = generateResponse();
      const appName = 'testapp';
      dbStub.returns(undefined);

      await expect(appInstallationServiceProxy.softRemoveAppLocally(appName, res)).to.eventually.be.rejectedWith('Flux App not found');
    });

    it('should soft remove app locally, app name is specified, app in DB', async () => {
      const res = generateResponse();
      const appName = 'testapp';
      dockerServiceStub.returns(100);
      appDockerStopStub.resolves(true);
      appDockerRemoveStub.resolves(true);
      appDockerImageRemoveStub.resolves(true);
      dbStub.returns({ // app specifications
        version: 2,
        name: 'testapp',
        description: 'testapp',
        repotag: 'yurinnick/testapp',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        tiered: true,
        ports: [30000],
        containerPorts: [7396],
        domains: [''],
        cpu: 0.5,
        ram: 500,
        hdd: 5,
        cpubasic: 0.5,
        cpusuper: 1,
        cpubamf: 2,
        rambasic: 500,
        ramsuper: 500,
        rambamf: 500,
        hddbasic: 5,
        hddsuper: 5,
        hddbamf: 5,
        enviromentParameters: ['TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
        commands: [],
        containerData: '/config',
        hash: 'localappinstancehashABCDEF', // hash of app message
        height: 0, // height of tx on which it was
      });

      await appInstallationServiceProxy.softRemoveAppLocally(appName, res);

      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Stopping Flux App testapp...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp stopped' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Removing Flux App testapp container...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp container removed' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'success', data: { message: 'Removal step done. Result: Flux App testapp was partially removed' } }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Database cleaned' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Cleaning up database...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'success', data: { message: 'Removal step done. Result: Flux App testapp was partially removed' } }));
    });
  });

  describe('removeAppLocallyApi tests', () => {
    let dbStub;
    let verificationHelperStub;
    let dockerStopStub;
    let dockerRemoveStub;
    let dockerInspectStub;
    let dockerImageRemoveStub;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      res.write = sinon.fake(() => true);
      res.setHeader = sinon.fake(() => true);
      return res;
    };

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      appMonitoringServiceProxy.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findOneInDatabase');
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      
      // Set up Docker stubs
      dockerStopStub = sinon.stub(dockerService, 'appDockerStop').resolves(true);
      dockerRemoveStub = sinon.stub(dockerService, 'appDockerRemove').resolves(true);
      dockerInspectStub = sinon.stub(dockerService, 'dockerContainerInspect').resolves([{ Id: 'container123', Image: 'yurinnick/testapp:latest' }]);
      dockerImageRemoveStub = sinon.stub(dockerService, 'appDockerImageRemove').resolves(true);
      
      // Set up dependencies for appInstallationService
      appInstallationServiceProxy.setDependencies({
        appsResources: sinon.stub().returns({ status: 'success', data: { appsHddLocked: 0, appsCpusLocked: 0, appsRamLocked: 0 } }),
        getNodeSpecs: async () => {
          // Get the specs from benchmarkService and return them
          const specs = benchmarkService.getNodeSpecs();
          return specs;
        },
        installedApps: appFileServiceProxy.installedApps,
        listRunningApps: appContainerServiceProxy.listRunningApps,
        checkApplicationImagesComplience: sinon.stub().returns(true),
        specificationFormatter: sinon.stub().returns({}),
        checkAndDecryptAppSpecs: sinon.stub().returns({
          version: 2,
          name: 'testapp',
          repotag: 'yurinnick/testapp'
        }),
        storeAppInstallingErrorMessage: sinon.stub(),
        storeAppRunningMessage: sinon.stub(),
        startAppMonitoring: sinon.stub(),
      });
    });

    afterEach(() => {
      appMonitoringServiceProxy.clearAppsMonitored();
      sinon.restore();
    });

    it('should return error if app name includes underscore, name passed in params', async () => {
      const res = generateResponse();
      const appName = 'test_app';
      const req = {
        params: {
          appname: appName,
        },
        query: {
          test: 'test',
        },
      };

      await appInstallationServiceProxy.removeAppLocallyApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Components cannot be removed manually',
        },
      });
    });

    it('should return error if app name includes underscore, name passed in query', async () => {
      const res = generateResponse();
      const appName = 'test_app';
      const req = {
        query: {
          appname: appName,
        },
        params: {
          test: 'test',
        },
      };

      await appInstallationServiceProxy.removeAppLocallyApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Components cannot be removed manually',
        },
      });
    });

    it('should return error if privilege is not appownerorabove', async () => {
      verificationHelperStub.returns(false);
      const res = generateResponse();
      const appName = 'testapp';
      const req = {
        query: {
          appname: appName,
        },
        params: {
          test: 'test',
        },
      };

      await appInstallationServiceProxy.removeAppLocallyApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('remove app locally, if all parameters are valid', async () => {
      verificationHelperStub.returns(true);
      const res = generateResponse();
      const appName = 'testapp';
      const req = {
        query: {
          appname: appName,
          force: true,
        },
        params: {
          test: 'test',
        },
      };
      dbStub.returns({ // app specifications
        version: 2,
        name: 'testapp',
        description: 'testapp',
        repotag: 'yurinnick/testapp',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        tiered: true,
        ports: [30000],
        containerPorts: [7396],
        domains: [''],
        cpu: 0.5,
        ram: 500,
        hdd: 5,
        cpubasic: 0.5,
        cpusuper: 1,
        cpubamf: 2,
        rambasic: 500,
        ramsuper: 500,
        rambamf: 500,
        hddbasic: 5,
        hddsuper: 5,
        hddbamf: 5,
        enviromentParameters: ['TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
        commands: [],
        containerData: '/config',
        hash: 'localappinstancehashABCDEF', // hash of app message
        height: 0, // height of tx on which it was
      });

      await appInstallationServiceProxy.removeAppLocallyApi(req, res);

      await serviceHelper.delay(500);
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Stopping Flux App testapp...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp stopped' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Removing Flux App testapp container...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Flux App testapp container removed' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'Cleaning up database...' }));
      sinon.assert.calledWith(res.write, JSON.stringify({ status: 'success', data: { message: 'Removal step done. Result: Flux App testapp was successfuly removed' } }));
      sinon.assert.calledOnce(res.end);
    });
  });

  describe('totalAppHWRequirements tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should return hw requirements for an app, version 3', () => {
      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 3,
      };
      const myNodeTier = 'stratus';

      const result = appInstallationServiceProxy.totalAppHWRequirements(appSpecs, myNodeTier);

      expect(result).to.eql({ cpu: 256000, ram: 50, hdd: 100 });
    });

    it('should return hw requirements for an app, version 2', () => {
      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 2,
      };
      const myNodeTier = 'stratus';

      const result = appInstallationServiceProxy.totalAppHWRequirements(appSpecs, myNodeTier);

      expect(result).to.eql({ cpu: 256000, ram: 50, hdd: 100 });
    });

    it('should return hw requirements for an app, version 4', () => {
      const appSpecs = {
        version: 4,
        compose: [{
          tiered: false,
          cpu: 256000,
          hdd: 100,
          ram: 50,
        }, {
          tiered: true,
          cpu: 256000,
          hdd: 100,
          ram: 50,
        }, {
          tiered: true,
          cpu: 256000,
          hdd: 100,
          ram: 50,
        }],

      };
      const myNodeTier = 'stratus';

      const result = appInstallationServiceProxy.totalAppHWRequirements(appSpecs, myNodeTier);

      expect(result).to.eql({ cpu: 768000, ram: 150, hdd: 300 });
    });
  });

  describe('nodeFullGeolocation tests', () => {
    let geolocationServiceStub;

    beforeEach(() => {
      geolocationServiceStub = sinon.stub(geolocationService, 'getNodeGeolocation');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw if geolocation returns undefined', () => {
      geolocationServiceStub.returns(undefined);

      // eslint-disable-next-line func-names
      const result = function () { geolocationService.nodeFullGeolocation(); };
      expect(result).to.throw();
      sinon.assert.calledOnce(geolocationServiceStub);
    });

    it('should return proper geolocation data', () => {
      geolocationServiceStub.returns({
        continentCode: 2,
        countryCode: 'US',
        regionName: 'PA',
      });

      const result = geolocationService.nodeFullGeolocation();

      sinon.assert.calledOnce(geolocationServiceStub);
      expect(result).to.eql('2_US_PA');
    });
  });

  describe('checkAppGeolocationRequirements tests', () => {
    let geolocationServiceStub;

    beforeEach(() => {
      geolocationServiceStub = sinon.stub(geolocationService, 'getNodeGeolocation');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw if geolocation returns undefined', () => {
      geolocationServiceStub.returns(undefined);
      const appSpec = {
        version: 5,
        geolocation: ['acEU'],
      };

      // eslint-disable-next-line func-names
      const result = function () { appInstallationServiceProxy.checkAppGeolocationRequirements(appSpec); };
      expect(result).to.throw();
      sinon.assert.calledOnce(geolocationServiceStub);
    });

    it('should return true if app ver < 5', () => {
      const appSpec = {
        version: 4,
      };

      const result = appInstallationServiceProxy.checkAppGeolocationRequirements(appSpec);

      expect(result).to.equal(true);
    });

    it('should return true if gelocation matches', () => {
      geolocationServiceStub.returns({
        continentCode: 'EU',
        countryCode: 'CZ',
        regionName: 'PRG',
      });
      const appSpec = {
        version: 5,
        geolocation: ['acEU_CZ_PRG'],
      };

      const result = appInstallationServiceProxy.checkAppGeolocationRequirements(appSpec);

      sinon.assert.calledOnce(geolocationServiceStub);
      expect(result).to.eql(true);
    });

    it('should throw if geolocation is forbidden', () => {
      geolocationServiceStub.returns({
        continentCode: 'EU',
        countryCode: 'CZ',
        regionName: 'PRG',
      });
      const appSpec = {
        version: 5,
        geolocation: ['a!cEU_CZ_PRG'],
      };

      // eslint-disable-next-line func-names
      const result = function () { appInstallationServiceProxy.checkAppGeolocationRequirements(appSpec); };
      expect(result).to.throw();
      sinon.assert.calledOnce(geolocationServiceStub);
    });

    it('should throw if geolocation is not matching', () => {
      geolocationServiceStub.returns({
        continentCode: 'EU',
        countryCode: 'CZ',
        regionName: 'PRG',
      });
      const appSpec = {
        version: 5,
        geolocation: ['acEU_PL_GDA'],
      };

      // eslint-disable-next-line func-names
      const result = function () { appInstallationServiceProxy.checkAppGeolocationRequirements(appSpec); };
      expect(result).to.throw();
      sinon.assert.calledOnce(geolocationServiceStub);
    });
  });

  describe('checkAppHWRequirements tests', () => {
    let getNodeTierStub;
    let dbStub;

    beforeEach(async () => {
      getNodeTierStub = sinon.stub(generalService, 'nodeTier');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      appMonitoringServiceProxy.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      
      // Set up dependencies for appInstallationService
      appInstallationServiceProxy.setDependencies({
        appsResources: sinon.stub().returns({ status: 'success', data: { appsHddLocked: 0, appsCpusLocked: 0, appsRamLocked: 0 } }),
        getNodeSpecs: async () => {
          // Get the specs from benchmarkService and return them
          // The appInstallationService should use these values directly
          const specs = benchmarkService.getNodeSpecs();
          return specs;
        },
        installedApps: appFileServiceProxy.installedApps,
        listRunningApps: appContainerServiceProxy.listRunningApps,
        checkApplicationImagesComplience: sinon.stub().returns(true),
        specificationFormatter: sinon.stub().returns({}),
        checkAndDecryptAppSpecs: sinon.stub().returns({}),
        storeAppInstallingErrorMessage: sinon.stub(),
        storeAppRunningMessage: sinon.stub(),
        startAppMonitoring: sinon.stub(),
      });
    });

    afterEach(() => {
      sinon.restore();
      benchmarkService.setNodeSpecs(0, 0, 0);
    });

    it('should throw error if resourcesLocked fails', async () => {
      getNodeTierStub.resolves('cumulus');
      dbStub.returns(false);
      
      // Override the appsResources dependency to return failure
      appInstallationServiceProxy.setDependencies({
        appsResources: sinon.stub().returns({ status: 'error', data: 'Failed to get resources' }),
        getNodeSpecs: async () => {
          const specs = benchmarkService.getNodeSpecs();
          return specs;
        },
        installedApps: appFileServiceProxy.installedApps,
        listRunningApps: appContainerServiceProxy.listRunningApps,
        checkApplicationImagesComplience: sinon.stub().returns(true),
        specificationFormatter: sinon.stub().returns({}),
        checkAndDecryptAppSpecs: sinon.stub().returns({}),
        storeAppInstallingErrorMessage: sinon.stub(),
        storeAppRunningMessage: sinon.stub(),
        startAppMonitoring: sinon.stub(),
      });

      await expect(appInstallationServiceProxy.checkAppHWRequirements()).to.eventually.be.rejectedWith('Unable to obtain locked system resources by Flux Apps. Aborting');
    });

    it('should throw error if there would be insufficient space on node for the app - 0 on the node', async () => {
      getNodeTierStub.resolves('cumulus');
      dbStub.returns([
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
      ]);
      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 3,
      };
      benchmarkService.setNodeSpecs(0, 0, 0);

      await expect(appInstallationServiceProxy.checkAppHWRequirements(appSpecs)).to.eventually.be.rejectedWith('Insufficient space on Flux Node to spawn an application');
    });

    it('should throw error if there would be insufficient space on node for the app', async () => {
      getNodeTierStub.resolves('cumulus');
      dbStub.returns([
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
      ]);
      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 3,
      };
      benchmarkService.setNodeSpecs(10, 20, 90);

      await expect(appInstallationServiceProxy.checkAppHWRequirements(appSpecs)).to.eventually.be.rejectedWith('Insufficient space on Flux Node to spawn an application');
    });

    it('should throw error if there would be insufficient cpu power on node for the app', async () => {
      getNodeTierStub.resolves('cumulus');
      dbStub.returns([
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
      ]);
      const appSpecs = {
        cpu: 256000,
        hdd: 100,
        ram: 50,
        version: 3,
      };
      benchmarkService.setNodeSpecs(10, 20, 2000000);

      await expect(appInstallationServiceProxy.checkAppHWRequirements(appSpecs)).to.eventually.be.rejectedWith('Insufficient CPU power on Flux Node to spawn an application');
    });

    it('should throw error if there would be insufficient ram on node for the app', async () => {
      getNodeTierStub.resolves('cumulus');
      dbStub.returns([
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
      ]);
      const appSpecs = {
        cpu: 4000,
        hdd: 100,
        ram: 50,
        version: 3,
      };
      benchmarkService.setNodeSpecs(10000, 50, 2000000);

      await expect(appInstallationServiceProxy.checkAppHWRequirements(appSpecs)).to.eventually.be.rejectedWith('Insufficient RAM on Flux Node to spawn an application');
    });

    it('should return true if all reqs are met', async () => {
      getNodeTierStub.resolves('cumulus');
      dbStub.returns([
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
        {
          version: 3, tiered: true, cpu: 1000, ram: 256000, hdd: 100000, cpucumulus: 2000, ramcumulus: 100000, hddcumulus: 200000,
        },
      ]);
      const appSpecs = {
        cpu: 4000,
        hdd: 100,
        ram: 50,
        version: 3,
      };
      benchmarkService.setNodeSpecs(10000, 256000, 2000000);

      const result = await appInstallationServiceProxy.checkAppHWRequirements(appSpecs);

      expect(result).to.eql(true);
    });
  });

  describe('registerAppLocally tests', () => {
    const appSpec = {
      // app specifications
      version: 2,
      name: 'testapp',
      description: 'testapp',
      repotag: 'yurinnick/testapp',
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      tiered: true,
      ports: [30000],
      containerPorts: [7396],
      domains: [''],
      cpu: 0.5,
      ram: 500,
      hdd: 5,
      cpubasic: 0.5,
      cpusuper: 1,
      cpubamf: 2,
      rambasic: 500,
      ramsuper: 500,
      rambamf: 500,
      hddbasic: 5,
      hddsuper: 5,
      hddbamf: 5,
      enviromentParameters: ['TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
      commands: [],
      containerData: '/config',
      hash: 'localappinstancehashABCDEF', // hash of app message
      height: 0, // height of tx on which it was
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      res.end = sinon.fake(() => true);
      res.write = sinon.fake(() => true);
      return res;
    };
    let logSpy;
    let nodeTierStub;
    let dbStub;

    beforeEach(async () => {
      appProgressState.removalInProgress = false;
      appProgressState.installationInProgress = false;
      logSpy = sinon.spy(log, 'error');
      nodeTierStub = sinon.stub(generalService, 'nodeTier');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      
      // Set up dependencies for appInstallationService
      appInstallationServiceProxy.setDependencies({
        appsResources: sinon.stub().returns([]),
        getNodeSpecs: async () => {
          // Get the specs from benchmarkService and return them
          // The appInstallationService should use these values directly
          const specs = benchmarkService.getNodeSpecs();
          return specs;
        },
        installedApps: appFileServiceProxy.installedApps,
        listRunningApps: appContainerServiceProxy.listRunningApps,
        checkApplicationImagesComplience: sinon.stub().returns(true),
        specificationFormatter: sinon.stub().returns({}),
        checkAndDecryptAppSpecs: sinon.stub().returns({}),
        storeAppInstallingErrorMessage: sinon.stub(),
        storeAppRunningMessage: sinon.stub(),
        startAppMonitoring: sinon.stub(),
      });
    });

    afterEach(() => {
      sinon.restore();
      appProgressState.removalInProgress = false;
      appProgressState.installationInProgress = false;
    });

    it('should return error if removal is in progress', async () => {
      const componentSpecs = false;
      const res = generateResponse();
      appProgressState.removalInProgress = true;

      await appInstallationServiceProxy.registerAppLocally(appSpec, componentSpecs, res);

      sinon.assert.calledOnceWithExactly(logSpy, {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'Another application is undergoing removal. Installation not possible.',
        },
      });
    });

    it('should return error if another installation is in progress', async () => {
      const componentSpecs = false;
      const res = generateResponse();
      appProgressState.installationInProgress = true;

      await appInstallationServiceProxy.registerAppLocally(appSpec, componentSpecs, res);

      sinon.assert.calledOnceWithExactly(logSpy, {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'Another application is undergoing installation. Installation not possible',
        },
      });
    });

    it('should return false if node tier does not return anything', async () => {
      const componentSpecs = false;
      const res = generateResponse();
      nodeTierStub.resolves(undefined);

      const result = await appInstallationServiceProxy.registerAppLocally(appSpec, componentSpecs, res);

      sinon.assert.calledOnceWithExactly(res.write, JSON.stringify({
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'Failed to get Node Tier',
        },
      }));
      expect(result).to.eql(false);
    });

    it('should return false if app already installed', async () => {
      const componentSpecs = false;
      const res = generateResponse();
      nodeTierStub.resolves('cumulus');
      const dbStubOne = sinon.stub(dbHelper, 'findOneInDatabase');
      dbStubOne.returns('testapp');

      const getBenchmarksStub = sinon.stub(benchmarkService, 'getBenchmarks');
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: ip },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);

      const result = await appInstallationServiceProxy.registerAppLocally(appSpec, componentSpecs, res);

      sinon.assert.calledOnceWithExactly(logSpy, {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'Flux App testapp already installed',
        },
      });
      sinon.assert.calledWithExactly(res.write, {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'Flux App testapp already installed',
        },
      });

      expect(result).to.eql(false);
    });

    it.skip('should install app if v < 4', async () => {
      const componentSpecs = {
        // app specifications
        version: 2,
        name: 'testappname',
        description: 'testapp',
        repotag: 'yurinnick/testapp',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        tiered: true,
        ports: [30000],
        containerPorts: [7396],
        domains: [''],
        cpu: 0.5,
        ram: 500,
        hdd: 5,
        cpubasic: 0.5,
        cpusuper: 1,
        cpubamf: 2,
        rambasic: 500,
        ramsuper: 500,
        rambamf: 500,
        hddbasic: 5,
        hddsuper: 5,
        hddbamf: 5,
        enviromentParameters: ['TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
        commands: [],
        containerData: '/config',
        hash: 'localappinstancehashABCDEF', // hash of app message
        height: 0, // height of tx on which it was
      };
      const res = generateResponse();
      nodeTierStub.resolves('cumulus');
      dbStub.returns('test_appname');

      await appInstallationServiceProxy.registerAppLocally(appSpec, componentSpecs, res);

      sinon.assert.calledOnceWithExactly(logSpy, 'Flux App testapp already installed');
      sinon.assert.calledWithExactly(res.write, 'Flux App testapp already installed');
    });
  });
});
