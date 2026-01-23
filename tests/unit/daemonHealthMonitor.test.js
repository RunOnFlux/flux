// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('daemonHealthMonitor tests', () => {
  let daemonHealthMonitor;
  let serviceHelperStub;
  let globalStateStub;
  let logStub;
  let daemonServiceMiscRpcsStub;
  let registryManagerStub;
  let appUninstallerStub;
  let clock;

  beforeEach(() => {
    // Restore any existing clock first
    if (clock) {
      clock.restore();
    }

    // Create stubs
    serviceHelperStub = {
      delay: sinon.stub().resolves(),
    };

    globalStateStub = {
      removalInProgress: false,
      installationInProgress: false,
      softRedeployInProgress: false,
      hardRedeployInProgress: false,
    };

    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    daemonServiceMiscRpcsStub = {
      isDaemonSynced: sinon.stub(),
    };

    registryManagerStub = {
      getInstalledApps: sinon.stub(),
    };

    appUninstallerStub = {
      removeAppLocally: sinon.stub().resolves(),
    };

    // Use proxyquire to inject stubs
    daemonHealthMonitor = proxyquire.noCallThru()('../../ZelBack/src/services/appMonitoring/daemonHealthMonitor', {
      '../serviceHelper': serviceHelperStub,
      '../utils/globalState': globalStateStub,
      '../../lib/log': logStub,
      '../daemonService/daemonServiceMiscRpcs': daemonServiceMiscRpcsStub,
      '../appDatabase/registryManager': registryManagerStub,
      '../appLifecycle/appUninstaller': appUninstallerStub,
    });
  });

  afterEach(() => {
    sinon.restore();
    if (clock) {
      clock.restore();
      clock = null;
    }
  });

  describe('checkDaemonHealthAndCleanup tests', () => {
    it('should skip checks when removal is in progress', async () => {
      globalStateStub.removalInProgress = true;
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });

      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(daemonServiceMiscRpcsStub.isDaemonSynced.called).to.be.false;
    });

    it('should skip checks when installation is in progress', async () => {
      globalStateStub.installationInProgress = true;
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });

      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(daemonServiceMiscRpcsStub.isDaemonSynced.called).to.be.false;
    });

    it('should skip checks when soft redeploy is in progress', async () => {
      globalStateStub.softRedeployInProgress = true;
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });

      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(daemonServiceMiscRpcsStub.isDaemonSynced.called).to.be.false;
    });

    it('should skip checks when hard redeploy is in progress', async () => {
      globalStateStub.hardRedeployInProgress = true;
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });

      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(daemonServiceMiscRpcsStub.isDaemonSynced.called).to.be.false;
    });

    it('should reset state when daemon is synced after being unsynced', async () => {
      // First call - daemon becomes unsynced
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();
      expect(logStub.warn.calledWith('Daemon detected as unsynced, starting health monitoring')).to.be.true;

      // Second call - daemon is synced again
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: true } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(logStub.info.calledWith('Daemon sync recovered, resetting health monitor state')).to.be.true;
    });

    it('should do nothing when daemon is synced and was never unsynced', async () => {
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: true } });

      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(logStub.info.called).to.be.false;
      expect(logStub.warn.called).to.be.false;
      expect(logStub.error.called).to.be.false;
    });

    it('should start tracking when daemon becomes unsynced', async () => {
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });

      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(logStub.warn.calledWith('Daemon detected as unsynced, starting health monitoring')).to.be.true;
      expect(registryManagerStub.getInstalledApps.called).to.be.false;
    });

    it('should not remove apps when daemon unsynced for less than 2 hours', async () => {
      clock = sinon.useFakeTimers();

      // First call - daemon becomes unsynced
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Advance time by 1 hour (less than threshold)
      clock.tick(60 * 60 * 1000);

      // Second call - still unsynced but not past threshold
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(registryManagerStub.getInstalledApps.called).to.be.false;
      expect(logStub.error.called).to.be.false;
    });

    it('should remove apps when daemon unsynced for 2+ hours', async () => {
      clock = sinon.useFakeTimers();

      const mockApps = [
        { name: 'app1' },
        { name: 'app2' },
      ];
      registryManagerStub.getInstalledApps.resolves(mockApps);

      // First call - daemon becomes unsynced
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Advance time by 2 hours (past threshold)
      clock.tick(2 * 60 * 60 * 1000);

      // Second call - should trigger app removal
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(logStub.error.calledWith('CRITICAL: Daemon not synced for 2+ hours. Removing all applications.')).to.be.true;
      expect(registryManagerStub.getInstalledApps.called).to.be.true;
      expect(appUninstallerStub.removeAppLocally.callCount).to.equal(2);
      expect(appUninstallerStub.removeAppLocally.firstCall.args[0]).to.equal('app1');
      expect(appUninstallerStub.removeAppLocally.secondCall.args[0]).to.equal('app2');
    });

    it('should not remove apps multiple times', async () => {
      clock = sinon.useFakeTimers();

      const mockApps = [{ name: 'app1' }];
      registryManagerStub.getInstalledApps.resolves(mockApps);

      // First call - daemon becomes unsynced
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Advance time by 2 hours
      clock.tick(2 * 60 * 60 * 1000);

      // Second call - should trigger app removal
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();
      expect(appUninstallerStub.removeAppLocally.callCount).to.equal(1);

      // Third call - should not trigger removal again
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();
      expect(appUninstallerStub.removeAppLocally.callCount).to.equal(1);
    });

    it('should log info when no apps are installed', async () => {
      clock = sinon.useFakeTimers();

      registryManagerStub.getInstalledApps.resolves([]);

      // First call - daemon becomes unsynced
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Advance time by 2 hours
      clock.tick(2 * 60 * 60 * 1000);

      // Second call - should attempt removal but find no apps
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(logStub.info.calledWith('No apps installed, nothing to remove')).to.be.true;
      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
    });

    it('should handle null installed apps', async () => {
      clock = sinon.useFakeTimers();

      registryManagerStub.getInstalledApps.resolves(null);

      // First call - daemon becomes unsynced
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Advance time by 2 hours
      clock.tick(2 * 60 * 60 * 1000);

      // Second call - should handle null gracefully
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(logStub.info.calledWith('No apps installed, nothing to remove')).to.be.true;
      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
    });

    it('should continue removing apps even if one fails', async () => {
      clock = sinon.useFakeTimers();

      const mockApps = [
        { name: 'app1' },
        { name: 'app2' },
        { name: 'app3' },
      ];
      registryManagerStub.getInstalledApps.resolves(mockApps);

      // Make the second app fail
      appUninstallerStub.removeAppLocally
        .onCall(0).resolves()
        .onCall(1).rejects(new Error('Removal failed'))
        .onCall(2).resolves();

      // First call - daemon becomes unsynced
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Advance time by 2 hours
      clock.tick(2 * 60 * 60 * 1000);

      // Second call - should attempt all removals
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(appUninstallerStub.removeAppLocally.callCount).to.equal(3);
      expect(logStub.error.calledWith('Failed to remove app2: Removal failed')).to.be.true;
    });

    it('should add delays between app removals', async () => {
      clock = sinon.useFakeTimers();

      const mockApps = [
        { name: 'app1' },
        { name: 'app2' },
      ];
      registryManagerStub.getInstalledApps.resolves(mockApps);

      // First call - daemon becomes unsynced
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Advance time by 2 hours
      clock.tick(2 * 60 * 60 * 1000);

      // Second call - should trigger app removal with delays
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Should have 2 delays (one after each app removal)
      expect(serviceHelperStub.delay.callCount).to.equal(2);
      expect(serviceHelperStub.delay.firstCall.args[0]).to.equal(3 * 60 * 1000); // 3 minutes
    });

    it('should handle errors during health check gracefully', async () => {
      daemonServiceMiscRpcsStub.isDaemonSynced.throws(new Error('RPC error'));

      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      expect(logStub.error.calledWith('Error in daemon health check: RPC error')).to.be.true;
    });

    it('should reset allAppsRemoved flag when daemon recovers', async () => {
      clock = sinon.useFakeTimers();

      const mockApps = [{ name: 'app1' }];
      registryManagerStub.getInstalledApps.resolves(mockApps);

      // First call - daemon becomes unsynced
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Advance time by 2 hours and trigger removal
      clock.tick(2 * 60 * 60 * 1000);
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();
      expect(appUninstallerStub.removeAppLocally.callCount).to.equal(1);

      // Daemon recovers
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: true } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Daemon goes unsynced again
      daemonServiceMiscRpcsStub.isDaemonSynced.returns({ data: { synced: false } });
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Advance time by 2 hours again
      clock.tick(2 * 60 * 60 * 1000);
      registryManagerStub.getInstalledApps.resolves([{ name: 'app2' }]);
      await daemonHealthMonitor.checkDaemonHealthAndCleanup();

      // Should attempt removal again since flag was reset
      expect(appUninstallerStub.removeAppLocally.callCount).to.equal(2);
    });
  });
});
