const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const portManager = require('../../ZelBack/src/services/appNetwork/portManager');
const upnpService = require('../../ZelBack/src/services/upnpService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const appUninstaller = require('../../ZelBack/src/services/appLifecycle/appUninstaller');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const { requireMongo } = require('./dbTestHelper');
const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');

describe('portManager tests', () => {
  before(requireMongo);

  afterEach(() => {
    sinon.restore();
  });

  describe('appPortsUnique tests', () => {
    it('should return true for unique ports', () => {
      const ports = [30001, 30002, 30003];
      const result = portManager.appPortsUnique(ports);

      expect(result).to.be.true;
    });

    it('should return false for duplicate ports', () => {
      const ports = [30001, 30002, 30001];
      const result = portManager.appPortsUnique(ports);

      expect(result).to.be.false;
    });

    it('should return true for empty array', () => {
      const ports = [];
      const result = portManager.appPortsUnique(ports);

      expect(result).to.be.true;
    });

    it('should return true for single port', () => {
      const ports = [30001];
      const result = portManager.appPortsUnique(ports);

      expect(result).to.be.true;
    });
  });

  describe('ensureAppUniquePorts tests', () => {
    it('should return true for version 1 apps', () => {
      const appSpec = {
        version: 1,
        name: 'TestApp',
        port: 30001,
      };

      const result = portManager.ensureAppUniquePorts(appSpec);

      expect(result).to.be.true;
    });

    it('should validate unique ports for version 2-3 apps', () => {
      const appSpec = {
        version: 3,
        name: 'TestApp',
        ports: [30001, 30002, 30003],
      };

      const result = portManager.ensureAppUniquePorts(appSpec);

      expect(result).to.be.true;
    });

    it('should throw error for duplicate ports in version 2-3 apps', () => {
      const appSpec = {
        version: 3,
        name: 'TestApp',
        ports: [30001, 30002, 30001],
      };

      expect(() => portManager.ensureAppUniquePorts(appSpec)).to.throw('must have unique ports');
    });

    it('should validate unique ports across compose components for version 4+', () => {
      const appSpec = {
        version: 4,
        name: 'TestApp',
        compose: [
          { name: 'Component1', ports: [30001, 30002] },
          { name: 'Component2', ports: [30003, 30004] },
        ],
      };

      const result = portManager.ensureAppUniquePorts(appSpec);

      expect(result).to.be.true;
    });

    it('should throw error for duplicate ports across compose components', () => {
      const appSpec = {
        version: 4,
        name: 'TestApp',
        compose: [
          { name: 'Component1', ports: [30001, 30002] },
          { name: 'Component2', ports: [30002, 30003] },
        ],
      };

      expect(() => portManager.ensureAppUniquePorts(appSpec)).to.throw('must have unique ports');
    });
  });

  describe('assignedPortsInstalledApps tests', () => {
    let db;
    let database;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      db = dbHelper.databaseConnection();
      database = db.db(config.database.appslocal.database);

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 3,
          ports: [30001, 30002],
        },
        {
          name: 'App2',
          version: 3,
          ports: [30003, 30004],
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);
    });

    it('should return ports assigned by installed apps', async () => {
      const result = await portManager.assignedPortsInstalledApps();

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(2);

      const app1 = result.find((app) => app.name === 'App1');
      expect(app1).to.exist;
      expect(app1.ports).to.include(30001);
      expect(app1.ports).to.include(30002);
    });

    // The endpoint reading this is unauthenticated, and the primitive underneath
    // the wrapper holds no cache of its own: it costs two globalAppsMessages
    // queries and a benchd RSA decrypt per enterprise app, on every call. Which
    // of the two is reached is load-bearing rather than a style choice, and
    // nothing else here would notice it being swapped back.
    it('decrypts through the cached path, keeping the key that path caches on', async () => {
      const collection = config.database.appslocal.collections.appsInformation;
      await database.collection(collection).drop();
      await dbHelper.insertOneToDatabase(database, collection, {
        name: 'EnterpriseApp', version: 8, enterprise: 'blob', hash: 'h1',
      });
      const decrypt = sinon.stub(appQueryService, 'decryptEnterpriseApps').resolves({
        inPlace: [{ name: 'EnterpriseApp', version: 4, compose: [{ name: 'c', ports: [31000] }] }],
        readable: [],
        unreadable: [],
      });

      const result = await portManager.assignedPortsInstalledApps();

      // formatSpecs false: the formatter strips the hash that path caches on
      sinon.assert.calledOnceWithExactly(decrypt, sinon.match.array, { formatSpecs: false });
      expect(result.find((app) => app.name === 'EnterpriseApp').ports).to.include(31000);
    });

    // A hole in this list reads as "that port is free", and every caller is
    // asking which ports are taken. Refusing the whole answer is what the
    // per-spec decrypt this replaced already did, by throwing on the first one
    // it could not read.
    it('refuses to answer at all when a specification cannot be read', async () => {
      const collection = config.database.appslocal.collections.appsInformation;
      await database.collection(collection).drop();
      await dbHelper.insertOneToDatabase(database, collection, {
        name: 'EnterpriseApp', version: 8, enterprise: 'blob', hash: 'h1',
      });
      sinon.stub(appQueryService, 'decryptEnterpriseApps').resolves({
        inPlace: [{ name: 'EnterpriseApp', version: 8, enterprise: 'blob', compose: [] }],
        readable: [],
        unreadable: [{ name: 'EnterpriseApp' }],
      });

      let raised = null;
      await portManager.assignedPortsInstalledApps().catch((error) => { raised = error; });

      expect(raised, 'an unreadable specification was answered as though it held no ports').to.not.equal(null);
      expect(raised.message).to.match(/could not be read/);
    });

    it('should handle version 1 apps', async () => {
      const collection = config.database.appslocal.collections.appsInformation;
      await database.collection(collection).drop();

      const testApp = {
        name: 'OldApp',
        version: 1,
        port: 30005,
      };
      await dbHelper.insertOneToDatabase(database, collection, testApp);

      const result = await portManager.assignedPortsInstalledApps();

      const oldApp = result.find((app) => app.name === 'OldApp');
      expect(oldApp).to.exist;
      expect(oldApp.ports).to.include(30005);
    });

    it('should handle version 4+ compose apps', async () => {
      const collection = config.database.appslocal.collections.appsInformation;
      await database.collection(collection).drop();

      const testApp = {
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'Component1', ports: [30006, 30007] },
          { name: 'Component2', ports: [30008] },
        ],
      };
      await dbHelper.insertOneToDatabase(database, collection, testApp);

      const result = await portManager.assignedPortsInstalledApps();

      const composedApp = result.find((app) => app.name === 'ComposedApp');
      expect(composedApp).to.exist;
      expect(composedApp.ports).to.include(30006);
      expect(composedApp.ports).to.include(30007);
      expect(composedApp.ports).to.include(30008);
    });
  });

  describe('ensureApplicationPortsNotUsed tests', () => {
    let db;
    let database;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      db = dbHelper.databaseConnection();
      database = db.db(config.database.appslocal.database);

      const collection = config.database.appslocal.collections.appsInformation;
      const existingApp = {
        name: 'ExistingApp',
        version: 3,
        ports: [30001, 30002],
      };

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertOneToDatabase(database, collection, existingApp);
    });

    it('should pass if ports are not used', async () => {
      const appSpec = {
        name: 'NewApp',
        version: 3,
        ports: [30010, 30011],
      };

      const result = await portManager.ensureApplicationPortsNotUsed(appSpec, []);

      expect(result).to.be.true;
    });

    it('should throw error if port is already used by different app', async () => {
      const appSpec = {
        name: 'NewApp',
        version: 3,
        ports: [30001, 30011],
      };

      try {
        await portManager.ensureApplicationPortsNotUsed(appSpec, []);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('port 30001 already used');
      }
    });

    it('should allow same app to use its own ports', async () => {
      const appSpec = {
        name: 'ExistingApp',
        version: 3,
        ports: [30001, 30002],
      };

      const result = await portManager.ensureApplicationPortsNotUsed(appSpec, []);

      expect(result).to.be.true;
    });

    it('should handle version 1 apps', async () => {
      const appSpec = {
        name: 'OldNewApp',
        version: 1,
        port: 30001,
      };

      try {
        await portManager.ensureApplicationPortsNotUsed(appSpec, []);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('port 30001 already used');
      }
    });

    it('should handle version 4+ compose apps', async () => {
      const appSpec = {
        name: 'NewComposedApp',
        version: 4,
        compose: [
          { name: 'Component1', ports: [30001] },
          { name: 'Component2', ports: [30020] },
        ],
      };

      try {
        await portManager.ensureApplicationPortsNotUsed(appSpec, []);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('port 30001 already used');
      }
    });
  });

  describe('isPortAvailable tests', () => {
    let db;
    let database;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      db = dbHelper.databaseConnection();
      database = db.db(config.database.appslocal.database);

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 3,
          ports: [30001, 30002],
        },
        {
          name: 'App2',
          version: 3,
          ports: [30003],
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);
    });

    it('should return false if port is used', async () => {
      const result = await portManager.isPortAvailable(30001);

      expect(result).to.be.false;
    });

    it('should return true if port is not used', async () => {
      const result = await portManager.isPortAvailable(30100);

      expect(result).to.be.true;
    });

    it('should exclude specified app from check', async () => {
      const result = await portManager.isPortAvailable(30001, 'App1');

      expect(result).to.be.true;
    });

    it('should not exclude different app from check', async () => {
      const result = await portManager.isPortAvailable(30001, 'App2');

      expect(result).to.be.false;
    });
  });

  describe('findNextAvailablePort tests', () => {
    let db;
    let database;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      db = dbHelper.databaseConnection();
      database = db.db(config.database.appslocal.database);

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 3,
          ports: [30001, 30002, 30003],
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);
    });

    it('should find next available port', async () => {
      const result = await portManager.findNextAvailablePort(30001, 30010);

      expect(result).to.equal(30004);
    });

    it('should return null if no available port in range', async () => {
      const result = await portManager.findNextAvailablePort(30001, 30003);

      expect(result).to.be.null;
    });

    it('should return first port if available', async () => {
      const result = await portManager.findNextAvailablePort(30010, 30020);

      expect(result).to.equal(30010);
    });
  });

  describe('getAllUsedPorts tests', () => {
    let db;
    let database;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      db = dbHelper.databaseConnection();
      database = db.db(config.database.appslocal.database);

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 3,
          ports: [30001, 30002],
        },
        {
          name: 'App2',
          version: 3,
          ports: [30002, 30003],
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);
    });

    it('should return all used ports without duplicates', async () => {
      const result = await portManager.getAllUsedPorts();

      expect(result).to.be.an('array');
      expect(result).to.include(30001);
      expect(result).to.include(30002);
      expect(result).to.include(30003);
      // Check for no duplicates
      expect(result.length).to.equal(new Set(result).size);
    });
  });

  describe('restoreFluxPortsSupport tests', () => {
    beforeEach(() => {
      sinon.stub(upnpService, 'isUPNP').returns(false);
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(false);
      sinon.stub(fluxNetworkHelper, 'allowPort').resolves(true);
      sinon.stub(upnpService, 'setupUPNP').resolves(true);
    });

    it('should setup firewall rules when firewall is active', async () => {
      fluxNetworkHelper.isFirewallActive.resolves(true);

      await portManager.restoreFluxPortsSupport();

      sinon.assert.called(fluxNetworkHelper.allowPort);
    });

    it('should setup UPNP when UPNP is active', async () => {
      upnpService.isUPNP.returns(true);

      await portManager.restoreFluxPortsSupport();

      sinon.assert.called(upnpService.setupUPNP);
    });

    it('should handle errors gracefully', async () => {
      fluxNetworkHelper.isFirewallActive.rejects(new Error('Firewall error'));

      // Should not throw
      await portManager.restoreFluxPortsSupport();
    });
  });

  describe('restoreAppsPortsSupport tests', () => {
    let db;
    let database;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      db = dbHelper.databaseConnection();
      database = db.db(config.database.appslocal.database);

      const collection = config.database.appslocal.collections.appsInformation;
      const testApps = [
        {
          name: 'App1',
          version: 3,
          ports: [30001],
        },
      ];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
      await dbHelper.insertManyToDatabase(database, collection, testApps);

      sinon.stub(upnpService, 'isUPNP').returns(false);
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(false);
      sinon.stub(fluxNetworkHelper, 'allowPort').resolves(true);
      sinon.stub(upnpService, 'mapUpnpPort').resolves(true);
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(appUninstaller, 'removeAppLocally').resolves();
      portManager.upnpMapFailures.clear();
    });

    it('should setup firewall for app ports when active', async () => {
      fluxNetworkHelper.isFirewallActive.resolves(true);

      await portManager.restoreAppsPortsSupport();

      sinon.assert.called(fluxNetworkHelper.allowPort);
    });

    it('should setup UPNP for app ports when active', async () => {
      upnpService.isUPNP.returns(true);

      await portManager.restoreAppsPortsSupport();

      sinon.assert.called(upnpService.mapUpnpPort);
    });

    it('should handle errors gracefully', async () => {
      fluxNetworkHelper.allowPort.rejects(new Error('Firewall error'));

      // Should not throw
      await portManager.restoreAppsPortsSupport();
    });

    it('should NOT remove an app on a single UPNP mapping failure', async () => {
      // the incident regression: one failed map used to escalate straight to
      // removeAppLocally(force, sendMessage) - a transient router blip nuked
      // a running app and broadcast its removal to the network
      upnpService.isUPNP.returns(true);
      upnpService.mapUpnpPort.resolves(false);

      await portManager.restoreAppsPortsSupport();

      sinon.assert.notCalled(appUninstaller.removeAppLocally);
      expect(portManager.upnpMapFailures.get('App1').cycles).to.equal(1);
    });

    it('should retry a failed port within the cycle and record no failure on recovery', async () => {
      upnpService.isUPNP.returns(true);
      upnpService.mapUpnpPort.onFirstCall().resolves(false);
      upnpService.mapUpnpPort.resolves(true);

      await portManager.restoreAppsPortsSupport();

      sinon.assert.notCalled(appUninstaller.removeAppLocally);
      expect(portManager.upnpMapFailures.has('App1')).to.be.false;
    });

    it('should not remove before the sustained window even after enough failing cycles', async () => {
      upnpService.isUPNP.returns(true);
      upnpService.mapUpnpPort.resolves(false);

      await portManager.restoreAppsPortsSupport();
      await portManager.restoreAppsPortsSupport();
      await portManager.restoreAppsPortsSupport();

      // 3 consecutive cycles, but wall-clock window not yet elapsed
      sinon.assert.notCalled(appUninstaller.removeAppLocally);
      expect(portManager.upnpMapFailures.get('App1').cycles).to.equal(3);
    });

    it('should remove and broadcast only after sustained failure (cycles AND window)', async () => {
      upnpService.isUPNP.returns(true);
      upnpService.mapUpnpPort.resolves(false);
      const nowMonotonicMs = Number(process.hrtime.bigint() / 1000000n);
      portManager.upnpMapFailures.set('App1', {
        cycles: 2,
        firstFailureAtMs: nowMonotonicMs - (31 * 60 * 1000),
      });

      await portManager.restoreAppsPortsSupport();

      sinon.assert.calledWith(appUninstaller.removeAppLocally, 'App1', null, true, true, true);
      expect(portManager.upnpMapFailures.has('App1')).to.be.false;
    });

    it('should pay the retry pause at most once per cycle across failing apps', async () => {
      const collection = config.database.appslocal.collections.appsInformation;
      await dbHelper.insertManyToDatabase(database, collection, [
        { name: 'App2', version: 3, ports: [30002] },
      ]);
      upnpService.isUPNP.returns(true);
      upnpService.mapUpnpPort.resolves(false);

      await portManager.restoreAppsPortsSupport();

      // both apps still get their retry attempt and their strike, but the
      // recovery pause is shared - not stacked per app
      sinon.assert.calledOnce(serviceHelper.delay);
      expect(upnpService.mapUpnpPort.callCount).to.equal(4);
      expect(portManager.upnpMapFailures.get('App1').cycles).to.equal(1);
      expect(portManager.upnpMapFailures.get('App2').cycles).to.equal(1);
    });

    it('should clear the failure tracker once mapping succeeds again', async () => {
      upnpService.isUPNP.returns(true);
      upnpService.mapUpnpPort.resolves(false);
      await portManager.restoreAppsPortsSupport();
      expect(portManager.upnpMapFailures.get('App1').cycles).to.equal(1);

      upnpService.mapUpnpPort.resolves(true);
      await portManager.restoreAppsPortsSupport();

      expect(portManager.upnpMapFailures.has('App1')).to.be.false;
      sinon.assert.notCalled(appUninstaller.removeAppLocally);
    });
  });

  describe('specifiedPorts tests', () => {
    it('reads the single port of a version 1 app', () => {
      expect(portManager.specifiedPorts({ version: 1, port: 31000 })).to.deep.equal([31000]);
    });

    it('reads the port list of a version 3 app', () => {
      expect(portManager.specifiedPorts({ version: 3, ports: ['31000', 31001] })).to.deep.equal([31000, 31001]);
    });

    it('reads every component of a composed app', () => {
      const spec = {
        version: 8,
        compose: [{ ports: [31000] }, { ports: [31001, 31002] }],
      };

      expect(portManager.specifiedPorts(spec)).to.deep.equal([31000, 31001, 31002]);
    });

    it('answers empty for a spec that names no port', () => {
      expect(portManager.specifiedPorts({ version: 1 })).to.deep.equal([]);
      expect(portManager.specifiedPorts({ version: 3 })).to.deep.equal([]);
      expect(portManager.specifiedPorts({ version: 8 })).to.deep.equal([]);
      expect(portManager.specifiedPorts({ version: 8, compose: [{}] })).to.deep.equal([]);
    });
  });

  // The router forwards each port to exactly one node, so an install onto a port
  // a sibling at this address already holds produces an app that is unreachable
  // from the moment it starts - and every per-node check passes, because each
  // node has its own docker and its own database.
  describe('siblingHoldingPort tests', () => {
    const spec = { version: 8, name: 'App', compose: [{ ports: [31000] }] };
    const ours = '86.9.47.94:16127';

    const nodesAt = (...addresses) => addresses.map((ip) => ({ ip }));

    const answering = (ports) => ({ data: { status: 'success', data: ports } });

    it('answers null when no other Flux node shares our address', async () => {
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '1.2.3.4:16127'));
      const get = sinon.stub(serviceHelper, 'axiosGet');

      expect(await portManager.siblingHoldingPort(spec, ours)).to.equal(null);
      sinon.assert.notCalled(get);
    });

    it('names the port a sibling reports, and which sibling', async () => {
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '86.9.47.94:16137'));
      sinon.stub(serviceHelper, 'axiosGet').resolves(answering([31000, 31005]));

      const held = await portManager.siblingHoldingPort(spec, ours);

      expect(held).to.deep.equal({ address: '86.9.47.94:16137', port: 31000 });
    });

    it('answers null when the sibling holds other ports', async () => {
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '86.9.47.94:16137'));
      sinon.stub(serviceHelper, 'axiosGet').resolves(answering([31005, 31006]));

      expect(await portManager.siblingHoldingPort(spec, ours)).to.equal(null);
    });

    it('does not ask ourselves', async () => {
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours));
      const get = sinon.stub(serviceHelper, 'axiosGet');

      expect(await portManager.siblingHoldingPort(spec, ours)).to.equal(null);
      sinon.assert.notCalled(get);
    });

    // Advisory, not authoritative: this narrows the window cheaply, and the port
    // test that follows is what decides. A sibling that cannot answer must not
    // block an install.
    it('answers null when a sibling does not answer', async () => {
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '86.9.47.94:16137'));
      sinon.stub(serviceHelper, 'axiosGet').rejects(new Error('ECONNREFUSED'));

      expect(await portManager.siblingHoldingPort(spec, ours)).to.equal(null);
    });

    it('answers null when a sibling answers something it cannot read', async () => {
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '86.9.47.94:16137'));
      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: { status: 'error', data: 'nope' } });

      expect(await portManager.siblingHoldingPort(spec, ours)).to.equal(null);
    });

    // networkState() answers an unknown list and a genuinely empty one with the
    // same value, so an empty result is read as no information rather than as
    // no siblings - and nothing is asked.
    it('asks nobody when the node list is not known', async () => {
      sinon.stub(networkStateService, 'isReady').returns(false);
      const state = sinon.stub(networkStateService, 'networkState').returns([]);
      const get = sinon.stub(serviceHelper, 'axiosGet');

      expect(await portManager.siblingHoldingPort(spec, ours)).to.equal(null);
      sinon.assert.notCalled(state);
      sinon.assert.notCalled(get);
    });

    it('asks nobody for a spec that names no port', async () => {
      const ready = sinon.stub(networkStateService, 'isReady').returns(true);
      const get = sinon.stub(serviceHelper, 'axiosGet');

      expect(await portManager.siblingHoldingPort({ version: 8, name: 'App', compose: [] }, ours)).to.equal(null);
      sinon.assert.notCalled(ready);
      sinon.assert.notCalled(get);
    });

    it('finds the one sibling holding the port among several that do not', async () => {
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState')
        .returns(nodesAt(ours, '86.9.47.94:16137', '86.9.47.94:16147', '86.9.47.94:16157'));
      const get = sinon.stub(serviceHelper, 'axiosGet');
      get.onCall(0).resolves(answering([31005]));
      get.onCall(1).resolves(answering([31000]));
      get.onCall(2).resolves(answering([31006]));

      const held = await portManager.siblingHoldingPort(spec, ours);

      expect(held).to.deep.equal({ address: '86.9.47.94:16147', port: 31000 });
    });
  });

  // What the peer's pass is worth. It reports that something answered at our
  // public address; where several Flux nodes share that address, what answered
  // can be a sibling's application while our own test server sat unreached.
  // The peer hands back what each port replied; the comparison happens HERE,
  // against a secret the peer was never given. That direction is the design: a
  // peer cannot tell this node's application from a neighbour's at the same
  // address, which is why this check exists, so a peer is not in a position to
  // judge - and one that is old, broken or lying cannot manufacture a token it
  // never saw.
  describe('portNotOurs tests', () => {
    const token = 'a1b2c3d4e5f6';
    // What a port really answers is an HTTP response, headers and all, capped
    // by the peer. The token is in there; equality would never match.
    const served = (t) => `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"status":"success","data":{"token":"${t}"}}`;

    it('proves the ports when every one of them answered with our token', () => {
      const answered = { 31000: served(token), 31001: served(token) };

      expect(portManager.portNotOurs([31000, 31001], answered, token)).to.equal(null);
    });

    // The collision this exists for: something answered the peer, so the peer
    // passed the port - but it was not us, and it cannot produce our token.
    it('names a port answered by something that is not us', () => {
      const answered = { 31000: served(token), 31001: served('somebody-elses') };

      expect(portManager.portNotOurs([31000, 31001], answered, token)).to.equal(31001);
    });

    it('names the first such port when several were not ours', () => {
      const answered = { 31000: served('nope'), 31001: served('also-nope') };

      expect(portManager.portNotOurs([31000, 31001], answered, token)).to.equal(31000);
    });

    // A port the peer could not read at all is not a port we may install on.
    it('names a port the peer got nothing back from', () => {
      const answered = { 31000: served(token) };

      expect(portManager.portNotOurs([31000, 31001], answered, token)).to.equal(31001);
    });

    // The peer skips any port outside the app range, so it says nothing either
    // way and must not read as a failure.
    it('says nothing about a port the peer would not have read', () => {
      const answered = { 31000: served(token) };

      expect(portManager.portNotOurs([31000, 70000], answered, token)).to.equal(null);
    });

    // Absence of a token is absence of a test, not a failed one - it is how the
    // node behaves before this rolls out, and it must not refuse.
    it('refuses nothing when this node published no token', () => {
      expect(portManager.portNotOurs([31000], {}, null)).to.equal(null);
    });

    it('refuses nothing when there are no ports', () => {
      expect(portManager.portNotOurs([], {}, token)).to.equal(null);
    });

    // The peer's answer arrives over JSON, so its keys are strings.
    it('reads the peer\'s answer whether its keys are numbers or strings', () => {
      expect(portManager.portNotOurs([31000], { '31000': served(token) }, token)).to.equal(null);
    });
  });

  describe('signCheckAppData tests', () => {
    it('should sign message data', async () => {
      const message = JSON.stringify({ test: 'data' });
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').resolves('testprivkey');
      sinon.stub(verificationHelper, 'signMessage').resolves('test-signature-string');

      const result = await portManager.signCheckAppData(message);

      expect(result).to.be.a('string');
      expect(result.length).to.be.greaterThan(0);
      expect(result).to.equal('test-signature-string');
    });
  });
});
