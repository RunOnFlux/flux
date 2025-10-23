/**
 * GoogleGarAuthProvider - Authentication provider for Google Artifact Registry (GAR)
 *
 * This provider handles Google GAR authentication using the Google Auth Library to obtain
 * OAuth access tokens that are valid for 60 minutes. It uses service account credentials
 * to generate short-lived tokens for enhanced security over static JSON keys.
 */

const { JWT } = require('google-auth-library');
const { RegistryAuthProvider } = require('./base/registryAuthProvider');

class GoogleGarAuthProvider extends RegistryAuthProvider {
  constructor(config) {
    super(config);
    this.jwtClient = null;

    // Initialize JWT client
    this.initializeClient();
  }

  /**
   * Initialize the Google Auth JWT client with service account credentials
   */
  initializeClient() {
    try {
      if (!this.config.privateKey || !this.config.clientEmail) {
        throw new Error('Service account credentials (privateKey and clientEmail) are required');
      }

      // Create JWT client with service account credentials
      this.jwtClient = new JWT({
        email: this.config.clientEmail,
        key: this.config.privateKey,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });

    } catch (error) {
      const wrappedError = new Error(`Failed to initialize Google GAR client: ${error.message}`);
      // Only record error if provider name is set (avoid error in tests)
      if (this.registeredName) {
        this.recordError(wrappedError);
      }
      throw wrappedError;
    }
  }

  /**
   * Get GAR authentication credentials
   * Returns cached token if valid, otherwise fetches a new one
   *
   * @returns {Promise<object>} GAR authentication credentials
   */
  async getCredentials() {
    if (!this.validateConfiguration()) {
      const error = new Error('Google GAR configuration invalid: privateKey, clientEmail are required');
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
   * Refresh GAR OAuth access token from Google
   *
   * @returns {Promise<object>} Fresh GAR credentials
   */
  async refreshCredentials() {
    if (!this.jwtClient) {
      const error = new Error('JWT client not initialized');
      this.recordError(error);
      throw error;
    }

    try {
      // Get access token from Google
      const tokens = await this.jwtClient.getAccessToken();

      if (!tokens.token) {
        throw new Error('No access token received from Google Auth');
      }

      // Validate that expiry time is provided by Google Auth Library
      if (!this.jwtClient.credentials.expiry_date) {
        throw new Error('Google Auth Library did not provide token expiry time');
      }

      // Use only the actual expiry time from Google Auth Library
      const expiryTime = this.jwtClient.credentials.expiry_date;

      // Create standardized credentials for Docker authentication
      // Google GAR expects: username = "oauth2accesstoken", password = access_token
      const credentials = this.createCredentials(
        'oauth2accesstoken',
        tokens.token,
        'bearer',
        {
          clientEmail: this.config.clientEmail,
          expiresAt: expiryTime
        }
      );

      this.cacheCredentials(credentials, expiryTime);

      return credentials;

    } catch (error) {
      const detailedError = new Error(`Google GAR authentication failed: ${error.message}`);
      this.recordError(detailedError);
      throw detailedError;
    }
  }

  /**
   * Check if this provider can handle the given registry URL
   * Google GAR URLs follow the pattern: region-docker.pkg.dev
   *
   * @param {string} registryUrl - Registry URL to check
   * @returns {boolean} True if this is a Google GAR registry
   */
  isValidFor(registryUrl) {
    if (!registryUrl || typeof registryUrl !== 'string') {
      return false;
    }

    // Remove protocol if present
    const cleanUrl = registryUrl.replace(/^https?:\/\//, '');

    // Google GAR registry pattern: region-docker.pkg.dev
    // Examples: us-central1-docker.pkg.dev, europe-west1-docker.pkg.dev
    const garPattern = /^[\w-]+-docker\.pkg\.dev$/;

    return garPattern.test(cleanUrl);
  }

  /**
   * Validate Google GAR configuration
   * Requires privateKey and clientEmail for service account authentication
   *
   * @returns {boolean} True if configuration is valid
   */
  validateConfiguration() {
    // Must have service account credentials
    if (!this.config.privateKey || !this.config.clientEmail) {
      return false;
    }

    // Validate private key format
    if (!this.config.privateKey.includes('BEGIN PRIVATE KEY')) {
      return false;
    }

    // Validate client email format
    const emailPattern = /^.+@.+\.iam\.gserviceaccount\.com$/;
    if (!emailPattern.test(this.config.clientEmail)) {
      return false;
    }

    return true;
  }

  /**
   * GAR uses bearer token authentication
   *
   * @returns {string} Authentication type
   */
  getAuthType() {
    return 'bearer';
  }

  /**
   * Extract region from GAR registry URL
   *
   * @param {string} registryUrl - GAR registry URL
   * @returns {string|null} Extracted region or null
   */
  static extractRegionFromUrl(registryUrl) {
    if (!registryUrl || typeof registryUrl !== 'string') {
      return null;
    }

    const match = registryUrl.match(/^(?:https?:\/\/)?([\w-]+)-docker\.pkg\.dev/);
    return match ? match[1] : null;
  }

  /**
   * Create a Google GAR provider from a registry URL and optional config
   * Automatically extracts region from URL if not provided
   *
   * @param {string} registryUrl - GAR registry URL
   * @param {object} config - Configuration including service account credentials
   * @returns {GoogleGarAuthProvider} New provider instance
   */
  static fromRegistryUrl(registryUrl, config = {}) {
    const region = config.region || this.extractRegionFromUrl(registryUrl);

    return new GoogleGarAuthProvider({
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
      clientEmail: this.config.clientEmail,
      hasPrivateKey: Boolean(this.config.privateKey),
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
    return `GoogleGarAuthProvider(clientEmail=${this.config.clientEmail}, hasCredentials=${this.validateConfiguration()})`;
  }

  /**
   * Get provider-specific error information
   *
   * @returns {object} Error details with Google-specific information
   */
  getExtendedErrorInfo() {
    const baseError = this.getLastError();
    if (!baseError) {
      return null;
    }

    return {
      ...baseError,
      clientEmail: this.config.clientEmail,
      jwtClientInitialized: Boolean(this.jwtClient),
      configurationValid: this.validateConfiguration(),
      credentialSources: {
        hasPrivateKey: Boolean(this.config.privateKey),
        hasClientEmail: Boolean(this.config.clientEmail)
      }
    };
  }

  /**
   * Test connection to Google GAR without fetching a full token
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
      const tokens = await this.jwtClient.getAccessToken();
      return Boolean(tokens.token);

    } catch (error) {
      this.recordError(error);
      return false;
    }
  }
}

module.exports = { GoogleGarAuthProvider };