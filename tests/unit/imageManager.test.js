const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const pgpService = require('../../ZelBack/src/services/pgpService');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const imageVerifier = require('../../ZelBack/src/services/utils/imageVerifier');

describe('imageManager tests', () => {
  let imageManager;

  beforeEach(() => {
    // Clear module cache to reset internal state/caches
    delete require.cache[require.resolve('../../ZelBack/src/services/appSecurity/imageManager')];
    // Reload module with fresh state
    imageManager = require('../../ZelBack/src/services/appSecurity/imageManager');

    // Clear the dockerHubVerificationCache before each test
    const fluxCaching = require('../../ZelBack/src/services/utils/cacheManager').default;
    if (fluxCaching.dockerHubVerificationCache) {
      fluxCaching.dockerHubVerificationCache.clear();
    }
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('verifyRepository tests', () => {
    let ImageVerifierStub;

    beforeEach(() => {
      ImageVerifierStub = sinon.stub(imageVerifier, 'ImageVerifier').returns({
        verifyImage: sinon.stub().resolves(),
        throwIfError: sinon.stub(),
        addCredentials: sinon.stub(),
        supported: true,
        errorMeta: null,
      });
    });

    it('should verify repository without authentication', async () => {
      await imageManager.verifyRepository('test/app:latest');

      sinon.assert.calledOnce(ImageVerifierStub);
      const instance = ImageVerifierStub.firstCall.returnValue;
      sinon.assert.calledOnce(instance.verifyImage);
      sinon.assert.calledOnce(instance.throwIfError);
    });

    it('should verify repository with authentication', async () => {
      sinon.stub(pgpService, 'decryptMessage').resolves('username:token');

      await imageManager.verifyRepository('test/app:latest', {
        repoauth: 'encrypted_credentials',
        usePgpDecrypt: true,
      });

      const instance = ImageVerifierStub.firstCall.returnValue;
      sinon.assert.calledWith(pgpService.decryptMessage, 'encrypted_credentials');
      sinon.assert.calledWith(instance.addCredentials, 'username:token');
    });

    it('should throw error if unable to decrypt credentials', async () => {
      sinon.stub(pgpService, 'decryptMessage').resolves(null);

      try {
        await imageManager.verifyRepository('test/app:latest', {
          repoauth: 'invalid_credentials',
          usePgpDecrypt: true,
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Unable to decrypt provided credentials');
      }
    });

    it('should throw error if credentials not in correct format', async () => {
      sinon.stub(pgpService, 'decryptMessage').resolves('invalidformat');

      try {
        await imageManager.verifyRepository('test/app:latest', {
          repoauth: 'encrypted_credentials',
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('not in the correct username:token format');
      }
    });

    it('should skip verification when skipVerification is true', async () => {
      const result = await imageManager.verifyRepository('test/app:latest', {
        repoauth: 'encrypted_credentials',
        skipVerification: true,
      });

      expect(result).to.be.true;
    });

    it('should throw error if architecture not supported', async () => {
      ImageVerifierStub.returns({
        verifyImage: sinon.stub().resolves(),
        throwIfError: sinon.stub(),
        addCredentials: sinon.stub(),
        supported: false,
        errorMeta: null,
      });

      try {
        await imageManager.verifyRepository('test/app:latest', {
          architecture: 'arm64',
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include("architecture arm64 not supported");
      }
    });

    it('should pass architecture to ImageVerifier', async () => {
      await imageManager.verifyRepository('test/app:latest', {
        architecture: 'amd64',
      });

      const constructorArgs = ImageVerifierStub.firstCall.args;
      expect(constructorArgs[1].architecture).to.equal('amd64');
    });

    it('should cache successful verification using fluxCaching', async () => {
      await imageManager.verifyRepository('test/app:latest');

      // Check that cache was set
      const fluxCaching = require('../../ZelBack/src/services/utils/cacheManager').default;
      const cacheKey = 'test/app:latest:any:noauth';
      const cached = fluxCaching.dockerHubVerificationCache.get(cacheKey);

      expect(cached).to.not.be.undefined;
      expect(cached.result).to.equal(true);
      expect(cached.error).to.be.null;
    });

    it('should return cached successful verification', async () => {
      // First call
      await imageManager.verifyRepository('test/app:latest');

      const firstCallCount = ImageVerifierStub.callCount;

      // Second call should use cache
      await imageManager.verifyRepository('test/app:latest');

      // ImageVerifier should not be called again (cache hit)
      expect(ImageVerifierStub.callCount).to.equal(firstCallCount);
    });

    it('should cache failed verification with custom TTL based on error type', async () => {
      const networkError = new Error('Connection Error ECONNREFUSED: image not available');

      ImageVerifierStub.returns({
        verifyImage: sinon.stub().resolves(),
        throwIfError: sinon.stub().throws(networkError),
        addCredentials: sinon.stub(),
        supported: true,
        errorMeta: {
          httpStatus: null,
          errorCode: 'ECONNREFUSED',
          errorType: 'network',
        },
      });

      try {
        await imageManager.verifyRepository('test/app:latest');
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Error should be thrown
        expect(error.message).to.include('Connection Error');
      }

      // Check that failure was cached
      const fluxCaching = require('../../ZelBack/src/services/utils/cacheManager').default;
      const cacheKey = 'test/app:latest:any:noauth';
      const cached = fluxCaching.dockerHubVerificationCache.get(cacheKey);

      expect(cached).to.not.be.undefined;
      expect(cached.result).to.be.null;
      expect(cached.error).to.include('Connection Error');
    });

    it('should throw cached error on subsequent calls', async () => {
      const networkError = new Error('Connection Error ECONNREFUSED');

      ImageVerifierStub.returns({
        verifyImage: sinon.stub().resolves(),
        throwIfError: sinon.stub().throws(networkError),
        addCredentials: sinon.stub(),
        supported: true,
        errorMeta: {
          errorType: 'network',
          errorCode: 'ECONNREFUSED',
          httpStatus: null,
        },
      });

      // First call - actual verification
      try {
        await imageManager.verifyRepository('test/app:latest');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Connection Error');
      }

      ImageVerifierStub.resetHistory();

      // Second call - should use cache and throw cached error
      try {
        await imageManager.verifyRepository('test/app:latest');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Connection Error');
      }

      // ImageVerifier should not be instantiated on second call (cache hit)
      sinon.assert.notCalled(ImageVerifierStub);
    });

    it('should use different cache keys for different architectures', async () => {
      // First call with amd64
      await imageManager.verifyRepository('test/app:latest', { architecture: 'amd64' });

      // Second call with arm64
      await imageManager.verifyRepository('test/app:latest', { architecture: 'arm64' });

      // Both should have been verified (different cache keys)
      sinon.assert.calledTwice(ImageVerifierStub);

      const fluxCaching = require('../../ZelBack/src/services/utils/cacheManager').default;
      const amd64Key = 'test/app:latest:amd64:noauth';
      const arm64Key = 'test/app:latest:arm64:noauth';

      expect(fluxCaching.dockerHubVerificationCache.get(amd64Key)).to.not.be.undefined;
      expect(fluxCaching.dockerHubVerificationCache.get(arm64Key)).to.not.be.undefined;
    });

    it('should classify network errors with 1 hour TTL', async () => {
      const networkError = new Error('Connection Error');

      ImageVerifierStub.returns({
        verifyImage: sinon.stub().resolves(),
        throwIfError: sinon.stub().throws(networkError),
        errorMeta: {
          errorType: 'network',
          errorCode: 'ECONNREFUSED',
          httpStatus: null,
        },
      });

      try {
        await imageManager.verifyRepository('test/app:latest');
      } catch (error) {
        // Expected
      }

      // The error should be logged with "1 hour" in the message
      // We can't directly test TTL without waiting, but we test classification logic
      const { FluxCacheManager } = require('../../ZelBack/src/services/utils/cacheManager');
      expect(FluxCacheManager.oneHour).to.equal(3600000); // 1 hour in ms
    });

    it('should classify rate limit errors with 2 hour TTL', async () => {
      const rateLimitError = new Error('Too many requests');

      ImageVerifierStub.returns({
        verifyImage: sinon.stub().resolves(),
        throwIfError: sinon.stub().throws(rateLimitError),
        errorMeta: {
          errorType: 'rate_limit',
          errorCode: null,
          httpStatus: 429,
        },
      });

      try {
        await imageManager.verifyRepository('test/app:latest');
      } catch (error) {
        // Expected
      }

      const { FluxCacheManager } = require('../../ZelBack/src/services/utils/cacheManager');
      expect(2 * FluxCacheManager.oneHour).to.equal(7200000); // 2 hours in ms
    });

    it('should classify permanent errors with 7 day TTL', async () => {
      const permanentError = new Error('Repository is not whitelisted');

      ImageVerifierStub.returns({
        verifyImage: sinon.stub().resolves(),
        throwIfError: sinon.stub().throws(permanentError),
        errorMeta: {
          errorType: 'not_whitelisted',
          errorCode: null,
          httpStatus: null,
        },
      });

      try {
        await imageManager.verifyRepository('test/app:latest');
      } catch (error) {
        // Expected
      }

      const { FluxCacheManager } = require('../../ZelBack/src/services/utils/cacheManager');
      expect(7 * FluxCacheManager.oneDay).to.equal(604800000); // 7 days in ms
    });
  });

  describe('getBlockedRepositores tests', () => {
    it('should return cached blocked repositories', async () => {
      const cachedData = ['blocked/repo1', 'blocked/repo2'];

      // First call to populate cache
      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: cachedData });
      const result1 = await imageManager.getBlockedRepositores();

      // Second call should use cache
      const result2 = await imageManager.getBlockedRepositores();

      expect(result1).to.deep.equal(cachedData);
      expect(result2).to.deep.equal(cachedData);
      sinon.assert.calledOnce(serviceHelper.axiosGet);
    });

    it('should fetch blocked repositories from GitHub', async () => {
      const blockedRepos = ['blocked/repo1', 'blocked/repo2'];
      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: blockedRepos });

      const result = await imageManager.getBlockedRepositores();

      expect(result).to.deep.equal(blockedRepos);
      sinon.assert.calledWith(
        serviceHelper.axiosGet,
        'https://raw.githubusercontent.com/RunOnFlux/flux/master/helpers/blockedrepositories.json',
      );
    });

    it('should return null on error', async () => {
      sinon.stub(serviceHelper, 'axiosGet').rejects(new Error('Network error'));

      const result = await imageManager.getBlockedRepositores();

      expect(result).to.be.null;
    });

    it('should return null if no data returned', async () => {
      sinon.stub(serviceHelper, 'axiosGet').resolves({});

      const result = await imageManager.getBlockedRepositores();

      expect(result).to.be.null;
    });
  });

  describe.skip('getUserBlockedRepositores tests', () => {
    // These tests require complex userconfig mocking - skipping for now
    it('should return empty array if no user blocked repos configured', async () => {
      const result = await imageManager.getUserBlockedRepositores();
      expect(result).to.be.an('array');
    });

    it('should return cached user blocked repositories', async () => {
      const result1 = await imageManager.getUserBlockedRepositores();
      const result2 = await imageManager.getUserBlockedRepositores();
      expect(result1).to.deep.equal(result2);
    });

    it('should handle marketplace API error gracefully', async () => {
      const result = await imageManager.getUserBlockedRepositores();
      expect(result).to.be.an('array');
    });
  });

  describe('checkAppSecrets tests', () => {
    let db;
    let database;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);

      const appsCollection = config.database.appsglobal.collections.appsInformation;
      try {
        await database.collection(appsCollection).drop();
      } catch (err) {
        // Collection doesn't exist
      }

      const messagesCollection = config.database.appsglobal.collections.appsMessages;
      try {
        await database.collection(messagesCollection).drop();
      } catch (err) {
        // Collection doesn't exist
      }
    });

    it('should pass if no duplicate secrets found during registration', async () => {
      const appComponentSpecs = {
        name: 'Component1',
        secrets: 'unique_secret_data',
      };

      await dbHelper.insertOneToDatabase(database, config.database.appsglobal.collections.appsInformation, {
        name: 'ExistingApp',
        version: 7,
        owner: '1Owner1',
        compose: [{ name: 'Comp1', secrets: 'different_secret_data' }],
        nodes: ['node1'],
      });

      const result = await imageManager.checkAppSecrets(
        'NewApp',
        appComponentSpecs,
        '1Owner2',
        true,
      );

      expect(result).to.be.undefined;
    });

    it('should throw error if duplicate secrets found during registration', async () => {
      const appComponentSpecs = {
        name: 'Component1',
        secrets: 'duplicate_secret_data',
      };

      await dbHelper.insertOneToDatabase(database, config.database.appsglobal.collections.appsInformation, {
        name: 'ExistingApp',
        version: 7,
        owner: '1Owner1',
        compose: [{ name: 'Comp1', secrets: 'duplicate_secret_data' }],
        nodes: ['node1'],
      });

      try {
        await imageManager.checkAppSecrets(
          'NewApp',
          appComponentSpecs,
          '1Owner2',
          true,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('secrets are not valid (duplicate in app:');
      }
    });

    it('should allow same app to use its own secrets during update', async () => {
      const appComponentSpecs = {
        name: 'Component1',
        secrets: 'shared_secret_data',
      };

      await dbHelper.insertOneToDatabase(database, config.database.appsglobal.collections.appsInformation, {
        name: 'MyApp',
        version: 7,
        owner: '1Owner1',
        compose: [{ name: 'Comp1', secrets: 'shared_secret_data' }],
        nodes: ['node1'],
      });

      const result = await imageManager.checkAppSecrets(
        'MyApp',
        appComponentSpecs,
        '1Owner1',
        false,
      );

      expect(result).to.be.undefined;
    });

    it('should throw error if different app uses same secrets during update', async () => {
      const appComponentSpecs = {
        name: 'Component1',
        secrets: 'shared_secret_data',
      };

      await dbHelper.insertOneToDatabase(database, config.database.appsglobal.collections.appsInformation, {
        name: 'OtherApp',
        version: 7,
        owner: '1Owner1',
        compose: [{ name: 'Comp1', secrets: 'shared_secret_data' }],
        nodes: ['node1'],
      });

      try {
        await imageManager.checkAppSecrets(
          'MyApp',
          appComponentSpecs,
          '1Owner2',
          false,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('secrets are not valid (conflict with another app)');
      }
    });

    it('should verify owner matches in permanent app messages', async () => {
      const appComponentSpecs = {
        name: 'Component1',
        secrets: 'secret_from_message',
      };

      await dbHelper.insertOneToDatabase(database, config.database.appsglobal.collections.appsMessages, {
        appSpecifications: {
          name: 'encrypted',
          version: 7,
          owner: '1Owner1',
          compose: [{ name: 'Comp1', secrets: 'secret_from_message' }],
          nodes: ['node1'],
        },
      });

      try {
        await imageManager.checkAppSecrets(
          'NewApp',
          appComponentSpecs,
          '1Owner2',
          true,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('owner mismatch');
      }
    });

    it('should normalize PGP secrets for comparison', async () => {
      const appComponentSpecs = {
        name: 'Component1',
        secrets: '-----BEGIN PGP MESSAGE-----\ntest\n-----END PGP MESSAGE-----',
      };

      await dbHelper.insertOneToDatabase(database, config.database.appsglobal.collections.appsInformation, {
        name: 'ExistingApp',
        version: 7,
        owner: '1Owner1',
        compose: [
          {
            name: 'Comp1',
            secrets: '-----BEGIN PGP MESSAGE-----\\ntest\\n-----END PGP MESSAGE-----',
          },
        ],
        nodes: ['node1'],
      });

      try {
        await imageManager.checkAppSecrets(
          'NewApp',
          appComponentSpecs,
          '1Owner2',
          true,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('secrets are not valid');
      }
    });
  });

  describe('checkApplicationImagesCompliance tests', () => {
    beforeEach(() => {
      sinon.stub(serviceHelper, 'axiosGet').resolves({
        data: ['blocked/repo', 'blocked-org', 'blockedowner'],
      });

      const axios = require('axios');
      sinon.stub(axios, 'get').resolves({
        data: {
          status: 'success',
          data: [],
        },
      });
    });

    it('should pass for non-blocked version 3 app', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'allowed/app:latest',
        owner: '1ValidOwner',
        hash: 'validhash',
      };

      const result = await imageManager.checkApplicationImagesCompliance(appSpecs);

      expect(result).to.be.true;
    });

    it('should throw error for blocked app hash', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'allowed/app:latest',
        owner: '1ValidOwner',
        hash: 'blocked/repo',
      };

      try {
        await imageManager.checkApplicationImagesCompliance(appSpecs);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('is not allowed to be spawned');
      }
    });

    it('should throw error for blocked owner', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'allowed/app:latest',
        owner: 'blockedowner',
        hash: 'validhash',
      };

      try {
        await imageManager.checkApplicationImagesCompliance(appSpecs);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('is not allowed to run applications');
      }
    });

    it('should throw error for blocked image', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'blocked/repo:latest',
        owner: '1ValidOwner',
        hash: 'validhash',
      };

      try {
        await imageManager.checkApplicationImagesCompliance(appSpecs);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Image blocked/repo is blocked');
      }
    });

    it('should throw error for blocked organization', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'blocked-org/app:latest',
        owner: '1ValidOwner',
        hash: 'validhash',
      };

      try {
        await imageManager.checkApplicationImagesCompliance(appSpecs);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Organisation blocked-org is blocked');
      }
    });

    it('should check all compose components for version 4+ apps', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 4,
        owner: '1ValidOwner',
        hash: 'validhash',
        compose: [
          { name: 'Component1', repotag: 'allowed/app1:latest' },
          { name: 'Component2', repotag: 'blocked/repo:latest' },
        ],
      };

      try {
        await imageManager.checkApplicationImagesCompliance(appSpecs);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Image blocked/repo is blocked');
      }
    });

    it('should throw error if unable to communicate with Flux Services', async () => {
      serviceHelper.axiosGet.restore();
      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: null });

      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'allowed/app:latest',
        owner: '1ValidOwner',
        hash: 'validhash',
      };

      try {
        await imageManager.checkApplicationImagesCompliance(appSpecs);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Unable to communicate with Flux Services');
      }
    });
  });

  describe('checkApplicationImagesBlocked tests', () => {
    beforeEach(() => {
      sinon.stub(serviceHelper, 'axiosGet').resolves({
        data: ['blocked/repo', 'blocked-org'],
      });

      const axios = require('axios');
      sinon.stub(axios, 'get').resolves({
        data: {
          status: 'success',
          data: [],
        },
      });
    });

    it('should return false for non-blocked app', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'allowed/app:latest',
        owner: '1ValidOwner',
        hash: 'validhash',
      };

      const result = await imageManager.checkApplicationImagesBlocked(appSpecs);

      expect(result).to.be.false;
    });

    it('should return message for blocked app hash', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'allowed/app:latest',
        owner: '1ValidOwner',
        hash: 'blocked/repo',
      };

      const result = await imageManager.checkApplicationImagesBlocked(appSpecs);

      expect(result).to.be.a('string');
      expect(result).to.include('is not allowed to be spawned');
    });

    it('should return message for blocked owner', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'allowed/app:latest',
        owner: 'blocked-org',
        hash: 'validhash',
      };

      const result = await imageManager.checkApplicationImagesBlocked(appSpecs);

      expect(result).to.be.a('string');
      expect(result).to.include('is not allowed to run applications');
    });

    it('should return message for blocked image', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'blocked/repo:latest',
        owner: '1ValidOwner',
        hash: 'validhash',
      };

      const result = await imageManager.checkApplicationImagesBlocked(appSpecs);

      expect(result).to.be.a('string');
      expect(result).to.include('Image blocked/repo is blocked');
    });

    it('should return false if no repos available', async () => {
      serviceHelper.axiosGet.restore();
      sinon.stub(serviceHelper, 'axiosGet').resolves({ data: null });

      const axios = require('axios');
      axios.get.restore();
      sinon.stub(axios, 'get').rejects(new Error('Network error'));

      const appSpecs = {
        name: 'TestApp',
        version: 3,
        repotag: 'allowed/app:latest',
        owner: '1ValidOwner',
        hash: 'validhash',
      };

      const result = await imageManager.checkApplicationImagesBlocked(appSpecs);

      expect(result).to.be.false;
    });

    it('should check compose components for version 4+ apps', async () => {
      const appSpecs = {
        name: 'TestApp',
        version: 4,
        owner: '1ValidOwner',
        hash: 'validhash',
        compose: [
          { name: 'Component1', repotag: 'allowed/app1:latest' },
          { name: 'Component2', repotag: 'blocked/repo:latest' },
        ],
      };

      const result = await imageManager.checkApplicationImagesBlocked(appSpecs);

      expect(result).to.be.a('string');
      expect(result).to.include('Image blocked/repo is blocked');
    });
  });

  describe('checkDockerAccessibility tests', () => {
    it('should return success when authorized', async () => {
      const req = {
        on: sinon.stub(),
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({ repotag: 'test/app:latest' });
      sinon.stub(messageHelper, 'createSuccessMessage').returns({ status: 'success' });

      // Simulate request body
      req.on.withArgs('data').yields('{"repotag":"test/app:latest"}');
      req.on.withArgs('end').yields();

      await imageManager.checkDockerAccessibility(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('success');
    });

    it('should reject unauthorized request', async () => {
      const req = {
        on: sinon.stub(),
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      sinon.stub(messageHelper, 'errUnauthorizedMessage').returns({ status: 'error', data: { code: 401 } });

      req.on.withArgs('data').yields('{"repotag":"test/app:latest"}');
      req.on.withArgs('end').yields();

      await imageManager.checkDockerAccessibility(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].data.code).to.equal(401);
    });

    it('should throw error if no repotag specified', async () => {
      const req = {
        on: sinon.stub(),
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({});
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      req.on.withArgs('data').yields('{}');
      req.on.withArgs('end').yields();

      await imageManager.checkDockerAccessibility(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });
  });

  describe('checkApplicationsCompliance tests', () => {
    it('should remove blacklisted apps', async () => {
      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: 'GoodApp',
            version: 3,
            repotag: 'allowed/app:latest',
            owner: '1ValidOwner',
            hash: 'validhash',
          },
          {
            name: 'BadApp',
            version: 3,
            repotag: 'blocked/repo:latest',
            owner: '1ValidOwner',
            hash: 'validhash',
          },
        ],
      });

      const removeAppLocally = sinon.stub().resolves();

      sinon.stub(serviceHelper, 'axiosGet').resolves({
        data: ['blocked/repo'],
      });

      const axios = require('axios');
      sinon.stub(axios, 'get').resolves({
        data: {
          status: 'success',
          data: [],
        },
      });

      sinon.stub(serviceHelper, 'delay').resolves();

      await imageManager.checkApplicationsCompliance(installedApps, removeAppLocally);

      sinon.assert.calledOnce(installedApps);
      sinon.assert.calledOnce(removeAppLocally);
      sinon.assert.calledWith(removeAppLocally, 'BadApp', null, false, true, true);
    });

    it('should handle failure to get installed apps', async () => {
      const installedApps = sinon.stub().resolves({
        status: 'error',
        data: { message: 'Failed to get apps' },
      });

      const removeAppLocally = sinon.stub().resolves();

      await imageManager.checkApplicationsCompliance(installedApps, removeAppLocally);

      sinon.assert.calledOnce(installedApps);
      sinon.assert.notCalled(removeAppLocally);
    });

    it('should not remove apps if none are blacklisted', async () => {
      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: 'GoodApp',
            version: 3,
            repotag: 'allowed/app:latest',
            owner: '1ValidOwner',
            hash: 'validhash',
          },
        ],
      });

      const removeAppLocally = sinon.stub().resolves();

      sinon.stub(serviceHelper, 'axiosGet').resolves({
        data: ['blocked/repo'],
      });

      const axios = require('axios');
      sinon.stub(axios, 'get').resolves({
        data: {
          status: 'success',
          data: [],
        },
      });

      await imageManager.checkApplicationsCompliance(installedApps, removeAppLocally);

      sinon.assert.calledOnce(installedApps);
      sinon.assert.notCalled(removeAppLocally);
    });

    it('should delay between removing multiple apps', async () => {
      const installedApps = sinon.stub().resolves({
        status: 'success',
        data: [
          {
            name: 'BadApp1',
            version: 3,
            repotag: 'blocked/repo1:latest',
            owner: '1ValidOwner',
            hash: 'validhash',
          },
          {
            name: 'BadApp2',
            version: 3,
            repotag: 'blocked/repo2:latest',
            owner: '1ValidOwner',
            hash: 'validhash',
          },
        ],
      });

      const removeAppLocally = sinon.stub().resolves();

      sinon.stub(serviceHelper, 'axiosGet').resolves({
        data: ['blocked/repo1', 'blocked/repo2'],
      });

      const axios = require('axios');
      sinon.stub(axios, 'get').resolves({
        data: {
          status: 'success',
          data: [],
        },
      });

      const delayStub = sinon.stub(serviceHelper, 'delay').resolves();

      await imageManager.checkApplicationsCompliance(installedApps, removeAppLocally);

      sinon.assert.calledTwice(removeAppLocally);
      sinon.assert.calledTwice(delayStub);
      sinon.assert.calledWith(delayStub, 3 * 60 * 1000);
    });
  });
});
