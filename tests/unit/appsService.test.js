const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const dockerService = require('../../ZelBack/src/services/dockerService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const log = require('../../ZelBack/src/lib/log');

const { expect } = chai;
const fakeFunc = sinon.fake(() => true);
const utilFake = {
  promisify: sinon.fake(() => fakeFunc),
};
const appsService = proxyquire('../../ZelBack/src/services/appsService', { util: utilFake });

describe.only('appsService tests', () => {
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

      await appsService.installedApps(req, res);

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

      const result = await appsService.installedApps(req);

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

      await appsService.installedApps(req, res);

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

      await appsService.installedApps(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { app1: 'info', app2: 'info2' } });
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'zelappsinformation', {}, { projection: { _id: 0 } });
    });

    it('should return error, if error is thrown, response passed', async () => {
      dbStub.throws('error!');
      const res = generateResponse();
      const req = 'appName';

      await appsService.installedApps(req, res);

      sinon.assert.calledOnce(res.json);
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledWithMatch(dbStub, sinon.match.object, 'zelappsinformation', {}, { projection: { _id: 0 } });
    });

    it('should return error, if error is thrown, no response passed', async () => {
      dbStub.throws('error!');
      const req = 'appName';

      const result = await appsService.installedApps(req);

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
        Names: ['1zeltest'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testparam',
        testparam2: 'testparam02',
      },
      {
        Names: ['1fluxtest'],
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
      dockerServiceStub.throws();

      const result = await appsService.listRunningApps();

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
      dockerServiceStub.throws();

      await appsService.listRunningApps(undefined, res);

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

      const result = await appsService.listRunningApps();

      expect(result).to.eql({
        status: 'success',
        data: [
          {
            Names: [
              '1zeltest',
            ],
            testparam1: 'testparam',
            testparam2: 'testparam02',
          },
          {
            Names: [
              '1fluxtest',
            ],
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

      await appsService.listRunningApps(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: [
          {
            Names: [
              '1zeltest',
            ],
            testparam1: 'testparam',
            testparam2: 'testparam02',
          },
          {
            Names: [
              '1fluxtest',
            ],
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
        Names: ['1zeltest'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testparam',
        testparam2: 'testparam02',
      },
      {
        Names: ['1fluxtest'],
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
      dockerServiceStub.throws();

      const result = await appsService.listAllApps();

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
      dockerServiceStub.throws();

      await appsService.listAllApps(undefined, res);

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

      const result = await appsService.listAllApps();

      expect(result).to.eql({
        status: 'success',
        data: [
          {
            Names: [
              '1zeltest',
            ],
            testparam1: 'testparam',
            testparam2: 'testparam02',
          },
          {
            Names: [
              '1fluxtest',
            ],
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

      await appsService.listAllApps(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: [
          {
            Names: [
              '1zeltest',
            ],
            testparam1: 'testparam',
            testparam2: 'testparam02',
          },
          {
            Names: [
              '1fluxtest',
            ],
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
    let logSpy;
    const apps = [
      {
        Names: ['1zeltest'],
        HostConfig: 'someconfig',
        NetworkSettings: 'mySettings',
        Mounts: 'mount1',
        testparam1: 'testparam',
        testparam2: 'testparam02',
      },
      {
        Names: ['1fluxtest'],
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
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if dockerService throws, no response passed', async () => {
      dockerServiceStub.throws();

      const result = await appsService.listAppsImages();

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
      dockerServiceStub.throws();

      await appsService.listAppsImages(undefined, res);

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

      const result = await appsService.listAppsImages();

      expect(result).to.eql({
        status: 'success',
        data: apps,
      });
      sinon.assert.notCalled(logSpy);
    });

    it('should return running apps, response passed', async () => {
      dockerServiceStub.returns(apps);
      const res = generateResponse();

      await appsService.listAppsImages(undefined, res);

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

      await appsService.appStart(req, res);

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

      const result = await appsService.appStart(req);

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

      await appsService.appStart(req, res);

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

      const result = await appsService.appStart(req);

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

      const result = await appsService.appStart(req);

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

      const result = await appsService.appStart(req);

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

      const result = await appsService.appStart(req);

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

      const result = await appsService.appStart(req);

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

      const result = await appsService.appStart(req);

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

      await appsService.appStop(req, res);

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

      const result = await appsService.appStop(req);

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

      await appsService.appStop(req, res);

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

      const result = await appsService.appStop(req);

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

      const result = await appsService.appStop(req);

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

      const result = await appsService.appStop(req);

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

      const result = await appsService.appStop(req);

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

      const result = await appsService.appStop(req);

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

      const result = await appsService.appStop(req);

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

      await appsService.appRestart(req, res);

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

      const result = await appsService.appRestart(req);

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

      await appsService.appRestart(req, res);

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

      const result = await appsService.appRestart(req);

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

      const result = await appsService.appRestart(req);

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

      const result = await appsService.appRestart(req);

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

      const result = await appsService.appRestart(req);

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

      const result = await appsService.appRestart(req);

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

      const result = await appsService.appRestart(req);

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

      await appsService.appKill(req, res);

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

      const result = await appsService.appKill(req);

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

      await appsService.appKill(req, res);

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

      const result = await appsService.appKill(req);

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

      const result = await appsService.appKill(req);

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

      const result = await appsService.appKill(req);

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

      const result = await appsService.appKill(req);

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

      const result = await appsService.appKill(req);

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

      const result = await appsService.appKill(req);

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

      await appsService.appPause(req, res);

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

      const result = await appsService.appPause(req);

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

      await appsService.appPause(req, res);

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

      const result = await appsService.appPause(req);

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

      const result = await appsService.appPause(req);

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

      const result = await appsService.appPause(req);

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

      const result = await appsService.appPause(req);

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

      const result = await appsService.appPause(req);

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

      const result = await appsService.appPause(req);

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

      await appsService.appUnpause(req, res);

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

      const result = await appsService.appUnpause(req);

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

      await appsService.appUnpause(req, res);

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

      const result = await appsService.appUnpause(req);

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

      const result = await appsService.appUnpause(req);

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

      const result = await appsService.appUnpause(req);

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

      const result = await appsService.appUnpause(req);

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

      const result = await appsService.appUnpause(req);

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

      const result = await appsService.appUnpause(req);

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

      await appsService.appTop(req, res);

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

      const result = await appsService.appTop(req);

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

      await appsService.appTop(req, res);

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

      const result = await appsService.appTop(req);

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

      const result = await appsService.appTop(req);

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

      const result = await appsService.appTop(req);

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

      await appsService.appLog(req, res);

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

      await appsService.appTop(req, res);

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
      const res = generateResponse();

      await appsService.appLog(req, res);

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
      const res = generateResponse();

      await appsService.appLog(req, res);

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
      const res = generateResponse();

      await appsService.appLog(req, res);

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

      await appsService.appInspect(req, res);

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

      await appsService.appInspect(req, res);

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

      await appsService.appInspect(req, res);

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

      await appsService.appInspect(req, res);

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

      await appsService.appStats(req, res);

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

      await appsService.appStats(req, res);

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
      const dockerStub = sinon.stub(dockerService, 'dockerContainerStats').returns('some data');
      const res = generateResponse();

      await appsService.appStats(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'test_myappname');
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
      const dockerStub = sinon.stub(dockerService, 'dockerContainerStats').returns('some data');
      const res = generateResponse();

      await appsService.appStats(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: 'some data',
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledOnceWithExactly(dockerStub, 'myappname');
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
      appsService.clearAppsMonitored();
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

      await appsService.appMonitor(req, res);

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

      await appsService.appMonitor(req, res);

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
      appsService.setAppsMonitored(
        {
          appName: 'test_myappname',
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );

      await appsService.appMonitor(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { lastHour: 1000, lastDay: 100000 } });
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
      appsService.setAppsMonitored(
        {
          appName: 'myappname',
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );

      await appsService.appMonitor(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { lastHour: 1000, lastDay: 100000 } });
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

      await appsService.appMonitor(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'No data available' },
      });
      sinon.assert.calledOnce(logSpy);
    });
  });

  describe.only('appMonitorStream tests', () => {
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
      appsService.clearAppsMonitored();
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

      await appsService.appMonitorStream(req, res);

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

      await appsService.appMonitorStream(req, res);

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

    it.only('should return app monitor data, underscore in the name', async () => {
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
      appsService.setAppsMonitored(
        {
          appName: 'test_myappname',
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );

      await appsService.appMonitorStream(req, res);

      sinon.assert.calledOnce(res.end);
      sinon.assert.calledOnceWithExactly(fakeFunc, { status: 'success', data: { lastHour: 1000, lastDay: 100000 } });
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
      appsService.setAppsMonitored(
        {
          appName: 'myappname',
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );

      await appsService.appMonitorStream(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { lastHour: 1000, lastDay: 100000 } });
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

      await appsService.appMonitorStream(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'No data available' },
      });
      sinon.assert.calledOnce(logSpy);
    });
  });
});

// TODO appLogStream
