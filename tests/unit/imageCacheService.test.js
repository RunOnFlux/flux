const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('imageCacheService tests', () => {
  let stubs;

  function build() {
    stubs = {
      compliance: sinon.stub().resolves(),
      inspectImage: sinon.stub().resolves({
        ok: true, supported: true, compressedBytes: 1000, digest: 'sha256:abc', supportedArchitectures: ['amd64'], error: null,
      }),
      pullImage: sinon.stub().resolves(),
      tryAdmit: sinon.stub().resolves({ decision: 'admit', token: 't1', estimateBytes: 2000 }),
      release: sinon.stub(),
      upsertImage: sinon.stub().resolves(true),
      patchImage: sinon.stub().resolves(true),
      dockerListImages: sinon.stub().resolves([{ RepoTags: ['repo:1'], Size: 4242, Id: 'sha256:img' }]),
      delay: sinon.stub().resolves(),
    };
    return proxyquire('../../ZelBack/src/services/appLifecycle/imageCacheService', {
      config: { fluxapps: { imageCacheJobTtlMs: 10_800_000, imageCacheMaxConcurrentPulls: 3, imageCacheMaxPullRetries: 1 } },
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../serviceHelper': { delay: stubs.delay },
      '../dockerService': { dockerListImages: stubs.dockerListImages },
      '../appSecurity/imageManager': { checkApplicationImagesCompliance: stubs.compliance },
      './imageCacheStore': { upsertImage: stubs.upsertImage, patchImage: stubs.patchImage },
      './imageCacheQuota': { tryAdmit: stubs.tryAdmit, release: stubs.release },
      './imageCacheDownloader': { inspectImage: stubs.inspectImage, pullImage: stubs.pullImage },
    });
  }

  afterEach(() => {
    sinon.restore();
  });

  describe('submit validation', () => {
    it('throws on an empty image list', () => {
      const svc = build();
      expect(() => svc.submit('F1', [])).to.throw('No images provided');
    });

    it('throws when an image has no repotag', () => {
      const svc = build();
      expect(() => svc.submit('F1', [{ repoauth: 'x' }])).to.throw('repotag');
    });
  });

  describe('happy path', () => {
    it('inspects, admits, pulls, reconciles size and pins the image', async () => {
      const svc = build();
      const { jobId, settled } = svc.submit('F1', [{ repotag: 'repo:1', repoauth: 'authstr' }]);
      await settled;

      const view = svc.getJob(jobId, 'F1');
      expect(view.images).to.have.length(1);
      expect(view.images[0]).to.include({ repotag: 'repo:1', state: 'pinned', sizeOnDiskBytes: 4242 });
      expect(view.settled).to.equal(true);

      // wrote a 'pulling' record up front, then patched to 'pinned' with the real size
      expect(stubs.upsertImage.firstCall.args[0]).to.include({ fluxId: 'F1', repotag: 'repo:1', state: 'pulling' });
      const patch = stubs.patchImage.lastCall.args[2];
      expect(patch).to.include({ state: 'pinned', sizeOnDiskBytes: 4242, imageId: 'sha256:img' });
      // reservation released
      expect(stubs.release.calledOnceWith('t1')).to.equal(true);
    });
  });

  describe('admission reject', () => {
    it('marks an over-quota image rejected and never pulls it', async () => {
      const svc = build();
      stubs.tryAdmit.resolves({ decision: 'reject', reason: 'over-quota', estimateBytes: 2000 });
      const { jobId, settled } = svc.submit('F1', [{ repotag: 'repo:1' }]);
      await settled;

      const view = svc.getJob(jobId, 'F1');
      expect(view.images[0]).to.include({ state: 'rejected', reason: 'over-quota' });
      expect(stubs.pullImage.called).to.equal(false);
    });
  });

  describe('compliance reject', () => {
    it('rejects a blocked image before inspecting or pulling', async () => {
      const svc = build();
      stubs.compliance.rejects(new Error('Image x is blocked'));
      const { jobId, settled } = svc.submit('F1', [{ repotag: 'repo:1' }]);
      await settled;

      const view = svc.getJob(jobId, 'F1');
      expect(view.images[0]).to.include({ state: 'rejected', reason: 'non-compliant' });
      expect(stubs.inspectImage.called).to.equal(false);
      expect(stubs.pullImage.called).to.equal(false);
    });
  });

  describe('pull failure', () => {
    it('retries then marks the image failed and releases the reservation', async () => {
      const svc = build();
      stubs.pullImage.rejects(new Error('boom'));
      const { jobId, settled } = svc.submit('F1', [{ repotag: 'repo:1' }]);
      await settled;

      const view = svc.getJob(jobId, 'F1');
      expect(view.images[0]).to.include({ state: 'failed' });
      expect(view.images[0].error).to.equal('boom');
      expect(stubs.pullImage.callCount).to.equal(2); // initial + 1 retry (maxRetries=1)
      expect(stubs.patchImage.lastCall.args[2]).to.include({ state: 'failed' });
      expect(stubs.release.calledOnceWith('t1')).to.equal(true);
    });
  });

  describe('getJob ownership scoping', () => {
    it('returns null for another owner and for an unknown job', async () => {
      const svc = build();
      const { jobId, settled } = svc.submit('F1', [{ repotag: 'repo:1' }]);
      await settled;
      expect(svc.getJob(jobId, 'OTHER')).to.equal(null);
      expect(svc.getJob('no-such-job', 'F1')).to.equal(null);
    });
  });
});
