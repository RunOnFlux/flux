/**
 * Path Security Module
 *
 * Provides path sanitization and validation functions to prevent
 * directory traversal attacks (CWE-22) and symlink escape attacks.
 *
 * Uses a defense-in-depth approach:
 * 1. Blocklist: Explicitly block known dangerous patterns (.., null bytes)
 * 2. Allowlist: Only permit characters matching a safe pattern (optional strict mode)
 * 3. Path resolution: Verify resolved path stays within base directory
 * 4. Symlink protection: Optionally verify real path after symlink resolution
 */

const path = require('path');
const fs = require('fs');

/**
 * Normalize path separators to forward slashes (for cross-platform consistency).
 * On Linux, backslashes are valid filename characters, so we normalize them
 * to prevent bypass attempts.
 *
 * @param {string} inputPath - Path to normalize
 * @returns {string} Path with all backslashes converted to forward slashes
 */
function normalizePathSeparators(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return inputPath;
  }
  return inputPath.replace(/\\/g, '/');
}

/**
 * Validate a single path component (directory or filename) against allowlist.
 * This is the STRICT mode validation - only allows known-safe characters.
 *
 * Allowed characters:
 * - Alphanumeric (a-z, A-Z, 0-9)
 * - Dash (-), underscore (_)
 * - Dot (.) - but not as sole character or double dots
 * - Space ( ) - common in filenames
 * - Additional safe chars: @, #, +, =, (), [], {}
 *
 * @param {string} component - Single path component (no slashes)
 * @returns {boolean} True if component is safe
 */
function isValidPathComponent(component) {
  if (!component || typeof component !== 'string') {
    return false;
  }

  // Empty components are invalid (would result from // in path)
  if (component.length === 0) {
    return false;
  }

  // Block . and .. explicitly (traversal components)
  if (component === '.' || component === '..') {
    return false;
  }

  // Allowlist pattern: alphanumeric, dash, underscore, dot, space, and common safe chars
  // Note: We allow consecutive dots in FILENAMES (e.g., "file..backup.txt") since they're not traversal
  // The traversal check is done by checking if component === '..'
  const safePattern = /^[a-zA-Z0-9_\-. @#+=()[\]{}]+$/;

  if (!safePattern.test(component)) {
    return false;
  }

  return true;
}

/**
 * Validate entire relative path using allowlist approach.
 * Splits path into components and validates each one.
 *
 * @param {string} userPath - User-provided relative path
 * @throws {Error} If path contains invalid characters or components
 */
function validatePathAllowlist(userPath) {
  if (!userPath || typeof userPath !== 'string') {
    return; // Empty paths are handled elsewhere
  }

  // Normalize path separators FIRST for consistent handling
  const normalizedPath = normalizePathSeparators(userPath);

  // Block absolute paths (starting with /)
  if (normalizedPath.startsWith('/')) {
    throw new Error('Invalid path: absolute paths not allowed');
  }

  // Split into components and validate each
  const components = normalizedPath.split('/');

  for (let i = 0; i < components.length; i += 1) {
    const component = components[i];

    // Allow empty component only at the end (trailing slash)
    if (component === '' && i === components.length - 1) {
      continue;
    }

    // Empty component in middle means double slash - suspicious
    if (component === '' && i < components.length - 1) {
      throw new Error('Invalid path: empty path component (double slash)');
    }

    if (!isValidPathComponent(component)) {
      throw new Error(`Invalid path: component "${component}" contains disallowed characters`);
    }
  }
}

/**
 * Check if a path component is a traversal attempt.
 * This is used in non-strict mode for basic traversal detection.
 *
 * @param {string} component - Path component to check
 * @returns {boolean} True if component is a traversal attempt
 */
function isTraversalComponent(component) {
  return component === '.' || component === '..';
}

/**
 * Basic path validation (non-strict mode).
 * Only blocks obvious dangerous patterns without character restrictions.
 *
 * @param {string} userPath - User-provided path
 * @throws {Error} If path contains traversal attempts
 */
function validatePathBasic(userPath) {
  if (!userPath || typeof userPath !== 'string') {
    return;
  }

  const normalizedPath = normalizePathSeparators(userPath);
  const components = normalizedPath.split('/');

  for (const component of components) {
    if (isTraversalComponent(component)) {
      throw new Error('Invalid path: directory traversal not allowed');
    }
  }
}

/**
 * Sanitize and validate a relative path to prevent directory traversal.
 * Uses defense-in-depth with both blocklist and allowlist validation.
 * Ensures the resolved path stays within the allowed base directory.
 *
 * @param {string} userPath - User-provided relative path
 * @param {string} basePath - The allowed base directory
 * @param {object} options - Optional configuration
 * @param {boolean} options.strict - If true, enforce strict allowlist (default: true)
 * @returns {string} Resolved safe absolute path
 * @throws {Error} If path attempts to escape base directory or contains invalid characters
 *
 * @example
 * // Valid usage
 * sanitizePath('appdata', '/apps/myapp')  // Returns '/apps/myapp/appdata'
 * sanitizePath('logs/app.log', '/apps/myapp')  // Returns '/apps/myapp/logs/app.log'
 * sanitizePath('', '/apps/myapp')  // Returns '/apps/myapp'
 *
 * // Throws error
 * sanitizePath('..', '/apps/myapp')  // Error: directory traversal
 * sanitizePath('../other', '/apps/myapp')  // Error: directory traversal
 * sanitizePath('foo\0bar', '/apps/myapp')  // Error: null byte
 */
function sanitizePath(userPath, basePath, options = {}) {
  const { strict = true } = options;

  // If no user path provided, return the base path
  if (!userPath || typeof userPath !== 'string') {
    return basePath;
  }

  // === LAYER 1: Blocklist checks (fast rejection of known-bad patterns) ===

  // Check for null bytes (can bypass security checks in some systems)
  if (userPath.includes('\0')) {
    throw new Error('Invalid path: null bytes not allowed');
  }

  // Normalize backslashes to forward slashes BEFORE any path operations
  // This ensures consistent handling and prevents bypass via backslashes
  const normalizedUserPath = normalizePathSeparators(userPath);

  // Check for traversal patterns in the normalized path
  // We check each component separately to catch '..' as a path component
  const components = normalizedUserPath.split('/');
  for (const component of components) {
    if (component === '..') {
      throw new Error('Invalid path: directory traversal not allowed');
    }
  }

  // === LAYER 2: Allowlist validation (strict mode) or basic validation ===
  if (strict) {
    validatePathAllowlist(normalizedUserPath);
  } else {
    validatePathBasic(normalizedUserPath);
  }

  // === LAYER 3: Path resolution and containment check ===

  // Normalize the base path
  const normalizedBase = path.resolve(basePath);

  // Resolve the full path using the NORMALIZED user path
  const resolvedPath = path.resolve(normalizedBase, normalizedUserPath);

  // Final security check: ensure resolved path is within base directory
  // The path must either equal the base or start with base + separator
  if (resolvedPath !== normalizedBase && !resolvedPath.startsWith(normalizedBase + path.sep)) {
    throw new Error('Invalid path: access outside allowed directory denied');
  }

  return resolvedPath;
}

/**
 * Verify that a path's real location (after resolving symlinks) is within the allowed base.
 * This prevents symlink escape attacks where a symlink inside the allowed directory
 * points to a location outside it.
 *
 * @param {string} targetPath - The path to verify (should already be sanitized)
 * @param {string} basePath - The allowed base directory
 * @returns {Promise<string>} The real path if safe
 * @throws {Error} If the real path escapes the base directory or path doesn't exist
 *
 * @example
 * // If /apps/myapp/data/link is a symlink to /etc/passwd
 * await verifyRealPath('/apps/myapp/data/link', '/apps/myapp')
 * // Throws: "Symlink escape: real path is outside allowed directory"
 */
async function verifyRealPath(targetPath, basePath) {
  const normalizedBase = path.resolve(basePath);

  try {
    // Get the real path after resolving all symlinks
    const realPath = await fs.promises.realpath(targetPath);

    // Check if the real path is within the base directory
    if (realPath !== normalizedBase && !realPath.startsWith(normalizedBase + path.sep)) {
      throw new Error('Symlink escape: real path is outside allowed directory');
    }

    return realPath;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Path doesn't exist - this is OK for operations that create files
      // Return the original path since we can't verify symlinks for non-existent paths
      return targetPath;
    }
    throw error;
  }
}

/**
 * Synchronous version of verifyRealPath.
 *
 * @param {string} targetPath - The path to verify
 * @param {string} basePath - The allowed base directory
 * @returns {string} The real path if safe
 * @throws {Error} If the real path escapes the base directory
 */
function verifyRealPathSync(targetPath, basePath) {
  const normalizedBase = path.resolve(basePath);

  try {
    const realPath = fs.realpathSync(targetPath);

    if (realPath !== normalizedBase && !realPath.startsWith(normalizedBase + path.sep)) {
      throw new Error('Symlink escape: real path is outside allowed directory');
    }

    return realPath;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return targetPath;
    }
    throw error;
  }
}

/**
 * Validate that a filename/object name is safe (no path components).
 * Use this for parameters that should only be a single filename, not a path.
 *
 * @param {string} name - The filename or object name to validate
 * @returns {string} The validated name
 * @throws {Error} If name contains path separators or traversal sequences
 *
 * @example
 * validateFilename('myfile.txt')  // Returns 'myfile.txt'
 * validateFilename('file-name_123.log')  // Returns 'file-name_123.log'
 * validateFilename('../etc/passwd')  // Error: invalid filename
 * validateFilename('path/to/file')  // Error: invalid filename
 */
function validateFilename(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Filename must be a non-empty string');
  }

  // Check for null bytes
  if (name.includes('\0')) {
    throw new Error('Invalid filename: null bytes not allowed');
  }

  // Check for path separators (both / and \)
  if (name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid filename: path separators not allowed');
  }

  // Check for reserved traversal names
  if (name === '.' || name === '..') {
    throw new Error('Invalid filename: reserved name');
  }

  return name;
}

/**
 * Sanitize a path and verify it doesn't escape via symlinks.
 * This is the most secure option - combines lexical checks with symlink verification.
 *
 * @param {string} userPath - User-provided relative path
 * @param {string} basePath - The allowed base directory
 * @param {object} options - Optional configuration
 * @param {boolean} options.strict - If true, enforce strict allowlist (default: true)
 * @returns {Promise<string>} The verified real path
 * @throws {Error} If path is invalid or escapes base directory
 */
async function sanitizeAndVerifyPath(userPath, basePath, options = {}) {
  // First, sanitize the path lexically
  const sanitizedPath = sanitizePath(userPath, basePath, options);

  // Then verify the real path (after symlink resolution)
  return verifyRealPath(sanitizedPath, basePath);
}

module.exports = {
  sanitizePath,
  validateFilename,
  validatePathAllowlist,
  validatePathBasic,
  isValidPathComponent,
  verifyRealPath,
  verifyRealPathSync,
  sanitizeAndVerifyPath,
  normalizePathSeparators,
};
