# Integration Testing - API Response Capture

This directory contains scripts to capture real API responses from cloud container registry providers. These captured responses are sanitized and used as fixtures in unit tests.

## Purpose

- **Capture Real API Structures**: Get actual response formats from AWS ECR, Azure ACR, and Google Artifact Registry
- **Create Test Fixtures**: Sanitize sensitive data and save as JSON fixtures for mocking
- **Maintain Test Accuracy**: Keep tests aligned with real provider API responses
- **Enable Fast Testing**: Use fixtures instead of making real API calls in unit tests

## Directory Structure

```
integration/
├── fixtures/                    # Generated API response fixtures (gitignored)
│   ├── aws-ecr-response.json
│   ├── azure-acr-response.json
│   └── google-gar-response.json
├── capture-aws-ecr.js           # AWS ECR response capture script
├── capture-azure-acr.js         # Azure ACR response capture script
├── capture-google-gar.js        # Google GAR response capture script
├── capture-all.js               # Master script to run all captures
└── README.md                    # This file
```

## Setup

### 1. Install Dependencies

Ensure all required dependencies are installed:

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env.test` file in the project root with your credentials:

```bash
# AWS ECR
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# Azure ACR
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
AZURE_REGISTRY_NAME=myregistry

# Google Artifact Registry
GOOGLE_CLIENT_EMAIL=sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_PROJECT_ID=my-project
```

**⚠️ IMPORTANT**: Never commit `.env.test` to version control. It's already in `.gitignore`.

## Usage

### Capture All Provider Responses

Run all capture scripts at once:

```bash
node integration/capture-all.js
```

This will:
- Make real API calls to AWS ECR, Azure ACR, and Google GAR
- Sanitize the responses (replace sensitive tokens with mock data)
- Save fixtures to `integration/fixtures/`
- Display a summary of successes and failures

### Capture Individual Provider Responses

Run individual capture scripts:

```bash
# AWS ECR only
node integration/capture-aws-ecr.js

# Azure ACR only
node integration/capture-azure-acr.js

# Google Artifact Registry only
node integration/capture-google-gar.js
```

## Captured Response Format

Each fixture contains two top-level objects:

1. **apiResponse**: The sanitized API response
   - **EXACT same structure** as the raw API response
   - Sensitive data replaced with mock values
   - Expiry times adjusted for testing
   - Preserves all metadata fields from the original API

2. **fixtureMetadata**: Information about the capture and sanitization
   - Capture timestamp
   - Provider name
   - API call made
   - Fields that were sanitized
   - Original data characteristics (lengths, expiry times, etc.)
   - Notes about what was changed

### Example Fixture Structure

```json
{
  "apiResponse": {
    "$metadata": {
      "httpStatusCode": 200,
      "requestId": "4e7a5378-e420-454e-aabf-cf4fe38c8514",
      "attempts": 1,
      "totalRetryDelay": 0
    },
    "authorizationData": [{
      "authorizationToken": "QVdTOk1PQ0tfRUNSX1BBU1NXT1JEX1hYWFhYWC4uLg==",
      "expiresAt": "2025-10-23T12:00:00Z",
      "proxyEndpoint": "https://123456.dkr.ecr.us-east-1.amazonaws.com"
    }]
  },
  "fixtureMetadata": {
    "capturedAt": "2025-10-22T12:00:00Z",
    "provider": "aws-ecr",
    "apiCall": "GetAuthorizationTokenCommand",
    "region": "us-east-1",
    "sanitized": true,
    "sanitizedFields": ["authorizationData[0].authorizationToken", "authorizationData[0].expiresAt"],
    "notes": "Authorization token replaced with mock data of similar length. Expiry set to a random time between 1-7 days in the future.",
    "originalTokenLength": 1234,
    "username": "AWS"
  }
}
```

## Using Fixtures in Unit Tests

Import and use the captured fixtures to mock API responses:

```javascript
// Import the fixture
const awsFixture = require('../integration/fixtures/aws-ecr-response.json');

// Use with Sinon to mock AWS SDK
const { ECRClient } = require('@aws-sdk/client-ecr');
const sinon = require('sinon');

// Mock the ECR client send method with the apiResponse
sinon.stub(ECRClient.prototype, 'send').resolves(awsFixture.apiResponse);

// Now your provider tests will use the fixture data
const provider = new AWSECRAuthProvider(config);
const credentials = await provider.getCredentials();

// You can also access metadata about the fixture
console.log('Fixture captured at:', awsFixture.fixtureMetadata.capturedAt);
console.log('Sanitized fields:', awsFixture.fixtureMetadata.sanitizedFields);
```

## Sanitization Details

### What Gets Sanitized

- **Access Tokens**: Replaced with `MOCK_*_TOKEN` strings of similar length
- **Passwords**: Replaced with placeholder characters
- **Private Keys**: Not captured (only used to authenticate)
- **Secrets**: All sensitive strings replaced

### What Gets Preserved

- **Response Structure**: Exact JSON structure from real APIs
- **Field Names**: All field names kept unchanged
- **Data Types**: Types preserved (strings, numbers, dates)
- **Metadata**: Registry URLs, usernames, regions, project IDs

### Expiry Time Adjustment

Token expiry times are set to a random time between 1-7 days in the future from capture time. This:
- Ensures fixtures remain valid for testing
- Prevents calculating the original expiry time from the capture timestamp
- Maintains security by not revealing timing patterns

## Security Considerations

### ✅ Safe Practices

- Fixtures are sanitized before saving
- Real tokens are never stored
- `.env.test` is gitignored
- `fixtures/` directory is gitignored

### ⚠️ Important Warnings

- **Never commit real credentials** to version control
- **Review fixtures** before sharing to ensure no sensitive data leaked
- **Rotate credentials** after capturing if fixtures are shared publicly
- **Use test accounts** with minimal permissions for capture scripts

## Troubleshooting

### "Missing required environment variables"

**Cause**: Environment variables not set in `.env.test`

**Solution**: Create or update `.env.test` with all required variables for the provider you're capturing.

### "API call failed: UnrecognizedClientException"

**Cause**: Invalid AWS credentials

**Solution**: Verify your AWS credentials are correct and have ECR permissions.

### "API call failed: invalid_client"

**Cause**: Invalid Azure credentials

**Solution**: Verify Azure tenant ID, client ID, and client secret are correct.

### "API call failed: invalid_grant"

**Cause**: Invalid Google service account credentials

**Solution**: Verify the private key is in correct PEM format with newlines (`\n`).

## Updating Fixtures

When to regenerate fixtures:

1. **Provider API Changes**: When cloud providers update their API response formats
2. **New Features**: When adding support for new provider features
3. **Test Failures**: When unit tests fail due to outdated fixture structure
4. **Regular Maintenance**: Every 6 months to ensure fixtures stay current

To update fixtures:

```bash
# Regenerate all fixtures
node integration/capture-all.js

# Or regenerate specific provider
node integration/capture-aws-ecr.js
```

## Integration with Unit Tests

Fixtures are designed to be imported directly into unit tests:

### Example Test Structure

```javascript
// tests/unit/awsEcrAuthProvider.test.js
const { expect } = require('chai');
const sinon = require('sinon');
const { AWSECRAuthProvider } = require('../../src/providers/awsEcrAuthProvider');
const awsFixture = require('../../integration/fixtures/aws-ecr-response.json');

describe('AWSECRAuthProvider', () => {
  it('should parse ECR authorization response correctly', async () => {
    // Mock the AWS SDK call with the apiResponse from our fixture
    const ecrStub = sinon.stub().resolves(awsFixture.apiResponse);

    // Test the provider with mocked response
    const provider = new AWSECRAuthProvider(config);
    const credentials = await provider.getCredentials();

    // Verify the provider correctly parsed the fixture
    expect(credentials.username).to.equal('AWS');
    expect(credentials.password).to.exist;
  });
});
```

## Benefits

✅ **Realistic Tests**: Tests use actual API response structures
✅ **Fast Execution**: No real API calls during unit tests
✅ **Reproducible**: Same fixtures across all test runs
✅ **Maintainable**: Easy to update when APIs change
✅ **Documented**: Response structures are captured and visible
✅ **Safe**: Sensitive data removed before storage

## Contributing

When adding new providers:

1. Create a new `capture-{provider}.js` script
2. Follow the existing pattern (see capture-aws-ecr.js as reference)
3. Add the provider to `capture-all.js`
4. Update this README with provider-specific instructions
5. Test the capture script before committing
6. Document required environment variables

## Additional Resources

- [AWS ECR Authentication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html)
- [Azure ACR Authentication](https://learn.microsoft.com/en-us/azure/container-registry/)
- [Google Artifact Registry Authentication](https://cloud.google.com/artifact-registry/docs/docker/authentication)

---

**Last Updated**: October 22, 2025
**Maintainer**: FluxOS Development Team
