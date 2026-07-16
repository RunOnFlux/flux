const config = require('config');
const fs = require('fs').promises;
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const messageHelper = require('./messageHelper');

// All tamper-feature behaviour (episode dedup, boot identity, event taxonomy)
// deliberately lives inside this service rather than at the emitting call
// sites: the call sites (appReconciler, crontabAndMountsCleanup,
// syncthingFolderStateMachine) sit in files under heavy parallel rework on the
// v9 branch, while this file is identical across branches. Centralizing here
// keeps the feature rebase-safe and guarantees every emitter gets the same
// semantics without call-site edits.

const tamperingEventsCollection = config.database.local.collections.appTamperingEvents;
const nodeStartupTrackerCollection = config.database.local.collections.nodeStartupTracker;

const SYSTEM_APP_NAME = '__system__';
const STARTUP_MARKER_KEY = 'lastStartup';
const BOOT_HISTORY_KEY = 'bootHistory';
// ~200 boots covers >1 month even at the fastest observed abusive reboot
// cadence (~4h), comfortably beyond the collection's 30-day event TTL.
const BOOT_HISTORY_MAX = 200;

// One row per (appName, eventType) per hour. The reconciler re-attempts a
// failed recreation on a seconds-scale backoff and re-sweeps hourly, so a
// single persistent fault (unpullable image, missing volume) used to insert
// hundreds of rows for one incident, drowning genuine signal and inflating
// the enforcement count. Suppressed repeats are dropped, not counted, until
// the phase-1 incident schema adds first/last-seen rollups.
const EPISODE_WINDOW_MS = 60 * 60 * 1000;
// `${appName}|${eventType}` -> epoch ms of the last inserted row. In-memory
// on purpose: a process restart clears it, and per-boot events (mount races
// on a late data disk) should record once per boot.
const episodeMarkers = new Map();
const EPISODE_MARKERS_MAX = 1000;

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
 * Drop episode markers whose window has already elapsed so the map cannot
 * grow unbounded on a node with many flapping apps.
 * @param {number} now - Current epoch ms
 */
function pruneExpiredEpisodeMarkers(now) {
  episodeMarkers.forEach((recordedAt, key) => {
    if (now - recordedAt >= EPISODE_WINDOW_MS) episodeMarkers.delete(key);
  });
}

/**
 * Record a tampering event. Inserts one row per (appName, eventType) episode:
 * repeat calls inside EPISODE_WINDOW_MS after a successful insert are dropped,
 * so retry storms collapse into a single row while distinct incidents in later
 * windows still record. Documents expire 30 days after detectedAt (TTL index).
 * @param {string} appName - Application name (or SYSTEM_APP_NAME)
 * @param {string} eventType - One of: container_vanished, recreation_failed,
 *   network_pruned, network_detached, mount_vanished, volume_missing,
 *   node_reboot
 * @param {string} details - Free-text context about the event
 */
async function recordEvent(appName, eventType, details) {
  try {
    const now = Date.now();
    const episodeKey = `${appName}|${eventType}`;
    const lastRecordedAt = episodeMarkers.get(episodeKey);
    if (lastRecordedAt !== undefined && now - lastRecordedAt < EPISODE_WINDOW_MS) {
      log.debug(`appTamperingDetection - ${eventType} for ${appName} already recorded this episode, skipping`);
      return;
    }
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
    // Marked only after a successful insert: a failed write must not consume
    // the episode, otherwise the event would be silently lost for an hour.
    episodeMarkers.set(episodeKey, now);
    if (episodeMarkers.size > EPISODE_MARKERS_MAX) pruneExpiredEpisodeMarkers(now);
    log.info(`appTamperingDetection - recorded ${eventType} for ${appName}`);
  } catch (error) {
    log.error(`appTamperingDetection - failed to record event: ${error.message}`);
  }
}

const EVENTS_DEFAULT_LIMIT = 500;
const EVENTS_MAX_LIMIT = 1000;

/**
 * GET API handler. Returns tampering events, optionally filtered by appname,
 * sorted by most recent first. Results are capped: the route is public, so an
 * uncapped no-arg query would dump the whole collection to anyone. A stable
 * paging key arrives with the phase-1 schema (_id is stripped today); until
 * then newest-first plus `limit` is the supported access pattern.
 * Route: GET /apps/tamperingevents/:appname? (query: ?limit=1..1000)
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function getEvents(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(requestedLimit)
      ? EVENTS_DEFAULT_LIMIT
      : Math.min(Math.max(requestedLimit, 1), EVENTS_MAX_LIMIT);
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const query = appname ? { appName: appname } : {};
    const projection = {
      projection: { _id: 0 }, sort: { detectedAt: -1 }, limit,
    };
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
 * Startup check: distinguishes a genuine machine reboot from a mere process
 * restart using the kernel boot identity (/proc/sys/kernel/random/boot_id — a
 * UUID regenerated on every boot, stable across process restarts). On a
 * genuine reboot it records a single `node_reboot` observation under the
 * synthetic __system__ app and appends the boot to a rolling history, so
 * consumers can derive a reboot *rate/cadence* instead of a single interval.
 *
 * This replaces a wall-clock `frequent_restart` heuristic that measured
 * process-start gaps: a crash-loop or the serviceManager boot-retry looked
 * like a reboot (false positive), any reboot cycle slower than its 1h window
 * was invisible (false negative), and clock skew across a hard reboot both
 * evaded it and reset its baseline. boot_id comparison is immune to all three.
 *
 * The AppSyncOrchestrator heartbeat doc (same collection) also carries a
 * machineBootId, but it is written only once that service starts — later in
 * boot than this check runs — and is owned by it; reading it here would tie
 * correctness to startup ordering. This service owns its own marker instead.
 */
async function checkNodeReboot() {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) {
      log.warn('appTamperingDetection - DB not available, skipping reboot check');
      return;
    }
    const database = db.db(config.database.local.database);

    // The retired frequent_restart heuristic self-fired on the serviceManager
    // boot retry, so live nodes carry noise rows under that type. Sweep them
    // until every row written before the boot_id rework has aged past the
    // 30-day TTL; after that this purge deletes nothing and can be removed.
    try {
      await dbHelper.removeDocumentsFromCollection(
        database, tamperingEventsCollection, { eventType: 'frequent_restart' },
      );
    } catch (error) {
      log.warn(`appTamperingDetection - legacy frequent_restart purge failed: ${error.message}`);
    }

    let currentBootId = null;
    try {
      const bootIdPath = config.system?.bootIdPath ?? '/proc/sys/kernel/random/boot_id';
      currentBootId = (await fs.readFile(bootIdPath, 'utf8')).trim();
    } catch (error) {
      currentBootId = null;
    }
    if (!currentBootId) {
      // Without a boot identity, reboot vs restart is guesswork — recording
      // anything here would reintroduce the noise this check exists to remove.
      log.warn('appTamperingDetection - boot_id unreadable, skipping reboot check');
      return;
    }

    const now = new Date();
    const previous = await dbHelper.findOneInDatabase(
      database, nodeStartupTrackerCollection, { _id: STARTUP_MARKER_KEY },
    );
    const previousBootId = previous && previous.bootId ? previous.bootId : null;

    if (previousBootId && previousBootId !== currentBootId) {
      const previousStart = previous.at ? new Date(previous.at).toISOString() : 'unknown';
      await recordEvent(
        SYSTEM_APP_NAME,
        'node_reboot',
        `Machine rebooted: boot_id ${previousBootId.slice(0, 8)} -> ${currentBootId.slice(0, 8)}, previous FluxOS start ${previousStart}`,
      );
    }

    if (previousBootId !== currentBootId) {
      // First sighting of this boot_id (reboot, first run, or upgrade from the
      // pre-boot_id marker). A same-boot_id process restart adds no entry, so
      // the history reflects machine boots only.
      await dbHelper.findOneAndUpdateInDatabase(
        database,
        nodeStartupTrackerCollection,
        { _id: BOOT_HISTORY_KEY },
        { $push: { boots: { $each: [{ bootId: currentBootId, at: now }], $slice: -BOOT_HISTORY_MAX } } },
        { upsert: true },
      );
    }

    await dbHelper.findOneAndUpdateInDatabase(
      database,
      nodeStartupTrackerCollection,
      { _id: STARTUP_MARKER_KEY },
      { $set: { at: now, bootId: currentBootId } },
      { upsert: true },
    );
  } catch (error) {
    log.error(`appTamperingDetection - checkNodeReboot failed: ${error.message}`);
  }
}

module.exports = {
  recordEvent,
  getEvents,
  isNetworkMissingError,
  checkNodeReboot,
  EPISODE_WINDOW_MS,
  BOOT_HISTORY_MAX,
  SYSTEM_APP_NAME,
};
