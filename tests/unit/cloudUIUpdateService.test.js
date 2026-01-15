const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const { expect } = chai;

describe('cloudUIUpdateService tests', () => {
  let cloudUIUpdateService;
  let fsStub;
  let axiosStub;
  let execStub;
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

    execStub = sinon.stub();

    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  function loadService(envOverrides = {}) {
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
        child_process: { exec: execStub },
        '../lib/log': logStub,
      },
    );

    // Restore original env after loading
    if (originalEnv !== undefined) {
      process.env.FLUXOS_PATH = originalEnv;
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

  describe('checkAndUpdateCloudUI tests', () => {
    describe('on legacy OS (non-ArcaneOS)', () => {
      beforeEach(() => {
        cloudUIUpdateService = loadService({ FLUXOS_PATH: '' });
      });

      it('should run update script if CloudUI folder does not exist', async () => {
        fsStub.existsSync.returns(false);
        execStub.callsFake((cmd, opts, callback) => {
          callback(null, 'success', '');
        });

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.calledOnce(execStub);
        sinon.assert.calledWith(logStub.info, 'CloudUI: Folder missing or empty, installing...');
      });

      it('should run update script if version file does not exist', async () => {
        // First call for cloudUIExists check (directory exists)
        fsStub.existsSync.onCall(0).returns(true);
        fsStub.readdirSync.returns(['index.html', 'version']);
        // Second call for getLocalVersionHash (version file doesn't exist)
        fsStub.existsSync.onCall(1).returns(false);

        execStub.callsFake((cmd, opts, callback) => {
          callback(null, 'success', '');
        });

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.calledOnce(execStub);
        sinon.assert.calledWith(logStub.info, 'CloudUI: No version file found, updating...');
      });

      it('should skip update if remote version info cannot be fetched', async () => {
        fsStub.existsSync.returns(true);
        fsStub.readdirSync.returns(['index.html', 'version']);
        fsStub.readFileSync.returns('localhash123');
        axiosStub.get.rejects(new Error('Network error'));

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.notCalled(execStub);
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

        sinon.assert.notCalled(execStub);
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

        execStub.callsFake((cmd, opts, callback) => {
          // After update, return new hash
          fsStub.readFileSync.returns(remoteHash);
          callback(null, 'Updated successfully', '');
        });

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.calledOnce(execStub);
        sinon.assert.calledWith(logStub.info, 'CloudUI: New version detected, updating...');
      });

      it('should log error if update script fails', async () => {
        fsStub.existsSync.returns(false);
        execStub.callsFake((cmd, opts, callback) => {
          callback(new Error('Script failed'), '', 'error output');
        });

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
        // exec callback throws error
        execStub.callsFake((cmd, opts, callback) => {
          throw new Error('Unexpected exec error');
        });

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.calledOnce(logStub.error);
      });
    });

    describe('on ArcaneOS', () => {
      it('should skip update check on ArcaneOS', async () => {
        cloudUIUpdateService = loadService({ FLUXOS_PATH: '/opt/fluxos' });

        await cloudUIUpdateService.checkAndUpdateCloudUI();

        sinon.assert.notCalled(execStub);
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
