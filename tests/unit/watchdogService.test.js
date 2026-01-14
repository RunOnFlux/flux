const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const { expect } = chai;

const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const log = require('../../ZelBack/src/lib/log');

describe('watchdogService tests', () => {
  let watchdogService;
  let runCommandStub;
  let homedirStub;
  let logInfoStub;
  let logWarnStub;
  let logErrorStub;

  beforeEach(() => {
    runCommandStub = sinon.stub(serviceHelper, 'runCommand');
    homedirStub = sinon.stub(os, 'homedir').returns('/home/testuser');
    logInfoStub = sinon.stub(log, 'info');
    logWarnStub = sinon.stub(log, 'warn');
    logErrorStub = sinon.stub(log, 'error');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getWatchdogPath tests', () => {
    beforeEach(() => {
      // Re-require the module to pick up fresh stubs
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should return the correct watchdog path', () => {
      const result = watchdogService.getWatchdogPath();
      expect(result).to.equal('/home/testuser/watchdog');
    });
  });

  describe('getWatchdogConfigPath tests', () => {
    beforeEach(() => {
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should return the correct config path', () => {
      const result = watchdogService.getWatchdogConfigPath();
      expect(result).to.equal('/home/testuser/watchdog/config.js');
    });
  });

  describe('directoryExists tests', () => {
    beforeEach(() => {
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should return true if directory exists', async () => {
      sinon.stub(fs, 'stat').resolves({ isDirectory: () => true });
      const result = await watchdogService.directoryExists('/some/path');
      expect(result).to.be.true;
    });

    it('should return false if path is a file', async () => {
      sinon.stub(fs, 'stat').resolves({ isDirectory: () => false });
      const result = await watchdogService.directoryExists('/some/path');
      expect(result).to.be.false;
    });

    it('should return false if path does not exist', async () => {
      sinon.stub(fs, 'stat').rejects(new Error('ENOENT'));
      const result = await watchdogService.directoryExists('/some/path');
      expect(result).to.be.false;
    });
  });

  describe('fileExists tests', () => {
    beforeEach(() => {
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should return true if file exists', async () => {
      sinon.stub(fs, 'stat').resolves({ isFile: () => true });
      const result = await watchdogService.fileExists('/some/file.js');
      expect(result).to.be.true;
    });

    it('should return false if path is a directory', async () => {
      sinon.stub(fs, 'stat').resolves({ isFile: () => false });
      const result = await watchdogService.fileExists('/some/file.js');
      expect(result).to.be.false;
    });

    it('should return false if file does not exist', async () => {
      sinon.stub(fs, 'stat').rejects(new Error('ENOENT'));
      const result = await watchdogService.fileExists('/some/file.js');
      expect(result).to.be.false;
    });
  });

  describe('isWatchdogInstalled tests', () => {
    beforeEach(() => {
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should return true if watchdog directory, package.json, and node_modules exist', async () => {
      const statStub = sinon.stub(fs, 'stat');
      // Directory exists and is a directory
      statStub.withArgs('/home/testuser/watchdog').resolves({ isDirectory: () => true });
      // package.json exists and is a file
      statStub.withArgs('/home/testuser/watchdog/package.json').resolves({ isFile: () => true });
      // node_modules exists and is a directory
      statStub.withArgs('/home/testuser/watchdog/node_modules').resolves({ isDirectory: () => true });

      const result = await watchdogService.isWatchdogInstalled();
      expect(result).to.be.true;
    });

    it('should return false if watchdog directory does not exist', async () => {
      sinon.stub(fs, 'stat').rejects(new Error('ENOENT'));

      const result = await watchdogService.isWatchdogInstalled();
      expect(result).to.be.false;
    });

    it('should return false if package.json does not exist', async () => {
      const statStub = sinon.stub(fs, 'stat');
      statStub.withArgs('/home/testuser/watchdog').resolves({ isDirectory: () => true });
      statStub.withArgs('/home/testuser/watchdog/package.json').rejects(new Error('ENOENT'));
      statStub.withArgs('/home/testuser/watchdog/node_modules').resolves({ isDirectory: () => true });

      const result = await watchdogService.isWatchdogInstalled();
      expect(result).to.be.false;
    });

    it('should return false if node_modules does not exist', async () => {
      const statStub = sinon.stub(fs, 'stat');
      statStub.withArgs('/home/testuser/watchdog').resolves({ isDirectory: () => true });
      statStub.withArgs('/home/testuser/watchdog/package.json').resolves({ isFile: () => true });
      statStub.withArgs('/home/testuser/watchdog/node_modules').rejects(new Error('ENOENT'));

      const result = await watchdogService.isWatchdogInstalled();
      expect(result).to.be.false;
    });
  });

  describe('isWatchdogRunning tests', () => {
    beforeEach(() => {
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should return true if watchdog is online in pm2', async () => {
      const pm2List = [
        {
          name: 'flux',
          pm2_env: { status: 'online' },
        },
        {
          name: 'watchdog',
          pm2_env: { status: 'online' },
        },
      ];
      runCommandStub.resolves({ stdout: JSON.stringify(pm2List), error: null });

      const result = await watchdogService.isWatchdogRunning();
      expect(result).to.be.true;
      sinon.assert.calledWith(runCommandStub, 'pm2', sinon.match({ params: ['jlist'] }));
    });

    it('should return false if watchdog is stopped in pm2', async () => {
      const pm2List = [
        {
          name: 'watchdog',
          pm2_env: { status: 'stopped' },
        },
      ];
      runCommandStub.resolves({ stdout: JSON.stringify(pm2List), error: null });

      const result = await watchdogService.isWatchdogRunning();
      expect(result).to.be.false;
    });

    it('should return false if watchdog is not in pm2 list', async () => {
      const pm2List = [
        {
          name: 'flux',
          pm2_env: { status: 'online' },
        },
      ];
      runCommandStub.resolves({ stdout: JSON.stringify(pm2List), error: null });

      const result = await watchdogService.isWatchdogRunning();
      expect(result).to.be.false;
    });

    it('should return false if pm2 command fails', async () => {
      runCommandStub.resolves({ stdout: null, error: new Error('pm2 not found') });

      const result = await watchdogService.isWatchdogRunning();
      expect(result).to.be.false;
    });

    it('should return false if pm2 returns empty output', async () => {
      runCommandStub.resolves({ stdout: '', error: null });

      const result = await watchdogService.isWatchdogRunning();
      expect(result).to.be.false;
    });

    it('should return false if pm2 returns invalid JSON', async () => {
      runCommandStub.resolves({ stdout: 'invalid json', error: null });

      const result = await watchdogService.isWatchdogRunning();
      expect(result).to.be.false;
    });
  });

  describe('cloneWatchdog tests', () => {
    beforeEach(() => {
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should clone the watchdog repository successfully', async () => {
      sinon.stub(fs, 'stat').rejects(new Error('ENOENT')); // Directory doesn't exist
      runCommandStub.resolves({ error: null });

      const result = await watchdogService.cloneWatchdog();
      expect(result).to.be.true;
      sinon.assert.calledWith(runCommandStub, 'git', sinon.match({
        params: ['clone', 'https://github.com/RunOnFlux/fluxnode-watchdog.git', 'watchdog'],
        cwd: '/home/testuser',
      }));
    });

    it('should remove existing directory before cloning', async () => {
      sinon.stub(fs, 'stat').resolves({ isDirectory: () => true }); // Directory exists
      runCommandStub.resolves({ error: null });

      const result = await watchdogService.cloneWatchdog();
      expect(result).to.be.true;
      sinon.assert.calledWith(runCommandStub, 'rm', sinon.match({
        params: ['-rf', '/home/testuser/watchdog'],
      }));
    });

    it('should return false if git clone fails', async () => {
      sinon.stub(fs, 'stat').rejects(new Error('ENOENT'));
      runCommandStub.resolves({ error: new Error('git clone failed') });

      const result = await watchdogService.cloneWatchdog();
      expect(result).to.be.false;
    });
  });

  describe('installWatchdogDependencies tests', () => {
    beforeEach(() => {
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should install npm dependencies successfully', async () => {
      runCommandStub.resolves({ error: null });

      const result = await watchdogService.installWatchdogDependencies();
      expect(result).to.be.true;
      sinon.assert.calledWith(runCommandStub, 'npm', sinon.match({
        params: ['install'],
        cwd: '/home/testuser/watchdog',
      }));
    });

    it('should return false if npm install fails', async () => {
      runCommandStub.resolves({ error: new Error('npm install failed') });

      const result = await watchdogService.installWatchdogDependencies();
      expect(result).to.be.false;
    });
  });

  describe('createDefaultConfig tests', () => {
    beforeEach(() => {
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should create default config if it does not exist', async () => {
      sinon.stub(fs, 'stat').rejects(new Error('ENOENT'));
      const writeFileStub = sinon.stub(fs, 'writeFile').resolves();

      const result = await watchdogService.createDefaultConfig();
      expect(result).to.be.true;
      sinon.assert.calledWith(writeFileStub, '/home/testuser/watchdog/config.js', sinon.match.string, 'utf8');
    });

    it('should skip creation if config already exists', async () => {
      sinon.stub(fs, 'stat').resolves({ isFile: () => true });
      const writeFileStub = sinon.stub(fs, 'writeFile');

      const result = await watchdogService.createDefaultConfig();
      expect(result).to.be.true;
      sinon.assert.notCalled(writeFileStub);
    });

    it('should return false if writing config fails', async () => {
      sinon.stub(fs, 'stat').rejects(new Error('ENOENT'));
      sinon.stub(fs, 'writeFile').rejects(new Error('Write failed'));

      const result = await watchdogService.createDefaultConfig();
      expect(result).to.be.false;
    });
  });

  describe('startWatchdog tests', () => {
    beforeEach(() => {
      watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
    });

    it('should start watchdog via pm2 successfully', async () => {
      runCommandStub.resolves({ error: null });

      const result = await watchdogService.startWatchdog();
      expect(result).to.be.true;

      // Should delete any existing watchdog process first (with logError: false)
      sinon.assert.calledWith(runCommandStub, 'pm2', sinon.match({
        params: ['delete', 'watchdog'],
        logError: false,
      }));

      // Should start watchdog with correct params and cwd
      sinon.assert.calledWith(runCommandStub, 'pm2', sinon.match({
        params: sinon.match.array.contains(['start', '/home/testuser/watchdog/watchdog.js', '--name', 'watchdog']),
        cwd: '/home/testuser/watchdog',
      }));

      // Should save pm2 process list
      sinon.assert.calledWith(runCommandStub, 'pm2', sinon.match({ params: ['save'] }));
    });

    it('should return false if pm2 start fails', async () => {
      runCommandStub.onFirstCall().resolves({ error: null }); // delete succeeds
      runCommandStub.onSecondCall().resolves({ error: new Error('pm2 start failed') }); // start fails

      const result = await watchdogService.startWatchdog();
      expect(result).to.be.false;
    });

    it('should still return true if pm2 save fails', async () => {
      runCommandStub.onFirstCall().resolves({ error: null }); // delete
      runCommandStub.onSecondCall().resolves({ error: null }); // start
      runCommandStub.onThirdCall().resolves({ error: new Error('pm2 save failed') }); // save

      const result = await watchdogService.startWatchdog();
      expect(result).to.be.true;
    });
  });

  describe('ensureWatchdogRunning tests', () => {
    describe('on ArcaneOS', () => {
      beforeEach(() => {
        // Simulate ArcaneOS by setting FLUXOS_PATH
        process.env.FLUXOS_PATH = '/opt/flux';
        watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
      });

      afterEach(() => {
        delete process.env.FLUXOS_PATH;
      });

      it('should skip watchdog setup on ArcaneOS', async () => {
        await watchdogService.ensureWatchdogRunning();
        sinon.assert.calledWith(logInfoStub, 'ArcaneOS detected, skipping pm2 watchdog setup (managed by systemd)');
        sinon.assert.notCalled(runCommandStub);
      });
    });

    describe('on Legacy OS', () => {
      beforeEach(() => {
        delete process.env.FLUXOS_PATH;
        watchdogService = proxyquire('../../ZelBack/src/services/watchdogService', {});
      });

      it('should install and start watchdog if not installed', async () => {
        const statStub = sinon.stub(fs, 'stat');
        // isWatchdogInstalled - directory doesn't exist
        statStub.withArgs('/home/testuser/watchdog').rejects(new Error('ENOENT'));
        // cloneWatchdog - check if directory exists (for removal)
        statStub.withArgs('/home/testuser/watchdog').rejects(new Error('ENOENT'));
        // createDefaultConfig - config doesn't exist
        statStub.withArgs('/home/testuser/watchdog/config.js').rejects(new Error('ENOENT'));

        const writeFileStub = sinon.stub(fs, 'writeFile').resolves();
        runCommandStub.resolves({ error: null, stdout: '[]' });

        await watchdogService.ensureWatchdogRunning();

        sinon.assert.calledWith(logInfoStub, 'Legacy OS detected, checking watchdog status...');
        sinon.assert.calledWith(logInfoStub, 'Watchdog is not installed, proceeding with installation...');
      });

      it('should start watchdog if installed but not running (without creating config)', async () => {
        const statStub = sinon.stub(fs, 'stat');
        // isWatchdogInstalled - all exist
        statStub.withArgs('/home/testuser/watchdog').resolves({ isDirectory: () => true });
        statStub.withArgs('/home/testuser/watchdog/package.json').resolves({ isFile: () => true });
        statStub.withArgs('/home/testuser/watchdog/node_modules').resolves({ isDirectory: () => true });

        const writeFileStub = sinon.stub(fs, 'writeFile');

        // isWatchdogRunning - not running
        runCommandStub.withArgs('pm2', sinon.match({ params: ['jlist'] })).resolves({
          stdout: JSON.stringify([{ name: 'flux', pm2_env: { status: 'online' } }]),
          error: null,
        });
        runCommandStub.resolves({ error: null });

        await watchdogService.ensureWatchdogRunning();

        sinon.assert.calledWith(logInfoStub, 'Watchdog is already installed');
        sinon.assert.calledWith(logInfoStub, 'Watchdog is not running, starting it...');
        // Should NOT create config for already installed watchdog
        sinon.assert.notCalled(writeFileStub);
      });

      it('should do nothing if watchdog is installed and running (without creating config)', async () => {
        const statStub = sinon.stub(fs, 'stat');
        // isWatchdogInstalled - all exist
        statStub.withArgs('/home/testuser/watchdog').resolves({ isDirectory: () => true });
        statStub.withArgs('/home/testuser/watchdog/package.json').resolves({ isFile: () => true });
        statStub.withArgs('/home/testuser/watchdog/node_modules').resolves({ isDirectory: () => true });

        const writeFileStub = sinon.stub(fs, 'writeFile');

        // isWatchdogRunning - running
        runCommandStub.withArgs('pm2', sinon.match({ params: ['jlist'] })).resolves({
          stdout: JSON.stringify([{ name: 'watchdog', pm2_env: { status: 'online' } }]),
          error: null,
        });

        await watchdogService.ensureWatchdogRunning();

        sinon.assert.calledWith(logInfoStub, 'Watchdog is already installed');
        sinon.assert.calledWith(logInfoStub, 'Watchdog is already running');
        sinon.assert.calledWith(logInfoStub, 'Watchdog service check completed successfully');
        // Should NOT create config for already installed watchdog
        sinon.assert.notCalled(writeFileStub);
      });
    });
  });
});
