/**
 * Registry Credential Helper
 *
 * Provides a unified interface for handling Docker registry credentials
 * across different FluxOS app versions and authentication providers.
 *
 * Key features:
 * - Version-aware decryption (v7: PGP encrypted, v8+: plain text from enterprise blob)
 * - Supports multiple authentication types (basic, AWS ECR, Azure ACR, Google GAR)
 * - Automatic token caching for cloud providers (12hr AWS, 3hr Azure, 1hr Google)
 * - Reuses ImageVerifier's registry parsing logic
 */

const pgpService = require('../pgpService');
const { ImageVerifier } = require('./imageVerifier');
const { RepoAuthParser } = require('../registryAuth/utils/repoAuthParser');
const { AuthProviderFactory } = require('../registryAuth/services/authProviderFactory');

/**
 * Get credentials for docker registry authentication
 *
 * @param {string} repotag - Docker image tag (e.g., "nginx:latest" or "123.dkr.ecr.us-east-1.amazonaws.com/app:v1")
 * @param {string} repoauth - Authentication string (encrypted for v7, plain for v8+)
 * @param {number} appVersion - Application specification version (7, 8, etc.)
 * @returns {Promise<{username: string, password: string}|null>} Credentials object or null if no auth
 * @throws {Error} If decryption fails or credentials are invalid
 */
async function getCredentials(repotag, repoauth, appVersion) {
  // No authentication needed
  if (!repoauth) {
    return null;
  }

  // Version-aware decryption
  let plainRepoauth;
  if (appVersion === 7 || appVersion < 7) {
    // v7 and earlier: repoauth is PGP encrypted
    plainRepoauth = await pgpService.decryptMessage(repoauth);

    if (!plainRepoauth) {
      throw new Error('Unable to decrypt provided credentials');
    }
  } else {
    // v8+: repoauth is already plain text (was inside encrypted enterprise blob)
    // The enterprise blob was decrypted by checkAndDecryptAppSpecs() earlier
    plainRepoauth = repoauth;
  }

  // Parse the authentication string
  // Supports both legacy "username:password" and new "provider://params" formats
  const authConfig = RepoAuthParser.parse(plainRepoauth);
  if (!authConfig) {
    return null;
  }

  // Basic authentication - return directly
  if (authConfig.type === 'basic') {
    return {
      username: authConfig.username,
      password: authConfig.password,
    };
  }

  // Cloud provider authentication - create provider and get credentials
  // Use ImageVerifier to extract registry URL (reuses existing parsing logic)
  const imgVerifier = new ImageVerifier(repotag, {});
  const registryUrl = imgVerifier.provider;

  // Create appropriate provider based on auth config and registry URL
  // This will throw detailed validation errors if configuration is invalid
  const provider = AuthProviderFactory.createProvider(registryUrl, authConfig);

  if (!provider) {
    throw new Error(
      `Failed to create authentication provider for type: ${authConfig.type}. ` +
      `Registry: ${registryUrl}. Ensure the provider is registered and configuration is valid.`
    );
  }

  // Get credentials from provider (with automatic caching)
  // AWS ECR: 12-hour cache
  // Azure ACR: 3-hour cache
  // Google GAR: 1-hour cache
  return await provider.getCredentials();
}

module.exports = {
  getCredentials,
};
