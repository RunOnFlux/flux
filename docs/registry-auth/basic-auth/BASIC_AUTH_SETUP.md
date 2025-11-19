# Basic Authentication Setup Guide

This guide walks through setting up basic username:password authentication for Docker registries, including Docker Hub, private registries, and other registries supporting HTTP Basic Auth.

**Example Files**: All code examples and test scripts referenced in this guide can be found in the `examples/` subdirectory.

## What is Basic Authentication?

Basic authentication is the simplest form of Docker registry authentication using a `username:password` format. It works with:

- **Docker Hub** (public Docker registry)
- **Private Docker registries** (self-hosted)
- **GitLab Container Registry**
- **GitHub Container Registry** (ghcr.io)
- **JFrog Artifactory**
- **Harbor**
- Any Docker Registry v2 API compliant registry

Unlike cloud provider authentication (AWS ECR, Azure ACR, Google GAR), basic auth doesn't require OAuth tokens, temporary credentials, or cloud SDKs - you simply provide a username and password (or Personal Access Token).

## Prerequisites

1. **Docker** installed locally
2. **Node.js** environment with the authentication integration
3. **Registry account** with credentials (Docker Hub account, or private registry access)

## Option 1: Docker Hub Setup

Docker Hub is the most common use case for basic authentication.

### Step 1: Create Docker Hub Account

If you don't have one already:

1. Go to https://hub.docker.com/signup
2. Create a free account
3. Verify your email address

### Step 2: Create Personal Access Token (PAT)

**Important**: Use a Personal Access Token instead of your account password for better security.

#### Using Docker Hub Website

1. Go to https://hub.docker.com/settings/security
2. Click "New Access Token"
3. Description: `FluxOS Testing`
4. Access permissions: `Read-only` (sufficient for pulling images)
5. Click "Generate"
6. **Copy the token immediately** - you won't be able to see it again!

#### Token Format

Docker Hub PATs look like: `dckr_pat_AbCdEf123456789XyZ`

### Step 3: Push a Test Image to Docker Hub

```bash
# Login to Docker Hub (using your PAT)
docker login --username YOUR_USERNAME

# Pull a small test image
docker pull nginx:alpine

# Tag it for your Docker Hub account
docker tag nginx:alpine YOUR_USERNAME/flux-test:latest

# Push to Docker Hub
docker push YOUR_USERNAME/flux-test:latest

# Verify the image exists
docker pull YOUR_USERNAME/flux-test:latest
```

### Step 4: Environment Configuration

Create the `.env.test` file with your Docker Hub credentials:

```bash
# Navigate to the examples directory
cd docs/registry-auth/basic-auth/examples

# Create .env.test from template
cp .env.test.template .env.test

# Edit with your credentials
cat > .env.test << EOF
# Docker Hub Configuration
REGISTRY_USERNAME=YOUR_USERNAME
REGISTRY_PASSWORD=dckr_pat_YOUR_TOKEN_HERE
IMAGE_TAG=YOUR_USERNAME/flux-test:latest
EOF
```

**Example .env.test**:
```bash
REGISTRY_USERNAME=johndoe
REGISTRY_PASSWORD=dckr_pat_AbCdEf123456789XyZ
IMAGE_TAG=johndoe/flux-test:latest
```

### Step 5: Test the Integration

```bash
# Test basic authentication
node authTest.js

# Test full Docker pull workflow
node testPull.js
```

**Expected output**:

```
Testing Basic Authentication (username:password)...

1. Getting credentials via registryCredentialHelper...
   Image: johndoe/flux-test:latest
   Username: johndoe

2. Credentials obtained successfully:
   ✅ Username: johndoe
   ✅ Password length: 36 chars
   ✅ Auth type: Basic

✅ Basic authentication test successful!
```

## Option 2: Private Docker Registry Setup

For self-hosted Docker registries or enterprise registries.

### Step 1: Set Up Private Registry (Optional)

If you're testing with a local registry:

```bash
# Run a local Docker registry
docker run -d -p 5000:5000 --name registry \
  -e REGISTRY_AUTH=htpasswd \
  -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm" \
  -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
  -v $(pwd)/auth:/auth \
  registry:2

# Create credentials file
mkdir -p auth
docker run --rm --entrypoint htpasswd registry:2 \
  -Bbn testuser testpass > auth/htpasswd

# Verify registry is running
curl http://localhost:5000/v2/
```

### Step 2: Push Test Image to Private Registry

```bash
# Tag an image for your private registry
docker tag nginx:alpine localhost:5000/test:latest

# Push to private registry
docker push localhost:5000/test:latest

# Verify
docker pull localhost:5000/test:latest
```

### Step 3: Configure for Private Registry

```bash
# Create .env.test for private registry
cat > .env.test << EOF
# Private Registry Configuration
REGISTRY_USERNAME=testuser
REGISTRY_PASSWORD=testpass
IMAGE_TAG=localhost:5000/test:latest
EOF
```

### Step 4: Test Integration

```bash
node authTest.js
node testPull.js
```

## Option 3: GitHub Container Registry (ghcr.io)

GitHub Container Registry uses Personal Access Tokens for authentication.

### Step 1: Create GitHub PAT

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Scopes: Select `read:packages` (for pulling images)
4. Generate token and copy it

### Step 2: Configure for GHCR

```bash
cat > .env.test << EOF
# GitHub Container Registry Configuration
REGISTRY_USERNAME=YOUR_GITHUB_USERNAME
REGISTRY_PASSWORD=ghp_YOUR_GITHUB_TOKEN
IMAGE_TAG=ghcr.io/YOUR_USERNAME/YOUR_IMAGE:latest
EOF
```

### Step 3: Test

```bash
node authTest.js
node testPull.js
```

## FluxOS App Spec Integration

### Basic Auth String Format

In your FluxOS app specification (version 8+), use the basic auth format:

```json
{
  "version": 8,
  "name": "my-app",
  "compose": [
    {
      "name": "web",
      "repotag": "johndoe/myapp:v1.0",
      "repoauth": "johndoe:dckr_pat_AbCdEf123456789XyZ"
    }
  ]
}
```

**Important Security Note**: In FluxOS v8+, the `repoauth` field is stored in the encrypted enterprise blob, so credentials are never exposed in plain text in the public app specification.

### Legacy Format (FluxOS v7)

For FluxOS v7, the entire repoauth string is PGP encrypted:

```json
{
  "version": 7,
  "name": "my-app",
  "compose": [
    {
      "name": "web",
      "repotag": "johndoe/myapp:v1.0",
      "repoauth": "-----BEGIN PGP MESSAGE-----\n...\n-----END PGP MESSAGE-----"
    }
  ]
}
```

## Authentication Flow

The basic auth integration uses the same credential helper as cloud providers:

```javascript
const registryCredentialHelper = require("./services/utils/registryCredentialHelper");

// Basic auth format: "username:password"
const credentials = await registryCredentialHelper.getCredentials(
  "johndoe/myapp:latest",              // Image tag
  "johndoe:dckr_pat_xxx",              // Basic auth string
  8,                                    // Spec version
  'my-app'                             // App name
);

// Returns:
// {
//   username: 'johndoe',
//   password: 'dckr_pat_xxx'
// }
```

Unlike cloud providers, basic auth:
- ✅ No token expiration or refresh needed
- ✅ No external API calls
- ✅ Simple and fast
- ❌ Static credentials (less secure for long-term use)
- ❌ No automatic rotation

## Troubleshooting

### "Login failed" / "Unauthorized"

**Problem**: Docker login fails with authentication error

**Solutions**:
1. **Docker Hub**: Ensure you're using a PAT, not your account password
2. **Verify credentials**: Double-check username and token are correct
3. **Token permissions**: Ensure token has `read:packages` or similar read permissions
4. **Token expiry**: Check if your token has expired (regenerate if needed)

```bash
# Test credentials manually
echo "YOUR_TOKEN" | docker login --username YOUR_USERNAME --password-stdin docker.io
```

### "Image not found" / "Repository does not exist"

**Problem**: Image exists but can't be accessed

**Solutions**:
1. **Verify image exists**: `docker pull YOUR_USERNAME/image:tag` manually
2. **Check image visibility**: Ensure image is public OR you have access
3. **Correct image path**:
   - Docker Hub: `username/image:tag`
   - Private registry: `registry.host.com/path/image:tag`
   - GHCR: `ghcr.io/username/image:tag`

### "Docker daemon not running"

**Problem**: testPull.js fails to connect to Docker

**Solutions**:
1. Start Docker Desktop (Mac/Windows) or Docker daemon (Linux)
2. Verify: `docker ps`
3. Check Docker is accessible: `docker version`

### Private registry certificate errors

**Problem**: Self-signed certificates cause SSL errors

**Solutions**:
```bash
# Option 1: Add registry to Docker's insecure registries (not recommended for production)
# Edit /etc/docker/daemon.json:
{
  "insecure-registries": ["registry.example.com:5000"]
}

# Option 2: Add CA certificate to Docker
# Copy your CA cert to /etc/docker/certs.d/registry.example.com:5000/ca.crt

# Restart Docker daemon
sudo systemctl restart docker  # Linux
# or restart Docker Desktop
```

## Security Best Practices

### 1. Use Personal Access Tokens (PATs)

✅ **DO**: Use PATs instead of passwords
```bash
REGISTRY_PASSWORD=dckr_pat_AbCdEf123456789  # PAT
```

❌ **DON'T**: Use account passwords
```bash
REGISTRY_PASSWORD=MyAccountPassword123  # Password (less secure)
```

**Why**: PATs can be:
- Scoped to specific permissions (read-only for pulling)
- Revoked individually without changing account password
- Set to expire automatically
- Audited separately

### 2. Limit Token Permissions

For FluxOS (pulling images only):
- Docker Hub: Use "Read-only" access
- GitHub: Use `read:packages` scope only
- GitLab: Use "read_registry" scope

### 3. Rotate Credentials Regularly

```bash
# Set reminders to rotate credentials
# Docker Hub PATs: Every 90 days
# GitHub PATs: Every 90 days
# Private registries: Follow your security policy
```

### 4. Never Commit Credentials

```bash
# The .env.test file is git-ignored
# NEVER commit credentials to version control

# Verify .gitignore contains:
.env.test
.env
*.env
```

### 5. Use FluxOS Enterprise Blob Encryption

For production apps, always use FluxOS v8+ with enterprise blob encryption:

```json
{
  "version": 8,
  "name": "production-app",
  "compose": [{
    "repoauth": "user:token"  // Encrypted in enterprise blob
  }]
}
```

The enterprise blob is encrypted with FluxOS's PGP key, so credentials are never exposed.

## 💰 Cost Information

### Docker Hub Free Tier

- **Free tier**: 100 GB/month data transfer
- **Rate limits**: 100 pulls per 6 hours (anonymous), 200 pulls per 6 hours (authenticated)
- **Public repositories**: Unlimited
- **Private repositories**: 1 included free
- **Cost for test**: **$0.00** (within free tier)

### Self-Hosted Registry

- **Docker Registry container**: Free and open source
- **Storage**: Your server costs (minimal for testing)
- **Bandwidth**: Your server costs
- **Cost for test**: **$0.00** (runs locally)

### GitHub Container Registry (GHCR)

- **Public packages**: Free unlimited storage and bandwidth
- **Private packages**: Free for personal accounts (500 MB storage, 1 GB bandwidth/month)
- **Cost for test**: **$0.00** (within free tier)

## Expected Results

- **Authentication Test**: Should succeed and return username/password
- **Pull Test**: Should pull image, run container, and cleanup successfully
- **Performance**: Instant (no token exchange or API calls needed)
- **Reliability**: High (no external dependencies besides registry itself)

## Monitoring

### Docker Hub Usage

Check your Docker Hub pull rate limits:

```bash
# Get rate limit info
TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:ratelimitpreview/test:pull" | jq -r .token)
curl -s -H "Authorization: Bearer $TOKEN" https://registry-1.docker.io/v2/ratelimitpreview/test/manifests/latest -I | grep -i ratelimit
```

### Private Registry Logs

```bash
# View registry logs
docker logs registry

# Follow logs in real-time
docker logs -f registry
```

## Comparison with Cloud Providers

| Feature | Basic Auth | AWS ECR | Azure ACR | Google GAR |
|---------|-----------|---------|-----------|------------|
| **Setup Time** | 5 minutes | 15 minutes | 20 minutes | 15 minutes |
| **Credentials** | Username:Password | Access Key + Secret | Service Principal | Service Account |
| **Token Expiry** | Never (static) | 12 hours | 3 hours | 60 minutes |
| **Auto Refresh** | No | Yes | Yes | Yes |
| **API Calls** | None | Yes (AWS STS) | Yes (Azure AD) | Yes (Google Auth) |
| **Complexity** | Simple | Medium | High | Medium |
| **Best For** | Docker Hub, Private registries | AWS workloads | Azure workloads | GCP workloads |

## Advanced Configuration

### Multiple Registries

You can use basic auth with multiple registries in a single app:

```json
{
  "version": 8,
  "compose": [
    {
      "name": "frontend",
      "repotag": "docker.io/myuser/frontend:v1",
      "repoauth": "myuser:token1"
    },
    {
      "name": "backend",
      "repotag": "registry.company.com/backend:v2",
      "repoauth": "admin:token2"
    }
  ]
}
```

### Custom Registry Ports

For registries on non-standard ports:

```bash
# Registry with custom port
IMAGE_TAG=registry.example.com:5000/myapp:latest
REGISTRY_USERNAME=admin
REGISTRY_PASSWORD=secret
```

### Using Environment Variables in Production

For production FluxOS nodes, set credentials via environment or config:

```javascript
// Production credential loading
const username = process.env.DOCKER_USERNAME;
const password = process.env.DOCKER_PASSWORD;
const repoauth = `${username}:${password}`;
```

## References

- [Docker Hub Personal Access Tokens](https://docs.docker.com/security/for-developers/access-tokens/)
- [Docker Registry v2 API](https://docs.docker.com/registry/spec/api/)
- [GitHub Packages Authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitLab Container Registry](https://docs.gitlab.com/ee/user/packages/container_registry/)
- [Harbor Registry](https://goharbor.io/docs/)

## Next Steps

After testing basic authentication:

1. **Review cloud provider guides** for production cloud workloads:
   - [AWS ECR Setup](../aws-ecr/AWS_ECR_SETUP.md)
   - [Azure ACR Setup](../azure-acr/AZURE_ACR_SETUP.md)
   - [Google GAR Setup](../google-gar/GOOGLE_GAR_SETUP.md)

2. **Implement credential rotation** for production environments

3. **Set up monitoring** for pull failures and rate limits

4. **Configure FluxOS v8+ enterprise encryption** for production credentials
