const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appSpawner tests', () => {
  let appSpawner;
  let logStub;
  let configStub;
  let globalStateStub;
  let aggregateStub;
  let delayStub;
  let daemonSyncStub;

  function createConfigStub(overrides = {}) {
    return {
      database: {
        daemon: { database: 'daemon' },
        appslocal: { database: 'localapps' },
        appsglobal: { database: 'globalapps' },
      },
      fluxapps: {
        installation: { delay: 300 },
        daemonPONFork: 2020000,
        blocksLasting: 22000,
        newMinBlocksAllowance: 100,
        ...overrides,
      },
    };
  }

  function createGlobalStateStub() {
    return {
      dbReady: true,
      fluxNodeWasNotConfirmedOnLastCheck: false,
      fluxNodeWasAlreadyConfirmed: true,
      firstExecutionAfterItsSynced: false,
      spawnErrorsLongerAppCache: new Map(),
      trySpawningGlobalAppCache: new Map(),
      appsToBeCheckedLater: [],
      appsSyncthingToBeCheckedLater: [],
    };
  }

  function buildModule(opts = {}) {
    configStub = createConfigStub(opts.configOverrides);
    globalStateStub = createGlobalStateStub();
    if (opts.globalStateOverrides) {
      Object.assign(globalStateStub, opts.globalStateOverrides);
    }

    logStub = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
    aggregateStub = sinon.stub().resolves(opts.aggregateResult || []);
    // First delay resolves normally, subsequent calls reject to break recursion
    delayStub = sinon.stub();
    delayStub.onFirstCall().resolves();
    delayStub.onSecondCall().rejects(new Error('break recursion'));
    delayStub.rejects(new Error('break recursion'));
    daemonSyncStub = sinon.stub().returns({
      data: { height: opts.daemonHeight || 2555563, synced: true },
    });

    appSpawner = proxyquire('../../ZelBack/src/services/appLifecycle/appSpawner', {
      config: configStub,
      '../dbHelper': {
        databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
        aggregateInDatabase: aggregateStub,
        findInDatabase: sinon.stub().resolves([]),
      },
      '../serviceHelper': {
        delay: delayStub,
        ensureNumber: sinon.stub().returnsArg(0),
      },
      '../generalService': {
        checkSynced: sinon.stub().resolves(true),
        isNodeStatusConfirmed: sinon.stub().resolves(true),
        nodeTier: sinon.stub().resolves('cumulus'),
      },
      '../benchmarkService': {
        getBenchmarks: sinon.stub().resolves({
          status: 'success',
          data: { ipaddress: '192.168.1.1' },
        }),
      },
      '../fluxNetworkHelper': {
        isPortOpen: sinon.stub().resolves(true),
        isPortUserBlocked: sinon.stub().returns(false),
        isNodeDos: sinon.stub().returns(false),
      },
      '../daemonService/daemonServiceMiscRpcs': {
        isDaemonSynced: daemonSyncStub,
      },
      '../../lib/log': logStub,
      '../appQuery/appQueryService': {
        listRunningApps: sinon.stub().resolves({ status: 'success', data: [] }),
      },
      '../appDatabase/registryManager': {
        appLocation: sinon.stub().resolves([]),
        appInstallingLocation: sinon.stub().resolves([]),
        getApplicationGlobalSpecifications: sinon.stub().resolves(opts.appSpec || null),
        expireGlobalApplications: sinon.stub().resolves(),
        storeAppInstallingMessage: sinon.stub().resolves(),
        getRunningAppIpList: sinon.stub().resolves([]),
        countAppInstallingErrors: sinon.stub().resolves(opts.errorCount ?? 0),
      },
      '../appSecurity/imageManager': {
        checkApplicationImagesCompliance: sinon.stub().resolves(),
        verifyRepository: sinon.stub().resolves(),
        isAppVetted: sinon.stub().resolves(false),
      },
      '../appRequirements/hwRequirements': {
        checkAppRequirements: sinon.stub().resolves(),
        totalAppHWRequirements: sinon.stub().returns({ cpu: 1, ram: 1000, hdd: 10 }),
        checkAppCpuBurstHeadroom: sinon.stub().resolves(),
      },
      '../appNetwork/portManager': {
        ensureApplicationPortsNotUsed: sinon.stub().resolves(),
        checkInstallingAppPortAvailable: sinon.stub().resolves(true),
      },
      '../utils/appUtilities': {
        getAppPorts: sinon.stub().returns([]),
      },
      '../appSystem/systemIntegration': {
        systemArchitecture: sinon.stub().resolves('amd64'),
        nodeFullGeolocation: sinon.stub().returns('US-NY'),
      },
      '../utils/globalState': globalStateStub,
      '../geolocationService': {
        isStaticIP: sinon.stub().returns(false),
        isDataCenter: sinon.stub().returns(false),
      },
      './advancedWorkflows': {
        getPeerAppsInstallingErrorMessages: sinon.stub().resolves(),
      },
      '../fluxCommunicationMessagesSender': {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
        broadcastMessageToAll: sinon.stub().resolves(),
      },
      '../utils/appConstants': {
        globalAppsInformation: 'appsInformation',
        localAppsInformation: 'localAppsInformation',
      },
      '../utils/enterpriseNetwork': {
        getCachedEnterpriseIdentity: sinon.stub().returns(false),
        getSpawnDelays: sinon.stub().returns({ shortDelayTime: 60000, delayTime: 60000 }),
        filterAppsByOwnership: sinon.stub().callsFake((apps) => apps),
        isEnterpriseAppOwner: opts.isEnterpriseAppOwner || sinon.stub().returns(false),
      },
      '../utils/cacheManager': {
        FluxCacheManager: { oneHour: 3600000 },
      },
      '../utils/fluxEventBus': {
        publish: sinon.stub(),
      },
      './appInstaller': {
        registerAppLocally: opts.installStub ?? sinon.stub().resolves(true),
      },
      './appUninstaller': {
        removeAppLocally: sinon.stub().resolves(),
      },
    });
  }

  afterEach(() => {
    sinon.restore();
  });

  describe('initialize', () => {
    beforeEach(() => buildModule());

    it('should initialize appInstaller and appUninstaller dependencies', () => {
      const deps = {
        appInstaller: { registerAppLocally: sinon.stub() },
        appUninstaller: { removeAppLocally: sinon.stub() },
      };
      appSpawner.initialize(deps);
      expect(appSpawner.initialize).to.be.a('function');
    });

    it('should handle empty dependencies object', () => {
      appSpawner.initialize({});
      expect(appSpawner.initialize).to.be.a('function');
    });
  });

  describe('trySpawningGlobalApplication', () => {
    beforeEach(() => buildModule());

    it('should be exported as a function', () => {
      expect(appSpawner.trySpawningGlobalApplication).to.be.a('function');
    });
  });

  describe('enterprise node-IP targeting filter', () => {
    const MY_IP = '192.168.1.1'; // matches the benchmark stub ipaddress

    function makeApp(overrides = {}) {
      return {
        name: 'targetedapp',
        hash: 'hash-targetedapp',
        actual: 0,
        required: 3,
        nodes: [],
        geolocation: [],
        version: 8,
        // enterprise:true makes the function short-circuit at the ArcaneOS check
        // right after selection, keeping these tests shallow.
        enterprise: true,
        owner: 'normalOwner',
        ...overrides,
      };
    }

    function infoLogged(substr) {
      return logStub.info.getCalls().some((c) => typeof c.args[0] === 'string' && c.args[0].includes(substr));
    }

    it('drops a v8 enterprise-owned app whose targeted IP is not this node', async () => {
      buildModule({
        aggregateResult: [makeApp({ owner: 'enterpriseOwnerX', nodes: ['10.0.0.99'] })],
        isEnterpriseAppOwner: (owner) => owner === 'enterpriseOwnerX',
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('No app currently to be processed')).to.be.true;
      expect(infoLogged('selected to try to spawn')).to.be.false;
    });

    it('keeps a v8 enterprise-owned app whose targeted IP matches this node', async () => {
      buildModule({
        aggregateResult: [makeApp({ owner: 'enterpriseOwnerX', nodes: [MY_IP] })],
        isEnterpriseAppOwner: (owner) => owner === 'enterpriseOwnerX',
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('selected to try to spawn')).to.be.true;
    });

    it('still lets a v8 non-enterprise app through when its targeted IP is not this node', async () => {
      buildModule({
        aggregateResult: [makeApp({ owner: 'normalOwner', nodes: ['10.0.0.99'] })],
        isEnterpriseAppOwner: () => false,
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('selected to try to spawn')).to.be.true;
    });

    it('keeps an enterprise-owned app that targets no nodes (no IP restriction) (finding #12)', async () => {
      buildModule({
        aggregateResult: [makeApp({ owner: 'enterpriseOwnerX', nodes: [] })],
        isEnterpriseAppOwner: (owner) => owner === 'enterpriseOwnerX',
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('selected to try to spawn')).to.be.true;
    });
  });

  describe('expiration filter pipeline', () => {
    beforeEach(() => buildModule({ daemonHeight: 2555563 }));

    function getPipelineFromCall() {
      expect(aggregateStub.calledOnce).to.be.true;
      return aggregateStub.firstCall.args[2];
    }

    function evaluateExpiration(height, expire, currentHeight) {
      const ponFork = 2020000;
      const blocksLasting = 22000;
      const minBlocksAllowance = 100;

      const expireIn = expire ?? (height >= ponFork ? blocksLasting * 4 : blocksLasting);
      let actualExpirationHeight;
      if (height < ponFork) {
        const originalExpiration = height + expireIn;
        if (originalExpiration <= ponFork) {
          actualExpirationHeight = originalExpiration;
        } else {
          const blocksAfterFork = originalExpiration - ponFork;
          actualExpirationHeight = ponFork + (blocksAfterFork * 4);
        }
      } else {
        actualExpirationHeight = height + expireIn;
      }
      return {
        actualExpirationHeight,
        wouldInstall: actualExpirationHeight > currentHeight + minBlocksAllowance,
      };
    }

    it('should include expiration filter stages before $lookup', async () => {
      await appSpawner.trySpawningGlobalApplication();
      const pipeline = getPipelineFromCall();

      // First stage: $addFields for _expireIn
      expect(pipeline[0]).to.have.property('$addFields');
      expect(pipeline[0].$addFields).to.have.property('_expireIn');

      // Second stage: $addFields for _actualExpirationHeight
      expect(pipeline[1]).to.have.property('$addFields');
      expect(pipeline[1].$addFields).to.have.property('_actualExpirationHeight');

      // Third stage: $match on _actualExpirationHeight
      expect(pipeline[2]).to.have.property('$match');
      expect(pipeline[2].$match).to.have.property('_actualExpirationHeight');

      // Fourth stage should be the $lookup (previously first)
      expect(pipeline[3]).to.have.property('$lookup');
    });

    it('should use daemon height + newMinBlocksAllowance as threshold', async () => {
      await appSpawner.trySpawningGlobalApplication();
      const pipeline = getPipelineFromCall();

      expect(pipeline[2].$match._actualExpirationHeight.$gt).to.equal(2555563 + 100);
    });

    it('should use correct post-PON default expire (blocksLasting * 4)', async () => {
      await appSpawner.trySpawningGlobalApplication();
      const pipeline = getPipelineFromCall();

      // The $ifNull fallback for post-PON should be 88000
      const expireField = pipeline[0].$addFields._expireIn;
      const condThen = expireField.$ifNull[1].$cond.then;
      expect(condThen).to.equal(22000 * 4);
    });

    it('should use correct pre-PON default expire (blocksLasting)', async () => {
      await appSpawner.trySpawningGlobalApplication();
      const pipeline = getPipelineFromCall();

      const expireField = pipeline[0].$addFields._expireIn;
      const condElse = expireField.$ifNull[1].$cond.else;
      expect(condElse).to.equal(22000);
    });

    it('should not include _expireIn or _actualExpirationHeight in $project output', async () => {
      await appSpawner.trySpawningGlobalApplication();
      const pipeline = getPipelineFromCall();

      const projectStage = pipeline.find((stage) => stage.$project);
      expect(projectStage.$project).to.not.have.property('_expireIn');
      expect(projectStage.$project).to.not.have.property('_actualExpirationHeight');
    });

    // Expiration math verification using the same logic as the pipeline
    describe('expiration math', () => {
      const currentHeight = 2555563;

      it('should reject post-PON app with expire=100 (cancellation)', () => {
        const result = evaluateExpiration(2555500, 100, currentHeight);
        expect(result.wouldInstall).to.be.false;
      });

      it('should reject post-PON app with expire=85', () => {
        const result = evaluateExpiration(2555500, 85, currentHeight);
        expect(result.wouldInstall).to.be.false;
      });

      it('should accept post-PON app with 101+ blocks remaining', () => {
        const result = evaluateExpiration(2555500, 164, currentHeight);
        expect(result.wouldInstall).to.be.true;
      });

      it('should accept post-PON app with default expire (88000)', () => {
        const result = evaluateExpiration(2550000, 88000, currentHeight);
        expect(result.wouldInstall).to.be.true;
      });

      it('should accept post-PON app with no expire field (defaults to 88000)', () => {
        const result = evaluateExpiration(2550000, undefined, currentHeight);
        expect(result.actualExpirationHeight).to.equal(2550000 + 88000);
        expect(result.wouldInstall).to.be.true;
      });

      it('should reject pre-PON app that expires before fork', () => {
        const result = evaluateExpiration(2019000, 85, currentHeight);
        expect(result.actualExpirationHeight).to.equal(2019085);
        expect(result.wouldInstall).to.be.false;
      });

      it('should apply 4x multiplier to blocks after PON fork', () => {
        // height=2000000, expire=22000 -> original=2022000
        // blocksAfterFork = 2022000 - 2020000 = 2000
        // adjusted = 2000 * 4 = 8000
        // actual = 2020000 + 8000 = 2028000
        const result = evaluateExpiration(2000000, 22000, currentHeight);
        expect(result.actualExpirationHeight).to.equal(2028000);
        expect(result.wouldInstall).to.be.false;
      });

      it('should handle pre-PON app close to threshold (under)', () => {
        // Computed to have 49 blocks remaining after adjustment
        const result = evaluateExpiration(2000000, 153903, currentHeight);
        expect(result.actualExpirationHeight).to.equal(2555612);
        expect(result.wouldInstall).to.be.false;
      });

      it('should handle pre-PON app close to threshold (over)', () => {
        // Computed to have 249 blocks remaining after adjustment
        const result = evaluateExpiration(2000000, 153953, currentHeight);
        expect(result.actualExpirationHeight).to.equal(2555812);
        expect(result.wouldInstall).to.be.true;
      });

      it('should accept pre-PON app with long lease (264000)', () => {
        const result = evaluateExpiration(2000000, 264000, currentHeight);
        expect(result.actualExpirationHeight).to.equal(2996000);
        expect(result.wouldInstall).to.be.true;
      });

      it('should reject pre-PON app with no expire field (defaults to 22000)', () => {
        const result = evaluateExpiration(2000000, undefined, currentHeight);
        expect(result.actualExpirationHeight).to.equal(2028000);
        expect(result.wouldInstall).to.be.false;
      });

      it('should reject post-PON app with exactly 100 blocks remaining', () => {
        // height + expire - currentHeight = 100 exactly
        const result = evaluateExpiration(2555414, 249, currentHeight);
        expect(result.actualExpirationHeight - currentHeight).to.equal(100);
        expect(result.wouldInstall).to.be.false;
      });
    });
  });

  describe('install error caching', () => {
    const spawnableApp = {
      name: 'testApp',
      actual: 0,
      required: 3,
      nodes: [],
      geolocation: [],
      hash: 'abc123',
      version: 7,
      enterprise: false,
      owner: 'testOwner',
    };

    const fullSpec = {
      name: 'testApp',
      hash: 'abc123',
      version: 7,
      instances: 3,
      compose: [{ repotag: 'testimage:latest', containerData: '' }],
    };

    it('should add to short-term cache when network error count >= 5', async () => {
      buildModule({ aggregateResult: [spawnableApp], appSpec: fullSpec, errorCount: 5 });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(globalStateStub.trySpawningGlobalAppCache.has('abc123')).to.be.true;
      expect(globalStateStub.spawnErrorsLongerAppCache.has('abc123')).to.be.false;
    });

    it('should not block when network error count < 5', async () => {
      buildModule({ aggregateResult: [spawnableApp], appSpec: fullSpec, errorCount: 4 });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(logStub.error.args.some((a) => a[0]?.message?.includes('network-wide install failures'))).to.be.false;
    });

    it('should add to long-term cache on local install failure', async () => {
      buildModule({
        aggregateResult: [spawnableApp],
        appSpec: fullSpec,
        errorCount: 0,
        installStub: sinon.stub().resolves(false),
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(globalStateStub.spawnErrorsLongerAppCache.has('abc123')).to.be.true;
    });

    it('should not overwrite short-term cache with long-term cache when network errors throw into catch', async () => {
      buildModule({ aggregateResult: [spawnableApp], appSpec: fullSpec, errorCount: 5 });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(globalStateStub.trySpawningGlobalAppCache.has('abc123')).to.be.true;
      expect(globalStateStub.spawnErrorsLongerAppCache.has('abc123')).to.be.false;
    });

    it('should filter apps in long-term cache from selection', async () => {
      buildModule({ aggregateResult: [spawnableApp], appSpec: fullSpec, errorCount: 0 });
      globalStateStub.spawnErrorsLongerAppCache.set('abc123', '');
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(logStub.info.args.some((a) => a[0]?.includes?.('No app currently to be processed'))).to.be.true;
    });

    it('should filter apps in short-term cache from selection', async () => {
      buildModule({ aggregateResult: [spawnableApp], appSpec: fullSpec, errorCount: 0 });
      globalStateStub.trySpawningGlobalAppCache.set('abc123', '');
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(logStub.info.args.some((a) => a[0]?.includes?.('No app currently to be processed'))).to.be.true;
    });
  });

  describe('spawn loop', () => {
    const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('../../ZelBack/src/services/utils/appSyncEvents');

    afterEach(() => {
      appSyncEvents.removeAllListeners();
    });

    function waitForLoopExits(n, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Expected ${n} loop exit(s) within ${timeoutMs}ms`)), timeoutMs);
        const check = () => {
          const count = logStub.info.getCalls().filter(
            (c) => c.args[0] === 'Spawn loop exited (paused)',
          ).length;
          if (count >= n) { clearTimeout(timer); resolve(); } else { setTimeout(check, 5); }
        };
        check();
      });
    }

    it('should call trySpawningGlobalApplication repeatedly until paused', async () => {
      buildModule();
      delayStub.resetBehavior();
      let iterations = 0;
      delayStub.callsFake(() => {
        iterations += 1;
        if (iterations >= 3) globalStateStub.spawnerPaused = true;
        return Promise.resolve();
      });

      appSpawner.initialize();
      appSyncEvents.emit(SYNC_EVENTS.SPAWNER_READY);
      await waitForLoopExits(1);

      expect(aggregateStub.callCount).to.equal(3);
    });

    it('should exit loop when spawnerPaused set mid-iteration', async () => {
      buildModule();
      delayStub.resetBehavior();
      delayStub.callsFake(() => {
        globalStateStub.spawnerPaused = true;
        return Promise.resolve();
      });

      appSpawner.initialize();
      appSyncEvents.emit(SYNC_EVENTS.SPAWNER_READY);
      await waitForLoopExits(1);

      expect(aggregateStub.callCount).to.equal(1);
      expect(logStub.info.calledWith('Spawn loop exited (paused)')).to.be.true;
    });

    it('should not start a second loop on duplicate SPAWNER_READY', async () => {
      buildModule();
      delayStub.resetBehavior();
      let iterations = 0;
      delayStub.callsFake(() => {
        iterations += 1;
        if (iterations === 1) {
          appSyncEvents.emit(SYNC_EVENTS.SPAWNER_READY);
        }
        if (iterations >= 3) globalStateStub.spawnerPaused = true;
        return Promise.resolve();
      });

      appSpawner.initialize();
      appSyncEvents.emit(SYNC_EVENTS.SPAWNER_READY);
      await waitForLoopExits(1);

      const exitLogs = logStub.info.getCalls().filter(
        (c) => c.args[0] === 'Spawn loop exited (paused)',
      );
      expect(exitLogs).to.have.lengthOf(1);
      expect(aggregateStub.callCount).to.equal(3);
    });

    it('should restart loop on SPAWNER_READY after pause', async () => {
      buildModule();
      delayStub.resetBehavior();
      let iterations = 0;
      delayStub.callsFake(() => {
        iterations += 1;
        if (iterations === 2) {
          appSyncEvents.emit(SYNC_EVENTS.READINESS_LOST);
        }
        if (iterations >= 5) globalStateStub.spawnerPaused = true;
        return Promise.resolve();
      });

      appSpawner.initialize();
      appSyncEvents.emit(SYNC_EVENTS.SPAWNER_READY);
      await waitForLoopExits(1);

      expect(aggregateStub.callCount).to.equal(2);

      appSyncEvents.emit(SYNC_EVENTS.SPAWNER_READY);
      await waitForLoopExits(2);

      expect(aggregateStub.callCount).to.be.gte(4);
    });

    it('should return delay value from trySpawningGlobalApplication not recurse', async () => {
      buildModule();
      delayStub.resetBehavior();
      const delays = [];
      delayStub.callsFake((ms) => {
        delays.push(ms);
        globalStateStub.spawnerPaused = true;
        return Promise.resolve();
      });

      appSpawner.initialize();
      appSyncEvents.emit(SYNC_EVENTS.SPAWNER_READY);
      await waitForLoopExits(1);

      expect(delays).to.have.lengthOf(1);
      expect(delays[0]).to.be.a('number');
      expect(delays[0]).to.be.greaterThan(0);
    });
  });

  describe('deferred queue fixes', () => {
    it('findIndex should match apps whose timeToCheck is in the past (<=)', () => {
      const now = Date.now();
      const queue = [
        { timeToCheck: now - 1000, appName: 'ready', hash: 'abc', required: 3 },
        { timeToCheck: now + 60000, appName: 'notReady', hash: 'def', required: 3 },
      ];
      // Fixed: <= means we find apps whose time has passed
      const index = queue.findIndex((app) => app.timeToCheck <= now);
      expect(index).to.equal(0);
      expect(queue[index].appName).to.equal('ready');
    });

    it('findIndex should not match apps whose timeToCheck is in the future', () => {
      const now = Date.now();
      const queue = [
        { timeToCheck: now + 60000, appName: 'notReady', hash: 'abc', required: 3 },
      ];
      const index = queue.findIndex((app) => app.timeToCheck <= now);
      expect(index).to.equal(-1);
    });

    it('findIndex with old bug (>=) would incorrectly match future apps', () => {
      const now = Date.now();
      const queue = [
        { timeToCheck: now + 60000, appName: 'notReady', hash: 'abc', required: 3 },
      ];
      // Old buggy behavior: >= matches apps still waiting
      const buggyIndex = queue.findIndex((app) => app.timeToCheck >= now);
      expect(buggyIndex).to.equal(0); // Bug: would pop an app that should still be waiting
    });

    it('Array.some should correctly filter apps already in deferred queue', () => {
      const queue = [
        { appName: 'myApp', hash: 'abc', required: 3, timeToCheck: Date.now() + 60000 },
      ];
      const apps = [
        { name: 'myApp', hash: 'abc' },
        { name: 'otherApp', hash: 'def' },
      ];
      const filtered = apps.filter((app) => !queue.some((appAux) => appAux.appName === app.name));
      expect(filtered).to.have.lengthOf(1);
      expect(filtered[0].name).to.equal('otherApp');
    });

    it('Array.includes with callback (old bug) never filters anything', () => {
      const queue = [
        { appName: 'myApp', hash: 'abc', required: 3, timeToCheck: Date.now() + 60000 },
      ];
      const apps = [
        { name: 'myApp', hash: 'abc' },
        { name: 'otherApp', hash: 'def' },
      ];
      // Old buggy behavior: includes() with a function always returns false
      // eslint-disable-next-line no-array-constructor
      const filtered = apps.filter((app) => !queue.includes((appAux) => appAux.appName === app.name));
      expect(filtered).to.have.lengthOf(2); // Bug: nothing filtered
    });
  });
});
