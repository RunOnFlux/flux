const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const fluxConfigdClient = require('./utils/fluxConfigdClient');

const isArcane = Boolean(process.env.FLUXOS_PATH);

/**
 * Generate authentication challenge for a requester
 * @param {string} ipAddress - Requester's IP address
 * @returns {Promise<object>} Challenge data from flux-configd
 */
async function generateChallenge(ipAddress) {
  const result = await fluxConfigdClient.callFluxConfigdRPC('arcane.generate_challenge', {
    ip_address: ipAddress
  });

  log.info(`Challenge generated for ${ipAddress} via flux-configd`);
  return result;
}

/**
 * Update configuration with authenticated request
 * @param {string} challenge - Challenge string
 * @param {string} encryptedChallenge - Encrypted challenge
 * @param {object} configData - Configuration data to sync
 * @param {string} ipAddress - Requester's IP address
 * @param {boolean} merge - Whether to merge or replace config
 * @returns {Promise<object>} Result from flux-configd
 */
async function updateConfig(challenge, encryptedChallenge, configData, ipAddress, merge = false) {
  // TODO: Determine correct username from node identity
  const result = await fluxConfigdClient.callFluxConfigdRPC('arcane.config_update', {
    challenge,
    encrypted_challenge: encryptedChallenge,
    config_data: configData,
    username: 'fluxnode',  // TODO: Get from node identity
    ip_address: ipAddress,
    merge
  });

  log.info(`Config sync successful for ${ipAddress} via flux-configd`);
  return result;
}

/**
 * HTTP handler for GET /arcane/authchallenge
 */
async function authChallengeHandler(req, res) {
  try {
    if (!isArcane) {
      const errMessage = messageHelper.createErrorMessage(
        'This endpoint is only available on ArcaneOS nodes',
        'NotImplemented',
        501,
      );
      return res.status(501).json(errMessage);
    }

    const ipAddress = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || req.headers?.['x-forwarded-for'];
    if (!ipAddress) {
      const errMessage = messageHelper.createErrorMessage(
        'Unable to determine requester IP address',
        'BadRequest',
        400,
      );
      return res.status(400).json(errMessage);
    }

    const result = await generateChallenge(ipAddress);
    const response = messageHelper.createDataMessage(result);
    return res.json(response);

  } catch (error) {
    log.error(`Error in authChallenge: ${error.message}`);
    const statusCode = error.message.includes('limit reached') ? 429 : 500;
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name || 'InternalError',
      statusCode,
    );
    return res.status(statusCode).json(errMessage);
  }
}

/**
 * HTTP handler for POST /arcane/configsync
 */
async function configSyncHandler(req, res) {
  try {
    if (!isArcane) {
      const errMessage = messageHelper.createErrorMessage(
        'This endpoint is only available on ArcaneOS nodes',
        'NotImplemented',
        501,
      );
      return res.status(501).json(errMessage);
    }

    const ipAddress = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || req.headers?.['x-forwarded-for'];
    if (!ipAddress) {
      const errMessage = messageHelper.createErrorMessage(
        'Unable to determine requester IP address',
        'BadRequest',
        400,
      );
      return res.status(400).json(errMessage);
    }

    const { challenge, encryptedChallenge, configData, merge } = req.body;
    if (!challenge || !encryptedChallenge || !configData) {
      const errMessage = messageHelper.createErrorMessage(
        'Missing required parameters: challenge, encryptedChallenge, configData',
        'BadRequest',
        400,
      );
      return res.status(400).json(errMessage);
    }

    const result = await updateConfig(
      challenge,
      encryptedChallenge,
      configData,
      ipAddress,
      merge,
    );
    const response = messageHelper.createDataMessage(result);
    return res.json(response);

  } catch (error) {
    log.error(`Error in configSync: ${error.message}`);
    const statusCode = error.message.includes('Authentication failed') ? 401 : 500;
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name || 'InternalError',
      statusCode,
    );
    return res.status(statusCode).json(errMessage);
  }
}

module.exports = {
  generateChallenge,
  updateConfig,
  authChallengeHandler,
  configSyncHandler,
};
