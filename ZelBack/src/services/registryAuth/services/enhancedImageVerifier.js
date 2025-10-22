/**
 * EnhancedImageVerifier - Extended version of FluxOS ImageVerifier with authentication provider support
 *
 * This class extends the existing ImageVerifier functionality to support:
 * - Backward compatibility with existing username:password credentials
 * - AWS ECR authentication with automatic token refresh
 * - Future registry providers (Google Cloud, Azure, etc.)
 * - Automatic provider detection based on registry URL
 */

const { AuthProviderFactory } = require('./authProviderFactory');
const { RepoAuthParser } = require('../utils/repoAuthParser');

class EnhancedImageVerifier {
  constructor(imageVerifierClass) {
    this.ImageVerifierClass = imageVerifierClass;
    this.authProvider = null;
    this.registryUrl = null;
  }

  /**
   * Create an ImageVerifier instance with enhanced authentication support
   *
   * @param {string} imageTag - Docker image tag to verify
   * @param {object} options - ImageVerifier options
   * @param {object} authConfig - Authentication configuration (optional)
   * @returns {Promise<object>} Enhanced ImageVerifier instance
   */
  async createVerifier(imageTag, options = {}, authConfig = null) {
    const verifier = new this.ImageVerifierClass(imageTag, options);

    // Store registry URL for provider selection
    this.registryUrl = this.extractRegistryFromImageTag(imageTag);

    // If auth config provided, set up authentication provider
    if (authConfig) {
      this.setupAuthentication(verifier, authConfig);
    }

    return await this.wrapVerifier(verifier);
  }

  /**
   * Create an ImageVerifier from FluxOS app specifications with automatic credential extraction
   *
   * @param {string} imageTag - Docker image tag
   * @param {object} appSpec - FluxOS app specification (may be encrypted)
   * @param {string} componentName - Component name for composed apps
   * @param {object} options - ImageVerifier options
   * @returns {Promise<object>} Enhanced ImageVerifier instance with credentials
   */
  async createVerifierFromAppSpec(imageTag, appSpec, componentName, options = {}) {
    const verifier = new this.ImageVerifierClass(imageTag, options);

    this.registryUrl = this.extractRegistryFromImageTag(imageTag);

    try {
      // Extract credentials directly
      const credentials = this.extractCredentials(appSpec, componentName);

      if (credentials) {
        await this.setupAuthenticationFromCredentials(verifier, credentials);
      }
    } catch (error) {
      console.warn(`Failed to extract credentials for ${imageTag}:`, error.message);
      // Continue without authentication - some registries are public
    }

    return this.wrapVerifier(verifier);
  }

  /**
   * Set up authentication provider from raw configuration
   */
  setupAuthentication(verifier, authConfig) {
    try {
      // Create provider using factory
      this.authProvider = AuthProviderFactory.createProvider(this.registryUrl, authConfig);

      if (this.authProvider) {
        // Validate provider can handle this registry
        if (!this.authProvider.isValidFor(this.registryUrl)) {
          console.warn(`Provider ${this.authProvider.getProviderName()} not valid for ${this.registryUrl}`);
          this.authProvider = null;
          return;
        }

        console.log(`Using ${this.authProvider.getProviderName()} provider for ${this.registryUrl}`);
      }
    } catch (error) {
      console.warn(`Failed to create auth provider for ${this.registryUrl}:`, error.message);
      this.authProvider = null;
    }
  }

  /**
   * Set up authentication from extracted credentials
   */
  async setupAuthenticationFromCredentials(verifier, credentials) {
    try {
      // Validate credentials first
      if (!this.validateCredentials(credentials)) {
        throw new Error('Invalid credential format');
      }

      // Handle backward compatibility - if it's a basic credential string, use old method
      if (typeof credentials === 'string' || (credentials.type === 'basic' && credentials.username)) {
        const credString = typeof credentials === 'string'
          ? credentials
          : `${credentials.username}:${credentials.password}`;

        verifier.addCredentials(credString);
        console.log(`Using basic authentication for ${this.registryUrl}`);
        return;
      }

      // For provider-based credentials, create appropriate provider
      this.authProvider = AuthProviderFactory.createProvider(this.registryUrl, credentials);

      if (this.authProvider) {
        console.log(`Using ${this.authProvider.getProviderName()} provider for ${this.registryUrl}`);
      } else {
        console.warn(`No suitable provider found for credentials type: ${credentials.type || 'unknown'}`);
      }
    } catch (error) {
      console.warn(`Failed to setup authentication from credentials:`, error.message);
      this.authProvider = null;
    }
  }

  /**
   * Wrap the ImageVerifier to add enhanced authentication capabilities
   * This approach pre-configures credentials rather than overriding internal methods
   */
  async wrapVerifier(verifier) {
    // If we have a provider, get credentials and set them up
    if (this.authProvider) {
      try {
        const providerCredentials = await this.authProvider.getCredentials();

        // For all provider types, convert to the format the original ImageVerifier expects
        if (providerCredentials.username && providerCredentials.password) {
          // Use the existing addCredentials method with username:password format
          const credentialString = `${providerCredentials.username}:${providerCredentials.password}`;
          verifier.addCredentials(credentialString);
          console.log(`Applied ${this.authProvider.getProviderName()} credentials to ImageVerifier`);
        } else {
          console.warn(`Provider ${this.authProvider.getProviderName()} returned unsupported credential format`);
        }
      } catch (error) {
        console.warn(`Failed to get credentials from provider: ${error.message}`);
      }
    }

    // Add provider information methods
    verifier.getAuthProvider = () => this.authProvider;
    verifier.getRegistryUrl = () => this.registryUrl;
    verifier.hasEnhancedAuth = () => Boolean(this.authProvider);

    // Add safe configuration logging
    verifier.getAuthConfig = () => {
      if (!this.authProvider) {
        return { provider: 'none', type: 'basic' };
      }

      return this.authProvider.getSafeConfig ? this.authProvider.getSafeConfig() : {
        provider: this.authProvider.getProviderName(),
        type: this.authProvider.getAuthType()
      };
    };

    return verifier;
  }

  /**
   * Extract registry URL from image tag
   */
  extractRegistryFromImageTag(imageTag) {
    if (!imageTag || typeof imageTag !== 'string') {
      return null;
    }

    // Handle various image tag formats
    // Examples:
    // - my-registry.com/namespace/image:tag
    // - 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:latest
    // - gcr.io/project/image:tag
    // - registry-1.docker.io/library/nginx:latest (Docker Hub)

    const parts = imageTag.split('/');

    if (parts.length === 1) {
      // Just image name, likely Docker Hub
      return 'registry-1.docker.io';
    }

    const firstPart = parts[0];

    // Check if first part looks like a registry (contains dots or port)
    if (firstPart.includes('.') || firstPart.includes(':')) {
      return firstPart;
    }

    // Default to Docker Hub for single-part namespaces like "ubuntu" or "nginx"
    return 'registry-1.docker.io';
  }

  /**
   * Test authentication provider connection without full image verification
   *
   * @param {object} authConfig - Authentication configuration to test
   * @param {string} registryUrl - Registry URL to test against
   * @returns {Promise<object>} Test results
   */
  async testAuthProvider(authConfig, registryUrl) {
    try {
      const provider = AuthProviderFactory.createProvider(registryUrl, authConfig);

      if (!provider) {
        return {
          success: false,
          error: 'No suitable provider found for configuration',
          provider: null
        };
      }

      if (!provider.isValidFor(registryUrl)) {
        return {
          success: false,
          error: `Provider ${provider.getProviderName()} not valid for registry ${registryUrl}`,
          provider: provider.getProviderName()
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
        hasCredentials: Boolean(credentials)
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: null
      };
    }
  }

  /**
   * Get statistics about available providers and their capabilities
   *
   * @returns {object} Provider statistics
   */
  getProviderStats() {
    return AuthProviderFactory.getProviderStats();
  }

  /**
   * Extract credentials from app specification
   *
   * @param {object} appSpec - App specification
   * @param {string} componentName - Component name to find
   * @returns {object|null} Parsed credentials or null
   */
  extractCredentials(appSpec, componentName) {
    try {
      // Find the component in the app spec
      const component = this.findComponent(appSpec, componentName);

      if (!component || !component.repoauth) {
        return null;
      }

      // Parse the string credentials into standardized object format
      const credentials = RepoAuthParser.parse(component.repoauth);

      return credentials;
    } catch (error) {
      console.warn('Failed to extract credentials:', error.message);
      return null;
    }
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

module.exports = { EnhancedImageVerifier };