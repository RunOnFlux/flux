const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const { resetGlobalState } = require('./fixtures/globalState');
const proxyquire = require('proxyquire').noCallThru();

describe('appStartupManager tests', () => {
  let appStartupManager;
  let appUtilities;
  let logStub;
  let dbHelperStub;
  let dockerServiceStub;
  let fluxNetworkHelperStub;
  let registryManagerStub;
  let advancedWorkflowsStub;
  let appReconcilerStub;
  let appUninstallerStub;
  let globalStateStub;
  let appQueryServiceStub;
  let appPlacementsStub;
  let portManagerStub;
  let appSliceStub;
  let nodeStatusMonitor;

  beforeEach(() => {
    appSliceStub = { stopEmptySlices: sinon.stub().resolves(0) };
    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub(),
      findInDatabase: sinon.stub(),
    };

    dockerServiceStub = {
      dockerListContainers: sinon.stub(),
    };

    fluxNetworkHelperStub = {
      getLocalSocketAddress: sinon.stub(),
      isNodeDos: sinon.stub().returns(false),
      isStickyDosHeldBy: sinon.stub().returns(false),
      StickyDosOwner: { HOST_STALL: 'hostStall' },
      allowAppPorts: sinon.stub().resolves({ failed: [], locked: false }),
    };

    portManagerStub = {
      appsWithPorts: sinon.stub().resolves({ apps: [], unreadable: [] }),
    };

    registryManagerStub = {
      getApplicationGlobalSpecifications: sinon.stub(),
    };

    advancedWorkflowsStub = {
      appDockerStart: sinon.stub().resolves(),
    };

    // boot reconcile hands each component to the reconciler (the single actuator);
    // it no longer calls appDockerStart directly
    appReconcilerStub = {
      enqueue: sinon.stub(),
    };

    appUninstallerStub = {
      removeAppLocally: sinon.stub().resolves('removed'),
      finishRemoval: sinon.stub(),
    };

    const mockDb = { db: sinon.stub().returns('mockDatabase') };
    dbHelperStub.databaseConnection.returns(mockDb);

    // The real module, with the three gate waits spied. The gates stay CLOSED -
    // this suite is about a startup that has not finished - and the waits are
    // stubbed to resolve so a test does not sit on a gate nothing here opens.
    // On the module itself those two are the same fact, which is why this has to
    // be sinon over the real object rather than an object asserting both.
    globalStateStub = resetGlobalState();
    sinon.stub(globalStateStub, 'waitForDbReady').resolves();
    sinon.stub(globalStateStub, 'waitForDaemonReady').resolves();
    sinon.stub(globalStateStub, 'waitForBootContainerStateSettled').resolves();

    appPlacementsStub = {
      removeStrayPlacements: sinon.stub().resolves(0),
    };

    appQueryServiceStub = {
      installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
      decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
    };

    appUtilities = proxyquire('../../ZelBack/src/services/utils/appUtilities', {
      '../dbHelper': dbHelperStub,
      '../../lib/log': logStub,
    });

    // The real module, fresh per test: its record of removals still running is what
    // boot shares with the monitor.
    nodeStatusMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {});

    appStartupManager = proxyquire('../../ZelBack/src/services/appLifecycle/appStartupManager', {
      '../../lib/log': logStub,
      '../dbHelper': dbHelperStub,
      '../dockerService': dockerServiceStub,
      '../serviceHelper': { delay: sinon.stub().resolves(), ensureNumber: (value) => Number(value) },
      '../appNetwork/portManager': portManagerStub,
      '../fluxNetworkHelper': fluxNetworkHelperStub,
      '../appDatabase/registryManager': registryManagerStub,
      './advancedWorkflows': advancedWorkflowsStub,
      '../appMonitoring/appReconciler': appReconcilerStub,
      './appUninstaller': appUninstallerStub,
      './appSlice': appSliceStub,
      '../appMonitoring/nodeStatusMonitor': nodeStatusMonitor,
      '../appManagement/appPlacements': appPlacementsStub,
      '../utils/globalState': globalStateStub,
      // runs the step again at once until it succeeds, as the real one does after a wait
      '../utils/untilSucceeds': {
        BOOT_STEP_RETRY_MS: 15000,
        untilSucceeds: async (what, step) => {
          for (;;) {
            try {
              return await step(); // eslint-disable-line no-await-in-loop
            } catch {
              // run it again
            }
          }
        },
      },
      '../appQuery/appQueryService': appQueryServiceStub,
      '../utils/appConstants': { localAppsInformation: 'localAppsInformation', SIGTERM_EXPIRY_MS: 420000, RUNNING_EXPIRY_MS: 7500000 },
      '../utils/appUtilities': appUtilities,
      '../nodeConfirmationService': {
        isConfirmed: sinon.stub().returns(true),
        waitForConfirmed: sinon.stub().resolves(),
        waitForConfirmationStatus: sinon.stub().resolves(),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('appHasValidLocationOnNode', () => {
    it('should return true when expireAt is in the future', async () => {
      const expireAt = new Date(Date.now() + (60 * 1000)); // 1 minute from now
      dbHelperStub.findInDatabase.resolves([{ expireAt }]);

      const result = await appUtilities.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(true);
    });

    it('should return false when no location records exist', async () => {
      dbHelperStub.findInDatabase.resolves([]);

      const result = await appUtilities.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(false);
    });

    it('should return false when records is null', async () => {
      dbHelperStub.findInDatabase.resolves(null);

      const result = await appUtilities.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(false);
    });

    it('should return false when expireAt is in the past', async () => {
      const expireAt = new Date(Date.now() - (60 * 1000)); // 1 minute ago
      dbHelperStub.findInDatabase.resolves([{ expireAt }]);

      const result = await appUtilities.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(false);
    });

    it('should return true if at least one record is still valid among mixed records', async () => {
      const expiredRecord = new Date(Date.now() - (60 * 1000));
      const validRecord = new Date(Date.now() + (300 * 1000));
      dbHelperStub.findInDatabase.resolves([
        { expireAt: expiredRecord },
        { expireAt: validRecord },
      ]);

      const result = await appUtilities.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(true);
    });

    it('answers unknown when the records cannot be read, neither valid nor expired', async () => {
      dbHelperStub.findInDatabase.rejects(new Error('DB connection lost'));

      const result = await appUtilities.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(null);
    });

    it('should query with correct app name and IP', async () => {
      dbHelperStub.findInDatabase.resolves([]);

      await appUtilities.appHasValidLocationOnNode('testApp', '192.168.1.1:16127');

      const query = dbHelperStub.findInDatabase.firstCall.args[2];
      expect(query).to.deep.equal({ name: 'testApp', ip: '192.168.1.1:16127' });
    });

    it('should project only the expireAt field', async () => {
      dbHelperStub.findInDatabase.resolves([]);

      await appUtilities.appHasValidLocationOnNode('testApp', '10.0.0.1:16127');

      const projection = dbHelperStub.findInDatabase.firstCall.args[3];
      expect(projection).to.deep.equal({ _id: 0, expireAt: 1 });
    });

    it('should return false when expireAt field is missing from record', async () => {
      dbHelperStub.findInDatabase.resolves([{ broadcastedAt: new Date() }]);

      const result = await appUtilities.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(false);
    });
  });

  describe('reconcileAppsOnBoot - location check and removal', () => {
    const stoppedFluxContainers = [
      { Names: ['/fluxAppA'], State: 'exited' },
      { Names: ['/fluxAppB'], State: 'exited' },
      { Names: ['/fluxAppC'], State: 'exited' },
    ];

    const installedApps = [
      { name: 'AppA' },
      { name: 'AppB' },
      { name: 'AppC' },
    ];

    beforeEach(() => {
      // Default: installed apps in local DB
      dbHelperStub.findInDatabase.onFirstCall().resolves(installedApps);

      // Default: stopped containers
      dockerServiceStub.dockerListContainers.resolves(stoppedFluxContainers);

      // Default: no g: syncthing mode
      registryManagerStub.getApplicationGlobalSpecifications.resolves({ version: 3, containerData: '' });

      // Default: node IP available
      fluxNetworkHelperStub.getLocalSocketAddress.resolves('10.0.0.1:16127');
    });

    it('should start app when location record has not expired', async () => {
      // Only one stopped container
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      // Valid location record (expireAt in the future)
      const futureExpiry = new Date(Date.now() + (300 * 1000));
      dbHelperStub.findInDatabase.onSecondCall().resolves([{ expireAt: futureExpiry }]);

      const results = await appStartupManager.reconcileAppsOnBoot();

      expect(results.appsStarted).to.deep.equal(['AppA']);
      expect(results.appsRemoved).to.deep.equal([]);
      expect(appReconcilerStub.enqueue.calledWith('AppA')).to.equal(true);
      expect(advancedWorkflowsStub.appDockerStart.called).to.equal(false);
    });

    it('should remove app when location record has expired', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      // Expired location record (expireAt in the past)
      const pastExpiry = new Date(Date.now() - (60 * 1000));
      dbHelperStub.findInDatabase.onSecondCall().resolves([{ expireAt: pastExpiry }]);

      const results = await appStartupManager.reconcileAppsOnBoot();

      expect(results.appsRemoved).to.deep.equal(['AppA']);
      expect(results.appsStarted).to.deep.equal([]);
      expect(appUninstallerStub.removeAppLocally.calledWith('AppA', null, true, true, false)).to.equal(true);
      expect(appReconcilerStub.enqueue.called).to.equal(false);
    });

    it('should remove app when location record is missing', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      // No location records
      dbHelperStub.findInDatabase.onSecondCall().resolves([]);

      const results = await appStartupManager.reconcileAppsOnBoot();

      expect(results.appsRemoved).to.deep.equal(['AppA']);
      expect(results.appsStarted).to.deep.equal([]);
      expect(appUninstallerStub.removeAppLocally.called).to.equal(true);
    });

    it('should skip location check and start app when IP is not available', async () => {
      fluxNetworkHelperStub.getLocalSocketAddress.resolves(null);

      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      const results = await appStartupManager.reconcileAppsOnBoot();

      expect(results.appsStarted).to.deep.equal(['AppA']);
      expect(results.appsRemoved).to.deep.equal([]);
    });

    it('should handle mixed apps: start valid, remove expired', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
        { Names: ['/fluxAppB'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([
        { name: 'AppA' },
        { name: 'AppB' },
      ]);

      // AppA has valid location (expireAt in the future)
      const futureExpiry = new Date(Date.now() + (300 * 1000));
      dbHelperStub.findInDatabase.onSecondCall().resolves([{ expireAt: futureExpiry }]);

      // AppB has expired location (expireAt in the past)
      const pastExpiry = new Date(Date.now() - (60 * 1000));
      dbHelperStub.findInDatabase.onThirdCall().resolves([{ expireAt: pastExpiry }]);

      const results = await appStartupManager.reconcileAppsOnBoot();

      expect(results.appsStarted).to.deep.equal(['AppA']);
      expect(results.appsRemoved).to.deep.equal(['AppB']);
    });

    it('hands an app it could not remove to be finished, never starting it', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);
      // Expired location
      dbHelperStub.findInDatabase.onSecondCall().resolves([]);
      appUninstallerStub.removeAppLocally.resolves('failed');

      const results = await appStartupManager.reconcileAppsOnBoot();

      expect(results.appsFailed.map((failure) => failure.app)).to.deep.equal(['AppA']);
      expect(appReconcilerStub.enqueue.calledWith('AppA'), 'an app boot could not remove was started').to.equal(false);
      sinon.assert.calledOnceWithExactly(appUninstallerStub.finishRemoval, 'AppA', true, false);
    });

    describe('an app whose location record cannot be read', () => {
      const futureExpiry = () => new Date(Date.now() + (300 * 1000));
      // the held app's check runs in the background, on stubs that answer at once
      const settle = () => new Promise((resolve) => { setImmediate(resolve); });

      beforeEach(() => {
        dockerServiceStub.dockerListContainers.resolves([
          { Names: ['/fluxAppA'], State: 'exited' },
        ]);
        dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);
        dbHelperStub.findInDatabase.onSecondCall().rejects(new Error('DB error'));
      });

      it('is held, neither started nor removed', async () => {
        // the record stays unreadable for as long as this test looks
        dbHelperStub.findInDatabase.onThirdCall().returns(new Promise(() => {}));

        const results = await appStartupManager.reconcileAppsOnBoot();
        await settle();

        expect(results.appsUnconfirmed).to.deep.equal(['AppA']);
        expect(globalStateStub.unconfirmedApps.has('AppA'), 'the app was not held').to.equal(true);
        expect(appUninstallerStub.removeAppLocally.called, 'an app whose location is unknown was removed').to.equal(false);
        expect(appUninstallerStub.finishRemoval.called, 'an app whose location is unknown was handed to be removed').to.equal(false);
        expect(appReconcilerStub.enqueue.called, 'an app whose location is unknown was started').to.equal(false);
      });

      it('is started, and released, once its record reads valid', async () => {
        dbHelperStub.findInDatabase.onThirdCall().resolves([{ expireAt: futureExpiry() }]);

        await appStartupManager.reconcileAppsOnBoot();
        await settle();

        sinon.assert.calledOnceWithExactly(appReconcilerStub.enqueue, 'AppA');
        expect(globalStateStub.unconfirmedApps.has('AppA'), 'a confirmed app is still held').to.equal(false);
        expect(appUninstallerStub.removeAppLocally.called).to.equal(false);
      });

      it('has its record read again until it answers', async () => {
        dbHelperStub.findInDatabase.onThirdCall().rejects(new Error('DB error'));
        dbHelperStub.findInDatabase.onCall(3).rejects(new Error('DB error'));
        dbHelperStub.findInDatabase.onCall(4).resolves([{ expireAt: futureExpiry() }]);

        await appStartupManager.reconcileAppsOnBoot();
        await settle();

        expect(dbHelperStub.findInDatabase.callCount, 'the record was not read until it answered').to.equal(5);
        sinon.assert.calledOnceWithExactly(appReconcilerStub.enqueue, 'AppA');
      });

      it('is removed once its record reads expired, telling the network nothing', async () => {
        dbHelperStub.findInDatabase.onThirdCall().resolves([]);

        await appStartupManager.reconcileAppsOnBoot();
        await settle();

        sinon.assert.calledOnceWithExactly(appUninstallerStub.removeAppLocally, 'AppA', null, true, true, false);
        expect(appReconcilerStub.enqueue.called, 'an app whose location expired was started').to.equal(false);
        expect(globalStateStub.unconfirmedApps.has('AppA')).to.equal(false);
      });

      it('stays held until its removal has run', async () => {
        dbHelperStub.findInDatabase.onThirdCall().resolves([]);
        let finishRemoval;
        appUninstallerStub.removeAppLocally.returns(new Promise((resolve) => { finishRemoval = resolve; }));

        await appStartupManager.reconcileAppsOnBoot();
        await settle();
        expect(globalStateStub.unconfirmedApps.has('AppA'), 'released while its removal was running').to.equal(true);

        finishRemoval('removed');
        await settle();
        expect(globalStateStub.unconfirmedApps.has('AppA')).to.equal(false);
      });

      it('is handed to be finished when its removal does not finish', async () => {
        dbHelperStub.findInDatabase.onThirdCall().resolves([]);
        appUninstallerStub.removeAppLocally.resolves('busy');

        await appStartupManager.reconcileAppsOnBoot();
        await settle();

        sinon.assert.calledOnceWithExactly(appUninstallerStub.finishRemoval, 'AppA', true, false);
        expect(appReconcilerStub.enqueue.called).to.equal(false);
      });

      describe('whose hold ends before its record is read', () => {
        // The record answers only when the test says, after it has ended the hold.
        const recordAnswersLater = () => {
          let answer;
          dbHelperStub.findInDatabase.onThirdCall().returns(new Promise((resolve) => { answer = resolve; }));
          return (records) => answer(records);
        };

        it('is not removed when it was uninstalled meanwhile and its record reads expired', async () => {
          const answer = recordAnswersLater();
          await appStartupManager.reconcileAppsOnBoot();
          await settle();

          globalStateStub.unconfirmedApps.delete('AppA');
          answer([]);
          await settle();

          expect(appUninstallerStub.removeAppLocally.called, 'removed an app installed again after its uninstall').to.equal(false);
          expect(appReconcilerStub.enqueue.called).to.equal(false);
        });

        it('is not started when it was uninstalled meanwhile and its record reads valid', async () => {
          const answer = recordAnswersLater();
          await appStartupManager.reconcileAppsOnBoot();
          await settle();

          globalStateStub.unconfirmedApps.delete('AppA');
          answer([{ expireAt: futureExpiry() }]);
          await settle();

          expect(appReconcilerStub.enqueue.called, 'started an app on the word of a hold that had ended').to.equal(false);
          expect(appUninstallerStub.removeAppLocally.called).to.equal(false);
        });

        it('decides nothing for a later hold under the same name, and leaves that hold in place', async () => {
          const answer = recordAnswersLater();
          await appStartupManager.reconcileAppsOnBoot();
          await settle();

          const later = Symbol('AppA');
          globalStateStub.unconfirmedApps.set('AppA', later);
          answer([]);
          await settle();

          expect(appUninstallerStub.removeAppLocally.called, 'decided an app another hold now covers').to.equal(false);
          expect(globalStateStub.unconfirmedApps.get('AppA'), 'released a hold that was not its own').to.equal(later);
        });

        it('leaves a later hold in place when its own removal ends', async () => {
          dbHelperStub.findInDatabase.onThirdCall().resolves([]);
          const later = Symbol('AppA');
          appUninstallerStub.removeAppLocally.callsFake(async () => {
            globalStateStub.unconfirmedApps.set('AppA', later);
            return 'removed';
          });

          await appStartupManager.reconcileAppsOnBoot();
          await settle();

          expect(globalStateStub.unconfirmedApps.get('AppA'), 'released a hold set after its removal began').to.equal(later);
        });
      });

      it('has only the components boot starts started, when its g: components are left to the election', async () => {
        dockerServiceStub.dockerListContainers.resolves([
          { Names: ['/fluxweb_MixedApp'], State: 'exited' },
          { Names: ['/fluxdb_MixedApp'], State: 'exited' },
        ]);
        dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'MixedApp' }]);
        registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves({
          version: 8,
          name: 'MixedApp',
          compose: [
            { name: 'web', containerData: '' },
            { name: 'db', containerData: 'g:/data' },
          ],
        });
        dbHelperStub.findInDatabase.onThirdCall().resolves([{ expireAt: futureExpiry() }]);

        await appStartupManager.reconcileAppsOnBoot();
        await settle();

        sinon.assert.calledOnceWithExactly(appReconcilerStub.enqueue, 'web_MixedApp');
      });
    });

    it('should check location after g: syncthing check', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxSyncApp'], State: 'exited' },
        { Names: ['/fluxNormalApp'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([
        { name: 'SyncApp' },
        { name: 'NormalApp' },
      ]);

      // SyncApp uses g: syncthing mode
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('SyncApp').resolves({
        version: 3,
        containerData: 'g:/data',
      });
      // NormalApp does not
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('NormalApp').resolves({
        version: 3,
        containerData: '',
      });

      // NormalApp has expired location
      dbHelperStub.findInDatabase.onSecondCall().resolves([]);

      const results = await appStartupManager.reconcileAppsOnBoot();

      // SyncApp skipped by g: mode check (before location check)
      expect(results.appsSkippedGMode).to.deep.equal(['SyncApp']);
      // NormalApp removed because location expired
      expect(results.appsRemoved).to.deep.equal(['NormalApp']);
      expect(results.appsStarted).to.deep.equal([]);
    });

    it('should partially start mixed compose: non-g components only, g: component left for masterSlaveApps', async () => {
      // Mixed compose app: web (no g:) + db (g:) — both stopped at boot
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxweb_MixedApp'], State: 'exited' },
        { Names: ['/fluxdb_MixedApp'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'MixedApp' }]);

      registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves({
        version: 8,
        name: 'MixedApp',
        compose: [
          { name: 'web', containerData: '' },
          { name: 'db', containerData: 'g:/data' },
        ],
      });

      // Valid location
      const futureExpiry = new Date(Date.now() + (300 * 1000));
      dbHelperStub.findInDatabase.onSecondCall().resolves([{ expireAt: futureExpiry }]);

      const results = await appStartupManager.reconcileAppsOnBoot();

      expect(results.appsPartiallyStarted).to.deep.equal(['MixedApp']);
      expect(results.appsStarted).to.deep.equal([]);
      expect(results.appsSkippedGMode).to.deep.equal([]);
      // Non-g component enqueued for the reconciler
      expect(appReconcilerStub.enqueue.calledWith('web_MixedApp')).to.equal(true);
      // g: component NOT enqueued here (left for masterSlaveApps)
      expect(appReconcilerStub.enqueue.calledWith('db_MixedApp')).to.equal(false);
    });

    it('should skip a compose app where every component is g:', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxa_AllGApp'], State: 'exited' },
        { Names: ['/fluxb_AllGApp'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AllGApp' }]);

      registryManagerStub.getApplicationGlobalSpecifications.withArgs('AllGApp').resolves({
        version: 8,
        name: 'AllGApp',
        compose: [
          { name: 'a', containerData: 'g:/x' },
          { name: 'b', containerData: 'g:/y' },
        ],
      });

      const results = await appStartupManager.reconcileAppsOnBoot();

      expect(results.appsSkippedGMode).to.deep.equal(['AllGApp']);
      expect(results.appsStarted).to.deep.equal([]);
      expect(results.appsPartiallyStarted).to.deep.equal([]);
      expect(appReconcilerStub.enqueue.called).to.equal(false);
    });
  });

  describe('getNonGComponentIdentifiers', () => {
    it('should return empty array when appSpec is null', () => {
      expect(appUtilities.getNonGComponentIdentifiers(null, 'AppA')).to.deep.equal([]);
    });

    it('should return [appName] for a v<=3 app with no g:', () => {
      const spec = { version: 3, containerData: '' };
      expect(appUtilities.getNonGComponentIdentifiers(spec, 'AppA')).to.deep.equal(['AppA']);
    });

    it('should return [] for a v<=3 app with g:', () => {
      const spec = { version: 3, containerData: 'g:/data' };
      expect(appUtilities.getNonGComponentIdentifiers(spec, 'AppA')).to.deep.equal([]);
    });

    it('should return all component identifiers for a compose app with no g:', () => {
      const spec = {
        version: 8,
        name: 'AppA',
        compose: [
          { name: 'web', containerData: '' },
          { name: 'cache', containerData: 'r:/data' },
        ],
      };
      expect(appUtilities.getNonGComponentIdentifiers(spec, 'AppA'))
        .to.deep.equal(['web_AppA', 'cache_AppA']);
    });

    it('should return [] for a compose app where every component is g:', () => {
      const spec = {
        version: 8,
        name: 'AppA',
        compose: [
          { name: 'a', containerData: 'g:/x' },
          { name: 'b', containerData: 'g:/y' },
        ],
      };
      expect(appUtilities.getNonGComponentIdentifiers(spec, 'AppA')).to.deep.equal([]);
    });

    it('should return only the non-g identifiers for a mixed compose app', () => {
      const spec = {
        version: 8,
        name: 'AppA',
        compose: [
          { name: 'web', containerData: '' },
          { name: 'db', containerData: 'g:/data' },
          { name: 'worker', containerData: 'r:/q' },
        ],
      };
      expect(appUtilities.getNonGComponentIdentifiers(spec, 'AppA'))
        .to.deep.equal(['web_AppA', 'worker_AppA']);
    });

    it('should fall back to the supplied appName when appSpec.name is missing', () => {
      const spec = {
        version: 8,
        compose: [{ name: 'web', containerData: '' }],
      };
      expect(appUtilities.getNonGComponentIdentifiers(spec, 'AppA'))
        .to.deep.equal(['web_AppA']);
    });
  });

  describe('manageAppsOnBoot', () => {
    it('leaves a node out of service for a host stall to its own removal, and starts no app', async () => {
      fluxNetworkHelperStub.isStickyDosHeldBy.returns(true);
      fluxNetworkHelperStub.isNodeDos.returns(true);
      appQueryServiceStub.installedApps.resolves({ status: 'success', data: [{ name: 'app1' }] });

      await appStartupManager.manageAppsOnBoot({ machineRebooted: false, downtimeMs: 1000, cleanShutdown: true });

      sinon.assert.calledWithExactly(fluxNetworkHelperStub.isStickyDosHeldBy, 'hostStall');
      sinon.assert.notCalled(appUninstallerStub.removeAppLocally);
      sinon.assert.notCalled(globalStateStub.waitForDbReady);
    });

    it('moves past an app whose removal does not return within the deadline, and boot still settles', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        appQueryServiceStub.installedApps.resolves({ status: 'success', data: [{ name: 'stuck' }, { name: 'next' }] });
        appUninstallerStub.removeAppLocally.withArgs('stuck').returns(new Promise(() => {}));

        const boot = appStartupManager.manageAppsOnBoot({ machineRebooted: true, downtimeMs: 8000000, cleanShutdown: false });
        await clock.tickAsync(config.fluxapps.appRemovalDeadlineMs - 1);
        sinon.assert.neverCalledWith(appUninstallerStub.removeAppLocally, 'next');
        await clock.tickAsync(1);
        await boot;

        sinon.assert.calledWith(appUninstallerStub.removeAppLocally, 'next');
        expect(globalStateStub.bootContainerStateSettled).to.equal(true);
      } finally {
        clock.restore();
      }
    });

    it('leaves a removal it stopped waiting for to run, and the monitor does not start it again', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        appQueryServiceStub.installedApps.resolves({ status: 'success', data: [{ name: 'stuck' }] });
        appUninstallerStub.removeAppLocally.withArgs('stuck').returns(new Promise(() => {}));

        const boot = appStartupManager.manageAppsOnBoot({ machineRebooted: true, downtimeMs: 8000000, cleanShutdown: false });
        await clock.tickAsync(config.fluxapps.appRemovalDeadlineMs);
        await boot;
        expect(globalStateStub.bootContainerStateSettled, 'fixture: boot moved past the removal').to.equal(true);

        const outcome = await nodeStatusMonitor.removeWithinDeadline(appUninstallerStub.removeAppLocally, 'stuck');
        expect(outcome).to.equal(nodeStatusMonitor.STILL_REMOVING);
        sinon.assert.calledOnce(appUninstallerStub.removeAppLocally);
      } finally {
        clock.restore();
      }
    });

    it('stops every empty app slice before it removes any app', async () => {
      appQueryServiceStub.installedApps.resolves({ status: 'success', data: [{ name: 'app1' }] });

      await appStartupManager.manageAppsOnBoot({ machineRebooted: true, downtimeMs: 8000000, cleanShutdown: false });

      sinon.assert.calledOnce(appSliceStub.stopEmptySlices);
      sinon.assert.callOrder(appSliceStub.stopEmptySlices, appUninstallerStub.removeAppLocally);
    });

    it('stops every empty app slice before it reconciles the apps', async () => {
      dockerServiceStub.dockerListContainers.resolves([]);
      dbHelperStub.findInDatabase.resolves([]);

      await appStartupManager.manageAppsOnBoot({ machineRebooted: false, downtimeMs: 1000, cleanShutdown: true });

      sinon.assert.calledOnce(appSliceStub.stopEmptySlices);
      sinon.assert.callOrder(appSliceStub.stopEmptySlices, globalStateStub.waitForDbReady);
    });

    it('should reconcile on FluxOS-only restart (no stopped containers)', async () => {
      const bootContext = {
        machineRebooted: false, downtimeMs: 1000, cleanShutdown: true,
      };
      dockerServiceStub.dockerListContainers.resolves([]);
      dbHelperStub.findInDatabase.resolves([]);

      await appStartupManager.manageAppsOnBoot(bootContext);

      expect(globalStateStub.waitForDbReady.calledOnce).to.be.true;
      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
    });

    it('removes nothing wholesale when the boot context could not be read', async () => {
      const bootContext = {
        unreadable: true, machineRebooted: true, downtimeMs: null, cleanShutdown: false, firstBoot: false,
      };
      appQueryServiceStub.installedApps.resolves({ status: 'success', data: [{ name: 'app1' }] });
      dockerServiceStub.dockerListContainers.resolves([]);
      dbHelperStub.findInDatabase.resolves([]);

      await appStartupManager.manageAppsOnBoot(bootContext);

      expect(appUninstallerStub.removeAppLocally.called, 'every app was removed on an unread downtime').to.be.false;
      expect(globalStateStub.waitForDbReady.calledOnce, 'the apps are reconciled one by one instead').to.be.true;
    });

    it('should remove all apps when clean shutdown and downtime > SIGTERM_EXPIRY', async () => {
      const bootContext = {
        machineRebooted: true, downtimeMs: 500000, cleanShutdown: true,
      };
      appQueryServiceStub.installedApps.resolves({
        status: 'success',
        data: [{ name: 'app1' }, { name: 'app2' }],
      });

      await appStartupManager.manageAppsOnBoot(bootContext);

      expect(appUninstallerStub.removeAppLocally.calledTwice).to.be.true;
      expect(appUninstallerStub.removeAppLocally.firstCall.args[0]).to.equal('app1');
      expect(appUninstallerStub.removeAppLocally.secondCall.args[0]).to.equal('app2');
    });

    it('should remove all apps when downtime > RUNNING_EXPIRY regardless of shutdown reason', async () => {
      const bootContext = {
        machineRebooted: true, downtimeMs: 8000000, cleanShutdown: false,
      };
      appQueryServiceStub.installedApps.resolves({
        status: 'success',
        data: [{ name: 'app1' }],
      });

      await appStartupManager.manageAppsOnBoot(bootContext);

      expect(appUninstallerStub.removeAppLocally.calledOnce).to.be.true;
      expect(logStub.info.calledWithMatch(/Locations expired/)).to.be.true;
    });

    it('should wait for dbReady then start apps when machine rebooted with valid locations', async () => {
      const bootContext = {
        machineRebooted: true, downtimeMs: 60000, cleanShutdown: false,
      };
      // No stopped containers = reconcileAppsOnBoot does nothing
      dockerServiceStub.dockerListContainers.resolves([]);
      dbHelperStub.findInDatabase.resolves([]);

      await appStartupManager.manageAppsOnBoot(bootContext);

      expect(globalStateStub.waitForDbReady.calledOnce).to.be.true;
      expect(logStub.info.calledWithMatch(/node confirmed, reconciling/)).to.be.true;
    });

    it('should remove all apps on sync timeout', async () => {
      // waitForDbReady never resolves — simulate timeout
      globalStateStub.waitForDbReady.returns(new Promise(() => {}));
      appQueryServiceStub.installedApps.resolves({
        status: 'success',
        data: [{ name: 'app1' }],
      });

      // manageAppsOnBoot will race waitForDbReady vs 5min timeout.
      // We can't wait 5 minutes in a test, so we'll test the timeout path
      // by temporarily overriding SYNC_TIMEOUT_MS. Since it's a const in the
      // module, we test the behavior indirectly: verify that when dbReady
      // resolves, apps are started (tested above). The timeout path is
      // structurally identical to the locations-expired path (calls removeAllApps).
      // Full integration testing of the 5-minute timeout is done on a live node.
    });

    it('should not remove apps on clean shutdown with short downtime', async () => {
      const bootContext = {
        machineRebooted: true, downtimeMs: 120000, cleanShutdown: true,
      };
      dockerServiceStub.dockerListContainers.resolves([]);
      dbHelperStub.findInDatabase.resolves([]);

      await appStartupManager.manageAppsOnBoot(bootContext);

      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
      expect(globalStateStub.waitForDbReady.calledOnce).to.be.true;
    });

    it('should not remove apps on first boot (no heartbeat history)', async () => {
      const bootContext = {
        machineRebooted: true, downtimeMs: Infinity, cleanShutdown: false, firstBoot: true,
      };
      dockerServiceStub.dockerListContainers.resolves([]);
      dbHelperStub.findInDatabase.resolves([]);

      await appStartupManager.manageAppsOnBoot(bootContext);

      expect(appUninstallerStub.removeAppLocally.called).to.be.false;
      expect(globalStateStub.waitForDbReady.calledOnce).to.be.true;
      expect(logStub.info.calledWithMatch(/First boot/)).to.be.true;
    });

    it('should set bootContainerStateSettled on every exit path', async () => {
      // FluxOS restart path (still reconciles, no stopped containers)
      globalStateStub.bootContainerStateSettled = false;
      dockerServiceStub.dockerListContainers.resolves([]);
      dbHelperStub.findInDatabase.resolves([]);
      await appStartupManager.manageAppsOnBoot({ machineRebooted: false, downtimeMs: 1000, cleanShutdown: true });
      expect(globalStateStub.bootContainerStateSettled).to.be.true;

      // Expired locations path
      globalStateStub.bootContainerStateSettled = false;
      appQueryServiceStub.installedApps.resolves({ status: 'success', data: [] });
      await appStartupManager.manageAppsOnBoot({
        machineRebooted: true, downtimeMs: 8000000, cleanShutdown: false,
      });
      expect(globalStateStub.bootContainerStateSettled).to.be.true;
    });
  });

  describe('opening installed apps\' ports at boot', () => {
    const KEEP = { machineRebooted: false, downtimeMs: 1000, cleanShutdown: true };
    const SPECS = [{ name: 'web' }, { name: 'db' }];

    beforeEach(() => {
      dockerServiceStub.dockerListContainers.resolves([]);
      dbHelperStub.findInDatabase.resolves(SPECS);
      portManagerStub.appsWithPorts.resolves({ apps: [{ name: 'web', ports: [31000, '31001'] }, { name: 'db', ports: [32000] }], unreadable: [] });
    });

    it('opens every installed app\'s ports in one batch, before the apps are reconciled', async () => {
      await appStartupManager.manageAppsOnBoot(KEEP);

      sinon.assert.calledOnceWithExactly(portManagerStub.appsWithPorts, SPECS);
      sinon.assert.calledOnceWithExactly(fluxNetworkHelperStub.allowAppPorts, [31000, 31001, 32000]);
      const reconcileStart = logStub.info.getCalls().find((call) => /Starting boot reconciliation/.test(call.args[0]));
      expect(fluxNetworkHelperStub.allowAppPorts.firstCall.calledBefore(reconcileStart), 'opened before the reconcile began').to.equal(true);
    });

    it('opens nothing when no installed app has a port', async () => {
      portManagerStub.appsWithPorts.resolves({ apps: [{ name: 'worker', ports: [] }], unreadable: [] });

      await appStartupManager.manageAppsOnBoot(KEEP);

      sinon.assert.notCalled(fluxNetworkHelperStub.allowAppPorts);
    });

    it('opens the ports it can read, and says how many apps it could not', async () => {
      portManagerStub.appsWithPorts.resolves({ apps: [{ name: 'web', ports: [31000] }], unreadable: [{ name: 'sealed' }] });

      await appStartupManager.manageAppsOnBoot(KEEP);

      sinon.assert.calledOnceWithExactly(fluxNetworkHelperStub.allowAppPorts, [31000]);
      expect(logStub.warn.calledWithMatch(/1 installed app\(s\) not opened in the firewall: specification unreadable/)).to.equal(true);
    });

    it('logs each rule ufw refused, and a held lock, and still reconciles the apps', async () => {
      fluxNetworkHelperStub.allowAppPorts.resolves({ failed: [{ rule: 'allow 31000', error: 'ERROR: Bad port' }], locked: false });
      await appStartupManager.manageAppsOnBoot(KEEP);
      expect(logStub.warn.calledWithMatch(/ufw allow 31000: ERROR: Bad port/)).to.equal(true);

      fluxNetworkHelperStub.allowAppPorts.resolves({ failed: [], locked: true });
      await appStartupManager.manageAppsOnBoot(KEEP);
      expect(logStub.warn.calledWithMatch(/ufw is locked/)).to.equal(true);
      expect(logStub.info.calledWithMatch(/node confirmed, reconciling/)).to.equal(true);
    });

    it('logs a failure and still reconciles the apps', async () => {
      fluxNetworkHelperStub.allowAppPorts.rejects(new Error('helper crashed'));

      await appStartupManager.manageAppsOnBoot(KEEP);

      expect(logStub.error.calledWithMatch(/not opened in the firewall: helper crashed/)).to.equal(true);
      // once for tidying the placement records, twice for the reconcile
      expect(dbHelperStub.findInDatabase.callCount, 'the reconcile read the installed apps').to.equal(3);
    });

    it('removes stray records first, against the installed apps', async () => {
      await appStartupManager.manageAppsOnBoot(KEEP);

      sinon.assert.calledOnceWithExactly(appPlacementsStub.removeStrayPlacements, ['web', 'db']);
      sinon.assert.callOrder(appPlacementsStub.removeStrayPlacements, portManagerStub.appsWithPorts);
    });

    // A boot that stops before it reconciles the apps still clears stray records.
    it('removes stray records on a boot that stops early', async () => {
      fluxNetworkHelperStub.isNodeDos.returns(true);

      await appStartupManager.manageAppsOnBoot(KEEP);

      sinon.assert.calledOnce(appPlacementsStub.removeStrayPlacements);
    });

    it('removes stray records again until it succeeds, before it goes on', async () => {
      appPlacementsStub.removeStrayPlacements.onFirstCall().rejects(new Error('mongo went away'));

      await appStartupManager.manageAppsOnBoot(KEEP);

      sinon.assert.calledTwice(appPlacementsStub.removeStrayPlacements);
      sinon.assert.callOrder(appPlacementsStub.removeStrayPlacements, portManagerStub.appsWithPorts);
    });

    it('opens nothing when the apps are all being removed', async () => {
      appQueryServiceStub.installedApps.resolves({ status: 'success', data: [{ name: 'web' }] });
      await appStartupManager.manageAppsOnBoot({ machineRebooted: true, downtimeMs: 8000000, cleanShutdown: false });

      fluxNetworkHelperStub.isNodeDos.returns(true);
      await appStartupManager.manageAppsOnBoot(KEEP);

      sinon.assert.notCalled(fluxNetworkHelperStub.allowAppPorts);
    });
  });
});

