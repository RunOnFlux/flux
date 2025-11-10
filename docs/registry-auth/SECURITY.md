# Security Considerations for Registry Authentication

This document outlines the security model and best practices for FluxOS registry authentication.

## Table of Contents

- [Token and Credential Storage](#token-and-credential-storage)
- [In-Memory Token Caching](#in-memory-token-caching)
- [Credential Encryption](#credential-encryption)
- [Safe Logging](#safe-logging)
- [Network Security](#network-security)
- [Provider-Specific Security](#provider-specific-security)
- [Best Practices](#best-practices)

---

## Token and Credential Storage

### Memory-Only Token Caching

**Critical Security Feature**: Cloud provider authentication tokens (AWS ECR, Azure ACR, Google GAR) are **cached in memory only** and **never persisted to disk**.

#### How It Works

1. **Token Acquisition**
   - FluxOS authenticates with cloud provider API
   - Receives short-lived access token (1-12 hours depending on provider)
   - Token stored in process memory (`fluxCaching.registryProviderCache`)

2. **Token Caching**
   - **AWS ECR**: 12-hour tokens cached with 11h 45m expiry
   - **Azure ACR**: 3-hour tokens cached with 2h 45m expiry
   - **Google GAR**: 1-hour tokens cached with 45m expiry
   - Tokens automatically refreshed before expiration

3. **Token Lifecycle**
   - Tokens exist ONLY in FluxOS process memory
   - NO disk persistence (no files, no swap, no logs)
   - Cleared on FluxOS restart or cache eviction
   - Automatically expire based on cloud provider TTL

#### Security Implications

✅ **Benefits:**
- Stolen disk/backups do not contain tokens
- Process crash immediately invalidates all cached tokens
- No risk of stale tokens persisting after credential rotation
- Minimal attack surface for credential theft

⚠️ **Considerations:**
- FluxOS restart requires re-authentication (expected behavior)
- Process memory dumps could expose tokens (standard OS security concern)
- Tokens accessible to anyone with root/FluxOS process access (standard privilege model)

---

## Credential Encryption

### Application Specification Versions

FluxOS uses version-aware encryption for registry credentials:

#### Version 7 (Legacy)
- **Storage**: PGP-encrypted `repoauth` field in app spec
- **Encryption**: Per-node PGP keys
- **Decryption**: At deployment time on each node
- **Security**: Node-specific encryption, credentials never in plaintext on disk

#### Version 8+ (Current)
- **Storage**: Encrypted in enterprise blob
- **Encryption**: Enterprise-level encryption key
- **Decryption**: Once at app spec load time
- **Security**: Centralized encryption, credentials decrypted in memory only

### Credential Flow

```
v7 Apps:
  App Spec (encrypted) → PGP Decrypt → Memory → Use → Discard

v8+ Apps:
  Enterprise Blob (encrypted) → AES Decrypt → Memory → Use → Discard
```

**Key Point**: Credentials are **NEVER** stored in plaintext on disk at any stage.

---

## In-Memory Token Caching

### Cache Architecture

FluxOS uses a two-level caching strategy:

#### Level 1: Provider Instance Cache
- Each provider instance (`awsEcrAuthProvider`, `azureAcrAuthProvider`, `googleGarAuthProvider`) maintains its own token cache
- Stored in `this.tokenCache` and `this.tokenExpiry` instance variables
- Scoped to the provider instance lifecycle

#### Level 2: Factory Cache
- `AuthProviderFactory` maintains a global cache of provider instances
- Key: `registryUrl + credentialHash + appName`
- TTL: Based on token expiry (12h for AWS, 3h for Azure, 1h for Google)
- Automatic eviction on expiry

### Cache Security

#### Isolation
- Per-app credential caching (apps with different credentials get separate caches)
- Per-registry URL isolation
- No cross-app credential sharing

#### Eviction
- Automatic eviction 15 minutes before token expiry (configurable via `registryAuth.tokenRefreshBufferMs`)
- Manual eviction via `AuthProviderFactory.clearProviderCache()`
- Process restart clears all caches

#### Race Condition Protection
- Token refresh operations are locked to prevent concurrent refreshes
- Multiple simultaneous requests share a single refresh promise
- Prevents duplicate API calls and rate limiting issues

---

## Safe Logging

### Sensitive Data Exclusion

All authentication providers implement `getSafeConfig()` methods that **exclude sensitive data** from logs:

#### AWS ECR
```javascript
// LOGGED (Safe)
{
  provider: 'aws-ecr',
  region: 'us-east-1',
  hasExplicitCredentials: true,
  tokenCached: true
}

// NEVER LOGGED
// - accessKeyId
// - secretAccessKey
// - sessionToken
// - actual tokens
```

#### Azure ACR
```javascript
// LOGGED (Safe)
{
  provider: 'azure-acr',
  registryName: 'myregistry',
  hasTenantId: true,
  tokenCached: true
}

// NEVER LOGGED
// - tenantId
// - clientId
// - clientSecret
// - access tokens
```

#### Google GAR
```javascript
// LOGGED (Safe)
{
  provider: 'google-gar',
  hasKeyFile: true,
  tokenCached: true
}

// NEVER LOGGED
// - privateKey
// - clientEmail
// - keyFile contents
// - access tokens
```

#### Basic Auth
```javascript
// LOGGED (Safe)
{
  provider: 'basic',
  username: 'myuser',
  hasPassword: true
}

// NEVER LOGGED
// - password
```

### Debug Mode

When debug logging is enabled:
- Only **metadata** about authentication status is logged
- Credential acquisition success/failure (without details)
- Token expiry times (without token values)
- Provider selection logic

**No secrets are logged even in debug mode.**

---

## Network Security

### TLS/HTTPS Requirements

All cloud provider APIs use HTTPS:
- **AWS ECR**: `https://api.ecr.{region}.amazonaws.com`
- **Azure ACR**: `https://{registry}.azurecr.io`
- **Google GAR**: `https://{region}-docker.pkg.dev`

FluxOS validates TLS certificates and rejects self-signed certificates by default.

### Credential Transmission

Credentials are transmitted securely:
- **AWS**: SigV4 signed requests (credentials never sent directly)
- **Azure**: OAuth2 token exchange over HTTPS
- **Google**: JWT authentication over HTTPS
- **Basic Auth**: Base64-encoded over Docker registry HTTPS connection

### Network Exposure

Registry authentication:
- **Inbound**: No listening ports (client-only)
- **Outbound**: Only to cloud provider APIs and Docker registries
- **Local**: No local network exposure of credentials

---

## Provider-Specific Security

### AWS ECR

**IAM Permissions (Principle of Least Privilege)**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "*"
    }
  ]
}
```

**Recommendations**:
- Use IAM roles instead of access keys when possible (ECS task roles, EC2 instance profiles)
- Rotate access keys regularly if using static credentials
- Use session tokens for temporary access
- Restrict ECR repository access with resource-based policies

**Token Security**:
- Tokens valid for 12 hours
- Tokens are registry-specific (cannot access other AWS services)
- Tokens cached in memory only

---

### Azure ACR

**Service Principal Permissions (Minimum Required)**:
- `AcrPull` role on the specific registry
- `AcrImageSigner` if using content trust

**Recommendations**:
- Create dedicated service principals for FluxOS (not shared)
- Use Managed Identity when running on Azure VMs
- Rotate client secrets regularly (90-day maximum)
- Enable Azure AD authentication only (disable admin account)
- Use repository-scoped tokens for fine-grained access

**Token Security**:
- Access tokens valid for 3 hours
- Tokens are registry-specific
- OAuth2 refresh tokens NOT cached (re-authenticate each time)
- Tokens cached in memory only

---

### Google GAR

**Service Account Permissions (Minimum Required)**:
- `roles/artifactregistry.reader` on specific repositories
- Do NOT grant project-wide permissions

**Recommendations**:
- Create dedicated service accounts for FluxOS
- Use Workload Identity when running on GKE
- Rotate service account keys annually (or use Workload Identity to avoid keys)
- Enable Artifact Registry API only (disable unnecessary GCP APIs)
- Use repository-level IAM policies

**Token Security**:
- Access tokens valid for 1 hour
- Tokens are scoped to Artifact Registry only
- Service account private keys stored encrypted (v8+) or PGP-encrypted (v7)
- Tokens cached in memory only

---

### Basic Auth

**Security Model**:
- Credentials stored encrypted in app spec (v7: PGP, v8+: enterprise encryption)
- Credentials passed to Docker daemon for authentication
- No token caching (credentials used directly each time)

**Recommendations**:
- Use registry-specific credentials (not personal accounts)
- Use read-only credentials when possible
- Rotate passwords regularly (90-day maximum)
- Enable 2FA on registry accounts (where supported)
- Use cloud provider authentication instead of basic auth when available

**Security Limitations**:
- Basic auth credentials are long-lived (no automatic expiration)
- Credentials sent with every Docker operation (more exposure than tokens)
- Consider migrating to cloud provider authentication for better security

---

## Best Practices

### Credential Management

1. **Use Cloud Provider Authentication**
   - Prefer AWS ECR, Azure ACR, or Google GAR over basic auth
   - Cloud provider tokens are short-lived and automatically rotated

2. **Minimize Credential Scope**
   - Use read-only permissions (pull-only, no push)
   - Restrict to specific registries/repositories
   - Use separate credentials per application when possible

3. **Rotate Credentials Regularly**
   - AWS: Rotate access keys every 90 days
   - Azure: Rotate client secrets every 90 days
   - Google: Rotate service account keys annually
   - Basic auth: Rotate passwords every 90 days

4. **Monitor Credential Usage**
   - Enable cloud provider audit logging (CloudTrail, Azure Monitor, Cloud Audit Logs)
   - Monitor for unauthorized access attempts
   - Alert on credential usage from unexpected IPs/regions

### Operational Security

1. **Secure FluxOS Node**
   - Keep FluxOS updated to latest version
   - Restrict SSH access to FluxOS nodes
   - Use firewall rules to limit outbound connections
   - Enable OS-level security features (SELinux, AppArmor)

2. **Protect Application Specs**
   - Treat app specs as sensitive (contain encrypted credentials)
   - Limit access to app spec storage
   - Backup encrypted specs securely
   - Version control encrypted specs (safe to commit to Git)

3. **Network Isolation**
   - Use private registries when possible
   - Consider VPN/VPC peering for cloud provider access
   - Restrict egress to known registry endpoints

4. **Incident Response**
   - If credentials compromised: Rotate immediately and check audit logs
   - If FluxOS node compromised: Restart FluxOS (clears token cache), rotate all credentials
   - If disk compromised: No immediate action needed (tokens not on disk), but rotate credentials as precaution

### Configuration Security

1. **Token Refresh Buffer**
   - Default: 15 minutes (good for most scenarios)
   - Increase (20-30 min) for unreliable networks
   - Decrease (5-10 min) for aggressive security policies
   - Configure in `config/default.js`: `registryAuth.tokenRefreshBufferMs`

2. **Fail-Open Strategy**
   - v7 enterprise apps skip verification on nodes without PGP keys
   - Maintains availability over strict security
   - Ensure all production nodes have PGP keys configured

---

## Security Updates

Security improvements in this implementation:

1. **Token Refresh Locking** (v8.1+)
   - Prevents race conditions in concurrent token refreshes
   - Eliminates duplicate API calls that could trigger rate limiting
   - Reduces attack surface by minimizing token requests

2. **specVersion Validation** (v8.1+)
   - Validates specVersion is a positive integer before processing
   - Prevents edge case bugs in version-aware decryption
   - Protects against malformed app specifications

3. **Azure expires_in Edge Case Handling** (v8.1+)
   - Handles invalid `expires_in` values from Azure OAuth endpoint
   - Prevents authentication failures when Azure returns unexpected data
   - Uses safe defaults (3-hour expiry) when values are invalid

4. **Explicit Error State Clearing** (v8.1+)
   - Clears `lastError` on successful authentication
   - Improves monitoring accuracy and debugging
   - Prevents stale error states from persisting

---

## Questions or Concerns?

If you have security questions or discover vulnerabilities:

1. **General Questions**: See [main documentation](./README.md)
2. **Security Issues**: Report to FluxOS security team (do not create public issues)
3. **Configuration Help**: See [QUICKSTART.md](./QUICKSTART.md)

**Remember**: Cloud provider tokens are cached **in memory only** and **never written to disk**. This is a core security feature of FluxOS registry authentication.
