const chai = require('chai');
const sinon = require('sinon');

const { expect } = chai;

// Must set env vars before requiring arcaneAuthService (isArcane check at load time)
process.env.FLUXOS_PATH = '/tmp/test-fluxos';
process.env.FLUX_CONFIG_CONNECTION = 'unix:///tmp/flux-configd-test.sock';

const log = require('../../ZelBack/src/lib/log');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const arcaneAuthService = require('../../ZelBack/src/services/arcaneAuthService');
const fluxConfigdClient = require('../../ZelBack/src/services/utils/fluxConfigdClient');

describe('arcaneAuthService proxy tests', () => {
  let logInfoStub;
  let logErrorStub;
  let callFluxConfigdRPCStub;

  beforeEach(() => {
    logInfoStub = sinon.stub(log, 'info');
    logErrorStub = sinon.stub(log, 'error');
    callFluxConfigdRPCStub = sinon.stub(fluxConfigdClient, 'callFluxConfigdRPC');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('authChallenge tests', () => {
    it('should successfully proxy challenge generation to flux-configd', async () => {
      const mockChallenge = {
        challenge: 'a'.repeat(64),
        blockHeight: 12345,
        expiresAt: Date.now() + 30000,
      };

      callFluxConfigdRPCStub.resolves(mockChallenge);

      const req = {
        ip: '192.168.1.100',
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.authChallengeHandler(req, res);

      sinon.assert.calledOnce(callFluxConfigdRPCStub);
      sinon.assert.calledWith(callFluxConfigdRPCStub, 'arcane.generate_challenge', {
        ip_address: '192.168.1.100',
      });

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('success');
      expect(response.data).to.deep.equal(mockChallenge);

      sinon.assert.calledWith(logInfoStub, sinon.match(/Challenge generated for.*via flux-configd/));
    });

    it('should extract IP from connection.remoteAddress if req.ip is not available', async () => {
      const mockChallenge = {
        challenge: 'b'.repeat(64),
        blockHeight: 54321,
        expiresAt: Date.now() + 30000,
      };

      callFluxConfigdRPCStub.resolves(mockChallenge);

      const req = {
        connection: {
          remoteAddress: '10.0.0.50',
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.authChallengeHandler(req, res);

      sinon.assert.calledWith(callFluxConfigdRPCStub, 'arcane.generate_challenge', {
        ip_address: '10.0.0.50',
      });
    });

    it('should extract IP from x-forwarded-for header', async () => {
      const mockChallenge = {
        challenge: 'c'.repeat(64),
        blockHeight: 99999,
        expiresAt: Date.now() + 30000,
      };

      callFluxConfigdRPCStub.resolves(mockChallenge);

      const req = {
        headers: {
          'x-forwarded-for': '203.0.113.42',
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.authChallengeHandler(req, res);

      sinon.assert.calledWith(callFluxConfigdRPCStub, 'arcane.generate_challenge', {
        ip_address: '203.0.113.42',
      });
    });

    it('should return 400 error if IP cannot be determined', async () => {
      const req = {};

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.authChallengeHandler(req, res);

      sinon.assert.calledWith(res.status, 400);
      sinon.assert.calledOnce(res.json);

      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('Unable to determine requester IP address');
    });

    it('should return 429 error if flux-configd returns limit reached error', async () => {
      callFluxConfigdRPCStub.rejects(new Error('Challenge limit reached for IP'));

      const req = {
        ip: '192.168.1.100',
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.authChallengeHandler(req, res);

      sinon.assert.calledWith(res.status, 429);
      sinon.assert.calledOnce(res.json);

      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('Challenge limit reached');
    });

    it('should return 500 error for other flux-configd errors', async () => {
      callFluxConfigdRPCStub.rejects(new Error('RPC connection failed'));

      const req = {
        ip: '192.168.1.100',
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.authChallengeHandler(req, res);

      sinon.assert.calledWith(res.status, 500);
      sinon.assert.calledOnce(res.json);

      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('RPC connection failed');

      sinon.assert.calledWith(logErrorStub, sinon.match(/Error in authChallenge/));
    });

    it('should return 502 if FLUX_CONFIG_CONNECTION is not set', async () => {
      const original = process.env.FLUX_CONFIG_CONNECTION;
      delete process.env.FLUX_CONFIG_CONNECTION;

      const req = { ip: '192.168.1.100' };
      const res = { json: sinon.stub(), status: sinon.stub().returnsThis() };

      await arcaneAuthService.authChallengeHandler(req, res);

      sinon.assert.calledWith(res.status, 502);
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('flux-configd not available');

      process.env.FLUX_CONFIG_CONNECTION = original;
    });
  });

  describe('configSync tests', () => {
    it('should successfully proxy config sync to flux-configd', async () => {
      const mockResult = {
        synced: true,
        message: 'Configuration synchronized (1 fields changed)',
        changed_fields: ['notifications'],
      };

      callFluxConfigdRPCStub.resolves(mockResult);

      const req = {
        ip: '192.168.1.100',
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
          configData: { test: 'value' },
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledOnce(callFluxConfigdRPCStub);
      sinon.assert.calledWith(callFluxConfigdRPCStub, 'arcane.config_update', {
        challenge: 'a'.repeat(64),
        encrypted_challenge: 'base64encrypted==',
        signature: 'ab'.repeat(65),
        config_data: { test: 'value' },
        ip_address: '192.168.1.100',
      });

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('success');
      expect(response.data).to.deep.equal(mockResult);

      sinon.assert.calledWith(logInfoStub, sinon.match(/Config sync successful for.*via flux-configd/));
    });

    it('should return 400 error if IP cannot be determined', async () => {
      const req = {
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
          configData: { test: 'value' },
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 400);
      sinon.assert.calledOnce(res.json);

      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('Unable to determine requester IP address');
    });

    it('should return 400 error if challenge is missing', async () => {
      const req = {
        ip: '192.168.1.100',
        body: {
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
          configData: { test: 'value' },
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 400);
      const response = res.json.firstCall.args[0];
      expect(response.data.message).to.include('Missing required parameters');
    });

    it('should return 400 error if encryptedChallenge is missing', async () => {
      const req = {
        ip: '192.168.1.100',
        body: {
          challenge: 'a'.repeat(64),
          signature: 'ab'.repeat(65),
          configData: { test: 'value' },
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 400);
      const response = res.json.firstCall.args[0];
      expect(response.data.message).to.include('Missing required parameters');
    });

    it('should return 400 error if signature is missing', async () => {
      const req = {
        ip: '192.168.1.100',
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          configData: { test: 'value' },
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 400);
      const response = res.json.firstCall.args[0];
      expect(response.data.message).to.include('Missing required parameters');
    });

    it('should return 400 error if configData is missing', async () => {
      const req = {
        ip: '192.168.1.100',
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 400);
      const response = res.json.firstCall.args[0];
      expect(response.data.message).to.include('Missing required parameters');
    });

    it('should return 400 error if configData is an array', async () => {
      const req = {
        ip: '192.168.1.100',
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
          configData: ['not', 'an', 'object'],
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 400);
      const response = res.json.firstCall.args[0];
      expect(response.data.message).to.include('configData must be a plain object');
    });

    it('should return 400 error if configData exceeds 16KB', async () => {
      const req = {
        ip: '192.168.1.100',
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
          configData: { huge: 'x'.repeat(16385) },
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 400);
      const response = res.json.firstCall.args[0];
      expect(response.data.message).to.include('exceeds maximum size');
    });

    it('should return 401 error if flux-configd returns authentication failed', async () => {
      callFluxConfigdRPCStub.rejects(new Error('Authentication failed: Challenge mismatch'));

      const req = {
        ip: '192.168.1.100',
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
          configData: { test: 'value' },
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 401);
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('Authentication failed');
    });

    it('should return 500 error for other flux-configd errors', async () => {
      callFluxConfigdRPCStub.rejects(new Error('Database error'));

      const req = {
        ip: '192.168.1.100',
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
          configData: { test: 'value' },
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 500);
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');

      sinon.assert.calledWith(logErrorStub, sinon.match(/Error in configSync/));
    });

    it('should return 502 if FLUX_CONFIG_CONNECTION is not set', async () => {
      const original = process.env.FLUX_CONFIG_CONNECTION;
      delete process.env.FLUX_CONFIG_CONNECTION;

      const req = {
        ip: '192.168.1.100',
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
          configData: { test: 'value' },
        },
      };
      const res = { json: sinon.stub(), status: sinon.stub().returnsThis() };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(res.status, 502);
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('flux-configd not available');

      process.env.FLUX_CONFIG_CONNECTION = original;
    });

    it('should handle different IP extraction methods', async () => {
      const mockResult = { synced: true, message: 'Success', changed_fields: [] };
      callFluxConfigdRPCStub.resolves(mockResult);

      const req = {
        socket: {
          remoteAddress: '172.16.0.1',
        },
        body: {
          challenge: 'a'.repeat(64),
          encryptedChallenge: 'base64encrypted==',
          signature: 'ab'.repeat(65),
          configData: { test: 'value' },
        },
      };

      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(req, res);

      sinon.assert.calledWith(callFluxConfigdRPCStub, 'arcane.config_update', sinon.match({
        ip_address: '172.16.0.1',
      }));
    });
  });

  describe('Integration with flux-configd', () => {
    it('should handle complete authentication flow via flux-configd', async () => {
      // Step 1: Generate challenge
      const mockChallenge = {
        challenge: 'a'.repeat(64),
        blockHeight: 12345,
        expiresAt: Date.now() + 30000,
      };

      callFluxConfigdRPCStub.onFirstCall().resolves(mockChallenge);

      const challengeReq = {
        ip: '192.168.1.100',
      };

      const challengeRes = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.authChallengeHandler(challengeReq, challengeRes);

      const challengeResponse = challengeRes.json.firstCall.args[0];
      expect(challengeResponse.status).to.equal('success');

      // Step 2: Config sync with challenge + signature
      const mockSyncResult = {
        synced: true,
        message: 'Configuration synchronized (1 fields changed)',
        changed_fields: ['identity.flux_id'],
      };

      callFluxConfigdRPCStub.onSecondCall().resolves(mockSyncResult);

      const syncReq = {
        ip: '192.168.1.100',
        body: {
          challenge: mockChallenge.challenge,
          encryptedChallenge: 'encrypted_base64==',
          signature: 'ab'.repeat(65),
          configData: { identity: { fluxId: 'test-node' } },
        },
      };

      const syncRes = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis(),
      };

      await arcaneAuthService.configSyncHandler(syncReq, syncRes);

      const syncResponse = syncRes.json.firstCall.args[0];
      expect(syncResponse.status).to.equal('success');
      expect(syncResponse.data.synced).to.be.true;

      // Verify both RPC calls were made
      sinon.assert.calledTwice(callFluxConfigdRPCStub);
      sinon.assert.calledWith(logInfoStub, sinon.match(/Challenge generated/));
      sinon.assert.calledWith(logInfoStub, sinon.match(/Config sync successful/));
    });
  });
});
