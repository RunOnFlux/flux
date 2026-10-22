const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const fluxEventBus = require('../utils/fluxEventBus');

// When this node took each app it holds: one record per app, keyed by name.
//
// Written when an app is installed here and kept through every redeploy and spec
// update, which remove and reinstall the app without it leaving the node. Deleted
// when the app leaves. The announcer reads runningSince from here and nowhere
// else, because the network's copy of this node's own location rows lapses in
// normal running - expiry, eviction, sigterm - while the app goes on running.
//
// Kept apart from the app's specification in appsInformation: a spec update
// deletes and re-inserts that, and this record must outlive it.

const appsLocalDatabase = config.database.appslocal.database;
const { appsPlacements } = config.database.appslocal.collections;
const { appsLocations } = config.database.appsglobal.collections;

function localDatabase() {
  return dbHelper.databaseConnection().db(appsLocalDatabase);
}

/**
 * One record per app name.
 * @returns {Promise<void>}
 */
async function prepareCollection() {
  await dbHelper.ensureIndexes(localDatabase().collection(appsPlacements), [
    { key: { name: 1 }, unique: true, name: 'name_unique', recover: dbHelper.dedupeByKey },
  ]);
}

/**
 * Record that this node took an app at `placedAt`, unless a record for it exists.
 * @param {string} name App name.
 * @param {Date} [placedAt] When this node took it.
 * @param {string} [source] What the time was taken from: install, locationRow or now.
 * @returns {Promise<void>}
 */
async function recordPlacement(name, placedAt = new Date(), source = 'install') {
  // Two writers racing the first insert leave one record: the server retries an
  // upsert that collides on a unique index matched by equality.
  const result = await dbHelper.updateOneInDatabase(
    localDatabase(),
    appsPlacements,
    { name },
    { $setOnInsert: { name, placedAt } },
    { upsert: true },
  );
  if (result?.upsertedCount) {
    fluxEventBus.publish('app:placementRecorded', { name, placedAt: placedAt.toISOString(), source });
  }
}

/**
 * When this node took each named app, for the apps it has a record of.
 * @param {Array<string>} names App names.
 * @returns {Promise<Map<string, Date>>} placedAt by name.
 */
async function placementsOf(names) {
  const records = await dbHelper.findInDatabase(
    localDatabase(),
    appsPlacements,
    { name: { $in: names } },
    { projection: { _id: 0, name: 1, placedAt: 1 } },
  );
  return new Map(records.map(({ name, placedAt }) => [name, placedAt]));
}

/**
 * Forget an app this node no longer holds.
 * @param {string} name App name.
 * @returns {Promise<void>}
 */
async function removePlacement(name) {
  const result = await dbHelper.removeDocumentsFromCollection(localDatabase(), appsPlacements, { name });
  if (result?.deletedCount) fluxEventBus.publish('app:placementRemoved', { name });
}

/**
 * Make the records match the apps installed here, once, before this node first
 * announces them.
 *
 * An installed app with no record gets one dated at the runningSince this node's
 * own location row holds, so it keeps the place among its app's instances the
 * network already gives it, and dated now when there is no row. A record for an
 * app not installed here is removed, so a later install starts a new one.
 * @param {Array<string>} installedNames Names of the apps installed here.
 * @param {string} localSocketAddr This node's address.
 * @returns {Promise<{created: number, removed: number}>} What changed.
 */
async function reconcilePlacements(installedNames, localSocketAddr) {
  const database = localDatabase();
  const recorded = await placementsOf(installedNames);
  const missing = installedNames.filter((name) => !recorded.has(name));

  const ownRows = missing.length && localSocketAddr
    ? await dbHelper.findInDatabase(
      dbHelper.databaseConnection().db(config.database.appsglobal.database),
      appsLocations,
      { ip: localSocketAddr, name: { $in: missing } },
      { projection: { _id: 0, name: 1, runningSince: 1 } },
    )
    : [];
  const rowSince = new Map(ownRows.filter((row) => row.runningSince).map((row) => [row.name, new Date(row.runningSince)]));
  const now = new Date();
  // eslint-disable-next-line no-restricted-syntax
  for (const name of missing) {
    // eslint-disable-next-line no-await-in-loop
    await recordPlacement(name, rowSince.get(name) ?? now, rowSince.has(name) ? 'locationRow' : 'now');
  }

  const removal = await dbHelper.removeDocumentsFromCollection(database, appsPlacements, { name: { $nin: installedNames } });
  const removed = removal?.deletedCount ?? 0;
  if (missing.length || removed) {
    log.info(`appPlacements - recorded ${missing.length} placement(s) (${rowSince.size} from this node's location rows), removed ${removed} for apps not installed here`);
  }
  fluxEventBus.publish('app:placementsReconciled', { created: missing.length, fromLocationRows: rowSince.size, removed });
  return { created: missing.length, removed };
}

module.exports = {
  prepareCollection,
  recordPlacement,
  placementsOf,
  removePlacement,
  reconcilePlacements,
};
