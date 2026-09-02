const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const axios = require('axios');
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
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');

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

  // The router forwards each port to exactly one node, so an install onto a port
  // a sibling at this address already holds produces an app that is unreachable
  // from the moment it starts - and every per-node check passes, because each
  // node has its own docker and its own database.
  describe('siblingHoldingPort tests', () => {
    // The ports themselves, not a specification: the spawner has already derived
    // them for the blocked-port check, and deriving them a second time here is
    // two answers to one question that nothing keeps in agreement.
    const ports = [31000];
    const ours = '86.9.47.94:16127';

    const nodesAt = (...addresses) => addresses.map((ip) => ({ ip }));

    const SIBLING = '86.9.47.94:16137';
    const SIBLING_KEY = '04siblingpubkey';

    // The answer is signed now: a node's own record of what it has installed is
    // the truth about which ports are spoken for here, but only once it is that
    // node saying it rather than whatever is listening on the address. It signs
    // the ask's time back, so it answers one question rather than every later one.
    const answering = (heldPorts, askedAt) => ({
      data: {
        status: 'success',
        data: {
          pubKey: SIBLING_KEY, ports: heldPorts, askedAt, signature: 'sig',
        },
      },
    });

    // A real sibling answers the ask it was handed, so the stub reads the time
    // out of the body rather than the test guessing what Date.now() produced.
    const respond = (...perCall) => async (url, sent) => {
      const heldPorts = perCall.length === 1 ? perCall[0] : perCall.shift();
      return answering(heldPorts, sent.timestamp);
    };

    // Lets the real verifier run: the key is on the list, it belongs to the
    // address that was dialled, and the signature checks out.
    const canVerify = (...addresses) => {
      const listed = addresses.length ? addresses : [SIBLING];
      sinon.stub(fluxCommunicationUtils, 'deterministicFluxList').resolves(listed.map((ip) => ({ ip })));
      sinon.stub(verificationHelper, 'verifyMessage').returns(true);
    };

    // The ask is signed now, so every test that expects a sibling to be asked
    // has to let the signing succeed. Without this the six tests below that
    // assert null pass on an unsigned ask rather than on the thing they name -
    // which is how two of them were passing before this stub existed.
    const canSign = () => {
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').resolves('04pubkey');
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').resolves('Kwif');
      sinon.stub(verificationHelper, 'signMessage').returns('signature');
    };

    it('answers null when no other Flux node shares our address', async () => {
      canSign();
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '1.2.3.4:16127'));
      const get = sinon.stub(axios, 'post');

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
      sinon.assert.notCalled(get);
    });

    it('names the port a sibling reports, and which sibling', async () => {
      canSign();
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '86.9.47.94:16137'));
      canVerify();
      sinon.stub(axios, 'post').callsFake(respond([31000, 31005]));

      const held = await portManager.siblingHoldingPort(ports, ours);

      expect(held).to.deep.equal({ address: '86.9.47.94:16137', port: 31000 });
    });

    // The point of signing the answer: this address is only as trustworthy as
    // whatever is listening on it, and a listed Fluxnode signing from somewhere
    // else says nothing about what is installed HERE.
    it('ignores an answer signed by a Fluxnode at a different address', async () => {
      canSign();
      canVerify('9.9.9.9:16127');
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, SIBLING));
      sinon.stub(axios, 'post').callsFake(respond([31000]));

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
    });

    it('ignores an answer that is not signed at all', async () => {
      canSign();
      canVerify();
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, SIBLING));
      sinon.stub(axios, 'post').resolves({
        data: { status: 'success', data: { pubKey: SIBLING_KEY, ports: [31000], askedAt: Date.now() } },
      });

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
    });

    // A signed answer with no question attached is a recording, and a recording
    // says what was true then. The ask carries a time and the answer signs it
    // back, which is the same field that stops the ASK being replayable.
    it('ignores an answer that names a different question', async () => {
      canSign();
      canVerify();
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, SIBLING));
      sinon.stub(axios, 'post').resolves(answering([31000], Date.now() - 5000));

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
    });

    it('answers null when the sibling holds other ports', async () => {
      canSign();
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '86.9.47.94:16137'));
      canVerify();
      sinon.stub(axios, 'post').callsFake(respond([31005, 31006]));

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
    });

    it('does not ask ourselves', async () => {
      canSign();
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours));
      const get = sinon.stub(axios, 'post');

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
      sinon.assert.notCalled(get);
    });

    // Advisory, not authoritative: this narrows the window cheaply, and the port
    // test that follows is what decides. A sibling that cannot answer must not
    // block an install.
    it('answers null when a sibling does not answer', async () => {
      canSign();
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '86.9.47.94:16137'));
      sinon.stub(axios, 'post').rejects(new Error('ECONNREFUSED'));

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
    });

    it('answers null when a sibling answers something it cannot read', async () => {
      canSign();
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '86.9.47.94:16137'));
      sinon.stub(axios, 'post').resolves({ data: { status: 'error', data: 'nope' } });

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
    });

    // networkState() answers an unknown list and a genuinely empty one with the
    // same value, so an empty result is read as no information rather than as
    // no siblings - and nothing is asked.
    it('asks nobody when the node list is not known', async () => {
      canSign();
      sinon.stub(networkStateService, 'isReady').returns(false);
      const state = sinon.stub(networkStateService, 'networkState').returns([]);
      const get = sinon.stub(axios, 'post');

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
      sinon.assert.notCalled(state);
      sinon.assert.notCalled(get);
    });

    it('asks nobody when the app names no port', async () => {
      const ready = sinon.stub(networkStateService, 'isReady').returns(true);
      const get = sinon.stub(axios, 'post');

      expect(await portManager.siblingHoldingPort([], ours)).to.equal(null);
      sinon.assert.notCalled(ready);
      sinon.assert.notCalled(get);
    });

    it('finds the one sibling holding the port among several that do not', async () => {
      canSign();
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState')
        .returns(nodesAt(ours, '86.9.47.94:16137', '86.9.47.94:16147', '86.9.47.94:16157'));
      canVerify('86.9.47.94:16137', '86.9.47.94:16147', '86.9.47.94:16157');
      const get = sinon.stub(axios, 'post').callsFake(respond([31005], [31000], [31006]));

      const held = await portManager.siblingHoldingPort(ports, ours);

      expect(get.callCount).to.equal(3);
      expect(held).to.deep.equal({ address: '86.9.47.94:16147', port: 31000 });
    });
    // Signing can fail on its own - signMessage catches and answers with
    // nothing - and an unsigned ask would be refused by every sibling and read
    // back as "no sibling holds the port". That is the advisory check failing
    // open, so it must be a deliberate no-information answer instead.
    it('asks nobody when the request cannot be signed', async () => {
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').resolves('04pubkey');
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').resolves(undefined);
      sinon.stub(verificationHelper, 'signMessage').returns(undefined);
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, '86.9.47.94:16137'));
      const post = sinon.stub(axios, 'post');

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
      sinon.assert.notCalled(post);
    });

    // The dial was guarded and the verification beside it was not, so one
    // sibling breaking took the answers of every sibling that had replied.
    it('loses only the sibling that broke, not the ones that answered', async () => {
      canSign();
      const broken = '86.9.47.94:16137';
      const good = '86.9.47.94:16147';
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, broken, good));
      sinon.stub(axios, 'post').callsFake(async (url, sent) => (
        url.includes('16137') ? answering([31005], sent.timestamp) : answering([31000], sent.timestamp)
      ));
      sinon.stub(fluxNetworkHelper, 'verifySignedFluxnodeMessage')
        .callsFake(async (answer, options) => {
          if (options.socketAddress === broken) throw new Error('node list unavailable');
          return true;
        });

      const held = await portManager.siblingHoldingPort(ports, ours);

      expect(held).to.deep.equal({ address: good, port: 31000 });
    });

    // Everything outside the per-sibling loop - the key, the signing, building
    // the list - reaches the spawner's catch if it throws, and the spawner
    // reads that as the APPLICATION having failed: six hours in the pre-install
    // error cache for a question this node could not ask.
    it('answers no information when the question cannot be asked at all', async () => {
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').rejects(new Error('daemon down'));
      sinon.stub(networkStateService, 'isReady').returns(true);
      sinon.stub(networkStateService, 'networkState').returns(nodesAt(ours, SIBLING));
      const post = sinon.stub(axios, 'post');

      expect(await portManager.siblingHoldingPort(ports, ours)).to.equal(null);
      sinon.assert.notCalled(post);
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
  describe('portsInUseApi tests', () => {
    // It must ANSWER. The first version read the raw request stream, and
    // express.json() is global - so for a JSON content type the body was already
    // consumed, the 'end' event had been and gone, and the handler waited for it
    // forever. Nothing failed; the caller timed out. A stubbed res is enough to
    // catch that, and nothing was calling this function at all before.
    const resStub = () => { const r = { json: sinon.stub() }; return r; };

    // The answer is signed, so a handler that can answer at all must be able to
    // sign; a node that cannot says so rather than sending something the caller
    // will discard without a word.
    const canSignAnswer = () => {
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').resolves('04pubkey');
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').resolves('Kwif');
      sinon.stub(verificationHelper, 'signMessage').returns('signature');
    };

    it('answers a request that carries operator privilege', async () => {
      canSignAnswer();
      sinon.stub(fluxNetworkHelper, 'verifySignedFluxnodeMessage').resolves(false);
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(portManager, 'portsInUse').resolves([31000]);
      const res = resStub();

      await portManager.portsInUseApi({ body: {} }, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('success');
    });

    it('answers a Fluxnode that signed the question', async () => {
      canSignAnswer();
      sinon.stub(fluxNetworkHelper, 'verifySignedFluxnodeMessage').resolves(true);
      const privilege = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      const res = resStub();

      await portManager.portsInUseApi({ body: { pubKey: '04', signature: 'sig', timestamp: Date.now() } }, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('success');
      // The signature settles it; no privilege check is needed or made.
      sinon.assert.notCalled(privilege);
    });

    // The body is otherwise constant - a key and a fixed word - so without a time
    // in it one captured signature is a bearer token for this endpoint on every
    // node, for ever.
    it('refuses a signed ask that is older than its window', async () => {
      canSignAnswer();
      sinon.stub(fluxNetworkHelper, 'verifySignedFluxnodeMessage').resolves(true);
      const res = resStub();

      const stale = Date.now() - (config.fluxapps.siblingAskValidityMs + 1000);
      await portManager.portsInUseApi({ body: { pubKey: '04', signature: 'sig', timestamp: stale } }, res);

      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.match(/stale/i);
    });

    it('refuses a signed ask that carries no time at all', async () => {
      canSignAnswer();
      sinon.stub(fluxNetworkHelper, 'verifySignedFluxnodeMessage').resolves(true);
      const res = resStub();

      await portManager.portsInUseApi({ body: { pubKey: '04', signature: 'sig' } }, res);

      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.match(/stale|timestamp/i);
    });

    // Not asked of an operator: they authenticated as themselves, and a person
    // asking by hand has no signature for anyone to capture.
    it('does not ask an operator for a timestamp', async () => {
      canSignAnswer();
      sinon.stub(fluxNetworkHelper, 'verifySignedFluxnodeMessage').resolves(false);
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      const res = resStub();

      await portManager.portsInUseApi({ body: {} }, res);

      expect(res.json.firstCall.args[0].status).to.equal('success');
    });

    it('refuses a caller that neither signed nor is entitled, and still answers', async () => {
      sinon.stub(fluxNetworkHelper, 'verifySignedFluxnodeMessage').resolves(false);
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      const res = resStub();

      await portManager.portsInUseApi({ body: {} }, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.match(/verify request authenticity/i);
    });

    it('answers rather than hanging when there is no body at all', async () => {
      sinon.stub(fluxNetworkHelper, 'verifySignedFluxnodeMessage').resolves(false);
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      const res = resStub();

      await portManager.portsInUseApi({}, res);

      sinon.assert.calledOnce(res.json);
    });
  });

  describe('refusedPort tests', () => {
    // One witness to accept, two to refuse. Our own token coming back is proof
    // and needs no corroboration; anything else is one peer's report about a
    // third party, and refusing on it stops the node installing anything.
    it('holds while only one peer has disagreed', () => {
      const disagreements = new Map([['1.2.3.4', 31201]]);

      expect(portManager.refusedPort(disagreements, 2)).to.equal(null);
    });

    it('refuses once a second, independent peer agrees', () => {
      const disagreements = new Map([['1.2.3.4', 31201], ['5.6.7.8', 31201]]);

      expect(portManager.refusedPort(disagreements, 2)).to.equal(31201);
    });

    it('names the first port that was disputed', () => {
      // The peers need not have tripped on the same port for the ports to be
      // unusable; the message names the one seen first.
      const disagreements = new Map([['1.2.3.4', 31201], ['5.6.7.8', 31202]]);

      expect(portManager.refusedPort(disagreements, 2)).to.equal(31201);
    });

    it('does not count one peer asked twice as two witnesses', () => {
      // The draw is random and can return the same peer again. Keying on the
      // peer is what makes a second reading a second OPINION.
      const disagreements = new Map();
      disagreements.set('1.2.3.4', 31201);
      disagreements.set('1.2.3.4', 31202);

      expect(portManager.refusedPort(disagreements, 2)).to.equal(null);
    });

    it('holds on no disagreement at all', () => {
      expect(portManager.refusedPort(new Map(), 2)).to.equal(null);
    });
  });

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

});

// The port test's own loop, which had no unit coverage of any kind: suite 98 is
// the only thing that has ever run it. Everything here is about what the loop
// does when it does NOT get a clean answer, which is where its two rules live -
// one witness to accept, two to refuse - and where the exits that skip them are.
describe('checkInstallingAppPortAvailable decides on every way of running out', () => {
  let port;
  let published;

  const PEERS = ['10.0.0.1:16127', '10.0.0.2:16127', '10.0.0.3:16127', '10.0.0.4:16127', '10.0.0.5:16127'];

  const answeringSomethingElse = (p) => ({
    data: { status: 'success', data: { answered: { [p]: 'HTTP/1.1 200 OK\r\n\r\nsomebody else entirely' } } },
  });
  const couldNotReach = (p) => ({
    data: { status: 'error', data: { message: `Flux Applications on 1.2.3.4:16127 are not available. Failed port: ${p}` } },
  });
  const wouldNotAnswer = () => ({
    data: { status: 'error', data: { message: 'Unable to verify request authenticity' } },
  });
  const UNREACHABLE = 'unreachable';

  // A free port, taken and released, so two runs of the suite cannot collide on
  // a hard-coded one. The test servers below bind it for real.
  before(async () => {
    const probe = require('node:net').createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    ({ port } = probe.address());
    await new Promise((resolve) => probe.close(resolve));
  });

  beforeEach(() => {
    published = [];

    sinon.stub(serviceHelper, 'delay').resolves();
    sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('1.2.3.4:16127');
    sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').resolves('04pubkey');
    sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').resolves('privkey');
    sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
    sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(false);
    sinon.stub(verificationHelper, 'signMessage').resolves('signature');
    sinon.stub(upnpService, 'isUPNP').returns(false);
    sinon.stub(fluxEventBus, 'publish').callsFake((name, data) => published.push({ name, data }));
  });

  afterEach(() => {
    sinon.restore();
  });

  // One attempt per drawn peer: the observer is drawn first, so the attempt
  // index advances there and the answer is looked up against it.
  const withPeers = (answers, peers = PEERS) => {
    let attempt = -1;

    sinon.stub(networkStateService, 'getRandomExternalObserver').callsFake(async () => {
      attempt += 1;
      return peers[attempt] || null;
    });

    sinon.stub(axios, 'post').callsFake(async () => {
      const answer = answers[attempt];
      if (!answer || answer === UNREACHABLE) throw new Error('connect ECONNREFUSED');
      return answer;
    });

    return portManager.checkInstallingAppPortAvailable([port]);
  };

  const reasonOf = (name) => (published.find((e) => e.name === name) || {}).data;

  // The bug: a verdict and "nobody has decided" were the same value, so a last
  // attempt that never got an answer fell out of the bottom of the loop onto the
  // false it started with - and refused the install on one peer's word, which is
  // the exact thing the two-witness rule exists to stop.
  it('proceeds when one peer disagreed and every peer after it went silent', async () => {
    const result = await withPeers([
      answeringSomethingElse(port), UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE,
    ]);

    expect(result, 'refused on a single witness after running out of peers').to.equal(true);
    expect(reasonOf('ports:unproven').reason).to.equal('singleWitness');
    expect(reasonOf('ports:unproven').port).to.equal(port);
  });

  it('proceeds when no peer answered at all, and says so', async () => {
    const result = await withPeers([UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE]);

    expect(result, 'refused having learned nothing from anybody').to.equal(true);
    expect(reasonOf('ports:unproven').reason).to.equal('noneAnswered');
    expect(reasonOf('ports:unproven').silent).to.equal(true);
  });

  // A peer refusing the question is not a report about our ports. Read as one it
  // refuses an install that was fine and records a cause that never happened.
  it('does not treat a peer that rejects the request as a witness', async () => {
    const result = await withPeers([
      wouldNotAnswer(), UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE,
    ]);

    expect(result, 'a peer rejecting the request refused the install').to.equal(true);
    expect(published.some((e) => e.name === 'ports:notOurs'), 'refused on an authentication failure').to.equal(false);
    expect(reasonOf('ports:unproven').reason).to.equal('noneAnswered');
  });

  // A peer that NAMES the port it could not reach has read something at this
  // address. That is evidence, and it goes to the same rule everything else
  // does - one peer's report is not enough to refuse.
  it('counts a peer that could not reach a port as one witness, not a verdict', async () => {
    const result = await withPeers([
      couldNotReach(port), UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE,
    ]);

    expect(result, 'refused on one peer failing to reach the port').to.equal(true);
    expect(reasonOf('ports:unproven').reason).to.equal('singleWitness');
  });

  it('refuses once two distinct peers agree the port is not ours', async () => {
    const result = await withPeers([
      answeringSomethingElse(port), answeringSomethingElse(port), UNREACHABLE, UNREACHABLE, UNREACHABLE,
    ]);

    expect(result, 'two corroborating witnesses did not refuse').to.equal(false);
    expect(reasonOf('ports:notOurs').port).to.equal(port);
    expect(reasonOf('ports:notOurs').peers).to.have.length(2);
  });

  // Corroboration counts distinct peers, not identical readings - so an
  // unreachable-port report and a token mismatch corroborate each other, and the
  // line has to name what each peer actually read rather than one port twice.
  it('corroborates across the two kinds of disagreement and records both readings', async () => {
    const result = await withPeers([
      couldNotReach(port), answeringSomethingElse(port), UNREACHABLE, UNREACHABLE, UNREACHABLE,
    ]);

    expect(result).to.equal(false);
    expect(Object.keys(reasonOf('ports:notOurs').readings)).to.have.length(2);
  });

  it('proceeds when every peer reached the ports but was too old to read them', async () => {
    const older = { data: { status: 'success', data: {} } };
    const result = await withPeers([older, older, older, older, older]);

    expect(result).to.equal(true);
    expect(reasonOf('ports:unproven').reason).to.equal('noReader');
  });

  it('proceeds, naming the disagreement, when there is nobody else outside this address', async () => {
    const result = await withPeers([answeringSomethingElse(port)], [PEERS[0]]);

    expect(result).to.equal(true);
    expect(reasonOf('ports:unproven').reason).to.equal('noOtherObserver');
    expect(reasonOf('ports:unproven').peers).to.have.length(1);
  });
});
