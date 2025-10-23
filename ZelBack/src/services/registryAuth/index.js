/**
 * FluxOS Docker Registry Authentication Integration Layer
 *
 * Main entry point that exports all public APIs for authentication integration
 */

// Services
const { registryAuthService } = require('./services/registryAuthService');
const { AuthProviderFactory } = require('./services/authProviderFactory');

// Providers
const { RegistryAuthProvider } = require('./providers/base/registryAuthProvider');
const { BasicAuthProvider } = require('./providers/basicAuthProvider');
const { AwsEcrAuthProvider } = require('./providers/awsEcrAuthProvider');
const { GoogleGarAuthProvider } = require('./providers/googleGarAuthProvider');
const { AzureAcrAuthProvider } = require('./providers/azureAcrAuthProvider');

// Utilities
const { RepoAuthParser } = require('./utils/repoAuthParser');

module.exports = {
  // Main service for FluxOS integration
  registryAuthService,

  // Factory for creating providers
  AuthProviderFactory,

  // Base provider class (for extending)
  RegistryAuthProvider,

  // Concrete provider implementations
  BasicAuthProvider,
  AwsEcrAuthProvider,
  GoogleGarAuthProvider,
  AzureAcrAuthProvider,

  // Utility for parsing repoauth strings
  RepoAuthParser
};