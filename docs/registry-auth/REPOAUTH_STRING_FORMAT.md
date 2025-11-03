# FluxOS Repoauth String Format Specification

This document specifies the string encoding format for FluxOS `repoauth` fields, which maintains backward compatibility while enabling rich authentication configurations for cloud providers.

## Overview

FluxOS requires the `repoauth` field to be a string. To support both traditional basic authentication and modern cloud provider authentication schemes, we use a URI-style encoding format.

## Format Types

### 1. Basic Authentication (Backward Compatible)

**Format**: `"username:password"`

**Example**:
```
"myuser:mypassword"
```

**Characteristics**:
- Maintains 100% backward compatibility with existing FluxOS apps
- Username cannot contain colons, but password can
- Whitespace is automatically trimmed
- Empty passwords are allowed (edge case)

**Examples**:
```javascript
"dockerhub_user:my_secret_password"
"user@domain.com:p@ssw0rd!#$%"
"testuser:password:with:colons"
"admin:"  // Empty password
```

### 2. Provider-Based Authentication (New Format)

**Format**: `"provider://param1=value1&param2=value2"`

**Characteristics**:
- URI scheme detection using provider name
- URL-encoded parameter values for special characters
- Extensible for any cloud provider
- Robust parameter parsing with URLSearchParams

## Provider Schemes

### AWS ECR

**Format**: `"aws-ecr://region=REGION&accessKeyId=KEY&secretAccessKey=SECRET"`

**Required Parameters**:
- `region`: AWS region (e.g., `us-east-1`, `eu-west-2`)

**Authentication Parameters** (one set required):
- Explicit credentials:
  - `accessKeyId`: AWS access key ID
  - `secretAccessKey`: AWS secret access key
  - `sessionToken`: (optional) temporary session token

**Example**:
```
"aws-ecr://region=eu-west-2&accessKeyId=AKIA123456789&secretAccessKey=secretkey123"
```

**With Session Token**:
```
"aws-ecr://region=us-east-1&accessKeyId=AKIA123&secretAccessKey=secret&sessionToken=token123"
```

**Environment Fallback** (if no explicit credentials):
```
"aws-ecr://region=eu-west-2"
```
This relies on AWS environment variables or IAM roles.

### Google Artifact Registry

**Format**: `"google-gar://keyFile=BASE64_ENCODED_JSON"`

**Parameters**:
- `privateKey`: Service account private key (URL-encoded)
- `clientEmail`: Service account email address

**Example**:
```
"google-gar://keyFile=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJpdmF0ZV9rZXkiOiIuLi4iLCJjbGllbnRfZW1haWwiOiIuLi4ifQ=="
```

### Azure ACR

**Format**: `"azure-acr://clientId=CLIENT_ID&clientSecret=CLIENT_SECRET&tenantId=TENANT_ID"`

**Parameters**:
- `clientId`: Azure service principal application ID (GUID)
- `clientSecret`: Azure service principal password/secret
- `tenantId`: Azure Active Directory tenant ID (GUID)

**Note**: Azure client secrets only contain URL-safe characters (`a-z`, `A-Z`, `0-9`, `-`, `_`, `.`, `~`) so **no URL encoding is required**. Simply paste the secret directly.

**Example**:
```
"azure-acr://clientId=12345678-1234-5678-9012-123456789012&clientSecret=Abc123-_.~def&tenantId=87654321-4321-8765-4321-210987654321"
```

## Implementation Details

### Provider Name Validation

Provider names must follow these rules:
- Start with a letter (a-z, A-Z)
- Contain only letters, numbers, and hyphens
- Examples: `aws-ecr`, `google-gar`, `azure-acr`, `custom-provider`

**Valid**: `aws-ecr`, `google-gar`, `azure-acr`, `custom-auth-v2`
**Invalid**: `123provider`, `provider_with_underscores`, `provider.with.dots`

### Parameter Encoding

Parameters are URL-encoded to handle special characters:

```javascript
// Special characters are automatically encoded
"aws-ecr://region=eu-west-2&secretAccessKey=secret%2Bwith%2Bplus"
// Decodes to: secretAccessKey = "secret+with+plus"

// Private keys with newlines are properly encoded
"google-gar://privateKey=-----BEGIN%20PRIVATE%20KEY-----%0A...%0A-----END%20PRIVATE%20KEY-----%0A"
// Decodes to: privateKey = '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n'
```

### Parsing Logic

The parser uses this detection logic:

1. **Scheme Detection**: Check for pattern `/^([a-zA-Z][a-zA-Z0-9-]*):\/\/(.*)$/`
2. **Provider Match**: If scheme found, parse as provider format
3. **Basic Fallback**: If no scheme, parse as `username:password`

```javascript
const { RepoAuthParser } = require('../../ZelBack/src/services/registryAuth/utils/repoAuthParser');

// Basic auth
const basic = RepoAuthParser.parse("user:pass");
// { type: 'basic', username: 'user', password: 'pass' }

// Provider auth
const aws = RepoAuthParser.parse("aws-ecr://region=us-east-1&accessKeyId=AKIA123");
// { type: 'aws-ecr', region: 'us-east-1', accessKeyId: 'AKIA123' }
```

## FluxOS App Specification Examples

### Single Component App with Basic Auth

```javascript
{
  "name": "my-app",
  "version": 7,
  "repotag": "registry.example.com/myapp:latest",
  "repoauth": "username:password"
}
```

### Single Component App with AWS ECR

```javascript
{
  "name": "my-ecr-app",
  "version": 8,
  "repotag": "123456789012.dkr.ecr.eu-west-2.amazonaws.com/myapp:latest",
  "repoauth": "aws-ecr://region=eu-west-2&accessKeyId=AKIA123456789&secretAccessKey=mysecret"
}
```

### Composed App with Mixed Authentication

```javascript
{
  "name": "multi-service-app",
  "version": 8,
  "compose": [
    {
      "name": "web",
      "repotag": "nginx:alpine",
      // No auth needed for public image
    },
    {
      "name": "api",
      "repotag": "registry.company.com/api:v1.2",
      "repoauth": "deploy-user:secret123"
    },
    {
      "name": "worker",
      "repotag": "123456789012.dkr.ecr.us-east-1.amazonaws.com/worker:latest",
      "repoauth": "aws-ecr://region=us-east-1&accessKeyId=AKIA987654321&secretAccessKey=workersecret"
    }
  ]
}
```

## Error Handling

### Invalid Formats

```javascript
// Missing colon in basic auth
"justausername"
// → Error: Basic auth format requires "username:password"

// Empty username
":password"
// → Error: Username cannot be empty or whitespace only

// Invalid provider name
"123invalid://param=value"
// → Treated as basic auth: username="123invalid", password="//param=value"
```

### Malformed Parameters

```javascript
// Invalid URL encoding
"aws-ecr://region=us-east-1&key=%ZZ"
// → Error: Failed to parse provider parameters: Invalid URL encoding
```

## Testing Examples

```javascript
const { RepoAuthParser } = require('../../ZelBack/src/services/registryAuth/utils/repoAuthParser');

// Test basic authentication
console.log(RepoAuthParser.parse('user:pass'));
// Output: { type: 'basic', username: 'user', password: 'pass' }

// Test AWS ECR
console.log(RepoAuthParser.parse('aws-ecr://region=eu-west-2&accessKeyId=AKIA123'));
// Output: { type: 'aws-ecr', region: 'eu-west-2', accessKeyId: 'AKIA123' }

// Test encoding/decoding roundtrip
const config = { type: 'aws-ecr', region: 'us-east-1', accessKeyId: 'AKIA123' };
const encoded = RepoAuthParser.encode(config);
const decoded = RepoAuthParser.parse(encoded);
console.log(decoded.region); // 'us-east-1'
```

## Migration Guide

### From Object Format to String Format

**Before (Object - Not Compatible with FluxOS)**:
```javascript
{
  "repoauth": {
    "type": "aws-ecr",
    "region": "eu-west-2",
    "accessKeyId": "AKIA123"
  }
}
```

**After (String - FluxOS Compatible)**:
```javascript
{
  "repoauth": "aws-ecr://region=eu-west-2&accessKeyId=AKIA123"
}
```

### Conversion Tools

```javascript
// Convert object to FluxOS string format
const { RepoAuthParser } = require('../../ZelBack/src/services/registryAuth/utils/repoAuthParser');

const objectConfig = {
  type: 'aws-ecr',
  region: 'eu-west-2',
  accessKeyId: 'AKIA123',
  secretAccessKey: 'secret'
};

const fluxosString = RepoAuthParser.encode(objectConfig);
console.log(fluxosString);
// "aws-ecr://region=eu-west-2&accessKeyId=AKIA123&secretAccessKey=secret"
```

## Security Considerations

1. **Credential Storage**: Secrets are stored as plain text in the string format
2. **Encryption**: FluxOS v7+ supports PGP encryption of repoauth fields
3. **URL Encoding**: Special characters are properly encoded to prevent injection
4. **Validation**: Provider names and parameters are validated before processing

## Future Extensions

The format is designed to be extensible:

```javascript
// Custom provider example
"custom-auth://endpoint=https%3A//auth.company.com&token=abc123"

// Registry-specific provider
"quay-io://username=user&token=oauth_token"

// Certificate-based authentication
"cert-auth://cert=BASE64_CERT&key=BASE64_KEY"
```

## Implementation Reference

- **Parser**: `ZelBack/src/services/registryAuth/utils/repoAuthParser.js`
- **Integration**: `ZelBack/src/services/registryAuth/services/registryAuthService.js`
- **Tests**: `tests/unit/services/registryAuth/repoAuthParser.test.js`
- **Provider Examples**: `ZelBack/src/services/registryAuth/providers/awsEcrAuthProvider.js`