const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const path = require('path');
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

      await appsService.appMonitorStream(req, res);

      sinon.assert.calledOnce(res.end);
      sinon.assert.calledWithExactly(fakeFunc,
        'test_myappname',
        {
          params: { appname: 'test_myappname', lines: [10, 11, 12] },
          query: { test2: 'test2' },
        }, res);
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

      await appsService.appMonitorStream(req, res);

      sinon.assert.calledOnce(res.end);
      sinon.assert.calledWithExactly(fakeFunc,
        'myappname',
        {
          params: { appname: 'myappname', lines: [10, 11, 12] },
          query: { test2: 'test2' },
        }, res);
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

      await appsService.getAppFolderSize(appName);

      sinon.assert.calledWithExactly(fakeFunc, exec);
    });
  });

  describe('startAppMonitoring tests', () => {
    beforeEach(() => {
      appsService.clearAppsMonitored();
    });

    afterEach(() => {
      appsService.clearAppsMonitored();
      sinon.restore();
    });

    it('should throw error if no app name was passed', () => {
      expect(appsService.startAppMonitoring.bind(appsService)).to.throw('No App specified');
    });

    it('should set apps monitored of a new app', () => {
      const appName = 'myAppName';
      appsService.startAppMonitoring(appName);

      const appsMonitored = appsService.getAppsMonitored();
      expect(appsMonitored.myAppName).to.be.an('object');
      expect(appsMonitored.myAppName.fifteenMinStatsStore).to.be.an('array');
      expect(appsMonitored.myAppName.oneMinuteStatsStore).to.be.an('array');
      expect(appsMonitored.myAppName.oneMinuteInterval).to.be.an('object');
      expect(appsMonitored.myAppName.fifteenMinInterval).to.be.an('object');
    });
  });

  describe('startMonitoringOfApps tests', () => {
    let dbStub;
    let logSpy;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      logSpy = sinon.spy(log, 'error');
      appsService.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
    });

    afterEach(() => {
      appsService.clearAppsMonitored();
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

      await appsService.startMonitoringOfApps(apps);

      const appsMonitored = appsService.getAppsMonitored();
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

      await appsService.startMonitoringOfApps();

      const appsMonitored = appsService.getAppsMonitored();
      expect(appsMonitored.myAppNamev3).to.be.an('object');
      expect(appsMonitored.myAppNamev2).to.be.an('object');
      expect(appsMonitored.compname1_myAppNamev4).to.be.an('object');
      expect(appsMonitored.compname2_myAppNamev4).to.be.an('object');
    });

    it('should log error if db read fails', async () => {
      dbStub.throws();

      await appsService.startMonitoringOfApps();

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
      appsService.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
    });

    afterEach(() => {
      appsService.clearAppsMonitored();
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
      appsService.setAppsMonitored(
        {
          appName: 'myAppNamev3',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'myAppNamev2',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'compname1_myAppNamev4',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'compname2_myAppNamev4',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );

      await appsService.stopMonitoringOfApps();

      const appsMonitored = appsService.getAppsMonitored();
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
      appsService.setAppsMonitored(
        {
          appName: 'myAppNamev3',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'myAppNamev2',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'compname1_myAppNamev4',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'compname2_myAppNamev4',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );

      await appsService.stopMonitoringOfApps(apps);

      const appsMonitored = appsService.getAppsMonitored();
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
      appsService.setAppsMonitored(
        {
          appName: 'myAppNamev3',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'myAppNamev2',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'compname1_myAppNamev4',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'compname2_myAppNamev4',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );

      await appsService.stopMonitoringOfApps(undefined, true);

      const appsMonitored = appsService.getAppsMonitored();
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
      appsService.setAppsMonitored(
        {
          appName: 'myAppNamev3',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'myAppNamev2',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'compname1_myAppNamev4',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );
      appsService.setAppsMonitored(
        {
          appName: 'compname2_myAppNamev4',
          oneMinuteInterval: setInterval(() => {}, 60000),
          fifteenMinInterval: setInterval(() => {}, 900000),
          oneMinuteStatsStore: 1000,
          fifteenMinStatsStore: 100000,
        },
      );

      await appsService.stopMonitoringOfApps(apps, true);

      const appsMonitored = appsService.getAppsMonitored();
      expect(appsMonitored).to.be.empty;
    });

    it('should log error if db read fails', async () => {
      dbStub.throws();

      await appsService.stopMonitoringOfApps();

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
      appsService.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      appsService.clearAppsMonitored();
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

      await appsService.startAppMonitoringAPI(req, res);

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

      await appsService.startAppMonitoringAPI(req, res);

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

      await appsService.startAppMonitoringAPI(req, res);

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

      await appsService.startAppMonitoringAPI(req, res);

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

  describe.only('stopAppMonitoringAPI tests', () => {
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
      appsService.clearAppsMonitored();
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      appsService.clearAppsMonitored();
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

      await appsService.stopAppMonitoringAPI(req, res);

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

      await appsService.stopAppMonitoringAPI(req, res);

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

      await appsService.stopAppMonitoringAPI(req, res);

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

      await appsService.stopAppMonitoringAPI(req, res);

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

      await appsService.stopAppMonitoringAPI(req, res);

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

      await appsService.stopAppMonitoringAPI(req, res);

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
});

// TODO appLogStream
