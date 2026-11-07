const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { RemovalOutcome } = require('../../ZelBack/src/services/utils/removalOutcome');

describe('unregisteredEnterpriseCleanup', () => {
  let installed;
  let containers;
  let volumes;
  let globalSpecs;
  let messages;
  let testInstallingApps;
  let removeAppLocally;
  let findOneInDatabase;
  let log;

  const leftover = (change = {}) => ({
    version: 8, name: 'fluxnode3865700434', owner: '1H1r6VtV4LVUhUe3HLTvT47dxcm9nKHJSk', enterprise: 'blob', compose: [], contacts: [], expire: 22060, ...change,
  });
  const container = (name, image = 'org/image:latest') => ({ Names: [`/${name}`], Image: image });

  function load({ isArcane = false } = {}) {
    return proxyquire('../../ZelBack/src/services/appLifecycle/unregisteredEnterpriseCleanup', {
      config: { database: { appsglobal: { database: 'globalzelapps' } } },
      '../dbHelper': {
        databaseConnection: () => ({ db: () => 'database' }),
        findOneInDatabase,
      },
      '../../lib/log': log,
      '../utils/globalState': { testInstallingApps },
      '../utils/appConstants': { globalAppsInformation: 'zelappsinformation', globalAppsMessages: 'zelappsmessages', isArcane },
      '../appQuery/appQueryService': {
        installedApps: async () => ({ status: 'success', data: installed }),
        listAllApps: async () => ({ status: 'success', data: containers }),
      },
      '../utils/volumeService': { getComponentAppIdsFromVolumeFiles: async () => volumes },
      './appUninstaller': { removeAppLocally },
    });
  }

  beforeEach(() => {
    installed = [leftover()];
    containers = [container('fluxweb_fluxnode3865700434', '2ndtlmining/flux:latest'), container('fluxweb_otherapp'), container('fluxweb_fluxnode38657004345')];
    volumes = { appIds: ['fluxweb_fluxnode3865700434'], conclusive: true };
    globalSpecs = [];
    messages = [];
    testInstallingApps = new Set();
    removeAppLocally = sinon.stub().resolves(RemovalOutcome.REMOVED);
    log = { warn: sinon.stub(), error: sinon.stub(), info: sinon.stub() };
    findOneInDatabase = sinon.stub().callsFake(async (_db, collection, query) => {
      const pattern = collection === 'zelappsinformation' ? query.name : query['appSpecifications.name'];
      const names = collection === 'zelappsinformation' ? globalSpecs : messages;
      return names.find((name) => pattern.test(name)) ? { name: 'found' } : null;
    });
  });

  afterEach(() => sinon.restore());

  it('removes a never-registered enterprise app by the components its containers name, with no ports', async () => {
    const removed = await load().removeUnregisteredEnterpriseApps();

    expect(removed).to.deep.equal(['fluxnode3865700434']);
    sinon.assert.calledOnce(removeAppLocally);
    const [name, res, force, endResponse, sendMessage, { specifications }] = removeAppLocally.firstCall.args;
    expect([name, res, force, endResponse, sendMessage]).to.deep.equal(['fluxfluxnode3865700434', null, true, false, true]);
    expect(specifications.compose).to.deep.equal([{ name: 'web', repotag: '2ndtlmining/flux:latest', ports: [] }]);
    expect(specifications.enterprise).to.equal('');
  });

  [
    ['on an Arcane node', () => ({ isArcane: true })],
    ['an app that is not enterprise', () => { installed = [leftover({ enterprise: '' })]; }],
    ['an app of a version before 8', () => { installed = [leftover({ version: 7 })]; }],
    ['an app with a height', () => { installed = [leftover({ height: 3033163 })]; }],
    ['an app with a height of zero', () => { installed = [leftover({ height: 0 })]; }],
    ['an app being test installed', () => { testInstallingApps.add('fluxnode3865700434'); }],
    ['an app with a global specification', () => { globalSpecs = ['fluxnode3865700434']; }],
    ['an app with a global specification under another case', () => { globalSpecs = ['FluxNode3865700434']; }],
    ['an app with a permanent message', () => { messages = ['fluxnode3865700434']; }],
  ].forEach(([description, arrange]) => {
    it(`leaves ${description}`, async () => {
      const options = arrange() || {};

      const removed = await load(options).removeUnregisteredEnterpriseApps();

      expect(removed).to.deep.equal([]);
      sinon.assert.notCalled(removeAppLocally);
    });
  });

  it('removes nothing more once a registry read fails', async () => {
    installed = [leftover(), leftover({ name: 'helloworld3514967465' })];
    findOneInDatabase.rejects(new Error('database gone'));

    const removed = await load().removeUnregisteredEnterpriseApps();

    expect(removed).to.deep.equal([]);
    sinon.assert.notCalled(removeAppLocally);
    sinon.assert.calledWithMatch(log.error, /database gone/);
  });

  it('removes nothing when the node\'s containers cannot be listed', async () => {
    const cleanup = proxyquire('../../ZelBack/src/services/appLifecycle/unregisteredEnterpriseCleanup', {
      config: { database: { appsglobal: { database: 'globalzelapps' } } },
      '../dbHelper': { databaseConnection: () => ({ db: () => 'database' }), findOneInDatabase },
      '../../lib/log': log,
      '../utils/globalState': { testInstallingApps },
      '../utils/appConstants': { globalAppsInformation: 'zelappsinformation', globalAppsMessages: 'zelappsmessages', isArcane: false },
      '../appQuery/appQueryService': {
        installedApps: async () => ({ status: 'success', data: installed }),
        listAllApps: async () => ({ status: 'error', data: { message: 'docker gone' } }),
      },
      '../utils/volumeService': { getComponentAppIdsFromVolumeFiles: async () => volumes },
      './appUninstaller': { removeAppLocally },
    });

    expect(await cleanup.removeUnregisteredEnterpriseApps()).to.deep.equal([]);
    sinon.assert.notCalled(removeAppLocally);
    sinon.assert.calledWithMatch(log.error, /containers could not be listed/);
  });

  it('removes a component that only a volume image names', async () => {
    containers = [];

    await load().removeUnregisteredEnterpriseApps();

    expect(removeAppLocally.firstCall.args[5].specifications.compose).to.deep.equal([{ name: 'web', ports: [] }]);
  });

  it('removes each component once, by the container and the volume image that both name it', async () => {
    volumes = { appIds: ['fluxweb_fluxnode3865700434', 'fluxdb_fluxnode3865700434'], conclusive: true };

    await load().removeUnregisteredEnterpriseApps();

    expect(removeAppLocally.firstCall.args[5].specifications.compose).to.deep.equal([
      { name: 'web', repotag: '2ndtlmining/flux:latest', ports: [] },
      { name: 'db', ports: [] },
    ]);
  });

  it('removes nothing more when an app\'s volume images cannot all be found', async () => {
    volumes = { appIds: [], conclusive: false };

    expect(await load().removeUnregisteredEnterpriseApps()).to.deep.equal([]);
    sinon.assert.notCalled(removeAppLocally);
    sinon.assert.calledWithMatch(log.error, /volume images of fluxnode3865700434 could not all be found/);
  });

  it('names an app whose name does not start with flux by its docker name too', async () => {
    installed = [leftover({ name: 'helloworld3514967465' })];
    containers = [container('fluxweb_helloworld3514967465')];
    volumes = { appIds: ['fluxweb_helloworld3514967465'], conclusive: true };

    await load().removeUnregisteredEnterpriseApps();

    expect(removeAppLocally.firstCall.args[0]).to.equal('fluxhelloworld3514967465');
  });

  it('reports only the apps whose removal completed', async () => {
    installed = [leftover(), leftover({ name: 'helloworld3514967465' })];
    removeAppLocally.withArgs('fluxfluxnode3865700434').resolves(RemovalOutcome.FAILED);

    const removed = await load().removeUnregisteredEnterpriseApps();

    expect(removed).to.deep.equal(['helloworld3514967465']);
    sinon.assert.calledTwice(removeAppLocally);
  });
});
