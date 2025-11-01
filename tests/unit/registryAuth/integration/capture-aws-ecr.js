#!/usr/bin/env node

/**
 * AWS ECR API Response Capture Script
 *
 * This script makes a real API call to AWS ECR to capture the GetAuthorizationToken
 * response structure. The captured response is sanitized (sensitive data replaced)
 * and saved as a JSON fixture for use in unit tests.
 *
 * Usage:
 *   node integration/capture-aws-ecr.js [repoAuthString]
 *
 * Command-line argument (optional):
 *   repoAuthString - AWS ECR auth in format:
 *     "aws-ecr://region=REGION&accessKeyId=KEY&secretAccessKey=SECRET"
 *
 * Environment variables (fallback if no CLI arg):
 *   AWS_REGION - AWS region (e.g., us-east-1)
 *   AWS_ACCESS_KEY_ID - AWS access key
 *   AWS_SECRET_ACCESS_KEY - AWS secret key
 */

const fs = require('fs');
const path = require('path');
const { ECRClient, GetAuthorizationTokenCommand } = require('@aws-sdk/client-ecr');
const { RepoAuthParser } = require('../src/utils/repoAuthParser');

// Load environment variables from .env.test if available
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });
} catch (e) {
  // dotenv not available, use system environment variables
}

class AWSECRCapture {
  constructor(options = {}) {
    this.fixturesDir = path.join(__dirname, 'fixtures');
    this.outputFile = path.join(this.fixturesDir, 'aws-ecr-response.json');
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

        if (authConfig.type !== 'aws-ecr') {
          throw new Error(`Expected aws-ecr provider, got: ${authConfig.type}`);
        }

        if (!authConfig.region) {
          throw new Error('Missing required parameter: region');
        }

        console.log(`   ✓ Provider: ${authConfig.type}`);
        console.log(`   ✓ Region: ${authConfig.region}`);

        return {
          region: authConfig.region,
          accessKeyId: authConfig.accessKeyId,
          secretAccessKey: authConfig.secretAccessKey,
        };
      } catch (error) {
        console.error('❌ Failed to parse repoAuth string:', error.message);
        process.exit(1);
      }
    }

    // Fall back to environment variables
    const required = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:', missing.join(', '));
      console.error('Please set these in .env.test or as environment variables.');
      console.error('Or provide repoAuth string as command-line argument:');
      console.error('  node capture-aws-ecr.js "aws-ecr://region=REGION&accessKeyId=KEY&secretAccessKey=SECRET"');
      process.exit(1);
    }

    return {
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  /**
   * Make real API call to AWS ECR
   */
  async fetchRealResponse() {
    console.log('📡 Making real API call to AWS ECR...');
    console.log(`   Region: ${this.config.region}`);

    const client = new ECRClient({
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });

    const command = new GetAuthorizationTokenCommand({});

    try {
      const startTime = Date.now();
      const response = await client.send(command);
      const duration = Date.now() - startTime;

      console.log(`✅ API call successful (${duration}ms)`);
      console.log(`   Authorization data entries: ${response.authorizationData?.length || 0}`);

      return response;
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

    if (!response.authorizationData || response.authorizationData.length === 0) {
      throw new Error('No authorization data in response');
    }

    const authData = response.authorizationData[0];

    // Decode the authorization token to get structure
    const tokenBuffer = Buffer.from(authData.authorizationToken, 'base64');
    const tokenString = tokenBuffer.toString('utf-8');
    const [username, password] = tokenString.split(':');

    // Create mock token with same structure but fake data
    const mockPassword = 'MOCK_ECR_PASSWORD_' + 'X'.repeat(Math.min(password.length - 20, 1200));
    const mockTokenString = `${username}:${mockPassword}`;
    const mockToken = Buffer.from(mockTokenString).toString('base64');

    // Set expiry to a random time in the future (between 1-7 days)
    const now = new Date();
    const randomHours = Math.random() * 6 * 24 + 24; // 1-7 days in hours
    const futureExpiry = new Date(now.getTime() + randomHours * 60 * 60 * 1000);

    // Create sanitized response with EXACT same structure as raw API response
    const sanitizedApiResponse = {
      $metadata: response.$metadata, // Preserve AWS SDK metadata
      authorizationData: [
        {
          authorizationToken: mockToken,
          expiresAt: futureExpiry.toISOString(),
          proxyEndpoint: authData.proxyEndpoint,
        },
      ],
    };

    const metadata = {
      capturedAt: new Date().toISOString(),
      provider: 'aws-ecr',
      apiCall: 'GetAuthorizationTokenCommand',
      region: this.config.region,
      sanitized: true,
      sanitizedFields: ['authorizationData[0].authorizationToken', 'authorizationData[0].expiresAt'],
      notes: 'Authorization token replaced with mock data of similar length. Expiry set to a random time between 1-7 days in the future.',
      originalTokenLength: password.length,
      username: username,
    };

    console.log('   ✓ Token sanitized');
    console.log(`   ✓ Expiry adjusted to ${futureExpiry.toISOString()}`);
    console.log(`   ✓ Username: ${username}`);
    console.log(`   ✓ Password length: ${password.length} chars`);

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
    console.log('🚀 AWS ECR API Response Capture');
    console.log('================================\n');

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

        // Decode and display the authorization token
        if (realResponse.authorizationData && realResponse.authorizationData.length > 0) {
          const authData = realResponse.authorizationData[0];
          const tokenBuffer = Buffer.from(authData.authorizationToken, 'base64');
          const tokenString = tokenBuffer.toString('utf-8');
          const [username, password] = tokenString.split(':');

          console.log('\n📋 DECODED AUTHORIZATION TOKEN:');
          console.log('================================');
          console.log('Username:', username);
          console.log('Password (first 50 chars):', password.substring(0, 50) + '...');
          console.log('Password length:', password.length, 'characters');
          console.log('Full password:', password);
        }

        console.log('\n⚠️  Response displayed but NOT saved (no-sanitize mode)');
        return true;
      }

      // Sanitize response
      const { apiResponse, fixtureMetadata } = this.sanitizeResponse(realResponse);

      // Save fixture
      this.saveFixture(apiResponse, fixtureMetadata);

      console.log('\n✨ Capture complete!');
      console.log('   You can now use this fixture in unit tests.');
      console.log(`   Import: require('./integration/fixtures/aws-ecr-response.json')`);

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
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const repoAuthString = args[0] || null;

  const capture = new AWSECRCapture({ noSanitize, repoAuthString });
  capture.run().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { AWSECRCapture };
