const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios').default;

const whitelistRepos = require('./data/whitelistRepos');
const registryResponses = require('./data/registryResponses');

const { ImageVerifier } = require('../../ZelBack/src/services/utils/imageVerifier');

describe('imageVerifier tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('isWhitelisted tests', () => {
    let axiosStub;

    beforeEach(() => {
      axiosStub = sinon.stub(axios, 'get').resolves(whitelistRepos);
      ImageVerifier.resetWhitelist();
    });

    it('should fetch whitelist immediately if no whitelist exists', async () => {
      const whitelistLength = whitelistRepos.data.length;

      const repotag = 'namespace/image:tag';

      const verifier = new ImageVerifier(repotag);

      expect(ImageVerifier.whitelistedImages.length).to.equal(0);
      sinon.assert.notCalled(axiosStub);
      await verifier.isWhitelisted();
      sinon.assert.calledOnce(axiosStub);
      expect(ImageVerifier.whitelistedImages.length).to.equal(whitelistLength);
    });

    it('should not fetch whitelist if it exists and fetched within 10 minutes', async () => {
      const clock = sinon.useFakeTimers();

      const repotag = 'namespace/image:tag';

      const verifier = new ImageVerifier(repotag);

      ImageVerifier.whitelistedImages = whitelistRepos.data;

      // 20s short of limit
      await clock.tickAsync(580_000);

      await verifier.isWhitelisted();
      sinon.assert.notCalled(axiosStub);
    });

    it('should fetch whitelist if it exists and is older than 10 minutes', async () => {
      const clock = sinon.useFakeTimers();

      const repotag = 'namespace/image:tag';

      const verifier = new ImageVerifier(repotag);

      ImageVerifier.whitelistedImages = whitelistRepos.data;

      // 20s over limit
      await clock.tickAsync(620_000);

      await verifier.isWhitelisted();
      sinon.assert.calledOnce(axiosStub);
    });

    it('should wait if fetching in progress and then return', async () => {
      const clock = sinon.useFakeTimers();

      axiosStub.callsFake(async () => {
        await new Promise((r) => { setTimeout(r, 3_000); });
        return whitelistRepos;
      });

      const repotag = 'namespace/image:tag';

      const verifier1 = new ImageVerifier(repotag);
      const verifier2 = new ImageVerifier(repotag);

      const promise1 = verifier1.isWhitelisted();
      const promise2 = verifier2.isWhitelisted();

      // verifier1 is simulated waiting for the axios call, verifier2
      // is waiting for the lock to free.
      await clock.tickAsync(1_000);
      sinon.assert.calledOnce(axiosStub);
      expect(ImageVerifier.whitelistedImages.length).to.equal(0);

      // verifier1 has finished and updated the time, verifier2 bails out as it
      // sees that the lastupdatetime has been updated.
      await clock.tickAsync(2_000);

      await promise1;
      await promise2;

      expect(ImageVerifier.whitelistedImages.length).to.equal(whitelistRepos.data.length);
      sinon.assert.calledOnce(axiosStub);
    });

    it('should throw error if repotag is not a string', async () => {
      const repotag = 1234;

      const verifier = new ImageVerifier(repotag);
      await verifier.isWhitelisted();

      expect(
        () => verifier.throwIfError(),
      ).to.throw('Invalid Docker Image Tag');
    });

    it('should throw error if axios throws', async () => {
      axiosStub.rejects();

      const repotag = 'testing/12343:latest';

      const verifier = new ImageVerifier(repotag);
      await verifier.isWhitelisted();

      expect(
        () => verifier.throwIfError(),
      ).to.throw('Unable to fetch whitelisted repositories. Try again later.');
    });

    it('should throw error if ImageTag is not a full tag', async () => {
      const badImageTags = ['improperformat', 'improper/format'];

      const promises = [];
      const verifiers = [];

      badImageTags.forEach((imageTag) => {
        const verifier = new ImageVerifier(imageTag);
        verifiers.push(verifier);
        promises.push(verifier.isWhitelisted());
      });

      await Promise.all(promises);

      verifiers.forEach((v, index) => {
        expect(
          () => v.throwIfError(),
        ).to.throw(`Image Tag: ${badImageTags[index]} is not in valid format [HOST[:PORT_NUMBER]/][NAMESPACE/]REPOSITORY:TAG`);
      });
    });

    it('should throw error if repo is not whitelisted', async () => {
      const repotag = 'doesnotexist/inthewhitelist:nope';

      const verifier = new ImageVerifier(repotag);
      await verifier.isWhitelisted();

      expect(
        () => verifier.throwIfError(),
      ).to.throw('Repository is not whitelisted. Please contact Flux Team.');
    });

    it('should throw error if only tag is whitelisted and not namespace', async () => {
      const repotag = 'public.ecr.aws/docker/library/hello-world:notlisted';

      const verifier = new ImageVerifier(repotag);
      await verifier.isWhitelisted();

      expect(
        () => verifier.throwIfError(),
      ).to.throw('Repository is not whitelisted. Please contact Flux Team.');
    });

    it('should throw error if only sibling image is whitelisted', async () => {
      const repotag = 'ghcr.io/handshake-org/london:latest';

      const verifier = new ImageVerifier(repotag);
      await verifier.isWhitelisted();

      expect(
        () => verifier.throwIfError(),
      ).to.throw('Repository is not whitelisted. Please contact Flux Team.');
    });

    it('should return true if namespace is whitelisted', async () => {
      const goodImageTags = ['yurinnick/folding-at-home:latest', 'wirewrex/uptimekuma:latest'];

      const promises = [];
      const verifiers = [];

      goodImageTags.forEach((imageTag) => {
        const verifier = new ImageVerifier(imageTag);
        verifiers.push(verifier);
        promises.push(verifier.isWhitelisted());
      });

      const results = await Promise.all(promises);

      verifiers.forEach((v, index) => {
        expect(results[index]).to.equal(true);
        expect(
          () => v.throwIfError(),
        ).to.not.throw();
      });
    });

    it('should return true if image is whitelisted', async () => {
      const repotag = 'justfortesting/imagetime:latest';

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.isWhitelisted();

      expect(result).to.equal(true);
      expect(
        () => verifier.throwIfError(),
      ).to.not.throw();
    });

    it('should return true if registry namespace is whitelisted', async () => {
      const repotag = 'download.lootlink.xyz/wirewrex/kappa:delta';

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.isWhitelisted();

      expect(result).to.equal(true);
      expect(
        () => verifier.throwIfError(),
      ).to.not.throw();
    });

    it('should return true if registry namespace has 2 slashes and is whitelisted', async () => {
      const repotag = 'europe-west2-docker.pkg.dev/chode-400710/mugawump/testimage:blahblah';

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.isWhitelisted();

      expect(result).to.equal(true);
      expect(
        () => verifier.throwIfError(),
      ).to.not.throw();
    });

    it('should return true if registry namespace and image has 2 slashes and namespace is whitelisted', async () => {
      const repotag = 'us-docker.pkg.dev/google-samples/containers/gke/hello-app:2.0';

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.isWhitelisted();

      expect(result).to.equal(true);
      expect(
        () => verifier.throwIfError(),
      ).to.not.throw();
    });

    it('should return true if registry namespace and image has 2 slashes and image is whitelisted', async () => {
      const repotag = 'us-docker.pkg.dev/google-samples/containers/madeup/image:sausages';

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.isWhitelisted();

      expect(result).to.equal(true);
      expect(
        () => verifier.throwIfError(),
      ).to.not.throw();
    });

    it('should return true if registry image is whitelisted', async () => {
      const repotag = 'gcr.io/google-samples/node-hello:latest';

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.isWhitelisted();

      expect(result).to.equal(true);
      expect(
        () => verifier.throwIfError(),
      ).to.not.throw();
    });

    it('should return true if registry tag is whitelisted', async () => {
      const repotag = 'public.ecr.aws/docker/library/hello-world:linux';

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.isWhitelisted();

      expect(result).to.equal(true);
      expect(
        () => verifier.throwIfError(),
      ).to.not.throw();
    });

    it('should return true if dockerhub library tag is whitelisted', async () => {
      const repotag = 'mysql:latest';

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.isWhitelisted();

      expect(result).to.equal(true);
      expect(
        () => verifier.throwIfError(),
      ).to.not.throw();
    });

    it('should be rejected if namespace not whitelisted', async () => {
      const repotag = 'runonfluxb/website:latest';

      const verifier = new ImageVerifier(repotag);
      const result = await verifier.isWhitelisted();

      expect(result).to.equal(false);
      expect(
        () => verifier.throwIfError(),
      ).to.throw('Repository is not whitelisted. Please contact Flux Team.');
    });
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
  });

  describe('parseAuthHeader tests', () => {
    it('should parse auth header correctly', async () => {
      const authHeader = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:runonflux/secretwebsite:pull"';

      const result = ImageVerifier.parseAuthHeader(authHeader);

      expect(result.realm).to.eql('https://auth.docker.io/token');
      expect(result.service).to.eql('registry.docker.io');
      expect(result.scope).to.eql('repository:runonflux/secretwebsite:pull');
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
      axiosGetStub = sinon.stub(axios, 'get');
      sinon.stub(axios, 'create').returns({ get: axiosGetStub, interceptors: { request: { use: axiosInterceptorsUse } } });
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
      expect(verifier.authed).to.equal(true);
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
      expect(verifier.authed).to.equal(false);
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
});
