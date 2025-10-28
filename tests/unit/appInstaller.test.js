const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appInstaller tests', () => {
  let appInstaller;
  let verificationHelperStub;
  let messageHelperStub;
  let dbHelperStub;
  let logStub;
  let configStub;
  let globalStateStub;
  let hwRequirementsStub;

  beforeEach(() => {
    // Config stub
    configStub = {
      database: {
        daemon: {
          collections: {
            scannedHeight: 'scannedHeight',
            appsHashes: 'appsHashes',
          },
          database: 'daemon',
        },
        appslocal: {
          collections: {
            appsInformation: 'localAppsInformation',
          },
          database: 'localapps',
        },
        appsglobal: {
          collections: {
            appsMessages: 'appsMessages',
            appsInformation: 'globalAppsInformation',
            appsTemporaryMessages: 'appsTemporaryMessages',
            appsLocations: 'appsLocations',
            appsInstallingLocations: 'appsInstallingLocations',
            appsInstallingErrorsLocations: 'appsInstallingErrorsLocations',
          },
          database: 'globalapps',
        },
      },
      fluxapps: {
        blocksLasting: 22000,
        latestAppSpecification: 1,
        ownerAppAllowance: 100,
        temporaryAppAllowance: 200,
        maxImageSize: 10000000000,
      },
    };

    globalStateStub = {
      removalInProgress: false,
      installationInProgress: false,
      masterSlaveAppsRunning: false,
    };

    // Stubs
    verificationHelperStub = {
      verifyPrivilege: sinon.stub(),
    };

    messageHelperStub = {
      createDataMessage: sinon.stub(),
      createErrorMessage: sinon.stub(),
      createSuccessMessage: sinon.stub(),
      createWarningMessage: sinon.stub(),
      errUnauthorizedMessage: sinon.stub(),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub(),
      findInDatabase: sinon.stub(),
      findOneInDatabase: sinon.stub(),
      insertOneToDatabase: sinon.stub(),
    };

    hwRequirementsStub = {
      checkAppHWRequirements: sinon.stub().resolves(),
      checkAppStaticIpRequirements: sinon.stub(),
      checkAppNodesRequirements: sinon.stub().resolves(),
      checkAppGeolocationRequirements: sinon.stub(),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    // Proxy require
    appInstaller = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
      config: configStub,
      '../verificationHelper': verificationHelperStub,
      '../messageHelper': messageHelperStub,
      '../dbHelper': dbHelperStub,
      '../serviceHelper': {
        ensureString: sinon.stub().returnsArg(0),
        ensureNumber: sinon.stub().returnsArg(0),
        delay: sinon.stub().resolves(),
      },
      '../generalService': {
        nodeTier: sinon.stub().resolves('cumulus'),
        checkSynced: sinon.stub().resolves(true),
      },
      '../benchmarkService': {
        getBenchmarks: sinon.stub().resolves({
          status: 'success',
          data: { ipaddress: '192.168.1.1', thunder: false },
        }),
      },
      '../fluxNetworkHelper': {
        getNumberOfPeers: sinon.stub().returns(15),
        isFirewallActive: sinon.stub().resolves(false),
        allowPort: sinon.stub().resolves({ status: true }),
        removeDockerContainerAccessToNonRoutable: sinon.stub().resolves(true),
      },
      '../geolocationService': {
        isStaticIP: sinon.stub().returns(true),
      },
      '../dockerService': {
        dockerListContainers: sinon.stub().resolves([]),
        pruneContainers: sinon.stub().resolves(),
        pruneNetworks: sinon.stub().resolves(),
        pruneVolumes: sinon.stub().resolves(),
        pruneImages: sinon.stub().resolves(),
        createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
        getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
        appDockerCreate: sinon.stub().resolves(),
        appDockerStart: sinon.stub().resolves('container-started'),
        getAppIdentifier: sinon.stub().returns('testapp'),
        dockerPullStream: sinon.stub().yields(null, 'pulled'),
      },
      './appUninstaller': {
        removeAppLocally: sinon.stub().resolves(),
      },
      './advancedWorkflows': {
        createAppVolume: sinon.stub().resolves(),
      },
      '../fluxCommunicationMessagesSender': {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      },
      '../appMessaging/messageStore': {
        storeAppRunningMessage: sinon.stub().resolves(),
        storeAppInstallingErrorMessage: sinon.stub().resolves(),
      },
      '../appSystem/systemIntegration': {
        systemArchitecture: sinon.stub().resolves('amd64'),
      },
      '../appSecurity/imageManager': {
        checkApplicationImagesCompliance: sinon.stub().resolves(),
      },
      '../appManagement/appInspector': {
        startAppMonitoring: sinon.stub(),
      },
      '../utils/imageVerifier': {
        ImageVerifier: sinon.stub().returns({
          addCredentials: sinon.stub(),
          verifyImage: sinon.stub().resolves(),
          throwIfError: sinon.stub(),
          supported: true,
          provider: 'docker.io',
        }),
      },
      '../pgpService': {
        decryptMessage: sinon.stub().resolves('user:token'),
      },
      '../upnpService': {
        isUPNP: sinon.stub().returns(false),
        mapUpnpPort: sinon.stub().resolves(true),
      },
      '../utils/globalState': globalStateStub,
      '../../lib/log': logStub,
      '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
        config: configStub,
      }),
      '../appMessaging/messageVerifier': {
        checkAppTemporaryMessageExistence: sinon.stub().resolves(null),
        checkAppMessageExistence: sinon.stub().resolves(null),
      },
      '../appDatabase/registryManager': {
        availableApps: sinon.stub().resolves([]),
        getApplicationGlobalSpecifications: sinon.stub().resolves(null),
      },
      '../appRequirements/hwRequirements': hwRequirementsStub,
      '../appQuery/appQueryService': {
        installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
        listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
      },
      util: {
        promisify: (fn) => fn,
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('checkAppRequirements', () => {
    it('should check all hardware requirements', async () => {
      const appSpecs = {
        name: 'testapp',
        cpu: 1,
        ram: 1000,
        hdd: 10,
      };

      const result = await appInstaller.checkAppRequirements(appSpecs);

      expect(result).to.be.true;
      expect(hwRequirementsStub.checkAppHWRequirements.calledWith(appSpecs)).to.be.true;
      expect(hwRequirementsStub.checkAppStaticIpRequirements.calledWith(appSpecs)).to.be.true;
      expect(hwRequirementsStub.checkAppNodesRequirements.calledWith(appSpecs)).to.be.true;
      expect(hwRequirementsStub.checkAppGeolocationRequirements.calledWith(appSpecs)).to.be.true;
    });

    it('should propagate hardware requirement errors', async () => {
      const appSpecs = {
        name: 'testapp',
        cpu: 1,
        ram: 1000,
        hdd: 10,
      };
      const error = new Error('Insufficient hardware');

      hwRequirementsStub.checkAppHWRequirements.rejects(error);

      try {
        await appInstaller.checkAppRequirements(appSpecs);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err).to.equal(error);
      }
    });
  });

  describe('installAppLocally', () => {
    it('should reject unauthorized users', async () => {
      const req = {
        params: { appname: 'testapp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await appInstaller.installAppLocally(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.calledWith('user', req)).to.be.true;
    });

    it('should handle missing appname parameter', async () => {
      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'No Flux App specified' } });

      await appInstaller.installAppLocally(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should handle app not found error', async () => {
      const req = {
        params: { appname: 'nonexistent' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        setHeader: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.withArgs('user', req).resolves(true);
      verificationHelperStub.verifyPrivilege.withArgs('adminandfluxteam', req).resolves(true);

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);
      dbHelperStub.findInDatabase.resolves([]);

      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Application Specifications of nonexistent not found' } });

      await appInstaller.installAppLocally(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });

  describe('testAppInstall', () => {
    it('should reject unauthorized users', async () => {
      const req = {
        params: { appname: 'testapp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await appInstaller.testAppInstall(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.calledWith('user', req)).to.be.true;
    });

    it('should handle missing appname parameter', async () => {
      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'No Flux App specified' } });

      await appInstaller.testAppInstall(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should log test install request', async () => {
      const req = {
        params: { appname: 'testapp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        setHeader: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.withArgs('user', req).resolves(true);
      verificationHelperStub.verifyPrivilege.withArgs('adminandfluxteam', req).resolves(true);

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);
      dbHelperStub.findInDatabase.resolves([]);

      messageHelperStub.createErrorMessage.returns({ status: 'error' });

      await appInstaller.testAppInstall(req, res);

      expect(logStub.info.calledWith('testAppInstall: testapp')).to.be.true;
    });
  });

  describe('registerAppLocally tests', () => {
    const appSpec = {
      version: 2,
      name: 'testapp',
      description: 'testapp',
      repotag: 'yurinnick/testapp',
      owner: '1K6nyw2VjV6jEN1f1CkbKn9htWnYkQabbR',
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
      hash: 'localappinstancehashABCDEF',
      height: 0,
    };

    beforeEach(() => {
      globalStateStub.removalInProgress = false;
      globalStateStub.installationInProgress = false;
    });

    afterEach(() => {
      globalStateStub.removalInProgress = false;
      globalStateStub.installationInProgress = false;
    });

    it('should return error if removal is in progress', async () => {
      const componentSpecs = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };
      globalStateStub.removalInProgress = true;

      const result = await appInstaller.registerAppLocally(appSpec, componentSpecs, res);

      expect(logStub.error.called).to.be.true;
      expect(result).to.be.false;
    });

    it('should return error if another installation is in progress', async () => {
      const componentSpecs = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };
      globalStateStub.installationInProgress = true;

      const result = await appInstaller.registerAppLocally(appSpec, componentSpecs, res);

      expect(logStub.error.called).to.be.true;
      expect(result).to.be.false;
    });

    it('should return false if node tier does not return anything', async () => {
      const appInstallerWithNodeTier = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': dbHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureNumber: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves(undefined),
          checkSynced: sinon.stub().resolves(true),
        },
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: { ipaddress: '192.168.1.1', thunder: false },
          }),
        },
        '../fluxNetworkHelper': {
          getNumberOfPeers: sinon.stub().returns(15),
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves({ status: true }),
          removeDockerContainerAccessToNonRoutable: sinon.stub().resolves(true),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
        },
        '../dockerService': {
          dockerListContainers: sinon.stub().resolves([]),
          pruneContainers: sinon.stub().resolves(),
          pruneNetworks: sinon.stub().resolves(),
          pruneVolumes: sinon.stub().resolves(),
          pruneImages: sinon.stub().resolves(),
          createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
          getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
          appDockerCreate: sinon.stub().resolves(),
          appDockerStart: sinon.stub().resolves('container-started'),
          getAppIdentifier: sinon.stub().returns('testapp'),
          dockerPullStream: sinon.stub().yields(null, 'pulled'),
        },
        './appUninstaller': {
          removeAppLocally: sinon.stub().resolves(),
        },
        './advancedWorkflows': {
          createAppVolume: sinon.stub().resolves(),
        },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
        },
        '../appMessaging/messageStore': {
          storeAppRunningMessage: sinon.stub().resolves(),
          storeAppInstallingErrorMessage: sinon.stub().resolves(),
        },
        '../appSystem/systemIntegration': {
          systemArchitecture: sinon.stub().resolves('amd64'),
        },
        '../appSecurity/imageManager': {
          checkApplicationImagesCompliance: sinon.stub().resolves(),
        },
        '../appManagement/appInspector': {
          startAppMonitoring: sinon.stub(),
        },
        '../utils/imageVerifier': {
          ImageVerifier: sinon.stub().returns({
            addCredentials: sinon.stub(),
            verifyImage: sinon.stub().resolves(),
            throwIfError: sinon.stub(),
            supported: true,
            provider: 'docker.io',
          }),
        },
        '../pgpService': {
          decryptMessage: sinon.stub().resolves('user:token'),
        },
        '../upnpService': {
          isUPNP: sinon.stub().returns(false),
          mapUpnpPort: sinon.stub().resolves(true),
        },
        '../utils/globalState': globalStateStub,
        '../../lib/log': logStub,
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
          config: configStub,
        }),
        '../appMessaging/messageVerifier': {
          checkAppTemporaryMessageExistence: sinon.stub().resolves(null),
          checkAppMessageExistence: sinon.stub().resolves(null),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
          getApplicationGlobalSpecifications: sinon.stub().resolves(null),
        },
        '../appRequirements/hwRequirements': hwRequirementsStub,
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
          listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
        },
        util: {
          promisify: (fn) => fn,
        },
      });

      const componentSpecs = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      const result = await appInstallerWithNodeTier.registerAppLocally(appSpec, componentSpecs, res);

      expect(res.write.called).to.be.true;
      expect(result).to.be.false;
    });

    it('should return false if app already installed', async () => {
      const dbHelperStubLocal = {
        databaseConnection: sinon.stub(),
        findInDatabase: sinon.stub(),
        findOneInDatabase: sinon.stub().resolves({ name: 'testapp' }),
        insertOneToDatabase: sinon.stub(),
      };

      const appInstallerWithDb = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': dbHelperStubLocal,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureNumber: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
          checkSynced: sinon.stub().resolves(true),
        },
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: { ipaddress: '127.0.0.1:5050', thunder: false },
          }),
        },
        '../fluxNetworkHelper': {
          getNumberOfPeers: sinon.stub().returns(15),
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves({ status: true }),
          removeDockerContainerAccessToNonRoutable: sinon.stub().resolves(true),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
        },
        '../dockerService': {
          dockerListContainers: sinon.stub().resolves([]),
          pruneContainers: sinon.stub().resolves(),
          pruneNetworks: sinon.stub().resolves(),
          pruneVolumes: sinon.stub().resolves(),
          pruneImages: sinon.stub().resolves(),
          createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
          getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
          appDockerCreate: sinon.stub().resolves(),
          appDockerStart: sinon.stub().resolves('container-started'),
          getAppIdentifier: sinon.stub().returns('testapp'),
          dockerPullStream: sinon.stub().yields(null, 'pulled'),
        },
        './appUninstaller': {
          removeAppLocally: sinon.stub().resolves(),
        },
        './advancedWorkflows': {
          createAppVolume: sinon.stub().resolves(),
        },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
        },
        '../appMessaging/messageStore': {
          storeAppRunningMessage: sinon.stub().resolves(),
          storeAppInstallingErrorMessage: sinon.stub().resolves(),
        },
        '../appSystem/systemIntegration': {
          systemArchitecture: sinon.stub().resolves('amd64'),
        },
        '../appSecurity/imageManager': {
          checkApplicationImagesCompliance: sinon.stub().resolves(),
        },
        '../appManagement/appInspector': {
          startAppMonitoring: sinon.stub(),
        },
        '../utils/imageVerifier': {
          ImageVerifier: sinon.stub().returns({
            addCredentials: sinon.stub(),
            verifyImage: sinon.stub().resolves(),
            throwIfError: sinon.stub(),
            supported: true,
            provider: 'docker.io',
          }),
        },
        '../pgpService': {
          decryptMessage: sinon.stub().resolves('user:token'),
        },
        '../upnpService': {
          isUPNP: sinon.stub().returns(false),
          mapUpnpPort: sinon.stub().resolves(true),
        },
        '../utils/globalState': globalStateStub,
        '../../lib/log': logStub,
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
          config: configStub,
        }),
        '../appMessaging/messageVerifier': {
          checkAppTemporaryMessageExistence: sinon.stub().resolves(null),
          checkAppMessageExistence: sinon.stub().resolves(null),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
          getApplicationGlobalSpecifications: sinon.stub().resolves(null),
        },
        '../appRequirements/hwRequirements': hwRequirementsStub,
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
          listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
        },
        util: {
          promisify: (fn) => fn,
        },
      });

      const componentSpecs = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      const result = await appInstallerWithDb.registerAppLocally(appSpec, componentSpecs, res);

      expect(logStub.error.called).to.be.true;
      expect(res.write.called).to.be.true;
      expect(result).to.be.false;
    });
  });
});
