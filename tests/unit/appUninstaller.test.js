const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');

describe('appUninstaller tests', () => {
  let appUninstaller;
  let verificationHelperStub;
  let messageHelperStub;
  let logStub;
  let volumeServiceStub;
  let configStub;
  let globalStateStub;
  let announceCycle;
  let getLocalSocketAddressStub;
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
      config: configStub,
      '../verificationHelper': verificationHelperStub,
      '../messageHelper': messageHelperStub,
      '../utils/volumeService': volumeServiceStub,
      '../serviceHelper': {
        ensureString: sinon.stub().returnsArg(0),
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
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../utils/volumeService': { getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }), isPathMounted: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
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
        '../utils/volumeService': { getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }), isPathMounted: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
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

    function buildUninstaller(spec, constantOverrides = {}) {
      runtimeStateStub = { remove: sinon.stub().resolves(), removeControllerState: sinon.stub().resolves() };
      // The REAL departing tracker, taken fresh per test rather than
      // reimplemented here: a fake that counts differently from the module
      // would pass this suite over the defect the counting exists to prevent.
      // proxyquire restores the require cache after loading, so the fresh copy
      // is this suite's alone - evicting the entry instead would hand another
      // object to every module loaded after it, and globalState is a singleton
      // whose flags decide whether an operation may start at all.
      const { departingApps, announceCycle: realAnnounceCycle } = proxyquire('../../ZelBack/src/services/utils/globalState', {});
      announceCycle = realAnnounceCycle;
      getLocalSocketAddressStub = sinon.stub().resolves(null);
      globalStateStub = {
        departingApps,
        announceCycle,
        removalInProgress: false,
        installationInProgress: false,
        runningAppsCache: new Set(),
        receiveOnlySyncthingAppsCache: new Map(),
      };
      return proxyquire('../../ZelBack/src/services/appLifecycle/appUninstaller', {
        '../utils/globalState': globalStateStub,
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
          isFirewallActive: sinon.stub().resolves(false),
          allowPort: sinon.stub().resolves(true),
          deleteAllowPortRule: sinon.stub().resolves(true),
          getLocalSocketAddress: getLocalSocketAddressStub,
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

    it('completes removal when no seam callback is registered', async () => {
      const uninstaller = buildUninstaller(v2Spec);

      await uninstaller.removeAppLocally('testapp', res, true);

      sinon.assert.calledOnceWithExactly(runtimeStateStub.remove, 'testapp');
      sinon.assert.notCalled(logStub.error);
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

      // A cycle that never finishes must not hold the node's removals: they take the
      // removal lock, and every install and redeploy queues behind that.
      it('gives up on a wedged cycle and announces anyway', async () => {
        const uninstaller = buildUninstaller(v2Spec, { ANNOUNCE_CYCLE_WAIT_MS: 50 });
        await announceCycle.enable();

        const removal = uninstaller.removeAppLocally('testapp', res, true, true, true);
        const raced = await Promise.race([
          removal.then(() => 'announced'),
          new Promise((resolve) => { setTimeout(() => resolve('stuck'), 2000); }),
        ]);

        expect(raced, 'a wedged announcement cycle held the removal indefinitely').to.equal('announced');
        expect(getLocalSocketAddressStub.called, 'gave up on the wait without going on to broadcast').to.be.true;
        announceCycle.disable();
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
        config: configStub,
        '../verificationHelper': verificationHelperStub,
        '../messageHelper': messageHelperStub,
        '../utils/volumeService': { getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }), isPathMounted: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
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
        // Stubbed rather than reached: the real one opens the runtime-state
        // collection, and a soft removal that could not clear the controller
        // state does not report itself done.
        '../appManagement/appsRuntimeState': { removeControllerState: sinon.stub().resolves() },
        '../utils/volumeService': { getVolumeFilePath: sinon.stub().resolves({ path: null, conclusive: true }), isPathMounted: sinon.stub().resolves(false) },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
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
