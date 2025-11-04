const { expect } = require('chai');
const sinon = require('sinon');
const { ClientSecretCredential } = require('@azure/identity');
const { AzureAcrAuthProvider } = require('../../../ZelBack/src/services/registryAuth/providers/azureAcrAuthProvider');
const azureAcrFixture = require('./integration/fixtures/azure-acr-response.json');

describe('AzureAcrAuthProvider Tests', () => {
  let clock;
  let getTokenStub;
  let fetchStub;

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
    it('should create provider with valid tenantId, clientId, and clientSecret', () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      expect(provider).to.be.instanceOf(AzureAcrAuthProvider);
      expect(provider.config.registry).to.equal(config.registry);
    });

    it('should extract registry name from URL', () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      expect(provider.registryName).to.equal('myregistry');
    });
  });

  describe('isValidFor()', () => {
    it('should return true for valid Azure ACR registry URLs', () => {
      const validUrls = [
        'myregistry.azurecr.io',
        'testregistry.azurecr.io',
        'prod-registry.azurecr.io',
        'registry123.azurecr.io',
      ];

      validUrls.forEach((url) => {
        expect(new AzureAcrAuthProvider({ tenantId: "X", clientId: "Y", clientSecret: "Z", registryName: "test" }).isValidFor(url)).to.be.true;
      });
    });

    it('should return false for non-ACR URLs', () => {
      const invalidUrls = [
        'docker.io',
        'ghcr.io',
        '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        'us-docker.pkg.dev',
        'registry.example.com',
        'azurecr.io', // Missing registry name
      ];

      invalidUrls.forEach((url) => {
        expect(new AzureAcrAuthProvider({ tenantId: "X", clientId: "Y", clientSecret: "Z", registryName: "test" }).isValidFor(url)).to.be.false;
      });
    });
  });

  describe('validateConfiguration()', () => {
    it('should validate correct configuration', () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.true;
    });

    it('should throw error when tenantId is missing', () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      // Constructor throws because initializeClient() requires credentials
      expect(() => new AzureAcrAuthProvider(config)).to.throw(/Service principal credentials/);
    });

    it('should throw error when clientId is missing', () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientSecret: 'myClientSecret123',
      };

      // Constructor throws because initializeClient() requires credentials
      expect(() => new AzureAcrAuthProvider(config)).to.throw(/Service principal credentials/);
    });

    it('should throw error when clientSecret is missing', () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
      };

      // Constructor throws because initializeClient() requires credentials
      expect(() => new AzureAcrAuthProvider(config)).to.throw(/Service principal credentials/);
    });

    it('should validate even when registry is missing (registryName not required for validation)', () => {
      const config = {
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      // Validation only checks credentials, not registryName
      expect(provider.validateConfiguration()).to.be.true;
      expect(provider.registryName).to.be.null;
    });

    it('should validate GUID format for tenantId', () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: 'not-a-valid-guid',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.false;
    });

    it('should validate GUID format for clientId', () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: 'not-a-valid-guid',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.false;
    });
  });

  describe('getCredentials() - Happy Path', () => {
    beforeEach(() => {
      // Mock Azure AD token using fixture
      getTokenStub = sinon.stub(ClientSecretCredential.prototype, 'getToken').resolves(azureAcrFixture.apiResponse);

      // Mock OAuth2 exchange endpoint
      fetchStub = sinon.stub(global, 'fetch');

      // Mock /oauth2/exchange response (ACR refresh token)
      const exchangeResponse = {
        refresh_token: 'acr_refresh_token_mock_XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      };

      // Mock /oauth2/token response (ACR access token)
      const tokenResponse = {
        access_token: 'acr_access_token_mock_YYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        expires_in: 3600, // 1 hour
        token_type: 'bearer',
      };

      // Set up fetch to return different responses based on URL
      fetchStub.callsFake(async (url) => {
        if (url.includes('/oauth2/exchange')) {
          return {
            ok: true,
            status: 200,
            json: async () => exchangeResponse,
          };
        } if (url.includes('/oauth2/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => tokenResponse,
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });
    });

    it('should successfully get credentials from Azure ACR using OAuth2 flow', async () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Verify Azure AD token was requested
      sinon.assert.calledOnce(getTokenStub);
      const tokenRequest = getTokenStub.firstCall.args[0];
      expect(tokenRequest).to.include('https://containerregistry.azure.net/.default');

      // Verify OAuth2 flow: exchange and token calls
      sinon.assert.calledTwice(fetchStub);

      // Verify credentials structure
      expect(credentials).to.have.property('username', '00000000-0000-0000-0000-000000000000');
      expect(credentials).to.have.property('password');
      expect(credentials).to.have.property('type', 'bearer');
      expect(credentials).to.have.property('expiresAt');

      expect(credentials.password).to.equal('acr_access_token_mock_YYYYYYYYYYYYYYYYYYYYYYYYYYYY');
    });

    it('should perform OAuth2 exchange with correct parameters', async () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      await provider.getCredentials();

      // Check /oauth2/exchange call
      const exchangeCall = fetchStub.getCalls().find((call) => call.args[0].includes('/oauth2/exchange'));
      expect(exchangeCall).to.exist;

      const exchangeUrl = exchangeCall.args[0];
      expect(exchangeUrl).to.include('myregistry.azurecr.io');
      expect(exchangeUrl).to.include('/oauth2/exchange');

      const exchangeOptions = exchangeCall.args[1];
      expect(exchangeOptions.method).to.equal('POST');
      expect(exchangeOptions.headers['Content-Type']).to.include('application/x-www-form-urlencoded');

      const exchangeBody = exchangeOptions.body;
      expect(exchangeBody).to.include('grant_type=access_token');
      expect(exchangeBody).to.include('service=myregistry.azurecr.io');
      expect(exchangeBody).to.include('access_token=');
    });

    it('should perform OAuth2 token request with correct parameters', async () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      await provider.getCredentials();

      // Check /oauth2/token call
      const tokenCall = fetchStub.getCalls().find((call) => call.args[0].includes('/oauth2/token'));
      expect(tokenCall).to.exist;

      const tokenUrl = tokenCall.args[0];
      expect(tokenUrl).to.include('myregistry.azurecr.io');
      expect(tokenUrl).to.include('/oauth2/token');

      const tokenOptions = tokenCall.args[1];
      expect(tokenOptions.method).to.equal('POST');
      expect(tokenOptions.headers['Content-Type']).to.include('application/x-www-form-urlencoded');

      const tokenBody = tokenOptions.body;
      expect(tokenBody).to.include('grant_type=refresh_token');
      expect(tokenBody).to.include('service=myregistry.azurecr.io');
      expect(tokenBody).to.include('refresh_token=');
    });

    it('should set correct username (GUID format)', async () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Azure ACR uses a specific GUID as username
      expect(credentials.username).to.equal('00000000-0000-0000-0000-000000000000');
    });

    it('should calculate expiry time from expires_in field', async () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      const beforeTime = Date.now();
      const credentials = await provider.getCredentials();
      const afterTime = Date.now();

      expect(credentials.expiresAt).to.be.a('number');

      // Should be approximately now + 3600 seconds (1 hour)
      const expectedMin = beforeTime + 3600 * 1000;
      const expectedMax = afterTime + 3600 * 1000;
      expect(credentials.expiresAt).to.be.at.least(expectedMin);
      expect(credentials.expiresAt).to.be.at.most(expectedMax);
    });

    it('should include metadata with safe configuration', async () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Metadata fields are spread into the credentials object
      expect(credentials).to.have.property('provider');
      expect(credentials.provider).to.match(/azure|acr/i);
      expect(credentials).to.have.property('tenantId', config.tenantId);
      expect(credentials).to.have.property('clientId', config.clientId);
      expect(credentials).to.have.property('registryName', 'myregistry');

      // Ensure sensitive data is not in credentials
      expect(JSON.stringify(credentials)).to.not.include('myClientSecret123');
    });
  });

  describe('Token Caching', () => {
    beforeEach(() => {
      const azureAdToken = {
        token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6Ik1HTHFqOThWTkxvWGFGZnBKQ0JwZ0I0SmFLcyIsImtpZCI6Ik1HTHFqOThWTkxvWGFGZnBKQ0JwZ0I0SmFLcyJ9...',
        expiresOnTimestamp: Date.now() + 3600 * 1000,
      };
      getTokenStub = sinon.stub(ClientSecretCredential.prototype, 'getToken').resolves(azureAdToken);

      fetchStub = sinon.stub(global, 'fetch');
      fetchStub.callsFake(async (url) => {
        if (url.includes('/oauth2/exchange')) {
          return {
            ok: true,
            json: async () => ({ refresh_token: 'acr_refresh_token_mock' }),
          };
        } if (url.includes('/oauth2/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'acr_access_token_mock',
              expires_in: 3600,
              token_type: 'bearer',
            }),
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });
    });

    it('should cache credentials and not make redundant API calls', async () => {
      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);

      // First call should hit the API
      const credentials1 = await provider.getCredentials();
      sinon.assert.calledOnce(getTokenStub);
      sinon.assert.calledTwice(fetchStub);

      fetchStub.resetHistory();
      getTokenStub.resetHistory();

      // Second call should use cache
      const credentials2 = await provider.getCredentials();
      sinon.assert.notCalled(getTokenStub);
      sinon.assert.notCalled(fetchStub);

      expect(credentials1.password).to.equal(credentials2.password);
    });

    it('should refresh token when within 15-minute refresh window', async () => {
      // Override fetch to return short-lived token
      fetchStub.callsFake(async (url) => {
        if (url.includes('/oauth2/exchange')) {
          return {
            ok: true,
            json: async () => ({ refresh_token: 'acr_refresh_token_mock' }),
          };
        } if (url.includes('/oauth2/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'acr_access_token_mock',
              expires_in: 600, // 10 minutes (within 15-minute window)
              token_type: 'bearer',
            }),
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);

      // First call
      await provider.getCredentials();
      const firstCallCount = fetchStub.callCount;

      // Second call should trigger refresh
      await provider.getCredentials();
      expect(fetchStub.callCount).to.be.greaterThan(firstCallCount);
    });

    it('should refresh token when expired', async () => {
      // Override fetch to return expired token
      let callCount = 0;
      fetchStub.callsFake(async (url) => {
        if (url.includes('/oauth2/exchange')) {
          return {
            ok: true,
            json: async () => ({ refresh_token: 'acr_refresh_token_mock' }),
          };
        } if (url.includes('/oauth2/token')) {
          callCount += 1;
          return {
            ok: true,
            json: async () => ({
              access_token: `acr_access_token_mock_${callCount}`,
              expires_in: callCount === 1 ? -1 : 3600, // First token already expired
              token_type: 'bearer',
            }),
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);

      // First call gets expired token
      await provider.getCredentials();

      fetchStub.resetHistory();

      // Second call should trigger refresh
      await provider.getCredentials();
      sinon.assert.called(fetchStub);
    });
  });

  describe('Error Handling', () => {
    it('should handle Azure AD authentication errors', async () => {
      const azureError = new Error('AADSTS70011: Invalid client secret');
      azureError.name = 'AuthenticationError';
      getTokenStub = sinon.stub(ClientSecretCredential.prototype, 'getToken').rejects(azureError);

      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('AADSTS70011');
        expect(error.message).to.not.include('myClientSecret123'); // No secrets in error
      }
    });

    it('should handle OAuth2 exchange endpoint errors', async () => {
      const azureAdToken = {
        token: 'valid_token',
        expiresOnTimestamp: Date.now() + 3600 * 1000,
      };
      getTokenStub = sinon.stub(ClientSecretCredential.prototype, 'getToken').resolves(azureAdToken);

      fetchStub = sinon.stub(global, 'fetch');
      fetchStub.callsFake(async (url) => {
        if (url.includes('/oauth2/exchange')) {
          return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            json: async () => ({ error: 'invalid_grant' }),
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/exchange|401|unauthorized/i);
      }
    });

    it('should handle OAuth2 token endpoint errors', async () => {
      const azureAdToken = {
        token: 'valid_token',
        expiresOnTimestamp: Date.now() + 3600 * 1000,
      };
      getTokenStub = sinon.stub(ClientSecretCredential.prototype, 'getToken').resolves(azureAdToken);

      fetchStub = sinon.stub(global, 'fetch');
      fetchStub.callsFake(async (url) => {
        if (url.includes('/oauth2/exchange')) {
          return {
            ok: true,
            json: async () => ({ refresh_token: 'acr_refresh_token_mock' }),
          };
        } if (url.includes('/oauth2/token')) {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            json: async () => ({ error: 'invalid_token' }),
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/token|400|bad request/i);
      }
    });

    it('should handle network errors', async () => {
      const azureAdToken = {
        token: 'valid_token',
        expiresOnTimestamp: Date.now() + 3600 * 1000,
      };
      getTokenStub = sinon.stub(ClientSecretCredential.prototype, 'getToken').resolves(azureAdToken);

      fetchStub = sinon.stub(global, 'fetch');
      fetchStub.rejects(new Error('Network timeout'));

      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Network timeout');
      }
    });

    it('should handle malformed exchange response - missing refresh_token', async () => {
      const azureAdToken = {
        token: 'valid_token',
        expiresOnTimestamp: Date.now() + 3600 * 1000,
      };
      getTokenStub = sinon.stub(ClientSecretCredential.prototype, 'getToken').resolves(azureAdToken);

      fetchStub = sinon.stub(global, 'fetch');
      fetchStub.callsFake(async (url) => {
        if (url.includes('/oauth2/exchange')) {
          return {
            ok: true,
            json: async () => ({}), // Missing refresh_token
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/refresh.*token/i);
      }
    });

    it('should handle malformed token response - missing access_token', async () => {
      const azureAdToken = {
        token: 'valid_token',
        expiresOnTimestamp: Date.now() + 3600 * 1000,
      };
      getTokenStub = sinon.stub(ClientSecretCredential.prototype, 'getToken').resolves(azureAdToken);

      fetchStub = sinon.stub(global, 'fetch');
      fetchStub.callsFake(async (url) => {
        if (url.includes('/oauth2/exchange')) {
          return {
            ok: true,
            json: async () => ({ refresh_token: 'acr_refresh_token_mock' }),
          };
        } if (url.includes('/oauth2/token')) {
          return {
            ok: true,
            json: async () => ({
              // Missing access_token
              expires_in: 3600,
              token_type: 'bearer',
            }),
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      const config = {
        registry: 'myregistry.azurecr.io',
        tenantId: '12345678-1234-1234-1234-123456789012',
        clientId: '87654321-4321-4321-4321-210987654321',
        clientSecret: 'myClientSecret123',
      };

      const provider = new AzureAcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/access.*token/i);
      }
    });
  });

  describe('Registry Name Extraction', () => {
    it('should extract registry name from various ACR URL formats', () => {
      const testCases = [
        { url: 'myregistry.azurecr.io', expected: 'myregistry' },
        { url: 'test-registry.azurecr.io', expected: 'test-registry' },
        { url: 'prod123.azurecr.io', expected: 'prod123' },
      ];

      testCases.forEach(({ url, expected }) => {
        const config = {
          registry: url,
          tenantId: '12345678-1234-1234-1234-123456789012',
          clientId: '87654321-4321-4321-4321-210987654321',
          clientSecret: 'myClientSecret123',
        };

        const provider = new AzureAcrAuthProvider(config);
        expect(provider.registryName).to.equal(expected);
      });
    });
  });
});
