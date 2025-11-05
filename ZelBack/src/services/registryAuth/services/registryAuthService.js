/**
 * RegistryAuthService - Clean integration interface for FluxOS services
 *
 * This service provides a simple interface for existing FluxOS code to use
 * the new authentication system without major changes to existing flows.
 *
 * Note: This service is currently unused. Production code uses registryCredentialHelper directly.
 * This remains for potential future use or external integrations.
 */

const { AuthProviderFactory } = require('./authProviderFactory');
const { RepoAuthParser } = require('../utils/repoAuthParser');

class RegistryAuthService {
  // No initialization required for utility service

  /**
   * Extract and prepare credentials from FluxOS app specification
   * This is a utility method for manual credential handling
   *
   * @param {object} appSpec - FluxOS app specification
   * @param {string} componentName - Component name
   * @returns {Promise<object|null>} Extracted credentials or null
   */
  async extractCredentials(appSpec, componentName = null) {
    try {
      // Find the component in the app spec
      const component = this.findComponent(appSpec, componentName);

      if (!component || !component.repoauth) {
        return null;
      }

      // Parse the string credentials into standardized object format
      const credentials = RepoAuthParser.parse(component.repoauth);

      if (!credentials) {
        return null;
      }

      return credentials;
    } catch (error) {
      console.warn('Failed to extract credentials:', error.message);
      return null;
    }
  }

  /**
   * Test authentication configuration without creating a verifier
   *
   * @param {object} authConfig - Authentication configuration
   * @param {string} registryUrl - Registry URL to test
   * @returns {Promise<object>} Test results
   */
  // eslint-disable-next-line class-methods-use-this
  async testAuthentication(authConfig, registryUrl) {
    try {
      const provider = AuthProviderFactory.createProvider(registryUrl, authConfig);

      if (!provider) {
        return {
          success: false,
          error: 'No suitable provider found for configuration',
          provider: null,
        };
      }

      if (!provider.isValidFor(registryUrl)) {
        return {
          success: false,
          error: `Provider ${provider.getProviderName()} not valid for registry ${registryUrl}`,
          provider: provider.getProviderName(),
        };
      }

      // Test connection if provider supports it
      let connectionTest = true;
      if (provider.testConnection) {
        connectionTest = await provider.testConnection();
      }

      // Test credential retrieval
      const credentials = await provider.getCredentials();

      return {
        success: Boolean(connectionTest && credentials),
        provider: provider.getProviderName(),
        authType: provider.getAuthType(),
        config: provider.getSafeConfig ? provider.getSafeConfig() : {},
        connectionTest,
        hasCredentials: Boolean(credentials),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: null,
      };
    }
  }

  /**
   * Convert legacy credential string to modern format
   * Useful for migration and backward compatibility
   *
   * @param {string} credentialString - Legacy "username:password" string
   * @returns {object} Modern credential object
   */
  // eslint-disable-next-line class-methods-use-this
  parseLegacyCredentials(credentialString) {
    try {
      return RepoAuthParser.parse(credentialString);
    } catch (error) {
      console.warn('Failed to parse legacy credentials:', error.message);
      return null;
    }
  }

  /**
   * Get available authentication providers
   *
   * @returns {Array<string>} List of available provider names
   */
  // eslint-disable-next-line class-methods-use-this
  getAvailableProviders() {
    return AuthProviderFactory.getAvailableProviders();
  }

  /**
   * Get provider statistics and information
   *
   * @returns {object} Provider statistics
   */
  // eslint-disable-next-line class-methods-use-this
  getProviderStats() {
    return AuthProviderFactory.getProviderStats();
  }

  /**
   * Create a provider for testing or manual use
   *
   * @param {string} registryUrl - Registry URL
   * @param {object} authConfig - Authentication configuration
   * @returns {object|null} Created provider or null
   */
  // eslint-disable-next-line class-methods-use-this
  createProvider(registryUrl, authConfig) {
    try {
      return AuthProviderFactory.createProvider(registryUrl, authConfig);
    } catch (error) {
      console.warn('Failed to create provider:', error.message);
      return null;
    }
  }

  /**
   * Register a new authentication provider type
   * For future extensibility
   *
   * @param {string} name - Provider name
   * @param {class} providerClass - Provider class
   */
  // eslint-disable-next-line class-methods-use-this
  registerProvider(name, providerClass) {
    AuthProviderFactory.registerProvider(name, providerClass);
  }

  /**
   * Clear provider cache (useful for testing or credential refresh)
   *
   * @param {string} providerName - Specific provider to clear, or all if not specified
   */
  // eslint-disable-next-line class-methods-use-this
  clearProviderCache(providerName = null) {
    AuthProviderFactory.clearProviderCache(providerName);
  }

  /**
   * Utility method to determine if an image tag requires authentication
   * Based on registry patterns and known public registries
   *
   * @param {string} imageTag - Docker image tag
   * @returns {object} Analysis result
   */
  analyzeImageAuthRequirement(imageTag) {
    const registryUrl = this.extractRegistryFromImageTag(imageTag);

    const publicRegistries = [
      'registry-1.docker.io',
      'docker.io',
      'index.docker.io',
    ];

    const privateRegistryPatterns = [
      /\.dkr\.ecr\.[^.]+\.amazonaws\.com$/, // AWS ECR
      /(^|\.)gcr\.io$/, // Google Container Registry
      /\.azurecr\.io$/, // Azure Container Registry
      /\.pkg\.dev$/, // Google Artifact Registry
    ];

    const isPublicRegistry = publicRegistries.includes(registryUrl);
    const isPrivateRegistry = privateRegistryPatterns.some((pattern) => pattern.test(registryUrl));

    let recommendation;
    if (isPrivateRegistry) {
      recommendation = 'Configure authentication';
    } else if (isPublicRegistry) {
      recommendation = 'Authentication optional';
    } else {
      recommendation = 'Unknown registry - authentication may be required';
    }

    return {
      registryUrl,
      likelyRequiresAuth: isPrivateRegistry && !isPublicRegistry,
      isKnownPublic: isPublicRegistry,
      isKnownPrivate: isPrivateRegistry,
      recommendation,
    };
  }

  /**
   * Extract registry URL from image tag
   */
  // eslint-disable-next-line class-methods-use-this
  extractRegistryFromImageTag(imageTag) {
    if (!imageTag || typeof imageTag !== 'string') {
      return null;
    }

    const parts = imageTag.split('/');

    if (parts.length === 1) {
      return 'registry-1.docker.io';
    }

    const firstPart = parts[0];

    if (firstPart.includes('.') || firstPart.includes(':')) {
      return firstPart;
    }

    return 'registry-1.docker.io';
  }

  /**
   * Get service status and configuration
   *
   * @returns {object} Service status
   */
  getStatus() {
    return {
      availableProviders: this.getAvailableProviders(),
      providerStats: this.getProviderStats(),
      version: '1.0.0',
    };
  }

  /**
   * Find a component in the app specification
   * Handles both composed apps and single-component apps
   *
   * @param {object} appSpec - App specification
   * @param {string} componentName - Component name to find
   * @returns {object|null} Component specification or null if not found
   */
  // eslint-disable-next-line class-methods-use-this
  findComponent(appSpec, componentName) {
    if (!appSpec) {
      return null;
    }

    // For composed applications (v4+)
    if (appSpec.compose && Array.isArray(appSpec.compose)) {
      return appSpec.compose.find((c) => c.name === componentName) || null;
    }

    // For single-component apps (v1-v3) or direct component access
    if (!componentName || appSpec.name === componentName) {
      return appSpec;
    }

    return null;
  }

  /**
   * Validate that extracted credentials are in the expected format
   *
   * @param {object} credentials - Parsed credentials object
   * @returns {boolean} True if credentials are valid
   */
  // eslint-disable-next-line class-methods-use-this
  validateCredentials(credentials) {
    if (!credentials || typeof credentials !== 'object') {
      return false;
    }

    // For basic auth, require username and password
    if (credentials.type === 'basic' || (!credentials.type && credentials.username)) {
      return !!(credentials.username && credentials.password);
    }

    // For provider-specific credentials, validate based on type
    if (credentials.type === 'aws-ecr') {
      return !!(credentials.region
                && (credentials.accessKeyId || process.env.AWS_ACCESS_KEY_ID));
    }

    // For object-based credentials without explicit type, check for common fields
    return !!(credentials.username || credentials.accessKeyId || credentials.token);
  }
}

// Create singleton instance
const registryAuthService = new RegistryAuthService();

module.exports = {
  RegistryAuthService,
  registryAuthService, // Singleton instance
};
