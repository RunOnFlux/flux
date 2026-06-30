const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const GB = 1_000_000_000;

describe('imageCacheQuota tests', () => {
  let storeStub;

  function build() {
    storeStub = {
      listImagesForFluxId: sinon.stub(),
      listAllImages: sinon.stub(),
    };
    return proxyquire('../../ZelBack/src/services/appLifecycle/imageCacheQuota', {
      config: { fluxapps: { imageCachePerFluxIdQuotaGb: 20, imageCachePerImageBurstCapGb: 5, imageCacheNodeMaxGb: 60 } },
      './imageCacheStore': storeStub,
    });
  }

  afterEach(() => {
    sinon.restore();
  });

  describe('decide (pure decision matrix)', () => {
    const base = {
      compressedBytes: 1 * GB, committedFluxId: 0, reservedFluxId: 0, committedNode: 0, reservedNode: 0,
    };

    it('admits when committed + reserved leaves headroom', () => {
      const q = build();
      expect(q.decide({ ...base, committedFluxId: 10 * GB, committedNode: 10 * GB }).decision).to.equal('admit');
    });

    it('rejects too-big when compressed*2 reaches the per-image burst cap', () => {
      const q = build();
      const r = q.decide({ ...base, compressedBytes: 3 * GB }); // 6GB > 5GB cap
      expect(r.decision).to.equal('reject');
      expect(r.reason).to.equal('too-big');
    });

    it('rejects over-quota when the owner committed usage already fills the quota', () => {
      const q = build();
      const r = q.decide({ ...base, committedFluxId: 20 * GB });
      expect(r).to.include({ decision: 'reject', reason: 'over-quota' });
    });

    it('rejects over-node-cap when the node committed usage already fills the cap', () => {
      const q = build();
      const r = q.decide({ ...base, committedFluxId: 5 * GB, committedNode: 60 * GB });
      expect(r).to.include({ decision: 'reject', reason: 'over-node-cap' });
    });

    it('queues (not rejects) when only in-flight reservations block the quota', () => {
      const q = build();
      const r = q.decide({
        ...base, committedFluxId: 18 * GB, reservedFluxId: 3 * GB, committedNode: 18 * GB,
      });
      expect(r).to.include({ decision: 'queue', reason: 'quota-reserved' });
    });

    it('queues when only reservations block the node cap', () => {
      const q = build();
      const r = q.decide({
        ...base, committedFluxId: 5 * GB, committedNode: 58 * GB, reservedNode: 3 * GB,
      });
      expect(r).to.include({ decision: 'queue', reason: 'node-reserved' });
    });
  });

  describe('tryAdmit (store-backed, with reservations)', () => {
    it('admits, reserves, and the NEXT admit for the same owner queues until released', async () => {
      const q = build();
      storeStub.listImagesForFluxId.resolves([{ repotag: 'r0', sizeOnDiskBytes: 18 * GB }]);
      storeStub.listAllImages.resolves([{ fluxId: 'F1', repotag: 'r0', sizeOnDiskBytes: 18 * GB }]);

      const first = await q.tryAdmit('F1', 'rA', 1 * GB);
      expect(first.decision).to.equal('admit');
      expect(first.token).to.be.a('string');

      const second = await q.tryAdmit('F1', 'rB', 1 * GB);
      expect(second).to.include({ decision: 'queue', reason: 'quota-reserved' });

      q.release(first.token);
      const third = await q.tryAdmit('F1', 'rB', 1 * GB);
      expect(third.decision).to.equal('admit');
    });

    it('FAILS CLOSED (reject accounting-unavailable) when the store read errors', async () => {
      const q = build();
      storeStub.listImagesForFluxId.resolves(null);
      storeStub.listAllImages.resolves([]);
      const r = await q.tryAdmit('F1', 'rA', 1 * GB);
      expect(r).to.include({ decision: 'reject', reason: 'accounting-unavailable' });
    });

    it('excludes the candidate own repotag from committed (a refresh replaces it)', async () => {
      const q = build();
      // 20GB already pinned, but it IS the repotag being refreshed -> excluded -> admit.
      storeStub.listImagesForFluxId.resolves([{ repotag: 'rX', sizeOnDiskBytes: 20 * GB }]);
      storeStub.listAllImages.resolves([{ fluxId: 'F1', repotag: 'rX', sizeOnDiskBytes: 20 * GB }]);

      const refresh = await q.tryAdmit('F1', 'rX', 1 * GB);
      expect(refresh.decision).to.equal('admit');

      const other = await q.tryAdmit('F1', 'rNew', 1 * GB);
      expect(other).to.include({ decision: 'reject', reason: 'over-quota' });
    });
  });

  describe('accounting helpers', () => {
    it('usageFromRecords sums real on-disk sizes and tolerates missing fields', () => {
      const q = build();
      expect(q.usageFromRecords([{ sizeOnDiskBytes: 3 }, { sizeOnDiskBytes: 4 }, {}])).to.equal(7);
      expect(q.usageFromRecords(null)).to.equal(0);
    });

    it('quotaInfoForFluxId reports used/quota/remaining for the 20GB owner quota', () => {
      const q = build();
      expect(q.quotaInfoForFluxId([{ sizeOnDiskBytes: 5 * GB }])).to.deep.equal({
        usedBytes: 5 * GB, quotaBytes: 20 * GB, remainingBytes: 15 * GB,
      });
    });

    it('nodeQuotaInfo reports used/cap/remaining for the 60GB node cap, clamped at 0', () => {
      const q = build();
      expect(q.nodeQuotaInfo([{ sizeOnDiskBytes: 61 * GB }])).to.deep.equal({
        usedBytes: 61 * GB, capBytes: 60 * GB, remainingBytes: 0,
      });
    });
  });
});
