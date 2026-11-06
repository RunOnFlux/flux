const crypto = require('crypto');
const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const globalState = require('../utils/globalState');
const messageStore = require('./messageStore');
const { envelopeOf } = require('../utils/fluxBroadcastHelper');
const { validPath } = require('../utils/networkPath');
const { appsHashesCollection } = require('../utils/appConstants');

const { appsHeldMessages } = config.database.appsglobal.collections;
const HOLD_MS = (config.fluxapps.tempMsgTtlS ?? 3600) * 1000;
const CHECKS_AT_ONCE = config.fluxapps.tempCheckConcurrency ?? 4;
const RETRY_MS = 5000;

let relay = null;
let draining = false;
let drainAgain = false;
let awaitingDb = false;
let backlog = true;
let waiters = [];

function rows() {
  return dbHelper.databaseConnection().db(config.database.appsglobal.database).collection(appsHeldMessages);
}

/**
 * Every temp app message passes through here: it is kept on arrival, unchecked, and
 * checked once the registry it is checked against is built. Nothing heard is lost
 * to a restart or a sync that ends short, and how long a check takes is never time
 * a peer is waited on.
 *
 * A row is keyed on the whole message rather than its hash, so a forged copy
 * arriving first cannot stand in the way of the genuine one. It holds the message
 * once: a gossiped copy's `envelope` and `networkPath` are its broadcast without
 * the message, and a synced copy has neither.
 * @param {object} message
 * @returns {string}
 */
function rowKey(message) {
  return crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex');
}

/**
 * What a row holds of the broadcast a message arrived in.
 * @param {{message: object, from: string}} [signed]
 * @returns {{envelope: ?object, networkPath: ?Array, from: ?string}}
 */
function arrivalOf(signed) {
  if (!signed) return { envelope: null, networkPath: null, from: null };
  const { message: frame, from } = signed;
  return { envelope: envelopeOf(frame), networkPath: validPath(frame.networkPath), from };
}

/**
 * Keep messages for checking.
 * @param {Array<{message: object, authenticated?: boolean, relay?: {message: object, from: string}}>} arrivals
 * `authenticated` is whether it arrived over an authenticated link, which only its live
 * frame can say, and `relay` the signed broadcast to pass on once it passes its checks.
 * A copy that arrives authenticated is what a row keeps: the same message from another
 * link may be refused for its route alone.
 * @returns {Promise<number>} How many are held, copies of one already held included.
 * @throws When the database does not take them: nothing may be counted as kept.
 */
async function hold(arrivals) {
  const now = Date.now();
  const operations = arrivals
    .filter(({ message }) => message && typeof message === 'object' && typeof message.hash === 'string')
    .map(({ message, authenticated = false, relay: signed }) => {
      const key = rowKey(message);
      const arrival = arrivalOf(signed);
      const fixed = {
        key, message, heldAt: new Date(now), expireAt: new Date(now + HOLD_MS),
      };
      if (!authenticated) {
        const update = { $setOnInsert: { ...fixed, ...arrival, authenticated: false } };
        return { updateOne: { filter: { key }, update, upsert: true } };
      }
      const update = signed
        ? { $setOnInsert: fixed, $set: { ...arrival, authenticated } }
        : { $setOnInsert: { ...fixed, ...arrival }, $set: { authenticated } };
      return { updateOne: { filter: { key }, update, upsert: true } };
    });
  if (!operations.length) return 0;
  await rows().bulkWrite(operations, { ordered: false }).catch((error) => {
    // Two copies upserted at once: the row exists, which is what was asked for.
    const others = (error.writeErrors ?? []).filter((writeError) => writeError.code !== 11000);
    if (!error.writeErrors || others.length) throw error;
  });
  backlog = true;
  // eslint-disable-next-line no-use-before-define
  drain();
  return operations.length;
}

/**
 * Whether the chain has paid for this hash and its message is not yet stored. Hash
 * sync is waiting on such a message and the registry is built from what it stores,
 * so it cannot wait for the registry.
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function isPaidAndMissing(hash) {
  const database = dbHelper.databaseConnection().db(config.database.daemon.database);
  const paid = await dbHelper.findOneInDatabase(database, appsHashesCollection, { hash }, { projection: { _id: 0, message: 1 } });
  return Boolean(paid && !paid.message);
}

async function settleWaiters() {
  if (!waiters.length) return;
  const [oldest] = await rows().find({}, { projection: { heldAt: 1 } }).sort({ heldAt: 1 }).limit(1)
    .toArray();
  const stillWaiting = [];
  for (const waiter of waiters) {
    if (!oldest || oldest.heldAt > waiter.before) waiter.resolve();
    else stillWaiting.push(waiter);
  }
  waiters = stillWaiting;
}

/**
 * @param {object} row
 * @returns {Promise<boolean>} false when the database did not answer: the row stays.
 */
async function check(row) {
  const frame = row.envelope ? { ...row.envelope, data: row.message, networkPath: row.networkPath } : undefined;
  const settle = (outcome) => { if (frame && relay) relay({ message: frame, from: row.from }, outcome); };
  try {
    const stored = await messageStore.storeAppTemporaryMessage(row.message, {
      furtherVerification: true, authenticated: row.authenticated, frame,
    });
    if (stored instanceof Error) log.warn(`Held message ${row.message.hash} refused: ${stored.message}`);
    settle(stored);
  } catch (error) {
    if (dbHelper.isDatabaseError(error)) {
      log.warn(`Held message ${row.message.hash} not checked, the database did not answer: ${error.message}`);
      return false;
    }
    log.warn(`Held message ${row.message.hash} refused: ${error.message}`);
    settle(error);
  }
  await rows().deleteOne({ _id: row._id }); // eslint-disable-line no-underscore-dangle
  return true;
}

function drainWhenDbReady() {
  if (awaitingDb) return;
  awaitingDb = true;
  globalState.waitForDbReady().then(() => {
    awaitingDb = false;
    // eslint-disable-next-line no-use-before-define
    drain();
  });
}

/**
 * Check what is held, oldest first, for as long as the registry is ready.
 * @returns {Promise<void>}
 */
async function drain() {
  if (draining) {
    drainAgain = true;
    return;
  }
  draining = true;
  let databaseDown = false;
  try {
    // The last test of each pass runs with nothing awaited before `draining` clears, so
    // a message held or a registry opening at any moment is picked up by this pass.
    do {
      drainAgain = false;
      while (globalState.dbReady && !databaseDown) {
        // eslint-disable-next-line no-await-in-loop
        const batch = await rows().find({}).sort({ heldAt: 1 }).limit(CHECKS_AT_ONCE)
          .toArray();
        if (!batch.length) {
          backlog = false;
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        databaseDown = (await Promise.all(batch.map(check))).includes(false);
        // eslint-disable-next-line no-await-in-loop
        await settleWaiters();
      }
      // eslint-disable-next-line no-await-in-loop
      await settleWaiters();
    } while (!databaseDown && (drainAgain || (globalState.dbReady && backlog)));
    if (databaseDown) setTimeout(drain, RETRY_MS).unref();
    else if (!globalState.dbReady) drainWhenDbReady();
  } catch (error) {
    log.error(`Held messages not checked: ${error.message}`);
    setTimeout(drain, RETRY_MS).unref();
  } finally {
    draining = false;
  }
}

/**
 * Resolves once every message held by now has been checked. Messages arriving later
 * do not extend the wait, so a flood cannot hold a node back from being ready.
 * @returns {Promise<void>}
 */
function drained() {
  return new Promise((resolve) => {
    waiters.push({ before: new Date(), resolve });
    drain();
  });
}

/**
 * Whether anything is known to be waiting to be checked.
 * @returns {boolean}
 */
function isEmpty() {
  return !backlog;
}

/**
 * Pick up what a previous run held, and check as soon as the registry is ready.
 * @param {function({message: object, from: string}, (boolean|Error)): void} relayMessage
 * Told what a gossiped message's check came to.
 * @returns {Promise<void>}
 */
async function start(relayMessage) {
  relay = relayMessage;
  backlog = await rows().estimatedDocumentCount() > 0;
  drain();
}

module.exports = {
  drained,
  hold,
  isEmpty,
  isPaidAndMissing,
  rowKey,
  start,
};
