#!/usr/bin/env node

/**
 * Google Artifact Registry API Response Capture Script
 *
 * This script makes a real API call to Google Auth Library to capture the
 * getAccessToken response structure. The captured response is sanitized
 * (sensitive data replaced) and saved as a JSON fixture for use in unit tests.
 *
 * Usage:
 *   node integration/capture-google-gar.js [repoAuthString]
 *
 * Command-line argument (optional):
 *   repoAuthString - Google GAR auth in format:
 *     "google-gar://keyFile=BASE64_ENCODED_JSON"
 *
 * Environment variables (fallback if no CLI arg):
 *   GOOGLE_CLIENT_EMAIL - Service account email
 *   GOOGLE_PRIVATE_KEY - Service account private key (full PEM format)
 *   GOOGLE_PROJECT_ID - Google Cloud project ID
 */

const fs = require('fs');
const path = require('path');
// eslint-disable-next-line import/no-unresolved
const { JWT } = require('google-auth-library');
// eslint-disable-next-line import/extensions, import/no-unresolved
const { RepoAuthParser } = require('../src/utils/repoAuthParser');

// Load environment variables from .env.test if available
try {
  // eslint-disable-next-line import/no-extraneous-dependencies, global-require
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });
} catch (e) {
  // dotenv not available, use system environment variables
}

class GoogleGARCapture {
  constructor(options = {}) {
    this.fixturesDir = path.join(__dirname, 'fixtures');
    this.outputFile = path.join(this.fixturesDir, 'google-gar-response.json');
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

        if (authConfig.type !== 'google-gar') {
          throw new Error(`Expected google-gar provider, got: ${authConfig.type}`);
        }

        // Handle keyFile parameter (base64-encoded service account JSON)
        if (authConfig.keyFile) {
          console.log('   ✓ Decoding keyFile parameter...');
          const keyFileJson = Buffer.from(authConfig.keyFile, 'base64').toString('utf-8');
          const keyFileData = JSON.parse(keyFileJson);

          if (!keyFileData.private_key || !keyFileData.client_email) {
            throw new Error('keyFile must contain private_key and client_email');
          }

          console.log(`   ✓ Provider: ${authConfig.type}`);
          console.log(`   ✓ Client email: ${keyFileData.client_email}`);
          console.log(`   ✓ Project ID: ${keyFileData.project_id || 'not specified'}`);

          return {
            clientEmail: keyFileData.client_email,
            privateKey: keyFileData.private_key,
            projectId: keyFileData.project_id || authConfig.projectId,
          };
        }

        // Handle separate privateKey and clientEmail parameters (fallback)
        if (authConfig.privateKey && authConfig.clientEmail) {
          console.log(`   ✓ Provider: ${authConfig.type}`);
          console.log(`   ✓ Client email: ${authConfig.clientEmail}`);

          return {
            clientEmail: authConfig.clientEmail,
            privateKey: authConfig.privateKey,
            projectId: authConfig.projectId,
          };
        }

        throw new Error('Missing required parameters: either keyFile or (privateKey + clientEmail)');
      } catch (error) {
        console.error('❌ Failed to parse repoAuth string:', error.message);
        process.exit(1);
      }
    }

    // Fall back to environment variables
    const required = ['GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_PROJECT_ID'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:', missing.join(', '));
      console.error('Please set these in .env.test or as environment variables.');
      console.error('Or provide repoAuth string as command-line argument:');
      console.error('  node capture-google-gar.js "google-gar://keyFile=BASE64_ENCODED_JSON"');
      process.exit(1);
    }

    return {
      clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
      privateKey: process.env.GOOGLE_PRIVATE_KEY,
      projectId: process.env.GOOGLE_PROJECT_ID,
    };
  }

  /**
   * Make real API call to Google Auth Library
   */
  async fetchRealResponse() {
    console.log('📡 Making real API call to Google Auth Library...');
    console.log(`   Client email: ${this.config.clientEmail}`);
    console.log(`   Project ID: ${this.config.projectId}`);

    const jwtClient = new JWT({
      email: this.config.clientEmail,
      key: this.config.privateKey,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    try {
      const startTime = Date.now();
      const tokenResponse = await jwtClient.getAccessToken();
      const duration = Date.now() - startTime;

      console.log(`✅ API call successful (${duration}ms)`);
      console.log(`   Token length: ${tokenResponse.token.length} characters`);
      console.log(`   Expiry: ${new Date(jwtClient.credentials.expiry_date).toISOString()}`);

      return {
        token: tokenResponse.token,
        credentials: jwtClient.credentials,
      };
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
    const mockToken = `ya29.MOCK_GOOGLE_ACCESS_TOKEN_${'X'.repeat(Math.min(response.token.length - 40, 500))}`;

    // Set expiry to a random time in the future (between 1-7 days)
    const now = Date.now();
    const randomHours = Math.random() * 6 * 24 + 24; // 1-7 days in hours
    const futureExpiry = now + randomHours * 60 * 60 * 1000;

    // Create sanitized response with EXACT same structure as raw API response
    const sanitizedApiResponse = {
      token: mockToken,
      credentials: {
        access_token: mockToken,
        token_type: response.credentials.token_type || 'Bearer',
        expiry_date: futureExpiry,
        refresh_token: response.credentials.refresh_token || null,
      },
    };

    const metadata = {
      capturedAt: new Date().toISOString(),
      provider: 'google-gar',
      apiCall: 'JWT.getAccessToken',
      projectId: this.config.projectId,
      clientEmail: this.config.clientEmail,
      sanitized: true,
      sanitizedFields: ['token', 'credentials.access_token', 'credentials.expiry_date'],
      notes: 'Access token replaced with mock data of similar length. Expiry set to a random time between 1-7 days in the future.',
      originalTokenLength: response.token.length,
      tokenType: response.credentials.token_type,
    };

    console.log('   ✓ Token sanitized');
    console.log(`   ✓ Token length: ${response.token.length} chars`);
    console.log(`   ✓ Token type: ${metadata.tokenType}`);
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
    console.log('🚀 Google Artifact Registry API Response Capture');
    console.log('=================================================\n');

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
        console.log('Token type:', realResponse.credentials.token_type);
        console.log('Expiry:', new Date(realResponse.credentials.expiry_date).toISOString());

        console.log('\n⚠️  Response displayed but NOT saved (no-sanitize mode)');
        return true;
      }

      // Sanitize response
      const { apiResponse, fixtureMetadata } = this.sanitizeResponse(realResponse);

      // Save fixture
      this.saveFixture(apiResponse, fixtureMetadata);

      console.log('\n✨ Capture complete!');
      console.log('   You can now use this fixture in unit tests.');
      console.log('   Import: require(\'./integration/fixtures/google-gar-response.json\')');

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

  const capture = new GoogleGARCapture({ noSanitize, repoAuthString });
  capture.run().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { GoogleGARCapture };
