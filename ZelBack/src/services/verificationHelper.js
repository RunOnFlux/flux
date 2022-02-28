const zeltrezjs = require('zeltrezjs');
const verificationHelperUtils = require('./verificationHelperUtils');

/**
 * Verifies a specific privilege based on request headers.
 * @param {string} privilege - 'admin, 'fluxteam', 'adminandfluxteam', 'appownerabove', 'appowner', 'user'
 * @param {object} req
 * @param {string} appName
 *
 * @returns {Promise<boolean>} authorized
 */
async function verifyPrivilege(privilege, req, appName) {
  let authorized;
  switch (privilege) {
    case 'admin':
      authorized = await verificationHelperUtils.verifyAdminSession(req.headers);
      break;
    case 'fluxteam':
      authorized = await verificationHelperUtils.verifyFluxTeamSession(req.headers);
      break;
    case 'adminandfluxteam':
      authorized = await verificationHelperUtils.verifyAdminAndFluxTeamSession(req.headers);
      break;
    case 'appownerabove':
      authorized = await verificationHelperUtils.verifyAppOwnerOrHigherSession(req.headers, appName);
      break;
    case 'appowner':
      authorized = await verificationHelperUtils.verifyAppOwnerSession(req.headers, appName);
      break;
    case 'user':
      authorized = await verificationHelperUtils.verifyUserSession(req.headers);
      break;
    default:
      authorized = false;
      break;
  }
  return authorized;
}

function verifyZelID(address) {
  let isValid = false;
  try {
    if (!address) {
      throw new Error('Missing parameters for message verification');
    }

    if (!address.startsWith('1')) {
      throw new Error('Invalid zelID');
    }

    if (address.length > 36) {
      const btcPubKeyHash = '00';
      zeltrezjs.address.pubKeyToAddr(address, btcPubKeyHash);
    }
    isValid = true;
  } catch (e) {
    // log.error(e);  - the function is not used at the moment, commented out to clean up test logs
    isValid = e;
  }
  return isValid;
}

module.exports = {
  verifyPrivilege,
  verifyZelID,
};
