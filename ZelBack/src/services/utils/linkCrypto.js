// The Arcane link protocol's names and arithmetic (services/arcaneLink.js), with
// no dependency but node:crypto: the harness's peer stub runs this file as it
// ships in the node image.

const crypto = require('node:crypto');

const CAPABILITY = 'arcaneLink';
const NONCE_TYPE = 'fluxlinknonce';
const CONFIRM_TYPE = 'fluxlinkconfirm';

const HEX_32_BYTES = /^[0-9a-f]{64}$/;
// `M<64 hex>|`: a link MAC over the rest of the frame.
const FRAME_PREFIX_LENGTH = 66;

function hmac(key, text) {
  return crypto.createHmac('sha256', key).update(text).digest();
}

/**
 * Whether a value is 32 bytes of lower-case hex, as a nonce and a MAC are sent.
 * @param {*} value
 * @returns {boolean}
 */
function isHex32(value) {
  return typeof value === 'string' && HEX_32_BYTES.test(value);
}

/**
 * The fluxbench encryptmessage parameter that encrypts `text` under the
 * node-auth identity. `blockHeight` does not change the output.
 * @param {string} text
 * @returns {string}
 */
function nodeAuthRequest(text) {
  return JSON.stringify({
    fluxID: 'ARCANEOS_NODE_AUTH', appName: 'ARCANEOS_SYSTEM', message: text, blockHeight: 0,
  });
}

/**
 * The text both ends of a link have fluxbench encrypt. Each pair is sorted, so
 * both derive one value; hashed, so fluxbench encrypts a fixed 64 characters.
 * @param {{localNonce: string, peerNonce: string, localPubKey: string, peerPubKey: string,
 *   localIp: string, peerIp: string}} link Each IP as its own end knows it: its
 *   listed address, and the address the socket comes from.
 * @returns {string}
 */
function transcript(link) {
  const sorted = (a, b) => [a, b].sort().join(',');
  const text = [
    NONCE_TYPE, 1,
    sorted(link.localNonce, link.peerNonce),
    sorted(link.localPubKey, link.peerPubKey),
    sorted(link.localIp, link.peerIp),
  ].join('|');
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * One key per direction, named by its sender's nonce, so nothing sent on a link
 * verifies when it is sent back.
 * @param {string} secret fluxbench's encryption of the transcript.
 * @param {string} localNonce
 * @param {string} peerNonce
 * @returns {{sendKey: Buffer, recvKey: Buffer}}
 */
function directionKeys(secret, localNonce, peerNonce) {
  return {
    sendKey: hmac(secret, `send|${localNonce}`),
    recvKey: hmac(secret, `send|${peerNonce}`),
  };
}

/**
 * The proof, under a direction's key, that its sender derived the secret.
 * @param {Buffer} key
 * @returns {string} Hex.
 */
function confirmMac(key) {
  return hmac(key, CONFIRM_TYPE).toString('hex');
}

/**
 * Whether `mac` is the confirm made under `key`.
 * @param {Buffer} key
 * @param {*} mac
 * @returns {boolean}
 */
function confirmVerifies(key, mac) {
  return isHex32(mac) && crypto.timingSafeEqual(Buffer.from(mac, 'hex'), hmac(key, CONFIRM_TYPE));
}

/**
 * A text frame under a link MAC.
 * @param {Buffer} key The sender's direction key.
 * @param {string} frame
 * @returns {string}
 */
function sealFrame(key, frame) {
  return `M${hmac(key, frame).toString('hex')}|${frame}`;
}

/**
 * The frame under a link MAC prefix, when the MAC is the one `key` makes.
 * @param {Buffer} key The peer's direction key.
 * @param {string} raw A frame beginning with `M`.
 * @returns {string|null}
 */
function openFrame(key, raw) {
  if (raw.length < FRAME_PREFIX_LENGTH || raw[FRAME_PREFIX_LENGTH - 1] !== '|') return null;
  const mac = raw.substring(1, FRAME_PREFIX_LENGTH - 1);
  if (!isHex32(mac)) return null;
  const rest = raw.substring(FRAME_PREFIX_LENGTH);
  return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), hmac(key, rest)) ? rest : null;
}

module.exports = {
  CAPABILITY,
  NONCE_TYPE,
  CONFIRM_TYPE,
  isHex32,
  nodeAuthRequest,
  transcript,
  directionKeys,
  confirmMac,
  confirmVerifies,
  sealFrame,
  openFrame,
};
