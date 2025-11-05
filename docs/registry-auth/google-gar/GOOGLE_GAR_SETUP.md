# Google Artifact Registry Live Testing Environment Setup

This guide walks through setting up a real Google Artifact Registry (GAR) environment for testing the authentication integration layer.


**Example Files**: All code examples and test scripts referenced in this guide can be found in the `examples/` subdirectory.
## Prerequisites

1. **Google Cloud Account** with Artifact Registry access
2. **Google Cloud CLI (gcloud)** installed and configured
3. **Docker** installed locally
4. **Node.js** environment with the authentication integration

### Google Cloud CLI Configuration

Ensure you're authenticated and have a default project set:

```bash
# Login to Google Cloud
gcloud auth login

# Set your default project
gcloud config set project YOUR_PROJECT_ID

# Verify configuration
gcloud config list
```

This ensures commands will work with your intended Google Cloud project.

## Step 1: Create Google Artifact Registry Repository

### Using Google Cloud CLI

```bash
# Choose your region (recommended for your location):
# Europe: europe-west1 (Belgium), europe-west2 (London) - GOOD CHOICES
# US: us-central1 (Iowa), us-east1 (South Carolina)
export GCP_REGION=europe-west2

# Get your project ID
export GCP_PROJECT_ID=$(gcloud config get-value project)
echo "Project ID: $GCP_PROJECT_ID"

# Enable Artifact Registry API (if not already enabled)
gcloud services enable artifactregistry.googleapis.com

# Create a new GAR repository
gcloud artifacts repositories create flux-test-repo \
    --repository-format=docker \
    --location=$GCP_REGION \
    --description="FluxOS test repository"

# Get the repository details (save this for later)
gcloud artifacts repositories describe flux-test-repo \
    --location=$GCP_REGION \
    --format="value(name)"
```

### Using Google Cloud Console

1. Go to Google Cloud Console → Artifact Registry
2. **Change region** to `europe-west2` (London) or your preferred region
3. Click "Create Repository"
4. Repository name: `flux-test-repo`
5. Format: `Docker`
6. Mode: `Standard`
7. Location: `europe-west2` (or your chosen region)
8. Click "Create"

## Step 2: Create Service Account for Testing

### Create Service Account

```bash
# Create service account
gcloud iam service-accounts create fluxos-gar-test \
    --description="FluxOS GAR test service account" \
    --display-name="FluxOS GAR Test"

# Grant Artifact Registry Reader role (minimum permissions for pulling)
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
    --member="serviceAccount:fluxos-gar-test@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.reader"

# Generate JSON key file
gcloud iam service-accounts keys create gar-service-account.json \
    --iam-account=fluxos-gar-test@$GCP_PROJECT_ID.iam.gserviceaccount.com

echo "✅ Service account created and key saved to gar-service-account.json"
```

**Save the JSON key file** - you'll base64-encode the entire file for authentication.

### Required IAM Roles

The minimum role for pulling images from Artifact Registry:

- **`roles/artifactregistry.reader`** - Provides:
  - `artifactregistry.repositories.downloadArtifacts` (required for docker pull)
  - `artifactregistry.repositories.get` (required for repository access)
  - `artifactregistry.repositories.list` (helpful for debugging)

## Step 3: Push a Test Image to GAR

```bash
# Configure Docker authentication for GAR
gcloud auth configure-docker $GCP_REGION-docker.pkg.dev

# Construct the GAR registry URL
export GAR_REGISTRY_URL="$GCP_REGION-docker.pkg.dev"
export GAR_REPOSITORY_URI="$GAR_REGISTRY_URL/$GCP_PROJECT_ID/flux-test-repo"
echo "GAR Repository URI: $GAR_REPOSITORY_URI"

# Pull a simple test image
docker pull nginx:alpine

# Tag for GAR
docker tag nginx:alpine $GAR_REPOSITORY_URI/test:latest

# Push to GAR
docker push $GAR_REPOSITORY_URI/test:latest

# Verify the image was pushed
gcloud artifacts docker images list $GAR_REGISTRY_URL/$GCP_PROJECT_ID/flux-test-repo
```

**Note**: The `gcloud auth configure-docker` command configures Docker to use gcloud as a credential helper for the specified registry.

## Step 4: Environment Configuration

### Create .env.test File

First, create the `.env.test` file with your repository configuration from Step 1:

```bash
# Navigate to the test directory
cd /Users/davew/code/flux/docker-reg-int/dev/google-gar

# Create .env.test with repository configuration
# Use the actual values from the environment variables set in Step 1
cat > .env.test << EOF
# Google GAR Test Configuration
GCP_REGION=${GCP_REGION}
GAR_REPOSITORY_URI=${GAR_REPOSITORY_URI}
GAR_IMAGE_TAG=test:latest
EOF

echo "✅ Created .env.test with repository configuration"
```

**Example .env.test at this point**:
```bash
GCP_REGION=europe-west2
GAR_REPOSITORY_URI=europe-west2-docker.pkg.dev/my-project-12345/flux-test-repo
GAR_IMAGE_TAG=test:latest
```

**Important**:
- `GAR_REPOSITORY_URI` should be `REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME` (includes the repository name)
- `GAR_IMAGE_TAG` should be just `IMAGE_NAME:TAG` (does NOT include the repository name again)
- The full image path is constructed as: `${GAR_REPOSITORY_URI}/${GAR_IMAGE_TAG}`

### Add Base64-Encoded Service Account Credentials

Now add the service account credentials by base64-encoding the JSON file:

```bash
# Base64 encode the entire service account JSON file
export GAR_KEY_FILE=$(cat gar-service-account.json | base64)

# Add to .env.test file
echo "GAR_KEY_FILE=$GAR_KEY_FILE" >> .env.test

echo "✅ Service account JSON encoded and added to .env.test"
```

**Final .env.test example**:
```bash
GCP_REGION=europe-west2
GAR_REPOSITORY_URI=europe-west2-docker.pkg.dev/my-project-12345/flux-test-repo
GAR_IMAGE_TAG=test:latest
GAR_KEY_FILE=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6Im15LXByb2plY3QtMTIzNDUiLCJwcml2YXRlX2tleV9pZCI6ImFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYiLCJwcml2YXRlX2tleSI6Ii0tLS0tQkVHSU4gUFJJVkFURSBLRVktLS0tLVxuLi4uXG4tLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tXG4iLCJjbGllbnRfZW1haWwiOiJmbHV4b3MtZ2FyLXRlc3RAbXktcHJvamVjdC5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbSIsImNsaWVudF9pZCI6IjEyMzQ1Njc4OTAxMjM0NTY3ODkwIiwiYXV0aF91cmkiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20vby9vYXV0aDIvYXV0aCIsInRva2VuX3VyaSI6Imh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIn0K
```

## Step 5: Test the Integration

### Basic Authentication Test

```javascript
// Load environment variables from .env.test
require('dotenv').config({ path: '.env.test' });

const {
  registryAuthService,
} = require("../../../ZelBack/src/services/registryAuth/services/registryAuthService");

// Create a minimal ImageVerifier mock for testing
class MockImageVerifier {
  constructor(imageTag, credentials = null) {
    this.imageTag = imageTag;
    this.credentials = credentials;
  }

  addCredentials(credentials) {
    this.credentials = credentials;
  }

  getAuthConfig() {
    return this.credentials;
  }
}

async function testGARAuthentication() {
  // Initialize the service with our mock
  registryAuthService.initialize(MockImageVerifier);

  // GAR configuration
  const garConfig = {
    type: "google-gar",
    privateKey: process.env.GAR_KEY_FILE,
    clientEmail: process.env.GAR_KEY_FILE,
  };

  const imageTag = `${process.env.GAR_REPOSITORY_URI}/${process.env.GAR_IMAGE_TAG}`;

  try {
    // Test authentication (use registry domain, not full repo URI)
    const garRegistryUrl = process.env.GAR_REPOSITORY_URI.split('/')[0];
    console.log("Testing GAR authentication...");
    const testResult = await registryAuthService.testAuthentication(
      garConfig,
      garRegistryUrl
    );
    console.log("Auth test result:", testResult);

    // Test provider creation directly
    console.log("Creating GAR auth provider...");
    const provider = registryAuthService.createProvider(
      garRegistryUrl,
      garConfig
    );

    // Test credential retrieval
    console.log("Getting GAR credentials...");
    const credentials = await provider.getCredentials();
    console.log("✅ Successfully obtained GAR credentials");
    console.log("Username:", credentials.username); // Should be 'oauth2accesstoken'
    console.log("Token expires:", new Date(credentials.expiresAt));
    console.log("Client Email:", credentials.clientEmail);

    console.log("✅ GAR authentication test successful!");
    return true;
  } catch (error) {
    console.error("❌ GAR authentication test failed:", error.message);
    return false;
  }
}

// Run the test
testGARAuthentication();
```

### FluxOS App Spec Integration Test

**Important**: FluxOS requires the `repoauth` field to be a **string**, not an object. Use the string encoding format for provider-based authentication.

```javascript
const {
  registryAuthService,
} = require("../../../ZelBack/src/services/registryAuth/services/registryAuthService");

async function testFluxOSAppSpecIntegration() {
  // Mock FluxOS app specification with GAR authentication
  // NOTE: repoauth MUST be a string in FluxOS format
  const mockAppSpec = {
    name: "test-gar-app",
    version: 8,
    compose: [
      {
        name: "web",
        repotag: `${process.env.GAR_REPOSITORY_URI}/${process.env.GAR_IMAGE_TAG}`,
        // String format: provider://param1=value1&param2=value2
        // Note: privateKey needs URL encoding for the string format
        repoauth: `google-gar://keyFile=${process.env.GAR_KEY_FILE}`,
      },
    ],
  };

  try {
    console.log("Testing FluxOS app spec integration...");

    const result = await registryAuthService.prepareImageVerificationWithAuth(
      mockAppSpec.compose[0].repotag,
      mockAppSpec,
      "web"
    );

    if (result.success) {
      console.log("✅ FluxOS integration successful!");
      console.log("Auth info:", result.authInfo);
      return true;
    } else {
      console.error("❌ FluxOS integration failed:", result.error);
      return false;
    }
  } catch (error) {
    console.error("❌ FluxOS integration test failed:", error.message);
    return false;
  }
}

// Run the test
testFluxOSAppSpecIntegration();
```

### Testing String Format Parsing

```javascript
const { RepoAuthParser } = require('./src/utils/repoAuthParser');

function testStringFormats() {
  console.log("Testing repoauth string formats...");

  // Test basic auth format (backward compatible)
  const basicAuth = "_json_key:base64encodedserviceaccountjson";
  const basicResult = RepoAuthParser.parse(basicAuth);
  console.log("Basic auth (legacy):", basicResult);
  // Output: { type: 'basic', username: '_json_key', password: 'base64...' }

  // Test Google GAR provider format
  const garAuth = `google-gar://keyFile=${process.env.GAR_KEY_FILE}`;
  const garResult = RepoAuthParser.parse(garAuth);
  console.log("Google GAR:", garResult);
  // Output: { type: 'google-gar', privateKey: '-----BEGIN...', clientEmail: '...' }

  // Test roundtrip encoding
  const encoded = RepoAuthParser.encode(garResult);
  console.log("Re-encoded:", encoded);

  // Test URL encoding of special characters (private key has newlines)
  const specialAuth = "google-gar://privateKey=" + encodeURIComponent("-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n");
  const specialResult = RepoAuthParser.parse(specialAuth);
  console.log("URL decoded private key:", specialResult.privateKey); // Should have proper newlines

  console.log("✅ String format tests completed");
}

testStringFormats();
```

## Step 6: Performance Testing

### Token Caching Test

```javascript
async function testTokenCaching() {
  const garConfig = {
    type: "google-gar",
    privateKey: process.env.GAR_KEY_FILE,
    clientEmail: process.env.GAR_KEY_FILE,
  };

  const provider = registryAuthService.createProvider(
    process.env.GAR_REPOSITORY_URI,
    garConfig
  );

  console.log("Testing token caching performance...");

  // First call - should fetch from Google
  const start1 = Date.now();
  const creds1 = await provider.getCredentials();
  const time1 = Date.now() - start1;
  console.log(`First call (Google Auth API): ${time1}ms`);

  // Second call - should use cache
  const start2 = Date.now();
  const creds2 = await provider.getCredentials();
  const time2 = Date.now() - start2;
  console.log(`Second call (cached): ${time2}ms`);

  console.log(`Cache speedup: ${(time1 / time2).toFixed(2)}x faster`);
  console.log("Token expires at:", new Date(provider.tokenExpiry));
  console.log("Token valid for:", Math.round((provider.tokenExpiry - Date.now()) / 1000 / 60), "minutes");
}

testTokenCaching();
```

## Step 7: Error Handling Tests

### Invalid Credentials Test

```javascript
async function testInvalidCredentials() {
  const invalidConfig = {
    type: "google-gar",
    privateKey: "-----BEGIN PRIVATE KEY-----\nINVALID_KEY\n-----END PRIVATE KEY-----\n",
    clientEmail: "invalid@nonexistent.iam.gserviceaccount.com",
  };

  console.log("Testing invalid credentials handling...");

  const testResult = await registryAuthService.testAuthentication(
    invalidConfig,
    process.env.GAR_REPOSITORY_URI
  );

  if (
    !testResult.success &&
    testResult.error.includes("Google GAR authentication failed")
  ) {
    console.log("✅ Invalid credentials properly handled");
    return true;
  } else {
    console.log("❌ Invalid credentials not properly handled");
    return false;
  }
}

testInvalidCredentials();
```

### Permission Denied Test

```javascript
async function testPermissionDenied() {
  // Create service account without GAR permissions
  const restrictedConfig = {
    type: "google-gar",
    privateKey: process.env.GAR_KEY_FILE,
    clientEmail: process.env.GAR_KEY_FILE,
  };

  console.log("Testing permission denied scenarios...");

  // Note: This test requires manually removing IAM permissions to see the error
  // or using a service account without artifactregistry.reader role

  try {
    const provider = registryAuthService.createProvider(
      `${process.env.GCP_REGION}-docker.pkg.dev/${process.env.GCP_PROJECT_ID}/flux-test-repo`,
      restrictedConfig
    );

    // This might succeed for token generation but fail during actual registry access
    const credentials = await provider.getCredentials();
    console.log("⚠️  Credentials obtained, but may fail during actual registry access");
    console.log("Note: Remove IAM roles to test permission denied scenarios");
    return true;
  } catch (error) {
    if (error.message.includes("permission") || error.message.includes("access")) {
      console.log("✅ Permission denied properly handled:", error.message);
      return true;
    }
    console.log("❌ Unexpected error:", error.message);
    return false;
  }
}

testPermissionDenied();
```

## Step 8: Cleanup

After testing, clean up Google Cloud resources:

```bash
# Delete GAR repository (and all images in it)
gcloud artifacts repositories delete flux-test-repo \
    --location=$GCP_REGION \
    --quiet

# List service account keys
gcloud iam service-accounts keys list \
    --iam-account=fluxos-gar-test@$GCP_PROJECT_ID.iam.gserviceaccount.com

# Delete service account key (replace KEY_ID with actual ID from list command)
gcloud iam service-accounts keys delete KEY_ID \
    --iam-account=fluxos-gar-test@$GCP_PROJECT_ID.iam.gserviceaccount.com \
    --quiet

# Remove IAM policy binding
gcloud projects remove-iam-policy-binding $GCP_PROJECT_ID \
    --member="serviceAccount:fluxos-gar-test@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.reader"

# Delete service account
gcloud iam service-accounts delete \
    fluxos-gar-test@$GCP_PROJECT_ID.iam.gserviceaccount.com \
    --quiet

# Remove local files
rm -f gar-service-account.json .env.test

echo "✅ Cleanup completed"
```

## 💰 Cost Information (Free Account Safe!)

### Google Cloud Free Tier (2025)

- **Artifact Registry Storage**: 0.5 GB/month free - our test uses ~50 MB ✅
- **Network Egress**: 1 GB/month to internet free - our test uses ~50 MB ✅
- **API Calls**: Artifact Registry API calls are **FREE** ✅
- **Regional Transfer**: GAR ↔ Compute Engine/GKE is always free ✅

### Test Cost Breakdown

- **Repository creation**: Free
- **Test image (nginx:alpine)**: ~50 MB storage - Free
- **OAuth token generation**: Free (Google Auth API)
- **Data transfer**: Regional only - Free
- **Total estimated cost**: **$0.00** 🎉

### Monitoring Your Usage

```bash
# Check GAR repository sizes
gcloud artifacts repositories list --format="table(name,sizeBytes)"

# Check your project's quota usage
gcloud compute project-info describe --format="table(quotas.metric,quotas.usage,quotas.limit)"

# List images in repository
gcloud artifacts docker images list $GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/flux-test-repo

# Check storage usage
gcloud artifacts repositories describe flux-test-repo \
    --location=$GCP_REGION \
    --format="value(sizeBytes)"
```

### Free Tier Limits

- **Storage**: 0.5 GB/month (resets monthly)
- **Egress**: 1 GB/month to internet
- **Requests**: No specific limit on GAR API calls
- **Service Accounts**: 100 per project (plenty for testing)

## Expected Results

- **Authentication Test**: Should succeed with valid service account credentials
- **Token Caching**: Second call should be significantly faster (>10x)
- **Token Duration**: OAuth tokens valid for 60 minutes (vs 12 hours for AWS)
- **Error Handling**: Invalid credentials should fail gracefully
- **FluxOS Integration**: Should work seamlessly with app specifications

## Troubleshooting

### Common Issues

1. **"Permission denied"**: Check service account has `roles/artifactregistry.reader`
2. **"Repository does not exist"**: Verify GAR repository URI and region
3. **"Invalid private key"**: Ensure proper newline encoding in private key
4. **"Project not found"**: Check project ID matches gcloud configuration
5. **"Region not supported"**: Verify Artifact Registry is available in your region

### Debug Mode

Enable debug logging:

```javascript
// Enable verbose logging
process.env.DEBUG = "flux-registry-auth:*";

// Enable Google Auth Library debug
process.env.GOOGLE_AUTH_LIBRARY_DEBUG = "true";
```

### Common GAR Registry URL Patterns

- **Correct**: `europe-west2-docker.pkg.dev/my-project/my-repo`
- **Incorrect**: `gcr.io/my-project/my-repo` (that's Container Registry, not Artifact Registry)
- **Regional**: Must include region prefix (e.g., `us-central1-`, `europe-west2-`)

### Service Account Key Validation

```bash
# Validate service account key format
cat gar-service-account.json | jq '.private_key' > /dev/null
echo $? # Should output 0 if valid JSON

# Check if service account exists
gcloud iam service-accounts describe fluxos-gar-test@$GCP_PROJECT_ID.iam.gserviceaccount.com

# Test authentication manually
gcloud auth activate-service-account --key-file=gar-service-account.json
gcloud auth list # Should show the service account as active
```

### Monitoring

Monitor Google Cloud GAR usage in Cloud Console:

- **Artifact Registry → Repositories** - View repository size and images
- **IAM & Admin → Service Accounts** - Monitor service account usage
- **Cloud Logging** - Search for Artifact Registry API calls
- **Cloud Monitoring** - Set up alerts for quota usage

### Manual Docker Authentication Test

```bash
# Test OAuth token generation manually
gcloud auth activate-service-account --key-file=gar-service-account.json
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin $GCP_REGION-docker.pkg.dev

# Try pulling the test image
docker pull $GAR_REPOSITORY_URI/test:latest
```

This should help verify that the GAR setup is working correctly before testing with the Node.js integration.