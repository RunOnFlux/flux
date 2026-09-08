const { expect } = require('chai');

describe('globalState tests', () => {
  let globalState;

  beforeEach(() => {
    // Clear the module cache to get a fresh instance for each test
    delete require.cache[require.resolve('../../ZelBack/src/services/utils/globalState')];
    globalState = require('../../ZelBack/src/services/utils/globalState');
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

  describe('operationHolding tests', () => {
    afterEach(() => {
      globalState.removalInProgress = false;
      globalState.installationInProgress = false;
      globalState.softRedeployInProgress = false;
      globalState.hardRedeployInProgress = false;
      globalState.reinstallationOfOldAppsInProgress = false;
    });

    it('names nothing when the node is free', () => {
      expect(globalState.operationHolding()).to.equal(null);
    });

    // The flag no guard used to read. A caller asking the question at all is the
    // fix; answering it with four of the five would leave the same hole.
    it('names the periodic reinstall pass, which is a holder like any other', () => {
      globalState.reinstallationOfOldAppsInProgress = true;

      expect(globalState.operationHolding()).to.equal('reinstallation');
    });

    // A guard excludes the operation it belongs to and no others: the reinstall
    // pass sets its own flag before the loop, so asking without the exclusion
    // would make it skip every app on its own account.
    it('excludes only the caller its own operation, and still sees the others', () => {
      globalState.reinstallationOfOldAppsInProgress = true;

      expect(globalState.operationHolding('reinstallation')).to.equal(null);

      globalState.removalInProgress = true;
      expect(globalState.operationHolding('reinstallation')).to.equal('removal');
    });

    it('answers in the order the guards asked in, so the message does not change', () => {
      globalState.hardRedeployInProgress = true;
      globalState.installationInProgress = true;

      expect(globalState.operationHolding()).to.equal('installation');
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

    it('should allow setting removalInProgress', () => {
      globalState.removalInProgress = true;
      expect(globalState.removalInProgress).to.equal(true);

      globalState.removalInProgressReset();
      expect(globalState.removalInProgress).to.equal(false);
    });

    it('should allow setting installationInProgress', () => {
      globalState.installationInProgress = true;
      expect(globalState.installationInProgress).to.equal(true);

      globalState.installationInProgressReset();
      expect(globalState.installationInProgress).to.equal(false);
    });
  });

  // The restore claim. Two restores of one app run the same archive into the same
  // appdata, so this pair is what makes an app's restore exclusive - and the
  // boolean is the whole of it: the caller learns from the return value alone
  // whether the claim is theirs, since a second claim leaves the list looking
  // exactly as it did after the first.
  describe('restore claim tests', () => {
    it('grants the claim to the first caller', () => {
      expect(globalState.tryStartRestore('app1')).to.equal(true);
      expect(globalState.restoreInProgress).to.include('app1');
    });

    it('refuses a second claim on an app already being restored', () => {
      globalState.tryStartRestore('app1');

      expect(globalState.tryStartRestore('app1')).to.equal(false);
    });

    it('does not enter the app twice when the second claim is refused', () => {
      globalState.tryStartRestore('app1');
      globalState.tryStartRestore('app1');

      const held = globalState.restoreInProgress.filter((app) => app === 'app1');
      expect(held).to.have.lengthOf(1);
    });

    it('leaves a claim on a different app alone', () => {
      globalState.tryStartRestore('app1');

      expect(globalState.tryStartRestore('app2')).to.equal(true);
      expect(globalState.restoreInProgress).to.include('app1');
    });

    it('releases the claim so the app can be restored again', () => {
      globalState.tryStartRestore('app1');
      globalState.finishRestore('app1');

      expect(globalState.restoreInProgress).to.not.include('app1');
      expect(globalState.tryStartRestore('app1')).to.equal(true);
    });

    it('ignores a release for an app that holds no claim', () => {
      globalState.tryStartRestore('app1');
      globalState.finishRestore('app2');

      expect(globalState.restoreInProgress).to.include('app1');
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
