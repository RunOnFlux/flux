const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const config = require('config');
const availabilityChecker = require('../../ZelBack/src/services/appMonitoring/availabilityChecker');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const generalService = require('../../ZelBack/src/services/generalService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const upnpService = require('../../ZelBack/src/services/upnpService');
const networkStateService = require('../../ZelBack/src/services/networkStateService');

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
      dosMountMessage: null,
      dosDuplicateAppMessage: null,
      dosStateValue: 0,
      testingPort: null,
      nextTestingPort: null,
      originalPortFailed: null,
      lastUPNPMapFailed: false,
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
    it('should delay and retry if DOS mount message present', async () => {
      mockDosState.dosMountMessage = 'Mount error detected';

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      expect(mockDosState.dosMessage).to.equal('Mount error detected');
      expect(mockDosState.dosStateValue).to.equal(100);
      sinon.assert.calledOnce(delayStub);
      sinon.assert.calledWith(delayStub, 240_000);
    });

    it('should delay and retry if DOS duplicate app message present', async () => {
      mockDosState.dosDuplicateAppMessage = 'Duplicate app detected';

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      expect(mockDosState.dosMessage).to.equal('Duplicate app detected');
      expect(mockDosState.dosStateValue).to.equal(100);
    });

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves(null);

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves(null);

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves(null);

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves(null);

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(true);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(upnpService, 'isUPNP').returns(true);
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUPNPBanned').returns(true);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.called(delayStub);
    });

    it('should skip user blocked ports', async () => {
      const apps = [];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(true);

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves(null);

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves('192.168.1.200:16127');

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      sinon.assert.calledWith(delayStub, 15_000);
    });

    it('should handle UPNP mapping failures', async () => {
      const apps = [];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(upnpService, 'isUPNP').returns(true);
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves('192.168.1.200:16127');
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);
      sinon.stub(fluxNetworkHelper, 'allowPort').resolves();
      sinon.stub(upnpService, 'mapUpnpPort').resolves(false); // Failed
      sinon.stub(fluxNetworkHelper, 'deleteAllowPortRule').resolves();
      sinon.stub(upnpService, 'removeMapUpnpPort').resolves();

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      expect(mockDosState.lastUPNPMapFailed).to.be.true;
    });

    it('should increase DOS state on repeated UPNP failures', async () => {
      const apps = [];
      mockDosState.lastUPNPMapFailed = true; // Already failed once

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        data: { synced: true },
      });
      sinon.stub(generalService, 'isNodeStatusConfirmed').resolves(true);
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(upnpService, 'isUPNP').returns(true);
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves('192.168.1.200:16127');
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);
      sinon.stub(fluxNetworkHelper, 'allowPort').resolves();
      sinon.stub(upnpService, 'mapUpnpPort').resolves(false);
      sinon.stub(fluxNetworkHelper, 'deleteAllowPortRule').resolves();
      sinon.stub(upnpService, 'removeMapUpnpPort').resolves();

      await availabilityChecker.checkMyAppsAvailability(
        mockInstalledAppsFn,
        mockDosState,
        mockPortsNotWorking,
        mockFailedNodesCache,
        isArcane,
      );

      expect(mockDosState.dosStateValue).to.equal(4);
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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves(null);

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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').resolves('192.168.1.100:16127');
      mockInstalledAppsFn.resolves({ status: 'success', data: apps });
      sinon.stub(fluxNetworkHelper, 'isPortBanned').returns(false);
      sinon.stub(fluxNetworkHelper, 'isPortUserBlocked').returns(false);
      sinon.stub(networkStateService, 'getRandomSocketAddress').resolves(null);

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
});
