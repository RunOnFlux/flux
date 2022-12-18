const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const Dockerode = require('dockerode');
const sinon = require('sinon');
const path = require('path');
const dockerService = require('../../ZelBack/src/services/dockerService').default;

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

    afterEach(() => {
      dockerService.dockerRemoveNetwork(network);
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
        if (image.RepoTags[0].includes('runonflux/website')) fluxImage = image;
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

      await expect(dockerService.dockerContainerInspect(containerName)).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
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

      await expect(dockerService.dockerContainerStats(containerName)).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
    });
  });

  describe('dockerContainerChanges tests', () => {
    it('should return a valid stats object', async () => {
      const containerName = 'website';

      const changesResult = await dockerService.dockerContainerChanges(containerName);

      expect(changesResult).to.be.a('string');
      expect(JSON.parse(changesResult)).to.be.an('array');
      expect(JSON.parse(changesResult)[0].Path).to.exist;
    });

    it('should throw error if the container does not exist', async () => {
      const containerName = 'test';

      await expect(dockerService.dockerContainerChanges(containerName)).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
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
      expect(res).to.be.a('string');
      expect(res).to.exist;
    });

    it('should throw an error if container does not exist', async () => {
      const appName = 'testing1234';

      await expect(dockerService.dockerContainerLogs(appName, 2)).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
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
      await expect(dockerService.appDockerStart('testing123')).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
    });
  });

  describe('appDockerStop tests', () => {
    const appName = 'website';
    let dockerStub;
    let getContainerSpy;

    beforeEach(() => {
      dockerStub = sinon.stub(Dockerode.Container.prototype, 'stop').returns(Promise.resolve('stopped'));
      getContainerSpy = sinon.spy(Dockerode.prototype, 'getContainer');
    });

    afterEach(() => {
      dockerStub.restore();
      getContainerSpy.restore();
    });

    it('should call a docker stop command', async () => {
      const stopResult = await dockerService.appDockerStop(appName);

      sinon.assert.calledOnce(dockerStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(stopResult).to.equal('Flux App website successfully stopped.');
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerStop('testing123')).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
    });
  });

  describe('appDockerRestart tests', () => {
    const appName = 'website';
    let dockerStub;
    let getContainerSpy;

    beforeEach(() => {
      dockerStub = sinon.stub(Dockerode.Container.prototype, 'restart').returns(Promise.resolve('restarted'));
      getContainerSpy = sinon.spy(Dockerode.prototype, 'getContainer');
    });

    afterEach(() => {
      dockerStub.restore();
      getContainerSpy.restore();
    });

    it('should call a docker restart command', async () => {
      const restartResult = await dockerService.appDockerRestart(appName);

      sinon.assert.calledOnce(dockerStub);
      sinon.assert.calledOnceWithExactly(getContainerSpy, sinon.match.string);
      expect(restartResult).to.equal('Flux App website successfully restarted.');
    });

    it('should throw error if app name is not correct or app does not exist', async () => {
      await expect(dockerService.appDockerRestart('testing123')).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
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
      await expect(dockerService.appDockerKill('testing123')).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
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
      await expect(dockerService.appDockerRemove('testing123')).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
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
      await expect(dockerService.appDockerPause('testing123')).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
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
      await expect(dockerService.appDockerUnpause('testing123')).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
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
      await expect(dockerService.appDockerTop('testing123')).to.eventually.be.rejectedWith('Cannot read property \'Id\' of undefined');
    });
  });

  describe('createFluxDockerNetwork tests', () => {
    let network;
    const docker = new Dockerode();
    const fluxNetworkOptions = {
      Name: 'fluxDockerNetwork',
      IPAM: {
        Config: [{
          Subnet: '172.15.0.0/16',
          Gateway: '172.15.0.1',
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

  describe('appDockerCreate tests', () => {
    let dockerStub;
    const appName = 'fluxwebsite';
    const fluxDirPath = path.join(__dirname, '../../');
    const appsFolder = `${fluxDirPath}ZelApps/`;
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
      const expectedConfig = {
        ...baseExpectedConfig,
        name: 'fluxwebsite_fluxwebsite',
        ExposedPorts: {
          '31113/tcp': {},
          '31113/udp': {},
          '31112/tcp': {},
          '31112/udp': {},
          '31111/tcp': {},
          '31111/udp': {},
          '30333/tcp': {},
          '30333/udp': {},
          '9933/tcp': {},
          '9933/udp': {},
          '9944/tcp': {},
          '9944/udp': {},
        },
        HostConfig: {
          NanoCPUs: 800000000,
          Memory: 1887436800,
          Ulimits: [{ Name: 'nofile', Soft: 100000, Hard: 100000 }],
          RestartPolicy: { Name: 'unless-stopped' },
          NetworkMode: 'fluxDockerNetwork',
          LogConfig: { Type: 'json-file', Config: { 'max-file': '1', 'max-size': '20m' } },
          Binds: [`${appsFolder}fluxwebsite_fluxwebsite:/chaindata`],
          PortBindings: {
            '30333/tcp': [{ HostPort: '31113' }],
            '30333/udp': [{ HostPort: '31113' }],
            '9933/tcp': [{ HostPort: '31112' }],
            '9933/udp': [{ HostPort: '31112' }],
            '9944/tcp': [{ HostPort: '31111' }],
            '9944/udp': [{ HostPort: '31111' }],
          },
        },
      };

      await dockerService.appDockerCreate(nodeApp, appName, true);

      sinon.assert.calledOnceWithExactly(dockerStub, expectedConfig);
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
      const expectedConfig = {
        ...baseExpectedConfig,
        name: 'fluxwebsite',
        ExposedPorts: {
          '31113/tcp': {},
          '31113/udp': {},
          '31112/tcp': {},
          '31112/udp': {},
          '31111/tcp': {},
          '31111/udp': {},
          '30333/tcp': {},
          '30333/udp': {},
          '9933/tcp': {},
          '9933/udp': {},
          '9944/tcp': {},
          '9944/udp': {},
        },
        HostConfig: {
          NanoCPUs: 800000000,
          Memory: 1887436800,
          Binds: [`${appsFolder}fluxwebsite:/chaindata`],
          Ulimits: [{ Name: 'nofile', Soft: 100000, Hard: 100000 }],
          PortBindings: {
            '30333/tcp': [{ HostPort: '31113' }],
            '30333/udp': [{ HostPort: '31113' }],
            '9933/tcp': [{ HostPort: '31112' }],
            '9933/udp': [{ HostPort: '31112' }],
            '9944/tcp': [{ HostPort: '31111' }],
            '9944/udp': [{ HostPort: '31111' }],
          },
          RestartPolicy: { Name: 'unless-stopped' },
          NetworkMode: 'fluxDockerNetwork',
          LogConfig: { Type: 'json-file', Config: { 'max-file': '1', 'max-size': '20m' } },
        },
      };

      await dockerService.appDockerCreate(nodeApp, appName, false);

      sinon.assert.calledOnceWithExactly(dockerStub, expectedConfig);
    });

    it('should create an app given proper parameters for specs version 1', async () => {
      const nodeApp = {
        ...baseNodeApp,
        containerPort: '9933',
        port: '31112',
        version: 1,
      };
      const expectedConfig = {
        ...baseExpectedConfig,
        name: 'fluxwebsite_fluxwebsite',
        ExposedPorts: {
          '31112/tcp': {}, '9933/tcp': {}, '31112/udp': {}, '9933/udp': {},
        },
        HostConfig: {
          NanoCPUs: 800000000,
          Memory: 1887436800,
          Binds: [`${appsFolder}fluxwebsite_fluxwebsite:/chaindata`],
          Ulimits: [{ Name: 'nofile', Soft: 100000, Hard: 100000 }],
          PortBindings: {
            '9933/tcp': [{ HostPort: '31112' }],
            '9933/udp': [{ HostPort: '31112' }],
          },
          RestartPolicy: { Name: 'unless-stopped' },
          NetworkMode: 'fluxDockerNetwork',
          LogConfig: { Type: 'json-file', Config: { 'max-file': '1', 'max-size': '20m' } },
        },
      };

      await dockerService.appDockerCreate(nodeApp, appName, true);

      sinon.assert.calledOnceWithExactly(dockerStub, expectedConfig);
    });

    it('should throw error if the config is incorrect', async () => {
      const nodeApp = {
        testing: 'testing',
      };

      await expect(dockerService.appDockerCreate(nodeApp, appName, true)).to.eventually.be.rejectedWith('Cannot read property \'forEach\' of undefined');
    });
  });
});
