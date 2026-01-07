// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const appUtilities = require('../../ZelBack/src/services/utils/appUtilities');
const geolocationService = require('../../ZelBack/src/services/geolocationService');
const dockerService = require('../../ZelBack/src/services/dockerService');
const log = require('../../ZelBack/src/lib/log');

describe('appUtilities tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('nodeFullGeolocation tests', () => {
    it('should return formatted geolocation string', async () => {
      sinon.stub(geolocationService, 'getNodeGeolocation').resolves({
        continentCode: 'NA',
        countryCode: 'US',
        regionName: 'California',
      });

      const result = await appUtilities.nodeFullGeolocation();

      expect(result).to.equal('NA_US_California');
    });

    it('should throw error when geolocation not set', async () => {
      sinon.stub(geolocationService, 'getNodeGeolocation').resolves(null);

      try {
        await appUtilities.nodeFullGeolocation();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Node Geolocation not set');
      }
    });

    it('should handle different continent codes', async () => {
      sinon.stub(geolocationService, 'getNodeGeolocation').resolves({
        continentCode: 'EU',
        countryCode: 'DE',
        regionName: 'Bavaria',
      });

      const result = await appUtilities.nodeFullGeolocation();

      expect(result).to.equal('EU_DE_Bavaria');
    });

    it('should format with underscores', async () => {
      sinon.stub(geolocationService, 'getNodeGeolocation').resolves({
        continentCode: 'AS',
        countryCode: 'JP',
        regionName: 'Tokyo',
      });

      const result = await appUtilities.nodeFullGeolocation();

      expect(result).to.match(/^[A-Z]{2}_[A-Z]{2}_\w+$/);
      expect(result.split('_')).to.have.lengthOf(3);
    });
  });

  // getAppFolderSize tests removed - they execute actual sudo commands
  // which require proper system access. These should be tested in integration tests.

  describe('getContainerStorage tests', () => {
    it('should handle containers with no mounts', async () => {
      sinon.stub(dockerService, 'dockerContainerInspect').resolves({
        SizeRootFs: 1000000,
        Mounts: [],
      });

      const result = await appUtilities.getContainerStorage('testapp');

      expect(result.bind).to.equal(0);
      expect(result.volume).to.equal(0);
      expect(result.rootfs).to.equal(1000000);
      expect(result.used).to.equal(1000000);
      expect(result.status).to.equal('success');
    });

    it('should return error status on failure', async () => {
      sinon.stub(dockerService, 'dockerContainerInspect').rejects(new Error('Container not found'));
      sinon.stub(log, 'error');

      const result = await appUtilities.getContainerStorage('missingapp');

      expect(result.status).to.equal('error');
      expect(result.message).to.include('Container not found');
      expect(result.used).to.equal(0);
    });

    // Tests that require sudo access removed - should be in integration tests
  });

  describe('getAppPorts tests', () => {
    it('should extract port from version 1 app', () => {
      const appSpecs = {
        version: 1,
        port: 8080,
      };

      const ports = appUtilities.getAppPorts(appSpecs);

      expect(ports).to.deep.equal([8080]);
    });

    it('should extract ports from version 2 app', () => {
      const appSpecs = {
        version: 2,
        ports: [8080, 8081, 8082],
      };

      const ports = appUtilities.getAppPorts(appSpecs);

      expect(ports).to.deep.equal([8080, 8081, 8082]);
    });

    it('should extract ports from version 3 app', () => {
      const appSpecs = {
        version: 3,
        ports: [3000, 3001],
      };

      const ports = appUtilities.getAppPorts(appSpecs);

      expect(ports).to.deep.equal([3000, 3001]);
    });

    it('should extract ports from version 4+ composed app', () => {
      const appSpecs = {
        version: 4,
        compose: [
          { name: 'Frontend', ports: [80, 443] },
          { name: 'Backend', ports: [3000] },
          { name: 'Database', ports: [5432] },
        ],
      };

      const ports = appUtilities.getAppPorts(appSpecs);

      expect(ports).to.deep.equal([80, 443, 3000, 5432]);
    });

    it('should convert string ports to numbers for version 1', () => {
      const appSpecs = {
        version: 1,
        port: '8080',
      };

      const ports = appUtilities.getAppPorts(appSpecs);

      expect(ports[0]).to.be.a('number');
      expect(ports[0]).to.equal(8080);
    });

    it('should handle compose with no ports', () => {
      const appSpecs = {
        version: 4,
        compose: [
          { name: 'Worker', ports: [] },
        ],
      };

      const ports = appUtilities.getAppPorts(appSpecs);

      expect(ports).to.be.an('array').that.is.empty;
    });

    it('should handle multiple components with varying ports', () => {
      const appSpecs = {
        version: 5,
        compose: [
          { name: 'Web', ports: [80] },
          { name: 'API', ports: [3000, 3001, 3002] },
          { name: 'Cache', ports: [] },
        ],
      };

      const ports = appUtilities.getAppPorts(appSpecs);

      expect(ports).to.have.lengthOf(4);
      expect(ports).to.include(80);
      expect(ports).to.include(3000);
    });
  });

  describe('updateToLatestAppSpecifications tests', () => {
    it('should update version 1 app to version 8', () => {
      const v1Spec = {
        version: 1,
        name: 'OldApp',
        description: 'Legacy app',
        owner: 'owner123',
        repotag: 'repo/old:v1',
        port: 8080,
        containerPort: 80,
        enviromentParameters: ['ENV=prod'],
        commands: ['start.sh'],
        containerData: '/data',
        cpu: 1,
        ram: 2000,
        hdd: 50,
        hash: 'hash123',
        height: 100000,
      };

      const result = appUtilities.updateToLatestAppSpecifications(v1Spec);

      expect(result.version).to.equal(8);
      expect(result.name).to.equal('OldApp');
      expect(result.compose).to.be.an('array').with.lengthOf(1);
      expect(result.compose[0].ports).to.deep.equal([8080]);
      expect(result.expire).to.equal(22000);
      expect(result.nodes).to.be.an('array').that.is.empty;
      expect(result.staticip).to.be.false;
    });

    it('should update version 3 app to version 8', () => {
      const v3Spec = {
        version: 3,
        name: 'MediumApp',
        description: 'Mid-age app',
        owner: 'owner456',
        repotag: 'repo/med:v3',
        ports: [8080, 8081],
        containerPorts: [80, 81],
        enviromentParameters: ['ENV=prod'],
        commands: ['start.sh'],
        domains: ['app.example.com'],
        containerData: '/data',
        cpu: 2,
        ram: 4000,
        hdd: 100,
        instances: 5,
        hash: 'hash456',
        height: 200000,
      };

      const result = appUtilities.updateToLatestAppSpecifications(v3Spec);

      expect(result.version).to.equal(8);
      expect(result.istances).to.equal(5);
      expect(result.compose[0].domains).to.deep.equal(['app.example.com']);
    });

    it('should update version 4 composed app to version 8', () => {
      const v4Spec = {
        version: 4,
        name: 'ModernApp',
        description: 'Modern app',
        owner: 'owner789',
        instances: 10,
        compose: [
          {
            name: 'Frontend',
            description: 'Web frontend',
            repotag: 'repo/frontend:v1',
            ports: [80, 443],
            containerPorts: [8080, 8443],
            environmentParameters: [],
            commands: [],
            domains: [],
            containerData: '/app',
            cpu: 1,
            ram: 2000,
            hdd: 50,
          },
        ],
        hash: 'hash789',
        height: 300000,
      };

      const result = appUtilities.updateToLatestAppSpecifications(v4Spec);

      expect(result.version).to.equal(8);
      expect(result.compose).to.have.lengthOf(1);
      expect(result.compose[0].name).to.equal('Frontend');
      expect(result.compose[0].repoauth).to.equal('');
    });

    it('should update version 7 app to version 8', () => {
      const v7Spec = {
        version: 7,
        name: 'RecentApp',
        description: 'Recent app',
        contacts: ['admin@example.com'],
        expire: 44000,
        geolocation: ['NA_US'],
        instances: 7,
        nodes: [],
        staticip: true,
        compose: [
          {
            name: 'Service',
            description: 'Main service',
            repotag: 'repo/service:v1',
            ports: [3000],
            containerPorts: [3000],
            environmentParameters: [],
            commands: [],
            domains: [],
            containerData: '/data',
            cpu: 2,
            ram: 4000,
            hdd: 100,
            repoauth: 'auth123',
          },
        ],
        hash: 'hash999',
        height: 400000,
      };

      const result = appUtilities.updateToLatestAppSpecifications(v7Spec);

      expect(result.version).to.equal(8);
      expect(result.staticip).to.be.true;
      expect(result.expire).to.equal(44000);
      expect(result.compose[0].repoauth).to.equal('auth123');
      expect(result.nodes).to.be.an('array').that.is.empty; // v7 nodes cleared
    });

    it('should return version 8 app unchanged', () => {
      const v8Spec = {
        version: 8,
        name: 'LatestApp',
        description: 'Latest version app',
        contacts: [],
        expire: 22000,
        geolocation: [],
        istances: 3,
        nodes: [],
        staticip: false,
        enterprise: '',
        compose: [],
        hash: 'hash111',
        height: 500000,
      };

      const result = appUtilities.updateToLatestAppSpecifications(v8Spec);

      expect(result).to.deep.equal(v8Spec);
    });

    it('should throw error for unrecognized version', () => {
      const invalidSpec = {
        version: 99,
        name: 'FutureApp',
      };

      try {
        appUtilities.updateToLatestAppSpecifications(invalidSpec);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('version not recognized');
      }
    });

    it('should handle version 2 with multiple ports', () => {
      const v2Spec = {
        version: 2,
        name: 'V2App',
        description: 'Version 2 app',
        owner: 'owner222',
        repotag: 'repo/v2:latest',
        ports: [8080, 8081, 8082],
        containerPorts: [80, 81, 82],
        enviromentParameters: ['ENV=dev'],
        commands: ['run.sh'],
        domains: ['api.example.com', 'web.example.com'],
        containerData: '/data',
        cpu: 1.5,
        ram: 3000,
        hdd: 75,
        hash: 'hash222',
        height: 150000,
      };

      const result = appUtilities.updateToLatestAppSpecifications(v2Spec);

      expect(result.version).to.equal(8);
      expect(result.compose[0].ports).to.have.lengthOf(3);
      expect(result.compose[0].domains).to.have.lengthOf(2);
    });

    it('should preserve hash and height in migration', () => {
      const v5Spec = {
        version: 5,
        name: 'V5App',
        description: 'Version 5 app',
        contacts: ['contact@example.com'],
        geolocation: ['EU_DE'],
        instances: 4,
        compose: [
          {
            name: 'App',
            description: 'Main app',
            repotag: 'repo/app:v1',
            ports: [3000],
            containerPorts: [3000],
            environmentParameters: [],
            commands: [],
            domains: [],
            containerData: '/app',
            cpu: 1,
            ram: 2000,
            hdd: 50,
          },
        ],
        hash: 'preserved_hash',
        height: 250000,
      };

      const result = appUtilities.updateToLatestAppSpecifications(v5Spec);

      expect(result.hash).to.equal('preserved_hash');
      expect(result.height).to.equal(250000);
    });
  });

  describe('module exports tests', () => {
    it('should export all required functions', () => {
      expect(appUtilities.appPricePerMonth).to.be.a('function');
      expect(appUtilities.nodeFullGeolocation).to.be.a('function');
      expect(appUtilities.getAppFolderSize).to.be.a('function');
      expect(appUtilities.getContainerStorage).to.be.a('function');
      expect(appUtilities.getAppPorts).to.be.a('function');
      expect(appUtilities.specificationFormatter).to.be.a('function');
      expect(appUtilities.updateToLatestAppSpecifications).to.be.a('function');
    });
  });
});
