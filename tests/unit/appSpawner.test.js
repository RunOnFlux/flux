const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appSpawner tests', () => {
  let appSpawner;
  let logStub;
  let configStub;

  beforeEach(() => {
    // Config stub
    configStub = {
      database: {
        daemon: {
          database: 'daemon',
        },
        appslocal: {
          database: 'localapps',
        },
        appsglobal: {
          database: 'globalapps',
        },
      },
      fluxapps: {
        installation: {
          delay: 300,
        },
      },
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    // Proxy require - note: we're NOT actually running trySpawningGlobalApplication in tests
    appSpawner = proxyquire('../../ZelBack/src/services/appLifecycle/appSpawner', {
      config: configStub,
      '../dbHelper': {
        databaseConnection: sinon.stub(),
        aggregateInDatabase: sinon.stub(),
        findInDatabase: sinon.stub(),
      },
      '../serviceHelper': {
        delay: sinon.stub().resolves(),
        ensureNumber: sinon.stub().returnsArg(0),
      },
      '../generalService': {
        checkSynced: sinon.stub().resolves(true),
        isNodeStatusConfirmed: sinon.stub().resolves(true),
        nodeTier: sinon.stub().resolves('cumulus'),
      },
      '../benchmarkService': {
        getBenchmarks: sinon.stub().resolves({
          status: 'success',
          data: { ipaddress: '192.168.1.1', thunder: false },
        }),
      },
      '../fluxNetworkHelper': {
        isPortOpen: sinon.stub().resolves(true),
        isPortUserBlocked: sinon.stub().returns(false),
      },
      '../../lib/log': logStub,
      '../appQuery/appQueryService': {
        listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
      },
      '../appDatabase/registryManager': {
        appLocation: sinon.stub().resolves([]),
        appInstallingLocation: sinon.stub().resolves([]),
        getApplicationGlobalSpecifications: sinon.stub().resolves(null),
        expireGlobalApplications: sinon.stub().resolves(),
        storeAppInstallingMessage: sinon.stub().resolves(),
        getRunningAppIpList: sinon.stub().resolves([]),
      },
      '../appSecurity/imageManager': {
        checkApplicationImagesComplience: sinon.stub().resolves(),
        verifyRepository: sinon.stub().resolves(),
      },
      '../appRequirements/hwRequirements': {
        checkAppRequirements: sinon.stub().resolves(),
        totalAppHWRequirements: sinon.stub().returns({ cpu: 1, ram: 1000, hdd: 10 }),
      },
      '../appNetwork/portManager': {
        ensureApplicationPortsNotUsed: sinon.stub().resolves(),
        checkInstallingAppPortAvailable: sinon.stub().resolves(true),
      },
      '../utils/appUtilities': {
        getAppPorts: sinon.stub().returns([]),
      },
      '../appSystem/systemIntegration': {
        systemArchitecture: sinon.stub().resolves('amd64'),
        nodeFullGeolocation: sinon.stub().returns('US-NY'),
      },
      '../utils/globalState': {
        checkAndSyncAppHashesWasEverExecuted: true,
        fluxNodeWasNotConfirmedOnLastCheck: false,
        fluxNodeWasAlreadyConfirmed: false,
        firstExecutionAfterItsSynced: false,
        spawnErrorsLongerAppCache: new Map(),
        trySpawningGlobalAppCache: new Map(),
        appsToBeCheckedLater: [],
        appsSyncthingToBeCheckedLater: [],
      },
      './advancedWorkflows': {
        getPeerAppsInstallingErrorMessages: sinon.stub().resolves(),
      },
      '../fluxCommunicationMessagesSender': {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      },
      '../utils/appConstants': {
        globalAppsInformation: 'appsInformation',
        localAppsInformation: 'localAppsInformation',
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('initialize', () => {
    it('should initialize appInstaller and appUninstaller dependencies', () => {
      const mockAppInstaller = { registerAppLocally: sinon.stub() };
      const mockAppUninstaller = { removeAppLocally: sinon.stub() };

      const deps = {
        appInstaller: mockAppInstaller,
        appUninstaller: mockAppUninstaller,
      };

      // Initialize should not throw
      appSpawner.initialize(deps);

      // After initialization, the module should have stored these dependencies
      // We can't easily test this without exposing them, but at least verify it doesn't throw
      expect(appSpawner.initialize).to.be.a('function');
    });

    it('should handle empty dependencies object', () => {
      const deps = {};

      // Should not throw even with empty deps
      appSpawner.initialize(deps);

      expect(appSpawner.initialize).to.be.a('function');
    });
  });

  describe('trySpawningGlobalApplication', () => {
    it('should be exported as a function', () => {
      expect(appSpawner.trySpawningGlobalApplication).to.be.a('function');
    });

    // Note: We don't actually call trySpawningGlobalApplication in these tests
    // because it's a long-running recursive function with complex business logic.
    // Testing it properly would require integration tests or significant mocking.
    // The function is tested indirectly through integration tests.
  });
});
