# AWS ECR Examples

This directory contains example scripts for testing AWS ECR authentication with FluxOS.

## Setup

1. **Copy the environment template:**
   ```bash
   cp .env.test.template .env.test
   ```

2. **Fill in your AWS credentials** in `.env.test`:
   - Follow the main [AWS_ECR_SETUP.md](../AWS_ECR_SETUP.md) guide to create the necessary AWS resources
   - Update `.env.test` with your actual values

3. **Install dependencies** (run from the flux root directory):
   ```bash
   cd ~/code/flux/flux
   npm install
   ```

## Available Tests

### authTest.js
Basic authentication test that verifies AWS ECR credentials and token generation.

**What it tests:**
- ECR authentication configuration
- Provider creation
- Credential retrieval
- Token expiration

**Run:**
```bash
node authTest.js
```

**Expected output:**
```
Testing ECR authentication...
Auth test result: { success: true, message: '...' }
Creating ECR auth provider...
Getting ECR credentials...
✅ Successfully obtained ECR credentials
Username: AWS
Token expires: [timestamp]
✅ ECR authentication test successful!
```

---

### testPull.js
Full end-to-end Docker pull test using ECR authentication.

**What it tests:**
- ECR credential generation
- Docker login with integration credentials
- Image pull from ECR
- Container execution
- Cleanup

**Prerequisites:**
- Docker must be running
- Test image must exist in ECR (follow Step 3 in main guide)

**Run:**
```bash
node testPull.js
```

**Expected output:**
```
Testing Docker pull with ECR integration...

1. Getting ECR credentials from integration layer...
   ✅ Got credentials - Username: AWS
   ✅ Token expires: [timestamp]

2. Logging into Docker with integration credentials...
   ✅ Docker login successful

3. Pulling image from ECR...
   Image: 123456789012.dkr.ecr.eu-west-2.amazonaws.com/flux-test-repo:test
   ✅ Image pulled successfully!

4. Verifying image exists locally...
   ✅ Image found locally: ...

5. Testing container run...
   ✅ Container started: abc123def456
   ✅ Container status: running
   ✅ Cleanup completed

🎉 SUCCESS: Docker pull and run worked with ECR authentication!

6. Logging out from Docker...
   ✅ Logged out
```

---

## Files

- **authTest.js** - Basic authentication test
- **testPull.js** - Full Docker pull integration test
- **ecr-test-policy.json** - Minimal IAM policy for ECR access
- **.env.test.template** - Template for environment configuration
- **.env.test** - Your actual credentials (git-ignored, create from template)

## Troubleshooting

### "Cannot find module" errors
Make sure you're running from the flux root directory or adjust the require paths.

### Authentication failures
- Verify AWS credentials are correct in `.env.test`
- Check IAM permissions include `ecr:GetAuthorizationToken`
- Ensure AWS region matches your ECR repository region

### Docker pull failures
- Verify Docker is running: `docker info`
- Check the test image exists: `aws ecr describe-images --repository-name flux-test-repo`
- Ensure ECR repository URI is correct in `.env.test`

## Next Steps

After successful testing, integrate ECR authentication into your FluxOS app specifications:

```javascript
{
  "name": "my-ecr-app",
  "version": 8,
  "repotag": "123456789012.dkr.ecr.eu-west-2.amazonaws.com/myapp:latest",
  "repoauth": "aws-ecr://region=eu-west-2&accessKeyId=AKIA...&secretAccessKey=..."
}
```

See [REPOAUTH_STRING_FORMAT.md](../../REPOAUTH_STRING_FORMAT.md) for complete format documentation.
