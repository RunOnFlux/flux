const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const fluxConfigdClient = require('./utils/fluxConfigdClient');

/**
 * Extract IP address from Express request
 * @param {object} req - Express request object
 * @returns {string} IP address
 */
function getRequesterIP(req) {
  return req.ip
    || req.connection?.remoteAddress
    || req.socket?.remoteAddress
    || req.headers?.['x-forwarded-for']
    || 'unknown';
}

/**
 * API handler for GET /arcane/authchallenge
 * Proxies to flux-configd RPC: arcane.generate_challenge
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function authChallenge(req, res) {
  try {
    const ipAddress = getRequesterIP(req);

    if (!ipAddress || ipAddress === 'unknown') {
      const errMessage = messageHelper.createErrorMessage(
        'Unable to determine requester IP address',
        'BadRequest',
        400
      );
      return res.status(400).json(errMessage);
    }

    // Call flux-configd RPC
    const result = await fluxConfigdClient.callFluxConfigdRPC('arcane.generate_challenge', {
      ip_address: ipAddress
    });

    log.info(`Challenge generated for ${ipAddress} via flux-configd`);

    const response = messageHelper.createDataMessage(result);
    return res.json(response);

  } catch (error) {
    log.error(`Error in authChallenge: ${error.message}`);

    const statusCode = error.message.includes('limit reached') ? 429 : 500;
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name || 'InternalError',
      statusCode
    );

    return res.status(statusCode).json(errMessage);
  }
}

/**
 * API handler for POST /arcane/configsync
 * Proxies to flux-configd RPC: arcane.config_update
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function configSync(req, res) {
  try {
    const ipAddress = getRequesterIP(req);

    if (!ipAddress || ipAddress === 'unknown') {
      const errMessage = messageHelper.createErrorMessage(
        'Unable to determine requester IP address',
        'BadRequest',
        400
      );
      return res.status(400).json(errMessage);
    }

    // Parse request body
    const { challenge, encryptedChallenge, configData, merge } = req.body;

    // Basic validation (flux-configd will do full validation)
    if (!challenge || !encryptedChallenge || !configData) {
      const errMessage = messageHelper.createErrorMessage(
        'Missing required parameters: challenge, encryptedChallenge, configData',
        'BadRequest',
        400
      );
      return res.status(400).json(errMessage);
    }

    // Call flux-configd RPC with authentication and config update
    // TODO: Determine correct username from node identity
    const result = await fluxConfigdClient.callFluxConfigdRPC('arcane.config_update', {
      challenge,
      encrypted_challenge: encryptedChallenge,
      config_data: configData,
      username: 'fluxnode',  // TODO: Get from node identity
      ip_address: ipAddress,
      merge: merge || false
    });

    log.info(`Config sync successful for ${ipAddress} via flux-configd`);

    const response = messageHelper.createDataMessage(result);
    return res.json(response);

  } catch (error) {
    log.error(`Error in configSync: ${error.message}`);

    // Authentication failures should return 401
    const statusCode = error.message.includes('Authentication failed') ? 401 : 500;
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name || 'InternalError',
      statusCode
    );

    return res.status(statusCode).json(errMessage);
  }
}

module.exports = {
  authChallenge,
  configSync,
};
