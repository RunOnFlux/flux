const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
// eslint-disable-next-line no-unused-vars
const axios = require('axios');
const config = require('config');
const availabilityChecker = require('../../ZelBack/src/services/appMonitoring/availabilityChecker');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const generalService = require('../../ZelBack/src/services/generalService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
// eslint-disable-next-line no-unused-vars
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const upnpService = require('../../ZelBack/src/services/upnpService');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const fluxHttpTestServer = require('../../ZelBack/src/services/utils/fluxHttpTestServer');
const fluxUdpTestServer = require('../../ZelBack/src/services/utils/fluxUdpTestServer');
const portManager = require('../../ZelBack/src/services/appNetwork/portManager');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const policyStore = require('../../ZelBack/src/services/policyStore');
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');
const portClaims = require('../../ZelBack/src/services/appNetwork/portClaims');

const signer = { pubKey: 'pubkey', sign: () => 'signature' };
// the check with a node that can sign its port test
const signingAvailabilityChecker = proxyquire('../../ZelBack/src/services/appMonitoring/availabilityChecker', {
  '../utils/nodeSigner': { nodeSigner: async () => signer },
});

// the check with a node that cannot sign its port test: it throws once it is listening
const unsignedAvailabilityChecker = proxyquire('../../ZelBack/src/services/appMonitoring/availabilityChecker', {
  '../utils/nodeSigner': { nodeSigner: async () => null },
});

describe('availabilityChecker tests', () => {
  let mockInstalledAppsFn;
  let mockDosState;
  let mockPortsNotWorking;
  let mockFailedNodesCache;
  let isArcane;
  let delayStub;
  let setImmediateStub;
  let udpServers;
  let udpToken;

  beforeEach(() => {
    mockInstalledAppsFn = sinon.stub();
    mockDosState = {
      dosMessage: null,
      dosStateValue: 0,
      testingPort: null,
      nextTestingPort: null,
      originalPortFailed: null,
      routerRefusalsSeen: 0,
    };
    mockPortsNotWorking = new Set();
    mockFailedNodesCache = new Map();
    isArcane = false;

    // Stub delay to prevent actual waiting
    delayStub = sinon.stub(serviceHelper, 'delay').resolves();
    // Stub setImmediate to prevent infinite recursion
    setImmediateStub = sinon.stub(global, 'setImmediate');

    // No application at this address holds a port, unless a test says so.
    sinon.stub(registryManager, 'getRunningAppIpList').resolves([]);
    sinon.stub(portManager, 'assignedPortsGlobalApps').resolves([]);
    sinon.stub(portManager, 'siblingHoldingPort').resolves(null);

    udpServers = [];
    udpToken = null;
    sinon.stub(fluxUdpTestServer, 'FluxUdpTestServer').callsFake((token) => {
      udpToken = token;
      const server = { listen: sinon.stub().resolves(), allow: sinon.stub(), close: sinon.stub() };
      udpServers.push(server);
      return server;
    });
  });

  afterEach(() => {
    sinon.restore();
    fluxNetworkHelper.setUdpReachability(null);
  });

  describe('checkMyAppsAvailability tests', () => {
    it('should return early if daemon not synced', async () => {
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: false },
      });

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.notCalled(mockInstalledAppsFn);
      sinon.assert.calledWith(delayStub, 240_000);
    });

    it('should return early if node not confirmed', async () => {
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(false);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.notCalled(mockInstalledAppsFn);
    });

    it('should return early if no public IP found', async () => {
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves(null);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.notCalled(mockInstalledAppsFn);
    });

    it('should return early if failed to get installed apps', async () => {
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'error', data: { message: 'Failed' } });

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.calledOnce(mockInstalledAppsFn);
    });

    it('should collect ports from v1 apps', async () => {
      const apps = [
        { name: 'App1', version: 1, port: 30001 },
      ];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(networkStateService, 'getRandomExternalObserver').resolves(null);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      // Port should be skipped if it's in use
      sinon.assert.calledOnce(mockInstalledAppsFn);
    });

    it('should collect ports from v2-v3 apps', async () => {
      const apps = [
        { name: 'App1', version: 3, ports: [30001, 30002, 30003] },
      ];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(networkStateService, 'getRandomExternalObserver').resolves(null);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.calledOnce(mockInstalledAppsFn);
    });

    it('should collect ports from compose apps (v4+)', async () => {
      const apps = [
        {
          name: 'ComposedApp',
          version: 4,
          compose: [
            { name: 'Component1', ports: [30001, 30002] },
            { name: 'Component2', ports: [30003] },
          ],
        },
      ];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(networkStateService, 'getRandomExternalObserver').resolves(null);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.calledOnce(mockInstalledAppsFn);
    });

    it('should skip banned ports', async () => {
      const apps = [];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(true);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.calledWith(delayStub, 15_000);
    });

    it('should skip UPNP banned ports when UPNP enabled', async () => {
      const apps = [];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(upnpService, 'isUPNP').returns(true);
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUPNPBanned').returns(true);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.called(delayStub);
    });


    it('should skip ports already in use by apps', async () => {
      mockDosState.testingPort = 30001;
      const apps = [
        { name: 'App1', version: 3, ports: [30001] },
      ];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.called(delayStub);
    });

    it('should skip if remote socket address not available', async () => {
      const apps = [];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(networkStateService, 'getRandomExternalObserver').resolves(null);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.calledWith(delayStub, 240_000);
    });

    it('should skip if remote node in failed cache', async () => {
      const apps = [];
      mockFailedNodesCache.set('192.168.1.200:16127', '');

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(networkStateService, 'getRandomExternalObserver').resolves('192.168.1.200:16127');

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.calledWith(delayStub, 15_000);
    });

    describe('a node behind UPnP', () => {
      const UPNP_DOS = 'Not possible to run applications on the node, router returning exceptions when creating UPNP ports mappings';
      let refusals;
      let mapUpnpPortStub;
      let removeMapUpnpPortStub;
      let portTestStub;

      const refused = (code, routerWide) => ({
        mapped: false, code, reason: `TCP 1 not mapped: UPnP error ${code}`, routerWide,
      });
      const MAPPED = {
        mapped: true, code: null, reason: null, routerWide: false,
      };
      // the router refuses `count` mappings of others - an install's, a restore's
      const routerRefusesOthers = (count) => { refusals += count; };

      beforeEach(() => {
        refusals = 0;
        sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true } });
        sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
        sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
        mockInstalledAppsFn.resolves({ status: 'success', data: [] });
        sinon.stub(upnpService, 'isUPNP').returns(true);
        sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
        // The port under test is drawn at random, so this gate has to be closed
        // too: left real, it refuses whenever the draw lands in upnpBannedPorts
        // and the run returns before it ever reaches mapUpnpPort.
        sinon.stub(fluxNetworkHelper, 'isPortUPNPBanned').returns(false);
        sinon.stub(networkStateService, 'getRandomExternalObserver').resolves('192.168.1.200:16127');
        sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);
        sinon.stub(fluxNetworkHelper, 'allowTestPort').resolves();
        sinon.stub(fluxNetworkHelper, 'deleteTestPortRule').resolves();
        sinon.stub(upnpService, 'routerRefusals').callsFake(() => refusals);
        sinon.stub(upnpService, 'removalPending').returns(false);
        mapUpnpPortStub = sinon.stub(upnpService, 'mapUpnpPort').resolves(MAPPED);
        removeMapUpnpPortStub = sinon.stub(upnpService, 'removeMapUpnpPort').resolves(true);
        sinon.stub(fluxHttpTestServer.FluxHttpTestServer.prototype, 'listen').callsFake(function listen() {
          this.emit('listening');
          return this;
        });
        sinon.stub(fluxHttpTestServer.FluxHttpTestServer.prototype, 'close').callsFake((callback) => callback && callback());
        portTestStub = sinon.stub(axios, 'post').resolves({ data: { status: 'success', data: { message: 'Ports reachable' } } });
      });

      // the test mapping refused as `result` gives it, one router-wide refusal counted when it is
      const testMappingRefused = (result) => mapUpnpPortStub.callsFake(async () => {
        if (result.routerWide) refusals += 1;
        return result;
      });

      const pass = () => signingAvailabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      it('counts a test mapping the router refused for its own reason', async () => {
        testMappingRefused(refused(728, true));

        await pass();

        expect(mockDosState.portFailureScore).to.equal(4);
        expect(mockDosState.dosStateValue, 'the node\'s DOS, which a count below the threshold leaves alone').to.equal(0);
        sinon.assert.notCalled(portTestStub);
        sinon.assert.calledWith(delayStub, 60_000);
      });

      it('does not count a test mapping refused for its port alone', async () => {
        testMappingRefused(refused(718, false));

        await pass();

        expect(mockDosState.portFailureScore ?? 0).to.equal(0);
      });

      // A pass costs the router one mapping and one removal.
      it('maps the port under test for one protocol a pass, TCP first', async () => {
        await pass();

        sinon.assert.calledOnceWithExactly(mapUpnpPortStub, mockDosState.testingPort, 'Flux_Test_App', { protocols: ['TCP'] });
        expect(JSON.parse(portTestStub.firstCall.args[1]).protocols).to.deep.equal(['tcp']);
        sinon.assert.notCalled(fluxUdpTestServer.FluxUdpTestServer);
      });

      it('asks the router for no mapping of a port it cannot listen on, and maps the next one', async () => {
        fluxHttpTestServer.FluxHttpTestServer.prototype.listen.onFirstCall().callsFake(function listenInUse() {
          this.emit('error', new Error('listen EADDRINUSE: address already in use'));
          return this;
        });

        await pass();

        sinon.assert.notCalled(mapUpnpPortStub);
        sinon.assert.notCalled(removeMapUpnpPortStub);
        sinon.assert.notCalled(portTestStub);

        await pass();

        sinon.assert.calledOnce(mapUpnpPortStub);
        expect(mapUpnpPortStub.firstCall.args[2], 'the protocol a pass that did not test leaves').to.deep.equal({ protocols: ['TCP'] });
      });

      it('tests UDP alone on the pass after a TCP pass that passed, and TCP after that', async () => {
        await pass();
        portTestStub.callsFake(async (url, body) => {
          const { ports: [port] } = JSON.parse(body);
          return { data: { status: 'success', data: { udpAnswered: { [port]: fluxUdpTestServer.udpReply(udpToken).toString() } } } };
        });
        await pass();

        expect(mapUpnpPortStub.secondCall.args[2]).to.deep.equal({ protocols: ['UDP'] });
        expect(JSON.parse(portTestStub.secondCall.args[1]).protocols).to.deep.equal(['udp']);
        expect(fluxHttpTestServer.FluxHttpTestServer.prototype.listen.callCount, 'a TCP test server on the UDP pass').to.equal(1);
        expect(fluxNetworkHelper.getUdpReachability()).to.deep.equal({ reachable: true });

        await pass();
        expect(mapUpnpPortStub.thirdCall.args[2]).to.deep.equal({ protocols: ['TCP'] });
      });

      // A peer that does not know `protocols` tests TCP, finds it unmapped, and
      // says the port failed: on a UDP pass that is no evidence at all.
      it('reads nothing from a peer\'s TCP failure on a UDP pass, and tests UDP again with another peer', async () => {
        mockDosState.testingProtocol = 'udp';
        portTestStub.callsFake(async (url, body) => {
          const { ports: [port] } = JSON.parse(body);
          return { data: { status: 'error', data: { message: `Flux Applications on 1.2.3.4:16127 are not available. Failed port: ${port}` } } };
        });

        await pass();

        expect(mockPortsNotWorking.size).to.equal(0);
        expect(mockDosState.portFailureScore ?? 0).to.equal(0);
        expect(mockDosState.nextTestingPort).to.equal(mockDosState.testingPort);
        expect(mockDosState.testingProtocol).to.equal('udp');
        sinon.assert.calledWith(delayStub.lastCall, 15_000);
      });

      it('goes back to TCP after as many UDP passes as learn nothing', async () => {
        mockDosState.testingProtocol = 'udp';
        portTestStub.resolves({ data: { status: 'error', data: { message: 'Failed port: 1' } } });

        await pass();
        await pass();
        expect(mockDosState.testingProtocol, 'gave up early').to.equal('udp');
        await pass();

        expect(mockDosState.testingProtocol).to.equal('tcp');
        expect(mockDosState.udpUnsettled).to.equal(0);
      });

      // A router refusing the UDP mapping is as broken as one refusing TCP.
      it('counts a UDP mapping the router refused for its own reason as a router fault, and stays on UDP', async () => {
        mockDosState.testingProtocol = 'udp';
        testMappingRefused(refused(606, true));

        await pass();

        expect(mockDosState.portFailureScore).to.equal(4);
        expect(mockDosState.testingProtocol).to.equal('udp');
        sinon.assert.notCalled(portTestStub);
      });

      it('stays on TCP while its TCP test fails', async () => {
        portTestStub.resolves({ data: { status: 'error', data: { message: 'Failed port: 1' } } });

        await pass();

        expect(mockPortsNotWorking.size).to.equal(1);
        expect(mockDosState.testingProtocol ?? 'tcp').to.equal('tcp');
      });

      it('makes no test mapping, opens no port, and counts a failed check while the router has yet to remove a mapping of this node', async () => {
        upnpService.removalPending.returns(true);

        await pass();

        sinon.assert.notCalled(mapUpnpPortStub);
        sinon.assert.notCalled(fluxNetworkHelper.allowTestPort);
        sinon.assert.notCalled(portTestStub);
        expect(mockDosState.portFailureScore).to.equal(4);
        sinon.assert.calledWith(delayStub, 60_000);
      });

      it('holds the node out of service once the router has yet to remove a mapping for as many passes as the threshold takes', async () => {
        upnpService.removalPending.returns(true);

        // eslint-disable-next-line no-restricted-syntax
        for (let i = 0; i < 25; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await pass();
        }

        expect(mockDosState.portFailureScore).to.equal(100);
        expect(mockDosState.dosMessage).to.equal(UPNP_DOS);
        expect(mockDosState.dosStateValue).to.equal(100);
        sinon.assert.calledWith(delayStub.lastCall, 300_000);
      });

      it('waits no longer than an error\'s wait after a pass that left a removal pending', async () => {
        upnpService.removalPending.onFirstCall().returns(false).returns(true);

        await pass();

        sinon.assert.calledOnce(portTestStub);
        sinon.assert.calledWith(delayStub.lastCall, 60_000);
      });

      it('waits no longer than an error\'s wait after a passing test in a pass that counted a router refusal', async () => {
        routerRefusesOthers(1);

        await pass();

        sinon.assert.calledOnce(portTestStub);
        sinon.assert.calledWith(delayStub.lastCall, 60_000);
      });

      it('waits no longer than an error\'s wait after a pass the router refused a mapping during', async () => {
        portTestStub.callsFake(async () => {
          routerRefusesOthers(1);
          return { data: { status: 'success', data: { message: 'Ports reachable' } } };
        });

        await pass();

        expect(mockDosState.portFailureScore ?? 0, 'counted by the next pass').to.equal(0);
        sinon.assert.calledWith(delayStub.lastCall, 60_000);
      });

      it('waits a DOS\'s wait after a pass that counted a router refusal while out of service', async () => {
        mockDosState.portFailureScore = 100;
        mockDosState.dosStateValue = 100;
        mockDosState.dosMessage = UPNP_DOS;
        routerRefusesOthers(1);

        await pass();

        sinon.assert.calledWith(delayStub.lastCall, 300_000);
      });

      it('waits the whole wait after a passing test that left nothing pending', async () => {
        await pass();

        sinon.assert.calledWith(delayStub.lastCall, 3_600_000);
      });

      // eslint-disable-next-line no-restricted-syntax
      for (const event of ['mappingRefused', 'removalPending', 'removalsClear']) {
        it(`starts its next pass at once on UPnP's ${event}`, async () => {
          delayStub.returns(new Promise(() => {}));
          let waited = false;
          const done = pass().then(() => { waited = true; });
          // eslint-disable-next-line no-await-in-loop
          for (let i = 0; i < 1000 && !delayStub.called; i += 1) await Promise.resolve();
          sinon.assert.calledOnceWithExactly(delayStub, 3_600_000);
          expect(waited, 'still waiting').to.equal(false);

          upnpService.routerEvents.emit(event);
          upnpService.routerEvents.emit(event);
          await done;

          expect(waited).to.equal(true);
          sinon.assert.calledOnce(setImmediateStub);
        });
      }

      it('starts no pass on a wake while it is not waiting', async () => {
        portTestStub.callsFake(async () => {
          upnpService.routerEvents.emit('removalsClear');
          return { data: { status: 'success', data: { message: 'Ports reachable' } } };
        });

        await pass();

        sinon.assert.calledOnce(setImmediateStub);
        sinon.assert.calledWith(delayStub.lastCall, 3_600_000);
      });

      it('removes what the router kept of a test mapping it refused', async () => {
        testMappingRefused(refused(718, false));

        await pass();

        sinon.assert.calledOnceWithExactly(removeMapUpnpPortStub, mockDosState.testingPort, 'Flux_Test_App');
      });

      it('opens the port under test to IPv4 only, and deletes only that rule', async () => {
        testMappingRefused(refused(728, true));
        const allowBoth = sinon.stub(fluxNetworkHelper, 'allowPort').resolves();
        const deleteBoth = sinon.stub(fluxNetworkHelper, 'deleteAllowPortRule').resolves();

        await pass();

        expect(fluxNetworkHelper.allowTestPort.args).to.deep.equal([[mockDosState.testingPort, 'tcp']]);
        expect(fluxNetworkHelper.deleteTestPortRule.args).to.deep.equal([[mockDosState.testingPort, 'tcp']]);
        sinon.assert.notCalled(allowBoth);
        sinon.assert.notCalled(deleteBoth);
      });

      it('counts once a pass however many mappings the router refused since the last', async () => {
        routerRefusesOthers(7);

        await pass();

        expect(mockDosState.portFailureScore).to.equal(4);
        expect(mockDosState.routerRefusalsSeen).to.equal(7);
      });

      it('counts nothing for refusals an earlier pass counted', async () => {
        routerRefusesOthers(7);
        mockDosState.routerRefusalsSeen = 7;

        await pass();

        expect(mockDosState.portFailureScore ?? 0).to.equal(0);
      });

      it('keeps its router DOS through a pass whose test worked while the router refused others', async () => {
        mockDosState.portFailureScore = 100;
        mockDosState.dosStateValue = 100;
        mockDosState.dosMessage = UPNP_DOS;
        routerRefusesOthers(1);

        await pass();

        sinon.assert.calledOnce(portTestStub);
        expect(mockDosState.dosMessage).to.equal(UPNP_DOS);
        expect(mockDosState.dosStateValue).to.equal(100);
        expect(mockDosState.portFailureScore).to.equal(100);
      });

      it('ends its router DOS on a pass whose test worked and the router refused nothing', async () => {
        mockDosState.portFailureScore = 100;
        mockDosState.dosStateValue = 100;
        mockDosState.dosMessage = UPNP_DOS;
        routerRefusesOthers(3);
        mockDosState.routerRefusalsSeen = 3;

        await pass();

        sinon.assert.calledOnce(portTestStub);
        expect(mockDosState.dosMessage).to.equal(null);
        expect(mockDosState.dosStateValue).to.equal(0);
        expect(mockDosState.portFailureScore).to.equal(0);
      });

      it('leaves another check\'s DOS message standing when its own UPnP failures reach the threshold', async () => {
        mockDosState.portFailureScore = 96;
        mockDosState.dosStateValue = 12;
        mockDosState.dosMessage = 'Flux is not available for outside communication';
        testMappingRefused(refused(728, true));

        await pass();

        expect(mockDosState.portFailureScore).to.equal(100);
        expect(mockDosState.dosStateValue).to.equal(12);
        expect(mockDosState.dosMessage).to.equal('Flux is not available for outside communication');
      });

      it('holds the node out of service with its own message when its UPnP failures reach the threshold and no other stands', async () => {
        mockDosState.portFailureScore = 96;
        testMappingRefused(refused(728, true));

        await pass();

        expect(mockDosState.dosMessage).to.equal(UPNP_DOS);
        expect(mockDosState.dosStateValue).to.equal(100);
        sinon.assert.calledWith(delayStub, 300_000);
      });
    });

    describe('proof over TCP and UDP', () => {
      const PEERS = ['192.168.1.200:16127', '192.168.1.201:16127', '192.168.1.202:16127', '192.168.1.203:16127', '192.168.1.204:16127'];
      let observer;
      let portTestStub;

      // What a peer that reads the port and probes UDP answers: `tcp` and `udp`
      // are 'ours', another application's bytes, or null for silence; `udp`
      // undefined is a peer that does not probe UDP.
      const reading = (tcp, udp) => async (url, body) => {
        const { ports: [port] } = JSON.parse(body);
        const value = (v, ours) => (v === 'ours' ? ours : v);
        const data = { message: 'Ports reachable', answered: { [port]: value(tcp, `X-Flux-Port-Test: ${udpToken}`) } };
        if (udp !== undefined) data.udpAnswered = { [port]: value(udp, fluxUdpTestServer.udpReply(udpToken).toString()) };
        return { data: { status: 'success', data } };
      };

      beforeEach(() => {
        sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true } });
        sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
        sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
        mockInstalledAppsFn.resolves({ status: 'success', data: [] });
        sinon.stub(upnpService, 'isUPNP').returns(false);
        sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
        observer = -1;
        sinon.stub(networkStateService, 'getRandomExternalObserver').callsFake(async () => {
          observer += 1;
          return PEERS[observer];
        });
        sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(false);
        sinon.stub(fluxHttpTestServer.FluxHttpTestServer.prototype, 'listen').callsFake(function listen() {
          this.emit('listening');
          return this;
        });
        sinon.stub(fluxHttpTestServer.FluxHttpTestServer.prototype, 'close').callsFake((callback) => callback && callback());
        portTestStub = sinon.stub(axios, 'post').callsFake(reading('ours', 'ours'));
      });

      const pass = () => signingAvailabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      it('asks the peer to read the port and probe it over UDP, answering only that peer', async () => {
        await pass();

        const body = JSON.parse(portTestStub.firstCall.args[1]);
        expect(body.echo).to.equal(true);
        expect(body.protocols).to.deep.equal(['tcp', 'udp']);
        sinon.assert.calledOnceWithExactly(udpServers[0].listen, mockDosState.testingPort);
        sinon.assert.calledOnceWithExactly(udpServers[0].allow, '192.168.1.200');
        expect(udpServers[0].allow.calledBefore(portTestStub)).to.equal(true);
        sinon.assert.calledOnce(udpServers[0].close);
      });

      it('passes, and reports UDP reachable, on our token over TCP and UDP', async () => {
        await pass();

        expect(mockPortsNotWorking.size).to.equal(0);
        expect(fluxNetworkHelper.getUdpReachability()).to.deep.equal({ reachable: true });
        sinon.assert.calledWith(delayStub.lastCall, 3_600_000);
      });

      // Whatever holds the port, this node cannot serve an application on it.
      it('counts a port that answered as something other than this node as failed', async () => {
        portTestStub.callsFake(reading('somebody else entirely', undefined));

        await pass();

        expect(mockPortsNotWorking.has(mockDosState.testingPort)).to.equal(true);
      });

      it('takes a peer that does not read ports at its word', async () => {
        portTestStub.resolves({ data: { status: 'success', data: { message: 'Ports reachable' } } });

        await pass();

        expect(mockPortsNotWorking.size).to.equal(0);
        expect(fluxNetworkHelper.getUdpReachability()).to.equal(null);
      });

      it('skips a port an application at this address holds, testing nothing', async () => {
        sinon.stub(Math, 'random').returns(0.5);
        const { fluxapps: { portMin, portMax } } = config;
        const port = Math.floor(0.5 * (portMax - portMin) + portMin);
        registryManager.getRunningAppIpList.resolves([{ name: 'neighbour' }]);
        portManager.assignedPortsGlobalApps.resolves([{ name: 'neighbour', ports: [port] }]);

        await pass();

        sinon.assert.calledWith(portManager.assignedPortsGlobalApps, ['neighbour']);
        sinon.assert.notCalled(portTestStub);
        expect(mockPortsNotWorking.size).to.equal(0);
      });

      it('skips a port a node sharing this address says it holds, testing nothing', async () => {
        portManager.siblingHoldingPort.resolves({ address: '192.168.1.100:16137', port: 1 });

        await pass();

        sinon.assert.notCalled(portTestStub);
      });

      describe('its claim on the port', () => {
        const PORT = 31555;

        beforeEach(() => {
          mockDosState.nextTestingPort = PORT;
        });

        afterEach(() => {
          expect(portClaims.claimedPorts(), 'a claim outlived its pass').to.deep.equal([]);
        });

        it('skips a port an installation holds, listening on nothing and asking no peer', async () => {
          const installing = portClaims.claim([PORT], portClaims.ClaimKind.INSTALL, 'installingapp');
          try {
            await pass();

            sinon.assert.notCalled(fluxHttpTestServer.FluxHttpTestServer.prototype.listen);
            sinon.assert.notCalled(portTestStub);
            expect(udpServers).to.have.length(0);
            expect(portClaims.holderOf([PORT]), 'the installation\'s claim').to.equal(installing);
          } finally {
            portClaims.release(installing);
          }
        });

        it('holds the port while it listens, and releases it once its servers have closed', async () => {
          let heldWhileAsking = null;
          portTestStub.callsFake(async (url, body) => {
            heldWhileAsking = portClaims.holderOf([PORT]);
            return reading('ours', 'ours')(url, body);
          });
          let heldAtClose;
          fluxHttpTestServer.FluxHttpTestServer.prototype.close.callsFake((callback) => {
            heldAtClose = portClaims.holderOf([PORT]);
            return callback && callback();
          });

          await pass();

          expect(heldWhileAsking).to.include({ kind: portClaims.ClaimKind.CHECK });
          expect(heldAtClose, 'released before the server closed').to.include({ kind: portClaims.ClaimKind.CHECK });
        });

        it('releases the port after a pass whose peer could not be reached', async () => {
          portTestStub.rejects(new Error('connect ECONNREFUSED'));

          await pass();

          sinon.assert.calledOnce(portTestStub);
        });

        it('releases the port after a pass that could not listen on it', async () => {
          fluxHttpTestServer.FluxHttpTestServer.prototype.listen.callsFake(function listen() {
            this.emit('error', new Error('listen EADDRINUSE'));
            return this;
          });

          await pass();

          sinon.assert.notCalled(portTestStub);
        });

        it('releases the port after a pass that failed part way', async () => {
          await unsignedAvailabilityChecker.checkMyAppsAvailability(mockInstalledAppsFn, mockDosState, mockPortsNotWorking, mockFailedNodesCache, isArcane);

          sinon.assert.calledOnce(fluxHttpTestServer.FluxHttpTestServer.prototype.listen);
          sinon.assert.notCalled(portTestStub);
        });
      });

      // UDP loses datagrams: one peer's silence is tested again by another.
      it('counts nothing on one peer\'s silence over UDP, and tests the port again with another peer', async () => {
        portTestStub.callsFake(reading('ours', null));

        await pass();
        const port = mockDosState.testingPort;

        expect(mockPortsNotWorking.size).to.equal(0);
        expect(mockDosState.nextTestingPort).to.equal(port);
        sinon.assert.calledWith(delayStub.lastCall, 15_000);
        expect(fluxNetworkHelper.getUdpReachability()).to.equal(null);

        await pass();

        expect(mockDosState.testingPort).to.equal(port);
        sinon.assert.calledWith(networkStateService.getRandomExternalObserver.secondCall, '192.168.1.100:16127', { exclude: [PEERS[0]] });
      });

      // A pass whose TCP passes is a passing pass for TCP, whatever UDP needs next.
      it('clears its failed ports and lifts its DOS on a TCP pass whose first peer heard nothing over UDP, and still retests UDP', async () => {
        const count = sinon.spy(fluxEventBus, 'count');
        mockPortsNotWorking.add(1234);
        mockDosState.portFailureScore = 8;
        mockDosState.dosMessage = 'Ports tested not reachable from outside, DMZ or UPNP required! All ports that have failed: [1234]';
        mockDosState.dosStateValue = 100;
        portTestStub.callsFake(reading('ours', null));

        await pass();

        expect(mockPortsNotWorking.size, 'failed ports left until the retest').to.equal(0);
        expect(mockDosState.dosMessage, 'its DOS left until the retest').to.equal(null);
        expect(mockDosState.nextTestingPort).to.equal(mockDosState.testingPort);
        sinon.assert.calledWith(delayStub.lastCall, 15_000);
        sinon.assert.calledWithExactly(count, 'availability:firstUdpSilence', 'passed', 'cleared');
      });

      it('tallies the branch each pass took', async () => {
        const count = sinon.spy(fluxEventBus, 'count');

        await pass();

        sinon.assert.calledWithExactly(count, 'availability:pass', 'passed', 'proven');
        sinon.assert.neverCalledWith(count, 'availability:firstUdpSilence');
      });

      it('takes our token heard by a second peer over the first peer\'s silence', async () => {
        portTestStub.onFirstCall().callsFake(reading('ours', null));

        await pass();
        await pass();

        expect(fluxNetworkHelper.getUdpReachability()).to.deep.equal({ reachable: true });
        expect(mockDosState.udpSuspect).to.equal(null);
      });

      it('reports UDP unreachable, and counts nothing, when two peers hear nothing and policy has not switched the DOS on', async () => {
        portTestStub.callsFake(reading('ours', null));

        await pass();
        await pass();

        expect(fluxNetworkHelper.getUdpReachability()).to.deep.equal({
          reachable: false, port: mockDosState.testingPort, peers: ['192.168.1.200', '192.168.1.201'],
        });
        expect(mockPortsNotWorking.size).to.equal(0);
      });

      it('counts the port failed when two peers hear nothing and policy has switched the DOS on', async () => {
        sinon.stub(policyStore, 'getDocument').withArgs('udpportdos').returns(true);
        portTestStub.callsFake(reading('ours', null));

        await pass();
        await pass();

        expect(mockPortsNotWorking.has(mockDosState.testingPort)).to.equal(true);
        expect(fluxNetworkHelper.getUdpReachability().reachable).to.equal(false);
      });

      it('drops one peer\'s silence unconfirmed after as many passes as find no peer that probes UDP', async () => {
        portTestStub.onFirstCall().callsFake(reading('ours', null));
        portTestStub.callsFake(reading('ours', undefined));

        await pass();
        const port = mockDosState.testingPort;
        await pass();
        await pass();
        expect(mockDosState.nextTestingPort, 'stopped retesting early').to.equal(port);
        await pass();

        expect(mockDosState.udpSuspect).to.equal(null);
        expect(mockDosState.nextTestingPort).to.equal(null);
        expect(fluxNetworkHelper.getUdpReachability()).to.equal(null);
      });
    });

    it('should handle errors gracefully and retry', async () => {
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').throws(new Error('Service error'));

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.calledWith(delayStub, 240_000);
      sinon.assert.calledOnce(setImmediateStub);
    });

    it('should use random port from config range when nextTestingPort not set', async () => {
      const apps = [];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(networkStateService, 'getRandomExternalObserver').resolves(null);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      expect(mockDosState.testingPort).to.be.a('number');
      expect(mockDosState.testingPort).to.be.at.least(config.fluxapps.portMin);
      expect(mockDosState.testingPort).to.be.at.most(config.fluxapps.portMax);
    });

    it('should use nextTestingPort when set', async () => {
      const apps = [];
      mockDosState.nextTestingPort = 30050;

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(networkStateService, 'getRandomExternalObserver').resolves(null);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      expect(mockDosState.testingPort).to.equal(30050);
    });
  });

  describe('releaseOwnDos', () => {
    const ports = 'Ports tested not reachable from outside, DMZ or UPNP required! All ports that have failed: [1]';

    it('ends its count, and the node\'s DOS when the message is this check\'s', () => {
      const state = { dosMessage: ports, dosStateValue: 100, portFailureScore: 100 };

      availabilityChecker.releaseOwnDos(state);

      expect(state).to.deep.equal({ dosMessage: null, dosStateValue: 0, portFailureScore: 0 });
    });

    it('ends its count and leaves the node\'s count when no check holds the node out of service', () => {
      const state = { dosMessage: null, dosStateValue: 8, portFailureScore: 40 };

      availabilityChecker.releaseOwnDos(state);

      expect(state).to.deep.equal({ dosMessage: null, dosStateValue: 8, portFailureScore: 0 });
    });

    it('ends its count and leaves another check\'s DOS alone', () => {
      const state = { dosMessage: 'Flux IP detection failed', dosStateValue: 11, portFailureScore: 100 };

      availabilityChecker.releaseOwnDos(state);

      expect(state).to.deep.equal({ dosMessage: 'Flux IP detection failed', dosStateValue: 11, portFailureScore: 0 });
    });
  });

  describe('countPortFailure', () => {
    const ports = 'Ports tested not reachable from outside, DMZ or UPNP required! All ports that have failed: [1]';

    it('counts four a failure toward its own threshold, leaving the node\'s DOS alone below it', () => {
      const state = { dosMessage: null, dosStateValue: 3, portFailureScore: 92 };

      expect(availabilityChecker.countPortFailure(state, 100, ports)).to.equal(false);

      expect(state).to.deep.equal({ dosMessage: null, dosStateValue: 3, portFailureScore: 96 });
    });

    it('holds the node out of service at the threshold when no other check does', () => {
      const state = { dosMessage: null, dosStateValue: 3, portFailureScore: 96 };

      expect(availabilityChecker.countPortFailure(state, 100, ports)).to.equal(true);

      expect(state).to.deep.equal({ dosMessage: ports, dosStateValue: 100, portFailureScore: 100 });
    });

    it('does not take over another check\'s DOS at the threshold', () => {
      const state = { dosMessage: 'Flux IP detection failed', dosStateValue: 11, portFailureScore: 96 };

      expect(availabilityChecker.countPortFailure(state, 100, ports)).to.equal(false);

      expect(state).to.deep.equal({ dosMessage: 'Flux IP detection failed', dosStateValue: 11, portFailureScore: 100 });
    });
  });
});
