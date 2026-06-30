const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('imageCacheController tests', () => {
  let stubs;
  let originalFluxosPath;

  function mkRes() {
    const res = {};
    res.status = sinon.stub().returns(res);
    res.json = sinon.stub().returns(res);
    return res;
  }

  function mkReq(overrides = {}) {
    return {
      headers: { zelidauth: { zelid: 'F1' } },
      body: {},
      params: {},
      query: {},
      ...overrides,
    };
  }

  function build() {
    process.env.FLUXOS_PATH = '/tmp/fluxos'; // isArcane is read at module load
    stubs = {
      verifyPrivilege: sinon.stub().resolves(true),
      getCachedEnterpriseIdentity: sinon.stub().returns(true),
      getCachedAllowedOwnersForNode: sinon.stub().returns(['F1']),
      submitEncrypted: sinon.stub().resolves({ jobId: 'J1' }),
      getJob: sinon.stub(),
      listImages: sinon.stub(),
      getImageDetail: sinon.stub(),
      deleteImage: sinon.stub(),
    };
    return proxyquire('../../ZelBack/src/services/appManagement/imageCacheController', {
      config: { fluxapps: { imageCacheEnabled: true } },
      '../messageHelper': {
        createErrorMessage: (message) => ({ status: 'error', data: { message } }),
        createDataMessage: (data) => ({ status: 'success', data }),
      },
      '../serviceHelper': { ensureObject: (x) => (x && typeof x === 'object' ? x : {}) },
      '../verificationHelper': { verifyPrivilege: stubs.verifyPrivilege },
      '../utils/enterpriseNetwork': {
        getCachedEnterpriseIdentity: stubs.getCachedEnterpriseIdentity,
        getCachedAllowedOwnersForNode: stubs.getCachedAllowedOwnersForNode,
      },
      '../../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
      '../appLifecycle/imageCacheService': {
        submitEncrypted: stubs.submitEncrypted,
        getJob: stubs.getJob,
        listImages: stubs.listImages,
        getImageDetail: stubs.getImageDetail,
        deleteImage: stubs.deleteImage,
      },
    });
  }

  before(() => { originalFluxosPath = process.env.FLUXOS_PATH; });
  afterEach(() => {
    sinon.restore();
    if (originalFluxosPath === undefined) delete process.env.FLUXOS_PATH;
    else process.env.FLUXOS_PATH = originalFluxosPath;
  });

  describe('gate + auth', () => {
    it('403 when the node is not enterprise', async () => {
      const c = build();
      stubs.getCachedEnterpriseIdentity.returns(false);
      const res = mkRes();
      await c.getImageCacheList(mkReq(), res);
      expect(res.status.calledWith(403)).to.equal(true);
    });

    it('401 when the signature does not verify', async () => {
      const c = build();
      stubs.verifyPrivilege.resolves(false);
      const res = mkRes();
      await c.getImageCacheList(mkReq(), res);
      expect(res.status.calledWith(401)).to.equal(true);
    });

    it('403 when the signing FluxID is not an allowed owner on this node', async () => {
      const c = build();
      stubs.getCachedAllowedOwnersForNode.returns(['SOMEONE_ELSE']);
      const res = mkRes();
      await c.getImageCacheList(mkReq(), res);
      expect(res.status.calledWith(403)).to.equal(true);
    });
  });

  describe('postImageCache', () => {
    it('202 with jobId + statusUrl on a valid submission', async () => {
      const c = build();
      const res = mkRes();
      await c.postImageCache(mkReq({ body: { data: 'BLOB' } }), res);
      expect(stubs.submitEncrypted.calledOnceWith('F1', 'BLOB')).to.equal(true);
      expect(res.status.calledWith(202)).to.equal(true);
      expect(res.json.firstCall.args[0].data).to.include({ jobId: 'J1', statusUrl: '/apps/imagecache/status/J1' });
    });

    it('400 when the encrypted data payload is missing', async () => {
      const c = build();
      const res = mkRes();
      await c.postImageCache(mkReq({ body: {} }), res);
      expect(res.status.calledWith(400)).to.equal(true);
    });

    it('maps service bad-request -> 400 and over-capacity -> 507', async () => {
      const c = build();
      const badErr = new Error('bad'); badErr.kind = 'bad-request';
      stubs.submitEncrypted.rejects(badErr);
      let res = mkRes();
      await c.postImageCache(mkReq({ body: { data: 'BLOB' } }), res);
      expect(res.status.calledWith(400)).to.equal(true);

      const capErr = new Error('full'); capErr.kind = 'over-capacity';
      stubs.submitEncrypted.rejects(capErr);
      res = mkRes();
      await c.postImageCache(mkReq({ body: { data: 'BLOB' } }), res);
      expect(res.status.calledWith(507)).to.equal(true);
    });
  });

  describe('getImageCacheStatus', () => {
    it('200 with the job when found, 404 when not', async () => {
      const c = build();
      stubs.getJob.returns({ jobId: 'J1', images: [] });
      let res = mkRes();
      await c.getImageCacheStatus(mkReq({ params: { jobId: 'J1' } }), res);
      expect(res.json.firstCall.args[0].data.jobId).to.equal('J1');

      stubs.getJob.returns(null);
      res = mkRes();
      await c.getImageCacheStatus(mkReq({ params: { jobId: 'X' } }), res);
      expect(res.status.calledWith(404)).to.equal(true);
    });
  });

  describe('getImageCacheList', () => {
    it('200 with the owner listing', async () => {
      const c = build();
      stubs.listImages.resolves({ images: [], allocation: { usedBytes: 0 } });
      const res = mkRes();
      await c.getImageCacheList(mkReq(), res);
      expect(res.json.firstCall.args[0].data).to.have.property('allocation');
    });
  });

  describe('getImageCacheItem', () => {
    it('400 without an identifier, 404 when missing, 200 when found', async () => {
      const c = build();
      let res = mkRes();
      await c.getImageCacheItem(mkReq(), res);
      expect(res.status.calledWith(400)).to.equal(true);

      stubs.getImageDetail.resolves(null);
      res = mkRes();
      await c.getImageCacheItem(mkReq({ query: { identifier: 'repo:1' } }), res);
      expect(res.status.calledWith(404)).to.equal(true);

      stubs.getImageDetail.resolves({ repotag: 'repo:1' });
      res = mkRes();
      await c.getImageCacheItem(mkReq({ query: { identifier: 'repo:1' } }), res);
      expect(res.json.firstCall.args[0].data.repotag).to.equal('repo:1');
    });
  });

  describe('removeImageCache', () => {
    it('400 without identifier, 404 when not found, 200 when removed', async () => {
      const c = build();
      let res = mkRes();
      await c.removeImageCache(mkReq(), res);
      expect(res.status.calledWith(400)).to.equal(true);

      stubs.deleteImage.resolves({ found: false, message: 'no' });
      res = mkRes();
      await c.removeImageCache(mkReq({ body: { identifier: 'repo:1' } }), res);
      expect(res.status.calledWith(404)).to.equal(true);

      stubs.deleteImage.resolves({ found: true, removed: true, imageRemoved: true });
      res = mkRes();
      await c.removeImageCache(mkReq({ body: { identifier: 'repo:1' } }), res);
      expect(res.json.firstCall.args[0].data).to.include({ removed: true });
    });
  });
});
