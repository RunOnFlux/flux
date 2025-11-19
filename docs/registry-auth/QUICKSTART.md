# Registry Authentication Quick Start

Get started with FluxOS cloud registry authentication in under 10 minutes.

## Choose Your Provider

- **[AWS ECR](#aws-ecr-quick-start)** - Amazon Elastic Container Registry
- **[Azure ACR](#azure-acr-quick-start)** - Azure Container Registry
- **[Google GAR](#google-gar-quick-start)** - Google Artifact Registry

---

## AWS ECR Quick Start

### 1. Prerequisites
- AWS account with ECR access
- AWS CLI installed: `aws --version`
- Docker running: `docker info`

### 2. Create Test Repository (2 minutes)
```bash
export AWS_REGION=eu-west-2
aws ecr create-repository --repository-name flux-test-repo --region $AWS_REGION
```

### 3. Create IAM User (2 minutes)
```bash
# Create user
aws iam create-user --user-name flux-ecr-test-user

# Attach policy
aws iam put-user-policy \
    --user-name flux-ecr-test-user \
    --policy-name FluxECRTestPolicy \
    --policy-document file://aws-ecr/examples/ecr-test-policy.json

# Create access keys (SAVE THE OUTPUT!)
aws iam create-access-key --user-name flux-ecr-test-user
```

### 4. Test Authentication (3 minutes)
```bash
cd aws-ecr/examples
cp .env.test.template .env.test
# Edit .env.test with your values
node authTest.js
```

### 5. Use in FluxOS
```javascript
{
  "name": "my-app",
  "version": 8,
  "repotag": "123456789012.dkr.ecr.eu-west-2.amazonaws.com/my-image:latest",
  "repoauth": "aws-ecr://region=eu-west-2&accessKeyId=AKIA...&secretAccessKey=..."
}
```

**Cost:** FREE (covered by AWS Free Tier)

**Full Guide:** [AWS_ECR_SETUP.md](aws-ecr/AWS_ECR_SETUP.md)

---

## Azure ACR Quick Start

### 1. Prerequisites
- Azure account with ACR access
- Azure CLI installed: `az --version`
- Docker running: `docker info`

### 2. Register Provider (one-time, 2 minutes)
```bash
az provider register --namespace Microsoft.ContainerRegistry
az provider show --namespace Microsoft.ContainerRegistry --query "registrationState"
# Wait until it shows "Registered"
```

### 3. Create Registry (3 minutes)
```bash
export AZURE_REGION=uksouth
export RESOURCE_GROUP=flux-test-rg
export ACR_NAME=fluxtest$(date +%s)

az group create --name $RESOURCE_GROUP --location $AZURE_REGION
az acr create --resource-group $RESOURCE_GROUP --name $ACR_NAME --sku Basic --location $AZURE_REGION
```

### 4. Create Service Principal (2 minutes)
```bash
# SAVE THE OUTPUT - you can't retrieve the password later!
az ad sp create-for-rbac \
    --name "flux-acr-test-sp" \
    --role "AcrPull" \
    --scopes "/subscriptions/$(az account show --query id --output tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME"
```

### 5. Test Authentication (3 minutes)
```bash
cd azure-acr/examples
cp .env.test.template .env.test
# Edit .env.test with service principal values
node authTest.js
```

### 6. Use in FluxOS
```javascript
{
  "name": "my-app",
  "version": 8,
  "repotag": "myregistry.azurecr.io/my-image:latest",
  "repoauth": "azure-acr://clientId=12345678-...&clientSecret=abc...&tenantId=87654321-..."
}
```

**Cost:** ~$1 for testing (remember to clean up!)

**Full Guide:** [AZURE_ACR_SETUP.md](azure-acr/AZURE_ACR_SETUP.md)

---

## Google GAR Quick Start

### 1. Prerequisites
- Google Cloud account
- gcloud CLI installed: `gcloud --version`
- Docker running: `docker info`

### 2. Enable API and Create Repository (3 minutes)
```bash
export GCP_REGION=europe-west2
export GCP_PROJECT_ID=$(gcloud config get-value project)

gcloud services enable artifactregistry.googleapis.com

gcloud artifacts repositories create flux-test-repo \
    --repository-format=docker \
    --location=$GCP_REGION
```

### 3. Create Service Account (3 minutes)
```bash
# Create service account
gcloud iam service-accounts create fluxos-gar-test \
    --description="FluxOS GAR test service account" \
    --display-name="FluxOS GAR Test"

# Grant permissions
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
    --member="serviceAccount:fluxos-gar-test@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.reader"

# Generate JSON key
gcloud iam service-accounts keys create gar-key.json \
    --iam-account=fluxos-gar-test@$GCP_PROJECT_ID.iam.gserviceaccount.com
```

### 4. Test Authentication (3 minutes)
```bash
cd google-gar/examples
cp .env.test.template .env.test

# Base64 encode the service account JSON
cat ../../../gar-key.json | base64

# Edit .env.test and paste the base64 output as GAR_KEY_FILE
node authTest.js
```

### 5. Use in FluxOS
```javascript
{
  "name": "my-app",
  "version": 8,
  "repotag": "europe-west2-docker.pkg.dev/my-project/my-repo/my-image:latest",
  "repoauth": "google-gar://keyFile=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6..."
}
```

**Cost:** FREE (covered by Google Cloud Free Tier)

**Full Guide:** [GOOGLE_GAR_SETUP.md](google-gar/GOOGLE_GAR_SETUP.md)

---

## Common Commands

### Run Example Tests
```bash
# From flux root directory
cd docs/registry-auth/{provider}/examples
cp .env.test.template .env.test
# Edit .env.test with your credentials
node authTest.js
```

### Verify Paths
All example scripts use relative paths from the examples directory:
```javascript
require("../../../../ZelBack/src/services/registryAuth/services/registryAuthService")
```

### Debug Issues
Enable debug logging:
```bash
export DEBUG="flux-registry-auth:*"
node authTest.js
```

---

## Next Steps

1. **Complete Setup:** Follow the full guide for your chosen provider
2. **Test Docker Pull:** Try the end-to-end Docker integration tests
3. **Review Format:** Read [REPOAUTH_STRING_FORMAT.md](REPOAUTH_STRING_FORMAT.md) for string encoding details
4. **Integrate:** Add registry authentication to your FluxOS app specifications
5. **Clean Up:** Remember to delete test resources to avoid charges

---

## Troubleshooting

### "Cannot find module" errors
- Run tests from the `examples/` directory
- Or run from flux root: `node docs/registry-auth/aws-ecr/examples/authTest.js`

### Authentication failures
- Double-check credentials in `.env.test`
- Verify IAM/role permissions
- Check region/project/tenant matches

### Docker issues
- Ensure Docker daemon is running: `docker info`
- Try Docker logout: `docker logout <registry>`
- Check Docker has network access

### Still stuck?
Consult the full setup guide for your provider - each includes detailed troubleshooting sections.

---

## Summary

| Provider | Setup Time | Cost | Token Validity | Free Tier |
|----------|-----------|------|----------------|-----------|
| **AWS ECR** | ~7 min | $0 | 12 hours | ✅ Yes |
| **Azure ACR** | ~10 min | ~$1 | 3 hours | ❌ No |
| **Google GAR** | ~9 min | $0 | 60 minutes | ✅ Yes |

All providers support:
- ✅ Automatic token caching
- ✅ Automatic token refresh
- ✅ Minimal IAM permissions
- ✅ Secure credential handling
- ✅ FluxOS integration

**Happy containerizing! 🐳**
