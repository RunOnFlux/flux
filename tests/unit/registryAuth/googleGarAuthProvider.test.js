const { expect } = require('chai');
const sinon = require('sinon');
const { JWT } = require('google-auth-library');
const { GoogleGarAuthProvider } = require('../../../ZelBack/src/services/registryAuth/providers/googleGarAuthProvider');

const googleGarFixture = require('./integration/fixtures/google-gar-response.json');

describe('GoogleGarAuthProvider Tests', () => {
  let clock;
  let getAccessTokenStub;

  beforeEach(() => {
    clock = sinon.useFakeTimers(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    sinon.restore();
    if (clock) {
      clock.restore();
    }
  });

  describe('Constructor and Configuration', () => {
    

it('should create provider with keyFile (base64-encoded)', () => {
      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key_id: 'key123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
        client_id: '123456789',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);
      expect(provider).to.be.instanceOf(GoogleGarAuthProvider);
      expect(provider.config.registryUrl).to.equal(config.registryUrl);
    });

    it('should create provider with privateKey and clientEmail', () => {
      const config = {
        registryUrl: 'us-docker.pkg.dev',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
        clientEmail: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const provider = new GoogleGarAuthProvider(config);
      expect(provider).to.be.instanceOf(GoogleGarAuthProvider);
    });

    it('should parse base64-encoded keyFile', () => {
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

      const provider = new GoogleGarAuthProvider(config);
      // Provider should have parsed the keyFile
      expect(provider.config.clientEmail).to.equal(keyFileContent.client_email);
      expect(provider.config.privateKey).to.equal(keyFileContent.private_key);
    });

    it('should throw error for plain JSON keyFile (must be base64-encoded)', () => {
      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: JSON.stringify(keyFileContent), // Plain JSON, not base64
      };

      // Constructor throws because keyFile must be base64-encoded
      expect(() => new GoogleGarAuthProvider(config)).to.throw(/parse|JSON/);
    });
  });

  describe('isValidFor()', () => {
    it('should return true for valid Google Artifact Registry URLs', () => {
      const validUrls = [
        'us-docker.pkg.dev',
        'europe-docker.pkg.dev',
        'asia-docker.pkg.dev',
        'us-central1-docker.pkg.dev',
        'europe-west1-docker.pkg.dev',
      ];

      validUrls.forEach((url) => {
        expect(new GoogleGarAuthProvider({ privateKey: "X", clientEmail: "Y" }).isValidFor(url)).to.be.true;
      });
    });

    it('should return false for non-GAR URLs', () => {
      const invalidUrls = [
        'docker.io',
        'ghcr.io',
        '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        'myregistry.azurecr.io',
        'registry.example.com',
        'gcr.io', // Old GCR, not GAR
      ];

      invalidUrls.forEach((url) => {
        expect(new GoogleGarAuthProvider({ privateKey: "X", clientEmail: "Y" }).isValidFor(url)).to.be.false;
      });
    });
  });

  describe('validateConfiguration()', () => {
    it('should validate configuration with keyFile', () => {
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

      const provider = new GoogleGarAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.true;
    });

    it('should validate configuration with privateKey and clientEmail', () => {
      const config = {
        registryUrl: 'us-docker.pkg.dev',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
        clientEmail: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const provider = new GoogleGarAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.true;
    });

    it('should throw error when keyFile is missing and no privateKey/clientEmail', () => {
      const config = {
        registryUrl: 'us-docker.pkg.dev',
      };

      // Constructor throws because initializeClient() requires credentials
      expect(() => new GoogleGarAuthProvider(config)).to.throw(/Service account credentials|keyFile|private_key/);
    });

    it('should throw error when privateKey is provided without clientEmail', () => {
      const config = {
        registryUrl: 'us-docker.pkg.dev',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
      };

      // Constructor throws because initializeClient() requires complete credentials
      expect(() => new GoogleGarAuthProvider(config)).to.throw(/Service account credentials|private_key|client_email/);
    });

    it('should throw error when clientEmail is provided without privateKey', () => {
      const config = {
        registryUrl: 'us-docker.pkg.dev',
        clientEmail: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      // Constructor throws because initializeClient() requires complete credentials
      expect(() => new GoogleGarAuthProvider(config)).to.throw(/Service account credentials|private_key|client_email/);
    });

    it('should validate even when registryUrl is missing (not required for validation)', () => {
      const config = {
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
        clientEmail: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const provider = new GoogleGarAuthProvider(config);
      // Validation only checks credentials, not registryUrl
      expect(provider.validateConfiguration()).to.be.true;
    });

    it('should throw error for malformed keyFile', () => {
      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: 'not-valid-json-or-base64',
      };

      // Constructor throws because initializeClient() can't parse keyFile
      expect(() => new GoogleGarAuthProvider(config)).to.throw(/parse|JSON|keyFile/);
    });

    it('should throw error for keyFile missing required fields', () => {
      const keyFileContent = {
        type: 'service_account',
        // Missing private_key and client_email
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      // Constructor throws because keyFile is missing required fields
      expect(() => new GoogleGarAuthProvider(config)).to.throw(/private_key|client_email/);
    });
  });

  describe('getCredentials() - Happy Path', () => {
    beforeEach(() => {
      // Stub JWT.getAccessToken to return fixture data and set credentials as side effect
      getAccessTokenStub = sinon.stub(JWT.prototype, 'getAccessToken').callsFake(function() {
        // Set credentials on the JWT instance (side effect of real getAccessToken)
        this.credentials = googleGarFixture.apiResponse.credentials;
        return Promise.resolve(googleGarFixture.apiResponse);
      });
    });

    it('should successfully get credentials from Google GAR', async () => {
      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Verify getAccessToken was called
      sinon.assert.calledOnce(getAccessTokenStub);

      // Verify credentials structure
      expect(credentials).to.have.property('username', 'oauth2accesstoken');
      expect(credentials).to.have.property('password');
      expect(credentials).to.have.property('type', 'bearer');
      expect(credentials).to.have.property('expiresAt');

      // Password should be the access token
      expect(credentials.password).to.equal(googleGarFixture.apiResponse.token);
    });

    it('should use oauth2accesstoken as username', async () => {
      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Google uses a special username for OAuth2 tokens
      expect(credentials.username).to.equal('oauth2accesstoken');
    });

    it('should set expiry time from credentials.expiry_date', async () => {
      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);
      const credentials = await provider.getCredentials();

      const expectedExpiry = googleGarFixture.apiResponse.credentials.expiry_date;
      expect(credentials.expiresAt).to.be.a('number');
      expect(credentials.expiresAt).to.equal(expectedExpiry);
    });

    it('should include metadata with safe configuration', async () => {
      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Metadata fields are spread into credentials object
      expect(credentials).to.have.property('provider');
      expect(credentials.provider).to.match(/google|gar/i);
      expect(credentials).to.have.property('clientEmail');

      // Ensure sensitive data is not leaked
      expect(JSON.stringify(credentials)).to.not.include('BEGIN PRIVATE KEY');
    });

    it('should work with privateKey and clientEmail directly', async () => {
      const config = {
        registryUrl: 'us-docker.pkg.dev',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        clientEmail: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const provider = new GoogleGarAuthProvider(config);
      const credentials = await provider.getCredentials();

      sinon.assert.calledOnce(getAccessTokenStub);
      expect(credentials.username).to.equal('oauth2accesstoken');
      expect(credentials.password).to.equal(googleGarFixture.apiResponse.token);
    });
  });

  describe('Token Caching', () => {
    beforeEach(() => {
      // Stub with callsFake to set credentials as side effect
      getAccessTokenStub = sinon.stub(JWT.prototype, 'getAccessToken').callsFake(function() {
        this.credentials = googleGarFixture.apiResponse.credentials;
        return Promise.resolve(googleGarFixture.apiResponse);
      });
    });

    it('should cache credentials and not make redundant API calls', async () => {
      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);

      // First call should hit the API
      const credentials1 = await provider.getCredentials();
      sinon.assert.calledOnce(getAccessTokenStub);

      // Second call should use cache
      const credentials2 = await provider.getCredentials();
      sinon.assert.calledOnce(getAccessTokenStub); // Still only one API call

      expect(credentials1.password).to.equal(credentials2.password);
    });

    it('should refresh token when within 15-minute refresh window', async () => {
      // Set up response with token expiring soon
      const soonExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes from now
      const modifiedResponse = {
        ...googleGarFixture.apiResponse,
        credentials: {
          ...googleGarFixture.apiResponse.credentials,
          expiry_date: soonExpiry,
        },
      };
      getAccessTokenStub.callsFake(function() {
        this.credentials = modifiedResponse.credentials;
        return Promise.resolve(modifiedResponse);
      });

      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);

      // First call
      await provider.getCredentials();
      sinon.assert.calledOnce(getAccessTokenStub);

      // Second call should trigger refresh
      await provider.getCredentials();
      sinon.assert.calledTwice(getAccessTokenStub);
    });

    it('should refresh token when expired', async () => {
      // Set up response with expired token
      const pastExpiry = Date.now() - 1000; // 1 second ago
      const modifiedResponse = {
        ...googleGarFixture.apiResponse,
        credentials: {
          ...googleGarFixture.apiResponse.credentials,
          expiry_date: pastExpiry,
        },
      };
      getAccessTokenStub.callsFake(function() {
        this.credentials = modifiedResponse.credentials;
        return Promise.resolve(modifiedResponse);
      });

      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);

      // First call
      await provider.getCredentials();
      sinon.assert.calledOnce(getAccessTokenStub);

      // Second call should trigger refresh
      await provider.getCredentials();
      sinon.assert.calledTwice(getAccessTokenStub);
    });

    it('should not refresh if token is still valid and outside refresh window', async () => {
      // Set up response with token expiring in 2 hours
      const futureExpiry = Date.now() + 2 * 60 * 60 * 1000;
      const modifiedResponse = {
        ...googleGarFixture.apiResponse,
        credentials: {
          ...googleGarFixture.apiResponse.credentials,
          expiry_date: futureExpiry,
        },
      };
      getAccessTokenStub.callsFake(function() {
        this.credentials = modifiedResponse.credentials;
        return Promise.resolve(modifiedResponse);
      });

      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);

      // First call
      await provider.getCredentials();
      sinon.assert.calledOnce(getAccessTokenStub);

      // Advance time by 1 hour (still outside 15-minute window)
      clock.tick(60 * 60 * 1000);

      // Second call should use cache
      await provider.getCredentials();
      sinon.assert.calledOnce(getAccessTokenStub);
    });
  });

  describe('Error Handling', () => {
    it('should handle JWT authentication errors', async () => {
      const jwtError = new Error('Invalid private key format');
      jwtError.name = 'JWTError';
      getAccessTokenStub = sinon.stub(JWT.prototype, 'getAccessToken').rejects(jwtError);

      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nINVALID\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid private key format');
        expect(error.message).to.not.include('BEGIN PRIVATE KEY'); // No secrets in error
      }
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      networkError.code = 'ETIMEDOUT';
      getAccessTokenStub = sinon.stub(JWT.prototype, 'getAccessToken').rejects(networkError);

      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Network timeout');
      }
    });

    it('should handle malformed API response - missing token', async () => {
      getAccessTokenStub = sinon.stub(JWT.prototype, 'getAccessToken').resolves({
        credentials: {
          // Missing token
          expiry_date: Date.now() + 3600 * 1000,
        },
      });

      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/token/i);
      }
    });

    it('should handle malformed API response - missing credentials', async () => {
      getAccessTokenStub = sinon.stub(JWT.prototype, 'getAccessToken').callsFake(function() {
        // Explicitly unset credentials to simulate missing credentials
        this.credentials = undefined;
        return Promise.resolve({
          token: 'some_token',
        });
      });

      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/credentials|expiry/i);
      }
    });

    it('should handle missing expiry_date in response', async () => {
      getAccessTokenStub = sinon.stub(JWT.prototype, 'getAccessToken').callsFake(function() {
        // Set credentials but without expiry_date
        this.credentials = {
          access_token: 'some_token',
          // Missing expiry_date
        };
        return Promise.resolve({
          token: 'some_token',
        });
      });

      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: Buffer.from(JSON.stringify(keyFileContent)).toString('base64'),
      };

      const provider = new GoogleGarAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/expir/i);
      }
    });
  });

  describe('KeyFile Parsing', () => {
    it('should parse base64-encoded keyFile', () => {
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

      const provider = new GoogleGarAuthProvider(config);
      expect(provider.config.clientEmail).to.equal(keyFileContent.client_email);
      expect(provider.config.privateKey).to.equal(keyFileContent.private_key);
    });

    it('should throw error for plain JSON keyFile (must be base64)', () => {
      const keyFileContent = {
        type: 'service_account',
        project_id: 'my-project-123',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
        client_email: 'service-account@my-project-123.iam.gserviceaccount.com',
      };

      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: JSON.stringify(keyFileContent), // Plain JSON, not base64
      };

      // Constructor throws because keyFile must be base64-encoded
      expect(() => new GoogleGarAuthProvider(config)).to.throw(/parse|JSON/);
    });

    it('should throw error for invalid keyFile', () => {
      const config = {
        registryUrl: 'us-docker.pkg.dev',
        keyFile: 'invalid-json-{{{',
      };

      // Constructor throws because keyFile is invalid
      expect(() => new GoogleGarAuthProvider(config)).to.throw(/parse|JSON/);
    });
  });
});
