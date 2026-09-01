const { pubKeyToAddr, WIFToPrivKey } = require('./utils/fluxCryptoUtils');
const bitcoinMessage = require('bitcoinjs-message');
const { randomBytes } = require('crypto');

const log = require('../lib/log');

const verificationHelperUtils = require('./verificationHelperUtils');
const { Privilege, APP_SCOPED } = require('./utils/privileges');

/**
 * Which verifier answers each privilege.
 *
 * Every member of Privilege appears here and nothing else does, so a privilege
 * that no longer resolves is a failing test rather than a silent refusal at
 * runtime. The wrappers defer the lookup to call time, so a stubbed
 * verificationHelperUtils is still the one that answers.
 */
const DISPATCH = Object.freeze({
  [Privilege.USER]: (auth) => verificationHelperUtils.verifyUserSession(auth),
  [Privilege.NODE_OPERATOR]: (auth) => verificationHelperUtils.verifyNodeOperatorSession(auth),
  [Privilege.FLUX_TEAM]: (auth) => verificationHelperUtils.verifyFluxTeamSession(auth),
  [Privilege.NODE_OPERATOR_OR_FLUX_TEAM]: (auth) => verificationHelperUtils.verifyNodeOperatorOrFluxTeamSession(auth),
  [Privilege.APP_OWNER]: (auth, appName) => verificationHelperUtils.verifyAppOwnerSession(auth, appName),
  [Privilege.APP_OWNER_OR_FLUX_TEAM]: (auth, appName) => verificationHelperUtils.verifyAppOwnerOrFluxTeamSession(auth, appName),
});

/**
 * Whether a caller holds a privilege.
 *
 * Takes the zelidauth header's value, not the request it arrived in. The check
 * reads one field, and a function that accepts the whole request can reach
 * anything else on it - including the parts the caller controls.
 *
 * @param {string} privilege - a Privilege member
 * @param {string} zelidauth - the value of the zelidauth header
 * @param {{appName?: string}} [options] - carried by, and only by, an app-scoped privilege
 * @returns {Promise<boolean>} authorized
 */
async function verifyPrivilege(privilege, zelidauth, options = {}) {
  // Ahead of the try, because the catch below answers false. That is the right
  // answer to a check that failed and the wrong answer to a call site that is
  // wired wrongly, and the two must not reach a caller wearing the same face.
  if (!(privilege in DISPATCH)) {
    throw new TypeError(`verifyPrivilege: ${JSON.stringify(privilege)} is not a Privilege`);
  }
  // A header value is always a string, so anything else came from our own code:
  // a request, a fabricated headers object, an already-parsed auth. Absent is
  // not in this class - it is every unauthenticated request there has ever been.
  if (zelidauth != null && typeof zelidauth !== 'string') {
    throw new TypeError('verifyPrivilege: takes the zelidauth header value, not the request');
  }
  const scoped = APP_SCOPED.includes(privilege);
  if (!scoped && 'appName' in options) {
    throw new TypeError(`verifyPrivilege: ${privilege} resolves an identity and reads no app name`);
  }

  try {
    return await DISPATCH[privilege](zelidauth, options.appName);
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Verifies Flux ID, returns true if it's valid.
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
      pubKeyToAddr(address, btcPubKeyHash);
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
      const sigAddress = pubKeyToAddr(address, btcPubKeyHash);
      signingAddress = sigAddress;
    }
    isValid = bitcoinMessage.verify(message, signingAddress, signature, strMessageMagic, checkSegwitAlways);
  } catch { /* not a valid signature */ }
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
    if (!pk || typeof pk !== 'string') {
      throw new Error('Invalid private key provided');
    }
    const privateKey = WIFToPrivKey(pk);

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
