const config = require('config');
const os = require('os');
const fs = require('fs').promises;
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const messageHelper = require('./messageHelper');
const generalService = require('./generalService');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const { localAppsInformation } = require('./utils/appConstants');

// All tamper-feature behaviour (incident rollup, boot identity, severities)
// deliberately lives inside this service rather than at the emitting call
// sites: the call sites (appReconciler, crontabAndMountsCleanup,
// syncthingFolderStateMachine) sit in files under heavy parallel rework on the
// v9 branch, while this file is identical across branches. Centralizing here
// keeps the feature rebase-safe and guarantees every emitter gets the same
// semantics without call-site edits. Call sites still pass plain
// (appName, eventType, details); everything else is derived here.

const tamperingEventsCollection = config.database.local.collections.appTamperingEvents;
const nodeStartupTrackerCollection = config.database.local.collections.nodeStartupTracker;

const STARTUP_MARKER_KEY = 'lastStartup';
const BOOT_HISTORY_KEY = 'bootHistory';
// ~200 boots covers >1 month even at the fastest observed abusive reboot
// cadence (~4h), comfortably beyond the collection's 30-day event TTL.
const BOOT_HISTORY_MAX = 200;

// One incident document per (appName, eventType) per hour bucket. The
// reconciler re-attempts a failed recreation on a seconds-scale backoff and
// re-sweeps hourly, so a single persistent fault used to insert hundreds of
// rows for one incident; the rollup collapses those into a count. The time
// bucket is load-bearing: keyed on bootId alone, a node up for weeks would
// fold every same-type event across that whole span into one document,
// erasing distinct incidents.
const INCIDENT_BUCKET_MS = 60 * 60 * 1000;

// Per-type severity, stamped on each incident at write time so scoring reads
// stored values rather than re-deriving them. recreation_failed is an
// operational fault (registry, image pull, disk) — recorded for visibility
// but zero-weighted, because punishing it would penalize honest nodes for
// infra noise. container_vanished weighs highest:
// containers persist as `exited` across a clean reboot, so a
// positively-confirmed missing container is the strongest local indicator of
// host-side interference this data has. The mount/volume/network types carry
// low weight because they cannot distinguish interference from an unhealthy
// host — fleet-wide they are dominated by persistent faults on broken nodes —
// and a persistent fault re-records in every hourly bucket, so anything real
// accumulates weight without needing a high per-incident severity.
const EVENT_SEVERITY = {
  container_vanished: 3,
  network_pruned: 1,
  network_detached: 1,
  mount_vanished: 1,
  volume_missing: 1,
  recreation_failed: 0,
};

const EVENTS_DEFAULT_LIMIT = 500;
const EVENTS_MAX_LIMIT = 1000;

// Identity lookups are best-effort: an event must still record while the
// daemon is down, just unattributed. Failures back off rather than hammering
// a dead daemon on every event.
const IDENTITY_RETRY_MS = 5 * 60 * 1000;
const ATTRIBUTION_TTL_MS = 60 * 60 * 1000;
// The boot-sweep harvest (mount/volume checks) fires before fluxd's RPC is
// up, so without a later pass its incidents would systematically carry null
// identity. The backfill retries on this interval until the daemon answers,
// stamps every unattributed incident, and stops.
const IDENTITY_BACKFILL_INTERVAL_MS = 5 * 60 * 1000;

// Boot context, set once by checkNodeReboot() during startup. Until it runs
// (or on hosts without a readable boot_id) events fall back to an 'unknown'
// boot in their incident key.
let currentBootId = null;

let nodeIdentityCache = null;
let identityRetryAfterMs = 0;
let identityBackfillTimer = null;
const appAttributionCache = new Map(); // appName -> { ownerZelid, appHash, cachedAt }

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
 * Node identity (collateral outpoint, ip, operator pubkey/payout) from the
 * daemon's own fluxnode status, cached for the process lifetime. Returns null
 * while the daemon is unreachable — events record unattributed and the next
 * event after the backoff retries.
 * @returns {Promise<object|null>}
 */
async function getNodeIdentity() {
  if (nodeIdentityCache) return nodeIdentityCache;
  if (Date.now() < identityRetryAfterMs) return null;
  try {
    const status = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
    if (!status || status.status !== 'success' || !status.data) {
      throw new Error('fluxnode status unavailable');
    }
    const node = status.data;
    let nodeTxid = node.txhash ?? null;
    let nodeOutidx = node.outidx ?? null;
    if ((nodeTxid === null || nodeOutidx === null) && node.collateral) {
      const collateralInfo = generalService.getCollateralInfo(node.collateral);
      nodeTxid = collateralInfo.txhash;
      nodeOutidx = collateralInfo.txindex;
    }
    nodeIdentityCache = {
      nodeTxid,
      // getzelnodestatus returns outidx as a string; keep the stored type
      // numeric so fleet-level queries never juggle '0' vs 0
      nodeOutidx: nodeOutidx === null ? null : Number(nodeOutidx),
      nodeIp: node.ip ?? null,
      pubkey: node.pubkey ?? null,
      paymentAddress: node.payment_address ?? null,
    };
    return nodeIdentityCache;
  } catch (error) {
    identityRetryAfterMs = Date.now() + IDENTITY_RETRY_MS;
    log.debug(`appTamperingDetection - node identity unavailable: ${error.message}`);
    return null;
  }
}

/**
 * Stamp node/operator identity onto incidents that recorded while the daemon
 * was unreachable, retrying every IDENTITY_BACKFILL_INTERVAL_MS until it
 * answers, then stopping for good. Keyed off nodeTxid: null — identity is
 * constant for the life of the process, so one pass settles everything
 * written before the daemon came up. Safe to call repeatedly (single timer).
 */
function startIdentityBackfill() {
  if (identityBackfillTimer) return;
  const attempt = async () => {
    try {
      const identity = await getNodeIdentity();
      if (!identity || !identity.nodeTxid) return; // daemon not ready — next tick retries
      const db = dbHelper.databaseConnection();
      if (!db) return;
      const database = db.db(config.database.local.database);
      const result = await dbHelper.updateInDatabase(
        database,
        tamperingEventsCollection,
        { schemaVersion: { $gte: 1 }, nodeTxid: null },
        {
          $set: {
            nodeTxid: identity.nodeTxid,
            nodeOutidx: identity.nodeOutidx,
            nodeIp: identity.nodeIp,
            pubkey: identity.pubkey,
            paymentAddress: identity.paymentAddress,
          },
        },
      );
      const updated = result?.modifiedCount ?? 0;
      if (updated > 0) log.info(`appTamperingDetection - backfilled identity onto ${updated} incident(s)`);
      clearInterval(identityBackfillTimer);
      identityBackfillTimer = null;
    } catch (error) {
      log.debug(`appTamperingDetection - identity backfill attempt failed: ${error.message}`);
    }
  };
  identityBackfillTimer = setInterval(attempt, IDENTITY_BACKFILL_INTERVAL_MS);
  if (identityBackfillTimer.unref) identityBackfillTimer.unref();
  attempt();
}

/**
 * Reduce an emitted app name to the main app name used in the installed-apps
 * database. Call sites pass either a spec name ('MyApp') or a docker
 * identifier ('fluxcomponent_MyApp' / 'zelMyApp'); component and app names
 * are alphanumeric, so everything after the first underscore is the app.
 * @param {string} appName
 * @returns {string}
 */
function deriveMainAppName(appName) {
  let name = appName;
  if (name.startsWith('zel')) name = name.slice(3);
  else if (name.startsWith('flux')) name = name.slice(4);
  const underscore = name.indexOf('_');
  if (underscore !== -1) name = name.slice(underscore + 1);
  return name;
}

/**
 * Owner/spec-hash attribution for an app from the local installed-apps
 * database, cached per emitted name. Tries the name as passed first (a real
 * app name may itself start with 'flux'), then the derived main app name.
 * Best-effort: returns null fields when the app cannot be found.
 * @param {string} appName - Name exactly as passed by the emitter
 * @returns {Promise<object|null>}
 */
async function getAppAttribution(appName) {
  if (!appName) return null;
  const cached = appAttributionCache.get(appName);
  if (cached && Date.now() - cached.cachedAt < ATTRIBUTION_TTL_MS) return cached;
  try {
    const db = dbHelper.databaseConnection();
    if (!db) return null;
    const appsDatabase = db.db(config.database.appslocal.database);
    const projection = { projection: { _id: 0, owner: 1, hash: 1 } };
    let app = await dbHelper.findOneInDatabase(
      appsDatabase, localAppsInformation, { name: appName }, projection,
    );
    if (!app) {
      const mainName = deriveMainAppName(appName);
      if (mainName !== appName) {
        app = await dbHelper.findOneInDatabase(
          appsDatabase, localAppsInformation, { name: mainName }, projection,
        );
      }
    }
    const attribution = {
      ownerZelid: app?.owner ?? null,
      appHash: app?.hash ?? null,
      cachedAt: Date.now(),
    };
    appAttributionCache.set(appName, attribution);
    return attribution;
  } catch (error) {
    log.debug(`appTamperingDetection - attribution lookup failed for ${appName}: ${error.message}`);
    return null;
  }
}

/**
 * Record a tampering event as an incident rollup (schemaVersion 1).
 * One document per (appName, eventType, incidentKey) where incidentKey is
 * the boot_id plus an hourly time bucket; repeat calls increment `count` and
 * advance `lastSeen`, so retry storms collapse while the incident keeps its
 * full observation tally. Each document carries node identity, operator
 * identity, app attribution and severity so fleet-level consumers can
 * attribute and weigh it without joining local state.
 * Documents expire 30 days after lastSeen (TTL index).
 * @param {string} appName - Application name
 * @param {string} eventType - One of the EVENT_SEVERITY keys
 * @param {string} details - Free-text context (stored once per incident)
 */
async function recordEvent(appName, eventType, details) {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) {
      log.warn('appTamperingDetection - DB not available, skipping event');
      return;
    }
    const database = db.db(config.database.local.database);
    const now = new Date();
    const incidentKey = `${currentBootId ?? 'unknown'}:${Math.floor(now.getTime() / INCIDENT_BUCKET_MS)}`;
    const [identity, attribution] = await Promise.all([
      getNodeIdentity(),
      getAppAttribution(appName),
    ]);
    const query = { appName, eventType, incidentKey };
    const update = {
      $setOnInsert: {
        schemaVersion: 1,
        appName,
        eventType,
        incidentKey,
        severity: EVENT_SEVERITY[eventType] ?? 0,
        bootId: currentBootId,
        uptimeSecAtEvent: Math.round(os.uptime()),
        firstSeen: now,
        detailsSample: details,
        nodeTxid: identity?.nodeTxid ?? null,
        nodeOutidx: identity?.nodeOutidx ?? null,
        nodeIp: identity?.nodeIp ?? null,
        pubkey: identity?.pubkey ?? null,
        paymentAddress: identity?.paymentAddress ?? null,
        ownerZelid: attribution?.ownerZelid ?? null,
        appHash: attribution?.appHash ?? null,
      },
      $set: { lastSeen: now },
      $inc: { count: 1 },
    };
    let result;
    try {
      result = await dbHelper.findOneAndUpdateInDatabase(
        database, tamperingEventsCollection, query, update, { upsert: true },
      );
    } catch (error) {
      // Two concurrent upserts racing on a brand-new incident key can trip
      // the unique index; the loser retries once and lands as the increment.
      if (error && error.code === 11000) {
        result = await dbHelper.findOneAndUpdateInDatabase(
          database, tamperingEventsCollection, query, update, { upsert: true },
        );
      } else {
        throw error;
      }
    }
    // Insert detection across driver result shapes: v6 returns the pre-image
    // doc or null; older shapes return { value, lastErrorObject }.
    const inserted = !result || result.value === null || result?.lastErrorObject?.updatedExisting === false;
    if (inserted) {
      log.info(`appTamperingDetection - recorded ${eventType} for ${appName}`);
    } else {
      log.debug(`appTamperingDetection - ${eventType} for ${appName} repeated, incident count incremented`);
    }
  } catch (error) {
    log.error(`appTamperingDetection - failed to record event: ${error.message}`);
  }
}

/**
 * GET API handler. Returns tampering incidents, optionally filtered by
 * appname, most recent first. Results are capped: the route is public, so an
 * uncapped no-arg query would dump the whole collection to anyone. Documents
 * include _id as a stable paging/identity key. Pre-schema rows (detectedAt,
 * no lastSeen) sort after current-schema incidents until they age out via
 * their 30-day TTL.
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
    const options = { sort: { lastSeen: -1, detectedAt: -1 }, limit };
    const results = await dbHelper.findInDatabase(
      database, tamperingEventsCollection, query, options,
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
 * genuine reboot it appends the boot to a rolling history in
 * nodestartuptracker so consumers can derive a reboot rate/cadence.
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

    // Started here (not lazily from recordEvent) so incidents written during
    // boot — the boot-sweep mount/volume harvest fires before fluxd's RPC is
    // up — get their identity even on a node quiet enough that no later event
    // ever triggers a lookup.
    startIdentityBackfill();

    let bootId = null;
    try {
      const bootIdPath = config.system?.bootIdPath ?? '/proc/sys/kernel/random/boot_id';
      bootId = (await fs.readFile(bootIdPath, 'utf8')).trim();
    } catch (error) {
      bootId = null;
    }
    if (!bootId) {
      // Without a boot identity, reboot vs restart is guesswork — recording
      // anything here would reintroduce the noise this check exists to remove.
      log.warn('appTamperingDetection - boot_id unreadable, skipping reboot check');
      return;
    }
    currentBootId = bootId;

    const now = new Date();
    const previous = await dbHelper.findOneInDatabase(
      database, nodeStartupTrackerCollection, { _id: STARTUP_MARKER_KEY },
    );
    const previousBootId = previous && previous.bootId ? previous.bootId : null;

    if (previousBootId !== currentBootId) {
      // First sighting of this boot_id: genuine reboot, first run, or upgrade
      // from the pre-boot_id marker. All three land in the boot history; a
      // same-boot_id process restart does not, keeping the history a record
      // of machine boots rather than FluxOS restarts. `bootedAt` is the
      // machine's boot moment (uptime-derived) — cadence consumers want the
      // boot period itself, free of FluxOS's variable start lag; `at` is when
      // FluxOS first saw the boot.
      const bootedAt = new Date(now.getTime() - Math.round(os.uptime() * 1000));
      await dbHelper.findOneAndUpdateInDatabase(
        database,
        nodeStartupTrackerCollection,
        { _id: BOOT_HISTORY_KEY },
        { $push: { boots: { $each: [{ bootId: currentBootId, bootedAt, at: now }], $slice: -BOOT_HISTORY_MAX } } },
        { upsert: true },
      );
      if (previousBootId) {
        log.info(`appTamperingDetection - machine reboot: boot_id ${previousBootId.slice(0, 8)} -> ${currentBootId.slice(0, 8)}`);
      }
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
  startIdentityBackfill,
  deriveMainAppName,
  EVENT_SEVERITY,
  INCIDENT_BUCKET_MS,
  IDENTITY_BACKFILL_INTERVAL_MS,
  BOOT_HISTORY_MAX,
};
