'use strict';

const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const { clientTagFor, tagHeightIsCurrent } = require('../utils/clientTag');
const unpaidAllowances = require('../utils/unpaidAllowances');
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
// make them. Until the network's version floor reaches the first release that
// tags (fluxapps.untaggedRefusedFrom) it is taken from any peer without a count,
// and carries no origin: a rebuilt reply is signed by whoever answered, not by
// whoever admitted. An allowance shared by those releases' messages is one an
// attacker submitting through them could use up for every other client of them.
// From that floor every node runs a release that tags, and one is refused.
//
// A node that is not ArcaneOS counts a message against its operator only. An
// unpaid message reaches an ArcaneOS node only from ArcaneOS nodes, so there its
// tag is the admitting node's reading of the caller; any node that signs can
// send a node that is not ArcaneOS a message under any tag, so a tag counted
// there would let it use up a client's allowance. Its own signature it cannot
// put on another operator's messages.
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
  type, version, appSpecifications, hash, timestamp, signature, arcaneSender, clientTag, clientTagHeight, clientTagCap,
}) {
  return {
    type,
    version,
    appSpecifications,
    hash,
    timestamp,
    signature,
    arcaneSender,
    clientTag,
    clientTagHeight,
    // only where a submitter range granted one
    ...(clientTagCap !== undefined && { clientTagCap }),
  };
}

/**
 * Whether an unpaid message without a client tag is refused: once the network's
 * version floor is a release that tags every unpaid message it admits.
 * @returns {boolean}
 */
function untaggedRefused() {
  return serviceHelper.semverAtLeast(config.minimumFluxOSAllowedVersion, config.fluxapps.untaggedRefusedFrom);
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

// The tagged messages this node has let past both allowances and not yet
// written or let go, by hash: those being admitted, and updates waiting in the
// queue for their registration. Each counts against its client and its operator
// as a stored message does, so messages admitted at the same moment are held to
// the same allowance as messages admitted one after another. An entry lives
// exactly as long as something holds it: every holder releases it once its
// message is written, refused, dropped or leaves the queue.
const inFlight = new Map();

// Every reservation and every release run one at a time, in arrival order.
// While a reservation reads the store no message leaves inFlight, so one written
// during the read is still counted, once, by its hash. A reservation holds the
// turn only for its two indexed reads.
let allowanceTurn = Promise.resolve();

/**
 * Run a task once every earlier check and release has finished.
 * @param {function(): (Promise<*>|*)} task
 * @returns {Promise<*>}
 */
function inTurn(task) {
  const run = allowanceTurn.then(task);
  allowanceTurn = run.catch(() => {});
  return run;
}

/**
 * The hashes of the unpaid messages the temporary store holds that match a query.
 * @param {object} query
 * @returns {Promise<string[]>}
 */
async function storedUnpaid(query) {
  const db = dbHelper.databaseConnection();
  const held = await dbHelper.findInDatabase(
    db.db(config.database.appsglobal.database),
    globalAppsTempMessages,
    query,
    { projection: { _id: 0, hash: 1 } },
  );
  if (held.length === 0) return [];
  const paid = await dbHelper.findInDatabase(
    db.db(config.database.daemon.database),
    appsHashesCollection,
    { hash: { $in: held.map((doc) => doc.hash) } },
    { projection: { _id: 0, hash: 1 } },
  );
  const paidHashes = new Set(paid.map((doc) => doc.hash));
  return held.map((doc) => doc.hash).filter((hash) => !paidHashes.has(hash));
}

/**
 * How many unpaid messages count against one sender: those stored, and those
 * in flight. A message both stored and in flight counts once.
 * @param {string[]} stored The stored unpaid hashes matching the sender.
 * @param {'clientTag'|'originKey'} field
 * @param {string} value
 * @returns {number}
 */
function pendingCount(stored, field, value) {
  let count = stored.filter((hash) => !inFlight.has(hash)).length;
  inFlight.forEach((entry) => { if (entry[field] === value) count += 1; });
  return count;
}

/**
 * The stored unpaid messages of a client and of an operator.
 * @param {{clientTag?: string, originKey?: string}} sender
 * @returns {Promise<{byTag: string[], byKey: string[]}>}
 */
async function storedFor({ clientTag, originKey }) {
  const [byTag, byKey] = await Promise.all([
    clientTag ? storedUnpaid({ clientTag }) : [],
    originKey ? storedUnpaid({ originKey }) : [],
  ]);
  return { byTag, byKey };
}

/**
 * Why a client or an operator may not admit another unpaid message, or null.
 * Synchronous, so that no admission can be let past between this count and the
 * reservation its caller makes on it.
 * @param {{clientTag?: string, originKey?: string, clientTagCap?: number}} sender
 *   clientTagCap is the cap a submitter range grants the client, when one does.
 * @param {{byTag: string[], byKey: string[]}} stored
 * @returns {string|null}
 */
function allowanceRefusal({ clientTag, originKey, clientTagCap: granted }, { byTag, byKey }) {
  const allowed = unpaidAllowances.allowances();
  const clientTagCap = Math.max(granted ?? 0, allowed.clientTagCap);
  const { originKeyCap } = allowed;
  if (clientTag && pendingCount(byTag, 'clientTag', clientTag) >= clientTagCap) {
    return `its client already has ${clientTagCap} unpaid app messages pending`;
  }
  if (originKey && pendingCount(byKey, 'originKey', originKey) >= originKeyCap) {
    return `its admitting operator already has ${originKeyCap} unpaid app messages pending`;
  }
  return null;
}

/**
 * Why a client or an operator may not admit another unpaid message, or null.
 * @param {{clientTag?: string, originKey?: string}} sender
 * @returns {Promise<string|null>}
 */
async function overAllowance(sender) {
  return allowanceRefusal(sender, await storedFor(sender));
}

/**
 * Hold a message's place in its client's and its operator's allowances, or
 * refuse it. A message with this hash already in flight shares that place: one
 * hash is written once.
 * @param {string} hash
 * @param {{clientTag: string, originKey: string}} sender
 * @returns {Promise<{refused: string}|{release: function(): void}>}
 */
function reserve(hash, sender) {
  return inTurn(async () => {
    const stored = await storedFor(sender);
    let entry = inFlight.get(hash);
    if (!entry) {
      const refused = allowanceRefusal(sender, stored);
      if (refused) return { refused };
      entry = { ...sender, holders: 0 };
      inFlight.set(hash, entry);
    }
    // One holder's release: gives its share back once, in turn.
    const hold = () => {
      entry.holders += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inTurn(() => {
          entry.holders -= 1;
          if (entry.holders === 0) inFlight.delete(hash);
        });
      };
    };
    return { release: hold(), keep: hold };
  });
}

/**
 * Whether to take an unpaid message, and what to store with it.
 * @param {object} message The message, as it arrived.
 * @param {object} options
 * @param {object} [options.frame] The frame it arrived in, when it arrived alone.
 * @param {number} options.daemonHeight
 * @returns {Promise<{refused: string}|{fields: object, release?: function(): void,
 *   keep?: function(): function(): void}>} A tagged message that is taken holds its
 *   place in both allowances until the caller calls `release`, once the message is
 *   written, refused or let go. `keep` takes a further hold on the same place for
 *   whatever keeps the message beyond that, and returns that hold's release.
 */
async function admitUnpaid(message, { frame, daemonHeight }) {
  const {
    clientTag, clientTagHeight, clientTagCap, arcaneSender,
  } = message;
  if (clientTag === undefined) return untaggedRefused() ? { refused: 'it carries no client tag' } : { fields: {} };

  if (typeof clientTag !== 'string' || !TAG_PATTERN.test(clientTag)) return { refused: 'its client tag is malformed' };
  if (!tagHeightIsCurrent(clientTagHeight, daemonHeight)) return { refused: `its client tag height ${clientTagHeight} is not current` };
  if (typeof arcaneSender !== 'boolean') return { refused: 'its arcaneSender is not a boolean' };
  if (clientTagCap !== undefined) {
    if (!Number.isInteger(clientTagCap) || clientTagCap <= 0) return { refused: 'its client cap is malformed' };
    const { largestClientCap } = unpaidAllowances.allowances();
    if (clientTagCap > largestClientCap) return { refused: `its client cap ${clientTagCap} is above the largest the network policy grants (${largestClientCap})` };
  }

  const resolved = await resolveOrigin(message, frame);
  if (resolved.refused) return { refused: resolved.refused };

  const counted = process.env.FLUXOS_PATH
    ? { clientTag, originKey: resolved.originKey, clientTagCap }
    : { originKey: resolved.originKey };
  const place = await reserve(message.hash, counted);
  if (place.refused) return { refused: place.refused };

  return {
    fields: {
      clientTag,
      clientTagHeight,
      // present only when its admitting node wrote one: the origin signature covers it
      ...(clientTagCap !== undefined && { clientTagCap }),
      origin: resolved.origin,
      originKey: resolved.originKey,
    },
    release: place.release,
    keep: place.keep,
  };
}

/**
 * The client tag for a message this node is about to admit, and the cap a
 * submitter range grants its caller when one does. Refuses when its client, or
 * this node's operator, has no allowance left, because every peer would refuse
 * the message.
 * @param {{remoteAddress?: string, headers?: object}} client The request's socket
 *   peer and headers.
 * @param {number} daemonHeight
 * @returns {Promise<{clientTag: string, clientTagHeight: number, clientTagCap?: number}>}
 */
async function tagSubmission(client, daemonHeight) {
  const tag = await clientTagFor(client, daemonHeight);
  const granted = unpaidAllowances.submitterCap(client);
  const originKey = await fluxNetworkHelper.getFluxNodePublicKey();
  const over = await overAllowance({ clientTag: tag.clientTag, originKey, clientTagCap: granted ?? undefined });
  if (over) throw new Error(`The network will not take this app message: ${over}. Pending messages expire after an hour.`);
  return granted === null ? tag : { ...tag, clientTagCap: granted };
}

module.exports = {
  admitUnpaid,
  admittedMessage,
  overAllowance,
  tagSubmission,
};
