const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const os = require('node:os');
const nodePath = require('node:path');
const realFs = require('node:fs/promises');
const nodeCrypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');
const childProcess = require('node:child_process');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('volumeExecutor tests', () => {
  const APPS_FOLDER = '/test/apps/folder/';
  const MOUNT = `${APPS_FOLDER}fluxcomp_myapp`;
  const IMAGE = 'ghcr.io/runonflux/flux-volume-tools:v1.0.0';
  // What the tag has to resolve to. The id is what a container is created from,
  // so it is what the assertions below look for.
  // A peer's response is a stream and is consumed once, so every ask needs its
  // own. Bytes rather than an empty stream: the transfer is bounded by what
  // arrives, and a stream that ends immediately would not exercise that.
  const peerArchive = () => Readable.from([Buffer.from('a docker image archive')]);

  // Two windows: the first records the mark, the second finds it unmoved.
  const PEER_SERVE_STALL_WINDOWS = 2;

  const IMAGE_ID = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
  // What a containerd-backed daemon reports instead: the digest of the INDEX
  // covering both architectures, rather than of this architecture's own config.
  const INDEX_ID = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';

  let dockerServiceStub;
  let deviceHelperStub;
  let serviceHelperStub;
  let containerStub;
  let fsStub;
  let containerOutput;
  let pulled;
  let volumeSession;
  let volumeExecutor;

  let configStub;
  let nodeFsStub;
  let networkStateStub;

  // Rebuilt per test: a test that raises a limit to exercise something must not
  // leave it raised for the concurrency tests, which assert a refusal.
  const freshConfig = () => ({
    fluxapps: {
      volumeOperations: {
        image: IMAGE,
        imageIds: { amd64: IMAGE_ID, arm64: IMAGE_ID },
        indexId: INDEX_ID,
        prefetchWindowMs: 6 * 60 * 60 * 1000,
        maxConcurrentPerApp: 1,
        maxConcurrentPerNode: 2,
        stallTimeoutMs: 900000,
        minUploadBitsPerSecond: 64 * 1000,
        memoryBytes: 512 * 1024 * 1024,
        pidsLimit: 256,
        cancelGraceSeconds: 15,
        progressIntervalMs: 50,
      },
    },
  });

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
    configStub = freshConfig();
    deviceHelperStub = { listMountedFilesystems: sinon.stub().resolves([mountRow(MOUNT)]) };

    // What the command "writes". demuxStream is stubbed to push it into the
    // sinks the executor supplies, which is what dockerode's does after
    // stripping the stream framing.
    containerOutput = '';
    containerStub = {
      id: 'container-1',
      start: sinon.stub().resolves(),
      kill: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
      wait: sinon.stub().resolves({ StatusCode: 0 }),
      // attach and modem BOTH have to be here. The capture sits inside a try,
      // so either one missing means output is silently never collected and
      // every assertion about a failure message passes by testing nothing.
      attach: sinon.stub().resolves('raw-stream'),
      remove: sinon.stub().resolves(),
      modem: {
        demuxStream: sinon.stub().callsFake((stream, stdout) => {
          if (containerOutput) stdout.write(Buffer.from(containerOutput));
        }),
      },
    };

    pulled = true;
    dockerServiceStub = {
      createContainer: sinon.stub().resolves(containerStub),
      dockerListContainers: sinon.stub().resolves([]),
      appDockerForceRemove: sinon.stub().resolves(),
      // Present by default, so the tests that are not about fetching it do not
      // have to say so. A stub missing either of these resolves to undefined at
      // the CALL rather than at load, and the failure lands inside a try.
      imageExists: sinon.stub().callsFake(async () => pulled),
      pullImage: sinon.stub().callsFake(async () => { pulled = true; }),
      tagImage: sinon.stub().resolves(),
      // What this node's own serve path produces: an archive addressed by id,
      // which declares no names at all.
      archiveNames: sinon.stub().resolves([]),
    };

    serviceHelperStub = {
      ensureString: sinon.stub().callsFake((v) => (typeof v === 'string' ? v : JSON.stringify(v))),
      runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }),
      axiosGet: sinon.stub().rejects(new Error('no peer answered')),
      // The caller's deadline never resolves, so a test about what the fetch
      // does is decided by the fetch rather than by a race it did not mean to
      // run. Short waits inside the fetch - the gap between registry attempts -
      // are instant, because waiting for them is not what any test is about.
      delay: sinon.stub().callsFake((ms) => (ms >= 10000 ? new Promise(() => {}) : Promise.resolve())),
    };

    networkStateStub = {
      getRandomSocketAddress: sinon.stub().resolves(null),
      networkState: sinon.stub().returns([]),
      getFluxnodeBySocketAddress: sinon.stub().resolves(null),
    };

    // Deliberately WITHOUT a `stat`, so a walk that followed symlinks would
    // fail loudly here rather than silently leaving the volume.
    //
    // statfs is what running progress is read from - one syscall per tick
    // instead of a walk of the staging tree. Omitting it would make every byte
    // figure undefined at the CALL rather than at load, inside a try, which is
    // how five earlier stubs in this suite passed while exercising nothing.
    fsStub = {
      lstat: sinon.stub().rejects(new Error('ENOENT')),
      readdir: sinon.stub().resolves([]),
      statfs: sinon.stub().resolves({ bsize: 4096, blocks: 1000, bfree: 1000 }),
      unlink: sinon.stub().resolves(),
    };

    // The peer fetch takes the archive to a file before anything reads it. That
    // file is incidental to every assertion here - what is being checked is that
    // the transfer is bounded by size and by silence and inspected before the
    // daemon sees it - so nothing touches a real disk: a full one, or a
    // permission, would fail these for a reason that is not the code. Where a
    // real archive IS the thing under test, it is dockerService.archiveNames
    // that tests it, against real tars.
    nodeFsStub = {
      createWriteStream: sinon.stub().callsFake(() => new Writable({
        write(chunk, encoding, done) { done(); },
      })),
      createReadStream: sinon.stub().callsFake(() => Readable.from([])),
    };

    volumeSession = proxyquire('../../ZelBack/src/services/appSystem/volumeSession', {
      '../deviceHelper': deviceHelperStub,
      '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
      '../IOUtils': { getFolderSize: sinon.stub(), getFileSize: sinon.stub() },
      '../utils/appConstants': appConstantsStub,
    });

    volumeExecutor = proxyquire('../../ZelBack/src/services/appSystem/volumeExecutor', {
      config: configStub,
      'node:fs/promises': fsStub,
      'node:fs': nodeFsStub,
      '../dockerService': dockerServiceStub,
      '../deviceHelper': deviceHelperStub,
      '../serviceHelper': serviceHelperStub,
      '../networkStateService': networkStateStub,
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
      // The id, not the tag: the id is what was verified, and a tag is a local
      // name anything with docker access can move.
      expect(options.Image).to.equal(IMAGE_ID);
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

    it('runs at the volume root unless told otherwise', async () => {
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      const [options] = dockerServiceStub.createContainer.firstCall.args;
      expect(options.WorkingDir).to.equal('/work');
    });

    it('runs where the caller asks, so an archiver stores the layout it should', async () => {
      const vol = await openSession();
      const dir = await vol.resolve('photos');
      await volumeExecutor.run(vol, ['true'], { workingDir: dir });

      const [options] = dockerServiceStub.createContainer.firstCall.args;
      expect(options.WorkingDir).to.equal('/work/photos');
    });

    it('refuses a working directory that did not come from the session', async () => {
      // The same discipline as the operands: a path that skipped the session's
      // checks must produce code that does not run, not a container pointed
      // somewhere nobody verified.
      const vol = await openSession();

      await expect(volumeExecutor.run(vol, ['true'], { workingDir: '/work/photos' }))
        .to.be.rejectedWith('workingDir must be a VolumePath');
    });
  });

  describe('run - fetching the executor image', () => {
    it('pulls the pinned image when the node does not have it', async () => {
      // Creating a container does not pull: docker 404s for an image it does
      // not hold. Without this the FIRST file operation on any node fails.
      pulled = false;

      const vol = await openSession();
      const lines = [];
      await volumeExecutor.run(vol, ['true'], { onProgress: (line) => lines.push(line) });

      expect(dockerServiceStub.pullImage.calledOnce).to.equal(true);
      expect(dockerServiceStub.pullImage.firstCall.args[0]).to.deep.equal({ repoTag: IMAGE });
      expect(lines).to.include('Fetching the file operation image...');
      expect(dockerServiceStub.pullImage.calledBefore(dockerServiceStub.createContainer)).to.equal(true);
    });

    it('does not pull an image the node already has', async () => {
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      expect(dockerServiceStub.pullImage.called).to.equal(false);
    });

    it('fetches once for operations that start together', async () => {
      // A node whose image was just pruned can start several at once, and they
      // must not each download it.
      pulled = false;
      configStub.fluxapps.volumeOperations.maxConcurrentPerApp = 2;
      const waiters = [];
      // The pull is awaited through dockerService at the call, so a stub set up
      // here is the one that runs.
      dockerServiceStub.pullImage.callsFake(() => new Promise((resolve) => {
        waiters.push(() => { pulled = true; resolve(); });
      }));

      const vol = await openSession();
      const running = [
        volumeExecutor.run(vol, ['true']),
        volumeExecutor.run(vol, ['true']),
      ];
      await new Promise((resolve) => { setTimeout(resolve, 30); });
      expect(waiters.length, 'more than one download was started').to.equal(1);
      waiters[0]();
      await Promise.all(running);

      expect(dockerServiceStub.pullImage.callCount).to.equal(1);
    });

    it('fails clearly when the image cannot be fetched', async () => {
      dockerServiceStub.imageExists = sinon.stub().resolves(false);

      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['true']))
        .to.be.rejectedWith(/is being fetched/);
      expect(dockerServiceStub.createContainer.called).to.equal(false);
    });

    it('refuses when the pull reports success but leaves no image', async () => {
      // The pull reports the progress stream, not the outcome - a pull
      // can end on an error event and still call back without one.
      dockerServiceStub.imageExists = sinon.stub().resolves(false);
      dockerServiceStub.pullImage.callsFake(async () => {});

      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['true']))
        .to.be.rejectedWith(/is being fetched/);
      expect(dockerServiceStub.createContainer.called).to.equal(false);
    });
  });

  describe('the image is identified by what is in it', () => {
    it('refuses an image the registry resolves the tag to that is not the pinned one', async () => {
      // A tag is mutable, so a pull proves only that something arrived. What is
      // run is decided by the id, and a mismatch means the tag moved without
      // its ids - which every node refuses rather than half the fleet running
      // something else.
      dockerServiceStub.imageExists = sinon.stub().resolves(false);

      const vol = await openSession();
      // Refused as "on its way" rather than as a failure: the node is not
      // broken, and the background loop keeps trying.
      const error = await volumeExecutor.run(vol, ['true']).catch((thrown) => thrown);
      expect(error.kind).to.equal('busy');
    });

    it('accepts the image a containerd-backed daemon reports, which is the index', async () => {
      // Docker files an image under one of two content digests depending on how
      // it stores images. The classic store answers with THIS architecture's own
      // config digest; the containerd store - the default from Docker 29, and
      // 92% of the fleet - answers with the digest of the INDEX covering every
      // architecture. Pinning only the first left those nodes pulling the image
      // successfully and then refusing it, for good, because no retry can make
      // two different numbers agree. Every file operation on such a node failed,
      // including the three that used to be a local mkdir, mv and rm.
      pulled = false;
      dockerServiceStub.imageExists = sinon.stub().callsFake(async (id) => pulled && id === INDEX_ID);
      dockerServiceStub.pullImage.callsFake(async () => { pulled = true; });

      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      // And the container is created from the id this daemon actually resolves,
      // not from whichever one happens to be written down first.
      expect(dockerServiceStub.createContainer.firstCall.args[0].Image).to.equal(INDEX_ID);
    });

    it('refuses an image matching neither identifier it is pinned to', async () => {
      const stranger = 'sha256:4444444444444444444444444444444444444444444444444444444444444444';
      pulled = false;
      dockerServiceStub.imageExists = sinon.stub().callsFake(async (id) => pulled && id === stranger);
      dockerServiceStub.pullImage.callsFake(async () => { pulled = true; });

      const vol = await openSession();
      const error = await volumeExecutor.run(vol, ['true']).catch((thrown) => thrown);

      expect(error.kind).to.equal('busy');
      expect(dockerServiceStub.createContainer.called).to.equal(false);
    });

    it('takes the image from a peer when the registry cannot be reached', async () => {
      pulled = false;
      dockerServiceStub.pullImage.rejects(new Error('getaddrinfo ENOTFOUND ghcr.io'));
      dockerServiceStub.loadImage = sinon.stub().callsFake(async () => { pulled = true; return { ids: [IMAGE_ID], tags: [] }; });
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: peerArchive() }));

      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      expect(serviceHelperStub.axiosGet.firstCall.args[0])
        .to.equal(`http://198.18.0.5:16127/apps/fileoperationimage/${IMAGE_ID}`);
      sinon.assert.calledOnce(dockerServiceStub.loadImage);
    });

    it('names the image it took from a peer, so a prune does not take it back', async () => {
      // A peer serves the archive by id, and the daemon writes no names for a
      // reference that has none - so what arrives is nameless, and a nameless
      // image is a DANGLING one. performDockerCleanup prunes dangling images
      // before every app install, so without a name the node loses the image
      // it just fetched and asks a peer again after every install: the nodes
      // on the peer path are the ones that cannot reach the registry, so they
      // are exactly the ones that would pay it forever.
      pulled = false;
      dockerServiceStub.pullImage.rejects(new Error('getaddrinfo ENOTFOUND ghcr.io'));
      dockerServiceStub.loadImage = sinon.stub().callsFake(async () => { pulled = true; return { ids: [IMAGE_ID], tags: [] }; });
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: peerArchive() }));

      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      sinon.assert.calledOnceWithExactly(dockerServiceStub.tagImage, IMAGE_ID, IMAGE);
      // After the discard, never before: the name is this node's word for what
      // it verified, so it must not be applied to bytes still under suspicion.
      expect(dockerServiceStub.tagImage.calledAfter(dockerServiceStub.loadImage)).to.equal(true);
    });

    it('names the image under the identifier the archive actually delivered', async () => {
      // A containerd-backed daemon files the image under the index digest and
      // knows nothing about the config digest, so naming it by whichever id is
      // pinned first answers 404 and leaves the image nameless - the exact state
      // the naming exists to prevent, and one a prune then acts on.
      pulled = false;
      dockerServiceStub.pullImage.rejects(new Error('getaddrinfo ENOTFOUND ghcr.io'));
      dockerServiceStub.imageExists = sinon.stub().callsFake(async (id) => pulled && id === INDEX_ID);
      dockerServiceStub.loadImage = sinon.stub().callsFake(async () => { pulled = true; return { ids: [INDEX_ID], tags: [] }; });
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: peerArchive() }));

      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      sinon.assert.calledOnceWithExactly(dockerServiceStub.tagImage, INDEX_ID, IMAGE);
    });

    it('does not name an image a peer sent that is not the pinned one', async () => {
      const wrong = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
      dockerServiceStub.imageExists = sinon.stub().resolves(false);
      dockerServiceStub.pullImage.rejects(new Error('offline'));
      dockerServiceStub.loadImage = sinon.stub().resolves({ ids: [wrong], tags: [] });
      dockerServiceStub.appDockerImageRemove = sinon.stub().resolves();
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: peerArchive() }));

      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['true'])).to.be.rejected;

      expect(dockerServiceStub.tagImage.called, 'it named an image it had refused').to.equal(false);
    });

    it('refuses an archive that declares names, rather than repairing afterwards', async () => {
      // `docker load` APPLIES the names an archive declares, which takes them
      // off whatever this node had under them. A peer packing in the name of one
      // of this node's own app images renames it, and removing the stolen name
      // afterwards does not give it back - it leaves the real image nameless,
      // which is to say dangling, which is to say the next prune deletes it.
      //
      // This node's own serve path exports by id and so declares nothing. An
      // archive that declares anything is doing something we never do.
      dockerServiceStub.imageExists = sinon.stub().resolves(false);
      dockerServiceStub.pullImage.rejects(new Error('offline'));
      dockerServiceStub.archiveNames = sinon.stub().resolves(['ghcr.io/someone/theirapp:v1']);
      dockerServiceStub.loadImage = sinon.stub().resolves({ ids: [IMAGE_ID], tags: [] });
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');

      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['true'])).to.be.rejected;

      expect(dockerServiceStub.loadImage.called, 'the daemon was given an archive that names things').to.equal(false);
    });

    it('stops taking from a peer that sends more than the ceiling', async () => {
      // Nothing is known about the bytes until they have all arrived, so the
      // ceiling is the only thing between a peer and this node's disk - the one
      // the tenants' applications are on. A check afterwards runs too late.
      dockerServiceStub.imageExists = sinon.stub().resolves(false);
      dockerServiceStub.pullImage.rejects(new Error('offline'));
      dockerServiceStub.loadImage = sinon.stub().resolves({ ids: [], tags: [] });
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');

      let sent = 0;
      const firehose = new Readable({
        read() {
          sent += 1024 * 1024;
          this.push(Buffer.alloc(1024 * 1024));
        },
      });
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: firehose }));

      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['true'])).to.be.rejected;

      expect(dockerServiceStub.loadImage.called, 'an unbounded archive reached the daemon').to.equal(false);
      expect(sent, `took ${sent} bytes`).to.be.lessThan(512 * 1024 * 1024);
      expect(firehose.destroyed, 'the peer kept its socket after being refused').to.equal(true);
    });

    it('gives up on a peer that answers and then goes silent', async () => {
      // The one that froze a node until FluxOS restarted. axios settles a stream
      // request when the HEADERS arrive, so its timeout is spent by then and the
      // BODY had no bound at all: docker load waited on a body that never ended,
      // the shared acquisition promise never settled, no retry was scheduled,
      // the registry was never reached, and every file operation was refused for
      // as long as the process lived. No attacker needed - a NAT dropping the
      // connection mid-archive does it.
      dockerServiceStub.imageExists = sinon.stub().resolves(false);
      dockerServiceStub.pullImage.rejects(new Error('offline'));
      dockerServiceStub.loadImage = sinon.stub().resolves({ ids: [], tags: [] });
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');

      // Answers, sends one chunk, then nothing - ever.
      const silent = new Readable({ read() {} });
      silent.push(Buffer.from('the first chunk'));
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: silent }));

      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 20 });
      try {
        const vol = await openSession();
        const running = expect(volumeExecutor.run(vol, ['true'])).to.be.rejected;
        await clock.tickAsync(90000);
        await running;
      } finally {
        clock.restore();
      }

      expect(silent.destroyed, 'the silent peer kept its socket').to.equal(true);
      expect(dockerServiceStub.loadImage.called, 'a body that never ended reached the daemon').to.equal(false);
    });

    it('removes what a peer sent when it is not the image that was asked for', async () => {
      // The archive names itself, so a peer saying "this is the image" proves
      // nothing. What arrived is checked, and anything else does not stay on
      // the disk.
      const wrong = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
      dockerServiceStub.imageExists = sinon.stub().resolves(false);
      dockerServiceStub.pullImage.rejects(new Error('offline'));
      dockerServiceStub.loadImage = sinon.stub().resolves({ ids: [wrong], tags: [] });
      dockerServiceStub.appDockerImageRemove = sinon.stub().resolves();
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: peerArchive() }));

      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['true'])).to.be.rejected;

      sinon.assert.calledWith(dockerServiceStub.appDockerImageRemove, wrong);
    });

    it('removes the extras a peer packed in beside the image that was asked for', async () => {
      // This used to return the moment the wanted id was seen, before the
      // removal below it - so a peer answering with the right image AND three
      // others of its own got all four onto the node, permanently, since
      // nothing else ever looks at them again.
      const extra = 'sha256:4444444444444444444444444444444444444444444444444444444444444444';
      pulled = false;
      dockerServiceStub.pullImage.rejects(new Error('offline'));
      dockerServiceStub.loadImage = sinon.stub().callsFake(async () => {
        pulled = true;
        return { ids: [IMAGE_ID, extra], tags: [] };
      });
      dockerServiceStub.appDockerImageRemove = sinon.stub().resolves();
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: peerArchive() }));

      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      sinon.assert.calledWith(dockerServiceStub.appDockerImageRemove, extra);
      expect(dockerServiceStub.appDockerImageRemove.getCalls().map((call) => call.args[0]))
        .to.not.include(IMAGE_ID);
    });

    it('removes an image a peer sent under a name of its own choosing', async () => {
      // A tagged image is reported as "Loaded image: name:tag" and never as an
      // id, so reporting only ids left it on the disk with nothing that could
      // name it - carrying whatever tag the sender picked.
      const planted = 'runonflux/website:latest';
      pulled = false;
      dockerServiceStub.pullImage.rejects(new Error('offline'));
      dockerServiceStub.loadImage = sinon.stub().callsFake(async () => {
        pulled = true;
        return { ids: [IMAGE_ID], tags: [planted] };
      });
      dockerServiceStub.getImageId = sinon.stub().resolves('sha256:5555555555555555555555555555555555555555555555555555555555555555');
      dockerServiceStub.appDockerImageRemove = sinon.stub().resolves();
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: peerArchive() }));

      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      sinon.assert.calledWith(dockerServiceStub.appDockerImageRemove, planted);
    });

    it('keeps a tag that names the image that was asked for', async () => {
      // An archive may perfectly well deliver the wanted image WITH a tag on
      // it. Removing that tag deletes the image this just went and fetched, so
      // the tag is resolved before anything is done with it.
      pulled = false;
      dockerServiceStub.pullImage.rejects(new Error('offline'));
      dockerServiceStub.loadImage = sinon.stub().callsFake(async () => {
        pulled = true;
        return { ids: [IMAGE_ID], tags: ['flux-volume-tools:v1.0.0'] };
      });
      dockerServiceStub.getImageId = sinon.stub().resolves(IMAGE_ID);
      dockerServiceStub.appDockerImageRemove = sinon.stub().resolves();
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: peerArchive() }));

      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      expect(dockerServiceStub.appDockerImageRemove.called, 'the image it had just fetched was removed').to.equal(false);
    });

    it('asks four different peers rather than four times', async () => {
      // The draw is random, so counting draws lets a repeat stand in for a
      // peer - and on a small fleet that is the difference between asking the
      // node that has the image and never reaching it.
      pulled = false;
      dockerServiceStub.pullImage.rejects(new Error('offline'));
      dockerServiceStub.loadImage = sinon.stub().resolves({ ids: [], tags: [] });
      const drawn = ['198.18.0.5:16127', '198.18.0.5:16127', '198.18.0.6:16127',
        '198.18.0.5:16127', '198.18.0.7:16127', '198.18.0.8:16127'];
      let next = 0;
      networkStateStub.getRandomSocketAddress.callsFake(async () => drawn[next++] ?? null);
      serviceHelperStub.axiosGet.callsFake(async () => ({ data: peerArchive() }));

      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']).catch(() => {});

      const addresses = serviceHelperStub.axiosGet.getCalls().map((call) => call.args[0]);
      expect(new Set(addresses).size).to.equal(4);
    });
  });


  describe('taking the image before anything asks for it', () => {
    let originalAddress;

    // Derived here rather than read out of the module, so the derivation is
    // pinned rather than echoed back.
    const slotFor = (address) => nodeCrypto.createHash('sha256').update(address).digest()
      .readUInt32BE(0) % (6 * 60 * 60 * 1000);

    beforeEach(() => {
      originalAddress = globalThis.userconfig.initial.ipaddress;
      // A node that does not hold the image yet, with a peer to ask about it.
      pulled = false;
      networkStateStub.getRandomSocketAddress.resolves('198.18.0.5:16127');
    });

    afterEach(() => {
      volumeExecutor.stopImagePrefetch();
      globalThis.userconfig.initial.ipaddress = originalAddress;
    });

    it('asks peers straight away and the registry only at its own point in the window', async () => {
      // Asking peers costs one central place nothing, so a node that boots into
      // a fleet holding the image is done at once. The registry is the fetch
      // that herds, so it waits.
      const clock = sinon.useFakeTimers();
      try {
        globalThis.userconfig.initial.ipaddress = '198.18.0.7';

        await volumeExecutor.startImagePrefetch();

        expect(serviceHelperStub.axiosGet.called, 'peers were not asked at once').to.equal(true);
        expect(dockerServiceStub.pullImage.called, 'the registry was asked immediately').to.equal(false);

        await clock.tickAsync(slotFor('198.18.0.7') - 1);
        expect(dockerServiceStub.pullImage.called, 'the registry was asked before its slot').to.equal(false);

        await clock.tickAsync(1);
        expect(dockerServiceStub.pullImage.called, 'the registry was not asked at its slot').to.equal(true);
      } finally {
        clock.restore();
      }
    });

    it('asks at the same point on every restart', async () => {
      // A node drawing its slot at random picks a new one each boot, which
      // turns a restarting fleet back into the burst the window exists to
      // spread.
      const clock = sinon.useFakeTimers();
      try {
        globalThis.userconfig.initial.ipaddress = '198.18.0.7';
        const slot = slotFor('198.18.0.7');

        await volumeExecutor.startImagePrefetch();
        volumeExecutor.stopImagePrefetch();
        await volumeExecutor.startImagePrefetch();

        await clock.tickAsync(slot - 1);
        expect(dockerServiceStub.pullImage.called).to.equal(false);
        await clock.tickAsync(1);
        expect(dockerServiceStub.pullImage.called).to.equal(true);
      } finally {
        clock.restore();
      }
    });

    it('does not let a peers-only round answer for the registry', async () => {
      // The prefetch asks peers and nothing else, deliberately - the registry
      // fetch is the one that herds, so it waits for this node's slot. A round
      // that only asked peers has therefore learned nothing about the registry
      // and must not be able to answer for it.
      //
      // This is the cold-fleet case, which is the case the peer path exists
      // for: a new pin, where no peer holds it yet either. Every operation on
      // the node was refused for a minute while the one source that would have
      // worked went untried, and the prefetch's own registry attempt was hours
      // away.
      pulled = false;
      networkStateStub.getRandomSocketAddress.resolves(null);

      await volumeExecutor.startImagePrefetch();
      expect(dockerServiceStub.pullImage.called, 'the prefetch went to the registry').to.equal(false);

      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      expect(
        dockerServiceStub.pullImage.called,
        'the caller was refused without the registry being asked',
      ).to.equal(true);
    });

    it('puts a different address at a different point', async () => {
      // This node's slot is the later of the two, so reaching the other one
      // must not set it going.
      const clock = sinon.useFakeTimers();
      try {
        expect(slotFor('198.18.0.7')).to.be.greaterThan(slotFor('198.18.0.8'));
        globalThis.userconfig.initial.ipaddress = '198.18.0.7';

        await volumeExecutor.startImagePrefetch();
        await clock.tickAsync(slotFor('198.18.0.8'));

        expect(dockerServiceStub.pullImage.called, 'it went at another address\'s slot').to.equal(false);
      } finally {
        clock.restore();
      }
    });
  });

  describe('handing the image to a peer', () => {
    // A real EventEmitter, because every question here is about WHEN a
    // listener was attached relative to an event. A stubbed `on` cannot answer
    // it: however it is written, it delivers close to a listener that did not
    // exist yet - which is exactly the case that held a slot for ever.
    const responseFor = () => {
      const res = new EventEmitter();
      res.statusCode = null;
      res.headers = {};
      res.status = (code) => { res.statusCode = code; return res; };
      res.set = (key, value) => { res.headers[key] = value; return res; };
      res.end = sinon.stub();
      res.destroy = sinon.stub();
      res.headersSent = false;
      return res;
    };
    const requestFrom = (ip, imageid) => ({ socket: { remoteAddress: ip }, params: { imageid } });

    /** A docker export stream, which produces nothing unless it is piped. */
    const archiveStub = () => ({ on: sinon.stub(), pipe: sinon.stub(), destroy: sinon.stub() });

    /** Let the handler run on to whatever it is waiting for. */
    const settle = () => new Promise((resolve) => { setImmediate(resolve); });

    /** A peer this node will answer, holding the image it is pinned to. */
    const willServe = () => {
      networkStateStub.networkState.returns([{ ip: '198.18.0.5:16127' }]);
      dockerServiceStub.imageExists = sinon.stub().resolves(true);
    };

    it('does not walk the fleet list once per caller', async () => {
      // The endpoint is unauthenticated and the id it wants is public config, so
      // this ran before the caller had been shown to be anyone: a copy of the
      // whole ~13,000-entry network state and a split per entry, measured at
      // ~2.4ms of the event loop each. Roughly 400 a second saturates the one
      // core FluxOS has and stalls everything else on it.
      willServe();
      dockerServiceStub.exportImage = sinon.stub().resolves(archiveStub());

      for (let i = 0; i < 25; i += 1) {
        const res = responseFor();
        // eslint-disable-next-line no-await-in-loop
        await volumeExecutor.serveImageToPeer(requestFrom('198.18.9.9', IMAGE_ID), res);
        expect(res.statusCode, 'a stranger was not refused').to.equal(403);
      }

      expect(
        networkStateStub.networkState.callCount,
        `walked the fleet list ${networkStateStub.networkState.callCount} times for 25 callers`,
      ).to.equal(1);
    });

    it('serves only the id this node is pinned to', async () => {
      networkStateStub.networkState.returns([{ ip: '198.18.0.5:16127' }]);
      const res = responseFor();

      await volumeExecutor.serveImageToPeer(
        requestFrom('198.18.0.5', 'sha256:3333333333333333333333333333333333333333333333333333333333333333'),
        res,
      );

      expect(res.statusCode).to.equal(404);
      expect(dockerServiceStub.exportImage).to.equal(undefined);
    });

    it('reads an IPv4-mapped address as the IPv4 address it is', async () => {
      // What a dual-stack listener hands over for an ordinary IPv4 peer.
      willServe();
      dockerServiceStub.exportImage = sinon.stub().resolves(archiveStub());
      const res = responseFor();

      const served = volumeExecutor.serveImageToPeer(requestFrom('::ffff:198.18.0.5', IMAGE_ID), res);
      await settle();
      res.emit('close');
      await served;

      expect(res.statusCode).to.not.equal(403);
    });

    it('does not read an IPv6 address as its last group', async () => {
      // Cutting to the LAST colon turns 2001:db8::1 into "1", so the network
      // state is asked about something that is not the caller. The fleet is
      // IPv4 only - validIpv4Address gates what can be registered - so this
      // address is refused either way; what is pinned here is that it is
      // refused for the right reason rather than by accident.
      networkStateStub.networkState.returns([{ ip: '1:16127' }]);
      dockerServiceStub.imageExists = sinon.stub().resolves(true);
      const res = responseFor();

      await volumeExecutor.serveImageToPeer(requestFrom('2001:db8::1', IMAGE_ID), res);

      expect(res.statusCode).to.equal(403);
    });

    it('answers only an address the network state knows', async () => {
      networkStateStub.networkState.returns([{ ip: '198.18.0.5:16127' }]);
      const res = responseFor();

      await volumeExecutor.serveImageToPeer(requestFrom('203.0.113.9', IMAGE_ID), res);

      expect(res.statusCode).to.equal(403);
    });

    it('matches a peer on its address, whatever api port it runs on', async () => {
      // A node's api port cannot be read off an inbound connection, and the
      // fleet does not all run on the default one.
      networkStateStub.networkState.returns([{ ip: '198.18.0.5:16187' }]);
      dockerServiceStub.imageExists = sinon.stub().resolves(true);
      dockerServiceStub.exportImage = sinon.stub().resolves(archiveStub());
      const res = responseFor();

      const served = volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), res);
      await settle();
      res.emit('close');
      await served;

      sinon.assert.calledWith(dockerServiceStub.exportImage, IMAGE_ID);
    });

    it('gives the slot back when the caller hangs up while docker is packing', async () => {
      // The leak this covers. `close` fires once, and it used to be subscribed
      // to only AFTER the export - so a caller that went away while docker was
      // still packing was never noticed, the wait never settled, and the slot
      // was never returned. Two of those and this node serves no peer until
      // FluxOS restarts, which pushes everyone who asks it back onto the
      // registry - the load peer serving exists to avoid.
      willServe();

      const abandoned = [responseFor(), responseFor()];
      const archives = [];
      dockerServiceStub.exportImage = sinon.stub().callsFake(async () => {
        const archive = archiveStub();
        archives.push(archive);
        // The caller goes away mid-export, before there is anything to pipe to.
        abandoned[archives.length - 1].emit('close');
        return archive;
      });

      // Both slots, which is the whole limit.
      await volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), abandoned[0]);
      await volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), abandoned[1]);

      // The proof: a third caller is served rather than refused, which can only
      // happen if both slots came back.
      dockerServiceStub.exportImage = sinon.stub().resolves(archiveStub());
      const third = responseFor();
      const served = volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), third);
      await settle();
      third.emit('close');
      await served;

      expect(third.statusCode, 'the third caller was refused, so a slot never came back').to.not.equal(503);
      // And the export nobody was waiting for was closed rather than left open.
      expect(archives[0].destroy.called, 'the abandoned export stream was left open').to.equal(true);
    });

    it('gives the slot back when the caller hangs up mid-stream', async () => {
      // The control for the test above. This window always released the slot,
      // so it has to keep doing so - otherwise that test could pass for a
      // reason that has nothing to do with when the listener was attached.
      willServe();
      dockerServiceStub.exportImage = sinon.stub().callsFake(async () => archiveStub());

      const hangUpAfterPiping = async () => {
        const res = responseFor();
        const served = volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), res);
        await settle();
        res.emit('close');
        await served;
      };

      // Both slots, taken and released the way they always were.
      await hangUpAfterPiping();
      await hangUpAfterPiping();

      const third = responseFor();
      const served = volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), third);
      await settle();
      third.emit('close');
      await served;

      expect(third.statusCode).to.not.equal(503);
    });

    it('refuses the caller past the ceiling while the rest are genuinely served', async () => {
      // The limit itself, which the fixes must not have loosened. Derived by
      // filling it rather than written down, so it stays true if the number
      // moves - which it has.
      willServe();
      dockerServiceStub.exportImage = sinon.stub().callsFake(async () => archiveStub());

      const open = [];
      const inFlight = [];
      let refused = null;
      for (let i = 0; i < 20 && !refused; i += 1) {
        const res = responseFor();
        const call = volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), res);
        // eslint-disable-next-line no-await-in-loop
        await settle();
        if (res.statusCode === 503) refused = res;
        else { open.push(res); inFlight.push(call); }
      }

      expect(refused, 'the ceiling never refused anyone').to.not.equal(null);
      expect(refused.headers['Retry-After']).to.equal('30');
      expect(open.length, 'nothing was being served when the ceiling was reached').to.be.greaterThan(0);

      open.forEach((res) => res.emit('close'));
      await Promise.all(inFlight);
    });

    it('holds the ceiling against callers that arrive together', async () => {
      // The count was read, then an await ran, then the slot was taken - so
      // every request arriving in the same tick read the same count and all
      // passed. The ceiling bounded nothing at the one moment it was for.
      willServe();
      dockerServiceStub.exportImage = sinon.stub().callsFake(async () => archiveStub());

      const responses = Array.from({ length: 12 }, () => responseFor());
      const calls = responses.map((res) => volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), res));
      await settle();
      await settle();

      const served = responses.filter((res) => res.statusCode !== 503);
      const turnedAway = responses.filter((res) => res.statusCode === 503);
      expect(turnedAway.length, 'every simultaneous caller got through the ceiling').to.be.greaterThan(0);
      expect(
        dockerServiceStub.exportImage.callCount,
        `${dockerServiceStub.exportImage.callCount} exports started at once`,
      ).to.equal(served.length);

      responses.forEach((res) => res.emit('close'));
      await Promise.all(calls);
    });

    it('answers HEAD without packing an archive for it', async () => {
      // Express answers HEAD from the GET route, and node throws away the body
      // of a HEAD response without applying backpressure - so a HEAD bought a
      // full export off the disk for one packet and no bandwidth.
      willServe();
      dockerServiceStub.exportImage = sinon.stub().callsFake(async () => archiveStub());

      const res = responseFor();
      const req = requestFrom('198.18.0.5', IMAGE_ID);
      req.method = 'HEAD';
      await volumeExecutor.serveImageToPeer(req, res);

      expect(res.statusCode).to.equal(405);
      expect(dockerServiceStub.exportImage.called, 'a HEAD packed an archive').to.equal(false);
    });

    it('stops serving a caller that takes nothing, and gives the slot back', async () => {
      // A slot came back only on disconnect, and a caller that neither
      // disconnects nor reads does neither - the export just blocks on
      // backpressure. Two of those took every slot until FluxOS restarted, and
      // nothing said so.
      willServe();
      const archive = archiveStub();
      dockerServiceStub.exportImage = sinon.stub().resolves(archive);

      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 20 });
      try {
        const res = responseFor();
        const call = volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), res);
        await settle();
        expect(archive.pipe.called, 'the export never started').to.equal(true);

        // The caller takes nothing: no data ever flows.
        await clock.tickAsync(PEER_SERVE_STALL_WINDOWS * 30000);
        await call;

        expect(archive.destroy.called, 'the export was left running').to.equal(true);
        expect(res.destroy.called, 'the socket was left open').to.equal(true);
      } finally {
        clock.restore();
      }

      // And the slot is back: the next caller is served rather than refused.
      const next = responseFor();
      const following = volumeExecutor.serveImageToPeer(requestFrom('198.18.0.5', IMAGE_ID), next);
      await settle();
      expect(next.statusCode, 'the slot was never given back').to.not.equal(503);
      next.emit('close');
      await following;
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
        publish: { staging, destination }, mkdirStaging: true, maxBytes: 1234.7, ordinaryOnly: true,
      });

      const { Cmd } = dockerServiceStub.createContainer.firstCall.args[0];
      expect(flags(Cmd)).to.deep.equal([
        'flux-op', '--id', '<uuid>', '--root', '/work', '--discard-staging', '--mkdir',
        '--max-bytes', '1234', '--ordinary-only', '/work/.flux-op-x', '/work/out',
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

    it('names the operation the caller is waiting behind', async () => {
      // A refusal that only says "busy" leaves a client retrying blindly. What
      // it is waiting for is knowable, watchable and cancellable, so the
      // refusal carries it.
      const jobRegistry = require('../../ZelBack/src/services/utils/jobRegistry');
      let releaseFirst;
      containerStub.wait.returns(new Promise((resolve) => { releaseFirst = resolve; }));

      const vol = await openSession();
      const first = volumeExecutor.run(vol, ['true']);
      const handle = jobRegistry.start({
        kind: 'fileoperation.copy',
        detail: () => ({ app: vol.identifier }),
      });

      const error = await volumeExecutor.run(await openSession(), ['true']).catch((thrown) => thrown);

      expect(error.kind).to.equal('busy');
      expect(error.operation.jobId).to.equal(handle.jobId);
      expect(error.operation.kind).to.equal('fileoperation.copy');
      expect(error.operation.statusUrl).to.equal(handle.statusUrl);

      jobRegistry.succeed(handle.jobId);
      releaseFirst({ StatusCode: 0 });
      await first;
    });

    it('says how long to wait only when the operation can say', async () => {
      // The same rule this code applies to progress: a denominator is only
      // offered where one is real. A copy that has moved a known fraction in a
      // known time can answer; anything else gets the default rather than an
      // invented number.
      const jobRegistry = require('../../ZelBack/src/services/utils/jobRegistry');
      let releaseFirst;
      containerStub.wait.returns(new Promise((resolve) => { releaseFirst = resolve; }));

      const vol = await openSession();
      const first = volumeExecutor.run(vol, ['true']);

      const measured = jobRegistry.start({
        kind: 'fileoperation.copy',
        detail: () => ({ app: vol.identifier, bytesDone: 1, bytesTotal: 1000 }),
      });
      // A second of it having run, without a second passing: the estimate is
      // rate over elapsed, and a job created microseconds ago has no rate.
      const startedAt = Date.now();
      sinon.stub(Date, 'now').returns(startedAt + 1000);
      const withEstimate = await volumeExecutor.run(await openSession(), ['true']).catch((e) => e);
      Date.now.restore();
      jobRegistry.succeed(measured.jobId);

      const unmeasured = jobRegistry.start({
        kind: 'fileoperation.compress',
        detail: () => ({ app: vol.identifier }),
      });
      const withoutEstimate = await volumeExecutor.run(await openSession(), ['true']).catch((e) => e);
      jobRegistry.succeed(unmeasured.jobId);

      expect(withEstimate.retryAfterMs, 'an operation that can be estimated was not')
        .to.be.above(withoutEstimate.retryAfterMs);
      expect(withoutEstimate.retryAfterMs).to.equal(5000);

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

      // Every volume mounted at once, as on a real node. Repointing a shared
      // stub per session instead would make the assertions depend on when each
      // operation happens to read the mount table.
      deviceHelperStub.listMountedFilesystems.resolves(
        ['appone', 'apptwo', 'appthree'].map((name) => mountRow(`${APPS_FOLDER}fluxcomp_${name}`)),
      );
      const sessionFor = async (appname) => volumeSession.openVolume({ params: { appname, component: 'comp' }, query: {} });

      const a = volumeExecutor.run(await sessionFor('appone'), ['true']);
      const b = volumeExecutor.run(await sessionFor('apptwo'), ['true']);
      // node cap is 2 in this config. The slot is taken synchronously, so this
      // is refused whether or not the first two have reached their container.
      await expect(volumeExecutor.run(await sessionFor('appthree'), ['true']))
        .to.be.rejectedWith('maximum number of file operations');

      // Both must actually be waiting on a container before their waits can be
      // released - there are several awaits between taking a slot and getting
      // there, and counting ticks to guess when would make this a timing test.
      while (holds.length < 2) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setImmediate(resolve); });
      }
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
    // On a real disk, deliberately. What this code decides is where a path
    // LEADS, and a stubbed filesystem has no symlinks to lead anywhere - so the
    // escape that reaches /etc/cron.d through a symlinked parent cannot be
    // written against one at all. The rules about which names are swept could
    // be, but splitting them across two filesystems is how a suite ends up
    // asserting its own stub.
    let tmpRoot;
    let mount;
    let session;
    let sweeper;
    let logStub;

    // flux-op derives both names from the staging directory's randomUUID, so a
    // fixture that is not one is not a fixture for anything this ever sees.
    const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const OP = `.flux-op-${ID}`;
    const OLD = `.flux-old-${ID}`;

    const at = (...parts) => nodePath.join(mount, ...parts);
    const exists = (p) => realFs.lstat(p).then(() => true).catch(() => false);
    const write = (name, contents) => realFs.writeFile(at(name), contents);

    // The identity as the FIRST release of the image wrote it: two fields and
    // no clock named, which is read as a modification time.
    const legacyIdentityOf = async (name) => {
      const stats = await realFs.lstat(at(name), { bigint: true });
      return `${stats.ino} ${stats.mtimeNs}`;
    };

    // The identity flux-op records wherever the kernel supplies a creation
    // time, which is every filesystem a Flux node puts an app volume on.
    const identityOf = async (name) => {
      const stats = await realFs.lstat(at(name), { bigint: true });
      return `${stats.ino} ${stats.birthtimeNs} btime`;
    };

    // Whether this filesystem really keeps a creation time. Node reports ctime
    // as birthtime when it has nothing better, and at creation the two are
    // identical - so the question is whether it MOVES when the object is
    // written to, not whether it is there at all.
    const keepsCreationTime = async () => {
      const probe = at('.birthtime-probe');
      await realFs.mkdir(probe);
      const before = (await realFs.lstat(probe, { bigint: true })).birthtimeNs;
      await realFs.writeFile(nodePath.join(probe, 'x'), 'x');
      const after = (await realFs.lstat(probe, { bigint: true })).birthtimeNs;
      await realFs.rm(probe, { recursive: true });
      return before === after;
    };

    /**
     * The parked entry and the marker placing it. The identity defaults to one
     * nothing on disk carries, because most of these are about a destination
     * that is empty or a path that is refused.
     */
    const park = async (destination, { payload = 'THE ONLY COPY\n', identity = '1 1' } = {}) => {
      await write(OLD, payload);
      await write(`${OLD}${'.dest'}`, `${destination}\n${identity}\n`);
    };

    const publishes = () => dockerServiceStub.createContainer.getCalls()
      .map((c) => c.args[0].Cmd)
      .filter((cmd) => cmd && cmd[0] === 'flux-op');

    beforeEach(async () => {
      tmpRoot = await realFs.mkdtemp(nodePath.join(os.tmpdir(), 'fluxsweep-'));
      // The apps folder for this test IS the temp root, so the containment
      // checks compare against a real directory rather than a fictional one.
      const appsFolder = `${tmpRoot}/`;
      mount = nodePath.join(tmpRoot, 'fluxcomp_myapp');
      await realFs.mkdir(mount);

      const constants = { ...appConstantsStub, appsFolder };
      logStub = {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
      };
      deviceHelperStub.listMountedFilesystems = sinon.stub().resolves([mountRow(mount)]);

      // rm really removes, so "the data is still there" is a claim about the
      // disk rather than about which command was issued.
      serviceHelperStub.runCommand = sinon.stub().callsFake(async (cmd, opts) => {
        if (cmd === 'rm') await realFs.rm(opts.params[1], { recursive: true, force: true });
        return { error: null, stdout: '', stderr: '' };
      });

      const sessions = proxyquire('../../ZelBack/src/services/appSystem/volumeSession', {
        '../deviceHelper': deviceHelperStub,
        '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(true) },
        '../IOUtils': { getFolderSize: sinon.stub(), getFileSize: sinon.stub() },
        '../utils/appConstants': constants,
      });

      // No fs stub on this one - that is the whole point of the block.
      sweeper = proxyquire('../../ZelBack/src/services/appSystem/volumeExecutor', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../deviceHelper': deviceHelperStub,
        '../serviceHelper': serviceHelperStub,
        '../../lib/log': logStub,
        '../utils/appConstants': constants,
        './volumeSession': sessions,
      });

      session = sessions.sessionForMountedVolume(mountRow(mount));
    });

    afterEach(async () => {
      if (tmpRoot) await realFs.rm(tmpRoot, { recursive: true, force: true });
    });

    it('deletes an incomplete operation - nothing was published and nobody waits', async () => {
      await realFs.mkdir(at(OP));
      await write('realdata', 'keep me');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([OP]);
      expect(restored).to.deep.equal([]);
      expect(await exists(at('realdata'))).to.equal(true);
    });

    it('restores displaced data when the destination is missing', async () => {
      // The crash-between-two-renames case. Deleting here would destroy the
      // caller's only copy. The marker holds a path relative to the volume
      // root, because flux-op writes it from inside a container that has only
      // that root and no notion of where it sits on the host.
      await park('photos');

      const { restored } = await sweeper.sweepStagingDirectories(session);

      expect(restored).to.deep.equal([at('photos')]);
      // Published by the executor, with both operands expressed as the
      // container sees them - never as host paths.
      expect(publishes()).to.have.lengthOf(1);
      expect(publishes()[0].slice(-3)).to.deep.equal([`/work/${OLD}`, '/work/photos', '--']);
    });

    it('refuses a relative marker that climbs out of the volume', async () => {
      await park('../../etc/shadow');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(publishes()).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(removed).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
    });

    it('refuses a marker naming a path outside the volume, and keeps the data', async () => {
      await park('/etc/cron.d/pwn');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(publishes()).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(removed).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
    });

    it('refuses a marker that climbs out of the work root', async () => {
      await park('/work/../../../etc/shadow');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(publishes()).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(removed).to.deep.equal([]);
    });

    it('refuses a marker whose parent directory is a symlink off the volume', async () => {
      // The one the lexical rules cannot see. Every component of the recorded
      // path is innocent as TEXT and the whole of it normalises to somewhere
      // inside the volume - but `appdata/escape` is a link the app owner made
      // from inside its own container, and rename(2) follows every component of
      // a destination but the last.
      const outside = nodePath.join(tmpRoot, 'etc-cron.d');
      await realFs.mkdir(outside);
      await realFs.mkdir(at('appdata'));
      await realFs.symlink(outside, at('appdata', 'escape'));

      await park('appdata/escape/pwn');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(publishes()).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(removed).to.deep.equal([]);
      // Nothing reached the directory the link named, and the parked data is
      // still parked.
      expect(await exists(nodePath.join(outside, 'pwn'))).to.equal(false);
      expect(await exists(at(OLD))).to.equal(true);
    });

    it('does not wait for a writer when a marker is a named pipe', async () => {
      // The whole of the rest of startup sits behind this sweep. Opening a FIFO
      // for reading waits for somebody to open it for writing, and the app owns
      // its own volume root - so a pipe planted where a marker belongs held the
      // open for ever. The recovery is awaited at boot, so the app network
      // reclaim, syncthing and the PGP identity never ran, on every boot, for
      // as long as the pipe was there. What is asserted here is that this call
      // RETURNS at all.
      await realFs.mkdir(at(OLD));
      await new Promise((resolve, reject) => {
        childProcess.execFile('mkfifo', [at(`${OLD}.dest`)], (error) => (error ? reject(error) : resolve()));
      });

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      // And that it decides nothing. What the marker holds could not be read,
      // so where the parked entry belongs is unknown and it stays put - the one
      // outcome that cannot lose somebody's only copy.
      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
    });

    it('deletes displaced data when the publish completed', async () => {
      await write('photos', 'the published copy');
      await park('photos', { identity: await identityOf('photos') });

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(restored).to.deep.equal([]);
      expect(removed).to.include(OLD);
      expect(publishes()).to.deep.equal([]);
    });

    it('deletes displaced data after the app has written into what was published', async function writtenInto() {
      // The regression this covers. The identity used to be the modification
      // time, which an app moves simply by using its own volume - so the sweep
      // stopped recognising its own work and kept the displaced copy for ever.
      // With the reserved names in this same release that copy is hidden from
      // the file browser and refused at the delete path, so the owner could
      // neither see it nor remove it, on a volume with a fixed size.
      if (!await keepsCreationTime()) this.skip();

      await realFs.mkdir(at('photos'));
      await park('photos', { identity: await identityOf('photos') });

      // Exactly what a running app does to its own volume.
      await realFs.writeFile(at('photos', 'written-by-the-app'), 'x');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(restored).to.deep.equal([]);
      expect(removed).to.include(OLD);
    });

    it('cannot do the same for a marker written before the image recorded a creation time', async () => {
      // The control for the test above - without it that assertion could pass
      // for a reason that has nothing to do with the clock. It is also the
      // honest limit of the fix: a marker left by the first release of the
      // image carries only an mtime, so the sweep still gives up on it. Nothing
      // is lost, and the entry stays visible to its owner.
      await realFs.mkdir(at('photos'));
      await park('photos', { identity: await legacyIdentityOf('photos') });
      await realFs.writeFile(at('photos', 'written-by-the-app'), 'x');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
    });

    it('still places data for a marker written before the image recorded a creation time', async () => {
      // Two fields and no clock is what is already sitting on volumes, and it
      // has to keep working: this is the case where the destination is empty
      // and the parked entry is the only copy.
      await park('photos', { identity: '1 1' });

      const { restored } = await sweeper.sweepStagingDirectories(session);

      expect(restored).to.deep.equal([at('photos')]);
    });

    it('keeps both when the creation time says the destination is not what was published', async function notOurs() {
      // The safety the comparison exists for, unchanged: the app owner created
      // something at the destination while it stood empty. A reused inode
      // number cannot make this match, because a new object has a new creation
      // time.
      if (!await keepsCreationTime()) this.skip();

      await realFs.mkdir(at('photos'));
      const theirs = await identityOf('photos');
      await realFs.rm(at('photos'), { recursive: true });
      await realFs.mkdir(at('photos'));
      await park('photos', { identity: theirs });

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
    });

    it('deletes displaced data when a link was what the publish placed', async () => {
      // A move publishes a link as a link, so one resolving to something real
      // at the destination is an ordinary completed publish.
      await write('target', 'real');
      await realFs.symlink(at('target'), at('photos'));
      await park('photos', { identity: await identityOf('photos') });

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(restored).to.deep.equal([]);
      expect(removed).to.include(OLD);
    });

    it('cleans up a published link without asking where it leads', async () => {
      // A link published as a link is an ordinary completed publish whether or
      // not it resolves. Where it leads is a question about the host, and an
      // absolute link written inside a container never named a host path - so
      // the identity settles it and nothing follows anything.
      await realFs.symlink(nodePath.join(tmpRoot, 'no-such-target'), at('photos'));
      await park('photos', { identity: await identityOf('photos') });

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(restored).to.deep.equal([]);
      expect(removed).to.include(OLD);
      expect(publishes()).to.deep.equal([]);
    });

    it('keeps both when the destination holds something else entirely', async () => {
      // The app owner created something at the destination while it stood
      // empty. Restoring would overwrite what they have and deleting would lose
      // the copy held for them, so neither is decided here.
      await write('photos', 'the app owner put this here');
      await park('photos');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(publishes()).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
      expect(await exists(at(`${OLD}.dest`))).to.equal(true);
      expect(await realFs.readFile(at('photos'), 'utf8')).to.equal('the app owner put this here');
    });

    it('refuses a marker that records no identity', async () => {
      // Every marker flux-op writes carries one. Without it a completed publish
      // cannot be told from the app owner's own entry, which is the whole
      // decision - so the data stays parked rather than being guessed about.
      await write(OLD, 'THE ONLY COPY\n');
      await write(`${OLD}.dest`, 'photos\n');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
    });

    it('deletes a marker whose entry never arrived', async () => {
      // The crash landed between writing the marker and the rename that uses
      // it, so nothing was displaced. Without this it stays in the volume root
      // forever, one per interruption, visible in the file browser.
      await write(`${OLD}.dest`, 'photos\n1 1\n');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([`${OLD}.dest`]);
      expect(restored).to.deep.equal([]);
    });

    it('refuses a marker that is a link, rather than reading through it as root', async () => {
      // The volume root is the app owner's to write, and this process is root:
      // a marker replaced with a link names a file the owner cannot read and
      // this can. Following it both discloses the file and puts it in a log.
      const hostOnly = nodePath.join(tmpRoot, 'host-only');
      await realFs.writeFile(hostOnly, '/etc/SUPERSECRET-TOKEN-9f3\n');
      await write(OLD, 'mine');
      await realFs.symlink(hostOnly, at(`${OLD}.dest`));

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
      const logged = [...logStub.error.getCalls(), ...logStub.warn.getCalls()]
        .map((call) => call.args[0]).join('\n');
      expect(logged).to.not.contain('SUPERSECRET-TOKEN-9f3');
    });

    it('refuses a marker longer than any path it could name', async () => {
      await write(OLD, 'mine');
      await write(`${OLD}.dest`, 'A'.repeat(64 * 1024));

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
      const logged = [...logStub.error.getCalls(), ...logStub.warn.getCalls()]
        .map((call) => call.args[0]).join('\n');
      expect(logged.length).to.be.below(1000);
    });

    it('keeps displaced data when its marker cannot be read', async () => {
      // A directory where the marker should be: readFile fails with EISDIR,
      // which is not ENOENT, so it is not "no marker was ever written".
      // Deleting on the strength of a read that failed once is the outcome the
      // whole function exists to prevent.
      await write(OLD, 'mine');
      await realFs.mkdir(at(`${OLD}.dest`));

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(await exists(at(OLD))).to.equal(true);
    });

    it('leaves a user folder that merely starts with a reserved prefix', async () => {
      // Nothing reserves these prefixes at creation time, and the sweep DELETES
      // what it matches - so the name has to be the exact shape flux-op
      // produces, not just something that begins like it.
      await realFs.mkdir(at('.flux-op-backups'));
      await realFs.mkdir(at('.flux-old-notes'));
      await realFs.mkdir(at('.flux-op-'));
      await realFs.mkdir(at(`${OP}x`));

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(serviceHelperStub.runCommand.called).to.equal(false);
    });

    it('leaves everything else on the volume alone', async () => {
      await realFs.mkdir(at('uploads'));
      await write('wp-config.php', '<?php');
      await write('.htaccess', 'deny');

      const { removed, restored } = await sweeper.sweepStagingDirectories(session);

      expect(removed).to.deep.equal([]);
      expect(restored).to.deep.equal([]);
      expect(serviceHelperStub.runCommand.called).to.equal(false);
    });

    it('reports nothing when the volume cannot be read', async () => {
      await realFs.rm(mount, { recursive: true, force: true });

      const result = await sweeper.sweepStagingDirectories(session);

      expect(result).to.deep.equal({ removed: [], restored: [] });
    });
  });
  describe('run - byte progress', () => {
    // The container has to outlive at least one tick (progressIntervalMs is 50
    // in this config) for the ticker to read anything.
    const runsFor = (ms) => sinon.stub().returns(
      new Promise((resolve) => { setTimeout(() => resolve({ StatusCode: 0 }), ms); }),
    );

    // blocks as a real lstat reports them: 512-byte units, and a file occupies
    // whole filesystem blocks however few bytes it holds.
    const fileEntry = (size) => ({
      isDirectory: () => false, isFile: () => true, size, blocks: Math.ceil(size / 4096) * 8,
    });

    const operands = async (vol) => ({
      staging: await vol.resolve('.flux-op-x'),
      destination: await vol.resolve('out'),
    });

    /** statfs answers, in order, as the volume fills. */
    const fills = (...usedBlocks) => {
      const stub = sinon.stub();
      usedBlocks.forEach((used, i) => {
        stub.onCall(i).resolves({ bsize: 4096, blocks: 100000, bfree: 100000 - used });
      });
      stub.resolves({ bsize: 4096, blocks: 100000, bfree: 100000 - usedBlocks[usedBlocks.length - 1] });
      return stub;
    };

    it('reads progress from the filesystem, not by walking the staging tree', async () => {
      // A walk of 20,000 files costs 179ms and repeats every tick; for an app
      // with 30,000 that is a tenth of a core burned to draw a progress bar.
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);
      fsStub.statfs = fills(10, 20, 30);
      fsStub.lstat = sinon.stub().resolves(fileEntry(4096));

      const seen = [];
      await volumeExecutor.run(vol, ['cp'], { publish, onBytes: (bytes) => seen.push(bytes) });

      expect(fsStub.statfs.called).to.equal(true);
      // The staging path is never walked while the operation runs. The one
      // lstat call is the final reading, at the destination.
      const walked = fsStub.lstat.getCalls().map((c) => c.args[0]);
      expect(walked.filter((p) => p.includes('.flux-op-x'))).to.deep.equal([]);
      expect(seen).to.not.deep.equal([]);
    });

    it('reports what the volume has gained since the operation began', async () => {
      // Not what the volume holds: the app's existing data is not this copy's
      // work, so progress is the difference from a baseline taken at the start.
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);
      fsStub.statfs = fills(1000, 1010, 1020);

      const seen = [];
      await volumeExecutor.run(vol, ['cp'], { publish, onBytes: (bytes) => seen.push(bytes) });

      // baseline is 1000 blocks; the first tick reads 1010.
      expect(seen[0]).to.equal(10 * 4096);
    });

    it('never reports a negative figure when the app deletes its own data', async () => {
      // The application keeps writing - and deleting - throughout. A volume
      // that shrinks below the baseline would otherwise send a bar backwards.
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);
      fsStub.statfs = fills(1000, 900);

      const seen = [];
      await volumeExecutor.run(vol, ['cp'], { publish, onBytes: (bytes) => seen.push(bytes) });

      expect(seen.every((b) => b >= 0), `saw ${JSON.stringify(seen)}`).to.equal(true);
    });

    it('reports what was published once it succeeds, not the last tick', async () => {
      // The running figure is whatever the last tick read, short of the truth by
      // however much was written after it - so without a final reading a
      // completed copy says Succeeded while the bytes say 87%.
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);
      fsStub.statfs = fills(1, 2);
      fsStub.lstat = sinon.stub().callsFake(async (p) => (
        p === `${MOUNT}/out` ? fileEntry(9000) : fileEntry(1)
      ));

      const seen = [];
      await volumeExecutor.run(vol, ['cp'], { publish, onBytes: (bytes) => seen.push(bytes) });

      // 9000 bytes occupy three 4096-byte blocks, and occupied is what every
      // other figure in this progress bar is counted in - the running one is
      // the volume's own used-bytes through statfs.
      expect(seen[seen.length - 1], 'the last figure is not the published size').to.equal(12288);
    });

    it('measures the destination for that final reading, because staging is gone by then', async () => {
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);
      fsStub.lstat = sinon.stub().resolves(fileEntry(4096));

      await volumeExecutor.run(vol, ['cp'], { publish, onBytes: () => {} });

      const measured = fsStub.lstat.getCalls().map((c) => c.args[0]);
      expect(measured[measured.length - 1]).to.equal(`${MOUNT}/out`);
    });

    it('reports no final figure for an operation that failed', async () => {
      // Nothing was published, so there is nothing at the destination to
      // measure and no figure that would mean anything.
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = sinon.stub().resolves({ StatusCode: 1 });
      fsStub.lstat = sinon.stub().resolves(fileEntry(4096));

      await expect(volumeExecutor.run(vol, ['cp'], { publish, onBytes: () => {} }))
        .to.be.rejectedWith('exit code 1');

      expect(fsStub.lstat.calledWith(`${MOUNT}/out`)).to.equal(false);
    });

    it('stops reporting when the filesystem cannot be read at all', async () => {
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);
      fsStub.statfs = sinon.stub().rejects(new Error('EIO'));
      fsStub.lstat = sinon.stub().resolves(fileEntry(4096));

      const seen = [];
      await volumeExecutor.run(vol, ['cp'], { publish, onBytes: (bytes) => seen.push(bytes) });

      expect(seen).to.deep.equal([]);
    });

    it('reports nothing to a caller that did not ask', async () => {
      // A move publishes its source where it stands, so the volume gains
      // nothing and a figure would report zero throughout. The caller opts in.
      // The volume is still READ - that is how a stalled operation is noticed -
      // but nothing is handed back.
      const vol = await openSession();
      const publish = await operands(vol);
      containerStub.wait = runsFor(180);
      const onBytes = sinon.stub();

      await volumeExecutor.run(vol, [], { publish });

      expect(onBytes.called).to.equal(false);
    });
  });

  describe('run - a container that never starts', () => {
    it('removes it, because AutoRemove only fires for one that ran', async () => {
      // Otherwise it stays on the node: stopped, invisible to the app sweeps
      // because it is correctly labelled as ours, and holding a reference to
      // the executor image that stops anything reclaiming it.
      containerStub.start = sinon.stub().rejects(new Error('no such image'));
      const vol = await openSession();

      await expect(volumeExecutor.run(vol, ['cp'])).to.be.rejectedWith('no such image');

      expect(containerStub.remove.calledOnce, 'the container was left behind').to.equal(true);
      expect(containerStub.remove.firstCall.args[0]).to.deep.equal({ force: true });
    });

    it('leaves no unhandled rejection behind, which would end the process', async () => {
      // The wait-for-exit subscription is opened before start, so a failed
      // start leaves it with nobody listening. Node ends the PROCESS over that,
      // and FluxOS has every app on the node riding on this one.
      const rejections = [];
      const record = (reason) => rejections.push(reason);
      process.on('unhandledRejection', record);

      try {
        containerStub.start = sinon.stub().rejects(new Error('cgroup limit'));
        containerStub.wait = sinon.stub().rejects(new Error('container gone'));
        const vol = await openSession();

        await expect(volumeExecutor.run(vol, ['cp'])).to.be.rejectedWith('cgroup limit');
        // Rejections are delivered on a later turn than the one that made them.
        await new Promise((resolve) => { setTimeout(resolve, 50); });

        expect(rejections, `unhandled: ${rejections.map((r) => r && r.message)}`).to.deep.equal([]);
      } finally {
        process.off('unhandledRejection', record);
      }
    });

    it('frees the app slot, so a failed start does not wedge the queue', async () => {
      // One operation per app: a slot never released means every later request
      // for that app is refused until FluxOS restarts.
      containerStub.start = sinon.stub().rejects(new Error('no such image'));
      const vol = await openSession();
      await expect(volumeExecutor.run(vol, ['cp'])).to.be.rejected;

      // The next one gets as far as its own start rather than being refused.
      containerStub.start = sinon.stub().resolves();
      await volumeExecutor.run(vol, ['true']);
      expect(containerStub.start.called).to.equal(true);
    });

    it('still removes it when the removal itself fails', async () => {
      containerStub.start = sinon.stub().rejects(new Error('no such image'));
      containerStub.remove = sinon.stub().rejects(new Error('already gone'));
      const vol = await openSession();

      // The start failure is what the caller hears about, not the cleanup.
      await expect(volumeExecutor.run(vol, ['cp'])).to.be.rejectedWith('no such image');
    });
  });

  describe('run - what a failure says', () => {
    it('says what the command said, not just its exit code', async () => {
      // "The archive is corrupt", "it expands past the volume" and "it contains
      // a symlink" are three different problems with three different answers,
      // and they all arrived as the same number.
      containerOutput = 'flux-op: result contains links, which are not accepted here\n';
      containerStub.wait = sinon.stub().resolves({ StatusCode: 4 });
      const vol = await openSession();

      await expect(volumeExecutor.run(vol, ['unzip']))
        .to.be.rejectedWith('result contains links');
    });

    it('keeps the exit code alongside it', async () => {
      containerOutput = 'flux-op: result is 900 bytes, over the 500 limit\n';
      containerStub.wait = sinon.stub().resolves({ StatusCode: 3 });
      const vol = await openSession();

      await expect(volumeExecutor.run(vol, ['unzip'])).to.be.rejectedWith('exit 3');
    });

    it('attaches before the container starts, or a fast failure says nothing', async () => {
      // Same reason the exit subscription is opened first: AutoRemove takes the
      // container the moment it exits, and a later attach finds nothing.
      const vol = await openSession();
      await volumeExecutor.run(vol, ['true']);

      expect(containerStub.attach.calledBefore(containerStub.start)).to.equal(true);
    });

    it('keeps the end of a long output, where the reason is', async () => {
      containerOutput = `${'chatter\n'.repeat(2000)}the actual reason`;
      containerStub.wait = sinon.stub().resolves({ StatusCode: 1 });
      const vol = await openSession();

      await expect(volumeExecutor.run(vol, ['tar'])).to.be.rejectedWith('the actual reason');
    });

    it('bounds what it keeps, so a runaway command cannot fill memory', async () => {
      containerOutput = 'x'.repeat(50000);
      containerStub.wait = sinon.stub().resolves({ StatusCode: 1 });
      const vol = await openSession();

      const error = await volumeExecutor.run(vol, ['tar']).catch((e) => e);
      expect(error.message.length).to.be.below(3000);
    });

    it('falls back to the exit code when the command said nothing', async () => {
      containerOutput = '';
      containerStub.wait = sinon.stub().resolves({ StatusCode: 2 });
      const vol = await openSession();

      await expect(volumeExecutor.run(vol, ['tar']))
        .to.be.rejectedWith('failed with exit code 2');
    });

    it('still runs the operation when the output cannot be captured', async () => {
      // Losing the explanation is worse than an exit code alone; failing the
      // operation over it would be worse still.
      containerStub.attach = sinon.stub().rejects(new Error('no such container'));
      const vol = await openSession();

      await volumeExecutor.run(vol, ['true']);
      expect(containerStub.start.called).to.equal(true);
    });
  });

  describe('run - an operation that stops getting anywhere', () => {
    const runsFor = (ms) => sinon.stub().returns(
      new Promise((resolve) => { setTimeout(() => resolve({ StatusCode: 0 }), ms); }),
    );
    const usedBlocks = (n) => ({ bsize: 4096, blocks: 100000, bfree: 100000 - n });

    it('stops one that has written nothing for the whole window', async () => {
      // A wall clock cannot tell a wedged container from a large copy - moving
      // 100 GB legitimately outruns any limit short enough to be useful. What
      // the volume has consumed can, and it is already being read.
      configStub.fluxapps.volumeOperations.stallTimeoutMs = 60;
      const vol = await openSession();
      containerStub.wait = runsFor(600);
      fsStub.statfs = sinon.stub().resolves(usedBlocks(500));

      await expect(volumeExecutor.run(vol, ['cp'], {
        publish: { staging: await vol.resolve('.flux-op-x'), destination: await vol.resolve('out') },
        onBytes: () => {},
      })).to.be.rejectedWith('making no progress');

      expect(containerStub.stop.called, 'the container was left running').to.equal(true);
    });

    it('leaves one alone while the volume is still moving', async () => {
      configStub.fluxapps.volumeOperations.stallTimeoutMs = 120;
      const vol = await openSession();
      containerStub.wait = runsFor(400);
      let used = 500;
      fsStub.statfs = sinon.stub().callsFake(async () => {
        used += 10;
        return usedBlocks(used);
      });

      await volumeExecutor.run(vol, ['cp'], {
        publish: { staging: await vol.resolve('.flux-op-x'), destination: await vol.resolve('out') },
        onBytes: () => {},
      });

      expect(containerStub.stop.called, 'a working operation was stopped').to.equal(false);
    });

    it('counts a shrinking volume as progress too', async () => {
      // A delete moves usage DOWN. An operation that is removing data is still
      // an operation that is doing something.
      configStub.fluxapps.volumeOperations.stallTimeoutMs = 120;
      const vol = await openSession();
      containerStub.wait = runsFor(400);
      let used = 5000;
      fsStub.statfs = sinon.stub().callsFake(async () => {
        used -= 10;
        return usedBlocks(used);
      });

      await volumeExecutor.run(vol, ['rm'], {
        publish: { staging: await vol.resolve('.flux-op-x'), destination: await vol.resolve('out') },
      });

      expect(containerStub.stop.called).to.equal(false);
    });

    it('does not count a slow image fetch against the operation', async () => {
      // Timed from when the container starts. Pulling the image on a cold node
      // takes seconds and is not the operation making no progress.
      configStub.fluxapps.volumeOperations.stallTimeoutMs = 200;
      pulled = false;
      dockerServiceStub.pullImage = sinon.stub().callsFake(() => new Promise((resolve) => {
        setTimeout(() => { pulled = true; resolve(); }, 300);
      }));
      const vol = await openSession();
      containerStub.wait = runsFor(100);
      fsStub.statfs = sinon.stub().resolves(usedBlocks(500));

      await volumeExecutor.run(vol, ['cp'], {
        publish: { staging: await vol.resolve('.flux-op-x'), destination: await vol.resolve('out') },
      });

      expect(containerStub.stop.called, 'stopped because the image was slow to arrive').to.equal(false);
    });
  });

  describe('run - an upload streamed into the container', () => {
    const { Readable, Writable } = require('node:stream');

    let socket;
    let exit;

    // A stand-in for the hijacked duplex socket. Records what reached the
    // container, and reports whether the transfer was ENDED - which is the
    // signal that says "you have everything" - or torn down.
    const makeSocket = () => {
      const received = [];
      const stream = new Writable({
        write(chunk, encoding, callback) { received.push(chunk); callback(); },
      });
      stream.received = received;
      sinon.spy(stream, 'end');
      sinon.spy(stream, 'destroy');
      return stream;
    };

    // A container whose exit is decided by the test rather than resolved up
    // front: the whole point here is which of the transfer and the exit lands
    // first.
    const deferredExit = () => {
      let settle;
      const promise = new Promise((resolve) => { settle = resolve; });
      return { promise, finish: (StatusCode) => settle({ StatusCode }) };
    };

    const sending = (chunks) => Readable.from(chunks);

    // Produces forever and never ends, like a client still sending when the
    // container gives up. Paced, because the socket here is a stand-in that
    // accepts instantly - a real one back-pressures, and an unpaced source
    // would fill this process's memory rather than the test's purpose.
    const neverEnds = () => new Readable({
      read() { setTimeout(() => this.push(Buffer.alloc(16)), 5); },
    });

    beforeEach(() => {
      socket = makeSocket();
      exit = deferredExit();
      // The container cannot exit before its input closes: dd blocks on read,
      // and flux-op cannot publish before dd exits. That ordering is what makes
      // a truncated upload unpublishable, so the stub obeys it rather than
      // resolving up front and racing the transfer.
      socket.on('finish', () => exit.finish(0));
      containerStub.wait = sinon.stub().returns(exit.promise);
      // The two attaches are told apart by what they ask for. Returning the
      // socket for both would let a test pass while the executor attached
      // stdin without hijacking it, which cannot be written to at all.
      containerStub.attach = sinon.stub().callsFake(async (options) => (options.stdin ? socket : 'raw-stream'));
    });

    const upload = async (vol, source, options = {}) => {
      const staging = await vol.resolve('.flux-op-upload');
      const destination = await vol.resolve('uploaded.bin');
      return volumeExecutor.run(vol, [], {
        input: source, publish: { staging, destination }, ...options,
      });
    };

    it('is not stopped while the caller is still sending, however slowly', async () => {
      // A client trickling a small file over a slow link moves no whole
      // filesystem block for minutes, so the volume says nothing is happening
      // while something plainly is. Bytes arriving are the direct evidence, and
      // they are exact where a block is rounded.
      configStub.fluxapps.volumeOperations.stallTimeoutMs = 120;
      // Scaled with the window, the same thousandfold as 120ms stands in for
      // ten minutes: this sender manages ~200 bit/s, comfortably over.
      configStub.fluxapps.volumeOperations.minUploadBitsPerSecond = 64;
      // The volume never moves: too little has arrived to fill a block.
      fsStub.statfs = sinon.stub().resolves({ bsize: 4096, blocks: 100000, bfree: 99500 });

      const trickle = new Readable({ read() {} });
      const sendingSlowly = setInterval(() => trickle.push('.'), 40);
      setTimeout(() => { clearInterval(sendingSlowly); trickle.push(null); }, 400);

      const vol = await openSession();
      await upload(vol, trickle);

      clearInterval(sendingSlowly);
      // Without ticks past the window, "not stopped" would say nothing.
      expect(fsStub.statfs.callCount, 'FIXTURE: the ticker never polled').to.be.above(3);
      expect(containerStub.stop.called, 'a caller that was still sending was stopped').to.equal(false);
    });

    it('stops one sending too slowly to ever finish', async () => {
      // The direction that was never tested, which is why the hole shipped: the
      // check above used to accept ANY byte as evidence, so a caller sending
      // one per window kept its slot until the request itself timed out two
      // hours later - and four of those take every file operation slot the node
      // has. The same trickle as above, against a floor it cannot keep.
      configStub.fluxapps.volumeOperations.stallTimeoutMs = 120;
      // 1000 bit/s over a 120ms window asks for 15 bytes. The sender manages ~3.
      configStub.fluxapps.volumeOperations.minUploadBitsPerSecond = 1000;
      // The volume never moves either, so the bytes are the only thing that
      // could have spoken for this transfer.
      fsStub.statfs = sinon.stub().resolves({ bsize: 4096, blocks: 100000, bfree: 99500 });

      const trickle = new Readable({ read() {} });
      const sendingSlowly = setInterval(() => trickle.push('.'), 40);
      setTimeout(() => { clearInterval(sendingSlowly); trickle.push(null); }, 500);

      const vol = await openSession();
      await expect(upload(vol, trickle)).to.be.rejectedWith('under the 1000 bit/s');

      clearInterval(sendingSlowly);
      expect(containerStub.stop.called, 'a caller under the floor was left running').to.equal(true);
    });

    it('opens stdin with hijack, before the container starts', async () => {
      const vol = await openSession();
      await upload(vol, sending(['data']));

      const stdinAttach = containerStub.attach.getCalls().find((call) => call.args[0].stdin);
      expect(stdinAttach, 'stdin was never attached').to.not.equal(undefined);
      // Without hijack the attach returns a half-closed response stream and
      // nothing can be written to the container at all.
      expect(stdinAttach.args[0].hijack).to.equal(true);
      expect(stdinAttach.calledBefore(containerStub.start.firstCall)).to.equal(true);
    });

    it('opens the container stdin, which nothing else does', async () => {
      const vol = await openSession();
      await upload(vol, sending(['data']));

      const [options] = dockerServiceStub.createContainer.firstCall.args;
      expect(options.OpenStdin).to.equal(true);
      expect(options.AttachStdin).to.equal(true);
      expect(options.StdinOnce).to.equal(true);
    });

    it('leaves stdin closed for every other operation', async () => {
      const vol = await openSession();
      containerStub.wait = sinon.stub().resolves({ StatusCode: 0 });
      await volumeExecutor.run(vol, ['true']);

      const [options] = dockerServiceStub.createContainer.firstCall.args;
      expect(options.OpenStdin).to.equal(undefined);
    });

    it('tells flux-op to write the stream itself, with no command', async () => {
      const vol = await openSession();
      await upload(vol, sending(['data']), { maxBytes: 4096 });

      const [options] = dockerServiceStub.createContainer.firstCall.args;
      expect(options.Cmd).to.include('--from-stdin');
      expect(options.Cmd).to.include('--discard-staging');
      // The ceiling is enforced as the bytes arrive on this path, so it has to
      // reach flux-op rather than being checked afterwards.
      expect(options.Cmd).to.include('--max-bytes');
      expect(options.Cmd[options.Cmd.indexOf('--max-bytes') + 1]).to.equal('4096');
      // Nothing after the separator: a command reading a stream cannot tell a
      // truncated one from a complete one.
      expect(options.Cmd[options.Cmd.length - 1]).to.equal('--');
    });

    it('delivers what the caller sent, and closes stdin only then', async () => {
      const vol = await openSession();
      await upload(vol, sending(['one', 'two', 'three']));

      expect(Buffer.concat(socket.received).toString()).to.equal('onetwothree');
      // Closing stdin is what tells the container it has everything, so it is
      // sent only when the transfer actually completed.
      expect(socket.end.called).to.equal(true);
    });

    it('stops the container when the upload does not complete, and never closes stdin', async () => {
      const vol = await openSession();
      const source = new Readable({ read() {} });

      const running = upload(vol, source);
      // Once the transfer is actually under way, so this exercises a client
      // that goes away mid-upload rather than one that never connected.
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      source.push(Buffer.from('half a file'));
      source.destroy(new Error('client went away'));

      // flux-op traps the stop and reports a cancellation.
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      exit.finish(143);

      await expect(running).to.be.rejectedWith(/did not complete/);
      expect(containerStub.stop.called, 'the container was left running').to.equal(true);
      // Closing it would be indistinguishable from a complete upload, and half
      // a file would be published as though it were whole.
      expect(socket.end.called, 'stdin was closed on a truncated upload').to.equal(false);
    });

    it('does not wait forever when the container refuses mid-stream', async () => {
      // A container that has stopped reading never drains the socket and never
      // errors: the writer stalls and stays there. Every refusal an upload can
      // produce arrives this way.
      const vol = await openSession();
      const source = neverEnds();
      containerOutput = 'flux-op: input is over the 1000 byte limit';

      const running = upload(vol, source, { maxBytes: 1000 });
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      exit.finish(3);

      await expect(running).to.be.rejectedWith(/over the 1000 byte limit/);
      // Unpiped rather than destroyed: for an upload this stream belongs to the
      // multipart parser, and destroying it stops the parser consuming the
      // request - so a client still sending can never finish, and never reads
      // the refusal. The caller drains what is left.
      expect(source.destroyed, 'the caller\'s stream was destroyed').to.equal(false);
      expect(socket.destroyed, 'the container socket was left open').to.equal(true);
    });

    it('refuses an upload that is not published through staging', async () => {
      const vol = await openSession();
      const destination = await vol.resolve('uploaded.bin');
      const source = await vol.resolve('somewhere');

      await expect(volumeExecutor.run(vol, [], {
        input: sending(['data']), publish: { source, destination },
      })).to.be.rejectedWith(/requires publishing through staging/);
    });

    it('refuses an upload that also carries a command', async () => {
      const vol = await openSession();
      const staging = await vol.resolve('.flux-op-upload');
      const destination = await vol.resolve('uploaded.bin');

      await expect(volumeExecutor.run(vol, ['cat'], {
        input: sending(['data']), publish: { staging, destination },
      })).to.be.rejectedWith(/takes no command/);
    });

    it('runs inside a slot the caller already holds, without taking a second', async () => {
      const vol = await openSession();
      const release = volumeExecutor.acquireSlot(vol.identifier);

      // maxConcurrentPerApp is 1, so this would be refused if it took its own.
      await upload(vol, sending(['data']), { slotHeld: true });
      release();
    });

    it('closes the socket to dockerd when the container never starts', async () => {
      // Opened before start, so a start that throws leaves a duplex socket to
      // dockerd with nobody holding either end.
      containerStub.start = sinon.stub().rejects(new Error('no such image'));
      const vol = await openSession();

      await expect(upload(vol, sending(['data']))).to.be.rejectedWith(/no such image/);
      expect(socket.destroy.called, 'the hijacked socket was left open').to.equal(true);
    });

    it('closes the socket to dockerd when the operation fails after starting', async () => {
      // A failure other than the start, so the close cannot live on the start's
      // own error path.
      const vol = await openSession();
      const boom = new Error('reporting blew up');

      await expect(upload(vol, sending(['data']), {
        onProgress: () => { throw boom; },
      })).to.be.rejectedWith(/reporting blew up/);
      expect(socket.destroy.called, 'the hijacked socket was left open').to.equal(true);
    });

    it('stops a container it has stopped waiting for', async () => {
      // The slot is released when run() returns. Leaving the container running
      // lets a second operation start on the same app while the first is still
      // writing to the volume.
      const vol = await openSession();

      await expect(upload(vol, sending(['data']), {
        onProgress: () => { throw new Error('reporting blew up'); },
      })).to.be.rejected;
      expect(containerStub.stop.called, 'the container was left running').to.equal(true);
    });
  });

});
