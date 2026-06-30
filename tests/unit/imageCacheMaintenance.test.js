const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('imageCacheMaintenance tests', () => {
  let stubs;

  function build() {
    stubs = {
      listAllImages: sinon.stub().resolves([]),
      patchImage: sinon.stub().resolves(true),
      removeAllForFluxId: sinon.stub().resolves(true),
      removeImage: sinon.stub().resolves(true),
      dockerListImages: sinon.stub().resolves([]),
      getCachedAllowedOwnersForNode: sinon.stub().returns(['F1']),
    };
    return proxyquire('../../ZelBack/src/services/appLifecycle/imageCacheMaintenance', {
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../dockerService': { dockerListImages: stubs.dockerListImages },
      '../utils/enterpriseNetwork': { getCachedAllowedOwnersForNode: stubs.getCachedAllowedOwnersForNode },
      './imageCacheStore': {
        listAllImages: stubs.listAllImages,
        patchImage: stubs.patchImage,
        removeAllForFluxId: stubs.removeAllForFluxId,
        removeImage: stubs.removeImage,
      },
    });
  }

  afterEach(() => {
    sinon.restore();
  });

  describe('reconcileInterruptedPulls', () => {
    it('marks only the pulling records failed', async () => {
      const m = build();
      stubs.listAllImages.resolves([
        { fluxId: 'F1', repotag: 'r1', state: 'pulling' },
        { fluxId: 'F1', repotag: 'r2', state: 'pinned' },
      ]);
      await m.reconcileInterruptedPulls();
      expect(stubs.patchImage.calledOnce).to.equal(true);
      expect(stubs.patchImage.firstCall.args).to.deep.equal(['F1', 'r1', { state: 'failed', error: 'interrupted by restart' }]);
    });

    it('no-ops when the store read fails (null)', async () => {
      const m = build();
      stubs.listAllImages.resolves(null);
      await m.reconcileInterruptedPulls();
      expect(stubs.patchImage.called).to.equal(false);
    });
  });

  describe('cleanupDeauthorizedOwners', () => {
    it('removes records for owners not in the allow-list (deduped)', async () => {
      const m = build();
      stubs.getCachedAllowedOwnersForNode.returns(['F1']);
      stubs.listAllImages.resolves([
        { fluxId: 'F1', repotag: 'a' },
        { fluxId: 'F2', repotag: 'b' },
        { fluxId: 'F2', repotag: 'c' },
      ]);
      await m.cleanupDeauthorizedOwners();
      expect(stubs.removeAllForFluxId.calledOnceWith('F2')).to.equal(true);
    });

    it('defers (does nothing) while the node identity is unresolved (null)', async () => {
      const m = build();
      stubs.getCachedAllowedOwnersForNode.returns(null);
      stubs.listAllImages.resolves([{ fluxId: 'F2', repotag: 'b' }]);
      await m.cleanupDeauthorizedOwners();
      expect(stubs.removeAllForFluxId.called).to.equal(false);
    });

    it('purges every owner when the node is no longer enterprise (empty allow-list)', async () => {
      const m = build();
      stubs.getCachedAllowedOwnersForNode.returns([]);
      stubs.listAllImages.resolves([{ fluxId: 'F1', repotag: 'a' }, { fluxId: 'F2', repotag: 'b' }]);
      await m.cleanupDeauthorizedOwners();
      expect(stubs.removeAllForFluxId.callCount).to.equal(2);
    });
  });

  describe('reconcileOrphanedRecords', () => {
    it('drops pinned records whose docker image is gone', async () => {
      const m = build();
      stubs.listAllImages.resolves([
        { fluxId: 'F1', repotag: 'present:1', state: 'pinned' },
        { fluxId: 'F1', repotag: 'gone:1', state: 'pinned' },
        { fluxId: 'F1', repotag: 'pulling:1', state: 'pulling' },
      ]);
      stubs.dockerListImages.resolves([{ RepoTags: ['present:1'] }]);
      await m.reconcileOrphanedRecords();
      expect(stubs.removeImage.calledOnceWith('F1', 'gone:1')).to.equal(true);
    });

    it('skips when listImages fails (does not drop records)', async () => {
      const m = build();
      stubs.listAllImages.resolves([{ fluxId: 'F1', repotag: 'gone:1', state: 'pinned' }]);
      stubs.dockerListImages.rejects(new Error('docker down'));
      await m.reconcileOrphanedRecords();
      expect(stubs.removeImage.called).to.equal(false);
    });
  });

  describe('runBootReconcile', () => {
    function seedAllThree() {
      // one interrupted pull, one de-authorized owner, one orphaned pin
      stubs.getCachedAllowedOwnersForNode.returns(['F1']);
      stubs.listAllImages.resolves([
        { fluxId: 'F1', repotag: 'r-pulling', state: 'pulling' },
        { fluxId: 'F2', repotag: 'r-deauth', state: 'pinned' },
        { fluxId: 'F1', repotag: 'present:1', state: 'pinned' },
        { fluxId: 'F1', repotag: 'gone:1', state: 'pinned' },
      ]);
      stubs.dockerListImages.resolves([{ RepoTags: ['present:1'] }]);
    }

    it('runs all three reconcilers at boot', async () => {
      const m = build();
      seedAllThree();
      await m.runBootReconcile();
      expect(stubs.patchImage.calledWith('F1', 'r-pulling', { state: 'failed', error: 'interrupted by restart' })).to.equal(true);
      expect(stubs.removeAllForFluxId.calledWith('F2')).to.equal(true);
      expect(stubs.removeImage.calledWith('F1', 'gone:1')).to.equal(true);
    });

    it('isolates a failing reconciler so the others still run', async () => {
      const m = build();
      seedAllThree();
      stubs.patchImage.rejects(new Error('db blip')); // interrupted-pulls step throws
      await m.runBootReconcile();
      // de-auth + orphan still execute
      expect(stubs.removeAllForFluxId.calledWith('F2')).to.equal(true);
      expect(stubs.removeImage.calledWith('F1', 'gone:1')).to.equal(true);
    });
  });
});
