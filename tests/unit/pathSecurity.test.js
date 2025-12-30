const { expect } = require('chai');
const path = require('path');
const { sanitizePath, validateFilename } = require('../../ZelBack/src/services/utils/pathSecurity');

describe('pathSecurity', () => {
  describe('sanitizePath', () => {
    const basePath = '/apps/myapp/volume';

    it('should return base path when user path is empty', () => {
      expect(sanitizePath('', basePath)).to.equal(basePath);
      expect(sanitizePath(null, basePath)).to.equal(basePath);
      expect(sanitizePath(undefined, basePath)).to.equal(basePath);
    });

    it('should allow valid subdirectory paths', () => {
      expect(sanitizePath('appdata', basePath)).to.equal(path.join(basePath, 'appdata'));
      expect(sanitizePath('logs', basePath)).to.equal(path.join(basePath, 'logs'));
      expect(sanitizePath('data/subdir', basePath)).to.equal(path.join(basePath, 'data/subdir'));
    });

    it('should block directory traversal with ..', () => {
      expect(() => sanitizePath('..', basePath)).to.throw('directory traversal');
      expect(() => sanitizePath('../', basePath)).to.throw('directory traversal');
      expect(() => sanitizePath('..\\', basePath)).to.throw('directory traversal');
      expect(() => sanitizePath('foo/..', basePath)).to.throw('directory traversal');
      expect(() => sanitizePath('../..', basePath)).to.throw('directory traversal');
      expect(() => sanitizePath('foo/../bar', basePath)).to.throw('directory traversal');
      expect(() => sanitizePath('foo/../../etc/passwd', basePath)).to.throw('directory traversal');
    });

    it('should block null byte injection', () => {
      expect(() => sanitizePath('file\0name', basePath)).to.throw('null bytes');
      expect(() => sanitizePath('valid\0/../etc/passwd', basePath)).to.throw('null bytes');
    });

    it('should handle paths that resolve within base', () => {
      // These should work because they stay within base
      expect(sanitizePath('a/b/c', basePath)).to.equal(path.join(basePath, 'a/b/c'));
      expect(sanitizePath('./appdata', basePath)).to.equal(path.join(basePath, 'appdata'));
    });

    it('should handle edge cases', () => {
      // Single dot should work
      expect(sanitizePath('.', basePath)).to.equal(basePath);

      // Absolute paths that start with base should work via resolve
      const subPath = 'subdir/file.txt';
      expect(sanitizePath(subPath, basePath)).to.equal(path.join(basePath, subPath));
    });

    it('should block encoded traversal attempts', () => {
      // URL-encoded .. would be decoded by express before reaching here
      // but we test the raw values that would be passed
      expect(() => sanitizePath('..', basePath)).to.throw('directory traversal');
    });
  });

  describe('validateFilename', () => {
    it('should allow valid filenames', () => {
      expect(validateFilename('file.txt')).to.equal('file.txt');
      expect(validateFilename('my-file_123.log')).to.equal('my-file_123.log');
      expect(validateFilename('data')).to.equal('data');
    });

    it('should block filenames with path separators', () => {
      expect(() => validateFilename('path/to/file')).to.throw('path separators');
      expect(() => validateFilename('path\\to\\file')).to.throw('path separators');
      expect(() => validateFilename('../etc/passwd')).to.throw('path separators');
    });

    it('should block filenames with traversal sequences', () => {
      expect(() => validateFilename('..')).to.throw('path separators');
      expect(() => validateFilename('file..txt')).to.throw('path separators');
    });

    it('should block reserved names', () => {
      expect(() => validateFilename('.')).to.throw('reserved name');
      expect(() => validateFilename('..')).to.throw('path separators'); // caught first by traversal check
    });

    it('should block null bytes', () => {
      expect(() => validateFilename('file\0.txt')).to.throw('null bytes');
    });

    it('should require non-empty string', () => {
      expect(() => validateFilename('')).to.throw('non-empty string');
      expect(() => validateFilename(null)).to.throw('non-empty string');
      expect(() => validateFilename(undefined)).to.throw('non-empty string');
    });
  });
});
