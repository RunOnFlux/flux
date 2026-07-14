const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// containerHealthMonitor's monitorAndRecoverApps (the old hourly restart
// actuator) was removed by the reconciler rearchitecture — restart/start
// decisions live in appReconciler now (see appReconciler.test.js). What
// remains here is the recreate path: rebuilding a missing container from the
// local spec, and the masterSlave wrapper that escalates to removal when
// recreation is impossible.

describe('containerHealthMonitor tests', () => {
  let containerHealthMonitor;
  let dockerServiceStub;
  let dbHelperStub;
  let appInstallerStub;
  let appUninstallerStub;
  let appInspectorStub;
  let tamperingStub;
  let volumeServiceStub;
  let appSpec;

  beforeEach(() => {
    appSpec = {
      name: 'testapp',
      compose: [
        {
          name: 'web', cpu: 1, ram: 1000, hdd: 10, cpucumulus: 2, ramcumulus: 2000, hddcumulus: 20,
        },
        {
          name: 'db', cpu: 1, ram: 1000, hdd: 10,
        },
      ],
    };

    dockerServiceStub = {
      getDockerContainerOnly: sinon.stub().resolves(null),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: () => ({}) }),
      findOneInDatabase: sinon.stub().resolves(appSpec),
    };

    appInstallerStub = {
      installApplicationHard: sinon.stub().resolves(),
      installApplicationSoft: sinon.stub().resolves(),
    };

    appUninstallerStub = {
      removeAppLocally: sinon.stub().resolves(),
    };

    appInspectorStub = { startAppMonitoring: sinon.stub() };

    tamperingStub = {
      recordEvent: sinon.stub().resolves(),
      isNetworkMissingError: sinon.stub().returns(false),
    };

    volumeServiceStub = { verifyAppVolumeMount: sinon.stub().resolves(false) };

    containerHealthMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/containerHealthMonitor', {
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../dbHelper': dbHelperStub,
      '../dockerService': dockerServiceStub,
      '../generalService': { nodeTier: sinon.stub().resolves('cumulus') },
      '../appLifecycle/appInstaller': appInstallerStub,
      '../appLifecycle/appUninstaller': appUninstallerStub,
      '../appManagement/appInspector': appInspectorStub,
      '../appTamperingDetectionService': tamperingStub,
      '../utils/globalState': { appsMonitored: new Map() },
      '../appQuery/appQueryService': { decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => apps) },
      '../utils/appConstants': { localAppsInformation: 'localAppsInformation' },
      '../utils/volumeService': volumeServiceStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('recreateMissingContainers', () => {
    it('throws when the app is not in the local database', async () => {
      dbHelperStub.findOneInDatabase.resolves(null);
      let err;
      try {
        await containerHealthMonitor.recreateMissingContainers('web_testapp');
      } catch (e) { err = e; }
      expect(err).to.be.an('error');
      expect(err.message).to.include('not found in local database');
      expect(appInstallerStub.installApplicationHard.called).to.be.false;
    });

    it('throws when the spec has no components', async () => {
      dbHelperStub.findOneInDatabase.resolves({ name: 'testapp', compose: [] });
      let err;
      try {
        await containerHealthMonitor.recreateMissingContainers('web_testapp');
      } catch (e) { err = e; }
      expect(err).to.be.an('error');
      expect(err.message).to.include('no components');
    });

    it('throws when the component is not part of the app', async () => {
      let err;
      try {
        await containerHealthMonitor.recreateMissingContainers('ghost_testapp');
      } catch (e) { err = e; }
      expect(err).to.be.an('error');
      expect(err.message).to.include('Component ghost not found');
    });

    it('soft-installs a single component when its volume is still mounted', async () => {
      volumeServiceStub.verifyAppVolumeMount.resolves(true);
      await containerHealthMonitor.recreateMissingContainers('web_testapp');
      expect(appInstallerStub.installApplicationSoft.calledOnce).to.be.true;
      expect(appInstallerStub.installApplicationHard.called).to.be.false;
      const [componentSpec, mainAppName] = appInstallerStub.installApplicationSoft.firstCall.args;
      expect(componentSpec.name).to.equal('web');
      expect(mainAppName).to.equal('testapp');
    });

    it('hard-installs a single component when its volume is gone', async () => {
      volumeServiceStub.verifyAppVolumeMount.resolves(false);
      await containerHealthMonitor.recreateMissingContainers('web_testapp');
      expect(appInstallerStub.installApplicationHard.calledOnce).to.be.true;
      expect(appInstallerStub.installApplicationSoft.called).to.be.false;
    });

    it('applies node-tier resource overrides to the component spec', async () => {
      await containerHealthMonitor.recreateMissingContainers('web_testapp');
      const [componentSpec] = appInstallerStub.installApplicationHard.firstCall.args;
      expect(componentSpec.cpu).to.equal(2);
      expect(componentSpec.ram).to.equal(2000);
      expect(componentSpec.hdd).to.equal(20);
    });

    it('recreates every component for a whole-app identifier', async () => {
      await containerHealthMonitor.recreateMissingContainers('testapp');
      expect(appInstallerStub.installApplicationHard.callCount).to.equal(2);
      const recreated = appInstallerStub.installApplicationHard.getCalls().map((c) => c.args[0].name);
      expect(recreated).to.deep.equal(['web', 'db']);
    });

    describe('softOnly (the network-detach heal)', () => {
      // A hard install runs createAppVolume: fallocate + mke2fs on the app's volume
      // file, i.e. it REFORMATS the app's data. The heal deliberately force-removes a
      // LIVE container whose data is intact, so it must never be able to trigger that
      // fallback - a transient verifyAppVolumeMount failure would wipe user data.
      it('throws instead of hard-installing a component whose volume cannot be verified', async () => {
        volumeServiceStub.verifyAppVolumeMount.resolves(false);
        let err;
        try {
          await containerHealthMonitor.recreateMissingContainers('web_testapp', { softOnly: true });
        } catch (e) { err = e; }

        expect(err).to.be.an('error');
        expect(err.message).to.include('without reformatting its volume');
        expect(appInstallerStub.installApplicationHard.called, 'must never reformat the data volume of a container it was asked to rebuild softly').to.be.false;
      });

      it('throws instead of hard-installing on the whole-app path', async () => {
        volumeServiceStub.verifyAppVolumeMount.resolves(false);
        let err;
        try {
          await containerHealthMonitor.recreateMissingContainers('testapp', { softOnly: true });
        } catch (e) { err = e; }

        expect(err).to.be.an('error');
        expect(appInstallerStub.installApplicationHard.called).to.be.false;
      });

      it('still soft-installs normally when the volume is verified', async () => {
        volumeServiceStub.verifyAppVolumeMount.resolves(true);

        await containerHealthMonitor.recreateMissingContainers('web_testapp', { softOnly: true });

        expect(appInstallerStub.installApplicationSoft.calledOnce).to.be.true;
      });

      it('leaves the default (vanished-container) path free to hard-install', async () => {
        volumeServiceStub.verifyAppVolumeMount.resolves(false);

        await containerHealthMonitor.recreateMissingContainers('web_testapp');

        expect(appInstallerStub.installApplicationHard.calledOnce, 'a container that is gone anyway may still be rebuilt from scratch').to.be.true;
      });
    });
  });

});
