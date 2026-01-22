const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appValidator tests', () => {
  let appValidator;
  let logStub;
  let imageManagerStub;

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    imageManagerStub = {
      checkWhitelistedRepository: sinon.stub().returns(true),
      checkWhitelistedRepositoryV5: sinon.stub().returns(true),
      checkApplicationImagesCompliance: sinon.stub().resolves(),
      verifyRepository: sinon.stub().resolves({
        verified: true,
        supportedArchitectures: ['amd64', 'arm64'],
      }),
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
      '../appSecurity/imageManager': imageManagerStub,
      '../appLifecycle/advancedWorkflows': {
        reindexGlobalAppsInformation: sinon.stub().resolves(),
      },
      '../utils/appConstants': {
        supportedArchitectures: ['amd64', 'arm64'],
        enterpriseRequiredArchitectures: ['amd64'],
      },
      '../utils/appUtilities': {
        specificationFormatter: sinon.stub().returnsArg(0),
        findCommonArchitectures: (componentArchitectures) => {
          if (componentArchitectures.length === 0) return [];
          if (componentArchitectures.length === 1) return componentArchitectures[0].architectures;
          return componentArchitectures[0].architectures.filter((arch) =>
            componentArchitectures.every((comp) => comp.architectures.includes(arch)),
          );
        },
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

  describe('architecture validation', () => {
    describe('Enterprise Arcane (v8+) apps', () => {
      it('should accept v8 enterprise app when all components support amd64', async () => {
        imageManagerStub.verifyRepository.resolves({
          verified: true,
          supportedArchitectures: ['amd64', 'arm64'],
        });

        const validSpecs = {
          name: 'testarcane',
          version: 8,
          description: 'Test Arcane app',
          owner: '1owner',
          enterprise: true,
          contacts: ['contact@example.com'],
          geolocation: [],
          expire: 88000,
          nodes: [],
          staticip: false,
          datacenter: null,
          compose: [{
            name: 'component1',
            description: 'Component 1',
            repotag: 'nginx:latest',
            repoauth: '',
            ports: [],
            domains: [],
            environmentParameters: [],
            commands: [],
            containerPorts: [],
            containerData: '/data',
            cpu: 0.5,
            ram: 500,
            hdd: 5,
          }],
          instances: 3,
        };

        await appValidator.verifyAppSpecifications(validSpecs, 1000, true);
      });

      it('should reject v8 enterprise app when component does not support amd64', async () => {
        imageManagerStub.verifyRepository.reset();
        imageManagerStub.verifyRepository.resolves({
          verified: true,
          supportedArchitectures: ['arm64'],
        });

        const invalidSpecs = {
          name: 'testarcane',
          version: 8,
          description: 'Test Arcane app',
          owner: '1owner',
          enterprise: true,
          contacts: ['contact@example.com'],
          geolocation: [],
          expire: 88000,
          nodes: [],
          staticip: false,
          datacenter: null,
          compose: [{
            name: 'component1',
            description: 'Component 1',
            repotag: 'arm-only:latest',
            repoauth: '',
            ports: [],
            domains: [],
            environmentParameters: [],
            commands: [],
            containerPorts: [],
            containerData: '/data',
            cpu: 0.5,
            ram: 500,
            hdd: 5,
          }],
          instances: 3,
        };

        try {
          await appValidator.verifyAppSpecifications(invalidSpecs, 1000, true);
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error.message).to.include('amd64');
          expect(error.message).to.include('Arcane');
        }
      });
    });

    describe('Enterprise v7 apps', () => {
      it('should accept v7 enterprise app with common architecture', async () => {
        imageManagerStub.verifyRepository.resolves({
          verified: true,
          supportedArchitectures: ['amd64', 'arm64'],
        });

        const validSpecs = {
          name: 'testv7enterprise',
          version: 7,
          description: 'Test v7 enterprise app',
          owner: '1owner',
          contacts: ['contact@example.com'],
          geolocation: [],
          expire: 88000,
          nodes: ['node1', 'node2'],
          staticip: false,
          compose: [{
            name: 'component1',
            description: 'Component 1',
            repotag: 'nginx:latest',
            repoauth: '',
            secrets: '',
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

        await appValidator.verifyAppSpecifications(validSpecs, 1000, true);
      });

      it('should reject v7 enterprise app when components have no common architecture', async () => {
        imageManagerStub.verifyRepository.reset();
        imageManagerStub.verifyRepository
          .onCall(0).resolves({
            verified: true,
            supportedArchitectures: ['amd64'],
          })
          .onCall(1).resolves({
            verified: true,
            supportedArchitectures: ['arm64'],
          });

        const invalidSpecs = {
          name: 'testv7enterprise',
          version: 7,
          description: 'Test v7 enterprise app',
          owner: '1owner',
          contacts: ['contact@example.com'],
          geolocation: [],
          expire: 88000,
          nodes: ['node1', 'node2'],
          staticip: false,
          compose: [
            {
              name: 'component1',
              description: 'Component 1',
              repotag: 'amd-only:latest',
              repoauth: '',
              secrets: '',
              ports: [],
              domains: [],
              environmentParameters: [],
              commands: [],
              containerPorts: [],
              containerData: '/data',
              cpu: 0.1,
              ram: 500,
              hdd: 5,
              tiered: false,
            },
            {
              name: 'component2',
              description: 'Component 2',
              repotag: 'arm-only:latest',
              repoauth: '',
              secrets: '',
              ports: [],
              domains: [],
              environmentParameters: [],
              commands: [],
              containerPorts: [],
              containerData: '/data',
              cpu: 0.1,
              ram: 500,
              hdd: 5,
              tiered: false,
            },
          ],
          instances: 3,
        };

        try {
          await appValidator.verifyAppSpecifications(invalidSpecs, 1000, true);
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error.message).to.include('common architecture');
        }
      });
    });

    describe('Non-enterprise apps', () => {
      it('should accept non-enterprise app when all components support both amd64 and arm64', async () => {
        imageManagerStub.verifyRepository.resolves({
          verified: true,
          supportedArchitectures: ['amd64', 'arm64'],
        });

        const validSpecs = {
          name: 'testapp',
          version: 4,
          description: 'Test app',
          owner: '1owner',
          compose: [
            {
              name: 'component1',
              description: 'Component 1',
              repotag: 'nginx:latest',
              ports: [],
              domains: [],
              environmentParameters: [],
              commands: [],
              containerPorts: [],
              containerData: '/data',
              cpu: 0.1,
              ram: 500,
              hdd: 5,
              tiered: false,
            },
            {
              name: 'component2',
              description: 'Component 2',
              repotag: 'redis:latest',
              ports: [],
              domains: [],
              environmentParameters: [],
              commands: [],
              containerPorts: [],
              containerData: '/data',
              cpu: 0.1,
              ram: 500,
              hdd: 5,
              tiered: false,
            },
          ],
          instances: 3,
        };

        await appValidator.verifyAppSpecifications(validSpecs, 1000, true);
      });

      it('should reject non-enterprise app when components have no common architecture', async () => {
        imageManagerStub.verifyRepository.reset();
        imageManagerStub.verifyRepository
          .onCall(0).resolves({
            verified: true,
            supportedArchitectures: ['amd64'],
          })
          .onCall(1).resolves({
            verified: true,
            supportedArchitectures: ['arm64'],
          });

        const invalidSpecs = {
          name: 'testapp',
          version: 4,
          description: 'Test app',
          owner: '1owner',
          compose: [
            {
              name: 'component1',
              description: 'Component 1',
              repotag: 'amd-only:latest',
              ports: [],
              domains: [],
              environmentParameters: [],
              commands: [],
              containerPorts: [],
              containerData: '/data',
              cpu: 0.1,
              ram: 500,
              hdd: 5,
              tiered: false,
            },
            {
              name: 'component2',
              description: 'Component 2',
              repotag: 'arm-only:latest',
              ports: [],
              domains: [],
              environmentParameters: [],
              commands: [],
              containerPorts: [],
              containerData: '/data',
              cpu: 0.1,
              ram: 500,
              hdd: 5,
              tiered: false,
            },
          ],
          instances: 3,
        };

        try {
          await appValidator.verifyAppSpecifications(invalidSpecs, 1000, true);
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error.message).to.include('common architecture');
        }
      });
    });
  });
});
