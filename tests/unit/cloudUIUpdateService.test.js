const { EventEmitter } = require('events');
const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const { expect } = chai;

const STUB_API_BASE = 'http://api-base-from-config.invalid';

describe('cloudUIUpdateService tests', () => {
  let cloudUIUpdateService;
  let fsStub;
  let axiosStub;
  let spawnStub;
  let logStub;

  beforeEach(() => {
    fsStub = {
      existsSync: sinon.stub(),
      readdirSync: sinon.stub(),
      readFileSync: sinon.stub(),
    };

    axiosStub = {
      get: sinon.stub(),
    };

    spawnStub = sinon.stub();

    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  // A child process as spawn returns it. It writes its output and closes on the next
  // turn, or when finish() is called if it is told to wait.
  function fakeChild({
    code = 0, signal = null, stdout = '', stderr = '', wait = false,
  } = {}) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.finish = (exitCode = code, exitSignal = signal) => {
      if (stdout) child.stdout.emit('data', stdout);
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', exitCode, exitSignal);
    };
    if (!wait) setImmediate(() => child.finish());

    return child;
  }

  function loadService(envOverrides = {}) {
    // Both halves of the original state, because the variable being ABSENT is
    // one of the two states this switches between. Recording only its value
    // left a load that set it unable to put it back, and the next load then
    // restored the leak faithfully - which reaches every later test file in the
    // run, since process.env outlives the module.
    const hadEnv = 'FLUXOS_PATH' in process.env;
    const originalEnv = process.env.FLUXOS_PATH;

    if (envOverrides.FLUXOS_PATH !== undefined) {
      process.env.FLUXOS_PATH = envOverrides.FLUXOS_PATH;
    } else {
      delete process.env.FLUXOS_PATH;
    }

    const service = proxyquire(
      '../../ZelBack/src/services/cloudUIUpdateService',
      {
        fs: fsStub,
        axios: axiosStub,
        child_process: { spawn: spawnStub },
        // Deliberately NOT the production value: asserting against
        // config.github.apiBaseUrl would pass whether the service read config or kept
        // the hardcoded https://api.github.com, because they are the same string.
        config: { github: { apiBaseUrl: STUB_API_BASE } },
        '../lib/log': logStub,
      },
    );

    // Restore original env after loading
    if (hadEnv) {
      process.env.FLUXOS_PATH = originalEnv;
    } else {
      delete process.env.FLUXOS_PATH;
    }

    return service;
  }

  describe('cloudUIExists tests', () => {
    beforeEach(() => {
      cloudUIUpdateService = loadService();
    });

    it('should return false if CloudUI directory does not exist', () => {
      fsStub.existsSync.returns(false);

      const result = cloudUIUpdateService.cloudUIExists();

      expect(result).to.equal(false);
      sinon.assert.calledOnce(fsStub.existsSync);
    });

    it('should return false if CloudUI directory is empty', () => {
      fsStub.existsSync.returns(true);
      fsStub.readdirSync.returns([]);

      const result = cloudUIUpdateService.cloudUIExists();

      expect(result).to.equal(false);
    });

    it('should return false if CloudUI directory only contains version file', () => {
      fsStub.existsSync.returns(true);
      fsStub.readdirSync.returns(['version']);

      const result = cloudUIUpdateService.cloudUIExists();

      expect(result).to.equal(false);
    });

    it('should return false if CloudUI directory only contains the version and tag files', () => {
      fsStub.existsSync.returns(true);
      fsStub.readdirSync.returns(['tag', 'version']);

      const result = cloudUIUpdateService.cloudUIExists();

      expect(result).to.equal(false);
    });

    it('should return true if CloudUI directory has content files', () => {
      fsStub.existsSync.returns(true);
      fsStub.readdirSync.returns(['index.html', 'version']);

      const result = cloudUIUpdateService.cloudUIExists();

      expect(result).to.equal(true);
    });

    it('should return true if CloudUI directory has a single non-version file', () => {
      fsStub.existsSync.returns(true);
      fsStub.readdirSync.returns(['index.html']);

      const result = cloudUIUpdateService.cloudUIExists();

      expect(result).to.equal(true);
    });

    it('should return false and log error if fs throws', () => {
      fsStub.existsSync.throws(new Error('Permission denied'));

      const result = cloudUIUpdateService.cloudUIExists();

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logStub.error);
    });
  });

  describe('getLocalVersionHash tests', () => {
    beforeEach(() => {
      cloudUIUpdateService = loadService();
    });

    it('should return null if version file does not exist', () => {
      fsStub.existsSync.returns(false);

      const result = cloudUIUpdateService.getLocalVersionHash();

      expect(result).to.equal(null);
    });

    it('should return trimmed hash from version file', () => {
      fsStub.existsSync.returns(true);
      fsStub.readFileSync.returns('abc123def456\n');

      const result = cloudUIUpdateService.getLocalVersionHash();

      expect(result).to.equal('abc123def456');
    });

    it('should return null and log error if reading fails', () => {
      fsStub.existsSync.returns(true);
      fsStub.readFileSync.throws(new Error('Read error'));

      const result = cloudUIUpdateService.getLocalVersionHash();

      expect(result).to.equal(null);
      sinon.assert.calledOnce(logStub.error);
    });
  });

  describe('getLocalVersionTag tests', () => {
    beforeEach(() => {
      cloudUIUpdateService = loadService();
    });

    it('should return null if tag file does not exist', () => {
      fsStub.existsSync.returns(false);

      const result = cloudUIUpdateService.getLocalVersionTag();

      expect(result).to.equal(null);
      sinon.assert.calledWith(fsStub.existsSync, sinon.match(/[\\/]CloudUI[\\/]tag$/));
    });

    it('should return trimmed tag from tag file', () => {
      fsStub.existsSync.returns(true);
      fsStub.readFileSync.returns('v3.20.22\n');

      const result = cloudUIUpdateService.getLocalVersionTag();

      expect(result).to.equal('v3.20.22');
      sinon.assert.calledWith(fsStub.readFileSync, sinon.match(/[\\/]CloudUI[\\/]tag$/));
    });

    it('should return null if tag file is empty', () => {
      fsStub.existsSync.returns(true);
      fsStub.readFileSync.returns('\n');

      const result = cloudUIUpdateService.getLocalVersionTag();

      expect(result).to.equal(null);
    });

    it('should return null and log error if reading fails', () => {
      fsStub.existsSync.returns(true);
      fsStub.readFileSync.throws(new Error('Read error'));

      const result = cloudUIUpdateService.getLocalVersionTag();

      expect(result).to.equal(null);
      sinon.assert.calledOnce(logStub.error);
    });
  });

  describe('getRemoteVersionInfo tests', () => {
    beforeEach(() => {
      cloudUIUpdateService = loadService();
    });

    it('should return hash and tag from valid GitHub release', async () => {
      const mockRelease = {
        data: {
          target_commitish: 'master',
          tag_name: 'v1.2.3',
          assets: [
            {
              name: 'dist.tar.gz',
              digest: 'sha256:abc123def456',
            },
          ],
        },
      };
      axiosStub.get.resolves(mockRelease);

      const result = await cloudUIUpdateService.getRemoteVersionInfo();

      expect(result).to.deep.equal({
        hash: 'abc123def456',
        tag: 'v1.2.3',
      });
    });

    it('should return null if release is not from master branch', async () => {
      const mockRelease = {
        data: {
          target_commitish: 'develop',
          tag_name: 'v1.2.3',
          assets: [],
        },
      };
      axiosStub.get.resolves(mockRelease);

      const result = await cloudUIUpdateService.getRemoteVersionInfo();

      expect(result).to.equal(null);
      sinon.assert.calledOnce(logStub.info);
    });

    it('should return null if no assets in release', async () => {
      const mockRelease = {
        data: {
          target_commitish: 'master',
          tag_name: 'v1.2.3',
          assets: [],
        },
      };
      axiosStub.get.resolves(mockRelease);

      const result = await cloudUIUpdateService.getRemoteVersionInfo();

      expect(result).to.equal(null);
      sinon.assert.calledOnce(logStub.warn);
    });

    it('should return null if dist.tar.gz not found in assets', async () => {
      const mockRelease = {
        data: {
          target_commitish: 'master',
          tag_name: 'v1.2.3',
          assets: [
            { name: 'other-file.zip' },
          ],
        },
      };
      axiosStub.get.resolves(mockRelease);

      const result = await cloudUIUpdateService.getRemoteVersionInfo();

      expect(result).to.equal(null);
      sinon.assert.calledOnce(logStub.warn);
    });

    it('should return null if dist.tar.gz has no digest', async () => {
      const mockRelease = {
        data: {
          target_commitish: 'master',
          tag_name: 'v1.2.3',
          assets: [
            { name: 'dist.tar.gz' },
          ],
        },
      };
      axiosStub.get.resolves(mockRelease);

      const result = await cloudUIUpdateService.getRemoteVersionInfo();

      expect(result).to.equal(null);
      sinon.assert.calledOnce(logStub.warn);
    });

    it('should return null and log error if axios throws', async () => {
      axiosStub.get.rejects(new Error('Network error'));

      const result = await cloudUIUpdateService.getRemoteVersionInfo();

      expect(result).to.equal(null);
      sinon.assert.calledOnce(logStub.error);
    });
  });

  // The script removes the served directory before it copies the new one into
  // place, so two runs at once means the second one's removal lands inside the
  // first one's copy - and the run that wrote the version file is then not the
  // run that wrote the files beside it.
  describe('runUpdateScript tests', () => {
    it('runs one script for two overlapping callers', async () => {
      const service = loadService();
      let finish;
      spawnStub.callsFake(() => {
        const child = fakeChild({ stdout: 'done', wait: true });
        finish = () => child.finish();

        return child;
      });

      const first = service.runUpdateScript();
      const second = service.runUpdateScript();
      finish();

      expect(await first).to.equal(true);
      expect(await second, 'the second caller got its own answer').to.equal(true);
      sinon.assert.calledOnce(spawnStub);
    });

    it('runs again once the one in flight has finished', async () => {
      const service = loadService();
      spawnStub.callsFake(() => fakeChild({ stdout: 'done' }));

      await service.runUpdateScript();
      await service.runUpdateScript();

      sinon.assert.calledTwice(spawnStub);
    });

    // A failed run must not leave the guard set, or nothing can rebuild until
    // the process restarts.
    it('releases the guard when the script fails', async () => {
      const service = loadService();
      spawnStub.callsFake(() => fakeChild({ code: 1, stderr: 'stderr' }));

      expect(await service.runUpdateScript()).to.equal(false);
      expect(await service.runUpdateScript()).to.equal(false);

      sinon.assert.calledTwice(spawnStub);
    });

    it('gives the script no time limit', async () => {
      const service = loadService();
      spawnStub.callsFake(() => fakeChild());

      await service.runUpdateScript();

      expect(spawnStub.firstCall.args[2].timeout).to.equal(undefined);
    });

    it('fails a script that a signal ends, and says which', async () => {
      const service = loadService();
      spawnStub.callsFake(() => fakeChild({ code: null, signal: 'SIGTERM' }));

      expect(await service.runUpdateScript()).to.equal(false);

      sinon.assert.calledWith(logStub.error, 'CloudUI update script killed by SIGTERM');
    });

    it('logs the end of the output and keeps no more than the end of it', async () => {
      const service = loadService();
      spawnStub.callsFake(() => fakeChild({ stdout: `${'x'.repeat(100000)}\nfirst\nlast` }));

      expect(await service.runUpdateScript()).to.equal(true);

      const logged = logStub.info.args.map(([line]) => line).find((line) => line.startsWith('CloudUI update output:'));
      expect(logged).to.match(/first\nlast$/);
      expect(logged.length).to.be.below(5000);
    });

    it('names the watchdog as the owner of CloudUI on ArcaneOS alone', () => {
      expect(loadService({ FLUXOS_PATH: '/dat/usr/lib/fluxos' }).watchdogManagesCloudUI()).to.equal(true);
      expect(loadService().watchdogManagesCloudUI()).to.equal(false);
    });
  });

  describe('checkAndUpdateCloudUI tests', () => {
    describe('on legacy OS (non-ArcaneOS)', () => {
      beforeEach(() => {
        cloudUIUpdateService = loadService({ FLUXOS_PATH: '' });
      });

      it('should run update script if CloudUI folder does not exist', async () => {
        fsStub.existsSync.returns(false);
        spawnStub.callsFake(() => fakeChild({ stdout: 'success' }));

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.calledOnce(spawnStub);
        sinon.assert.calledWith(logStub.info, 'CloudUI: Folder missing or empty, installing...');
        // The endpoint comes from config and is passed to the script. A script left to
        // decide for itself reaches the public internet, which is what this prevents.
        const [file, args] = spawnStub.firstCall.args;
        expect(file).to.equal('npm');
        expect(args).to.eql(['run', 'update:cloudui', '--', STUB_API_BASE]);
      });

      it('should run update script if version file does not exist', async () => {
        // First call for cloudUIExists check (directory exists)
        fsStub.existsSync.onCall(0).returns(true);
        fsStub.readdirSync.returns(['index.html', 'version']);
        // Second call for getLocalVersionHash (version file doesn't exist)
        fsStub.existsSync.onCall(1).returns(false);

        spawnStub.callsFake(() => fakeChild({ stdout: 'success' }));

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.calledOnce(spawnStub);
        sinon.assert.calledWith(logStub.info, 'CloudUI: No version file found, updating...');
      });

      it('should skip update if remote version info cannot be fetched', async () => {
        fsStub.existsSync.returns(true);
        fsStub.readdirSync.returns(['index.html', 'version']);
        fsStub.readFileSync.returns('localhash123');
        axiosStub.get.rejects(new Error('Network error'));

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.notCalled(spawnStub);
        sinon.assert.calledWith(logStub.info, 'CloudUI: Could not fetch remote version info, skipping update check');
      });

      it('should skip update if versions match', async () => {
        const localHash = 'abc123def456';
        fsStub.existsSync.returns(true);
        fsStub.readdirSync.returns(['index.html', 'version']);
        fsStub.readFileSync.returns(localHash);

        const mockRelease = {
          data: {
            target_commitish: 'master',
            tag_name: 'v1.2.3',
            assets: [
              {
                name: 'dist.tar.gz',
                digest: `sha256:${localHash}`,
              },
            ],
          },
        };
        axiosStub.get.resolves(mockRelease);

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.notCalled(spawnStub);
        sinon.assert.calledWith(logStub.info, 'CloudUI: Already up to date');
      });

      it('should run update script if new version is available', async () => {
        const localHash = 'oldhash123';
        const remoteHash = 'newhash456';

        fsStub.existsSync.returns(true);
        fsStub.readdirSync.returns(['index.html', 'version']);
        fsStub.readFileSync.returns(localHash);

        const mockRelease = {
          data: {
            target_commitish: 'master',
            tag_name: 'v1.2.4',
            assets: [
              {
                name: 'dist.tar.gz',
                digest: `sha256:${remoteHash}`,
              },
            ],
          },
        };
        axiosStub.get.resolves(mockRelease);

        spawnStub.callsFake(() => {
          // After update, return new hash
          fsStub.readFileSync.returns(remoteHash);

          return fakeChild({ stdout: 'Updated successfully' });
        });

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.calledOnce(spawnStub);
        sinon.assert.calledWith(logStub.info, 'CloudUI: New version detected, updating...');
      });

      it('should log error if update script fails', async () => {
        fsStub.existsSync.returns(false);
        spawnStub.callsFake(() => fakeChild({ code: 1, stderr: 'error output' }));

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.calledWith(logStub.error, 'CloudUI: Installation failed');
      });

      it('should handle errors gracefully', async () => {
        // CloudUI exists check passes
        fsStub.existsSync.onCall(0).returns(true);
        fsStub.readdirSync.returns(['index.html']);
        // Version file exists
        fsStub.existsSync.onCall(1).returns(true);
        fsStub.readFileSync.returns('localhash');
        // axios throws after getting version info
        axiosStub.get.resolves({
          data: {
            target_commitish: 'master',
            tag_name: 'v1.0.0',
            assets: [{ name: 'dist.tar.gz', digest: 'sha256:newhash' }],
          },
        });
        // the spawn itself throws, before any callback
        spawnStub.callsFake(() => {
          throw new Error('Unexpected exec error');
        });

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.calledOnce(logStub.error);
      });
    });

    describe('startCloudUIUpdateCheck', () => {
      it('returns while the update it started is still running', async () => {
        cloudUIUpdateService = loadService({ FLUXOS_PATH: '' });
        fsStub.existsSync.returns(false);
        let child;
        spawnStub.callsFake(() => {
          child = fakeChild({ wait: true });

          return child;
        });

        expect(cloudUIUpdateService.startCloudUIUpdateCheck()).to.equal(undefined);
        sinon.assert.calledOnce(spawnStub);
        sinon.assert.neverCalledWith(logStub.info, 'CloudUI: Installation completed successfully');

        child.finish();
        await new Promise((resolve) => { setImmediate(resolve); });
        sinon.assert.calledWith(logStub.info, 'CloudUI: Installation completed successfully');
      });
    });

    describe('on ArcaneOS', () => {
      it('should skip update check on ArcaneOS', async () => {
        cloudUIUpdateService = loadService({ FLUXOS_PATH: '/opt/fluxos' });

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.notCalled(spawnStub);
        sinon.assert.notCalled(axiosStub.get);
        sinon.assert.calledWith(logStub.info, 'CloudUI: Running on ArcaneOS, skipping update check (handled by watchdog)');
      });
    });
  });

  describe('isArcaneOS tests', () => {
    it('should be false when FLUXOS_PATH is not set', () => {
      cloudUIUpdateService = loadService();

      expect(cloudUIUpdateService.isArcaneOS).to.equal(false);
    });

    it('should be true when FLUXOS_PATH is set', () => {
      cloudUIUpdateService = loadService({ FLUXOS_PATH: '/opt/fluxos' });

      expect(cloudUIUpdateService.isArcaneOS).to.equal(true);
    });

    it('should be false when FLUXOS_PATH is empty string', () => {
      cloudUIUpdateService = loadService({ FLUXOS_PATH: '' });

      expect(cloudUIUpdateService.isArcaneOS).to.equal(false);
    });
  });
});
