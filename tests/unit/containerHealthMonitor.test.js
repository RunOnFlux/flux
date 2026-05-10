const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('containerHealthMonitor tests', () => {
  let containerHealthMonitor;
  let globalStateStub;

  beforeEach(() => {
    globalStateStub = {
      waitForBootComplete: sinon.stub().resolves(),
      isOperationInProgress: sinon.stub().returns(false),
      backupInProgress: [],
      restoreInProgress: [],
      appsMonitored: new Map(),
    };

    containerHealthMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/containerHealthMonitor', {
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../dbHelper': { databaseConnection: sinon.stub(), findInDatabase: sinon.stub(), findOneInDatabase: sinon.stub() },
      '../dockerService': { getDockerContainerOnly: sinon.stub(), appDockerStart: sinon.stub(), dockerListContainers: sinon.stub() },
      '../generalService': { nodeTier: sinon.stub().resolves('cumulus') },
      '../appDatabase/registryManager': { getApplicationGlobalSpecifications: sinon.stub() },
      '../appLifecycle/appInstaller': { installApplicationHard: sinon.stub().resolves() },
      '../appLifecycle/appUninstaller': { removeAppLocally: sinon.stub().resolves() },
      '../appManagement/appInspector': { startAppMonitoring: sinon.stub() },
      '../appTamperingDetectionService': { recordEvent: sinon.stub().resolves(), isNetworkMissingError: sinon.stub().returns(false) },
      '../utils/globalState': globalStateStub,
      '../utils/cacheManager': { default: { stoppedAppsCache: new Map() } },
      '../appQuery/appQueryService': { decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => apps) },
      '../utils/appConstants': { localAppsInformation: 'localAppsInformation' },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('monitorAndRecoverApps', () => {
    it('should wait for bootComplete before proceeding', async () => {
      let monitorResolved = false;
      globalStateStub.waitForBootComplete = sinon.stub().returns(
        new Promise((resolve) => { setTimeout(resolve, 50); }),
      );

      const promise = containerHealthMonitor.monitorAndRecoverApps('10.0.0.1', [], [])
        .then(() => { monitorResolved = true; });
      await new Promise((r) => setImmediate(r));
      expect(monitorResolved).to.be.false;
      await promise;
      expect(monitorResolved).to.be.true;
      expect(globalStateStub.waitForBootComplete.calledOnce).to.be.true;
    });
  });
});
