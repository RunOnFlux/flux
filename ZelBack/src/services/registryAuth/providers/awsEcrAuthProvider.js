/**
 * AwsEcrAuthProvider - Authentication provider for Amazon ECR (Elastic Container Registry)
 *
 * This provider handles AWS ECR authentication using the AWS SDK to obtain
 * authorization tokens that are valid for 12 hours. It supports both explicit
 * AWS credentials and environment variable/IAM role authentication.
 */

const { ECRClient, DescribeRepositoriesCommand, GetAuthorizationTokenCommand } = require('@aws-sdk/client-ecr');
const { RegistryAuthProvider } = require('./base/registryAuthProvider');

class AwsEcrAuthProvider extends RegistryAuthProvider {
  constructor(config) {
    super(config);
    this.ecrClient = null;
    this.ecrRegion = config.region || process.env.AWS_DEFAULT_REGION;

    // Initialize ECR client
    this.initializeClient();
  }

  /**
   * Initialize the AWS ECR client with provided credentials or environment defaults
   */
  initializeClient() {
    try {

      const clientConfig = {
        region: this.ecrRegion
      };

      // Use explicit credentials if provided
      if (this.config.accessKeyId && this.config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey
        };
      }

      // Add session token if provided (for temporary credentials)
      if (this.config.sessionToken) {
        clientConfig.credentials = clientConfig.credentials || {};
        clientConfig.credentials.sessionToken = this.config.sessionToken;
      }

      this.ecrClient = new ECRClient(clientConfig);

    } catch (error) {
      const wrappedError = new Error(`Failed to initialize AWS ECR client: ${error.message}`);
      this.recordError(wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Get ECR authentication credentials
   * Returns cached token if valid, otherwise fetches a new one
   *
   * @returns {Promise<object>} ECR authentication credentials
   */
  async getCredentials() {
    if (!this.validateConfiguration()) {
      const error = new Error('AWS ECR configuration invalid: region and credentials required');
      this.recordError(error);
      throw error;
    }

    // Return cached credentials if still valid and not expiring soon
    if (this.isTokenValid() && !this.isTokenExpiringSoon()) {
      return this.tokenCache;
    }

    // Refresh credentials
    const credentials = await this.refreshCredentials();

    return credentials;
  }

  /**
   * Refresh ECR authorization token from AWS
   *
   * @returns {Promise<object>} Fresh ECR credentials
   */
  async refreshCredentials() {
    if (!this.ecrClient) {
      const error = new Error('ECR client not initialized');
      this.recordError(error);
      throw error;
    }

    try {
      const commandParams = {};
      if (this.config.registryIds && this.config.registryIds.length > 0) {
        commandParams.registryIds = this.config.registryIds;
      }

      const command = new GetAuthorizationTokenCommand(commandParams);

      const response = await this.ecrClient.send(command);

      if (!response.authorizationData || response.authorizationData.length === 0) {
        throw new Error('No authorization data received from ECR');
      }

      const authData = response.authorizationData[0];

      // Parse the base64 encoded authorization token
      // ECR returns: base64(AWS:password)
      const tokenBuffer = Buffer.from(authData.authorizationToken, 'base64');
      const tokenString = tokenBuffer.toString('utf-8');
      const [username, password] = tokenString.split(':');

      if (!username || !password) {
        throw new Error('Invalid ECR authorization token format');
      }

      // Validate that expiry time is provided by AWS API
      if (!authData.expiresAt) {
        throw new Error('AWS ECR API did not provide token expiry time');
      }

      // Use only the actual expiry time from AWS API
      const expiryTime = authData.expiresAt.getTime();

      // Create standardized credentials with correct expiry
      const credentials = this.createCredentials(
        username,
        password,
        'bearer',
        {
          proxyEndpoint: authData.proxyEndpoint,
          region: this.ecrRegion,
          registryIds: this.config.registryIds || null,
          expiresAt: expiryTime  // Override the null tokenExpiry with actual expiry
        }
      );

      this.cacheCredentials(credentials, expiryTime);

      return credentials;

    } catch (error) {
      const detailedError = new Error(`AWS ECR authentication failed: ${error.message}`);
      this.recordError(detailedError);
      throw detailedError;
    }
  }

  /**
   * Check if this provider can handle the given registry URL
   * AWS ECR URLs follow the pattern: *.dkr.ecr.*.amazonaws.com
   *
   * @param {string} registryUrl - Registry URL to check
   * @returns {boolean} True if this is an AWS ECR registry
   */
  isValidFor(registryUrl) {
    if (!registryUrl || typeof registryUrl !== 'string') {
      return false;
    }

    // Remove protocol if present
    const cleanUrl = registryUrl.replace(/^https?:\/\//, '');

    // AWS ECR registry pattern: account-id.dkr.ecr.region.amazonaws.com
    const ecrPattern = /^[\d]+\.dkr\.ecr\.[\w-]+\.amazonaws\.com$/;

    return ecrPattern.test(cleanUrl);
  }

  /**
   * Validate AWS ECR configuration
   * Requires region and either explicit credentials or environment setup
   *
   * @returns {boolean} True if configuration is valid
   */
  validateConfiguration() {
    // Must have a region
    if (!this.ecrRegion) {
      return false;
    }

    // Must have credentials available (explicit or environment)
    const hasExplicitCredentials = Boolean(this.config.accessKeyId && this.config.secretAccessKey);
    const hasEnvironmentCredentials = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    const hasProfile = Boolean(process.env.AWS_PROFILE);
    const hasIAMRole = Boolean(process.env.AWS_ROLE_ARN || process.env.ECS_CONTAINER_METADATA_URI || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI);

    return hasExplicitCredentials || hasEnvironmentCredentials || hasProfile || hasIAMRole;
  }

  /**
   * ECR uses bearer token authentication
   *
   * @returns {string} Authentication type
   */
  getAuthType() {
    return 'bearer';
  }

  /**
   * Extract AWS region from registry URL if not explicitly configured
   *
   * @param {string} registryUrl - ECR registry URL
   * @returns {string|null} Extracted region or null
   */
  static extractRegionFromUrl(registryUrl) {
    if (!registryUrl || typeof registryUrl !== 'string') {
      return null;
    }

    const match = registryUrl.match(/\.dkr\.ecr\.([\w-]+)\.amazonaws\.com/);
    return match ? match[1] : null;
  }

  /**
   * Create an AWS ECR provider from a registry URL and optional config
   * Automatically extracts region from URL if not provided
   *
   * @param {string} registryUrl - ECR registry URL
   * @param {object} config - Optional configuration
   * @returns {AwsEcrAuthProvider} New provider instance
   */
  static fromRegistryUrl(registryUrl, config = {}) {
    const region = config.region || this.extractRegionFromUrl(registryUrl);

    if (!region) {
      throw new Error('Could not determine AWS region from registry URL');
    }

    return new AwsEcrAuthProvider({
      ...config,
      region
    });
  }

  /**
   * Get safe configuration for logging (excludes sensitive data)
   *
   * @returns {object} Safe configuration
   */
  getSafeConfig() {
    return {
      provider: this.getProviderName(),
      region: this.ecrRegion,
      hasExplicitCredentials: Boolean(this.config.accessKeyId && this.config.secretAccessKey),
      hasSessionToken: Boolean(this.config.sessionToken),
      registryIds: this.config.registryIds || null,
      authType: this.getAuthType(),
      tokenCached: this.isTokenValid(),
      tokenExpiresIn: this.getTimeUntilExpiry()
    };
  }

  /**
   * String representation for debugging (excludes sensitive data)
   *
   * @returns {string} String representation
   */
  toString() {
    return `AwsEcrAuthProvider(region=${this.ecrRegion}, hasCredentials=${this.validateConfiguration()})`;
  }

  /**
   * Get provider-specific error information
   *
   * @returns {object} Error details with AWS-specific information
   */
  getExtendedErrorInfo() {
    const baseError = this.getLastError();
    if (!baseError) {
      return null;
    }

    return {
      ...baseError,
      region: this.ecrRegion,
      clientInitialized: Boolean(this.ecrClient),
      configurationValid: this.validateConfiguration(),
      credentialSources: {
        explicit: Boolean(this.config.accessKeyId && this.config.secretAccessKey),
        environment: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
        profile: Boolean(process.env.AWS_PROFILE),
        hasRole: Boolean(process.env.AWS_ROLE_ARN || process.env.ECS_CONTAINER_METADATA_URI)
      }
    };
  }

  /**
   * Test connection to AWS ECR without fetching a full token
   * Useful for configuration validation
   *
   * @returns {Promise<boolean>} True if connection test succeeds
   */
  async testConnection() {
    if (!this.validateConfiguration()) {
      return false;
    }

    try {
      const command = new DescribeRepositoriesCommand({
        maxResults: 1 // Minimal request
      });

      await this.ecrClient.send(command);
      return true;

    } catch (error) {
      this.recordError(error);
      return false;
    }
  }
}

module.exports = { AwsEcrAuthProvider };
