/**
 * Path Security Module
 *
 * Provides path sanitization and validation functions to prevent
 * directory traversal attacks (CWE-22).
 */

const path = require('path');

/**
 * Sanitize and validate a relative path to prevent directory traversal.
 * Ensures the resolved path stays within the allowed base directory.
 *
 * @param {string} userPath - User-provided relative path
 * @param {string} basePath - The allowed base directory
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
function sanitizePath(userPath, basePath) {
  // If no user path provided, return the base path
  if (!userPath || typeof userPath !== 'string') {
    return basePath;
  }

  // Check for null bytes (can bypass security checks in some systems)
  if (userPath.includes('\0')) {
    throw new Error('Invalid path: null bytes not allowed');
  }

  // Check for obvious directory traversal patterns
  // This catches: .., ../, ..\, /../, \..\
  if (userPath.includes('..')) {
    throw new Error('Invalid path: directory traversal not allowed');
  }

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
};
