// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// Create mocks for dependencies
const crontabMock = {
  load: sinon.stub(),
};

const logMock = {
  info: sinon.stub(),
  warn: sinon.stub(),
  error: sinon.stub(),
};

const dbHelperMock = {
  databaseConnection: sinon.stub(),
  findInDatabase: sinon.stub(),
};

const dockerServiceMock = {
  getAppIdentifier: sinon.stub(),
};

const volumeServiceMock = {
  ensureAppVolumeMounted: sinon.stub(),
};

const appTamperingDetectionServiceMock = {
  recordEvent: sinon.stub(),
};

// Load module with mocked dependencies
const crontabAndMountsCleanup = proxyquire('../../ZelBack/src/services/appLifecycle/crontabAndMountsCleanup', {
  crontab: crontabMock,
  '../../lib/log': logMock,
  '../dbHelper': dbHelperMock,
  '../dockerService': dockerServiceMock,
  '../utils/volumeService': volumeServiceMock,
  '../appTamperingDetectionService': appTamperingDetectionServiceMock,
});

describe('crontabAndMountsCleanup tests', () => {
  beforeEach(() => {
    // Reset only this file's own stubs (a global sinon.reset() would wipe stub
    // behaviour set up at module load by other test files in the same run)
    crontabMock.load.reset();
    logMock.info.reset();
    logMock.warn.reset();
    logMock.error.reset();
    dbHelperMock.databaseConnection.reset();
    dbHelperMock.findInDatabase.reset();
    dockerServiceMock.getAppIdentifier.reset();
    volumeServiceMock.ensureAppVolumeMounted.reset();
    appTamperingDetectionServiceMock.recordEvent.reset();
    appTamperingDetectionServiceMock.recordEvent.resolves();
  });

  const stubInstalledApps = (apps) => {
    const mockDb = { db: sinon.stub().returns({}) };
    dbHelperMock.databaseConnection.returns(mockDb);
    dbHelperMock.findInDatabase.resolves(apps);
  };

  describe('getInstalledAppIds', () => {
    it('should return empty set when no apps installed', async () => {
      stubInstalledApps([]);

      const result = await crontabAndMountsCleanup.getInstalledAppIds();
      expect(result).to.be.instanceOf(Set);
      expect(result.size).to.equal(0);
    });

    it('should handle legacy apps (version <= 3)', async () => {
      stubInstalledApps([{ name: 'myapp', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');

      const result = await crontabAndMountsCleanup.getInstalledAppIds();
      expect(result.has('fluxmyapp')).to.be.true;
      expect(result.size).to.equal(1);
    });

    it('should handle newer apps with compose (version > 3)', async () => {
      stubInstalledApps([
        {
          name: 'wordpress123',
          version: 4,
          compose: [
            { name: 'wp' },
            { name: 'mysql' },
            { name: 'operator' },
          ],
        },
      ]);
      dockerServiceMock.getAppIdentifier.withArgs('wp_wordpress123').returns('fluxwp_wordpress123');
      dockerServiceMock.getAppIdentifier.withArgs('mysql_wordpress123').returns('fluxmysql_wordpress123');
      dockerServiceMock.getAppIdentifier.withArgs('operator_wordpress123').returns('fluxoperator_wordpress123');

      const result = await crontabAndMountsCleanup.getInstalledAppIds();
      expect(result.has('fluxwp_wordpress123')).to.be.true;
      expect(result.has('fluxmysql_wordpress123')).to.be.true;
      expect(result.has('fluxoperator_wordpress123')).to.be.true;
      expect(result.size).to.equal(3);
    });

    it('should handle database errors gracefully', async () => {
      dbHelperMock.databaseConnection.throws(new Error('DB connection failed'));

      const result = await crontabAndMountsCleanup.getInstalledAppIds();
      expect(result).to.be.instanceOf(Set);
      expect(result.size).to.equal(0);
      expect(logMock.error.called).to.be.true;
    });

    it('should handle null response from database', async () => {
      stubInstalledApps(null);

      const result = await crontabAndMountsCleanup.getInstalledAppIds();
      expect(result.size).to.equal(0);
    });
  });

  describe('isVolumeMountJob', () => {
    it('should match a plain mount command', () => {
      expect(crontabAndMountsCleanup.isVolumeMountJob('sudo mount -o loop /dat/fluxwpFLUXFSVOL /mount/point')).to.be.true;
    });

    it('should match a mount command with wait logic', () => {
      expect(crontabAndMountsCleanup.isVolumeMountJob('while [ ! -f /dat/fluxwpFLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxwpFLUXFSVOL /mount/point')).to.be.true;
    });

    it('should not match unrelated commands', () => {
      expect(crontabAndMountsCleanup.isVolumeMountJob('sudo apt update')).to.be.false;
    });

    it('should not match loop mounts of non-FLUXFSVOL files', () => {
      expect(crontabAndMountsCleanup.isVolumeMountJob('sudo mount -o loop /dat/somefile /mount/point')).to.be.false;
    });
  });

  describe('ensureInstalledAppVolumesMounted', () => {
    it('should mount every installed app volume derived from the DB', async () => {
      stubInstalledApps([
        { name: 'app1', version: 3 },
        { name: 'wordpress123', version: 4, compose: [{ name: 'wp' }] },
      ]);
      dockerServiceMock.getAppIdentifier.withArgs('app1').returns('fluxapp1');
      dockerServiceMock.getAppIdentifier.withArgs('wp_wordpress123').returns('fluxwp_wordpress123');
      volumeServiceMock.ensureAppVolumeMounted.withArgs('fluxapp1').resolves({ mounted: true, alreadyMounted: false });
      volumeServiceMock.ensureAppVolumeMounted.withArgs('fluxwp_wordpress123').resolves({ mounted: true, alreadyMounted: true });

      const result = await crontabAndMountsCleanup.ensureInstalledAppVolumesMounted();

      expect(result.mounted).to.deep.equal(['fluxapp1']);
      expect(result.alreadyMounted).to.deep.equal(['fluxwp_wordpress123']);
      expect(result.failed).to.have.lengthOf(0);
    });

    it('should record a tampering event when a volume cannot be mounted', async () => {
      stubInstalledApps([{ name: 'app1', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('app1').returns('fluxapp1');
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: false, reason: 'volume_file_missing' });

      const result = await crontabAndMountsCleanup.ensureInstalledAppVolumesMounted();

      expect(result.failed).to.deep.equal([{ appId: 'fluxapp1', reason: 'volume_file_missing' }]);
      expect(appTamperingDetectionServiceMock.recordEvent.calledWith('fluxapp1', 'mount_vanished')).to.be.true;
    });
  });

  describe('removeLegacyMountCrontabEntries', () => {
    let mockCrontab;
    let mockJobs;

    const makeJob = (command, comment) => ({
      isValid: () => true,
      command: () => command,
      comment: () => comment,
    });

    beforeEach(() => {
      mockJobs = [];
      mockCrontab = {
        jobs: () => mockJobs,
        remove: sinon.stub(),
        save: sinon.stub(),
      };
      crontabMock.load.callsFake((callback) => callback(null, mockCrontab));
    });

    it('should remove every FLUXFSVOL mount entry, installed or not', async () => {
      const plainJob = makeJob('sudo mount -o loop /dat/fluxapp1FLUXFSVOL /mount/app1', 'fluxapp1');
      const waitJob = makeJob('while [ ! -f /dat/fluxapp2FLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxapp2FLUXFSVOL /mount/app2', 'fluxapp2');
      mockJobs = [plainJob, waitJob];

      const result = await crontabAndMountsCleanup.removeLegacyMountCrontabEntries();

      expect(mockCrontab.remove.calledWith(plainJob)).to.be.true;
      expect(mockCrontab.remove.calledWith(waitJob)).to.be.true;
      expect(result.removed).to.deep.equal(['fluxapp1', 'fluxapp2']);
      expect(mockCrontab.save.called).to.be.true;
    });

    it('should leave non-mount jobs untouched and not save', async () => {
      mockJobs = [makeJob('sudo apt update', 'system-update')];

      const result = await crontabAndMountsCleanup.removeLegacyMountCrontabEntries();

      expect(mockCrontab.remove.called).to.be.false;
      expect(mockCrontab.save.called).to.be.false;
      expect(result.removed).to.have.lengthOf(0);
    });

    it('should handle crontab load errors without throwing', async () => {
      crontabMock.load.callsFake((callback) => callback(new Error('Crontab load failed')));

      const result = await crontabAndMountsCleanup.removeLegacyMountCrontabEntries();

      expect(result.removed).to.have.lengthOf(0);
      expect(logMock.warn.called).to.be.true;
    });

    it('should report a save failure as an error', async () => {
      mockJobs = [makeJob('sudo mount -o loop /dat/fluxapp1FLUXFSVOL /mount/app1', 'fluxapp1')];
      mockCrontab.save.throws(new Error('crontab: permission denied'));

      const result = await crontabAndMountsCleanup.removeLegacyMountCrontabEntries();

      expect(result.errors).to.have.lengthOf(1);
      expect(result.errors[0].error).to.include('permission denied');
    });
  });

  describe('cleanupCrontabAndMounts', () => {
    let mockCrontab;
    let mockJobs;

    beforeEach(() => {
      mockJobs = [];
      mockCrontab = {
        jobs: () => mockJobs,
        remove: sinon.stub(),
        save: sinon.stub(),
      };
      crontabMock.load.callsFake((callback) => callback(null, mockCrontab));
    });

    it('should mount installed app volumes even when the crontab is empty', async () => {
      // the incident regression: the old implementation derived mounts from
      // crontab entries, so a silently emptied crontab meant nothing was ever
      // remounted after a reboot
      stubInstalledApps([{ name: 'myapp', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: true, alreadyMounted: false });
      mockJobs = [];

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(volumeServiceMock.ensureAppVolumeMounted.calledWith('fluxmyapp')).to.be.true;
      expect(result.mounts.mounted).to.include('fluxmyapp');
    });

    it('should mount volumes even when the crontab cannot be loaded at all', async () => {
      stubInstalledApps([{ name: 'myapp', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: true, alreadyMounted: false });
      crontabMock.load.callsFake((callback) => callback(new Error('Crontab load failed')));

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(result.mounts.mounted).to.include('fluxmyapp');
      expect(result.crontab.removed).to.have.lengthOf(0);
    });

    it('should remove legacy mount entries of installed apps too', async () => {
      stubInstalledApps([{ name: 'myapp', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: true, alreadyMounted: true });
      const legacyJob = {
        isValid: () => true,
        command: () => 'while [ ! -f /dat/fluxmyappFLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxmyappFLUXFSVOL /mount/point',
        comment: () => 'fluxmyapp',
      };
      mockJobs = [legacyJob];

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(mockCrontab.remove.calledWith(legacyJob)).to.be.true;
      expect(result.crontab.removed).to.include('fluxmyapp');
      expect(result.mounts.alreadyMounted).to.include('fluxmyapp');
    });

    it('should never remove an app because of crontab state', async () => {
      // the old implementation force-removed apps when a crontab rewrite
      // failed; the new one must take no app-lifecycle action at all
      stubInstalledApps([{ name: 'myapp', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');
      volumeServiceMock.ensureAppVolumeMounted.resolves({ mounted: true, alreadyMounted: true });
      mockJobs = [{
        isValid: () => true,
        command: () => 'sudo mount -o loop /dat/fluxmyappFLUXFSVOL /mount/point',
        comment: () => 'fluxmyapp',
      }];
      mockCrontab.save.throws(new Error('crontab: permission denied'));

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(result.crontab.errors).to.have.lengthOf(1);
      expect(result.mounts.failed).to.have.lengthOf(0);
    });
  });
});
