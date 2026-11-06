const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const { globalAppsTempMessages } = require('../utils/appConstants');

// How long a pending app message is held before it expires unpaid.
const TEMPORARY_MESSAGE_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Write a pending app message. Every check it is held to has already passed.
 * @param {object} message type, version, appSpecifications (formatted), hash,
 *   timestamp, signature, arcaneSender.
 * @param {object} [admissionFields] What admission recorded: clientTag,
 *   clientTagHeight, clientTagCap when a submitter range granted one, origin,
 *   originKey.
 * @returns {Promise<void>}
 */
async function insertTemporaryMessage(message, admissionFields = {}) {
  const receivedAt = Date.now();
  const record = {
    appSpecifications: message.appSpecifications,
    type: message.type,
    version: message.version,
    hash: message.hash,
    timestamp: message.timestamp,
    signature: message.signature,
    receivedAt: new Date(receivedAt),
    expireAt: new Date(receivedAt + TEMPORARY_MESSAGE_LIFETIME_MS),
    arcaneSender: message.arcaneSender,
    ...admissionFields,
  };
  const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
  await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, record).catch((error) => {
    log.error(error);
    throw error;
  });
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

module.exports = { insertTemporaryMessage, holdsTemporaryMessage };
