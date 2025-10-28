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

  describe('exported functions', () => {
    it('should export verification functions', () => {
      expect(messageVerifier.checkAppMessageExistence).to.be.a('function');
      expect(messageVerifier.checkAppTemporaryMessageExistence).to.be.a('function');
      expect(messageVerifier.verifyAppHash).to.be.a('function');
      expect(messageVerifier.verifyAppMessageSignature).to.be.a('function');
    });
  });
});
