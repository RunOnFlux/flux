const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const portManager = require('../../ZelBack/src/services/appNetwork/portManager');
const upnpService = require('../../ZelBack/src/services/upnpService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const { requireMongo } = require('./dbTestHelper');
const axios = require('axios');
const networkStateService = require('../../ZelBack/src/services/networkStateService');

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

    it('removes the failed app OUTSIDE the host-mutation lock (the deadlock trap)', async function test() {
      this.timeout(5000);
      upnpService.isUPNP.returns(true);
      upnpService.mapUpnpPort.resolves(false); // UPnP mapping fails -> recovery removes the app

      // eslint-disable-next-line global-require
      const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
      sinon.stub(serviceHelper, 'delay').resolves(); // skip the real 3-minute throttle

      // eslint-disable-next-line global-require
      const appUninstaller = require('../../ZelBack/src/services/appLifecycle/appUninstaller');
      // eslint-disable-next-line global-require
      const { withHostMutationLock } = require('../../ZelBack/src/services/utils/hostMutationLock');
      // The real Phase-B teardown re-enters this same non-re-entrant AsyncLock(1). If
      // restoreAppsPortsSupport still HELD the lock when calling removeAppLocally (the
      // trap), this re-acquire would deadlock and the test would hang to timeout. It
      // completes only because the leaf UPnP map releases the lock before this call.
      // (Load-bearing: production + this require share the one hostMutationLock
      // singleton via the CJS cache; stubbing/replacing that module would silently
      // disarm this guard.)
      const removeStub = sinon.stub(appUninstaller, 'removeAppLocally').callsFake(
        () => withHostMutationLock(() => Promise.resolve()),
      );

      await portManager.restoreAppsPortsSupport();

      sinon.assert.calledWith(removeStub, 'App1', null, true, true, true);
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

  describe('checkInstallingAppPortAvailable tests', () => {
    it('returns true immediately for a portless app (no peer probe)', async () => {
      // A spy that would throw if any network/socket work were attempted.
      const localSocket = sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress');

      expect(await portManager.checkInstallingAppPortAvailable([])).to.equal(true);
      expect(await portManager.checkInstallingAppPortAvailable()).to.equal(true);

      sinon.assert.notCalled(localSocket);
    });
  });
});

// Pure-logic probe helpers - no mongo, so a separate top-level describe (the block
// above gates on requireMongo and would otherwise skip these when mongo is absent).
describe('portManager port-reachability probe', () => {
  afterEach(() => sinon.restore());

  describe('askPeerPortReachability', () => {
    it('reports reachable when the peer answers success', async () => {
      sinon.stub(axios, 'post').resolves({ data: { status: 'success' } });
      const r = await portManager.askPeerPortReachability('5.5.5.5:16127', '{}', {});
      expect(r).to.deep.equal({ answered: true, reachable: true });
    });

    it('reports unreachable + failedPort when the peer answers error', async () => {
      sinon.stub(axios, 'post').resolves({ data: { status: 'error', data: { message: 'Failed port: 30000' } } });
      const r = await portManager.askPeerPortReachability('5.5.5.5:16127', '{}', {});
      expect(r).to.deep.equal({ answered: true, reachable: false, failedPort: 30000 });
    });

    it('reports not-answered when the peer itself is unreachable', async () => {
      sinon.stub(axios, 'post').rejects(new Error('ECONNREFUSED'));
      const r = await portManager.askPeerPortReachability('5.5.5.5:16127', '{}', {});
      expect(r).to.deep.equal({ answered: false });
    });
  });

  describe('arePortsReachableViaPeers', () => {
    const data = { ip: '9.9.9.9', port: 16127, ports: [30000] };

    it('returns true on the first peer that reaches us (single round)', async () => {
      const peers = sinon.stub(networkStateService, 'getRandomSocketAddresses').resolves(['1.1.1.1:16127', '2.2.2.2:16127', '3.3.3.3:16127']);
      sinon.stub(axios, 'post').resolves({ data: { status: 'success' } });

      expect(await portManager.arePortsReachableViaPeers(data, 'me:16127')).to.equal(true);
      sinon.assert.calledOnce(peers);
    });

    it('returns false when >=2 distinct peers agree it is unreachable', async () => {
      sinon.stub(networkStateService, 'getRandomSocketAddresses').resolves(['1.1.1.1:16127', '2.2.2.2:16127', '3.3.3.3:16127']);
      sinon.stub(axios, 'post').resolves({ data: { status: 'error', data: { message: 'Failed port: 30000' } } });

      expect(await portManager.arePortsReachableViaPeers(data, 'me:16127')).to.equal(false);
    });

    it('retries a fresh round when a round is inconclusive (no peer answered)', async () => {
      const peers = sinon.stub(networkStateService, 'getRandomSocketAddresses').resolves(['1.1.1.1:16127', '2.2.2.2:16127', '3.3.3.3:16127']);
      const post = sinon.stub(axios, 'post');
      post.onCall(0).rejects(new Error('x'));
      post.onCall(1).rejects(new Error('x'));
      post.onCall(2).rejects(new Error('x'));
      post.resolves({ data: { status: 'success' } });

      expect(await portManager.arePortsReachableViaPeers(data, 'me:16127')).to.equal(true);
      sinon.assert.calledTwice(peers);
    });

    it('fails closed after portTestMaxRounds when no peer ever answers', async () => {
      const peers = sinon.stub(networkStateService, 'getRandomSocketAddresses').resolves(['1.1.1.1:16127', '2.2.2.2:16127', '3.3.3.3:16127']);
      sinon.stub(axios, 'post').rejects(new Error('unreachable'));

      expect(await portManager.arePortsReachableViaPeers(data, 'me:16127')).to.equal(false);
      expect(peers.callCount).to.equal(config.fluxapps.portTestMaxRounds);
    });

    it('retries without crashing when a round yields no eligible peers', async () => {
      const peers = sinon.stub(networkStateService, 'getRandomSocketAddresses').resolves([]);
      const post = sinon.stub(axios, 'post');

      expect(await portManager.arePortsReachableViaPeers(data, 'me:16127')).to.equal(false);
      expect(peers.callCount).to.equal(config.fluxapps.portTestMaxRounds);
      sinon.assert.notCalled(post);
    });
  });
});
