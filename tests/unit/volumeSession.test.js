const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const os = require('node:os');
const nodePath = require('node:path');
const realFs = require('node:fs/promises');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('volumeSession tests', () => {
  const APPS_FOLDER = '/test/apps/folder/';
  const MOUNT = `${APPS_FOLDER}fluxcomp_myapp`;

  let deviceHelperStub;
  let verificationHelperStub;
  let IOUtilsStub;
  let fsStub;
  let volumeSession;

  // The real pathSecurity, not a stub: these cases exist to prove the guards
  // refuse, and a stubbed sanitizePath would let every one of them pass.
  const pathSecurity = require('../../ZelBack/src/services/utils/pathSecurity');

  const mountRow = (target, availableBytes = 1e9) => ({
    source: '/dev/loop3', target, fstype: 'ext4', sizeBytes: 2e9, usedBytes: 1e9, availableBytes, usePercent: 50,
  });

  beforeEach(() => {
    deviceHelperStub = { listMountedFilesystems: sinon.stub().resolves([mountRow(MOUNT)]) };
    verificationHelperStub = { verifyPrivilege: sinon.stub().resolves(true) };
    IOUtilsStub = {
      getFolderSize: sinon.stub().resolves(1000),
      getFileSize: sinon.stub().resolves(500),
    };
    fsStub = {
      lstat: sinon.stub().rejects(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    };

    volumeSession = proxyquire('../../ZelBack/src/services/appSystem/volumeSession', {
      '../deviceHelper': deviceHelperStub,
      '../verificationHelper': verificationHelperStub,
      '../IOUtils': IOUtilsStub,
      '../utils/pathSecurity': pathSecurity,
      '../utils/appConstants': {
        appsFolder: APPS_FOLDER,
        APP_NAME_REGEX: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
        APP_NAME_REGEX_LEGACY: /^[a-zA-Z0-9]+$/,
      },
      'node:fs/promises': fsStub,
    });
  });

  afterEach(() => sinon.restore());

  const reqFor = (appname = 'myapp', component = 'comp') => ({ params: { appname, component }, query: {} });

  // A path that exists and is not a symlink, so resolve() gets past its checks.
  const existsAsFile = (hostPath) => fsStub.lstat.withArgs(hostPath).resolves({
    isSymbolicLink: () => false, isDirectory: () => false, size: 500,
  });

  describe('resolveVolumeMount', () => {
    it('selects the mount whose basename is the app identifier', async () => {
      const result = await volumeSession.resolveVolumeMount('myapp', 'comp');
      expect(result.mount).to.equal(MOUNT);
      expect(result.availableBytes).to.equal(1e9);
    });

    it('uses the bare app name for the flat single-component form', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([mountRow(`${APPS_FOLDER}fluxmyapp`)]);
      const result = await volumeSession.resolveVolumeMount('myapp', 'null');
      expect(result.mount).to.equal(`${APPS_FOLDER}fluxmyapp`);
    });

    it('rejects an appname outside the allowed charset before it reaches a comparison', async () => {
      await expect(volumeSession.resolveVolumeMount('my_app', 'comp'))
        .to.be.rejectedWith('appname contains disallowed characters');
      // and never consulted the mount table
      expect(deviceHelperStub.listMountedFilesystems.called).to.equal(false);
    });

    it('rejects a component outside the allowed charset', async () => {
      await expect(volumeSession.resolveVolumeMount('myapp', 'my-comp'))
        .to.be.rejectedWith('component contains disallowed characters');
    });

    it('refuses to guess when one identifier resolves to several mounts', async () => {
      // Never [0]: picking one silently operates on arbitrary data.
      deviceHelperStub.listMountedFilesystems.resolves([mountRow(MOUNT), mountRow(MOUNT)]);
      await expect(volumeSession.resolveVolumeMount('myapp', 'comp'))
        .to.be.rejectedWith('refusing to guess');
    });

    it('refuses a mount that is not under the apps folder', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([mountRow('/elsewhere/fluxcomp_myapp')]);
      await expect(volumeSession.resolveVolumeMount('myapp', 'comp'))
        .to.be.rejectedWith('mounted outside the apps folder');
    });

    it('reports not found when nothing in the mount table matches', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([mountRow(`${APPS_FOLDER}fluxother_app`)]);
      await expect(volumeSession.resolveVolumeMount('myapp', 'comp'))
        .to.be.rejectedWith('Application volume not found');
    });

    it('does not authorise - that is openVolume\'s job', async () => {
      await volumeSession.resolveVolumeMount('myapp', 'comp');
      expect(verificationHelperStub.verifyPrivilege.called).to.equal(false);
    });
  });

  describe('openVolume', () => {
    it('returns a session when the caller owns the app', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      expect(vol.mount).to.equal(MOUNT);
      expect(vol.availableBytes).to.equal(1e9);
    });

    it('authorises before resolving anything', async () => {
      verificationHelperStub.verifyPrivilege.resolves(false);
      await expect(volumeSession.openVolume(reqFor())).to.be.rejectedWith('Unauthorized');
      // no lookup happened on the way to the refusal
      expect(deviceHelperStub.listMountedFilesystems.called).to.equal(false);
    });

    it('refuses with the shape errUnauthorizedMessage has always produced', async () => {
      // These handlers used to call errUnauthorizedMessage directly. They throw
      // now, and a client checking data.code === 401 must not notice.
      verificationHelperStub.verifyPrivilege.resolves(false);
      const error = await volumeSession.openVolume(reqFor()).catch((e) => e);

      expect(error.message).to.equal('Unauthorized. Access denied.');
      expect(error.name).to.equal('Unauthorized');
      expect(error.code).to.equal(401);
    });

    it('checks ownership of the app actually named in the request', async () => {
      await volumeSession.openVolume(reqFor('myapp', 'comp'));
      expect(verificationHelperStub.verifyPrivilege.calledWith('appownerabove', sinon.match.any, 'myapp')).to.equal(true);
    });
  });

  describe('resolve', () => {
    it('rejects traversal out of the mount', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.resolve('../../etc/passwd')).to.be.rejected;
    });

    it('rejects an absolute path', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.resolve('/etc/passwd')).to.be.rejected;
    });

    it('rejects a null byte', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.resolve('foo\0bar')).to.be.rejected;
    });

    it('refuses the volume root unless explicitly allowed', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.resolve('')).to.be.rejectedWith('Refusing to operate on the volume root');
      const root = await vol.resolve('', { allowRoot: true });
      expect(root.relative).to.equal('');
    });

    it('reports a missing source as such when the caller requires one', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.resolve('nope.txt', { mustExist: true }))
        .to.be.rejectedWith('Source does not exist');
    });

    it('refuses a name in the root that is not the application\'s', async () => {
      // Syncthing stops replicating a folder whose .stfolder is gone, and the
      // boot sweep reads the operation artefacts to decide whether to restore
      // data or delete it - so writing one is handing that decision an input.
      const vol = await volumeSession.openVolume(reqFor());
      const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

      await expect(vol.resolve('.stfolder')).to.be.rejectedWith('not an application');
      await expect(vol.resolve('.stignore')).to.be.rejectedWith('not an application');
      await expect(vol.resolve('lost+found')).to.be.rejectedWith('not an application');
      await expect(vol.resolve(`.flux-op-${id}`)).to.be.rejectedWith('not an application');
      await expect(vol.resolve(`.flux-old-${id}`)).to.be.rejectedWith('not an application');
      await expect(vol.resolve(`.flux-old-${id}.dest`)).to.be.rejectedWith('not an application');
    });

    it('reserves those names in the root and nowhere else', async () => {
      // They mean something to the reader that looks for them at the folder
      // root; deeper down they are names like any other, and taking them from
      // the owner inside their own data buys nothing.
      const vol = await volumeSession.openVolume(reqFor());
      const inside = await vol.resolve('appdata/.stignore');
      expect(inside.relative).to.equal('appdata/.stignore');
    });

    it('leaves a name that merely resembles an artefact alone', async () => {
      // The identifier shape is the whole rule: a folder called
      // .flux-op-backups is a name a user can legitimately choose.
      const vol = await volumeSession.openVolume(reqFor());
      const chosen = await vol.resolve('.flux-op-backups');
      expect(chosen.relative).to.equal('.flux-op-backups');
    });

    it('lets the sweep name what it is there to clean up', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
      const artefact = await vol.resolve(`.flux-old-${id}`, { allowReserved: true });
      expect(artefact.relative).to.equal(`.flux-old-${id}`);
    });

    it('expresses the operand as a container path, never a host path', async () => {
      // The executor binds the volume at /work and mounts nothing else, so a
      // host path in argv would name a file that does not exist in there.
      const vol = await volumeSession.openVolume(reqFor());
      const resolved = await vol.resolve('uploads/photo.jpg');
      expect(resolved.containerPath).to.equal('/work/uploads/photo.jpg');
      expect(resolved.hostPath).to.equal(`${MOUNT}/uploads/photo.jpg`);
    });
  });

  describe('VolumePath', () => {
    it('cannot be constructed outside the session', () => {
      // The executor accepts only VolumePath, so being able to mint one from a
      // string would defeat the whole arrangement.
      expect(() => new volumeSession.VolumePath('/anywhere', 'anywhere', {}))
        .to.throw('cannot be constructed directly');
    });
  });

  describe('pair', () => {
    it('resolves both operands', async () => {
      existsAsFile(`${MOUNT}/a.txt`);
      const vol = await volumeSession.openVolume(reqFor());
      const { source, destination } = await vol.pair('a.txt', 'archive/a.txt');
      expect(source.containerPath).to.equal('/work/a.txt');
      expect(destination.containerPath).to.equal('/work/archive/a.txt');
    });

    it('rejects identical source and destination', async () => {
      existsAsFile(`${MOUNT}/a.txt`);
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.pair('a.txt', 'a.txt')).to.be.rejectedWith('Source and destination are the same');
    });

    it('rejects a destination nested inside the source', async () => {
      // A directory copied into itself recurses until the volume fills.
      existsAsFile(`${MOUNT}/uploads`);
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.pair('uploads', 'uploads/backup')).to.be.rejectedWith('Destination is inside the source');
    });

    it('rejects a destination that contains the source', async () => {
      // The other direction, and the one overwrite lets through: moving
      // photos/2024 onto photos asks for photos to be replaced by something
      // inside it. flux-op cannot carry that out - displacing the destination
      // takes the source with it - and completing it would delete everything
      // else in photos, which the caller never named. Refused here so the answer
      // is a sentence rather than an exit code from a container.
      existsAsFile(`${MOUNT}/photos/2024`);
      existsAsFile(`${MOUNT}/photos`);
      const vol = await volumeSession.openVolume(reqFor());

      await expect(vol.pair('photos/2024', 'photos', { overwrite: true }))
        .to.be.rejectedWith('Destination contains the source');
    });

    it('still allows operands that merely share a prefix', async () => {
      // photos and photos-2024 are separate entries. A test on the string alone
      // would read the second as living inside the first.
      existsAsFile(`${MOUNT}/photos`);
      const vol = await volumeSession.openVolume(reqFor());

      const { destination } = await vol.pair('photos', 'photos-2024');
      expect(destination.containerPath).to.equal('/work/photos-2024');
    });

    it('refuses an existing destination without overwrite, and proceeds with it', async () => {
      existsAsFile(`${MOUNT}/a.txt`);
      existsAsFile(`${MOUNT}/b.txt`);
      const vol = await volumeSession.openVolume(reqFor());

      await expect(vol.pair('a.txt', 'b.txt')).to.be.rejectedWith('Destination already exists');

      const { destination } = await vol.pair('a.txt', 'b.txt', { overwrite: true });
      expect(destination.containerPath).to.equal('/work/b.txt');
    });

    it('rejects the volume root as a source', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.pair('', 'somewhere')).to.be.rejectedWith('Refusing to operate on the volume root');
    });
  });

  describe('staging', () => {
    it('allocates a recognisable directory inside the volume', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      const staging = vol.staging();
      expect(staging.relative).to.match(/^\.flux-op-/);
      expect(staging.hostPath.startsWith(MOUNT)).to.equal(true);
      expect(staging.containerPath.startsWith('/work/.flux-op-')).to.equal(true);
    });

    it('allocates a distinct directory each time', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      expect(vol.staging().relative).to.not.equal(vol.staging().relative);
    });
  });

  describe('measure', () => {
    it('measures a directory with getFolderSize, not getFileSize', async () => {
      fsStub.lstat.withArgs(`${MOUNT}/dir`).resolves({ isSymbolicLink: () => false, isDirectory: () => true });
      const vol = await volumeSession.openVolume(reqFor());
      const dir = await vol.resolve('dir');

      expect(await vol.measure(dir)).to.equal(1000);
      expect(IOUtilsStub.getFileSize.called).to.equal(false);
    });

    it('measures a symlink as zero', async () => {
      // cp -a and the archivers copy the link, not what it points at.
      fsStub.lstat.withArgs(`${MOUNT}/link`).resolves({ isSymbolicLink: () => true, isDirectory: () => false });
      const vol = await volumeSession.openVolume(reqFor());
      const link = await vol.resolve('link');

      expect(await vol.measure(link)).to.equal(0);
      expect(IOUtilsStub.getFolderSize.called).to.equal(false);
    });

    it('refuses when the source cannot be measured', async () => {
      // getFolderSize reports false rather than throwing; treating that as free
      // would let an unmeasurable tree through the capacity check.
      fsStub.lstat.withArgs(`${MOUNT}/dir`).resolves({ isSymbolicLink: () => false, isDirectory: () => true });
      IOUtilsStub.getFolderSize.resolves(false);
      const vol = await volumeSession.openVolume(reqFor());
      const dir = await vol.resolve('dir');

      await expect(vol.measure(dir)).to.be.rejectedWith('Unable to measure source');
    });

    it('rejects a plain string', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.measure(`${MOUNT}/a.txt`)).to.be.rejectedWith('requires a VolumePath');
    });
  });

  describe('isDirectory', () => {
    it('answers true for a directory', async () => {
      fsStub.lstat.withArgs(`${MOUNT}/dir`).resolves({ isSymbolicLink: () => false, isDirectory: () => true });
      const vol = await volumeSession.openVolume(reqFor());

      expect(await vol.isDirectory(await vol.resolve('dir'))).to.equal(true);
    });

    it('answers false for a symlink, however it resolves', async () => {
      // An archiver is handed the link itself, so a link to a directory must
      // not be archived as though the tree behind it were the source.
      fsStub.lstat.withArgs(`${MOUNT}/link`).resolves({ isSymbolicLink: () => true, isDirectory: () => false });
      const vol = await volumeSession.openVolume(reqFor());

      expect(await vol.isDirectory(await vol.resolve('link'))).to.equal(false);
    });

    it('rejects a plain string', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      await expect(vol.isDirectory(`${MOUNT}/a.txt`)).to.be.rejectedWith('requires a VolumePath');
    });
  });

  describe('parent', () => {
    it('gives the containing directory', async () => {
      fsStub.lstat.withArgs(`${MOUNT}/a/b.txt`).resolves({ isSymbolicLink: () => false, isDirectory: () => false });
      const vol = await volumeSession.openVolume(reqFor());
      const parent = vol.parent(await vol.resolve('a/b.txt'));

      expect(parent.relative).to.equal('a');
      expect(parent.containerPath).to.equal('/work/a');
    });

    it('gives the volume root for a top-level entry', async () => {
      // dirname of a bare name is '.', which as a host path would be the
      // process working directory rather than the mount.
      fsStub.lstat.withArgs(`${MOUNT}/b.txt`).resolves({ isSymbolicLink: () => false, isDirectory: () => false });
      const vol = await volumeSession.openVolume(reqFor());
      const parent = vol.parent(await vol.resolve('b.txt'));

      expect(parent.relative).to.equal('');
      expect(parent.containerPath).to.equal('/work');
      expect(parent.hostPath).to.equal(MOUNT);
    });

    it('rejects a plain string', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      expect(() => vol.parent(`${MOUNT}/a.txt`)).to.throw('requires a VolumePath');
    });
  });

  describe('requireSpace', () => {
    it('applies headroom rather than accepting an exact fit', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      // 1e9 available: 960_000_000 fits exactly but not with 5% headroom
      expect(() => vol.requireSpace(960_000_000)).to.throw('Not enough free space');
      expect(() => vol.requireSpace(900_000_000)).to.not.throw();
    });

    it('names both numbers so a client can act on the refusal', async () => {
      const vol = await volumeSession.openVolume(reqFor());
      expect(() => vol.requireSpace(2e9)).to.throw(/2100000000 bytes required, 1000000000 bytes available/);
    });

    it('fails closed when free space is unknown', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([mountRow(MOUNT, NaN)]);
      const vol = await volumeSession.openVolume(reqFor());
      expect(() => vol.requireSpace(1)).to.throw('Unable to determine free space');
    });
  });
  // On a real disk, deliberately. What this decides is where a path LEADS, and
  // a stubbed filesystem has no symlinks to lead anywhere - so the bypass
  // cannot be written against one at all.
  describe('reserved names, decided from where a path lands', () => {
    const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    let tmpRoot;
    let mount;
    let vol;

    beforeEach(async () => {
      tmpRoot = await realFs.mkdtemp(nodePath.join(os.tmpdir(), 'fluxreserved-'));
      mount = nodePath.join(tmpRoot, 'fluxcomp_myapp');
      await realFs.mkdir(mount);

      deviceHelperStub.listMountedFilesystems = sinon.stub().resolves([mountRow(mount)]);
      // The real node:fs/promises, so a symlink on disk is what answers.
      const onDisk = proxyquire('../../ZelBack/src/services/appSystem/volumeSession', {
        '../deviceHelper': deviceHelperStub,
        '../verificationHelper': verificationHelperStub,
        '../IOUtils': IOUtilsStub,
        '../utils/pathSecurity': pathSecurity,
        '../utils/appConstants': {
          appsFolder: `${tmpRoot}/`,
          APP_NAME_REGEX: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
          APP_NAME_REGEX_LEGACY: /^[a-zA-Z0-9]+$/,
        },
      });
      vol = await onDisk.openVolume(reqFor());
    });

    afterEach(async () => {
      if (tmpRoot) await realFs.rm(tmpRoot, { recursive: true, force: true });
    });

    it('refuses a reserved name reached through a symlink the app made itself', async () => {
      // `ln -s . here` is something an app runs in its own container. The path
      // then carries a separator, so a test on the string never fires, and it
      // resolves inside the mount, so containment is satisfied - both
      // truthfully, and neither is the question being asked.
      await realFs.symlink('.', nodePath.join(mount, 'here'));

      await expect(vol.resolve('here/.stignore')).to.be.rejectedWith('not an application');
      await expect(vol.resolve('here/.stfolder')).to.be.rejectedWith('not an application');
      await expect(vol.resolve(`here/.flux-old-${ID}.dest`)).to.be.rejectedWith('not an application');
    });

    it('refuses one reached through a chain of them', async () => {
      // Nothing stops the app nesting the trick, and a check that only looked
      // one level up would pass this.
      await realFs.mkdir(nodePath.join(mount, 'a'));
      await realFs.symlink('..', nodePath.join(mount, 'a', 'up'));

      await expect(vol.resolve('a/up/.stignore')).to.be.rejectedWith('not an application');
    });

    it('refuses one in the root when the mount is a real directory', async () => {
      // The case that looks redundant next to the stubbed test above and is
      // not: here the mount EXISTS, so the comparison runs on resolved paths
      // rather than on two strings neither of which resolves. os.tmpdir() is
      // itself a symlink on macOS, so a check that compared the parent against
      // the unresolved mount would stop refusing here and every other test in
      // this block would still pass.
      await expect(vol.resolve('.stignore')).to.be.rejectedWith('not an application');
      await expect(vol.resolve(`.flux-old-${ID}`)).to.be.rejectedWith('not an application');
    });

    it('still allows those names in a directory that is really a directory', async () => {
      // The reserved set is root-only on purpose. Deciding from the real path
      // must not take these names from the owner deeper in their own data.
      await realFs.mkdir(nodePath.join(mount, 'appdata'));

      const inside = await vol.resolve('appdata/.stignore');
      expect(inside.relative).to.equal('appdata/.stignore');
    });

    it('still allows a name that only resembles an artefact', async () => {
      const chosen = await vol.resolve('.flux-op-backups');
      expect(chosen.relative).to.equal('.flux-op-backups');
    });
  });
});
