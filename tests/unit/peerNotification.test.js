const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('peerNotification tests', () => {
  let peerNotification;
  let logStub;
  let monitorAndRecoverAppsStub;

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    monitorAndRecoverAppsStub = sinon.stub().resolves({ masterSlaveAppsInstalled: [], startedApps: [] });

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
      '../dbHelper': {
        databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
        findOneInDatabase: sinon.stub().resolves(null),
        findInDatabase: sinon.stub().resolves([]),
        updateOneInDatabase: sinon.stub().resolves(),
      },
      '../dockerService': {
        appDockerStart: sinon.stub().resolves(),
        getDockerContainerOnly: sinon.stub().resolves(null),
      },
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
      '../appManagement/appInspector': {
        startAppMonitoring: sinon.stub(),
        stopAppMonitoring: sinon.stub(),
      },
      '../appLifecycle/appUninstaller': {
        removeAppLocally: sinon.stub().resolves(),
      },
      '../appLifecycle/appInstaller': {
        installApplicationHard: sinon.stub().resolves(),
      },
      '../appLifecycle/appStartupManager': {
        monitorAndRecoverApps: monitorAndRecoverAppsStub,
      },
      '../appQuery/appQueryService': {
        installedApps: sinon.stub().resolves({
          status: 'success',
          data: [{ name: 'app1', version: 4, compose: [{ name: 'c1', containerData: '' }] }],
        }),
        listRunningApps: sinon.stub().resolves({
          status: 'success',
          data: [{ Names: ['/fluxc1_app1'] }],
        }),
        decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => apps),
      },
      '../appTamperingDetectionService': {
        recordEvent: sinon.stub().resolves(),
        isNetworkMissingError: sinon.stub().returns(false),
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

    it('should call monitorAndRecoverApps with correct args', async () => {
      await peerNotification.checkAndNotifyPeersOfRunningApps();

      expect(monitorAndRecoverAppsStub.calledOnce).to.be.true;
      const [ip, apps, runningNames] = monitorAndRecoverAppsStub.firstCall.args;
      expect(ip).to.equal('192.168.1.1');
      expect(apps).to.have.length(1);
      expect(apps[0].name).to.equal('app1');
      expect(runningNames).to.deep.equal(['c1_app1']);
    });
  });
});
