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
  let dfStub;
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
    fsStub = { promises: { access: sinon.stub(), readdir: sinon.stub().resolves([]) } };
    dfStub = sinon.stub().callsArgWith(1, null, []); // node-df callback style: (options, cb)
    logStub = {
      info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
    };

    volumeService = proxyquire('../../ZelBack/src/services/utils/volumeService', {
      '../dockerService': dockerServiceStub,
      '../serviceHelper': serviceHelperStub,
      './mountParser': mountParserStub,
      './appConstants': { appsFolder: APPS_FOLDER, appVolumesPath: APP_VOLUMES, legacyAppVolumesPath: LEGACY_APP_VOLUMES },
      '../../lib/log': logStub,
      'node-df': dfStub,
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

  describe('isPathMounted tests', () => {
    it('should return true when mountpoint -q succeeds', async () => {
      const result = await volumeService.isPathMounted('/some/dir');
      expect(result).to.be.true;
      const probe = callsFor('mountpoint');
      expect(probe).to.have.lengthOf(1);
      expect(probe[0].args[1].params).to.deep.equal(['-q', '/some/dir']);
    });

    it('should return false when mountpoint -q fails', async () => {
      serviceHelperStub.runCommand.resolves({ error: new Error('not a mountpoint'), stdout: '', stderr: '' });
      const result = await volumeService.isPathMounted('/some/dir');
      expect(result).to.be.false;
    });
  });

  describe('getVolumeFilePath tests', () => {
    it('should find the image at the root of an eligible df volume', async () => {
      dfStub.callsArgWith(1, null, [
        { filesystem: '/dev/sda1', mount: '/dat' },
        { filesystem: 'tmpfs', mount: '/run' },
      ]);
      fsStub.promises.access.rejects(new Error('ENOENT'));
      fsStub.promises.access.withArgs('/dat/fluxapp1FLUXFSVOL').resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result).to.equal('/dat/fluxapp1FLUXFSVOL');
    });

    it('should not look for images at the root filesystem itself', async () => {
      dfStub.callsArgWith(1, null, [{ filesystem: '/dev/sda1', mount: '/' }]);
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

    it('should still check appvolumes locations when df fails', async () => {
      dfStub.callsArgWith(1, new Error('df failed'), null);
      fsStub.promises.access.rejects(new Error('ENOENT'));
      fsStub.promises.access.withArgs(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`).resolves();

      const result = await volumeService.getVolumeFilePath('fluxapp1');
      expect(result).to.equal(`${APP_VOLUMES}/fluxapp1FLUXFSVOL`);
    });
  });

  describe('ensureAppVolumeMounted tests', () => {
    beforeEach(() => {
      dockerServiceStub.getAppIdentifier.returns('fluxapp1');
      dfStub.callsArgWith(1, null, [{ filesystem: '/dev/sda1', mount: '/dat' }]);
    });

    it('should be a no-op when the app dir is already a mountpoint', async () => {
      const result = await volumeService.ensureAppVolumeMounted('app1');

      expect(result).to.deep.equal({ mounted: true, alreadyMounted: true });
      expect(callsFor('mount')).to.have.lengthOf(0);
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
      expect(mount[0].args[1].params).to.deep.equal(['-o', 'loop', '/dat/fluxapp1FLUXFSVOL', `${APPS_FOLDER}fluxapp1`]);
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
});
