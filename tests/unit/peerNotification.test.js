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
  let registryManagerStub;
  let generalServiceStub;
  let appTamperingDetectionStub;

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

    registryManagerStub = {
      getApplicationGlobalSpecifications: sinon.stub().resolves(null),
    };

    generalServiceStub = {
      isNodeStatusConfirmed: sinon.stub().resolves(true),
      nodeTier: sinon.stub().resolves('cumulus'),
    };

    appTamperingDetectionStub = {
      recordEvent: sinon.stub().resolves(),
      isNetworkMissingError: sinon.stub().returns(false),
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
      '../generalService': generalServiceStub,
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
      '../appDatabase/registryManager': registryManagerStub,
      '../appManagement/appInspector': appInspectorStub,
      '../appLifecycle/appUninstaller': appUninstallerStub,
      '../appLifecycle/appInstaller': appInstallerStub,
      '../appQuery/appQueryService': {
        decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => apps),
      },
      '../appTamperingDetectionService': appTamperingDetectionStub,
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

  describe('handleMissingMasterSlaveContainer (stoppedAppsRecovery)', () => {
    let stoppedAppsRecovery;

    beforeEach(() => {
      stoppedAppsRecovery = proxyquire('../../ZelBack/src/services/appLifecycle/stoppedAppsRecovery', {
        config: {
          database: {
            appslocal: { collections: { appsInformation: 'localAppsInformation' }, database: 'localapps' },
            appsglobal: { database: 'globalapps', collections: { appsLocations: 'appsLocations' } },
          },
        },
        '../dbHelper': dbHelperStub,
        '../dockerService': dockerServiceStub,
        '../serviceHelper': { delay: sinon.stub().resolves() },
        '../generalService': { isNodeStatusConfirmed: sinon.stub().resolves(true), nodeTier: sinon.stub().resolves('cumulus') },
        '../appDatabase/registryManager': { getApplicationGlobalSpecifications: sinon.stub().resolves(null) },
        '../appManagement/appInspector': appInspectorStub,
        './appInstaller': appInstallerStub,
        './appUninstaller': appUninstallerStub,
        './advancedWorkflows': {},
        '../appTamperingDetectionService': { recordEvent: sinon.stub().resolves(), isNetworkMissingError: sinon.stub().returns(false) },
        '../utils/globalState': { backupInProgress: [], restoreInProgress: [], appsMonitored: new Map() },
        '../utils/cacheManager': { default: { stoppedAppsCache: new Map() } },
        '../appQuery/appQueryService': { decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => apps) },
        '../utils/appConstants': { localAppsInformation: 'localAppsInformation' },
        '../fluxNetworkHelper': { getFluxNodePrivateKey: sinon.stub().returns('') },
        '../../lib/log': logStub,
      });
    });

    it('should return early if container exists', async () => {
      dockerServiceStub.getDockerContainerOnly.resolves({ Id: 'abc123' });

      await stoppedAppsRecovery.handleMissingMasterSlaveContainer('MyComponent_testapp', 'testapp');

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

      await stoppedAppsRecovery.handleMissingMasterSlaveContainer('MyComponent_testapp', 'testapp');

      expect(appInstallerStub.installApplicationHard.calledOnce).to.be.true;
      expect(appInspectorStub.startAppMonitoring.calledWith('MyComponent_testapp')).to.be.true;
      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
    });

    it('should remove app when recreation fails and container still missing', async () => {
      dockerServiceStub.getDockerContainerOnly.resolves(null);
      dbHelperStub.findOneInDatabase.resolves(null);

      await stoppedAppsRecovery.handleMissingMasterSlaveContainer('MyComponent_testapp', 'testapp');

      expect(appUninstallerStub.removeAppLocally.calledOnce).to.be.true;
      expect(appUninstallerStub.removeAppLocally.firstCall.args[0]).to.equal('testapp');
      expect(logStub.warn.calledWithMatch(/REMOVAL REASON/)).to.be.true;
    });

    it('should skip removal when recreation fails but container was created by another process', async () => {
      dockerServiceStub.getDockerContainerOnly
        .onFirstCall().resolves(null)
        .onSecondCall().resolves({ Id: 'abc123' });
      dbHelperStub.findOneInDatabase.resolves(null);

      await stoppedAppsRecovery.handleMissingMasterSlaveContainer('MyComponent_testapp', 'testapp');

      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
      expect(logStub.info.calledWithMatch(/created by another process/)).to.be.true;
    });
  });

  describe('checkAndNotifyPeersOfRunningApps - per-component g: handling', () => {
    const mixedSpec = {
      version: 8,
      name: 'MixedApp',
      hash: 'mixhash',
      compose: [
        { name: 'web', containerData: '' },
        { name: 'db', containerData: 'g:/data' },
      ],
    };

    const rOnlySpec = {
      version: 8,
      name: 'RApp',
      hash: 'rhash',
      compose: [
        { name: 'web', containerData: 'r:/data' },
      ],
    };

    function makeGlobalState() {
      return {
        backupInProgress: [],
        restoreInProgress: [],
        runningAppsCache: { clear: sinon.stub(), add: sinon.stub(), size: 0 },
      };
    }

    function makeCacheManager(prepopulate = []) {
      const stoppedAppsCache = new Map();
      prepopulate.forEach((k) => stoppedAppsCache.set(k, ''));
      return { stoppedAppsCache };
    }

    it('starts a stopped non-g component of a mixed compose app and leaves the g: sibling alone', async () => {
      // Both components stopped at boot. After the patch, the non-g component must
      // auto-start while the g: component is left for masterSlaveApps.
      const installedApps = sinon.stub().resolves({ status: 'success', data: [mixedSpec] });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves(mixedSpec);

      // Both containers exist (stopped). handleMissingMasterSlaveContainer returns
      // early for the g: component because the container exists.
      dockerServiceStub.getDockerContainerOnly.withArgs('web_MixedApp').resolves({ Id: 'web' });
      dockerServiceStub.getDockerContainerOnly.withArgs('db_MixedApp').resolves({ Id: 'db' });
      dbHelperStub.findOneInDatabase.resolves(null);

      // Pre-warm the cache for the non-g component so the auto-restart fires immediately
      const cacheManager = makeCacheManager(['web_MixedApp']);

      await peerNotification.checkAndNotifyPeersOfRunningApps(
        installedApps,
        listRunningApps,
        {},
        false, false, false, false, false,
        makeGlobalState,
        cacheManager,
      );

      expect(dockerServiceStub.appDockerStart.calledWith('web_MixedApp')).to.equal(true);
      expect(dockerServiceStub.appDockerStart.calledWith('db_MixedApp')).to.equal(false);
      expect(appInstallerStub.installApplicationHard.called).to.equal(false);
    });

    it('routes a stopped g: component through handleMissingMasterSlaveContainer, never appDockerStart', async () => {
      // On a slave: web is running, db (g:) is stopped.
      const installedApps = sinon.stub().resolves({ status: 'success', data: [mixedSpec] });
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: [{ Names: ['/fluxweb_MixedApp'] }],
      });
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves(mixedSpec);

      // db container exists — handleMissingMasterSlaveContainer must short-circuit
      dockerServiceStub.getDockerContainerOnly.withArgs('db_MixedApp').resolves({ Id: 'db' });
      dbHelperStub.findOneInDatabase.resolves(null);

      // Pre-warm cache to prove the warmup path was NOT what kept the g: component stopped
      const cacheManager = makeCacheManager(['db_MixedApp']);

      await peerNotification.checkAndNotifyPeersOfRunningApps(
        installedApps,
        listRunningApps,
        {},
        false, false, false, false, false,
        makeGlobalState,
        cacheManager,
      );

      expect(dockerServiceStub.appDockerStart.calledWith('db_MixedApp')).to.equal(false);
      expect(appInstallerStub.installApplicationHard.called).to.equal(false);
      // It was the masterSlave routing that did the short-circuit (container existence check)
      expect(dockerServiceStub.getDockerContainerOnly.calledWith('db_MixedApp')).to.equal(true);
    });

    it('does not inherit the 30-minute install grace on a non-syncthing component of a g: app', async () => {
      // Web is non-g/non-r. db is g:. Mixed compose. web is stopped; db is running.
      // runningSince is recent — if the grace was applied (the bug), web would NOT start.
      const installedApps = sinon.stub().resolves({ status: 'success', data: [mixedSpec] });
      const listRunningApps = sinon.stub().resolves({
        status: 'success',
        data: [{ Names: ['/fluxdb_MixedApp'] }],
      });
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves(mixedSpec);

      dockerServiceStub.getDockerContainerOnly.withArgs('web_MixedApp').resolves({ Id: 'web' });
      // Recent runningSince — would trigger the grace if it applied to non-r components
      dbHelperStub.findOneInDatabase.resolves({ runningSince: new Date().toISOString() });

      const cacheManager = makeCacheManager(['web_MixedApp']);

      await peerNotification.checkAndNotifyPeersOfRunningApps(
        installedApps,
        listRunningApps,
        {},
        false, false, false, false, false,
        makeGlobalState,
        cacheManager,
      );

      expect(dockerServiceStub.appDockerStart.calledWith('web_MixedApp')).to.equal(true);
    });

    it('still applies the 30-minute install grace to an r: component', async () => {
      // r: component, recent runningSince — must NOT auto-start during grace window.
      const installedApps = sinon.stub().resolves({ status: 'success', data: [rOnlySpec] });
      const listRunningApps = sinon.stub().resolves({ status: 'success', data: [] });
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('RApp').resolves(rOnlySpec);

      dockerServiceStub.getDockerContainerOnly.withArgs('web_RApp').resolves({ Id: 'web' });
      dbHelperStub.findOneInDatabase.resolves({ runningSince: new Date().toISOString() });

      const cacheManager = makeCacheManager(['web_RApp']);

      await peerNotification.checkAndNotifyPeersOfRunningApps(
        installedApps,
        listRunningApps,
        {},
        false, false, false, false, false,
        makeGlobalState,
        cacheManager,
      );

      expect(dockerServiceStub.appDockerStart.calledWith('web_RApp')).to.equal(false);
    });
  });
});
