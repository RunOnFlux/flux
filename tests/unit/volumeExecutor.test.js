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
  let fsStub;
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
        cancelGraceSeconds: 15,
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
      stop: sinon.stub().resolves(),
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

    // Only the progress walk reads this - the sweep takes its fs as an
    // argument. Deliberately WITHOUT a `stat`, so a walk that followed symlinks
    // would fail loudly here rather than silently leaving the volume.
    fsStub = { promises: { lstat: sinon.stub().rejects(new Error('ENOENT')), readdir: sinon.stub().resolves([]) } };

    volumeSession = proxyquire('../../ZelBack/src/services/appSystem/volumeSession', {
      '../deviceHelper': deviceHelperStub,
      '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
      '../IOUtils': { getFolderSize: sinon.stub(), getFileSize: sinon.stub() },
      '../utils/appConstants': appConstantsStub,
    });

    volumeExecutor = proxyquire('../../ZelBack/src/services/appSystem/volumeExecutor', {
      config: configStub,
      fs: fsStub,
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

    it('stops the container when a cancel is requested, rather than killing it', async () => {
      // Cancellation is cooperative: requestCancel raises a flag and the worker
      // stops at its next checkpoint. Something has to look, and the progress
      // ticker is already looking.
      //
      // stop, not kill. Docker's kill sends SIGKILL, which cannot be trapped -
      // flux-op never runs its cleanup and the staging directory stays on the
      // caller's volume until the next boot sweep. stop sends SIGTERM first and
      // only escalates after the grace period.
      let finish;
      containerStub.wait.returns(new Promise((resolve) => { finish = resolve; }));

      let canceled = false;
      const vol = await openSession();
      const running = volumeExecutor.run(vol, ['true'], { isCanceled: () => canceled });

      canceled = true;
      await new Promise((resolve) => { setTimeout(resolve, 120); });
      expect(containerStub.stop.called).to.equal(true);
      expect(containerStub.stop.firstCall.args[0]).to.deep.equal({ t: 15 });
      expect(containerStub.kill.called).to.equal(false);

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
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    // Everything up to the `--`, with --id's value replaced by a marker so a
    // random uuid does not have to be threaded through every expectation.
    const flags = (cmd) => {
      const end = cmd.indexOf('--', 1);
      return cmd.slice(0, end === -1 ? cmd.length : end)
        .map((arg, i, all) => (all[i - 1] === '--id' ? '<uuid>' : arg));
    };

    it('names the operation and the volume root for flux-op', async () => {
      const vol = await openSession();
      const staging = await vol.resolve('.flux-op-y');
      const destination = await vol.resolve('out');

      await volumeExecutor.run(vol, ['cp'], { publish: { staging, destination } });

      const { Cmd } = dockerServiceStub.createContainer.firstCall.args[0];
      expect(Cmd[1]).to.equal('--id');
      expect(Cmd[2]).to.match(UUID);
      expect(flags(Cmd)).to.deep.equal([
        'flux-op', '--id', '<uuid>', '--root', '/work', '--discard-staging',
        '/work/.flux-op-y', '/work/out',
      ]);
    });

    it('passes the byte ceiling and link refusal to flux-op', async () => {
      const vol = await openSession();
      const staging = await vol.resolve('.flux-op-x');
      const destination = await vol.resolve('out');

      await volumeExecutor.run(vol, ['tar', '-xzf', '/work/a.tgz'], {
        publish: { staging, destination }, mkdirStaging: true, maxBytes: 1234.7, noLinks: true,
      });

      const { Cmd } = dockerServiceStub.createContainer.firstCall.args[0];
      expect(flags(Cmd)).to.deep.equal([
        'flux-op', '--id', '<uuid>', '--root', '/work', '--discard-staging', '--mkdir',
        '--max-bytes', '1234', '--no-links', '/work/.flux-op-x', '/work/out',
      ]);
    });

    it('publishes a source in place, with no command and nothing to discard', async () => {
      // How a move and a rename are expressed: the caller's own entry IS the
      // result. --discard-staging must be absent, because that operand is their
      // only copy - and the command after `--` is empty, which flux-op has to
      // accept rather than reject as a usage error.
      const vol = await openSession();
      const source = await vol.resolve('photos');
      const destination = await vol.resolve('out');

      await volumeExecutor.run(vol, [], { publish: { source, destination } });

      const { Cmd } = dockerServiceStub.createContainer.firstCall.args[0];
      expect(Cmd).to.not.include('--discard-staging');
      expect(Cmd[Cmd.length - 1]).to.equal('--');
      expect(flags(Cmd)).to.deep.equal([
        'flux-op', '--id', '<uuid>', '--root', '/work', '/work/photos', '/work/out',
      ]);
    });

    it('refuses a publish naming both a staging and a source, or neither', async () => {
      const vol = await openSession();
      const one = await vol.resolve('photos');
      const two = await vol.resolve('out');

      await expect(volumeExecutor.run(vol, [], { publish: { staging: one, source: one, destination: two } }))
        .to.be.rejectedWith('exactly one');
      await expect(volumeExecutor.run(vol, [], { publish: { destination: two } }))
        .to.be.rejectedWith('exactly one');
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
    // flux-op derives both names from the staging directory's randomUUID, so a
    // fixture that is not one is not a fixture for anything this ever sees.
    const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const OP = `.flux-op-${ID}`;
    const OLD = `.flux-old-${ID}`;

    // The real fs sets .code, and the sweep tells an absent marker apart from
    // an unreadable one by exactly that - a bare Error would make every read
    // failure look like "no marker was ever written", and it deletes on the
    // strength of that.
    const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

    const fsFor = (entries, files = {}, existing = []) => ({
      readdir: sinon.stub().resolves(entries),
      readFile: sinon.stub().callsFake(async (p) => {
        const name = p.split('/').pop();
        if (files[name] === undefined) throw enoent();
        return files[name];
      }),
      lstat: sinon.stub().callsFake(async (p) => {
        if (!existing.includes(p)) throw enoent();
        return {};
      }),
    });

    const mvCalls = () => serviceHelperStub.runCommand.getCalls().filter((c) => c.args[0] === 'mv');

    it('deletes an incomplete operation - nothing was published and nobody waits', async () => {
      const fsp = fsFor([OP, 'realdata']);
      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(removed).to.deep.equal([OP]);
      expect(restored).to.deep.equal([]);
    });

    it('restores displaced data when the destination is missing', async () => {
      // The crash-between-two-renames case. Deleting here would destroy the
      // caller's only copy. The marker holds a path relative to the volume
      // root, because flux-op writes it from inside a container that has only
      // that root and no notion of where it sits on the host.
      const fsp = fsFor([OLD, `${OLD}.dest`], { [`${OLD}.dest`]: 'photos\n' }, []);

      const { restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(restored).to.deep.equal([`${MOUNT}/photos`]);
      expect(mvCalls()[0].args[1].params).to.deep.equal(['-T', `${MOUNT}/${OLD}`, `${MOUNT}/photos`]);
    });

    it('restores from a marker written by an older image', async () => {
      // flux-op records the destination relative to the volume root. Images
      // before it wrote the container path, and a node upgrading FluxOS can be
      // holding either - refusing the older one would strand exactly the data
      // this branch exists to put back.
      const fsp = fsFor([OLD, `${OLD}.dest`], { [`${OLD}.dest`]: '/work/photos\n' }, []);

      const { restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(restored).to.deep.equal([`${MOUNT}/photos`]);
      expect(mvCalls()[0].args[1].params).to.deep.equal(['-T', `${MOUNT}/${OLD}`, `${MOUNT}/photos`]);
    });

    it('refuses a relative marker that climbs out of the volume', async () => {
      const fsp = fsFor([OLD, `${OLD}.dest`], { [`${OLD}.dest`]: '../../etc/shadow\n' }, []);

      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(mvCalls()).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(removed).to.deep.equal([]);
    });

    it('refuses a marker naming a path outside the volume, and keeps the data', async () => {
      // The marker lives in a directory the app owner can write to. Read as a
      // host path it makes `mv` a way to create a root-owned file anywhere on
      // the node, /etc/cron.d being the short route from there to running code.
      // Nothing is moved - and the displaced entry is not deleted either, since
      // it may be somebody's only copy.
      const fsp = fsFor([OLD, `${OLD}.dest`], { [`${OLD}.dest`]: '/etc/cron.d/pwn\n' }, []);

      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(mvCalls()).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(removed).to.deep.equal([]);
    });

    it('refuses a marker that climbs out of the work root', async () => {
      const fsp = fsFor([OLD, `${OLD}.dest`], { [`${OLD}.dest`]: '/work/../../../etc/shadow\n' }, []);

      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(mvCalls()).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(removed).to.deep.equal([]);
    });

    it('deletes displaced data when the publish completed', async () => {
      const fsp = fsFor([OLD, `${OLD}.dest`], { [`${OLD}.dest`]: '/work/photos\n' }, [`${MOUNT}/photos`]);

      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(restored).to.deep.equal([]);
      expect(removed).to.include(OLD);
      expect(mvCalls()).to.deep.equal([]);
    });

    it('deletes a marker whose entry never arrived', async () => {
      // The crash landed between writing the marker and the rename that uses
      // it, so nothing was displaced. Without this it stays in the volume root
      // forever, one per interruption, visible in the file browser.
      const fsp = fsFor([`${OLD}.dest`], { [`${OLD}.dest`]: '/work/photos\n' }, []);

      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(removed).to.deep.equal([`${OLD}.dest`]);
      expect(restored).to.deep.equal([]);
    });

    it('keeps displaced data when its marker cannot be read', async () => {
      const fsp = fsFor([OLD, `${OLD}.dest`], {}, []);
      fsp.readFile = sinon.stub().rejects(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
    });

    it('leaves a user folder that merely starts with a reserved prefix', async () => {
      // Nothing reserves these prefixes at creation time, and the sweep DELETES
      // what it matches - so the name has to be the exact shape flux-op
      // produces, not just something that begins like it.
      const fsp = fsFor(['.flux-op-backups', '.flux-old-notes', '.flux-op-', `${OP}x`]);

      const { removed, restored } = await volumeExecutor.sweepStagingDirectories(MOUNT, fsp);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(serviceHelperStub.runCommand.called).to.equal(false);
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

  describe('run - byte progress', () => {
    // The ticker is the only thing that reads bytes, so the container has to
    // outlive at least one tick (progressIntervalMs is 50 in this config).
    const runsFor = (ms) => sinon.stub().returns(
      new Promise((resolve) => { setTimeout(() => resolve({ StatusCode: 0 }), ms); }),
    );

    const fileEntry = (size) => ({ isDirectory: () => false, isFile: () => true, size });

    const operands = async (vol) => ({
      staging: await vol.resolve('.flux-op-x'),
      destination: await vol.resolve('out'),
    });

    it('reports the bytes sitting under staging, measured from the host path', async () => {
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);
      fsStub.promises.lstat = sinon.stub().resolves(fileEntry(4096));

      const seen = [];
      await volumeExecutor.run(vol, ['cp'], { publish, onBytes: (bytes) => seen.push(bytes) });

      expect(seen).to.not.deep.equal([]);
      expect(seen[0]).to.equal(4096);
      expect(fsStub.promises.lstat.firstCall.args[0]).to.equal(`${MOUNT}/.flux-op-x`);
    });

    it('sums a tree without following a symlink out of the volume', async () => {
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);

      const root = `${MOUNT}/.flux-op-x`;
      fsStub.promises.lstat = sinon.stub().callsFake(async (p) => {
        if (p === root) return { isDirectory: () => true, isFile: () => false };
        // neither a file nor a directory: what lstat reports for a symlink
        if (p === `${root}/escape`) return { isDirectory: () => false, isFile: () => false };
        return fileEntry(1000);
      });
      fsStub.promises.readdir = sinon.stub().resolves(['one', 'two', 'escape']);

      const seen = [];
      await volumeExecutor.run(vol, ['cp'], { publish, onBytes: (bytes) => seen.push(bytes) });

      // 2000, not 3000: the link contributes nothing, because cp -a copies the
      // link rather than what it points at - and stat() would have followed it
      // straight out of the volume.
      expect(seen[0]).to.equal(2000);
      expect(fsStub.promises.stat).to.equal(undefined);
    });

    it('gives up rather than reporting a figure it cannot keep up with', async () => {
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);

      // More entries than one walk is allowed to stat.
      const root = `${MOUNT}/.flux-op-x`;
      fsStub.promises.lstat = sinon.stub().callsFake(async (p) => (
        p === root ? { isDirectory: () => true, isFile: () => false } : fileEntry(1)
      ));
      fsStub.promises.readdir = sinon.stub().resolves(Array.from({ length: 30000 }, (_, i) => `f${i}`));

      const seen = [];
      await volumeExecutor.run(vol, ['cp'], { publish, onBytes: (bytes) => seen.push(bytes) });

      // null, not a number: a bar that stalls and then jumps makes a promise a
      // spinner never did.
      expect(seen).to.deep.equal([null]);
    });

    it('measures nothing for a caller that did not ask', async () => {
      // A move publishes its source where it stands, so staging is the whole
      // operation from the first tick and its size says nothing about progress.
      // The caller opts in; this asserts the executor stays out of it otherwise.
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);
      fsStub.promises.lstat = sinon.stub().resolves(fileEntry(4096));

      await volumeExecutor.run(vol, [], { publish });

      expect(fsStub.promises.lstat.called).to.equal(false);
    });
  });
});
