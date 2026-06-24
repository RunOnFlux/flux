const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appUninstaller tests', () => {
  let appUninstaller;
  let verificationHelperStub;
  let messageHelperStub;
  let logStub;
  let configStub;

  beforeEach(() => {
    configStub = {
      database: {
        url: 'mongodb://localhost:27017',
        daemon: {
          collections: { scannedHeight: 'scannedHeight', appsHashes: 'appsHashes' },
          database: 'daemon',
        },
        appslocal: {
          collections: { appsInformation: 'localAppsInformation' },
          database: 'localapps',
        },
        appsglobal: {
          collections: {
            appsMessages: 'appsMessages',
            appsInformation: 'globalAppsInformation',
            appsTemporaryMessages: 'appsTemporaryMessages',
            appsLocations: 'appsLocations',
          },
          database: 'globalapps',
        },
      },
      fluxapps: {
        manageDependencyOnlyLifecycle: true,
      },
    };

    verificationHelperStub = {
      verifyPrivilege: sinon.stub(),
    };

    messageHelperStub = {
      createErrorMessage: sinon.stub(),
      errUnauthorizedMessage: sinon.stub(),
      createSuccessMessage: sinon.stub().returns({ status: 'success' }),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    const dbHelperStub = {
      databaseConnection: sinon.stub(),
      findOneInDatabase: sinon.stub(),
      findInDatabase: sinon.stub(),
    };

    appUninstaller = proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
      config: configStub,
      '../verificationHelper': verificationHelperStub,
      '../messageHelper': messageHelperStub,
      '../serviceHelper': {
        ensureString: sinon.stub().returnsArg(0),
        ensureBoolean: sinon.stub().returnsArg(0),
      },
      '../dbHelper': dbHelperStub,
      '../dockerService': {
        appDockerStop: sinon.stub().resolves(),
        appDockerRemove: sinon.stub().resolves(),
        appDockerImageRemove: sinon.stub().resolves(),
        getAppIdentifier: sinon.stub().returns('testapp'),
      },
      '../../lib/log': logStub,
      '../utils/globalState': {
        installingApps: new Map(),
        hasRemovalInProgress: () => false,
        markRemovalInProgress: () => {},
        removalDone: () => {},
        removalInProgress: false,
      },
      '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
        config: configStub,
      }),
      './advancedWorkflows': {
        reindexGlobalAppsInformation: sinon.stub().resolves(),
        updateAppSpecsForRestoredNode: sinon.stub().resolves(),
        checkAndNotifyPeersOfRunningApps: sinon.stub().resolves(),
      },
      '../upnpService': {
        removeMapUpnpPort: sinon.stub().resolves(),
        isUPNP: sinon.stub().returns(false),
      },
      '../fluxNetworkHelper': {
        closeConnection: sinon.stub().resolves(),
        isFirewallActive: sinon.stub().resolves(false),
        allowPort: sinon.stub().resolves(true),
      },
      '../fluxCommunicationMessagesSender': {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      },
      '../appDatabase/registryManager': {
        availableApps: sinon.stub().resolves([]),
      },
      '../utils/enterpriseHelper': {
        checkAndDecryptAppSpecs: sinon.stub().returnsArg(0),
      },
      '../utils/appSpecHelpers': {
        specificationFormatter: sinon.stub().returnsArg(0),
      },
      '../appManagement/appInspector': {
        stopAppMonitoring: sinon.stub().resolves(),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('removeAppLocallyApi', () => {
    it('should reject unauthorized users', async () => {
      const req = {
        params: { appname: 'testapp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error' });

      await appUninstaller.removeAppLocallyApi(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.called).to.be.true;
    });

    it('should handle missing appname parameter', async () => {
      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({ status: 'error' });

      await appUninstaller.removeAppLocallyApi(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });

  describe('hardUninstallApplication tests', () => {
    it('should hard uninstall app, no ports passed', async () => {
      const appName = 'testapp';
      const appId = 1111;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
      };
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      await appUninstaller.hardUninstallApplication(appName, appId, appSpecifications, res);

      expect(res.write.called).to.be.true;
    });

    it('should hard uninstall app, ports passed', async () => {
      const appName = 'testapp';
      const appId = 2222;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
        port: 111,
      };
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      await appUninstaller.hardUninstallApplication(appName, appId, appSpecifications, res);

      expect(res.write.called).to.be.true;
    });
  });

  describe('softUninstallApplication tests', () => {
    it('should soft uninstall app, no ports passed', async () => {
      const appName = 'testapp';
      const appId = 1111;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
      };
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      await appUninstaller.softUninstallApplication(appName, appId, appSpecifications, res);

      expect(res.write.called).to.be.true;
    });

    it('should soft uninstall app, ports passed', async () => {
      const appName = 'testapp';
      const appId = 2222;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
        port: 111,
      };
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      await appUninstaller.softUninstallApplication(appName, appId, appSpecifications, res);

      expect(res.write.called).to.be.true;
    });
  });

  describe('removeAppLocally tests', () => {
    it('should throw error if app name is not specified', async () => {
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      await appUninstaller.removeAppLocally(undefined, res);

      expect(res.write.called).to.be.true;
      expect(res.end.called).to.be.true;
    });

    it('should handle app not found case', async () => {
      const appUninstallerWithDb = proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureBoolean: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
          findOneInDatabase: sinon.stub().resolves(undefined),
          findInDatabase: sinon.stub().resolves([]),
          removeDocumentFromDatabase: sinon.stub().resolves(),
        },
        '../dockerService': {
          appDockerStop: sinon.stub().resolves(),
          appDockerRemove: sinon.stub().resolves(),
          appDockerImageRemove: sinon.stub().resolves(),
          getAppIdentifier: sinon.stub().returns('testapp'),
        },
        '../../lib/log': logStub,
        '../utils/globalState': {
        installingApps: new Map(),
        hasRemovalInProgress: () => false,
        markRemovalInProgress: () => {},
        removalDone: () => {},
        removalInProgress: false,
      },
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
          config: configStub,
        }),
        './advancedWorkflows': {
          reindexGlobalAppsInformation: sinon.stub().resolves(),
          updateAppSpecsForRestoredNode: sinon.stub().resolves(),
          checkAndNotifyPeersOfRunningApps: sinon.stub().resolves(),
        },
        '../upnpService': {
          removeMapUpnpPort: sinon.stub().resolves(),
        },
        '../fluxNetworkHelper': {
          closeConnection: sinon.stub().resolves(),
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves(true),
        },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../utils/enterpriseHelper': {
          checkAndDecryptAppSpecs: sinon.stub().returnsArg(0),
        },
        '../utils/appSpecHelpers': {
          specificationFormatter: sinon.stub().returnsArg(0),
        },
        '../appManagement/appInspector': {
          stopAppMonitoring: sinon.stub().resolves(),
        },
      });

      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };
      const appName = 'FoldingAtHomeB';
      const force = true;

      await appUninstallerWithDb.removeAppLocally(appName, res, force);

      expect(res.write.called).to.be.true;
      expect(res.end.called).to.be.true;
    });

    it('should remove app locally if app name is specified and app in DB', async () => {
      const appUninstallerWithDbApp = proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureBoolean: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
          findOneInDatabase: sinon.stub().resolves({
            version: 2,
            name: 'testapp',
            description: 'testapp',
            repotag: 'yurinnick/testapp',
            owner: '1K6nyw2VjV6jEN1f1CkbKn9htWnYkQabbR',
            tiered: true,
            ports: [30000],
            containerPorts: [7396],
            domains: [''],
            cpu: 0.5,
            ram: 500,
            hdd: 5,
          }),
          findInDatabase: sinon.stub(),
        },
        '../dockerService': {
          appDockerStop: sinon.stub().resolves(),
          appDockerRemove: sinon.stub().resolves(),
          getAppIdentifier: sinon.stub().returns('testapp'),
        },
        '../../lib/log': logStub,
        '../utils/globalState': {
        installingApps: new Map(),
        hasRemovalInProgress: () => false,
        markRemovalInProgress: () => {},
        removalDone: () => {},
          removalInProgress: false,
        },
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
          config: configStub,
        }),
        './advancedWorkflows': {
          reindexGlobalAppsInformation: sinon.stub().resolves(),
          updateAppSpecsForRestoredNode: sinon.stub().resolves(),
          checkAndNotifyPeersOfRunningApps: sinon.stub().resolves(),
        },
        '../upnpService': {
          removeMapUpnpPort: sinon.stub().resolves(),
        },
        '../fluxNetworkHelper': {
          closeConnection: sinon.stub().resolves(),
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves(true),
        },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../utils/enterpriseHelper': {
          checkAndDecryptAppSpecs: sinon.stub().returnsArg(0),
        },
        '../utils/appSpecHelpers': {
          specificationFormatter: sinon.stub().returnsArg(0),
        },
        '../appManagement/appInspector': {
          stopAppMonitoring: sinon.stub().resolves(),
        },
      });

      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };
      const appName = 'testapp';
      const force = true;

      await appUninstallerWithDbApp.removeAppLocally(appName, res, force);

      expect(res.write.called).to.be.true;
      expect(res.end.called).to.be.true;
    });
  });

  describe('dependency cascade gating (predicates)', () => {
    it('shouldReverseCascade: graceful or cancel cascades, a plain force-kill does not', () => {
      expect(appUninstaller.shouldReverseCascade(false, false)).to.equal(true); // graceful removal
      expect(appUninstaller.shouldReverseCascade(false, true)).to.equal(true); // graceful + cancel
      expect(appUninstaller.shouldReverseCascade(true, true)).to.equal(true); // cancel/expiry (the fix)
      expect(appUninstaller.shouldReverseCascade(true, false)).to.equal(false); // plain force-kill
    });

    it('shouldSweepUnrequiredDependencies: workloads always, a dependency only when the reverse cascade ran, never a component', () => {
      const dep = 'collector. dependencyOnly=true';
      const workload = 'a normal workload';
      // a component never carries the marker
      expect(appUninstaller.shouldSweepUnrequiredDependencies(true, dep, false, false)).to.equal(false);
      // a workload removal always sweeps (any force/cancel combo)
      expect(appUninstaller.shouldSweepUnrequiredDependencies(false, workload, true, false)).to.equal(true);
      expect(appUninstaller.shouldSweepUnrequiredDependencies(false, workload, false, false)).to.equal(true);
      // a dependencyOnly app sweeps siblings only when the reverse cascade ran
      expect(appUninstaller.shouldSweepUnrequiredDependencies(false, dep, false, false)).to.equal(true); // graceful
      expect(appUninstaller.shouldSweepUnrequiredDependencies(false, dep, true, true)).to.equal(true); // cancel (the fix)
      expect(appUninstaller.shouldSweepUnrequiredDependencies(false, dep, true, false)).to.equal(false); // plain force-kill of a collector
    });
  });

  describe('reverse cascade wiring on cancel vs force', () => {
    // Build appUninstaller with a controllable appNetworkLinker so we can assert
    // whether the reverse cascade actually runs (findInstalledWorkloadsRequiring is
    // the first action inside removeRequiringWorkloadsFirst) for a given
    // (force, cancelGraceful). The target app is presented as dependencyOnly.
    function buildUninstaller(lifecycleFlag = true) {
      const cfg = { ...configStub, fluxapps: { manageDependencyOnlyLifecycle: lifecycleFlag } };
      const appNetworkLinkerStub = {
        parseDependencyOnly: sinon.stub().returns(true),
        findInstalledWorkloadsRequiring: sinon.stub().resolves([]),
        findUnrequiredInstalledDependencies: sinon.stub().resolves([]),
        getLinkedApps: sinon.stub().returns([]),
      };
      const collectorSpec = {
        version: 2,
        name: 'colla',
        description: 'collA collector. dependencyOnly=true',
        repotag: 'traefik/whoami',
        owner: '1ownerAddressForTestingPurposesXYZ',
        ports: [],
        containerPorts: [],
        domains: [''],
        cpu: 0.1,
        ram: 100,
        hdd: 1,
      };
      const dbHelperStub = {
        databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
        findOneInDatabase: sinon.stub().resolves(collectorSpec),
        findInDatabase: sinon.stub().resolves([]),
        removeDocumentFromDatabase: sinon.stub().resolves(),
        updateOneInDatabase: sinon.stub().resolves(),
      };
      const mod = proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        config: cfg,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../serviceHelper': { ensureString: sinon.stub().returnsArg(0), ensureBoolean: sinon.stub().returnsArg(0), delay: sinon.stub().resolves() },
        '../dbHelper': dbHelperStub,
        './appNetworkLinker': appNetworkLinkerStub,
        '../dockerService': {
          appDockerStop: sinon.stub().resolves(),
          appDockerKill: sinon.stub().resolves(),
          appDockerStopGracefulOrKill: sinon.stub().resolves(),
          appDockerRemove: sinon.stub().resolves(),
          appDockerImageRemove: sinon.stub().resolves(),
          getAppIdentifier: sinon.stub().returns('colla'),
          getBaseAppName: sinon.stub().returnsArg(0),
        },
        '../../lib/log': logStub,
        '../utils/globalState': {
        installingApps: new Map(),
        hasRemovalInProgress: () => false,
        markRemovalInProgress: () => {},
        removalDone: () => {}, removalInProgress: false, installationInProgress: false },
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', { config: cfg }),
        './advancedWorkflows': { reindexGlobalAppsInformation: sinon.stub().resolves(), updateAppSpecsForRestoredNode: sinon.stub().resolves(), checkAndNotifyPeersOfRunningApps: sinon.stub().resolves() },
        '../upnpService': { removeMapUpnpPort: sinon.stub().resolves(), isUPNP: sinon.stub().returns(false) },
        '../fluxNetworkHelper': { closeConnection: sinon.stub().resolves(), isFirewallActive: sinon.stub().resolves(false), allowPort: sinon.stub().resolves(true), deleteAllowPortRule: sinon.stub().resolves() },
        '../fluxCommunicationMessagesSender': { broadcastMessageToOutgoing: sinon.stub().resolves(), broadcastMessageToIncoming: sinon.stub().resolves() },
        '../appDatabase/registryManager': { availableApps: sinon.stub().resolves([]) },
        '../utils/enterpriseHelper': { checkAndDecryptAppSpecs: sinon.stub().returnsArg(0) },
        '../utils/appSpecHelpers': { specificationFormatter: sinon.stub().returnsArg(0) },
        '../appManagement/appInspector': { stopAppMonitoring: sinon.stub().resolves() },
        './pendingTeardownStore': {
          writeTeardown: sinon.stub().resolves(),
          clearTeardown: sinon.stub().resolves(),
          bumpAttempts: sinon.stub().resolves(),
          readAllTeardowns: sinon.stub().resolves([]),
          prepareCollection: sinon.stub().resolves(),
        },
      });
      return { mod, appNetworkLinkerStub };
    }

    const mkRes = () => ({ write: sinon.stub(), end: sinon.stub() });

    it('fires the reverse cascade when a dependency is cancelled (force=true, cancelGraceful=true)', async () => {
      const { mod, appNetworkLinkerStub } = buildUninstaller();
      await mod.removeAppLocally('colla', mkRes(), true, false, true, true);
      expect(appNetworkLinkerStub.findInstalledWorkloadsRequiring.calledWith('colla')).to.equal(true);
    });

    it('skips the reverse cascade on a plain force-kill (force=true, cancelGraceful=false)', async () => {
      const { mod, appNetworkLinkerStub } = buildUninstaller();
      await mod.removeAppLocally('colla', mkRes(), true, false, true, false);
      expect(appNetworkLinkerStub.findInstalledWorkloadsRequiring.called).to.equal(false);
    });

    it('still fires the reverse cascade on a graceful (force=false) removal', async () => {
      const { mod, appNetworkLinkerStub } = buildUninstaller();
      await mod.removeAppLocally('colla', mkRes(), false, false, true);
      expect(appNetworkLinkerStub.findInstalledWorkloadsRequiring.calledWith('colla')).to.equal(true);
    });

    it('does not fire the reverse cascade when the lifecycle flag is off', async () => {
      const { mod, appNetworkLinkerStub } = buildUninstaller(false);
      await mod.removeAppLocally('colla', mkRes(), true, false, true, true);
      expect(appNetworkLinkerStub.findInstalledWorkloadsRequiring.called).to.equal(false);
    });
  });

  describe('component-removed seam (controller-state cleanup)', () => {
    // Contract: when a component is removed locally, ALL its node-local controller
    // state dies with it - the durable runtime state (appsRuntimeState.remove,
    // already wired) AND the reconciler's in-memory controllerDesired verdict.
    // The verdict clear flows through a callback seam (setOnComponentRemoved,
    // wired in serviceManager) because appReconciler already requires
    // appUninstaller - a back-require would capture a stale partial export.
    // The seam fires over exactly the identifier list the uninstaller computes:
    // after successful teardown only (failed removals clear nothing), on forced
    // and unforced paths alike.
    let runtimeStateStub;

    function buildUninstaller(spec) {
      runtimeStateStub = {
        remove: sinon.stub().resolves(),
        setCondemned: sinon.stub().resolves(),
        isCondemned: sinon.stub().resolves(false),
      };
      return proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureBoolean: sinon.stub().returnsArg(0),
          ensureNumber: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
          findOneInDatabase: sinon.stub().resolves(spec),
          findInDatabase: sinon.stub().resolves([]),
          findOneAndDeleteInDatabase: sinon.stub().resolves(),
        },
        '../dockerService': {
          appDockerKill: sinon.stub().resolves(),
          appDockerStop: sinon.stub().resolves(),
          appDockerRemove: sinon.stub().resolves(),
          appDockerForceRemove: sinon.stub().resolves(),
          appDockerImageRemove: sinon.stub().resolves(),
          getAppIdentifier: sinon.stub().callsFake((id) => `flux${id}`),
          getBaseAppName: sinon.stub().callsFake((id) => id),
          removeFluxAppDockerNetwork: sinon.stub().resolves(),
          forceRemoveFluxAppDockerNetwork: sinon.stub().resolves(),
        },
        '../../lib/log': logStub,
        '../utils/globalState': {
        installingApps: new Map(),
        hasRemovalInProgress: () => false,
        markRemovalInProgress: () => {},
        removalDone: () => {},
          removalInProgress: false,
          runningAppsCache: new Map(),
        },
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
          config: configStub,
        }),
        './advancedWorkflows': {
          reindexGlobalAppsInformation: sinon.stub().resolves(),
          updateAppSpecsForRestoredNode: sinon.stub().resolves(),
          checkAndNotifyPeersOfRunningApps: sinon.stub().resolves(),
          stopSyncthingApp: sinon.stub().resolves(),
        },
        '../upnpService': {
          removeMapUpnpPort: sinon.stub().resolves(),
          isUPNP: sinon.stub().returns(false),
        },
        '../fluxNetworkHelper': {
          closeConnection: sinon.stub().resolves(),
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves(true),
          deleteAllowPortRule: sinon.stub().resolves(true),
          getLocalSocketAddress: sinon.stub().resolves(null),
        },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
          broadcastMessageToAll: sinon.stub().resolves(),
        },
        '../appDatabase/registryManager': {
          availableApps: sinon.stub().resolves([]),
        },
        '../utils/enterpriseHelper': {
          checkAndDecryptAppSpecs: sinon.stub().returnsArg(0),
        },
        '../utils/appSpecHelpers': {
          specificationFormatter: sinon.stub().returnsArg(0),
        },
        '../appManagement/appInspector': {
          stopAppMonitoring: sinon.stub().resolves(),
        },
        '../appManagement/appsRuntimeState': runtimeStateStub,
        './pendingTeardownStore': {
          writeTeardown: sinon.stub().resolves(),
          clearTeardown: sinon.stub().resolves(),
          bumpAttempts: sinon.stub().resolves(),
          readAllTeardowns: sinon.stub().resolves([]),
          prepareCollection: sinon.stub().resolves(),
        },
        'node-cmd': { run: sinon.stub().callsFake((cmd, cb) => cb(null, '', '')) },
      });
    }

    const v2Spec = {
      version: 2,
      name: 'testapp',
      repotag: 'test/app',
      ports: [30000],
      containerPorts: [7396],
      domains: [''],
      cpu: 0.5,
      ram: 500,
      hdd: 5,
    };

    const composedSpec = {
      version: 6,
      name: 'testapp',
      compose: [
        {
          name: 'comp1', repotag: 'test/one', ports: [30001], containerPorts: [3001], domains: [''], cpu: 0.5, ram: 500, hdd: 5,
        },
        {
          name: 'comp2', repotag: 'test/two', ports: [30002], containerPorts: [3002], domains: [''], cpu: 0.5, ram: 500, hdd: 5,
        },
      ],
    };

    const res = null; // exercised without a response stream

    it('notifies the seam with the bare name for a v1-3 app', async () => {
      const uninstaller = buildUninstaller(v2Spec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.removeAppLocally('testapp', res, true);

      sinon.assert.calledOnceWithExactly(onRemoved, 'testapp');
    });

    it('notifies the seam once per component for a whole composed app', async () => {
      const uninstaller = buildUninstaller(composedSpec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.removeAppLocally('testapp', res, true);

      sinon.assert.calledTwice(onRemoved);
      sinon.assert.calledWithExactly(onRemoved, 'comp1_testapp');
      sinon.assert.calledWithExactly(onRemoved, 'comp2_testapp');
    });

    it('scopes the seam to the one component on a component-scoped removal', async () => {
      const uninstaller = buildUninstaller(composedSpec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.removeAppLocally('comp1_testapp', res, true);

      sinon.assert.calledOnceWithExactly(onRemoved, 'comp1_testapp');
    });

    it('pairs the seam with the durable runtime-state clear (same identifiers)', async () => {
      const uninstaller = buildUninstaller(composedSpec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.removeAppLocally('testapp', res, true);

      expect(runtimeStateStub.remove.args.map((a) => a[0])).to.deep.equal(onRemoved.args.map((a) => a[0]));
    });

    it('dropControllerStateForRedeploy clears runtime state + fires the seam per identifier (redeploy clears the lock)', async () => {
      // user decision: a redeploy of any kind (soft or hard) is an explicit operator
      // "make it run" - the operator lock (and the stale controller verdict) must not
      // survive it. The soft path (advancedWorkflows.softRemoveAppLocally) and the hard
      // path both route the per-component clear through this helper.
      const uninstaller = buildUninstaller(composedSpec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.dropControllerStateForRedeploy(['comp1_testapp', 'comp2_testapp']);

      expect(runtimeStateStub.remove.args.map((a) => a[0])).to.have.members(['comp1_testapp', 'comp2_testapp']);
      expect(onRemoved.args.map((a) => a[0])).to.have.members(['comp1_testapp', 'comp2_testapp']);
    });

    it('completes removal when no seam callback is registered', async () => {
      const uninstaller = buildUninstaller(v2Spec);

      await uninstaller.removeAppLocally('testapp', res, true);

      sinon.assert.calledOnceWithExactly(runtimeStateStub.remove, 'testapp');
      sinon.assert.notCalled(logStub.error);
    });
  });

  describe('reshape: durable teardown doc, condemned stamp + finish ordering', () => {
    // Locks the load-bearing invariants of the removal reshape (the spine):
    //  - the durable pendingAppTeardowns doc is written BEFORE the local row is deleted
    //  - every component is condemned in the prelude
    //  - the finish drops the condemned stamp (appsRuntimeState.remove) BEFORE clearing
    //    the durable doc, and clears the doc ONLY when no stamp survives (the doc is the
    //    backstop for a swallowed remove failure)
    //  - boot recovery re-stamps + replays a row-absent teardown but DROPS a doc whose
    //    whole-app row is back (re-installed / removal aborted) without tearing it down
    let runtimeStateStub;
    let pendingStoreStub;
    let dbHelperStub;
    let dockerStub;
    let fluxNetworkHelperStub; // captured so a test can flip the firewall on + assert port edits
    let removalsSet; // backs the per-app removal gate so tests can pre-seed an in-flight removal

    const v2Spec = {
      version: 2,
      name: 'redapp',
      description: 'redapp',
      repotag: 'test/redapp',
      ports: [30000],
      domains: [''],
      cpu: 0.5,
      ram: 500,
      hdd: 5,
    };

    function buildUninstaller({ rowForName } = {}) {
      removalsSet = new Set();
      runtimeStateStub = {
        remove: sinon.stub().resolves(true), // confirmed drop by default
        setCondemned: sinon.stub().resolves(),
        isCondemned: sinon.stub().resolves(false),
      };
      pendingStoreStub = {
        writeTeardown: sinon.stub().resolves(),
        clearTeardown: sinon.stub().resolves(),
        bumpAttempts: sinon.stub().resolves(),
        readAllTeardowns: sinon.stub().resolves([]),
        prepareCollection: sinon.stub().resolves(),
      };
      dbHelperStub = {
        databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
        // default: local row found (so removeAppLocally proceeds); boot-recovery tests
        // override via rowForName to model an installed-again app
        findOneInDatabase: sinon.stub().callsFake(async (_db, _coll, query) => {
          if (rowForName) return rowForName(query && query.name);
          return v2Spec;
        }),
        findInDatabase: sinon.stub().resolves([]),
        findOneAndDeleteInDatabase: sinon.stub().resolves(),
      };
      dockerStub = {
        appDockerStop: sinon.stub().resolves(),
        appDockerKill: sinon.stub().resolves(),
        appDockerStopGracefulOrKill: sinon.stub().resolves(),
        appDockerRemove: sinon.stub().resolves(),
        appDockerForceRemove: sinon.stub().resolves(),
        appDockerImageRemove: sinon.stub().resolves(),
        getAppIdentifier: sinon.stub().callsFake((id) => `flux${id}`),
        getBaseAppName: sinon.stub().callsFake((id) => id),
        removeFluxAppDockerNetwork: sinon.stub().resolves(),
        forceRemoveFluxAppDockerNetwork: sinon.stub().resolves(),
      };
      return proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureBoolean: sinon.stub().returnsArg(0),
          ensureNumber: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../dbHelper': dbHelperStub,
        '../dockerService': dockerStub,
        '../../lib/log': logStub,
        '../utils/globalState': {
          installingApps: new Map(),
          hasRemovalInProgress: (n) => removalsSet.has(n),
          markRemovalInProgress: (n) => removalsSet.add(n),
          removalDone: (n) => removalsSet.delete(n),
          get removalInProgress() { return removalsSet.size > 0; },
          installationInProgress: false,
          runningAppsCache: new Map(),
        },
        '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', { config: configStub }),
        './advancedWorkflows': { stopSyncthingApp: sinon.stub().resolves() },
        '../upnpService': { removeMapUpnpPort: sinon.stub().resolves(), isUPNP: sinon.stub().returns(false) },
        '../fluxNetworkHelper': fluxNetworkHelperStub = {
          isFirewallActive: sinon.stub().resolves(false),
          deleteAllowPortRule: sinon.stub().resolves(true),
          getLocalSocketAddress: sinon.stub().resolves(null),
        },
        '../fluxCommunicationMessagesSender': { broadcastMessageToAll: sinon.stub().resolves() },
        '../appDatabase/registryManager': { availableApps: sinon.stub().resolves([]) },
        '../utils/enterpriseHelper': { checkAndDecryptAppSpecs: sinon.stub().returnsArg(0) },
        '../utils/appSpecHelpers': { specificationFormatter: sinon.stub().returnsArg(0) },
        '../appManagement/appInspector': { stopAppMonitoring: sinon.stub() },
        '../appManagement/appsRuntimeState': runtimeStateStub,
        './pendingTeardownStore': pendingStoreStub,
        'node-cmd': { run: sinon.stub().callsFake((cmd, cb) => cb(null, '', '')) },
      });
    }

    it('writes the durable teardown doc BEFORE deleting the local app row', async () => {
      const uninstaller = buildUninstaller();
      await uninstaller.removeAppLocally('redapp', null, true);
      expect(pendingStoreStub.writeTeardown.calledBefore(dbHelperStub.findOneAndDeleteInDatabase)).to.equal(true);
      const doc = pendingStoreStub.writeTeardown.firstCall.args[0];
      expect(doc.key).to.equal('redapp');
      expect(doc.components.map((c) => c.identifier)).to.deep.equal(['redapp']);
      // teardown inputs are cleartext; no enterprise blob / repoauth
      expect(doc.components[0]).to.not.have.property('enterprise');
      expect(doc.components[0]).to.not.have.property('repoauth');
    });

    it('condemns the component in the prelude', async () => {
      const uninstaller = buildUninstaller();
      await uninstaller.removeAppLocally('redapp', null, true);
      sinon.assert.calledWith(runtimeStateStub.setCondemned, 'redapp', true);
    });

    it('per-app gate: a non-force removal bails if the SAME app is already being removed', async () => {
      const uninstaller = buildUninstaller();
      removalsSet.add('redapp'); // redapp's removal already in flight
      const res = { write: sinon.stub(), end: sinon.stub() };
      await uninstaller.removeAppLocally('redapp', res, false); // non-force
      // gate bailed before the prelude — no durable doc, no condemn, no teardown
      expect(pendingStoreStub.writeTeardown.called).to.equal(false);
      expect(runtimeStateStub.setCondemned.called).to.equal(false);
    });

    it('per-app gate: a removal of a DIFFERENT app proceeds while another is in flight', async () => {
      const uninstaller = buildUninstaller();
      removalsSet.add('someotherapp'); // a different app is being removed
      await uninstaller.removeAppLocally('redapp', null, false); // non-force, different app
      // not blocked — redapp's prelude runs (durable doc written, component condemned)
      expect(pendingStoreStub.writeTeardown.calledWithMatch({ key: 'redapp' })).to.equal(true);
      sinon.assert.calledWith(runtimeStateStub.setCondemned, 'redapp', true);
    });

    it('redeploy keepNetwork: does NOT tear down the app docker network', async () => {
      const uninstaller = buildUninstaller();
      // a hard redeploy passes opts.keepNetwork=true (8th arg)
      await uninstaller.removeAppLocally('redapp', null, false, true, false, false, false, { keepNetwork: true });
      sinon.assert.notCalled(dockerStub.removeFluxAppDockerNetwork);
      sinon.assert.notCalled(dockerStub.forceRemoveFluxAppDockerNetwork);
      // and the durable doc records keepNetwork so a crashed-mid-redeploy boot recovery keeps it too
      expect(pendingStoreStub.writeTeardown.calledWithMatch({ key: 'redapp', keepNetwork: true })).to.equal(true);
    });

    it('a normal removal DOES tear down the app docker network (keepNetwork defaults false)', async () => {
      const uninstaller = buildUninstaller();
      await uninstaller.removeAppLocally('redapp', null, true); // force, no opts
      sinon.assert.calledWith(dockerStub.forceRemoveFluxAppDockerNetwork, 'redapp');
      expect(pendingStoreStub.writeTeardown.calledWithMatch({ key: 'redapp', keepNetwork: false })).to.equal(true);
    });

    it('redeploy skipPorts: the teardown does NOT close the app ports (the redeploy reconciles the delta)', async () => {
      const uninstaller = buildUninstaller();
      fluxNetworkHelperStub.isFirewallActive.resolves(true); // so cleanupPorts WOULD edit ufw
      await uninstaller.removeAppLocally('redapp', null, false, true, false, false, false, { skipPorts: true });
      sinon.assert.notCalled(fluxNetworkHelperStub.deleteAllowPortRule);
    });

    it('a normal removal DOES close the app ports (skipPorts defaults false)', async () => {
      const uninstaller = buildUninstaller();
      fluxNetworkHelperStub.isFirewallActive.resolves(true);
      await uninstaller.removeAppLocally('redapp', null, true); // force, no opts
      sinon.assert.called(fluxNetworkHelperStub.deleteAllowPortRule);
    });

    it('drops the condemned stamp BEFORE clearing the durable doc, and clears it when no stamp survives', async () => {
      const uninstaller = buildUninstaller();
      await uninstaller.removeAppLocally('redapp', null, true);
      expect(runtimeStateStub.remove.calledWith('redapp')).to.equal(true);
      expect(pendingStoreStub.clearTeardown.calledWith('redapp')).to.equal(true);
      expect(runtimeStateStub.remove.calledBefore(pendingStoreStub.clearTeardown)).to.equal(true);
    });

    it('keeps the durable doc when a condemned stamp fails to drop (backstop for recovery)', async () => {
      const uninstaller = buildUninstaller();
      runtimeStateStub.remove.resolves(false); // remove swallowed a DB error — stamp may survive
      await uninstaller.removeAppLocally('redapp', null, true);
      expect(pendingStoreStub.clearTeardown.called).to.equal(false);
    });

    it('boot recovery re-stamps + returns a row-absent teardown, drops a row-present one', async () => {
      const docAbsent = {
        key: 'goneapp', name: 'goneapp', isComponent: false, components: [{ identifier: 'goneapp', appId: 'fluxgoneapp', componentName: 'goneapp', label: 'goneapp', ports: [1], repotag: 'r' }],
      };
      const docPresent = {
        key: 'liveapp', name: 'liveapp', isComponent: false, components: [{ identifier: 'liveapp', appId: 'fluxliveapp', componentName: 'liveapp', label: 'liveapp', ports: [2], repotag: 'r' }],
      };
      const uninstaller = buildUninstaller({ rowForName: (name) => (name === 'liveapp' ? { name } : null) });
      pendingStoreStub.readAllTeardowns.resolves([docAbsent, docPresent]);

      const owed = await uninstaller.stampCondemnedForPendingTeardowns();

      expect(owed.map((d) => d.key)).to.deep.equal(['goneapp']);
      sinon.assert.calledWith(runtimeStateStub.setCondemned, 'goneapp', true);
      // the row-present (re-installed) app is un-condemned, never re-condemned
      expect(runtimeStateStub.setCondemned.calledWith('liveapp', true)).to.equal(false);
      sinon.assert.calledWith(runtimeStateStub.setCondemned, 'liveapp', false);
      expect(pendingStoreStub.clearTeardown.calledWith('liveapp')).to.equal(true);
    });

    it('boot recovery defers (does not tear down or drop) a doc whose row read fails', async () => {
      const doc = {
        key: 'blipapp', name: 'blipapp', isComponent: false, components: [{ identifier: 'blipapp', appId: 'fluxblipapp', componentName: 'blipapp', label: 'blipapp', ports: [1], repotag: 'r' }],
      };
      const uninstaller = buildUninstaller({ rowForName: () => { throw new Error('db blip'); } });
      pendingStoreStub.readAllTeardowns.resolves([doc]);

      const owed = await uninstaller.stampCondemnedForPendingTeardowns();

      // unknown row state: leave the doc untouched for a clean retry, never force-tear-down
      expect(owed).to.deep.equal([]);
      expect(runtimeStateStub.setCondemned.called).to.equal(false);
      expect(pendingStoreStub.clearTeardown.called).to.equal(false);
    });

    it('boot recovery replays a teardown to completion even when the container is already gone', async () => {
      const uninstaller = buildUninstaller();
      // every drain/remove call throws as if the container is absent
      const gone = new Error("Cannot read properties of undefined (reading 'Id')");
      dockerStub.appDockerKill.rejects(gone);
      dockerStub.appDockerForceRemove.rejects(gone);
      const doc = {
        key: 'goneapp', name: 'goneapp', isComponent: false, components: [{ identifier: 'goneapp', appId: 'fluxgoneapp', componentName: 'goneapp', label: 'goneapp', ports: [1], repotag: 'r' }],
      };

      await uninstaller.resumePendingTeardowns([doc]);

      expect(runtimeStateStub.remove.calledWith('goneapp')).to.equal(true);
      expect(pendingStoreStub.clearTeardown.calledWith('goneapp')).to.equal(true);
      // the image must STILL be reclaimed even though the container was already
      // gone (force-remove threw) - it is not gated on a successful container removal
      expect(dockerStub.appDockerImageRemove.calledWith('r')).to.equal(true);
    });
  });

  describe('exported functions', () => {
    it('should export all required functions', () => {
      expect(appUninstaller.hardUninstallComponent).to.be.a('function');
      expect(appUninstaller.hardUninstallApplication).to.be.a('function');
      expect(appUninstaller.softUninstallComponent).to.be.a('function');
      expect(appUninstaller.softUninstallApplication).to.be.a('function');
      expect(appUninstaller.removeAppLocally).to.be.a('function');
      expect(appUninstaller.dropControllerStateForRedeploy).to.be.a('function');
      expect(appUninstaller.removeAppLocallyApi).to.be.a('function');
    });
  });
});
