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
      listImagesForFluxId: sinon.stub().resolves([]),
      listAllImages: sinon.stub().resolves([]),
      removeImage: sinon.stub().resolves(true),
      findPinsForRepotag: sinon.stub().resolves([]),
      appDockerImageRemove: sinon.stub().resolves(),
      dockerListContainers: sinon.stub().resolves([]),
      dockerListImages: sinon.stub().resolves([{ RepoTags: ['repo:1'], Size: 4242, Id: 'sha256:img' }]),
      dockerImageInspect: sinon.stub().resolves({ Id: 'sha256:img' }),
      delay: sinon.stub().resolves(),
      decrypt: sinon.stub().resolves({ images: [{ repotag: 'repo:1' }] }),
      quotaInfoForFluxId: sinon.stub().returns({ usedBytes: 0, quotaBytes: 20_000_000_000, remainingBytes: 20_000_000_000 }),
      nodeQuotaInfo: sinon.stub().returns({ usedBytes: 0, capBytes: 60_000_000_000, remainingBytes: 60_000_000_000 }),
    };
    return proxyquire('../../ZelBack/src/services/appLifecycle/imageCacheService', {
      config: { fluxapps: { imageCacheEnabled: true, imageCacheJobTtlMs: 10_800_000, imageCacheMaxConcurrentPulls: 3, imageCacheMaxPullRetries: 1 } },
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../serviceHelper': { delay: stubs.delay },
      '../dockerService': {
        dockerListImages: stubs.dockerListImages, dockerImageInspect: stubs.dockerImageInspect, appDockerImageRemove: stubs.appDockerImageRemove, dockerListContainers: stubs.dockerListContainers,
      },
      '../appSecurity/imageManager': { checkApplicationImagesCompliance: stubs.compliance },
      '../utils/enterpriseHelper': { decryptEnterpriseFromSession: stubs.decrypt },
      './imageCacheStore': {
        upsertImage: stubs.upsertImage,
        patchImage: stubs.patchImage,
        listImagesForFluxId: stubs.listImagesForFluxId,
        listAllImages: stubs.listAllImages,
        removeImage: stubs.removeImage,
        findPinsForRepotag: stubs.findPinsForRepotag,
      },
      './imageCacheQuota': {
        tryAdmit: stubs.tryAdmit,
        release: stubs.release,
        quotaInfoForFluxId: stubs.quotaInfoForFluxId,
        nodeQuotaInfo: stubs.nodeQuotaInfo,
      },
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

  describe('image not present after a resolved pull', () => {
    it('marks failed (not pinned) when the pulled image is absent (inspect 404)', async () => {
      const svc = build();
      // pull resolves but the image never landed (truncated stream / swallowed error)
      const notFound = new Error('no such image');
      notFound.statusCode = 404;
      stubs.dockerImageInspect.rejects(notFound);
      const { jobId, settled } = svc.submit('F1', [{ repotag: 'repo:1' }]);
      await settled;

      const view = svc.getJob(jobId, 'F1');
      expect(view.images[0].state).to.equal('failed');
      expect(view.images[0].error).to.equal('pull completed but image is not present');
      expect(stubs.patchImage.lastCall.args[2]).to.include({ state: 'failed' });
      // never pinned an unconfirmed image
      expect(stubs.patchImage.getCalls().some((c) => c.args[2] && c.args[2].state === 'pinned')).to.equal(false);
      expect(stubs.release.calledOnceWith('t1')).to.equal(true);
    });

    it('fail-closes (marks failed) when the presence check errors non-404', async () => {
      const svc = build();
      stubs.dockerImageInspect.rejects(new Error('docker daemon busy'));
      const { jobId, settled } = svc.submit('F1', [{ repotag: 'repo:1' }]);
      await settled;

      const view = svc.getJob(jobId, 'F1');
      expect(view.images[0].state).to.equal('failed');
      expect(view.images[0].error).to.equal('docker daemon busy');
      expect(stubs.patchImage.getCalls().some((c) => c.args[2] && c.args[2].state === 'pinned')).to.equal(false);
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

  describe('submitEncrypted', () => {
    it('decrypts with the synthetic per-owner label and starts a job', async () => {
      const svc = build();
      const { jobId } = await svc.submitEncrypted('F1', 'BLOB');
      expect(jobId).to.be.a('string');
      expect(stubs.decrypt.calledOnceWith('BLOB', 'fluxos-image-cache', 0, 'F1')).to.equal(true);
    });

    it('throws bad-request when the payload cannot be decrypted', async () => {
      const svc = build();
      stubs.decrypt.rejects(new Error('Error decrypting AES key'));
      let caught;
      try { await svc.submitEncrypted('F1', 'BLOB'); } catch (e) { caught = e; }
      expect(caught.kind).to.equal('bad-request');
    });

    it('throws bad-request when the decrypted payload has no images', async () => {
      const svc = build();
      stubs.decrypt.resolves({ images: [] });
      let caught;
      try { await svc.submitEncrypted('F1', 'BLOB'); } catch (e) { caught = e; }
      expect(caught.kind).to.equal('bad-request');
    });

    it('throws over-capacity when the owner quota is already full', async () => {
      const svc = build();
      stubs.quotaInfoForFluxId.returns({ usedBytes: 20_000_000_000, quotaBytes: 20_000_000_000, remainingBytes: 0 });
      let caught;
      try { await svc.submitEncrypted('F1', 'BLOB'); } catch (e) { caught = e; }
      expect(caught.kind).to.equal('over-capacity');
    });

    it('throws over-capacity (fail-closed) when accounting is unavailable', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves(null);
      let caught;
      try { await svc.submitEncrypted('F1', 'BLOB'); } catch (e) { caught = e; }
      expect(caught.kind).to.equal('over-capacity');
    });
  });

  describe('listImages', () => {
    it('returns owner records plus the allocation summary', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves([{ repotag: 'repo:1', state: 'pinned', sizeOnDiskBytes: 4242 }]);
      stubs.quotaInfoForFluxId.returns({ usedBytes: 4242, quotaBytes: 20_000_000_000, remainingBytes: 19_999_995_758 });
      const result = await svc.listImages('F1');
      expect(result.images[0]).to.include({ repotag: 'repo:1', state: 'pinned', sizeOnDiskBytes: 4242 });
      expect(result.allocation).to.deep.equal({ usedBytes: 4242, quotaBytes: 20_000_000_000, remainingBytes: 19_999_995_758 });
    });

    it('throws on a store read failure', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves(null);
      let threw = false;
      try { await svc.listImages('F1'); } catch (e) { threw = true; }
      expect(threw).to.equal(true);
    });
  });

  describe('getImageDetail', () => {
    it('matches by repotag or digest, else null', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves([{ repotag: 'repo:1', digest: 'sha256:abc', state: 'pinned' }]);
      expect((await svc.getImageDetail('F1', 'repo:1')).repotag).to.equal('repo:1');
      expect((await svc.getImageDetail('F1', 'sha256:abc')).repotag).to.equal('repo:1');
      expect(await svc.getImageDetail('F1', 'nope')).to.equal(null);
    });
  });

  describe('deleteImage', () => {
    it('unpins and removes the image when no other owner pins it', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves([{ repotag: 'repo:1', digest: 'd', state: 'pinned' }]);
      stubs.findPinsForRepotag.resolves([]); // no other owners
      const result = await svc.deleteImage('F1', 'repo:1');
      expect(result).to.include({ found: true, removed: true, imageRemoved: true });
      expect(stubs.removeImage.calledOnceWith('F1', 'repo:1')).to.equal(true);
      expect(stubs.appDockerImageRemove.calledOnceWith('repo:1')).to.equal(true);
    });

    it('unpins but KEEPS the image when another owner still pins it', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves([{ repotag: 'repo:1', state: 'pinned' }]);
      stubs.findPinsForRepotag.resolves([{ fluxId: 'F2', state: 'pinned' }]);
      const result = await svc.deleteImage('F1', 'repo:1');
      expect(result).to.include({ found: true, removed: true, imageRemoved: false });
      expect(stubs.appDockerImageRemove.called).to.equal(false);
    });

    it('unpins but does NOT attempt removal when an app container uses the image (pre-check)', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves([{ repotag: 'repo:1', imageId: 'sha256:img', state: 'pinned' }]);
      stubs.findPinsForRepotag.resolves([]);
      stubs.dockerListContainers.resolves([{ Image: 'repo:1', ImageID: 'sha256:img' }]);
      const result = await svc.deleteImage('F1', 'repo:1');
      expect(result).to.include({ found: true, removed: true, imageRemoved: false });
      expect(stubs.appDockerImageRemove.called).to.equal(false); // never even tried
    });

    it('matches usage by imageId across a different tag', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves([{ repotag: 'repo:1', imageId: 'sha256:img', state: 'pinned' }]);
      stubs.findPinsForRepotag.resolves([]);
      stubs.dockerListContainers.resolves([{ Image: 'repo:other-tag', ImageID: 'sha256:img' }]);
      const result = await svc.deleteImage('F1', 'repo:1');
      expect(result.imageRemoved).to.equal(false);
      expect(stubs.appDockerImageRemove.called).to.equal(false);
    });

    it('KEEPS the image (fail-safe) if the container list cannot be read', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves([{ repotag: 'repo:1', state: 'pinned' }]);
      stubs.findPinsForRepotag.resolves([]);
      stubs.dockerListContainers.rejects(new Error('docker down'));
      const result = await svc.deleteImage('F1', 'repo:1');
      expect(result.imageRemoved).to.equal(false);
      expect(stubs.appDockerImageRemove.called).to.equal(false);
    });

    it('TOCTOU backstop: a 409 from a racing container is still handled', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves([{ repotag: 'repo:1', state: 'pinned' }]);
      stubs.findPinsForRepotag.resolves([]);
      stubs.dockerListContainers.resolves([]); // pre-check says free...
      stubs.appDockerImageRemove.rejects(new Error('409 conflict')); // ...but docker refuses
      const result = await svc.deleteImage('F1', 'repo:1');
      expect(result).to.include({ found: true, removed: true, imageRemoved: false });
    });

    it('returns found:false for an unknown image', async () => {
      const svc = build();
      stubs.listImagesForFluxId.resolves([]);
      const result = await svc.deleteImage('F1', 'nope');
      expect(result).to.include({ found: false, removed: false });
      expect(stubs.removeImage.called).to.equal(false);
    });
  });

  describe('reconcilePinnedImage (post image-update refresh)', () => {
    it('re-measures and patches every live pin with the new size/imageId/digest', async () => {
      const svc = build();
      stubs.findPinsForRepotag.resolves([{ fluxId: 'F1', state: 'pinned' }, { fluxId: 'F2', state: 'pinned' }]);
      stubs.dockerListImages.resolves([{ RepoTags: ['repo:1'], Size: 9999, Id: 'sha256:newimg', RepoDigests: ['repo@sha256:newdigest'] }]);
      await svc.reconcilePinnedImage('repo:1');
      expect(stubs.patchImage.callCount).to.equal(2);
      const [fluxId, repotag, patch] = stubs.patchImage.firstCall.args;
      expect(fluxId).to.equal('F1');
      expect(repotag).to.equal('repo:1');
      expect(patch).to.include({ sizeOnDiskBytes: 9999, imageId: 'sha256:newimg', digest: 'sha256:newdigest' });
      expect(patch).to.have.property('lastReferencedAt');
      expect(stubs.patchImage.secondCall.args[0]).to.equal('F2');
    });

    it('is a no-op when the repotag has no pin', async () => {
      const svc = build();
      stubs.findPinsForRepotag.resolves([]);
      await svc.reconcilePinnedImage('repo:1');
      expect(stubs.patchImage.called).to.equal(false);
      expect(stubs.dockerListImages.called).to.equal(false);
    });

    it('skips failed pins (only refreshes pinned state)', async () => {
      const svc = build();
      stubs.findPinsForRepotag.resolves([{ fluxId: 'F1', state: 'failed' }]);
      await svc.reconcilePinnedImage('repo:1');
      expect(stubs.patchImage.called).to.equal(false);
    });
  });
});
