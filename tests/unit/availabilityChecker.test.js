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

const signer = { pubKey: 'pubkey', sign: () => 'signature' };
// the check with a node that can sign its port test
const signingAvailabilityChecker = proxyquire('../../ZelBack/src/services/appMonitoring/availabilityChecker', {
  '../utils/nodeSigner': { nodeSigner: async () => signer },
});

describe('availabilityChecker tests', () => {
  let mockInstalledAppsFn;
  let mockDosState;
  let mockPortsNotWorking;
  let mockFailedNodesCache;
  let isArcane;
  let delayStub;
  let setImmediateStub;

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
  });

  afterEach(() => {
    sinon.restore();
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
        sinon.stub(upnpService, 'testRemovalPending').returns(false);
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

      it('makes no test mapping, and opens no port, while the router has yet to remove the last one', async () => {
        upnpService.testRemovalPending.returns(true);

        await pass();

        sinon.assert.notCalled(mapUpnpPortStub);
        sinon.assert.notCalled(fluxNetworkHelper.allowTestPort);
        sinon.assert.notCalled(portTestStub);
        expect(mockDosState.portFailureScore ?? 0, 'counts nothing').to.equal(0);
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

        sinon.assert.calledOnceWithExactly(fluxNetworkHelper.allowTestPort, mockDosState.testingPort);
        sinon.assert.calledWith(fluxNetworkHelper.deleteTestPortRule, mockDosState.testingPort);
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
