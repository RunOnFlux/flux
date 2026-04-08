const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('messageVerifier tests', () => {
  let messageVerifier;
  let dbHelperStub;
  let serviceHelperStub;
  let logStub;
  let configStub;

  beforeEach(() => {
    configStub = {
      database: {
        url: 'mongodb://localhost:27017',
        appsglobal: {
          database: 'globalapps',
          collections: {
            appsMessages: 'appsMessages',
            appsTemporaryMessages: 'appsTempMessages',
          },
        },
      },
    };

    dbHelperStub = {
      databaseConnection: sinon.stub(),
      findOneInDatabase: sinon.stub(),
      findInDatabase: sinon.stub(),
    };

    serviceHelperStub = {
      ensureNumber: sinon.stub().returnsArg(0),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    messageVerifier = proxyquire('../../ZelBack/src/services/appMessaging/messageVerifier', {
      config: {
        ...configStub,
        database: {
          ...configStub.database,
          url: 'mongodb://localhost:27017',
        },
      },
      '../dbHelper': dbHelperStub,
      '../serviceHelper': serviceHelperStub,
      '../../lib/log': logStub,
      '../utils/appConstants': {
        globalAppsMessages: 'appsMessages',
        globalAppsTempMessages: 'appsTempMessages',
      },
      'bitcoinjs-message': {
        verify: sinon.stub().returns(true),
      },
      '../daemonService/daemonServiceControlRpcs': {
        validateAddress: sinon.stub().resolves({ data: { isvalid: true } }),
      },
      './messageStore': {
        storeAppTemporaryMessage: sinon.stub().resolves(),
      },
      '../messageHelper': {
        createDataMessage: sinon.stub(),
        createErrorMessage: sinon.stub(),
      },
      '../verificationHelper': {
        verifyPrivilege: sinon.stub().resolves(true),
      },
      '../generalService': {
        getApplicationGlobalSpecifications: sinon.stub().resolves({}),
      },
      '../signatureVerifier': {
        verifySignature: sinon.stub().returns(true),
      },
      '../fluxCommunicationMessagesSender': {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      },
      '../daemonService/daemonServiceMiscRpcs': {
        getBlock: sinon.stub().resolves({}),
      },
      '../utils/appUtilities': {
        appPricePerMonth: sinon.stub().returns(1000),
      },
      '../utils/chainUtilities': {
        getChainParamsPriceUpdates: sinon.stub().returns([]),
        getChainTeamSupportAddressUpdates: sinon.stub().returns([]),
      },
      '../appDatabase/registryManager': {
        updateAppSpecifications: sinon.stub().resolves(),
      },
      '../fluxNetworkHelper': {
        getNumberOfPeers: sinon.stub().returns(10),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('checkAppMessageExistence', () => {
    it('should return false if message not found', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);

      const result = await messageVerifier.checkAppMessageExistence('hash123');

      expect(result).to.be.false;
      expect(dbHelperStub.findOneInDatabase.calledOnce).to.be.true;
    });

    it('should return message if found', async () => {
      const mockMessage = { hash: 'hash123', appSpecifications: {} };
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(mockMessage);

      const result = await messageVerifier.checkAppMessageExistence('hash123');

      expect(result).to.equal(mockMessage);
    });
  });

  describe('checkAppTemporaryMessageExistence', () => {
    it('should return false if temporary message not found', async () => {
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);

      const result = await messageVerifier.checkAppTemporaryMessageExistence('hash123');

      expect(result).to.be.false;
    });

    it('should return temporary message if found', async () => {
      const mockMessage = { hash: 'hash123', appSpecifications: {} };
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(mockMessage);

      const result = await messageVerifier.checkAppTemporaryMessageExistence('hash123');

      expect(result).to.equal(mockMessage);
    });
  });

  describe('checkAndRequestApp', () => {
    let getPreviousAppSpecsStub;
    let signatureVerifierStub;
    let storeAppPermanentMessageStub;
    let isDaemonSyncedStub;
    let updateAppSpecificationsStub;
    let updateOneInDatabaseStub;
    let verifierWithStubs;

    beforeEach(() => {
      getPreviousAppSpecsStub = sinon.stub();
      signatureVerifierStub = { verifySignature: sinon.stub().returns(true) };
      storeAppPermanentMessageStub = sinon.stub().resolves();
      updateOneInDatabaseStub = sinon.stub().resolves();
      isDaemonSyncedStub = sinon.stub().returns({ data: { height: 2000000, synced: true } });
      updateAppSpecificationsStub = sinon.stub().resolves();

      const mockDb = { db: sinon.stub().returns('database') };

      const fullServiceHelperStub = {
        ensureNumber: sinon.stub().returnsArg(0),
        ensureString: sinon.stub().returnsArg(0),
        delay: sinon.stub().resolves(),
        axiosGet: sinon.stub().resolves(),
      };

      verifierWithStubs = proxyquire('../../ZelBack/src/services/appMessaging/messageVerifier', {
        config: {
          ...configStub,
          database: {
            ...configStub.database,
            url: 'mongodb://localhost:27017',
            daemon: { database: 'daemondb' },
          },
          fluxapps: {
            epochstart: 694000,
            daemonPONFork: 2020000,
          },
        },
        '../dbHelper': {
          ...dbHelperStub,
          databaseConnection: sinon.stub().returns(mockDb),
          findOneInDatabase: sinon.stub()
            .onFirstCall().resolves(null) // checkAppMessageExistence — not in permanent
            .onSecondCall().resolves({ // checkAppTemporaryMessageExistence — found in temp
              type: 'fluxappupdate',
              version: 1,
              appSpecifications: { name: 'testapp', version: 8, owner: 'newOwner' },
              hash: 'hash123',
              timestamp: Date.now(),
              signature: 'sig123',
            }),
          findInDatabase: sinon.stub().resolves([]),
          updateOneInDatabase: updateOneInDatabaseStub,
          insertOneToDatabase: sinon.stub().resolves(),
        },
        '../serviceHelper': fullServiceHelperStub,
        '../../lib/log': logStub,
        '../utils/appConstants': {
          globalAppsMessages: 'appsMessages',
          globalAppsTempMessages: 'appsTempMessages',
          globalAppsLocations: 'appsLocations',
          globalAppsInstallingLocations: 'appsInstallingLocations',
          appsHashesCollection: 'appsHashes',
          scannedHeightCollection: 'scannedHeight',
          globalAppsInformation: 'appsInformation',
        },
        '../signatureVerifier': signatureVerifierStub,
        '../daemonService/daemonServiceMiscRpcs': {
          isDaemonSynced: isDaemonSyncedStub,
          getBlock: sinon.stub().resolves({}),
        },
        '../appLifecycle/advancedWorkflows': {
          getPreviousAppSpecifications: getPreviousAppSpecsStub,
        },
        '../appDatabase/registryManager': {
          updateAppSpecifications: updateAppSpecificationsStub,
        },
        './messageStore': {
          storeAppPermanentMessage: storeAppPermanentMessageStub,
          storeAppTemporaryMessage: sinon.stub().resolves(),
        },
        '../utils/appUtilities': {
          appPricePerMonth: sinon.stub().returns(1000),
        },
        '../utils/chainUtilities': {
          getChainParamsPriceUpdates: sinon.stub().resolves([{ height: 0, minPrice: 1 }]),
          getChainTeamSupportAddressUpdates: sinon.stub().returns([]),
        },
        '../utils/enterpriseHelper': {
          checkAndDecryptAppSpecs: sinon.stub().returnsArg(0),
        },
        '../messageHelper': {
          createDataMessage: sinon.stub(),
          createErrorMessage: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../generalService': {
          getApplicationGlobalSpecifications: sinon.stub().resolves({}),
        },
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
        },
        '../fluxNetworkHelper': {
          getNumberOfPeers: sinon.stub().returns(10),
        },
        'bitcoinjs-message': {
          verify: sinon.stub().returns(true),
        },
        '../daemonService/daemonServiceControlRpcs': {
          validateAddress: sinon.stub().resolves({ data: { isvalid: true } }),
        },
      });
    });

    it('should refuse promotion when signature re-verification fails (ownership change race)', async () => {
      // getPreviousAppSpecifications returns the NEW owner (after a prior ownership change was promoted)
      getPreviousAppSpecsStub.resolves({ owner: 'newOwner', version: 8 });
      // Signature verification will fail — message was signed by old owner
      signatureVerifierStub.verifySignature.returns(false);

      const result = await verifierWithStubs.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

      expect(result).to.be.false;
      expect(storeAppPermanentMessageStub.called).to.be.false;
      expect(logStub.warn.calledOnce).to.be.true;
      expect(logStub.warn.firstCall.args[0]).to.include('Promotion re-verification failed');
    });

    it('should promote when signature re-verification passes', async () => {
      // getPreviousAppSpecifications returns the owner — signature matches
      getPreviousAppSpecsStub.resolves({ owner: 'correctOwner', version: 8 });
      signatureVerifierStub.verifySignature.returns(true);

      await verifierWithStubs.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

      expect(storeAppPermanentMessageStub.called).to.be.true;
    });
  });

  describe('exported functions', () => {
    it('should export verification functions', () => {
      expect(messageVerifier.checkAppMessageExistence).to.be.a('function');
      expect(messageVerifier.checkAppTemporaryMessageExistence).to.be.a('function');
      expect(messageVerifier.verifyAppHash).to.be.a('function');
      expect(messageVerifier.verifyAppMessageSignature).to.be.a('function');
    });
  });
});
