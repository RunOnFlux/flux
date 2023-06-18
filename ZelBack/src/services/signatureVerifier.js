const zeltrezjs = require('zeltrezjs');
const bitcoinMessage = require('bitcoinjs-message');
const ethereumHelper = require('./ethereumHelper');
const log = require('../lib/log');

/**
 * Verifies signature of application owner on bitcoin or ethereum networks
 *
 * @param {object} message
 * @param {string} address
 * @param {string} signature
 *
 * @returns {bool} isValid
 */
function verifySignature(message, address, signature) {
  let isValid = false;
  let signingAddress = address;
  try {
    if (!address || !message || !signature) {
      throw new Error('Missing parameters for message verification');
    }

    if (address.startsWith('0x')) {
      const messageSigner = ethereumHelper.recoverSigner(message, signature);
      if (messageSigner.toLowerCase() === address.toLowerCase()) {
        isValid = true;
      }
    } else {
      if (address.length > 36) {
        // bitcoin
        const btcPubKeyHash = '00';
        const sigAddress = zeltrezjs.address.pubKeyToAddr(address, btcPubKeyHash);
        signingAddress = sigAddress;
      }
      isValid = bitcoinMessage.verify(message, signingAddress, signature);
    }
  } catch (e) {
    log.error(e);
    isValid = e;
  }
  return isValid;
}

module.exports = {
  verifySignature,
};
