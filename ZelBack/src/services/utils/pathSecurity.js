/**
 * Path Security Module
 *
 * Provides path sanitization and validation functions to prevent
 * directory traversal attacks (CWE-22).
 *
 * Uses a defense-in-depth approach:
 * 1. Blocklist: Explicitly block known dangerous patterns (.., null bytes)
 * 2. Allowlist: Only permit characters matching a safe pattern
 * 3. Path resolution: Verify resolved path stays within base directory
 */

const path = require('path');

/**
 * Validate a single path component (directory or filename) against allowlist.
 * Only permits safe characters to prevent injection attacks.
 *
 * Allowed characters:
 * - Alphanumeric (a-z, A-Z, 0-9)
 * - Dash (-), underscore (_)
 * - Dot (.) - but not leading, not consecutive
 * - Space ( ) - common in filenames
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

  // Block . and .. explicitly
  if (component === '.' || component === '..') {
    return false;
  }

  // Block components starting with dot (hidden files) - optional security measure
  // Uncomment the following to block hidden files:
  // if (component.startsWith('.')) {
  //   return false;
  // }

  // Allowlist pattern: alphanumeric, dash, underscore, dot, space
  // This is intentionally restrictive - only allow known-safe characters
  const safePattern = /^[a-zA-Z0-9_\-. ]+$/;

  if (!safePattern.test(component)) {
    return false;
  }

  // Block consecutive dots (potential traversal obfuscation)
  if (/\.\./.test(component)) {
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

  // Normalize path separators to forward slash for consistent handling
  const normalizedPath = userPath.replace(/\\/g, '/');

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

    if (!isValidPathComponent(component)) {
      throw new Error(`Invalid path: component "${component}" contains disallowed characters`);
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
 * sanitizePath('foo<script>', '/apps/myapp')  // Error: disallowed characters
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

  // Check for obvious directory traversal patterns
  // This catches: .., ../, ..\, /../, \..\
  if (userPath.includes('..')) {
    throw new Error('Invalid path: directory traversal not allowed');
  }

  // === LAYER 2: Allowlist validation (strict mode) ===
  if (strict) {
    validatePathAllowlist(userPath);
  }

  // === LAYER 3: Path resolution and containment check ===

  // Normalize the base path
  const normalizedBase = path.resolve(basePath);

  // Resolve the full path (this handles any remaining edge cases)
  const resolvedPath = path.resolve(normalizedBase, userPath);

  // Final security check: ensure resolved path is within base directory
  // The path must either equal the base or start with base + separator
  if (resolvedPath !== normalizedBase && !resolvedPath.startsWith(normalizedBase + path.sep)) {
    throw new Error('Invalid path: access outside allowed directory denied');
  }

  return resolvedPath;
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

  // Check for path separators and traversal
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('Invalid filename: path separators and traversal sequences not allowed');
  }

  // Check for reserved names
  if (name === '.' || name === '..') {
    throw new Error('Invalid filename: reserved name');
  }

  return name;
}

module.exports = {
  sanitizePath,
  validateFilename,
  validatePathAllowlist,
  isValidPathComponent,
};
