/**
 * RepoAuthParser - Parses FluxOS repoauth string format into authentication configuration
 *
 * Supports two formats:
 * 1. Basic auth: "username:password" (backward compatible)
 * 2. Provider schemes: "provider://param1=value1&param2=value2"
 *
 * This maintains backward compatibility while enabling rich authentication configuration
 * for cloud providers like AWS ECR, Google Artifact Registry, etc.
 */

class RepoAuthParser {
  /**
   * Parse repoauth string into authentication configuration object
   *
   * @param {string} repoauth - Authentication string from FluxOS app spec
   * @returns {object|null} Parsed authentication configuration
   */
  static parse(repoauth) {
    if (!repoauth || typeof repoauth !== 'string' || repoauth.trim() === '') {
      return null;
    }

    const trimmedAuth = repoauth.trim();

    // Check for provider scheme: <provider>://
    // Provider name: starts with letter, can contain letters, numbers, hyphens
    const schemeMatch = trimmedAuth.match(/^([a-zA-Z][a-zA-Z0-9-]*):\/\/(.*)$/);

    if (schemeMatch) {
      // Has provider scheme - parse as advanced authentication config
      const [, provider, params] = schemeMatch;

      try {
        const config = this.parseProviderParams(params);
        return {
          type: provider,
          ...config,
        };
      } catch (error) {
        throw new Error(`Invalid ${provider} authentication format: ${error.message}`);
      }
    }

    // No scheme - treat as basic auth username:password
    return this.parseBasicAuth(trimmedAuth);
  }

  /**
   * Parse basic authentication string (username:password format)
   *
   * @param {string} authString - Basic auth string
   * @returns {object} Basic auth configuration
   */
  static parseBasicAuth(authString) {
    // Find first colon - username cannot contain colons but password can
    const colonIndex = authString.indexOf(':');

    if (colonIndex === -1) {
      throw new Error('Basic auth format requires "username:password"');
    }

    const username = authString.substring(0, colonIndex);
    const password = authString.substring(colonIndex + 1);

    // Username validation - basic rules
    if (username === '' || username.trim() === '') {
      throw new Error('Username cannot be empty or whitespace only');
    }

    return {
      type: 'basic',
      username: username.trim(),
      password: password.trim(), // Trim whitespace for consistency
    };
  }

  /**
   * Parse provider parameters from URL-encoded parameter string
   *
   * @param {string} params - URL-encoded parameter string
   * @returns {object} Parsed parameters
   */
  static parseProviderParams(params) {
    if (!params) {
      return {};
    }

    try {
      const config = {};

      // Manually parse key=value pairs to avoid URLSearchParams treating + as space
      // URLSearchParams follows application/x-www-form-urlencoded (HTML forms)
      // We need RFC 3986 URI parsing where + is literal
      const pairs = params.split('&');

      // eslint-disable-next-line no-restricted-syntax
      for (const pair of pairs) {
        const equalIndex = pair.indexOf('=');

        if (equalIndex === -1) {
          continue; // eslint-disable-line no-continue
        }

        const key = pair.substring(0, equalIndex);
        const value = pair.substring(equalIndex + 1);

        if (key.trim() === '') {
          continue; // eslint-disable-line no-continue
        }

        // decodeURIComponent handles standard percent-encoding (%XX)
        // and treats + as literal character (not space)
        config[key] = decodeURIComponent(value);
      }

      return config;
    } catch (error) {
      throw new Error(`Failed to parse provider parameters: ${error.message}`);
    }
  }

  /**
   * Encode authentication configuration back to repoauth string format
   * Useful for testing and reverse operations
   *
   * @param {object} config - Authentication configuration
   * @returns {string} Encoded repoauth string
   */
  static encode(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }

    if (!config.type) {
      throw new Error('Configuration must have a type field');
    }

    if (config.type === 'basic') {
      if (!config.username || typeof config.username !== 'string') {
        throw new Error('Basic auth requires username');
      }

      const password = config.password || '';
      return `${config.username}:${password}`;
    }

    // Provider-based authentication
    const { type, ...params } = config;

    // Validate provider name
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(type)) {
      throw new Error('Provider name must start with letter and contain only letters, numbers, and hyphens');
    }

    // Build parameter string
    const searchParams = new URLSearchParams();

    // eslint-disable-next-line no-restricted-syntax
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        // Use searchParams which handles encoding properly
        searchParams.append(key, value.toString());
      }
    }

    return `${type}://${searchParams.toString()}`;
  }

  /**
   * Validate authentication configuration object
   *
   * @param {object} config - Authentication configuration to validate
   * @returns {boolean} True if valid
   */
  static validate(config) {
    try {
      // Try to encode - if it succeeds, config is valid
      this.encode(config);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get supported authentication provider types
   *
   * @returns {Array<string>} List of supported provider types
   */
  static getSupportedProviders() {
    return ['basic', 'aws-ecr', 'google-gar', 'azure-acr'];
  }

  /**
   * Check if a provider type is supported
   *
   * @param {string} providerType - Provider type to check
   * @returns {boolean} True if supported
   */
  static isProviderSupported(providerType) {
    return this.getSupportedProviders().includes(providerType);
  }
}

module.exports = { RepoAuthParser };
