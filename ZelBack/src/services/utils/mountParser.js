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
 * - File mount: f:<filename>:<path>[:<base64_content>]  (e.g., f:config.yaml:/etc/config.yaml or f:config.yaml:/etc/config.yaml:SGVsbG8gV29ybGQh)
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

  // New syntax: f:<filename>:<path> or f:<filename>:<path>:<base64_content>
  if (firstPart === 'f') {
    if (parts.length !== 3 && parts.length !== 4) {
      throw new Error(`Invalid file mount syntax: ${mountDef}. Expected f:<filename>:<path> or f:<filename>:<path>:<base64_content>`);
    }

    const filename = parts[1];
    const containerPath = parts[2];
    const content = parts.length === 4 ? parts[3] : null;

    validateSubdirOrFilename(filename);
    validateMountPath(containerPath);

    // Validate base64 content if provided
    if (content !== null) {
      // Check content size (max 10MB when base64 decoded, ~13.3MB encoded)
      if (content.length > 14000000) {
        throw new Error(`File content too large for ${filename}. Max 10MB after decoding.`);
      }

      // Basic base64 validation
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
        throw new Error(`File content for ${filename} must be valid base64`);
      }
    }

    return {
      type: MountType.FILE,
      subdir: filename, // Store filename in subdir field for consistency
      containerPath,
      flags: [],
      isFile: true,
      content, // Store base64 content (null if not provided)
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
  // Note: Content not supported for component file mounts (they reference existing files)
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
      content: null, // Component files don't have content (they reference existing files)
    };
  }

  throw new Error(`Unknown mount syntax at index ${index}: ${mountDef}`);
}

/**
 * Parse complete containerData string
 * @param {string} containerData - Pipe-separated mount definitions
 * @returns {object} - { primary, additional: [], allMounts: [] }
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
 * Get all subdirectories/files that need to be created for this component
 * Only includes items that should actually be created on disk.
 * Files without content are skipped (app will create them on first run).
 * @param {object} parsedMounts - Result from parseContainerData
 * @returns {Array<{name: string, isFile: boolean, content: string|null}>}
 */
function getRequiredLocalPaths(parsedMounts) {
  const paths = [];

  for (const mount of parsedMounts.allMounts) {
    // Only include local mounts (not component references)
    if (mount.type === MountType.PRIMARY || mount.type === MountType.DIRECTORY || mount.type === MountType.FILE) {
      // Skip files without content - they should be created by the app on first run
      if (mount.isFile && !mount.content) {
        continue; // eslint-disable-line no-continue
      }

      paths.push({
        name: mount.subdir,
        isFile: mount.isFile,
        content: mount.content || null, // Include base64 content if available
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
