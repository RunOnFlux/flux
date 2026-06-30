const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('imageCacheRetention tests', () => {
  let storeStub;
  let configStub;

  function build({ enabled = true } = {}) {
    storeStub = { findPinsForRepotag: sinon.stub() };
    configStub = { fluxapps: { imageCacheEnabled: enabled } };
    return proxyquire('../../ZelBack/src/services/appLifecycle/imageCacheRetention', {
      config: configStub,
      './imageCacheStore': storeStub,
    });
  }

  afterEach(() => {
    sinon.restore();
  });

  describe('shouldRetainImage', () => {
    it('returns false (and does not query the store) when the cache is disabled', async () => {
      const ret = build({ enabled: false });
      expect(await ret.shouldRetainImage('r:1')).to.equal(false);
      expect(storeStub.findPinsForRepotag.called).to.equal(false);
    });

    it('returns false for a missing repotag', async () => {
      const ret = build();
      expect(await ret.shouldRetainImage('')).to.equal(false);
      expect(await ret.shouldRetainImage(undefined)).to.equal(false);
    });

    it('retains when a non-failed pin exists (any owner)', async () => {
      const ret = build();
      storeStub.findPinsForRepotag.resolves([{ fluxId: 'F1', state: 'pinned' }]);
      expect(await ret.shouldRetainImage('r:1')).to.equal(true);
    });

    it('retains when at least one pin is non-failed among failed ones', async () => {
      const ret = build();
      storeStub.findPinsForRepotag.resolves([{ state: 'failed' }, { state: 'pulling' }]);
      expect(await ret.shouldRetainImage('r:1')).to.equal(true);
    });

    it('does NOT retain when there are no pins', async () => {
      const ret = build();
      storeStub.findPinsForRepotag.resolves([]);
      expect(await ret.shouldRetainImage('r:1')).to.equal(false);
    });

    it('does NOT retain when every pin is failed', async () => {
      const ret = build();
      storeStub.findPinsForRepotag.resolves([{ state: 'failed' }, { state: 'failed' }]);
      expect(await ret.shouldRetainImage('r:1')).to.equal(false);
    });

    it('FAILS SAFE (retains) when the store read errored (null)', async () => {
      const ret = build();
      storeStub.findPinsForRepotag.resolves(null);
      expect(await ret.shouldRetainImage('r:1')).to.equal(true);
    });
  });
});
