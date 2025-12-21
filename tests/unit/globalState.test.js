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
});
