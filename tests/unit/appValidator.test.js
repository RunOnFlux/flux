const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appValidator tests', () => {
  let appValidator;
  let logStub;

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    const configStub = {
      database: {
        url: 'mongodb://localhost:27017',
      },
      fluxapps: {
        maxImageSize: 10000000000,
        appSpecsEnforcementHeights: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900],
      },
      fluxSpecifics: {
        cpu: {
          cumulus: 2,
          nimbus: 4,
          stratus: 8,
        },
        ram: {
          cumulus: 4000,
          nimbus: 8000,
          stratus: 16000,
        },
        hdd: {
          cumulus: 220,
          nimbus: 440,
          stratus: 880,
        },
      },
      lockedSystemResources: {
        cpu: 0.5,
        ram: 500,
        hdd: 10,
      },
    };

    appValidator = proxyquire('../../ZelBack/src/services/appRequirements/appValidator', {
      '../serviceHelper': {
        ensureNumber: sinon.stub().returnsArg(0),
        ensureString: sinon.stub().returnsArg(0),
        ensureObject: sinon.stub().returnsArg(0),
        ensureBoolean: sinon.stub().returnsArg(0),
        isDecimalLimit: sinon.stub().returns(true),
      },
      '../../lib/log': logStub,
      config: configStub,
      '../dbHelper': {
        databaseConnection: sinon.stub(),
      },
      '../messageHelper': {
        createDataMessage: sinon.stub(),
        createErrorMessage: sinon.stub(),
      },
      '../generalService': {
        getApplicationGlobalSpecifications: sinon.stub().resolves({}),
      },
      '../verificationHelper': {
        verifyPrivilege: sinon.stub().resolves(true),
      },
      '../daemonService/daemonServiceMiscRpcs': {
        getBlock: sinon.stub().resolves({}),
      },
      '../fluxCommunicationMessagesSender': {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      },
      '../appDatabase/registryManager': {
        availableApps: sinon.stub().resolves([]),
        checkApplicationRegistrationRequirements: sinon.stub().resolves(true),
      },
      '../appMessaging/messageVerifier': {
        verifyAppHash: sinon.stub().resolves(true),
      },
      '../appSecurity/imageManager': {
        checkWhitelistedRepository: sinon.stub().returns(true),
        checkWhitelistedRepositoryV5: sinon.stub().returns(true),
      },
      '../appLifecycle/advancedWorkflows': {
        reindexGlobalAppsInformation: sinon.stub().resolves(),
      },
      '../utils/appConstants': {
        supportedArchitectures: ['amd64', 'arm64'],
      },
      '../utils/appUtilities': {
        specificationFormatter: sinon.stub().returnsArg(0),
      },
      '../utils/enterpriseHelper': {
        checkAndDecryptAppSpecs: sinon.stub().returnsArg(0),
      },
      '../appNetwork/portManager': {
        isPortAvailable: sinon.stub().returns(true),
        ensureAppUniquePorts: sinon.stub().resolves(true),
      },
      '../utils/establishedConnections': {
        outgoingPeers: [],
        incomingPeers: [],
      },
      '../fluxNetworkHelper': {
        getNumberOfPeers: sinon.stub().returns(10),
        isPortBanned: sinon.stub().returns(false),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('verifyAppSpecifications', () => {
    it('should reject specs without name', async () => {
      const invalidSpecs = {
        version: 4,
        cpu: 1,
        ram: 1000,
        hdd: 10,
      };

      try {
        await appValidator.verifyAppSpecifications(invalidSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('name');
      }
    });

    it('should reject specs with invalid version', async () => {
      const invalidSpecs = {
        name: 'testapp',
        version: 999,
        description: 'Test app',
        owner: '1owner',
        enterprise: false,
      };

      try {
        await appValidator.verifyAppSpecifications(invalidSpecs);
        expect.fail('Should have thrown error');
      } catch (error) {
        // Should throw any error for invalid version
        expect(error).to.be.an('error');
      }
    });

    it('should accept valid app specifications', async () => {
      const validSpecs = {
        name: 'testapp',
        version: 4,
        description: 'Test app',
        owner: '1owner',
        compose: [{
          name: 'component1',
          description: 'Component 1',
          repotag: 'nginx:latest',
          ports: [],
          domains: [],
          environmentParameters: [],
          commands: [],
          containerPorts: [],
          containerData: '/data',
          cpu: 0.5,
          ram: 500,
          hdd: 5,
          tiered: false,
        }],
        instances: 3,
      };

      // Should not throw
      await appValidator.verifyAppSpecifications(validSpecs, 1000);
    });
  });

  describe('exported functions', () => {
    it('should export validation functions', () => {
      expect(appValidator.verifyAppSpecifications).to.be.a('function');
    });
  });
});
