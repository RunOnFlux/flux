# Basic Authentication Examples

This directory contains example scripts for testing Docker registry authentication using basic username:password credentials.

## What is Basic Authentication?

Basic authentication uses a simple `username:password` format and works with:
- **Docker Hub** (with Personal Access Tokens)
- **Private Docker registries** (with configured users)
- **GitLab Container Registry**
- **GitHub Container Registry**
- **Any registry supporting HTTP Basic Auth**

Unlike cloud provider authentication (AWS ECR, Azure ACR, Google GAR), basic auth doesn't require OAuth tokens or temporary credentials - you simply provide a username and password.

## Files in This Directory

- **`authTest.js`** - Tests credential retrieval from the integration layer
- **`testPull.js`** - Full end-to-end test: login, pull image, run container
- **`.env.test.template`** - Template for configuration (copy to `.env.test`)
- **`.env.test`** - Your actual configuration (git-ignored)

## Quick Start

### 1. Configure Credentials

Copy the template and add your credentials:

```bash
cp .env.test.template .env.test
# Edit .env.test with your registry username and password
```

### 2. Run Tests

```bash
# Test basic authentication
node authTest.js

# Test full Docker pull workflow
node testPull.js
```

## Configuration Format

### Docker Hub Example

```bash
REGISTRY_USERNAME=myusername
REGISTRY_PASSWORD=dckr_pat_AbCdEf123456789
IMAGE_TAG=myusername/myimage:latest
```

**Note:** For Docker Hub, use a [Personal Access Token (PAT)](https://docs.docker.com/security/for-developers/access-tokens/) instead of your password for better security.

### Private Registry Example

```bash
REGISTRY_USERNAME=admin
REGISTRY_PASSWORD=secretpassword123
IMAGE_TAG=registry.example.com/myapp:v1.0
```

## FluxOS App Spec Format

In your FluxOS app specification, use the basic auth format in the `repoauth` field:

```json
{
  "version": 8,
  "name": "my-app",
  "compose": [
    {
      "name": "web",
      "repotag": "myusername/myimage:latest",
      "repoauth": "myusername:dckr_pat_AbCdEf123456789"
    }
  ]
}
```

**Important:** In FluxOS v8+, the `repoauth` string is stored in the encrypted enterprise blob, so it's not exposed in plain text in the app spec.

## Expected Output

### authTest.js

```bash
Testing Basic Authentication (username:password)...

1. Getting credentials via registryCredentialHelper...
   Image: myusername/myapp:latest
   Username: myusername

2. Credentials obtained successfully:
   ✅ Username: myusername
   ✅ Password length: 36 chars
   ✅ Auth type: Basic

✅ Basic authentication test successful!
```

### testPull.js

```bash
Testing Docker pull with Basic Authentication integration...

1. Getting credentials from integration layer...
   ✅ Got credentials - Username: myusername

2. Logging into Docker with integration credentials...
   ✅ Docker login successful

3. Pulling image...
   Image: myusername/myapp:latest
   ✅ Image pulled successfully!

4. Verifying image exists locally...
   ✅ Image found locally: myusername/myapp:latest

5. Testing container run...
   ✅ Container started: 956c69047bd2
   ✅ Container status: running
   ✅ Cleanup completed

🎉 SUCCESS: Docker pull and run worked with Basic Authentication!

6. Logging out from Docker...
   ✅ Logged out
```

## Troubleshooting

### "Login failed"
- Check username and password are correct
- For Docker Hub, ensure you're using a PAT, not your account password
- Verify the image exists and you have access to it

### "Image not found"
- Verify the IMAGE_TAG is correct
- For Docker Hub: `username/image:tag`
- For private registries: `registry.host.com/path/image:tag`
- Ensure you have pull permissions for the image

### "Docker daemon not running"
- Start Docker Desktop or Docker daemon
- Verify with: `docker ps`

## Security Best Practices

1. **Use Personal Access Tokens (PATs)** instead of passwords when possible
2. **Never commit `.env.test`** to git (it's git-ignored)
3. **Rotate credentials regularly**
4. **Use read-only tokens** for pulling images (principle of least privilege)
5. **For production**, store credentials in the encrypted FluxOS enterprise blob

## Comparison with Cloud Providers

| Feature | Basic Auth | AWS ECR | Azure ACR | Google GAR |
|---------|-----------|---------|-----------|------------|
| **Credentials** | Username:Password | Access Key + Secret | Service Principal | Service Account JSON |
| **Token Expiry** | None (static) | 12 hours | 3 hours | 60 minutes |
| **Automatic Refresh** | No | Yes | Yes | Yes |
| **Caching** | No (static) | Yes | Yes | Yes |
| **Setup Complexity** | Simple | Medium | Complex | Medium |

Basic auth is the simplest but least flexible. For production workloads with cloud registries, use the cloud-specific authentication methods for automatic token rotation and better security.

## How It Works

The test scripts use the same production API that FluxOS uses:

```javascript
const registryCredentialHelper = require("../../../../ZelBack/src/services/utils/registryCredentialHelper");

const credentials = await registryCredentialHelper.getCredentials(
  "myusername/myapp:latest",           // Image tag
  "myusername:dckr_pat_xxx",           // Basic auth string
  8,                                    // Spec version
  'basic-auth-test-app'                // App name
);

// Returns: { username: 'myusername', password: 'dckr_pat_xxx' }
```

The credentials are then used directly for Docker authentication - no token exchange or OAuth flows needed!
