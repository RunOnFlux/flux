const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

chai.use(chaiAsPromised);
const { expect } = chai;

describe('volumeService tests', () => {
  const APPS_FOLDER = '/test/apps/folder/';
  const APP_VOLUMES = '/test/flux/appvolumes';
  const LEGACY_APP_VOLUMES = '/test/fluxappvolumes';
  let dockerServiceStub;
  let serviceHelperStub;
  let mountParserStub;
  let fsStub;
  let deviceHelperStub;
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
    fsStub = { promises: { access: sinon.stub(), readdir: sinon.stub().resolves([]), readFile: sinon.stub().rejects(new Error('no mountinfo')) } };
    deviceHelperStub = { listMountedFilesystems: sinon.stub().resolves([]) };
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

  describe('capacityVolumesInGib tests', () => {
    const mount = (source, target, sizeBytes) => ({
      source, target, sizeBytes, usedBytes: 0, availableBytes: sizeBytes,
    });

    it('counts block-backed volumes', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('/dev/sdb1', '/dat2', 2e12),
      ]);

      const result = await volumeService.capacityVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat', '/dat2']);
    });

    it('excludes a volume that is not block-backed', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('tmpfs', '/run', 2e12),
      ]);

      const result = await volumeService.capacityVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat']);
    });

    it('excludes a loop device, which is an app volume rather than a host disk', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('/dev/loop3', '/dat/apps/fluxcomp_app', 2e12),
      ]);

      const result = await volumeService.capacityVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat']);
    });

    it('excludes a boot filesystem', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('/dev/sda2', '/boot', 2e12),
      ]);

      const result = await volumeService.capacityVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat']);
    });

    it('includes a loop-mounted root, which is the host disk on some images', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        mount('/dev/sda1', '/dat', 1e12),
        mount('/dev/loop0', '/', 2e12),
      ]);

      const result = await volumeService.capacityVolumesInGib();
      expect(result.map((v) => v.mount)).to.deep.equal(['/dat', '/']);
    });

    it('reports whole GiB', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda1', target: '/dat', sizeBytes: 1e12, usedBytes: 4e11, availableBytes: 6e11 },
      ]);

      const [volume] = await volumeService.capacityVolumesInGib();
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
      expect((await volumeService.capacityVolumesInGib())[0].available).to.equal(20);

      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda1', target: '/dat', sizeBytes: 2e10, usedBytes: 0, availableBytes: 2e10 },
      ]);
      expect((await volumeService.capacityVolumesInGib())[0].available).to.be.below(20);
    });
  });

  describe('getVolumeFilePath tests', () => {
    it('should find the image at the root of an eligible host volume', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([
        { source: '/dev/sda1', target: '/dat' },
        { source: 'tmpfs', target: '/run' },
      ]);
      fsStub.promises.access.rejects(new Error('ENOENT'));
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result).to.equal('/dat/fluxapp1FLUXFSVOL');
    });

    it('should not look for images at the root filesystem itself', async () => {
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/' }]);
      fsStub.promises.access.rejects(new Error('ENOENT'));

      await volumeService.getVolumeFilePath('fluxapp1');
      const checked = fsStub.promises.access.getCalls().map((c) => c.args[0]);
      expect(checked).to.not.include('/fluxapp1FLUXFSVOL');
    });

    it('should find the image in the appvolumes directory', async () => {
      fsStub.promises.access.rejects(new Error('ENOENT'));
      fsStub.promises.access.withArgs(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`).resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result).to.equal(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`);
    });

    it('should find an image left at the legacy glued appvolumes location', async () => {
      fsStub.promises.access.rejects(new Error('ENOENT'));
      fsStub.promises.access.withArgs(`${LEGACY_APP_VOLUMES}/fluxapp1FLUXFSVOL`).resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result).to.equal(`${LEGACY_APP_VOLUMES}/fluxapp1FLUXFSVOL`);
    });

    it('should return null when the image exists nowhere', async () => {
      fsStub.promises.access.rejects(new Error('ENOENT'));

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result).to.be.null;
    });

    it('should still check appvolumes locations when the mount table cannot be read', async () => {
      deviceHelperStub.listMountedFilesystems.rejects(new Error('findmnt failed'));
      fsStub.promises.access.rejects(new Error('ENOENT'));
      fsStub.promises.access.withArgs(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`).resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result).to.equal(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`);
    });
  });

  describe('ensureAppVolumeMounted tests', () => {
    beforeEach(() => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      deviceHelperStub.listMountedFilesystems.resolves([{ source: '/dev/sda1', target: '/dat' }]);
    });

    it('should be a no-op when the app dir is already a mountpoint', async () => {
      // the mountedness comes from mountinfo - proving the composition once
      fsStub.promises.readFile.resolves(mountinfoWith(`${APPS_FOLDER}fluxapp1`));

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: true, alreadyMounted: true });
      expect(callsFor('mount')).to.have.lengthOf(0);
      expect(callsFor('mountpoint')).to.have.lengthOf(0);
    });

    it('should mount the discovered image and set the empty mountpoint immutable first', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(new Error('ENOENT'));
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

    it('should not set the immutable flag over leaked content, but still mount (shadowing it)', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(new Error('ENOENT'));
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
      fsStub.promises.access.rejects(new Error('ENOENT'));
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.rejects(new Error('ENOENT'));

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result.mounted).to.be.true;
      const mkdir = callsFor('mkdir');
      expect(mkdir).to.have.lengthOf(1);
      expect(mkdir[0].args[1].params).to.deep.equal(['-p', `${APPS_FOLDER}fluxapp1`]);
    });

    it('should report volume_file_missing when no image exists anywhere', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(new Error('ENOENT'));

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
      fsStub.promises.access.rejects(new Error('ENOENT'));
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();
      fsStub.promises.readdir.resolves([]);

      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: true, alreadyMounted: true });
    });

    it('should report mount_failed when the mount fails and the dir stays unmounted', async () => {
      dispatchRunCommand({
        mountpoint: async () => ({ error: new Error('not mounted'), stdout: '', stderr: '' }),
        mount: async () => ({ error: new Error('bad superblock'), stdout: '', stderr: '' }),
      });
      fsStub.promises.access.rejects(new Error('ENOENT'));
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
      fsStub.promises.access.rejects(new Error('ENOENT')); // no volume image anywhere

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
      fsStub.promises.access.onSecondCall().rejects(new Error('ENOENT')); // config.yaml missing

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
      fsStub.promises.access.onSecondCall().rejects(new Error('ENOENT')); // logs missing

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
      fsStub.promises.access.onCall(1).rejects(new Error('ENOENT')); // logs
      fsStub.promises.access.onCall(2).rejects(new Error('ENOENT')); // config.yaml
      fsStub.promises.access.onCall(3).rejects(new Error('ENOENT')); // cache

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
      fsStub.promises.access.rejects(new Error('ENOENT')); // missing → must create
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
    beforeEach(() => {
      dockerServiceStub.getAppIdentifier.returns('fluxdb_MyApp');
      fsStub.promises.readdir.resolves(['one', 'two']);
    });

    it('deletes every entry under the app data directory', async () => {
      await volumeService.clearAppVolumeData('db_MyApp');

      expect(serviceHelperStub.runCommand.callCount).to.equal(2);
      const [cmd, opts] = serviceHelperStub.runCommand.firstCall.args;
      expect(cmd).to.equal('rm');
      // The path is load-bearing: the app ROOT holds the mount structure, and
      // wiping that instead of appdata destroys the volume rather than its
      // contents.
      expect(opts.params).to.deep.equal(['-rf', `${APPS_FOLDER}fluxdb_MyApp/appdata/one`]);
      // Without root the rm silently does nothing on a real node - the data
      // survives and the caller is told it is gone.
      expect(opts.runAsRoot).to.equal(true);
    });

    // THE CONTRACT. serviceHelper.runCommand never rejects - it resolves
    // { error, stdout, stderr } - so a caller that reads it as though it threw
    // ignores every failure. This logged "Deleted data for app X" when every
    // delete had failed, and the reconciler's catch, which holds dataDesired at
    // 'clear' so a start cannot proceed onto un-wiped data, was unreachable.
    it('rejects when a delete failed, rather than reporting success', async () => {
      serviceHelperStub.runCommand.resolves({ error: new Error('Device or resource busy'), stdout: '', stderr: '' });

      await expect(volumeService.clearAppVolumeData('db_MyApp')).to.be.rejectedWith('Failed to delete');

      expect(
        logStub.info.getCalls().some((call) => String(call.args[0]).includes('Deleted data')),
        'reported the data deleted when every delete failed',
      ).to.equal(false);
    });

    it('rejects when only some of the deletes failed', async () => {
      serviceHelperStub.runCommand.onFirstCall().resolves({ error: null, stdout: '', stderr: '' });
      serviceHelperStub.runCommand.onSecondCall().resolves({ error: new Error('busy'), stdout: '', stderr: '' });

      await expect(volumeService.clearAppVolumeData('db_MyApp')).to.be.rejectedWith('Failed to delete 1 of 2');
    });

    // Nothing to clear is not a failed clear: an app whose volume was never
    // populated must not hold the reconciler on a retry forever.
    it('returns quietly when there is no app data directory', async () => {
      const missing = new Error('ENOENT: no such file or directory');
      missing.code = 'ENOENT';
      fsStub.promises.readdir.rejects(missing);

      await volumeService.clearAppVolumeData('db_MyApp');

      expect(serviceHelperStub.runCommand.called).to.equal(false);
    });

    it('rejects when the app data directory cannot be read for any other reason', async () => {
      const denied = new Error('EACCES: permission denied');
      denied.code = 'EACCES';
      fsStub.promises.readdir.rejects(denied);

      await expect(volumeService.clearAppVolumeData('db_MyApp')).to.be.rejectedWith('EACCES');
    });
  });
});
