// Set NODE_CONFIG_DIR before loading any other modules
const path = require('path');
process.env.NODE_CONFIG_DIR = path.join(__dirname, '../../../../ZelBack/config');
process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

// Load environment variables from .env.test (without requiring dotenv package)
const fs = require('fs');
const { execSync } = require("child_process");

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

async function testDockerPullWithIntegration() {
  console.log("Testing Docker pull with Azure ACR integration...\n");

  // Validate required environment variables
  const required = ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'ACR_LOGIN_SERVER', 'ACR_IMAGE_TAG'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach(key => console.error(`   - ${key}`));
    console.error("\nPlease create a .env.test file from .env.test.template and fill in your values.");
    return false;
  }

  const repoauth = `azure-acr://clientId=${process.env.AZURE_CLIENT_ID}&clientSecret=${process.env.AZURE_CLIENT_SECRET}&tenantId=${process.env.AZURE_TENANT_ID}`;
  const repotag = `${process.env.ACR_LOGIN_SERVER}/${process.env.ACR_IMAGE_TAG}`;
  const registryUrl = process.env.ACR_LOGIN_SERVER;
  const specVersion = 8;
  const appName = 'acr-test-app';

  try {
    // Step 1: Get credentials
    console.log("1. Getting Azure ACR credentials from integration layer...");
    const credentials = await registryCredentialHelper.getCredentials(
      repotag,
      repoauth,
      specVersion,
      appName
    );

    if (!credentials) {
      console.error("   ❌ No credentials returned");
      return false;
    }

    console.log(`   ✅ Got credentials - Username: ${credentials.username}`);
    console.log(`   ✅ Token expires: ${new Date(credentials.expiresAt)}`);

    // Step 2: Login to Docker
    console.log("\n2. Logging into Docker with integration credentials...");
    const loginCmd = `echo "${credentials.password}" | docker login --username ${credentials.username} --password-stdin ${registryUrl}`;
    execSync(loginCmd, { stdio: "pipe" });
    console.log("   ✅ Docker login successful");

    // Step 3: Pull the image
    console.log("\n3. Pulling image from Azure ACR...");
    console.log(`   Image: ${repotag}`);
    const pullOutput = execSync(`docker pull ${repotag}`, {
      encoding: "utf8",
    });

    if (pullOutput.includes("Pull complete") || pullOutput.includes("Image is up to date")) {
      console.log("   ✅ Image pulled successfully!");

      // Step 4: Verify image exists locally
      console.log("\n4. Verifying image exists locally...");
      const images = execSync(
        `docker images --format "{{.Repository}}:{{.Tag}}" | grep "${registryUrl}"`,
        { encoding: "utf8" }
      );
      console.log(`   ✅ Image found locally: ${images.trim()}`);

      // Step 5: Test running the container
      console.log("\n5. Testing container run...");
      const containerName = "flux-acr-test-container";
      execSync(`docker rm -f ${containerName} 2>/dev/null || true`, {
        stdio: "pipe",
      });

      const runOutput = execSync(
        `docker run -d --name ${containerName} ${repotag}`,
        { encoding: "utf8" }
      ).trim();

      console.log(`   ✅ Container started: ${runOutput.substring(0, 12)}`);

      const status = execSync(
        `docker inspect ${containerName} --format='{{.State.Status}}'`,
        { encoding: "utf8" }
      ).trim();

      console.log(`   ✅ Container status: ${status}`);

      // Cleanup
      execSync(`docker rm -f ${containerName}`, { stdio: "pipe" });
      console.log("   ✅ Cleanup completed");

      console.log("\n🎉 SUCCESS: Docker pull and run worked with Azure ACR authentication!");
      return true;
    } else {
      console.error("   ❌ Pull may have failed - unexpected output");
      return false;
    }
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    if (error.stdout) console.error("stdout:", error.stdout.toString());
    if (error.stderr) console.error("stderr:", error.stderr.toString());
    return false;
  } finally {
    try {
      console.log("\n6. Logging out from Docker...");
      execSync(`docker logout ${registryUrl}`, { stdio: "pipe" });
      console.log("   ✅ Logged out");
    } catch (e) {
      // Ignore logout errors
    }
  }
}

// Run the test
testDockerPullWithIntegration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });
