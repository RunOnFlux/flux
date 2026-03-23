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

function WIFToPrivKey(wifPk) {
  let og = Buffer.from(bs58check.decode(wifPk)).toString('hex');
  og = og.substr(2, og.length); // remove WIF format ('80')
  if (og.length > 64) {
    og = og.substr(0, 64);
  }
  return og;
}

function privKeyToPubKey(privKey, toCompressed) {
  toCompressed = toCompressed || false;
  const pkBuffer = Buffer.from(privKey, 'hex');
  const publicKey = secp256k1.publicKeyCreate(pkBuffer, toCompressed);
  return Buffer.from(publicKey).toString('hex');
}

function pubKeyToAddr(pubKey, pubKeyHash) {
  pubKeyHash = pubKeyHash || '2089';
  const h160 = hash160(Buffer.from(pubKey, 'hex'));
  return bs58check.encode(Buffer.from(pubKeyHash + h160, 'hex')).toString('hex');
}

module.exports = { WIFToPrivKey, privKeyToPubKey, pubKeyToAddr };
