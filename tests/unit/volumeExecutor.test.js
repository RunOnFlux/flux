const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

chai.use(chaiAsPromised);
const { expect } = chai;

describe('volumeExecutor tests', () => {
  const APPS_FOLDER = '/test/apps/folder/';
  const MOUNT = `${APPS_FOLDER}fluxcomp_myapp`;
  const IMAGE = 'ghcr.io/runonflux/flux-volume-tools@sha256:deadbeef';

  let dockerServiceStub;
  let deviceHelperStub;
  let serviceHelperStub;
  let containerStub;
  let volumeSession;
  let volumeExecutor;

  const configStub = {
    fluxapps: {
      volumeOperations: {
        image: IMAGE,
        maxConcurrentPerApp: 1,
        maxConcurrentPerNode: 2,
        timeoutMs: 900000,
        memoryBytes: 512 * 1024 * 1024,
        pidsLimit: 256,
        progressIntervalMs: 50,
      },
    },
  };

  const appConstantsStub = {
    appsFolder: APPS_FOLDER,
    APP_NAME_REGEX: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
    APP_NAME_REGEX_LEGACY: /^[a-zA-Z0-9]+$/,
  };

  const mountRow = (target) => ({
    source: '/dev/loop3', target, fstype: 'ext4', sizeBytes: 2e9, usedBytes: 1e9, availableBytes: 1e9, usePercent: 50,
  });

  const openSession = async () => volumeSession.openVolume({ params: { appname: 'myapp', component: 'comp' }, query: {} });

  beforeEach(() => {
    deviceHelperStub = { listMountedFilesystems: sinon.stub().resolves([mountRow(MOUNT)]) };

    containerStub = {
      id: 'container-1',
      start: sinon.stub().resolves(),
      kill: sinon.stub().resolves(),
      wait: sinon.stub().resolves({ StatusCode: 0 }),
    };

    dockerServiceStub = {
      createContainer: sinon.stub().resolves(containerStub),
      dockerListContainers: sinon.stub().resolves([]),
      appDockerForceRemove: sinon.stub().resolves(),
    };

    serviceHelperStub = {
      ensureString: sinon.stub().callsFake((v) => (typeof v === 'string' ? v : JSON.stringify(v))),
      runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }),
    };

    volumeSession = proxyquire('../../ZelBack/src/services/appSystem/volumeSession', {
      '../deviceHelper': deviceHelperStub,
      '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
      '../IOUtils': { getFolderSize: sinon.stub(), getFileSize: sinon.stub() },
      '../utils/appConstants': appConstantsStub,
    });

    volumeExecutor = proxyquire('../../ZelBack/src/services/appSystem/volumeExecutor', {
      config: configStub,
      '../dockerService': dockerServiceStub,
      '../deviceHelper': deviceHelperStub,
      '../serviceHelper': serviceHelperStub,
      '../../lib/log': {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
      },
      '../utils/appConstants': appConstantsStub,
      './volumeSession': volumeSession,
    });
  });

  afterEach(() => sinon.restore());

  describe('run - container configuration', () => {
    it('binds only the app volume, and binds the mount the session resolved', async () => {
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      const [options] = dockerServiceStub.createContainer.firstCall.args;
      expect(options.HostConfig.Binds).to.deep.equal([`${MOUNT}:/work`]);
      expect(options.Image).to.equal(IMAGE);
    });

    it('drops every capability except the three cp -a needs', async () => {
      // Without CHOWN, cp -a writes root-owned files and exits 0 - an app
      // running as a non-root user silently loses access to its own data.
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      const [options] = dockerServiceStub.createContainer.firstCall.args;
      expect(options.HostConfig.CapDrop).to.deep.equal(['ALL']);
      expect(options.HostConfig.CapAdd).to.deep.equal(['CHOWN', 'FOWNER', 'DAC_OVERRIDE']);
    });

    it('runs read-only, without a network, and cannot escalate privilege', async () => {
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      const { HostConfig } = dockerServiceStub.createContainer.firstCall.args[0];
      expect(HostConfig.ReadonlyRootfs).to.equal(true);
      expect(HostConfig.NetworkMode).to.equal('none');
      expect(HostConfig.SecurityOpt).to.deep.equal(['no-new-privileges']);
      expect(HostConfig.AutoRemove).to.equal(true);
    });

    it('never disables seccomp', async () => {
      // The change someone makes to "fix" a mystery permissions error, which
      // removes the syscall filter for every operation.
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      const { SecurityOpt } = dockerServiceStub.createContainer.firstCall.args[0].HostConfig;
      expect(SecurityOpt.join(' ')).to.not.match(/seccomp/);
    });

    it('labels the container so the app sweeps cannot reach it', async () => {
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      const [options] = dockerServiceStub.createContainer.firstCall.args;
      expect(options.Labels['runonflux.role']).to.equal('fileop');
    });
  });

  describe('run - exit handling', () => {
    it('subscribes to the exit before starting the container', async () => {
      // wait() defaults to "not-running", which a CREATED container already
      // satisfies; and asking after start races a fast command being reaped by
      // AutoRemove before the request lands.
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      expect(containerStub.wait.calledBefore(containerStub.start)).to.equal(true);
      expect(containerStub.wait.firstCall.args[0]).to.deep.equal({ condition: 'next-exit' });
    });

    it('fails when the command exits non-zero', async () => {
      containerStub.wait.resolves({ StatusCode: 2 });
      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['false'])).to.be.rejectedWith('exit code 2');
    });

    it('kills the container when a cancel is requested', async () => {
      // Cancellation is cooperative: requestCancel raises a flag and the worker
      // stops at its next checkpoint. Something has to look, and the progress
      // ticker is already looking.
      let finish;
      containerStub.wait.returns(new Promise((resolve) => { finish = resolve; }));

      let canceled = false;
      const vol = await openSession();
      const running = volumeExecutor.run(vol, ['true'], { isCanceled: () => canceled });

      canceled = true;
      await new Promise((resolve) => { setTimeout(resolve, 120); });
      expect(containerStub.kill.called).to.equal(true);

      finish({ StatusCode: 0 });
      await running;
    });

    it('reports progress to the caller rather than to a response', async () => {
      // No res: the work outlives the request that started it, so progress goes
      // somewhere a poll can read it.
      const lines = [];
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true'], {
        status: 'Copying...',
        onProgress: (line) => lines.push(line),
      });

      expect(lines).to.deep.equal(['Copying...']);
    });
  });

  describe('run - publish options', () => {
    it('passes the byte ceiling and link refusal to flux-op', async () => {
      const vol = await openSession();
      const staging = await vol.resolve('.flux-op-x');
      const destination = await vol.resolve('out');

      await volumeExecutor.run(vol, ['tar', '-xzf', '/work/a.tgz'], {
        publish: { staging, destination }, mkdirStaging: true, maxBytes: 1234.7, noLinks: true,
      });

      const { Cmd } = dockerServiceStub.createContainer.firstCall.args[0];
      expect(Cmd.slice(0, 7)).to.deep.equal([
        'flux-op', '--mkdir', '--max-bytes', '1234', '--no-links', '/work/.flux-op-x', '/work/out',
      ]);
    });

    it('omits the options that were not asked for', async () => {
      const vol = await openSession();
      const staging = await vol.resolve('.flux-op-y');
      const destination = await vol.resolve('out');

      await volumeExecutor.run(vol, ['cp'], { publish: { staging, destination } });

      const { Cmd } = dockerServiceStub.createContainer.firstCall.args[0];
      expect(Cmd.slice(0, 4)).to.deep.equal(['flux-op', '/work/.flux-op-y', '/work/out', '--']);
    });
  });

  describe('run - operand handling', () => {
    it('passes a VolumePath as its container path, not its host path', async () => {
      const vol = await openSession();
      const target = await vol.resolve('uploads/photo.jpg');
      await volumeExecutor.run(vol, ['cp', '-a', '-T', target, target]);

      const { Cmd } = dockerServiceStub.createContainer.firstCall.args[0];
      expect(Cmd).to.deep.equal(['cp', '-a', '-T', '/work/uploads/photo.jpg', '/work/uploads/photo.jpg']);
      expect(Cmd.join(' ')).to.not.include(MOUNT);
    });

    it('refuses an absolute operand outside the container work root', async () => {
      // A caller passing a host path has gone round the session.
      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['cp', '/etc/passwd', '/work/x']))
        .to.be.rejectedWith('Refusing an absolute path operand');
      expect(dockerServiceStub.createContainer.called).to.equal(false);
    });

    it('refuses a session that is not a VolumeSession', async () => {
      await expect(volumeExecutor.run({ mount: MOUNT }, ['true']))
        .to.be.rejectedWith('requires a VolumeSession');
    });
  });

  describe('run - mount assertion', () => {
    it('refuses to bind a volume that is no longer mounted', async () => {
      // Binding an unmounted mountpoint would bind a plain host directory.
      const vol = await openSession();
      deviceHelperStub.listMountedFilesystems.resolves([]);

      await expect(volumeExecutor.run(vol, ['true'])).to.be.rejectedWith('no longer mounted');
      expect(dockerServiceStub.createContainer.called).to.equal(false);
    });
  });

  describe('run - concurrency', () => {
    it('marks a refusal busy, so the HTTP layer can answer 503 rather than a generic error', async () => {
      let release;
      containerStub.wait.returns(new Promise((resolve) => { release = resolve; }));

      const vol = await openSession();
      const first = volumeExecutor.run(vol, ['true']);

      const error = await volumeExecutor.run(await openSession(), ['true']).catch((e) => e);
      expect(error.kind).to.equal('busy');
      expect(error.retryAfterMs).to.be.a('number');

      release({ StatusCode: 0 });
      await first;
    });

    it('assertCapacity refuses without consuming a slot', async () => {
      const vol = await openSession();
      // Called twice: if it took a slot, the second would refuse.
      expect(() => volumeExecutor.assertCapacity(vol)).to.not.throw();
      expect(() => volumeExecutor.assertCapacity(vol)).to.not.throw();
    });

    it('refuses a second operation for the same app rather than queueing it', async () => {
      // Queueing holds the request open behind someone else's long copy until
      // an intermediate proxy kills it, which reads as an unexplained failure.
      let releaseFirst;
      containerStub.wait.returns(new Promise((resolve) => { releaseFirst = resolve; }));

      const vol = await openSession();
      const first = volumeExecutor.run(vol, ['true']);

      await expect(volumeExecutor.run(await openSession(), ['true']))
        .to.be.rejectedWith('Another file operation is already running');

      releaseFirst({ StatusCode: 0 });
      await first;
    });

    it('frees the slot once the operation finishes', async () => {
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);
      await volumeExecutor.run(vol, ['true']);
      expect(dockerServiceStub.createContainer.callCount).to.equal(2);
    });

    it('frees the slot when the operation fails', async () => {
      containerStub.wait.resolves({ StatusCode: 1 });
      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['false'])).to.be.rejected;

      containerStub.wait.resolves({ StatusCode: 0 });
      await expect(volumeExecutor.run(vol, ['true'])).to.not.be.rejected;
    });

    it('caps concurrent operations across the whole node', async () => {
      const holds = [];
      containerStub.wait.callsFake(() => new Promise((resolve) => holds.push(resolve)));

      const sessionFor = async (appname) => {
        deviceHelperStub.listMountedFilesystems.resolves([mountRow(`${APPS_FOLDER}fluxcomp_${appname}`)]);
        return volumeSession.openVolume({ params: { appname, component: 'comp' }, query: {} });
      };

      const a = volumeExecutor.run(await sessionFor('appone'), ['true']);
      const b = volumeExecutor.run(await sessionFor('apptwo'), ['true']);
      // node cap is 2 in this config
      await expect(volumeExecutor.run(await sessionFor('appthree'), ['true']))
        .to.be.rejectedWith('maximum number of file operations');

      holds.forEach((resolve) => resolve({ StatusCode: 0 }));
      await Promise.all([a, b]);
    });
  });

  describe('reapOrphanedContainers', () => {
    it('removes containers left running by a restart, selected by label', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Id: 'fileop-1', Labels: { 'runonflux.role': 'fileop' } },
        { Id: 'app-1', Labels: { 'runonflux.role': 'app' } },
        { Id: 'unlabelled', Labels: {} },
      ]);

      const removed = await volumeExecutor.reapOrphanedContainers();

      expect(removed).to.equal(1);
      expect(dockerServiceStub.appDockerForceRemove.calledOnceWith('fileop-1', false)).to.equal(true);
    });
  });

  describe('sweepStagingDirectories', () => {
    const fsFor = (entries, files = {}, existing = []) => ({
      readdir: sinon.stub().resolves(entries),
      readFile: sinon.stub().callsFake(async (p) => {
        const name = p.split('/').pop();
        if (files[name] === undefined) throw new Error('ENOENT');
        return files[name];
      }),
      lstat: sinon.stub().callsFake(async (p) => {
        if (!existing.includes(p)) throw new Error('ENOENT');
        return {};
      }),
    });

    it('deletes an incomplete operation - nothing was published and nobody waits', async () => {
      const fsp = fsFor(['.flux-op-abc', 'realdata']);
      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(removed).to.deep.equal(['.flux-op-abc']);
      expect(restored).to.deep.equal([]);
    });

    it('restores displaced data when the destination is missing', async () => {
      // The crash-between-two-renames case. Deleting here would destroy the
      // caller's only copy.
      const fsp = fsFor(
        ['.flux-old-abc', '.flux-old-abc.dest'],
        { '.flux-old-abc.dest': `${MOUNT}/photos\n` },
        [],
      );

      const { restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(restored).to.deep.equal([`${MOUNT}/photos`]);
      const mv = serviceHelperStub.runCommand.getCalls().find((c) => c.args[0] === 'mv');
      expect(mv.args[1].params).to.deep.equal(['-T', `${MOUNT}/.flux-old-abc`, `${MOUNT}/photos`]);
    });

    it('deletes displaced data when the publish completed', async () => {
      const fsp = fsFor(
        ['.flux-old-abc', '.flux-old-abc.dest'],
        { '.flux-old-abc.dest': `${MOUNT}/photos\n` },
        [`${MOUNT}/photos`],
      );

      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(restored).to.deep.equal([]);
      expect(removed).to.include('.flux-old-abc');
      expect(serviceHelperStub.runCommand.getCalls().some((c) => c.args[0] === 'mv')).to.equal(false);
    });

    it('leaves everything else on the volume alone', async () => {
      const fsp = fsFor(['uploads', 'wp-config.php', '.htaccess']);
      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(serviceHelperStub.runCommand.called).to.equal(false);
    });

    it('reports nothing when the volume cannot be read', async () => {
      const fsp = { readdir: sinon.stub().rejects(new Error('EACCES')) };
      const result = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);
      expect(result).to.deep.equal({ removed: [], restored: [] });
    });
  });
});
