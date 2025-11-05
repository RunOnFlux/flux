# Azure ACR Examples

This directory contains example scripts for testing Azure Container Registry authentication with FluxOS.

## Setup

1. **Copy the environment template:**
   ```bash
   cp .env.test.template .env.test
   ```

2. **Fill in your Azure credentials** in `.env.test`:
   - Follow the main [AZURE_ACR_SETUP.md](../AZURE_ACR_SETUP.md) guide to create the necessary Azure resources
   - Update `.env.test` with your actual values

3. **Install dependencies** (run from the flux root directory):
   ```bash
   cd ~/code/flux/flux
   npm install
   ```

## Available Tests

### authTest.js
Basic authentication test that verifies Azure ACR credentials and token generation.

**What it tests:**
- ACR authentication configuration
- Service principal authentication
- Provider creation
- OAuth token retrieval
- Token expiration

**Run:**
```bash
node authTest.js
```

**Expected output:**
```
Testing ACR authentication...
Auth test result: { success: true, message: '...' }
Creating ACR auth provider...
Getting ACR credentials...
✅ Successfully obtained ACR credentials
Username: 00000000-0000-0000-0000-000000000000
Token expires: [timestamp]
Registry name: fluxtestrepo1234567890
✅ ACR authentication test successful!
```

---

### testPull.js
Full end-to-end Docker pull test using Azure ACR authentication.

**What it tests:**
- ACR credential generation
- Docker login with integration credentials
- Image pull from ACR
- Container execution
- Cleanup

**Prerequisites:**
- Docker must be running
- Test image must exist in ACR (follow Step 3 in main guide)

**Run:**
```bash
node testPull.js
```

**Expected output:**
```
Testing Docker pull with Azure ACR integration...

1. Getting Azure ACR credentials from integration layer...
   ✅ Got credentials - Username: 00000000-0000-0000-0000-000000000000
   ✅ Token expires: [timestamp]
   ✅ Registry: fluxtestrepo1234567890

2. Logging into Docker with integration credentials...
   ✅ Docker login successful

3. Pulling image from Azure ACR...
   Image: fluxtestrepo1234567890.azurecr.io/test:latest
   ✅ Image pulled successfully!

4. Verifying image exists locally...
   ✅ Image found locally: ...

5. Testing container run...
   ✅ Container started: abc123def456
   ✅ Container status: running
   ✅ Cleanup completed

🎉 SUCCESS: Docker pull and run worked with Azure ACR authentication!

6. Logging out from Docker...
   ✅ Logged out
```

---

## Files

- **authTest.js** - Basic authentication test
- **testPull.js** - Full Docker pull integration test
- **.env.test.template** - Template for environment configuration
- **.env.test** - Your actual credentials (git-ignored, create from template)

## Troubleshooting

### "Cannot find module" errors
Make sure you're running from the flux root directory or adjust the require paths.

### Authentication failures
- Verify service principal credentials are correct in `.env.test`
- Check the client secret was saved correctly (it cannot be retrieved later)
- Ensure service principal has `AcrPull` role on the registry
- Verify tenant ID matches your Azure subscription

### "AADSTS70011: Invalid scope" errors
- Check service principal has correct ACR permissions
- Verify the registry name matches your ACR instance

### Token expiration issues
Azure ACR tokens are valid for 3 hours. The provider caches tokens and refreshes automatically.

## Cost Warning

Azure Container Registry Basic tier costs ~$5/month. Remember to delete the registry after testing to avoid ongoing charges:

```bash
az acr delete --name $ACR_NAME --resource-group $RESOURCE_GROUP_NAME --yes
```

See the cleanup section in the main guide for complete cleanup instructions.

## Next Steps

After successful testing, integrate ACR authentication into your FluxOS app specifications:

```javascript
{
  "name": "my-acr-app",
  "version": 8,
  "repotag": "myregistry.azurecr.io/myapp:latest",
  "repoauth": "azure-acr://clientId=12345678-...&clientSecret=abc123...&tenantId=87654321-..."
}
```

**Note:** Azure client secrets only contain URL-safe characters, so no URL encoding is required.

See [REPOAUTH_STRING_FORMAT.md](../../REPOAUTH_STRING_FORMAT.md) for complete format documentation.
