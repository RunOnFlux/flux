const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
// The real registry: these tests assert the 202 contract, and a stub would let
// a broken handle shape through.
const jobRegistry = require('../../ZelBack/src/services/utils/jobRegistry');
const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');

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
      // Names the staging entry after the destination's basename, so the tool
      // writes the exact name flux-op then inspects (zip appends .zip to an
      // extensionless name).
      stagingDir: sinon.stub().callsFake((destination) => ({
        directory: volumePath('.flux-op-abc'),
        entry: volumePath(`.flux-op-abc/${destination.relative.split('/').pop()}`),
      })),
      measure: sinon.stub().resolves(1000),
      requireSpace: sinon.stub(),
      // Defaults to a volume with room, which is what every other test needs.
      // Left off, extract, compress and upload would refuse before doing
      // anything and the assertions below would be made against the error
      // branch.
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
      '../utils/pathSecurity': { sanitizePath: sinon.stub(), verifyRealPathOfExistingPath: sinon.stub() },
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

    it('removes an object that is already gone as a success, idempotently', async () => {
      // rm -rf exits 0 on a missing path, so a delete of something already gone
      // - a client retrying after a timeout above all - answers success rather
      // than "does not exist". Existence is NOT required: resolve here is asked
      // WITHOUT mustExist, so a stub that would refuse a missing path never
      // fires, and the idempotent rm runs.
      req.params.object = 'uploads/gone.txt';
      sessionStub.resolve = sinon.stub().callsFake(async (p, opts) => {
        if (opts && opts.mustExist) throw new Error('Source does not exist');
        return volumePath(p);
      });

      await fileSystemManager.removeAppsObject(req, res);

      expect(executorStub.run.called, 'the delete was refused instead of running idempotently').to.equal(true);
      expect(argv()).to.deep.equal(['rm', '-rf', '/work/uploads/gone.txt']);
      expect(res.json.firstCall.args[0].status).to.equal('success');
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

      expect(argv()).to.deep.equal(['zip', '-r', '-q', '-y', '-MM', '/work/.flux-op-abc/backup.zip', '--', '.']);
    });

    it('writes a tarball when the destination says .tar.gz', async () => {
      req.body.destination = 'backup.tar.gz';
      await fileSystemManager.compressAppsObject(req, res);

      expect(argv()).to.deep.equal(['tar', '-czf', '/work/.flux-op-abc/backup.tar.gz', '--', '.']);
    });

    it('stages the archive inside a minted directory, so scratch lands there too', async () => {
      // Info-ZIP builds the archive in a temp file in the OUTPUT's directory.
      // At the volume root that temp - ziXXXXXX, outside the shape the sweep
      // may delete - survived a SIGKILL forever, replicated mid-write, and sat
      // in the owner's listing. Inside the minted directory, the temp, a
      // partial archive and the entry are one reclaim.
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(runOptions().publish.staging.containerPath).to.equal('/work/.flux-op-abc/backup.zip');
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
      expect(argv()).to.deep.equal(['tar', '-czf', '/work/.flux-op-abc/backup.tar.gz', '--', 'notes.txt']);
    });

    it('archives a single file at the volume root from the root', async () => {
      sessionStub.isDirectory.resolves(false);
      req.body.source = 'notes.txt';
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(runOptions().workingDir.containerPath).to.equal('/work');
      expect(argv()).to.deep.equal(['zip', '-r', '-q', '-y', '-MM', '/work/.flux-op-abc/backup.zip', '--', 'notes.txt']);
    });

    it('bounds the archive by the byte ceiling, without measuring the source', async () => {
      // Walking the source would be work in the FluxOS process, ahead of any
      // capacity slot, in proportion to a tree the app shapes.
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(runOptions().maxBytes).to.be.closeTo(1e9 / 1.05, 1);
      expect(sessionStub.measure.called).to.equal(false);
      expect(sessionStub.requireSpace.called).to.equal(false);
    });

    it('refuses on a full volume rather than running with a ceiling of nothing', async () => {
      sessionStub.requireCapacity.throws(new Error('No free space on the application volume'));
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.message).to.equal('No free space on the application volume');
    });

    it('names a single file called `-` to zip as ./-', async () => {
      sessionStub.isDirectory.resolves(false);
      req.body.source = 'uploads/-';
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(argv()).to.deep.equal(['zip', '-r', '-q', '-y', '-MM', '/work/.flux-op-abc/backup.zip', '--', './-']);
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
      expect(args).to.deep.equal(['tar', '-czf', '/work/.flux-op-abc/backup.tar.gz', '--', '-dashfile.txt']);
      expect(args.indexOf('--')).to.equal(args.indexOf('-dashfile.txt') - 1);
    });

    it('fails a zip whose named operand is missing, as tar does', async () => {
      // zip skips an operand it cannot find, warns, and exits 0 - so a listed
      // entry the application removed after it was resolved would be missing
      // from an archive reported as a success.
      req.body.source = ['uploads/a.txt', 'uploads/b.txt'];
      req.body.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(argv()).to.include('-MM');
      expect(argv().indexOf('-MM')).to.be.lessThan(argv().indexOf('--'));
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

    describe('a list of sources', () => {
      beforeEach(() => {
        req.body.destination = 'data/selection.zip';
      });

      it('archives each entry by name, from the folder they share', async () => {
        req.body.source = ['data/saves', 'data/notes.txt'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(runOptions().workingDir.containerPath).to.equal('/work/data');
        expect(argv()).to.deep.equal(['zip', '-r', '-q', '-y', '-MM', '/work/.flux-op-abc/selection.zip', '--', 'saves', 'notes.txt']);
      });

      it('hands tar the same operands', async () => {
        req.body.source = ['data/saves', 'data/notes.txt'];
        req.body.destination = 'data/selection.tar.gz';
        await fileSystemManager.compressAppsObject(req, res);

        expect(argv()).to.deep.equal(['tar', '-czf', '/work/.flux-op-abc/selection.tar.gz', '--', 'saves', 'notes.txt']);
      });

      it('archives a directory in a list of one as that directory, not its contents', async () => {
        // isDirectory answers true here, which a single `source` would turn into
        // `.` run from inside the directory. A list names entries, so the
        // directory itself is the operand.
        req.body.source = ['data/saves'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(runOptions().workingDir.containerPath).to.equal('/work/data');
        expect(argv().slice(-2)).to.deep.equal(['--', 'saves']);
      });

      it('runs from the volume root for entries at the root', async () => {
        req.body.source = ['saves', 'notes.txt'];
        req.body.destination = 'selection.zip';
        await fileSystemManager.compressAppsObject(req, res);

        expect(runOptions().workingDir.containerPath).to.equal('/work');
        expect(argv().slice(-3)).to.deep.equal(['--', 'saves', 'notes.txt']);
      });

      it('pairs every entry with the destination, so each gets the pair guards', async () => {
        req.body.source = ['data/saves', 'data/notes.txt'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(sessionStub.pair.args).to.deep.equal([
          ['data/saves', 'data/selection.zip'],
          ['data/notes.txt', 'data/selection.zip'],
        ]);
      });

      it('refuses when any entry fails its pair guard', async () => {
        sessionStub.pair.withArgs('data/notes.txt').rejects(new Error('data/notes.txt does not exist'));
        req.body.source = ['data/saves', 'data/notes.txt'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(executorStub.run.called).to.equal(false);
        expect(res.json.firstCall.args[0].data.message).to.equal('data/notes.txt does not exist');
      });

      it('measures none of the entries, and checks capacity once', async () => {
        req.body.source = ['data/saves', 'data/notes.txt'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(executorStub.run.calledOnce).to.equal(true);
        expect(sessionStub.measure.called).to.equal(false);
        expect(sessionStub.requireCapacity.calledOnce).to.equal(true);
        expect(sessionStub.requireCapacity.calledBefore(executorStub.run)).to.equal(true);
      });

      it('hands names beginning with a dash over after `--`', async () => {
        req.body.source = ['data/-a.txt', 'data/-b.txt'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(argv().slice(-3)).to.deep.equal(['--', '-a.txt', '-b.txt']);
      });

      it('carries overwrite to the publish', async () => {
        req.body.source = ['data/saves', 'data/notes.txt'];
        req.body.overwrite = true;
        await fileSystemManager.compressAppsObject(req, res);

        expect(runOptions().noReplace).to.equal(false);
      });

      it('archives entries from different folders by their paths from the volume root', async () => {
        req.body.source = ['mods/config.ini', 'readme.txt', 'saves', 'logs/server.log'];
        req.body.destination = 'selection.tar.gz';
        await fileSystemManager.compressAppsObject(req, res);

        expect(runOptions().workingDir.containerPath).to.equal('/work');
        expect(argv().slice(-5)).to.deep.equal(['--', 'mods/config.ini', 'readme.txt', 'saves', 'logs/server.log']);
      });

      it('runs from the deepest folder holding every entry', async () => {
        req.body.source = ['data/logs/a.txt', 'data/saves/world/b.dat', 'data/notes.txt'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(runOptions().workingDir.containerPath).to.equal('/work/data');
        expect(argv().slice(-4)).to.deep.equal(['--', 'logs/a.txt', 'saves/world/b.dat', 'notes.txt']);
      });

      it('does not read a sibling that shares a prefix as a folder holding the others', async () => {
        // `data/log` is not inside `data/lo`, so the working directory has to
        // climb to `data` rather than stop at a string prefix.
        req.body.source = ['data/lo/a.txt', 'data/log/b.txt'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(runOptions().workingDir.containerPath).to.equal('/work/data');
        expect(argv().slice(-3)).to.deep.equal(['--', 'lo/a.txt', 'log/b.txt']);
      });

      it('refuses an entry inside another listed entry', async () => {
        req.body.source = ['saves', 'readme.txt', 'saves/world/level.dat'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(executorStub.run.called).to.equal(false);
        expect(res.json.firstCall.args[0].data.message).to.equal('saves/world/level.dat is inside saves, which is also listed');
      });

      it('names an entry called `-` to zip as ./- so it is not read as standard input', async () => {
        req.body.source = ['data/-', 'data/notes.txt'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(argv().slice(-3)).to.deep.equal(['--', './-', 'notes.txt']);
      });

      it('hands tar an entry called `-` unchanged, since tar reads it as a name', async () => {
        req.body.source = ['data/-', 'data/notes.txt'];
        req.body.destination = 'data/selection.tar.gz';
        await fileSystemManager.compressAppsObject(req, res);

        expect(argv().slice(-3)).to.deep.equal(['--', '-', 'notes.txt']);
      });

      it('accepts a list of MAX_ARCHIVE_SOURCES entries', async () => {
        req.body.source = Array.from({ length: 1000 }, (_, i) => `data/f${i}`);
        await fileSystemManager.compressAppsObject(req, res);

        expect(sessionStub.pair.callCount).to.equal(1000);
        expect(executorStub.run.calledOnce).to.equal(true);
      });

      it('refuses a list longer than MAX_ARCHIVE_SOURCES before resolving any of it', async () => {
        req.body.source = Array.from({ length: 1001 }, (_, i) => `data/f${i}`);
        await fileSystemManager.compressAppsObject(req, res);

        expect(sessionStub.pair.called).to.equal(false);
        expect(executorStub.run.called).to.equal(false);
        expect(res.json.firstCall.args[0].data.message).to.match(/at most 1000 entries/);
      });

      it('resolves the entries one at a time', async () => {
        // Resolving is filesystem work on the thread pool every request shares,
        // so a list must not queue all of it at once.
        let inFlight = 0;
        let mostInFlight = 0;
        sessionStub.pair.callsFake(async (source, destination) => {
          inFlight += 1;
          mostInFlight = Math.max(mostInFlight, inFlight);
          await new Promise((resolve) => { setImmediate(resolve); });
          inFlight -= 1;
          return { source: volumePath(source), destination: volumePath(destination) };
        });
        req.body.source = ['data/a', 'data/b', 'data/c'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(sessionStub.pair.callCount).to.equal(3);
        expect(mostInFlight).to.equal(1);
      });

      it('refuses an entry listed twice', async () => {
        req.body.source = ['data/saves', 'data/notes.txt', 'data/saves'];
        await fileSystemManager.compressAppsObject(req, res);

        expect(executorStub.run.called).to.equal(false);
        expect(res.json.firstCall.args[0].data.message).to.equal('data/saves is listed more than once');
      });

      for (const [label, source] of [['an empty list', []], ['an entry that is not a path', ['data/saves', 7]], ['an empty entry', ['data/saves', '']]]) {
        it(`refuses ${label}`, async () => {
          req.body.source = source;
          await fileSystemManager.compressAppsObject(req, res);

          expect(executorStub.run.called).to.equal(false);
          expect(sessionStub.pair.called).to.equal(false);
          expect(res.json.firstCall.args[0].data.message).to.equal('source must be a path or a non-empty list of paths');
        });
      }
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

  // Both downloads resolve the path before touching it, and resolution is held
  // to the deepest part that exists: a name that has not been created yet
  // cannot be resolved, and a check that reads "cannot resolve" as "nothing to
  // verify" never sees the directory above it leading out of the volume.
  //
  // The real pathSecurity, because a stubbed one proves only that something was
  // called - and each handler asserted separately, because each resolves for
  // itself.
  describe('a download whose existing parent leads out of the volume is refused', () => {
    const parent = `${MOUNT}/parent`;
    const missing = `${parent}/missing`;

    const subjectWithRealChecks = (getVolumeInfo) => proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
      '../messageHelper': messageHelperStub,
      '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
      '../serviceHelper': serviceHelperStub,
      '../IOUtils': { getVolumeInfo },
      '../../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
      '../utils/pathSecurity': require('../../ZelBack/src/services/utils/pathSecurity'),
      './volumeSession': volumeSessionStub,
      './volumeExecutor': executorStub,
      '../utils/jobRegistry': jobRegistry,
      archiver: sinon.stub(),
      stream: { PassThrough: sinon.stub() },
    });

    const linkOutOfVolume = () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      // eslint-disable-next-line global-require
      const realFs = require('fs');
      sinon.stub(realFs.promises, 'lstat').callsFake(async (target) => {
        if (target === missing) throw enoent;
        return { isSymbolicLink: () => target === parent };
      });
      sinon.stub(realFs.promises, 'realpath').callsFake(async (target) => (target === parent ? '/test/apps/folder/fluxcomp_other' : target));
    };

    ['downloadAppsFolder', 'downloadAppsFile'].forEach((handler) => {
      it(`${handler} refuses it`, async () => {
        const getVolumeInfo = sinon.stub().resolves({ error: null, mounts: [{ mount: MOUNT }] });
        linkOutOfVolume();
        const subject = subjectWithRealChecks(getVolumeInfo);
        const target = { params: { appname: 'myapp', component: 'comp', folder: 'parent/missing', file: 'parent/missing' }, query: {} };

        await subject[handler](target, res);

        // These two answer by writing the body rather than through res.json,
        // so the refusal is observed where it is built.
        expect(messageHelperStub.createErrorMessage.firstCall.args[0])
          .to.match(/outside allowed directory|does not resolve on the host/);
      });
    });
  });

  // The eight operations above are gated by openVolume's default privilege, which
  // volumeSession.test.js pins in one place. These two ask for themselves, so they
  // are pinned here: taking a customer's files off the node is not their host's to
  // do, and appownerorfluxteam refuses exactly the node
  // operator.
  describe('the node operator is refused a download', () => {
    ['downloadAppsFolder', 'downloadAppsFile'].forEach((handler) => {
      it(`${handler} asks for the privilege that refuses the node operator`, async () => {
        const verifyPrivilege = sinon.stub().resolves(false);
        const subject = proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
          '../messageHelper': messageHelperStub,
          '../verificationHelper': { verifyPrivilege },
          '../serviceHelper': serviceHelperStub,
          '../IOUtils': { getVolumeInfo: sinon.stub() },
          '../../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
          '../utils/pathSecurity': { sanitizePath: sinon.stub(), verifyRealPathOfExistingPath: sinon.stub() },
          './volumeSession': volumeSessionStub,
          './volumeExecutor': executorStub,
          '../utils/jobRegistry': jobRegistry,
          archiver: sinon.stub(),
          stream: { PassThrough: sinon.stub() },
        });

        await subject[handler](req, res);

        sinon.assert.calledOnceWithExactly(verifyPrivilege, Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: 'myapp' });
      });
    });
  });

  // downloadAppsFolder streams one archive and names it through the response's
  // own attachment(): a folder whose name carries a byte the header grammar
  // forbids reaches res.writeHead as a raw interpolation and throws from a
  // stream callback the handler's catch cannot see, which exits the process.
  describe('downloadAppsFolder streams safely', () => {
    const http = require('http');
    const stream = require('stream');
    const os = require('os');
    const fs = require('fs');
    const nodePath = require('path');

    let tmpBase;
    afterEach(() => {
      if (tmpBase) fs.rmSync(tmpBase, { recursive: true, force: true });
      tmpBase = undefined;
    });

    // A response that validates a header value the way Node does, so a name the
    // grammar forbids is caught here rather than silently accepted, and records
    // the attachment() call the fix routes the name through.
    const validatingRes = () => {
      const res = new stream.PassThrough();
      res.headersSent = false;
      res.statusCode = 200;
      res.setHeader = (name, value) => { http.validateHeaderValue(name, String(value)); return res; };
      res.writeHead = (code, hdrs) => {
        res.statusCode = code;
        if (hdrs) Object.entries(hdrs).forEach(([k, v]) => http.validateHeaderValue(k, String(v)));
        res.headersSent = true;
        return res;
      };
      res.attachment = sinon.stub();
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = sinon.stub();
      res.destroyedByHandler = false;
      const realDestroy = res.destroy.bind(res);
      res.destroy = (err) => { res.destroyedByHandler = true; return realDestroy(err); };
      return res;
    };

    const subjectWith = (overrides) => proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
      '../messageHelper': messageHelperStub,
      '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
      '../serviceHelper': serviceHelperStub,
      '../IOUtils': { getVolumeInfo: sinon.stub().resolves({ error: null, mounts: [{ mount: MOUNT }] }) },
      '../../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
      '../utils/pathSecurity': { sanitizePath: (f, base) => `${base}/${f}`, verifyRealPathOfExistingPath: sinon.stub().callsFake(async (target) => target) },
      './volumeSession': volumeSessionStub,
      './volumeExecutor': executorStub,
      '../utils/jobRegistry': jobRegistry,
      ...overrides,
    });

    it('names a non-ascii folder through attachment, so no raw header is built and nothing throws', async () => {
      // A real directory with a non-ascii name and the real archiver, so the
      // whole stream runs: the header the buggy path builds from this name is
      // exactly the one Node refuses.
      tmpBase = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'flux-dl-'));
      const realDir = nodePath.join(tmpBase, '文書');
      fs.mkdirSync(realDir);
      fs.writeFileSync(nodePath.join(realDir, 'a.txt'), 'hello');

      const subject = subjectWith({
        archiver: require('archiver'),
        stream,
        '../utils/pathSecurity': { sanitizePath: () => realDir, verifyRealPathOfExistingPath: sinon.stub().callsFake(async (target) => target) },
      });
      const res = validatingRes();
      const finished = new Promise((resolve) => { res.on('finish', resolve); res.on('close', resolve); });
      const target = { params: {}, query: { appname: 'myapp', component: 'comp', folder: '文書' } };

      await subject.downloadAppsFolder(target, res);
      await finished;

      expect(res.destroyedByHandler).to.equal(false);
      sinon.assert.calledOnceWithExactly(res.attachment, '文書.zip');
    });

    it('handles an archiver error instead of letting it reach the process', async () => {
      const EventEmitter = require('events');
      const zip = new EventEmitter();
      zip.pipe = sinon.stub();
      zip.directory = sinon.stub();
      zip.destroy = sinon.stub();
      // The error a folder-that-is-a-file produces arrives after the handler has
      // returned, so it is raised on a later tick, off the try/catch.
      zip.finalize = sinon.stub().callsFake(() => {
        setImmediate(() => zip.emit('error', Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' })));
      });
      const logStub = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
      const subject = subjectWith({ archiver: () => zip, stream, '../../lib/log': logStub });
      const res = {
        attachment: sinon.stub(), destroy: sinon.stub(), on: sinon.stub(), json: sinon.stub(), write: sinon.stub(), end: sinon.stub(),
      };
      const target = { params: {}, query: { appname: 'myapp', component: 'comp', folder: 'notadir' } };

      await subject.downloadAppsFolder(target, res);
      // The listener is what keeps the emit below from reaching the process.
      expect(zip.listenerCount('error')).to.equal(1);
      await new Promise((resolve) => setImmediate(resolve));

      sinon.assert.calledOnce(res.destroy);
      sinon.assert.calledWith(logStub.error, sinon.match.instanceOf(Error));
    });

    // A fake archiver that records what directory() was asked to add, so the
    // reserved-name filter can be inspected without unzipping.
    const EventEmitter = require('events');
    const capturingZip = () => {
      const z = new EventEmitter();
      z.calls = [];
      z.pipe = sinon.stub();
      z.destroy = sinon.stub();
      z.finalize = sinon.stub();
      z.directory = sinon.stub().callsFake((dir, dest, data) => { z.calls.push({ dir, dest, data }); });
      return z;
    };

    // The volume root holds entries that are not the owner's data and that the
    // browse endpoint hides; a root download excludes them too.
    it('excludes reserved root entries from a root download', async () => {
      const zip = capturingZip();
      const subject = subjectWith({
        archiver: () => zip,
        stream,
        '../utils/pathSecurity': { sanitizePath: () => MOUNT, verifyRealPathOfExistingPath: sinon.stub().callsFake(async (target) => target) },
      });

      await subject.downloadAppsFolder({ params: {}, query: { appname: 'myapp', component: 'comp', folder: '.' } }, validatingRes());

      const filter = zip.calls[0].data;
      expect(filter, 'a root download passed no filter').to.be.a('function');
      expect(filter({ name: '.stfolder' })).to.equal(false);
      expect(filter({ name: '.stfolder/config.xml' })).to.equal(false);
      expect(filter({ name: 'keep.txt' })).to.deep.equal({ name: 'keep.txt' });
    });

    // Reserved at the root only: a file with one of these names inside a
    // subfolder is the owner's, so a subfolder download filters nothing.
    it('does not filter a subfolder download', async () => {
      const zip = capturingZip();
      const subject = subjectWith({
        archiver: () => zip,
        stream,
        '../utils/pathSecurity': { sanitizePath: () => `${MOUNT}/photos`, verifyRealPathOfExistingPath: sinon.stub().callsFake(async (target) => target) },
      });

      await subject.downloadAppsFolder({ params: {}, query: { appname: 'myapp', component: 'comp', folder: 'photos' } }, validatingRes());

      expect(zip.calls[0].data, 'a subfolder download must not filter').to.equal(undefined);
    });
  });
});
