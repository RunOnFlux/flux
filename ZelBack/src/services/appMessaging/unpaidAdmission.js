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
// and that node's signature over the message travels with it as `origin`: a live
// announcement carries it as its own frame, and every reply rebuilt from storage
// sends the stored one. The signature covers the message as admittedMessage builds
// it, so any node rebuilds those bytes from the message it holds and re-checks
// them; whichever route a message takes, its tag is the one its admitting operator
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

// A node key in hex, compressed or not, and a signature in base64.
const ORIGIN_KEY_MAX = 130;
const ORIGIN_SIGNATURE_MAX = 100;

/**
 * An app message as the node that admits it signs it: these fields, in this
 * order, and nothing else. The admitting node builds what it broadcasts with
 * this, and every node rebuilds it to re-check that node's signature.
 * @param {object} message
 * @returns {object}
 */
function admittedMessage({
  type, version, appSpecifications, hash, timestamp, signature, arcaneSender, clientTag, clientTagHeight,
}) {
  return {
    type, version, appSpecifications, hash, timestamp, signature, arcaneSender, clientTag, clientTagHeight,
  };
}

/**
 * The parts of a frame that carry its signer's signature, or null when they are
 * not the shape a node sends.
 * @param {object} frame
 * @returns {{version: number, timestamp: number, pubKey: string, signature: string}|null}
 */
function originOf(frame) {
  const {
    version, timestamp, pubKey, signature,
  } = frame ?? {};
  if (version !== 1 || !Number.isFinite(timestamp)) return null;
  if (typeof pubKey !== 'string' || !pubKey || pubKey.length > ORIGIN_KEY_MAX) return null;
  if (typeof signature !== 'string' || !signature || signature.length > ORIGIN_SIGNATURE_MAX) return null;
  return {
    version, timestamp, pubKey, signature,
  };
}

/**
 * The signature of the node that admitted a tagged message, checked against the
 * message itself.
 * @param {object} message
 * @param {object} [frame] The frame the message arrived in, when it arrived alone.
 * @returns {Promise<{refused?: string, origin?: object, originKey?: string}>}
 */
async function resolveOrigin(message, frame) {
  if (message.origin === undefined) {
    if (frame?.data !== message) return { refused: 'it carries a client tag without the signature of the node that admitted it' };
    // A live frame is the admitting node's own: its signature already verified, over
    // exactly these bytes. Kept only when they are the bytes every other node will
    // rebuild from the stored message, so the stored signature checks out later.
    const origin = originOf(frame);
    if (!origin) return { refused: 'its admitting frame is malformed' };
    if (JSON.stringify(frame.data) !== JSON.stringify(admittedMessage(frame.data))) {
      return { refused: 'it is not in the form its admitting node signs' };
    }
    return { origin, originKey: origin.pubKey };
  }

  const origin = originOf(message.origin);
  if (!origin) return { refused: 'its origin is malformed' };
  const [{ result, reason }] = await fluxCommunicationUtils.verifyBroadcasts([{ ...origin, data: admittedMessage(message) }]);
  if (result === fluxCommunicationUtils.VerifyResult.UNREADABLE) {
    throw new Error(`The origin of ${message.hash} could not be verified: ${reason}`);
  }
  if (result !== fluxCommunicationUtils.VerifyResult.OK) return { refused: `its origin does not verify (${result})` };
  return { origin, originKey: origin.pubKey };
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
  const { clientTag, clientTagHeight, arcaneSender } = message;
  if (clientTag === undefined) return { fields: {} };

  if (typeof clientTag !== 'string' || !TAG_PATTERN.test(clientTag)) return { refused: 'its client tag is malformed' };
  if (!tagHeightIsCurrent(clientTagHeight, daemonHeight)) return { refused: `its client tag height ${clientTagHeight} is not current` };
  if (typeof arcaneSender !== 'boolean') return { refused: 'its arcaneSender is not a boolean' };

  const resolved = await resolveOrigin(message, frame);
  if (resolved.refused) return { refused: resolved.refused };

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
  admittedMessage,
  overAllowance,
  tagSubmission,
};
