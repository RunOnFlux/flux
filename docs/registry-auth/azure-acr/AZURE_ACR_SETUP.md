# Azure Container Registry Live Testing Environment Setup

This guide walks through setting up a real Azure Container Registry (ACR) environment for testing the authentication integration layer.


**Example Files**: All code examples and test scripts referenced in this guide can be found in the `examples/` subdirectory.
## Prerequisites

1. **Azure Account** with Container Registry access
2. **Azure CLI** installed and configured
3. **Docker** installed locally
4. **Node.js** environment with the authentication integration

**Cost Warning**: Azure Container Registry Basic tier incurs storage costs (~$0.10 per GB/month). Testing with a small image and quick cleanup should cost less than $1. **Remember to delete all resources after testing** (see cleanup section at bottom).

### Azure CLI Configuration

Ensure you're authenticated and have a default subscription set:

```bash
# Login to Azure
az login

# Set your default subscription
az account set --subscription "Your Subscription Name"

# Verify configuration
az account show
```

This ensures commands will work with your intended Azure subscription.

## Step 0: Register Container Registry Provider

**One-time setup per Azure subscription**: Before creating container registries, your subscription must have the `Microsoft.ContainerRegistry` resource provider registered.

### Check if Already Registered

```bash
az provider show --namespace Microsoft.ContainerRegistry --query "registrationState"
```

If it returns `"Registered"`, skip to Step 1.

### Register the Provider

**Using Azure CLI**:

```bash
# Register the provider
az provider register --namespace Microsoft.ContainerRegistry

# Monitor registration status (takes 1-2 minutes)
az provider show --namespace Microsoft.ContainerRegistry --query "registrationState"

# Wait until it shows "Registered"
```

**Using Azure Portal**:

1. Go to Azure Portal → Subscriptions
2. Select your subscription
3. Navigate to "Resource providers" in the left menu
4. Search for "Microsoft.ContainerRegistry"
5. Click on it and select "Register"
6. Wait for status to change to "Registered"

Once registered, you can proceed to create container registries.

## Step 1: Create Azure Container Registry

### Using Azure CLI

```bash
# Choose your region (recommended for your location):
# UK: uksouth (London), ukwest (Cardiff)
# Europe: westeurope (Netherlands), northeurope (Ireland)
# US: eastus (Virginia), westus2 (Washington)
export AZURE_REGION=uksouth

# Create a resource group (if you don't have one)
export RESOURCE_GROUP_NAME=flux-test-rg
az group create --name $RESOURCE_GROUP_NAME --location $AZURE_REGION

# Create Azure Container Registry
export ACR_NAME=fluxtestrepo$(date +%s) # Add timestamp to ensure uniqueness
az acr create \
    --resource-group $RESOURCE_GROUP_NAME \
    --name $ACR_NAME \
    --sku Basic \
    --location $AZURE_REGION

# Get the ACR login server (save this for later)
export ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --resource-group $RESOURCE_GROUP_NAME --query "loginServer" --output tsv)
echo "ACR Login Server: $ACR_LOGIN_SERVER"
```

### Using Azure Portal

1. Go to Azure Portal → Container registries
2. Click "Create"
3. **Subscription**: Choose your subscription
4. **Resource group**: Create new or use existing
5. **Registry name**: `fluxtestrepo` + unique suffix (must be globally unique)
6. **Location**: `UK South` or your preferred region
7. **SKU**: `Basic` (sufficient for testing)
8. Click "Review + create" → "Create"

## Step 2: Create Service Principal for Testing

### Create Service Principal

```bash
# Create service principal with ACR Pull role
az ad sp create-for-rbac \
    --name "flux-acr-test-sp" \
    --role "AcrPull" \
    --scopes "/subscriptions/$(az account show --query id --output tsv)/resourceGroups/$RESOURCE_GROUP_NAME/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME"

# The output will show:
# {
#   "appId": "12345678-1234-5678-9012-123456789012",
#   "displayName": "flux-acr-test-sp",
#   "password": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
#   "tenant": "87654321-4321-8765-4321-210987654321"
# }
```

**IMPORTANT - Save these values immediately**:
- `appId` → This is your **AZURE_CLIENT_ID**
- `password` → This is your **AZURE_CLIENT_SECRET** (cannot be retrieved later!)
- `tenant` → This is your **AZURE_TENANT_ID**

The `password` field is the client secret and can only be seen once. If you lose it, you'll need to create a new service principal.

**Note on Client Secret Format**: Azure generates client secrets using only URL-safe characters (`a-z`, `A-Z`, `0-9`, `-`, `_`, `.`, `~`). This means you can paste them directly into authentication strings without URL encoding.

### Required Azure Roles

The minimum role for pulling images from Azure Container Registry:

- **`AcrPull`** - Provides:
  - Pull images from Azure Container Registry
  - Read metadata and manifest information
  - Access to repository data

For push access (if needed for testing), you can use:
- **`AcrPush`** - Includes AcrPull + push capabilities

## Step 3: Push a Test Image to ACR

```bash
# Login to ACR using admin credentials (for pushing test image)
az acr login --name $ACR_NAME

# Pull a simple test image
docker pull nginx:alpine

# Tag for ACR
docker tag nginx:alpine $ACR_LOGIN_SERVER/test:latest

# Push to ACR
docker push $ACR_LOGIN_SERVER/test:latest

# Verify the image was pushed
az acr repository list --name $ACR_NAME --output table
az acr repository show-tags --name $ACR_NAME --repository test --output table
```

**Note**: The `az acr login` command configures Docker to use Azure CLI credentials for the push operation.

## Step 4: Environment Configuration

### Create .env.test File

First, create the `.env.test` file with your registry configuration from earlier steps:

```bash
# Navigate to the test directory
cd /Users/davew/code/flux/docker-reg-int/dev/azure-acr

# Create .env.test with registry configuration
# Use the actual values from the environment variables set in earlier steps
cat > .env.test << EOF
# Azure ACR Test Configuration
AZURE_SUBSCRIPTION_ID=$(az account show --query id --output tsv)
AZURE_REGION=${AZURE_REGION}
ACR_NAME=${ACR_NAME}
ACR_LOGIN_SERVER=${ACR_LOGIN_SERVER}
ACR_IMAGE_TAG=test:latest
EOF

echo "✅ Created .env.test with registry configuration"
```

**Example .env.test at this point**:
```bash
AZURE_SUBSCRIPTION_ID=12345678-90ab-cdef-1234-567890abcdef
AZURE_REGION=uksouth
ACR_NAME=fluxtestrepo1234567890
ACR_LOGIN_SERVER=fluxtestrepo1234567890.azurecr.io
ACR_IMAGE_TAG=test:latest
```

### Add Service Principal Credentials

Now add the service principal credentials to complete the configuration:

```bash
# Add client ID (from service principal creation)
echo "AZURE_CLIENT_ID=$(az ad sp list --display-name 'flux-acr-test-sp' --query '[0].appId' --output tsv)" >> .env.test

# Add tenant ID
echo "AZURE_TENANT_ID=$(az account show --query tenantId --output tsv)" >> .env.test

# Add client secret manually
# IMPORTANT: Replace YOUR_PASSWORD_FROM_STEP_2 with the "password" field from Step 2 output
# This is the AZURE_CLIENT_SECRET and cannot be retrieved after creation
echo "AZURE_CLIENT_SECRET=YOUR_PASSWORD_FROM_STEP_2" >> .env.test

echo "✅ Service principal credentials added to .env.test"
```

**IMPORTANT**: You must manually edit the last command and replace `YOUR_PASSWORD_FROM_STEP_2` with the actual `password` value from the `az ad sp create-for-rbac` JSON output in Step 2.

Example: If Step 2 showed `"password": "a1b2c3d4e5f6..."`, then run:
```bash
echo "AZURE_CLIENT_SECRET=a1b2c3d4e5f6..." >> .env.test
```

The password field cannot be retrieved later, so use the value you saved from Step 2.

**Final .env.test example**:
```bash
AZURE_SUBSCRIPTION_ID=12345678-90ab-cdef-1234-567890abcdef
AZURE_REGION=uksouth
ACR_NAME=fluxtestrepo1234567890
ACR_LOGIN_SERVER=fluxtestrepo1234567890.azurecr.io
ACR_IMAGE_TAG=test:latest
AZURE_CLIENT_ID=abcdef12-3456-7890-abcd-ef1234567890
AZURE_TENANT_ID=fedcba98-7654-3210-fedc-ba9876543210
AZURE_CLIENT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
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

async function testACRAuthentication() {
  // Initialize the service with our mock
  registryAuthService.initialize(MockImageVerifier);

  // ACR configuration
  const acrConfig = {
    type: "azure-acr",
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    tenantId: process.env.AZURE_TENANT_ID,
  };

  const imageTag = `${process.env.ACR_LOGIN_SERVER}/${process.env.ACR_IMAGE_TAG}`;

  try {
    // Test authentication (use registry domain, not full repo URI)
    const acrRegistryUrl = process.env.ACR_LOGIN_SERVER;
    console.log("Testing ACR authentication...");
    const testResult = await registryAuthService.testAuthentication(
      acrConfig,
      acrRegistryUrl
    );
    console.log("Auth test result:", testResult);

    // Test provider creation directly
    console.log("Creating ACR auth provider...");
    const provider = registryAuthService.createProvider(
      acrRegistryUrl,
      acrConfig
    );

    // Test credential retrieval
    console.log("Getting ACR credentials...");
    const credentials = await provider.getCredentials();
    console.log("✅ Successfully obtained ACR credentials");
    console.log("Username:", credentials.username); // Should be '00000000-0000-0000-0000-000000000000'
    console.log("Token expires:", new Date(credentials.expiresAt));
    console.log("Registry name:", credentials.registryName);

    console.log("✅ ACR authentication test successful!");
    return true;
  } catch (error) {
    console.error("❌ ACR authentication test failed:", error.message);
    return false;
  }
}

// Run the test
testACRAuthentication();
```

### FluxOS App Spec Integration Test

**Important**: FluxOS requires the `repoauth` field to be a **string**, not an object. Use the string encoding format for provider-based authentication.

```javascript
const {
  registryAuthService,
} = require("../../../ZelBack/src/services/registryAuth/services/registryAuthService");

async function testFluxOSAppSpecIntegration() {
  // Mock FluxOS app specification with ACR authentication
  // NOTE: repoauth MUST be a string in FluxOS format
  // Azure client secrets are URL-safe (only contain: a-z A-Z 0-9 - _ . ~)
  // No URL encoding needed!
  const mockAppSpec = {
    name: "test-acr-app",
    version: 8,
    compose: [
      {
        name: "web",
        repotag: `${process.env.ACR_LOGIN_SERVER}/${process.env.ACR_IMAGE_TAG}`,
        // String format: provider://param1=value1&param2=value2
        repoauth: `azure-acr://clientId=${process.env.AZURE_CLIENT_ID}&clientSecret=${process.env.AZURE_CLIENT_SECRET}&tenantId=${process.env.AZURE_TENANT_ID}`,
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
  const basicAuth = "username:password";
  const basicResult = RepoAuthParser.parse(basicAuth);
  console.log("Basic auth:", basicResult);
  // Output: { type: 'basic', username: 'username', password: 'password' }

  // Test Azure ACR provider format
  // NOTE: Azure client secrets only contain URL-safe characters (a-z A-Z 0-9 - _ . ~)
  // No URL encoding needed!
  const acrAuth = `azure-acr://clientId=${process.env.AZURE_CLIENT_ID}&clientSecret=${process.env.AZURE_CLIENT_SECRET}&tenantId=${process.env.AZURE_TENANT_ID}`;
  const acrResult = RepoAuthParser.parse(acrAuth);
  console.log("Azure ACR:", acrResult);
  // Output: { type: 'azure-acr', clientId: '12345678-...', clientSecret: '...', tenantId: '87654321-...' }

  // Test roundtrip encoding
  const encoded = RepoAuthParser.encode(acrResult);
  console.log("Re-encoded:", encoded);

  console.log("✅ String format tests completed");
}

testStringFormats();
```

## Step 6: Performance Testing

### Token Caching Test

```javascript
async function testTokenCaching() {
  const acrConfig = {
    type: "azure-acr",
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    tenantId: process.env.AZURE_TENANT_ID,
  };

  const provider = registryAuthService.createProvider(
    process.env.ACR_LOGIN_SERVER,
    acrConfig
  );

  console.log("Testing token caching performance...");

  // First call - should fetch from Azure
  const start1 = Date.now();
  const creds1 = await provider.getCredentials();
  const time1 = Date.now() - start1;
  console.log(`First call (Azure Identity API): ${time1}ms`);

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
    type: "azure-acr",
    clientId: "00000000-0000-0000-0000-000000000000", // Invalid client ID
    clientSecret: "invalid-secret",
    tenantId: process.env.AZURE_TENANT_ID,
  };

  console.log("Testing invalid credentials handling...");

  const testResult = await registryAuthService.testAuthentication(
    invalidConfig,
    process.env.ACR_LOGIN_SERVER
  );

  if (
    !testResult.success &&
    testResult.error.includes("Azure ACR authentication failed")
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

### Tenant Mismatch Test

```javascript
async function testTenantMismatch() {
  const config = {
    type: "azure-acr",
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    tenantId: "00000000-0000-0000-0000-000000000000", // Invalid tenant
  };

  console.log("Testing tenant mismatch handling...");

  const provider = registryAuthService.createProvider(
    process.env.ACR_LOGIN_SERVER,
    config
  );

  try {
    await provider.getCredentials();
    console.log("❌ Tenant mismatch should have failed");
    return false;
  } catch (error) {
    console.log("✅ Tenant mismatch properly handled:", error.message);
    return true;
  }
}

testTenantMismatch();
```

### Permission Denied Test

```javascript
async function testPermissionDenied() {
  // Note: This test requires a service principal without ACR permissions
  // You can create one specifically for this test or temporarily remove permissions

  console.log("Testing permission denied scenarios...");
  console.log("Note: This test requires manually removing ACR permissions from the service principal");

  // Create a service principal without ACR permissions for testing
  // az ad sp create-for-rbac --name "flux-acr-no-perms-sp" --skip-assignment

  const restrictedConfig = {
    type: "azure-acr",
    clientId: "service-principal-without-acr-permissions",
    clientSecret: "test-secret",
    tenantId: process.env.AZURE_TENANT_ID,
  };

  try {
    const provider = registryAuthService.createProvider(
      process.env.ACR_LOGIN_SERVER,
      restrictedConfig
    );

    // This might succeed for token generation but fail during actual registry access
    const credentials = await provider.getCredentials();
    console.log("⚠️  Credentials obtained, but may fail during actual registry access");
    console.log("Note: Azure Identity validates service principal but not ACR-specific permissions");
    return true;
  } catch (error) {
    if (error.message.includes("permission") || error.message.includes("access") || error.message.includes("unauthorized")) {
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

After testing, clean up Azure resources:

```bash
# Delete the container registry (and all images in it)
az acr delete --name $ACR_NAME --resource-group $RESOURCE_GROUP_NAME --yes

# Delete the service principal
az ad sp delete --id $(az ad sp list --display-name "flux-acr-test-sp" --query "[0].appId" --output tsv)

# Delete the resource group (if created specifically for this test)
az group delete --name $RESOURCE_GROUP_NAME --yes --no-wait

# Remove local files
rm -f .env.test

echo "✅ Cleanup completed"
```

## 💰 Cost Information (Free Account Safe!)

### Azure Free Tier (2025)

- **Container Registry Basic**: $5/month for 10 GB storage - **NOT FREE** ⚠️
- **Service Principal**: Free to create and use ✅
- **Azure Identity API calls**: Free ✅
- **Data Transfer**: First 5 GB/month free - our test uses ~50 MB ✅

### Test Cost Breakdown

- **Registry creation (Basic SKU)**: ~$5/month (prorated for test duration)
- **Test image (nginx:alpine)**: ~50 MB storage - Included in Basic plan
- **Azure Identity token generation**: Free
- **Data transfer**: Minimal (~50 MB) - Free
- **Estimated test cost**: **~$1.00** for a few days of testing 💰

### Cost Optimization

```bash
# Check ACR usage and costs
az acr show-usage --name $ACR_NAME --resource-group $RESOURCE_GROUP_NAME

# Monitor storage usage
az acr repository list --name $ACR_NAME
az acr manifest list-metadata --name $ACR_NAME --repository test

# Delete test images to reduce storage
az acr repository delete --name $ACR_NAME --repository test --yes
```

### Free Alternatives

For completely free testing, consider:
- Use **Azure Container Instances** with public images
- Test with **Docker Hub** using basic auth (free tier available)
- Use **GitHub Container Registry** (free for public repos)

## Expected Results

- **Authentication Test**: Should succeed with valid service principal credentials
- **Token Caching**: Second call should be significantly faster (>5x)
- **Token Duration**: OAuth tokens valid for 3 hours (vs 12h AWS, 60min Google)
- **Error Handling**: Invalid credentials should fail gracefully
- **FluxOS Integration**: Should work seamlessly with app specifications

## Troubleshooting

### Common Issues

1. **"AADSTS70011: Invalid scope"**: Check service principal has correct ACR permissions
2. **"Registry does not exist"**: Verify ACR name and subscription
3. **"Authentication failed"**: Check clientId, clientSecret, and tenantId values
4. **"Forbidden"**: Service principal lacks AcrPull role on the registry
5. **"Registry name not available"**: ACR names must be globally unique

### Debug Mode

Enable debug logging:

```javascript
// Enable verbose logging
process.env.DEBUG = "flux-registry-auth:*";

// Enable Azure Identity debug (lots of output)
process.env.AZURE_LOG_LEVEL = "verbose";
```

### Common ACR Registry URL Patterns

- **Correct**: `myregistry.azurecr.io`
- **With region**: Some registries may include region (rare): `myregistry.westus.azurecr.io`
- **Incorrect**: `myregistry.azurecr.com` (wrong TLD)

### Service Principal Validation

```bash
# Validate service principal exists and get details
az ad sp show --id $AZURE_CLIENT_ID

# Check service principal permissions on ACR
az role assignment list --assignee $AZURE_CLIENT_ID --scope "/subscriptions/$(az account show --query id --output tsv)/resourceGroups/$RESOURCE_GROUP_NAME/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME"

# Test service principal login
az login --service-principal --username $AZURE_CLIENT_ID --password $AZURE_CLIENT_SECRET --tenant $AZURE_TENANT_ID

# Test ACR access with service principal
az acr login --name $ACR_NAME
```

### Manual Docker Authentication Test

```bash
# Test service principal authentication manually
az login --service-principal --username $AZURE_CLIENT_ID --password $AZURE_CLIENT_SECRET --tenant $AZURE_TENANT_ID

# Login to ACR
az acr login --name $ACR_NAME

# Try pulling the test image
docker pull $ACR_LOGIN_SERVER/test:latest
```

### Azure Identity Token Test

```bash
# Test token generation manually
az account get-access-token --resource https://management.azure.com/

# Test with service principal
az login --service-principal --username $AZURE_CLIENT_ID --password $AZURE_CLIENT_SECRET --tenant $AZURE_TENANT_ID
az account get-access-token --resource https://management.azure.com/
```

## Monitoring

Monitor Azure ACR usage in Azure Portal:

- **Container Registry → Repositories** - View repository and image details
- **Container Registry → Access keys** - Manage admin and service principal access
- **Azure Active Directory → App registrations** - Monitor service principal usage
- **Monitor → Metrics** - Set up alerts for registry usage and costs
- **Cost Management + Billing** - Track ACR costs and usage

## Cleanup (Important - Avoid Ongoing Costs)

**Complete all cleanup steps to avoid ongoing charges**:

### Step 1: Delete Container Registry

```bash
# Delete the container registry (this removes all stored images)
az acr delete --name $ACR_NAME --resource-group $RESOURCE_GROUP_NAME --yes

# Verify deletion
az acr list --resource-group $RESOURCE_GROUP_NAME --output table
```

### Step 2: Delete Service Principal

```bash
# Get service principal app ID (if you didn't save it)
az ad sp list --display-name "flux-acr-test-sp" --query "[].appId" --output tsv

# Delete service principal
az ad sp delete --id $(az ad sp list --display-name "flux-acr-test-sp" --query "[0].appId" --output tsv)

# Verify deletion
az ad sp list --display-name "flux-acr-test-sp" --output table
```

### Step 3: Delete Resource Group (Optional)

If you created a dedicated resource group for testing:

```bash
# Warning: This deletes ALL resources in the group
az group delete --name $RESOURCE_GROUP_NAME --yes --no-wait

# Verify deletion (will show "not found" when complete)
az group show --name $RESOURCE_GROUP_NAME
```

### Step 4: Verify No Charges

1. Go to Azure Portal → **Cost Management + Billing**
2. View **Cost analysis** for your subscription
3. Filter by:
   - Resource group: `flux-test-rg`
   - Service: `Container Registry`
4. Verify no ongoing charges

### Local Cleanup

```bash
# Remove test images from local Docker
docker rmi $ACR_LOGIN_SERVER/test:latest
docker rmi alpine:latest

# Remove environment variables
unset ACR_NAME
unset ACR_LOGIN_SERVER
unset AZURE_CLIENT_ID
unset AZURE_CLIENT_SECRET
unset AZURE_TENANT_ID
unset RESOURCE_GROUP_NAME
unset AZURE_REGION
```

**Final Verification**: Check Azure Portal to confirm no remaining Container Registry resources are listed.

This should help verify that the ACR setup is working correctly before testing with the Node.js integration.