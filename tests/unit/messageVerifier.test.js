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
      debug: sinon.stub(),
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
        '../appDatabase/registryManager': {
          updateAppSpecifications: updateAppSpecificationsStub,
          getPreviousAppSpecifications: getPreviousAppSpecsStub,
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

    it('should export isExpireOnlyUpdate', () => {
      expect(messageVerifier.isExpireOnlyUpdate).to.be.a('function');
    });
  });

  describe('isExpireOnlyUpdate', () => {
    it('should return true when specs differ only in enterprise and expire', () => {
      const specA = {
        version: 8,
        name: 'testapp',
        owner: 'owner1',
        description: 'desc',
        compose: [{ name: 'comp1', repotag: 'repo/tag:latest' }],
        expire: 100000,
        enterprise: 'encryptedBlobA',
      };
      const specB = {
        version: 8,
        name: 'testapp',
        owner: 'owner1',
        description: 'desc',
        compose: [{ name: 'comp1', repotag: 'repo/tag:latest' }],
        expire: 200000,
        enterprise: 'encryptedBlobB',
      };

      const result = messageVerifier.isExpireOnlyUpdate(specA, specB);
      expect(result).to.be.true;
    });

    it('should return false when specs differ in fields other than expire/enterprise/height/hash', () => {
      const specA = {
        version: 8,
        name: 'testapp',
        owner: 'owner1',
        description: 'desc',
        compose: [{ name: 'comp1', repotag: 'repo/tag:latest' }],
        expire: 100000,
        enterprise: 'encryptedBlobA',
      };
      const specB = {
        version: 8,
        name: 'testapp',
        owner: 'owner2',
        description: 'desc',
        compose: [{ name: 'comp1', repotag: 'repo/tag:latest' }],
        expire: 200000,
        enterprise: 'encryptedBlobB',
      };

      const result = messageVerifier.isExpireOnlyUpdate(specA, specB);
      expect(result).to.be.false;
    });

    it('should return false when existingSpec is null', () => {
      const specA = { version: 8, name: 'testapp', expire: 100000 };
      const result = messageVerifier.isExpireOnlyUpdate(specA, null);
      expect(result).to.be.false;
    });

    it('should return false when newSpec is null', () => {
      const specB = { version: 8, name: 'testapp', expire: 100000 };
      const result = messageVerifier.isExpireOnlyUpdate(null, specB);
      expect(result).to.be.false;
    });
  });

  describe('verifyAppMessageUpdateSignature', () => {
    let signatureVerifierStub;
    let chainUtilitiesStub;
    let fluxServiceStub;
    let enterpriseHelperStub;
    let appUtilitiesStub;
    let verifierModule;

    beforeEach(() => {
      signatureVerifierStub = { verifySignature: sinon.stub().returns(false) };
      chainUtilitiesStub = {
        getChainParamsPriceUpdates: sinon.stub().returns([]),
        getChainTeamSupportAddressUpdates: sinon.stub().returns([
          { height: 1000000, address: '1FluxTeamAddr' },
        ]),
      };
      fluxServiceStub = { isSystemSecure: sinon.stub().resolves(false) };
      enterpriseHelperStub = { checkAndDecryptAppSpecs: sinon.stub().returnsArg(0) };
      appUtilitiesStub = {
        appPricePerMonth: sinon.stub().returns(1000),
        specificationFormatter: sinon.stub().returnsArg(0),
      };

      verifierModule = proxyquire('../../ZelBack/src/services/appMessaging/messageVerifier', {
        config: {
          ...configStub,
          fluxapps: {
            usersToExtend: ['1UserToExtendAddr'],
          },
        },
        '../dbHelper': dbHelperStub,
        '../serviceHelper': serviceHelperStub,
        '../../lib/log': logStub,
        '../utils/appConstants': {
          globalAppsMessages: 'appsMessages',
          globalAppsTempMessages: 'appsTempMessages',
        },
        'bitcoinjs-message': { verify: sinon.stub().returns(true) },
        '../daemonService/daemonServiceControlRpcs': {
          validateAddress: sinon.stub().resolves({ data: { isvalid: true } }),
        },
        './messageStore': { storeAppTemporaryMessage: sinon.stub().resolves() },
        '../messageHelper': {
          createDataMessage: sinon.stub(),
          createErrorMessage: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
          verifyMessage: sinon.stub().returns(false),
        },
        '../generalService': {
          getApplicationGlobalSpecifications: sinon.stub().resolves({}),
          messageHash: sinon.stub().resolves('hash'),
        },
        '../signatureVerifier': signatureVerifierStub,
        '../fluxCommunicationMessagesSender': {
          broadcastMessageToOutgoing: sinon.stub().resolves(),
          broadcastMessageToIncoming: sinon.stub().resolves(),
          broadcastMessageToAll: sinon.stub().resolves(),
        },
        '../daemonService/daemonServiceMiscRpcs': {
          getBlock: sinon.stub().resolves({}),
        },
        '../utils/appUtilities': appUtilitiesStub,
        '../utils/chainUtilities': chainUtilitiesStub,
        '../appDatabase/registryManager': {
          updateAppSpecifications: sinon.stub().resolves(),
          getPreviousAppSpecifications: sinon.stub().resolves(null),
        },
        '../fluxNetworkHelper': {
          getNumberOfPeers: sinon.stub().returns(10),
        },
        '../utils/enterpriseHelper': enterpriseHelperStub,
        '../fluxService': fluxServiceStub,
        '../utils/globalState': {},
      });
    });

    it('should verify v7 marketplace app signature against fluxSupportTeamFluxID (secrets/repoauth swap)', async () => {
      // First call: owner verification fails
      // Second call: fluxSupportTeamFluxID verification with original order fails
      // Third call: owner verification with swapped order fails
      // Fourth call: fluxSupportTeamFluxID with swapped order succeeds
      signatureVerifierStub.verifySignature
        .onCall(0).returns(false) // owner, original order
        .onCall(1).returns(false) // team support, original order (marketplace)
        .onCall(2).returns(false) // owner, swapped order
        .onCall(3).returns(true); // team support, swapped order (marketplace)

      const appSpec = {
        version: 7,
        name: 'MarketplaceApp1700000000000',
        owner: 'ownerAddr',
        compose: [
          { name: 'comp1', repotag: 'repo/tag', repoauth: 'auth', secrets: 'sec' },
        ],
      };

      const result = await verifierModule.verifyAppMessageUpdateSignature(
        'fluxappupdate', 7, appSpec, Date.now(), 'someSig', 'ownerAddr', 2000000, null,
      );
      expect(result).to.be.true;
      // The 4th call should use fluxSupportTeamFluxID
      expect(signatureVerifierStub.verifySignature.getCall(3).args[1]).to.equal('1FluxTeamAddr');
    });

    it('should skip isExpireOnlyUpdate and accept signature when isSystemSecure is false for enterprise v8', async () => {
      // Owner and team support fail — only userToExtend matches
      signatureVerifierStub.verifySignature
        .returns(false)
        .withArgs(sinon.match.string, '1UserToExtendAddr', sinon.match.string).returns(true);

      fluxServiceStub.isSystemSecure.resolves(false);

      const appSpec = {
        version: 8,
        name: 'enterpriseApp',
        owner: 'ownerAddr',
        enterprise: 'encryptedBlob',
      };
      const previousAppSpec = {
        version: 8,
        name: 'enterpriseApp',
        owner: 'ownerAddr',
        enterprise: 'encryptedBlobOld',
      };

      // When isSystemSecure is false, canCompareSpecs is false, so the function
      // accepts the signature without requiring isExpireOnlyUpdate to return true
      const result = await verifierModule.verifyAppMessageUpdateSignature(
        'fluxappupdate', 8, appSpec, Date.now(), 'someSig', 'ownerAddr', 2000000, previousAppSpec,
      );
      expect(result).to.be.true;
      // checkAndDecryptAppSpecs should NOT have been called since isSystemSecure returned false
      expect(enterpriseHelperStub.checkAndDecryptAppSpecs.called).to.be.false;
    });

    it('should call isExpireOnlyUpdate when isSystemSecure is true for enterprise v8 usersToExtend', async () => {
      // Owner and team support fail — only userToExtend matches
      signatureVerifierStub.verifySignature
        .returns(false)
        .withArgs(sinon.match.string, '1UserToExtendAddr', sinon.match.string).returns(true);

      fluxServiceStub.isSystemSecure.resolves(true);
      // The decrypted spec should be identical to the previous one (expire-only change)
      const decryptedSpec = {
        version: 8,
        name: 'enterpriseApp',
        owner: 'ownerAddr',
        expire: 300000,
      };
      enterpriseHelperStub.checkAndDecryptAppSpecs.resolves(decryptedSpec);
      appUtilitiesStub.specificationFormatter.returnsArg(0);

      const appSpec = {
        version: 8,
        name: 'enterpriseApp',
        owner: 'ownerAddr',
        enterprise: 'encryptedBlob',
        expire: 300000,
      };
      const previousAppSpec = {
        version: 8,
        name: 'enterpriseApp',
        owner: 'ownerAddr',
        expire: 200000,
      };

      const result = await verifierModule.verifyAppMessageUpdateSignature(
        'fluxappupdate', 8, appSpec, Date.now(), 'someSig', 'ownerAddr', 2000000, previousAppSpec,
      );
      expect(result).to.be.true;
      expect(enterpriseHelperStub.checkAndDecryptAppSpecs.calledOnce).to.be.true;
      expect(appUtilitiesStub.specificationFormatter.calledOnce).to.be.true;
    });
  });
});
