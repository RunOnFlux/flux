const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');

// Node-local, per-component controller state. Sits between the app spec
// (desired config, in appsInformation) and Docker (actual state). Holds the
// durable inputs to the reconciler: the operator's stop lock and the
// crash-recovery backoff history, so both survive a FluxOS restart. The
// election/sync-derived `controllerDesired` is NOT here — it is in-memory,
// re-derived from live truth each cycle (see the reconcile workqueue).

const appsLocalDatabase = config.database.appslocal.database;
const { appsRuntimeState } = config.database.appslocal.collections;

// crash-recovery backoff ladder: immediate, 30s, 5m, 15m, 30m cap
const BACKOFF_DELAYS_MS = [0, 30 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
const STABLE_RUN_MS = 10 * 60 * 1000;
// only the count (capped by the ladder) and the last timestamp are ever read,
// so the persisted history never needs to grow beyond the ladder length
const MAX_HISTORY = BACKOFF_DELAYS_MS.length;

function collection() {
  const db = dbHelper.databaseConnection();
  return db.db(appsLocalDatabase);
}

/**
 * Returns the persisted runtime-state document for a component identifier
 * (e.g. `component_app`, or the app name for v1-3 apps), or null.
 *
 * @param {string} identifier
 * @returns {Promise<object|null>}
 */
async function getState(identifier) {
  try {
    const database = collection();
    return await dbHelper.findOneInDatabase(database, appsRuntimeState, { identifier }, { projection: { _id: 0 } });
  } catch (err) {
    log.error(`appsRuntimeState - failed to read state for ${identifier}: ${err.message}`);
    return null;
  }
}

async function setFields(identifier, fields) {
  const database = collection();
  await dbHelper.updateOneInDatabase(
    database,
    appsRuntimeState,
    { identifier },
    { $set: { identifier, ...fields, updatedAt: Date.now() } },
    { upsert: true },
  );
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
 * time rather than sleeping. If the component last restarted more than
 * STABLE_RUN_MS ago it has been stable, so the history is cleared and 0 is
 * returned (fresh start).
 *
 * @param {string} identifier
 * @returns {Promise<number>}
 */
async function restartWaitMs(identifier) {
  const state = await getState(identifier);
  const history = (state && state.restartHistory) || [];
  if (history.length === 0) return 0;

  const lastRestart = history[history.length - 1];
  const sinceLast = Date.now() - lastRestart;
  if (sinceLast > STABLE_RUN_MS) {
    await setFields(identifier, { restartHistory: [] });
    return 0;
  }

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
async function remove(identifier) {
  try {
    const database = collection();
    await dbHelper.removeDocumentsFromCollection(database, appsRuntimeState, { identifier });
  } catch (err) {
    log.error(`appsRuntimeState - failed to remove state for ${identifier}: ${err.message}`);
  }
}

module.exports = {
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
