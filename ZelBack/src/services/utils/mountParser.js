/**
 * Mount Parser Module
 *
 * Parses enhanced containerData syntax to support:
 * - Multiple independent mounts per component
 * - File mounts (not just directories)
 * - Cross-component volume sharing
 * - Backward compatibility with existing syntax
 *
 * Syntax:
 * - Primary: [flags]:<path>  (e.g., r:/data, g:/primary, /config)
 * - Component ref: <number>:<path>  (e.g., 0:/shared)
 * - Directory mount: m:<subdir>:<path>  (e.g., m:logs:/var/log)
 * - File mount: f:<filename>:<path>  (e.g., f:config.yaml:/etc/config.yaml)
 * - Component dir: c:<number>:<subdir>:<path>  (e.g., c:0:backups:/backups)
 * - Component file: cf:<number>:<filename>:<path>  (e.g., cf:0:cert.pem:/etc/ssl/cert.pem)
 */

const log = require('../../lib/log');

/**
 * Mount type enumeration
 */
const MountType = {
  PRIMARY: 'primary',
  DIRECTORY: 'directory',
  FILE: 'file',
  COMPONENT_PRIMARY: 'component_primary',
  COMPONENT_DIRECTORY: 'component_directory',
  COMPONENT_FILE: 'component_file',
};

/**
 * Parse mount flags from the first segment
 * @param {string} segment - First part before colon
 * @returns {object} - { flags: string[], hasFlags: boolean }
 */
function parseMountFlags(segment) {
  const knownFlags = ['r', 'g', 's'];
  const flags = [];
  let hasFlags = false;

  for (const flag of knownFlags) {
    if (segment.includes(flag)) {
      flags.push(flag);
      hasFlags = true;
    }
  }

  return { flags, hasFlags };
}

/**
 * Validate mount path to prevent security issues
 * @param {string} path - Path to validate
 * @throws {Error} If path contains invalid characters
 */
function validateMountPath(path) {
  if (!path || typeof path !== 'string') {
    throw new Error('Mount path must be a non-empty string');
  }

  // Prevent directory traversal
  if (path.includes('..')) {
    throw new Error('Mount path cannot contain ".." (directory traversal)');
  }

  // Must be absolute path
  if (!path.startsWith('/')) {
    throw new Error('Mount path must be absolute (start with /)');
  }

  // Check for null bytes
  if (path.includes('\0')) {
    throw new Error('Mount path cannot contain null bytes');
  }
}

/**
 * Validate subdirectory/filename
 * @param {string} name - Subdirectory or filename
 * @throws {Error} If name is invalid
 */
function validateSubdirOrFilename(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Subdirectory/filename must be a non-empty string');
  }

  // Prevent directory traversal
  if (name.includes('/') || name.includes('..')) {
    throw new Error('Subdirectory/filename cannot contain "/" or ".."');
  }

  // Reserved names
  const reserved = ['appdata', '.', '..'];
  if (reserved.includes(name)) {
    throw new Error(`Subdirectory/filename cannot be a reserved name: ${reserved.join(', ')}`);
  }

  // Check for special characters that might cause issues
  const invalidChars = /[<>:"|?*\0]/;
  if (invalidChars.test(name)) {
    throw new Error('Subdirectory/filename contains invalid characters');
  }

  // Max length
  if (name.length > 255) {
    throw new Error('Subdirectory/filename too long (max 255 characters)');
  }
}

/**
 * Parse a single mount definition
 * @param {string} mountDef - Single mount definition from pipe-separated list
 * @param {number} index - Index in the mount list (0 = primary)
 * @returns {object} Parsed mount object
 */
function parseMountDefinition(mountDef, index) {
  if (!mountDef || typeof mountDef !== 'string') {
    throw new Error(`Invalid mount definition at index ${index}`);
  }

  const parts = mountDef.split(':');

  // Primary mount (first in list)
  if (index === 0) {
    const { flags, hasFlags } = parseMountFlags(parts[0]);

    let containerPath;
    if (hasFlags) {
      // Format: [flags]:<path>  (e.g., r:/data)
      if (parts.length !== 2) {
        throw new Error(`Invalid primary mount syntax: ${mountDef}`);
      }
      containerPath = parts[1];
    } else {
      // Format: <path>  (e.g., /data)
      if (parts.length === 1) {
        containerPath = parts[0];
      } else {
        throw new Error(`Invalid primary mount syntax: ${mountDef}`);
      }
    }

    validateMountPath(containerPath);

    return {
      type: MountType.PRIMARY,
      subdir: 'appdata', // Primary always uses appdata
      containerPath,
      flags,
      isFile: false,
    };
  }

  // Additional mounts
  const firstPart = parts[0];

  // Backward compatible: Component reference (e.g., 0:/shared, 1:/backup)
  if (/^\d+$/.test(firstPart)) {
    if (parts.length !== 2) {
      throw new Error(`Invalid component reference syntax: ${mountDef}`);
    }

    const componentIndex = parseInt(firstPart, 10);
    const containerPath = parts[1];

    validateMountPath(containerPath);

    return {
      type: MountType.COMPONENT_PRIMARY,
      componentIndex,
      subdir: 'appdata', // Component primary always uses appdata
      containerPath,
      flags: [],
      isFile: false,
    };
  }

  // New syntax: m:<subdir>:<path>
  if (firstPart === 'm') {
    if (parts.length !== 3) {
      throw new Error(`Invalid directory mount syntax: ${mountDef}. Expected m:<subdir>:<path>`);
    }

    const subdir = parts[1];
    const containerPath = parts[2];

    validateSubdirOrFilename(subdir);
    validateMountPath(containerPath);

    return {
      type: MountType.DIRECTORY,
      subdir,
      containerPath,
      flags: [],
      isFile: false,
    };
  }

  // New syntax: f:<filename>:<path>
  if (firstPart === 'f') {
    if (parts.length !== 3) {
      throw new Error(`Invalid file mount syntax: ${mountDef}. Expected f:<filename>:<path>`);
    }

    const filename = parts[1];
    const containerPath = parts[2];

    validateSubdirOrFilename(filename);
    validateMountPath(containerPath);

    return {
      type: MountType.FILE,
      subdir: filename, // Store filename in subdir field for consistency
      containerPath,
      flags: [],
      isFile: true,
    };
  }

  // New syntax: c:<number>:<subdir>:<path>
  if (firstPart === 'c') {
    if (parts.length !== 4) {
      throw new Error(`Invalid component directory mount syntax: ${mountDef}. Expected c:<number>:<subdir>:<path>`);
    }

    const componentIndex = parseInt(parts[1], 10);
    if (Number.isNaN(componentIndex)) {
      throw new Error(`Invalid component index in: ${mountDef}`);
    }

    const subdir = parts[2];
    const containerPath = parts[3];

    validateSubdirOrFilename(subdir);
    validateMountPath(containerPath);

    return {
      type: MountType.COMPONENT_DIRECTORY,
      componentIndex,
      subdir,
      containerPath,
      flags: [],
      isFile: false,
    };
  }

  // New syntax: cf:<number>:<filename>:<path>
  if (firstPart === 'cf') {
    if (parts.length !== 4) {
      throw new Error(`Invalid component file mount syntax: ${mountDef}. Expected cf:<number>:<filename>:<path>`);
    }

    const componentIndex = parseInt(parts[1], 10);
    if (Number.isNaN(componentIndex)) {
      throw new Error(`Invalid component index in: ${mountDef}`);
    }

    const filename = parts[2];
    const containerPath = parts[3];

    validateSubdirOrFilename(filename);
    validateMountPath(containerPath);

    return {
      type: MountType.COMPONENT_FILE,
      componentIndex,
      subdir: filename, // Store filename in subdir field for consistency
      containerPath,
      flags: [],
      isFile: true,
    };
  }

  throw new Error(`Unknown mount syntax at index ${index}: ${mountDef}`);
}

/**
 * Parse complete containerData string into structured mount definitions.
 *
 * This function handles the enhanced mount syntax that supports multiple mount types
 * per component. All paths are relative to the component's appdata directory on the
 * host filesystem (/apps/fluxCOMPONENT_APPNAME/appdata/).
 *
 * @param {string} containerData - Pipe-separated mount definitions
 * @returns {object} - { primary, additional: [], allMounts: [] }
 *
 * @example
 * // ═══════════════════════════════════════════════════════════════════
 * // BASIC EXAMPLES - Understanding Directory Origins
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Example 1: Simple primary mount
 * // containerData: "/data"
 * // Host source: /apps/fluxCOMPONENT_APPNAME/appdata/
 * // Container target: /data
 * parseContainerData("/data");
 *
 * // Example 2: Primary mount with Syncthing replication
 * // containerData: "r:/data"
 * // Host source: /apps/fluxCOMPONENT_APPNAME/appdata/ (replicated)
 * // Container target: /data
 * parseContainerData("r:/data");
 *
 * // Example 3: Primary mount with standby mode
 * // containerData: "g:/data"
 * // Host source: /apps/fluxCOMPONENT_APPNAME/appdata/ (standby mode)
 * // Container target: /data
 * parseContainerData("g:/data");
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // DIRECTORY MOUNTS - Additional Storage Organization
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Example 4: Primary + additional directory mount
 * // containerData: "/data|m:logs:/var/log"
 * // Host sources:
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data (primary)
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/logs/ -> /var/log (additional)
 * // Directory 'logs/' is created INSIDE appdata/
 * parseContainerData("/data|m:logs:/var/log");
 *
 * // Example 5: Multiple directory mounts
 * // containerData: "r:/data|m:logs:/var/log|m:cache:/tmp/cache"
 * // Host sources (all under appdata/):
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data (replicated)
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/logs/ -> /var/log
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/cache/ -> /tmp/cache
 * parseContainerData("r:/data|m:logs:/var/log|m:cache:/tmp/cache");
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // FILE MOUNTS - Persistent Configuration Files
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Example 6: Single file mount
 * // containerData: "/data|f:config.yaml:/etc/app/config.yaml"
 * // Host sources:
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/config.yaml -> /etc/app/config.yaml
 * // File config.yaml is created as EMPTY file inside appdata/
 * // Application must initialize it on first run
 * parseContainerData("/data|f:config.yaml:/etc/app/config.yaml");
 *
 * // Example 7: Multiple file mounts (SSL certificates)
 * // containerData: "/data|f:cert.pem:/etc/ssl/cert.pem|f:key.pem:/etc/ssl/key.pem"
 * // Host sources (all EMPTY files created inside appdata/):
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/cert.pem -> /etc/ssl/cert.pem
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/key.pem -> /etc/ssl/key.pem
 * parseContainerData("/data|f:cert.pem:/etc/ssl/cert.pem|f:key.pem:/etc/ssl/key.pem");
 *
 * // Example 8: Mixed mounts - directories and files
 * // containerData: "r:/data|m:logs:/var/log|f:app.conf:/etc/app.conf"
 * // Host sources:
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/ -> /data (replicated)
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/logs/ -> /var/log
 * //   - /apps/fluxCOMPONENT_APPNAME/appdata/app.conf -> /etc/app.conf
 * parseContainerData("r:/data|m:logs:/var/log|f:app.conf:/etc/app.conf");
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // COMPONENT REFERENCES - Sharing Data Between Components
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Example 9: Component primary mount (entire appdata from another component)
 * // Component 0: { name: "database", containerData: "r:/var/lib/db" }
 * //   Creates: /apps/fluxdatabase_APPNAME/appdata/
 * // Component 1: { name: "backup", containerData: "/backup|0:/db-data" }
 * //   Mounts Component 0's entire appdata:
 * //   - /apps/fluxdatabase_APPNAME/appdata/ -> /db-data
 * // Can read/write Component 0's database files
 * parseContainerData("/backup|0:/db-data");
 *
 * // Example 10: Component directory mount (specific subdirectory from another component)
 * // Component 0: { name: "web", containerData: "/data|m:logs:/var/log" }
 * //   Creates: /apps/fluxweb_APPNAME/appdata/logs/
 * // Component 1: { name: "analyzer", containerData: "/app|c:0:logs:/app/logs" }
 * //   Mounts Component 0's logs subdirectory:
 * //   - /apps/fluxweb_APPNAME/appdata/logs/ -> /app/logs
 * parseContainerData("/app|c:0:logs:/app/logs");
 *
 * // Example 11: Component file mount (specific file from another component)
 * // Component 0: { name: "config", containerData: "/data|f:shared.conf:/etc/shared.conf" }
 * //   Creates: /apps/fluxconfig_APPNAME/appdata/shared.conf
 * // Component 1: { name: "worker", containerData: "/app|cf:0:shared.conf:/etc/app.conf" }
 * //   Mounts Component 0's shared.conf file:
 * //   - /apps/fluxconfig_APPNAME/appdata/shared.conf -> /etc/app.conf
 * parseContainerData("/app|cf:0:shared.conf:/etc/app.conf");
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // ADVANCED SCENARIOS - Real-World Use Cases
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Example 12: Web server with organized storage
 * // containerData: "r:/usr/share/nginx/html|m:logs:/var/log/nginx|m:cache:/var/cache/nginx|f:nginx.conf:/etc/nginx/nginx.conf"
 * // File system structure on host:
 * //   /apps/fluxnginx_APPNAME/appdata/
 * //     ├── (website files)           -> /usr/share/nginx/html (replicated)
 * //     ├── logs/                     -> /var/log/nginx
 * //     ├── cache/                    -> /var/cache/nginx
 * //     └── nginx.conf                -> /etc/nginx/nginx.conf (empty, app initializes)
 * parseContainerData("r:/usr/share/nginx/html|m:logs:/var/log/nginx|m:cache:/var/cache/nginx|f:nginx.conf:/etc/nginx/nginx.conf");
 *
 * // Example 13: Database with backup component
 * // Component 0: { name: "postgres", containerData: "r:/var/lib/postgresql/data|f:postgresql.conf:/etc/postgresql.conf" }
 * //   Creates:
 * //     /apps/fluxpostgres_APPNAME/appdata/
 * //     /apps/fluxpostgres_APPNAME/appdata/postgresql.conf
 * // Component 1: { name: "pgbackup", containerData: "/backup|0:/database|m:archives:/var/backups" }
 * //   Mounts:
 * //     /apps/fluxpostgres_APPNAME/appdata/ -> /database (can read DB files)
 * //     /apps/fluxpgbackup_APPNAME/appdata/archives/ -> /var/backups (stores backups)
 * parseContainerData("/backup|0:/database|m:archives:/var/backups");
 *
 * // Example 14: Microservices with shared SSL certificates
 * // Component 0: { name: "certs", containerData: "/certs|f:ssl-cert.pem:/cert.pem|f:ssl-key.pem:/key.pem" }
 * //   Creates:
 * //     /apps/fluxcerts_APPNAME/appdata/ssl-cert.pem (empty)
 * //     /apps/fluxcerts_APPNAME/appdata/ssl-key.pem (empty)
 * // Component 1: { name: "api", containerData: "/app|cf:0:ssl-cert.pem:/etc/ssl/cert.pem|cf:0:ssl-key.pem:/etc/ssl/key.pem" }
 * //   Mounts Component 0's certificate files:
 * //     /apps/fluxcerts_APPNAME/appdata/ssl-cert.pem -> /etc/ssl/cert.pem
 * //     /apps/fluxcerts_APPNAME/appdata/ssl-key.pem -> /etc/ssl/key.pem
 * // Component 2: { name: "web", containerData: "r:/www|cf:0:ssl-cert.pem:/etc/ssl/cert.pem|cf:0:ssl-key.pem:/etc/ssl/key.pem" }
 * //   All services share the same SSL certificates from Component 0
 * parseContainerData("r:/www|cf:0:ssl-cert.pem:/etc/ssl/cert.pem|cf:0:ssl-key.pem:/etc/ssl/key.pem");
 *
 * // Example 15: Log aggregation system
 * // Component 0: { name: "app1", containerData: "/data|m:logs:/var/log/app" }
 * //   Creates: /apps/fluxapp1_APPNAME/appdata/logs/
 * // Component 1: { name: "app2", containerData: "/data|m:logs:/var/log/app" }
 * //   Creates: /apps/fluxapp2_APPNAME/appdata/logs/
 * // Component 2: { name: "logcollector", containerData: "/collector|c:0:logs:/logs/app1|c:1:logs:/logs/app2" }
 * //   Aggregates logs from multiple components:
 * //     /apps/fluxapp1_APPNAME/appdata/logs/ -> /logs/app1
 * //     /apps/fluxapp2_APPNAME/appdata/logs/ -> /logs/app2
 * parseContainerData("/collector|c:0:logs:/logs/app1|c:1:logs:/logs/app2");
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // IMPORTANT NOTES
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // 1. PATH ORIGINS:
 * //    - All paths are relative to /apps/fluxCOMPONENT_APPNAME/appdata/ on the HOST
 * //    - Additional mounts (m:, f:) create subdirs/files INSIDE appdata/
 * //    - Component refs (0:, c:, cf:) point to OTHER components' appdata/
 *
 * // 2. FILE MOUNTS:
 * //    - Files are created EMPTY
 * //    - Application must initialize them on first run
 * //    - Check file size to detect first run: if (size === 0) { initialize(); }
 *
 * // 3. SYNCTHING FLAGS:
 * //    - Flags (r:, g:, s:) apply to ENTIRE appdata folder
 * //    - All subdirectories and files are included in replication
 *
 * // 4. COMPONENT ORDERING:
 * //    - Components can ONLY reference lower indices
 * //    - Component 1 can reference Component 0
 * //    - Component 0 CANNOT reference Component 1
 *
 * // 5. STORAGE USAGE:
 * //    - Usage is calculated ONCE for entire appdata/
 * //    - Nested mounts are NOT double-counted
 * //    - Total usage includes all subdirectories and files
 */
function parseContainerData(containerData) {
  if (!containerData || typeof containerData !== 'string') {
    throw new Error('containerData must be a non-empty string');
  }

  const mountDefs = containerData.split('|');
  const parsedMounts = [];

  for (let i = 0; i < mountDefs.length; i += 1) {
    try {
      const parsed = parseMountDefinition(mountDefs[i], i);
      parsedMounts.push(parsed);
    } catch (error) {
      log.error(`Error parsing mount at index ${i}: ${mountDefs[i]}`);
      throw error;
    }
  }

  // Validate no duplicate container paths
  const containerPaths = parsedMounts.map((m) => m.containerPath);
  const duplicates = containerPaths.filter((path, index) => containerPaths.indexOf(path) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate container paths found: ${duplicates.join(', ')}`);
  }

  // Validate no duplicate subdirs/filenames (for non-component mounts)
  const localSubdirs = parsedMounts
    .filter((m) => m.type === MountType.PRIMARY || m.type === MountType.DIRECTORY || m.type === MountType.FILE)
    .map((m) => m.subdir);
  const duplicateSubdirs = localSubdirs.filter((subdir, index) => localSubdirs.indexOf(subdir) !== index);
  if (duplicateSubdirs.length > 0) {
    throw new Error(`Duplicate subdirectory/filename found: ${duplicateSubdirs.join(', ')}`);
  }

  return {
    primary: parsedMounts[0],
    additional: parsedMounts.slice(1),
    allMounts: parsedMounts,
  };
}

/**
 * Get all subdirectories/files that need to be created for this component.
 * Returns only LOCAL mounts (not component references) that need to be created
 * under the component's appdata directory on the host filesystem.
 *
 * @param {object} parsedMounts - Result from parseContainerData
 * @returns {Array<{name: string, isFile: boolean}>} Array of paths to create
 *
 * @example
 * // Example 1: Primary mount only
 * const parsed1 = parseContainerData("/data");
 * const paths1 = getRequiredLocalPaths(parsed1);
 * // Returns: [{ name: 'appdata', isFile: false }]
 * // Will create: /apps/fluxCOMPONENT_APPNAME/appdata/
 *
 * @example
 * // Example 2: Primary + directory mounts
 * const parsed2 = parseContainerData("/data|m:logs:/var/log|m:cache:/tmp");
 * const paths2 = getRequiredLocalPaths(parsed2);
 * // Returns: [
 * //   { name: 'appdata', isFile: false },
 * //   { name: 'logs', isFile: false },
 * //   { name: 'cache', isFile: false }
 * // ]
 * // Will create:
 * //   /apps/fluxCOMPONENT_APPNAME/appdata/
 * //   /apps/fluxCOMPONENT_APPNAME/appdata/logs/
 * //   /apps/fluxCOMPONENT_APPNAME/appdata/cache/
 *
 * @example
 * // Example 3: Primary + file mounts
 * const parsed3 = parseContainerData("/data|f:config.yaml:/etc/app.yaml|f:cert.pem:/ssl/cert.pem");
 * const paths3 = getRequiredLocalPaths(parsed3);
 * // Returns: [
 * //   { name: 'appdata', isFile: false },
 * //   { name: 'config.yaml', isFile: true },
 * //   { name: 'cert.pem', isFile: true }
 * // ]
 * // Will create:
 * //   /apps/fluxCOMPONENT_APPNAME/appdata/
 * //   /apps/fluxCOMPONENT_APPNAME/appdata/config.yaml (empty file)
 * //   /apps/fluxCOMPONENT_APPNAME/appdata/cert.pem (empty file)
 *
 * @example
 * // Example 4: Mixed local mounts (directories and files)
 * const parsed4 = parseContainerData("r:/data|m:logs:/var/log|f:app.conf:/etc/app.conf|m:uploads:/uploads");
 * const paths4 = getRequiredLocalPaths(parsed4);
 * // Returns: [
 * //   { name: 'appdata', isFile: false },
 * //   { name: 'logs', isFile: false },
 * //   { name: 'app.conf', isFile: true },
 * //   { name: 'uploads', isFile: false }
 * // ]
 *
 * @example
 * // Example 5: Component references are EXCLUDED
 * const parsed5 = parseContainerData("/app|0:/database|c:0:logs:/logs|cf:0:config:/cfg");
 * const paths5 = getRequiredLocalPaths(parsed5);
 * // Returns: [{ name: 'appdata', isFile: false }]
 * // Only creates local appdata, NOT the referenced component's paths
 * // Component references (0:, c:0:, cf:0:) point to OTHER components
 *
 * @example
 * // Example 6: Web server with organized storage
 * const parsed6 = parseContainerData("r:/www|m:logs:/var/log/nginx|m:cache:/var/cache|f:nginx.conf:/etc/nginx/nginx.conf");
 * const paths6 = getRequiredLocalPaths(parsed6);
 * // Returns: [
 * //   { name: 'appdata', isFile: false },  → /apps/fluxweb_app/appdata/
 * //   { name: 'logs', isFile: false },     → /apps/fluxweb_app/appdata/logs/
 * //   { name: 'cache', isFile: false },    → /apps/fluxweb_app/appdata/cache/
 * //   { name: 'nginx.conf', isFile: true } → /apps/fluxweb_app/appdata/nginx.conf (empty)
 * // ]
 *
 * @example
 * // Example 7: Database with config files
 * const parsed7 = parseContainerData("r:/var/lib/db|f:db.conf:/etc/db.conf|f:users.txt:/etc/users.txt");
 * const paths7 = getRequiredLocalPaths(parsed7);
 * // Returns: [
 * //   { name: 'appdata', isFile: false },
 * //   { name: 'db.conf', isFile: true },
 * //   { name: 'users.txt', isFile: true }
 * // ]
 * // Files created empty - database initializes them on first run
 */
function getRequiredLocalPaths(parsedMounts) {
  const paths = [];

  for (const mount of parsedMounts.allMounts) {
    // Only include local mounts (not component references)
    if (mount.type === MountType.PRIMARY || mount.type === MountType.DIRECTORY || mount.type === MountType.FILE) {
      paths.push({
        name: mount.subdir,
        isFile: mount.isFile,
      });
    }
  }

  return paths;
}

/**
 * Get all flags from primary mount
 * @param {object} parsedMounts - Result from parseContainerData
 * @returns {string[]} Array of flags
 */
function getPrimaryFlags(parsedMounts) {
  return parsedMounts.primary.flags || [];
}

/**
 * Check if containerData has specific flag
 * @param {string} containerData - Original containerData string
 * @param {string} flag - Flag to check (r, g, s)
 * @returns {boolean}
 */
function hasFlag(containerData, flag) {
  const firstSegment = containerData.split('|')[0].split(':')[0];
  return firstSegment.includes(flag);
}

module.exports = {
  MountType,
  parseContainerData,
  parseMountDefinition,
  getRequiredLocalPaths,
  getPrimaryFlags,
  hasFlag,
  validateMountPath,
  validateSubdirOrFilename,
};
