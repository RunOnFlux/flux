const bitcoinMessage = require('bitcoinjs-message');
const bitcoinjs = require('bitcoinjs-lib');
const zeltrezjs = require('zeltrezjs');

const log = require('../lib/log');

/**
 * Creates a message object.
 *
 * @param {object} data
 *
 * @returns {object} message
 */
function createDataMessage(data) {
  const successMessage = {
    status: 'success',
    data,
  };
  return successMessage;
}

/**
 * Creates a message object indicating success.
 *
 * @param {string} message
 * @param {string} [name]
 * @param {string} [code]
 *
 * @returns {object} success message
 */
function createSuccessMessage(message, name, code) {
  const successMessage = {
    status: 'success',
    data: {
      code,
      name,
      message,
    },
  };
  return successMessage;
}

/**
 * Creates a message indicating a warning.
 *
 * @param {string} message
 * @param {string} [name]
 * @param {string} [code]
 *
 * @returns {object} warning message
 */
function createWarningMessage(message, name, code) {
  const warningMessage = {
    status: 'warning',
    data: {
      code,
      name,
      message,
    },
  };
  return warningMessage;
}

/**
 * Creates a message indicating an error.
 *
 * @param {string} message
 * @param {string} [name]
 * @param {string} [code]
 *
 * @returns {object} error message
 */
function createErrorMessage(message, name, code) {
  const errMessage = {
    status: 'error',
    data: {
      code,
      name,
      message: message || 'Unknown error',
    },
  };
  return errMessage;
}

/**
 * Returns unauthorized error message.
 *
 * @returns {object} unauthorized error message
 */
function errUnauthorizedMessage() {
  const errMessage = {
    status: 'error',
    data: {
      code: 401,
      name: 'Unauthorized',
      message: 'Unauthorized. Access denied.',
    },
  };
  return errMessage;
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
      // const publicKeyBuffer = Buffer.from(address, 'hex');
      // const publicKey = bitcoinjs.ECPair.fromPublicKeyBuffer(publicKeyBuffer);
      // const sigAddress = bitcoinjs.payments.p2pkh({ pubkey: publicKeyBuffer }).address);
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
    const keyPair = bitcoinjs.ECPair.fromWIF(pk);
    const { privateKey } = keyPair;
    // console.log(keyPair.privateKey.toString('hex'));
    // console.log(keyPair.publicKey.toString('hex'));

    signature = bitcoinMessage.sign(message, privateKey, keyPair.compressed, { extraEntropy: randomBytes(32) });
    signature = signature.toString('base64');
    // => different (but valid) signature each time
  } catch (e) {
    log.error(e);
    signature = e;
  }
  return signature;
}

module.exports = {
  createDataMessage,
  createErrorMessage,
  createSuccessMessage,
  createWarningMessage,
  signMessage,
  verifyMessage,
  errUnauthorizedMessage,
};
