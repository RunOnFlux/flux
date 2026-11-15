'use strict';

const crypto = require('crypto');
const net = require('net');
const daemonServiceUtils = require('../daemonService/daemonServiceUtils');
const benchmarkService = require('../benchmarkService');
const { resolveClientIp } = require('./ingressCapture');

// The tag an entry node puts on an unpaid app message for the client that sent
// it. Every node counts unpaid messages per tag, so one client is held to the
// same allowance whichever nodes it submits through.
//
// The tag is an HMAC of the client's address under an epoch key: fluxbench's
// node-auth encryption of the hash of a recent block, which every Arcane node
// computes alike and no other can. Only Arcane nodes admit unpaid messages, so
// only they ever compute a tag; without the key, a tag tells nobody whether a
// guessed address made it. Receivers never compute a tag; they compare them.

// The key's block is the newest multiple of TAG_EPOCH_BLOCKS that is at least
// TAG_DEPTH_BLOCKS deep, so it changes hourly and a one-block reorg at the tip
// does not change it.
const TAG_EPOCH_BLOCKS = 120;
const TAG_DEPTH_BLOCKS = 10;

// The epoch key for each height asked for, one fluxbench call per height.
// Cleared when the height moves.
const epochKeys = new Map();
let epochKeysHeight = null;

/**
 * The salt height for a tip.
 * @param {number} tip
 * @returns {number}
 */
function tagHeightFor(tip) {
  return Math.floor((tip - TAG_DEPTH_BLOCKS) / TAG_EPOCH_BLOCKS) * TAG_EPOCH_BLOCKS;
}

/**
 * Whether a message's salt height is this node's current one or a neighbour of
 * it. Nodes a few blocks apart straddle a boundary, and a message admitted just
 * before one is still being relayed just after it.
 * @param {*} height
 * @param {number} tip
 * @returns {boolean}
 */
function tagHeightIsCurrent(height, tip) {
  if (!Number.isInteger(height) || height % TAG_EPOCH_BLOCKS !== 0) return false;
  return Math.abs(height - tagHeightFor(tip)) <= TAG_EPOCH_BLOCKS;
}

/**
 * The part of an address that names one client: an IPv4 address whole, an IPv6
 * address by its /64, the smallest block one customer is given.
 * @param {string} ip
 * @returns {string|null}
 */
function clientPrefix(ip) {
  const family = net.isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = ip.includes('::') && tail ? tail.split(':') : [];
  // A trailing dotted IPv4 part fills the last two groups.
  const tailWidth = tailGroups.length + (tailGroups.at(-1)?.includes('.') ? 1 : 0);
  const groups = [...headGroups, ...new Array(8 - headGroups.length - tailWidth).fill('0'), ...tailGroups];
  return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

async function blockHashAt(height) {
  const response = await daemonServiceUtils.executeCall('getBlockHash', [height]);
  if (response.status !== 'success' || typeof response.data !== 'string') {
    throw new Error(`Unable to read the block hash at ${height}`);
  }
  return response.data;
}

function epochKeyAt(height) {
  if (epochKeysHeight !== height) {
    epochKeys.clear();
    epochKeysHeight = height;
  }
  let key = epochKeys.get(height);
  if (!key) {
    key = (async () => {
      const blockHash = await blockHashAt(height);
      const encrypted = await benchmarkService.nodeAuthEncrypt(`fluxclienttag|${blockHash}`);
      if (!encrypted) throw new Error('This node cannot tag clients now. Try another node.');
      return encrypted;
    })();
    epochKeys.set(height, key);
    // A key that could not be made is asked for again by the next request.
    key.catch(() => { if (epochKeys.get(height) === key) epochKeys.delete(height); });
  }
  return key;
}

async function computeTag(prefix, height) {
  const key = await epochKeyAt(height);
  return crypto.createHmac('sha256', key).update(prefix).digest('hex');
}

/**
 * The tag for the client of a request, and the height of the block its epoch
 * key was made from.
 * @param {{remoteAddress?: string, headers?: object}} client The request's socket
 *   peer and headers.
 * @param {number} tip This node's daemon height.
 * @returns {Promise<{clientTag: string, clientTagHeight: number}>}
 */
async function clientTagFor({ remoteAddress, headers }, tip) {
  const { ip } = resolveClientIp(remoteAddress, headers);
  const prefix = ip ? clientPrefix(ip) : null;
  if (!prefix) throw new Error('Unable to determine the address this request came from');

  const height = tagHeightFor(tip);
  const clientTag = await computeTag(prefix, height);
  return { clientTag, clientTagHeight: height };
}

module.exports = {
  TAG_EPOCH_BLOCKS,
  clientPrefix,
  clientTagFor,
  tagHeightFor,
  tagHeightIsCurrent,
};
