const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

chai.use(chaiAsPromised);
const { expect } = chai;

describe('appNetworkLinker tests', () => {
  let appNetworkLinker;
  let dbHelperStub;
  let dockerServiceStub;
  let registryManagerStub;
  let logStub;

  const configStub = {
    database: {
      appslocal: { database: 'localapps' },
      appsglobal: { database: 'globalapps' },
    },
    fluxapps: { manageDependencyOnlyLifecycle: true },
  };

  const appConstantsStub = {
    localAppsInformation: 'localAppsInformation',
    globalAppsInformation: 'globalAppsInformation',
    APP_NAME_REGEX: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
  };

  beforeEach(() => {
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns('appsDB') }),
      findOneInDatabase: sinon.stub(),
      findInDatabase: sinon.stub(),
    };
    dockerServiceStub = {
      appDockerNetworkConnect: sinon.stub().resolves(),
      getAppContainerNames: sinon.stub().resolves([]),
      getAppContainerObjects: sinon.stub().resolves([{ State: 'running' }]),
    };
    registryManagerStub = {
      getApplicationSpecifications: sinon.stub(),
    };
    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

    appNetworkLinker = proxyquire('../../ZelBack/src/services/appLifecycle/appNetworkLinker', {
      config: configStub,
      '../dbHelper': dbHelperStub,
      '../dockerService': dockerServiceStub,
      '../appDatabase/registryManager': registryManagerStub,
      '../../lib/log': logStub,
      '../utils/appConstants': appConstantsStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('parseNetworkWith', () => {
    it('returns [] when description is not a string', () => {
      expect(appNetworkLinker.parseNetworkWith(undefined)).to.eql([]);
      expect(appNetworkLinker.parseNetworkWith(null)).to.eql([]);
      expect(appNetworkLinker.parseNetworkWith(123)).to.eql([]);
      expect(appNetworkLinker.parseNetworkWith('')).to.eql([]);
    });

    it('returns [] when no token is present', () => {
      expect(appNetworkLinker.parseNetworkWith('just a normal description')).to.eql([]);
    });

    it('parses an unquoted token embedded in free text', () => {
      expect(appNetworkLinker.parseNetworkWith('My great app. networkWith:[appA,appB]')).to.eql(['appA', 'appB']);
    });

    it('parses a quoted JSON-style token', () => {
      expect(appNetworkLinker.parseNetworkWith('text networkWith:["appA","appB"]')).to.eql(['appA', 'appB']);
    });

    it('tolerates spaces, the = separator and a case-insensitive key', () => {
      expect(appNetworkLinker.parseNetworkWith('NETWORKWITH = [ appA , appB ]')).to.eql(['appA', 'appB']);
    });

    it('drops invalid names and deduplicates', () => {
      expect(appNetworkLinker.parseNetworkWith('networkWith:[appA,appA,bad name,inv@lid,appB]')).to.eql(['appA', 'appB']);
    });

    it('returns [] for empty brackets', () => {
      expect(appNetworkLinker.parseNetworkWith('networkWith:[]')).to.eql([]);
    });

    it('returns [] when brackets are missing (malformed)', () => {
      expect(appNetworkLinker.parseNetworkWith('networkWith:appA,appB')).to.eql([]);
    });

    it('does not match networkWith embedded inside a larger word', () => {
      expect(appNetworkLinker.parseNetworkWith('mynetworkWith:[appA]')).to.eql([]);
    });

    it('accepts app names containing internal hyphens', () => {
      expect(appNetworkLinker.parseNetworkWith('networkWith:[my-app]')).to.eql(['my-app']);
    });
  });

  describe('getLinkedApps', () => {
    it('excludes a self-reference to the app itself', () => {
      const specs = { name: 'appA', description: 'networkWith:[appA,appB]' };
      expect(appNetworkLinker.getLinkedApps(specs)).to.eql(['appB']);
    });

    it('returns [] when the app has no name', () => {
      expect(appNetworkLinker.getLinkedApps({ description: 'networkWith:[appB]' })).to.eql([]);
    });

    it('returns [] for a falsy app spec', () => {
      expect(appNetworkLinker.getLinkedApps(null)).to.eql([]);
    });
  });

  describe('checkAppNetworkRequirements', () => {
    it('resolves true and touches no database when there are no linked apps', async () => {
      const result = await appNetworkLinker.checkAppNetworkRequirements({ name: 'appB', description: 'plain text', owner: 'owner1' });
      expect(result).to.equal(true);
      sinon.assert.notCalled(dbHelperStub.findOneInDatabase);
    });

    it('throws a NETWORK_DEPENDENCY_NOT_READY error when a linked app is not installed locally', async () => {
      dbHelperStub.findOneInDatabase.resolves(null);
      let thrown = null;
      try {
        await appNetworkLinker.checkAppNetworkRequirements({ name: 'appB', description: 'networkWith:[appA]', owner: 'owner1' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).to.be.an('error');
      expect(thrown.message).to.match(/is not installed on this node/);
      // tagged so the spawner short-retries instead of hard-failing (order-independent)
      expect(thrown.code).to.equal('NETWORK_DEPENDENCY_NOT_READY');
    });

    it('throws a hard (untagged) error when a linked app is owned by a different owner', async () => {
      dbHelperStub.findOneInDatabase.resolves({ name: 'appA', owner: 'owner2' });
      let thrown = null;
      try {
        await appNetworkLinker.checkAppNetworkRequirements({ name: 'appB', description: 'networkWith:[appA]', owner: 'owner1' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).to.be.an('error');
      expect(thrown.message).to.match(/owned by a different owner/);
      // a misconfiguration, not a timing issue - must NOT be short-retried
      expect(thrown.code).to.not.equal('NETWORK_DEPENDENCY_NOT_READY');
    });

    it('resolves true when every linked app is installed, same owner, and running', async () => {
      dbHelperStub.findOneInDatabase.resolves({ name: 'appA', owner: 'owner1' });
      const result = await appNetworkLinker.checkAppNetworkRequirements({ name: 'appB', description: 'networkWith:[appA]', owner: 'owner1' });
      expect(result).to.equal(true);
    });

    it('defers (NETWORK_DEPENDENCY_NOT_READY) when a linked app is installed but not running', async () => {
      dbHelperStub.findOneInDatabase.resolves({ name: 'appA', owner: 'owner1' });
      dockerServiceStub.getAppContainerObjects.resolves([{ State: 'exited' }]);
      let thrown = null;
      try {
        await appNetworkLinker.checkAppNetworkRequirements({ name: 'appB', description: 'networkWith:[appA]', owner: 'owner1' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).to.be.an('error');
      expect(thrown.message).to.match(/installed but not running/);
      expect(thrown.code).to.equal('NETWORK_DEPENDENCY_NOT_READY');
    });
  });

  describe('connectComponentToLinkedApps', () => {
    it('does nothing when the app declares no network links', async () => {
      await appNetworkLinker.connectComponentToLinkedApps('fluxweb_appB', { name: 'appB', description: 'plain text' });
      sinon.assert.notCalled(dockerServiceStub.appDockerNetworkConnect);
    });

    it('connects the container to every linked app network', async () => {
      await appNetworkLinker.connectComponentToLinkedApps('fluxweb_appB', { name: 'appB', description: 'networkWith:[appA,appC]' });
      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxweb_appB', 'fluxDockerNetwork_appA');
      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxweb_appB', 'fluxDockerNetwork_appC');
    });

    it('propagates a connection failure so the install is rolled back', async () => {
      dockerServiceStub.appDockerNetworkConnect.rejects(new Error('docker boom'));
      await expect(appNetworkLinker.connectComponentToLinkedApps('c', { name: 'appB', description: 'networkWith:[appA]' }))
        .to.be.rejectedWith('docker boom');
    });
  });

  describe('reconnectLinkedApps', () => {
    it('reconnects only the apps that are networked with the given app', async () => {
      dbHelperStub.findInDatabase.resolves([
        { name: 'appB', description: 'networkWith:[appA]' },
        { name: 'appC', description: 'no links here' },
        { name: 'appA', description: 'networkWith:[appA]' },
      ]);
      dockerServiceStub.getAppContainerNames.withArgs('appB').resolves(['fluxweb_appB', 'fluxapi_appB']);
      dockerServiceStub.getAppContainerNames.withArgs('appC').resolves(['fluxweb_appC']);

      await appNetworkLinker.reconnectLinkedApps('appA');

      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxweb_appB', 'fluxDockerNetwork_appA');
      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxapi_appB', 'fluxDockerNetwork_appA');
      expect(dockerServiceStub.appDockerNetworkConnect.calledWith('fluxweb_appC')).to.equal(false);
    });

    it('does not throw when the database read fails', async () => {
      dbHelperStub.findInDatabase.rejects(new Error('db down'));
      await expect(appNetworkLinker.reconnectLinkedApps('appA')).to.not.be.rejected;
    });
  });

  describe('findLinkedAppLogCollector', () => {
    it('returns null when there are no linked apps', async () => {
      const result = await appNetworkLinker.findLinkedAppLogCollector({ name: 'appB', description: 'no token' });
      expect(result).to.equal(null);
      sinon.assert.notCalled(registryManagerStub.getApplicationSpecifications);
    });

    it('returns the first linked app exposing a LOG=COLLECT component', async () => {
      registryManagerStub.getApplicationSpecifications.withArgs('appA').resolves({
        name: 'appA',
        compose: [
          { name: 'web', environmentParameters: ['FOO=BAR'] },
          { name: 'logsink', environmentParameters: ['LOG=COLLECT'] },
        ],
      });

      const result = await appNetworkLinker.findLinkedAppLogCollector({
        name: 'appB',
        description: 'networkWith:[appA]',
      });

      expect(result).to.eql({ linkedAppName: 'appA', collectorComponentName: 'logsink' });
    });

    it('accepts the legacy enviromentParameters (typo) field', async () => {
      registryManagerStub.getApplicationSpecifications.withArgs('appA').resolves({
        name: 'appA',
        compose: [{ name: 'logsink', enviromentParameters: ['LOG=COLLECT'] }],
      });

      const result = await appNetworkLinker.findLinkedAppLogCollector({
        name: 'appB',
        description: 'networkWith:[appA]',
      });

      expect(result).to.eql({ linkedAppName: 'appA', collectorComponentName: 'logsink' });
    });

    it('skips linked apps with blanked compose (enterprise on non-Arcane)', async () => {
      registryManagerStub.getApplicationSpecifications.withArgs('appA').resolves({ name: 'appA', compose: [] });
      registryManagerStub.getApplicationSpecifications.withArgs('appC').resolves({
        name: 'appC',
        compose: [{ name: 'collector', environmentParameters: ['LOG=COLLECT'] }],
      });

      const result = await appNetworkLinker.findLinkedAppLogCollector({
        name: 'appB',
        description: 'networkWith:[appA,appC]',
      });

      expect(result).to.eql({ linkedAppName: 'appC', collectorComponentName: 'collector' });
    });

    it('returns null when no linked app exposes a LOG=COLLECT component', async () => {
      registryManagerStub.getApplicationSpecifications.withArgs('appA').resolves({
        name: 'appA',
        compose: [{ name: 'web', environmentParameters: ['FOO=BAR'] }],
      });

      const result = await appNetworkLinker.findLinkedAppLogCollector({
        name: 'appB',
        description: 'networkWith:[appA]',
      });

      expect(result).to.equal(null);
    });

    it('continues past a spec lookup that throws', async () => {
      registryManagerStub.getApplicationSpecifications.withArgs('appA').rejects(new Error('db down'));
      registryManagerStub.getApplicationSpecifications.withArgs('appC').resolves({
        name: 'appC',
        compose: [{ name: 'collector', environmentParameters: ['LOG=COLLECT'] }],
      });

      const result = await appNetworkLinker.findLinkedAppLogCollector({
        name: 'appB',
        description: 'networkWith:[appA,appC]',
      });

      expect(result).to.eql({ linkedAppName: 'appC', collectorComponentName: 'collector' });
    });
  });

  describe('reconcileAllAppNetworkLinks', () => {
    it('connects every linked app to each of its linked app networks', async () => {
      dbHelperStub.findInDatabase.resolves([
        { name: 'appB', description: 'networkWith:[appA]' },
        { name: 'appC', description: 'plain' },
      ]);
      dockerServiceStub.getAppContainerNames.withArgs('appB').resolves(['fluxweb_appB']);

      await appNetworkLinker.reconcileAllAppNetworkLinks();

      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxweb_appB', 'fluxDockerNetwork_appA');
    });

    it('does not throw when the database read fails', async () => {
      dbHelperStub.findInDatabase.rejects(new Error('db down'));
      await expect(appNetworkLinker.reconcileAllAppNetworkLinks()).to.not.be.rejected;
    });
  });

  describe('parseDependencyOnly', () => {
    it('returns true for dependencyOnly=true and dependencyOnly:true', () => {
      expect(appNetworkLinker.parseDependencyOnly('collector dependencyOnly=true')).to.equal(true);
      expect(appNetworkLinker.parseDependencyOnly('collector dependencyOnly:true')).to.equal(true);
      expect(appNetworkLinker.parseDependencyOnly('DEPENDENCYONLY = TRUE')).to.equal(true);
    });

    it('returns false when absent, malformed, or only mentioned in prose', () => {
      expect(appNetworkLinker.parseDependencyOnly('plain app')).to.equal(false);
      expect(appNetworkLinker.parseDependencyOnly('this is dependencyOnly a note')).to.equal(false);
      expect(appNetworkLinker.parseDependencyOnly('dependencyOnly=false')).to.equal(false);
      expect(appNetworkLinker.parseDependencyOnly('')).to.equal(false);
      expect(appNetworkLinker.parseDependencyOnly(undefined)).to.equal(false);
    });
  });

  describe('computeRequiredDependencyNames', () => {
    const owner = 'owner1';
    const alloy = { name: 'alloy', owner, description: 'alloy dependencyOnly=true' };
    const datadog = { name: 'datadog', owner, description: 'datadog dependencyOnly=true networkWith:[alloy]' };
    const game = (suffix) => ({ name: `game-${suffix}`, owner, description: 'game networkWith:[alloy,datadog]' });
    const req = (apps) => [...appNetworkLinker.computeRequiredDependencyNames(apps)].sort();

    it('requires nothing when only collectors are present (no workload)', () => {
      expect(req([alloy])).to.deep.equal([]);
      expect(req([alloy, datadog])).to.deep.equal([]);
    });

    it('pulls collectors transitively from a workload (game -> datadog -> alloy)', () => {
      expect(req([alloy, datadog, game('a')])).to.deep.equal(['alloy', 'datadog']);
    });

    it('keeps collectors while at least one workload remains', () => {
      expect(req([alloy, datadog, game('a'), game('b')])).to.deep.equal(['alloy', 'datadog']);
      expect(req([alloy, datadog, game('a')])).to.deep.equal(['alloy', 'datadog']);
    });

    it('requires nothing once the last workload is gone', () => {
      expect(req([alloy, datadog])).to.deep.equal([]);
    });

    it('does not follow links across owners', () => {
      const foreignGame = { name: 'g', owner: 'owner2', description: 'game networkWith:[alloy]' };
      expect(req([alloy, foreignGame])).to.deep.equal([]);
    });
  });

  describe('findUnrequiredInstalledDependencies', () => {
    const owner = 'owner1';
    const alloy = { name: 'alloy', owner, description: 'alloy dependencyOnly=true' };
    const datadog = { name: 'datadog', owner, description: 'datadog dependencyOnly=true networkWith:[alloy]' };
    const game = { name: 'game-a', owner, description: 'game networkWith:[alloy,datadog]' };

    it('returns orphaned collectors when no workload remains', async () => {
      dbHelperStub.findInDatabase.resolves([alloy, datadog]);
      const orphans = await appNetworkLinker.findUnrequiredInstalledDependencies();
      expect(orphans.map((a) => a.name).sort()).to.deep.equal(['alloy', 'datadog']);
    });

    it('returns nothing while a workload still requires them', async () => {
      dbHelperStub.findInDatabase.resolves([alloy, datadog, game]);
      const orphans = await appNetworkLinker.findUnrequiredInstalledDependencies();
      expect(orphans).to.deep.equal([]);
    });

    it('never returns a workload (non dependencyOnly app)', async () => {
      dbHelperStub.findInDatabase.resolves([game]);
      const orphans = await appNetworkLinker.findUnrequiredInstalledDependencies();
      expect(orphans).to.deep.equal([]);
    });
  });

  describe('findInstalledWorkloadsRequiring', () => {
    const owner = 'owner1';
    const alloy = { name: 'alloy', owner, description: 'alloy dependencyOnly=true' };
    const datadog = { name: 'datadog', owner, description: 'datadog dependencyOnly=true networkWith:[alloy]' };
    const gameA = { name: 'game-a', owner, description: 'game networkWith:[alloy,datadog]' };
    const gameB = { name: 'game-b', owner, description: 'game networkWith:[datadog]' };

    it('finds workloads that directly require a dependency', async () => {
      dbHelperStub.findInDatabase.resolves([alloy, datadog, gameA, gameB]);
      const workloads = await appNetworkLinker.findInstalledWorkloadsRequiring('datadog');
      expect(workloads.map((a) => a.name).sort()).to.deep.equal(['game-a', 'game-b']);
    });

    it('finds workloads that require a dependency transitively (game -> datadog -> alloy)', async () => {
      dbHelperStub.findInDatabase.resolves([alloy, datadog, gameA, gameB]);
      const workloads = await appNetworkLinker.findInstalledWorkloadsRequiring('alloy');
      expect(workloads.map((a) => a.name).sort()).to.deep.equal(['game-a', 'game-b']);
    });

    it('never returns a dependencyOnly app, only workloads', async () => {
      dbHelperStub.findInDatabase.resolves([alloy, datadog, gameA]);
      const workloads = await appNetworkLinker.findInstalledWorkloadsRequiring('alloy');
      expect(workloads.map((a) => a.name)).to.not.include('datadog');
      expect(workloads.map((a) => a.name)).to.deep.equal(['game-a']);
    });

    it('does not follow links across owners', async () => {
      const foreignGame = { name: 'g', owner: 'owner2', description: 'game networkWith:[alloy]' };
      dbHelperStub.findInDatabase.resolves([alloy, foreignGame]);
      const workloads = await appNetworkLinker.findInstalledWorkloadsRequiring('alloy');
      expect(workloads).to.deep.equal([]);
    });

    it('returns [] when nothing requires the dependency, and when nothing is installed', async () => {
      dbHelperStub.findInDatabase.resolves([alloy, datadog]);
      expect(await appNetworkLinker.findInstalledWorkloadsRequiring('alloy')).to.deep.equal([]);
      dbHelperStub.findInDatabase.resolves([]);
      expect(await appNetworkLinker.findInstalledWorkloadsRequiring('alloy')).to.deep.equal([]);
    });
  });

  describe('isAppRunning', () => {
    it('true when every container is running', async () => {
      dockerServiceStub.getAppContainerObjects.resolves([{ State: 'running' }, { State: 'running' }]);
      expect(await appNetworkLinker.isAppRunning('app')).to.equal(true);
    });

    it('false when any container is not running', async () => {
      dockerServiceStub.getAppContainerObjects.resolves([{ State: 'running' }, { State: 'exited' }]);
      expect(await appNetworkLinker.isAppRunning('app')).to.equal(false);
    });

    it('false when the app has no containers', async () => {
      dockerServiceStub.getAppContainerObjects.resolves([]);
      expect(await appNetworkLinker.isAppRunning('app')).to.equal(false);
    });
  });

  describe('getRequiredDependencyNamesForNode', () => {
    const owner = 'owner1';
    const ip = '1.2.3.4';
    const alloy = {
      name: 'alloy', owner, description: 'alloy dependencyOnly=true', nodes: [ip],
    };
    const datadog = {
      name: 'datadog', owner, description: 'datadog dependencyOnly=true networkWith:[alloy]', nodes: [ip],
    };
    const game = {
      name: 'game-a', owner, description: 'game networkWith:[alloy,datadog]', nodes: [ip],
    };

    it('returns empty when no node address is provided', async () => {
      const result = await appNetworkLinker.getRequiredDependencyNamesForNode(null);
      expect([...result]).to.deep.equal([]);
    });

    it('computes the required set from apps assigned to this node', async () => {
      dbHelperStub.findInDatabase.resolves([alloy, datadog, game]);
      const result = await appNetworkLinker.getRequiredDependencyNamesForNode(ip);
      expect([...result].sort()).to.deep.equal(['alloy', 'datadog']);
    });

    it('ignores apps assigned to other nodes', async () => {
      const otherGame = {
        name: 'game-x', owner, description: 'game networkWith:[alloy]', nodes: ['9.9.9.9'],
      };
      dbHelperStub.findInDatabase.resolves([alloy, otherGame]);
      const result = await appNetworkLinker.getRequiredDependencyNamesForNode(ip);
      expect([...result]).to.deep.equal([]);
    });
  });
});
