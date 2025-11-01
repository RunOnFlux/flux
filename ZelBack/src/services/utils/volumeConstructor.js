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
 * Construct Docker bind mounts from parsed mount definitions
 * @param {object} parsedMounts - Parsed mount data from mountParser
 * @param {string} identifier - Current component identifier (e.g., "component_appname")
 * @param {string} appName - Application name
 * @param {object} fullAppSpecs - Full application specifications (required for component refs)
 * @param {object} appSpecifications - Current component specifications
 * @param {boolean} useModernMounts - If true, return Mount objects instead of Binds strings (default: true)
 * @returns {Array<Object|string>} Array of Docker Mount objects or bind mount strings
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
