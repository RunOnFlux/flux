const chai = require('chai');
const dockerService = require('../../ZelBack/src/services/dockerService');

const { expect } = chai;

describe.only('dockerService tests', () => {
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
      const containerName = 'website';

      expect(async () => { await dockerService.dockerContainerInspect(containerName); }).to.throw;
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

      expect(async () => { await dockerService.dockerContainerStats(containerName); }).to.throw;
    });
  });
});
