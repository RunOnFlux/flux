const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('lostVolumeRecovery tests', () => {
  const PeerComponent = Object.freeze({ RUNNING: 'running', NOT_RUNNING: 'notRunning', UNKNOWN: 'unknown' });
  let stubs;
  let recovery;
  let clock;
  const synced = (overrides = {}) => ({
    identifier: 'db_App', appName: 'App', version: 8, synced: true, reason: 'volume_file_missing', ...overrides,
  });

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['hrtime'] });
    stubs = {
      log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      dockerService: { getAppIdentifier: (id) => `flux${id}` },
      fluxNetworkHelper: { getLocalSocketAddress: sinon.stub().resolves('10.0.0.9:16127') },
      registryManager: {
        appLocation: sinon.stub().resolves([]),
        getApplicationSpecifications: sinon.stub().resolves({ name: 'App', version: 3 }),
      },
      fluxEventBus: { publish: sinon.stub() },
      globalState: { operationHolding: sinon.stub().returns(null) },
      localRemovalQueue: { queueRemovals: sinon.stub() },
      peerComponent: { componentStateOnOtherHolders: sinon.stub().resolves(PeerComponent.RUNNING), PeerComponent },
      peerFolderLiveness: { createPeerFolderLiveness: sinon.stub().returns({}) },
    };
    recovery = proxyquire('../../ZelBack/src/services/appLifecycle/lostVolumeRecovery', {
      '../../lib/log': stubs.log,
      '../dockerService': stubs.dockerService,
      '../fluxNetworkHelper': stubs.fluxNetworkHelper,
      '../appDatabase/registryManager': stubs.registryManager,
      '../utils/fluxEventBus': stubs.fluxEventBus,
      '../utils/globalState': stubs.globalState,
      './localRemovalQueue': stubs.localRemovalQueue,
      '../appMonitoring/peerComponent': stubs.peerComponent,
      '../appMonitoring/peerFolderLiveness': stubs.peerFolderLiveness,
    });
    stubs.rebuilder = sinon.stub().resolves();
    recovery.setRebuilder(stubs.rebuilder);
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  it('leaves a volume the host could not mount to the host', async () => {
    for (const reason of ['loop_unavailable', 'host_filesystem_absent', 'host_filesystem_readonly', 'mount_host_refused: busy']) {
      // eslint-disable-next-line no-await-in-loop
      await recovery.recover(synced({ reason }));
    }
    sinon.assert.notCalled(stubs.rebuilder);
    sinon.assert.notCalled(stubs.localRemovalQueue.queueRemovals);
  });

  it('treats each reason that says the data is gone as gone', () => {
    ['volume_file_missing', 'mount_failed: wrong fs type', 'volume_incomplete_install: bad superblock', 'volume_image_unrecognised']
      .forEach((reason) => expect(recovery.isVolumeGone(reason), reason).to.equal(true));
  });

  it('removes an app whose data is not synced', async () => {
    await recovery.recover(synced({ synced: false }));
    sinon.assert.calledOnceWithExactly(stubs.localRemovalQueue.queueRemovals, ['App']);
    sinon.assert.notCalled(stubs.peerComponent.componentStateOnOtherHolders);
    sinon.assert.calledWithMatch(stubs.fluxEventBus.publish, 'app:lostVolume', { identifier: 'db_App', action: 'remove' });
  });

  it('rebuilds a synced component another holder runs, as that component alone', async () => {
    await recovery.recover(synced());
    const [, , ctx] = stubs.peerComponent.componentStateOnOtherHolders.firstCall.args;
    expect(ctx.appIds).to.deep.equal(['fluxdb_App']);
    sinon.assert.calledOnceWithExactly(stubs.rebuilder, { appName: 'App', componentName: 'db', specifications: null });
    sinon.assert.notCalled(stubs.localRemovalQueue.queueRemovals);
    sinon.assert.calledWithMatch(stubs.fluxEventBus.publish, 'app:lostVolume', { action: 'rebuild' });
  });

  it('rebuilds a single-component app as the whole app, from its specification', async () => {
    await recovery.recover(synced({ identifier: 'App', version: 3 }));
    sinon.assert.calledOnceWithExactly(stubs.rebuilder, { appName: 'App', componentName: null, specifications: { name: 'App', version: 3 } });
  });

  it('removes the app when no other holder is proven to run it', async () => {
    for (const state of [PeerComponent.NOT_RUNNING, PeerComponent.UNKNOWN]) {
      stubs.peerComponent.componentStateOnOtherHolders.resolves(state);
      // eslint-disable-next-line no-await-in-loop
      await recovery.recover(synced());
    }
    sinon.assert.notCalled(stubs.rebuilder);
    sinon.assert.calledTwice(stubs.localRemovalQueue.queueRemovals);
  });

  it('rebuilds a component at most once an hour', async () => {
    await recovery.recover(synced());
    clock.tick(recovery.REBUILD_MIN_INTERVAL_MS - 1);
    await recovery.recover(synced());
    sinon.assert.calledOnce(stubs.rebuilder);
    clock.tick(1);
    await recovery.recover(synced());
    sinon.assert.calledTwice(stubs.rebuilder);
  });

  it('decides nothing while another operation holds the node, and starts no hour', async () => {
    stubs.globalState.operationHolding.returns('installation');
    await recovery.recover(synced());
    sinon.assert.notCalled(stubs.rebuilder);
    sinon.assert.notCalled(stubs.localRemovalQueue.queueRemovals);

    stubs.globalState.operationHolding.returns(null);
    await recovery.recover(synced());
    sinon.assert.calledOnce(stubs.rebuilder);
  });

  it('decides once for a component while a decision is in progress', async () => {
    let release;
    stubs.rebuilder.callsFake(() => new Promise((resolve) => { release = resolve; }));
    const first = recovery.recover(synced());
    await new Promise((resolve) => { setImmediate(resolve); });
    await recovery.recover(synced());
    release();
    await first;
    sinon.assert.calledOnce(stubs.peerComponent.componentStateOnOtherHolders);
  });
});
