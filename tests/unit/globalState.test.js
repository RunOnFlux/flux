const { expect } = require('chai');

const globalState = require('../../ZelBack/src/services/utils/globalState');

describe('globalState tests', () => {
  // globalState is a SINGLETON shared with the production modules under test. We
  // reset its mutable state in place between tests rather than delete it from
  // require.cache + re-require: re-requiring hands THIS file a different instance
  // than the production code (loaded once at startup) holds, desyncing them and
  // breaking any later test file that shares globalState with production — an
  // order-dependent footgun. Resetting in place keeps the one shared instance.
  beforeEach(() => {
    globalState.runningAppsCache.clear();
    globalState.stoppingContainers.clear();
    globalState.installingApps.clear();
    globalState.removalInProgressReset();
    globalState.installationInProgress = false;
    globalState.softRedeployInProgress = false;
    globalState.hardRedeployInProgress = false;
    globalState.reinstallationOfOldAppsInProgress = false;
    globalState.appsToBeCheckedLater.length = 0;
    globalState.appsSyncthingToBeCheckedLater.length = 0;
    globalState.restoreInProgress.length = 0;
    globalState.backupInProgress.length = 0;
    globalState.dbReady = false;
    globalState.daemonReady = false;
    globalState.bootContainerStateSettled = false;
  });

  describe('runningAppsCache tests', () => {
    it('should be a Set', () => {
      expect(globalState.runningAppsCache).to.be.instanceOf(Set);
    });

    it('should be empty by default', () => {
      expect(globalState.runningAppsCache.size).to.equal(0);
    });

    it('should allow adding app names', () => {
      globalState.runningAppsCache.add('app1');
      globalState.runningAppsCache.add('app2');

      expect(globalState.runningAppsCache.size).to.equal(2);
      expect(globalState.runningAppsCache.has('app1')).to.equal(true);
      expect(globalState.runningAppsCache.has('app2')).to.equal(true);
    });

    it('should not duplicate app names', () => {
      globalState.runningAppsCache.add('app1');
      globalState.runningAppsCache.add('app1');
      globalState.runningAppsCache.add('app1');

      expect(globalState.runningAppsCache.size).to.equal(1);
    });

    it('should allow removing app names', () => {
      globalState.runningAppsCache.add('app1');
      globalState.runningAppsCache.add('app2');

      globalState.runningAppsCache.delete('app1');

      expect(globalState.runningAppsCache.size).to.equal(1);
      expect(globalState.runningAppsCache.has('app1')).to.equal(false);
      expect(globalState.runningAppsCache.has('app2')).to.equal(true);
    });

    it('should allow clearing all app names', () => {
      globalState.runningAppsCache.add('app1');
      globalState.runningAppsCache.add('app2');
      globalState.runningAppsCache.add('app3');

      globalState.runningAppsCache.clear();

      expect(globalState.runningAppsCache.size).to.equal(0);
    });

    it('should be iterable', () => {
      globalState.runningAppsCache.add('app1');
      globalState.runningAppsCache.add('app2');
      globalState.runningAppsCache.add('app3');

      const apps = [];
      globalState.runningAppsCache.forEach((app) => {
        apps.push(app);
      });

      expect(apps).to.have.members(['app1', 'app2', 'app3']);
    });

    it('should check if app exists with has()', () => {
      globalState.runningAppsCache.add('existingApp');

      expect(globalState.runningAppsCache.has('existingApp')).to.equal(true);
      expect(globalState.runningAppsCache.has('nonExistingApp')).to.equal(false);
    });
  });

  describe('state flags tests', () => {
    it('should have default values for state flags', () => {
      expect(globalState.removalInProgress).to.equal(false);
      expect(globalState.installationInProgress).to.equal(false);
      expect(globalState.softRedeployInProgress).to.equal(false);
      expect(globalState.hardRedeployInProgress).to.equal(false);
      expect(globalState.reinstallationOfOldAppsInProgress).to.equal(false);
    });

    it('removalInProgress reflects the per-app removal Set (read-only, derived)', () => {
      globalState.markRemovalInProgress('App1');
      expect(globalState.removalInProgress).to.equal(true);
      expect(globalState.hasRemovalInProgress('App1')).to.equal(true);
      expect(globalState.hasRemovalInProgress('App2')).to.equal(false);

      globalState.removalDone('App1');
      expect(globalState.removalInProgress).to.equal(false);
    });

    it('tracks removals per-app: a same-name removal finishing does NOT clear another (Race #2)', () => {
      globalState.markRemovalInProgress('A');
      globalState.markRemovalInProgress('B');
      expect(globalState.hasRemovalInProgress('A')).to.equal(true);
      expect(globalState.hasRemovalInProgress('B')).to.equal(true);

      // A finishing must leave B's entry intact (the boolean clobber the Set fixes)
      globalState.removalDone('A');
      expect(globalState.hasRemovalInProgress('A')).to.equal(false);
      expect(globalState.hasRemovalInProgress('B')).to.equal(true);
      expect(globalState.removalInProgress).to.equal(true); // size>0 while B remains

      globalState.removalDone('B');
      expect(globalState.removalInProgress).to.equal(false);
    });

    it('should allow setting installationInProgress', () => {
      globalState.installationInProgress = true;
      expect(globalState.installationInProgress).to.equal(true);

      globalState.installationInProgressReset();
      expect(globalState.installationInProgress).to.equal(false);
    });
  });

  describe('cache collections tests', () => {
    it('should have empty collections by default', () => {
      expect(globalState.appsToBeCheckedLater).to.be.an('array').that.is.empty;
      expect(globalState.appsSyncthingToBeCheckedLater).to.be.an('array').that.is.empty;
      expect(globalState.receiveOnlySyncthingAppsCache).to.be.instanceOf(Map);
      expect(globalState.syncthingDevicesIDCache).to.be.instanceOf(Map);
      expect(globalState.folderHealthCache).to.be.instanceOf(Map);
    });

    it('should allow modifying appsToBeCheckedLater', () => {
      globalState.appsToBeCheckedLater.push('app1');
      globalState.appsToBeCheckedLater.push('app2');

      expect(globalState.appsToBeCheckedLater).to.have.lengthOf(2);
      expect(globalState.appsToBeCheckedLater).to.include('app1');
    });
  });

  describe('waitForDbReady', () => {
    it('should resolve immediately when dbReady is already true', async () => {
      globalState.dbReady = true;
      await globalState.waitForDbReady();
    });

    it('should wait until dbReady is set to true', async () => {
      globalState.dbReady = false;
      let resolved = false;
      const promise = globalState.waitForDbReady().then(() => { resolved = true; });
      await new Promise((r) => setImmediate(r));
      expect(resolved).to.equal(false);
      globalState.dbReady = true;
      await promise;
      expect(resolved).to.equal(true);
    });

    it('should resolve again after a reset cycle', async () => {
      globalState.dbReady = true;
      await globalState.waitForDbReady();

      globalState.dbReady = false;
      let resolved = false;
      const promise = globalState.waitForDbReady().then(() => { resolved = true; });
      await new Promise((r) => setImmediate(r));
      expect(resolved).to.equal(false);
      globalState.dbReady = true;
      await promise;
      expect(resolved).to.equal(true);
    });
  });

  describe('waitForDaemonReady', () => {
    it('should resolve immediately when daemonReady is already true', async () => {
      globalState.daemonReady = true;
      await globalState.waitForDaemonReady();
    });

    it('should wait until daemonReady is set to true', async () => {
      let resolved = false;
      const promise = globalState.waitForDaemonReady().then(() => { resolved = true; });
      await new Promise((r) => setImmediate(r));
      expect(resolved).to.equal(false);
      globalState.daemonReady = true;
      await promise;
      expect(resolved).to.equal(true);
    });
  });

  describe('waitForBootContainerStateSettled', () => {
    it('should resolve immediately when bootContainerStateSettled is already true', async () => {
      globalState.bootContainerStateSettled = true;
      await globalState.waitForBootContainerStateSettled();
    });

    it('should wait until bootContainerStateSettled is set to true', async () => {
      let resolved = false;
      const promise = globalState.waitForBootContainerStateSettled().then(() => { resolved = true; });
      await new Promise((r) => setImmediate(r));
      expect(resolved).to.equal(false);
      globalState.bootContainerStateSettled = true;
      await promise;
      expect(resolved).to.equal(true);
    });
  });
});
