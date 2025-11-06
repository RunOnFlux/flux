# Multiple Mounts Feature - Complete Guide

## Overview

The multiple mounts feature allows Flux applications to have flexible volume mounting capabilities beyond a single primary mount. This enables applications to mount additional directories, individual files, and reference volumes from other components within the same application.

## Table of Contents

1. [Understanding the File System Structure](#understanding-the-file-system-structure)
2. [Mount Syntax Reference](#mount-syntax-reference)
3. [Basic Examples](#basic-examples)
4. [Advanced Usage Scenarios](#advanced-usage-scenarios)
5. [Important Constraints](#important-constraints)
6. [Usage Metrics and Storage](#usage-metrics-and-storage)
7. [Troubleshooting](#troubleshooting)

---

## Understanding the File System Structure

### Where Do Mounts Come From?

All mounts originate from **host filesystem paths** that are automatically created and managed by Flux. Understanding the directory structure is crucial to using this feature effectively.

### Host Directory Structure

Each component in a Flux application has its own directory on the host system:

```
/apps/                                    # Base apps folder
  └── fluxCOMPONENT_APPNAME/              # Component directory (with "flux" prefix)
      ├── appdata/                        # Primary data directory
      │   └── (primary mount content)     # Files/dirs for primary mount
      ├── logs/                           # Additional directory mount (m:) - same level as appdata
      ├── cache/                          # Another directory mount (m:) - same level as appdata
      ├── config.yaml                     # File mount (f:) - same level as appdata
      └── cert.pem                        # Another file mount (f:) - same level as appdata
```

**Key Points:**
- Primary mount uses the **`appdata/` directory**
- Additional mounts (m:, f:) are created at the **SAME LEVEL** as `appdata/`, not inside it
- All subdirectories/files are siblings of `appdata/` under the component folder
- Paths are **NOT relative to the container** - they're host filesystem paths

### Example Path Mapping

For a component named `web` in an app named `myapp`:

| Mount Definition | Host Path (Source) | Container Path (Target) | What Gets Created |
|-----------------|-------------------|---------------------|-------------------|
| `r:/data` | `/apps/fluxweb_myapp/appdata` | `/data` | Directory `appdata/` |
| `m:logs:/var/log` | `/apps/fluxweb_myapp/logs` | `/var/log` | Directory `logs/` (sibling of appdata) |
| `f:config.yaml:/etc/app.yaml` | `/apps/fluxweb_myapp/config.yaml` | `/etc/app.yaml` | Empty file `config.yaml` (sibling of appdata) |

---

## Mount Syntax Reference

The `containerData` field supports multiple mount types using **pipe-separated syntax**: `mount1|mount2|mount3`

### 1. Primary Mount (Required)

**Syntax:** `[flags]:<container_path>`

**Flags:**
- `r:` - Enable Syncthing replication across nodes
- `g:` - Primary/standby mode (requires 'no' restart policy)
- `s:` - Syncthing folder setup

**Host Path:** `/apps/fluxCOMPONENT_APPNAME/appdata`

**Examples:**
```javascript
// Simple primary mount
containerData: "/data"
// Host: /apps/fluxweb_myapp/appdata -> Container: /data

// With Syncthing replication
containerData: "r:/data"
// Host: /apps/fluxweb_myapp/appdata -> Container: /data (replicated)

// Primary/standby mode
containerData: "g:/data"
// Host: /apps/fluxweb_myapp/appdata -> Container: /data (standby mode)
```

### 2. Additional Directory Mount

**Syntax:** `m:<subdirectory>:<container_path>`

**Host Path:** `/apps/fluxCOMPONENT_APPNAME/<subdirectory>` (same level as appdata)

**What Happens:**
1. Directory `<subdirectory>` is created at the same level as `appdata/`
2. Mounted to `<container_path>` in the container

**Examples:**
```javascript
// Mount additional logs directory
containerData: "/data|m:logs:/var/log"
// Host: /apps/fluxweb_myapp/logs -> Container: /var/log

// Multiple directory mounts
containerData: "/data|m:logs:/var/log|m:cache:/var/cache"
// Host: /apps/fluxweb_myapp/logs -> Container: /var/log
// Host: /apps/fluxweb_myapp/cache -> Container: /var/cache
```

### 3. File Mount

**Syntax:** `f:<filename>:<container_path>`

**Host Path:** `/apps/fluxCOMPONENT_APPNAME/<filename>` (same level as appdata)

**What Happens:**
1. **Empty file** `<filename>` is created at the same level as `appdata/`
2. Mounted to `<container_path>` in the container
3. Application initializes file content on first run

**Examples:**
```javascript
// Mount configuration file
containerData: "/data|f:config.yaml:/etc/app/config.yaml"
// Host: /apps/fluxweb_myapp/config.yaml (empty)
// Container: /etc/app/config.yaml
// App will write its default config on first run

// Mount SSL certificates
containerData: "/data|f:cert.pem:/etc/ssl/cert.pem|f:key.pem:/etc/ssl/key.pem"
// Host: /apps/fluxweb_myapp/cert.pem (empty)
// Host: /apps/fluxweb_myapp/key.pem (empty)
// Container: /etc/ssl/cert.pem and /etc/ssl/key.pem
```

**Important:** Files are created as **empty files** at the component level. The application running in the container must initialize them with content on first run. This allows persistent configuration and data files.

### 4. Component Primary Mount

**Syntax:** `<component_index>:<container_path>`

**Host Path:** `/apps/fluxCOMPONENT_APPNAME/appdata` (from another component)

**What Happens:**
1. References **entire appdata directory** from component at `<component_index>`
2. Mounted to `<container_path>` in current container
3. **Read/write access** to the other component's data

**Examples:**
```javascript
// Component 1 accessing Component 0's data
// Component 0:
{
  name: "database",
  containerData: "r:/var/lib/db"
  // Creates: /apps/fluxdatabase_myapp/appdata
}

// Component 1:
{
  name: "backup",
  containerData: "/backup|0:/db-data"
  // Mounts: /apps/fluxdatabase_myapp/appdata -> Container: /db-data
  // Can read/write Component 0's database files
}
```

### 5. Component Directory Mount

**Syntax:** `c:<component_index>:<subdirectory>:<container_path>`

**Host Path:** `/apps/fluxCOMPONENT_APPNAME/<subdirectory>` (from another component)

**What Happens:**
1. References **specific subdirectory** from component at `<component_index>`
2. Mounted to `<container_path>` in current container

**Examples:**
```javascript
// Component 0:
{
  name: "web",
  containerData: "/data|m:logs:/var/log"
  // Creates: /apps/fluxweb_myapp/logs (sibling of appdata)
}

// Component 1:
{
  name: "loganalyzer",
  containerData: "/analyzer|c:0:logs:/app/logs"
  // Mounts: /apps/fluxweb_myapp/logs -> Container: /app/logs
  // Can analyze Component 0's logs
}
```

### 6. Component File Mount

**Syntax:** `cf:<component_index>:<filename>:<container_path>`

**Host Path:** `/apps/fluxCOMPONENT_APPNAME/<filename>` (from another component)

**What Happens:**
1. References **specific file** from component at `<component_index>`
2. Mounted to `<container_path>` in current container

**Examples:**
```javascript
// Component 0:
{
  name: "config-manager",
  containerData: "/data|f:shared.conf:/etc/shared.conf"
  // Creates: /apps/fluxconfig-manager_myapp/shared.conf (sibling of appdata)
}

// Component 1:
{
  name: "worker",
  containerData: "/app|cf:0:shared.conf:/etc/app.conf"
  // Mounts: /apps/fluxconfig-manager_myapp/shared.conf
  //      -> Container: /etc/app.conf
  // Reads Component 0's configuration
}
```

---

## Basic Examples

### Example 1: Web Application with Logs and Config

**Scenario:** A web server that needs separate log storage and persistent configuration.

```javascript
{
  name: "nginx",
  containerData: "r:/usr/share/nginx/html|m:logs:/var/log/nginx|f:nginx.conf:/etc/nginx/nginx.conf"
}
```

**File System:**
```
/apps/fluxnginx_myapp/
  ├── appdata/                   # Primary mount content
  │   └── (website files)        # Website files
  ├── logs/                      # Nginx logs directory (sibling of appdata)
  │   ├── access.log
  │   └── error.log
  └── nginx.conf                 # Nginx configuration file (sibling of appdata)
```

**Container Mounts:**
- `/usr/share/nginx/html` → website content (replicated via Syncthing)
- `/var/log/nginx` → log files
- `/etc/nginx/nginx.conf` → configuration

### Example 2: Database with Separate Data and Config

**Scenario:** PostgreSQL database with separated data and configuration files.

```javascript
{
  name: "postgres",
  containerData: "r:/var/lib/postgresql/data|f:postgresql.conf:/etc/postgresql.conf|f:pg_hba.conf:/etc/pg_hba.conf"
}
```

**File System:**
```
/apps/fluxpostgres_myapp/
  ├── appdata/                   # Primary mount content
  │   └── (database files)       # Database files
  ├── postgresql.conf            # Main config (empty initially, sibling of appdata)
  └── pg_hba.conf                # Auth config (empty initially, sibling of appdata)
```

**Container Mounts:**
- `/var/lib/postgresql/data` → database files (replicated)
- `/etc/postgresql.conf` → main configuration
- `/etc/pg_hba.conf` → authentication configuration

---

## Advanced Usage Scenarios

### Scenario 1: Multi-Component Application with Shared Data

**Use Case:** Web application with separate frontend, API, and database components sharing configuration.

```javascript
{
  version: 8,
  name: "webapp",
  compose: [
    {
      name: "database",
      containerData: "r:/var/lib/db|f:db.conf:/etc/db.conf"
      // Creates: /apps/fluxdatabase_webapp/appdata/
      //          /apps/fluxdatabase_webapp/db.conf (sibling of appdata)
    },
    {
      name: "api",
      containerData: "/app|0:/database|f:api.conf:/etc/api.conf"
      // Mounts: /apps/fluxdatabase_webapp/appdata -> /database
      // Creates: /apps/fluxapi_webapp/api.conf (sibling of appdata)
    },
    {
      name: "frontend",
      containerData: "r:/usr/share/nginx/html|cf:1:api.conf:/etc/api-endpoint.conf|m:cache:/var/cache"
      // Mounts: /apps/fluxapi_webapp/api.conf -> /etc/api-endpoint.conf
      // Creates: /apps/fluxfrontend_webapp/cache/ (sibling of appdata)
    }
  ]
}
```

**Component Interactions:**
- **Database** (0): Stores data with persistent config
- **API** (1): Accesses database data directly, has own config
- **Frontend** (2): Reads API config, has separate cache, serves replicated content

### Scenario 2: Log Aggregation System

**Use Case:** Multiple services with centralized log collection.

```javascript
{
  version: 8,
  name: "logsystem",
  compose: [
    {
      name: "app1",
      containerData: "/data|m:logs:/var/log/app"
    },
    {
      name: "app2",
      containerData: "/data|m:logs:/var/log/app"
    },
    {
      name: "logcollector",
      containerData: "/collector|c:0:logs:/logs/app1|c:1:logs:/logs/app2"
      // Aggregates logs from both apps
    }
  ]
}
```

**Log Flow:**
1. App1 writes logs to `/var/log/app` → `appdata/logs/`
2. App2 writes logs to `/var/log/app` → `appdata/logs/`
3. Logcollector reads from both locations simultaneously

### Scenario 3: Microservices with Shared Configuration

**Use Case:** Multiple microservices sharing SSL certificates and configuration files.

```javascript
{
  version: 8,
  name: "microservices",
  compose: [
    {
      name: "config",
      containerData: "/config|f:ssl-cert.pem:/certs/cert.pem|f:ssl-key.pem:/certs/key.pem|f:shared.json:/config/shared.json"
      // Central config repository
    },
    {
      name: "service1",
      containerData: "/app|cf:0:ssl-cert.pem:/etc/ssl/cert.pem|cf:0:ssl-key.pem:/etc/ssl/key.pem|cf:0:shared.json:/app/config.json"
    },
    {
      name: "service2",
      containerData: "/app|cf:0:ssl-cert.pem:/etc/ssl/cert.pem|cf:0:ssl-key.pem:/etc/ssl/key.pem|cf:0:shared.json:/app/config.json"
    },
    {
      name: "service3",
      containerData: "/app|cf:0:ssl-cert.pem:/etc/ssl/cert.pem|cf:0:ssl-key.pem:/etc/ssl/key.pem|cf:0:shared.json:/app/config.json"
    }
  ]
}
```

**Benefits:**
- Single source of truth for SSL certificates
- Centralized configuration management
- Update certificates/config in one place, affects all services

### Scenario 4: Build System with Artifact Sharing

**Use Case:** Build pipeline with compilation artifacts shared between stages.

```javascript
{
  version: 8,
  name: "buildpipeline",
  compose: [
    {
      name: "builder",
      containerData: "/workspace|m:artifacts:/build/output|m:cache:/build/cache"
    },
    {
      name: "tester",
      containerData: "/test|c:0:artifacts:/app/build|m:test-results:/test/results"
    },
    {
      name: "packager",
      containerData: "/package|c:0:artifacts:/input|c:1:test-results:/reports|m:packages:/output"
    }
  ]
}
```

**Pipeline Flow:**
1. **Builder** compiles code → artifacts stored in `artifacts/`
2. **Tester** reads compiled artifacts, runs tests → results in `test-results/`
3. **Packager** reads artifacts and test results, creates packages

---

## Important Constraints

### 1. Component Ordering Constraint

**Rule:** Components can **only reference components with lower indices** (earlier in the compose array).

**Valid:**
```javascript
compose: [
  { name: "comp0" },  // Index 0
  { name: "comp1", containerData: "/app|0:/data" },  // ✅ Can reference 0
  { name: "comp2", containerData: "/app|0:/data|1:/more" }  // ✅ Can reference 0 and 1
]
```

**Invalid:**
```javascript
compose: [
  { name: "comp0", containerData: "/app|1:/data" },  // ❌ Cannot reference 1 (not yet defined)
  { name: "comp1" }
]
```

**Reason:** Ensures predictable creation order and prevents circular dependencies.

### 2. Path Security Validation

All paths are validated to prevent directory traversal attacks:

**Invalid paths:**
```javascript
containerData: "m:../etc:/data"           // ❌ Parent directory reference
containerData: "m:/etc/passwd:/data"      // ❌ Absolute path
containerData: "m:logs/../etc:/data"      // ❌ Path traversal
containerData: "f:.ssh/id_rsa:/key"       // ❌ Hidden directory access
```

**Valid paths:**
```javascript
containerData: "m:logs:/data"             // ✅ Simple subdirectory
containerData: "m:app/config:/data"       // ✅ Nested subdirectory
containerData: "f:config.yaml:/etc/app"   // ✅ Simple filename
```

### 3. No Duplicate Subdirectories/Files

Within a single component, all subdirectory and file names must be unique:

**Invalid:**
```javascript
containerData: "/data|m:logs:/var/log|m:logs:/var/log2"
// ❌ Duplicate subdirectory name 'logs'
```

**Valid:**
```javascript
containerData: "/data|m:logs:/var/log|m:application-logs:/var/log2"
// ✅ Different subdirectory names
```

### 4. Syncthing Flags Apply to Entire Component Folder

**Important:** Syncthing flags (`r:`, `g:`, `s:`) in the primary mount apply to the **entire component folder**, not just appdata or individual mounts.

```javascript
// This setting replicates the ENTIRE component folder:
containerData: "r:/data|m:logs:/var/log|f:config.yaml:/etc/app.yaml"
// Everything under /apps/fluxcomponent_app/ is replicated:
//   - appdata/ (primary mount)
//   - logs/ (additional directory)
//   - config.yaml (file mount)
// All subdirectories and files at the component level are synced
```

### 5. File Mounts are Initially Empty

Files created with `f:` syntax are **empty** when first created:

```javascript
containerData: "f:config.yaml:/etc/app/config.yaml"
// /apps/fluxcomponent_app/config.yaml is created as EMPTY file (sibling of appdata)
// Application must detect and create default config on first run
```

**Application Code Example:**
```javascript
// App initialization code
if (fs.statSync('/etc/app/config.yaml').size === 0) {
  // First run - create default config
  fs.writeFileSync('/etc/app/config.yaml', defaultConfig);
}
```

---

## Usage Metrics and Storage

### How Disk Usage is Calculated

**Key Insight:** Flux automatically handles nested mount accounting to prevent double-counting.

### Nested Mount Detection

When you create multiple mounts like this:
```javascript
containerData: "/data|m:logs:/var/log|m:cache:/var/cache|f:config.yaml:/etc/app.yaml"
```

The actual host paths are:
```
/apps/fluxcomponent_app/appdata/           ← Primary mount
/apps/fluxcomponent_app/logs/              ← Sibling mount (same level as appdata)
/apps/fluxcomponent_app/cache/             ← Sibling mount (same level as appdata)
/apps/fluxcomponent_app/config.yaml        ← Sibling mount (same level as appdata)
```

### Usage Calculation Process

1. **Docker Inspect:** Flux queries all container mounts
2. **Independent Mounts:** All mounts at component level are independent (siblings)
3. **Sum All Mounts:** Each mount is measured individually using `du -sb`
4. **Total Usage:** Sum of all mount sizes

**Example:**
```
Mount List from Docker:
  ✓ /apps/fluxcomponent_app/appdata          → COUNTED (40 GB)
  ✓ /apps/fluxcomponent_app/logs             → COUNTED (8 GB)
  ✓ /apps/fluxcomponent_app/cache            → COUNTED (2 GB)
  ✓ /apps/fluxcomponent_app/config.yaml      → COUNTED (1 MB)

Total Usage: 50 GB (sum of all mount points)
```

### Why This Matters

**Billing/Resource Allocation:**
- You pay for **total data used**, not number of mounts
- Multiple mounts don't increase costs
- Actual disk space usage is accurately reported

**Storage Limits:**
- Component storage limit applies to **sum of all mounts**
- Each mount point is counted individually
- Total must stay within allocated limit

### Example Calculation

**Application with multiple mounts:**
```javascript
{
  name: "myapp",
  containerData: "r:/data|m:logs:/var/log|m:cache:/tmp|f:config:/etc/app.conf",
  hdd: 10  // 10 GB allocated
}
```

**Disk Usage:**
```
/apps/fluxmyapp_app/
  ├── appdata/             (8.5 GB)
  │   ├── database/        (8 GB)
  │   └── uploads/         (500 MB)
  ├── logs/                (500 MB)
  ├── cache/               (200 MB)
  └── config               (1 MB)

Total: 9.2 GB (within 10 GB limit) ✅
```

**Reported Metrics:**
- Separate `du -sb` command for each mount point
- Sum of all mount sizes: 8.5 GB + 500 MB + 200 MB + 1 MB = 9.2 GB
- All mounts counted independently

---

## Troubleshooting

### Issue: Mount Not Found in Container

**Symptom:** Container starts but mount point doesn't exist or is empty.

**Possible Causes:**
1. **Typo in containerData syntax**
   ```javascript
   // Wrong:
   containerData: "m:logs/var/log"  // Missing colon
   // Correct:
   containerData: "m:logs:/var/log"
   ```

2. **Invalid component reference**
   ```javascript
   // Wrong: Component 0 referencing component 1
   compose: [
     { name: "comp0", containerData: "/app|1:/data" },  // ❌
     { name: "comp1" }
   ]
   ```

3. **Path security violation**
   ```javascript
   // Wrong:
   containerData: "m:../etc:/data"  // Directory traversal
   ```

**Solution:** Check logs for mount creation errors during app installation.

### Issue: File Mount is Empty

**Symptom:** File exists but has no content.

**Expected Behavior:** File mounts (`f:`) are **intentionally empty** on creation.

**Solution:** Application must initialize file content on first run:
```javascript
// Check if file is empty
if (fs.statSync('/etc/app/config.yaml').size === 0) {
  // Write default config
  fs.writeFileSync('/etc/app/config.yaml', defaultConfigContent);
}
```

### Issue: Data Not Syncing Across Nodes

**Symptom:** Syncthing enabled but data not replicating.

**Check:**
1. **Correct flag used:** Must be `r:`, `g:`, or `s:` on primary mount
   ```javascript
   containerData: "r:/data|m:logs:/var/log"  // ✅ Correct
   ```

2. **Flags apply to entire component folder:** All subdirectories/files are synced
   ```javascript
   // This syncs the entire /apps/fluxapp/ folder:
   // - appdata/ (primary mount)
   // - logs/ (additional directory)
   // Everything at the component level is replicated
   containerData: "r:/data|m:logs:/var/log"
   ```

3. **Syncthing syncs component root:** The entire component folder is synced, including all mount points

### Issue: Storage Usage Seems Wrong

**Symptom:** Reported storage doesn't match expectations.

**Understanding:**
- All **mount points** are counted individually
- Mounts are siblings at component level (not nested)
- Total usage is sum of all mount sizes

**Check:**
```bash
# Manually check storage for each mount (on Flux node)
sudo du -sh /apps/fluxCOMPONENT_APPNAME/appdata
sudo du -sh /apps/fluxCOMPONENT_APPNAME/logs
sudo du -sh /apps/fluxCOMPONENT_APPNAME/cache
# Sum all mount points for total usage
```

### Issue: Component Reference Not Working

**Symptom:** Component can't access another component's data.

**Checklist:**
1. **Index order:** Can only reference lower indices
   ```javascript
   compose: [
     { name: "comp0" },              // Index 0
     { name: "comp1", containerData: "/app|0:/data" }  // ✅ OK
   ]
   ```

2. **Valid index:** Component index exists
   ```javascript
   compose: [
     { name: "comp0" },
     { name: "comp1", containerData: "/app|5:/data" }  // ❌ No index 5
   ]
   ```

3. **Correct subdirectory:** Referenced subdirectory exists in source component
   ```javascript
   // Component 0:
   { name: "comp0", containerData: "/data|m:logs:/var/log" }
   // Component 1:
   { name: "comp1", containerData: "/app|c:0:logs:/app/logs" }  // ✅
   { name: "comp2", containerData: "/app|c:0:cache:/app/cache" } // ❌ No 'cache' dir
   ```

---

## Summary

### Key Takeaways

1. **Primary mount uses `appdata/` directory; additional mounts are siblings**
2. **Additional mounts (m:, f:) are at the SAME LEVEL as appdata**, not inside it
3. **File mounts create empty files** - apps must initialize them
4. **Components can only reference earlier components** (lower indices)
5. **Syncthing flags replicate the entire component folder** (all subdirectories and files)
6. **Usage metrics count each mount independently** - sum of all mount sizes
7. **Each mount type serves a specific purpose:**
   - Primary: Main data directory (`appdata/`)
   - Directory (m:): Additional data organization (sibling of `appdata/`)
   - File (f:): Persistent configuration files (sibling of `appdata/`)
   - Component refs (0:, c:, cf:): Share data between components

### Best Practices

1. **Use file mounts for configuration** that should persist across container rebuilds
2. **Use directory mounts for organized data storage** (logs, cache, uploads)
3. **Use component references sparingly** - only when truly needed for data sharing
4. **Order components logically** - dependencies should come first
5. **Document your mount strategy** in application README
6. **Test storage calculations** to ensure they match expectations
7. **Initialize file mounts** in application startup code

### Getting Help

If you encounter issues:
1. Check application install logs for mount creation errors
2. Verify containerData syntax matches examples in this guide
3. Confirm component indices and ordering
4. Review constraint violations (security, duplicates, ordering)
5. Consult Flux documentation or community support

---

**Document Version:** 2.0
**Feature Branch:** fix/filemounts
**Last Updated:** 2025-11-06
**Key Changes in v2.0:**
- Mount structure changed: Additional mounts now siblings of `appdata/`, not nested inside
- File mounts now at component level, not in subdirectories
- Syncthing syncs entire component folder, not individual mount points
- Storage calculation counts all mounts individually
