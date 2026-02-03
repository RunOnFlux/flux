const chai = require('chai');
const sinon = require('sinon');

const { expect } = chai;

const log = require('../../ZelBack/src/lib/log');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const arcaneAuthService = require('../../ZelBack/src/services/arcaneAuthService');

describe('arcaneAuthService tests', () => {
  let logInfoStub;
  let logWarnStub;
  let logErrorStub;
  let clock;

  beforeEach(() => {
    // Stub all log functions
    logInfoStub = sinon.stub(log, 'info');
    logWarnStub = sinon.stub(log, 'warn');
    logErrorStub = sinon.stub(log, 'error');
  });

  afterEach(() => {
    if (clock) {
      clock.restore();
      clock = null;
    }
    sinon.restore();
    // Clear all challenges to reset state between tests
    arcaneAuthService.clearAllChallenges();
  });

  describe('generateChallenge tests', () => {
    it('should generate a valid challenge with all required fields', () => {
      const requesterIP = '192.168.1.100';
      const result = arcaneAuthService.generateChallenge(requesterIP);

      expect(result).to.be.an('object');
      expect(result).to.have.property('challenge');
      expect(result).to.have.property('blockHeight');
      expect(result).to.have.property('expiresAt');

      // Challenge should be 64 hex characters
      expect(result.challenge).to.match(/^[0-9a-f]{64}$/i);
      expect(result.challenge).to.have.lengthOf(64);

      // Block height should be between 1 and 1000000
      expect(result.blockHeight).to.be.at.least(1);
      expect(result.blockHeight).to.be.at.most(1000000);

      // ExpiresAt should be approximately 30 seconds in the future
      const now = Date.now();
      expect(result.expiresAt).to.be.closeTo(now + 30000, 100);

      sinon.assert.calledOnce(logInfoStub);
      sinon.assert.calledWith(logInfoStub, sinon.match(/Challenge generated for/));
    });

    it('should generate unique challenges for the same IP', () => {
      const requesterIP = '192.168.1.100';
      const result1 = arcaneAuthService.generateChallenge(requesterIP);
      const result2 = arcaneAuthService.generateChallenge(requesterIP);

      expect(result1.challenge).to.not.equal(result2.challenge);
      expect(result1.blockHeight).to.not.equal(result2.blockHeight);
    });

    it('should throw error if IP is missing', () => {
      expect(() => arcaneAuthService.generateChallenge(null)).to.throw('Unable to determine requester IP address');
      expect(() => arcaneAuthService.generateChallenge(undefined)).to.throw('Unable to determine requester IP address');
      expect(() => arcaneAuthService.generateChallenge('')).to.throw('Unable to determine requester IP address');
      expect(() => arcaneAuthService.generateChallenge('unknown')).to.throw('Unable to determine requester IP address');
    });

    it('should throw error with code 400 for missing IP', () => {
      try {
        arcaneAuthService.generateChallenge(null);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.code).to.equal(400);
        expect(error.message).to.equal('Unable to determine requester IP address');
      }
    });

    it('should allow multiple challenges from different IPs', () => {
      const ip1 = '192.168.1.100';
      const ip2 = '192.168.1.101';

      const result1 = arcaneAuthService.generateChallenge(ip1);
      const result2 = arcaneAuthService.generateChallenge(ip2);

      expect(result1.challenge).to.not.equal(result2.challenge);
    });

    it('should reject when per-IP limit (16) is reached', () => {
      const requesterIP = '192.168.1.100';

      // Generate 16 challenges (max limit)
      for (let i = 0; i < 16; i += 1) {
        arcaneAuthService.generateChallenge(requesterIP);
      }

      // 17th should fail
      try {
        arcaneAuthService.generateChallenge(requesterIP);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Challenge limit reached');
        expect(error.message).to.include('Maximum 16 challenges per IP');
        expect(error.code).to.equal(429);
      }
    });

    it('should not affect other IPs when one IP reaches limit', () => {
      const ip1 = '192.168.1.100';
      const ip2 = '192.168.1.101';

      // Fill up ip1
      for (let i = 0; i < 16; i += 1) {
        arcaneAuthService.generateChallenge(ip1);
      }

      // ip1 should fail
      expect(() => arcaneAuthService.generateChallenge(ip1)).to.throw('Challenge limit reached');

      // ip2 should still work
      const result = arcaneAuthService.generateChallenge(ip2);
      expect(result).to.have.property('challenge');
    });

    it('should auto-cleanup challenge after 30 seconds', async () => {
      clock = sinon.useFakeTimers();

      const requesterIP = '192.168.1.100';
      const result = arcaneAuthService.generateChallenge(requesterIP);

      // Challenge should exist immediately
      expect(result.challenge).to.exist;

      // After 29 seconds, challenge should still exist (can generate 15 more)
      await clock.tickAsync(29000);
      for (let i = 0; i < 15; i += 1) {
        arcaneAuthService.generateChallenge(requesterIP);
      }
      expect(() => arcaneAuthService.generateChallenge(requesterIP)).to.throw('Challenge limit reached');

      // After 30 seconds, first challenge should be cleaned up
      await clock.tickAsync(1000);

      // Should be able to create one more challenge now
      const newResult = arcaneAuthService.generateChallenge(requesterIP);
      expect(newResult.challenge).to.exist;
      expect(newResult.challenge).to.not.equal(result.challenge);

      // Log should show expiration
      sinon.assert.calledWith(logInfoStub, sinon.match(/Challenge expired/));
    });
  });

  describe('validateInput tests', () => {
    it('should return null for valid input', () => {
      const challenge = 'a'.repeat(64);
      const encryptedChallenge = 'base64encodedstring==';

      const result = arcaneAuthService.validateInput(challenge, encryptedChallenge);

      expect(result).to.be.null;
    });

    it('should return errors if challenge is missing', () => {
      const errors = arcaneAuthService.validateInput(null, 'encrypted');

      expect(errors).to.be.an('array');
      expect(errors).to.include('Challenge required (string)');
    });

    it('should return errors if challenge is not a string', () => {
      const errors = arcaneAuthService.validateInput(12345, 'encrypted');

      expect(errors).to.be.an('array');
      expect(errors).to.include('Challenge required (string)');
    });

    it('should return errors if challenge is not 64 hex characters', () => {
      let errors = arcaneAuthService.validateInput('tooshort', 'encrypted');
      expect(errors).to.include('Challenge must be 64 hex characters');

      errors = arcaneAuthService.validateInput('g'.repeat(64), 'encrypted'); // invalid hex
      expect(errors).to.include('Challenge must be 64 hex characters');

      errors = arcaneAuthService.validateInput('a'.repeat(63), 'encrypted'); // too short
      expect(errors).to.include('Challenge must be 64 hex characters');

      errors = arcaneAuthService.validateInput('a'.repeat(65), 'encrypted'); // too long
      expect(errors).to.include('Challenge must be 64 hex characters');
    });

    it('should return errors if encryptedChallenge is missing', () => {
      const challenge = 'a'.repeat(64);
      const errors = arcaneAuthService.validateInput(challenge, null);

      expect(errors).to.be.an('array');
      expect(errors).to.include('Encrypted challenge required (string)');
    });

    it('should return errors if encryptedChallenge is not a string', () => {
      const challenge = 'a'.repeat(64);
      const errors = arcaneAuthService.validateInput(challenge, 12345);

      expect(errors).to.be.an('array');
      expect(errors).to.include('Encrypted challenge required (string)');
    });

    it('should return multiple errors if both inputs are invalid', () => {
      const errors = arcaneAuthService.validateInput(null, null);

      expect(errors).to.be.an('array');
      expect(errors.length).to.be.at.least(2);
      expect(errors).to.include('Challenge required (string)');
      expect(errors).to.include('Encrypted challenge required (string)');
    });

    it('should accept valid hex challenge (case insensitive)', () => {
      const challengeLower = 'abcdef0123456789'.repeat(4);
      const challengeUpper = 'ABCDEF0123456789'.repeat(4);
      const challengeMixed = 'AbCdEf0123456789'.repeat(4);

      expect(arcaneAuthService.validateInput(challengeLower, 'encrypted')).to.be.null;
      expect(arcaneAuthService.validateInput(challengeUpper, 'encrypted')).to.be.null;
      expect(arcaneAuthService.validateInput(challengeMixed, 'encrypted')).to.be.null;
    });
  });

  describe('validateArcaneAuth tests', () => {
    let decryptMessageStub;

    beforeEach(() => {
      decryptMessageStub = sinon.stub(benchmarkService, 'decryptMessage');
    });

    it('should return invalid if no challenges exist for IP', async () => {
      const result = await arcaneAuthService.validateArcaneAuth('challenge123', 'encrypted', '192.168.1.100');

      expect(result).to.deep.equal({
        valid: false,
        reason: 'No challenges for this IP',
      });
    });

    it('should return invalid if challenge not found', async () => {
      const requesterIP = '192.168.1.100';
      arcaneAuthService.generateChallenge(requesterIP); // Create a challenge

      const result = await arcaneAuthService.validateArcaneAuth('wrongchallenge', 'encrypted', requesterIP);

      expect(result).to.deep.equal({
        valid: false,
        reason: 'Challenge not found or already used',
      });
    });

    it('should return invalid if challenge has expired', async () => {
      clock = sinon.useFakeTimers();

      const requesterIP = '192.168.1.100';
      const { challenge } = arcaneAuthService.generateChallenge(requesterIP);

      // Fast forward past expiration - timer will auto-delete the challenge
      await clock.tickAsync(31000);

      const result = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);

      // After timer fires, challenge is deleted, so IP has no challenges
      expect(result.valid).to.be.false;
      expect(result.reason).to.equal('No challenges for this IP');
    });

    it('should return invalid if decryption fails', async () => {
      const requesterIP = '192.168.1.100';
      const { challenge } = arcaneAuthService.generateChallenge(requesterIP);

      decryptMessageStub.resolves({
        status: 'error',
        data: { message: 'Decryption failed' },
      });

      const result = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);

      expect(result.valid).to.be.false;
      expect(result.reason).to.equal('Decryption failed');
    });

    it('should return invalid if FluxBench returns error status', async () => {
      const requesterIP = '192.168.1.100';
      const { challenge } = arcaneAuthService.generateChallenge(requesterIP);

      decryptMessageStub.resolves({
        status: 'success',
        data: JSON.stringify({ status: 'error', message: 'FluxBench error' }),
      });

      const result = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);

      expect(result.valid).to.be.false;
      expect(result.reason).to.equal('FluxBench error');
    });

    it('should return invalid if decrypted challenge does not match', async () => {
      const requesterIP = '192.168.1.100';
      const { challenge } = arcaneAuthService.generateChallenge(requesterIP);

      decryptMessageStub.resolves({
        status: 'success',
        data: JSON.stringify({ status: 'ok', message: 'wrongchallenge' }),
      });

      const result = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);

      expect(result.valid).to.be.false;
      expect(result.reason).to.equal('Challenge mismatch');
    });

    it('should return valid if everything matches correctly', async () => {
      const requesterIP = '192.168.1.100';
      const { challenge, blockHeight } = arcaneAuthService.generateChallenge(requesterIP);

      decryptMessageStub.resolves({
        status: 'success',
        data: JSON.stringify({ status: 'ok', message: challenge }),
      });

      const result = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);

      expect(result.valid).to.be.true;
      expect(result.reason).to.equal('Authentication successful');

      // Verify decryptMessage was called with correct parameters
      sinon.assert.calledOnce(decryptMessageStub);
      const callArg = JSON.parse(decryptMessageStub.firstCall.args[0]);
      expect(callArg.fluxID).to.equal('ARCANEOS_NODE_AUTH');
      expect(callArg.appName).to.equal('ARCANEOS_SYSTEM');
      expect(callArg.message).to.equal('encrypted');
      expect(callArg.blockHeight).to.equal(blockHeight);

      sinon.assert.calledWith(logInfoStub, sinon.match(/Authentication successful/));
    });

    it('should delete challenge after successful validation (one-time use)', async () => {
      const requesterIP = '192.168.1.100';
      const { challenge } = arcaneAuthService.generateChallenge(requesterIP);

      decryptMessageStub.resolves({
        status: 'success',
        data: JSON.stringify({ status: 'ok', message: challenge }),
      });

      // First validation should succeed
      const result1 = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);
      expect(result1.valid).to.be.true;

      // Second validation with same challenge should fail
      // After validation, the challenge is deleted and IP map is empty
      const result2 = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);
      expect(result2.valid).to.be.false;
      expect(result2.reason).to.equal('No challenges for this IP');
    });

    it('should cancel timer when challenge is successfully validated', async () => {
      clock = sinon.useFakeTimers();

      const requesterIP = '192.168.1.100';
      const { challenge } = arcaneAuthService.generateChallenge(requesterIP);

      // Fill up to limit
      for (let i = 0; i < 15; i += 1) {
        arcaneAuthService.generateChallenge(requesterIP);
      }

      // Should be at limit now
      expect(() => arcaneAuthService.generateChallenge(requesterIP)).to.throw('Challenge limit reached');

      decryptMessageStub.resolves({
        status: 'success',
        data: JSON.stringify({ status: 'ok', message: challenge }),
      });

      // Validate first challenge (should cancel timer and free up slot)
      const result = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);
      expect(result.valid).to.be.true;

      // Should be able to create new challenge immediately (not wait for timer)
      const newResult = arcaneAuthService.generateChallenge(requesterIP);
      expect(newResult.challenge).to.exist;

      // Fast forward time - first challenge should NOT be logged as expired (timer was cancelled)
      const expiredLogCallsBefore = logInfoStub.getCalls().filter((call) => call.args[0].includes('Challenge expired')).length;
      await clock.tickAsync(31000);
      const expiredLogCallsAfter = logInfoStub.getCalls().filter((call) => call.args[0].includes('Challenge expired')).length;

      // Should have expired logs for the other challenges
      // Note: We created 1 validated + 15 more = 16 total
      // After validation, we have 15 remaining that will expire
      // But the new one we just created won't expire yet (it's fresh)
      // So we expect 15 expiration logs
      expect(expiredLogCallsAfter - expiredLogCallsBefore).to.be.at.least(14);
    });

    it('should handle FluxBench RPC errors gracefully', async () => {
      const requesterIP = '192.168.1.100';
      const { challenge } = arcaneAuthService.generateChallenge(requesterIP);

      decryptMessageStub.rejects(new Error('RPC connection failed'));

      const result = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);

      expect(result.valid).to.be.false;
      expect(result.reason).to.equal('Decryption failed');
      sinon.assert.calledWith(logErrorStub, sinon.match(/FluxBench decryption error/));
    });

    it('should handle invalid JSON response from FluxBench', async () => {
      const requesterIP = '192.168.1.100';
      const { challenge } = arcaneAuthService.generateChallenge(requesterIP);

      decryptMessageStub.resolves({
        status: 'success',
        data: 'not valid json{',
      });

      const result = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);

      expect(result.valid).to.be.false;
      expect(result.reason).to.equal('Invalid decryption response');
      sinon.assert.calledWith(logErrorStub, sinon.match(/Failed to parse FluxBench response/));
    });

    it('should clean up empty IP map after validation', async () => {
      const requesterIP = '192.168.1.100';
      const { challenge } = arcaneAuthService.generateChallenge(requesterIP);

      decryptMessageStub.resolves({
        status: 'success',
        data: JSON.stringify({ status: 'ok', message: challenge }),
      });

      await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted', requesterIP);

      // After validating the only challenge, IP should be completely removed
      // Try to create 16 new challenges - should succeed (not fail at limit)
      for (let i = 0; i < 16; i += 1) {
        arcaneAuthService.generateChallenge(requesterIP);
      }

      expect(() => arcaneAuthService.generateChallenge(requesterIP)).to.throw('Challenge limit reached');
    });
  });

  describe('processConfigSync tests', () => {
    it('should return success result with config keys', () => {
      const configData = {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      };
      const requesterIP = '192.168.1.100';

      const result = arcaneAuthService.processConfigSync(configData, requesterIP);

      expect(result).to.deep.equal({
        synced: true,
        message: 'Configuration synchronized successfully',
        receivedConfig: ['key1', 'key2', 'key3'],
      });

      sinon.assert.calledWith(logInfoStub, sinon.match(/Config sync authenticated from/));
    });

    it('should return empty array if configData is null', () => {
      const result = arcaneAuthService.processConfigSync(null, '192.168.1.100');

      expect(result.receivedConfig).to.deep.equal([]);
    });

    it('should return empty array if configData is undefined', () => {
      const result = arcaneAuthService.processConfigSync(undefined, '192.168.1.100');

      expect(result.receivedConfig).to.deep.equal([]);
    });

    it('should handle empty config object', () => {
      const result = arcaneAuthService.processConfigSync({}, '192.168.1.100');

      expect(result.receivedConfig).to.deep.equal([]);
    });

    it('should log the requester IP', () => {
      const requesterIP = '10.0.0.50';
      arcaneAuthService.processConfigSync({ test: 'data' }, requesterIP);

      sinon.assert.calledWith(logInfoStub, sinon.match(new RegExp(requesterIP)));
    });
  });

  describe('Integration tests - Full authentication flow', () => {
    let decryptMessageStub;

    beforeEach(() => {
      decryptMessageStub = sinon.stub(benchmarkService, 'decryptMessage');
    });

    it('should complete full auth flow successfully', async () => {
      const requesterIP = '192.168.1.100';

      // Step 1: Generate challenge
      const { challenge, blockHeight, expiresAt } = arcaneAuthService.generateChallenge(requesterIP);
      expect(challenge).to.exist;
      expect(expiresAt).to.be.greaterThan(Date.now());

      // Step 2: Validate input
      const validationErrors = arcaneAuthService.validateInput(challenge, 'encrypted123');
      expect(validationErrors).to.be.null;

      // Step 3: Validate auth
      decryptMessageStub.resolves({
        status: 'success',
        data: JSON.stringify({ status: 'ok', message: challenge }),
      });

      const authResult = await arcaneAuthService.validateArcaneAuth(challenge, 'encrypted123', requesterIP);
      expect(authResult.valid).to.be.true;

      // Step 4: Process config sync
      const syncResult = arcaneAuthService.processConfigSync({ test: 'data' }, requesterIP);
      expect(syncResult.synced).to.be.true;

      // Verify FluxBench was called with correct context
      const decryptCall = JSON.parse(decryptMessageStub.firstCall.args[0]);
      expect(decryptCall.fluxID).to.equal('ARCANEOS_NODE_AUTH');
      expect(decryptCall.appName).to.equal('ARCANEOS_SYSTEM');
      expect(decryptCall.blockHeight).to.equal(blockHeight);
    });

    it('should handle concurrent authentications from same IP', async () => {
      const requesterIP = '192.168.1.100';

      // Generate 3 challenges
      const challenge1 = arcaneAuthService.generateChallenge(requesterIP);
      const challenge2 = arcaneAuthService.generateChallenge(requesterIP);
      const challenge3 = arcaneAuthService.generateChallenge(requesterIP);

      // All should be different
      expect(challenge1.challenge).to.not.equal(challenge2.challenge);
      expect(challenge2.challenge).to.not.equal(challenge3.challenge);

      // Mock decryption to return matching challenges
      decryptMessageStub.callsFake(async (input) => {
        const parsed = JSON.parse(input);
        return {
          status: 'success',
          data: JSON.stringify({ status: 'ok', message: parsed.message.replace('encrypted_', '') }),
        };
      });

      // Validate all three in order
      const result1 = await arcaneAuthService.validateArcaneAuth(challenge1.challenge, `encrypted_${challenge1.challenge}`, requesterIP);
      const result2 = await arcaneAuthService.validateArcaneAuth(challenge2.challenge, `encrypted_${challenge2.challenge}`, requesterIP);
      const result3 = await arcaneAuthService.validateArcaneAuth(challenge3.challenge, `encrypted_${challenge3.challenge}`, requesterIP);

      expect(result1.valid).to.be.true;
      expect(result2.valid).to.be.true;
      expect(result3.valid).to.be.true;
    });

    it('should handle concurrent authentications from different IPs', async () => {
      const ip1 = '192.168.1.100';
      const ip2 = '192.168.1.101';
      const ip3 = '192.168.1.102';

      const challenge1 = arcaneAuthService.generateChallenge(ip1);
      const challenge2 = arcaneAuthService.generateChallenge(ip2);
      const challenge3 = arcaneAuthService.generateChallenge(ip3);

      decryptMessageStub.callsFake(async (input) => {
        const parsed = JSON.parse(input);
        return {
          status: 'success',
          data: JSON.stringify({ status: 'ok', message: parsed.message.replace('encrypted_', '') }),
        };
      });

      const [result1, result2, result3] = await Promise.all([
        arcaneAuthService.validateArcaneAuth(challenge1.challenge, `encrypted_${challenge1.challenge}`, ip1),
        arcaneAuthService.validateArcaneAuth(challenge2.challenge, `encrypted_${challenge2.challenge}`, ip2),
        arcaneAuthService.validateArcaneAuth(challenge3.challenge, `encrypted_${challenge3.challenge}`, ip3),
      ]);

      expect(result1.valid).to.be.true;
      expect(result2.valid).to.be.true;
      expect(result3.valid).to.be.true;
    });
  });

  describe('Memory management tests', () => {
    it('should properly clean up all challenges after expiration', async () => {
      clock = sinon.useFakeTimers();

      const requesterIP = '192.168.1.100';

      // Create 10 challenges
      const challenges = [];
      for (let i = 0; i < 10; i += 1) {
        challenges.push(arcaneAuthService.generateChallenge(requesterIP));
      }

      // All should be active
      expect(challenges).to.have.lengthOf(10);

      // Fast forward past expiration
      await clock.tickAsync(31000);

      // All should be cleaned up - should be able to create 16 new ones
      for (let i = 0; i < 16; i += 1) {
        arcaneAuthService.generateChallenge(requesterIP);
      }

      // 17th should fail
      expect(() => arcaneAuthService.generateChallenge(requesterIP)).to.throw('Challenge limit reached');
    });

    it('should handle mixed expiration and validation cleanup', async () => {
      clock = sinon.useFakeTimers();

      const requesterIP = '192.168.1.100';
      const decryptMessageStub = sinon.stub(benchmarkService, 'decryptMessage');

      // Create 5 challenges
      const challenges = [];
      for (let i = 0; i < 5; i += 1) {
        challenges.push(arcaneAuthService.generateChallenge(requesterIP));
      }

      // Wait 10 seconds
      await clock.tickAsync(10000);

      // Create 5 more challenges
      for (let i = 0; i < 5; i += 1) {
        challenges.push(arcaneAuthService.generateChallenge(requesterIP));
      }

      // Validate the 3rd challenge (from first batch)
      decryptMessageStub.resolves({
        status: 'success',
        data: JSON.stringify({ status: 'ok', message: challenges[2].challenge }),
      });

      await arcaneAuthService.validateArcaneAuth(challenges[2].challenge, 'encrypted', requesterIP);

      // Wait another 21 seconds (total 31 seconds from first batch)
      await clock.tickAsync(21000);

      // First batch (except validated one) should be expired
      // Second batch should still be active
      // Total: 5 remaining (second batch)
      // Should be able to create 11 more
      for (let i = 0; i < 11; i += 1) {
        arcaneAuthService.generateChallenge(requesterIP);
      }

      // 12th should fail
      expect(() => arcaneAuthService.generateChallenge(requesterIP)).to.throw('Challenge limit reached');
    });
  });
});
