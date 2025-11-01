#!/usr/bin/env node

/**
 * Master Capture Script - Run All Provider Captures
 *
 * This script runs all provider capture scripts sequentially and provides
 * a summary report of successes and failures.
 *
 * Usage:
 *   node integration/capture-all.js [awsRepoAuth] [azureRepoAuth] [googleRepoAuth]
 *
 * Command-line arguments (optional):
 *   All arguments are optional. You can provide 0-3 repoAuth strings in any order.
 *   The script will detect which provider each string is for based on the prefix.
 *
 * Environment variables (fallback):
 *   See individual capture scripts for required variables
 */

const { AWSECRCapture } = require('./capture-aws-ecr');
const { AzureACRCapture } = require('./capture-azure-acr');
const { GoogleGARCapture } = require('./capture-google-gar');

class CaptureAll {
  constructor(options = {}) {
    this.repoAuthStrings = options.repoAuthStrings || {};
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      captures: [],
    };
  }

  /**
   * Run a single capture script
   */
  async runCapture(name, captureInstance) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting ${name} capture...`);
    console.log('='.repeat(60));

    const startTime = Date.now();
    let success = false;

    try {
      success = await captureInstance.run();
      const duration = Date.now() - startTime;

      this.results.captures.push({
        name,
        success,
        duration,
        error: null,
      });

      if (success) {
        this.results.passed++;
        console.log(`\n✅ ${name} capture completed successfully (${duration}ms)`);
      } else {
        this.results.failed++;
        console.log(`\n❌ ${name} capture failed (${duration}ms)`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.failed++;

      this.results.captures.push({
        name,
        success: false,
        duration,
        error: error.message,
      });

      console.log(`\n❌ ${name} capture encountered an error (${duration}ms)`);
      console.log(`   Error: ${error.message}`);
    }

    this.results.total++;
  }

  /**
   * Print summary report
   */
  printSummary() {
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 CAPTURE SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total captures: ${this.results.total}`);
    console.log(`✅ Successful: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`📈 Success rate: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%\n`);

    console.log('Individual Results:');
    console.log('-'.repeat(60));
    this.results.captures.forEach((capture) => {
      const status = capture.success ? '✅' : '❌';
      const duration = `${capture.duration}ms`;
      console.log(`${status} ${capture.name.padEnd(30)} ${duration.padStart(8)}`);
      if (capture.error) {
        console.log(`   Error: ${capture.error}`);
      }
    });
  }

  /**
   * Check if all required environment variables are set
   */
  checkEnvironment() {
    const hasRepoAuthStrings = Object.keys(this.repoAuthStrings).length > 0;

    if (hasRepoAuthStrings) {
      console.log('📝 Using repoAuth strings from command-line arguments');
      console.log(`   Providers configured: ${Object.keys(this.repoAuthStrings).join(', ')}\n`);
      return;
    }

    const allVars = [
      // AWS ECR
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      // Azure ACR
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
      'AZURE_REGISTRY_NAME',
      // Google GAR
      'GOOGLE_CLIENT_EMAIL',
      'GOOGLE_PRIVATE_KEY',
      'GOOGLE_PROJECT_ID',
    ];

    const missing = allVars.filter(key => !process.env[key]);

    if (missing.length > 0) {
      console.log('⚠️  Warning: Some environment variables are not set:');
      missing.forEach(key => console.log(`   - ${key}`));
      console.log('\nCaptures requiring these variables will fail.');
      console.log('Set them in .env.test or as environment variables.');
      console.log('Or provide repoAuth strings as command-line arguments.\n');
    }
  }

  /**
   * Run all capture scripts
   */
  async run() {
    console.log('🚀 Running All Provider Capture Scripts');
    console.log('========================================');
    console.log(`Started at: ${new Date().toISOString()}\n`);

    // Check environment
    this.checkEnvironment();

    // Run each capture script with optional repoAuth strings
    await this.runCapture('AWS ECR', new AWSECRCapture({
      repoAuthString: this.repoAuthStrings['aws-ecr']
    }));
    await this.runCapture('Azure ACR', new AzureACRCapture({
      repoAuthString: this.repoAuthStrings['azure-acr']
    }));
    await this.runCapture('Google Artifact Registry', new GoogleGARCapture({
      repoAuthString: this.repoAuthStrings['google-gar']
    }));

    // Print summary
    this.printSummary();

    // Return success if at least one capture succeeded
    const hasSuccess = this.results.passed > 0;

    if (hasSuccess) {
      console.log('\n✨ At least one capture succeeded. Check integration/fixtures/ for results.');
      console.log('   You can now use these fixtures in unit tests.');
    } else {
      console.log('\n❌ All captures failed. Please check your environment variables and credentials.');
    }

    return hasSuccess;
  }
}

// Run if executed directly
if (require.main === module) {
  // Parse command-line arguments to extract repoAuth strings
  // Arguments can be in any order, we detect provider by prefix
  const args = process.argv.slice(2);
  const repoAuthStrings = {};

  args.forEach(arg => {
    if (arg.startsWith('aws-ecr://')) {
      repoAuthStrings['aws-ecr'] = arg;
    } else if (arg.startsWith('azure-acr://')) {
      repoAuthStrings['azure-acr'] = arg;
    } else if (arg.startsWith('google-gar://')) {
      repoAuthStrings['google-gar'] = arg;
    } else {
      console.warn(`⚠️  Ignoring unrecognized argument: ${arg}`);
    }
  });

  const captureAll = new CaptureAll({ repoAuthStrings });
  captureAll.run().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { CaptureAll };
