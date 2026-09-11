const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appValidator tests', () => {
  let appValidator;
  let logStub;
  let imageManagerStub;
  // The enterprise app owners this node has obtained. null means it has not obtained
  // the policy at all, which is a different answer from "there are none".
  let enterpriseOwners;
  // The spec already on chain for this app, or null when there is none.
  let previousAppSpecs;

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    enterpriseOwners = ['1GM41a9A4rH8CCkCyzDRahHUccuTRLhoDe'];
    previousAppSpecs = null;

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
      '../utils/enterpriseConfig': {
        getEnterpriseAppOwners: () => enterpriseOwners,
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
        getPreviousAppSpecifications: async () => previousAppSpecs,
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
        APP_NAME_REGEX: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
        APP_NAME_REGEX_LEGACY: /^[a-zA-Z0-9]+$/,
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
        ensureAppUniquePorts: sinon.stub().resolves(true),
      },
      '../utils/peerState': {
        peerManager: {
          outboundCount: 0,
          inboundCount: 0,
        },
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
        owner: '1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg',
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
        owner: '1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg',
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

  describe('owner identity validation', () => {
    function specsOwnedBy(owner) {
      return {
        name: 'testapp',
        version: 4,
        description: 'Test app',
        owner,
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
    }

    it('should reject an owner that is not a signing identity on a live submission', async () => {
      try {
        await appValidator.verifyAppSpecifications(specsOwnedBy('TrippleCore'), 1000, true);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Invalid Flux App owner');
      }
    });

    it('should reject a base58 owner whose checksum does not hold on a live submission', async () => {
      try {
        await appValidator.verifyAppSpecifications(specsOwnedBy('1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEh'), 1000, true);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Invalid Flux App owner');
      }
    });

    it('should accept a Flux ID owner on a live submission', async () => {
      await appValidator.verifyAppSpecifications(specsOwnedBy('1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg'), 1000, true);
    });

    it('should accept an ethereum owner on a live submission', async () => {
      await appValidator.verifyAppSpecifications(specsOwnedBy('0x2b8e7f6e8f0b6f4c6f8e2b8e7f6e8f0b6f4c6f8e'), 1000, true);
    });

    it('should accept an owner that is not a signing identity when replaying a message already on chain', async () => {
      await appValidator.verifyAppSpecifications(specsOwnedBy('TrippleCore'), 1000);
    });
  });

  // Pinning a v8+ spec to named nodes is an enterprise-owner privilege. The frontend's
  // node picker has always gated on it; nothing on the chain did, so a spec posted
  // straight to the API pinned regardless and the restriction was decoration.
  describe('node pinning eligibility', () => {
    const ENTERPRISE_OWNER = '1GM41a9A4rH8CCkCyzDRahHUccuTRLhoDe';
    const ORDINARY_OWNER = '1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg';

    // v7 and v8 permit different keys, and the validator rejects an unknown one, so the
    // two shapes are built separately rather than patched from one another.
    function v8Component() {
      return {
        name: 'component1',
        description: 'Component 1',
        repotag: 'nginx:latest',
        ports: [],
        domains: [],
        environmentParameters: [],
        commands: [],
        containerPorts: [],
        containerData: '/data',
        repoauth: '',
        cpu: 0.5,
        ram: 500,
        hdd: 5,
      };
    }

    function pinnedSpec(overrides = {}) {
      return {
        name: 'pinnedapp',
        version: 8,
        description: 'Pinned app',
        owner: ORDINARY_OWNER,
        nodes: ['203.0.113.7:16127'],
        // The encrypted-spec field, not the owner list. v8 already refuses to pin
        // without it ('Nodes can only be used in enterprise apps'); the new rule adds
        // that the OWNER must be an enterprise owner too.
        enterprise: 'encrypted-blob',
        compose: [v8Component()],
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 22000,
        staticip: false,
        ...overrides,
      };
    }

    function pinnedSpecV7() {
      return {
        name: 'pinnedapp',
        version: 7,
        description: 'Pinned app',
        owner: ORDINARY_OWNER,
        nodes: ['203.0.113.7:16127'],
        compose: [{ ...v8Component(), secrets: '', tiered: false }],
        instances: 3,
        contacts: [],
        geolocation: [],
        expire: 22000,
        staticip: false,
      };
    }

    it('rejects a v8 spec pinned by an ordinary owner on a live submission', async () => {
      try {
        await appValidator.verifyAppSpecifications(pinnedSpec(), 1000, true);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('only available for enterprise app owners');
      }
    });

    it('accepts a v8 spec pinned by an enterprise owner', async () => {
      await appValidator.verifyAppSpecifications(pinnedSpec({ owner: ENTERPRISE_OWNER }), 1000, true);
    });

    it('accepts an unpinned v8 spec from an ordinary owner', async () => {
      await appValidator.verifyAppSpecifications(pinnedSpec({ nodes: [] }), 1000, true);
    });

    it('leaves v7 alone, where nodes[] is what makes a spec enterprise', async () => {
      // Applying the rule to v7 would invalidate every v7 enterprise app on the network:
      // there the array carries the per-node encrypted secrets rather than a privilege.
      await appValidator.verifyAppSpecifications(pinnedSpecV7(), 1000, true);
    });

    it('does not re-judge a message already on chain', async () => {
      // Replay is not a live submission. Applying the rule there would have upgraded
      // nodes rejecting history their peers accept - a disagreement about the past,
      // and the reason this needs no fork height.
      await appValidator.verifyAppSpecifications(pinnedSpec(), 1000);
    });

    // An app pinned before this rule existed must stay updatable. Renewal IS an update,
    // so without this the owner's app expires and the only way to keep it is to guess
    // that emptying nodes[] is the escape. The frontend grandfathers the same way.
    it('lets an ordinary owner carry an existing pin forward unchanged', async () => {
      previousAppSpecs = { nodes: ['203.0.113.7:16127'] };
      await appValidator.verifyAppSpecifications(pinnedSpec(), 1000, true);
    });

    it('ignores the order of an unchanged pin', async () => {
      previousAppSpecs = { nodes: ['198.51.100.9:16127', '203.0.113.7:16127'] };
      const spec = pinnedSpec({ nodes: ['203.0.113.7:16127', '198.51.100.9:16127'] });
      await appValidator.verifyAppSpecifications(spec, 1000, true);
    });

    it('does not let an ordinary owner redirect an existing pin', async () => {
      // Carrying a pin forward is not the same privilege as choosing where it points.
      previousAppSpecs = { nodes: ['203.0.113.7:16127'] };
      try {
        await appValidator.verifyAppSpecifications(pinnedSpec({ nodes: ['198.51.100.9:16127'] }), 1000, true);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('only available for enterprise app owners');
      }
    });

    it('does not let an ordinary owner widen an existing pin', async () => {
      previousAppSpecs = { nodes: ['203.0.113.7:16127'] };
      const spec = pinnedSpec({ nodes: ['203.0.113.7:16127', '198.51.100.9:16127'] });
      try {
        await appValidator.verifyAppSpecifications(spec, 1000, true);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('only available for enterprise app owners');
      }
    });

    it('treats a failed history lookup as no previous pin', async () => {
      // Granting a privilege, so it fails closed rather than open.
      previousAppSpecs = null;
      try {
        await appValidator.verifyAppSpecifications(pinnedSpec(), 1000, true);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('only available for enterprise app owners');
      }
    });

    it('refuses rather than guessing when the policy has not been obtained', async () => {
      enterpriseOwners = null;
      try {
        await appValidator.verifyAppSpecifications(pinnedSpec({ owner: ENTERPRISE_OWNER }), 1000, true);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('network policy not yet obtained');
      }
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
          owner: '1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg',
          enterprise: true,
          contacts: ['contact@example.com'],
          geolocation: [],
          expire: 88000,
          nodes: [],
          staticip: false,
          datacenter: false,
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
          owner: '1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg',
          enterprise: true,
          contacts: ['contact@example.com'],
          geolocation: [],
          expire: 88000,
          nodes: [],
          staticip: false,
          datacenter: false,
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
          owner: '1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg',
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
          owner: '1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg',
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
          owner: '1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg',
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
          owner: '1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg',
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
