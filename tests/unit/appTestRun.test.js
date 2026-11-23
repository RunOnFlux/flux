const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const proxyquire = require('proxyquire').noCallThru();

describe('appTestRun tests', () => {
  let root;
  let dockerService;
  let axiosGet;
  let checkpoint;
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
  const appSpecs = (component = {}) => ({
    name: 'trialapp',
    version: 4,
    compose: [{
      name: 'web', repotag: 'org/web:1', cpu: 0.5, ram: 500, hdd: 5, containerData: '/data', environmentParameters: [], commands: [], containerPorts: [9001], ...component,
    }],
  });
  const written = (response) => response.write.args.flat().join('');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'testrun-'));
    containers = [];
    networks = [];
    created = [];
    dockerService = {
      dockerListContainers: sinon.stub().callsFake(async () => [...containers]),
      appDockerForceRemove: sinon.stub().callsFake(async (id) => { containers = containers.filter((c) => c.Id !== id); }),
      appDockerStart: sinon.stub().resolves(),
      dockerContainerInspect: sinon.stub().callsFake(async (id) => ({
        State: { Running: true, ExitCode: 0 },
        NetworkSettings: { Networks: { [id.replace(/-web$/, '')]: { IPAddress: '172.30.0.2' } } },
      })),
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
        return { id: options.name };
      }),
      dockerContainerLogs: sinon.stub().resolves('boom'),
    };
    axiosGet = sinon.stub().resolves({ data: { initialTestStatus: true, failed: false } });
    checkpoint = sinon.stub().resolves();
    appTestRun = proxyquire('../../ZelBack/src/services/appLifecycle/appTestRun', {
      config: { server: { fluxNodeServiceAddress: '127.0.0.1' } },
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../dockerService': dockerService,
      '../serviceHelper': {
        ensureString: (message) => JSON.stringify(message),
        delay: sinon.stub().resolves(),
        axiosGet,
        runCommand: async (command, { params }) => {
          if (command === 'mkdir') fs.mkdirSync(params[1], { recursive: true });
          return {};
        },
      },
      '../messageHelper': {
        createSuccessMessage: (message) => ({ status: 'success', data: { message } }),
        createErrorMessage: (message) => ({ status: 'error', data: { message } }),
      },
      '../IOUtils': { removeDirectory: async (target) => { fs.rmSync(target, { recursive: true, force: true }); return true; } },
      '../utils/volumeConstructor': { validateMountConfiguration: () => true },
      '../utils/appConstants': { appsFolderPath: path.join(root, 'ZelApps') },
      '../utils/fluxEventBus': { publish: sinon.stub(), checkpoint, Checkpoint: { TESTRUN_BEFORE_REMOVAL: 'testrun:beforeRemoval' } },
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

    it('runs the containers outside the app machinery, at 0.2 CPU and 300 MB in flux.slice, and removes them after', async () => {
      const response = res();

      expect(await appTestRun.run(appSpecs({ cpu: 3, ram: 6000 }), response, { pull: sinon.stub().resolves() })).to.equal(true);

      const [options] = created;
      expect(options.name).to.match(/^testrun-[0-9a-f]{8}-web$/);
      expect(options.Labels['runonflux.role']).to.equal('testrun');
      expect(options.Labels).to.not.have.property('runonflux.app');
      expect(options.HostConfig).to.not.have.property('PortBindings');
      expect(options.HostConfig.NetworkMode).to.match(/^testrun-[0-9a-f]{8}$/);
      expect(options.HostConfig.NanoCPUs).to.equal(0.2 * 1e9);
      expect(options.HostConfig.Memory).to.equal(300 * 1024 * 1024);
      expect(options.HostConfig.CgroupParent).to.equal('flux.slice');
      expect(options.HostConfig.RestartPolicy).to.deep.equal({ Name: 'no' });
      expect(options.HostConfig.Mounts[0].Source.startsWith(appTestRun.ROOT)).to.equal(true);
      expect(options.HostConfig.Mounts[0].Target).to.equal('/data');
      expect(containers, 'the containers are gone').to.deep.equal([]);
      expect(networks, 'the network is gone').to.deep.equal([]);
      sinon.assert.calledOnceWithExactly(dockerService.appDockerImageRemove, 'org/web:1');
      expect(fs.readdirSync(appTestRun.ROOT), 'the directories are gone').to.deep.equal([]);
      expect(written(response)).to.include('Flux App trialapp successfully installed and launched');
      sinon.assert.notCalled(axiosGet);
      sinon.assert.calledOnceWithExactly(checkpoint, 'testrun:beforeRemoval', 'trialapp');
    });

    it('keeps an image the node already held', async () => {
      dockerService.imageExists.resolves(true);

      await appTestRun.run(appSpecs(), res(), { pull: sinon.stub().resolves() });

      sinon.assert.notCalled(dockerService.appDockerImageRemove);
    });

    it('reports a container that exited, with its exit code', async () => {
      dockerService.dockerContainerInspect.resolves({ State: { Running: false, ExitCode: 127, OOMKilled: false } });
      const response = res();

      expect(await appTestRun.run(appSpecs(), response, { pull: sinon.stub().resolves() })).to.equal(false);

      expect(written(response)).to.include('exit code 127');
      expect(written(response)).to.not.include('successfully installed');
      expect(containers).to.deep.equal([]);
    });

    it('passes a Deploy with Git container once its build reports it passed, asked at its address on the run\'s network', async () => {
      const response = res();

      expect(await appTestRun.run(appSpecs({ repotag: 'runonflux/orbit:latest' }), response, { pull: sinon.stub().resolves() })).to.equal(true);

      sinon.assert.calledOnce(axiosGet);
      expect(axiosGet.firstCall.args[0]).to.equal('http://172.30.0.2:9001/api/status');
      expect(written(response)).to.include('Orbit initial test passed for web_trialapp');
      expect(written(response)).to.include('successfully installed and launched');
    });

    it('fails a Deploy with Git container whose build failed, with its reason, and removes it', async () => {
      axiosGet.resolves({ data: { initialTestStatus: true, failed: true, failure_reason: 'npm run build exited 1' } });
      const response = res();

      expect(await appTestRun.run(appSpecs({ repotag: 'runonflux/orbit:latest' }), response, { pull: sinon.stub().resolves() })).to.equal(false);

      expect(written(response)).to.include('Orbit deployment failed: npm run build exited 1');
      expect(written(response)).to.not.include('successfully installed');
      expect(containers).to.deep.equal([]);
    });

    it('fails a Deploy with Git container whose build never reports, after two minutes of polls', async () => {
      axiosGet.resolves({ data: { initialTestStatus: false } });
      const response = res();

      expect(await appTestRun.run(appSpecs({ repotag: 'runonflux/orbit:latest' }), response, { pull: sinon.stub().resolves() })).to.equal(false);

      sinon.assert.callCount(axiosGet, 24);
      expect(written(response)).to.include('did not complete within 2 minutes');
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
