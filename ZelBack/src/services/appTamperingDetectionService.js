const config = require('config');
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const messageHelper = require('./messageHelper');

const tamperingEventsCollection = config.database.local.collections.appTamperingEvents;
const nodeStartupTrackerCollection = config.database.local.collections.nodeStartupTracker;

const FREQUENT_RESTART_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const STARTUP_MARKER_KEY = 'lastStartup';
const SYSTEM_APP_NAME = '__system__';

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

/**
 * Compares the current time to the previous recorded startup time. If the
 * gap is less than one hour, records a `frequent_restart` tampering event
 * under a synthetic system app name. Always updates the startup marker to
 * "now" before returning. Called once per FluxOS startup.
 */
async function checkFrequentRestart() {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) {
      log.warn('appTamperingDetection - DB not available, skipping frequent-restart check');
      return;
    }
    const database = db.db(config.database.local.database);
    const now = new Date();
    const previous = await dbHelper.findOneInDatabase(
      database, nodeStartupTrackerCollection, { _id: STARTUP_MARKER_KEY },
    );
    if (previous && previous.at) {
      const delta = now.getTime() - new Date(previous.at).getTime();
      if (delta >= 0 && delta < FREQUENT_RESTART_THRESHOLD_MS) {
        const deltaSec = Math.floor(delta / 1000);
        await recordEvent(
          SYSTEM_APP_NAME,
          'frequent_restart',
          `FluxOS restarted ${deltaSec}s after previous start`,
        );
      }
    }
    await dbHelper.findOneAndUpdateInDatabase(
      database,
      nodeStartupTrackerCollection,
      { _id: STARTUP_MARKER_KEY },
      { $set: { at: now } },
      { upsert: true },
    );
  } catch (error) {
    log.error(`appTamperingDetection - checkFrequentRestart failed: ${error.message}`);
  }
}

module.exports = {
  recordEvent,
  getEvents,
  isNetworkMissingError,
  checkFrequentRestart,
  FREQUENT_RESTART_THRESHOLD_MS,
  SYSTEM_APP_NAME,
};
