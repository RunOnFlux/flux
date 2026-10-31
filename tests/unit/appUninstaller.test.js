const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
const { RemovalOutcome } = require('../../ZelBack/src/services/utils/removalOutcome');
const { folderStates: folderStateMap } = require('../../ZelBack/src/services/utils/globalState');

describe('appUninstaller tests', () => {
  // The placement record is its own module with its own tests; here it is the
  // seam a removal writes through. Fresh per test.
  let appPlacementsStub;
  beforeEach(() => {
    appPlacementsStub = { removePlacement: sinon.stub().resolves() };
  });

  describe('cleanupPorts tests', () => {
    let appUninstallerPorts;
    let firewallStub;
    let upnpStub;

    beforeEach(() => {
      firewallStub = {
        isFirewallActive: sinon.stub().resolves(true),
        deleteAppPortRules: sinon.stub().resolves({ failed: [], locked: false }),
      };
      upnpStub = { isUPNP: sinon.stub().returns(true), removeMapUpnpPort: sinon.stub().resolves(true) };
      appUninstallerPorts = proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        '../appManagement/appPlacements': appPlacementsStub,
        '../fluxNetworkHelper': firewallStub,
        '../upnpService': upnpStub,
        '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('removes app port mappings from the router and the ports\' rules from the host firewall, an earlier FluxOS\'s included', async () => {
      await appUninstallerPorts.cleanupPorts({ ports: [31000, 31001] }, 'myapp', null, 'myapp');

      expect(firewallStub.deleteAppPortRules.args).to.deep.equal([[[31000, 31001]]]);
      expect(upnpStub.removeMapUpnpPort.calledWith(31000, 'Flux_App_myapp')).to.be.true;
      expect(upnpStub.removeMapUpnpPort.calledWith(31001, 'Flux_App_myapp')).to.be.true;
    });

    it('removes a v1 app port mapping and the port\'s rules', async () => {
      await appUninstallerPorts.cleanupPorts({ port: 31000 }, 'myapp', null, 'myapp');

      expect(firewallStub.deleteAppPortRules.args).to.deep.equal([[[31000]]]);
      expect(upnpStub.removeMapUpnpPort.calledWith(31000, 'Flux_App_myapp')).to.be.true;
    });
  });

  let appUninstaller;
  let verificationHelperStub;
  let messageHelperStub;
  let logStub;
  let volumeServiceStub;
  let configStub;
  let globalStateStub;
  let announceCycle;
  let getLocalSocketAddressStub;
  let broadcastStub;
  let canSendMessagesStub;
  let runCommandStub;

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
      // appConstants reads the record-expiry durations from here as well as the
      // collection names; absent keys fall back to the production defaults.
      fluxapps: {},
    };

    verificationHelperStub = {
      verifyPrivilege: sinon.stub(),
    };

    messageHelperStub = {
      createErrorMessage: sinon.stub(),
      errUnauthorizedMessage: sinon.stub(),
      createSuccessMessage: sinon.stub().returns({ status: 'success' }),
      // noCallThru: a key absent here is undefined, and the guard that calls it
      // throws into the catch rather than returning what it decided.
      createWarningMessage: sinon.stub().returns({ status: 'warning' }),
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

    volumeServiceStub = {
      getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }),
      isPathMounted: sinon.stub().resolves(false),
    };

    runCommandStub = sinon.stub().resolves({ error: null, stdout: '', stderr: '' });

    appUninstaller = proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
      '../appManagement/appPlacements': appPlacementsStub,
      config: configStub,
      '../verificationHelper': verificationHelperStub,
      '../messageHelper': messageHelperStub,
      '../utils/volumeService': volumeServiceStub,
      '../serviceHelper': {
        ensureString: sinon.stub().returnsArg(0),
        ensureNumber: sinon.stub().callsFake(Number),
        runCommand: runCommandStub,
        ensureBoolean: sinon.stub().returnsArg(0),
      },
      '../dbHelper': dbHelperStub,
      '../dockerService': {
        appDockerStop: sinon.stub().resolves(),
        appDockerRemove: sinon.stub().resolves(),
        clearFluxRemovedContainers: sinon.stub(),
        appDockerImageRemove: sinon.stub().resolves(),
        getAppIdentifier: sinon.stub().returns('testapp'),
      },
      '../../lib/log': logStub,
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
        deleteAppPortRules: sinon.stub().resolves({ failed: [], locked: false }),
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

    // The gate IS the policy: hosting an app is not owning it, so ending one is
    // the owner's call or the team's on their behalf. appownerorfluxteam admits
    // the app's owner and the flux team and refuses the node operator, so the
    // string asked for is the whole of what keeps them out, and asserting merely
    // that a privilege was checked leaves that free to change. What the privilege
    // admits is pinned in verificationHelperUtils.test.js ("FALSE for the node
    // operator, whom verifyAdminSession admits"); this pins the hop between them.
    it('gates an uninstall on the privilege that refuses the node operator', async () => {
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

      sinon.assert.calledOnceWithExactly(verificationHelperStub.verifyPrivilege, Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: 'testapp' });
    });

    // Asserting only that something was answered and something was logged cannot
    // separate the refusal from a crash: an omitted appname used to reach
    // appname.includes('_') and answer TypeError, which logs and responds exactly
    // as the refusal does. The message is what tells the two apart, so it is what
    // is pinned. Every sibling app-scoped route answers this same string.
    it('refuses a missing appname by name, rather than dereferencing it', async () => {
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
      expect(messageHelperStub.createErrorMessage.firstCall.args[0]).to.equal('No Flux App specified');
      expect(messageHelperStub.createErrorMessage.firstCall.args[1]).to.not.equal('TypeError');
    });

    it('rejects a component name without dereferencing an absent appname first', async () => {
      const req = {
        params: { appname: 'component_app' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({ status: 'error' });

      await appUninstaller.removeAppLocallyApi(req, res);

      expect(messageHelperStub.createErrorMessage.firstCall.args[0]).to.equal('Components cannot be removed manually');
      expect(verificationHelperStub.verifyPrivilege.called).to.be.false;
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

    // An image whose location could not be established outlives the app's last
    // record of itself, so the removal is the one chance to say it is there.
    // The pair is deliberate: silence has to mean the disk is clear.
    it('reports a volume it could not locate rather than passing over it', async () => {
      volumeServiceStub.getVolumeFilePath.resolves({ path: null, conclusive: false });
      const res = { write: sinon.stub(), end: sinon.stub() };

      await appUninstaller.hardUninstallApplication('testapp', 3333, { name: 'testapp', repotag: '/flux' }, res);

      const said = (call) => String(call.args[0] && (call.args[0].status || call.args[0])).includes('could not be located');
      expect(logStub.warn.getCalls().some(said)).to.be.true;
      expect(res.write.getCalls().some(said)).to.be.true;
    });

    it('says nothing when the search was complete and there was no volume', async () => {
      volumeServiceStub.getVolumeFilePath.resolves({ path: null, conclusive: true });
      const res = { write: sinon.stub(), end: sinon.stub() };

      await appUninstaller.hardUninstallApplication('testapp', 4444, { name: 'testapp', repotag: '/flux' }, res);

      // the canary: the removal really did run
      expect(res.write.called).to.be.true;
      const said = (call) => String(call.args[0] && (call.args[0].status || call.args[0])).includes('could not be located');
      expect(logStub.warn.getCalls().some(said)).to.be.false;
      expect(res.write.getCalls().some(said)).to.be.false;
    });

    // The removal carries on either way, but only one of the two lines is
    // true, and the stream is the operator's only account of what is still on
    // the disk.
    it('does not report a volume cleaned when the removal failed', async () => {
      volumeServiceStub.getVolumeFilePath.resolves({ path: '/mnt/data/fluxtestappFLUXFSVOL', conclusive: true });
      runCommandStub.withArgs('rm').resolves({ error: new Error('Read-only file system'), stdout: '', stderr: '' });
      const res = { write: sinon.stub(), end: sinon.stub() };

      await appUninstaller.hardUninstallApplication('testapp', 5555, { name: 'testapp', repotag: '/flux' }, res);

      const said = (text) => (call) => String(call.args[0] && (call.args[0].status || call.args[0])).includes(text);
      // the canary: the failure really was reported, so the absence below is
      // an absence and not a path that never ran
      expect(res.write.getCalls().some(said('An error occured while cleaning'))).to.be.true;
      expect(res.write.getCalls().some(said('cleaned')), 'told the operator the volume was cleaned').to.be.false;
    });

    // The success line is written only when the unmount succeeded. Reporting
    // it off a command's stdout meant it was never written at all, so the
    // operator's account of a successful uninstall was silence.
    it('reports a volume unmounted when the unmount succeeded', async () => {
      const res = { write: sinon.stub(), end: sinon.stub() };

      await appUninstaller.hardUninstallApplication('testapp', 7777, { name: 'testapp', repotag: '/flux' }, res);

      const said = (text) => (call) => String(call.args[0] && (call.args[0].status || call.args[0])).includes(text);
      expect(res.write.getCalls().some(said('unmounted'))).to.be.true;
    });

    it('does not report a volume unmounted when the unmount failed', async () => {
      runCommandStub.withArgs('umount').resolves({ error: new Error('target is busy'), stdout: '', stderr: '' });
      const res = { write: sinon.stub(), end: sinon.stub() };

      await appUninstaller.hardUninstallApplication('testapp', 8888, { name: 'testapp', repotag: '/flux' }, res);

      const said = (text) => (call) => String(call.args[0] && (call.args[0].status || call.args[0])).includes(text);
      expect(res.write.getCalls().some(said('An error occured while unmounting'))).to.be.true;
      expect(res.write.getCalls().some(said('unmounted')), 'told the operator the volume was unmounted').to.be.false;
    });

    it('does not report data cleaned when the removal failed', async () => {
      runCommandStub.withArgs('rm').resolves({ error: new Error('Read-only file system'), stdout: '', stderr: '' });
      const res = { write: sinon.stub(), end: sinon.stub() };

      await appUninstaller.hardUninstallApplication('testapp', 6666, { name: 'testapp', repotag: '/flux' }, res);

      const said = (text) => (call) => String(call.args[0] && (call.args[0].status || call.args[0])).includes(text);
      expect(res.write.getCalls().some(said('An error occured while cleaning'))).to.be.true;
      expect(res.write.getCalls().some(said('Data of')), 'told the operator the data was cleaned').to.be.false;
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
        '../appManagement/appPlacements': appPlacementsStub,
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../utils/volumeService': { getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }), isPathMounted: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureNumber: sinon.stub().callsFake(Number),
          runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }),
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
          clearFluxRemovedContainers: sinon.stub(),
          appDockerImageRemove: sinon.stub().resolves(),
          getAppIdentifier: sinon.stub().returns('testapp'),
        },
        '../../lib/log': logStub,
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
          deleteAppPortRules: sinon.stub().resolves({ failed: [], locked: false }),
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
        '../appManagement/appPlacements': appPlacementsStub,
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../utils/volumeService': { getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }), isPathMounted: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureNumber: sinon.stub().callsFake(Number),
          runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }),
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
          clearFluxRemovedContainers: sinon.stub(),
          getAppIdentifier: sinon.stub().returns('testapp'),
        },
        '../../lib/log': logStub,
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
          deleteAppPortRules: sinon.stub().resolves({ failed: [], locked: false }),
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
    let appSliceStub;

    function buildUninstaller(spec, constantOverrides = {}, dbOverrides = {}) {
      runtimeStateStub = { remove: sinon.stub().resolves(), removeControllerState: sinon.stub().resolves() };
      appSliceStub = { release: sinon.stub().resolves() };
      // The REAL departing tracker, taken fresh per test rather than
      // reimplemented here: a fake that counts differently from the module
      // would pass this suite over the defect the counting exists to prevent.
      // proxyquire restores the require cache after loading, so the fresh copy
      // is this suite's alone - evicting the entry instead would hand another
      // object to every module loaded after it, and globalState is a singleton
      // whose flags decide whether an operation may start at all.
      const { departingApps, unconfirmedApps, announceCycle: realAnnounceCycle } = proxyquire('../../ZelBack/src/services/utils/globalState', {});
      announceCycle = realAnnounceCycle;
      getLocalSocketAddressStub = sinon.stub().resolves(null);
      broadcastStub = sinon.stub().resolves();
      canSendMessagesStub = sinon.stub().returns(true);
      globalStateStub = {
        departingApps,
        unconfirmedApps,
        announceCycle,
        removalInProgress: false,
        installationInProgress: false,
        runningAppsCache: new Set(),
        receiveOnlySyncthingAppsCache: new Map(),
        seedMarks: new Map(),
        // the two operations this suite sets, named as the module names them
        operationHolding() {
          if (this.removalInProgress) return 'removal';
          if (this.installationInProgress) return 'installation';
          return null;
        },
      };
      return proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        '../appManagement/appPlacements': appPlacementsStub,
        '../utils/globalState': globalStateStub,
        // runs the step again after a moment until it succeeds, as the real one does after its wait
        '../utils/untilSucceeds': {
          BOOT_STEP_RETRY_MS: 15000,
          untilSucceeds: async (what, step) => {
            for (;;) {
              try {
                return await step(); // eslint-disable-line no-await-in-loop
              } catch {
                await new Promise((resolve) => { setTimeout(resolve, 10); }); // eslint-disable-line no-await-in-loop
              }
            }
          },
        },
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../utils/volumeService': { getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }), isPathMounted: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }),
          ensureBoolean: sinon.stub().returnsArg(0),
          ensureNumber: sinon.stub().returnsArg(0),
          delay: sinon.stub().resolves(),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
          findOneInDatabase: sinon.stub().resolves(spec),
          findInDatabase: sinon.stub().resolves([]),
          findOneAndDeleteInDatabase: sinon.stub().resolves(),
          ...dbOverrides,
        },
        '../dockerService': {
          appDockerKill: sinon.stub().resolves(),
          appDockerStop: sinon.stub().resolves(),
          appDockerRemove: sinon.stub().resolves(),
          clearFluxRemovedContainers: sinon.stub(),
          appDockerForceRemove: sinon.stub().resolves(),
          appDockerImageRemove: sinon.stub().resolves(),
          getAppIdentifier: sinon.stub().callsFake((id) => `flux${id}`),
          getBaseAppName: sinon.stub().callsFake((id) => id),
          removeFluxAppDockerNetwork: sinon.stub().resolves(),
          forceRemoveFluxAppDockerNetwork: sinon.stub().resolves(),
        },
        '../../lib/log': logStub,
        '../utils/appConstants': {
          // Spread from the real module, so only the named value differs and every
          // other constant stays whatever the module actually computes.
          ...proxyquire('../../ZelBack/src/services/utils/appConstants', { config: configStub }),
          ...constantOverrides,
        },
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
          deleteAppPortRules: sinon.stub().resolves({ failed: [], locked: false }),
          allowPort: sinon.stub().resolves(true),
          deleteAllowPortRule: sinon.stub().resolves(true),
          getLocalSocketAddress: getLocalSocketAddressStub,
        },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
          broadcastMessageToAll: broadcastStub,
        },
        '../nodeConfirmationService': { canSendMessages: canSendMessagesStub },
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
        './appSlice': appSliceStub,
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

    describe('a cleanup step that fails after the containers are gone', () => {
      // The app is part removed: it is held as departing - never started, never
      // announced - and its removal runs again until it finishes, which tells the network.
      const settle = async (done) => {
        for (let i = 0; i < 200 && !done(); i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => { setTimeout(resolve, 10); });
        }
      };

      it('fails the removal, holds the app, and finishes the removal once the row can be deleted', async () => {
        const deleteRow = sinon.stub().resolves();
        deleteRow.onFirstCall().rejects(new Error('connection timed out'));
        let heldWhileFinishing = null;
        deleteRow.onSecondCall().callsFake(async () => {
          heldWhileFinishing = globalStateStub.departingApps.has('testapp');
        });
        const uninstaller = buildUninstaller(v2Spec, {}, { findOneAndDeleteInDatabase: deleteRow });

        const outcome = await uninstaller.removeAppLocally('testapp', res, true);
        await settle(() => !globalStateStub.departingApps.has('testapp') && deleteRow.calledTwice);

        expect(outcome).to.equal('failed');
        expect(heldWhileFinishing, 'the part-removed app was not held while its removal was run again').to.be.true;
        sinon.assert.calledTwice(deleteRow);
        expect(globalStateStub.departingApps.has('testapp'), 'the hold outlived the removal').to.be.false;
        sinon.assert.calledOnce(getLocalSocketAddressStub);
      });

      // A hard redeploy tells the network once its reinstall fails, and the cleanup
      // that stopped part way is finished afterwards: that message is the one sent.
      it('finishes a removal without telling the network again when it was told meanwhile', async () => {
        const deleteRow = sinon.stub().resolves();
        deleteRow.onFirstCall().rejects(new Error('connection timed out'));
        const uninstaller = buildUninstaller(v2Spec, {}, { findOneAndDeleteInDatabase: deleteRow });
        getLocalSocketAddressStub.resolves('10.0.0.1:16127');

        // the reinstall holds the node, so the run that finishes the removal waits
        globalStateStub.installationInProgress = true;
        await uninstaller.removeAppLocally('testapp', res, true);
        await uninstaller.announceRemoval('testapp');
        globalStateStub.installationInProgress = false;
        await settle(() => deleteRow.calledTwice && !globalStateStub.departingApps.has('testapp'));

        sinon.assert.calledTwice(deleteRow);
        sinon.assert.calledOnce(broadcastStub);
      });

      it('a canary: the same removal told nothing meanwhile tells the network once it finishes', async () => {
        const deleteRow = sinon.stub().resolves();
        deleteRow.onFirstCall().rejects(new Error('connection timed out'));
        const uninstaller = buildUninstaller(v2Spec, {}, { findOneAndDeleteInDatabase: deleteRow });
        getLocalSocketAddressStub.resolves('10.0.0.1:16127');

        await uninstaller.removeAppLocally('testapp', res, true);
        await settle(() => deleteRow.calledTwice && !globalStateStub.departingApps.has('testapp'));

        sinon.assert.calledOnce(broadcastStub);
      });

      it('holds an app the network was already told of, and does not tell it twice', async () => {
        const deleteRow = sinon.stub().resolves();
        deleteRow.onFirstCall().rejects(new Error('connection timed out'));
        let heldWhileFinishing = null;
        deleteRow.onSecondCall().callsFake(async () => {
          heldWhileFinishing = globalStateStub.departingApps.has('testapp');
        });
        const uninstaller = buildUninstaller(v2Spec, {}, { findOneAndDeleteInDatabase: deleteRow });

        await uninstaller.removeAppLocally('testapp', res, true, true, true);
        await settle(() => !globalStateStub.departingApps.has('testapp') && deleteRow.calledTwice);

        expect(heldWhileFinishing, 'the part-removed app was not held while its removal was run again').to.be.true;
        sinon.assert.calledOnce(getLocalSocketAddressStub);
      });

      it('removes the whole app when the removal of one of its components stops part way', async () => {
        let heldWhileFinishing = null;
        const deleteRow = sinon.stub().callsFake(async () => {
          heldWhileFinishing = globalStateStub.departingApps.has('testapp');
        });
        const uninstaller = buildUninstaller(composedSpec, {}, { findOneAndDeleteInDatabase: deleteRow });
        runtimeStateStub.remove.onFirstCall().rejects(new Error('connection timed out'));

        const outcome = await uninstaller.removeAppLocally('comp1_testapp', res, true);
        await settle(() => deleteRow.called && !globalStateStub.departingApps.has('testapp'));

        expect(outcome).to.equal('failed');
        sinon.assert.calledOnce(deleteRow);
        expect(heldWhileFinishing, 'the app was not held while it was removed whole').to.be.true;
      });

      it('fails the removal, before the row, when the runtime state cannot be removed, and finishes it', async () => {
        const deleteRow = sinon.stub().resolves();
        const uninstaller = buildUninstaller(v2Spec, {}, { findOneAndDeleteInDatabase: deleteRow });
        runtimeStateStub.remove.onFirstCall().rejects(new Error('connection timed out'));

        const outcome = await uninstaller.removeAppLocally('testapp', res, true);
        expect(outcome).to.equal('failed');
        await settle(() => deleteRow.called);

        sinon.assert.calledOnce(deleteRow);
      });

      // A forced removal takes the node's removal lock without asking and clears it
      // when it ends, so one run beside another removal would release that removal's
      // lock part way through. The rerun waits for the node instead.
      it('runs the removal again only once no other install or removal holds the node', async () => {
        const deleteRow = sinon.stub().resolves();
        deleteRow.onFirstCall().rejects(new Error('connection timed out'));
        const uninstaller = buildUninstaller(v2Spec, {}, { findOneAndDeleteInDatabase: deleteRow });

        globalStateStub.installationInProgress = true;
        await uninstaller.removeAppLocally('testapp', res, true);
        // time for the rerun to have run, had it not waited
        await new Promise((resolve) => { setTimeout(resolve, 100); });
        sinon.assert.calledOnce(deleteRow);
        expect(globalStateStub.installationInProgress, 'the rerun cleared another operation\'s hold').to.equal(true);

        globalStateStub.installationInProgress = false;
        await settle(() => deleteRow.calledTwice && !globalStateStub.departingApps.has('testapp'));
        sinon.assert.calledTwice(deleteRow);
      });

      it('runs one removal again for an app however often it is handed over', async () => {
        let finishRow;
        const deleteRow = sinon.stub().resolves();
        deleteRow.onFirstCall().rejects(new Error('connection timed out'));
        deleteRow.onSecondCall().returns(new Promise((resolve) => { finishRow = resolve; }));
        const uninstaller = buildUninstaller(v2Spec, {}, { findOneAndDeleteInDatabase: deleteRow });

        await uninstaller.removeAppLocally('testapp', res, true);
        await settle(() => deleteRow.calledTwice);
        uninstaller.finishRemoval('testapp', true, true);
        finishRow();
        await settle(() => !globalStateStub.departingApps.has('testapp'));
        // time for a second run, had one been started, to reach the row
        await new Promise((resolve) => { setTimeout(resolve, 100); });

        sinon.assert.calledTwice(deleteRow);
      });
    });

    it('takes a forced removal\'s spec from the app\'s newest stored message, read by its name', async () => {
      const messages = sinon.stub().resolves([{ height: 900, appSpecifications: v2Spec }]);
      const uninstaller = buildUninstaller(null, {}, { findInDatabase: messages });
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.removeAppLocally('testapp', res, true);

      sinon.assert.calledWithExactly(
        messages,
        sinon.match.any,
        'appsMessages',
        { 'appSpecifications.name': 'testapp' },
        { projection: { _id: 0 }, sort: { height: -1, timestamp: -1 }, limit: 1 },
      );
      sinon.assert.calledOnceWithExactly(onRemoved, 'testapp');
    });

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

    it('releases the app\'s slice once the whole app is torn down', async () => {
      const uninstaller = buildUninstaller(composedSpec);

      await uninstaller.removeAppLocally('testapp', res, true);

      sinon.assert.calledOnceWithExactly(appSliceStub.release, 'testapp');
    });

    it('keeps the app\'s slice when one component is removed', async () => {
      const uninstaller = buildUninstaller(composedSpec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.removeAppLocally('comp1_testapp', res, true);

      // the canary: the component was torn down
      sinon.assert.calledOnceWithExactly(onRemoved, 'comp1_testapp');
      sinon.assert.notCalled(appSliceStub.release);
    });

    it('scopes the seam to the one component on a component-scoped removal', async () => {
      const uninstaller = buildUninstaller(composedSpec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.removeAppLocally('comp1_testapp', res, true);

      sinon.assert.calledOnceWithExactly(onRemoved, 'comp1_testapp');
    });

    // Peers rank which copy seeds on what each node claims to hold, and a claim
    // kept past the removal offers a volume this node no longer has - outranking
    // a node that still holds the app, and seeding an empty folder in its place.
    it('drops the published holding when the data is deleted', async () => {
      const uninstaller = buildUninstaller(composedSpec);
      // Keyed by the app IDENTIFIER, which is what the folder id and the cleanup
      // both use - not the component name the removal is asked for.
      folderStateMap.set('fluxcomp1_testapp', { state: 'measured', bytes: 5821604997, newestModified: 200 });
      folderStateMap.set('otherapp', { state: 'measured', bytes: 4096, newestModified: 100 });
      globalStateStub.seedMarks.set('fluxcomp1_testapp', { stage: 'intent', bytes: 5821604997, newestModified: 200 });
      globalStateStub.seedMarks.set('otherapp', { stage: 'intent', bytes: 4096, newestModified: 100 });

      await uninstaller.removeAppLocally('comp1_testapp', res, true);

      expect(folderStateMap.has('fluxcomp1_testapp'), 'a removed app still claims to hold its data').to.equal(false);
      expect(globalStateStub.seedMarks.has('fluxcomp1_testapp'), 'a removed app still offers to seed').to.equal(false);
      expect(globalStateStub.seedMarks.has('otherapp')).to.equal(true);
      // Scoped to what was removed - a component-scoped removal is not a clear of
      // everything this node has answered for.
      expect(folderStateMap.has('otherapp')).to.equal(true);
    });

    it('pairs the seam with the durable runtime-state clear (same identifiers)', async () => {
      const uninstaller = buildUninstaller(composedSpec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.removeAppLocally('testapp', res, true);

      expect(runtimeStateStub.remove.args.map((a) => a[0])).to.deep.equal(onRemoved.args.map((a) => a[0]));
    });

    it('clears controller state and fires the seam on SOFT removal too (redeploy clears the lock)', async () => {
      // user decision: a redeploy of any kind is an explicit "make it run" - the
      // operator lock (and the stale controller verdict) must not survive it
      const uninstaller = buildUninstaller(composedSpec);
      const onRemoved = sinon.stub();
      uninstaller.setOnComponentRemoved(onRemoved);

      await uninstaller.softRemoveAppLocally('testapp', null, { removalInProgress: false, installationInProgress: false }, sinon.stub());

      expect(runtimeStateStub.removeControllerState.args.map((a) => a[0])).to.have.members(['comp1_testapp', 'comp2_testapp']);
      expect(onRemoved.args.map((a) => a[0])).to.have.members(['comp1_testapp', 'comp2_testapp']);
    });

    // A soft removal leaves the image on disk and the volume mounted, so the
    // record naming that image still describes something that is there.
    // Dropping the whole document sends the next boot back to the filename
    // search, which stamps whatever it finds as this node's own.
    it('does not drop the volume record a soft removal is leaving in place', async () => {
      const uninstaller = buildUninstaller(composedSpec);

      await uninstaller.softRemoveAppLocally('testapp', null, { removalInProgress: false, installationInProgress: false }, sinon.stub());

      sinon.assert.notCalled(runtimeStateStub.remove);
    });

    // The record follows the app's volume: a removal that deletes the volume
    // deletes it, and one that keeps the volume keeps it.
    describe('the placement record', () => {
      it('goes with the app\'s volume', async () => {
        const uninstaller = buildUninstaller(composedSpec);

        const outcome = await uninstaller.removeAppLocally('testapp', res, true, false, true);

        expect(outcome).to.equal(RemovalOutcome.REMOVED);
        sinon.assert.calledOnceWithExactly(appPlacementsStub.removePlacement, 'testapp');
      });

      it('a record that cannot be deleted leaves the removal standing', async () => {
        const uninstaller = buildUninstaller(composedSpec);
        appPlacementsStub.removePlacement.rejects(new Error('mongo went away'));

        const outcome = await uninstaller.removeAppLocally('testapp', res, true, false, true);

        expect(outcome).to.equal(RemovalOutcome.REMOVED);
        expect(logStub.warn.calledWithMatch(/placement record of testapp was not removed: mongo went away/)).to.equal(true);
      });

      it('stays when one component is removed and the app with it is not', async () => {
        const uninstaller = buildUninstaller(composedSpec);

        await uninstaller.removeAppLocally('comp1_testapp', res, true);

        sinon.assert.notCalled(appPlacementsStub.removePlacement);
      });

      it('stays through a soft removal', async () => {
        const uninstaller = buildUninstaller(composedSpec);

        await uninstaller.softRemoveAppLocally('testapp', null, { removalInProgress: false, installationInProgress: false }, sinon.stub());

        sinon.assert.notCalled(appPlacementsStub.removePlacement);
      });

      it('stays when the removal is refused', async () => {
        const uninstaller = buildUninstaller(composedSpec);
        globalStateStub.removalInProgress = true;

        const outcome = await uninstaller.removeAppLocally('testapp', res, false);

        expect(outcome).to.equal(RemovalOutcome.BUSY);
        sinon.assert.notCalled(appPlacementsStub.removePlacement);
      });
    });

    it('completes removal when no seam callback is registered', async () => {
      const uninstaller = buildUninstaller(v2Spec);

      await uninstaller.removeAppLocally('testapp', res, true);

      sinon.assert.calledOnceWithExactly(runtimeStateStub.remove, 'testapp');
      sinon.assert.notCalled(logStub.error);
    });

    // Boot holds an app whose location record it could not read until a check
    // decides it. An uninstall in the meantime leaves that check nothing to
    // decide, and an install of the same name afterwards is another app.
    describe('the boot hold', () => {
      it('ends when the app is uninstalled', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        globalStateStub.unconfirmedApps.set('testapp', Symbol('testapp'));

        await uninstaller.removeAppLocally('testapp', res, true, true, false);

        expect(
          globalStateStub.unconfirmedApps.has('testapp'),
          'still held after its uninstall, so boot\'s check would decide an install that came after it',
        ).to.be.false;
      });

      it('holds the app while its teardown runs', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        globalStateStub.unconfirmedApps.set('testapp', Symbol('testapp'));
        let heldDuring = null;
        uninstaller.setOnComponentRemoved(() => {
          heldDuring = globalStateStub.unconfirmedApps.has('testapp');
        });

        await uninstaller.removeAppLocally('testapp', res, true, true, false);

        expect(heldDuring, 'released part way through its teardown, so it could be started or announced').to.be.true;
      });

      it('stays when a removal is refused', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        globalStateStub.unconfirmedApps.set('testapp', Symbol('testapp'));
        globalStateStub.removalInProgress = true;

        await uninstaller.removeAppLocally('testapp', res, false, true, false);

        expect(globalStateStub.unconfirmedApps.has('testapp'), 'released by a removal that never ran').to.be.true;
      });
    });

    // A node stops claiming an app when it decides to hand it back, not when the
    // container happens to die. The app stays installed until the removal ends, so
    // without the mark the announcement built in that window re-creates the
    // location row the removal message had just cleared.
    describe('the departing mark', () => {
      it('marks the app while a broadcast removal runs, and clears it when the removal ends', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        let markedDuring = null;
        uninstaller.setOnComponentRemoved(() => {
          markedDuring = globalStateStub.departingApps.has('testapp');
        });

        await uninstaller.removeAppLocally('testapp', res, true, true, true);

        expect(markedDuring, 'still claimed the app while removing it').to.be.true;
        expect(globalStateStub.departingApps.has('testapp'), 'left the mark behind, silencing the app for good').to.be.false;
      });

      // A holder that counts this copy while its volume is being deleted could hand
      // its own back beside it.
      it('tells the network before it tears the app down', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        getLocalSocketAddressStub.resolves('10.0.0.1:16127');
        let toldBeforeGone = null;
        uninstaller.setOnComponentRemoved(() => {
          toldBeforeGone = broadcastStub.called;
        });

        await uninstaller.removeAppLocally('testapp', res, true, true, true);

        expect(toldBeforeGone, 'told the network only once the app was gone').to.be.true;
        sinon.assert.calledOnce(broadcastStub);
      });

      it('does not mark a removal the network is never told about', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        let markedDuring = null;
        uninstaller.setOnComponentRemoved(() => {
          markedDuring = globalStateStub.departingApps.has('testapp');
        });

        await uninstaller.removeAppLocally('testapp', res, true, true, false);

        expect(
          markedDuring,
          'a redeploy keeps announcing - stop, and its row lapses and the app is placed a second time',
        ).to.be.false;
      });

      it('releases only the mark this call took, so a refused duplicate cannot unmark a live removal', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        globalStateStub.departingApps.enter('testapp');
        globalStateStub.removalInProgress = true;

        await uninstaller.removeAppLocally('testapp', res, false, true, true);

        expect(
          globalStateStub.departingApps.has('testapp'),
          'unmarked an app whose real removal is still running',
        ).to.be.true;
      });

      it('releases only the lock this call took, so a refused duplicate cannot free a live removal', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        globalStateStub.removalInProgress = true;

        await uninstaller.removeAppLocally('testapp', res, false, true, true);

        expect(
          globalStateStub.removalInProgress,
          'freed the node while the removal holding it is still running, so an install can start into it',
        ).to.be.true;
      });

      // WHAT A REMOVAL ANSWERS IS A CONTRACT, and the sweep is the caller that acts on
      // it: "refused" read as "removed" leaves a blocked application running, and "not
      // here" read as "it failed" asks again forever about an application that is gone.
      describe('what the removal answers', () => {
        it('answers REMOVED when it removed the app', async () => {
          const uninstaller = buildUninstaller(v2Spec);

          const outcome = await uninstaller.removeAppLocally('testapp', res, true, true, true);

          expect(outcome).to.equal(RemovalOutcome.REMOVED);
        });

        it('answers BUSY while another removal holds the node', async () => {
          const uninstaller = buildUninstaller(v2Spec);
          globalStateStub.removalInProgress = true;

          const outcome = await uninstaller.removeAppLocally('testapp', res, false, true, true);

          expect(outcome).to.equal(RemovalOutcome.BUSY);
        });

        it('answers BUSY while an installation holds the node', async () => {
          const uninstaller = buildUninstaller(v2Spec);
          globalStateStub.installationInProgress = true;

          const outcome = await uninstaller.removeAppLocally('testapp', res, false, true, true);

          expect(outcome).to.equal(RemovalOutcome.BUSY);
        });

        it('answers NOT_INSTALLED when the node holds no specification for it', async () => {
          const uninstaller = buildUninstaller(null);

          const outcome = await uninstaller.removeAppLocally('testapp', res, false, true, true);

          expect(outcome).to.equal(RemovalOutcome.NOT_INSTALLED);
        });

        it('answers NOT_INSTALLED when a forced removal can find it nowhere', async () => {
          const uninstaller = buildUninstaller(null);

          const outcome = await uninstaller.removeAppLocally('testapp', res, true, true, true);

          expect(outcome).to.equal(RemovalOutcome.NOT_INSTALLED);
        });

        // The other side of that branch: anything else the removal threw leaves the
        // application possibly still here, whole or in part.
        it('answers FAILED when the removal threw for any other reason', async () => {
          const uninstaller = buildUninstaller(v2Spec);

          const outcome = await uninstaller.removeAppLocally(undefined, res, true, true, true);

          expect(outcome).to.equal(RemovalOutcome.FAILED);
        });
      });

      // The announcement and a broadcast removal must not cross. A cycle that took
      // its list before this removal marked the app still names it, so the removal
      // waits for that cycle to send - the claim lands first and this clears it.
      it('does not announce a removal while an announcement cycle is still sending', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        await announceCycle.enable();

        const removal = uninstaller.removeAppLocally('testapp', res, true, true, true);
        const raced = await Promise.race([
          removal.then(() => 'announced'),
          new Promise((resolve) => { setTimeout(() => resolve('waiting'), 100); }),
        ]);
        expect(raced, 'announced the removal over the top of a cycle already sending').to.equal('waiting');
        expect(
          getLocalSocketAddressStub.called,
          'built the removal message before the cycle had sent',
        ).to.be.false;

        announceCycle.disable();
        await removal;
        // The canary: without this the assertion above passes for a removal that
        // never got as far as the wait.
        expect(getLocalSocketAddressStub.called, 'the removal never reached its broadcast').to.be.true;
      });

      it('tells the network nothing while peers would not accept this node\'s messages', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        getLocalSocketAddressStub.resolves('10.0.0.1:16127');
        canSendMessagesStub.returns(false);

        await uninstaller.removeAppLocally('testapp', res, true, true, true);

        sinon.assert.called(canSendMessagesStub);
        sinon.assert.notCalled(broadcastStub);
      });

      // Whether the node can be heard is read as the message goes out, not when
      // the removal starts: a removal can wait for a cycle, and the answer changes.
      it('tells the network once this node can be heard by the time the message goes out', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        getLocalSocketAddressStub.resolves('10.0.0.1:16127');
        canSendMessagesStub.returns(false);
        await announceCycle.enable();

        const removal = uninstaller.removeAppLocally('testapp', res, true, true, true);
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        canSendMessagesStub.returns(true);
        announceCycle.disable();
        await removal;

        sinon.assert.calledOnceWithMatch(broadcastStub, { type: 'fluxappremoved', appName: 'testapp' });
      });

      // A redeploy tells the network nothing, so it contradicts no announcement and
      // must not queue behind one - every spec change on the node would pay for it.
      it('does not wait for a cycle when the removal says nothing to the network', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        await announceCycle.enable();

        const removal = uninstaller.removeAppLocally('testapp', res, true, true, false);
        const raced = await Promise.race([
          removal.then(() => 'removed'),
          new Promise((resolve) => { setTimeout(() => resolve('waited'), 100); }),
        ]);

        expect(raced, 'a silent removal queued behind an announcement it cannot contradict').to.equal('removed');
        announceCycle.disable();
      });

      it('a removal that finishes does not unmark an overlapping one still running', async () => {
        const uninstaller = buildUninstaller(v2Spec);
        // A second broadcast removal of this app, already under way. Force skips
        // the single-removal guard, so a surplus trim and an expiry removal - or an
        // app and one of its components, which share this name - both get here.
        globalStateStub.departingApps.enter('testapp');

        await uninstaller.removeAppLocally('testapp', res, true, true, true);

        expect(
          globalStateStub.departingApps.has('testapp'),
          'the removal that finished first handed the announcement back to the one still running',
        ).to.be.true;
      });
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
        '../appManagement/appPlacements': appPlacementsStub,
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../utils/volumeService': { getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }), isPathMounted: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureNumber: sinon.stub().callsFake(Number),
          runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }),
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
          clearFluxRemovedContainers: sinon.stub(),
          appDockerImageRemove: sinon.stub().resolves(),
          getAppIdentifier: sinon.stub().returns('testapp'),
        },
        '../../lib/log': logStub,
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
          deleteAppPortRules: sinon.stub().resolves({ failed: [], locked: false }),
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
        '../appManagement/appPlacements': appPlacementsStub,
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        // Stubbed rather than reached: the real one opens the runtime-state
        // collection, and a soft removal that could not clear the controller
        // state does not report itself done.
        '../appManagement/appsRuntimeState': { removeControllerState: sinon.stub().resolves() },
        '../utils/volumeService': { getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }), isPathMounted: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          ensureNumber: sinon.stub().callsFake(Number),
          runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }),
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
          clearFluxRemovedContainers: sinon.stub(),
          appDockerImageRemove: sinon.stub().resolves(),
          getAppIdentifier: sinon.stub().returns(100),
        },
        '../../lib/log': logStub,
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
          deleteAppPortRules: sinon.stub().resolves({ failed: [], locked: false }),
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
