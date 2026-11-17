// The path a gossiped message took: what each node that handed it on signed.
//
// `networkPath` sits beside a broadcast's signed envelope, outside `data`, so a
// message's hash, its duplicate filter and its signature do not depend on it. It
// is diagnostic: nothing decides anything from it.
//
// Each hop is [offsetMs, signature]: when it was sent, as an offset from the
// broadcast's timestamp, and the node's signature over a label of its own, the
// hop before it or the message's hash, that time and the address it was sent to.
// The label keeps a hop from being the bytes of anything else the key signs, and
// is never sent. Naming the receiver and chaining the previous signature means no
// later node can edit, invent or remove a hop without breaking the chain; a node
// can misstate only its own time. The signature recovers the signer's key, so a
// hop carries no address: a reader walks back from itself, each hop's signer
// naming the address the hop before it was sent to.

const hash = require('object-hash');
const bitcoinMessage = require('./bitcoinMessage');
const secp256k1 = require('secp256k1');
const { normalizeSocketAddress } = require('./socketAddressUtils');

const MAX_HOPS = 16;
const HOP_SHAPE = /^[A-Za-z0-9+/]{87}=$/;
const HOP_LABEL = 'fluxnetworkpath';

/**
 * The text a hop signs.
 * @param {string} previous The previous hop's signature, or the message's hash.
 * @param {number} sentAt
 * @param {string} toAddress
 * @returns {string}
 */
function hopText(previous, sentAt, toAddress) {
  return `${HOP_LABEL}|${previous}|${sentAt}|${toAddress}`;
}

/**
 * The message's path, or an empty one when what arrived is not a path.
 * @param {*} path
 * @returns {Array<[number, string]>}
 */
function validPath(path) {
  if (!Array.isArray(path) || path.length > MAX_HOPS) return [];
  const wellFormed = path.every((hop) => Array.isArray(hop) && hop.length === 2
    && Number.isSafeInteger(hop[0]) && typeof hop[1] === 'string' && HOP_SHAPE.test(hop[1]));
  return wellFormed ? path : [];
}

/**
 * A message as sent to `toAddress`, its path extended by this node's hop.
 * @param {object} message The broadcast.
 * @param {function(string): ?string} sign This node's signature over a text.
 * @param {string} toAddress
 * @param {number} [now]
 * @returns {string} The frame.
 */
function framed(message, sign, toAddress, now = Date.now()) {
  const path = validPath(message.networkPath);
  if (path.length >= MAX_HOPS) return JSON.stringify({ ...message, networkPath: path });
  const previous = path.length ? path[path.length - 1][1] : hash(message.data);
  const signature = sign(hopText(previous, now, toAddress));
  if (!signature) return JSON.stringify({ ...message, networkPath: path });
  return JSON.stringify({ ...message, networkPath: [...path, [now - message.timestamp, signature]] });
}

/**
 * The key that signed `text`, or null, in the form the signature declares. A
 * signature's first byte is 27 plus the recovery id, plus 4 when the signer's key
 * is compressed; a node signs with its key in the form it is listed under, so the
 * key comes back as the node list spells it. Any signature recovers some key: it
 * means something only when the key is a listed node's.
 * @param {string} text
 * @param {string} signature
 * @returns {?string} Hex.
 */
function recoverKey(text, signature) {
  try {
    const raw = Buffer.from(signature, 'base64');
    const header = raw[0] - 27;
    if (raw.length !== 65 || header < 0 || header > 7) return null;
    const key = secp256k1.ecdsaRecover(raw.subarray(1), header % 4, bitcoinMessage.magicHash(text), header >= 4);
    return Buffer.from(key).toString('hex');
  } catch {
    return null;
  }
}

/**
 * A received path, read back from this node.
 * @param {{hash: string, timestamp: number, networkPath: Array}} received
 * @param {string} ownAddress
 * @param {function(string): Promise<string[]>} addressesOf The addresses a key is listed at,
 *   in the node list's form: a node on the default API port may be listed by its IP alone.
 *   A hop names its receiver as ip:port, so each is compared with its port.
 * @returns {Promise<{verified: boolean, hops: Array<{sentAt: number, pubKey: string, to: string}>}>}
 *   Each hop in order; `verified` is false where the chain breaks, with the hops read until then.
 */
async function readPath(received, ownAddress, addressesOf) {
  const path = validPath(received.networkPath);
  const hops = [];
  let receivers = [ownAddress];
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const previous = i > 0 ? path[i - 1][1] : received.hash;
    const sentAt = received.timestamp + path[i][0];
    let found = null;
    // eslint-disable-next-line no-restricted-syntax
    for (const to of receivers) {
      const pubKey = recoverKey(hopText(previous, sentAt, to), path[i][1]);
      // eslint-disable-next-line no-await-in-loop
      const addresses = pubKey ? (await addressesOf(pubKey)).map(normalizeSocketAddress).filter(Boolean) : [];
      if (addresses.length) {
        found = { sentAt, pubKey, to, addresses };
        break;
      }
    }
    if (!found) return { verified: false, hops };
    hops.unshift({ sentAt: found.sentAt, pubKey: found.pubKey, to: found.to });
    receivers = found.addresses;
  }
  return { verified: true, hops };
}

module.exports = {
  MAX_HOPS, validPath, framed, readPath, hopText,
};
