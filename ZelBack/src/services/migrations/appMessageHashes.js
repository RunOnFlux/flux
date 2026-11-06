const config = require('config');

const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const registryManager = require('../appDatabase/registryManager');

// Written once every payment whose message this node does not store has been
// given a year of looking from its next look.
const RETRY_WINDOWS_MARKER = 'hashRetryWindowsFromFirstLook';

/**
 * Repairs the payment records' `message` flags when stored app messages are missing. A record is
 * flagged once its message is stored and no stored message is ever removed, so more flagged
 * records than stored messages means messages were lost from the apps database while the payment
 * records were kept. Each flag is then brought to what is stored, and a payment whose message is
 * gone is looked for afresh. The two counts are read from indexes.
 * @returns {Promise<{changed: number}>}
 */
async function repairLostMessageFlags() {
  const db = dbHelper.databaseConnection();
  const flagged = await dbHelper.countInDatabase(
    db.db(config.database.daemon.database),
    config.database.daemon.collections.appsHashes,
    { message: true },
  );
  const stored = await dbHelper.countInDatabase(
    db.db(config.database.appsglobal.database),
    config.database.appsglobal.collections.appsMessages,
    {},
    { hint: { _id: 1 } },
  );
  if (flagged <= stored) return { changed: 0 };
  log.warn(`${flagged} app payments are flagged as stored and ${stored} app messages are stored; repairing the flags`);
  return registryManager.reconstructAppMessagesHashCollection();
}

/**
 * Gives every payment whose message this node does not store a year of looking from its next
 * look, once. A record written from an old block carries a year counted from its payment, and is
 * given up on at its first look.
 * @returns {Promise<number>} The records restarted; 0 once the marker is written.
 */
async function restartRetryWindows() {
  const db = dbHelper.databaseConnection();
  const local = db.db(config.database.local.database);
  const startup = config.database.local.collections.nodeStartupTracker;
  if (await dbHelper.findOneInDatabase(local, startup, { _id: RETRY_WINDOWS_MARKER })) return 0;
  const result = await dbHelper.updateInDatabase(
    db.db(config.database.daemon.database),
    config.database.daemon.collections.appsHashes,
    { message: false },
    { $set: { messageNotFound: false, syncAttempts: 0 }, $unset: { nextRetryHeight: '', retryFromHeight: '' } },
  );
  await dbHelper.findOneAndUpdateInDatabase(local, startup, { _id: RETRY_WINDOWS_MARKER }, { $set: { at: new Date() } }, { upsert: true });
  log.info(`${result.modifiedCount} app payments not stored are looked for for a year from their next look`);
  return result.modifiedCount;
}

module.exports = { repairLostMessageFlags, restartRetryWindows };
