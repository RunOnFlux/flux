'use strict';

const config = require('config');
const dbHelper = require('../dbHelper');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const { clientTagFor, tagHeightIsCurrent } = require('../utils/clientTag');
const { globalAppsTempMessages, appsHashesCollection } = require('../utils/appConstants');

// Whether a node takes an unpaid app message, by how many it already holds from
// the same client and from the same admitting operator.
//
// A message carries `clientTag` (utils/clientTag) from the node that admitted it,
// and that node's signed frame travels with it as `origin`: a live announcement
// is its own origin, and every reply rebuilt from storage sends the stored one.
// So whichever route a message takes, its tag is the one the admitting operator
// signed, and the operator is known by that signature.
//
// A message without a tag was admitted or rebuilt by a release that does not
// make them. It is taken without a count, and carries no origin: a rebuilt reply
// is signed by whoever answered, not by whoever admitted. An allowance shared by
// those releases' messages is one an attacker submitting through them could use
// up for every other client of them.
//
// Only unpaid messages are counted or refused. A hash with a payment on chain is
// taken whatever it carries, and is left out of every count.

const TAG_PATTERN = /^[0-9a-f]{64}$/;

// What the message inside a stored origin may hold. The origin is kept as it was
// signed and served again with every reply, so a field outside these would be
// stored and relayed on every node at whatever size its signer chose; with only
// these, the hash binds the specification and the origin is no larger than the
// message it carries.
const ORIGIN_FIELDS = new Set([
  'type', 'version', 'appSpecifications', 'hash', 'timestamp', 'signature', 'arcaneSender', 'clientTag', 'clientTagHeight',
]);

/**
 * A frame's signed fields, as they are verified.
 * @param {object} frame
 * @returns {{version: number, timestamp: number, pubKey: string, signature: string, data: object}}
 */
function signedFrame(frame) {
  const {
    version, timestamp, pubKey, signature, data,
  } = frame;
  return {
    version, timestamp, pubKey, signature, data,
  };
}

/**
 * The frame that admitted a message, and the message as it signed it.
 * @param {object} message
 * @param {object} [frame] The frame the message arrived in, when it arrived alone.
 * @returns {Promise<{refused?: string, origin?: string, originKey?: string, admitted?: object}>}
 */
async function resolveOrigin(message, frame) {
  if (message.origin === undefined) {
    if (frame?.data !== message) return { admitted: message };
    return { origin: JSON.stringify(signedFrame(frame)), originKey: frame.pubKey, admitted: message };
  }
  if (typeof message.origin !== 'string') return { refused: 'its origin is not a frame' };

  let parsed;
  try {
    parsed = JSON.parse(message.origin);
  } catch {
    return { refused: 'its origin is not a frame' };
  }
  if (parsed?.data?.hash !== message.hash) return { refused: 'its origin is for another message' };

  const [{ result, reason }] = await fluxCommunicationUtils.verifyBroadcasts([parsed]);
  if (result === fluxCommunicationUtils.VerifyResult.UNREADABLE) {
    throw new Error(`The origin of ${message.hash} could not be verified: ${reason}`);
  }
  if (result !== fluxCommunicationUtils.VerifyResult.OK) return { refused: `its origin does not verify (${result})` };
  return { origin: message.origin, originKey: parsed.pubKey, admitted: parsed.data };
}

/**
 * How many unpaid messages the temporary store holds that match a query.
 * @param {object} query
 * @returns {Promise<number>}
 */
async function unpaidCount(query) {
  const db = dbHelper.databaseConnection();
  const held = await dbHelper.findInDatabase(
    db.db(config.database.appsglobal.database),
    globalAppsTempMessages,
    query,
    { projection: { _id: 0, hash: 1 } },
  );
  if (held.length === 0) return 0;
  const paid = await dbHelper.countInDatabase(
    db.db(config.database.daemon.database),
    appsHashesCollection,
    { hash: { $in: held.map((doc) => doc.hash) } },
  );
  return held.length - paid;
}

/**
 * Why a client or an operator may not admit another unpaid message, or null.
 * @param {{clientTag?: string, originKey?: string}} sender
 * @returns {Promise<string|null>}
 */
async function overAllowance({ clientTag, originKey }) {
  const { clientTagCap, originKeyCap } = config.fluxapps;
  if (clientTag && await unpaidCount({ clientTag }) >= clientTagCap) {
    return `its client already has ${clientTagCap} unpaid app messages pending`;
  }
  if (originKey && await unpaidCount({ originKey }) >= originKeyCap) {
    return `its admitting operator already has ${originKeyCap} unpaid app messages pending`;
  }
  return null;
}

/**
 * Whether to take an unpaid message, and what to store with it.
 * @param {object} message The message, as it arrived.
 * @param {object} options
 * @param {object} [options.frame] The frame it arrived in, when it arrived alone.
 * @param {number} options.daemonHeight
 * @returns {Promise<{refused: string}|{fields: object}>}
 */
async function admitUnpaid(message, { frame, daemonHeight }) {
  const resolved = await resolveOrigin(message, frame);
  if (resolved.refused) return { refused: resolved.refused };

  const { clientTag, clientTagHeight } = resolved.admitted;
  if (clientTag === undefined) return { fields: {} };

  if (typeof clientTag !== 'string' || !TAG_PATTERN.test(clientTag)) return { refused: 'its client tag is malformed' };
  if (!tagHeightIsCurrent(clientTagHeight, daemonHeight)) return { refused: `its client tag height ${clientTagHeight} is not current` };
  if (!resolved.origin) return { refused: 'it carries a client tag without the frame that admitted it' };
  const extra = Object.keys(resolved.admitted).filter((field) => !ORIGIN_FIELDS.has(field));
  if (extra.length) return { refused: `its origin carries fields an app message does not have: ${extra.join(', ')}` };

  const over = await overAllowance({ clientTag, originKey: resolved.originKey });
  if (over) return { refused: over };

  return {
    fields: {
      clientTag, clientTagHeight, origin: resolved.origin, originKey: resolved.originKey,
    },
  };
}

/**
 * The client tag for a message this node is about to admit. Refuses when its
 * client, or this node's operator, has no allowance left, because every peer
 * would refuse the message.
 * @param {{remoteAddress?: string, headers?: object}} client The request's socket
 *   peer and headers.
 * @param {number} daemonHeight
 * @returns {Promise<{clientTag: string, clientTagHeight: number}>}
 */
async function tagSubmission(client, daemonHeight) {
  const tag = await clientTagFor(client, daemonHeight);
  const originKey = await fluxNetworkHelper.getFluxNodePublicKey();
  const over = await overAllowance({ clientTag: tag.clientTag, originKey });
  if (over) throw new Error(`The network will not take this app message: ${over}. Pending messages expire after an hour.`);
  return tag;
}

module.exports = {
  admitUnpaid,
  overAllowance,
  tagSubmission,
};
