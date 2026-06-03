const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('containerHealthMonitor tests', () => {
  let containerHealthMonitor;
  let globalStateStub;
  let dockerServiceStub;
  let dbHelperStub;
  let registryManagerStub;
  let appInstallerStub;
  let appUninstallerStub;
  let stoppedAppsCache;

  beforeEach(() => {
    globalStateStub = {
      waitForBootContainerStateSettled: sinon.stub().resolves(),
      isOperationInProgress: sinon.stub().returns(false),
      backupInProgress: [],
      restoreInProgress: [],
      appsMonitored: new Map(),
    };

    dockerServiceStub = {
      getDockerContainerOnly: sinon.stub().resolves(null),
      appDockerStart: sinon.stub().resolves(),
      dockerListContainers: sinon.stub().resolves([]),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: () => ({}) }),
      findInDatabase: sinon.stub().resolves([]),
      findOneInDatabase: sinon.stub().resolves(null),
    };

    registryManagerStub = {
      getApplicationGlobalSpecifications: sinon.stub().resolves(null),
    };

    appInstallerStub = {
      installApplicationHard: sinon.stub().resolves(),
      installApplicationSoft: sinon.stub().resolves(),
    };

    appUninstallerStub = {
      removeAppLocally: sinon.stub().resolves(),
    };

    stoppedAppsCache = new Map();

    containerHealthMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/containerHealthMonitor', {
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../dbHelper': dbHelperStub,
      '../dockerService': dockerServiceStub,
      '../generalService': { nodeTier: sinon.stub().resolves('cumulus') },
      '../appDatabase/registryManager': registryManagerStub,
      '../appLifecycle/appInstaller': appInstallerStub,
      '../appLifecycle/appUninstaller': appUninstallerStub,
      '../appManagement/appInspector': { startAppMonitoring: sinon.stub() },
      '../appTamperingDetectionService': { recordEvent: sinon.stub().resolves(), isNetworkMissingError: sinon.stub().returns(false) },
      '../utils/globalState': globalStateStub,
      '../utils/cacheManager': { default: { stoppedAppsCache } },
      '../appQuery/appQueryService': { decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => apps) },
      '../utils/appConstants': { localAppsInformation: 'localAppsInformation' },
      '../utils/volumeService': { verifyAppVolumeMount: sinon.stub().resolves(false) },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('monitorAndRecoverApps', () => {
    it('should wait for bootComplete before proceeding', async () => {
      let monitorResolved = false;
      globalStateStub.waitForBootContainerStateSettled = sinon.stub().returns(
        new Promise((resolve) => { setTimeout(resolve, 50); }),
      );

      const promise = containerHealthMonitor.monitorAndRecoverApps('10.0.0.1', [], [])
        .then(() => { monitorResolved = true; });
      await new Promise((r) => setImmediate(r));
      expect(monitorResolved).to.be.false;
      await promise;
      expect(monitorResolved).to.be.true;
      expect(globalStateStub.waitForBootContainerStateSettled.calledOnce).to.be.true;
    });
  });

  describe('monitorAndRecoverApps - per-component g: handling', () => {
    // Mixed compose app: n8n uses g: master/slave mode, pgcluster must run on all instances
    const mixedSpec = {
      version: 8,
      name: 'MixedApp',
      hash: 'mixhash',
      compose: [
        { name: 'n8n', containerData: 'g:/home/node/.n8n' },
        { name: 'pgcluster', containerData: '/var/lib/postgresql/data' },
      ],
    };

    const rOnlySpec = {
      version: 8,
      name: 'RApp',
      hash: 'rhash',
      compose: [
        { name: 'web', containerData: 'r:/data' },
      ],
    };

    it('auto-starts a stopped non-g component of a mixed compose app and leaves the g: sibling alone', async () => {
      // Both components stopped (e.g. right after masterSlaveApps whole-app stop on a standby,
      // or after a node reboot). The non-g component must auto-start; the g: component must be
      // left for masterSlaveApps to manage.
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves(mixedSpec);

      // Both containers exist (created but stopped)
      dockerServiceStub.getDockerContainerOnly.withArgs('n8n_MixedApp').resolves({ Id: 'n8n' });
      dockerServiceStub.getDockerContainerOnly.withArgs('pgcluster_MixedApp').resolves({ Id: 'pg' });

      // Pre-warm the stopped-apps cache so the auto-restart fires on this cycle
      stoppedAppsCache.set('pgcluster_MixedApp', '');

      await containerHealthMonitor.monitorAndRecoverApps('10.0.0.1:16127', [mixedSpec], []);

      expect(dockerServiceStub.appDockerStart.calledWith('pgcluster_MixedApp')).to.equal(true);
      expect(dockerServiceStub.appDockerStart.calledWith('n8n_MixedApp')).to.equal(false);
      expect(appInstallerStub.installApplicationHard.called).to.equal(false);
      expect(appUninstallerStub.removeAppLocally.called).to.equal(false);
    });

    it('does not auto-start a stopped g: component (managed by masterSlaveApps)', async () => {
      // Steady state on a standby node: pgcluster running, n8n (g:) stopped.
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves(mixedSpec);

      // The g: component's container exists - handleMissingMasterSlaveContainer must
      // short-circuit and never start or recreate it.
      dockerServiceStub.getDockerContainerOnly.withArgs('n8n_MixedApp').resolves({ Id: 'n8n' });

      // Pre-warm cache to prove the cache warmup path is NOT what keeps the g: component stopped
      stoppedAppsCache.set('n8n_MixedApp', '');

      await containerHealthMonitor.monitorAndRecoverApps('10.0.0.1:16127', [mixedSpec], ['pgcluster_MixedApp']);

      expect(dockerServiceStub.appDockerStart.called).to.equal(false);
      expect(appInstallerStub.installApplicationHard.called).to.equal(false);
      expect(appUninstallerStub.removeAppLocally.called).to.equal(false);
    });

    it('does not apply the 30-minute syncthing grace to a non-syncthing sibling of a g: app', async () => {
      // The non-g component was installed less than 30 minutes ago. The grace period is meant
      // for syncthing data sync only - the non-g component must still start immediately.
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves(mixedSpec);
      dockerServiceStub.getDockerContainerOnly.withArgs('pgcluster_MixedApp').resolves({ Id: 'pg' });

      // runningSince very recent -> inside the 30 min window
      dbHelperStub.findOneInDatabase.resolves({ runningSince: new Date().toISOString() });

      stoppedAppsCache.set('pgcluster_MixedApp', '');

      await containerHealthMonitor.monitorAndRecoverApps('10.0.0.1:16127', [mixedSpec], ['n8n_MixedApp']);

      expect(dockerServiceStub.appDockerStart.calledWith('pgcluster_MixedApp')).to.equal(true);
    });

    it('applies the 30-minute grace to a stopped r: component installed less than 30m ago', async () => {
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('RApp').resolves(rOnlySpec);
      dockerServiceStub.getDockerContainerOnly.withArgs('web_RApp').resolves({ Id: 'web' });

      // runningSince very recent -> inside the 30 min window -> must NOT start yet
      dbHelperStub.findOneInDatabase.resolves({ runningSince: new Date().toISOString() });

      stoppedAppsCache.set('web_RApp', '');

      await containerHealthMonitor.monitorAndRecoverApps('10.0.0.1:16127', [rOnlySpec], []);

      expect(dockerServiceStub.appDockerStart.called).to.equal(false);
      expect(appUninstallerStub.removeAppLocally.called).to.equal(false);
    });

    it('starts a stopped r: component once the 30-minute grace has passed', async () => {
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('RApp').resolves(rOnlySpec);
      dockerServiceStub.getDockerContainerOnly.withArgs('web_RApp').resolves({ Id: 'web' });

      // runningSince 31 minutes ago -> grace passed
      dbHelperStub.findOneInDatabase.resolves({ runningSince: new Date(Date.now() - 31 * 60 * 1000).toISOString() });

      stoppedAppsCache.set('web_RApp', '');

      await containerHealthMonitor.monitorAndRecoverApps('10.0.0.1:16127', [rOnlySpec], []);

      expect(dockerServiceStub.appDockerStart.calledWith('web_RApp')).to.equal(true);
    });

    it('still includes g:/r: apps in masterSlaveAppsInstalled for broadcast even with stopped components', async () => {
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves(mixedSpec);
      dockerServiceStub.getDockerContainerOnly.resolves({ Id: 'x' });

      const result = await containerHealthMonitor.monitorAndRecoverApps('10.0.0.1:16127', [mixedSpec], ['pgcluster_MixedApp']);

      // The app must still be broadcast as installed-and-running so standby nodes
      // stay in apps/location and remain promotion-eligible.
      expect(result.masterSlaveAppsInstalled).to.deep.include(mixedSpec);
    });
  });
});
