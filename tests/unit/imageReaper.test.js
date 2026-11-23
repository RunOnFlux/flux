const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const operationRegistry = require('../../ZelBack/src/services/utils/operationRegistry');

describe('imageReaper tests', () => {
  let imageReaper;
  let dockerService;
  let images;
  let containers;
  let removed;

  const OWN = 'ghcr.io/runonflux/flux-volume-tools:v1.7.0';
  const OWN_ID = 'sha256:own-amd64';
  const gone = () => Object.assign(new Error('no such image'), { statusCode: 404 });
  const inUse = () => Object.assign(new Error('image is being used by a stopped container'), { statusCode: 409 });

  beforeEach(() => {
    images = [];
    containers = [];
    removed = [];
    dockerService = {
      dockerListImages: sinon.stub().callsFake(async () => images),
      dockerListContainers: sinon.stub().callsFake(async () => containers),
      appDockerImageRemove: sinon.stub().callsFake(async (reference) => { removed.push(reference); }),
    };
    imageReaper = proxyquire('../../ZelBack/src/services/appLifecycle/imageReaper', {
      config: { fluxapps: { volumeOperations: { image: OWN, imageIds: { amd64: OWN_ID, arm64: 'sha256:own-arm64' }, indexId: 'sha256:own-index' } } },
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../dockerService': dockerService,
      '../utils/operationRegistry': operationRegistry,
      '../utils/fluxEventBus': { publish: sinon.stub() },
    });
  });

  afterEach(() => {
    operationRegistry.clear();
    sinon.restore();
  });

  describe('every image on the node', () => {
    it('removes a tagged image nothing uses by each of its tags, and an untagged one by its id', async () => {
      images = [
        { Id: 'sha256:a', RepoTags: ['org/a:1', 'org/a:latest'] },
        { Id: 'sha256:b', RepoTags: ['<none>:<none>'] },
      ];

      const outcome = await imageReaper.pruneUnusedImages();

      expect(removed).to.deep.equal(['org/a:1', 'org/a:latest', 'sha256:b']);
      expect(outcome).to.deep.equal({ removed: 2, kept: 0, deferred: 0 });
    });

    it('keeps an image a container references, running or stopped, by its reference or by its id', async () => {
      images = [
        { Id: 'sha256:byname', RepoTags: ['org/byname:1'] },
        { Id: 'sha256:byid', RepoTags: ['org/byid:1'] },
      ];
      containers = [
        { Image: 'org/byname:1', ImageID: 'sha256:other' },
        { Image: 'sha256:byid', ImageID: 'sha256:byid', State: 'exited' },
      ];

      const outcome = await imageReaper.pruneUnusedImages();

      expect(removed).to.deep.equal([]);
      expect(outcome.kept).to.equal(2);
    });

    it('keeps FluxOS\'s own file-operation image by its reference and by its pinned id, and reclaims an older one', async () => {
      images = [
        { Id: 'sha256:tagged', RepoTags: [OWN] },
        { Id: OWN_ID, RepoTags: ['<none>:<none>'] },
        { Id: 'sha256:older', RepoTags: ['ghcr.io/runonflux/flux-volume-tools:v1.6.0'] },
      ];

      await imageReaper.pruneUnusedImages();

      expect(removed).to.deep.equal(['ghcr.io/runonflux/flux-volume-tools:v1.6.0']);
    });

    // eslint-disable-next-line no-restricted-syntax
    for (const type of ['install', 'redeploy', 'rebuild']) {
      it(`removes nothing while an ${type} holds an app, and removes it once the ${type} has ended`, async () => {
        images = [{ Id: 'sha256:a', RepoTags: ['org/a:1'] }];
        const token = operationRegistry.acquire('someapp', type, 'test');

        const during = await imageReaper.pruneUnusedImages();
        operationRegistry.release('someapp', token);
        const after = await imageReaper.pruneUnusedImages();

        expect(during).to.deep.equal({ removed: 0, kept: 0, deferred: 1 });
        expect(after.removed).to.equal(1);
        expect(removed).to.deep.equal(['org/a:1']);
      });
    }

    it('removes images while an operation that builds nothing holds an app', async () => {
      images = [{ Id: 'sha256:a', RepoTags: ['org/a:1'] }];
      operationRegistry.acquire('someapp', 'backup', 'test');

      await imageReaper.pruneUnusedImages();

      expect(removed).to.deep.equal(['org/a:1']);
    });

    it('removes nothing while images are held, and removes them once the hold is let go', async () => {
      images = [{ Id: 'sha256:a', RepoTags: ['org/a:1'] }];
      const letGo = imageReaper.holdImages();

      await imageReaper.pruneUnusedImages();
      expect(removed, 'removed while held').to.deep.equal([]);
      letGo();
      letGo();
      await imageReaper.pruneUnusedImages();

      expect(removed).to.deep.equal(['org/a:1']);
    });

    it('removes nothing when the containers cannot be listed', async () => {
      images = [{ Id: 'sha256:a', RepoTags: ['org/a:1'] }];
      dockerService.dockerListContainers.rejects(new Error('docker did not answer'));

      const outcome = await imageReaper.pruneUnusedImages();

      expect(removed).to.deep.equal([]);
      expect(outcome.deferred).to.equal(1);
    });

    it('counts an image already gone as removed, and one docker says is in use as kept', async () => {
      images = [
        { Id: 'sha256:gone', RepoTags: ['org/gone:1'] },
        { Id: 'sha256:busy', RepoTags: ['org/busy:1'] },
      ];
      dockerService.appDockerImageRemove.withArgs('org/gone:1').rejects(gone());
      dockerService.appDockerImageRemove.withArgs('org/busy:1').rejects(inUse());

      const outcome = await imageReaper.pruneUnusedImages();

      expect(outcome).to.deep.equal({ removed: 1, kept: 1, deferred: 0 });
    });
  });

  describe('named images', () => {
    it('removes an app\'s image when nothing uses it, and tells the caller', async () => {
      const report = sinon.stub();

      await imageReaper.reclaimImages(['org/app:1', 'org/app:1'], { report });

      expect(removed).to.deep.equal(['org/app:1']);
      sinon.assert.calledWith(report, 'Image org/app:1 removed');
    });

    it('keeps an app\'s image another app\'s container uses', async () => {
      containers = [{ Image: 'org/shared:1', ImageID: 'sha256:shared' }];

      await imageReaper.reclaimImages(['org/shared:1']);

      expect(removed).to.deep.equal([]);
    });

    it('leaves an app\'s image for a later pass while another app is being installed', async () => {
      operationRegistry.acquire('otherapp', 'install', 'test');

      const outcome = await imageReaper.reclaimImages(['org/shared:1']);

      expect(removed).to.deep.equal([]);
      expect(outcome.deferred).to.equal(1);
    });
  });
});
