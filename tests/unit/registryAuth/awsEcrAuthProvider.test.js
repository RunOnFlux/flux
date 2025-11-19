const { expect } = require('chai');
const sinon = require('sinon');
// eslint-disable-next-line import/no-unresolved
const { ECRClient, GetAuthorizationTokenCommand } = require('@aws-sdk/client-ecr');
const { AwsEcrAuthProvider } = require('../../../ZelBack/src/services/registryAuth/providers/awsEcrAuthProvider');

const awsEcrFixture = require('./integration/fixtures/aws-ecr-response.json');

describe('AwsEcrAuthProvider Tests', () => {
  let clock;
  let sendStub;

  beforeEach(() => {
    // Use fake timers to control time-based behavior
    clock = sinon.useFakeTimers(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    sinon.restore();
    if (clock) {
      clock.restore();
    }
  });

  describe('Constructor and Configuration', () => {
    it('should create provider with valid accessKeyId and secretAccessKey', () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);
      expect(provider).to.be.instanceOf(AwsEcrAuthProvider);
      expect(provider.config.registryUrl).to.equal(config.registryUrl);
    });

    it('should create provider with sessionToken', () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        sessionToken: 'FwoGZXIvYXdzEBEaD...',
      };

      const provider = new AwsEcrAuthProvider(config);
      expect(provider).to.be.instanceOf(AwsEcrAuthProvider);
    });

    it('should extract region from registry URL', () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.eu-west-2.amazonaws.com',
        region: 'eu-west-2',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);
      // Region should be extracted from URL
      expect(provider.ecrRegion).to.equal('eu-west-2');
    });

    it('should return undefined region if cannot be extracted and not provided', () => {
      const config = {
        registryUrl: 'invalid-url.com',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);
      expect(provider.ecrRegion).to.be.undefined;
    });
  });

  describe('isValidFor()', () => {
    it('should return true for valid ECR registry URLs', () => {
      const validUrls = [
        '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        '123456789012.dkr.ecr.eu-west-2.amazonaws.com',
        '123456789012.dkr.ecr.ap-southeast-1.amazonaws.com',
        '999999999999.dkr.ecr.us-west-2.amazonaws.com',
      ];

      validUrls.forEach((url) => {
        expect(new AwsEcrAuthProvider({ region: 'us-east-1', accessKeyId: 'X', secretAccessKey: 'Y' }).isValidFor(url)).to.be.true;
      });
    });

    it('should return false for non-ECR URLs', () => {
      const invalidUrls = [
        'docker.io',
        'ghcr.io',
        'myregistry.azurecr.io',
        'us-docker.pkg.dev',
        'registry.example.com',
        '123456789012.dkr.ec2.us-east-1.amazonaws.com', // ec2 not ecr
      ];

      invalidUrls.forEach((url) => {
        expect(new AwsEcrAuthProvider({ region: 'us-east-1', accessKeyId: 'X', secretAccessKey: 'Y' }).isValidFor(url)).to.be.false;
      });
    });
  });

  describe('validateConfiguration()', () => {
    it('should validate correct configuration', () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.true;
    });

    it('should throw error when accessKeyId is missing', () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.false;
    });

    it('should throw error when secretAccessKey is missing', () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      };

      const provider = new AwsEcrAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.false;
    });

    it('should throw error when registryUrl is missing', () => {
      const config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);
      expect(provider.validateConfiguration()).to.be.false;
    });
  });

  describe('getCredentials() - Happy Path', () => {
    beforeEach(() => {
      // Stub the ECRClient send method to return fixture data
      // AWS SDK returns expiresAt as a Date object, not a string
      const fixtureWithDateObjects = {
        ...awsEcrFixture.apiResponse,
        authorizationData: awsEcrFixture.apiResponse.authorizationData.map((authData) => ({
          ...authData,
          expiresAt: new Date(authData.expiresAt),
        })),
      };
      sendStub = sinon.stub(ECRClient.prototype, 'send').resolves(fixtureWithDateObjects);
    });

    it('should successfully get credentials from AWS ECR', async () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Verify the send method was called with GetAuthorizationTokenCommand
      sinon.assert.calledOnce(sendStub);
      const command = sendStub.firstCall.args[0];
      expect(command).to.be.instanceOf(GetAuthorizationTokenCommand);

      // Verify credentials structure
      expect(credentials).to.have.property('username');
      expect(credentials).to.have.property('password');
      expect(credentials).to.have.property('type', 'bearer');
      expect(credentials).to.have.property('expiresAt');

      // AWS ECR token format is base64("AWS:password")
      expect(credentials.username).to.equal('AWS');
      expect(credentials.password).to.be.a('string');
      expect(credentials.password.length).to.be.greaterThan(0);
    });

    it('should parse base64 authorization token correctly', async () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Decode the token from fixture to verify parsing
      const fixtureToken = awsEcrFixture.apiResponse.authorizationData[0].authorizationToken;
      const decoded = Buffer.from(fixtureToken, 'base64').toString('utf-8');
      const [username, password] = decoded.split(':');

      expect(credentials.username).to.equal(username);
      expect(credentials.password).to.equal(password);
    });

    it('should set expiry time from API response', async () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);
      const credentials = await provider.getCredentials();

      const expectedExpiry = new Date(awsEcrFixture.apiResponse.authorizationData[0].expiresAt);
      expect(credentials.expiresAt).to.be.a('number');
      expect(credentials.expiresAt).to.equal(expectedExpiry.getTime());
    });

    it('should include metadata fields from AWS response', async () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        sessionToken: 'FwoGZXIvYXdzEBEaD...',
      };

      const provider = new AwsEcrAuthProvider(config);
      const credentials = await provider.getCredentials();

      // Metadata fields are spread into the credentials object
      expect(credentials).to.have.property('provider');
      expect(credentials.provider).to.match(/ecr|aws/i);
      expect(credentials).to.have.property('proxyEndpoint');
      expect(credentials).to.have.property('region', 'us-east-1');

      // Ensure sensitive data is not in credentials
      expect(JSON.stringify(credentials)).to.not.include('wJalrXUtnFEMI');
      expect(JSON.stringify(credentials)).to.not.include('FwoGZXIvYXdzEBEaD');
    });
  });

  describe('Token Caching', () => {
    beforeEach(() => {
      // AWS SDK returns expiresAt as a Date object
      const fixtureWithDateObjects = {
        ...awsEcrFixture.apiResponse,
        authorizationData: awsEcrFixture.apiResponse.authorizationData.map((authData) => ({
          ...authData,
          expiresAt: new Date(authData.expiresAt),
        })),
      };
      sendStub = sinon.stub(ECRClient.prototype, 'send').resolves(fixtureWithDateObjects);
    });

    it('should cache credentials and not make redundant API calls', async () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);

      // First call should hit the API
      const credentials1 = await provider.getCredentials();
      sinon.assert.calledOnce(sendStub);

      // Second call should use cache
      const credentials2 = await provider.getCredentials();
      sinon.assert.calledOnce(sendStub); // Still only one API call

      // Credentials should be the same
      expect(credentials1.password).to.equal(credentials2.password);
      expect(credentials1.expiresAt).to.equal(credentials2.expiresAt);
    });

    it('should refresh token when within 15-minute refresh window', async () => {
      // Set up fixture with token expiring soon
      const soonExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
      const modifiedResponse = {
        ...awsEcrFixture.apiResponse,
        authorizationData: [{
          ...awsEcrFixture.apiResponse.authorizationData[0],
          expiresAt: soonExpiry, // AWS SDK returns Date object, not string
        }],
      };
      sendStub.resolves(modifiedResponse);

      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);

      // First call
      await provider.getCredentials();
      sinon.assert.calledOnce(sendStub);

      // Second call should trigger refresh because we're within 15-minute window
      await provider.getCredentials();
      sinon.assert.calledTwice(sendStub);
    });

    it('should refresh token when expired', async () => {
      // Set up fixture with expired token
      const pastExpiry = new Date(Date.now() - 1000); // 1 second ago
      const modifiedResponse = {
        ...awsEcrFixture.apiResponse,
        authorizationData: [{
          ...awsEcrFixture.apiResponse.authorizationData[0],
          expiresAt: pastExpiry, // AWS SDK returns Date object, not string
        }],
      };
      sendStub.resolves(modifiedResponse);

      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);

      // First call
      await provider.getCredentials();
      sinon.assert.calledOnce(sendStub);

      // Second call should trigger refresh because token is expired
      await provider.getCredentials();
      sinon.assert.calledTwice(sendStub);
    });

    it('should not refresh if token is still valid and outside refresh window', async () => {
      // Set up fixture with token expiring in 2 hours
      const futureExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const modifiedResponse = {
        ...awsEcrFixture.apiResponse,
        authorizationData: [{
          ...awsEcrFixture.apiResponse.authorizationData[0],
          expiresAt: futureExpiry, // AWS SDK returns Date object, not string
        }],
      };
      sendStub.resolves(modifiedResponse);

      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);

      // First call
      await provider.getCredentials();
      sinon.assert.calledOnce(sendStub);

      // Advance time by 1 hour (still outside 15-minute window)
      clock.tick(60 * 60 * 1000);

      // Second call should use cache
      await provider.getCredentials();
      sinon.assert.calledOnce(sendStub);
    });
  });

  describe('Error Handling', () => {
    it('should handle AWS SDK errors gracefully', async () => {
      const awsError = new Error('UnrecognizedClientException: The security token included in the request is invalid');
      awsError.name = 'UnrecognizedClientException';
      sendStub = sinon.stub(ECRClient.prototype, 'send').rejects(awsError);

      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('UnrecognizedClientException');
        expect(error.message).to.not.include('wJalrXUtnFEMI'); // No secrets in error
      }
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      networkError.code = 'ETIMEDOUT';
      sendStub = sinon.stub(ECRClient.prototype, 'send').rejects(networkError);

      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Network timeout');
      }
    });

    it('should handle malformed API response - missing authorizationData', async () => {
      sendStub = sinon.stub(ECRClient.prototype, 'send').resolves({
        $metadata: { httpStatusCode: 200 },
        // Missing authorizationData
      });

      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/authorization.*data/i);
      }
    });

    it('should handle malformed API response - invalid base64 token', async () => {
      sendStub = sinon.stub(ECRClient.prototype, 'send').resolves({
        $metadata: { httpStatusCode: 200 },
        authorizationData: [{
          authorizationToken: 'not-valid-base64!!!',
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          proxyEndpoint: 'https://123456789012.dkr.ecr.us-east-1.amazonaws.com',
        }],
      });

      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/token|parse|decode/i);
      }
    });

    it('should handle missing expiresAt in response', async () => {
      sendStub = sinon.stub(ECRClient.prototype, 'send').resolves({
        $metadata: { httpStatusCode: 200 },
        authorizationData: [{
          authorizationToken: awsEcrFixture.apiResponse.authorizationData[0].authorizationToken,
          // Missing expiresAt
          proxyEndpoint: 'https://123456789012.dkr.ecr.us-east-1.amazonaws.com',
        }],
      });

      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const provider = new AwsEcrAuthProvider(config);

      try {
        await provider.getCredentials();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.match(/expir/i);
      }
    });
  });

  describe('Region Extraction', () => {
    it('should extract region from various ECR URL formats using static method', () => {
      const testCases = [
        { url: '123456789012.dkr.ecr.us-east-1.amazonaws.com', expected: 'us-east-1' },
        { url: '123456789012.dkr.ecr.eu-west-2.amazonaws.com', expected: 'eu-west-2' },
        { url: '123456789012.dkr.ecr.ap-southeast-1.amazonaws.com', expected: 'ap-southeast-1' },
        { url: '123456789012.dkr.ecr.us-gov-west-1.amazonaws.com', expected: 'us-gov-west-1' },
      ];

      testCases.forEach(({ url, expected }) => {
        const extractedRegion = AwsEcrAuthProvider.extractRegionFromUrl(url);
        expect(extractedRegion).to.equal(expected);
      });
    });

    it('should allow explicit region override', () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'eu-central-1', // Explicit override
      };

      const provider = new AwsEcrAuthProvider(config);
      expect(provider.ecrRegion).to.equal('eu-central-1');
    });
  });

  describe('Session Token Support', () => {
    beforeEach(() => {
      // AWS SDK returns expiresAt as a Date object
      const fixtureWithDateObjects = {
        ...awsEcrFixture.apiResponse,
        authorizationData: awsEcrFixture.apiResponse.authorizationData.map((authData) => ({
          ...authData,
          expiresAt: new Date(authData.expiresAt),
        })),
      };
      sendStub = sinon.stub(ECRClient.prototype, 'send').resolves(fixtureWithDateObjects);
    });

    it('should pass sessionToken to AWS SDK when provided', async () => {
      const config = {
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        sessionToken: 'FwoGZXIvYXdzEBEaD...',
      };

      const provider = new AwsEcrAuthProvider(config);
      await provider.getCredentials();

      sinon.assert.calledOnce(sendStub);
      // Provider should have created ECRClient with credentials including sessionToken
      expect(provider.ecrClient).to.exist;
    });
  });
});
