const bs58check = require('bs58check');
const createHash = require('create-hash');
const secp256k1 = require('secp256k1');

/**
 * Bitcoin signed messages: a 65-byte compact signature over the Bitcoin
 * message magic hash, as wallets produce for "sign message".
 *
 * Every node must accept and refuse the same signatures, so verify accepts
 * exactly what bitcoinjs-message 2.2.0 accepts with its default prefix,
 * segwit headers and bech32 addresses included.
 * tests/unit/data/bitcoinMessageFixtures.json holds the cases that pin this.
 */

const MESSAGE_PREFIX = Buffer.from('\u0018Bitcoin Signed Message:\n', 'utf8');
const P2WPKH_SCRIPT_PREFIX = Buffer.from('0014', 'hex');
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest();
}

function hash160(buffer) {
  return createHash('ripemd160').update(sha256(buffer)).digest();
}

/**
 * Bitcoin's variable-length integer: one byte below 0xfd, else a marker byte
 * and a 2-, 4- or 8-byte little-endian value.
 * @param {number} n
 * @returns {Buffer}
 */
function varint(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 0xfd;
    buffer.writeUInt16LE(n, 1);
    return buffer;
  }
  if (n <= 0xffffffff) {
    const buffer = Buffer.alloc(5);
    buffer[0] = 0xfe;
    buffer.writeUInt32LE(n, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(9);
  buffer[0] = 0xff;
  buffer.writeBigUInt64LE(BigInt(n), 1);
  return buffer;
}

/**
 * The digest a Bitcoin signed message signs: double SHA-256 of the prefix, the
 * message's length as a varint, and the message.
 * @param {string|Buffer} message - A string is encoded as UTF-8.
 * @returns {Buffer} 32 bytes.
 */
function magicHash(message) {
  const body = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
  return sha256(sha256(Buffer.concat([MESSAGE_PREFIX, varint(body.length), body])));
}

/**
 * Splits a compact signature. Its header byte is 27 plus the recovery id
 * (0-3), plus 4 for a compressed key, or plus 8 for a P2SH-P2WPKH address or
 * 12 for a P2WPKH address (both compressed).
 * @param {Buffer} buffer - 65 bytes.
 * @returns {{compressed: boolean, segwit: ?string, recovery: number, signature: Buffer}}
 */
function decodeSignature(buffer) {
  if (buffer.length !== 65) throw new Error('Invalid signature length');
  const flag = buffer[0] - 27;
  if (flag > 15 || flag < 0) throw new Error('Invalid signature header');
  let segwit = null;
  if (flag & 8) segwit = flag & 4 ? 'p2wpkh' : 'p2sh-p2wpkh';
  return {
    compressed: Boolean(flag & 12),
    segwit,
    recovery: flag & 3,
    signature: buffer.subarray(1),
  };
}

function bech32PolymodStep(pre) {
  const b = pre >> 25;
  return ((pre & 0x1ffffff) << 5)
    ^ (-((b >> 0) & 1) & 0x3b6a57b2)
    ^ (-((b >> 1) & 1) & 0x26508e6d)
    ^ (-((b >> 2) & 1) & 0x1ea119fa)
    ^ (-((b >> 3) & 1) & 0x3d4233dd)
    ^ (-((b >> 4) & 1) & 0x2a1462b3);
}

/**
 * The program bytes of a bech32 (BIP 173) address: its data after the witness
 * version, with the checksum verified. Any prefix is accepted.
 * @param {string} address
 * @returns {Buffer}
 * @throws {Error} When the address is not valid bech32.
 */
function bech32Program(address) {
  if (address.length < 8 || address.length > 90) throw new Error('Invalid bech32 length');
  const lowered = address.toLowerCase();
  if (address !== lowered && address !== address.toUpperCase()) throw new Error('Mixed-case bech32');

  const split = lowered.lastIndexOf('1');
  if (split < 1) throw new Error('No bech32 prefix');
  const prefix = lowered.slice(0, split);
  const chars = lowered.slice(split + 1);
  if (chars.length < 6) throw new Error('Bech32 data too short');

  let chk = 1;
  for (let i = 0; i < prefix.length; i += 1) {
    const c = prefix.charCodeAt(i);
    if (c < 33 || c > 126) throw new Error('Invalid bech32 prefix');
    chk = bech32PolymodStep(chk) ^ (c >> 5);
  }
  chk = bech32PolymodStep(chk);
  for (let i = 0; i < prefix.length; i += 1) {
    chk = bech32PolymodStep(chk) ^ (prefix.charCodeAt(i) & 0x1f);
  }

  const words = [];
  for (let i = 0; i < chars.length; i += 1) {
    const v = BECH32_ALPHABET.indexOf(chars.charAt(i));
    if (v === -1) throw new Error('Invalid bech32 character');
    chk = bech32PolymodStep(chk) ^ v;
    if (i + 6 < chars.length) words.push(v);
  }
  if (chk !== 1) throw new Error('Invalid bech32 checksum');

  // 5-bit words to bytes; the padding left over must be under 5 bits, all zero.
  let value = 0;
  let bits = 0;
  const bytes = [];
  for (let i = 1; i < words.length; i += 1) {
    value = (value << 5) | words[i];
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((value << (8 - bits)) & 0xff)) throw new Error('Invalid bech32 padding');
  return Buffer.from(bytes);
}

/**
 * Whether a Bitcoin signed message was signed by the key behind an address.
 *
 * A P2PKH header matches a base58 address's hash, a P2SH-P2WPKH header a
 * base58 address's script hash, and a P2WPKH header a bech32 address's
 * program. A base58 address is compared from its second byte on, so only
 * one-byte version prefixes can match.
 * @param {string|Buffer} message
 * @param {string} address
 * @param {string|Buffer} signature - A string is read as base64.
 * @returns {boolean}
 * @throws {Error} When the signature or the address cannot be decoded, or no
 *   key recovers from the signature.
 */
function verify(message, address, signature) {
  const parsed = decodeSignature(Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'base64'));
  const publicKey = secp256k1.ecdsaRecover(parsed.signature, parsed.recovery, magicHash(message), parsed.compressed);
  const publicKeyHash = hash160(publicKey);

  if (parsed.segwit === 'p2wpkh') return publicKeyHash.equals(bech32Program(address));

  const expected = Buffer.from(bs58check.decode(address)).subarray(1);
  const actual = parsed.segwit === 'p2sh-p2wpkh'
    ? hash160(Buffer.concat([P2WPKH_SCRIPT_PREFIX, publicKeyHash]))
    : publicKeyHash;
  return actual.equals(expected);
}

/**
 * Signs a Bitcoin message with a P2PKH header.
 * @param {string|Buffer} message
 * @param {Buffer} privateKey - 32 bytes.
 * @param {boolean} compressed - Whether the key's address uses the compressed public key.
 * @param {Buffer} [extraEntropy] - 32 bytes mixed into the RFC 6979 nonce.
 * @returns {Buffer} 65 bytes.
 */
function sign(message, privateKey, compressed, extraEntropy) {
  const { signature, recid } = secp256k1.ecdsaSign(magicHash(message), privateKey, { data: extraEntropy });
  return Buffer.concat([Buffer.from([27 + recid + (compressed ? 4 : 0)]), Buffer.from(signature)]);
}

module.exports = { magicHash, sign, verify };
