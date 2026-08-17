const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const { expect } = chai;
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const {
  sanitizePath,
  validateFilename,
  validatePathAllowlist,
  isValidPathComponent,
  verifyRealPath,
  verifyRealPathOfExistingPath,
  verifyRealPathSync,
  sanitizeAndVerifyPath,
  rejectBackslashes,
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
      expect(() => sanitizePath('foo/..', basePath)).to.throw('directory traversal');
      expect(() => sanitizePath('../..', basePath)).to.throw('directory traversal');
      expect(() => sanitizePath('foo/../bar', basePath)).to.throw('directory traversal');
      expect(() => sanitizePath('foo/../../etc/passwd', basePath)).to.throw('directory traversal');
    });

    it('should reject backslashes', () => {
      expect(() => sanitizePath('..\\', basePath)).to.throw('backslashes');
      expect(() => sanitizePath('foo\\bar', basePath)).to.throw('backslashes');
      expect(() => sanitizePath('path\\to\\file', basePath)).to.throw('backslashes');
    });

    it('should throw for non-string userPath values', () => {
      expect(() => sanitizePath(123, basePath)).to.throw('must be a string');
      expect(() => sanitizePath({}, basePath)).to.throw('must be a string');
      expect(() => sanitizePath([], basePath)).to.throw('must be a string');
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

    it('should block control characters, which no filename can safely carry', () => {
      // A newline corrupts anything line-oriented that later handles the name.
      // mountinfo escapes them for that reason, and the marker recording where
      // displaced data belongs during a publish is one line of text.
      expect(() => sanitizePath('bad\nname', basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath('bad\rname', basePath)).to.throw('disallowed characters');
      expect(() => sanitizePath('tab\tname', basePath)).to.throw('disallowed characters');
    });

    it('should allow shell metacharacters, because no path is built into a shell string', () => {
      // These were blocked when paths were interpolated into `sudo rm -rf "..."`
      // and `sudo chmod 777 "..."`. Every such call site takes an argv array
      // now, and operands reach a container with only the app's own volume
      // mounted - so refusing a comma or an apostrophe protects nothing while
      // making ordinary files unmanageable.
      expect(() => sanitizePath('$(command)', basePath)).to.not.throw();
      expect(() => sanitizePath('file`cmd`', basePath)).to.not.throw();
      expect(() => sanitizePath('path&command', basePath)).to.not.throw();
      expect(() => sanitizePath('file;rm -rf', basePath)).to.not.throw();
      expect(() => sanitizePath("Mary's photo.png", basePath)).to.not.throw();
      expect(() => sanitizePath('report,final.pdf', basePath)).to.not.throw();
      expect(() => sanitizePath('caf\u00e9.jpg', basePath)).to.not.throw();
      expect(() => sanitizePath('\u65e5\u672c\u8a9e.txt', basePath)).to.not.throw();
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

    it('should return false for path separators and control characters', () => {
      expect(isValidPathComponent('a/b')).to.be.false;
      expect(isValidPathComponent('a\\b')).to.be.false;
      expect(isValidPathComponent('file\nname')).to.be.false;
      expect(isValidPathComponent('file\u0000name')).to.be.false;
    });

    it('should return true for punctuation and non-ASCII names', () => {
      // Uploadable but previously unmanageable: the upload path applied no
      // character rule, so these names could be created and then never
      // renamed, moved, downloaded or deleted.
      expect(isValidPathComponent('caf\u00e9.jpg')).to.be.true;
      expect(isValidPathComponent("Mary's photo.png")).to.be.true;
      expect(isValidPathComponent('report,final.pdf')).to.be.true;
      expect(isValidPathComponent('100%.txt')).to.be.true;
      expect(isValidPathComponent('\u65e5\u672c\u8a9e.txt')).to.be.true;
    });

    it('should allow consecutive dots in filenames', () => {
      // Consecutive dots are allowed in filenames (e.g., "file..backup.txt")
      // Only ".." as the entire component is blocked (traversal)
      expect(isValidPathComponent('file..txt')).to.be.true;
      expect(isValidPathComponent('a..b')).to.be.true;
      expect(isValidPathComponent('backup..2024.tar.gz')).to.be.true;
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

    it('should throw for paths with control characters', () => {
      expect(() => validatePathAllowlist('file\nname')).to.throw('disallowed characters');
      expect(() => validatePathAllowlist('file\u0007bell')).to.throw('disallowed characters');
    });

    it('should throw for dot components', () => {
      expect(() => validatePathAllowlist('.')).to.throw('disallowed characters');
      expect(() => validatePathAllowlist('foo/./bar')).to.throw('disallowed characters');
    });

    it('should allow trailing slash', () => {
      expect(() => validatePathAllowlist('folder/')).to.not.throw();
    });

    it('should reject backslashes', () => {
      // Backslashes are rejected on Linux - they are suspicious
      expect(() => validatePathAllowlist('foo\\bar')).to.throw('backslashes');
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
      expect(() => validateFilename('..')).to.throw('reserved name');
    });

    it('should allow filenames with consecutive dots', () => {
      // Consecutive dots in filenames are allowed (e.g., "file..backup.txt")
      expect(validateFilename('file..txt')).to.equal('file..txt');
      expect(validateFilename('a..b')).to.equal('a..b');
    });

    it('should block reserved names', () => {
      expect(() => validateFilename('.')).to.throw('reserved name');
      expect(() => validateFilename('..')).to.throw('reserved name');
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

  describe('rejectBackslashes', () => {
    it('should throw for paths containing backslashes', () => {
      expect(() => rejectBackslashes('foo\\bar')).to.throw('backslashes');
      expect(() => rejectBackslashes('a\\b\\c')).to.throw('backslashes');
      expect(() => rejectBackslashes('..\\..\\etc')).to.throw('backslashes');
      expect(() => rejectBackslashes('foo\\bar/baz')).to.throw('backslashes');
    });

    it('should not throw for paths without backslashes', () => {
      expect(() => rejectBackslashes('foo/bar')).to.not.throw();
      expect(() => rejectBackslashes('a/b/c')).to.not.throw();
      expect(() => rejectBackslashes('simple')).to.not.throw();
    });

    it('should not throw for empty or null input', () => {
      expect(() => rejectBackslashes('')).to.not.throw();
      expect(() => rejectBackslashes(null)).to.not.throw();
      expect(() => rejectBackslashes(undefined)).to.not.throw();
    });
  });

  describe('verifyRealPath', () => {
    let tempDir;

    before(async () => {
      // Create a temporary directory for testing
      tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pathsec-test-')));
      // Create a subdirectory
      await fs.mkdir(path.join(tempDir, 'subdir'));
      // Create a test file
      await fs.writeFile(path.join(tempDir, 'subdir', 'file.txt'), 'test');
    });

    after(async () => {
      // Clean up
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should return real path for existing paths within base', async () => {
      const result = await verifyRealPath(path.join(tempDir, 'subdir'), tempDir);
      expect(result).to.equal(path.join(tempDir, 'subdir'));
    });

    it('should return original path for non-existent paths', async () => {
      const nonExistent = path.join(tempDir, 'nonexistent');
      const result = await verifyRealPath(nonExistent, tempDir);
      expect(result).to.equal(nonExistent);
    });

    it('should throw for paths outside base directory', async () => {
      // Create a symlink pointing outside the base
      const symlinkPath = path.join(tempDir, 'subdir', 'escape-link');
      try {
        await fs.symlink('/etc', symlinkPath);
        await expect(verifyRealPath(symlinkPath, tempDir)).to.be.rejectedWith('Symlink escape');
        await fs.unlink(symlinkPath);
      } catch (err) {
        // If symlink creation fails (e.g., permissions), skip this test assertion
        if (err.code !== 'EPERM' && err.code !== 'EACCES') {
          throw err;
        }
      }
    });

    it('should allow targets under a symlinked base directory', async () => {
      const realBase = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pathsec-realbase-')));
      const linkParent = await fs.mkdtemp(path.join(os.tmpdir(), 'pathsec-linkparent-'));
      const baseLink = path.join(linkParent, 'base-link');
      try {
        await fs.symlink(realBase, baseLink);
        await fs.mkdir(path.join(realBase, 'subdir'));
        const result = await verifyRealPath(path.join(baseLink, 'subdir'), baseLink);
        expect(result).to.equal(path.join(realBase, 'subdir'));
      } catch (err) {
        // If symlink creation fails (e.g., permissions), skip this test assertion
        if (err.code !== 'EPERM' && err.code !== 'EACCES') {
          throw err;
        }
      } finally {
        await fs.rm(realBase, { recursive: true, force: true });
        await fs.rm(linkParent, { recursive: true, force: true });
      }
    });
  });

  describe('verifyRealPathOfExistingPath', () => {
    let tempDir;

    before(async () => {
      // Create a temporary directory for testing
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pathsec-existing-test-'));
      await fs.mkdir(path.join(tempDir, 'subdir'));
    });

    after(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should not throw when creating under an existing directory within base', async () => {
      await expect(verifyRealPathOfExistingPath(path.join(tempDir, 'subdir', 'newdir'), tempDir)).to.be.fulfilled;
    });

    it('should throw when an existing parent is a symlink that escapes the base', async () => {
      const symlinkPath = path.join(tempDir, 'escape-link');
      try {
        await fs.symlink('/etc', symlinkPath);
        await expect(verifyRealPathOfExistingPath(path.join(symlinkPath, 'newdir'), tempDir)).to.be.rejectedWith('Symlink escape');
      } catch (err) {
        if (err.code !== 'EPERM' && err.code !== 'EACCES') {
          throw err;
        }
      } finally {
        try {
          await fs.unlink(symlinkPath);
        } catch (e) {
          // ignore cleanup failures
        }
      }
    });

    it('refuses a parent symlink that dangles on the host but resolves in the container', async () => {
      // The real vector is `ln -s /work appdata/root`: /work does not exist on
      // the host so the link is dangling, but in the container /work IS the
      // volume and it resolves to the root, reaching a reserved name the guard
      // decides from the host resolution. lstat succeeds on the dangling link
      // and realpath then fails - which used to pass through as "cannot resolve,
      // therefore safe". A target guaranteed absent on any host stands in for
      // /work here.
      const symlinkPath = path.join(tempDir, 'container-namespace-link');
      try {
        await fs.symlink('/flux-nonexistent-target-a1b2c3', symlinkPath);
        await expect(verifyRealPathOfExistingPath(path.join(symlinkPath, '.stfolder'), tempDir))
          .to.be.rejectedWith('does not resolve on the host');
      } catch (err) {
        if (err.code !== 'EPERM' && err.code !== 'EACCES') {
          throw err;
        }
      } finally {
        try {
          await fs.unlink(symlinkPath);
        } catch (e) {
          // ignore cleanup failures
        }
      }
    });
  });

  describe('verifyRealPathSync', () => {
    let tempDir;

    before(async () => {
      tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pathsec-sync-test-')));
      await fs.mkdir(path.join(tempDir, 'subdir'));
      await fs.writeFile(path.join(tempDir, 'subdir', 'file.txt'), 'test');
    });

    after(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should return real path for existing paths within base', () => {
      const result = verifyRealPathSync(path.join(tempDir, 'subdir'), tempDir);
      expect(result).to.equal(path.join(tempDir, 'subdir'));
    });

    it('should return original path for non-existent paths', () => {
      const nonExistent = path.join(tempDir, 'nonexistent');
      const result = verifyRealPathSync(nonExistent, tempDir);
      expect(result).to.equal(nonExistent);
    });
  });

  describe('sanitizeAndVerifyPath', () => {
    let tempDir;

    before(async () => {
      tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pathsec-combined-test-')));
      await fs.mkdir(path.join(tempDir, 'subdir'));
    });

    after(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should sanitize and verify valid paths', async () => {
      const result = await sanitizeAndVerifyPath('subdir', tempDir);
      expect(result).to.equal(path.join(tempDir, 'subdir'));
    });

    it('should throw for traversal attempts before symlink check', async () => {
      await expect(sanitizeAndVerifyPath('..', tempDir)).to.be.rejectedWith('directory traversal');
    });

    it('should throw for null bytes before symlink check', async () => {
      await expect(sanitizeAndVerifyPath('file\0name', tempDir)).to.be.rejectedWith('null bytes');
    });
  });
});
