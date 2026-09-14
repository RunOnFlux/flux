const { expect } = require('chai');
const crypto = require('crypto');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// What the stub source serves and what the signed bundle vouches for. They agree here, and
// the tests that matter are the ones that make them disagree.
const BYTES = Buffer.from('gzipped bytes');
const SHA = sha(BYTES);
const FILE = `iplocation-${SHA}.bin.gz`;

// The background refresh and the node location pass are deliberately not
// awaited by their callers, so let their promise chains settle before asserting.
const settle = () => new Promise(setImmediate);

describe('ipLocationSync tests', () => {
  let ipLocationSync;
  let axiosGetStub;
  let policyStoreStub;
  let repositoryStub;
  let storeStub;
  let fluxListStub;
  let logStub;

  function buildModule() {
    axiosGetStub = sinon.stub().resolves({ status: 200, data: BYTES });
    policyStoreStub = {
      getArtifact: sinon.stub().returns({ file: FILE, sha256: SHA, bytes: BYTES.length }),
    };
    repositoryStub = {
      getArtifactRecord: sinon.stub().resolves(null),
      readArtifactBytes: sinon.stub().resolves(null),
      writeArtifactBytes: sinon.stub().resolves(true),
      sweepOrphanedArtifacts: sinon.stub().resolves(0),
    };
    storeStub = {
      setArtifact: sinon.stub().resolves({ generated: '2026-07-31T00:00:00Z', rowCount: 2126447 }),
      adoptPersistedStatus: sinon.stub().resolves(false),
      refreshNodeLocations: sinon.stub().resolves({ refreshed: 0, dropped: 0 }),
      status: sinon.stub().returns({ ready: false, generated: null, rowCount: 0 }),
    };
    fluxListStub = sinon.stub().resolves([{ ip: '80.95.213.209:16127' }]);
    logStub = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
    ipLocationSync = proxyquire('../../ZelBack/src/services/appPlacement/ipLocationSync', {
      '../serviceHelper': { axiosGet: axiosGetStub },
      '../fluxCommunicationUtils': { deterministicFluxList: fluxListStub },
      '../appDatabase/policyArtifactRepository': repositoryStub,
      '../policyStore': policyStoreStub,
      './ipLocationStore': storeStub,
      '../../lib/log': logStub,
    });
  }

  beforeEach(buildModule);
  afterEach(() => {
    // Safety net for the fake-clock tests below. Each restores its own clock in a
    // finally, but mocha abandons a timed-out test INSIDE its await, so that finally
    // never runs and the clock stays installed - the next useFakeTimers then throws
    // "Can't install fake timers twice" and one timeout is reported as two failures,
    // the second of them in an unrelated test. Restoring here cannot leak.
    if (typeof setTimeout.clock === 'object') setTimeout.clock.uninstall();
    return ipLocationSync.stopSync();
  });

  it('fetches the file the signed bundle names, from the signed source, and caches it', async () => {
    const replaced = await ipLocationSync.refresh();
    expect(replaced).to.equal(true);
    // The CONTENT-ADDRESSED name, not the mutable one. Asking for the digest is what makes
    // "served the wrong bytes" a 404 rather than a verification failure.
    expect(axiosGetStub.firstCall.args[0]).to.have.string(`/${FILE}`);
    expect(axiosGetStub.firstCall.args[0]).to.have.string('signed');
    expect(storeStub.setArtifact.calledOnce).to.equal(true);
    expect(repositoryStub.writeArtifactBytes.calledOnceWith('ipLocationTable', sinon.match.instanceOf(Buffer))).to.equal(true);
    const options = axiosGetStub.firstCall.args[1];
    expect(options.responseType).to.equal('arraybuffer');
    expect(options.timeout).to.equal(120000);
    expect(options.maxContentLength, 'the declared size is a ceiling too').to.equal(BYTES.length);
  });

  it('refuses bytes that do not hash to what the bundle signed', async () => {
    // The whole point. A source that answers 200 with something else - a compromised branch,
    // a proxy, a mirror serving a stale table - must not reach the store.
    // The same LENGTH deliberately, so it is the digest that refuses it and not the size
    // check standing in front - a test that cannot tell which guard fired proves neither.
    axiosGetStub.resolves({ status: 200, data: Buffer.from('GZIPPED BYTES') });
    const replaced = await ipLocationSync.refresh();
    expect(replaced).to.equal(false);
    expect(storeStub.setArtifact.called, 'nothing unverified reaches the store').to.equal(false);
    expect(repositoryStub.writeArtifactBytes.called).to.equal(false);
    expect(logStub.warn.args.some((a) => a[0].includes('hashes to'))).to.equal(true);
  });

  it('refuses bytes whose length disagrees with the bundle', async () => {
    const shorter = BYTES.subarray(0, BYTES.length - 1);
    policyStoreStub.getArtifact.returns({ file: FILE, sha256: sha(shorter), bytes: BYTES.length });
    axiosGetStub.resolves({ status: 200, data: shorter });
    const replaced = await ipLocationSync.refresh();
    expect(replaced, 'a correct digest does not excuse the wrong size').to.equal(false);
    expect(storeStub.setArtifact.called).to.equal(false);
  });

  it('does not fetch at all while no signed statement names the table', async () => {
    // Holding no bundle means holding nothing to check against, and an unverified table is
    // exactly what this exists to refuse. The retry brings it back once policy arrives.
    policyStoreStub.getArtifact.returns(null);
    const replaced = await ipLocationSync.refresh();
    expect(replaced).to.equal(false);
    expect(axiosGetStub.called, 'nothing was fetched').to.equal(false);
    expect(storeStub.setArtifact.called).to.equal(false);
  });

  it('does not refetch a table whose digest it already holds', async () => {
    await ipLocationSync.refresh();
    const replaced = await ipLocationSync.refresh();
    expect(replaced).to.equal(false);
    expect(axiosGetStub.calledOnce, 'the second refresh asked the source nothing').to.equal(true);
    expect(storeStub.setArtifact.calledOnce).to.equal(true);
    expect(repositoryStub.writeArtifactBytes.calledOnce).to.equal(true);
  });

  it('rejects a malformed artifact without displacing the cached copy', async () => {
    storeStub.setArtifact.rejects(new Error('iplocation artifact: bad magic'));
    const replaced = await ipLocationSync.refresh();
    expect(replaced).to.equal(false);
    expect(repositoryStub.writeArtifactBytes.called).to.equal(false);
    expect(logStub.warn.args.some((a) => a[0].includes('keeping current table'))).to.equal(true);
  });

  it('restores from the cache at start, and downloads nothing it already holds', async () => {
    repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', sha256: SHA, fetchedAt: 1 });
    repositoryStub.readArtifactBytes.resolves(Buffer.from('stored bytes'));
    await ipLocationSync.startSync();
    expect(repositoryStub.sweepOrphanedArtifacts.calledOnceWith('ipLocationTable')).to.equal(true);
    expect(storeStub.setArtifact.calledOnce).to.equal(true);
    expect(axiosGetStub.called, 'the stored digest is the one the bundle names').to.equal(false);
  });

  describe('restoreCachedTable - the half that only needs mongo', () => {
    it('brings the table back without fetching anything', async () => {
      // Started with the database schema prep, well before the app-database
      // rebuild. It must reach the table and touch the network for nothing, or
      // it is no longer the cheap half.
      storeStub.adoptPersistedStatus.resolves(true);
      storeStub.status.returns({ ready: true, generated: '2026-07-31T00:00:00Z', rowCount: 2126447 });
      repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', sha256: SHA, fetchedAt: 1 });

      await ipLocationSync.restoreCachedTable();
      await settle();

      expect(storeStub.adoptPersistedStatus.calledOnce).to.equal(true);
      expect(axiosGetStub.called).to.equal(false);
    });

    it('leaves the digest ready, so the fetch half has nothing to download', async () => {
      storeStub.adoptPersistedStatus.resolves(true);
      storeStub.status.returns({ ready: true, generated: '2026-07-31T00:00:00Z', rowCount: 2126447 });
      repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', sha256: SHA, fetchedAt: 1 });

      await ipLocationSync.restoreCachedTable();
      await ipLocationSync.startSync();

      expect(axiosGetStub.called, 'it already holds the digest the bundle names').to.equal(false);
    });

    it('is not repeated by startSync', async () => {
      repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', sha256: SHA, fetchedAt: 1 });
      repositoryStub.readArtifactBytes.resolves(Buffer.from('stored bytes'));
      axiosGetStub.resolves({ status: 304, data: null, headers: {} });

      await ipLocationSync.restoreCachedTable();
      await ipLocationSync.startSync();

      expect(storeStub.adoptPersistedStatus.calledOnce).to.equal(true);
      expect(storeStub.setArtifact.calledOnce).to.equal(true);
    });

    it('still restores when startSync is the only caller', async () => {
      // serviceManager runs both, but nothing may depend on that ordering.
      repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', sha256: SHA, fetchedAt: 1 });
      repositoryStub.readArtifactBytes.resolves(Buffer.from('stored bytes'));
      axiosGetStub.resolves({ status: 304, data: null, headers: {} });

      await ipLocationSync.startSync();

      expect(storeStub.setArtifact.calledOnce).to.equal(true);
    });
  });

  it('adopts the stored ingest and does not re-ingest the cached bytes', async () => {
    // the rows are already in mongo under the marker's baseline; the digest still comes from
    // the record, so the daily refresh finds it already holds what the bundle names
    storeStub.adoptPersistedStatus.resolves(true);
    storeStub.status.returns({ ready: true, generated: '2026-07-31T00:00:00Z', rowCount: 2126447 });
    repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', sha256: SHA, fetchedAt: 1 });
    repositoryStub.readArtifactBytes.resolves(Buffer.from('stored bytes'));

    await ipLocationSync.startSync();

    expect(repositoryStub.readArtifactBytes.called).to.equal(false);
    expect(storeStub.setArtifact.called).to.equal(false);
    expect(axiosGetStub.called, 'nothing to download').to.equal(false);
  });

  it('drops the etag when the stored copy is rejected, so the refetch is unconditional', async () => {
    repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', sha256: SHA, fetchedAt: 1 });
    repositoryStub.readArtifactBytes.resolves(Buffer.from('junk'));
    storeStub.setArtifact.onFirstCall().rejects(new Error('iplocation artifact: bad magic'));
    await ipLocationSync.startSync();
    expect(logStub.error.args.some((a) => a[0].includes('stored iplocation table rejected'))).to.equal(true);
    expect(axiosGetStub.firstCall.args[1].headers).to.equal(undefined);
    // the background refresh then installed the fetched copy
    expect(storeStub.setArtifact.calledTwice).to.equal(true);
  });

  it('carries an upgraded node across: cached JSON bytes are rejected and the binary artifact is fetched', async () => {
    // a node that ran the previous build cached the JSON artifact; this reader
    // throws on its magic, and the unconditional refetch brings the binary one
    storeStub.adoptPersistedStatus.resolves(false); // no ingest has ever run here
    repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', sha256: 'a'.repeat(64), fetchedAt: 1 });
    repositoryStub.readArtifactBytes.resolves(Buffer.from('{"format":1,"v4":[]}'));
    storeStub.setArtifact.onFirstCall().rejects(new Error('iplocation artifact: bad magic'));

    await ipLocationSync.startSync();
    await settle();

    expect(axiosGetStub.firstCall.args[0]).to.have.string(`/${FILE}`);
    expect(storeStub.setArtifact.calledTwice).to.equal(true);
    expect(repositoryStub.writeArtifactBytes.calledOnce).to.equal(true);
  });

  it('startSync is idempotent and survives a failed fetch', async () => {
    axiosGetStub.rejects(new Error('network down'));
    await ipLocationSync.startSync();
    await ipLocationSync.startSync();
    expect(repositoryStub.sweepOrphanedArtifacts.calledOnce).to.equal(true);
    expect(logStub.warn.args.some((a) => a[0].includes('keeping current table'))).to.equal(true);
  });

  it('still fetches when the cache read fails - a database blip must not cost the table', async () => {
    repositoryStub.getArtifactRecord.rejects(new Error('MongoServerSelectionError'));
    await ipLocationSync.startSync();
    expect(axiosGetStub.called).to.equal(true);
    expect(storeStub.setArtifact.called).to.equal(true);
    expect(logStub.warn.args.some((a) => a[0].includes('could not restore the cached table'))).to.equal(true);
  });

  // The fake-clock tests below drive hours of simulated time, and tickAsync yields
  // to the real event loop on every timer it fires. Their real-time cost therefore
  // tracks how busy the process is, not what they assert, so mocha's 2s default is
  // an arbitrary bound on them - one they exceed on a loaded box while testing
  // nothing about wall-clock speed.
  it('retries with backoff while the node holds no table, then stops', async function () {
    this.timeout(20000);
    const clock = sinon.useFakeTimers();
    try {
      axiosGetStub.rejects(new Error('dns not up yet'));
      await ipLocationSync.startSync();
      expect(axiosGetStub.callCount).to.equal(1);
      // 10m, 20m, 40m, 80m, 160m - each attempt waits twice as long
      const delays = [10, 20, 40, 80, 160];
      // eslint-disable-next-line no-restricted-syntax
      for (const [index, minutes] of delays.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await clock.tickAsync(minutes * 60 * 1000);
        expect(axiosGetStub.callCount).to.equal(index + 2);
      }
      // attempts are spent: no further retry, only the daily refresh remains
      await clock.tickAsync(6 * 60 * 60 * 1000);
      expect(axiosGetStub.callCount).to.equal(delays.length + 1);
    } finally {
      clock.restore();
    }
  });

  it('stops retrying as soon as a table is held', async function () {
    this.timeout(20000);
    const clock = sinon.useFakeTimers();
    try {
      axiosGetStub.rejects(new Error('dns not up yet'));
      await ipLocationSync.startSync();
      storeStub.status.returns({ ready: true, generated: '2026-07-31T00:00:00Z', rowCount: 2126447 });
      await clock.tickAsync(10 * 60 * 1000);
      const afterTable = axiosGetStub.callCount;
      await clock.tickAsync(60 * 60 * 1000);
      expect(axiosGetStub.callCount).to.equal(afterTable);
    } finally {
      clock.restore();
    }
  });

  it('remembers the digest of bytes it could not read, so the retry does not fetch them again', async () => {
    // A published artifact this build cannot parse never clears. Downloading it on every
    // refresh would have the whole fleet re-fetching the same unreadable file for ever.
    storeStub.setArtifact.rejects(new Error('unsupported format version 3'));
    await ipLocationSync.refresh();
    await ipLocationSync.refresh();
    expect(axiosGetStub.calledOnce, 'the same rejected digest is not downloaded twice').to.equal(true);
  });

  describe('node location maintenance', () => {
    it('refreshes the node locations after a fetched baseline is installed', async () => {
      await ipLocationSync.refresh();
      await settle();
      expect(fluxListStub.calledOnce).to.equal(true);
      expect(storeStub.refreshNodeLocations.calledOnceWith([{ ip: '80.95.213.209:16127' }])).to.equal(true);
    });

    it('refreshes the node locations after adopting the stored ingest', async () => {
      storeStub.adoptPersistedStatus.resolves(true);
      storeStub.status.returns({ ready: true, generated: '2026-07-31T00:00:00Z', rowCount: 2126447 });
      axiosGetStub.resolves({ status: 304, data: null, headers: {} });
      await ipLocationSync.startSync();
      await settle();
      expect(storeStub.refreshNodeLocations.called).to.equal(true);
      expect(storeStub.setArtifact.called).to.equal(false);
    });

    it('refreshes the node locations on the daily tick even when the artifact is unchanged', async () => {
      const clock = sinon.useFakeTimers();
      try {
        storeStub.adoptPersistedStatus.resolves(true);
        storeStub.status.returns({ ready: true, generated: '2026-07-31T00:00:00Z', rowCount: 2126447 });
        axiosGetStub.resolves({ status: 304, data: null, headers: {} });
        await ipLocationSync.startSync();
        const atBoot = storeStub.refreshNodeLocations.callCount;
        // the node list drifts while the table does not
        await clock.tickAsync(24 * 60 * 60 * 1000);
        expect(storeStub.refreshNodeLocations.callCount).to.be.greaterThan(atBoot);
      } finally {
        clock.restore();
      }
    });

    it('a failed node location pass never fails the artifact refresh', async () => {
      storeStub.refreshNodeLocations.rejects(new Error('MongoServerSelectionError'));
      const replaced = await ipLocationSync.refresh();
      await settle();
      expect(replaced).to.equal(true);
      expect(logStub.warn.args.some((a) => a[0].includes('node location refresh failed'))).to.equal(true);
    });
  });
});
