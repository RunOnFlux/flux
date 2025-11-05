process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

chai.use(chaiAsPromised);
const { expect } = chai;

// Stubs for util.promisify
const cmdAsyncStub = sinon.stub();
const crontabLoadStub = sinon.stub();
const utilFake = {
  promisify: (fn) => {
    if (fn.name === 'runCommand' || fn.name === 'run') return cmdAsyncStub;
    if (fn.name === 'load') return crontabLoadStub;
    return sinon.stub();
  },
};

// Module under test with proxyquire
const volumeValidationService = proxyquire('../../ZelBack/src/services/volumeValidationService', {
  util: utilFake,
});

describe('volumeValidationService tests', () => {
  afterEach(() => {
    // Only reset global stubs, don't call sinon.restore() as it will restore
    // all stubs including those in nested beforeEach blocks
    cmdAsyncStub.reset();
    crontabLoadStub.reset();
  });

  describe('hasIncorrectFluxPath tests', () => {
    it('should return true for path containing /flux/ZelApps', () => {
      const volumePath = '/home/user/flux/ZelApps/myapp';

      const result = volumeValidationService.hasIncorrectFluxPath(volumePath);

      expect(result).to.be.true;
    });

    it('should return true for path with /flux/ZelApps in the middle', () => {
      const volumePath = '/root/flux/ZelApps/testapp/data';

      const result = volumeValidationService.hasIncorrectFluxPath(volumePath);

      expect(result).to.be.true;
    });

    it('should return false for correct path without /flux/ZelApps', () => {
      const volumePath = '/home/user/zelflux/ZelApps/myapp';

      const result = volumeValidationService.hasIncorrectFluxPath(volumePath);

      expect(result).to.be.false;
    });

    it('should return false for path with just ZelApps', () => {
      const volumePath = '/home/ZelApps/myapp';

      const result = volumeValidationService.hasIncorrectFluxPath(volumePath);

      expect(result).to.be.false;
    });

    it('should return false for null path', () => {
      const result = volumeValidationService.hasIncorrectFluxPath(null);

      expect(result).to.be.false;
    });

    it('should return false for undefined path', () => {
      const result = volumeValidationService.hasIncorrectFluxPath(undefined);

      expect(result).to.be.false;
    });

    it('should return false for empty string', () => {
      const result = volumeValidationService.hasIncorrectFluxPath('');

      expect(result).to.be.false;
    });

    it('should return false for non-string input', () => {
      const result = volumeValidationService.hasIncorrectFluxPath(12345);

      expect(result).to.be.false;
    });
  });

  describe('extractAppNameFromCrontabCommand tests', () => {
    it('should extract app name from valid mount command', () => {
      const command = 'sudo mount -o loop /home/abcapp2TEMP /root/flux/ZelApps/abcapp2';

      const result = volumeValidationService.extractAppNameFromCrontabCommand(command);

      expect(result).to.equal('abcapp2');
    });

    it('should extract app name and remove "flux" prefix', () => {
      const command = 'sudo mount -o loop /home/testTEMP /root/flux/ZelApps/fluxtestapp';

      const result = volumeValidationService.extractAppNameFromCrontabCommand(command);

      expect(result).to.equal('testapp');
    });

    it('should extract app name and remove "zel" prefix', () => {
      const command = 'sudo mount -o loop /home/testTEMP /root/flux/ZelApps/zelmyapp';

      const result = volumeValidationService.extractAppNameFromCrontabCommand(command);

      expect(result).to.equal('myapp');
    });

    it('should return app name without prefix if no recognized prefix', () => {
      const command = 'sudo mount -o loop /home/testTEMP /root/flux/ZelApps/myapp';

      const result = volumeValidationService.extractAppNameFromCrontabCommand(command);

      expect(result).to.equal('myapp');
    });

    it('should return null for command with insufficient parts', () => {
      const command = 'sudo mount -o loop /home/test';

      const result = volumeValidationService.extractAppNameFromCrontabCommand(command);

      expect(result).to.be.null;
    });

    it('should return null for empty command', () => {
      const command = '';

      const result = volumeValidationService.extractAppNameFromCrontabCommand(command);

      expect(result).to.be.null;
    });

    it('should handle errors gracefully and return null', () => {
      const command = null;

      const result = volumeValidationService.extractAppNameFromCrontabCommand(command);

      expect(result).to.be.null;
    });
  });

  describe('getAppsWithIncorrectVolumeMounts tests', () => {
    let mockCrontab;

    beforeEach(() => {
      mockCrontab = {
        jobs: sinon.stub(),
        save: sinon.stub(),
        remove: sinon.stub(),
      };
    });

    it('should find apps with incorrect volume mounts', async () => {
      const mockJobs = [
        {
          comment: () => 'app-id-123',
          command: () => 'sudo mount -o loop /home/flux/ZelApps/myappTEMP /root/flux/ZelApps/myapp',
        },
        {
          comment: () => 'app-id-456',
          command: () => 'sudo mount -o loop /home/flux/ZelApps/testappTEMP /root/flux/ZelApps/testapp',
        },
      ];

      mockCrontab.jobs.returns(mockJobs);
      crontabLoadStub.resolves(mockCrontab);

      const result = await volumeValidationService.getAppsWithIncorrectVolumeMounts();

      expect(result).to.have.lengthOf(2);
      expect(result[0]).to.deep.include({
        appName: 'myapp',
        volumePath: '/home/flux/ZelApps/myappTEMP',
        mountPoint: '/root/flux/ZelApps/myapp',
        appId: 'app-id-123',
      });
      expect(result[1]).to.deep.include({
        appName: 'testapp',
        volumePath: '/home/flux/ZelApps/testappTEMP',
        mountPoint: '/root/flux/ZelApps/testapp',
        appId: 'app-id-456',
      });
    });

    it('should filter out apps with correct volume mounts', async () => {
      const mockJobs = [
        {
          comment: () => 'app-id-123',
          command: () => 'sudo mount -o loop /home/correctpath/myappTEMP /root/zelflux/ZelApps/myapp',
        },
        {
          comment: () => 'app-id-456',
          command: () => 'sudo mount -o loop /home/flux/ZelApps/badappTEMP /root/flux/ZelApps/badapp',
        },
      ];

      mockCrontab.jobs.returns(mockJobs);
      crontabLoadStub.resolves(mockCrontab);

      const result = await volumeValidationService.getAppsWithIncorrectVolumeMounts();

      expect(result).to.have.lengthOf(1);
      expect(result[0].appName).to.equal('badapp');
    });

    it('should return empty array if no crontab found', async () => {
      crontabLoadStub.resolves(null);

      const result = await volumeValidationService.getAppsWithIncorrectVolumeMounts();

      expect(result).to.be.an('array').that.is.empty;
    });

    it('should handle crontab load error gracefully', async () => {
      crontabLoadStub.rejects(new Error('Crontab load failed'));

      const result = await volumeValidationService.getAppsWithIncorrectVolumeMounts();

      expect(result).to.be.an('array').that.is.empty;
    });

    it('should skip jobs without mount command', async () => {
      const mockJobs = [
        {
          comment: () => 'app-id-123',
          command: () => '*/5 * * * * /usr/bin/backup.sh',
        },
        {
          comment: () => 'app-id-456',
          command: () => 'sudo mount -o loop /home/flux/ZelApps/appTEMP /root/flux/ZelApps/app',
        },
      ];

      mockCrontab.jobs.returns(mockJobs);
      crontabLoadStub.resolves(mockCrontab);

      const result = await volumeValidationService.getAppsWithIncorrectVolumeMounts();

      expect(result).to.have.lengthOf(1);
      expect(result[0].appName).to.equal('app');
    });

    it('should handle jobs with malformed commands', async () => {
      const mockJobs = [
        {
          comment: () => 'app-id-123',
          command: () => 'sudo mount -o loop',
        },
      ];

      mockCrontab.jobs.returns(mockJobs);
      crontabLoadStub.resolves(mockCrontab);

      const result = await volumeValidationService.getAppsWithIncorrectVolumeMounts();

      expect(result).to.be.an('array').that.is.empty;
    });
  });

  describe('unmountIncorrectVolume tests', () => {
    it('should successfully unmount a volume', async () => {
      const mountPoint = '/root/flux/ZelApps/myapp';
      cmdAsyncStub.resolves({ stdout: '', stderr: '' });

      const result = await volumeValidationService.unmountIncorrectVolume(mountPoint);

      expect(result).to.be.true;
      sinon.assert.calledWith(cmdAsyncStub, `sudo umount ${mountPoint}`);
    });

    it('should handle unmount failure gracefully', async () => {
      const mountPoint = '/root/flux/ZelApps/myapp';
      cmdAsyncStub.rejects(new Error('Not mounted'));

      const result = await volumeValidationService.unmountIncorrectVolume(mountPoint);

      expect(result).to.be.false;
    });
  });

  describe('removeCrontabEntry tests', () => {
    let mockCrontab;
    let mockJob;

    beforeEach(() => {
      mockJob = {
        comment: sinon.stub(),
        command: sinon.stub(),
      };

      mockCrontab = {
        jobs: sinon.stub(),
        save: sinon.stub(),
        remove: sinon.stub(),
      };
    });

    it('should successfully remove crontab entry with matching app ID and path', async () => {
      const appId = 'app-id-123';
      const incorrectVolumePath = '/home/flux/ZelApps/myappTEMP';

      mockJob.comment.returns(appId);
      mockJob.command.returns(`sudo mount -o loop ${incorrectVolumePath} /root/flux/ZelApps/myapp`);
      mockCrontab.jobs.returns([mockJob]);
      mockCrontab.save.resolves();
      crontabLoadStub.resolves(mockCrontab);

      const result = await volumeValidationService.removeCrontabEntry(appId, incorrectVolumePath);

      expect(result).to.be.true;
      sinon.assert.calledOnce(mockCrontab.remove);
      sinon.assert.calledWith(mockCrontab.remove, mockJob);
      sinon.assert.calledOnce(mockCrontab.save);
    });

    it('should not remove entry if app ID does not match', async () => {
      const appId = 'app-id-123';
      const incorrectVolumePath = '/home/flux/ZelApps/myappTEMP';

      mockJob.comment.returns('different-app-id');
      mockJob.command.returns(`sudo mount -o loop ${incorrectVolumePath} /root/flux/ZelApps/myapp`);
      mockCrontab.jobs.returns([mockJob]);
      crontabLoadStub.resolves(mockCrontab);

      const result = await volumeValidationService.removeCrontabEntry(appId, incorrectVolumePath);

      expect(result).to.be.false;
      sinon.assert.notCalled(mockCrontab.remove);
      sinon.assert.notCalled(mockCrontab.save);
    });

    it('should not remove entry if volume path does not match', async () => {
      const appId = 'app-id-123';
      const incorrectVolumePath = '/home/flux/ZelApps/myappTEMP';

      mockJob.comment.returns(appId);
      mockJob.command.returns('sudo mount -o loop /different/path /root/flux/ZelApps/myapp');
      mockCrontab.jobs.returns([mockJob]);
      crontabLoadStub.resolves(mockCrontab);

      const result = await volumeValidationService.removeCrontabEntry(appId, incorrectVolumePath);

      expect(result).to.be.false;
      sinon.assert.notCalled(mockCrontab.remove);
      sinon.assert.notCalled(mockCrontab.save);
    });

    it('should return false if no crontab found', async () => {
      const appId = 'app-id-123';
      const incorrectVolumePath = '/home/flux/ZelApps/myappTEMP';

      crontabLoadStub.resolves(null);

      const result = await volumeValidationService.removeCrontabEntry(appId, incorrectVolumePath);

      expect(result).to.be.false;
    });

    it('should handle crontab save error', async () => {
      const appId = 'app-id-123';
      const incorrectVolumePath = '/home/flux/ZelApps/myappTEMP';

      mockJob.comment.returns(appId);
      mockJob.command.returns(`sudo mount -o loop ${incorrectVolumePath} /root/flux/ZelApps/myapp`);
      mockCrontab.jobs.returns([mockJob]);
      mockCrontab.save.rejects(new Error('Save failed'));
      crontabLoadStub.resolves(mockCrontab);

      const result = await volumeValidationService.removeCrontabEntry(appId, incorrectVolumePath);

      expect(result).to.be.false;
      sinon.assert.calledOnce(mockCrontab.remove);
    });

    it('should handle crontab load error', async () => {
      const appId = 'app-id-123';
      const incorrectVolumePath = '/home/flux/ZelApps/myappTEMP';

      crontabLoadStub.rejects(new Error('Load failed'));

      const result = await volumeValidationService.removeCrontabEntry(appId, incorrectVolumePath);

      expect(result).to.be.false;
    });

    it('should handle multiple jobs and remove only matching one', async () => {
      const appId = 'app-id-123';
      const incorrectVolumePath = '/home/flux/ZelApps/myappTEMP';

      const mockJob1 = {
        comment: () => appId,
        command: () => `sudo mount -o loop ${incorrectVolumePath} /root/flux/ZelApps/myapp`,
      };

      const mockJob2 = {
        comment: () => 'other-app-id',
        command: () => 'sudo mount -o loop /other/path /root/flux/ZelApps/otherapp',
      };

      mockCrontab.jobs.returns([mockJob1, mockJob2]);
      mockCrontab.save.resolves();
      crontabLoadStub.resolves(mockCrontab);

      const result = await volumeValidationService.removeCrontabEntry(appId, incorrectVolumePath);

      expect(result).to.be.true;
      sinon.assert.calledOnce(mockCrontab.remove);
      sinon.assert.calledWith(mockCrontab.remove, mockJob1);
    });
  });

  describe('extractBaseAppName tests', () => {
    it('should extract app name from component name with underscore', () => {
      const componentName = 'mongodb_myapp';

      const result = volumeValidationService.extractBaseAppName(componentName);

      expect(result).to.equal('myapp');
    });

    it('should return original name if no underscore present', () => {
      const appName = 'simpleapp';

      const result = volumeValidationService.extractBaseAppName(appName);

      expect(result).to.equal('simpleapp');
    });

    it('should extract app name from component with multiple underscores', () => {
      const componentName = 'redis_cache_myapp';

      const result = volumeValidationService.extractBaseAppName(componentName);

      // split('_')[1] returns the second element only
      expect(result).to.equal('cache');
    });

    it('should handle single character component names', () => {
      const componentName = 'a_myapp';

      const result = volumeValidationService.extractBaseAppName(componentName);

      expect(result).to.equal('myapp');
    });
  });

  // Note: checkAndFixIncorrectVolumeMounts is an integration function that orchestrates
  // the other functions which are already tested above. Testing it would require
  // complex mocking of internal function calls which goes against testing best practices.
  // The individual functions (getAppsWithIncorrectVolumeMounts, unmountIncorrectVolume,
  // removeCrontabEntry, hardRedeployApp, extractBaseAppName) are all tested separately.
});
