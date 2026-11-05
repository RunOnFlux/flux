const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const { globalAppsTempMessages } = require('../utils/appConstants');

// How long a pending app message is held, from the time it was signed.
const TEMPORARY_MESSAGE_LIFETIME_MS = (config.fluxapps.tempMsgTtlS ?? 3600) * 1000;

/**
 * When an unpaid message ends. Every node lets one go at the same moment, however it came
 * by it, so a sync cannot extend one. One dated ahead of this node's clock ends no later
 * than a message signed now.
 * @param {number} timestamp The time the message was signed.
 * @returns {number} ms since the epoch.
 */
function temporaryMessageExpiry(timestamp) {
  return Math.min(timestamp, Date.now()) + TEMPORARY_MESSAGE_LIFETIME_MS;
}

/**
 * Write a pending app message. Every check it is held to has already passed.
 * @param {object} message type, version, appSpecifications (formatted), hash,
 *   timestamp, signature, arcaneSender.
 * @param {object} [admissionFields] What admission recorded: clientTag,
 *   clientTagHeight, clientTagCap when a submitter range granted one, origin,
 *   originKey.
 * @param {object} [options]
 * @param {boolean} [options.paid] A paid message waits for its promotion, whatever its age.
 * @returns {Promise<boolean>} false when another copy was stored first.
 */
async function insertTemporaryMessage(message, admissionFields = {}, { paid = false } = {}) {
  const receivedAt = Date.now();
  const record = {
    appSpecifications: message.appSpecifications,
    type: message.type,
    version: message.version,
    hash: message.hash,
    timestamp: message.timestamp,
    signature: message.signature,
    receivedAt: new Date(receivedAt),
    expireAt: new Date(paid ? receivedAt + TEMPORARY_MESSAGE_LIFETIME_MS : temporaryMessageExpiry(message.timestamp)),
    arcaneSender: message.arcaneSender,
    ...admissionFields,
  };
  const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
  const inserted = await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, record).catch((error) => {
    log.error(error);
    throw error;
  });
  return Boolean(inserted);
}

/**
 * Whether a pending app message with this hash is held here.
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function holdsTemporaryMessage(hash) {
  const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
  const found = await dbHelper.findOneInDatabase(database, globalAppsTempMessages, { hash }, { projection: { _id: 0, hash: 1 } });
  return Boolean(found);
}

module.exports = { insertTemporaryMessage, holdsTemporaryMessage, temporaryMessageExpiry };
