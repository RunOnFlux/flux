const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

chai.use(chaiAsPromised);
const { expect } = chai;

// A real fs rejection carries a `code`; a bare Error carries only a message,
// and `code` is what tells "not there" from "could not look". A fixture
// without it exercises the wrong branch.
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

describe('volumeService tests', () => {
  const APPS_FOLDER = '/test/apps/folder/';
  const APP_VOLUMES = '/test/flux/appvolumes';
  const LEGACY_APP_VOLUMES = '/test/fluxappvolumes';
  let dockerServiceStub;
  let serviceHelperStub;
  let mountParserStub;
  let fsStub;
  let deviceHelperStub;
  let appsRuntimeStateStub;
  let logStub;
  let volumeService;

  beforeEach(() => {
    dockerServiceStub = { getAppIdentifier: sinon.stub() };
    // runCommand defaults to success ({ error: null }); tests override as needed
    serviceHelperStub = { runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }) };
    mountParserStub = {
      parseContainerData: sinon.stub(),
      getRequiredLocalPaths: sinon.stub(),
      MountType: {
        PRIMARY: 'primary',
        DIRECTORY: 'directory',
        FILE: 'file',
        COMPONENT_PRIMARY: 'component_primary',
        COMPONENT_DIRECTORY: 'component_directory',
        COMPONENT_FILE: 'component_file',
      },
    };
    // readFile rejecting drives isPathMounted onto its mountpoint-command
    // fallback, so tests can keep expressing mountedness via runCommand; the
    // isPathMounted describe covers the mountinfo path with real fixtures
    fsStub = {
      promises: {
        access: sinon.stub(),
        readdir: sinon.stub().resolves([]),
        readFile: sinon.stub().rejects(new Error('no mountinfo')),
        // A mount point is a directory unless a test says otherwise: that is
        // what makes it somewhere a volume image can be written.
        stat: sinon.stub().resolves({ isDirectory: () => true }),
        // Not followed, because what matters is what is AT the app's path.
        lstat: sinon.stub().resolves({ isDirectory: () => true }),
      },
    };
    deviceHelperStub = { listMountedFilesystems: sinon.stub().resolves([]), listAllMounts: sinon.stub().resolves([]) };
    // Nothing recorded unless a test says so: that is a node that has never
    // created a volume through this code, which is every legacy install.
    appsRuntimeStateStub = { getVolumeImage: sinon.stub().resolves(null), setVolumeImage: sinon.stub().resolves() };
    logStub = {
      info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
    };

    volumeService = proxyquire('../../ZelBack/src/services/utils/volumeService', {
      '../dockerService': dockerServiceStub,
      '../serviceHelper': serviceHelperStub,
      './mountParser': mountParserStub,
      // The real APP_VOLUME_MOUNT_OPTIONS, not a placeholder: the assertion
      // below is what stops nosuid/nodev being dropped, so a stubbed value
      // would let the test pass against a mount that no longer sets them.
      './appConstants': {
        appsFolder: APPS_FOLDER,
        appVolumesPath: APP_VOLUMES,
        legacyAppVolumesPath: LEGACY_APP_VOLUMES,
        APP_VOLUME_MOUNT_OPTIONS: require('../../ZelBack/src/services/utils/appConstants').APP_VOLUME_MOUNT_OPTIONS,
      },
      '../../lib/log': logStub,
      '../deviceHelper': deviceHelperStub,
      '../appManagement/appsRuntimeState': appsRuntimeStateStub,
      fs: { promises: fsStub.promises },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  const callsFor = (cmd) => serviceHelperStub.runCommand.getCalls().filter((c) => c.args[0] === cmd);

  // per-command dispatcher for runCommand; unlisted commands succeed
  const dispatchRunCommand = (behaviours) => {
    serviceHelperStub.runCommand.callsFake(async (cmd, options) => {
      const behaviour = behaviours[cmd];
      if (!behaviour) return { error: null, stdout: '', stderr: '' };
      return behaviour(options);
    });
  };

  // one /proc/self/mountinfo line per mounted path (field 5 is the mount point)
  const mountinfoWith = (...paths) => paths
    .map((p, i) => `${400 + i} 29 7:${i} / ${p} rw,relatime shared:${i} - ext4 /dev/loop${i} rw`)
    .join('\n');

  describe('isPathMounted tests', () => {
    it('should return true when mountinfo lists the path as a mount point', async () => {
      fsStub.promises.readFile.resolves(mountinfoWith('/dat', '/some/dir'));
      const result = await volumeService.isPathMounted('/some/dir');
      expect(result).to.be.true;
      // no process spawned - this is the whole point of the mountinfo read
      expect(callsFor('mountpoint')).to.have.lengthOf(0);
    });

    it('should return false when mountinfo does not list the path', async () => {
      fsStub.promises.readFile.resolves(mountinfoWith('/dat', '/some/dir/deeper'));
      const result = await volumeService.isPathMounted('/some/dir');
      expect(result).to.be.false;
      expect(callsFor('mountpoint')).to.have.lengthOf(0);
    });

    it('should normalize a trailing slash on the queried path', async () => {
      fsStub.promises.readFile.resolves(mountinfoWith('/some/dir'));
      const result = await volumeService.isPathMounted('/some/dir/');
      expect(result).to.be.true;
    });

    it('should decode octal-escaped characters in mount points', async () => {
      // mountinfo escapes spaces as \040
      fsStub.promises.readFile.resolves(mountinfoWith('/some/dir\\040with\\040space'));
      const result = await volumeService.isPathMounted('/some/dir with space');
      expect(result).to.be.true;
    });

    it('should fall back to the mountpoint command when mountinfo is unreadable', async () => {
      const result = await volumeService.isPathMounted('/some/dir');
      expect(result).to.be.true;
      const probe = callsFor('mountpoint');
      expect(probe).to.have.lengthOf(1);
      expect(probe[0].args[1].params).to.deep.equal(['-q', '/some/dir']);
    });

    it('should return false from the fallback when mountpoint -q fails', async () => {
      serviceHelperStub.runCommand.resolves({ error: new Error('not a mountpoint'), stdout: '', stderr: '' });
      const result = await volumeService.isPathMounted('/some/dir');
      expect(result).to.be.false;
    });
  });

  describe('placementVolumesInGib tests', () => {
    const mount = (source, target, sizeBytes, fstype = 'ext4') => ({
      source, target, fstype, sizeBytes, usedBytes: 0, availableBytes: sizeBytes,
    });

    it('counts block-backed volumes', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('/dev/sdb1', '/dat2', 2e12),
      ]);

      const result = await volumeService.placementVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat2', '/dat']);
    });

    it('excludes a volume whose contents would not survive a reboot', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('tmpfs', '/run', 2e12, 'tmpfs'),
      ]);

      const result = await volumeService.placementVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat']);
    });

    it('excludes storage on another machine, which is not the node to advertise', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('nas:/export', '/mnt/nas', 4e12, 'nfs4'),
      ]);

      const result = await volumeService.placementVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat']);
    });

    it('excludes a loop device, which is an app volume rather than a host disk', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('/dev/loop3', '/dat/apps/fluxcomp_app', 2e12),
      ]);

      const result = await volumeService.placementVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat']);
    });

    it('excludes a boot filesystem', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('/dev/sda2', '/boot', 2e12),
      ]);

      const result = await volumeService.placementVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat']);
    });

    it('includes a loop-mounted root, which is the host disk on some images', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('/dev/loop0', '/', 2e12),
      ]);

      const result = await volumeService.placementVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/', '/dat']);
    });

    it('reports whole GiB', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda1', target: '/dat', sizeBytes: 1e12, usedBytes: 4e11, availableBytes: 6e11 },
      ]);

      const [volume] = await volumeService.placementVolumesInGib();
      expect(volume).to.deep.equal({
        filesystem: '/dev/sda1', mount: '/dat', size: 931, used: 373, available: 559,
      });
    });

    it('counts the room for an app in the unit the app will spend', async () => {
      // The number this produces is compared against an app's `hdd`, and that
      // is spent by `fallocate -l <hdd>G`, which util-linux reads as 1024^3.
      // Free space worth exactly twenty of those has to read as 20 - and
      // twenty DECIMAL GB has to read as less, or a node admits an app it is
      // 7.4% short for and finds out when fallocate returns ENOSPC.
      const twentyGib = 20 * (1024 ** 3);
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda1', target: '/dat', sizeBytes: twentyGib, usedBytes: 0, availableBytes: twentyGib },
      ]);
      expect((await volumeService.placementVolumesInGib())[0].available).to.equal(20);

      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda1', target: '/dat', sizeBytes: 2e10, usedBytes: 0, availableBytes: 2e10 },
      ]);
      expect((await volumeService.placementVolumesInGib())[0].available).to.be.below(20);
    });
  });

  // Where an image may be FOUND is wider than where one may be PUT. A disk the
  // kernel remounted read-only after an I/O error still holds the image and
  // still reads; refusing to look there reports it missing, and the node then
  // records a tampering event against an operator whose disk failed.
  describe('a read-only host filesystem', () => {
    const roMount = {
      source: '/dev/sdb1', target: '/mnt/data', fstype: 'ext4', readOnly: true, sizeBytes: 1e12, usedBytes: 0, availableBytes: 1e12,
    };

    it('is still searched for an existing image', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([roMount]);
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/mnt/data/fluxcomp_appFLUXFSVOL').resolves();

      const found = await volumeService.getVolumeFilePath('fluxcomp_app');

      expect(found.path).to.equal('/mnt/data/fluxcomp_appFLUXFSVOL');
    });

    it('is reported as what it is, not as a missing image', async () => {
      deviceHelperStub.listAllMounts.resolves([roMount]);
      expect(await volumeService.isOnReadOnlyFilesystem('/mnt/data/fluxcomp_appFLUXFSVOL')).to.equal(true);
    });

    // "No row says read-only" is a fact only once every row has been seen. A
    // table that did not arrive has not established that the disk is writable,
    // and this gates whether the volume is mounted at all.
    it('does not answer at all when the mount table cannot be read', async () => {
      deviceHelperStub.listAllMounts.rejects(new Error('findmnt failed'));

      await expect(volumeService.isOnReadOnlyFilesystem('/mnt/data/fluxcomp_appFLUXFSVOL'))
        .to.be.rejectedWith(/findmnt failed/);
    });

    it('does not claim a writable filesystem is read-only', async () => {
      deviceHelperStub.listAllMounts.resolves([{ ...roMount, readOnly: false }]);
      expect(await volumeService.isOnReadOnlyFilesystem('/mnt/data/fluxcomp_appFLUXFSVOL')).to.equal(false);
    });

    // A path sits under several mounts; only the deepest describes the disk
    // the bytes are on. Keyed the other way, a read-only `/` would condemn
    // every volume on every other disk.
    it('asks the deepest mount, not the widest', async () => {
      deviceHelperStub.listAllMounts.resolves([
        { ...roMount, target: '/', readOnly: true },
        { ...roMount, target: '/mnt/data', readOnly: false },
      ]);
      expect(await volumeService.isOnReadOnlyFilesystem('/mnt/data/fluxcomp_appFLUXFSVOL')).to.equal(false);
    });

    // Mounts stacked on one path are listed in mountinfo order and the last
    // is the one the kernel resolves through, so both directions are pinned:
    // reading the shadowed row answers about a filesystem nothing can reach.
    it('reads the mount stacked on top, not the one it shadows', async () => {
      deviceHelperStub.listAllMounts.resolves([
        { ...roMount, target: '/mnt/data', readOnly: false },
        { ...roMount, target: '/mnt/data', source: '/dev/sdc1', readOnly: true },
      ]);
      expect(await volumeService.isOnReadOnlyFilesystem('/mnt/data/fluxcomp_appFLUXFSVOL')).to.equal(true);
    });

    it('does not report a shadowed read-only mount when the top one is writable', async () => {
      deviceHelperStub.listAllMounts.resolves([
        { ...roMount, target: '/mnt/data', readOnly: true },
        { ...roMount, target: '/mnt/data', source: '/dev/sdc1', readOnly: false },
      ]);
      expect(await volumeService.isOnReadOnlyFilesystem('/mnt/data/fluxcomp_appFLUXFSVOL')).to.equal(false);
    });
  });

  // `--real` drops the pseudo filesystems, so the disk's own row is all it
  // shows - and the disk is writable. What a write to that path actually
  // lands on is the read-only thing mounted over it, which only the full
  // table carries. This refusal decides whether an app runs.
  describe('a read-only mount that is not block-backed', () => {
    it('is what the answer is taken from', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sdb1', target: '/mnt/data', fstype: 'ext4', readOnly: false },
      ]);
      deviceHelperStub.listAllMounts.resolves([
        { source: '/dev/sdb1', target: '/mnt/data', fstype: 'ext4', readOnly: false },
        { source: 'overlay', target: '/mnt/data', fstype: 'overlay', readOnly: true },
      ]);

      expect(await volumeService.isOnReadOnlyFilesystem('/mnt/data/fluxcomp_appFLUXFSVOL')).to.equal(true);
    });
  });

  // Where an image may be PUT is a narrower question than where one may be
  // FOUND. An earlier release placed by source alone, taking any /dev/ mount
  // whatever its type, so images sit on these filesystems on nodes today.
  // Narrowing the search to the types a new image may be created on reports
  // every one of them missing.
  describe('a filesystem an image may not be placed on', () => {
    const row = (fstype) => ({
      source: '/dev/sdb1', target: '/mnt/data', fstype, readOnly: false, sizeBytes: 1e12, usedBytes: 0, availableBytes: 1e12,
    });

    ['exfat', 'vfat', 'msdos', 'ntfs', 'ntfs3', 'fuseblk'].forEach((fstype) => {
      it(`is still searched for an existing image: ${fstype}`, async () => {
        deviceHelperStub.listMountedFilesystems.resolves([row(fstype)]);
        fsStub.promises.access.rejects(enoent());
        fsStub.promises.access.withArgs('/mnt/data/fluxcomp_appFLUXFSVOL').resolves();

        const found = await volumeService.getVolumeFilePath('fluxcomp_app');

        expect(found.path).to.equal('/mnt/data/fluxcomp_appFLUXFSVOL');
      });
    });

    // The counterpart, so the two questions cannot quietly become one again:
    // storage on another machine is neither placed on nor searched.
    it('is not searched when the storage is on another machine', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: 'nas:/vol0', target: '/mnt/nas', fstype: 'nfs4', readOnly: false, sizeBytes: 1e12, usedBytes: 0, availableBytes: 1e12 },
      ]);
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/mnt/nas/fluxcomp_appFLUXFSVOL').resolves();

      const found = await volumeService.getVolumeFilePath('fluxcomp_app');

      expect(found.path).to.equal(null);
    });
  });

  // A container runtime's own storage is not a place an image may be found. On
  // a storage driver backed by real filesystems, each container's root is a
  // mount like any other - so a file the container's owner put there would
  // otherwise be answered as the app's volume and loop-mounted as root.
  describe("a container runtime's storage", () => {
    it('is not searched for an image, even when one is sitting there', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: 'rpool/docker/3f9c1e', target: '/var/lib/docker/zfs/graph/3f9c1e', fstype: 'zfs', sizeBytes: 1e12, usedBytes: 0, availableBytes: 1e12 },
      ]);
      // The planted file exists; the real volume is in appvolumes.
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/var/lib/docker/zfs/graph/3f9c1e/fluxweb_victimFLUXFSVOL').resolves();

      const found = await volumeService.getVolumeFilePath('fluxweb_victim');

      expect(found.path).to.equal(null);
    });

    // The directory itself is not the runtime's container storage, it is where
    // an operator mounted docker a disk of its own - and development places
    // images there once the root disk fills. Refusing it would lose an image
    // that is sitting on the node.
    it('is not the disk the operator mounted at that path, which still holds images', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sdb1', target: '/var/lib/docker', fstype: 'ext4', sizeBytes: 9e11, usedBytes: 0, availableBytes: 9e11 },
      ]);
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/var/lib/docker/fluxweb_appFLUXFSVOL').resolves();

      const found = await volumeService.getVolumeFilePath('fluxweb_app');

      expect(found.path).to.equal('/var/lib/docker/fluxweb_appFLUXFSVOL');
    });
  });

  // What the node wrote down when it made the volume. A lookup cannot be
  // answered by a file somebody else named, which is the weakness every
  // exclusion rule in the search exists to compensate for.
  describe('the image this node recorded', () => {
    beforeEach(() => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
    });

    // The search trusts a filename, so a planted one outranks the genuine
    // image - which is the weakness the record exists to remove. Running it
    // because the record could not be READ would reopen that on a database
    // hiccup, so nothing is searched and nothing is concluded.
    it('searches nothing at all when the record cannot be read', async () => {
      appsRuntimeStateStub.getVolumeImage.rejects(new Error('MongoNetworkError'));

      const result = await volumeService.getVolumeFilePath('fluxapp1');

      expect(result).to.deep.equal({
        path: null, conclusive: false, blocked: 'record_unreadable', recorded: null,
      });
      sinon.assert.notCalled(deviceHelperStub.listMountedFilesystems);
      sinon.assert.notCalled(fsStub.promises.access);
    });

    it('is used without searching the disks at all', async () => {
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/mnt/data/fluxapp1FLUXFSVOL', fsUuid: 'u-1' });
      fsStub.promises.access.resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');

      expect(result).to.deep.include({ path: '/mnt/data/fluxapp1FLUXFSVOL', conclusive: true, blocked: null });
      // the mount table is never read, so nothing a search could be fooled by matters
      sinon.assert.notCalled(deviceHelperStub.listMountedFilesystems);
    });

    it('falls back to the search when the recorded image is gone', async () => {
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/mnt/gone/fluxapp1FLUXFSVOL', fsUuid: 'u-1' });
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/dat' }]);
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');

      expect(result.path).to.equal('/dat/fluxapp1FLUXFSVOL');
    });
  });

  describe('an image is checked against the stamp this node gave it', () => {
    beforeEach(() => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/dat' }]);
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.readdir.resolves([]);
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        blkid: async () => ({ error: null, stdout: 'someone-elses-uuid\n', stderr: '' }),
      });
    });

    // blkid keys its cache on the path, so a file replaced at a path it has
    // probed before is answered with the previous file's UUID. Without the
    // cache disabled the check reports a match for exactly the substitution it
    // exists to catch.
    it('probes the image with the blkid cache disabled', async () => {
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/dat/fluxapp1FLUXFSVOL', fsUuid: 'ours-1' });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();

      await volumeService.ensureAppVolumeMounted('app1');

      const blkid = callsFor('blkid');
      expect(blkid, 'the image was never probed').to.have.lengthOf.at.least(1);
      expect(blkid[0].args[1].params).to.deep.equal(['-c', '/dev/null', '-o', 'value', '-s', 'UUID', '/dat/fluxapp1FLUXFSVOL']);
    });

    it('refuses a file that is not the image this node created', async () => {
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/dat/fluxapp1FLUXFSVOL', fsUuid: 'ours-1' });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: false, reason: 'volume_image_unrecognised' });
      expect(callsFor('mount')).to.have.lengthOf(0);
    });

    // A record naming a path this node no longer uses describes an image that
    // is not there. Refusing the real volume on that basis loses the app's
    // data for good, and no other writer repairs it - so the record is
    // replaced by what the mount just proved.
    it('adopts the image it found when the record names a path that is gone', async () => {
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/mnt/gone/fluxapp1FLUXFSVOL', fsUuid: 'from-a-volume-that-went' });
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        blkid: async () => ({ error: null, stdout: 'the-real-one\n', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.resolves([]);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.mounted, 'the genuine volume was refused over a stale record').to.be.true;
      sinon.assert.calledWith(appsRuntimeStateStub.setVolumeImage, 'fluxapp1', '/dat/fluxapp1FLUXFSVOL', 'the-real-one');
    });

    it('mounts the image whose stamp matches', async () => {
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/dat/fluxapp1FLUXFSVOL', fsUuid: 'someone-elses-uuid' });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.mounted).to.be.true;
      expect(callsFor('mount')).to.have.lengthOf(1);
    });

    // A stamp that cannot be read is not a mismatch, and the mount refuses
    // anything that is not a filesystem anyway.
    it('does not refuse on a stamp it cannot read', async () => {
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/dat/fluxapp1FLUXFSVOL', fsUuid: 'ours-1' });
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        blkid: async () => ({ error: new Error('cannot open'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.mounted).to.be.true;
    });
  });

  // A node that upgrades with its apps running has the answer already: the
  // loop device names its own backing file. Nothing is searched for and
  // nothing is taken on a filename.
  describe('what a mounted volume teaches a node that never recorded it', () => {
    it('reads the image path from the kernel and records it', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      appsRuntimeStateStub.getVolumeImage.resolves(null);
      fsStub.promises.readFile.withArgs('/proc/self/mountinfo', 'utf8')
        .resolves(mountinfoWith(`${APPS_FOLDER}fluxapp1`));
      fsStub.promises.readFile.withArgs('/sys/block/loop0/loop/backing_file', 'utf8')
        .resolves('/mnt/data/fluxapp1FLUXFSVOL\n');
      dispatchRunCommand({ blkid: async () => ({ error: null, stdout: 'learned-uuid\n', stderr: '' }) });

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: true, alreadyMounted: true });
      sinon.assert.calledWith(appsRuntimeStateStub.setVolumeImage, 'fluxapp1', '/mnt/data/fluxapp1FLUXFSVOL', 'learned-uuid');
    });

    // The search runs once for a legacy image: what it found is recorded the
    // moment the mount proves it real, and the lookup answers ever after.
    it('records an image the search found, once it is known to mount', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      appsRuntimeStateStub.getVolumeImage.resolves(null);
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/dat' }]);
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        blkid: async () => ({ error: null, stdout: 'found-uuid\n', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.resolves([]);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.mounted).to.be.true;
      sinon.assert.calledWith(appsRuntimeStateStub.setVolumeImage, 'fluxapp1', '/dat/fluxapp1FLUXFSVOL', 'found-uuid');
    });

    // Mounts stack, and the one a path resolves through is the one added last.
    // Learning from the first row records the image a later mount has already
    // hidden - which the next boot then mounts, as stale data, silently.
    it('learns from the mount the path resolves through, not the one beneath it', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      appsRuntimeStateStub.getVolumeImage.resolves(null);
      const dir = `${APPS_FOLDER}fluxapp1`;
      fsStub.promises.readFile.withArgs('/proc/self/mountinfo', 'utf8').resolves(
        `400 29 7:0 / ${dir} rw,relatime shared:0 - ext4 /dev/loop0 rw\n`
        + `401 29 7:1 / ${dir} rw,relatime shared:1 - ext4 /dev/loop9 rw`,
      );
      fsStub.promises.readFile.withArgs('/sys/block/loop0/loop/backing_file', 'utf8').resolves('/mnt/data/shadowed.img\n');
      fsStub.promises.readFile.withArgs('/sys/block/loop9/loop/backing_file', 'utf8').resolves('/mnt/data/visible.img\n');
      dispatchRunCommand({ blkid: async () => ({ error: null, stdout: 'u-visible\n', stderr: '' }) });

      await volumeService.ensureAppVolumeMounted('app1');

      sinon.assert.calledWith(appsRuntimeStateStub.setVolumeImage, 'fluxapp1', '/mnt/data/visible.img', 'u-visible');
    });

    // The kernel marks an unlinked backing file, and that path never resolves
    // again. Recording it stores a way back to nothing.
    it('records nothing when the backing file has been deleted', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      appsRuntimeStateStub.getVolumeImage.resolves(null);
      fsStub.promises.readFile.withArgs('/proc/self/mountinfo', 'utf8')
        .resolves(mountinfoWith(`${APPS_FOLDER}fluxapp1`));
      fsStub.promises.readFile.withArgs('/sys/block/loop0/loop/backing_file', 'utf8')
        .resolves('/mnt/data/fluxapp1FLUXFSVOL (deleted)\n');

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: true, alreadyMounted: true });
      sinon.assert.notCalled(appsRuntimeStateStub.setVolumeImage);
    });

    // A record carrying a path but no stamp skips the check before a mount, so
    // the component keeps the behaviour the stamp exists to replace. One
    // unreadable probe must not settle that for good.
    it('takes the stamp again when the record has a path but none', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/mnt/data/fluxapp1FLUXFSVOL', fsUuid: null });
      fsStub.promises.readFile.withArgs('/proc/self/mountinfo', 'utf8')
        .resolves(mountinfoWith(`${APPS_FOLDER}fluxapp1`));
      dispatchRunCommand({ blkid: async () => ({ error: null, stdout: 'late-uuid\n', stderr: '' }) });

      await volumeService.ensureAppVolumeMounted('app1');

      sinon.assert.calledWith(appsRuntimeStateStub.setVolumeImage, 'fluxapp1', '/mnt/data/fluxapp1FLUXFSVOL', 'late-uuid');
    });

    it('does not overwrite a record it already has', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/mnt/data/fluxapp1FLUXFSVOL', fsUuid: 'u-1' });
      fsStub.promises.readFile.withArgs('/proc/self/mountinfo', 'utf8')
        .resolves(mountinfoWith(`${APPS_FOLDER}fluxapp1`));

      await volumeService.ensureAppVolumeMounted('app1');

      sinon.assert.notCalled(appsRuntimeStateStub.setVolumeImage);
    });

    // A recorded path is where an image was PUT. A volume re-created elsewhere
    // leaves that path naming a file this mount does not use, and stamping it
    // hardens the record onto data the app is not running on.
    it('takes the stamp from what the mount resolves through, not the recorded path', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/mnt/old/fluxapp1FLUXFSVOL', fsUuid: null });
      fsStub.promises.readFile.withArgs('/proc/self/mountinfo', 'utf8')
        .resolves(mountinfoWith(`${APPS_FOLDER}fluxapp1`));
      fsStub.promises.readFile.withArgs('/sys/block/loop0/loop/backing_file', 'utf8')
        .resolves('/mnt/live/fluxapp1FLUXFSVOL\n');
      dispatchRunCommand({ blkid: async () => ({ error: null, stdout: 'u-live\n', stderr: '' }) });

      await volumeService.ensureAppVolumeMounted('app1');

      sinon.assert.calledWith(appsRuntimeStateStub.setVolumeImage, 'fluxapp1', '/mnt/live/fluxapp1FLUXFSVOL', 'u-live');
    });

    // A record that could not be read is not a record that is absent. Writing
    // one here would describe the mount by a path nothing confirmed.
    it('records nothing when the record could not be read', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      appsRuntimeStateStub.getVolumeImage.rejects(new Error('MongoNetworkError'));
      fsStub.promises.readFile.withArgs('/proc/self/mountinfo', 'utf8')
        .resolves(mountinfoWith(`${APPS_FOLDER}fluxapp1`));
      // everything a relearn needs is available, so nothing else can be what
      // stops one happening
      fsStub.promises.readFile.withArgs('/sys/block/loop0/loop/backing_file', 'utf8')
        .resolves('/mnt/data/fluxapp1FLUXFSVOL\n');
      dispatchRunCommand({ blkid: async () => ({ error: null, stdout: 'u-1\n', stderr: '' }) });

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: true, alreadyMounted: true });
      sinon.assert.notCalled(appsRuntimeStateStub.setVolumeImage);
    });
  });

  // Two recorders, two contracts. Writing down a volume that already works is
  // bookkeeping and must never fail a mount; writing down one that has just
  // been reformatted supersedes a record that now describes an image which no
  // longer exists, and a silent failure there refuses the real volume for good.
  describe('recording an image', () => {
    it('does not fail over bookkeeping for a volume that already works', async () => {
      appsRuntimeStateStub.setVolumeImage.rejects(new Error('mongo unavailable'));

      await volumeService.recordVolumeImage('fluxapp1', '/mnt/data/img', 'u-1');

      sinon.assert.called(logStub.warn);
    });

    it('fails when a newly created volume cannot be recorded', async () => {
      appsRuntimeStateStub.setVolumeImage.rejects(new Error('mongo unavailable'));

      await expect(volumeService.recordNewVolumeImage('fluxapp1', '/mnt/data/img', 'u-1'))
        .to.be.rejectedWith('mongo unavailable');
    });
  });

  describe('getComponentAppIdsFromVolumeFiles tests', () => {
    // This list IS the component set for an app whose specification cannot be
    // decrypted, so a short one is indistinguishable from an app with fewer
    // components and every decision made from it is silently wrong.
    it('says the list is short when the mount table cannot be read, and still answers', async () => {
      deviceHelperStub.listMountedFilesystems.rejects(new Error('findmnt failed'));
      fsStub.promises.readdir.resolves([]);
      fsStub.promises.readdir.withArgs(APP_VOLUMES).resolves(['fluxweb_myappFLUXFSVOL']);

      const result = await volumeService.getComponentAppIdsFromVolumeFiles('myapp');

      // what it did find is still usable - the caller mounts these
      expect(result.appIds).to.deep.equal(['fluxweb_myapp']);
      expect(result.conclusive).to.be.false;
    });

    it('is not made short by a search root that is a file', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda2[/var/lib/docker/containers/abc/hostname]', target: '/etc/hostname', fstype: 'ext4' },
      ]);
      fsStub.promises.readdir.resolves([]);
      fsStub.promises.readdir.withArgs('/etc/hostname')
        .rejects(Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }));

      const result = await volumeService.getComponentAppIdsFromVolumeFiles('myapp');

      expect(result.conclusive).to.be.true;
    });

    it('says the list is short when a searched directory cannot be read', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/dat' }]);
      fsStub.promises.readdir.resolves([]);
      fsStub.promises.readdir.withArgs('/dat').rejects(Object.assign(new Error('EIO'), { code: 'EIO' }));

      const result = await volumeService.getComponentAppIdsFromVolumeFiles('myapp');

      expect(result.conclusive).to.be.false;
    });

    it('answers from every eligible mount when the table reads', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/dat' }]);
      fsStub.promises.readdir.resolves([]);
      fsStub.promises.readdir.withArgs('/dat').resolves(['fluxweb_myappFLUXFSVOL', 'unrelated']);

      const result = await volumeService.getComponentAppIdsFromVolumeFiles('myapp');

      expect(result.appIds).to.deep.equal(['fluxweb_myapp']);
      // a directory that is simply absent is not a short search
      expect(result.conclusive).to.be.true;
    });
  });

  describe('getVolumeFilePath tests', () => {
    it('should find the image at the root of an eligible host volume', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda1', target: '/dat' },
        { source: 'tmpfs', target: '/run' },
      ]);
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result.path).to.equal('/dat/fluxapp1FLUXFSVOL');
    });

    it('should not look for images at the root filesystem itself', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/' }]);
      fsStub.promises.access.rejects(enoent());

      await volumeService.getVolumeFilePath('fluxapp1');
      const checked = fsStub.promises.access.getCalls().map((c) => c.args[0]);
      expect(checked).to.not.include('/fluxapp1FLUXFSVOL');
    });

    it('should find the image in the appvolumes directory', async () => {
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`).resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result.path).to.equal(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`);
    });

    it('should find an image left at the legacy glued appvolumes location', async () => {
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs(`${LEGACY_APP_VOLUMES}/fluxapp1FLUXFSVOL`).resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result.path).to.equal(`${LEGACY_APP_VOLUMES}/fluxapp1FLUXFSVOL`);
    });

    it('should return null when the image exists nowhere', async () => {
      fsStub.promises.access.rejects(enoent());

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result.path).to.be.null;
      // every location was searched, so the null means the image is gone
      expect(result.conclusive).to.be.true;
    });

    // A search that could not cover the host mounts has not established that
    // the image is absent, only that it is not in the two places left to look.
    it('does not call an image absent when the mount table could not be read', async () => {
      deviceHelperStub.listMountedFilesystems.rejects(new Error('findmnt failed'));
      fsStub.promises.access.rejects(enoent());

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result.path).to.be.null;
      expect(result.conclusive).to.be.false;
    });

    // ENOENT is the only answer that means the image is not here. A disk
    // answering EIO, or a directory that denies the lookup, has ruled nothing
    // out - and calling it absent is how a failing disk becomes a tampering
    // event against the operator.
    it('does not call an image absent when a candidate path could not be read', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/dat' }]);
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').rejects(Object.assign(new Error('EIO'), { code: 'EIO' }));

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result.path).to.be.null;
      expect(result.conclusive).to.be.false;
    });

    // A mount can be a FILE: docker binds /etc/hostname and its siblings off
    // the host disk wherever FluxOS runs in a container, and those are search
    // roots. Nothing can exist beneath them, so that is an answer - reading it
    // as "could not look" leaves every search on such a node inconclusive and
    // silences the missing-image signal for good.
    it('counts a search root that is a file as a definite absence', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda2[/var/lib/docker/containers/abc/hostname]', target: '/etc/hostname', fstype: 'ext4' },
        { source: '/dev/sda2[/var/lib/docker/volumes/appdata/_data]', target: '/mnt/appdata', fstype: 'ext4' },
      ]);
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/etc/hostname/fluxapp1FLUXFSVOL')
        .rejects(Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }));

      const result = await volumeService.getVolumeFilePath('fluxapp1');

      expect(result.path).to.be.null;
      expect(result.conclusive, 'a file mount left the search unable to say the image is gone').to.be.true;
      expect(result.blocked).to.be.null;
    });

    it('settles the question when the image turns up despite an unreadable mount table', async () => {
      deviceHelperStub.listMountedFilesystems.rejects(new Error('findmnt failed'));
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`).resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result.path).to.equal(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`);
      expect(result.conclusive).to.be.true;
    });

    it('should still check appvolumes locations when the mount table cannot be read', async () => {
      deviceHelperStub.listMountedFilesystems.rejects(new Error('findmnt failed'));
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`).resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result.path).to.equal(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`);
    });
  });

  describe('ensureAppVolumeMounted tests', () => {
    beforeEach(() => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/dat' }]);
      // the ordinary host: the kernel offers loop devices. A test about a host
      // that does not is the one that says so.
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
    });

    it('should be a no-op when the app dir is already a mountpoint', async () => {
      // the mountedness comes from mountinfo - proving the composition once.
      // Answered per path, not for every read: a blanket resolve hands the
      // mountinfo blob back as the loop device's backing file, which is a
      // state the kernel cannot produce and would be recorded as an image path.
      fsStub.promises.readFile.withArgs('/proc/self/mountinfo', 'utf8')
        .resolves(mountinfoWith(`${APPS_FOLDER}fluxapp1`));

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: true, alreadyMounted: true });
      expect(callsFor('mount')).to.have.lengthOf(0);
      expect(callsFor('mountpoint')).to.have.lengthOf(0);
    });

    it('should mount the discovered image and set the empty mountpoint immutable first', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.resolves([]);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: true, alreadyMounted: false });
      const chattr = callsFor('chattr');
      expect(chattr).to.have.lengthOf(1);
      expect(chattr[0].args[1].params).to.deep.equal(['+i', `${APPS_FOLDER}fluxapp1`]);
      const mount = callsFor('mount');
      expect(mount).to.have.lengthOf(1);
      // nosuid/nodev are asserted as part of the argv, not just the loop option:
      // a volume holds data its owner writes, so a setuid bit or a device node
      // arriving there - by extraction, by copy, by the app itself - must not be
      // honoured. Dropping either option is a silent privilege regression, so it
      // fails here rather than going unnoticed.
      expect(mount[0].args[1].params).to.deep.equal(['-o', 'loop,nosuid,nodev', '/dat/fluxapp1FLUXFSVOL', `${APPS_FOLDER}fluxapp1`]);
      // the flag must be set BEFORE the mount shadows the bare dir
      expect(chattr[0].calledBefore(mount[0])).to.be.true;
    });

    // The reason exists so a failing disk is not reported as a missing image,
    // and refusing is a choice: mount would have fallen back to a read-only
    // loop mount. Both halves are pinned - the reason, and that nothing is
    // mounted or made immutable on a filesystem that cannot take the write.
    it('refuses a volume on a read-only host filesystem, naming the disk', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda1', target: '/dat', readOnly: true },
      ]);
      // the refusal is taken from the full table, which is what a write
      // actually resolves through
      deviceHelperStub.listAllMounts.resolves([
        { source: '/dev/sda1', target: '/dat', fstype: 'ext4', readOnly: true },
      ]);
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.resolves([]);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: false, reason: 'host_filesystem_readonly' });
      expect(callsFor('mount')).to.have.lengthOf(0);
      expect(callsFor('chattr')).to.have.lengthOf(0);
    });

    it('should not set the immutable flag over leaked content, but still mount (shadowing it)', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.resolves(['leaked.db']);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.mounted).to.be.true;
      expect(callsFor('chattr')).to.have.lengthOf(0);
      expect(callsFor('mount')).to.have.lengthOf(1);
      expect(logStub.warn.calledWithMatch(/shadowed/)).to.be.true;
    });

    it('should create a missing mountpoint directory before mounting', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.rejects(enoent());

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.mounted).to.be.true;
      const mkdir = callsFor('mkdir');
      expect(mkdir).to.have.lengthOf(1);
      expect(mkdir[0].args[1].params).to.deep.equal(['-p', `${APPS_FOLDER}fluxapp1`]);
    });

    // Two reads of the same record are two chances to disagree, and the mount
    // is decided from both: the path to mount comes from one, the stamp it is
    // held to from the other. A record that changed between them, or a second
    // read that failed where the first did not, skips the check entirely.
    it('decides the mount from a single read of the record', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/mnt/data/fluxapp1FLUXFSVOL', fsUuid: 'u-1' });
      fsStub.promises.access.resolves();

      await volumeService.ensureAppVolumeMounted('app1');

      sinon.assert.calledOnce(appsRuntimeStateStub.getVolumeImage);
    });

    // The read-only check gates the mount, so a table that did not arrive
    // must not read as "nothing says read-only" and start a container over a
    // volume it cannot write to.
    it('does not mount when the table the read-only check needs did not arrive', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      appsRuntimeStateStub.getVolumeImage.resolves({ path: '/mnt/data/fluxapp1FLUXFSVOL', fsUuid: 'u-1' });
      fsStub.promises.access.resolves();
      deviceHelperStub.listAllMounts.rejects(new Error('findmnt failed'));

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: false, reason: 'mount_table_unreadable' });
      expect(
        serviceHelperStub.runCommand.getCalls().some((c) => c.args[0] === 'mount'),
        'mounted the volume without establishing the disk is writable',
      ).to.equal(false);
    });

    // A database that would not answer has not established that the image is
    // missing, and the reason a mount did not happen is what other services
    // act on: this one defers, and scores nothing against the operator.
    it('defers rather than deciding when the record could not be read', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      appsRuntimeStateStub.getVolumeImage.rejects(new Error('MongoNetworkError'));

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: false, reason: 'record_unreadable' });
      sinon.assert.notCalled(appsRuntimeStateStub.setVolumeImage);
    });

    // The reason a mount did not happen is what other services act on, so an
    // image nothing could look for must not arrive as one that is not there.
    it('reports the mount table, not a missing image, when it could not be read', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      deviceHelperStub.listMountedFilesystems.rejects(new Error('findmnt failed'));
      fsStub.promises.access.rejects(enoent());

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: false, reason: 'mount_table_unreadable' });
    });

    // The two ways a search can come up short are different faults, and the
    // reason is what an operator reads: naming the mount table for a disk
    // answering EIO sends whoever reads it to the wrong thing.
    it('names the unreadable path, not the mount table, when a candidate fails', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').rejects(Object.assign(new Error('EIO'), { code: 'EIO' }));

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: false, reason: 'candidate_path_unreadable' });
    });

    it('should report volume_file_missing when no image exists anywhere', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: false, reason: 'volume_file_missing' });
      expect(callsFor('mount')).to.have.lengthOf(0);
    });

    it('should treat a lost mount race as success when the dir turns out mounted', async () => {
      let mountpointCalls = 0;
      dispatchRunCommand({
        mountpoint: async () => {
          mountpointCalls += 1;
          // unmounted on the first probe; mounted on the re-probe after our own mount fails
          return mountpointCalls === 1
            ? { error: new Error('not mounted'), stdout: '', stderr: '' }
            : { error: null, stdout: '', stderr: '' };
        },
        mount: async () => ({ error: new Error('already mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.resolves([]);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: true, alreadyMounted: true });
    });

    // A mount failure says something about the image only once the host is
    // known to be able to mount at all. The two arms are pinned together so
    // neither reason can quietly absorb the other.
    it('reports the host, not the image, when no loop device can be had', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        mount: async () => ({ error: new Error('failed to set up loop device'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.access.withArgs('/dev/loop-control').rejects(enoent());
      fsStub.promises.readdir.resolves([]);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: false, reason: 'loop_unavailable' });
    });

    // mkdir -p fails both when the parent denies it and when the path is
    // already something else. Only the second says an app's directory was
    // replaced, and that one is not the host's doing.
    it('names a replaced app directory rather than an unavailable mountpoint', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        mkdir: async () => ({ error: new Error('File exists'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.readdir.rejects(Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }));
      fsStub.promises.lstat.resolves({ isDirectory: () => false });

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: false, reason: 'mount_point_not_a_directory' });
    });

    it('reports the mountpoint as unavailable when it is the parent that refuses', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        mkdir: async () => ({ error: new Error('Permission denied'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.readdir.rejects(enoent());
      fsStub.promises.lstat.rejects(enoent());

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.reason).to.include('mount_point_unavailable');
    });

    // The loop machinery being offered is not a device being free. A mount can
    // still fail for the host's reasons, so the image is asked directly: a
    // filesystem the kernel recognises means the failure was not the image,
    // and the operator is not scored for it.
    it('names the host when the mount fails over an image that still holds a filesystem', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        mount: async () => ({ error: new Error('could not find any free loop device'), stdout: '', stderr: '' }),
        blkid: async () => ({ error: null, stdout: 'ext4\n', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dev/loop-control').resolves();
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.resolves([]);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.mounted).to.be.false;
      expect(result.reason).to.include('mount_host_refused');
    });

    it('should report mount_failed when the mount fails and the dir stays unmounted', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        mount: async () => ({ error: new Error('bad superblock'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent());
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.resolves([]);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.mounted).to.be.false;
      expect(result.reason).to.include('mount_failed');
      expect(result.reason).to.include('bad superblock');
    });
  });

  describe('ensureMountPathsExist tests', () => {
    // the app dir reads as an already-mounted volume unless a test overrides it
    const mountCommands = () => serviceHelperStub.runCommand.getCalls().filter((c) => ['mkdir', 'touch', 'chmod', 'mount', 'chattr'].includes(c.args[0]));

    it('should refuse to create paths when the volume is missing (bare dir would take the writes)', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([{ name: 'appdata', isFile: false }]);
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(enoent()); // no volume image anywhere

      await expect(
        volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data' }, 'testapp', true, null),
      ).to.be.rejectedWith(/not mounted.*refusing to create/);
      expect(callsFor('mkdir')).to.have.lengthOf(0);
    });

    it('should skip creating paths that already exist', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'config.yaml', isFile: true },
      ]);
      fsStub.promises.access.resolves(); // every path exists

      await volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data|f:config.yaml:/etc/config.yaml' }, 'testapp', true, null);

      expect(fsStub.promises.access.callCount).to.equal(2);
      expect(mountCommands()).to.have.lengthOf(0); // nothing created
    });

    it('should create a missing file as root via touch + chmod (no shell, args passed as params)', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'config.yaml', isFile: true },
      ]);
      fsStub.promises.access.onFirstCall().resolves(); // appdata exists
      fsStub.promises.access.onSecondCall().rejects(enoent()); // config.yaml missing

      await volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data|f:config.yaml:/etc/config.yaml' }, 'testapp', true, null);

      const expectedPath = `${APPS_FOLDER}fluxwebserver_testapp/config.yaml`;
      const touch = callsFor('touch');
      const chmod = callsFor('chmod');
      expect(callsFor('mkdir')).to.have.lengthOf(0); // files are not mkdir'd
      expect(touch).to.have.lengthOf(1);
      expect(touch[0].args[1]).to.include({ runAsRoot: true });
      expect(touch[0].args[1].params).to.deep.equal([expectedPath]);
      expect(chmod).to.have.lengthOf(1);
      expect(chmod[0].args[1].params).to.deep.equal(['777', expectedPath]);
    });

    it('should create a missing directory as root via mkdir -p', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'logs', isFile: false },
      ]);
      fsStub.promises.access.onFirstCall().resolves(); // appdata exists
      fsStub.promises.access.onSecondCall().rejects(enoent()); // logs missing

      await volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data|m:logs:/var/log' }, 'testapp', true, null);

      const mkdir = callsFor('mkdir');
      expect(mkdir).to.have.lengthOf(1);
      expect(mkdir[0].args[1]).to.include({ runAsRoot: true });
      expect(mkdir[0].args[1].params).to.deep.equal(['-p', `${APPS_FOLDER}fluxwebserver_testapp/logs`]);
    });

    it('should create multiple missing files and directories', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'logs', isFile: false },
        { name: 'config.yaml', isFile: true },
        { name: 'cache', isFile: false },
      ]);
      fsStub.promises.access.onCall(0).resolves(); // appdata exists
      fsStub.promises.access.onCall(1).rejects(enoent()); // logs
      fsStub.promises.access.onCall(2).rejects(enoent()); // config.yaml
      fsStub.promises.access.onCall(3).rejects(enoent()); // cache

      await volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data|m:logs:/var/log|f:config.yaml:/etc/config.yaml|m:cache:/var/cache' }, 'testapp', true, null);

      // logs (mkdir) + config.yaml (touch+chmod) + cache (mkdir) = 4 commands
      expect(mountCommands()).to.have.lengthOf(4);
      expect(callsFor('mkdir')).to.have.lengthOf(2);
      expect(callsFor('touch')).to.have.lengthOf(1);
      expect(callsFor('chmod')).to.have.lengthOf(1);
    });

    it('should construct the identifier correctly for non-component apps', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxtestapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([{ name: 'appdata', isFile: false }]);
      fsStub.promises.access.resolves();

      await volumeService.ensureMountPathsExist({ containerData: '/data' }, 'testapp', false, null);

      expect(dockerServiceStub.getAppIdentifier.calledWith('testapp')).to.be.true;
    });

    it('should throw when containerData parsing fails', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.throws(new Error('Invalid containerData syntax'));

      await expect(
        volumeService.ensureMountPathsExist({ name: 'webserver', containerData: 'invalid:syntax:extra' }, 'testapp', true, null),
      ).to.be.rejectedWith('Invalid containerData syntax');
    });

    it('should propagate a runCommand failure as a thrown error', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([{ name: 'logs', isFile: false }]);
      fsStub.promises.access.rejects(enoent()); // missing → must create
      dispatchRunCommand({
        mkdir: async () => ({ error: new Error('mkdir failed'), stdout: '', stderr: '' }),
      });

      await expect(
        volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data' }, 'testapp', true, null),
      ).to.be.rejectedWith('mkdir failed');
    });

    it('should ensure component-reference paths exist (and not create them when present)', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxbackup_testapp');
      mountParserStub.parseContainerData.returns({
        allMounts: [
          { type: 'primary', subdir: 'appdata', isFile: false },
          {
            type: 'component_primary', componentIndex: 0, subdir: 'appdata', isFile: false,
          },
        ],
      });
      mountParserStub.getRequiredLocalPaths.returns([{ name: 'appdata', isFile: false }]); // refs filtered out here
      fsStub.promises.access.resolves(); // local + reference paths exist

      const fullAppSpecs = { version: 4, compose: [{ name: 'db' }, { name: 'backup' }] };
      await volumeService.ensureMountPathsExist({ name: 'backup', containerData: '/data|0:/database' }, 'testapp', true, fullAppSpecs);

      expect(fsStub.promises.access.callCount).to.be.at.least(1);
      expect(mountCommands()).to.have.lengthOf(0);
    });

    it('should throw when a component-reference mount has no full app specifications', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxbackup_testapp');
      mountParserStub.parseContainerData.returns({
        allMounts: [
          {
            type: 'component_primary', componentIndex: 0, subdir: 'appdata', containerPath: '/database', isFile: false,
          },
        ],
      });
      mountParserStub.getRequiredLocalPaths.returns([]);

      await expect(
        volumeService.ensureMountPathsExist({ name: 'backup', containerData: '/data|0:/database' }, 'testapp', true, null),
      ).to.be.rejectedWith('Component reference mount requires full app specifications');
    });
  });

  describe('clearAppVolumeData tests', () => {
    const FIND_ARGS = ['-mindepth', '1', '-maxdepth', '1', '-exec', 'rm', '-rf', '{}', '+'];

    beforeEach(() => {
      dockerServiceStub.getAppIdentifier.returns('fluxdb_MyApp');
    });

    it('empties the app data directory as root, in one command', async () => {
      await volumeService.clearAppVolumeData('db_MyApp');

      sinon.assert.calledOnce(serviceHelperStub.runCommand);
      const [cmd, opts] = serviceHelperStub.runCommand.firstCall.args;
      // Root for the LISTING as well as the delete. Enumerating host-side runs as
      // the FluxOS user, and an image that chmods its data dir 700 (postgres does)
      // makes that fail - which the caller correctly reads as a failed wipe and
      // then retries forever, so the component never starts again.
      expect(opts.runAsRoot).to.equal(true);
      expect(cmd).to.equal('find');
      // The path is load-bearing: the app ROOT holds the mount structure, and
      // wiping that instead of appdata destroys the volume rather than its
      // contents. -mindepth 1 empties the directory without removing it.
      expect(opts.params).to.deep.equal([`${APPS_FOLDER}fluxdb_MyApp/appdata`, ...FIND_ARGS]);
    });

    // THE CONTRACT. serviceHelper.runCommand never rejects - it resolves
    // { error, stdout, stderr } - so a caller that reads it as though it threw
    // ignores every failure. This logged "Deleted data for app X" when the wipe
    // had failed, and appReconciler's catch, which holds dataDesired at 'clear'
    // so a start cannot proceed onto un-wiped data, was unreachable.
    it('rejects when the wipe failed, rather than reporting success', async () => {
      serviceHelperStub.runCommand.onFirstCall().resolves({
        error: new Error('exit 1'), stdout: '', stderr: "rm: cannot remove '/x': Device or resource busy",
      });
      // the directory exists - the failure was real
      serviceHelperStub.runCommand.onSecondCall().resolves({ error: null, stdout: '', stderr: '' });

      await expect(volumeService.clearAppVolumeData('db_MyApp')).to.be.rejectedWith('Failed to delete data');

      expect(
        logStub.info.getCalls().some((call) => String(call.args[0]).includes('Deleted data')),
        'reported the data deleted when the wipe failed',
      ).to.equal(false);
    });

    // Nothing to clear is not a failed clear: an app whose volume was never
    // populated must not hold the reconciler on a retry forever. The stderr is
    // deliberately NOT the English message: find renders strerror in the node's
    // locale, so the classification must come from `test -d`'s exit status and
    // never from the words.
    it('returns quietly when there is no app data directory, whatever language find speaks', async () => {
      serviceHelperStub.runCommand.onFirstCall().resolves({
        error: new Error('exit 1'),
        stdout: '',
        stderr: "find: '/test/apps/folder/fluxdb_MyApp/appdata': Aucun fichier ou dossier de ce type",
      });
      // the directory does not exist - there was nothing to clear. execFile
      // rejects with the exit STATUS on `code`, and `test` says nothing at all
      serviceHelperStub.runCommand.onSecondCall().resolves({ error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: '', stderr: '' });

      await volumeService.clearAppVolumeData('db_MyApp');

      expect(
        logStub.info.getCalls().some((call) => String(call.args[0]).includes('No data to delete')),
      ).to.equal(true);
      // The classifier runs as root, like the wipe: an unprivileged check paired
      // with a root action fails on a data dir the image chmods to 700.
      const [cmd, opts] = serviceHelperStub.runCommand.secondCall.args;
      expect(cmd).to.equal('test');
      expect(opts.runAsRoot).to.equal(true);
      expect(opts.params).to.deep.equal(['-d', `${APPS_FOLDER}fluxdb_MyApp/appdata`]);
    });

    // `test` answers with its exit status and nothing else. sudo refusing, or a
    // spawn that never reached `test`, is not the probe answering - and reading
    // either as "nothing to delete" reports a wipe that did not happen, which
    // the caller acts on by starting the component over the data it asked to
    // be rid of.
    it('does not read a refused probe as an empty directory', async () => {
      serviceHelperStub.runCommand.onFirstCall().resolves({
        error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: '', stderr: 'find: cannot read',
      });
      serviceHelperStub.runCommand.onSecondCall().resolves({
        error: Object.assign(new Error('exit 1'), { code: 1 }),
        stdout: '',
        stderr: 'sudo: a password is required',
      });

      await expect(volumeService.clearAppVolumeData('db_MyApp')).to.be.rejectedWith(/Failed to delete data/);
      expect(
        logStub.info.getCalls().some((call) => String(call.args[0]).includes('No data to delete')),
        'reported nothing to delete when the probe was refused',
      ).to.equal(false);
    });

    it('does not read a probe that never ran as an empty directory', async () => {
      serviceHelperStub.runCommand.onFirstCall().resolves({
        error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: '', stderr: 'find: cannot read',
      });
      // a spawn failure carries a string code, never an exit status
      serviceHelperStub.runCommand.onSecondCall().resolves({
        error: Object.assign(new Error('spawn sudo ENOENT'), { code: 'ENOENT' }), stdout: '', stderr: '',
      });

      await expect(volumeService.clearAppVolumeData('db_MyApp')).to.be.rejectedWith(/Failed to delete data/);
    });

    it('reports what the wipe actually said, so a failure can be diagnosed', async () => {
      serviceHelperStub.runCommand.onFirstCall().resolves({
        error: new Error('exit 1'), stdout: '', stderr: 'rm: cannot remove: Read-only file system',
      });
      serviceHelperStub.runCommand.onSecondCall().resolves({ error: null, stdout: '', stderr: '' });

      await expect(volumeService.clearAppVolumeData('db_MyApp'))
        .to.be.rejectedWith(/Read-only file system/);
    });
  });
});
