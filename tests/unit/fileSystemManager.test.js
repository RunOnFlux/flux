const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
// The real registry: these tests assert the 202 contract, and a stub would let
// a broken handle shape through.
const jobRegistry = require('../../ZelBack/src/services/utils/jobRegistry');

describe('fileSystemManager tests', () => {
  const MOUNT = '/test/apps/folder/fluxcomp_myapp';
  // A real FluxID, because a session opened by an authenticated caller carries
  // one and the registry refuses a read that does not present it. Left off, the
  // job is registered ownerless and every read here is allowed - which is a
  // world these tests never run in.
  const OWNER = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';

  let fileSystemManager;
  let executorStub;
  let serviceHelperStub;
  let volumeSessionStub;
  let messageHelperStub;
  let sessionStub;
  let res;
  let req;

  // A VolumePath is opaque by design, so the stub mirrors the shape the
  // handlers actually use rather than being a bare string.
  const volumePath = (relative) => ({
    relative,
    containerPath: relative === '' ? '/work' : `/work/${relative}`,
    hostPath: relative === '' ? MOUNT : `${MOUNT}/${relative}`,
  });

  beforeEach(() => {
    sessionStub = {
      mount: MOUNT,
      identifier: 'fluxcomp_myapp',
      owner: OWNER,
      availableBytes: 1e9,
      resolve: sinon.stub().callsFake(async (p) => volumePath(p)),
      pair: sinon.stub().callsFake(async (source, destination) => ({
        source: volumePath(source),
        destination: volumePath(destination),
      })),
      staging: sinon.stub().returns(volumePath('.flux-op-abc')),
      measure: sinon.stub().resolves(1000),
      requireSpace: sinon.stub(),
      // Defaults to a volume with room, which is what every other test needs.
      // Left off, extract and upload would refuse before doing anything and the
      // assertions below would be made against the error branch.
      requireCapacity: sinon.stub(),
      // Defaults to a directory because that is the common case; the
      // single-file tests below flip it. A stub's default is a coverage
      // decision - left off entirely, compress would throw inside its try and
      // every assertion here would be made against the error branch.
      isDirectory: sinon.stub().resolves(true),
      parent: sinon.stub().callsFake((p) => {
        const at = p.relative.lastIndexOf('/');
        return volumePath(at === -1 ? '' : p.relative.slice(0, at));
      }),
    };

    // proxyquire.noCallThru() replaces a module WHOLE: anything the subject
    // imports and this object omits is undefined at the call, not at load. When
    // that call sits inside a try, nothing fails visibly and the test passes
    // having exercised the error branch. SPACE_HEADROOM is here because leaving
    // it out silently turned a byte ceiling into NaN.
    volumeSessionStub = {
      openVolume: sinon.stub().resolves(sessionStub),
      SPACE_HEADROOM: 1.05,
    };
    executorStub = { run: sinon.stub().resolves(), assertCapacity: sinon.stub() };
    serviceHelperStub = {
      ensureString: sinon.stub().callsFake((v) => JSON.stringify(v)),
      // Mirrors the real one: an object passes through, anything falsy
      // becomes {}. A stub returning undefined would make every body read
      // throw, and the throw is caught, so the tests would pass having
      // exercised nothing.
      ensureObject: sinon.stub().callsFake((v) => {
        if (typeof v === 'object' && v !== null) return v;
        if (!v) return {};
        try { return JSON.parse(v); } catch (e) { return {}; }
      }),
      // Never resolves, so an operation's own deadline never wins a race the
      // test did not mean to run. The one test about the deadline resolves it.
      delay: sinon.stub().returns(new Promise(() => {})),
    };

    messageHelperStub = {
      createSuccessMessage: sinon.stub().callsFake((message) => ({ status: 'success', data: { message } })),
      // Carries name and code as the real one does. A stub that keeps only the
      // message hides every contract a caller branches on - EEXIST among them.
      createErrorMessage: sinon.stub().callsFake((message, name, code) => ({ status: 'error', data: { code, name, message } })),
      errUnauthorizedMessage: sinon.stub().returns({ status: 'error', data: { message: 'Unauthorized' } }),
    };

    res = {
      json: sinon.stub(),
      write: sinon.stub(),
      end: sinon.stub(),
      headersSent: false,
      statusCode: 200,
      setHeader: sinon.stub(),
      status: sinon.stub().callsFake((code) => { res.statusCode = code; return res; }),
    };
    // The four long operations POST a JSON body; the three older endpoints
    // still take their operands as path params.
    req = { params: { appname: 'myapp', component: 'comp' }, query: {}, body: {} };

    fileSystemManager = proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
      '../messageHelper': messageHelperStub,
      '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
      '../serviceHelper': serviceHelperStub,
      '../IOUtils': { getVolumeInfo: sinon.stub() },
      '../../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
      '../utils/pathSecurity': { sanitizePath: sinon.stub(), verifyRealPath: sinon.stub() },
      './volumeSession': volumeSessionStub,
      './volumeExecutor': executorStub,
      '../utils/jobRegistry': jobRegistry,
      archiver: sinon.stub(),
      stream: { PassThrough: sinon.stub() },
    });
  });

  afterEach(() => {
    sinon.restore();
    jobRegistry.reset();
  });

  /** The body of the 202 a long operation answers with. */
  const acceptedBody = () => res.json.firstCall.args[0].data;

  /** Settle the not-awaited work the handler kicked off. */
  const settle = () => new Promise((resolve) => { setImmediate(resolve); });

  /** argv of the single executor call, with VolumePath operands as container paths. */
  const argv = () => executorStub.run.firstCall.args[1]
    .map((a) => (typeof a === 'string' ? a : a.containerPath));
  const runOptions = () => executorStub.run.firstCall.args[2];

  describe('createAppsFolder', () => {
    it('publishes a new directory under the name the caller asked for', async () => {
      req.params.folder = 'uploads/2026';
      await fileSystemManager.createAppsFolder(req, res);

      // No command at all: the folder is staging, and publishing it is the whole
      // operation.
      expect(argv()).to.deep.equal([]);
      expect(runOptions().mkdirStaging).to.equal(true);
      expect(runOptions().publish.destination.containerPath).to.equal('/work/uploads/2026');
      expect(res.json.firstCall.args[0].data.message).to.equal('Folder Created');
    });

    it('refuses an occupied name rather than replacing what is there', async () => {
      // The whole reason this is a publish rather than a mkdir. Without it the
      // rename would exchange the caller's folder for an empty one, and with a
      // look taken beforehand it would answer for a moment that has passed.
      req.params.folder = 'uploads';
      await fileSystemManager.createAppsFolder(req, res);

      expect(runOptions().noReplace).to.equal(true);
    });

    it('refuses without a folder', async () => {
      await fileSystemManager.createAppsFolder(req, res);
      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });
  });

  describe('renameAppsObject', () => {
    it('keeps the new name beside the old one', async () => {
      // The destination is built from the SOURCE's directory, so a caller
      // cannot relocate through this endpoint.
      req.params.oldpath = 'uploads/2026/photo.jpg';
      req.params.newname = 'holiday.jpg';
      await fileSystemManager.renameAppsObject(req, res);

      const [source, destination] = sessionStub.pair.firstCall.args;
      expect(source).to.equal('uploads/2026/photo.jpg');
      expect(destination).to.equal('uploads/2026/holiday.jpg');
    });

    it('still refuses a separator in the new name', async () => {
      req.params.oldpath = 'a.txt';
      req.params.newname = '../escape.txt';
      await fileSystemManager.renameAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.message).to.equal('New name is invalid');
    });

    it('publishes rather than running a command', async () => {
      req.params.oldpath = 'a.txt';
      req.params.newname = 'b.txt';
      await fileSystemManager.renameAppsObject(req, res);

      expect(argv()).to.deep.equal([]);
      expect(runOptions().publish.destination.containerPath).to.equal('/work/b.txt');
    });

    it('never overwrites, whatever the caller asks for', async () => {
      // Publishing over the destination exchanges the entries and removes what
      // was displaced. That removal is unbounded, and this endpoint answers
      // inline, so there is no flag that turns it on here - moveAppsObject is
      // the general form and runs as a job.
      req.params.oldpath = 'a.txt';
      req.params.newname = 'b.txt';
      req.query.overwrite = 'true';
      req.body = { overwrite: true };
      await fileSystemManager.renameAppsObject(req, res);

      expect(runOptions().noReplace).to.equal(true);
    });
  });

  describe('removeAppsObject', () => {
    it('removes the object', async () => {
      req.params.object = 'uploads/old.txt';
      await fileSystemManager.removeAppsObject(req, res);

      expect(argv()).to.deep.equal(['rm', '-rf', '/work/uploads/old.txt']);
    });

    it('requires the object to exist, so a typo is not reported as success', async () => {
      req.params.object = 'uploads/old.txt';
      await fileSystemManager.removeAppsObject(req, res);

      expect(sessionStub.resolve.firstCall.args[1]).to.deep.equal({ mustExist: true });
    });

    it('answers a quick remove inline, as it did before it was a job', async () => {
      // Two dashboards call this and neither polls. A delete of an ordinary
      // folder is sub-second, so what they have always received is what they
      // keep receiving.
      req.params.object = 'uploads/old.txt';

      await fileSystemManager.removeAppsObject(req, res);

      expect(res.statusCode).to.equal(200);
      expect(res.json.firstCall.args[0].status).to.equal('success');
    });

    it('reports a remove that failed as a failure, not as a success', async () => {
      // The inline answer is built from the job, and the job is owned by the
      // caller who opened the volume. Read without that owner the registry
      // refuses, the job comes back empty, and the answer falls through to a
      // hardcoded Succeeded - so the dashboard reports a delete that worked
      // while the object is still sitting there.
      req.params.object = 'uploads/old.txt';
      executorStub.run.rejects(new Error('File operation failed with exit code 2'));

      await fileSystemManager.removeAppsObject(req, res);

      // The job really did fail, so the assertions below are about how that is
      // reported rather than about the work never having run. The error body
      // carries no jobId, so it is read from the header that always carries it.
      const jobId = res.setHeader.getCalls().find((call) => call.args[0] === 'Operation-Id').args[1];
      expect(jobRegistry.get(jobId, OWNER).status).to.equal('Failed');
      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.equal('File operation failed with exit code 2');
    });

    it('hands over a job when the remove outlives its deadline', async () => {
      // rm -rf scales with the tree, and a request held open for an unbounded
      // one is killed by whatever proxy is in the way.
      req.params.object = 'uploads/enormous';
      executorStub.run = sinon.stub().returns(new Promise(() => {}));
      serviceHelperStub.delay.resolves();

      await fileSystemManager.removeAppsObject(req, res);

      expect(res.statusCode).to.equal(202);
      expect(res.setHeader.getCalls().map((call) => call.args[0])).to.include('Operation-Id');
    });
  });

  describe('moveAppsObject', () => {
    beforeEach(() => {
      req.body.source = 'uploads/photo.jpg';
      req.body.destination = 'archive/photo.jpg';
    });

    it('publishes the source at the destination, with no command and no copy', async () => {
      await fileSystemManager.moveAppsObject(req, res);

      expect(argv()).to.deep.equal([]);
      // `source`, never `staging`: it is the caller's only copy, and the name
      // is what tells the executor it may not be discarded on a failure.
      expect(runOptions().publish.staging).to.equal(undefined);
      expect(runOptions().publish.source.containerPath).to.equal('/work/uploads/photo.jpg');
      expect(runOptions().publish.destination.containerPath).to.equal('/work/archive/photo.jpg');
    });

    it('does not check capacity - a rename within one filesystem moves no bytes', async () => {
      await fileSystemManager.moveAppsObject(req, res);
      expect(sessionStub.requireSpace.called).to.equal(false);
    });

    it('lets the publish replace only when overwrite was explicitly asked for', async () => {
      // The verdict travels to the rename rather than being reached here. What
      // is at the destination is the application's to change while this request
      // is in flight, so the only truthful answer comes from the step that acts.
      await fileSystemManager.moveAppsObject(req, res);
      expect(runOptions().noReplace).to.equal(true);

      // A real JSON boolean, not the string a path segment could only ever be.
      executorStub.run.resetHistory();
      req.body.overwrite = true;
      await fileSystemManager.moveAppsObject(req, res);
      expect(runOptions().noReplace).to.equal(false);
    });
  });

  describe('copyAppsObject', () => {
    beforeEach(() => {
      req.body.source = 'uploads';
      req.body.destination = 'backup';
    });

    it('copies into staging and publishes the result', async () => {
      await fileSystemManager.copyAppsObject(req, res);

      expect(argv()).to.deep.equal(['cp', '-a', '-T', '/work/uploads', '/work/.flux-op-abc']);
      expect(runOptions().publish.destination.containerPath).to.equal('/work/backup');
    });

    it('checks capacity before starting', async () => {
      await fileSystemManager.copyAppsObject(req, res);

      expect(sessionStub.requireSpace.calledWith(1000)).to.equal(true);
      expect(sessionStub.requireSpace.calledBefore(executorStub.run)).to.equal(true);
    });

    it('runs nothing when the source does not fit', async () => {
      sessionStub.requireSpace.throws(new Error('Not enough free space: 2 bytes required, 1 bytes available'));
      await fileSystemManager.copyAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.message).to.match(/Not enough free space/);
    });

    it('carries a ceiling as well, because the measurement can read low', async () => {
      // measure() runs in the FluxOS process, which is an ordinary user off
      // ArcaneOS, and measureTree walks nothing under a directory it cannot
      // open. So the up-front check is an early refusal, not the guarantee -
      // the ceiling is applied by the container, which can read all of it.
      await fileSystemManager.copyAppsObject(req, res);

      expect(runOptions().maxBytes).to.be.closeTo(1e9 / 1.05, 1);
    });
  });

  describe('compressAppsObject', () => {
    beforeEach(() => {
      req.body.source = 'uploads';
    });

    it('writes a zip when the destination says .zip', async () => {
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(argv()).to.deep.equal(['zip', '-r', '-q', '-y', '/work/.flux-op-abc', '--', '.']);
    });

    it('writes a tarball when the destination says .tar.gz', async () => {
      req.body.destination = 'backup.tar.gz';
      await fileSystemManager.compressAppsObject(req, res);

      expect(argv()).to.deep.equal(['tar', '-czf', '/work/.flux-op-abc', '--', '.']);
    });

    it('archives a directory from inside itself, so its CONTENTS are at the top', async () => {
      // Absolute operands are what broke this: zip stores the whole path minus
      // its leading slash, so the archive carried a `work/` directory named
      // after an internal mount point, and extracting it did not give back what
      // was compressed.
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(runOptions().workingDir.containerPath).to.equal('/work/uploads');
      expect(argv()).to.not.include('/work/uploads');
    });

    it('archives a single file from its parent, naming just the file', async () => {
      // tar -C cannot be pointed at a non-directory, so this shape failed
      // outright for .tar.gz while the same request with .zip succeeded.
      sessionStub.isDirectory.resolves(false);
      req.body.source = 'uploads/notes.txt';
      req.body.destination = 'backup.tar.gz';
      await fileSystemManager.compressAppsObject(req, res);

      expect(runOptions().workingDir.containerPath).to.equal('/work/uploads');
      expect(argv()).to.deep.equal(['tar', '-czf', '/work/.flux-op-abc', '--', 'notes.txt']);
    });

    it('archives a single file at the volume root from the root', async () => {
      sessionStub.isDirectory.resolves(false);
      req.body.source = 'notes.txt';
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(runOptions().workingDir.containerPath).to.equal('/work');
      expect(argv()).to.deep.equal(['zip', '-r', '-q', '-y', '/work/.flux-op-abc', '--', 'notes.txt']);
    });

    it('carries a ceiling as well, because the measurement can read low', async () => {
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(runOptions().maxBytes).to.be.closeTo(1e9 / 1.05, 1);
    });

    it('hands a name beginning with a dash over as a name, not an option', async () => {
      // The component rule rejects only the separators and the control
      // characters, so a leading dash is a name someone may legitimately have.
      // Both archivers read one as a flag and refuse the request, so the
      // operand goes after `--`.
      sessionStub.isDirectory.resolves(false);
      req.body.source = '-dashfile.txt';
      req.body.destination = 'backup.tar.gz';
      await fileSystemManager.compressAppsObject(req, res);

      const args = argv();
      expect(args).to.deep.equal(['tar', '-czf', '/work/.flux-op-abc', '--', '-dashfile.txt']);
      expect(args.indexOf('--')).to.equal(args.indexOf('-dashfile.txt') - 1);
    });

    it('stores a symlink as a symlink rather than the file it points at', async () => {
      // Without -y, zip follows the link and copies the target's CONTENTS into
      // the archive - which tar and cp -a never do, and which turns a link the
      // extract side would refuse into ordinary content it accepts.
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(argv()).to.include('-y');
    });

    it('refuses an extension it cannot produce', async () => {
      req.body.destination = 'backup.rar';
      await fileSystemManager.compressAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.message).to.match(/must end in/);
    });

    it('accepts an extension in capitals', async () => {
      req.body.destination = 'BACKUP.ZIP';
      await fileSystemManager.compressAppsObject(req, res);

      expect(argv()[0]).to.equal('zip');
    });
  });

  describe('extractAppsObject', () => {
    beforeEach(() => {
      req.body.destination = 'restored';
    });

    it('unpacks a zip', async () => {
      req.body.source = 'backup.zip';
      await fileSystemManager.extractAppsObject(req, res);

      expect(argv()).to.deep.equal(['unzip', '-q', '/work/backup.zip', '-d', '/work/.flux-op-abc']);
    });

    it('refuses on a full volume rather than running with a ceiling of nothing', async () => {
      // How much an extraction writes cannot be known in advance, so the ceiling
      // is the only bound it has - and the ceiling IS the free space. At zero it
      // is indistinguishable from asking for no ceiling at all, which is what
      // both the executor and the image take it for.
      sessionStub.requireCapacity.throws(new Error('No free space on the application volume'));
      req.body.source = 'backup.zip';
      await fileSystemManager.extractAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('ignores the uids and modes a tarball claims', async () => {
      // Archive content is attacker-supplied: honouring its uids can make the
      // result unreadable to the app, and honouring its modes would let it
      // plant a setuid binary.
      req.body.source = 'backup.tar.gz';
      await fileSystemManager.extractAppsObject(req, res);

      expect(argv()).to.include('--no-same-owner');
      expect(argv()).to.include('--no-same-permissions');
    });

    it('caps the result at the free space on the volume, not at what the archive claims', async () => {
      // An archive's declared uncompressed size is written by whoever built it,
      // so a bomb understates itself. The ceiling is applied to what actually
      // lands, and it is what the volume can hold.
      req.body.source = 'backup.zip';
      await fileSystemManager.extractAppsObject(req, res);

      expect(runOptions().maxBytes).to.be.closeTo(1e9 / 1.05, 1);
    });

    it('refuses a result holding anything that is not ordinary data', async () => {
      req.body.source = 'backup.zip';
      await fileSystemManager.extractAppsObject(req, res);

      expect(runOptions().dataOnly).to.equal(true);
    });

    it('creates the staging directory, which tar -C and unzip -d both need', async () => {
      req.body.source = 'backup.zip';
      await fileSystemManager.extractAppsObject(req, res);

      expect(runOptions().mkdirStaging).to.equal(true);
    });

    it('refuses an extension it cannot read, rather than sniffing the content', async () => {
      req.body.source = 'payload.bin';
      await fileSystemManager.extractAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.message).to.match(/must be a \.zip/);
    });

    it('accepts an uploaded archive whose extension is in capitals', async () => {
      // Plenty of software writes BACKUP.ZIP. Refusing it with a message
      // listing the extension it plainly has reads as a broken endpoint.
      req.body.source = 'BACKUP.ZIP';
      await fileSystemManager.extractAppsObject(req, res);

      expect(argv()[0]).to.equal('unzip');
    });
  });

  describe('how an operation settles', () => {
    const jobIdOf = () => acceptedBody().jobId;

    it('is Succeeded when the work finished, even though a cancel was asked for', async () => {
      // Cancellation is cooperative: the flag is raised and the worker stops at
      // its next checkpoint. A cancel that arrives after the command has
      // already published lost the race - the destination HAS been replaced,
      // and for a move the source is already gone. Reporting Canceled there
      // tells the caller nothing happened, about the one operation where
      // something irreversibly did.
      executorStub.run.callsFake(async () => {
        jobRegistry.requestCancel(jobIdOf());
      });
      req.body = { source: 'photos', destination: 'copied' };
      await fileSystemManager.copyAppsObject(req, res);
      await settle();

      expect(jobRegistry.get(jobIdOf(), OWNER).status).to.equal('Succeeded');
    });

    it('is Canceled when the work actually stopped', async () => {
      // flux-op traps the signal and exits 143, so a cancel that took effect
      // reaches here as a throw rather than as a resolved operation.
      executorStub.run.callsFake(async () => {
        jobRegistry.requestCancel(jobIdOf());
        throw new Error('File operation failed with exit code 143');
      });
      req.body = { source: 'photos', destination: 'copied' };
      await fileSystemManager.copyAppsObject(req, res);
      await settle();

      expect(jobRegistry.get(jobIdOf(), OWNER).status).to.equal('Canceled');
    });

    it('is Failed when the work failed on its own', async () => {
      executorStub.run.rejects(new Error('File operation failed with exit code 2'));
      req.body = { source: 'photos', destination: 'copied' };
      await fileSystemManager.copyAppsObject(req, res);
      await settle();

      expect(jobRegistry.get(jobIdOf(), OWNER).status).to.equal('Failed');
    });
  });

  describe('operand transport', () => {
    it('reads the operands from a JSON body', async () => {
      req.body = { appname: 'myapp', component: 'comp', source: 'a', destination: 'b' };
      await fileSystemManager.copyAppsObject(req, res);

      const [source, destination] = sessionStub.pair.firstCall.args;
      expect(source).to.equal('a');
      expect(destination).to.equal('b');
    });

    it('treats a non-boolean overwrite as false', async () => {
      // Overwrite has to be asked for. An unparseable value must not be read as
      // consent to destroy something.
      req.body = { source: 'a', destination: 'b', overwrite: 'yes please' };
      await fileSystemManager.copyAppsObject(req, res);

      expect(runOptions().noReplace).to.equal(true);
    });

    it('accepts the string a form-encoded caller sends', async () => {
      req.body = { source: 'a', destination: 'b', overwrite: 'true' };
      await fileSystemManager.copyAppsObject(req, res);

      expect(runOptions().noReplace).to.equal(false);
    });
  });

  describe('error reporting', () => {
    it('reports an unauthorised caller without touching the volume', async () => {
      const unauthorized = new Error('Unauthorized. Access denied.');
      unauthorized.name = 'Unauthorized';
      unauthorized.code = 401;
      volumeSessionStub.openVolume.rejects(unauthorized);

      req.body.source = 'a';
      req.body.destination = 'b';
      await fileSystemManager.copyAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.message).to.match(/Unauthorized/);
    });

    it('records a failure against the job rather than the response', async () => {
      // The response left before the work did, so a failure has nowhere to be
      // reported except the job the caller is polling.
      executorStub.run.rejects(new Error('File operation failed with exit code 2'));

      req.body.source = 'a';
      req.body.destination = 'b';
      await fileSystemManager.copyAppsObject(req, res);
      await settle();

      expect(res.statusCode).to.equal(202);
      const view = jobRegistry.get(acceptedBody().jobId, OWNER);
      expect(view.status).to.equal('Failed');
      expect(view.error.detail).to.match(/exit code 2/);
    });

    it('answers 503 with a Retry-After when the node is already busy', async () => {
      // A caller refused before any work starts learns it now, rather than
      // registering an operation and polling to discover it never began.
      const busy = new Error('Another file operation is already running for fluxcomp_myapp');
      busy.kind = 'busy';
      busy.retryAfterMs = 5000;
      executorStub.assertCapacity.throws(busy);

      req.body.source = 'a';
      req.body.destination = 'b';
      await fileSystemManager.copyAppsObject(req, res);
      await settle();

      expect(res.statusCode).to.equal(503);
      expect(res.setHeader.calledWith('Retry-After', '5')).to.equal(true);
      // No job was registered: the refusal was decided before one existed, so
      // there is nothing left Running for a client to poll or for the registry
      // to hold forever.
      expect(res.json.firstCall.args[0].data.jobId).to.equal(undefined);
    });

    it('answers 202 with a job to poll', async () => {
      req.body.source = 'a';
      req.body.destination = 'b';
      await fileSystemManager.copyAppsObject(req, res);

      expect(res.statusCode).to.equal(202);
      expect(acceptedBody().jobId).to.match(/^op_/);
      expect(acceptedBody().statusUrl).to.equal(`/apps/operations/${acceptedBody().jobId}`);
      expect(acceptedBody().status).to.equal('Running');
      expect(res.setHeader.calledWith('Location', acceptedBody().statusUrl)).to.equal(true);
      expect(res.setHeader.calledWith('Retry-After', '2')).to.equal(true);
    });

    it('marks the job Succeeded once the work finishes', async () => {
      req.body.source = 'a';
      req.body.destination = 'b';
      await fileSystemManager.copyAppsObject(req, res);
      await settle();

      expect(jobRegistry.get(acceptedBody().jobId, OWNER).status).to.equal('Succeeded');
    });

    it('answers 202 for a move too, so paste is one shape whichever it was', async () => {
      req.body.source = 'a';
      req.body.destination = 'b';
      await fileSystemManager.moveAppsObject(req, res);

      expect(res.statusCode).to.equal(202);
      expect(acceptedBody().jobId).to.match(/^op_/);
    });
  });
});
