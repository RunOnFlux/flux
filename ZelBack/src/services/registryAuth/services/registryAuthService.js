/**
 * RegistryAuthService - Clean integration interface for FluxOS services
 *
 * This service provides a simple interface for existing FluxOS code to use
 * the new authentication system without major changes to existing flows.
 */

const { EnhancedImageVerifier } = require('./enhancedImageVerifier');
const { AuthProviderFactory } = require('./authProviderFactory');
const { RepoAuthParser } = require('../utils/repoAuthParser');

class RegistryAuthService {
  constructor() {
    this.enhancedVerifier = null;
    this.initialized = false;
  }

  /**
   * Initialize the service with the FluxOS ImageVerifier class
   *
   * @param {class} imageVerifierClass - The FluxOS ImageVerifier class
   */
  initialize(imageVerifierClass) {
    if (!imageVerifierClass) {
      throw new Error('ImageVerifier class is required for initialization');
    }

    this.enhancedVerifier = new EnhancedImageVerifier(imageVerifierClass);
    this.initialized = true;
  }

  /**
   * Create an ImageVerifier with enhanced authentication - replacement for existing FluxOS usage
   *
   * @param {string} imageTag - Docker image tag
   * @param {object} appSpec - FluxOS app specification
   * @param {string} componentName - Component name (for composed apps)
   * @param {object} options - ImageVerifier options
   * @returns {Promise<object>} Enhanced ImageVerifier instance
   */
  async createVerifierFromAppSpec(imageTag, appSpec, componentName = null, options = {}) {
    this.ensureInitialized();

    return await this.enhancedVerifier.createVerifierFromAppSpec(
      imageTag,
      appSpec,
      componentName,
      options
    );
  }

  /**
   * Create an ImageVerifier with explicit authentication config
   *
   * @param {string} imageTag - Docker image tag
   * @param {object} authConfig - Authentication configuration
   * @param {object} options - ImageVerifier options
   * @returns {Promise<object>} Enhanced ImageVerifier instance
   */
  async createVerifierWithAuth(imageTag, authConfig, options = {}) {
    this.ensureInitialized();

    return await this.enhancedVerifier.createVerifier(imageTag, options, authConfig);
  }

  /**
   * Create an ImageVerifier without authentication (for public registries)
   *
   * @param {string} imageTag - Docker image tag
   * @param {object} options - ImageVerifier options
   * @returns {Promise<object>} Standard ImageVerifier instance
   */
  async createVerifier(imageTag, options = {}) {
    this.ensureInitialized();

    return await this.enhancedVerifier.createVerifier(imageTag, options);
  }

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
  async testAuthentication(authConfig, registryUrl) {
    this.ensureInitialized();

    return await this.enhancedVerifier.testAuthProvider(authConfig, registryUrl);
  }

  /**
   * Convert legacy credential string to modern format
   * Useful for migration and backward compatibility
   *
   * @param {string} credentialString - Legacy "username:password" string
   * @returns {object} Modern credential object
   */
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
  getAvailableProviders() {
    return AuthProviderFactory.getAvailableProviders();
  }

  /**
   * Get provider statistics and information
   *
   * @returns {object} Provider statistics
   */
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
  registerProvider(name, providerClass) {
    AuthProviderFactory.registerProvider(name, providerClass);
  }

  /**
   * Clear provider cache (useful for testing or credential refresh)
   *
   * @param {string} providerName - Specific provider to clear, or all if not specified
   */
  clearProviderCache(providerName = null) {
    AuthProviderFactory.clearProviderCache(providerName);
  }

  /**
   * Enhanced wrapper for backward compatibility with existing FluxOS code patterns
   * This method mirrors the existing appsService pattern while adding provider support
   *
   * @param {string} imageTag - Docker image tag
   * @param {object} appSpec - App specification
   * @param {string} componentName - Component name
   * @param {object} verifierOptions - ImageVerifier options
   * @returns {Promise<object>} Result with verifier and auth info
   */
  async prepareImageVerificationWithAuth(imageTag, appSpec, componentName = null, verifierOptions = {}) {
    this.ensureInitialized();

    try {
      // Create enhanced verifier
      const verifier = await this.createVerifierFromAppSpec(
        imageTag,
        appSpec,
        componentName,
        verifierOptions
      );

      // Extract auth information for logging/debugging
      const authConfig = verifier.getAuthConfig();
      const registryUrl = verifier.getRegistryUrl();
      const hasEnhancedAuth = verifier.hasEnhancedAuth();

      return {
        verifier,
        authInfo: {
          registryUrl,
          provider: authConfig.provider,
          authType: authConfig.type,
          hasEnhancedAuth,
          safeConfig: authConfig
        },
        success: true
      };

    } catch (error) {
      return {
        verifier: null,
        authInfo: null,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Utility method to determine if an image tag requires authentication
   * Based on registry patterns and known public registries
   *
   * @param {string} imageTag - Docker image tag
   * @returns {object} Analysis result
   */
  analyzeImageAuthRequirement(imageTag) {
    const registryUrl = this.enhancedVerifier ?
      this.enhancedVerifier.extractRegistryFromImageTag(imageTag) :
      this.extractRegistryFromImageTag(imageTag);

    const publicRegistries = [
      'registry-1.docker.io',
      'docker.io',
      'index.docker.io'
    ];

    const privateRegistryPatterns = [
      /\.dkr\.ecr\.[^.]+\.amazonaws\.com$/, // AWS ECR
      /(^|\.)gcr\.io$/, // Google Container Registry
      /\.azurecr\.io$/, // Azure Container Registry
      /\.pkg\.dev$/ // Google Artifact Registry
    ];

    const isPublicRegistry = publicRegistries.includes(registryUrl);
    const isPrivateRegistry = privateRegistryPatterns.some(pattern => pattern.test(registryUrl));

    return {
      registryUrl,
      likelyRequiresAuth: isPrivateRegistry && !isPublicRegistry,
      isKnownPublic: isPublicRegistry,
      isKnownPrivate: isPrivateRegistry,
      recommendation: isPrivateRegistry ? 'Configure authentication' :
                    isPublicRegistry ? 'Authentication optional' :
                    'Unknown registry - authentication may be required'
    };
  }

  /**
   * Fallback method for registry extraction if enhancedVerifier not available
   */
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
   * Ensure service is initialized before use
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('RegistryAuthService must be initialized with ImageVerifier class before use');
    }
  }

  /**
   * Get service status and configuration
   *
   * @returns {object} Service status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      availableProviders: this.initialized ? this.getAvailableProviders() : [],
      providerStats: this.initialized ? this.getProviderStats() : null,
      version: '1.0.0'
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
  findComponent(appSpec, componentName) {
    if (!appSpec) {
      return null;
    }

    // For composed applications (v4+)
    if (appSpec.compose && Array.isArray(appSpec.compose)) {
      return appSpec.compose.find(c => c.name === componentName) || null;
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
      return !!(credentials.region &&
                (credentials.accessKeyId || process.env.AWS_ACCESS_KEY_ID));
    }

    // For object-based credentials without explicit type, check for common fields
    return !!(credentials.username || credentials.accessKeyId || credentials.token);
  }
}

// Create singleton instance
const registryAuthService = new RegistryAuthService();

module.exports = {
  RegistryAuthService,
  registryAuthService // Singleton instance
};