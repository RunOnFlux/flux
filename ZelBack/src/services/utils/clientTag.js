'use strict';

const crypto = require('crypto');
const net = require('net');
const { promisify } = require('util');
const daemonServiceUtils = require('../daemonService/daemonServiceUtils');
const { resolveClientIp } = require('./ingressCapture');
const { AsyncLock } = require('./asyncLock');

// The tag an entry node puts on an unpaid app message for the client that sent
// it. Every node counts unpaid messages per tag, so one client is held to the
// same allowance whichever nodes it submits through.
//
// The tag is scrypt over the client's address, salted with the hash of a recent
// block. Nobody can build a table for a salt before its block exists, and
// scrypt makes searching the address space for one salt cost decades of CPU.
// Receivers never compute a tag; they compare them.

// The salt is the block at the newest multiple of TAG_EPOCH_BLOCKS that is at
// least TAG_DEPTH_BLOCKS deep, so it changes hourly and a one-block reorg at the
// tip does not change it.
const TAG_EPOCH_BLOCKS = 120;
const TAG_DEPTH_BLOCKS = 10;

// About 0.35 s and 128 MB per tag.
const SCRYPT_OPTIONS = Object.freeze({
  N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024,
});
const TAG_BYTES = 32;

// One scrypt runs at a time, because each holds 128 MB. Callers past
// MAX_WAITING are refused rather than queued without bound.
const MAX_WAITING = 20;

const scrypt = promisify(crypto.scrypt);

const scryptLock = new AsyncLock();

// Tags for the current salt, keyed by address prefix. Cleared when the salt
// height moves.
const tags = new Map();
let tagsHeight = null;

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

async function computeTag(prefix, height) {
  const salt = await blockHashAt(height);
  if (scryptLock.waiterCount >= MAX_WAITING) throw new Error('This node is busy admitting other app messages. Try again shortly.');
  await scryptLock.enable();
  try {
    const key = await scrypt(prefix, salt, TAG_BYTES, SCRYPT_OPTIONS);
    return key.toString('hex');
  } finally {
    scryptLock.disable();
  }
}

/**
 * The tag for the client of a request, and the salt height it was made with.
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
  if (tagsHeight !== height) {
    tags.clear();
    tagsHeight = height;
  }
  let clientTag = tags.get(prefix);
  if (!clientTag) {
    clientTag = await computeTag(prefix, height);
    if (tagsHeight === height) tags.set(prefix, clientTag);
  }
  return { clientTag, clientTagHeight: height };
}

module.exports = {
  TAG_EPOCH_BLOCKS,
  clientPrefix,
  clientTagFor,
  tagHeightFor,
  tagHeightIsCurrent,
};
