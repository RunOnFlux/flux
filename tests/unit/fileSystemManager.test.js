const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
// The real registry: these tests assert the 202 contract, and a stub would let
// a broken handle shape through.
const jobRegistry = require('../../ZelBack/src/services/utils/jobRegistry');

describe('fileSystemManager tests', () => {
  const MOUNT = '/test/apps/folder/fluxcomp_myapp';

  let fileSystemManager;
  let executorStub;
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
      availableBytes: 1e9,
      resolve: sinon.stub().callsFake(async (p) => volumePath(p)),
      pair: sinon.stub().callsFake(async (source, destination) => ({
        source: volumePath(source),
        destination: volumePath(destination),
      })),
      staging: sinon.stub().returns(volumePath('.flux-op-abc')),
      measure: sinon.stub().resolves(1000),
      requireSpace: sinon.stub(),
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

    messageHelperStub = {
      createSuccessMessage: sinon.stub().callsFake((message) => ({ status: 'success', data: { message } })),
      createErrorMessage: sinon.stub().callsFake((message) => ({ status: 'error', data: { message } })),
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
    req = { params: { appname: 'myapp', component: 'comp' }, query: {} };

    fileSystemManager = proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
      '../messageHelper': messageHelperStub,
      '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
      '../serviceHelper': { ensureString: sinon.stub().callsFake((v) => JSON.stringify(v)) },
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
    it('creates the folder inside the volume', async () => {
      req.params.folder = 'uploads/2026';
      await fileSystemManager.createAppsFolder(req, res);

      expect(argv()).to.deep.equal(['mkdir', '-p', '/work/uploads/2026']);
      expect(res.json.firstCall.args[0].data.message).to.equal('Folder Created');
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
  });

  describe('moveAppsObject', () => {
    beforeEach(() => {
      req.params.source = 'uploads/photo.jpg';
      req.params.destination = 'archive/photo.jpg';
    });

    it('publishes the source at the destination, with no command and no copy', async () => {
      await fileSystemManager.moveAppsObject(req, res);

      expect(argv()).to.deep.equal([]);
      expect(runOptions().publish.staging.containerPath).to.equal('/work/uploads/photo.jpg');
      expect(runOptions().publish.destination.containerPath).to.equal('/work/archive/photo.jpg');
    });

    it('does not check capacity - a rename within one filesystem moves no bytes', async () => {
      await fileSystemManager.moveAppsObject(req, res);
      expect(sessionStub.requireSpace.called).to.equal(false);
    });

    it('passes overwrite through only when explicitly asked', async () => {
      await fileSystemManager.moveAppsObject(req, res);
      expect(sessionStub.pair.firstCall.args[2]).to.deep.equal({ overwrite: false });

      req.params.overwrite = 'true';
      await fileSystemManager.moveAppsObject(req, res);
      expect(sessionStub.pair.lastCall.args[2]).to.deep.equal({ overwrite: true });
    });
  });

  describe('copyAppsObject', () => {
    beforeEach(() => {
      req.params.source = 'uploads';
      req.params.destination = 'backup';
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
  });

  describe('compressAppsObject', () => {
    beforeEach(() => {
      req.params.source = 'uploads';
    });

    it('writes a zip when the destination says .zip', async () => {
      req.params.destination = 'backup.zip';
      await fileSystemManager.compressAppsObject(req, res);

      expect(argv()).to.deep.equal(['zip', '-r', '-q', '/work/.flux-op-abc', '/work/uploads']);
    });

    it('writes a tarball when the destination says .tar.gz', async () => {
      req.params.destination = 'backup.tar.gz';
      await fileSystemManager.compressAppsObject(req, res);

      expect(argv()).to.deep.equal(['tar', '-czf', '/work/.flux-op-abc', '-C', '/work/uploads', '.']);
    });

    it('refuses an extension it cannot produce', async () => {
      req.params.destination = 'backup.rar';
      await fileSystemManager.compressAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.message).to.match(/must end in/);
    });
  });

  describe('extractAppsObject', () => {
    beforeEach(() => {
      req.params.destination = 'restored';
    });

    it('unpacks a zip', async () => {
      req.params.source = 'backup.zip';
      await fileSystemManager.extractAppsObject(req, res);

      expect(argv()).to.deep.equal(['unzip', '-q', '/work/backup.zip', '-d', '/work/.flux-op-abc']);
    });

    it('ignores the uids and modes a tarball claims', async () => {
      // Archive content is attacker-supplied: honouring its uids can make the
      // result unreadable to the app, and honouring its modes would let it
      // plant a setuid binary.
      req.params.source = 'backup.tar.gz';
      await fileSystemManager.extractAppsObject(req, res);

      expect(argv()).to.include('--no-same-owner');
      expect(argv()).to.include('--no-same-permissions');
    });

    it('caps the result at the free space on the volume, not at what the archive claims', async () => {
      // An archive's declared uncompressed size is written by whoever built it,
      // so a bomb understates itself. The ceiling is applied to what actually
      // lands, and it is what the volume can hold.
      req.params.source = 'backup.zip';
      await fileSystemManager.extractAppsObject(req, res);

      expect(runOptions().maxBytes).to.be.closeTo(1e9 / 1.05, 1);
    });

    it('refuses a result containing links', async () => {
      req.params.source = 'backup.zip';
      await fileSystemManager.extractAppsObject(req, res);

      expect(runOptions().noLinks).to.equal(true);
    });

    it('creates the staging directory, which tar -C and unzip -d both need', async () => {
      req.params.source = 'backup.zip';
      await fileSystemManager.extractAppsObject(req, res);

      expect(runOptions().mkdirStaging).to.equal(true);
    });

    it('refuses an extension it cannot read, rather than sniffing the content', async () => {
      req.params.source = 'payload.bin';
      await fileSystemManager.extractAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.message).to.match(/must be a \.zip/);
    });
  });

  describe('error reporting', () => {
    it('reports an unauthorised caller without touching the volume', async () => {
      const unauthorized = new Error('Unauthorized. Access denied.');
      unauthorized.name = 'Unauthorized';
      volumeSessionStub.openVolume.rejects(unauthorized);

      req.params.source = 'a';
      req.params.destination = 'b';
      await fileSystemManager.copyAppsObject(req, res);

      expect(executorStub.run.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.message).to.match(/Unauthorized/);
    });

    it('records a failure against the job rather than the response', async () => {
      // The response left before the work did, so a failure has nowhere to be
      // reported except the job the caller is polling.
      executorStub.run.rejects(new Error('File operation failed with exit code 2'));

      req.params.source = 'a';
      req.params.destination = 'b';
      await fileSystemManager.copyAppsObject(req, res);
      await settle();

      expect(res.statusCode).to.equal(202);
      const view = jobRegistry.get(acceptedBody().jobId, null);
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

      req.params.source = 'a';
      req.params.destination = 'b';
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
      req.params.source = 'a';
      req.params.destination = 'b';
      await fileSystemManager.copyAppsObject(req, res);

      expect(res.statusCode).to.equal(202);
      expect(acceptedBody().jobId).to.match(/^op_/);
      expect(acceptedBody().statusUrl).to.equal(`/apps/operations/${acceptedBody().jobId}`);
      expect(acceptedBody().status).to.equal('Running');
      expect(res.setHeader.calledWith('Location', acceptedBody().statusUrl)).to.equal(true);
      expect(res.setHeader.calledWith('Retry-After', '2')).to.equal(true);
    });

    it('marks the job Succeeded once the work finishes', async () => {
      req.params.source = 'a';
      req.params.destination = 'b';
      await fileSystemManager.copyAppsObject(req, res);
      await settle();

      expect(jobRegistry.get(acceptedBody().jobId, null).status).to.equal('Succeeded');
    });

    it('answers 202 for a move too, so paste is one shape whichever it was', async () => {
      req.params.source = 'a';
      req.params.destination = 'b';
      await fileSystemManager.moveAppsObject(req, res);

      expect(res.statusCode).to.equal(202);
      expect(acceptedBody().jobId).to.match(/^op_/);
    });
  });
});
