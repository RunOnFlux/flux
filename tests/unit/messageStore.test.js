const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('messageStore tests', () => {
  let messageStore;
  let dbHelperStub;
  let serviceHelperStub;
  let messageVerifierStub;
  let logStub;
  let configStub;

  beforeEach(() => {
    // Stubs
    dbHelperStub = {
      databaseConnection: sinon.stub(),
      findInDatabase: sinon.stub(),
      findOneInDatabase: sinon.stub(),
      insertOneToDatabase: sinon.stub(),
      updateOneInDatabase: sinon.stub(),
      updateInDatabase: sinon.stub(),
      removeDocumentsFromCollection: sinon.stub(),
      findOneAndDeleteInDatabase: sinon.stub(),
      countInDatabase: sinon.stub(),
    };

    serviceHelperStub = {
      ensureNumber: sinon.stub().returnsArg(0),
    };

    messageVerifierStub = {
      checkAppMessageExistence: sinon.stub(),
      checkAppTemporaryMessageExistence: sinon.stub(),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    configStub = {
      database: {
        daemon: {
          database: 'daemondb',
        },
        appsglobal: {
          database: 'appsdb',
          collections: {
            appsLocations: 'appsLocations',
            appStateEvents: 'appStateEvents',
            appsInstallingBroadcasts: 'appsInstallingBroadcasts',
            appsInstallingErrorsBroadcasts: 'appsInstallingErrorsBroadcasts',
          },
        },
      },
      fluxapps: {
        maxAppsPerNode: 200,
      },
    };

    // Proxy require
    messageStore = proxyquire('../../ZelBack/src/services/appMessaging/messageStore', {
      config: configStub,
      '../dbHelper': dbHelperStub,
      '../serviceHelper': serviceHelperStub,
      './messageVerifier': messageVerifierStub,
      '../../lib/log': logStub,
      '../daemonService/daemonServiceMiscRpcs': {
        isDaemonSynced: sinon.stub().returns({ data: { height: 1000 } }),
      },
      '../appRequirements/appValidator': {
        verifyAppSpecifications: sinon.stub().resolves(),
      },
      '../appDatabase/registryManager': {
        checkApplicationRegistrationNameConflicts: sinon.stub().resolves(),
        getPreviousAppSpecifications: sinon.stub().resolves({ owner: 'owner1' }),
      },
      '../appLifecycle/advancedWorkflows': {
        validateApplicationUpdateCompatibility: sinon.stub().resolves(),
      },
      '../utils/enterpriseHelper': {
        checkAndDecryptAppSpecs: sinon.stub().resolves({}),
      },
      '../utils/appConstants': {
        globalAppsMessages: 'appsMessages',
        globalAppsTempMessages: 'appsTempMessages',
        globalAppsLocations: 'appsLocations',
        globalAppsInstallingLocations: 'appsInstallingLocations',
        globalAppsInstallingErrorsLocations: 'appsInstallingErrorsLocations',
        globalAppsInstallingErrorsBroadcasts: 'appsInstallingErrorsBroadcasts',
        globalAppStateEvents: 'appStateEvents',
        appsHashesCollection: 'appsHashes',
        GOSSIP_VALIDITY_MS: 5 * 60 * 1000,
        RUNNING_EXPIRY_MS: 125 * 60 * 1000,
        INSTALLING_EXPIRY_MS: 15 * 60 * 1000,
        INSTALLING_ERRORS_EXPIRY_MS: 24 * 60 * 60 * 1000,
        SIGTERM_EXPIRY_MS: 420 * 1000,
        EVICTED_EXPIRY_MS: 125 * 60 * 1000,
      },
      '../utils/appSpecHelpers': {
        specificationFormatter: sinon.stub().returnsArg(0),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('storeAppTemporaryMessage', () => {
    it('should return error for invalid message structure', async () => {
      const invalidMessage = { type: 'test' };

      const result = await messageStore.storeAppTemporaryMessage(invalidMessage);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Invalid Flux App message');
    });

    it('should return false if message already exists in permanent storage', async () => {
      const message = {
        type: 'fluxappregister',
        version: 1,
        appSpecifications: { name: 'test' },
        hash: 'hash123',
        timestamp: Date.now(),
        signature: 'sig123',
      };

      messageVerifierStub.checkAppMessageExistence.resolves({ hash: 'hash123' });
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);

      const result = await messageStore.storeAppTemporaryMessage(message);

      expect(result).to.be.false;
      expect(dbHelperStub.insertOneToDatabase.called).to.be.false;
    });

    it('should return false if message already exists in temporary storage', async () => {
      const message = {
        type: 'fluxappregister',
        version: 1,
        appSpecifications: { name: 'test' },
        hash: 'hash123',
        timestamp: Date.now(),
        signature: 'sig123',
      };

      messageVerifierStub.checkAppMessageExistence.resolves(null);
      messageVerifierStub.checkAppTemporaryMessageExistence.resolves({ hash: 'hash123' });
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);

      const result = await messageStore.storeAppTemporaryMessage(message);

      expect(result).to.be.false;
      expect(dbHelperStub.insertOneToDatabase.called).to.be.false;
    });

    it('should store new temporary message and return true', async () => {
      const message = {
        type: 'fluxappregister',
        version: 1,
        appSpecifications: { name: 'test' },
        hash: 'hash123',
        timestamp: Date.now(),
        signature: 'sig123',
      };

      messageVerifierStub.checkAppMessageExistence.resolves(null);
      messageVerifierStub.checkAppTemporaryMessageExistence.resolves(null);
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);
      dbHelperStub.insertOneToDatabase.resolves();

      const result = await messageStore.storeAppTemporaryMessage(message, { furtherVerification: false });

      expect(result).to.be.true;
      expect(dbHelperStub.insertOneToDatabase.calledOnce).to.be.true;
    });

    it('should handle database errors gracefully', async () => {
      const message = {
        type: 'fluxappregister',
        version: 1,
        appSpecifications: { name: 'test' },
        hash: 'hash123',
        timestamp: Date.now(),
        signature: 'sig123',
      };
      const error = new Error('Database error');

      messageVerifierStub.checkAppMessageExistence.resolves(null);
      messageVerifierStub.checkAppTemporaryMessageExistence.resolves(null);
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);
      dbHelperStub.insertOneToDatabase.rejects(error);

      try {
        await messageStore.storeAppTemporaryMessage(message, { furtherVerification: false });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err).to.equal(error);
        expect(logStub.error.calledWith(error)).to.be.true;
      }
    });

    it('should not enforce version upgrade policy (enforced at API layer)', async () => {
      const message = {
        type: 'fluxappupdate',
        version: 1,
        appSpecifications: { name: 'test', version: 6 },
        hash: 'hash123',
        timestamp: Date.now(),
        signature: 'sig123',
      };

      messageVerifierStub.checkAppMessageExistence.resolves(null);
      messageVerifierStub.checkAppTemporaryMessageExistence.resolves(null);
      messageVerifierStub.verifyAppHash = sinon.stub().resolves();
      messageVerifierStub.verifyAppMessageUpdateSignature = sinon.stub().resolves();
      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);
      dbHelperStub.insertOneToDatabase.resolves();

      messageStore = proxyquire('../../ZelBack/src/services/appMessaging/messageStore', {
        config: configStub,
        '../dbHelper': dbHelperStub,
        '../serviceHelper': serviceHelperStub,
        './messageVerifier': messageVerifierStub,
        '../../lib/log': logStub,
        '../daemonService/daemonServiceMiscRpcs': {
          isDaemonSynced: sinon.stub().returns({ data: { height: 1000 } }),
        },
        '../appRequirements/appValidator': {
          verifyAppSpecifications: sinon.stub().resolves(),
        },
        '../appDatabase/registryManager': {
          checkApplicationRegistrationNameConflicts: sinon.stub().resolves(),
          getPreviousAppSpecifications: sinon.stub().resolves({ owner: 'owner1', version: 5 }),
        },
        '../appLifecycle/advancedWorkflows': {
          validateApplicationUpdateCompatibility: sinon.stub().resolves(),
        },
        '../utils/enterpriseHelper': {
          checkAndDecryptAppSpecs: sinon.stub().resolves({}),
        },
        '../utils/globalState': {
          queuePendingUpdate: sinon.stub(),
        },
        '../utils/appConstants': {
          globalAppsMessages: 'appsMessages',
          globalAppsTempMessages: 'appsTempMessages',
          globalAppsLocations: 'appsLocations',
          globalAppsInstallingLocations: 'appsInstallingLocations',
          globalAppsInstallingErrorsLocations: 'appsInstallingErrorsLocations',
          appsHashesCollection: 'appsHashes',
        },
        '../utils/appSpecHelpers': {
          specificationFormatter: sinon.stub().returnsArg(0),
        },
      });

      // v5→v6 update should be accepted — version policy is enforced at API layer, not here
      const result = await messageStore.storeAppTemporaryMessage(message);

      expect(result).to.be.true;
      expect(dbHelperStub.insertOneToDatabase.calledOnce).to.be.true;
    });
  });

  describe('storeAppPermanentMessage', () => {
    it('should throw error for invalid message structure', async () => {
      const invalidMessage = { type: 'test' };

      try {
        await messageStore.storeAppPermanentMessage(invalidMessage);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Invalid Flux App message');
      }
    });

    it('should store valid permanent message', async () => {
      const message = {
        type: 'fluxappregister',
        version: 1,
        appSpecifications: { name: 'test' },
        hash: 'hash123',
        timestamp: Date.now(),
        signature: 'sig123',
        txid: 'txid123',
        height: 1000,
        valueSat: 10000,
      };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.insertOneToDatabase.resolves();

      const result = await messageStore.storeAppPermanentMessage(message);

      expect(result).to.be.true;
      expect(dbHelperStub.insertOneToDatabase.calledOnce).to.be.true;
    });
  });

  describe('storeAppRunningMessage', () => {
    it('should return error for invalid message structure', async () => {
      const invalidMessage = { type: 'fluxapprunning' };

      const result = await messageStore.storeAppRunningMessage(invalidMessage);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Invalid Flux App Running message');
    });

    it('should return error for unsupported version', async () => {
      const message = {
        type: 'fluxapprunning',
        version: 99,
        broadcastedAt: Date.now(),
        ip: '192.168.1.1',
      };

      const result = await messageStore.storeAppRunningMessage(message);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('version 99 not supported');
    });

    it('should return false for expired message', async () => {
      const message = {
        type: 'fluxapprunning',
        version: 1,
        name: 'testapp',
        hash: 'hash123',
        broadcastedAt: Date.now() - (200 * 60 * 1000), // 200 minutes ago
        ip: '192.168.1.1',
      };

      const result = await messageStore.storeAppRunningMessage(message);

      expect(result).to.deep.equal({ stored: false, rebroadcast: false });
      expect(logStub.warn.called).to.be.true;
    });

    it('should store valid version 1 running message', async () => {
      const message = {
        type: 'fluxapprunning',
        version: 1,
        name: 'testapp',
        hash: 'hash123',
        broadcastedAt: Date.now(),
        ip: '192.168.1.1',
      };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.updateOneInDatabase.resolves({ modifiedCount: 0, upsertedCount: 1 });
      dbHelperStub.removeDocumentsFromCollection.resolves();

      const result = await messageStore.storeAppRunningMessage(message);

      expect(result).to.deep.equal({ stored: true, rebroadcast: true });
      expect(dbHelperStub.updateOneInDatabase.calledOnce).to.be.true;
    });

    it('should store valid version 2 running message with multiple apps', async () => {
      const message = {
        type: 'fluxapprunning',
        version: 2,
        apps: [
          { name: 'app1', hash: 'hash1' },
          { name: 'app2', hash: 'hash2' },
        ],
        broadcastedAt: Date.now(),
        ip: '192.168.1.1',
      };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.updateOneInDatabase.resolves({ modifiedCount: 0, upsertedCount: 1 });
      dbHelperStub.removeDocumentsFromCollection.resolves();

      const result = await messageStore.storeAppRunningMessage(message);

      expect(result).to.deep.equal({ stored: true, rebroadcast: true });
      expect(dbHelperStub.updateOneInDatabase.callCount).to.equal(2);
      // Should clean up installing records for each app (location + broadcast per app)
      expect(dbHelperStub.removeDocumentsFromCollection.callCount).to.equal(4);
    });

    it('should handle version 2 message with empty apps array', async () => {
      const message = {
        type: 'fluxapprunning',
        version: 2,
        apps: [],
        broadcastedAt: Date.now(),
        ip: '192.168.1.1',
      };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves([{ name: 'app1' }]);
      dbHelperStub.removeDocumentsFromCollection.resolves();

      const result = await messageStore.storeAppRunningMessage(message);

      expect(result).to.deep.equal({ stored: true, rebroadcast: true });
      // Called three times: locations, installing locations, installing broadcasts
      expect(dbHelperStub.removeDocumentsFromCollection.callCount).to.equal(3);
    });
  });

  describe('storeAppInstallingMessage', () => {
    it('should return error for invalid message structure', async () => {
      const invalidMessage = { type: 'fluxappinstalling' };

      const result = await messageStore.storeAppInstallingMessage(invalidMessage);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Invalid Flux App Installing message');
    });

    it('should return error for unsupported version', async () => {
      const message = {
        type: 'fluxappinstalling',
        version: 3,
        name: 'testapp',
        broadcastedAt: Date.now(),
        ip: '192.168.1.1',
      };

      const result = await messageStore.storeAppInstallingMessage(message);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('version 3 not supported');
    });

    it('should store valid installing message', async () => {
      const message = {
        type: 'fluxappinstalling',
        version: 1,
        name: 'testapp',
        broadcastedAt: Date.now(),
        ip: '192.168.1.1',
      };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);
      dbHelperStub.updateOneInDatabase.resolves();

      const result = await messageStore.storeAppInstallingMessage(message);

      expect(result).to.be.true;
      expect(dbHelperStub.updateOneInDatabase.calledOnce).to.be.true;
    });
  });

  // A node claims an app before it knows whether it is needed, so losing the
  // race is ordinary and the claim has to be retractable. Version 2 is that
  // retraction - and it must never be an installing ERROR, which means an
  // install was attempted and failed, and is counted and acted on as such.
  describe('storeAppInstallingMessage - version 2 withdrawal', () => {
    const withdrawal = (overrides = {}) => ({
      type: 'fluxappinstalling',
      version: 2,
      name: 'testapp',
      ip: '192.168.1.1',
      broadcastedAt: Date.now(),
      withdrawn: true,
      ...overrides,
    });

    beforeEach(() => {
      dbHelperStub.databaseConnection.returns({ db: sinon.stub().returns('database') });
      dbHelperStub.removeDocumentsFromCollection.resolves();
    });

    it('removes the sender\'s claim and rebroadcasts', async () => {
      dbHelperStub.findOneInDatabase.resolves({ broadcastedAt: new Date(Date.now() - 60000) });

      const result = await messageStore.storeAppInstallingMessage(withdrawal());

      expect(result).to.be.true;
      const targets = dbHelperStub.removeDocumentsFromCollection.getCalls().map((c) => c.args[1]);
      expect(targets).to.have.lengthOf(2); // the claim, and its signed broadcast
      expect(dbHelperStub.updateOneInDatabase.called, 'a withdrawal records nothing').to.be.false;
    });

    it('never touches the installing errors collection', async () => {
      dbHelperStub.findOneInDatabase.resolves({ broadcastedAt: new Date(Date.now() - 60000) });

      await messageStore.storeAppInstallingMessage(withdrawal());

      const touched = dbHelperStub.removeDocumentsFromCollection.getCalls()
        .concat(dbHelperStub.updateOneInDatabase.getCalls())
        .map((c) => c.args[1]);
      expect(touched.some((col) => String(col).includes('errors'))).to.be.false;
    });

    // a node may claim, stand aside, and claim again - a withdrawal that arrives
    // after the newer claim must not erase it
    it('does not erase a claim broadcast after it', async () => {
      const sent = Date.now() - 60000;
      dbHelperStub.findOneInDatabase.resolves({ broadcastedAt: new Date(Date.now()) });

      const result = await messageStore.storeAppInstallingMessage(withdrawal({ broadcastedAt: sent }));

      expect(result).to.be.false;
      expect(dbHelperStub.removeDocumentsFromCollection.called).to.be.false;
    });

    it('applies when no claim is stored, so a withdrawal is never lost to ordering', async () => {
      dbHelperStub.findOneInDatabase.resolves(null);

      const result = await messageStore.storeAppInstallingMessage(withdrawal());

      expect(result).to.be.true;
      expect(dbHelperStub.removeDocumentsFromCollection.called).to.be.true;
    });

    it('refuses a version 2 message that is not a withdrawal', async () => {
      const result = await messageStore.storeAppInstallingMessage(withdrawal({ withdrawn: undefined }));

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('must be a withdrawal');
      expect(dbHelperStub.removeDocumentsFromCollection.called).to.be.false;
    });

    it('refuses a stale withdrawal', async () => {
      const result = await messageStore.storeAppInstallingMessage(
        withdrawal({ broadcastedAt: Date.now() - (48 * 60 * 60 * 1000) }),
      );

      expect(result).to.be.false;
      expect(dbHelperStub.removeDocumentsFromCollection.called).to.be.false;
    });
  });

  describe('storeBatchAppInstallingMessages - version 2 withdrawal', () => {
    // The batch path carries the same withdrawal rule as the single-message one
    // and had no coverage of its own, which is where the two came apart: the
    // location delete kept its "only if older" guard and the delete of the
    // broadcast backing it did not.
    let writes;

    const withdrawal = (broadcastedAt) => ({
      version: 2,
      timestamp: broadcastedAt,
      pubKey: 'pk',
      signature: 'sig',
      receivedAt: broadcastedAt,
      data: {
        version: 2, name: 'testapp', ip: '1.2.3.4:16127', withdrawn: true, broadcastedAt,
      },
    });

    beforeEach(() => {
      writes = [];
      const collection = (name) => ({
        bulkWrite: async (ops, options) => { writes.push({ name, ops, options }); return {}; },
      });
      dbHelperStub.databaseConnection.returns({ db: sinon.stub().returns({ collection }) });
    });

    const guardOf = (collectionName) => {
      const write = writes.find((w) => w.name === collectionName);
      expect(write, `nothing was written to ${collectionName}`).to.not.equal(undefined);
      return write.ops[0].deleteOne.filter.broadcastedAt;
    };

    it('guards the broadcast delete exactly as it guards the location delete', async () => {
      // A withdrawal that arrives after its sender has claimed again must erase
      // neither. Guarding only the location leaves the newer claim standing with
      // the signed message behind it gone, and nothing can serve it during sync.
      const sent = Date.now() - 60000;

      const result = await messageStore.storeBatchAppInstallingMessages([withdrawal(sent)]);

      expect(result.stored).to.equal(1);
      const locationGuard = guardOf('appsInstallingLocations');
      const broadcastGuard = guardOf('appsInstallingBroadcasts');
      expect(locationGuard).to.deep.equal({ $lt: new Date(sent) });
      expect(broadcastGuard).to.deep.equal(locationGuard);
    });

    it('addresses the broadcast by its nested name and ip', async () => {
      // The two collections shape their documents differently - the broadcast
      // carries the message under `data` - so the guard has to travel without
      // the rest of the filter travelling with it.
      const sent = Date.now() - 60000;

      await messageStore.storeBatchAppInstallingMessages([withdrawal(sent)]);

      const write = writes.find((w) => w.name === 'appsInstallingBroadcasts');
      expect(write.ops[0].deleteOne.filter['data.name']).to.equal('testapp');
      expect(write.ops[0].deleteOne.filter['data.ip']).to.equal('1.2.3.4:16127');
    });

    it('does not read a version 2 message without withdrawn as a withdrawal', async () => {
      // The single-message path refuses version 2 unless it is a withdrawal.
      // Reading the version alone here would let a message the protocol never
      // emits delete its sender's claim - the same one-rule-two-paths
      // divergence as the guard above, in the other field.
      const msg = withdrawal(Date.now() - 60000);
      delete msg.data.withdrawn;

      const result = await messageStore.storeBatchAppInstallingMessages([msg]);

      expect(result.stored).to.equal(0);
      expect(writes).to.have.length(0);
    });
  });

  describe('storeAppRemovedMessage', () => {
    it('should return error for invalid message structure', async () => {
      const invalidMessage = { type: 'fluxappremoved' };

      const result = await messageStore.storeAppRemovedMessage(invalidMessage);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Invalid Flux App Removed message');
    });

    it('should return error for empty appName', async () => {
      const message = {
        type: 'fluxappremoved',
        version: 1,
        appName: '',
        broadcastedAt: Date.now(),
        ip: '192.168.1.1',
      };

      const result = await messageStore.storeAppRemovedMessage(message);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('appName cannot be empty');
    });

    it('should store valid removed message and delete location', async () => {
      const message = {
        type: 'fluxappremoved',
        version: 1,
        appName: 'testapp',
        broadcastedAt: Date.now(),
        ip: '192.168.1.1',
      };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneAndDeleteInDatabase.resolves();

      const result = await messageStore.storeAppRemovedMessage(message);

      expect(result).to.be.true;
      expect(dbHelperStub.findOneAndDeleteInDatabase.calledOnce).to.be.true;
      expect(dbHelperStub.findOneAndDeleteInDatabase.firstCall.args[2]).to.deep.equal({
        ip: '192.168.1.1', name: 'testapp',
      });
    });
  });

  describe('storeAppInstallingErrorMessage', () => {
    it('should return error for invalid message structure', async () => {
      const invalidMessage = { type: 'fluxappinstallingerror' };

      const result = await messageStore.storeAppInstallingErrorMessage(invalidMessage);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Invalid Flux App Installing Error message');
    });

    it('should store valid error message and clean up installing record', async () => {
      const message = {
        type: 'fluxappinstallingerror',
        version: 1,
        name: 'testapp',
        hash: 'hash123',
        ip: '192.168.1.1',
        error: 'Installation failed',
        broadcastedAt: Date.now(),
      };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);
      dbHelperStub.updateOneInDatabase.resolves();
      dbHelperStub.removeDocumentsFromCollection.resolves();
      dbHelperStub.countInDatabase.resolves(1);

      const result = await messageStore.storeAppInstallingErrorMessage(message);

      expect(result).to.be.true;
      expect(dbHelperStub.updateOneInDatabase.calledOnce).to.be.true;
      // Should clean up installing record since installation failed (location + broadcast)
      expect(dbHelperStub.removeDocumentsFromCollection.callCount).to.equal(2);
      expect(dbHelperStub.removeDocumentsFromCollection.calledWith(
        'database',
        'appsInstallingLocations',
        { name: 'testapp', ip: '192.168.1.1' },
      )).to.be.true;
    });

    it('should update cache settings when error count reaches threshold', async () => {
      const message = {
        type: 'fluxappinstallingerror',
        version: 1,
        name: 'testapp',
        hash: 'hash123',
        ip: '192.168.1.1',
        error: 'Installation failed',
        broadcastedAt: Date.now(),
      };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findOneInDatabase.resolves(null);
      dbHelperStub.updateOneInDatabase.resolves();
      dbHelperStub.removeDocumentsFromCollection.resolves();
      dbHelperStub.countInDatabase.resolves(5);
      dbHelperStub.updateInDatabase.resolves();

      const result = await messageStore.storeAppInstallingErrorMessage(message);

      expect(result).to.be.true;
      expect(dbHelperStub.removeDocumentsFromCollection.callCount).to.equal(2);
    });
  });

  describe('storeIPChangedMessage', () => {
    it('should return error for invalid message structure', async () => {
      const invalidMessage = { type: 'fluxipchanged' };

      const result = await messageStore.storeIPChangedMessage(invalidMessage);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Invalid Flux IP Changed message');
    });

    it('should return error for empty IPs', async () => {
      const message = {
        type: 'fluxipchanged',
        version: 1,
        oldIP: '',
        newIP: '',
        broadcastedAt: Date.now(),
      };

      const result = await messageStore.storeIPChangedMessage(message);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('oldIP and newIP cannot be empty');
    });

    it('should return error when oldIP equals newIP', async () => {
      const message = {
        type: 'fluxipchanged',
        version: 1,
        oldIP: '192.168.1.1',
        newIP: '192.168.1.1',
        broadcastedAt: Date.now(),
      };

      const result = await messageStore.storeIPChangedMessage(message);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('oldIP and newIP are the same');
    });

    it('should store valid IP changed message', async () => {
      const message = {
        type: 'fluxipchanged',
        version: 1,
        oldIP: '192.168.1.1',
        newIP: '192.168.1.2',
        broadcastedAt: Date.now(),
      };

      const mockDb = { db: sinon.stub().returns('database') };
      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.updateInDatabase.resolves();

      const result = await messageStore.storeIPChangedMessage(message);

      expect(result).to.be.true;
      expect(dbHelperStub.updateInDatabase.calledOnce).to.be.true;
    });
  });

  describe('storeAppStateEvent', () => {
    let collectionStub;

    beforeEach(() => {
      collectionStub = { updateOne: sinon.stub().resolves({ modifiedCount: 1 }) };
      const mockDb = { db: sinon.stub().returns({ collection: sinon.stub().returns(collectionStub) }) };
      dbHelperStub.databaseConnection.returns(mockDb);
    });

    it('should store apprunning v2 event with correct dedupKey', async () => {
      const payload = {
        signedBroadcast: {
          version: 1, timestamp: Date.now(), pubKey: 'pk', signature: 'sig',
          data: { ip: '1.2.3.4', broadcastedAt: Date.now(), apps: [{ name: 'a', hash: 'h' }] },
        },
      };
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, payload);
      expect(collectionStub.updateOne.calledOnce).to.be.true;
      const filter = collectionStub.updateOne.firstCall.args[0];
      expect(filter.ip).to.equal('1.2.3.4');
      expect(filter.type).to.equal('apprunning');
      expect(filter.dedupKey).to.equal('v2');
    });

    it('should store apprunning v1 event with name in dedupKey', async () => {
      const payload = {
        signedBroadcast: {
          version: 1, timestamp: Date.now(), pubKey: 'pk', signature: 'sig',
          data: { ip: '1.2.3.4', broadcastedAt: Date.now(), name: 'myapp', hash: 'h' },
        },
      };
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, payload);
      expect(collectionStub.updateOne.calledOnce).to.be.true;
      const filter = collectionStub.updateOne.firstCall.args[0];
      expect(filter.dedupKey).to.equal('v1:myapp');
    });

    it('should store sigterm event', async () => {
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.SIGTERM, {
        message: { type: 'fluxnodesigterm', version: 1, ip: '1.2.3.4', broadcastedAt: Date.now() },
        envelope: { version: 1, timestamp: Date.now(), pubKey: 'pk', signature: 'sig' },
      });
      expect(collectionStub.updateOne.calledOnce).to.be.true;
      const filter = collectionStub.updateOne.firstCall.args[0];
      expect(filter.type).to.equal('sigterm');
      expect(filter.dedupKey).to.equal('sigterm');
    });

    it('should store appremoved event', async () => {
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPREMOVED, {
        message: { ip: '1.2.3.4', appName: 'myapp', broadcastedAt: Date.now() },
        envelope: { version: 1, timestamp: Date.now(), pubKey: 'pk', signature: 'sig' },
      });
      expect(collectionStub.updateOne.calledOnce).to.be.true;
      const filter = collectionStub.updateOne.firstCall.args[0];
      expect(filter.type).to.equal('appremoved');
      expect(filter.dedupKey).to.equal('appremoved:myapp');
    });

    it('should store evicted event with createdAt', async () => {
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.EVICTED, { ip: '1.2.3.4' });
      expect(collectionStub.updateOne.calledOnce).to.be.true;
      const filter = collectionStub.updateOne.firstCall.args[0];
      expect(filter.type).to.equal('evicted');
      expect(filter.dedupKey).to.equal('evicted');
      const update = collectionStub.updateOne.firstCall.args[1];
      expect(update.$set.createdAt).to.be.instanceOf(Date);
    });

    it('should reject expired apprunning events', async () => {
      const payload = {
        signedBroadcast: {
          version: 1, timestamp: Date.now(), pubKey: 'pk', signature: 'sig',
          data: { ip: '1.2.3.4', broadcastedAt: Date.now() - (130 * 60 * 1000), apps: [{ name: 'a', hash: 'h' }] },
        },
      };
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, payload);
      expect(collectionStub.updateOne.called).to.be.false;
    });
  });
  describe('storeBatchAppRunningMessages batching', () => {
    function buildBroadcasts(nodeCount, appsPerNode) {
      const broadcastedAt = Date.now();
      return Array.from({ length: nodeCount }, (_, n) => ({
        version: 1,
        timestamp: broadcastedAt,
        pubKey: 'pub',
        signature: 'sig',
        data: {
          type: 'fluxapprunning',
          version: 2,
          ip: `10.0.0.${n}:16127`,
          broadcastedAt,
          osUptime: 1000,
          staticIp: false,
          apps: Array.from({ length: appsPerNode }, (_, a) => ({
            name: `app${a}`,
            hash: `hash${n}-${a}`,
            runningSince: new Date(broadcastedAt).toISOString(),
          })),
        },
      }));
    }

    it('should write app locations in bounded batches rather than one giant bulk write', async () => {
      const locationBatches = [];
      const database = {
        collection: (name) => ({
          bulkWrite: (ops) => {
            if (name === 'appsLocations') locationBatches.push(ops);
            return Promise.resolve({});
          },
          updateOne: sinon.stub().resolves({}),
        }),
      };
      dbHelperStub.databaseConnection.returns({ db: sinon.stub().returns(database) });

      // 60 nodes x 20 apps = 1200 location operations
      await messageStore.storeBatchAppRunningMessages(buildBroadcasts(60, 20));

      expect(locationBatches.length).to.be.above(1);
      locationBatches.forEach((batch) => {
        expect(batch.length).to.be.at.most(500);
      });
    });

    it('should still write every location operation across the batches', async () => {
      const locationBatches = [];
      const database = {
        collection: (name) => ({
          bulkWrite: (ops) => {
            if (name === 'appsLocations') locationBatches.push(ops);
            return Promise.resolve({});
          },
          updateOne: sinon.stub().resolves({}),
        }),
      };
      dbHelperStub.databaseConnection.returns({ db: sinon.stub().returns(database) });

      await messageStore.storeBatchAppRunningMessages(buildBroadcasts(60, 20));

      const upserts = locationBatches.flat().filter((op) => op.updateOne);
      const prunes = locationBatches.flat().filter((op) => op.deleteMany);
      expect(upserts.length).to.equal(1200);
      expect(prunes.length).to.equal(60);
    });
  });
});
