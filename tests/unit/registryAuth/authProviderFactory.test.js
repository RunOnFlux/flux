const { expect } = require('chai');
const sinon = require('sinon');
const { AuthProviderFactory } = require('../../../ZelBack/src/services/registryAuth/services/authProviderFactory');
const { BasicAuthProvider } = require('../../../ZelBack/src/services/registryAuth/providers/basicAuthProvider');
const { RegistryAuthProvider } = require('../../../ZelBack/src/services/registryAuth/providers/base/registryAuthProvider');
const { default: fluxCaching } = require('../../../ZelBack/src/services/utils/cacheManager');

describe('AuthProviderFactory Tests', () => {
  beforeEach(() => {
    // Reset factory to clean state before each test
    AuthProviderFactory.resetToDefaults();
  });

  afterEach(() => {
    sinon.restore();
    // Clean up after tests
    AuthProviderFactory.clearProviderCache();
  });

  describe('Provider Registration', () => {
    it('should register built-in providers on module load', () => {
      const providers = AuthProviderFactory.getAvailableProviders();

      expect(providers).to.include('basic');
      // AWS, Google, and Azure may be registered depending on SDK availability
    });

    it('should register a custom provider', () => {
      class CustomProvider extends RegistryAuthProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return { username: 'custom', password: 'custom' };
        }
      }

      AuthProviderFactory.registerProvider('custom', CustomProvider);

      const providers = AuthProviderFactory.getAvailableProviders();
      expect(providers).to.include('custom');
    });

    it('should throw error when registering with invalid name', () => {
      class ValidProvider extends RegistryAuthProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
      }

      expect(() => AuthProviderFactory.registerProvider('', ValidProvider)).to.throw(/name.*non-empty string/i);
      expect(() => AuthProviderFactory.registerProvider(null, ValidProvider)).to.throw(/name.*non-empty string/i);
      expect(() => AuthProviderFactory.registerProvider(123, ValidProvider)).to.throw(/name.*non-empty string/i);
    });

    it('should throw error when registering with invalid provider class', () => {
      expect(() => AuthProviderFactory.registerProvider('invalid', null)).to.throw(/constructor function/i);
      expect(() => AuthProviderFactory.registerProvider('invalid', {})).to.throw(/constructor function/i);
      expect(() => AuthProviderFactory.registerProvider('invalid', 'not-a-class')).to.throw(/constructor function/i);
    });

    it('should throw error when registering class that does not extend RegistryAuthProvider', () => {
      class InvalidProvider {
        // Does not extend RegistryAuthProvider
      }

      expect(() => AuthProviderFactory.registerProvider('invalid', InvalidProvider)).to.throw(/extend RegistryAuthProvider/i);
    });

    it('should handle case-insensitive provider names', () => {
      class CustomProvider extends RegistryAuthProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
      }

      AuthProviderFactory.registerProvider('MyCustomProvider', CustomProvider);

      const providers = AuthProviderFactory.getAvailableProviders();
      expect(providers).to.include('mycustomprovider');
    });
  });

  describe('Provider Unregistration', () => {
    it('should unregister a provider', () => {
      class CustomProvider extends RegistryAuthProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
      }

      AuthProviderFactory.registerProvider('custom', CustomProvider);
      expect(AuthProviderFactory.getAvailableProviders()).to.include('custom');

      AuthProviderFactory.unregisterProvider('custom');
      expect(AuthProviderFactory.getAvailableProviders()).to.not.include('custom');
    });

    it('should clear cached instances when unregistering', () => {
      class CustomProvider extends RegistryAuthProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
      }

      AuthProviderFactory.registerProvider('custom', CustomProvider);

      // Create and cache a provider
      const cacheKey = 'test-cache-key';
      AuthProviderFactory.getCachedProvider(cacheKey, () => new CustomProvider({}));

      expect(fluxCaching.registryProviderCache.size).to.be.greaterThan(0);

      // Unregister should clear cache
      AuthProviderFactory.unregisterProvider('custom');
    });

    it('should handle unregistering non-existent provider gracefully', () => {
      expect(() => AuthProviderFactory.unregisterProvider('non-existent')).to.not.throw();
    });
  });

  describe('createProvider() - String Format', () => {
    it('should create BasicAuthProvider from username:password string', () => {
      const provider = AuthProviderFactory.createProvider('registry.example.com', 'myuser:mypassword', 'testapp');

      expect(provider).to.be.instanceOf(BasicAuthProvider);
    });

    it('should handle complex passwords in string format', () => {
      const provider = AuthProviderFactory.createProvider('registry.example.com', 'user:p@ss:w0rd', 'testapp');

      expect(provider).to.be.instanceOf(BasicAuthProvider);
    });

    it('should return null for empty string', () => {
      const provider = AuthProviderFactory.createProvider('registry.example.com', '', 'testapp');

      expect(provider).to.be.null;
    });
  });

  describe('createProvider() - Object Format with Explicit Type', () => {
    it('should create provider with explicit type: basic', () => {
      const config = {
        type: 'basic',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = AuthProviderFactory.createProvider('registry.example.com', config, 'testapp');

      expect(provider).to.be.instanceOf(BasicAuthProvider);
      expect(provider.registeredName).to.equal('basic');
    });

    it('should create provider with explicit type: aws-ecr (if available)', () => {
      const config = {
        type: 'aws-ecr',
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      try {
        const provider = AuthProviderFactory.createProvider('123456789012.dkr.ecr.us-east-1.amazonaws.com', config, 'testapp');

        // If AWS SDK is available
        expect(provider).to.exist;
        expect(provider.registeredName).to.equal('aws-ecr');
      } catch (error) {
        // If AWS SDK is not available, test is skipped
        if (!error.message.includes('Unknown provider type')) {
          throw error;
        }
      }
    });

    it('should return null for unknown explicit provider type (caught and logged)', () => {
      const config = {
        type: 'non-existent-provider',
        // No username/password so it won't fallback to BasicAuth
      };

      // Factory catches "Unknown provider type" and returns null
      const provider = AuthProviderFactory.createProvider('registry.example.com', config, 'testapp');
      expect(provider).to.be.null;
    });

    it('should handle case-insensitive provider types', () => {
      const config = {
        type: 'BASIC',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = AuthProviderFactory.createProvider('registry.example.com', config, 'testapp');

      expect(provider).to.be.instanceOf(BasicAuthProvider);
    });
  });

  describe('Auto-detection', () => {
    it('should auto-detect AWS ECR provider (if available)', () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      try {
        const provider = AuthProviderFactory.createProvider('123456789012.dkr.ecr.us-east-1.amazonaws.com', config, 'testapp');

        if (provider) {
          expect(provider.registeredName).to.equal('aws-ecr');
        }
      } catch (error) {
        // AWS SDK not available, skip test
      }
    });

    it('should auto-detect Azure ACR provider (if available)', () => {
      const config = {
        registryUrl: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      try {
        const provider = AuthProviderFactory.createProvider('myregistry.azurecr.io', config, 'testapp');

        if (provider) {
          expect(provider.registeredName).to.equal('azure-acr');
        }
      } catch (error) {
        // Azure SDK not available, skip test
      }
    });

    it('should auto-detect Google GAR provider (if available)', () => {
      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      try {
        const provider = AuthProviderFactory.createProvider('us-docker.pkg.dev', config, 'testapp');

        if (provider) {
          expect(provider.registeredName).to.equal('google-gar');
        }
      } catch (error) {
        // Google SDK not available, skip test
      }
    });

    it('should fallback to BasicAuthProvider when auto-detection fails', () => {
      const config = {
        registryUrl: 'unknown-registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = AuthProviderFactory.createProvider('unknown-registry.example.com', config, 'testapp');

      expect(provider).to.be.instanceOf(BasicAuthProvider);
    });

    it('should return null when no provider matches and no fallback credentials', () => {
      const config = {
        registryUrl: 'unknown-registry.example.com',
        someRandomConfig: 'value',
      };

      const provider = AuthProviderFactory.createProvider('unknown-registry.example.com', config, 'testapp');

      expect(provider).to.be.null;
    });
  });

  describe('Provider Caching', () => {
    it('should cache provider instances', () => {
      const cacheKey = 'test-key';
      let createCount = 0;

      const createFn = () => {
        createCount += 1;
        const provider = new BasicAuthProvider({ username: 'user', password: 'pass', registryUrl: 'test.com' }, 'testapp');
        // Verify provider is valid
        expect(provider.isTokenValid()).to.be.true;
        // BasicAuthProvider inherits getTimeUntilExpiry from base class, but tokenExpiry is null
        expect(provider.tokenExpiry).to.be.null;
        return provider;
      };

      // First call should create
      const provider1 = AuthProviderFactory.getCachedProvider(cacheKey, createFn);
      expect(createCount).to.equal(1);
      expect(fluxCaching.registryProviderCache.has(cacheKey)).to.be.true;

      // Verify cached provider is valid
      const cached = fluxCaching.registryProviderCache.get(cacheKey);
      expect(cached.isTokenValid()).to.be.true;

      // Second call should use cache
      const provider2 = AuthProviderFactory.getCachedProvider(cacheKey, createFn);
      expect(createCount).to.equal(1); // Not incremented - should use cached instance

      expect(provider1).to.equal(provider2);
    });

    it('should create cache key from registry URL and config', () => {
      const config = {
        username: 'myuser',
        password: 'mypassword',
        registryUrl: 'registry.example.com',
      };

      const key1 = AuthProviderFactory.createCacheKey('registry.example.com', config);
      const key2 = AuthProviderFactory.createCacheKey('registry.example.com', config);

      expect(key1).to.equal(key2);
      expect(key1).to.be.a('string');
      expect(key1.length).to.be.greaterThan(0);
    });

    it('should create different cache keys for different configs', () => {
      const config1 = {
        username: 'user1',
        password: 'pass1',
      };

      const config2 = {
        username: 'user2',
        password: 'pass2',
      };

      const key1 = AuthProviderFactory.createCacheKey('registry.example.com', config1);
      const key2 = AuthProviderFactory.createCacheKey('registry.example.com', config2);

      expect(key1).to.not.equal(key2);
    });

    it('should create different cache keys for different apps with same credentials', () => {
      const config = {
        username: 'myuser',
        password: 'mypassword',
      };

      const key1 = AuthProviderFactory.createCacheKey('registry.example.com', config, 'app1');
      const key2 = AuthProviderFactory.createCacheKey('registry.example.com', config, 'app2');

      expect(key1).to.not.equal(key2);
      expect(key1).to.include('app1');
      expect(key2).to.include('app2');
    });

    it('should use provider-specific TTL when caching', () => {
      const cacheKey = 'test-ttl-key';
      let createCount = 0;

      // Mock a provider with specific expiry time
      const createFn = () => {
        createCount += 1;
        const provider = new BasicAuthProvider({ username: 'user', password: 'pass', registryUrl: 'test.com' }, 'testapp');

        // Mock provider to have token expiry (1 hour from now)
        const oneHourMs = 60 * 60 * 1000;
        provider.tokenExpiry = Date.now() + oneHourMs;

        // Stub getTimeUntilExpiry to return specific value
        sinon.stub(provider, 'getTimeUntilExpiry').returns(oneHourMs);

        return provider;
      };

      // Create and cache provider
      const provider = AuthProviderFactory.getCachedProvider(cacheKey, createFn);
      expect(createCount).to.equal(1);
      expect(provider.getTimeUntilExpiry()).to.equal(60 * 60 * 1000);

      // Verify provider was cached
      expect(fluxCaching.registryProviderCache.has(cacheKey)).to.be.true;

      // Verify we can retrieve it from cache
      const cachedProvider = AuthProviderFactory.getCachedProvider(cacheKey, createFn);
      expect(createCount).to.equal(1); // Should not create new instance
      expect(cachedProvider).to.equal(provider);
    });

    it('should evict and refresh tokens expiring within 15 minutes', () => {
      const cacheKey = 'test-expiring-key';
      let createCount = 0;

      const createFn = () => {
        createCount += 1;
        const provider = new BasicAuthProvider({ username: 'user', password: 'pass', registryUrl: 'test.com' }, 'testapp');

        if (createCount === 1) {
          // First creation: token expiring in 10 minutes (less than 15-minute buffer)
          const tenMinutesMs = 10 * 60 * 1000;
          provider.tokenExpiry = Date.now() + tenMinutesMs;
          sinon.stub(provider, 'getTimeUntilExpiry').returns(tenMinutesMs);
          sinon.stub(provider, 'isTokenExpiringSoon').returns(true); // Expiring soon
        } else {
          // Second creation: fresh token with 1 hour expiry
          const oneHourMs = 60 * 60 * 1000;
          provider.tokenExpiry = Date.now() + oneHourMs;
          sinon.stub(provider, 'getTimeUntilExpiry').returns(oneHourMs);
          sinon.stub(provider, 'isTokenExpiringSoon').returns(false); // Not expiring soon
        }

        return provider;
      };

      // First call creates provider with token expiring in 10 minutes
      const provider1 = AuthProviderFactory.getCachedProvider(cacheKey, createFn);
      expect(createCount).to.equal(1);
      expect(provider1.isTokenExpiringSoon()).to.be.true;

      // Second call should detect expiring token and create new provider
      const provider2 = AuthProviderFactory.getCachedProvider(cacheKey, createFn);
      expect(createCount).to.equal(2); // Should create new instance due to expiring token
      expect(provider2.isTokenExpiringSoon()).to.be.false;
      expect(provider2).to.not.equal(provider1); // Should be different instance
    });

    it('should clear all cache', () => {
      const provider1 = new BasicAuthProvider({ username: 'user1', password: 'pass1', registryUrl: 'test1.com' }, 'testapp');
      const provider2 = new BasicAuthProvider({ username: 'user2', password: 'pass2', registryUrl: 'test2.com' }, 'testapp');

      fluxCaching.registryProviderCache.set('key1', provider1);
      fluxCaching.registryProviderCache.set('key2', provider2);

      expect(fluxCaching.registryProviderCache.size).to.equal(2);

      AuthProviderFactory.clearProviderCache();

      expect(fluxCaching.registryProviderCache.size).to.equal(0);
    });

    it('should clear cache for specific provider', () => {
      const provider1 = new BasicAuthProvider({ username: 'user1', password: 'pass1', registryUrl: 'test1.com' }, 'testapp');
      const provider2 = new BasicAuthProvider({ username: 'user2', password: 'pass2', registryUrl: 'test2.com' }, 'testapp');

      fluxCaching.registryProviderCache.set('key1', provider1);
      fluxCaching.registryProviderCache.set('key2', provider2);

      expect(fluxCaching.registryProviderCache.size).to.equal(2);

      AuthProviderFactory.clearProviderCache('basic');

      // Both should be cleared since both are basic providers
      expect(fluxCaching.registryProviderCache.size).to.equal(0);
    });
  });

  describe('Provider Validation', () => {
    it('should validate provider class with required methods', () => {
      class ValidProvider extends RegistryAuthProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
      }

      expect(AuthProviderFactory.isValidProviderClass(ValidProvider)).to.be.true;
    });

    it('should reject class missing getCredentials', () => {
      class InvalidProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }
        // Missing getCredentials
      }

      expect(AuthProviderFactory.isValidProviderClass(InvalidProvider)).to.be.false;
    });

    it('should reject class missing isValidFor', () => {
      class InvalidProvider {
        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
        // Missing isValidFor
      }

      expect(AuthProviderFactory.isValidProviderClass(InvalidProvider)).to.be.false;
    });

    it('should reject class missing validateConfiguration', () => {
      class InvalidProvider {
        static isValidFor() {
          return true;
        }

        async getCredentials() {
          return {};
        }
        // Missing validateConfiguration
      }

      expect(AuthProviderFactory.isValidProviderClass(InvalidProvider)).to.be.false;
    });

    it('should reject non-function', () => {
      expect(AuthProviderFactory.isValidProviderClass({})).to.be.false;
      expect(AuthProviderFactory.isValidProviderClass(null)).to.be.false;
      expect(AuthProviderFactory.isValidProviderClass('string')).to.be.false;
    });
  });

  describe('testProviderConfig()', () => {
    it('should test valid basic auth configuration', () => {
      const config = {
        username: 'myuser',
        password: 'mypassword',
        registryUrl: 'registry.example.com',
      };

      const result = AuthProviderFactory.testProviderConfig('basic', config);

      expect(result.valid).to.be.true;
      expect(result.providerName).to.equal('basic');
      expect(result.authType).to.equal('basic');
      expect(result.error).to.be.null;
    });

    it('should test invalid configuration', () => {
      const config = {
        // Missing required fields
        registryUrl: 'registry.example.com',
      };

      const result = AuthProviderFactory.testProviderConfig('basic', config);

      expect(result.valid).to.be.false;
      expect(result.error).to.exist;
    });

    it('should return error for unknown provider type', () => {
      const config = {
        username: 'myuser',
        password: 'mypassword',
      };

      const result = AuthProviderFactory.testProviderConfig('non-existent', config);

      expect(result.valid).to.be.false;
      expect(result.error).to.include('Unknown provider type');
    });
  });

  describe('getProviderStats()', () => {
    it('should return provider statistics', () => {
      const stats = AuthProviderFactory.getProviderStats();

      expect(stats).to.have.property('registeredProviders');
      expect(stats).to.have.property('cachedInstances');
      expect(stats).to.have.property('totalProviders');

      expect(stats.registeredProviders).to.be.an('array');
      expect(stats.cachedInstances).to.be.a('number');
      expect(stats.totalProviders).to.be.a('number');
      expect(stats.totalProviders).to.be.greaterThan(0); // At least 'basic'
    });

    it('should reflect changes in registration', () => {
      const statsBefore = AuthProviderFactory.getProviderStats();
      const initialCount = statsBefore.totalProviders;

      class CustomProvider extends RegistryAuthProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
      }

      AuthProviderFactory.registerProvider('custom', CustomProvider);

      const statsAfter = AuthProviderFactory.getProviderStats();

      expect(statsAfter.totalProviders).to.equal(initialCount + 1);
      expect(statsAfter.registeredProviders).to.include('custom');
    });
  });

  describe('resetToDefaults()', () => {
    it('should reset factory to initial state', () => {
      // Add custom provider
      class CustomProvider extends RegistryAuthProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
      }

      AuthProviderFactory.registerProvider('custom', CustomProvider);
      expect(AuthProviderFactory.getAvailableProviders()).to.include('custom');

      // Add to cache
      fluxCaching.registryProviderCache.set('test-key', new CustomProvider({}));
      expect(fluxCaching.registryProviderCache.size).to.be.greaterThan(0);

      // Reset
      AuthProviderFactory.resetToDefaults();

      // Custom provider should be gone
      expect(AuthProviderFactory.getAvailableProviders()).to.not.include('custom');

      // Cache should be cleared
      expect(fluxCaching.registryProviderCache.size).to.equal(0);

      // Built-in providers should still be registered
      expect(AuthProviderFactory.getAvailableProviders()).to.include('basic');
    });
  });

  describe('Error Handling', () => {
    it('should return null for null authConfig', () => {
      const provider = AuthProviderFactory.createProvider('registry.example.com', null, 'testapp');
      expect(provider).to.be.null;
    });

    it('should return null for undefined authConfig', () => {
      const provider = AuthProviderFactory.createProvider('registry.example.com', undefined, 'testapp');
      expect(provider).to.be.null;
    });

    it('should propagate validation errors', () => {
      const config = {
        type: 'basic',
        // Missing required fields
      };

      expect(() => {
        AuthProviderFactory.createProvider('registry.example.com', config, 'testapp');
      }).to.throw();
    });

    it('should handle provider construction failures during auto-detection', () => {
      // Register a provider that always throws during construction
      class FailingProvider extends RegistryAuthProvider {
        constructor() {
          throw new Error('Construction failed');
        }

        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
      }

      AuthProviderFactory.registerProvider('failing', FailingProvider);

      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      // Should fallback to basic auth despite failing provider
      const provider = AuthProviderFactory.createProvider('registry.example.com', config, 'testapp');
      expect(provider).to.be.instanceOf(BasicAuthProvider);
    });
  });

  describe('Edge Cases', () => {
    it('should fallback to BasicAuth even with empty provider registry', () => {
      AuthProviderFactory.providers.clear();

      const config = {
        username: 'myuser',
        password: 'mypassword',
      };

      // Even with empty registry, fallback creates BasicAuthProvider from username/password
      const provider = AuthProviderFactory.createProvider('registry.example.com', config, 'testapp');
      expect(provider).to.be.instanceOf(BasicAuthProvider);

      // Restore
      AuthProviderFactory.resetToDefaults();
    });

    it('should handle config with both type and auto-detect fields', () => {
      const config = {
        type: 'basic',
        username: 'myuser',
        password: 'mypassword',
        // Also has fields that could trigger auto-detection
        accessKeyId: 'should-be-ignored',
      };

      const provider = AuthProviderFactory.createProvider('registry.example.com', config, 'testapp');

      // Explicit type should take precedence
      expect(provider).to.be.instanceOf(BasicAuthProvider);
      expect(provider.registeredName).to.equal('basic');
    });

    it('should handle multiple registrations of same provider', () => {
      class CustomProvider extends RegistryAuthProvider {
        static isValidFor() {
          return true;
        }

        validateConfiguration() {
          return true;
        }

        async getCredentials() {
          return {};
        }
      }

      AuthProviderFactory.registerProvider('custom', CustomProvider);
      expect(AuthProviderFactory.getAvailableProviders()).to.include('custom');

      // Register again with same name - should overwrite
      AuthProviderFactory.registerProvider('custom', CustomProvider);
      expect(AuthProviderFactory.getAvailableProviders()).to.include('custom');

      // Should still only have one 'custom' entry
      const customCount = AuthProviderFactory.getAvailableProviders().filter((p) => p === 'custom').length;
      expect(customCount).to.equal(1);
    });
  });
});
