/**
 * RegistryAuthProvider - Abstract base class for Docker registry authentication providers
 *
 * This class defines the interface that all authentication providers must implement.
 * It provides common functionality like token caching and validation while requiring
 * subclasses to implement provider-specific authentication logic.
 */

class RegistryAuthProvider {
  constructor(config = {}) {
    this.config = config;
    this.tokenCache = null;
    this.tokenExpiry = null;
    this.lastError = null;
    this.registeredName = null; // Will be set by factory during creation
  }

  /**
   * Get authentication credentials for the registry
   * This method should return credentials in a standardized format
   *
   * @returns {Promise<object>} Credentials object with username, password, and type
   * @abstract
   */
  async getCredentials() {
    throw new Error(`${this.constructor.name} must implement getCredentials() method`);
  }

  /**
   * Check if this provider can handle the given registry URL
   * Used by the factory to auto-select the appropriate provider
   *
   * @param {string} registryUrl - The registry URL to check
   * @returns {boolean} True if this provider can handle the registry
   * @abstract
   */
  isValidFor(registryUrl) {
    throw new Error(`${this.constructor.name} must implement isValidFor() method`);
  }

  /**
   * Validate that the provider configuration is correct
   * Should check for required credentials, regions, endpoints, etc.
   *
   * @returns {boolean} True if configuration is valid
   * @abstract
   */
  validateConfiguration() {
    throw new Error(`${this.constructor.name} must implement validateConfiguration() method`);
  }

  /**
   * Refresh authentication credentials
   * Default implementation just calls getCredentials(), but providers
   * can override for more sophisticated refresh logic
   *
   * @returns {Promise<object>} Fresh credentials
   */
  async refreshCredentials() {
    this.clearCache();
    return this.getCredentials();
  }

  /**
   * Get the authentication type supported by this provider
   * Common types: 'basic', 'bearer', 'oauth'
   *
   * @returns {string} Authentication type
   */
  getAuthType() {
    return 'bearer'; // Most modern registries use bearer tokens
  }

  /**
   * Get a human-readable name for this provider
   * Used for logging and debugging
   *
   * @returns {string} Provider name
   */
  getProviderName() {
    // If registeredName is set (via factory), use it
    // Otherwise derive from class name for direct instantiation (useful for testing)
    return this.registeredName || this.constructor.name.replace('AuthProvider', '').toLowerCase();
  }

  // ===== Common utility methods =====

  /**
   * Check if cached token is still valid
   */
  isTokenValid() {
    return !!(this.tokenCache &&
              this.tokenExpiry &&
              Date.now() < this.tokenExpiry);
  }

  /**
   * Clear cached credentials and force refresh on next request
   */
  clearCache() {
    this.tokenCache = null;
    this.tokenExpiry = null;
    this.lastError = null;
  }

  /**
   * Cache credentials with expiry time
   *
   * @param {object} credentials - Credentials to cache
   * @param {number} expiryTimeMs - Expiry time in milliseconds since epoch
   */
  cacheCredentials(credentials, expiryTimeMs) {
    this.tokenCache = credentials;
    this.tokenExpiry = expiryTimeMs;
    this.lastError = null;
  }

  /**
   * Get time remaining until token expires (in milliseconds)
   */
  getTimeUntilExpiry() {
    if (!this.tokenExpiry) {
      return 0;
    }
    return Math.max(0, this.tokenExpiry - Date.now());
  }

  /**
   * Check if token will expire within the given time window
   *
   * @param {number} windowMs - Time window in milliseconds (default: 15 minutes)
   * @returns {boolean} True if token expires soon
   */
  isTokenExpiringSoon(windowMs = 15 * 60 * 1000) {
    return this.getTimeUntilExpiry() <= windowMs;
  }

  /**
   * Get cached credentials if valid, otherwise refresh
   *
   * @returns {Promise<object>} Valid credentials
   */
  async getCachedOrRefresh() {
    // If we have valid cached credentials that aren't expiring soon, use them
    if (this.isTokenValid() && !this.isTokenExpiringSoon()) {
      return this.tokenCache;
    }

    // Otherwise refresh credentials
    return this.refreshCredentials();
  }

  /**
   * Record an error for debugging purposes
   *
   * @param {Error|string} error - Error to record
   */
  recordError(error) {
    this.lastError = {
      message: error.message || error,
      timestamp: Date.now(),
      provider: this.getProviderName()
    };
  }

  /**
   * Get the last error that occurred
   *
   * @returns {object|null} Last error details or null
   */
  getLastError() {
    return this.lastError;
  }

  /**
   * Create a standardized credentials object
   *
   * @param {string} username - Username for authentication
   * @param {string} password - Password/token for authentication
   * @param {string} type - Authentication type (default: from getAuthType())
   * @param {object} metadata - Additional metadata
   * @returns {object} Standardized credentials object
   */
  createCredentials(username, password, type = null, metadata = {}) {
    return {
      username,
      password,
      type: type || this.getAuthType(),
      provider: this.getProviderName(),
      expiresAt: this.tokenExpiry,
      ...metadata
    };
  }

  /**
   * Validate a registry URL format
   *
   * @param {string} url - URL to validate
   * @returns {boolean} True if URL format is valid
   */
  static isValidRegistryUrl(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }

    try {
      // Remove protocol if present for pattern matching
      const cleanUrl = url.replace(/^https?:\/\//, '');

      // Basic validation: should contain at least a hostname
      return /^[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/.*)?$/.test(cleanUrl);
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract hostname from registry URL
   *
   * @param {string} url - Registry URL
   * @returns {string|null} Hostname or null if invalid
   */
  static extractHostname(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }

    try {
      // Remove protocol if present
      let cleanUrl = url.replace(/^https?:\/\//, '');

      // Remove path if present
      cleanUrl = cleanUrl.split('/')[0];

      // Remove port if present
      cleanUrl = cleanUrl.split(':')[0];

      return cleanUrl;
    } catch (error) {
      return null;
    }
  }
}

module.exports = { RegistryAuthProvider };