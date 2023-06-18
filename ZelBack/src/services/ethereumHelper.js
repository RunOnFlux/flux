const nanoEthSigner = require('nano-ethereum-signer');

function isHexStrict(hex) {
  return ((typeof hex === 'string' || typeof hex === 'number') && /^(-)?0x[0-9a-f]*$/i.test(hex));
}

function toHex(str) {
  let result = '';
  for (let i = 0; i < str.length; i += 1) {
    result += str.charCodeAt(i).toString(16);
  }
  return result;
}

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

function hashMessage(data) {
  const messageHex = `0x${toHex(data)}`;
  const messageBytes = hexToBytes(messageHex);
  const messageBuffer = Buffer.from(messageBytes);
  const preamble = `\x19Ethereum Signed Message:\n${messageBytes.length}`;
  const preambleBuffer = Buffer.from(preamble);
  const ethMessage = Buffer.concat([preambleBuffer, messageBuffer]);
  return nanoEthSigner.keccak(ethMessage);
}

function recoverSigner(message, signature) {
  const messageHash = hashMessage(message);
  return nanoEthSigner.signerAddress(messageHash, signature);
}

module.exports = {
  recoverSigner,
};
