// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const Dockerode = require('dockerode');
const sinon = require('sinon');
const path = require('path');
const { PassThrough } = require('stream');
const dockerService = require('../../ZelBack/src/services/dockerService');
const globalState = require('../../ZelBack/src/services/utils/globalState');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

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

  describe('isAppContainer tests', () => {
    it('accepts an app container by its label', () => {
      expect(dockerService.isAppContainer({
        Names: ['/anything'], Labels: { 'runonflux.role': 'app' },
      })).to.equal(true);
    });

    it('rejects a container FluxOS runs for its own purposes', () => {
      // The whole point: a sweep that reclaims orphaned apps must not reach
      // these, whatever they happen to be called.
      expect(dockerService.isAppContainer({
        Names: ['/fluxfileop-abc123'], Labels: { 'runonflux.role': 'fileop' },
      })).to.equal(false);
    });

    it('prefers the label over the name prefix when both are present', () => {
      expect(dockerService.isAppContainer({
        Names: ['/fluxcomp_myapp'], Labels: { 'runonflux.role': 'fileop' },
      })).to.equal(false);
    });

    it('falls back to the name prefix for containers created before labels shipped', () => {
      expect(dockerService.isAppContainer({ Names: ['/fluxcomp_myapp'] })).to.equal(true);
      expect(dockerService.isAppContainer({ Names: ['/zelcomp_myapp'], Labels: {} })).to.equal(true);
    });

    it('rejects a container that is neither labelled nor flux-named', () => {
      expect(dockerService.isAppContainer({ Names: ['/watchtower'] })).to.equal(false);
      expect(dockerService.isAppContainer({})).to.equal(false);
    });
  });

  describe('isFluxOwnedContainer tests', () => {
    it('claims a container FluxOS runs for itself, whatever docker named it', () => {
      // The distinction from isAppContainer, and the reason both exist: this
      // one is false about an executor container, and a sweep phrased as "stop
      // what is not an app" would therefore stop the node's own work.
      const executor = { Names: ['/adoring_borg'], Labels: { 'runonflux.role': 'fileop' } };

      expect(dockerService.isFluxOwnedContainer(executor)).to.equal(true);
      expect(dockerService.isAppContainer(executor)).to.equal(false);
    });

    it('claims an app container', () => {
      expect(dockerService.isFluxOwnedContainer({
        Names: ['/anything'], Labels: { 'runonflux.role': 'app' },
      })).to.equal(true);
    });

    it('falls back to the name prefix for containers created before labels shipped', () => {
      expect(dockerService.isFluxOwnedContainer({ Names: ['/fluxcomp_myapp'] })).to.equal(true);
      expect(dockerService.isFluxOwnedContainer({ Names: ['/zelcomp_myapp'], Labels: {} })).to.equal(true);
    });

    it('disclaims a container nobody here created', () => {
      expect(dockerService.isFluxOwnedContainer({ Names: ['/watchtower'] })).to.equal(false);
      expect(dockerService.isFluxOwnedContainer({})).to.equal(false);
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

      await expect(dockerService.dockerContainerInspect(containerName)).to.eventually.be.rejectedWith('Container testing1234 not found');
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

  describe('reclaimAppNetworks tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    const listing = (...names) => names.map((Name) => ({ Name }));

    it('removes an app network no installed app accounts for', async () => {
      // The uninstaller is the only thing that removes one, so an uninstall
      // interrupted between the container going and the network going leaves it
      // for ever - holding an octet nothing can hand out again.
      const remove = sinon.stub().resolves();
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves(listing('fluxDockerNetwork_gone'));
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({
        inspect: sinon.stub().resolves({ Name: 'fluxDockerNetwork_gone', Containers: {} }),
        remove,
      });

      const reclaimed = await dockerService.reclaimAppNetworks(new Set());

      expect(reclaimed).to.deep.equal(['fluxDockerNetwork_gone']);
      sinon.assert.calledOnce(remove);
    });

    it('leaves a network an installed app owns', async () => {
      const remove = sinon.stub().resolves();
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves(listing('fluxDockerNetwork_live'));
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({
        inspect: sinon.stub().resolves({ Containers: {} }),
        remove,
      });

      const reclaimed = await dockerService.reclaimAppNetworks(new Set(['fluxDockerNetwork_live']));

      expect(reclaimed).to.deep.equal([]);
      sinon.assert.notCalled(remove);
    });

    it('leaves a network something is attached to, whatever the caller said', async () => {
      // Something is using it, and this is not the thing that decides otherwise.
      const remove = sinon.stub().resolves();
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves(listing('fluxDockerNetwork_busy'));
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({
        inspect: sinon.stub().resolves({ Containers: { abc123: { Name: 'fluxsomething' } } }),
        remove,
      });

      const reclaimed = await dockerService.reclaimAppNetworks(new Set());

      expect(reclaimed).to.deep.equal([]);
      sinon.assert.notCalled(remove);
    });

    it('leaves a network it cannot inspect', async () => {
      const remove = sinon.stub().resolves();
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves(listing('fluxDockerNetwork_unknown'));
      sinon.stub(Dockerode.prototype, 'getNetwork').returns({
        inspect: sinon.stub().rejects(new Error('EAI_AGAIN')),
        remove,
      });

      const reclaimed = await dockerService.reclaimAppNetworks(new Set());

      expect(reclaimed).to.deep.equal([]);
      sinon.assert.notCalled(remove);
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

  describe('getFreeFluxAppNetworkOctet tests', () => {
    const net = (subnet) => ({ Name: 'fluxDockerNetwork_x', IPAM: { Config: [{ Subnet: subnet }] } });

    afterEach(() => {
      sinon.restore();
    });

    it('returns the lowest free octet (1) when only the base network exists', async () => {
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves([net('172.23.0.0/24')]);

      await expect(dockerService.getFreeFluxAppNetworkOctet()).to.eventually.equal(1);
    });

    it('returns the first gap when low octets are already taken', async () => {
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves(
        ['172.23.0.0/24', '172.23.1.0/24', '172.23.2.0/24', '172.23.4.0/24'].map(net),
      );

      await expect(dockerService.getFreeFluxAppNetworkOctet()).to.eventually.equal(3);
    });

    it('ignores subnets outside the 172.23.x.0/24 app range', async () => {
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves(
        ['172.23.1.0/24', '10.0.0.0/24', null].map(net),
      );

      // only octet 1 is a used app subnet, so 2 is the lowest free
      await expect(dockerService.getFreeFluxAppNetworkOctet()).to.eventually.equal(2);
    });

    it('returns null when every 172.23.x.0/24 block is taken', async () => {
      const all = [];
      for (let octet = 0; octet <= 255; octet += 1) all.push(net(`172.23.${octet}.0/24`));
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves(all);

      await expect(dockerService.getFreeFluxAppNetworkOctet()).to.eventually.be.null;
    });

    it('counts NON-flux networks too (docker enforces global subnet uniqueness)', async () => {
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves([
        { Name: 'bridge', IPAM: { Config: [{ Subnet: '172.23.1.0/24' }] } },
        net('172.23.2.0/24'),
      ]);

      // octet 1 (a non-flux network) and 2 (flux) are both used -> 3 is lowest free
      await expect(dockerService.getFreeFluxAppNetworkOctet()).to.eventually.equal(3);
    });

    it('treats excluded octets as used (collision-retry advancement)', async () => {
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves([net('172.23.0.0/24')]);

      await expect(dockerService.getFreeFluxAppNetworkOctet(new Set([1, 2, 3]))).to.eventually.equal(4);
    });

    it('tolerates networks with no IPAM config', async () => {
      sinon.stub(Dockerode.prototype, 'listNetworks').resolves([
        { Name: 'host' },
        { Name: 'none', IPAM: {} },
        net('172.23.1.0/24'),
      ]);

      await expect(dockerService.getFreeFluxAppNetworkOctet()).to.eventually.equal(2);
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

      await expect(dockerService.dockerContainerStats(containerName)).to.eventually.be.rejectedWith('Container test not found');
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

      await expect(dockerService.dockerContainerChanges(containerName)).to.eventually.be.rejectedWith('Container test not found');
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

  describe('fluxRemovedContainers authorship record tests', () => {
    afterEach(() => {
      sinon.restore();
      globalState.fluxRemovedContainers.clear();
    });

    it('records a removal the reconciler can ask about', async () => {
      sinon.stub(Dockerode.prototype, 'listContainers').resolves([{ Id: 'abc', Names: ['/fluxwebsite'] }]);
      sinon.stub(Dockerode.Container.prototype, 'remove').resolves();

      await dockerService.appDockerRemove('website');

      expect([...globalState.fluxRemovedContainers]).to.deep.equal(['fluxwebsite']);
    });

    it('does not record one addressed by raw docker id', async () => {
      // The startup orphan sweep removes by id. The reconciler only ever asks
      // about app containers by identifier, so an entry keyed by a hex id can
      // never be read - and clearFluxRemovedContainers matches on an app name a
      // hex id does not carry, so it can never be dropped either. It would sit
      // in memory for the life of the process, unreadable and undeletable.
      const id = 'a'.repeat(64);
      const list = sinon.stub(Dockerode.prototype, 'listContainers');
      list.onFirstCall().resolves([]);
      list.onSecondCall().resolves([{ Id: id, Names: ['/fluxwebsite'] }]);
      sinon.stub(Dockerode.Container.prototype, 'remove').resolves();

      await dockerService.appDockerForceRemove(id, false);

      expect([...globalState.fluxRemovedContainers], 'an entry no reader wants and no cleanup can reach').to.be.empty;
    });
  });

  describe('getDockerContainerByIdOrName tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('asks docker about one container instead of listing every one', async () => {
      const list = sinon.stub(Dockerode.prototype, 'listContainers').resolves([
        { Id: 'abc123', Names: ['/fluxwebsite'] },
      ]);

      await dockerService.getDockerContainerByIdOrName('website');

      // Every start, stop, remove, inspect, exec and log poll goes through here.
      // Unfiltered, each one enumerates every container on the node.
      const options = list.firstCall.args[0];
      expect(options.all, 'a stopped container is still the container asked for').to.be.true;
      expect(JSON.parse(options.filters)).to.deep.equal({ name: ['fluxwebsite'] });
    });

    it('does not answer for a container whose name merely contains the one asked for', async () => {
      // Docker's name filter is a SUBSTRING match, so asking for `web` returns
      // `fluxwebsite` too. The filter narrows what comes back; the exact
      // comparison is what decides, and dropping it would hand a caller the
      // wrong container to stop or remove.
      sinon.stub(Dockerode.prototype, 'listContainers').resolves([
        { Id: 'abc123', Names: ['/fluxwebsite'] },
        { Id: 'def456', Names: ['/fluxwebsitelong'] },
      ]);

      const container = await dockerService.getDockerContainerByIdOrName('websitelong');

      expect(container.id, 'the exact name must win over the shorter substring match').to.equal('def456');
      await expect(dockerService.getDockerContainerByIdOrName('websit'))
        .to.eventually.be.rejectedWith('Container websit not found');
    });

    it('still resolves a raw docker id, which no name filter can match', async () => {
      const id = 'a'.repeat(64);
      const list = sinon.stub(Dockerode.prototype, 'listContainers');
      list.onFirstCall().resolves([]);
      list.onSecondCall().resolves([{ Id: id, Names: ['/fluxwebsite'] }]);

      const container = await dockerService.getDockerContainerByIdOrName(id);

      expect(container.id).to.equal(id);
      expect(JSON.parse(list.secondCall.args[0].filters), 'the id filter is the fallback, not the first ask').to.deep.equal({ id: [id] });
    });
  });

  describe('dockerContainerLogsPolling tests', () => {
    // Docker frames each write with an 8-byte header (stream id + length) because
    // app containers are created with Tty false. Building the frames here is what
    // makes the line splitting and the position arithmetic testable without a
    // container that logs on demand.
    function dockerFrame(lines) {
      const chunks = lines.map((line) => {
        const body = Buffer.from(`${line}\n`, 'utf8');
        const header = Buffer.alloc(8);
        header.writeUInt8(1, 0);
        header.writeUInt32BE(body.length, 4);
        return Buffer.concat([header, body]);
      });
      return Buffer.concat(chunks);
    }

    const at = (ms, text) => `${new Date(ms).toISOString()} ${text}`;

    function stubLogs(lines) {
      return sinon.stub(Dockerode.Container.prototype, 'logs').resolves(dockerFrame(lines));
    }

    afterEach(() => {
      sinon.restore();
    });

    it('rejects for a container that is not there', async () => {
      await expect(dockerService.dockerContainerLogsPolling('testing1234', {}))
        .to.eventually.be.rejectedWith('Container testing1234 not found');
    });

    it('asks docker to close the connection itself, and answers without waiting', async function test() {
      // `follow: true` never closes, so the only way out was a 1500ms timer and
      // every poll cost 1500ms whether a line was waiting or none. A poll that
      // answers in well under that is the observable half of it.
      this.timeout(10000);
      const logs = stubLogs([at(1000, 'hello')]);
      const started = Date.now();

      const result = await dockerService.dockerContainerLogsPolling('website', { lineCount: 10 });

      expect(Date.now() - started, 'the poll waited on a timer').to.be.below(500);
      expect(logs.firstCall.args[0].follow, 'follow keeps a docker connection open for the life of the container').to.be.false;
      expect(result.lines).to.deep.equal([at(1000, 'hello')]);
    });

    it('bounds a positioned read so docker seeks from the end instead of scanning', async () => {
      // `since` alone has no index to seek with - docker decodes forward from the
      // start of the oldest file until it finds the first match, so it re-reads
      // the whole retained log every poll: 74ms at 3.5MB, 273ms at 14MB. With
      // `tail` present it opens at the END, answers byte-for-byte the same, and
      // stays flat at ~4ms however big the log is.
      const logs = stubLogs([at(1000, 'a')]);

      await dockerService.dockerContainerLogsPolling('website', { lineCount: 100 });
      expect(logs.firstCall.args[0].tail).to.equal(100);
      expect(logs.firstCall.args[0].since).to.equal(undefined);

      await dockerService.dockerContainerLogsPolling('website', {
        position: { ms: 1000, count: 1 }, maxLines: 50,
      });
      // One MORE than a page: docker applies tail after since and returns the
      // NEWEST of the matching set, so the extra frame is what says whether the
      // whole set fitted.
      expect(logs.secondCall.args[0].tail, 'a positioned read is bounded, not unbounded').to.equal(51);
      expect(logs.secondCall.args[0].since).to.equal(1);
    });

    it('re-reads without the bound when the reader is more than a page behind', async () => {
      // The bounded read answered with the END of the log. Handing that back
      // would skip everything between where the reader is and where it starts -
      // a silent gap, which is the failure this whole design exists to prevent.
      const behind = [at(1000, 'a'), at(1001, 'b'), at(1002, 'c'), at(1003, 'd')];
      const logs = sinon.stub(Dockerode.Container.prototype, 'logs');
      logs.onFirstCall().resolves(dockerFrame(behind));      // 4 frames > maxLines 3
      logs.onSecondCall().resolves(dockerFrame(behind));

      const result = await dockerService.dockerContainerLogsPolling('website', {
        position: { ms: 999, count: 0 }, maxLines: 3,
      });

      expect(logs.calledTwice, 'the bounded answer was the wrong page and had to be re-read').to.be.true;
      expect(logs.firstCall.args[0].tail).to.equal(4);
      expect(logs.secondCall.args[0].tail, 'the re-read is unbounded so it starts where the reader is').to.equal(undefined);
      expect(logs.secondCall.args[0].since).to.equal(0.999);
      expect(result.lines).to.deep.equal(behind.slice(0, 3));
      expect(result.truncated, 'the reader must come straight back for the rest').to.be.true;
    });

    it('does not re-read when the whole answer fitted', async () => {
      const logs = stubLogs([at(1000, 'a'), at(1001, 'b')]);

      await dockerService.dockerContainerLogsPolling('website', {
        position: { ms: 999, count: 0 }, maxLines: 50,
      });

      expect(logs.calledOnce, 'a reader keeping up never pays for the scan').to.be.true;
    });

    // Three different questions used to share this path, and only one of them
    // wants the position behaviour. The other two are what every deployed client
    // asks today.
    it('answers a since filter the way it always did, with its line count intact', async () => {
      const logs = stubLogs([at(1000, 'a')]);

      const result = await dockerService.dockerContainerLogsPolling('website', {
        since: 1000, lineCount: 100, maxLines: 5000,
      });

      expect(logs.firstCall.args[0].since).to.equal(1);
      // A typed date is a filter, not a receipt for lines already held: dropping
      // the limit turned "the last 100 lines since Tuesday" into the whole log.
      expect(logs.firstCall.args[0].tail, 'a since filter keeps its line count').to.equal(100);
      // And it can never have lost a position it never had. Reporting rolledOver
      // for it warned of data loss because a hand-typed timestamp does not land
      // exactly on a log line.
      expect(result.rolledOver, 'nothing can have rolled away from a reader holding nothing').to.be.false;
    });

    it('does not cap a caller that is not coming back for the rest', async () => {
      // `all` is a download, not a page. Capping it truncated the log silently,
      // and keeping the OLDEST of the cap showed the start of the log to someone
      // who asked for its end.
      stubLogs([at(1000, 'a'), at(2000, 'b'), at(3000, 'c'), at(4000, 'd')]);

      const result = await dockerService.dockerContainerLogsPolling('website', {
        lineCount: 'all', maxLines: 2,
      });

      expect(result.lines, 'every line, as before').to.have.lengthOf(4);
      expect(result.truncated).to.be.false;
    });

    it('drops the lines the reader already holds and keeps the rest', async () => {
      // since is inclusive, so docker hands back the line asked from. The count
      // says how many of that millisecond were already delivered.
      stubLogs([at(1000, 'one'), at(1000, 'two'), at(2000, 'three')]);

      const result = await dockerService.dockerContainerLogsPolling('website', {
        position: { ms: 1000, count: 2 },
      });

      expect(result.lines).to.deep.equal([at(2000, 'three')]);
      expect(result.rolledOver).to.be.false;
    });

    it('counts rather than compares, so repeated identical lines are not confused', async () => {
      // Two writes of the same text in one millisecond are indistinguishable by
      // content. A reader that de-duplicated by value would drop the new one.
      stubLogs([at(1000, 'retrying'), at(1000, 'retrying'), at(1000, 'retrying')]);

      const result = await dockerService.dockerContainerLogsPolling('website', {
        position: { ms: 1000, count: 2 },
      });

      expect(result.lines, 'the third write is new and the first two are not').to.deep.equal([at(1000, 'retrying')]);
      expect(result.position, 'all three of that millisecond are now held').to.deep.equal({ ms: 1000, count: 3 });
    });

    // A container writing to stdout AND stderr has two writers that each stamp a
    // line before it is serialised into the file, so the file is not in timestamp
    // order - 3,304 backwards steps in 40,000 lines on a real daemon. Every
    // fixture above is in order, which is the assumption this whole design rests
    // on written into the test that was meant to check it.
    it('delivers each line once even when docker returns them out of timestamp order', async () => {
      // `b` is stamped BEFORE `a` but written after it. A reader that has taken
      // a and b holds two lines, and docker will hand both back when asked from
      // a's millisecond - because it stops filtering on `since` once it has found
      // its first match.
      stubLogs([at(1001, 'a'), at(1000, 'b'), at(1002, 'c')]);

      const first = await dockerService.dockerContainerLogsPolling('website', {
        position: { ms: 999, count: 0 }, maxLines: 2,
      });

      expect(first.lines).to.deep.equal([at(1001, 'a'), at(1000, 'b')]);
      // Counting "lines whose ms equals the last one's" gives 1 here and skips
      // one line next time, delivering `b` again. The count is a place in what
      // docker returns, so it is 2.
      expect(first.position.count, 'both delivered lines come back when asked from ms').to.equal(2);
      // 1000 is older than 1001; moving the window back would re-read `a`.
      expect(first.position.ms, 'the position never moves backwards').to.equal(1001);

      sinon.restore();
      stubLogs([at(1001, 'a'), at(1000, 'b'), at(1002, 'c')]);
      const second = await dockerService.dockerContainerLogsPolling('website', { position: first.position });

      expect(second.lines, 'only the line the reader has not seen').to.deep.equal([at(1002, 'c')]);
    });

    it('reports that the line the reader asked from no longer exists', async () => {
      // Docker discarded the file holding it. Everything between it and the
      // oldest line below is gone and no one can fetch it back.
      stubLogs([at(9000, 'later'), at(9001, 'later still')]);

      const result = await dockerService.dockerContainerLogsPolling('website', {
        position: { ms: 1000, count: 1 },
      });

      expect(result.rolledOver, 'a silent gap is the failure this exists to prevent').to.be.true;
      expect(result.lines, 'nothing is skipped - the count belongs to lines that are gone').to.have.lengthOf(2);
    });

    it('caps what one answer carries and says the reader must come back', async () => {
      // Capping belongs to a positioned reader, because only a positioned reader
      // comes back for the remainder.
      stubLogs([at(1000, 'a'), at(2000, 'b'), at(3000, 'c'), at(4000, 'd')]);

      const result = await dockerService.dockerContainerLogsPolling('website', {
        position: { ms: 999, count: 0 }, maxLines: 2,
      });

      expect(result.truncated).to.be.true;
      expect(result.lines).to.deep.equal([at(1000, 'a'), at(2000, 'b')]);
      // The position is where the reader actually got to, not the newest line
      // docker held - otherwise the capped remainder is skipped, silently.
      expect(result.position).to.deep.equal({ ms: 2000, count: 1 });
    });

    it('leaves no gap across a capped read', async () => {
      const all = [at(1000, 'a'), at(2000, 'b'), at(3000, 'c'), at(4000, 'd')];
      stubLogs(all);
      const first = await dockerService.dockerContainerLogsPolling('website', {
        position: { ms: 999, count: 0 }, maxLines: 2,
      });
      sinon.restore();

      stubLogs(all.slice(1));
      const second = await dockerService.dockerContainerLogsPolling('website', {
        position: first.position, maxLines: 2,
      });

      expect([...first.lines, ...second.lines], 'every line exactly once').to.deep.equal(all);
    });
  });

  describe('dockerContainerLogs tests', () => {
    it('should return a valid stats object', async () => {
      const appName = 'website';

      const res = await dockerService.dockerContainerLogs(appName, 2);
      expect(res).to.be.an.instanceOf(Buffer);
      expect(res).to.exist;
    });

    it('should throw an error if container does not exist', async () => {
      const appName = 'testing1234';

      await expect(dockerService.dockerContainerLogs(appName, 2)).to.eventually.be.rejectedWith('Container testing1234 not found');
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
      await expect(dockerService.appDockerStart('testing123')).to.eventually.be.rejectedWith('Container testing123 not found');
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
      await expect(dockerService.appDockerStop('testing123')).to.eventually.be.rejectedWith('Container testing123 not found');
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
      await expect(dockerService.appDockerRestart('testing123')).to.eventually.be.rejectedWith('Container testing123 not found');
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
      await expect(dockerService.appDockerKill('testing123')).to.eventually.be.rejectedWith('Container testing123 not found');
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
      await expect(dockerService.appDockerRemove('testing123')).to.eventually.be.rejectedWith('Container testing123 not found');
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
      await expect(dockerService.appDockerTop('testing123')).to.eventually.be.rejectedWith('Container testing123 not found');
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
      sinon.restore();
    });

    // The request to Flux Storage is signed as this node. A node that cannot
    // sign refuses here rather than sending a header with null where the
    // signature goes and reading the storage's refusal back as a bad URL.
    it('refuses to fetch parameters from Flux Storage when this node cannot sign the request', async () => {
      sinon.stub(fluxCommunicationMessagesSender, 'getFluxMessageSignature').resolves(null);
      const fetch = sinon.stub(serviceHelper, 'axiosGet').resolves({ data: ['A=1'] });
      const nodeApp = {
        ...baseNodeApp,
        enviromentParameters: ['F_S_ENV=https://storage.example/env'],
        containerPorts: [],
        ports: [],
        version: 3,
      };

      await expect(dockerService.appDockerCreate(nodeApp, appName, true))
        .to.eventually.be.rejectedWith('failed to be obtained');

      sinon.assert.notCalled(fetch);
      sinon.assert.notCalled(dockerStub);
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
  describe('loadImage tests', () => {
    const ID = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';

    /** What the daemon writes back: newline-delimited JSON, one object per line. */
    const narration = (lines) => lines.map((line) => `${JSON.stringify(line)}\n`).join('');

    /** Deliver a body in the pieces a network actually hands over. */
    const delivered = (pieces) => {
      const stream = new PassThrough();
      process.nextTick(() => {
        pieces.forEach((piece) => stream.write(piece));
        stream.end();
      });
      return stream;
    };

    afterEach(() => {
      sinon.restore();
    });

    it('finds an id whose line arrived in two pieces', async () => {
      // The bug this covers. The narration was matched by concatenating chunks
      // and then clearing the buffer on EVERY chunk, so nothing was ever
      // carried forward: a line split across two writes matched neither half,
      // and an archive that did contain the image reported that it did not -
      // and the node went and asked more peers for thirteen megabytes it
      // already had.
      const body = narration([{ stream: `Loaded image ID: ${ID}\n` }]);
      const half = Math.floor(body.length / 2);
      sinon.stub(Dockerode.prototype, 'loadImage')
        .resolves(delivered([body.slice(0, half), body.slice(half)]));

      const loaded = await dockerService.loadImage(new PassThrough());

      expect(loaded.ids).to.deep.equal([ID]);
    });

    it('reports a tagged image too, under the name it was given', async () => {
      // Docker says "Loaded image ID:" for an untagged image and "Loaded
      // image:" for a tagged one. Reading only the first form left anything
      // tagged on the disk with nothing that could name it - carrying whatever
      // name the sender chose.
      sinon.stub(Dockerode.prototype, 'loadImage').resolves(delivered([narration([
        { stream: `Loaded image ID: ${ID}\n` },
        { stream: 'Loaded image: runonflux/website:latest\n' },
      ])]));

      const loaded = await dockerService.loadImage(new PassThrough());

      expect(loaded.ids).to.deep.equal([ID]);
      expect(loaded.tags).to.deep.equal(['runonflux/website:latest']);
    });

    it('reports every id an archive brought, not just the first', async () => {
      const second = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
      sinon.stub(Dockerode.prototype, 'loadImage').resolves(delivered([narration([
        { stream: `Loaded image ID: ${ID}\n` },
        { stream: `Loaded image ID: ${second}\n` },
      ])]));

      const loaded = await dockerService.loadImage(new PassThrough());

      expect(loaded.ids).to.deep.equal([ID, second]);
    });

    it('says nothing arrived when the daemon named nothing', async () => {
      sinon.stub(Dockerode.prototype, 'loadImage')
        .resolves(delivered([narration([{ stream: 'The archive was empty\n' }])]));

      const loaded = await dockerService.loadImage(new PassThrough());

      expect(loaded).to.deep.equal({ ids: [], tags: [] });
    });
  });

  describe('archiveNames tests', () => {
    // Real archives on a real disk: what this reads is a tar's own bytes, and a
    // stubbed reader would only prove the stub parses JSON.
    const tar = require('tar');
    const realFs = require('fs');
    const nodeOs = require('os');
    let dir;

    const archiveOf = async (manifest) => {
      if (manifest !== null) {
        realFs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
      }
      realFs.writeFileSync(path.join(dir, 'layer.tar'), 'not really a layer');
      const entries = manifest === null ? ['layer.tar'] : ['manifest.json', 'layer.tar'];
      const file = path.join(dir, 'image.tar');
      await tar.c({ file, cwd: dir }, entries);
      return file;
    };

    beforeEach(() => { dir = realFs.mkdtempSync(path.join(nodeOs.tmpdir(), 'fluxarch-')); });
    afterEach(() => { realFs.rmSync(dir, { recursive: true, force: true }); });

    it('reports every name an archive declares', async () => {
      const file = await archiveOf([
        { Config: 'a.json', RepoTags: ['ghcr.io/x/y:v1'], Layers: ['layer.tar'] },
        { Config: 'b.json', RepoTags: ['ghcr.io/x/z:v2', 'ghcr.io/x/z:latest'], Layers: ['layer.tar'] },
      ]);

      expect(await dockerService.archiveNames(file))
        .to.deep.equal(['ghcr.io/x/y:v1', 'ghcr.io/x/z:v2', 'ghcr.io/x/z:latest']);
    });

    it('reports nothing for an archive addressed by id, which is what this node serves', async () => {
      // docker save <id> writes RepoTags: null - that is the shape an honest
      // peer sends, and the only shape the fetch accepts.
      const file = await archiveOf([{ Config: 'a.json', RepoTags: null, Layers: ['layer.tar'] }]);

      expect(await dockerService.archiveNames(file)).to.deep.equal([]);
    });

    it('refuses a compressed archive without reading it', async () => {
      // node-tar inflates gzip transparently, so the ceiling a peer's archive is
      // taken under would be counting the compressed bytes: 32MB of zeros at
      // level 9 becomes about 34GB, which is a minute of inflate before anything
      // is rejected. This node's serve path writes a plain tar, so an archive
      // that arrives compressed is doing something we never do.
      const plain = await archiveOf([{ Config: 'a.json', RepoTags: ['ghcr.io/x/y:v1'], Layers: ['layer.tar'] }]);
      const compressed = path.join(dir, 'image.tar.gz');
      realFs.writeFileSync(compressed, require('zlib').gzipSync(realFs.readFileSync(plain)));

      // The same archive, so what is refused is the format rather than anything
      // about its content.
      expect(await dockerService.archiveNames(plain)).to.deep.equal(['ghcr.io/x/y:v1']);
      await expect(dockerService.archiveNames(compressed)).to.be.rejectedWith(/compressed/);
    });

    it('refuses an archive with no manifest rather than calling it empty', async () => {
      // Reported as a bad archive, not as "the peer did not have it": the
      // second reads as an ordinary miss and sends the caller to another peer.
      const file = await archiveOf(null);

      await expect(dockerService.archiveNames(file)).to.be.rejectedWith(/no manifest/);
    });

    it('refuses a manifest too big to be describing one image', async () => {
      // The archive around it is a file and bounded; this entry is read into
      // memory, so it needs a ceiling of its own. A real manifest measures
      // ~1.2KB, and the format's own limit puts a single image at ~10KB of
      // layer paths, so nothing legitimate comes near this.
      const file = await archiveOf([{
        Config: 'a.json',
        RepoTags: [`ghcr.io/x/${'y'.repeat(64 * 1024)}:v1`],
        Layers: ['layer.tar'],
      }]);

      await expect(dockerService.archiveNames(file)).to.be.rejectedWith(/not describing one image/);
    });
  });

  describe('tagImage tests', () => {
    const ID = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
    let getImageStub;

    afterEach(() => {
      if (getImageStub) getImageStub.restore();
      getImageStub = null;
    });

    it('names an image, splitting the reference the way the daemon wants it', async () => {
      // The daemon takes the repository and the tag as separate fields, so the
      // reference has to be taken apart. A registry host carries a colon of its
      // own when it names a port, which is why the tag is cut from the LAST one
      // and only when no slash follows it.
      const tag = sinon.stub().resolves();
      getImageStub = sinon.stub(Dockerode.prototype, 'getImage').returns({ tag });

      await dockerService.tagImage(ID, 'fluxregistry:5000/runonflux/flux-volume-tools:v1.1.0');

      expect(getImageStub.calledOnceWith(ID)).to.equal(true);
      expect(tag.calledOnceWith({
        repo: 'fluxregistry:5000/runonflux/flux-volume-tools',
        tag: 'v1.1.0',
      })).to.equal(true);
    });

    it('defaults the tag when the reference carries none', async () => {
      const tag = sinon.stub().resolves();
      getImageStub = sinon.stub(Dockerode.prototype, 'getImage').returns({ tag });

      await dockerService.tagImage(ID, 'fluxregistry:5000/runonflux/flux-volume-tools');

      expect(tag.calledOnceWith({
        repo: 'fluxregistry:5000/runonflux/flux-volume-tools',
        tag: 'latest',
      })).to.equal(true);
    });
  });
});
