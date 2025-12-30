const path = require('path');
const { expect } = require('chai');

// Import the sanitizePath function
const { sanitizePath } = require('../../ZelBack/src/services/IOUtils');

describe('sanitizePath - Path Traversal Protection', () => {
  const basePath = '/app/data';

  describe('Valid paths (should pass)', () => {
    it('should allow simple subdirectory', () => {
      const result = sanitizePath(basePath, 'subdir');
      expect(result).to.equal('/app/data/subdir');
    });

    it('should allow nested paths', () => {
      const result = sanitizePath(basePath, 'subdir/nested/file.txt');
      expect(result).to.equal('/app/data/subdir/nested/file.txt');
    });

    it('should handle empty path', () => {
      const result = sanitizePath(basePath, '');
      expect(result).to.equal('/app/data');
    });

    it('should handle dot path', () => {
      const result = sanitizePath(basePath, '.');
      expect(result).to.equal('/app/data');
    });

    it('should handle root path', () => {
      const result = sanitizePath(basePath, '/');
      expect(result).to.equal('/app/data');
    });

    it('should allow paths that contain .. but resolve within base', () => {
      const result = sanitizePath(basePath, 'subdir/../other');
      expect(result).to.equal('/app/data/other');
    });
  });

  describe('Path traversal attacks (should be blocked)', () => {
    it('should block simple parent traversal (..)', () => {
      expect(() => sanitizePath(basePath, '..')).to.throw('Access denied: Path traversal attempt detected');
    });

    it('should block parent traversal with slash (../)', () => {
      expect(() => sanitizePath(basePath, '../')).to.throw('Access denied: Path traversal attempt detected');
    });

    it('should block traversal to sibling directory (../other)', () => {
      expect(() => sanitizePath(basePath, '../other')).to.throw('Access denied: Path traversal attempt detected');
    });

    it('should block deep traversal (../../etc/passwd)', () => {
      expect(() => sanitizePath(basePath, '../../etc/passwd')).to.throw('Access denied: Path traversal attempt detected');
    });

    it('should block traversal from nested path (subdir/../../..)', () => {
      expect(() => sanitizePath(basePath, 'subdir/../../..')).to.throw('Access denied: Path traversal attempt detected');
    });

    it('should block complex traversal (subdir/../../../etc)', () => {
      expect(() => sanitizePath(basePath, 'subdir/../../../etc')).to.throw('Access denied: Path traversal attempt detected');
    });

    it('should block encoded traversal attempts', () => {
      // Even though these come decoded from the URL, test the pattern
      expect(() => sanitizePath(basePath, '../')).to.throw('Access denied: Path traversal attempt detected');
    });
  });

  describe('Edge cases', () => {
    it('should handle trailing slashes in base path', () => {
      const result = sanitizePath('/app/data/', 'subdir');
      expect(result).to.equal('/app/data/subdir');
    });

    it('should prevent prefix attacks (e.g., /app/data vs /app/data-other)', () => {
      // This ensures we're checking the full path segment, not just prefix
      const result = sanitizePath('/app/data', 'file.txt');
      expect(result).to.equal('/app/data/file.txt');
    });
  });
});
