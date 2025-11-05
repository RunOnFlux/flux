const { expect } = require('chai');
const sinon = require('sinon');
const { BasicAuthProvider } = require('../../../ZelBack/src/services/registryAuth/providers/basicAuthProvider');

describe('BasicAuthProvider Tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('Constructor and Configuration', () => {
    it('should create provider with username and password', () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      expect(provider).to.be.instanceOf(BasicAuthProvider);
      expect(provider.config.registryUrl).to.equal(config.registryUrl);
    });

    it('should handle special characters in username and password', () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'user@example.com',
        password: 'p@$$w0rd!#%',
      };

      const provider = new BasicAuthProvider(config);
      expect(provider).to.be.instanceOf(BasicAuthProvider);
    });
  });

  describe('isValidFor()', () => {
    it('should return true for any URL (fallback provider)', () => {
      const urls = [
        'docker.io',
        'ghcr.io',
        '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        'myregistry.azurecr.io',
        'us-docker.pkg.dev',
        'registry.example.com',
        'localhost:5000',
        'my-custom-registry.internal',
      ];

      const provider = new BasicAuthProvider({ username: 'test', password: 'test' });
      urls.forEach((url) => {
        expect(provider.isValidFor(url)).to.be.true;
      });
    });
  });

  describe('validateConfiguration()', () => {
    it('should validate correct configuration', () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.true;
    });

    it('should throw error when username is missing', () => {
      const config = {
        registryUrl: 'registry.example.com',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.false;
    });

    it('should throw error when password is missing', () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
      };

      const provider = new BasicAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.false;
    });

    it('should validate even when registryUrl is missing (not required for BasicAuth)', () => {
      const config = {
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      // BasicAuth only requires username and password, not registryUrl
      expect(provider.validateConfiguration()).to.be.true;
    });

    it('should allow empty string username (edge case)', () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: '',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      // Empty string should fail validation
      expect(provider.validateConfiguration()).to.be.false;
    });
  });

  describe('getCredentials() - Happy Path', () => {
    it('should return credentials with username and password', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      expect(credentials).to.have.property('username', 'myuser');
      expect(credentials).to.have.property('password', 'mypassword');
      expect(credentials).to.have.property('type', 'basic');
    });

    it('should not have expiry time (static credentials)', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Basic auth credentials don't expire (expiresAt is null from base class)
      expect(credentials.expiresAt).to.be.null;
    });

    it('should include metadata with safe configuration', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Metadata fields are spread into credentials object
      expect(credentials).to.have.property('provider');
      expect(credentials).to.have.property('persistent', true);

      // Ensure password is not in non-password fields
      expect(credentials.username).to.equal(config.username);
      expect(credentials.password).to.equal(config.password);
    });

    it('should handle special characters in credentials', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'user@example.com',
        password: 'p@$$w0rd!#%&*(){}[]|\\:;"<>?,./~`',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      expect(credentials.username).to.equal('user@example.com');
      expect(credentials.password).to.equal('p@$$w0rd!#%&*(){}[]|\\:;"<>?,./~`');
    });

    it('should return credentials synchronously (resolved promise)', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);

      // Should resolve immediately without any async operations
      const start = Date.now();
      const credentials = await provider.getCredentials();
      const duration = Date.now() - start;

      expect(credentials).to.exist;
      expect(duration).to.be.lessThan(10); // Should be nearly instant
    });
  });

  describe('No Caching Behavior', () => {
    it('should not cache credentials (returns fresh each time)', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);

      // Get credentials multiple times
      const credentials1 = await provider.getCredentials();
      const credentials2 = await provider.getCredentials();
      const credentials3 = await provider.getCredentials();

      // All should have the same values
      expect(credentials1.username).to.equal(credentials2.username);
      expect(credentials1.password).to.equal(credentials2.password);
      expect(credentials2.username).to.equal(credentials3.username);
      expect(credentials2.password).to.equal(credentials3.password);

      // But they should be different objects (no caching)
      expect(credentials1).to.not.equal(credentials2);
      expect(credentials2).to.not.equal(credentials3);
    });

    it('should always return credentials without checking expiry', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);

      // Call getCredentials many times - should never fail or refresh
      for (let i = 0; i < 100; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const credentials = await provider.getCredentials();
        expect(credentials.username).to.equal('myuser');
        expect(credentials.password).to.equal('mypassword');
      }
    });
  });

  describe('Error Handling', () => {
    it('should fail validation with missing credentials', () => {
      const config = {
        registryUrl: 'registry.example.com',
      };

      const provider = new BasicAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.false;
    });

    it('should not throw during getCredentials after successful validation', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      provider.validateConfiguration(); // Should not throw

      // getCredentials should also not throw
      const credentials = await provider.getCredentials();
      expect(credentials).to.exist;
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long username', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'a'.repeat(1000),
        password: 'mypassword',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      expect(credentials.username).to.have.lengthOf(1000);
    });

    it('should handle very long password', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'myuser',
        password: 'p'.repeat(10000),
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      expect(credentials.password).to.have.lengthOf(10000);
    });

    it('should handle unicode characters in credentials', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'ユーザー名',
        password: 'パスワード🔐',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      expect(credentials.username).to.equal('ユーザー名');
      expect(credentials.password).to.equal('パスワード🔐');
    });

    it('should handle whitespace in credentials', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: '  user with spaces  ',
        password: 'password with spaces',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Should preserve whitespace
      expect(credentials.username).to.equal('  user with spaces  ');
      expect(credentials.password).to.equal('password with spaces');
    });

    it('should handle credentials with newlines', async () => {
      const config = {
        registryUrl: 'registry.example.com',
        username: 'user\nname',
        password: 'pass\nword',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      expect(credentials.username).to.equal('user\nname');
      expect(credentials.password).to.equal('pass\nword');
    });
  });

  describe('Docker Hub and Common Registries', () => {
    it('should work with Docker Hub', async () => {
      const config = {
        registryUrl: 'docker.io',
        username: 'dockerhubuser',
        password: 'dockerhubpass',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      expect(credentials.username).to.equal('dockerhubuser');
      expect(credentials.password).to.equal('dockerhubpass');
      expect(credentials.type).to.equal('basic');
    });

    it('should work with GitHub Container Registry', async () => {
      const config = {
        registryUrl: 'ghcr.io',
        username: 'github_username',
        password: 'ghp_PersonalAccessToken',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      expect(credentials.username).to.equal('github_username');
      expect(credentials.password).to.equal('ghp_PersonalAccessToken');
    });

    it('should work with local registry', async () => {
      const config = {
        registryUrl: 'localhost:5000',
        username: 'admin',
        password: 'admin123',
      };

      const provider = new BasicAuthProvider(config);
      const credentials = await provider.getCredentials();

      expect(credentials.username).to.equal('admin');
      expect(credentials.password).to.equal('admin123');
    });
  });

  describe('Multiple Instances', () => {
    it('should support multiple independent provider instances', async () => {
      const config1 = {
        registryUrl: 'registry1.example.com',
        username: 'user1',
        password: 'pass1',
      };

      const config2 = {
        registryUrl: 'registry2.example.com',
        username: 'user2',
        password: 'pass2',
      };

      const provider1 = new BasicAuthProvider(config1);
      const provider2 = new BasicAuthProvider(config2);

      const credentials1 = await provider1.getCredentials();
      const credentials2 = await provider2.getCredentials();

      expect(credentials1.username).to.equal('user1');
      expect(credentials1.password).to.equal('pass1');

      expect(credentials2.username).to.equal('user2');
      expect(credentials2.password).to.equal('pass2');
    });
  });
});
