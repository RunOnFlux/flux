const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('imageReaper tests', () => {
  let stubs;

  function build() {
    stubs = {
      dockerListImages: sinon.stub().resolves([]),
      dockerListContainers: sinon.stub().resolves([]),
      appDockerImageRemove: sinon.stub().resolves('removed'),
      isOperationInProgress: sinon.stub().returns(false),
      shouldRetainImage: sinon.stub().resolves(false),
      // faithful to the real signature: always returns a promise, runs fn while "holding" the lock
      withHostMutationLock: sinon.stub().callsFake(async (fn) => fn()),
      log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    };
    return proxyquire('../../ZelBack/src/services/appLifecycle/imageReaper', {
      '../../lib/log': stubs.log,
      '../dockerService': {
        dockerListImages: stubs.dockerListImages,
        dockerListContainers: stubs.dockerListContainers,
        appDockerImageRemove: stubs.appDockerImageRemove,
      },
      '../utils/globalState': { isOperationInProgress: stubs.isOperationInProgress },
      './imageCacheRetention': { shouldRetainImage: stubs.shouldRetainImage },
      '../utils/hostMutationLock': { withHostMutationLock: stubs.withHostMutationLock },
    });
  }

  afterEach(() => {
    sinon.restore();
  });

  it('removes a cold, unpinned, tagged image', async () => {
    const reaper = build();
    stubs.dockerListImages.resolves([{ Id: 'sha256:cold', RepoTags: ['cold:1'] }]);
    const result = await reaper.pruneUnusedImages();
    expect(stubs.appDockerImageRemove.calledOnceWith('sha256:cold')).to.equal(true);
    expect(stubs.withHostMutationLock.calledOnce).to.equal(true);
    expect(result).to.deep.equal({ removed: 1, kept: 0, skipped: 0 });
  });

  it('removes a dangling <none>:<none> image (as the old prune did)', async () => {
    const reaper = build();
    stubs.dockerListImages.resolves([{ Id: 'sha256:dangling', RepoTags: ['<none>:<none>'] }]);
    const result = await reaper.pruneUnusedImages();
    expect(stubs.appDockerImageRemove.calledOnceWith('sha256:dangling')).to.equal(true);
    // a <none> image has no real tag, so the pin check is never consulted for it
    expect(stubs.shouldRetainImage.called).to.equal(false);
    expect(result.removed).to.equal(1);
  });

  it('keeps an image a container references by image id', async () => {
    const reaper = build();
    stubs.dockerListImages.resolves([{ Id: 'sha256:used', RepoTags: ['used:1'] }]);
    stubs.dockerListContainers.resolves([{ ImageID: 'sha256:used', Image: 'whatever' }]);
    const result = await reaper.pruneUnusedImages();
    expect(stubs.appDockerImageRemove.called).to.equal(false);
    expect(result).to.deep.equal({ removed: 0, kept: 1, skipped: 0 });
  });

  it('keeps an image a container references by tag name', async () => {
    const reaper = build();
    stubs.dockerListImages.resolves([{ Id: 'sha256:used', RepoTags: ['used:1'] }]);
    stubs.dockerListContainers.resolves([{ ImageID: 'sha256:other', Image: 'used:1' }]);
    const result = await reaper.pruneUnusedImages();
    expect(stubs.appDockerImageRemove.called).to.equal(false);
    expect(result.kept).to.equal(1);
  });

  it('keeps a pinned image (any non-failed cache pin)', async () => {
    const reaper = build();
    stubs.dockerListImages.resolves([{ Id: 'sha256:pinned', RepoTags: ['pinned:1'] }]);
    stubs.shouldRetainImage.withArgs('pinned:1').resolves(true);
    const result = await reaper.pruneUnusedImages();
    expect(stubs.appDockerImageRemove.called).to.equal(false);
    expect(result.kept).to.equal(1);
  });

  it('defers (does not remove) an image while an app operation is in progress', async () => {
    const reaper = build();
    stubs.dockerListImages.resolves([{ Id: 'sha256:cold', RepoTags: ['cold:1'] }]);
    stubs.isOperationInProgress.returns(true);
    const result = await reaper.pruneUnusedImages();
    // the kill-list still acquires the lock, but the in-progress guard skips the actual remove
    expect(stubs.appDockerImageRemove.called).to.equal(false);
    expect(result).to.deep.equal({ removed: 0, kept: 0, skipped: 1 });
  });

  it('checks the in-progress guard for each delete (skip-and-continue, not abort)', async () => {
    const reaper = build();
    stubs.dockerListImages.resolves([
      { Id: 'sha256:a', RepoTags: ['a:1'] },
      { Id: 'sha256:b', RepoTags: ['b:1'] },
    ]);
    // in progress only while deleting the first image, idle for the second
    stubs.isOperationInProgress.onFirstCall().returns(true);
    stubs.isOperationInProgress.returns(false);
    const result = await reaper.pruneUnusedImages();
    expect(stubs.appDockerImageRemove.calledOnceWith('sha256:b')).to.equal(true);
    expect(result).to.deep.equal({ removed: 1, kept: 0, skipped: 1 });
  });

  it('is best-effort when the docker list fails (no throw, reaps nothing)', async () => {
    const reaper = build();
    stubs.dockerListImages.rejects(new Error('docker down'));
    const result = await reaper.pruneUnusedImages();
    expect(stubs.appDockerImageRemove.called).to.equal(false);
    expect(result).to.deep.equal({ removed: 0, kept: 0, skipped: 0 });
    expect(stubs.log.warn.called).to.equal(true);
  });

  it('is best-effort when a single remove fails (409 in-use), reaping the rest', async () => {
    const reaper = build();
    stubs.dockerListImages.resolves([
      { Id: 'sha256:busy', RepoTags: ['busy:1'] },
      { Id: 'sha256:free', RepoTags: ['free:1'] },
    ]);
    stubs.appDockerImageRemove.withArgs('sha256:busy').rejects(new Error('409 conflict: image is being used'));
    const result = await reaper.pruneUnusedImages();
    expect(stubs.appDockerImageRemove.calledWith('sha256:free')).to.equal(true);
    expect(result).to.deep.equal({ removed: 1, kept: 0, skipped: 0 });
    expect(stubs.log.warn.called).to.equal(true);
  });

  it('reaps cold images on a non-enterprise node where shouldRetainImage is always false', async () => {
    const reaper = build();
    // shouldRetainImage default already resolves false (cache off) -> aggressive reclamation
    stubs.dockerListImages.resolves([
      { Id: 'sha256:x', RepoTags: ['x:1'] },
      { Id: 'sha256:y', RepoTags: ['y:1'] },
    ]);
    const result = await reaper.pruneUnusedImages();
    expect(result.removed).to.equal(2);
  });
});
