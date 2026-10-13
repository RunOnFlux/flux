const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const config = require('config');
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
const { requireMongo } = require('./dbTestHelper');

describe('fluxNetworkHelper own address tests', () => {
  before(requireMongo);

  let records;
  let moved;
  let restarted;
  let listedHere;
  let originalUserConfig;

  const configure = (ipaddress) => {
    globalThis.userconfig = { initial: { ipaddress, apiport: 16127, zelid: '', kadena: '' } };
  };
  const adopt = (socketAddress, movedFrom = null) => records.insertOne({ _id: 'own', socketAddress, movedFrom });
  const record = () => records.findOne({ _id: 'own' }, { projection: { _id: 0, socketAddress: 1, movedFrom: 1 } });

  beforeEach(async () => {
    await dbHelper.initiateDB();
    records = dbHelper.databaseConnection().db(config.database.local.database).collection(config.database.local.collections.ownAddress);
    await records.deleteMany({});
    originalUserConfig = globalThis.userconfig;
    sinon.stub(fs, 'writeFile').resolves();
    sinon.stub(daemonServiceFluxnodeRpcs, 'createConfirmationTransaction').resolves({ status: 'success' });
    sinon.stub(daemonServiceFluxnodeRpcs, 'getFluxNodeStatus').resolves({ status: 'error' });
    sinon.stub(geolocationService, 'setNodeGeolocation');
    sinon.stub(appQueryService, 'installedApps').resolves({ status: 'success', data: [] });
    sinon.stub(serviceHelper, 'axiosGet').rejects(new Error('unreachable'));
    sinon.stub(serviceHelper, 'delay').resolves();
    moved = sinon.stub().resolves();
    fluxNetworkHelper.setOnOwnAddressMoved(moved);
    restarted = sinon.stub().resolves();
    fluxNetworkHelper.setOnAddressChanged(restarted);
    // the installed apps the network lists at an address: none unless a case says
    listedHere = sinon.stub().resolves([]);
    fluxNetworkHelper.setInstalledAppsListedAt(listedHere);
    fluxNetworkHelper.setLocalSocketAddress(null);
  });

  afterEach(async () => {
    sinon.restore();
    fluxNetworkHelper.setOnOwnAddressMoved(null);
    fluxNetworkHelper.setOnAddressChanged(null);
    fluxNetworkHelper.setInstalledAppsListedAt(null);
    globalThis.userconfig = originalUserConfig;
    await records.deleteMany({});
  });

  it('adopts the reported address when it holds none and the configured IP is the reported one', async () => {
    configure('198.51.100.1');

    await fluxNetworkHelper.handleOwnAddress('198.51.100.1:16127');

    sinon.assert.notCalled(moved);
    expect(await record()).to.deep.equal({ socketAddress: '198.51.100.1:16127', movedFrom: null });
  });

  it('takes a port moved away from the adopted address as a move, and keeps the apps where they are', async () => {
    configure('198.51.100.2');
    await adopt('198.51.100.2:16127');

    await fluxNetworkHelper.handleOwnAddress('198.51.100.2:16157');

    sinon.assert.calledOnceWithExactly(moved, '198.51.100.2:16127', '198.51.100.2:16157');
    sinon.assert.notCalled(serviceHelper.axiosGet);
    sinon.assert.calledOnce(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
    sinon.assert.notCalled(fs.writeFile);
    sinon.assert.notCalled(appQueryService.installedApps);
    sinon.assert.notCalled(geolocationService.setNodeGeolocation);
    expect(await record()).to.deep.equal({ socketAddress: '198.51.100.2:16157', movedFrom: '198.51.100.2:16127' });
  });

  it('takes an IP moved away from the adopted address as a move whatever the chain already lists', async () => {
    configure('198.51.100.3');
    await adopt('198.51.100.3:16127');
    daemonServiceFluxnodeRpcs.getFluxNodeStatus.resolves({ status: 'success', data: { ip: '198.51.100.33:16127' } });

    await fluxNetworkHelper.handleOwnAddress('198.51.100.33:16127');

    sinon.assert.calledOnceWithExactly(moved, '198.51.100.3:16127', '198.51.100.33:16127');
    sinon.assert.calledWithMatch(fs.writeFile, sinon.match.string, sinon.match(/ipaddress: '198.51.100.33',/));
    sinon.assert.calledOnce(geolocationService.setNodeGeolocation);
    expect(await record()).to.deep.equal({ socketAddress: '198.51.100.33:16127', movedFrom: '198.51.100.3:16127' });
  });

  it('holding no address, takes the configured IP at the port the network lists it at as the address it left', async () => {
    configure('198.51.100.4');
    daemonServiceFluxnodeRpcs.getFluxNodeStatus.resolves({ status: 'success', data: { ip: '198.51.100.4:16137' } });
    listedHere.withArgs('198.51.100.4:16137').resolves(['ranthere']);

    await fluxNetworkHelper.handleOwnAddress('198.51.100.44:16137');

    sinon.assert.calledOnceWithExactly(moved, '198.51.100.4:16137', '198.51.100.44:16137');
    sinon.assert.calledTwice(serviceHelper.axiosGet.withArgs('http://198.51.100.4:16137/flux/version'));
  });

  describe('holding no address, with nothing answering at the configured one', () => {
    it('tells the network it moved when it ran apps there, and confirms the new address', async () => {
      configure('198.51.100.15');
      listedHere.withArgs('198.51.100.15:16127').resolves(['ranthere']);

      await fluxNetworkHelper.handleOwnAddress('198.51.100.16:16127');

      sinon.assert.calledOnceWithExactly(moved, '198.51.100.15:16127', '198.51.100.16:16127');
      sinon.assert.calledOnce(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
      sinon.assert.calledWithMatch(fs.writeFile, sinon.match.string, sinon.match(/ipaddress: '198.51.100.16',/));
      expect(await record()).to.deep.equal({ socketAddress: '198.51.100.16:16127', movedFrom: '198.51.100.15:16127' });
    });

    it('adopts the new address without a move when it ran no apps there', async () => {
      configure('198.51.100.17');

      await fluxNetworkHelper.handleOwnAddress('198.51.100.18:16127');

      sinon.assert.notCalled(moved);
      sinon.assert.calledOnce(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
      sinon.assert.calledWithMatch(fs.writeFile, sinon.match.string, sinon.match(/ipaddress: '198.51.100.18',/));
      sinon.assert.calledOnce(geolocationService.setNodeGeolocation);
      expect(await record()).to.deep.equal({ socketAddress: '198.51.100.18:16127', movedFrom: '198.51.100.17:16127' });
    });

    it('restarts its installed apps on the new address, without a move, when the network lists none of them there', async () => {
      configure('198.51.100.19');
      appQueryService.installedApps.resolves({ status: 'success', data: [{ name: 'expiredrows', version: 4 }] });

      await fluxNetworkHelper.handleOwnAddress('198.51.100.20:16127');

      sinon.assert.notCalled(moved);
      sinon.assert.calledOnce(restarted);
      expect(restarted.firstCall.args[0].map((app) => app.name)).to.deep.equal(['expiredrows']);
    });

    it('adopts the new address without a move when nothing reports what it ran', async () => {
      configure('198.51.100.21');
      fluxNetworkHelper.setInstalledAppsListedAt(null);

      await fluxNetworkHelper.handleOwnAddress('198.51.100.22:16127');

      sinon.assert.notCalled(moved);
      sinon.assert.calledOnce(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
    });
  });

  it('tells the network it moved from an address it recorded, whatever the network lists there', async () => {
    configure('198.51.100.23');
    await adopt('198.51.100.23:16127');

    await fluxNetworkHelper.handleOwnAddress('198.51.100.24:16127');

    sinon.assert.notCalled(listedHere);
    sinon.assert.calledOnceWithExactly(moved, '198.51.100.23:16127', '198.51.100.24:16127');
  });

  it('holding no address, adopts the reported one without a move while a Flux node answers at the configured address', async () => {
    configure('198.51.100.11');
    serviceHelper.axiosGet.withArgs('http://198.51.100.11:16127/flux/version').resolves({ data: { status: 'success' } });

    await fluxNetworkHelper.handleOwnAddress('198.51.100.12:16127');

    sinon.assert.notCalled(moved);
    sinon.assert.notCalled(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
    sinon.assert.notCalled(fs.writeFile);
    expect(await record()).to.deep.equal({ socketAddress: '198.51.100.12:16127', movedFrom: null });
  });

  it('holding no address, makes no move when the node at the configured address answers once the restart grace has passed', async () => {
    configure('198.51.100.13');
    serviceHelper.axiosGet.withArgs('http://198.51.100.13:16127/flux/version')
      .onFirstCall().rejects(new Error('restarting'))
      .onSecondCall().resolves({ data: { status: 'success' } });

    await fluxNetworkHelper.handleOwnAddress('198.51.100.14:16127');

    sinon.assert.calledOnce(serviceHelper.delay);
    sinon.assert.notCalled(moved);
    sinon.assert.notCalled(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
  });

  it('does nothing for the address it already holds', async () => {
    configure('198.51.100.5');
    await adopt('198.51.100.5:16127');

    await fluxNetworkHelper.handleOwnAddress('198.51.100.5:16127');

    sinon.assert.notCalled(moved);
    sinon.assert.notCalled(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
  });

  it('handles changes one at a time, so the same move is made once', async () => {
    configure('198.51.100.6');
    await adopt('198.51.100.6:16127');

    await Promise.all([
      fluxNetworkHelper.handleOwnAddress('198.51.100.6:16157'),
      fluxNetworkHelper.handleOwnAddress('198.51.100.6:16157'),
    ]);

    sinon.assert.calledOnce(moved);
  });

  it('handles the address it already knows when the watch starts', async () => {
    configure('198.51.100.7');
    await adopt('198.51.100.7:16127');
    fluxNetworkHelper.setLocalSocketAddress('198.51.100.7:16157');

    const stop = fluxNetworkHelper.startOwnAddressWatch();
    expect(fluxNetworkHelper.startOwnAddressWatch(), 'a second start returns the same watch').to.be.a('function');
    await fluxNetworkHelper.handleOwnAddress('198.51.100.7:16157');
    stop();
    fluxNetworkHelper.setLocalSocketAddress(null);

    sinon.assert.calledOnceWithExactly(moved, '198.51.100.7:16127', '198.51.100.7:16157');
  });

  it('acts on each change of the address once the watch has started, and on none once it has stopped', async () => {
    configure('198.51.100.10');
    await adopt('198.51.100.10:16127');
    fluxNetworkHelper.setLocalSocketAddress('198.51.100.10:16127');

    const stop = fluxNetworkHelper.startOwnAddressWatch();
    fluxNetworkHelper.setLocalSocketAddress('198.51.100.10:16157');
    await fluxNetworkHelper.handleOwnAddress('198.51.100.10:16157');
    stop();
    fluxNetworkHelper.setLocalSocketAddress('198.51.100.10:16167');
    await fluxNetworkHelper.handleOwnAddress('198.51.100.10:16157');
    fluxNetworkHelper.setLocalSocketAddress(null);

    sinon.assert.calledOnceWithExactly(moved, '198.51.100.10:16127', '198.51.100.10:16157');
  });

  describe('the collision check', () => {
    beforeEach(() => {
      sinon.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true } });
      sinon.stub(networkStateService, 'isReady').returns(true);
    });

    function collateralListedAt(listed, own) {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { ipaddress: own } });
      sinon.stub(fluxCommunicationUtils, 'deterministicFluxList').resolves([{ ip: listed, collateral: 'C' }]);
      daemonServiceFluxnodeRpcs.getFluxNodeStatus.resolves({ status: 'success', data: { status: 'CONFIRMED', collateral: 'C', ip: listed } });
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(false);
    }

    it('leaves a listing at the address this node recorded moving from to the move', async () => {
      configure('198.51.100.8');
      await adopt('198.51.100.8:16157', '198.51.100.8:16127');
      collateralListedAt('198.51.100.8:16127', '198.51.100.8:16157');

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      sinon.assert.notCalled(serviceHelper.axiosGet);
      sinon.assert.notCalled(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
    });

    it('takes a listing at its own configured IP that nothing answers, where it ran apps, as its move, and adopts the new address', async () => {
      configure('198.51.100.9');
      collateralListedAt('198.51.100.9:16127', '198.51.100.9:16157');
      listedHere.withArgs('198.51.100.9:16127').resolves(['ranthere']);

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      sinon.assert.calledOnceWithExactly(moved, '198.51.100.9:16127', '198.51.100.9:16157');
      expect(await record()).to.deep.equal({ socketAddress: '198.51.100.9:16157', movedFrom: '198.51.100.9:16127' });
    });

    it('adopts the new address without a move from a listing at its own configured IP that nothing answers, where it ran no apps', async () => {
      configure('198.51.100.25');
      collateralListedAt('198.51.100.25:16127', '198.51.100.26:16127');

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      sinon.assert.notCalled(moved);
      sinon.assert.calledOnce(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
      sinon.assert.calledWithMatch(fs.writeFile, sinon.match.string, sinon.match(/ipaddress: '198.51.100.26',/));
      expect(await record()).to.deep.equal({ socketAddress: '198.51.100.26:16127', movedFrom: '198.51.100.25:16127' });
    });

    it('takes over a listing at another machine\'s IP that nothing answers, with a confirmation and no move', async () => {
      configure('198.51.100.27');
      collateralListedAt('198.51.100.28:16127', '198.51.100.27:16127');
      listedHere.resolves(['ranthere']);

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      sinon.assert.notCalled(moved);
      sinon.assert.calledOnce(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
      sinon.assert.notCalled(fs.writeFile);
    });

    it('holds itself out of service while something answers at the address its collateral is listed at', async () => {
      configure('198.51.100.29');
      collateralListedAt('198.51.100.30:16127', '198.51.100.29:16127');
      serviceHelper.axiosGet.resolves({ data: { status: 'success' } });

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      sinon.assert.notCalled(moved);
      sinon.assert.notCalled(daemonServiceFluxnodeRpcs.createConfirmationTransaction);
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(100);
      fluxNetworkHelper.setDosMessage(null);
      fluxNetworkHelper.setDosStateValue(0);
    });
  });
});
