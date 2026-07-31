const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('ipLocationSync tests', () => {
  let ipLocationSync;
  let axiosGetStub;
  let repositoryStub;
  let tableStub;
  let logStub;

  function buildModule() {
    axiosGetStub = sinon.stub().resolves({ status: 200, data: Buffer.from('{"ok":1}'), headers: { etag: '"v1"' } });
    repositoryStub = {
      getArtifactRecord: sinon.stub().resolves(null),
      readArtifactBytes: sinon.stub().resolves(null),
      writeArtifactBytes: sinon.stub().resolves(true),
      sweepOrphanedArtifacts: sinon.stub().resolves(0),
    };
    tableStub = { setArtifact: sinon.stub(), hasTable: sinon.stub().returns(false) };
    logStub = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
    ipLocationSync = proxyquire('../../ZelBack/src/services/appPlacement/ipLocationSync', {
      '../serviceHelper': { axiosGet: axiosGetStub },
      '../appDatabase/policyArtifactRepository': repositoryStub,
      './ipLocationTable': tableStub,
      '../../lib/log': logStub,
    });
  }

  beforeEach(buildModule);
  afterEach(() => ipLocationSync.stopSync());

  it('installs and caches a fetched artifact with its etag', async () => {
    const replaced = await ipLocationSync.refresh();
    expect(replaced).to.equal(true);
    expect(tableStub.setArtifact.calledOnce).to.equal(true);
    expect(repositoryStub.writeArtifactBytes.calledOnceWith('ipLocationTable', sinon.match.instanceOf(Buffer), '"v1"')).to.equal(true);
    const options = axiosGetStub.firstCall.args[1];
    expect(options.responseType).to.equal('arraybuffer');
    expect(options.timeout).to.equal(120000);
    expect(options.headers).to.equal(undefined); // no etag yet - unconditional
  });

  it('sends If-None-Match once an etag is held and treats 304 as no-op', async () => {
    await ipLocationSync.refresh();
    axiosGetStub.resolves({ status: 304, data: null, headers: {} });
    const replaced = await ipLocationSync.refresh();
    expect(replaced).to.equal(false);
    expect(axiosGetStub.secondCall.args[1].headers).to.eql({ 'If-None-Match': '"v1"' });
    expect(tableStub.setArtifact.calledOnce).to.equal(true); // not called again
    expect(repositoryStub.writeArtifactBytes.calledOnce).to.equal(true);
  });

  it('rejects a malformed artifact without displacing the cached copy', async () => {
    tableStub.setArtifact.throws(new Error('iplocation artifact: unsorted'));
    const replaced = await ipLocationSync.refresh();
    expect(replaced).to.equal(false);
    expect(repositoryStub.writeArtifactBytes.called).to.equal(false);
    expect(logStub.warn.args.some((a) => a[0].includes('keeping current table'))).to.equal(true);
  });

  it('restores from the cache at start and refreshes conditionally', async () => {
    repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', etag: '"stored"', fetchedAt: 1 });
    repositoryStub.readArtifactBytes.resolves(Buffer.from('{"cached":1}'));
    axiosGetStub.resolves({ status: 304, data: null, headers: {} });
    await ipLocationSync.startSync();
    expect(repositoryStub.sweepOrphanedArtifacts.calledOnceWith('ipLocationTable')).to.equal(true);
    expect(tableStub.setArtifact.calledOnce).to.equal(true);
    expect(axiosGetStub.firstCall.args[1].headers).to.eql({ 'If-None-Match': '"stored"' });
  });

  it('drops the etag when the stored copy is rejected, so the refetch is unconditional', async () => {
    repositoryStub.getArtifactRecord.resolves({ fileId: 'id1', etag: '"stored"', fetchedAt: 1 });
    repositoryStub.readArtifactBytes.resolves(Buffer.from('junk'));
    tableStub.setArtifact.onFirstCall().throws(new Error('unsupported format'));
    await ipLocationSync.startSync();
    expect(logStub.error.args.some((a) => a[0].includes('stored iplocation table rejected'))).to.equal(true);
    expect(axiosGetStub.firstCall.args[1].headers).to.equal(undefined);
    // the background refresh then installed the fetched copy
    expect(tableStub.setArtifact.calledTwice).to.equal(true);
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
    expect(tableStub.setArtifact.called).to.equal(true);
    expect(logStub.warn.args.some((a) => a[0].includes('could not restore the cached table'))).to.equal(true);
  });

  it('retries with backoff while the node holds no table, then stops', async () => {
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

  it('stops retrying as soon as a table is held', async () => {
    const clock = sinon.useFakeTimers();
    try {
      axiosGetStub.rejects(new Error('dns not up yet'));
      await ipLocationSync.startSync();
      tableStub.hasTable.returns(true);
      await clock.tickAsync(10 * 60 * 1000);
      const afterTable = axiosGetStub.callCount;
      await clock.tickAsync(60 * 60 * 1000);
      expect(axiosGetStub.callCount).to.equal(afterTable);
    } finally {
      clock.restore();
    }
  });

  it('remembers the etag of bytes it could not read, so the retry is a 304', async () => {
    tableStub.setArtifact.throws(new Error('unsupported format 2'));
    await ipLocationSync.refresh();
    axiosGetStub.resolves({ status: 304, data: Buffer.alloc(0), headers: {} });
    await ipLocationSync.refresh();
    expect(axiosGetStub.secondCall.args[1].headers['If-None-Match']).to.equal('"v1"');
  });
});
