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

  describe('appUninstallHard tests', () => {
    it('should hard uninstall app, no ports passed', async () => {
      const appName = 'testapp';
      const appId = 1111;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
      };
      const isComponent = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      await appUninstaller.appUninstallHard(appName, appId, appSpecifications, isComponent, res);

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
      const isComponent = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      await appUninstaller.appUninstallHard(appName, appId, appSpecifications, isComponent, res);

      expect(res.write.called).to.be.true;
    });
  });

  describe('appUninstallSoft tests', () => {
    it('should soft uninstall app, no ports passed', async () => {
      const appName = 'testapp';
      const appId = 1111;
      const appSpecifications = {
        name: appName,
        repotag: '/flux',
      };
      const isComponent = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      await appUninstaller.appUninstallSoft(appName, appId, appSpecifications, isComponent, res);

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
      const isComponent = false;
      const res = {
        write: sinon.stub(),
        end: sinon.stub(),
      };

      await appUninstaller.appUninstallSoft(appName, appId, appSpecifications, isComponent, res);

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
      expect(appUninstaller.appUninstallHard).to.be.a('function');
      expect(appUninstaller.appUninstallSoft).to.be.a('function');
      expect(appUninstaller.removeAppLocally).to.be.a('function');
      expect(appUninstaller.softRemoveAppLocally).to.be.a('function');
      expect(appUninstaller.removeAppLocallyApi).to.be.a('function');
    });
  });
});
