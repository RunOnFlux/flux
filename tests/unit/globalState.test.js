const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('globalState tests', () => {
  let globalState;

  beforeEach(() => {
    // A fresh instance per test, kept to this suite: proxyquire restores the
    // require cache after loading, where evicting the entry would hand another
    // object to every module loaded afterwards. globalState is a singleton
    // whose flags decide whether an operation may start at all, so two live
    // copies mean a guard reads one and the work sets the other.
    globalState = proxyquire('../../ZelBack/src/services/utils/globalState', {});
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

  // The apps an operation holds are the operation registry's leases; the
  // registry alone takes and releases them.
  describe('held apps', () => {
    // eslint-disable-next-line global-require
    const operationRegistry = require('../../ZelBack/src/services/utils/operationRegistry');

    afterEach(() => operationRegistry.clear());

    it('lists the apps each type holds, as frozen snapshots', () => {
      operationRegistry.acquire('app1', 'restore', 'test');
      operationRegistry.acquire('app2', 'backup', 'test');
      operationRegistry.acquire('app3', 'remove', 'test');

      expect(globalState.restoreInProgress).to.deep.equal(['app1']);
      expect(globalState.backupInProgress).to.deep.equal(['app2']);
      expect(Object.isFrozen(globalState.backupInProgress)).to.equal(true);
    });

    it('lists the apps any operation holds, as a frozen snapshot', () => {
      operationRegistry.acquire('app1', 'install', 'test');
      operationRegistry.acquire('app2', 'redeploy', 'test');

      expect(globalState.heldApps).to.have.members(['app1', 'app2']);
      expect(Object.isFrozen(globalState.heldApps)).to.equal(true);
    });

    it('lists no app once its operation releases it', () => {
      const token = operationRegistry.acquire('app1', 'remove', 'test');
      operationRegistry.release('app1', token);

      expect(globalState.heldApps).to.deep.equal([]);
    });
  });

  // The removals this counts overlap: a forced removal skips the single-removal
  // guard, so a surplus trim and an expiry removal can run against one app at
  // once, as can an app and one of its components - they share the name the
  // removal message carries. Counting is what stops the first to finish handing
  // the announcement back to the one still running.
  describe('departingApps tests', () => {
    it('is empty by default, and an unknown app is not departing', () => {
      expect(globalState.departingApps.size).to.equal(0);
      expect(globalState.departingApps.has('app1')).to.equal(false);
    });

    it('an app is departing from the moment one removal enters', () => {
      globalState.departingApps.enter('app1');

      expect(globalState.departingApps.has('app1')).to.equal(true);
      expect(globalState.departingApps.size).to.equal(1);
    });

    it('stays departing while a second removal still holds it', () => {
      globalState.departingApps.enter('app1');
      globalState.departingApps.enter('app1');

      globalState.departingApps.leave('app1');

      expect(
        globalState.departingApps.has('app1'),
        'the first removal to finish released the second one\'s mark',
      ).to.equal(true);
    });

    it('stops departing once every removal has left', () => {
      globalState.departingApps.enter('app1');
      globalState.departingApps.enter('app1');

      globalState.departingApps.leave('app1');
      globalState.departingApps.leave('app1');

      expect(globalState.departingApps.has('app1')).to.equal(false);
      expect(globalState.departingApps.size).to.equal(0);
    });

    it('leaving an app that never entered changes nothing', () => {
      globalState.departingApps.enter('app1');

      globalState.departingApps.leave('app2');

      expect(globalState.departingApps.has('app1')).to.equal(true);
      expect(globalState.departingApps.has('app2')).to.equal(false);
      expect(globalState.departingApps.size).to.equal(1);
    });

    it('tracks apps independently', () => {
      globalState.departingApps.enter('app1');
      globalState.departingApps.enter('app2');

      globalState.departingApps.leave('app1');

      expect(globalState.departingApps.has('app1')).to.equal(false);
      expect(globalState.departingApps.has('app2')).to.equal(true);
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
  // Three boot-time passes hang their first run off this gate rather than off a
  // timer: volume validation, the image updater and the storage sweep. Each of
  // them destroys an app in order to rebuild it, so each has to wait for the node
  // to be able to judge an image. A gate that did not resolve for a caller
  // arriving after it opened would leave all three waiting for the life of the
  // process, and nothing else would report it.
  describe('waitForPolicyReady tests', () => {
    it('waits while the policy is unobtained', async () => {
      let resolved = false;
      globalState.waitForPolicyReady().then(() => { resolved = true; });

      await new Promise((r) => setImmediate(r));

      expect(globalState.policyReady).to.equal(false);
      expect(resolved, 'a node without policy must not be released').to.equal(false);
    });

    it('releases a caller already waiting when the policy arrives', async () => {
      let resolved = false;
      const waiting = globalState.waitForPolicyReady().then(() => { resolved = true; });

      globalState.policyReady = true;
      await waiting;

      expect(resolved).to.equal(true);
    });

    it('releases a caller that arrives after the policy did', async () => {
      globalState.policyReady = true;

      await globalState.waitForPolicyReady();

      expect(globalState.policyReady).to.equal(true);
    });
  });
});
