# FluxOS Registry Authentication Documentation

This directory contains comprehensive guides for configuring and testing FluxOS registry authentication with major cloud providers.

## Overview

FluxOS supports advanced authentication for private container registries hosted on AWS ECR, Azure ACR, and Google Artifact Registry. These guides walk you through setting up live testing environments and integrating cloud provider authentication into your FluxOS applications.

## Available Guides

### [AWS ECR Setup](./aws-ecr/AWS_ECR_SETUP.md)
Complete guide for setting up and testing AWS Elastic Container Registry (ECR) authentication.

**Topics Covered:**
- AWS CLI configuration and ECR repository creation
- IAM user and policy setup with minimal permissions
- Environment configuration and credential management
- Docker pull integration testing
- Token caching and performance testing
- Cost information (Free Tier safe)

**Example Files:** See `aws-ecr/examples/`

---

### [Azure ACR Setup](./azure-acr/AZURE_ACR_SETUP.md)
Complete guide for setting up and testing Azure Container Registry (ACR) authentication.

**Topics Covered:**
- Azure CLI configuration and ACR repository creation
- Service principal creation with role-based access control
- Environment configuration and credential management
- OAuth token authentication and caching
- Error handling and troubleshooting
- Cost information (~$1 for testing)

**Example Files:** See `azure-acr/examples/`

---

### [Google Artifact Registry Setup](./google-gar/GOOGLE_GAR_SETUP.md)
Complete guide for setting up and testing Google Artifact Registry (GAR) authentication.

**Topics Covered:**
- Google Cloud CLI configuration and GAR repository creation
- Service account creation and IAM roles
- Base64-encoded JSON key file management
- OAuth2 token authentication
- Performance testing and token caching
- Cost information (Free Tier safe)

**Example Files:** See `google-gar/examples/`

---

### [Repoauth String Format Specification](./REPOAUTH_STRING_FORMAT.md)
Technical specification for FluxOS `repoauth` field encoding format.

**Topics Covered:**
- Basic authentication format (backward compatible)
- Provider-based authentication URI scheme
- Parameter encoding and validation
- FluxOS app specification examples
- Migration guide from object to string format
- Security considerations

## Quick Start

1. **Choose your cloud provider** and navigate to the appropriate guide:
   - AWS ECR: `aws-ecr/AWS_ECR_SETUP.md`
   - Azure ACR: `azure-acr/AZURE_ACR_SETUP.md`
   - Google GAR: `google-gar/GOOGLE_GAR_SETUP.md`

2. **Follow the prerequisites** section to ensure you have the necessary tools installed:
   - Cloud provider CLI (aws-cli, az, or gcloud)
   - Docker
   - Node.js environment

3. **Set up your test environment** by following the step-by-step guide to:
   - Create a container registry
   - Configure authentication credentials
   - Push a test image
   - Run integration tests

4. **Integrate with FluxOS** using the `repoauth` string format:
   ```javascript
   // AWS ECR
   "repoauth": "aws-ecr://region=us-east-1&accessKeyId=AKIA...&secretAccessKey=..."

   // Azure ACR
   "repoauth": "azure-acr://clientId=12345678-...&clientSecret=...&tenantId=87654321-..."

   // Google GAR
   "repoauth": "google-gar://keyFile=BASE64_ENCODED_JSON"
   ```

## Authentication Flow

1. **FluxOS receives** an app specification with a `repoauth` string
2. **Parser decodes** the authentication configuration
3. **Provider factory** creates the appropriate auth provider (AWS, Azure, or Google)
4. **Provider fetches** short-lived credentials/tokens from cloud APIs
5. **Credentials are cached** to minimize API calls
6. **Image verification** proceeds with authenticated registry access

## Running Example Tests

Each provider directory includes example test scripts in the `examples/` subdirectory:

### AWS ECR
```bash
cd aws-ecr/examples
# Create .env.test with your AWS credentials
node authTest.js      # Test authentication only
node testPull.js      # Full Docker pull test
```

### Azure ACR
```bash
cd azure-acr/examples
# Create .env.test with your Azure credentials
node authTest.js      # Test authentication
```

### Google GAR
```bash
cd google-gar/examples
# Create .env.test with your Google credentials
node authTest.js      # Test authentication
```

## Implementation Details

The registry authentication system is implemented in the FluxOS codebase at:

- **Core Service**: `ZelBack/src/services/registryAuth/services/registryAuthService.js`
- **Provider Factory**: `ZelBack/src/services/registryAuth/services/authProviderFactory.js`
- **String Parser**: `ZelBack/src/services/registryAuth/utils/repoAuthParser.js`
- **Providers**:
  - AWS ECR: `ZelBack/src/services/registryAuth/providers/awsEcrAuthProvider.js`
  - Azure ACR: `ZelBack/src/services/registryAuth/providers/azureAcrAuthProvider.js`
  - Google GAR: `ZelBack/src/services/registryAuth/providers/googleGarAuthProvider.js`

## Key Features

### Token Caching
All providers implement intelligent token caching to minimize API calls:
- **AWS ECR**: 12-hour token validity
- **Azure ACR**: 3-hour token validity
- **Google GAR**: 60-minute token validity

Cached tokens are automatically refreshed before expiration.

### Error Handling
Comprehensive error handling for:
- Invalid credentials
- Expired tokens
- Network issues
- Permission denied scenarios
- Region/project mismatches

### Security
- Credentials are encrypted in FluxOS app specifications (v7+)
- URL encoding handles special characters safely
- Minimal IAM permissions required for each provider
- No long-lived credentials stored on nodes

## Cost Optimization

All guides include detailed cost information:

- **AWS ECR**: Free Tier safe - no charges for testing
- **Azure ACR**: ~$1 for testing (remember to clean up resources)
- **Google GAR**: Free Tier safe - 0.5 GB storage free

Each guide includes cleanup instructions to avoid ongoing charges.

## Troubleshooting

Common issues and solutions are documented in each provider's guide:

1. **Authentication failures**: Check credentials and permissions
2. **Network timeouts**: Verify region/project configuration
3. **Token expiration**: Review caching logic and expiry times
4. **Docker pull failures**: Enable debug logging to diagnose

### Debug Mode

Enable verbose logging in your tests:

```javascript
// Enable FluxOS registry auth debug logging
process.env.DEBUG = "flux-registry-auth:*";

// Enable provider-specific logging
process.env.AWS_SDK_LOG_LEVEL = "debug";        // AWS
process.env.AZURE_LOG_LEVEL = "verbose";        // Azure
process.env.GOOGLE_AUTH_LIBRARY_DEBUG = "true"; // Google
```

## Support

For issues or questions:
- Review the troubleshooting section in each guide
- Check the implementation reference for code paths
- Examine the example test scripts for working configurations

## Contributing

When updating these guides:
1. Keep examples practical and tested
2. Update cost information annually
3. Include troubleshooting for common issues
4. Maintain backward compatibility notes
5. Test all code examples before documenting
