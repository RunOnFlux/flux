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
  let enterpriseNetworkStub;

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
    enterpriseNetworkStub = {
      getCachedEnterpriseIdentity: sinon.stub().returns(opts.getCachedEnterpriseIdentity === undefined ? false : opts.getCachedEnterpriseIdentity),
      getSpawnDelays: sinon.stub().returns({ shortDelayTime: 60000, delayTime: 60000 }),
      filterAppsByOwnership: sinon.stub().callsFake((apps) => apps),
      isEnterpriseAppOwner: opts.isEnterpriseAppOwner || sinon.stub().returns(false),
    };

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
        appLocation: sinon.stub().resolves(opts.appLocations || []),
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
      '../utils/enterpriseNetwork': enterpriseNetworkStub,
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
      './appNetworkLinker': {
        // Default: every app's network links are satisfied (matches the real
        // module's behaviour for apps with no networkWith token). Tests that
        // exercise the readiness filter / dependency gate override this stub.
        checkAppNetworkRequirements: opts.checkAppNetworkRequirements ?? sinon.stub().resolves(true),
        parseDependencyOnly: opts.parseDependencyOnly ?? sinon.stub().returns(false),
        getRequiredDependencyNamesForNode: opts.getRequiredDependencyNamesForNode ?? sinon.stub().resolves(new Set()),
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

  describe('networkWith readiness filter (ungated) + dependency skip', () => {
    function makeApp(overrides = {}) {
      return {
        name: 'wrkapp',
        hash: 'hash-wrkapp',
        actual: 0,
        required: 3,
        nodes: [],
        geolocation: [],
        version: 8,
        // enterprise:true short-circuits at the ArcaneOS check right after
        // selection, so a kept app is provably "selected" without installing.
        enterprise: true,
        owner: 'owner1',
        description: 'networkWith:[collector]',
        ...overrides,
      };
    }

    function infoLogged(substr) {
      return logStub.info.getCalls().some((c) => typeof c.args[0] === 'string' && c.args[0].includes(substr));
    }

    function notReadyError() {
      return Object.assign(new Error("App 'collector' is not installed on this node"), { code: 'NETWORK_DEPENDENCY_NOT_READY' });
    }

    it('flag-OFF: drops a candidate whose networkWith dependency is not ready (filter is no longer gated)', async () => {
      buildModule({
        // manageDependencyOnlyLifecycle defaults off here - the skip must work anyway
        aggregateResult: [makeApp()],
        checkAppNetworkRequirements: sinon.stub().rejects(notReadyError()),
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('No app currently to be processed')).to.be.true;
      expect(infoLogged('selected to try to spawn')).to.be.false;
    });

    it('flag-OFF: keeps a candidate whose networkWith dependency is ready', async () => {
      buildModule({
        aggregateResult: [makeApp()],
        checkAppNetworkRequirements: sinon.stub().resolves(true),
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('selected to try to spawn')).to.be.true;
    });

    it('keeps a candidate whose dependency check throws a non-NOT_READY error (real misconfig handled at install)', async () => {
      buildModule({
        aggregateResult: [makeApp()],
        checkAppNetworkRequirements: sinon.stub().rejects(new Error('owned by a different owner')),
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('selected to try to spawn')).to.be.true;
    });

    it('flag-ON: also drops a not-ready candidate (symmetry)', async () => {
      buildModule({
        configOverrides: { manageDependencyOnlyLifecycle: true },
        aggregateResult: [makeApp()],
        checkAppNetworkRequirements: sinon.stub().rejects(notReadyError()),
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('No app currently to be processed')).to.be.true;
      expect(infoLogged('selected to try to spawn')).to.be.false;
    });

    it('a queued dependency-not-ready app drains from appsToBeCheckedLater instead of re-deferring', async () => {
      const queued = {
        appName: 'depapp', hash: 'hash-depapp', required: 3, timeToCheck: Date.now() - 1000,
      };
      buildModule({
        // a placeholder keeps numberOfGlobalApps > 0 so the deferred-queue branch is reached;
        // the queued entry (not the placeholder) is what gets processed via appIndex >= 0
        aggregateResult: [makeApp({ name: 'placeholder', hash: 'hash-placeholder' })],
        globalStateOverrides: { appsToBeCheckedLater: [queued] },
        appSpec: {
          name: 'depapp',
          version: 8,
          owner: 'owner1',
          enterprise: false,
          description: 'networkWith:[collector]',
          compose: [{
            name: 'c0', repotag: 'img:latest', containerData: '/data', environmentParameters: [], ports: [],
          }],
        },
        checkAppNetworkRequirements: sinon.stub().rejects(notReadyError()),
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      // spliced out when picked, and NOT re-pushed -> queue ends empty (cannot monopolise the loop)
      expect(globalStateStub.appsToBeCheckedLater).to.have.lengthOf(0);
      // the in-flight throttle was cleared so it is reconsidered cleanly next cycle
      expect(globalStateStub.trySpawningGlobalAppCache.has('hash-depapp')).to.be.false;
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

  describe('syncthing placement caution uses the canonical g:/r:/s: classification', () => {
    // The spawner avoids co-locating instances of syncthing-synced apps in the same
    // IP range. Whether an app IS synced must come from the canonical classifier
    // (sync flags are only valid on the primary mount), not a loose substring scan:
    // a g:/s: in an invalid position or inside a word ('logs:') is NOT a synced app,
    // so the placement caution must not apply to it.
    //
    // The local node's IP is 192.168.1.1 (benchmark stub), so a location in
    // 192.168.x.x is "same IP range" without being "same IP".
    const sameRangeLocation = [{ ip: '192.168.50.50:16127' }];

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

    function composedSpec(containerData) {
      return {
        name: 'testApp',
        hash: 'abc123',
        version: 7,
        instances: 3,
        compose: [{ name: 'comp0', repotag: 'testimage:latest', containerData }],
      };
    }

    async function runSpawnAttempt(spec) {
      const installStub = sinon.stub().resolves(true);
      buildModule({
        aggregateResult: [spawnableApp],
        appSpec: spec,
        appLocations: sameRangeLocation,
        installStub,
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      const deferredForSyncthing = logStub.info.args.some(
        (a) => typeof a[0] === 'string' && a[0].includes('uses syncthing and it is already spawned on Fluxnode with same ip range'),
      );
      return { installStub, deferredForSyncthing };
    }

    it('defers a g: app when an instance runs in the same IP range', async () => {
      const { installStub, deferredForSyncthing } = await runSpawnAttempt(composedSpec('g:/data'));
      expect(deferredForSyncthing).to.be.true;
      expect(installStub.called).to.be.false;
    });

    it('defers a v1-3 r: app when an instance runs in the same IP range', async () => {
      const spec = {
        name: 'testApp',
        hash: 'abc123',
        version: 2,
        repotag: 'testimage:latest',
        containerData: 'r:/data',
      };
      const { installStub, deferredForSyncthing } = await runSpawnAttempt(spec);
      expect(deferredForSyncthing).to.be.true;
      expect(installStub.called).to.be.false;
    });

    it('does NOT apply the caution to a sync flag on a non-primary mount (not a synced app)', async () => {
      const { installStub, deferredForSyncthing } = await runSpawnAttempt(composedSpec('/data|g:/var/roundcube/db'));
      expect(deferredForSyncthing).to.be.false;
      expect(installStub.called).to.be.true;
    });

    it("does NOT apply the caution to a non-flag word containing flag letters ('logs:')", async () => {
      const { installStub, deferredForSyncthing } = await runSpawnAttempt(composedSpec('logs:/var/log'));
      expect(deferredForSyncthing).to.be.false;
      expect(installStub.called).to.be.true;
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

  describe('isSoleRequiredInstaller', () => {
    beforeEach(() => buildModule());

    it('is true when pinned to exactly as many nodes as required instances', () => {
      expect(appSpawner.isSoleRequiredInstaller({ nodes: ['1.2.3.4:16127'] }, 1)).to.equal(true);
      expect(appSpawner.isSoleRequiredInstaller({ nodes: ['a', 'b'] }, 2)).to.equal(true);
    });

    it('is true when pinned to fewer nodes than required instances', () => {
      expect(appSpawner.isSoleRequiredInstaller({ nodes: ['1.2.3.4:16127'] }, 3)).to.equal(true);
    });

    it('is false when pinned to more nodes than required instances (real contention)', () => {
      expect(appSpawner.isSoleRequiredInstaller({ nodes: ['a', 'b', 'c'] }, 2)).to.equal(false);
    });

    it('is false for an unpinned app (empty or missing nodes)', () => {
      expect(appSpawner.isSoleRequiredInstaller({ nodes: [] }, 1)).to.equal(false);
      expect(appSpawner.isSoleRequiredInstaller({ nodes: null }, 1)).to.equal(false);
      expect(appSpawner.isSoleRequiredInstaller({}, 1)).to.equal(false);
    });

    it('is false when the spec is missing', () => {
      expect(appSpawner.isSoleRequiredInstaller(undefined, 1)).to.equal(false);
    });
  });

  describe('notifySpecStored - spec-stored wake gate', () => {
    const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('../../ZelBack/src/services/utils/appSyncEvents');
    // normalized form of the harness benchmark IP (192.168.1.1 -> :16127)
    const MY_ADDR = '192.168.1.1:16127';

    afterEach(() => {
      appSyncEvents.removeAllListeners();
    });

    function waitUntil(predicate, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('waitUntil timed out')), timeoutMs);
        const check = () => {
          if (predicate()) { clearTimeout(timer); resolve(); } else { setTimeout(check, 5); }
        };
        check();
      });
    }

    function loopExits(n = 1) {
      return waitUntil(() => logStub.info.getCalls().filter(
        (c) => c.args[0] === 'Spawn loop exited (paused)',
      ).length >= n);
    }

    // Run one spawn cycle so the module caches this node's socket address
    // (notifySpecStored's pin-match reads that cache).
    async function primeNodeAddr() {
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
    }

    function woke() {
      return logStub.info.getCalls().some(
        (c) => typeof c.args[0] === 'string' && c.args[0].includes('waking spawn loop'),
      );
    }

    const passingSpec = (overrides = {}) => ({
      name: 'edingoa', owner: 'enterpriseOwnerX', nodes: [MY_ADDR], instances: 1, ...overrides,
    });

    it('wakes for an enterprise-owned app pinned to this node with pins <= instances', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec());
      expect(woke()).to.equal(true);
    });

    it('wakes when pinned to fewer nodes than required instances', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec({ instances: 3 }));
      expect(woke()).to.equal(true);
    });

    it('wakes when pinned to exactly as many nodes as required instances (mandatory installer, no contention)', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      // 2 pins, 2 instances -> every pinned node must install, no overshoot
      appSpawner.notifySpecStored(passingSpec({ nodes: [MY_ADDR, '10.0.0.1:16127'], instances: 2 }));
      expect(woke()).to.equal(true);
    });

    it('wakes when instances is omitted (defaults to 3, mirroring the spawner aggregation)', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec({ instances: undefined }));
      expect(woke()).to.equal(true);
    });

    it('does NOT wake when instances is 0 (no overshoot headroom)', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec({ instances: 0 }));
      expect(woke()).to.equal(false);
    });

    it('does NOT wake before the first spawn cycle (node address not yet resolved)', () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      // no primeNodeAddr() -> lastKnownLocalSocketAddr is still null
      appSpawner.notifySpecStored(passingSpec());
      expect(woke()).to.equal(false);
    });

    it('does NOT wake on a non-enterprise node', async () => {
      buildModule({ getCachedEnterpriseIdentity: false, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec());
      expect(woke()).to.equal(false);
    });

    it('does NOT wake while enterprise identity is unresolved (null)', async () => {
      buildModule({ getCachedEnterpriseIdentity: null, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec());
      expect(woke()).to.equal(false);
    });

    it('does NOT wake for a non-enterprise-owned app', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => false });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec());
      expect(woke()).to.equal(false);
    });

    it('does NOT wake when pinned to a different node', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec({ nodes: ['10.0.0.99:16127'] }));
      expect(woke()).to.equal(false);
    });

    it('does NOT wake when pinned to more nodes than required instances (contention)', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec({ nodes: [MY_ADDR, '10.0.0.1:16127', '10.0.0.2:16127'], instances: 2 }));
      expect(woke()).to.equal(false);
    });

    it('does NOT wake for an unpinned (general global) app', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      appSpawner.notifySpecStored(passingSpec({ nodes: [] }));
      expect(woke()).to.equal(false);
    });

    it('does NOT wake when the spawner is paused', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      await primeNodeAddr();
      globalStateStub.spawnerPaused = true;
      appSpawner.notifySpecStored(passingSpec());
      expect(woke()).to.equal(false);
    });

    it('does not throw on a missing/empty spec', () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true });
      expect(() => appSpawner.notifySpecStored(undefined)).to.not.throw();
      expect(() => appSpawner.notifySpecStored(null)).to.not.throw();
      expect(woke()).to.equal(false);
    });

    it('ends the idle delay early and re-scans when a pinned spec is stored', async () => {
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true, aggregateResult: [] });
      delayStub.resetBehavior();
      let delayCalls = 0;
      delayStub.callsFake(() => {
        delayCalls += 1;
        // 1st idle wait parks until woken; 2nd ends the loop so the test finishes
        if (delayCalls >= 2) { globalStateStub.spawnerPaused = true; return Promise.resolve(); }
        return new Promise(() => {});
      });

      appSpawner.initialize();
      appSyncEvents.emit(SYNC_EVENTS.SPAWNER_READY);
      await waitUntil(() => aggregateStub.callCount === 1 && delayCalls === 1);

      // Causality guard: the first delay never resolves on its own, so the loop
      // is parked at exactly one scan. Only the wake can advance it - if it
      // didn't, this test would time out in loopExits rather than false-pass.
      expect(aggregateStub.callCount).to.equal(1);
      appSpawner.notifySpecStored(passingSpec());
      await loopExits(1);

      expect(aggregateStub.callCount).to.equal(2);
    });

    it('leaves the idle cadence intact when no relevant spec is stored', async () => {
      // regression: the wake is inert; serviceHelper.delay still drives the loop
      buildModule({ getCachedEnterpriseIdentity: true, isEnterpriseAppOwner: () => true, aggregateResult: [] });
      delayStub.resetBehavior();
      let delayCalls = 0;
      delayStub.callsFake(() => {
        delayCalls += 1;
        globalStateStub.spawnerPaused = true;
        return Promise.resolve();
      });

      appSpawner.initialize();
      appSyncEvents.emit(SYNC_EVENTS.SPAWNER_READY);
      await loopExits(1);

      expect(delayCalls).to.equal(1);
      expect(aggregateStub.callCount).to.equal(1);
    });
  });
});
