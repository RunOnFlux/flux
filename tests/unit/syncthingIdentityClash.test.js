const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('syncthingIdentityClash tests', () => {
  const PEER = '198.51.100.20:16127';
  const OWN_DEVICE = 'XKLMVJA-M56FRX2-LYRDLST-PQJVEHG-I5C7A3B-YQJPOFB-2ROTI3S-4FIH6AL';
  const PEER_DEVICE = 'OD2POVH-2QWEHYY-AKI6AU2-ZUEQLXY-MTGOIG7-PE57QHU-INYFY5C-QTNOPQ5';
  const LOW = 'a'.repeat(64);
  const HIGH = 'f'.repeat(64);
  let stubs;
  let clash;
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['hrtime'] });
    stubs = {
      log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      generalService: { obtainNodeCollateralInformation: sinon.stub().resolves({ txhash: HIGH, txindex: 0 }) },
      networkStateService: { getFluxnodeBySocketAddress: sinon.stub().resolves({ txhash: LOW, outidx: 0 }) },
      syncthingService: {
        ownsSyncthing: sinon.stub().returns(true),
        requestIdentityRegeneration: sinon.stub().returns(true),
      },
      fluxEventBus: { publish: sinon.stub() },
      syncthingDeviceId: { presentedDeviceId: sinon.stub().resolves(OWN_DEVICE) },
    };
    clash = proxyquire('../../ZelBack/src/services/syncthingIdentityClash', {
      '../lib/log': stubs.log,
      './generalService': stubs.generalService,
      './networkStateService': stubs.networkStateService,
      './syncthingService': stubs.syncthingService,
      './utils/fluxEventBus': stubs.fluxEventBus,
      './utils/syncthingDeviceId': stubs.syncthingDeviceId,
    });
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  it("tests the claim against the peer's syncthing, on its API port + 2", async () => {
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    sinon.assert.calledOnceWithExactly(stubs.syncthingDeviceId.presentedDeviceId, '198.51.100.20', 16129);
  });

  it('acts on nothing a peer only claims', async () => {
    stubs.syncthingDeviceId.presentedDeviceId.resolves(PEER_DEVICE);
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    stubs.syncthingDeviceId.presentedDeviceId.resolves(null);
    clock.tick(clash.PROOF_INTERVAL_MS);
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    sinon.assert.notCalled(stubs.syncthingService.requestIdentityRegeneration);
    sinon.assert.notCalled(stubs.fluxEventBus.publish);
  });

  it('replaces this identity at once when this node holds the higher collateral', async () => {
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    sinon.assert.calledWithMatch(stubs.fluxEventBus.publish, 'syncthing:identityClash', { peer: PEER, deviceId: OWN_DEVICE });
    sinon.assert.calledOnce(stubs.syncthingService.requestIdentityRegeneration);
  });

  describe('the lower holder', () => {
    beforeEach(() => {
      stubs.generalService.obtainNodeCollateralInformation.resolves({ txhash: LOW, txindex: 0 });
      stubs.networkStateService.getFluxnodeBySocketAddress.resolves({ txhash: HIGH, outidx: 0 });
    });

    it('leaves its identity alone while the higher holder may still act', async () => {
      await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
      for (let i = 0; i < 5; i += 1) {
        clock.tick(clash.PROOF_INTERVAL_MS);
        // eslint-disable-next-line no-await-in-loop
        await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
      }
      sinon.assert.notCalled(stubs.syncthingService.requestIdentityRegeneration);
    });

    it('replaces its identity once the clash is still proven an hour after it was first', async () => {
      await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
      clock.tick(clash.LOWER_HOLDER_WAIT_MS);
      await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
      sinon.assert.calledOnce(stubs.syncthingService.requestIdentityRegeneration);
    });

    it('starts the hour again after the higher holder was seen to act', async () => {
      await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
      clock.tick(clash.PROOF_INTERVAL_MS);
      stubs.syncthingDeviceId.presentedDeviceId.resolves(PEER_DEVICE);
      await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
      stubs.syncthingDeviceId.presentedDeviceId.resolves(OWN_DEVICE);
      clock.tick(clash.LOWER_HOLDER_WAIT_MS - clash.PROOF_INTERVAL_MS);
      await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
      sinon.assert.notCalled(stubs.syncthingService.requestIdentityRegeneration);
    });

    it('waits the same hour when the peer is not found in the node list', async () => {
      stubs.networkStateService.getFluxnodeBySocketAddress.resolves(null);
      await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
      sinon.assert.notCalled(stubs.syncthingService.requestIdentityRegeneration);
      clock.tick(clash.LOWER_HOLDER_WAIT_MS);
      await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
      sinon.assert.calledOnce(stubs.syncthingService.requestIdentityRegeneration);
    });
  });

  it('reports a proven clash and replaces nothing where FluxOS does not run syncthing', async () => {
    stubs.syncthingService.ownsSyncthing.returns(false);
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    sinon.assert.calledWithMatch(stubs.fluxEventBus.publish, 'syncthing:identityClash');
    sinon.assert.notCalled(stubs.syncthingService.requestIdentityRegeneration);
  });

  it('decides nothing while its own collateral cannot be read', async () => {
    stubs.generalService.obtainNodeCollateralInformation.rejects(new Error('daemon not ready'));
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    sinon.assert.notCalled(stubs.syncthingService.requestIdentityRegeneration);
  });

  it('tests a peer at most once in its interval', async () => {
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    clock.tick(clash.PROOF_INTERVAL_MS - 1);
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    sinon.assert.calledOnce(stubs.syncthingDeviceId.presentedDeviceId);
    clock.tick(1);
    await clash.noteClaimOfOwnDeviceId(PEER, OWN_DEVICE);
    sinon.assert.calledTwice(stubs.syncthingDeviceId.presentedDeviceId);
  });
});
