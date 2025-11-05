# Google Artifact Registry Examples

This directory contains example scripts for testing Google Artifact Registry authentication with FluxOS.

## Setup

1. **Copy the environment template:**
   ```bash
   cp .env.test.template .env.test
   ```

2. **Fill in your Google Cloud credentials** in `.env.test`:
   - Follow the main [GOOGLE_GAR_SETUP.md](../GOOGLE_GAR_SETUP.md) guide to create the necessary Google Cloud resources
   - Update `.env.test` with your actual values
   - **Important:** The `GAR_KEY_FILE` must be the base64-encoded service account JSON

3. **Install dependencies** (run from the flux root directory):
   ```bash
   cd ~/code/flux/flux
   npm install
   ```

## Available Tests

### authTest.js
Basic authentication test that verifies Google Artifact Registry credentials and OAuth token generation.

**What it tests:**
- GAR authentication configuration
- Service account key parsing
- Provider creation
- OAuth2 token retrieval
- Token expiration

**Run:**
```bash
node authTest.js
```

**Expected output:**
```
Testing GAR authentication...
Auth test result: { success: true, message: '...' }
Creating GAR auth provider...
Getting GAR credentials...
✅ Successfully obtained GAR credentials
Username: oauth2accesstoken
Token expires: [timestamp]
Client Email: fluxos-gar-test@my-project.iam.gserviceaccount.com
✅ GAR authentication test successful!
```

---

### testPull.js
Full end-to-end Docker pull test using Google Artifact Registry authentication.

**What it tests:**
- GAR credential generation
- Docker login with integration credentials
- Image pull from GAR
- Container execution
- Cleanup

**Prerequisites:**
- Docker must be running
- Test image must exist in GAR (follow Step 3 in main guide)

**Run:**
```bash
node testPull.js
```

**Expected output:**
```
Testing Docker pull with Google Artifact Registry integration...

1. Getting Google GAR credentials from integration layer...
   ✅ Got credentials - Username: oauth2accesstoken
   ✅ Token expires: [timestamp]
   ✅ Client Email: fluxos-gar-test@my-project.iam.gserviceaccount.com

2. Logging into Docker with integration credentials...
   ✅ Docker login successful

3. Pulling image from Google Artifact Registry...
   Image: europe-west2-docker.pkg.dev/my-project/flux-test-repo/test:latest
   ✅ Image pulled successfully!

4. Verifying image exists locally...
   ✅ Image found locally: ...

5. Testing container run...
   ✅ Container started: abc123def456
   ✅ Container status: running
   ✅ Cleanup completed

🎉 SUCCESS: Docker pull and run worked with Google GAR authentication!

6. Logging out from Docker...
   ✅ Logged out
```

---

## Files

- **authTest.js** - Basic authentication test
- **testPull.js** - Full Docker pull integration test
- **.env.test.template** - Template for environment configuration
- **.env.test** - Your actual credentials (git-ignored, create from template)

## Generating GAR_KEY_FILE

The `GAR_KEY_FILE` environment variable must contain the **base64-encoded** service account JSON key file:

```bash
# 1. Create service account and download JSON key (see main guide)
gcloud iam service-accounts keys create gar-service-account.json \
    --iam-account=fluxos-gar-test@PROJECT_ID.iam.gserviceaccount.com

# 2. Base64 encode the entire JSON file
cat gar-service-account.json | base64

# 3. Copy the output and paste it as GAR_KEY_FILE value in .env.test
# On macOS, you can copy directly to clipboard:
cat gar-service-account.json | base64 | pbcopy
```

## Troubleshooting

### "Cannot find module" errors
Make sure you're running from the flux root directory or adjust the require paths.

### Authentication failures
- Verify the service account JSON was base64-encoded correctly
- Check the service account has `roles/artifactregistry.reader` permission
- Ensure the project ID matches your GCP project
- Verify the service account is enabled

### "Permission denied" errors
The service account needs the `artifactregistry.reader` role:

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
    --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
    --role="roles/artifactregistry.reader"
```

### Invalid private key errors
- Ensure the JSON file is not corrupted during base64 encoding
- Verify newlines are preserved in the private key
- Try re-generating the service account key

### Token expiration issues
Google GAR tokens are valid for 60 minutes. The provider caches tokens and refreshes automatically.

## Cost Information

Google Artifact Registry is free tier safe:
- **Storage**: 0.5 GB/month free (our test uses ~50 MB)
- **Egress**: 1 GB/month free
- **API calls**: Free

Testing should cost $0.00 if you clean up promptly.

## Next Steps

After successful testing, integrate GAR authentication into your FluxOS app specifications:

```javascript
{
  "name": "my-gar-app",
  "version": 8,
  "repotag": "europe-west2-docker.pkg.dev/my-project/my-repo/myapp:latest",
  "repoauth": "google-gar://keyFile=BASE64_ENCODED_SERVICE_ACCOUNT_JSON"
}
```

The `keyFile` parameter should contain the same base64-encoded JSON you used in `GAR_KEY_FILE`.

See [REPOAUTH_STRING_FORMAT.md](../../REPOAUTH_STRING_FORMAT.md) for complete format documentation.
