// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const Dockerode = require('dockerode');
const sinon = require('sinon');
const path = require('path');
const dockerService = require('../../ZelBack/src/services/dockerService');
const globalState = require('../../ZelBack/src/services/utils/globalState');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('dockerService tests', () => {
  describe('getDockerContainer tests', () => {
    it('should return a container with a proper ID', async () => {
      const dockerContainer = await dockerService.getDockerContainer('46274c58c9a969e93c1f91a057f0a371c7b952e31a7aec73839afe1433fdee94');

      expect(dockerContainer.id).to.be.a('string');
      expect(dockerContainer.defaultOptions).to.exist;
      expect(dockerContainer.modem).to.exist;
    });
  });

  describe('getAppIdentifier tests', () => {
    it('should return the same name if starts with "flux"', async () => {
      const appName = 'fluxTesting';

      const result = dockerService.getAppIdentifier(appName);

      expect(result).to.equal(appName);
    });

    it('should return the same name if starts with "zel"', async () => {
      const appName = 'zelTesting';

      const result = dockerService.getAppIdentifier(appName);

      expect(result).to.equal(appName);
    });

    it('should add "zel" to app identifier if it is KadenaChainWebNode', async () => {
      const appName = 'KadenaChainWebNode';
      const expected = 'zelKadenaChainWebNode';

      const result = dockerService.getAppIdentifier(appName);

      expect(result).to.equal(expected);
    });

    it('should add "zel" to app identifier if it is FoldingAtHomeB', async () => {
      const appName = 'FoldingAtHomeB';
      const expected = 'zelFoldingAtHomeB';

      const result = dockerService.getAppIdentifier(appName);

      expect(result).to.equal(expected);
    });

    it('should add "flux" to app identifier with any other name', async () => {
      const appName = 'testing1234';
      const expected = 'fluxtesting1234';

      const result = dockerService.getAppIdentifier(appName);

      expect(result).to.equal(expected);
    });

    it('should handle empty app name', async () => {
      const appName = '';
      const expected = 'flux';

      const result = dockerService.getAppIdentifier(appName);

      expect(result).to.equal(expected);
    });
  });

  describe('getBaseAppName tests', () => {
    it('should strip the "flux" prefix', async () => {
      expect(dockerService.getBaseAppName('fluxdb_App')).to.equal('db_App');
    });

    it('should strip the "zel" prefix', async () => {
      expect(dockerService.getBaseAppName('zelKadenaChainWebNode')).to.equal('KadenaChainWebNode');
    });

    it('should return a bare identifier unchanged', async () => {
      expect(dockerService.getBaseAppName('db_App')).to.equal('db_App');
    });

    it('should round-trip getAppIdentifier for compose and zel-legacy names', async () => {
      ['db_App', 'testing1234', 'KadenaChainWebNode', 'FoldingAtHomeB'].forEach((bare) => {
        expect(dockerService.getBaseAppName(dockerService.getAppIdentifier(bare))).to.equal(bare);
      });
    });
  });

  describe('getAppDockerNameIdentifier tests', () => {
    it('should add /flux/ if name starts with "/"', async () => {
      const appName = '/Testing';
      const expected = '/flux/Testing';

      const result = dockerService.getAppDockerNameIdentifier(appName);

      expect(result).to.equal(expected);
    });

    it('should add "/flux" to app identifier with any other name', async () => {
      const appName = 'testing1234';
      const expected = '/fluxtesting1234';

      const result = dockerService.getAppDockerNameIdentifier(appName);

      expect(result).to.equal(expected);
    });

    it('should handle empty app name', async () => {
      const appName = '';
      const expected = '/flux';

      const result = dockerService.getAppDockerNameIdentifier(appName);

      expect(result).to.equal(expected);
    });
  });

  describe('dockerCreateNetwork tests', () => {
    let network;
    const options = {
      name: 'Testnetwork',
    };

    afterEach(async () => {
      await dockerService.dockerRemoveNetwork(network);
    });

    it('Should create a network object', async () => {
      network = await dockerService.dockerCreateNetwork(options);

      expect(network).to.be.an('object');
      expect(network.id).to.be.a('string');
    });
  });

  describe('dockerRemoveNetwork tests', () => {
    let network;
    const options = {
      name: 'Testnetwork',
    };

    beforeEach(async () => {
      network = await dockerService.dockerCreateNetwork(options);
    });

    afterEach(async () => {
      try {
        await dockerService.dockerRemoveNetwork(network);
      } catch {
        // already removed by test
      }
    });

    it('should remove a network', async () => {
      const result = await dockerService.dockerRemoveNetwork(network);

      expect(result).to.be.instanceOf(Buffer);
      expect(result).to.be.empty;
    });
  });

  describe('dockerNetworkInspect tests', () => {
    let network;
    const options = {
      name: 'Testnetwork',
    };

    beforeEach(async () => {
      network = await dockerService.dockerCreateNetwork(options);
    });

    afterEach(async () => {
      await dockerService.dockerRemoveNetwork(network);
    });

    it('should return an inspect network object', async () => {
      const result = await dockerService.dockerNetworkInspect(network);

      expect(result.Name).to.equal(options.name);
      expect(result.Id).to.be.a('string');
      expect(result.EnableIPv6).to.be.false;
    });
  });

  describe('dockerListContainers tests', () => {
    it('should return a list of containers', async () => {
      let fluxContainer;

      const result = await dockerService.dockerListContainers();
      result.forEach((container) => {
        if (container.Image === 'runonflux/website') fluxContainer = container;
      });

      expect(fluxContainer.Id).to.be.a('string');
      expect(fluxContainer.Image).to.equal('runonflux/website');
      expect(fluxContainer.Names[0]).to.equal('/fluxwebsite');
      expect(fluxContainer.State).to.equal('running');
    });

    it('should return a list of containers with an option all = true', async () => {
      let fluxContainer;

      const result = await dockerService.dockerListContainers(true);
      result.forEach((container) => {
        if (container.Image === 'runonflux/website') fluxContainer = container;
      });

      expect(fluxContainer.Id).to.be.a('string');
      expect(fluxContainer.Image).to.equal('runonflux/website');
      expect(fluxContainer.Names[0]).to.equal('/fluxwebsite');
      expect(fluxContainer.State).to.equal('running');
    });
  });

  describe('dockerListImages tests', () => {
    it('should return a list of containers', async () => {
      let fluxImage;

      const result = await dockerService.dockerListImages();
      result.forEach((image) => {
        if (image.RepoTags.length && image.RepoTags[0].includes('runonflux/website')) fluxImage = image;
      });

      expect(fluxImage).to.exist;
      expect(fluxImage.RepoDigests[0]).to.include('runonflux/website');
      expect(fluxImage.Id).to.be.a('string');
    });
  });

  describe('dockerContainerInspect tests', () => {
    it('should return a valid inspect object', async () => {
      const containerName = 'website';

      const inspectResult = await dockerService.dockerContainerInspect(containerName);

      expect(inspectResult).to.exist;
      expect(inspectResult.State.Status).to.equal('running');
      expect(inspectResult.Id).to.be.a('string');
      expect(inspectResult.Platform).to.equal('linux');
      expect(inspectResult.Config.Image).to.equal('runonflux/website');
    });

    it('should throw error if the container does not exist', async () => {
      const containerName = 'testing1234';

      await expect(dockerService.dockerContainerInspect(containerName)).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe('classifyContainerNetworkAttachment / isContainerDetachedFromNetwork tests', () => {
    it('reports attached when the managed network carries an IP', () => {
      const attachment = dockerService.classifyContainerNetworkAttachment({
        HostConfig: { NetworkMode: 'fluxDockerNetwork_appx' },
        State: { Running: true },
        NetworkSettings: { Networks: { fluxDockerNetwork_appx: { IPAddress: '172.23.0.5' } } },
      });

      expect(attachment).to.deep.equal({
        managed: true, running: true, networkMode: 'fluxDockerNetwork_appx', attached: true,
      });
      expect(dockerService.isContainerDetachedFromNetwork(attachment)).to.equal(false);
    });

    it('flags a running managed container with an empty Networks as detached', () => {
      const attachment = dockerService.classifyContainerNetworkAttachment({
        HostConfig: { NetworkMode: 'fluxDockerNetwork_appx' },
        State: { Running: true },
        NetworkSettings: { Networks: {} },
      });

      expect(attachment.managed).to.equal(true);
      expect(attachment.attached).to.equal(false);
      expect(dockerService.isContainerDetachedFromNetwork(attachment)).to.equal(true);
    });

    it('flags detached when the endpoint exists but has no IP (half-programmed)', () => {
      const attachment = dockerService.classifyContainerNetworkAttachment({
        HostConfig: { NetworkMode: 'fluxDockerNetwork_appx' },
        State: { Running: true },
        NetworkSettings: { Networks: { fluxDockerNetwork_appx: { IPAddress: '' } } },
      });

      expect(dockerService.isContainerDetachedFromNetwork(attachment)).to.equal(true);
    });

    it('does not flag a stopped container as detached', () => {
      const attachment = dockerService.classifyContainerNetworkAttachment({
        HostConfig: { NetworkMode: 'fluxDockerNetwork_appx' },
        State: { Running: false },
        NetworkSettings: { Networks: {} },
      });

      expect(attachment.running).to.equal(false);
      expect(dockerService.isContainerDetachedFromNetwork(attachment)).to.equal(false);
    });

    it('never flags a non-managed (host-networked) container as detached', () => {
      const attachment = dockerService.classifyContainerNetworkAttachment({
        HostConfig: { NetworkMode: 'host' },
        State: { Running: true },
        NetworkSettings: { Networks: {} },
      });

      expect(attachment.managed).to.equal(false);
      expect(dockerService.isContainerDetachedFromNetwork(attachment)).to.equal(false);
    });

    it('tolerates a partial/empty inspect object', () => {
      const attachment = dockerService.classifyContainerNetworkAttachment({});
      expect(attachment).to.deep.equal({
        managed: false, running: false, networkMode: null, attached: false,
      });
    });

    it('isContainerDetachedFromNetwork tolerates missing input', () => {
      expect(dockerService.isContainerDetachedFromNetwork(undefined)).to.equal(false);
      expect(dockerService.isContainerDetachedFromNetwork(null)).to.equal(false);
    });
  });

  describe('dockerNetworkState tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('reports exists when the network inspects cleanly', async () => {
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({ inspect: sinon.stub().resolves({ Name: 'fluxDockerNetwork_appx' }) });

      await expect(dockerService.dockerNetworkState('fluxDockerNetwork_appx')).to.eventually.equal('exists');
    });

    it('reports absent only when docker itself confirms the network is not listed', async () => {
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({ inspect: sinon.stub().rejects(new Error('no such network')) });
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves([{ Name: 'bridge' }, { Name: 'fluxDockerNetwork_other' }]);

      await expect(dockerService.dockerNetworkState('fluxDockerNetwork_appx')).to.eventually.equal('absent');
    });

    it('reports exists when the inspect failed transiently but the network IS listed', async () => {
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({ inspect: sinon.stub().rejects(new Error('EAI_AGAIN')) });
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves([{ Name: 'fluxDockerNetwork_appx' }]);

      await expect(dockerService.dockerNetworkState('fluxDockerNetwork_appx')).to.eventually.equal('exists');
    });

    it('reports unknown (never absent) when docker cannot answer at all', async () => {
      // the caller destroys a container on "absent", so an unreachable daemon must
      // never be read as a missing network
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({ inspect: sinon.stub().rejects(new Error('connect ENOENT /var/run/docker.sock')) });
      sinon.stub(Dockerode.prototype, 'listNetworks').rejects(new Error('connect ENOENT /var/run/docker.sock'));

      await expect(dockerService.dockerNetworkState('fluxDockerNetwork_appx')).to.eventually.equal('unknown');
    });
  });

  describe('dockerContainerStats tests', () => {
    it('should return a valid stats object', async () => {
      const containerName = 'website';

      const statsResult = await dockerService.dockerContainerStats(containerName);

      expect(statsResult.name).to.equal('/fluxwebsite');
      expect(statsResult.id).to.be.a('string');
      expect(statsResult.memory_stats.stats).to.exist;
      expect(statsResult.cpu_stats.cpu_usage).to.exist;
      expect(statsResult.precpu_stats.cpu_usage).to.exist;
    });

    it('should throw error if the container does not exist', async () => {
      const containerName = 'test';

      await expect(dockerService.dockerContainerStats(containerName)).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe('dockerContainerChanges tests', () => {
    it('should return a valid stats object', async () => {
      const containerName = 'website';

      const changesResult = await dockerService.dockerContainerChanges(containerName);

      expect(changesResult).to.be.an('array');
      expect(changesResult[0].Path).to.exist;
    });

    it('should throw error if the container does not exist', async () => {
      const containerName = 'test';

      await expect(dockerService.dockerContainerChanges(containerName)).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe.skip('dockerContainerExec tests', () => {
    // TODO: I can't get any command to emit any data
    it('should execute a command inside of the conainter', async () => {
      const container = dockerService.getDockerContainerByIdOrName('website');
      const cmd = '';
      const env = [];
      const res = {};

      dockerService.dockerContainerExec(container, cmd, env, res, (err, data) => {
        console.log(data);
      });
    });
  });

  describe('dockerContainerLogsStream tests', () => {
    it('should return a valid stats object', async () => {
      const appName = 'website';

      const res = await dockerService.dockerContainerLogs(appName, 2);
      expect(res).to.be.an.instanceOf(Buffer);
      expect(res).to.exist;
    });

    it('should throw an error if container does not exist', async () => {
      const appName = 'testing1234';

      await expect(dockerService.dockerContainerLogs(appName, 2)).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe('appDockerStart tests', () => {
    const appName = 'website';
    let dockerStub;
    let getContainerSpy;

    beforeEach(() => {
      dockerStub = sinon.stub(Dockerode.Container.prototype, 'start').returns(Promise.resolve('started'));
      getContainerSpy = sinon.spy(Dockerode.prototype, 'getContainer');
    });

    afterEach(() => {
      dockerStub.restore();
      getContainerSpy.restore();
    });

    it('should call a docker start command', async () => {
      const startResult = await dockerService.appDockerStart(appName);

      sinon.assert.calledOnce(dockerStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(startResult).to.equal('Flux App website successfully started.');
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerStart('testing123')).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe('appDockerStop tests', () => {
    const appName = 'website';
    let dockerStopStub;
    let dockerInspectStub;
    let getContainerSpy;

    beforeEach(() => {
      dockerStopStub = sinon.stub(Dockerode.Container.prototype, 'stop').returns(Promise.resolve('stopped'));
      dockerInspectStub = sinon.stub(Dockerode.Container.prototype, 'inspect').returns(Promise.resolve({ State: { Running: true } }));
      getContainerSpy = sinon.spy(Dockerode.prototype, 'getContainer');
    });

    afterEach(() => {
      dockerStopStub.restore();
      dockerInspectStub.restore();
      getContainerSpy.restore();
    });

    it('should call a docker stop command when container is running', async () => {
      const stopResult = await dockerService.appDockerStop(appName);

      sinon.assert.calledOnce(dockerInspectStub);
      sinon.assert.calledOnce(dockerStopStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(stopResult).to.equal('Flux App website successfully stopped.');
    });

    it('should not call docker stop when container is already stopped', async () => {
      dockerInspectStub.returns(Promise.resolve({ State: { Running: false } }));

      const stopResult = await dockerService.appDockerStop(appName);

      sinon.assert.calledOnce(dockerInspectStub);
      sinon.assert.notCalled(dockerStopStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(stopResult).to.equal('Flux App website is already stopped.');
    });

    it('should not call docker stop when container is in created state', async () => {
      dockerInspectStub.returns(Promise.resolve({ State: { Running: false, Status: 'created' } }));

      const stopResult = await dockerService.appDockerStop(appName);

      sinon.assert.calledOnce(dockerInspectStub);
      sinon.assert.notCalled(dockerStopStub);
      expect(stopResult).to.equal('Flux App website is already stopped.');
    });

    it('should stop container when in paused state (Running: true)', async () => {
      dockerInspectStub.returns(Promise.resolve({ State: { Running: true, Paused: true } }));

      const stopResult = await dockerService.appDockerStop(appName);

      sinon.assert.calledOnce(dockerInspectStub);
      sinon.assert.calledOnce(dockerStopStub);
      expect(stopResult).to.equal('Flux App website successfully stopped.');
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerStop('testing123')).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });

    // The stopping flag's lifetime is the STOP OPERATION's lifetime - held while
    // container.stop() is in flight (legitimately hours under v9 graceful
    // shutdown) and cleared when the operation settles. Clearing must never
    // depend on the docker die event being delivered: a lost event (stream down)
    // would otherwise leak the flag forever and permanently wedge the
    // reconciler's actuation for that component.
    it('holds the stopping flag during the stop and clears it on completion', async () => {
      globalState.stoppingContainers.clear();
      let flaggedDuringStop = false;
      dockerStopStub.callsFake(async () => {
        flaggedDuringStop = globalState.stoppingContainers.size === 1;
        return 'stopped';
      });

      await dockerService.appDockerStop(appName);

      expect(flaggedDuringStop, 'flag must be set while the stop operation is in flight').to.be.true;
      expect(globalState.stoppingContainers.size, 'flag must clear when the operation settles - the die event must not be its only janitor').to.equal(0);
    });

    it('clears the stopping flag when the stop operation throws', async () => {
      globalState.stoppingContainers.clear();
      dockerStopStub.rejects(new Error('socket hang up'));

      await expect(dockerService.appDockerStop(appName)).to.eventually.be.rejected;
      expect(globalState.stoppingContainers.size).to.equal(0);
    });
  });

  describe('appDockerRestart tests', () => {
    const appName = 'website';
    let dockerRestartStub;
    let dockerStartStub;
    let dockerInspectStub;
    let getContainerSpy;

    beforeEach(() => {
      dockerRestartStub = sinon.stub(Dockerode.Container.prototype, 'restart').returns(Promise.resolve('restarted'));
      dockerStartStub = sinon.stub(Dockerode.Container.prototype, 'start').returns(Promise.resolve('started'));
      dockerInspectStub = sinon.stub(Dockerode.Container.prototype, 'inspect').returns(Promise.resolve({ State: { Running: true } }));
      getContainerSpy = sinon.spy(Dockerode.prototype, 'getContainer');
    });

    afterEach(() => {
      dockerRestartStub.restore();
      dockerStartStub.restore();
      dockerInspectStub.restore();
      getContainerSpy.restore();
    });

    it('should call a docker restart command when container is running', async () => {
      const restartResult = await dockerService.appDockerRestart(appName);

      sinon.assert.calledOnce(dockerInspectStub);
      sinon.assert.calledOnce(dockerRestartStub);
      sinon.assert.notCalled(dockerStartStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(restartResult).to.equal('Flux App website successfully restarted.');
    });

    it('should call docker start instead of restart when container is stopped', async () => {
      dockerInspectStub.returns(Promise.resolve({ State: { Running: false } }));

      const restartResult = await dockerService.appDockerRestart(appName);

      sinon.assert.calledOnce(dockerInspectStub);
      sinon.assert.notCalled(dockerRestartStub);
      sinon.assert.calledOnce(dockerStartStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(restartResult).to.equal('Flux App website was stopped, successfully started.');
    });

    it('should call start when container is in created state (never started)', async () => {
      dockerInspectStub.returns(Promise.resolve({ State: { Running: false, Status: 'created' } }));

      const restartResult = await dockerService.appDockerRestart(appName);

      sinon.assert.calledOnce(dockerInspectStub);
      sinon.assert.notCalled(dockerRestartStub);
      sinon.assert.calledOnce(dockerStartStub);
      expect(restartResult).to.equal('Flux App website was stopped, successfully started.');
    });

    it('should call start when container is in exited state', async () => {
      dockerInspectStub.returns(Promise.resolve({ State: { Running: false, Status: 'exited', ExitCode: 0 } }));

      const restartResult = await dockerService.appDockerRestart(appName);

      sinon.assert.calledOnce(dockerInspectStub);
      sinon.assert.notCalled(dockerRestartStub);
      sinon.assert.calledOnce(dockerStartStub);
      expect(restartResult).to.equal('Flux App website was stopped, successfully started.');
    });

    it('should restart container when in paused state (Running: true)', async () => {
      dockerInspectStub.returns(Promise.resolve({ State: { Running: true, Paused: true } }));

      const restartResult = await dockerService.appDockerRestart(appName);

      sinon.assert.calledOnce(dockerInspectStub);
      sinon.assert.calledOnce(dockerRestartStub);
      sinon.assert.notCalled(dockerStartStub);
      expect(restartResult).to.equal('Flux App website successfully restarted.');
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerRestart('testing123')).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe('appDockerKill tests', () => {
    const appName = 'website';
    let dockerStub;
    let getContainerSpy;

    beforeEach(() => {
      dockerStub = sinon.stub(Dockerode.Container.prototype, 'kill').returns(Promise.resolve('kiled'));
      getContainerSpy = sinon.spy(Dockerode.prototype, 'getContainer');
    });

    afterEach(() => {
      dockerStub.restore();
      getContainerSpy.restore();
    });

    it('should call a docker kill command', async () => {
      const killResult = await dockerService.appDockerKill(appName);

      sinon.assert.calledOnce(dockerStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(killResult).to.equal('Flux App website successfully killed.');
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerKill('testing123')).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });

    // same flag-lifetime contract as appDockerStop: held during the kill
    // operation, cleared when it settles, never reliant on the die event
    it('holds the stopping flag during the kill and clears it on completion', async () => {
      globalState.stoppingContainers.clear();
      let flaggedDuringKill = false;
      dockerStub.callsFake(async () => {
        flaggedDuringKill = globalState.stoppingContainers.size === 1;
        return 'killed';
      });

      await dockerService.appDockerKill(appName);

      expect(flaggedDuringKill, 'flag must be set while the kill operation is in flight').to.be.true;
      expect(globalState.stoppingContainers.size, 'flag must clear when the operation settles').to.equal(0);
    });
  });

  describe('appDockerRemove tests', () => {
    const appName = 'website';
    let dockerStub;
    let getContainerSpy;

    beforeEach(() => {
      dockerStub = sinon.stub(Dockerode.Container.prototype, 'remove').returns(Promise.resolve('removed'));
      getContainerSpy = sinon.spy(Dockerode.prototype, 'getContainer');
    });

    afterEach(() => {
      dockerStub.restore();
      getContainerSpy.restore();
    });

    it('should call a docker remove command', async () => {
      const removeResult = await dockerService.appDockerRemove(appName);

      sinon.assert.calledOnce(dockerStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(removeResult).to.equal('Flux App website successfully removed.');
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerRemove('testing123')).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe('appDockerPause tests', () => {
    const appName = 'website';
    let dockerStub;
    let getContainerSpy;

    beforeEach(() => {
      dockerStub = sinon.stub(Dockerode.Container.prototype, 'pause').returns(Promise.resolve('paused'));
      getContainerSpy = sinon.spy(Dockerode.prototype, 'getContainer');
    });

    afterEach(() => {
      dockerStub.restore();
      getContainerSpy.restore();
    });

    it('should call a docker pause command', async () => {
      const pauseResult = await dockerService.appDockerPause(appName);

      sinon.assert.calledOnce(dockerStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(pauseResult).to.equal('Flux App website successfully paused.');
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerPause('testing123')).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe('appDockerUnpause tests', () => {
    const appName = 'website';
    let dockerStub;
    let getContainerSpy;

    beforeEach(() => {
      dockerStub = sinon.stub(Dockerode.Container.prototype, 'unpause').returns(Promise.resolve('unpaused'));
      getContainerSpy = sinon.spy(Dockerode.prototype, 'getContainer');
    });

    afterEach(() => {
      dockerStub.restore();
      getContainerSpy.restore();
    });

    it('should call a docker unpause command', async () => {
      const unpauseResult = await dockerService.appDockerUnpause(appName);

      sinon.assert.calledOnce(dockerStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(unpauseResult).to.equal('Flux App website successfully unpaused.');
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerUnpause('testing123')).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe('appDockerImageRemove tests', () => {
    const appName = 'website';
    let dockerStub;
    let getImageSpy;

    beforeEach(() => {
      dockerStub = sinon.stub(Dockerode.Image.prototype, 'remove').returns(Promise.resolve('removed'));
      getImageSpy = sinon.spy(Dockerode.prototype, 'getImage');
    });

    afterEach(() => {
      dockerStub.restore();
      getImageSpy.restore();
    });

    it('should call a docker image remove command', async () => {
      const removeResult = await dockerService.appDockerImageRemove(appName);

      sinon.assert.calledOnce(dockerStub);
      sinon.assert.calledOnceWithExactly(getImageSpy, appName);
      expect(removeResult).to.equal('Flux App website image successfully removed.');
    });
  });

  describe('appDockerTop tests', () => {
    const appName = 'website';

    it('should return processes running on docker', async () => {
      const dockerTopResult = await dockerService.appDockerTop(appName);

      expect(dockerTopResult.Processes).to.be.an('array');
      expect(dockerTopResult.Processes).to.be.not.empty;
      expect(dockerTopResult.Titles).to.be.an('array');
      expect(dockerTopResult.Titles).to.be.not.empty;
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerTop('testing123')).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'Id\')');
    });
  });

  describe('createFluxDockerNetwork tests', () => {
    let network;
    const docker = new Dockerode();
    const fluxNetworkOptions = {
      Name: 'fluxDockerNetwork',
      IPAM: {
        Config: [{
          Subnet: '172.23.0.0/24',
          Gateway: '172.23.0.1',
        }],
      },
    };

    afterEach(async () => {
      try {
        await dockerService.dockerRemoveNetwork(network);
      } catch {
        console.log('Network does not exist');
      }
    });

    it('should create flux docker network if it does not exist', async () => {
      const createNetworkResponse = await dockerService.createFluxDockerNetwork();
      network = docker.getNetwork(fluxNetworkOptions.Name);
      const inspectResult = await dockerService.dockerNetworkInspect(network);

      expect(createNetworkResponse.id).to.be.a('string');
      expect(createNetworkResponse.modem).to.be.an('object');
      expect(inspectResult.Name).to.equal(fluxNetworkOptions.Name);
      expect(inspectResult.Id).to.be.a('string');
      expect(inspectResult.IPAM.Config).to.eql(fluxNetworkOptions.IPAM.Config);
    });

    it('should return a message if the network does exist', async () => {
      // Call the function twice to make sure it exists
      await dockerService.createFluxDockerNetwork();

      const createNetworkResponse = await dockerService.createFluxDockerNetwork();

      expect(createNetworkResponse).to.equal('Flux Network already exists.');
    });
  });

  describe('createFluxAppDockerNetwork tests', () => {
    let network;
    const docker = new Dockerode();
    const fluxNetworkOptions = {
      Name: 'fluxDockerNetwork_MyAppName',
      IPAM: {
        Config: [{
          Subnet: '172.23.52.0/24',
          Gateway: '172.23.52.1',
        }],
      },
    };

    afterEach(async () => {
      try {
        await dockerService.dockerRemoveNetwork(network);
      } catch {
        console.log('Network does not exist');
      }
    });

    it('should create flux app docker network if it does not exist', async () => {
      const createNetworkResponse = await dockerService.createFluxAppDockerNetwork('MyAppName', 52);
      network = docker.getNetwork(fluxNetworkOptions.Name);
      const inspectResult = await dockerService.dockerNetworkInspect(network);

      expect(createNetworkResponse.id).to.be.a('string');
      expect(createNetworkResponse.modem).to.be.an('object');
      expect(inspectResult.Name).to.equal(fluxNetworkOptions.Name);
      expect(inspectResult.Id).to.be.a('string');
      expect(inspectResult.IPAM.Config).to.eql(fluxNetworkOptions.IPAM.Config);
    });

    it('should return a message if the flux app network does exist', async () => {
      // Call the function twice to make sure it exists
      await dockerService.createFluxAppDockerNetwork('MyAppName', 52);

      const createNetworkResponse = await dockerService.createFluxAppDockerNetwork('MyAppName', 52);

      expect(createNetworkResponse).to.equal('Flux App Network of MyAppName already exists.');
    });
  });

  describe('appDockerNetworkConnect tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    function stubInspectWithNetworks(networks) {
      const inspectStub = sinon.stub().resolves({ NetworkSettings: { Networks: networks } });
      sinon.stub(Dockerode.prototype, 'getContainer').returns({ inspect: inspectStub });
      return inspectStub;
    }

    function stubInspectThrows(error) {
      const inspectStub = sinon.stub().rejects(error);
      sinon.stub(Dockerode.prototype, 'getContainer').returns({ inspect: inspectStub });
      return inspectStub;
    }

    it('connects the container when not already attached', async () => {
      stubInspectWithNetworks({ bridge: {} });
      const connectStub = sinon.stub().resolves();
      const getNetworkStub = sinon.stub(Dockerode.prototype, 'getNetwork').returns({ connect: connectStub });

      await dockerService.appDockerNetworkConnect('fluxweb_myapp', 'fluxDockerNetwork_dep');

      sinon.assert.calledOnceWithExactly(getNetworkStub, 'fluxDockerNetwork_dep');
      sinon.assert.calledOnceWithExactly(connectStub, { Container: 'fluxweb_myapp' });
    });

    it('skips the connect call when the container is already attached', async () => {
      stubInspectWithNetworks({ fluxDockerNetwork_dep: {} });
      const connectStub = sinon.stub().resolves();
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({ connect: connectStub });

      await dockerService.appDockerNetworkConnect('fluxweb_myapp', 'fluxDockerNetwork_dep');

      sinon.assert.notCalled(connectStub);
    });

    it('still attempts to connect when inspect fails', async () => {
      stubInspectThrows(new Error('inspect transient'));
      const connectStub = sinon.stub().resolves();
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({ connect: connectStub });

      await dockerService.appDockerNetworkConnect('fluxweb_myapp', 'fluxDockerNetwork_dep');

      sinon.assert.calledOnceWithExactly(connectStub, { Container: 'fluxweb_myapp' });
    });

    it('swallows the race-window already-exists error from connect', async () => {
      stubInspectWithNetworks({ bridge: {} });
      const error = new Error('endpoint with name fluxweb_myapp already exists in network fluxDockerNetwork_dep');
      error.statusCode = 403;
      const connectStub = sinon.stub().rejects(error);
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({ connect: connectStub });

      await expect(dockerService.appDockerNetworkConnect('fluxweb_myapp', 'fluxDockerNetwork_dep')).to.not.be.rejected;
    });

    it('rethrows generic connect errors (no message match)', async () => {
      stubInspectWithNetworks({ bridge: {} });
      const error = new Error('network fluxDockerNetwork_dep not found');
      error.statusCode = 404;
      const connectStub = sinon.stub().rejects(error);
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({ connect: connectStub });

      await expect(dockerService.appDockerNetworkConnect('fluxweb_myapp', 'fluxDockerNetwork_dep')).to.be.rejectedWith('not found');
    });

    it('rethrows a generic 403 that is not already-exists', async () => {
      stubInspectWithNetworks({ bridge: {} });
      const error = new Error('operation not permitted on swarm-scoped network');
      error.statusCode = 403;
      const connectStub = sinon.stub().rejects(error);
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({ connect: connectStub });

      await expect(dockerService.appDockerNetworkConnect('fluxweb_myapp', 'fluxDockerNetwork_dep')).to.be.rejectedWith('swarm-scoped');
    });
  });

  describe('getAppContainerNames tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('returns multi-component and legacy single-component containers, anchored to flux/zel', async () => {
      sinon.stub(Dockerode.prototype, 'listContainers').resolves([
        { Names: ['/fluxweb_myapp'] },
        { Names: ['/fluxapi_myapp'] },
        { Names: ['/fluxother_differentapp'] },
        { Names: ['/fluxmyapp'] },
        { Names: ['/zelmyapp'] },
        { Names: ['/someoneelse_myapp'] }, // missing flux/zel prefix — must NOT match
      ]);

      const names = await dockerService.getAppContainerNames('myapp');

      expect(names).to.have.members(['fluxweb_myapp', 'fluxapi_myapp', 'fluxmyapp']);
      expect(names).to.not.include('fluxother_differentapp');
      expect(names).to.not.include('someoneelse_myapp');
    });

    it('escapes regex metacharacters in the app name', async () => {
      sinon.stub(Dockerode.prototype, 'listContainers').resolves([
        { Names: ['/fluxweb_my-app'] },
      ]);

      const names = await dockerService.getAppContainerNames('my-app');

      expect(names).to.eql(['fluxweb_my-app']);
    });
  });

  describe('appDockerCreate tests', () => {
    let dockerStub;
    const appName = 'fluxwebsite';
    // Use the same path that dockerService will compute at runtime
    const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
    // eslint-disable-next-line no-unused-vars
    const appsFolder = `${fluxDirPath}/ZelApps/`;
    const baseNodeApp = {
      name: 'website',
      commands: [
        '--chain',
        'kusama',
      ],
      containerData: '/chaindata',
      cpu: 0.8,
      description: 'This is my test app',
      domains: [
        'testing.runonflux.io',
        'testing.runonflux.io',
        'testing.runonflux.io',
      ],
      enviromentParameters: [],
      hash: '99b685ffcf5fe244981fcd4dd52cf055b19bfb6ded91f96f9d8179cee09700cf',
      hdd: 20,
      height: 1052918,
      owner: '196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH',
      ram: 1800,
      repotag: 'runonflux/website',
      tiered: false,
      instances: 3,
    };

    // eslint-disable-next-line no-unused-vars
    const baseExpectedConfig = {
      Image: 'runonflux/website',
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ['--chain', 'kusama'],
      Env: [],
      Tty: false,
    };
    beforeEach(() => {
      dockerStub = sinon.stub(Dockerode.prototype, 'createContainer').returns(Promise.resolve('created'));
    });

    afterEach(() => {
      dockerStub.restore();
    });

    it('should create an app given proper parameters for specs version > 1', async () => {
      const nodeApp = {
        ...baseNodeApp,
        containerPorts: [
          '30333',
          '9933',
          '9944',
        ],
        ports: [
          '31113',
          '31112',
          '31111',
        ],
        version: 3,
      };

      await dockerService.appDockerCreate(nodeApp, appName, true);

      sinon.assert.calledOnce(dockerStub);
      const actualConfig = dockerStub.firstCall.args[0];

      // Check key properties instead of exact match
      expect(actualConfig.Image).to.equal('runonflux/website');
      expect(actualConfig.name).to.equal('fluxwebsite_fluxwebsite');
      expect(actualConfig.Hostname).to.equal('website');
      expect(actualConfig.HostConfig.NanoCPUs).to.equal(800000000);
      expect(actualConfig.HostConfig.Memory).to.equal(1887436800);
      expect(actualConfig.HostConfig.Mounts).to.have.lengthOf(1);
      expect(actualConfig.HostConfig.Mounts[0].Source).to.include('fluxwebsite_fluxwebsite/appdata');
      expect(actualConfig.HostConfig.Mounts[0].Target).to.equal('/chaindata');
    });

    it('should create an app given proper parameters for specs version > 1 and parameter component == false', async () => {
      const nodeApp = {
        ...baseNodeApp,
        containerPorts: [
          '30333',
          '9933',
          '9944',
        ],
        ports: [
          '31113',
          '31112',
          '31111',
        ],
        version: 3,
      };

      await dockerService.appDockerCreate(nodeApp, appName, false);

      sinon.assert.calledOnce(dockerStub);
      const actualConfig = dockerStub.firstCall.args[0];

      // Check key properties instead of exact match
      expect(actualConfig.Image).to.equal('runonflux/website');
      expect(actualConfig.name).to.equal('fluxwebsite');
      expect(actualConfig.Hostname).to.equal('website');
      expect(actualConfig.HostConfig.NanoCPUs).to.equal(800000000);
      expect(actualConfig.HostConfig.Memory).to.equal(1887436800);
      expect(actualConfig.HostConfig.Mounts).to.have.lengthOf(1);
      expect(actualConfig.HostConfig.Mounts[0].Source).to.include('fluxwebsite/appdata');
      expect(actualConfig.HostConfig.Mounts[0].Target).to.equal('/chaindata');
    });

    it('should create an app given proper parameters for specs version 1', async () => {
      const nodeApp = {
        ...baseNodeApp,
        containerPort: '9933',
        port: '31112',
        version: 1,
      };

      await dockerService.appDockerCreate(nodeApp, appName, true);

      sinon.assert.calledOnce(dockerStub);
      const actualConfig = dockerStub.firstCall.args[0];

      // Check key properties instead of exact match
      expect(actualConfig.Image).to.equal('runonflux/website');
      expect(actualConfig.name).to.equal('fluxwebsite_fluxwebsite');
      expect(actualConfig.Hostname).to.equal('website');
      expect(actualConfig.HostConfig.NanoCPUs).to.equal(800000000);
      expect(actualConfig.HostConfig.Memory).to.equal(1887436800);
      expect(actualConfig.HostConfig.Mounts).to.have.lengthOf(1);
      expect(actualConfig.HostConfig.Mounts[0].Source).to.include('fluxwebsite_fluxwebsite/appdata');
      expect(actualConfig.HostConfig.Mounts[0].Target).to.equal('/chaindata');
    });

    it('should throw error if the config is incorrect', async () => {
      const nodeApp = {
        testing: 'testing',
      };

      await expect(dockerService.appDockerCreate(nodeApp, appName, true)).to.eventually.be.rejectedWith('Cannot read properties of undefined (reading \'forEach\')');
    });
  });
});
