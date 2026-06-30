const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const InstallResult = require('../../ZelBack/src/services/appLifecycle/installResult');

describe('appInstaller tests', () => {
  let appInstaller;
  let verificationHelperStub;
  let messageHelperStub;
  let dbHelperStub;
  let logStub;
  let configStub;
  let globalStateStub;
  let hwRequirementsStub;
  let enterpriseHelperStub;
  let appSpecHelpersStub;
  let messageVerifierStub;

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
      installingApps: new Map(),
      hasRemovalInProgress: () => false,
      installAborted: () => false,
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

    enterpriseHelperStub = {
      checkAndDecryptAppSpecs: sinon.stub().callsFake((specs) => Promise.resolve(specs)),
    };

    appSpecHelpersStub = {
      specificationFormatter: sinon.stub().returnsArg(0),
    };

    messageVerifierStub = {
      checkAppTemporaryMessageExistence: sinon.stub().resolves(null),
      checkAppMessageExistence: sinon.stub().resolves(null),
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
          data: { ipaddress: '192.168.1.1' },
        }),
      },
      '../daemonService/daemonServiceMiscRpcs': {
        isDaemonSynced: sinon.stub().returns({
          status: 'success',
          data: { synced: true, height: 2094961 },
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
        verifyRepository: sinon.stub().resolves({
          verified: true,
          supportedArchitectures: ['amd64', 'arm64'],
        }),
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
      '../appMessaging/messageVerifier': messageVerifierStub,
      '../appDatabase/registryManager': {
        availableApps: sinon.stub().resolves([]),
        getApplicationGlobalSpecifications: sinon.stub().resolves(null),
      },
      '../appRequirements/hwRequirements': hwRequirementsStub,
      '../appQuery/appQueryService': {
        installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
        listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
        decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => apps),
      },
      '../utils/enterpriseHelper': enterpriseHelperStub,
      '../utils/appSpecHelpers': appSpecHelpersStub,
      '../utils/registryCredentialHelper': {
        addCredentialsToImageVerifier: sinon.stub().resolves(),
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

    it('should decrypt enterprise app specs before test installation', async () => {
      const enterpriseAppSpec = {
        name: 'enterpriseapp',
        version: 8,
        enterprise: 'encryptedData',
        compose: [], // Empty compose indicating encrypted
        contacts: [],
        owner: '1K6nyw2VjV6jEN1f1CkbKn9htWnYkQabbR',
      };

      const decryptedAppSpec = {
        ...enterpriseAppSpec,
        compose: [
          {
            name: 'component1',
            repotag: 'test/component:latest',
            cpu: 0.5,
            ram: 500,
            hdd: 5,
          },
        ],
        contacts: ['admin@example.com'],
      };

      const req = {
        params: { appname: 'enterpriseapp' },
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

      // Mock message verifier to return enterprise app with empty compose
      messageVerifierStub.checkAppTemporaryMessageExistence.resolves({
        appSpecifications: enterpriseAppSpec,
      });

      // Configure enterprise helper to return decrypted specs
      enterpriseHelperStub.checkAndDecryptAppSpecs.resolves(decryptedAppSpec);
      appSpecHelpersStub.specificationFormatter.returns(decryptedAppSpec);

      messageHelperStub.createErrorMessage.returns({ status: 'error' });

      try {
        await appInstaller.testAppInstall(req, res);
      } catch (e) {
        // Installation may fail, but we're testing the decryption path
      }

      // Verify that decryption was called for enterprise app
      expect(enterpriseHelperStub.checkAndDecryptAppSpecs.calledWith(enterpriseAppSpec)).to.be.true;
      expect(appSpecHelpersStub.specificationFormatter.calledWith(decryptedAppSpec)).to.be.true;
      expect(logStub.info.calledWith('testAppInstall: enterpriseapp')).to.be.true;
    });

    it('should skip installation when architecture is incompatible', async () => {
      const appSpec = {
        name: 'arm64app',
        version: 4,
        description: 'ARM64 only app',
        owner: '1K6nyw2VjV6jEN1f1CkbKn9htWnYkQabbR',
        compose: [
          {
            name: 'component1',
            repotag: 'arm64v8/ubuntu:latest',
            cpu: 0.5,
            ram: 500,
            hdd: 5,
          },
        ],
      };

      const req = {
        params: { appname: 'arm64app' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        setHeader: sinon.stub(),
        write: sinon.stub(),
        end: sinon.stub(),
      };

      // Create new proxyquire instance with custom stubs for this test
      const imageManagerStub = {
        checkApplicationImagesCompliance: sinon.stub().resolves(),
        verifyRepository: sinon.stub().resolves({
          verified: true,
          supportedArchitectures: ['arm64'], // ARM64 only
        }),
      };

      const systemIntegrationStub = {
        systemArchitecture: sinon.stub().resolves('amd64'), // Node is AMD64
      };

      const appInstallerForArchTest = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': dbHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().callsFake((param) => (typeof param === 'string' ? param : JSON.stringify(param))),
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
            data: { ipaddress: '192.168.1.1' },
          }),
        },
        '../daemonService/daemonServiceMiscRpcs': {
          isDaemonSynced: sinon.stub().returns({
            status: 'success',
            data: { synced: true, height: 2094961 },
          }),
        },
        '../fluxNetworkHelper': {
          getNumberOfPeers: sinon.stub().returns(15),
        },
        '../dockerService': {
          dockerListContainers: sinon.stub().resolves([]),
        },
        '../appSystem/systemIntegration': systemIntegrationStub,
        '../appSecurity/imageManager': imageManagerStub,
        '../appRequirements/hwRequirements': hwRequirementsStub,
        '../appMessaging/messageVerifier': messageVerifierStub,
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
          getApplicationGlobalSpecifications: sinon.stub().resolves(appSpec),
        },
        '../utils/globalState': globalStateStub,
        '../../lib/log': logStub,
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
          config: configStub,
        }),
        '../utils/enterpriseHelper': enterpriseHelperStub,
        '../utils/appSpecHelpers': appSpecHelpersStub,
        util: {
          promisify: (fn) => fn,
        },
      });

      verificationHelperStub.verifyPrivilege.resolves(true);

      await appInstallerForArchTest.testAppInstall(req, res);

      // Verify verifyRepository was called
      expect(imageManagerStub.verifyRepository.calledWith('arm64v8/ubuntu:latest')).to.be.true;

      // Verify success message was returned using streaming response (2 writes: init + skip message)
      expect(res.write.calledTwice).to.be.true;
      expect(res.end.calledOnce).to.be.true;

      // Verify the second written message contains architecture incompatibility info
      const writeCall = res.write.getCall(1); // Second call
      const writtenData = writeCall.args[0];
      // ensureString converts object to JSON string, so check as string
      expect(writtenData).to.be.a('string');
      expect(writtenData).to.include('architecture incompatibility');
      expect(writtenData).to.include('amd64');
      expect(writtenData).to.include('arm64');
    });

    it('should proceed with installation when architecture is compatible', async () => {
      const appSpec = {
        name: 'multiarchapp',
        version: 4,
        description: 'Multi-arch app',
        owner: '1K6nyw2VjV6jEN1f1CkbKn9htWnYkQabbR',
        compose: [
          {
            name: 'component1',
            repotag: 'nginx:latest',
            cpu: 0.5,
            ram: 500,
            hdd: 5,
          },
        ],
      };

      const req = {
        params: { appname: 'multiarchapp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        setHeader: sinon.stub(),
        write: sinon.stub(),
        end: sinon.stub(),
      };

      // Create new proxyquire instance with custom stubs for this test
      const imageManagerStub = {
        checkApplicationImagesCompliance: sinon.stub().resolves(),
        verifyRepository: sinon.stub().resolves({
          verified: true,
          supportedArchitectures: ['amd64', 'arm64'], // Supports both
        }),
      };

      const systemIntegrationStub = {
        systemArchitecture: sinon.stub().resolves('amd64'), // Node is AMD64
      };

      const appInstallerForArchTest = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': dbHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().callsFake((param) => (typeof param === 'string' ? param : JSON.stringify(param))),
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
            data: { ipaddress: '192.168.1.1' },
          }),
        },
        '../daemonService/daemonServiceMiscRpcs': {
          isDaemonSynced: sinon.stub().returns({
            status: 'success',
            data: { synced: true, height: 2094961 },
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
          createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
          getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
          appDockerCreate: sinon.stub().resolves(),
          appDockerStart: sinon.stub().resolves('container-started'),
          getAppIdentifier: sinon.stub().returns('multiarchapp'),
          dockerPullStream: sinon.stub().resolves('pulled'),
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
        '../appSystem/systemIntegration': systemIntegrationStub,
        '../appSecurity/imageManager': imageManagerStub,
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
        '../utils/registryCredentialHelper': {
          addCredentialsToImageVerifier: sinon.stub().resolves(),
        },
        '../upnpService': {
          isUPNP: sinon.stub().returns(false),
          mapUpnpPort: sinon.stub().resolves(true),
        },
        '../appRequirements/hwRequirements': hwRequirementsStub,
        '../appMessaging/messageVerifier': messageVerifierStub,
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
          getApplicationGlobalSpecifications: sinon.stub().resolves(appSpec),
        },
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
          listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
        },
        '../utils/globalState': globalStateStub,
        '../../lib/log': logStub,
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
          config: configStub,
        }),
        '../utils/enterpriseHelper': enterpriseHelperStub,
        '../utils/appSpecHelpers': appSpecHelpersStub,
        util: {
          promisify: (fn) => fn,
        },
      });

      verificationHelperStub.verifyPrivilege.resolves(true);

      try {
        await appInstallerForArchTest.testAppInstall(req, res);
      } catch (e) {
        // Installation may fail at later stages, but we only care about architecture check passing
      }

      // Verify verifyRepository was called
      expect(imageManagerStub.verifyRepository.calledWith('nginx:latest')).to.be.true;

      // Verify we did NOT return early with skip message
      // (If we had skipped, res.write would contain architecture incompatibility message)
      if (res.write.called) {
        const writeCalls = res.write.getCalls();
        for (const call of writeCalls) {
          const data = call.args[0] || '';
          if (data.includes && data.includes('architecture incompatibility')) {
            expect.fail('Should not have returned early with architecture incompatibility message');
          }
        }
      }
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

    it('defers (not fails) if THIS app is being removed (per-app gate)', async () => {
      const componentSpecs = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };
      // per-app: only this app's own removal blocks its install
      globalStateStub.hasRemovalInProgress = (name) => name === appSpec.name;

      const result = await appInstaller.registerAppLocally(appSpec, componentSpecs, res);

      // 'deferred', NOT false - the spawner must not 7-day-cache this transient state
      expect(result).to.equal('deferred');
    });

    it('defers (not fails) if another installation is in progress', async () => {
      const componentSpecs = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };
      globalStateStub.installationInProgress = true;

      const result = await appInstaller.registerAppLocally(appSpec, componentSpecs, res);

      // transient -> 'deferred', so the spawner retries instead of 7-day-caching it
      expect(result).to.equal('deferred');
    });

    it('should DEFER (not fail) if node tier does not return anything', async () => {
      const appInstallerWithNodeTier = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': dbHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().callsFake((param) => (typeof param === 'string' ? param : JSON.stringify(param))),
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
            data: { ipaddress: '192.168.1.1' },
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
          createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
          getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
          appDockerCreate: sinon.stub().resolves(),
          appDockerStart: sinon.stub().resolves('container-started'),
          getAppIdentifier: sinon.stub().returns('testapp'),
          dockerPullStream: sinon.stub().resolves('pulled'),
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
      // DEFERRED (transient), not FAILED: a missing tier must not 7-day-poison the hash.
      expect(result).to.equal(InstallResult.DEFERRED);
      // The install lock must be released on the no-tier bail (a plain return bypasses
      // the catch that clears it) - else a transient nodeTier() failure wedges all
      // future installs with installationInProgress stuck true.
      expect(globalStateStub.installationInProgress).to.be.false;
    });

    it('should return FAILED if app already installed', async () => {
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
        // No teardown is owed for a normal already-installed failure; without this stub the
        // real module fail-CLOSES teardownOwedFor to true (no DB) and the outer catch would
        // (correctly) reclassify to DEFERRED. This asserts the genuine FAILED path.
        './pendingTeardownStore': { teardownOwedFor: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().callsFake((param) => (typeof param === 'string' ? param : JSON.stringify(param))),
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
            data: { ipaddress: '127.0.0.1:5050' },
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
          createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
          getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
          appDockerCreate: sinon.stub().resolves(),
          appDockerStart: sinon.stub().resolves('container-started'),
          getAppIdentifier: sinon.stub().returns('testapp'),
          dockerPullStream: sinon.stub().resolves('pulled'),
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
      expect(result).to.equal(InstallResult.FAILED);
    });

    it('runs the post-install broadcast only AFTER releasing the install lock', async () => {
      // Regression guard for the post-install broadcast ordering bug.
      // onInstallComplete() -> checkAndNotifyPeersOfRunningApps() must run with the
      // install lock already cleared, otherwise containerHealthMonitor.monitorAndRecoverApps
      // bails on globalState.isOperationInProgress() and the just-installed (syncthing)
      // app is excluded from its own running-apps announcement.
      // Pre-fix: the broadcast ran while installationInProgress was still true.
      let lockHeldWhenBroadcasting = null;
      const onInstallComplete = sinon.stub().callsFake(() => {
        lockHeldWhenBroadcasting = globalStateStub.installationInProgress;
        return Promise.resolve();
      });
      const fluxEventBusStub = { publish: sinon.stub(), subscribe: sinon.stub() };
      const dbHelperStubSuccess = {
        databaseConnection: sinon.stub().returns({ db: () => ({ collection: () => ({}) }) }),
        findInDatabase: sinon.stub().resolves([]),
        // 1st call = "already installed?" -> null (proceed). Later calls (post-insert
        // validation) -> truthy so the install reaches the success/broadcast path.
        findOneInDatabase: (() => {
          const s = sinon.stub().resolves({ name: 'testapp' });
          s.onFirstCall().resolves(null);
          return s;
        })(),
        findOneAndDeleteInDatabase: sinon.stub().resolves(),
        insertOneToDatabase: sinon.stub().resolves({ insertedId: 'id' }),
      };

      const appInstallerSuccess = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': dbHelperStubSuccess,
        // teardownOwedFor now fails CLOSED on a DB read error; the real module would hit an
        // unconnected Mongo here, so mock it to the no-teardown-owed answer for this install.
        './pendingTeardownStore': { teardownOwedFor: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().callsFake((param) => (typeof param === 'string' ? param : JSON.stringify(param))),
          ensureNumber: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
          checkSynced: sinon.stub().resolves(true),
        },
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({ status: 'success', data: { ipaddress: '127.0.0.1:5050' } }),
        },
        '../fluxNetworkHelper': {
          getNumberOfPeers: sinon.stub().returns(15),
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves({ status: true }),
          removeDockerContainerAccessToNonRoutable: sinon.stub().resolves(true),
          getLocalSocketAddress: sinon.stub().resolves('1.2.3.4:16127'),
        },
        '../geolocationService': { isStaticIP: sinon.stub().returns(true) },
        '../dockerService': {
          dockerListContainers: sinon.stub().resolves([]),
          pruneContainers: sinon.stub().resolves(),
          pruneNetworks: sinon.stub().resolves(),
          pruneVolumes: sinon.stub().resolves(),
          createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
          getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
          appDockerCreate: sinon.stub().resolves(),
          appDockerStart: sinon.stub().resolves('container-started'),
          getAppIdentifier: sinon.stub().returns('testapp'),
          dockerPullStream: sinon.stub().resolves('pulled'),
        },
        './appUninstaller': { removeAppLocally: sinon.stub().resolves() },
        './advancedWorkflows': { createAppVolume: sinon.stub().resolves() },
        './appNetworkLinker': {
          reconnectLinkedApps: sinon.stub().resolves(),
          checkAppNetworkRequirements: sinon.stub().resolves(),
          connectComponentToLinkedApps: sinon.stub().resolves(),
        },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
          broadcastMessageToAll: sinon.stub().resolves(),
        },
        '../appMessaging/messageStore': {
          storeAppRunningMessage: sinon.stub().resolves(),
          storeAppInstallingErrorMessage: sinon.stub().resolves(),
        },
        '../appSystem/systemIntegration': { systemArchitecture: sinon.stub().resolves('amd64') },
        '../appSecurity/imageManager': { checkApplicationImagesCompliance: sinon.stub().resolves() },
        '../appManagement/appInspector': { startAppMonitoring: sinon.stub() },
        '../utils/imageVerifier': {
          ImageVerifier: sinon.stub().returns({
            addCredentials: sinon.stub(),
            verifyImage: sinon.stub().resolves(),
            throwIfError: sinon.stub(),
            supported: true,
            provider: 'docker.io',
          }),
        },
        '../pgpService': { decryptMessage: sinon.stub().resolves('user:token') },
        '../upnpService': { isUPNP: sinon.stub().returns(false), mapUpnpPort: sinon.stub().resolves(true) },
        '../utils/globalState': globalStateStub,
        '../utils/fluxEventBus': fluxEventBusStub,
        '../utils/volumeService': { verifyAppVolumeMount: sinon.stub().resolves(), ensureMountPathsExist: sinon.stub().resolves() },
        '../../lib/log': logStub,
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', { config: configStub }),
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
          decryptEnterpriseApps: sinon.stub().callsFake((apps) => Promise.resolve(apps)),
        },
        util: { promisify: (fn) => fn },
      });

      appInstallerSuccess.setOnInstallComplete(onInstallComplete);

      const res = { write: sinon.stub(), end: sinon.stub() };
      const result = await appInstallerSuccess.registerAppLocally(appSpec, false, res);

      expect(result, 'install should succeed').to.equal(InstallResult.INSTALLED);
      expect(onInstallComplete.calledOnce, 'post-install broadcast should fire').to.be.true;
      expect(lockHeldWhenBroadcasting, 'install lock must be released BEFORE broadcasting').to.equal(false);
      expect(globalStateStub.installationInProgress).to.equal(false);
    });
  });

  describe('registerAppLocally - concurrent cancel defers instead of failing, and the finally drops only its own controller', () => {
    // Drives the REAL registerAppLocally try/catch/finally. The throw is triggered the same
    // way the sibling "already installed" FAILED-path test triggers it (the pre-install I/O
    // checks reject) - a stand-in for ANY mid-install failure, including a cancel aborting the
    // in-flight image pull. What these assert is the OUTER catch's classification of that
    // throw and the finally's controller bookkeeping, NOT the throw's origin.
    const appSpec = {
      name: 'testapp', repotag: 'repo/test:1', containerData: '/data', ports: [30000], version: 2,
    };

    function buildRegister({ teardownOwed = false, hasRemoval = () => false, abortOwnController = false } = {}) {
      const removeAppLocally = sinon.stub().resolves();
      const teardownOwedFor = sinon.stub().resolves(teardownOwed);
      const installingApps = new Map();
      const gState = {
        removalInProgress: false,
        installationInProgress: false,
        masterSlaveAppsRunning: false,
        installingApps,
        hasRemovalInProgress: hasRemoval,
        installAborted: (name) => {
          const controller = installingApps.get(name);
          return Boolean(controller && controller.signal && controller.signal.aborted);
        },
      };
      const dbHelperStubLocal = {
        databaseConnection: sinon.stub(),
        findInDatabase: sinon.stub(),
        findOneInDatabase: sinon.stub().resolves({ name: 'testapp' }),
        insertOneToDatabase: sinon.stub(),
      };
      const mod = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': dbHelperStubLocal,
        './pendingTeardownStore': { teardownOwedFor },
        '../serviceHelper': {
          ensureString: sinon.stub().callsFake((param) => (typeof param === 'string' ? param : JSON.stringify(param))),
          ensureNumber: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../generalService': {
          // nodeTier runs right after this install registers its AbortController. When
          // abortOwnController is set, abort it here to model a cancel that fired mid-install,
          // then return a tier so the install proceeds to its later throw.
          nodeTier: sinon.stub().callsFake(async () => {
            if (abortOwnController) {
              const controller = installingApps.get('testapp');
              if (controller) controller.abort();
            }
            return 'cumulus';
          }),
          checkSynced: sinon.stub().resolves(true),
        },
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({ status: 'success', data: { ipaddress: '127.0.0.1:5050' } }),
        },
        '../fluxNetworkHelper': {
          getNumberOfPeers: sinon.stub().returns(15),
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves({ status: true }),
          removeDockerContainerAccessToNonRoutable: sinon.stub().resolves(true),
        },
        '../geolocationService': { isStaticIP: sinon.stub().returns(true) },
        '../dockerService': {
          dockerListContainers: sinon.stub().resolves([]),
          pruneContainers: sinon.stub().resolves(),
          pruneNetworks: sinon.stub().resolves(),
          pruneVolumes: sinon.stub().resolves(),
          createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
          getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
          appDockerCreate: sinon.stub().resolves(),
          appDockerStart: sinon.stub().resolves('container-started'),
          getAppIdentifier: sinon.stub().returns('testapp'),
          dockerPullStream: sinon.stub().resolves('pulled'),
        },
        './appUninstaller': { removeAppLocally },
        './advancedWorkflows': { createAppVolume: sinon.stub().resolves() },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
        },
        '../appMessaging/messageStore': {
          storeAppRunningMessage: sinon.stub().resolves(),
          storeAppInstallingErrorMessage: sinon.stub().resolves(),
        },
        '../appSystem/systemIntegration': { systemArchitecture: sinon.stub().resolves('amd64') },
        '../appSecurity/imageManager': { checkApplicationImagesCompliance: sinon.stub().resolves() },
        '../appManagement/appInspector': { startAppMonitoring: sinon.stub() },
        '../utils/imageVerifier': {
          ImageVerifier: sinon.stub().returns({
            addCredentials: sinon.stub(), verifyImage: sinon.stub().resolves(), throwIfError: sinon.stub(), supported: true, provider: 'docker.io',
          }),
        },
        '../pgpService': { decryptMessage: sinon.stub().resolves('user:token') },
        '../upnpService': { isUPNP: sinon.stub().returns(false), mapUpnpPort: sinon.stub().resolves(true) },
        '../utils/globalState': gState,
        '../../lib/log': logStub,
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', { config: configStub }),
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
        util: { promisify: (fn) => fn },
      });
      return {
        mod, removeAppLocally, teardownOwedFor, installingApps, gState,
      };
    }

    it('a throw while a cancel is in flight (hasRemovalInProgress) returns DEFERRED, not FAILED, and runs no cleanup', async () => {
      // The cancel arrives AFTER the entry gate: hasRemovalInProgress reads false at the 404
      // gate, then true by the time the catch runs (the cancel set it while we were mid-install).
      let entered = false;
      const hasRemoval = () => {
        if (!entered) { entered = true; return false; }
        return true;
      };
      const { mod, removeAppLocally } = buildRegister({ hasRemoval });
      const res = { write: sinon.stub(), end: sinon.stub(), flush: sinon.stub() };

      const result = await mod.registerAppLocally(appSpec, false, res);

      expect(result, 'a cancel-aborted install must DEFER (not poison the spawner 7-day cache)').to.equal(InstallResult.DEFERRED);
      expect(removeAppLocally.called, 'the in-flight cancel owns teardown; we must NOT run our own cleanup').to.be.false;
      expect(res.end.called, 'the deferred bail must end the REST stream, not leave the caller hanging').to.be.true;
    });

    it('a throw while a teardown is owed (durable doc) returns DEFERRED and runs no cleanup', async () => {
      const { mod, removeAppLocally } = buildRegister({ teardownOwed: true });
      const res = { write: sinon.stub(), end: sinon.stub(), flush: sinon.stub() };

      const result = await mod.registerAppLocally(appSpec, false, res);

      expect(result, 'an owed teardown (or a fail-closed DB blip) must DEFER, not FAIL').to.equal(InstallResult.DEFERRED);
      expect(removeAppLocally.called, 'the owed teardown owns cleanup; we must NOT run our own').to.be.false;
    });

    it('DEFERS off the latching abort signal even when BOTH transient signals have already cleared', async () => {
      // The tail race: a backgrounded teardown clears hasRemovalInProgress (the instant it is
      // dispatched) AND teardownOwedFor (at FINISH) before this slower catch runs - but the
      // install's own AbortController stays aborted (it latches). Relying on the two transient
      // signals alone would misclassify this as FAILED and 7-day-poison a pinned enterprise app.
      const { mod, removeAppLocally } = buildRegister({ hasRemoval: () => false, teardownOwed: false, abortOwnController: true });
      const res = { write: sinon.stub(), end: sinon.stub(), flush: sinon.stub() };

      const result = await mod.registerAppLocally(appSpec, false, res);

      expect(result, 'an aborted install must DEFER even with both transient signals cleared').to.equal(InstallResult.DEFERRED);
      expect(removeAppLocally.called, 'the cancel owns teardown; we must NOT run our own cleanup').to.be.false;
    });

    it('the finally drops ONLY this call\'s controller - an early bail leaves a peer install\'s controller intact', async () => {
      // Another same-name install (A) is already in flight with a registered controller. THIS
      // call bails at the early "another install underway" gate, BEFORE registering its own
      // controller, so its finally must NOT delete A's controller by name (which would leave a
      // concurrent cancel unable to abort A's pull).
      const { mod, installingApps, gState } = buildRegister();
      const peerController = new AbortController();
      installingApps.set('testapp', peerController);
      gState.installationInProgress = true; // forces the early DEFERRED bail (before the set)

      const res = { write: sinon.stub(), end: sinon.stub(), flush: sinon.stub() };
      const result = await mod.registerAppLocally(appSpec, false, res);

      expect(result, 'a second same-name install must defer while the first is underway').to.equal(InstallResult.DEFERRED);
      expect(installingApps.get('testapp'), 'peer install A\'s controller must survive our early-bail finally').to.equal(peerController);
    });
  });

  describe('a cancel-induced install unwind does not broadcast a network-wide install error', () => {
    // Drives the REAL registerAppLocally all the way into installApplicationHard, then makes the
    // container create reject so the install throws INSIDE the inner try - the spot whose catch
    // builds and broadcasts a fluxappinstallingerror before the outer catch classifies the
    // unwind. When a concurrent cancel is in flight, that broadcast must be suppressed (we are
    // deliberately tearing the app down); a genuine failure must still broadcast.
    const appSpec = {
      name: 'testapp', repotag: 'repo/test:1', containerData: '/data', ports: [30000], version: 2,
    };

    function buildInstallThatThrows({ cancelInFlight = false, hasRemoval = false, teardownOwed = false } = {}) {
      const fluxEventBusStub = { publish: sinon.stub(), subscribe: sinon.stub() };
      const broadcastMessageToAll = sinon.stub().resolves();
      const storeAppInstallingErrorMessage = sinon.stub().resolves();
      const gState = {
        removalInProgress: false,
        installationInProgress: false,
        masterSlaveAppsRunning: false,
        installingApps: new Map(),
        hasRemovalInProgress: () => hasRemoval,
        installAborted: () => cancelInFlight,
      };
      const dbHelperStubLocal = {
        databaseConnection: sinon.stub().returns({ db: () => ({ collection: () => ({}) }) }),
        findInDatabase: sinon.stub().resolves([]),
        // 1st call = "already installed?" -> null (proceed). Later calls (post-insert
        // validation) -> truthy so the install reaches installApplicationHard.
        findOneInDatabase: (() => {
          const s = sinon.stub().resolves({ name: 'testapp' });
          s.onFirstCall().resolves(null);
          return s;
        })(),
        findOneAndDeleteInDatabase: sinon.stub().resolves(),
        insertOneToDatabase: sinon.stub().resolves({ insertedId: 'id' }),
      };
      const mod = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': dbHelperStubLocal,
        './pendingTeardownStore': { teardownOwedFor: sinon.stub().resolves(teardownOwed) },
        '../serviceHelper': {
          ensureString: sinon.stub().callsFake((param) => (typeof param === 'string' ? param : JSON.stringify(param))),
          ensureNumber: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../generalService': {
          nodeTier: sinon.stub().resolves('cumulus'),
          checkSynced: sinon.stub().resolves(true),
        },
        '../benchmarkService': {
          getBenchmarks: sinon.stub().resolves({ status: 'success', data: { ipaddress: '127.0.0.1:5050' } }),
        },
        '../fluxNetworkHelper': {
          getNumberOfPeers: sinon.stub().returns(15),
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves({ status: true }),
          removeDockerContainerAccessToNonRoutable: sinon.stub().resolves(true),
          getLocalSocketAddress: sinon.stub().resolves('1.2.3.4:16127'),
        },
        '../geolocationService': { isStaticIP: sinon.stub().returns(true) },
        '../dockerService': {
          dockerListContainers: sinon.stub().resolves([]),
          pruneContainers: sinon.stub().resolves(),
          pruneNetworks: sinon.stub().resolves(),
          pruneVolumes: sinon.stub().resolves(),
          createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
          getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
          // The throw INSIDE installApplicationHard (and thus inside the inner try) - stands in
          // for the cancel aborting the in-flight pull / container create.
          appDockerCreate: sinon.stub().rejects(new Error('install interrupted mid-create')),
          appDockerStart: sinon.stub().resolves('container-started'),
          getAppIdentifier: sinon.stub().returns('testapp'),
          dockerPullStream: sinon.stub().resolves('pulled'),
        },
        './appUninstaller': { removeAppLocally: sinon.stub().resolves() },
        './advancedWorkflows': { createAppVolume: sinon.stub().resolves() },
        './appNetworkLinker': {
          reconnectLinkedApps: sinon.stub().resolves(),
          checkAppNetworkRequirements: sinon.stub().resolves(),
          connectComponentToLinkedApps: sinon.stub().resolves(),
        },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
          broadcastMessageToAll,
        },
        '../appMessaging/messageStore': {
          storeAppRunningMessage: sinon.stub().resolves(),
          storeAppInstallingErrorMessage,
        },
        '../appSystem/systemIntegration': { systemArchitecture: sinon.stub().resolves('amd64') },
        '../appSecurity/imageManager': { checkApplicationImagesCompliance: sinon.stub().resolves() },
        '../appManagement/appInspector': { startAppMonitoring: sinon.stub() },
        '../utils/imageVerifier': {
          ImageVerifier: sinon.stub().returns({
            addCredentials: sinon.stub(), verifyImage: sinon.stub().resolves(), throwIfError: sinon.stub(), supported: true, provider: 'docker.io',
          }),
        },
        '../pgpService': { decryptMessage: sinon.stub().resolves('user:token') },
        '../upnpService': { isUPNP: sinon.stub().returns(false), mapUpnpPort: sinon.stub().resolves(true) },
        '../utils/globalState': gState,
        '../utils/fluxEventBus': fluxEventBusStub,
        '../utils/volumeService': { verifyAppVolumeMount: sinon.stub().resolves(), ensureMountPathsExist: sinon.stub().resolves() },
        '../../lib/log': logStub,
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', { config: configStub }),
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
          decryptEnterpriseApps: sinon.stub().callsFake((apps) => Promise.resolve(apps)),
        },
        util: { promisify: (fn) => fn },
      });
      return { mod, broadcastMessageToAll, storeAppInstallingErrorMessage };
    }

    it('suppresses the fluxappinstallingerror store + broadcast when a cancel aborted the install', async () => {
      const { mod, broadcastMessageToAll, storeAppInstallingErrorMessage } = buildInstallThatThrows({ cancelInFlight: true });
      const res = { write: sinon.stub(), end: sinon.stub(), flush: sinon.stub() };

      const result = await mod.registerAppLocally(appSpec, false, res);

      expect(result, 'a cancel-aborted install must DEFER, not FAIL').to.equal(InstallResult.DEFERRED);
      expect(broadcastMessageToAll.called, 'must NOT tell the network an app we are tearing down failed to install').to.be.false;
      expect(storeAppInstallingErrorMessage.called, 'must NOT persist an install-error doc for a deliberately cancelled app').to.be.false;
    });

    it('still broadcasts the install error on a genuine failure with no cancel in flight', async () => {
      const { mod, broadcastMessageToAll, storeAppInstallingErrorMessage } = buildInstallThatThrows({ cancelInFlight: false, hasRemoval: false, teardownOwed: false });
      const res = { write: sinon.stub(), end: sinon.stub(), flush: sinon.stub() };

      const result = await mod.registerAppLocally(appSpec, false, res);

      expect(result, 'a genuine install failure is FAILED').to.equal(InstallResult.FAILED);
      expect(storeAppInstallingErrorMessage.calledOnce, 'a real failure must persist the install-error doc').to.be.true;
      expect(broadcastMessageToAll.calledOnce, 'a real failure must still broadcast it network-wide').to.be.true;
      expect(broadcastMessageToAll.firstCall.args[0].type, 'the broadcast is a fluxappinstallingerror').to.equal('fluxappinstallingerror');
    });
  });

  describe('prune guard with encrypted enterprise apps', () => {
    it('should call decryptEnterpriseApps on installed apps during registration', async () => {
      const encryptedApp = {
        version: 8,
        name: 'enterpriseapp123',
        compose: [],
        enterprise: 'encryptedblob',
      };
      const decryptedApp = {
        version: 8,
        name: 'enterpriseapp123',
        compose: [{ name: 'MyComponent', containerData: 'r:' }],
        enterprise: 'encryptedblob',
      };
      const decryptEnterpriseAppsStub = sinon.stub().resolves([decryptedApp]);
      const pruneContainersStub = sinon.stub().resolves();

      // Use proxyquire without noCallThru so lazy requires are intercepted
      const appInstallerFresh = proxyquire.noCallThru().load('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': {
          databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
          findInDatabase: sinon.stub().resolves([]),
          findOneInDatabase: sinon.stub().resolves(null),
          insertOneToDatabase: sinon.stub().resolves(),
        },
        // teardownOwedFor now fails CLOSED on a DB read error; mock it so the real module's
        // unconnected-Mongo read does not defer this install.
        './pendingTeardownStore': { teardownOwedFor: sinon.stub().resolves(false) },
        '../serviceHelper': { ensureString: sinon.stub().returnsArg(0), ensureNumber: sinon.stub().returnsArg(0), delay: sinon.stub().resolves() },
        '../generalService': { nodeTier: sinon.stub().resolves('cumulus'), checkSynced: sinon.stub().resolves(true) },
        '../daemonService/daemonServiceMiscRpcs': { isDaemonSynced: sinon.stub().returns({ status: 'success', data: { synced: true, height: 2094961 } }) },
        '../fluxNetworkHelper': {
          getLocalSocketAddress: sinon.stub().resolves('192.168.1.1:16127'),
          getNumberOfPeers: sinon.stub().returns(15),
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves({ status: true }),
          removeDockerContainerAccessToNonRoutable: sinon.stub().resolves(true),
        },
        '../geolocationService': { isStaticIP: sinon.stub().returns(true) },
        '../dockerService': {
          dockerListContainers: sinon.stub().resolves([]),
          pruneContainers: pruneContainersStub,
          pruneNetworks: sinon.stub().resolves(),
          pruneVolumes: sinon.stub().resolves(),
          createFluxAppDockerNetwork: sinon.stub().resolves('net'),
          getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
          appDockerCreate: sinon.stub().resolves(),
          appDockerStart: sinon.stub().resolves('ok'),
          getAppIdentifier: sinon.stub().returns('testapp'),
          dockerPullStream: sinon.stub().resolves('pulled'),
        },
        './appUninstaller': { removeAppLocally: sinon.stub().resolves() },
        './advancedWorkflows': { createAppVolume: sinon.stub().resolves() },
        '../fluxCommunicationMessagesSender': { broadcastMessageToOutgoing: sinon.stub().resolves(), broadcastMessageToIncoming: sinon.stub().resolves() },
        '../appMessaging/messageStore': { storeAppRunningMessage: sinon.stub().resolves(), storeAppInstallingErrorMessage: sinon.stub().resolves() },
        '../appSystem/systemIntegration': { systemArchitecture: sinon.stub().resolves('amd64') },
        '../appSecurity/imageManager': { checkApplicationImagesCompliance: sinon.stub().resolves(), verifyRepository: sinon.stub().resolves({ verified: true, supportedArchitectures: ['amd64'] }) },
        '../appManagement/appInspector': { startAppMonitoring: sinon.stub() },
        '../utils/imageVerifier': { ImageVerifier: sinon.stub().returns({ addCredentials: sinon.stub(), verifyImage: sinon.stub().resolves(), throwIfError: sinon.stub(), supported: true, provider: 'docker.io' }) },
        '../pgpService': { decryptMessage: sinon.stub().resolves('user:token') },
        '../upnpService': { isUPNP: sinon.stub().returns(false), mapUpnpPort: sinon.stub().resolves(true) },
        '../utils/enterpriseHelper': enterpriseHelperStub,
        '../utils/appSpecHelpers': appSpecHelpersStub,
        '../utils/globalState': { removalInProgress: false, installationInProgress: false, masterSlaveAppsRunning: false, installingApps: new Map(), hasRemovalInProgress: () => false },
        '../../lib/log': logStub,
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', { config: configStub }),
        '../appMessaging/messageVerifier': messageVerifierStub,
        '../appDatabase/registryManager': { availableApps: sinon.stub().resolves([]), getApplicationGlobalSpecifications: sinon.stub().resolves(null) },
        '../appRequirements/hwRequirements': hwRequirementsStub,
        '../appQuery/appQueryService': {
          installedApps: sinon.stub().resolves({ status: 'success', data: [encryptedApp] }),
          listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
          decryptEnterpriseApps: decryptEnterpriseAppsStub,
        },
        '../utils/registryCredentialHelper': { addCredentialsToImageVerifier: sinon.stub().resolves() },
        util: { promisify: (fn) => fn },
      });

      const newAppSpec = { version: 2, name: 'newapp', description: 'test', repotag: 'test/app', owner: '1abc', ports: [30000], containerPorts: [8080], domains: [''], cpu: 0.5, ram: 500, hdd: 5 };
      // registerAppLocally will proceed past the prune guard before eventually failing on network setup
      try {
        await appInstallerFresh.registerAppLocally(newAppSpec, false, null);
      } catch (e) {
        // Expected — we only care that the prune guard logic ran correctly
      }

      expect(decryptEnterpriseAppsStub.calledOnce).to.be.true;
      expect(decryptEnterpriseAppsStub.calledWith([encryptedApp], { formatSpecs: false })).to.be.true;
      // Decrypted enterprise app has a stopped component (MyComponent_enterpriseapp123 not running)
      // so pruneContainers should NOT be called
      expect(pruneContainersStub.called).to.be.false;
    });
  });

  describe('installApplicationHard cancel-during-install re-check (C2) tests', () => {
    // Drive the real installApplicationHard (skipPorts) through the real verifyAndPullImage
    // up to the post-pull condemned re-check, so this exercises the actual call site - not a
    // stand-in for throwIfCondemnedMidInstall.
    const appSpec = {
      name: 'testapp', repotag: 'repo/test:1', containerData: '/data', ports: [30000], version: 2,
    };

    function build(isCondemnedValue, teardownOwedValue = false, isCondemnedStub = null) {
      const dockerStub = {
        dockerPullStream: sinon.stub().resolves('pulled'),
        appDockerCreate: sinon.stub().resolves(),
        appDockerStart: sinon.stub().resolves('started'),
        getAppIdentifier: sinon.stub().returns('fluxtestapp'),
      };
      const advancedWorkflowsStub = { createAppVolume: sinon.stub().resolves() };
      const volumeServiceStub = { verifyAppVolumeMount: sinon.stub().resolves(), ensureMountPathsExist: sinon.stub().resolves() };
      // isCondemnedStub lets a test vary the answer per call (e.g. false at the post-pull check,
      // true at the later pre-create check); otherwise a constant value is used.
      const appsRuntimeStateStub = { isCondemned: isCondemnedStub || sinon.stub().resolves(isCondemnedValue), setCondemned: sinon.stub().resolves() };
      const pendingTeardownStoreStub = { teardownOwedFor: sinon.stub().resolves(teardownOwedValue) };
      const mod = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
        './appNetworkLinker': { checkAppNetworkRequirements: sinon.stub().resolves(), connectComponentToLinkedApps: sinon.stub().resolves() },
        '../appSystem/systemIntegration': { systemArchitecture: sinon.stub().resolves('amd64') },
        '../appSecurity/imageManager': { checkApplicationImagesCompliance: sinon.stub().resolves() },
        '../utils/imageVerifier': {
          ImageVerifier: sinon.stub().returns({
            addCredentials: sinon.stub(), verifyImage: sinon.stub().resolves(), throwIfError: sinon.stub(), supported: true, provider: 'docker.io',
          }),
        },
        '../dockerService': dockerStub,
        './advancedWorkflows': advancedWorkflowsStub,
        '../utils/volumeService': volumeServiceStub,
        '../utils/globalState': { installingApps: new Map() },
        '../appManagement/appsRuntimeState': appsRuntimeStateStub,
        './pendingTeardownStore': pendingTeardownStoreStub,
        '../appManagement/appInspector': { startAppMonitoring: sinon.stub() },
        util: { promisify: (fn) => fn },
      });
      return {
        mod, dockerStub, advancedWorkflowsStub,
      };
    }

    afterEach(() => {
      sinon.restore();
    });

    it('ABORTS before creating the volume/starting the container when condemned mid-install', async () => {
      const { mod, dockerStub, advancedWorkflowsStub } = build(true);
      const res = { write: sinon.stub(), flush: sinon.stub() };

      let threw = false;
      try {
        await mod.installApplicationHard(appSpec, 'testapp', false, res, appSpec, false, true); // skipPorts=true
      } catch (e) {
        threw = true;
        expect(e.message).to.match(/aborted/);
      }

      expect(threw, 'install should abort when condemned mid-install').to.be.true;
      expect(advancedWorkflowsStub.createAppVolume.called, 'must NOT create the volume').to.be.false;
      expect(dockerStub.appDockerStart.called, 'must NOT start the container').to.be.false;
    });

    it('PROCEEDS past the re-check when not condemned (no spurious abort)', async () => {
      const { mod, dockerStub, advancedWorkflowsStub } = build(false);
      const res = { write: sinon.stub(), flush: sinon.stub() };

      await mod.installApplicationHard(appSpec, 'testapp', false, res, appSpec, false, true);

      expect(advancedWorkflowsStub.createAppVolume.calledOnce, 'volume created').to.be.true;
      expect(dockerStub.appDockerStart.calledOnce, 'container started').to.be.true;
    });

    it('installApplicationSoft ABORTS before creating/starting the container when condemned mid-install', async () => {
      const { mod, dockerStub } = build(true);
      const res = { write: sinon.stub(), flush: sinon.stub() };

      let threw = false;
      try {
        await mod.installApplicationSoft(appSpec, 'testapp', false, res, appSpec, true); // skipPorts=true
      } catch (e) {
        threw = true;
        expect(e.message).to.match(/aborted/);
      }

      expect(threw, 'soft install should abort when condemned mid-install').to.be.true;
      expect(dockerStub.appDockerCreate.called, 'must NOT create the container').to.be.false;
      expect(dockerStub.appDockerStart.called, 'must NOT start the container').to.be.false;
    });

    it('installApplicationSoft PROCEEDS past the re-check when not condemned', async () => {
      const { mod, dockerStub } = build(false);
      const res = { write: sinon.stub(), flush: sinon.stub() };

      await mod.installApplicationSoft(appSpec, 'testapp', false, res, appSpec, true);

      expect(dockerStub.appDockerCreate.calledOnce, 'container created').to.be.true;
      expect(dockerStub.appDockerStart.calledOnce, 'container started').to.be.true;
    });

    it('ABORTS via the durable doc even when the condemned stamp was erased (F-A: clear cannot disarm the backstop)', async () => {
      // isCondemned=false models clearCondemnedStampsForInstall having erased a concurrent
      // cancel's stamp (last-writer-wins); the cancel's pendingAppTeardowns doc is NOT erasable
      // by the install (teardownOwed=true), so the backstop must STILL fire.
      const { mod, dockerStub, advancedWorkflowsStub } = build(false, true);
      const res = { write: sinon.stub(), flush: sinon.stub() };

      let threw = false;
      try {
        await mod.installApplicationHard(appSpec, 'testapp', false, res, appSpec, false, true);
      } catch (e) {
        threw = true;
        expect(e.message).to.match(/aborted/);
      }

      expect(threw, 'should abort on an owed teardown doc even with no condemned stamp').to.be.true;
      expect(advancedWorkflowsStub.createAppVolume.called, 'must NOT create the volume').to.be.false;
      expect(dockerStub.appDockerStart.called, 'must NOT start the container').to.be.false;
    });

    // A g:/r: (syncthing/data) app SKIPS the pre-START backstop, so the pre-CREATE re-check is
    // its only guard against a cancel that condemns it AFTER the post-pull check but before the
    // container is created. isCondemned: false at the post-pull check, true at the pre-create one.
    function condemnedAfterPull() {
      const stub = sinon.stub();
      stub.onFirstCall().resolves(false); // post-pull re-check passes
      stub.resolves(true); // a cancel has condemned the app by the pre-create re-check
      return stub;
    }
    const dataAppSpec = {
      name: 'testapp', repotag: 'repo/test:1', containerData: 'g:/data', ports: [30000], version: 2,
    };

    it('installApplicationHard ABORTS before creating the container for a g:/r: app condemned after the pull (pre-create backstop)', async () => {
      const { mod, dockerStub, advancedWorkflowsStub } = build(false, false, condemnedAfterPull());
      const res = { write: sinon.stub(), flush: sinon.stub() };

      let threw = false;
      try {
        await mod.installApplicationHard(dataAppSpec, 'testapp', false, res, dataAppSpec, false, true);
      } catch (e) {
        threw = true;
        expect(e.message).to.match(/aborted/);
      }

      expect(threw, 'must abort at the pre-create backstop').to.be.true;
      // the post-pull check passed, so the volume WAS created - but the container must NOT be
      expect(advancedWorkflowsStub.createAppVolume.calledOnce, 'volume created (post-pull check passed)').to.be.true;
      expect(dockerStub.appDockerCreate.called, 'must NOT create the container').to.be.false;
    });

    it('installApplicationSoft ABORTS before creating the container for a g:/r: app condemned after the pull (pre-create backstop)', async () => {
      const { mod, dockerStub } = build(false, false, condemnedAfterPull());
      const res = { write: sinon.stub(), flush: sinon.stub() };

      let threw = false;
      try {
        await mod.installApplicationSoft(dataAppSpec, 'testapp', false, res, dataAppSpec, true);
      } catch (e) {
        threw = true;
        expect(e.message).to.match(/aborted/);
      }

      expect(threw, 'must abort at the pre-create backstop').to.be.true;
      expect(dockerStub.appDockerCreate.called, 'must NOT create the container').to.be.false;
    });
  });
});
