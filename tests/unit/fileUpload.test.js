const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { Readable, PassThrough } = require('node:stream');

// Receiving an upload, driven through a REAL multipart body and a real parser.
//
// Everything that matters here happens on the way out. The request holds the
// app's one operation slot for its whole duration, and the parser reports the
// body ending, giving up, or nothing at all depending on how it goes wrong - so
// a path that forgets to release leaves that app unable to run another
// operation for as long as FluxOS does, including creating a folder.
describe('fileSystemManager upload tests', () => {
  const MOUNT = '/test/apps/folder/fluxcomp_myapp';

  let fileSystemManager;
  let executorStub;
  let sessionStub;
  let release;
  let res;

  const volumePath = (relative) => ({
    relative,
    containerPath: relative === '' ? '/work' : `/work/${relative}`,
    hostPath: relative === '' ? MOUNT : `${MOUNT}/${relative}`,
  });

  // A real multipart body, so the parser does what it does in production
  // rather than what a stub says it does.
  const multipartRequest = (files, { folder = 'photos', filename = '' } = {}) => {
    const boundary = '----fluxuploadtest';
    const chunks = [];
    for (const [name, content] of Object.entries(files)) {
      chunks.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}"\r\n`
        + 'Content-Type: application/octet-stream\r\n\r\n',
      ));
      chunks.push(Buffer.from(content));
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const req = Readable.from([body]);
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    };
    req.params = {
      appname: 'myapp', component: 'comp', folder, type: 'volume', filename,
    };
    req.query = {};
    req.body = {};
    return req;
  };

  // Resolves however the response is concluded - a body that ended, or a
  // refusal answered before one started.
  const concluded = () => new Promise((resolve) => {
    res.end = sinon.stub().callsFake(() => resolve('ended'));
    res.json = sinon.stub().callsFake(() => resolve('answered'));
  });

  beforeEach(() => {
    sessionStub = {
      mount: MOUNT,
      identifier: 'fluxcomp_myapp',
      availableBytes: 1e9,
      resolve: sinon.stub().callsFake(async (p) => volumePath(p)),
      staging: sinon.stub().callsFake(() => volumePath('.flux-op-abc')),
      isDirectory: sinon.stub().resolves(true),
      // Defaults to a volume with room. Left off, every upload here would be
      // refused before a byte was read and the assertions would be made against
      // the error branch; the test below flips it to assert the refusal itself.
      requireCapacity: sinon.stub(),
    };

    release = sinon.stub();
    executorStub = {
      run: sinon.stub().resolves(),
      acquireSlot: sinon.stub().returns(release),
      assertCapacity: sinon.stub(),
    };

    res = {
      json: sinon.stub(),
      write: sinon.stub(),
      end: sinon.stub(),
      headersSent: false,
      statusCode: 200,
      setHeader: sinon.stub(),
      attachment: sinon.stub(),
      status: sinon.stub().callsFake((code) => { res.statusCode = code; return res; }),
    };

    fileSystemManager = proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
      '../messageHelper': {
        createSuccessMessage: sinon.stub().callsFake((message) => ({ status: 'success', data: { message } })),
        createErrorMessage: sinon.stub().callsFake((message) => ({ status: 'error', data: { message } })),
        errUnauthorizedMessage: sinon.stub().returns({ status: 'error', data: { message: 'Unauthorized' } }),
      },
      '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
      '../serviceHelper': {
        ensureString: sinon.stub().callsFake((v) => (typeof v === 'string' ? v : JSON.stringify(v))),
        ensureObject: sinon.stub().callsFake((v) => (typeof v === 'object' && v !== null ? v : {})),
      },
      '../IOUtils': { getVolumeInfo: sinon.stub() },
      '../../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
      // The REAL one. Rejecting a filename that would leave its folder is the
      // behaviour under test, and a stub would decide the answer.
      '../utils/pathSecurity': require('../../ZelBack/src/services/utils/pathSecurity'),
      './volumeSession': { openVolume: sinon.stub().resolves(sessionStub), SPACE_HEADROOM: 1.05 },
      './volumeExecutor': executorStub,
      '../utils/fileTransfer': { sendFile: sinon.stub().resolves() },
      archiver: sinon.stub(),
    });
  });

  afterEach(() => sinon.restore());

  it('receives a file and publishes it through the executor', async () => {
    const done = concluded();
    await fileSystemManager.uploadAppsFiles(multipartRequest({ 'notes.txt': 'hello' }), res);
    await done;

    expect(executorStub.run.callCount).to.equal(1);
    const [, argv, options] = executorStub.run.firstCall.args;
    // The ceiling is the volume's own free space less the headroom - pinned,
    // because an unpinned ceiling and no ceiling are indistinguishable here.
    expect(options.maxBytes).to.equal(Math.floor(1e9 / 1.05));
    expect(argv).to.deep.equal([]);
    expect(options.input, 'nothing was streamed in').to.not.equal(undefined);
    expect(options.publish.destination.relative).to.equal('photos/notes.txt');
    expect(options.slotHeld, 'the operation took a second slot').to.equal(true);
    expect(release.called, 'the slot was never released').to.equal(true);
  });

  // The whole request is one operation. A slot per file would refuse the
  // second, and no serialisation would put a container per file on the node at
  // once.
  it('takes one slot for a request carrying several files, and releases it once', async () => {
    const done = concluded();
    await fileSystemManager.uploadAppsFiles(
      multipartRequest({ 'one.txt': 'a', 'two.txt': 'b', 'three.txt': 'c' }),
      res,
    );
    await done;

    expect(executorStub.acquireSlot.callCount, 'more than one slot for one request').to.equal(1);
    expect(executorStub.run.callCount).to.equal(3);
    expect(release.callCount).to.equal(1);
  });

  it('names each file after its own form field', async () => {
    const done = concluded();
    await fileSystemManager.uploadAppsFiles(multipartRequest({ 'one.txt': 'a', 'two.txt': 'b' }), res);
    await done;

    const written = executorStub.run.getCalls().map((call) => call.args[2].publish.destination.relative);
    expect(written).to.deep.equal(['photos/one.txt', 'photos/two.txt']);
  });

  // The restore flow names the archive it uploads through the URL.
  it('lets an explicit filename parameter name the file', async () => {
    const done = concluded();
    await fileSystemManager.uploadAppsFiles(
      multipartRequest({ 'whatever.bin': 'x' }, { filename: 'restore.tar.gz' }),
      res,
    );
    await done;

    expect(executorStub.run.firstCall.args[2].publish.destination.relative)
      .to.equal('photos/restore.tar.gz');
  });

  // A filename that would leave its folder is refused - and the slot it was
  // holding has to come back, which is the part that went wrong: the parser
  // reports a body ending, and a request refused part way through does not
  // always get that far.
  it('releases the slot when a filename is refused, and the caller hears a refusal', async () => {
    const done = concluded();
    await fileSystemManager.uploadAppsFiles(multipartRequest({ '../../escaped.txt': 'x' }), res);
    const outcome = await done;

    expect(executorStub.run.called, 'a refused name reached the executor').to.equal(false);
    expect(release.called, 'the slot was leaked, and this app can run nothing else').to.equal(true);
    // The refusal must reach the caller AS a refusal - a refused upload
    // answered as a clean end reads as success in every client.
    expect(outcome).to.equal('answered');
    expect(res.json.firstCall.args[0].status).to.equal('error');
  });

  it('releases the slot when an operation fails, and reports the failure', async () => {
    executorStub.run.rejects(new Error('File operation failed (exit 3): over the limit'));

    const done = concluded();
    await fileSystemManager.uploadAppsFiles(multipartRequest({ 'toobig.bin': 'x' }), res);
    const outcome = await done;

    expect(release.called, 'the slot was leaked after a refused upload').to.equal(true);
    expect(outcome).to.equal('answered');
    expect(res.json.firstCall.args[0].status).to.equal('error');
    expect(res.json.firstCall.args[0].data.message).to.include('over the limit');
  });

  it('refuses a full volume before reading a byte', async () => {
    // What an upload writes is bounded only by the ceiling, and the ceiling IS
    // the volume's free space - which at zero is how "no ceiling" is spelled. So
    // it is refused up front rather than expressed as a limit nothing enforces,
    // and the slot goes back.
    sessionStub.requireCapacity.throws(new Error('No free space on the application volume'));

    const done = concluded();
    await fileSystemManager.uploadAppsFiles(multipartRequest({ 'a.txt': 'x' }), res);
    await done;

    expect(executorStub.run.called, 'a container was started for an upload with nowhere to go').to.equal(false);
    // Before the slot as well as before the body: an upload that cannot land
    // should not make the next one queue behind it.
    expect(executorStub.acquireSlot.called, 'a slot was taken by an upload that was refused').to.equal(false);
  });

  it('releases the slot when the client goes away part way through', async () => {
    // Never ends: the request stops mid-body, as a disconnect does.
    const req = new PassThrough();
    req.headers = {
      'content-type': 'multipart/form-data; boundary=----fluxuploadtest',
      'content-length': '9999',
    };
    req.params = { appname: 'myapp', component: 'comp', folder: 'photos' };
    req.query = {};
    req.body = {};

    const done = concluded();
    const handling = fileSystemManager.uploadAppsFiles(req, res);
    req.write('------fluxuploadtest\r\nContent-Disposition: form-data; name="a.txt"; filename="a.txt"\r\n\r\npart');
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    req.emit('aborted');

    await handling;
    await done;

    expect(release.called, 'the slot was leaked when the client disconnected').to.equal(true);
  });

  it('refuses before taking a slot when the caller is not the owner', async () => {
    fileSystemManager = proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
      '../messageHelper': {
        createErrorMessage: sinon.stub().callsFake((message, name, code) => ({ status: 'error', data: { message, name, code } })),
        createSuccessMessage: sinon.stub(),
        errUnauthorizedMessage: sinon.stub(),
      },
      '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(false) },
      '../serviceHelper': {
        ensureString: sinon.stub().callsFake((v) => JSON.stringify(v)),
        ensureObject: sinon.stub().callsFake((v) => (typeof v === 'object' && v !== null ? v : {})),
      },
      '../IOUtils': { getVolumeInfo: sinon.stub() },
      '../../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
      '../utils/pathSecurity': require('../../ZelBack/src/services/utils/pathSecurity'),
      './volumeSession': require('../../ZelBack/src/services/appSystem/volumeSession'),
      './volumeExecutor': executorStub,
      '../utils/fileTransfer': { sendFile: sinon.stub().resolves() },
      archiver: sinon.stub(),
    });

    const done = concluded();
    await fileSystemManager.uploadAppsFiles(multipartRequest({ 'sneaky.txt': 'x' }), res);
    await done;

    expect(executorStub.acquireSlot.called, 'a refused caller took a slot').to.equal(false);
    expect(res.json.firstCall.args[0].data.code).to.equal(401);
  });
});
