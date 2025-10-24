/**
 * AzureAcrAuthProvider - Authentication provider for Azure Container Registry (ACR)
 *
 * This provider handles Azure ACR authentication using the Azure Identity library to obtain
 * OAuth access tokens that are valid for 3 hours. It uses service principal credentials
 * to generate short-lived tokens for enhanced security.
 */

const { ClientSecretCredential } = require('@azure/identity');
const { RegistryAuthProvider } = require('./base/registryAuthProvider');

class AzureAcrAuthProvider extends RegistryAuthProvider {
  constructor(config) {
    super(config);
    this.azureCredential = null;

    // Extract registry name from config if provided
    // Config can have: registryName (explicit) or registry (URL to parse)
    this.registryName = config.registryName ||
                        (config.registry ? this.constructor.extractRegistryNameFromUrl(config.registry) : null);

    // Initialize Azure credential client
    this.initializeClient();
  }

  /**
   * Initialize the Azure Identity client with service principal credentials
   */
  initializeClient() {
    try {
      if (!this.config.clientId || !this.config.clientSecret || !this.config.tenantId) {
        throw new Error('Service principal credentials (clientId, clientSecret, tenantId) are required');
      }

      // Create Azure ClientSecretCredential with service principal
      this.azureCredential = new ClientSecretCredential(
        this.config.tenantId,
        this.config.clientId,
        this.config.clientSecret
      );

    } catch (error) {
      const wrappedError = new Error(`Failed to initialize Azure ACR client: ${error.message}`);
      // Only record error if provider name is set (avoid error in tests)
      if (this.registeredName) {
        this.recordError(wrappedError);
      }
      throw wrappedError;
    }
  }

  /**
   * Get ACR authentication credentials
   * Returns cached token if valid, otherwise fetches a new one
   *
   * @returns {Promise<object>} ACR authentication credentials
   */
  async getCredentials() {
    if (!this.validateConfiguration()) {
      const error = new Error('Azure ACR configuration invalid: clientId, clientSecret, tenantId are required');
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
   * Refresh ACR OAuth access token from Azure
   *
   * @returns {Promise<object>} Fresh ACR credentials
   */
  async refreshCredentials() {
    if (!this.azureCredential) {
      const error = new Error('Azure credential not initialized');
      this.recordError(error);
      throw error;
    }

    try {
      // Get access token from Azure Identity
      // ACR requires management scope for container registry operations
      const tokenResponse = await this.azureCredential.getToken([
        'https://management.azure.com/.default'
      ]);

      if (!tokenResponse || !tokenResponse.token) {
        throw new Error('No access token received from Azure Identity');
      }

      // Validate that expiry time is provided by Azure Identity API
      if (!tokenResponse.expiresOnTimestamp) {
        throw new Error('Azure Identity API did not provide token expiry time');
      }

      // Use only the actual expiry time from Azure Identity API
      const expiryTime = tokenResponse.expiresOnTimestamp;

      // Create standardized credentials for Docker authentication
      // Azure ACR expects: username = "00000000-0000-0000-0000-000000000000", password = access_token
      const credentials = this.createCredentials(
        '00000000-0000-0000-0000-000000000000',
        tokenResponse.token,
        'bearer',
        {
          tenantId: this.config.tenantId,
          clientId: this.config.clientId,
          registryName: this.registryName,
          expiresAt: expiryTime
        }
      );

      this.cacheCredentials(credentials, expiryTime);

      return credentials;

    } catch (error) {
      const detailedError = new Error(`Azure ACR authentication failed: ${error.message}`);
      this.recordError(detailedError);
      throw detailedError;
    }
  }

  /**
   * Check if this provider can handle the given registry URL
   * Azure ACR URLs follow the pattern: {registry-name}.azurecr.io
   *
   * @param {string} registryUrl - Registry URL to check
   * @returns {boolean} True if this is an Azure ACR registry
   */
  isValidFor(registryUrl) {
    if (!registryUrl || typeof registryUrl !== 'string') {
      return false;
    }

    // Remove protocol if present
    const cleanUrl = registryUrl.replace(/^https?:\/\//, '');

    // Azure ACR registry pattern: registry-name.azurecr.io
    // Examples: myregistry.azurecr.io, company-registry.azurecr.io
    const acrPattern = /^[\w-]+\.azurecr\.io$/;

    const isMatch = acrPattern.test(cleanUrl);

    // Extract registry name for metadata
    if (isMatch && !this.registryName) {
      const match = cleanUrl.match(/^([\w-]+)\.azurecr\.io$/);
      if (match) {
        this.registryName = match[1];
      }
    }

    return isMatch;
  }

  /**
   * Validate Azure ACR configuration
   * Requires clientId, clientSecret, and tenantId for service principal authentication
   *
   * @returns {boolean} True if configuration is valid
   */
  validateConfiguration() {
    // Must have service principal credentials
    if (!this.config.clientId || !this.config.clientSecret || !this.config.tenantId) {
      return false;
    }

    // Validate client ID format (should be a GUID)
    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!guidPattern.test(this.config.clientId)) {
      return false;
    }

    // Validate tenant ID format (should be a GUID)
    if (!guidPattern.test(this.config.tenantId)) {
      return false;
    }

    // Validate client secret (should not be empty)
    if (typeof this.config.clientSecret !== 'string' || this.config.clientSecret.trim().length === 0) {
      return false;
    }

    return true;
  }

  /**
   * ACR uses bearer token authentication
   *
   * @returns {string} Authentication type
   */
  getAuthType() {
    return 'bearer';
  }

  /**
   * Extract registry name from ACR registry URL
   *
   * @param {string} registryUrl - ACR registry URL
   * @returns {string|null} Extracted registry name or null
   */
  static extractRegistryNameFromUrl(registryUrl) {
    if (!registryUrl || typeof registryUrl !== 'string') {
      return null;
    }

    const match = registryUrl.match(/^(?:https?:\/\/)?([\w-]+)\.azurecr\.io/);
    return match ? match[1] : null;
  }

  /**
   * Create an Azure ACR provider from a registry URL and optional config
   * Automatically extracts registry name from URL if not provided
   *
   * @param {string} registryUrl - ACR registry URL
   * @param {object} config - Configuration including service principal credentials
   * @returns {AzureAcrAuthProvider} New provider instance
   */
  static fromRegistryUrl(registryUrl, config = {}) {
    const registryName = config.registryName || this.extractRegistryNameFromUrl(registryUrl);

    return new AzureAcrAuthProvider({
      ...config,
      registryName
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
      tenantId: this.config.tenantId,
      clientId: this.config.clientId,
      hasClientSecret: Boolean(this.config.clientSecret),
      registryName: this.registryName,
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
    return `AzureAcrAuthProvider(registryName=${this.registryName}, hasCredentials=${this.validateConfiguration()})`;
  }

  /**
   * Get provider-specific error information
   *
   * @returns {object} Error details with Azure-specific information
   */
  getExtendedErrorInfo() {
    const baseError = this.getLastError();
    if (!baseError) {
      return null;
    }

    return {
      ...baseError,
      tenantId: this.config.tenantId,
      clientId: this.config.clientId,
      registryName: this.registryName,
      azureCredentialInitialized: Boolean(this.azureCredential),
      configurationValid: this.validateConfiguration(),
      credentialSources: {
        hasClientId: Boolean(this.config.clientId),
        hasClientSecret: Boolean(this.config.clientSecret),
        hasTenantId: Boolean(this.config.tenantId)
      }
    };
  }

  /**
   * Test connection to Azure ACR without fetching a full token
   * Useful for configuration validation
   *
   * @returns {Promise<boolean>} True if connection test succeeds
   */
  async testConnection() {
    if (!this.validateConfiguration()) {
      return false;
    }

    try {
      // Test by attempting to get an access token
      const tokenResponse = await this.azureCredential.getToken([
        'https://management.azure.com/.default'
      ]);
      return Boolean(tokenResponse && tokenResponse.token);

    } catch (error) {
      this.recordError(error);
      return false;
    }
  }

  /**
   * Validate Azure GUID format
   *
   * @param {string} guid - GUID string to validate
   * @returns {boolean} True if valid GUID format
   */
  static isValidGuid(guid) {
    if (!guid || typeof guid !== 'string') {
      return false;
    }

    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidPattern.test(guid);
  }

  /**
   * Get Azure Cloud environment-specific endpoints
   *
   * @param {string} cloud - Cloud environment ('public', 'government', 'china', 'germany')
   * @returns {object} Cloud-specific endpoints
   */
  static getCloudEndpoints(cloud = 'public') {
    const endpoints = {
      public: {
        managementScope: 'https://management.azure.com/.default',
        authority: 'https://login.microsoftonline.com'
      },
      government: {
        managementScope: 'https://management.usgovcloudapi.net/.default',
        authority: 'https://login.microsoftonline.us'
      },
      china: {
        managementScope: 'https://management.chinacloudapi.cn/.default',
        authority: 'https://login.chinacloudapi.cn'
      },
      germany: {
        managementScope: 'https://management.microsoftazure.de/.default',
        authority: 'https://login.microsoftonline.de'
      }
    };

    return endpoints[cloud] || endpoints.public;
  }
}

module.exports = { AzureAcrAuthProvider };