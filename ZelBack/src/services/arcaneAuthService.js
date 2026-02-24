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
 * @param {string} signature - Hex-encoded compact signature over sha256(challenge)
 * @param {object} configData - Configuration data to sync
 * @param {string} ipAddress - Requester's IP address
 * @returns {Promise<object>} Result from flux-configd
 */
async function updateConfig(challenge, encryptedChallenge, signature, configData, ipAddress) {
  const result = await fluxConfigdClient.callFluxConfigdRPC('arcane.config_update', {
    challenge,
    encrypted_challenge: encryptedChallenge,
    signature,
    config_data: configData,
    ip_address: ipAddress,
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

    const { challenge, encryptedChallenge, signature, configData } = req.body;
    if (!challenge || !encryptedChallenge || !signature || !configData) {
      const errMessage = messageHelper.createErrorMessage(
        'Missing required parameters: challenge, encryptedChallenge, signature, configData',
        'BadRequest',
        400,
      );
      return res.status(400).json(errMessage);
    }

    if (typeof signature !== 'string') {
      const errMessage = messageHelper.createErrorMessage(
        'signature must be a string',
        'BadRequest',
        400,
      );
      return res.status(400).json(errMessage);
    }

    if (typeof configData !== 'object' || configData === null || Array.isArray(configData)) {
      const errMessage = messageHelper.createErrorMessage(
        'configData must be a plain object',
        'BadRequest',
        400,
      );
      return res.status(400).json(errMessage);
    }

    if (JSON.stringify(configData).length > 16384) {
      const errMessage = messageHelper.createErrorMessage(
        'configData exceeds maximum size (16KB)',
        'BadRequest',
        400,
      );
      return res.status(400).json(errMessage);
    }

    const result = await updateConfig(
      challenge,
      encryptedChallenge,
      signature,
      configData,
      ipAddress,
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
