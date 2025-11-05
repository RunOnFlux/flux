// Set NODE_CONFIG_DIR before loading any other modules
const path = require('path');
process.env.NODE_CONFIG_DIR = path.join(__dirname, '../../../../ZelBack/config');
process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

// Load environment variables from .env.test (without requiring dotenv package)
const fs = require('fs');

function loadEnvFile(filePath) {
  try {
    const envContent = fs.readFileSync(filePath, 'utf8');
    envContent.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        process.env[key.trim()] = value;
      }
    });
  } catch (error) {
    console.error(`Warning: Could not load .env.test file: ${error.message}`);
  }
}

const envPath = path.join(__dirname, '.env.test');
if (fs.existsSync(envPath)) {
  loadEnvFile(envPath);
}

const registryCredentialHelper = require("../../../../ZelBack/src/services/utils/registryCredentialHelper");

async function testBasicAuthentication() {
  console.log("Testing Basic Authentication (username:password)...\n");

  // Validate required environment variables
  const required = ['REGISTRY_USERNAME', 'REGISTRY_PASSWORD', 'IMAGE_TAG'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach(key => console.error(`   - ${key}`));
    console.error("\nPlease create a .env.test file from .env.test.template and fill in your values.");
    return false;
  }

  // Construct the repoauth string (basic auth format: username:password)
  const repoauth = `${process.env.REGISTRY_USERNAME}:${process.env.REGISTRY_PASSWORD}`;

  // Full image tag
  const repotag = process.env.IMAGE_TAG;

  const specVersion = 8;
  const appName = 'basic-auth-test-app';

  try {
    console.log("1. Getting credentials via registryCredentialHelper...");
    console.log(`   Image: ${repotag}`);
    console.log(`   Username: ${process.env.REGISTRY_USERNAME}`);

    const credentials = await registryCredentialHelper.getCredentials(
      repotag,
      repoauth,
      specVersion,
      appName
    );

    if (!credentials) {
      console.error("❌ No credentials returned");
      return false;
    }

    console.log("\n2. Credentials obtained successfully:");
    console.log(`   ✅ Username: ${credentials.username}`);
    console.log(`   ✅ Password length: ${credentials.password.length} chars`);
    console.log(`   ✅ Auth type: Basic`);

    console.log("\n✅ Basic authentication test successful!");
    return true;
  } catch (error) {
    console.error("\n❌ Basic authentication test failed:");
    console.error(`   Error: ${error.message}`);
    if (error.stack) {
      console.error(`\n   Stack trace:\n${error.stack}`);
    }
    return false;
  }
}

// Run the test
testBasicAuthentication()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });
