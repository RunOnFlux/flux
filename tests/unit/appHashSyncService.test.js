const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appHashSyncService tests', () => {
  let appHashSyncService;
  let dbHelperStub;
  let messageHelperStub;
  let serviceHelperStub;
  let verificationHelperStub;
  let fluxNetworkHelperStub;
  let generalServiceStub;
  let globalStateStub;
  let logStub;
  let configStub;

  beforeEach(() => {
    // Config stub
    configStub = {
      database: {
        daemon: {
          collections: {
            scannedHeight: 'scannedHeight',
            appsHashes: 'appsHashes',
          },
          database: 'daemon',
        },
        appslocal: {
          collections: {
            appsInformation: 'localAppsInformation',
          },
          database: 'localapps',
        },
        appsglobal: {
          collections: {
            appsMessages: 'appsMessages',
            appsInformation: 'globalAppsInformation',
            appsTemporaryMessages: 'appsTemporaryMessages',
            appsLocations: 'appsLocations',
            appsInstallingLocations: 'appsInstallingLocations',
            appsInstallingErrorsLocations: 'appsInstallingErrorsLocations',
          },
          database: 'globalapps',
        },
      },
      fluxapps: {
        blocksLasting: 22000,
        latestAppSpecification: 1,
      },
    };

    // Stubs
    dbHelperStub = {
      databaseConnection: sinon.stub(),
      findInDatabase: sinon.stub(),
      findOneInDatabase: sinon.stub(),
      insertOneToDatabase: sinon.stub(),
      updateOneInDatabase: sinon.stub(),
      aggregateInDatabase: sinon.stub(),
    };

    messageHelperStub = {
      createDataMessage: sinon.stub(),
      createErrorMessage: sinon.stub(),
      createSuccessMessage: sinon.stub(),
    };

    serviceHelperStub = {
      axiosGet: sinon.stub().resolves({
        data: {
          status: 'success',
          data: true,
        },
      }),
      delay: sinon.stub().resolves(),
      ensureNumber: sinon.stub().returnsArg(0),
    };

    verificationHelperStub = {
      verifyPrivilege: sinon.stub(),
    };

    fluxNetworkHelperStub = {
      getNumberOfPeers: sinon.stub(),
    };

    generalServiceStub = {
      checkSynced: sinon.stub(),
    };

    globalStateStub = {
      checkAndSyncAppHashesWasEverExecuted: false,
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    // Proxy require
    appHashSyncService = proxyquire('../../ZelBack/src/services/appMessaging/appHashSyncService', {
      config: configStub,
      '../dbHelper': dbHelperStub,
      '../messageHelper': messageHelperStub,
      '../serviceHelper': serviceHelperStub,
      '../verificationHelper': verificationHelperStub,
      '../generalService': generalServiceStub,
      '../fluxNetworkHelper': fluxNetworkHelperStub,
      '../utils/globalState': globalStateStub,
      '../../lib/log': logStub,
      './messageStore': {
        storeAppTemporaryMessage: sinon.stub().resolves(true),
      },
      './messageVerifier': {
        checkAndRequestApp: sinon.stub().resolves(true),
        appHashHasMessageNotFound: sinon.stub().resolves(true),
        checkAndRequestMultipleApps: sinon.stub().resolves(),
      },
      '../appDatabase/registryManager': {
        expireGlobalApplications: sinon.stub().resolves(),
      },
      '../invalidMessages': {
        invalidMessages: [],
      },
      '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
        config: configStub,
      }),
      '../utils/establishedConnections': {
        outgoingPeers: [
          { ip: '192.168.1.1', port: 16127 },
          { ip: '192.168.1.2', port: 16127 },
        ],
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('triggerAppHashesCheckAPI', () => {
    it('should trigger hashes check when authorized', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      messageHelperStub.createSuccessMessage.returns({ status: 'success', data: { message: 'Running check on missing application messages ' } });

      await appHashSyncService.triggerAppHashesCheckAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.calledWith('adminandfluxteam', req)).to.be.true;
      expect(messageHelperStub.createSuccessMessage.calledOnce).to.be.true;
    });

    it('should deny unauthorized access', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage = sinon.stub().returns({ status: 'error', data: { message: 'Unauthorized' } });

      await appHashSyncService.triggerAppHashesCheckAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.calledOnce).to.be.true;
      expect(messageHelperStub.errUnauthorizedMessage.calledOnce).to.be.true;
    });

    it('should handle errors gracefully', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };
      const error = new Error('Test error');

      verificationHelperStub.verifyPrivilege.rejects(error);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Test error' } });

      await appHashSyncService.triggerAppHashesCheckAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.calledWith(error)).to.be.true;
      expect(messageHelperStub.createErrorMessage.calledOnce).to.be.true;
    });
  });

  describe('checkAndSyncAppHashes', () => {
    it('should complete successfully with low percentage of missing apps', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      // Return results where less than 95% are missing (e.g., 5 out of 100)
      const results = Array(100).fill({ message: true });
      for (let i = 0; i < 5; i += 1) {
        results[i] = { message: false };
      }
      dbHelperStub.findInDatabase.resolves(results);

      await appHashSyncService.checkAndSyncAppHashes();

      expect(dbHelperStub.findInDatabase.calledOnce).to.be.true;
      expect(globalStateStub.checkAndSyncAppHashesWasEverExecuted).to.be.true;
    });

    it('should handle errors and reset running flag', async () => {
      const error = new Error('Database error');
      // eslint-disable-next-line no-unused-vars
      const mockDb = { db: sinon.stub().returns('database') };

      dbHelperStub.databaseConnection.throws(error);
      fluxNetworkHelperStub.getNumberOfPeers.returns(15);

      await appHashSyncService.checkAndSyncAppHashes();

      expect(logStub.error.calledWith(error)).to.be.true;
      expect(globalStateStub.checkAndSyncAppHashesWasEverExecuted).to.be.false;
    });
  });

  describe('continuousFluxAppHashesCheck', () => {
    it('should skip if not enough peers', async () => {
      fluxNetworkHelperStub.getNumberOfPeers.returns(5);

      await appHashSyncService.continuousFluxAppHashesCheck();

      expect(logStub.info.calledWith('Not enough connected peers to request missing Flux App messages')).to.be.true;
      expect(dbHelperStub.findInDatabase.called).to.be.false;
    });

    it('should skip if not synced', async () => {
      fluxNetworkHelperStub.getNumberOfPeers.returns(15);
      generalServiceStub.checkSynced.resolves(false);

      await appHashSyncService.continuousFluxAppHashesCheck();

      expect(logStub.info.calledWith('Flux not yet synced')).to.be.true;
      expect(dbHelperStub.findInDatabase.called).to.be.false;
    });

    it('should handle empty results gracefully', async () => {
      fluxNetworkHelperStub.getNumberOfPeers.returns(15);
      generalServiceStub.checkSynced.resolves(true);
      globalStateStub.checkAndSyncAppHashesWasEverExecuted = true;

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves({ generalScannedHeight: 1000 });
      dbHelperStub.findInDatabase.resolves([]);

      await appHashSyncService.continuousFluxAppHashesCheck();

      expect(dbHelperStub.findInDatabase.calledOnce).to.be.true;
      expect(logStub.info.calledWith('Requesting missing Flux App messages')).to.be.true;
    });

    it('should handle database errors', async () => {
      const error = new Error('Database error');
      fluxNetworkHelperStub.getNumberOfPeers.returns(15);
      generalServiceStub.checkSynced.resolves(true);
      globalStateStub.checkAndSyncAppHashesWasEverExecuted = true;

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.rejects(error);

      await appHashSyncService.continuousFluxAppHashesCheck();

      expect(logStub.error.calledWith(error)).to.be.true;
    });
  });
});
