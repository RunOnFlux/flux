/**
 * Binary codec for unsigned peer-level messages.
 *
 * All frames start with a 1-byte type tag. WebSocket binary frames (Buffer)
 * are distinguished from text frames (string) natively by the WS protocol.
 *
 * Type 0x01 — messageHashPresent  [type:1][hash:20]           = 21 bytes
 * Type 0x02 — requestMessageHash  [type:1][hash:20]           = 21 bytes
 * Type 0x03 — nak                 [type:1][hash:20][reason:1]  = 22 bytes
 * Type 0x10 — peerExchange        [type:1][count:2][peer:6]... = 3 + count*6
 * Type 0x11 — peerUpdate          [type:1][addCnt:2][rmCnt:2][peer:6]... = 5 + total*6
 * Type 0x20 — requestTempMessages [type:1]                    = 1 byte
 */

const MSG_TYPE = Object.freeze({
  HASH_PRESENT: 0x01,
  HASH_REQUEST: 0x02,
  NAK: 0x03,
  PEER_EXCHANGE: 0x10,
  PEER_UPDATE: 0x11,
  REQUEST_TEMP_MESSAGES: 0x20,
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

// --- Temp Message Sync ---

function encodeRequestTempMessages() {
  const buf = Buffer.allocUnsafe(1);
  buf[0] = MSG_TYPE.REQUEST_TEMP_MESSAGES;
  return buf;
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
  encodeRequestTempMessages,
};
