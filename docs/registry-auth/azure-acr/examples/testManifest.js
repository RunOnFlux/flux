// Set NODE_CONFIG_DIR before loading any other modules
const path = require('path');
process.env.NODE_CONFIG_DIR = path.join(__dirname, '../../../../ZelBack/config');
process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

// Load environment variables from .env.test
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

async function testManifestAccess() {
  console.log("Testing Azure ACR manifest and metadata access...\n");

  const repoauth = `azure-acr://clientId=${process.env.AZURE_CLIENT_ID}&clientSecret=${process.env.AZURE_CLIENT_SECRET}&tenantId=${process.env.AZURE_TENANT_ID}`;
  const repotag = `${process.env.ACR_LOGIN_SERVER}/${process.env.ACR_IMAGE_TAG}`;
  const registryUrl = process.env.ACR_LOGIN_SERVER;
  const [repository, tag] = process.env.ACR_IMAGE_TAG.split(':');

  try {
    // Get credentials
    console.log("1. Getting Azure ACR credentials...");
    const credentials = await registryCredentialHelper.getCredentials(
      repotag,
      repoauth,
      8,
      'acr-manifest-test'
    );
    console.log(`   ✅ Got credentials`);

    // Test manifest v2 API access
    console.log("\n2. Testing Docker Registry v2 API access...");

    const manifestUrl = `https://${registryUrl}/v2/${repository}/manifests/${tag}`;
    console.log(`   Manifest URL: ${manifestUrl}`);

    const response = await fetch(manifestUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.password}`,
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
      }
    });

    if (!response.ok) {
      console.error(`   ❌ Manifest request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`   Error: ${errorText}`);
      return false;
    }

    const manifest = await response.json();
    console.log(`   ✅ Manifest retrieved successfully`);
    console.log(`   Schema version: ${manifest.schemaVersion}`);
    console.log(`   Media type: ${manifest.mediaType}`);

    // Get config blob size
    if (manifest.config) {
      console.log(`   Config digest: ${manifest.config.digest}`);
      console.log(`   Config size: ${manifest.config.size} bytes`);
    }

    // Get layer information
    console.log(`\n3. Image layer information:`);
    if (manifest.layers) {
      console.log(`   Number of layers: ${manifest.layers.length}`);
      let totalSize = 0;
      manifest.layers.forEach((layer, idx) => {
        console.log(`   Layer ${idx + 1}: ${(layer.size / 1024 / 1024).toFixed(2)} MB (${layer.digest.substring(0, 20)}...)`);
        totalSize += layer.size;
      });
      console.log(`   Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    }

    // Test blob access (config blob)
    if (manifest.config) {
      console.log(`\n4. Testing blob access (image config)...`);
      const blobUrl = `https://${registryUrl}/v2/${repository}/blobs/${manifest.config.digest}`;

      const blobResponse = await fetch(blobUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${credentials.password}`
        }
      });

      if (!blobResponse.ok) {
        console.error(`   ❌ Blob request failed: ${blobResponse.status}`);
        return false;
      }

      const configBlob = await blobResponse.json();
      console.log(`   ✅ Config blob retrieved successfully`);
      console.log(`   Architecture: ${configBlob.architecture}`);
      console.log(`   OS: ${configBlob.os}`);
      if (configBlob.config && configBlob.config.Cmd) {
        console.log(`   Command: ${configBlob.config.Cmd.join(' ')}`);
      }
    }

    console.log(`\n✅ SUCCESS: repository:*:pull scope grants full read access!`);
    console.log(`   - Can read manifests ✅`);
    console.log(`   - Can read blobs ✅`);
    console.log(`   - Can get image metadata ✅`);
    console.log(`   - Can calculate image sizes ✅`);

    return true;

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    if (error.stack) {
      console.error(`Stack: ${error.stack}`);
    }
    return false;
  }
}

testManifestAccess()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });
