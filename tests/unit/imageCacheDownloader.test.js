const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('imageCacheDownloader tests', () => {
  let getCredentialsStub;
  let dockerPullStreamStub;
  let systemArchitectureStub;
  let verifierState;
  let capturedVerifierArgs;

  class FakeVerifier {
    constructor(repotag, options) {
      capturedVerifierArgs = { repotag, options };
      this.provider = 'registry-1.docker.io';
      this.error = verifierState.error;
      this.errorDetail = verifierState.errorDetail;
      this.compressedSize = 0;
      this.supported = verifierState.supported;
      this.supportedArchitectures = verifierState.supportedArchitectures || [];
    }

    // eslint-disable-next-line class-methods-use-this
    async verifyImage() {
      this.compressedSize = verifierState.compressedSize || 0;
      return !this.error;
    }

    // eslint-disable-next-line class-methods-use-this
    async fetchManifestDigestOnly() {
      return verifierState.digest || null;
    }
  }

  function build() {
    capturedVerifierArgs = null;
    getCredentialsStub = sinon.stub();
    dockerPullStreamStub = sinon.stub().callsFake((pullConfig, res, cb) => cb(null));
    systemArchitectureStub = sinon.stub().resolves('amd64');
    verifierState = {
      error: false, errorDetail: null, supported: true, compressedSize: 1000, digest: 'sha256:abc', supportedArchitectures: ['amd64'],
    };
    return proxyquire('../../ZelBack/src/services/appLifecycle/imageCacheDownloader', {
      config: { fluxapps: { maxImageSize: 5_000_000_000 } },
      '../dockerService': { dockerPullStream: dockerPullStreamStub },
      '../utils/imageVerifier': { ImageVerifier: FakeVerifier },
      '../utils/registryCredentialHelper': { getCredentials: getCredentialsStub },
      '../appSystem/systemIntegration': { systemArchitecture: systemArchitectureStub },
      '../utils/appConstants': { supportedArchitectures: ['amd64', 'arm64'] },
    });
  }

  afterEach(() => {
    sinon.restore();
  });

  describe('inspectImage', () => {
    it('returns compressed size + digest for a private image and resolves v8 creds keyed per owner', async () => {
      const dl = build();
      getCredentialsStub.resolves({ username: 'u', password: 'p' });
      const result = await dl.inspectImage('repo:tag', 'authstr', { fluxId: 'F1' });
      expect(result).to.deep.equal({
        ok: true,
        compressedBytes: 1000,
        digest: 'sha256:abc',
        supported: true,
        supportedArchitectures: ['amd64'],
        error: null,
      });
      expect(getCredentialsStub.calledOnceWith('repo:tag', 'authstr', 8, 'imagecache:F1')).to.equal(true);
      expect(capturedVerifierArgs.options.credentials).to.deep.equal({ username: 'u', password: 'p' });
    });

    it('does not resolve credentials for a public image (no repoauth)', async () => {
      const dl = build();
      const result = await dl.inspectImage('repo:tag', '', { fluxId: 'F1' });
      expect(result.ok).to.equal(true);
      expect(getCredentialsStub.called).to.equal(false);
      expect(capturedVerifierArgs.options.credentials).to.equal(undefined);
    });

    it('returns ok:false with the detail when the image fails verification', async () => {
      const dl = build();
      verifierState.error = true;
      verifierState.errorDetail = 'size is over Flux limit';
      const result = await dl.inspectImage('repo:tag', '', {});
      expect(result.ok).to.equal(false);
      expect(result.error).to.equal('size is over Flux limit');
    });

    it('returns ok:false (no throw) when credential resolution fails', async () => {
      const dl = build();
      getCredentialsStub.rejects(new Error('decrypt fail'));
      const result = await dl.inspectImage('repo:tag', 'authstr', { fluxId: 'F1' });
      expect(result.ok).to.equal(false);
      expect(result.error).to.equal('decrypt fail');
    });
  });

  describe('pullImage', () => {
    it('pulls with an authConfig object (not a colon string), provider, progressTap and abortSignal', async () => {
      const dl = build();
      getCredentialsStub.resolves({ username: 'u', password: 'p:with:colons' });
      const onProgress = sinon.stub();
      const abortSignal = {};
      await dl.pullImage({
        repotag: 'repo:tag', repoauth: 'authstr', fluxId: 'F1', onProgress, abortSignal,
      });
      const pullConfig = dockerPullStreamStub.firstCall.args[0];
      expect(pullConfig.repoTag).to.equal('repo:tag');
      expect(pullConfig.authConfig).to.deep.equal({ username: 'u', password: 'p:with:colons' });
      expect(pullConfig.provider).to.equal('registry-1.docker.io');
      expect(pullConfig.progressTap).to.equal(onProgress);
      expect(pullConfig.abortSignal).to.equal(abortSignal);
    });

    it('pulls a public image with no authConfig/provider', async () => {
      const dl = build();
      await dl.pullImage({ repotag: 'repo:tag', repoauth: '', fluxId: 'F1' });
      const pullConfig = dockerPullStreamStub.firstCall.args[0];
      expect(pullConfig.repoTag).to.equal('repo:tag');
      expect(pullConfig.authConfig).to.equal(undefined);
      expect(pullConfig.provider).to.equal(undefined);
      expect(getCredentialsStub.called).to.equal(false);
    });

    it('rejects when credentials are required but cannot be resolved', async () => {
      const dl = build();
      getCredentialsStub.resolves(null);
      let threw = false;
      try {
        await dl.pullImage({ repotag: 'repo:tag', repoauth: 'authstr', fluxId: 'F1' });
      } catch (err) {
        threw = true;
        expect(err.message).to.contain('Unable to resolve registry credentials');
      }
      expect(threw).to.equal(true);
      expect(dockerPullStreamStub.called).to.equal(false);
    });
  });
});
