const { expect } = require('chai');
const path = require('path');
const {
  sanitizePath,
  validateFilename,
  validatePathAllowlist,
  isValidPathComponent,
} = require('../../ZelBack/src/services/utils/pathSecurity');

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
      // Note: ./appdata is blocked by allowlist because . is not a valid component
      // Use appdata directly instead
      expect(sanitizePath('appdata', basePath)).to.equal(path.join(basePath, 'appdata'));
    });

    it('should handle edge cases', () => {
      // Absolute paths that start with base should work via resolve
      const subPath = 'subdir/file.txt';
      expect(sanitizePath(subPath, basePath)).to.equal(path.join(basePath, subPath));
    });

    it('should block encoded traversal attempts', () => {
      // URL-encoded .. would be decoded by express before reaching here
      // but we test the raw values that would be passed
      expect(() => sanitizePath('..', basePath)).to.throw('directory traversal');
    });

    // Allowlist tests (Solution 2)
    it('should block special characters via allowlist', () => {
      expect(() => sanitizePath('file<script>', basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath('path|injection', basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath('file;rm -rf', basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath('$(command)', basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath('file`cmd`', basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath('path&command', basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath("file'injection", basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath('file"injection', basePath)).to.throw('disallowed characters');
    });

    it('should block absolute paths via allowlist', () => {
      expect(() => sanitizePath('/etc/passwd', basePath)).to.throw('absolute paths not allowed');
      expect(() => sanitizePath('/root/.ssh/id_rsa', basePath)).to.throw('absolute paths not allowed');
    });

    it('should allow safe characters', () => {
      expect(sanitizePath('my-file_123.txt', basePath)).to.equal(path.join(basePath, 'my-file_123.txt'));
      expect(sanitizePath('data/logs/app.log', basePath)).to.equal(path.join(basePath, 'data/logs/app.log'));
      expect(sanitizePath('file with spaces.txt', basePath)).to.equal(path.join(basePath, 'file with spaces.txt'));
    });

    it('should work with strict mode disabled', () => {
      // With strict=false, only blocklist checks are applied
      // Special chars would pass blocklist but fail at path resolution if they escape
      const options = { strict: false };
      expect(sanitizePath('valid', basePath, options)).to.equal(path.join(basePath, 'valid'));
    });

    it('should block single dot component via allowlist', () => {
      expect(() => sanitizePath('.', basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath('foo/./bar', basePath)).to.throw('disallowed characters');
    });
  });

  describe('isValidPathComponent', () => {
    it('should return true for valid components', () => {
      expect(isValidPathComponent('file.txt')).to.be.true;
      expect(isValidPathComponent('my-dir')).to.be.true;
      expect(isValidPathComponent('folder_name')).to.be.true;
      expect(isValidPathComponent('file123')).to.be.true;
      expect(isValidPathComponent('name with space')).to.be.true;
    });

    it('should return false for invalid components', () => {
      expect(isValidPathComponent('..')).to.be.false;
      expect(isValidPathComponent('.')).to.be.false;
      expect(isValidPathComponent('')).to.be.false;
      expect(isValidPathComponent(null)).to.be.false;
      expect(isValidPathComponent(undefined)).to.be.false;
    });

    it('should return false for components with special characters', () => {
      expect(isValidPathComponent('file<tag>')).to.be.false;
      expect(isValidPathComponent('cmd;rm')).to.be.false;
      expect(isValidPathComponent('$(cmd)')).to.be.false;
      expect(isValidPathComponent('file|pipe')).to.be.false;
      expect(isValidPathComponent('file&bg')).to.be.false;
    });

    it('should return false for consecutive dots', () => {
      expect(isValidPathComponent('file..txt')).to.be.false;
      expect(isValidPathComponent('a..b')).to.be.false;
    });
  });

  describe('validatePathAllowlist', () => {
    it('should pass for valid relative paths', () => {
      expect(() => validatePathAllowlist('appdata')).to.not.throw();
      expect(() => validatePathAllowlist('logs/app.log')).to.not.throw();
      expect(() => validatePathAllowlist('data/subdir/file.txt')).to.not.throw();
      expect(() => validatePathAllowlist('file-name_123.txt')).to.not.throw();
    });

    it('should pass for empty/null paths', () => {
      expect(() => validatePathAllowlist('')).to.not.throw();
      expect(() => validatePathAllowlist(null)).to.not.throw();
      expect(() => validatePathAllowlist(undefined)).to.not.throw();
    });

    it('should throw for absolute paths', () => {
      expect(() => validatePathAllowlist('/etc/passwd')).to.throw('absolute paths not allowed');
      expect(() => validatePathAllowlist('/root')).to.throw('absolute paths not allowed');
    });

    it('should throw for paths with special characters', () => {
      expect(() => validatePathAllowlist('file<script>')).to.throw('disallowed characters');
      expect(() => validatePathAllowlist('cmd;rm')).to.throw('disallowed characters');
    });

    it('should throw for dot components', () => {
      expect(() => validatePathAllowlist('.')).to.throw('disallowed characters');
      expect(() => validatePathAllowlist('foo/./bar')).to.throw('disallowed characters');
    });

    it('should allow trailing slash', () => {
      expect(() => validatePathAllowlist('folder/')).to.not.throw();
    });

    it('should handle backslashes by normalizing to forward slashes', () => {
      // Backslashes are normalized, then validated
      expect(() => validatePathAllowlist('foo\\bar')).to.not.throw();
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
