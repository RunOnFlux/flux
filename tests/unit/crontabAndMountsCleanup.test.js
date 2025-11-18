// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// Create mocks for dependencies
const crontabMock = {
  load: sinon.stub(),
};

const cmdAsyncMock = sinon.stub();

const nodecmdMock = {
  run: (cmd, callback) => {
    cmdAsyncMock(cmd).then((result) => callback(null, result)).catch((err) => callback(err));
  },
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

const appUninstallerMock = {
  removeAppLocally: sinon.stub(),
};

const isPathMountedMock = sinon.stub();

const fsMock = {
  promises: {
    access: sinon.stub(),
    stat: sinon.stub(),
  },
};

// Load module with mocked dependencies
const crontabAndMountsCleanup = proxyquire('../../ZelBack/src/services/appLifecycle/crontabAndMountsCleanup', {
  crontab: crontabMock,
  'node-cmd': nodecmdMock,
  '../../lib/log': logMock,
  '../dbHelper': dbHelperMock,
  '../dockerService': dockerServiceMock,
  './appUninstaller': appUninstallerMock,
  '../appMonitoring/syncthingFolderStateMachine': { isPathMounted: isPathMountedMock },
  'node:fs': fsMock,
});

describe('crontabAndMountsCleanup tests', () => {
  beforeEach(() => {
    // Reset all stubs before each test
    sinon.reset();
    crontabMock.load.reset();
    cmdAsyncMock.reset();
    logMock.info.reset();
    logMock.warn.reset();
    logMock.error.reset();
    dbHelperMock.databaseConnection.reset();
    dbHelperMock.findInDatabase.reset();
    dockerServiceMock.getAppIdentifier.reset();
    appUninstallerMock.removeAppLocally.reset();
    isPathMountedMock.reset();
    fsMock.promises.access.reset();
    fsMock.promises.stat.reset();
  });

  describe('extractAppNameFromAppId', () => {
    it('should extract app name from simple app id', () => {
      const result = crontabAndMountsCleanup.extractAppNameFromAppId('fluxmyapp');
      expect(result).to.equal('myapp');
    });

    it('should extract app name from component app id', () => {
      const result = crontabAndMountsCleanup.extractAppNameFromAppId('fluxwp_wordpress123');
      expect(result).to.equal('wordpress123');
    });

    it('should handle multiple underscores in app name', () => {
      const result = crontabAndMountsCleanup.extractAppNameFromAppId('fluxmysql_my_app_name');
      expect(result).to.equal('my_app_name');
    });

    it('should handle app id without underscore', () => {
      const result = crontabAndMountsCleanup.extractAppNameFromAppId('fluxsimpleapp');
      expect(result).to.equal('simpleapp');
    });
  });

  describe('hasWaitLogic', () => {
    it('should return true for command with wait logic', () => {
      const command = 'while [ ! -f /dat/fluxwpFLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxwpFLUXFSVOL /mount/point';
      const result = crontabAndMountsCleanup.hasWaitLogic(command);
      expect(result).to.be.true;
    });

    it('should return false for command without wait logic', () => {
      const command = 'sudo mount -o loop /dat/fluxwpFLUXFSVOL /mount/point';
      const result = crontabAndMountsCleanup.hasWaitLogic(command);
      expect(result).to.be.false;
    });

    it('should return false for partially matching command', () => {
      const command = 'while [ ! -f /dat/fluxwpFLUXFSVOL ]; sudo mount -o loop /dat/fluxwpFLUXFSVOL /mount/point';
      const result = crontabAndMountsCleanup.hasWaitLogic(command);
      expect(result).to.be.false;
    });
  });

  describe('extractVolumeFile', () => {
    it('should extract volume file from simple mount command', () => {
      const command = 'sudo mount -o loop /dat/fluxwpFLUXFSVOL /mount/point';
      const result = crontabAndMountsCleanup.extractVolumeFile(command);
      expect(result).to.equal('/dat/fluxwpFLUXFSVOL');
    });

    it('should extract volume file from command with wait logic', () => {
      const command = 'while [ ! -f /dat/fluxwp_wordpress123FLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxwp_wordpress123FLUXFSVOL /mount/point';
      const result = crontabAndMountsCleanup.extractVolumeFile(command);
      expect(result).to.equal('/dat/fluxwp_wordpress123FLUXFSVOL');
    });

    it('should return null for command without FLUXFSVOL', () => {
      const command = 'sudo mount -o loop /dat/somefile /mount/point';
      const result = crontabAndMountsCleanup.extractVolumeFile(command);
      expect(result).to.be.null;
    });

    it('should handle different volume paths', () => {
      const command = 'sudo mount -o loop /home/user/zelflux/appvolumes/fluxappFLUXFSVOL /path/to/mount';
      const result = crontabAndMountsCleanup.extractVolumeFile(command);
      expect(result).to.equal('/home/user/zelflux/appvolumes/fluxappFLUXFSVOL');
    });
  });

  describe('extractMountPoint', () => {
    it('should extract mount point from simple command', () => {
      const command = 'sudo mount -o loop /dat/fluxwpFLUXFSVOL /dat/var/lib/fluxos/flux-apps/fluxwp';
      const result = crontabAndMountsCleanup.extractMountPoint(command);
      expect(result).to.equal('/dat/var/lib/fluxos/flux-apps/fluxwp');
    });

    it('should extract mount point from command with wait logic', () => {
      const command = 'while [ ! -f /dat/fluxwpFLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxwpFLUXFSVOL /dat/var/lib/fluxos/flux-apps/fluxwp';
      const result = crontabAndMountsCleanup.extractMountPoint(command);
      expect(result).to.equal('/dat/var/lib/fluxos/flux-apps/fluxwp');
    });

    it('should return null for invalid command', () => {
      const command = 'sudo mount -o loop /dat/somefile';
      const result = crontabAndMountsCleanup.extractMountPoint(command);
      expect(result).to.be.null;
    });
  });

  describe('extractAppIdFromJob', () => {
    it('should extract appId from comment if it contains flux', () => {
      const comment = 'fluxwp_wordpress123';
      const command = 'sudo mount -o loop /dat/fluxwp_wordpress123FLUXFSVOL /mount/point';
      const result = crontabAndMountsCleanup.extractAppIdFromJob(comment, command);
      expect(result).to.equal('fluxwp_wordpress123');
    });

    it('should extract appId from command if comment does not contain flux', () => {
      const comment = 'someotherjob';
      const command = 'sudo mount -o loop /dat/fluxwp_wordpress123FLUXFSVOL /mount/point';
      const result = crontabAndMountsCleanup.extractAppIdFromJob(comment, command);
      expect(result).to.equal('fluxwp_wordpress123');
    });

    it('should return null if cannot extract appId', () => {
      const comment = 'otherjob';
      const command = 'some other command without FLUXFSVOL pattern';
      const result = crontabAndMountsCleanup.extractAppIdFromJob(comment, command);
      expect(result).to.be.null;
    });

    it('should prefer comment over command extraction', () => {
      const comment = 'fluxmysql_app1';
      const command = 'sudo mount -o loop /dat/fluxwp_app2FLUXFSVOL /mount/point';
      const result = crontabAndMountsCleanup.extractAppIdFromJob(comment, command);
      expect(result).to.equal('fluxmysql_app1');
    });
  });

  describe('addWaitLogicToCommand', () => {
    it('should add wait logic to simple mount command', () => {
      const oldCommand = 'sudo mount -o loop /dat/fluxwpFLUXFSVOL /dat/var/lib/fluxos/flux-apps/fluxwp';
      const result = crontabAndMountsCleanup.addWaitLogicToCommand(oldCommand);
      expect(result).to.equal('while [ ! -f /dat/fluxwpFLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxwpFLUXFSVOL /dat/var/lib/fluxos/flux-apps/fluxwp');
    });

    it('should return original command if volume file cannot be extracted', () => {
      const oldCommand = 'sudo mount /dat/somefile /mount/point';
      const result = crontabAndMountsCleanup.addWaitLogicToCommand(oldCommand);
      expect(result).to.equal(oldCommand);
      expect(logMock.warn.called).to.be.true;
    });

    it('should return original command if mount point cannot be extracted', () => {
      const oldCommand = 'sudo mount -o loop /dat/fluxwpFLUXFSVOL';
      const result = crontabAndMountsCleanup.addWaitLogicToCommand(oldCommand);
      expect(result).to.equal(oldCommand);
      expect(logMock.warn.called).to.be.true;
    });
  });

  describe('getInstalledAppIds', () => {
    it('should return empty set when no apps installed', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([]);

      const result = await crontabAndMountsCleanup.getInstalledAppIds();
      expect(result).to.be.instanceOf(Set);
      expect(result.size).to.equal(0);
    });

    it('should handle legacy apps (version <= 3)', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([
        { name: 'myapp', version: 3 },
      ]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');

      const result = await crontabAndMountsCleanup.getInstalledAppIds();
      expect(result.has('fluxmyapp')).to.be.true;
      expect(result.size).to.equal(1);
    });

    it('should handle newer apps with compose (version > 3)', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([
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
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves(null);

      const result = await crontabAndMountsCleanup.getInstalledAppIds();
      expect(result.size).to.equal(0);
    });
  });

  describe('ensureAppMounted', () => {
    it('should return success if already mounted', async () => {
      isPathMountedMock.resolves(true);

      const result = await crontabAndMountsCleanup.ensureAppMounted(
        'fluxwp_app1',
        '/dat/fluxwp_app1FLUXFSVOL',
        '/mount/point',
      );

      expect(result.mounted).to.be.true;
      expect(result.error).to.be.null;
      expect(logMock.info.calledWithMatch(/already mounted/)).to.be.true;
    });

    it('should return error if volume file does not exist', async () => {
      isPathMountedMock.resolves(false);
      fsMock.promises.access.rejects(new Error('ENOENT'));

      const result = await crontabAndMountsCleanup.ensureAppMounted(
        'fluxwp_app1',
        '/dat/fluxwp_app1FLUXFSVOL',
        '/mount/point',
      );

      expect(result.mounted).to.be.false;
      expect(result.error).to.equal('Volume file does not exist');
    });

    it('should create mount point if it does not exist', async () => {
      isPathMountedMock.resolves(false);
      fsMock.promises.access.resolves();
      fsMock.promises.stat.rejects(new Error('ENOENT'));
      cmdAsyncMock.resolves('');

      const result = await crontabAndMountsCleanup.ensureAppMounted(
        'fluxwp_app1',
        '/dat/fluxwp_app1FLUXFSVOL',
        '/mount/point',
      );

      expect(result.mounted).to.be.true;
      expect(cmdAsyncMock.calledWithMatch(/sudo mkdir -p/)).to.be.true;
      expect(cmdAsyncMock.calledWithMatch(/sudo mount -o loop/)).to.be.true;
    });

    it('should execute mount command successfully', async () => {
      isPathMountedMock.resolves(false);
      fsMock.promises.access.resolves();
      fsMock.promises.stat.resolves({ isDirectory: () => true });
      cmdAsyncMock.resolves('');

      const result = await crontabAndMountsCleanup.ensureAppMounted(
        'fluxwp_app1',
        '/dat/fluxwp_app1FLUXFSVOL',
        '/mount/point',
      );

      expect(result.mounted).to.be.true;
      expect(result.error).to.be.null;
      expect(cmdAsyncMock.calledWith('sudo mount -o loop /dat/fluxwp_app1FLUXFSVOL /mount/point')).to.be.true;
    });

    it('should return error if mount command fails', async () => {
      isPathMountedMock.resolves(false);
      fsMock.promises.access.resolves();
      fsMock.promises.stat.resolves({ isDirectory: () => true });
      cmdAsyncMock.rejects(new Error('mount: permission denied'));

      const result = await crontabAndMountsCleanup.ensureAppMounted(
        'fluxwp_app1',
        '/dat/fluxwp_app1FLUXFSVOL',
        '/mount/point',
      );

      expect(result.mounted).to.be.false;
      expect(result.error).to.include('mount: permission denied');
    });

    it('should return error if mount point is not a directory', async () => {
      isPathMountedMock.resolves(false);
      fsMock.promises.access.resolves();
      fsMock.promises.stat.resolves({ isDirectory: () => false });

      const result = await crontabAndMountsCleanup.ensureAppMounted(
        'fluxwp_app1',
        '/dat/fluxwp_app1FLUXFSVOL',
        '/mount/point',
      );

      expect(result.mounted).to.be.false;
      expect(result.error).to.include('not a directory');
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
        create: sinon.stub(),
        save: sinon.stub(),
      };
      crontabMock.load.callsFake((callback) => callback(null, mockCrontab));
    });

    it('should return empty results when no crontab jobs', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([]);
      mockJobs = [];

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(result.crontab.updated).to.have.lengthOf(0);
      expect(result.crontab.removed).to.have.lengthOf(0);
      expect(result.crontab.unchanged).to.have.lengthOf(0);
      expect(result.mounts.mounted).to.have.lengthOf(0);
    });

    it('should remove jobs for uninstalled apps', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([]); // No apps installed

      const oldJob = {
        isValid: () => true,
        command: () => 'sudo mount -o loop /dat/fluxwp_oldappFLUXFSVOL /mount/point',
        comment: () => 'fluxwp_oldapp',
      };
      mockJobs = [oldJob];

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(mockCrontab.remove.calledWith(oldJob)).to.be.true;
      expect(result.crontab.removed).to.include('fluxwp_oldapp');
      expect(mockCrontab.save.called).to.be.true;
    });

    it('should update jobs without wait logic', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([{ name: 'myapp', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');

      const oldJob = {
        isValid: () => true,
        command: () => 'sudo mount -o loop /dat/fluxmyappFLUXFSVOL /mount/point',
        comment: () => 'fluxmyapp',
      };
      mockJobs = [oldJob];

      const newJob = { isValid: () => true };
      mockCrontab.create.returns(newJob);

      isPathMountedMock.resolves(true); // Already mounted

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(mockCrontab.remove.calledWith(oldJob)).to.be.true;
      expect(mockCrontab.create.calledWithMatch(/while \[ ! -f/, '@reboot', 'fluxmyapp')).to.be.true;
      expect(result.crontab.updated).to.include('fluxmyapp');
      expect(mockCrontab.save.called).to.be.true;
    });

    it('should keep jobs that already have wait logic', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([{ name: 'myapp', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');

      const goodJob = {
        isValid: () => true,
        command: () => 'while [ ! -f /dat/fluxmyappFLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxmyappFLUXFSVOL /mount/point',
        comment: () => 'fluxmyapp',
      };
      mockJobs = [goodJob];

      isPathMountedMock.resolves(true);

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(mockCrontab.remove.called).to.be.false;
      expect(mockCrontab.create.called).to.be.false;
      expect(result.crontab.unchanged).to.include('fluxmyapp');
      expect(mockCrontab.save.called).to.be.false; // No changes, no save
    });

    it('should uninstall app if crontab update fails', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([{ name: 'myapp', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');

      const oldJob = {
        isValid: () => true,
        command: () => 'sudo mount -o loop /dat/fluxmyappFLUXFSVOL /mount/point',
        comment: () => 'fluxmyapp',
      };
      mockJobs = [oldJob];

      // Create returns invalid job
      mockCrontab.create.returns({ isValid: () => false });
      appUninstallerMock.removeAppLocally.resolves();

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(appUninstallerMock.removeAppLocally.calledWith('myapp', null, true, false, true)).to.be.true;
      expect(result.crontab.errors).to.have.lengthOf(1);
      expect(result.crontab.errors[0].action).to.equal('update');
    });

    it('should verify and create missing mounts', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([{ name: 'myapp', version: 3 }]);
      dockerServiceMock.getAppIdentifier.withArgs('myapp').returns('fluxmyapp');

      const goodJob = {
        isValid: () => true,
        command: () => 'while [ ! -f /dat/fluxmyappFLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxmyappFLUXFSVOL /mount/point',
        comment: () => 'fluxmyapp',
      };
      mockJobs = [goodJob];

      // First call: not mounted (for ensureAppMounted check)
      // Second call: mounted (for result verification)
      isPathMountedMock.onFirstCall().resolves(false);
      isPathMountedMock.onSecondCall().resolves(true);
      fsMock.promises.access.resolves();
      fsMock.promises.stat.resolves({ isDirectory: () => true });
      cmdAsyncMock.resolves('');

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(result.mounts.mounted).to.include('fluxmyapp');
      expect(cmdAsyncMock.calledWithMatch(/sudo mount -o loop/)).to.be.true;
    });

    it('should handle multiple apps correctly', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([
        { name: 'app1', version: 3 },
        { name: 'app2', version: 3 },
      ]);
      dockerServiceMock.getAppIdentifier.withArgs('app1').returns('fluxapp1');
      dockerServiceMock.getAppIdentifier.withArgs('app2').returns('fluxapp2');

      const job1 = {
        isValid: () => true,
        command: () => 'sudo mount -o loop /dat/fluxapp1FLUXFSVOL /mount/app1',
        comment: () => 'fluxapp1',
      };
      const job2 = {
        isValid: () => true,
        command: () => 'while [ ! -f /dat/fluxapp2FLUXFSVOL ]; do sleep 5; done && sudo mount -o loop /dat/fluxapp2FLUXFSVOL /mount/app2',
        comment: () => 'fluxapp2',
      };
      const job3Stale = {
        isValid: () => true,
        command: () => 'sudo mount -o loop /dat/fluxoldappFLUXFSVOL /mount/oldapp',
        comment: () => 'fluxoldapp',
      };
      mockJobs = [job1, job2, job3Stale];

      const newJob = { isValid: () => true };
      mockCrontab.create.returns(newJob);
      isPathMountedMock.resolves(true);

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(result.crontab.updated).to.include('fluxapp1'); // Updated (no wait logic)
      expect(result.crontab.unchanged).to.include('fluxapp2'); // Unchanged (already has wait logic)
      expect(result.crontab.removed).to.include('fluxoldapp'); // Removed (not installed)
      expect(mockCrontab.save.called).to.be.true;
    });

    it('should skip non-mount jobs', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([]);

      const nonMountJob = {
        isValid: () => true,
        command: () => 'sudo apt update',
        comment: () => 'system-update',
      };
      mockJobs = [nonMountJob];

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(mockCrontab.remove.called).to.be.false;
      expect(result.crontab.removed).to.have.lengthOf(0);
    });

    it('should handle crontab load errors', async () => {
      crontabMock.load.callsFake((callback) => callback(new Error('Crontab load failed')));

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(result.crontab.errors).to.have.lengthOf(1);
      expect(logMock.error.called).to.be.true;
    });

    it('should skip invalid jobs', async () => {
      const mockDb = { db: sinon.stub().returns({}) };
      dbHelperMock.databaseConnection.returns(mockDb);
      dbHelperMock.findInDatabase.resolves([]);

      const invalidJob = {
        isValid: () => false,
        command: () => 'sudo mount -o loop /dat/fluxappFLUXFSVOL /mount/point',
        comment: () => 'fluxapp',
      };
      mockJobs = [invalidJob];

      const result = await crontabAndMountsCleanup.cleanupCrontabAndMounts();

      expect(mockCrontab.remove.called).to.be.false;
      expect(result.crontab.removed).to.have.lengthOf(0);
    });
  });
});
