const { expect } = require('chai');
const sinon = require('sinon');

const registryResponses = require('./data/registryResponses');

// stub out axiosGet, axiosInstance
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

const { ImageVerifier } = require('../../ZelBack/src/services/utils/imageVerifier');

describe('imageVerifier tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('parse repoTag tests', () => {
    it('should parse complex repository correctly', async () => {
      const repotag = 'example.repository.com:50000/complex/namespace/split/image:latest';

      const verifier = new ImageVerifier(repotag);

      expect(verifier.provider).to.eql('example.repository.com:50000');
      expect(verifier.namespace).to.eql('complex/namespace');
      expect(verifier.repository).to.eql('split/image');
      expect(verifier.tag).to.eql('latest');
    });

    it('should parse basic repository correctly', async () => {
      const repotag = 'runonflux/website:latest';

      const verifier = new ImageVerifier(repotag);

      expect(verifier.provider).to.eql('registry-1.docker.io');
      expect(verifier.namespace).to.eql('runonflux');
      expect(verifier.repository).to.eql('website');
      expect(verifier.tag).to.eql('latest');
    });

    it('should parse basic repository correctly B', async () => {
      const repotag = 'runonflux/web_site:latest';

      const verifier = new ImageVerifier(repotag);

      expect(verifier.provider).to.eql('registry-1.docker.io');
      expect(verifier.namespace).to.eql('runonflux');
      expect(verifier.repository).to.eql('web_site');
      expect(verifier.tag).to.eql('latest');
    });

    it('should parse dockerhub library images correctly', async () => {
      const repotag = 'mysql:latest';

      const verifier = new ImageVerifier(repotag);

      expect(verifier.provider).to.eql('registry-1.docker.io');
      expect(verifier.namespace).to.eql('library');
      expect(verifier.repository).to.eql('mysql');
      expect(verifier.tag).to.eql('latest');
    });

    it('should parse basic registry api correctly', async () => {
      const repotag = 'ghcr.io/iron-fish/ironfish:mytag';

      const verifier = new ImageVerifier(repotag);

      expect(verifier.provider).to.eql('ghcr.io');
      expect(verifier.namespace).to.eql('iron-fish');
      expect(verifier.repository).to.eql('ironfish');
      expect(verifier.tag).to.eql('mytag');
    });

    it('should parse namespace of registry api correctly', async () => {
      const repotag = 'public.ecr.aws/docker/library/mongo:latest';

      const verifier = new ImageVerifier(repotag);

      expect(verifier.provider).to.eql('public.ecr.aws');
      expect(verifier.namespace).to.eql('docker/library');
      expect(verifier.repository).to.eql('mongo');
      expect(verifier.tag).to.eql('latest');
    });

    it('should handle leading backslahes correctly', async () => {
      const repotag = '/nginx:latest';

      const verifier = new ImageVerifier(repotag);
      console.log(verifier);

      expect(
        () => verifier.throwIfError(),
      ).to.throw('Image tag: "/nginx:latest" cannot start or end with a backslash.');

      expect(verifier.provider).to.eql(null);
      expect(verifier.namespace).to.eql(null);
      expect(verifier.repository).to.eql(null);
      expect(verifier.tag).to.eql(null);
    });

    it('should handle trailing backslahes correctly', async () => {
      const repotag = 'nginx:latest/';

      const verifier = new ImageVerifier(repotag);
      console.log(verifier);

      expect(
        () => verifier.throwIfError(),
      ).to.throw('Image tag: "nginx:latest/" cannot start or end with a backslash.');

      expect(verifier.provider).to.eql(null);
      expect(verifier.namespace).to.eql(null);
      expect(verifier.repository).to.eql(null);
      expect(verifier.tag).to.eql(null);
    });

    it('should handle unparseable repotags correctly', async () => {
      const repotags = ['@nginx:latest'];

      repotags.forEach((tag) => {
        const verifier = new ImageVerifier(tag);
        expect(
          () => verifier.throwIfError(),
        ).to.throw(`Image tag: ${tag} is not in valid format [HOST[:PORT_NUMBER]/][NAMESPACE/]REPOSITORY[:TAG]`);

        expect(verifier.provider).to.eql(null);
        expect(verifier.namespace).to.eql(null);
        expect(verifier.repository).to.eql(null);
        expect(verifier.tag).to.eql(null);
      });
    });
  });

  describe('parseAuthHeader tests', () => {
    it('should parse auth header correctly', async () => {
      const authHeader = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:runonflux/secretwebsite:pull"';

      const result = ImageVerifier.parseAuthHeader(authHeader);

      expect(result.realm).to.eql('https://auth.docker.io/token');
      expect(result.service).to.eql('registry.docker.io');
      expect(result.scope).to.eql('repository:runonflux/secretwebsite:pull');
    });
    it('should parse auth header with underscores correctly', async () => {
      const authHeader = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:jeffvaderflux/helloworld_params:pull"';

      const result = ImageVerifier.parseAuthHeader(authHeader);

      expect(result.realm).to.eql('https://auth.docker.io/token');
      expect(result.service).to.eql('registry.docker.io');
      expect(result.scope).to.eql('repository:jeffvaderflux/helloworld_params:pull');
    });
  });

  describe('verifyImage tests', async () => {
    let axiosGetStub;
    let axiosInterceptorsUse;

    const unauthorizedError = (auth) => {
      const error = new Error('AxiosError: Request failed with status code 401');
      error.code = 'ERR_BAD_REQUEST';
      error.response = {
        status: 401,
        statusText: 'Unauthorized',
        headers: {
          'www-authenticate': auth,
        },
      };
      return error;
    };

    beforeEach(() => {
      axiosInterceptorsUse = sinon.stub().returns();
      axiosGetStub = sinon.stub(serviceHelper, 'axiosGet');
      sinon.stub(serviceHelper, 'axiosInstance').returns({ get: axiosGetStub, interceptors: { request: { use: axiosInterceptorsUse } } });
    });

    it('should throw if connection error', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          const error = new Error('Test Error');
          error.code = 'ENETUNREACH';
          throw error;
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);

      await verifier.verifyImage();

      expect(() => verifier.throwIfError()).to.throw(`Connection Error ENETUNREACH: ${repotag} not available`);
    });

    it('should throw if HTTP error other than 401', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          const error = new Error('Test Error');
          error.code = 'ERR_BAD_REQUEST';
          error.response = {
            status: 500,
            statusText: 'It is busted',
          };
          throw error;
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);

      await verifier.verifyImage();

      expect(() => verifier.throwIfError()).to.throw(`Bad HTTP Status 500: ${repotag} not available`);
    });

    it('should throw if www-authenticate header is malformed', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosGetStub.callsFake(async (url) => {
        const authHeader = 'Bearer MalformedHeader';

        if (url === 'megachips/ipshow/manifests/web') {
          throw unauthorizedError(authHeader);
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);

      await verifier.verifyImage();

      expect(() => verifier.throwIfError()).to.throw(`Malformed Auth Header: ${repotag} not available`);
    });

    it('should call auth endpoint with correct url params, and set auth details if authed', async () => {
      const repotag = 'megachips/ipshow:web';
      const authHeader = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:megachips/ipshow:pull"';
      const expected = 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:megachips/ipshow:pull';

      axiosGetStub.callsFake(async (url) => {
        if (url.match('https://auth.docker.io')) {
          return { data: { token: 'myToken' } };
        }

        if (url === 'megachips/ipshow/manifests/web') {
          throw unauthorizedError(authHeader);
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);

      await verifier.verifyImage();

      sinon.assert.calledWith(axiosGetStub, expected);
      expect(verifier.authConfigured).to.equal(true);
      expect(verifier.authVerified).to.equal(true);
    });

    it('should call auth endpoint with correct url params, and not set auth details if not authed', async () => {
      const repotag = 'megachips/ipshow:web';
      const authHeader = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:megachips/ipshow:pull"';
      const expected = 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:megachips/ipshow:pull';

      axiosGetStub.callsFake(async (url) => {
        if (url.match('https://auth.docker.io')) {
          const error = new Error('Test auauthorized');
          error.response = { status: 401 };
          throw error;
        }

        if (url === 'megachips/ipshow/manifests/web') {
          throw unauthorizedError(authHeader);
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);

      await verifier.verifyImage();

      sinon.assert.calledWith(axiosGetStub, expected);
      expect(verifier.authConfigured).to.equal(false);
      expect(verifier.authVerified).to.equal(false);
      expect(() => verifier.throwIfError()).to.throw(`Authentication rejected for: ${repotag}`);
    });

    it('should throw if unknown image tag', async () => {
      const repotag = 'unknown/image:tag';

      // the way this works with the registry (docker at least) is that it will deny
      // any request first off, even to non existent. It will then let you auth to a non existent
      // repository, and tell you that you're non authorized again.

      axiosGetStub.callsFake(async (url) => {
        const authHeader = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:unknown/image:pull"';

        if (url.match('https://auth.docker.io')) {
          return { data: { token: 'mytoken' } };
        }

        if (url === 'unknown/image/manifests/tag') {
          throw unauthorizedError(authHeader);
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);
      await verifier.verifyImage();

      expect(() => verifier.throwIfError()).to.throw(`Authentication failed: ${repotag} not available or doesn't exist`);
    });

    it('should not throw if a docker manifest arch matches the Flux network arches and under max size', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.distributionManifestAmd64 };
        }
        if (url === 'megachips/ipshow/blobs/sha256:87a2490a12aed4100891be53b521da77508dafef1d49422f7eb5088c6eb1631a') {
          return { data: registryResponses.imageConfigAmd64 };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.verifyImage();

      expect(result).to.equal(true);
      expect(() => verifier.throwIfError()).to.not.throw();
    });

    it('should throw if a docker manifest arch does not match the Flux network', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.distributionManifestListUnsupported };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.verifyImage();

      expect(result).to.equal(false);
      expect(() => verifier.throwIfError()).to.throw(`Docker image: ${repotag} does not have a valid architecture`);
    });

    it('should throw if a docker manifest arch is over max size', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.oversizeDistributionManifestAmd64 };
        }
        if (url === 'megachips/ipshow/blobs/sha256:87a2490a12aed4100891be53b521da77508dafef1d49422f7eb5088c6eb1631a') {
          return { data: registryResponses.imageConfigAmd64 };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.verifyImage();

      expect(result).to.equal(false);
      expect(() => verifier.throwIfError()).to.throw(`Docker image: ${repotag} size is over Flux limit`);
    });

    it('should not throw if an oci manifest arch matches the Flux network and under max size', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.ociManifestAmd64 };
        }
        if (url === 'megachips/ipshow/blobs/sha256:05247af918647d8d063d2e880cc65c1546a7d616cde1e6c6f5dab1ca091f6cf8') {
          return { data: registryResponses.imageConfigAmd64 };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.verifyImage();

      expect(result).to.equal(true);
      expect(() => verifier.throwIfError()).to.not.throw();
    });

    it('should throw if an oci manifest arch does not match the Flux network', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.ociIndexUnsupported };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.verifyImage();

      expect(result).to.equal(false);
      expect(() => verifier.throwIfError()).to.throw(`Docker image: ${repotag} does not have a valid architecture`);
    });

    it('should throw if an oci manifest arch is not under max size', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.oversizeOciManifestAmd64 };
        }
        if (url === 'megachips/ipshow/blobs/sha256:05247af918647d8d063d2e880cc65c1546a7d616cde1e6c6f5dab1ca091f6cf8') {
          return { data: registryResponses.imageConfigAmd64 };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.verifyImage();

      expect(result).to.equal(false);
      expect(() => verifier.throwIfError()).to.throw(`Docker image: ${repotag} size is over Flux limit`);
    });

    it('should not throw if valid distribution list and manifests received', async () => {
      const clock = sinon.useFakeTimers();

      const repotag = 'megachips/ipshow:web';

      const amd64Sha = 'sha256:2c62993fdc4eef2077030894893391a8d1b4b785106f25495af734e474c7c019';
      const arm64Sha = 'sha256:fe983a72f65856381bbf5376f5bd1f3a6961ee83bfd7f0d35e087ac655b3688a';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.distributionManifestList };
        }

        if (url === `megachips/ipshow/manifests/${amd64Sha}`) {
          return { data: registryResponses.distributionManifestAmd64 };
        }

        if (url === `megachips/ipshow/manifests/${arm64Sha}`) {
          return { data: registryResponses.distributionManifestArm64 };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);
      const promise = verifier.verifyImage();

      // because of aws ratelimiting, we send one per second
      await clock.tickAsync(1000);
      sinon.assert.calledTwice(axiosGetStub);
      await clock.tickAsync(1000);

      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.calledThrice(axiosGetStub);
      expect(() => verifier.throwIfError()).to.not.throw();
    });

    it('should not throw if valid oci index and manifests received', async () => {
      const clock = sinon.useFakeTimers();

      const repotag = 'megachips/ipshow:web';

      const amd64Sha = 'sha256:d4990507327f4d08aaf57d9c7e2e0250260e9f6ef7fa0e0bfe822c37ad2e1b2f';
      const arm64Sha = 'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.ociIndex };
        }

        if (url === `megachips/ipshow/manifests/${amd64Sha}`) {
          return { data: registryResponses.ociManifestAmd64 };
        }

        if (url === `megachips/ipshow/manifests/${arm64Sha}`) {
          return { data: registryResponses.ociManifestArm64 };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag);
      const promise = verifier.verifyImage();

      // because of aws ratelimiting, we send one per second
      await clock.tickAsync(1000);
      sinon.assert.calledTwice(axiosGetStub);
      await clock.tickAsync(1000);

      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.calledThrice(axiosGetStub);
      expect(() => verifier.throwIfError()).to.not.throw();
    });

    it('should mark image as useable if image validates and an arch matches local system', async () => {
      const clock = sinon.useFakeTimers();

      const repotag = 'megachips/ipshow:web';

      const amd64Sha = 'sha256:d4990507327f4d08aaf57d9c7e2e0250260e9f6ef7fa0e0bfe822c37ad2e1b2f';
      const arm64Sha = 'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.ociIndex };
        }

        if (url === `megachips/ipshow/manifests/${amd64Sha}`) {
          return { data: registryResponses.ociManifestAmd64 };
        }

        if (url === `megachips/ipshow/manifests/${arm64Sha}`) {
          return { data: registryResponses.ociManifestArm64 };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag, { architecture: 'arm64' });
      const promise = verifier.verifyImage();

      // because of aws ratelimiting, we send one per second
      await clock.tickAsync(2000);

      const result = await promise;

      expect(result).to.equal(true);
      expect(() => verifier.throwIfError()).to.not.throw();
      expect(verifier.supported).to.equal(true);
    });

    it('should mark image as not useable if image validates and an arch does not match local system', async () => {
      const clock = sinon.useFakeTimers();

      const repotag = 'megachips/ipshow:web';

      const amd64Sha = 'sha256:d4990507327f4d08aaf57d9c7e2e0250260e9f6ef7fa0e0bfe822c37ad2e1b2f';
      const arm64Sha = 'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890';

      axiosGetStub.callsFake(async (url) => {
        if (url === 'megachips/ipshow/manifests/web') {
          return { data: registryResponses.ociIndex };
        }

        if (url === `megachips/ipshow/manifests/${amd64Sha}`) {
          return { data: registryResponses.ociManifestAmd64 };
        }

        if (url === `megachips/ipshow/manifests/${arm64Sha}`) {
          return { data: registryResponses.ociManifestArm64 };
        }

        return { data: null };
      });

      const verifier = new ImageVerifier(repotag, { architecture: 'mips64' });
      const promise = verifier.verifyImage();

      // because of aws ratelimiting, we send one per second
      await clock.tickAsync(2000);

      const result = await promise;

      expect(result).to.equal(true);
      expect(() => verifier.throwIfError()).to.not.throw();
      expect(verifier.supported).to.equal(false);
    });
  });

  describe('errorMeta tests', () => {
    let axiosInstanceStub;
    // eslint-disable-next-line no-unused-vars
    let axiosGetStub;

    beforeEach(() => {
      axiosGetStub = sinon.stub(serviceHelper, 'axiosGet').resolves({ data: [] });
      axiosInstanceStub = sinon.stub(serviceHelper, 'axiosInstance');
    });

    it('should return null errorMeta when no error occurs', async () => {
      const repotag = 'megachips/ipshow:web';

      axiosInstanceStub.returns({
        get: sinon.stub().resolves({ data: registryResponses.dockerManifestV2 }),
        interceptors: { request: { use: sinon.stub() } },
      });

      const verifier = new ImageVerifier(repotag);
      await verifier.verifyImage();

      expect(verifier.errorMeta).to.be.null;
    });

    it('should populate errorMeta with network error type', async () => {
      const repotag = 'megachips/ipshow:web';

      const networkError = new Error('Connection Error ECONNREFUSED: image not available');
      networkError.code = 'ECONNREFUSED';

      axiosInstanceStub.returns({
        get: sinon.stub().rejects(networkError),
        interceptors: { request: { use: sinon.stub() } },
      });

      const verifier = new ImageVerifier(repotag);
      await verifier.verifyImage();

      expect(verifier.errorMeta).to.not.be.null;
      expect(verifier.errorMeta.errorType).to.equal('network');
      expect(verifier.errorMeta.errorCode).to.equal('ECONNREFUSED');
      expect(verifier.errorMeta.httpStatus).to.be.null;
    });

    it('should populate errorMeta with rate_limit error type for 429', async () => {
      const repotag = 'megachips/ipshow:web';

      const rateLimitError = new Error('Too many requests');
      rateLimitError.response = { status: 429 };

      axiosInstanceStub.returns({
        get: sinon.stub().rejects(rateLimitError),
        interceptors: { request: { use: sinon.stub() } },
      });

      const verifier = new ImageVerifier(repotag);
      await verifier.verifyImage();

      expect(verifier.errorMeta).to.not.be.null;
      expect(verifier.errorMeta.errorType).to.equal('rate_limit');
      expect(verifier.errorMeta.httpStatus).to.equal(429);
      expect(verifier.errorMeta.errorCode).to.be.null;
    });

    it('should populate errorMeta with server_error type for 5xx', async () => {
      const repotag = 'megachips/ipshow:web';

      const serverError = new Error('Server error');
      serverError.response = { status: 503 };

      axiosInstanceStub.returns({
        get: sinon.stub().rejects(serverError),
        interceptors: { request: { use: sinon.stub() } },
      });

      const verifier = new ImageVerifier(repotag);
      await verifier.verifyImage();

      expect(verifier.errorMeta).to.not.be.null;
      expect(verifier.errorMeta.errorType).to.equal('server_error');
      expect(verifier.errorMeta.httpStatus).to.equal(503);
    });

    it('should populate errorMeta with size_limit error type', async () => {
      const repotag = 'megachips/ipshow:web';

      // Create manifest with oversized image
      const oversizedManifest = {
        schemaVersion: 2,
        mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        config: {
          digest: 'sha256:test',
        },
        layers: [
          { size: 3_000_000_000 }, // 3GB - over the 2GB limit
        ],
      };

      axiosInstanceStub.returns({
        get: sinon.stub().resolves({ data: oversizedManifest }),
        interceptors: { request: { use: sinon.stub() } },
      });

      const verifier = new ImageVerifier(repotag, { maxImageSize: 2_000_000_000 });
      await verifier.verifyImage();

      expect(verifier.errorMeta).to.not.be.null;
      expect(verifier.errorMeta.errorType).to.equal('size_limit');
    });

    it('should populate errorMeta with unsupported_architecture error type', async () => {
      const repotag = 'megachips/ipshow:web';

      // Create manifest list with only arm64
      const arm64OnlyIndex = {
        schemaVersion: 2,
        mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
        manifests: [
          {
            digest: 'sha256:test',
            platform: { architecture: 'arm64' },
          },
        ],
      };

      axiosInstanceStub.returns({
        get: sinon.stub().resolves({ data: arm64OnlyIndex }),
        interceptors: { request: { use: sinon.stub() } },
      });

      const verifier = new ImageVerifier(repotag, { architectureSet: ['amd64'] }); // Only allow amd64
      await verifier.verifyImage();

      expect(verifier.errorMeta).to.not.be.null;
      expect(verifier.errorMeta.errorType).to.equal('unsupported_architecture');
    });

    it('should reset errorMeta when resetErrors is called', async () => {
      const repotag = 'megachips/ipshow:web';

      const networkError = new Error('Connection Error');
      networkError.code = 'ECONNREFUSED';

      axiosInstanceStub.returns({
        get: sinon.stub().rejects(networkError),
        interceptors: { request: { use: sinon.stub() } },
      });

      const verifier = new ImageVerifier(repotag);
      await verifier.verifyImage();

      expect(verifier.errorMeta).to.not.be.null;

      verifier.resetErrors();

      expect(verifier.errorMeta).to.be.null;
    });
  });
});
