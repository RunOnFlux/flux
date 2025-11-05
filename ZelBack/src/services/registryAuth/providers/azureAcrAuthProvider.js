/**
 * AzureAcrAuthProvider - Authentication provider for Azure Container Registry (ACR)
 *
 * This provider handles Azure ACR authentication using a two-step OAuth2 token exchange flow:
 * 1. Obtain Azure AD access token with containerregistry.azure.net scope using service principal
 * 2. Exchange Azure AD token for ACR refresh token via /oauth2/exchange endpoint
 * 3. Exchange ACR refresh token for short-lived access token via /oauth2/token endpoint
 *
 * Access tokens are valid for 1-3 hours and are automatically refreshed when needed.
 * This matches the authentication pattern used by AWS ECR and Google GAR providers.
 */

// eslint-disable-next-line import/no-unresolved
const { ClientSecretCredential } = require('@azure/identity');
const { RegistryAuthProvider } = require('./base/registryAuthProvider');

class AzureAcrAuthProvider extends RegistryAuthProvider {
  constructor(config, appName) {
    super(config, appName);
    this.azureCredential = null;

    // Extract registry name from config if provided
    // Config can have: registryName (explicit) or registry (URL to parse)
    this.registryName = config.registryName
                        || (config.registry ? this.constructor.extractRegistryNameFromUrl(config.registry) : null);

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
        this.config.clientSecret,
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
   * Exchange Azure AD token for ACR refresh token
   * ACR refresh tokens are long-lived and can be used to obtain multiple access tokens
   *
   * @param {string} aadAccessToken - Azure AD access token
   * @returns {Promise<string>} ACR refresh token
   */
  async exchangeAadTokenForRefreshToken(aadAccessToken) {
    const registryUrl = `https://${this.registryName}.azurecr.io`;
    const exchangeUrl = `${registryUrl}/oauth2/exchange`;

    const params = new URLSearchParams({
      grant_type: 'access_token',
      service: `${this.registryName}.azurecr.io`,
      access_token: aadAccessToken,
    });

    try {
      const response = await fetch(exchangeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ACR refresh token exchange failed (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.refresh_token) {
        throw new Error('No refresh_token in ACR exchange response');
      }

      return data.refresh_token;
    } catch (error) {
      throw new Error(`Failed to exchange AAD token for ACR refresh token: ${error.message}`);
    }
  }

  /**
   * Exchange ACR refresh token for short-lived access token
   * Access tokens are scoped to specific repository operations and expire after ~1-3 hours
   *
   * @param {string} refreshToken - ACR refresh token
   * @param {string} scope - Repository scope (e.g., 'repository:myrepo:pull')
   * @returns {Promise<object>} Object with access_token and expiry info
   */
  async exchangeRefreshTokenForAccessToken(refreshToken, scope = 'repository:*:pull') {
    const registryUrl = `https://${this.registryName}.azurecr.io`;
    const tokenUrl = `${registryUrl}/oauth2/token`;

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      service: `${this.registryName}.azurecr.io`,
      scope,
      refresh_token: refreshToken,
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ACR access token exchange failed (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.access_token) {
        throw new Error('No access_token in ACR token response');
      }

      // ACR access tokens are typically valid for 1-3 hours
      // Validate and use expires_in with explicit null/undefined check and type validation
      let expiresInSeconds = 3 * 60 * 60; // Default: 3 hours
      if (data.expires_in != null) {
        const providedExpiry = Number(data.expires_in);
        if (Number.isFinite(providedExpiry)) {
          // Use the provided value even if zero or negative
          // Negative/zero values indicate already-expired tokens
          expiresInSeconds = providedExpiry;
          if (providedExpiry <= 0) {
            console.warn(`[AzureAcrAuthProvider] Token already expired (expires_in: ${data.expires_in})`);
          }
        } else {
          // Invalid type (NaN, Infinity, etc), use default
          // This could happen if Azure API returns unexpected non-numeric values
          console.warn(`[AzureAcrAuthProvider] Invalid expires_in from Azure: ${data.expires_in}, using default 3hr`);
        }
      }
      const expiryTime = Date.now() + (expiresInSeconds * 1000);

      return {
        access_token: data.access_token,
        expiresAt: expiryTime,
        expiresInSeconds,
      };
    } catch (error) {
      throw new Error(`Failed to exchange refresh token for ACR access token: ${error.message}`);
    }
  }

  /**
   * Refresh ACR OAuth access token from Azure
   * Implements two-step OAuth2 flow:
   * 1. Get Azure AD token with containerregistry.azure.net scope
   * 2. Exchange AAD token for ACR refresh token
   * 3. Exchange refresh token for short-lived access token
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
      // Step 1: Get Azure AD access token with correct scope for container registry
      // This is the CORRECT scope - not management.azure.com!
      const tokenResponse = await this.azureCredential.getToken([
        'https://containerregistry.azure.net/.default',
      ]);

      if (!tokenResponse || !tokenResponse.token) {
        throw new Error('No access token received from Azure Identity');
      }

      // Step 2: Exchange Azure AD token for ACR refresh token
      const acrRefreshToken = await this.exchangeAadTokenForRefreshToken(tokenResponse.token);

      // Step 3: Exchange refresh token for short-lived access token
      const accessTokenData = await this.exchangeRefreshTokenForAccessToken(acrRefreshToken);

      // Create standardized credentials for Docker authentication
      // Azure ACR expects: username = "00000000-0000-0000-0000-000000000000", password = access_token
      const credentials = this.createCredentials(
        '00000000-0000-0000-0000-000000000000',
        accessTokenData.access_token,
        'bearer',
        {
          tenantId: this.config.tenantId,
          clientId: this.config.clientId,
          registryName: this.registryName,
          expiresAt: accessTokenData.expiresAt,
          tokenType: 'short-lived-access',
          expiresInSeconds: accessTokenData.expiresInSeconds,
        },
      );

      this.cacheCredentials(credentials, accessTokenData.expiresAt);

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
  // eslint-disable-next-line class-methods-use-this
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
      registryName,
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
      tokenExpiresIn: this.getTimeUntilExpiry(),
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
        hasTenantId: Boolean(this.config.tenantId),
      },
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
      // Test by attempting to get an access token with correct scope
      const tokenResponse = await this.azureCredential.getToken([
        'https://containerregistry.azure.net/.default',
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
        containerRegistryScope: 'https://containerregistry.azure.net/.default',
        authority: 'https://login.microsoftonline.com',
      },
      government: {
        containerRegistryScope: 'https://containerregistry.azure.us/.default',
        authority: 'https://login.microsoftonline.us',
      },
      china: {
        containerRegistryScope: 'https://containerregistry.azure.cn/.default',
        authority: 'https://login.chinacloudapi.cn',
      },
      germany: {
        containerRegistryScope: 'https://containerregistry.cloudapi.de/.default',
        authority: 'https://login.microsoftonline.de',
      },
    };

    return endpoints[cloud] || endpoints.public;
  }
}

module.exports = { AzureAcrAuthProvider };
