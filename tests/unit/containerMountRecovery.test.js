const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('containerMountRecovery tests', () => {
  let containerMountRecovery;
  let logStub;
  let dockerServiceStub;
  let serviceHelperStub;
  let fsStub;

  beforeEach(() => {
    // Log stub
    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    // Docker service stub
    dockerServiceStub = {
      dockerContainerInspect: sinon.stub(),
      dockerListContainers: sinon.stub(),
      appDockerRestart: sinon.stub(),
    };

    // Service helper stub
    serviceHelperStub = {
      delay: sinon.stub().resolves(),
    };

    // Filesystem stub
    fsStub = {
      stat: sinon.stub(),
    };

    // Load module with stubs
    containerMountRecovery = proxyquire('../../ZelBack/src/services/appLifecycle/containerMountRecovery', {
      '../../lib/log': logStub,
      '../dockerService': dockerServiceStub,
      '../serviceHelper': serviceHelperStub,
      fs: {
        promises: fsStub,
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('containerStartedBeforeMounts', () => {
    it('should return false if container is not running', async () => {
      const containerInfo = {
        State: {
          Running: false,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [],
      };

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);

      const result = await containerMountRecovery.containerStartedBeforeMounts('testContainer');

      expect(result).to.equal(false);
    });

    it('should return false if container has no mounts', async () => {
      const containerInfo = {
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [],
      };

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);

      const result = await containerMountRecovery.containerStartedBeforeMounts('testContainer');

      expect(result).to.equal(false);
    });

    it('should return true if container started before mount was created', async () => {
      const containerStartTime = '2024-01-01T10:00:00Z';
      const mountCreationTime = new Date('2024-01-01T10:05:00Z'); // 5 minutes after container start

      const containerInfo = {
        State: {
          Running: true,
          StartedAt: containerStartTime,
        },
        Mounts: [
          {
            Source: '/path/to/mount',
            Destination: '/app/data',
          },
        ],
      };

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);
      fsStub.stat.resolves({
        birthtime: mountCreationTime,
        mtime: mountCreationTime,
      });

      const result = await containerMountRecovery.containerStartedBeforeMounts('testContainer');

      expect(result).to.equal(true);
      expect(logStub.info.calledOnce).to.equal(true);
    });

    it('should return false if container started after mount was created', async () => {
      const containerStartTime = '2024-01-01T10:05:00Z';
      const mountCreationTime = new Date('2024-01-01T10:00:00Z'); // 5 minutes before container start

      const containerInfo = {
        State: {
          Running: true,
          StartedAt: containerStartTime,
        },
        Mounts: [
          {
            Source: '/path/to/mount',
            Destination: '/app/data',
          },
        ],
      };

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);
      fsStub.stat.resolves({
        birthtime: mountCreationTime,
        mtime: mountCreationTime,
      });

      const result = await containerMountRecovery.containerStartedBeforeMounts('testContainer');

      expect(result).to.equal(false);
    });

    it('should return true if mount path does not exist', async () => {
      const containerInfo = {
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [
          {
            Source: '/path/to/nonexistent/mount',
            Destination: '/app/data',
          },
        ],
      };

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);
      fsStub.stat.rejects(new Error('ENOENT: no such file or directory'));

      const result = await containerMountRecovery.containerStartedBeforeMounts('testContainer');

      expect(result).to.equal(true);
      expect(logStub.warn.calledOnce).to.equal(true);
    });

    it('should check multiple mounts and return true if any started before mount', async () => {
      const containerStartTime = '2024-01-01T10:00:00Z';
      const mount1Time = new Date('2024-01-01T09:00:00Z'); // Before container start
      const mount2Time = new Date('2024-01-01T10:05:00Z'); // After container start

      const containerInfo = {
        State: {
          Running: true,
          StartedAt: containerStartTime,
        },
        Mounts: [
          {
            Source: '/path/to/mount1',
            Destination: '/app/data1',
          },
          {
            Source: '/path/to/mount2',
            Destination: '/app/data2',
          },
        ],
      };

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);
      fsStub.stat.onFirstCall().resolves({
        birthtime: mount1Time,
        mtime: mount1Time,
      });
      fsStub.stat.onSecondCall().resolves({
        birthtime: mount2Time,
        mtime: mount2Time,
      });

      const result = await containerMountRecovery.containerStartedBeforeMounts('testContainer');

      expect(result).to.equal(true);
    });

    it('should skip mounts without Source path', async () => {
      const containerInfo = {
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [
          {
            Source: null,
            Destination: '/app/data',
          },
        ],
      };

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);

      const result = await containerMountRecovery.containerStartedBeforeMounts('testContainer');

      expect(result).to.equal(false);
      expect(fsStub.stat.called).to.equal(false);
    });

    it('should return false on error and log error', async () => {
      dockerServiceStub.dockerContainerInspect.rejects(new Error('Container not found'));

      const result = await containerMountRecovery.containerStartedBeforeMounts('testContainer');

      expect(result).to.equal(false);
      expect(logStub.error.calledOnce).to.equal(true);
    });

    it('should use mtime if birthtime is not available', async () => {
      const containerStartTime = '2024-01-01T10:00:00Z';
      const mountTime = new Date('2024-01-01T10:05:00Z');

      const containerInfo = {
        State: {
          Running: true,
          StartedAt: containerStartTime,
        },
        Mounts: [
          {
            Source: '/path/to/mount',
            Destination: '/app/data',
          },
        ],
      };

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);
      fsStub.stat.resolves({
        birthtime: null,
        mtime: mountTime,
      });

      const result = await containerMountRecovery.containerStartedBeforeMounts('testContainer');

      expect(result).to.equal(true);
    });
  });

  describe('getContainersNeedingRestart', () => {
    it('should return empty array if no containers are running', async () => {
      dockerServiceStub.dockerListContainers.resolves([]);

      const result = await containerMountRecovery.getContainersNeedingRestart();

      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
      expect(logStub.info.calledWith('containerMountRecovery - No running containers found')).to.equal(true);
    });

    it('should filter only Flux containers (starting with /flux or /zel)', async () => {
      const containers = [
        {
          Id: 'abc123',
          Names: ['/fluxApp1'],
        },
        {
          Id: 'def456',
          Names: ['/zelApp2'],
        },
        {
          Id: 'ghi789',
          Names: ['/otherContainer'],
        },
      ];

      dockerServiceStub.dockerListContainers.resolves(containers);

      // Mock containerStartedBeforeMounts to return false
      const containerInfo = {
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [],
      };
      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);

      await containerMountRecovery.getContainersNeedingRestart();

      // Should only check flux and zel containers (2 calls)
      expect(dockerServiceStub.dockerContainerInspect.callCount).to.equal(2);
    });

    it('should return containers that need restart', async () => {
      const containers = [
        {
          Id: 'abc123',
          Names: ['/fluxApp1'],
        },
        {
          Id: 'def456',
          Names: ['/fluxApp2'],
        },
      ];

      dockerServiceStub.dockerListContainers.resolves(containers);

      // First container needs restart, second doesn't
      const containerInfo1 = {
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [
          {
            Source: '/path/to/mount1',
            Destination: '/app/data',
          },
        ],
      };

      const containerInfo2 = {
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [],
      };

      dockerServiceStub.dockerContainerInspect.onFirstCall().resolves(containerInfo1);
      dockerServiceStub.dockerContainerInspect.onSecondCall().resolves(containerInfo2);

      fsStub.stat.resolves({
        birthtime: new Date('2024-01-01T10:05:00Z'),
        mtime: new Date('2024-01-01T10:05:00Z'),
      });

      const result = await containerMountRecovery.getContainersNeedingRestart();

      expect(result).to.be.an('array');
      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('fluxApp1');
      expect(result[0].id).to.equal('abc123');
    });

    it('should skip containers that throw errors during check', async () => {
      const containers = [
        {
          Id: 'abc123',
          Names: ['/fluxApp1'],
        },
        {
          Id: 'def456',
          Names: ['/fluxApp2'],
        },
      ];

      dockerServiceStub.dockerListContainers.resolves(containers);
      dockerServiceStub.dockerContainerInspect.onFirstCall().rejects(new Error('Container error'));
      dockerServiceStub.dockerContainerInspect.onSecondCall().resolves({
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [],
      });

      const result = await containerMountRecovery.getContainersNeedingRestart();

      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
      expect(logStub.error.called).to.equal(true);
    });

    it('should return empty array on dockerListContainers error', async () => {
      dockerServiceStub.dockerListContainers.rejects(new Error('Docker error'));

      const result = await containerMountRecovery.getContainersNeedingRestart();

      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
      expect(logStub.error.called).to.equal(true);
    });
  });

  describe('restartContainersWithProperMounts', () => {
    it('should return empty results if no containers provided', async () => {
      const result = await containerMountRecovery.restartContainersWithProperMounts([]);

      expect(result).to.deep.equal({
        restarted: [],
        failed: [],
      });
    });

    it('should restart containers successfully', async () => {
      const containers = [
        { id: 'abc123', name: 'fluxApp1' },
        { id: 'def456', name: 'fluxApp2' },
      ];

      dockerServiceStub.appDockerRestart.resolves();

      const result = await containerMountRecovery.restartContainersWithProperMounts(containers);

      expect(result.restarted).to.have.length(2);
      expect(result.restarted).to.include('fluxApp1');
      expect(result.restarted).to.include('fluxApp2');
      expect(result.failed).to.have.length(0);
      expect(dockerServiceStub.appDockerRestart.callCount).to.equal(2);
      expect(serviceHelperStub.delay.callCount).to.equal(2);
    });

    it('should handle restart failures', async () => {
      const containers = [
        { id: 'abc123', name: 'fluxApp1' },
        { id: 'def456', name: 'fluxApp2' },
      ];

      dockerServiceStub.appDockerRestart.onFirstCall().rejects(new Error('Restart failed'));
      dockerServiceStub.appDockerRestart.onSecondCall().resolves();

      const result = await containerMountRecovery.restartContainersWithProperMounts(containers);

      expect(result.restarted).to.have.length(1);
      expect(result.restarted).to.include('fluxApp2');
      expect(result.failed).to.have.length(1);
      expect(result.failed[0].name).to.equal('fluxApp1');
      expect(result.failed[0].error).to.equal('Restart failed');
    });

    it('should add delay between restarts', async () => {
      const containers = [
        { id: 'abc123', name: 'fluxApp1' },
      ];

      dockerServiceStub.appDockerRestart.resolves();

      await containerMountRecovery.restartContainersWithProperMounts(containers);

      expect(serviceHelperStub.delay.calledWith(2000)).to.equal(true);
    });
  });

  describe('performContainerMountRecovery', () => {
    it('should return early if no containers need restart', async () => {
      dockerServiceStub.dockerListContainers.resolves([]);

      const result = await containerMountRecovery.performContainerMountRecovery();

      expect(result).to.deep.equal({
        containersChecked: 0,
        containersNeedingRestart: 0,
        restartResults: null,
      });
      expect(dockerServiceStub.appDockerRestart.called).to.equal(false);
    });

    it('should restart containers that need it and return results', async () => {
      const containers = [
        {
          Id: 'abc123',
          Names: ['/fluxApp1'],
        },
      ];

      dockerServiceStub.dockerListContainers.resolves(containers);

      const containerInfo = {
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [
          {
            Source: '/path/to/mount',
            Destination: '/app/data',
          },
        ],
      };

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);
      fsStub.stat.resolves({
        birthtime: new Date('2024-01-01T10:05:00Z'),
        mtime: new Date('2024-01-01T10:05:00Z'),
      });
      dockerServiceStub.appDockerRestart.resolves();

      const result = await containerMountRecovery.performContainerMountRecovery();

      expect(result.containersNeedingRestart).to.equal(1);
      expect(result.restartResults).to.exist;
      expect(result.restartResults.restarted).to.have.length(1);
      expect(result.restartResults.restarted[0]).to.equal('fluxApp1');
      expect(result.restartResults.failed).to.have.length(0);
    });

    it('should handle docker list error gracefully and return empty results', async () => {
      dockerServiceStub.dockerListContainers.rejects(new Error('Critical docker error'));

      const result = await containerMountRecovery.performContainerMountRecovery();

      expect(result.containersNeedingRestart).to.equal(0);
      expect(result.restartResults).to.equal(null);
      expect(logStub.error.called).to.equal(true);
    });

    it('should complete successfully with mixed results', async () => {
      const containers = [
        {
          Id: 'abc123',
          Names: ['/fluxApp1'],
        },
        {
          Id: 'def456',
          Names: ['/fluxApp2'],
        },
      ];

      dockerServiceStub.dockerListContainers.resolves(containers);

      // First container needs restart
      const containerInfo1 = {
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [
          {
            Source: '/path/to/mount1',
            Destination: '/app/data',
          },
        ],
      };

      // Second container doesn't need restart
      const containerInfo2 = {
        State: {
          Running: true,
          StartedAt: '2024-01-01T10:00:00Z',
        },
        Mounts: [],
      };

      dockerServiceStub.dockerContainerInspect.onFirstCall().resolves(containerInfo1);
      dockerServiceStub.dockerContainerInspect.onSecondCall().resolves(containerInfo2);

      fsStub.stat.resolves({
        birthtime: new Date('2024-01-01T10:05:00Z'),
        mtime: new Date('2024-01-01T10:05:00Z'),
      });

      // First restart succeeds
      dockerServiceStub.appDockerRestart.resolves();

      const result = await containerMountRecovery.performContainerMountRecovery();

      expect(result.containersNeedingRestart).to.equal(1);
      expect(result.restartResults.restarted).to.have.length(1);
      expect(result.restartResults.failed).to.have.length(0);
    });
  });
});
