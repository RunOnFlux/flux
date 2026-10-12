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
    moved = sinon.stub().resolves();
    fluxNetworkHelper.setOnOwnAddressMoved(moved);
    fluxNetworkHelper.setLocalSocketAddress(null);
  });

  afterEach(async () => {
    sinon.restore();
    fluxNetworkHelper.setOnOwnAddressMoved(null);
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

    await fluxNetworkHelper.handleOwnAddress('198.51.100.44:16137');

    sinon.assert.calledOnceWithExactly(moved, '198.51.100.4:16137', '198.51.100.44:16137');
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
      sinon.stub(serviceHelper, 'axiosGet').rejects(new Error('unreachable'));
      sinon.stub(serviceHelper, 'delay').resolves();
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

    it('takes a listing at its own configured IP that nothing answers as its move, and adopts the new address', async () => {
      configure('198.51.100.9');
      collateralListedAt('198.51.100.9:16127', '198.51.100.9:16157');

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      sinon.assert.calledOnceWithExactly(moved, '198.51.100.9:16127', '198.51.100.9:16157');
      expect(await record()).to.deep.equal({ socketAddress: '198.51.100.9:16157', movedFrom: '198.51.100.9:16127' });
    });
  });
});
