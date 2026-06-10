const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('peerNotification tests', () => {
  let peerNotification;
  let logStub;
  let enqueueAllStub;
  let storeAppRunningMessageStub;
  let installedAppsStub;
  let listRunningAppsStub;

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    enqueueAllStub = sinon.stub().resolves();
    storeAppRunningMessageStub = sinon.stub().resolves();
    installedAppsStub = sinon.stub().resolves({
      status: 'success',
      data: [{ name: 'app1', version: 4, compose: [{ name: 'c1', containerData: '/data' }] }],
    });
    listRunningAppsStub = sinon.stub().resolves({
      status: 'success',
      data: [{ Names: ['/fluxc1_app1'] }],
    });

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
        fluxapps: {
          peerNotifyIntervalMs: 3600000,
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
      '../fluxNetworkHelper': {
        getLocalSocketAddress: sinon.stub().resolves('192.168.1.1:16127'),
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
        storeAppRunningMessage: storeAppRunningMessageStub,
        storeAppStateEvent: sinon.stub().resolves(),
        APP_STATE_EVENT_TYPES: { APPRUNNING: 'apprunning' },
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
      '../appMonitoring/appReconciler': {
        enqueueAll: enqueueAllStub,
      },
      '../appQuery/appQueryService': {
        installedApps: installedAppsStub,
        listRunningApps: listRunningAppsStub,
        decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => apps),
      },
      '../appTamperingDetectionService': {
        recordEvent: sinon.stub().resolves(),
        isNetworkMissingError: sinon.stub().returns(false),
      },
      '../utils/appConstants': {
        localAppsInformation: 'localAppsInformation',
      },
      '../nodeConfirmationService': {
        canSendMessages: sinon.stub().returns(true),
        onMessageCapabilityChange: sinon.stub(),
      },
      '../utils/globalState': {
        backupInProgress: [],
        restoreInProgress: [],
        runningAppsCache: new Set(),
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

    it('triggers the hourly reconciler sweep', async () => {
      await peerNotification.checkAndNotifyPeersOfRunningApps();
      expect(enqueueAllStub.calledOnceWith('hourly')).to.be.true;
    });

    it('broadcasts a compose app whose components are all running', async () => {
      await peerNotification.checkAndNotifyPeersOfRunningApps();
      expect(storeAppRunningMessageStub.calledOnce).to.be.true;
      const [message] = storeAppRunningMessageStub.firstCall.args;
      expect(message.type).to.equal('fluxapprunning');
      expect(message.ip).to.equal('192.168.1.1:16127');
      expect(message.apps.map((a) => a.name)).to.deep.equal(['app1']);
    });

    it('does not broadcast a plain app with a stopped component', async () => {
      installedAppsStub.resolves({
        status: 'success',
        data: [
          { name: 'app1', version: 4, compose: [{ name: 'c1', containerData: '/data' }] },
          { name: 'app2', version: 4, compose: [{ name: 'c2', containerData: '/data' }] },
        ],
      });
      // only app1's container is running
      await peerNotification.checkAndNotifyPeersOfRunningApps();
      const [message] = storeAppRunningMessageStub.firstCall.args;
      expect(message.apps.map((a) => a.name)).to.deep.equal(['app1']);
    });

    it('still broadcasts a g:/r: app with stopped components (derived from specs, not run-state)', async () => {
      // a masterSlave-managed app intentionally stops slave components, so the
      // broadcast set must come from the spec, not from container run-state
      installedAppsStub.resolves({
        status: 'success',
        data: [
          { name: 'app1', version: 4, compose: [{ name: 'c1', containerData: '/data' }] },
          { name: 'gapp', version: 4, compose: [{ name: 'gc', containerData: 'g:/data' }] },
          { name: 'rapp', version: 4, compose: [{ name: 'rc', containerData: 'r:/data' }] },
        ],
      });
      // neither gapp's nor rapp's containers are running
      await peerNotification.checkAndNotifyPeersOfRunningApps();
      const [message] = storeAppRunningMessageStub.firstCall.args;
      expect(message.apps.map((a) => a.name).sort()).to.deep.equal(['app1', 'gapp', 'rapp']);
    });
  });
});
