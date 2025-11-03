/**
 * BasicAuthProvider - Wrapper for traditional username/password authentication
 *
 * This provider handles the existing FluxOS authentication method using
 * username and password credentials. It serves as a fallback provider
 * that can work with any Docker registry supporting basic authentication.
 */

const { RegistryAuthProvider } = require('./base/registryAuthProvider');

class BasicAuthProvider extends RegistryAuthProvider {
  constructor(config, appName) {
    super(config, appName);
    this.username = config.username;
    this.password = config.password;
  }

  /**
   * Get basic authentication credentials
   * For basic auth, credentials don't expire so we can return them immediately
   *
   * @returns {Promise<object>} Basic auth credentials
   */
  async getCredentials() {
    if (!this.validateConfiguration()) {
      const error = new Error('Basic auth configuration invalid: username and password required');
      this.recordError(error);
      throw error;
    }

    // Clear any previous error on successful validation
    this.lastError = null;

    // Create standardized credentials object
    const credentials = this.createCredentials(
      this.username,
      this.password,
      'basic',
      {
        // Basic auth credentials don't expire
        persistent: true
      }
    );

    return credentials;
  }

  /**
   * Basic auth works with any registry that supports it
   * This provider serves as a fallback for unknown registries
   *
   * @param {string} registryUrl - Registry URL to check
   * @returns {boolean} Always true (fallback provider)
   */
  isValidFor(registryUrl) {
    // Basic auth is a fallback that works with any registry
    return true;
  }

  /**
   * Validate that we have both username and password
   *
   * @returns {boolean} True if both username and password are provided
   */
  validateConfiguration() {
    return !!(this.username &&
              this.password &&
              typeof this.username === 'string' &&
              typeof this.password === 'string' &&
              this.username.trim().length > 0 &&
              this.password.trim().length > 0);
  }

  /**
   * Basic auth uses 'basic' authentication type
   *
   * @returns {string} Authentication type
   */
  getAuthType() {
    return 'basic';
  }

  /**
   * For basic auth, refresh just returns the same credentials
   * since they don't expire
   *
   * @returns {Promise<object>} Same credentials
   */
  async refreshCredentials() {
    return this.getCredentials();
  }

  /**
   * Basic auth credentials don't expire
   *
   * @returns {boolean} Always true
   */
  isTokenValid() {
    return this.validateConfiguration();
  }

  /**
   * Create a BasicAuthProvider from a credential string
   * Handles the common "username:password" format
   *
   * @param {string} credentialString - Credentials in "username:password" format
   * @param {string} appName - Application name for per-app provider caching isolation
   * @returns {BasicAuthProvider} New provider instance
   */
  static fromCredentialString(credentialString, appName) {
    if (!credentialString || typeof credentialString !== 'string') {
      throw new Error('Credential string is required');
    }

    if (!credentialString.includes(':')) {
      throw new Error('Credential string must be in format "username:password"');
    }

    const [username, ...passwordParts] = credentialString.split(':');
    const password = passwordParts.join(':'); // Handle passwords containing colons

    if (!username || !password) {
      throw new Error('Both username and password are required');
    }

    return new BasicAuthProvider({
      username: username.trim(),
      password: password.trim()
    }, appName);
  }

  /**
   * Create a BasicAuthProvider from a credentials object
   *
   * @param {object} credentialsObj - Object with username and password fields
   * @param {string} appName - Application name for per-app provider caching isolation
   * @returns {BasicAuthProvider} New provider instance
   */
  static fromCredentialsObject(credentialsObj, appName) {
    if (!credentialsObj || typeof credentialsObj !== 'object') {
      throw new Error('Credentials object is required');
    }

    const { username, password } = credentialsObj;

    if (!username || !password) {
      throw new Error('Credentials object must contain username and password fields');
    }

    return new BasicAuthProvider(credentialsObj, appName);
  }

  /**
   * Get a sanitized version of the configuration for logging
   * Excludes sensitive password information
   *
   * @returns {object} Safe configuration for logging
   */
  getSafeConfig() {
    return {
      provider: this.getProviderName(),
      username: this.username,
      hasPassword: !!this.password,
      authType: this.getAuthType()
    };
  }

  /**
   * Convert to string representation (safe for logging)
   *
   * @returns {string} String representation without sensitive data
   */
  toString() {
    return `BasicAuthProvider(username=${this.username}, hasPassword=${!!this.password})`;
  }
}

module.exports = { BasicAuthProvider };