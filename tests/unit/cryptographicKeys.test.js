const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');

describe('cryptographicKeys tests', () => {
  let req;
  let res;
  let cryptographicKeys;

  // Helper to reload module after environment change
  const reloadModule = () => {
    delete require.cache[require.resolve('../../ZelBack/src/services/appMessaging/cryptographicKeys')];
    // eslint-disable-next-line global-require
    cryptographicKeys = require('../../ZelBack/src/services/appMessaging/cryptographicKeys');
  };

  // Helper to call getPublicKey and wait for response
  const callGetPublicKey = (reqObj, resObj, data) => new Promise((resolve) => {
    cryptographicKeys.getPublicKey(reqObj, resObj);
    setTimeout(() => {
      if (Array.isArray(data)) {
        // Handle data chunks
        data.forEach((chunk) => reqObj.emit('data', chunk));
      } else if (data) {
        reqObj.emit('data', data);
      }
      reqObj.emit('end');
      // Give the async handler time to complete
      setTimeout(resolve, 20);
    }, 10);
  });

  beforeEach(() => {
    req = new EventEmitter();
    req.params = {};
    req.query = {};
    req.headers = {};
    res = {
      json: sinon.stub(),
      status: sinon.stub().returnsThis(),
      write: sinon.stub(),
      end: sinon.stub(),
      flush: sinon.stub(),
    };

    // Clear module cache and reload to pick up environment variable changes
    reloadModule();
  });

  afterEach(() => {
    sinon.restore();
    delete process.env.FLUXOS_PATH;
  });

  describe('getAppPublicKey tests', () => {
    it('should throw error if not running on Arcane OS', async () => {
      delete process.env.FLUXOS_PATH;
      reloadModule();

      try {
        await cryptographicKeys.getAppPublicKey('1ABC123', 'TestApp', 1000);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Arcane OS');
      }
    });

    it('should successfully get public key on Arcane OS', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();

      const mockPublicKey = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0B\n-----END PUBLIC KEY-----';

      sinon.stub(benchmarkService, 'getPublicKey').resolves({
        status: 'success',
        data: JSON.stringify({
          status: 'ok',
          publicKey: mockPublicKey,
        }),
      });

      const result = await cryptographicKeys.getAppPublicKey('1ABC123', 'TestApp', 1000);

      expect(result).to.equal(mockPublicKey);
    });

    it('should throw error if benchmark service returns error status', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();

      sinon.stub(benchmarkService, 'getPublicKey').resolves({
        status: 'error',
        data: 'Service unavailable',
      });

      try {
        await cryptographicKeys.getAppPublicKey('1ABC123', 'TestApp', 1000);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Error getting public key');
      }
    });

    it('should throw error if public key is null in response', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();

      sinon.stub(benchmarkService, 'getPublicKey').resolves({
        status: 'success',
        data: JSON.stringify({
          status: 'error',
          publicKey: null,
        }),
      });

      try {
        await cryptographicKeys.getAppPublicKey('1ABC123', 'TestApp', 1000);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Error getting public key to encrypt app enterprise content from SAS');
      }
    });

    it('should properly format input data for benchmark service', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();

      const getPublicKeyStub = sinon.stub(benchmarkService, 'getPublicKey').resolves({
        status: 'success',
        data: JSON.stringify({
          status: 'ok',
          publicKey: 'mockPublicKey',
        }),
      });

      const fluxID = '1ABC123XYZ';
      const appName = 'MyTestApp';
      const blockHeight = 123456;

      await cryptographicKeys.getAppPublicKey(fluxID, appName, blockHeight);

      const callArg = getPublicKeyStub.firstCall.args[0];
      const parsedArg = JSON.parse(callArg);
      expect(parsedArg.fluxID).to.equal(fluxID);
      expect(parsedArg.appName).to.equal(appName);
      expect(parsedArg.blockHeight).to.equal(blockHeight);
    });
  });

  describe('getPublicKey tests', () => {
    it('should return unauthorized if user not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      sinon.stub(messageHelper, 'errUnauthorizedMessage').returns({
        status: 'error',
        data: { code: 401, message: 'Unauthorized' },
      });

      const appSpec = JSON.stringify({
        owner: '1ABC123',
        name: 'TestApp',
      });

      await callGetPublicKey(req, res, appSpec);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should return error if owner parameter missing', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({ name: 'TestApp' }); // Missing owner
      sinon.stub(messageHelper, 'createErrorMessage').callsFake((msg) => ({
        status: 'error',
        data: { message: msg },
      }));

      const appSpec = JSON.stringify({ name: 'TestApp' });

      await callGetPublicKey(req, res, appSpec);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.include('Input parameters missing');
    });

    it('should return error if name parameter missing', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({ owner: '1ABC123' }); // Missing name
      sinon.stub(messageHelper, 'createErrorMessage').callsFake((msg) => ({
        status: 'error',
        data: { message: msg },
      }));

      const appSpec = JSON.stringify({ owner: '1ABC123' });

      await callGetPublicKey(req, res, appSpec);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.include('Input parameters missing');
    });

    it('should return error if daemon not synced', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({
        owner: '1ABC123',
        name: 'TestApp',
      });
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { synced: false, height: 1000 },
      });
      sinon.stub(messageHelper, 'createErrorMessage').callsFake((msg) => ({
        status: 'error',
        data: { message: msg },
      }));

      const appSpec = JSON.stringify({
        owner: '1ABC123',
        name: 'TestApp',
      });

      await callGetPublicKey(req, res, appSpec);
      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.include('Daemon not yet synced');
    });

    it('should successfully return public key when all conditions met', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();
      const mockPublicKey = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0B\n-----END PUBLIC KEY-----';

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({
        owner: '1ABC123',
        name: 'TestApp',
      });
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { synced: true, height: 2000 },
      });
      sinon.stub(benchmarkService, 'getPublicKey').resolves({
        status: 'success',
        data: JSON.stringify({
          status: 'ok',
          publicKey: mockPublicKey,
        }),
      });
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({
        status: 'success',
        data,
      }));

      const appSpec = JSON.stringify({
        owner: '1ABC123',
        name: 'TestApp',
      });

      await callGetPublicKey(req, res, appSpec);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('success');
      expect(res.json.firstCall.args[0].data).to.equal(mockPublicKey);
    });

    it('should handle request body in chunks', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();
      const mockPublicKey = 'mockKey123';

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      const ensureObjectStub = sinon.stub(serviceHelper, 'ensureObject');
      ensureObjectStub.onFirstCall().returns('{"owner":"1ABC123","name":"TestApp"}');
      ensureObjectStub.onSecondCall().returns({
        owner: '1ABC123',
        name: 'TestApp',
      });
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { synced: true, height: 2000 },
      });
      sinon.stub(benchmarkService, 'getPublicKey').resolves({
        status: 'success',
        data: JSON.stringify({
          status: 'ok',
          publicKey: mockPublicKey,
        }),
      });
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({
        status: 'success',
        data,
      }));

      // Send request body in multiple chunks
      await callGetPublicKey(req, res, ['{"owner":"1ABC', '123","name":"T', 'estApp"}']);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('success');
    });

    it('should verify user privilege level', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();
      const verifyStub = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({
        owner: '1ABC123',
        name: 'TestApp',
      });
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { synced: true, height: 2000 },
      });
      sinon.stub(benchmarkService, 'getPublicKey').resolves({
        status: 'success',
        data: JSON.stringify({
          status: 'ok',
          publicKey: 'mockKey',
        }),
      });
      sinon.stub(messageHelper, 'createDataMessage').returns({
        status: 'success',
        data: 'mockKey',
      });

      const appSpec = JSON.stringify({
        owner: '1ABC123',
        name: 'TestApp',
      });

      await callGetPublicKey(req, res, appSpec);

      sinon.assert.calledWith(verifyStub, 'user', req);
    });

    it('should use daemon height when calling getAppPublicKey', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();
      const daemonHeight = 123456;

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({
        owner: '1ABC123',
        name: 'TestApp',
      });
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { synced: true, height: daemonHeight },
      });
      const getPublicKeyStub = sinon.stub(benchmarkService, 'getPublicKey').resolves({
        status: 'success',
        data: JSON.stringify({
          status: 'ok',
          publicKey: 'mockKey',
        }),
      });
      sinon.stub(messageHelper, 'createDataMessage').returns({
        status: 'success',
        data: 'mockKey',
      });

      const appSpec = JSON.stringify({
        owner: '1ABC123',
        name: 'TestApp',
      });

      await callGetPublicKey(req, res, appSpec);

      const callArg = getPublicKeyStub.firstCall.args[0];
      const parsedArg = JSON.parse(callArg);
      expect(parsedArg.blockHeight).to.equal(daemonHeight);
    });

    it('should handle errors from getAppPublicKey and return error response', async () => {
      process.env.FLUXOS_PATH = '/some/path';
      reloadModule();

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({
        owner: '1ABC123',
        name: 'TestApp',
      });
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { synced: true, height: 2000 },
      });
      sinon.stub(benchmarkService, 'getPublicKey').resolves({
        status: 'error',
        data: 'Service error',
      });
      sinon.stub(messageHelper, 'createErrorMessage').callsFake((msg) => ({
        status: 'error',
        data: { message: msg },
      }));

      const appSpec = JSON.stringify({
        owner: '1ABC123',
        name: 'TestApp',
      });

      await callGetPublicKey(req, res, appSpec);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.message).to.include('Error getting public key');
    });

    it('should handle empty request body gracefully', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').returns({});
      sinon.stub(messageHelper, 'createErrorMessage').callsFake((msg) => ({
        status: 'error',
        data: { message: msg },
      }));

      await callGetPublicKey(req, res, '');

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should handle malformed JSON in request body', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').throws(new Error('Invalid JSON'));
      sinon.stub(messageHelper, 'createErrorMessage').callsFake((msg) => ({
        status: 'error',
        data: { message: msg },
      }));

      await callGetPublicKey(req, res, '{invalid json}');

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });
  });
});
