const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const fs = require('fs').promises;
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const daemonServiceFluxnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceFluxnodeRpcs');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const geolocationService = require('../../ZelBack/src/services/geolocationService');
const appQueryService = require('../../ZelBack/src/services/appQuery/appQueryService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const { peerManager } = require('../../ZelBack/src/services/utils/peerState');
const { requireMongo } = require('./dbTestHelper');

const OWN = '129.3.3.3:16127';
const COLLATERAL = 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)';
const BENCH_PUBLIC_IP = 'Error getting publicIp from FluxBench';
const IP_DETECTION_FAILED = 'Flux IP detection failed';

const listing = (ip, collateral = COLLATERAL) => ({
  collateral, ip, confirmed_height: 1076535, pubkey: '04ab',
});

const reachable = { data: { status: 'success', data: { message: 'Asking Flux is available' } } };
const unreachable = { data: { status: 'error', data: { message: 'Asking Flux is not available' } } };

describe('fluxNetworkHelper own standing tests', () => {
  before(requireMongo);

  let clock;
  let axiosGet;

  // every condition the availability question needs, met; each case unsets one
  const answerable = () => {
    fluxNetworkHelper.setSyncthingListenerKnown(true);
    fluxNetworkHelper.setLocalSocketAddress(OWN);
    networkStateService.isReady.returns(true);
    daemonServiceFluxnodeRpcs.getFluxNodeStatus.resolves({ status: 'success', data: { status: 'CONFIRMED', collateral: COLLATERAL } });
    fluxCommunicationUtils.socketAddressInFluxList.resolves(true);
    fluxCommunicationUtils.getNodeCount.resolves(50);
  };
  const availabilityAsks = () => axiosGet.getCalls()
    .filter((call) => String(call.args[0]).includes('/flux/checkfluxavailability')).length;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fluxNetworkHelper.setStoredFluxBenchAllowed('6.2.0');
    fluxNetworkHelper.setIpChangeHold(null);
    fluxNetworkHelper.setDosMessage(null);
    fluxNetworkHelper.setDosStateValue(0);
    fluxNetworkHelper.resetAvailabilityDos();
    fluxNetworkHelper.setSyncthingListenerKnown(false);
    sinon.stub(geolocationService, 'setNodeGeolocation');
    sinon.stub(networkStateService, 'isReady').returns(false);
    sinon.stub(networkStateService, 'getRandomExternalObserver').resolves('1.2.3.4:16127');
    sinon.stub(daemonServiceFluxnodeRpcs, 'getFluxNodeStatus').resolves({ status: 'error' });
    sinon.stub(daemonServiceFluxnodeRpcs, 'createConfirmationTransaction').resolves({ status: 'success' });
    sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true } });
    sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(false);
    sinon.stub(fluxCommunicationUtils, 'getNodeCount').resolves(0);
    sinon.stub(fluxCommunicationUtils, 'deterministicFluxList').resolves([listing(OWN)]);
    sinon.stub(fluxCommunicationUtils, 'getFluxnodeFromFluxList').resolves(listing(OWN));
    sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { ipaddress: OWN } });
    sinon.stub(benchmarkService, 'getPublicIp').resolves({ status: 'error' });
    sinon.stub(serviceHelper, 'delay').resolves();
    axiosGet = sinon.stub(serviceHelper, 'axiosGet').resolves(reachable);
  });

  afterEach(() => {
    sinon.restore();
    fluxNetworkHelper.stopOwnStandingWatch();
    fluxNetworkHelper.setSyncthingListenerKnown(false);
    fluxNetworkHelper.setDosMessage(null);
    fluxNetworkHelper.setDosStateValue(0);
    fluxNetworkHelper.resetAvailabilityDos();
  });

  describe('when the availability question is asked', () => {
    it('asks once everything it needs holds', async () => {
      answerable();

      await fluxNetworkHelper.requestAvailabilityCheck();

      expect(availabilityAsks()).to.equal(1);
    });

    it('does not ask before what syncthing\'s listener is, which the asked node tests, is known', async () => {
      answerable();
      fluxNetworkHelper.setSyncthingListenerKnown(false);

      await fluxNetworkHelper.requestAvailabilityCheck();

      expect(availabilityAsks()).to.equal(0);
      expect(fluxNetworkHelper.getDosMessage()).to.equal(null);
    });

    it('does not ask while this node is not confirmed', async () => {
      answerable();
      daemonServiceFluxnodeRpcs.getFluxNodeStatus.resolves({ status: 'success', data: { status: 'EXPIRED', collateral: COLLATERAL } });

      await fluxNetworkHelper.requestAvailabilityCheck();

      expect(availabilityAsks()).to.equal(0);
    });

    it('does not ask while the list does not hold this node at its current address, which the asked node refuses', async () => {
      answerable();
      fluxCommunicationUtils.socketAddressInFluxList.resolves(false);

      await fluxNetworkHelper.requestAvailabilityCheck();

      expect(availabilityAsks()).to.equal(0);
    });

    it('does not ask before the node list is known', async () => {
      answerable();
      networkStateService.isReady.returns(false);

      await fluxNetworkHelper.requestAvailabilityCheck();

      expect(availabilityAsks()).to.equal(0);
    });

    it('asks first when syncthing\'s listener becomes known, as soon as the rest already holds', async () => {
      answerable();
      fluxNetworkHelper.setSyncthingListenerKnown(false);

      fluxNetworkHelper.noteSyncthingListenerKnown();
      await clock.tickAsync(0);

      expect(availabilityAsks()).to.equal(1);
    });
  });

  describe('the availability schedule', () => {
    it('asks again after the check interval when this node was reachable, and not before', async () => {
      answerable();
      await fluxNetworkHelper.requestAvailabilityCheck();

      await clock.tickAsync(config.fluxapps.availabilityCheckIntervalMs - 1);
      expect(availabilityAsks()).to.equal(1);
      await clock.tickAsync(1);
      expect(availabilityAsks()).to.equal(2);
    });

    it('asks again after the recheck delay when it was not reachable', async () => {
      answerable();
      axiosGet.resolves(unreachable);
      await fluxNetworkHelper.requestAvailabilityCheck();
      const asked = availabilityAsks();

      await clock.tickAsync(config.fluxapps.availabilityRecheckMs - 1);
      expect(availabilityAsks()).to.equal(asked);
      await clock.tickAsync(1);
      expect(availabilityAsks()).to.be.greaterThan(asked);
    });

    it('asks on the next node list refresh once a scheduled ask could not be answered, and is on its schedule again', async () => {
      let listUpdated;
      sinon.stub(networkStateService, 'onUpdated').callsFake((listener) => {
        listUpdated = listener;
        return () => {};
      });
      answerable();
      fluxNetworkHelper.startOwnStandingWatch();
      await clock.tickAsync(0);
      await fluxNetworkHelper.requestAvailabilityCheck();
      const asked = availabilityAsks();

      daemonServiceFluxnodeRpcs.getFluxNodeStatus.resolves({ status: 'error' });
      await clock.tickAsync(config.fluxapps.availabilityCheckIntervalMs);
      await clock.tickAsync(config.fluxapps.availabilityCheckIntervalMs);
      expect(availabilityAsks(), 'asked while the question could not be answered').to.equal(asked);

      answerable();
      await listUpdated();
      expect(availabilityAsks(), 'the list refresh did not ask').to.equal(asked + 1);
      await clock.tickAsync(config.fluxapps.availabilityCheckIntervalMs);
      expect(availabilityAsks(), 'the schedule did not resume').to.equal(asked + 2);
    });
  });

  describe('the DOS the availability check owns', () => {
    beforeEach(() => {
      answerable();
      // past minUpTime, so a reachable node with too few peers counts it
      sinon.stub(process, 'uptime').returns(config.fluxapps.minUpTime + 1);
    });

    const dos = () => fluxNetworkHelper.getDOSState().data;
    // a pass in which no asked peer can reach this node: its own DOS
    const unreachableEverywhere = async () => {
      axiosGet.resolves(unreachable);
      expect(await fluxNetworkHelper.checkMyFluxAvailability()).to.equal(false);
      axiosGet.resolves(reachable);
    };
    // connected to as many peers, from as many addresses, as config asks
    const enoughPeers = () => {
      const peers = (count) => Array.from({ length: count }, (_, i) => ({ ip: `198.51.100.${i + 1}` }));
      sinon.stub(peerManager, 'outboundCount').get(() => config.fluxapps.minOutgoing);
      sinon.stub(peerManager, 'inboundCount').get(() => config.fluxapps.minIncoming);
      sinon.stub(peerManager, 'outboundValues').callsFake(() => peers(config.fluxapps.minUniqueIpsOutgoing).values());
      sinon.stub(peerManager, 'inboundValues').callsFake(() => peers(config.fluxapps.minUniqueIpsIncoming).values());
    };
    const minutesLater = (minutes) => sinon.stub(process.hrtime, 'bigint')
      .returns(process.hrtime.bigint.wrappedMethod() + BigInt(minutes) * 60000n * 1000000n);

    it('clears its own "not reachable" once reachable, though this node has too few peers', async () => {
      await unreachableEverywhere();
      expect(dos().dosMessage, 'fixture: its own DOS').to.equal(BENCH_PUBLIC_IP);

      expect(await fluxNetworkHelper.checkMyFluxAvailability()).to.equal(true);

      expect(dos().dosMessage).to.equal(null);
      expect(dos().dosState).to.be.closeTo(0.13, 0.001);
    });

    it('ends its own DOS once reachable with enough peers', async () => {
      await unreachableEverywhere();
      enoughPeers();

      expect(await fluxNetworkHelper.checkMyFluxAvailability()).to.equal(true);

      expect(dos()).to.deep.equal({ dosState: 0, dosMessage: null });
    });

    it('is not out of service for asks that timed out before one reached it, while it has too few peers', async () => {
      [0, 1, 2, 3, 4].forEach((call) => axiosGet.onCall(call).rejects(new Error('timeout of 7000ms exceeded')));

      expect(await fluxNetworkHelper.checkMyFluxAvailability()).to.equal(true);

      expect(axiosGet.callCount, 'fixture: five asks timed out, the sixth reached it').to.equal(6);
      expect(dos().dosMessage).to.equal(null);
      expect(dos().dosState).to.be.closeTo(0.13, 0.001);
    });

    it('ends its DOS for too few peers on its next pass once it has enough', async () => {
      await fluxNetworkHelper.checkMyFluxAvailability();
      minutesLater(80);
      expect(await fluxNetworkHelper.checkMyFluxAvailability()).to.equal(false);
      expect(dos().dosMessage, 'fixture: out of service for too few peers').to.match(/^Not enough outgoing connections/);
      enoughPeers();

      expect(await fluxNetworkHelper.checkMyFluxAvailability()).to.equal(true);

      expect(dos()).to.deep.equal({ dosState: 0, dosMessage: null });
    });

    it('ends its DOS for too few peers as soon as the peer that makes enough connects', async () => {
      fluxNetworkHelper.startOwnStandingWatch();
      await fluxNetworkHelper.checkMyFluxAvailability();
      minutesLater(80);
      await fluxNetworkHelper.checkMyFluxAvailability();
      expect(dos().dosMessage, 'fixture: out of service for too few peers').to.match(/^Not enough outgoing connections/);

      peerManager.emit('peerConnected', '198.51.100.9:16127', 1);
      expect(dos().dosMessage, 'a peer that does not make enough ends nothing').to.match(/^Not enough outgoing connections/);
      enoughPeers();
      peerManager.emit('peerConnected', '198.51.100.10:16127', 2);

      expect(dos()).to.deep.equal({ dosState: 0, dosMessage: null });
    });

    it('counts an ask that fails after it was reached', async () => {
      enoughPeers();
      await fluxNetworkHelper.checkMyFluxAvailability();
      axiosGet.onCall(1).rejects(new Error('timeout of 7000ms exceeded'));

      await fluxNetworkHelper.checkMyFluxAvailability();

      expect(axiosGet.callCount, 'fixture: one ask failed, the next reached it').to.equal(3);
      expect(dos().dosState).to.equal(0);
      axiosGet.resolves(unreachable);
      await fluxNetworkHelper.checkMyFluxAvailability(6);
      expect(dos().dosState, 'two asks that found it unreachable').to.equal(4);
    });

    it('holds the node out of service while its record holds an IP change hold, then ends that DOS once the chain passes it', async () => {
      const IP_CHANGES = 'IP changes over the limit allowed, one in 20 hours';
      await dbHelper.initiateDB();
      const records = dbHelper.databaseConnection().db(config.database.local.database).collection(config.database.local.collections.ownAddress);
      await records.deleteMany({});
      await records.insertOne({ _id: 'own', socketAddress: OWN, movedFrom: null, ipChangeHold: { fromHeight: 1000 } });
      const height = sinon.stub(daemonServiceMiscRpcs, 'getCurrentDaemonHeight').returns(3399);
      try {
        await fluxNetworkHelper.enforceIpChangeHold();
        expect(await fluxNetworkHelper.checkMyFluxAvailability()).to.equal(false);
        expect(fluxNetworkHelper.getDosMessage()).to.equal(IP_CHANGES);

        // as the hold's watch does at each new height
        height.returns(3400);
        await fluxNetworkHelper.enforceIpChangeHold();
        expect(await fluxNetworkHelper.checkMyFluxAvailability()).to.equal(true);
        expect(fluxNetworkHelper.getDosMessage()).to.equal(null);
      } finally {
        fluxNetworkHelper.clearStickyDos(fluxNetworkHelper.StickyDosOwner.IP_CHANGES);
        await records.deleteMany({});
      }
    });

    it('ends no DOS of another check\'s once reachable', async () => {
      fluxNetworkHelper.setDosMessage('Ports tested not reachable from outside');
      fluxNetworkHelper.setDosStateValue(100);
      fluxCommunicationUtils.getNodeCount.resolves(1);

      expect(await fluxNetworkHelper.checkMyFluxAvailability()).to.equal(true);

      expect(dos()).to.deep.equal({ dosState: 100, dosMessage: 'Ports tested not reachable from outside' });
    });

    it('leaves another check\'s DOS standing, with the score that check counted', async () => {
      fluxNetworkHelper.setDosMessage(IP_DETECTION_FAILED);
      fluxNetworkHelper.setDosStateValue(11);
      await unreachableEverywhere();
      expect(dos().dosMessage, 'fixture: the message standing is the other check\'s').to.equal(BENCH_PUBLIC_IP);
      fluxNetworkHelper.setDosMessage(IP_DETECTION_FAILED);
      enoughPeers();

      await fluxNetworkHelper.checkMyFluxAvailability();

      expect(dos()).to.deep.equal({ dosState: 11, dosMessage: IP_DETECTION_FAILED });
    });

    it('keeps what it counted when another check resets the score it shares', async () => {
      await unreachableEverywhere();
      const counted = dos().dosState;

      fluxNetworkHelper.setDosStateValue(0);

      expect(dos().dosState).to.equal(counted);
    });

    it('counts too few peers by the minute, however far apart the checks are', async () => {
      await fluxNetworkHelper.checkMyFluxAvailability();
      const afterFirst = dos().dosState;
      minutesLater(5);

      await fluxNetworkHelper.checkMyFluxAvailability();

      expect(afterFirst).to.be.closeTo(0.13, 0.001);
      expect(dos().dosState - afterFirst).to.be.closeTo(0.65, 0.01);
    });
  });

  describe('a node that knows no address of its own', () => {
    let stopWatch;

    beforeEach(async () => {
      benchmarkService.getBenchmarks.resolves({ status: 'success', data: { ipaddress: '' } });
      fluxNetworkHelper.setLocalSocketAddress(null);
      stopWatch = fluxNetworkHelper.startOwnStandingWatch();
      await clock.tickAsync(0);
    });

    afterEach(() => {
      stopWatch();
    });

    it('asks benchmark for its public IP every ask interval', async () => {
      expect(benchmarkService.getPublicIp.callCount).to.equal(0);
      await clock.tickAsync(config.fluxapps.publicIpAskIntervalMs);
      expect(benchmarkService.getPublicIp.callCount).to.equal(1);
      await clock.tickAsync(config.fluxapps.publicIpAskIntervalMs);
      expect(benchmarkService.getPublicIp.callCount).to.equal(2);
    });

    it('is out of service once the configured number of asks found none, and not one ask sooner', async () => {
      await clock.tickAsync(config.fluxapps.publicIpAskIntervalMs * (config.fluxapps.publicIpAsksBeforeDos - 1));
      expect(fluxNetworkHelper.getDosMessage()).to.equal(null);

      await clock.tickAsync(config.fluxapps.publicIpAskIntervalMs);
      expect(fluxNetworkHelper.getDosMessage()).to.equal(IP_DETECTION_FAILED);
      expect(fluxNetworkHelper.getDosStateValue()).to.be.above(10);
    });

    it('stops asking, and ends that DOS, when an address arrives', async () => {
      await clock.tickAsync(config.fluxapps.publicIpAskIntervalMs * config.fluxapps.publicIpAsksBeforeDos);
      expect(fluxNetworkHelper.getDosMessage()).to.equal(IP_DETECTION_FAILED);

      benchmarkService.getBenchmarks.resolves({ status: 'success', data: { ipaddress: OWN } });
      await clock.tickAsync(config.fluxapps.publicIpAskIntervalMs);
      const asks = benchmarkService.getPublicIp.callCount;
      await clock.tickAsync(config.fluxapps.publicIpAskIntervalMs * 3);

      expect(fluxNetworkHelper.getDosMessage()).to.equal(null);
      expect(benchmarkService.getPublicIp.callCount).to.equal(asks);
    });
  });

  describe('what runs the collision check', () => {
    let listUpdated;
    let stopWatch;

    beforeEach(async () => {
      sinon.stub(networkStateService, 'onUpdated').callsFake((listener) => {
        listUpdated = listener;
        return () => {};
      });
      networkStateService.isReady.returns(true);
      daemonServiceFluxnodeRpcs.getFluxNodeStatus.resolves({ status: 'success', data: { status: 'CONFIRMED', collateral: COLLATERAL } });
      fluxNetworkHelper.setLocalSocketAddress(OWN);
      stopWatch = fluxNetworkHelper.startOwnStandingWatch();
      await clock.tickAsync(0);
      fluxCommunicationUtils.deterministicFluxList.resetHistory();
    });

    // A pass can outlive its test on a real database read, and the next test's
    // list refresh would join that pass rather than run its own.
    afterEach(async () => {
      await fluxNetworkHelper.requestCollisionCheck();
      stopWatch();
    });

    it('runs on each node list refresh', async () => {
      await listUpdated();
      expect(fluxCommunicationUtils.deterministicFluxList.callCount).to.equal(1);

      await listUpdated();
      expect(fluxCommunicationUtils.deterministicFluxList.callCount).to.equal(2);
    });

    it('runs on a change of this node\'s own address', async () => {
      // The cached address is what benchmark reports, so a node that moved is
      // one benchmark reports at the new address.
      benchmarkService.getBenchmarks.resolves({ status: 'success', data: { ipaddress: '129.3.3.4:16127' } });
      fluxNetworkHelper.setLocalSocketAddress('129.3.3.4:16127');
      await clock.tickAsync(0);

      expect(fluxCommunicationUtils.deterministicFluxList.callCount).to.equal(1);
    });

    it('runs nowhere else: a pass leaves nothing scheduled to run it again', async () => {
      await listUpdated();
      const passes = fluxCommunicationUtils.deterministicFluxList.callCount;
      expect(passes).to.equal(1);

      await clock.tickAsync(10 * 60 * 1000);

      expect(fluxCommunicationUtils.deterministicFluxList.callCount).to.equal(passes);
    });
  });

  describe('a collision pass and this node\'s own move', () => {
    let records;
    let moved;
    let originalUserConfig;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      records = dbHelper.databaseConnection().db(config.database.local.database).collection(config.database.local.collections.ownAddress);
      await records.deleteMany({});
      originalUserConfig = globalThis.userconfig;
      globalThis.userconfig = { initial: { ipaddress: '129.3.3.3', apiport: 16157, zelid: '', kadena: '' } };
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(appQueryService, 'installedApps').resolves({ status: 'success', data: [] });
      moved = sinon.stub().resolves();
      fluxNetworkHelper.setOnOwnAddressMoved(moved);
      clock.restore();
    });

    afterEach(async () => {
      fluxNetworkHelper.setOnOwnAddressMoved(null);
      globalThis.userconfig = originalUserConfig;
      await records.deleteMany({});
    });

    it('judges the list only after the move this node is recording, so it handles the move once', async () => {
      await records.insertOne({ _id: 'own', socketAddress: '129.3.3.3:16127', movedFrom: null });
      networkStateService.isReady.returns(true);
      benchmarkService.getBenchmarks.resolves({ status: 'success', data: { ipaddress: '129.3.3.3:16157' } });
      fluxCommunicationUtils.deterministicFluxList.resolves([listing('129.3.3.3:16127')]);
      daemonServiceFluxnodeRpcs.getFluxNodeStatus.resolves({ status: 'success', data: { status: 'CONFIRMED', collateral: COLLATERAL } });
      axiosGet.rejects(new Error('connect ECONNREFUSED'));

      const recording = fluxNetworkHelper.handleOwnAddress('129.3.3.3:16157');
      await fluxNetworkHelper.requestCollisionCheck();
      await recording;

      sinon.assert.calledOnceWithExactly(moved, '129.3.3.3:16127', '129.3.3.3:16157', sinon.match.number);
    });
  });
});
