# AWS ECR Live Testing Environment Setup

This guide walks through setting up a real AWS ECR environment for testing the authentication integration layer.

**Example Files**: All code examples and test scripts referenced in this guide can be found in the `examples/` subdirectory.

## Prerequisites

1. **AWS Account** with ECR access
2. **AWS CLI** installed and configured
3. **Docker** installed locally
4. **Node.js** environment with the authentication integration

### AWS CLI Pager Configuration

By default, AWS CLI uses a pager (like `less` or `more`) for long output, which can be inconvenient for scripts or when you want direct stdout output.

To disable the pager and get direct output:

```bash
# Disable pager for current session
export AWS_PAGER=""

# Make it permanent by adding to your shell profile
echo 'export AWS_PAGER=""' >> ~/.bashrc  # or ~/.zshrc for zsh
```

This ensures commands like `aws ecr describe-repositories` output directly to stdout without pagination.

## Step 1: Create AWS ECR Repository

### Using AWS CLI

```bash
# Choose your region (recommended for your location):
# Wales, UK: eu-west-2 (London) - BEST CHOICE
# Alternative: eu-west-1 (Ireland)
export AWS_REGION=eu-west-2

# Create a new ECR repository
aws ecr create-repository \
    --repository-name flux-test-repo \
    --region $AWS_REGION

# Get the repository URI (save this for later)
aws ecr describe-repositories \
    --repository-names flux-test-repo \
    --region $AWS_REGION \
    --query 'repositories[0].repositoryUri' \
    --output text
```

### Using AWS Console

1. Go to AWS ECR Console
2. **Change region** to `eu-west-2` (London) in top-right corner
3. Click "Create repository"
4. Repository name: `flux-test-repo`
5. Keep other settings as default
6. Click "Create repository"

## Step 2: Create IAM User for Testing

### Create IAM Policy

Create a policy with minimal ECR permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:DescribeRepositories",
        "ecr:ListImages"
      ],
      "Resource": "*"
    }
  ]
}
```

### Create IAM User

```bash
# Create IAM user
aws iam create-user --user-name flux-ecr-test-user

# Create and attach policy
# The ecr-test-policy.json file is available in the examples/ subdirectory
aws iam put-user-policy \
    --user-name flux-ecr-test-user \
    --policy-name FluxECRTestPolicy \
    --policy-document file://examples/ecr-test-policy.json

# Create access keys
aws iam create-access-key --user-name flux-ecr-test-user
```

**Save the Access Key ID and Secret Access Key** - you'll need these for testing.

## Step 3: Push a Test Image to ECR

```bash
# Get your AWS Account ID (save this as a variable)
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
echo "Your AWS Account ID: $AWS_ACCOUNT_ID"

# Construct the ECR registry URL
export ECR_REGISTRY_URL="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
echo "ECR Registry URL: $ECR_REGISTRY_URL"

# Get login token for ECR
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY_URL

# Pull a simple test image
docker pull nginx:alpine

# Tag for ECR
docker tag nginx:alpine $ECR_REGISTRY_URL/flux-test-repo:test

# Push to ECR
docker push $ECR_REGISTRY_URL/flux-test-repo:test
```

**Note**: The `aws sts get-caller-identity` command automatically gets your AWS Account ID from your current AWS CLI session.

## Step 4: Environment Configuration

Create a `.env.test` file for testing:

```bash
# AWS ECR Test Configuration
# Use the values from the commands above
AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID  # From: aws sts get-caller-identity
AWS_REGION=$AWS_REGION          # Set above (e.g., eu-west-2)
AWS_ACCESS_KEY_ID=AKIA...       # From IAM user creation
AWS_SECRET_ACCESS_KEY=...       # From IAM user creation
ECR_REPOSITORY_URI=$ECR_REGISTRY_URL/flux-test-repo  # From: describe-repositories
ECR_IMAGE_TAG=test
```

## Step 5: Test Docker Pull with Generated Credentials

### Verify Image Pull Works

After pushing the test image, verify you can pull it using the authentication from our integration:

```bash
# First, logout from Docker to ensure we're testing fresh authentication
docker logout $ECR_REGISTRY_URL

# Test pulling without authentication (should fail)
echo "Testing pull without auth (should fail)..."
docker pull $ECR_REGISTRY_URL/flux-test-repo:test 2>&1 | grep -q "no basic auth credentials" && echo "✅ Correctly failed without auth"

# Now test with our integration layer
```

```javascript
// examples/testPull.js - Docker pull integration test
require("dotenv").config({ path: ".env.test" });
const { execSync } = require("child_process");
const {
  AuthProviderFactory,
} = require("../../../ZelBack/src/services/registryAuth/services/authProviderFactory");

async function testDockerPullWithIntegration() {
  console.log("Testing Docker pull with ECR integration...\n");

  const ecrConfig = {
    type: "aws-ecr",
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };

  const registryUrl = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com`;
  const imageTag = `${registryUrl}/flux-test-repo:test`;

  try {
    // Step 1: Get credentials from our integration
    console.log("1. Getting ECR credentials from integration layer...");
    const provider = AuthProviderFactory.createProvider(registryUrl, ecrConfig);
    const credentials = await provider.getCredentials();

    console.log(`   ✅ Got credentials - Username: ${credentials.username}`);
    console.log(`   ✅ Token expires: ${new Date(credentials.expiresAt)}`);

    // Step 2: Login to Docker using our credentials
    console.log("\n2. Logging into Docker with integration credentials...");
    const loginCmd = `echo "${credentials.password}" | docker login --username ${credentials.username} --password-stdin ${registryUrl}`;
    execSync(loginCmd, { stdio: "pipe" });
    console.log("   ✅ Docker login successful");

    // Step 3: Pull the image
    console.log("\n3. Pulling image from ECR...");
    console.log(`   Image: ${imageTag}`);
    const pullOutput = execSync(`docker pull ${imageTag}`, {
      encoding: "utf8",
    });

    // Verify the pull succeeded
    if (
      pullOutput.includes("Pull complete") ||
      pullOutput.includes("Image is up to date")
    ) {
      console.log("   ✅ Image pulled successfully!");

      // Step 4: Verify the image exists locally
      console.log("\n4. Verifying image exists locally...");
      const images = execSync(
        `docker images --format "{{.Repository}}:{{.Tag}}" | grep ${registryUrl}/flux-test-repo`,
        { encoding: "utf8" }
      );
      console.log(`   ✅ Image found locally: ${images.trim()}`);

      // Step 5: Test running the container
      console.log("\n5. Testing container run...");
      const containerName = "flux-test-container";
      execSync(`docker rm -f ${containerName} 2>/dev/null || true`, {
        stdio: "pipe",
      });

      const runOutput = execSync(
        `docker run -d --name ${containerName} ${imageTag}`,
        { encoding: "utf8" }
      ).trim();

      console.log(`   ✅ Container started: ${runOutput.substring(0, 12)}`);

      // Check container status
      const status = execSync(
        `docker inspect ${containerName} --format='{{.State.Status}}'`,
        { encoding: "utf8" }
      ).trim();

      console.log(`   ✅ Container status: ${status}`);

      // Cleanup
      execSync(`docker rm -f ${containerName}`, { stdio: "pipe" });
      console.log("   ✅ Cleanup completed");

      console.log(
        "\n🎉 SUCCESS: Docker pull and run worked with ECR authentication!"
      );
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
    // Logout after test
    console.log("\n6. Logging out from Docker...");
    execSync(`docker logout ${registryUrl}`, { stdio: "pipe" });
    console.log("   ✅ Logged out");
  }
}

// Run the test
testDockerPullWithIntegration();
```

### Expected Output

When running the test above, you should see:

```
Testing Docker pull with ECR integration...

1. Getting ECR credentials from integration layer...
   ✅ Got credentials - Username: AWS
   ✅ Token expires: [12 hours from now]

2. Logging into Docker with integration credentials...
   ✅ Docker login successful

3. Pulling image from ECR...
   Image: 123456789012.dkr.ecr.eu-west-2.amazonaws.com/flux-test-repo:test
   ✅ Image pulled successfully!

4. Verifying image exists locally...
   ✅ Image found locally: 123456789012.dkr.ecr.eu-west-2.amazonaws.com/flux-test-repo:test

5. Testing container run...
   ✅ Container started: abc123def456
   ✅ Container status: running
   ✅ Cleanup completed

🎉 SUCCESS: Docker pull and run worked with ECR authentication!

6. Logging out from Docker...
   ✅ Logged out
```

## Step 6: Test the Integration

### Basic Authentication Test

```javascript
// examples/authTest.js - Basic authentication test
// Load environment variables from .env.test
require("dotenv").config({ path: ".env.test", quiet: true });

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

async function testECRAuthentication() {
  // Initialize the service with our mock
  registryAuthService.initialize(MockImageVerifier);

  // ECR configuration
  const ecrConfig = {
    type: "aws-ecr",
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };

  const imageTag = `${process.env.ECR_REPOSITORY_URI}:${process.env.ECR_IMAGE_TAG}`;

  try {
    // Test authentication (use registry domain, not full repo URI)
    const ecrRegistryUrl = process.env.ECR_REPOSITORY_URI.split("/")[0];
    console.log("Testing ECR authentication...");
    const testResult = await registryAuthService.testAuthentication(
      ecrConfig,
      ecrRegistryUrl
    );
    console.log("Auth test result:", testResult);

    // Test provider creation directly
    console.log("Creating ECR auth provider...");
    const provider = registryAuthService.createProvider(
      ecrRegistryUrl,
      ecrConfig
    );

    // Test credential retrieval
    console.log("Getting ECR credentials...");
    const credentials = await provider.getCredentials();
    console.log("✅ Successfully obtained ECR credentials");
    console.log("Username:", credentials.username);
    console.log("Token expires:", new Date(credentials.expiresAt));

    console.log("✅ ECR authentication test successful!");
    return true;
  } catch (error) {
    console.error("❌ ECR authentication test failed:", error.message);
    return false;
  }
}

// Run the test
testECRAuthentication();
```

### FluxOS App Spec Integration Test

**Important**: FluxOS requires the `repoauth` field to be a **string**, not an object. Use the string encoding format for provider-based authentication.

```javascript
const {
  registryAuthService,
} = require("../../../ZelBack/src/services/registryAuth/services/registryAuthService");

async function testFluxOSAppSpecIntegration() {
  // Mock FluxOS app specification with ECR authentication
  // NOTE: repoauth MUST be a string in FluxOS format
  const mockAppSpec = {
    name: "test-ecr-app",
    version: 8,
    compose: [
      {
        name: "web",
        repotag: `${process.env.ECR_REPOSITORY_URI}:${process.env.ECR_IMAGE_TAG}`,
        // String format: provider://param1=value1&param2=value2
        repoauth: `aws-ecr://region=${process.env.AWS_REGION}&accessKeyId=${process.env.AWS_ACCESS_KEY_ID}&secretAccessKey=${process.env.AWS_SECRET_ACCESS_KEY}`,
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
const { RepoAuthParser } = require("../../../ZelBack/src/services/registryAuth/utils/repoAuthParser");

function testStringFormats() {
  console.log("Testing repoauth string formats...");

  // Test basic auth format (backward compatible)
  const basicAuth = "username:password";
  const basicResult = RepoAuthParser.parse(basicAuth);
  console.log("Basic auth:", basicResult);
  // Output: { type: 'basic', username: 'username', password: 'password' }

  // Test AWS ECR provider format
  const awsAuth = `aws-ecr://region=${process.env.AWS_REGION}&accessKeyId=${process.env.AWS_ACCESS_KEY_ID}&secretAccessKey=${process.env.AWS_SECRET_ACCESS_KEY}`;
  const awsResult = RepoAuthParser.parse(awsAuth);
  console.log("AWS ECR:", awsResult);
  // Output: { type: 'aws-ecr', region: 'eu-west-2', accessKeyId: '...', secretAccessKey: '...' }

  // Test roundtrip encoding
  const encoded = RepoAuthParser.encode(awsResult);
  console.log("Re-encoded:", encoded);

  // Test URL encoding of special characters
  const specialAuth =
    "aws-ecr://region=eu-west-2&secretAccessKey=secret%2Bwith%2Bplus";
  const specialResult = RepoAuthParser.parse(specialAuth);
  console.log("URL decoded:", specialResult.secretAccessKey); // "secret+with+plus"

  console.log("✅ String format tests completed");
}

testStringFormats();
```

## Step 6: Performance Testing

### Token Caching Test

```javascript
async function testTokenCaching() {
  const ecrConfig = {
    type: "aws-ecr",
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };

  const provider = registryAuthService.createProvider(
    process.env.ECR_REPOSITORY_URI,
    ecrConfig
  );

  console.log("Testing token caching performance...");

  // First call - should fetch from AWS
  const start1 = Date.now();
  const creds1 = await provider.getCredentials();
  const time1 = Date.now() - start1;
  console.log(`First call (AWS API): ${time1}ms`);

  // Second call - should use cache
  const start2 = Date.now();
  const creds2 = await provider.getCredentials();
  const time2 = Date.now() - start2;
  console.log(`Second call (cached): ${time2}ms`);

  console.log(`Cache speedup: ${(time1 / time2).toFixed(2)}x faster`);
  console.log("Token expires at:", new Date(provider.cacheExpiryTime));
}

testTokenCaching();
```

## Step 7: Error Handling Tests

### Invalid Credentials Test

```javascript
async function testInvalidCredentials() {
  const invalidConfig = {
    type: "aws-ecr",
    region: process.env.AWS_REGION,
    accessKeyId: "INVALID_KEY",
    secretAccessKey: "INVALID_SECRET",
  };

  console.log("Testing invalid credentials handling...");

  const testResult = await registryAuthService.testAuthentication(
    invalidConfig,
    process.env.ECR_REPOSITORY_URI
  );

  if (
    !testResult.success &&
    testResult.error.includes("AWS ECR authentication failed")
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

### Region Mismatch Test

```javascript
async function testRegionMismatch() {
  const config = {
    type: "aws-ecr",
    region: "us-west-2", // Different region
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };

  console.log("Testing region mismatch handling...");

  const provider = registryAuthService.createProvider(
    `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com`, // Current region registry
    config // Different region credentials
  );

  try {
    await provider.getCredentials();
    console.log("❌ Region mismatch should have failed");
    return false;
  } catch (error) {
    console.log("✅ Region mismatch properly handled:", error.message);
    return true;
  }
}

testRegionMismatch();
```

## Step 8: Cleanup

After testing, clean up AWS resources:

```bash
# Delete ECR repository
aws ecr delete-repository \
    --repository-name flux-test-repo \
    --region $AWS_REGION \
    --force

# Delete IAM user access keys
aws iam list-access-keys --user-name flux-ecr-test-user
aws iam delete-access-key \
    --user-name flux-ecr-test-user \
    --access-key-id <ACCESS_KEY_ID>

# Delete IAM user policy
aws iam delete-user-policy \
    --user-name flux-ecr-test-user \
    --policy-name FluxECRTestPolicy

# Delete IAM user
aws iam delete-user --user-name flux-ecr-test-user
```

## 💰 Cost Information (Free Account Safe!)

### AWS ECR Free Tier (2024)

- **API Calls**: GetAuthorizationToken and other ECR APIs are **FREE** ✅
- **Storage**: 500 MB/month private repos (first year) - our test uses ~50 MB
- **Data Transfer**: 5 TB/month to internet - our test uses ~50 MB
- **Regional Transfer**: ECR ↔ EC2/Lambda is always free

### Test Cost Breakdown

- **Repository creation**: Free
- **Test image (nginx:alpine)**: ~50 MB storage - Free
- **API calls during testing**: ~10-20 calls - Free
- **Data transfer**: Regional only - Free
- **Total estimated cost**: **$0.00** 🎉

### Monitoring Your Usage

```bash
# Check ECR repository sizes
aws ecr describe-repositories --query 'repositories[*].[repositoryName,repositorySizeInBytes]' --output table

# Check your account's free tier usage
aws support describe-trusted-advisor-checks --language en # (requires support plan)

# Simple storage check
aws ecr list-images --repository-name flux-test-repo --query 'length(imageIds)'
```

## Expected Results

- **Authentication Test**: Should succeed with valid AWS credentials
- **Token Caching**: Second call should be significantly faster (>10x)
- **Error Handling**: Invalid credentials should fail gracefully
- **FluxOS Integration**: Should work seamlessly with app specifications

## Troubleshooting

### Common Issues

1. **"Invalid security token"**: Check AWS credentials and region
2. **"Repository does not exist"**: Verify ECR repository URI
3. **"Access denied"**: Check IAM permissions
4. **Network timeouts**: Check AWS region and network connectivity

### Debug Mode

Enable debug logging:

```javascript
// Enable verbose logging
process.env.DEBUG = "flux-registry-auth:*";
```

### Monitoring

Monitor AWS ECR usage in CloudWatch:

- `GetAuthorizationToken` API calls
- `BatchGetImage` operations
- Error rates and latency
