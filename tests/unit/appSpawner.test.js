const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const realPlacementFeasibility = require('../../ZelBack/src/services/appPlacement/placementFeasibility');

describe('appSpawner tests', () => {
  let appSpawner;
  let logStub;
  let configStub;
  let globalStateStub;
  let aggregateStub;
  let delayStub;
  let daemonSyncStub;
  let placementFeasibilityStub;

  // /16 fault-domain arithmetic, mirroring placementFeasibility's no-table fallback
  function testFaultDomain(address) {
    if (typeof address !== 'string' || !address) return null;
    const ip = address.split(':')[0];
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    return `net:${parts[0]}.${parts[1]}.0.0/16`;
  }

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
    placementFeasibilityStub = {
      // the selection filter runs the real shared matcher - a pure function;
      // re-stating its semantics in a stub is the defect class the parity
      // suite exists to prevent
      nodeLocationMatchesGeolocation: realPlacementFeasibility.nodeLocationMatchesGeolocation,
      isNodePinnedHere: sinon.stub().resolves(opts.pinnedHere ?? false),
      // one computation carries both the share and the domain function it was
      // computed with - the spawner keys every domain through the latter
      placementComputation: sinon.stub().resolves({
        feasibility: {
          instances: 3,
          candidateCount: 10,
          domainCount: 10,
          maxPerDomain: 1,
          placeable: true,
          tableAvailable: false,
          tableGenerated: null,
          ...opts.placementShare,
        },
        domainOf: testFaultDomain,
      }),
      faultDomain: sinon.stub().callsFake(async (address) => testFaultDomain(address)),
      countHeldInDomain: async (locations, domainKey, domainOf) => (locations ?? [])
        .filter((location) => (domainOf ?? testFaultDomain)(location.ip) === domainKey).length,
    };
    aggregateStub = sinon.stub().resolves(opts.aggregateResult || []);
    // The first delay(s) resolve normally, subsequent calls reject to break
    // recursion. Tests exercising the post-install self-check need the
    // one-minute settle delay to resolve too, so they pass resolveDelays: 2.
    delayStub = sinon.stub();
    const resolvedDelays = opts.resolveDelays ?? 1;
    for (let i = 0; i < resolvedDelays; i += 1) {
      delayStub.onCall(i).resolves();
    }
    delayStub.rejects(new Error('break recursion'));
    daemonSyncStub = sinon.stub().returns({
      data: { height: opts.daemonHeight || 2555563, synced: true },
    });

    const installStubRef = opts.installStub ?? sinon.stub().resolves(true);

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
        // The post-install self-check re-reads the running list after this
        // node's own install; tests exercising it provide that view via
        // opts.finalAppLocations (returned once the install stub has run).
        appLocation: sinon.stub().callsFake(() => Promise.resolve(
          (opts.finalAppLocations && installStubRef.called)
            ? opts.finalAppLocations
            : (opts.appLocations || []),
        )),
        // The list after the collision wait includes this node's own claim; tests
        // exercising the post-broadcast share resolver provide it via
        // opts.finalInstallingLocations (returned from the 4th fetch onwards).
        appInstallingLocation: (() => {
          const stub = sinon.stub();
          stub.callsFake(() => Promise.resolve(
            (opts.finalInstallingLocations && stub.callCount > 3)
              ? opts.finalInstallingLocations
              : (opts.installingLocations || []),
          ));
          return stub;
        })(),
        // Claims held against each candidate, keyed by lowercased name. Empty
        // means nothing is claimed - the same answer the real grouped read
        // gives when no install is in flight.
        installingCountsByApp: sinon.stub().callsFake(() => Promise.resolve(
          new Map(Object.entries(opts.installingCounts ?? {})),
        )),
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
        nodeFullGeolocation: sinon.stub().returns(opts.nodeGeoString ?? 'US-NY'),
      },
      '../appPlacement/ipLocationStore': {
        lookup: opts.storeLookup ?? sinon.stub().resolves(null),
        isStoreUnavailable: () => false,
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
      '../appMessaging/messageStore': {
        storeAppInstallingMessage: opts.withdrawalStub ?? sinon.stub().resolves(true),
        storeAppInstallingErrorMessage: opts.installingErrorStub ?? sinon.stub().resolves(true),
      },
      './appInstaller': {
        registerAppLocally: installStubRef,
      },
      './appUninstaller': {
        removeAppLocally: opts.removeAppLocallyStub ?? sinon.stub().resolves(),
      },
      '../appPlacement/placementFeasibility': placementFeasibilityStub,
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

    // The pool counts running instances, so an app whose remaining slots are
    // already claimed still reads as short. Selection is a lottery over what
    // survives these filters, so a candidate that cannot be helped must be gone
    // before the draw - otherwise it can win it, and the node spawns nothing.
    it('does not select an app whose remaining slots are already claimed', async () => {
      buildModule({
        aggregateResult: [makeApp()],
        installingCounts: { targetedapp: 3 },
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('No app currently to be processed')).to.be.true;
      expect(infoLogged('selected to try to spawn')).to.be.false;
    });

    it('still selects an app whose claims leave a slot open', async () => {
      buildModule({
        aggregateResult: [makeApp()],
        installingCounts: { targetedapp: 2 },
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('selected to try to spawn')).to.be.true;
    });

    it('matches claims to candidates case-insensitively, as every other lookup does', async () => {
      buildModule({
        aggregateResult: [makeApp({ name: 'TargetedApp' })],
        installingCounts: { targetedapp: 3 },
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      expect(infoLogged('selected to try to spawn')).to.be.false;
    });

    describe('geolocation selection filter', () => {
      // Selection shares one eligibility implementation with counting and the
      // install gate. The old string-prefix filters hid every table-vocabulary
      // region pin from spawning (ip-api never returns ISO codes) and stripped
      // _NONE, turning a no-op deny into a whole-country selection ban - both
      // proven against the pre-fix filters verbatim before this rework.
      const HESSE = { region: 'DE-HE' };

      function geoModule(geolocation, lookupResult) {
        buildModule({
          aggregateResult: [makeApp({ geolocation })],
          nodeGeoString: 'EU_DE_Hesse',
          storeLookup: sinon.stub().resolves(lookupResult === undefined ? null : {
            org: 'aabbccddeeff', block: null, countryCode: 'DE', continentCode: 'EU', region: lookupResult.region,
          }),
        });
      }

      it('selects a table-vocabulary region pin on a node the table places in it', async () => {
        geoModule(['acEU_DE_DE-HE'], HESSE);
        await appSpawner.trySpawningGlobalApplication().catch(() => {});
        expect(infoLogged('selected to try to spawn')).to.be.true;
      });

      it('does not select a region pin when the table places this node elsewhere', async () => {
        geoModule(['acEU_DE_DE-HE'], { region: 'DE-BY' });
        await appSpawner.trySpawningGlobalApplication().catch(() => {});
        expect(infoLogged('No app currently to be processed')).to.be.true;
      });

      it('does not select a region pin when its own region is unknown - a pin needs proof', async () => {
        geoModule(['acEU_DE_DE-HE'], undefined);
        await appSpawner.trySpawningGlobalApplication().catch(() => {});
        expect(infoLogged('No app currently to be processed')).to.be.true;
      });

      it('keeps selecting an a!c.._NONE app - the deny is a no-op, not a country ban', async () => {
        geoModule(['acEU', 'a!cEU_DE_NONE'], HESSE);
        await appSpawner.trySpawningGlobalApplication().catch(() => {});
        expect(infoLogged('selected to try to spawn')).to.be.true;
      });

      it('selects a legacy name-shaped region pin at country granularity - the installer arbitrates', async () => {
        geoModule(['acEU_DE_Bavaria'], HESSE);
        await appSpawner.trySpawningGlobalApplication().catch(() => {});
        expect(infoLogged('selected to try to spawn')).to.be.true;
      });
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
        (a) => typeof a[0] === 'string' && a[0].includes('of its 1-instance share'),
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

  describe('placement diversity share', () => {
    // The local node's IP is 192.168.1.1 (benchmark stub); locations in
    // 192.168.x.x share its /16 fault domain without being the same IP.
    const sameDomainLocation = [{ ip: '192.168.50.50:16127' }];

    const spawnableApp = {
      name: 'testApp',
      actual: 1,
      required: 3,
      nodes: [],
      geolocation: [],
      hash: 'abc123',
      version: 7,
      enterprise: false,
      owner: 'testOwner',
    };

    const syncedSpec = {
      name: 'testApp',
      hash: 'abc123',
      version: 7,
      instances: 3,
      compose: [{ name: 'comp0', repotag: 'testimage:latest', containerData: 'g:/data' }],
    };

    async function runAttempt(opts = {}) {
      const installStub = sinon.stub().resolves(true);
      const withdrawalStub = sinon.stub().resolves(true);
      const removeStub = sinon.stub().resolves();
      buildModule({
        aggregateResult: [spawnableApp],
        appSpec: syncedSpec,
        installStub,
        withdrawalStub,
        removeAppLocallyStub: removeStub,
        ...opts,
      });
      await appSpawner.trySpawningGlobalApplication().catch(() => {});
      const logged = (needle) => logStub.info.args.some(
        (a) => typeof a[0] === 'string' && a[0].includes(needle),
      );
      return {
        installStub, logged, withdrawalStub, removeStub,
      };
    }

    it('REGRESSION GUARD (the Bahrain incident): installs when the single eligible domain holds the whole share', async () => {
      // one domain, instances 3 -> the domain's share is all 3; one already
      // running here must NOT block the second. Pre-change code refused forever.
      const { installStub } = await runAttempt({
        appLocations: sameDomainLocation,
        placementShare: { domainCount: 1, maxPerDomain: 3 },
      });
      expect(installStub.called).to.be.true;
      expect(placementFeasibilityStub.placementComputation.calledWith(syncedSpec, 3)).to.be.true;
    });

    it('stands aside when many domains are eligible and this one holds its share', async () => {
      const { installStub, logged } = await runAttempt({
        appLocations: sameDomainLocation,
        placementShare: { domainCount: 10, maxPerDomain: 1 },
      });
      expect(installStub.called).to.be.false;
      expect(logged('already holds 1 of its 1-instance share')).to.be.true;
    });

    it('with two eligible domains and a share of two, installs at one held and refuses at two', async () => {
      const first = await runAttempt({
        appLocations: sameDomainLocation,
        placementShare: { domainCount: 2, maxPerDomain: 2 },
      });
      expect(first.installStub.called).to.be.true;

      const second = await runAttempt({
        appLocations: [{ ip: '192.168.50.50:16127' }, { ip: '192.168.60.60:16137' }],
        placementShare: { domainCount: 2, maxPerDomain: 2 },
      });
      expect(second.installStub.called).to.be.false;
      expect(second.logged('already holds 2 of its 2-instance share')).to.be.true;
    });

    it('installs anyway when the table resolves no candidates - this node is one', async () => {
      // A zero-candidate answer contradicts the local node, which reached this
      // check having passed its own geolocation filter. Refusing would strand
      // the app on every node; install-time geo checks stay authoritative.
      const { installStub } = await runAttempt({
        placementShare: {
          placeable: false, domainCount: 0, candidateCount: 0, maxPerDomain: 3,
        },
      });
      expect(installStub.called).to.be.true;
    });

    it('bypasses the share entirely when the owner pinned this node', async () => {
      const { installStub } = await runAttempt({
        pinnedHere: true,
        appSpec: { ...syncedSpec, nodes: ['192.168.1.1:16127', '10.0.0.2:16127', '10.0.0.3:16127'] },
        appLocations: sameDomainLocation,
        placementShare: { domainCount: 10, maxPerDomain: 1 },
      });
      expect(installStub.called).to.be.true;
      expect(placementFeasibilityStub.placementComputation.called).to.be.false;
    });

    it('treats a nodes list longer than the instance count as a pool, not a pin', async () => {
      // `nodes` may carry up to 120 entries against 3 instances - membership in
      // a pool that large expresses no co-location intent, so the share applies
      const manyNodes = Array.from({ length: 30 }, (unused, i) => `10.0.0.${i + 1}:16127`);
      const { installStub, logged } = await runAttempt({
        pinnedHere: true,
        appSpec: { ...syncedSpec, nodes: manyNodes },
        appLocations: sameDomainLocation,
        placementShare: { domainCount: 10, maxPerDomain: 1 },
      });
      expect(installStub.called).to.be.false;
      expect(logged('already holds')).to.be.true;
    });

    it('yields the remaining share to an earlier claimant after the collision wait, and retracts its claim', async () => {
      // a silent back-out would leave this node's installing broadcast alive
      // for its full TTL - counting against totals, blocking its own retry,
      // and capturing the seed election as a ghost
      const { installStub, logged, withdrawalStub } = await runAttempt({
        placementShare: { domainCount: 3, maxPerDomain: 1 },
        finalInstallingLocations: [
          { ip: '192.168.2.2:16127', broadcastedAt: 1000 },
          { ip: '192.168.1.1:16127', broadcastedAt: 2000 },
        ],
      });
      expect(installStub.called).to.be.false;
      expect(logged('earlier claimants in fault domain')).to.be.true;
      // the claim's own message, withdrawing the claim
      const withdrawals = withdrawalStub.getCalls().filter((c) => c.args[0].withdrawn === true);
      expect(withdrawals).to.have.lengthOf(1);
      const withdrawal = withdrawals[0].args[0];
      expect(withdrawal.type).to.equal('fluxappinstalling');
      expect(withdrawal.version).to.equal(2);
      expect(withdrawal.ip).to.equal('192.168.1.1:16127');
      expect(withdrawal.name).to.be.a('string');
    });

    it('does not claim an app the network already has covered', async () => {
      // Running plus installing already meets the requirement, so there is
      // nothing for another claim to add. Claiming anyway costs a broadcast, a
      // collision wait and a retraction to reach the answer available up front.
      // three required, three already claimed or running
      const { installStub, logged, withdrawalStub } = await runAttempt({
        appLocations: [{ ip: '192.168.3.3:16127' }],
        installingLocations: [
          { ip: '192.168.2.2:16127', broadcastedAt: 1000 },
          { ip: '192.168.4.4:16127', broadcastedAt: 1001 },
        ],
      });

      expect(installStub.called, 'installed over a claim that already covers it').to.be.false;
      expect(logged('already spawned or being installed')).to.be.true;
      expect(
        withdrawalStub.getCalls().filter((c) => c.args[0].withdrawn === true),
        'claimed and then retracted instead of standing aside',
      ).to.have.lengthOf(0);
    });

    it('still claims when the network is one instance short', async () => {
      // The other side of the boundary. Standing aside at "already covered" must
      // not become standing aside at "nearly covered", or the last instance of
      // every app goes unfilled.
      // three required, one running and one claimed - still one short
      const { installStub, logged } = await runAttempt({
        appLocations: sameDomainLocation,
        installingLocations: [{ ip: '192.168.2.2:16127', broadcastedAt: 1000 }],
        placementShare: { domainCount: 1, maxPerDomain: 3 },
      });

      expect(logged('already spawned or being installed'), 'stood aside while an instance was still missing').to.be.false;
      expect(installStub.called, 'did not take the instance the network was short').to.be.true;
    });

    it('stays eligible after standing down on the instance count, not just the share', async () => {
      // The same retraction is reached by two routes - ranked out on the app's
      // instance count, and ranked out on the fault domain's share - and both
      // must leave the node able to come back.
      await runAttempt({
        finalInstallingLocations: [
          { ip: '192.168.2.2:16127', broadcastedAt: 1000 },
          { ip: '192.168.3.3:16127', broadcastedAt: 1001 },
          { ip: '192.168.4.4:16127', broadcastedAt: 1002 },
          { ip: '192.168.1.1:16127', broadcastedAt: 2000 },
        ],
      });

      expect(globalStateStub.trySpawningGlobalAppCache.has('abc123')).to.be.false;
    });

    it('stays eligible for the app it stood aside from', async () => {
      // The scan only offers apps whose running count is below the required
      // count, so a satisfied app stops being offered on its own. Holding the
      // loser out beyond that would exclude it from the one moment it matters -
      // the app short of instances again because a holder died.
      await runAttempt({
        placementShare: { domainCount: 3, maxPerDomain: 1 },
        finalInstallingLocations: [
          { ip: '192.168.2.2:16127', broadcastedAt: 1000 },
          { ip: '192.168.1.1:16127', broadcastedAt: 2000 },
        ],
      });

      expect(globalStateStub.trySpawningGlobalAppCache.has('abc123')).to.be.false;
    });

    // an installing ERROR means an install was attempted and failed, and is
    // counted and acted on as such - a node standing aside attempted nothing,
    // and counting it would make the most contended apps look the most broken
    it('never reports a withdrawal as an install error', async () => {
      const installingErrorStub = sinon.stub().resolves(true);
      const { installStub } = await runAttempt({
        installingErrorStub,
        placementShare: { domainCount: 3, maxPerDomain: 1 },
        finalInstallingLocations: [
          { ip: '192.168.2.2:16127', broadcastedAt: 1000 },
          { ip: '192.168.1.1:16127', broadcastedAt: 2000 },
        ],
      });
      expect(installStub.called).to.be.false;
      expect(installingErrorStub.called, 'nothing was attempted, so nothing failed').to.be.false;
    });

    it('proceeds as the earliest claimant after the collision wait, keeping its claim', async () => {
      const { installStub, logged, withdrawalStub } = await runAttempt({
        placementShare: { domainCount: 3, maxPerDomain: 1 },
        finalInstallingLocations: [
          { ip: '192.168.1.1:16127', broadcastedAt: 1000 },
          { ip: '192.168.2.2:16127', broadcastedAt: 2000 },
        ],
      });
      expect(installStub.called).to.be.true;
      expect(logged('claim 1 of 1 remaining in fault domain')).to.be.true;
      const withdrawals = withdrawalStub.getCalls().filter((c) => c.args[0].withdrawn === true);
      expect(withdrawals, 'a node that proceeds keeps its claim').to.have.lengthOf(0);
    });

    it('keys the post-wait re-check from the same computation, not a fresh one', async () => {
      // the share and the domains it is measured against must come from one
      // view of the network, so the wait must not recompute either
      const { installStub } = await runAttempt({
        placementShare: { domainCount: 3, maxPerDomain: 1 },
        finalInstallingLocations: [{ ip: '192.168.1.1:16127', broadcastedAt: 1000 }],
      });
      expect(installStub.called).to.be.true;
      expect(placementFeasibilityStub.placementComputation.callCount).to.equal(1);
    });

    describe('same-millisecond claim ties', () => {
      // Every node sorts the timestamps carried inside the claims, so nodes
      // agree on who withdraws only if the order is total. A comparator that
      // returns 0 on equal broadcastedAt ranks tied claims by local arrival
      // order - different on every node - and two boundary nodes each
      // legitimately compute the winning rank. On a tie the lower socket
      // address survives, whatever order the claims arrived in.

      it('withdraws on a claim tie it loses on address, even when its own claim arrived first', async () => {
        // four tied claims, three slots; this node (192.168.1.1) is the
        // highest address, so it is claim #4 regardless of arrival order
        const { installStub, withdrawalStub, logged } = await runAttempt({
          finalInstallingLocations: [
            { ip: '192.168.1.1:16127', broadcastedAt: 1000 },
            { ip: '192.168.0.7:16127', broadcastedAt: 1000 },
            { ip: '192.168.0.8:16127', broadcastedAt: 1000 },
            { ip: '192.168.0.9:16127', broadcastedAt: 1000 },
          ],
        });
        expect(withdrawalStub.calledOnce).to.be.true;
        expect(installStub.called).to.be.false;
        // the decision log carries the ranked view, so a disputed outcome is
        // diagnosable from any one node's log
        expect(logged('192.168.0.7:16127@1000')).to.be.true;
      });

      it('keeps the slot on a claim tie it wins on address, even when its claim arrived last', async () => {
        const { installStub, withdrawalStub } = await runAttempt({
          placementShare: { domainCount: 1, maxPerDomain: 3 },
          finalInstallingLocations: [
            { ip: '192.168.2.2:16127', broadcastedAt: 1000 },
            { ip: '192.168.3.3:16127', broadcastedAt: 1000 },
            { ip: '192.168.4.4:16127', broadcastedAt: 1000 },
            { ip: '192.168.1.1:16127', broadcastedAt: 1000 },
          ],
        });
        expect(withdrawalStub.called).to.be.false;
        expect(installStub.called).to.be.true;
      });

      it('yields the domain share on a tie lost on address, even when its own claim arrived first', async () => {
        // two tied claimants in this /16, share of one; this node is the
        // higher address so the other claimant holds the share
        const { installStub, withdrawalStub } = await runAttempt({
          placementShare: { domainCount: 3, maxPerDomain: 1 },
          finalInstallingLocations: [
            { ip: '192.168.1.1:16127', broadcastedAt: 1000 },
            { ip: '192.168.0.5:16127', broadcastedAt: 1000 },
          ],
        });
        expect(installStub.called).to.be.false;
        const withdrawals = withdrawalStub.getCalls().filter((c) => c.args[0].withdrawn === true);
        expect(withdrawals).to.have.lengthOf(1);
        expect(withdrawals[0].args[0].version).to.equal(2);
      });

      it('keeps the domain share on a tie won on address, even when its claim arrived last', async () => {
        const { installStub, withdrawalStub } = await runAttempt({
          placementShare: { domainCount: 3, maxPerDomain: 1 },
          finalInstallingLocations: [
            { ip: '192.168.9.9:16127', broadcastedAt: 1000 },
            { ip: '192.168.1.1:16127', broadcastedAt: 1000 },
          ],
        });
        expect(installStub.called).to.be.true;
        expect(withdrawalStub.called).to.be.false;
      });

      it('removes the surplus instance in the post-install check on a runningSince tie, regardless of arrival order', async () => {
        // the +60s self-check ranks the running list the same way the claim
        // resolver ranks claims; on a tie the higher address is the junior
        // instance and stands aside
        const startedAt = '2026-08-02T10:00:00.000Z';
        const { installStub, removeStub, logged } = await runAttempt({
          resolveDelays: 2,
          finalInstallingLocations: [{ ip: '192.168.1.1:16127', broadcastedAt: 1000 }],
          finalAppLocations: [
            { ip: '192.168.1.1:16127', runningSince: startedAt },
            { ip: '192.168.0.7:16127', runningSince: startedAt },
            { ip: '192.168.0.8:16127', runningSince: startedAt },
            { ip: '192.168.0.9:16127', runningSince: startedAt },
          ],
        });
        expect(installStub.called).to.be.true;
        expect(logged('my instance is number 4')).to.be.true;
        expect(removeStub.calledOnce).to.be.true;
      });
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
