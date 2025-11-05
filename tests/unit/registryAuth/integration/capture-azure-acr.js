#!/usr/bin/env node

/**
 * Azure ACR API Response Capture Script
 *
 * This script makes a real API call to Azure Identity to capture the getToken
 * response structure. The captured response is sanitized (sensitive data replaced)
 * and saved as a JSON fixture for use in unit tests.
 *
 * Usage:
 *   node integration/capture-azure-acr.js [repoAuthString]
 *
 * Command-line argument (optional):
 *   repoAuthString - Azure ACR auth in format:
 *     "azure-acr://clientId=ID&clientSecret=SECRET&tenantId=TENANT_ID&registryName=NAME"
 *
 * Environment variables (fallback if no CLI arg):
 *   AZURE_TENANT_ID - Azure tenant ID
 *   AZURE_CLIENT_ID - Azure client/application ID
 *   AZURE_CLIENT_SECRET - Azure client secret
 *   AZURE_REGISTRY_NAME - Azure container registry name (e.g., myregistry)
 */

const fs = require('fs');
const path = require('path');
// eslint-disable-next-line import/no-unresolved
const { ClientSecretCredential } = require('@azure/identity');
// eslint-disable-next-line import/extensions, import/no-unresolved
const { RepoAuthParser } = require('../src/utils/repoAuthParser');

// Load environment variables from .env.test if available
try {
  // eslint-disable-next-line import/no-extraneous-dependencies, global-require
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });
} catch (e) {
  // dotenv not available, use system environment variables
}

class AzureACRCapture {
  constructor(options = {}) {
    this.fixturesDir = path.join(__dirname, 'fixtures');
    this.outputFile = path.join(this.fixturesDir, 'azure-acr-response.json');
    this.noSanitize = options.noSanitize || false;
    this.repoAuthString = options.repoAuthString || null;
    this.config = this.loadConfig();
  }

  loadConfig() {
    // Try CLI argument first (repoAuth string)
    if (this.repoAuthString) {
      try {
        console.log('📝 Parsing repoAuth string from command-line argument...');
        const authConfig = RepoAuthParser.parse(this.repoAuthString);

        if (authConfig.type !== 'azure-acr') {
          throw new Error(`Expected azure-acr provider, got: ${authConfig.type}`);
        }

        if (!authConfig.clientId || !authConfig.clientSecret || !authConfig.tenantId) {
          throw new Error('Missing required parameters: clientId, clientSecret, and tenantId');
        }

        console.log(`   ✓ Provider: ${authConfig.type}`);
        console.log(`   ✓ Tenant ID: ${authConfig.tenantId}`);
        console.log(`   ✓ Registry: ${authConfig.registryName || 'not specified'}`);

        return {
          tenantId: authConfig.tenantId,
          clientId: authConfig.clientId,
          clientSecret: authConfig.clientSecret,
          registryName: authConfig.registryName,
        };
      } catch (error) {
        console.error('❌ Failed to parse repoAuth string:', error.message);
        process.exit(1);
      }
    }

    // Fall back to environment variables
    const required = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_REGISTRY_NAME'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:', missing.join(', '));
      console.error('Please set these in .env.test or as environment variables.');
      console.error('Or provide repoAuth string as command-line argument:');
      console.error('  node capture-azure-acr.js "azure-acr://clientId=ID&clientSecret=SECRET&tenantId=TENANT_ID&registryName=NAME"');
      process.exit(1);
    }

    return {
      tenantId: process.env.AZURE_TENANT_ID,
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      registryName: process.env.AZURE_REGISTRY_NAME,
    };
  }

  /**
   * Make real API call to Azure Identity
   */
  async fetchRealResponse() {
    console.log('📡 Making real API call to Azure Identity...');
    console.log(`   Tenant ID: ${this.config.tenantId}`);
    console.log(`   Registry: ${this.config.registryName}`);

    const credential = new ClientSecretCredential(
      this.config.tenantId,
      this.config.clientId,
      this.config.clientSecret,
    );

    try {
      const startTime = Date.now();
      const tokenResponse = await credential.getToken([
        'https://management.azure.com/.default',
      ]);
      const duration = Date.now() - startTime;

      console.log(`✅ API call successful (${duration}ms)`);
      console.log(`   Token length: ${tokenResponse.token.length} characters`);
      console.log(`   Expires on: ${new Date(tokenResponse.expiresOnTimestamp).toISOString()}`);

      return tokenResponse;
    } catch (error) {
      console.error('❌ API call failed:', error.message);
      throw error;
    }
  }

  /**
   * Sanitize response by replacing sensitive data while preserving exact structure
   */
  sanitizeResponse(response) {
    console.log('🔒 Sanitizing response data...');

    // Create mock token with same length characteristics
    const mockToken = `MOCK_AZURE_ACCESS_TOKEN_${'X'.repeat(Math.min(response.token.length - 30, 1500))}`;

    // Set expiry to a random time in the future (between 1-7 days)
    const now = Date.now();
    const randomHours = Math.random() * 6 * 24 + 24; // 1-7 days in hours
    const futureExpiry = now + randomHours * 60 * 60 * 1000;

    // Create sanitized response with EXACT same structure as raw API response
    const sanitizedApiResponse = {
      token: mockToken,
      expiresOnTimestamp: futureExpiry,
    };

    const metadata = {
      capturedAt: new Date().toISOString(),
      provider: 'azure-acr',
      apiCall: 'ClientSecretCredential.getToken',
      registryName: this.config.registryName,
      tenantId: this.config.tenantId,
      sanitized: true,
      sanitizedFields: ['token', 'expiresOnTimestamp'],
      notes: 'Access token replaced with mock data of similar length. Expiry set to a random time between 1-7 days in the future.',
      originalTokenLength: response.token.length,
    };

    console.log('   ✓ Token sanitized');
    console.log(`   ✓ Token length: ${response.token.length} chars`);
    console.log(`   ✓ Expiry adjusted to ${new Date(futureExpiry).toISOString()}`);

    return { apiResponse: sanitizedApiResponse, fixtureMetadata: metadata };
  }

  /**
   * Save sanitized response to JSON file
   */
  saveFixture(apiResponse, fixtureMetadata) {
    console.log('💾 Saving fixture to file...');

    const fixture = {
      apiResponse,
      fixtureMetadata,
    };

    // Ensure fixtures directory exists
    if (!fs.existsSync(this.fixturesDir)) {
      fs.mkdirSync(this.fixturesDir, { recursive: true });
    }

    fs.writeFileSync(this.outputFile, JSON.stringify(fixture, null, 2), 'utf-8');

    console.log(`✅ Fixture saved to: ${this.outputFile}`);
    console.log('   File size:', fs.statSync(this.outputFile).size, 'bytes');
  }

  /**
   * Run the full capture process
   */
  async run() {
    console.log('🚀 Azure ACR API Response Capture');
    console.log('==================================\n');

    if (this.noSanitize) {
      console.log('⚠️  NO SANITIZATION MODE - Real data will be displayed!');
      console.log('   (Data will NOT be saved to disk)\n');
    }

    try {
      // Fetch real response
      const realResponse = await this.fetchRealResponse();

      if (this.noSanitize) {
        // Display real response without sanitization
        console.log('\n📋 RAW API RESPONSE (UNSANITIZED):');
        console.log('==================================');
        console.log(JSON.stringify(realResponse, null, 2));

        // Display decoded token details
        console.log('\n📋 TOKEN DETAILS:');
        console.log('==================================');
        console.log('Access Token (first 100 chars):', `${realResponse.token.substring(0, 100)}...`);
        console.log('Token length:', realResponse.token.length, 'characters');
        console.log('Full token:', realResponse.token);
        console.log('Expires on:', new Date(realResponse.expiresOnTimestamp).toISOString());

        console.log('\n⚠️  Response displayed but NOT saved (no-sanitize mode)');
        return true;
      }

      // Sanitize response
      const { apiResponse, fixtureMetadata } = this.sanitizeResponse(realResponse);

      // Save fixture
      this.saveFixture(apiResponse, fixtureMetadata);

      console.log('\n✨ Capture complete!');
      console.log('   You can now use this fixture in unit tests.');
      console.log('   Import: require(\'./integration/fixtures/azure-acr-response.json\')');

      return true;
    } catch (error) {
      console.error('\n❌ Capture failed:', error.message);
      return false;
    }
  }
}

// Run if executed directly
if (require.main === module) {
  // Check for --no-sanitize flag
  const noSanitize = process.argv.includes('--no-sanitize');

  // Get repoAuth string from first positional argument (skip node, script name, and flags)
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const repoAuthString = args[0] || null;

  const capture = new AzureACRCapture({ noSanitize, repoAuthString });
  capture.run().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { AzureACRCapture };
