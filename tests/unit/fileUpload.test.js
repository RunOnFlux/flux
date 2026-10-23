const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { Readable, PassThrough, Writable } = require('node:stream');
const pathSecurity = require('../../ZelBack/src/services/utils/pathSecurity');

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

  const loadManager = (volumeOperations) => proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
    config: { fluxapps: { volumeOperations } },
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
    '../utils/pathSecurity': pathSecurity,
    './volumeSession': { openVolume: sinon.stub().resolves(sessionStub), SPACE_HEADROOM: 1.05 },
    './volumeExecutor': executorStub,
    '../utils/fileTransfer': { sendFile: sinon.stub().resolves() },
    archiver: sinon.stub(),
  });

  beforeEach(() => {
    sessionStub = {
      mount: MOUNT,
      identifier: 'fluxcomp_myapp',
      availableBytes: 1e9,
      resolve: sinon.stub().callsFake(async (p) => volumePath(p)),
      staging: sinon.stub().callsFake(() => volumePath('.flux-op-abc')),
      isDirectory: sinon.stub().resolves(true),
      parent: sinon.stub().callsFake((p) => volumePath(p.relative.includes('/') ? p.relative.slice(0, p.relative.lastIndexOf('/')) : '')),
      // Defaults to a volume with room. Left off, every upload here would be
      // refused before a byte was read and the assertions would be made against
      // the error branch; the test below flips it to assert the refusal itself.
      requireCapacity: sinon.stub(),
      // A copy this node may write to. The refusal is pinned below.
      refuseReadOnlyWrite: sinon.stub().resolves(),
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

    fileSystemManager = loadManager({ minUploadBitsPerSecond: 64 * 1000, stallTimeoutMs: 10 * 60 * 1000 });
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
    expect(options.inheritOwner, 'an upload would be owned by root, not by the app').to.equal(true);
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
  // A folder dropped into the file browser arrives as one request per file,
  // each naming a folder that may not exist yet. Made with a bare mkdir -p,
  // every new level was root's and every file inherited root from it, so an app
  // running as another user could not write inside the tree it was given.
  describe('into a folder that is not there yet', () => {
    const missingBelow = (existing) => {
      sessionStub.isDirectory.callsFake(async (p) => {
        if (existing.includes(p.relative)) return true;
        throw new Error(`${p.relative} does not exist`);
      });
    };

    it('makes the missing chain in one publish that takes the owner of the folder above it', async () => {
      missingBelow(['', 'appdata']);
      const req = multipartRequest({ 'fml.toml': 'x' }, { folder: 'appdata/config/neoforge' });

      const done = concluded();
      await fileSystemManager.uploadAppsFiles(req, res);
      await done;

      expect(executorStub.run.callCount, 'one container per level').to.equal(2);
      const [, argv, options] = executorStub.run.firstCall.args;
      // Built in staging and published at the highest missing level, so
      // flux-op's walk over staging re-owns every level, not only the top.
      expect(argv).to.deep.equal(['mkdir', '-p', '/work/.flux-op-abc/neoforge']);
      expect(options.publish.destination.relative).to.equal('appdata/config');
      expect(options.mkdirStaging).to.equal(true);
      expect(options.inheritOwner, 'the new folders would be root\'s').to.equal(true);
      expect(options.noReplace).to.equal(true);
      expect(options.slotHeld).to.equal(true);
      expect(sessionStub.resolve.calledWith('appdata/config'), 'the published name skipped the reserved-name checks').to.equal(true);
      expect(executorStub.run.secondCall.args[2].publish.destination.relative).to.equal('appdata/config/neoforge/fml.toml');
      expect(release.callCount).to.equal(1);
    });

    it('runs no command when only the folder itself is missing', async () => {
      missingBelow(['', 'config']);

      const done = concluded();
      await fileSystemManager.uploadAppsFiles(multipartRequest({ 'a.toml': 'x' }, { folder: 'config/new' }), res);
      await done;

      const [, argv, options] = executorStub.run.firstCall.args;
      expect(argv).to.deep.equal([]);
      expect(options.publish.destination.relative).to.equal('config/new');
      expect(executorStub.run.lastCall.args[2].publish.destination.relative).to.equal('config/new/a.toml');
    });

    it('refuses a reserved name in the volume root before starting anything', async () => {
      missingBelow(['']);
      sessionStub.resolve.callsFake(async (p) => {
        if (p === '.stversions') throw new Error('.stversions is not an application\'s to write');
        return volumePath(p);
      });

      const done = concluded();
      await fileSystemManager.uploadAppsFiles(multipartRequest({ 'a.toml': 'x' }, { folder: '.stversions/x' }), res);
      const outcome = await done;

      expect(executorStub.run.called).to.equal(false);
      expect(outcome).to.equal('answered');
      expect(release.called).to.equal(true);
    });

    it('makes what is still missing below a level something else made first', async () => {
      let made = false;
      sessionStub.isDirectory.callsFake(async (p) => {
        if (p.relative === '' || (made && p.relative === 'config')) return true;
        throw new Error(`${p.relative} does not exist`);
      });
      executorStub.run.onFirstCall().callsFake(async () => {
        made = true;
        throw Object.assign(new Error('Destination already exists'), { code: 'EEXIST' });
      });

      const done = concluded();
      await fileSystemManager.uploadAppsFiles(multipartRequest({ 'a.toml': 'x' }, { folder: 'config/sub' }), res);
      await done;

      expect(executorStub.run.getCalls().map((call) => call.args[2].publish.destination.relative))
        .to.deep.equal(['config', 'config/sub', 'config/sub/a.toml']);
      expect(res.json.called, 'the upload was refused').to.equal(false);
    });

    it('refuses when the folder could not be made, and releases the slot', async () => {
      missingBelow(['']);
      executorStub.run.onFirstCall().rejects(Object.assign(new Error('Destination already exists'), { code: 'EEXIST' }));

      const done = concluded();
      await fileSystemManager.uploadAppsFiles(multipartRequest({ 'a.toml': 'x' }, { folder: 'config' }), res);
      const outcome = await done;

      expect(executorStub.run.callCount, 'a file was written below a folder that was never made').to.equal(1);
      expect(outcome).to.equal('answered');
      expect(release.called).to.equal(true);
    });
  });

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

  it('refuses an upload into a read-only copy before reading a byte', async () => {
    const readOnly = Object.assign(new Error('This node holds a read-only copy of this app\'s data, which follows the node running the app. Make changes on that node.'), { name: 'ReadOnlyCopy', code: 409 });
    sessionStub.refuseReadOnlyWrite.rejects(readOnly);

    const done = concluded();
    await fileSystemManager.uploadAppsFiles(multipartRequest({ 'a.txt': 'x' }), res);
    await done;

    expect(sessionStub.refuseReadOnlyWrite.firstCall.args.map((p) => p.relative)).to.deep.equal(['photos']);
    expect(executorStub.run.called).to.equal(false);
    expect(executorStub.acquireSlot.called).to.equal(false);
    expect(res.json.firstCall.args[0].data.message).to.include('read-only copy');
  });

  // The real session on a real disk, on a standby: what decides is where the
  // upload folder POINTS, and only a disk has links to point anywhere.
  describe('on a copy that follows another node', () => {
    const os = require('node:os');
    const nodePath = require('node:path');
    const realFs = require('node:fs/promises');
    let tmpRoot;
    let mount;

    const onStandby = () => {
      const volumeSession = proxyquire('../../ZelBack/src/services/appSystem/volumeSession', {
        '../deviceHelper': {
          listMountedFilesystems: sinon.stub().resolves([{
            source: '/dev/loop3', target: mount, fstype: 'ext4', sizeBytes: 2e9, usedBytes: 1e9, availableBytes: 1e9, usePercent: 50,
          }]),
        },
        '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
        '../utils/pathSecurity': pathSecurity,
        '../utils/appConstants': {
          appsFolder: `${tmpRoot}/`,
          APP_NAME_REGEX: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
          APP_NAME_REGEX_LEGACY: /^[a-zA-Z0-9]+$/,
        },
        '../syncthingService': { getConfigFolders: sinon.stub().resolves([{ id: 'fluxcomp_myapp', type: 'receiveonly' }]) },
      });
      return proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
        config: { fluxapps: { volumeOperations: { minUploadBitsPerSecond: 64 * 1000, stallTimeoutMs: 10 * 60 * 1000 } } },
        '../messageHelper': {
          createSuccessMessage: sinon.stub().callsFake((message) => ({ status: 'success', data: { message } })),
          createErrorMessage: sinon.stub().callsFake((message, name, code) => ({ status: 'error', data: { message, name, code } })),
          errUnauthorizedMessage: sinon.stub(),
        },
        '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
        '../serviceHelper': {
          ensureString: sinon.stub().callsFake((v) => (typeof v === 'string' ? v : JSON.stringify(v))),
          ensureObject: sinon.stub().callsFake((v) => (typeof v === 'object' && v !== null ? v : {})),
        },
        '../IOUtils': { getVolumeInfo: sinon.stub() },
        '../../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
        '../utils/pathSecurity': pathSecurity,
        './volumeSession': volumeSession,
        './volumeExecutor': executorStub,
        '../utils/fileTransfer': { sendFile: sinon.stub().resolves() },
        archiver: sinon.stub(),
      });
    };

    beforeEach(async () => {
      tmpRoot = await realFs.mkdtemp(nodePath.join(os.tmpdir(), 'fluxupload-'));
      mount = nodePath.join(tmpRoot, 'fluxcomp_myapp');
      await realFs.mkdir(nodePath.join(mount, 'appdata'), { recursive: true });
      await realFs.mkdir(nodePath.join(mount, 'backup'), { recursive: true });
      await realFs.symlink('../appdata', nodePath.join(mount, 'backup', 'in'));
    });

    afterEach(async () => {
      if (tmpRoot) await realFs.rm(tmpRoot, { recursive: true, force: true });
    });

    const upload = async (folder) => {
      const done = concluded();
      await onStandby().uploadAppsFiles(multipartRequest({ 'world.sav': 'x' }, { folder }), res);
      await done;
    };

    it('refuses an upload into a folder that is a link into appdata', async () => {
      await upload('backup/in');

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.code).to.equal(409);
    });

    it('refuses an upload into a missing folder below such a link', async () => {
      await upload('backup/in/new/deeper');

      expect(executorStub.run.called, 'mkdir -p would have created appdata/new/deeper').to.equal(false);
      expect(res.json.firstCall.args[0].data.code).to.equal(409);
    });

    it('takes an upload into backup/, which never leaves the node', async () => {
      await upload('backup/upload');

      expect(executorStub.run.called).to.equal(true);
    });
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

  // Answering the caller is the last step of every way an upload settles, inside a
  // promise chain, so a response that cannot be sent must not become a rejection.
  it('settles when the refusal itself cannot be sent', async () => {
    const escaped = [];
    const onRejection = (reason) => escaped.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      executorStub.run.rejects(new Error('File operation failed (exit 3): over the limit'));
      res.json = sinon.stub().throws(new Error('the socket is gone'));

      await fileSystemManager.uploadAppsFiles(multipartRequest({ 'toobig.bin': 'x' }), res);
      await new Promise((resolve) => { setTimeout(resolve, 100); });

      expect(res.json.called, 'the refusal was never attempted, so nothing could have thrown').to.equal(true);
      expect(escaped.map((reason) => reason?.message ?? reason), 'a rejection escaped the upload').to.deep.equal([]);
      expect(release.callCount, 'the slot is released exactly once').to.equal(1);
    } finally {
      process.removeListener('unhandledRejection', onRejection);
    }
  });

  // The executor stops a sender below its own floor, and while that operation is
  // still settling the request's floor stops it too. That second stop reaches the
  // parser, whose promise rejects with it - and an unhandled rejection exits FluxOS.
  it('settles an upload the request floor stops while the executor is still stopping it', async function () {
    this.timeout(10000);
    const escaped = [];
    const onRejection = (reason) => escaped.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      executorStub.run.callsFake(async (volume, argv, { input }) => {
        input.pipe(new Writable({ write: (chunk, encoding, done) => done() }), { end: false });
        // Still settling its own stop when the request floor fires.
        await new Promise((resolve) => { setTimeout(resolve, 400); });
        throw new Error('The upload did not complete');
      });
      fileSystemManager = loadManager({ minUploadBitsPerSecond: 64 * 1000, stallTimeoutMs: 100 });

      const req = new PassThrough();
      req.headers = {
        'content-type': 'multipart/form-data; boundary=----fluxuploadtest',
        'content-length': '9999',
      };
      req.params = { appname: 'myapp', component: 'comp', folder: 'photos' };
      req.query = {};
      req.body = {};

      const done = concluded();
      fileSystemManager.uploadAppsFiles(req, res);
      req.write('------fluxuploadtest\r\nContent-Disposition: form-data; name="slow.txt"; filename="slow.txt"\r\n'
        + 'Content-Type: application/octet-stream\r\n\r\np');
      await done;
      // A rejection is reported after the turn that produced it.
      await new Promise((resolve) => { setTimeout(resolve, 500); });

      expect(executorStub.run.called, 'the upload never reached the executor, so nothing was stopping it').to.equal(true);
      expect(escaped.map((reason) => reason?.message ?? reason), 'a rejection escaped the upload').to.deep.equal([]);
      expect(release.callCount, 'the slot is released exactly once').to.equal(1);
    } finally {
      process.removeListener('unhandledRejection', onRejection);
    }
  });

  it('refuses before taking a slot when the caller is not the owner', async () => {
    fileSystemManager = proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
      config: { fluxapps: { volumeOperations: { minUploadBitsPerSecond: 64 * 1000, stallTimeoutMs: 10 * 60 * 1000 } } },
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

  // The slot floor: the executor's rate floor only governs a file part's body,
  // so a request that sends no file part held its slot until the 2h request
  // timeout. startSlotFloor applies the same floor to the whole request.
  describe('startSlotFloor', () => {
    let clock;

    beforeEach(() => { clock = sinon.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); });
    afterEach(() => { clock.restore(); });

    const floor = (getBytes, onStall) => fileSystemManager.startSlotFloor({
      minBitsPerSecond: 64 * 1000, windowMs: 1000, getBytes, onStall,
    });
    // 64 kbit/s over a 1s window is 8000 bytes.

    it('reclaims a slot that received nothing in a window', () => {
      const onStall = sinon.stub();
      floor(() => 0, onStall);
      clock.tick(1000);
      sinon.assert.calledOnce(onStall);
    });

    it('reclaims a slot dribbling just under the floor', () => {
      let bytes = 0;
      const onStall = sinon.stub();
      floor(() => bytes, onStall);
      bytes = 7999;
      clock.tick(1000);
      sinon.assert.calledOnce(onStall);
    });

    it('leaves a slot sending at or above the floor', () => {
      let bytes = 0;
      const onStall = sinon.stub();
      floor(() => bytes, onStall);
      for (let i = 0; i < 5; i += 1) { bytes += 8000; clock.tick(1000); }
      sinon.assert.notCalled(onStall);
    });

    it('is a no-op when the floor is disabled', () => {
      const onStall = sinon.stub();
      fileSystemManager.startSlotFloor({
        minBitsPerSecond: 0, windowMs: 1000, getBytes: () => 0, onStall,
      });
      clock.tick(10000);
      sinon.assert.notCalled(onStall);
    });

    it('stops watching once stopped', () => {
      const onStall = sinon.stub();
      const stop = floor(() => 0, onStall);
      stop();
      clock.tick(5000);
      sinon.assert.notCalled(onStall);
    });
  });

  it('reclaims the slot of an upload that holds it without sending at the floor', async () => {
    // The DoS: a valid request that sends only the multipart preamble - no file
    // part - kept the executor's body floor from ever engaging, so the slot was
    // held until the 2h request timeout. The request-level floor releases it.
    const clock = sinon.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const req = new PassThrough();
      req.headers = {
        'content-type': 'multipart/form-data; boundary=----fluxuploadtest',
        'content-length': '99999999',
      };
      req.params = { appname: 'myapp', component: 'comp', folder: 'photos' };
      req.query = {};
      req.body = {};

      const done = concluded();
      const handling = fileSystemManager.uploadAppsFiles(req, res);
      // Only the preamble, far below the floor, and then silence.
      req.write('------fluxuploadtest\r\nContent-Disposition: form-data; name="x"; filename="x"\r\n\r\n');
      await new Promise((resolve) => { setImmediate(resolve); });
      // One floor window elapses (stallTimeoutMs from the real config).
      clock.tick(10 * 60 * 1000);
      await new Promise((resolve) => { setImmediate(resolve); });

      await handling;
      await done;

      expect(release.called, 'a stalled upload kept its slot').to.equal(true);
    } finally {
      clock.restore();
    }
  });
});
