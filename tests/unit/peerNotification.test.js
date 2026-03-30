const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('peerNotification tests', () => {
  let peerNotification;
  let logStub;
  let dockerServiceStub;
  let appInstallerStub;
  let appUninstallerStub;
  let appInspectorStub;
  let dbHelperStub;

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    dockerServiceStub = {
      appDockerStart: sinon.stub().resolves(),
      getDockerContainerOnly: sinon.stub().resolves(null),
    };

    appInstallerStub = {
      installApplicationHard: sinon.stub().resolves(),
    };

    appUninstallerStub = {
      removeAppLocally: sinon.stub().resolves(),
    };

    appInspectorStub = {
      startAppMonitoring: sinon.stub(),
      stopAppMonitoring: sinon.stub(),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub().returns({
        db: sinon.stub().returns({}),
      }),
      findOneInDatabase: sinon.stub().resolves(null),
      findInDatabase: sinon.stub().resolves([]),
    };

    peerNotification = proxyquire('../../ZelBack/src/services/appMessaging/peerNotification', {
      config: {
        database: {
          appslocal: {
            collections: { appsInformation: 'localAppsInformation' },
            database: 'localapps',
          },
          appsglobal: {
            database: 'globalapps',
            collections: { appsLocations: 'appsLocations' },
          },
        },
      },
      '../dbHelper': dbHelperStub,
      '../dockerService': dockerServiceStub,
      '../serviceHelper': {
        delay: sinon.stub().resolves(),
        ensureString: sinon.stub().returnsArg(0),
      },
      '../generalService': {
        isNodeStatusConfirmed: sinon.stub().resolves(true),
        nodeTier: sinon.stub().resolves('cumulus'),
      },
      '../benchmarkService': {
        getBenchmarks: sinon.stub().resolves({
          status: 'success',
          data: { ipaddress: '192.168.1.1' },
        }),
      },
      '../geolocationService': {
        isStaticIP: sinon.stub().returns(true),
      },
      '../fluxCommunicationMessagesSender': {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
        broadcastMessageToAll: sinon.stub().resolves(),
      },
      './messageStore': {
        storeAppRunningMessage: sinon.stub().resolves(),
      },
      '../appDatabase/registryManager': {
        getApplicationGlobalSpecifications: sinon.stub().resolves(null),
      },
      '../appManagement/appInspector': appInspectorStub,
      '../appLifecycle/appUninstaller': appUninstallerStub,
      '../appLifecycle/appInstaller': appInstallerStub,
      '../appQuery/appQueryService': {
        decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => apps),
      },
      '../utils/appConstants': {
        localAppsInformation: 'localAppsInformation',
      },
      '../utils/globalState': {
        backupInProgress: [],
        restoreInProgress: [],
      },
      '../../lib/log': logStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('checkAndNotifyPeersOfRunningApps', () => {
    it('should be exported as a function', () => {
      expect(peerNotification.checkAndNotifyPeersOfRunningApps).to.be.a('function');
    });
  });

  describe('handleMissingMasterSlaveContainer', () => {
    it('should return early if container exists', async () => {
      dockerServiceStub.getDockerContainerOnly.resolves({ Id: 'abc123' });

      await peerNotification.handleMissingMasterSlaveContainer(
        'MyComponent_testapp', 'testapp', {}, () => ({}),
      );

      expect(appInstallerStub.installApplicationHard.called).to.be.false;
      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
    });

    it('should recreate container when missing and app spec exists', async () => {
      dockerServiceStub.getDockerContainerOnly.resolves(null);
      const appSpec = {
        version: 8,
        name: 'testapp',
        compose: [{ name: 'MyComponent', containerData: 'g:', cpu: 1, ram: 500, hdd: 5 }],
      };
      dbHelperStub.findOneInDatabase.resolves(appSpec);

      await peerNotification.handleMissingMasterSlaveContainer(
        'MyComponent_testapp', 'testapp', {}, () => ({}),
      );

      expect(appInstallerStub.installApplicationHard.calledOnce).to.be.true;
      expect(appInspectorStub.startAppMonitoring.calledWith('MyComponent_testapp')).to.be.true;
      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
    });

    it('should remove app when recreation fails and container still missing', async () => {
      dockerServiceStub.getDockerContainerOnly.resolves(null);
      dbHelperStub.findOneInDatabase.resolves(null); // causes recreateMissingContainers to throw

      await peerNotification.handleMissingMasterSlaveContainer(
        'MyComponent_testapp', 'testapp', {}, () => ({}),
      );

      expect(appUninstallerStub.removeAppLocally.calledOnce).to.be.true;
      expect(appUninstallerStub.removeAppLocally.firstCall.args[0]).to.equal('testapp');
      expect(logStub.warn.calledWithMatch(/REMOVAL REASON/)).to.be.true;
    });

    it('should skip removal when recreation fails but container was created by another process', async () => {
      // First call: missing. Second call (in catch): now exists
      dockerServiceStub.getDockerContainerOnly
        .onFirstCall().resolves(null)
        .onSecondCall().resolves({ Id: 'abc123' });
      dbHelperStub.findOneInDatabase.resolves(null); // causes recreateMissingContainers to throw

      await peerNotification.handleMissingMasterSlaveContainer(
        'MyComponent_testapp', 'testapp', {}, () => ({}),
      );

      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
      expect(logStub.info.calledWithMatch(/created by another process/)).to.be.true;
    });
  });
});
