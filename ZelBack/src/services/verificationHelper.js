const zeltrezjs = require('zeltrezjs');
const bitcoinMessage = require('bitcoinjs-message');
const { randomBytes } = require('crypto');

const log = require('../lib/log');

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

/**
 * Verifies ZelID, returns true if it's valid.
 *
 * @param {string} address
 * @returns {bool} isVaild
 */
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

/**
 * Verifies if the message was properly signed.
 *
 * @param {object} message
 * @param {string} address
 * @param {string} signature
 * @param {string} strMessageMagic
 * @param {string} checkSegwitAlways
 *
 * @returns {bool} isValid
 */
function verifyMessage(message, address, signature, strMessageMagic, checkSegwitAlways) {
  let isValid = false;
  let signingAddress = address;
  try {
    if (!address || !message || !signature) {
      throw new Error('Missing parameters for message verification');
    }

    if (address.length > 36) {
      const btcPubKeyHash = '00';
      const sigAddress = zeltrezjs.address.pubKeyToAddr(address, btcPubKeyHash);
      signingAddress = sigAddress;
    }
    isValid = bitcoinMessage.verify(message, signingAddress, signature, strMessageMagic, checkSegwitAlways);
  } catch (e) {
    log.error(e);
    isValid = e;
  }
  return isValid;
}

/**
 * Signs the message with the private key.
 *
 * @param {object} message
 * @param {string} pk - private key
 *
 * @returns {string} signature
 */
function signMessage(message, pk) {
  let signature;
  try {
    const privateKey = zeltrezjs.address.WIFToPrivKey(pk);

    const isCompressed = !pk.startsWith('5');

    signature = bitcoinMessage.sign(message, Buffer.from(privateKey, 'hex'), isCompressed, { extraEntropy: randomBytes(32) });
    signature = signature.toString('base64');
    // => different (but valid) signature each time
  } catch (e) {
    log.error(e);
    signature = e;
  }
  return signature;
}

module.exports = {
  verifyPrivilege,
  verifyZelID,
  signMessage,
  verifyMessage,
};
