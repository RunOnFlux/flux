const bs58check = require('bs58check');
const { pubKeyToAddr } = require('./utils/fluxCryptoUtils');
const bitcoinMessage = require('bitcoinjs-message');
const ethereumHelper = require('./ethereumHelper');
const log = require('../lib/log');

const base58Chars = /^[1-9a-km-zA-HJ-NP-Z]+$/;
const ethAddress = /^0x[a-fA-F0-9]{40}$/;

/**
 * Whether an identity is one a signature can be verified against - a Flux ID
 * (base58check P2PKH) or an Ethereum address.
 *
 * Login identities and app owners are both held to this. An app owner that is
 * neither can never be signed for, which leaves the app unmanageable by anyone.
 *
 * @param {string} identity
 *
 * @returns {bool} isValid
 */
function isValidSigningIdentity(identity) {
  if (!identity || typeof identity !== 'string') {
    return false;
  }

  if (identity.startsWith('0x')) {
    return ethAddress.test(identity);
  }

  if (identity[0] !== '1' || identity.length < 25 || identity.length > 34) {
    return false;
  }

  if (!base58Chars.test(identity)) {
    return false;
  }

  try {
    // version byte + hash160. A bad checksum throws, and would fail signature
    // verification just as surely as the wrong shape.
    return bs58check.decode(identity).length === 21;
  } catch {
    return false;
  }
}

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
        const sigAddress = pubKeyToAddr(address, btcPubKeyHash);
        signingAddress = sigAddress;
      }
      isValid = bitcoinMessage.verify(message, signingAddress, signature);
    }
  } catch (e) {
    log.error(e);
  }
  return isValid;
}

module.exports = {
  isValidSigningIdentity,
  verifySignature,
};
