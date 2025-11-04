# Multiple Mounts API Reference

Complete reference documentation for the multiple mounts feature implementation.

## Table of Contents

1. [Overview](#overview)
2. [parseContainerData()](#parsecontainerdata)
3. [constructVolumes()](#constructvolumes)
4. [getRequiredLocalPaths()](#getrequiredlocalpaths)
5. [Path Resolution Rules](#path-resolution-rules)
6. [Component Ordering Constraints](#component-ordering-constraints)
7. [Storage Usage Calculation](#storage-usage-calculation)

---

## Overview

The multiple mounts API consists of three main functions that work together to parse, validate, and construct Docker volume mounts from the enhanced `containerData` syntax.

**Module Locations:**
- **mountParser.js**: `ZelBack/src/services/utils/mountParser.js`
- **volumeConstructor.js**: `ZelBack/src/services/utils/volumeConstructor.js`

**Workflow:**
1. `parseContainerData()` - Parse containerData string into structured mount definitions
2. `getRequiredLocalPaths()` - Extract local paths that need to be created
3. `constructVolumes()` - Build Docker Mount objects with full host paths

---

## parseContainerData()

**Location:** `ZelBack/src/services/utils/mountParser.js`

**Purpose:** Parse complete containerData string into structured mount definitions.

**Signature:**
```javascript
function parseContainerData(containerData)
```

**Parameters:**
- `containerData` (string) - Pipe-separated mount definitions

**Returns:**
```javascript
{
  primary: {...},        // Primary mount definition
  additional: [...],     // Array of additional mounts
  allMounts: [...]      // All mounts combined
}
```

### Basic Examples - Understanding Directory Origins

#### Example 1: Simple primary mount
```javascript
// containerData: "/data"
// Host source: /apps/fluxCOMPONENT_APPNAME/appdata/
// Container target: /data
parseContainerData("/data");
```

#### Example 2: Primary mount with Syncthing replication
```javascript
// containerData: "r:/data"
// Host source: /apps/fluxCOMPONENT_APPNAME/appdata/ (replicated)
// Container target: /data
parseContainerData("r:/data");
```

#### Example 3: Primary mount with standby mode
```javascript
// containerData: "g:/data"
// Host source: /apps/fluxCOMPONENT_APPNAME/appdata/ (standby mode)
// Container target: /data
parseContainerData("g:/data");
```

### Directory Mounts - Additional Storage Organization

#### Example 4: Primary + additional directory mount
```javascript
// containerData: "/data|m:logs:/var/log"
// Host sources:
//   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data (primary)
//   - /apps/fluxCOMPONENT_APPNAME/appdata/logs/ -> /var/log (additional)
// Directory 'logs/' is created INSIDE appdata/
parseContainerData("/data|m:logs:/var/log");
```

#### Example 5: Multiple directory mounts
```javascript
// containerData: "r:/data|m:logs:/var/log|m:cache:/tmp/cache"
// Host sources (all under appdata/):
//   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data (replicated)
//   - /apps/fluxCOMPONENT_APPNAME/appdata/logs/ -> /var/log
//   - /apps/fluxCOMPONENT_APPNAME/appdata/cache/ -> /tmp/cache
parseContainerData("r:/data|m:logs:/var/log|m:cache:/tmp/cache");
```

### File Mounts - Persistent Configuration Files

#### Example 6: Single file mount
```javascript
// containerData: "/data|f:config.yaml:/etc/app/config.yaml"
// Host sources:
//   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data
//   - /apps/fluxCOMPONENT_APPNAME/appdata/config.yaml -> /etc/app/config.yaml
// File config.yaml is created as EMPTY file inside appdata/
// Application must initialize it on first run
parseContainerData("/data|f:config.yaml:/etc/app/config.yaml");
```

#### Example 7: Multiple file mounts (SSL certificates)
```javascript
// containerData: "/data|f:cert.pem:/etc/ssl/cert.pem|f:key.pem:/etc/ssl/key.pem"
// Host sources (all EMPTY files created inside appdata/):
//   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data
//   - /apps/fluxCOMPONENT_APPNAME/appdata/cert.pem -> /etc/ssl/cert.pem
//   - /apps/fluxCOMPONENT_APPNAME/appdata/key.pem -> /etc/ssl/key.pem
parseContainerData("/data|f:cert.pem:/etc/ssl/cert.pem|f:key.pem:/etc/ssl/key.pem");
```

#### Example 8: Mixed mounts - directories and files
```javascript
// containerData: "r:/data|m:logs:/var/log|f:app.conf:/etc/app.conf"
// Host sources:
//   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data (replicated)
//   - /apps/fluxCOMPONENT_APPNAME/appdata/logs/ -> /var/log
//   - /apps/fluxCOMPONENT_APPNAME/appdata/app.conf -> /etc/app.conf
parseContainerData("r:/data|m:logs:/var/log|f:app.conf:/etc/app.conf");
```

### Component References - Sharing Data Between Components

#### Example 9: Component primary mount (entire appdata from another component)
```javascript
// Component 0: { name: "database", containerData: "r:/var/lib/db" }
//   Creates: /apps/fluxdatabase_APPNAME/appdata/

// Component 1: { name: "backup", containerData: "/backup|0:/db-data" }
//   Mounts Component 0's entire appdata:
//   - /apps/fluxdatabase_APPNAME/appdata/ -> /db-data
// Can read/write Component 0's database files
parseContainerData("/backup|0:/db-data");
```

#### Example 10: Component directory mount (specific subdirectory from another component)
```javascript
// Component 0: { name: "web", containerData: "/data|m:logs:/var/log" }
//   Creates: /apps/fluxweb_APPNAME/appdata/logs/

// Component 1: { name: "analyzer", containerData: "/app|c:0:logs:/app/logs" }
//   Mounts Component 0's logs subdirectory:
//   - /apps/fluxweb_APPNAME/appdata/logs/ -> /app/logs
parseContainerData("/app|c:0:logs:/app/logs");
```

#### Example 11: Component file mount (specific file from another component)
```javascript
// Component 0: { name: "config", containerData: "/data|f:shared.conf:/etc/shared.conf" }
//   Creates: /apps/fluxconfig_APPNAME/appdata/shared.conf

// Component 1: { name: "worker", containerData: "/app|cf:0:shared.conf:/etc/app.conf" }
//   Mounts Component 0's shared.conf file:
//   - /apps/fluxconfig_APPNAME/appdata/shared.conf -> /etc/app.conf
parseContainerData("/app|cf:0:shared.conf:/etc/app.conf");
```

### Advanced Scenarios - Real-World Use Cases

#### Example 12: Web server with organized storage
```javascript
// containerData: "r:/usr/share/nginx/html|m:logs:/var/log/nginx|m:cache:/var/cache/nginx|f:nginx.conf:/etc/nginx/nginx.conf"
// File system structure on host:
//   /apps/fluxnginx_APPNAME/appdata/
//     ├── (website files)           -> /usr/share/nginx/html (replicated)
//     ├── logs/                     -> /var/log/nginx
//     ├── cache/                    -> /var/cache/nginx
//     └── nginx.conf                -> /etc/nginx/nginx.conf (empty, app initializes)
parseContainerData("r:/usr/share/nginx/html|m:logs:/var/log/nginx|m:cache:/var/cache/nginx|f:nginx.conf:/etc/nginx/nginx.conf");
```

#### Example 13: Database with backup component
```javascript
// Component 0: { name: "postgres", containerData: "r:/var/lib/postgresql/data|f:postgresql.conf:/etc/postgresql.conf" }
//   Creates:
//     /apps/fluxpostgres_APPNAME/appdata/
//     /apps/fluxpostgres_APPNAME/appdata/postgresql.conf

// Component 1: { name: "pgbackup", containerData: "/backup|0:/database|m:archives:/var/backups" }
//   Mounts:
//     /apps/fluxpostgres_APPNAME/appdata/ -> /database (can read DB files)
//     /apps/fluxpgbackup_APPNAME/appdata/archives/ -> /var/backups (stores backups)
parseContainerData("/backup|0:/database|m:archives:/var/backups");
```

#### Example 14: Microservices with shared SSL certificates
```javascript
// Component 0: { name: "certs", containerData: "/certs|f:ssl-cert.pem:/cert.pem|f:ssl-key.pem:/key.pem" }
//   Creates:
//     /apps/fluxcerts_APPNAME/appdata/ssl-cert.pem (empty)
//     /apps/fluxcerts_APPNAME/appdata/ssl-key.pem (empty)

// Component 1: { name: "api", containerData: "/app|cf:0:ssl-cert.pem:/etc/ssl/cert.pem|cf:0:ssl-key.pem:/etc/ssl/key.pem" }
//   Mounts Component 0's certificate files:
//     /apps/fluxcerts_APPNAME/appdata/ssl-cert.pem -> /etc/ssl/cert.pem
//     /apps/fluxcerts_APPNAME/appdata/ssl-key.pem -> /etc/ssl/key.pem

// Component 2: { name: "web", containerData: "r:/www|cf:0:ssl-cert.pem:/etc/ssl/cert.pem|cf:0:ssl-key.pem:/etc/ssl/key.pem" }
//   All services share the same SSL certificates from Component 0
parseContainerData("r:/www|cf:0:ssl-cert.pem:/etc/ssl/cert.pem|cf:0:ssl-key.pem:/etc/ssl/key.pem");
```

#### Example 15: Log aggregation system
```javascript
// Component 0: { name: "app1", containerData: "/data|m:logs:/var/log/app" }
//   Creates: /apps/fluxapp1_APPNAME/appdata/logs/

// Component 1: { name: "app2", containerData: "/data|m:logs:/var/log/app" }
//   Creates: /apps/fluxapp2_APPNAME/appdata/logs/

// Component 2: { name: "logcollector", containerData: "/collector|c:0:logs:/logs/app1|c:1:logs:/logs/app2" }
//   Aggregates logs from multiple components:
//     /apps/fluxapp1_APPNAME/appdata/logs/ -> /logs/app1
//     /apps/fluxapp2_APPNAME/appdata/logs/ -> /logs/app2
parseContainerData("/collector|c:0:logs:/logs/app1|c:1:logs:/logs/app2");
```

### Important Notes

#### 1. PATH ORIGINS
- All paths are relative to `/apps/fluxCOMPONENT_APPNAME/appdata/` on the **HOST**
- Additional mounts (m:, f:) create subdirs/files **INSIDE** appdata/
- Component refs (0:, c:, cf:) point to **OTHER** components' appdata/

#### 2. FILE MOUNTS
- Files are created **EMPTY**
- Application must initialize them on first run
- Check file size to detect first run: `if (size === 0) { initialize(); }`

#### 3. SYNCTHING FLAGS
- Flags (r:, g:, s:) apply to **ENTIRE** appdata folder
- All subdirectories and files are included in replication

#### 4. COMPONENT ORDERING
- Components can **ONLY** reference lower indices
- Component 1 can reference Component 0
- Component 0 **CANNOT** reference Component 1

#### 5. STORAGE USAGE
- Usage is calculated **ONCE** for entire appdata/
- Nested mounts are **NOT** double-counted
- Total usage includes all subdirectories and files

---

## constructVolumes()

**Location:** `ZelBack/src/services/utils/volumeConstructor.js`

**Purpose:** Construct Docker bind mounts from parsed mount definitions with full host paths.

**Signature:**
```javascript
function constructVolumes(parsedMounts, identifier, appName, fullAppSpecs, appSpecifications, useModernMounts = true)
```

**Parameters:**
- `parsedMounts` (object) - Parsed mount data from `parseContainerData()`
- `identifier` (string) - Current component identifier (e.g., "component_appname")
- `appName` (string) - Application name
- `fullAppSpecs` (object) - Full application specifications (required for component refs)
- `appSpecifications` (object) - Current component specifications
- `useModernMounts` (boolean) - If true, return Mount objects instead of Binds strings (default: true)

**Returns:**
```javascript
Array<Object|string>  // Array of Docker Mount objects or bind mount strings
```

### Basic Volume Construction

#### Example 1: Simple primary mount
```javascript
const parsed1 = parseContainerData("/data");
const volumes1 = constructVolumes(parsed1, "myapp", "myapp", null, null);
// Result: [{ Type: 'bind', Source: '/apps/fluxmyapp/appdata', Target: '/data', ... }]
```

#### Example 2: Primary + directory mount
```javascript
const parsed2 = parseContainerData("/data|m:logs:/var/log");
const volumes2 = constructVolumes(parsed2, "web_myapp", "myapp", null, null);
// Result: [
//   { Source: '/apps/fluxweb_myapp/appdata', Target: '/data' },
//   { Source: '/apps/fluxweb_myapp/appdata/logs', Target: '/var/log' }
// ]
```

#### Example 3: Primary + file mount
```javascript
const parsed3 = parseContainerData("/data|f:config.yaml:/etc/app.yaml");
const volumes3 = constructVolumes(parsed3, "api_myapp", "myapp", null, null);
// Result: [
//   { Source: '/apps/fluxapi_myapp/appdata', Target: '/data' },
//   { Source: '/apps/fluxapi_myapp/appdata/config.yaml', Target: '/etc/app.yaml' }
// ]
```

### Component References

#### Example 4: Component primary reference
```javascript
const fullSpecs4 = {
  version: 8,
  name: "myapp",
  compose: [
    { name: "database", containerData: "r:/var/lib/db" },
    { name: "backup", containerData: "/backup|0:/db-data" }
  ]
};
const parsed4 = parseContainerData("/backup|0:/db-data");
const volumes4 = constructVolumes(parsed4, "backup_myapp", "myapp", fullSpecs4, fullSpecs4.compose[1]);
// Result: [
//   { Source: '/apps/fluxbackup_myapp/appdata', Target: '/backup' },
//   { Source: '/apps/fluxdatabase_myapp/appdata', Target: '/db-data' }  ← Component 0's appdata
// ]
```

#### Example 5: Component directory reference
```javascript
const fullSpecs5 = {
  version: 8,
  name: "logsys",
  compose: [
    { name: "app", containerData: "/data|m:logs:/var/log" },
    { name: "analyzer", containerData: "/analyzer|c:0:logs:/app/logs" }
  ]
};
const parsed5 = parseContainerData("/analyzer|c:0:logs:/app/logs");
const volumes5 = constructVolumes(parsed5, "analyzer_logsys", "logsys", fullSpecs5, fullSpecs5.compose[1]);
// Result: [
//   { Source: '/apps/fluxanalyzer_logsys/appdata', Target: '/analyzer' },
//   { Source: '/apps/fluxapp_logsys/appdata/logs', Target: '/app/logs' }  ← Component 0's logs dir
// ]
```

#### Example 6: Component file reference
```javascript
const fullSpecs6 = {
  version: 8,
  name: "certapp",
  compose: [
    { name: "certs", containerData: "/certs|f:ssl.pem:/cert.pem" },
    { name: "web", containerData: "r:/www|cf:0:ssl.pem:/etc/ssl/cert.pem" }
  ]
};
const parsed6 = parseContainerData("r:/www|cf:0:ssl.pem:/etc/ssl/cert.pem");
const volumes6 = constructVolumes(parsed6, "web_certapp", "certapp", fullSpecs6, fullSpecs6.compose[1]);
// Result: [
//   { Source: '/apps/fluxweb_certapp/appdata', Target: '/www' },
//   { Source: '/apps/fluxcerts_certapp/appdata/ssl.pem', Target: '/etc/ssl/cert.pem' }  ← Component 0's file
// ]
```

### Advanced Real-World Scenarios

#### Example 7: Complete web application with nginx + app + database
```javascript
const fullSpecs7 = {
  version: 8,
  name: "webapp",
  compose: [
    {
      name: "database",
      containerData: "r:/var/lib/postgresql/data|f:postgresql.conf:/etc/postgresql.conf"
    },
    {
      name: "app",
      containerData: "/app|0:/database|m:uploads:/app/uploads|f:app.conf:/etc/app.conf"
    },
    {
      name: "nginx",
      containerData: "r:/usr/share/nginx/html|c:1:uploads:/www/uploads|m:logs:/var/log/nginx|f:nginx.conf:/etc/nginx/nginx.conf"
    }
  ]
};

// Component 0 (database) volumes:
const parsed7a = parseContainerData("r:/var/lib/postgresql/data|f:postgresql.conf:/etc/postgresql.conf");
const volumes7a = constructVolumes(parsed7a, "database_webapp", "webapp", fullSpecs7, fullSpecs7.compose[0]);
// Result: [
//   { Source: '/apps/fluxdatabase_webapp/appdata', Target: '/var/lib/postgresql/data' },
//   { Source: '/apps/fluxdatabase_webapp/appdata/postgresql.conf', Target: '/etc/postgresql.conf' }
// ]

// Component 1 (app) volumes:
const parsed7b = parseContainerData("/app|0:/database|m:uploads:/app/uploads|f:app.conf:/etc/app.conf");
const volumes7b = constructVolumes(parsed7b, "app_webapp", "webapp", fullSpecs7, fullSpecs7.compose[1]);
// Result: [
//   { Source: '/apps/fluxapp_webapp/appdata', Target: '/app' },
//   { Source: '/apps/fluxdatabase_webapp/appdata', Target: '/database' },              ← DB access
//   { Source: '/apps/fluxapp_webapp/appdata/uploads', Target: '/app/uploads' },
//   { Source: '/apps/fluxapp_webapp/appdata/app.conf', Target: '/etc/app.conf' }
// ]

// Component 2 (nginx) volumes:
const parsed7c = parseContainerData("r:/usr/share/nginx/html|c:1:uploads:/www/uploads|m:logs:/var/log/nginx|f:nginx.conf:/etc/nginx/nginx.conf");
const volumes7c = constructVolumes(parsed7c, "nginx_webapp", "webapp", fullSpecs7, fullSpecs7.compose[2]);
// Result: [
//   { Source: '/apps/fluxnginx_webapp/appdata', Target: '/usr/share/nginx/html' },
//   { Source: '/apps/fluxapp_webapp/appdata/uploads', Target: '/www/uploads' },       ← Serve app uploads
//   { Source: '/apps/fluxnginx_webapp/appdata/logs', Target: '/var/log/nginx' },
//   { Source: '/apps/fluxnginx_webapp/appdata/nginx.conf', Target: '/etc/nginx/nginx.conf' }
// ]
```

#### Example 8: Microservices with shared configuration
```javascript
const fullSpecs8 = {
  version: 8,
  name: "microservices",
  compose: [
    {
      name: "config",
      containerData: "/config|f:shared.json:/config.json|f:cert.pem:/cert.pem|f:key.pem:/key.pem"
    },
    {
      name: "service1",
      containerData: "/app|cf:0:shared.json:/etc/config.json|cf:0:cert.pem:/etc/ssl/cert.pem|cf:0:key.pem:/etc/ssl/key.pem"
    },
    {
      name: "service2",
      containerData: "/app|cf:0:shared.json:/etc/config.json|cf:0:cert.pem:/etc/ssl/cert.pem|cf:0:key.pem:/etc/ssl/key.pem"
    }
  ]
};

// Component 0 (config) - stores all shared files
const parsed8a = parseContainerData("/config|f:shared.json:/config.json|f:cert.pem:/cert.pem|f:key.pem:/key.pem");
const volumes8a = constructVolumes(parsed8a, "config_microservices", "microservices", fullSpecs8, fullSpecs8.compose[0]);
// Result: [
//   { Source: '/apps/fluxconfig_microservices/appdata', Target: '/config' },
//   { Source: '/apps/fluxconfig_microservices/appdata/shared.json', Target: '/config.json' },
//   { Source: '/apps/fluxconfig_microservices/appdata/cert.pem', Target: '/cert.pem' },
//   { Source: '/apps/fluxconfig_microservices/appdata/key.pem', Target: '/key.pem' }
// ]

// Component 1 & 2 (services) - all read from Component 0's files
const parsed8b = parseContainerData("/app|cf:0:shared.json:/etc/config.json|cf:0:cert.pem:/etc/ssl/cert.pem|cf:0:key.pem:/etc/ssl/key.pem");
const volumes8b = constructVolumes(parsed8b, "service1_microservices", "microservices", fullSpecs8, fullSpecs8.compose[1]);
// Result: [
//   { Source: '/apps/fluxservice1_microservices/appdata', Target: '/app' },
//   { Source: '/apps/fluxconfig_microservices/appdata/shared.json', Target: '/etc/config.json' },  ← Shared
//   { Source: '/apps/fluxconfig_microservices/appdata/cert.pem', Target: '/etc/ssl/cert.pem' },    ← Shared
//   { Source: '/apps/fluxconfig_microservices/appdata/key.pem', Target: '/etc/ssl/key.pem' }       ← Shared
// ]
// Service2 gets identical mounts from Component 0
```

#### Example 9: Build pipeline with artifact sharing
```javascript
const fullSpecs9 = {
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
};

// Component 0 (builder) - compiles code, outputs artifacts
const parsed9a = parseContainerData("/workspace|m:artifacts:/build/output|m:cache:/build/cache");
const volumes9a = constructVolumes(parsed9a, "builder_buildpipeline", "buildpipeline", fullSpecs9, fullSpecs9.compose[0]);
// Result: [
//   { Source: '/apps/fluxbuilder_buildpipeline/appdata', Target: '/workspace' },
//   { Source: '/apps/fluxbuilder_buildpipeline/appdata/artifacts', Target: '/build/output' },
//   { Source: '/apps/fluxbuilder_buildpipeline/appdata/cache', Target: '/build/cache' }
// ]

// Component 1 (tester) - reads artifacts, produces test results
const parsed9b = parseContainerData("/test|c:0:artifacts:/app/build|m:test-results:/test/results");
const volumes9b = constructVolumes(parsed9b, "tester_buildpipeline", "buildpipeline", fullSpecs9, fullSpecs9.compose[1]);
// Result: [
//   { Source: '/apps/fluxtester_buildpipeline/appdata', Target: '/test' },
//   { Source: '/apps/fluxbuilder_buildpipeline/appdata/artifacts', Target: '/app/build' },    ← Builder's output
//   { Source: '/apps/fluxtester_buildpipeline/appdata/test-results', Target: '/test/results' }
// ]

// Component 2 (packager) - reads artifacts and test results, creates packages
const parsed9c = parseContainerData("/package|c:0:artifacts:/input|c:1:test-results:/reports|m:packages:/output");
const volumes9c = constructVolumes(parsed9c, "packager_buildpipeline", "buildpipeline", fullSpecs9, fullSpecs9.compose[2]);
// Result: [
//   { Source: '/apps/fluxpackager_buildpipeline/appdata', Target: '/package' },
//   { Source: '/apps/fluxbuilder_buildpipeline/appdata/artifacts', Target: '/input' },          ← Builder's output
//   { Source: '/apps/fluxtester_buildpipeline/appdata/test-results', Target: '/reports' },     ← Tester's results
//   { Source: '/apps/fluxpackager_buildpipeline/appdata/packages', Target: '/output' }
// ]
```

---

## getRequiredLocalPaths()

**Location:** `ZelBack/src/services/utils/mountParser.js`

**Purpose:** Get all subdirectories/files that need to be created for a component. Returns only LOCAL mounts (not component references).

**Signature:**
```javascript
function getRequiredLocalPaths(parsedMounts)
```

**Parameters:**
- `parsedMounts` (object) - Result from `parseContainerData()`

**Returns:**
```javascript
Array<{name: string, isFile: boolean}>  // Array of paths to create
```

### Examples

#### Example 1: Primary mount only
```javascript
const parsed1 = parseContainerData("/data");
const paths1 = getRequiredLocalPaths(parsed1);
// Returns: [{ name: 'appdata', isFile: false }]
// Will create: /apps/fluxCOMPONENT_APPNAME/appdata/
```

#### Example 2: Primary + directory mounts
```javascript
const parsed2 = parseContainerData("/data|m:logs:/var/log|m:cache:/tmp");
const paths2 = getRequiredLocalPaths(parsed2);
// Returns: [
//   { name: 'appdata', isFile: false },
//   { name: 'logs', isFile: false },
//   { name: 'cache', isFile: false }
// ]
// Will create:
//   /apps/fluxCOMPONENT_APPNAME/appdata/
//   /apps/fluxCOMPONENT_APPNAME/appdata/logs/
//   /apps/fluxCOMPONENT_APPNAME/appdata/cache/
```

#### Example 3: Primary + file mounts
```javascript
const parsed3 = parseContainerData("/data|f:config.yaml:/etc/app.yaml|f:cert.pem:/ssl/cert.pem");
const paths3 = getRequiredLocalPaths(parsed3);
// Returns: [
//   { name: 'appdata', isFile: false },
//   { name: 'config.yaml', isFile: true },
//   { name: 'cert.pem', isFile: true }
// ]
// Will create:
//   /apps/fluxCOMPONENT_APPNAME/appdata/
//   /apps/fluxCOMPONENT_APPNAME/appdata/config.yaml (empty file)
//   /apps/fluxCOMPONENT_APPNAME/appdata/cert.pem (empty file)
```

#### Example 4: Mixed local mounts (directories and files)
```javascript
const parsed4 = parseContainerData("r:/data|m:logs:/var/log|f:app.conf:/etc/app.conf|m:uploads:/uploads");
const paths4 = getRequiredLocalPaths(parsed4);
// Returns: [
//   { name: 'appdata', isFile: false },
//   { name: 'logs', isFile: false },
//   { name: 'app.conf', isFile: true },
//   { name: 'uploads', isFile: false }
// ]
```

#### Example 5: Component references are EXCLUDED
```javascript
const parsed5 = parseContainerData("/app|0:/database|c:0:logs:/logs|cf:0:config:/cfg");
const paths5 = getRequiredLocalPaths(parsed5);
// Returns: [{ name: 'appdata', isFile: false }]
// Only creates local appdata, NOT the referenced component's paths
// Component references (0:, c:0:, cf:0:) point to OTHER components
```

#### Example 6: Web server with organized storage
```javascript
const parsed6 = parseContainerData("r:/www|m:logs:/var/log/nginx|m:cache:/var/cache|f:nginx.conf:/etc/nginx/nginx.conf");
const paths6 = getRequiredLocalPaths(parsed6);
// Returns: [
//   { name: 'appdata', isFile: false },  → /apps/fluxweb_app/appdata/
//   { name: 'logs', isFile: false },     → /apps/fluxweb_app/appdata/logs/
//   { name: 'cache', isFile: false },    → /apps/fluxweb_app/appdata/cache/
//   { name: 'nginx.conf', isFile: true } → /apps/fluxweb_app/appdata/nginx.conf (empty)
// ]
```

#### Example 7: Database with config files
```javascript
const parsed7 = parseContainerData("r:/var/lib/db|f:db.conf:/etc/db.conf|f:users.txt:/etc/users.txt");
const paths7 = getRequiredLocalPaths(parsed7);
// Returns: [
//   { name: 'appdata', isFile: false },
//   { name: 'db.conf', isFile: true },
//   { name: 'users.txt', isFile: true }
// ]
// Files created empty - database initializes them on first run
```

---

## Path Resolution Rules

### 1. PRIMARY MOUNT
- **Syntax:** `[flags]:<path>` or `<path>`
- **Host Path:** `/apps/fluxCOMPONENT_APPNAME/appdata`
- **Purpose:** Base directory for the component

### 2. DIRECTORY MOUNT (m:)
- **Syntax:** `m:<subdirectory>:<container_path>`
- **Host Path:** `/apps/fluxCOMPONENT_APPNAME/appdata/<subdirectory>`
- **Purpose:** Additional data organization within the component
- **Created:** As a subdirectory INSIDE appdata

### 3. FILE MOUNT (f:)
- **Syntax:** `f:<filename>:<container_path>`
- **Host Path:** `/apps/fluxCOMPONENT_APPNAME/appdata/<filename>`
- **Purpose:** Persistent configuration files
- **Created:** As an empty file INSIDE appdata
- **Important:** Application must initialize file content on first run

### 4. COMPONENT PRIMARY (0:)
- **Syntax:** `<component_index>:<container_path>`
- **Host Path:** `/apps/fluxOTHER_COMPONENT_APPNAME/appdata`
- **Purpose:** Access another component's entire data directory
- **Important:** References another component, doesn't create new paths

### 5. COMPONENT DIRECTORY (c:)
- **Syntax:** `c:<component_index>:<subdirectory>:<container_path>`
- **Host Path:** `/apps/fluxOTHER_COMPONENT_APPNAME/appdata/<subdirectory>`
- **Purpose:** Access specific subdirectory from another component
- **Important:** Subdirectory must exist in the referenced component

### 6. COMPONENT FILE (cf:)
- **Syntax:** `cf:<component_index>:<filename>:<container_path>`
- **Host Path:** `/apps/fluxOTHER_COMPONENT_APPNAME/appdata/<filename>`
- **Purpose:** Access specific file from another component
- **Important:** File must exist in the referenced component

---

## Component Ordering Constraints

Components can **ONLY** reference components with **LOWER** indices in the compose array.

### Valid References

```javascript
compose: [
  { name: "comp0" },              // Index 0
  { name: "comp1" },              // Index 1 - can reference 0
  { name: "comp2" }               // Index 2 - can reference 0, 1
]
```

✅ Component 1 can reference Component 0
✅ Component 2 can reference Component 0 and 1
❌ Component 0 CANNOT reference Component 1
❌ Component 1 CANNOT reference Component 2

### Why This Constraint Exists

1. **Predictable creation order** - Components are created in array order (0, 1, 2, ...)
2. **Prevents circular dependencies** - Ensures no circular mount references
3. **Simplifies validation** - Easy to validate references exist at parse time

### Examples

**Valid:**
```javascript
compose: [
  {
    name: "database",
    containerData: "r:/var/lib/db"  // No references
  },
  {
    name: "backup",
    containerData: "/backup|0:/db-data"  // ✅ References component 0
  }
]
```

**Invalid:**
```javascript
compose: [
  {
    name: "backup",
    containerData: "/backup|1:/db-data"  // ❌ Cannot reference component 1 (not yet created)
  },
  {
    name: "database",
    containerData: "r:/var/lib/db"
  }
]
```

**Solution:** Reorder components so dependencies come first:
```javascript
compose: [
  {
    name: "database",
    containerData: "r:/var/lib/db"  // Move to index 0
  },
  {
    name: "backup",
    containerData: "/backup|0:/db-data"  // ✅ Now references valid component 0
  }
]
```

---

## Storage Usage Calculation

### How Disk Usage is Calculated

The system automatically prevents double-counting of nested mounts through intelligent path detection.

### Nested Mount Detection Algorithm

**Location:** `ZelBack/src/services/utils/appUtilities.js` (function: `getContainerStorage()`)

**Process:**
1. Query all container mounts via Docker API
2. Identify nested mount paths (paths inside other paths)
3. Skip nested mounts to avoid double-counting
4. Calculate disk usage only for parent directories using `du -sb`

### Example

**containerData:**
```javascript
"r:/data|m:logs:/var/log|m:cache:/var/cache|f:config.yaml:/etc/app.yaml"
```

**Host paths created:**
```
/apps/fluxcomponent_app/appdata/           ← Primary mount
/apps/fluxcomponent_app/appdata/logs/      ← Nested inside primary
/apps/fluxcomponent_app/appdata/cache/     ← Nested inside primary
/apps/fluxcomponent_app/appdata/config.yaml ← Nested inside primary
```

**Usage calculation:**
```
Mount List from Docker:
  ✓ /apps/fluxcomponent_app/appdata          → COUNTED (50 GB)
  ✗ /apps/fluxcomponent_app/appdata/logs     → SKIPPED (nested, already in parent count)
  ✗ /apps/fluxcomponent_app/appdata/cache    → SKIPPED (nested, already in parent count)
  ✗ /apps/fluxcomponent_app/appdata/config.yaml → SKIPPED (nested, already in parent count)

Total Usage: 50 GB (includes everything in appdata)
```

### Why This Matters

#### For Billing/Resource Allocation
- You pay for **total data used**, not number of mounts
- Multiple mounts don't increase costs
- Actual disk space usage is accurately reported

#### For Storage Limits
- Component storage limit applies to **entire appdata folder**
- Includes all subdirectories and files
- Cannot circumvent limits by creating multiple mounts

### Code Example

**Source:** `ZelBack/src/services/utils/appUtilities.js:197-278`

```javascript
async function getContainerStorage(appName) {
  const containerInfo = await dockerService.dockerContainerInspect(appName, { size: true });
  let bindMountsSize = 0;
  const containerRootFsSize = containerInfo.SizeRootFs || 0;

  if (containerInfo?.Mounts?.length) {
    // Collect all mount sources
    const allMounts = containerInfo.Mounts.filter((m) => m?.Source);
    const mountsToCount = [];

    // For each mount, check if it's a child of another mount
    for (const mount of allMounts) {
      const source = mount.Source;
      const isNested = allMounts.some((otherMount) => {
        if (otherMount === mount) return false; // Skip self
        const otherSource = otherMount.Source;
        // Check if this mount is a child of another mount
        return source.startsWith(otherSource + '/');
      });

      if (!isNested) {
        mountsToCount.push(mount);
      } else {
        log.info(`Skipping nested mount to avoid double-counting: ${source}`);
      }
    }

    // Calculate size for non-nested mounts only
    await Promise.all(mountsToCount.map(async (mount) => {
      const exec = `sudo du -sb ${mount.Source}`;
      const mountInfo = await cmdAsync(exec);
      const sizeNum = parseInt(mountInfo.split('\t')[0]) || 0;
      bindMountsSize += sizeNum;
    }));
  }

  const usedSize = bindMountsSize + containerRootFsSize;
  return { bind: bindMountsSize, rootfs: containerRootFsSize, used: usedSize };
}
```

### Practical Example

**Application Configuration:**
```javascript
{
  name: "myapp",
  containerData: "r:/data|m:logs:/var/log|m:cache:/tmp|f:config:/etc/app.conf",
  hdd: 10  // 10 GB allocated
}
```

**Disk Usage:**
```
/apps/fluxmyapp_app/appdata/
  ├── database/        (8 GB)
  ├── uploads/         (1 GB)
  ├── logs/           (500 MB)
  ├── cache/          (200 MB)
  └── config          (1 MB)

Total: 9.7 GB (within 10 GB limit) ✅
```

**Reported Metrics:**
- Single `du -sb` command on `/apps/fluxmyapp_app/appdata`
- Returns: 9.7 GB
- Nested mounts not double-counted
- Accurate total for billing and limits

---

## Summary

### Key Points

1. **All paths are relative to component's appdata directory on the host**
2. **File mounts create empty files** - applications must initialize them
3. **Components can only reference earlier components** (lower indices)
4. **Syncthing flags replicate the entire appdata folder**
5. **Usage metrics automatically prevent double-counting** through nested mount detection

### Function Workflow

```
containerData string
       ↓
parseContainerData()  ← Parse syntax, validate
       ↓
   parsedMounts
       ├→ getRequiredLocalPaths()  ← Extract local paths to create
       └→ constructVolumes()        ← Build Docker Mount objects
              ↓
        Docker Mounts  ← Ready for container creation
```

### Best Practices

1. **Order components logically** - dependencies should come first
2. **Use file mounts for configuration** that needs to persist
3. **Use directory mounts for organized data** (logs, cache, uploads)
4. **Use component references sparingly** - only when data sharing is necessary
5. **Initialize file mounts** in application startup code
6. **Document mount strategy** in application specifications

---

**Document Version:** 1.0
**Feature Branch:** feature/multiplemounts
**Last Updated:** 2025-11-04
