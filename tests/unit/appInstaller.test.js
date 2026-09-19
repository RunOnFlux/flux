const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { resetGlobalState } = require('./fixtures/globalState');

const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
const { InstallOutcome } = require('../../ZelBack/src/services/utils/installOutcome');

// The full-install dockerService stub, shared by every proxyquire setup that
// drives registerAppLocally. Pass overrides for the few tests that need a
// specific return (e.g. a distinct getAppIdentifier or a shared pruneImages
// spy). Fresh sinon stubs per call, so each proxyquired module gets its own.
const makeDockerServiceStub = (overrides = {}) => ({
  dockerListContainers: sinon.stub().resolves([]),
  pruneImages: sinon.stub().resolves(),
  dockerNetworkState: sinon.stub().resolves('absent'),
  getFreeFluxAppNetworkOctet: sinon.stub().resolves(1),
  createFluxAppDockerNetwork: sinon.stub().resolves('network-created'),
  getFluxDockerNetworkPhysicalInterfaceNames: sinon.stub().resolves([]),
  appDockerCreate: sinon.stub().resolves(),
  appDockerStart: sinon.stub().resolves('container-started'),
  getAppIdentifier: sinon.stub().returns('testapp'),
  pullImage: sinon.stub().resolves('pulled'),
  ...overrides,
});

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

    // The real module, reset - see tests/unit/fixtures/globalState.js.
    globalStateStub = resetGlobalState();
    // Installing reads the blocked-repository list out of the signed bundle, so a node that
    // does not hold policy refuses before it pulls anything. Every case here is about what
    // a node that CAN install does; the refusal before policy has its own case below.
    globalStateStub.policyReady = true;

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
      '../dockerService': makeDockerServiceStub({ pullImage: sinon.stub().resolves('pulled') }),
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
        decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
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
        end: sinon.stub(),
        writableEnded: false,
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await appInstaller.installAppLocally(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.calledWith(Privilege.USER, authOf(req))).to.be.true;
    });

    it('should handle missing appname parameter', async () => {
      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.stub(),
        end: sinon.stub(),
        writableEnded: false,
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
        end: sinon.stub(),
        writableEnded: false,
      };

      verificationHelperStub.verifyPrivilege.withArgs(Privilege.USER, authOf(req)).resolves(true);
      verificationHelperStub.verifyPrivilege.withArgs(Privilege.FLUX_TEAM, authOf(req)).resolves(true);

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

  // Placing a registered app on a node is not the operator's call, for the same
  // reason removing one is not. The temporary-message route is deliberately NOT
  // closed with it - that is how an app is tested before it is registered.
  describe('local install is not the node operator\'s to make', () => {
    const nameInstall = () => ({ params: { appname: 'someCustomerApp' }, query: {} });

    it('refuses a node admin installing a registered app by name', async () => {
      const req = nameInstall();
      const res = { json: sinon.stub(), setHeader: sinon.stub(), end: sinon.stub(), writableEnded: false };

      verificationHelperStub.verifyPrivilege.withArgs(Privilege.USER, authOf(req)).resolves(true);
      // the node operator's own privilege - held, and no longer sufficient here
      verificationHelperStub.verifyPrivilege.withArgs(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req)).resolves(true);
      verificationHelperStub.verifyPrivilege.withArgs(Privilege.FLUX_TEAM, authOf(req)).resolves(false);
      messageVerifierStub.checkAppTemporaryMessageExistence.resolves(null);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await appInstaller.installAppLocally(req, res);

      expect(verificationHelperStub.verifyPrivilege.calledWith(Privilege.FLUX_TEAM, authOf(req)), 'the gate must ask for fluxteam').to.be.true;
      expect(res.json.calledOnce).to.be.true;
      expect(res.json.firstCall.args[0].data.message).to.equal('Unauthorized');
    });

    it('refuses a node admin on the test-install route too', async () => {
      const req = nameInstall();
      const res = { json: sinon.stub(), setHeader: sinon.stub(), end: sinon.stub(), writableEnded: false };

      verificationHelperStub.verifyPrivilege.withArgs(Privilege.USER, authOf(req)).resolves(true);
      verificationHelperStub.verifyPrivilege.withArgs(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req)).resolves(true);
      verificationHelperStub.verifyPrivilege.withArgs(Privilege.FLUX_TEAM, authOf(req)).resolves(false);
      messageVerifierStub.checkAppTemporaryMessageExistence.resolves(null);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await appInstaller.testAppInstall(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(res.json.firstCall.args[0].data.message).to.equal('Unauthorized');
    });

    // The one that must keep working: an app under test is addressed by HASH and
    // carries a temporary message, so it never reaches the by-name gate at all.
    it('still lets any logged-in user install an app under test by its temporary message', async () => {
      const req = { params: { appname: 'a1b2c3hash' }, query: {} };
      const res = { json: sinon.stub(), setHeader: sinon.stub(), write: sinon.stub(), end: sinon.stub(), writableEnded: false };

      verificationHelperStub.verifyPrivilege.withArgs(Privilege.USER, authOf(req)).resolves(true);
      verificationHelperStub.verifyPrivilege.withArgs(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req)).resolves(false);
      verificationHelperStub.verifyPrivilege.withArgs(Privilege.FLUX_TEAM, authOf(req)).resolves(false);
      messageVerifierStub.checkAppTemporaryMessageExistence.resolves({
        appSpecifications: { name: 'apptest', version: 3, owner: 'someone' },
      });
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await appInstaller.installAppLocally(req, res);

      // It got past the gate: no Unauthorized was returned, and the by-name
      // privilege was never consulted because a temporary message was found.
      const unauthorized = res.json.getCalls().some((c) => c.args[0]?.data?.message === 'Unauthorized');
      expect(unauthorized, 'a temporary app must not be refused').to.equal(false);
      expect(verificationHelperStub.verifyPrivilege.calledWith(Privilege.FLUX_TEAM, authOf(req)), 'the by-name gate must not be reached').to.be.false;
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
        end: sinon.stub(),
        writableEnded: false,
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await appInstaller.testAppInstall(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.calledWith(Privilege.USER, authOf(req))).to.be.true;
    });

    it('should handle missing appname parameter', async () => {
      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.stub(),
        end: sinon.stub(),
        writableEnded: false,
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
        end: sinon.stub(),
        writableEnded: false,
      };

      verificationHelperStub.verifyPrivilege.withArgs(Privilege.USER, authOf(req)).resolves(true);
      verificationHelperStub.verifyPrivilege.withArgs(Privilege.FLUX_TEAM, authOf(req)).resolves(true);

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
        end: sinon.stub(),
        writableEnded: false,
      };

      verificationHelperStub.verifyPrivilege.withArgs(Privilege.USER, authOf(req)).resolves(true);
      verificationHelperStub.verifyPrivilege.withArgs(Privilege.FLUX_TEAM, authOf(req)).resolves(true);

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
        '../dockerService': makeDockerServiceStub({ getAppIdentifier: sinon.stub().returns('multiarchapp') }),
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

    // The rule the response ownership rests on, pinned where it can regress.
    // registerAppLocally has six places that used to close the response and no
    // way to enforce that they stay closed-free - the endpoint above it owns the
    // close, and an installer that ends the stream makes every later write, INCLUDING
    // the failure that caused it, land in a response that is already over. That is
    // how a failed hard redeploy came to answer with the teardown's
    // "was successfuly removed" as the last thing the caller saw.
    it('never closes a response it was handed, on any path', async () => {
      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      globalStateStub.removalInProgress = true;
      await appInstaller.registerAppLocally(appSpec, false, res);
      globalStateStub.removalInProgress = false;

      globalStateStub.installationInProgress = true;
      await appInstaller.registerAppLocally(appSpec, false, res);
      globalStateStub.installationInProgress = false;

      expect(res.write.called, 'it must still report what happened').to.be.true;
      expect(res.end.called, 'the endpoint that opened the response is the only thing that closes it').to.be.false;
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
      // Nothing was touched, which is not the same answer as an install that
      // failed and tore the app down - a caller acting on the second when it
      // got the first destroys a running app.
      expect(result).to.equal(InstallOutcome.BUSY);
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
      // Nothing was touched, which is not the same answer as an install that
      // failed and tore the app down - a caller acting on the second when it
      // got the first destroys a running app.
      expect(result).to.equal(InstallOutcome.BUSY);
      // The hold belongs to the install this call was refused for. Releasing on
      // the way out would hand the node to the next caller while that install is
      // still running.
      expect(globalStateStub.installationInProgress, 'a refusal released someone else\'s hold').to.be.true;
    });

    it('should return false if node tier does not return anything', async () => {
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
        '../dockerService': makeDockerServiceStub(),
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
      // Nothing was touched, which is not the same answer as an install that
      // failed and tore the app down - a caller acting on the second when it
      // got the first destroys a running app.
      expect(result).to.equal(InstallOutcome.DECLINED);
      // The hold was raised one line before the tier lookup and this return used
      // to walk straight past it. The node then refused every install, redeploy,
      // spawn and reinstall pass it was offered until FluxOS restarted.
      expect(globalStateStub.installationInProgress, 'the node is left holding an install that never began').to.be.false;
    });

    // The guard sits behind the socket lookup and the database connection, so a stub missing
    // either answers FAILED from the catch without ever reaching it. Everything below is
    // present for that reason, and appQueryService - the first call PAST the guard - rejects,
    // so a guard that stops matching lands on FAILED rather than running on into the install.
    const installerReachingTheAlreadyInstalledGuard = () => proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
      config: configStub,
      '../messageHelper': messageHelperStub,
      '../dbHelper': {
        databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
        findOneInDatabase: sinon.stub().resolves({ name: 'testapp' }),
        findInDatabase: sinon.stub().resolves([]),
        insertOneToDatabase: sinon.stub().resolves(),
      },
      '../serviceHelper': {
        ensureString: sinon.stub().callsFake((param) => (typeof param === 'string' ? param : JSON.stringify(param))),
        ensureNumber: sinon.stub().returnsArg(0),
        delay: sinon.stub().resolves(),
      },
      '../generalService': {
        nodeTier: sinon.stub().resolves('cumulus'),
        checkSynced: sinon.stub().resolves(true),
      },
      '../fluxNetworkHelper': {
        getLocalSocketAddress: sinon.stub().resolves('192.168.1.1:16127'),
      },
      '../appQuery/appQueryService': {
        installedApps: sinon.stub().rejects(new Error('past the guard')),
        listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
      },
      './appUninstaller': {
        removeAppLocally: sinon.stub().resolves(),
      },
      '../utils/globalState': globalStateStub,
      '../../lib/log': logStub,
      '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
        config: configStub,
      }),
    });

    it('answers ALREADY_INSTALLED when the node already holds the app', async () => {
      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      const result = await installerReachingTheAlreadyInstalledGuard()
        .registerAppLocally(appSpec, false, res);

      // The app is on the node. That is a different answer from an install that was turned
      // away with the app absent, and from one that tore it down: a caller asking whether the
      // node holds the app has its yes here.
      expect(result).to.equal(InstallOutcome.ALREADY_INSTALLED);
      expect(globalStateStub.installationInProgress, 'the hold outlived the attempt that took it').to.be.false;
    });

    it('does not answer ALREADY_INSTALLED for a component when the app row exists', async () => {
      const res = { write: sinon.stub(), flush: sinon.stub(), end: sinon.stub() };

      // Same app row, the one input changed: installing a COMPONENT of an app whose row is
      // already there is the ordinary case, not a refusal. The guard reads both, so it is
      // driven with each one carrying the decision.
      const result = await installerReachingTheAlreadyInstalledGuard()
        .registerAppLocally(appSpec, { name: 'component1' }, res);

      expect(result).to.not.equal(InstallOutcome.ALREADY_INSTALLED);
    });

    // Named for the already-installed guard, but its proxyquire is partial and the
    // install errors before reaching it - which nothing revealed while that guard
    // and the catch both answered `false`. It is a real test of the failure path,
    // so it is named for that instead.
    // One failing install, built twice: the teardown's own behaviour is the
    // uninstaller's, so what these tests own is which answer it is given.
    // Reaches the app's row and then fails, which is the shape a failed placement
    // has: the row is written before the image is fetched, so the claim exists by
    // the time the install gives up. `failBeforeRow` moves the failure ahead of
    // the row instead.
    function buildFailingInstaller(removeAppLocallyStub, { failBeforeRow = false } = {}) {
      const dbHelperStubLocal = {
        databaseConnection: sinon.stub().returns({ db: () => ({ collection: () => ({}) }) }),
        findInDatabase: sinon.stub().resolves([]),
        // 1st call = "already installed?" -> null so the install proceeds.
        findOneInDatabase: (() => {
          const stub = sinon.stub().resolves({ name: 'testapp' });
          stub.onFirstCall().resolves(null);
          return stub;
        })(),
        findOneAndDeleteInDatabase: sinon.stub().resolves(),
        insertOneToDatabase: sinon.stub().resolves({ insertedId: 'id' }),
      };

      return proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../dbHelper': dbHelperStubLocal,
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
          getLocalSocketAddress: sinon.stub().resolves('1.2.3.4:16127'),
        },
        '../geolocationService': {
          isStaticIP: sinon.stub().returns(true),
        },
        '../dockerService': makeDockerServiceStub(),
        './appUninstaller': {
          removeAppLocally: removeAppLocallyStub,
        },
        './appNetworkLinker': {
          reconnectLinkedApps: sinon.stub().resolves(),
          checkAppNetworkRequirements: sinon.stub().resolves(),
          connectComponentToLinkedApps: sinon.stub().resolves(),
        },
        './advancedWorkflows': {
          // The volume is built after the row, so this is the failure a real
          // placement has: the app is claimed, then the install gives up.
          createAppVolume: sinon.stub().rejects(new Error('volume creation failed')),
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
          installedApps: sinon.stub().resolves(
            failBeforeRow ? { status: 'error', data: [] } : { status: 'success', data: [] },
          ),
          listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
          decryptEnterpriseApps: sinon.stub().callsFake((apps) => Promise.resolve({ readable: apps, unreadable: [], inPlace: apps })),
        },
        util: {
          promisify: (fn) => fn,
        },
      });
    }

    it('answers FAILED when an install errors and cleans up after itself', async () => {
      const removeAppLocallyStub = sinon.stub().resolves();
      const appInstallerWithDb = buildFailingInstaller(removeAppLocallyStub);

      const componentSpecs = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      const result = await appInstallerWithDb.registerAppLocally(appSpec, componentSpecs, res);

      expect(logStub.error.called).to.be.true;
      expect(res.write.called).to.be.true;
      // Nothing was touched, which is not the same answer as an install that
      // failed and tore the app down - a caller acting on the second when it
      // got the first destroys a running app.
      expect(result).to.equal(InstallOutcome.FAILED);
    });

    // A caller that already holds the app keeps its claim: a redeploy's teardown
    // says nothing, so peers hold the location row until the app comes back.
    it('leaves the network uninformed when the caller keeps the app', async () => {
      const removeAppLocallyStub = sinon.stub().resolves();
      const appInstallerWithDb = buildFailingInstaller(removeAppLocallyStub);

      await appInstallerWithDb.registerAppLocally(appSpec, false, { write: sinon.stub(), end: sinon.stub() }, false, false);

      expect(removeAppLocallyStub.calledOnce, 'the teardown must have run, or the argument below proves nothing').to.be.true;
      expect(removeAppLocallyStub.firstCall.args[4], 'broadcast a removal for an app the caller is keeping').to.equal(false);
    });

    // A placement this node does not hold: an announcement landing during the
    // install claimed it, and only this retracts that claim before it expires.
    it('tells the network when the caller holds nothing to keep', async () => {
      const removeAppLocallyStub = sinon.stub().resolves();
      const appInstallerWithDb = buildFailingInstaller(removeAppLocallyStub);

      await appInstallerWithDb.registerAppLocally(appSpec, false, { write: sinon.stub(), end: sinon.stub() }, false, true);

      expect(removeAppLocallyStub.calledOnce, 'the teardown must have run, or the argument below proves nothing').to.be.true;
      expect(removeAppLocallyStub.firstCall.args[4], 'tore the app down without telling the network').to.equal(true);
    });

    // The announcement is built from the app's row, so a failure ahead of the row
    // leaves peers nothing of this node's to clear and there is no claim to name.
    it('says nothing to the network when it gave up before the app reached the table', async () => {
      const removeAppLocallyStub = sinon.stub().resolves();
      const appInstallerWithDb = buildFailingInstaller(removeAppLocallyStub, { failBeforeRow: true });

      await appInstallerWithDb.registerAppLocally(appSpec, false, { write: sinon.stub(), end: sinon.stub() }, false, true);

      expect(removeAppLocallyStub.calledOnce, 'the teardown must have run, or the argument below proves nothing').to.be.true;
      expect(removeAppLocallyStub.firstCall.args[4], 'broadcast a removal for an app this node never had').to.equal(false);
    });

    it('runs the post-install broadcast only AFTER releasing the install lock', async () => {
      // The announcement runs for as long as a broadcast cycle takes, and every
      // other install, removal and redeploy on this node refuses while the install
      // lock is up - so the lock is released before onInstallComplete is called.
      let lockHeldWhenBroadcasting = null;
      const onInstallComplete = sinon.stub().callsFake(() => {
        lockHeldWhenBroadcasting = globalStateStub.installationInProgress;
        return Promise.resolve();
      });
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
        '../dockerService': makeDockerServiceStub(),
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
          decryptEnterpriseApps: sinon.stub().callsFake((apps) => Promise.resolve({ readable: apps, unreadable: [], inPlace: apps })),
        },
        util: { promisify: (fn) => fn },
      });

      appInstallerSuccess.setOnInstallComplete(onInstallComplete);

      const res = { write: sinon.stub(), end: sinon.stub() };
      const result = await appInstallerSuccess.registerAppLocally(appSpec, false, res);

      expect(result, 'install should succeed').to.equal(InstallOutcome.INSTALLED);
      expect(onInstallComplete.calledOnce, 'post-install broadcast should fire').to.be.true;
      expect(lockHeldWhenBroadcasting, 'install lock must be released BEFORE broadcasting').to.equal(false);
      expect(globalStateStub.installationInProgress).to.equal(false);
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
      const decryptEnterpriseAppsStub = sinon.stub().resolves({ readable: [decryptedApp], unreadable: [], inPlace: [decryptedApp] });
      const pruneImagesStub = sinon.stub().resolves();

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
        '../dockerService': makeDockerServiceStub({
          pruneImages: pruneImagesStub,
          createFluxAppDockerNetwork: sinon.stub().resolves('net'),
          appDockerStart: sinon.stub().resolves('ok'),
        }),
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
      // Decrypted enterprise app has a stopped component (MyComponent_enterpriseapp123 not running),
      // so the cleanup guard holds and no prune runs
      expect(pruneImagesStub.called).to.be.false;
    });
  });

  describe('ensureAppDockerNetwork tests', () => {
    let appInstallerNet;
    let dockerServiceStub;
    let removeAccessStub;

    beforeEach(() => {
      process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;
      dockerServiceStub = makeDockerServiceStub({ getFreeFluxAppNetworkOctet: sinon.stub().resolves(7) });
      removeAccessStub = sinon.stub().resolves(true);
      appInstallerNet = proxyquire('../../ZelBack/src/services/appLifecycle/appInstaller', {
        '../serviceHelper': { ensureString: sinon.stub().returnsArg(0) },
        '../dockerService': dockerServiceStub,
        '../fluxNetworkHelper': { removeDockerContainerAccessToNonRoutable: removeAccessStub },
        '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('returns early (no create, no firewall rebuild) when the network already exists', async () => {
      dockerServiceStub.dockerNetworkState.resolves('exists');

      const result = await appInstallerNet.ensureAppDockerNetwork('myapp');

      expect(dockerServiceStub.getFreeFluxAppNetworkOctet.called).to.be.false;
      expect(dockerServiceStub.createFluxAppDockerNetwork.called).to.be.false;
      // intact network: its interface is already in DOCKER-USER, so no iptables churn
      expect(dockerServiceStub.getFluxDockerNetworkPhysicalInterfaceNames.called).to.be.false;
      expect(removeAccessStub.called).to.be.false;
      expect(result).to.include('already exists');
    });

    it('creates the network on the lowest free octet when absent', async () => {
      dockerServiceStub.getFreeFluxAppNetworkOctet.resolves(7);

      await appInstallerNet.ensureAppDockerNetwork('myapp');

      expect(dockerServiceStub.createFluxAppDockerNetwork.calledOnceWithExactly('myapp', 7)).to.be.true;
      expect(removeAccessStub.calledOnce).to.be.true;
    });

    it('re-scans for the next free octet when a create collides', async () => {
      dockerServiceStub.getFreeFluxAppNetworkOctet.onFirstCall().resolves(7);
      dockerServiceStub.getFreeFluxAppNetworkOctet.onSecondCall().resolves(8);
      dockerServiceStub.createFluxAppDockerNetwork.onFirstCall().resolves(undefined); // collision
      dockerServiceStub.createFluxAppDockerNetwork.onSecondCall().resolves('network-created');

      await appInstallerNet.ensureAppDockerNetwork('myapp');

      expect(dockerServiceStub.createFluxAppDockerNetwork.getCall(0).args).to.deep.equal(['myapp', 7]);
      expect(dockerServiceStub.createFluxAppDockerNetwork.getCall(1).args).to.deep.equal(['myapp', 8]);
      // the lost octet is excluded from the next allocation so it never re-picks it
      expect([...dockerServiceStub.getFreeFluxAppNetworkOctet.secondCall.args[0]]).to.include(7);
    });

    it('throws a clear error when no free subnet is available', async () => {
      dockerServiceStub.getFreeFluxAppNetworkOctet.resolves(null);
      let err;
      try {
        await appInstallerNet.ensureAppDockerNetwork('myapp');
      } catch (e) { err = e; }

      expect(err).to.be.an('error');
      expect(err.message).to.include('No free 172.23.x.0/24 subnet available');
      expect(dockerServiceStub.createFluxAppDockerNetwork.called).to.be.false;
    });

    it('pins the octet by name for legacy gateway-assignment apps', async () => {
      // 'fdm' is in appsThatMightBeUsingOldGatewayIpAssignment; octet = 'm'.charCodeAt = 109
      await appInstallerNet.ensureAppDockerNetwork('fdm');

      expect(dockerServiceStub.getFreeFluxAppNetworkOctet.called).to.be.false;
      expect(dockerServiceStub.createFluxAppDockerNetwork.calledOnceWithExactly('fdm', 'm'.charCodeAt(0))).to.be.true;
    });

    it('advances through EVERY free octet and gives up only on exhaustion, not a fixed count', async () => {
      // Simulate a nearly-full node: octets 1..FREE are free, every create loses. Drive
      // the allocator off the real exclude set so it must try all FREE octets before the
      // space is exhausted. FREE is deliberately larger than any plausible fixed retry cap:
      // a reintroduced cap (the finding-1 regression) would throw early and fail callCount.
      const FREE = 20;
      dockerServiceStub.getFreeFluxAppNetworkOctet = sinon.stub().callsFake(async (excluded = new Set()) => {
        for (let octet = 1; octet <= FREE; octet += 1) {
          if (!excluded.has(octet)) return octet;
        }
        return null;
      });
      dockerServiceStub.createFluxAppDockerNetwork.resolves(undefined); // every create loses
      let err;
      try {
        await appInstallerNet.ensureAppDockerNetwork('myapp');
      } catch (e) { err = e; }

      // it attempted all FREE octets (never re-picking one) and only threw at true exhaustion
      expect(dockerServiceStub.createFluxAppDockerNetwork.callCount).to.equal(FREE);
      const attemptedOctets = dockerServiceStub.createFluxAppDockerNetwork.getCalls().map((c) => c.args[1]);
      expect(attemptedOctets).to.deep.equal(Array.from({ length: FREE }, (_, i) => i + 1));
      expect(err).to.be.an('error');
      expect(err.message).to.include('No free 172.23.x.0/24 subnet available');
    });

    it('treats an unknown network state as not-present and attempts a create', async () => {
      // dockerNetworkState returns 'unknown' on a transient docker glitch; the guard
      // is `=== exists`, so unknown must fall through to an (idempotent) create rather
      // than be mistaken for an existing network (which would skip the heal recreate).
      dockerServiceStub.dockerNetworkState.resolves('unknown');
      dockerServiceStub.getFreeFluxAppNetworkOctet.resolves(7);

      await appInstallerNet.ensureAppDockerNetwork('myapp');

      expect(dockerServiceStub.createFluxAppDockerNetwork.calledOnceWithExactly('myapp', 7)).to.be.true;
    });

    it('legacy app throws if its pinned octet cannot be created', async () => {
      dockerServiceStub.createFluxAppDockerNetwork.resolves(undefined);
      let err;
      try {
        await appInstallerNet.ensureAppDockerNetwork('fdm');
      } catch (e) { err = e; }

      expect(dockerServiceStub.getFreeFluxAppNetworkOctet.called).to.be.false;
      expect(err).to.be.an('error');
      expect(err.message).to.include('Not possible to create docker application network');
    });

    it('reserves the legacy-pinned octets so a non-legacy app cannot squat one', async () => {
      dockerServiceStub.getFreeFluxAppNetworkOctet.resolves(7);

      await appInstallerNet.ensureAppDockerNetwork('myapp');

      // the legacy octets are seeded into the exclude set on the very first allocation
      // so the free-octet scan never hands one out: 'fdm'->'m'(109), 'health'->'h'(104),
      // 'Jetpack2'->'2'(50).
      const excluded = [...dockerServiceStub.getFreeFluxAppNetworkOctet.firstCall.args[0]];
      expect(excluded).to.include('m'.charCodeAt(0));
      expect(excluded).to.include('h'.charCodeAt(0));
      expect(excluded).to.include('2'.charCodeAt(0));
    });

    it('streams an already-exists status on the early-return path', async () => {
      dockerServiceStub.dockerNetworkState.resolves('exists');
      const writes = [];
      const res = { write: (chunk) => writes.push(chunk) };

      await appInstallerNet.ensureAppDockerNetwork('myapp', res);

      expect(writes.some((w) => w && w.status && w.status.includes('already exists'))).to.be.true;
    });
  });
});
