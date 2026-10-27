const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expect } = require('chai');

const { requirePlainDirectories, requirePlainMountSources, requireRegularFile } = require('../../ZelBack/src/services/utils/plainPaths');

describe('plainPaths', () => {
  let mount;

  beforeEach(() => {
    mount = fs.mkdtempSync(path.join(os.tmpdir(), 'plainpaths-'));
  });

  afterEach(() => {
    fs.rmSync(mount, { recursive: true, force: true });
  });

  describe('requirePlainDirectories', () => {
    it('accepts entries that are plain directories, and entries that do not exist yet', async () => {
      fs.mkdirSync(path.join(mount, 'appdata'));
      fs.mkdirSync(path.join(mount, 'backup'));

      await requirePlainDirectories(mount, ['appdata', 'backup', 'backup/remote']);
    });

    it('refuses an entry that is a link, even to a directory', async () => {
      fs.mkdirSync(path.join(mount, 'elsewhere'));
      fs.symlinkSync(path.join(mount, 'elsewhere'), path.join(mount, 'appdata'));

      let error;
      try {
        await requirePlainDirectories(mount, ['appdata']);
      } catch (e) {
        error = e;
      }
      expect(error.message).to.equal('Refused: appdata in the volume is not a plain directory');
    });

    it('refuses an entry that is a file', async () => {
      fs.writeFileSync(path.join(mount, 'backup'), 'x');

      let error;
      try {
        await requirePlainDirectories(mount, ['backup']);
      } catch (e) {
        error = e;
      }
      expect(error.message).to.equal('Refused: backup in the volume is not a plain directory');
    });

    it('refuses a link below a plain directory', async () => {
      fs.mkdirSync(path.join(mount, 'backup'));
      fs.symlinkSync('/', path.join(mount, 'backup', 'remote'));

      let error;
      try {
        await requirePlainDirectories(mount, ['backup', 'backup/remote']);
      } catch (e) {
        error = e;
      }
      expect(error.message).to.equal('Refused: backup/remote in the volume is not a plain directory');
    });
  });

  describe('requirePlainMountSources', () => {
    it('accepts plain directories, a regular file and a source that does not exist', async () => {
      fs.mkdirSync(path.join(mount, 'appdata'));
      fs.writeFileSync(path.join(mount, 'config.json'), 'x');

      await requirePlainMountSources([
        path.join(mount, 'appdata'), path.join(mount, 'config.json'), path.join(mount, 'missing'),
      ]);
    });

    it('refuses a link, whatever it points at', async () => {
      fs.mkdirSync(path.join(mount, 'real'));
      fs.symlinkSync(path.join(mount, 'real'), path.join(mount, 'appdata'));

      let error;
      try {
        await requirePlainMountSources([path.join(mount, 'appdata')]);
      } catch (e) {
        error = e;
      }
      expect(error.message).to.equal('Refused: mount source appdata is not a plain directory or file');
    });

    it('refuses a link that dangles', async () => {
      fs.symlinkSync(path.join(mount, 'nowhere'), path.join(mount, 'logs'));

      let error;
      try {
        await requirePlainMountSources([path.join(mount, 'logs')]);
      } catch (e) {
        error = e;
      }
      expect(error.message).to.equal('Refused: mount source logs is not a plain directory or file');
    });
  });

  describe('requireRegularFile', () => {
    it('accepts a regular file and a path that does not exist', async () => {
      fs.writeFileSync(path.join(mount, 'archive.tar.gz'), 'x');

      await requireRegularFile(path.join(mount, 'archive.tar.gz'));
      await requireRegularFile(path.join(mount, 'missing.tar.gz'));
    });

    it('refuses a link', async () => {
      fs.writeFileSync(path.join(mount, 'real'), 'x');
      fs.symlinkSync(path.join(mount, 'real'), path.join(mount, 'archive.tar.gz'));

      let error;
      try {
        await requireRegularFile(path.join(mount, 'archive.tar.gz'));
      } catch (e) {
        error = e;
      }
      expect(error.message).to.equal('Refused: the backup archive is not a regular file');
    });
  });
});
