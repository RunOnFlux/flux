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
 * Converts a WIF (Wallet Import Format) private key to raw hex.
 * @param {string} wifPk - Private key in WIF format.
 * @returns {string} Raw private key as hex string.
 */
function WIFToPrivKey(wifPk) {
  let og = Buffer.from(bs58check.decode(wifPk)).toString('hex');
  og = og.substr(2, og.length); // remove WIF format ('80')
  if (og.length > 64) {
    og = og.substr(0, 64);
  }
  return og;
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

module.exports = { WIFToPrivKey, privKeyToPubKey, pubKeyToAddr };
