const crypto = require('crypto');

const log = require('../lib/log');
const benchmarkService = require('./benchmarkService');

// Constants
const CHALLENGE_TTL_MS = 30000; // 30 seconds
const CHALLENGE_BYTES = 32; // 64 hex characters
const MAX_CHALLENGES_PER_IP = 16; // Max challenges per IP address

// Challenge storage: Map<IP, Map<challenge, {createdAt, expiresAt, blockHeight, timerId}>>
const challengesByIP = new Map();

/**
 * Generate a random authentication challenge for a requester IP.
 * @param {string} requesterIP - The IP address of the requester
 * @returns {object} - { challenge, blockHeight, expiresAt }
 * @throws {Error} - If IP is missing or limit reached
 */
function generateChallenge(requesterIP) {
  // REJECT if IP not present
  if (!requesterIP || requesterIP === 'unknown') {
    const error = new Error('Unable to determine requester IP address');
    error.code = 400;
    throw error;
  }

  const ip = requesterIP;

  // Get or create challenges map for this IP
  if (!challengesByIP.has(ip)) {
    challengesByIP.set(ip, new Map());
  }

  const ipChallenges = challengesByIP.get(ip);

  // REJECT if per-IP limit reached (don't remove oldest)
  if (ipChallenges.size >= MAX_CHALLENGES_PER_IP) {
    const error = new Error(`Challenge limit reached for IP ${ip}. Maximum ${MAX_CHALLENGES_PER_IP} challenges per IP.`);
    error.code = 429;
    throw error;
  }

  // Generate 32 bytes = 64 hex chars
  const challenge = crypto.randomBytes(CHALLENGE_BYTES).toString('hex');

  // Generate random block height (1-1000000)
  const blockHeight = Math.floor(Math.random() * 1000000) + 1;

  // Set timer to auto-delete after TTL
  const timerId = setTimeout(() => {
    const ipMap = challengesByIP.get(ip);
    if (ipMap) {
      ipMap.delete(challenge);
      // Clean up empty IP map
      if (ipMap.size === 0) {
        challengesByIP.delete(ip);
      }
    }
    log.info(`Challenge expired for ${ip}: ${challenge.substring(0, 8)}...`);
  }, CHALLENGE_TTL_MS);

  // Store with metadata including timer ID
  const now = Date.now();
  ipChallenges.set(challenge, {
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
    blockHeight,
    timerId,
  });

  log.info(`Challenge generated for ${ip}: ${challenge.substring(0, 8)}...`);

  return { challenge, blockHeight, expiresAt: now + CHALLENGE_TTL_MS };
}

/**
 * Validate ArcaneOS authentication using challenge-response.
 * @param {string} challenge - Original plaintext challenge
 * @param {string} encryptedChallenge - Base64 encrypted challenge from requester
 * @param {string} requesterIP - IP address of the requester
 * @returns {object} - { valid: boolean, reason: string }
 */
async function validateArcaneAuth(challenge, encryptedChallenge, requesterIP) {
  const ip = requesterIP || 'unknown';

  // 1. Check existence
  const ipChallenges = challengesByIP.get(ip);
  if (!ipChallenges) {
    return { valid: false, reason: 'No challenges for this IP' };
  }

  const storedData = ipChallenges.get(challenge);
  if (!storedData) {
    return { valid: false, reason: 'Challenge not found or already used' };
  }

  // 2. Check expiration (shouldn't happen if timer works, but defensive)
  if (Date.now() > storedData.expiresAt) {
    clearTimeout(storedData.timerId);
    ipChallenges.delete(challenge);
    if (ipChallenges.size === 0) {
      challengesByIP.delete(ip);
    }
    return { valid: false, reason: 'Challenge expired' };
  }

  // 3. Decrypt with FluxBench
  const inputData = JSON.stringify({
    fluxID: 'ARCANEOS_NODE_AUTH',
    appName: 'ARCANEOS_SYSTEM',
    message: encryptedChallenge,
    blockHeight: storedData.blockHeight,
  });

  let result;
  try {
    result = await benchmarkService.decryptMessage(inputData);
  } catch (error) {
    log.error(`FluxBench decryption error: ${error.message}`);
    return { valid: false, reason: 'Decryption failed' };
  }

  if (result.status !== 'success') {
    return { valid: false, reason: 'Decryption failed' };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.data);
  } catch (error) {
    log.error(`Failed to parse FluxBench response: ${error.message}`);
    return { valid: false, reason: 'Invalid decryption response' };
  }

  if (parsed.status !== 'ok') {
    return { valid: false, reason: 'FluxBench error' };
  }

  const decryptedChallenge = parsed.message;

  // 4. Verify match
  if (decryptedChallenge !== challenge) {
    return { valid: false, reason: 'Challenge mismatch' };
  }

  // 5. Cancel timer and remove (one-time use, successful auth)
  clearTimeout(storedData.timerId);
  ipChallenges.delete(challenge);

  // Clean up empty IP map
  if (ipChallenges.size === 0) {
    challengesByIP.delete(ip);
  }

  log.info(`Authentication successful for ${ip}: ${challenge.substring(0, 8)}...`);

  return { valid: true, reason: 'Authentication successful' };
}

/**
 * Validate input for configSync endpoint.
 * @param {string} challenge - Challenge string
 * @param {string} encryptedChallenge - Encrypted challenge string
 * @returns {Array|null} - Array of error messages or null if valid
 */
function validateInput(challenge, encryptedChallenge) {
  const errors = [];

  if (!challenge || typeof challenge !== 'string') {
    errors.push('Challenge required (string)');
  }

  if (challenge && !/^[0-9a-f]{64}$/i.test(challenge)) {
    errors.push('Challenge must be 64 hex characters');
  }

  if (!encryptedChallenge || typeof encryptedChallenge !== 'string') {
    errors.push('Encrypted challenge required (string)');
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Process configuration sync after successful authentication.
 * @param {object} configData - Configuration data to sync
 * @param {string} requesterIP - IP address of the requester
 * @returns {object} - Sync result
 */
function processConfigSync(configData, requesterIP) {
  log.info(`Config sync authenticated from ${requesterIP}, processing configuration`);

  // Placeholder: Actual sync logic to be implemented later
  return {
    synced: true,
    message: 'Configuration synchronized successfully',
    receivedConfig: configData ? Object.keys(configData) : [],
  };
}

/**
 * Clear all challenges (for testing only).
 * @private
 */
function clearAllChallenges() {
  // Cancel all timers before clearing
  challengesByIP.forEach((ipChallenges) => {
    ipChallenges.forEach((challengeData) => {
      clearTimeout(challengeData.timerId);
    });
  });
  challengesByIP.clear();
}

module.exports = {
  generateChallenge,
  validateArcaneAuth,
  validateInput,
  processConfigSync,
  // Export for testing only
  clearAllChallenges,
};
