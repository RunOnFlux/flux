/**
 * Volume Constructor Module
 *
 * Constructs Docker bind mount specifications from parsed mount definitions.
 * Handles component references, validation, and backward compatibility.
 */

const log = require('../../lib/log');
const { MountType } = require('./mountParser');
const { appsFolder } = require('./appConstants');

/**
 * Get app identifier with proper flux prefix
 * Uses lazy require to avoid circular dependency
 * @param {string} identifier - App/component identifier
 * @returns {string} App identifier with flux prefix
 */
function getAppIdentifier(identifier) {
  const dockerService = require('../dockerService');
  return dockerService.getAppIdentifier(identifier);
}

/**
 * Construct host path for a local mount (current component)
 * All paths are under appdata/
 * @param {string} identifier - App/component identifier
 * @param {string} subdir - Subdirectory or filename (or 'appdata' for primary)
 * @returns {string} Full host path
 */
function constructLocalHostPath(identifier, subdir) {
  const appId = getAppIdentifier(identifier);
  // Primary mount uses appdata directly
  if (subdir === 'appdata') {
    return `${appsFolder}${appId}/appdata`;
  }
  // All other mounts are under appdata/
  return `${appsFolder}${appId}/appdata/${subdir}`;
}

/**
 * Construct host path for a component mount (another component)
 * All paths are under appdata/
 * @param {string} componentIdentifier - Other component's identifier
 * @param {string} subdir - Subdirectory or filename (or 'appdata' for primary)
 * @returns {string} Full host path
 */
function constructComponentHostPath(componentIdentifier, subdir) {
  const appId = getAppIdentifier(componentIdentifier);
  // Primary mount uses appdata directly
  if (subdir === 'appdata') {
    return `${appsFolder}${appId}/appdata`;
  }
  // All other mounts are under appdata/
  return `${appsFolder}${appId}/appdata/${subdir}`;
}

/**
 * Validate component index and get component identifier
 * @param {number} componentIndex - Component index to reference
 * @param {number} currentIndex - Current component's index
 * @param {object} fullAppSpecs - Full application specifications
 * @param {string} appName - Application name
 * @returns {string} Component identifier
 * @throws {Error} If validation fails
 */
function validateAndGetComponentIdentifier(componentIndex, currentIndex, fullAppSpecs, appName) {
  // Validate component index exists
  if (fullAppSpecs.version >= 4) {
    if (componentIndex < 0 || componentIndex >= fullAppSpecs.compose.length) {
      throw new Error(`Invalid component index: ${componentIndex}. Valid range: 0-${fullAppSpecs.compose.length - 1}`);
    }

    // Enforce ordering: can only reference previous components
    if (currentIndex !== undefined && currentIndex <= componentIndex) {
      throw new Error(
        `Component ${currentIndex} cannot reference component ${componentIndex}. ` +
        'Components can only reference components with lower indices.'
      );
    }

    const componentName = fullAppSpecs.compose[componentIndex].name;
    return `${componentName}_${appName}`;
  }

  // For non-compose apps (version < 4), only component 0 (self) is valid
  if (componentIndex !== 0) {
    throw new Error('Non-compose apps can only reference component 0 (self)');
  }

  return appName;
}

/**
 * Construct Docker bind mounts from parsed mount definitions.
 *
 * This function takes parsed mount definitions and constructs the actual Docker bind
 * mount specifications with full host paths. It handles all mount types including
 * component references and validates ordering constraints.
 *
 * @param {object} parsedMounts - Parsed mount data from mountParser
 * @param {string} identifier - Current component identifier (e.g., "component_appname")
 * @param {string} appName - Application name
 * @param {object} fullAppSpecs - Full application specifications (required for component refs)
 * @param {object} appSpecifications - Current component specifications
 * @param {boolean} useModernMounts - If true, return Mount objects instead of Binds strings (default: true)
 * @returns {Array<Object|string>} Array of Docker Mount objects or bind mount strings
 *
 * @example
 * // ═══════════════════════════════════════════════════════════════════
 * // BASIC VOLUME CONSTRUCTION
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Example 1: Simple primary mount
 * const parsed1 = parseContainerData("/data");
 * const volumes1 = constructVolumes(parsed1, "myapp", "myapp", null, null);
 * // Result: [{ Type: 'bind', Source: '/apps/fluxmyapp/appdata', Target: '/data', ... }]
 *
 * // Example 2: Primary + directory mount
 * const parsed2 = parseContainerData("/data|m:logs:/var/log");
 * const volumes2 = constructVolumes(parsed2, "web_myapp", "myapp", null, null);
 * // Result: [
 * //   { Source: '/apps/fluxweb_myapp/appdata', Target: '/data' },
 * //   { Source: '/apps/fluxweb_myapp/appdata/logs', Target: '/var/log' }
 * // ]
 *
 * // Example 3: Primary + file mount
 * const parsed3 = parseContainerData("/data|f:config.yaml:/etc/app.yaml");
 * const volumes3 = constructVolumes(parsed3, "api_myapp", "myapp", null, null);
 * // Result: [
 * //   { Source: '/apps/fluxapi_myapp/appdata', Target: '/data' },
 * //   { Source: '/apps/fluxapi_myapp/appdata/config.yaml', Target: '/etc/app.yaml' }
 * // ]
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // COMPONENT REFERENCES
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Example 4: Component primary reference
 * const fullSpecs4 = {
 *   version: 8,
 *   name: "myapp",
 *   compose: [
 *     { name: "database", containerData: "r:/var/lib/db" },
 *     { name: "backup", containerData: "/backup|0:/db-data" }
 *   ]
 * };
 * const parsed4 = parseContainerData("/backup|0:/db-data");
 * const volumes4 = constructVolumes(parsed4, "backup_myapp", "myapp", fullSpecs4, fullSpecs4.compose[1]);
 * // Result: [
 * //   { Source: '/apps/fluxbackup_myapp/appdata', Target: '/backup' },
 * //   { Source: '/apps/fluxdatabase_myapp/appdata', Target: '/db-data' }  ← Component 0's appdata
 * // ]
 *
 * // Example 5: Component directory reference
 * const fullSpecs5 = {
 *   version: 8,
 *   name: "logsys",
 *   compose: [
 *     { name: "app", containerData: "/data|m:logs:/var/log" },
 *     { name: "analyzer", containerData: "/analyzer|c:0:logs:/app/logs" }
 *   ]
 * };
 * const parsed5 = parseContainerData("/analyzer|c:0:logs:/app/logs");
 * const volumes5 = constructVolumes(parsed5, "analyzer_logsys", "logsys", fullSpecs5, fullSpecs5.compose[1]);
 * // Result: [
 * //   { Source: '/apps/fluxanalyzer_logsys/appdata', Target: '/analyzer' },
 * //   { Source: '/apps/fluxapp_logsys/appdata/logs', Target: '/app/logs' }  ← Component 0's logs dir
 * // ]
 *
 * // Example 6: Component file reference
 * const fullSpecs6 = {
 *   version: 8,
 *   name: "certapp",
 *   compose: [
 *     { name: "certs", containerData: "/certs|f:ssl.pem:/cert.pem" },
 *     { name: "web", containerData: "r:/www|cf:0:ssl.pem:/etc/ssl/cert.pem" }
 *   ]
 * };
 * const parsed6 = parseContainerData("r:/www|cf:0:ssl.pem:/etc/ssl/cert.pem");
 * const volumes6 = constructVolumes(parsed6, "web_certapp", "certapp", fullSpecs6, fullSpecs6.compose[1]);
 * // Result: [
 * //   { Source: '/apps/fluxweb_certapp/appdata', Target: '/www' },
 * //   { Source: '/apps/fluxcerts_certapp/appdata/ssl.pem', Target: '/etc/ssl/cert.pem' }  ← Component 0's file
 * // ]
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // ADVANCED REAL-WORLD SCENARIOS
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Example 7: Complete web application with nginx + app + database
 * const fullSpecs7 = {
 *   version: 8,
 *   name: "webapp",
 *   compose: [
 *     {
 *       name: "database",
 *       containerData: "r:/var/lib/postgresql/data|f:postgresql.conf:/etc/postgresql.conf"
 *     },
 *     {
 *       name: "app",
 *       containerData: "/app|0:/database|m:uploads:/app/uploads|f:app.conf:/etc/app.conf"
 *     },
 *     {
 *       name: "nginx",
 *       containerData: "r:/usr/share/nginx/html|c:1:uploads:/www/uploads|m:logs:/var/log/nginx|f:nginx.conf:/etc/nginx/nginx.conf"
 *     }
 *   ]
 * };
 *
 * // Component 0 (database) volumes:
 * const parsed7a = parseContainerData("r:/var/lib/postgresql/data|f:postgresql.conf:/etc/postgresql.conf");
 * const volumes7a = constructVolumes(parsed7a, "database_webapp", "webapp", fullSpecs7, fullSpecs7.compose[0]);
 * // Result: [
 * //   { Source: '/apps/fluxdatabase_webapp/appdata', Target: '/var/lib/postgresql/data' },
 * //   { Source: '/apps/fluxdatabase_webapp/appdata/postgresql.conf', Target: '/etc/postgresql.conf' }
 * // ]
 *
 * // Component 1 (app) volumes:
 * const parsed7b = parseContainerData("/app|0:/database|m:uploads:/app/uploads|f:app.conf:/etc/app.conf");
 * const volumes7b = constructVolumes(parsed7b, "app_webapp", "webapp", fullSpecs7, fullSpecs7.compose[1]);
 * // Result: [
 * //   { Source: '/apps/fluxapp_webapp/appdata', Target: '/app' },
 * //   { Source: '/apps/fluxdatabase_webapp/appdata', Target: '/database' },              ← DB access
 * //   { Source: '/apps/fluxapp_webapp/appdata/uploads', Target: '/app/uploads' },
 * //   { Source: '/apps/fluxapp_webapp/appdata/app.conf', Target: '/etc/app.conf' }
 * // ]
 *
 * // Component 2 (nginx) volumes:
 * const parsed7c = parseContainerData("r:/usr/share/nginx/html|c:1:uploads:/www/uploads|m:logs:/var/log/nginx|f:nginx.conf:/etc/nginx/nginx.conf");
 * const volumes7c = constructVolumes(parsed7c, "nginx_webapp", "webapp", fullSpecs7, fullSpecs7.compose[2]);
 * // Result: [
 * //   { Source: '/apps/fluxnginx_webapp/appdata', Target: '/usr/share/nginx/html' },
 * //   { Source: '/apps/fluxapp_webapp/appdata/uploads', Target: '/www/uploads' },       ← Serve app uploads
 * //   { Source: '/apps/fluxnginx_webapp/appdata/logs', Target: '/var/log/nginx' },
 * //   { Source: '/apps/fluxnginx_webapp/appdata/nginx.conf', Target: '/etc/nginx/nginx.conf' }
 * // ]
 *
 * // Example 8: Microservices with shared configuration
 * const fullSpecs8 = {
 *   version: 8,
 *   name: "microservices",
 *   compose: [
 *     {
 *       name: "config",
 *       containerData: "/config|f:shared.json:/config.json|f:cert.pem:/cert.pem|f:key.pem:/key.pem"
 *     },
 *     {
 *       name: "service1",
 *       containerData: "/app|cf:0:shared.json:/etc/config.json|cf:0:cert.pem:/etc/ssl/cert.pem|cf:0:key.pem:/etc/ssl/key.pem"
 *     },
 *     {
 *       name: "service2",
 *       containerData: "/app|cf:0:shared.json:/etc/config.json|cf:0:cert.pem:/etc/ssl/cert.pem|cf:0:key.pem:/etc/ssl/key.pem"
 *     }
 *   ]
 * };
 *
 * // Component 0 (config) - stores all shared files
 * const parsed8a = parseContainerData("/config|f:shared.json:/config.json|f:cert.pem:/cert.pem|f:key.pem:/key.pem");
 * const volumes8a = constructVolumes(parsed8a, "config_microservices", "microservices", fullSpecs8, fullSpecs8.compose[0]);
 * // Result: [
 * //   { Source: '/apps/fluxconfig_microservices/appdata', Target: '/config' },
 * //   { Source: '/apps/fluxconfig_microservices/appdata/shared.json', Target: '/config.json' },
 * //   { Source: '/apps/fluxconfig_microservices/appdata/cert.pem', Target: '/cert.pem' },
 * //   { Source: '/apps/fluxconfig_microservices/appdata/key.pem', Target: '/key.pem' }
 * // ]
 *
 * // Component 1 & 2 (services) - all read from Component 0's files
 * const parsed8b = parseContainerData("/app|cf:0:shared.json:/etc/config.json|cf:0:cert.pem:/etc/ssl/cert.pem|cf:0:key.pem:/etc/ssl/key.pem");
 * const volumes8b = constructVolumes(parsed8b, "service1_microservices", "microservices", fullSpecs8, fullSpecs8.compose[1]);
 * // Result: [
 * //   { Source: '/apps/fluxservice1_microservices/appdata', Target: '/app' },
 * //   { Source: '/apps/fluxconfig_microservices/appdata/shared.json', Target: '/etc/config.json' },  ← Shared
 * //   { Source: '/apps/fluxconfig_microservices/appdata/cert.pem', Target: '/etc/ssl/cert.pem' },    ← Shared
 * //   { Source: '/apps/fluxconfig_microservices/appdata/key.pem', Target: '/etc/ssl/key.pem' }       ← Shared
 * // ]
 * // Service2 gets identical mounts from Component 0
 *
 * // Example 9: Build pipeline with artifact sharing
 * const fullSpecs9 = {
 *   version: 8,
 *   name: "buildpipeline",
 *   compose: [
 *     {
 *       name: "builder",
 *       containerData: "/workspace|m:artifacts:/build/output|m:cache:/build/cache"
 *     },
 *     {
 *       name: "tester",
 *       containerData: "/test|c:0:artifacts:/app/build|m:test-results:/test/results"
 *     },
 *     {
 *       name: "packager",
 *       containerData: "/package|c:0:artifacts:/input|c:1:test-results:/reports|m:packages:/output"
 *     }
 *   ]
 * };
 *
 * // Component 0 (builder) - compiles code, outputs artifacts
 * const parsed9a = parseContainerData("/workspace|m:artifacts:/build/output|m:cache:/build/cache");
 * const volumes9a = constructVolumes(parsed9a, "builder_buildpipeline", "buildpipeline", fullSpecs9, fullSpecs9.compose[0]);
 * // Result: [
 * //   { Source: '/apps/fluxbuilder_buildpipeline/appdata', Target: '/workspace' },
 * //   { Source: '/apps/fluxbuilder_buildpipeline/appdata/artifacts', Target: '/build/output' },
 * //   { Source: '/apps/fluxbuilder_buildpipeline/appdata/cache', Target: '/build/cache' }
 * // ]
 *
 * // Component 1 (tester) - reads artifacts, produces test results
 * const parsed9b = parseContainerData("/test|c:0:artifacts:/app/build|m:test-results:/test/results");
 * const volumes9b = constructVolumes(parsed9b, "tester_buildpipeline", "buildpipeline", fullSpecs9, fullSpecs9.compose[1]);
 * // Result: [
 * //   { Source: '/apps/fluxtester_buildpipeline/appdata', Target: '/test' },
 * //   { Source: '/apps/fluxbuilder_buildpipeline/appdata/artifacts', Target: '/app/build' },    ← Builder's output
 * //   { Source: '/apps/fluxtester_buildpipeline/appdata/test-results', Target: '/test/results' }
 * // ]
 *
 * // Component 2 (packager) - reads artifacts and test results, creates packages
 * const parsed9c = parseContainerData("/package|c:0:artifacts:/input|c:1:test-results:/reports|m:packages:/output");
 * const volumes9c = constructVolumes(parsed9c, "packager_buildpipeline", "buildpipeline", fullSpecs9, fullSpecs9.compose[2]);
 * // Result: [
 * //   { Source: '/apps/fluxpackager_buildpipeline/appdata', Target: '/package' },
 * //   { Source: '/apps/fluxbuilder_buildpipeline/appdata/artifacts', Target: '/input' },          ← Builder's output
 * //   { Source: '/apps/fluxtester_buildpipeline/appdata/test-results', Target: '/reports' },     ← Tester's results
 * //   { Source: '/apps/fluxpackager_buildpipeline/appdata/packages', Target: '/output' }
 * // ]
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // PATH RESOLUTION RULES
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // 1. PRIMARY MOUNT:
 * //    - Always maps to: /apps/fluxCOMPONENT_APPNAME/appdata
 * //    - This is the base directory for the component
 *
 * // 2. DIRECTORY MOUNT (m:subdir:path):
 * //    - Maps to: /apps/fluxCOMPONENT_APPNAME/appdata/subdir
 * //    - Created as a subdirectory INSIDE appdata
 *
 * // 3. FILE MOUNT (f:filename:path):
 * //    - Maps to: /apps/fluxCOMPONENT_APPNAME/appdata/filename
 * //    - Created as an empty file INSIDE appdata
 *
 * // 4. COMPONENT PRIMARY (0:path):
 * //    - Maps to: /apps/fluxOTHER_COMPONENT_APPNAME/appdata
 * //    - References another component's entire appdata directory
 *
 * // 5. COMPONENT DIRECTORY (c:0:subdir:path):
 * //    - Maps to: /apps/fluxOTHER_COMPONENT_APPNAME/appdata/subdir
 * //    - References a specific subdirectory from another component
 *
 * // 6. COMPONENT FILE (cf:0:filename:path):
 * //    - Maps to: /apps/fluxOTHER_COMPONENT_APPNAME/appdata/filename
 * //    - References a specific file from another component
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // ORDERING CONSTRAINTS
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Components can ONLY reference components with LOWER indices:
 * // ✅ Component 1 can reference Component 0
 * // ✅ Component 2 can reference Component 0 and 1
 * // ❌ Component 0 CANNOT reference Component 1
 * // ❌ Component 1 CANNOT reference Component 2
 *
 * // This ensures predictable creation order and prevents circular dependencies
 */
function constructVolumes(parsedMounts, identifier, appName, fullAppSpecs, appSpecifications, useModernMounts = true) {
  const volumes = [];

  // Find current component's index (for validation)
  let currentComponentIndex;
  if (fullAppSpecs && fullAppSpecs.version >= 4 && appSpecifications) {
    currentComponentIndex = fullAppSpecs.compose.findIndex(
      (comp) => comp.name === appSpecifications.name
    );
    if (currentComponentIndex === -1) {
      log.warn(`Could not find current component ${appSpecifications.name} in compose specs`);
    }
  }

  // Process all mounts
  for (const mount of parsedMounts.allMounts) {
    let hostPath;
    const containerPath = mount.containerPath;

    switch (mount.type) {
      case MountType.PRIMARY:
      case MountType.DIRECTORY:
      case MountType.FILE:
        // Local mounts (current component)
        hostPath = constructLocalHostPath(identifier, mount.subdir);
        break;

      case MountType.COMPONENT_PRIMARY:
      case MountType.COMPONENT_DIRECTORY:
      case MountType.COMPONENT_FILE:
        // Component reference mounts
        if (!fullAppSpecs) {
          throw new Error(
            `Complete App Specification required for component reference mount: ${mount.containerPath}`
          );
        }

        const componentIdentifier = validateAndGetComponentIdentifier(
          mount.componentIndex,
          currentComponentIndex,
          fullAppSpecs,
          appName
        );

        hostPath = constructComponentHostPath(componentIdentifier, mount.subdir);
        break;

      default:
        throw new Error(`Unknown mount type: ${mount.type}`);
    }

    if (useModernMounts) {
      // Construct Docker Mount object (modern API)
      const mountObject = {
        Type: 'bind',
        Source: hostPath,
        Target: containerPath,
        ReadOnly: false, // Can be extended to support read-only mounts in the future
        BindOptions: {
          Propagation: 'rprivate', // Default propagation mode
        },
      };
      volumes.push(mountObject);

      log.info(`Constructed mount object: ${hostPath} -> ${containerPath} (type: ${mount.type}, isFile: ${mount.isFile})`);
    } else {
      // Construct the bind mount string (legacy API for backward compatibility)
      const bindMount = `${hostPath}:${containerPath}`;
      volumes.push(bindMount);

      log.info(`Constructed bind mount: ${bindMount} (type: ${mount.type}, isFile: ${mount.isFile})`);
    }
  }

  return volumes;
}

/**
 * Get restart policy based on flags
 * @param {string[]} flags - Primary mount flags
 * @returns {string} Docker restart policy
 */
function getRestartPolicy(flags) {
  // 'g' flag (primary/standby) requires 'no' restart policy
  if (flags.includes('g')) {
    return 'no';
  }
  return 'unless-stopped';
}

/**
 * Check if any mount has specific flag
 * @param {object} parsedMounts - Parsed mount data
 * @param {string} flag - Flag to check
 * @returns {boolean}
 */
function hasMountFlag(parsedMounts, flag) {
  return parsedMounts.primary.flags.includes(flag);
}

/**
 * Get all mounts that require Syncthing setup
 * @param {object} parsedMounts - Parsed mount data
 * @returns {Array<object>} Mounts that need Syncthing
 */
function getSyncthingMounts(parsedMounts) {
  const syncthingMounts = [];

  for (const mount of parsedMounts.allMounts) {
    // Check if mount has 'r', 'g', or 's' flag
    if (mount.flags && (mount.flags.includes('r') || mount.flags.includes('g') || mount.flags.includes('s'))) {
      syncthingMounts.push(mount);
    }
  }

  return syncthingMounts;
}

/**
 * Validate mount configuration
 * @param {object} parsedMounts - Parsed mount data
 * @param {object} fullAppSpecs - Full application specifications
 * @param {object} appSpecifications - Current component specifications
 * @throws {Error} If validation fails
 */
function validateMountConfiguration(parsedMounts, fullAppSpecs, appSpecifications) {
  // Check that component references exist
  for (const mount of parsedMounts.additional) {
    if (mount.type === MountType.COMPONENT_PRIMARY ||
        mount.type === MountType.COMPONENT_DIRECTORY ||
        mount.type === MountType.COMPONENT_FILE) {

      if (!fullAppSpecs) {
        throw new Error('Component references require full application specifications');
      }

      if (fullAppSpecs.version >= 4) {
        if (mount.componentIndex < 0 || mount.componentIndex >= fullAppSpecs.compose.length) {
          throw new Error(`Invalid component index: ${mount.componentIndex}`);
        }
      }
    }
  }

  // Warn if using files for syncthing (might not work as expected)
  const syncthingMounts = getSyncthingMounts(parsedMounts);
  for (const mount of syncthingMounts) {
    if (mount.isFile) {
      log.warn(`Syncthing enabled on file mount: ${mount.containerPath}. This may not work as expected.`);
    }
  }
}

module.exports = {
  constructVolumes,
  getRestartPolicy,
  hasMountFlag,
  getSyncthingMounts,
  validateMountConfiguration,
  getAppIdentifier,
};
