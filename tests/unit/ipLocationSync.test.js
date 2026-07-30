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
    tableStub = { setArtifact: sinon.stub() };
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
});
