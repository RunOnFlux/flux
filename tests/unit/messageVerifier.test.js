const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { expect } = require('chai');
const express = require('express');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const globalState = require('../../ZelBack/src/services/utils/globalState');

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
        storeAppSpecificationInForce: sinon.stub().resolves(),
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
    let storeAppSpecificationInForceStub;
    let updateOneInDatabaseStub;
    let verifierWithStubs;
    let buildVerifier;
    let storeAppTemporaryMessageStub;

    beforeEach(() => {
      storeAppTemporaryMessageStub = sinon.stub().resolves();
      getPreviousAppSpecsStub = sinon.stub();
      signatureVerifierStub = { verifySignature: sinon.stub().returns(true) };
      storeAppPermanentMessageStub = sinon.stub().resolves();
      updateOneInDatabaseStub = sinon.stub().resolves();
      isDaemonSyncedStub = sinon.stub().returns({ data: { height: 2000000, synced: true } });
      storeAppSpecificationInForceStub = sinon.stub().resolves();

      const mockDb = { db: sinon.stub().returns('database') };

      const fullServiceHelperStub = {
        ensureNumber: sinon.stub().returnsArg(0),
        ensureString: sinon.stub().returnsArg(0),
        delay: sinon.stub().resolves(),
        axiosGet: sinon.stub().resolves(),
      };

      buildVerifier = ({
        tempMessage, dbHelperOverrides = {}, registryManagerOverrides = {},
        paymentRecord = { txid: 'txid123', height: 2000000, value: 200000000 },
      } = {}) => proxyquire('../../ZelBack/src/services/appMessaging/messageVerifier', {
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
            .onFirstCall().resolves(paymentRecord) // paymentRecordOf — this node's record of the payment
            .onSecondCall().resolves(null) // checkAppMessageExistence — not in permanent
            .onThirdCall().resolves(tempMessage || { // checkAppTemporaryMessageExistence — found in temp
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
          ...dbHelperOverrides,
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
          storeAppSpecificationInForce: storeAppSpecificationInForceStub,
          getPreviousAppSpecifications: getPreviousAppSpecsStub,
          isGoverningAppMessage: sinon.stub().resolves(true),
          ...registryManagerOverrides,
        },
        './messageStore': {
          storeAppPermanentMessage: storeAppPermanentMessageStub,
          storeAppTemporaryMessage: storeAppTemporaryMessageStub,
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
        '../daemonService/daemonServiceControlRpcs': {
          validateAddress: sinon.stub().resolves({ data: { isvalid: true } }),
        },
      });
      verifierWithStubs = buildVerifier();
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
      // re-verified against what was below its own block, never by its signer's timestamp
      sinon.assert.calledWith(getPreviousAppSpecsStub, sinon.match({ name: 'testapp' }), 2000000, sinon.match.number);
    });

    describe('a registry row that could not be written', () => {
      const registration = {
        type: 'fluxappregister',
        version: 1,
        appSpecifications: { name: 'testapp', version: 8, owner: 'owner1' },
        hash: 'hash123',
        timestamp: Date.now(),
        signature: 'sig123',
      };
      // appPricePerMonth is stubbed at 1000 FLUX, so a registration is paid in full at that
      const paidInFull = { txid: 'txid123', height: 2000000, value: 1000 * 1e8 };
      const markedResolved = () => updateOneInDatabaseStub.getCalls()
        .some((call) => call.args[1] === 'appsHashes' && call.args[3]?.$set?.message === true);

      it('leaves the hash unresolved, so the promotion is completed later', async () => {
        storeAppSpecificationInForceStub.rejects(new Error('connection timed out'));
        const verifier = buildVerifier({ tempMessage: registration, paymentRecord: paidInFull });

        const result = await verifier.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

        expect(storeAppPermanentMessageStub.called, 'the fixture never reached the promotion').to.be.true;
        expect(result).to.equal(false);
        expect(markedResolved(), 'the hash was resolved over a registry row that was never written').to.be.false;
      });

      it('marks the hash once the row is written', async () => {
        const verifier = buildVerifier({ tempMessage: registration, paymentRecord: paidInFull });

        const result = await verifier.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

        expect(result).to.equal(true);
        expect(markedResolved()).to.be.true;
        expect(storeAppSpecificationInForceStub.calledBefore(updateOneInDatabaseStub)).to.be.true;
      });

      describe('the updates queued behind it', () => {
        const queuedUpdate = (hash) => ({
          message: { type: 'fluxappupdate', hash, appSpecifications: { name: 'testapp' } }, height: 2000001, release: sinon.stub(),
        });

        it('replays each, and gives back each one\'s place in its sender\'s allowance once every replay has run', async () => {
          const queued = [queuedUpdate('u1'), queuedUpdate('u2')];
          sinon.stub(globalState, 'getPendingUpdates').returns(queued);
          const verifier = buildVerifier({ tempMessage: registration, paymentRecord: paidInFull });

          await verifier.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

          sinon.assert.calledTwice(storeAppTemporaryMessageStub);
          sinon.assert.calledWithExactly(storeAppTemporaryMessageStub.firstCall, queued[0].message, { authenticated: true });
          queued.forEach(({ release }) => {
            sinon.assert.calledOnce(release);
            expect(release.firstCall.callId, 'a place was given back before its replay took one').to.be.above(storeAppTemporaryMessageStub.secondCall.callId);
          });
        });

        it('gives back the place of every queued update when one fails and the rest are dropped', async () => {
          const queued = [queuedUpdate('u1'), queuedUpdate('u2'), queuedUpdate('u3')];
          sinon.stub(globalState, 'getPendingUpdates').returns(queued);
          storeAppTemporaryMessageStub.onSecondCall().rejects(new Error('not valid'));
          const verifier = buildVerifier({ tempMessage: registration, paymentRecord: paidInFull });

          await verifier.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

          sinon.assert.calledTwice(storeAppTemporaryMessageStub);
          queued.forEach(({ release }) => sinon.assert.calledOnce(release));
        });
      });

      it('writes the row of a stored message when its hash is resolved again', async () => {
        const stored = {
          hash: 'hash123', txid: 'txid123', height: 2000000, valueSat: 200000000, appSpecifications: { name: 'testapp' },
        };
        const verifier = buildVerifier({
          dbHelperOverrides: {
            findOneInDatabase: sinon.stub()
              .onFirstCall().resolves({ txid: 'txid123', height: 2000000, value: 200000000 })
              .onSecondCall().resolves(stored), // checkAppMessageExistence - held permanently
            findInDatabase: sinon.stub().resolves([stored]),
          },
          registryManagerOverrides: {
            governingAppMessage: sinon.stub().resolves({ appSpecifications: { name: 'testapp' }, hash: 'hash123', height: 2000000 }),
          },
        });

        const result = await verifier.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

        expect(result).to.equal(true);
        sinon.assert.calledWithMatch(storeAppSpecificationInForceStub, { name: 'testapp', hash: 'hash123', height: 2000000 });
        expect(markedResolved()).to.be.true;
        expect(storeAppSpecificationInForceStub.calledBefore(updateOneInDatabaseStub), 'the hash was resolved before its row was written').to.be.true;
      });
    });

    describe('the payment a message is placed by', () => {
      it('should store the message at this node\'s record of its payment, not the caller\'s', async () => {
        getPreviousAppSpecsStub.resolves({ owner: 'correctOwner', version: 8 });
        const verifier = buildVerifier({ paymentRecord: { txid: 'recordedtx', height: 2000000, value: 300000000 } });

        await verifier.checkAndRequestApp('hash123', 'othertx', 2000000, 100000000);

        sinon.assert.calledWith(storeAppPermanentMessageStub, sinon.match({ txid: 'recordedtx', height: 2000000, valueSat: 300000000 }));
      });

      it('should look the payment up among the payments on the chain only', async () => {
        const findOneInDatabase = sinon.stub().resolves(null);
        const verifier = buildVerifier({ dbHelperOverrides: { findOneInDatabase } });

        const result = await verifier.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

        expect(result).to.equal(false);
        expect(findOneInDatabase.firstCall.args[2]).to.deep.equal({ hash: 'hash123', notOnChain: { $ne: true } });
      });

      it('should store nothing for a hash this node has no payment recorded for', async () => {
        const verifier = buildVerifier({ paymentRecord: null });

        const result = await verifier.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

        expect(result).to.equal(false);
        expect(storeAppPermanentMessageStub.called).to.equal(false);
      });

      it('should leave the hash unresolved when its payment record cannot be read', async () => {
        const findOneInDatabase = sinon.stub().rejects(new Error('connection timed out'));
        const verifier = buildVerifier({ dbHelperOverrides: { findOneInDatabase } });

        const result = await verifier.checkAndRequestApp('hash123', 'txid123', 2000000, 200000000);

        expect(result).to.equal(false);
        expect(storeAppPermanentMessageStub.called).to.equal(false);
      });
    });

    describe('an update that has expired by itself', () => {
      // stored at 1999000 with expire 10: long expired at daemon height 2000000
      const expiredUpdate = {
        type: 'fluxappupdate',
        version: 1,
        appSpecifications: {
          name: 'testapp', version: 8, owner: 'correctOwner', expire: 10,
        },
        hash: 'oldhash',
        timestamp: Date.now(),
        signature: 'sig123',
      };
      let findOneAndDeleteStub;

      let findOne;

      beforeEach(() => {
        getPreviousAppSpecsStub.resolves({ owner: 'correctOwner', version: 8 });
        findOneAndDeleteStub = sinon.stub().resolves();
        findOne = sinon.stub();
        findOne.onCall(0).resolves({ txid: 'txid123', height: 1999000, value: 200000000 }); // this node's payment record
        findOne.onCall(1).resolves(null); // not in permanent storage
        findOne.onCall(2).resolves(expiredUpdate); // found in temporary storage
        findOne.onCall(3).resolves({ name: 'testapp' }); // still in globalAppsInformation
        findOne.onCall(4).resolves(null); // not installed locally
      });

      it('should not end an app that a newer message keeps alive (old message fetched late)', async () => {
        const isNewest = sinon.stub().resolves(false);
        const verifier = buildVerifier({
          dbHelperOverrides: { findOneInDatabase: findOne, findOneAndDeleteInDatabase: findOneAndDeleteStub },
          registryManagerOverrides: { isGoverningAppMessage: isNewest },
        });

        const result = await verifier.checkAndRequestApp('oldhash', 'txid123', 1999000, 200000000);

        expect(result).to.be.true;
        sinon.assert.calledWith(isNewest, 'testapp', 'oldhash');
        expect(storeAppPermanentMessageStub.called).to.be.true;
        expect(findOneAndDeleteStub.called).to.be.false;
      });

      it('should clean up the app when it is the newest message', async () => {
        const verifier = buildVerifier({
          dbHelperOverrides: { findOneInDatabase: findOne, findOneAndDeleteInDatabase: findOneAndDeleteStub },
          registryManagerOverrides: { isGoverningAppMessage: sinon.stub().resolves(true) },
        });

        await verifier.checkAndRequestApp('oldhash', 'txid123', 1999000, 200000000);

        expect(findOneAndDeleteStub.calledOnce).to.be.true;
      });
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
          storeAppSpecificationInForce: sinon.stub().resolves(),
          getPreviousAppSpecifications: sinon.stub().resolves(null),
        },
        '../fluxNetworkHelper': {
          getNumberOfPeers: sinon.stub().returns(10),
        },
        '../utils/enterpriseHelper': enterpriseHelperStub,
        '../fluxService': fluxServiceStub,
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

    // A fork names the whole support team, so any of its addresses can sign. The
    // shape it names them in is not fixed: the forks already in force name a single
    // `address`, covered by the test above, and the ones added since name `addresses`.
    it('should accept a signature from any address in a fork that names a list', async () => {
      chainUtilitiesStub.getChainTeamSupportAddressUpdates.returns([
        { height: 1000000, addresses: ['1FirstAddr', '1SecondAddr', '1ThirdAddr'] },
      ]);
      signatureVerifierStub.verifySignature
        .returns(false)
        .withArgs(sinon.match.string, '1ThirdAddr', sinon.match.string).returns(true);

      const appSpec = {
        version: 7,
        name: 'MarketplaceApp1700000000000',
        owner: 'ownerAddr',
        compose: [{ name: 'comp1', repotag: 'repo/tag', repoauth: 'auth', secrets: 'sec' }],
      };

      const result = await verifierModule.verifyAppMessageUpdateSignature(
        'fluxappupdate', 7, appSpec, Date.now(), 'someSig', 'ownerAddr', 2000000, null,
      );
      expect(result).to.be.true;
    });

    // A fork replaces its predecessor rather than adding to it, and the one that
    // applies is the latest at or below the message's own block. This is what keeps
    // a message signed before a fork verifying the same way after it.
    it('should read the fork in force at the block, not the newest one', async () => {
      chainUtilitiesStub.getChainTeamSupportAddressUpdates.returns([
        { height: 1000000, address: '1OldAddr' },
        { height: 2500000, addresses: ['1OldAddr', '1NewAddr'] },
      ]);
      signatureVerifierStub.verifySignature
        .returns(false)
        .withArgs(sinon.match.string, '1NewAddr', sinon.match.string).returns(true);

      const appSpec = {
        version: 7,
        name: 'MarketplaceApp1700000000000',
        owner: 'ownerAddr',
        compose: [{ name: 'comp1', repotag: 'repo/tag', repoauth: 'auth', secrets: 'sec' }],
      };

      // Below the second fork, only the first is in force and 1NewAddr is nobody.
      let refused = false;
      try {
        await verifierModule.verifyAppMessageUpdateSignature(
          'fluxappupdate', 7, appSpec, Date.now(), 'someSig', 'ownerAddr', 2000000, null,
        );
      } catch (error) {
        refused = true;
      }
      expect(refused, '1NewAddr must not sign below the fork that names it').to.be.true;

      const result = await verifierModule.verifyAppMessageUpdateSignature(
        'fluxappupdate', 7, appSpec, Date.now(), 'someSig', 'ownerAddr', 3000000, null,
      );
      expect(result).to.be.true;
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

  describe('getAppsPermanentMessages, to a reader that takes nothing', () => {
    // 40 MB of answer: more than the socket buffers at both ends hold, so a reader that stops
    // reading leaves the server waiting for it.
    const PADDING = 'x'.repeat(10 * 1024);
    const ANSWER_MESSAGES = 4000;
    const answer = Array.from({ length: ANSWER_MESSAGES }, (_, i) => ({ hash: `h${i}`, padding: PADDING }));
    let server;

    afterEach(() => {
      server?.closeAllConnections();
      server?.close();
      server = null;
    });

    /**
     * Serves the route with the given reader limit, its messages read after `readMs`, and resolves
     * `responseClosed` with how long after the request the response closed.
     */
    async function serveAnswer(readerIdleMs, readMs = 0) {
      const findInDatabase = sinon.stub().callsFake(async () => {
        await new Promise((resolve) => { setTimeout(resolve, readMs); });
        return answer;
      });
      const verifier = proxyquire('../../ZelBack/src/services/appMessaging/messageVerifier', {
        config: { ...configStub, fluxapps: { messageReaderIdleMs: readerIdleMs } },
        '../dbHelper': { databaseConnection: () => ({ db: () => ({}) }), findInDatabase },
        '../../lib/log': logStub,
      });
      let closed;
      const responseClosed = new Promise((resolve) => { closed = resolve; });
      const app = express();
      app.get('/apps/permanentmessages', (req, res) => {
        const at = Date.now();
        res.once('close', () => closed(Date.now() - at));
        verifier.getAppsPermanentMessages(req, res);
      });
      server = http.createServer(app);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return { port: server.address().port, responseClosed };
    }

    async function readWhole(port) {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/apps/permanentmessages`, resolve).on('error', reject);
      });
      const chunks = [];
      // eslint-disable-next-line no-restricted-syntax
      for await (const chunk of res) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString());
    }

    it('closes the connection of a reader that takes nothing for messageReaderIdleMs', async function () {
      this.timeout(10000);
      const { port, responseClosed } = await serveAnswer(200);

      const reader = net.connect(port, '127.0.0.1');
      reader.on('error', () => {});
      reader.write('GET /apps/permanentmessages HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      reader.pause();

      const closedAfterMs = await responseClosed;
      reader.destroy();

      expect(closedAfterMs, 'closed before the reader had been waited on for the limit').to.be.at.least(200);
    });

    it('answers in full a reader that keeps reading', async function () {
      this.timeout(20000);
      const { port } = await serveAnswer(500);

      const body = await readWhole(port);

      expect(body.status).to.equal('success');
      expect(body.data).to.have.lengthOf(ANSWER_MESSAGES);
    });

    it('does not count the time this node spends reading the messages against the reader', async function () {
      this.timeout(20000);
      const { port } = await serveAnswer(200, 600);

      const body = await readWhole(port);

      expect(body.data).to.have.lengthOf(ANSWER_MESSAGES);
    });
  });
});
