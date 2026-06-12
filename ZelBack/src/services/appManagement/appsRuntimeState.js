const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const dockerService = require('../dockerService');

// Node-local, per-component controller state. Sits between the app spec
// (desired config, in appsInformation) and Docker (actual state). Holds the
// durable inputs to the reconciler: the operator's stop lock and the
// crash-recovery backoff history, so both survive a FluxOS restart. The
// election/sync-derived `controllerDesired` is NOT here — it is in-memory,
// re-derived from live truth each cycle (see the reconcile workqueue).

const appsLocalDatabase = config.database.appslocal.database;
const { appsRuntimeState } = config.database.appslocal.collections;

// crash-recovery backoff ladder: immediate, 30s, 5m, 15m, 30m cap. Tunable via
// config (harness compression); the literals are the production defaults.
const BACKOFF_DELAYS_MS = config.fluxapps.crashBackoffDelaysMs ?? [0, 30 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
const STABLE_RUN_MS = config.fluxapps.crashBackoffStableRunMs ?? 10 * 60 * 1000;
// only the count (capped by the ladder) and the last timestamp are ever read,
// so the persisted history never needs to grow beyond the ladder length
const MAX_HISTORY = BACKOFF_DELAYS_MS.length;

function collection() {
  const db = dbHelper.databaseConnection();
  return db.db(appsLocalDatabase);
}

// The collection is keyed by the bare component identifier (`component_app`, or
// the app name for v1-3). Callers pass that form by convention, but convention
// across files is not an invariant: a docker-prefixed form would silently key a
// same-component twin the unique index cannot collapse (different key strings).
// Normalize at the storage boundary so the namespace is enforced in one place.
function canonical(identifier) {
  return dockerService.getBaseAppName(identifier);
}

/**
 * Returns the persisted runtime-state document for a component identifier
 * (e.g. `component_app`, or the app name for v1-3 apps), or null.
 *
 * @param {string} identifier
 * @returns {Promise<object|null>}
 */
async function getState(rawIdentifier) {
  const identifier = canonical(rawIdentifier);
  try {
    const database = collection();
    return await dbHelper.findOneInDatabase(database, appsRuntimeState, { identifier }, { projection: { _id: 0 } });
  } catch (err) {
    log.error(`appsRuntimeState - failed to read state for ${identifier}: ${err.message}`);
    return null;
  }
}

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || /E11000/.test(err.message || ''));
}

async function setFields(rawIdentifier, fields) {
  const identifier = canonical(rawIdentifier);
  const database = collection();
  const write = () => dbHelper.updateOneInDatabase(
    database,
    appsRuntimeState,
    { identifier },
    { $set: { identifier, ...fields, updatedAt: Date.now() } },
    { upsert: true },
  );
  try {
    await write();
  } catch (err) {
    // Under the unique index, the loser of a concurrent first upsert THROWS a
    // duplicate-key error instead of converting to an update. The document
    // exists at that point, so one retry takes the update path - without it the
    // loser's write (possibly the operator stop lock) would be silently dropped.
    if (!isDuplicateKeyError(err)) throw err;
    await write();
  }
}

/**
 * Sets the operator stop lock. This is the highest-priority desired-state
 * input — when true the reconciler must never auto-start the component. A
 * deliberate (re)start (operatorStopped=false, also install/redeploy) clears
 * the crash-recovery backoff so the component gets a fresh start.
 *
 * @param {string} identifier
 * @param {boolean} stopped
 */
async function setOperatorStopped(identifier, stopped) {
  try {
    const fields = { operatorStopped: stopped };
    if (!stopped) fields.restartHistory = [];
    await setFields(identifier, fields);
  } catch (err) {
    log.error(`appsRuntimeState - failed to set operatorStopped=${stopped} for ${identifier}: ${err.message}`);
  }
}

/**
 * Whether the operator has deliberately stopped this component, so the
 * reconciler (and the masterSlave/syncthing deciders) must leave it stopped.
 *
 * @param {string} identifier
 * @returns {Promise<boolean>}
 */
async function isOperatorStopped(identifier) {
  const state = await getState(identifier);
  return state?.operatorStopped === true;
}

/**
 * Appends a restart attempt (wall-clock) and trims the history to the ladder
 * length so a perpetually crashing container never grows the array unbounded.
 *
 * @param {string} identifier
 */
async function recordRestart(identifier) {
  try {
    const state = await getState(identifier);
    const history = (state && state.restartHistory) || [];
    history.push(Date.now());
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    await setFields(identifier, { restartHistory: history });
  } catch (err) {
    log.error(`appsRuntimeState - failed to record restart for ${identifier}: ${err.message}`);
  }
}

/**
 * Returns how long (ms) the reconciler must wait before the next restart is
 * allowed — 0 means restart now. Level-based: measured from the last restart
 * against the backoff ladder, so the worker re-enqueues after the remaining
 * time rather than sleeping.
 *
 * The ladder resets only when the previous run PROVABLY lasted STABLE_RUN_MS:
 * death time minus start time, where the death time is the best available
 * evidence — the recorded die event, or docker's State.FinishedAt passed in by
 * the reconciler from the inspect it already performed (docker records the
 * true death time even when the event was missed: reboot, FluxOS restart,
 * stream gap). Time since the ATTEMPT is not stability: the component sits
 * stopped in backoff between attempts, and resetting on elapsed time launders
 * a crash loop's history at any rung longer than STABLE_RUN_MS, making the
 * cap unreachable. With no death evidence at all the ladder holds — the
 * conservative direction costs at most one deeper rung, the permissive one
 * re-opens the laundering bug.
 *
 * @param {string} identifier
 * @param {number|null} lastFinishedAtMs - docker State.FinishedAt of the
 *        stopped container (ms epoch), when the caller has inspect data
 * @returns {Promise<number>}
 */
async function restartWaitMs(identifier, lastFinishedAtMs = null) {
  const state = await getState(identifier);
  const history = (state && state.restartHistory) || [];
  if (history.length === 0) return 0;

  const lastRestart = history[history.length - 1];
  const lastDeath = Math.max(state.lastDiedAt || 0, lastFinishedAtMs || 0);
  if (lastDeath > lastRestart && lastDeath - lastRestart > STABLE_RUN_MS) {
    await setFields(identifier, { restartHistory: [] });
    return 0;
  }

  const sinceLast = Date.now() - lastRestart;
  const index = Math.min(history.length, BACKOFF_DELAYS_MS.length - 1);
  return Math.max(0, BACKOFF_DELAYS_MS[index] - sinceLast);
}

/**
 * Records the last observed exit for diagnostics / tampering signals.
 *
 * @param {string} identifier
 * @param {number} exitCode
 */
async function recordExit(identifier, exitCode) {
  try {
    await setFields(identifier, { lastExitCode: exitCode, lastDiedAt: Date.now() });
  } catch (err) {
    log.error(`appsRuntimeState - failed to record exit for ${identifier}: ${err.message}`);
  }
}

/**
 * Drops all runtime state for a component (on uninstall).
 *
 * @param {string} identifier
 */
async function remove(rawIdentifier) {
  const identifier = canonical(rawIdentifier);
  try {
    const database = collection();
    await dbHelper.removeDocumentsFromCollection(database, appsRuntimeState, { identifier });
  } catch (err) {
    log.error(`appsRuntimeState - failed to remove state for ${identifier}: ${err.message}`);
  }
}

/**
 * Prepares the collection for use: merges any same-identifier twins, then
 * creates the unique index that makes twins impossible.
 *
 * Twins exist on nodes that wrote before the unique index did (concurrent
 * first upserts both insert without one). Because every later update matched
 * an ARBITRARY twin, fields scatter across them - the operator lock on one,
 * the backoff history on the other - so dedupe must merge field-wise rather
 * than keep one doc whole: dropping a doc could drop a real operator lock,
 * whose loss would auto-start a deliberately stopped app.
 */
async function prepareCollection() {
  try {
    const database = collection();
    const all = await dbHelper.findInDatabase(database, appsRuntimeState, {}, { projection: { _id: 0 } });
    const byIdentifier = new Map();
    // eslint-disable-next-line no-restricted-syntax
    for (const doc of all) {
      const list = byIdentifier.get(doc.identifier) || [];
      list.push(doc);
      byIdentifier.set(doc.identifier, list);
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const [identifier, twins] of byIdentifier) {
      if (twins.length > 1) {
        const merged = {
          identifier,
          // a lock anywhere is a lock: never auto-start a deliberately stopped app
          operatorStopped: twins.some((t) => t.operatorStopped === true),
          restartHistory: [...new Set(twins.flatMap((t) => t.restartHistory || []))].sort((a, b) => a - b).slice(-MAX_HISTORY),
          updatedAt: Math.max(...twins.map((t) => t.updatedAt || 0)),
        };
        const newestExit = twins.filter((t) => t.lastDiedAt !== undefined).sort((a, b) => b.lastDiedAt - a.lastDiedAt)[0];
        if (newestExit) {
          merged.lastExitCode = newestExit.lastExitCode;
          merged.lastDiedAt = newestExit.lastDiedAt;
        }
        log.warn(`appsRuntimeState - merged ${twins.length} duplicate docs for ${identifier} (operatorStopped=${merged.operatorStopped}, ${merged.restartHistory.length} restart entries)`);
        // eslint-disable-next-line no-await-in-loop
        await dbHelper.removeDocumentsFromCollection(database, appsRuntimeState, { identifier });
        // eslint-disable-next-line no-await-in-loop
        await dbHelper.updateOneInDatabase(database, appsRuntimeState, { identifier }, { $set: merged }, { upsert: true });
      }
    }
    await database.collection(appsRuntimeState).createIndex({ identifier: 1 }, { unique: true, name: 'identifier_unique' });
  } catch (err) {
    log.error(`appsRuntimeState - failed to prepare collection: ${err.message}`);
  }
}

module.exports = {
  prepareCollection,
  getState,
  setOperatorStopped,
  isOperatorStopped,
  recordRestart,
  restartWaitMs,
  recordExit,
  remove,
  BACKOFF_DELAYS_MS,
  STABLE_RUN_MS,
  MAX_HISTORY,
};
