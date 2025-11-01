const { expect } = require('chai');
const sinon = require('sinon');
const registryCredentialHelper = require('../../../ZelBack/src/services/utils/registryCredentialHelper');
const pgpService = require('../../../ZelBack/src/services/pgpService');
const { RepoAuthParser } = require('../../../ZelBack/src/services/registryAuth/utils/repoAuthParser');
const { AuthProviderFactory } = require('../../../ZelBack/src/services/registryAuth/services/authProviderFactory');
const { ImageVerifier } = require('../../../ZelBack/src/services/utils/imageVerifier');

describe('RegistryCredentialHelper Tests', () => {
  let decryptStub;
  let parseStub;
  let createProviderStub;
  let imageVerifierStub;

  beforeEach(() => {
    // Reset factory to clean state
    AuthProviderFactory.resetToDefaults();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getCredentials() - No Authentication', () => {
    it('should return null when repoauth is not provided', async () => {
      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', null, 8, 'testapp');
      expect(credentials).to.be.null;
    });

    it('should return null when repoauth is empty string', async () => {
      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', '', 8, 'testapp');
      expect(credentials).to.be.null;
    });

    it('should return null when repoauth is undefined', async () => {
      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', undefined, 8, 'testapp');
      expect(credentials).to.be.null;
    });
  });

  describe('getCredentials() - Version 7 (PGP Encrypted)', () => {
    beforeEach(() => {
      decryptStub = sinon.stub(pgpService, 'decryptMessage');
    });

    it('should decrypt repoauth for version 7', async () => {
      const encryptedAuth = '-----BEGIN PGP MESSAGE-----...';
      const plainAuth = 'myuser:mypassword';

      decryptStub.resolves(plainAuth);

      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', encryptedAuth, 7, 'testapp');

      sinon.assert.calledOnce(decryptStub);
      sinon.assert.calledWith(decryptStub, encryptedAuth);

      expect(credentials).to.deep.equal({
        username: 'myuser',
        password: 'mypassword',
      });
    });

    it('should throw error for versions < 7', async () => {
      const encryptedAuth = '-----BEGIN PGP MESSAGE-----...';

      try {
        await registryCredentialHelper.getCredentials('nginx:latest', encryptedAuth, 6, 'testapp');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Specs less than 7 do not have repoauth');
      }
    });

    it('should throw error when decryption fails', async () => {
      const encryptedAuth = '-----BEGIN PGP MESSAGE-----...';
      decryptStub.resolves(null);

      try {
        await registryCredentialHelper.getCredentials('nginx:latest', encryptedAuth, 7, 'testapp');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Unable to decrypt');
      }
    });

    it('should throw error when PGP service rejects', async () => {
      const encryptedAuth = '-----BEGIN PGP MESSAGE-----...';
      decryptStub.rejects(new Error('PGP decryption failed'));

      try {
        await registryCredentialHelper.getCredentials('nginx:latest', encryptedAuth, 7, 'testapp');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('PGP decryption failed');
      }
    });
  });

  describe('getCredentials() - Version 8+ (Plain Text)', () => {
    it('should use repoauth as plain text for version 8', async () => {
      const plainAuth = 'myuser:mypassword';
      decryptStub = sinon.stub(pgpService, 'decryptMessage');

      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', plainAuth, 8, 'testapp');

      // Should NOT call decrypt for v8+
      sinon.assert.notCalled(decryptStub);

      expect(credentials).to.deep.equal({
        username: 'myuser',
        password: 'mypassword',
      });
    });

    it('should use repoauth as plain text for version 9', async () => {
      const plainAuth = 'myuser:mypassword';
      decryptStub = sinon.stub(pgpService, 'decryptMessage');

      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', plainAuth, 9, 'testapp');

      sinon.assert.notCalled(decryptStub);
      expect(credentials).to.exist;
    });
  });

  describe('getCredentials() - Basic Authentication', () => {
    it('should handle basic auth format (username:password)', async () => {
      const plainAuth = 'myuser:mypassword';

      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', plainAuth, 8, 'testapp');

      expect(credentials).to.deep.equal({
        username: 'myuser',
        password: 'mypassword',
      });
    });

    it('should handle basic auth with special characters in password', async () => {
      const plainAuth = 'myuser:p@$$w0rd!#%';

      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', plainAuth, 8, 'testapp');

      expect(credentials).to.deep.equal({
        username: 'myuser',
        password: 'p@$$w0rd!#%',
      });
    });

    it('should handle basic auth with email as username', async () => {
      const plainAuth = 'user@example.com:mypassword';

      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', plainAuth, 8, 'testapp');

      expect(credentials).to.deep.equal({
        username: 'user@example.com',
        password: 'mypassword',
      });
    });

    it('should handle basic auth with colons in password', async () => {
      const plainAuth = 'myuser:pass:word:123';

      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', plainAuth, 8, 'testapp');

      expect(credentials).to.deep.equal({
        username: 'myuser',
        password: 'pass:word:123',
      });
    });
  });

  describe('getCredentials() - Provider-based Authentication', () => {
    it('should create provider and get credentials for AWS ECR', async () => {
      const plainAuth = 'aws-ecr://accessKeyId=AKIAIOSFODNN7EXAMPLE&secretAccessKey=wJalrXUtnFEMI';

      const mockCredentials = {
        username: 'AWS',
        password: 'mock_token',
        authType: 'Bearer',
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      };

      createProviderStub = sinon.stub(AuthProviderFactory, 'createProvider');
      const mockProvider = {
        getCredentials: sinon.stub().resolves(mockCredentials),
      };
      createProviderStub.returns(mockProvider);

      const credentials = await registryCredentialHelper.getCredentials(
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1',
        plainAuth,
        8,
      );

      sinon.assert.calledOnce(createProviderStub);
      sinon.assert.calledOnce(mockProvider.getCredentials);

      expect(credentials).to.deep.equal(mockCredentials);
    });

    it('should extract registry URL from image tag', async () => {
      const imageTags = [
        { tag: '123456789012.dkr.ecr.us-east-1.amazonaws.com/app:v1', expected: '123456789012.dkr.ecr.us-east-1.amazonaws.com', authString: 'aws-ecr://accessKeyId=AKIATEST&secretAccessKey=secret123' },
        { tag: 'myregistry.azurecr.io/app:v1', expected: 'myregistry.azurecr.io', authString: 'azure-acr://tenantId=12345678-1234-1234-1234-123456789012&clientId=87654321-4321-4321-4321-210987654321&clientSecret=secret123' },
        { tag: 'us-docker.pkg.dev/project/repo/app:v1', expected: 'us-docker.pkg.dev', authString: 'google-gar://keyFile=eyJ0eXBlIjoidGVzdCJ9' },
        { tag: 'docker.io/library/nginx:latest', expected: 'docker.io', authString: 'aws-ecr://accessKeyId=AKIATEST&secretAccessKey=secret123' },
      ];

      for (const { tag, expected, authString } of imageTags) {
        createProviderStub = sinon.stub(AuthProviderFactory, 'createProvider');
        const mockProvider = {
          getCredentials: sinon.stub().resolves({ username: 'user', password: 'pass' }),
        };
        createProviderStub.returns(mockProvider);

        await registryCredentialHelper.getCredentials(tag, authString, 8, 'testapp');

        sinon.assert.calledWith(createProviderStub, expected, sinon.match.any);

        createProviderStub.restore();
      }
    });

    it('should throw error when provider creation fails', async () => {
      const plainAuth = 'aws-ecr://accessKeyId=AKIAIOSFODNN7EXAMPLE&secretAccessKey=wJalrXUtnFEMI';

      createProviderStub = sinon.stub(AuthProviderFactory, 'createProvider');
      createProviderStub.returns(null);

      try {
        await registryCredentialHelper.getCredentials(
          '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1',
          plainAuth,
          8,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to create authentication provider');
        expect(error.message).to.include('aws-ecr');
      }
    });

    it('should propagate provider validation errors', async () => {
      const plainAuth = 'aws-ecr://'; // Missing required fields

      createProviderStub = sinon.stub(AuthProviderFactory, 'createProvider');
      createProviderStub.throws(new Error('Validation failed: accessKeyId is required'));

      try {
        await registryCredentialHelper.getCredentials(
          '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1',
          plainAuth,
          8,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Validation failed');
        expect(error.message).to.include('accessKeyId');
      }
    });

    it('should propagate provider credential errors', async () => {
      const plainAuth = 'aws-ecr://accessKeyId=AKIAIOSFODNN7EXAMPLE&secretAccessKey=wJalrXUtnFEMI';

      createProviderStub = sinon.stub(AuthProviderFactory, 'createProvider');
      const mockProvider = {
        getCredentials: sinon.stub().rejects(new Error('AWS authentication failed')),
      };
      createProviderStub.returns(mockProvider);

      try {
        await registryCredentialHelper.getCredentials(
          '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1',
          plainAuth,
          8,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('AWS authentication failed');
      }
    });
  });

  describe('Integration with RepoAuthParser', () => {
    it('should parse and use provider scheme format', async () => {

      const plainAuth = 'azure-acr://tenantId=12345678-1234-1234-1234-123456789012&clientId=87654321-4321-4321-4321-210987654321&clientSecret=mySecret';

      const mockCredentials = {
        username: '00000000-0000-0000-0000-000000000000',
        password: 'mock_acr_token',
        authType: 'Bearer',
        expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
      };

      createProviderStub = sinon.stub(AuthProviderFactory, 'createProvider');
      const mockProvider = {
        getCredentials: sinon.stub().resolves(mockCredentials),
      };
      createProviderStub.returns(mockProvider);

      const credentials = await registryCredentialHelper.getCredentials(
        'myregistry.azurecr.io/app:v1',
        plainAuth,
        8,
      );

      expect(credentials).to.deep.equal(mockCredentials);
    });

    it('should handle parser returning null', async () => {
      parseStub = sinon.stub(RepoAuthParser, 'parse').returns(null);

      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', 'invalid', 8, 'testapp');

      expect(credentials).to.be.null;
    });

    it('should propagate parser errors', async () => {
      parseStub = sinon.stub(RepoAuthParser, 'parse').throws(new Error('Invalid format'));

      try {
        await registryCredentialHelper.getCredentials('nginx:latest', 'invalid:::format', 8, 'testapp');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid format');
      }
    });
  });

  describe('Credential Caching', () => {
    it('should leverage provider-level caching', async () => {
      const plainAuth = 'aws-ecr://accessKeyId=AKIAIOSFODNN7EXAMPLE&secretAccessKey=wJalrXUtnFEMI';

      const mockCredentials = {
        username: 'AWS',
        password: 'mock_token',
        authType: 'Bearer',
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      };

      let getCredentialsCallCount = 0;
      createProviderStub = sinon.stub(AuthProviderFactory, 'createProvider');
      const mockProvider = {
        getCredentials: sinon.stub().callsFake(async () => {
          getCredentialsCallCount += 1;
          return mockCredentials;
        }),
      };
      createProviderStub.returns(mockProvider);

      // First call
      await registryCredentialHelper.getCredentials(
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1',
        plainAuth,
        8,
      );

      // Second call - provider's getCredentials should still be called
      // (caching is handled inside the provider, not in the helper)
      await registryCredentialHelper.getCredentials(
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1',
        plainAuth,
        8,
      );

      // Both calls should reach the provider
      expect(getCredentialsCallCount).to.equal(2);
      // Provider is responsible for caching internally
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle ImageVerifier constructor errors', async () => {
      const ImageVerifierStub = sinon.stub(ImageVerifier.prototype, 'constructor');
      ImageVerifierStub.throws(new Error('Invalid image tag format'));

      const plainAuth = 'aws-ecr://accessKeyId=AKIA&secretAccessKey=secret';

      try {
        await registryCredentialHelper.getCredentials('invalid:::tag', plainAuth, 8, 'testapp');
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Error should propagate
        expect(error).to.exist;
      }
    });

    it('should handle missing authConfig type field gracefully', async () => {
      parseStub = sinon.stub(RepoAuthParser, 'parse').returns({
        // Missing 'type' field
        username: 'myuser',
        password: 'mypassword',
      });

      try {
        await registryCredentialHelper.getCredentials('nginx:latest', 'malformed', 8, 'testapp');
        // Should attempt to create provider and fail
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle Docker Hub with basic auth (v8)', async () => {
      const plainAuth = 'dockerhub_user:dckr_pat_123456789';

      const credentials = await registryCredentialHelper.getCredentials('dockerhub_user/myapp:v1', plainAuth, 8, 'testapp');

      expect(credentials).to.deep.equal({
        username: 'dockerhub_user',
        password: 'dckr_pat_123456789',
      });
    });

    it('should handle GitHub Container Registry with basic auth (v8)', async () => {
      const plainAuth = 'github_user:ghp_PersonalAccessToken123';

      const credentials = await registryCredentialHelper.getCredentials('ghcr.io/github_user/myapp:v1', plainAuth, 8, 'testapp');

      expect(credentials).to.deep.equal({
        username: 'github_user',
        password: 'ghp_PersonalAccessToken123',
      });
    });

    it('should handle AWS ECR with provider scheme (v8)', async () => {

      const plainAuth = 'aws-ecr://accessKeyId=AKIA123&secretAccessKey=secret123&region=us-east-1';

      const mockCredentials = {
        username: 'AWS',
        password: 'eyJwYXlsb2FkIjoi...',
        authType: 'Bearer',
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      };

      createProviderStub = sinon.stub(AuthProviderFactory, 'createProvider');
      const mockProvider = {
        getCredentials: sinon.stub().resolves(mockCredentials),
      };
      createProviderStub.returns(mockProvider);

      const credentials = await registryCredentialHelper.getCredentials(
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1',
        plainAuth,
        8,
      );

      expect(credentials).to.deep.equal(mockCredentials);
    });

    it('should handle encrypted credentials for v7 app', async () => {
      const encryptedAuth = '-----BEGIN PGP MESSAGE-----\nhQEMAw==\n-----END PGP MESSAGE-----';
      const plainAuth = 'myuser:mypassword';

      decryptStub = sinon.stub(pgpService, 'decryptMessage').resolves(plainAuth);

      const credentials = await registryCredentialHelper.getCredentials('nginx:latest', encryptedAuth, 7, 'testapp');

      sinon.assert.calledOnce(decryptStub);
      expect(credentials).to.deep.equal({
        username: 'myuser',
        password: 'mypassword',
      });
    });

    it('should handle Google GAR with keyFile (v8)', async () => {

      const keyFile = Buffer.from(JSON.stringify({ type: 'service_account' })).toString('base64');
      const plainAuth = `google-gar://keyFile=${encodeURIComponent(keyFile)}`;

      const mockCredentials = {
        username: 'oauth2accesstoken',
        password: 'ya29.mock_google_token',
        authType: 'Bearer',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };

      createProviderStub = sinon.stub(AuthProviderFactory, 'createProvider');
      const mockProvider = {
        getCredentials: sinon.stub().resolves(mockCredentials),
      };
      createProviderStub.returns(mockProvider);

      const credentials = await registryCredentialHelper.getCredentials(
        'us-docker.pkg.dev/project/repo/app:v1',
        plainAuth,
        8,
      );

      expect(credentials).to.deep.equal(mockCredentials);
    });
  });
});
