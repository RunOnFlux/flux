const config = require('config');
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const messageHelper = require('./messageHelper');

const tamperingEventsCollection = config.database.local.collections.appTamperingEvents;

/**
 * Returns true when a Docker/daemon error message indicates a missing network
 * (as opposed to an unrelated error that merely contains the word "network").
 * @param {string} errorMessage
 * @returns {boolean}
 */
function isNetworkMissingError(errorMessage) {
  if (!errorMessage) return false;
  const msg = String(errorMessage).toLowerCase();
  if (!msg.includes('network')) return false;
  return (
    msg.includes('not found')
    || msg.includes('no such')
    || msg.includes('does not exist')
    || msg.includes('missing')
  );
}

/**
 * Record a tampering event as a new row in the events collection.
 * Each call inserts a new document so the full history per app is preserved.
 * Documents expire automatically 30 days after detectedAt (TTL index).
 * @param {string} appName - Application name
 * @param {string} eventType - One of: container_vanished, network_pruned,
 *   mount_vanished, crontab_wiped, recreation_failed
 * @param {string} details - Free-text context about the event
 */
async function recordEvent(appName, eventType, details) {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) {
      log.warn('appTamperingDetection - DB not available, skipping event');
      return;
    }
    const database = db.db(config.database.local.database);
    const doc = {
      appName,
      eventType,
      details,
      detectedAt: new Date(),
    };
    await dbHelper.insertOneToDatabase(database, tamperingEventsCollection, doc);
    log.info(`appTamperingDetection - recorded ${eventType} for ${appName}`);
  } catch (error) {
    log.error(`appTamperingDetection - failed to record event: ${error.message}`);
  }
}

/**
 * GET API handler. Returns all tampering events, optionally filtered by appname,
 * sorted by most recent first.
 * Route: GET /apps/tamperingevents/:appname?
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function getEvents(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const query = appname ? { appName: appname } : {};
    const projection = { projection: { _id: 0 }, sort: { detectedAt: -1 } };
    const results = await dbHelper.findInDatabase(
      database, tamperingEventsCollection, query, projection,
    );
    const message = messageHelper.createDataMessage(results);
    res.json(message);
  } catch (error) {
    log.error(`appTamperingDetection - getEvents error: ${error.message}`);
    const errMessage = messageHelper.createErrorMessage(error.message);
    res.json(errMessage);
  }
}

module.exports = {
  recordEvent,
  getEvents,
  isNetworkMissingError,
};
