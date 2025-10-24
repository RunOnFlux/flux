/**
 * AuthProviderFactory - Factory for creating and managing authentication providers
 *
 * This factory handles provider registration, auto-detection based on registry URLs,
 * and creation of appropriate providers from various credential formats.
 * It maintains backward compatibility while enabling new provider-based authentication.
 */

const log = require('../../../lib/log');
const { RegistryAuthProvider } = require('../providers/base/registryAuthProvider');
const { BasicAuthProvider } = require('../providers/basicAuthProvider');

class AuthProviderFactory {
  // Registry of available provider classes
  static providers = new Map();

  // Cache for provider instances to avoid recreating them
  static providerCache = new Map();

  /**
   * Register a new authentication provider class
   *
   * @param {string} name - Unique name for the provider
   * @param {class} providerClass - Provider class (must extend RegistryAuthProvider)
   */
  static registerProvider(name, providerClass) {
    if (!name || typeof name !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    if (!providerClass || typeof providerClass !== 'function') {
      throw new Error('Provider class must be a constructor function');
    }

    // Validate that the provider extends RegistryAuthProvider
    if (!this.isValidProviderClass(providerClass)) {
      throw new Error(`Provider class ${providerClass.name} must extend RegistryAuthProvider`);
    }

    this.providers.set(name.toLowerCase(), providerClass);
  }

  /**
   * Unregister a provider
   *
   * @param {string} name - Provider name to remove
   */
  static unregisterProvider(name) {
    if (name && typeof name === 'string') {
      this.providers.delete(name.toLowerCase());
      // Also clear any cached instances
      this.clearProviderCache(name);
    }
  }

  /**
   * Get list of registered provider names
   *
   * @returns {Array<string>} Array of provider names
   */
  static getAvailableProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * Create an authentication provider based on registry URL and credentials
   * This is the main entry point for provider creation
   *
   * @param {string} registryUrl - Registry URL to authenticate with
   * @param {string|object} authConfig - Authentication configuration
   * @returns {RegistryAuthProvider|null} Appropriate provider or null
   * @throws {Error} If provider configuration is invalid
   */
  static createProvider(registryUrl, authConfig) {
    if (!authConfig) {
      return null;
    }

    try {
      // Handle legacy string format (username:password)
      if (typeof authConfig === 'string') {
        return this.createBasicAuthProvider(authConfig);
      }

      // Handle object-based configuration
      if (typeof authConfig === 'object') {
        return this.createProviderFromObject(registryUrl, authConfig);
      }

      return null;
    } catch (error) {
      // Re-throw configuration/validation errors with full context
      // Only swallow errors for truly unknown/unavailable providers
      if (error.message.includes('Unknown provider type')) {
        log.warn(`Failed to create auth provider: ${error.message}`);
        return null;
      }

      // Propagate validation errors (invalid config, parsing errors, etc.)
      throw error;
    }
  }

  /**
   * Create provider from object configuration
   *
   * @param {string} registryUrl - Registry URL
   * @param {object} authConfig - Object configuration
   * @returns {RegistryAuthProvider|null} Created provider
   */
  static createProviderFromObject(registryUrl, authConfig) {
    // Explicit provider type specified
    if (authConfig.type) {
      return this.createExplicitProvider(authConfig.type, authConfig, registryUrl);
    }

    // Auto-detect provider based on registry URL
    const autoDetectedProvider = this.autoDetectProvider(registryUrl, authConfig);
    if (autoDetectedProvider) {
      return autoDetectedProvider;
    }

    // Fallback to basic auth if username/password provided
    if (authConfig.username && authConfig.password) {
      return BasicAuthProvider.fromCredentialsObject(authConfig);
    }

    return null;
  }

  /**
   * Create provider with explicit type
   *
   * @param {string} providerType - Explicit provider type
   * @param {object} config - Provider configuration
   * @param {string} [registryUrl] - Optional registry URL for extracting metadata
   * @returns {RegistryAuthProvider|null} Created provider
   */
  static createExplicitProvider(providerType, config, registryUrl = null) {
    const ProviderClass = this.providers.get(providerType.toLowerCase());
    if (!ProviderClass) {
      throw new Error(`Unknown provider type: ${providerType}`);
    }

    // Handle special cases for providers that don't use standard config object constructor
    if (providerType.toLowerCase() === 'basic') {
      const provider = BasicAuthProvider.fromCredentialsObject(config);
      provider.registeredName = providerType.toLowerCase();
      return provider;
    }

    // Add registry URL to config if provided and not already present
    const configWithRegistry = registryUrl && !config.registry
      ? { ...config, registry: registryUrl }
      : config;

    const provider = new ProviderClass(configWithRegistry);
    provider.registeredName = providerType.toLowerCase();
    return provider;
  }

  /**
   * Auto-detect appropriate provider based on registry URL
   *
   * @param {string} registryUrl - Registry URL
   * @param {object} authConfig - Authentication configuration
   * @returns {RegistryAuthProvider|null} Detected provider
   */
  static autoDetectProvider(registryUrl, authConfig) {
    if (!registryUrl || !RegistryAuthProvider.isValidRegistryUrl(registryUrl)) {
      return null;
    }

    // Try each registered provider to see if it can handle this registry
    for (const [name, ProviderClass] of this.providers) {
      try {
        const instance = new ProviderClass(authConfig);
        instance.registeredName = name;

        // Check if provider supports this registry and has valid config
        if (instance.isValidFor(registryUrl) && instance.validateConfiguration()) {
          return instance;
        }
      } catch (error) {
        // If provider construction fails, try the next one
        log.debug(`Provider ${name} failed for ${registryUrl}: ${error.message}`);
        continue;
      }
    }

    return null;
  }

  /**
   * Create basic auth provider from string credentials
   *
   * @param {string} credentialString - Credentials in "username:password" format
   * @returns {BasicAuthProvider} Basic auth provider
   */
  static createBasicAuthProvider(credentialString) {
    return BasicAuthProvider.fromCredentialString(credentialString);
  }

  /**
   * Validate that a class is a proper provider class
   *
   * @param {function} providerClass - Class to validate
   * @returns {boolean} True if valid provider class
   */
  static isValidProviderClass(providerClass) {
    try {
      // Check if it's a constructor function
      if (typeof providerClass !== 'function') {
        return false;
      }

      // Create a temporary instance to test the interface
      const testInstance = Object.create(providerClass.prototype);

      // Check for required methods
      const requiredMethods = ['getCredentials', 'isValidFor', 'validateConfiguration'];
      return requiredMethods.every(method => typeof testInstance[method] === 'function');
    } catch (error) {
      return false;
    }
  }

  /**
   * Get cached provider instance or create new one
   *
   * @param {string} cacheKey - Cache key for the provider
   * @param {function} createFn - Function to create provider if not cached
   * @returns {RegistryAuthProvider|null} Provider instance
   */
  static getCachedProvider(cacheKey, createFn) {
    if (this.providerCache.has(cacheKey)) {
      return this.providerCache.get(cacheKey);
    }

    const provider = createFn();
    if (provider) {
      this.providerCache.set(cacheKey, provider);
    }

    return provider;
  }

  /**
   * Clear provider cache for a specific provider or all providers
   *
   * @param {string} [providerName] - Specific provider to clear, or all if not specified
   */
  static clearProviderCache(providerName = null) {
    if (providerName) {
      // Clear cache entries for specific provider
      for (const [key, provider] of this.providerCache) {
        if (provider.getProviderName() === providerName.toLowerCase()) {
          this.providerCache.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.providerCache.clear();
    }
  }

  /**
   * Reset factory to initial state (for testing)
   * This clears all registered providers and re-registers built-ins
   */
  static resetToDefaults() {
    this.providers.clear();
    this.providerCache.clear();

    // Re-register built-in providers
    this.registerProvider('basic', BasicAuthProvider);

    // Register AWS ECR provider if available
    try {
      const { AwsEcrAuthProvider } = require('../providers/awsEcrAuthProvider');
      this.registerProvider('aws-ecr', AwsEcrAuthProvider);
    } catch (error) {
      // AWS SDK not available, skip registration
    }

    // Register Google GAR provider if available
    try {
      const { GoogleGarAuthProvider } = require('../providers/googleGarAuthProvider');
      this.registerProvider('google-gar', GoogleGarAuthProvider);
    } catch (error) {
      // Google Auth Library not available, skip registration
    }

    // Register Azure ACR provider if available
    try {
      const { AzureAcrAuthProvider } = require('../providers/azureAcrAuthProvider');
      this.registerProvider('azure-acr', AzureAcrAuthProvider);
    } catch (error) {
      // Azure Identity library not available, skip registration
    }
  }

  /**
   * Create a cache key for provider instances
   *
   * @param {string} registryUrl - Registry URL
   * @param {object} config - Provider configuration
   * @returns {string} Cache key
   */
  static createCacheKey(registryUrl, config) {
    // Create a stable cache key from registry URL and config
    const configStr = JSON.stringify(config, Object.keys(config).sort());
    return `${registryUrl}:${Buffer.from(configStr).toString('base64')}`;
  }

  /**
   * Get provider statistics and information
   *
   * @returns {object} Provider statistics
   */
  static getProviderStats() {
    return {
      registeredProviders: this.getAvailableProviders(),
      cachedInstances: this.providerCache.size,
      totalProviders: this.providers.size
    };
  }

  /**
   * Test a provider configuration without creating a full instance
   *
   * @param {string} providerType - Provider type to test
   * @param {object} config - Configuration to test
   * @returns {object} Test results
   */
  static testProviderConfig(providerType, config) {
    try {
      const ProviderClass = this.providers.get(providerType.toLowerCase());
      if (!ProviderClass) {
        return {
          valid: false,
          error: `Unknown provider type: ${providerType}`
        };
      }

      const instance = new ProviderClass(config);
      const isValid = instance.validateConfiguration();

      return {
        valid: isValid,
        providerName: instance.getProviderName(),
        authType: instance.getAuthType(),
        error: isValid ? null : 'Configuration validation failed'
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }
}

// Register built-in providers
AuthProviderFactory.registerProvider('basic', BasicAuthProvider);

// Register AWS ECR provider if AWS SDK is available
try {
  const { AwsEcrAuthProvider } = require('../providers/awsEcrAuthProvider');
  AuthProviderFactory.registerProvider('aws-ecr', AwsEcrAuthProvider);
} catch (error) {
  // AWS SDK not available, skip registration
  log.debug('AWS ECR provider not available: AWS SDK not installed');
}

// Register Google GAR provider if Google Auth Library is available
try {
  const { GoogleGarAuthProvider } = require('../providers/googleGarAuthProvider');
  AuthProviderFactory.registerProvider('google-gar', GoogleGarAuthProvider);
} catch (error) {
  // Google Auth Library not available, skip registration
  log.debug('Google GAR provider not available: google-auth-library not installed');
}

// Register Azure ACR provider if Azure Identity library is available
try {
  const { AzureAcrAuthProvider } = require('../providers/azureAcrAuthProvider');
  AuthProviderFactory.registerProvider('azure-acr', AzureAcrAuthProvider);
} catch (error) {
  // Azure Identity library not available, skip registration
  log.debug('Azure ACR provider not available: @azure/identity not installed');
}

module.exports = { AuthProviderFactory };