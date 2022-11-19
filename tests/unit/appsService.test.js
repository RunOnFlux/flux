const chai = require('chai');
const sinon = require('sinon');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const dockerService = require('../../ZelBack/src/services/dockerService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const log = require('../../ZelBack/src/lib/log');

const { expect } = chai;
const appsService = require('../../ZelBack/src/services/appsService');

describe.only('appsService tests', () => {
  describe('installedApps tests', () => {
    let dbStub;
    let logSpy;
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
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

  describe.only('appStart tests', () => {
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

    it('should start app', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      verificationHelperStub.returns(true);

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
  });
});
