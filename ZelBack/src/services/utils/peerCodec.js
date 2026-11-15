/**
 * Binary codec for peer-level messages.
 *
 * All frames start with a 1-byte type tag. WebSocket binary frames (Buffer)
 * are distinguished from text frames (string) natively by the WS protocol.
 *
 * Type 0x01 — messageHashPresent  [type:1][hash:20]           = 21 bytes
 * Type 0x02 — requestMessageHash  [type:1][hash:20]           = 21 bytes
 * Type 0x03 — nak                 [type:1][hash:20][reason:1]  = 22 bytes
 * Type 0x10 — peerExchange        [type:1][count:2][peer:6]... = 3 + count*6
 * Type 0x11 — peerUpdate          [type:1][addCnt:2][rmCnt:2][peer:6]... = 5 + total*6
 * Type 0x20 — requestTempMessages  [type:1][sinceTs:8]          = 9 bytes
 * Type 0x21 — requestAppRunning   [type:1][sinceTs:8]          = 9 bytes
 * Type 0x22 — requestAppInstalling [type:1][sinceTs:8]         = 9 bytes
 * Type 0x23 — requestAppInstallingErrors [type:1][sinceTs:8]  = 9 bytes
 * Type 0x30 — linkNonce           signed, see Link handshake below
 * Type 0x31 — linkConfirm         signed, see Link handshake below
 * Type 0x32 — linkNoConfirm       signed, see Link handshake below
 */

const { NONCE_TYPE, CONFIRM_TYPE, isHex32 } = require('./linkCrypto');

const MSG_TYPE = Object.freeze({
  HASH_PRESENT: 0x01,
  HASH_REQUEST: 0x02,
  NAK: 0x03,
  PEER_EXCHANGE: 0x10,
  PEER_UPDATE: 0x11,
  REQUEST_TEMP_MESSAGES: 0x20,
  REQUEST_APP_RUNNING: 0x21,
  REQUEST_APP_INSTALLING: 0x22,
  REQUEST_APP_INSTALLING_ERRORS: 0x23,
  LINK_NONCE: 0x30,
  LINK_CONFIRM: 0x31,
  LINK_NO_CONFIRM: 0x32,
});

const NAK_REASON = Object.freeze({
  STALE: 0,
  DUPLICATE: 1,
  INVALID: 2,
});

// --- Peer encoding helpers ---

/**
 * Encode "ip:port" string to 6 bytes (4 bytes IPv4 + 2 bytes port BE).
 * @param {Buffer} buf Target buffer
 * @param {number} offset Write offset
 * @param {string} key "1.2.3.4:16127"
 * @returns {number} New offset (offset + 6)
 */
function writePeer(buf, offset, key) {
  const colonIdx = key.lastIndexOf(':');
  const ipStr = key.substring(0, colonIdx);
  const port = parseInt(key.substring(colonIdx + 1), 10);
  const parts = ipStr.split('.');
  buf[offset] = parseInt(parts[0], 10);
  buf[offset + 1] = parseInt(parts[1], 10);
  buf[offset + 2] = parseInt(parts[2], 10);
  buf[offset + 3] = parseInt(parts[3], 10);
  buf.writeUInt16BE(port, offset + 4);
  return offset + 6;
}

/**
 * Decode 6 bytes at offset to "ip:port" string.
 * @param {Buffer} buf Source buffer
 * @param {number} offset Read offset
 * @returns {string} "1.2.3.4:16127"
 */
function readPeer(buf, offset) {
  const ip = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
  const port = buf.readUInt16BE(offset + 4);
  return `${ip}:${port}`;
}

// --- Hash messages ---

function encodeHashPresent(hexHash) {
  const buf = Buffer.allocUnsafe(21);
  buf[0] = MSG_TYPE.HASH_PRESENT;
  buf.write(hexHash, 1, 20, 'hex');
  return buf;
}

function decodeHashPresent(buf) {
  return { hash: buf.toString('hex', 1, 21) };
}

function encodeHashRequest(hexHash) {
  const buf = Buffer.allocUnsafe(21);
  buf[0] = MSG_TYPE.HASH_REQUEST;
  buf.write(hexHash, 1, 20, 'hex');
  return buf;
}

function decodeHashRequest(buf) {
  return { hash: buf.toString('hex', 1, 21) };
}

// --- NAK ---

function encodeNak(hexHash, reasonCode) {
  const buf = Buffer.allocUnsafe(22);
  buf[0] = MSG_TYPE.NAK;
  buf.write(hexHash, 1, 20, 'hex');
  buf[21] = reasonCode;
  return buf;
}

function decodeNak(buf) {
  return {
    hash: buf.toString('hex', 1, 21),
    reason: buf[21],
  };
}

// --- Peer Exchange ---

function encodePeerExchange(outboundKeys, inboundKeys) {
  const outCount = outboundKeys.length;
  const inCount = inboundKeys.length;
  const buf = Buffer.allocUnsafe(5 + (outCount + inCount) * 6);
  buf[0] = MSG_TYPE.PEER_EXCHANGE;
  buf.writeUInt16BE(outCount, 1);
  buf.writeUInt16BE(inCount, 3);
  let offset = 5;
  for (let i = 0; i < outCount; i++) {
    offset = writePeer(buf, offset, outboundKeys[i]);
  }
  for (let i = 0; i < inCount; i++) {
    offset = writePeer(buf, offset, inboundKeys[i]);
  }
  return buf;
}

function decodePeerExchange(buf) {
  const outCount = buf.readUInt16BE(1);
  const inCount = buf.readUInt16BE(3);
  const expectedLen = 5 + (outCount + inCount) * 6;
  if (buf.length < expectedLen) return { outbound: [], inbound: [] };
  const outbound = new Array(outCount);
  const inbound = new Array(inCount);
  let offset = 5;
  for (let i = 0; i < outCount; i++) {
    outbound[i] = readPeer(buf, offset);
    offset += 6;
  }
  for (let i = 0; i < inCount; i++) {
    inbound[i] = readPeer(buf, offset);
    offset += 6;
  }
  return { outbound, inbound };
}

// --- Peer Update ---

function encodePeerUpdate(addOutKeys, addInKeys, rmKeys) {
  const addOutCount = addOutKeys.length;
  const addInCount = addInKeys.length;
  const rmCount = rmKeys.length;
  const total = addOutCount + addInCount + rmCount;
  const buf = Buffer.allocUnsafe(7 + total * 6);
  buf[0] = MSG_TYPE.PEER_UPDATE;
  buf.writeUInt16BE(addOutCount, 1);
  buf.writeUInt16BE(addInCount, 3);
  buf.writeUInt16BE(rmCount, 5);
  let offset = 7;
  for (let i = 0; i < addOutCount; i++) {
    offset = writePeer(buf, offset, addOutKeys[i]);
  }
  for (let i = 0; i < addInCount; i++) {
    offset = writePeer(buf, offset, addInKeys[i]);
  }
  for (let i = 0; i < rmCount; i++) {
    offset = writePeer(buf, offset, rmKeys[i]);
  }
  return buf;
}

function decodePeerUpdate(buf) {
  const addOutCount = buf.readUInt16BE(1);
  const addInCount = buf.readUInt16BE(3);
  const rmCount = buf.readUInt16BE(5);
  const expectedLen = 7 + (addOutCount + addInCount + rmCount) * 6;
  if (buf.length < expectedLen) return { addOutbound: [], addInbound: [], rm: [] };
  const addOutbound = new Array(addOutCount);
  const addInbound = new Array(addInCount);
  const rm = new Array(rmCount);
  let offset = 7;
  for (let i = 0; i < addOutCount; i++) {
    addOutbound[i] = readPeer(buf, offset);
    offset += 6;
  }
  for (let i = 0; i < addInCount; i++) {
    addInbound[i] = readPeer(buf, offset);
    offset += 6;
  }
  for (let i = 0; i < rmCount; i++) {
    rm[i] = readPeer(buf, offset);
    offset += 6;
  }
  return { addOutbound, addInbound, rm };
}

// --- Sync Requests ---
// Signed format: [type:1][sinceTs:8][requestTs:8][pubkeyLen:1][pubkey:var][sigLen:1][signature:var]

function encodeSignedSyncRequest(type, sinceTimestamp, requestTimestamp, pubkey, signature) {
  // The decoder refuses an empty key or signature, so an unsigned request is
  // refused by every node it reaches. A caller holding neither skipped a
  // check, so this throws rather than answering null.
  if (!pubkey || typeof pubkey !== 'string') throw new Error('peerCodec - a signed sync request needs a public key');
  if (!signature || typeof signature !== 'string') throw new Error('peerCodec - a signed sync request needs a signature');

  const pubkeyBuf = Buffer.from(pubkey, 'hex');
  const sigBuf = Buffer.from(signature, 'base64');
  const buf = Buffer.allocUnsafe(1 + 8 + 8 + 1 + pubkeyBuf.length + 1 + sigBuf.length);
  let offset = 0;
  buf[offset] = type; offset += 1;
  buf.writeBigUInt64BE(BigInt(sinceTimestamp), offset); offset += 8;
  buf.writeBigUInt64BE(BigInt(requestTimestamp), offset); offset += 8;
  buf[offset] = pubkeyBuf.length; offset += 1;
  pubkeyBuf.copy(buf, offset); offset += pubkeyBuf.length;
  buf[offset] = sigBuf.length; offset += 1;
  sigBuf.copy(buf, offset);
  return buf;
}

function decodeSignedSyncRequest(buf) {
  if (buf.length < 19) return null;
  const type = buf[0];
  let offset = 1;
  const sinceTimestamp = Number(buf.readBigUInt64BE(offset)); offset += 8;
  const requestTimestamp = Number(buf.readBigUInt64BE(offset)); offset += 8;
  const pubkeyLen = buf[offset]; offset += 1;
  if (buf.length < offset + pubkeyLen + 1) return null;
  const pubkey = buf.slice(offset, offset + pubkeyLen).toString('hex'); offset += pubkeyLen;
  const sigLen = buf[offset]; offset += 1;
  if (buf.length < offset + sigLen) return null;
  const signature = buf.slice(offset, offset + sigLen).toString('base64');
  if (!pubkeyLen || !sigLen) return null;
  return { type, sinceTimestamp, requestTimestamp, pubkey, signature };
}

function buildSyncSignatureMessage(type, sinceTimestamp, requestTimestamp) {
  return `${type}${sinceTimestamp}${requestTimestamp}`;
}

function encodeRequestTempMessages(sinceTimestamp, requestTimestamp, pubkey, signature) {
  return encodeSignedSyncRequest(MSG_TYPE.REQUEST_TEMP_MESSAGES, sinceTimestamp, requestTimestamp, pubkey, signature);
}

function encodeRequestAppRunning(sinceTimestamp, requestTimestamp, pubkey, signature) {
  return encodeSignedSyncRequest(MSG_TYPE.REQUEST_APP_RUNNING, sinceTimestamp, requestTimestamp, pubkey, signature);
}

function encodeRequestAppInstalling(sinceTimestamp, requestTimestamp, pubkey, signature) {
  return encodeSignedSyncRequest(MSG_TYPE.REQUEST_APP_INSTALLING, sinceTimestamp, requestTimestamp, pubkey, signature);
}

function encodeRequestAppInstallingErrors(sinceTimestamp, requestTimestamp, pubkey, signature) {
  return encodeSignedSyncRequest(MSG_TYPE.REQUEST_APP_INSTALLING_ERRORS, sinceTimestamp, requestTimestamp, pubkey, signature);
}

// --- Link handshake ---
// Signed format: [type:1][timestamp:8][value:32][keyLen:1][key:var][sigLen:1][signature:var]
// The value is a nonce, a confirm's MAC, or for linkNoConfirm the nonce of the handshake it
// gives up, so it speaks for that link alone. The frame decodes to the
// Flux broadcast that was signed, so it is verified as one.

const LINK_VALUE_BYTES = 32;
const LINK_HEADER_BYTES = 1 + 8;
const LINK_KEY_MAX_BYTES = 65;
const LINK_SIGNATURE_MAX_BYTES = 65;
const LINK_FRAME_MAX_BYTES = LINK_HEADER_BYTES + LINK_VALUE_BYTES + 1 + LINK_KEY_MAX_BYTES + 1 + LINK_SIGNATURE_MAX_BYTES;

function isLinkFrame(buf) {
  return buf[0] === MSG_TYPE.LINK_NONCE || buf[0] === MSG_TYPE.LINK_CONFIRM || buf[0] === MSG_TYPE.LINK_NO_CONFIRM;
}

/**
 * @param {{timestamp: number, pubKey: string, signature: string, data: object}} broadcast
 *   A signed link nonce or confirm.
 * @returns {Buffer}
 */
function encodeLinkFrame({
  timestamp, pubKey, signature, data,
}) {
  const gaveUp = data.type === CONFIRM_TYPE && data.mac === null;
  const value = data.type === NONCE_TYPE || gaveUp ? data.nonce : data.mac;
  if (!isHex32(value)) throw new Error('peerCodec - a link frame carries 32 bytes of hex');
  const confirm = gaveUp ? MSG_TYPE.LINK_NO_CONFIRM : MSG_TYPE.LINK_CONFIRM;
  const key = Buffer.from(pubKey, 'hex');
  const sig = Buffer.from(signature, 'base64');
  const header = Buffer.allocUnsafe(LINK_HEADER_BYTES);
  header[0] = data.type === NONCE_TYPE ? MSG_TYPE.LINK_NONCE : confirm;
  header.writeBigUInt64BE(BigInt(timestamp), 1);
  return Buffer.concat([
    header, Buffer.from(value, 'hex'),
    Buffer.from([key.length]), key, Buffer.from([sig.length]), sig,
  ]);
}

/**
 * @param {Buffer} buf
 * @returns {{version: number, timestamp: number, pubKey: string, signature: string, data: object}|null}
 *   The broadcast that was signed, or null when the frame is not one.
 */
function decodeLinkFrame(buf) {
  if (buf.length > LINK_FRAME_MAX_BYTES || buf.length < LINK_HEADER_BYTES + LINK_VALUE_BYTES + 2) return null;
  let offset = 1;
  const timestamp = Number(buf.readBigUInt64BE(offset)); offset += 8;
  const value = buf.subarray(offset, offset + LINK_VALUE_BYTES).toString('hex'); offset += LINK_VALUE_BYTES;
  const keyLen = buf[offset]; offset += 1;
  if (!keyLen || keyLen > LINK_KEY_MAX_BYTES || buf.length < offset + keyLen + 1) return null;
  const pubKey = buf.subarray(offset, offset + keyLen).toString('hex'); offset += keyLen;
  const sigLen = buf[offset]; offset += 1;
  if (!sigLen || sigLen > LINK_SIGNATURE_MAX_BYTES || buf.length !== offset + sigLen) return null;
  const signature = buf.subarray(offset).toString('base64');
  const dataOf = {
    [MSG_TYPE.LINK_NONCE]: { type: NONCE_TYPE, version: 1, nonce: value },
    [MSG_TYPE.LINK_CONFIRM]: { type: CONFIRM_TYPE, version: 1, mac: value },
    [MSG_TYPE.LINK_NO_CONFIRM]: {
      type: CONFIRM_TYPE, version: 1, mac: null, nonce: value,
    },
  };
  return {
    version: 1, timestamp, pubKey, signature, data: dataOf[buf[0]],
  };
}

function decodeSyncTimestamp(buf) {
  if (buf.length < 9) return 0;
  return Number(buf.readBigUInt64BE(1));
}

module.exports = {
  MSG_TYPE,
  NAK_REASON,
  writePeer,
  readPeer,
  encodeHashPresent,
  decodeHashPresent,
  encodeHashRequest,
  decodeHashRequest,
  encodeNak,
  decodeNak,
  encodePeerExchange,
  decodePeerExchange,
  encodePeerUpdate,
  decodePeerUpdate,
  encodeSignedSyncRequest,
  decodeSignedSyncRequest,
  buildSyncSignatureMessage,
  encodeRequestTempMessages,
  encodeRequestAppRunning,
  encodeRequestAppInstalling,
  encodeRequestAppInstallingErrors,
  LINK_FRAME_MAX_BYTES,
  isLinkFrame,
  encodeLinkFrame,
  decodeLinkFrame,
  decodeSyncTimestamp,
};
