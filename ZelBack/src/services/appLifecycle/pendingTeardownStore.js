const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');

// Durable record of an app teardown that is owed but not yet finished. Written
// in the removal prelude BEFORE the local app row is deleted, so once the row
// is gone this doc is the SOLE record of what host cleanup is still owed
// (ufw/UPnP ports, the loop-mounted volume, the crontab entry, the image, the
// docker network). Cleared as the FIRST step of the teardown's finish, before
// the runtime-state doc (and its condemned stamp) is dropped. On boot, any doc
// still present means a teardown was interrupted (crash/restart mid-drain): the
// recovery routine re-stamps condemned and replays the teardown to completion.
//
// One doc per teardown target, keyed by `key` (the bare app name for a whole-app
// removal, or the `component_app` identifier for a component-scoped one). The
// stored component descriptors carry ONLY cleartext teardown inputs (identifier,
// volume folder, ports, repotag, component name) — never the enterprise blob or
// repoauth: teardown needs no credentials, preserving the no-cleartext-secret
// invariant. The volume path is NOT stored; cleanupCrontab re-derives it live.
//
// Every method is best-effort (try/catch + log, never throws): the durable doc
// is a safety net under a teardown path that already completes on its own, so a
// transient DB blip here must never abort the removal.

const appsLocalDatabase = config.database.appslocal.database;
const { pendingAppTeardowns } = config.database.appslocal.collections;

function collection() {
  const db = dbHelper.databaseConnection();
  return db.db(appsLocalDatabase);
}

/**
 * Upsert the owed-teardown doc for one removal.
 * @param {object} doc - { key, name, networkName, isComponent, createdAt, attempts, components: [...] }
 */
async function writeTeardown(doc) {
  try {
    const database = collection();
    await dbHelper.updateOneInDatabase(
      database,
      pendingAppTeardowns,
      { key: doc.key },
      { $set: doc },
      { upsert: true },
    );
  } catch (err) {
    log.error(`pendingTeardownStore - failed to write teardown ${doc && doc.key}: ${err.message}`);
  }
}

/**
 * Remove the owed-teardown doc once its teardown has finished.
 * @param {string} key
 */
async function clearTeardown(key) {
  try {
    const database = collection();
    await dbHelper.removeDocumentsFromCollection(database, pendingAppTeardowns, { key });
  } catch (err) {
    log.error(`pendingTeardownStore - failed to clear teardown ${key}: ${err.message}`);
  }
}

/**
 * Record one more recovery attempt against a doc (diagnostic only — teardown is
 * never abandoned on attempt count; an autonomous node must always complete it).
 * @param {string} key
 */
async function bumpAttempts(key) {
  try {
    const database = collection();
    await dbHelper.updateOneInDatabase(database, pendingAppTeardowns, { key }, { $inc: { attempts: 1 } }, { upsert: false });
  } catch (err) {
    log.error(`pendingTeardownStore - failed to bump attempts for ${key}: ${err.message}`);
  }
}

/**
 * Read every owed-teardown doc (boot recovery). Returns [] on any failure.
 * @returns {Promise<Array<object>>}
 */
async function readAllTeardowns() {
  try {
    const database = collection();
    const docs = await dbHelper.findInDatabase(database, pendingAppTeardowns, {}, { projection: { _id: 0 } });
    return docs || [];
  } catch (err) {
    log.error(`pendingTeardownStore - failed to read teardowns: ${err.message}`);
    return [];
  }
}

/**
 * Whether a teardown is still owed for an app NAME (a whole-app doc keyed by the
 * name, or a component doc keyed by component_app but carrying name=appName). The
 * install-side interlock uses this to refuse starting an install while a teardown
 * of the same name is still draining (the cancel-vs-install race). A read failure
 * returns false (fail-open) - an install must not be blocked by a transient DB
 * blip; the narrow race that re-opens is the same one the per-app gate closes.
 *
 * @param {string} name - bare app name
 * @returns {Promise<boolean>}
 */
async function teardownOwedFor(name) {
  try {
    const database = collection();
    const doc = await dbHelper.findOneInDatabase(database, pendingAppTeardowns, { name }, { projection: { _id: 0, key: 1 } });
    return Boolean(doc);
  } catch (err) {
    log.error(`pendingTeardownStore - failed to check owed teardown for ${name}: ${err.message}`);
    return false;
  }
}

/**
 * Ensure the unique indexes (called at boot, beside the other prepares): one on
 * `key` (one doc per teardown target) and one on `name` (fast install-side lookup).
 */
async function prepareCollection() {
  try {
    const database = collection();
    await database.collection(pendingAppTeardowns).createIndex({ key: 1 }, { unique: true, name: 'key_unique' });
    await database.collection(pendingAppTeardowns).createIndex({ name: 1 }, { name: 'name_lookup' });
  } catch (err) {
    log.error(`pendingTeardownStore - failed to prepare collection: ${err.message}`);
  }
}

module.exports = {
  writeTeardown,
  clearTeardown,
  bumpAttempts,
  readAllTeardowns,
  teardownOwedFor,
  prepareCollection,
};
