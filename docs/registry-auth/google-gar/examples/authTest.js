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

async function testGARAuthentication() {
  console.log("Testing Google Artifact Registry authentication...\n");

  // Validate required environment variables
  const required = ['GAR_KEY_FILE', 'GAR_REPOSITORY_URI', 'GAR_IMAGE_TAG'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach(key => console.error(`   - ${key}`));
    console.error("\nPlease create a .env.test file from .env.test.template and fill in your values.");
    console.error("Note: GAR_KEY_FILE must be base64-encoded service account JSON");
    return false;
  }

  // Construct the repoauth string
  const repoauth = `google-gar://keyFile=${process.env.GAR_KEY_FILE}`;

  // Full image tag
  const repotag = `${process.env.GAR_REPOSITORY_URI}/${process.env.GAR_IMAGE_TAG}`;

  const specVersion = 8;
  const appName = 'gar-test-app';

  try {
    console.log("1. Getting Google GAR credentials via registryCredentialHelper...");
    const registryUrl = process.env.GAR_REPOSITORY_URI.split('/')[0];
    console.log(`   Registry: ${registryUrl}`);

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
      const minutesValid = Math.round((credentials.expiresAt - Date.now()) / 1000 / 60);
      console.log(`   ✅ Token expires: ${expiresDate.toISOString()}`);
      console.log(`   ✅ Valid for: ~${minutesValid} minutes`);
    }

    console.log("\n✅ Google GAR authentication test successful!");
    return true;
  } catch (error) {
    console.error("\n❌ GAR authentication test failed:");
    console.error(`   Error: ${error.message}`);
    if (error.stack) {
      console.error(`\n   Stack trace:\n${error.stack}`);
    }
    return false;
  }
}

// Run the test
testGARAuthentication()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });
