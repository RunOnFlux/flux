const nanoEthSigner = require('nano-ethereum-signer');

/**
 * Test if a string is trully a hex string
 * @param {string} hex value to test
 *
 * @returns {bool} is strictly hex
 */
function isHexStrict(hex) {
  return ((typeof hex === 'string' || typeof hex === 'number') && /^(-)?0x[0-9a-f]*$/i.test(hex));
}

/**
 * Convert utf string to hex
 * @param {string} str string to convert to hex string
 *
 * @returns {string} returns string encoded as hex
 */
function toHex(str) {
  let result = '';
  for (let i = 0; i < str.length; i += 1) {
    result += str.charCodeAt(i).toString(16);
  }
  return result;
}

/**
 * Convert hex string to butes array
 * @param {string} hexString string encoded as hex
 *
 * @returns {array} returns array of bytes representing given hex string
 */
function hexToBytes(hexString) {
  let hex = hexString;
  hex = hex.toString(16);
  if (!isHexStrict(hex)) {
    throw new Error(`Given value "${hex}" is not a valid hex string.`);
  }
  hex = hex.replace(/^0x/i, '');
  const bytes = [];
  // eslint-disable-next-line vars-on-top
  for (let c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.slice(c, c + 2), 16));
  }
  // eslint-disable-next-line block-scoped-var
  return bytes;
}

/**
 * Hash a given message as ethereum message that was signed
 * @param {string} message string to hash
 *
 * @returns {string} returns hash of a message
 */
function hashMessage(message) {
  const messageHex = `0x${toHex(message)}`;
  const messageBytes = hexToBytes(messageHex);
  const messageBuffer = Buffer.from(messageBytes);
  const preamble = `\x19Ethereum Signed Message:\n${messageBytes.length}`;
  const preambleBuffer = Buffer.from(preamble);
  const ethMessage = Buffer.concat([preambleBuffer, messageBuffer]);
  return nanoEthSigner.keccak(ethMessage);
}

/**
 * Get checksummed address that signed a given message
 * @param {string} message message that was signed
 *  * @param {string} signature signature of message
 *
 * @returns {string} returns ethereum address that signed the message
 */
function recoverSigner(message, signature) {
  const messageHash = hashMessage(message);
  return nanoEthSigner.signerAddress(messageHash, signature);
}

module.exports = {
  isHexStrict,
  toHex,
  hexToBytes,
  hashMessage,
  recoverSigner,
};
