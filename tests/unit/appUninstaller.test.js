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
        removalInProgress: false,
        setRemovalInProgress: sinon.stub(),
        resetRemovalInProgress: sinon.stub(),
        getRemovalInProgress: sinon.stub().returns(false),
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
          removalInProgress: false,
          setRemovalInProgress: sinon.stub(),
          resetRemovalInProgress: sinon.stub(),
          getRemovalInProgress: sinon.stub().returns(false),
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
      runtimeStateStub = { remove: sinon.stub().resolves() };
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

    it('clears runtime state and fires the seam on SOFT removal too (redeploy clears the lock)', async () => {
      // user decision: a redeploy of any kind is an explicit "make it run" - the
      // operator lock (and the stale controller verdict) must not survive it
      const uninstaller = buildUninstaller(composedSpec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.softRemoveAppLocally('testapp', null, { removalInProgress: false, installationInProgress: false }, sinon.stub());

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

  describe('softRemoveAppLocally tests', () => {
    it('should throw error if app name is not specified', async () => {
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };
      const globalStateRef = {
        removalInProgress: false,
        installationInProgress: false,
      };
      const stopAppMonitoring = sinon.stub();

      try {
        await appUninstaller.softRemoveAppLocally(undefined, res, globalStateRef, stopAppMonitoring);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('No Flux App specified');
      }
    });

    it('should return error if no app in db', async () => {
      const mockDb = {
        db: sinon.stub().returns('appsDatabase'),
      };
      const appUninstallerNoApp = proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureBoolean: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub().returns(mockDb),
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
          removalInProgress: false,
          setRemovalInProgress: sinon.stub(),
          resetRemovalInProgress: sinon.stub(),
          getRemovalInProgress: sinon.stub().returns(false),
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

      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };
      const appName = 'testapp';
      const globalStateRef = {
        removalInProgress: false,
        installationInProgress: false,
      };
      const stopAppMonitoring = sinon.stub();

      try {
        await appUninstallerNoApp.softRemoveAppLocally(appName, res, globalStateRef, stopAppMonitoring);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Flux App not found');
      }
    });

    it('should soft remove app locally if app name is specified and app in DB', async () => {
      const mockDb = {
        db: sinon.stub().returns('appsDatabase'),
      };
      const appUninstallerWithApp = proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureBoolean: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub().returns(mockDb),
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
          findOneAndDeleteInDatabase: sinon.stub().resolves(),
        },
        '../dockerService': {
          appDockerStop: sinon.stub().resolves(),
          appDockerRemove: sinon.stub().resolves(),
          appDockerImageRemove: sinon.stub().resolves(),
          getAppIdentifier: sinon.stub().returns(100),
        },
        '../../lib/log': logStub,
        '../utils/globalState': {
          removalInProgress: false,
          setRemovalInProgress: sinon.stub(),
          resetRemovalInProgress: sinon.stub(),
          getRemovalInProgress: sinon.stub().returns(false),
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

      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };
      const appName = 'testapp';
      const globalStateRef = {
        removalInProgress: false,
        installationInProgress: false,
      };
      const stopAppMonitoring = sinon.stub();

      await appUninstallerWithApp.softRemoveAppLocally(appName, res, globalStateRef, stopAppMonitoring);

      expect(res.write.called).to.be.true;
    });
  });

  describe('exported functions', () => {
    it('should export all required functions', () => {
      expect(appUninstaller.hardUninstallComponent).to.be.a('function');
      expect(appUninstaller.hardUninstallApplication).to.be.a('function');
      expect(appUninstaller.softUninstallComponent).to.be.a('function');
      expect(appUninstaller.softUninstallApplication).to.be.a('function');
      expect(appUninstaller.removeAppLocally).to.be.a('function');
      expect(appUninstaller.softRemoveAppLocally).to.be.a('function');
      expect(appUninstaller.removeAppLocallyApi).to.be.a('function');
    });
  });
});
