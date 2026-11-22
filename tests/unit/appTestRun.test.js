const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const proxyquire = require('proxyquire').noCallThru();

describe('appTestRun tests', () => {
  let root;
  let dockerService;
  let hwRequirements;
  let appTestRun;
  let containers;
  let networks;
  let created;

  const testRunContainer = (runId, component, image = 'org/web:1') => ({
    Id: `id-${runId}-${component}`,
    Names: [`/testrun-${runId}-${component}`],
    Labels: { 'runonflux.role': 'testrun', 'runonflux.testrun': runId },
    Image: image,
  });
  const appContainer = (name, image) => ({
    Id: `id-${name}`, Names: [`/flux${name}`], Labels: { 'runonflux.role': 'app' }, Image: image,
  });
  const res = () => ({ write: sinon.stub(), flush: sinon.stub() });
  const appSpecs = () => ({
    name: 'trialapp',
    version: 4,
    compose: [{
      name: 'web', repotag: 'org/web:1', cpu: 0.5, ram: 500, hdd: 5, containerData: '/data', environmentParameters: [], commands: [],
    }],
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'testrun-'));
    containers = [];
    networks = [];
    created = [];
    const containerHandle = (id) => ({
      id,
      remove: sinon.stub().callsFake(async () => { containers = containers.filter((c) => c.Id !== id); }),
      start: sinon.stub().resolves(),
      inspect: sinon.stub().resolves({ State: { Running: true, ExitCode: 0 } }),
    });
    dockerService = {
      dockerListContainers: sinon.stub().callsFake(async () => [...containers]),
      getDockerContainer: sinon.stub().callsFake((id) => containerHandle(id)),
      dockerListNetworks: sinon.stub().callsFake(async () => [...networks]),
      dockerGetNetwork: sinon.stub().callsFake((id) => ({ id })),
      dockerRemoveNetwork: sinon.stub().callsFake(async (network) => { networks = networks.filter((n) => n.Id !== network.id); }),
      dockerCreateNetwork: sinon.stub().callsFake(async (options) => { networks.push({ Id: options.Name, Name: options.Name, Labels: options.Labels }); }),
      appDockerImageRemove: sinon.stub().resolves(),
      imageExists: sinon.stub().resolves(false),
      declaredEnvAndCmd: sinon.stub().callsFake(async (component) => ({ envParams: component.environmentParameters, adjustedCommands: component.commands })),
      expandStorageAndNodeEnv: sinon.stub().resolves(),
      createContainer: sinon.stub().callsFake(async (options) => {
        created.push(options);
        containers.push({
          Id: options.name, Names: [`/${options.name}`], Labels: options.Labels, Image: options.Image,
        });
        return containerHandle(options.name);
      }),
      dockerContainerLogs: sinon.stub().resolves('boom'),
    };
    hwRequirements = { hwShortfall: sinon.stub().resolves(null) };
    appTestRun = proxyquire('../../ZelBack/src/services/appLifecycle/appTestRun', {
      config: { fluxapps: { testRunWatchMs: 1 }, server: { fluxNodeServiceAddress: '127.0.0.1' } },
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../dockerService': dockerService,
      '../serviceHelper': {
        ensureString: (message) => JSON.stringify(message),
        delay: sinon.stub().resolves(),
        runCommand: async (command, { params }) => {
          if (command === 'mkdir') fs.mkdirSync(params[1], { recursive: true });
          return {};
        },
      },
      '../messageHelper': {
        createSuccessMessage: (message) => ({ status: 'success', data: { message } }),
        createErrorMessage: (message) => ({ status: 'error', data: { message } }),
      },
      '../generalService': { nodeTier: sinon.stub().resolves('cumulus') },
      '../IOUtils': { removeDirectory: async (target) => { fs.rmSync(target, { recursive: true, force: true }); return true; } },
      '../appRequirements/hwRequirements': hwRequirements,
      '../utils/volumeConstructor': { validateMountConfiguration: () => true },
      '../utils/appConstants': { appsFolderPath: path.join(root, 'ZelApps') },
      '../utils/fluxEventBus': { publish: sinon.stub() },
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    sinon.restore();
  });

  describe('the sweep', () => {
    it('removes what earlier runs left: their containers, networks, directories, and the images they pulled', async () => {
      containers.push(testRunContainer('aaaa', 'web'));
      networks.push({ Id: 'net-aaaa', Name: 'testrun-aaaa', Labels: { 'runonflux.role': 'testrun', 'runonflux.testrun': 'aaaa' } });
      fs.mkdirSync(path.join(appTestRun.ROOT, 'aaaa', 'web', 'appdata'), { recursive: true });
      fs.writeFileSync(path.join(appTestRun.ROOT, 'aaaa', 'pulled.json'), JSON.stringify(['org/web:1']));

      await appTestRun.sweep();

      expect(containers).to.deep.equal([]);
      expect(networks).to.deep.equal([]);
      sinon.assert.calledOnceWithExactly(dockerService.appDockerImageRemove, 'org/web:1');
      expect(fs.readdirSync(appTestRun.ROOT)).to.deep.equal([]);
    });

    it('leaves app containers, and an image an app container uses', async () => {
      containers.push(testRunContainer('aaaa', 'web'), appContainer('web_realapp', 'org/web:1'));
      fs.mkdirSync(path.join(appTestRun.ROOT, 'aaaa'), { recursive: true });
      fs.writeFileSync(path.join(appTestRun.ROOT, 'aaaa', 'pulled.json'), JSON.stringify(['org/web:1']));

      await appTestRun.sweep();

      expect(containers.map((c) => c.Id)).to.deep.equal(['id-web_realapp']);
      sinon.assert.notCalled(dockerService.appDockerImageRemove);
    });

    it('leaves a container that carries only one of the two marks', async () => {
      const labelledOnly = { ...testRunContainer('aaaa', 'web'), Names: ['/somethingelse'] };
      const namedOnly = { ...testRunContainer('bbbb', 'web'), Labels: {} };
      containers.push(labelledOnly, namedOnly);

      await appTestRun.sweep();

      expect(containers).to.have.lengthOf(2);
    });
  });

  describe('a run', () => {
    beforeEach(async () => {
      await appTestRun.sweep();
    });

    it('runs the containers outside the app machinery, at the resources declared, and removes them after', async () => {
      const response = res();

      expect(await appTestRun.run(appSpecs(), response, { pull: sinon.stub().resolves() })).to.equal(true);

      const [options] = created;
      expect(options.name).to.match(/^testrun-[0-9a-f]{8}-web$/);
      expect(options.Labels['runonflux.role']).to.equal('testrun');
      expect(options.Labels).to.not.have.property('runonflux.app');
      expect(options.HostConfig).to.not.have.property('PortBindings');
      expect(options.HostConfig.NetworkMode).to.match(/^testrun-[0-9a-f]{8}$/);
      expect(options.HostConfig.NanoCPUs).to.equal(0.5 * 1e9);
      expect(options.HostConfig.Memory).to.equal(500 * 1024 * 1024);
      expect(options.HostConfig.RestartPolicy).to.deep.equal({ Name: 'no' });
      expect(options.HostConfig.Mounts[0].Source.startsWith(appTestRun.ROOT)).to.equal(true);
      expect(options.HostConfig.Mounts[0].Target).to.equal('/data');
      expect(containers, 'the containers are gone').to.deep.equal([]);
      expect(networks, 'the network is gone').to.deep.equal([]);
      sinon.assert.calledOnceWithExactly(dockerService.appDockerImageRemove, 'org/web:1');
      expect(fs.readdirSync(appTestRun.ROOT), 'the directories are gone').to.deep.equal([]);
    });

    it('keeps an image the node already held', async () => {
      dockerService.imageExists.resolves(true);

      await appTestRun.run(appSpecs(), res(), { pull: sinon.stub().resolves() });

      sinon.assert.notCalled(dockerService.appDockerImageRemove);
    });

    it('reports a container that did not keep running, with its exit code', async () => {
      dockerService.createContainer.callsFake(async (options) => {
        containers.push({
          Id: options.name, Names: [`/${options.name}`], Labels: options.Labels, Image: options.Image,
        });
        return {
          id: options.name, start: sinon.stub().resolves(), inspect: sinon.stub().resolves({ State: { Running: false, ExitCode: 127, OOMKilled: false } }),
        };
      });
      const response = res();

      expect(await appTestRun.run(appSpecs(), response, { pull: sinon.stub().resolves() })).to.equal(false);

      expect(response.write.args.flat().join('')).to.include('exit code 127');
      expect(containers).to.deep.equal([]);
    });

    it('refuses an app the node cannot run at the resources it declares, creating nothing', async () => {
      hwRequirements.hwShortfall.resolves('Insufficient RAM on Flux Node to spawn an application');

      let thrown;
      await appTestRun.run(appSpecs(), res(), { pull: sinon.stub().resolves() }).catch((error) => { thrown = error; });

      expect(thrown.message).to.include('Insufficient RAM');
      sinon.assert.notCalled(dockerService.createContainer);
    });

    it('refuses a second run while one is in progress', async () => {
      let release;
      let reached;
      const pulling = new Promise((resolve) => { reached = resolve; });
      const pull = sinon.stub().callsFake(() => {
        reached();
        return new Promise((resolve) => { release = resolve; });
      });
      const first = appTestRun.run(appSpecs(), res(), { pull });
      await pulling;

      let thrown;
      await appTestRun.run(appSpecs(), res(), { pull: sinon.stub().resolves() }).catch((error) => { thrown = error; });
      release();
      await first;

      expect(thrown.message).to.include('already in progress');
    });

    it('removes what it created when it fails part way', async () => {
      dockerService.createContainer.rejects(new Error('no such image'));

      await appTestRun.run(appSpecs(), res(), { pull: sinon.stub().resolves() }).catch(() => {});

      expect(networks).to.deep.equal([]);
      expect(fs.readdirSync(appTestRun.ROOT)).to.deep.equal([]);
    });
  });

  it('starts no run until a sweep has succeeded', async () => {
    dockerService.dockerListContainers.rejects(new Error('docker unreachable'));

    let thrown;
    await appTestRun.run(appSpecs(), res(), { pull: sinon.stub().resolves() }).catch((error) => { thrown = error; });

    expect(thrown.message).to.include('docker unreachable');
    sinon.assert.notCalled(dockerService.createContainer);
  });
});
