const bs58check = require('bs58check');
const secp256k1 = require('secp256k1');
const createHash = require('create-hash');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function hash160(buffer) {
  const sha = sha256(buffer);
  return createHash('ripemd160').update(Buffer.from(sha, 'hex')).digest('hex');
}

/**
 * Decodes a WIF (Wallet Import Format) private key. After its version byte, which
 * differs between networks, a WIF holds the 32-byte key, then a 0x01 byte if the key
 * is for a compressed public key.
 * @param {string} wifPk - Private key in WIF format.
 * @returns {{privateKey: string, compressed: boolean}} The raw private key as hex, and
 *   whether its public key is compressed.
 * @throws {Error} When the checksum fails or the payload is neither shape.
 */
function decodeWIF(wifPk) {
  const payload = Buffer.from(bs58check.decode(wifPk));
  const compressed = payload.length === 34 && payload[33] === 0x01;
  if (payload.length !== 33 && !compressed) {
    throw new Error('Invalid WIF: the payload is neither an uncompressed nor a compressed key');
  }
  return { privateKey: payload.subarray(1, 33).toString('hex'), compressed };
}

/**
 * Derives a public key from a raw hex private key.
 * @param {string} privKey - Raw private key as hex string.
 * @param {boolean} [toCompressed=false] - Whether to return compressed public key.
 * @returns {string} Public key as hex string.
 */
function privKeyToPubKey(privKey, toCompressed) {
  toCompressed = toCompressed || false;
  const pkBuffer = Buffer.from(privKey, 'hex');
  const publicKey = secp256k1.publicKeyCreate(pkBuffer, toCompressed);
  return Buffer.from(publicKey).toString('hex');
}

/**
 * Converts a public key to a base58check address.
 * @param {string} pubKey - Public key as hex string.
 * @param {string} [pubKeyHash='2089'] - Network prefix bytes as hex string.
 * @returns {string} Base58check encoded address.
 */
function pubKeyToAddr(pubKey, pubKeyHash) {
  pubKeyHash = pubKeyHash || '2089';
  const h160 = hash160(Buffer.from(pubKey, 'hex'));
  return bs58check.encode(Buffer.from(pubKeyHash + h160, 'hex')).toString('hex');
}

module.exports = { decodeWIF, privKeyToPubKey, pubKeyToAddr };
