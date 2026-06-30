const { expect } = require('chai');
const { ImageProgress } = require('../../ZelBack/src/services/appLifecycle/imageCacheProgress');

describe('imageCacheProgress tests', () => {
  it('sums per-layer downloaded bytes across layers', () => {
    const p = new ImageProgress();
    p.onEvent({ id: 'a', status: 'Downloading', progressDetail: { current: 100, total: 400 } });
    p.onEvent({ id: 'b', status: 'Downloading', progressDetail: { current: 200, total: 600 } });
    const snap = p.snapshot();
    expect(snap.pulledBytes).to.equal(300);
    expect(snap.totalBytes).to.equal(1000);
    expect(snap.pct).to.equal(30);
  });

  it('freezes a completed layer so a later Extracting event cannot reduce its bytes', () => {
    const p = new ImageProgress();
    p.onEvent({ id: 'a', status: 'Downloading', progressDetail: { current: 400, total: 400 } });
    p.onEvent({ id: 'a', status: 'Pull complete' });
    // Extracting reports current vs the (larger) uncompressed size, then resets — must not drag bytes down
    p.onEvent({ id: 'a', status: 'Extracting', progressDetail: { current: 5, total: 9000 } });
    const snap = p.snapshot();
    expect(snap.pulledBytes).to.equal(400);
    expect(snap.totalBytes).to.equal(400);
    expect(snap.pct).to.equal(100);
  });

  it('marks already-existing layers complete', () => {
    const p = new ImageProgress();
    p.onEvent({ id: 'a', status: 'Already exists' });
    // no totals known for an already-present layer -> contributes 0/0, pct stays 0
    expect(p.snapshot()).to.deep.equal({ pulledBytes: 0, totalBytes: 0, pct: 0 });
  });

  it('ignores overall status lines without a layer id', () => {
    const p = new ImageProgress();
    p.onEvent({ status: 'Pulling from library/nginx' });
    p.onEvent({ status: 'Status: Downloaded newer image' });
    expect(p.snapshot()).to.deep.equal({ pulledBytes: 0, totalBytes: 0, pct: 0 });
  });
});
