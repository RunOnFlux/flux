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

async function testECRAuthentication() {
  console.log("Testing AWS ECR authentication...\n");

  // Validate required environment variables
  const required = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'ECR_REPOSITORY_URI', 'ECR_IMAGE_TAG'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach(key => console.error(`   - ${key}`));
    console.error("\nPlease create a .env.test file from .env.test.template and fill in your values.");
    return false;
  }

  // Construct the repoauth string from environment variables
  const repoauth = `aws-ecr://region=${process.env.AWS_REGION}&accessKeyId=${process.env.AWS_ACCESS_KEY_ID}&secretAccessKey=${process.env.AWS_SECRET_ACCESS_KEY}`;

  // Full image tag (repotag)
  const repotag = `${process.env.ECR_REPOSITORY_URI}:${process.env.ECR_IMAGE_TAG}`;

  // Spec version (8 for plain text auth)
  const specVersion = 8;

  // App name for cache isolation
  const appName = 'ecr-test-app';

  try {
    console.log("1. Getting ECR credentials via registryCredentialHelper...");
    console.log(`   Registry: ${process.env.ECR_REPOSITORY_URI.split('/')[0]}`);
    console.log(`   Region: ${process.env.AWS_REGION}`);

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
    console.log(`   ✅ Auth type: ${credentials.authType || 'Basic'}`);

    if (credentials.expiresAt) {
      const expiresDate = new Date(credentials.expiresAt);
      const hoursValid = Math.round((credentials.expiresAt - Date.now()) / 1000 / 60 / 60);
      console.log(`   ✅ Token expires: ${expiresDate.toISOString()}`);
      console.log(`   ✅ Valid for: ~${hoursValid} hours`);
    }

    console.log("\n✅ ECR authentication test successful!");
    return true;
  } catch (error) {
    console.error("\n❌ ECR authentication test failed:");
    console.error(`   Error: ${error.message}`);
    if (error.stack) {
      console.error(`\n   Stack trace:\n${error.stack}`);
    }
    return false;
  }
}

// Run the test
testECRAuthentication()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });
